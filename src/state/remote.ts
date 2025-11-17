/**
 * Remote state synchronization
 *
 * Manages reading and writing state on the VPS at /var/lib/dbx/state.json
 */

import type { SSHClient } from '../ssh/client.js';
import type { DbxState, InstanceMetadata } from './schema.js';
import { createEmptyState, validateState, createInstanceKey, StateValidationError } from './schema.js';
import { SSHCommandError } from '../ssh/errors.js';

/**
 * Remote state directory path
 */
const REMOTE_STATE_DIR = '/var/lib/dbx';

/**
 * Remote state file path
 */
const REMOTE_STATE_FILE = `${REMOTE_STATE_DIR}/state.json`;

/**
 * Temporary file path for atomic writes
 */
const REMOTE_STATE_TEMP = `${REMOTE_STATE_FILE}.tmp`;

/**
 * Ensures remote state directory exists with proper permissions
 *
 * @param sshClient - Connected SSH client
 */
async function ensureRemoteStateDirectory(sshClient: SSHClient): Promise<void> {
  try {
    // Check if directory exists
    await sshClient.exec(`test -d ${REMOTE_STATE_DIR}`);
  } catch {
    // Directory doesn't exist, create it
    console.log('Creating remote state directory...');
    await sshClient.exec(`sudo mkdir -p ${REMOTE_STATE_DIR}`);
    await sshClient.exec(`sudo chmod 700 ${REMOTE_STATE_DIR}`);

    // Try to set ownership to current user (may fail if not root)
    try {
      const whoami = await sshClient.exec('whoami');
      const username = whoami.stdout.trim();
      await sshClient.exec(`sudo chown ${username} ${REMOTE_STATE_DIR}`);
    } catch {
      // Ownership change failed, not critical
      console.warn('Warning: Could not change ownership of remote state directory');
    }
  }
}

/**
 * Reads remote state from VPS
 *
 * @param sshClient - Connected SSH client
 * @returns Remote state object (empty state if file doesn't exist)
 * @throws StateValidationError if state file is malformed
 */
export async function readRemoteState(sshClient: SSHClient): Promise<DbxState> {
  try {
    // Read remote state file
    const result = await sshClient.exec(`cat ${REMOTE_STATE_FILE}`);

    if (result.exitCode !== 0) {
      // File doesn't exist or can't be read
      return createEmptyState();
    }

    // Parse JSON
    let parsedState: unknown;
    try {
      parsedState = JSON.parse(result.stdout);
    } catch (err) {
      throw new StateValidationError(
        `Remote state file is corrupted: ${REMOTE_STATE_FILE}\n` +
          `Error: ${err instanceof Error ? err.message : String(err)}\n` +
          `Inspect manually: ssh ${sshClient.getHost()} cat ${REMOTE_STATE_FILE}`
      );
    }

    // Validate and return
    return validateState(parsedState);
  } catch (err) {
    // Handle specific errors
    if (err instanceof SSHCommandError) {
      if (err.stderr.includes('No such file or directory')) {
        // File doesn't exist - return empty state
        return createEmptyState();
      }

      if (err.stderr.includes('Permission denied')) {
        throw new StateValidationError(
          `Permission denied reading remote state: ${REMOTE_STATE_FILE}\n` +
            `Fix: ssh ${sshClient.getHost()} sudo chown $(whoami) ${REMOTE_STATE_FILE}`
        );
      }
    }

    // Re-throw validation errors
    if (err instanceof StateValidationError) {
      throw err;
    }

    // Unknown error
    throw new StateValidationError(
      `Failed to read remote state: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Writes remote state to VPS atomically
 *
 * Uses temp file + move strategy to prevent corruption.
 *
 * @param sshClient - Connected SSH client
 * @param state - State object to write
 * @throws StateValidationError if write fails
 */
export async function writeRemoteState(sshClient: SSHClient, state: DbxState): Promise<void> {
  // Ensure directory exists
  await ensureRemoteStateDirectory(sshClient);

  // Serialize state
  const content = JSON.stringify(state, null, 2);

  try {
    // Write to temp file using heredoc
    await sshClient.exec(`cat > ${REMOTE_STATE_TEMP} << 'DBX_STATE_EOF'\n${content}\nDBX_STATE_EOF`);

    // Set permissions on temp file
    await sshClient.exec(`chmod 600 ${REMOTE_STATE_TEMP}`);

    // Atomic move
    await sshClient.exec(`mv ${REMOTE_STATE_TEMP} ${REMOTE_STATE_FILE}`);

    // Verify file was created
    await sshClient.exec(`test -f ${REMOTE_STATE_FILE}`);
  } catch (err) {
    // Clean up temp file if it exists
    try {
      await sshClient.exec(`rm -f ${REMOTE_STATE_TEMP}`);
    } catch {
      // Cleanup failed, not critical
    }

    throw new StateValidationError(
      `Failed to write remote state: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Gets instance metadata for a specific project/environment from remote state
 *
 * @param sshClient - Connected SSH client
 * @param project - Project name
 * @param env - Environment name
 * @returns Instance metadata or undefined if not found
 */
export async function getRemoteInstance(
  sshClient: SSHClient,
  project: string,
  env: string
): Promise<InstanceMetadata | undefined> {
  const state = await readRemoteState(sshClient);
  const key = createInstanceKey(project, env);
  return state.instances[key];
}

/**
 * Sets instance metadata for a specific project/environment in remote state
 *
 * @param sshClient - Connected SSH client
 * @param project - Project name
 * @param env - Environment name
 * @param metadata - Instance metadata to store
 */
export async function setRemoteInstance(
  sshClient: SSHClient,
  project: string,
  env: string,
  metadata: InstanceMetadata
): Promise<void> {
  const state = await readRemoteState(sshClient);
  const key = createInstanceKey(project, env);
  state.instances[key] = metadata;
  await writeRemoteState(sshClient, state);
}

/**
 * Lists all instances in remote state
 *
 * @param sshClient - Connected SSH client
 * @returns Array of [key, metadata] tuples
 */
export async function listRemoteInstances(sshClient: SSHClient): Promise<Array<[string, InstanceMetadata]>> {
  const state = await readRemoteState(sshClient);
  return Object.entries(state.instances);
}

/**
 * Removes instance metadata from remote state
 *
 * @param sshClient - Connected SSH client
 * @param project - Project name
 * @param env - Environment name
 * @returns true if instance was removed, false if it didn't exist
 */
export async function removeRemoteInstance(
  sshClient: SSHClient,
  project: string,
  env: string
): Promise<boolean> {
  const state = await readRemoteState(sshClient);
  const key = createInstanceKey(project, env);

  if (!state.instances[key]) {
    return false;
  }

  delete state.instances[key];
  await writeRemoteState(sshClient, state);
  return true;
}

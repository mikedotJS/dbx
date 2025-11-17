/**
 * State file management
 *
 * Handles reading and writing .dbx/state.json with proper permissions and atomic updates.
 */

import { readFile, writeFile, mkdir, chmod, rename, access } from 'fs/promises';
import { join } from 'path';
import type { DbxState, InstanceMetadata } from './schema.js';
import { createEmptyState, validateState, createInstanceKey, StateValidationError } from './schema.js';

/**
 * State directory name
 */
const STATE_DIR_NAME = '.dbx';

/**
 * State file name
 */
const STATE_FILE_NAME = 'state.json';

/**
 * Directory permissions (owner only: rwx------)
 */
const DIR_PERMISSIONS = 0o700;

/**
 * File permissions (owner only: rw-------)
 */
const FILE_PERMISSIONS = 0o600;

/**
 * Reads the state file from the project directory
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns State object (returns empty state if file doesn't exist)
 * @throws StateValidationError if state file is malformed
 */
export async function readState(cwd: string = process.cwd()): Promise<DbxState> {
  const statePath = join(cwd, STATE_DIR_NAME, STATE_FILE_NAME);

  // Check if state file exists
  try {
    await access(statePath);
  } catch {
    // State file doesn't exist - return empty state
    return createEmptyState();
  }

  // Read state file
  let rawContent: string;
  try {
    rawContent = await readFile(statePath, 'utf-8');
  } catch (err) {
    throw new StateValidationError(
      `Failed to read state file: ${statePath}\n` + `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Parse JSON
  let parsedState: unknown;
  try {
    parsedState = JSON.parse(rawContent);
  } catch (err) {
    const error = err as Error;
    throw new StateValidationError(
      `Failed to parse state file as JSON: ${statePath}\n` +
        `Error: ${error.message}\n` +
        `The state file may be corrupted. Consider backing it up and deleting it to start fresh.`
    );
  }

  // Validate and return
  return validateState(parsedState);
}

/**
 * Writes the state file to the project directory with atomic write
 *
 * Uses a temp file + rename strategy to prevent corruption from partial writes.
 *
 * @param state - State object to write
 * @param cwd - Current working directory (defaults to process.cwd())
 * @throws StateValidationError if write fails
 */
export async function writeState(state: DbxState, cwd: string = process.cwd()): Promise<void> {
  const stateDir = join(cwd, STATE_DIR_NAME);
  const statePath = join(stateDir, STATE_FILE_NAME);
  const tempPath = join(stateDir, `${STATE_FILE_NAME}.tmp`);

  // Ensure state directory exists with proper permissions
  try {
    await mkdir(stateDir, { recursive: true, mode: DIR_PERMISSIONS });
    // Ensure permissions are correct even if directory already existed
    await chmod(stateDir, DIR_PERMISSIONS);
  } catch (err) {
    throw new StateValidationError(
      `Failed to create state directory: ${stateDir}\n` + `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Serialize state
  const content = JSON.stringify(state, null, 2) + '\n';

  // Write to temp file
  try {
    await writeFile(tempPath, content, { encoding: 'utf-8', mode: FILE_PERMISSIONS });
  } catch (err) {
    throw new StateValidationError(
      `Failed to write temp state file: ${tempPath}\n` + `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Atomic rename
  try {
    await rename(tempPath, statePath);
  } catch (err) {
    throw new StateValidationError(
      `Failed to rename temp state file: ${tempPath} -> ${statePath}\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Ensure final file has correct permissions
  try {
    await chmod(statePath, FILE_PERMISSIONS);
  } catch (err) {
    // Non-fatal, but log warning
    console.warn(`Warning: Failed to set state file permissions: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Gets instance metadata for a specific project/environment
 *
 * @param project - Project name
 * @param env - Environment name
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Instance metadata or undefined if not found
 */
export async function getInstance(project: string, env: string, cwd?: string): Promise<InstanceMetadata | undefined> {
  const state = await readState(cwd);
  const key = createInstanceKey(project, env);
  return state.instances[key];
}

/**
 * Sets instance metadata for a specific project/environment
 *
 * @param project - Project name
 * @param env - Environment name
 * @param metadata - Instance metadata to store
 * @param cwd - Current working directory (defaults to process.cwd())
 */
export async function setInstance(project: string, env: string, metadata: InstanceMetadata, cwd?: string): Promise<void> {
  const state = await readState(cwd);
  const key = createInstanceKey(project, env);
  state.instances[key] = metadata;
  await writeState(state, cwd);
}

/**
 * Removes instance metadata for a specific project/environment
 *
 * @param project - Project name
 * @param env - Environment name
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns true if instance was removed, false if it didn't exist
 */
export async function removeInstance(project: string, env: string, cwd?: string): Promise<boolean> {
  const state = await readState(cwd);
  const key = createInstanceKey(project, env);

  if (!state.instances[key]) {
    return false;
  }

  delete state.instances[key];
  await writeState(state, cwd);
  return true;
}

/**
 * Lists all instances in state
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Array of [key, metadata] tuples
 */
export async function listInstances(cwd?: string): Promise<Array<[string, InstanceMetadata]>> {
  const state = await readState(cwd);
  return Object.entries(state.instances);
}

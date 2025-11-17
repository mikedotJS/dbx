/**
 * State reconciliation
 *
 * Resolves conflicts between local and remote state, using remote as source of truth.
 */

import type { SSHClient } from '../ssh/client.js';
import type { InstanceMetadata } from '../state/schema.js';
import { getInstance, setInstance, removeInstance } from '../state/manager.js';
import { getRemoteInstance, setRemoteInstance } from '../state/remote.js';
import { isContainerRunning } from './mongodb.js';

/**
 * Reconciliation result
 */
export interface ReconciliationResult {
  /** Whether reconciliation was needed */
  reconciled: boolean;
  /** Description of what was reconciled */
  action?: string;
  /** Instance metadata after reconciliation */
  metadata?: InstanceMetadata;
}

/**
 * Reconciles state for a specific instance
 *
 * Resolution priority:
 * 1. If remote exists and local missing: copy remote to local
 * 2. If local exists and remote missing: verify container exists, update remote or remove local
 * 3. If both exist with conflicts: use remote as source of truth
 * 4. If neither exists: no reconciliation needed
 *
 * @param sshClient - Connected SSH client
 * @param project - Project name
 * @param env - Environment name
 * @returns Reconciliation result
 */
export async function reconcileInstanceState(
  sshClient: SSHClient,
  project: string,
  env: string
): Promise<ReconciliationResult> {
  const localMetadata = await getInstance(project, env);
  const remoteMetadata = await getRemoteInstance(sshClient, project, env);

  // Case 1: Remote exists, local missing
  if (remoteMetadata && !localMetadata) {
    console.log(`Found instance on VPS, syncing local state for ${project}/${env}`);
    await setInstance(project, env, remoteMetadata);

    return {
      reconciled: true,
      action: 'copied-remote-to-local',
      metadata: remoteMetadata,
    };
  }

  // Case 2: Local exists, remote missing
  if (localMetadata && !remoteMetadata) {
    console.log(`Verifying instance ${project}/${env} exists on VPS...`);

    // Check if container actually exists and is running
    const containerRunning = await isContainerRunning(sshClient, localMetadata.containerName);

    if (containerRunning) {
      // Container exists, update remote state
      console.log(`Container exists, updating remote state for ${project}/${env}`);
      await setRemoteInstance(sshClient, project, env, localMetadata);

      return {
        reconciled: true,
        action: 'copied-local-to-remote',
        metadata: localMetadata,
      };
    } else {
      // Container missing, remove stale local state
      console.warn(`Container not found on VPS, removing stale local state for ${project}/${env}`);
      await removeInstance(project, env);

      return {
        reconciled: true,
        action: 'removed-stale-local',
      };
    }
  }

  // Case 3: Both exist - check for conflicts
  if (localMetadata && remoteMetadata) {
    // Check if metadata matches
    const hasConflict =
      localMetadata.port !== remoteMetadata.port ||
      localMetadata.containerName !== remoteMetadata.containerName ||
      localMetadata.dbName !== remoteMetadata.dbName;

    if (hasConflict) {
      console.warn(`State conflict detected for ${project}/${env}, using remote state as source of truth`);
      await setInstance(project, env, remoteMetadata);

      return {
        reconciled: true,
        action: 'resolved-conflict-from-remote',
        metadata: remoteMetadata,
      };
    }

    // No conflicts
    return {
      reconciled: false,
      metadata: localMetadata,
    };
  }

  // Case 4: Neither exists
  return {
    reconciled: false,
  };
}

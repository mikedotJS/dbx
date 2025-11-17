/**
 * Sync command - reconcile local and remote DBX state
 *
 * Remote state is treated as the source of truth for instance existence and metadata.
 */

import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import type { DbxState } from '../state/schema.js';
import { readState, writeState } from '../state/manager.js';
import { readRemoteState } from '../state/remote.js';
import { SSHClient } from '../ssh/client.js';
import { SSHAuthenticationError, SSHConnectionError } from '../ssh/errors.js';
import { expandTilde } from '../config/loader.js';

type DiffResult = {
  added: string[];
  removed: string[];
  updated: string[];
  nextState: DbxState;
};

function computeDiff(local: DbxState, remote: DbxState): DiffResult {
  const added: string[] = [];
  const removed: string[] = [];
  const updated: string[] = [];

  const nextState: DbxState = { instances: { ...local.instances } };

  // Remote-only and updates
  for (const [key, remoteInst] of Object.entries(remote.instances)) {
    if (!local.instances[key]) {
      added.push(key);
      nextState.instances[key] = remoteInst;
      continue;
    }

    const localInst = local.instances[key];
    const differs = JSON.stringify(localInst) !== JSON.stringify(remoteInst);
    if (differs) {
      updated.push(key);
      nextState.instances[key] = remoteInst;
    }
  }

  // Local-only: remove
  for (const key of Object.keys(local.instances)) {
    if (!remote.instances[key]) {
      removed.push(key);
      delete nextState.instances[key];
    }
  }

  return { added, removed, updated, nextState };
}

function formatSummary(diff: DiffResult): string {
  const formatList = (items: string[]): string => (items.length ? items.join(', ') : 'none');
  return [
    'Sync summary:',
    `  + Added envs: ${formatList(diff.added.map((key) => key.split('/')[1] ?? key))}`,
    `  - Removed envs: ${formatList(diff.removed.map((key) => key.split('/')[1] ?? key))}`,
    `  ~ Updated envs: ${formatList(diff.updated.map((key) => key.split('/')[1] ?? key))}`,
  ].join('\n');
}

async function runSync(): Promise<void> {
  try {
    const config = await loadConfig();
    const localState = await readState();

    const ssh = new SSHClient({
      host: config.vps.host,
      port: config.vps.port ?? 22,
      username: config.vps.user,
      privateKeyPath: expandTilde(config.vps.sshKeyPath || '~/.ssh/id_rsa'),
    });

    await ssh.connect();
    const remoteState = await readRemoteState(ssh);
    ssh.disconnect();

    const diff = computeDiff(localState, remoteState);

    if (diff.added.length === 0 && diff.removed.length === 0 && diff.updated.length === 0) {
      console.log('Sync summary:\n  No changes. Local state matches remote.');
      process.exit(0);
    }

    await writeState(diff.nextState);
    console.log(formatSummary(diff));
    process.exit(0);
  } catch (err) {
    if (err instanceof SSHConnectionError || err instanceof SSHAuthenticationError) {
      console.error(err.message);
      process.exit(1);
    }

    console.error(`Failed to sync state: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Registers the sync command with Commander
 *
 * @param program - Commander program instance
 */
export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Reconcile local state with remote VPS state (remote is source of truth)')
    .action(() => {
      void runSync();
    });
}

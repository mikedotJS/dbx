/**
 * DBX destroy command
 *
 * Destroys a MongoDB instance and cleans up all associated resources.
 */

import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { getInstance, removeInstance } from '../state/manager.js';
import { removeRemoteInstance } from '../state/remote.js';
import { SSHClient } from '../ssh/client.js';
import { ConfigValidationError } from '../config/schema.js';
import { StateValidationError } from '../state/schema.js';
import { SSHError } from '../ssh/errors.js';
import { expandTilde } from '../config/loader.js';
import { promptConfirmation, promptYesNo } from '../utils/prompt.js';

/**
 * Backup directory on VPS
 */
const BACKUP_DIR = '/var/lib/dbx/backups';

/**
 * Destruction result tracking
 */
interface DestructionResult {
  containerRemoved: boolean;
  volumeRemoved: boolean;
  backupsRemoved: number;
  backupsPurged: boolean;
  remoteStateRemoved: boolean;
  localStateRemoved: boolean;
  warnings: string[];
}

/**
 * Registers the `destroy` command with Commander
 *
 * @param program - Commander program instance
 */
export function registerDestroyCommand(program: Command): void {
  program
    .command('destroy [environment]')
    .description('Destroy a MongoDB instance and remove all resources')
    .option('--purge', 'Also remove all backup files for this instance')
    .action(async (environment?: string, options?: { purge?: boolean }) => {
      try {
        // Load configuration
        const config = await loadConfig();

        // Determine environment
        const env = environment ?? config.defaultEnv;

        // Get instance metadata from state
        const metadata = await getInstance(config.project, env);

        // Check if instance exists
        if (!metadata) {
          console.error(`\n❌ No instance found for ${config.project}/${env}\n`);
          process.exit(1);
        }

        // Display warning and confirmation prompt
        console.log(`\n⚠️  WARNING: This will permanently destroy the instance ${config.project}/${env}`);
        console.log(`   - Container: ${metadata.containerName}`);
        console.log(`   - Volume: ${metadata.volume}`);
        console.log(`   - All data will be lost`);

        if (options?.purge) {
          console.log(`   - All backup files will be deleted`);
        } else {
          console.log(`   - Backup files will be preserved`);
        }

        console.log('');

        // Prompt for confirmation
        const confirmed = await promptConfirmation(
          `Type the environment name '${env}' to confirm destruction: `,
          env
        );

        if (!confirmed) {
          console.log('\nDestruction cancelled\n');
          process.exit(0);
        }

        console.log(`\nDestroying ${config.project}/${env}...`);

        // Initialize result tracking
        const result: DestructionResult = {
          containerRemoved: false,
          volumeRemoved: false,
          backupsRemoved: 0,
          backupsPurged: options?.purge ?? false,
          remoteStateRemoved: false,
          localStateRemoved: false,
          warnings: [],
        };

        // Expand SSH key path
        const sshKeyPath = expandTilde(config.vps.sshKeyPath || '~/.ssh/id_rsa');

        // Create SSH client
        const sshClient = new SSHClient({
          host: config.vps.host,
          port: config.vps.port || 22,
          username: config.vps.user,
          privateKeyPath: sshKeyPath,
          execTimeout: 60000, // 1 minute timeout
        });

        // Connect to VPS
        console.log(`Connecting to VPS: ${config.vps.host}...`);
        await sshClient.connect();

        try {
          // Remove container
          console.log('Removing container...');
          try {
            const containerResult = await sshClient.exec(`docker rm -f ${metadata.containerName}`);

            if (containerResult.exitCode === 0) {
              result.containerRemoved = true;
              console.log(`✓ Removed container: ${metadata.containerName}`);
            } else {
              // Check if container doesn't exist
              if (containerResult.stderr.includes('No such container')) {
                result.warnings.push(`Container ${metadata.containerName} not found (already removed)`);
                console.log(`⚠ Container not found (already removed)`);
              } else {
                // Other error - ask if user wants to continue
                console.error(`\n❌ Failed to remove container: ${containerResult.stderr}`);
                const continueAnyway = await promptYesNo('Continue with remaining cleanup?');

                if (!continueAnyway) {
                  console.log('\nDestruction aborted\n');
                  process.exit(1);
                }

                result.warnings.push(`Failed to remove container: ${containerResult.stderr}`);
              }
            }
          } catch (err) {
            console.error(`\n❌ Error removing container: ${err instanceof Error ? err.message : String(err)}`);
            const continueAnyway = await promptYesNo('Continue with remaining cleanup?');

            if (!continueAnyway) {
              console.log('\nDestruction aborted\n');
              process.exit(1);
            }

            result.warnings.push(`Error removing container: ${err instanceof Error ? err.message : String(err)}`);
          }

          // Remove volume
          console.log('Removing volume...');
          try {
            const volumeResult = await sshClient.exec(`docker volume rm ${metadata.volume}`);

            if (volumeResult.exitCode === 0) {
              result.volumeRemoved = true;
              console.log(`✓ Removed volume: ${metadata.volume}`);
            } else {
              // Check if volume doesn't exist
              if (volumeResult.stderr.includes('No such volume')) {
                result.warnings.push(`Volume ${metadata.volume} not found (already removed)`);
                console.log(`⚠ Volume not found (already removed)`);
              } else if (volumeResult.stderr.includes('volume is in use')) {
                console.error(`\n❌ Volume is still in use`);
                console.error(`Manual cleanup: ssh ${config.vps.host} docker volume rm ${metadata.volume}`);
                result.warnings.push(`Volume is in use - manual cleanup required`);

                const continueAnyway = await promptYesNo('Continue with remaining cleanup?');
                if (!continueAnyway) {
                  console.log('\nDestruction aborted\n');
                  process.exit(1);
                }
              } else {
                // Other error - ask if user wants to continue
                console.error(`\n❌ Failed to remove volume: ${volumeResult.stderr}`);
                const continueAnyway = await promptYesNo('Continue with remaining cleanup?');

                if (!continueAnyway) {
                  console.log('\nDestruction aborted\n');
                  process.exit(1);
                }

                result.warnings.push(`Failed to remove volume: ${volumeResult.stderr}`);
              }
            }
          } catch (err) {
            console.error(`\n❌ Error removing volume: ${err instanceof Error ? err.message : String(err)}`);
            const continueAnyway = await promptYesNo('Continue with remaining cleanup?');

            if (!continueAnyway) {
              console.log('\nDestruction aborted\n');
              process.exit(1);
            }

            result.warnings.push(`Error removing volume: ${err instanceof Error ? err.message : String(err)}`);
          }

          // Handle backups
          if (options?.purge) {
            console.log('Removing backups...');
            try {
              const backupPattern = `${config.project}_${env}-*.dump`;
              const backupPath = `${BACKUP_DIR}/${backupPattern}`;

              // Count backups before removing
              const lsResult = await sshClient.exec(`ls ${backupPath} 2>/dev/null | wc -l`);
              const backupCount = parseInt(lsResult.stdout.trim(), 10) || 0;

              if (backupCount > 0) {
                const rmResult = await sshClient.exec(`rm -f ${backupPath}`);

                if (rmResult.exitCode === 0) {
                  result.backupsRemoved = backupCount;
                  console.log(`✓ Removed ${backupCount} backup file(s)`);
                } else {
                  result.warnings.push(`Failed to remove backups: ${rmResult.stderr}`);
                  console.log(`⚠ Failed to remove backups: ${rmResult.stderr}`);
                }
              } else {
                console.log(`⚠ No backup files found`);
              }
            } catch (err) {
              result.warnings.push(`Error removing backups: ${err instanceof Error ? err.message : String(err)}`);
              console.log(`⚠ Error removing backups: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            console.log(`Backups preserved in ${BACKUP_DIR}/`);
          }

          // Remove from remote state
          console.log('Updating remote state...');
          try {
            const removed = await removeRemoteInstance(sshClient, config.project, env);
            result.remoteStateRemoved = removed;

            if (removed) {
              console.log(`✓ Removed from remote state`);
            } else {
              result.warnings.push('Instance not found in remote state');
              console.log(`⚠ Instance not found in remote state`);
            }
          } catch (err) {
            result.warnings.push(`Failed to update remote state: ${err instanceof Error ? err.message : String(err)}`);
            console.log(`⚠ Failed to update remote state: ${err instanceof Error ? err.message : String(err)}`);
          }
        } finally {
          // Always disconnect
          await sshClient.disconnect();
        }

        // Remove from local state (always try, even if remote failed)
        console.log('Updating local state...');
        try {
          const removed = await removeInstance(config.project, env);
          result.localStateRemoved = removed;

          if (removed) {
            console.log(`✓ Removed from local state`);
          } else {
            result.warnings.push('Instance not found in local state');
            console.log(`⚠ Instance not found in local state`);
          }
        } catch (err) {
          result.warnings.push(`Failed to update local state: ${err instanceof Error ? err.message : String(err)}`);
          console.log(`⚠ Failed to update local state: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Display summary
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Destroyed instance: ${config.project}/${env}`);
        console.log(`${'='.repeat(60)}`);

        if (result.containerRemoved) {
          console.log(`✓ Container removed: ${metadata.containerName}`);
        }

        if (result.volumeRemoved) {
          console.log(`✓ Volume removed: ${metadata.volume}`);
        }

        if (result.backupsPurged) {
          if (result.backupsRemoved > 0) {
            console.log(`✓ Removed ${result.backupsRemoved} backup file(s)`);
          } else {
            console.log(`- No backup files found`);
          }
        } else {
          console.log(`- Backups preserved in ${BACKUP_DIR}/`);
        }

        // Display warnings
        if (result.warnings.length > 0) {
          console.log(`\n⚠ Warnings:`);
          result.warnings.forEach((warning) => {
            console.log(`  - ${warning}`);
          });
        }

        console.log(`\n✅ Instance ${config.project}/${env} has been destroyed\n`);

        process.exit(0);
      } catch (err) {
        // Handle different error types
        if (err instanceof ConfigValidationError) {
          console.error(`\n❌ Configuration Error:\n${err.message}\n`);
          process.exit(1);
        }

        if (err instanceof StateValidationError) {
          console.error(`\n❌ State Error:\n${err.message}\n`);
          process.exit(1);
        }

        if (err instanceof SSHError) {
          console.error(`\n❌ SSH Error:\n${err.message}\n`);
          console.error('Check VPS connectivity and SSH credentials.\n');
          process.exit(1);
        }

        // Unknown error
        console.error(`\n❌ Unexpected Error:\n${err instanceof Error ? err.message : String(err)}\n`);
        if (err instanceof Error && err.stack) {
          console.error(err.stack);
        }
        process.exit(1);
      }
    });
}

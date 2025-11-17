/**
 * DBX restore command
 *
 * Restores a MongoDB backup to a provisioned instance.
 */

import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { getInstance } from '../state/manager.js';
import { SSHClient } from '../ssh/client.js';
import { restoreBackup, BackupError } from '../backup/manager.js';
import { ConfigValidationError } from '../config/schema.js';
import { StateValidationError } from '../state/schema.js';
import { SSHError } from '../ssh/errors.js';
import { expandTilde } from '../config/loader.js';

/**
 * Registers the `restore` command with Commander
 *
 * @param program - Commander program instance
 */
export function registerRestoreCommand(program: Command): void {
  program
    .command('restore <backup-file> [environment]')
    .description('Restore a MongoDB backup to an instance')
    .action(async (backupFile: string, environment?: string) => {
      try {
        // Validate backup file argument
        if (!backupFile) {
          console.error('\n❌ Backup file argument is required\n');
          console.error('Usage: dbx restore <backup-file> [environment]\n');
          process.exit(1);
        }

        // Load configuration
        const config = await loadConfig();

        // Determine environment
        const env = environment ?? config.defaultEnv;

        console.log(`Restoring ${config.project}/${env} from ${backupFile}...`);

        // Get instance metadata from state
        const metadata = await getInstance(config.project, env);

        // Check if instance exists
        if (!metadata) {
          console.error(`\n❌ No instance found for ${config.project}/${env}. Run 'dbx up' to provision one.\n`);
          process.exit(1);
        }

        // Expand SSH key path
        const sshKeyPath = expandTilde(config.vps.sshKeyPath || '~/.ssh/id_rsa');

        // Create SSH client
        const sshClient = new SSHClient({
          host: config.vps.host,
          port: config.vps.port || 22,
          username: config.vps.user,
          privateKeyPath: sshKeyPath,
          execTimeout: 300000, // 5 minute timeout for restores
        });

        // Connect to VPS
        console.log(`Connecting to VPS: ${config.vps.host}...`);
        await sshClient.connect();

        try {
          // Restore backup
          await restoreBackup({
            backupFile,
            metadata,
            sshClient,
          });

          // Display success message
          console.log(`\n✅ Restore completed: ${config.project}/${env} from ${backupFile}\n`);

          process.exit(0);
        } finally {
          // Always disconnect
          await sshClient.disconnect();
        }
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

        if (err instanceof BackupError) {
          console.error(`\n❌ Restore Error:\n${err.message}\n`);
          if (err.details) {
            console.error(`Details: ${err.details}\n`);
          }
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

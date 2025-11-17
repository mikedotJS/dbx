/**
 * DBX backup command
 *
 * Creates a MongoDB backup of a provisioned instance.
 */

import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { getInstance, setInstance } from '../state/manager.js';
import { SSHClient } from '../ssh/client.js';
import { createBackup, formatFileSize, BackupError } from '../backup/manager.js';
import { ConfigValidationError } from '../config/schema.js';
import { StateValidationError } from '../state/schema.js';
import { SSHError } from '../ssh/errors.js';
import { expandTilde } from '../config/loader.js';

/**
 * Registers the `backup` command with Commander
 *
 * @param program - Commander program instance
 */
export function registerBackupCommand(program: Command): void {
  program
    .command('backup [environment]')
    .description('Create a MongoDB backup of an instance')
    .action(async (environment?: string) => {
      try {
        // Load configuration
        const config = await loadConfig();

        // Determine environment
        const env = environment ?? config.defaultEnv;

        console.log(`Backing up ${config.project}/${env}...`);

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
          execTimeout: 300000, // 5 minute timeout for backups
        });

        // Connect to VPS
        console.log(`Connecting to VPS: ${config.vps.host}...`);
        await sshClient.connect();

        try {
          // Create backup
          const result = await createBackup({
            project: config.project,
            env,
            metadata,
            sshClient,
          });

          // Update lastBackup timestamp in state
          const updatedMetadata = {
            ...metadata,
            lastBackup: result.timestamp,
          };

          await setInstance(config.project, env, updatedMetadata);

          // Display success message
          const formattedSize = formatFileSize(result.fileSize);
          console.log(`\n✅ Backup completed: ${result.filePath} (${formattedSize})\n`);

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
          console.error(`\n❌ Backup Error:\n${err.message}\n`);
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

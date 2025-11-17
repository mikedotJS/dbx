/**
 * DBX url command
 *
 * Retrieves and displays the MongoDB connection URI for a provisioned instance.
 */

import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { getInstance } from '../state/manager.js';
import { buildConnectionURISafe, buildConnectionURIMasked } from '../provision/uri-builder.js';
import { ConfigValidationError } from '../config/schema.js';
import { StateValidationError } from '../state/schema.js';

/**
 * Registers the `url` command with Commander
 *
 * @param program - Commander program instance
 */
export function registerUrlCommand(program: Command): void {
  program
    .command('url [environment]')
    .description('Retrieve MongoDB connection URL for an instance')
    .option('--show-password', 'Display the full connection URI with plaintext password')
    .action(async (environment?: string, options?: { showPassword?: boolean }) => {
      try {
        // Load configuration
        const config = await loadConfig();

        // Determine environment
        const env = environment ?? config.defaultEnv;

        // Get instance metadata from state
        const metadata = await getInstance(config.project, env);

        // Check if instance exists
        if (!metadata) {
          console.error(`\n❌ No instance found for ${config.project}/${env}. Run 'dbx up' to provision one.\n`);
          process.exit(1);
        }

        // Build connection URI
        let uri: string;
        try {
          if (options?.showPassword) {
            // Show full URI with password
            uri = buildConnectionURISafe(metadata, config.vps.host);
          } else {
            // Show URI with masked password
            uri = buildConnectionURIMasked(metadata, config.vps.host);
          }
        } catch (err) {
          console.error(`\n❌ Failed to build connection URI:\n${err instanceof Error ? err.message : String(err)}\n`);
          process.exit(1);
        }

        // Display URI
        console.log(uri);
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

        // Unknown error
        console.error(`\n❌ Unexpected Error:\n${err instanceof Error ? err.message : String(err)}\n`);
        if (err instanceof Error && err.stack) {
          console.error(err.stack);
        }
        process.exit(1);
      }
    });
}

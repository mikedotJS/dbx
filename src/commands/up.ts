/**
 * DBX up command
 *
 * Provisions a MongoDB instance on the VPS.
 */

import { Command } from 'commander';
import { provisionInstance } from '../provision/orchestrator.js';
import { loadConfig } from '../config/loader.js';
import { ProvisioningError, InstanceExistsError } from '../provision/errors.js';
import { ConfigValidationError } from '../config/schema.js';
import { StateValidationError } from '../state/schema.js';
import { SSHError } from '../ssh/errors.js';
import { DockerError } from '../ssh/errors.js';

/**
 * Registers the `up` command with Commander
 *
 * @param program - Commander program instance
 */
export function registerUpCommand(program: Command): void {
  program
    .command('up [environment]')
    .description('Provision a MongoDB instance')
    .option('-q, --quiet', 'Suppress progress output')
    .action(async (environment?: string, options?: { quiet?: boolean }) => {
      try {
        // Determine environment
        let env = environment;

        if (!env) {
          // Load config to get default environment
          const config = await loadConfig();
          env = config.defaultEnv;
          console.log(`Using default environment: ${env}`);
        }

        // Suppress logs if quiet mode
        if (options?.quiet) {
          console.log = () => {}; // Suppress console.log
          // Still allow console.error and console.warn
        }

        // Provision the instance
        const result = await provisionInstance({ env });

        if (result.isNew) {
          // New instance provisioned
          process.exit(0);
        } else {
          // Existing instance
          process.exit(0);
        }
      } catch (err) {
        // Handle different error types
        if (err instanceof InstanceExistsError) {
          // Instance already exists - not really an error
          process.exit(0);
        }

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
          process.exit(1);
        }

        if (err instanceof DockerError) {
          console.error(`\n❌ Docker Error:\n${err.message}\n`);
          process.exit(1);
        }

        if (err instanceof ProvisioningError) {
          console.error(`\n❌ Provisioning Error:\n${err.message}\n`);
          console.error(`Failed at step: ${err.step}`);
          console.error(`Timestamp: ${err.timestamp}\n`);
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

/**
 * Configuration loading and management
 *
 * Handles reading and validating dbx.config.json from the file system.
 */

import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { DbxConfig } from './schema.js';
import { validateConfig, ConfigValidationError } from './schema.js';

/**
 * Name of the configuration file
 */
const CONFIG_FILE_NAME = 'dbx.config.json';

/**
 * Default SSH key path
 */
const DEFAULT_SSH_KEY_PATH = '~/.ssh/id_rsa';

/**
 * Expands tilde (~) in file paths to the user's home directory
 *
 * @param filepath - Path that may contain ~
 * @returns Expanded absolute path
 */
export function expandTilde(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return filepath.replace(/^~/, homedir());
  }
  return filepath;
}

/**
 * Loads and validates the DBX configuration from the current working directory
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Validated configuration with defaults applied
 * @throws ConfigValidationError if config file is missing, malformed, or invalid
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<DbxConfig> {
  const configPath = join(cwd, CONFIG_FILE_NAME);

  // Check if config file exists
  try {
    await access(configPath);
  } catch {
    throw new ConfigValidationError(
      `Configuration file not found: ${configPath}\n` +
        `Run 'dbx init' to create one, or ensure you're in the correct directory.`
    );
  }

  // Read config file
  let rawContent: string;
  try {
    rawContent = await readFile(configPath, 'utf-8');
  } catch (err) {
    throw new ConfigValidationError(
      `Failed to read configuration file: ${configPath}\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Parse JSON
  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawContent);
  } catch (err) {
    const error = err as Error;
    throw new ConfigValidationError(
      `Failed to parse configuration file as JSON: ${configPath}\n` +
        `Error: ${error.message}\n` +
        `Check for syntax errors, missing commas, or trailing commas.`
    );
  }

  // Validate config
  const config = validateConfig(parsedConfig);

  // Apply defaults
  if (!config.vps.sshKeyPath) {
    config.vps.sshKeyPath = DEFAULT_SSH_KEY_PATH;
  }

  if (!config.vps.port) {
    config.vps.port = 22;
  }

  // Expand tilde in SSH key path
  config.vps.sshKeyPath = expandTilde(config.vps.sshKeyPath);

  // Verify SSH key file exists
  try {
    await access(config.vps.sshKeyPath);
  } catch {
    throw new ConfigValidationError(
      `SSH key file not found: ${config.vps.sshKeyPath}\n` +
        `Ensure the file exists and is readable. You can specify a different path in vps.sshKeyPath.`
    );
  }

  return config;
}

/**
 * Creates an example configuration object
 *
 * Useful for documentation and testing
 */
export function createExampleConfig(): DbxConfig {
  return {
    project: 'my-app',
    defaultEnv: 'dev',
    vps: {
      host: '192.168.1.100',
      user: 'ubuntu',
      sshKeyPath: '~/.ssh/id_rsa',
      port: 22,
    },
    mongodb: {
      version: '7',
      basePort: 27018,
    },
  };
}

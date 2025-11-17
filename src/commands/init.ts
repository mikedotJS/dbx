/**
 * Init command - Interactive project initialization
 *
 * Creates dbx.config.json and initializes .dbx/state.json with guided prompts.
 */

import { Command } from 'commander';
import { basename, join } from 'path';
import { access, writeFile, mkdir, chmod } from 'fs/promises';
import { question, questionWithDefault, confirm } from '../utils/prompt.js';
import { expandTilde } from '../config/loader.js';
import { validateConfig, type DbxConfig } from '../config/schema.js';
import { writeState, readState } from '../state/manager.js';
import { StateValidationError, createEmptyState } from '../state/schema.js';

/**
 * Allowed characters for project and environment names.
 */
const NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Validates MongoDB version format
 *
 * @param version - Version string to validate
 * @returns true if valid format (e.g., "7", "6.0", "5.0.3")
 */
function isValidMongoVersion(version: string): boolean {
  return /^\d+(\.\d+)?(\.\d+)?$/.test(version);
}

/**
 * Validates port number is in valid range
 *
 * @param port - Port number to validate
 * @returns true if port is between 1024 and 65535
 */
function isValidPort(port: number): boolean {
  return port >= 1024 && port <= 65535;
}

/**
 * Validates a project/environment/user string for invalid characters.
 *
 * @param value - Value to validate
 * @returns true if value only contains safe characters
 */
function isValidName(value: string): boolean {
  return NAME_PATTERN.test(value);
}

/**
 * Validates SSH key file existence and prompts for confirmation if missing
 *
 * @param keyPath - SSH key path (may contain ~)
 * @returns true if file exists or user confirms to continue anyway
 */
async function validateSshKey(keyPath: string): Promise<boolean> {
  const expandedPath = expandTilde(keyPath);

  try {
    await access(expandedPath);
    return true;
  } catch {
    console.log(`\nWarning: SSH key file not found at ${expandedPath}`);
    return await confirm('Continue anyway?', false);
  }
}

/**
 * Prompts user for all configuration values
 *
 * @returns Complete configuration object
 */
async function promptForConfig(): Promise<DbxConfig> {
  console.log('\nPlease answer the following questions to initialize your DBX project.\n');

  // Project name
  const defaultProject = basename(process.cwd());
  let project = '';
  while (project === '') {
    const input = await questionWithDefault('Project name', defaultProject);
    if (input === '') {
      console.log('Error: Project name is required.');
      continue;
    }
    if (!isValidName(input)) {
      console.log('Error: Project name may only include letters, numbers, ".", "_" or "-".');
      continue;
    }
    project = input;
  }

  // Default environment
  let defaultEnv = '';
  while (defaultEnv === '') {
    const input = await questionWithDefault('Default environment', 'dev');
    if (input === '') {
      console.log('Error: Default environment is required.');
      continue;
    }
    if (!isValidName(input)) {
      console.log('Error: Environment name may only include letters, numbers, ".", "_" or "-".');
      continue;
    }
    defaultEnv = input;
  }

  // VPS host (required)
  let vpsHost = '';
  while (vpsHost === '') {
    const input = await question('VPS hostname or IP: ');
    if (input === '') {
      console.log('Error: VPS host is required.');
      continue;
    }
    vpsHost = input;
  }

  // VPS user
  let vpsUser = '';
  while (vpsUser === '') {
    const input = await questionWithDefault('VPS SSH user', 'root');
    if (input === '') {
      console.log('Error: VPS user is required.');
      continue;
    }
    if (!isValidName(input)) {
      console.log('Error: VPS user may only include letters, numbers, ".", "_" or "-".');
      continue;
    }
    vpsUser = input;
  }

  // SSH key path with validation
  let sshKeyPath = '';
  while (sshKeyPath === '') {
    const candidate = await questionWithDefault('SSH private key path', '~/.ssh/id_ed25519');
    if (candidate === '') {
      console.log('Error: SSH key path is required.');
      continue;
    }
    const keyValid = await validateSshKey(candidate);
    if (!keyValid) {
      console.log('Please provide a different SSH key path.\n');
      continue;
    }
    sshKeyPath = candidate;
  }

  // MongoDB version with validation
  let mongoVersion = '';
  while (mongoVersion === '') {
    const input = await questionWithDefault('MongoDB version', '7');
    if (!isValidMongoVersion(input)) {
      console.log('Error: Invalid MongoDB version format. Expected format: "7", "6.0", or "5.0.3".');
      continue;
    }
    mongoVersion = input;
  }

  // MongoDB base port with validation
  let basePort = 0;
  while (basePort === 0) {
    const portStr = await questionWithDefault('MongoDB base port', '27018');
    const parsed = parseInt(portStr, 10);

    if (Number.isNaN(parsed)) {
      console.log('Error: Port must be a number.');
      continue;
    }

    if (!isValidPort(parsed)) {
      console.log('Error: Port must be between 1024 and 65535.');
      continue;
    }

    basePort = parsed;
  }

  return {
    project,
    defaultEnv,
    vps: {
      host: vpsHost,
      user: vpsUser,
      sshKeyPath,
      port: 22,
    },
    mongodb: {
      version: mongoVersion,
      basePort,
    },
  };
}

/**
 * Writes configuration to dbx.config.json
 *
 * @param config - Configuration object to write
 * @param cwd - Current working directory
 * @throws Error if config file already exists or write fails
 */
async function writeConfigFile(config: DbxConfig, cwd: string = process.cwd()): Promise<void> {
  const configFilename = 'dbx.config.json';
  const configPath = join(cwd, configFilename);

  try {
    await access(configPath);
    throw new Error(
      `Configuration file already exists: ${configFilename}\n` +
        'Delete the file or use a different directory to initialize a new project.'
    );
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (err instanceof Error && err.message.startsWith('Configuration file already exists')) {
      throw err;
    }

    if (nodeErr?.code && nodeErr.code !== 'ENOENT') {
      throw new Error(
        `Failed to access configuration file at ${configPath}\n` +
          `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  let validatedConfig: DbxConfig;
  try {
    validatedConfig = validateConfig(config);
  } catch (err) {
    throw new Error(
      `Configuration validation failed: ${err instanceof Error ? err.message : String(err)}\n` +
        'Please correct the values and try again.'
    );
  }

  const content = JSON.stringify(validatedConfig, null, 2) + '\n';

  try {
    await writeFile(configPath, content, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(
      `Failed to write configuration file: ${configPath}\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Initializes .dbx directory and state.json file
 *
 * @param cwd - Current working directory
 */
async function initializeStateDirectory(cwd: string = process.cwd()): Promise<void> {
  const stateDir = join(cwd, '.dbx');

  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700);
  } catch (err) {
    throw new Error(
      `Failed to create state directory at ${stateDir}\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    // Validate existing state if present
    await access(join(stateDir, 'state.json'));
    await readState(cwd);
    await chmod(join(stateDir, 'state.json'), 0o600);
    console.log('Found existing state file, preserving instance data.');
    return;
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;

    if (nodeErr?.code !== 'ENOENT') {
      if (err instanceof StateValidationError) {
        throw err;
      }
      throw new Error(
        `Failed to access state file in ${stateDir}\n` +
          `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const emptyState = createEmptyState();
  await writeState(emptyState, cwd);
  try {
    await chmod(join(stateDir, 'state.json'), 0o600);
  } catch (err) {
    throw new Error(
      `Failed to set permissions on state file in ${stateDir}\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Main init command handler
 */
async function runInit(): Promise<void> {
  try {
    console.log('Initializing DBX project...');

    // Gather configuration from user
    const config = await promptForConfig();

    // Write config file
    console.log('\nCreating configuration file...');
    await writeConfigFile(config);

    // Initialize state directory
    console.log('Initializing state directory...');
    await initializeStateDirectory();

    // Success!
    console.log('\nInitialization complete!');
    console.log("Run 'dbx up' to provision your first instance.");
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nInitialization failed: ${message}`);
    console.error('Fix the issue above and rerun `dbx init`.');
    process.exit(1);
  }
}

/**
 * Registers the init command with Commander
 *
 * @param program - Commander program instance
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new DBX project with interactive prompts')
    .action(runInit);
}

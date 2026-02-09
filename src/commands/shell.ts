/**
 * Shell command - open interactive database shell
 *
 * Provides instant access to mongosh or psql via SSH with PTY allocation.
 */

import { Command } from 'commander';
import { loadConfig, expandTilde } from '../config/loader.js';
import type { DbxConfig } from '../config/schema.js';
import { getInstance } from '../state/manager.js';
import { getInstanceType, type InstanceMetadata } from '../state/schema.js';
import { SSHClient } from '../ssh/client.js';
import { SSHConnectionError, SSHAuthenticationError } from '../ssh/errors.js';
import type { Client } from 'ssh2';

/**
 * Resolves environment name from argument or config default
 */
function resolveEnv(config: DbxConfig, envArg?: string): string {
  if (envArg && envArg.trim() !== '') {
    return envArg.trim();
  }
  return config.defaultEnv;
}

/**
 * Builds container name from project and environment
 */
function buildContainerName(project: string, env: string): string {
  return `dbx_${project}_${env}`;
}

/**
 * Escapes a string for use in shell single quotes
 * Replaces ' with '\'' (end quote, escaped quote, start quote)
 */
function shellEscape(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * Builds the MongoDB shell command
 */
function buildMongoShellCommand(container: string, rootPassword: string): string {
  // Build root URI for admin access
  const encodedPassword = encodeURIComponent(rootPassword);
  const uri = `mongodb://root:${encodedPassword}@localhost:27017/admin`;

  // Use single quotes around URI to prevent shell interpretation
  return `docker exec -it ${container} mongosh '${shellEscape(uri)}'`;
}

/**
 * Builds the PostgreSQL shell command
 */
function buildPostgresShellCommand(
  container: string,
  rootPassword: string,
  dbName: string
): string {
  // Use PGPASSWORD environment variable for non-interactive auth
  // Escape password for shell safety
  const escapedPassword = shellEscape(rootPassword);
  return `docker exec -it -e PGPASSWORD='${escapedPassword}' ${container} psql -U postgres -d ${dbName}`;
}

/**
 * Builds the appropriate shell command based on database type
 */
function buildShellCommand(
  container: string,
  metadata: InstanceMetadata
): string {
  const dbType = getInstanceType(metadata);

  if (dbType === 'postgresql') {
    return buildPostgresShellCommand(container, metadata.rootPassword, metadata.dbName);
  }

  return buildMongoShellCommand(container, metadata.rootPassword);
}

/**
 * Gets current terminal dimensions
 */
function getTerminalSize(): { rows: number; cols: number } {
  return {
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  };
}

/**
 * Executes an interactive shell command via SSH with PTY allocation
 */
async function execInteractive(
  ssh: SSHClient,
  command: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Access the raw ssh2 Client
    const rawClient = ssh as unknown as { client: Client | null };
    if (!rawClient.client) {
      reject(new Error('SSH client not initialized'));
      return;
    }

    const { rows, cols } = getTerminalSize();

    // Request a shell with PTY allocation
    rawClient.client.exec(command, { pty: { rows, cols, term: process.env.TERM || 'xterm-256color' } }, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      // Set stdin to raw mode for proper terminal handling
      const wasRaw = process.stdin.isRaw;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      // Pipe stdin to remote
      process.stdin.pipe(stream);

      // Pipe remote output to local terminal
      stream.pipe(process.stdout);
      stream.stderr.pipe(process.stderr);

      // Handle terminal resize
      const onResize = () => {
        const size = getTerminalSize();
        stream.setWindow(size.rows, size.cols, 0, 0);
      };
      process.stdout.on('resize', onResize);

      // Handle stream close
      stream.on('close', (code: number) => {
        // Restore stdin state
        process.stdin.unpipe(stream);
        if (process.stdin.isTTY && wasRaw !== undefined) {
          process.stdin.setRawMode(wasRaw);
        }
        process.stdin.pause();
        process.stdout.removeListener('resize', onResize);

        resolve(code ?? 0);
      });

      // Handle stream errors
      stream.on('error', (streamErr: Error) => {
        process.stdin.unpipe(stream);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        process.stdout.removeListener('resize', onResize);
        reject(streamErr);
      });
    });
  });
}

/**
 * Main shell command handler
 */
async function runShell(envArg: string | undefined): Promise<void> {
  let config: DbxConfig | null = null;
  let env = '';

  try {
    // Load config
    config = await loadConfig();
    env = resolveEnv(config, envArg);

    // Get instance from state
    const metadata = await getInstance(config.project, env);
    if (!metadata) {
      console.error(`No instance found for env "${env}". Run "dbx up ${env}" first.`);
      process.exit(1);
    }

    const containerName = buildContainerName(config.project, env);
    const shellCmd = buildShellCommand(containerName, metadata);
    const dbType = getInstanceType(metadata);

    console.error(`Connecting to ${config.project}/${env} (${dbType})...`);

    // Connect via SSH
    const ssh = new SSHClient({
      host: config.vps.host,
      port: config.vps.port ?? 22,
      username: config.vps.user,
      privateKeyPath: expandTilde(config.vps.sshKeyPath || '~/.ssh/id_rsa'),
    });

    await ssh.connect();

    try {
      const exitCode = await execInteractive(ssh, shellCmd);
      ssh.disconnect();
      process.exit(exitCode);
    } catch (execErr) {
      ssh.disconnect();

      const errMsg = execErr instanceof Error ? execErr.message.toLowerCase() : '';

      if (errMsg.includes('no such container') || errMsg.includes('is not running')) {
        console.error(`Container is not running for env "${env}". Run "dbx up ${env}" to start it.`);
        process.exit(1);
      }

      throw execErr;
    }
  } catch (err) {
    if (err instanceof SSHConnectionError || err instanceof SSHAuthenticationError) {
      console.error(err.message);
      process.exit(1);
    }

    // Handle config/state errors
    const errMsg = err instanceof Error ? err.message : String(err);

    if (errMsg.includes('Configuration file not found') || errMsg.includes('dbx.config.json')) {
      console.error('Configuration file not found: dbx.config.json');
      console.error('Run "dbx init" to create a new project.');
      process.exit(1);
    }

    console.error(`Failed to open shell: ${errMsg}`);
    process.exit(1);
  }
}

/**
 * Registers the shell command with Commander
 *
 * @param program - Commander program instance
 */
export function registerShellCommand(program: Command): void {
  program
    .command('shell')
    .description('Open an interactive database shell (mongosh/psql)')
    .argument('[env]', 'Environment name (defaults to config defaultEnv)')
    .action((env: string | undefined) => {
      void runShell(env);
    });
}

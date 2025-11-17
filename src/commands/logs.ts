/**
 * Logs command - stream MongoDB container logs
 *
 * Supports tailing recent logs or following live output for an environment.
 */

import { Command } from 'commander';
import { loadConfig, expandTilde } from '../config/loader.js';
import type { DbxConfig } from '../config/schema.js';
import { SSHClient } from '../ssh/client.js';
import { SSHCommandError, SSHConnectionError, SSHAuthenticationError } from '../ssh/errors.js';
import type { Client } from 'ssh2';

const DEFAULT_TAIL = 200;

function resolveEnv(config: DbxConfig, envArg?: string): string {
  if (envArg && envArg.trim() !== '') {
    return envArg.trim();
  }
  return config.defaultEnv;
}

function buildContainerName(project: string, env: string): string {
  return `dbx_${project}_${env}`;
}

function buildDockerLogsCommand(container: string, tail: number, follow: boolean): string {
  const followFlag = follow ? '-f' : '';
  return ['docker', 'logs', '--tail', String(tail), followFlag, container].filter(Boolean).join(' ');
}

async function runLogs(envArg: string | undefined, options: { tail?: string; follow?: boolean }): Promise<void> {
  let config: DbxConfig | null = null;
  let env = '';
  let containerName = '';

  try {
    config = await loadConfig();
    env = resolveEnv(config, envArg);
    const tailLines = options.tail ? parseInt(options.tail, 10) : DEFAULT_TAIL;
    const follow = Boolean(options.follow);

    if (Number.isNaN(tailLines) || tailLines < 0) {
      console.error('Invalid --tail value. Provide a non-negative integer.');
      process.exit(1);
    }

    containerName = buildContainerName(config.project, env);
    const cmd = buildDockerLogsCommand(containerName, tailLines, follow);

    const ssh = new SSHClient({
      host: config.vps.host,
      port: config.vps.port ?? 22,
      username: config.vps.user,
      privateKeyPath: expandTilde(config.vps.sshKeyPath || '~/.ssh/id_rsa'),
    });

    await ssh.connect();

    try {
      await new Promise<void>((resolve, reject) => {
        const rawClient = ssh as unknown as { client: Client | null };
        if (!rawClient.client) {
          reject(new Error('SSH client not initialized'));
          return;
        }

        rawClient.client.exec(cmd, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }

          let stderrBuffer = '';

          if (stream.stdout) {
            stream.stdout.pipe(process.stdout);
          }
          if (stream.stderr) {
            stream.stderr.on('data', (chunk: Buffer) => {
              const text = chunk.toString('utf-8');
              stderrBuffer += text;
              process.stderr.write(text);
            });
          }

          stream.on('close', (code: number) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new SSHCommandError(ssh.getHost(), cmd, code ?? 1, stderrBuffer.trim()));
            }
          });

          stream.on('error', reject);
        });
      });
    } finally {
      ssh.disconnect();
    }

    process.exit(0);
  } catch (err) {
    if (err instanceof SSHCommandError) {
      const stderr = err.stderr.toLowerCase();
      if (stderr.includes('no such container')) {
        console.error(`No container found for env "${env}". Did you run "dbx up ${env}"?`);
      } else if (stderr.includes('cannot connect to the docker daemon') || stderr.includes('docker daemon')) {
        console.error('Docker is not reachable. Check that Docker is installed and running on the VPS.');
      } else {
        console.error(err.message || 'Failed to fetch logs.');
      }
      process.exit(1);
    }

    if (err instanceof SSHConnectionError || err instanceof SSHAuthenticationError) {
      console.error(err.message);
      process.exit(1);
    }

    console.error(`Failed to stream logs: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Registers the logs command with Commander
 *
 * @param program - Commander program instance
 */
export function registerLogsCommand(program: Command): void {
  program
    .command('logs')
    .description('View MongoDB container logs for an environment')
    .argument('[env]', 'Environment name (defaults to config defaultEnv)')
    .option('-f, --follow', 'Follow log output')
    .option('--tail <lines>', 'Number of lines to show from the end of the logs', String(DEFAULT_TAIL))
    .action((env: string | undefined, opts) => {
      void runLogs(env, opts);
    });
}

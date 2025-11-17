/**
 * SSH client wrapper
 *
 * Provides a high-level interface for SSH operations with connection management,
 * retry logic, and comprehensive error handling.
 */

import { Client, ConnectConfig } from 'ssh2';
import { readFile } from 'fs/promises';
import {
  SSHError,
  SSHConnectionError,
  SSHAuthenticationError,
  SSHCommandError,
  SSHTimeoutError,
} from './errors.js';

/**
 * SSH connection configuration
 */
export interface SSHConfig {
  /** VPS hostname or IP */
  host: string;
  /** SSH port */
  port: number;
  /** SSH username */
  username: string;
  /** Path to SSH private key */
  privateKeyPath: string;
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  /** Command execution timeout in milliseconds */
  execTimeout?: number;
}

/**
 * Result of SSH command execution
 */
export interface ExecResult {
  /** Command stdout */
  stdout: string;
  /** Command stderr */
  stderr: string;
  /** Command exit code */
  exitCode: number;
}

/**
 * Default connection timeout (30 seconds)
 */
const DEFAULT_CONNECT_TIMEOUT = 30000;

/**
 * Default command execution timeout (120 seconds)
 */
const DEFAULT_EXEC_TIMEOUT = 120000;

/**
 * SSH client with connection lifecycle management
 */
export class SSHClient {
  private client: Client | null = null;
  private connected = false;
  private readonly config: SSHConfig;

  constructor(config: SSHConfig) {
    this.config = {
      connectTimeout: DEFAULT_CONNECT_TIMEOUT,
      execTimeout: DEFAULT_EXEC_TIMEOUT,
      ...config,
    };
  }

  /**
   * Establishes SSH connection to the VPS
   *
   * @throws SSHConnectionError if connection fails
   * @throws SSHAuthenticationError if authentication fails
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return; // Already connected
    }

    // Load SSH private key
    let privateKey: Buffer;
    try {
      privateKey = await readFile(this.config.privateKeyPath);
    } catch (err) {
      throw new SSHAuthenticationError(
        this.config.host,
        this.config.privateKeyPath,
        `Failed to read SSH key: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Create SSH client
    this.client = new Client();

    // Set up connection configuration
    const connectConfig: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      privateKey,
      readyTimeout: this.config.connectTimeout,
    };

    // Connect with promise wrapper
    await new Promise<void>((resolve, reject) => {
      if (!this.client) {
        reject(new SSHConnectionError(this.config.host, 'Client not initialized'));
        return;
      }

      let resolved = false;

      // Success handler
      this.client.on('ready', () => {
        if (!resolved) {
          resolved = true;
          this.connected = true;
          resolve();
        }
      });

      // Error handler
      this.client.on('error', (err: Error) => {
        if (!resolved) {
          resolved = true;

          // Classify error type
          const errMsg = err.message.toLowerCase();

          if (errMsg.includes('getaddrinfo') || errMsg.includes('enotfound')) {
            reject(new SSHConnectionError(this.config.host, `Host not found: ${err.message}`));
          } else if (errMsg.includes('etimedout') || errMsg.includes('timeout')) {
            reject(
              new SSHConnectionError(
                this.config.host,
                `Connection timeout after ${this.config.connectTimeout}ms: ${err.message}`
              )
            );
          } else if (errMsg.includes('econnrefused')) {
            reject(new SSHConnectionError(this.config.host, `Connection refused: ${err.message}`));
          } else if (
            errMsg.includes('auth') ||
            errMsg.includes('permission') ||
            errMsg.includes('publickey')
          ) {
            reject(
              new SSHAuthenticationError(
                this.config.host,
                this.config.privateKeyPath,
                `Authentication failed: ${err.message}`
              )
            );
          } else {
            reject(new SSHConnectionError(this.config.host, err.message));
          }
        }
      });

      // Timeout handler
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(
            new SSHConnectionError(
              this.config.host,
              `Connection timeout after ${this.config.connectTimeout}ms`
            )
          );
        }
      }, this.config.connectTimeout);

      // Initiate connection
      try {
        this.client.connect(connectConfig);
      } catch (err) {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(
            new SSHConnectionError(
              this.config.host,
              `Failed to initiate connection: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        }
      }
    });
  }

  /**
   * Executes a command on the VPS via SSH
   *
   * @param command - Shell command to execute
   * @param timeout - Command timeout in milliseconds (optional, uses config default)
   * @returns Execution result with stdout, stderr, and exit code
   * @throws SSHCommandError if command fails (non-zero exit code)
   * @throws SSHTimeoutError if command times out
   * @throws SSHError if not connected
   */
  async exec(command: string, timeout?: number): Promise<ExecResult> {
    if (!this.connected || !this.client) {
      throw new SSHError('Not connected to VPS. Call connect() first.', this.config.host, 'exec');
    }

    const execTimeout = timeout ?? this.config.execTimeout ?? DEFAULT_EXEC_TIMEOUT;

    return new Promise<ExecResult>((resolve, reject) => {
      if (!this.client) {
        reject(new SSHError('SSH client not available', this.config.host, 'exec'));
        return;
      }

      let resolved = false;
      let stdout = '';
      let stderr = '';

      // Timeout handler
      const timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new SSHTimeoutError(this.config.host, command, execTimeout));
        }
      }, execTimeout);

      this.client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeoutHandle);
          if (!resolved) {
            resolved = true;
            reject(
              new SSHError(
                `Failed to execute command: ${err.message}`,
                this.config.host,
                'exec'
              )
            );
          }
          return;
        }

        // Collect stdout
        stream.on('data', (data: Buffer) => {
          stdout += data.toString('utf-8');
        });

        // Collect stderr
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf-8');
        });

        // Handle command completion
        stream.on('close', (code: number) => {
          clearTimeout(timeoutHandle);
          if (!resolved) {
            resolved = true;

            const result: ExecResult = {
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode: code ?? 0,
            };

            resolve(result);
          }
        });

        // Handle stream errors
        stream.on('error', (streamErr: Error) => {
          clearTimeout(timeoutHandle);
          if (!resolved) {
            resolved = true;
            reject(
              new SSHError(
                `Stream error during command execution: ${streamErr.message}`,
                this.config.host,
                'exec'
              )
            );
          }
        });
      });
    });
  }

  /**
   * Disconnects from the VPS
   */
  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Checks if currently connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Gets the host this client is configured for
   */
  getHost(): string {
    return this.config.host;
  }
}

/**
 * Executes a command with automatic connection management
 *
 * Connects, executes the command, and disconnects automatically.
 * Uses retry logic for transient failures.
 *
 * @param config - SSH configuration
 * @param command - Command to execute
 * @returns Execution result
 */
export async function execWithRetry(
  config: SSHConfig,
  command: string,
  maxRetries = 3
): Promise<ExecResult> {
  let lastError: Error | null = null;
  const delays = [1000, 2000, 4000]; // Exponential backoff delays

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const client = new SSHClient(config);

    try {
      await client.connect();
      const result = await client.exec(command);
      client.disconnect();
      return result;
    } catch (err) {
      client.disconnect();
      lastError = err as Error;

      // Don't retry authentication errors (not transient)
      if (err instanceof SSHAuthenticationError) {
        throw err;
      }

      // Don't retry command errors (not transient)
      if (err instanceof SSHCommandError) {
        throw err;
      }

      // Retry connection errors
      if (attempt < maxRetries) {
        const delay = delays[attempt] || 4000;
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms delay...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted
  throw lastError || new SSHError('Command failed after retries', config.host, 'exec');
}

/**
 * SSH and Docker error types
 *
 * Provides structured error classes with actionable messages for troubleshooting.
 */

/**
 * Base error for SSH operations
 */
export class SSHError extends Error {
  constructor(
    message: string,
    public readonly host: string,
    public readonly operation: string,
    public readonly timestamp: string = new Date().toISOString()
  ) {
    super(message);
    this.name = 'SSHError';
  }
}

/**
 * SSH connection failure (network, timeout, host not found)
 */
export class SSHConnectionError extends SSHError {
  constructor(host: string, cause: string) {
    const message =
      `Failed to connect to VPS: ${host}\n` +
      `Cause: ${cause}\n\n` +
      `Troubleshooting:\n` +
      `  1. Verify the VPS is running and accessible\n` +
      `  2. Check network connectivity: ping ${host}\n` +
      `  3. Verify firewall rules allow SSH (port 22)\n` +
      `  4. Ensure SSH service is running on the VPS`;

    super(message, host, 'connect');
    this.name = 'SSHConnectionError';
  }
}

/**
 * SSH authentication failure (key rejected, permissions wrong)
 */
export class SSHAuthenticationError extends SSHError {
  constructor(host: string, keyPath: string, cause: string) {
    const message =
      `SSH authentication failed for ${host}\n` +
      `Key: ${keyPath}\n` +
      `Cause: ${cause}\n\n` +
      `Troubleshooting:\n` +
      `  1. Verify SSH key exists: ls -la ${keyPath}\n` +
      `  2. Check key permissions: chmod 600 ${keyPath}\n` +
      `  3. Ensure public key is in VPS ~/.ssh/authorized_keys\n` +
      `  4. Test manually: ssh -i ${keyPath} <user>@${host}`;

    super(message, host, 'authenticate', new Date().toISOString());
    this.name = 'SSHAuthenticationError';
  }
}

/**
 * SSH command execution failure (non-zero exit code)
 */
export class SSHCommandError extends SSHError {
  constructor(
    host: string,
    command: string,
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    const message =
      `Command failed on VPS: ${host}\n` +
      `Command: ${command}\n` +
      `Exit Code: ${exitCode}\n` +
      `Error Output:\n${stderr || '(no error output)'}`;

    super(message, host, 'exec');
    this.name = 'SSHCommandError';
  }
}

/**
 * SSH command timeout
 */
export class SSHTimeoutError extends SSHError {
  constructor(host: string, command: string, timeout: number) {
    const message =
      `Command timed out on VPS: ${host}\n` +
      `Command: ${command}\n` +
      `Timeout: ${timeout}ms\n\n` +
      `The command took longer than the configured timeout.\n` +
      `Consider increasing the timeout or investigating the VPS performance.`;

    super(message, host, 'exec');
    this.name = 'SSHTimeoutError';
  }
}

/**
 * Docker-related error
 */
export class DockerError extends Error {
  constructor(
    message: string,
    public readonly host: string,
    public readonly operation: string,
    public readonly timestamp: string = new Date().toISOString()
  ) {
    super(message);
    this.name = 'DockerError';
  }
}

/**
 * Docker not installed
 */
export class DockerNotInstalledError extends DockerError {
  constructor(host: string) {
    const message =
      `Docker is not installed on VPS: ${host}\n\n` +
      `DBX can automatically install Docker for you.\n` +
      `The installation requires sudo access on the VPS.`;

    super(message, host, 'check-installed');
    this.name = 'DockerNotInstalledError';
  }
}

/**
 * Docker installation failed
 */
export class DockerInstallationError extends DockerError {
  constructor(host: string, cause: string, stderr: string) {
    const message =
      `Failed to install Docker on VPS: ${host}\n` +
      `Cause: ${cause}\n` +
      `Error Output:\n${stderr}\n\n` +
      `Troubleshooting:\n` +
      `  1. Ensure the VPS user has sudo access\n` +
      `  2. Check VPS internet connectivity\n` +
      `  3. Try manual installation: https://docs.docker.com/engine/install/\n` +
      `  4. Check disk space: df -h`;

    super(message, host, 'install');
    this.name = 'DockerInstallationError';
  }
}

/**
 * Docker daemon not running
 */
export class DockerDaemonError extends DockerError {
  constructor(host: string, cause: string) {
    const message =
      `Docker daemon is not responding on VPS: ${host}\n` +
      `Cause: ${cause}\n\n` +
      `Troubleshooting:\n` +
      `  1. Check Docker service status: sudo systemctl status docker\n` +
      `  2. Start Docker service: sudo systemctl start docker\n` +
      `  3. Enable Docker on boot: sudo systemctl enable docker\n` +
      `  4. Check Docker logs: sudo journalctl -u docker`;

    super(message, host, 'daemon-check');
    this.name = 'DockerDaemonError';
  }
}

/**
 * Docker version incompatible
 */
export class DockerVersionError extends DockerError {
  constructor(host: string, version: string, minVersion: string) {
    const message =
      `Docker version on VPS is too old: ${host}\n` +
      `Installed: ${version}\n` +
      `Minimum Required: ${minVersion}\n\n` +
      `Please upgrade Docker:\n` +
      `  https://docs.docker.com/engine/install/`;

    super(message, host, 'version-check');
    this.name = 'DockerVersionError';
  }
}

/**
 * Docker permission error
 */
export class DockerPermissionError extends DockerError {
  constructor(host: string, user: string) {
    const message =
      `User "${user}" cannot run Docker commands on VPS: ${host}\n\n` +
      `The user needs to be added to the docker group:\n` +
      `  sudo usermod -aG docker ${user}\n` +
      `  # Then log out and back in for changes to take effect\n\n` +
      `Or run Docker commands with sudo (not recommended for DBX).`;

    super(message, host, 'permission-check', new Date().toISOString());
    this.name = 'DockerPermissionError';
  }
}

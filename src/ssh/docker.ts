/**
 * Docker detection, installation, and health checks
 *
 * Handles ensuring Docker is present and running on the VPS before database operations.
 */

import { SSHClient, SSHConfig } from './client.js';
import {
  DockerInstallationError,
  DockerDaemonError,
  SSHCommandError,
} from './errors.js';

/**
 * Minimum Docker version required
 */
const MIN_DOCKER_VERSION = '20.10';

/**
 * Docker version check result
 */
export interface DockerVersion {
  /** Full version string */
  version: string;
  /** Major version number */
  major: number;
  /** Minor version number */
  minor: number;
}

/**
 * Parses Docker version from `docker --version` output
 *
 * Example output: "Docker version 24.0.7, build afdd53b"
 *
 * @param output - Output from `docker --version`
 * @returns Parsed version or null if parsing fails
 */
export function parseDockerVersion(output: string): DockerVersion | null {
  const match = output.match(/Docker version (\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);

  return {
    version: match[0].replace('Docker version ', ''),
    major,
    minor,
  };
}

/**
 * Compares two Docker versions
 *
 * @returns true if actual >= minimum
 */
export function isVersionCompatible(actual: DockerVersion, minimum: string): boolean {
  const [minMajor, minMinor] = minimum.split('.').map((v) => parseInt(v, 10));

  if (actual.major > minMajor) {
    return true;
  }

  if (actual.major === minMajor && actual.minor >= minMinor) {
    return true;
  }

  return false;
}

/**
 * Checks if Docker is installed on the VPS
 *
 * @param client - Connected SSH client
 * @returns Docker version info or null if not installed
 */
export async function checkDockerInstalled(client: SSHClient): Promise<DockerVersion | null> {
  try {
    const result = await client.exec('docker --version');

    if (result.exitCode === 0) {
      const version = parseDockerVersion(result.stdout);
      if (version) {
        return version;
      }

      // Version command succeeded but couldn't parse - log warning
      console.warn(`Warning: Could not parse Docker version from: ${result.stdout}`);
      console.warn('Assuming Docker is installed but version is unknown');

      // Return a permissive version to allow continuation
      return {
        version: 'unknown',
        major: 99,
        minor: 0,
      };
    }

    return null;
  } catch (err) {
    // Command not found or other error - assume Docker not installed
    if (err instanceof SSHCommandError && err.stderr.includes('command not found')) {
      return null;
    }

    // Try fallback check with `which docker`
    try {
      const whichResult = await client.exec('which docker');
      if (whichResult.exitCode === 0 && whichResult.stdout) {
        // Docker binary exists but --version failed - unusual but continue
        console.warn('Docker binary found but version check failed');
        return {
          version: 'unknown',
          major: 99,
          minor: 0,
        };
      }
    } catch {
      // Ignore fallback errors
    }

    return null;
  }
}

/**
 * Installs Docker on the VPS using the official installation script
 *
 * @param client - Connected SSH client
 * @throws DockerInstallationError if installation fails
 */
export async function installDocker(client: SSHClient): Promise<void> {
  console.log('Downloading Docker installer...');

  // Download installer
  try {
    await client.exec('curl -fsSL https://get.docker.com -o get-docker.sh');
  } catch (err) {
    throw new DockerInstallationError(
      client.getHost(),
      'Failed to download Docker installer',
      err instanceof SSHCommandError ? err.stderr : String(err)
    );
  }

  console.log('Installing Docker (this may take a few minutes)...');

  // Run installer with sudo
  try {
    const result = await client.exec('sudo sh get-docker.sh', 300000); // 5 minute timeout

    if (result.exitCode !== 0) {
      throw new DockerInstallationError(
        client.getHost(),
        'Docker installation script failed',
        result.stderr
      );
    }

    console.log('Docker installation completed');
  } catch (err) {
    if (err instanceof DockerInstallationError) {
      throw err;
    }

    throw new DockerInstallationError(
      client.getHost(),
      'Installation error',
      err instanceof SSHCommandError ? err.stderr : String(err)
    );
  } finally {
    // Clean up installer script
    try {
      await client.exec('rm -f get-docker.sh');
    } catch {
      // Non-fatal
      console.warn('Warning: Failed to remove Docker installer script');
    }
  }

  console.log('Verifying installation...');

  // Verify installation
  const version = await checkDockerInstalled(client);
  if (!version) {
    throw new DockerInstallationError(
      client.getHost(),
      'Docker installation verification failed',
      'docker --version returned no output after installation'
    );
  }

  console.log(`Docker ${version.version} installed successfully`);
}

/**
 * Checks if Docker daemon is running
 *
 * @param client - Connected SSH client
 * @returns true if daemon is responsive
 */
export async function checkDockerDaemon(client: SSHClient): Promise<boolean> {
  try {
    const result = await client.exec('docker ps', 10000);
    return result.exitCode === 0;
  } catch (err) {
    return false;
  }
}

/**
 * Attempts to start the Docker daemon
 *
 * @param client - Connected SSH client
 * @throws DockerDaemonError if start fails
 */
export async function startDockerDaemon(client: SSHClient): Promise<void> {
  console.log('Attempting to start Docker daemon...');

  try {
    await client.exec('sudo systemctl start docker');
    console.log('Docker daemon started');

    // Wait a moment for daemon to be ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify daemon is now running
    const isRunning = await checkDockerDaemon(client);
    if (!isRunning) {
      throw new DockerDaemonError(
        client.getHost(),
        'Docker daemon started but is not responding to commands'
      );
    }
  } catch (err) {
    if (err instanceof DockerDaemonError) {
      throw err;
    }

    throw new DockerDaemonError(
      client.getHost(),
      `Failed to start Docker daemon: ${err instanceof SSHCommandError ? err.stderr : String(err)}`
    );
  }
}

/**
 * Checks and fixes Docker permissions for the current user
 *
 * @param client - Connected SSH client
 * @param username - VPS username
 */
export async function ensureDockerPermissions(client: SSHClient, username: string): Promise<void> {
  console.log('Checking Docker permissions...');

  try {
    // Try running docker ps without sudo
    const result = await client.exec('docker ps', 5000);

    if (result.exitCode === 0) {
      // Permissions are fine
      return;
    }

    // Check if error is permission-related
    if (
      result.stderr.includes('permission denied') ||
      result.stderr.includes('Cannot connect to the Docker daemon')
    ) {
      console.log(`Adding user "${username}" to docker group...`);

      // Add user to docker group
      await client.exec(`sudo usermod -aG docker ${username}`);

      console.log(
        `User added to docker group. Note: You may need to log out and back in for changes to take effect.`
      );
      console.log(`For now, commands will use sudo when needed.`);
    }
  } catch (err) {
    // Non-fatal - we'll handle permission errors when they occur
    console.warn('Warning: Could not verify Docker permissions');
  }
}

/**
 * Ensures Docker is ready for use on the VPS
 *
 * Orchestrates: installation check → install if needed → daemon check → version check → permissions
 *
 * @param sshConfig - SSH configuration
 * @param username - VPS username (for permission checks)
 * @throws Various Docker errors if any step fails
 */
export async function ensureDockerReady(sshConfig: SSHConfig, username: string): Promise<void> {
  const client = new SSHClient(sshConfig);

  try {
    // Connect
    console.log(`Connecting to VPS: ${sshConfig.host}...`);
    await client.connect();
    console.log('Connected');

    // Check if Docker is installed
    console.log('Checking Docker installation...');
    let version = await checkDockerInstalled(client);

    if (!version) {
      console.log('Docker not found - installing automatically...');
      await installDocker(client);

      // Re-check version after installation
      version = await checkDockerInstalled(client);
      if (!version) {
        throw new DockerInstallationError(
          sshConfig.host,
          'Installation completed but Docker still not found',
          ''
        );
      }
    } else {
      console.log(`Docker ${version.version} detected`);
    }

    // Check version compatibility (warning only)
    if (version.version !== 'unknown' && !isVersionCompatible(version, MIN_DOCKER_VERSION)) {
      console.warn(
        `Warning: Docker version ${version.version} is below recommended minimum ${MIN_DOCKER_VERSION}`
      );
      console.warn('Consider upgrading Docker for best compatibility');
    }

    // Check daemon
    console.log('Checking Docker daemon...');
    let daemonRunning = await checkDockerDaemon(client);

    if (!daemonRunning) {
      console.log('Docker daemon not running - attempting to start...');
      await startDockerDaemon(client);
      daemonRunning = true;
    } else {
      console.log('Docker daemon is running');
    }

    // Check permissions
    await ensureDockerPermissions(client, username);

    console.log('Docker is ready');
  } finally {
    client.disconnect();
  }
}

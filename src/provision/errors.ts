/**
 * Provisioning error types
 *
 * Custom error classes for different provisioning failure modes.
 */

/**
 * Base provisioning error
 */
export class ProvisioningError extends Error {
  constructor(
    message: string,
    public readonly step: string,
    public readonly timestamp: string = new Date().toISOString()
  ) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

/**
 * Docker volume creation failed
 */
export class VolumeCreationError extends ProvisioningError {
  constructor(volumeName: string, cause: string) {
    const message =
      `Failed to create Docker volume: ${volumeName}\n` +
      `Cause: ${cause}\n\n` +
      `Troubleshooting:\n` +
      `  1. Check VPS disk space: df -h\n` +
      `  2. Check Docker service: sudo systemctl status docker\n` +
      `  3. Try manually: docker volume create ${volumeName}`;

    super(message, 'volume-creation');
    this.name = 'VolumeCreationError';
  }
}

/**
 * MongoDB container failed to start
 */
export class ContainerStartError extends ProvisioningError {
  constructor(containerName: string, cause: string, logs?: string) {
    let message =
      `Failed to start MongoDB container: ${containerName}\n` +
      `Cause: ${cause}\n`;

    if (logs) {
      message += `\nContainer logs:\n${logs}\n`;
    }

    message +=
      `\nTroubleshooting:\n` +
      `  1. Check if port is already in use: netstat -tlnp | grep <port>\n` +
      `  2. Check Docker daemon: sudo systemctl status docker\n` +
      `  3. Check container logs: docker logs ${containerName}\n` +
      `  4. Remove failed container: docker rm ${containerName}`;

    super(message, 'container-start');
    this.name = 'ContainerStartError';
  }
}

/**
 * MongoDB user creation failed
 */
export class UserCreationError extends ProvisioningError {
  constructor(username: string, cause: string) {
    const message =
      `Failed to create MongoDB user: ${username}\n` +
      `Cause: ${cause}\n\n` +
      `Troubleshooting:\n` +
      `  1. Verify MongoDB is running: docker ps\n` +
      `  2. Check if root credentials are correct\n` +
      `  3. Try connecting manually: docker exec <container> mongosh\n` +
      `  4. Check MongoDB logs: docker logs <container>`;

    super(message, 'user-creation');
    this.name = 'UserCreationError';
  }
}

/**
 * State synchronization failed
 */
export class StateSyncError extends ProvisioningError {
  constructor(stateType: 'local' | 'remote', cause: string) {
    const message =
      `Failed to update ${stateType} state file\n` +
      `Cause: ${cause}\n\n` +
      `Troubleshooting:\n` +
      stateType === 'local'
        ? `  1. Check local disk space: df -h\n` +
          `  2. Check .dbx/ directory permissions\n` +
          `  3. Verify you have write access to current directory`
        : `  1. Check VPS SSH connectivity\n` +
          `  2. Verify /var/lib/dbx/ directory exists\n` +
          `  3. Check VPS disk space: df -h\n` +
          `  4. Verify write permissions on VPS`;

    super(message, `${stateType}-state-sync`);
    this.name = 'StateSyncError';
  }
}

/**
 * Instance already exists
 */
export class InstanceExistsError extends ProvisioningError {
  constructor(project: string, env: string, public readonly connectionURI: string) {
    const message =
      `Instance already exists: ${project}/${env}\n\n` +
      `Connection URI:\n${connectionURI}\n\n` +
      `To destroy and recreate: dbx destroy ${env}`;

    super(message, 'instance-check');
    this.name = 'InstanceExistsError';
  }
}

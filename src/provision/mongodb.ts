/**
 * MongoDB container management
 *
 * Handles Docker volume creation, MongoDB image pulling, container lifecycle, and health checks.
 */

import type { SSHClient } from '../ssh/client.js';

/**
 * MongoDB container configuration
 */
export interface MongoContainerOptions {
  /** Container name */
  containerName: string;
  /** MongoDB Docker image tag (e.g., "mongo:7") */
  imageTag: string;
  /** Host port to bind */
  port: number;
  /** Docker volume name */
  volumeName: string;
  /** Root username */
  rootUsername: string;
  /** Root password */
  rootPassword: string;
}

/**
 * Creates a Docker volume for MongoDB data
 *
 * @param sshClient - Connected SSH client
 * @param volumeName - Name of the volume to create
 */
export async function createVolume(sshClient: SSHClient, volumeName: string): Promise<void> {
  console.log(`Creating Docker volume: ${volumeName}...`);

  try {
    // Check if volume already exists
    const checkResult = await sshClient.exec(`docker volume inspect ${volumeName}`);

    if (checkResult.exitCode === 0) {
      console.log(`Volume ${volumeName} already exists, reusing`);
      return;
    }
  } catch {
    // Volume doesn't exist, continue with creation
  }

  // Create the volume
  await sshClient.exec(`docker volume create ${volumeName}`);

  // Verify creation
  await sshClient.exec(`docker volume inspect ${volumeName}`);

  console.log(`✓ Volume created: ${volumeName}`);
}

/**
 * Pulls MongoDB Docker image if not already present
 *
 * @param sshClient - Connected SSH client
 * @param imageTag - Image tag to pull (e.g., "mongo:7")
 */
export async function pullMongoImage(sshClient: SSHClient, imageTag: string): Promise<void> {
  console.log(`Checking MongoDB image: ${imageTag}...`);

  try {
    // Check if image already exists
    const checkResult = await sshClient.exec(`docker image inspect ${imageTag}`);

    if (checkResult.exitCode === 0) {
      console.log(`Image ${imageTag} already present`);
      return;
    }
  } catch {
    // Image doesn't exist, need to pull
  }

  console.log(`Pulling MongoDB image: ${imageTag} (this may take a few minutes)...`);

  // Pull the image (can take a while)
  await sshClient.exec(`docker pull ${imageTag}`, 300000); // 5 minute timeout

  console.log(`✓ Image pulled: ${imageTag}`);
}

/**
 * Starts a MongoDB container
 *
 * @param sshClient - Connected SSH client
 * @param options - Container configuration
 */
export async function startMongoContainer(
  sshClient: SSHClient,
  options: MongoContainerOptions
): Promise<void> {
  console.log(`Starting MongoDB container: ${options.containerName}...`);

  // Build docker run command
  const cmd = [
    'docker run -d',
    `--name ${options.containerName}`,
    `--restart unless-stopped`,
    `-p ${options.port}:27017`,
    `-v ${options.volumeName}:/data/db`,
    `-e MONGO_INITDB_ROOT_USERNAME=${options.rootUsername}`,
    `-e MONGO_INITDB_ROOT_PASSWORD='${options.rootPassword.replace(/'/g, "'\\''")}'`,
    options.imageTag,
    `--bind_ip_all`,
  ].join(' ');

  try {
    await sshClient.exec(cmd);
  } catch (err) {
    // Check if it's a port conflict error
    if (err instanceof Error && err.message.includes('address already in use')) {
      throw new Error(
        `Port ${options.port} is already in use on VPS. ` +
          `Another process is using this port. ` +
          `Check with: docker ps | grep ${options.port}`
      );
    }

    throw err;
  }

  // Verify container is running
  const psResult = await sshClient.exec(`docker ps --filter name=${options.containerName} --format "{{.Names}}"`);

  if (!psResult.stdout.includes(options.containerName)) {
    // Container failed to start, get logs
    const logsResult = await sshClient.exec(`docker logs ${options.containerName}`);
    throw new Error(
      `MongoDB container failed to start.\n` +
        `Logs:\n${logsResult.stdout}\n${logsResult.stderr}`
    );
  }

  console.log(`✓ Container started: ${options.containerName}`);
}

/**
 * Waits for MongoDB to become ready to accept connections
 *
 * Polls with exponential backoff until MongoDB responds to ping command.
 *
 * @param sshClient - Connected SSH client
 * @param containerName - Name of the MongoDB container
 * @param timeout - Maximum time to wait in milliseconds (default: 30000)
 */
export async function waitForMongoReady(
  sshClient: SSHClient,
  containerName: string,
  rootUsername: string,
  rootPassword: string,
  timeout: number = 30000
): Promise<void> {
  console.log('Waiting for MongoDB to become ready...');

  const startTime = Date.now();
  let delay = 500; // Start with 500ms
  const maxDelay = 5000; // Max 5 seconds between polls

  while (Date.now() - startTime < timeout) {
    try {
      // Check if container is still running
      const psResult = await sshClient.exec(`docker ps --filter name=${containerName} --format "{{.Names}}"`);

      if (!psResult.stdout.includes(containerName)) {
        // Container crashed
        const logsResult = await sshClient.exec(`docker logs --tail 50 ${containerName}`);
        throw new Error(
          `MongoDB container crashed during startup.\n` +
            `Logs:\n${logsResult.stdout}\n${logsResult.stderr}`
        );
      }

      // Try to ping MongoDB
      const escapedPassword = rootPassword.replace(/'/g, "'\\''");
      const pingResult = await sshClient.exec(
        `docker exec ${containerName} mongosh --quiet -u ${rootUsername} -p '${escapedPassword}' --authenticationDatabase admin --eval "db.adminCommand({ ping: 1 })"`,
        10000 // 10 second timeout for each ping attempt
      );

      if (pingResult.exitCode === 0 && /ok\s*[:=]\s*1/i.test(pingResult.stdout)) {
        console.log('✓ MongoDB is ready');
        return;
      }
    } catch {
      // Not ready yet, continue polling
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Exponential backoff
    delay = Math.min(delay * 1.5, maxDelay);
  }

  // Timeout reached
  throw new Error(
    `MongoDB failed to become ready within ${timeout / 1000} seconds.\n` +
      `Check container logs: docker logs ${containerName}`
  );
}

/**
 * Checks if a container exists (running or stopped)
 *
 * @param sshClient - Connected SSH client
 * @param containerName - Container name to check
 * @returns true if container exists
 */
export async function containerExists(sshClient: SSHClient, containerName: string): Promise<boolean> {
  try {
    const result = await sshClient.exec(`docker ps -a --filter name=${containerName} --format "{{.Names}}"`);
    return result.stdout.trim() === containerName;
  } catch {
    return false;
  }
}

/**
 * Checks if a container is currently running
 *
 * @param sshClient - Connected SSH client
 * @param containerName - Container name to check
 * @returns true if container is running
 */
export async function isContainerRunning(sshClient: SSHClient, containerName: string): Promise<boolean> {
  try {
    const result = await sshClient.exec(`docker ps --filter name=${containerName} --format "{{.Names}}"`);
    return result.stdout.trim() === containerName;
  } catch {
    return false;
  }
}

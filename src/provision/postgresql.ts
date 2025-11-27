/**
 * PostgreSQL container management
 *
 * Handles Docker volume creation, PostgreSQL image pulling, container lifecycle, and health checks.
 */

import type { SSHClient } from "../ssh/client.js";

/**
 * PostgreSQL container configuration
 */
export interface PostgresContainerOptions {
  /** Container name */
  containerName: string;
  /** PostgreSQL Docker image tag (e.g., "postgres:16") */
  imageTag: string;
  /** Host port to bind */
  port: number;
  /** Docker volume name */
  volumeName: string;
  /** Postgres superuser password (POSTGRES_PASSWORD) */
  rootPassword: string;
  /** Database name to create (POSTGRES_DB) */
  dbName: string;
}

/**
 * Creates a Docker volume for PostgreSQL data
 *
 * @param sshClient - Connected SSH client
 * @param volumeName - Name of the volume to create
 */
export async function createPostgresVolume(
  sshClient: SSHClient,
  volumeName: string
): Promise<void> {
  console.log(`Creating Docker volume: ${volumeName}...`);

  try {
    // Check if volume already exists
    const checkResult = await sshClient.exec(
      `docker volume inspect ${volumeName}`
    );

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
 * Pulls PostgreSQL Docker image if not already present
 *
 * @param sshClient - Connected SSH client
 * @param imageTag - Image tag to pull (e.g., "postgres:16")
 */
export async function pullPostgresImage(
  sshClient: SSHClient,
  imageTag: string
): Promise<void> {
  console.log(`Checking PostgreSQL image: ${imageTag}...`);

  try {
    // Check if image already exists
    const checkResult = await sshClient.exec(
      `docker image inspect ${imageTag}`
    );

    if (checkResult.exitCode === 0) {
      console.log(`Image ${imageTag} already present`);
      return;
    }
  } catch {
    // Image doesn't exist, need to pull
  }

  console.log(
    `Pulling PostgreSQL image: ${imageTag} (this may take a few minutes)...`
  );

  // Pull the image (can take a while)
  await sshClient.exec(`docker pull ${imageTag}`, 300000); // 5 minute timeout

  console.log(`✓ Image pulled: ${imageTag}`);
}

/**
 * Starts a PostgreSQL container
 *
 * @param sshClient - Connected SSH client
 * @param options - Container configuration
 */
export async function startPostgresContainer(
  sshClient: SSHClient,
  options: PostgresContainerOptions
): Promise<void> {
  console.log(`Starting PostgreSQL container: ${options.containerName}...`);

  // Build docker run command
  const cmd = [
    "docker run -d",
    `--name ${options.containerName}`,
    `--restart unless-stopped`,
    `-p ${options.port}:5432`,
    `-v ${options.volumeName}:/var/lib/postgresql/data`,
    `-e POSTGRES_PASSWORD='${options.rootPassword.replace(/'/g, "'\\''")}'`,
    `-e POSTGRES_DB=${options.dbName}`,
    options.imageTag,
  ].join(" ");

  try {
    await sshClient.exec(cmd);
  } catch (err) {
    // Check if it's a port conflict error
    if (
      err instanceof Error &&
      err.message.includes("address already in use")
    ) {
      throw new Error(
        `Port ${options.port} is already in use on VPS. ` +
          `Another process is using this port. ` +
          `Check with: docker ps | grep ${options.port}`
      );
    }

    throw err;
  }

  // Verify container is running
  const psResult = await sshClient.exec(
    `docker ps --filter name=${options.containerName} --format "{{.Names}}"`
  );

  if (!psResult.stdout.includes(options.containerName)) {
    // Container failed to start, get logs
    const logsResult = await sshClient.exec(
      `docker logs ${options.containerName}`
    );
    throw new Error(
      `PostgreSQL container failed to start.\n` +
        `Logs:\n${logsResult.stdout}\n${logsResult.stderr}`
    );
  }

  console.log(`✓ Container started: ${options.containerName}`);
}

/**
 * Waits for PostgreSQL to become ready to accept connections
 *
 * Polls with exponential backoff until PostgreSQL responds to pg_isready.
 *
 * @param sshClient - Connected SSH client
 * @param containerName - Name of the PostgreSQL container
 * @param timeout - Maximum time to wait in milliseconds (default: 30000)
 */
export async function waitForPostgresReady(
  sshClient: SSHClient,
  containerName: string,
  timeout: number = 30000
): Promise<void> {
  console.log("Waiting for PostgreSQL to become ready...");

  const startTime = Date.now();
  let delay = 500; // Start with 500ms
  const maxDelay = 5000; // Max 5 seconds between polls

  while (Date.now() - startTime < timeout) {
    try {
      // Check if container is still running
      const psResult = await sshClient.exec(
        `docker ps --filter name=${containerName} --format "{{.Names}}"`
      );

      if (!psResult.stdout.includes(containerName)) {
        // Container crashed
        const logsResult = await sshClient.exec(
          `docker logs --tail 50 ${containerName}`
        );
        throw new Error(
          `PostgreSQL container crashed during startup.\n` +
            `Logs:\n${logsResult.stdout}\n${logsResult.stderr}`
        );
      }

      // Try pg_isready
      const readyResult = await sshClient.exec(
        `docker exec ${containerName} pg_isready -U postgres`,
        10000 // 10 second timeout for each attempt
      );

      if (readyResult.exitCode === 0) {
        console.log("✓ PostgreSQL is ready");
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
    `PostgreSQL failed to become ready within ${timeout / 1000} seconds.\n` +
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
export async function postgresContainerExists(
  sshClient: SSHClient,
  containerName: string
): Promise<boolean> {
  try {
    const result = await sshClient.exec(
      `docker ps -a --filter name=${containerName} --format "{{.Names}}"`
    );
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
export async function isPostgresContainerRunning(
  sshClient: SSHClient,
  containerName: string
): Promise<boolean> {
  try {
    const result = await sshClient.exec(
      `docker ps --filter name=${containerName} --format "{{.Names}}"`
    );
    return result.stdout.trim() === containerName;
  } catch {
    return false;
  }
}

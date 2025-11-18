/**
 * MongoDB user creation
 *
 * Creates application users in MongoDB with least-privilege permissions.
 */

import type { SSHClient } from '../ssh/client.js';

/**
 * MongoDB user creation options
 */
export interface CreateUserOptions {
  /** MongoDB container name */
  containerName: string;
  /** MongoDB port (for connection URI) */
  port: number;
  /** Root username */
  rootUsername: string;
  /** Root password */
  rootPassword: string;
  /** Application username to create */
  appUsername: string;
  /** Application password */
  appPassword: string;
  /** Database name for application access */
  dbName: string;
}

/**
 * Creates an application user in MongoDB with readWrite permissions on a specific database
 *
 * @param sshClient - Connected SSH client
 * @param options - User creation options
 */
export async function createAppUser(sshClient: SSHClient, options: CreateUserOptions): Promise<void> {
  console.log(`Creating application user: ${options.appUsername}...`);
  // Port is used externally for host mapping; we always reach Mongo inside the container on 27017
  void options.port;

  // Build connection URI (connecting to admin database as root)
  const encodedRootUser = encodeURIComponent(options.rootUsername);
  const encodedRootPassword = encodeURIComponent(options.rootPassword);
  // Connect inside the container on the default Mongo port
  const connectionUri = `mongodb://${encodedRootUser}:${encodedRootPassword}@localhost:27017/admin`;

  // Build user creation JavaScript
  const userCreationScript = `
    try {
      db.createUser({
        user: "${options.appUsername}",
        pwd: "${options.appPassword.replace(/"/g, '\\"')}",
        roles: [
          { role: "readWrite", db: "${options.dbName}" }
        ]
      });
      print("User created successfully");
    } catch (err) {
      if (err.code === 51003) {
        // User already exists - this is OK (idempotent)
        print("User already exists");
      } else {
        throw err;
      }
    }
  `.trim();

  // Escape the script for shell execution
  const escapedScript = userCreationScript.replace(/'/g, "'\\''");

  // Build mongosh command
  const cmd = `docker exec ${options.containerName} mongosh '${connectionUri}' --quiet --eval '${escapedScript}'`;

  try {
    const result = await sshClient.exec(cmd, 15000); // 15 second timeout

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to create application user.\n` +
          `Exit code: ${result.exitCode}\n` +
          `Error: ${result.stderr}`
      );
    }

    // Check if output indicates success or user already exists
    if (result.stdout.includes('User created successfully') || result.stdout.includes('User already exists')) {
      console.log(`✓ Application user ready: ${options.appUsername}`);
      return;
    }

    // Unexpected output
    console.warn(`Warning: Unexpected output from user creation: ${result.stdout}`);
  } catch (err) {
    // Check if it's an authentication error
    if (err instanceof Error && err.message.includes('Authentication failed')) {
      throw new Error(
        `Failed to create application user: authentication failed.\n` +
          `The root password may be incorrect. ` +
          `This can happen if the container was created with different credentials.`
      );
    }

    throw err;
  }
}

/**
 * Verifies that a user can connect to MongoDB with given credentials
 *
 * @param sshClient - Connected SSH client
 * @param containerName - MongoDB container name
 * @param port - MongoDB port
 * @param username - Username to test
 * @param password - Password to test
 * @param dbName - Database to authenticate against
 * @returns true if authentication succeeds
 */
export async function verifyUserCredentials(
  sshClient: SSHClient,
  containerName: string,
  port: number,
  username: string,
  password: string,
  dbName: string
): Promise<boolean> {
  void port; // connecting inside container on 27017
  try {
    const encodedUser = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    const connectionUri = `mongodb://${encodedUser}:${encodedPassword}@localhost:27017/${dbName}?authSource=admin`;

    const result = await sshClient.exec(
      `docker exec ${containerName} mongosh '${connectionUri}' --quiet --eval 'db.runCommand({connectionStatus: 1})'`,
      10000
    );

    return result.exitCode === 0 && result.stdout.includes('"ok"');
  } catch {
    return false;
  }
}

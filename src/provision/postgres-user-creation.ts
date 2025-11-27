/**
 * PostgreSQL user creation
 *
 * Creates application users in PostgreSQL with least-privilege permissions.
 */

import type { SSHClient } from "../ssh/client.js";

/**
 * PostgreSQL user creation options
 */
export interface CreatePostgresUserOptions {
  /** PostgreSQL container name */
  containerName: string;
  /** Database name for application access */
  dbName: string;
  /** Application username to create */
  appUsername: string;
  /** Application password */
  appPassword: string;
}

/**
 * Creates an application user in PostgreSQL with permissions on a specific database
 *
 * @param sshClient - Connected SSH client
 * @param options - User creation options
 */
export async function createPostgresAppUser(
  sshClient: SSHClient,
  options: CreatePostgresUserOptions
): Promise<void> {
  console.log(`Creating application user: ${options.appUsername}...`);

  // Escape single quotes in password for SQL
  const escapedPassword = options.appPassword.replace(/'/g, "''");

  // Create user and grant permissions
  // Using postgres superuser (default user in container)
  const sql = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${options.appUsername}') THEN
        CREATE USER ${options.appUsername} WITH PASSWORD '${escapedPassword}';
        RAISE NOTICE 'User created successfully';
      ELSE
        ALTER USER ${options.appUsername} WITH PASSWORD '${escapedPassword}';
        RAISE NOTICE 'User already exists, password updated';
      END IF;
    END
    $$;
    GRANT CONNECT ON DATABASE ${options.dbName} TO ${options.appUsername};
    GRANT ALL PRIVILEGES ON DATABASE ${options.dbName} TO ${options.appUsername};
  `.trim();

  // Escape for shell
  const escapedSql = sql.replace(/'/g, "'\\''");

  // Execute via psql in container
  const cmd = `docker exec ${options.containerName} psql -U postgres -d ${options.dbName} -c '${escapedSql}'`;

  try {
    const result = await sshClient.exec(cmd, 15000); // 15 second timeout

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to create application user.\n` +
          `Exit code: ${result.exitCode}\n` +
          `Error: ${result.stderr}`
      );
    }

    console.log(`✓ Application user ready: ${options.appUsername}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("authentication failed")) {
      throw new Error(
        `Failed to create application user: authentication failed.\n` +
          `This can happen if the container was created with different credentials.`
      );
    }

    throw err;
  }
}

/**
 * Grants schema privileges to the application user
 * Required for the user to create tables and other objects
 *
 * @param sshClient - Connected SSH client
 * @param options - User creation options
 */
export async function grantPostgresSchemaPrivileges(
  sshClient: SSHClient,
  options: CreatePostgresUserOptions
): Promise<void> {
  console.log(`Granting schema privileges to: ${options.appUsername}...`);

  const sql = `
    GRANT USAGE ON SCHEMA public TO ${options.appUsername};
    GRANT CREATE ON SCHEMA public TO ${options.appUsername};
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${options.appUsername};
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${options.appUsername};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${options.appUsername};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${options.appUsername};
  `.trim();

  const escapedSql = sql.replace(/'/g, "'\\''");
  const cmd = `docker exec ${options.containerName} psql -U postgres -d ${options.dbName} -c '${escapedSql}'`;

  try {
    const result = await sshClient.exec(cmd, 15000);

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to grant schema privileges.\n` +
          `Exit code: ${result.exitCode}\n` +
          `Error: ${result.stderr}`
      );
    }

    console.log(`✓ Schema privileges granted to: ${options.appUsername}`);
  } catch (err) {
    throw err;
  }
}

/**
 * Verifies that a user can connect to PostgreSQL with given credentials
 *
 * @param sshClient - Connected SSH client
 * @param containerName - PostgreSQL container name
 * @param username - Username to test
 * @param password - Password to test
 * @param dbName - Database to connect to
 * @returns true if authentication succeeds
 */
export async function verifyPostgresUserCredentials(
  sshClient: SSHClient,
  containerName: string,
  username: string,
  password: string,
  dbName: string
): Promise<boolean> {
  try {
    // Use PGPASSWORD env var to pass password
    const escapedPassword = password.replace(/'/g, "'\\''");
    const cmd = `docker exec -e PGPASSWORD='${escapedPassword}' ${containerName} psql -U ${username} -d ${dbName} -c 'SELECT 1'`;

    const result = await sshClient.exec(cmd, 10000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

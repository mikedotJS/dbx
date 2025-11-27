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

  // Escape password for SQL (double single quotes)
  const sqlEscapedPassword = options.appPassword.replace(/'/g, "''");

  // Build SQL commands
  // Use simple CREATE/ALTER USER instead of DO block to avoid $$ escaping issues
  const checkUserSql = `SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${options.appUsername}'`;
  const createUserSql = `CREATE USER "${options.appUsername}" WITH PASSWORD '${sqlEscapedPassword}'`;
  const alterUserSql = `ALTER USER "${options.appUsername}" WITH PASSWORD '${sqlEscapedPassword}'`;
  const grantConnectSql = `GRANT CONNECT ON DATABASE "${options.dbName}" TO "${options.appUsername}"`;
  const grantPrivsSql = `GRANT ALL PRIVILEGES ON DATABASE "${options.dbName}" TO "${options.appUsername}"`;

  // Base64 encode the SQL to avoid all shell escaping issues
  const checkUserB64 = Buffer.from(checkUserSql).toString("base64");
  const createUserB64 = Buffer.from(createUserSql).toString("base64");
  const alterUserB64 = Buffer.from(alterUserSql).toString("base64");
  const grantConnectB64 = Buffer.from(grantConnectSql).toString("base64");
  const grantPrivsB64 = Buffer.from(grantPrivsSql).toString("base64");

  try {
    // Check if user exists
    const checkCmd = `echo '${checkUserB64}' | base64 -d | docker exec -i ${options.containerName} psql -h localhost -U postgres -d "${options.dbName}" -t`;
    const checkResult = await sshClient.exec(checkCmd, 15000);
    const userExists = checkResult.stdout.trim() === "1";

    // Create or update user
    const userCmd = userExists
      ? `echo '${alterUserB64}' | base64 -d | docker exec -i ${options.containerName} psql -h localhost -U postgres -d "${options.dbName}"`
      : `echo '${createUserB64}' | base64 -d | docker exec -i ${options.containerName} psql -h localhost -U postgres -d "${options.dbName}"`;

    const userResult = await sshClient.exec(userCmd, 15000);
    if (userResult.exitCode !== 0) {
      throw new Error(
        `Failed to ${userExists ? "update" : "create"} user.\n` +
          `Exit code: ${userResult.exitCode}\n` +
          `Error: ${userResult.stderr}`
      );
    }

    // Grant connect privilege
    const grantConnectCmd = `echo '${grantConnectB64}' | base64 -d | docker exec -i ${options.containerName} psql -h localhost -U postgres -d "${options.dbName}"`;
    const grantConnectResult = await sshClient.exec(grantConnectCmd, 15000);
    if (grantConnectResult.exitCode !== 0) {
      throw new Error(
        `Failed to grant connect privilege.\n` +
          `Exit code: ${grantConnectResult.exitCode}\n` +
          `Error: ${grantConnectResult.stderr}`
      );
    }

    // Grant all privileges
    const grantPrivsCmd = `echo '${grantPrivsB64}' | base64 -d | docker exec -i ${options.containerName} psql -h localhost -U postgres -d "${options.dbName}"`;
    const grantPrivsResult = await sshClient.exec(grantPrivsCmd, 15000);
    if (grantPrivsResult.exitCode !== 0) {
      throw new Error(
        `Failed to grant privileges.\n` +
          `Exit code: ${grantPrivsResult.exitCode}\n` +
          `Error: ${grantPrivsResult.stderr}`
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
    GRANT USAGE ON SCHEMA public TO "${options.appUsername}";
    GRANT CREATE ON SCHEMA public TO "${options.appUsername}";
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${options.appUsername}";
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${options.appUsername}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${options.appUsername}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${options.appUsername}";
  `.trim();

  // Base64 encode to avoid shell escaping issues
  const sqlB64 = Buffer.from(sql).toString("base64");
  const cmd = `echo '${sqlB64}' | base64 -d | docker exec -i ${options.containerName} psql -h localhost -U postgres -d "${options.dbName}"`;

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
    const cmd = `docker exec -e PGPASSWORD='${escapedPassword}' ${containerName} psql -h localhost -U "${username}" -d "${dbName}" -c 'SELECT 1'`;

    const result = await sshClient.exec(cmd, 10000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

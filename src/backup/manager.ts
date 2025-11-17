/**
 * Backup management
 *
 * Handles MongoDB backup and restore operations including directory management,
 * filename generation, mongodump execution, and mongorestore execution.
 */

import type { SSHClient } from '../ssh/client.js';
import type { InstanceMetadata } from '../state/schema.js';

/**
 * Backup directory path on VPS
 */
const BACKUP_DIR = '/var/lib/dbx/backups';

/**
 * Backup operation options
 */
export interface BackupOptions {
  /** Project name */
  project: string;
  /** Environment name */
  env: string;
  /** Instance metadata */
  metadata: InstanceMetadata;
  /** SSH client (must be connected) */
  sshClient: SSHClient;
}

/**
 * Backup result
 */
export interface BackupResult {
  /** Full path to backup file on VPS */
  filePath: string;
  /** Backup file size in bytes */
  fileSize: number;
  /** Timestamp when backup was created (ISO 8601) */
  timestamp: string;
}

/**
 * Backup error
 */
export class BackupError extends Error {
  constructor(
    message: string,
    public readonly step: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * Ensures the backup directory exists on the VPS
 *
 * @param sshClient - Connected SSH client
 */
export async function ensureBackupDirectory(sshClient: SSHClient): Promise<void> {
  try {
    // Check if directory exists
    const checkResult = await sshClient.exec(`test -d ${BACKUP_DIR}`);

    if (checkResult.exitCode === 0) {
      // Directory exists
      return;
    }
  } catch {
    // Directory doesn't exist, will create it
  }

  // Create directory with proper permissions
  try {
    await sshClient.exec(`mkdir -p ${BACKUP_DIR} && chmod 755 ${BACKUP_DIR}`);
    console.log(`Created backup directory: ${BACKUP_DIR}`);
  } catch (err) {
    throw new BackupError(
      `Failed to create backup directory: ${BACKUP_DIR}`,
      'directory-creation',
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Generates a timestamped backup filename
 *
 * Format: <project>_<env>-YYYY-MM-DDTHH-mm.dump
 *
 * @param project - Project name
 * @param env - Environment name
 * @param timestamp - ISO 8601 timestamp (defaults to now)
 * @returns Filename without path
 */
export function generateBackupFilename(project: string, env: string, timestamp?: string): string {
  const ts = timestamp || new Date().toISOString();

  // Format: YYYY-MM-DDTHH-mm
  const date = new Date(ts);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  const formattedTime = `${year}-${month}-${day}T${hours}-${minutes}`;

  return `${project}_${env}-${formattedTime}.dump`;
}

/**
 * Resolves filename conflicts by finding the first available increment
 *
 * @param sshClient - Connected SSH client
 * @param baseFilename - Base filename (e.g., "myapp_dev-2025-01-17T14-30.dump")
 * @returns Available filename (may include increment suffix like "-1.dump")
 */
export async function resolveFilenameConflict(
  sshClient: SSHClient,
  baseFilename: string
): Promise<string> {
  const fullPath = `${BACKUP_DIR}/${baseFilename}`;

  // Check if base filename exists
  try {
    const checkResult = await sshClient.exec(`test -f ${fullPath}`);

    if (checkResult.exitCode !== 0) {
      // File doesn't exist, use base filename
      return baseFilename;
    }
  } catch {
    // File doesn't exist, use base filename
    return baseFilename;
  }

  // File exists, try increments
  const extensionIndex = baseFilename.lastIndexOf('.dump');
  const nameWithoutExt = baseFilename.substring(0, extensionIndex);

  for (let i = 1; i <= 100; i++) {
    const candidateFilename = `${nameWithoutExt}-${i}.dump`;
    const candidatePath = `${BACKUP_DIR}/${candidateFilename}`;

    try {
      const checkResult = await sshClient.exec(`test -f ${candidatePath}`);

      if (checkResult.exitCode !== 0) {
        // File doesn't exist, use this filename
        return candidateFilename;
      }
    } catch {
      // File doesn't exist, use this filename
      return candidateFilename;
    }
  }

  // Couldn't find available filename after 100 attempts
  throw new BackupError(
    'Too many backup files with the same timestamp',
    'filename-conflict',
    'Consider manually cleaning up old backups'
  );
}

/**
 * Builds a MongoDB connection URI using root credentials for backup
 *
 * @param metadata - Instance metadata with root credentials
 * @returns MongoDB connection URI for localhost connection
 */
export function buildRootConnectionURI(metadata: InstanceMetadata): string {
  // URL-encode the root password
  const encodedPassword = encodeURIComponent(metadata.rootPassword);

  // Build URI for container-internal connection
  // Use localhost:27017 (MongoDB default port inside container)
  const uri = `mongodb://admin:${encodedPassword}@localhost:27017/${metadata.dbName}?authSource=admin`;

  return uri;
}

/**
 * Gets the size of a file on the VPS
 *
 * @param sshClient - Connected SSH client
 * @param filePath - Full path to file
 * @returns File size in bytes
 */
export async function getFileSize(sshClient: SSHClient, filePath: string): Promise<number> {
  try {
    const result = await sshClient.exec(`stat -f%z "${filePath}" 2>/dev/null || stat -c%s "${filePath}"`);

    if (result.exitCode !== 0) {
      throw new Error(`stat command failed: ${result.stderr}`);
    }

    const size = parseInt(result.stdout.trim(), 10);

    if (isNaN(size)) {
      throw new Error(`Invalid file size: ${result.stdout}`);
    }

    return size;
  } catch (err) {
    throw new BackupError(
      `Failed to get file size: ${filePath}`,
      'file-size',
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Formats file size in human-readable format
 *
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "145 MB", "2.3 GB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }

  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Creates a backup of a MongoDB instance
 *
 * @param options - Backup options
 * @returns Backup result with file path, size, and timestamp
 */
export async function createBackup(options: BackupOptions): Promise<BackupResult> {
  const { project, env, metadata, sshClient } = options;

  // Capture timestamp at start
  const timestamp = new Date().toISOString();

  console.log(`Creating backup for ${project}/${env}...`);

  // Ensure backup directory exists
  await ensureBackupDirectory(sshClient);

  // Generate filename
  const baseFilename = generateBackupFilename(project, env, timestamp);
  const filename = await resolveFilenameConflict(sshClient, baseFilename);
  const filePath = `${BACKUP_DIR}/${filename}`;

  console.log(`Backup file: ${filePath}`);

  // Build connection URI with root credentials
  const uri = buildRootConnectionURI(metadata);

  // Construct mongodump command
  // Run inside the container using docker exec
  const mongodumpCmd = `docker exec ${metadata.containerName} mongodump --uri "${uri}" --archive=${filePath}`;

  // Execute mongodump with extended timeout (5 minutes for large databases)
  console.log('Running mongodump...');

  try {
    const result = await sshClient.exec(mongodumpCmd, 300000); // 5 minute timeout

    if (result.exitCode !== 0) {
      // Check for common errors
      if (result.stderr.includes('No such container')) {
        throw new BackupError(
          `MongoDB container is not running: ${metadata.containerName}`,
          'container-not-running',
          "Run 'dbx up' to start the instance"
        );
      }

      if (result.stderr.includes('No space left')) {
        throw new BackupError(
          'Insufficient disk space on VPS',
          'disk-space',
          'Consider cleaning up old backups or expanding VPS storage'
        );
      }

      if (result.stderr.includes('Permission denied')) {
        throw new BackupError(
          'Permission denied writing backup file',
          'permissions',
          'Check directory permissions and SSH user privileges'
        );
      }

      throw new BackupError(
        'mongodump command failed',
        'mongodump-execution',
        result.stderr || result.stdout
      );
    }

    console.log('Backup completed, retrieving file size...');

    // Get file size
    const fileSize = await getFileSize(sshClient, filePath);

    return {
      filePath,
      fileSize,
      timestamp,
    };
  } catch (err) {
    if (err instanceof BackupError) {
      throw err;
    }

    // Check if it's a timeout error
    if (err instanceof Error && err.message.includes('timeout')) {
      throw new BackupError(
        'Backup operation timed out',
        'timeout',
        'The database may be too large. Consider increasing timeout or checking instance performance.'
      );
    }

    throw new BackupError(
      'Failed to create backup',
      'unknown',
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Restore operation options
 */
export interface RestoreOptions {
  /** Backup file path (relative or absolute) */
  backupFile: string;
  /** Instance metadata */
  metadata: InstanceMetadata;
  /** SSH client (must be connected) */
  sshClient: SSHClient;
}

/**
 * Resolves a backup file path to an absolute path on VPS
 *
 * @param backupFile - Relative or absolute backup file path
 * @returns Absolute path on VPS
 */
export function resolveBackupPath(backupFile: string): string {
  // If path starts with /, treat as absolute
  if (backupFile.startsWith('/')) {
    return backupFile;
  }

  // Otherwise, treat as relative to backup directory
  return `${BACKUP_DIR}/${backupFile}`;
}

/**
 * Validates that a backup file exists on the VPS
 *
 * @param sshClient - Connected SSH client
 * @param filePath - Absolute path to backup file
 * @throws BackupError if file doesn't exist
 */
export async function validateBackupFile(sshClient: SSHClient, filePath: string): Promise<void> {
  try {
    const result = await sshClient.exec(`test -f "${filePath}"`);

    if (result.exitCode !== 0) {
      throw new BackupError(
        `Backup file not found: ${filePath}`,
        'file-not-found',
        'Check the path or list available backups in /var/lib/dbx/backups/'
      );
    }
  } catch (err) {
    if (err instanceof BackupError) {
      throw err;
    }

    throw new BackupError(
      `Failed to validate backup file: ${filePath}`,
      'validation-error',
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Restores a MongoDB backup to an instance
 *
 * @param options - Restore options
 */
export async function restoreBackup(options: RestoreOptions): Promise<void> {
  const { backupFile, metadata, sshClient } = options;

  // Resolve backup file path
  const filePath = resolveBackupPath(backupFile);

  console.log('Validating backup file...');

  // Validate file exists
  await validateBackupFile(sshClient, filePath);

  console.log(`Backup file found: ${filePath}`);

  // Build connection URI with root credentials
  const uri = buildRootConnectionURI(metadata);

  // Construct mongorestore command
  // Run inside the container using docker exec
  const mongorestoreCmd = `docker exec ${metadata.containerName} mongorestore --uri "${uri}" --archive="${filePath}" --drop`;

  // Execute mongorestore with extended timeout (5 minutes for large databases)
  console.log('Running mongorestore...');

  try {
    const result = await sshClient.exec(mongorestoreCmd, 300000); // 5 minute timeout

    if (result.exitCode !== 0) {
      // Check for common errors
      if (result.stderr.includes('No such container')) {
        throw new BackupError(
          `MongoDB container is not running: ${metadata.containerName}`,
          'container-not-running',
          "Run 'dbx up' to start the instance"
        );
      }

      if (result.stderr.includes('No space left')) {
        throw new BackupError(
          'Insufficient disk space on VPS',
          'disk-space',
          'Consider expanding VPS storage or cleaning up data'
        );
      }

      if (result.stderr.includes('Permission denied')) {
        throw new BackupError(
          'Permission denied reading backup file',
          'permissions',
          'Check file permissions and SSH user privileges'
        );
      }

      if (result.stderr.includes('error reading archive') || result.stderr.includes('invalid') || result.stderr.includes('corrupt')) {
        throw new BackupError(
          'Corrupted or invalid backup file',
          'corrupted-backup',
          'Verify the backup file integrity or try a different backup'
        );
      }

      throw new BackupError(
        'mongorestore command failed',
        'mongorestore-execution',
        result.stderr || result.stdout
      );
    }

    console.log('Restore completed successfully');
  } catch (err) {
    if (err instanceof BackupError) {
      throw err;
    }

    // Check if it's a timeout error
    if (err instanceof Error && err.message.includes('timeout')) {
      throw new BackupError(
        'Restore operation timed out',
        'timeout',
        'The backup file may be too large. Consider increasing timeout or checking instance performance.'
      );
    }

    throw new BackupError(
      'Failed to restore backup',
      'unknown',
      err instanceof Error ? err.message : String(err)
    );
  }
}

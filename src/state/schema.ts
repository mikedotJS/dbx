/**
 * State schema for DBX
 *
 * Defines the structure of .dbx/state.json for tracking provisioned instances.
 */

/**
 * Metadata for a provisioned MongoDB instance
 */
export interface InstanceMetadata {
  /** MongoDB port on VPS */
  port: number;
  /** Database name */
  dbName: string;
  /** MongoDB username (application user) */
  username: string;
  /** MongoDB password for application user (plaintext in MVP) */
  password: string;
  /** MongoDB root user password (plaintext in MVP) */
  rootPassword: string;
  /** Docker volume name */
  volume: string;
  /** Docker container name */
  containerName: string;
  /** ISO 8601 timestamp of instance creation */
  createdAt: string;
  /** ISO 8601 timestamp of last backup (optional) */
  lastBackup?: string;
}

/**
 * Complete state structure
 *
 * Maps instance keys (format: "<project>/<env>") to their metadata
 */
export interface DbxState {
  /** Map of instance key to metadata */
  instances: Record<string, InstanceMetadata>;
}

/**
 * State validation error
 */
export class StateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateValidationError';
  }
}

/**
 * Creates an empty state object
 */
export function createEmptyState(): DbxState {
  return {
    instances: {},
  };
}

/**
 * Validates instance key format
 *
 * @param key - Instance key to validate (should be "<project>/<env>")
 * @throws StateValidationError if format is invalid
 */
export function validateInstanceKey(key: string): void {
  const parts = key.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new StateValidationError(
      `Invalid instance key format: "${key}". Expected format: "<project>/<env>" (e.g., "my-app/dev")`
    );
  }
}

/**
 * Creates an instance key from project and environment
 *
 * @param project - Project name
 * @param env - Environment name
 * @returns Instance key in format "<project>/<env>"
 */
export function createInstanceKey(project: string, env: string): string {
  return `${project}/${env}`;
}

/**
 * Validates state object structure
 *
 * @param state - State object to validate
 * @throws StateValidationError if structure is invalid
 */
export function validateState(state: unknown): DbxState {
  if (!state || typeof state !== 'object') {
    throw new StateValidationError('State must be an object');
  }

  const st = state as Record<string, unknown>;

  if (!st.instances || typeof st.instances !== 'object') {
    throw new StateValidationError('State must contain an "instances" object');
  }

  const instances = st.instances as Record<string, unknown>;

  // Validate each instance entry
  for (const [key, value] of Object.entries(instances)) {
    validateInstanceKey(key);

    if (!value || typeof value !== 'object') {
      throw new StateValidationError(`Invalid instance metadata for "${key}": must be an object`);
    }

    const inst = value as Record<string, unknown>;

    // Required fields
    const requiredFields = ['port', 'dbName', 'username', 'password', 'rootPassword', 'volume', 'containerName', 'createdAt'];
    for (const field of requiredFields) {
      if (inst[field] === undefined) {
        throw new StateValidationError(`Missing required field "${field}" in instance "${key}"`);
      }
    }

    // Type validation
    if (typeof inst.port !== 'number') {
      throw new StateValidationError(`Invalid field "port" in instance "${key}": must be a number`);
    }

    for (const field of ['dbName', 'username', 'password', 'rootPassword', 'volume', 'containerName', 'createdAt']) {
      if (typeof inst[field] !== 'string') {
        throw new StateValidationError(`Invalid field "${field}" in instance "${key}": must be a string`);
      }
    }

    if (inst.lastBackup !== undefined && typeof inst.lastBackup !== 'string') {
      throw new StateValidationError(`Invalid field "lastBackup" in instance "${key}": must be a string if provided`);
    }
  }

  return state as DbxState;
}

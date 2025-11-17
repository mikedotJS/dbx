/**
 * Configuration schema for DBX
 *
 * Defines the structure of dbx.config.json with TypeScript interfaces
 * and validation logic.
 */

/**
 * VPS connection configuration
 */
export interface VpsConfig {
  /** VPS hostname or IP address */
  host: string;
  /** SSH username */
  user: string;
  /** Path to SSH private key (supports ~ for home directory) */
  sshKeyPath?: string;
  /** SSH port (default: 22) */
  port?: number;
}

/**
 * MongoDB configuration defaults
 */
export interface MongoDbConfig {
  /** MongoDB version (e.g., "7", "6.0") */
  version: string;
  /** Base port for MongoDB instances (first env will use this port) */
  basePort: number;
  /** Custom Docker image (optional, defaults to official mongo image) */
  image?: string;
}

/**
 * Complete DBX configuration
 */
export interface DbxConfig {
  /** Project name (used as namespace for instances) */
  project: string;
  /** Default environment name (e.g., "dev", "staging") */
  defaultEnv: string;
  /** VPS connection settings */
  vps: VpsConfig;
  /** MongoDB settings */
  mongodb: MongoDbConfig;
}

/**
 * Configuration validation error
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validates a configuration object against the schema
 *
 * @param config - Partial configuration object to validate
 * @returns Validated configuration
 * @throws ConfigValidationError if validation fails
 */
export function validateConfig(config: unknown): DbxConfig {
  if (!config || typeof config !== 'object') {
    throw new ConfigValidationError('Configuration must be an object');
  }

  const cfg = config as Record<string, unknown>;

  // Validate project
  if (!cfg.project || typeof cfg.project !== 'string' || cfg.project.trim() === '') {
    throw new ConfigValidationError('Missing or invalid required field: project (must be a non-empty string)');
  }

  // Validate defaultEnv
  if (!cfg.defaultEnv || typeof cfg.defaultEnv !== 'string' || cfg.defaultEnv.trim() === '') {
    throw new ConfigValidationError('Missing or invalid required field: defaultEnv (must be a non-empty string)');
  }

  // Validate vps object
  if (!cfg.vps || typeof cfg.vps !== 'object') {
    throw new ConfigValidationError('Missing or invalid required field: vps (must be an object)');
  }

  const vps = cfg.vps as Record<string, unknown>;

  if (!vps.host || typeof vps.host !== 'string' || vps.host.trim() === '') {
    throw new ConfigValidationError('Missing or invalid required field: vps.host (must be a non-empty string)');
  }

  if (!vps.user || typeof vps.user !== 'string' || vps.user.trim() === '') {
    throw new ConfigValidationError('Missing or invalid required field: vps.user (must be a non-empty string)');
  }

  if (vps.sshKeyPath !== undefined && typeof vps.sshKeyPath !== 'string') {
    throw new ConfigValidationError('Invalid field: vps.sshKeyPath (must be a string if provided)');
  }

  if (vps.port !== undefined && (typeof vps.port !== 'number' || vps.port < 1 || vps.port > 65535)) {
    throw new ConfigValidationError('Invalid field: vps.port (must be a number between 1 and 65535)');
  }

  // Validate mongodb object
  if (!cfg.mongodb || typeof cfg.mongodb !== 'object') {
    throw new ConfigValidationError('Missing or invalid required field: mongodb (must be an object)');
  }

  const mongodb = cfg.mongodb as Record<string, unknown>;

  if (!mongodb.version || typeof mongodb.version !== 'string' || mongodb.version.trim() === '') {
    throw new ConfigValidationError('Missing or invalid required field: mongodb.version (must be a non-empty string)');
  }

  // Validate MongoDB version format (simple check for numeric-like value)
  if (!/^\d+(\.\d+)?(\.\d+)?$/.test(mongodb.version)) {
    throw new ConfigValidationError(
      `Invalid field: mongodb.version (must be a valid version number like "7" or "6.0", got "${mongodb.version}")`
    );
  }

  if (typeof mongodb.basePort !== 'number') {
    throw new ConfigValidationError('Missing or invalid required field: mongodb.basePort (must be a number)');
  }

  if (mongodb.basePort < 1024 || mongodb.basePort > 65535) {
    throw new ConfigValidationError(
      `Invalid field: mongodb.basePort (must be between 1024 and 65535, got ${mongodb.basePort})`
    );
  }

  if (mongodb.image !== undefined && typeof mongodb.image !== 'string') {
    throw new ConfigValidationError('Invalid field: mongodb.image (must be a string if provided)');
  }

  // Return validated config
  return {
    project: cfg.project as string,
    defaultEnv: cfg.defaultEnv as string,
    vps: {
      host: vps.host as string,
      user: vps.user as string,
      sshKeyPath: vps.sshKeyPath as string | undefined,
      port: vps.port as number | undefined,
    },
    mongodb: {
      version: mongodb.version as string,
      basePort: mongodb.basePort as number,
      image: mongodb.image as string | undefined,
    },
  };
}

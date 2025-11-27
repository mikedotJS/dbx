/**
 * Database connection URI builder
 *
 * Builds standard connection URIs from instance metadata for MongoDB and PostgreSQL.
 */

import type { InstanceMetadata } from "../state/schema.js";
import { getInstanceType } from "../state/schema.js";

/**
 * Builds a MongoDB connection URI for an instance
 *
 * Format: mongodb://username:password@host:port/dbName?authSource=admin
 *
 * @param metadata - Instance metadata
 * @param vpsHost - VPS hostname or IP address
 * @returns MongoDB connection URI
 */
export function buildConnectionURI(
  metadata: InstanceMetadata,
  vpsHost: string
): string {
  // Build the URI with raw password (not URL-encoded for easy copy-paste)
  const uri = `mongodb://${metadata.username}:${metadata.password}@${vpsHost}:${metadata.port}/${metadata.dbName}?authSource=admin`;

  return uri;
}

/**
 * Validates that all required fields are present in metadata for URI building
 *
 * @param metadata - Instance metadata to validate
 * @throws Error if required fields are missing
 */
export function validateMetadataForURI(
  metadata: Partial<InstanceMetadata>
): void {
  const requiredFields: Array<keyof InstanceMetadata> = [
    "username",
    "password",
    "port",
    "dbName",
  ];

  for (const field of requiredFields) {
    if (!metadata[field]) {
      throw new Error(
        `Cannot build connection URI: missing required field "${field}"`
      );
    }
  }
}

/**
 * Builds a connection URI with validation
 *
 * @param metadata - Instance metadata
 * @param vpsHost - VPS hostname or IP address
 * @returns MongoDB connection URI
 * @throws Error if metadata is invalid
 */
export function buildConnectionURISafe(
  metadata: InstanceMetadata,
  vpsHost: string
): string {
  validateMetadataForURI(metadata);
  return buildConnectionURI(metadata, vpsHost);
}

/**
 * Builds a MongoDB connection URI with password masked
 *
 * Format: mongodb://username:***@host:port/dbName?authSource=admin
 *
 * @param metadata - Instance metadata
 * @param vpsHost - VPS hostname or IP address
 * @returns MongoDB connection URI with password replaced by ***
 */
export function buildConnectionURIMasked(
  metadata: InstanceMetadata,
  vpsHost: string
): string {
  // Build the URI with masked password
  const uri = `mongodb://${metadata.username}:***@${vpsHost}:${metadata.port}/${metadata.dbName}?authSource=admin`;

  return uri;
}

/**
 * Builds a PostgreSQL connection URI for an instance
 *
 * Format: postgresql://username:password@host:port/dbName
 *
 * @param metadata - Instance metadata
 * @param vpsHost - VPS hostname or IP address
 * @returns PostgreSQL connection URI
 */
export function buildPostgresConnectionURI(
  metadata: InstanceMetadata,
  vpsHost: string
): string {
  // Build the URI with raw password (not URL-encoded for easy copy-paste)
  const uri = `postgresql://${metadata.username}:${metadata.password}@${vpsHost}:${metadata.port}/${metadata.dbName}`;

  return uri;
}

/**
 * Builds a PostgreSQL connection URI with password masked
 *
 * Format: postgresql://username:***@host:port/dbName
 *
 * @param metadata - Instance metadata
 * @param vpsHost - VPS hostname or IP address
 * @returns PostgreSQL connection URI with password replaced by ***
 */
export function buildPostgresConnectionURIMasked(
  metadata: InstanceMetadata,
  vpsHost: string
): string {
  const uri = `postgresql://${metadata.username}:***@${vpsHost}:${metadata.port}/${metadata.dbName}`;

  return uri;
}

/**
 * Builds a connection URI based on instance type
 *
 * Automatically detects the database engine from instance metadata
 *
 * @param metadata - Instance metadata
 * @param vpsHost - VPS hostname or IP address
 * @returns Connection URI for the appropriate database engine
 */
export function buildConnectionURIAuto(
  metadata: InstanceMetadata,
  vpsHost: string
): string {
  const instanceType = getInstanceType(metadata);

  if (instanceType === "postgresql") {
    return buildPostgresConnectionURI(metadata, vpsHost);
  }

  return buildConnectionURI(metadata, vpsHost);
}

/**
 * Builds a masked connection URI based on instance type
 *
 * @param metadata - Instance metadata
 * @param vpsHost - VPS hostname or IP address
 * @returns Masked connection URI for the appropriate database engine
 */
export function buildConnectionURIMaskedAuto(
  metadata: InstanceMetadata,
  vpsHost: string
): string {
  const instanceType = getInstanceType(metadata);

  if (instanceType === "postgresql") {
    return buildPostgresConnectionURIMasked(metadata, vpsHost);
  }

  return buildConnectionURIMasked(metadata, vpsHost);
}

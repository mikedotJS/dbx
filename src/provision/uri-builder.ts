/**
 * MongoDB connection URI builder
 *
 * Builds standard MongoDB connection URIs from instance metadata.
 */

import type { InstanceMetadata } from '../state/schema.js';

/**
 * Builds a MongoDB connection URI for an instance
 *
 * Format: mongodb://username:password@host:port/dbName?authSource=admin
 *
 * @param metadata - Instance metadata
 * @param vpsHost - VPS hostname or IP address
 * @returns MongoDB connection URI
 */
export function buildConnectionURI(metadata: InstanceMetadata, vpsHost: string): string {
  // URL-encode the password to handle special characters
  const encodedPassword = encodeURIComponent(metadata.password);

  // Build the URI
  const uri = `mongodb://${metadata.username}:${encodedPassword}@${vpsHost}:${metadata.port}/${metadata.dbName}?authSource=admin`;

  return uri;
}

/**
 * Validates that all required fields are present in metadata for URI building
 *
 * @param metadata - Instance metadata to validate
 * @throws Error if required fields are missing
 */
export function validateMetadataForURI(metadata: Partial<InstanceMetadata>): void {
  const requiredFields: Array<keyof InstanceMetadata> = ['username', 'password', 'port', 'dbName'];

  for (const field of requiredFields) {
    if (!metadata[field]) {
      throw new Error(`Cannot build connection URI: missing required field "${field}"`);
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
export function buildConnectionURISafe(metadata: InstanceMetadata, vpsHost: string): string {
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
export function buildConnectionURIMasked(metadata: InstanceMetadata, vpsHost: string): string {
  // Build the URI with masked password
  const uri = `mongodb://${metadata.username}:***@${vpsHost}:${metadata.port}/${metadata.dbName}?authSource=admin`;

  return uri;
}

/**
 * Credential generation for MongoDB instances
 *
 * Generates cryptographically secure passwords for root and application users.
 */

import { randomBytes } from 'crypto';

/**
 * Character set for password generation (excludes ambiguous characters)
 */
const PASSWORD_CHARSET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';

/**
 * Minimum password length
 */
const MIN_PASSWORD_LENGTH = 16;

/**
 * Default password length
 */
const DEFAULT_PASSWORD_LENGTH = 32;

/**
 * Generates a cryptographically secure random password
 *
 * @param length - Password length (default: 32 characters)
 * @returns Generated password
 * @throws Error if length is less than minimum (16 characters)
 */
export function generatePassword(length: number = DEFAULT_PASSWORD_LENGTH): string {
  if (length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password length must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const randomValues = randomBytes(length);
  const password = Array.from(randomValues)
    .map((byte) => PASSWORD_CHARSET[byte % PASSWORD_CHARSET.length])
    .join('');

  return password;
}

/**
 * Validates that a password meets minimum security requirements
 *
 * @param password - Password to validate
 * @returns true if password meets requirements
 */
export function validatePassword(password: string): boolean {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return false;
  }

  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*]/.test(password);

  return hasLowercase && hasUppercase && hasDigit && hasSpecial;
}

/**
 * URL-encodes special characters in a password for use in connection URIs
 *
 * @param password - Password to encode
 * @returns URL-encoded password
 */
export function encodePasswordForURI(password: string): string {
  return encodeURIComponent(password);
}

/**
 * Generates credentials for a MongoDB instance
 *
 * @returns Object containing root and app user passwords
 */
export interface MongoDBCredentials {
  /** Root user password */
  rootPassword: string;
  /** Application user password */
  appPassword: string;
}

/**
 * Generates a complete set of credentials for a MongoDB instance
 *
 * @returns MongoDB credentials with root and app passwords
 */
export function generateMongoDBCredentials(): MongoDBCredentials {
  return {
    rootPassword: generatePassword(),
    appPassword: generatePassword(),
  };
}

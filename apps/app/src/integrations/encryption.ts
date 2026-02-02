/**
 * Encryption utilities for storing integration credentials securely
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'crypto';
import { getConfig } from '../config/env';
import type { IntegrationCredentials } from './types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT = 'skyplanner-integration-salt';

/**
 * Derive an encryption key from the JWT secret
 */
function deriveKey(): Buffer {
  const config = getConfig();
  return crypto.scryptSync(config.JWT_SECRET, SALT, 32);
}

/**
 * Encrypt integration credentials for secure storage
 * @param credentials The credentials to encrypt
 * @returns Encrypted string in format: iv:authTag:encrypted
 */
export async function encryptCredentials(
  credentials: IntegrationCredentials
): Promise<string> {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const jsonData = JSON.stringify(credentials);
  let encrypted = cipher.update(jsonData, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt integration credentials from storage
 * @param encryptedData The encrypted string from storage
 * @returns Decrypted credentials object
 */
export async function decryptCredentials(
  encryptedData: string
): Promise<IntegrationCredentials> {
  const key = deriveKey();

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  const credentials = JSON.parse(decrypted) as IntegrationCredentials;

  // Convert expiresAt back to Date if it exists
  if (credentials.expiresAt) {
    credentials.expiresAt = new Date(credentials.expiresAt);
  }

  return credentials;
}

/**
 * Check if credentials are expired
 * @param credentials The credentials to check
 * @returns true if expired or expiring soon (within 5 minutes)
 */
export function isCredentialsExpired(
  credentials: IntegrationCredentials
): boolean {
  if (!credentials.expiresAt) {
    return false; // No expiration = never expires
  }

  const expiresAt = new Date(credentials.expiresAt);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minute buffer

  return expiresAt.getTime() - bufferMs < now.getTime();
}

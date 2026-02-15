/**
 * JWT utilities for El-Kontroll platform
 * Used by both marketing site and main app for SSO
 */

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { JWTPayload, TokenOptions, VerifyResult } from './types';

/**
 * Signs a JWT token with the provided payload.
 * Auto-generates a JTI (unique token ID) if not provided.
 */
export function signToken(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  options: TokenOptions = {}
): string {
  const { expiresIn = '24h' } = options;
  const tokenPayload = { ...payload, jti: payload.jti || crypto.randomUUID() };
  return jwt.sign(tokenPayload, secret, {
    algorithm: 'HS256',
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Verifies and decodes a JWT token
 * Returns a structured result with success/error information
 */
export function verifyToken(token: string, secret: string): VerifyResult {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JWTPayload;
    return { success: true, payload };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { success: false, error: 'expired' };
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return { success: false, error: 'invalid' };
    }
    return { success: false, error: 'malformed' };
  }
}

/**
 * Decodes a JWT token without verifying the signature
 * Useful for reading token contents before verification
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.decode(token);
    return decoded as JWTPayload | null;
  } catch {
    return null;
  }
}

/**
 * Checks if a token is expired without throwing
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken(token);
  if (!decoded?.exp) return true;
  return decoded.exp * 1000 < Date.now();
}

/**
 * Gets the remaining time until token expiration in milliseconds
 * Returns 0 if already expired or invalid
 */
export function getTokenTTL(token: string): number {
  const decoded = decodeToken(token);
  if (!decoded?.exp) return 0;
  const remaining = decoded.exp * 1000 - Date.now();
  return Math.max(0, remaining);
}

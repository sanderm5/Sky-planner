/**
 * JWT utilities for El-Kontroll platform
 * Used by both marketing site and main app for SSO
 */
import type { JWTPayload, TokenOptions, VerifyResult } from './types';
/**
 * Signs a JWT token with the provided payload.
 * Auto-generates a JTI (unique token ID) if not provided.
 */
export declare function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string, options?: TokenOptions): string;
/**
 * Verifies and decodes a JWT token
 * Returns a structured result with success/error information
 */
export declare function verifyToken(token: string, secret: string): VerifyResult;
/**
 * Decodes a JWT token without verifying the signature
 * Useful for reading token contents before verification
 */
export declare function decodeToken(token: string): JWTPayload | null;
/**
 * Checks if a token is expired without throwing
 */
export declare function isTokenExpired(token: string): boolean;
/**
 * Gets the remaining time until token expiration in milliseconds
 * Returns 0 if already expired or invalid
 */
export declare function getTokenTTL(token: string): number;
//# sourceMappingURL=jwt.d.ts.map
/**
 * JWT utilities for El-Kontroll platform
 * Used by both marketing site and main app for SSO
 */
import type { JWTPayload, RefreshTokenPayload, TokenOptions, VerifyResult } from './types';
/**
 * Signs a JWT token with the provided payload.
 * Auto-generates a JTI (unique token ID) if not provided.
 */
export declare function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string, options?: TokenOptions): string;
/**
 * Signs a refresh token with minimal payload
 */
export declare function signRefreshToken(payload: Omit<RefreshTokenPayload, 'iat' | 'exp' | 'tokenType'>, secret: string, options?: TokenOptions): string;
/**
 * Verifies and decodes a JWT token
 * Returns a structured result with success/error information
 */
export declare function verifyToken(token: string, secret: string): VerifyResult;
/**
 * Verifies a JWT token, falling back to a previous secret if the primary fails.
 * Enables zero-downtime key rotation: deploy new JWT_SECRET while keeping
 * JWT_SECRET_PREVIOUS to verify tokens signed with the old key.
 */
export declare function verifyTokenWithFallback(token: string, primarySecret: string, previousSecret?: string): VerifyResult;
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
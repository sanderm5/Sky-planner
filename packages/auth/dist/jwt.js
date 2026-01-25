/**
 * JWT utilities for El-Kontroll platform
 * Used by both marketing site and main app for SSO
 */
import jwt from 'jsonwebtoken';
/**
 * Signs a JWT token with the provided payload
 */
export function signToken(payload, secret, options = {}) {
    const { expiresIn = '24h' } = options;
    return jwt.sign(payload, secret, {
        expiresIn: expiresIn,
    });
}
/**
 * Verifies and decodes a JWT token
 * Returns a structured result with success/error information
 */
export function verifyToken(token, secret) {
    try {
        const payload = jwt.verify(token, secret);
        return { success: true, payload };
    }
    catch (error) {
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
export function decodeToken(token) {
    try {
        const decoded = jwt.decode(token);
        return decoded;
    }
    catch {
        return null;
    }
}
/**
 * Checks if a token is expired without throwing
 */
export function isTokenExpired(token) {
    const decoded = decodeToken(token);
    if (!decoded?.exp)
        return true;
    return decoded.exp * 1000 < Date.now();
}
/**
 * Gets the remaining time until token expiration in milliseconds
 * Returns 0 if already expired or invalid
 */
export function getTokenTTL(token) {
    const decoded = decodeToken(token);
    if (!decoded?.exp)
        return 0;
    const remaining = decoded.exp * 1000 - Date.now();
    return Math.max(0, remaining);
}
//# sourceMappingURL=jwt.js.map
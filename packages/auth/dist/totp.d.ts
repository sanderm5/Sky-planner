/**
 * TOTP (Time-based One-Time Password) utilities for 2FA
 * Based on RFC 6238
 */
/**
 * Generate a random base32 secret for TOTP
 */
export declare function generateTOTPSecret(): string;
/**
 * Generate a TOTP code for the given secret and time
 */
export declare function generateTOTP(secret: string, timestamp?: number): string;
/**
 * Verify a TOTP code with time window tolerance
 * Allows 1 period before and after current time (90 second window total)
 */
export declare function verifyTOTP(secret: string, code: string, window?: number): boolean;
/**
 * Verify a TOTP code and return the matched time step for replay prevention.
 * Returns the time step number if verified, or null if not verified.
 */
export declare function verifyTOTPWithCounter(secret: string, code: string, window?: number): number | null;
/**
 * Generate backup codes for account recovery
 */
export declare function generateBackupCodes(): string[];
/**
 * Hash a backup code for storage using HMAC-SHA256 when key is provided.
 * Falls back to plain SHA-256 for backward compatibility with existing codes.
 */
export declare function hashBackupCode(code: string, hmacKey?: string): string;
/**
 * Verify a backup code against hashed codes.
 * Tries HMAC hash first (new format), then falls back to plain SHA-256 (legacy).
 * Returns the index of the matched code, or -1 if not found.
 */
export declare function verifyBackupCode(code: string, hashedCodes: string[], hmacKey?: string): number;
/**
 * Generate otpauth:// URI for QR code generation
 */
export declare function generateTOTPUri(secret: string, accountName: string, issuer?: string): string;
/**
 * Encrypt TOTP secret for storage
 */
export declare function encryptTOTPSecret(secret: string, encryptionKey: string, salt: string): string;
/**
 * Decrypt TOTP secret from storage
 * Falls back to legacy salt 'totp-salt' for backward compatibility with existing secrets
 */
export declare function decryptTOTPSecret(encryptedData: string, encryptionKey: string, salt: string): string;
export interface TOTPSetupData {
    secret: string;
    uri: string;
    backupCodes: string[];
}
export interface TOTPVerificationResult {
    success: boolean;
    usedBackupCode?: boolean;
    backupCodeIndex?: number;
}
//# sourceMappingURL=totp.d.ts.map
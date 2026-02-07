/**
 * @skyplanner/auth
 * Shared authentication utilities for Sky Planner platform
 *
 * This package provides JWT and cookie utilities for SSO between:
 * - skyplanner.no (marketing site)
 * - app.skyplanner.no (main application)
 */
export type { JWTPayload, CookieOptions, TokenOptions, VerifyResult, } from './types';
export { signToken, verifyToken, decodeToken, isTokenExpired, getTokenTTL, } from './jwt';
export { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME, getCookieConfig, getRefreshCookieConfig, extractTokenFromCookies, buildSetCookieHeader, buildClearCookieHeader, } from './cookies';
export { validatePassword, assertValidPassword, getPasswordStrengthLabel, } from './password-validation';
export type { PasswordValidationResult, PasswordValidationOptions, } from './password-validation';
export { generateTOTPSecret, generateTOTP, verifyTOTP, generateBackupCodes, hashBackupCode, verifyBackupCode, generateTOTPUri, encryptTOTPSecret, decryptTOTPSecret, } from './totp';
export type { TOTPSetupData, TOTPVerificationResult, } from './totp';
//# sourceMappingURL=index.d.ts.map
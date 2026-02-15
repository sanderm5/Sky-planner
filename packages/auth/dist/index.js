/**
 * @skyplanner/auth
 * Shared authentication utilities for Sky Planner platform
 *
 * This package provides JWT and cookie utilities for SSO between:
 * - skyplanner.no (marketing site)
 * - app.skyplanner.no (main application)
 */
// JWT utilities
export { signToken, verifyToken, decodeToken, isTokenExpired, getTokenTTL, } from './jwt';
// Cookie utilities
export { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME, getCookieConfig, getRefreshCookieConfig, extractTokenFromCookies, buildSetCookieHeader, buildClearCookieHeader, } from './cookies';
// Password validation
export { validatePassword, assertValidPassword, getPasswordStrengthLabel, } from './password-validation';
// TOTP (Two-Factor Authentication)
export { generateTOTPSecret, generateTOTP, verifyTOTP, generateBackupCodes, hashBackupCode, verifyBackupCode, generateTOTPUri, encryptTOTPSecret, decryptTOTPSecret, verifyTOTPWithCounter, } from './totp';
//# sourceMappingURL=index.js.map
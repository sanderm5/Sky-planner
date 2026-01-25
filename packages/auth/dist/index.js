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
//# sourceMappingURL=index.js.map
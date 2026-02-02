/**
 * Cookie utilities for cross-subdomain SSO
 * Handles authentication cookies shared between skyplanner.no and app.skyplanner.no
 */
import type { CookieOptions } from './types';
export declare const AUTH_COOKIE_NAME = "skyplanner_session";
export declare const REFRESH_COOKIE_NAME = "skyplanner_refresh";
/**
 * Gets cookie configuration for the current environment
 * In production, cookies are set on .skyplanner.no to enable SSO
 * In development, cookies are set on localhost
 */
export declare function getCookieConfig(isProduction: boolean, customDomain?: string): CookieOptions;
/**
 * Gets refresh token cookie configuration
 * Longer expiration for remember-me functionality
 * Uses 'lax' sameSite for cross-subdomain SSO compatibility
 */
export declare function getRefreshCookieConfig(isProduction: boolean, customDomain?: string): CookieOptions;
export declare function extractTokenFromCookies(cookies: string | Record<string, string>, cookieName?: string): string | null;
/**
 * Builds a Set-Cookie header value for the auth token
 */
export declare function buildSetCookieHeader(token: string, options: CookieOptions['options']): string;
/**
 * Builds a Set-Cookie header to clear/logout
 * Uses the same domain logic as other cookie functions
 */
export declare function buildClearCookieHeader(isProduction: boolean): string;
//# sourceMappingURL=cookies.d.ts.map
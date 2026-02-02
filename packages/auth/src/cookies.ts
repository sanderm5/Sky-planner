/**
 * Cookie utilities for cross-subdomain SSO
 * Handles authentication cookies shared between skyplanner.no and app.skyplanner.no
 */

import type { CookieOptions } from './types';

export const AUTH_COOKIE_NAME = 'skyplanner_session';
export const REFRESH_COOKIE_NAME = 'skyplanner_refresh';

/**
 * Gets the cookie domain based on environment
 *
 * Behavior:
 * - If COOKIE_DOMAIN env var is set: Use that value (for cross-subdomain SSO)
 * - If COOKIE_DOMAIN is not set: Return undefined (browser uses current domain)
 * - In development: Use 'localhost'
 *
 * This allows the app to work on any domain (Railway, custom, etc.)
 * Set COOKIE_DOMAIN=.skyplanner.no when you have your domain configured
 */
function getCookieDomain(isProduction: boolean, customDomain?: string): string | undefined {
  if (customDomain) return customDomain;

  // Check for environment variable (supports cross-subdomain SSO when set)
  const envDomain = typeof process === 'object' && process.env ? process.env.COOKIE_DOMAIN : undefined;
  if (envDomain) return envDomain;

  // In development, use localhost. In production without COOKIE_DOMAIN, return undefined
  // (browser will use the current domain automatically)
  return isProduction ? undefined : 'localhost';
}

/**
 * Gets cookie configuration for the current environment
 * In production, cookies are set on .skyplanner.no to enable SSO
 * In development, cookies are set on localhost
 */
export function getCookieConfig(isProduction: boolean, customDomain?: string): CookieOptions {
  const domain = getCookieDomain(isProduction, customDomain);

  return {
    name: AUTH_COOKIE_NAME,
    options: {
      domain,
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  };
}

/**
 * Gets refresh token cookie configuration
 * Longer expiration for remember-me functionality
 * Uses 'lax' sameSite for cross-subdomain SSO compatibility
 */
export function getRefreshCookieConfig(isProduction: boolean, customDomain?: string): CookieOptions {
  const domain = getCookieDomain(isProduction, customDomain);

  return {
    name: REFRESH_COOKIE_NAME,
    options: {
      domain,
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax', // Must be 'lax' for cross-subdomain SSO to work
      maxAge: 60 * 60 * 24 * 90, // 90 days
    },
  };
}

/**
 * Extracts token from cookie header string
 * Works with both Express (parsed cookies) and raw cookie header
 */
/**
 * Escapes special regex characters in a string to prevent regex injection
 */
function escapeRegExp(str: string): string {
  // Using replace with global flag (g) for compatibility with older ES targets
  return str.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function extractTokenFromCookies(
  cookies: string | Record<string, string>,
  cookieName: string = AUTH_COOKIE_NAME
): string | null {
  if (typeof cookies === 'string') {
    // Parse raw cookie header (escape cookieName to prevent regex injection)
    const escapedName = escapeRegExp(cookieName);
    const match = cookies.match(new RegExp(`${escapedName}=([^;]+)`));
    return match ? match[1] : null;
  }
  return cookies[cookieName] || null;
}

/**
 * Builds a Set-Cookie header value for the auth token
 */
export function buildSetCookieHeader(
  token: string,
  options: CookieOptions['options']
): string {
  const parts = [
    `${AUTH_COOKIE_NAME}=${token}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite}`,
  ];

  // Only add Domain if explicitly set (for cross-subdomain SSO)
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');

  return parts.join('; ');
}

/**
 * Builds a Set-Cookie header to clear/logout
 * Uses the same domain logic as other cookie functions
 */
export function buildClearCookieHeader(isProduction: boolean): string {
  const domain = getCookieDomain(isProduction);
  const domainPart = domain ? `Domain=${domain}; ` : '';
  return `${AUTH_COOKIE_NAME}=; Path=/; ${domainPart}Max-Age=0`;
}

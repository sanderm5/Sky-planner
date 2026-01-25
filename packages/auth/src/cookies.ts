/**
 * Cookie utilities for cross-subdomain SSO
 * Handles authentication cookies shared between skyplanner.no and app.skyplanner.no
 */

import type { CookieOptions } from './types';

export const AUTH_COOKIE_NAME = 'skyplanner_session';
export const REFRESH_COOKIE_NAME = 'skyplanner_refresh';

/**
 * Gets cookie configuration for the current environment
 * In production, cookies are set on .skyplanner.no to enable SSO
 * In development, cookies are set on localhost
 */
export function getCookieConfig(isProduction: boolean): CookieOptions {
  return {
    name: AUTH_COOKIE_NAME,
    options: {
      domain: isProduction ? '.skyplanner.no' : 'localhost',
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
 */
export function getRefreshCookieConfig(isProduction: boolean): CookieOptions {
  return {
    name: REFRESH_COOKIE_NAME,
    options: {
      domain: isProduction ? '.skyplanner.no' : 'localhost',
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 90, // 90 days
    },
  };
}

/**
 * Extracts token from cookie header string
 * Works with both Express (parsed cookies) and raw cookie header
 */
export function extractTokenFromCookies(
  cookies: string | Record<string, string>,
  cookieName: string = AUTH_COOKIE_NAME
): string | null {
  if (typeof cookies === 'string') {
    // Parse raw cookie header
    const match = cookies.match(new RegExp(`${cookieName}=([^;]+)`));
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
    `Domain=${options.domain}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');

  return parts.join('; ');
}

/**
 * Builds a Set-Cookie header to clear/logout
 */
export function buildClearCookieHeader(isProduction: boolean): string {
  const domain = isProduction ? '.skyplanner.no' : 'localhost';
  return `${AUTH_COOKIE_NAME}=; Path=/; Domain=${domain}; Max-Age=0`;
}

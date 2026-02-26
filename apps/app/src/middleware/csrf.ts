/**
 * CSRF Protection Middleware
 * Implements double-submit cookie pattern for CSRF protection
 *
 * How it works:
 * 1. Server generates a random CSRF token and sets it in a cookie
 * 2. Client must read the cookie and include the token in a header (X-CSRF-Token)
 * 3. Server validates that cookie value matches header value
 *
 * This works because:
 * - Same-site cookie prevents cross-origin cookie access
 * - Attacker cannot read the cookie value to include in the header
 * - JavaScript on the legitimate domain can read the cookie
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { createLogger } from '../services/logger';

const logger = createLogger('csrf');

// Cookie name for CSRF token
export const CSRF_COOKIE_NAME = 'csrf_token';

// Header name where client sends the token
export const CSRF_HEADER_NAME = 'x-csrf-token';

// Token length in bytes (32 bytes = 64 hex chars)
const TOKEN_LENGTH = 32;

// Cookie max age (24 hours)
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  return randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * Set CSRF token cookie if not already present
 * This should be called on every response to ensure token is available
 */
export function ensureCsrfToken(req: Request, res: Response): string {
  // Check if token already exists in cookie
  const existingToken = req.cookies?.[CSRF_COOKIE_NAME];

  if (existingToken && typeof existingToken === 'string' && existingToken.length === TOKEN_LENGTH * 2) {
    return existingToken;
  }

  // Generate new token
  const token = generateCsrfToken();

  // Set cookie with security options
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Must be readable by JavaScript
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });

  return token;
}

/**
 * Middleware to ensure CSRF token cookie is set on all responses
 * Call this early in the middleware chain
 */
export function csrfTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Ensure token exists
  ensureCsrfToken(req, res);
  next();
}

/**
 * Validate CSRF token
 * Compares cookie token with header token using timing-safe comparison
 */
function validateCsrfToken(cookieToken: string | undefined, headerToken: string | undefined): boolean {
  // Both must be present
  if (!cookieToken || !headerToken) {
    return false;
  }

  // Both must be valid hex strings of correct length
  if (cookieToken.length !== TOKEN_LENGTH * 2 || headerToken.length !== TOKEN_LENGTH * 2) {
    return false;
  }

  // Timing-safe comparison
  try {
    const cookieBuffer = Buffer.from(cookieToken, 'hex');
    const headerBuffer = Buffer.from(headerToken, 'hex');

    return cookieBuffer.length === headerBuffer.length && timingSafeEqual(cookieBuffer, headerBuffer);
  } catch {
    return false;
  }
}

/**
 * Methods that require CSRF protection
 * GET, HEAD, OPTIONS are considered safe (read-only)
 */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Paths that are exempt from CSRF protection
 * - API endpoints that use API key authentication
 * - Webhook endpoints
 * - Public API
 */
// Note: When mounted via app.use('/api', csrfProtection()), Express strips
// the '/api' prefix from req.path. Paths here must match the STRIPPED path.
const EXEMPT_PATH_PREFIXES = [
  '/v1/', // Public API uses API key auth
  '/webhooks', // Webhooks use signature verification
  '/integration-webhooks', // External integration webhooks use token verification
  '/cron', // Cron jobs use secret verification
  '/docs', // API documentation is read-only
  '/klient/sso', // SSO uses one-time token + IP binding for cross-domain auth
];

/**
 * Check if a path is exempt from CSRF protection
 */
function isExemptPath(path: string): boolean {
  return EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * CSRF Protection Middleware
 * Validates CSRF token for state-changing requests
 *
 * Usage:
 * - Apply to all routes that need CSRF protection
 * - Client must include X-CSRF-Token header with value from csrf_token cookie
 *
 * @param options Configuration options
 * @param options.exemptPaths Additional paths to exempt from CSRF protection
 */
export function csrfProtection(options?: { exemptPaths?: string[] }) {
  const additionalExemptPaths = options?.exemptPaths || [];

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip safe methods
    if (!UNSAFE_METHODS.has(req.method)) {
      return next();
    }

    // Skip exempt paths
    if (isExemptPath(req.path) || additionalExemptPaths.some((p) => req.path.startsWith(p))) {
      return next();
    }

    // Skip if request has been authenticated via API key
    // Note: Only skip if the key has been validated by api-key-auth middleware
    if (req.headers['x-api-key'] && (req as any).apiKeyAuthenticated) {
      return next();
    }

    // Get tokens
    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

    // Validate
    if (!validateCsrfToken(cookieToken, headerToken)) {
      logger.warn(
        {
          path: req.path,
          method: req.method,
          hasCookie: !!cookieToken,
          hasHeader: !!headerToken,
          ip: req.ip,
        },
        'CSRF validation failed'
      );

      res.status(403).json({
        success: false,
        error: {
          code: 'CSRF_VALIDATION_FAILED',
          message: 'Ugyldig eller manglende CSRF-token',
        },
      });
      return;
    }

    next();
  };
}

/**
 * Get CSRF token for client
 * Returns the current token from cookie or generates a new one
 */
export function getCsrfTokenHandler(req: Request, res: Response): void {
  const token = ensureCsrfToken(req, res);
  res.json({
    success: true,
    data: { token },
  });
}

export default {
  csrfTokenMiddleware,
  csrfProtection,
  getCsrfTokenHandler,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
};

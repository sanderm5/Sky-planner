/**
 * Authentication middleware
 * Handles JWT validation and tenant context
 * Supports both Bearer token and cookie-based SSO authentication
 */

import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { extractTokenFromCookies, AUTH_COOKIE_NAME } from '@skyplanner/auth';
import { getConfig } from '../config/env';
import { authLogger } from '../services/logger';
import { isTokenBlacklisted } from '../services/token-blacklist';
import { Errors } from './errorHandler';
import type { AuthenticatedRequest, JWTPayload } from '../types';

/**
 * Generate a unique token ID for blacklist tracking
 * Uses jti if available, otherwise creates hash from userId + iat
 */
export function getTokenId(decoded: JWTPayload): string {
  if (decoded.jti) {
    return decoded.jti;
  }
  return `${decoded.userId}-${decoded.iat}`;
}

/**
 * Extracts JWT token from either:
 * 1. Authorization header (Bearer token) - for API clients
 * 2. Cookie (skyplanner_session) - for SSO from web app
 */
export function extractToken(req: AuthenticatedRequest): string | null {
  // First, try Authorization header (preferred for API clients)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Second, try cookie (for SSO from web app)
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const token = extractTokenFromCookies(cookieHeader, AUTH_COOKIE_NAME);
    if (token) {
      authLogger.debug('Token extracted from SSO cookie');
      return token;
    }
  }

  return null;
}

/**
 * Validates JWT token and adds user to request
 * Supports both Bearer token and cookie-based SSO authentication
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const token = extractToken(req);

  if (!token) {
    return next(Errors.unauthorized('Mangler autorisasjon'));
  }

  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.JWT_SECRET) as JWTPayload;

    // Check if token has been blacklisted (logout)
    const tokenId = getTokenId(decoded);
    const blacklisted = await isTokenBlacklisted(tokenId);
    if (blacklisted) {
      authLogger.debug({ tokenId }, 'Blacklisted token rejected');
      return next(Errors.unauthorized('Token er ugyldiggjort'));
    }

    req.user = decoded;
    req.organizationId = decoded.organizationId;

    // Log impersonation activity for audit trail
    if (decoded.isImpersonating && decoded.originalUserId) {
      authLogger.info({
        impersonatedUserId: decoded.userId,
        originalUserId: decoded.originalUserId,
        organizationId: decoded.organizationId,
        method: req.method,
        path: req.path,
      }, 'Impersonation activity detected');
    }

    authLogger.debug({
      userId: decoded.userId,
      organizationId: decoded.organizationId,
      type: decoded.type,
      isImpersonating: decoded.isImpersonating || false,
    }, 'User authenticated');

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(Errors.unauthorized('Token utløpt'));
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return next(Errors.unauthorized('Ugyldig token'));
    }
    return next(error);
  }
}

/**
 * Requires authentication AND valid organization context
 * Use this for all tenant-specific endpoints
 */
export function requireTenantAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  requireAuth(req, res, (error) => {
    if (error) {
      return next(error);
    }

    if (!req.organizationId) {
      authLogger.warn({
        userId: req.user?.userId,
        path: req.path,
      }, 'Request missing organization context');
      return next(Errors.unauthorized('Mangler organisasjonskontekst'));
    }

    next();
  });
}

/**
 * Requires admin role (bruker table, not klient)
 */
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  requireAuth(req, res, (error) => {
    if (error) {
      return next(error);
    }

    if (req.user?.type !== 'bruker') {
      authLogger.warn({
        userId: req.user?.userId,
        type: req.user?.type,
        path: req.path,
      }, 'Non-admin attempted admin action');
      return next(Errors.forbidden('Krever admin-tilgang'));
    }

    next();
  });
}

/**
 * Role hierarchy: admin > tekniker > kontor > leser
 * Higher roles include all permissions of lower roles
 */
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 40,
  tekniker: 30,
  kontor: 20,
  leser: 10,
};

/**
 * Requires a specific role (or higher) for bruker users.
 * Klient users (org owners) always have admin-level access.
 * Usage: requireRole('kontor') — allows admin, tekniker, and kontor
 */
export function requireRole(minimumRole: string) {
  const minimumLevel = ROLE_HIERARCHY[minimumRole] || 0;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    requireTenantAuth(req, res, async (error) => {
      if (error) return next(error);

      // Klient users (org owners) always have full access
      if (req.user?.type === 'klient') {
        return next();
      }

      // For bruker users, check their rolle
      try {
        const { getDatabase } = await import('../services/database');
        const db = await getDatabase();
        const bruker = await db.getBrukerById(req.user!.userId);

        if (!bruker) {
          return next(Errors.forbidden('Bruker ikke funnet'));
        }

        const userRole = bruker.rolle || 'leser';
        const userLevel = ROLE_HIERARCHY[userRole] || 0;

        if (userLevel < minimumLevel) {
          authLogger.warn({
            userId: req.user?.userId,
            rolle: userRole,
            required: minimumRole,
            path: req.path,
          }, 'Insufficient role for action');
          return next(Errors.forbidden(`Krever ${minimumRole}-tilgang eller høyere`));
        }

        next();
      } catch (err) {
        authLogger.error({ error: err }, 'Failed to verify role');
        return next(Errors.internal('Kunne ikke verifisere rolle'));
      }
    });
  };
}

/**
 * Requires super admin role (bruker with is_super_admin = true)
 * Super admins can access all organizations' data
 */
export async function requireSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  requireAuth(req, res, async (error) => {
    if (error) {
      return next(error);
    }

    // Must be a bruker (admin type)
    if (req.user?.type !== 'bruker') {
      authLogger.warn({
        userId: req.user?.userId,
        type: req.user?.type,
        path: req.path,
      }, 'Non-bruker attempted super admin action');
      return next(Errors.forbidden('Krever super-admin tilgang'));
    }

    // Check if user has is_super_admin flag in database
    try {
      const { getDatabase } = await import('../services/database');
      const db = await getDatabase();
      const bruker = await db.getBrukerById(req.user.userId);

      if (!bruker || !bruker.is_super_admin) {
        authLogger.warn({
          userId: req.user?.userId,
          path: req.path,
        }, 'Non-super-admin attempted super admin action');
        return next(Errors.forbidden('Krever super-admin tilgang'));
      }

      // Mark request as super admin for use in routes
      req.isSuperAdmin = true;

      authLogger.info({
        userId: req.user?.userId,
        path: req.path,
      }, 'Super admin access granted');

      next();
    } catch (err) {
      authLogger.error({ error: err }, 'Failed to verify super admin status');
      return next(Errors.internal('Kunne ikke verifisere tilgang'));
    }
  });
}

/**
 * Optional auth - adds user to request if token present, but doesn't require it
 * Supports both Bearer token and cookie-based SSO authentication
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const token = extractToken(req);

  if (!token) {
    return next();
  }

  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.JWT_SECRET) as JWTPayload;

    // Check if token has been blacklisted (logout)
    const tokenId = getTokenId(decoded);
    const blacklisted = await isTokenBlacklisted(tokenId);
    if (blacklisted) {
      authLogger.debug({ tokenId }, 'Optional auth: blacklisted token ignored');
      return next();
    }

    req.user = decoded;
    req.organizationId = decoded.organizationId;
  } catch {
    // Token invalid, but that's okay for optional auth
    authLogger.debug('Optional auth: invalid token ignored');
  }

  next();
}

/**
 * Generates a JWT token for a user
 * Includes a unique JTI for blacklist tracking
 */
export function generateToken(
  payload: Omit<JWTPayload, 'iat' | 'exp' | 'jti'>,
  expiresIn: string | number = '24h'
): string {
  const config = getConfig();
  const jti = crypto.randomUUID();
  return jwt.sign({ ...payload, jti }, config.JWT_SECRET, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
}

/**
 * Verifies and decodes a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const config = getConfig();
    return jwt.verify(token, config.JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * API Key Authentication Middleware
 * Handles X-API-Key header authentication for external systems
 */

import { Response, NextFunction } from 'express';
import { authLogger } from '../services/logger';
import { getApiKeyService } from '../services/api-keys';
import { Errors } from './errorHandler';
import type { AuthenticatedRequest } from '../types';
import type { ApiScope, ApiKeyAuthContext } from '../types/api-key';

// Extend AuthenticatedRequest to include API key context
declare module '../types' {
  interface AuthenticatedRequest {
    apiKeyContext?: ApiKeyAuthContext;
  }
}

/**
 * Middleware for API key authentication
 * Checks X-API-Key header and validates against database
 * Sets organizationId and apiKeyContext on request
 */
export async function apiKeyAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  // No API key header - skip this middleware (allow JWT auth to handle)
  if (!apiKey) {
    return next();
  }

  try {
    const apiKeyService = await getApiKeyService();
    const context = await apiKeyService.validateApiKey(apiKey);

    if (!context) {
      return next(Errors.unauthorized('Ugyldig API-nøkkel'));
    }

    // Check rate limit
    if (context.rateLimitRemaining <= 0) {
      res.setHeader('X-RateLimit-Limit', '1000'); // Will be overwritten below
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(context.rateLimitReset));
      return next(Errors.tooManyRequests('API rate limit overskredet'));
    }

    // Check monthly quota
    if (context.monthlyQuota && context.quotaUsedThisMonth >= context.monthlyQuota) {
      res.setHeader('X-Monthly-Quota-Limit', String(context.monthlyQuota));
      res.setHeader('X-Monthly-Quota-Used', String(context.quotaUsedThisMonth));
      return next(Errors.tooManyRequests('Månedlig API-kvote overskredet'));
    }

    // Set rate limit headers
    res.setHeader('X-RateLimit-Remaining', String(context.rateLimitRemaining));
    res.setHeader('X-RateLimit-Reset', String(context.rateLimitReset));
    if (context.monthlyQuota) {
      res.setHeader('X-Monthly-Quota-Limit', String(context.monthlyQuota));
      res.setHeader('X-Monthly-Quota-Remaining', String(context.monthlyQuota - context.quotaUsedThisMonth));
    }

    // Set request context
    req.organizationId = context.organizationId;
    req.apiKeyContext = context;
    (req as any).apiKeyAuthenticated = true;

    authLogger.debug({
      apiKeyId: context.apiKeyId,
      organizationId: context.organizationId,
      endpoint: req.path,
      method: req.method,
    }, 'API key authenticated');

    next();
  } catch (error) {
    authLogger.error({ error }, 'API key auth error');
    return next(Errors.internal('Autentiseringsfeil'));
  }
}

/**
 * Middleware to require specific API scopes
 * Must be used AFTER apiKeyAuth or requireTenantAuth
 *
 * If using JWT auth (user), allows all (existing behavior)
 * If using API key, checks for required scopes
 *
 * @param requiredScopes - Array of scopes that are ALL required
 */
export function requireScope(...requiredScopes: ApiScope[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // If using JWT auth (user), require admin (bruker) type for scope-restricted operations
    if (req.user && !req.apiKeyContext) {
      if (req.user.type !== 'bruker') {
        authLogger.warn({
          userId: req.user.userId,
          type: req.user.type,
          path: req.path,
          requiredScopes,
        }, 'Non-admin JWT user attempted scope-restricted action');
        return next(Errors.forbidden('Krever admin-tilgang'));
      }
      return next();
    }

    // If using API key, check scopes
    if (req.apiKeyContext) {
      const hasAllScopes = requiredScopes.every(
        scope => req.apiKeyContext!.scopes.includes(scope)
      );

      if (!hasAllScopes) {
        authLogger.warn({
          apiKeyId: req.apiKeyContext.apiKeyId,
          requiredScopes,
          userScopes: req.apiKeyContext.scopes,
          endpoint: req.path,
        }, 'API key missing required scopes');

        return next(Errors.forbidden(
          `Manglende tilgang. Krever: ${requiredScopes.join(', ')}`
        ));
      }
    }

    // No auth context at all - should be caught by other middleware
    if (!req.user && !req.apiKeyContext) {
      return next(Errors.unauthorized('Mangler autorisasjon'));
    }

    next();
  };
}

/**
 * Middleware to require ANY of the specified scopes (OR logic)
 *
 * @param requiredScopes - Array of scopes where at least ONE is required
 */
export function requireAnyScope(...requiredScopes: ApiScope[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // If using JWT auth (user), require admin (bruker) type for scope-restricted operations
    if (req.user && !req.apiKeyContext) {
      if (req.user.type !== 'bruker') {
        authLogger.warn({
          userId: req.user.userId,
          type: req.user.type,
          path: req.path,
          requiredScopes,
        }, 'Non-admin JWT user attempted scope-restricted action');
        return next(Errors.forbidden('Krever admin-tilgang'));
      }
      return next();
    }

    // If using API key, check scopes
    if (req.apiKeyContext) {
      const hasAnyScope = requiredScopes.some(
        scope => req.apiKeyContext!.scopes.includes(scope)
      );

      if (!hasAnyScope) {
        authLogger.warn({
          apiKeyId: req.apiKeyContext.apiKeyId,
          requiredScopes,
          userScopes: req.apiKeyContext.scopes,
          endpoint: req.path,
        }, 'API key missing required scopes (any)');

        return next(Errors.forbidden(
          `Manglende tilgang. Krever en av: ${requiredScopes.join(', ')}`
        ));
      }
    }

    // No auth context at all - should be caught by other middleware
    if (!req.user && !req.apiKeyContext) {
      return next(Errors.unauthorized('Mangler autorisasjon'));
    }

    next();
  };
}

/**
 * Combined authentication middleware
 * Tries API key first, then falls back to JWT auth
 * Use this for endpoints that support both authentication methods
 */
export async function requireApiOrJwtAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  // If API key header is present, use API key auth
  if (apiKey) {
    return apiKeyAuth(req, res, next);
  }

  // Otherwise, fall back to JWT auth
  const { requireTenantAuth } = await import('./auth');
  return requireTenantAuth(req, res, next);
}

/**
 * Middleware for logging API key usage after response
 * Should be used after route handlers
 */
export function logApiKeyUsage() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    // Only log if API key was used
    if (!req.apiKeyContext) {
      return next();
    }

    // Capture response time
    const startTime = Date.now();

    // Hook into response finish event
    res.on('finish', async () => {
      try {
        const responseTime = Date.now() - startTime;
        const apiKeyService = await getApiKeyService();

        await apiKeyService.logUsage({
          api_key_id: req.apiKeyContext!.apiKeyId,
          organization_id: req.apiKeyContext!.organizationId,
          endpoint: req.path,
          method: req.method,
          status_code: res.statusCode,
          response_time_ms: responseTime,
          ip_address: req.ip || req.connection?.remoteAddress,
          user_agent: req.headers['user-agent'],
        });
      } catch (error) {
        // Don't fail the request due to logging errors
        authLogger.error({ error }, 'Failed to log API key usage');
      }
    });

    next();
  };
}

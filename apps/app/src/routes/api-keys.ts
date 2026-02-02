/**
 * API Key Management Routes
 * Admin endpoints for creating, listing, and revoking API keys
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getApiKeyService } from '../services/api-keys';
import { validateScopes, isValidScope, API_SCOPE_LABELS } from '../types/api-key';
import type { AuthenticatedRequest, ApiResponse } from '../types';
import type { ApiKey, CreateApiKeyRequest, CreateApiKeyResponse } from '../types/api-key';

const router: Router = Router();

/**
 * GET /api/api-keys
 * List all API keys for the organization
 */
router.get(
  '/',
  requireTenantAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const apiKeyService = await getApiKeyService();
    const keys = await apiKeyService.listApiKeys(req.organizationId!);

    const response: ApiResponse<ApiKey[]> = {
      success: true,
      data: keys,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/api-keys/scopes
 * Get available API scopes with descriptions
 */
router.get(
  '/scopes',
  requireTenantAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const scopes = Object.entries(API_SCOPE_LABELS).map(([scope, label]) => ({
      scope,
      label,
    }));

    const response: ApiResponse<Array<{ scope: string; label: string }>> = {
      success: true,
      data: scopes,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/api-keys/:id
 * Get a single API key by ID
 */
router.get(
  '/:id',
  requireTenantAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const apiKeyService = await getApiKeyService();
    const key = await apiKeyService.getApiKey(Number.parseInt(id, 10), req.organizationId!);

    if (!key) {
      throw Errors.notFound('API-nøkkel');
    }

    const response: ApiResponse<ApiKey> = {
      success: true,
      data: key,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/api-keys/:id/usage
 * Get usage statistics for an API key
 */
router.get(
  '/:id/usage',
  requireTenantAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const days = Number.parseInt(req.query.days as string, 10) || 30;

    const apiKeyService = await getApiKeyService();
    const stats = await apiKeyService.getUsageStats(Number.parseInt(id, 10), req.organizationId!, days);

    const response: ApiResponse<typeof stats> = {
      success: true,
      data: stats,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/api-keys
 * Create a new API key
 * IMPORTANT: The full key is only returned once in this response
 */
router.post(
  '/',
  requireTenantAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { name, description, scopes, expires_at, monthly_quota, rate_limit_requests, rate_limit_window_seconds } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw Errors.badRequest('Navn er påkrevd');
    }

    if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
      throw Errors.badRequest('Minst én scope er påkrevd');
    }

    // Validate scopes
    const invalidScopes = scopes.filter((s: string) => !isValidScope(s));
    if (invalidScopes.length > 0) {
      throw Errors.badRequest(`Ugyldige scopes: ${invalidScopes.join(', ')}`);
    }

    // Validate expiration date if provided
    if (expires_at) {
      const expiresDate = new Date(expires_at);
      if (isNaN(expiresDate.getTime())) {
        throw Errors.badRequest('Ugyldig utløpsdato');
      }
      if (expiresDate < new Date()) {
        throw Errors.badRequest('Utløpsdato kan ikke være i fortiden');
      }
    }

    const createData: CreateApiKeyRequest = {
      name: name.trim(),
      description: description?.trim(),
      scopes: validateScopes(scopes),
      expires_at,
      monthly_quota: monthly_quota ? Number.parseInt(monthly_quota, 10) : undefined,
      rate_limit_requests: rate_limit_requests ? Number.parseInt(rate_limit_requests, 10) : undefined,
      rate_limit_window_seconds: rate_limit_window_seconds ? Number.parseInt(rate_limit_window_seconds, 10) : undefined,
    };

    const apiKeyService = await getApiKeyService();
    const result = await apiKeyService.createApiKey(
      req.organizationId!,
      createData,
      req.user!.userId
    );

    // Log audit event
    logAudit(
      apiLogger,
      'api_key_created',
      req.user!.userId,
      'api_key',
      result.apiKey.id,
      { name: result.apiKey.name, scopes: result.apiKey.scopes, organizationId: req.organizationId }
    );

    const response: ApiResponse<CreateApiKeyResponse> & { message: string } = {
      success: true,
      data: result,
      message: 'API-nøkkel opprettet. Lagre nøkkelen trygt - den vises kun én gang.',
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * POST /api/api-keys/:id/rotate
 * Rotate an API key (create new, revoke old)
 */
router.post(
  '/:id/rotate',
  requireTenantAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const apiKeyService = await getApiKeyService();
    const result = await apiKeyService.rotateApiKey(
      Number.parseInt(id, 10),
      req.organizationId!,
      req.user!.userId
    );

    // Log audit event
    logAudit(
      apiLogger,
      'api_key_rotated',
      req.user!.userId,
      'api_key',
      result.apiKey.id,
      { oldKeyId: Number.parseInt(id, 10), newKeyId: result.apiKey.id, organizationId: req.organizationId }
    );

    const response: ApiResponse<CreateApiKeyResponse> & { message: string } = {
      success: true,
      data: result,
      message: 'API-nøkkel rotert. Gammel nøkkel er deaktivert.',
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/api-keys/:id
 * Revoke an API key
 */
router.delete(
  '/:id',
  requireTenantAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body || {};

    const apiKeyService = await getApiKeyService();
    const revoked = await apiKeyService.revokeApiKey(
      Number.parseInt(id, 10),
      req.organizationId!,
      req.user!.userId,
      reason
    );

    if (!revoked) {
      throw Errors.notFound('API-nøkkel');
    }

    // Log audit event
    logAudit(
      apiLogger,
      'api_key_revoked',
      req.user!.userId,
      'api_key',
      Number.parseInt(id, 10),
      { reason, organizationId: req.organizationId }
    );

    const response: ApiResponse<null> & { message: string } = {
      success: true,
      data: null,
      message: 'API-nøkkel deaktivert',
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

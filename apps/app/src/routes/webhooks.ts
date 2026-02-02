/**
 * Webhook Management Routes
 * Endpoints for managing webhook subscriptions
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth, requireAdmin } from '../middleware/auth';
import { requireApiOrJwtAuth, requireScope } from '../middleware/api-key-auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getWebhookService } from '../services/webhooks';
import { validateEventTypes, isValidWebhookUrl, WEBHOOK_EVENT_LABELS } from '../types/webhook';
import type { AuthenticatedRequest, ApiResponse } from '../types';
import type { WebhookEndpoint, CreateWebhookResponse, WebhookDelivery } from '../types/webhook';

const router: Router = Router();

/**
 * GET /api/webhooks
 * List all webhook endpoints for the organization
 */
router.get(
  '/',
  requireApiOrJwtAuth,
  requireScope('webhooks:manage'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const webhookService = await getWebhookService();
    const webhooks = await webhookService.listWebhooks(req.organizationId!);

    const response: ApiResponse<WebhookEndpoint[]> = {
      success: true,
      data: webhooks,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/webhooks/events
 * Get available webhook event types with descriptions
 */
router.get(
  '/events',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const events = Object.entries(WEBHOOK_EVENT_LABELS).map(([event, label]) => ({
      event,
      label,
    }));

    const response: ApiResponse<Array<{ event: string; label: string }>> = {
      success: true,
      data: events,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/webhooks/:id
 * Get a specific webhook endpoint
 */
router.get(
  '/:id',
  requireApiOrJwtAuth,
  requireScope('webhooks:manage'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const webhookService = await getWebhookService();
    const webhook = await webhookService.getWebhook(Number.parseInt(id, 10), req.organizationId!);

    if (!webhook) {
      throw Errors.notFound('Webhook');
    }

    const response: ApiResponse<WebhookEndpoint> = {
      success: true,
      data: webhook,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/webhooks/:id/deliveries
 * Get delivery history for a webhook endpoint
 */
router.get(
  '/:id/deliveries',
  requireApiOrJwtAuth,
  requireScope('webhooks:manage'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const limit = Number.parseInt(req.query.limit as string, 10) || 50;

    const webhookService = await getWebhookService();
    const deliveries = await webhookService.getDeliveryHistory(
      Number.parseInt(id, 10),
      req.organizationId!,
      Math.min(limit, 100)
    );

    const response: ApiResponse<WebhookDelivery[]> = {
      success: true,
      data: deliveries,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/webhooks
 * Create a new webhook endpoint
 * IMPORTANT: The secret is only returned once in this response
 */
router.post(
  '/',
  requireApiOrJwtAuth,
  requireScope('webhooks:manage'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { url, name, description, events } = req.body;

    // Validate required fields
    if (!url || typeof url !== 'string') {
      throw Errors.badRequest('URL er påkrevd');
    }

    if (!isValidWebhookUrl(url)) {
      throw Errors.badRequest('Ugyldig URL. Må være en gyldig HTTP(S) URL.');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw Errors.badRequest('Navn er påkrevd');
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      throw Errors.badRequest('Minst én event-type er påkrevd');
    }

    // Validate events
    const validEvents = validateEventTypes(events);
    if (validEvents.length === 0) {
      throw Errors.badRequest('Ingen gyldige event-typer oppgitt');
    }

    // Get user ID for audit - API key users don't have userId, use negative apiKeyId as identifier
    const auditUserId = req.user?.userId ?? (req.apiKeyContext ? -req.apiKeyContext.apiKeyId : 0);

    const webhookService = await getWebhookService();
    const result = await webhookService.createWebhook(
      req.organizationId!,
      {
        url: url.trim(),
        name: name.trim(),
        description: description?.trim(),
        events: validEvents,
      },
      auditUserId
    );

    // Log audit event
    logAudit(
      apiLogger,
      'webhook_created',
      auditUserId,
      'webhook',
      result.webhook.id,
      { name: result.webhook.name, url: result.webhook.url, events: result.webhook.events }
    );

    const response: ApiResponse<CreateWebhookResponse> & { message: string } = {
      success: true,
      data: result,
      message: 'Webhook opprettet. Lagre secret trygt - den vises kun én gang.',
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/webhooks/:id
 * Update a webhook endpoint
 */
router.put(
  '/:id',
  requireApiOrJwtAuth,
  requireScope('webhooks:manage'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { url, name, description, events, is_active } = req.body;

    // Validate URL if provided
    if (url !== undefined) {
      if (typeof url !== 'string' || !isValidWebhookUrl(url)) {
        throw Errors.badRequest('Ugyldig URL');
      }
    }

    // Validate events if provided
    let validEvents;
    if (events !== undefined) {
      if (!Array.isArray(events) || events.length === 0) {
        throw Errors.badRequest('Minst én event-type er påkrevd');
      }
      validEvents = validateEventTypes(events);
      if (validEvents.length === 0) {
        throw Errors.badRequest('Ingen gyldige event-typer oppgitt');
      }
    }

    const webhookService = await getWebhookService();
    const webhook = await webhookService.updateWebhook(
      Number.parseInt(id, 10),
      req.organizationId!,
      {
        url: url?.trim(),
        name: name?.trim(),
        description: description?.trim(),
        events: validEvents,
        is_active,
      }
    );

    if (!webhook) {
      throw Errors.notFound('Webhook');
    }

    // Get user ID for audit - API key users don't have userId
    const auditUserId = req.user?.userId ?? (req.apiKeyContext ? -req.apiKeyContext.apiKeyId : 0);

    logAudit(
      apiLogger,
      'webhook_updated',
      auditUserId,
      'webhook',
      webhook.id,
      { name: webhook.name }
    );

    const response: ApiResponse<WebhookEndpoint> = {
      success: true,
      data: webhook,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/webhooks/:id/rotate-secret
 * Rotate webhook secret
 */
router.post(
  '/:id/rotate-secret',
  requireTenantAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const webhookService = await getWebhookService();
    const result = await webhookService.rotateSecret(
      Number.parseInt(id, 10),
      req.organizationId!
    );

    if (!result) {
      throw Errors.notFound('Webhook');
    }

    logAudit(
      apiLogger,
      'webhook_secret_rotated',
      req.user!.userId,
      'webhook',
      result.webhook.id
    );

    const response: ApiResponse<CreateWebhookResponse> & { message: string } = {
      success: true,
      data: result,
      message: 'Webhook secret rotert. Lagre ny secret trygt.',
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/webhooks/:id/deliveries/:deliveryId/retry
 * Retry a failed webhook delivery
 */
router.post(
  '/:id/deliveries/:deliveryId/retry',
  requireTenantAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { deliveryId } = req.params;

    const webhookService = await getWebhookService();
    const success = await webhookService.retryDelivery(
      Number.parseInt(deliveryId, 10),
      req.organizationId!
    );

    if (!success) {
      throw Errors.badRequest('Kan ikke prøve på nytt - leveransen er allerede fullført eller finnes ikke');
    }

    const response: ApiResponse<null> & { message: string } = {
      success: true,
      data: null,
      message: 'Webhook-levering satt i kø for nytt forsøk',
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook endpoint
 */
router.delete(
  '/:id',
  requireApiOrJwtAuth,
  requireScope('webhooks:manage'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const webhookService = await getWebhookService();
    const deleted = await webhookService.deleteWebhook(
      Number.parseInt(id, 10),
      req.organizationId!
    );

    if (!deleted) {
      throw Errors.notFound('Webhook');
    }

    // Get user ID for audit - API key users don't have userId
    const auditUserId = req.user?.userId ?? (req.apiKeyContext ? -req.apiKeyContext.apiKeyId : 0);

    logAudit(
      apiLogger,
      'webhook_deleted',
      auditUserId,
      'webhook',
      Number.parseInt(id, 10)
    );

    const response: ApiResponse<null> & { message: string } = {
      success: true,
      data: null,
      message: 'Webhook slettet',
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/webhooks/test
 * Test endpoint for webhook signature verification (documentation helper)
 */
router.post(
  '/test',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { payload, signature, secret } = req.body;

    if (!payload || !signature || !secret) {
      throw Errors.badRequest('payload, signature og secret er påkrevd');
    }

    const { WebhookService } = await import('../services/webhooks');
    const isValid = WebhookService.verifySignature(
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      signature,
      secret
    );

    const response: ApiResponse<{ valid: boolean }> = {
      success: true,
      data: { valid: isValid },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

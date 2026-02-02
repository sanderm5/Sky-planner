/**
 * Public API v1 - Customers Endpoint
 * External API for third-party integrations
 */

import { Router, Response } from 'express';
import { apiLogger } from '../../../services/logger';
import { requireApiOrJwtAuth, requireScope, logApiKeyUsage } from '../../../middleware/api-key-auth';
import { asyncHandler, Errors } from '../../../middleware/errorHandler';
import type { AuthenticatedRequest, Kunde, CreateKundeRequest } from '../../../types';

const router: Router = Router();

// Database service interface
interface CustomerDbService {
  getAllKunderPaginated(
    organizationId: number,
    options: { limit?: number; offset?: number; modifiedSince?: string }
  ): Promise<{
    data: Kunde[];
    total: number;
    limit: number;
    offset: number;
  }>;
  getKundeById(id: number, organizationId: number): Promise<Kunde | null>;
  createKunde(data: CreateKundeRequest & { organization_id: number }): Promise<Kunde>;
  updateKunde(id: number, data: Partial<Kunde>, organizationId: number): Promise<Kunde | null>;
  deleteKunde(id: number, organizationId: number): Promise<boolean>;
}

let dbService: CustomerDbService;

/**
 * Initialize public API customers routes with database service
 */
export function initPublicCustomersRoutes(databaseService: CustomerDbService): Router {
  dbService = databaseService;
  return router;
}

// Apply API key usage logging to all routes
router.use(logApiKeyUsage());

/**
 * GET /api/v1/customers
 * List customers with pagination
 *
 * Query params:
 * - limit: Number of results (default 100, max 500)
 * - offset: Starting offset (default 0)
 * - modified_since: ISO date string to filter recently modified
 */
router.get(
  '/',
  requireApiOrJwtAuth,
  requireScope('customers:read'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const limit = Math.min(Number.parseInt(req.query.limit as string, 10) || 100, 500);
    const offset = Math.max(Number.parseInt(req.query.offset as string, 10) || 0, 0);
    const modifiedSince = req.query.modified_since as string | undefined;

    // Validate modified_since if provided
    if (modifiedSince) {
      const date = new Date(modifiedSince);
      if (isNaN(date.getTime())) {
        throw Errors.badRequest('Ugyldig modified_since format. Bruk ISO 8601 format.');
      }
    }

    const result = await dbService.getAllKunderPaginated(req.organizationId!, {
      limit,
      offset,
      modifiedSince,
    });

    // Public API response format
    res.json({
      data: result.data.map(sanitizeCustomer),
      meta: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        has_more: result.offset + result.data.length < result.total,
      },
    });
  })
);

/**
 * GET /api/v1/customers/:id
 * Get a single customer by ID
 */
router.get(
  '/:id',
  requireApiOrJwtAuth,
  requireScope('customers:read'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const kunde = await dbService.getKundeById(parseInt(id, 10), req.organizationId!);

    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    res.json({
      data: sanitizeCustomer(kunde),
    });
  })
);

/**
 * POST /api/v1/customers
 * Create a new customer
 */
router.post(
  '/',
  requireApiOrJwtAuth,
  requireScope('customers:write'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { navn, adresse, postnummer, poststed, telefon, epost, lat, lng, notater, kontaktperson } = req.body;

    // Validate required fields
    if (!navn || typeof navn !== 'string' || navn.trim().length === 0) {
      throw Errors.badRequest('navn er påkrevd');
    }

    if (!adresse || typeof adresse !== 'string' || adresse.trim().length === 0) {
      throw Errors.badRequest('adresse er påkrevd');
    }

    // Parse and validate coordinates
    const parsedLat = lat ? Number.parseFloat(lat) : undefined;
    const parsedLng = lng ? Number.parseFloat(lng) : undefined;

    // Validate coordinates if provided
    if (parsedLat !== undefined && (Number.isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90)) {
      throw Errors.badRequest('Ugyldig breddegrad (lat). Må være et tall mellom -90 og 90.');
    }
    if (parsedLng !== undefined && (Number.isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180)) {
      throw Errors.badRequest('Ugyldig lengdegrad (lng). Må være et tall mellom -180 og 180.');
    }

    // Create customer data
    const kundeData: CreateKundeRequest & { organization_id: number } = {
      navn: navn.trim(),
      adresse: adresse.trim(),
      postnummer: postnummer?.trim(),
      poststed: poststed?.trim(),
      telefon: telefon?.trim(),
      epost: epost?.trim(),
      lat: parsedLat,
      lng: parsedLng,
      notater: notater?.trim(),
      kontaktperson: kontaktperson?.trim(),
      organization_id: req.organizationId!,
    };

    // Validate email format if provided
    if (kundeData.epost && !isValidEmail(kundeData.epost)) {
      throw Errors.badRequest('Ugyldig e-postformat');
    }

    const kunde = await dbService.createKunde(kundeData);

    apiLogger.info({
      action: 'customer_created_via_api',
      organizationId: req.organizationId,
      customerId: kunde.id,
      apiKeyId: req.apiKeyContext?.apiKeyId,
    }, 'Customer created via public API');

    res.status(201).json({
      data: sanitizeCustomer(kunde),
    });
  })
);

/**
 * PUT /api/v1/customers/:id
 * Update an existing customer
 */
router.put(
  '/:id',
  requireApiOrJwtAuth,
  requireScope('customers:write'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const customerId = parseInt(id, 10);

    // Check customer exists
    const existing = await dbService.getKundeById(customerId, req.organizationId!);
    if (!existing) {
      throw Errors.notFound('Kunde');
    }

    // Build update data (only include provided fields)
    const updateData: Partial<Kunde> = {};
    const allowedFields = ['navn', 'adresse', 'postnummer', 'poststed', 'telefon', 'epost', 'lat', 'lng', 'notater', 'kontaktperson'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'lat' || field === 'lng') {
          (updateData as Record<string, unknown>)[field] = req.body[field] ? parseFloat(req.body[field]) : undefined;
        } else {
          (updateData as Record<string, unknown>)[field] = req.body[field]?.trim() || undefined;
        }
      }
    }

    // Validate email format if provided
    if (updateData.epost && !isValidEmail(updateData.epost)) {
      throw Errors.badRequest('Ugyldig e-postformat');
    }

    const kunde = await dbService.updateKunde(customerId, updateData, req.organizationId!);

    if (!kunde) {
      throw Errors.internal('Kunne ikke oppdatere kunde');
    }

    apiLogger.info({
      action: 'customer_updated_via_api',
      organizationId: req.organizationId,
      customerId: kunde.id,
      apiKeyId: req.apiKeyContext?.apiKeyId,
    }, 'Customer updated via public API');

    res.json({
      data: sanitizeCustomer(kunde),
    });
  })
);

/**
 * DELETE /api/v1/customers/:id
 * Delete a customer
 */
router.delete(
  '/:id',
  requireApiOrJwtAuth,
  requireScope('customers:write'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const customerId = parseInt(id, 10);

    const deleted = await dbService.deleteKunde(customerId, req.organizationId!);

    if (!deleted) {
      throw Errors.notFound('Kunde');
    }

    apiLogger.info({
      action: 'customer_deleted_via_api',
      organizationId: req.organizationId,
      customerId,
      apiKeyId: req.apiKeyContext?.apiKeyId,
    }, 'Customer deleted via public API');

    res.status(204).send();
  })
);

// ============ Helper Functions ============

/**
 * Sanitize customer data for API response
 * Removes internal fields and formats data consistently
 */
function sanitizeCustomer(kunde: Kunde): Record<string, unknown> {
  return {
    id: kunde.id,
    navn: kunde.navn,
    adresse: kunde.adresse,
    postnummer: kunde.postnummer || null,
    poststed: kunde.poststed || null,
    telefon: kunde.telefon || null,
    epost: kunde.epost || null,
    lat: kunde.lat || null,
    lng: kunde.lng || null,
    notater: kunde.notater || null,
    kontaktperson: kunde.kontaktperson || null,
    opprettet: kunde.opprettet || null,
    // Include service-related dates
    neste_kontroll: kunde.neste_kontroll || null,
    siste_kontroll: kunde.siste_kontroll || null,
    // External integration info
    external_source: kunde.external_source || null,
    external_id: kunde.external_id || null,
    last_sync_at: kunde.last_sync_at || null,
  };
}

/**
 * Simple email validation
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export default router;

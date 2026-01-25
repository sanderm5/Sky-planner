/**
 * Kontaktlogg (Contact Log) routes
 * CRUD operations for customer contact history with multi-tenant support
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, Kontaktlogg, ApiResponse, CreateKontaktloggRequest } from '../types';

const router: Router = Router();

// Valid contact types
const VALID_CONTACT_TYPES = ['Telefonsamtale', 'SMS', 'E-post', 'Besøk', 'Annet'] as const;

// Database service interface (will be injected)
interface KontaktloggDbService {
  getKontaktloggByKunde(kundeId: number, organizationId: number): Promise<Kontaktlogg[]>;
  createKontaktlogg(data: CreateKontaktloggRequest & { kunde_id: number; organization_id: number; opprettet_av?: string }): Promise<Kontaktlogg>;
  deleteKontaktlogg(id: number, organizationId: number): Promise<boolean>;
  getKundeById(id: number, organizationId?: number): Promise<{ id: number } | null>;
}

let dbService: KontaktloggDbService;

/**
 * Initialize kontaktlogg routes with database service
 */
export function initKontaktloggRoutes(databaseService: KontaktloggDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/kunder/:kundeId/kontaktlogg
 * Get contact log for a specific customer
 */
router.get(
  '/kunder/:kundeId/kontaktlogg',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    // Verify kunde exists and belongs to this organization
    const kunde = await dbService.getKundeById(kundeId, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    const logg = await dbService.getKontaktloggByKunde(kundeId, req.organizationId!);

    const response: ApiResponse<Kontaktlogg[]> = {
      success: true,
      data: logg,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/kunder/:kundeId/kontaktlogg
 * Add contact log entry for a customer
 */
router.post(
  '/kunder/:kundeId/kontaktlogg',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    // Verify kunde exists and belongs to this organization
    const kunde = await dbService.getKundeById(kundeId, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    const { type, notat, opprettet_av } = req.body;

    // Validate type
    const contactType = type || 'Telefonsamtale';
    if (!VALID_CONTACT_TYPES.includes(contactType)) {
      throw Errors.badRequest(`Type må være en av: ${VALID_CONTACT_TYPES.join(', ')}`);
    }

    const kontaktData = {
      kunde_id: kundeId,
      type: contactType,
      notat,
      opprettet_av: opprettet_av || req.user?.epost,
      organization_id: req.organizationId!,
    };

    const kontakt = await dbService.createKontaktlogg(kontaktData);

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'kontaktlogg', kontakt.id, {
      kunde_id: kundeId,
      type: contactType,
    });

    const response: ApiResponse<Kontaktlogg> = {
      success: true,
      data: kontakt,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * DELETE /api/kontaktlogg/:id
 * Delete contact log entry
 */
router.delete(
  '/kontaktlogg/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig kontaktlogg-ID');
    }

    const deleted = await dbService.deleteKontaktlogg(id, req.organizationId!);
    if (!deleted) {
      throw Errors.notFound('Kontaktlogg');
    }

    logAudit(apiLogger, 'DELETE', req.user!.userId, 'kontaktlogg', id);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Kontaktlogg slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

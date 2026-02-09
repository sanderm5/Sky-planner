/**
 * Kontaktpersoner (Contact Persons) routes
 * CRUD operations for customer contact persons with multi-tenant support
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse } from '../types';

const router: Router = Router();

const VALID_ROLES = ['teknisk', 'faktura', 'daglig', 'annet'] as const;

interface Kontaktperson {
  id: number;
  kunde_id: number;
  organization_id: number;
  navn: string;
  rolle: string | null;
  telefon: string | null;
  epost: string | null;
  er_primaer: boolean;
  created_at: string;
  updated_at: string;
}

interface KontaktpersonDbService {
  getKundeById(id: number, organizationId?: number): Promise<{ id: number } | null>;
  getKontaktpersonerByKunde(kundeId: number, organizationId: number): Promise<Kontaktperson[]>;
  createKontaktperson(data: {
    kunde_id: number;
    organization_id: number;
    navn: string;
    rolle?: string;
    telefon?: string;
    epost?: string;
    er_primaer?: boolean;
  }): Promise<Kontaktperson>;
  updateKontaktperson(id: number, organizationId: number, data: Partial<Kontaktperson>): Promise<Kontaktperson | null>;
  deleteKontaktperson(id: number, organizationId: number): Promise<boolean>;
}

let dbService: KontaktpersonDbService;

export function initKontaktpersonerRoutes(databaseService: KontaktpersonDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/kunder/:kundeId/kontaktpersoner
 */
router.get(
  '/kunder/:kundeId/kontaktpersoner',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const kunde = await dbService.getKundeById(kundeId, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    const kontaktpersoner = await dbService.getKontaktpersonerByKunde(kundeId, req.organizationId!);

    const response: ApiResponse<Kontaktperson[]> = {
      success: true,
      data: kontaktpersoner,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/kunder/:kundeId/kontaktpersoner
 */
router.post(
  '/kunder/:kundeId/kontaktpersoner',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const kunde = await dbService.getKundeById(kundeId, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    const { navn, rolle, telefon, epost, er_primaer } = req.body;

    if (!navn || typeof navn !== 'string' || navn.trim().length === 0) {
      throw Errors.badRequest('Navn er påkrevd');
    }

    if (rolle && !VALID_ROLES.includes(rolle)) {
      throw Errors.badRequest(`Ugyldig rolle. Gyldige verdier: ${VALID_ROLES.join(', ')}`);
    }

    const kontaktperson = await dbService.createKontaktperson({
      kunde_id: kundeId,
      organization_id: req.organizationId!,
      navn: navn.trim(),
      rolle: rolle || undefined,
      telefon: telefon?.trim() || undefined,
      epost: epost?.trim() || undefined,
      er_primaer: er_primaer ?? false,
    });

    logAudit(apiLogger, 'CREATE_KONTAKTPERSON', req.user!.userId, 'kontaktperson', kontaktperson.id, {
      kundeId,
    });

    const response: ApiResponse<Kontaktperson> = {
      success: true,
      data: kontaktperson,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/kontaktpersoner/:id
 */
router.put(
  '/kontaktpersoner/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig kontaktperson-ID');
    }

    const { navn, rolle, telefon, epost, er_primaer } = req.body;

    if (rolle && !VALID_ROLES.includes(rolle)) {
      throw Errors.badRequest(`Ugyldig rolle. Gyldige verdier: ${VALID_ROLES.join(', ')}`);
    }

    const updated = await dbService.updateKontaktperson(id, req.organizationId!, {
      ...(navn !== undefined && { navn: navn.trim() }),
      ...(rolle !== undefined && { rolle }),
      ...(telefon !== undefined && { telefon: telefon?.trim() || null }),
      ...(epost !== undefined && { epost: epost?.trim() || null }),
      ...(er_primaer !== undefined && { er_primaer }),
    });

    if (!updated) {
      throw Errors.notFound('Kontaktperson');
    }

    logAudit(apiLogger, 'UPDATE_KONTAKTPERSON', req.user!.userId, 'kontaktperson', id);

    const response: ApiResponse<Kontaktperson> = {
      success: true,
      data: updated,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/kontaktpersoner/:id
 */
router.delete(
  '/kontaktpersoner/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig kontaktperson-ID');
    }

    const deleted = await dbService.deleteKontaktperson(id, req.organizationId!);

    if (!deleted) {
      throw Errors.notFound('Kontaktperson');
    }

    logAudit(apiLogger, 'DELETE_KONTAKTPERSON', req.user!.userId, 'kontaktperson', id);

    const response: ApiResponse<{ deleted: boolean }> = {
      success: true,
      data: { deleted: true },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

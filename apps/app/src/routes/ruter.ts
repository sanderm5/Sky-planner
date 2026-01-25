/**
 * Ruter (Routes/Trips) routes
 * CRUD operations for service routes with multi-tenant support
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, Rute, Kunde, ApiResponse, CreateRuteRequest } from '../types';

const router: Router = Router();

// Database service interface (will be injected)
interface RuteDbService {
  getAllRuter(organizationId?: number): Promise<(Rute & { antall_kunder: number })[]>;
  getRuteById(id: number, organizationId?: number): Promise<(Rute & { kunder?: Kunde[] }) | null>;
  createRute(data: CreateRuteRequest & { organization_id?: number }): Promise<Rute>;
  updateRute(id: number, data: Partial<Rute> & { kunde_ids?: number[] }, organizationId?: number): Promise<Rute | null>;
  deleteRute(id: number, organizationId?: number): Promise<boolean>;
  completeRute(id: number, dato: string, kontrollType: 'el' | 'brann' | 'both', organizationId?: number): Promise<{ success: boolean; oppdaterte_kunder: number }>;
  getRuteKunder(ruteId: number): Promise<(Kunde & { rekkefolge: number })[]>;
  setRuteKunder(ruteId: number, kundeIds: number[], organizationId?: number): Promise<void>;
}

let dbService: RuteDbService;

/**
 * Initialize ruter routes with database service
 */
export function initRuterRoutes(databaseService: RuteDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/ruter
 * Get all routes (filtered by organization)
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ruter = await dbService.getAllRuter(req.organizationId);

    const response: ApiResponse<(Rute & { antall_kunder: number })[]> = {
      success: true,
      data: ruter,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/ruter/:id
 * Get single route by ID with associated customers
 */
router.get(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    const rute = await dbService.getRuteById(id, req.organizationId);
    if (!rute) {
      throw Errors.notFound('Rute');
    }

    // Get customers in this route
    const kunder = await dbService.getRuteKunder(id);

    const response: ApiResponse<Rute & { kunder: (Kunde & { rekkefolge: number })[] }> = {
      success: true,
      data: { ...rute, kunder },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/ruter
 * Create new route
 */
router.post(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { navn, beskrivelse, planlagt_dato, kunde_ids, total_distanse, total_tid } = req.body;

    if (!navn || typeof navn !== 'string' || navn.trim().length < 2) {
      throw Errors.badRequest('Navn er påkrevd (minimum 2 tegn)');
    }

    if (planlagt_dato && !/^\d{4}-\d{2}-\d{2}$/.test(planlagt_dato)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    const ruteData: CreateRuteRequest & { organization_id?: number } = {
      navn: navn.trim(),
      beskrivelse,
      planlagt_dato,
      kunde_ids: kunde_ids || [],
      total_distanse,
      total_tid,
      organization_id: req.organizationId,
    };

    const rute = await dbService.createRute(ruteData);

    // Add customers to route if provided
    if (kunde_ids && Array.isArray(kunde_ids) && kunde_ids.length > 0) {
      await dbService.setRuteKunder(rute.id, kunde_ids, req.organizationId);
    }

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'rute', rute.id, {
      navn: rute.navn,
      antall_kunder: kunde_ids?.length || 0,
    });

    const response: ApiResponse<Rute> = {
      success: true,
      data: rute,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/ruter/:id
 * Update existing route
 */
router.put(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    const { navn, beskrivelse, planlagt_dato, status, total_distanse, total_tid, kunde_ids } = req.body;

    if (navn !== undefined && (typeof navn !== 'string' || navn.trim().length < 2)) {
      throw Errors.badRequest('Navn må være minimum 2 tegn');
    }

    if (planlagt_dato && !/^\d{4}-\d{2}-\d{2}$/.test(planlagt_dato)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    if (status && !['planlagt', 'fullført'].includes(status)) {
      throw Errors.badRequest('Status må være "planlagt" eller "fullført"');
    }

    const rute = await dbService.updateRute(
      id,
      { navn, beskrivelse, planlagt_dato, status, total_distanse, total_tid },
      req.organizationId
    );

    if (!rute) {
      throw Errors.notFound('Rute');
    }

    // Update customers if provided
    if (kunde_ids !== undefined && Array.isArray(kunde_ids)) {
      await dbService.setRuteKunder(id, kunde_ids, req.organizationId);
    }

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'rute', id, {
      fields: Object.keys(req.body),
    });

    const response: ApiResponse<Rute> = {
      success: true,
      data: rute,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/ruter/:id
 * Delete route
 */
router.delete(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    const deleted = await dbService.deleteRute(id, req.organizationId);
    if (!deleted) {
      throw Errors.notFound('Rute');
    }

    logAudit(apiLogger, 'DELETE', req.user!.userId, 'rute', id);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Rute slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/ruter/:id/complete
 * Mark route as completed and update customer control dates
 */
router.post(
  '/:id/complete',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    const dato = req.body.dato || new Date().toISOString().split('T')[0];
    const kontrollType = req.body.kontrollType || 'both';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    if (!['el', 'brann', 'both'].includes(kontrollType)) {
      throw Errors.badRequest('kontrollType må være "el", "brann", eller "both"');
    }

    const result = await dbService.completeRute(id, dato, kontrollType, req.organizationId);

    if (!result.success) {
      throw Errors.notFound('Rute');
    }

    logAudit(apiLogger, 'COMPLETE_ROUTE', req.user!.userId, 'rute', id, {
      dato,
      kontrollType,
      oppdaterte_kunder: result.oppdaterte_kunder,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        message: `Rute fullført, ${result.oppdaterte_kunder} kunder oppdatert`,
        oppdaterte_kunder: result.oppdaterte_kunder,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

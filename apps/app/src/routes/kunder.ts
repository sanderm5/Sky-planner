/**
 * Customer (Kunder) routes
 * CRUD operations for customers with multi-tenant support
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { validateKunde } from '../utils/validation';
import type { AuthenticatedRequest, Kunde, CreateKundeRequest, ApiResponse } from '../types';

const router: Router = Router();

// Pagination result type
interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// Database service interface (will be injected)
interface KundeDbService {
  getAllKunder(organizationId?: number): Promise<Kunde[]>;
  getAllKunderPaginated(
    organizationId: number,
    options: { limit?: number; offset?: number; search?: string; kategori?: string }
  ): Promise<PaginatedResult<Kunde>>;
  getKundeById(id: number, organizationId?: number): Promise<Kunde | null>;
  getKunderByOmrade(omrade: string, organizationId?: number): Promise<Kunde[]>;
  getKontrollVarsler(dager: number, organizationId?: number): Promise<Kunde[]>;
  createKunde(data: CreateKundeRequest & { organization_id?: number }): Promise<Kunde>;
  updateKunde(id: number, data: Partial<Kunde>, organizationId?: number): Promise<Kunde | null>;
  deleteKunde(id: number, organizationId?: number): Promise<boolean>;
  bulkCompleteKontroll(
    kundeIds: number[],
    type: 'el' | 'brann' | 'begge',
    dato: string,
    organizationId?: number
  ): Promise<number>;
  getOrganizationLimits(organizationId: number): Promise<{ max_kunder: number; current_count: number } | null>;
}

let dbService: KundeDbService;

/**
 * Initialize kunder routes with database service
 */
export function initKunderRoutes(databaseService: KundeDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/kunder
 * Get all customers (filtered by organization)
 * Supports pagination: ?limit=100&offset=0
 * Supports search: ?search=term
 * Supports category filter: ?kategori=El-Kontroll
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const limit = Math.min(Number.parseInt(req.query.limit as string) || 100, 500);
    const offset = Number.parseInt(req.query.offset as string) || 0;
    const search = req.query.search as string | undefined;
    const kategori = req.query.kategori as string | undefined;

    // Check if pagination/filtering is requested
    if (req.query.limit || req.query.offset || req.query.search || req.query.kategori) {
      const result = await dbService.getAllKunderPaginated(req.organizationId!, {
        limit,
        offset,
        search,
        kategori,
      });

      const response: ApiResponse<PaginatedResult<Kunde>> = {
        success: true,
        data: result,
        requestId: req.requestId,
      };

      res.json(response);
    } else {
      // Backward compatible: return all for existing clients
      const kunder = await dbService.getAllKunder(req.organizationId);

      const response: ApiResponse<Kunde[]> = {
        success: true,
        data: kunder,
        requestId: req.requestId,
      };

      res.json(response);
    }
  })
);

/**
 * GET /api/kunder/kontroll-varsler
 * Get customers needing control within N days
 */
router.get(
  '/kontroll-varsler',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const dager = Number.parseInt(req.query.dager as string) || 30;

    const kunder = await dbService.getKontrollVarsler(dager, req.organizationId);

    const response: ApiResponse<Kunde[]> = {
      success: true,
      data: kunder,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/kunder/omrade/:omrade
 * Get customers by area/region
 */
router.get(
  '/omrade/:omrade',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kunder = await dbService.getKunderByOmrade(req.params.omrade, req.organizationId);

    const response: ApiResponse<Kunde[]> = {
      success: true,
      data: kunder,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/kunder/:id
 * Get single customer by ID
 */
router.get(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const kunde = await dbService.getKundeById(id, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    const response: ApiResponse<Kunde> = {
      success: true,
      data: kunde,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/kunder
 * Create new customer
 */
router.post(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Validate input
    const validationErrors = validateKunde(req.body);
    if (validationErrors) {
      throw Errors.validationError(validationErrors);
    }

    // Check quota
    if (req.organizationId) {
      const limits = await dbService.getOrganizationLimits(req.organizationId);
      if (limits && limits.current_count >= limits.max_kunder) {
        throw Errors.quotaExceeded('kunder', limits.max_kunder);
      }
    }

    // Prepare kunde data with defaults
    const kundeData = prepareKundeData(req.body, req.organizationId);

    const kunde = await dbService.createKunde(kundeData);

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'kunde', kunde.id, {
      navn: kunde.navn,
      kategori: kunde.kategori,
    });

    const response: ApiResponse<Kunde> = {
      success: true,
      data: kunde,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/kunder/:id
 * Update existing customer
 */
router.put(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    // Validate input
    const validationErrors = validateKunde(req.body);
    if (validationErrors) {
      throw Errors.validationError(validationErrors);
    }

    // Prepare data (without organization_id - can't change tenant)
    const kundeData = prepareKundeData(req.body);

    const kunde = await dbService.updateKunde(id, kundeData, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'kunde', id, {
      fields: Object.keys(req.body),
    });

    const response: ApiResponse<Kunde> = {
      success: true,
      data: kunde,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/kunder/:id
 * Delete customer
 */
router.delete(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const deleted = await dbService.deleteKunde(id, req.organizationId);
    if (!deleted) {
      throw Errors.notFound('Kunde');
    }

    logAudit(apiLogger, 'DELETE', req.user!.userId, 'kunde', id);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Kunde slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/kunder/bulk-complete
 * Mark multiple customers as control completed
 */
router.post(
  '/bulk-complete',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { kunde_ids, type, dato } = req.body;

    if (!Array.isArray(kunde_ids) || kunde_ids.length === 0) {
      throw Errors.badRequest('kunde_ids må være en ikke-tom liste');
    }

    if (!['el', 'brann', 'begge'].includes(type)) {
      throw Errors.badRequest('type må være "el", "brann", eller "begge"');
    }

    if (!dato || !/^\d{4}-\d{2}-\d{2}$/.test(dato)) {
      throw Errors.badRequest('dato må være i format YYYY-MM-DD');
    }

    const updated = await dbService.bulkCompleteKontroll(
      kunde_ids,
      type,
      dato,
      req.organizationId
    );

    logAudit(apiLogger, 'BULK_COMPLETE', req.user!.userId, 'kunde', undefined, {
      count: updated,
      type,
      dato,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        updated,
        message: `${updated} kunder oppdatert`,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * Helper: Prepare kunde data with defaults and calculated fields
 */
function prepareKundeData(
  body: CreateKundeRequest,
  organizationId?: number
): CreateKundeRequest & { organization_id?: number } {
  const kategori = body.kategori || 'El-Kontroll';

  // Determine intervals based on category and type
  let elIntervall = body.el_kontroll_intervall;
  let brannIntervall = body.brann_kontroll_intervall;

  if (kategori === 'El-Kontroll' || kategori === 'El-Kontroll + Brannvarsling') {
    elIntervall = elIntervall || (body.el_type === 'Bolig' ? 60 : body.el_type === 'Næring' ? 12 : 36);
  }

  if (kategori === 'Brannvarsling' || kategori === 'El-Kontroll + Brannvarsling') {
    brannIntervall = brannIntervall || 12; // Always 12 months for fire alarms
  }

  return {
    ...body,
    kategori,
    el_kontroll_intervall: elIntervall,
    brann_kontroll_intervall: brannIntervall,
    organization_id: organizationId,
  };
}

export default router;

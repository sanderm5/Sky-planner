/**
 * Today's Work Routes
 * Endpoints for technicians to view and manage their assigned daily routes
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/features';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, Rute, Kunde, ApiResponse } from '../types';

const router: Router = Router();

// Database service interface
interface TodaysWorkDbService {
  getRouteForUserByDate(userId: number, date: string, organizationId: number): Promise<(Rute & { kunder?: Kunde[] }) | null>;
  getRuteKunder(ruteId: number): Promise<(Kunde & { rekkefolge: number })[]>;
  getVisitRecords?(ruteId: number, organizationId: number): Promise<Array<{
    id: number;
    kunde_id: number;
    visited_at?: string;
    completed: boolean;
    comment?: string;
    materials_used?: string[];
  }>>;
  upsertVisitRecord?(ruteId: number, kundeId: number, organizationId: number, data: {
    visited_at: string;
    completed: boolean;
    comment?: string;
    materials_used?: string[];
  }): Promise<{ id: number }>;
  updateRute(id: number, data: Partial<Rute> & { execution_started_at?: string; execution_ended_at?: string; current_stop_index?: number }, organizationId?: number): Promise<Rute | null>;
  createVisitRecords?(ruteId: number, kundeIds: number[], organizationId: number): Promise<void>;
  updateKunde(id: number, data: Partial<Kunde>, organizationId?: number): Promise<Kunde | null>;
}

let dbService: TodaysWorkDbService;

/**
 * Initialize todays-work routes with database service
 */
export function initTodaysWorkRoutes(databaseService: TodaysWorkDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/todays-work/my-route
 * Get the current user's assigned route for a specific date
 * Query: ?date=YYYY-MM-DD (defaults to today)
 */
router.get(
  '/my-route',
  requireTenantAuth,
  requireFeature('todays_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    const rute = await dbService.getRouteForUserByDate(
      req.user!.userId,
      dateStr,
      req.organizationId!
    );

    if (!rute) {
      const response: ApiResponse = {
        success: true,
        data: null,
        requestId: req.requestId,
      };
      res.json(response);
      return;
    }

    // Get customers on the route
    const kunder = await dbService.getRuteKunder(rute.id);

    // Get visit records if available
    let visits: Array<{ id: number; kunde_id: number; visited_at?: string; completed: boolean; comment?: string; materials_used?: string[] }> = [];
    if (dbService.getVisitRecords) {
      visits = await dbService.getVisitRecords(rute.id, req.organizationId!);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        ...rute,
        kunder,
        visits,
        completed_count: visits.filter(v => v.completed).length,
        total_count: kunder.length,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/todays-work/start-route/:routeId
 * Start route execution (sets execution_started_at)
 */
router.post(
  '/start-route/:routeId',
  requireTenantAuth,
  requireFeature('todays_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const routeId = Number.parseInt(req.params.routeId);
    if (Number.isNaN(routeId)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    await dbService.updateRute(routeId, {
      execution_started_at: new Date().toISOString(),
      current_stop_index: 0,
    } as Partial<Rute>, req.organizationId);

    // Create visit records for tracking
    const kunder = await dbService.getRuteKunder(routeId);
    if (dbService.createVisitRecords) {
      await dbService.createVisitRecords(routeId, kunder.map(k => k.id), req.organizationId!);
    }

    logAudit(apiLogger, 'START_TODAYS_ROUTE', req.user!.userId, 'rute', routeId);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Rute startet', started_at: new Date().toISOString() },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/todays-work/visit/:kundeId
 * Mark a customer as visited with optional notes
 */
router.post(
  '/visit/:kundeId',
  requireTenantAuth,
  requireFeature('todays_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const { rute_id, comment, materials_used, completed = true } = req.body;

    if (!rute_id || typeof rute_id !== 'number') {
      throw Errors.badRequest('rute_id er påkrevd');
    }

    if (!dbService.upsertVisitRecord) {
      throw Errors.internal('Besøksregistrering er ikke tilgjengelig');
    }

    const visit = await dbService.upsertVisitRecord(rute_id, kundeId, req.organizationId!, {
      visited_at: new Date().toISOString(),
      completed,
      comment,
      materials_used,
    });

    // Update customer's last visit date
    if (completed) {
      await dbService.updateKunde(kundeId, {
        last_visit_date: new Date().toISOString().split('T')[0],
      }, req.organizationId);
    }

    logAudit(apiLogger, 'VISIT_CUSTOMER', req.user!.userId, 'rute_kunde_visits', visit.id, {
      ruteId: rute_id,
      kundeId,
    });

    const response: ApiResponse = {
      success: true,
      data: visit,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/todays-work/complete-route/:routeId
 * Mark the entire route as completed
 */
router.post(
  '/complete-route/:routeId',
  requireTenantAuth,
  requireFeature('todays_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const routeId = Number.parseInt(req.params.routeId);
    if (Number.isNaN(routeId)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    await dbService.updateRute(routeId, {
      execution_ended_at: new Date().toISOString(),
      status: 'fullført',
    } as Partial<Rute>, req.organizationId);

    logAudit(apiLogger, 'COMPLETE_TODAYS_ROUTE', req.user!.userId, 'rute', routeId);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Rute fullført', completed_at: new Date().toISOString() },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

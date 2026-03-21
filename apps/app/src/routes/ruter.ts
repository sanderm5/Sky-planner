/**
 * Ruter (Routes/Trips) routes
 * CRUD operations for service routes with multi-tenant support
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth, requireRole } from '../middleware/auth';
import { requireFeature } from '../middleware/features';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { broadcast } from '../services/websocket';
import type { AuthenticatedRequest, Rute, Kunde, Avtale, ApiResponse, CreateRuteRequest } from '../types';

const router: Router = Router();

// Database service interface (will be injected)
interface RuteDbService {
  getAllRuter(organizationId?: number): Promise<(Rute & { antall_kunder: number })[]>;
  getRuteById(id: number, organizationId?: number): Promise<(Rute & { kunder?: Kunde[] }) | null>;
  createRute(data: CreateRuteRequest & { organization_id?: number }): Promise<Rute>;
  updateRute(id: number, data: Partial<Rute> & { kunde_ids?: number[]; execution_started_at?: string; execution_ended_at?: string; current_stop_index?: number }, organizationId?: number): Promise<Rute | null>;
  deleteRute(id: number, organizationId?: number): Promise<boolean>;
  completeRute(id: number, dato: string, kontrollType: 'el' | 'brann' | 'both', organizationId?: number): Promise<{ success: boolean; oppdaterte_kunder: number }>;
  getRuteKunder(ruteId: number): Promise<(Kunde & { rekkefolge: number })[]>;
  setRuteKunder(ruteId: number, kundeIds: number[], organizationId?: number): Promise<void>;
  // Field work visit methods (optional - may not be available until migration runs)
  createVisitRecords?(ruteId: number, kundeIds: number[], organizationId: number): Promise<void>;
  upsertVisitRecord?(ruteId: number, kundeId: number, organizationId: number, data: { visited_at: string; completed: boolean; comment?: string; materials_used?: string[]; equipment_registered?: string[]; todos?: string[] }): Promise<{ id: number }>;
  getVisitRecords?(ruteId: number, organizationId: number): Promise<Array<{ id: number; kunde_id: number; visited_at?: string; completed: boolean; comment?: string; materials_used?: string[]; equipment_registered?: string[]; todos?: string[] }>>;
  updateKunde(id: number, data: Partial<Kunde>, organizationId?: number): Promise<Kunde | null>;
  createAvtale(data: Partial<Avtale> & { organization_id: number }): Promise<Avtale & { kunde_navn?: string }>;
  deleteAvtalerByRuteId(ruteId: number, organizationId: number): Promise<number>;
  getActiveTeamMembersForOrg?(organizationId: number): Promise<Array<{ id: number; navn: string }>>;
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
 * GET /api/ruter/find-by-date
 * Find an existing route by date and name (for idempotent weekplan saves)
 * Query: ?date=YYYY-MM-DD&name=Uke 12 - Mandag
 */
router.get(
  '/find-by-date',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const date = req.query.date as string;
    const name = req.query.name as string;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw Errors.badRequest('date er påkrevd (YYYY-MM-DD)');
    }
    if (!name) {
      throw Errors.badRequest('name er påkrevd');
    }

    // Find route matching date + name for this org
    const allRuter = await dbService.getAllRuter(req.organizationId);
    const match = allRuter.find(r => {
      const ruteDate = (r as any).planned_date || (r as any).planlagt_dato;
      return ruteDate === date && r.navn === name;
    });

    const response: ApiResponse = {
      success: true,
      data: match || null,
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
  requireRole('teammedlem'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { navn, beskrivelse, planlagt_dato, kunde_ids, total_distanse, total_tid } = req.body;

    if (!navn || typeof navn !== 'string' || navn.trim().length < 2) {
      throw Errors.badRequest('Navn er påkrevd (minimum 2 tegn)');
    }

    if (planlagt_dato && !/^\d{4}-\d{2}-\d{2}$/.test(planlagt_dato)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    const ruteData: CreateRuteRequest & { organization_id?: number; planned_date?: string } = {
      navn: navn.trim(),
      beskrivelse,
      planlagt_dato,
      planned_date: planlagt_dato, // Keep both date columns in sync
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

    // Broadcast to other users
    if (req.organizationId) {
      broadcast(req.organizationId, 'rute_created', rute, req.user?.userId);
    }

    // Auto-create calendar entries if route has date and customers
    if (req.organizationId && planlagt_dato && kunde_ids?.length > 0 && rute.assigned_to) {
      try {
        const ruteKunder = await dbService.getRuteKunder(rute.id);
        let currentMinutes = 8 * 60;

        let memberName: string = req.user?.epost || 'admin';
        if (dbService.getActiveTeamMembersForOrg) {
          try {
            const members = await dbService.getActiveTeamMembersForOrg(req.organizationId);
            const member = members.find(m => m.id === rute.assigned_to);
            if (member) memberName = member.navn;
          } catch { /* fallback */ }
        }

        for (const kunde of ruteKunder) {
          const hours = Math.floor(currentMinutes / 60);
          const mins = currentMinutes % 60;
          const klokkeslett = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
          const varighet = kunde.estimert_tid || 30;

          await dbService.createAvtale({
            kunde_id: kunde.id,
            dato: planlagt_dato,
            klokkeslett,
            type: 'Sky Planner',
            beskrivelse: `${kunde.navn} (rute: ${rute.navn})`,
            status: 'planlagt',
            opprettet_av: memberName,
            organization_id: req.organizationId,
            rute_id: rute.id,
            varighet,
          });

          currentMinutes += varighet + 15;
        }

        broadcast(req.organizationId, 'avtaler_bulk_created', { rute_id: rute.id, count: ruteKunder.length }, req.user?.userId);
      } catch (err) {
        apiLogger.error({ err, ruteId: rute.id }, 'Failed to auto-create calendar entries for new route');
      }
    }

    res.status(201).json(response);
  })
);

/**
 * PUT /api/ruter/:id
 * Update existing route
 */
router.put(
  '/:id',
  requireRole('teammedlem'),
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
      // Note: calendar entries (avtaler) are synced by the /assign endpoint only,
      // to avoid double-creation when PUT + assign are called in sequence.
    }

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'rute', id, {
      fields: Object.keys(req.body),
    });

    const response: ApiResponse<Rute> = {
      success: true,
      data: rute,
      requestId: req.requestId,
    };

    // Broadcast to other users
    if (req.organizationId) {
      broadcast(req.organizationId, 'rute_updated', rute, req.user?.userId);
    }

    res.json(response);
  })
);

/**
 * DELETE /api/ruter/:id
 * Delete route
 */
router.delete(
  '/:id',
  requireRole('teammedlem'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    // Delete associated calendar entries first
    if (req.organizationId) {
      try {
        await dbService.deleteAvtalerByRuteId(id, req.organizationId);
      } catch (err) {
        apiLogger.error({ err, ruteId: id }, 'Failed to delete calendar entries for route');
      }
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

    // Broadcast to other users
    if (req.organizationId) {
      broadcast(req.organizationId, 'rute_deleted', { id }, req.user?.userId);
    }

    res.json(response);
  })
);

/**
 * POST /api/ruter/:id/complete
 * Mark route as completed and update customer control dates
 */
router.post(
  '/:id/complete',
  requireRole('teammedlem'),
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

/**
 * PUT /api/ruter/:id/assign
 * Assign a route to a team member
 */
router.put(
  '/:id/assign',
  requireRole('teammedlem'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    const { assigned_to, planned_date, technician_name: teamMemberName } = req.body;

    if (assigned_to !== null && assigned_to !== undefined && typeof assigned_to !== 'number') {
      throw Errors.badRequest('assigned_to må være et gyldig bruker-ID eller null');
    }

    if (planned_date && !/^\d{4}-\d{2}-\d{2}$/.test(planned_date)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    const rute = await dbService.updateRute(
      id,
      { assigned_to, planned_date } as Partial<Rute>,
      req.organizationId
    );

    if (!rute) {
      throw Errors.notFound('Rute');
    }

    logAudit(apiLogger, 'ASSIGN_ROUTE', req.user!.userId, 'rute', id, {
      assigned_to,
      planned_date,
    });

    const response: ApiResponse<Rute> = {
      success: true,
      data: rute,
      requestId: req.requestId,
    };

    // Broadcast assignment to other users (important for ukeplanlegger)
    if (req.organizationId) {
      broadcast(req.organizationId, 'rute_updated', rute, req.user?.userId);
    }

    // Auto-sync: opprett/oppdater kalenderavtaler for kundene i ruten
    if (req.organizationId) {
      try {
        // Alltid slett gamle auto-genererte avtaler for denne ruten
        await dbService.deleteAvtalerByRuteId(id, req.organizationId);

        // Opprett nye avtaler hvis ruten har tekniker + dato
        if (planned_date && assigned_to) {
          const ruteKunder = await dbService.getRuteKunder(id);
          let currentMinutes = 8 * 60; // Start kl 08:00

          // Use team member name from request (sent by frontend) as primary source,
          // then try DB lookup, then fall back to current user's email
          let memberName: string = '';
          if (teamMemberName && typeof teamMemberName === 'string' && teamMemberName.trim()) {
            memberName = teamMemberName.trim();
          }
          if (!memberName && dbService.getActiveTeamMembersForOrg) {
            try {
              const members = await dbService.getActiveTeamMembersForOrg(req.organizationId!);
              const member = members.find(m => m.id === assigned_to);
              if (member) memberName = member.navn;
            } catch { /* fallback below */ }
          }
          if (!memberName) {
            memberName = req.user?.epost || 'admin';
          }

          for (const kunde of ruteKunder) {
            const hours = Math.floor(currentMinutes / 60);
            const mins = currentMinutes % 60;
            const klokkeslett = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
            const varighet = kunde.estimert_tid || 30;

            await dbService.createAvtale({
              kunde_id: kunde.id,
              dato: planned_date,
              klokkeslett,
              type: 'Sky Planner',
              beskrivelse: `${kunde.navn} (rute: ${rute.navn})`,
              status: 'planlagt',
              opprettet_av: memberName,
              organization_id: req.organizationId,
              rute_id: id,
              varighet,
            });

            currentMinutes += varighet + 15; // 15 min reisetid mellom kunder
          }

          apiLogger.info({ ruteId: id, kundeCount: ruteKunder.length, planned_date }, 'Auto-created calendar entries for route');
          broadcast(req.organizationId, 'avtaler_bulk_created', { rute_id: id, count: ruteKunder.length }, req.user?.userId);
        }
      } catch (err) {
        apiLogger.error({ err, ruteId: id }, 'Failed to auto-sync calendar for route');
        // Ikke feil ut hele requesten — tildeling er allerede lagret
      }
    }

    res.json(response);
  })
);

// ========================================
// FIELD WORK MODE (Feature: field_work)
// ========================================

/**
 * POST /api/ruter/:id/start-execution
 * Start field work mode for a route
 */
router.post(
  '/:id/start-execution',
  requireRole('teammedlem'),
  requireFeature('field_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    const rute = await dbService.getRuteById(id, req.organizationId);
    if (!rute) {
      throw Errors.notFound('Rute');
    }

    // Update route with execution start time
    await dbService.updateRute(id, {
      execution_started_at: new Date().toISOString(),
      current_stop_index: 0,
    } as Partial<Rute>, req.organizationId);

    // Create visit records for each customer in the route
    const kunder = await dbService.getRuteKunder(id);
    if (dbService.createVisitRecords) {
      await dbService.createVisitRecords(id, kunder.map(k => k.id), req.organizationId!);
    }

    logAudit(apiLogger, 'START_FIELD_WORK', req.user!.userId, 'rute', id, {
      antall_kunder: kunder.length,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Feltarbeid startet',
        antall_stopp: kunder.length,
        started_at: new Date().toISOString(),
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/ruter/:id/visit-customer
 * Record a customer visit during field work
 */
router.post(
  '/:id/visit-customer',
  requireRole('teammedlem'),
  requireFeature('field_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ruteId = Number.parseInt(req.params.id);
    if (Number.isNaN(ruteId)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    const { kunde_id, comment, materials_used, equipment_registered, todos, completed } = req.body;

    if (!kunde_id || typeof kunde_id !== 'number') {
      throw Errors.badRequest('kunde_id er påkrevd');
    }

    const rute = await dbService.getRuteById(ruteId, req.organizationId);
    if (!rute) {
      throw Errors.notFound('Rute');
    }

    if (!dbService.upsertVisitRecord) {
      throw Errors.internal('Besøksregistrering er ikke tilgjengelig');
    }

    const visit = await dbService.upsertVisitRecord(ruteId, kunde_id, req.organizationId!, {
      visited_at: new Date().toISOString(),
      completed: completed ?? true,
      comment,
      materials_used,
      equipment_registered,
      todos,
    });

    // Also update last_visit_date on the customer when marked as completed
    if (completed) {
      await dbService.updateKunde(kunde_id, {
        last_visit_date: new Date().toISOString().split('T')[0],
      }, req.organizationId);
    }

    logAudit(apiLogger, 'VISIT_CUSTOMER', req.user!.userId, 'rute_kunde_visits', visit.id, {
      ruteId,
      kundeId: kunde_id,
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
 * GET /api/ruter/:id/visits
 * Get all visit records for a route
 */
router.get(
  '/:id/visits',
  requireTenantAuth,
  requireFeature('field_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ruteId = Number.parseInt(req.params.id);
    if (Number.isNaN(ruteId)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    const rute = await dbService.getRuteById(ruteId, req.organizationId);
    if (!rute) {
      throw Errors.notFound('Rute');
    }

    if (!dbService.getVisitRecords) {
      throw Errors.internal('Besøksregistrering er ikke tilgjengelig');
    }

    const visits = await dbService.getVisitRecords(ruteId, req.organizationId!);

    const response: ApiResponse = {
      success: true,
      data: visits,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/ruter/:id/end-execution
 * End field work mode for a route
 */
router.post(
  '/:id/end-execution',
  requireRole('teammedlem'),
  requireFeature('field_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig rute-ID');
    }

    const rute = await dbService.getRuteById(id, req.organizationId);
    if (!rute) {
      throw Errors.notFound('Rute');
    }

    await dbService.updateRute(id, {
      execution_ended_at: new Date().toISOString(),
    } as Partial<Rute>, req.organizationId);

    // Get visit summary
    let visitSummary = { total: 0, completed: 0 };
    if (dbService.getVisitRecords) {
      const visits = await dbService.getVisitRecords(id, req.organizationId!);
      visitSummary = {
        total: visits.length,
        completed: visits.filter((v: { completed: boolean }) => v.completed).length,
      };
    }

    logAudit(apiLogger, 'END_FIELD_WORK', req.user!.userId, 'rute', id, visitSummary);

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Feltarbeid avsluttet',
        ...visitSummary,
        ended_at: new Date().toISOString(),
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/ruter/:id/add-customer
 * Quick-add a customer to an existing route (mobile admin)
 */
router.post(
  '/:id/add-customer',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ruteId = parseInt(req.params.id);
    const { kunde_id } = req.body;

    if (!kunde_id || isNaN(Number(kunde_id))) {
      res.status(400).json({ success: false, error: 'kunde_id er påkrevd' });
      return;
    }

    const rute = await dbService.getRuteById(ruteId, req.organizationId);
    if (!rute) {
      res.status(404).json({ success: false, error: 'Rute ikke funnet' });
      return;
    }

    // Get current customers on the route
    const existingKunder = await dbService.getRuteKunder(ruteId);
    const existingIds = existingKunder.map(k => k.id);

    if (existingIds.includes(Number(kunde_id))) {
      res.status(409).json({ success: false, error: 'Kunden er allerede på ruten' });
      return;
    }

    // Append new customer at the end
    const updatedIds = [...existingIds, Number(kunde_id)];
    await dbService.setRuteKunder(ruteId, updatedIds, req.organizationId);

    // Create calendar entry for new customer if route has assignment and date
    const routeDate = rute.planned_date || (rute as any).planlagt_dato;
    if (req.organizationId && rute.assigned_to && routeDate) {
      try {
        // Calculate time slot: after existing stops
        const existingAvtaleCount = existingKunder.length;
        let currentMinutes = 8 * 60 + existingAvtaleCount * 45; // 30min work + 15min travel per stop

        const kunde = await dbService.getRuteKunder(ruteId);
        const newKunde = kunde.find(k => k.id === Number(kunde_id));

        if (newKunde) {
          let memberName: string = req.user?.epost || 'admin';
          if (dbService.getActiveTeamMembersForOrg) {
            try {
              const members = await dbService.getActiveTeamMembersForOrg(req.organizationId);
              const member = members.find(m => m.id === rute.assigned_to);
              if (member) memberName = member.navn;
            } catch { /* fallback */ }
          }

          const hours = Math.floor(currentMinutes / 60);
          const mins = currentMinutes % 60;
          const klokkeslett = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
          const varighet = newKunde.estimert_tid || 30;

          await dbService.createAvtale({
            kunde_id: Number(kunde_id),
            dato: routeDate,
            klokkeslett,
            type: 'Sky Planner',
            beskrivelse: `${newKunde.navn} (rute: ${rute.navn})`,
            status: 'planlagt',
            opprettet_av: memberName,
            organization_id: req.organizationId,
            rute_id: ruteId,
            varighet,
          });

          broadcast(req.organizationId, 'avtale_created', { rute_id: ruteId, kunde_id }, req.user?.userId);
        }
      } catch (err) {
        apiLogger.error({ err, ruteId }, 'Failed to create calendar entry for added customer');
      }
    }

    broadcast(req.organizationId!, 'rute_updated', { ruteId });

    res.json({ success: true, data: { message: 'Kunde lagt til på ruten', total_kunder: updatedIds.length } });
  })
);

export default router;

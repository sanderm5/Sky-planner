/**
 * Today's Work Routes
 * Endpoints for team members to view and manage their assigned daily routes
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/features';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { broadcast } from '../services/websocket';
import type { AuthenticatedRequest, Rute, Kunde, ApiResponse } from '../types';

const router: Router = Router();

// Route with status type (from route-calendar-queries)
interface RouteWithStatus {
  id: number;
  navn: string;
  assigned_to: number | null;
  technician_name: string | null; // team member name (legacy field name)
  planned_date: string;
  total_count: number;
  completed_count: number;
  execution_started_at: string | null;
  execution_ended_at: string | null;
  kunder: Array<{ id: number; navn: string; adresse: string }>;
}

// Database service interface
interface TodaysWorkDbService {
  getRouteForUserByDate(userId: number, date: string, organizationId: number): Promise<(Rute & { kunder?: Kunde[] }) | null>;
  getRuteById(id: number, organizationId: number): Promise<Rute | null>;
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
  getRoutesForDateByOrg(date: string, organizationId: number): Promise<RouteWithStatus[]>;
  getActiveTeamMembersForOrg(organizationId: number): Promise<Array<{ id: number; navn: string }>>;
  getKundeById(id: number, organizationId?: number): Promise<Kunde | null>;
  getOrganizationById?(id: number): Promise<{ id: number; navn: string } | null>;
  getKontaktloggByKunde(kundeId: number, organizationId: number): Promise<Array<{ id: number; type: string; notat?: string; dato: string }>>;
  createKontaktlogg(data: { kunde_id: number; type: string; notat: string; opprettet_av: string; organization_id: number }): Promise<{ id: number }>;
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

    // Fetch route data in parallel
    const [kunder, visits, assignedToName] = await Promise.all([
      dbService.getRuteKunder(rute.id),
      dbService.getVisitRecords
        ? dbService.getVisitRecords(rute.id, req.organizationId!)
        : Promise.resolve([] as Array<{ id: number; kunde_id: number; visited_at?: string; completed: boolean; comment?: string; materials_used?: string[] }>),
      rute.assigned_to
        ? dbService.getActiveTeamMembersForOrg(req.organizationId!)
            .then(members => members.find(m => m.id === rute.assigned_to)?.navn ?? null)
            .catch(() => null)
        : Promise.resolve(null as string | null),
    ]);

    const response: ApiResponse = {
      success: true,
      data: {
        ...rute,
        assigned_to_name: assignedToName,
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

    // Verify user is assigned to this route
    const route = await dbService.getRuteById(routeId, req.organizationId!);
    if (!route) {
      throw Errors.badRequest('Ruten ble ikke funnet');
    }
    if (route.assigned_to && route.assigned_to !== req.user!.userId) {
      throw Errors.forbidden('Du kan kun starte ruter som er tildelt deg');
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

    // Broadcast to other users in the organization
    broadcast(req.organizationId!, 'rute_updated', { id: routeId }, req.user!.userId);
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

    const { rute_id: rawRuteId, comment, materials_used, completed = true } = req.body;

    const ruteId = typeof rawRuteId === 'string' ? parseInt(rawRuteId, 10) : rawRuteId;
    if (!ruteId || typeof ruteId !== 'number' || isNaN(ruteId)) {
      throw Errors.badRequest('rute_id er påkrevd');
    }

    if (!dbService.upsertVisitRecord) {
      throw Errors.internal('Besøksregistrering er ikke tilgjengelig');
    }

    const visit = await dbService.upsertVisitRecord(ruteId, kundeId, req.organizationId!, {
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
      ruteId,
      kundeId,
    });

    const response: ApiResponse = {
      success: true,
      data: visit,
      requestId: req.requestId,
    };

    res.json(response);

    // Broadcast visit update to other users
    broadcast(req.organizationId!, 'rute_updated', { id: ruteId, visit: { kundeId, completed } }, req.user!.userId);
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

    // Verify user is assigned to this route
    const route = await dbService.getRuteById(routeId, req.organizationId!);
    if (!route) {
      throw Errors.badRequest('Ruten ble ikke funnet');
    }
    if (route.assigned_to && route.assigned_to !== req.user!.userId) {
      throw Errors.forbidden('Du kan kun fullføre ruter som er tildelt deg');
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

    // Broadcast route completion to other users
    broadcast(req.organizationId!, 'rute_updated', { id: routeId, status: 'fullført' }, req.user!.userId);
  })
);

/**
 * GET /api/todays-work/team-overview
 * Get all routes for the organization on a given date with team member info and execution status
 * Query: ?date=YYYY-MM-DD (defaults to today)
 */
router.get(
  '/team-overview',
  requireTenantAuth,
  requireFeature('todays_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    const routes = await dbService.getRoutesForDateByOrg(dateStr, req.organizationId!);

    // Get all active team members to find those without a route
    const allMembers = await dbService.getActiveTeamMembersForOrg(req.organizationId!);
    const assignedIds = new Set(routes.map(r => r.assigned_to).filter((id): id is number => id != null));
    const membersWithoutRoute = allMembers
      .filter(m => !assignedIds.has(m.id))
      .map(m => m.navn);

    // Build summary
    let inProgress = 0;
    let completed = 0;
    let notStarted = 0;

    for (const route of routes) {
      if (route.execution_ended_at) {
        completed++;
      } else if (route.execution_started_at) {
        inProgress++;
      } else {
        notStarted++;
      }
    }

    const response: ApiResponse = {
      success: true,
      data: {
        routes,
        summary: {
          total_routes: routes.length,
          in_progress: inProgress,
          completed,
          not_started: notStarted,
          members_without_route: membersWithoutRoute,
        },
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/todays-work/daily-summary
 * Lightweight summary of the day's route execution status
 * Query: ?date=YYYY-MM-DD (defaults to today)
 */
router.get(
  '/daily-summary',
  requireTenantAuth,
  requireFeature('todays_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    const routes = await dbService.getRoutesForDateByOrg(dateStr, req.organizationId!);

    let inProgress = 0;
    let completed = 0;
    let notStarted = 0;
    let totalCustomers = 0;
    let completedCustomers = 0;

    for (const route of routes) {
      totalCustomers += route.total_count;
      completedCustomers += route.completed_count;

      if (route.execution_ended_at) {
        completed++;
      } else if (route.execution_started_at) {
        inProgress++;
      } else {
        notStarted++;
      }
    }

    const response: ApiResponse = {
      success: true,
      data: {
        date: dateStr,
        total_routes: routes.length,
        in_progress: inProgress,
        completed,
        not_started: notStarted,
        total_customers: totalCustomers,
        completed_customers: completedCustomers,
        completion_percentage: totalCustomers > 0
          ? Math.round((completedCustomers / totalCustomers) * 100)
          : 0,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/todays-work/team-overview-week
 * Get all routes for a week grouped by team member
 * Query: ?week_start=YYYY-MM-DD (Monday of the week)
 */
router.get(
  '/team-overview-week',
  requireTenantAuth,
  requireFeature('todays_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const weekStartStr = req.query.week_start as string;

    if (!weekStartStr || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
      throw Errors.badRequest('week_start er påkrevd (YYYY-MM-DD, mandag)');
    }

    // Generate 5 weekday dates (Mon-Fri) using pure string arithmetic to avoid timezone issues
    const dates: string[] = [];
    const [y, m, day] = weekStartStr.split('-').map(Number);
    for (let i = 0; i < 5; i++) {
      const d = new Date(y, m - 1, day + i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dates.push(ds);
    }

    // Fetch routes for all 5 days in parallel
    const [allMembers, ...dailyRoutes] = await Promise.all([
      dbService.getActiveTeamMembersForOrg(req.organizationId!),
      ...dates.map(date => dbService.getRoutesForDateByOrg(date, req.organizationId!)),
    ]);

    // Build per-member structure
    const memberMap = new Map<number, { id: number; navn: string; days: Record<string, RouteWithStatus[]> }>();
    const unassigned: Record<string, RouteWithStatus[]> = {};
    let totalRoutes = 0;
    let assignedCount = 0;
    let unassignedCount = 0;
    let totalCustomers = 0;

    for (const member of allMembers) {
      const days: Record<string, RouteWithStatus[]> = {};
      for (const date of dates) days[date] = [];
      memberMap.set(member.id, { id: member.id, navn: member.navn, days });
    }
    for (const date of dates) unassigned[date] = [];

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const routes = dailyRoutes[i];

      // Deduplicate routes: same (name + assigned_to) = keep newest (highest id)
      // Also: if an assigned route exists, drop unassigned duplicates with the same name
      const seenRouteKeys = new Map<string, RouteWithStatus>();
      for (const route of routes) {
        // Key includes assigned_to so different members' routes are kept
        const key = `${route.assigned_to || 0}_${route.navn}`;
        const existing = seenRouteKeys.get(key);
        if (!existing || route.id > existing.id) {
          seenRouteKeys.set(key, route);
        }
      }
      // Remove unassigned duplicates if an assigned version with the same name exists
      const assignedNames = new Set<string>();
      for (const route of seenRouteKeys.values()) {
        if (route.assigned_to) assignedNames.add(route.navn);
      }
      const dedupedRoutes: RouteWithStatus[] = [];
      for (const route of seenRouteKeys.values()) {
        // Skip unassigned routes that have an assigned counterpart
        if (!route.assigned_to && assignedNames.has(route.navn)) continue;
        dedupedRoutes.push(route);
      }

      for (const route of dedupedRoutes) {
        totalRoutes++;
        totalCustomers += route.total_count;

        if (route.assigned_to) {
          // If member not in memberMap (e.g. inactive or owner account), add them dynamically
          if (!memberMap.has(route.assigned_to)) {
            const memberName = route.technician_name || `Bruker #${route.assigned_to}`;
            const days: Record<string, RouteWithStatus[]> = {};
            for (const d of dates) days[d] = [];
            memberMap.set(route.assigned_to, { id: route.assigned_to, navn: memberName, days });
          }
          memberMap.get(route.assigned_to)!.days[date].push(route);
          assignedCount++;
        } else {
          unassigned[date].push(route);
          unassignedCount++;
        }
      }
    }

    const response: ApiResponse = {
      success: true,
      data: {
        dates,
        members: Array.from(memberMap.values()),
        unassigned,
        summary: {
          total_routes: totalRoutes,
          assigned: assignedCount,
          unassigned: unassignedCount,
          total_customers: totalCustomers,
        },
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ========================================
// NOTIFY CUSTOMER ("På vei" email)
// ========================================

// Inline email sending via Resend API (same pattern as customer-emails.ts)
async function sendEmailViaResend(
  to: string, subject: string, html: string, fromEmail: string, fromName: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY || '';
  if (!resendApiKey) {
    return { success: false, error: 'E-post er ikke konfigurert (RESEND_API_KEY mangler)' };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to, subject, html }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: (err as { message?: string }).message || 'Kunne ikke sende e-post' };
    }
    const data = await response.json() as { id: string };
    return { success: true, messageId: data.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ukjent feil' };
  }
}

function wrapInNotifyEmailTemplate(bodyHtml: string, orgName: string): string {
  return `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>body{margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}</style></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f4f4f5"><tr><td align="center" style="padding:40px 20px">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:24px 40px;border-radius:12px 12px 0 0;text-align:center">
<h1 style="margin:0;color:#fff;font-size:24px;font-weight:700">${escapeHtml(orgName)}</h1></td></tr>
<tr><td style="background:#fff;padding:32px 40px;border-radius:0 0 12px 12px;font-size:15px;line-height:1.6;color:#333">${bodyHtml}</td></tr>
<tr><td style="padding:24px 40px;text-align:center"><p style="margin:0;color:#a1a1aa;font-size:12px">&copy; ${new Date().getFullYear()} ${escapeHtml(orgName)}</p></td></tr>
</table></td></tr></table></body></html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * POST /api/todays-work/notify-customer/:kundeId
 * Send a "we're on our way" email to the next customer on the route
 */
router.post(
  '/notify-customer/:kundeId',
  requireTenantAuth,
  requireFeature('todays_work'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const estimertTid = Number.parseInt(req.body.estimert_tid) || 10;
    if (estimertTid < 1 || estimertTid > 180) {
      throw Errors.badRequest('Estimert tid må være mellom 1 og 180 minutter');
    }

    // Get customer
    const kunde = await dbService.getKundeById(kundeId, req.organizationId!);
    if (!kunde) {
      throw Errors.badRequest('Kunden ble ikke funnet');
    }

    if (!kunde.epost) {
      throw Errors.badRequest('Kunden har ikke registrert e-postadresse');
    }

    // Check for duplicate: already sent today
    const today = new Date().toISOString().split('T')[0];
    const kontaktlogg = await dbService.getKontaktloggByKunde(kundeId, req.organizationId!);
    const alreadySent = kontaktlogg.some(k =>
      k.type === 'E-post' &&
      k.notat?.includes('[På vei]') &&
      k.dato?.startsWith(today)
    );
    if (alreadySent) {
      throw Errors.badRequest('Varsel er allerede sendt til denne kunden i dag');
    }

    // Get org name
    let orgName = 'Sky Planner';
    if (dbService.getOrganizationById) {
      const org = await dbService.getOrganizationById(req.organizationId!);
      if (org) orgName = org.navn;
    }

    // Get technician name from team members (not available on JWT payload)
    let technicianName = req.user?.epost || 'Tekniker';
    try {
      const members = await dbService.getActiveTeamMembersForOrg(req.organizationId!);
      const member = members.find(m => m.id === req.user!.userId);
      if (member) technicianName = member.navn;
    } catch { /* fallback to email */ }
    const contactName = escapeHtml(kunde.kontaktperson || kunde.navn);

    // Build email
    const subject = `Vi er på vei — ${orgName}`;
    const bodyHtml = `
      <p>Hei ${contactName},</p>
      <p>Vi er på vei til dere og anslår å være hos dere om ca. <strong>${estimertTid} minutter</strong>.</p>
      <p>Med vennlig hilsen,<br>${escapeHtml(technicianName)}<br>${escapeHtml(orgName)}</p>
    `;
    const html = wrapInNotifyEmailTemplate(bodyHtml, orgName);

    // Send email
    const fromEmail = process.env.EMAIL_FROM || 'noreply@skyplanner.no';
    const result = await sendEmailViaResend(kunde.epost, subject, html, fromEmail, orgName);

    if (!result.success) {
      throw Errors.internal(result.error || 'Kunne ikke sende e-post');
    }

    // Log to kontaktlogg
    await dbService.createKontaktlogg({
      kunde_id: kundeId,
      type: 'E-post',
      notat: `[På vei] Varsel sendt til ${kunde.epost} — anslått ${estimertTid} min`,
      opprettet_av: req.user?.epost || '',
      organization_id: req.organizationId!,
    });

    logAudit(apiLogger, 'NOTIFY_CUSTOMER_ON_WAY', req.user!.userId, 'kunde', kundeId, {
      estimert_tid: estimertTid,
    });

    const response: ApiResponse = {
      success: true,
      data: { message: 'Varsel sendt', epost: kunde.epost },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

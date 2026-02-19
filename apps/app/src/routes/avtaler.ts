/**
 * Avtaler (Appointments) routes
 * CRUD operations for appointments/calendar with multi-tenant support
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { broadcast } from '../services/websocket';
import type { AuthenticatedRequest, Avtale, ApiResponse, CreateAvtaleRequest, Organization, Kunde } from '../types';

const router: Router = Router();

// Extended avtale with customer info from JOIN
interface AvtaleMedKunde extends Avtale {
  kunde_navn?: string;
  adresse?: string;
  postnummer?: string;
  poststed?: string;
  telefon?: string;
  kategori?: string;
}

// Database service interface (will be injected)
interface AvtaleDbService {
  getAllAvtaler(organizationId?: number, start?: string, end?: string): Promise<AvtaleMedKunde[]>;
  getAvtaleById(id: number, organizationId?: number): Promise<AvtaleMedKunde | null>;
  createAvtale(data: CreateAvtaleRequest & { organization_id?: number; opprettet_av?: string; er_gjentakelse?: boolean; gjentakelse_regel?: string; gjentakelse_slutt?: string; original_avtale_id?: number }): Promise<AvtaleMedKunde>;
  updateAvtale(id: number, data: Partial<Avtale>, organizationId?: number): Promise<AvtaleMedKunde | null>;
  deleteAvtale(id: number, organizationId?: number): Promise<boolean>;
  deleteAvtaleSeries(parentId: number, organizationId?: number): Promise<number>;
  completeAvtale(id: number, organizationId?: number): Promise<boolean>;
  getOrganizationById(id: number): Promise<Organization | null>;
  getKundeById(id: number, organizationId: number): Promise<Kunde | null>;
}

// Valid recurrence rules
const VALID_GJENTAKELSE = ['daglig', 'ukentlig', 'annenhver_uke', 'manedlig', '3_maneder', '6_maneder', 'arlig'] as const;

/**
 * Expand a recurrence rule into dates from a start date
 */
function expandRecurringDates(startDate: string, regel: string, endDate?: string): string[] {
  const MAX_INSTANCES = 365;
  const dates: string[] = [];
  const start = new Date(startDate);
  const maxEnd = endDate ? new Date(endDate) : new Date(start);
  if (!endDate) {
    maxEnd.setFullYear(maxEnd.getFullYear() + 1); // Default: 1 year ahead
  }

  // Cap end date to max 2 years from start
  const absoluteMax = new Date(start);
  absoluteMax.setFullYear(absoluteMax.getFullYear() + 2);
  if (maxEnd > absoluteMax) {
    maxEnd.setTime(absoluteMax.getTime());
  }

  let current = new Date(start);
  // Skip the first date (parent already has it)
  advanceDate(current, regel);

  while (current <= maxEnd && dates.length < MAX_INSTANCES) {
    dates.push(formatDate(current));
    advanceDate(current, regel);
  }

  return dates;
}

function advanceDate(date: Date, regel: string): void {
  switch (regel) {
    case 'daglig': date.setDate(date.getDate() + 1); break;
    case 'ukentlig': date.setDate(date.getDate() + 7); break;
    case 'annenhver_uke': date.setDate(date.getDate() + 14); break;
    case 'manedlig': date.setMonth(date.getMonth() + 1); break;
    case '3_maneder': date.setMonth(date.getMonth() + 3); break;
    case '6_maneder': date.setMonth(date.getMonth() + 6); break;
    case 'arlig': date.setFullYear(date.getFullYear() + 1); break;
  }
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

let dbService: AvtaleDbService;

/**
 * Initialize avtaler routes with database service
 */
export function initAvtalerRoutes(
  databaseService: AvtaleDbService,
  broadcastFn?: (event: string, data: unknown) => void
): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/avtaler
 * Get all appointments (filtered by organization and date range)
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { start, end } = req.query;

    // Validate date format if provided
    if (start && typeof start === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      throw Errors.badRequest('Ugyldig startdato format (bruk YYYY-MM-DD)');
    }
    if (end && typeof end === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw Errors.badRequest('Ugyldig sluttdato format (bruk YYYY-MM-DD)');
    }

    const avtaler = await dbService.getAllAvtaler(
      req.organizationId,
      start as string | undefined,
      end as string | undefined
    );

    const response: ApiResponse<AvtaleMedKunde[]> = {
      success: true,
      data: avtaler,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/avtaler/:id
 * Get single appointment by ID
 */
router.get(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig avtale-ID');
    }

    const avtale = await dbService.getAvtaleById(id, req.organizationId);
    if (!avtale) {
      throw Errors.notFound('Avtale');
    }

    const response: ApiResponse<AvtaleMedKunde> = {
      success: true,
      data: avtale,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/avtaler
 * Create new appointment
 */
router.post(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { kunde_id, dato, klokkeslett, type, beskrivelse, status, opprettet_av, gjentakelse_regel, gjentakelse_slutt, varighet } = req.body;

    if (!dato || !/^\d{4}-\d{2}-\d{2}$/.test(dato)) {
      throw Errors.badRequest('Dato er påkrevd (format YYYY-MM-DD)');
    }

    if (klokkeslett && !/^\d{2}:\d{2}(:\d{2})?$/.test(klokkeslett)) {
      throw Errors.badRequest('Ugyldig klokkeslett format (bruk HH:MM eller HH:MM:SS)');
    }

    // Validate recurrence rule
    if (gjentakelse_regel && !VALID_GJENTAKELSE.includes(gjentakelse_regel)) {
      throw Errors.badRequest(`Ugyldig gjentakelsesregel. Gyldige verdier: ${VALID_GJENTAKELSE.join(', ')}`);
    }

    if (gjentakelse_slutt && !/^\d{4}-\d{2}-\d{2}$/.test(gjentakelse_slutt)) {
      throw Errors.badRequest('Ugyldig sluttdato for gjentakelse (bruk YYYY-MM-DD)');
    }

    if (status && !['planlagt', 'fullført'].includes(status)) {
      throw Errors.badRequest('Status må være "planlagt" eller "fullført"');
    }

    const isRecurring = !!gjentakelse_regel;

    // Verify customer belongs to this organization
    if (kunde_id) {
      const parsedKundeId = Number.parseInt(kunde_id);
      if (Number.isNaN(parsedKundeId)) {
        throw Errors.badRequest('Ugyldig kunde-ID');
      }
      const kunde = await dbService.getKundeById(parsedKundeId, req.organizationId!);
      if (!kunde) {
        throw Errors.badRequest('Ugyldig kunde-ID');
      }
    }

    // Create the parent avtale
    const avtaleData: CreateAvtaleRequest & { organization_id?: number; opprettet_av?: string; er_gjentakelse?: boolean; gjentakelse_regel?: string; gjentakelse_slutt?: string; varighet?: number } = {
      kunde_id: kunde_id ? Number.parseInt(kunde_id) : undefined,
      dato,
      klokkeslett,
      type: type || undefined,
      beskrivelse,
      organization_id: req.organizationId,
      opprettet_av: opprettet_av || req.user?.epost,
      gjentakelse_regel: gjentakelse_regel || undefined,
      gjentakelse_slutt: gjentakelse_slutt || undefined,
      varighet: varighet ? Number.parseInt(varighet) : undefined,
    };

    if (isRecurring) {
      avtaleData.er_gjentakelse = true;
    }

    const avtale = await dbService.createAvtale(avtaleData);

    // If recurring, create instance rows for future dates
    let instanceCount = 0;
    if (isRecurring) {
      const futureDates = expandRecurringDates(dato, gjentakelse_regel, gjentakelse_slutt);
      for (const instanceDate of futureDates) {
        await dbService.createAvtale({
          ...avtaleData,
          dato: instanceDate,
          er_gjentakelse: false,
          gjentakelse_regel: undefined,
          gjentakelse_slutt: undefined,
          original_avtale_id: avtale.id,
        } as CreateAvtaleRequest & { organization_id?: number; opprettet_av?: string; original_avtale_id?: number });
        instanceCount++;
      }
    }

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'avtale', avtale.id, {
      dato: avtale.dato,
      type: avtale.type,
      kunde_id: avtale.kunde_id,
      recurring: isRecurring,
      instanceCount,
    });

    // Broadcast to other users
    if (req.organizationId) {
      broadcast(req.organizationId, 'avtale_created', avtale, req.user?.userId);
    }

    const response: ApiResponse<AvtaleMedKunde> = {
      success: true,
      data: avtale,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/avtaler/:id
 * Update existing appointment
 */
router.put(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig avtale-ID');
    }

    const { kunde_id, dato, klokkeslett, type, beskrivelse, status, varighet } = req.body;

    if (dato && !/^\d{4}-\d{2}-\d{2}$/.test(dato)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    if (klokkeslett && !/^\d{2}:\d{2}(:\d{2})?$/.test(klokkeslett)) {
      throw Errors.badRequest('Ugyldig klokkeslett format (bruk HH:MM eller HH:MM:SS)');
    }

    if (status && !['planlagt', 'fullført'].includes(status)) {
      throw Errors.badRequest('Status må være "planlagt" eller "fullført"');
    }

    const avtale = await dbService.updateAvtale(
      id,
      { kunde_id, dato, klokkeslett, type, beskrivelse, status, varighet: varighet ? Number.parseInt(varighet) : undefined },
      req.organizationId
    );

    if (!avtale) {
      throw Errors.notFound('Avtale');
    }

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'avtale', id, {
      fields: Object.keys(req.body),
    });

    // Broadcast to other users
    if (req.organizationId) {
      broadcast(req.organizationId, 'avtale_updated', avtale, req.user?.userId);
    }

    const response: ApiResponse<AvtaleMedKunde> = {
      success: true,
      data: avtale,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/avtaler/:id
 * Delete appointment
 */
router.delete(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig avtale-ID');
    }

    const deleted = await dbService.deleteAvtale(id, req.organizationId);
    if (!deleted) {
      throw Errors.notFound('Avtale');
    }

    logAudit(apiLogger, 'DELETE', req.user!.userId, 'avtale', id);

    // Broadcast to WebSocket clients
    if (req.organizationId) {
      broadcast(req.organizationId, 'avtale_deleted', { id }, req.user?.userId);
    }

    const response: ApiResponse = {
      success: true,
      data: { message: 'Avtale slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/avtaler/:id/series
 * Delete entire recurring series (parent + all instances)
 */
router.delete(
  '/:id/series',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig avtale-ID');
    }

    const avtale = await dbService.getAvtaleById(id, req.organizationId);
    if (!avtale) {
      throw Errors.notFound('Avtale');
    }

    // Find the parent ID (could be this avtale or its parent)
    const parentId = avtale.original_avtale_id || avtale.id;
    const deletedCount = await dbService.deleteAvtaleSeries(parentId, req.organizationId);

    logAudit(apiLogger, 'DELETE_SERIES', req.user!.userId, 'avtale', parentId, { deletedCount });

    if (req.organizationId) {
      broadcast(req.organizationId, 'avtale_series_deleted', { parentId, deletedCount }, req.user?.userId);
    }

    const response: ApiResponse = {
      success: true,
      data: { message: `${deletedCount} avtaler slettet`, deletedCount },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/avtaler/:id/complete
 * Mark appointment as completed
 */
router.post(
  '/:id/complete',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig avtale-ID');
    }

    const success = await dbService.completeAvtale(id, req.organizationId);
    if (!success) {
      throw Errors.notFound('Avtale');
    }

    logAudit(apiLogger, 'COMPLETE', req.user!.userId, 'avtale', id);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Avtale markert som fullført' },
      requestId: req.requestId,
    };

    // Broadcast completion to other users
    if (req.organizationId) {
      broadcast(req.organizationId, 'avtale_updated', { id, status: 'fullført' }, req.user?.userId);
    }

    res.json(response);
  })
);

export default router;

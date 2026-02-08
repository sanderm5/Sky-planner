/**
 * Avtaler (Appointments) routes
 * CRUD operations for appointments/calendar with multi-tenant support
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, Avtale, ApiResponse, CreateAvtaleRequest, Organization } from '../types';

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
  createAvtale(data: CreateAvtaleRequest & { organization_id?: number; opprettet_av?: string }): Promise<AvtaleMedKunde>;
  updateAvtale(id: number, data: Partial<Avtale>, organizationId?: number): Promise<AvtaleMedKunde | null>;
  deleteAvtale(id: number, organizationId?: number): Promise<boolean>;
  completeAvtale(id: number, organizationId?: number): Promise<boolean>;
  getOrganizationById(id: number): Promise<Organization | null>;
}

// WebSocket broadcast function (optional)
let wsBroadcast: ((event: string, data: unknown) => void) | null = null;

let dbService: AvtaleDbService;

/**
 * Initialize avtaler routes with database service
 */
export function initAvtalerRoutes(
  databaseService: AvtaleDbService,
  broadcastFn?: (event: string, data: unknown) => void
): Router {
  dbService = databaseService;
  wsBroadcast = broadcastFn || null;
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
    const { kunde_id, dato, klokkeslett, type, beskrivelse, status, opprettet_av } = req.body;

    if (!dato || !/^\d{4}-\d{2}-\d{2}$/.test(dato)) {
      throw Errors.badRequest('Dato er påkrevd (format YYYY-MM-DD)');
    }

    if (klokkeslett && !/^\d{2}:\d{2}(:\d{2})?$/.test(klokkeslett)) {
      throw Errors.badRequest('Ugyldig klokkeslett format (bruk HH:MM eller HH:MM:SS)');
    }

    // Validate type based on app_mode
    const org = req.organizationId ? await dbService.getOrganizationById(req.organizationId) : null;
    const appMode = org?.app_mode ?? 'mvp';

    if (appMode === 'full') {
      if (type && !['El-Kontroll', 'Brannvarsling'].includes(type)) {
        throw Errors.badRequest('Type må være "El-Kontroll" eller "Brannvarsling"');
      }
    }

    if (status && !['planlagt', 'fullført'].includes(status)) {
      throw Errors.badRequest('Status må være "planlagt" eller "fullført"');
    }

    const avtaleData: CreateAvtaleRequest & { organization_id?: number; opprettet_av?: string } = {
      kunde_id: kunde_id ? Number.parseInt(kunde_id) : undefined,
      dato,
      klokkeslett,
      type: appMode === 'full' ? (type || 'El-Kontroll') : (type || undefined),
      beskrivelse,
      organization_id: req.organizationId,
      opprettet_av: opprettet_av || req.user?.epost,
    };

    const avtale = await dbService.createAvtale(avtaleData);

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'avtale', avtale.id, {
      dato: avtale.dato,
      type: avtale.type,
      kunde_id: avtale.kunde_id,
    });

    // Broadcast to WebSocket clients
    if (wsBroadcast) {
      wsBroadcast('avtale_created', avtale);
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

    const { kunde_id, dato, klokkeslett, type, beskrivelse, status } = req.body;

    if (dato && !/^\d{4}-\d{2}-\d{2}$/.test(dato)) {
      throw Errors.badRequest('Ugyldig datoformat (bruk YYYY-MM-DD)');
    }

    if (klokkeslett && !/^\d{2}:\d{2}(:\d{2})?$/.test(klokkeslett)) {
      throw Errors.badRequest('Ugyldig klokkeslett format (bruk HH:MM eller HH:MM:SS)');
    }

    // Validate type based on app_mode
    const org = req.organizationId ? await dbService.getOrganizationById(req.organizationId) : null;
    const appMode = org?.app_mode ?? 'mvp';

    if (appMode === 'full') {
      if (type && !['El-Kontroll', 'Brannvarsling'].includes(type)) {
        throw Errors.badRequest('Type må være "El-Kontroll" eller "Brannvarsling"');
      }
    }

    if (status && !['planlagt', 'fullført'].includes(status)) {
      throw Errors.badRequest('Status må være "planlagt" eller "fullført"');
    }

    const avtale = await dbService.updateAvtale(
      id,
      { kunde_id, dato, klokkeslett, type, beskrivelse, status },
      req.organizationId
    );

    if (!avtale) {
      throw Errors.notFound('Avtale');
    }

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'avtale', id, {
      fields: Object.keys(req.body),
    });

    // Broadcast to WebSocket clients
    if (wsBroadcast) {
      wsBroadcast('avtale_updated', avtale);
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
    if (wsBroadcast) {
      wsBroadcast('avtale_deleted', { id });
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

    res.json(response);
  })
);

export default router;

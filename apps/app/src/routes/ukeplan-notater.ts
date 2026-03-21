/**
 * Ukeplan Notater (Weekly Plan Notes) routes
 * CRUD operations for per-customer weekly notes/reminders (huskeliste)
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse } from '../types';
import type { UkeplanNotat } from '../services/database/ukeplan-notater-queries';

const router: Router = Router();

const VALID_NOTE_TYPES = ['ring', 'besok', 'bestill', 'oppfolging', 'notat'];
const VALID_MALDAG = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lordag', 'sondag'];

// Database service interface (injected)
interface UkeplanNotaterDbService {
  getUkeplanNotater(organizationId: number, ukeStart: string): Promise<UkeplanNotat[]>;
  getOverforteNotater(organizationId: number, currentUkeStart: string): Promise<UkeplanNotat[]>;
  createUkeplanNotat(data: { organization_id: number; kunde_id: number; uke_start: string; notat: string; opprettet_av?: string; type?: string; tilordnet?: string; maldag?: string; overfort_fra?: number }): Promise<UkeplanNotat>;
  updateUkeplanNotat(id: number, organizationId: number, data: { notat?: string; fullfort?: boolean; type?: string; tilordnet?: string | null; maldag?: string | null }): Promise<UkeplanNotat | null>;
  deleteUkeplanNotat(id: number, organizationId: number): Promise<boolean>;
}

let dbService: UkeplanNotaterDbService;

/**
 * Initialize ukeplan-notater routes with database service
 */
export function initUkeplanNotaterRoutes(databaseService: UkeplanNotaterDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/ukeplan-notater?uke_start=YYYY-MM-DD
 * Get all notes for a specific week
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ukeStart = req.query.uke_start as string;
    if (!ukeStart || !/^\d{4}-\d{2}-\d{2}$/.test(ukeStart)) {
      throw Errors.badRequest('uke_start må være på formatet YYYY-MM-DD');
    }

    const notater = await dbService.getUkeplanNotater(req.organizationId!, ukeStart);

    const response: ApiResponse<UkeplanNotat[]> = {
      success: true,
      data: notater,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/ukeplan-notater/overforte?uke_start=YYYY-MM-DD
 * Get uncompleted notes from previous weeks
 */
router.get(
  '/overforte',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ukeStart = req.query.uke_start as string;
    if (!ukeStart || !/^\d{4}-\d{2}-\d{2}$/.test(ukeStart)) {
      throw Errors.badRequest('uke_start må være på formatet YYYY-MM-DD');
    }

    const notater = await dbService.getOverforteNotater(req.organizationId!, ukeStart);

    const response: ApiResponse<UkeplanNotat[]> = {
      success: true,
      data: notater,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/ukeplan-notater
 * Create a new note for a customer in a specific week
 */
router.post(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { kunde_id, uke_start, notat, type, tilordnet, maldag, overfort_fra } = req.body;

    if (!kunde_id || !Number.isInteger(Number(kunde_id))) {
      throw Errors.badRequest('Ugyldig kunde_id');
    }
    if (!uke_start || !/^\d{4}-\d{2}-\d{2}$/.test(uke_start)) {
      throw Errors.badRequest('uke_start må være på formatet YYYY-MM-DD');
    }
    if (!notat || typeof notat !== 'string' || notat.trim().length === 0) {
      throw Errors.badRequest('Notat kan ikke være tomt');
    }
    if (type && !VALID_NOTE_TYPES.includes(type)) {
      throw Errors.badRequest(`Ugyldig type. Tillatte verdier: ${VALID_NOTE_TYPES.join(', ')}`);
    }
    if (maldag && !VALID_MALDAG.includes(maldag)) {
      throw Errors.badRequest(`Ugyldig måldag. Tillatte verdier: ${VALID_MALDAG.join(', ')}`);
    }

    const result = await dbService.createUkeplanNotat({
      organization_id: req.organizationId!,
      kunde_id: Number(kunde_id),
      uke_start,
      notat: notat.trim(),
      opprettet_av: req.user?.epost,
      type: type || 'notat',
      tilordnet: tilordnet || undefined,
      maldag: maldag || undefined,
      overfort_fra: overfort_fra ? Number(overfort_fra) : undefined,
    });

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'ukeplan_notat', result.id, {
      kunde_id: Number(kunde_id),
      uke_start,
      type: type || 'notat',
    });

    const response: ApiResponse<UkeplanNotat> = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/ukeplan-notater/:id
 * Update a note (text, completion status, type, assignment, target day)
 */
router.put(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig notat-ID');
    }

    const { notat, fullfort, type, tilordnet, maldag } = req.body;
    const updateData: { notat?: string; fullfort?: boolean; type?: string; tilordnet?: string | null; maldag?: string | null } = {};

    if (notat !== undefined) {
      if (typeof notat !== 'string' || notat.trim().length === 0) {
        throw Errors.badRequest('Notat kan ikke være tomt');
      }
      updateData.notat = notat.trim();
    }
    if (fullfort !== undefined) {
      updateData.fullfort = Boolean(fullfort);
    }
    if (type !== undefined) {
      if (!VALID_NOTE_TYPES.includes(type)) {
        throw Errors.badRequest(`Ugyldig type. Tillatte verdier: ${VALID_NOTE_TYPES.join(', ')}`);
      }
      updateData.type = type;
    }
    if (tilordnet !== undefined) {
      updateData.tilordnet = tilordnet || null;
    }
    if (maldag !== undefined) {
      if (maldag !== null && !VALID_MALDAG.includes(maldag)) {
        throw Errors.badRequest(`Ugyldig måldag. Tillatte verdier: ${VALID_MALDAG.join(', ')}`);
      }
      updateData.maldag = maldag;
    }

    if (Object.keys(updateData).length === 0) {
      throw Errors.badRequest('Ingen data å oppdatere');
    }

    const result = await dbService.updateUkeplanNotat(id, req.organizationId!, updateData);
    if (!result) {
      throw Errors.notFound('Notat');
    }

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'ukeplan_notat', id, updateData);

    const response: ApiResponse<UkeplanNotat> = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/ukeplan-notater/:id
 * Delete a note
 */
router.delete(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig notat-ID');
    }

    const deleted = await dbService.deleteUkeplanNotat(id, req.organizationId!);
    if (!deleted) {
      throw Errors.notFound('Notat');
    }

    logAudit(apiLogger, 'DELETE', req.user!.userId, 'ukeplan_notat', id);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Notat slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

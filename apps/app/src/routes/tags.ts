/**
 * Tags routes
 * CRUD operations for customer tags with multi-tenant support
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse } from '../types';

const router: Router = Router();

interface Tag {
  id: number;
  organization_id: number;
  navn: string;
  farge: string;
  created_at: string;
}

interface TagDbService {
  getTagsByOrganization(organizationId: number): Promise<Tag[]>;
  createTag(data: { organization_id: number; navn: string; farge: string }): Promise<Tag>;
  updateTag(id: number, organizationId: number, data: { navn?: string; farge?: string }): Promise<Tag | null>;
  deleteTag(id: number, organizationId: number): Promise<boolean>;
  getTagsForKunde(kundeId: number, organizationId: number): Promise<Tag[]>;
  addTagToKunde(kundeId: number, tagId: number): Promise<boolean>;
  removeTagFromKunde(kundeId: number, tagId: number): Promise<boolean>;
}

let dbService: TagDbService;

export function initTagRoutes(databaseService: TagDbService): Router {
  dbService = databaseService;
  return router;
}

const VALID_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'] as const;

/**
 * GET /api/tags
 * List all tags for the organization
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const tags = await dbService.getTagsByOrganization(req.organizationId!);

    const response: ApiResponse<Tag[]> = {
      success: true,
      data: tags,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/tags
 * Create a new tag
 */
router.post(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { navn, farge } = req.body;

    if (!navn || typeof navn !== 'string' || navn.trim().length === 0) {
      throw Errors.badRequest('Navn er påkrevd');
    }

    if (navn.trim().length > 50) {
      throw Errors.badRequest('Navn kan ikke være lengre enn 50 tegn');
    }

    const color = farge || '#3b82f6';
    if (!VALID_COLORS.includes(color as typeof VALID_COLORS[number])) {
      throw Errors.badRequest('Ugyldig farge');
    }

    const tag = await dbService.createTag({
      organization_id: req.organizationId!,
      navn: navn.trim(),
      farge: color,
    });

    logAudit(apiLogger, 'CREATE_TAG', req.user!.userId, 'tag', tag.id, { navn: tag.navn });

    const response: ApiResponse<Tag> = {
      success: true,
      data: tag,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/tags/:id
 * Update a tag
 */
router.put(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig tag-ID');
    }

    const { navn, farge } = req.body;

    if (navn !== undefined && (typeof navn !== 'string' || navn.trim().length === 0)) {
      throw Errors.badRequest('Navn kan ikke være tomt');
    }

    if (farge && !VALID_COLORS.includes(farge as typeof VALID_COLORS[number])) {
      throw Errors.badRequest('Ugyldig farge');
    }

    const updated = await dbService.updateTag(id, req.organizationId!, {
      ...(navn !== undefined && { navn: navn.trim() }),
      ...(farge !== undefined && { farge }),
    });

    if (!updated) {
      throw Errors.notFound('Tag');
    }

    logAudit(apiLogger, 'UPDATE_TAG', req.user!.userId, 'tag', id);

    const response: ApiResponse<Tag> = {
      success: true,
      data: updated,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/tags/:id
 * Delete a tag (removes from all customers too)
 */
router.delete(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig tag-ID');
    }

    const deleted = await dbService.deleteTag(id, req.organizationId!);
    if (!deleted) {
      throw Errors.notFound('Tag');
    }

    logAudit(apiLogger, 'DELETE_TAG', req.user!.userId, 'tag', id);

    const response: ApiResponse<{ deleted: boolean }> = {
      success: true,
      data: { deleted: true },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/kunder/:kundeId/tags
 * Get tags for a specific customer
 */
router.get(
  '/kunder/:kundeId/tags',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const tags = await dbService.getTagsForKunde(kundeId, req.organizationId!);

    const response: ApiResponse<Tag[]> = {
      success: true,
      data: tags,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/kunder/:kundeId/tags/:tagId
 * Add a tag to a customer
 */
router.post(
  '/kunder/:kundeId/tags/:tagId',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    const tagId = Number.parseInt(req.params.tagId);
    if (Number.isNaN(kundeId) || Number.isNaN(tagId)) {
      throw Errors.badRequest('Ugyldig kunde-ID eller tag-ID');
    }

    const success = await dbService.addTagToKunde(kundeId, tagId);
    if (!success) {
      throw Errors.badRequest('Kunne ikke legge til tag');
    }

    logAudit(apiLogger, 'ADD_KUNDE_TAG', req.user!.userId, 'kunde_tag', kundeId, { tagId });

    const response: ApiResponse<{ success: boolean }> = {
      success: true,
      data: { success: true },
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * DELETE /api/kunder/:kundeId/tags/:tagId
 * Remove a tag from a customer
 */
router.delete(
  '/kunder/:kundeId/tags/:tagId',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    const tagId = Number.parseInt(req.params.tagId);
    if (Number.isNaN(kundeId) || Number.isNaN(tagId)) {
      throw Errors.badRequest('Ugyldig kunde-ID eller tag-ID');
    }

    const success = await dbService.removeTagFromKunde(kundeId, tagId);
    if (!success) {
      throw Errors.notFound('Tag-tilknytning');
    }

    logAudit(apiLogger, 'REMOVE_KUNDE_TAG', req.user!.userId, 'kunde_tag', kundeId, { tagId });

    const response: ApiResponse<{ removed: boolean }> = {
      success: true,
      data: { removed: true },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

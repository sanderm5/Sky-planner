/**
 * Subcategory routes
 * CRUD for subcategory groups and subcategories (organization-level)
 * + customer subcategory assignments
 */

import { Router, Response } from 'express';
import { requireRole } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse } from '../types';

const router: Router = Router();

// Database service interface
interface SubcategoriesDbService {
  // Subcategory groups (per organization)
  getSubcatGroupsByOrganization(organizationId: number): Promise<{ id: number; organization_id: number; navn: string; sort_order: number; created_at: string }[]>;
  createSubcatGroup(organizationId: number, navn: string, sortOrder?: number): Promise<any>;
  updateSubcatGroup(groupId: number, navn: string): Promise<any | null>;
  deleteSubcatGroup(groupId: number): Promise<boolean>;
  // Subcategories
  getSubcategoriesByGroupIds(groupIds: number[]): Promise<{ id: number; group_id: number; navn: string; sort_order: number; created_at: string }[]>;
  createSubcategory(groupId: number, navn: string, sortOrder?: number): Promise<any>;
  updateSubcategory(id: number, navn: string): Promise<any | null>;
  deleteSubcategory(id: number): Promise<boolean>;
  // Kunde assignments
  getKundeSubcategories(kundeId: number): Promise<{ kunde_id: number; group_id: number; subcategory_id: number }[]>;
  setKundeSubcategories(kundeId: number, assignments: { group_id: number; subcategory_id: number }[]): Promise<boolean>;
  getAllKundeSubcategoryAssignments(organizationId: number): Promise<{ kunde_id: number; group_id: number; subcategory_id: number }[]>;
}

let dbService: SubcategoriesDbService;

export function initSubcategoriesRoutes(databaseService: SubcategoriesDbService): Router {
  dbService = databaseService;
  return router;
}

// Helper: verify group belongs to org
async function verifyGroupOwnership(organizationId: number, groupId: number): Promise<boolean> {
  const groups = await dbService.getSubcatGroupsByOrganization(organizationId);
  return groups.some(g => g.id === groupId);
}

/**
 * GET /api/subcategories/groups
 * Get all groups + subcategories for the organization
 */
router.get(
  '/groups',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const groups = await dbService.getSubcatGroupsByOrganization(req.organizationId!);
    const groupIds = groups.map(g => g.id);
    const subcats = groupIds.length > 0 ? await dbService.getSubcategoriesByGroupIds(groupIds) : [];

    const result = groups.map(g => ({
      ...g,
      subcategories: subcats.filter(s => s.group_id === g.id),
    }));

    res.json({ success: true, data: result } as ApiResponse<typeof result>);
  })
);

/**
 * POST /api/subcategories/groups
 * Create a new subcategory group (admin only)
 */
router.post(
  '/groups',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { navn } = req.body;

    if (!navn || typeof navn !== 'string' || navn.trim().length === 0) {
      throw Errors.validationError([{ field: 'navn', message: 'Navn er påkrevd' }]);
    }
    if (navn.trim().length > 100) {
      throw Errors.validationError([{ field: 'navn', message: 'Navn kan ikke være lenger enn 100 tegn' }]);
    }

    const group = await dbService.createSubcatGroup(req.organizationId!, navn.trim());
    res.status(201).json({ success: true, data: group } as ApiResponse<typeof group>);
  })
);

/**
 * PUT /api/subcategories/groups/:groupId
 * Update a subcategory group (admin only)
 */
router.put(
  '/groups/:groupId',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const groupId = parseInt(req.params.groupId, 10);
    if (isNaN(groupId)) throw Errors.badRequest('Ugyldig gruppe-ID');

    const { navn } = req.body;
    if (!navn || typeof navn !== 'string' || navn.trim().length === 0) {
      throw Errors.validationError([{ field: 'navn', message: 'Navn er påkrevd' }]);
    }

    if (!await verifyGroupOwnership(req.organizationId!, groupId)) {
      throw Errors.notFound('Gruppe ikke funnet');
    }

    const updated = await dbService.updateSubcatGroup(groupId, navn.trim());
    if (!updated) throw Errors.notFound('Gruppe ikke funnet');
    res.json({ success: true, data: updated } as ApiResponse<typeof updated>);
  })
);

/**
 * DELETE /api/subcategories/groups/:groupId
 * Delete a subcategory group and its children (admin only)
 */
router.delete(
  '/groups/:groupId',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const groupId = parseInt(req.params.groupId, 10);
    if (isNaN(groupId)) throw Errors.badRequest('Ugyldig gruppe-ID');

    if (!await verifyGroupOwnership(req.organizationId!, groupId)) {
      throw Errors.notFound('Gruppe ikke funnet');
    }

    await dbService.deleteSubcatGroup(groupId);
    res.json({ success: true, data: { message: 'Gruppe slettet' } } as ApiResponse<{ message: string }>);
  })
);

/**
 * POST /api/subcategories/items
 * Create a new subcategory within a group (admin only)
 */
router.post(
  '/items',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { group_id, navn } = req.body;

    if (!group_id || !navn || typeof navn !== 'string' || navn.trim().length === 0) {
      throw Errors.validationError([{ field: 'navn', message: 'Navn er påkrevd' }]);
    }
    if (navn.trim().length > 100) {
      throw Errors.validationError([{ field: 'navn', message: 'Navn kan ikke være lenger enn 100 tegn' }]);
    }

    if (!await verifyGroupOwnership(req.organizationId!, group_id)) {
      throw Errors.notFound('Gruppe ikke funnet');
    }

    const subcategory = await dbService.createSubcategory(group_id, navn.trim());
    res.status(201).json({ success: true, data: subcategory } as ApiResponse<typeof subcategory>);
  })
);

/**
 * PUT /api/subcategories/items/:id
 * Update a subcategory (admin only)
 */
router.put(
  '/items/:id',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw Errors.badRequest('Ugyldig ID');

    const { navn } = req.body;
    if (!navn || typeof navn !== 'string' || navn.trim().length === 0) {
      throw Errors.validationError([{ field: 'navn', message: 'Navn er påkrevd' }]);
    }

    const updated = await dbService.updateSubcategory(id, navn.trim());
    if (!updated) throw Errors.notFound('Underkategori ikke funnet');
    res.json({ success: true, data: updated } as ApiResponse<typeof updated>);
  })
);

/**
 * DELETE /api/subcategories/items/:id
 * Delete a subcategory (admin only)
 */
router.delete(
  '/items/:id',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw Errors.badRequest('Ugyldig ID');

    await dbService.deleteSubcategory(id);
    res.json({ success: true, data: { message: 'Underkategori slettet' } } as ApiResponse<{ message: string }>);
  })
);

/**
 * GET /api/subcategories/kunde/:kundeId
 * Get subcategory assignments for a customer
 */
router.get(
  '/kunde/:kundeId',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = parseInt(req.params.kundeId, 10);
    if (isNaN(kundeId)) throw Errors.badRequest('Ugyldig kunde-ID');

    const assignments = await dbService.getKundeSubcategories(kundeId);
    res.json({ success: true, data: assignments } as ApiResponse<typeof assignments>);
  })
);

/**
 * PUT /api/subcategories/kunde/:kundeId
 * Set subcategory assignments for a customer (bulk replace)
 * Body: { assignments: [{ group_id, subcategory_id }] }
 */
router.put(
  '/kunde/:kundeId',
  requireRole('tekniker'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = parseInt(req.params.kundeId, 10);
    if (isNaN(kundeId)) throw Errors.badRequest('Ugyldig kunde-ID');

    const { assignments } = req.body;
    if (!Array.isArray(assignments)) {
      throw Errors.validationError([{ field: 'assignments', message: 'assignments må være en array' }]);
    }

    // Validate each assignment has group_id and subcategory_id
    for (const a of assignments) {
      if (!a.group_id || !a.subcategory_id) {
        throw Errors.validationError([{ field: 'assignments', message: 'Hver tildeling må ha group_id og subcategory_id' }]);
      }
    }

    await dbService.setKundeSubcategories(kundeId, assignments);
    res.json({ success: true, data: { message: 'Underkategorier oppdatert' } } as ApiResponse<{ message: string }>);
  })
);

/**
 * GET /api/subcategories/kunde-assignments
 * Bulk: get all subcategory assignments for the organization (for filtering)
 */
router.get(
  '/kunde-assignments',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const assignments = await dbService.getAllKundeSubcategoryAssignments(req.organizationId!);
    res.json({ success: true, data: assignments } as ApiResponse<typeof assignments>);
  })
);

export default router;

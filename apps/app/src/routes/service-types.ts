/**
 * Service type routes
 * CRUD for organization-specific service type categories
 */

import { Router, Response } from 'express';
import { requireTenantAuth, requireRole } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse, OrganizationServiceType } from '../types';

const router: Router = Router();

// Database service interface
interface ServiceTypesDbService {
  getOrganizationServiceTypes(organizationId: number): Promise<OrganizationServiceType[]>;
  createOrganizationServiceType(organizationId: number, data: {
    name: string; slug?: string; icon?: string; color?: string;
    default_interval_months?: number; description?: string; sort_order?: number;
    source?: string; source_ref?: string;
  }): Promise<OrganizationServiceType>;
  updateOrganizationServiceType(organizationId: number, id: number, data: Partial<{
    name: string; slug: string; icon: string; color: string;
    default_interval_months: number; description: string; sort_order: number;
  }>): Promise<OrganizationServiceType | null>;
  deleteOrganizationServiceType(organizationId: number, id: number): Promise<boolean>;
  copyTemplateServiceTypes(organizationId: number, templateId: number): Promise<OrganizationServiceType[]>;
  renameCustomerCategory?(organizationId: number, oldName: string, newName: string): Promise<number>;
}

let dbService: ServiceTypesDbService;

export function initServiceTypesRoutes(databaseService: ServiceTypesDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/service-types
 * List all active service types for current organization
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const serviceTypes = await dbService.getOrganizationServiceTypes(req.organizationId!);

    const response: ApiResponse<OrganizationServiceType[]> = {
      success: true,
      data: serviceTypes,
    };

    res.json(response);
  })
);

/**
 * POST /api/service-types
 * Create a new service type (admin only)
 */
router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { name, icon, color, default_interval_months, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw Errors.validationError([{ field: 'name', message: 'Navn er påkrevd' }]);
    }

    if (name.trim().length > 100) {
      throw Errors.validationError([{ field: 'name', message: 'Navn kan ikke være lenger enn 100 tegn' }]);
    }

    // Get existing to determine sort_order
    const existing = await dbService.getOrganizationServiceTypes(req.organizationId!);
    const nextSortOrder = existing.length > 0
      ? Math.max(...existing.map(st => st.sort_order)) + 10
      : 10;

    const serviceType = await dbService.createOrganizationServiceType(req.organizationId!, {
      name: name.trim(),
      icon: icon || 'fa-wrench',
      color: color || '#F97316',
      default_interval_months: default_interval_months || 12,
      description: description || undefined,
      sort_order: nextSortOrder,
      source: 'manual',
    });

    const response: ApiResponse<OrganizationServiceType> = {
      success: true,
      data: serviceType,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/service-types/:id
 * Update a service type (admin only)
 */
router.put(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw Errors.badRequest('Ugyldig ID');
    }

    const { name, icon, color, default_interval_months, description, sort_order } = req.body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw Errors.validationError([{ field: 'name', message: 'Navn kan ikke være tomt' }]);
      }
      updateData.name = name.trim();
    }
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (default_interval_months !== undefined) updateData.default_interval_months = default_interval_months;
    if (description !== undefined) updateData.description = description;
    if (sort_order !== undefined) updateData.sort_order = sort_order;

    if (Object.keys(updateData).length === 0) {
      throw Errors.badRequest('Ingen felter å oppdatere');
    }

    // If name is changing, get the old name first so we can update customers
    let oldName: string | undefined;
    if (updateData.name) {
      const existing = await dbService.getOrganizationServiceTypes(req.organizationId!);
      const current = existing.find(st => st.id === id);
      if (current && current.name !== updateData.name) {
        oldName = current.name;
      }
    }

    const updated = await dbService.updateOrganizationServiceType(req.organizationId!, id, updateData);
    if (!updated) {
      throw Errors.notFound('Tjenestekategori ikke funnet');
    }

    // Rename category on all customers that had the old name
    let customersUpdated = 0;
    if (oldName && dbService.renameCustomerCategory) {
      customersUpdated = await dbService.renameCustomerCategory(req.organizationId!, oldName, updated.name);
    }

    const response: ApiResponse<OrganizationServiceType & { customers_updated?: number }> = {
      success: true,
      data: { ...updated, customers_updated: customersUpdated },
    };

    res.json(response);
  })
);

/**
 * DELETE /api/service-types/:id
 * Soft-delete a service type (admin only)
 */
router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw Errors.badRequest('Ugyldig ID');
    }

    await dbService.deleteOrganizationServiceType(req.organizationId!, id);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Tjenestekategori slettet' },
    };

    res.json(response);
  })
);

/**
 * POST /api/service-types/from-template
 * Copy service types from an industry template (admin only)
 */
router.post(
  '/from-template',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { templateId } = req.body;

    if (!templateId || typeof templateId !== 'number') {
      throw Errors.validationError([{ field: 'templateId', message: 'Template-ID er påkrevd' }]);
    }

    const serviceTypes = await dbService.copyTemplateServiceTypes(req.organizationId!, templateId);

    const response: ApiResponse<OrganizationServiceType[]> = {
      success: true,
      data: serviceTypes,
    };

    res.status(201).json(response);
  })
);

export default router;

/**
 * Export Routes
 * Endpoints for exporting organization data
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import {
  exportCustomersToCSV,
  exportCustomersToJSON,
  exportRoutesToCSV,
  exportRoutesToJSON,
  exportGDPRData,
  type CustomerExportRow,
  type RouteExportRow,
  type GDPRExportData,
} from '../services/export';
import type { AuthenticatedRequest } from '../types';

const router: Router = Router();

// Database service interface
interface ExportDbService {
  getAllKunder(organizationId: number): Promise<CustomerExportRow[]>;
  getAllRuter(organizationId: number): Promise<RouteExportRow[]>;
  getOrganizationById(id: number): Promise<{
    id: number;
    navn: string;
    slug: string;
    plan_type: string;
    opprettet?: string;
  } | null>;
}

let dbService: ExportDbService;

/**
 * Initialize export routes with database service
 */
export function initExportRoutes(databaseService: ExportDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/export/kunder
 * Export all customers for the organization
 * Query params: format (csv|json), default: csv
 */
router.get(
  '/kunder',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const format = (req.query.format as string) || 'csv';

    const customers = await dbService.getAllKunder(req.organizationId!);

    logAudit(apiLogger, 'EXPORT', req.user!.userId, 'kunder', undefined, {
      format,
      count: customers.length,
    });

    let result;
    if (format === 'json') {
      result = exportCustomersToJSON(customers);
    } else {
      result = exportCustomersToCSV(customers);
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  })
);

/**
 * GET /api/export/ruter
 * Export all routes for the organization
 * Query params: format (csv|json), default: csv
 */
router.get(
  '/ruter',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const format = (req.query.format as string) || 'csv';

    const routes = await dbService.getAllRuter(req.organizationId!);

    logAudit(apiLogger, 'EXPORT', req.user!.userId, 'ruter', undefined, {
      format,
      count: routes.length,
    });

    let result;
    if (format === 'json') {
      result = exportRoutesToJSON(routes);
    } else {
      result = exportRoutesToCSV(routes);
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  })
);

/**
 * GET /api/export/all
 * Export all data for GDPR compliance (data portability)
 * Always returns JSON
 */
router.get(
  '/all',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const organization = await dbService.getOrganizationById(req.organizationId!);

    if (!organization) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organisasjon ikke funnet' },
      });
      return;
    }

    const [customers, routes] = await Promise.all([
      dbService.getAllKunder(req.organizationId!),
      dbService.getAllRuter(req.organizationId!),
    ]);

    const exportData: GDPRExportData = {
      organization: {
        id: organization.id,
        navn: organization.navn,
        slug: organization.slug,
        plan_type: organization.plan_type,
        opprettet: organization.opprettet,
      },
      user: {
        id: req.user!.userId,
        navn: req.user!.epost, // Use email as name fallback
        epost: req.user!.epost,
      },
      customers,
      routes,
      exportedAt: new Date().toISOString(),
    };

    logAudit(apiLogger, 'GDPR_EXPORT', req.user!.userId, 'organization', req.organizationId, {
      customerCount: customers.length,
      routeCount: routes.length,
    });

    const result = exportGDPRData(exportData);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  })
);

export default router;

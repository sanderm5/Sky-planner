/**
 * Reports routes
 * Basic reporting endpoints for dashboard analytics
 */

import { Router, Response } from 'express';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse } from '../types';

const router: Router = Router();

interface ReportDbService {
  getReportKunderByStatus(organizationId: number): Promise<{ status: string; count: number }[]>;
  getReportKunderByKategori(organizationId: number): Promise<{ kategori: string; count: number }[]>;
  getReportKunderByPoststed(organizationId: number, limit?: number): Promise<{ poststed: string; count: number }[]>;
  getReportAvtalerStats(organizationId: number, months?: number): Promise<{ total: number; fullfort: number; planlagt: number; by_month: { month: string; count: number }[] }>;
  getReportKontrollStatus(organizationId: number): Promise<{ overdue: number; upcoming_30: number; upcoming_90: number; ok: number }>;
}

let dbService: ReportDbService;

export function initReportRoutes(databaseService: ReportDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/reports/overview
 * Get a combined overview report
 */
router.get(
  '/overview',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId!;

    const [byStatus, byKategori, byPoststed, avtaler, kontroll] = await Promise.all([
      dbService.getReportKunderByStatus(orgId),
      dbService.getReportKunderByKategori(orgId),
      dbService.getReportKunderByPoststed(orgId, 10),
      dbService.getReportAvtalerStats(orgId, 6),
      dbService.getReportKontrollStatus(orgId),
    ]);

    const response: ApiResponse = {
      success: true,
      data: {
        kunder_by_status: byStatus,
        kunder_by_kategori: byKategori,
        kunder_by_poststed: byPoststed,
        avtaler_stats: avtaler,
        kontroll_status: kontroll,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/reports/kunder
 * Customer breakdown report
 */
router.get(
  '/kunder',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId!;

    const [byStatus, byKategori, byPoststed] = await Promise.all([
      dbService.getReportKunderByStatus(orgId),
      dbService.getReportKunderByKategori(orgId),
      dbService.getReportKunderByPoststed(orgId, 20),
    ]);

    const response: ApiResponse = {
      success: true,
      data: { byStatus, byKategori, byPoststed },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/reports/avtaler
 * Appointment statistics
 */
router.get(
  '/avtaler',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const months = Number.parseInt(req.query.months as string) || 6;
    const stats = await dbService.getReportAvtalerStats(req.organizationId!, Math.min(months, 24));

    const response: ApiResponse = {
      success: true,
      data: stats,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/reports/kontroll
 * Control status overview
 */
router.get(
  '/kontroll',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const stats = await dbService.getReportKontrollStatus(req.organizationId!);

    const response: ApiResponse = {
      success: true,
      data: stats,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

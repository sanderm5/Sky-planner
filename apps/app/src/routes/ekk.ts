/**
 * EKK/IKK integration routes
 * Manage control reports and their lifecycle
 * Feature: ekk_integration
 *
 * Status flow: utkast → sendt_fg → fakturert → ferdig
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth, requireRole } from '../middleware/auth';
import { requireFeature } from '../middleware/features';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse } from '../types';

const router: Router = Router();

interface EkkReport {
  id: number;
  organization_id: number;
  kunde_id: number;
  report_type: string;
  external_report_id: string | null;
  status: string;
  fg_submitted_at: string | null;
  invoice_reference: string | null;
  checklist_data: Record<string, unknown>;
  report_url: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

const VALID_STATUSES = ['utkast', 'sendt_fg', 'fakturert', 'ferdig'] as const;
const VALID_REPORT_TYPES = ['elkontroll', 'brannkontroll', 'ikkontroll'] as const;

// Database service interface
interface EkkDbService {
  getKundeById(id: number, organizationId?: number): Promise<{ id: number; navn: string } | null>;
  getEkkReports(organizationId: number, kundeId?: number): Promise<EkkReport[]>;
  getEkkReportById(id: number, organizationId: number): Promise<EkkReport | null>;
  createEkkReport(data: Partial<EkkReport>): Promise<EkkReport>;
  updateEkkReport(id: number, data: Partial<EkkReport>, organizationId: number): Promise<EkkReport | null>;
  deleteEkkReport(id: number, organizationId: number): Promise<boolean>;
  // Lifecycle update
  updateKunde(id: number, data: Record<string, unknown>, organizationId?: number): Promise<unknown>;
}

let dbService: EkkDbService;

export function initEkkRoutes(databaseService: EkkDbService): Router {
  dbService = databaseService;
  return router;
}

// All routes require ekk_integration feature
router.use(requireTenantAuth, requireFeature('ekk_integration'));

/**
 * GET /api/ekk/reports
 * List all EKK reports for the organization (optionally filtered by customer)
 */
router.get(
  '/reports',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = req.query.kunde_id ? Number.parseInt(req.query.kunde_id as string) : undefined;
    const reports = await dbService.getEkkReports(req.organizationId!, kundeId);

    const response: ApiResponse<EkkReport[]> = {
      success: true,
      data: reports,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/ekk/reports/:id
 * Get a single EKK report
 */
router.get(
  '/reports/:id',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) throw Errors.badRequest('Ugyldig rapport-ID');

    const report = await dbService.getEkkReportById(id, req.organizationId!);
    if (!report) throw Errors.notFound('EKK-rapport');

    const response: ApiResponse<EkkReport> = {
      success: true,
      data: report,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/ekk/reports
 * Create a new EKK report (draft)
 */
router.post(
  '/reports',
  requireRole('tekniker'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { kunde_id, report_type, notes, checklist_data } = req.body;

    if (!kunde_id) throw Errors.badRequest('kunde_id er påkrevd');

    const kunde = await dbService.getKundeById(kunde_id, req.organizationId);
    if (!kunde) throw Errors.notFound('Kunde');

    const type = report_type || 'elkontroll';
    if (!VALID_REPORT_TYPES.includes(type)) {
      throw Errors.badRequest(`report_type må være: ${VALID_REPORT_TYPES.join(', ')}`);
    }

    const report = await dbService.createEkkReport({
      organization_id: req.organizationId!,
      kunde_id,
      report_type: type,
      status: 'utkast',
      notes: notes || null,
      checklist_data: checklist_data || {},
      created_by: req.user!.userId,
    });

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'ekk_report', report.id, {
      kunde_id, report_type: type,
    });

    const response: ApiResponse<EkkReport> = {
      success: true,
      data: report,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/ekk/reports/:id
 * Update an EKK report (checklist data, notes, etc.)
 */
router.put(
  '/reports/:id',
  requireRole('tekniker'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) throw Errors.badRequest('Ugyldig rapport-ID');

    const existing = await dbService.getEkkReportById(id, req.organizationId!);
    if (!existing) throw Errors.notFound('EKK-rapport');

    const { notes, checklist_data, report_url, external_report_id } = req.body;

    const updated = await dbService.updateEkkReport(id, {
      notes, checklist_data, report_url, external_report_id,
      updated_at: new Date().toISOString(),
    }, req.organizationId!);

    if (!updated) throw Errors.notFound('EKK-rapport');

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'ekk_report', id);

    const response: ApiResponse<EkkReport> = {
      success: true,
      data: updated,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/ekk/reports/:id/advance
 * Advance report to next status step
 * utkast → sendt_fg → fakturert → ferdig
 */
router.post(
  '/reports/:id/advance',
  requireRole('tekniker'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) throw Errors.badRequest('Ugyldig rapport-ID');

    const report = await dbService.getEkkReportById(id, req.organizationId!);
    if (!report) throw Errors.notFound('EKK-rapport');

    const currentIdx = VALID_STATUSES.indexOf(report.status as typeof VALID_STATUSES[number]);
    if (currentIdx === -1 || currentIdx >= VALID_STATUSES.length - 1) {
      throw Errors.badRequest('Rapporten kan ikke avanseres videre');
    }

    const nextStatus = VALID_STATUSES[currentIdx + 1];
    const updateData: Partial<EkkReport> = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    // Set FG submission timestamp
    if (nextStatus === 'sendt_fg') {
      updateData.fg_submitted_at = new Date().toISOString();
    }

    // Set invoice reference if provided
    if (nextStatus === 'fakturert' && req.body.invoice_reference) {
      updateData.invoice_reference = req.body.invoice_reference;
    }

    const updated = await dbService.updateEkkReport(id, updateData, req.organizationId!);
    if (!updated) throw Errors.notFound('EKK-rapport');

    // When report is complete, update customer lifecycle
    if (nextStatus === 'ferdig') {
      await dbService.updateKunde(report.kunde_id, {
        lifecycle_stage: 'ferdig',
        last_visit_date: new Date().toISOString().split('T')[0],
      }, req.organizationId);
    }

    logAudit(apiLogger, 'ADVANCE_STATUS', req.user!.userId, 'ekk_report', id, {
      from: report.status, to: nextStatus,
    });

    const response: ApiResponse<EkkReport> = {
      success: true,
      data: updated,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/ekk/reports/:id
 * Delete an EKK report (only drafts)
 */
router.delete(
  '/reports/:id',
  requireRole('tekniker'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) throw Errors.badRequest('Ugyldig rapport-ID');

    const report = await dbService.getEkkReportById(id, req.organizationId!);
    if (!report) throw Errors.notFound('EKK-rapport');

    if (report.status !== 'utkast') {
      throw Errors.badRequest('Kun utkast kan slettes');
    }

    await dbService.deleteEkkReport(id, req.organizationId!);

    logAudit(apiLogger, 'DELETE', req.user!.userId, 'ekk_report', id);

    const response: ApiResponse = {
      success: true,
      data: { message: 'EKK-rapport slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

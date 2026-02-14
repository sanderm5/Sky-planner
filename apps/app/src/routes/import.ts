/**
 * Excel Import Routes
 * Handles file upload, mapping, validation, and commit workflow
 */

import { Router, Response } from 'express';
import multer from 'multer';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getImportService, initImportService, type ImportDbService } from '../services/import';
import type { AuthenticatedRequest, ApiResponse } from '../types';
import type {
  ApplyMappingRequest,
  CommitImportRequest,
  RollbackRequest,
  ImportBatch,
  ImportMappingTemplate,
  ImportPreview,
  ImportCommitResult,
  RollbackResult,
  ValidateImportResponse,
  AIMappingResult,
  ApplyMappingResponse,
  UploadImportResponse,
} from '../types/import';

const router: Router = Router();

// Configure multer for Excel file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv',
      'application/octet-stream', // Some browsers send this
    ];
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Ugyldig filtype. Bruk Excel (.xlsx, .xls) eller CSV.'));
    }
  },
});

/**
 * Initialize import routes with database service
 */
export function initImportRoutes(databaseService: ImportDbService): Router {
  initImportService(databaseService);
  return router;
}

// ============ FILE UPLOAD ============

/**
 * POST /api/import/upload
 * Upload an Excel file and get initial preview
 */
router.post(
  '/upload',
  requireTenantAuth,
  upload.single('file'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
      throw Errors.badRequest('Ingen fil lastet opp');
    }

    // Validate file content by checking magic bytes
    const buffer = req.file.buffer;
    const ext = req.file.originalname.toLowerCase().slice(req.file.originalname.lastIndexOf('.'));
    if (ext === '.xlsx' || ext === '.xls') {
      const xlsxMagic = [0x50, 0x4B, 0x03, 0x04]; // ZIP/XLSX
      const xlsMagic = [0xD0, 0xCF, 0x11, 0xE0];   // OLE2/XLS
      const isXlsx = buffer.length >= 4 && xlsxMagic.every((b, i) => buffer[i] === b);
      const isXls = buffer.length >= 4 && xlsMagic.every((b, i) => buffer[i] === b);
      if (!isXlsx && !isXls) {
        throw Errors.badRequest('Filen ser ikke ut som en gyldig Excel-fil. Kontroller filformatet.');
      }
    } else if (ext === '.csv') {
      // CSV should be valid text - check for binary content in first 1000 bytes
      const sample = buffer.subarray(0, Math.min(1000, buffer.length));
      const hasNullBytes = sample.includes(0);
      if (hasNullBytes) {
        throw Errors.badRequest('Filen ser ikke ut som en gyldig CSV-fil. Kontroller filformatet.');
      }
    }

    const importService = getImportService();

    // Sanitize filename: keep only safe characters (letters, digits, dots, hyphens, underscores, spaces)
    const safeFileName = req.file.originalname
      .replaceAll(/[^a-zA-Z0-9æøåÆØÅ._\- ]/g, '_')
      .slice(0, 255);

    const result = await importService.uploadAndParse(
      req.organizationId!,
      req.user!.userId,
      req.file.buffer,
      safeFileName
    );

    logAudit(apiLogger, 'IMPORT_UPLOAD', req.user!.userId, 'import_batch', result.batchId, {
      fileName: safeFileName,
      fileSize: req.file.size,
      rowCount: result.preview.totalRows,
    });

    const response: ApiResponse<UploadImportResponse> = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

// ============ BATCH MANAGEMENT ============

/**
 * GET /api/import/batches
 * List import batches for the organization
 */
router.get(
  '/batches',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const service = getImportService();
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const status = req.query.status as ImportBatch['status'] | undefined;

    const batches = await service.getBatches(req.organizationId!, {
      limit,
      offset,
      ...(status && { status }),
    });

    const response: ApiResponse<ImportBatch[]> = {
      success: true,
      data: batches,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/import/batches/:id
 * Get details for a specific batch
 */
router.get(
  '/batches/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batchId = Number(req.params.id);
    if (isNaN(batchId)) {
      throw Errors.badRequest('Ugyldig batch-ID');
    }

    const service = getImportService();
    const batch = await service.getBatch(req.organizationId!, batchId);

    if (!batch) {
      throw Errors.notFound('Import-batch');
    }

    const response: ApiResponse<ImportBatch> = {
      success: true,
      data: batch,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/import/batches/:id/preview
 * Get preview data with current mappings applied
 */
router.get(
  '/batches/:id/preview',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batchId = Number(req.params.id);
    if (isNaN(batchId)) {
      throw Errors.badRequest('Ugyldig batch-ID');
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const showErrors = req.query.showErrors === 'true';

    const importService = getImportService();
    const preview = await importService.getPreview(
      req.organizationId!,
      batchId,
      { limit, offset, showErrors }
    );

    const response: ApiResponse<ImportPreview> = {
      success: true,
      data: preview,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ============ MAPPING ============

/**
 * POST /api/import/batches/:id/mapping
 * Apply column mappings to a batch
 */
router.post(
  '/batches/:id/mapping',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batchId = Number(req.params.id);
    if (isNaN(batchId)) {
      throw Errors.badRequest('Ugyldig batch-ID');
    }

    const body = req.body as ApplyMappingRequest;

    if (!body.mappingConfig) {
      throw Errors.badRequest('Mapping-konfigurasjon er påkrevd');
    }

    const importService = getImportService();
    const result = await importService.applyMapping(
      req.organizationId!,
      batchId,
      body.mappingConfig,
      {
        saveAsTemplate: body.saveAsTemplate,
        templateName: body.templateName,
        userId: req.user!.userId,
      }
    );

    logAudit(apiLogger, 'IMPORT_MAPPING', req.user!.userId, 'import_batch', batchId, {
      saveAsTemplate: body.saveAsTemplate,
      templateName: body.templateName,
      mappedCount: result.mappedCount,
    });

    const response: ApiResponse<ApplyMappingResponse> = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/import/batches/:id/suggest-mapping
 * Get AI-suggested mappings for columns (rule-based)
 */
router.post(
  '/batches/:id/suggest-mapping',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batchId = Number(req.params.id);
    if (isNaN(batchId)) {
      throw Errors.badRequest('Ugyldig batch-ID');
    }

    const importService = getImportService();
    const suggestions = await importService.getAIMappingSuggestions(
      req.organizationId!,
      batchId
    );

    const response: ApiResponse<AIMappingResult> = {
      success: true,
      data: suggestions,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ============ VALIDATION ============

/**
 * POST /api/import/batches/:id/validate
 * Run validation on mapped data
 */
router.post(
  '/batches/:id/validate',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batchId = Number(req.params.id);
    if (isNaN(batchId)) {
      throw Errors.badRequest('Ugyldig batch-ID');
    }

    const importService = getImportService();
    const result = await importService.validate(
      req.organizationId!,
      batchId
    );

    logAudit(apiLogger, 'IMPORT_VALIDATE', req.user!.userId, 'import_batch', batchId, {
      validCount: result.validCount,
      warningCount: result.warningCount,
      errorCount: result.errorCount,
    });

    const response: ApiResponse<ValidateImportResponse> = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ============ COMMIT ============

/**
 * POST /api/import/batches/:id/commit
 * Commit validated data to production
 */
router.post(
  '/batches/:id/commit',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batchId = Number(req.params.id);
    if (isNaN(batchId)) {
      throw Errors.badRequest('Ugyldig batch-ID');
    }

    const body = req.body as CommitImportRequest;

    const importService = getImportService();
    const result = await importService.commit(
      req.organizationId!,
      batchId,
      req.user!.userId,
      {
        dryRun: body.dryRun,
        excludedRowIds: body.excludedRowIds,
        rowEdits: body.rowEdits,
      }
    );

    if (!body.dryRun) {
      logAudit(apiLogger, 'IMPORT_COMMIT', req.user!.userId, 'import_batch', batchId, {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        durationMs: result.durationMs,
      });
    }

    const response: ApiResponse<ImportCommitResult> = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ============ ROLLBACK ============

/**
 * POST /api/import/batches/:id/rollback
 * Rollback a committed batch
 */
router.post(
  '/batches/:id/rollback',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batchId = Number(req.params.id);
    if (isNaN(batchId)) {
      throw Errors.badRequest('Ugyldig batch-ID');
    }

    const body = req.body as RollbackRequest;

    const importService = getImportService();
    const result = await importService.rollback(
      req.organizationId!,
      batchId,
      req.user!.userId,
      body.reason
    );

    logAudit(apiLogger, 'IMPORT_ROLLBACK', req.user!.userId, 'import_batch', batchId, {
      reason: body.reason,
      recordsDeleted: result.recordsDeleted,
      recordsReverted: result.recordsReverted,
    });

    const response: ApiResponse<RollbackResult> = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ============ CANCEL ============

/**
 * DELETE /api/import/batches/:id
 * Cancel/delete a non-committed batch
 */
router.delete(
  '/batches/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batchId = Number(req.params.id);
    if (isNaN(batchId)) {
      throw Errors.badRequest('Ugyldig batch-ID');
    }

    const importService = getImportService();
    await importService.cancelBatch(req.organizationId!, batchId);

    logAudit(apiLogger, 'IMPORT_CANCEL', req.user!.userId, 'import_batch', batchId);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Import avbrutt' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ============ MAPPING TEMPLATES ============

/**
 * GET /api/import/templates
 * List saved mapping templates
 */
router.get(
  '/templates',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const service = getImportService();
    const templates = await service.getTemplates(req.organizationId!);

    const response: ApiResponse<ImportMappingTemplate[]> = {
      success: true,
      data: templates,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/import/templates/:id
 * Get a specific template
 */
router.get(
  '/templates/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const templateId = Number(req.params.id);
    if (isNaN(templateId)) {
      throw Errors.badRequest('Ugyldig mal-ID');
    }

    const service = getImportService();
    const templates = await service.getTemplates(req.organizationId!);
    const template = templates.find(t => t.id === templateId) || null;

    if (!template) {
      throw Errors.notFound('Import-mal');
    }

    const response: ApiResponse<ImportMappingTemplate> = {
      success: true,
      data: template,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/import/templates/:id
 * Delete a mapping template
 */
router.delete(
  '/templates/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const templateId = Number(req.params.id);
    if (isNaN(templateId)) {
      throw Errors.badRequest('Ugyldig mal-ID');
    }

    const service = getImportService();
    await service.deleteTemplate(req.organizationId!, templateId);

    logAudit(apiLogger, 'IMPORT_TEMPLATE_DELETE', req.user!.userId, 'import_mapping_template', templateId);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Mal slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ============ ERROR REPORT ============

/**
 * GET /api/import/batches/:id/error-report
 * Download validation errors as CSV
 */
router.get(
  '/batches/:id/error-report',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batchId = Number(req.params.id);
    if (isNaN(batchId)) {
      throw Errors.badRequest('Ugyldig batch-ID');
    }

    const service = getImportService();
    const orgId = req.user!.organizationId!;

    // Verify batch exists and belongs to org
    const preview = await service.getPreview(orgId, batchId, {
      limit: 10000,
      offset: 0,
      showErrors: true,
    });

    // Build CSV from preview rows with errors
    const csvLines: string[] = ['Rad;Felt;Alvorlighetsgrad;Feilkode;Melding;Verdi;Forslag'];

    for (const row of preview.previewRows) {
      if (!row.errors || row.errors.length === 0) continue;
      for (const err of row.errors) {
        const line = [
          row.rowNumber,
          err.field_name || '',
          err.severity,
          err.error_code,
          `"${(err.message || '').replaceAll('"', '""')}"`,
          `"${((err as any).actual_value || '').replaceAll('"', '""')}"`,
          `"${((err as any).suggestion || '').replaceAll('"', '""')}"`,
        ].join(';');
        csvLines.push(line);
      }
    }

    const csv = csvLines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="feilrapport-batch-${batchId}.csv"`);
    res.send('\uFEFF' + csv); // BOM for Excel compatibility
  })
);

export default router;

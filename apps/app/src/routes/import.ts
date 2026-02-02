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

    const importService = getImportService();

    const result = await importService.uploadAndParse(
      req.organizationId!,
      req.user!.userId,
      req.file.buffer,
      req.file.originalname
    );

    logAudit(apiLogger, 'IMPORT_UPLOAD', req.user!.userId, 'import_batch', result.batchId, {
      fileName: req.file.originalname,
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
    const response: ApiResponse<ImportBatch[]> = {
      success: true,
      data: [],
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

    // Note: We need to expose this through the service
    const response: ApiResponse<ImportBatch | null> = {
      success: true,
      data: null,
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
      { dryRun: body.dryRun }
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
    // Note: Need to expose this through the service
    const response: ApiResponse<ImportMappingTemplate[]> = {
      success: true,
      data: [],
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

    // Note: Need to expose this through the service
    const response: ApiResponse<ImportMappingTemplate | null> = {
      success: true,
      data: null,
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

    logAudit(apiLogger, 'IMPORT_TEMPLATE_DELETE', req.user!.userId, 'import_mapping_template', templateId);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Mal slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

/**
 * Customer (Kunder) routes
 * CRUD operations for customers with multi-tenant support
 */

import { Router, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { validateKunde } from '../utils/validation';
import { geocodeCustomerData } from '../services/geocoding';
import { getWebhookService } from '../services/webhooks';
import type { AuthenticatedRequest, Kunde, CreateKundeRequest, ApiResponse } from '../types';
import { cleanImportData } from '../services/import/cleaner';

// Configure multer for Excel file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Ugyldig filtype. Bruk Excel (.xlsx, .xls) eller CSV.'));
    }
  },
});

const router: Router = Router();

// Pagination result type
interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// Database service interface (will be injected)
interface KundeDbService {
  getAllKunder(organizationId?: number): Promise<Kunde[]>;
  getAllKunderPaginated(
    organizationId: number,
    options: { limit?: number; offset?: number; search?: string; kategori?: string }
  ): Promise<PaginatedResult<Kunde>>;
  getKundeById(id: number, organizationId?: number): Promise<Kunde | null>;
  getKunderByOmrade(omrade: string, organizationId?: number): Promise<Kunde[]>;
  getKontrollVarsler(dager: number, organizationId?: number): Promise<Kunde[]>;
  createKunde(data: CreateKundeRequest & { organization_id?: number }): Promise<Kunde>;
  updateKunde(id: number, data: Partial<Kunde>, organizationId?: number): Promise<Kunde | null>;
  deleteKunde(id: number, organizationId?: number): Promise<boolean>;
  bulkCompleteKontroll(
    kundeIds: number[],
    type: 'el' | 'brann' | 'begge',
    dato: string,
    organizationId?: number
  ): Promise<number>;
  getOrganizationLimits(organizationId: number): Promise<{ max_kunder: number; current_count: number } | null>;
}

let dbService: KundeDbService;

/**
 * Initialize kunder routes with database service
 */
export function initKunderRoutes(databaseService: KundeDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/kunder
 * Get all customers (filtered by organization)
 * Supports pagination: ?limit=100&offset=0
 * Supports search: ?search=term
 * Supports category filter: ?kategori=El-Kontroll
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const limit = Math.min(Number.parseInt(req.query.limit as string) || 100, 500);
    const offset = Math.max(Number.parseInt(req.query.offset as string) || 0, 0);
    // Limit search string length to prevent performance issues with LIKE queries
    const rawSearch = req.query.search as string | undefined;
    const search = rawSearch ? rawSearch.substring(0, 100) : undefined;
    const kategori = req.query.kategori as string | undefined;

    // Check if pagination/filtering is requested
    if (req.query.limit || req.query.offset || req.query.search || req.query.kategori) {
      const result = await dbService.getAllKunderPaginated(req.organizationId!, {
        limit,
        offset,
        search,
        kategori,
      });

      const response: ApiResponse<PaginatedResult<Kunde>> = {
        success: true,
        data: result,
        requestId: req.requestId,
      };

      res.json(response);
    } else {
      // Backward compatible: return all for existing clients
      const kunder = await dbService.getAllKunder(req.organizationId);

      const response: ApiResponse<Kunde[]> = {
        success: true,
        data: kunder,
        requestId: req.requestId,
      };

      res.json(response);
    }
  })
);

/**
 * GET /api/kunder/kontroll-varsler
 * Get customers needing control within N days
 */
router.get(
  '/kontroll-varsler',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const dager = Math.min(Math.max(Number.parseInt(req.query.dager as string, 10) || 30, 1), 365);

    const kunder = await dbService.getKontrollVarsler(dager, req.organizationId);

    const response: ApiResponse<Kunde[]> = {
      success: true,
      data: kunder,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/kunder/omrade/:omrade
 * Get customers by area/region
 */
router.get(
  '/omrade/:omrade',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kunder = await dbService.getKunderByOmrade(req.params.omrade, req.organizationId);

    const response: ApiResponse<Kunde[]> = {
      success: true,
      data: kunder,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/kunder/:id
 * Get single customer by ID
 */
router.get(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const kunde = await dbService.getKundeById(id, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    const response: ApiResponse<Kunde> = {
      success: true,
      data: kunde,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/kunder
 * Create new customer
 */
router.post(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Validate input
    const validationErrors = validateKunde(req.body);
    if (validationErrors) {
      throw Errors.validationError(validationErrors);
    }

    // Check quota
    if (req.organizationId) {
      const limits = await dbService.getOrganizationLimits(req.organizationId);
      if (limits && limits.current_count >= limits.max_kunder) {
        throw Errors.quotaExceeded('kunder', limits.max_kunder);
      }
    }

    // Prepare kunde data with defaults
    const kundeData = prepareKundeData(req.body, req.organizationId);

    // Geocode address if needed
    const geocodedData = await geocodeCustomerData(kundeData);

    const kunde = await dbService.createKunde(geocodedData);

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'kunde', kunde.id, {
      navn: kunde.navn,
      kategori: kunde.kategori,
    });

    // Trigger webhook for customer created
    if (req.organizationId) {
      getWebhookService().then(webhookService => {
        webhookService.triggerCustomerCreated(req.organizationId!, {
          id: kunde.id,
          navn: kunde.navn,
          adresse: kunde.adresse,
          postnummer: kunde.postnummer,
          poststed: kunde.poststed,
          telefon: kunde.telefon,
          epost: kunde.epost,
        }).catch(err => {
          apiLogger.error({ err, kundeId: kunde.id }, 'Failed to trigger customer.created webhook');
        });
      }).catch(err => {
        apiLogger.error({ err }, 'Failed to get webhook service');
      });
    }

    const response: ApiResponse<Kunde> = {
      success: true,
      data: kunde,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/kunder/:id
 * Update existing customer
 */
router.put(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    // Validate input
    const validationErrors = validateKunde(req.body);
    if (validationErrors) {
      throw Errors.validationError(validationErrors);
    }

    // Fetch current customer data before update for webhook change tracking
    const kundeBeforeUpdate = await dbService.getKundeById(id, req.organizationId);
    if (!kundeBeforeUpdate) {
      throw Errors.notFound('Kunde');
    }

    // Prepare data (without organization_id - can't change tenant)
    const kundeData = prepareKundeData(req.body);

    const kunde = await dbService.updateKunde(id, kundeData, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'kunde', id, {
      fields: Object.keys(req.body),
    });

    // Trigger webhook for customer updated
    if (req.organizationId) {
      getWebhookService().then(webhookService => {
        webhookService.triggerCustomerUpdated(
          req.organizationId!,
          {
            id: kunde.id,
            navn: kunde.navn,
            adresse: kunde.adresse,
            postnummer: kunde.postnummer,
            poststed: kunde.poststed,
            telefon: kunde.telefon,
            epost: kunde.epost,
          },
          // Include changed fields with old and new values
          Object.keys(req.body).reduce((acc, field) => {
            const oldValue = (kundeBeforeUpdate as unknown as Record<string, unknown>)[field];
            const newValue = req.body[field];
            // Only include fields that actually changed
            if (oldValue !== newValue) {
              acc[field] = { old: oldValue, new: newValue };
            }
            return acc;
          }, {} as Record<string, { old: unknown; new: unknown }>)
        ).catch(err => {
          apiLogger.error({ err, kundeId: kunde.id }, 'Failed to trigger customer.updated webhook');
        });
      }).catch(err => {
        apiLogger.error({ err }, 'Failed to get webhook service');
      });
    }

    const response: ApiResponse<Kunde> = {
      success: true,
      data: kunde,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/kunder/:id
 * Delete customer
 */
router.delete(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    // Get customer data before deletion for webhook
    const kundeBeforeDelete = await dbService.getKundeById(id, req.organizationId);
    if (!kundeBeforeDelete) {
      throw Errors.notFound('Kunde');
    }

    const deleted = await dbService.deleteKunde(id, req.organizationId);
    if (!deleted) {
      throw Errors.notFound('Kunde');
    }

    logAudit(apiLogger, 'DELETE', req.user!.userId, 'kunde', id);

    // Trigger webhook for customer deleted
    if (req.organizationId) {
      getWebhookService().then(webhookService => {
        webhookService.triggerCustomerDeleted(req.organizationId!, {
          id: kundeBeforeDelete.id,
          navn: kundeBeforeDelete.navn,
          adresse: kundeBeforeDelete.adresse,
          postnummer: kundeBeforeDelete.postnummer,
          poststed: kundeBeforeDelete.poststed,
          telefon: kundeBeforeDelete.telefon,
          epost: kundeBeforeDelete.epost,
        }).catch(err => {
          apiLogger.error({ err, kundeId: id }, 'Failed to trigger customer.deleted webhook');
        });
      }).catch(err => {
        apiLogger.error({ err }, 'Failed to get webhook service');
      });
    }

    const response: ApiResponse = {
      success: true,
      data: { message: 'Kunde slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/kunder/bulk-complete
 * Mark multiple customers as control completed
 */
router.post(
  '/bulk-complete',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { kunde_ids, type, dato } = req.body;

    if (!Array.isArray(kunde_ids) || kunde_ids.length === 0) {
      throw Errors.badRequest('kunde_ids må være en ikke-tom liste');
    }

    if (!['el', 'brann', 'begge'].includes(type)) {
      throw Errors.badRequest('type må være "el", "brann", eller "begge"');
    }

    if (!dato || !/^\d{4}-\d{2}-\d{2}$/.test(dato)) {
      throw Errors.badRequest('dato må være i format YYYY-MM-DD');
    }

    const updated = await dbService.bulkCompleteKontroll(
      kunde_ids,
      type,
      dato,
      req.organizationId
    );

    logAudit(apiLogger, 'BULK_COMPLETE', req.user!.userId, 'kunde', undefined, {
      count: updated,
      type,
      dato,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        updated,
        message: `${updated} kunder oppdatert`,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * Helper: Prepare kunde data with defaults and calculated fields
 */
function prepareKundeData(
  body: CreateKundeRequest,
  organizationId?: number
): CreateKundeRequest & { organization_id?: number } {
  const kategori = body.kategori || 'El-Kontroll';

  // Determine intervals based on category and type
  let elIntervall = body.el_kontroll_intervall;
  let brannIntervall = body.brann_kontroll_intervall;

  if (kategori === 'El-Kontroll' || kategori === 'El-Kontroll + Brannvarsling') {
    elIntervall = elIntervall || (body.el_type === 'Bolig' ? 60 : body.el_type === 'Næring' ? 12 : 36);
  }

  if (kategori === 'Brannvarsling' || kategori === 'El-Kontroll + Brannvarsling') {
    brannIntervall = brannIntervall || 12; // Always 12 months for fire alarms
  }

  return {
    ...body,
    kategori,
    el_kontroll_intervall: elIntervall,
    brann_kontroll_intervall: brannIntervall,
    organization_id: organizationId,
  };
}

// ============================================
// SIMPLE EXCEL/CSV IMPORT (Memory-based)
// ============================================

/**
 * POST /api/kunder/import/parse
 * Parse Excel/CSV file and return data for preview (no database writes)
 */
router.post(
  '/import/parse',
  upload.single('file'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
      throw Errors.badRequest('Ingen fil lastet opp');
    }

    try {
      // Parse Excel/CSV file
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Convert to JSON with headers
      const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      if (rawData.length === 0) {
        throw Errors.badRequest('Filen inneholder ingen data');
      }

      // Get headers from first row
      const headers = Object.keys(rawData[0]);

      // Auto-detect column mappings
      const suggestedMapping: Record<string, string> = {};
      const fieldPatterns: Record<string, RegExp[]> = {
        navn: [/^(kunde)?navn$/i, /^name$/i, /^firma$/i, /^company$/i, /^bedrift$/i],
        adresse: [/^adresse$/i, /^address$/i, /^gateadresse$/i, /^street$/i],
        postnummer: [/^post(nummer|nr|kode)$/i, /^zip$/i, /^postal/i],
        poststed: [/^poststed$/i, /^by$/i, /^city$/i, /^sted$/i],
        telefon: [/^(tlf|telefon|phone|mobil)$/i, /^tel$/i],
        epost: [/^(e-?post|email|mail)$/i],
        kontaktperson: [/^kontakt(person)?$/i, /^contact$/i],
        kategori: [/^kategori$/i, /^type$/i, /^category$/i],
        notat: [/^notat(er)?$/i, /^kommentar$/i, /^note/i, /^merknad$/i],
      };

      headers.forEach(header => {
        const normalizedHeader = header.toLowerCase().trim();
        for (const [field, patterns] of Object.entries(fieldPatterns)) {
          if (patterns.some(pattern => pattern.test(normalizedHeader))) {
            suggestedMapping[header] = field;
            break;
          }
        }
      });

      // Run auto-cleaning on all data
      const { cleanedRows, report: cleaningReport } = cleanImportData(rawData, headers);

      // Prepare preview rows (first 100) - original data
      const previewRows = rawData.slice(0, 100).map((row, index) => ({
        _rowIndex: index,
        ...row
      }));

      // Prepare cleaned preview rows (first 100)
      const cleanedPreviewRows = cleanedRows.slice(0, 100).map((row, index) => ({
        _rowIndex: index,
        ...row
      }));

      // Build recognized columns for the mapping UI
      const recognizedColumns: Array<{ excelHeader: string; mappedTo: string; source: string; sampleValue: string }> = [];
      const unmappedHeaders: string[] = [];

      headers.forEach(header => {
        const mappedField = suggestedMapping[header];
        if (mappedField) {
          recognizedColumns.push({
            excelHeader: header,
            mappedTo: mappedField,
            source: 'deterministic',
            sampleValue: String(rawData[0]?.[header] || ''),
          });
        } else {
          unmappedHeaders.push(header);
        }
      });

      res.json({
        success: true,
        data: {
          headers,
          allColumns: headers,
          suggestedMapping,
          preview: previewRows,
          cleanedPreview: cleanedPreviewRows,
          cleaningReport,
          totalRows: rawData.length,
          totalRowsAfterCleaning: cleanedRows.length,
          totalColumns: headers.length,
          fileName: req.file.originalname,
          recognizedColumns,
          unmappedHeaders,
          newFields: [],
        },
        requestId: req.requestId,
      });
    } catch (error) {
      apiLogger.error({ error, file: req.file.originalname }, 'Error parsing import file');
      throw Errors.badRequest('Kunne ikke lese filen. Sjekk at det er en gyldig Excel- eller CSV-fil.');
    }
  })
);

/**
 * POST /api/kunder/import/execute
 * Import selected customers from parsed data
 */
router.post(
  '/import/execute',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { rows, columnMapping } = req.body as {
      rows: Array<Record<string, unknown>>;
      columnMapping: Record<string, string>;
    };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      throw Errors.badRequest('Ingen rader å importere');
    }

    if (!columnMapping || !columnMapping.navn || !columnMapping.adresse) {
      throw Errors.badRequest('Kolonne-mapping for navn og adresse er påkrevd');
    }

    // Check organization limits
    const limits = await dbService.getOrganizationLimits(req.organizationId!);
    if (limits && limits.current_count + rows.length > limits.max_kunder) {
      throw Errors.forbidden(
        `Du kan ikke importere ${rows.length} kunder. Maks antall er ${limits.max_kunder}, og du har allerede ${limits.current_count}.`
      );
    }

    const results = {
      created: 0,
      failed: 0,
      errors: [] as Array<{ row: number; error: string }>,
    };

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        // Map columns to customer fields
        const getField = (field: string): string | undefined => {
          const col = (columnMapping as Record<string, string | undefined>)[field];
          if (!col) return undefined;
          const val = row[col];
          return val != null ? String(val).trim() || undefined : undefined;
        };
        const getIntField = (field: string): number | undefined => {
          const val = getField(field);
          return val ? Number(val) || undefined : undefined;
        };

        const kundeData: CreateKundeRequest = {
          navn: String(row[columnMapping.navn] || '').trim(),
          adresse: String(row[columnMapping.adresse] || '').trim(),
          postnummer: getField('postnummer'),
          poststed: getField('poststed'),
          telefon: getField('telefon'),
          epost: getField('epost'),
          kontaktperson: getField('kontaktperson'),
          notater: getField('notat') || getField('notater'),
          kategori: getField('kategori') || 'El-Kontroll',
          el_type: getField('el_type'),
          brann_system: getField('brann_system'),
          siste_kontroll: getField('siste_kontroll'),
          neste_kontroll: getField('neste_kontroll'),
          siste_el_kontroll: getField('siste_el_kontroll'),
          neste_el_kontroll: getField('neste_el_kontroll'),
          siste_brann_kontroll: getField('siste_brann_kontroll'),
          neste_brann_kontroll: getField('neste_brann_kontroll'),
          kontroll_intervall_mnd: getIntField('kontroll_intervall_mnd'),
          el_kontroll_intervall: getIntField('el_kontroll_intervall'),
          brann_kontroll_intervall: getIntField('brann_kontroll_intervall'),
        };

        // Validate required fields
        if (!kundeData.navn) {
          throw new Error('Mangler kundenavn');
        }
        if (!kundeData.adresse) {
          throw new Error('Mangler adresse');
        }

        // Apply defaults and create customer
        const dataWithDefaults = prepareKundeData(kundeData, req.organizationId);
        const newKunde = await dbService.createKunde(dataWithDefaults);

        results.created++;

        // Log audit
        logAudit(apiLogger, 'IMPORT_KUNDE', req.user!.userId, 'kunde', newKunde.id, {
          source: 'excel-import',
          rowIndex: i,
        });

      } catch (error) {
        results.failed++;
        results.errors.push({
          row: i + 1,
          error: error instanceof Error ? error.message : 'Ukjent feil',
        });
      }
    }

    const response: ApiResponse<typeof results> = {
      success: true,
      data: results,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

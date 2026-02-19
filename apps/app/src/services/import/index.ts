/**
 * Import Service
 * Main orchestrator for the Excel import pipeline
 */

import { apiLogger } from '../logger';
import { parseExcelBuffer } from './parser';
import { detectFormatChange, suggestColumnMappings } from './format-detection';
import { applyTransformations } from './transformers';
import { validateMappedRow, convertToDbErrors } from './validation';
import { cleanImportData } from './cleaner';
import { checkDuplicates } from './duplicate-detection';
import { getAIMappingSuggestions } from './ai-mapping';
import type { ExistingKunde, BatchDuplicateReport } from './duplicate-detection';
import type {
  ImportBatch,
  ImportBatchStatus,
  ImportMappingConfig,
  ImportPreview,
  ImportCommitResult,
  RollbackResult,
  ValidateImportResponse,
  AIMappingResult,
  ColumnInfo,
  PreviewRow,
  InsertImportBatch,
  InsertStagingRow,
  InsertAuditLog,
  ImportStagingRow,
  ImportColumnHistory,
  ImportMappingTemplate,
  ImportBatchQueryOptions,
  StagingRowQueryOptions,
  ApplyMappingResponse,
  FormatChangeResult,
  StagingRowStatus,
  UploadImportResponse,
  BatchQualityReport,
} from '../../types/import';

// Database service interface
export interface ImportDbService {
  // Batch operations
  createImportBatch(data: InsertImportBatch): Promise<ImportBatch>;
  getImportBatch(organizationId: number, batchId: number): Promise<ImportBatch | null>;
  getImportBatches(organizationId: number, options: ImportBatchQueryOptions): Promise<ImportBatch[]>;
  updateImportBatch(batchId: number, data: Partial<ImportBatch>): Promise<void>;

  // Staging row operations
  createImportStagingRows(rows: InsertStagingRow[]): Promise<void>;
  getImportStagingRows(batchId: number, options: StagingRowQueryOptions): Promise<ImportStagingRow[]>;
  updateImportStagingRow(rowId: number, data: Partial<ImportStagingRow>): Promise<void>;
  deleteImportStagingRows(batchId: number): Promise<void>;

  // Validation errors
  createImportValidationErrors(errors: Array<{
    staging_row_id: number;
    batch_id: number;
    severity: string;
    error_code: string;
    field_name?: string;
    source_column?: string;
    message: string;
    expected_format?: string;
    actual_value?: string;
    suggestion?: string;
  }>): Promise<void>;
  deleteImportValidationErrors(batchId: number): Promise<void>;
  getImportValidationErrors(batchId: number): Promise<Array<{
    id: number;
    staging_row_id: number;
    batch_id: number;
    severity: string;
    error_code: string;
    field_name?: string;
    source_column?: string;
    message: string;
  }>>;

  // Mapping templates
  getImportMappingTemplates(organizationId: number): Promise<ImportMappingTemplate[]>;
  getImportMappingTemplateByFingerprint(organizationId: number, fingerprint: string): Promise<ImportMappingTemplate | null>;
  createImportMappingTemplate(data: Omit<ImportMappingTemplate, 'id' | 'created_at' | 'updated_at'>): Promise<ImportMappingTemplate>;
  updateImportMappingTemplate(templateId: number, data: Partial<ImportMappingTemplate>): Promise<void>;
  deleteImportMappingTemplate(organizationId: number, templateId: number): Promise<void>;

  // Column history
  getImportColumnHistory(organizationId: number): Promise<ImportColumnHistory[]>;
  createImportColumnHistory(data: { organization_id: number; column_fingerprint: string; columns: string[] }): Promise<void>;
  updateImportColumnHistory(historyId: number, data: Partial<ImportColumnHistory>): Promise<void>;

  // Audit log
  createImportAuditLog(data: InsertAuditLog): Promise<void>;

  // Kunde operations (for commit)
  findKundeByNameAndAddress(organizationId: number, navn: string, adresse: string): Promise<{ id: number } | null>;
  createKunde(data: Record<string, unknown>): Promise<{ id: number }>;
  updateKunde(id: number, data: Record<string, unknown>, organizationId: number): Promise<void>;
  deleteKunde(id: number, organizationId: number): Promise<void>;

  // Duplicate detection (load existing customers for matching)
  getKunderForDuplicateCheck(organizationId: number): Promise<ExistingKunde[]>;
}

// Singleton instance
let importServiceInstance: ImportService | null = null;
let dbServiceRef: ImportDbService | null = null;

export function initImportService(dbService: ImportDbService): void {
  dbServiceRef = dbService;
  // Don't reset existing instance - avoid losing state during concurrent imports
}

export function getImportService(): ImportService {
  if (!importServiceInstance) {
    if (!dbServiceRef) {
      throw new Error('Import service not initialized. Call initImportService first.');
    }
    importServiceInstance = new ImportService(dbServiceRef);
  }
  return importServiceInstance;
}

/**
 * Normalize company name for duplicate detection
 * Handles variations like "AS", "A/S", "A.S.", extra whitespace, etc.
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return '';

  let normalized = name.trim().toLowerCase();

  // Normalize company suffixes
  const suffixPatterns = [
    // AS variants
    { pattern: /\s+(a\.?s\.?|as)$/i, replacement: ' as' },
    { pattern: /\s+(a\/s)$/i, replacement: ' as' },
    // ANS variants
    { pattern: /\s+(a\.?n\.?s\.?|ans)$/i, replacement: ' ans' },
    // DA variants
    { pattern: /\s+(d\.?a\.?)$/i, replacement: ' da' },
    // ENK variants
    { pattern: /\s+(enk\.?|enkeltpersonforetak)$/i, replacement: ' enk' },
    // NUF variants
    { pattern: /\s+(nuf\.?|norskregistrert utenlandsk foretak)$/i, replacement: ' nuf' },
  ];

  for (const { pattern, replacement } of suffixPatterns) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Normalize whitespace (multiple spaces to single)
  normalized = normalized.replace(/\s+/g, ' ');

  // Remove common punctuation that doesn't affect meaning
  normalized = normalized.replace(/[.,]/g, '');

  return normalized;
}

/**
 * Normalize address for duplicate detection
 * Handles variations in street names, numbers, etc.
 */
export function normalizeAddress(address: string): string {
  if (!address) return '';

  let normalized = address.trim().toLowerCase();

  // Normalize common abbreviations
  const abbreviations = [
    { pattern: /\bgt\.?\b/gi, replacement: 'gate' },
    { pattern: /\bvn\.?\b/gi, replacement: 'veien' },
    { pattern: /\bv\.?\b/gi, replacement: 'vei' },
    { pattern: /\bpl\.?\b/gi, replacement: 'plass' },
  ];

  for (const { pattern, replacement } of abbreviations) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ');

  return normalized;
}

class ImportService {
  private db: ImportDbService;

  constructor(dbService: ImportDbService) {
    this.db = dbService;
  }

  // ============ BATCH & TEMPLATE QUERIES ============

  async getBatches(organizationId: number, options: ImportBatchQueryOptions): Promise<ImportBatch[]> {
    return this.db.getImportBatches(organizationId, options);
  }

  async getBatch(organizationId: number, batchId: number): Promise<ImportBatch | null> {
    return this.db.getImportBatch(organizationId, batchId);
  }

  async getTemplates(organizationId: number): Promise<ImportMappingTemplate[]> {
    return this.db.getImportMappingTemplates(organizationId);
  }

  async deleteTemplate(organizationId: number, templateId: number): Promise<void> {
    return this.db.deleteImportMappingTemplate(organizationId, templateId);
  }

  // ============ UPLOAD & PARSE ============

  async uploadAndParse(
    organizationId: number,
    userId: number,
    fileBuffer: Buffer,
    fileName: string
  ): Promise<UploadImportResponse> {
    apiLogger.info({ organizationId, fileName }, 'Starting Excel upload and parse');

    // Parse Excel file
    const parsed = await parseExcelBuffer(fileBuffer);

    // Run auto-cleaning on parsed data
    const { cleanedRows, report: cleaningReport } = cleanImportData(parsed.rows, parsed.headers);

    // Generate mapping suggestions (template → regex → AI fallback)
    const { suggestedMapping, recognizedColumns, unmappedHeaders } =
      await this.generateMappingSuggestions(
        organizationId, parsed.headers, parsed.columnFingerprint,
        cleanedRows, parsed.rows[0]
      );

    // Check for format changes
    const formatChange = await detectFormatChange(
      organizationId,
      parsed.columnFingerprint,
      parsed.headers,
      (orgId) => this.db.getImportColumnHistory(orgId),
      (orgId, fp) => this.db.getImportMappingTemplateByFingerprint(orgId, fp)
    );

    // Create batch record
    const batchData: InsertImportBatch = {
      organization_id: organizationId,
      file_name: fileName,
      file_size_bytes: fileBuffer.length,
      file_hash: parsed.fileHash,
      column_fingerprint: parsed.columnFingerprint,
      column_count: parsed.columnCount,
      row_count: parsed.totalRows,
      status: 'parsed',
      format_change_detected: formatChange.detected,
      requires_remapping: formatChange.requiresRemapping,
      created_by: userId,
      valid_row_count: 0,
      error_row_count: 0,
      warning_row_count: 0,
    };

    const batch = await this.db.createImportBatch(batchData);

    // Store staging rows (use cleaned data as raw_data for staging)
    const stagingRows: InsertStagingRow[] = cleanedRows.map((row, idx) => ({
      batch_id: batch.id,
      organization_id: organizationId,
      row_number: idx + 2, // Excel row number (1-indexed + header)
      raw_data: row,
      validation_status: 'pending' as const,
    }));

    await this.db.createImportStagingRows(stagingRows);

    // Record column history
    await this.recordColumnHistory(organizationId, parsed.columnFingerprint, parsed.headers);

    // Get suggested template for preview if available
    const previewTemplate = formatChange.requiresRemapping
      ? null
      : await this.db.getImportMappingTemplateByFingerprint(organizationId, parsed.columnFingerprint);

    // Build preview
    const preview = this.buildPreview(
      batch,
      parsed.headers,
      cleanedRows.slice(0, 10),
      parsed.columnInfo,
      formatChange,
      previewTemplate
    );

    // Build original and cleaned preview rows for frontend cleaning step
    const originalPreview = parsed.rows.slice(0, 100).map((row, index) => ({
      _rowIndex: index,
      ...row,
    }));
    const cleanedPreview = cleanedRows.slice(0, 100).map((row, index) => ({
      _rowIndex: index,
      ...row,
    }));

    // Log audit
    await this.db.createImportAuditLog({
      organization_id: organizationId,
      batch_id: batch.id,
      action: 'upload',
      actor_id: userId,
      details: {
        fileName,
        rowCount: parsed.totalRows,
        columnCount: parsed.columnCount,
        formatChangeDetected: formatChange.detected,
        cleaningApplied: cleaningReport.totalCellsCleaned > 0 || cleaningReport.totalRowsRemoved > 0,
      },
    });

    apiLogger.info(
      { batchId: batch.id, rowCount: parsed.totalRows, cleanedRows: cleanedRows.length },
      'Excel upload complete'
    );

    return {
      batchId: batch.id,
      status: batch.status as ImportBatchStatus,
      preview,
      headers: parsed.headers,
      allColumns: parsed.headers,
      suggestedMapping,
      cleaningReport,
      originalPreview,
      cleanedPreview,
      totalRows: parsed.totalRows,
      totalRowsAfterCleaning: cleanedRows.length,
      totalColumns: parsed.columnCount,
      fileName,
      recognizedColumns,
      unmappedHeaders,
    };
  }

  // ============ PREVIEW ============

  async getPreview(
    organizationId: number,
    batchId: number,
    options: { limit: number; offset: number; showErrors: boolean }
  ): Promise<ImportPreview> {
    const batch = await this.db.getImportBatch(organizationId, batchId);
    if (!batch) {
      throw new Error('Batch ikke funnet');
    }

    const stagingRows = await this.db.getImportStagingRows(batchId, {
      limit: options.limit,
      offset: options.offset,
    });

    let errors: Array<{ id: number; staging_row_id: number; batch_id: number; severity: string; error_code: string; field_name?: string; message: string }> = [];
    if (options.showErrors) {
      errors = await this.db.getImportValidationErrors(batchId);
    }

    // Group errors by staging row
    const errorsByRow = new Map<number, typeof errors>();
    for (const error of errors) {
      let rowErrors = errorsByRow.get(error.staging_row_id);
      if (!rowErrors) {
        rowErrors = [];
        errorsByRow.set(error.staging_row_id, rowErrors);
      }
      rowErrors.push(error);
    }

    const previewRows: PreviewRow[] = stagingRows.map(row => ({
      rowNumber: row.row_number,
      stagingRowId: row.id,
      values: row.raw_data,
      mappedValues: row.mapped_data,
      validationStatus: row.validation_status as StagingRowStatus,
      errors: errorsByRow.get(row.id)?.map(e => ({
        id: e.id,
        staging_row_id: e.staging_row_id,
        batch_id: e.batch_id,
        severity: e.severity as 'error' | 'warning' | 'info',
        error_code: e.error_code as any,
        field_name: e.field_name,
        message: e.message,
        created_at: '',
      })) || [],
    }));

    // Extract columns from first row
    const columns: ColumnInfo[] = stagingRows.length > 0
      ? Object.keys(stagingRows[0].raw_data).map((header, index) => ({
          index,
          header,
          sampleValues: stagingRows.slice(0, 5).map(r => String(r.raw_data[header] || '')),
          uniqueValueCount: 0,
          emptyCount: 0,
        }))
      : [];

    return {
      batchId,
      fileName: batch.file_name,
      columns,
      columnCount: batch.column_count,
      previewRows,
      totalRows: batch.row_count,
      formatChangeDetected: batch.format_change_detected,
    };
  }

  // ============ MAPPING ============

  async applyMapping(
    organizationId: number,
    batchId: number,
    mappingConfig: ImportMappingConfig,
    options: { saveAsTemplate?: boolean; templateName?: string; userId: number }
  ): Promise<ApplyMappingResponse> {
    const batch = await this.db.getImportBatch(organizationId, batchId);
    if (!batch) {
      throw new Error('Batch ikke funnet');
    }

    // Update batch status
    await this.db.updateImportBatch(batchId, { status: 'mapping' });

    // Get all staging rows
    const stagingRows = await this.db.getImportStagingRows(batchId, {
      limit: 10000,
      offset: 0,
    });

    let mappedCount = 0;

    // Log mapping config for debugging
    apiLogger.info(
      { batchId, mappingCount: mappingConfig.mappings.length, mappings: mappingConfig.mappings.map(m => `${m.sourceColumn} → ${m.targetField}`) },
      'Applying mapping config'
    );
    if (stagingRows.length > 0) {
      apiLogger.info(
        { rawDataKeys: Object.keys(stagingRows[0].raw_data), sampleValues: Object.entries(stagingRows[0].raw_data).slice(0, 3).map(([k, v]) => `${k}=${v}`) },
        'First row raw_data sample'
      );
    }

    for (const row of stagingRows) {
      try {
        const mappedData = applyTransformations(row.raw_data, mappingConfig);
        if (mappedCount === 0) {
          apiLogger.info({ mappedDataKeys: Object.keys(mappedData), sampleMapped: Object.entries(mappedData).slice(0, 5).map(([k, v]) => `${k}=${v}`) }, 'First mapped row sample');
        }
        await this.db.updateImportStagingRow(row.id, { mapped_data: mappedData });
        mappedCount++;
      } catch (error) {
        apiLogger.error({ error, rowId: row.id }, 'Failed to map row');
      }
    }

    // Feedback loop: auto-save/update mapping template for this column fingerprint
    const headers = Object.keys(stagingRows[0]?.raw_data || {});
    await this.saveOrUpdateMappingTemplate(
      organizationId, batch.column_fingerprint, headers,
      mappingConfig, options.userId, options.saveAsTemplate, options.templateName
    );

    await this.db.updateImportBatch(batchId, { status: 'mapped' });

    // Log audit
    await this.db.createImportAuditLog({
      organization_id: organizationId,
      batch_id: batchId,
      action: 'map',
      actor_id: options.userId,
      details: {
        mappedCount,
        saveAsTemplate: options.saveAsTemplate,
        templateName: options.templateName,
      },
    });

    return { status: 'mapped', mappedCount };
  }

  // ============ VALIDATION ============

  async validate(
    organizationId: number,
    batchId: number,
    mappingConfig?: ImportMappingConfig
  ): Promise<ValidateImportResponse> {
    const batch = await this.db.getImportBatch(organizationId, batchId);
    if (!batch) {
      throw new Error('Batch ikke funnet');
    }

    await this.db.updateImportBatch(batchId, { status: 'validating' });
    await this.db.deleteImportValidationErrors(batchId);

    const stagingRows = await this.db.getImportStagingRows(batchId, {
      limit: 10000,
      offset: 0,
    });

    const allErrors: any[] = [];
    const counts = await this.validateRows(stagingRows, batchId, mappingConfig, allErrors);

    // Duplicate detection
    const dupResult = await this.runDuplicateDetection(
      organizationId, batchId, stagingRows, allErrors, counts
    );

    // Generate quality report
    const qualityReport = this.buildQualityReport(stagingRows, counts, allErrors);

    // Update batch
    await this.db.updateImportBatch(batchId, {
      status: 'validated',
      valid_row_count: counts.valid,
      warning_row_count: counts.warning,
      error_row_count: counts.error,
    });

    apiLogger.info(
      { batchId, ...counts, duplicates: dupResult?.probableDuplicates ?? 0, quality: qualityReport.overallScore },
      'Validation complete'
    );

    return {
      batchId,
      status: 'validated',
      validCount: counts.valid,
      warningCount: counts.warning,
      errorCount: counts.error,
      errors: allErrors,
      previewRows: [],
      duplicateReport: dupResult ? {
        totalChecked: dupResult.totalChecked,
        probableDuplicates: dupResult.probableDuplicates,
        possibleDuplicates: dupResult.possibleDuplicates,
        uniqueRows: dupResult.uniqueRows,
      } : undefined,
      qualityReport,
    };
  }

  private async validateRows(
    stagingRows: ImportStagingRow[],
    batchId: number,
    mappingConfig: ImportMappingConfig | undefined,
    allErrors: any[]
  ): Promise<{ valid: number; warning: number; error: number; completenessScores: number[] }> {
    let valid = 0, warning = 0, error = 0;
    const completenessScores: number[] = [];

    for (const row of stagingRows) {
      if (!row.mapped_data) continue;

      const result = validateMappedRow(row.mapped_data, row.row_number, mappingConfig);
      completenessScores.push(result.completenessScore);

      if (result.errors.length > 0 || result.warnings.length > 0) {
        const dbErrors = convertToDbErrors(
          [...result.errors, ...result.warnings], row.id, batchId
        );
        await this.db.createImportValidationErrors(dbErrors);
        allErrors.push(...dbErrors);
      }

      let status: StagingRowStatus = 'valid';
      if (result.errors.length > 0) { status = 'invalid'; error++; }
      else if (result.warnings.length > 0) { status = 'warning'; warning++; }
      else { valid++; }

      await this.db.updateImportStagingRow(row.id, { validation_status: status });
    }

    return { valid, warning, error, completenessScores };
  }

  private async runDuplicateDetection(
    organizationId: number,
    batchId: number,
    stagingRows: ImportStagingRow[],
    allErrors: any[],
    counts: { valid: number; warning: number; error: number }
  ): Promise<BatchDuplicateReport | undefined> {
    try {
      const existingKunder = await this.db.getKunderForDuplicateCheck(organizationId);
      const batchRows = stagingRows
        .filter(r => r.mapped_data)
        .map((r, idx) => ({ data: r.mapped_data as Record<string, unknown>, index: idx }));

      if (batchRows.length === 0) return undefined;

      const report = checkDuplicates(batchRows, existingKunder);
      await this.storeDuplicateWarnings(report, stagingRows, batchId, allErrors, counts);
      return report;
    } catch (err) {
      apiLogger.warn({ err, batchId }, 'Duplicate detection failed, continuing without it');
      return undefined;
    }
  }

  private async storeDuplicateWarnings(
    report: BatchDuplicateReport,
    stagingRows: ImportStagingRow[],
    batchId: number,
    allErrors: any[],
    counts: { valid: number; warning: number }
  ): Promise<void> {
    for (const dupResult of report.results) {
      const stagingRow = stagingRows[dupResult.rowIndex];
      const topCandidate = dupResult.candidates[0];
      if (!stagingRow || !topCandidate) continue;

      const errorCode = topCandidate.batchRowIndex === undefined ? 'DUPLICATE_ENTRY' : 'DUPLICATE_IN_BATCH';
      const message = topCandidate.existingKundeId
        ? `Mulig duplikat av eksisterende kunde "${topCandidate.navn}" (${Math.round(topCandidate.score * 100)}% match)`
        : `Mulig duplikat av rad ${(topCandidate.batchRowIndex ?? 0) + 2} i filen (${Math.round(topCandidate.score * 100)}% match)`;

      const dupErrors = [{
        staging_row_id: stagingRow.id,
        batch_id: batchId,
        severity: topCandidate.confidence === 'high' ? 'warning' as const : 'info' as const,
        error_code: errorCode,
        field_name: 'navn',
        message,
        actual_value: typeof stagingRow.mapped_data?.navn === 'string' ? stagingRow.mapped_data.navn : undefined,
        suggestion: topCandidate.existingKundeId ? `Kunde-ID: ${topCandidate.existingKundeId}` : undefined,
      }];
      await this.db.createImportValidationErrors(dupErrors);
      allErrors.push(...dupErrors);

      if (stagingRow.validation_status === 'valid' || stagingRow.validation_status === 'pending') {
        counts.warning++;
        counts.valid = Math.max(0, counts.valid - 1);
        await this.db.updateImportStagingRow(stagingRow.id, { validation_status: 'warning' });
      }
    }
  }

  private buildQualityReport(
    stagingRows: ImportStagingRow[],
    counts: { valid: number; warning: number; error: number; completenessScores: number[] },
    allErrors: any[]
  ): BatchQualityReport {
    const total = counts.valid + counts.warning + counts.error;
    const completenessAvg = counts.completenessScores.length > 0
      ? counts.completenessScores.reduce((a, b) => a + b, 0) / counts.completenessScores.length
      : 0;
    const validPct = total > 0 ? counts.valid / total : 0;

    // Field coverage: what % of rows have a value for each field
    const fieldCoverage: Record<string, number> = {};
    const trackedFields = ['navn', 'adresse', 'postnummer', 'poststed', 'telefon', 'epost', 'kontaktperson'];
    const rowsWithData = stagingRows.filter(r => r.mapped_data);

    for (const field of trackedFields) {
      const filled = rowsWithData.filter(r => {
        const val = r.mapped_data?.[field];
        return val !== null && val !== undefined && String(val).trim() !== '';
      }).length;
      fieldCoverage[field] = rowsWithData.length > 0 ? filled / rowsWithData.length : 0;
    }

    // Common errors grouped by code
    const errorCounts = new Map<string, { count: number; message: string }>();
    for (const err of allErrors) {
      const code = err.error_code || 'UNKNOWN';
      const existing = errorCounts.get(code);
      if (existing) {
        existing.count++;
      } else {
        errorCounts.set(code, { count: 1, message: err.message || code });
      }
    }
    const commonErrors = Array.from(errorCounts.entries())
      .map(([errorCode, { count, message }]) => ({ errorCode, count, message }))
      .sort((a, b) => b.count - a.count);

    // Generate human-readable suggestions
    const suggestions: string[] = [];
    for (const [field, coverage] of Object.entries(fieldCoverage)) {
      if (coverage < 0.5) {
        const pct = Math.round(coverage * 100);
        suggestions.push(`${100 - pct}% av radene mangler ${field}`);
      }
    }
    if (validPct < 0.8) {
      suggestions.push(`Kun ${Math.round(validPct * 100)}% av radene er gyldige - vurder å rette feil før import`);
    }

    // Overall score: weighted combination
    const overallScore = Math.round(
      (validPct * 40) + (completenessAvg * 40) + (Math.min(1, Object.values(fieldCoverage).reduce((a, b) => a + b, 0) / trackedFields.length) * 20)
    );

    return {
      overallScore,
      completenessAverage: completenessAvg,
      validPercentage: validPct,
      fieldCoverage,
      commonErrors,
      suggestions,
    };
  }

  // ============ COMMIT ============

  async commit(
    organizationId: number,
    batchId: number,
    userId: number,
    options: {
      dryRun?: boolean;
      excludedRowIds?: number[];
      rowEdits?: Record<number, Record<string, unknown>>;
    }
  ): Promise<ImportCommitResult> {
    const startedAt = new Date();
    const batch = await this.db.getImportBatch(organizationId, batchId);

    if (!batch) {
      throw new Error('Batch ikke funnet');
    }
    if (batch.status !== 'validated') {
      throw new Error('Batch må valideres før commit');
    }

    if (!options.dryRun) {
      await this.db.updateImportBatch(batchId, { status: 'committing' });
    }

    const stagingRows = await this.db.getImportStagingRows(batchId, {
      limit: 10000,
      offset: 0,
    });

    // Create a set for faster lookup of excluded rows
    const excludedSet = new Set(options.excludedRowIds || []);

    const result: ImportCommitResult = {
      batchId,
      success: true,
      totalProcessed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      createdIds: [],
      updatedIds: [],
      errors: [],
      startedAt: startedAt.toISOString(),
      completedAt: '',
      durationMs: 0,
    };

    // Diagnostic logging for commit
    const statusCounts: Record<string, number> = {};
    let nullMappedDataCount = 0;
    for (const row of stagingRows) {
      statusCounts[row.validation_status] = (statusCounts[row.validation_status] || 0) + 1;
      if (!row.mapped_data) nullMappedDataCount++;
    }
    apiLogger.info(
      { batchId, totalRows: stagingRows.length, statusCounts, nullMappedDataCount, excludedCount: excludedSet.size },
      'Commit diagnostics: row status breakdown'
    );
    if (stagingRows.length > 0) {
      apiLogger.info(
        { sampleRow: { validation_status: stagingRows[0].validation_status, mapped_data: stagingRows[0].mapped_data ? Object.keys(stagingRows[0].mapped_data) : null, raw_data_keys: Object.keys(stagingRows[0].raw_data) } },
        'Commit diagnostics: first row sample'
      );
    }

    for (const row of stagingRows) {
      // Skip rows that are explicitly excluded by the user
      if (excludedSet.has(row.id)) {
        result.skipped++;
        if (!options.dryRun) {
          await this.db.updateImportStagingRow(row.id, { action_taken: 'skipped' });
        }
        continue;
      }

      // Skip invalid rows
      if (row.validation_status === 'invalid') {
        result.skipped++;
        if (!options.dryRun) {
          await this.db.updateImportStagingRow(row.id, { action_taken: 'skipped' });
        }
        continue;
      }

      if (!row.mapped_data) {
        result.skipped++;
        continue;
      }

      // Apply any user edits to this row
      let mappedData = { ...row.mapped_data };
      if (options.rowEdits && options.rowEdits[row.id]) {
        mappedData = { ...mappedData, ...options.rowEdits[row.id] };
      }

      result.totalProcessed++;

      try {
        if (!options.dryRun) {
          // Check for duplicate by name and address
          const navn = String(mappedData.navn || '').trim();
          const adresse = String(mappedData.adresse || '').trim();

          // Use raw values for ilike lookup (case-insensitive match in DB)
          const existing = await this.db.findKundeByNameAndAddress(
            organizationId,
            navn,
            adresse
          );

          // Only include columns that exist in the kunder table
          const KUNDER_COLUMNS = new Set([
            'navn', 'adresse', 'postnummer', 'poststed', 'telefon', 'epost',
            'lat', 'lng', 'kategori', 'el_type', 'brann_system',
            'brann_driftstype', 'driftskategori',
            'siste_el_kontroll', 'neste_el_kontroll', 'el_kontroll_intervall',
            'siste_brann_kontroll', 'neste_brann_kontroll', 'brann_kontroll_intervall',
            'siste_kontroll', 'neste_kontroll', 'kontroll_intervall_mnd',
            'notater',
          ]);
          const kundeData: Record<string, unknown> = {
            organization_id: organizationId,
          };
          for (const [key, value] of Object.entries(mappedData)) {
            if (KUNDER_COLUMNS.has(key) && value !== undefined && value !== null && value !== '') {
              kundeData[key] = value;
            }
          }

          if (existing) {
            await this.db.updateKunde(existing.id, kundeData, organizationId);
            result.updated++;
            result.updatedIds.push(existing.id);
            await this.db.updateImportStagingRow(row.id, {
              target_kunde_id: existing.id,
              action_taken: 'updated',
            });
          } else {
            const newKunde = await this.db.createKunde(kundeData);
            result.created++;
            result.createdIds.push(newKunde.id);
            await this.db.updateImportStagingRow(row.id, {
              target_kunde_id: newKunde.id,
              action_taken: 'created',
            });
          }
        } else {
          // Dry run - just count
          result.created++;
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          rowNumber: row.row_number,
          stagingRowId: row.id,
          error: error instanceof Error ? error.message : 'Ukjent feil',
        });

        if (!options.dryRun) {
          await this.db.updateImportStagingRow(row.id, { action_taken: 'error' });
        }
      }
    }

    const completedAt = new Date();
    result.completedAt = completedAt.toISOString();
    result.durationMs = completedAt.getTime() - startedAt.getTime();

    if (!options.dryRun) {
      await this.db.updateImportBatch(batchId, {
        status: 'committed',
        committed_at: completedAt.toISOString(),
        committed_by: userId,
      });

      // Log audit
      await this.db.createImportAuditLog({
        organization_id: organizationId,
        batch_id: batchId,
        action: 'commit',
        actor_id: userId,
        affected_kunde_ids: [...result.createdIds, ...result.updatedIds],
        details: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
          durationMs: result.durationMs,
        },
      });

      apiLogger.info(
        { batchId, created: result.created, updated: result.updated },
        'Commit complete'
      );
    }

    return result;
  }

  // ============ ROLLBACK ============

  async rollback(
    organizationId: number,
    batchId: number,
    userId: number,
    reason?: string
  ): Promise<RollbackResult> {
    const batch = await this.db.getImportBatch(organizationId, batchId);

    if (!batch) {
      throw new Error('Batch ikke funnet');
    }
    if (batch.status !== 'committed') {
      throw new Error('Kan bare rulle tilbake committede batches');
    }

    // Get staging rows with target kunde IDs
    const stagingRows = await this.db.getImportStagingRows(batchId, {
      limit: 10000,
      offset: 0,
    });

    let recordsReverted = 0;
    let recordsDeleted = 0;

    for (const row of stagingRows) {
      if (!row.target_kunde_id) continue;

      if (row.action_taken === 'created') {
        // Delete created records
        await this.db.deleteKunde(row.target_kunde_id, organizationId);
        recordsDeleted++;
      } else if (row.action_taken === 'updated') {
        // Note: For a full rollback of updates, we would need to store
        // the previous state. This basic implementation just counts them.
        recordsReverted++;
      }
    }

    await this.db.updateImportBatch(batchId, { status: 'cancelled' });

    await this.db.createImportAuditLog({
      organization_id: organizationId,
      batch_id: batchId,
      action: 'rollback',
      actor_id: userId,
      details: {
        reason,
        recordsDeleted,
        recordsReverted,
      },
    });

    apiLogger.info(
      { batchId, recordsDeleted, recordsReverted },
      'Rollback complete'
    );

    return {
      success: true,
      batchId,
      recordsReverted,
      recordsDeleted,
      recordsRestored: 0,
      details: `Rullet tilbake: ${recordsDeleted} slettet, ${recordsReverted} markert for manuell gjennomgang`,
      completedAt: new Date().toISOString(),
    };
  }

  // ============ AI SUGGESTIONS ============

  async getAIMappingSuggestions(
    organizationId: number,
    batchId: number
  ): Promise<AIMappingResult> {
    const batch = await this.db.getImportBatch(organizationId, batchId);
    if (!batch) {
      throw new Error('Batch ikke funnet');
    }

    const stagingRows = await this.db.getImportStagingRows(batchId, {
      limit: 5,
      offset: 0,
    });

    if (stagingRows.length === 0) {
      throw new Error('Ingen data å analysere');
    }

    const headers = Object.keys(stagingRows[0].raw_data);
    const startTime = Date.now();

    // Use rule-based suggestions (as per user's choice)
    const suggestions = suggestColumnMappings(headers);

    return {
      mappings: suggestions.map(s => ({
        sourceColumn: s.sourceColumn,
        suggestedMapping: {
          sourceColumn: s.sourceColumn,
          targetField: s.targetField,
          targetFieldType: 'string',
          required: s.targetField === 'navn' || s.targetField === 'adresse',
          confidence: s.confidence,
          aiSuggested: true,
          humanConfirmed: false,
        },
        confidence: s.confidence,
        reasoning: `Kolonnenavn "${s.sourceColumn}" matcher mønsteret for "${s.targetField}"`,
      })),
      overallConfidence: suggestions.length > 0
        ? suggestions.reduce((acc, s) => acc + s.confidence, 0) / suggestions.length
        : 0,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // ============ CANCEL ============

  async cancelBatch(organizationId: number, batchId: number): Promise<void> {
    const batch = await this.db.getImportBatch(organizationId, batchId);
    if (!batch) {
      throw new Error('Batch ikke funnet');
    }
    if (batch.status === 'committed') {
      throw new Error('Kan ikke avbryte en committet batch - bruk rollback i stedet');
    }

    await this.db.deleteImportStagingRows(batchId);
    await this.db.updateImportBatch(batchId, { status: 'cancelled' });

    apiLogger.info({ batchId }, 'Batch cancelled');
  }

  // ============ FEEDBACK LOOP ============

  /**
   * Auto-save or update a mapping template when user confirms mappings.
   * This enables the learning feedback loop - next import with same columns
   * will automatically use these confirmed mappings.
   */
  private async saveOrUpdateMappingTemplate(
    organizationId: number,
    fingerprint: string,
    headers: string[],
    mappingConfig: ImportMappingConfig,
    userId: number,
    explicitSave?: boolean,
    templateName?: string
  ): Promise<void> {
    try {
      const existing = await this.db.getImportMappingTemplateByFingerprint(organizationId, fingerprint);

      if (existing) {
        // Update existing template with latest confirmed mappings
        await this.db.updateImportMappingTemplate(existing.id, {
          mapping_config: mappingConfig,
          human_confirmed: true,
          confirmed_by: userId,
          confirmed_at: new Date().toISOString(),
          name: templateName || existing.name,
        });
      } else {
        // Create new auto-saved template
        await this.db.createImportMappingTemplate({
          organization_id: organizationId,
          name: templateName || `Auto-lagret ${new Date().toLocaleDateString('nb-NO')}`,
          source_column_fingerprint: fingerprint,
          source_columns: headers,
          mapping_config: mappingConfig,
          ai_suggested: false,
          human_confirmed: true,
          confirmed_by: userId,
          confirmed_at: new Date().toISOString(),
          is_default: explicitSave || false,
          use_count: 1,
        });
      }
    } catch (err) {
      apiLogger.warn({ err }, 'Failed to save mapping template, continuing without it');
    }
  }

  // ============ MAPPING SUGGESTIONS ============

  /**
   * Generate mapping suggestions using a 3-tier approach:
   * 1. Saved template (from previous confirmed imports)
   * 2. Regex-based pattern matching
   * 3. AI fallback for remaining unmapped columns
   */
  private async generateMappingSuggestions(
    organizationId: number,
    headers: string[],
    columnFingerprint: string,
    cleanedRows: Record<string, unknown>[],
    firstRow: Record<string, unknown> | undefined
  ): Promise<{
    suggestedMapping: Record<string, string>;
    recognizedColumns: UploadImportResponse['recognizedColumns'];
    unmappedHeaders: string[];
  }> {
    const suggestedMapping: Record<string, string> = {};
    const recognizedColumns: UploadImportResponse['recognizedColumns'] = [];
    const unmappedHeaders: string[] = [];

    // Tier 1: Apply saved template mappings (highest priority)
    const savedTemplate = await this.db.getImportMappingTemplateByFingerprint(
      organizationId, columnFingerprint
    );
    const templateColumns = new Set<string>();
    if (savedTemplate?.mapping_config?.mappings) {
      for (const m of savedTemplate.mapping_config.mappings) {
        if (headers.includes(m.sourceColumn)) {
          suggestedMapping[m.sourceColumn] = m.targetField;
          templateColumns.add(m.sourceColumn);
        }
      }
      await this.db.updateImportMappingTemplate(savedTemplate.id, {
        use_count: savedTemplate.use_count + 1,
        last_used_at: new Date().toISOString(),
      });
    }

    // Tier 2: Regex-based suggestions for non-template columns
    const regexSuggestions = suggestColumnMappings(headers);
    for (const suggestion of regexSuggestions) {
      if (!suggestedMapping[suggestion.sourceColumn]) {
        suggestedMapping[suggestion.sourceColumn] = suggestion.targetField;
      }
    }

    // Build recognized/unmapped lists
    for (const header of headers) {
      if (suggestedMapping[header]) {
        const regexMatch = regexSuggestions.find(s => s.sourceColumn === header);
        const isFromTemplate = templateColumns.has(header);
        const sampleVal = firstRow?.[header];
        recognizedColumns.push({
          excelHeader: header,
          mappedTo: suggestedMapping[header],
          source: isFromTemplate ? 'saved_template' : 'deterministic',
          confidence: isFromTemplate ? 0.95 : (regexMatch?.confidence ?? 0.8),
          sampleValue: typeof sampleVal === 'string' ? sampleVal : String(sampleVal ?? ''),
        });
      } else {
        unmappedHeaders.push(header);
      }
    }

    // Tier 3: AI fallback for unmapped columns
    if (unmappedHeaders.length > 0) {
      await this.enrichWithAISuggestions(
        unmappedHeaders, cleanedRows, firstRow, suggestedMapping, recognizedColumns
      );
    }

    return { suggestedMapping, recognizedColumns, unmappedHeaders };
  }

  private async enrichWithAISuggestions(
    unmappedHeaders: string[],
    cleanedRows: Record<string, unknown>[],
    firstRow: Record<string, unknown> | undefined,
    suggestedMapping: Record<string, string>,
    recognizedColumns: UploadImportResponse['recognizedColumns']
  ): Promise<void> {
    const aiSuggestions = await getAIMappingSuggestions(
      unmappedHeaders, cleanedRows.slice(0, 3), suggestedMapping
    );
    for (const ai of aiSuggestions) {
      suggestedMapping[ai.sourceColumn] = ai.targetField;
      const sampleVal = firstRow?.[ai.sourceColumn];
      recognizedColumns.push({
        excelHeader: ai.sourceColumn,
        mappedTo: ai.targetField,
        source: 'ai',
        confidence: ai.confidence,
        sampleValue: typeof sampleVal === 'string' ? sampleVal : String(sampleVal ?? ''),
      });
      const idx = unmappedHeaders.indexOf(ai.sourceColumn);
      if (idx !== -1) unmappedHeaders.splice(idx, 1);
    }
  }

  // ============ HELPERS ============

  private async recordColumnHistory(
    organizationId: number,
    fingerprint: string,
    columns: string[]
  ): Promise<void> {
    const history = await this.db.getImportColumnHistory(organizationId);
    const existing = history.find(h => h.column_fingerprint === fingerprint);

    if (existing) {
      await this.db.updateImportColumnHistory(existing.id, {
        last_seen_at: new Date().toISOString(),
        batch_count: existing.batch_count + 1,
      });
    } else {
      await this.db.createImportColumnHistory({
        organization_id: organizationId,
        column_fingerprint: fingerprint,
        columns,
      });
    }
  }

  private buildPreview(
    batch: ImportBatch,
    headers: string[],
    sampleRows: Record<string, unknown>[],
    columnInfo: ColumnInfo[],
    formatChange: FormatChangeResult,
    suggestedTemplate: ImportMappingTemplate | null
  ): ImportPreview {
    const previewRows: PreviewRow[] = sampleRows.map((row, idx) => ({
      rowNumber: idx + 2, // Excel row number
      values: row,
    }));

    return {
      batchId: batch.id,
      fileName: batch.file_name,
      columns: columnInfo,
      columnCount: headers.length,
      previewRows,
      totalRows: batch.row_count,
      formatChangeDetected: formatChange.detected,
      previousFingerprint: formatChange.previousFingerprint,
      suggestedTemplate: suggestedTemplate || undefined,
    };
  }
}

export { ImportService };

/**
 * Import Service
 * Main orchestrator for the Excel import pipeline
 */

import { apiLogger } from '../logger';
import { parseExcelBuffer } from './parser';
import { detectFormatChange, suggestColumnMappings } from './format-detection';
import { applyTransformations } from './transformers';
import { validateMappedRow, convertToDbErrors } from './validation';
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
}

// Singleton instance
let importServiceInstance: ImportService | null = null;
let dbServiceRef: ImportDbService | null = null;

export function initImportService(dbService: ImportDbService): void {
  dbServiceRef = dbService;
  importServiceInstance = null; // Reset instance to use new db service
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
function normalizeCompanyName(name: string): string {
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
function normalizeAddress(address: string): string {
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

  // ============ UPLOAD & PARSE ============

  async uploadAndParse(
    organizationId: number,
    userId: number,
    fileBuffer: Buffer,
    fileName: string
  ): Promise<{ batchId: number; status: ImportBatchStatus; preview: ImportPreview }> {
    apiLogger.info({ organizationId, fileName }, 'Starting Excel upload and parse');

    // Parse Excel file
    const parsed = parseExcelBuffer(fileBuffer);

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

    // Store staging rows
    const stagingRows: InsertStagingRow[] = parsed.rows.map((row, idx) => ({
      batch_id: batch.id,
      organization_id: organizationId,
      row_number: idx + 2, // Excel row number (1-indexed + header)
      raw_data: row,
      validation_status: 'pending' as const,
    }));

    await this.db.createImportStagingRows(stagingRows);

    // Record column history
    await this.recordColumnHistory(organizationId, parsed.columnFingerprint, parsed.headers);

    // Get suggested template if available
    let suggestedTemplate: ImportMappingTemplate | null = null;
    if (!formatChange.requiresRemapping) {
      suggestedTemplate = await this.db.getImportMappingTemplateByFingerprint(
        organizationId,
        parsed.columnFingerprint
      );
    }

    // Build preview
    const preview = this.buildPreview(
      batch,
      parsed.headers,
      parsed.rows.slice(0, 10),
      parsed.columnInfo,
      formatChange,
      suggestedTemplate
    );

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
      },
    });

    apiLogger.info(
      { batchId: batch.id, rowCount: parsed.totalRows },
      'Excel upload complete'
    );

    return {
      batchId: batch.id,
      status: batch.status as ImportBatchStatus,
      preview,
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

    for (const row of stagingRows) {
      try {
        const mappedData = applyTransformations(row.raw_data, mappingConfig);
        await this.db.updateImportStagingRow(row.id, { mapped_data: mappedData });
        mappedCount++;
      } catch (error) {
        apiLogger.error({ error, rowId: row.id }, 'Failed to map row');
      }
    }

    // Save as template if requested
    if (options.saveAsTemplate && options.templateName) {
      const headers = Object.keys(stagingRows[0]?.raw_data || {});
      await this.db.createImportMappingTemplate({
        organization_id: organizationId,
        name: options.templateName,
        source_column_fingerprint: batch.column_fingerprint,
        source_columns: headers,
        mapping_config: mappingConfig,
        ai_suggested: false,
        human_confirmed: true,
        confirmed_by: options.userId,
        confirmed_at: new Date().toISOString(),
        is_default: false,
        use_count: 1,
      });
    }

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

    // Clear previous errors
    await this.db.deleteImportValidationErrors(batchId);

    const stagingRows = await this.db.getImportStagingRows(batchId, {
      limit: 10000,
      offset: 0,
    });

    let validCount = 0;
    let warningCount = 0;
    let errorCount = 0;
    const allErrors: any[] = [];

    for (const row of stagingRows) {
      if (!row.mapped_data) {
        continue;
      }

      const result = validateMappedRow(row.mapped_data, row.row_number, mappingConfig);

      // Store errors
      if (result.errors.length > 0 || result.warnings.length > 0) {
        const dbErrors = convertToDbErrors(
          [...result.errors, ...result.warnings],
          row.id,
          batchId
        );
        await this.db.createImportValidationErrors(dbErrors);
        allErrors.push(...dbErrors);
      }

      // Update row status
      let status: StagingRowStatus = 'valid';
      if (result.errors.length > 0) {
        status = 'invalid';
        errorCount++;
      } else if (result.warnings.length > 0) {
        status = 'warning';
        warningCount++;
      } else {
        validCount++;
      }

      await this.db.updateImportStagingRow(row.id, { validation_status: status });
    }

    // Update batch
    await this.db.updateImportBatch(batchId, {
      status: 'validated',
      valid_row_count: validCount,
      warning_row_count: warningCount,
      error_row_count: errorCount,
    });

    apiLogger.info(
      { batchId, validCount, warningCount, errorCount },
      'Validation complete'
    );

    return {
      batchId,
      status: 'validated',
      validCount,
      warningCount,
      errorCount,
      errors: allErrors,
      previewRows: [],
    };
  }

  // ============ COMMIT ============

  async commit(
    organizationId: number,
    batchId: number,
    userId: number,
    options: { dryRun?: boolean }
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

    for (const row of stagingRows) {
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

      result.totalProcessed++;

      try {
        if (!options.dryRun) {
          // Check for duplicate by name and address (with normalization)
          const navn = String(row.mapped_data.navn || '').trim();
          const adresse = String(row.mapped_data.adresse || '').trim();

          // Use normalized values for duplicate detection
          const normalizedNavn = normalizeCompanyName(navn);
          const normalizedAdresse = normalizeAddress(adresse);

          const existing = await this.db.findKundeByNameAndAddress(
            organizationId,
            normalizedNavn,
            normalizedAdresse
          );

          const kundeData = {
            ...row.mapped_data,
            organization_id: organizationId,
            import_hash: batch.file_hash,
            last_import_at: new Date().toISOString(),
          };

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

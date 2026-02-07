/**
 * Import Database Adapter
 * Provides database operations for the import system using Supabase directly
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../../config/env';
import { dbLogger } from '../logger';
import type { ImportDbService } from './index';
import type { ExistingKunde } from './duplicate-detection';
import type {
  ImportBatch,
  ImportStagingRow,
  ImportMappingTemplate,
  ImportColumnHistory,
  InsertImportBatch,
  InsertStagingRow,
  InsertAuditLog,
  ImportBatchQueryOptions,
  StagingRowQueryOptions,
} from '../../types/import';

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    const config = getConfig();
    const supabaseUrl = config.SUPABASE_URL;
    // Use service role key (bypasses RLS) like the main database service
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || config.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }
    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseClient;
}

/** Check if a Supabase error is a "table not found" error (PGRST205) */
function isTableNotFoundError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === 'PGRST205' || (error?.message?.includes('Could not find the table') ?? false);
}

/**
 * Create an import database service instance
 */
export function createImportDbService(): ImportDbService {
  return {
    // ============ BATCH OPERATIONS ============

    async createImportBatch(data: InsertImportBatch): Promise<ImportBatch> {
      const supabase = getSupabase();

      const { data: batch, error } = await supabase
        .from('import_batches')
        .insert({
          organization_id: data.organization_id,
          file_name: data.file_name,
          file_size_bytes: data.file_size_bytes,
          file_hash: data.file_hash,
          original_file_url: data.original_file_url,
          column_fingerprint: data.column_fingerprint,
          column_count: data.column_count,
          row_count: data.row_count,
          status: data.status,
          format_change_detected: data.format_change_detected,
          requires_remapping: data.requires_remapping,
          created_by: data.created_by,
          valid_row_count: data.valid_row_count,
          error_row_count: data.error_row_count,
          warning_row_count: data.warning_row_count,
        })
        .select()
        .single();

      if (error) {
        if (isTableNotFoundError(error)) {
          dbLogger.error({ error }, 'Import tables not found. Run migration 006_import_system.sql in Supabase SQL Editor.');
          throw new Error('Import-tabellene finnes ikke i databasen. Kjør migrering 006_import_system.sql i Supabase SQL Editor.');
        }
        dbLogger.error({ error }, 'Failed to create import batch');
        throw new Error(`Kunne ikke opprette import-batch: ${error.message}`);
      }

      return batch as ImportBatch;
    },

    async getImportBatch(organizationId: number, batchId: number): Promise<ImportBatch | null> {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('import_batches')
        .select('*')
        .eq('id', batchId)
        .eq('organization_id', organizationId)
        .single();

      if (error && error.code !== 'PGRST116') {
        dbLogger.error({ error, batchId }, 'Failed to get import batch');
        throw new Error(`Kunne ikke hente batch: ${error.message}`);
      }

      return data as ImportBatch | null;
    },

    async getImportBatches(organizationId: number, options: ImportBatchQueryOptions): Promise<ImportBatch[]> {
      const supabase = getSupabase();

      let query = supabase
        .from('import_batches')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .range(options.offset || 0, (options.offset || 0) + (options.limit || 20) - 1);

      if (options.status) {
        query = query.eq('status', options.status);
      }

      const { data, error } = await query;

      if (error) {
        dbLogger.error({ error }, 'Failed to list import batches');
        throw new Error(`Kunne ikke liste batches: ${error.message}`);
      }

      return (data || []) as ImportBatch[];
    },

    async updateImportBatch(batchId: number, data: Partial<ImportBatch>): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_batches')
        .update({
          ...data,
          updated_at: new Date().toISOString(),
        })
        .eq('id', batchId);

      if (error) {
        dbLogger.error({ error, batchId }, 'Failed to update import batch');
        throw new Error(`Kunne ikke oppdatere batch: ${error.message}`);
      }
    },

    // ============ STAGING ROW OPERATIONS ============

    async createImportStagingRows(rows: InsertStagingRow[]): Promise<void> {
      const supabase = getSupabase();

      // Insert in batches of 100 to avoid payload limits
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);

        const { error } = await supabase
          .from('import_staging_rows')
          .insert(batch.map(row => ({
            batch_id: row.batch_id,
            organization_id: row.organization_id,
            row_number: row.row_number,
            raw_data: row.raw_data,
            validation_status: row.validation_status,
          })));

        if (error) {
          if (isTableNotFoundError(error)) {
            dbLogger.error({ error }, 'Import tables not found. Run migration 006_import_system.sql in Supabase SQL Editor.');
            throw new Error('Import-tabellene finnes ikke i databasen. Kjør migrering 006_import_system.sql i Supabase SQL Editor.');
          }
          dbLogger.error({ error }, 'Failed to insert staging rows');
          throw new Error(`Kunne ikke lagre staging-rader: ${error.message}`);
        }
      }
    },

    async getImportStagingRows(batchId: number, options: StagingRowQueryOptions): Promise<ImportStagingRow[]> {
      const supabase = getSupabase();

      let query = supabase
        .from('import_staging_rows')
        .select('*')
        .eq('batch_id', batchId)
        .order('row_number', { ascending: true })
        .range(options.offset, options.offset + options.limit - 1);

      if (options.validationStatus) {
        query = query.eq('validation_status', options.validationStatus);
      }

      const { data, error } = await query;

      if (error) {
        dbLogger.error({ error, batchId }, 'Failed to get staging rows');
        throw new Error(`Kunne ikke hente staging-rader: ${error.message}`);
      }

      return (data || []) as ImportStagingRow[];
    },

    async updateImportStagingRow(rowId: number, data: Partial<ImportStagingRow>): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_staging_rows')
        .update(data)
        .eq('id', rowId);

      if (error) {
        dbLogger.error({ error, rowId }, 'Failed to update staging row');
        throw new Error(`Kunne ikke oppdatere staging-rad: ${error.message}`);
      }
    },

    async deleteImportStagingRows(batchId: number): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_staging_rows')
        .delete()
        .eq('batch_id', batchId);

      if (error) {
        dbLogger.error({ error, batchId }, 'Failed to delete staging rows');
        throw new Error(`Kunne ikke slette staging-rader: ${error.message}`);
      }
    },

    // ============ VALIDATION ERRORS ============

    async createImportValidationErrors(errors: Array<{
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
    }>): Promise<void> {
      if (errors.length === 0) return;

      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_validation_errors')
        .insert(errors);

      if (error) {
        dbLogger.error({ error }, 'Failed to insert validation errors');
        throw new Error(`Kunne ikke lagre valideringsfeil: ${error.message}`);
      }
    },

    async deleteImportValidationErrors(batchId: number): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_validation_errors')
        .delete()
        .eq('batch_id', batchId);

      if (error) {
        dbLogger.error({ error, batchId }, 'Failed to delete validation errors');
        throw new Error(`Kunne ikke slette valideringsfeil: ${error.message}`);
      }
    },

    async getImportValidationErrors(batchId: number): Promise<Array<{
      id: number;
      staging_row_id: number;
      batch_id: number;
      severity: string;
      error_code: string;
      field_name?: string;
      source_column?: string;
      message: string;
    }>> {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('import_validation_errors')
        .select('*')
        .eq('batch_id', batchId)
        .order('staging_row_id', { ascending: true });

      if (error) {
        dbLogger.error({ error, batchId }, 'Failed to get validation errors');
        throw new Error(`Kunne ikke hente valideringsfeil: ${error.message}`);
      }

      return data || [];
    },

    // ============ MAPPING TEMPLATES ============

    async getImportMappingTemplates(organizationId: number): Promise<ImportMappingTemplate[]> {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('import_mapping_templates')
        .select('*')
        .eq('organization_id', organizationId)
        .order('use_count', { ascending: false });

      if (error) {
        if (isTableNotFoundError(error)) {
          dbLogger.warn({ error }, 'import_mapping_templates table not found, returning empty list');
          return [];
        }
        dbLogger.error({ error }, 'Failed to get mapping templates');
        throw new Error(`Kunne ikke hente maler: ${error.message}`);
      }

      return (data || []) as ImportMappingTemplate[];
    },

    async getImportMappingTemplateByFingerprint(
      organizationId: number,
      fingerprint: string
    ): Promise<ImportMappingTemplate | null> {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('import_mapping_templates')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('source_column_fingerprint', fingerprint)
        .order('use_count', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        if (isTableNotFoundError(error)) {
          dbLogger.warn({ error }, 'import_mapping_templates table not found, skipping template lookup');
          return null;
        }
        dbLogger.error({ error }, 'Failed to get template by fingerprint');
        throw new Error(`Kunne ikke hente mal: ${error.message}`);
      }

      return data as ImportMappingTemplate | null;
    },

    async createImportMappingTemplate(
      data: Omit<ImportMappingTemplate, 'id' | 'created_at' | 'updated_at'>
    ): Promise<ImportMappingTemplate> {
      const supabase = getSupabase();

      const { data: template, error } = await supabase
        .from('import_mapping_templates')
        .insert(data)
        .select()
        .single();

      if (error) {
        if (isTableNotFoundError(error)) {
          dbLogger.warn({ error }, 'import_mapping_templates table not found, skipping template save');
          return {} as ImportMappingTemplate;
        }
        dbLogger.error({ error }, 'Failed to create mapping template');
        throw new Error(`Kunne ikke opprette mal: ${error.message}`);
      }

      return template as ImportMappingTemplate;
    },

    async updateImportMappingTemplate(templateId: number, data: Partial<ImportMappingTemplate>): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_mapping_templates')
        .update({
          ...data,
          updated_at: new Date().toISOString(),
        })
        .eq('id', templateId);

      if (error) {
        if (isTableNotFoundError(error)) {
          dbLogger.warn({ error }, 'import_mapping_templates table not found, skipping template update');
          return;
        }
        dbLogger.error({ error, templateId }, 'Failed to update mapping template');
        throw new Error(`Kunne ikke oppdatere mal: ${error.message}`);
      }
    },

    async deleteImportMappingTemplate(organizationId: number, templateId: number): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_mapping_templates')
        .delete()
        .eq('id', templateId)
        .eq('organization_id', organizationId);

      if (error) {
        dbLogger.error({ error, templateId }, 'Failed to delete mapping template');
        throw new Error(`Kunne ikke slette mal: ${error.message}`);
      }
    },

    // ============ COLUMN HISTORY ============

    async getImportColumnHistory(organizationId: number): Promise<ImportColumnHistory[]> {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('import_column_history')
        .select('*')
        .eq('organization_id', organizationId)
        .order('last_seen_at', { ascending: false });

      if (error) {
        if (isTableNotFoundError(error)) {
          dbLogger.warn({ error }, 'import_column_history table not found, returning empty list');
          return [];
        }
        dbLogger.error({ error }, 'Failed to get column history');
        throw new Error(`Kunne ikke hente kolonnehistorikk: ${error.message}`);
      }

      return (data || []) as ImportColumnHistory[];
    },

    async createImportColumnHistory(data: {
      organization_id: number;
      column_fingerprint: string;
      columns: string[];
    }): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_column_history')
        .insert(data);

      if (error) {
        if (isTableNotFoundError(error)) {
          dbLogger.warn({ error }, 'import_column_history table not found, skipping');
          return;
        }
        dbLogger.error({ error }, 'Failed to create column history');
        throw new Error(`Kunne ikke lagre kolonnehistorikk: ${error.message}`);
      }
    },

    async updateImportColumnHistory(historyId: number, data: Partial<ImportColumnHistory>): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_column_history')
        .update(data)
        .eq('id', historyId);

      if (error) {
        if (isTableNotFoundError(error)) {
          dbLogger.warn({ error }, 'import_column_history table not found, skipping update');
          return;
        }
        dbLogger.error({ error, historyId }, 'Failed to update column history');
        throw new Error(`Kunne ikke oppdatere kolonnehistorikk: ${error.message}`);
      }
    },

    // ============ AUDIT LOG ============

    async createImportAuditLog(data: InsertAuditLog): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('import_audit_log')
        .insert(data);

      if (error) {
        dbLogger.error({ error }, 'Failed to create audit log');
        // Don't throw - audit logging should not block operations
      }
    },

    // ============ KUNDE OPERATIONS (for commit) ============

    async findKundeByNameAndAddress(
      organizationId: number,
      navn: string,
      adresse: string
    ): Promise<{ id: number } | null> {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('kunder')
        .select('id')
        .eq('organization_id', organizationId)
        .ilike('navn', navn)
        .ilike('adresse', adresse)
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        dbLogger.error({ error }, 'Failed to find kunde');
        throw new Error(`Kunne ikke søke etter kunde: ${error.message}`);
      }

      return data as { id: number } | null;
    },

    async createKunde(data: Record<string, unknown>): Promise<{ id: number }> {
      const supabase = getSupabase();

      const { data: kunde, error } = await supabase
        .from('kunder')
        .insert(data)
        .select('id')
        .single();

      if (error) {
        dbLogger.error({ error }, 'Failed to create kunde');
        throw new Error(`Kunne ikke opprette kunde: ${error.message}`);
      }

      return kunde as { id: number };
    },

    async updateKunde(id: number, data: Record<string, unknown>, organizationId: number): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('kunder')
        .update(data)
        .eq('id', id)
        .eq('organization_id', organizationId);

      if (error) {
        dbLogger.error({ error, id }, 'Failed to update kunde');
        throw new Error(`Kunne ikke oppdatere kunde: ${error.message}`);
      }
    },

    async deleteKunde(id: number, organizationId: number): Promise<void> {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('kunder')
        .delete()
        .eq('id', id)
        .eq('organization_id', organizationId);

      if (error) {
        dbLogger.error({ error, id }, 'Failed to delete kunde');
        throw new Error(`Kunne ikke slette kunde: ${error.message}`);
      }
    },

    // ============ DUPLICATE DETECTION ============

    async getKunderForDuplicateCheck(organizationId: number): Promise<ExistingKunde[]> {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('kunder')
        .select('id, navn, adresse, postnummer, epost, telefon')
        .eq('organization_id', organizationId)
        .limit(5000);

      if (error) {
        dbLogger.error({ error }, 'Failed to fetch kunder for duplicate check');
        throw new Error(`Kunne ikke hente kunder for duplikatsjekk: ${error.message}`);
      }

      return (data || []) as ExistingKunde[];
    },
  };
}

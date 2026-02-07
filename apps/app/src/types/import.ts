/**
 * Excel Import System Types
 * Comprehensive type definitions for the staging-based import pipeline
 */

import type { CleaningReport } from '../services/import/cleaner';

// ============ Import Batch Status State Machine ============

export type ImportBatchStatus =
  | 'uploaded'    // File uploaded, awaiting parsing
  | 'parsing'     // Parsing Excel file
  | 'parsed'      // Parsing complete, raw data available
  | 'mapping'     // User is configuring mappings
  | 'mapped'      // Mappings confirmed
  | 'validating'  // Running validation rules
  | 'validated'   // Validation complete, ready for commit
  | 'committing'  // Committing to production
  | 'committed'   // Successfully committed
  | 'failed'      // Failed (check error_message)
  | 'cancelled';  // User cancelled

// ============ Import Batch ============

export interface ImportBatch {
  id: number;
  organization_id: number;

  // File metadata
  file_name: string;
  file_size_bytes: number;
  file_hash: string;
  original_file_url?: string;

  // Structure
  column_fingerprint: string;
  column_count: number;
  row_count: number;

  // Status
  status: ImportBatchStatus;
  mapping_template_id?: number;
  format_change_detected: boolean;
  requires_remapping: boolean;

  // Statistics
  valid_row_count: number;
  error_row_count: number;
  warning_row_count: number;

  // Audit
  created_by: number;
  created_at: string;
  updated_at: string;
  committed_at?: string;
  committed_by?: number;

  // Error info
  error_message?: string;
  error_details?: Record<string, unknown>;
}

export type InsertImportBatch = Omit<ImportBatch, 'id' | 'created_at' | 'updated_at'>;
export type UpdateImportBatch = Partial<Omit<ImportBatch, 'id' | 'organization_id' | 'created_at' | 'created_by'>>;

// ============ Staging Row Types ============

export type StagingRowStatus = 'pending' | 'valid' | 'invalid' | 'warning';
export type StagingRowAction = 'created' | 'updated' | 'skipped' | 'error';

export interface ImportStagingRow {
  id: number;
  batch_id: number;
  organization_id: number;
  row_number: number;

  // Data
  raw_data: Record<string, unknown>;
  mapped_data?: Record<string, unknown>;

  // Status
  validation_status: StagingRowStatus;
  target_kunde_id?: number;
  action_taken?: StagingRowAction;

  created_at: string;
}

export type InsertStagingRow = Omit<ImportStagingRow, 'id' | 'created_at'>;
export type UpdateStagingRow = Partial<Pick<ImportStagingRow, 'mapped_data' | 'validation_status' | 'target_kunde_id' | 'action_taken'>>;

// ============ Validation Error Types ============

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationErrorCode =
  | 'REQUIRED_FIELD_MISSING'
  | 'INVALID_FORMAT'
  | 'INVALID_EMAIL'
  | 'INVALID_PHONE'
  | 'INVALID_POSTNUMMER'
  | 'INVALID_DATE'
  | 'INVALID_NUMBER'
  | 'VALUE_OUT_OF_RANGE'
  | 'DUPLICATE_ENTRY'
  | 'DUPLICATE_IN_BATCH'
  | 'UNKNOWN_CATEGORY'
  | 'UNKNOWN_SERVICE_TYPE'
  | 'GEOCODING_FAILED'
  | 'CUSTOM_VALIDATION_FAILED';

export interface ImportValidationError {
  id: number;
  staging_row_id: number;
  batch_id: number;

  severity: ValidationSeverity;
  error_code: ValidationErrorCode;
  field_name?: string;
  source_column?: string;

  message: string;
  expected_format?: string;
  actual_value?: string;
  suggestion?: string;

  created_at: string;
}

export type InsertValidationError = Omit<ImportValidationError, 'id' | 'created_at'>;

// ============ Mapping Template Types ============

export interface ImportMappingTemplate {
  id: number;
  organization_id: number;

  name: string;
  description?: string;
  is_default: boolean;

  source_column_fingerprint: string;
  source_columns: string[];
  mapping_config: ImportMappingConfig;

  ai_suggested: boolean;
  ai_confidence_score?: number;
  human_confirmed: boolean;
  confirmed_by?: number;
  confirmed_at?: string;

  use_count: number;
  last_used_at?: string;

  created_at: string;
  updated_at: string;
}

export type InsertMappingTemplate = Omit<ImportMappingTemplate, 'id' | 'created_at' | 'updated_at'>;

// ============ Column History ============

export interface ImportColumnHistory {
  id: number;
  organization_id: number;
  column_fingerprint: string;
  columns: string[];
  first_seen_at: string;
  last_seen_at: string;
  batch_count: number;
}

export type InsertColumnHistory = Omit<ImportColumnHistory, 'id' | 'first_seen_at' | 'last_seen_at' | 'batch_count'>;

// ============ Audit Log ============

export interface ImportAuditLog {
  id: number;
  organization_id: number;
  batch_id?: number;
  action: 'upload' | 'parse' | 'map' | 'validate' | 'commit' | 'rollback' | 'cancel';
  actor_id: number;
  previous_state?: Record<string, unknown>;
  new_state?: Record<string, unknown>;
  affected_kunde_ids?: number[];
  details?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export type InsertAuditLog = Omit<ImportAuditLog, 'id' | 'created_at'>;

// ============ Mapping Configuration (JSON Format) ============

export interface ImportMappingConfig {
  version: '1.0';

  // Column mappings
  mappings: ColumnMapping[];

  // Global options
  options: MappingOptions;
}

export interface ColumnMapping {
  // Source
  sourceColumn: string;        // Excel column header
  sourceColumnIndex?: number;  // Optional: column index (A=0, B=1, etc.)

  // Target
  targetField: string;         // Database field name (e.g., 'navn', 'adresse')
  targetFieldType: FieldType;

  // Mapping metadata
  required: boolean;
  confidence?: number;         // 0-1, from AI suggestions
  aiSuggested?: boolean;
  humanConfirmed?: boolean;

  // Transformation
  transformation?: TransformationRule;

  // Validation
  validationRules?: ValidationRule[];

  // Default value
  defaultValue?: unknown;
  useDefaultIfEmpty?: boolean;
}

export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'email'
  | 'phone'
  | 'postnummer'
  | 'kategori'
  | 'custom';

// ============ Transformation Rules ============

export interface TransformationRule {
  type: TransformationType;
  params?: Record<string, unknown>;
}

export type TransformationType =
  | 'none'
  | 'trim'
  | 'uppercase'
  | 'lowercase'
  | 'capitalize'
  | 'parseNumber'
  | 'parseInteger'
  | 'parseDate'
  | 'parseBoolean'
  | 'formatPhone'
  | 'formatPostnummer'
  | 'parseNorwegianDate'   // DD.MM.YYYY or DD/MM/YYYY
  | 'parseExcelDate'       // Excel serial number
  | 'splitFirst'           // Take first part before delimiter
  | 'splitLast'            // Take last part after delimiter
  | 'regex'                // Custom regex extraction
  | 'lookup';              // Map value using lookup table

// ============ Validation Rules ============

export interface ValidationRule {
  type: ValidationType;
  params?: Record<string, unknown>;
  severity: ValidationSeverity;
  message?: string;  // Custom error message (Norwegian)
}

export type ValidationType =
  | 'required'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'email'
  | 'phone'
  | 'postnummer'
  | 'date'
  | 'dateRange'
  | 'number'
  | 'integer'
  | 'range'
  | 'enum'
  | 'unique'
  | 'uniqueInBatch';

// ============ Mapping Options ============

export interface MappingOptions {
  // Row handling
  skipHeaderRows: number;         // Number of header rows to skip (default: 1)
  skipEmptyRows: boolean;         // Skip completely empty rows
  trimWhitespace: boolean;        // Trim all string values

  // Duplicate handling
  duplicateDetection: 'none' | 'name' | 'name_address' | 'external_id' | 'email';
  duplicateAction: 'skip' | 'update' | 'error';

  // Error handling
  stopOnFirstError: boolean;      // Stop validation on first error
  maxErrors: number;              // Max errors before aborting (0 = no limit)

  // Date parsing
  dateFormat: string;             // Primary date format (e.g., 'DD.MM.YYYY')
  fallbackDateFormats?: string[]; // Additional formats to try

  // Category/service type handling
  autoCreateCategories: boolean;   // Create new categories if not found
  defaultCategory?: string;
}

// ============ AI Mapping Suggestion Types ============

export interface AIMappingSuggestion {
  sourceColumn: string;
  suggestedMapping: ColumnMapping;
  alternativeMappings?: ColumnMapping[];
  confidence: number;
  reasoning: string;
}

export interface AIMappingResult {
  mappings: AIMappingSuggestion[];
  overallConfidence: number;
  processingTimeMs: number;
  warnings?: string[];
}

// ============ Import Preview Types ============

export interface ImportPreview {
  batchId: number;
  fileName: string;

  // Column info
  columns: ColumnInfo[];
  columnCount: number;

  // Row preview
  previewRows: PreviewRow[];
  totalRows: number;

  // Format detection
  formatChangeDetected: boolean;
  previousFingerprint?: string;
  suggestedTemplate?: ImportMappingTemplate;

  // AI suggestions
  aiMappingSuggestions?: AIMappingResult;
}

export interface ColumnInfo {
  index: number;
  header: string;
  sampleValues: string[];
  detectedType?: FieldType;
  uniqueValueCount: number;
  emptyCount: number;
}

export interface PreviewRow {
  rowNumber: number;
  stagingRowId?: number;
  values: Record<string, unknown>;
  mappedValues?: Record<string, unknown>;
  validationStatus?: StagingRowStatus;
  errors?: ImportValidationError[];
}

// ============ Commit Result Types ============

export interface ImportCommitResult {
  batchId: number;
  success: boolean;

  // Statistics
  totalProcessed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;

  // Created/updated IDs
  createdIds: number[];
  updatedIds: number[];

  // Error details
  errors: CommitError[];

  // Timing
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface CommitError {
  rowNumber: number;
  stagingRowId: number;
  error: string;
  details?: Record<string, unknown>;
}

// ============ Rollback Types ============

export interface RollbackRequest {
  batchId: number;
  reason?: string;
}

export interface RollbackResult {
  success: boolean;
  batchId: number;

  // Statistics
  recordsReverted: number;
  recordsDeleted: number;
  recordsRestored: number;

  // Details
  details: string;
  completedAt: string;
}

// ============ API Request/Response Types ============

export interface UploadImportResponse {
  batchId: number;
  status: ImportBatchStatus;
  preview: ImportPreview;

  // Data for frontend compatibility (cleaning + mapping)
  headers: string[];
  allColumns: string[];
  suggestedMapping: Record<string, string>;
  cleaningReport?: CleaningReport;
  cleanedPreview?: Record<string, unknown>[];
  originalPreview?: Record<string, unknown>[];
  totalRows: number;
  totalRowsAfterCleaning: number;
  totalColumns: number;
  fileName: string;
  recognizedColumns: Array<{ excelHeader: string; mappedTo: string; source: string; confidence: number; sampleValue: string }>;
  unmappedHeaders: string[];
  validCategories?: string[];
}

// Re-export CleaningReport for consumers
export type { CleaningReport } from '../services/import/cleaner';

export interface BatchQualityReport {
  overallScore: number;           // 0-100
  completenessAverage: number;    // 0-1
  validPercentage: number;
  fieldCoverage: Record<string, number>;  // Per field: % of rows with value
  commonErrors: Array<{ errorCode: string; count: number; message: string }>;
  suggestions: string[];
}

export interface ApplyMappingRequest {
  batchId: number;
  mappingConfig: ImportMappingConfig;
  saveAsTemplate?: boolean;
  templateName?: string;
}

export interface ApplyMappingResponse {
  status: ImportBatchStatus;
  mappedCount: number;
}

export interface ValidateImportRequest {
  batchId: number;
  options?: Partial<MappingOptions>;
}

export interface ValidateImportResponse {
  batchId: number;
  status: ImportBatchStatus;
  validCount: number;
  warningCount: number;
  errorCount: number;
  errors: ImportValidationError[];
  previewRows: PreviewRow[];
  duplicateReport?: {
    totalChecked: number;
    probableDuplicates: number;
    possibleDuplicates: number;
    uniqueRows: number;
  };
  qualityReport?: BatchQualityReport;
}

export interface CommitImportRequest {
  batchId: number;
  dryRun?: boolean;  // Preview what would happen
  excludedRowIds?: number[];  // Row IDs to exclude from import
  rowEdits?: Record<number, Record<string, unknown>>;  // Row ID -> field edits
}

// ============ Format Change Detection ============

export interface FormatChangeResult {
  detected: boolean;
  requiresRemapping: boolean;
  previousFingerprint?: string;
  similarity?: number;
  addedColumns?: string[];
  removedColumns?: string[];
  renamedColumns?: Array<{ old: string; new: string; similarity: number }>;
}

// ============ Database Query Options ============

export interface ImportBatchQueryOptions {
  limit?: number;
  offset?: number;
  status?: ImportBatchStatus;
}

export interface StagingRowQueryOptions {
  limit: number;
  offset: number;
  validationStatus?: StagingRowStatus;
}

// ============ Dynamic Industry Field Configuration ============

/**
 * Configuration for industry-specific custom fields
 * Allows organizations to define their own fields per industry
 */
export interface IndustryFieldConfig {
  id: number;
  organization_id: number;
  industry_code: string;        // e.g., 'el_kontroll', 'brannvarsling', 'ventilasjon'
  industry_name: string;        // Display name (Norwegian)
  fields: CustomFieldDefinition[];
  created_at: string;
  updated_at: string;
}

export interface CustomFieldDefinition {
  field_name: string;           // Database field name (snake_case)
  display_name: string;         // Norwegian display name
  field_type: CustomFieldType;
  required: boolean;
  default_value?: unknown;

  // For 'enum' type
  allowed_values?: string[];

  // For 'number' type
  min_value?: number;
  max_value?: number;

  // For validation
  validation_pattern?: string;  // Regex pattern
  validation_message?: string;  // Custom error message

  // For import mapping
  column_aliases?: string[];    // Alternative column names to match
}

export type CustomFieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'date'
  | 'boolean'
  | 'enum'       // Dropdown with predefined values
  | 'text';      // Multi-line text

/**
 * Predefined industry templates with common fields
 */
export const INDUSTRY_TEMPLATES: Record<string, Omit<IndustryFieldConfig, 'id' | 'organization_id' | 'created_at' | 'updated_at'>> = {
  el_kontroll: {
    industry_code: 'el_kontroll',
    industry_name: 'El-Kontroll',
    fields: [
      {
        field_name: 'el_type',
        display_name: 'Anleggstype',
        field_type: 'enum',
        required: true,
        allowed_values: ['Landbruk', 'Næring', 'Bolig', 'Gartneri'],
        default_value: 'Næring',
        column_aliases: ['type', 'anleggstype', 'el type', 'elektrisk type'],
      },
      {
        field_name: 'sikringsskap',
        display_name: 'Sikringsskap',
        field_type: 'string',
        required: false,
        column_aliases: ['skap', 'sikring'],
      },
      {
        field_name: 'maaler_id',
        display_name: 'Måler-ID',
        field_type: 'string',
        required: false,
        column_aliases: ['måler', 'målernummer', 'meter id'],
      },
    ],
  },
  brannvarsling: {
    industry_code: 'brannvarsling',
    industry_name: 'Brannvarsling',
    fields: [
      {
        field_name: 'brann_system',
        display_name: 'Systemtype',
        field_type: 'enum',
        required: true,
        allowed_values: ['Elotec', 'ICAS', 'Elotec + ICAS', '2x Elotec', 'Annet'],
        column_aliases: ['system', 'alarmsystem', 'brann system'],
      },
      {
        field_name: 'antall_detektorer',
        display_name: 'Antall detektorer',
        field_type: 'integer',
        required: false,
        min_value: 0,
        column_aliases: ['detektorer', 'antall'],
      },
      {
        field_name: 'sentral_type',
        display_name: 'Sentraltype',
        field_type: 'string',
        required: false,
        column_aliases: ['sentral', 'brannsentral'],
      },
    ],
  },
  ventilasjon: {
    industry_code: 'ventilasjon',
    industry_name: 'Ventilasjon',
    fields: [
      {
        field_name: 'filter_type',
        display_name: 'Filtertype',
        field_type: 'string',
        required: false,
        column_aliases: ['filter', 'filtertype'],
      },
      {
        field_name: 'kanal_lengde',
        display_name: 'Kanallengde (meter)',
        field_type: 'number',
        required: false,
        min_value: 0,
        column_aliases: ['lengde', 'kanal'],
      },
    ],
  },
  varmepumpe: {
    industry_code: 'varmepumpe',
    industry_name: 'Varmepumpe',
    fields: [
      {
        field_name: 'pumpe_modell',
        display_name: 'Pumpemodell',
        field_type: 'string',
        required: false,
        column_aliases: ['modell', 'pumpe', 'varmepumpe modell'],
      },
      {
        field_name: 'kjolemiddel',
        display_name: 'Kjølemiddel',
        field_type: 'string',
        required: false,
        column_aliases: ['kjølemiddel', 'kuldemedium'],
      },
    ],
  },
};

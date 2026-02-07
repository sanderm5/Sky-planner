/**
 * Import Validation System
 * Validates mapped data before committing to production
 *
 * Implements "Grunnleggende" validation:
 * - Required fields
 * - Email format
 * - Postnummer (4 digits)
 */

import type {
  ValidationRule,
  ValidationErrorCode,
  ValidationSeverity,
  InsertValidationError,
  ImportMappingConfig,
  ColumnMapping,
} from '../../types/import';
import { lookupPostnummer } from './postnummer-registry';

// Regex patterns
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTNUMMER_REGEX = /^\d{4}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidationIssue {
  severity: ValidationSeverity;
  errorCode: ValidationErrorCode;
  fieldName: string;
  sourceColumn?: string;
  message: string;
  expectedFormat?: string;
  actualValue?: string;
  suggestion?: string;
}

export interface RowValidationResult {
  isValid: boolean;
  hasWarnings: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  completenessScore: number;  // 0-1: fraction of important fields that have values
}

/**
 * Validate a single mapped row
 */
export function validateMappedRow(
  mappedData: Record<string, unknown>,
  rowNumber: number,
  mappingConfig?: ImportMappingConfig
): RowValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Apply mapping-specific validation rules if provided
  if (mappingConfig) {
    for (const mapping of mappingConfig.mappings) {
      const value = mappedData[mapping.targetField];
      const issues = validateFieldWithRules(
        mapping.targetField,
        value,
        mapping.validationRules || [],
        mapping.sourceColumn
      );

      for (const issue of issues) {
        if (issue.severity === 'error') {
          errors.push(issue);
        } else {
          warnings.push(issue);
        }
      }
    }
  }

  // Apply default validation rules for known fields
  const defaultIssues = applyDefaultValidation(mappedData);
  for (const issue of defaultIssues) {
    // Avoid duplicate errors
    const isDuplicate = errors.some(
      e => e.fieldName === issue.fieldName && e.errorCode === issue.errorCode
    );
    if (!isDuplicate) {
      if (issue.severity === 'error') {
        errors.push(issue);
      } else {
        warnings.push(issue);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    hasWarnings: warnings.length > 0,
    errors,
    warnings,
    completenessScore: calculateCompleteness(mappedData),
  };
}

/**
 * Apply default validation rules for known fields
 */
function applyDefaultValidation(mappedData: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  validateRequiredTextField(mappedData, 'navn', 'Navn', 2, issues);
  validateRequiredTextField(mappedData, 'adresse', 'Adresse', 3, issues);
  validateEmailField(mappedData, issues);
  validatePostnummerField(mappedData, issues);
  validateDateFields(mappedData, issues);

  return issues;
}

function getStringValue(data: Record<string, unknown>, field: string): string {
  const val = data[field];
  return typeof val === 'string' ? val.trim() : typeof val === 'number' ? String(val) : '';
}

function validateRequiredTextField(
  data: Record<string, unknown>,
  field: string,
  label: string,
  minLength: number,
  issues: ValidationIssue[]
): void {
  const value = getStringValue(data, field);
  if (value.length < minLength) {
    issues.push({
      severity: 'error',
      errorCode: 'REQUIRED_FIELD_MISSING',
      fieldName: field,
      message: `${label} er påkrevd og må være minst ${minLength} tegn`,
      actualValue: value || undefined,
    });
  }
}

function validateEmailField(data: Record<string, unknown>, issues: ValidationIssue[]): void {
  const email = getStringValue(data, 'epost');
  if (!email) return;

  if (!EMAIL_REGEX.test(email)) {
    issues.push({
      severity: 'error',
      errorCode: 'INVALID_EMAIL',
      fieldName: 'epost',
      message: 'Ugyldig e-postformat',
      expectedFormat: 'bruker@domene.no',
      actualValue: email,
    });
    return;
  }

  const domainFix = suggestEmailDomainFix(email);
  if (domainFix) {
    issues.push({
      severity: 'warning',
      errorCode: 'INVALID_EMAIL',
      fieldName: 'epost',
      message: `Mulig skrivefeil i e-postdomene`,
      actualValue: email,
      suggestion: domainFix,
    });
  }
}

function validatePostnummerField(data: Record<string, unknown>, issues: ValidationIssue[]): void {
  const postnummer = getStringValue(data, 'postnummer');
  if (!postnummer) return;

  if (!POSTNUMMER_REGEX.test(postnummer)) {
    issues.push({
      severity: 'error',
      errorCode: 'INVALID_POSTNUMMER',
      fieldName: 'postnummer',
      message: 'Postnummer må være 4 siffer',
      expectedFormat: '0000',
      actualValue: postnummer,
    });
    return;
  }

  const registryEntry = lookupPostnummer(postnummer);
  if (!registryEntry) {
    issues.push({
      severity: 'warning',
      errorCode: 'INVALID_POSTNUMMER',
      fieldName: 'postnummer',
      message: `Postnummer ${postnummer} finnes ikke i det norske postnummerregisteret`,
      actualValue: postnummer,
    });
    return;
  }

  const poststed = getStringValue(data, 'poststed').toUpperCase();
  if (poststed && registryEntry.poststed !== poststed) {
    issues.push({
      severity: 'warning',
      errorCode: 'INVALID_POSTNUMMER',
      fieldName: 'poststed',
      message: `Poststed "${getStringValue(data, 'poststed')}" stemmer ikke med postnummer ${postnummer} (forventet: ${registryEntry.poststed})`,
      actualValue: getStringValue(data, 'poststed'),
      suggestion: registryEntry.poststed,
    });
  }
}

function validateDateFields(data: Record<string, unknown>, issues: ValidationIssue[]): void {
  // Generic kontroll dates
  const sisteStr = getStringValue(data, 'siste_kontroll');
  const nesteStr = getStringValue(data, 'neste_kontroll');

  // Specific kontroll dates (el, brann)
  const sisteElStr = getStringValue(data, 'siste_el_kontroll');
  const nesteElStr = getStringValue(data, 'neste_el_kontroll');
  const sisteFireStr = getStringValue(data, 'siste_brann_kontroll');
  const nesteFireStr = getStringValue(data, 'neste_brann_kontroll');

  // Only warn (not error) if no date fields at all
  const hasAnyDate = sisteStr || nesteStr || sisteElStr || nesteElStr || sisteFireStr || nesteFireStr;
  if (!hasAnyDate) {
    issues.push({
      severity: 'warning',
      errorCode: 'REQUIRED_FIELD_MISSING',
      fieldName: 'siste_kontroll',
      message: 'Ingen kontrolldatoer oppgitt - anbefales å legge til',
    });
  }

  // Validate format of all date fields that are present
  if (sisteStr) validateDateFormat(sisteStr, 'siste_kontroll', 'Siste kontroll', issues);
  if (nesteStr) validateDateFormat(nesteStr, 'neste_kontroll', 'Neste kontroll', issues);
  if (sisteElStr) validateDateFormat(sisteElStr, 'siste_el_kontroll', 'Siste el-kontroll', issues);
  if (nesteElStr) validateDateFormat(nesteElStr, 'neste_el_kontroll', 'Neste el-kontroll', issues);
  if (sisteFireStr) validateDateFormat(sisteFireStr, 'siste_brann_kontroll', 'Siste brannkontroll', issues);
  if (nesteFireStr) validateDateFormat(nesteFireStr, 'neste_brann_kontroll', 'Neste brannkontroll', issues);

  // Validate date ranges for each pair
  if (sisteStr && nesteStr) validateDateRange(sisteStr, nesteStr, issues);
  if (sisteElStr && nesteElStr) validateDateRange(sisteElStr, nesteElStr, issues);
  if (sisteFireStr && nesteFireStr) validateDateRange(sisteFireStr, nesteFireStr, issues);
}

function validateDateFormat(
  value: string,
  field: string,
  label: string,
  issues: ValidationIssue[]
): void {
  if (!DATE_REGEX.test(value)) {
    issues.push({
      severity: 'error',
      errorCode: 'INVALID_DATE',
      fieldName: field,
      message: `Ugyldig datoformat for ${label.toLowerCase()} (forventet YYYY-MM-DD)`,
      expectedFormat: 'YYYY-MM-DD',
      actualValue: value,
    });
  }
}

function validateDateRange(sisteStr: string, nesteStr: string, issues: ValidationIssue[]): void {
  if (!sisteStr || !nesteStr || !DATE_REGEX.test(sisteStr) || !DATE_REGEX.test(nesteStr)) return;

  const sisteDate = new Date(sisteStr);
  const nesteDate = new Date(nesteStr);

  if (nesteDate <= sisteDate) {
    issues.push({
      severity: 'error',
      errorCode: 'INVALID_DATE',
      fieldName: 'neste_kontroll',
      message: 'Neste kontroll må være etter siste utførte kontroll',
      actualValue: nesteStr,
    });
  }

  if (sisteDate.getFullYear() < 2000) {
    issues.push({
      severity: 'warning',
      errorCode: 'INVALID_DATE',
      fieldName: 'siste_kontroll',
      message: 'Dato før år 2000 - vennligst verifiser at dette er korrekt',
      actualValue: sisteStr,
    });
  }

  const tenYearsFromNow = new Date();
  tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
  if (nesteDate > tenYearsFromNow) {
    issues.push({
      severity: 'warning',
      errorCode: 'INVALID_DATE',
      fieldName: 'neste_kontroll',
      message: 'Dato mer enn 10 år frem i tid - vennligst verifiser at dette er korrekt',
      actualValue: nesteStr,
    });
  }
}

/**
 * Validate a field against provided rules
 */
function validateFieldWithRules(
  fieldName: string,
  value: unknown,
  rules: ValidationRule[],
  sourceColumn?: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const rule of rules) {
    const issue = applyValidationRule(fieldName, value, rule, sourceColumn);
    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

/**
 * Apply a single validation rule
 */
function applyValidationRule(
  fieldName: string,
  value: unknown,
  rule: ValidationRule,
  sourceColumn?: string
): ValidationIssue | null {
  const stringValue = value !== null && value !== undefined ? String(value).trim() : '';
  const isEmpty = value === null || value === undefined || stringValue === '';

  switch (rule.type) {
    case 'required':
      if (isEmpty) {
        return {
          severity: rule.severity,
          errorCode: 'REQUIRED_FIELD_MISSING',
          fieldName,
          sourceColumn,
          message: rule.message || `${fieldName} er påkrevd`,
        };
      }
      break;

    case 'minLength':
      if (!isEmpty && stringValue.length < (rule.params?.min as number || 0)) {
        return {
          severity: rule.severity,
          errorCode: 'INVALID_FORMAT',
          fieldName,
          sourceColumn,
          message: rule.message || `${fieldName} må være minst ${rule.params?.min} tegn`,
          actualValue: stringValue,
        };
      }
      break;

    case 'maxLength':
      if (!isEmpty && stringValue.length > (rule.params?.max as number || Infinity)) {
        return {
          severity: rule.severity,
          errorCode: 'INVALID_FORMAT',
          fieldName,
          sourceColumn,
          message: rule.message || `${fieldName} kan ikke være mer enn ${rule.params?.max} tegn`,
          actualValue: stringValue,
        };
      }
      break;

    case 'pattern':
      if (!isEmpty && rule.params?.pattern) {
        const regex = new RegExp(rule.params.pattern as string);
        if (!regex.test(stringValue)) {
          return {
            severity: rule.severity,
            errorCode: 'INVALID_FORMAT',
            fieldName,
            sourceColumn,
            message: rule.message || `${fieldName} har ugyldig format`,
            actualValue: stringValue,
          };
        }
      }
      break;

    case 'email':
      if (!isEmpty && !EMAIL_REGEX.test(stringValue)) {
        return {
          severity: rule.severity,
          errorCode: 'INVALID_EMAIL',
          fieldName,
          sourceColumn,
          message: rule.message || 'Ugyldig e-postformat',
          expectedFormat: 'bruker@domene.no',
          actualValue: stringValue,
        };
      }
      break;

    case 'postnummer':
      if (!isEmpty && !POSTNUMMER_REGEX.test(stringValue)) {
        return {
          severity: rule.severity,
          errorCode: 'INVALID_POSTNUMMER',
          fieldName,
          sourceColumn,
          message: rule.message || 'Postnummer må være 4 siffer',
          expectedFormat: '0000',
          actualValue: stringValue,
        };
      }
      break;

    case 'date':
      if (!isEmpty && !DATE_REGEX.test(stringValue)) {
        return {
          severity: rule.severity,
          errorCode: 'INVALID_DATE',
          fieldName,
          sourceColumn,
          message: rule.message || 'Ugyldig datoformat (forventet YYYY-MM-DD)',
          expectedFormat: 'YYYY-MM-DD',
          actualValue: stringValue,
        };
      }
      break;

    case 'number':
    case 'integer':
      if (!isEmpty) {
        const num = parseFloat(stringValue.replace(',', '.'));
        if (isNaN(num)) {
          return {
            severity: rule.severity,
            errorCode: 'INVALID_NUMBER',
            fieldName,
            sourceColumn,
            message: rule.message || 'Ugyldig tallformat',
            actualValue: stringValue,
          };
        }
        if (rule.type === 'integer' && !Number.isInteger(num)) {
          return {
            severity: rule.severity,
            errorCode: 'INVALID_NUMBER',
            fieldName,
            sourceColumn,
            message: rule.message || 'Må være et heltall',
            actualValue: stringValue,
          };
        }
      }
      break;

    case 'range':
      if (!isEmpty) {
        const num = parseFloat(stringValue.replace(',', '.'));
        if (!isNaN(num)) {
          const min = rule.params?.min as number | undefined;
          const max = rule.params?.max as number | undefined;
          if ((min !== undefined && num < min) || (max !== undefined && num > max)) {
            return {
              severity: rule.severity,
              errorCode: 'VALUE_OUT_OF_RANGE',
              fieldName,
              sourceColumn,
              message: rule.message || `Verdien må være mellom ${min ?? '-∞'} og ${max ?? '∞'}`,
              actualValue: stringValue,
            };
          }
        }
      }
      break;

    case 'enum':
      if (!isEmpty && rule.params?.values) {
        const allowedValues = rule.params.values as unknown[];
        const normalizedValue = stringValue.toLowerCase();
        const isValid = allowedValues.some(
          v => String(v).toLowerCase() === normalizedValue
        );
        if (!isValid) {
          return {
            severity: rule.severity,
            errorCode: 'INVALID_FORMAT',
            fieldName,
            sourceColumn,
            message: rule.message || `Ugyldig verdi. Gyldige verdier: ${allowedValues.join(', ')}`,
            actualValue: stringValue,
          };
        }
      }
      break;
  }

  return null;
}

/**
 * Convert validation issues to database error format
 */
export function convertToDbErrors(
  issues: ValidationIssue[],
  stagingRowId: number,
  batchId: number
): InsertValidationError[] {
  return issues.map(issue => ({
    staging_row_id: stagingRowId,
    batch_id: batchId,
    severity: issue.severity,
    error_code: issue.errorCode,
    field_name: issue.fieldName,
    source_column: issue.sourceColumn,
    message: issue.message,
    expected_format: issue.expectedFormat,
    actual_value: issue.actualValue,
    suggestion: issue.suggestion,
  }));
}

/**
 * Build a default mapping config with standard validation rules
 */
export function buildDefaultMappingConfig(
  mappings: Array<{ sourceColumn: string; targetField: string; confidence: number }>
): ImportMappingConfig {
  const columnMappings: ColumnMapping[] = mappings.map(m => ({
    sourceColumn: m.sourceColumn,
    targetField: m.targetField,
    targetFieldType: inferFieldType(m.targetField),
    required: isRequiredField(m.targetField),
    confidence: m.confidence,
    aiSuggested: true,
    humanConfirmed: false,
    validationRules: getDefaultValidationRules(m.targetField),
  }));

  return {
    version: '1.0',
    mappings: columnMappings,
    options: {
      skipHeaderRows: 1,
      skipEmptyRows: true,
      trimWhitespace: true,
      duplicateDetection: 'name_address',
      duplicateAction: 'update',
      stopOnFirstError: false,
      maxErrors: 100,
      dateFormat: 'DD.MM.YYYY',
      autoCreateCategories: false,
    },
  };
}

/**
 * Infer field type from field name
 */
function inferFieldType(fieldName: string): import('../../types/import').FieldType {
  const typeMap: Record<string, import('../../types/import').FieldType> = {
    navn: 'string',
    adresse: 'string',
    postnummer: 'postnummer',
    poststed: 'string',
    telefon: 'phone',
    epost: 'email',
    kontaktperson: 'string',
    notater: 'string',
    kategori: 'kategori',
    el_type: 'string',
    brann_system: 'string',
    siste_el_kontroll: 'date',
    neste_el_kontroll: 'date',
    siste_brann_kontroll: 'date',
    neste_brann_kontroll: 'date',
    siste_kontroll: 'date',
    neste_kontroll: 'date',
    kontroll_intervall_mnd: 'integer',
    el_kontroll_intervall: 'integer',
    brann_kontroll_intervall: 'integer',
  };

  return typeMap[fieldName] || 'string';
}

/**
 * Check if a field is required
 */
function isRequiredField(fieldName: string): boolean {
  const requiredFields = ['navn', 'adresse'];
  return requiredFields.includes(fieldName);
}

/**
 * Get default validation rules for a field
 */
function getDefaultValidationRules(fieldName: string): ValidationRule[] {
  const rules: ValidationRule[] = [];

  if (isRequiredField(fieldName)) {
    rules.push({
      type: 'required',
      severity: 'error',
    });
  }

  switch (fieldName) {
    case 'navn':
      rules.push({
        type: 'minLength',
        params: { min: 2 },
        severity: 'error',
      });
      break;

    case 'adresse':
      rules.push({
        type: 'minLength',
        params: { min: 3 },
        severity: 'error',
      });
      break;

    case 'epost':
      rules.push({
        type: 'email',
        severity: 'error',
      });
      break;

    case 'postnummer':
      rules.push({
        type: 'postnummer',
        severity: 'error',
      });
      break;
  }

  return rules;
}

// ============ Completeness Scoring ============

/** Fields tracked for completeness, with weights */
const COMPLETENESS_FIELDS: Array<{ field: string; weight: number }> = [
  { field: 'navn', weight: 1 },
  { field: 'adresse', weight: 1 },
  { field: 'postnummer', weight: 0.8 },
  { field: 'poststed', weight: 0.6 },
  { field: 'telefon', weight: 0.7 },
  { field: 'epost', weight: 0.7 },
  { field: 'kontaktperson', weight: 0.5 },
  { field: 'siste_kontroll', weight: 0.9 },
  { field: 'neste_kontroll', weight: 0.9 },
];

function calculateCompleteness(data: Record<string, unknown>): number {
  let filled = 0;
  let total = 0;

  for (const { field, weight } of COMPLETENESS_FIELDS) {
    total += weight;
    const val = data[field];
    const hasValue = val !== null && val !== undefined
      && (typeof val === 'string' ? val.trim() !== '' : true);
    if (hasValue) {
      filled += weight;
    }
  }

  return total > 0 ? filled / total : 0;
}

// ============ Email Domain Typo Detection ============

const COMMON_EMAIL_DOMAINS = [
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'live.com',
  'icloud.com', 'me.com', 'msn.com', 'aol.com', 'protonmail.com',
  'online.no', 'broadpark.no', 'getmail.no', 'frisurf.no',
];

export function suggestEmailDomainFix(email: string): string | undefined {
  const atIndex = email.indexOf('@');
  if (atIndex < 0) return undefined;
  const domain = email.slice(atIndex + 1).toLowerCase();

  // Common typos
  const typoMap: Record<string, string> = {
    'gmai.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gnail.com': 'gmail.com',
    'gmail.no': 'gmail.com',
    'hotmal.com': 'hotmail.com',
    'hotmial.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com',
    'outlok.com': 'outlook.com',
    'outllok.com': 'outlook.com',
    'outlool.com': 'outlook.com',
    'yahooo.com': 'yahoo.com',
    'yaho.com': 'yahoo.com',
  };

  if (typoMap[domain]) {
    return email.slice(0, atIndex + 1) + typoMap[domain];
  }

  // Fuzzy check against common domains (edit distance 1)
  for (const known of COMMON_EMAIL_DOMAINS) {
    if (domain === known) return undefined; // Already correct
    if (editDistance1(domain, known)) {
      return email.slice(0, atIndex + 1) + known;
    }
  }

  return undefined;
}

/** Check if two strings differ by exactly 1 edit (substitution, insertion, or deletion) */
function editDistance1(a: string, b: string): boolean {
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff > 1) return false;
  return lenDiff === 0 ? hasOneSubstitution(a, b) : hasOneInsertion(a, b);
}

function hasOneSubstitution(a: string, b: string): boolean {
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diffs++;
    if (diffs > 1) return false;
  }
  return diffs === 1;
}

function hasOneInsertion(a: string, b: string): boolean {
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let si = 0, li = 0, diffs = 0;
  while (si < shorter.length && li < longer.length) {
    if (shorter[si] === longer[li]) {
      si++;
      li++;
    } else {
      diffs++;
      if (diffs > 1) return false;
      li++;
    }
  }
  return true;
}

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
  };
}

/**
 * Apply default validation rules for known fields
 */
function applyDefaultValidation(mappedData: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Navn (name) is required and must be at least 2 characters
  if (!mappedData.navn || String(mappedData.navn).trim().length < 2) {
    issues.push({
      severity: 'error',
      errorCode: 'REQUIRED_FIELD_MISSING',
      fieldName: 'navn',
      message: 'Navn er påkrevd og må være minst 2 tegn',
      actualValue: mappedData.navn ? String(mappedData.navn) : undefined,
    });
  }

  // Adresse (address) is required and must be at least 3 characters
  if (!mappedData.adresse || String(mappedData.adresse).trim().length < 3) {
    issues.push({
      severity: 'error',
      errorCode: 'REQUIRED_FIELD_MISSING',
      fieldName: 'adresse',
      message: 'Adresse er påkrevd og må være minst 3 tegn',
      actualValue: mappedData.adresse ? String(mappedData.adresse) : undefined,
    });
  }

  // Email format validation
  if (mappedData.epost) {
    const email = String(mappedData.epost).trim();
    if (email && !EMAIL_REGEX.test(email)) {
      issues.push({
        severity: 'error',
        errorCode: 'INVALID_EMAIL',
        fieldName: 'epost',
        message: 'Ugyldig e-postformat',
        expectedFormat: 'bruker@domene.no',
        actualValue: email,
      });
    }
  }

  // Postnummer (4 digits)
  if (mappedData.postnummer) {
    const postnummer = String(mappedData.postnummer).trim();
    if (postnummer && !POSTNUMMER_REGEX.test(postnummer)) {
      issues.push({
        severity: 'error',
        errorCode: 'INVALID_POSTNUMMER',
        fieldName: 'postnummer',
        message: 'Postnummer må være 4 siffer',
        expectedFormat: '0000',
        actualValue: postnummer,
      });
    }
  }

  // ============ KONTROLLDATOER (påkrevd) ============

  // Siste kontroll (dato for utført) er påkrevd
  const sisteKontroll = mappedData.siste_kontroll;
  if (!sisteKontroll || String(sisteKontroll).trim() === '') {
    issues.push({
      severity: 'error',
      errorCode: 'REQUIRED_FIELD_MISSING',
      fieldName: 'siste_kontroll',
      message: 'Dato for utført kontroll er påkrevd',
    });
  } else {
    const sisteStr = String(sisteKontroll).trim();
    if (!DATE_REGEX.test(sisteStr)) {
      issues.push({
        severity: 'error',
        errorCode: 'INVALID_DATE',
        fieldName: 'siste_kontroll',
        message: 'Ugyldig datoformat for utført kontroll (forventet YYYY-MM-DD)',
        expectedFormat: 'YYYY-MM-DD',
        actualValue: sisteStr,
      });
    }
  }

  // Neste kontroll (dato for neste utførelse) er påkrevd
  const nesteKontroll = mappedData.neste_kontroll;
  if (!nesteKontroll || String(nesteKontroll).trim() === '') {
    issues.push({
      severity: 'error',
      errorCode: 'REQUIRED_FIELD_MISSING',
      fieldName: 'neste_kontroll',
      message: 'Dato for neste kontroll er påkrevd',
    });
  } else {
    const nesteStr = String(nesteKontroll).trim();
    if (!DATE_REGEX.test(nesteStr)) {
      issues.push({
        severity: 'error',
        errorCode: 'INVALID_DATE',
        fieldName: 'neste_kontroll',
        message: 'Ugyldig datoformat for neste kontroll (forventet YYYY-MM-DD)',
        expectedFormat: 'YYYY-MM-DD',
        actualValue: nesteStr,
      });
    }
  }

  // Valider at neste kontroll er etter siste kontroll (STRENG: error, ikke warning)
  if (sisteKontroll && nesteKontroll) {
    const sisteStr = String(sisteKontroll).trim();
    const nesteStr = String(nesteKontroll).trim();
    if (DATE_REGEX.test(sisteStr) && DATE_REGEX.test(nesteStr)) {
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

      // Advarsel for datoer før år 2000 (sannsynlig feil)
      if (sisteDate.getFullYear() < 2000) {
        issues.push({
          severity: 'warning',
          errorCode: 'INVALID_DATE',
          fieldName: 'siste_kontroll',
          message: 'Dato før år 2000 - vennligst verifiser at dette er korrekt',
          actualValue: sisteStr,
        });
      }

      // Advarsel for datoer mer enn 10 år frem i tid
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
  }

  return issues;
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

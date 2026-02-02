/**
 * Data Transformers
 * Transform raw Excel values to database-compatible formats
 */

import type {
  ImportMappingConfig,
  ColumnMapping,
  TransformationRule,
  TransformationType,
} from '../../types/import';

// Norwegian month names (lowercase)
const NORWEGIAN_MONTHS: Record<string, number> = {
  januar: 1, jan: 1,
  februar: 2, feb: 2,
  mars: 3, mar: 3,
  april: 4, apr: 4,
  mai: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  desember: 12, des: 12,
  // English variants for compatibility
  january: 1, february: 2, march: 3, may: 5, june: 6, july: 7,
  october: 10, december: 12,
};

/**
 * Apply all transformations from mapping config to raw row data
 */
export function applyTransformations(
  rawData: Record<string, unknown>,
  mappingConfig: ImportMappingConfig
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const mapping of mappingConfig.mappings) {
    const rawValue = rawData[mapping.sourceColumn];
    let transformedValue = rawValue;

    // Apply transformation if defined
    if (mapping.transformation) {
      transformedValue = applyTransformation(rawValue, mapping.transformation);
    } else {
      // Apply default transformations based on target field type
      transformedValue = applyDefaultTransformation(rawValue, mapping);
    }

    // Handle empty values and defaults
    if (isEmptyValue(transformedValue)) {
      if (mapping.useDefaultIfEmpty && mapping.defaultValue !== undefined) {
        transformedValue = mapping.defaultValue;
      } else {
        transformedValue = null;
      }
    }

    result[mapping.targetField] = transformedValue;
  }

  return result;
}

/**
 * Apply a single transformation rule to a value
 */
export function applyTransformation(
  value: unknown,
  rule: TransformationRule
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  const transformers: Record<TransformationType | 'parseMonthText', (v: unknown, params?: Record<string, unknown>) => unknown> = {
    none: (v) => v,
    trim: (v) => typeof v === 'string' ? v.trim() : v,
    uppercase: (v) => typeof v === 'string' ? v.toUpperCase() : v,
    lowercase: (v) => typeof v === 'string' ? v.toLowerCase() : v,
    capitalize: (v) => typeof v === 'string' ? capitalize(v) : v,
    parseNumber: (v) => parseNumber(v),
    parseInteger: (v) => parseInteger(v),
    parseDate: (v, params) => parseDate(v, params?.format as string),
    parseBoolean: (v) => parseBoolean(v),
    formatPhone: (v) => formatPhone(v),
    formatPostnummer: (v) => formatPostnummer(v),
    parseNorwegianDate: (v, params) => parseNorwegianDate(v, params?.format as string),
    parseExcelDate: (v) => parseExcelDate(v),
    parseMonthText: (v) => parseMonthText(v),
    splitFirst: (v, params) => splitFirst(v, params?.delimiter as string),
    splitLast: (v, params) => splitLast(v, params?.delimiter as string),
    regex: (v, params) => regexExtract(v, params?.pattern as string, params?.group as number),
    lookup: (v, params) => lookupValue(v, params?.table as Record<string, unknown>, params?.default as unknown),
  };

  const transformer = transformers[rule.type];
  if (!transformer) {
    return value;
  }

  try {
    return transformer(value, rule.params);
  } catch {
    return value; // Return original on error
  }
}

/**
 * Apply default transformation based on target field type
 */
function applyDefaultTransformation(
  value: unknown,
  mapping: ColumnMapping
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  // Always trim strings
  let result = typeof value === 'string' ? value.trim() : value;

  switch (mapping.targetFieldType) {
    case 'string':
      return String(result);

    case 'email':
      return typeof result === 'string' ? result.toLowerCase().trim() : result;

    case 'phone':
      return formatPhone(result);

    case 'postnummer':
      return formatPostnummer(result);

    case 'date':
    case 'datetime':
      return parseDate(result);

    case 'number':
      return parseNumber(result);

    case 'integer':
      return parseInteger(result);

    case 'boolean':
      return parseBoolean(result);

    default:
      return result;
  }
}

/**
 * Check if a value is considered empty
 */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

/**
 * Capitalize first letter of each word
 */
function capitalize(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Parse a value to number
 */
function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();
  if (str === '') return null;

  // Handle Norwegian number format (comma as decimal separator)
  const normalized = str.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(normalized);

  return isNaN(num) ? null : num;
}

/**
 * Parse a value to integer
 */
function parseInteger(value: unknown): number | null {
  const num = parseNumber(value);
  return num !== null ? Math.round(num) : null;
}

/**
 * Parse a value to boolean
 */
function parseBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;

  const str = String(value).toLowerCase().trim();

  const trueValues = ['ja', 'yes', 'true', '1', 'x', 'sant'];
  const falseValues = ['nei', 'no', 'false', '0', '', 'usant'];

  if (trueValues.includes(str)) return true;
  if (falseValues.includes(str)) return false;

  return null;
}

/**
 * Parse a date from various formats
 */
function parseDate(value: unknown, format?: string): string | null {
  if (value === null || value === undefined) return null;

  // If already a Date object
  if (value instanceof Date) {
    return formatDateOutput(value);
  }

  const str = String(value).trim();
  if (str === '') return null;

  // Try Norwegian date first (DD.MM.YYYY)
  const norwegian = parseNorwegianDate(str, format);
  if (norwegian) return norwegian;

  // Try month text format (e.g., "mars 2024", "Mar 2024", "15 mars 2024")
  const monthText = parseMonthText(str);
  if (monthText) return monthText;

  // Try ISO format
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return formatDateOutput(date);
    }
  }

  // Try Excel serial number
  const excelDate = parseExcelDate(value);
  if (excelDate) return excelDate;

  return null;
}

/**
 * Parse Norwegian date format (DD.MM.YYYY or DD/MM/YYYY)
 */
function parseNorwegianDate(value: unknown, format?: string): string | null {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();

  // DD.MM.YYYY or DD/MM/YYYY
  const match = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);

    // Handle 2-digit years
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }

    // Validate basic ranges
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) {
        // Verify the date didn't roll over (e.g., Feb 31 -> Mar 3)
        if (date.getDate() === day && date.getMonth() === month - 1 && date.getFullYear() === year) {
          return formatDateOutput(date);
        }
      }
    }
  }

  // Try month.year format (MM.YYYY)
  const monthYearMatch = str.match(/^(\d{1,2})[./-](\d{4})$/);
  if (monthYearMatch) {
    const month = parseInt(monthYearMatch[1], 10);
    const year = parseInt(monthYearMatch[2], 10);

    if (month >= 1 && month <= 12) {
      const date = new Date(year, month - 1, 1);
      if (!isNaN(date.getTime())) {
        return formatDateOutput(date);
      }
    }
  }

  return null;
}

/**
 * Parse Excel serial date number
 *
 * Excel has a bug where it considers 1900 a leap year (serial 60 = Feb 29, 1900).
 * This phantom date doesn't exist, so:
 * - Serial 1-59 (Jan 1 - Feb 28, 1900): correct as-is
 * - Serial 60 (Feb 29, 1900): invalid date, return null
 * - Serial > 60: subtract 1 to correct for the phantom leap day
 */
function parseExcelDate(value: unknown): string | null {
  const num = parseNumber(value);
  if (num === null || num < 1 || num > 100000) return null;

  // Excel serial 60 is the phantom Feb 29, 1900 - treat as invalid
  if (num === 60) {
    return null;
  }

  // Adjust for Excel's phantom Feb 29, 1900
  const adjustedNum = num > 60 ? num - 1 : num;

  // Excel dates start from 1900-01-01 (serial = 1)
  // Use Dec 31, 1899 as base since serial 1 = Jan 1, 1900
  const excelEpoch = new Date(1899, 11, 31); // Dec 31, 1899
  const date = new Date(excelEpoch.getTime() + adjustedNum * 24 * 60 * 60 * 1000);

  if (!isNaN(date.getTime()) && date.getFullYear() >= 1900 && date.getFullYear() <= 2100) {
    return formatDateOutput(date);
  }

  return null;
}

/**
 * Parse month text format (Norwegian/English)
 * Examples: "mars 2024", "Mar 2024", "15 mars 2024", "15. mars 2024"
 */
function parseMonthText(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const str = String(value).trim().toLowerCase();
  if (str === '') return null;

  // Pattern 1: "15 mars 2024" or "15. mars 2024" (day month year)
  const dayMonthYearMatch = str.match(/^(\d{1,2})\.?\s+([a-zæøå]+)\.?\s+(\d{4})$/);
  if (dayMonthYearMatch) {
    const day = parseInt(dayMonthYearMatch[1], 10);
    const monthName = dayMonthYearMatch[2];
    const year = parseInt(dayMonthYearMatch[3], 10);
    const month = NORWEGIAN_MONTHS[monthName];

    if (month && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) {
        return formatDateOutput(date);
      }
    }
  }

  // Pattern 2: "mars 2024" or "mar 2024" (month year only - defaults to 1st)
  const monthYearMatch = str.match(/^([a-zæøå]+)\.?\s+(\d{4})$/);
  if (monthYearMatch) {
    const monthName = monthYearMatch[1];
    const year = parseInt(monthYearMatch[2], 10);
    const month = NORWEGIAN_MONTHS[monthName];

    if (month) {
      const date = new Date(year, month - 1, 1);
      if (!isNaN(date.getTime())) {
        return formatDateOutput(date);
      }
    }
  }

  // Pattern 3: "2024 mars" (year month - less common but support it)
  const yearMonthMatch = str.match(/^(\d{4})\s+([a-zæøå]+)\.?$/);
  if (yearMonthMatch) {
    const year = parseInt(yearMonthMatch[1], 10);
    const monthName = yearMonthMatch[2];
    const month = NORWEGIAN_MONTHS[monthName];

    if (month) {
      const date = new Date(year, month - 1, 1);
      if (!isNaN(date.getTime())) {
        return formatDateOutput(date);
      }
    }
  }

  // Pattern 4: "09.sep" or "sep.09" (month.shortmonth format from Excel)
  const shortMonthMatch = str.match(/^(\d{1,2})\.?([a-zæøå]+)$/);
  if (shortMonthMatch) {
    const dayOrMonth = parseInt(shortMonthMatch[1], 10);
    const monthName = shortMonthMatch[2];
    const month = NORWEGIAN_MONTHS[monthName];

    if (month && dayOrMonth >= 1 && dayOrMonth <= 31) {
      // Assume current year, day.month format
      const year = new Date().getFullYear();
      const date = new Date(year, month - 1, dayOrMonth);
      if (!isNaN(date.getTime())) {
        return formatDateOutput(date);
      }
    }
  }

  return null;
}

/**
 * Format a Date object to YYYY-MM-DD
 */
function formatDateOutput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format phone number (Norwegian standard)
 */
function formatPhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();
  if (str === '') return null;

  // Remove all non-digits except +
  const digits = str.replace(/[^\d+]/g, '');

  // Remove leading + and country code if present
  let normalized = digits;
  if (normalized.startsWith('+47')) {
    normalized = normalized.slice(3);
  } else if (normalized.startsWith('0047')) {
    normalized = normalized.slice(4);
  } else if (normalized.startsWith('47') && normalized.length > 10) {
    normalized = normalized.slice(2);
  }

  // Must be at least 8 digits for Norwegian number
  if (normalized.length < 8) {
    return str; // Return original if not valid
  }

  // Format as XX XX XX XX
  if (normalized.length === 8) {
    return `${normalized.slice(0, 2)} ${normalized.slice(2, 4)} ${normalized.slice(4, 6)} ${normalized.slice(6, 8)}`;
  }

  return normalized;
}

/**
 * Format postal code (Norwegian 4-digit)
 */
function formatPostnummer(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();
  if (str === '') return null;

  // Extract digits
  const digits = str.replace(/\D/g, '');

  // Must be 4 digits
  if (digits.length === 4) {
    return digits;
  }

  // If 3 digits, pad with leading zero
  if (digits.length === 3) {
    return '0' + digits;
  }

  return str; // Return original if not valid
}

/**
 * Split string and take first part
 */
function splitFirst(value: unknown, delimiter = ','): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  const parts = str.split(delimiter);
  return parts[0]?.trim() || null;
}

/**
 * Split string and take last part
 */
function splitLast(value: unknown, delimiter = ','): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  const parts = str.split(delimiter);
  return parts[parts.length - 1]?.trim() || null;
}

/**
 * Extract value using regex
 */
function regexExtract(value: unknown, pattern: string, group = 0): string | null {
  if (value === null || value === undefined || !pattern) return null;

  try {
    const regex = new RegExp(pattern);
    const match = String(value).match(regex);
    if (match) {
      return match[group] || match[0] || null;
    }
  } catch {
    // Invalid regex
  }

  return null;
}

/**
 * Lookup value in a table
 */
function lookupValue(
  value: unknown,
  table: Record<string, unknown>,
  defaultValue?: unknown
): unknown {
  if (value === null || value === undefined || !table) {
    return defaultValue ?? null;
  }

  const key = String(value).trim();

  // Try exact match
  if (key in table) {
    return table[key];
  }

  // Try case-insensitive match
  const lowerKey = key.toLowerCase();
  for (const [k, v] of Object.entries(table)) {
    if (k.toLowerCase() === lowerKey) {
      return v;
    }
  }

  return defaultValue ?? value;
}

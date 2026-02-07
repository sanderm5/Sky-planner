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
import { lookupPostnummer, lookupPoststed } from './postnummer-registry';

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
    let transformedValue: unknown;

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

  // Auto-enrich postal/address data using registry
  enrichPostalData(result);

  return result;
}

/**
 * Auto-enrich postal code, city, and address data using the Norwegian postal registry
 */
function enrichPostalData(result: Record<string, unknown>): void {
  const postnummer = typeof result.postnummer === 'string' ? result.postnummer : null;
  const poststed = typeof result.poststed === 'string' ? result.poststed : null;
  const adresse = typeof result.adresse === 'string' ? result.adresse : null;

  enrichPoststedFromPostnummer(result, postnummer, poststed);
  enrichPostnummerFromPoststed(result, postnummer, poststed);
  enrichFromCombinedAddress(result, postnummer, poststed, adresse);
}

function enrichPoststedFromPostnummer(
  result: Record<string, unknown>, postnummer: string | null, poststed: string | null
): void {
  if (postnummer && !poststed) {
    const entry = lookupPostnummer(postnummer);
    if (entry) result.poststed = entry.poststed;
  }
}

function enrichPostnummerFromPoststed(
  result: Record<string, unknown>, postnummer: string | null, poststed: string | null
): void {
  if (poststed && !postnummer) {
    const entries = lookupPoststed(poststed);
    const gateEntries = entries.filter(e => e.kategori === 'G');
    if (gateEntries.length === 1) {
      result.postnummer = gateEntries[0].postnummer;
    }
  }
}

function enrichFromCombinedAddress(
  result: Record<string, unknown>,
  postnummer: string | null, poststed: string | null, adresse: string | null
): void {
  if (!adresse || postnummer || poststed) return;

  const split = splitNorwegianAddress(adresse);
  if (!split.postnummer) return;

  result.adresse = split.adresse;
  result.postnummer = split.postnummer;
  if (split.poststed) {
    result.poststed = split.poststed;
  } else {
    const entry = lookupPostnummer(split.postnummer);
    if (entry) result.poststed = entry.poststed;
  }
}

/**
 * Split a combined Norwegian address into components
 * Handles formats like "Storgata 5, 0184 Oslo" or "Storgata 5 0184 Oslo"
 */
export function splitNorwegianAddress(combined: string): {
  adresse: string;
  postnummer?: string;
  poststed?: string;
} {
  if (!combined) return { adresse: combined };

  // Pattern: "Street 123, 0184 Oslo" or "Street 123 0184 Oslo"
  const fullPattern = /^(.+?),?\s+(\d{4})\s+(.+)$/;
  const fullMatch = fullPattern.exec(combined);
  if (fullMatch) {
    return {
      adresse: fullMatch[1].trim(),
      postnummer: fullMatch[2],
      poststed: fullMatch[3].trim(),
    };
  }

  // Pattern: trailing postal code only "Street 123, 0184"
  const partialPattern = /^(.+?),?\s+(\d{4})$/;
  const partialMatch = partialPattern.exec(combined);
  if (partialMatch) {
    return {
      adresse: partialMatch[1].trim(),
      postnummer: partialMatch[2],
    };
  }

  return { adresse: combined };
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
    lookup: (v, params) => lookupValue(v, params?.table as Record<string, unknown>, params?.default),
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
      if (typeof result === 'string') return result;
      if (typeof result === 'number' || typeof result === 'boolean') return String(result);
      return '';

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
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'boolean') return null;

  const str = typeof value === 'string' ? value.trim() : String(value);
  if (str === '') return null;

  // Handle Norwegian number format (comma as decimal separator)
  const normalized = str.replaceAll(/\s/g, '').replaceAll(',', '.');
  const num = Number.parseFloat(normalized);

  return Number.isNaN(num) ? null : num;
}

/**
 * Parse a value to integer
 */
function parseInteger(value: unknown): number | null {
  const num = parseNumber(value);
  if (num === null) return null;
  return Math.round(num);
}

/**
 * Parse a value to boolean
 */
function parseBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;

  const str = (typeof value === 'string' ? value : String(value as string | number))
    .toLowerCase().trim();

  const trueValues = ['ja', 'yes', 'true', '1', 'x', 'sant'];
  const falseValues = ['nei', 'no', 'false', '0', '', 'usant'];

  if (trueValues.includes(str)) return true;
  if (falseValues.includes(str)) return false;

  return null;
}

/**
 * Parse a date from various formats.
 * Tries multiple parsers in priority order, with optional format hint.
 */
function parseDate(value: unknown, format?: string): string | null {
  if (value === null || value === undefined) return null;

  // If already a Date object
  if (value instanceof Date) {
    return formatDateOutput(value);
  }

  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const str = String(value).trim();
  if (str === '') return null;

  return parseDateString(str, format) ?? parseExcelDate(value);
}

/** Try all string-based date parsers in priority order */
function parseDateString(str: string, format?: string): string | null {
  // Try quarter format first ("Q2 2023", "2. kvartal 2023")
  const quarter = parseQuarterDate(str);
  if (quarter) return quarter;

  // If format hint suggests US date order, try that first
  if (format === 'MM/DD/YYYY') {
    const us = parseUSDate(str);
    if (us) return us;
  }

  // Try Norwegian date (DD.MM.YYYY)
  const norwegian = parseNorwegianDate(str, format);
  if (norwegian) return norwegian;

  // Try month text format (e.g., "mars 2024")
  const monthText = parseMonthText(str);
  if (monthText) return monthText;

  // Try ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const date = new Date(str);
    if (!Number.isNaN(date.getTime())) return formatDateOutput(date);
  }

  // Try US date as fallback
  return parseUSDate(str);
}

/**
 * Parse quarter date format
 * Examples: "Q2 2023", "Q1/2024", "2. kvartal 2023", "kvartal 3 2024"
 */
function parseQuarterDate(str: string): string | null {
  // "Q2 2023" or "Q2/2023"
  const qMatch = /^Q([1-4])\s*[/\s]\s*(\d{4})$/i.exec(str);
  if (qMatch) {
    const quarter = Number.parseInt(qMatch[1], 10);
    const year = Number.parseInt(qMatch[2], 10);
    const month = (quarter - 1) * 3; // Q1=Jan, Q2=Apr, Q3=Jul, Q4=Oct
    return formatDateOutput(new Date(year, month, 1));
  }

  // "2. kvartal 2023" or "kvartal 3 2024"
  const kvMatch = /^(?:(\d)\.\s*)?kvartal\s*(\d)?\s+(\d{4})$/i.exec(str);
  if (kvMatch) {
    const quarter = Number.parseInt(kvMatch[1] || kvMatch[2] || '0', 10);
    const year = Number.parseInt(kvMatch[3], 10);
    if (quarter >= 1 && quarter <= 4) {
      const month = (quarter - 1) * 3;
      return formatDateOutput(new Date(year, month, 1));
    }
  }

  return null;
}

/**
 * Parse US date format (MM/DD/YYYY)
 * Only matches when first number > 12 (unambiguous) or when format hint is given
 */
function parseUSDate(str: string): string | null {
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(str);
  if (!match) return null;

  const first = Number.parseInt(match[1], 10);
  const second = Number.parseInt(match[2], 10);
  let year = Number.parseInt(match[3], 10);

  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }

  // If first number > 12, it can't be a month - must be DD/MM/YYYY (handled by Norwegian parser)
  // If second number > 12, it can't be a day in US format but could be valid as MM/DD
  // Only parse as US if second > 12 (unambiguous: first must be month)
  if (second > 12 && first >= 1 && first <= 12) {
    const date = new Date(year, first - 1, second);
    if (!Number.isNaN(date.getTime()) && date.getDate() === second && date.getMonth() === first - 1) {
      return formatDateOutput(date);
    }
  }

  return null;
}

/**
 * Detect the dominant date format in a column of values.
 * Returns a format hint to disambiguate DD/MM vs MM/DD.
 */
export function detectColumnDateFormat(
  values: unknown[]
): 'DD.MM.YYYY' | 'MM/DD/YYYY' | 'ISO' | 'mixed' | 'unknown' {
  let ddmmCount = 0;
  let mmddCount = 0;
  let isoCount = 0;

  for (const val of values) {
    if (typeof val !== 'string' && typeof val !== 'number') continue;
    const str = String(val).trim();
    if (str === '') continue;

    // ISO is unambiguous
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) { isoCount++; continue; }

    const result = classifyDateParts(str);
    ddmmCount += result.ddmm;
    mmddCount += result.mmdd;
  }

  return pickDominantFormat(isoCount, ddmmCount, mmddCount);
}

function classifyDateParts(str: string): { ddmm: number; mmdd: number } {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(str);
  if (!match) return { ddmm: 0, mmdd: 0 };

  const first = Number.parseInt(match[1], 10);
  const second = Number.parseInt(match[2], 10);

  // Unambiguous: first > 12 must be day
  if (first > 12 && second <= 12) return { ddmm: 1, mmdd: 0 };
  // Unambiguous: second > 12 must be day (US format)
  if (second > 12 && first <= 12) return { ddmm: 0, mmdd: 1 };
  // Ambiguous: dots strongly suggest European
  if (match[0].includes('.')) return { ddmm: 1, mmdd: 0 };
  // Ambiguous: slash is truly ambiguous
  if (match[0].includes('/')) return { ddmm: 0.5, mmdd: 0.5 };
  return { ddmm: 0.5, mmdd: 0.5 };
}

function pickDominantFormat(
  isoCount: number, ddmmCount: number, mmddCount: number
): 'DD.MM.YYYY' | 'MM/DD/YYYY' | 'ISO' | 'mixed' | 'unknown' {
  if (isoCount > ddmmCount && isoCount > mmddCount) return 'ISO';
  if (ddmmCount > 0 && mmddCount === 0) return 'DD.MM.YYYY';
  if (mmddCount > 0 && ddmmCount === 0) return 'MM/DD/YYYY';
  if (ddmmCount > 0 || mmddCount > 0) return 'mixed';
  return 'unknown';
}

/**
 * Parse Norwegian date format (DD.MM.YYYY or DD/MM/YYYY)
 */
function parseNorwegianDate(value: unknown, _format?: string): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const str = String(value).trim();

  return parseNorwegianDayMonthYear(str) ?? parseMonthYearOnly(str);
}

function parseNorwegianDayMonthYear(str: string): string | null {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(str);
  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  let year = Number.parseInt(match[3], 10);

  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;

  // Verify no date rollover (e.g., Feb 31 -> Mar 3)
  if (date.getDate() === day && date.getMonth() === month - 1 && date.getFullYear() === year) {
    return formatDateOutput(date);
  }
  return null;
}

function parseMonthYearOnly(str: string): string | null {
  const match = /^(\d{1,2})[./-](\d{4})$/.exec(str);
  if (!match) return null;

  const month = Number.parseInt(match[1], 10);
  const year = Number.parseInt(match[2], 10);

  if (month < 1 || month > 12) return null;

  const date = new Date(year, month - 1, 1);
  if (Number.isNaN(date.getTime())) return null;

  return formatDateOutput(date);
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

  if (!Number.isNaN(date.getTime()) && date.getFullYear() >= 1900 && date.getFullYear() <= 2100) {
    return formatDateOutput(date);
  }

  return null;
}

/**
 * Parse month text format (Norwegian/English)
 * Examples: "mars 2024", "Mar 2024", "15 mars 2024", "15. mars 2024"
 */
function parseMonthText(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const str = value.trim().toLowerCase();
  if (str === '') return null;

  return parseDayMonthYear(str)
    ?? parseMonthYear(str)
    ?? parseYearMonth(str)
    ?? parseShortMonthDay(str);
}

/** "15 mars 2024" or "15. mars 2024" */
function parseDayMonthYear(str: string): string | null {
  const m = /^(\d{1,2})\.?\s+([a-zæøå]+)\.?\s+(\d{4})$/.exec(str);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = NORWEGIAN_MONTHS[m[2]];
  const year = Number.parseInt(m[3], 10);
  if (!month || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : formatDateOutput(date);
}

/** "mars 2024" or "mar 2024" */
function parseMonthYear(str: string): string | null {
  const m = /^([a-zæøå]+)\.?\s+(\d{4})$/.exec(str);
  if (!m) return null;
  const month = NORWEGIAN_MONTHS[m[1]];
  const year = Number.parseInt(m[2], 10);
  if (!month) return null;
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime()) ? null : formatDateOutput(date);
}

/** "2024 mars" */
function parseYearMonth(str: string): string | null {
  const m = /^(\d{4})\s+([a-zæøå]+)\.?$/.exec(str);
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const month = NORWEGIAN_MONTHS[m[2]];
  if (!month) return null;
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime()) ? null : formatDateOutput(date);
}

/** "09.sep" or "09sep" */
function parseShortMonthDay(str: string): string | null {
  const m = /^(\d{1,2})\.?([a-zæøå]+)$/.exec(str);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = NORWEGIAN_MONTHS[m[2]];
  if (!month || day < 1 || day > 31) return null;
  const year = new Date().getFullYear();
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : formatDateOutput(date);
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
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const str = String(value).trim();
  if (str === '') return null;

  // Remove all non-digits except +
  const digits = str.replaceAll(/[^\d+]/g, '');

  // Remove leading + and country code if present
  let normalized = digits;
  if (normalized.startsWith('+47')) {
    normalized = normalized.slice(3);
  } else if (normalized.startsWith('0047')) {
    normalized = normalized.slice(4);
  } else if (normalized.startsWith('47') && normalized.length === 10) {
    // 47 + 8 digits = country code format without +
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
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const str = String(value).trim();
  if (str === '') return null;

  // Extract digits
  const digits = str.replaceAll(/\D/g, '');

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
  if (typeof value !== 'string') return null;
  const parts = value.split(delimiter);
  return parts[0]?.trim() || null;
}

/**
 * Split string and take last part
 */
function splitLast(value: unknown, delimiter = ','): string | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(delimiter);
  return parts.at(-1)?.trim() || null;
}

/**
 * Extract value using regex
 */
function regexExtract(value: unknown, pattern: string, group = 0): string | null {
  if (typeof value !== 'string' || !pattern) return null;

  try {
    const regex = new RegExp(pattern);
    const match = regex.exec(value);
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

  const key = typeof value === 'string' ? value.trim() : String(value as string | number).trim();

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

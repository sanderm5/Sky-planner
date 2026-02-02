/**
 * Excel Parser Service
 * Parses Excel files and extracts raw data for import
 */

import * as xlsx from 'xlsx';
import { createHash } from 'crypto';
import type { ColumnInfo } from '../../types/import';

export interface ParsedExcelData {
  headers: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  columnCount: number;
  fileHash: string;
  columnFingerprint: string;
  columnInfo: ColumnInfo[];
}

export interface ParseOptions {
  maxPreviewRows?: number;
  skipEmptyRows?: boolean;
}

const DEFAULT_OPTIONS: ParseOptions = {
  maxPreviewRows: 10,
  skipEmptyRows: true,
};

/**
 * Parse an Excel file buffer and extract data
 */
export function parseExcelBuffer(
  fileBuffer: Buffer,
  options: ParseOptions = {}
): ParsedExcelData {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Calculate file hash for duplicate detection
  const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

  // Parse workbook
  const workbook = xlsx.read(fileBuffer, {
    type: 'buffer',
    cellDates: true,
    cellNF: false,
    cellText: false,
  });

  // Get first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel-filen inneholder ingen ark');
  }

  const sheet = workbook.Sheets[sheetName];

  // Get raw data as array of arrays
  const rawData: unknown[][] = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'YYYY-MM-DD',
  });

  if (rawData.length < 1) {
    throw new Error('Excel-filen er tom');
  }

  // Extract and clean headers
  const headers = extractHeaders(rawData[0]);

  if (headers.length === 0) {
    throw new Error('Ingen kolonneoverskrifter funnet i filen');
  }

  // Calculate column fingerprint for format detection
  const columnFingerprint = createColumnFingerprint(headers);

  // Convert data rows to objects
  const dataRows = rawData.slice(1);
  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];

    // Skip empty rows if configured
    if (opts.skipEmptyRows && isEmptyRow(row)) {
      continue;
    }

    const rowObj: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      rowObj[header] = normalizeValue(row[idx]);
    });

    rows.push(rowObj);
  }

  // Build column info for preview
  const columnInfo = buildColumnInfo(headers, rows, opts.maxPreviewRows || 10);

  return {
    headers,
    rows,
    totalRows: rows.length,
    columnCount: headers.length,
    fileHash,
    columnFingerprint,
    columnInfo,
  };
}

/**
 * Extract and clean headers from the first row
 */
function extractHeaders(headerRow: unknown[]): string[] {
  const headers: string[] = [];
  const usedHeaders = new Set<string>();

  for (let i = 0; i < headerRow.length; i++) {
    let header = String(headerRow[i] || '').trim();

    // Skip completely empty headers
    if (!header) {
      header = `Kolonne_${i + 1}`;
    }

    // Make unique if duplicate
    let uniqueHeader = header;
    let suffix = 1;
    while (usedHeaders.has(uniqueHeader)) {
      uniqueHeader = `${header}_${suffix}`;
      suffix++;
    }

    usedHeaders.add(uniqueHeader);
    headers.push(uniqueHeader);
  }

  return headers;
}

/**
 * Create a fingerprint hash of column structure
 * Used for format change detection
 */
export function createColumnFingerprint(headers: string[]): string {
  // Normalize headers for comparison
  const normalized = headers
    .map(h => h.toLowerCase().trim().replace(/\s+/g, '_'))
    .sort()
    .join('|');

  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Check if a row is empty (all cells are empty/null/undefined)
 */
function isEmptyRow(row: unknown[]): boolean {
  return row.every(cell => {
    if (cell === null || cell === undefined) return true;
    if (typeof cell === 'string' && cell.trim() === '') return true;
    return false;
  });
}

/**
 * Normalize a cell value
 */
function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  if (value instanceof Date) {
    return value.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  return value;
}

/**
 * Build column info for preview display
 */
function buildColumnInfo(
  headers: string[],
  rows: Record<string, unknown>[],
  maxSamples: number
): ColumnInfo[] {
  return headers.map((header, index) => {
    const values = rows.map(row => row[header]);
    const nonNullValues = values.filter(v => v !== null && v !== undefined);
    const stringValues = nonNullValues.map(v => String(v));
    const sampleValues = stringValues.slice(0, maxSamples);
    const uniqueValues = new Set(stringValues);
    const emptyCount = values.filter(v => v === null || v === undefined || v === '').length;

    return {
      index,
      header,
      sampleValues,
      detectedType: detectFieldType(nonNullValues),
      uniqueValueCount: uniqueValues.size,
      emptyCount,
    };
  });
}

/**
 * Detect the most likely field type based on sample values
 */
function detectFieldType(values: unknown[]): import('../../types/import').FieldType {
  if (values.length === 0) {
    return 'string';
  }

  const stringValues = values.map(v => String(v).trim());

  // Check for email
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (stringValues.every(v => emailPattern.test(v))) {
    return 'email';
  }

  // Check for Norwegian phone (8+ digits)
  const phonePattern = /^(\+47)?[\s-]?\d{8,}$/;
  if (stringValues.every(v => phonePattern.test(v.replace(/\s/g, '')))) {
    return 'phone';
  }

  // Check for postnummer (4 digits)
  const postnummerPattern = /^\d{4}$/;
  if (stringValues.every(v => postnummerPattern.test(v))) {
    return 'postnummer';
  }

  // Check for date (various formats)
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}$/,           // YYYY-MM-DD
    /^\d{2}\.\d{2}\.\d{4}$/,         // DD.MM.YYYY
    /^\d{2}\/\d{2}\/\d{4}$/,         // DD/MM/YYYY
    /^\d{2}\.\d{2}\.\d{2}$/,         // DD.MM.YY
  ];
  if (stringValues.every(v => datePatterns.some(p => p.test(v)))) {
    return 'date';
  }

  // Check for integer
  if (stringValues.every(v => /^-?\d+$/.test(v))) {
    return 'integer';
  }

  // Check for number (including decimals)
  if (stringValues.every(v => /^-?\d+([.,]\d+)?$/.test(v))) {
    return 'number';
  }

  // Check for boolean-like values
  const boolValues = ['ja', 'nei', 'yes', 'no', 'true', 'false', '1', '0', 'x', ''];
  if (stringValues.every(v => boolValues.includes(v.toLowerCase()))) {
    return 'boolean';
  }

  return 'string';
}

/**
 * Get supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return ['.xlsx', '.xls', '.csv'];
}

/**
 * Check if a file has a supported extension
 */
export function isSupportedFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  return getSupportedExtensions().includes(ext);
}

/**
 * Get max file size in bytes
 */
export function getMaxFileSize(): number {
  return 10 * 1024 * 1024; // 10MB
}

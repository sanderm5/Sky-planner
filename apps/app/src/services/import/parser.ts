/**
 * Excel Parser Service
 * Parses Excel files and extracts raw data for import
 * Handles messy files: merged cells, metadata rows, multi-sheet, empty columns
 */

import * as xlsx from 'xlsx';
import { createHash } from 'crypto';
import type { ColumnInfo } from '../../types/import';

// Known column name patterns used for header detection scoring
const KNOWN_HEADER_PATTERNS = [
  /^(kunde)?navn$/i, /^name$/i, /^firma$/i, /^company$/i, /^bedrift$/i,
  /^adresse$/i, /^address$/i, /^gateadresse$/i, /^street$/i,
  /^post(nummer|nr|kode)$/i, /^zip$/i, /^postal/i,
  /^poststed$/i, /^by$/i, /^city$/i,
  /^(tlf|telefon|phone|mobil)$/i, /^tel$/i,
  /^(e-?post|email|mail)$/i,
  /^kontakt(person)?$/i, /^contact$/i,
  /^kategori$/i, /^type$/i, /^category$/i,
  /^notat(er)?$/i, /^kommentar$/i, /^note/i,
  /^dato$/i, /^date$/i, /^siste/i, /^neste/i,
];

export interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
  headerScore: number;
}

export interface ParsedExcelData {
  headers: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  columnCount: number;
  fileHash: string;
  columnFingerprint: string;
  columnInfo: ColumnInfo[];
  // New fields for messy file handling
  headerRowIndex: number;
  selectedSheet: string;
  allSheets: SheetInfo[];
  removedColumns: string[];
  skippedMetadataRows: number;
}

export interface ParseOptions {
  maxPreviewRows?: number;
  skipEmptyRows?: boolean;
  preferredSheet?: string; // User can override sheet selection
}

const DEFAULT_OPTIONS: ParseOptions = {
  maxPreviewRows: 10,
  skipEmptyRows: true,
};

/**
 * Forward-fill merged cells in a worksheet
 * The xlsx library reads merged cells only in the top-left cell, leaving others empty.
 * This copies values to all cells in merged ranges.
 */
function forwardFillMergedCells(sheet: xlsx.WorkSheet): void {
  const merges = sheet['!merges'];
  if (!merges || merges.length === 0) return;

  for (const merge of merges) {
    // Get the value from the top-left cell
    const topLeftAddr = xlsx.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
    const topLeftCell = sheet[topLeftAddr];
    if (!topLeftCell) continue;

    // Fill all cells in the merge range
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (r === merge.s.r && c === merge.s.c) continue; // Skip source cell
        const addr = xlsx.utils.encode_cell({ r, c });
        sheet[addr] = { ...topLeftCell };
      }
    }
  }
}

/**
 * Calculate a header score for a row.
 * Higher score = more likely to be the header row.
 */
function calculateHeaderScore(row: unknown[]): number {
  if (!row || row.length === 0) return 0;

  let score = 0;
  const cellToString = (cell: unknown): string => {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'string') return cell.trim();
    if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
    if (cell instanceof Date) return cell.toISOString();
    return '';
  };

  const nonEmptyCells = row.filter(cell => cellToString(cell) !== '');

  // Score 1: Non-empty cell ratio (more non-empty = better header)
  const nonEmptyRatio = nonEmptyCells.length / Math.max(row.length, 1);
  score += nonEmptyRatio * 3;

  // Score 2: All non-empty cells are strings (headers are text, not numbers/dates)
  const allStrings = nonEmptyCells.every(cell => {
    const val = cellToString(cell);
    // Not a pure number
    if (/^-?\d+([.,]\d+)?$/.test(val)) return false;
    // Not a date-like value
    if (/^\d{2}[./-]\d{2}[./-]\d{2,4}$/.test(val)) return false;
    // Not an email
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return false;
    return true;
  });
  if (allStrings && nonEmptyCells.length > 0) score += 4;

  // Score 3: At least 3 unique non-empty values
  const uniqueValues = new Set(nonEmptyCells.map(c => String(c).trim().toLowerCase()));
  if (uniqueValues.size >= 3) score += 2;

  // Score 4: Matches known column name patterns
  let patternMatches = 0;
  for (const cell of nonEmptyCells) {
    const val = String(cell).trim();
    if (KNOWN_HEADER_PATTERNS.some(p => p.test(val))) {
      patternMatches++;
    }
  }
  if (patternMatches > 0) score += patternMatches * 3;

  // Score 5: Minimum 2 non-empty cells
  if (nonEmptyCells.length >= 2) score += 1;

  return score;
}

/**
 * Auto-detect which row is the header row.
 * Scans the first maxScan rows and picks the one with the highest header score.
 */
function detectHeaderRow(rawRows: unknown[][], maxScan: number = 20): number {
  if (rawRows.length === 0) return 0;

  const scanLimit = Math.min(rawRows.length, maxScan);
  let bestRowIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < scanLimit; i++) {
    const score = calculateHeaderScore(rawRows[i]);
    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = i;
    }
  }

  return bestRowIndex;
}

/**
 * Select the best sheet from a workbook.
 * Evaluates each sheet based on data content and header quality.
 */
function selectBestSheet(
  workbook: xlsx.WorkBook,
  preferredSheet?: string
): { sheetName: string; allSheets: SheetInfo[] } {
  const allSheets: SheetInfo[] = [];

  // If user specified a preferred sheet, use it if valid
  if (preferredSheet && workbook.SheetNames.includes(preferredSheet)) {
    // Still compute allSheets for info
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
      allSheets.push({
        name,
        rowCount: range.e.r - range.s.r + 1,
        columnCount: range.e.c - range.s.c + 1,
        headerScore: 0,
      });
    }
    return { sheetName: preferredSheet, allSheets };
  }

  let bestSheet = workbook.SheetNames[0];
  let bestScore = -1;

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet['!ref']) {
      allSheets.push({ name, rowCount: 0, columnCount: 0, headerScore: 0 });
      continue;
    }

    // Handle merged cells before reading data
    forwardFillMergedCells(sheet);

    const range = xlsx.utils.decode_range(sheet['!ref']);
    const rowCount = range.e.r - range.s.r + 1;
    const colCount = range.e.c - range.s.c + 1;

    // Skip tiny sheets (likely metadata/instructions)
    if (rowCount < 3 || colCount < 2) {
      allSheets.push({ name, rowCount, columnCount: colCount, headerScore: 0 });
      continue;
    }

    // Read first few rows to evaluate header quality
    const rawData: unknown[][] = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      range: { s: { r: 0, c: 0 }, e: { r: Math.min(20, range.e.r), c: range.e.c } },
    });

    const headerIdx = detectHeaderRow(rawData);
    const headerScore = calculateHeaderScore(rawData[headerIdx] || []);

    // Combined score: header quality + data volume
    const dataRows = rowCount - headerIdx - 1;
    const combinedScore = headerScore * 10 + dataRows + colCount;

    allSheets.push({ name, rowCount, columnCount: colCount, headerScore });

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestSheet = name;
    }
  }

  return { sheetName: bestSheet, allSheets };
}

/**
 * Remove columns where >95% of values are empty
 */
function removeEmptyColumns(
  headers: string[],
  rows: Record<string, unknown>[]
): { headers: string[]; rows: Record<string, unknown>[]; removedColumns: string[] } {
  if (rows.length === 0) return { headers, rows, removedColumns: [] };

  const threshold = Math.max(rows.length * 0.95, rows.length - 1);
  const removedColumns: string[] = [];
  const keptHeaders: string[] = [];

  for (const header of headers) {
    const emptyCount = rows.filter(row => {
      const val = row[header];
      if (val === null || val === undefined) return true;
      if (typeof val === 'string') return val.trim() === '';
      return false;
    }).length;

    if (emptyCount >= threshold) {
      removedColumns.push(header);
    } else {
      keptHeaders.push(header);
    }
  }

  if (removedColumns.length === 0) {
    return { headers, rows, removedColumns };
  }

  // Remove empty columns from all rows
  const cleanedRows = rows.map(row => {
    const newRow: Record<string, unknown> = {};
    for (const header of keptHeaders) {
      newRow[header] = row[header];
    }
    return newRow;
  });

  return { headers: keptHeaders, rows: cleanedRows, removedColumns };
}

/**
 * Parse an Excel file buffer and extract data
 * Handles messy files with merged cells, metadata rows, multiple sheets
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

  if (workbook.SheetNames.length === 0) {
    throw new Error('Excel-filen inneholder ingen ark');
  }

  // Select best sheet (handles multi-sheet files)
  const { sheetName, allSheets } = selectBestSheet(workbook, opts.preferredSheet);

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error('Excel-filen inneholder ingen ark');
  }

  // Forward-fill merged cells (already done in selectBestSheet, but do again for safety)
  forwardFillMergedCells(sheet);

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

  // Auto-detect header row (handles metadata rows at top)
  const headerRowIndex = detectHeaderRow(rawData);
  const skippedMetadataRows = headerRowIndex;

  // Extract and clean headers from detected header row
  const rawHeaders = extractHeaders(rawData[headerRowIndex]);

  if (rawHeaders.length === 0) {
    throw new Error('Ingen kolonneoverskrifter funnet i filen');
  }

  // Calculate column fingerprint for format detection
  const columnFingerprint = createColumnFingerprint(rawHeaders);

  // Convert data rows to objects (skip header and metadata rows)
  const dataRows = rawData.slice(headerRowIndex + 1);
  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];

    // Skip empty rows if configured
    if (opts.skipEmptyRows && isEmptyRow(row)) {
      continue;
    }

    const rowObj: Record<string, unknown> = {};
    rawHeaders.forEach((header, idx) => {
      rowObj[header] = normalizeValue(row[idx]);
    });

    rows.push(rowObj);
  }

  // Remove columns where >95% of values are empty
  const { headers, rows: cleanedRows, removedColumns } = removeEmptyColumns(rawHeaders, rows);

  // Build column info for preview
  const columnInfo = buildColumnInfo(headers, cleanedRows, opts.maxPreviewRows || 10);

  return {
    headers,
    rows: cleanedRows,
    totalRows: cleanedRows.length,
    columnCount: headers.length,
    fileHash,
    columnFingerprint,
    columnInfo,
    headerRowIndex,
    selectedSheet: sheetName,
    allSheets,
    removedColumns,
    skippedMetadataRows,
  };
}

/**
 * Extract and clean headers from a row
 */
function extractHeaders(headerRow: unknown[]): string[] {
  const headers: string[] = [];
  const usedHeaders = new Set<string>();

  for (let i = 0; i < headerRow.length; i++) {
    const rawVal = headerRow[i];
    let header: string;
    if (typeof rawVal === 'string') {
      header = rawVal.trim();
    } else if (typeof rawVal === 'number' || typeof rawVal === 'boolean') {
      header = String(rawVal);
    } else {
      header = '';
    }

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

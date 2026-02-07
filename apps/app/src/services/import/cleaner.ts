/**
 * Auto-cleaning of Excel/CSV import data
 * Detects and fixes common data quality issues before mapping
 */

import { suggestColumnMappings } from './format-detection';

// ============================================
// TYPES
// ============================================

export interface CellChange {
  rowIndex: number;
  column: string;
  originalValue: unknown;
  cleanedValue: unknown;
  ruleId: string;
}

export interface RowRemoval {
  rowIndex: number;
  rowData: Record<string, unknown>;
  ruleId: string;
  reason: string;
}

export interface CleaningRuleSummary {
  ruleId: string;
  name: string;
  description: string;
  category: 'rows' | 'cells';
  affectedCount: number;
  enabled: boolean;
}

export interface CleaningReport {
  rules: CleaningRuleSummary[];
  cellChanges: CellChange[];
  rowRemovals: RowRemoval[];
  totalCellsCleaned: number;
  totalRowsRemoved: number;
}

export interface CleaningResult {
  cleanedRows: Record<string, unknown>[];
  report: CleaningReport;
}

// ============================================
// CLEANING RULES DEFINITIONS
// ============================================

interface CleaningRuleDef {
  id: string;
  name: string;
  description: string;
  category: 'rows' | 'cells';
}

const CLEANING_RULES: CleaningRuleDef[] = [
  { id: 'remove_empty_rows', name: 'Fjern tomme rader', description: 'Fjerner rader der alle celler er tomme', category: 'rows' },
  { id: 'remove_summary_rows', name: 'Fjern summeringsrader', description: 'Fjerner rader med "sum", "total" o.l.', category: 'rows' },
  { id: 'remove_duplicate_rows', name: 'Fjern duplikater', description: 'Fjerner eksakte duplikatrader (beholder første)', category: 'rows' },
  { id: 'trim_whitespace', name: 'Trim mellomrom', description: 'Fjerner mellomrom foran og bak tekst', category: 'cells' },
  { id: 'normalize_whitespace', name: 'Normaliser mellomrom', description: 'Erstatter flere mellomrom med ett', category: 'cells' },
  { id: 'remove_invisible_chars', name: 'Fjern usynlige tegn', description: 'Fjerner usynlige og spesialtegn', category: 'cells' },
  { id: 'fix_encoding', name: 'Fiks tegnkoding', description: 'Retter feil norske tegn (Ã¦ → æ, Ã¸ → ø)', category: 'cells' },
  { id: 'standardize_empty', name: 'Standardiser tomverdier', description: 'Konverterer "-", "N/A", "ingen" til tom', category: 'cells' },
  { id: 'fix_postnummer', name: 'Fiks postnummer', description: 'Retter 3-sifrede postnummer med ledende 0', category: 'cells' },
  { id: 'fix_phone', name: 'Fiks telefonnummer', description: 'Fjerner landskode og formaterer', category: 'cells' },
];

// ============================================
// ENCODING FIX PATTERNS (UTF-8 mojibake)
// ============================================

const ENCODING_FIXES: [RegExp, string][] = [
  [/Ã¦/g, 'æ'], [/Ã¸/g, 'ø'], [/Ã¥/g, 'å'],
  [/Ã†/g, 'Æ'], [/Ã˜/g, 'Ø'], [/Ã…/g, 'Å'],
  [/Ã©/g, 'é'], [/Ã¶/g, 'ö'], [/Ã¤/g, 'ä'],
  [/Ã¼/g, 'ü'], [/Ã–/g, 'Ö'], [/Ã„/g, 'Ä'],
];

// Values treated as "empty"
const EMPTY_PATTERNS = /^(-|N\/A|n\/a|NA|na|ingen|tom|null|undefined|#N\/A|#REF!|#VERDI!|–|—|\.)$/;

// Summary row patterns
const SUMMARY_PATTERNS = /\b(sum|total|totalt|subtotal|i alt|gjennomsnitt|snitt|antall)\b/i;

// ============================================
// MAIN CLEANING FUNCTION
// ============================================

/**
 * Clean import data and produce a detailed report
 */
export function cleanImportData(
  rows: Record<string, unknown>[],
  headers: string[]
): CleaningResult {
  if (rows.length === 0) {
    return {
      cleanedRows: [],
      report: {
        rules: CLEANING_RULES.map(r => ({
          ruleId: r.id,
          name: r.name,
          description: r.description,
          category: r.category,
          affectedCount: 0,
          enabled: true,
        })),
        cellChanges: [],
        rowRemovals: [],
        totalCellsCleaned: 0,
        totalRowsRemoved: 0,
      },
    };
  }

  // Detect column types for targeted cleaning
  const columnMappingSuggestions = suggestColumnMappings(headers);
  const postnummerColumns = new Set<string>();
  const phoneColumns = new Set<string>();

  for (const suggestion of columnMappingSuggestions) {
    if (suggestion.targetField === 'postnummer') {
      postnummerColumns.add(suggestion.sourceColumn);
    }
    if (suggestion.targetField === 'telefon') {
      phoneColumns.add(suggestion.sourceColumn);
    }
  }

  const cellChanges: CellChange[] = [];
  const rowRemovals: RowRemoval[] = [];

  // Deep clone rows to avoid mutating originals
  let workingRows: Array<Record<string, unknown> & { _originalIndex: number }> = rows.map((row, i) => ({
    ...structuredClone(row),
    _originalIndex: i,
  }));

  // ---- ROW-LEVEL RULES ----

  // Rule 1: Remove empty rows
  const emptyRowIndices: number[] = [];
  workingRows = workingRows.filter(row => {
    const isEmpty = headers.every(h => {
      const val = row[h];
      return val === null || val === undefined || String(val).trim() === '';
    });
    if (isEmpty) {
      emptyRowIndices.push(row._originalIndex);
      rowRemovals.push({
        rowIndex: row._originalIndex,
        rowData: extractRowData(row, headers),
        ruleId: 'remove_empty_rows',
        reason: 'Tom rad',
      });
      return false;
    }
    return true;
  });

  // Rule 2: Remove summary rows
  const summaryRowIndices: number[] = [];
  workingRows = workingRows.filter(row => {
    // Check if any cell contains summary keywords
    const hasSummaryKeyword = headers.some(h => {
      const val = row[h];
      if (typeof val !== 'string') return false;
      return SUMMARY_PATTERNS.test(val);
    });

    if (!hasSummaryKeyword) return true;

    // Only flag as summary if the row has fewer filled cells than average
    // (to avoid removing legitimate rows that happen to contain "total" etc.)
    const filledCells = headers.filter(h => {
      const val = row[h];
      return val !== null && val !== undefined && String(val).trim() !== '';
    }).length;

    // If less than half the columns are filled, it's likely a summary row
    if (filledCells <= Math.ceil(headers.length / 2)) {
      summaryRowIndices.push(row._originalIndex);
      const summaryCell = headers.find(h => typeof row[h] === 'string' && SUMMARY_PATTERNS.test(row[h] as string));
      rowRemovals.push({
        rowIndex: row._originalIndex,
        rowData: extractRowData(row, headers),
        ruleId: 'remove_summary_rows',
        reason: `Summeringsrad ("${summaryCell ? String(row[summaryCell]).substring(0, 40) : '...'}")`,
      });
      return false;
    }
    return true;
  });

  // Rule 3: Remove duplicate rows
  const seenHashes = new Map<string, number>();
  const duplicateRowIndices: number[] = [];
  workingRows = workingRows.filter(row => {
    const hash = headers.map(h => String(row[h] ?? '')).join('|');
    const firstSeen = seenHashes.get(hash);
    if (firstSeen !== undefined) {
      duplicateRowIndices.push(row._originalIndex);
      rowRemovals.push({
        rowIndex: row._originalIndex,
        rowData: extractRowData(row, headers),
        ruleId: 'remove_duplicate_rows',
        reason: `Duplikat av rad ${firstSeen + 2}`, // +2 for 1-indexed + header row
      });
      return false;
    }
    seenHashes.set(hash, row._originalIndex);
    return true;
  });

  // ---- CELL-LEVEL RULES ----

  for (const row of workingRows) {
    const originalIndex = row._originalIndex;

    for (const header of headers) {
      let val = row[header];
      if (val === null || val === undefined) continue;
      if (typeof val !== 'string') {
        // Only apply cell rules to strings
        // But check for phone/postnummer which might be numbers
        if (typeof val === 'number') {
          if (postnummerColumns.has(header)) {
            const fixed = fixPostnummer(val);
            if (fixed !== null && fixed !== String(val)) {
              cellChanges.push({ rowIndex: originalIndex, column: header, originalValue: val, cleanedValue: fixed, ruleId: 'fix_postnummer' });
              row[header] = fixed;
            }
          }
          if (phoneColumns.has(header)) {
            const fixed = fixPhone(val);
            if (fixed !== null && fixed !== String(val)) {
              cellChanges.push({ rowIndex: originalIndex, column: header, originalValue: val, cleanedValue: fixed, ruleId: 'fix_phone' });
              row[header] = fixed;
            }
          }
        }
        continue;
      }

      const original = val;
      let currentVal = val;

      // Rule 6: Remove invisible chars (before trimming so we catch them)
      const noInvisible = removeInvisibleChars(currentVal);
      if (noInvisible !== currentVal) {
        cellChanges.push({ rowIndex: originalIndex, column: header, originalValue: currentVal, cleanedValue: noInvisible, ruleId: 'remove_invisible_chars' });
        currentVal = noInvisible;
      }

      // Rule 4: Trim whitespace
      const trimmed = currentVal.trim();
      if (trimmed !== currentVal) {
        cellChanges.push({ rowIndex: originalIndex, column: header, originalValue: currentVal, cleanedValue: trimmed, ruleId: 'trim_whitespace' });
        currentVal = trimmed;
      }

      // Rule 5: Normalize whitespace
      const normalized = currentVal.replace(/\s{2,}/g, ' ');
      if (normalized !== currentVal) {
        cellChanges.push({ rowIndex: originalIndex, column: header, originalValue: currentVal, cleanedValue: normalized, ruleId: 'normalize_whitespace' });
        currentVal = normalized;
      }

      // Rule 7: Fix encoding
      const fixedEncoding = fixEncodingIssues(currentVal);
      if (fixedEncoding !== currentVal) {
        cellChanges.push({ rowIndex: originalIndex, column: header, originalValue: currentVal, cleanedValue: fixedEncoding, ruleId: 'fix_encoding' });
        currentVal = fixedEncoding;
      }

      // Rule 8: Standardize empty values
      if (EMPTY_PATTERNS.test(currentVal)) {
        cellChanges.push({ rowIndex: originalIndex, column: header, originalValue: currentVal, cleanedValue: null, ruleId: 'standardize_empty' });
        currentVal = '';
        row[header] = null;
        continue; // No further processing needed for empty values
      }

      // Rule 9: Fix postnummer (column-specific)
      if (postnummerColumns.has(header)) {
        const fixed = fixPostnummer(currentVal);
        if (fixed !== null && fixed !== currentVal) {
          cellChanges.push({ rowIndex: originalIndex, column: header, originalValue: currentVal, cleanedValue: fixed, ruleId: 'fix_postnummer' });
          currentVal = fixed;
        }
      }

      // Rule 10: Fix phone (column-specific)
      if (phoneColumns.has(header)) {
        const fixed = fixPhone(currentVal);
        if (fixed !== null && fixed !== currentVal) {
          cellChanges.push({ rowIndex: originalIndex, column: header, originalValue: currentVal, cleanedValue: fixed, ruleId: 'fix_phone' });
          currentVal = fixed;
        }
      }

      // Apply final value if changed
      if (currentVal !== original) {
        row[header] = currentVal || null;
      }
    }
  }

  // Build cleaned rows (remove internal tracking field)
  const cleanedRows = workingRows.map(row => {
    const { _originalIndex, ...data } = row;
    return data;
  });

  // Build rule summaries
  const ruleSummaries: CleaningRuleSummary[] = CLEANING_RULES.map(rule => {
    let affectedCount: number;
    if (rule.category === 'rows') {
      affectedCount = rowRemovals.filter(r => r.ruleId === rule.id).length;
    } else {
      affectedCount = cellChanges.filter(c => c.ruleId === rule.id).length;
    }
    return {
      ruleId: rule.id,
      name: rule.name,
      description: rule.description,
      category: rule.category,
      affectedCount,
      enabled: true,
    };
  });

  return {
    cleanedRows,
    report: {
      rules: ruleSummaries,
      cellChanges,
      rowRemovals,
      totalCellsCleaned: cellChanges.length,
      totalRowsRemoved: rowRemovals.length,
    },
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractRowData(row: Record<string, unknown>, headers: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const h of headers) {
    data[h] = row[h];
  }
  return data;
}

function removeInvisibleChars(str: string): string {
  return str
    .replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u200E\u200F]/g, '')
    .replace(/\u00A0/g, ' '); // non-breaking space → regular space
}

function fixEncodingIssues(str: string): string {
  let result = str;
  for (const [pattern, replacement] of ENCODING_FIXES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function fixPostnummer(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === '') return null;

  const digits = str.replace(/\D/g, '');

  if (digits.length === 4) return digits;
  if (digits.length === 3) return '0' + digits;

  return null; // Can't fix, return null to skip
}

function fixPhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === '') return null;

  // Remove all non-digits except +
  const digits = str.replace(/[^\d+]/g, '');

  // Remove Norwegian country code
  let normalized = digits;
  if (normalized.startsWith('+47')) {
    normalized = normalized.slice(3);
  } else if (normalized.startsWith('0047')) {
    normalized = normalized.slice(4);
  } else if (normalized.startsWith('47') && normalized.length > 10) {
    normalized = normalized.slice(2);
  }

  // Remove any remaining non-digits
  normalized = normalized.replace(/\D/g, '');

  if (normalized.length < 8) return null; // Can't fix

  // Format as XX XX XX XX for 8-digit numbers
  if (normalized.length === 8) {
    const formatted = `${normalized.slice(0, 2)} ${normalized.slice(2, 4)} ${normalized.slice(4, 6)} ${normalized.slice(6, 8)}`;
    // Only return if different from input
    if (formatted !== str) return formatted;
    return null;
  }

  return normalized !== str ? normalized : null;
}

/**
 * Format Change Detection
 * Detects when Excel column structure changes between imports
 */

import type {
  FormatChangeResult,
  ImportColumnHistory,
  ImportMappingTemplate,
} from '../../types/import';

/**
 * Detect if the column format has changed compared to previous imports
 */
export async function detectFormatChange(
  organizationId: number,
  currentFingerprint: string,
  currentColumns: string[],
  getColumnHistory: (orgId: number) => Promise<ImportColumnHistory[]>,
  getTemplateByFingerprint: (orgId: number, fingerprint: string) => Promise<ImportMappingTemplate | null>
): Promise<FormatChangeResult> {
  // Get column history for this organization
  const history = await getColumnHistory(organizationId);

  // First import - no change
  if (!history || history.length === 0) {
    return {
      detected: false,
      requiresRemapping: false,
    };
  }

  // Find most recent format
  const sortedHistory = [...history].sort(
    (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
  );
  const mostRecent = sortedHistory[0];

  // Same format as last time
  if (mostRecent.column_fingerprint === currentFingerprint) {
    return {
      detected: false,
      requiresRemapping: false,
      previousFingerprint: mostRecent.column_fingerprint,
    };
  }

  // Format changed - check if we've seen this format before
  const previouslySeen = history.find(h => h.column_fingerprint === currentFingerprint);

  if (previouslySeen) {
    // We've seen this format before - check if there's a saved template
    const existingTemplate = await getTemplateByFingerprint(organizationId, currentFingerprint);

    return {
      detected: true,
      requiresRemapping: !existingTemplate, // Only require remapping if no template
      previousFingerprint: mostRecent.column_fingerprint,
      similarity: calculateColumnSimilarity(mostRecent.columns, currentColumns),
    };
  }

  // Completely new format - analyze changes
  const previousColumns = mostRecent.columns;
  const changes = analyzeColumnChanges(previousColumns, currentColumns);

  return {
    detected: true,
    requiresRemapping: true,
    previousFingerprint: mostRecent.column_fingerprint,
    similarity: changes.similarity,
    addedColumns: changes.added,
    removedColumns: changes.removed,
    renamedColumns: changes.renamed,
  };
}

/**
 * Calculate similarity between two column sets (0-1)
 */
export function calculateColumnSimilarity(
  oldColumns: string[],
  newColumns: string[]
): number {
  const oldSet = new Set(normalizeColumns(oldColumns));
  const newSet = new Set(normalizeColumns(newColumns));

  let matches = 0;
  for (const col of newSet) {
    if (oldSet.has(col)) {
      matches++;
    }
  }

  const total = Math.max(oldSet.size, newSet.size);
  return total > 0 ? matches / total : 1;
}

/**
 * Analyze what columns have changed
 */
function analyzeColumnChanges(
  oldColumns: string[],
  newColumns: string[]
): {
  similarity: number;
  added: string[];
  removed: string[];
  renamed: Array<{ old: string; new: string; similarity: number }>;
} {
  const normalizedOld = normalizeColumns(oldColumns);
  const normalizedNew = normalizeColumns(newColumns);

  const oldSet = new Set(normalizedOld);
  const newSet = new Set(normalizedNew);

  // Find exact matches
  const matched = new Set<string>();
  for (const col of normalizedNew) {
    if (oldSet.has(col)) {
      matched.add(col);
    }
  }

  // Find removed columns
  const removed = normalizedOld.filter(col => !newSet.has(col));

  // Find added columns
  const added = normalizedNew.filter(col => !oldSet.has(col));

  // Try to find renamed columns (fuzzy match)
  const renamed: Array<{ old: string; new: string; similarity: number }> = [];

  for (const removedCol of removed) {
    let bestMatch: { col: string; similarity: number } | null = null;

    for (const addedCol of added) {
      const similarity = stringSimilarity(removedCol, addedCol);
      if (similarity > 0.6) {
        // Threshold for considering a rename
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { col: addedCol, similarity };
        }
      }
    }

    if (bestMatch) {
      renamed.push({
        old: removedCol,
        new: bestMatch.col,
        similarity: bestMatch.similarity,
      });
    }
  }

  // Remove renamed columns from added/removed lists
  const renamedOld = new Set(renamed.map(r => r.old));
  const renamedNew = new Set(renamed.map(r => r.new));

  const finalRemoved = removed.filter(col => !renamedOld.has(col));
  const finalAdded = added.filter(col => !renamedNew.has(col));

  // Calculate overall similarity
  const matchCount = matched.size + renamed.length;
  const totalUnique = new Set([...normalizedOld, ...normalizedNew]).size;
  const similarity = totalUnique > 0 ? matchCount / totalUnique : 1;

  return {
    similarity,
    added: finalAdded,
    removed: finalRemoved,
    renamed,
  };
}

/**
 * Normalize column names for comparison
 */
function normalizeColumns(columns: string[]): string[] {
  return columns.map(col =>
    col
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_æøå]/g, '')
  );
}

/**
 * Calculate string similarity using Levenshtein distance
 */
function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  const maxLength = Math.max(s1.length, s2.length);

  return 1 - distance / maxLength;
}

/**
 * Suggest automatic column mappings based on known patterns
 */
export function suggestColumnMappings(
  sourceColumns: string[]
): Array<{ sourceColumn: string; targetField: string; confidence: number }> {
  const suggestions: Array<{ sourceColumn: string; targetField: string; confidence: number }> = [];

  // Known column name patterns (Norwegian/English) - ordered by specificity
  const patterns: Array<{ pattern: RegExp; targetField: string; priority: number }> = [
    // ============ NAME FIELDS ============
    { pattern: /^(kunde)?navn$/i, targetField: 'navn', priority: 1 },
    { pattern: /^(firma|bedrift|selskap|virksomhet)(s?navn)?$/i, targetField: 'navn', priority: 2 },
    { pattern: /^(name|customer|client)$/i, targetField: 'navn', priority: 3 },
    { pattern: /^(organisasjon|org\.?)(s?navn)?$/i, targetField: 'navn', priority: 2 },

    // ============ ADDRESS FIELDS ============
    { pattern: /^adresse$/i, targetField: 'adresse', priority: 1 },
    { pattern: /^(gate|vei|steds?)(adresse|navn)?$/i, targetField: 'adresse', priority: 2 },
    { pattern: /^(besøks?)?adresse$/i, targetField: 'adresse', priority: 1 },
    { pattern: /^address$/i, targetField: 'adresse', priority: 3 },
    { pattern: /^street$/i, targetField: 'adresse', priority: 3 },

    // ============ POSTAL CODE ============
    { pattern: /^post(nummer|nr|kode)?$/i, targetField: 'postnummer', priority: 1 },
    { pattern: /^(zip|postal)(code|kode)?$/i, targetField: 'postnummer', priority: 2 },
    { pattern: /^pnr$/i, targetField: 'postnummer', priority: 2 },

    // ============ CITY ============
    { pattern: /^(post)?sted$/i, targetField: 'poststed', priority: 1 },
    { pattern: /^by$/i, targetField: 'poststed', priority: 2 },
    { pattern: /^(city|town|kommune)$/i, targetField: 'poststed', priority: 3 },
    { pattern: /^sted$/i, targetField: 'poststed', priority: 2 },

    // ============ PHONE ============
    { pattern: /^(tele)?fon(nummer)?$/i, targetField: 'telefon', priority: 1 },
    { pattern: /^mobil(nummer|tlf|telefon)?$/i, targetField: 'telefon', priority: 1 },
    { pattern: /^tlf\.?$/i, targetField: 'telefon', priority: 1 },
    { pattern: /^(phone|mobile|cell)$/i, targetField: 'telefon', priority: 3 },
    { pattern: /^nr\.?$/i, targetField: 'telefon', priority: 4 },

    // ============ EMAIL ============
    { pattern: /^e?-?post(adresse)?$/i, targetField: 'epost', priority: 1 },
    { pattern: /^e?-?mail$/i, targetField: 'epost', priority: 1 },
    { pattern: /^mail$/i, targetField: 'epost', priority: 2 },

    // ============ CONTACT PERSON ============
    { pattern: /^kontakt(person)?$/i, targetField: 'kontaktperson', priority: 1 },
    { pattern: /^(ansvarlig|daglig\s?leder)$/i, targetField: 'kontaktperson', priority: 2 },
    { pattern: /^(contact|person)$/i, targetField: 'kontaktperson', priority: 3 },

    // ============ CATEGORY ============
    { pattern: /^kategori$/i, targetField: 'kategori', priority: 1 },
    { pattern: /^(klient)?type$/i, targetField: 'kategori', priority: 2 },
    { pattern: /^(category|type|class)$/i, targetField: 'kategori', priority: 3 },
    { pattern: /^bransje$/i, targetField: 'kategori', priority: 2 },

    // ============ NOTES ============
    { pattern: /^(notat(er)?|merknad(er)?|info)$/i, targetField: 'notater', priority: 1 },
    { pattern: /^kommentar(er)?$/i, targetField: 'notater', priority: 2 },
    { pattern: /^(notes?|comments?|remarks?)$/i, targetField: 'notater', priority: 3 },
    { pattern: /^beskrivelse$/i, targetField: 'notater', priority: 2 },

    // ============ EL-KONTROLL SPECIFIC ============
    { pattern: /^siste.*(el|elektrisk).*kontroll$/i, targetField: 'siste_el_kontroll', priority: 1 },
    { pattern: /^neste.*(el|elektrisk).*kontroll$/i, targetField: 'neste_el_kontroll', priority: 1 },
    { pattern: /^(el|elektrisk).?kontroll.*(siste|utført)$/i, targetField: 'siste_el_kontroll', priority: 1 },
    { pattern: /^(el|elektrisk).?kontroll.*(neste|planlagt)$/i, targetField: 'neste_el_kontroll', priority: 1 },

    // ============ BRANNVARSLING SPECIFIC ============
    { pattern: /^siste.*(brann|alarm).*kontroll$/i, targetField: 'siste_brann_kontroll', priority: 1 },
    { pattern: /^neste.*(brann|alarm).*kontroll$/i, targetField: 'neste_brann_kontroll', priority: 1 },
    { pattern: /^(brann|alarm).?kontroll.*(siste|utført)$/i, targetField: 'siste_brann_kontroll', priority: 1 },
    { pattern: /^(brann|alarm).?kontroll.*(neste|planlagt)$/i, targetField: 'neste_brann_kontroll', priority: 1 },

    // ============ GENERIC CONTROL DATES ============
    { pattern: /^(siste|forrige|utført).*kontroll$/i, targetField: 'siste_kontroll', priority: 3 },
    { pattern: /^(neste|planlagt|kommende).*kontroll$/i, targetField: 'neste_kontroll', priority: 3 },
    { pattern: /^kontroll.*(dato|siste|utført)$/i, targetField: 'siste_kontroll', priority: 3 },
    { pattern: /^kontroll.*(neste|planlagt)$/i, targetField: 'neste_kontroll', priority: 3 },
    { pattern: /^(sist|last).*(date|dato)$/i, targetField: 'siste_kontroll', priority: 4 },
    { pattern: /^(next|neste).*(date|dato)$/i, targetField: 'neste_kontroll', priority: 4 },

    // ============ EL TYPE ============
    { pattern: /^(el|elektrisk)?.?type$/i, targetField: 'el_type', priority: 2 },
    { pattern: /^(anleggs?)?type$/i, targetField: 'el_type', priority: 3 },
    { pattern: /^(landbruk|næring|bolig|gartneri)$/i, targetField: 'el_type', priority: 1 },

    // ============ BRANN SYSTEM ============
    { pattern: /^(brann|alarm)?.?system$/i, targetField: 'brann_system', priority: 2 },
    { pattern: /^(sentral|utstyr)(s?type)?$/i, targetField: 'brann_system', priority: 2 },
    { pattern: /^(elotec|icas)$/i, targetField: 'brann_system', priority: 1 },

    // ============ INTERVALS ============
    { pattern: /^intervall$/i, targetField: 'kontroll_intervall_mnd', priority: 2 },
    { pattern: /^(kontroll)?frekvens$/i, targetField: 'kontroll_intervall_mnd', priority: 2 },
    { pattern: /^(mnd|måneder|months?)$/i, targetField: 'kontroll_intervall_mnd', priority: 3 },

    // ============ ORGANIZATION NUMBER ============
    { pattern: /^(org\.?|organisasjons?)?(nr|nummer)$/i, targetField: 'org_nummer', priority: 1 },

    // ============ EXTERNAL ID ============
    { pattern: /^(ekstern|external)?.?(id|kode)$/i, targetField: 'ekstern_id', priority: 2 },
    { pattern: /^(kunde)?(nr|nummer|id)$/i, targetField: 'ekstern_id', priority: 3 },
  ];

  // Track which target fields have been assigned
  const assignedTargets = new Map<string, { sourceColumn: string; confidence: number }>();

  for (const sourceColumn of sourceColumns) {
    const normalizedSource = sourceColumn.toLowerCase().replace(/[_\s-]+/g, '');

    for (const { pattern, targetField, priority } of patterns) {
      if (pattern.test(sourceColumn) || pattern.test(normalizedSource)) {
        const confidence = 1 - (priority - 1) * 0.1; // priority 1 = 1.0, priority 2 = 0.9, etc.

        const existing = assignedTargets.get(targetField);
        if (!existing || confidence > existing.confidence) {
          assignedTargets.set(targetField, { sourceColumn, confidence });
        }
        break; // Only use first matching pattern per source column
      }
    }
  }

  // Convert to array
  for (const [targetField, { sourceColumn, confidence }] of assignedTargets) {
    suggestions.push({ sourceColumn, targetField, confidence });
  }

  return suggestions;
}

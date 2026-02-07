/**
 * Fuzzy Duplicate Detection
 * Multi-field scoring for detecting duplicates both within a batch
 * and against existing customers in the database.
 *
 * Threshold: 0.7 = probable duplicate, 0.5-0.7 = possible duplicate
 */

// ============ Levenshtein / String Similarity ============

function levenshteinSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= s1.length; i++) matrix[i] = [i];
  for (let j = 0; j <= s2.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  return 1 - distance / Math.max(s1.length, s2.length);
}

// ============ Normalization helpers ============

function normalizeCompanyName(name: string): string {
  if (!name) return '';
  let n = name.trim().toLowerCase();
  // Normalize company suffixes
  n = n.replace(/\s+(a\.?s\.?|a\/s)$/i, ' as');
  n = n.replace(/\s+(a\.?n\.?s\.?)$/i, ' ans');
  n = n.replace(/\s+(d\.?a\.?)$/i, ' da');
  n = n.replace(/\s+(enk\.?|enkeltpersonforetak)$/i, ' enk');
  n = n.replace(/\s+(nuf\.?)$/i, ' nuf');
  n = n.replace(/\s+/g, ' ');
  n = n.replace(/[.,]/g, '');
  return n;
}

function normalizeAddress(address: string): string {
  if (!address) return '';
  let n = address.trim().toLowerCase();
  n = n.replace(/\bgt\.?\b/gi, 'gate');
  n = n.replace(/\bvn\.?\b/gi, 'veien');
  n = n.replace(/\bv\.?\b/gi, 'vei');
  n = n.replace(/\bpl\.?\b/gi, 'plass');
  n = n.replace(/\s+/g, ' ');
  return n;
}

function normalizePhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').replace(/^(0047|\+47|47)/, '');
}

function normalizeEmail(email: string): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

// ============ Field extraction ============

interface NormalizedRecord {
  navn: string;
  adresse: string;
  postnummer: string;
  epost: string;
  telefon: string;
}

function extractFields(data: Record<string, unknown>): NormalizedRecord {
  const str = (key: string) => typeof data[key] === 'string' ? data[key] : '';
  return {
    navn: normalizeCompanyName(str('navn')),
    adresse: normalizeAddress(str('adresse')),
    postnummer: str('postnummer').trim(),
    epost: normalizeEmail(str('epost')),
    telefon: normalizePhone(str('telefon')),
  };
}

// ============ Scoring ============

/**
 * Field weights for duplicate scoring.
 * Email gets the highest individual weight because it's a strong unique identifier.
 */
const FIELD_WEIGHTS = {
  navn: 0.4,
  adresse: 0.3,
  epost: 0.5,
  telefon: 0.3,
  postnummer: 0.1,
} as const;

interface FieldScore {
  field: string;
  score: number;
  weight: number;
  weightedScore: number;
}

function scoreFields(a: NormalizedRecord, b: NormalizedRecord): { totalScore: number; fieldScores: FieldScore[] } {
  const fieldScores: FieldScore[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  // Name: fuzzy match
  if (a.navn && b.navn) {
    const score = levenshteinSimilarity(a.navn, b.navn);
    const weighted = score * FIELD_WEIGHTS.navn;
    fieldScores.push({ field: 'navn', score, weight: FIELD_WEIGHTS.navn, weightedScore: weighted });
    weightedSum += weighted;
    totalWeight += FIELD_WEIGHTS.navn;
  }

  // Address: fuzzy match
  if (a.adresse && b.adresse) {
    const score = levenshteinSimilarity(a.adresse, b.adresse);
    const weighted = score * FIELD_WEIGHTS.adresse;
    fieldScores.push({ field: 'adresse', score, weight: FIELD_WEIGHTS.adresse, weightedScore: weighted });
    weightedSum += weighted;
    totalWeight += FIELD_WEIGHTS.adresse;
  }

  // Email: exact match (strong signal)
  if (a.epost && b.epost) {
    const score = a.epost === b.epost ? 1 : 0;
    const weighted = score * FIELD_WEIGHTS.epost;
    fieldScores.push({ field: 'epost', score, weight: FIELD_WEIGHTS.epost, weightedScore: weighted });
    weightedSum += weighted;
    totalWeight += FIELD_WEIGHTS.epost;
  }

  // Phone: exact match on normalized digits
  if (a.telefon && b.telefon) {
    const score = a.telefon === b.telefon ? 1 : 0;
    const weighted = score * FIELD_WEIGHTS.telefon;
    fieldScores.push({ field: 'telefon', score, weight: FIELD_WEIGHTS.telefon, weightedScore: weighted });
    weightedSum += weighted;
    totalWeight += FIELD_WEIGHTS.telefon;
  }

  // Postnummer: exact match
  if (a.postnummer && b.postnummer) {
    const score = a.postnummer === b.postnummer ? 1 : 0;
    const weighted = score * FIELD_WEIGHTS.postnummer;
    fieldScores.push({ field: 'postnummer', score, weight: FIELD_WEIGHTS.postnummer, weightedScore: weighted });
    weightedSum += weighted;
    totalWeight += FIELD_WEIGHTS.postnummer;
  }

  const totalScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return { totalScore, fieldScores };
}

// ============ Public types ============

export interface DuplicateCandidate {
  /** ID of the existing customer (undefined for intra-batch duplicates) */
  existingKundeId?: number;
  /** Row index within the batch (for intra-batch duplicates) */
  batchRowIndex?: number;
  /** The name of the candidate */
  navn: string;
  /** The address of the candidate */
  adresse: string;
  /** Overall match score (0-1) */
  score: number;
  /** Confidence label */
  confidence: 'high' | 'medium';
  /** Per-field scores */
  fieldScores: FieldScore[];
}

export interface DuplicateCheckResult {
  /** Row index in the batch */
  rowIndex: number;
  /** Whether duplicates were found */
  hasDuplicates: boolean;
  /** Candidates sorted by score (descending) */
  candidates: DuplicateCandidate[];
  /** Suggested action */
  suggestedAction: 'create' | 'update' | 'review';
}

export interface BatchDuplicateReport {
  /** Total rows checked */
  totalChecked: number;
  /** Rows with probable duplicates (score >= 0.7) */
  probableDuplicates: number;
  /** Rows with possible duplicates (0.5 <= score < 0.7) */
  possibleDuplicates: number;
  /** Rows without matches */
  uniqueRows: number;
  /** Per-row results (only for rows with matches) */
  results: DuplicateCheckResult[];
}

// ============ Existing customer interface ============

export interface ExistingKunde {
  id: number;
  navn: string;
  adresse: string;
  postnummer?: string;
  epost?: string;
  telefon?: string;
}

// ============ Thresholds ============

const PROBABLE_THRESHOLD = 0.7;
const POSSIBLE_THRESHOLD = 0.5;

// ============ Main detection functions ============

/**
 * Check a single row against existing customers in the database.
 */
export function checkAgainstExisting(
  rowData: Record<string, unknown>,
  rowIndex: number,
  existingKunder: ExistingKunde[]
): DuplicateCheckResult {
  const rowFields = extractFields(rowData);
  const candidates: DuplicateCandidate[] = [];

  for (const kunde of existingKunder) {
    const kundeFields: NormalizedRecord = {
      navn: normalizeCompanyName(kunde.navn || ''),
      adresse: normalizeAddress(kunde.adresse || ''),
      postnummer: (kunde.postnummer || '').trim(),
      epost: normalizeEmail(kunde.epost || ''),
      telefon: normalizePhone(kunde.telefon || ''),
    };

    const { totalScore, fieldScores } = scoreFields(rowFields, kundeFields);

    if (totalScore >= POSSIBLE_THRESHOLD) {
      candidates.push({
        existingKundeId: kunde.id,
        navn: kunde.navn,
        adresse: kunde.adresse,
        score: totalScore,
        confidence: totalScore >= PROBABLE_THRESHOLD ? 'high' : 'medium',
        fieldScores,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return {
    rowIndex,
    hasDuplicates: candidates.length > 0,
    candidates,
    suggestedAction: determineSuggestedAction(candidates),
  };
}

/**
 * Check for duplicates within the batch itself (intra-batch).
 */
export function checkIntraBatch(
  rows: Array<{ data: Record<string, unknown>; index: number }>
): DuplicateCheckResult[] {
  const results: DuplicateCheckResult[] = [];
  const normalized = rows.map(r => ({
    fields: extractFields(r.data),
    index: r.index,
    data: r.data,
  }));

  for (let i = 0; i < normalized.length; i++) {
    const candidates: DuplicateCandidate[] = [];

    for (let j = 0; j < i; j++) {
      const { totalScore, fieldScores } = scoreFields(normalized[i].fields, normalized[j].fields);

      if (totalScore >= POSSIBLE_THRESHOLD) {
        const rawNavn = rows[j].data.navn;
        const rawAdresse = rows[j].data.adresse;
        const navn: string = typeof rawNavn === 'string' ? rawNavn : '';
        const adresse: string = typeof rawAdresse === 'string' ? rawAdresse : '';
        candidates.push({
          batchRowIndex: normalized[j].index,
          navn,
          adresse,
          score: totalScore,
          confidence: totalScore >= PROBABLE_THRESHOLD ? 'high' : 'medium',
          fieldScores,
        });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      results.push({
        rowIndex: normalized[i].index,
        hasDuplicates: true,
        candidates,
        suggestedAction: 'review',
      });
    }
  }

  return results;
}

/**
 * Full duplicate check: intra-batch + against existing customers.
 */
export function checkDuplicates(
  batchRows: Array<{ data: Record<string, unknown>; index: number }>,
  existingKunder: ExistingKunde[]
): BatchDuplicateReport {
  let probableDuplicates = 0;
  let possibleDuplicates = 0;
  let uniqueRows = 0;
  const results: DuplicateCheckResult[] = [];

  // Intra-batch check
  const intraBatchResults = checkIntraBatch(batchRows);
  const intraBatchMap = new Map<number, DuplicateCheckResult>();
  for (const r of intraBatchResults) {
    intraBatchMap.set(r.rowIndex, r);
  }

  // Check each row against existing customers
  for (const row of batchRows) {
    const existingResult = checkAgainstExisting(row.data, row.index, existingKunder);
    const intraBatchResult = intraBatchMap.get(row.index);

    // Merge candidates from both checks
    const allCandidates = [...existingResult.candidates];
    if (intraBatchResult) {
      allCandidates.push(...intraBatchResult.candidates);
    }
    allCandidates.sort((a, b) => b.score - a.score);

    if (allCandidates.length === 0) {
      uniqueRows++;
      continue;
    }

    const topScore = allCandidates[0].score;
    if (topScore >= PROBABLE_THRESHOLD) {
      probableDuplicates++;
    } else {
      possibleDuplicates++;
    }

    results.push({
      rowIndex: row.index,
      hasDuplicates: true,
      candidates: allCandidates,
      suggestedAction: determineSuggestedAction(allCandidates),
    });
  }

  return {
    totalChecked: batchRows.length,
    probableDuplicates,
    possibleDuplicates,
    uniqueRows,
    results,
  };
}

// ============ Helpers ============

function determineSuggestedAction(candidates: DuplicateCandidate[]): 'create' | 'update' | 'review' {
  if (candidates.length === 0) return 'create';
  const topScore = candidates[0].score;
  if (topScore >= PROBABLE_THRESHOLD && candidates[0].existingKundeId) return 'update';
  if (topScore >= POSSIBLE_THRESHOLD) return 'review';
  return 'create';
}

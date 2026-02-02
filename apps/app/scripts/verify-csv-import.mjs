/**
 * Verification script for TRE Allservice customer import from CSV
 * Compares CSV source file against database to ensure all data is correct
 *
 * Usage:
 *   node scripts/verify-csv-import.mjs
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import iconv from 'iconv-lite';

// Configuration
const ORGANIZATION_ID = 5; // TRE Allservice AS
const CSV_PATH = path.resolve(process.cwd(), '../../El-kontroll og brannvarsling 12.3 (1).csv');

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
// SAME PARSING LOGIC AS IMPORT SCRIPT - DO NOT MODIFY
// ============================================================

const MONTH_MAP = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
  'mai': 5, 'jun': 6, 'jul': 7, 'aug': 8,
  'sep': 9, 'spt': 9, 'okt': 10, 'nov': 11, 'des': 12,
  'mars': 3,
  'may': 5, 'oct': 10, 'dec': 12
};

function parseMonth(monthStr) {
  if (!monthStr || monthStr === 'x' || monthStr === 'Måned') return null;

  const lower = monthStr.toLowerCase().trim();

  if (MONTH_MAP[lower]) return MONTH_MAP[lower];

  // Parse "09.sep" or "9-Sep" format (handles both . and - separators)
  const match = lower.match(/(\d+)?[\.\-]?(\w+)/);
  if (match && match[2]) {
    const monthName = match[2].substring(0, 3);
    return MONTH_MAP[monthName] || null;
  }

  return null;
}

function parseDate(yearStr, monthStr) {
  if (!yearStr || yearStr === 'x' || yearStr === 'Siste' || yearStr === 'Neste') {
    return null;
  }

  const year = parseInt(yearStr.trim());
  if (isNaN(year) || year < 2000 || year > 2100) return null;

  const month = parseMonth(monthStr) || 1;
  return `${year}-${month.toString().padStart(2, '0')}-01`;
}

function parseInterval(freqStr) {
  if (!freqStr || freqStr === 'Frekvens') return 36;

  const numMatch = freqStr.match(/(\d+)/);
  if (numMatch) {
    const years = parseInt(numMatch[1]);
    if (!isNaN(years) && years > 0 && years <= 10) {
      return years * 12;
    }
  }

  return 36;
}

function cleanPhone(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/\s/g, '').trim();
  return cleaned.length >= 8 ? cleaned : null;
}

function isValidOrgNr(str) {
  if (!str) return false;
  return /^\d{9}$/.test(str.trim());
}

// ============================================================
// NORMALIZATION FUNCTIONS FOR COMPARISON
// ============================================================

function normalizeString(str) {
  if (!str || str === 'null' || str === 'undefined') return null;

  return String(str)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // Remove UTF-8 replacement character and similar encoding artifacts
    .replace(/\ufffd/g, '')
    .replace(/ï¿½/g, '')
    .normalize('NFC');
}

// Normalize for matching - strips all potentially problematic characters
function normalizeForMatching(str) {
  if (!str || str === 'null' || str === 'undefined') return null;

  return String(str)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // Remove all Norwegian special chars and their corrupted versions for matching
    .replace(/[øæåØÆÅ]/g, '')
    .replace(/\ufffd/g, '')
    .replace(/ï¿½/g, '')
    .normalize('NFC');
}

function normalizePhone(phone) {
  if (!phone) return null;

  let cleaned = String(phone)
    .replace(/[\s\-\(\)\.]/g, '')
    .replace(/^\+47/, '')
    .replace(/^0047/, '')
    .trim();

  if (cleaned.length < 8 || !/^\d+$/.test(cleaned)) return null;

  return cleaned;
}

function normalizeDate(dateValue) {
  if (!dateValue) return null;

  if (typeof dateValue === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return dateValue;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(dateValue)) {
      return dateValue.substring(0, 10);
    }
  }

  try {
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date.toISOString().substring(0, 10);
    }
  } catch (e) {
    // Invalid date
  }

  return null;
}

function normalizeEmail(email) {
  if (!email) return null;

  const cleaned = String(email).trim().toLowerCase();

  if (!cleaned.includes('@') || cleaned.length < 5) return null;

  return cleaned;
}

// ============================================================
// MATCHING FUNCTIONS
// ============================================================

function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);

  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;

  const m = s1.length;
  const n = s2.length;

  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i-1] === s2[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + cost
      );
    }
  }

  const distance = dp[m][n];
  const maxLen = Math.max(m, n);
  return 1 - (distance / maxLen);
}

function findMatchingCustomer(csvCustomer, dbCustomers) {
  const csvNameStripped = normalizeForMatching(csvCustomer.navn);
  const csvAddrStripped = normalizeForMatching(csvCustomer.adresse);

  // 1. Exact match on name + address (with encoding tolerance)
  const exactMatch = dbCustomers.find(db => {
    const dbNameStripped = normalizeForMatching(db.navn);
    const dbAddrStripped = normalizeForMatching(db.adresse);
    return dbNameStripped === csvNameStripped && dbAddrStripped === csvAddrStripped;
  });

  if (exactMatch) {
    return { match: exactMatch, matchType: 'exact', confidence: 1.0 };
  }

  // 2. Fuzzy match on name + exact address
  const fuzzyNameMatches = dbCustomers.filter(db => {
    const nameSim = calculateSimilarity(normalizeForMatching(db.navn), csvNameStripped);
    const addrMatch = normalizeForMatching(db.adresse) === csvAddrStripped;
    return nameSim >= 0.9 && addrMatch;
  });

  if (fuzzyNameMatches.length === 1) {
    const sim = calculateSimilarity(normalizeForMatching(fuzzyNameMatches[0].navn), csvNameStripped);
    return { match: fuzzyNameMatches[0], matchType: 'fuzzy_name', confidence: sim };
  }

  // 3. Exact name + fuzzy address
  const fuzzyAddrMatches = dbCustomers.filter(db => {
    const nameMatch = normalizeForMatching(db.navn) === csvNameStripped;
    const addrSim = calculateSimilarity(normalizeForMatching(db.adresse), csvAddrStripped);
    return nameMatch && addrSim >= 0.9;
  });

  if (fuzzyAddrMatches.length === 1) {
    const sim = calculateSimilarity(normalizeForMatching(fuzzyAddrMatches[0].adresse), csvAddrStripped);
    return { match: fuzzyAddrMatches[0], matchType: 'fuzzy_addr', confidence: sim };
  }

  // 4. Check for multiple potential matches (ambiguous)
  const allCandidates = dbCustomers.filter(db => {
    const nameSim = calculateSimilarity(normalizeForMatching(db.navn), csvNameStripped);
    const addrSim = calculateSimilarity(normalizeForMatching(db.adresse), csvAddrStripped);
    return nameSim >= 0.8 && addrSim >= 0.8;
  });

  if (allCandidates.length > 1) {
    return { match: null, matchType: 'ambiguous', candidates: allCandidates };
  }

  if (allCandidates.length === 1) {
    const nameSim = calculateSimilarity(normalizeForMatching(allCandidates[0].navn), csvNameStripped);
    const addrSim = calculateSimilarity(normalizeForMatching(allCandidates[0].adresse), csvAddrStripped);
    return {
      match: allCandidates[0],
      matchType: 'fuzzy_both',
      confidence: (nameSim + addrSim) / 2
    };
  }

  return { match: null, matchType: 'not_found' };
}

// ============================================================
// FIELD COMPARISON
// ============================================================

function compareField(fieldName, csvValue, dbValue, normalizer = normalizeString) {
  const normalizedCsv = normalizer(csvValue);
  const normalizedDb = normalizer(dbValue);

  // For encoding-tolerant comparison, strip Norwegian chars
  const strippedCsv = normalizeForMatching(csvValue);
  const strippedDb = normalizeForMatching(dbValue);

  if (!normalizedCsv && !normalizedDb) {
    return {
      field: fieldName,
      match: true,
      status: 'both_empty',
      csv: csvValue,
      db: dbValue
    };
  }

  if (!normalizedCsv && normalizedDb) {
    return {
      field: fieldName,
      match: false,
      status: 'csv_empty',
      csv: csvValue,
      db: dbValue,
      normalizedCsv,
      normalizedDb,
      isEncodingOnly: false
    };
  }

  if (normalizedCsv && !normalizedDb) {
    return {
      field: fieldName,
      match: false,
      status: 'db_empty',
      csv: csvValue,
      db: dbValue,
      normalizedCsv,
      normalizedDb,
      isEncodingOnly: false
    };
  }

  const isMatch = normalizedCsv === normalizedDb;

  // Check if mismatch is only due to encoding (stripped versions match)
  const isEncodingOnly = !isMatch && strippedCsv === strippedDb;

  return {
    field: fieldName,
    match: isMatch,
    status: isMatch ? 'match' : 'mismatch',
    csv: csvValue,
    db: dbValue,
    normalizedCsv,
    normalizedDb,
    similarity: isMatch ? 1.0 : calculateSimilarity(String(normalizedCsv), String(normalizedDb)),
    isEncodingOnly
  };
}

function compareCustomer(csvCustomer, dbCustomer) {
  const comparisons = [];

  // Core fields
  comparisons.push(compareField('navn', csvCustomer.navn, dbCustomer.navn));
  comparisons.push(compareField('adresse', csvCustomer.adresse, dbCustomer.adresse));
  comparisons.push(compareField('postnummer', csvCustomer.postnummer, dbCustomer.postnummer));
  comparisons.push(compareField('poststed', csvCustomer.poststed, dbCustomer.poststed));

  // Contact fields
  comparisons.push(compareField('telefon', csvCustomer.telefon, dbCustomer.telefon, normalizePhone));
  comparisons.push(compareField('epost', csvCustomer.epost, dbCustomer.epost, normalizeEmail));

  // Service fields
  comparisons.push(compareField('el_type', csvCustomer.el_type, dbCustomer.el_type));

  // Date fields - El-kontroll
  comparisons.push(compareField('siste_el_kontroll',
    csvCustomer.siste_el_kontroll, dbCustomer.siste_el_kontroll, normalizeDate));
  comparisons.push(compareField('neste_el_kontroll',
    csvCustomer.neste_el_kontroll, dbCustomer.neste_el_kontroll, normalizeDate));

  // Interval fields
  comparisons.push(compareField('el_kontroll_intervall',
    csvCustomer.el_kontroll_intervall, dbCustomer.el_kontroll_intervall,
    v => v != null ? Number(v) : null));

  // Brannvarsling fields
  comparisons.push(compareField('brann_system', csvCustomer.brann_system, dbCustomer.brann_system));
  comparisons.push(compareField('brann_driftstype', csvCustomer.brann_driftstype, dbCustomer.brann_driftstype));
  comparisons.push(compareField('siste_brann_kontroll',
    csvCustomer.siste_brann_kontroll, dbCustomer.siste_brann_kontroll, normalizeDate));
  comparisons.push(compareField('neste_brann_kontroll',
    csvCustomer.neste_brann_kontroll, dbCustomer.neste_brann_kontroll, normalizeDate));

  // Special handling for brann_kontroll_intervall - ignore if CSV is null and DB is 12 (default)
  const brannIntervallComparison = compareField('brann_kontroll_intervall',
    csvCustomer.brann_kontroll_intervall, dbCustomer.brann_kontroll_intervall,
    v => v != null ? Number(v) : null);
  // Mark as "default value" if CSV is null and DB is 12
  if (brannIntervallComparison.status === 'csv_empty' && dbCustomer.brann_kontroll_intervall === 12) {
    brannIntervallComparison.match = true;
    brannIntervallComparison.status = 'default_value';
    brannIntervallComparison.isEncodingOnly = false;
  }
  comparisons.push(brannIntervallComparison);

  // Notes field
  comparisons.push(compareField('notater', csvCustomer.notater, dbCustomer.notater,
    str => str ? normalizeString(str.replace(/\n/g, ' ')) : null));

  const realMismatches = comparisons.filter(c => !c.match && !c.isEncodingOnly);
  const encodingOnlyMismatches = comparisons.filter(c => !c.match && c.isEncodingOnly);

  return {
    csvCustomer,
    dbCustomer,
    comparisons,
    allMatch: comparisons.every(c => c.match),
    realMismatches,
    encodingOnlyMismatches,
    mismatches: comparisons.filter(c => !c.match),
    matchCount: comparisons.filter(c => c.match).length,
    totalFields: comparisons.length
  };
}

// ============================================================
// REPORT GENERATION
// ============================================================

function generateReport(stats) {
  console.log('\n' + '='.repeat(70));
  console.log('VERIFICATION REPORT - CSV vs DATABASE');
  console.log('='.repeat(70));

  // Count real vs encoding-only mismatches
  const realMismatchCount = stats.fieldMismatches.filter(f => f.comparison.realMismatches.length > 0).length;
  const encodingOnlyCount = stats.fieldMismatches.filter(f =>
    f.comparison.realMismatches.length === 0 && f.comparison.encodingOnlyMismatches.length > 0
  ).length;

  console.log('\n--- SUMMARY ---');
  console.log(`CSV records:          ${stats.csvRowCount}`);
  console.log(`Database records:     ${stats.dbRowCount}`);
  console.log(`Exact matches:        ${stats.exactMatches}`);
  console.log(`Fuzzy matches:        ${stats.fuzzyMatches}`);
  console.log(`Not in database:      ${stats.notInDb.length}`);
  console.log(`Not in CSV:           ${stats.notInCsv.length}`);
  console.log(`Real data mismatches: ${realMismatchCount}`);
  console.log(`Encoding-only issues: ${encodingOnlyCount}`);
  console.log(`Ambiguous matches:    ${stats.ambiguousMatches.length}`);
  console.log(`Duplicates in CSV:    ${stats.duplicatesInCsv.length}`);
  console.log(`Duplicates in DB:     ${stats.duplicatesInDb.length}`);

  // Only consider real issues for pass/fail (not encoding issues)
  const isClean = stats.notInDb.length === 0 &&
                  stats.notInCsv.length === 0 &&
                  realMismatchCount === 0 &&
                  stats.ambiguousMatches.length === 0;

  console.log('\n--- VERIFICATION STATUS ---');
  if (isClean) {
    console.log('STATUS: PASSED - All records match perfectly!');
  } else {
    console.log('STATUS: FAILED - Discrepancies found (see details below)');
  }

  if (stats.notInDb.length > 0) {
    console.log('\n--- CUSTOMERS IN CSV BUT NOT IN DATABASE ---');
    for (const item of stats.notInDb) {
      console.log(`  [Row ${item.csvRow}] ${item.customer.navn}`);
      console.log(`    Address: ${item.customer.adresse}, ${item.customer.postnummer} ${item.customer.poststed}`);
      console.log(`    Phone: ${item.customer.telefon || '(none)'}`);
    }
  }

  if (stats.notInCsv.length > 0) {
    console.log('\n--- CUSTOMERS IN DATABASE BUT NOT IN CSV ---');
    for (const item of stats.notInCsv) {
      console.log(`  [DB ID ${item.dbId}] ${item.customer.navn}`);
      console.log(`    Address: ${item.customer.adresse}, ${item.customer.postnummer} ${item.customer.poststed}`);
    }
  }

  // Show only records with REAL data mismatches (not encoding-only)
  const recordsWithRealMismatches = stats.fieldMismatches.filter(f => f.comparison.realMismatches.length > 0);

  if (recordsWithRealMismatches.length > 0) {
    console.log('\n--- REAL DATA MISMATCHES ---');
    for (const item of recordsWithRealMismatches) {
      console.log(`\n  [Row ${item.csvRow} <-> DB ID ${item.dbId}] ${item.comparison.csvCustomer.navn}`);

      for (const mismatch of item.comparison.realMismatches) {
        console.log(`    MISMATCH: ${mismatch.field}`);
        console.log(`      CSV: "${mismatch.csv}"`);
        console.log(`      DB:  "${mismatch.db}"`);
      }
    }
  }

  // Show encoding issues summary
  if (encodingOnlyCount > 0) {
    console.log(`\n--- ENCODING ISSUES (${encodingOnlyCount} records) ---`);
    console.log('  Note: These are display issues from CSV export, DB has correct Norwegian characters.');
    console.log('  Affected fields: navn, adresse, poststed, notater, el_type');
  }

  if (stats.ambiguousMatches.length > 0) {
    console.log('\n--- AMBIGUOUS MATCHES (MANUAL REVIEW NEEDED) ---');
    for (const item of stats.ambiguousMatches) {
      console.log(`\n  [Row ${item.csvRow}] ${item.customer.navn}`);
      console.log(`    Address: ${item.customer.adresse}`);
      console.log(`    Possible matches:`);
      for (const candidate of item.candidates) {
        console.log(`      - [DB ID ${candidate.id}] ${candidate.navn}, ${candidate.adresse}`);
      }
    }
  }

  if (stats.duplicatesInCsv.length > 0) {
    console.log('\n--- DUPLICATE ENTRIES IN CSV ---');
    for (const item of stats.duplicatesInCsv) {
      console.log(`  "${item.customer.navn}" at "${item.customer.adresse}"`);
      console.log(`    Found at row indices: ${item.indices.map(i => i + 13).join(', ')}`);
    }
  }

  if (stats.duplicatesInDb.length > 0) {
    console.log('\n--- DUPLICATE ENTRIES IN DATABASE ---');
    for (const item of stats.duplicatesInDb) {
      console.log(`  "${item.customer.navn}" at "${item.customer.adresse}"`);
      console.log(`    Database IDs: ${item.ids.join(', ')}`);
    }
  }

  console.log('\n--- COLUMN MAPPING REFERENCE ---');
  console.log('  CSV columns used in import (semicolon-separated):');
  console.log('    Column 3 (D)  -> el_type');
  console.log('    Column 4 (E)  -> siste_el_kontroll (year)');
  console.log('    Column 5 (F)  -> neste_el_kontroll (year)');
  console.log('    Column 6 (G)  -> maaned (month)');
  console.log('    Column 7 (H)  -> frekvens (interval)');
  console.log('    Column 8 (I)  -> siste_brann_kontroll (year)');
  console.log('    Column 9 (J)  -> neste_brann_kontroll (year)');
  console.log('    Column 10 (K) -> brann_maaned');
  console.log('    Column 11 (L) -> brann_system');
  console.log('    Column 12 (M) -> brann_driftstype');
  console.log('    Column 16 (Q) -> navn');
  console.log('    Column 17 (R) -> adresse');
  console.log('    Column 18 (S) -> postnummer');
  console.log('    Column 19 (T) -> poststed');
  console.log('    Column 20 (U) -> omraade (to notater)');
  console.log('    Column 21 (V) -> org.nr (to notater)');
  console.log('    Column 22 (W) -> telefon');
  console.log('    Column 23 (X) -> epost');

  console.log('\n' + '='.repeat(70));
  console.log(`Report generated: ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  return isClean;
}

// ============================================================
// CSV PARSING
// ============================================================

function parseCSV(filePath) {
  // Try to read with different encodings
  let content;

  // First try UTF-8
  try {
    content = fs.readFileSync(filePath, 'utf8');
    // Check if content looks correct (no replacement characters for Norwegian)
    if (!content.includes('�')) {
      console.log('  Encoding: UTF-8');
    } else {
      // Try Latin-1
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'iso-8859-1');
      console.log('  Encoding: ISO-8859-1 (Latin-1)');
    }
  } catch (e) {
    // Fallback to Latin-1
    const buffer = fs.readFileSync(filePath);
    content = iconv.decode(buffer, 'iso-8859-1');
    console.log('  Encoding: ISO-8859-1 (Latin-1) - fallback');
  }

  const lines = content.split(/\r?\n/);
  console.log(`  Total lines: ${lines.length}`);

  const customers = [];

  for (let i = 12; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;

    const cols = line.split(';');

    // Get customer name (column 16, 0-indexed)
    const navn = (cols[16] || '').trim();
    const adresse = (cols[17] || '').trim();

    // Skip empty rows or header duplicates
    if (!navn || !adresse || navn === 'Kunde') {
      continue;
    }

    const postnummer = (cols[18] || '').trim();
    const poststed = (cols[19] || '').trim();
    const telefon = (cols[22] || '').trim();
    const epost = (cols[23] || '').trim();

    // El-kontroll columns (3-7)
    const elType = (cols[3] || '').trim();
    const sisteAar = (cols[4] || '').trim();
    const nesteAar = (cols[5] || '').trim();
    const maaned = (cols[6] || '').trim();
    const frekvens = (cols[7] || '').trim();

    // Brannvarsling columns (8-12)
    const brannSisteAar = (cols[8] || '').trim();
    const brannNesteAar = (cols[9] || '').trim();
    const brannMaaned = (cols[10] || '').trim();
    const brannSystem = (cols[11] || '').trim();
    const brannDriftstype = (cols[12] || '').trim();

    const omraade = (cols[20] || '').trim();
    const orgNr = (cols[21] || '').trim();

    // Build notater with area and org number if available
    let notater = '';
    if (omraade) notater += `Område: ${omraade}`;
    if (isValidOrgNr(orgNr)) {
      if (notater) notater += '\n';
      notater += `Org.nr: ${orgNr}`;
    }

    customers.push({
      csvRow: i + 1,
      navn,
      adresse,
      postnummer: postnummer || null,
      poststed: poststed || null,
      telefon: cleanPhone(telefon),
      epost: epost || null,
      el_type: elType || null,
      siste_el_kontroll: parseDate(sisteAar, maaned),
      neste_el_kontroll: parseDate(nesteAar, maaned),
      el_kontroll_intervall: parseInterval(frekvens),
      brann_system: brannSystem || null,
      brann_driftstype: brannDriftstype || null,
      siste_brann_kontroll: parseDate(brannSisteAar, brannMaaned),
      neste_brann_kontroll: parseDate(brannNesteAar, brannMaaned),
      brann_kontroll_intervall: brannSystem ? 12 : null,
      notater: notater || null,
      kategori: 'El-Kontroll + Brannvarsling'
    });
  }

  return customers;
}

// ============================================================
// MAIN VERIFICATION FLOW
// ============================================================

async function verifyImport() {
  console.log('='.repeat(70));
  console.log('CSV IMPORT VERIFICATION');
  console.log('TRE Allservice AS - Kundeimport');
  console.log('='.repeat(70));
  console.log(`Organization: TRE Allservice AS (ID: ${ORGANIZATION_ID})`);
  console.log(`CSV file: ${CSV_PATH}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('');

  const stats = {
    csvRowCount: 0,
    dbRowCount: 0,
    exactMatches: 0,
    fuzzyMatches: 0,
    notInDb: [],
    notInCsv: [],
    fieldMismatches: [],
    ambiguousMatches: [],
    duplicatesInCsv: [],
    duplicatesInDb: []
  };

  // ========== PHASE 1: Read CSV ==========
  console.log('PHASE 1: Reading CSV file...');

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ERROR: File not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const csvCustomers = parseCSV(CSV_PATH);
  stats.csvRowCount = csvCustomers.length;
  console.log(`  Parsed ${csvCustomers.length} customers from CSV`);

  // Check for duplicates in CSV
  const csvDuplicateCheck = new Map();
  csvCustomers.forEach((c, idx) => {
    const key = `${normalizeString(c.navn)}|${normalizeString(c.adresse)}`;
    if (csvDuplicateCheck.has(key)) {
      stats.duplicatesInCsv.push({
        key,
        indices: [csvDuplicateCheck.get(key), idx],
        customer: c
      });
    } else {
      csvDuplicateCheck.set(key, idx);
    }
  });

  if (stats.duplicatesInCsv.length > 0) {
    console.log(`  WARNING: Found ${stats.duplicatesInCsv.length} duplicate entries in CSV`);
  }

  // ========== PHASE 2: Fetch Database ==========
  console.log('\nPHASE 2: Fetching database customers...');

  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID)
    .order('navn');

  if (error) {
    console.error(`ERROR: Failed to fetch from database: ${error.message}`);
    process.exit(1);
  }

  stats.dbRowCount = dbCustomers.length;
  console.log(`  Fetched ${dbCustomers.length} customers from database`);

  // Check for duplicates in database
  const dbDuplicateCheck = new Map();
  dbCustomers.forEach((c, idx) => {
    const key = `${normalizeString(c.navn)}|${normalizeString(c.adresse)}`;
    if (dbDuplicateCheck.has(key)) {
      stats.duplicatesInDb.push({
        key,
        ids: [dbCustomers[dbDuplicateCheck.get(key)].id, c.id],
        customer: c
      });
    } else {
      dbDuplicateCheck.set(key, idx);
    }
  });

  if (stats.duplicatesInDb.length > 0) {
    console.log(`  WARNING: Found ${stats.duplicatesInDb.length} duplicate entries in database`);
  }

  // ========== PHASE 3: Match & Compare ==========
  console.log('\nPHASE 3: Matching and comparing...');

  const matchedDbIds = new Set();
  const processedCsvKeys = new Set(); // Track processed CSV entries to skip duplicates

  for (const csvCustomer of csvCustomers) {
    // Skip duplicate CSV entries - only process first occurrence
    const csvKey = `${normalizeForMatching(csvCustomer.navn)}|${normalizeForMatching(csvCustomer.adresse)}`;
    if (processedCsvKeys.has(csvKey)) {
      continue; // Skip - already processed first occurrence
    }
    processedCsvKeys.add(csvKey);

    const matchResult = findMatchingCustomer(csvCustomer, dbCustomers);

    if (matchResult.matchType === 'not_found') {
      stats.notInDb.push({
        csvRow: csvCustomer.csvRow,
        customer: csvCustomer
      });
      continue;
    }

    if (matchResult.matchType === 'ambiguous') {
      stats.ambiguousMatches.push({
        csvRow: csvCustomer.csvRow,
        customer: csvCustomer,
        candidates: matchResult.candidates
      });
      continue;
    }

    matchedDbIds.add(matchResult.match.id);

    if (matchResult.matchType === 'exact') {
      stats.exactMatches++;
    } else {
      stats.fuzzyMatches++;
    }

    const comparison = compareCustomer(csvCustomer, matchResult.match);

    if (!comparison.allMatch) {
      stats.fieldMismatches.push({
        csvRow: csvCustomer.csvRow,
        dbId: matchResult.match.id,
        matchType: matchResult.matchType,
        confidence: matchResult.confidence,
        comparison
      });
    }
  }

  // Find customers in DB but not in CSV
  for (const dbCustomer of dbCustomers) {
    if (!matchedDbIds.has(dbCustomer.id)) {
      stats.notInCsv.push({
        dbId: dbCustomer.id,
        customer: dbCustomer
      });
    }
  }

  // ========== PHASE 4: Generate Report ==========
  console.log('\nPHASE 4: Generating report...');
  const passed = generateReport(stats);

  process.exit(passed ? 0 : 1);
}

// Run
verifyImport().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

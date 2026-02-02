/**
 * Bulletproof verification script for TRE Allservice customer import
 * Compares Excel source file against database to ensure all data is correct
 *
 * Usage:
 *   node scripts/verify-import.mjs
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// xlsx requires special import for ESM (CommonJS module)
import xlsx from 'xlsx';
const { readFile, utils } = xlsx;

// Configuration
const ORGANIZATION_ID = 5; // TRE Allservice AS
const XLSX_PATH = path.resolve(process.cwd(), '../../El-kontroll og brannvarsling 12.3.25-DESKTOP-9CTDHSK.xlsx');

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

function findMatchingCustomer(excelCustomer, dbCustomers) {
  const excelName = normalizeString(excelCustomer.navn);
  const excelAddr = normalizeString(excelCustomer.adresse);

  // 1. Exact match on name + address
  const exactMatch = dbCustomers.find(db => {
    return normalizeString(db.navn) === excelName &&
           normalizeString(db.adresse) === excelAddr;
  });

  if (exactMatch) {
    return { match: exactMatch, matchType: 'exact', confidence: 1.0 };
  }

  // 2. Fuzzy match on name + exact address
  const fuzzyNameMatches = dbCustomers.filter(db => {
    const nameSim = calculateSimilarity(db.navn, excelCustomer.navn);
    const addrMatch = normalizeString(db.adresse) === excelAddr;
    return nameSim >= 0.9 && addrMatch;
  });

  if (fuzzyNameMatches.length === 1) {
    const sim = calculateSimilarity(fuzzyNameMatches[0].navn, excelCustomer.navn);
    return { match: fuzzyNameMatches[0], matchType: 'fuzzy_name', confidence: sim };
  }

  // 3. Exact name + fuzzy address
  const fuzzyAddrMatches = dbCustomers.filter(db => {
    const nameMatch = normalizeString(db.navn) === excelName;
    const addrSim = calculateSimilarity(db.adresse, excelCustomer.adresse);
    return nameMatch && addrSim >= 0.9;
  });

  if (fuzzyAddrMatches.length === 1) {
    const sim = calculateSimilarity(fuzzyAddrMatches[0].adresse, excelCustomer.adresse);
    return { match: fuzzyAddrMatches[0], matchType: 'fuzzy_addr', confidence: sim };
  }

  // 4. Check for multiple potential matches (ambiguous)
  const allCandidates = dbCustomers.filter(db => {
    const nameSim = calculateSimilarity(db.navn, excelCustomer.navn);
    const addrSim = calculateSimilarity(db.adresse, excelCustomer.adresse);
    return nameSim >= 0.8 && addrSim >= 0.8;
  });

  if (allCandidates.length > 1) {
    return { match: null, matchType: 'ambiguous', candidates: allCandidates };
  }

  if (allCandidates.length === 1) {
    const nameSim = calculateSimilarity(allCandidates[0].navn, excelCustomer.navn);
    const addrSim = calculateSimilarity(allCandidates[0].adresse, excelCustomer.adresse);
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

function compareField(fieldName, excelValue, dbValue, normalizer = normalizeString) {
  const normalizedExcel = normalizer(excelValue);
  const normalizedDb = normalizer(dbValue);

  if (!normalizedExcel && !normalizedDb) {
    return {
      field: fieldName,
      match: true,
      status: 'both_empty',
      excel: excelValue,
      db: dbValue
    };
  }

  if (!normalizedExcel && normalizedDb) {
    return {
      field: fieldName,
      match: false,
      status: 'excel_empty',
      excel: excelValue,
      db: dbValue,
      normalizedExcel,
      normalizedDb
    };
  }

  if (normalizedExcel && !normalizedDb) {
    return {
      field: fieldName,
      match: false,
      status: 'db_empty',
      excel: excelValue,
      db: dbValue,
      normalizedExcel,
      normalizedDb
    };
  }

  const isMatch = normalizedExcel === normalizedDb;

  return {
    field: fieldName,
    match: isMatch,
    status: isMatch ? 'match' : 'mismatch',
    excel: excelValue,
    db: dbValue,
    normalizedExcel,
    normalizedDb,
    similarity: isMatch ? 1.0 : calculateSimilarity(String(normalizedExcel), String(normalizedDb))
  };
}

function compareCustomer(excelCustomer, dbCustomer) {
  const comparisons = [];

  // Core fields
  comparisons.push(compareField('navn', excelCustomer.navn, dbCustomer.navn));
  comparisons.push(compareField('adresse', excelCustomer.adresse, dbCustomer.adresse));
  comparisons.push(compareField('postnummer', excelCustomer.postnummer, dbCustomer.postnummer));
  comparisons.push(compareField('poststed', excelCustomer.poststed, dbCustomer.poststed));

  // Contact fields
  comparisons.push(compareField('telefon', excelCustomer.telefon, dbCustomer.telefon, normalizePhone));
  comparisons.push(compareField('epost', excelCustomer.epost, dbCustomer.epost, normalizeEmail));

  // Service fields
  comparisons.push(compareField('el_type', excelCustomer.el_type, dbCustomer.el_type));
  comparisons.push(compareField('kategori', excelCustomer.kategori, dbCustomer.kategori));

  // Date fields
  comparisons.push(compareField('siste_el_kontroll',
    excelCustomer.siste_el_kontroll, dbCustomer.siste_el_kontroll, normalizeDate));
  comparisons.push(compareField('neste_el_kontroll',
    excelCustomer.neste_el_kontroll, dbCustomer.neste_el_kontroll, normalizeDate));

  // Interval fields
  comparisons.push(compareField('el_kontroll_intervall',
    excelCustomer.el_kontroll_intervall, dbCustomer.el_kontroll_intervall,
    v => v != null ? Number(v) : null));
  comparisons.push(compareField('brann_kontroll_intervall',
    excelCustomer.brann_kontroll_intervall, dbCustomer.brann_kontroll_intervall,
    v => v != null ? Number(v) : null));

  // Notes field
  comparisons.push(compareField('notater', excelCustomer.notater, dbCustomer.notater,
    str => str ? normalizeString(str.replace(/\n/g, ' ')) : null));

  return {
    excelCustomer,
    dbCustomer,
    comparisons,
    allMatch: comparisons.every(c => c.match),
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
  console.log('VERIFICATION REPORT');
  console.log('='.repeat(70));

  console.log('\n--- SUMMARY ---');
  console.log(`Excel records:        ${stats.excelRowCount}`);
  console.log(`Database records:     ${stats.dbRowCount}`);
  console.log(`Exact matches:        ${stats.exactMatches}`);
  console.log(`Fuzzy matches:        ${stats.fuzzyMatches}`);
  console.log(`Not in database:      ${stats.notInDb.length}`);
  console.log(`Not in Excel:         ${stats.notInExcel.length}`);
  console.log(`Field mismatches:     ${stats.fieldMismatches.length}`);
  console.log(`Ambiguous matches:    ${stats.ambiguousMatches.length}`);
  console.log(`Duplicates in Excel:  ${stats.duplicatesInExcel.length}`);
  console.log(`Duplicates in DB:     ${stats.duplicatesInDb.length}`);

  const isClean = stats.notInDb.length === 0 &&
                  stats.notInExcel.length === 0 &&
                  stats.fieldMismatches.length === 0 &&
                  stats.ambiguousMatches.length === 0;

  console.log('\n--- VERIFICATION STATUS ---');
  if (isClean) {
    console.log('STATUS: PASSED - All records match perfectly!');
  } else {
    console.log('STATUS: FAILED - Discrepancies found (see details below)');
  }

  if (stats.notInDb.length > 0) {
    console.log('\n--- CUSTOMERS IN EXCEL BUT NOT IN DATABASE ---');
    for (const item of stats.notInDb) {
      console.log(`  [Row ${item.excelRow}] ${item.customer.navn}`);
      console.log(`    Address: ${item.customer.adresse}, ${item.customer.postnummer} ${item.customer.poststed}`);
      console.log(`    Phone: ${item.customer.telefon || '(none)'}`);
    }
  }

  if (stats.notInExcel.length > 0) {
    console.log('\n--- CUSTOMERS IN DATABASE BUT NOT IN EXCEL ---');
    for (const item of stats.notInExcel) {
      console.log(`  [DB ID ${item.dbId}] ${item.customer.navn}`);
      console.log(`    Address: ${item.customer.adresse}, ${item.customer.postnummer} ${item.customer.poststed}`);
    }
  }

  if (stats.fieldMismatches.length > 0) {
    console.log('\n--- FIELD MISMATCHES ---');
    for (const item of stats.fieldMismatches) {
      console.log(`\n  [Row ${item.excelRow} <-> DB ID ${item.dbId}] ${item.comparison.excelCustomer.navn}`);
      console.log(`    Match type: ${item.matchType} (confidence: ${(item.confidence * 100).toFixed(1)}%)`);

      for (const mismatch of item.comparison.mismatches) {
        console.log(`    MISMATCH: ${mismatch.field}`);
        console.log(`      Excel: "${mismatch.excel}" -> normalized: "${mismatch.normalizedExcel}"`);
        console.log(`      DB:    "${mismatch.db}" -> normalized: "${mismatch.normalizedDb}"`);
        if (mismatch.similarity !== undefined && mismatch.similarity < 1) {
          console.log(`      Similarity: ${(mismatch.similarity * 100).toFixed(1)}%`);
        }
      }
    }
  }

  if (stats.ambiguousMatches.length > 0) {
    console.log('\n--- AMBIGUOUS MATCHES (MANUAL REVIEW NEEDED) ---');
    for (const item of stats.ambiguousMatches) {
      console.log(`\n  [Row ${item.excelRow}] ${item.customer.navn}`);
      console.log(`    Address: ${item.customer.adresse}`);
      console.log(`    Possible matches:`);
      for (const candidate of item.candidates) {
        console.log(`      - [DB ID ${candidate.id}] ${candidate.navn}, ${candidate.adresse}`);
      }
    }
  }

  if (stats.duplicatesInExcel.length > 0) {
    console.log('\n--- DUPLICATE ENTRIES IN EXCEL ---');
    for (const item of stats.duplicatesInExcel) {
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
  console.log('  Excel columns used in import:');
  console.log('    Column 4 (D)  -> el_type');
  console.log('    Column 5 (E)  -> siste_el_kontroll (year)');
  console.log('    Column 6 (F)  -> neste_el_kontroll (year)');
  console.log('    Column 7 (G)  -> maaned (month)');
  console.log('    Column 8 (H)  -> frekvens (interval)');
  console.log('    Column 17 (Q) -> navn');
  console.log('    Column 18 (R) -> adresse');
  console.log('    Column 19 (S) -> postnummer');
  console.log('    Column 20 (T) -> poststed');
  console.log('    Column 21 (U) -> omraade (to notater)');
  console.log('    Column 22 (V) -> org.nr (to notater)');
  console.log('    Column 23 (W) -> telefon');
  console.log('    Column 24 (X) -> epost');

  console.log('\n' + '='.repeat(70));
  console.log(`Report generated: ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  return isClean;
}

// ============================================================
// MAIN VERIFICATION FLOW
// ============================================================

async function verifyImport() {
  console.log('='.repeat(70));
  console.log('BULLETPROOF IMPORT VERIFICATION');
  console.log('TRE Allservice AS - Kundeimport');
  console.log('='.repeat(70));
  console.log(`Organization: TRE Allservice AS (ID: ${ORGANIZATION_ID})`);
  console.log(`Excel file: ${XLSX_PATH}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('');

  const stats = {
    excelRowCount: 0,
    dbRowCount: 0,
    exactMatches: 0,
    fuzzyMatches: 0,
    notInDb: [],
    notInExcel: [],
    fieldMismatches: [],
    ambiguousMatches: [],
    duplicatesInExcel: [],
    duplicatesInDb: []
  };

  // ========== PHASE 1: Read Excel ==========
  console.log('PHASE 1: Reading Excel file...');

  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`ERROR: File not found: ${XLSX_PATH}`);
    process.exit(1);
  }

  const workbook = readFile(XLSX_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  console.log(`  Sheet: "${sheetName}"`);
  console.log(`  Total rows: ${rawData.length}`);

  const excelCustomers = [];

  for (let i = 12; i < rawData.length; i++) {
    const cols = rawData[i];
    if (!cols || cols.length === 0) continue;

    const navn = String(cols[16] || '').trim();
    const adresse = String(cols[17] || '').trim();

    if (!navn || !adresse || navn === 'Kunde') continue;

    const postnummer = String(cols[18] || '').trim();
    const poststed = String(cols[19] || '').trim();
    const telefon = String(cols[22] || '').trim();
    const epost = String(cols[23] || '').trim();
    const elType = String(cols[3] || '').trim();
    const sisteAar = String(cols[4] || '').trim();
    const nesteAar = String(cols[5] || '').trim();
    const maaned = String(cols[6] || '').trim();
    const frekvens = String(cols[7] || '').trim();
    const omraade = String(cols[20] || '').trim();
    const orgNr = String(cols[21] || '').trim();

    let notater = '';
    if (omraade) notater += `Område: ${omraade}`;
    if (isValidOrgNr(orgNr)) {
      if (notater) notater += '\n';
      notater += `Org.nr: ${orgNr}`;
    }

    excelCustomers.push({
      excelRow: i + 1,
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
      notater: notater || null,
      kategori: 'El-Kontroll + Brannvarsling',
      brann_kontroll_intervall: 12
    });
  }

  stats.excelRowCount = excelCustomers.length;
  console.log(`  Parsed ${excelCustomers.length} customers from Excel`);

  // Check for duplicates in Excel
  const excelDuplicateCheck = new Map();
  excelCustomers.forEach((c, idx) => {
    const key = `${normalizeString(c.navn)}|${normalizeString(c.adresse)}`;
    if (excelDuplicateCheck.has(key)) {
      stats.duplicatesInExcel.push({
        key,
        indices: [excelDuplicateCheck.get(key), idx],
        customer: c
      });
    } else {
      excelDuplicateCheck.set(key, idx);
    }
  });

  if (stats.duplicatesInExcel.length > 0) {
    console.log(`  WARNING: Found ${stats.duplicatesInExcel.length} duplicate entries in Excel`);
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

  for (const excelCustomer of excelCustomers) {
    const matchResult = findMatchingCustomer(excelCustomer, dbCustomers);

    if (matchResult.matchType === 'not_found') {
      stats.notInDb.push({
        excelRow: excelCustomer.excelRow,
        customer: excelCustomer
      });
      continue;
    }

    if (matchResult.matchType === 'ambiguous') {
      stats.ambiguousMatches.push({
        excelRow: excelCustomer.excelRow,
        customer: excelCustomer,
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

    const comparison = compareCustomer(excelCustomer, matchResult.match);

    if (!comparison.allMatch) {
      stats.fieldMismatches.push({
        excelRow: excelCustomer.excelRow,
        dbId: matchResult.match.id,
        matchType: matchResult.matchType,
        confidence: matchResult.confidence,
        comparison
      });
    }
  }

  // Find customers in DB but not in Excel
  for (const dbCustomer of dbCustomers) {
    if (!matchedDbIds.has(dbCustomer.id)) {
      stats.notInExcel.push({
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

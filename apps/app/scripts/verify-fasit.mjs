/**
 * Verifiserer database mot fasit-fil
 * Fasit: El-kontroll og brannvarsling 01.02.26.csv
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import iconv from 'iconv-lite';

const FASIT_PATH = path.resolve(process.cwd(), '../../El-kontroll og brannvarsling 01.02.26.csv');
const ORGANIZATION_ID = 5;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Mangler SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Månedsmapping
const MONTH_MAP = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
  'mai': 5, 'jun': 6, 'jul': 7, 'aug': 8,
  'sep': 9, 'okt': 10, 'nov': 11, 'des': 12,
  'mars': 3, 'sept': 9
};

// Parse CSV line respecting quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseMonth(str) {
  if (!str) return 1;
  // Handle "2-Feb" format
  const match = str.match(/(\d+)?-?(\w+)/i);
  if (match && match[2]) {
    const monthName = match[2].toLowerCase().substring(0, 3);
    return MONTH_MAP[monthName] || 1;
  }
  return 1;
}

function parseYear(str) {
  if (!str || str === 'x') return null;
  // Handle "2024 (03)" format - extract just the year
  const match = str.match(/(\d{4})/);
  if (match) return parseInt(match[1]);
  return null;
}

function parseDate(yearStr, monthStr) {
  const year = parseYear(yearStr);
  if (!year) return null;
  const month = parseMonth(monthStr);
  return `${year}-${month.toString().padStart(2, '0')}-01`;
}

function parseInterval(frekvensStr) {
  if (!frekvensStr) return null;
  const num = parseInt(frekvensStr);
  if (!isNaN(num) && num > 0 && num <= 10) {
    return num * 12; // Convert years to months
  }
  return null;
}

function normalizeString(str) {
  if (!str) return null;
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/[\s\-\.]/g, '').replace(/^\+47/, '');
}

async function main() {
  console.log('='.repeat(70));
  console.log('VERIFISERING MOT FASIT');
  console.log('Fil: El-kontroll og brannvarsling 01.02.26.csv');
  console.log('='.repeat(70));

  // Read CSV with correct encoding
  const buffer = fs.readFileSync(FASIT_PATH);
  const content = iconv.decode(buffer, 'ISO-8859-1');
  const lines = content.split(/\r?\n/);

  console.log(`\nLeser fasit-fil: ${lines.length} linjer`);

  // Column mapping (0-indexed):
  // 2: el_type (Type)
  // 3: siste_el_kontroll (år)
  // 4: neste_el_kontroll (år)
  // 5: måned (el)
  // 6: frekvens
  // 8: siste_brann_kontroll (år)
  // 9: neste_brann_kontroll (år)
  // 10: måned (brann)
  // 11: brann_system (Type)
  // 13: brann_driftstype (Drift)
  // 14: tripletex_id (Trip)
  // 17: dag
  // 18: notater/kommentar
  // 19: kunde (navn)
  // 20: adresse
  // 21: postnummer
  // 22: poststed
  // 23: område
  // 24: org_nr

  // Parse customers from CSV (data starts at row 13, index 12)
  const fasitCustomers = [];

  for (let i = 12; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 20) continue;

    const navn = (cols[19] || '').trim();
    const adresse = (cols[20] || '').trim();

    if (!navn || navn === 'Kunde' || navn === 'Adresse') continue;
    // Skip rows that look like headers or garbage
    if (navn.includes('Har prøvd å finne') || navn.includes('lurer jeg på')) continue;

    // Determine category based on data
    const hasEl = Boolean(cols[2]?.trim() || cols[3]?.trim() || cols[4]?.trim());
    const hasBrann = Boolean(cols[8]?.trim() || cols[9]?.trim() || cols[11]?.trim());

    let kategori;
    if (hasEl && hasBrann) kategori = 'El-Kontroll + Brannvarsling';
    else if (hasBrann) kategori = 'Brannvarsling';
    else kategori = 'El-Kontroll';

    fasitCustomers.push({
      row: i + 1,
      navn,
      adresse,
      postnummer: (cols[21] || '').trim() || null,
      poststed: (cols[22] || '').trim() || null,
      el_type: (cols[2] || '').trim() || null,
      siste_el_kontroll: parseDate(cols[3], cols[5]),
      neste_el_kontroll: parseDate(cols[4], cols[5]),
      el_kontroll_intervall: parseInterval(cols[6]),
      siste_brann_kontroll: parseDate(cols[8], cols[10]),
      neste_brann_kontroll: parseDate(cols[9], cols[10]),
      brann_system: (cols[11] || '').trim() || null,
      brann_driftstype: (cols[13] || '').trim() || null,
      tripletex_id: (cols[14] || '').trim() || null,
      dag: (cols[17] || '').trim() || null,
      notater: (cols[18] || '').trim() || null,
      org_nr: (cols[24] || '').trim() || null,
      kategori
    });
  }

  console.log(`Parsede kunder fra fasit: ${fasitCustomers.length}`);

  // Fetch from database
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID);

  if (error) {
    console.error('Database-feil:', error.message);
    process.exit(1);
  }

  console.log(`Kunder i database: ${dbCustomers.length}`);

  // Compare
  const issues = {
    missingInDb: [],
    missingInFasit: [],
    fieldMismatches: []
  };

  const matchedDbIds = new Set();

  for (const fasit of fasitCustomers) {
    // Find matching customer in DB by name
    const dbMatch = dbCustomers.find(db =>
      normalizeString(db.navn) === normalizeString(fasit.navn)
    );

    if (!dbMatch) {
      issues.missingInDb.push(fasit);
      continue;
    }

    matchedDbIds.add(dbMatch.id);

    // Compare fields
    const mismatches = [];

    // Compare kategori
    if (normalizeString(dbMatch.kategori) !== normalizeString(fasit.kategori)) {
      mismatches.push({
        field: 'kategori',
        fasit: fasit.kategori,
        db: dbMatch.kategori
      });
    }

    // Compare el_type
    if (fasit.el_type && normalizeString(dbMatch.el_type) !== normalizeString(fasit.el_type)) {
      mismatches.push({
        field: 'el_type',
        fasit: fasit.el_type,
        db: dbMatch.el_type
      });
    }

    // Compare dates
    if (fasit.siste_el_kontroll && dbMatch.siste_el_kontroll !== fasit.siste_el_kontroll) {
      mismatches.push({
        field: 'siste_el_kontroll',
        fasit: fasit.siste_el_kontroll,
        db: dbMatch.siste_el_kontroll
      });
    }

    if (fasit.neste_el_kontroll && dbMatch.neste_el_kontroll !== fasit.neste_el_kontroll) {
      mismatches.push({
        field: 'neste_el_kontroll',
        fasit: fasit.neste_el_kontroll,
        db: dbMatch.neste_el_kontroll
      });
    }

    if (fasit.siste_brann_kontroll && dbMatch.siste_brann_kontroll !== fasit.siste_brann_kontroll) {
      mismatches.push({
        field: 'siste_brann_kontroll',
        fasit: fasit.siste_brann_kontroll,
        db: dbMatch.siste_brann_kontroll
      });
    }

    if (fasit.neste_brann_kontroll && dbMatch.neste_brann_kontroll !== fasit.neste_brann_kontroll) {
      mismatches.push({
        field: 'neste_brann_kontroll',
        fasit: fasit.neste_brann_kontroll,
        db: dbMatch.neste_brann_kontroll
      });
    }

    // Compare intervals
    if (fasit.el_kontroll_intervall && dbMatch.el_kontroll_intervall !== fasit.el_kontroll_intervall) {
      mismatches.push({
        field: 'el_kontroll_intervall',
        fasit: fasit.el_kontroll_intervall,
        db: dbMatch.el_kontroll_intervall
      });
    }

    // Compare brann_system
    if (fasit.brann_system && normalizeString(dbMatch.brann_system) !== normalizeString(fasit.brann_system)) {
      mismatches.push({
        field: 'brann_system',
        fasit: fasit.brann_system,
        db: dbMatch.brann_system
      });
    }

    // Compare brann_driftstype
    if (fasit.brann_driftstype && normalizeString(dbMatch.brann_driftstype) !== normalizeString(fasit.brann_driftstype)) {
      mismatches.push({
        field: 'brann_driftstype',
        fasit: fasit.brann_driftstype,
        db: dbMatch.brann_driftstype
      });
    }

    if (mismatches.length > 0) {
      issues.fieldMismatches.push({
        navn: fasit.navn,
        row: fasit.row,
        dbId: dbMatch.id,
        mismatches
      });
    }
  }

  // Find customers in DB but not in fasit
  for (const db of dbCustomers) {
    if (!matchedDbIds.has(db.id)) {
      issues.missingInFasit.push(db);
    }
  }

  // Report
  console.log('\n' + '='.repeat(70));
  console.log('RESULTAT');
  console.log('='.repeat(70));

  console.log(`\nKunder i fasit: ${fasitCustomers.length}`);
  console.log(`Kunder i database: ${dbCustomers.length}`);
  console.log(`Matchede: ${matchedDbIds.size}`);

  if (issues.missingInDb.length > 0) {
    console.log(`\n--- MANGLER I DATABASE (${issues.missingInDb.length}) ---`);
    for (const c of issues.missingInDb) {
      console.log(`  [Rad ${c.row}] ${c.navn}`);
      console.log(`    Adresse: ${c.adresse}`);
      console.log(`    Kategori: ${c.kategori}`);
    }
  }

  if (issues.missingInFasit.length > 0) {
    console.log(`\n--- I DATABASE MEN IKKE I FASIT (${issues.missingInFasit.length}) ---`);
    for (const c of issues.missingInFasit) {
      console.log(`  [ID ${c.id}] ${c.navn}`);
      console.log(`    Adresse: ${c.adresse}`);
    }
  }

  if (issues.fieldMismatches.length > 0) {
    console.log(`\n--- FELTAVVIK (${issues.fieldMismatches.length} kunder) ---`);
    for (const item of issues.fieldMismatches) {
      console.log(`\n  ${item.navn} (Rad ${item.row}, DB ID ${item.dbId}):`);
      for (const m of item.mismatches) {
        console.log(`    ${m.field}:`);
        console.log(`      Fasit: "${m.fasit}"`);
        console.log(`      DB:    "${m.db}"`);
      }
    }
  }

  const totalIssues = issues.missingInDb.length + issues.missingInFasit.length + issues.fieldMismatches.length;

  console.log('\n' + '='.repeat(70));
  if (totalIssues === 0) {
    console.log('STATUS: ALT OK - Alle data matcher!');
  } else {
    console.log(`STATUS: ${totalIssues} problemer funnet`);
  }
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Feil:', err);
  process.exit(1);
});

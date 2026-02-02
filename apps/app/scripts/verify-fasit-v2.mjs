/**
 * Korrekt verifisering av database mot fasit
 *
 * Kolonnemapping (0-indeksert):
 * 2:  el_type (Landbruk/Næring/Bolig) - kundetypen, ikke om de har el-kontroll!
 * 3:  siste_el_kontroll (år)
 * 4:  neste_el_kontroll (år)
 * 5:  måned (for el-kontroll)
 * 6:  frekvens (intervall i år)
 * 8:  siste_brann_kontroll (år)
 * 9:  neste_brann_kontroll (år)
 * 10: måned (for brann)
 * 11: brann_system
 * 13: brann_driftstype
 * 14: tripletex_id
 * 17: dag
 * 18: kommentar
 * 19: navn
 * 20: adresse
 * 21: postnummer
 * 22: poststed
 * 23: område
 * 24: org_nr
 * 26: telefon
 * 27: epost
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
const supabase = createClient(supabaseUrl, supabaseKey);

const MONTH_MAP = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
  'mai': 5, 'jun': 6, 'jul': 7, 'aug': 8,
  'sep': 9, 'okt': 10, 'nov': 11, 'des': 12
};

// Robust CSV parser that handles quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseMonth(str) {
  if (!str) return null;
  // Handle formats: "2-Feb", "Feb", "februar"
  const match = str.match(/(\d+)?-?(\w+)/i);
  if (match && match[2]) {
    const monthName = match[2].toLowerCase().substring(0, 3);
    return MONTH_MAP[monthName] || null;
  }
  return null;
}

function parseYear(str) {
  if (!str || str === 'x') return null;
  // Handle "2024 (03)" format
  const match = str.match(/^(\d{4})/);
  if (match) return parseInt(match[1]);
  return null;
}

function parseDate(yearStr, monthStr) {
  const year = parseYear(yearStr);
  if (!year) return null;
  const month = parseMonth(monthStr) || 2; // Default to February if no month
  return `${year}-${month.toString().padStart(2, '0')}-01`;
}

function parseInterval(frekvensStr) {
  if (!frekvensStr) return null;
  const num = parseInt(frekvensStr);
  if (!isNaN(num) && num > 0 && num <= 10) {
    return num * 12;
  }
  return null;
}

function normalizeString(str) {
  if (!str) return '';
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  console.log('='.repeat(70));
  console.log('VERIFISERING V2 - KORREKT KATEGORISERING');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(FASIT_PATH);
  const content = iconv.decode(buffer, 'ISO-8859-1');
  const lines = content.split(/\r?\n/);

  console.log(`\nLeser fasit: ${lines.length} linjer`);

  const fasitCustomers = [];
  for (let i = 12; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 20) continue;

    const navn = (cols[19] || '').trim();
    const adresse = (cols[20] || '').trim();

    // Skip headers and garbage
    if (!navn || navn === 'Kunde' || navn.length < 3) continue;
    if (navn.includes('Har prøvd') || navn.includes('Jeg er i ferd') ||
        navn.includes('Jeg kan i tillegg') || navn.includes('Det å samle') ||
        navn.includes('Jeg ønsker') || navn.includes('Alternativt') ||
        navn.includes('Mvh ')) continue;

    // KORREKT kategorisering:
    // - hasEl = har faktiske el-kontroll datoer (col 3 eller 4)
    // - hasBrann = har faktiske brann datoer (col 8 eller 9)
    const sisteElYear = (cols[3] || '').trim();
    const nesteElYear = (cols[4] || '').trim();
    const sisteBrannYear = (cols[8] || '').trim();
    const nesteBrannYear = (cols[9] || '').trim();

    const hasEl = Boolean(parseYear(sisteElYear) || parseYear(nesteElYear));
    const hasBrann = Boolean(parseYear(sisteBrannYear) || parseYear(nesteBrannYear));

    let kategori;
    if (hasEl && hasBrann) kategori = 'El-Kontroll + Brannvarsling';
    else if (hasBrann) kategori = 'Brannvarsling';
    else if (hasEl) kategori = 'El-Kontroll';
    else kategori = null; // No service data

    if (!kategori) continue;

    const elMonth = (cols[5] || '').trim();
    const brannMonth = (cols[10] || '').trim();

    fasitCustomers.push({
      row: i + 1,
      navn,
      adresse,
      postnummer: (cols[21] || '').trim() || null,
      poststed: (cols[22] || '').trim() || null,
      el_type: (cols[2] || '').trim() || null,
      siste_el_kontroll: parseDate(sisteElYear, elMonth),
      neste_el_kontroll: parseDate(nesteElYear, elMonth),
      el_kontroll_intervall: parseInterval(cols[6]),
      siste_brann_kontroll: parseDate(sisteBrannYear, brannMonth),
      neste_brann_kontroll: parseDate(nesteBrannYear, brannMonth),
      brann_system: (cols[11] || '').trim() || null,
      brann_driftstype: (cols[13] || '').trim() || null,
      kategori,
      hasEl,
      hasBrann
    });
  }

  console.log(`Parsede kunder: ${fasitCustomers.length}`);

  // Category distribution in fasit
  const fasitDist = { 'El-Kontroll': 0, 'Brannvarsling': 0, 'El-Kontroll + Brannvarsling': 0 };
  fasitCustomers.forEach(c => fasitDist[c.kategori]++);
  console.log('\nFasit fordeling:');
  Object.entries(fasitDist).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Fetch DB
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID);

  if (error) {
    console.error('DB feil:', error.message);
    process.exit(1);
  }

  console.log(`\nDatabase kunder: ${dbCustomers.length}`);

  // DB distribution
  const dbDist = { 'El-Kontroll': 0, 'Brannvarsling': 0, 'El-Kontroll + Brannvarsling': 0 };
  dbCustomers.forEach(c => {
    if (dbDist[c.kategori] !== undefined) dbDist[c.kategori]++;
  });
  console.log('Database fordeling:');
  Object.entries(dbDist).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Compare
  const issues = {
    kategoriMismatch: [],
    datoMismatch: [],
    missingInDb: [],
    missingInFasit: []
  };

  const matchedDbIds = new Set();

  for (const fasit of fasitCustomers) {
    const dbMatch = dbCustomers.find(db => normalizeString(db.navn) === normalizeString(fasit.navn));

    if (!dbMatch) {
      issues.missingInDb.push(fasit);
      continue;
    }

    matchedDbIds.add(dbMatch.id);

    // Check kategori
    if (normalizeString(dbMatch.kategori) !== normalizeString(fasit.kategori)) {
      issues.kategoriMismatch.push({
        navn: fasit.navn,
        row: fasit.row,
        dbId: dbMatch.id,
        fasitKategori: fasit.kategori,
        dbKategori: dbMatch.kategori,
        hasEl: fasit.hasEl,
        hasBrann: fasit.hasBrann
      });
    }

    // Check dates (only if fasit has valid date)
    const dateChecks = [
      ['siste_el_kontroll', fasit.siste_el_kontroll, dbMatch.siste_el_kontroll],
      ['neste_el_kontroll', fasit.neste_el_kontroll, dbMatch.neste_el_kontroll],
      ['siste_brann_kontroll', fasit.siste_brann_kontroll, dbMatch.siste_brann_kontroll],
      ['neste_brann_kontroll', fasit.neste_brann_kontroll, dbMatch.neste_brann_kontroll]
    ];

    for (const [field, fasitVal, dbVal] of dateChecks) {
      if (fasitVal && fasitVal !== dbVal) {
        issues.datoMismatch.push({
          navn: fasit.navn,
          field,
          fasitVal,
          dbVal,
          dbId: dbMatch.id
        });
      }
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
  console.log('AVVIK');
  console.log('='.repeat(70));

  if (issues.kategoriMismatch.length > 0) {
    console.log(`\n--- KATEGORI AVVIK (${issues.kategoriMismatch.length}) ---`);
    for (const item of issues.kategoriMismatch.slice(0, 20)) {
      console.log(`  ${item.navn} (ID ${item.dbId})`);
      console.log(`    Fasit: ${item.fasitKategori} (hasEl=${item.hasEl}, hasBrann=${item.hasBrann})`);
      console.log(`    DB:    ${item.dbKategori}`);
    }
    if (issues.kategoriMismatch.length > 20) {
      console.log(`  ... og ${issues.kategoriMismatch.length - 20} flere`);
    }
  }

  if (issues.datoMismatch.length > 0) {
    console.log(`\n--- DATO AVVIK (${issues.datoMismatch.length}) ---`);
    for (const item of issues.datoMismatch.slice(0, 10)) {
      console.log(`  ${item.navn}: ${item.field}`);
      console.log(`    Fasit: ${item.fasitVal}`);
      console.log(`    DB:    ${item.dbVal}`);
    }
    if (issues.datoMismatch.length > 10) {
      console.log(`  ... og ${issues.datoMismatch.length - 10} flere`);
    }
  }

  if (issues.missingInDb.length > 0) {
    console.log(`\n--- MANGLER I DATABASE (${issues.missingInDb.length}) ---`);
    for (const item of issues.missingInDb) {
      console.log(`  ${item.navn} - ${item.adresse}`);
    }
  }

  if (issues.missingInFasit.length > 0) {
    console.log(`\n--- I DATABASE MEN IKKE I FASIT (${issues.missingInFasit.length}) ---`);
    for (const item of issues.missingInFasit) {
      console.log(`  [ID ${item.id}] ${item.navn}`);
    }
  }

  const total = issues.kategoriMismatch.length + issues.missingInDb.length + issues.missingInFasit.length;
  console.log('\n' + '='.repeat(70));
  console.log(`TOTALT: ${total} hovedproblemer (kategori/manglende)`);
  console.log(`        ${issues.datoMismatch.length} dato-avvik`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Feil:', err);
  process.exit(1);
});

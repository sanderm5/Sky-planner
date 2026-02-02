/**
 * Fix incorrect dates in the database for TRE Allservice customers
 * Reads the Excel file and updates all dates with correct months
 */

import 'dotenv/config';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import xlsx from 'xlsx';

const { readFile, utils } = xlsx;

const ORGANIZATION_ID = 5;
const XLSX_PATH = path.resolve(process.cwd(), '../../El-kontroll og brannvarsling 12.3.25-DESKTOP-9CTDHSK.xlsx');
const DRY_RUN = !process.argv.includes('--fix');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Month mapping - both Norwegian and English
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

  // Parse "09.sep" or "9-Sep" format
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

  const year = parseInt(String(yearStr).trim());
  if (isNaN(year) || year < 2000 || year > 2100) return null;

  const month = parseMonth(monthStr) || 1;
  return `${year}-${month.toString().padStart(2, '0')}-01`;
}

async function fixDates() {
  console.log('='.repeat(60));
  console.log('FIX DATES FOR TRE ALLSERVICE');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no changes)' : 'FIX'}`);
  console.log('');

  // Read Excel with raw: false to get formatted values
  const workbook = readFile(XLSX_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  console.log(`Excel rows: ${rawData.length}`);

  // Fetch all customers from DB
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID);

  if (error) {
    console.error('DB error:', error.message);
    process.exit(1);
  }

  console.log(`DB customers: ${dbCustomers.length}`);
  console.log('');

  let updated = 0;
  let skipped = 0;
  let notFound = 0;
  const updates = [];

  for (let i = 12; i < rawData.length; i++) {
    const row = rawData[i];
    const navn = String(row[16] || '').trim();
    const adresse = String(row[17] || '').trim();

    if (!navn || !adresse || navn === 'Kunde') continue;

    const sisteAar = String(row[4] || '').trim();
    const nesteAar = String(row[5] || '').trim();
    const maaned = String(row[6] || '').trim();

    const expectedSiste = parseDate(sisteAar, maaned);
    const expectedNeste = parseDate(nesteAar, maaned);

    // Find matching customer in DB
    const dbMatch = dbCustomers.find(c =>
      c.navn.toLowerCase().trim() === navn.toLowerCase() &&
      c.adresse.toLowerCase().trim() === adresse.toLowerCase()
    );

    if (!dbMatch) {
      notFound++;
      continue;
    }

    const dbSiste = dbMatch.siste_el_kontroll ? dbMatch.siste_el_kontroll.substring(0, 10) : null;
    const dbNeste = dbMatch.neste_el_kontroll ? dbMatch.neste_el_kontroll.substring(0, 10) : null;

    // Check if update needed
    if (expectedSiste !== dbSiste || expectedNeste !== dbNeste) {
      updates.push({
        id: dbMatch.id,
        navn: dbMatch.navn,
        excel: { sisteAar, nesteAar, maaned },
        expected: { siste: expectedSiste, neste: expectedNeste },
        current: { siste: dbSiste, neste: dbNeste }
      });
    } else {
      skipped++;
    }
  }

  console.log(`Updates needed: ${updates.length}`);
  console.log(`Already correct: ${skipped}`);
  console.log(`Not found in DB: ${notFound}`);
  console.log('');

  // Show first 10 updates
  console.log('=== UPDATES (first 10) ===');
  for (let i = 0; i < Math.min(10, updates.length); i++) {
    const u = updates[i];
    console.log(`\n[${u.id}] ${u.navn}`);
    console.log(`  Excel: år=${u.excel.sisteAar}/${u.excel.nesteAar}, måned=${u.excel.maaned}`);
    console.log(`  Current:  siste=${u.current.siste}, neste=${u.current.neste}`);
    console.log(`  Expected: siste=${u.expected.siste}, neste=${u.expected.neste}`);
  }

  if (DRY_RUN) {
    console.log('\n' + '='.repeat(60));
    console.log('DRY-RUN COMPLETE');
    console.log('Run with --fix to apply changes:');
    console.log('  node scripts/fix-dates.mjs --fix');
    console.log('='.repeat(60));
    return;
  }

  // Apply updates
  console.log('\n=== APPLYING UPDATES ===');

  for (const u of updates) {
    const updateData = {};
    if (u.expected.siste !== u.current.siste) {
      updateData.siste_el_kontroll = u.expected.siste;
    }
    if (u.expected.neste !== u.current.neste) {
      updateData.neste_el_kontroll = u.expected.neste;
    }

    const { error: updateError } = await supabase
      .from('kunder')
      .update(updateData)
      .eq('id', u.id);

    if (updateError) {
      console.log(`FAILED [${u.id}] ${u.navn}: ${updateError.message}`);
    } else {
      console.log(`OK [${u.id}] ${u.navn}`);
      updated++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('FIX COMPLETE');
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${updates.length - updated}`);
  console.log('='.repeat(60));
}

fixDates().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

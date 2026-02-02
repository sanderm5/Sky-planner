/**
 * Add brannvarsling data to existing customers from Excel
 *
 * Columns:
 *   [8]  Sist - year of last brann kontroll
 *   [9]  Neste - year of next brann kontroll
 *   [10] Måned - month for brann kontroll
 *   [11] Type - brann_system (e.g., "Elotec")
 *   [12] Drift - brann_driftstype (e.g., "Storfe")
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

// Month mapping
const MONTH_MAP = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
  'mai': 5, 'jun': 6, 'jul': 7, 'aug': 8,
  'sep': 9, 'spt': 9, 'okt': 10, 'nov': 11, 'des': 12,
  'mars': 3, 'may': 5, 'oct': 10, 'dec': 12
};

function parseMonth(monthStr) {
  if (!monthStr || monthStr === 'x' || monthStr === 'Måned') return null;
  const lower = monthStr.toLowerCase().trim();
  if (MONTH_MAP[lower]) return MONTH_MAP[lower];
  const match = lower.match(/(\d+)?[\.\-]?(\w+)/);
  if (match && match[2]) {
    return MONTH_MAP[match[2].substring(0, 3)] || null;
  }
  return null;
}

function parseDate(yearStr, monthStr) {
  if (!yearStr || yearStr === 'x' || yearStr === 'Sist' || yearStr === 'Neste') return null;
  const year = parseInt(String(yearStr).trim());
  if (isNaN(year) || year < 2000 || year > 2100) return null;
  const month = parseMonth(monthStr) || 1;
  return `${year}-${month.toString().padStart(2, '0')}-01`;
}

async function fixBrannvarsling() {
  console.log('='.repeat(60));
  console.log('ADD BRANNVARSLING DATA');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'FIX'}\n`);

  const workbook = readFile(XLSX_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  const { data: dbCustomers } = await supabase
    .from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID);

  console.log(`Excel rows: ${rawData.length}`);
  console.log(`DB customers: ${dbCustomers.length}\n`);

  const updates = [];
  let skipped = 0;
  let noData = 0;

  for (let i = 12; i < rawData.length; i++) {
    const row = rawData[i];
    const navn = String(row[16] || '').trim();
    const adresse = String(row[17] || '').trim();
    if (!navn || !adresse || navn === 'Kunde') continue;

    // Brannvarsling columns
    const brannSisteAar = String(row[8] || '').trim();
    const brannNesteAar = String(row[9] || '').trim();
    const brannMaaned = String(row[10] || '').trim();
    const brannSystem = String(row[11] || '').trim();
    const brannDriftstype = String(row[12] || '').trim();

    // Skip if no brannvarsling data
    if (!brannSisteAar && !brannNesteAar && !brannSystem) {
      noData++;
      continue;
    }

    const dbMatch = dbCustomers.find(c =>
      c.navn.toLowerCase().trim() === navn.toLowerCase() &&
      c.adresse.toLowerCase().trim() === adresse.toLowerCase()
    );

    if (!dbMatch) {
      continue;
    }

    const sisteBrann = parseDate(brannSisteAar, brannMaaned);
    const nesteBrann = parseDate(brannNesteAar, brannMaaned);

    // Check if update is needed
    const needsUpdate =
      (sisteBrann && dbMatch.siste_brann_kontroll !== sisteBrann) ||
      (nesteBrann && dbMatch.neste_brann_kontroll !== nesteBrann) ||
      (brannSystem && dbMatch.brann_system !== brannSystem) ||
      (brannDriftstype && dbMatch.brann_driftstype !== brannDriftstype);

    if (!needsUpdate) {
      skipped++;
      continue;
    }

    updates.push({
      id: dbMatch.id,
      navn: dbMatch.navn,
      excel: { brannSisteAar, brannNesteAar, brannMaaned, brannSystem, brannDriftstype },
      updateData: {
        ...(sisteBrann && { siste_brann_kontroll: sisteBrann }),
        ...(nesteBrann && { neste_brann_kontroll: nesteBrann }),
        ...(brannSystem && { brann_system: brannSystem }),
        ...(brannDriftstype && { brann_driftstype: brannDriftstype }),
        brann_kontroll_intervall: 12 // Default årlig
      }
    });
  }

  console.log(`Updates needed: ${updates.length}`);
  console.log(`Already correct: ${skipped}`);
  console.log(`No brann data in Excel: ${noData}\n`);

  // Show first 10 updates
  console.log('=== UPDATES (first 10) ===');
  for (let i = 0; i < Math.min(10, updates.length); i++) {
    const u = updates[i];
    console.log(`\n[${u.id}] ${u.navn}`);
    console.log(`  Excel: siste=${u.excel.brannSisteAar}, neste=${u.excel.brannNesteAar}, måned=${u.excel.brannMaaned}`);
    console.log(`  System: ${u.excel.brannSystem}, Driftstype: ${u.excel.brannDriftstype}`);
    console.log(`  Update: siste=${u.updateData.siste_brann_kontroll}, neste=${u.updateData.neste_brann_kontroll}`);
  }

  if (DRY_RUN) {
    console.log('\n' + '='.repeat(60));
    console.log('DRY-RUN COMPLETE');
    console.log('Run with --fix to apply:');
    console.log('  node scripts/fix-brannvarsling.mjs --fix');
    console.log('='.repeat(60));
    return;
  }

  // Apply updates
  console.log('\n=== APPLYING UPDATES ===');
  let updated = 0;

  for (const u of updates) {
    const { error } = await supabase
      .from('kunder')
      .update(u.updateData)
      .eq('id', u.id);

    if (error) {
      console.log(`FAILED [${u.id}] ${u.navn}: ${error.message}`);
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

fixBrannvarsling().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

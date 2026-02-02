/**
 * Sync customer categories from CSV file to database
 *
 * This script reads the CSV file, determines the correct category for each customer,
 * and updates the database to match.
 *
 * Usage:
 *   node scripts/sync-csv-categories.mjs              # Dry-run
 *   node scripts/sync-csv-categories.mjs --update     # Actually update
 */

import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = !process.argv.includes('--update');
const CSV_PATH = '../../El-kontroll og brannvarsling 12.3 (1).csv';

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Parse CSV file and extract customer categories
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const customers = {};

  for (let i = 12; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (cols.length < 17) continue;

    const kunde = (cols[16] || '').trim();
    if (!kunde || kunde === 'Kunde') continue;

    // El-kontroll data (cols 3-7)
    const elType = (cols[3] || '').trim();
    const elSiste = (cols[4] || '').trim();
    const elNeste = (cols[5] || '').trim();
    const elMaaned = (cols[6] || '').trim();
    const elFrekvens = (cols[7] || '').trim();

    const hasEl = Boolean(elType || elSiste || elNeste);

    // Brannvarsling data (cols 8-12)
    const brannSist = (cols[8] || '').trim();
    const brannNeste = (cols[9] || '').trim();
    const brannMaaned = (cols[10] || '').trim();
    const brannType = (cols[11] || '').trim();
    const brannDrift = (cols[12] || '').trim();

    const hasBrann = Boolean(brannSist || brannNeste || brannType || brannDrift);

    // Determine category
    let kategori;
    if (hasEl && hasBrann) {
      kategori = 'El-Kontroll + Brannvarsling';
    } else if (hasBrann) {
      kategori = 'Brannvarsling';
    } else if (hasEl) {
      kategori = 'El-Kontroll';
    } else {
      kategori = 'El-Kontroll'; // Default
    }

    customers[kunde] = {
      kategori,
      elType,
      elSiste,
      elNeste,
      elMaaned,
      elFrekvens: elFrekvens ? parseInt(elFrekvens) * 12 : 36, // Convert years to months
      brannSist,
      brannNeste,
      brannMaaned,
      brannType,
      brannDrift,
      hasEl,
      hasBrann
    };
  }

  return customers;
}

async function syncCategories() {
  console.log('='.repeat(60));
  console.log('SYNC CSV CATEGORIES TO DATABASE');
  console.log('='.repeat(60));
  console.log(`\nModus: ${DRY_RUN ? 'DRY-RUN (ingen endringer)' : 'UPDATE'}\n`);

  // Parse CSV
  console.log(`Reading CSV: ${CSV_PATH}`);
  const csvCustomers = parseCSV(CSV_PATH);

  // Count CSV distribution
  const csvDist = { 'El-Kontroll': 0, 'Brannvarsling': 0, 'El-Kontroll + Brannvarsling': 0 };
  for (const data of Object.values(csvCustomers)) {
    csvDist[data.kategori]++;
  }

  console.log(`\nCSV distribution (${Object.keys(csvCustomers).length} customers):`);
  console.log(`  El-Kontroll:                 ${csvDist['El-Kontroll']}`);
  console.log(`  Brannvarsling:               ${csvDist['Brannvarsling']}`);
  console.log(`  El-Kontroll + Brannvarsling: ${csvDist['El-Kontroll + Brannvarsling']}`);

  // Fetch all customers from database
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('id, navn, kategori, el_type, brann_system, brann_driftstype');

  if (error) {
    console.error('Error fetching customers:', error);
    process.exit(1);
  }

  // Count DB distribution
  const dbDist = { 'El-Kontroll': 0, 'Brannvarsling': 0, 'El-Kontroll + Brannvarsling': 0, 'other': 0 };
  for (const c of dbCustomers) {
    if (dbDist[c.kategori] !== undefined) {
      dbDist[c.kategori]++;
    } else {
      dbDist.other++;
    }
  }

  console.log(`\nDatabase distribution (${dbCustomers.length} customers):`);
  console.log(`  El-Kontroll:                 ${dbDist['El-Kontroll']}`);
  console.log(`  Brannvarsling:               ${dbDist['Brannvarsling']}`);
  console.log(`  El-Kontroll + Brannvarsling: ${dbDist['El-Kontroll + Brannvarsling']}`);
  if (dbDist.other > 0) console.log(`  Other:                       ${dbDist.other}`);

  // Find matches and mismatches
  const toUpdate = [];
  let matched = 0;
  const notInDb = [];

  for (const [csvName, csvData] of Object.entries(csvCustomers)) {
    const dbMatch = dbCustomers.find(c => c.navn === csvName);

    if (dbMatch) {
      matched++;
      if (dbMatch.kategori !== csvData.kategori) {
        toUpdate.push({
          id: dbMatch.id,
          navn: csvName,
          from: dbMatch.kategori,
          to: csvData.kategori,
          // Also update related fields
          el_type: csvData.elType || null,
          brann_system: csvData.brannType || null,
          brann_driftstype: csvData.brannDrift || null
        });
      }
    } else {
      notInDb.push(csvName);
    }
  }

  console.log(`\nMatched: ${matched}`);
  console.log(`Mismatches to fix: ${toUpdate.length}`);
  console.log(`CSV customers not in DB: ${notInDb.length}`);

  if (notInDb.length > 0 && notInDb.length <= 20) {
    console.log('\n--- CSV customers not found in DB ---');
    notInDb.forEach(name => console.log(`  ${name}`));
  }

  if (toUpdate.length === 0) {
    console.log('\nNo updates needed!');
    return;
  }

  console.log('\n--- Updates needed ---');
  toUpdate.forEach(u => {
    console.log(`  ${u.id}: "${u.navn}"`);
    console.log(`    Kategori: ${u.from} -> ${u.to}`);
  });

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] No changes made. Run with --update to apply changes.');
    return;
  }

  // Apply updates
  console.log('\nApplying updates...');
  let updated = 0;
  let errors = 0;

  for (const u of toUpdate) {
    const updateData = { kategori: u.to };

    // Also update related fields if available
    if (u.el_type) updateData.el_type = u.el_type;
    if (u.brann_system) updateData.brann_system = u.brann_system;
    if (u.brann_driftstype) updateData.brann_driftstype = u.brann_driftstype;

    const { error } = await supabase
      .from('kunder')
      .update(updateData)
      .eq('id', u.id);

    if (error) {
      console.error(`  Error updating ${u.id}:`, error.message);
      errors++;
    } else {
      updated++;
    }
  }

  console.log(`\nDone! Updated: ${updated}, Errors: ${errors}`);

  // Show final distribution
  const { data: finalCustomers } = await supabase
    .from('kunder')
    .select('kategori');

  const finalDist = { 'El-Kontroll': 0, 'Brannvarsling': 0, 'El-Kontroll + Brannvarsling': 0 };
  for (const c of finalCustomers) {
    if (finalDist[c.kategori] !== undefined) {
      finalDist[c.kategori]++;
    }
  }

  console.log('\nFinal database distribution:');
  console.log(`  El-Kontroll:                 ${finalDist['El-Kontroll']}`);
  console.log(`  Brannvarsling:               ${finalDist['Brannvarsling']}`);
  console.log(`  El-Kontroll + Brannvarsling: ${finalDist['El-Kontroll + Brannvarsling']}`);
}

syncCategories().catch(console.error);

/**
 * Full sync of CSV data to database with proper encoding handling
 *
 * Usage:
 *   node scripts/full-sync-csv.mjs              # Dry-run
 *   node scripts/full-sync-csv.mjs --update     # Actually update
 */
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = !process.argv.includes('--update');
const CSV_PATH = '../../El-kontroll og brannvarsling 12.3 (1).csv';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Normalize string for comparison (handle encoding differences)
 */
function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]/g, ''); // Keep only alphanumeric
}

/**
 * Parse CSV file
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const customers = [];

  for (let i = 12; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (cols.length < 17) continue;

    const kunde = (cols[16] || '').trim();
    if (!kunde || kunde === 'Kunde') continue;

    // El-kontroll data
    const elType = (cols[3] || '').trim();
    const elSiste = (cols[4] || '').trim();
    const elNeste = (cols[5] || '').trim();
    const elMaaned = (cols[6] || '').trim();
    const elFrekvens = (cols[7] || '').trim();

    const hasEl = Boolean(elType || elSiste || elNeste);

    // Brannvarsling data
    const brannSist = (cols[8] || '').trim();
    const brannNeste = (cols[9] || '').trim();
    const brannMaaned = (cols[10] || '').trim();
    const brannSystem = (cols[11] || '').trim();
    const brannDrift = (cols[12] || '').trim();

    const hasBrann = Boolean(brannSist || brannNeste || brannSystem || brannDrift);

    // Determine category
    let kategori;
    if (hasEl && hasBrann) {
      kategori = 'El-Kontroll + Brannvarsling';
    } else if (hasBrann) {
      kategori = 'Brannvarsling';
    } else {
      kategori = 'El-Kontroll';
    }

    customers.push({
      navn: kunde,
      normalizedNavn: normalize(kunde),
      kategori,
      elType: elType || null,
      elSiste,
      elNeste,
      brannSystem: brannSystem || null,
      brannDrift: brannDrift || null,
      brannSist,
      brannNeste,
      hasEl,
      hasBrann
    });
  }

  return customers;
}

async function fullSync() {
  console.log('='.repeat(60));
  console.log('FULL CSV SYNC TIL DATABASE');
  console.log('='.repeat(60));
  console.log(`\nModus: ${DRY_RUN ? 'DRY-RUN' : 'UPDATE'}\n`);

  // Parse CSV
  const csvCustomers = parseCSV(CSV_PATH);
  console.log(`CSV: ${csvCustomers.length} kunder`);

  // CSV distribution
  const csvDist = { 'El-Kontroll': 0, 'Brannvarsling': 0, 'El-Kontroll + Brannvarsling': 0 };
  csvCustomers.forEach(c => csvDist[c.kategori]++);
  console.log(`  El-Kontroll:                 ${csvDist['El-Kontroll']}`);
  console.log(`  Brannvarsling:               ${csvDist['Brannvarsling']}`);
  console.log(`  El-Kontroll + Brannvarsling: ${csvDist['El-Kontroll + Brannvarsling']}`);

  // Get all DB customers
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('id, navn, kategori, el_type, brann_system, brann_driftstype');

  if (error) {
    console.error('DB Error:', error);
    process.exit(1);
  }

  // Create normalized lookup
  const dbLookup = new Map();
  dbCustomers.forEach(c => {
    dbLookup.set(normalize(c.navn), c);
  });

  console.log(`\nDatabase: ${dbCustomers.length} kunder`);

  // Find matches and updates needed
  const toUpdate = [];
  let matched = 0;
  let notFound = [];

  for (const csvC of csvCustomers) {
    const dbMatch = dbLookup.get(csvC.normalizedNavn);

    if (!dbMatch) {
      notFound.push(csvC);
      continue;
    }

    matched++;

    // Check if update needed
    if (dbMatch.kategori !== csvC.kategori) {
      toUpdate.push({
        id: dbMatch.id,
        navn: dbMatch.navn,
        from: dbMatch.kategori,
        to: csvC.kategori,
        elType: csvC.elType,
        brannSystem: csvC.brannSystem,
        brannDrift: csvC.brannDrift
      });
    }
  }

  console.log(`\nMatched: ${matched}`);
  console.log(`Needs update: ${toUpdate.length}`);
  console.log(`Not in DB: ${notFound.length}`);

  if (toUpdate.length > 0) {
    console.log('\n=== OPPDATERINGER ===');
    for (const u of toUpdate) {
      console.log(`  ${u.navn}: ${u.from} -> ${u.to}`);
    }
  }

  if (notFound.length > 0) {
    console.log('\n=== IKKE FUNNET I DB ===');
    for (const c of notFound.slice(0, 10)) {
      console.log(`  ${c.navn} (${c.kategori})`);
    }
    if (notFound.length > 10) {
      console.log(`  ... og ${notFound.length - 10} til`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Ingen endringer. Kjør med --update for å oppdatere.');
    return;
  }

  if (toUpdate.length === 0) {
    console.log('\nIngen oppdateringer nødvendig!');
    return;
  }

  // Apply updates
  console.log('\nOppdaterer...');
  let updated = 0;
  let errors = 0;

  for (const u of toUpdate) {
    const updateData = { kategori: u.to };
    if (u.elType) updateData.el_type = u.elType;
    if (u.brannSystem) updateData.brann_system = u.brannSystem;
    if (u.brannDrift) updateData.brann_driftstype = u.brannDrift;

    const { error } = await supabase
      .from('kunder')
      .update(updateData)
      .eq('id', u.id);

    if (error) {
      console.error(`  Feil ${u.id}:`, error.message);
      errors++;
    } else {
      updated++;
    }
  }

  console.log(`\nFerdig! Oppdatert: ${updated}, Feil: ${errors}`);

  // Show final distribution
  const { data: finalData } = await supabase.from('kunder').select('kategori');
  const finalDist = { 'El-Kontroll': 0, 'Brannvarsling': 0, 'El-Kontroll + Brannvarsling': 0 };
  finalData.forEach(c => { if (finalDist[c.kategori] !== undefined) finalDist[c.kategori]++; });

  console.log('\n=== ENDELIG FORDELING ===');
  console.log(`  El-Kontroll:                 ${finalDist['El-Kontroll']}`);
  console.log(`  Brannvarsling:               ${finalDist['Brannvarsling']}`);
  console.log(`  El-Kontroll + Brannvarsling: ${finalDist['El-Kontroll + Brannvarsling']}`);
}

fullSync().catch(console.error);

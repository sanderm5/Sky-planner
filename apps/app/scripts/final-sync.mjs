/**
 * Final sync script with proper encoding handling
 */
import 'dotenv/config';
import fs from 'node:fs';
import iconv from 'iconv-lite';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = !process.argv.includes('--update');
const CSV_PATH = '../../El-kontroll og brannvarsling 12.3 (1).csv';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Try multiple encodings to read file correctly
 */
function readCSVWithEncoding(filePath) {
  const buffer = fs.readFileSync(filePath);

  // Try different encodings
  const encodings = ['utf-8', 'latin1', 'cp1252', 'iso-8859-1'];

  for (const encoding of encodings) {
    try {
      const content = iconv.decode(buffer, encoding);
      // Check if Norwegian characters are correct
      if (content.includes('å') || content.includes('ø') || content.includes('æ') ||
          content.includes('Å') || content.includes('Ø') || content.includes('Æ')) {
        console.log(`Using encoding: ${encoding}`);
        return content;
      }
    } catch (e) {
      continue;
    }
  }

  // Fallback to UTF-8
  console.log('Fallback to UTF-8');
  return buffer.toString('utf-8');
}

/**
 * Fuzzy match names (handles encoding issues and minor differences)
 */
function fuzzyMatch(csvName, dbName) {
  // Exact match first
  if (csvName === dbName) return true;

  // Aggressive normalization: keep only ASCII letters and numbers
  const norm = s => s.toLowerCase()
    .replace(/[^a-z0-9]/gi, ''); // Only keep basic alphanumeric

  const normCsv = norm(csvName);
  const normDb = norm(dbName);

  // Exact normalized match
  if (normCsv === normDb) return true;

  // Check if one contains the other (for partial matches)
  if (normCsv.length > 5 && normDb.length > 5) {
    if (normCsv.includes(normDb) || normDb.includes(normCsv)) return true;
  }

  return false;
}

async function finalSync() {
  console.log('='.repeat(60));
  console.log('FINAL SYNC - CSV TIL DATABASE');
  console.log('='.repeat(60));
  console.log(`Modus: ${DRY_RUN ? 'DRY-RUN' : 'UPDATE'}\n`);

  // Read CSV with proper encoding
  const content = readCSVWithEncoding(CSV_PATH);
  const lines = content.split(/\r?\n/);

  // Parse CSV
  const csvCustomers = [];
  for (let i = 12; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (cols.length < 17) continue;

    const kunde = (cols[16] || '').trim();
    if (!kunde || kunde === 'Kunde') continue;

    const hasEl = Boolean((cols[3] || '').trim() || (cols[4] || '').trim() || (cols[5] || '').trim());
    const hasBrann = Boolean((cols[8] || '').trim() || (cols[9] || '').trim() || (cols[11] || '').trim() || (cols[12] || '').trim());

    let kategori;
    if (hasEl && hasBrann) kategori = 'El-Kontroll + Brannvarsling';
    else if (hasBrann) kategori = 'Brannvarsling';
    else kategori = 'El-Kontroll';

    csvCustomers.push({
      navn: kunde,
      kategori,
      elType: (cols[3] || '').trim() || null,
      brannSystem: (cols[11] || '').trim() || null,
      brannDrift: (cols[12] || '').trim() || null
    });
  }

  // CSV stats
  const csvDist = { 'El-Kontroll': 0, 'Brannvarsling': 0, 'El-Kontroll + Brannvarsling': 0 };
  csvCustomers.forEach(c => csvDist[c.kategori]++);

  console.log(`CSV: ${csvCustomers.length} kunder`);
  console.log(`  El-Kontroll:                 ${csvDist['El-Kontroll']}`);
  console.log(`  Brannvarsling:               ${csvDist['Brannvarsling']}`);
  console.log(`  El-Kontroll + Brannvarsling: ${csvDist['El-Kontroll + Brannvarsling']}`);

  // Get DB customers
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('id, navn, kategori, el_type, brann_system, brann_driftstype');

  if (error) {
    console.error('DB Error:', error);
    process.exit(1);
  }

  console.log(`\nDatabase: ${dbCustomers.length} kunder`);

  // Match and find updates needed
  const toUpdate = [];
  let matched = 0;
  const notFound = [];

  for (const csvC of csvCustomers) {
    // Find matching DB customer
    const dbMatch = dbCustomers.find(db => fuzzyMatch(csvC.navn, db.navn));

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
        csvNavn: csvC.navn,
        from: dbMatch.kategori,
        to: csvC.kategori,
        elType: csvC.elType,
        brannSystem: csvC.brannSystem,
        brannDrift: csvC.brannDrift
      });
    }
  }

  console.log(`\nMatchet: ${matched}`);
  console.log(`Trenger oppdatering: ${toUpdate.length}`);
  console.log(`Ikke funnet: ${notFound.length}`);

  if (toUpdate.length > 0) {
    console.log('\n=== OPPDATERINGER ===');
    toUpdate.forEach(u => {
      console.log(`  ID ${u.id}: "${u.navn}"`);
      console.log(`    ${u.from} -> ${u.to}`);
    });
  }

  if (notFound.length > 0) {
    console.log('\n=== IKKE FUNNET ===');
    notFound.slice(0, 15).forEach(c => console.log(`  "${c.navn}" (${c.kategori})`));
    if (notFound.length > 15) console.log(`  ... og ${notFound.length - 15} til`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Kjør med --update for å oppdatere.');
    return;
  }

  if (toUpdate.length === 0) {
    console.log('\nAlt er korrekt!');
    return;
  }

  // Apply updates
  console.log('\nOppdaterer...');
  let updated = 0, errors = 0;

  for (const u of toUpdate) {
    const updateData = { kategori: u.to };
    if (u.elType) updateData.el_type = u.elType;
    if (u.brannSystem) updateData.brann_system = u.brannSystem;
    if (u.brannDrift) updateData.brann_driftstype = u.brannDrift;

    const { error } = await supabase.from('kunder').update(updateData).eq('id', u.id);
    if (error) { console.error(`  Feil ${u.id}:`, error.message); errors++; }
    else { updated++; }
  }

  console.log(`\nFerdig! Oppdatert: ${updated}, Feil: ${errors}`);
}

finalSync().catch(console.error);

/**
 * Verify CSV customers against database
 */
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const CSV_PATH = '../../El-kontroll og brannvarsling 12.3 (1).csv';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Parse CSV
const content = fs.readFileSync(CSV_PATH, 'utf-8');
const lines = content.split(/\r?\n/);
const csvCustomers = {};

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

  csvCustomers[kunde] = kategori;
}

// Get all DB customers
const { data: dbCustomers } = await supabase.from('kunder').select('id, navn, kategori');

console.log('='.repeat(60));
console.log('VERIFIKASJON: CSV vs DATABASE');
console.log('='.repeat(60));

let correct = 0;
let wrong = [];
let notFound = [];

for (const [navn, csvKat] of Object.entries(csvCustomers)) {
  const dbMatch = dbCustomers.find(c => c.navn === navn);
  if (!dbMatch) {
    notFound.push(navn);
  } else if (dbMatch.kategori === csvKat) {
    correct++;
  } else {
    wrong.push({ id: dbMatch.id, navn, csv: csvKat, db: dbMatch.kategori });
  }
}

console.log(`\nCSV kunder: ${Object.keys(csvCustomers).length}`);
console.log(`Korrekt i DB: ${correct}`);
console.log(`FEIL kategori: ${wrong.length}`);
console.log(`Ikke funnet i DB: ${notFound.length}`);

if (wrong.length > 0) {
  console.log('\n=== KUNDER MED FEIL KATEGORI ===');
  for (const w of wrong) {
    console.log(`  ID ${w.id}: ${w.navn}`);
    console.log(`    CSV sier: ${w.csv}`);
    console.log(`    DB har:   ${w.db}`);
  }
}

if (notFound.length > 0) {
  console.log('\n=== KUNDER IKKE I DATABASE ===');
  for (const n of notFound) {
    console.log(`  ${n} (CSV: ${csvCustomers[n]})`);
  }
}

// DB distribution
const dbDist = { 'El-Kontroll': 0, 'Brannvarsling': 0, 'El-Kontroll + Brannvarsling': 0 };
for (const c of dbCustomers) {
  if (dbDist[c.kategori] !== undefined) dbDist[c.kategori]++;
}

console.log('\n=== NÅVÆRENDE DB FORDELING ===');
console.log(`  El-Kontroll:                 ${dbDist['El-Kontroll']}`);
console.log(`  Brannvarsling:               ${dbDist['Brannvarsling']}`);
console.log(`  El-Kontroll + Brannvarsling: ${dbDist['El-Kontroll + Brannvarsling']}`);

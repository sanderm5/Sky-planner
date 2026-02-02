/**
 * Check Brannvarsling customers in database vs CSV
 */

import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const CSV_PATH = '../../El-kontroll og brannvarsling 12.3 (1).csv';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Parse CSV
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const customers = {};

  for (let i = 12; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (cols.length < 17) continue;
    const kunde = (cols[16] || '').trim();
    if (!kunde || kunde === 'Kunde') continue;

    const hasEl = Boolean((cols[3] || '').trim() || (cols[4] || '').trim() || (cols[5] || '').trim());
    const hasBrann = Boolean((cols[8] || '').trim() || (cols[9] || '').trim() || (cols[11] || '').trim() || (cols[12] || '').trim());

    let kategori = hasEl && hasBrann ? 'Begge' : hasBrann ? 'Brannvarsling' : 'El-Kontroll';
    customers[kunde] = { kategori, hasEl, hasBrann };
  }
  return customers;
}

async function check() {
  const csvCustomers = parseCSV(CSV_PATH);

  // Get all Brannvarsling customers from DB
  const { data: brannCustomers } = await supabase
    .from('kunder')
    .select('id, navn, kategori, el_type, siste_el_kontroll, neste_el_kontroll, brann_system, brann_driftstype, siste_brann_kontroll, neste_brann_kontroll')
    .eq('kategori', 'Brannvarsling');

  console.log('=== BRANNVARSLING KUNDER I DATABASE ===\n');
  console.log(`Totalt: ${brannCustomers.length}\n`);

  for (const c of brannCustomers) {
    const csvMatch = csvCustomers[c.navn];
    const csvStatus = csvMatch ? `(CSV: ${csvMatch.kategori})` : '(IKKE I CSV)';

    console.log(`ID ${c.id}: ${c.navn} ${csvStatus}`);
    console.log(`  El-data:    type=${c.el_type || '-'}, siste=${c.siste_el_kontroll || '-'}, neste=${c.neste_el_kontroll || '-'}`);
    console.log(`  Brann-data: system=${c.brann_system || '-'}, drift=${c.brann_driftstype || '-'}, siste=${c.siste_brann_kontroll || '-'}, neste=${c.neste_brann_kontroll || '-'}`);
    console.log();
  }

  // CSV Brannvarsling-only customers
  console.log('\n=== BRANNVARSLING-ONLY I CSV ===\n');
  for (const [navn, data] of Object.entries(csvCustomers)) {
    if (data.kategori === 'Brannvarsling') {
      console.log(`  ${navn}`);
    }
  }
}

check().catch(console.error);

/**
 * Fyller inn manglende el_type og brann_system fra fasit
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import iconv from 'iconv-lite';

const FASIT_PATH = path.resolve(process.cwd(), '../../El-kontroll og brannvarsling 01.02.26.csv');
const ORGANIZATION_ID = 5;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

function normalizeString(str) {
  if (!str) return '';
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  console.log('='.repeat(60));
  console.log('FYLLER INN MANGLENDE FELTER FRA FASIT');
  console.log('='.repeat(60));

  const buffer = fs.readFileSync(FASIT_PATH);
  const content = iconv.decode(buffer, 'ISO-8859-1');
  const lines = content.split(/\r?\n/);

  // Parse fasit med el_type og brann_system
  const fasitData = [];
  for (let i = 12; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 20) continue;

    const navn = (cols[19] || '').trim();
    if (!navn || navn === 'Kunde' || navn.length < 3) continue;

    fasitData.push({
      navn,
      adresse: (cols[20] || '').trim(),
      el_type: (cols[2] || '').trim() || null,
      brann_system: (cols[11] || '').trim() || null,
      brann_driftstype: (cols[13] || '').trim() || null
    });
  }

  console.log(`Fasit rader: ${fasitData.length}`);

  // Hent kunder fra database
  const { data: dbCustomers } = await supabase.from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID);

  console.log(`Database kunder: ${dbCustomers.length}`);

  let elTypeCount = 0;
  let brannSystemCount = 0;

  // Oppdater manglende el_type
  console.log('\n--- OPPDATERER EL_TYPE ---');
  const missingElType = dbCustomers.filter(k =>
    k.kategori && k.kategori.includes('El-Kontroll') && !k.el_type
  );

  for (const db of missingElType) {
    // Finn i fasit
    const fasitMatch = fasitData.find(f =>
      normalizeString(f.navn) === normalizeString(db.navn)
    );

    if (fasitMatch && fasitMatch.el_type) {
      console.log(`  ${db.navn}: -> ${fasitMatch.el_type}`);
      await supabase.from('kunder')
        .update({ el_type: fasitMatch.el_type })
        .eq('id', db.id);
      elTypeCount++;
    }
  }

  // Oppdater manglende brann_system
  console.log('\n--- OPPDATERER BRANN_SYSTEM ---');
  const missingBrannSystem = dbCustomers.filter(k =>
    k.kategori && k.kategori.includes('Brann') && !k.brann_system
  );

  for (const db of missingBrannSystem) {
    // Finn i fasit
    const fasitMatch = fasitData.find(f =>
      normalizeString(f.navn) === normalizeString(db.navn)
    );

    if (fasitMatch && fasitMatch.brann_system) {
      console.log(`  ${db.navn}: -> ${fasitMatch.brann_system}`);
      const updateData = { brann_system: fasitMatch.brann_system };
      if (fasitMatch.brann_driftstype && !db.brann_driftstype) {
        updateData.brann_driftstype = fasitMatch.brann_driftstype;
      }
      await supabase.from('kunder')
        .update(updateData)
        .eq('id', db.id);
      brannSystemCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('RESULTAT');
  console.log('='.repeat(60));
  console.log(`El_type oppdatert: ${elTypeCount}`);
  console.log(`Brann_system oppdatert: ${brannSystemCount}`);
  console.log('='.repeat(60));
}

main().catch(console.error);

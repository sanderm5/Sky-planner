#!/usr/bin/env node
/**
 * Import cleaned CSV to TRE Allservice AS
 *
 * Usage:
 *   node scripts/import-cleaned-csv.mjs                    # Dry-run
 *   node scripts/import-cleaned-csv.mjs --import           # Actual import
 *   node scripts/import-cleaned-csv.mjs --import --geocode # Import + geocode
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Configuration
const ORGANIZATION_ID = 5; // TRE Allservice AS
const CSV_PATH = path.resolve(process.cwd(), '../../cleaned-for-import.csv');
const DRY_RUN = !process.argv.includes('--import');
const DO_GEOCODE = process.argv.includes('--geocode');

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Parse CSV row (handles quoted fields)
 */
function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

/**
 * Clean phone number - remove spaces for database storage
 */
function cleanPhone(phone) {
  if (!phone) return null;
  return phone.replace(/\s/g, '').trim() || null;
}

/**
 * Geocode address using Kartverket API
 */
async function geocodeAddress(adresse, postnummer, poststed) {
  if (!adresse && !poststed) return null;

  try {
    const searchText = [adresse, postnummer, poststed].filter(Boolean).join(' ');
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(searchText)}&treffPerSide=1`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      const result = data.adresser[0];
      if (result.representasjonspunkt) {
        return {
          lat: result.representasjonspunkt.lat,
          lng: result.representasjonspunkt.lon
        };
      }
    }
  } catch {
    // Ignore geocoding errors
  }

  return null;
}

/**
 * Main import function
 */
async function importCustomers() {
  console.log('='.repeat(60));
  console.log('CSV IMPORT TIL TRE ALLSERVICE AS');
  console.log('='.repeat(60));
  console.log(`\nModus: ${DRY_RUN ? 'DRY-RUN (ingen endringer)' : 'IMPORT'}`);
  console.log(`Geocoding: ${DO_GEOCODE ? 'JA' : 'NEI'}`);
  console.log(`Fil: ${CSV_PATH}`);
  console.log(`Organization ID: ${ORGANIZATION_ID}\n`);

  // Check if file exists
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`FEIL: Fil ikke funnet: ${CSV_PATH}`);
    process.exit(1);
  }

  // Read CSV file
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());

  // Parse header
  const header = parseCSVRow(lines[0]);
  console.log(`Kolonner: ${header.length}`);
  console.log(`Datarader: ${lines.length - 1}\n`);

  // Map column indices
  const colIndex = {};
  header.forEach((col, i) => { colIndex[col] = i; });

  // Parse customers
  const customers = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    if (cols.length < 5) continue;

    try {
      const getValue = (col) => cols[colIndex[col]] || null;
      const getInt = (col) => {
        const val = getValue(col);
        return val ? parseInt(val, 10) || null : null;
      };

      const customer = {
        navn: getValue('navn'),
        adresse: getValue('adresse'),
        postnummer: getValue('postnummer'),
        poststed: getValue('poststed'),
        telefon: cleanPhone(getValue('telefon')),
        epost: getValue('epost'),
        kategori: getValue('kategori'),
        el_type: getValue('el_type'),
        brann_system: getValue('brann_system'),
        brann_driftstype: getValue('brann_driftstype'),
        siste_el_kontroll: getValue('siste_el_kontroll'),
        neste_el_kontroll: getValue('neste_el_kontroll'),
        siste_brann_kontroll: getValue('siste_brann_kontroll'),
        neste_brann_kontroll: getValue('neste_brann_kontroll'),
        el_kontroll_intervall: getInt('el_kontroll_intervall'),
        brann_kontroll_intervall: getInt('brann_kontroll_intervall') || 12,
        notater: getValue('notater'),
        organization_id: ORGANIZATION_ID
      };

      // Skip if missing required fields
      if (!customer.navn || !customer.adresse) {
        errors.push({ line: i + 1, error: 'Mangler navn eller adresse' });
        continue;
      }

      customers.push({ lineNum: i + 1, customer });
    } catch (err) {
      errors.push({ line: i + 1, error: err.message });
    }
  }

  console.log(`Parsed ${customers.length} kunder`);
  if (errors.length > 0) {
    console.log(`Feil: ${errors.length}`);
  }
  console.log();

  // Show first 5 customers as preview
  console.log('=== FORHÅNDSVISNING (første 5 kunder) ===\n');
  for (let i = 0; i < Math.min(5, customers.length); i++) {
    const { lineNum, customer: c } = customers[i];
    console.log(`[Rad ${lineNum}] ${c.navn}`);
    console.log(`  Adresse: ${c.adresse}, ${c.postnummer} ${c.poststed}`);
    console.log(`  Telefon: ${c.telefon || '(ingen)'}`);
    console.log(`  Kategori: ${c.kategori}`);
    console.log(`  El: ${c.siste_el_kontroll || '-'} → ${c.neste_el_kontroll || '-'}`);
    console.log(`  Brann: ${c.siste_brann_kontroll || '-'} → ${c.neste_brann_kontroll || '-'}`);
    console.log();
  }

  // If dry-run, stop here
  if (DRY_RUN) {
    console.log('='.repeat(60));
    console.log('DRY-RUN FERDIG');
    console.log(`Totalt ${customers.length} kunder ville blitt importert`);
    console.log('\nKjør med --import for å faktisk importere:');
    console.log('  node scripts/import-cleaned-csv.mjs --import');
    console.log('  node scripts/import-cleaned-csv.mjs --import --geocode');
    console.log('='.repeat(60));
    return;
  }

  // Actual import
  console.log('=== STARTER IMPORT ===\n');

  let imported = 0;
  let failed = 0;

  for (const { lineNum, customer } of customers) {
    process.stdout.write(`[Rad ${lineNum}] ${customer.navn}... `);

    try {
      // Geocode if requested
      if (DO_GEOCODE) {
        const coords = await geocodeAddress(customer.adresse, customer.postnummer, customer.poststed);
        if (coords) {
          customer.lat = coords.lat;
          customer.lng = coords.lng;
        }
        // Rate limit geocoding
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Insert to Supabase
      const { error } = await supabase
        .from('kunder')
        .insert(customer);

      if (error) {
        console.log(`FEIL: ${error.message}`);
        failed++;
      } else {
        console.log('OK');
        imported++;
      }
    } catch (err) {
      console.log(`FEIL: ${err.message}`);
      failed++;
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('IMPORT FERDIG');
  console.log(`Importert: ${imported}`);
  console.log(`Feilet: ${failed}`);
  console.log('='.repeat(60));
}

importCustomers().catch(err => {
  console.error('Fatal feil:', err);
  process.exit(1);
});

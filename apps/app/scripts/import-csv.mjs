/**
 * Import customers from Excel file to TRE Allservice AS
 *
 * Usage:
 *   node scripts/import-csv.mjs                    # Dry-run (default)
 *   node scripts/import-csv.mjs --import           # Actual import
 *   node scripts/import-csv.mjs --import --geocode # Import + geocode
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// xlsx requires special import for ESM (CommonJS module)
import xlsx from 'xlsx';
const { readFile, utils } = xlsx;

// Configuration
const ORGANIZATION_ID = 5; // TRE Allservice AS
const XLSX_PATH = path.resolve(process.cwd(), '../../El-kontroll og brannvarsling 12.3.25-DESKTOP-9CTDHSK.xlsx');
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

// Month parsing mapping - both Norwegian and English abbreviations
const MONTH_MAP = {
  // Norwegian
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
  'mai': 5, 'jun': 6, 'jul': 7, 'aug': 8,
  'sep': 9, 'spt': 9, 'okt': 10, 'nov': 11, 'des': 12,
  'mars': 3,
  // English
  'may': 5, 'oct': 10, 'dec': 12
};

/**
 * Parse month from string like "09.sep", "11.nov", "9-Sep", "Mars", "Des"
 */
function parseMonth(monthStr) {
  if (!monthStr || monthStr === 'x' || monthStr === 'Måned') return null;

  const lower = monthStr.toLowerCase().trim();

  // Direct match (e.g., "mars", "des")
  if (MONTH_MAP[lower]) return MONTH_MAP[lower];

  // Parse "09.sep" or "9-Sep" format (handles both . and - separators)
  const match = lower.match(/(\d+)?[\.\-]?(\w+)/);
  if (match && match[2]) {
    const monthName = match[2].substring(0, 3);
    return MONTH_MAP[monthName] || null;
  }

  return null;
}

/**
 * Parse date from year and month strings
 * Returns YYYY-MM-01 format or null
 */
function parseDate(yearStr, monthStr) {
  if (!yearStr || yearStr === 'x' || yearStr === 'Siste' || yearStr === 'Neste') {
    return null;
  }

  const year = parseInt(yearStr.trim());
  if (isNaN(year) || year < 2000 || year > 2100) return null;

  const month = parseMonth(monthStr) || 1; // Default to January
  return `${year}-${month.toString().padStart(2, '0')}-01`;
}

/**
 * Parse interval from frequency string
 * Returns months (e.g., "3" -> 36, "1" -> 12)
 */
function parseInterval(freqStr) {
  if (!freqStr || freqStr === 'Frekvens') return 36; // Default 3 years

  // Handle "3 år" format
  const numMatch = freqStr.match(/(\d+)/);
  if (numMatch) {
    const years = parseInt(numMatch[1]);
    if (!isNaN(years) && years > 0 && years <= 10) {
      return years * 12;
    }
  }

  return 36; // Default 3 years
}

/**
 * Clean phone number - remove spaces
 */
function cleanPhone(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/\s/g, '').trim();
  return cleaned.length >= 8 ? cleaned : null;
}

/**
 * Check if string is a valid 9-digit org number
 */
function isValidOrgNr(str) {
  if (!str) return false;
  return /^\d{9}$/.test(str.trim());
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
  } catch (error) {
    // Ignore geocoding errors
  }

  return null;
}

/**
 * Main import function
 */
async function importCustomers() {
  console.log('='.repeat(60));
  console.log('EXCEL IMPORT TIL TRE ALLSERVICE AS');
  console.log('='.repeat(60));
  console.log(`\nModus: ${DRY_RUN ? 'DRY-RUN (ingen endringer)' : 'IMPORT'}`);
  console.log(`Fil: ${XLSX_PATH}`);
  console.log(`Organization ID: ${ORGANIZATION_ID}\n`);

  // Check if file exists
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`FEIL: Fil ikke funnet: ${XLSX_PATH}`);
    process.exit(1);
  }

  // Read Excel file
  const workbook = readFile(XLSX_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays (raw data)
  const rawData = utils.sheet_to_json(sheet, { header: 1, defval: '' });

  console.log(`Ark: "${sheetName}"`);
  console.log(`Totalt ${rawData.length} rader i filen\n`);

  // Parse customers
  const customers = [];
  const errors = [];

  for (let i = 12; i < rawData.length; i++) { // Start from row 13 (0-indexed: 12)
    const cols = rawData[i];
    if (!cols || cols.length === 0) continue;

    // Get customer name (column 17, 0-indexed: 16)
    const navn = String(cols[16] || '').trim();
    const adresse = String(cols[17] || '').trim();

    // Skip empty rows or header duplicates
    if (!navn || !adresse || navn === 'Kunde') {
      continue;
    }

    try {
      const postnummer = String(cols[18] || '').trim();
      const poststed = String(cols[19] || '').trim();
      const telefon = String(cols[22] || '').trim();
      const epost = String(cols[23] || '').trim();

      // El-kontroll columns (3-7)
      const elType = String(cols[3] || '').trim();
      const sisteAar = String(cols[4] || '').trim();
      const nesteAar = String(cols[5] || '').trim();
      const maaned = String(cols[6] || '').trim();
      const frekvens = String(cols[7] || '').trim();

      // Brannvarsling columns (8-12)
      const brannSisteAar = String(cols[8] || '').trim();
      const brannNesteAar = String(cols[9] || '').trim();
      const brannMaaned = String(cols[10] || '').trim();
      const brannSystem = String(cols[11] || '').trim();
      const brannDriftstype = String(cols[12] || '').trim();

      const omraade = String(cols[20] || '').trim();
      const orgNr = String(cols[21] || '').trim();

      // Build notater with area and org number if available
      let notater = '';
      if (omraade) notater += `Område: ${omraade}`;
      if (isValidOrgNr(orgNr)) {
        if (notater) notater += '\n';
        notater += `Org.nr: ${orgNr}`;
      }

      // Determine kategori based on actual data
      const hasElData = elType || sisteAar || nesteAar;
      const hasBrannData = brannSystem || brannDriftstype || brannSisteAar || brannNesteAar;

      let kategori;
      if (hasElData && hasBrannData) {
        kategori = 'El-Kontroll + Brannvarsling';
      } else if (hasBrannData) {
        kategori = 'Brannvarsling';
      } else {
        kategori = 'El-Kontroll';
      }

      const customer = {
        navn: navn,
        adresse: adresse,
        postnummer: postnummer || null,
        poststed: poststed || null,
        telefon: cleanPhone(telefon),
        epost: epost || null,
        // El-kontroll
        el_type: elType || null,
        siste_el_kontroll: parseDate(sisteAar, maaned),
        neste_el_kontroll: parseDate(nesteAar, maaned),
        el_kontroll_intervall: parseInterval(frekvens),
        // Brannvarsling
        brann_system: brannSystem || null,
        brann_driftstype: brannDriftstype || null,
        siste_brann_kontroll: parseDate(brannSisteAar, brannMaaned),
        neste_brann_kontroll: parseDate(brannNesteAar, brannMaaned),
        brann_kontroll_intervall: 12,
        // Meta
        notater: notater || null,
        organization_id: ORGANIZATION_ID,
        kategori: kategori
      };

      customers.push({ lineNum: i + 1, customer });
    } catch (err) {
      errors.push({ lineNum: i + 1, error: err.message });
    }
  }

  console.log(`Parsed ${customers.length} kunder`);
  if (errors.length > 0) {
    console.log(`Parse-feil: ${errors.length}`);
  }
  console.log();

  // Show first 5 customers as preview
  console.log('=== FORHÅNDSVISNING (første 5 kunder) ===\n');
  for (let i = 0; i < Math.min(5, customers.length); i++) {
    const { lineNum, customer } = customers[i];
    console.log(`[Linje ${lineNum}] ${customer.navn}`);
    console.log(`  Adresse: ${customer.adresse}, ${customer.postnummer} ${customer.poststed}`);
    console.log(`  Telefon: ${customer.telefon || '(ingen)'}`);
    console.log(`  E-post: ${customer.epost || '(ingen)'}`);
    console.log(`  Type: ${customer.el_type || '(ingen)'}`);
    console.log(`  Siste kontroll: ${customer.siste_el_kontroll || '(ikke satt)'}`);
    console.log(`  Neste kontroll: ${customer.neste_el_kontroll || '(ikke satt)'}`);
    console.log(`  Intervall: ${customer.el_kontroll_intervall} måneder`);
    console.log(`  Org.nr: ${customer.external_id || '(privat)'}`);
    console.log(`  Notater: ${customer.notater || '(ingen)'}`);
    console.log();
  }

  // If dry-run, stop here
  if (DRY_RUN) {
    console.log('='.repeat(60));
    console.log('DRY-RUN FERDIG');
    console.log(`Totalt ${customers.length} kunder ville blitt importert`);
    console.log('\nKjør med --import for å faktisk importere:');
    console.log('  node scripts/import-csv.mjs --import');
    console.log('='.repeat(60));
    return;
  }

  // Actual import
  console.log('=== STARTER IMPORT ===\n');

  let imported = 0;
  let failed = 0;

  for (const { lineNum, customer } of customers) {
    process.stdout.write(`[Linje ${lineNum}] ${customer.navn}... `);

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

  console.log('\n' + '='.repeat(60));
  console.log('IMPORT FERDIG');
  console.log('='.repeat(60));
  console.log(`Importert: ${imported}`);
  console.log(`Feilet: ${failed}`);
  console.log(`Totalt: ${customers.length}`);

  if (!DO_GEOCODE && imported > 0) {
    console.log('\nFor å geocode (legge til koordinater), kjør:');
    console.log('  node scripts/geocode-supabase.mjs');
  }
}

// Run
importCustomers().catch(err => {
  console.error('Uventet feil:', err);
  process.exit(1);
});

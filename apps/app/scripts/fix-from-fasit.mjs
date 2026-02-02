/**
 * Fiks database til å matche fasit
 * Kjører oppdateringer basert på verify-fasit.mjs resultatene
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import iconv from 'iconv-lite';

const FASIT_PATH = path.resolve(process.cwd(), '../../El-kontroll og brannvarsling 01.02.26.csv');
const ORGANIZATION_ID = 5;
const DRY_RUN = process.argv.includes('--dry-run');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Mangler SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const MONTH_MAP = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
  'mai': 5, 'jun': 6, 'jul': 7, 'aug': 8,
  'sep': 9, 'okt': 10, 'nov': 11, 'des': 12,
  'mars': 3, 'sept': 9
};

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
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

function parseMonth(str) {
  if (!str) return null;
  const match = str.match(/(\d+)?-?(\w+)/i);
  if (match && match[2]) {
    const monthName = match[2].toLowerCase().substring(0, 3);
    return MONTH_MAP[monthName] || null;
  }
  return null;
}

function parseYear(str) {
  if (!str || str === 'x') return null;
  const match = str.match(/(\d{4})/);
  if (match) return parseInt(match[1]);
  return null;
}

function parseDate(yearStr, monthStr) {
  const year = parseYear(yearStr);
  if (!year) return null;
  const month = parseMonth(monthStr);
  if (!month) return null; // Return null if we can't parse month (don't default to Jan)
  return `${year}-${month.toString().padStart(2, '0')}-01`;
}

function parseInterval(frekvensStr) {
  if (!frekvensStr) return null;
  const num = parseInt(frekvensStr);
  if (!isNaN(num) && num > 0 && num <= 10) {
    return num * 12;
  }
  return null;
}

function normalizeString(str) {
  if (!str) return null;
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  console.log('='.repeat(70));
  console.log('OPPDATER DATABASE FRA FASIT');
  if (DRY_RUN) console.log('*** DRY RUN - INGEN ENDRINGER VIL BLI GJORT ***');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(FASIT_PATH);
  const content = iconv.decode(buffer, 'ISO-8859-1');
  const lines = content.split(/\r?\n/);

  // Parse fasit customers
  const fasitCustomers = [];
  for (let i = 12; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 20) continue;

    const navn = (cols[19] || '').trim();
    const adresse = (cols[20] || '').trim();

    if (!navn || navn === 'Kunde' || navn === 'Adresse') continue;
    if (navn.includes('Har prøvd å finne') || navn.includes('lurer jeg på') ||
        navn.includes('Jeg er i ferd') || navn.includes('Jeg kan i tillegg') ||
        navn.includes('Det å samle') || navn.includes('Jeg ønsker') ||
        navn.includes('Alternativt') || navn.includes('Mvh')) continue;

    const hasEl = Boolean(cols[2]?.trim() || cols[3]?.trim() || cols[4]?.trim());
    const hasBrann = Boolean(cols[8]?.trim() || cols[9]?.trim() || cols[11]?.trim());

    let kategori;
    if (hasEl && hasBrann) kategori = 'El-Kontroll + Brannvarsling';
    else if (hasBrann) kategori = 'Brannvarsling';
    else kategori = 'El-Kontroll';

    fasitCustomers.push({
      row: i + 1,
      navn,
      adresse,
      postnummer: (cols[21] || '').trim() || null,
      poststed: (cols[22] || '').trim() || null,
      el_type: (cols[2] || '').trim() || null,
      siste_el_kontroll: parseDate(cols[3], cols[5]),
      neste_el_kontroll: parseDate(cols[4], cols[5]),
      el_kontroll_intervall: parseInterval(cols[6]),
      siste_brann_kontroll: parseDate(cols[8], cols[10]),
      neste_brann_kontroll: parseDate(cols[9], cols[10]),
      brann_system: (cols[11] || '').trim() || null,
      brann_driftstype: (cols[13] || '').trim() || null,
      tripletex_id: (cols[14] || '').trim() || null,
      org_nr: (cols[24] || '').trim() || null,
      kategori
    });
  }

  console.log(`Fasit kunder: ${fasitCustomers.length}`);

  // Fetch DB customers
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID);

  if (error) {
    console.error('Database-feil:', error.message);
    process.exit(1);
  }

  console.log(`Database kunder: ${dbCustomers.length}`);

  let updatedCount = 0;
  let addedCount = 0;
  const updates = [];

  for (const fasit of fasitCustomers) {
    const dbMatch = dbCustomers.find(db =>
      normalizeString(db.navn) === normalizeString(fasit.navn)
    );

    if (!dbMatch) {
      // Add new customer
      if (fasit.adresse) {
        console.log(`\n+ LEGGER TIL: ${fasit.navn}`);
        console.log(`  Adresse: ${fasit.adresse}, ${fasit.postnummer} ${fasit.poststed}`);
        console.log(`  Kategori: ${fasit.kategori}`);

        if (!DRY_RUN) {
          const { error: insertError } = await supabase
            .from('kunder')
            .insert({
              organization_id: ORGANIZATION_ID,
              navn: fasit.navn,
              adresse: fasit.adresse,
              postnummer: fasit.postnummer,
              poststed: fasit.poststed,
              el_type: fasit.el_type,
              kategori: fasit.kategori,
              siste_el_kontroll: fasit.siste_el_kontroll,
              neste_el_kontroll: fasit.neste_el_kontroll,
              el_kontroll_intervall: fasit.el_kontroll_intervall,
              siste_brann_kontroll: fasit.siste_brann_kontroll,
              neste_brann_kontroll: fasit.neste_brann_kontroll,
              brann_system: fasit.brann_system,
              brann_driftstype: fasit.brann_driftstype
            });
          if (insertError) {
            console.log(`  FEIL: ${insertError.message}`);
          } else {
            addedCount++;
          }
        } else {
          addedCount++;
        }
      }
      continue;
    }

    // Compare and update
    const updateFields = {};

    // Always update kategori if different
    if (normalizeString(dbMatch.kategori) !== normalizeString(fasit.kategori)) {
      updateFields.kategori = fasit.kategori;
    }

    // Update dates only if fasit has a valid date (not null)
    if (fasit.siste_el_kontroll && dbMatch.siste_el_kontroll !== fasit.siste_el_kontroll) {
      updateFields.siste_el_kontroll = fasit.siste_el_kontroll;
    }
    if (fasit.neste_el_kontroll && dbMatch.neste_el_kontroll !== fasit.neste_el_kontroll) {
      updateFields.neste_el_kontroll = fasit.neste_el_kontroll;
    }
    if (fasit.siste_brann_kontroll && dbMatch.siste_brann_kontroll !== fasit.siste_brann_kontroll) {
      updateFields.siste_brann_kontroll = fasit.siste_brann_kontroll;
    }
    if (fasit.neste_brann_kontroll && dbMatch.neste_brann_kontroll !== fasit.neste_brann_kontroll) {
      updateFields.neste_brann_kontroll = fasit.neste_brann_kontroll;
    }

    // Update el_type if fasit has it
    if (fasit.el_type && normalizeString(dbMatch.el_type) !== normalizeString(fasit.el_type)) {
      updateFields.el_type = fasit.el_type;
    }

    // Update brann_system if fasit has it
    if (fasit.brann_system && normalizeString(dbMatch.brann_system) !== normalizeString(fasit.brann_system)) {
      updateFields.brann_system = fasit.brann_system;
    }

    // Update brann_driftstype if fasit has it
    if (fasit.brann_driftstype && normalizeString(dbMatch.brann_driftstype) !== normalizeString(fasit.brann_driftstype)) {
      updateFields.brann_driftstype = fasit.brann_driftstype;
    }

    if (Object.keys(updateFields).length > 0) {
      console.log(`\n~ OPPDATERER: ${fasit.navn} (ID ${dbMatch.id})`);
      for (const [field, value] of Object.entries(updateFields)) {
        console.log(`  ${field}: "${dbMatch[field]}" -> "${value}"`);
      }

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('kunder')
          .update(updateFields)
          .eq('id', dbMatch.id);

        if (updateError) {
          console.log(`  FEIL: ${updateError.message}`);
        } else {
          updatedCount++;
        }
      } else {
        updatedCount++;
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTAT');
  console.log('='.repeat(70));
  console.log(`Oppdaterte kunder: ${updatedCount}`);
  console.log(`Nye kunder lagt til: ${addedCount}`);
  if (DRY_RUN) {
    console.log('\n*** DRY RUN - Kjør uten --dry-run for å faktisk gjøre endringene ***');
  }
}

main().catch(err => {
  console.error('Feil:', err);
  process.exit(1);
});

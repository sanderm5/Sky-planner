#!/usr/bin/env node
/**
 * Fix missing Tripletex project IDs
 *
 * MERK: Kolonnen 'external_id' må legges til i Supabase først!
 * Gå til: https://supabase.com/dashboard/project/umxwvsrosaxmvwijxttp/editor
 * Åpne 'kunder' tabellen og legg til kolonnene:
 *   - external_id (text, nullable)
 *   - org_nr (text, nullable)
 *
 * Reads from cleaned CSV and updates existing customers by matching name+address
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ORGANIZATION_ID = 5;
const CSV_PATH = path.resolve(process.cwd(), '../../cleaned-for-import.csv');
const DRY_RUN = !process.argv.includes('--fix');
const USE_NOTATER = process.argv.includes('--notater'); // Fallback to notater field

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

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

async function checkColumnExists() {
  // Try to select external_id to check if it exists
  const { error } = await supabase
    .from('kunder')
    .select('external_id')
    .limit(1);

  return !error || !error.message.includes('external_id');
}

async function main() {
  console.log('='.repeat(60));
  console.log('FIKS TRIPLETEX PROSJEKTNUMMER');
  console.log('Modus: ' + (DRY_RUN ? 'DRY-RUN' : 'FIKS'));
  console.log('='.repeat(60));

  // Check if external_id column exists
  const hasExternalId = await checkColumnExists();

  if (!hasExternalId && !USE_NOTATER) {
    console.log('\n⚠️  Kolonnen "external_id" eksisterer ikke i databasen!');
    console.log('');
    console.log('Du må legge til kolonnen manuelt i Supabase Dashboard:');
    console.log('1. Gå til: https://supabase.com/dashboard/project/umxwvsrosaxmvwijxttp/editor');
    console.log('2. Åpne tabellen "kunder"');
    console.log('3. Klikk "New column" og legg til:');
    console.log('   - Name: external_id, Type: text');
    console.log('   - Name: org_nr, Type: text');
    console.log('');
    console.log('Eller kjør med --notater for å lagre i notater-feltet midlertidig:');
    console.log('  node scripts/fix-tripletex-ids.mjs --fix --notater');
    console.log('='.repeat(60));
    return;
  }

  const targetField = hasExternalId ? 'external_id' : 'notater';
  console.log('Lagrer i felt: ' + targetField);

  // Read CSV
  if (!fs.existsSync(CSV_PATH)) {
    console.error('Fant ikke CSV: ' + CSV_PATH);
    process.exit(1);
  }

  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const header = parseCSVRow(lines[0]);

  // Map column indices
  const colIndex = {};
  header.forEach((col, i) => { colIndex[col] = i; });

  console.log('\nCSV tripletex_id kolonne index: ' + colIndex['tripletex_id']);

  // Parse CSV data
  const csvData = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    const navn = cols[colIndex['navn']];
    const adresse = cols[colIndex['adresse']];
    const tripletexId = cols[colIndex['tripletex_id']];
    const orgNr = cols[colIndex['org_nr']];

    if (navn) {
      csvData.push({
        navn,
        adresse,
        tripletex_id: tripletexId || null,
        org_nr: orgNr || null,
        key: (navn + '|' + adresse).toLowerCase()
      });
    }
  }

  const withTripletex = csvData.filter(d => d.tripletex_id);
  console.log('CSV-data med Tripletex ID: ' + withTripletex.length + ' av ' + csvData.length);

  // Get customers from database
  const selectFields = hasExternalId ? 'id, navn, adresse, external_id, notater' : 'id, navn, adresse, notater';
  const { data: kunder, error } = await supabase
    .from('kunder')
    .select(selectFields)
    .eq('organization_id', ORGANIZATION_ID);

  if (error) {
    console.error('Feil ved henting av kunder:', error.message);
    process.exit(1);
  }

  console.log('Kunder i database: ' + kunder.length);
  console.log('');

  // Match and update
  let updated = 0;
  let notFound = 0;
  let alreadySet = 0;
  let noTripletex = 0;

  for (const csvRow of csvData) {
    // Find matching customer by name+address
    const match = kunder.find(k =>
      (k.navn + '|' + k.adresse).toLowerCase() === csvRow.key
    );

    if (!match) {
      if (csvRow.tripletex_id) {
        console.log('  IKKE FUNNET: ' + csvRow.navn);
      }
      notFound++;
      continue;
    }

    if (!csvRow.tripletex_id) {
      noTripletex++;
      continue;
    }

    // Check if already set
    if (hasExternalId && match.external_id) {
      alreadySet++;
      continue;
    }

    console.log('  ' + csvRow.navn + ' → Tripletex: ' + csvRow.tripletex_id);

    if (!DRY_RUN) {
      let updateData;

      if (hasExternalId) {
        updateData = {
          external_id: csvRow.tripletex_id,
          org_nr: csvRow.org_nr
        };
      } else {
        // Store in notater with prefix
        const existingNotes = match.notater || '';
        const tripletexNote = '[TRIPLETEX:' + csvRow.tripletex_id + ']';
        const orgNrNote = csvRow.org_nr ? ' [ORGNR:' + csvRow.org_nr + ']' : '';
        updateData = {
          notater: tripletexNote + orgNrNote + (existingNotes ? ' | ' + existingNotes : '')
        };
      }

      const { error: updateError } = await supabase
        .from('kunder')
        .update(updateData)
        .eq('id', match.id);

      if (updateError) {
        console.log('    FEIL: ' + updateError.message);
      } else {
        updated++;
      }
    } else {
      updated++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('OPPSUMMERING:');
  console.log('  Vil oppdatere: ' + updated);
  console.log('  Allerede satt: ' + alreadySet);
  console.log('  Uten Tripletex ID i CSV: ' + noTripletex);
  console.log('  Ikke funnet i DB: ' + notFound);

  if (DRY_RUN) {
    console.log('\nKjør med --fix for å utføre endringene:');
    if (hasExternalId) {
      console.log('  node scripts/fix-tripletex-ids.mjs --fix');
    } else {
      console.log('  node scripts/fix-tripletex-ids.mjs --fix --notater');
    }
  }
  console.log('='.repeat(60));
}

main().catch(console.error);

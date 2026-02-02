/**
 * Komplett fiks av database mot fasit
 * - Fikser datoer
 * - Fikser kategorier
 * - Fjerner duplikater
 * - Rapporterer kunder som ikke finnes i fasit
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
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
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
  const match = str.match(/^(\d{4})/);
  if (match) return parseInt(match[1]);
  return null;
}

function parseDate(yearStr, monthStr) {
  const year = parseYear(yearStr);
  if (!year) return null;
  const month = parseMonth(monthStr) || 2; // Default februar hvis ingen måned
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
  if (!str) return '';
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  console.log('='.repeat(70));
  console.log('KOMPLETT FIKS FRA FASIT');
  if (DRY_RUN) console.log('*** DRY RUN - INGEN ENDRINGER ***');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(FASIT_PATH);
  const content = iconv.decode(buffer, 'ISO-8859-1');
  const lines = content.split(/\r?\n/);

  // Parse fasit
  const fasitCustomers = [];
  for (let i = 12; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 20) continue;

    const navn = (cols[19] || '').trim();
    if (!navn || navn === 'Kunde' || navn.length < 3) continue;
    if (navn.includes('Har prøvd') || navn.includes('Jeg er i ferd') ||
        navn.includes('Jeg kan i tillegg') || navn.includes('Det å samle') ||
        navn.includes('Jeg ønsker') || navn.includes('Alternativt') ||
        navn.includes('Mvh ')) continue;

    const sisteElYear = (cols[3] || '').trim();
    const nesteElYear = (cols[4] || '').trim();
    const elMonth = (cols[5] || '').trim();
    const sisteBrannYear = (cols[8] || '').trim();
    const nesteBrannYear = (cols[9] || '').trim();
    const brannMonth = (cols[10] || '').trim();

    const hasEl = Boolean(parseYear(sisteElYear) || parseYear(nesteElYear));
    const hasBrann = Boolean(parseYear(sisteBrannYear) || parseYear(nesteBrannYear));

    let kategori;
    if (hasEl && hasBrann) kategori = 'El-Kontroll + Brannvarsling';
    else if (hasBrann) kategori = 'Brannvarsling';
    else if (hasEl) kategori = 'El-Kontroll';
    else continue;

    fasitCustomers.push({
      row: i + 1,
      navn,
      adresse: (cols[20] || '').trim() || null,
      postnummer: (cols[21] || '').trim() || null,
      poststed: (cols[22] || '').trim() || null,
      el_type: (cols[2] || '').trim() || null,
      siste_el_kontroll: parseDate(sisteElYear, elMonth),
      neste_el_kontroll: parseDate(nesteElYear, elMonth),
      el_kontroll_intervall: parseInterval(cols[6]),
      siste_brann_kontroll: parseDate(sisteBrannYear, brannMonth),
      neste_brann_kontroll: parseDate(nesteBrannYear, brannMonth),
      brann_system: (cols[11] || '').trim() || null,
      brann_driftstype: (cols[13] || '').trim() || null,
      kategori
    });
  }

  console.log(`Fasit kunder: ${fasitCustomers.length}`);

  // Fetch DB
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID);

  if (error) {
    console.error('DB feil:', error.message);
    process.exit(1);
  }

  console.log(`Database kunder: ${dbCustomers.length}`);

  // Statistics
  let updatedCount = 0;
  let duplicatesRemoved = 0;
  const updates = [];
  const matchedDbIds = new Set();

  // Find and remove duplicates first
  console.log('\n--- SJEKKER DUPLIKATER ---');
  const seenNames = new Map();
  const duplicateIds = [];

  for (const db of dbCustomers) {
    const key = normalizeString(db.navn);
    if (seenNames.has(key)) {
      const original = seenNames.get(key);
      console.log(`Duplikat: "${db.navn}" (ID ${db.id}) - beholder ID ${original.id}`);
      duplicateIds.push(db.id);
    } else {
      seenNames.set(key, db);
    }
  }

  if (duplicateIds.length > 0 && !DRY_RUN) {
    for (const id of duplicateIds) {
      const { error: delError } = await supabase
        .from('kunder')
        .delete()
        .eq('id', id);
      if (delError) {
        console.log(`  FEIL ved sletting ID ${id}: ${delError.message}`);
      } else {
        duplicatesRemoved++;
      }
    }
  } else {
    duplicatesRemoved = duplicateIds.length;
  }

  // Update from fasit
  console.log('\n--- OPPDATERER FRA FASIT ---');

  for (const fasit of fasitCustomers) {
    const dbMatch = dbCustomers.find(db =>
      normalizeString(db.navn) === normalizeString(fasit.navn) &&
      !duplicateIds.includes(db.id)
    );

    if (!dbMatch) continue;
    matchedDbIds.add(dbMatch.id);

    const updateFields = {};

    // Kategori
    if (normalizeString(dbMatch.kategori) !== normalizeString(fasit.kategori)) {
      updateFields.kategori = fasit.kategori;
    }

    // El-kontroll datoer
    if (fasit.siste_el_kontroll && dbMatch.siste_el_kontroll !== fasit.siste_el_kontroll) {
      updateFields.siste_el_kontroll = fasit.siste_el_kontroll;
    }
    if (fasit.neste_el_kontroll && dbMatch.neste_el_kontroll !== fasit.neste_el_kontroll) {
      updateFields.neste_el_kontroll = fasit.neste_el_kontroll;
    }

    // Brann datoer
    if (fasit.siste_brann_kontroll && dbMatch.siste_brann_kontroll !== fasit.siste_brann_kontroll) {
      updateFields.siste_brann_kontroll = fasit.siste_brann_kontroll;
    }
    if (fasit.neste_brann_kontroll && dbMatch.neste_brann_kontroll !== fasit.neste_brann_kontroll) {
      updateFields.neste_brann_kontroll = fasit.neste_brann_kontroll;
    }

    // El-type
    if (fasit.el_type && normalizeString(dbMatch.el_type) !== normalizeString(fasit.el_type)) {
      updateFields.el_type = fasit.el_type;
    }

    // Brann system
    if (fasit.brann_system && normalizeString(dbMatch.brann_system) !== normalizeString(fasit.brann_system)) {
      updateFields.brann_system = fasit.brann_system;
    }

    // Brann driftstype
    if (fasit.brann_driftstype && normalizeString(dbMatch.brann_driftstype) !== normalizeString(fasit.brann_driftstype)) {
      updateFields.brann_driftstype = fasit.brann_driftstype;
    }

    // Intervall
    if (fasit.el_kontroll_intervall && dbMatch.el_kontroll_intervall !== fasit.el_kontroll_intervall) {
      updateFields.el_kontroll_intervall = fasit.el_kontroll_intervall;
    }

    if (Object.keys(updateFields).length > 0) {
      updates.push({
        id: dbMatch.id,
        navn: dbMatch.navn,
        fields: updateFields
      });

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('kunder')
          .update(updateFields)
          .eq('id', dbMatch.id);

        if (updateError) {
          console.log(`FEIL ved ${dbMatch.navn}: ${updateError.message}`);
        } else {
          updatedCount++;
        }
      } else {
        updatedCount++;
      }
    }
  }

  // Report updates
  if (updates.length > 0) {
    console.log(`\nOppdateringer (${updates.length}):`);
    for (const u of updates.slice(0, 20)) {
      console.log(`  ${u.navn}:`);
      for (const [field, value] of Object.entries(u.fields)) {
        console.log(`    ${field} -> ${value}`);
      }
    }
    if (updates.length > 20) {
      console.log(`  ... og ${updates.length - 20} flere`);
    }
  }

  // Report customers not in fasit
  console.log('\n--- KUNDER IKKE I FASIT ---');
  const notInFasit = dbCustomers.filter(db =>
    !matchedDbIds.has(db.id) && !duplicateIds.includes(db.id)
  );

  if (notInFasit.length > 0) {
    console.log(`${notInFasit.length} kunder i database som ikke finnes i fasit:`);
    for (const c of notInFasit) {
      console.log(`  [ID ${c.id}] ${c.navn} - ${c.adresse || '(ingen adresse)'}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTAT');
  console.log('='.repeat(70));
  console.log(`Duplikater fjernet: ${duplicatesRemoved}`);
  console.log(`Kunder oppdatert: ${updatedCount}`);
  console.log(`Kunder ikke i fasit: ${notInFasit.length}`);

  if (DRY_RUN) {
    console.log('\n*** Kjør uten --dry-run for å utføre endringene ***');
  }
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Feil:', err);
  process.exit(1);
});

/**
 * Korrigerer kategorier basert på faktiske el-kontroll og brann datoer i fasit
 *
 * Logikk:
 * - hasEl = har datoer i col 3 eller 4 (siste/neste el-kontroll)
 * - hasBrann = har datoer i col 8 eller 9 (siste/neste brann)
 * - kategori bestemmes av kombinasjonen av hasEl og hasBrann
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

function parseYear(str) {
  if (!str || str === 'x') return null;
  const match = str.match(/^(\d{4})/);
  if (match) return parseInt(match[1]);
  return null;
}

function normalizeString(str) {
  if (!str) return '';
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  console.log('='.repeat(70));
  console.log('KORRIGERER KATEGORIER');
  if (DRY_RUN) console.log('*** DRY RUN ***');
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
    const sisteBrannYear = (cols[8] || '').trim();
    const nesteBrannYear = (cols[9] || '').trim();

    const hasEl = Boolean(parseYear(sisteElYear) || parseYear(nesteElYear));
    const hasBrann = Boolean(parseYear(sisteBrannYear) || parseYear(nesteBrannYear));

    let kategori;
    if (hasEl && hasBrann) kategori = 'El-Kontroll + Brannvarsling';
    else if (hasBrann) kategori = 'Brannvarsling';
    else if (hasEl) kategori = 'El-Kontroll';
    else continue;

    fasitCustomers.push({ navn, kategori });
  }

  console.log(`Fasit kunder: ${fasitCustomers.length}`);

  // Fetch DB
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('id, navn, kategori')
    .eq('organization_id', ORGANIZATION_ID);

  if (error) {
    console.error('DB feil:', error.message);
    process.exit(1);
  }

  console.log(`Database kunder: ${dbCustomers.length}`);

  // Find mismatches and fix
  let fixCount = 0;
  const changes = [];

  for (const fasit of fasitCustomers) {
    const dbMatch = dbCustomers.find(db => normalizeString(db.navn) === normalizeString(fasit.navn));
    if (!dbMatch) continue;

    if (normalizeString(dbMatch.kategori) !== normalizeString(fasit.kategori)) {
      changes.push({
        id: dbMatch.id,
        navn: dbMatch.navn,
        fra: dbMatch.kategori,
        til: fasit.kategori
      });

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('kunder')
          .update({ kategori: fasit.kategori })
          .eq('id', dbMatch.id);

        if (updateError) {
          console.log(`FEIL ved ${dbMatch.navn}: ${updateError.message}`);
        } else {
          fixCount++;
        }
      } else {
        fixCount++;
      }
    }
  }

  console.log('\n--- ENDRINGER ---');
  for (const c of changes) {
    console.log(`  ${c.navn}`);
    console.log(`    ${c.fra} -> ${c.til}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Endret: ${fixCount} kunder`);
  if (DRY_RUN) {
    console.log('\n*** Kjør uten --dry-run for å utføre endringene ***');
  }
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Feil:', err);
  process.exit(1);
});

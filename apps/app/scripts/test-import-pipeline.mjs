#!/usr/bin/env node
/**
 * Test Import Pipeline
 * Demonstrerer hele Excel import-flyten fra fil til database
 *
 * Bruk:
 *   node scripts/test-import-pipeline.mjs <excel-fil> [--org-id=X] [--dry-run] [--commit]
 *
 * Eksempel:
 *   node scripts/test-import-pipeline.mjs "./El-kontroll og brannvarsling 12.3 (1).csv" --org-id=5 --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import * as xlsx from 'xlsx';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ KONFIGURASJON ============

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Mangler SUPABASE_URL eller SUPABASE_ANON_KEY i miljøvariabler');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============ HJELPEFUNKSJONER ============

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    filePath: null,
    organizationId: 5, // Default
    dryRun: true,
    commit: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--org-id=')) {
      options.organizationId = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
      options.commit = false;
    } else if (arg === '--commit') {
      options.commit = true;
      options.dryRun = false;
    } else if (!arg.startsWith('--')) {
      options.filePath = arg;
    }
  }

  return options;
}

function createColumnFingerprint(headers) {
  const normalized = headers
    .map(h => h.toLowerCase().trim().replace(/\s+/g, '_'))
    .sort()
    .join('|');
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

// ============ PARSER ============

function parseFile(filePath) {
  console.log(`\n📂 Leser fil: ${filePath}`);

  const buffer = fs.readFileSync(filePath);
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  const workbook = xlsx.read(buffer, {
    type: 'buffer',
    cellDates: true,
    raw: false,
  });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rawData = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (rawData.length < 2) {
    throw new Error('Filen må inneholde minst en overskriftsrad og en datarad');
  }

  // Rens headers
  const headers = rawData[0].map((h, idx) => {
    const cleaned = String(h || '').trim();
    return cleaned || `Kolonne_${idx + 1}`;
  });

  // Konverter til objekter
  const rows = [];
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const isEmpty = row.every(cell => !cell || String(cell).trim() === '');
    if (isEmpty) continue;

    const rowObj = {};
    headers.forEach((header, idx) => {
      const value = row[idx];
      rowObj[header] = value !== undefined && value !== null && String(value).trim() !== ''
        ? String(value).trim()
        : null;
    });
    rows.push(rowObj);
  }

  const fingerprint = createColumnFingerprint(headers);

  console.log(`   ✅ Lest ${rows.length} rader med ${headers.length} kolonner`);
  console.log(`   📋 Kolonner: ${headers.slice(0, 5).join(', ')}${headers.length > 5 ? '...' : ''}`);
  console.log(`   🔑 Fingerprint: ${fingerprint}`);

  return {
    headers,
    rows,
    fileHash,
    fingerprint,
    fileName: path.basename(filePath),
    fileSize: buffer.length,
  };
}

// ============ KOLONNE-MAPPING (regelbasert) ============

function suggestMappings(headers) {
  console.log('\n🤖 Foreslår kolonne-mappinger...');

  const patterns = [
    { pattern: /^(kunde)?navn$/i, targetField: 'navn' },
    { pattern: /^(firma|bedrift|selskap)/i, targetField: 'navn' },
    { pattern: /^adresse$/i, targetField: 'adresse' },
    { pattern: /^(gate|vei)/i, targetField: 'adresse' },
    { pattern: /^post(nummer|nr)?$/i, targetField: 'postnummer' },
    { pattern: /^(post)?sted$/i, targetField: 'poststed' },
    { pattern: /^(tele)?fon$/i, targetField: 'telefon' },
    { pattern: /^mobil/i, targetField: 'telefon' },
    { pattern: /^tlf$/i, targetField: 'telefon' },
    { pattern: /^e?-?post$/i, targetField: 'epost' },
    { pattern: /^email$/i, targetField: 'epost' },
    { pattern: /^kontakt/i, targetField: 'kontaktperson' },
    { pattern: /^notat/i, targetField: 'notater' },
    { pattern: /^merknad/i, targetField: 'notater' },
    { pattern: /^kommentar/i, targetField: 'notater' },
    { pattern: /^kategori$/i, targetField: 'kategori' },
    { pattern: /^type$/i, targetField: 'kategori' },
    // Datoer
    { pattern: /^siste.*(kontroll|utført)/i, targetField: 'siste_kontroll' },
    { pattern: /^(utført|dato).*(kontroll)?/i, targetField: 'siste_kontroll' },
    { pattern: /^neste.*(kontroll|dato)/i, targetField: 'neste_kontroll' },
    { pattern: /^forfaller?$/i, targetField: 'neste_kontroll' },
  ];

  const mappings = [];
  const usedTargets = new Set();

  for (const header of headers) {
    let matched = false;

    for (const { pattern, targetField } of patterns) {
      if (pattern.test(header) && !usedTargets.has(targetField)) {
        mappings.push({
          sourceColumn: header,
          targetField,
          confidence: 0.9,
        });
        usedTargets.add(targetField);
        matched = true;
        break;
      }
    }

    if (!matched) {
      mappings.push({
        sourceColumn: header,
        targetField: null,
        confidence: 0,
      });
    }
  }

  const mapped = mappings.filter(m => m.targetField);
  console.log(`   ✅ ${mapped.length}/${headers.length} kolonner mappet automatisk`);

  for (const m of mapped) {
    console.log(`      ${m.sourceColumn} → ${m.targetField}`);
  }

  const unmapped = mappings.filter(m => !m.targetField);
  if (unmapped.length > 0) {
    console.log(`   ⚠️  ${unmapped.length} kolonner ikke mappet: ${unmapped.map(m => m.sourceColumn).join(', ')}`);
  }

  return mappings;
}

// ============ TRANSFORMASJON ============

function transformRow(row, mappings) {
  const result = {};

  for (const mapping of mappings) {
    if (!mapping.targetField) continue;

    const value = row[mapping.sourceColumn];
    if (value === null || value === undefined) {
      result[mapping.targetField] = null;
      continue;
    }

    let transformed = String(value).trim();

    // Dato-transformasjon
    if (mapping.targetField.includes('kontroll') || mapping.targetField.includes('dato')) {
      transformed = parseDate(transformed);
    }

    // Postnummer
    if (mapping.targetField === 'postnummer') {
      const digits = transformed.replace(/\D/g, '');
      if (digits.length === 4) {
        transformed = digits;
      } else if (digits.length === 3) {
        transformed = '0' + digits;
      }
    }

    // Telefon
    if (mapping.targetField === 'telefon') {
      transformed = formatPhone(transformed);
    }

    // E-post
    if (mapping.targetField === 'epost') {
      transformed = transformed.toLowerCase();
    }

    result[mapping.targetField] = transformed || null;
  }

  return result;
}

function parseDate(value) {
  if (!value) return null;

  // DD.MM.YYYY eller DD/MM/YYYY
  const match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);

    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // MM.YYYY
  const monthYearMatch = value.match(/^(\d{1,2})[./-](\d{4})$/);
  if (monthYearMatch) {
    const month = parseInt(monthYearMatch[1], 10);
    const year = parseInt(monthYearMatch[2], 10);

    if (month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-01`;
    }
  }

  // YYYY-MM-DD (allerede riktig format)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return null;
}

function formatPhone(value) {
  if (!value) return null;

  let digits = value.replace(/[^\d+]/g, '');

  if (digits.startsWith('+47')) digits = digits.slice(3);
  else if (digits.startsWith('0047')) digits = digits.slice(4);
  else if (digits.startsWith('47') && digits.length > 10) digits = digits.slice(2);

  if (digits.length === 8) {
    return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)}`;
  }

  return digits;
}

// ============ VALIDERING ============

function validateRow(mappedData, rowNumber) {
  const errors = [];
  const warnings = [];

  // Påkrevd: navn
  if (!mappedData.navn || mappedData.navn.length < 2) {
    errors.push({
      field: 'navn',
      message: 'Navn er påkrevd og må være minst 2 tegn',
      value: mappedData.navn,
    });
  }

  // Påkrevd: adresse
  if (!mappedData.adresse || mappedData.adresse.length < 3) {
    errors.push({
      field: 'adresse',
      message: 'Adresse er påkrevd og må være minst 3 tegn',
      value: mappedData.adresse,
    });
  }

  // Påkrevd: siste_kontroll
  if (!mappedData.siste_kontroll) {
    errors.push({
      field: 'siste_kontroll',
      message: 'Dato for utført kontroll er påkrevd',
      value: mappedData.siste_kontroll,
    });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(mappedData.siste_kontroll)) {
    errors.push({
      field: 'siste_kontroll',
      message: 'Ugyldig datoformat (forventet YYYY-MM-DD)',
      value: mappedData.siste_kontroll,
    });
  }

  // Påkrevd: neste_kontroll
  if (!mappedData.neste_kontroll) {
    errors.push({
      field: 'neste_kontroll',
      message: 'Dato for neste kontroll er påkrevd',
      value: mappedData.neste_kontroll,
    });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(mappedData.neste_kontroll)) {
    errors.push({
      field: 'neste_kontroll',
      message: 'Ugyldig datoformat (forventet YYYY-MM-DD)',
      value: mappedData.neste_kontroll,
    });
  }

  // Advarsel: neste bør være etter siste
  if (mappedData.siste_kontroll && mappedData.neste_kontroll) {
    if (new Date(mappedData.neste_kontroll) <= new Date(mappedData.siste_kontroll)) {
      warnings.push({
        field: 'neste_kontroll',
        message: 'Neste kontroll bør være etter siste utførte kontroll',
        value: mappedData.neste_kontroll,
      });
    }
  }

  // Valgfritt: e-post format
  if (mappedData.epost && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mappedData.epost)) {
    errors.push({
      field: 'epost',
      message: 'Ugyldig e-postformat',
      value: mappedData.epost,
    });
  }

  // Valgfritt: postnummer
  if (mappedData.postnummer && !/^\d{4}$/.test(mappedData.postnummer)) {
    errors.push({
      field: 'postnummer',
      message: 'Postnummer må være 4 siffer',
      value: mappedData.postnummer,
    });
  }

  return {
    rowNumber,
    isValid: errors.length === 0,
    hasWarnings: warnings.length > 0,
    errors,
    warnings,
  };
}

// ============ DATABASE-OPERASJONER ============

async function findExistingKunde(organizationId, navn, adresse) {
  const { data, error } = await supabase
    .from('kunder')
    .select('id, navn, adresse')
    .eq('organization_id', organizationId)
    .ilike('navn', navn)
    .ilike('adresse', adresse)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Feil ved søk:', error);
    return null;
  }

  return data;
}

async function createKunde(organizationId, data) {
  const { data: kunde, error } = await supabase
    .from('kunder')
    .insert({
      ...data,
      organization_id: organizationId,
      opprettet: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Kunne ikke opprette kunde: ${error.message}`);
  }

  return kunde;
}

async function updateKunde(id, organizationId, data) {
  const { error } = await supabase
    .from('kunder')
    .update(data)
    .eq('id', id)
    .eq('organization_id', organizationId);

  if (error) {
    throw new Error(`Kunne ikke oppdatere kunde: ${error.message}`);
  }
}

// ============ HOVEDFUNKSJON ============

async function main() {
  const options = parseArgs();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    IMPORT PIPELINE TEST');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📁 Fil: ${options.filePath || '(ingen fil spesifisert)'}`);
  console.log(`🏢 Organization ID: ${options.organizationId}`);
  console.log(`🔄 Modus: ${options.commit ? 'COMMIT (vil lagre data)' : 'DRY-RUN (kun test)'}`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (!options.filePath) {
    console.error('\n❌ Ingen fil spesifisert!');
    console.log('\nBruk:');
    console.log('  node scripts/test-import-pipeline.mjs <fil.xlsx> [--org-id=X] [--dry-run|--commit]');
    console.log('\nEksempel:');
    console.log('  node scripts/test-import-pipeline.mjs "./data.xlsx" --org-id=5 --dry-run');
    process.exit(1);
  }

  if (!fs.existsSync(options.filePath)) {
    console.error(`\n❌ Filen finnes ikke: ${options.filePath}`);
    process.exit(1);
  }

  // STEG 1: Parse fil
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ STEG 1: PARSE FIL                                           │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  const parsed = parseFile(options.filePath);

  // STEG 2: Foreslå mappinger
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ STEG 2: KOLONNE-MAPPING                                     │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  const mappings = suggestMappings(parsed.headers);

  // STEG 3: Transformer og valider
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ STEG 3: TRANSFORMASJON OG VALIDERING                        │');
  console.log('└─────────────────────────────────────────────────────────────┘');

  const results = {
    valid: [],
    invalid: [],
    warnings: [],
  };

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const mappedData = transformRow(row, mappings);
    const validation = validateRow(mappedData, i + 2); // Excel row number

    if (validation.isValid) {
      results.valid.push({ rowNumber: i + 2, data: mappedData, validation });
      if (validation.hasWarnings) {
        results.warnings.push(validation);
      }
    } else {
      results.invalid.push({ rowNumber: i + 2, data: mappedData, validation });
    }
  }

  console.log(`\n   📊 Valideringsresultat:`);
  console.log(`      ✅ Gyldige rader:   ${results.valid.length}`);
  console.log(`      ⚠️  Med advarsler:   ${results.warnings.length}`);
  console.log(`      ❌ Ugyldige rader:  ${results.invalid.length}`);

  // Vis første 5 feil
  if (results.invalid.length > 0) {
    console.log(`\n   ❌ Eksempler på feil (maks 5):`);
    for (const item of results.invalid.slice(0, 5)) {
      console.log(`      Rad ${item.rowNumber}: ${item.validation.errors.map(e => e.message).join(', ')}`);
    }
  }

  // STEG 4: Commit (eller dry-run)
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ STEG 4: COMMIT TIL DATABASE                                 │');
  console.log('└─────────────────────────────────────────────────────────────┘');

  if (!options.commit) {
    console.log('\n   ⏸️  DRY-RUN modus - ingen data lagres');
    console.log(`   💡 Kjør med --commit for å lagre ${results.valid.length} gyldige rader`);
  } else {
    console.log(`\n   🚀 Starter commit av ${results.valid.length} rader...`);

    const commitResults = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    for (const item of results.valid) {
      try {
        const existing = await findExistingKunde(
          options.organizationId,
          item.data.navn,
          item.data.adresse
        );

        if (existing) {
          await updateKunde(existing.id, options.organizationId, item.data);
          commitResults.updated++;
          process.stdout.write('U');
        } else {
          await createKunde(options.organizationId, item.data);
          commitResults.created++;
          process.stdout.write('C');
        }
      } catch (error) {
        commitResults.failed++;
        process.stdout.write('X');
        console.error(`\n      ❌ Rad ${item.rowNumber}: ${error.message}`);
      }
    }

    console.log('\n');
    console.log(`   📊 Commit-resultat:`);
    console.log(`      ✅ Opprettet: ${commitResults.created}`);
    console.log(`      🔄 Oppdatert: ${commitResults.updated}`);
    console.log(`      ❌ Feilet:    ${commitResults.failed}`);
  }

  // OPPSUMMERING
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         FERDIG');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(error => {
  console.error('\n❌ Fatal feil:', error.message);
  process.exit(1);
});

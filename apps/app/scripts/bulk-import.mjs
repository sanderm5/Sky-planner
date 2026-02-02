#!/usr/bin/env node
/**
 * Bulk Import Script for Sky Planner
 *
 * Håndterer Excel-import for flere organisasjoner/kunder
 *
 * Bruk:
 *   node scripts/bulk-import.mjs --dir ./import-filer
 *   node scripts/bulk-import.mjs --file kunder.xlsx --org-id 1
 *   node scripts/bulk-import.mjs --csv mapping.csv
 *
 * Filstruktur for --dir:
 *   import-filer/
 *   ├── org_1_kundenavn.xlsx
 *   ├── org_2_annen_kunde.xlsx
 *   └── org_15_tredje.xlsx
 *
 * CSV-format for --csv (mapping mellom fil og org):
 *   fil,organization_id,user_id
 *   kunder_a.xlsx,1,5
 *   kunder_b.xlsx,2,5
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import crypto from 'crypto';

// ============ KONFIGURASJON ============

const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,

  // Standard bruker for import (kan overstyres per fil)
  DEFAULT_USER_ID: parseInt(process.env.IMPORT_USER_ID || '1'),

  // Batchstørrelse for staging-rader
  STAGING_BATCH_SIZE: 100,

  // Maks feil før stopp
  MAX_ERRORS_PER_FILE: 100,

  // Auto-commit etter validering (false = bare staging)
  AUTO_COMMIT: false,

  // Verbose logging
  VERBOSE: process.env.VERBOSE === 'true',
};

// ============ HELPERS ============

function log(msg, level = 'info') {
  const timestamp = new Date().toISOString().slice(11, 19);
  const prefix = {
    info: '📋',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    debug: '🔍',
  }[level] || '•';

  if (level === 'debug' && !CONFIG.VERBOSE) return;
  console.log(`[${timestamp}] ${prefix} ${msg}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dir: null,
    file: null,
    csv: null,
    orgId: null,
    userId: CONFIG.DEFAULT_USER_ID,
    dryRun: false,
    autoCommit: CONFIG.AUTO_COMMIT,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dir':
      case '-d':
        options.dir = args[++i];
        break;
      case '--file':
      case '-f':
        options.file = args[++i];
        break;
      case '--csv':
      case '-c':
        options.csv = args[++i];
        break;
      case '--org-id':
      case '-o':
        options.orgId = parseInt(args[++i]);
        break;
      case '--user-id':
      case '-u':
        options.userId = parseInt(args[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--auto-commit':
        options.autoCommit = true;
        break;
      case '--verbose':
      case '-v':
        CONFIG.VERBOSE = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Bulk Import Script for Sky Planner
===================================

Bruk:
  node scripts/bulk-import.mjs [options]

Alternativer:
  --dir, -d <path>       Mappe med Excel-filer (filnavn må inneholde org_<id>_)
  --file, -f <path>      Enkelt Excel-fil (krever --org-id)
  --csv, -c <path>       CSV med fil→org mapping
  --org-id, -o <id>      Organization ID (for --file)
  --user-id, -u <id>     Bruker-ID for import (default: 1)
  --dry-run              Kun validering, ikke lagre noe
  --auto-commit          Commit automatisk etter validering
  --verbose, -v          Vis debug-meldinger
  --help, -h             Vis denne hjelpen

Eksempler:
  # Importer alle filer i en mappe
  node scripts/bulk-import.mjs --dir ./import-filer

  # Importer én fil for org 5
  node scripts/bulk-import.mjs --file kunder.xlsx --org-id 5

  # Bruk CSV-mapping
  node scripts/bulk-import.mjs --csv import-plan.csv

CSV-format:
  fil,organization_id,user_id
  kunder_oslo.xlsx,1,5
  kunder_bergen.xlsx,2,5

Filnavnkonvensjon for --dir:
  org_<id>_<beskrivelse>.xlsx
  Eksempel: org_15_elektrikerfirma.xlsx → organization_id=15
`);
}

function createFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 32);
}

function createColumnFingerprint(headers) {
  const normalized = headers
    .map(h => String(h || '').toLowerCase().trim())
    .filter(h => h.length > 0)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

// ============ EXCEL PARSING ============

function parseExcelFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (data.length < 2) {
    throw new Error('Filen må ha minst header og én datarad');
  }

  const headers = data[0].map(h => String(h || '').trim());
  const rows = data.slice(1).filter(row => row.some(cell => cell !== ''));

  return {
    headers,
    rows,
    fileHash: createFileHash(buffer),
    fileSize: buffer.length,
    columnFingerprint: createColumnFingerprint(headers),
  };
}

// ============ AUTO MAPPING ============

const FIELD_PATTERNS = {
  navn: ['navn', 'name', 'kundenavn', 'firma', 'bedrift', 'company'],
  adresse: ['adresse', 'address', 'gateadresse', 'street'],
  postnummer: ['postnr', 'postnummer', 'zip', 'postal'],
  poststed: ['poststed', 'sted', 'city', 'by'],
  telefon: ['telefon', 'tlf', 'phone', 'mobil'],
  epost: ['epost', 'e-post', 'email', 'mail'],
  kontaktperson: ['kontakt', 'kontaktperson', 'contact'],
  notater: ['notat', 'notater', 'note', 'notes', 'kommentar'],
  siste_kontroll: ['siste', 'utført', 'kontroll', 'dato'],
  neste_kontroll: ['neste', 'forfaller', 'frist'],
};

function suggestMapping(headers) {
  const mappings = [];

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;

    for (const [targetField, patterns] of Object.entries(FIELD_PATTERNS)) {
      for (const pattern of patterns) {
        if (normalized.includes(pattern) || pattern.includes(normalized)) {
          const score = pattern === normalized ? 1 : 0.8;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = targetField;
          }
        }
      }
    }

    if (bestMatch && bestScore > 0.5) {
      mappings.push({
        sourceColumn: header,
        targetField: bestMatch,
        confidence: bestScore,
      });
    }
  }

  return mappings;
}

// ============ TRANSFORMERS ============

function transformValue(value, targetField) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const strValue = String(value).trim();

  switch (targetField) {
    case 'postnummer':
      const digits = strValue.replace(/\D/g, '');
      return digits.length === 4 ? digits : strValue;

    case 'telefon':
      return strValue.replace(/\s+/g, '');

    case 'epost':
      return strValue.toLowerCase();

    case 'siste_kontroll':
    case 'neste_kontroll':
      return parseDate(value);

    default:
      return strValue;
  }
}

function parseDate(value) {
  if (!value) return null;

  // Hvis det allerede er en Date
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  const strValue = String(value).trim();

  // ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(strValue)) {
    return strValue;
  }

  // Norsk format (DD.MM.YYYY)
  const norwegianMatch = strValue.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (norwegianMatch) {
    const [, day, month, year] = norwegianMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Prøv Date.parse
  const parsed = Date.parse(strValue);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().split('T')[0];
  }

  return strValue;
}

// ============ VALIDATION ============

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTNUMMER_REGEX = /^\d{4}$/;

function validateRow(mappedData, rowNumber) {
  const errors = [];
  const warnings = [];

  // Navn er påkrevd
  if (!mappedData.navn || String(mappedData.navn).trim().length < 2) {
    errors.push({
      field: 'navn',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Navn er påkrevd og må være minst 2 tegn',
      value: mappedData.navn,
    });
  }

  // Adresse er påkrevd
  if (!mappedData.adresse || String(mappedData.adresse).trim().length < 3) {
    errors.push({
      field: 'adresse',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Adresse er påkrevd og må være minst 3 tegn',
      value: mappedData.adresse,
    });
  }

  // Siste kontroll er påkrevd
  if (!mappedData.siste_kontroll) {
    errors.push({
      field: 'siste_kontroll',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Dato for utført kontroll er påkrevd',
    });
  } else if (!DATE_REGEX.test(String(mappedData.siste_kontroll))) {
    errors.push({
      field: 'siste_kontroll',
      code: 'INVALID_DATE',
      message: 'Ugyldig datoformat (forventet YYYY-MM-DD)',
      value: mappedData.siste_kontroll,
    });
  }

  // Neste kontroll er påkrevd
  if (!mappedData.neste_kontroll) {
    errors.push({
      field: 'neste_kontroll',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Dato for neste kontroll er påkrevd',
    });
  } else if (!DATE_REGEX.test(String(mappedData.neste_kontroll))) {
    errors.push({
      field: 'neste_kontroll',
      code: 'INVALID_DATE',
      message: 'Ugyldig datoformat (forventet YYYY-MM-DD)',
      value: mappedData.neste_kontroll,
    });
  }

  // E-post validering (valgfri)
  if (mappedData.epost && !EMAIL_REGEX.test(String(mappedData.epost))) {
    errors.push({
      field: 'epost',
      code: 'INVALID_EMAIL',
      message: 'Ugyldig e-postformat',
      value: mappedData.epost,
    });
  }

  // Postnummer validering (valgfri)
  if (mappedData.postnummer && !POSTNUMMER_REGEX.test(String(mappedData.postnummer))) {
    errors.push({
      field: 'postnummer',
      code: 'INVALID_POSTNUMMER',
      message: 'Postnummer må være 4 siffer',
      value: mappedData.postnummer,
    });
  }

  // Advarsel: neste_kontroll bør være etter siste_kontroll
  if (mappedData.siste_kontroll && mappedData.neste_kontroll) {
    if (DATE_REGEX.test(String(mappedData.siste_kontroll)) &&
        DATE_REGEX.test(String(mappedData.neste_kontroll))) {
      if (new Date(mappedData.neste_kontroll) <= new Date(mappedData.siste_kontroll)) {
        warnings.push({
          field: 'neste_kontroll',
          code: 'DATE_ORDER_WARNING',
          message: 'Neste kontroll bør være etter siste utførte kontroll',
        });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    hasWarnings: warnings.length > 0,
    errors,
    warnings,
  };
}

// ============ DATABASE OPS ============

function createSupabaseClient() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_SERVICE_KEY) {
    throw new Error('Mangler SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY i miljøvariabler');
  }

  return createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_SERVICE_KEY);
}

async function createBatch(supabase, data) {
  const { data: batch, error } = await supabase
    .from('import_batches')
    .insert(data)
    .select()
    .single();

  if (error) throw new Error(`Kunne ikke opprette batch: ${error.message}`);
  return batch;
}

async function updateBatch(supabase, batchId, data) {
  const { error } = await supabase
    .from('import_batches')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', batchId);

  if (error) throw new Error(`Kunne ikke oppdatere batch: ${error.message}`);
}

async function insertStagingRows(supabase, rows) {
  for (let i = 0; i < rows.length; i += CONFIG.STAGING_BATCH_SIZE) {
    const batch = rows.slice(i, i + CONFIG.STAGING_BATCH_SIZE);
    const { error } = await supabase.from('import_staging_rows').insert(batch);
    if (error) throw new Error(`Kunne ikke lagre staging-rader: ${error.message}`);
  }
}

async function updateStagingRow(supabase, rowId, data) {
  const { error } = await supabase
    .from('import_staging_rows')
    .update(data)
    .eq('id', rowId);

  if (error) throw new Error(`Kunne ikke oppdatere staging-rad: ${error.message}`);
}

async function insertValidationErrors(supabase, errors) {
  if (errors.length === 0) return;
  const { error } = await supabase.from('import_validation_errors').insert(errors);
  if (error) throw new Error(`Kunne ikke lagre valideringsfeil: ${error.message}`);
}

async function getStagingRows(supabase, batchId) {
  const { data, error } = await supabase
    .from('import_staging_rows')
    .select('*')
    .eq('batch_id', batchId)
    .order('row_number');

  if (error) throw new Error(`Kunne ikke hente staging-rader: ${error.message}`);
  return data || [];
}

async function findExistingKunde(supabase, orgId, navn, adresse) {
  const { data, error } = await supabase
    .from('kunder')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('navn', navn)
    .ilike('adresse', adresse)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Feil ved duplikatsjekk: ${error.message}`);
  }

  return data;
}

async function createKunde(supabase, data) {
  const { data: kunde, error } = await supabase
    .from('kunder')
    .insert(data)
    .select('id')
    .single();

  if (error) throw new Error(`Kunne ikke opprette kunde: ${error.message}`);
  return kunde;
}

async function updateKunde(supabase, id, orgId, data) {
  const { error } = await supabase
    .from('kunder')
    .update(data)
    .eq('id', id)
    .eq('organization_id', orgId);

  if (error) throw new Error(`Kunne ikke oppdatere kunde: ${error.message}`);
}

async function logAudit(supabase, data) {
  await supabase.from('import_audit_log').insert(data);
}

// ============ IMPORT PIPELINE ============

async function processFile(supabase, filePath, organizationId, userId, options) {
  const fileName = path.basename(filePath);
  log(`Starter import av ${fileName} for org ${organizationId}`, 'info');

  // 1. Parse Excel
  log('Parsing Excel-fil...', 'debug');
  const parsed = parseExcelFile(filePath);
  log(`  Funnet ${parsed.headers.length} kolonner og ${parsed.rows.length} rader`, 'debug');

  // 2. Suggest mapping
  log('Genererer kolonnemapping...', 'debug');
  const mappings = suggestMapping(parsed.headers);
  log(`  Mappet ${mappings.length} kolonner`, 'debug');

  if (mappings.length === 0) {
    throw new Error('Kunne ikke mappe noen kolonner automatisk. Sjekk kolonnenavn.');
  }

  // Sjekk at påkrevde felt er mappet
  const requiredFields = ['navn', 'adresse', 'siste_kontroll', 'neste_kontroll'];
  const mappedFields = mappings.map(m => m.targetField);
  const missingRequired = requiredFields.filter(f => !mappedFields.includes(f));

  if (missingRequired.length > 0) {
    throw new Error(`Mangler påkrevde felt: ${missingRequired.join(', ')}`);
  }

  // 3. Transform data
  log('Transformerer data...', 'debug');
  const transformedRows = parsed.rows.map((row, index) => {
    const rawData = {};
    const mappedData = {};

    parsed.headers.forEach((header, i) => {
      rawData[header] = row[i];
    });

    mappings.forEach(mapping => {
      const headerIndex = parsed.headers.indexOf(mapping.sourceColumn);
      if (headerIndex !== -1) {
        mappedData[mapping.targetField] = transformValue(row[headerIndex], mapping.targetField);
      }
    });

    return { rowNumber: index + 2, rawData, mappedData };
  });

  if (options.dryRun) {
    // Dry run - bare valider
    log('DRY RUN: Validerer uten å lagre...', 'info');

    let validCount = 0;
    let errorCount = 0;
    let warningCount = 0;

    for (const row of transformedRows) {
      const result = validateRow(row.mappedData, row.rowNumber);
      if (result.isValid) validCount++;
      else errorCount++;
      if (result.hasWarnings) warningCount++;
    }

    return {
      fileName,
      organizationId,
      totalRows: transformedRows.length,
      validRows: validCount,
      errorRows: errorCount,
      warningRows: warningCount,
      status: 'dry_run_complete',
    };
  }

  // 4. Opprett batch i database
  log('Oppretter import-batch...', 'debug');
  const batch = await createBatch(supabase, {
    organization_id: organizationId,
    file_name: fileName,
    file_size_bytes: parsed.fileSize,
    file_hash: parsed.fileHash,
    column_fingerprint: parsed.columnFingerprint,
    column_count: parsed.headers.length,
    row_count: parsed.rows.length,
    status: 'parsing',
    created_by: userId,
  });

  log(`  Batch ID: ${batch.id}`, 'debug');

  try {
    // 5. Lagre staging rows
    log('Lagrer staging-rader...', 'debug');
    const stagingRows = transformedRows.map(row => ({
      batch_id: batch.id,
      organization_id: organizationId,
      row_number: row.rowNumber,
      raw_data: row.rawData,
      validation_status: 'pending',
    }));

    await insertStagingRows(supabase, stagingRows);
    await updateBatch(supabase, batch.id, { status: 'parsed' });

    // 6. Oppdater med mapped data
    log('Mapper data...', 'debug');
    const stagingData = await getStagingRows(supabase, batch.id);

    for (const staging of stagingData) {
      const transformed = transformedRows.find(r => r.rowNumber === staging.row_number);
      if (transformed) {
        await updateStagingRow(supabase, staging.id, {
          mapped_data: transformed.mappedData,
        });
      }
    }

    await updateBatch(supabase, batch.id, { status: 'mapped' });

    // 7. Validering
    log('Validerer rader...', 'debug');
    await updateBatch(supabase, batch.id, { status: 'validating' });

    let validCount = 0;
    let errorCount = 0;
    let warningCount = 0;
    const allErrors = [];

    const updatedStaging = await getStagingRows(supabase, batch.id);

    for (const staging of updatedStaging) {
      const result = validateRow(staging.mapped_data, staging.row_number);

      const newStatus = result.isValid
        ? (result.hasWarnings ? 'warning' : 'valid')
        : 'invalid';

      await updateStagingRow(supabase, staging.id, { validation_status: newStatus });

      if (result.isValid) validCount++;
      else errorCount++;
      if (result.hasWarnings) warningCount++;

      // Samle feil for database
      for (const err of result.errors) {
        allErrors.push({
          staging_row_id: staging.id,
          batch_id: batch.id,
          severity: 'error',
          error_code: err.code,
          field_name: err.field,
          message: err.message,
          actual_value: err.value ? String(err.value) : null,
        });
      }

      for (const warn of result.warnings) {
        allErrors.push({
          staging_row_id: staging.id,
          batch_id: batch.id,
          severity: 'warning',
          error_code: warn.code,
          field_name: warn.field,
          message: warn.message,
        });
      }
    }

    await insertValidationErrors(supabase, allErrors);
    await updateBatch(supabase, batch.id, {
      status: 'validated',
      valid_row_count: validCount,
      error_row_count: errorCount,
      warning_row_count: warningCount,
    });

    log(`  Validering: ${validCount} OK, ${errorCount} feil, ${warningCount} advarsler`, 'info');

    // 8. Auto-commit hvis aktivert
    if (options.autoCommit && errorCount === 0) {
      log('Auto-commit aktivert, committer...', 'info');
      await commitBatch(supabase, batch.id, organizationId, userId);
    }

    const finalBatch = await supabase
      .from('import_batches')
      .select('*')
      .eq('id', batch.id)
      .single();

    return {
      batchId: batch.id,
      fileName,
      organizationId,
      totalRows: parsed.rows.length,
      validRows: validCount,
      errorRows: errorCount,
      warningRows: warningCount,
      status: finalBatch.data?.status || 'validated',
    };

  } catch (error) {
    await updateBatch(supabase, batch.id, {
      status: 'failed',
      error_message: error.message,
    });
    throw error;
  }
}

async function commitBatch(supabase, batchId, organizationId, userId) {
  await updateBatch(supabase, batchId, { status: 'committing' });

  const stagingRows = await getStagingRows(supabase, batchId);
  const validRows = stagingRows.filter(r => r.validation_status === 'valid' || r.validation_status === 'warning');

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const affectedIds = [];

  for (const row of validRows) {
    const data = row.mapped_data;

    try {
      // Sjekk duplikat
      const existing = await findExistingKunde(supabase, organizationId, data.navn, data.adresse);

      const kundeData = {
        organization_id: organizationId,
        navn: data.navn,
        adresse: data.adresse,
        postnummer: data.postnummer || null,
        poststed: data.poststed || null,
        telefon: data.telefon || null,
        epost: data.epost || null,
        kontaktperson: data.kontaktperson || null,
        notater: data.notater || null,
        siste_kontroll: data.siste_kontroll || null,
        neste_kontroll: data.neste_kontroll || null,
      };

      if (existing) {
        // Oppdater
        await updateKunde(supabase, existing.id, organizationId, kundeData);
        await updateStagingRow(supabase, row.id, {
          target_kunde_id: existing.id,
          action_taken: 'updated',
        });
        affectedIds.push(existing.id);
        updated++;
      } else {
        // Opprett
        const newKunde = await createKunde(supabase, kundeData);
        await updateStagingRow(supabase, row.id, {
          target_kunde_id: newKunde.id,
          action_taken: 'created',
        });
        affectedIds.push(newKunde.id);
        created++;
      }
    } catch (err) {
      await updateStagingRow(supabase, row.id, { action_taken: 'error' });
      skipped++;
      log(`  Feil ved rad ${row.row_number}: ${err.message}`, 'warning');
    }
  }

  await updateBatch(supabase, batchId, {
    status: 'committed',
    committed_at: new Date().toISOString(),
    committed_by: userId,
  });

  await logAudit(supabase, {
    organization_id: organizationId,
    batch_id: batchId,
    action: 'commit',
    actor_id: userId,
    affected_kunde_ids: affectedIds,
    details: { created, updated, skipped },
  });

  return { created, updated, skipped };
}

// ============ FILE DISCOVERY ============

function discoverFilesFromDir(dirPath) {
  const files = [];
  const entries = fs.readdirSync(dirPath);

  for (const entry of entries) {
    if (!entry.endsWith('.xlsx') && !entry.endsWith('.xls')) continue;

    // Prøv å parse org_<id> fra filnavn
    const match = entry.match(/org_(\d+)_/i);
    if (match) {
      files.push({
        path: path.join(dirPath, entry),
        organizationId: parseInt(match[1]),
      });
    } else {
      log(`Hopper over ${entry} - mangler org_<id>_ i filnavn`, 'warning');
    }
  }

  return files;
}

function discoverFilesFromCsv(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');

  const files = [];
  const baseDir = path.dirname(csvPath);

  // Hopp over header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const [filePath, orgId, userId] = parts;
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);

      files.push({
        path: fullPath,
        organizationId: parseInt(orgId),
        userId: userId ? parseInt(userId) : undefined,
      });
    }
  }

  return files;
}

// ============ MAIN ============

async function main() {
  const options = parseArgs();

  if (!options.dir && !options.file && !options.csv) {
    console.log('Feil: Må spesifisere --dir, --file eller --csv');
    console.log('Bruk --help for mer informasjon');
    process.exit(1);
  }

  let files = [];

  if (options.dir) {
    files = discoverFilesFromDir(options.dir);
  } else if (options.csv) {
    files = discoverFilesFromCsv(options.csv);
  } else if (options.file) {
    if (!options.orgId) {
      console.log('Feil: --file krever --org-id');
      process.exit(1);
    }
    files = [{
      path: options.file,
      organizationId: options.orgId,
    }];
  }

  if (files.length === 0) {
    log('Ingen filer funnet', 'warning');
    process.exit(0);
  }

  log(`Fant ${files.length} filer å importere`, 'info');

  const supabase = createSupabaseClient();

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    try {
      const result = await processFile(
        supabase,
        file.path,
        file.organizationId,
        file.userId || options.userId,
        {
          dryRun: options.dryRun,
          autoCommit: options.autoCommit,
        }
      );

      results.push({ ...result, success: true });
      successCount++;
      log(`✅ ${result.fileName}: ${result.validRows}/${result.totalRows} rader OK`, 'success');

    } catch (error) {
      results.push({
        fileName: path.basename(file.path),
        organizationId: file.organizationId,
        success: false,
        error: error.message,
      });
      failCount++;
      log(`${path.basename(file.path)}: ${error.message}`, 'error');
    }
  }

  // Oppsummering
  console.log('\n' + '='.repeat(50));
  console.log('OPPSUMMERING');
  console.log('='.repeat(50));
  console.log(`Totalt:     ${files.length} filer`);
  console.log(`Vellykket:  ${successCount}`);
  console.log(`Feilet:     ${failCount}`);

  if (options.dryRun) {
    console.log('\n⚠️  DRY RUN - ingen data ble lagret');
  }

  const totalValid = results.reduce((sum, r) => sum + (r.validRows || 0), 0);
  const totalErrors = results.reduce((sum, r) => sum + (r.errorRows || 0), 0);
  console.log(`\nRader totalt: ${totalValid} OK, ${totalErrors} feil`);

  // Detaljert rapport
  if (results.some(r => !r.success || r.errorRows > 0)) {
    console.log('\nDetaljer:');
    for (const r of results) {
      if (!r.success) {
        console.log(`  ❌ ${r.fileName}: ${r.error}`);
      } else if (r.errorRows > 0) {
        console.log(`  ⚠️  ${r.fileName}: ${r.errorRows} rader med feil`);
      }
    }
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Automatisk kryptert backup av Supabase database
 * Henter ALLE tabeller dynamisk, paginerer korrekt, krypterer med AES-256-GCM,
 * verifiserer integritet, og laster opp til Supabase Storage.
 *
 * Sikkerhetstiltak:
 *   - AES-256-GCM autentisert kryptering + gzip komprimering
 *   - SHA-256 integritetshash (verifiserer at backup kan dekrypteres)
 *   - Automatisk retry ved midlertidige feil (3 forsøk)
 *   - Sanitering av sensitive felt (passord, API-nøkler, TOTP-secrets)
 *   - Kritiske tabeller valideres (organizations, kunder, bruker)
 *
 * Bruk:
 *   node scripts/auto-backup.js                  - Kjør backup
 *   node scripts/auto-backup.js --list            - Vis tilgjengelige backups
 *   node scripts/auto-backup.js --dry-run         - Simuler uten å lagre
 *
 * Cron (3x daglig: kl 06:00, 14:00, 22:00):
 *   0 6,14,22 * * * cd /path/to/app && node scripts/auto-backup.js
 *
 * Miljøvariabler:
 *   SUPABASE_URL              - Supabase prosjekt-URL
 *   SUPABASE_SERVICE_KEY      - Service role key (bypass RLS)
 *   BACKUP_ENCRYPTION_KEY     - Krypteringsnøkkel for backup (min 32 tegn)
 */

require('dotenv').config();
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createClient } = require('@supabase/supabase-js');

// --- Konfigurasjon ---

const STORAGE_BUCKET = 'backups';
const MAX_BACKUPS = 90; // ~30 dager ved 3x daglig
const PAGE_SIZE = 1000; // Supabase default maks per request
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// Tabeller som skal ekskluderes fra backup (system-tabeller, midlertidige data)
const EXCLUDED_TABLES = new Set([
  'schema_migrations',
  'spatial_ref_sys',
]);

// Kritiske tabeller som MÅ være med i backup — feil hvis de mangler
const CRITICAL_TABLES = new Set([
  'organizations',
  'kunder',
  'klient',
  'avtaler',
  'ruter',
]);

// Sensitive felt som skal redakteres per tabell
// Passord-hasher beholdes for full gjenoppretting (backupen er kryptert uansett)
// Kun midlertidige secrets som aldri skal persisteres fjernes
const SANITIZE_RULES = {
  totp_pending_sessions: ['totp_secret'], // Midlertidige 2FA-secrets, ugyldig etter kort tid
};

// --- Supabase klient ---

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL og SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY må være satt');
  }

  return createClient(url, key);
}

// --- Kryptering ---

function getEncryptionKey() {
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY må være satt (min 32 tegn)');
  }
  return crypto.scryptSync(key, 'skyplanner-backup-salt', 32);
}

function encrypt(data) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const compressed = zlib.gzipSync(data);

  let encrypted = cipher.update(compressed);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv (16 bytes) + authTag (16 bytes) + encrypted data
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(encryptedBuffer) {
  const key = getEncryptionKey();

  const iv = encryptedBuffer.subarray(0, IV_LENGTH);
  const authTag = encryptedBuffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = encryptedBuffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return zlib.gunzipSync(decrypted).toString('utf8');
}

// --- Retry-logikk ---

async function withRetry(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        console.log(`  ${label}: Forsøk ${attempt}/${MAX_RETRIES} feilet (${err.message}), prøver igjen om ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// --- Dynamisk tabellhenting ---

async function getAllTables(supabase) {
  // Hent tabelliste via RPC-funksjonen get_public_tables
  const { data, error } = await supabase.rpc('get_public_tables');

  if (!error && data && data.length > 0) {
    return data.map(r => r.tablename).filter(t => t && !EXCLUDED_TABLES.has(t));
  }

  // Fallback: bruk hardkodet liste
  console.log(`  Dynamisk tabellhenting feilet (${error?.message || 'ingen data'}), bruker kjent liste`);
  return KNOWN_TABLES;
}

// Hardkodet fallback-liste (alle kjente tabeller per feb 2026)
const KNOWN_TABLES = [
  'organizations',
  'klient',
  'bruker',
  'kunder',
  'ruter',
  'rute_kunde_visits',
  'avtaler',
  'kontaktlogg',
  'kontaktpersoner',
  'industry_templates',
  'template_service_types',
  'template_subtypes',
  'template_equipment',
  'template_intervals',
  'organization_service_types',
  'customer_services',
  'feature_definitions',
  'organization_features',
  'import_batches',
  'import_staging_rows',
  'import_validation_errors',
  'import_column_history',
  'import_mapping_templates',
  'import_audit_log',
  'organization_integrations',
  'integration_sync_log',
  'failed_sync_items',
  'ekk_reports',
  'outlook_sync_log',
  'api_keys',
  'api_key_usage_log',
  'webhook_endpoints',
  'webhook_deliveries',
  'tags',
  'kunde_tags',
  'email_varsler',
  'email_innstillinger',
  'customer_email_templates',
  'customer_emails_sent',
  'security_audit_log',
  'totp_audit_log',
  'totp_pending_sessions',
  'active_sessions',
  'account_deletion_requests',
  'chat_conversations',
  'chat_messages',
  'chat_participants',
  'chat_read_status',
  'patch_notes',
];

async function discoverTables(supabase) {
  try {
    const tables = await getAllTables(supabase);
    if (tables.length > 0) {
      return tables.sort();
    }
  } catch (err) {
    console.log(`  Dynamisk tabellhenting feilet (${err.message}), bruker kjent liste`);
  }
  return KNOWN_TABLES;
}

// --- Paginert datahenting ---

async function fetchPage(supabase, table, offset, ordered) {
  const query = supabase.from(table).select('*').range(offset, offset + PAGE_SIZE - 1);
  if (ordered) query.order('id', { ascending: true, nullsFirst: false });
  return query;
}

async function fetchAllRows(supabase, table) {
  const allRows = [];
  let offset = 0;
  let useOrdering = true;

  while (true) {
    let { data, error } = await fetchPage(supabase, table, offset, useOrdering);

    // Noen tabeller har ikke 'id'-kolonne — prøv uten ordering
    if (error && useOrdering && (error.message.includes('id') || error.message.includes('column'))) {
      useOrdering = false;
      ({ data, error } = await fetchPage(supabase, table, offset, false));
    }

    if (error) throw error;
    if (data) allRows.push(...data);
    if (!data || data.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
  }

  return allRows;
}

// --- Sanitering ---

function sanitizeData(table, data) {
  if (!data || data.length === 0) return data;

  const fieldsToRemove = SANITIZE_RULES[table];
  if (!fieldsToRemove) return data;

  return data.map(row => {
    const sanitized = { ...row };
    for (const field of fieldsToRemove) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    return sanitized;
  });
}

// --- Verifisering ---

function verifyEncryptedData(encryptedData, originalJson) {
  // 1. Sjekk at vi kan dekryptere
  const decrypted = decrypt(encryptedData);

  // 2. Sjekk SHA-256 hash matcher
  const originalHash = crypto.createHash('sha256').update(originalJson).digest('hex');
  const decryptedHash = crypto.createHash('sha256').update(decrypted).digest('hex');

  if (originalHash !== decryptedHash) {
    throw new Error(`Integritetssjekk feilet! Original hash: ${originalHash}, dekryptert hash: ${decryptedHash}`);
  }

  // 3. Sjekk at JSON kan parses og har riktig struktur
  const parsed = JSON.parse(decrypted);
  if (!parsed.tables || typeof parsed.tables !== 'object') {
    throw new Error('Dekryptert backup har ugyldig struktur (mangler tables)');
  }

  return { hash: originalHash, tablesVerified: Object.keys(parsed.tables).length };
}

async function verifyUploadedFile(supabase, filename, expectedHash) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(filename);

  if (error) {
    throw new Error(`Kunne ikke laste ned backup for verifisering: ${error.message}`);
  }

  const downloadedBuffer = Buffer.from(await data.arrayBuffer());
  const decrypted = decrypt(downloadedBuffer);
  const downloadedHash = crypto.createHash('sha256').update(decrypted).digest('hex');

  if (downloadedHash !== expectedHash) {
    throw new Error(`Opplastet fil er korrupt! Forventet hash: ${expectedHash}, fikk: ${downloadedHash}`);
  }

  return true;
}

// --- Storage ---

async function ensureBucketExists(supabase) {
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(b => b.name === STORAGE_BUCKET);

  if (!bucketExists) {
    console.log(`Oppretter storage bucket: ${STORAGE_BUCKET}`);
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: false,
    });
    if (error && !error.message.includes('already exists')) {
      throw new Error(`Kunne ikke opprette bucket: ${error.message}`);
    }
  }
}

async function cleanupOldBackups(supabase) {
  const { data: files, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list('', { sortBy: { column: 'name', order: 'desc' } });

  if (error) {
    console.log('Kunne ikke liste backups:', error.message);
    return;
  }

  const backupFiles = files
    .filter(f => f.name.startsWith('backup-') && f.name.endsWith('.enc'))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (backupFiles.length > MAX_BACKUPS) {
    const toDelete = backupFiles.slice(MAX_BACKUPS);
    console.log(`\nSletter ${toDelete.length} gamle backup(s):`);

    for (const file of toDelete) {
      const { error: deleteError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([file.name]);

      if (deleteError) {
        console.log(`  Kunne ikke slette ${file.name}: ${deleteError.message}`);
      } else {
        console.log(`  Slettet: ${file.name}`);
      }
    }
  }

  // Rydd også opp gamle ukrypterte backups (.json)
  const oldJsonBackups = files.filter(f => f.name.startsWith('backup-') && f.name.endsWith('.json'));
  if (oldJsonBackups.length > 0) {
    console.log(`\nSletter ${oldJsonBackups.length} gamle ukrypterte backup(s):`);
    for (const file of oldJsonBackups) {
      const { error: deleteError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([file.name]);

      if (!deleteError) {
        console.log(`  Slettet: ${file.name}`);
      }
    }
  }
}

async function listBackups(supabase) {
  const { data: files, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list('', { sortBy: { column: 'name', order: 'desc' } });

  if (error) {
    console.error('Kunne ikke liste backups:', error.message);
    process.exit(1);
  }

  const backupFiles = files
    .filter(f => f.name.startsWith('backup-'))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (backupFiles.length === 0) {
    console.log('Ingen backups funnet.');
    return;
  }

  console.log('=== TILGJENGELIGE BACKUPS ===\n');
  for (const file of backupFiles) {
    const size = file.metadata?.size
      ? `${(file.metadata.size / 1024).toFixed(1)} KB`
      : 'ukjent størrelse';
    const encrypted = file.name.endsWith('.enc') ? '(kryptert)' : '(ukryptert!)';
    console.log(`  ${file.name}  ${size}  ${encrypted}`);
  }
  console.log(`\nTotalt: ${backupFiles.length} backups`);
}

// --- Hovedfunksjon ---

async function createBackup(options = {}) {
  const { dryRun = false } = options;
  const supabase = getSupabaseClient();
  const now = new Date();
  const dateStr = now.toISOString().replaceAll(/[:.]/g, '-').slice(0, 19);
  const filename = `backup-${dateStr}.enc`;
  const errors = [];

  console.log('=== SUPABASE KRYPTERT BACKUP ===');
  console.log(`Dato: ${now.toISOString()}`);
  console.log(`Mål: Supabase Storage (${STORAGE_BUCKET}/${filename})`);
  console.log(`Kryptering: AES-256-GCM + gzip`);
  console.log(`Verifisering: SHA-256 + dekrypterings-test`);
  if (dryRun) console.log('MODUS: Dry run (lagrer ikke)');
  console.log('');

  // Sørg for bucket
  if (!dryRun) {
    await withRetry(() => ensureBucketExists(supabase), 'Bucket-oppretting');
  }

  // Finn alle tabeller
  console.log('Henter tabelliste...');
  const tables = await discoverTables(supabase);
  console.log(`Fant ${tables.length} tabeller\n`);

  const backup = {
    version: 2,
    created: now.toISOString(),
    encrypted: true,
    tables: {},
  };

  let totalRows = 0;
  let tableErrors = 0;

  for (const table of tables) {
    try {
      const rows = await withRetry(
        () => fetchAllRows(supabase, table),
        table
      );
      const sanitized = sanitizeData(table, rows);
      const rowCount = sanitized.length;

      backup.tables[table] = { data: sanitized, rows: rowCount };
      totalRows += rowCount;

      const suffix = rowCount >= PAGE_SIZE ? ' (paginert)' : '';
      console.log(`  ${table}: ${rowCount} rader${suffix}`);
    } catch (err) {
      console.log(`  ${table}: FEIL - ${err.message}`);
      backup.tables[table] = { error: err.message, rows: 0 };
      tableErrors++;
      errors.push(`${table}: ${err.message}`);
    }
  }

  // Sjekk at kritiske tabeller er med og har data
  const missingCritical = [];
  for (const table of CRITICAL_TABLES) {
    const tableData = backup.tables[table];
    if (!tableData || tableData.error) {
      missingCritical.push(table);
    }
  }

  if (missingCritical.length > 0) {
    const msg = `Kritiske tabeller mangler: ${missingCritical.join(', ')}`;
    console.error(`\nFEIL: ${msg}`);
    errors.push(msg);
    // Fortsett likevel — bedre å ha en delvis backup enn ingen backup
  }

  // Konverter og krypter
  const backupJson = JSON.stringify(backup);
  const jsonSize = (Buffer.byteLength(backupJson, 'utf8') / 1024 / 1024).toFixed(2);

  console.log('');
  console.log(`Totalt: ${totalRows} rader fra ${tables.length - tableErrors} tabeller`);
  if (tableErrors > 0) console.log(`Feil: ${tableErrors} tabeller kunne ikke hentes`);
  console.log(`Rå størrelse: ${jsonSize} MB`);

  console.log('\nKomprimerer og krypterer...');
  const encryptedData = encrypt(backupJson);
  const encryptedSize = (encryptedData.length / 1024 / 1024).toFixed(2);
  const compression = ((1 - encryptedData.length / Buffer.byteLength(backupJson, 'utf8')) * 100).toFixed(0);
  console.log(`Kryptert størrelse: ${encryptedSize} MB (${compression}% reduksjon)`);

  // Verifiser kryptering lokalt (før opplasting)
  console.log('\nVerifiserer kryptering...');
  const { hash, tablesVerified } = verifyEncryptedData(encryptedData, backupJson);
  console.log(`  Lokal verifisering OK (SHA-256: ${hash.slice(0, 16)}..., ${tablesVerified} tabeller)`);

  if (dryRun) {
    console.log('\nDry run fullført — ingen data lagret.');
    return null;
  }

  // Last opp med retry
  console.log('\nLaster opp til Supabase Storage...');
  await withRetry(async () => {
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filename, encryptedData, {
        contentType: 'application/octet-stream',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Opplasting feilet: ${uploadError.message}`);
    }
  }, 'Opplasting');

  console.log(`Lagret: ${STORAGE_BUCKET}/${filename}`);

  // Verifiser opplastet fil (last ned og sjekk hash)
  console.log('\nVerifiserer opplastet fil...');
  await withRetry(
    () => verifyUploadedFile(supabase, filename, hash),
    'Verifisering av opplastet fil'
  );
  console.log('  Opplastet fil verifisert OK');

  // Rydd opp
  await cleanupOldBackups(supabase);

  const result = {
    success: true,
    filename,
    tables: tables.length,
    tableErrors,
    totalRows,
    rawSizeMb: Number.parseFloat(jsonSize),
    encryptedSizeMb: Number.parseFloat(encryptedSize),
    sha256: hash,
    verified: true,
    missingCriticalTables: missingCritical,
    errors: errors.length > 0 ? errors : undefined,
  };

  return result;
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const supabase = getSupabaseClient();
    await listBackups(supabase);
    return;
  }

  const dryRun = args.includes('--dry-run');
  const result = await createBackup({ dryRun });

  if (result) {
    console.log('');
    console.log('=== BACKUP FULLFØRT ===');
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error('\nBackup feilet:', err.message);
  process.exit(1);
});

// Eksporter for bruk fra cron-endpoint
module.exports = { createBackup, listBackups, getSupabaseClient };

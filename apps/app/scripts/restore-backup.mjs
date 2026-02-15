#!/usr/bin/env node
/**
 * Gjenopprett data for én organisasjon fra kryptert backup
 *
 * Bruk:
 *   node scripts/restore-backup.mjs --org 3                         - Dry-run (vis hva som ville gjenopprettes)
 *   node scripts/restore-backup.mjs --org 3 --confirm               - Faktisk gjenoppretting
 *   node scripts/restore-backup.mjs --org 3 --file backup-2026-...  - Fra spesifikk backup
 *   node scripts/restore-backup.mjs --org 3 --tables kunder,avtaler - Kun bestemte tabeller
 *
 * Miljøvariabler:
 *   SUPABASE_URL                    - Supabase prosjekt-URL
 *   SUPABASE_SERVICE_KEY/ROLE_KEY   - Service role key
 *   BACKUP_ENCRYPTION_KEY           - Krypteringsnøkkel for backup
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createClient } from '@supabase/supabase-js';

const STORAGE_BUCKET = 'backups';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Tabeller som har organization_id (per-org data)
const ORG_TABLES = new Set([
  'kunder',
  'ruter',
  'avtaler',
  'kontaktlogg',
  'kontaktpersoner',
  'rute_kunder',
  'rute_kunde_visits',
  'organization_features',
  'organization_service_types',
  'api_keys',
  'api_key_usage_log',
  'webhook_endpoints',
  'webhook_deliveries',
  'organization_integrations',
  'integration_sync_log',
  'failed_sync_items',
  'import_batches',
  'import_staging_rows',
  'import_mapping_templates',
  'import_column_history',
  'import_audit_log',
  'customer_services',
  'tags',
  'kunde_tags',
  'email_varsler',
  'email_innstillinger',
  'customer_email_templates',
  'customer_emails_sent',
  'chat_conversations',
  'account_deletion_requests',
  'kontroll_historikk',
  'ekk_reports',
  'outlook_sync_log',
]);

// Tabeller som IKKE skal gjenopprettes (globale/system-tabeller)
const SKIP_TABLES = new Set([
  'organizations',           // Org-metadata håndteres separat
  'klient',                  // Globale klient-innstillinger
  'brukere',                 // Brukerkontoer håndteres separat
  'active_sessions',         // Aktive sesjoner (midlertidige)
  'refresh_tokens',          // Auth tokens (regenereres)
  'auth_tokens',             // Auth tokens
  'email_tokens',            // E-post tokens
  'password_reset_tokens',   // Passord-reset tokens
  'totp_pending_sessions',   // 2FA midlertidige
  'login_logg',              // Login-historikk
  'security_audit_log',      // Sikkerhetslogg
  'totp_audit_log',          // 2FA-logg
  'industry_templates',      // Globale maler
  'template_service_types',  // Globale maler
  'template_subtypes',       // Globale maler
  'template_equipment',      // Globale maler
  'template_intervals',      // Globale maler
  'feature_definitions',     // Globale feature-definisjoner
  'patch_notes',             // Globale patch notes
  'import_validation_errors', // Genereres på nytt ved import
]);

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL og SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY må være satt');
  }
  return createClient(url, key);
}

function getEncryptionKey() {
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY må være satt (min 32 tegn)');
  }
  return crypto.scryptSync(key, 'skyplanner-backup-salt', 32);
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
  return JSON.parse(zlib.gunzipSync(decrypted).toString('utf8'));
}

async function getLatestBackupFilename(supabase) {
  const { data: files, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list('', { sortBy: { column: 'name', order: 'desc' } });

  if (error) throw new Error(`Kunne ikke liste backups: ${error.message}`);
  const backup = files
    .filter(f => f.name.startsWith('backup-') && f.name.endsWith('.enc'))
    .sort((a, b) => b.name.localeCompare(a.name))[0];

  if (!backup) throw new Error('Ingen krypterte backups funnet');
  return backup.name;
}

async function downloadAndDecrypt(supabase, filename) {
  console.log(`Laster ned: ${STORAGE_BUCKET}/${filename}...`);
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(filename);

  if (error) throw new Error(`Nedlasting feilet: ${error.message}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  console.log(`Dekrypterer (${(buffer.length / 1024).toFixed(1)} KB)...`);
  return decrypt(buffer);
}

function filterOrgData(backup, orgId, filterTables) {
  const result = {};
  let totalRows = 0;

  for (const [table, info] of Object.entries(backup.tables)) {
    // Skip globale tabeller
    if (SKIP_TABLES.has(table)) continue;

    // Hvis brukeren spesifiserte tabeller, filtrer
    if (filterTables && !filterTables.includes(table)) continue;

    const rows = info.data || [];

    if (ORG_TABLES.has(table)) {
      // Filtrer på organization_id
      const orgRows = rows.filter(r => r.organization_id === orgId);
      if (orgRows.length > 0) {
        result[table] = orgRows;
        totalRows += orgRows.length;
      }
    }
  }

  return { tables: result, totalRows };
}

async function restoreTable(supabase, table, rows) {
  // Slett eksisterende data for denne org i tabellen
  const orgId = rows[0].organization_id;

  const { error: deleteError } = await supabase
    .from(table)
    .delete()
    .eq('organization_id', orgId);

  if (deleteError) {
    return { success: false, error: `Sletting feilet: ${deleteError.message}` };
  }

  // Sett inn rader i batches på 500
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabase
      .from(table)
      .insert(batch);

    if (insertError) {
      return { success: false, error: `Insert feilet ved rad ${i}: ${insertError.message}`, inserted };
    }
    inserted += batch.length;
  }

  return { success: true, inserted };
}

function printUsage() {
  console.log(`
Gjenopprett data for én organisasjon fra kryptert backup

Bruk:
  node scripts/restore-backup.mjs --org <id>                         Dry-run (vis hva som ville gjenopprettes)
  node scripts/restore-backup.mjs --org <id> --confirm               Faktisk gjenoppretting
  node scripts/restore-backup.mjs --org <id> --file <backup-fil>     Fra spesifikk backup
  node scripts/restore-backup.mjs --org <id> --tables kunder,avtaler Kun bestemte tabeller

Eksempler:
  node scripts/restore-backup.mjs --org 3                            Se hva org 3 har i siste backup
  node scripts/restore-backup.mjs --org 3 --confirm                  Gjenopprett alt for org 3
  node scripts/restore-backup.mjs --org 3 --tables kunder --confirm  Gjenopprett kun kunder for org 3
  `);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  // Parse argumenter
  const orgIndex = args.indexOf('--org');
  if (orgIndex === -1 || !args[orgIndex + 1]) {
    console.error('Feil: --org <id> er påkrevd');
    printUsage();
    process.exit(1);
  }
  const orgId = parseInt(args[orgIndex + 1], 10);
  if (isNaN(orgId)) {
    console.error('Feil: org-id må være et tall');
    process.exit(1);
  }

  const confirm = args.includes('--confirm');
  const fileIndex = args.indexOf('--file');
  const specificFile = fileIndex !== -1 ? args[fileIndex + 1] : null;
  const tablesIndex = args.indexOf('--tables');
  const filterTables = tablesIndex !== -1 ? args[tablesIndex + 1].split(',') : null;

  const supabase = getSupabaseClient();

  // Verifiser at organisasjonen eksisterer
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, navn')
    .eq('id', orgId)
    .single();

  if (orgError || !org) {
    console.error(`Feil: Organisasjon ${orgId} finnes ikke i databasen`);
    process.exit(1);
  }

  console.log(`\n=== GJENOPPRETTING FOR ORGANISASJON ===`);
  console.log(`Org: ${org.navn} (ID: ${orgId})`);
  console.log(`Modus: ${confirm ? '⚠️  LIVE GJENOPPRETTING' : '🔍 Dry-run (forhåndsvisning)'}`);
  if (filterTables) console.log(`Tabeller: ${filterTables.join(', ')}`);
  console.log('');

  // Last ned og dekrypter backup
  const filename = specificFile || await getLatestBackupFilename(supabase);
  console.log(`Backup: ${filename}`);
  const backup = await downloadAndDecrypt(supabase, filename);
  console.log(`Backup opprettet: ${backup.created}\n`);

  // Filtrer data for denne organisasjonen
  const { tables: orgData, totalRows } = filterOrgData(backup, orgId, filterTables);
  const tableNames = Object.keys(orgData).sort();

  if (tableNames.length === 0) {
    console.log(`Ingen data funnet for organisasjon ${orgId} i denne backupen.`);
    process.exit(0);
  }

  // Vis oversikt
  console.log('Tabell                          Rader');
  console.log('─'.repeat(45));
  for (const table of tableNames) {
    console.log(`  ${table.padEnd(30)} ${String(orgData[table].length).padStart(6)}`);
  }
  console.log('─'.repeat(45));
  console.log(`  ${'TOTALT'.padEnd(30)} ${String(totalRows).padStart(6)}`);
  console.log('');

  if (!confirm) {
    console.log('Dette er en dry-run. Ingen data ble endret.');
    console.log('Legg til --confirm for å faktisk gjenopprette.\n');
    console.log(`Kommando: node scripts/restore-backup.mjs --org ${orgId} --confirm`);
    process.exit(0);
  }

  // ⚠️ Faktisk gjenoppretting
  console.log('⚠️  Starter gjenoppretting...\n');

  let successCount = 0;
  let errorCount = 0;

  for (const table of tableNames) {
    const rows = orgData[table];
    process.stdout.write(`  ${table.padEnd(30)} `);

    const result = await restoreTable(supabase, table, rows);
    if (result.success) {
      console.log(`✓ ${result.inserted} rader gjenopprettet`);
      successCount++;
    } else {
      console.log(`✗ FEIL: ${result.error}`);
      errorCount++;
    }
  }

  console.log('\n' + '─'.repeat(45));
  console.log(`Fullført: ${successCount} tabeller OK, ${errorCount} feil`);

  if (errorCount > 0) {
    console.log('\n⚠️  Noen tabeller feilet. Sjekk feilmeldingene over.');
    process.exit(1);
  } else {
    console.log('\n✓ Alle data for organisasjonen er gjenopprettet!');
  }
}

main().catch(err => {
  console.error('\nFeil:', err.message);
  process.exit(1);
});

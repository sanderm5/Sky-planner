#!/usr/bin/env node
/**
 * Dekrypter og les krypterte backup-filer fra Supabase Storage
 *
 * Bruk:
 *   node scripts/decrypt-backup.mjs <filnavn>              - Last ned og dekrypter
 *   node scripts/decrypt-backup.mjs <filnavn> --save       - Lagre som JSON-fil lokalt
 *   node scripts/decrypt-backup.mjs <filnavn> --table kunder - Vis kun én tabell
 *   node scripts/decrypt-backup.mjs --latest               - Dekrypter siste backup
 *
 * Miljøvariabler:
 *   SUPABASE_URL              - Supabase prosjekt-URL
 *   SUPABASE_SERVICE_KEY      - Service role key
 *   BACKUP_ENCRYPTION_KEY     - Samme nøkkel som ble brukt til kryptering
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const STORAGE_BUCKET = 'backups';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

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

  // Dekomprimere gzip
  const decompressed = zlib.gunzipSync(decrypted);
  return decompressed.toString('utf8');
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

async function downloadBackup(supabase, filename) {
  console.log(`Laster ned: ${STORAGE_BUCKET}/${filename}...`);

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(filename);

  if (error) throw new Error(`Nedlasting feilet: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

function printSummary(backup) {
  console.log(`\nBackup opprettet: ${backup.created}`);
  console.log(`Versjon: ${backup.version || 1}`);
  console.log(`Antall tabeller: ${Object.keys(backup.tables).length}\n`);

  console.log('Tabell                          Rader    Status');
  console.log('─'.repeat(55));

  let totalRows = 0;
  for (const [table, info] of Object.entries(backup.tables).sort()) {
    const rows = info.rows || (info.data ? info.data.length : 0);
    const status = info.error ? `FEIL: ${info.error}` : 'OK';
    console.log(`  ${table.padEnd(30)} ${String(rows).padStart(6)}    ${status}`);
    totalRows += rows;
  }

  console.log('─'.repeat(55));
  console.log(`  ${'TOTALT'.padEnd(30)} ${String(totalRows).padStart(6)}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Dekrypter backup-filer fra Supabase Storage

Bruk:
  node scripts/decrypt-backup.mjs <filnavn>                - Last ned og vis oppsummering
  node scripts/decrypt-backup.mjs <filnavn> --save         - Lagre som JSON-fil
  node scripts/decrypt-backup.mjs <filnavn> --table kunder - Vis data for én tabell
  node scripts/decrypt-backup.mjs --latest                 - Dekrypter siste backup
    `);
    process.exit(0);
  }

  const supabase = getSupabaseClient();
  const useLatest = args.includes('--latest');
  const save = args.includes('--save');
  const tableIndex = args.indexOf('--table');
  const filterTable = tableIndex !== -1 ? args[tableIndex + 1] : null;

  // Finn filnavn
  let filename;
  if (useLatest) {
    filename = await getLatestBackupFilename(supabase);
    console.log(`Siste backup: ${filename}`);
  } else {
    filename = args.find(a => !a.startsWith('--') && (args.indexOf(a) === 0 || args[args.indexOf(a) - 1] !== '--table'));
    if (!filename) {
      console.error('Mangler filnavn. Bruk --latest for siste backup.');
      process.exit(1);
    }
  }

  // Last ned og dekrypter
  const encryptedData = await downloadBackup(supabase, filename);
  console.log(`Fil størrelse: ${(encryptedData.length / 1024).toFixed(1)} KB (kryptert)`);

  console.log('Dekrypterer og dekomprimerer...');
  const jsonStr = decrypt(encryptedData);
  console.log(`Dekryptert størrelse: ${(Buffer.byteLength(jsonStr, 'utf8') / 1024).toFixed(1)} KB`);

  const backup = JSON.parse(jsonStr);

  // Vis spesifikk tabell
  if (filterTable) {
    const tableData = backup.tables[filterTable];
    if (!tableData) {
      console.error(`Tabell "${filterTable}" finnes ikke i backupen.`);
      console.log('Tilgjengelige tabeller:', Object.keys(backup.tables).sort().join(', '));
      process.exit(1);
    }
    console.log(`\n=== ${filterTable} (${tableData.rows || 0} rader) ===\n`);
    console.log(JSON.stringify(tableData.data || [], null, 2));
    return;
  }

  // Vis oppsummering
  printSummary(backup);

  // Lagre som JSON
  if (save) {
    const outFilename = filename.replace('.enc', '.json');
    const outPath = path.join(process.cwd(), outFilename);
    fs.writeFileSync(outPath, JSON.stringify(backup, null, 2));
    console.log(`\nLagret dekryptert backup: ${outPath}`);
  }
}

main().catch(err => {
  console.error('\nFeil:', err.message);
  process.exit(1);
});

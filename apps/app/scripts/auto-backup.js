#!/usr/bin/env node
/**
 * Automatisk backup av Supabase database
 * Laster opp til Supabase Storage (ikke git)
 *
 * Bruk:
 *   node scripts/auto-backup.js
 *
 * Cron (hver 1. i måneden kl 03:00):
 *   0 3 1 * * cd /path/to/el-kontroll-kart && node scripts/auto-backup.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const STORAGE_BUCKET = 'backups';
const MAX_BACKUPS = 12; // Behold siste 12 backups (ca. 1 år)

const TABLES = [
  'kunder',
  'ruter',
  'rute_kunder',
  'avtaler',
  'kontaktlogg',
  'login_logg',
  'klient',
  'email_varsler',
  'email_innstillinger'
];

// Fjern sensitive felt fra backup
function sanitizeData(table, data) {
  if (!data) return data;

  if (table === 'klient') {
    // Fjern passord-hash fra klient-tabell
    return data.map(row => {
      const { passord_hash, ...rest } = row;
      return rest;
    });
  }

  return data;
}

async function ensureBucketExists() {
  // Sjekk om bucket finnes
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(b => b.name === STORAGE_BUCKET);

  if (!bucketExists) {
    console.log(`Oppretter storage bucket: ${STORAGE_BUCKET}`);
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: 10485760 // 10MB
    });
    if (error && !error.message.includes('already exists')) {
      throw new Error(`Kunne ikke opprette bucket: ${error.message}`);
    }
  }
}

async function createBackup() {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = `backup-${timestamp}.json`;

  console.log('=== SUPABASE BACKUP ===');
  console.log('Dato:', timestamp);
  console.log('Mål: Supabase Storage');
  console.log('');

  // Sørg for at bucket eksisterer
  await ensureBucketExists();

  const backup = {
    created: new Date().toISOString(),
    tables: {}
  };

  let totalRows = 0;

  for (const table of TABLES) {
    try {
      const { data, error } = await supabase.from(table).select('*');

      if (error) {
        console.log(`  ${table}: FEIL - ${error.message}`);
        backup.tables[table] = { error: error.message, rows: 0 };
      } else {
        const rowCount = data ? data.length : 0;
        console.log(`  ${table}: ${rowCount} rader`);
        // Sanitize data for å fjerne sensitive felt
        const sanitizedData = sanitizeData(table, data);
        backup.tables[table] = { data: sanitizedData, rows: rowCount };
        totalRows += rowCount;
      }
    } catch (err) {
      console.log(`  ${table}: FEIL - ${err.message}`);
      backup.tables[table] = { error: err.message, rows: 0 };
    }
  }

  // Konverter til JSON
  const backupJson = JSON.stringify(backup, null, 2);
  const fileSize = (Buffer.byteLength(backupJson, 'utf8') / 1024).toFixed(1);

  console.log('');
  console.log(`Totalt: ${totalRows} rader`);
  console.log(`Størrelse: ${fileSize} KB`);

  // Last opp til Supabase Storage
  console.log('');
  console.log('Laster opp til Supabase Storage...');

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filename, backupJson, {
      contentType: 'application/json',
      upsert: true // Overskriv hvis filen finnes
    });

  if (uploadError) {
    throw new Error(`Opplasting feilet: ${uploadError.message}`);
  }

  console.log(`Lagret: ${STORAGE_BUCKET}/${filename}`);

  // Rydd opp gamle backups
  await cleanupOldBackups();

  return filename;
}

async function cleanupOldBackups() {
  const { data: files, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list('', {
      sortBy: { column: 'name', order: 'desc' }
    });

  if (error) {
    console.log('Kunne ikke liste backups:', error.message);
    return;
  }

  const backupFiles = files
    .filter(f => f.name.startsWith('backup-') && f.name.endsWith('.json'))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (backupFiles.length > MAX_BACKUPS) {
    const toDelete = backupFiles.slice(MAX_BACKUPS);
    console.log('');
    console.log(`Sletter ${toDelete.length} gamle backup(s):`);

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
}

// Kjør backup
createBackup()
  .then(() => {
    console.log('');
    console.log('✓ Backup fullført og lagret i Supabase Storage');
  })
  .catch(err => {
    console.error('Backup feilet:', err.message);
    process.exit(1);
  });

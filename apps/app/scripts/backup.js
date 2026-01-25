#!/usr/bin/env node
/**
 * Backup og gjenoppretting av database
 *
 * Bruk:
 *   node backup.js backup              - Lag backup av alle tabeller
 *   node backup.js restore <filnavn>   - Gjenopprett fra backup
 *   node backup.js list                - Vis alle backups
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
const useSupabase = DATABASE_TYPE === 'supabase';

const BACKUP_DIR = path.join(__dirname, 'backups');

// Sørg for at backup-mappen finnes
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

async function getSupabaseClient() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

async function backup() {
  console.log('Starter backup...\n');

  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const backupData = {
    timestamp: new Date().toISOString(),
    database: DATABASE_TYPE,
    tables: {}
  };

  const tables = ['kunder', 'ruter', 'rute_kunder', 'email_innstillinger', 'email_varsler', 'klient'];

  if (useSupabase) {
    const supabase = await getSupabaseClient();

    for (const table of tables) {
      try {
        const { data, error } = await supabase.from(table).select('*');
        if (error) {
          console.log(`  ⚠ ${table}: Kunne ikke hente (${error.message})`);
        } else {
          backupData.tables[table] = data;
          console.log(`  ✓ ${table}: ${data.length} rader`);
        }
      } catch (e) {
        console.log(`  ⚠ ${table}: Feil (${e.message})`);
      }
    }
  } else {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH || './kunder.db');

    for (const table of tables) {
      try {
        const data = db.prepare(`SELECT * FROM ${table}`).all();
        backupData.tables[table] = data;
        console.log(`  ✓ ${table}: ${data.length} rader`);
      } catch (e) {
        console.log(`  ⚠ ${table}: Finnes ikke`);
      }
    }
    db.close();
  }

  const filename = `backup-${timestamp}.json`;
  const filepath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2));

  console.log(`\n✓ Backup lagret: ${filename}`);
  console.log(`  Plassering: ${filepath}`);

  return filename;
}

async function restore(filename) {
  // Security: Sanitize filename to prevent path traversal
  const sanitizedFilename = path.basename(filename);
  if (sanitizedFilename !== filename || filename.includes('..')) {
    console.error('Feil: Ugyldig filnavn');
    process.exit(1);
  }

  const filepath = path.join(BACKUP_DIR, sanitizedFilename);

  // Verify the resolved path is within BACKUP_DIR
  const resolvedPath = path.resolve(filepath);
  const resolvedBackupDir = path.resolve(BACKUP_DIR);
  if (!resolvedPath.startsWith(resolvedBackupDir)) {
    console.error('Feil: Tilgang nektet');
    process.exit(1);
  }

  if (!fs.existsSync(filepath)) {
    console.error(`Feil: Finner ikke ${sanitizedFilename}`);
    console.log('\nTilgjengelige backups:');
    listBackups();
    process.exit(1);
  }

  const backupData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  console.log(`Gjenoppretter fra: ${filename}`);
  console.log(`Backup dato: ${backupData.timestamp}\n`);

  if (useSupabase) {
    const supabase = await getSupabaseClient();

    // Gjenopprett i riktig rekkefølge (pga. foreign keys)
    const restoreOrder = ['kunder', 'ruter', 'rute_kunder', 'email_innstillinger', 'email_varsler', 'klient'];

    for (const table of restoreOrder) {
      if (!backupData.tables[table]) continue;

      const data = backupData.tables[table];
      if (data.length === 0) {
        console.log(`  - ${table}: Ingen data å gjenopprette`);
        continue;
      }

      // Slett eksisterende data
      await supabase.from(table).delete().neq('id', 0);

      // Sett inn backup-data
      const { error } = await supabase.from(table).insert(data);
      if (error) {
        console.log(`  ✗ ${table}: Feil (${error.message})`);
      } else {
        console.log(`  ✓ ${table}: ${data.length} rader gjenopprettet`);
      }
    }
  } else {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH || './kunder.db');

    for (const [table, data] of Object.entries(backupData.tables)) {
      if (data.length === 0) continue;

      try {
        db.prepare(`DELETE FROM ${table}`).run();

        const columns = Object.keys(data[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);

        for (const row of data) {
          stmt.run(...columns.map(c => row[c]));
        }
        console.log(`  ✓ ${table}: ${data.length} rader gjenopprettet`);
      } catch (e) {
        console.log(`  ✗ ${table}: Feil (${e.message})`);
      }
    }
    db.close();
  }

  console.log('\n✓ Gjenoppretting fullført!');
}

function listBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, 'no'))
    .reverse();

  if (files.length === 0) {
    console.log('Ingen backups funnet.');
    return;
  }

  console.log('Tilgjengelige backups:\n');
  for (const file of files) {
    const filepath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filepath);
    const size = (stats.size / 1024).toFixed(1);
    console.log(`  ${file} (${size} KB)`);
  }
  console.log(`\nFor å gjenopprette: node backup.js restore <filnavn>`);
}

// Kjør
const command = process.argv[2];
const arg = process.argv[3];

async function main() {
  switch (command) {
    case 'backup':
      await backup();
      break;
    case 'restore':
      if (!arg) {
        console.log('Bruk: node backup.js restore <filnavn>');
        listBackups();
        process.exit(1);
      }
      await restore(arg);
      break;
    case 'list':
      listBackups();
      break;
    default:
      console.log(`
Backup-verktøy for El-Kontroll

Kommandoer:
  node backup.js backup              Lag backup av databasen
  node backup.js restore <filnavn>   Gjenopprett fra backup
  node backup.js list                Vis alle backups
      `);
  }
}

main().catch(console.error);

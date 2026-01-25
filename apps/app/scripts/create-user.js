#!/usr/bin/env node
/**
 * Script for å opprette brukere/klienter i databasen
 *
 * Bruk:
 *   node create-user.js --type bruker --navn "Sander" --epost "sander@example.no" --passord "mittpassord" --rolle admin
 *   node create-user.js --type klient --navn "Kunde AS" --epost "kunde@firma.no" --passord "kundepassord"
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');

const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
const useSupabase = DATABASE_TYPE === 'supabase';

// Parse arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : null;
};

const type = getArg('type'); // 'bruker' eller 'klient'
const navn = getArg('navn');
const epost = getArg('epost');
const passord = getArg('passord');
const rolle = getArg('rolle') || 'bruker';
const firma = getArg('firma');

async function main() {
  if (!type || !navn || !epost || !passord) {
    console.log(`
Bruk:
  node create-user.js --type <bruker|klient> --navn "Navn" --epost "epost@example.no" --passord "passord"

Eksempler:
  node create-user.js --type bruker --navn "Admin" --epost "admin@firma.no" --passord "hemmelighet" --rolle admin
  node create-user.js --type klient --navn "Kunde AS" --epost "kunde@example.no" --passord "kundepassord" --firma "Kunde AS"
    `);
    process.exit(1);
  }

  // Hash password
  const passordHash = await bcrypt.hash(passord, 10);
  console.log(`Oppretter ${type}: ${navn} (${epost})`);

  if (useSupabase) {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

    if (type === 'bruker') {
      const { data, error } = await supabase
        .from('brukere')
        .insert({ navn, epost, passord_hash: passordHash, rolle })
        .select()
        .single();

      if (error) {
        console.error('Feil:', error.message);
        process.exit(1);
      }
      console.log('Bruker opprettet:', data);
    } else if (type === 'klient') {
      const { data, error } = await supabase
        .from('klient')
        .insert({ navn, epost, passord_hash: passordHash, firma })
        .select()
        .single();

      if (error) {
        console.error('Feil:', error.message);
        process.exit(1);
      }
      console.log('Klient opprettet:', data);
    }
  } else {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH || './kunder.db');

    // Create tables if not exist
    if (type === 'bruker') {
      db.exec(`
        CREATE TABLE IF NOT EXISTS brukere (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          navn TEXT NOT NULL,
          epost TEXT NOT NULL UNIQUE,
          passord_hash TEXT NOT NULL,
          rolle TEXT DEFAULT 'bruker',
          aktiv INTEGER DEFAULT 1,
          sist_innlogget DATETIME,
          opprettet DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const stmt = db.prepare('INSERT INTO brukere (navn, epost, passord_hash, rolle) VALUES (?, ?, ?, ?)');
      const result = stmt.run(navn, epost, passordHash, rolle);
      console.log('Bruker opprettet med ID:', result.lastInsertRowid);
    } else if (type === 'klient') {
      db.exec(`
        CREATE TABLE IF NOT EXISTS klient (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          navn TEXT NOT NULL,
          epost TEXT NOT NULL UNIQUE,
          passord_hash TEXT NOT NULL,
          telefon TEXT,
          firma TEXT,
          aktiv INTEGER DEFAULT 1,
          sist_innlogget DATETIME,
          opprettet DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const stmt = db.prepare('INSERT INTO klient (navn, epost, passord_hash, firma) VALUES (?, ?, ?, ?)');
      const result = stmt.run(navn, epost, passordHash, firma || null);
      console.log('Klient opprettet med ID:', result.lastInsertRowid);
    }

    db.close();
  }

  console.log('Ferdig!');
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * Setup-script for El-Kontroll system
 * Bygger alt fra scratch - database, tabeller, og første bruker
 *
 * Bruk:
 *   node setup.js
 */

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');

const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
const useSupabase = DATABASE_TYPE === 'supabase';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         EL-KONTROLL + BRANNVARSLING SETUP                ║
║         Kontrollsystem                                   ║
╚══════════════════════════════════════════════════════════╝
`);

  console.log(`Database: ${DATABASE_TYPE.toUpperCase()}\n`);

  if (useSupabase) {
    await setupSupabase();
  } else {
    await setupSQLite();
  }

  rl.close();
  console.log('\n✓ Setup fullført!\n');
  console.log('Start serveren med: npm start');
  console.log('Åpne: http://localhost:3000');
}

async function setupSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  console.log('Kobler til Supabase...');

  // Test tilkobling
  const { error: testError } = await supabase.from('kunder').select('count').limit(1);

  if (testError && testError.code === '42P01') {
    console.log('\n⚠ Tabellene finnes ikke i Supabase.');
    console.log('\nDu må kjøre følgende SQL i Supabase SQL Editor:\n');
    console.log(getCreateTablesSQL());
    console.log('\n---');
    console.log('Etter å ha kjørt SQL, kjør dette scriptet på nytt.');
    return;
  }

  console.log('✓ Tilkoblet Supabase\n');

  // Sjekk om klient finnes
  const { data: klienter } = await supabase.from('klient').select('*');

  if (!klienter || klienter.length === 0) {
    console.log('Ingen klient funnet. La oss opprette en.\n');
    await createKlient(supabase);
  } else {
    console.log(`✓ Klient finnes: ${klienter[0].navn} (${klienter[0].epost})`);

    const svar = await ask('\nVil du opprette en ny klient? (j/n): ');
    if (svar.toLowerCase() === 'j') {
      await createKlient(supabase);
    }
  }
}

async function setupSQLite() {
  const Database = require('better-sqlite3');
  const dbPath = process.env.DATABASE_PATH || './kunder.db';

  console.log(`Oppretter SQLite database: ${dbPath}\n`);

  const db = new Database(dbPath);

  // Opprett alle tabeller
  console.log('Oppretter tabeller...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS kunder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      navn TEXT NOT NULL,
      adresse TEXT NOT NULL,
      postnummer TEXT,
      poststed TEXT,
      telefon TEXT,
      epost TEXT,
      lat REAL,
      lng REAL,
      siste_kontroll DATE,
      neste_kontroll DATE,
      kontroll_intervall_mnd INTEGER DEFAULT 12,
      notater TEXT,
      kategori TEXT,
      opprettet DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  ✓ kunder');

  db.exec(`
    CREATE TABLE IF NOT EXISTS ruter (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      navn TEXT NOT NULL,
      beskrivelse TEXT,
      planlagt_dato DATE,
      total_distanse REAL,
      total_tid INTEGER,
      opprettet DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'planlagt'
    )
  `);
  console.log('  ✓ ruter');

  db.exec(`
    CREATE TABLE IF NOT EXISTS rute_kunder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rute_id INTEGER NOT NULL,
      kunde_id INTEGER NOT NULL,
      rekkefolge INTEGER NOT NULL,
      FOREIGN KEY (rute_id) REFERENCES ruter(id) ON DELETE CASCADE,
      FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE
    )
  `);
  console.log('  ✓ rute_kunder');

  db.exec(`
    CREATE TABLE IF NOT EXISTS email_innstillinger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kunde_id INTEGER UNIQUE NOT NULL,
      email_aktiv INTEGER DEFAULT 1,
      forste_varsel_dager INTEGER DEFAULT 30,
      paaminnelse_etter_dager INTEGER DEFAULT 7,
      FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE
    )
  `);
  console.log('  ✓ email_innstillinger');

  db.exec(`
    CREATE TABLE IF NOT EXISTS email_varsler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kunde_id INTEGER,
      epost TEXT NOT NULL,
      emne TEXT NOT NULL,
      melding TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      sendt_dato DATETIME,
      feil_melding TEXT,
      opprettet DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE SET NULL
    )
  `);
  console.log('  ✓ email_varsler');

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
  console.log('  ✓ klient');

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
  console.log('  ✓ brukere');

  // Sjekk om klient finnes
  const klienter = db.prepare('SELECT * FROM klient').all();

  if (klienter.length === 0) {
    console.log('\nIngen klient funnet. La oss opprette en.\n');
    await createKlientSQLite(db);
  } else {
    console.log(`\n✓ Klient finnes: ${klienter[0].navn} (${klienter[0].epost})`);
  }

  db.close();
}

async function createKlient(supabase) {
  const navn = await ask('Klient navn: ');
  const epost = await ask('Klient e-post: ');
  const passord = await ask('Klient passord: ');
  const firma = await ask('Firma (valgfritt): ');

  const passordHash = await bcrypt.hash(passord, 10);

  const { data, error } = await supabase
    .from('klient')
    .insert({
      navn,
      epost,
      passord_hash: passordHash,
      firma: firma || null
    })
    .select()
    .single();

  if (error) {
    console.log(`\n✗ Feil: ${error.message}`);
  } else {
    console.log(`\n✓ Klient opprettet: ${data.navn} (${data.epost})`);
  }
}

async function createKlientSQLite(db) {
  const navn = await ask('Klient navn: ');
  const epost = await ask('Klient e-post: ');
  const passord = await ask('Klient passord: ');
  const firma = await ask('Firma (valgfritt): ');

  const passordHash = await bcrypt.hash(passord, 10);

  const stmt = db.prepare('INSERT INTO klient (navn, epost, passord_hash, firma) VALUES (?, ?, ?, ?)');
  const result = stmt.run(navn, epost, passordHash, firma || null);

  console.log(`\n✓ Klient opprettet med ID: ${result.lastInsertRowid}`);
}

function getCreateTablesSQL() {
  return `
-- Kunder (hovedtabell)
CREATE TABLE IF NOT EXISTS kunder (
    id SERIAL PRIMARY KEY,
    navn TEXT NOT NULL,
    adresse TEXT NOT NULL,
    postnummer TEXT,
    poststed TEXT,
    telefon TEXT,
    epost TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    siste_kontroll DATE,
    neste_kontroll DATE,
    kontroll_intervall_mnd INTEGER DEFAULT 12,
    notater TEXT,
    kategori TEXT DEFAULT 'El-Kontroll',
    opprettet TIMESTAMP DEFAULT NOW()
);

-- Ruter
CREATE TABLE IF NOT EXISTS ruter (
    id SERIAL PRIMARY KEY,
    navn TEXT NOT NULL,
    beskrivelse TEXT,
    planlagt_dato DATE,
    total_distanse DOUBLE PRECISION,
    total_tid INTEGER,
    status TEXT DEFAULT 'planlagt',
    opprettet TIMESTAMP DEFAULT NOW()
);

-- Kobling mellom ruter og kunder
CREATE TABLE IF NOT EXISTS rute_kunder (
    id SERIAL PRIMARY KEY,
    rute_id INTEGER NOT NULL REFERENCES ruter(id) ON DELETE CASCADE,
    kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
    rekkefolge INTEGER NOT NULL
);

-- E-post-innstillinger per kunde
CREATE TABLE IF NOT EXISTS email_innstillinger (
    id SERIAL PRIMARY KEY,
    kunde_id INTEGER UNIQUE NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
    email_aktiv BOOLEAN DEFAULT true,
    forste_varsel_dager INTEGER DEFAULT 30,
    paaminnelse_etter_dager INTEGER DEFAULT 7
);

-- E-post-varsler
CREATE TABLE IF NOT EXISTS email_varsler (
    id SERIAL PRIMARY KEY,
    kunde_id INTEGER REFERENCES kunder(id) ON DELETE SET NULL,
    epost TEXT NOT NULL,
    emne TEXT NOT NULL,
    melding TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sendt_dato TIMESTAMP,
    feil_melding TEXT,
    opprettet TIMESTAMP DEFAULT NOW()
);

-- Klient (portal-innlogging)
CREATE TABLE IF NOT EXISTS klient (
    id SERIAL PRIMARY KEY,
    navn TEXT NOT NULL,
    epost TEXT NOT NULL UNIQUE,
    passord_hash TEXT NOT NULL,
    telefon TEXT,
    firma TEXT,
    aktiv BOOLEAN DEFAULT true,
    sist_innlogget TIMESTAMP WITH TIME ZONE,
    opprettet TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Brukere (admin/ansatte)
CREATE TABLE IF NOT EXISTS brukere (
    id SERIAL PRIMARY KEY,
    navn TEXT NOT NULL,
    epost TEXT NOT NULL UNIQUE,
    passord_hash TEXT NOT NULL,
    rolle TEXT DEFAULT 'bruker',
    aktiv BOOLEAN DEFAULT true,
    sist_innlogget TIMESTAMP WITH TIME ZONE,
    opprettet TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;
}

main().catch(console.error);

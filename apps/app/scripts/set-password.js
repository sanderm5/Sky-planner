#!/usr/bin/env node
/**
 * Sett nytt passord for en bruker
 *
 * Bruk:
 *   node set-password.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const readline = require('readline');

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
  console.log('\n=== Sett nytt passord ===\n');

  const epost = await ask('E-post eller brukernavn: ');
  const passord = await ask('Nytt passord: ');

  if (!epost || !passord) {
    console.log('Både e-post og passord er påkrevd');
    rl.close();
    return;
  }

  const passordHash = await bcrypt.hash(passord, 10);

  if (useSupabase) {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // Try klient table first
    let { data: klient } = await supabase
      .from('klient')
      .update({ passord_hash: passordHash })
      .ilike('epost', epost)
      .select()
      .single();

    if (klient) {
      console.log(`\n✓ Passord oppdatert for klient: ${klient.navn} (${klient.epost})`);
    } else {
      // Try brukere table
      let { data: bruker } = await supabase
        .from('brukere')
        .update({ passord_hash: passordHash })
        .ilike('epost', epost)
        .select()
        .single();

      if (bruker) {
        console.log(`\n✓ Passord oppdatert for bruker: ${bruker.navn} (${bruker.epost})`);
      } else {
        console.log('\n✗ Ingen bruker funnet med den e-posten');
      }
    }
  } else {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH || './kunder.db');

    let result = db.prepare('UPDATE klient SET passord_hash = ? WHERE LOWER(epost) = LOWER(?)').run(passordHash, epost);

    if (result.changes > 0) {
      console.log(`\n✓ Passord oppdatert for klient`);
    } else {
      result = db.prepare('UPDATE brukere SET passord_hash = ? WHERE LOWER(epost) = LOWER(?)').run(passordHash, epost);
      if (result.changes > 0) {
        console.log(`\n✓ Passord oppdatert for bruker`);
      } else {
        console.log('\n✗ Ingen bruker funnet med den e-posten');
      }
    }
    db.close();
  }

  rl.close();
}

main().catch(console.error);

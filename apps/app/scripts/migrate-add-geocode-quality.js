#!/usr/bin/env node
/**
 * Migrasjon: Legg til geocode_quality kolonne via Supabase SQL
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrate() {
  console.log('=== MIGRERING: GEOCODE_QUALITY ===\n');

  // Kjør SQL for å legge til kolonnen
  const { data, error } = await supabase.rpc('exec_sql', {
    query: 'ALTER TABLE kunder ADD COLUMN IF NOT EXISTS geocode_quality TEXT;'
  });

  if (error) {
    // Prøv alternativ metode - direkte insert med kolonnen
    console.log('RPC ikke tilgjengelig, prøver alternativ metode...');

    // Sjekk om kolonnen finnes ved å prøve å lese den
    const { data: test, error: testErr } = await supabase
      .from('kunder')
      .select('id')
      .limit(1);

    if (testErr) {
      console.log('Kunne ikke koble til database:', testErr.message);
      return;
    }

    // Prøv å oppdatere med geocode_quality
    const { error: updateErr } = await supabase
      .from('kunder')
      .update({ geocode_quality: 'exact' })
      .eq('id', test[0]?.id);

    if (updateErr && updateErr.message.includes('geocode_quality')) {
      console.log('\nKolonnen geocode_quality finnes ikke i Supabase.');
      console.log('');
      console.log('Legg den til via Supabase Dashboard:');
      console.log('  1. Gå til https://supabase.com/dashboard');
      console.log('  2. SQL Editor -> New Query');
      console.log('  3. Kjør:');
      console.log('');
      console.log('     ALTER TABLE kunder ADD COLUMN geocode_quality TEXT;');
      console.log('');
      console.log('  4. Kjør dette scriptet på nytt etterpå.');
      return;
    }

    // Kolonnen finnes, oppdater alle
    console.log('Kolonnen finnes! Oppdaterer alle kunder...');
  }

  // Hent alle kunder og sett kvalitet
  const { data: kunder } = await supabase
    .from('kunder')
    .select('id, adresse, lat, lng');

  if (!kunder) {
    console.log('Ingen kunder funnet');
    return;
  }

  let exact = 0, area = 0;

  for (const kunde of kunder) {
    let quality = 'exact';

    if (!kunde.lat || !kunde.lng) {
      quality = null;
    } else if (!kunde.adresse || !/\d/.test(kunde.adresse)) {
      quality = 'area';
      area++;
    } else {
      exact++;
    }

    await supabase
      .from('kunder')
      .update({ geocode_quality: quality })
      .eq('id', kunde.id);
  }

  console.log(`\nOppdatert ${kunder.length} kunder:`);
  console.log(`  - Eksakt: ${exact}`);
  console.log(`  - Område: ${area}`);
}

migrate().catch(console.error);

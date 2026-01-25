/**
 * Sync Script: SQLite to Supabase
 * Completely replaces Supabase data with SQLite data
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

async function sync() {
  console.log('=== Synkroniserer SQLite til Supabase ===\n');

  // Connect to SQLite
  const sqliteDb = new Database('kunder.db');

  // Connect to Supabase
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get all customers from SQLite
  const customers = sqliteDb.prepare('SELECT * FROM kunder').all();
  console.log(`SQLite: ${customers.length} kunder\n`);

  // Count existing in Supabase
  const { count: existingCount } = await supabase
    .from('kunder')
    .select('*', { count: 'exact', head: true });

  console.log(`Supabase (før): ${existingCount || 0} kunder`);

  // Delete all existing customers in Supabase
  console.log('\nSletter alle kunder i Supabase...');
  const { error: deleteError } = await supabase
    .from('kunder')
    .delete()
    .neq('id', 0); // Delete all

  if (deleteError) {
    console.error('Feil ved sletting:', deleteError.message);
    return;
  }
  console.log('✓ Slettet');

  // Transform data for Supabase
  const customersForSupabase = customers.map(c => ({
    navn: c.navn,
    adresse: c.adresse,
    postnummer: c.postnummer,
    poststed: c.poststed,
    telefon: c.telefon || null,
    epost: c.epost || null,
    lat: c.lat,
    lng: c.lng,
    siste_kontroll: c.siste_kontroll || null,
    neste_kontroll: c.neste_kontroll || null,
    kontroll_intervall_mnd: c.kontroll_intervall_mnd || 12,
    notater: c.notater || null,
    kategori: c.kategori || 'El-Kontroll',
    el_type: c.el_type || null,
    brann_system: c.brann_system || null,
    brann_driftstype: c.brann_driftstype || null
  }));

  // Insert in batches
  console.log('\nSetter inn kunder...');
  const batchSize = 50;
  let successCount = 0;

  for (let i = 0; i < customersForSupabase.length; i += batchSize) {
    const batch = customersForSupabase.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    const { error } = await supabase
      .from('kunder')
      .insert(batch);

    if (error) {
      console.error(`Batch ${batchNum} feilet:`, error.message);
      console.error('Første kunde i batch:', JSON.stringify(batch[0], null, 2));
    } else {
      successCount += batch.length;
      console.log(`✓ Batch ${batchNum}: ${batch.length} kunder`);
    }
  }

  // Verify final count
  const { count: newCount } = await supabase
    .from('kunder')
    .select('*', { count: 'exact', head: true });

  console.log('\n=== Resultat ===');
  console.log(`Supabase (etter): ${newCount} kunder`);
  console.log(`Forventet: ${customers.length} kunder`);

  if (newCount === customers.length) {
    console.log('\n✓ Synkronisering vellykket!');
  } else {
    console.log('\n⚠ Antall stemmer ikke - sjekk feilmeldinger over');
  }

  // Show category breakdown
  const kategorier = {};
  customers.forEach(c => {
    const kat = c.kategori || 'Ukjent';
    kategorier[kat] = (kategorier[kat] || 0) + 1;
  });

  console.log('\nKategorier:');
  Object.entries(kategorier).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });

  sqliteDb.close();
}

sync().catch(console.error);

/**
 * Migration Script: SQLite to Supabase
 * Migrates all customers from local SQLite database to Supabase
 * Updated for multi-tenancy support
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Organization ID to migrate data to (set this to your organization's ID)
const ORGANIZATION_ID = 1;

async function migrate() {
  console.log('Starting migration from SQLite to Supabase...\n');
  console.log(`Target organization_id: ${ORGANIZATION_ID}\n`);

  // Connect to SQLite
  const sqliteDb = new Database('kunder.db');

  // Connect to Supabase (use service role for RLS bypass)
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get all customers from SQLite
  const customers = sqliteDb.prepare('SELECT * FROM kunder').all();
  console.log(`Found ${customers.length} customers in SQLite\n`);

  if (customers.length === 0) {
    console.log('No customers to migrate');
    return;
  }

  // Transform data for Supabase with all fields including organization_id
  const customersForSupabase = customers.map(c => ({
    organization_id: ORGANIZATION_ID,
    navn: c.navn,
    adresse: c.adresse,
    postnummer: c.postnummer,
    poststed: c.poststed,
    telefon: c.telefon,
    epost: c.epost,
    lat: c.lat,
    lng: c.lng,
    // Kategori og type
    kategori: c.kategori || 'El-Kontroll',
    el_type: c.el_type,
    brann_system: c.brann_system,
    brann_driftstype: c.brann_driftstype,
    driftskategori: c.driftskategori,
    // El-Kontroll datoer
    siste_el_kontroll: c.siste_el_kontroll,
    neste_el_kontroll: c.neste_el_kontroll,
    el_kontroll_intervall: c.el_kontroll_intervall || 36,
    // Brannvarsling datoer
    siste_brann_kontroll: c.siste_brann_kontroll,
    neste_brann_kontroll: c.neste_brann_kontroll,
    brann_kontroll_intervall: c.brann_kontroll_intervall || 12,
    // Legacy felt
    siste_kontroll: c.siste_kontroll,
    neste_kontroll: c.neste_kontroll,
    kontroll_intervall_mnd: c.kontroll_intervall_mnd || 12,
    // Andre felt
    notater: c.notater,
    opprettet: c.opprettet || new Date().toISOString()
  }));

  // Insert in batches to avoid rate limits
  const batchSize = 50;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < customersForSupabase.length; i += batchSize) {
    const batch = customersForSupabase.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from('kunder')
      .insert(batch);

    if (error) {
      console.error(`Batch ${Math.floor(i/batchSize) + 1} failed:`, error.message);
      errorCount += batch.length;
    } else {
      successCount += batch.length;
      console.log(`Migrated batch ${Math.floor(i/batchSize) + 1}: ${batch.length} customers`);
    }
  }

  console.log('\n--- Migration Complete ---');
  console.log(`Successfully migrated: ${successCount} customers`);
  console.log(`Failed: ${errorCount} customers`);

  // Verify by counting in Supabase
  const { count, error: countError } = await supabase
    .from('kunder')
    .select('*', { count: 'exact', head: true });

  if (!countError) {
    console.log(`\nTotal customers in Supabase: ${count}`);
  }

  sqliteDb.close();
}

migrate().catch(console.error);

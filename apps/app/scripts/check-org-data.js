/**
 * Diagnostikk-script for å sjekke organisasjoner og kunder
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  console.log('\n========================================');
  console.log('  Database Diagnostikk');
  console.log('========================================\n');

  // 1. Finn admin@efffekt.no bruker
  console.log('🔍 Søker etter admin@efffekt.no...\n');

  // Sjekk i klient-tabellen
  const { data: klient } = await supabase
    .from('klient')
    .select('id, navn, epost, organization_id')
    .eq('epost', 'admin@efffekt.no')
    .single();

  // Sjekk i brukere-tabellen
  const { data: bruker } = await supabase
    .from('brukere')
    .select('id, navn, epost, organization_id')
    .eq('epost', 'admin@efffekt.no')
    .single();

  if (klient) {
    console.log('✅ Funnet i "klient" tabell:');
    console.log(`   ID: ${klient.id}`);
    console.log(`   Navn: ${klient.navn}`);
    console.log(`   Organization ID: ${klient.organization_id}`);
  }

  if (bruker) {
    console.log('✅ Funnet i "brukere" tabell:');
    console.log(`   ID: ${bruker.id}`);
    console.log(`   Navn: ${bruker.navn}`);
    console.log(`   Organization ID: ${bruker.organization_id}`);
  }

  if (!klient && !bruker) {
    console.log('❌ admin@efffekt.no ikke funnet i noen tabell!');
  }

  const userOrgId = klient?.organization_id || bruker?.organization_id;

  // 2. Vis alle organisasjoner
  console.log('\n----------------------------------------');
  console.log('📋 Alle organisasjoner:\n');

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, navn, slug')
    .order('id');

  for (const org of orgs || []) {
    const { count } = await supabase
      .from('kunder')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', org.id);

    const marker = org.id === userOrgId ? ' <-- DIN ORG' : '';
    console.log(`   ID ${org.id}: ${org.navn} (${org.slug}) - ${count || 0} kunder${marker}`);
  }

  // 3. Sammendrag
  console.log('\n----------------------------------------');
  console.log('📊 Sammendrag:\n');

  if (userOrgId) {
    const { count: userOrgCount } = await supabase
      .from('kunder')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', userOrgId);

    console.log(`   Din bruker (admin@efffekt.no) er knyttet til organization_id: ${userOrgId}`);
    console.log(`   Antall kunder i din organisasjon: ${userOrgCount || 0}`);

    if (userOrgCount === 0) {
      console.log('\n⚠️  PROBLEM: Din organisasjon har ingen kunder!');
      console.log('   Kjør seed-scriptet og velg organisation med ID ' + userOrgId);
    }
  }

  console.log('\n========================================\n');
}

diagnose().catch(console.error);

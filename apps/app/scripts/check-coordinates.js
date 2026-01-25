/**
 * Diagnostikk-script for å sjekke koordinater på kunder
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCoordinates() {
  console.log('\n========================================');
  console.log('  Sjekker koordinater på kunder');
  console.log('========================================\n');

  // Hent alle kunder for org 1 (Efffekt AS)
  const { data, error } = await supabase
    .from('kunder')
    .select('id, navn, lat, lng, adresse, postnummer, poststed')
    .eq('organization_id', 1)
    .limit(10);

  if (error) {
    console.error('Feil:', error);
    return;
  }

  console.log('Første 10 kunder:\n');

  for (const k of data) {
    const hasCoords = k.lat !== null && k.lng !== null;
    console.log(`ID ${k.id}: ${k.navn}`);
    console.log(`   Adresse: ${k.adresse}, ${k.postnummer} ${k.poststed}`);
    console.log(`   Koordinater: ${hasCoords ? `✅ (${k.lat}, ${k.lng})` : '❌ MANGLER'}`);
    console.log();
  }

  // Tell totalt
  const { count: totalCount } = await supabase
    .from('kunder')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', 1);

  const { count: noCoordCount } = await supabase
    .from('kunder')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', 1)
    .is('lat', null);

  console.log('----------------------------------------');
  console.log(`TOTALT: ${totalCount} kunder i Efffekt AS`);
  console.log(`Med koordinater: ${totalCount - noCoordCount}`);
  console.log(`UTEN koordinater: ${noCoordCount}`);

  if (noCoordCount > 0) {
    console.log(`\n⚠️  ${noCoordCount} kunder mangler koordinater og vil IKKE vises på kartet!`);
    console.log('   Kjør: node scripts/geocode-all.js for å legge til koordinater');
  } else {
    console.log('\n✅ Alle kunder har koordinater!');
  }

  console.log('\n========================================\n');
}

checkCoordinates().catch(console.error);

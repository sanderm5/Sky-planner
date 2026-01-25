#!/usr/bin/env node
/**
 * Legg til geocode_quality kolonne i Supabase
 * og sett kvalitet basert på adressetype
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addGeocodeQuality() {
  console.log('=== LEGGER TIL GEOCODE_QUALITY ===\n');

  // Sjekk om kolonnen allerede finnes ved å hente en kunde
  const { data: testKunde, error: testError } = await supabase
    .from('kunder')
    .select('geocode_quality')
    .limit(1);

  if (testError && testError.message.includes('column')) {
    console.log('Kolonnen geocode_quality finnes ikke ennå.');
    console.log('Du må legge den til manuelt i Supabase Dashboard:');
    console.log('');
    console.log('  1. Gå til https://supabase.com/dashboard');
    console.log('  2. Velg prosjektet ditt');
    console.log('  3. Gå til Table Editor -> kunder');
    console.log('  4. Klikk "Add column"');
    console.log('  5. Navn: geocode_quality');
    console.log('  6. Type: text');
    console.log('  7. Default: null');
    console.log('');
    console.log('Eller kjør denne SQL i SQL Editor:');
    console.log('');
    console.log('  ALTER TABLE kunder ADD COLUMN IF NOT EXISTS geocode_quality TEXT;');
    console.log('');
    return false;
  }

  console.log('Kolonnen geocode_quality finnes allerede!\n');

  // Hent alle kunder
  const { data: kunder, error } = await supabase
    .from('kunder')
    .select('id, adresse, lat, lng, geocode_quality');

  if (error) {
    console.log('FEIL:', error.message);
    return false;
  }

  console.log(`Oppdaterer kvalitet for ${kunder.length} kunder...\n`);

  let updated = 0;
  for (const kunde of kunder) {
    // Bestem kvalitet basert på adresse
    let quality = 'exact';

    if (!kunde.lat || !kunde.lng) {
      quality = null;
    } else if (!kunde.adresse || kunde.adresse.trim() === '') {
      quality = 'area';
    } else if (!/\d/.test(kunde.adresse)) {
      // Ingen tall i adressen = trolig stedsnavn
      quality = 'area';
    } else if (kunde.adresse.includes('/')) {
      // Matrikkel-format (f.eks. "201/856") = eksakt
      quality = 'exact';
    }

    // Oppdater kun hvis forskjellig
    if (kunde.geocode_quality !== quality) {
      const { error: updateError } = await supabase
        .from('kunder')
        .update({ geocode_quality: quality })
        .eq('id', kunde.id);

      if (!updateError) {
        updated++;
      }
    }
  }

  console.log(`Oppdatert ${updated} kunder med geocode_quality`);
  return true;
}

addGeocodeQuality().catch(console.error);

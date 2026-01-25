#!/usr/bin/env node
/**
 * Sjekk Supabase database status og diagnostiser geokoding
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDatabase() {
  console.log('=== SUPABASE DATABASE STATUS ===\n');

  // Hent alle kunder
  const { data: kunder, error } = await supabase
    .from('kunder')
    .select('*')
    .order('navn');

  if (error) {
    console.log('FEIL:', error.message);
    return;
  }

  console.log('Totalt antall kunder:', kunder.length);

  // Koordinat-statistikk
  const medKoordinater = kunder.filter(k => k.lat && k.lng).length;
  const utenKoordinater = kunder.filter(k => k.lat === null || k.lng === null).length;

  console.log('Med koordinater:', medKoordinater);
  console.log('Uten koordinater:', utenKoordinater);

  // Vis de første 5 kundene
  console.log('\n--- Første 5 kunder ---');
  kunder.slice(0, 5).forEach(k => {
    console.log(`  ${k.navn}`);
    console.log(`    Adresse: ${k.adresse}, ${k.postnummer} ${k.poststed}`);
    console.log(`    Koordinater: ${k.lat}, ${k.lng}`);
  });

  // Finn klustere (flere kunder på samme koordinater)
  const coordCounts = {};
  kunder.forEach(k => {
    if (k.lat && k.lng) {
      const key = k.lat.toFixed(4) + ',' + k.lng.toFixed(4);
      if (!coordCounts[key]) coordCounts[key] = [];
      coordCounts[key].push(k);
    }
  });

  const clusters = Object.entries(coordCounts).filter(([k, v]) => v.length > 1);
  console.log('\n--- KLUSTERE (flere kunder på samme sted) ---');
  console.log('Antall klustere:', clusters.length);

  if (clusters.length > 0) {
    clusters.sort((a, b) => b[1].length - a[1].length);
    clusters.forEach(([coord, customers]) => {
      console.log(`\n  [${coord}] - ${customers.length} kunder:`);
      customers.forEach(c => {
        console.log(`    - ${c.navn}: ${c.adresse}`);
      });
    });
  }

  // Sjekk for kunder uten husnummer
  const utenHusnummer = kunder.filter(k => {
    if (!k.adresse) return false;
    return !/\d/.test(k.adresse);
  });

  console.log('\n--- ADRESSER UTEN HUSNUMMER ---');
  console.log('Antall:', utenHusnummer.length);
  if (utenHusnummer.length > 0) {
    utenHusnummer.forEach(k => {
      console.log(`  - ${k.navn}: "${k.adresse}"`);
    });
  }

  // Sjekk for koordinater utenfor Norge
  const utenforNorge = kunder.filter(k => {
    if (!k.lat || !k.lng) return false;
    return k.lat < 57.5 || k.lat > 71.5 || k.lng < 4.0 || k.lng > 31.5;
  });

  console.log('\n--- KOORDINATER UTENFOR NORGE ---');
  console.log('Antall:', utenforNorge.length);
  if (utenforNorge.length > 0) {
    utenforNorge.forEach(k => {
      console.log(`  - ${k.navn}: (${k.lat}, ${k.lng})`);
    });
  }

  // Oppsummering
  console.log('\n=== OPPSUMMERING ===');
  console.log(`Totalt:              ${kunder.length}`);
  console.log(`Med koordinater:     ${medKoordinater}`);
  console.log(`Uten koordinater:    ${utenKoordinater}`);
  console.log(`I klustere:          ${clusters.reduce((sum, c) => sum + c[1].length, 0)}`);
  console.log(`Uten husnummer:      ${utenHusnummer.length}`);
  console.log(`Utenfor Norge:       ${utenforNorge.length}`);
}

checkDatabase().catch(console.error);

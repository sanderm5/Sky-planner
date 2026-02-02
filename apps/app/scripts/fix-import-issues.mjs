/**
 * Fix import issues:
 * 1. Remove duplicate customers (keep lowest ID)
 * 2. Fix wrong coordinates for Lorentzen Gårdsdrift Dal
 * 3. Calculate missing neste_brann_kontroll dates
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ORGANIZATION_ID = 5;
const DRY_RUN = !process.argv.includes('--fix');

console.log('='.repeat(70));
console.log('FIKS IMPORT-PROBLEMER');
console.log('Modus: ' + (DRY_RUN ? 'DRY-RUN (ingen endringer)' : 'FIKS'));
console.log('='.repeat(70));

const { data: kunder, error } = await supabase
  .from('kunder')
  .select('*')
  .eq('organization_id', ORGANIZATION_ID)
  .order('id');

if (error) {
  console.error('Feil:', error.message);
  process.exit(1);
}

console.log('\nTotalt kunder før fiks: ' + kunder.length);

// === 1. FIND AND REMOVE DUPLICATES ===
console.log('\n--- 1. DUPLIKATER ---');
const seen = new Map();
const toDelete = [];

for (const k of kunder) {
  const key = (k.navn + '|' + k.adresse).toLowerCase();
  if (seen.has(key)) {
    toDelete.push(k.id);
    console.log('  Slett ID ' + k.id + ': ' + k.navn);
  } else {
    seen.set(key, k);
  }
}

if (toDelete.length === 0) {
  console.log('  Ingen duplikater funnet');
} else if (!DRY_RUN) {
  for (const id of toDelete) {
    await supabase.from('kunder').delete().eq('id', id);
  }
  console.log('  Slettet ' + toDelete.length + ' duplikater');
}

// === 2. FIX WRONG COORDINATES ===
console.log('\n--- 2. FEIL KOORDINATER ---');

// Known corrections for places that geocode wrong
const manualCoords = {
  'Valberg': { lat: 68.1716, lng: 13.5713 },  // Valberg i Lofoten
  'Engleøya': { lat: 67.9342, lng: 15.0841 },
  'Stongelandseidet': { lat: 69.0771, lng: 17.0411 }
};

const wrongCoords = kunder.filter(k => {
  if (!k.lat || !k.lng) return false;
  // Check if coordinates are outside Northern Norway (should be lat 66-72, lng 10-32)
  return k.lat < 66 || k.lat > 72 || k.lng < 10 || k.lng > 32;
});

for (const k of wrongCoords) {
  console.log('  ' + k.navn + ' (' + k.poststed + '): lat=' + k.lat.toFixed(2) + ', lng=' + k.lng.toFixed(2));

  // Check for manual correction first
  if (manualCoords[k.poststed]) {
    const p = manualCoords[k.poststed];
    console.log('    -> Manuell korreksjon: lat=' + p.lat.toFixed(4) + ', lng=' + p.lng.toFixed(4));

    if (!DRY_RUN) {
      await supabase
        .from('kunder')
        .update({ lat: p.lat, lng: p.lng })
        .eq('id', k.id);
    }
  } else {
    // Try to geocode correctly
    const searchText = k.adresse + ' ' + k.postnummer + ' ' + k.poststed;
    try {
      const url = 'https://ws.geonorge.no/adresser/v1/sok?sok=' + encodeURIComponent(searchText) + '&treffPerSide=1';
      const response = await fetch(url);
      const data = await response.json();

      if (data.adresser && data.adresser[0]?.representasjonspunkt) {
        const p = data.adresser[0].representasjonspunkt;
        console.log('    -> Ny: lat=' + p.lat.toFixed(4) + ', lng=' + p.lon.toFixed(4));

        if (!DRY_RUN) {
          await supabase
            .from('kunder')
            .update({ lat: p.lat, lng: p.lon })
            .eq('id', k.id);
        }
      }
    } catch (e) {
      console.log('    Geocoding feilet: ' + e.message);
    }
  }
}

if (wrongCoords.length === 0) {
  console.log('  Ingen feil koordinater funnet');
}

// === 3. FIX MISSING NESTE_BRANN_KONTROLL ===
console.log('\n--- 3. MANGLENDE NESTE_BRANN_KONTROLL ---');
const missingBrannNext = kunder.filter(k =>
  k.kategori && k.kategori.includes('Brann') &&
  k.siste_brann_kontroll && !k.neste_brann_kontroll
);

for (const k of missingBrannNext) {
  // Calculate next date based on interval (default 12 months)
  const interval = k.brann_kontroll_intervall || 12;
  const siste = new Date(k.siste_brann_kontroll);
  const neste = new Date(siste);
  neste.setMonth(neste.getMonth() + interval);
  const nesteStr = neste.toISOString().split('T')[0];

  console.log('  ' + k.navn + ': ' + k.siste_brann_kontroll + ' + ' + interval + ' mnd = ' + nesteStr);

  if (!DRY_RUN) {
    await supabase
      .from('kunder')
      .update({ neste_brann_kontroll: nesteStr })
      .eq('id', k.id);
  }
}

if (missingBrannNext.length === 0) {
  console.log('  Ingen manglende datoer');
}

// === SUMMARY ===
console.log('\n' + '='.repeat(70));
console.log('OPPSUMMERING:');
console.log('  Duplikater å slette: ' + toDelete.length);
console.log('  Feil koordinater å fikse: ' + wrongCoords.length);
console.log('  Manglende brann-datoer å beregne: ' + missingBrannNext.length);

if (DRY_RUN) {
  console.log('\nKjør med --fix for å utføre endringene:');
  console.log('  node scripts/fix-import-issues.mjs --fix');
}
console.log('='.repeat(70));

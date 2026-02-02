import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: kunder } = await supabase
  .from('kunder')
  .select('*')
  .eq('organization_id', 5)
  .order('id');

console.log('='.repeat(70));
console.log('DETALJERT PROBLEMANALYSE');
console.log('='.repeat(70));

// 1. Find duplicates
console.log('\n=== DUPLIKATER ===');
const seen = new Map();
for (const k of kunder) {
  const key = (k.navn + '|' + k.adresse).toLowerCase();
  if (seen.has(key)) {
    const orig = seen.get(key);
    console.log('\nDuplikat funnet:');
    console.log('  Original (ID ' + orig.id + '):');
    console.log('    Navn: ' + orig.navn);
    console.log('    El: ' + (orig.siste_el_kontroll || '-') + ' -> ' + (orig.neste_el_kontroll || '-'));
    console.log('    Brann: ' + (orig.siste_brann_kontroll || '-') + ' -> ' + (orig.neste_brann_kontroll || '-'));
    console.log('  Duplikat (ID ' + k.id + '):');
    console.log('    Navn: ' + k.navn);
    console.log('    El: ' + (k.siste_el_kontroll || '-') + ' -> ' + (k.neste_el_kontroll || '-'));
    console.log('    Brann: ' + (k.siste_brann_kontroll || '-') + ' -> ' + (k.neste_brann_kontroll || '-'));
  } else {
    seen.set(key, k);
  }
}

// 2. Check for wrong coordinates (should be in Northern Norway: lat 66-72, lng 10-32)
console.log('\n\n=== FEIL KOORDINATER ===');
console.log('(Forventet: Nord-Norge, lat 66-72, lng 10-32)');
const wrongCoords = kunder.filter(k => {
  if (!k.lat || !k.lng) return true;
  // Check if coordinates are outside Northern Norway
  if (k.lat < 66 || k.lat > 72 || k.lng < 10 || k.lng > 32) return true;
  return false;
});
console.log('Antall med feil/mistenkte koordinater: ' + wrongCoords.length);
wrongCoords.forEach(k => {
  console.log('  - ' + k.navn + ' (' + k.poststed + '): lat=' + (k.lat?.toFixed(2) || 'null') + ', lng=' + (k.lng?.toFixed(2) || 'null'));
});

// 3. Check for missing brann dates when category includes Brann
console.log('\n\n=== BRANNVARSLING UTEN NESTE DATO ===');
const missingBrannDates = kunder.filter(k =>
  k.kategori && k.kategori.includes('Brann') && !k.neste_brann_kontroll
);
console.log('Antall: ' + missingBrannDates.length);
missingBrannDates.forEach(k => {
  console.log('  - ' + k.navn);
  console.log('    Siste brann: ' + (k.siste_brann_kontroll || '(ingen)'));
  console.log('    Kategori: ' + k.kategori);
});

// 4. Check for customers that might be missing from the map (no category or invalid data)
console.log('\n\n=== KUNDER UTEN KATEGORI ===');
const noCategory = kunder.filter(k => !k.kategori);
console.log('Antall: ' + noCategory.length);
noCategory.forEach(k => {
  console.log('  - ' + k.navn);
});

console.log('\n' + '='.repeat(70));

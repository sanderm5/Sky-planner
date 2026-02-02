/**
 * Sjekker hvilke kunder som mangler data
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data } = await supabase.from('kunder')
  .select('*')
  .eq('organization_id', 5);

console.log('='.repeat(60));
console.log('MANGELANALYSE');
console.log('='.repeat(60));
console.log('Totalt antall kunder:', data.length);

// Mangler koordinater
const noCoords = data.filter(k => !k.lat || !k.lng);
console.log('\n--- MANGLER KOORDINATER (' + noCoords.length + ') ---');
noCoords.forEach(k => console.log('  ' + k.navn + ' - ' + (k.adresse || '(ingen adresse)')));

// El-kontroll uten datoer
const elUtenDato = data.filter(k =>
  k.kategori && k.kategori.includes('El-Kontroll') && !k.neste_el_kontroll
);
console.log('\n--- EL-KONTROLL UTEN NESTE DATO (' + elUtenDato.length + ') ---');
elUtenDato.forEach(k => console.log('  ' + k.navn + ' (siste: ' + (k.siste_el_kontroll || 'ingen') + ')'));

// Brann uten datoer
const brannUtenDato = data.filter(k =>
  k.kategori && k.kategori.includes('Brann') && !k.neste_brann_kontroll
);
console.log('\n--- BRANNVARSLING UTEN NESTE DATO (' + brannUtenDato.length + ') ---');
brannUtenDato.forEach(k => console.log('  ' + k.navn + ' (siste: ' + (k.siste_brann_kontroll || 'ingen') + ')'));

// Mangler adresse
const noAddr = data.filter(k => !k.adresse);
console.log('\n--- MANGLER ADRESSE (' + noAddr.length + ') ---');
noAddr.forEach(k => console.log('  ' + k.navn));

// Mangler kategori
const noCat = data.filter(k => !k.kategori);
console.log('\n--- MANGLER KATEGORI (' + noCat.length + ') ---');
noCat.forEach(k => console.log('  ' + k.navn));

// Mangler el_type for el-kontroll kunder
const elUtenType = data.filter(k =>
  k.kategori && k.kategori.includes('El-Kontroll') && !k.el_type
);
console.log('\n--- EL-KONTROLL UTEN EL_TYPE (' + elUtenType.length + ') ---');
if (elUtenType.length <= 20) {
  elUtenType.forEach(k => console.log('  ' + k.navn));
} else {
  console.log('  (viser første 20)');
  elUtenType.slice(0, 20).forEach(k => console.log('  ' + k.navn));
}

// Mangler brann_system for brann kunder
const brannUtenSystem = data.filter(k =>
  k.kategori && k.kategori.includes('Brann') && !k.brann_system
);
console.log('\n--- BRANNVARSLING UTEN BRANN_SYSTEM (' + brannUtenSystem.length + ') ---');
if (brannUtenSystem.length <= 20) {
  brannUtenSystem.forEach(k => console.log('  ' + k.navn));
} else {
  console.log('  (viser første 20)');
  brannUtenSystem.slice(0, 20).forEach(k => console.log('  ' + k.navn));
}

console.log('\n' + '='.repeat(60));
console.log('OPPSUMMERING');
console.log('='.repeat(60));
console.log('Mangler koordinater:', noCoords.length);
console.log('El-kontroll uten neste dato:', elUtenDato.length);
console.log('Brannvarsling uten neste dato:', brannUtenDato.length);
console.log('Mangler adresse:', noAddr.length);
console.log('Mangler kategori:', noCat.length);
console.log('El-kontroll uten el_type:', elUtenType.length);
console.log('Brannvarsling uten brann_system:', brannUtenSystem.length);
console.log('='.repeat(60));

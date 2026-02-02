import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: kunder } = await supabase
  .from('kunder')
  .select('*')
  .eq('organization_id', 5);

console.log('='.repeat(70));
console.log('SJEKK AV VIKTIGE FELT');
console.log('='.repeat(70));
console.log('\nTotalt kunder:', kunder.length);

// Check Tripletex/external_id
const withTripletex = kunder.filter(k => k.external_id);
console.log('\n=== TRIPLETEX PROSJEKTNUMMER ===');
console.log('Med external_id:', withTripletex.length);
console.log('Uten external_id:', kunder.length - withTripletex.length);
if (withTripletex.length > 0) {
  console.log('Eksempler:');
  withTripletex.slice(0, 5).forEach(k => {
    console.log('  ' + k.navn + ': ' + k.external_id);
  });
}

// Check brann_system
const withBrannSystem = kunder.filter(k => k.brann_system);
console.log('\n=== BRANNSYSTEM ===');
console.log('Med brann_system:', withBrannSystem.length);
const brannSystems = {};
withBrannSystem.forEach(k => {
  brannSystems[k.brann_system] = (brannSystems[k.brann_system] || 0) + 1;
});
console.log('Fordeling:');
Object.entries(brannSystems).sort((a,b) => b[1] - a[1]).forEach(([sys, count]) => {
  console.log('  ' + count + ' - ' + sys);
});

// Check brann_driftstype (storfe, sau, etc)
const withDriftstype = kunder.filter(k => k.brann_driftstype);
console.log('\n=== DRIFTSTYPE (Storfe, Sau, etc) ===');
console.log('Med brann_driftstype:', withDriftstype.length);
const driftstyper = {};
withDriftstype.forEach(k => {
  driftstyper[k.brann_driftstype] = (driftstyper[k.brann_driftstype] || 0) + 1;
});
console.log('Fordeling:');
Object.entries(driftstyper).sort((a,b) => b[1] - a[1]).forEach(([type, count]) => {
  console.log('  ' + count + ' - ' + type);
});

// Check el_type
const withElType = kunder.filter(k => k.el_type);
console.log('\n=== EL-TYPE ===');
console.log('Med el_type:', withElType.length);
const elTypes = {};
withElType.forEach(k => {
  elTypes[k.el_type] = (elTypes[k.el_type] || 0) + 1;
});
console.log('Fordeling:');
Object.entries(elTypes).sort((a,b) => b[1] - a[1]).forEach(([type, count]) => {
  console.log('  ' + count + ' - ' + type);
});

// Show some sample data with all fields
console.log('\n=== EKSEMPEL MED ALLE FELT ===');
const samples = kunder.filter(k => k.brann_system && k.brann_driftstype).slice(0, 3);
samples.forEach(k => {
  console.log('\n' + k.navn);
  console.log('  Tripletex/external_id: ' + (k.external_id || '(mangler)'));
  console.log('  El-type: ' + (k.el_type || '(mangler)'));
  console.log('  Brann-system: ' + (k.brann_system || '(mangler)'));
  console.log('  Driftstype: ' + (k.brann_driftstype || '(mangler)'));
});

console.log('\n' + '='.repeat(70));

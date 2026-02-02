import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: kunder, error } = await supabase
  .from('kunder')
  .select('*')
  .eq('organization_id', 5);

if (error) {
  console.error('Feil:', error.message);
  process.exit(1);
}

console.log('='.repeat(70));
console.log('AUDIT: TRE ALLSERVICE KUNDEDATA');
console.log('='.repeat(70));

console.log('\n1. TOTALT ANTALL:', kunder.length);

// Check for duplicates by name+address
const seen = new Map();
const duplicates = [];
for (const k of kunder) {
  const key = (k.navn + '|' + k.adresse).toLowerCase();
  if (seen.has(key)) {
    duplicates.push({ original: seen.get(key), duplicate: k });
  } else {
    seen.set(key, k);
  }
}
console.log('\n2. DUPLIKATER (samme navn+adresse):', duplicates.length);
if (duplicates.length > 0) {
  console.log('   Eksempler:');
  duplicates.slice(0, 10).forEach(d => {
    console.log('   - "' + d.original.navn + '" @ ' + d.original.adresse);
    console.log('     ID ' + d.original.id + ' vs ID ' + d.duplicate.id);
  });
}

// Check categories
const categories = {};
for (const k of kunder) {
  const cat = k.kategori || '(ingen)';
  categories[cat] = (categories[cat] || 0) + 1;
}
console.log('\n3. KATEGORIER:');
Object.entries(categories).sort((a,b) => b[1] - a[1]).forEach(([cat, count]) => {
  console.log('   ' + count + ' - ' + cat);
});

// Check dates
let validElDates = 0, validBrannDates = 0;
let missingNextEl = 0, missingNextBrann = 0;
let pastDueEl = 0, pastDueBrann = 0;
const now = new Date().toISOString().split('T')[0];

for (const k of kunder) {
  if (k.neste_el_kontroll) {
    validElDates++;
    if (k.neste_el_kontroll < now) pastDueEl++;
  } else if (k.kategori && k.kategori.includes('El')) {
    missingNextEl++;
  }

  if (k.neste_brann_kontroll) {
    validBrannDates++;
    if (k.neste_brann_kontroll < now) pastDueBrann++;
  } else if (k.kategori && k.kategori.includes('Brann')) {
    missingNextBrann++;
  }
}
console.log('\n4. KONTROLLDATOER:');
console.log('   El-kontroll:    ' + validElDates + ' med neste dato, ' + missingNextEl + ' mangler, ' + pastDueEl + ' forfalt');
console.log('   Brannvarsling:  ' + validBrannDates + ' med neste dato, ' + missingNextBrann + ' mangler, ' + pastDueBrann + ' forfalt');

// Check for missing required data
let missingPhone = 0, missingEmail = 0, missingPostnr = 0;
for (const k of kunder) {
  if (!k.telefon) missingPhone++;
  if (!k.epost) missingEmail++;
  if (!k.postnummer) missingPostnr++;
}
console.log('\n5. MANGLENDE KONTAKTINFO:');
console.log('   Uten telefon:    ' + missingPhone);
console.log('   Uten e-post:     ' + missingEmail);
console.log('   Uten postnummer: ' + missingPostnr);

// Check coordinates
let badCoords = 0;
const badCoordsList = [];
for (const k of kunder) {
  if (!k.lat || !k.lng || k.lat < 58 || k.lat > 72 || k.lng < 4 || k.lng > 32) {
    badCoords++;
    badCoordsList.push(k);
  }
}
console.log('\n6. KOORDINATER:');
console.log('   Ugyldige/mangler: ' + badCoords);
if (badCoordsList.length > 0) {
  console.log('   Eksempler:');
  badCoordsList.slice(0, 5).forEach(k => {
    console.log('   - ' + k.navn + ': lat=' + k.lat + ', lng=' + k.lng);
  });
}

// Show some sample data
console.log('\n7. EKSEMPEL-DATA (5 tilfeldige):');
const samples = kunder.sort(() => Math.random() - 0.5).slice(0, 5);
for (const k of samples) {
  console.log('\n   ' + k.navn);
  console.log('   Adresse: ' + k.adresse + ', ' + k.postnummer + ' ' + k.poststed);
  console.log('   Telefon: ' + (k.telefon || '(mangler)') + ', E-post: ' + (k.epost || '(mangler)'));
  console.log('   Kategori: ' + k.kategori);
  console.log('   El: ' + (k.siste_el_kontroll || '-') + ' -> ' + (k.neste_el_kontroll || '-'));
  console.log('   Brann: ' + (k.siste_brann_kontroll || '-') + ' -> ' + (k.neste_brann_kontroll || '-'));
  console.log('   Koordinater: ' + (k.lat ? k.lat.toFixed(4) : 'null') + ', ' + (k.lng ? k.lng.toFixed(4) : 'null'));
}

// Check for data that looks wrong
console.log('\n8. POTENSIELLE PROBLEMER:');

// Customers with category but no dates
const noCatDates = kunder.filter(k => {
  if (k.kategori && k.kategori.includes('El') && !k.neste_el_kontroll && !k.siste_el_kontroll) return true;
  if (k.kategori && k.kategori.includes('Brann') && !k.neste_brann_kontroll && !k.siste_brann_kontroll) return true;
  return false;
});
console.log('   Kategori men ingen datoer: ' + noCatDates.length);
if (noCatDates.length > 0) {
  noCatDates.slice(0, 5).forEach(k => {
    console.log('   - ' + k.navn + ' (' + k.kategori + ')');
  });
}

console.log('\n' + '='.repeat(70));

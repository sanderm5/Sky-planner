import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Get customers from DB for organization 5 (Tre Allservice)
const { data: dbCustomers, error } = await supabase
  .from('kunder')
  .select('id, navn, adresse, postnummer, poststed, lat, lng, kategori, el_type, brann_system, brann_driftstype')
  .eq('organization_id', 5);

if (error) {
  console.error('DB Error:', error);
  process.exit(1);
}

// Simple CSV line count (skip header)
const csvContent = fs.readFileSync('/Users/sandermartinsen/Utvilkling/skyplanner/cleaned-for-import.csv', 'utf-8');
const csvLines = csvContent.split('\n').filter(l => l.trim());
const csvCount = csvLines.length - 1;

console.log('=== DATA SAMMENLIGNING ===\n');
console.log('CSV kunder: ' + csvCount);
console.log('Database kunder: ' + dbCustomers.length);
console.log('Differanse: ' + (csvCount - dbCustomers.length));

// Check coordinates
const withCoords = dbCustomers.filter(c => c.lat && c.lng);
const withoutCoords = dbCustomers.filter(c => !c.lat || !c.lng);
console.log('\n=== KOORDINATER ===');
console.log('Med koordinater: ' + withCoords.length);
console.log('Uten koordinater: ' + withoutCoords.length);

if (withoutCoords.length > 0) {
  console.log('\nKunder uten koordinater:');
  withoutCoords.slice(0, 10).forEach(c => console.log('  - ' + c.navn + ': ' + c.adresse + ', ' + c.postnummer + ' ' + c.poststed));
  if (withoutCoords.length > 10) console.log('  ... og ' + (withoutCoords.length - 10) + ' flere');
}

// Check categories
console.log('\n=== KATEGORIER I DB ===');
const categories = {};
dbCustomers.forEach(c => {
  const cat = c.kategori || 'Ingen';
  categories[cat] = (categories[cat] || 0) + 1;
});
Object.entries(categories).sort((a,b) => b[1] - a[1]).forEach(([cat, count]) => {
  console.log('  ' + cat + ': ' + count);
});

// Check el_type
console.log('\n=== KUNDETYPE (el_type) I DB ===');
const elTypes = {};
dbCustomers.forEach(c => {
  const t = c.el_type || 'Ingen';
  elTypes[t] = (elTypes[t] || 0) + 1;
});
Object.entries(elTypes).sort((a,b) => b[1] - a[1]).forEach(([t, count]) => {
  console.log('  ' + t + ': ' + count);
});

// Check brann_system
console.log('\n=== BRANNSYSTEM I DB ===');
const systems = {};
dbCustomers.forEach(c => {
  const s = c.brann_system || 'Ingen';
  systems[s] = (systems[s] || 0) + 1;
});
Object.entries(systems).sort((a,b) => b[1] - a[1]).forEach(([s, count]) => {
  console.log('  ' + s + ': ' + count);
});

// Check brann_driftstype
console.log('\n=== DRIFTSTYPE I DB ===');
const drifts = {};
dbCustomers.forEach(c => {
  const d = c.brann_driftstype || 'Ingen';
  drifts[d] = (drifts[d] || 0) + 1;
});
Object.entries(drifts).sort((a,b) => b[1] - a[1]).forEach(([d, count]) => {
  console.log('  ' + d + ': ' + count);
});

// Find missing customers
console.log('\n=== MANGLENDE KUNDER ===');
const dbNames = new Set(dbCustomers.map(c => c.navn.toLowerCase().trim()));
const header = csvLines[0].split(',');
const navnIdx = header.indexOf('navn');

for (let i = 1; i < csvLines.length; i++) {
  // Simple CSV field extraction (handles quoted fields)
  const line = csvLines[i];
  let navn = '';
  if (line.startsWith('"')) {
    navn = line.substring(1, line.indexOf('",'));
  } else {
    navn = line.split(',')[0];
  }
  navn = navn.trim();
  if (navn && !dbNames.has(navn.toLowerCase())) {
    console.log('Mangler i DB: ' + navn);
  }
}

// Summary
if (csvCount === dbCustomers.length) {
  console.log('\n=== RESULTAT ===');
  console.log('ALLE ' + csvCount + ' kunder fra CSV er importert til databasen!');
} else {
  console.log('\n=== RESULTAT ===');
  console.log('ADVARSEL: Det er ' + Math.abs(csvCount - dbCustomers.length) + ' forskjell mellom CSV og database');
}

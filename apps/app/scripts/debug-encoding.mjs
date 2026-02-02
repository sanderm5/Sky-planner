import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

// Read CSV
const content = fs.readFileSync('../../El-kontroll og brannvarsling 12.3 (1).csv', 'utf-8');
const lines = content.split(/\r?\n/);

console.log('=== CSV ENCODING TEST ===\n');

// Test specific names
const testRows = [16, 31, 36, 48]; // Rows with Norwegian chars
for (const rowNum of testRows) {
  if (rowNum >= lines.length) continue;
  const cols = lines[rowNum].split(';');
  const kunde = cols[16] || '';
  if (kunde.trim()) {
    console.log(`Row ${rowNum}: "${kunde.trim()}"`);
  }
}

// Get DB names to compare
console.log('\n=== DB NAMES ===\n');
const { data } = await supabase.from('kunder').select('id, navn').limit(20);
data.forEach(c => {
  console.log(`ID ${c.id}: "${c.navn}"`);
});

// Try to find Håkon Skogvold specifically
console.log('\n=== SEARCH TEST ===\n');
const { data: search1 } = await supabase.from('kunder').select('id, navn').ilike('navn', '%skogvold%');
console.log('Searching "skogvold":');
search1.forEach(c => console.log(`  ID ${c.id}: "${c.navn}"`));

const { data: search2 } = await supabase.from('kunder').select('id, navn').ilike('navn', '%nerg%');
console.log('\nSearching "nerg":');
search2.forEach(c => console.log(`  ID ${c.id}: "${c.navn}"`));

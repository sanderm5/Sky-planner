import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: kunder, error } = await supabase
  .from('kunder')
  .select('id, navn, adresse')
  .eq('organization_id', 5)
  .order('id');

if (error) {
  console.error('Feil:', error.message);
  process.exit(1);
}

// Find ID gaps to identify separate imports
const ids = kunder.map(k => k.id).sort((a,b) => a-b);
const minId = ids[0];
const maxId = ids[ids.length - 1];

console.log('ID-range: ' + minId + ' - ' + maxId);
console.log('Totalt: ' + kunder.length);

// Find gaps larger than 10 (indicates separate import batches)
let lastId = ids[0];
const batches = [[ids[0]]];
for (let i = 1; i < ids.length; i++) {
  if (ids[i] - lastId > 10) {
    batches.push([]);
  }
  batches[batches.length - 1].push(ids[i]);
  lastId = ids[i];
}

console.log('\nImport-batches (separert av ID-gap > 10):');
batches.forEach((batch, i) => {
  console.log('  Batch ' + (i+1) + ': ID ' + batch[0] + ' - ' + batch[batch.length-1] + ' (' + batch.length + ' kunder)');
});

// Show all duplicates
console.log('\n=== ALLE DUPLIKATER ===');
const seen = new Map();
for (const k of kunder) {
  const key = (k.navn + '|' + k.adresse).toLowerCase();
  if (seen.has(key)) {
    const orig = seen.get(key);
    console.log('  "' + k.navn + '" @ ' + k.adresse);
    console.log('    ID ' + orig.id + ' (beholder) vs ID ' + k.id + ' (slett)');
  } else {
    seen.set(key, k);
  }
}

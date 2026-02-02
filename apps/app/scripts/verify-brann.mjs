import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

console.log('=== DE 3 BRANNVARSLING-ONLY KUNDENE FRA CSV ===\n');

// The 3 customers from CSV that should be Brannvarsling only
const brannOnly = ['Marie Skogvold', 'Filip Bakke', 'Unni Brunes Visthoff'];

for (const name of brannOnly) {
  const { data } = await supabase.from('kunder')
    .select('id, navn, kategori, el_type, siste_el_kontroll, neste_el_kontroll, brann_system, brann_driftstype, siste_brann_kontroll, neste_brann_kontroll')
    .ilike('navn', '%' + name + '%');

  if (data && data.length > 0) {
    const c = data[0];
    const isCorrect = c.kategori === 'Brannvarsling' ? '✓ KORREKT' : '✗ FEIL';
    console.log(`${c.navn}: ${c.kategori} ${isCorrect}`);
    console.log(`  El: type=${c.el_type || '-'}, siste=${c.siste_el_kontroll || '-'}, neste=${c.neste_el_kontroll || '-'}`);
    console.log(`  Brann: system=${c.brann_system || '-'}, drift=${c.brann_driftstype || '-'}, siste=${c.siste_brann_kontroll || '-'}`);
    console.log();
  } else {
    console.log(`${name}: IKKE FUNNET I DATABASE\n`);
  }
}

// Count all Brannvarsling customers
const { data: allBrann } = await supabase.from('kunder').select('navn').eq('kategori', 'Brannvarsling');
console.log(`\nTotalt ${allBrann?.length || 0} kunder med kategori "Brannvarsling" i databasen`);

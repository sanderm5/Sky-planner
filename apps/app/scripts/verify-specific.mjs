import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const names = ['Berit Jakobsen', 'Marie Skogvold', 'Filip Bakke', 'Håkon Skogvold', 'Tove Hanssen', 'Jonny Rune Amundsen'];

console.log('=== DATABASE-VERDIER FOR SAMME KUNDER ===\n');

for (const name of names) {
  const searchTerm = name.split(' ').slice(-1)[0]; // Use last name
  const { data } = await supabase.from('kunder')
    .select('id, navn, kategori, el_type, siste_el_kontroll, neste_el_kontroll, brann_system, brann_driftstype, siste_brann_kontroll, neste_brann_kontroll')
    .ilike('navn', '%' + searchTerm + '%');

  const match = data?.find(c => c.navn.includes(name.split(' ')[0]) || c.navn.includes(searchTerm));

  if (match) {
    console.log(`${match.navn}:`);
    console.log(`  KATEGORI: ${match.kategori}`);
    console.log(`  El: type=${match.el_type || '-'}, siste=${match.siste_el_kontroll || '-'}, neste=${match.neste_el_kontroll || '-'}`);
    console.log(`  Brann: system=${match.brann_system || '-'}, drift=${match.brann_driftstype || '-'}, siste=${match.siste_brann_kontroll || '-'}, neste=${match.neste_brann_kontroll || '-'}`);
    console.log();
  } else {
    console.log(`${name}: IKKE FUNNET\n`);
  }
}

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const { data, error } = await supabase
  .from('kunder')
  .select('id, navn, adresse, postnummer, poststed, lat, lng, organization_id')
  .eq('organization_id', 5);

if (error) {
  console.log('Feil:', error.message);
} else {
  const total = data.length;
  const withCoords = data.filter(k => k.lat && k.lng).length;
  console.log('Totalt kunder (org 5):', total);
  console.log('Med koordinater:', withCoords);
  console.log('Uten koordinater:', total - withCoords);
  
  const noCoords = data.filter(k => !k.lat || !k.lng);
  if (noCoords.length > 0) {
    console.log('\nKunder uten koordinater:');
    noCoords.slice(0, 25).forEach(k => {
      console.log('  -', k.navn, ':', k.adresse, k.postnummer, k.poststed);
    });
    if (noCoords.length > 25) {
      console.log('  ... og', noCoords.length - 25, 'flere');
    }
  }
}

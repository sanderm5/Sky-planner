import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Coordinates for postal codes (approximate center of area)
const coords = {
  '8289': { lat: 67.9342279, lng: 15.0840873 },  // Engleøya area
  '9392': { lat: 69.0770906, lng: 17.0411417 }   // Stongelandseidet area
};

// Get customers without coordinates
const { data: customers } = await supabase
  .from('kunder')
  .select('id, navn, postnummer')
  .eq('organization_id', 5)
  .or('lat.is.null,lng.is.null');

console.log('Oppdaterer ' + customers.length + ' kunder...');

for (const k of customers) {
  const c = coords[k.postnummer];
  if (c) {
    await supabase
      .from('kunder')
      .update({ lat: c.lat, lng: c.lng })
      .eq('id', k.id);
    console.log('  ' + k.navn + ': OK (postnummer ' + k.postnummer + ')');
  } else {
    console.log('  ' + k.navn + ': Ukjent postnummer ' + k.postnummer);
  }
}

console.log('Ferdig!');

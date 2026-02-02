/**
 * Geokoder kunder som mangler koordinater
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const KARTVERKET_API = 'https://ws.geonorge.no/adresser/v1/sok';
const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';

async function geocodeKartverket(adresse, postnummer, poststed) {
  const searchText = [adresse, postnummer, poststed].filter(Boolean).join(' ');
  const url = `${KARTVERKET_API}?sok=${encodeURIComponent(searchText)}&treffPerSide=1`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      const result = data.adresser[0];
      if (result.representasjonspunkt) {
        return {
          lat: result.representasjonspunkt.lat,
          lng: result.representasjonspunkt.lon,
          matched: result.adressetekst
        };
      }
    }
  } catch (e) {
    console.log('  Kartverket feilet:', e.message);
  }
  return null;
}

async function geocodeNominatim(adresse, postnummer, poststed) {
  const fullAddress = [adresse, postnummer, poststed, 'Norway'].filter(Boolean).join(', ');
  const url = `${NOMINATIM_API}?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SkyPlanner/1.0' }
    });
    const data = await response.json();

    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        matched: data[0].display_name
      };
    }
  } catch (e) {
    console.log('  Nominatim feilet:', e.message);
  }
  return null;
}

async function main() {
  console.log('='.repeat(60));
  console.log('GEOKODING AV KUNDER UTEN KOORDINATER');
  console.log('='.repeat(60));

  // Hent kunder uten koordinater
  const { data: customers } = await supabase.from('kunder')
    .select('id, navn, adresse, postnummer, poststed')
    .eq('organization_id', 5)
    .or('lat.is.null,lng.is.null');

  console.log(`Fant ${customers.length} kunder uten koordinater\n`);

  let successCount = 0;

  for (const k of customers) {
    console.log(`${k.navn}:`);
    console.log(`  Adresse: ${k.adresse}, ${k.postnummer} ${k.poststed}`);

    // Prøv Kartverket først
    let result = await geocodeKartverket(k.adresse, k.postnummer, k.poststed);

    // Fallback til Nominatim
    if (!result) {
      await new Promise(r => setTimeout(r, 1000)); // Rate limit
      result = await geocodeNominatim(k.adresse, k.postnummer, k.poststed);
    }

    if (result) {
      console.log(`  Funnet: ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`);
      console.log(`  Matchet: ${result.matched}`);

      // Oppdater i database
      const { error } = await supabase.from('kunder')
        .update({ lat: result.lat, lng: result.lng })
        .eq('id', k.id);

      if (error) {
        console.log(`  FEIL: ${error.message}`);
      } else {
        console.log('  Oppdatert i database!');
        successCount++;
      }
    } else {
      console.log('  IKKE FUNNET');
    }
    console.log();

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('='.repeat(60));
  console.log(`Ferdig! Geokodet ${successCount} av ${customers.length} kunder`);
  console.log('='.repeat(60));
}

main().catch(console.error);

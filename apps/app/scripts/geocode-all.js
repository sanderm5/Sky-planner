/**
 * Batch geocode all customers without coordinates
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Delay function to respect rate limits
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Geocode using Kartverket first, then fallback to Nominatim
async function geocodeAddress(adresse, postnummer, poststed) {
  const fullAddress = `${adresse}, ${postnummer} ${poststed}, Norway`;

  // Try Kartverket first
  try {
    const kartverketUrl = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(fullAddress)}&fuzzy=true&treffPerSide=1`;
    const response = await fetch(kartverketUrl);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      const addr = data.adresser[0];
      if (addr.representasjonspunkt) {
        return {
          lat: addr.representasjonspunkt.lat,
          lng: addr.representasjonspunkt.lon,
          source: 'kartverket'
        };
      }
    }
  } catch (error) {
    console.log(`  Kartverket failed: ${error.message}`);
  }

  // Try simpler address for Kartverket
  try {
    const simpleAddress = `${postnummer} ${poststed}`;
    const kartverketUrl = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(simpleAddress)}&fuzzy=true&treffPerSide=1`;
    const response = await fetch(kartverketUrl);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      const addr = data.adresser[0];
      if (addr.representasjonspunkt) {
        return {
          lat: addr.representasjonspunkt.lat,
          lng: addr.representasjonspunkt.lon,
          source: 'kartverket-poststed'
        };
      }
    }
  } catch (error) {
    console.log(`  Kartverket poststed failed: ${error.message}`);
  }

  // Fallback to Nominatim
  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;
    const response = await fetch(nominatimUrl, {
      headers: { 'User-Agent': 'El-Kontroll-App/1.0' }
    });
    const data = await response.json();

    if (data && data.length > 0) {
      return {
        lat: Number.parseFloat(data[0].lat),
        lng: Number.parseFloat(data[0].lon),
        source: 'nominatim'
      };
    }
  } catch (error) {
    console.log(`  Nominatim failed: ${error.message}`);
  }

  // Try Nominatim with just poststed
  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(poststed + ', Norway')}&limit=1`;
    const response = await fetch(nominatimUrl, {
      headers: { 'User-Agent': 'El-Kontroll-App/1.0' }
    });
    const data = await response.json();

    if (data && data.length > 0) {
      return {
        lat: Number.parseFloat(data[0].lat),
        lng: Number.parseFloat(data[0].lon),
        source: 'nominatim-poststed'
      };
    }
  } catch (error) {
    console.log(`  Nominatim poststed failed: ${error.message}`);
  }

  return null;
}

async function main() {
  console.log('Henter kunder uten koordinater...\n');

  // Get customers without coordinates
  const { data: customers, error } = await supabase
    .from('kunder')
    .select('id, navn, adresse, postnummer, poststed')
    .or('lat.is.null,lng.is.null');

  if (error) {
    console.error('Feil ved henting av kunder:', error);
    return;
  }

  console.log(`Fant ${customers.length} kunder uten koordinater\n`);

  let success = 0;
  let failed = 0;

  for (const customer of customers) {
    console.log(`Geokoder: ${customer.navn} - ${customer.adresse}, ${customer.postnummer} ${customer.poststed}`);

    const result = await geocodeAddress(customer.adresse, customer.postnummer, customer.poststed);

    if (result) {
      // Update customer with coordinates
      const { error: updateError } = await supabase
        .from('kunder')
        .update({ lat: result.lat, lng: result.lng })
        .eq('id', customer.id);

      if (updateError) {
        console.log(`  ✗ Feil ved oppdatering: ${updateError.message}`);
        failed++;
      } else {
        console.log(`  ✓ Oppdatert: ${result.lat}, ${result.lng} (${result.source})`);
        success++;
      }
    } else {
      console.log(`  ✗ Kunne ikke finne koordinater`);
      failed++;
    }

    // Delay to respect rate limits
    await delay(500);
  }

  console.log(`\n=============================`);
  console.log(`Fullført!`);
  console.log(`Vellykket: ${success}`);
  console.log(`Feilet: ${failed}`);
  console.log(`=============================`);
}

main();

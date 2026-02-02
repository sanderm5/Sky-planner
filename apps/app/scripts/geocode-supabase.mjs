/**
 * Geocode all customers without coordinates using Kartverket API
 * Works with Supabase database
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Geocode using Kartverket API
async function geocodeAddress(adresse, postnummer, poststed) {
  if (!adresse && !poststed) return null;

  // Try Kartverket first
  try {
    const searchText = [adresse, postnummer, poststed].filter(Boolean).join(' ');
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(searchText)}&treffPerSide=1`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      const result = data.adresser[0];
      if (result.representasjonspunkt) {
        return {
          lat: result.representasjonspunkt.lat,
          lng: result.representasjonspunkt.lon,
          source: 'kartverket',
          quality: 'exact'
        };
      }
    }
  } catch (error) {
    console.log(`  Kartverket failed: ${error.message}`);
  }

  // Try with just poststed
  if (poststed) {
    try {
      const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(poststed)}&treffPerSide=1`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.adresser && data.adresser.length > 0) {
        const result = data.adresser[0];
        if (result.representasjonspunkt) {
          return {
            lat: result.representasjonspunkt.lat,
            lng: result.representasjonspunkt.lon,
            source: 'kartverket-poststed',
            quality: 'area'
          };
        }
      }
    } catch (error) {
      console.log(`  Kartverket poststed failed: ${error.message}`);
    }
  }

  // Fallback to Nominatim
  try {
    const fullAddress = [adresse, postnummer, poststed, 'Norway'].filter(Boolean).join(', ');
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'SkyPlanner/1.0' }
    });
    const data = await response.json();

    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        source: 'nominatim',
        quality: 'street'
      };
    }
  } catch (error) {
    console.log(`  Nominatim failed: ${error.message}`);
  }

  return null;
}

async function geocodeAllCustomers() {
  console.log('=== GEOCODING KUNDER UTEN KOORDINATER ===\n');

  // Get all customers without coordinates
  const { data: kunder, error } = await supabase
    .from('kunder')
    .select('id, navn, adresse, postnummer, poststed, lat, lng')
    .or('lat.is.null,lng.is.null')
    .order('id');

  if (error) {
    console.error('Error fetching customers:', error);
    process.exit(1);
  }

  console.log(`Fant ${kunder.length} kunder uten koordinater\n`);

  if (kunder.length === 0) {
    console.log('Alle kunder har koordinater!');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const kunde of kunder) {
    console.log(`[${kunde.id}] ${kunde.navn}`);
    console.log(`    ${kunde.adresse}, ${kunde.postnummer} ${kunde.poststed}`);

    const result = await geocodeAddress(kunde.adresse, kunde.postnummer, kunde.poststed);

    if (result) {
      const { error: updateError } = await supabase
        .from('kunder')
        .update({ lat: result.lat, lng: result.lng })
        .eq('id', kunde.id);

      if (updateError) {
        console.log(`    FEIL: ${updateError.message}`);
        failed++;
      } else {
        console.log(`    OK: (${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}) [${result.source}]`);
        success++;
      }
    } else {
      console.log(`    FEIL: Kunne ikke finne koordinater`);
      failed++;
    }

    // Rate limiting - wait 200ms between requests
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\n=== RESULTAT ===');
  console.log(`Vellykket: ${success}`);
  console.log(`Feilet: ${failed}`);
  console.log(`Totalt: ${kunder.length}`);
}

geocodeAllCustomers().catch(console.error);

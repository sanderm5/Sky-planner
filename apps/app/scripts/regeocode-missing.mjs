#!/usr/bin/env node
/**
 * Re-geocode customers without coordinates
 * Uses multiple strategies to find addresses
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const ORGANIZATION_ID = 5;

/**
 * Clean address for better geocoding
 */
function cleanAddress(adresse) {
  if (!adresse) return null;

  // Remove common problematic patterns
  return adresse
    .replace(/\s*\/\s*.+$/, '')  // Remove "/ alternative address"
    .replace(/\s*-\s*E6\s*/gi, ' ')  // Remove E6 references
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Try geocoding with Kartverket API
 */
async function geocodeKartverket(searchText) {
  try {
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(searchText)}&treffPerSide=1`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      const result = data.adresser[0];
      if (result.representasjonspunkt) {
        return {
          lat: result.representasjonspunkt.lat,
          lng: result.representasjonspunkt.lon,
          source: 'kartverket'
        };
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Try geocoding with Nominatim (OpenStreetMap)
 */
async function geocodeNominatim(searchText) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchText + ', Norway')}&format=json&limit=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SkyPlanner/1.0' }
    });
    const data = await response.json();

    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        source: 'nominatim'
      };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Try multiple geocoding strategies
 */
async function geocodeAddress(kunde) {
  const { adresse, postnummer, poststed } = kunde;

  // Strategy 1: Full address with Kartverket
  const fullAddress = [adresse, postnummer, poststed].filter(Boolean).join(' ');
  let result = await geocodeKartverket(fullAddress);
  if (result) return result;

  // Strategy 2: Cleaned address with Kartverket
  const cleanedAddress = cleanAddress(adresse);
  if (cleanedAddress !== adresse) {
    const cleanedFull = [cleanedAddress, postnummer, poststed].filter(Boolean).join(' ');
    result = await geocodeKartverket(cleanedFull);
    if (result) return result;
  }

  // Strategy 3: Just poststed with Kartverket (fallback to city center)
  if (poststed) {
    result = await geocodeKartverket(`${poststed} ${postnummer || ''}`);
    if (result) return { ...result, source: 'kartverket-poststed' };
  }

  // Strategy 4: Nominatim as last resort
  result = await geocodeNominatim(fullAddress);
  if (result) return result;

  // Strategy 5: Nominatim with just city
  if (poststed) {
    result = await geocodeNominatim(poststed);
    if (result) return { ...result, source: 'nominatim-poststed' };
  }

  return null;
}

async function main() {
  console.log('='.repeat(60));
  console.log('RE-GEOCODING KUNDER UTEN KOORDINATER');
  console.log('='.repeat(60));

  // Get customers without coordinates
  const { data: customers, error } = await supabase
    .from('kunder')
    .select('id, navn, adresse, postnummer, poststed')
    .eq('organization_id', ORGANIZATION_ID)
    .or('lat.is.null,lng.is.null');

  if (error) {
    console.error('Feil ved henting:', error.message);
    process.exit(1);
  }

  console.log(`\nFant ${customers.length} kunder uten koordinater\n`);

  let updated = 0;
  let failed = 0;

  for (const kunde of customers) {
    process.stdout.write(`${kunde.navn}... `);

    const coords = await geocodeAddress(kunde);

    if (coords) {
      const { error: updateError } = await supabase
        .from('kunder')
        .update({ lat: coords.lat, lng: coords.lng })
        .eq('id', kunde.id);

      if (updateError) {
        console.log(`FEIL: ${updateError.message}`);
        failed++;
      } else {
        console.log(`OK (${coords.source})`);
        updated++;
      }
    } else {
      console.log('IKKE FUNNET');
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n' + '='.repeat(60));
  console.log('FERDIG');
  console.log(`Oppdatert: ${updated}`);
  console.log(`Ikke funnet: ${failed}`);
  console.log('='.repeat(60));
}

main().catch(console.error);

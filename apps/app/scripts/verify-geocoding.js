#!/usr/bin/env node
/**
 * Verifiser og test geokoding mot Kartverket API
 * Sammenligner lagrede koordinater med faktiske koordinater fra API
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const KARTVERKET_API = 'https://ws.geonorge.no/adresser/v1/sok';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeWithKartverket(adresse, postnummer, poststed) {
  const searchQueries = [
    `${adresse}, ${postnummer} ${poststed}`,
    `${adresse} ${postnummer}`,
    `${postnummer} ${poststed}`
  ];

  for (const query of searchQueries) {
    try {
      const url = `${KARTVERKET_API}?sok=${encodeURIComponent(query)}&fuzzy=true&treffPerSide=1`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.adresser && data.adresser.length > 0) {
        const addr = data.adresser[0];
        return {
          lat: addr.representasjonspunkt.lat,
          lng: addr.representasjonspunkt.lon,
          matchedAddress: addr.adressetekst,
          postnummer: addr.postnummer,
          poststed: addr.poststed,
          confidence: query.includes(adresse) ? 'exact' : 'area'
        };
      }
    } catch (error) {
      console.log(`  Feil ved søk "${query}":`, error.message);
    }
  }
  return null;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  // Haversine formula
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function verifyGeocoding() {
  console.log('=== VERIFISERING AV GEOKODING ===\n');

  const { data: kunder, error } = await supabase
    .from('kunder')
    .select('*')
    .order('navn')
    .limit(10); // Test med de første 10

  if (error) {
    console.log('FEIL:', error.message);
    return;
  }

  console.log(`Tester ${kunder.length} kunder...\n`);

  const results = {
    correct: [],
    wrong: [],
    notFound: []
  };

  for (const kunde of kunder) {
    console.log(`\n--- ${kunde.navn} ---`);
    console.log(`  Adresse: ${kunde.adresse}, ${kunde.postnummer} ${kunde.poststed}`);
    console.log(`  Lagret:  (${kunde.lat}, ${kunde.lng})`);

    const geocoded = await geocodeWithKartverket(
      kunde.adresse,
      kunde.postnummer,
      kunde.poststed
    );

    if (geocoded) {
      const distance = calculateDistance(
        kunde.lat, kunde.lng,
        geocoded.lat, geocoded.lng
      );

      console.log(`  API:     (${geocoded.lat.toFixed(4)}, ${geocoded.lng.toFixed(4)})`);
      console.log(`  Match:   ${geocoded.matchedAddress}`);
      console.log(`  Avstand: ${distance.toFixed(2)} km`);

      if (distance < 0.5) {
        console.log(`  Status:  ✓ KORREKT`);
        results.correct.push(kunde);
      } else {
        console.log(`  Status:  ✗ FEIL PLASSERING (${distance.toFixed(1)} km avvik)`);
        results.wrong.push({ kunde, geocoded, distance });
      }
    } else {
      console.log(`  API:     IKKE FUNNET`);
      console.log(`  Status:  ? KUNNE IKKE VERIFISERE`);
      results.notFound.push(kunde);
    }

    await sleep(300); // Rate limiting
  }

  console.log('\n=== OPPSUMMERING ===');
  console.log(`Korrekt plassert:    ${results.correct.length}`);
  console.log(`Feil plassering:     ${results.wrong.length}`);
  console.log(`Kunne ikke verifisere: ${results.notFound.length}`);

  if (results.wrong.length > 0) {
    console.log('\n--- KUNDER MED FEIL PLASSERING ---');
    results.wrong.forEach(r => {
      console.log(`  ${r.kunde.navn}: ${r.distance.toFixed(1)} km avvik`);
      console.log(`    Lagret: (${r.kunde.lat}, ${r.kunde.lng})`);
      console.log(`    Riktig: (${r.geocoded.lat.toFixed(4)}, ${r.geocoded.lng.toFixed(4)})`);
    });
  }
}

verifyGeocoding().catch(console.error);

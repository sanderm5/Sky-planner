#!/usr/bin/env node
/**
 * Geocode all customers using Kartverket's official address API
 * This provides the most accurate coordinates for Norwegian addresses
 *
 * API Documentation: https://ws.geonorge.no/adresser/v1/
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'kunder.db'));

// Kartverket API endpoint
const KARTVERKET_API = 'https://ws.geonorge.no/adresser/v1/sok';

// Delay between requests to be nice to the API
const DELAY_MS = 200;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeAddress(adresse, poststed, postnr) {
  try {
    // Build search query
    let searchQuery = adresse;
    if (postnr) {
      searchQuery += ` ${postnr}`;
    } else if (poststed) {
      searchQuery += ` ${poststed}`;
    }

    const url = new URL(KARTVERKET_API);
    url.searchParams.set('sok', searchQuery);
    url.searchParams.set('fuzzy', 'true');
    url.searchParams.set('treffPerSide', '1');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      const result = data.adresser[0];
      const punkt = result.representasjonspunkt;

      return {
        lat: punkt.lat,
        lng: punkt.lon,
        matchedAddress: result.adressetekst,
        postnummer: result.postnummer,
        poststed: result.poststed,
        confidence: 'exact'
      };
    }

    // Try with just street name without number
    const streetOnly = adresse.replace(/\s+\d+.*$/, '').trim();
    if (streetOnly !== adresse) {
      url.searchParams.set('sok', `${streetOnly} ${postnr || poststed}`);
      const response2 = await fetch(url.toString());
      const data2 = await response2.json();

      if (data2.adresser && data2.adresser.length > 0) {
        const result = data2.adresser[0];
        const punkt = result.representasjonspunkt;

        return {
          lat: punkt.lat,
          lng: punkt.lon,
          matchedAddress: result.adressetekst,
          postnummer: result.postnummer,
          poststed: result.poststed,
          confidence: 'street'
        };
      }
    }

    // Try with just poststed/postnummer for area coordinates
    url.searchParams.set('sok', postnr || poststed);
    const response3 = await fetch(url.toString());
    const data3 = await response3.json();

    if (data3.adresser && data3.adresser.length > 0) {
      const result = data3.adresser[0];
      const punkt = result.representasjonspunkt;

      return {
        lat: punkt.lat,
        lng: punkt.lon,
        matchedAddress: result.adressetekst,
        postnummer: result.postnummer,
        poststed: result.poststed,
        confidence: 'area'
      };
    }

    return null;
  } catch (error) {
    console.error(`  Feil: ${error.message}`);
    return null;
  }
}

async function geocodeAllCustomers() {
  console.log('=== Geocoding med Kartverket API ===\n');
  console.log('API: https://ws.geonorge.no/adresser/v1/');
  console.log('Dette gir nøyaktige offisielle koordinater fra Matrikkelen.\n');

  // Get all customers
  const kunder = db.prepare(`
    SELECT id, navn, adresse, poststed, postnummer, lat, lng
    FROM kunder
    ORDER BY navn
  `).all();

  console.log(`Totalt ${kunder.length} kunder å geocode\n`);

  const updateStmt = db.prepare(`
    UPDATE kunder
    SET lat = ?, lng = ?, geocode_quality = ?
    WHERE id = ?
  `);

  let success = 0;
  let exactMatch = 0;
  let streetMatch = 0;
  let areaMatch = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < kunder.length; i++) {
    const kunde = kunder[i];
    const progress = `[${i + 1}/${kunder.length}]`;

    process.stdout.write(`${progress} ${kunde.navn}...`);

    if (!kunde.adresse) {
      console.log(' HOPPET OVER (ingen adresse)');
      failures.push({ navn: kunde.navn, reason: 'Ingen adresse' });
      failed++;
      continue;
    }

    const result = await geocodeAddress(kunde.adresse, kunde.poststed, kunde.postnummer);

    if (result) {
      updateStmt.run(result.lat, result.lng, result.confidence, kunde.id);
      success++;

      if (result.confidence === 'exact') {
        exactMatch++;
        console.log(` ✓ EKSAKT (${result.lat.toFixed(6)}, ${result.lng.toFixed(6)})`);
      } else if (result.confidence === 'street') {
        streetMatch++;
        console.log(` ~ GATE (${result.matchedAddress})`);
      } else {
        areaMatch++;
        console.log(` ○ OMRÅDE (${result.poststed})`);
      }
    } else {
      console.log(' ✗ IKKE FUNNET');
      failures.push({ navn: kunde.navn, adresse: kunde.adresse, poststed: kunde.poststed });
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log('\n=== Resultat ===');
  console.log(`Vellykket: ${success}/${kunder.length}`);
  console.log(`  - Eksakt match: ${exactMatch}`);
  console.log(`  - Gate-nivå: ${streetMatch}`);
  console.log(`  - Område-nivå: ${areaMatch}`);
  console.log(`Mislykket: ${failed}`);

  if (failures.length > 0) {
    console.log('\nKunder som ikke ble geocodet:');
    failures.forEach(f => {
      console.log(`  - ${f.navn}: ${f.adresse || 'Ingen adresse'}, ${f.poststed || ''}`);
    });
  }

  // Verify no more duplicates
  const dupes = db.prepare(`
    SELECT lat, lng, COUNT(*) as antall
    FROM kunder
    WHERE lat IS NOT NULL
    GROUP BY lat, lng
    HAVING COUNT(*) > 1
  `).all();

  if (dupes.length > 0) {
    console.log(`\n⚠️  Det er fortsatt ${dupes.length} grupper med duplikate koordinater.`);
    console.log('   Dette kan skyldes at flere kunder har samme adresse.');
  } else {
    console.log('\n✓ Ingen duplikate koordinater - alle kunder har unike plasseringer!');
  }

  db.close();
}

geocodeAllCustomers().catch(console.error);

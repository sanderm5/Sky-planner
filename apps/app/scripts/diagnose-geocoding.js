#!/usr/bin/env node
/**
 * Diagnostikk-script for geokoding
 * Identifiserer kunder med dårlig eller manglende geokoding
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'kunder.db'));

function diagnoseGeocoding() {
  console.log('=== GEOKODING DIAGNOSTIKK ===\n');

  // Totalt antall kunder
  const total = db.prepare('SELECT COUNT(*) as count FROM kunder').get().count;
  console.log(`Totalt antall kunder: ${total}\n`);

  // 1. Kunder uten koordinater
  const noCoords = db.prepare(`
    SELECT id, navn, adresse, postnummer, poststed
    FROM kunder
    WHERE lat IS NULL OR lng IS NULL
    ORDER BY navn
  `).all();

  console.log(`\n=== MANGLER KOORDINATER: ${noCoords.length} ===`);
  if (noCoords.length > 0) {
    noCoords.forEach(k => {
      console.log(`  - ${k.navn}: ${k.adresse}, ${k.postnummer} ${k.poststed}`);
    });
  } else {
    console.log('  Ingen kunder mangler koordinater');
  }

  // 2. Kunder med geocode_quality = 'area' (hvis kolonnen finnes)
  let areaLevel = [];
  try {
    areaLevel = db.prepare(`
      SELECT id, navn, adresse, postnummer, poststed, lat, lng
      FROM kunder
      WHERE geocode_quality = 'area'
      ORDER BY poststed, navn
    `).all();

    console.log(`\n=== OMRÅDE-NIVÅ GEOKODING: ${areaLevel.length} ===`);
    if (areaLevel.length > 0) {
      areaLevel.forEach(k => {
        console.log(`  - ${k.navn}: ${k.adresse}, ${k.postnummer} ${k.poststed}`);
      });
    } else {
      console.log('  Ingen kunder har område-nivå geokoding');
    }
  } catch (e) {
    console.log('\n=== OMRÅDE-NIVÅ GEOKODING ===');
    console.log('  Kolonnen geocode_quality finnes ikke ennå');
  }

  // 3. Finn klustere (flere kunder på samme koordinater)
  const clusters = db.prepare(`
    SELECT lat, lng, COUNT(*) as antall, GROUP_CONCAT(navn, ' | ') as kunder
    FROM kunder
    WHERE lat IS NOT NULL AND lng IS NOT NULL
    GROUP BY ROUND(lat, 4), ROUND(lng, 4)
    HAVING COUNT(*) > 1
    ORDER BY antall DESC
  `).all();

  console.log(`\n=== KLUSTERE (samme koordinater): ${clusters.length} grupper ===`);
  if (clusters.length > 0) {
    clusters.forEach((c, i) => {
      const kundeNavn = c.kunder.split(' | ').slice(0, 5);
      const flere = c.antall > 5 ? ` (+${c.antall - 5} flere)` : '';
      console.log(`\n  Gruppe ${i + 1} - ${c.antall} kunder på (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}):`);
      kundeNavn.forEach(n => console.log(`    - ${n}`));
      if (flere) console.log(`    ${flere}`);
    });
  } else {
    console.log('  Ingen klustere funnet - alle kunder har unike koordinater');
  }

  // 4. Adresser uten husnummer (mulige gårdsnavn)
  const noHouseNumber = db.prepare(`
    SELECT id, navn, adresse, postnummer, poststed
    FROM kunder
    WHERE adresse IS NOT NULL
      AND adresse != ''
      AND adresse NOT GLOB '*[0-9]*'
    ORDER BY poststed, navn
  `).all();

  console.log(`\n=== ADRESSER UTEN HUSNUMMER: ${noHouseNumber.length} ===`);
  console.log('  (Kan være gårdsnavn som trenger manuell plassering)');
  if (noHouseNumber.length > 0) {
    noHouseNumber.forEach(k => {
      console.log(`  - ${k.navn}: "${k.adresse}", ${k.postnummer} ${k.poststed}`);
    });
  }

  // 5. Mulige gårdsnavn (inneholder typiske ord)
  const farmKeywords = db.prepare(`
    SELECT id, navn, adresse, postnummer, poststed
    FROM kunder
    WHERE LOWER(adresse) LIKE '%gård%'
       OR LOWER(adresse) LIKE '%gard%'
       OR LOWER(adresse) LIKE '%farm%'
       OR LOWER(adresse) LIKE '%bruk%'
       OR LOWER(adresse) LIKE '%seter%'
       OR LOWER(adresse) LIKE '%støl%'
    ORDER BY poststed, navn
  `).all();

  console.log(`\n=== MULIGE GÅRDSNAVN I ADRESSE: ${farmKeywords.length} ===`);
  if (farmKeywords.length > 0) {
    farmKeywords.forEach(k => {
      console.log(`  - ${k.navn}: "${k.adresse}", ${k.postnummer} ${k.poststed}`);
    });
  }

  // 6. Koordinater utenfor Norge (feilaktige)
  const outsideNorway = db.prepare(`
    SELECT id, navn, adresse, postnummer, poststed, lat, lng
    FROM kunder
    WHERE lat IS NOT NULL AND lng IS NOT NULL
      AND (lat < 57.5 OR lat > 71.5 OR lng < 4.0 OR lng > 31.5)
  `).all();

  console.log(`\n=== KOORDINATER UTENFOR NORGE: ${outsideNorway.length} ===`);
  if (outsideNorway.length > 0) {
    outsideNorway.forEach(k => {
      console.log(`  - ${k.navn}: (${k.lat}, ${k.lng}) - ${k.adresse}`);
    });
  } else {
    console.log('  Alle koordinater er innenfor Norges grenser');
  }

  // Oppsummering
  console.log('\n=== OPPSUMMERING ===');
  console.log(`Totalt kunder:              ${total}`);
  console.log(`Mangler koordinater:        ${noCoords.length}`);
  console.log(`Område-nivå geokoding:      ${areaLevel.length}`);
  console.log(`I klustere (delt posisjon): ${clusters.reduce((sum, c) => sum + c.antall, 0)}`);
  console.log(`Uten husnummer i adresse:   ${noHouseNumber.length}`);
  console.log(`Mulige gårdsnavn:           ${farmKeywords.length}`);
  console.log(`Utenfor Norge:              ${outsideNorway.length}`);

  const problematicCount = noCoords.length + areaLevel.length +
    clusters.reduce((sum, c) => sum + c.antall, 0);
  console.log(`\nKunder som trolig trenger oppmerksomhet: ~${problematicCount}`);

  db.close();
}

diagnoseGeocoding();

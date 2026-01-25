#!/usr/bin/env node
/**
 * Oppdater testdata med ekte norske adresser fra Kartverket
 * Henter faktiske adresser og koordinater fra Matrikkelen
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

// Hent ekte adresser fra Kartverket for et gitt postnummer
async function getRealAddresses(postnummer, count = 5) {
  try {
    const url = `${KARTVERKET_API}?sok=${postnummer}&fuzzy=false&treffPerSide=${count * 2}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      // Filtrer kun adresser med husnummer og ta unike gater
      const seenStreets = new Set();
      return data.adresser
        .filter(a => {
          if (!a.adressetekst || seenStreets.has(a.adressetekst)) return false;
          seenStreets.add(a.adressetekst);
          return true;
        })
        .slice(0, count)
        .map(a => ({
          adresse: a.adressetekst.split(',')[0], // Bare gateadresse
          postnummer: a.postnummer,
          poststed: a.poststed,
          lat: a.representasjonspunkt.lat,
          lng: a.representasjonspunkt.lon
        }));
    }
  } catch (error) {
    console.log(`  Feil ved henting av adresser for ${postnummer}:`, error.message);
  }
  return [];
}

async function fixAllAddresses() {
  console.log('=== OPPDATERER TESTDATA MED EKTE ADRESSER ===\n');

  // Hent alle kunder
  const { data: kunder, error } = await supabase
    .from('kunder')
    .select('*')
    .order('id');

  if (error) {
    console.log('FEIL:', error.message);
    return;
  }

  console.log(`Totalt ${kunder.length} kunder å oppdatere\n`);

  // Grupper kunder etter postnummer
  const kundePerPostnummer = {};
  kunder.forEach(k => {
    if (!kundePerPostnummer[k.postnummer]) {
      kundePerPostnummer[k.postnummer] = [];
    }
    kundePerPostnummer[k.postnummer].push(k);
  });

  console.log('Postnumre i bruk:', Object.keys(kundePerPostnummer).join(', '));
  console.log('');

  let oppdatert = 0;
  let feilet = 0;

  // For hvert postnummer, hent ekte adresser og oppdater kundene
  for (const [postnummer, kundeGruppe] of Object.entries(kundePerPostnummer)) {
    console.log(`\n--- Postnummer ${postnummer} (${kundeGruppe.length} kunder) ---`);

    // Hent nok ekte adresser for denne gruppen
    const ekteAdresser = await getRealAddresses(postnummer, kundeGruppe.length + 5);

    if (ekteAdresser.length === 0) {
      console.log(`  ✗ Fant ingen ekte adresser for ${postnummer}`);
      feilet += kundeGruppe.length;
      continue;
    }

    console.log(`  Fant ${ekteAdresser.length} ekte adresser`);

    // Oppdater hver kunde med en ekte adresse
    for (let i = 0; i < kundeGruppe.length; i++) {
      const kunde = kundeGruppe[i];
      const ekteAdresse = ekteAdresser[i % ekteAdresser.length];

      console.log(`  ${kunde.navn}: ${ekteAdresse.adresse}`);

      const { error: updateError } = await supabase
        .from('kunder')
        .update({
          adresse: ekteAdresse.adresse,
          postnummer: ekteAdresse.postnummer,
          poststed: ekteAdresse.poststed,
          lat: ekteAdresse.lat,
          lng: ekteAdresse.lng
        })
        .eq('id', kunde.id);

      if (updateError) {
        console.log(`    ✗ Feil: ${updateError.message}`);
        feilet++;
      } else {
        oppdatert++;
      }
    }

    await sleep(300); // Rate limiting
  }

  console.log('\n=== RESULTAT ===');
  console.log(`Oppdatert: ${oppdatert}`);
  console.log(`Feilet: ${feilet}`);
}

fixAllAddresses().catch(console.error);

#!/usr/bin/env node
/**
 * Monitor logins in real-time
 * Polls Supabase for recent logins and displays in terminal
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

let lastCheck = new Date();
const CHECK_INTERVAL = 5000; // 5 seconds

console.log('\n🔐 Overvåker innlogginger på TREkontroll');
console.log('=' .repeat(50));
console.log('Trykk Ctrl+C for å avslutte\n');

async function checkLogins() {
  try {
    // Check klient logins
    const { data: klienter } = await supabase
      .from('klient')
      .select('navn, epost, sist_innlogget')
      .gt('sist_innlogget', lastCheck.toISOString())
      .order('sist_innlogget', { ascending: false });

    if (klienter && klienter.length > 0) {
      klienter.forEach(k => {
        const time = new Date(k.sist_innlogget).toLocaleString('nb-NO', {
          timeZone: 'Europe/Oslo'
        });
        console.log(`\n🟢 NY INNLOGGING (klient)`);
        console.log(`   Navn: ${k.navn}`);
        console.log(`   E-post: ${k.epost}`);
        console.log(`   Tid: ${time}`);
        console.log('-'.repeat(50));
      });
    }

    // Check bruker (admin) logins
    const { data: brukere } = await supabase
      .from('brukere')
      .select('navn, epost, sist_innlogget')
      .gt('sist_innlogget', lastCheck.toISOString())
      .order('sist_innlogget', { ascending: false });

    if (brukere && brukere.length > 0) {
      brukere.forEach(b => {
        const time = new Date(b.sist_innlogget).toLocaleString('nb-NO', {
          timeZone: 'Europe/Oslo'
        });
        console.log(`\n🔵 NY INNLOGGING (admin)`);
        console.log(`   Navn: ${b.navn}`);
        console.log(`   E-post: ${b.epost}`);
        console.log(`   Tid: ${time}`);
        console.log('-'.repeat(50));
      });
    }

    lastCheck = new Date();
  } catch (error) {
    // Silently ignore errors (table might not exist)
  }
}

// Initial status
async function showStatus() {
  console.log('Siste innlogginger:');

  try {
    const { data: klienter } = await supabase
      .from('klient')
      .select('navn, epost, sist_innlogget')
      .not('sist_innlogget', 'is', null)
      .order('sist_innlogget', { ascending: false })
      .limit(5);

    if (klienter && klienter.length > 0) {
      klienter.forEach(k => {
        const time = k.sist_innlogget
          ? new Date(k.sist_innlogget).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })
          : 'Aldri';
        console.log(`  ${k.navn} (${k.epost}) - ${time}`);
      });
    }
  } catch (e) {
    console.log('  Kunne ikke hente klientdata');
  }

  console.log('\nVenter på nye innlogginger...\n');
}

// Run
showStatus().then(() => {
  setInterval(checkLogins, CHECK_INTERVAL);
});

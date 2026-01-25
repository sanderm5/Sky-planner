require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function createAdmin() {
  // Get credentials from environment variables (required)
  const navn = process.env.KLIENT_NAVN;
  const epost = process.env.KLIENT_EPOST;
  const passord = process.env.KLIENT_PASSORD;

  // Validate required environment variables
  if (!navn || !epost || !passord) {
    console.error('Feil: Alle miljøvariabler må være satt:');
    console.error('  KLIENT_NAVN - Brukerens navn');
    console.error('  KLIENT_EPOST - Brukerens e-postadresse');
    console.error('  KLIENT_PASSORD - Et sterkt passord (minst 8 tegn)');
    console.error('');
    console.error('Eksempel:');
    console.error('  KLIENT_NAVN="Admin" KLIENT_EPOST="admin@example.com" KLIENT_PASSORD="SecureP@ss123" node scripts/create-admin.js');
    process.exit(1);
  }

  // Validate password strength
  if (passord.length < 8) {
    console.error('Feil: Passordet må være minst 8 tegn');
    process.exit(1);
  }

  console.log('Oppretter admin-bruker...');
  console.log(`  Navn: ${navn}`);
  console.log(`  E-post: ${epost}`);
  console.log('  Passord: ********');

  // Hash password
  const passord_hash = await bcrypt.hash(passord, 10);

  // Check if user already exists
  const { data: existing } = await supabase
    .from('brukere')
    .select('id')
    .ilike('epost', epost)
    .single();

  if (existing) {
    // Update existing user
    const { error } = await supabase
      .from('brukere')
      .update({ passord_hash, navn, aktiv: true })
      .eq('id', existing.id);

    if (error) {
      console.error('Feil ved oppdatering:', error.message);
      return;
    }
    console.log('✓ Eksisterende bruker oppdatert');
  } else {
    // Create new user
    const { error } = await supabase
      .from('brukere')
      .insert({
        navn,
        epost,
        passord_hash,
        rolle: 'admin',
        aktiv: true
      });

    if (error) {
      console.error('Feil ved opprettelse:', error.message);
      // Try to create table if it doesn't exist
      if (error.message.includes('does not exist')) {
        console.log('\nbrukere-tabell finnes ikke. Lag den med følgende SQL i Supabase:');
        console.log(`
CREATE TABLE IF NOT EXISTS brukere (
  id SERIAL PRIMARY KEY,
  navn VARCHAR(100) NOT NULL,
  epost VARCHAR(100) UNIQUE NOT NULL,
  passord_hash TEXT NOT NULL,
  rolle VARCHAR(20) DEFAULT 'bruker',
  aktiv BOOLEAN DEFAULT true,
  sist_innlogget TIMESTAMPTZ,
  opprettet TIMESTAMPTZ DEFAULT NOW()
);
        `);
      }
      return;
    }
    console.log('✓ Ny admin-bruker opprettet');
  }

  // Also try to add to klient table
  const { data: existingKlient } = await supabase
    .from('klient')
    .select('id')
    .ilike('epost', epost)
    .single();

  if (!existingKlient) {
    const { error: klientError } = await supabase
      .from('klient')
      .insert({
        navn,
        epost,
        passord_hash,
        rolle: 'admin',
        aktiv: true
      });

    if (!klientError) {
      console.log('✓ Bruker også lagt til i klient-tabell');
    }
  } else {
    // Update klient
    const { error } = await supabase
      .from('klient')
      .update({ passord_hash, navn, aktiv: true })
      .eq('id', existingKlient.id);

    if (!error) {
      console.log('✓ Eksisterende klient oppdatert');
    }
  }

  console.log('\nDu kan nå logge inn med:');
  console.log(`  E-post: ${epost}`);
  console.log(`  Passord: ${passord}`);
}

createAdmin().catch(console.error);

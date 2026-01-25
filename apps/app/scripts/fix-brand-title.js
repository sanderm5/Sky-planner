/**
 * Script for å fikse brand_title i organizations
 * Setter brand_title til organisasjonens navn (navn) i stedet for bransjenavn
 *
 * Bruk: node scripts/fix-brand-title.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Mangler SUPABASE_URL eller SUPABASE_ANON_KEY i .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixBrandTitle() {
  console.log('\n========================================');
  console.log('  Fiks brand_title i organizations');
  console.log('========================================\n');

  // Hent alle organisasjoner
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, navn, brand_title');

  if (error) {
    console.error('❌ Kunne ikke hente organisasjoner:', error.message);
    process.exit(1);
  }

  console.log(`Fant ${orgs.length} organisasjon(er)\n`);

  for (const org of orgs) {
    console.log(`📋 ${org.navn}`);
    console.log(`   Nåværende brand_title: "${org.brand_title || '(tom)'}"`);

    // Sjekk om brand_title er forskjellig fra navn
    if (org.brand_title !== org.navn) {
      const { error: updateError } = await supabase
        .from('organizations')
        .update({ brand_title: org.navn })
        .eq('id', org.id);

      if (updateError) {
        console.log(`   ❌ Feil ved oppdatering: ${updateError.message}`);
      } else {
        console.log(`   ✅ Oppdatert brand_title til: "${org.navn}"`);
      }
    } else {
      console.log(`   ⏭️  Allerede korrekt`);
    }
    console.log('');
  }

  console.log('✅ Ferdig!');
}

fixBrandTitle().catch(console.error);

/**
 * Seed Dummy Data for SaaS Prototype
 * Creates test organizations and customers for development
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Dummy data for Norwegian locations
const norskeFornavn = ['Ole', 'Kari', 'Per', 'Anne', 'Lars', 'Ingrid', 'Erik', 'Hilde', 'Magnus', 'Silje'];
const norskeEtternavn = ['Hansen', 'Johansen', 'Olsen', 'Larsen', 'Andersen', 'Pedersen', 'Nilsen', 'Berg', 'Haugen', 'Moen'];
const gateNavn = ['Storgata', 'Kirkegata', 'Hovedveien', 'Industriveien', 'Fjordveien', 'Skogveien', 'Havnegata', 'Bakkeveien'];
const brannSystemer = ['Elotec', 'ICAS', 'Elotec + ICAS', null];
const elTyper = ['Landbruk', 'Næring', 'Bolig', 'Gartneri'];
const driftsTyper = ['Storfe', 'Sau', 'Geit', 'Gris', 'Fjørfe', null];
const kategorier = ['El-Kontroll', 'Brannvarsling', 'El-Kontroll + Brannvarsling'];

// Norwegian cities with coordinates
const steder = [
  { poststed: 'Oslo', postnummer: '0150', lat: 59.9139, lng: 10.7522 },
  { poststed: 'Bergen', postnummer: '5003', lat: 60.3913, lng: 5.3221 },
  { poststed: 'Trondheim', postnummer: '7010', lat: 63.4305, lng: 10.3951 },
  { poststed: 'Stavanger', postnummer: '4006', lat: 58.9700, lng: 5.7331 },
  { poststed: 'Tromsø', postnummer: '9008', lat: 69.6496, lng: 18.9560 },
  { poststed: 'Bodø', postnummer: '8006', lat: 67.2804, lng: 14.4049 },
  { poststed: 'Ålesund', postnummer: '6002', lat: 62.4722, lng: 6.1495 },
  { poststed: 'Kristiansand', postnummer: '4611', lat: 58.1599, lng: 8.0182 },
  { poststed: 'Drammen', postnummer: '3015', lat: 59.7441, lng: 10.2045 },
  { poststed: 'Fredrikstad', postnummer: '1606', lat: 59.2181, lng: 10.9298 },
  { poststed: 'Andenes', postnummer: '8480', lat: 69.0688, lng: 17.6527 },
  { poststed: 'Sortland', postnummer: '8400', lat: 68.6934, lng: 15.4135 },
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(yearsBack, yearsForward = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear() - yearsBack, 0, 1);
  const end = new Date(now.getFullYear() + yearsForward, 11, 31);
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
    .toISOString().split('T')[0];
}

function generateCustomer(orgId, index) {
  const sted = randomItem(steder);
  const kategori = randomItem(kategorier);
  const isEl = kategori.includes('El-Kontroll');
  const isBrann = kategori.includes('Brannvarsling');

  // Add some randomness to coordinates
  const latOffset = (Math.random() - 0.5) * 0.1;
  const lngOffset = (Math.random() - 0.5) * 0.1;

  const fornavn = randomItem(norskeFornavn);
  const etternavn = randomItem(norskeEtternavn);

  return {
    organization_id: orgId,
    navn: `${fornavn} ${etternavn}`,
    adresse: `${randomItem(gateNavn)} ${Math.floor(Math.random() * 200) + 1}`,
    postnummer: sted.postnummer,
    poststed: sted.poststed,
    telefon: `4${Math.floor(Math.random() * 90000000 + 10000000)}`,
    epost: `${fornavn.toLowerCase()}.${etternavn.toLowerCase()}@example.com`,
    lat: sted.lat + latOffset,
    lng: sted.lng + lngOffset,
    kategori: kategori,
    el_type: isEl ? randomItem(elTyper) : null,
    brann_system: isBrann ? randomItem(brannSystemer) : null,
    brann_driftstype: isBrann ? randomItem(driftsTyper) : null,
    siste_el_kontroll: isEl ? randomDate(3) : null,
    neste_el_kontroll: isEl ? randomDate(0, 2) : null,
    el_kontroll_intervall: isEl ? randomItem([12, 24, 36, 60]) : 36,
    siste_brann_kontroll: isBrann ? randomDate(2) : null,
    neste_brann_kontroll: isBrann ? randomDate(0, 1) : null,
    brann_kontroll_intervall: 12,
    notater: Math.random() > 0.7 ? 'Test-kunde for SaaS prototype' : null,
  };
}

async function seedData() {
  console.log('🌱 Seeding dummy data for SaaS prototype...\n');

  // Check if organization exists
  const { data: existingOrg } = await supabase
    .from('organizations')
    .select('id, navn')
    .eq('slug', 'tre-allservice')
    .single();

  let orgId;

  if (existingOrg) {
    console.log(`✅ Organization exists: ${existingOrg.navn} (id: ${existingOrg.id})`);
    orgId = existingOrg.id;
  } else {
    console.log('❌ Organization not found. Run complete-setup.sql first.');
    return;
  }

  // Check existing customers
  const { count: existingCount } = await supabase
    .from('kunder')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  if (existingCount > 0) {
    console.log(`\n⚠️  Organization already has ${existingCount} customers.`);
    console.log('Delete existing customers first if you want to re-seed.\n');

    // Ask if user wants to continue anyway
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
      rl.question('Add more customers anyway? (y/n): ', async (answer) => {
        rl.close();
        if (answer.toLowerCase() === 'y') {
          await createCustomers(orgId, 20);
        }
        resolve();
      });
    });
  }

  await createCustomers(orgId, 50);
}

async function createCustomers(orgId, count) {
  console.log(`\n📦 Creating ${count} dummy customers...\n`);

  const customers = [];
  for (let i = 0; i < count; i++) {
    customers.push(generateCustomer(orgId, i));
  }

  // Insert in batches
  const batchSize = 25;
  let successCount = 0;

  for (let i = 0; i < customers.length; i += batchSize) {
    const batch = customers.slice(i, i + batchSize);

    const { error } = await supabase
      .from('kunder')
      .insert(batch);

    if (error) {
      console.error(`❌ Batch ${Math.floor(i/batchSize) + 1} failed:`, error.message);
    } else {
      successCount += batch.length;
      console.log(`✅ Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} customers created`);
    }
  }

  // Summary
  const { count: totalCount } = await supabase
    .from('kunder')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  console.log('\n--- Seeding Complete ---');
  console.log(`✅ Created: ${successCount} customers`);
  console.log(`📊 Total in database: ${totalCount} customers`);

  // Show distribution
  const { data: kategorier } = await supabase
    .from('kunder')
    .select('kategori')
    .eq('organization_id', orgId);

  const distribution = {};
  kategorier?.forEach(k => {
    distribution[k.kategori] = (distribution[k.kategori] || 0) + 1;
  });

  console.log('\n📈 Category distribution:');
  Object.entries(distribution).forEach(([cat, count]) => {
    console.log(`   ${cat}: ${count}`);
  });
}

seedData().catch(console.error);

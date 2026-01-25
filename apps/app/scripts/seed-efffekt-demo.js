/**
 * Seed Demo Data for Efffekt Organization
 * Creates 100 demo customers for El-Kontroll + Brannvarsling in Trøndelag/Nord-Norge
 *
 * Run with: node scripts/seed-efffekt-demo.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Mangler SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Norske fornavn
const norskeFornavn = [
  'Ole', 'Kari', 'Per', 'Anne', 'Lars', 'Ingrid', 'Erik', 'Hilde', 'Magnus', 'Silje',
  'Bjørn', 'Marit', 'Tor', 'Astrid', 'Geir', 'Liv', 'Helge', 'Randi', 'Svein', 'Guri',
  'Arne', 'Berit', 'Jon', 'Solveig', 'Trond', 'Bente', 'Odd', 'Turid', 'Einar', 'Inger',
  'Olav', 'Kirsten', 'Petter', 'Mona', 'Harald', 'Gunhild', 'Nils', 'Ellen', 'Kristian', 'Rita'
];

// Norske etternavn
const norskeEtternavn = [
  'Hansen', 'Johansen', 'Olsen', 'Larsen', 'Andersen', 'Pedersen', 'Nilsen', 'Berg', 'Haugen', 'Moen',
  'Eriksen', 'Solberg', 'Bakken', 'Kristiansen', 'Hagen', 'Johannessen', 'Lund', 'Jakobsen', 'Strand', 'Vik',
  'Dahl', 'Henriksen', 'Lie', 'Iversen', 'Martinsen', 'Svendsen', 'Knutsen', 'Halvorsen', 'Antonsen', 'Aune'
];

// Gårdsnavn og adresser (typisk for landbruk)
const gardsnavn = [
  'Nordgård', 'Sørgård', 'Østgård', 'Vestgård', 'Øvre', 'Nedre', 'Myra', 'Bakkan', 'Haugen', 'Lian',
  'Lia', 'Trøa', 'Vollen', 'Kvam', 'Dalen', 'Åsen', 'Vikan', 'Næss', 'Myrene', 'Skogen',
  'Granly', 'Solbakken', 'Fjellheim', 'Sjøvold', 'Elvegård', 'Furuhaugen', 'Bjørkheim', 'Tangen', 'Brekka', 'Holmen'
];

const veityper = ['vegen', 'veien', 'grenda', 'tunet', ''];

// Brannvarslingssystemer
const brannSystemer = ['Elotec', 'ICAS', 'Elotec + ICAS', '2 x Elotec'];

// Driftstyper for landbruk
const driftsTyper = ['Storfe', 'Sau', 'Geit', 'Gris', 'Fjørfe', 'Korn', 'Grønnsaker', null];

// Kategorier
const kategorier = ['El-Kontroll', 'Brannvarsling', 'El-Kontroll + Brannvarsling'];

// Steder i Trøndelag og Nord-Norge med koordinater
const steder = [
  // Trøndelag
  { poststed: 'Trondheim', postnummer: '7010', lat: 63.4305, lng: 10.3951 },
  { poststed: 'Trondheim', postnummer: '7020', lat: 63.4200, lng: 10.4100 },
  { poststed: 'Trondheim', postnummer: '7030', lat: 63.4100, lng: 10.4500 },
  { poststed: 'Stjørdal', postnummer: '7500', lat: 63.4689, lng: 10.9165 },
  { poststed: 'Steinkjer', postnummer: '7700', lat: 64.0150, lng: 11.4950 },
  { poststed: 'Namsos', postnummer: '7800', lat: 64.4667, lng: 11.5000 },
  { poststed: 'Levanger', postnummer: '7600', lat: 63.7461, lng: 11.2995 },
  { poststed: 'Verdal', postnummer: '7650', lat: 63.7922, lng: 11.4842 },
  { poststed: 'Orkanger', postnummer: '7300', lat: 63.3000, lng: 9.8500 },
  { poststed: 'Melhus', postnummer: '7224', lat: 63.2833, lng: 10.2833 },
  { poststed: 'Malvik', postnummer: '7550', lat: 63.4200, lng: 10.6800 },
  { poststed: 'Røros', postnummer: '7374', lat: 62.5744, lng: 11.3847 },
  { poststed: 'Oppdal', postnummer: '7340', lat: 62.5930, lng: 9.6910 },
  { poststed: 'Grong', postnummer: '7870', lat: 64.4614, lng: 12.3089 },
  { poststed: 'Snåsa', postnummer: '7760', lat: 64.2500, lng: 12.3833 },
  { poststed: 'Inderøy', postnummer: '7670', lat: 63.8700, lng: 11.2800 },
  { poststed: 'Frosta', postnummer: '7633', lat: 63.5886, lng: 10.6983 },
  { poststed: 'Leksvik', postnummer: '7120', lat: 63.6700, lng: 10.6100 },
  { poststed: 'Rissa', postnummer: '7100', lat: 63.6033, lng: 9.9667 },
  { poststed: 'Åfjord', postnummer: '7170', lat: 63.9667, lng: 10.2000 },

  // Nordland
  { poststed: 'Bodø', postnummer: '8006', lat: 67.2804, lng: 14.4049 },
  { poststed: 'Mo i Rana', postnummer: '8600', lat: 66.3127, lng: 14.1427 },
  { poststed: 'Mosjøen', postnummer: '8650', lat: 65.8492, lng: 13.1933 },
  { poststed: 'Narvik', postnummer: '8500', lat: 68.4385, lng: 17.4273 },
  { poststed: 'Sandnessjøen', postnummer: '8800', lat: 66.0212, lng: 12.6352 },
  { poststed: 'Brønnøysund', postnummer: '8900', lat: 65.4750, lng: 12.2000 },
  { poststed: 'Svolvær', postnummer: '8300', lat: 68.2342, lng: 14.5689 },
  { poststed: 'Leknes', postnummer: '8370', lat: 68.1489, lng: 13.6097 },
  { poststed: 'Sortland', postnummer: '8400', lat: 68.6934, lng: 15.4135 },
  { poststed: 'Stokmarknes', postnummer: '8450', lat: 68.5667, lng: 14.9167 },
  { poststed: 'Andenes', postnummer: '8480', lat: 69.3147, lng: 16.1214 },
  { poststed: 'Fauske', postnummer: '8200', lat: 67.2583, lng: 15.3917 },

  // Troms
  { poststed: 'Tromsø', postnummer: '9008', lat: 69.6496, lng: 18.9560 },
  { poststed: 'Tromsø', postnummer: '9020', lat: 69.6700, lng: 18.9800 },
  { poststed: 'Harstad', postnummer: '9400', lat: 68.7983, lng: 16.5417 },
  { poststed: 'Finnsnes', postnummer: '9300', lat: 69.2333, lng: 17.9833 },
  { poststed: 'Bardufoss', postnummer: '9325', lat: 69.0833, lng: 18.5167 },
  { poststed: 'Sjøvegan', postnummer: '9350', lat: 68.8833, lng: 17.9000 },

  // Finnmark
  { poststed: 'Alta', postnummer: '9510', lat: 69.9689, lng: 23.2717 },
  { poststed: 'Hammerfest', postnummer: '9600', lat: 70.6634, lng: 23.6821 },
  { poststed: 'Kirkenes', postnummer: '9900', lat: 69.7271, lng: 30.0451 },
  { poststed: 'Vadsø', postnummer: '9800', lat: 70.0741, lng: 29.7500 },
  { poststed: 'Honningsvåg', postnummer: '9750', lat: 70.9827, lng: 25.9708 }
];

// Hjelpefunksjoner
function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(yearsBack, yearsForward = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear() - yearsBack, 0, 1);
  const end = new Date(now.getFullYear() + yearsForward, 11, 31);
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
    .toISOString().split('T')[0];
}

function generatePhoneNumber() {
  // Norske mobilnummer starter med 4 eller 9
  const prefix = Math.random() > 0.5 ? '4' : '9';
  return prefix + String(randomInt(10000000, 99999999));
}

function generateAddress() {
  const gard = randomItem(gardsnavn);
  const veitype = randomItem(veityper);
  const nummer = randomInt(1, 150);

  if (veitype === '') {
    return `${gard} ${nummer}`;
  }
  return `${gard}${veitype} ${nummer}`;
}

function generateCustomer(orgId) {
  const sted = randomItem(steder);
  const kategori = randomItem(kategorier);
  const isEl = kategori.includes('El-Kontroll');
  const isBrann = kategori.includes('Brannvarsling');

  // Tilfeldige koordinatforskyvninger innenfor +/- 0.15 grader (ca 10-15 km)
  const latOffset = (Math.random() - 0.5) * 0.3;
  const lngOffset = (Math.random() - 0.5) * 0.5;

  const fornavn = randomItem(norskeFornavn);
  const etternavn = randomItem(norskeEtternavn);

  // Bestem el_type med vekting (mer landbruk i nord)
  let elType = null;
  if (isEl) {
    const typeChance = Math.random();
    if (typeChance < 0.55) {
      elType = 'Landbruk';
    } else if (typeChance < 0.75) {
      elType = 'Næring';
    } else if (typeChance < 0.92) {
      elType = 'Bolig';
    } else {
      elType = 'Gartneri';
    }
  }

  // Bestem intervaller basert på type
  let elIntervall = 36;
  if (elType === 'Landbruk') elIntervall = 36;
  else if (elType === 'Næring') elIntervall = randomItem([12, 24]);
  else if (elType === 'Bolig') elIntervall = randomItem([48, 60]);
  else if (elType === 'Gartneri') elIntervall = 36;

  return {
    organization_id: orgId,
    navn: `${fornavn} ${etternavn}`,
    adresse: generateAddress(),
    postnummer: sted.postnummer,
    poststed: sted.poststed,
    telefon: generatePhoneNumber(),
    epost: `${fornavn.toLowerCase()}.${etternavn.toLowerCase()}@example.com`,
    lat: sted.lat + latOffset,
    lng: sted.lng + lngOffset,
    kategori: kategori,
    el_type: elType,
    brann_system: isBrann ? randomItem(brannSystemer) : null,
    brann_driftstype: (isBrann && elType === 'Landbruk') ? randomItem(driftsTyper) : null,
    siste_el_kontroll: isEl ? randomDate(4) : null,
    neste_el_kontroll: isEl ? randomDate(0, 3) : null,
    el_kontroll_intervall: elIntervall,
    siste_brann_kontroll: isBrann ? randomDate(2) : null,
    neste_brann_kontroll: isBrann ? randomDate(0, 1) : null,
    brann_kontroll_intervall: 12,
    notater: Math.random() > 0.8 ? randomItem([
      'Fast kunde siden 2018',
      'Har flere driftsbygninger',
      'Ønsker varsling på SMS',
      'Nytt anlegg installert 2023',
      'Tidligere avvik utbedret',
      'Kontakt gjerne på kveldstid',
      'Vanskelig adkomst om vinteren'
    ]) : null,
  };
}

// Parse command line arguments
const args = process.argv.slice(2);
const ORG_ID = args.find(a => a.startsWith('--org='))?.split('=')[1];
const FORCE = args.includes('--force');

async function getOrganization() {
  // Hent alle organisasjoner
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, navn, slug')
    .order('id');

  if (error || !orgs || orgs.length === 0) {
    console.error('❌ Ingen organisasjoner funnet i databasen');
    process.exit(1);
  }

  // Hvis --org er spesifisert, bruk den
  if (ORG_ID) {
    const org = orgs.find(o => o.id === parseInt(ORG_ID));
    if (org) {
      console.log(`✅ Bruker organisasjon: ${org.navn} (id: ${org.id})`);
      return org.id;
    } else {
      console.error(`❌ Fant ikke organisasjon med id ${ORG_ID}`);
      process.exit(1);
    }
  }

  // Ellers vis liste
  console.log('\n📋 Tilgjengelige organisasjoner:\n');
  orgs.forEach((org) => {
    console.log(`   --org=${org.id}  →  ${org.navn} (${org.slug})`);
  });
  console.log('\nBruk: node scripts/seed-efffekt-demo.js --org=1 --force');
  process.exit(0);
}

async function seedData() {
  console.log('\n========================================');
  console.log('  Demo Data Seeding');
  console.log('  100 kunder - El-Kontroll + Brannvarsling');
  console.log('  Trøndelag og Nord-Norge');
  console.log('========================================');

  const orgId = await getOrganization();

  // Sjekk eksisterende kunder
  const { count: existingCount } = await supabase
    .from('kunder')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  if (existingCount > 0) {
    console.log(`\n⚠️  Organisasjonen har allerede ${existingCount} kunder.`);

    if (FORCE) {
      console.log('🗑️  Sletter eksisterende kunder (--force)...');
      await supabase.from('kunder').delete().eq('organization_id', orgId);
    } else {
      console.log('Bruk --force for å slette eksisterende og legge inn nye.');
      process.exit(0);
    }
  }

  await createCustomers(orgId, 100);
}

async function createCustomers(orgId, count) {
  console.log(`\n📦 Oppretter ${count} demo-kunder...\n`);

  const customers = [];
  for (let i = 0; i < count; i++) {
    customers.push(generateCustomer(orgId));
  }

  // Sett inn i batches
  const batchSize = 25;
  let successCount = 0;

  for (let i = 0; i < customers.length; i += batchSize) {
    const batch = customers.slice(i, i + batchSize);

    const { error } = await supabase
      .from('kunder')
      .insert(batch);

    if (error) {
      console.error(`❌ Batch ${Math.floor(i/batchSize) + 1} feilet:`, error.message);
    } else {
      successCount += batch.length;
      console.log(`✅ Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} kunder opprettet`);
    }
  }

  // Oppsummering
  const { count: totalCount } = await supabase
    .from('kunder')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  console.log('\n========================================');
  console.log('  Seeding fullført!');
  console.log('========================================');
  console.log(`✅ Opprettet: ${successCount} kunder`);
  console.log(`📊 Totalt i databasen: ${totalCount} kunder`);

  // Vis fordeling
  const { data: kundeData } = await supabase
    .from('kunder')
    .select('kategori, el_type, poststed')
    .eq('organization_id', orgId);

  const kategoriDist = {};
  const elTypeDist = {};
  const stedDist = {};

  kundeData?.forEach(k => {
    kategoriDist[k.kategori] = (kategoriDist[k.kategori] || 0) + 1;
    if (k.el_type) elTypeDist[k.el_type] = (elTypeDist[k.el_type] || 0) + 1;
    stedDist[k.poststed] = (stedDist[k.poststed] || 0) + 1;
  });

  console.log('\n📈 Kategori-fordeling:');
  Object.entries(kategoriDist).forEach(([cat, count]) => {
    console.log(`   ${cat}: ${count}`);
  });

  console.log('\n🔌 El-type fordeling:');
  Object.entries(elTypeDist).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });

  console.log('\n📍 Topp 10 steder:');
  const topSteder = Object.entries(stedDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  topSteder.forEach(([sted, count]) => {
    console.log(`   ${sted}: ${count}`);
  });

}


seedData().catch(console.error);

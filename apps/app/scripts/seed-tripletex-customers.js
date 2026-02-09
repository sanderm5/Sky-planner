/**
 * Seed 100 test customers into Tripletex
 *
 * Usage:
 *   node scripts/seed-tripletex-customers.js <consumerToken> <employeeToken>
 *
 * Or with env vars:
 *   TRIPLETEX_CONSUMER_TOKEN=xxx TRIPLETEX_EMPLOYEE_TOKEN=yyy node scripts/seed-tripletex-customers.js
 */

// Test env: api-test.tripletex.tech, Prod: tripletex.no
const BASE_URL = process.env.TRIPLETEX_ENV === 'prod'
  ? 'https://tripletex.no/v2'
  : 'https://api-test.tripletex.tech/v2';

// --- Realistic Norwegian test data ---

const companyPrefixes = [
  'Nordisk', 'Vestland', 'Østfold', 'Bergen', 'Oslo', 'Trondheim', 'Stavanger',
  'Tromsø', 'Kristiansand', 'Bodø', 'Drammen', 'Fredrikstad', 'Sandnes',
  'Haugesund', 'Molde', 'Ålesund', 'Lillehammer', 'Halden', 'Moss', 'Larvik',
  'Tønsberg', 'Sandefjord', 'Porsgrunn', 'Skien', 'Arendal', 'Gjøvik',
  'Hamar', 'Kongsberg', 'Hønefoss', 'Elverum',
];

const companyTypes = [
  'Elektro AS', 'Service AS', 'Bygg AS', 'Eiendom AS', 'Renhold AS',
  'Teknikk AS', 'Installasjon AS', 'Sikkerhet AS', 'Vedlikehold AS',
  'Brann & Sikkerhet AS', 'VVS AS', 'Automasjon AS', 'Energi AS',
  'Miljø AS', 'Klima AS', 'Ventilasjon AS', 'Rør AS', 'Alarm AS',
  'Fasade AS', 'Maling AS', 'Gulv AS', 'Tak AS', 'Heis AS',
  'Kjøl AS', 'Tele AS', 'IT-Service AS', 'Kontorservice AS',
  'Vaktmester AS', 'Drift AS', 'Industri AS',
];

const streetNames = [
  'Storgata', 'Kirkegata', 'Kongens gate', 'Torggata', 'Bryggen',
  'Havnegata', 'Fjordveien', 'Industrivegen', 'Næringsveien', 'Sjøgata',
  'Parkveien', 'Vollveien', 'Fossveien', 'Elvegata', 'Skogveien',
  'Osloveien', 'Bergensvegen', 'Trondheimsvegen', 'Nordre gate', 'Søndre gate',
  'Østre gate', 'Vestre gate', 'Skolegata', 'Rådhusplassen', 'Jernbanegata',
  'Stasjonsveien', 'Fabrikkvegen', 'Verkstedgata', 'Lagerveien', 'Terminalveien',
];

const postalCodes = [
  { postnummer: '0150', poststed: 'Oslo' },
  { postnummer: '0250', poststed: 'Oslo' },
  { postnummer: '0450', poststed: 'Oslo' },
  { postnummer: '0580', poststed: 'Oslo' },
  { postnummer: '0660', poststed: 'Oslo' },
  { postnummer: '1003', poststed: 'Oslo' },
  { postnummer: '1400', poststed: 'Ski' },
  { postnummer: '1601', poststed: 'Fredrikstad' },
  { postnummer: '1771', poststed: 'Halden' },
  { postnummer: '2000', poststed: 'Lillestrøm' },
  { postnummer: '2317', poststed: 'Hamar' },
  { postnummer: '2600', poststed: 'Lillehammer' },
  { postnummer: '2800', poststed: 'Gjøvik' },
  { postnummer: '3015', poststed: 'Drammen' },
  { postnummer: '3100', poststed: 'Tønsberg' },
  { postnummer: '3210', poststed: 'Sandefjord' },
  { postnummer: '3510', poststed: 'Hønefoss' },
  { postnummer: '3601', poststed: 'Kongsberg' },
  { postnummer: '3900', poststed: 'Porsgrunn' },
  { postnummer: '3915', poststed: 'Skien' },
  { postnummer: '4006', poststed: 'Stavanger' },
  { postnummer: '4020', poststed: 'Stavanger' },
  { postnummer: '4307', poststed: 'Sandnes' },
  { postnummer: '4611', poststed: 'Kristiansand' },
  { postnummer: '4836', poststed: 'Arendal' },
  { postnummer: '5003', poststed: 'Bergen' },
  { postnummer: '5063', poststed: 'Bergen' },
  { postnummer: '5501', poststed: 'Haugesund' },
  { postnummer: '6002', poststed: 'Ålesund' },
  { postnummer: '6413', poststed: 'Molde' },
  { postnummer: '7010', poststed: 'Trondheim' },
  { postnummer: '7030', poststed: 'Trondheim' },
  { postnummer: '7462', poststed: 'Trondheim' },
  { postnummer: '8006', poststed: 'Bodø' },
  { postnummer: '9008', poststed: 'Tromsø' },
  { postnummer: '9400', poststed: 'Harstad' },
  { postnummer: '9600', poststed: 'Hammerfest' },
  { postnummer: '9800', poststed: 'Vadsø' },
  { postnummer: '1440', poststed: 'Drøbak' },
  { postnummer: '1500', poststed: 'Moss' },
];

const firstNames = [
  'Erik', 'Lars', 'Ole', 'Knut', 'Per', 'Jan', 'Arne', 'Bjørn', 'Tor',
  'Svein', 'Geir', 'Morten', 'Anders', 'Håkon', 'Terje', 'Rune', 'Trond',
  'Øyvind', 'Kristian', 'Petter', 'Anne', 'Kari', 'Ingrid', 'Hilde',
  'Marit', 'Silje', 'Lise', 'Nina', 'Tone', 'Berit',
];

const lastNames = [
  'Hansen', 'Johansen', 'Olsen', 'Larsen', 'Andersen', 'Pedersen', 'Nilsen',
  'Kristiansen', 'Jensen', 'Karlsen', 'Johnsen', 'Pettersen', 'Eriksen',
  'Berg', 'Haugen', 'Hagen', 'Bakken', 'Lund', 'Dahl', 'Strand',
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone() {
  const prefixes = ['400', '412', '450', '470', '480', '900', '920', '950', '970', '990'];
  return prefixes[Math.floor(Math.random() * prefixes.length)] +
    String(Math.floor(10000 + Math.random() * 90000));
}

function randomOrgNr() {
  return String(900000000 + Math.floor(Math.random() * 99999999));
}

function generateCustomer(index) {
  const prefix = companyPrefixes[index % companyPrefixes.length];
  const type = companyTypes[index % companyTypes.length];
  const name = `${prefix} ${type}`;

  const postal = randomItem(postalCodes);
  const street = randomItem(streetNames);
  const streetNum = Math.floor(1 + Math.random() * 120);

  const contactFirst = randomItem(firstNames);
  const contactLast = randomItem(lastNames);
  const domain = name.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);

  return {
    name,
    isCustomer: true,
    email: `post@${domain}.no`,
    invoiceEmail: `faktura@${domain}.no`,
    phoneNumber: randomPhone(),
    organizationNumber: randomOrgNr(),
    description: `Kontakt: ${contactFirst} ${contactLast}`,
    physicalAddress: {
      addressLine1: `${street} ${streetNum}`,
      postalCode: postal.postnummer,
      city: postal.poststed,
    },
  };
}

// --- Tripletex API helpers ---

async function createSessionToken(consumerToken, employeeToken) {
  const expirationDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  const url = `${BASE_URL}/token/session/:create?consumerToken=${encodeURIComponent(consumerToken)}&employeeToken=${encodeURIComponent(employeeToken)}&expirationDate=${expirationDate}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Session token feilet (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.value.token;
}

async function createCustomer(sessionToken, customerData) {
  const auth = Buffer.from(`0:${sessionToken}`).toString('base64');

  const res = await fetch(`${BASE_URL}/customer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify(customerData),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kunde-opprettelse feilet (${res.status}): ${text}`);
  }

  return await res.json();
}

// --- Main ---

async function main() {
  const consumerToken = process.argv[2] || process.env.TRIPLETEX_CONSUMER_TOKEN;
  const employeeToken = process.argv[3] || process.env.TRIPLETEX_EMPLOYEE_TOKEN;

  if (!consumerToken || !employeeToken) {
    console.error('Bruk: node scripts/seed-tripletex-customers.js <consumerToken> <employeeToken>');
    console.error('Eller: TRIPLETEX_CONSUMER_TOKEN=xxx TRIPLETEX_EMPLOYEE_TOKEN=yyy node scripts/seed-tripletex-customers.js');
    process.exit(1);
  }

  console.log('Oppretter session token...');
  const sessionToken = await createSessionToken(consumerToken, employeeToken);
  console.log('Session token opprettet.');

  const COUNT = 100;
  let created = 0;
  let failed = 0;

  console.log(`Oppretter ${COUNT} kunder i Tripletex...`);
  console.log('');

  for (let i = 0; i < COUNT; i++) {
    const customer = generateCustomer(i);

    try {
      const result = await createCustomer(sessionToken, customer);
      created++;
      const custNr = result.value?.customerNumber || '?';
      console.log(`  [${i + 1}/${COUNT}] ${customer.name} (kundenr: ${custNr})`);

      // Rate limit: max ~2 per second
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      failed++;
      console.error(`  [${i + 1}/${COUNT}] FEIL: ${customer.name} - ${err.message}`);
    }
  }

  console.log('');
  console.log('--- Ferdig ---');
  console.log(`Opprettet: ${created}`);
  console.log(`Feilet: ${failed}`);
  console.log('');
  console.log('Gå til Dashboard > Innstillinger > Integrasjoner og klikk "Synkroniser" for å teste import.');
}

main().catch(err => {
  console.error('Fatal feil:', err.message);
  process.exit(1);
});

/**
 * Create customer categories in Tripletex and assign them to existing customers
 *
 * Usage:
 *   node scripts/seed-tripletex-categories.js <consumerToken> <employeeToken>
 */

const BASE_URL = process.env.TRIPLETEX_ENV === 'prod'
  ? 'https://tripletex.no/v2'
  : 'https://api-test.tripletex.tech/v2';

// Categories to create
const CATEGORIES = [
  { name: 'El-Kontroll', number: 'EL' },
  { name: 'Brannvarsling', number: 'BRANN' },
  { name: 'Ventilasjon', number: 'VENT' },
  { name: 'VVS', number: 'VVS' },
  { name: 'Sikkerhet', number: 'SIK' },
];

async function createSessionToken(consumerToken, employeeToken) {
  const expirationDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  const url = `${BASE_URL}/token/session/:create?consumerToken=${encodeURIComponent(consumerToken)}&employeeToken=${encodeURIComponent(employeeToken)}&expirationDate=${expirationDate}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`Session feilet (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.value.token;
}

function authHeader(sessionToken) {
  return 'Basic ' + Buffer.from(`0:${sessionToken}`).toString('base64');
}

async function getOrCreateCategories(sessionToken) {
  const auth = authHeader(sessionToken);

  // First check existing categories
  const existingRes = await fetch(`${BASE_URL}/customer/category?from=0&count=100&fields=id,name,number`, {
    headers: { 'Authorization': auth },
  });

  let existing = [];
  if (existingRes.ok) {
    const data = await existingRes.json();
    existing = data.values || [];
    console.log(`Fant ${existing.length} eksisterende kategorier`);
  }

  const categoryIds = [];

  for (const cat of CATEGORIES) {
    // Check if already exists
    const found = existing.find(e => e.name === cat.name || e.number === cat.number);
    if (found) {
      console.log(`  Kategori "${cat.name}" finnes allerede (id: ${found.id})`);
      categoryIds.push({ id: found.id, name: cat.name });
      continue;
    }

    // Create new category
    const res = await fetch(`${BASE_URL}/customer/category`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth,
      },
      body: JSON.stringify({ name: cat.name, number: cat.number }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`  FEIL: Kunne ikke opprette "${cat.name}" (${res.status}): ${text}`);
      continue;
    }

    const result = await res.json();
    console.log(`  Opprettet kategori "${cat.name}" (id: ${result.value.id})`);
    categoryIds.push({ id: result.value.id, name: cat.name });

    await new Promise(r => setTimeout(r, 300));
  }

  return categoryIds;
}

async function fetchAllCustomers(sessionToken) {
  const auth = authHeader(sessionToken);
  let allCustomers = [];
  let from = 0;
  const count = 100;

  while (true) {
    const res = await fetch(
      `${BASE_URL}/customer?from=${from}&count=${count}&fields=id,name,customerNumber,category1(id,name)&isInactive=false`,
      { headers: { 'Authorization': auth } }
    );

    if (!res.ok) throw new Error(`Kunde-henting feilet (${res.status})`);

    const data = await res.json();
    const customers = data.values || [];
    allCustomers = allCustomers.concat(customers);

    if (customers.length < count) break;
    from += count;
  }

  return allCustomers;
}

async function updateCustomerCategory(sessionToken, customerId, categoryId) {
  const auth = authHeader(sessionToken);

  const res = await fetch(`${BASE_URL}/customer/${customerId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': auth,
    },
    body: JSON.stringify({
      id: customerId,
      name: '', // required by API but won't change
      category1: { id: categoryId },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`(${res.status}): ${text}`);
  }

  return await res.json();
}

async function main() {
  const consumerToken = process.argv[2] || process.env.TRIPLETEX_CONSUMER_TOKEN;
  const employeeToken = process.argv[3] || process.env.TRIPLETEX_EMPLOYEE_TOKEN;

  if (!consumerToken || !employeeToken) {
    console.error('Bruk: node scripts/seed-tripletex-categories.js <consumerToken> <employeeToken>');
    process.exit(1);
  }

  console.log('Oppretter session token...');
  const sessionToken = await createSessionToken(consumerToken, employeeToken);
  console.log('OK\n');

  // Step 1: Create categories
  console.log('Steg 1: Oppretter kategorier...');
  const categories = await getOrCreateCategories(sessionToken);
  if (categories.length === 0) {
    console.error('Ingen kategorier tilgjengelig. Avbryter.');
    process.exit(1);
  }
  console.log(`${categories.length} kategorier klare\n`);

  // Step 2: Fetch all customers
  console.log('Steg 2: Henter kunder...');
  const customers = await fetchAllCustomers(sessionToken);
  console.log(`${customers.length} kunder funnet\n`);

  // Step 3: Assign categories to customers without one
  const withoutCategory = customers.filter(c => !c.category1);
  console.log(`Steg 3: Tilordner kategorier til ${withoutCategory.length} kunder uten kategori...`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < withoutCategory.length; i++) {
    const customer = withoutCategory[i];
    const cat = categories[i % categories.length]; // Round-robin

    try {
      await updateCustomerCategory(sessionToken, customer.id, cat.id);
      updated++;
      console.log(`  [${i + 1}/${withoutCategory.length}] ${customer.name} → ${cat.name}`);
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      failed++;
      console.error(`  [${i + 1}/${withoutCategory.length}] FEIL: ${customer.name} - ${err.message}`);
    }
  }

  console.log(`\n--- Ferdig ---`);
  console.log(`Kategorier opprettet: ${categories.length}`);
  console.log(`Kunder oppdatert: ${updated}`);
  console.log(`Feilet: ${failed}`);
}

main().catch(err => {
  console.error('Fatal feil:', err.message);
  process.exit(1);
});

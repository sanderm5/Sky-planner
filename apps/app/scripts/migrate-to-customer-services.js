/**
 * Migration: Migrate Existing Customer Data to customer_services (SQLite)
 *
 * This script migrates data from hardcoded columns (siste_el_kontroll, neste_el_kontroll, etc.)
 * to the dynamic customer_services table.
 *
 * Usage: node scripts/migrate-to-customer-services.js
 *
 * Safe to run multiple times - skips already migrated customers.
 */

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || './kunder.db';

async function migrate() {
  console.log('\n========================================');
  console.log('  Migrating Customer Data to customer_services');
  console.log('========================================\n');

  const db = new Database(dbPath);

  // Step 1: Get service type IDs
  console.log('Step 1: Getting service type IDs...');

  const serviceTypes = db.prepare('SELECT id, slug FROM template_service_types').all();

  if (serviceTypes.length === 0) {
    console.error('No service types found!');
    console.log('Make sure the server has been started at least once to seed the template data.');
    process.exit(1);
  }

  const elServiceType = serviceTypes.find(st => st.slug === 'el-kontroll');
  const brannServiceType = serviceTypes.find(st => st.slug === 'brannvarsling');

  if (!elServiceType || !brannServiceType) {
    console.error('El-Kontroll or Brannvarsling service type not found.');
    console.error('Available service types:', serviceTypes.map(st => st.slug).join(', '));
    process.exit(1);
  }

  console.log(`  El-Kontroll service type ID: ${elServiceType.id}`);
  console.log(`  Brannvarsling service type ID: ${brannServiceType.id}`);

  // Step 2: Get subtype and equipment mappings
  console.log('\nStep 2: Getting subtypes and equipment mappings...');

  const subtypes = db.prepare('SELECT id, name, service_type_id FROM template_subtypes').all();
  const equipment = db.prepare('SELECT id, name, service_type_id FROM template_equipment').all();

  const subtypeMap = {};
  subtypes.forEach(s => {
    subtypeMap[s.name.toLowerCase()] = s.id;
  });

  const equipmentMap = {};
  equipment.forEach(e => {
    equipmentMap[e.name.toLowerCase()] = e.id;
  });

  console.log(`  Found ${Object.keys(subtypeMap).length} subtypes: ${Object.keys(subtypeMap).join(', ')}`);
  console.log(`  Found ${Object.keys(equipmentMap).length} equipment types: ${Object.keys(equipmentMap).join(', ')}`);

  // Step 3: Get all customers
  console.log('\nStep 3: Fetching customers...');

  const customers = db.prepare('SELECT * FROM kunder').all();
  console.log(`  Found ${customers.length} customers`);

  // Step 4: Check for existing migrations
  console.log('\nStep 4: Checking for existing migrations...');

  const existingServices = db.prepare('SELECT kunde_id, service_type_id FROM customer_services').all();
  const existingSet = new Set();
  existingServices.forEach(s => {
    existingSet.add(`${s.kunde_id}-${s.service_type_id}`);
  });

  console.log(`  ${existingServices.length} services already migrated`);

  // Step 5: Migrate customer data
  console.log('\nStep 5: Migrating customer services...');

  const insertStmt = db.prepare(`
    INSERT INTO customer_services (kunde_id, service_type_id, subtype_id, equipment_type_id, siste_kontroll, neste_kontroll, intervall_months, driftstype, aktiv)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  let migratedEl = 0;
  let migratedBrann = 0;
  let skipped = 0;
  let errors = 0;

  const migrateTransaction = db.transaction(() => {
    for (const customer of customers) {
      const kategori = customer.kategori || '';

      // Migrate El-Kontroll data
      const hasElData = customer.siste_el_kontroll || customer.neste_el_kontroll;
      const isElKategori = kategori.includes('El-Kontroll');

      if (hasElData || isElKategori) {
        const key = `${customer.id}-${elServiceType.id}`;
        if (!existingSet.has(key)) {
          try {
            const subtypeId = customer.el_type ? subtypeMap[customer.el_type.toLowerCase()] || null : null;

            insertStmt.run(
              customer.id,
              elServiceType.id,
              subtypeId,
              null, // No equipment for El-Kontroll
              customer.siste_el_kontroll || null,
              customer.neste_el_kontroll || null,
              customer.el_kontroll_intervall || 36,
              null // No driftstype for El-Kontroll
            );
            migratedEl++;
          } catch (error) {
            console.error(`  Error migrating El-Kontroll for customer ${customer.id} (${customer.navn}):`, error.message);
            errors++;
          }
        } else {
          skipped++;
        }
      }

      // Migrate Brannvarsling data
      const hasBrannData = customer.siste_brann_kontroll || customer.neste_brann_kontroll;
      const isBrannKategori = kategori.includes('Brannvarsling');

      if (hasBrannData || isBrannKategori) {
        const key = `${customer.id}-${brannServiceType.id}`;
        if (!existingSet.has(key)) {
          try {
            const equipmentId = customer.brann_system ? equipmentMap[customer.brann_system.toLowerCase()] || null : null;

            insertStmt.run(
              customer.id,
              brannServiceType.id,
              null, // No subtype for Brannvarsling
              equipmentId,
              customer.siste_brann_kontroll || null,
              customer.neste_brann_kontroll || null,
              customer.brann_kontroll_intervall || 12,
              customer.brann_driftstype || null
            );
            migratedBrann++;
          } catch (error) {
            console.error(`  Error migrating Brannvarsling for customer ${customer.id} (${customer.navn}):`, error.message);
            errors++;
          }
        } else {
          skipped++;
        }
      }
    }
  });

  migrateTransaction();

  console.log(`\n  Migrated ${migratedEl} El-Kontroll services`);
  console.log(`  Migrated ${migratedBrann} Brannvarsling services`);
  console.log(`  Skipped ${skipped} (already migrated)`);
  if (errors > 0) {
    console.log(`  ${errors} errors occurred`);
  }

  // Step 6: Verify migration
  console.log('\nStep 6: Verifying migration...');

  const totalServices = db.prepare('SELECT COUNT(*) as count FROM customer_services').get();
  console.log(`  Total customer services in database: ${totalServices.count}`);

  const servicesByType = db.prepare(`
    SELECT st.name, COUNT(cs.id) as count
    FROM customer_services cs
    JOIN template_service_types st ON cs.service_type_id = st.id
    GROUP BY st.name
  `).all();

  servicesByType.forEach(s => {
    console.log(`    - ${s.name}: ${s.count}`);
  });

  // Step 7: Show sample data
  console.log('\nStep 7: Sample migrated data...');

  const sampleServices = db.prepare(`
    SELECT k.navn, st.name as service_type, cs.siste_kontroll, cs.neste_kontroll, cs.intervall_months
    FROM customer_services cs
    JOIN kunder k ON cs.kunde_id = k.id
    JOIN template_service_types st ON cs.service_type_id = st.id
    LIMIT 5
  `).all();

  sampleServices.forEach(s => {
    console.log(`    ${s.navn}: ${s.service_type} - Neste: ${s.neste_kontroll || 'ikke satt'}`);
  });

  db.close();

  console.log('\n========================================');
  console.log('  Migration completed!');
  console.log('========================================\n');
}

migrate().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});

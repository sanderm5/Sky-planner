/**
 * Migration: Migrate Existing Customer Data to customer_services
 *
 * Run AFTER 001_create_tables.sql has been executed in Supabase
 *
 * Usage: node migrations/002_migrate_customer_data.js
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function migrate() {
  console.log('\n========================================');
  console.log('  Migrating Customer Data');
  console.log('========================================\n');

  // Step 1: Get service type IDs
  console.log('Step 1: Getting service type IDs...');

  const { data: serviceTypes, error: stError } = await supabase
    .from('template_service_types')
    .select('id, slug');

  if (stError) {
    console.error('Error fetching service types:', stError);
    console.log('\nMake sure you have run 001_create_tables.sql in Supabase first!');
    process.exit(1);
  }

  const elServiceType = serviceTypes.find(st => st.slug === 'el-kontroll');
  const brannServiceType = serviceTypes.find(st => st.slug === 'brannvarsling');

  if (!elServiceType || !brannServiceType) {
    console.error('Service types not found. Run 001_create_tables.sql first.');
    process.exit(1);
  }

  console.log(`  ✓ El-Kontroll service type ID: ${elServiceType.id}`);
  console.log(`  ✓ Brannvarsling service type ID: ${brannServiceType.id}`);

  // Step 2: Get subtype and equipment mappings
  console.log('\nStep 2: Getting subtypes and equipment mappings...');

  const { data: subtypes } = await supabase
    .from('template_subtypes')
    .select('id, name, service_type_id');

  const { data: equipment } = await supabase
    .from('template_equipment')
    .select('id, name, service_type_id');

  const subtypeMap = {};
  subtypes?.forEach(s => {
    subtypeMap[s.name.toLowerCase()] = s.id;
  });

  const equipmentMap = {};
  equipment?.forEach(e => {
    equipmentMap[e.name.toLowerCase()] = e.id;
  });

  console.log(`  ✓ Found ${Object.keys(subtypeMap).length} subtypes`);
  console.log(`  ✓ Found ${Object.keys(equipmentMap).length} equipment types`);

  // Step 3: Get all customers
  console.log('\nStep 3: Fetching customers...');

  const { data: customers, error: custError } = await supabase
    .from('kunder')
    .select('*');

  if (custError) {
    console.error('Error fetching customers:', custError);
    process.exit(1);
  }

  console.log(`  ✓ Found ${customers.length} customers`);

  // Step 4: Check for existing migrations
  console.log('\nStep 4: Checking for existing migrations...');

  const { data: existingServices } = await supabase
    .from('customer_services')
    .select('kunde_id, service_type_id');

  const existingSet = new Set();
  existingServices?.forEach(s => {
    existingSet.add(`${s.kunde_id}-${s.service_type_id}`);
  });

  console.log(`  - ${existingServices?.length || 0} services already migrated`);

  // Step 5: Migrate customer data
  console.log('\nStep 5: Migrating customer services...');

  let migratedEl = 0;
  let migratedBrann = 0;
  let skipped = 0;
  let errors = 0;

  for (const customer of customers) {
    const kategori = customer.kategori || '';

    // Migrate El-Kontroll data
    if (kategori.includes('El-Kontroll') || customer.siste_el_kontroll || customer.neste_el_kontroll) {
      const key = `${customer.id}-${elServiceType.id}`;
      if (!existingSet.has(key)) {
        const subtypeId = customer.el_type ? subtypeMap[customer.el_type.toLowerCase()] : null;

        const { error } = await supabase
          .from('customer_services')
          .insert({
            kunde_id: customer.id,
            service_type_id: elServiceType.id,
            subtype_id: subtypeId,
            siste_kontroll: customer.siste_el_kontroll,
            neste_kontroll: customer.neste_el_kontroll,
            intervall_months: customer.el_kontroll_intervall || 36
          });

        if (error) {
          console.error(`  Error migrating El-Kontroll for customer ${customer.id}:`, error.message);
          errors++;
        } else {
          migratedEl++;
        }
      } else {
        skipped++;
      }
    }

    // Migrate Brannvarsling data
    if (kategori.includes('Brannvarsling') || customer.siste_brann_kontroll || customer.neste_brann_kontroll) {
      const key = `${customer.id}-${brannServiceType.id}`;
      if (!existingSet.has(key)) {
        const equipmentId = customer.brann_system ? equipmentMap[customer.brann_system.toLowerCase()] : null;

        const { error } = await supabase
          .from('customer_services')
          .insert({
            kunde_id: customer.id,
            service_type_id: brannServiceType.id,
            equipment_type_id: equipmentId,
            siste_kontroll: customer.siste_brann_kontroll,
            neste_kontroll: customer.neste_brann_kontroll,
            intervall_months: customer.brann_kontroll_intervall || 12
          });

        if (error) {
          console.error(`  Error migrating Brannvarsling for customer ${customer.id}:`, error.message);
          errors++;
        } else {
          migratedBrann++;
        }
      } else {
        skipped++;
      }
    }
  }

  console.log(`\n  ✓ Migrated ${migratedEl} El-Kontroll services`);
  console.log(`  ✓ Migrated ${migratedBrann} Brannvarsling services`);
  console.log(`  - Skipped ${skipped} (already migrated)`);
  if (errors > 0) {
    console.log(`  ⚠ ${errors} errors occurred`);
  }

  // Step 6: Verify migration
  console.log('\nStep 6: Verifying migration...');

  const { data: totalServices, error: verifyError } = await supabase
    .from('customer_services')
    .select('id', { count: 'exact' });

  if (!verifyError) {
    console.log(`  ✓ Total customer services in database: ${totalServices.length}`);
  }

  console.log('\n========================================');
  console.log('  Migration completed!');
  console.log('========================================\n');
}

migrate().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});

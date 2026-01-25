/**
 * Migration: Multi-Industry Platform Setup
 *
 * This migration sets up the Sky Planner multi-industry SaaS platform
 * with support for various industry templates.
 *
 * Run with: node migrations/001_multi_industry_setup.js
 */

require('dotenv').config();

const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
const useSupabase = DATABASE_TYPE === 'supabase';

let db = null;
let supabase = null;

// Initialize database connection
async function initDatabase() {
  if (useSupabase) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
    );
    console.log('Connected to Supabase');
  } else {
    const Database = require('better-sqlite3');
    const dbPath = process.env.DATABASE_PATH || './kunder.db';
    db = new Database(dbPath);
    console.log('Connected to SQLite:', dbPath);
  }
}

// Execute SQL for SQLite
function sqliteExec(sql) {
  try {
    db.exec(sql);
    return true;
  } catch (error) {
    if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
      return true; // Table/column already exists, that's OK
    }
    throw error;
  }
}

// Execute SQL for Supabase
async function supabaseExec(sql) {
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error && !error.message.includes('already exists')) {
    throw error;
  }
  return true;
}

// Main migration function
async function migrate() {
  console.log('\n========================================');
  console.log('  Multi-Industry Platform Migration');
  console.log('========================================\n');

  await initDatabase();

  // Step 1: Create industry_templates table
  console.log('Step 1: Creating industry_templates table...');
  const industryTemplatesSQL = `
    CREATE TABLE IF NOT EXISTS industry_templates (
      id INTEGER PRIMARY KEY ${useSupabase ? '' : 'AUTOINCREMENT'},
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT DEFAULT 'fa-briefcase',
      color TEXT DEFAULT '#F97316',
      description TEXT,
      aktiv INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at ${useSupabase ? 'TIMESTAMP DEFAULT NOW()' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
    )
  `;

  if (useSupabase) {
    await supabaseExec(industryTemplatesSQL);
  } else {
    sqliteExec(industryTemplatesSQL);
  }
  console.log('  ✓ industry_templates created');

  // Step 2: Create template_service_types table
  console.log('Step 2: Creating template_service_types table...');
  const serviceTypesSQL = `
    CREATE TABLE IF NOT EXISTS template_service_types (
      id INTEGER PRIMARY KEY ${useSupabase ? '' : 'AUTOINCREMENT'},
      template_id INTEGER NOT NULL REFERENCES industry_templates(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      default_interval_months INTEGER DEFAULT 12,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      aktiv INTEGER DEFAULT 1,
      created_at ${useSupabase ? 'TIMESTAMP DEFAULT NOW()' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
    )
  `;

  if (useSupabase) {
    await supabaseExec(serviceTypesSQL);
  } else {
    sqliteExec(serviceTypesSQL);
  }
  console.log('  ✓ template_service_types created');

  // Step 3: Create template_subtypes table
  console.log('Step 3: Creating template_subtypes table...');
  const subtypesSQL = `
    CREATE TABLE IF NOT EXISTS template_subtypes (
      id INTEGER PRIMARY KEY ${useSupabase ? '' : 'AUTOINCREMENT'},
      service_type_id INTEGER NOT NULL REFERENCES template_service_types(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      default_interval_months INTEGER,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      aktiv INTEGER DEFAULT 1
    )
  `;

  if (useSupabase) {
    await supabaseExec(subtypesSQL);
  } else {
    sqliteExec(subtypesSQL);
  }
  console.log('  ✓ template_subtypes created');

  // Step 4: Create template_equipment table
  console.log('Step 4: Creating template_equipment table...');
  const equipmentSQL = `
    CREATE TABLE IF NOT EXISTS template_equipment (
      id INTEGER PRIMARY KEY ${useSupabase ? '' : 'AUTOINCREMENT'},
      service_type_id INTEGER NOT NULL REFERENCES template_service_types(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      aktiv INTEGER DEFAULT 1
    )
  `;

  if (useSupabase) {
    await supabaseExec(equipmentSQL);
  } else {
    sqliteExec(equipmentSQL);
  }
  console.log('  ✓ template_equipment created');

  // Step 5: Create template_intervals table
  console.log('Step 5: Creating template_intervals table...');
  const intervalsSQL = `
    CREATE TABLE IF NOT EXISTS template_intervals (
      id INTEGER PRIMARY KEY ${useSupabase ? '' : 'AUTOINCREMENT'},
      template_id INTEGER NOT NULL REFERENCES industry_templates(id) ON DELETE CASCADE,
      months INTEGER NOT NULL,
      label TEXT,
      is_default INTEGER DEFAULT 0,
      UNIQUE(template_id, months)
    )
  `;

  if (useSupabase) {
    await supabaseExec(intervalsSQL);
  } else {
    sqliteExec(intervalsSQL);
  }
  console.log('  ✓ template_intervals created');

  // Step 6: Create customer_services table
  console.log('Step 6: Creating customer_services table...');
  const customerServicesSQL = `
    CREATE TABLE IF NOT EXISTS customer_services (
      id INTEGER PRIMARY KEY ${useSupabase ? '' : 'AUTOINCREMENT'},
      kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
      service_type_id INTEGER NOT NULL REFERENCES template_service_types(id),
      subtype_id INTEGER REFERENCES template_subtypes(id),
      equipment_type_id INTEGER REFERENCES template_equipment(id),
      siste_kontroll DATE,
      neste_kontroll DATE,
      intervall_months INTEGER,
      notater TEXT,
      aktiv INTEGER DEFAULT 1,
      created_at ${useSupabase ? 'TIMESTAMP DEFAULT NOW()' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
      UNIQUE(kunde_id, service_type_id)
    )
  `;

  if (useSupabase) {
    await supabaseExec(customerServicesSQL);
  } else {
    sqliteExec(customerServicesSQL);
  }
  console.log('  ✓ customer_services created');

  // Step 7: Add industry_template_id to organizations if it exists
  console.log('Step 7: Updating organizations table...');
  try {
    if (useSupabase) {
      await supabaseExec('ALTER TABLE organizations ADD COLUMN industry_template_id INTEGER REFERENCES industry_templates(id)');
    } else {
      sqliteExec('ALTER TABLE organizations ADD COLUMN industry_template_id INTEGER REFERENCES industry_templates(id)');
    }
    console.log('  ✓ organizations.industry_template_id added');
  } catch (e) {
    console.log('  - organizations table not found or column exists (OK)');
  }

  // Step 8: Seed El-Kontroll + Brannvarsling industry template
  console.log('\nStep 8: Seeding El-Kontroll + Brannvarsling template...');
  await seedElKontrollBrannvarsling();

  // Step 9: Migrate existing customer data
  console.log('\nStep 9: Migrating existing customer data...');
  await migrateExistingCustomers();

  console.log('\n========================================');
  console.log('  Migration completed successfully!');
  console.log('========================================\n');
}

// Seed the El-Kontroll + Brannvarsling industry template
async function seedElKontrollBrannvarsling() {
  // Check if already seeded
  let existing;
  if (useSupabase) {
    const { data } = await supabase
      .from('industry_templates')
      .select('id')
      .eq('slug', 'el-kontroll-brannvarsling')
      .single();
    existing = data;
  } else {
    existing = db.prepare('SELECT id FROM industry_templates WHERE slug = ?').get('el-kontroll-brannvarsling');
  }

  if (existing) {
    console.log('  - Template already exists, skipping seed');
    return;
  }

  // Insert industry template
  let templateId;
  if (useSupabase) {
    const { data, error } = await supabase
      .from('industry_templates')
      .insert({
        name: 'El-Kontroll + Brannvarsling',
        slug: 'el-kontroll-brannvarsling',
        icon: 'fa-bolt',
        color: '#F97316',
        description: 'Periodisk el-kontroll og brannvarsling for landbruk, næring og bolig',
        sort_order: 1
      })
      .select('id')
      .single();
    if (error) throw error;
    templateId = data.id;
  } else {
    const result = db.prepare(`
      INSERT INTO industry_templates (name, slug, icon, color, description, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'El-Kontroll + Brannvarsling',
      'el-kontroll-brannvarsling',
      'fa-bolt',
      '#F97316',
      'Periodisk el-kontroll og brannvarsling for landbruk, næring og bolig',
      1
    );
    templateId = result.lastInsertRowid;
  }
  console.log(`  ✓ Industry template created (ID: ${templateId})`);

  // Insert El-Kontroll service type
  let elServiceId;
  if (useSupabase) {
    const { data, error } = await supabase
      .from('template_service_types')
      .insert({
        template_id: templateId,
        name: 'El-Kontroll',
        slug: 'el-kontroll',
        icon: 'fa-bolt',
        color: '#F59E0B',
        default_interval_months: 36,
        description: 'Periodisk kontroll av elektriske anlegg',
        sort_order: 1
      })
      .select('id')
      .single();
    if (error) throw error;
    elServiceId = data.id;
  } else {
    const result = db.prepare(`
      INSERT INTO template_service_types (template_id, name, slug, icon, color, default_interval_months, description, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(templateId, 'El-Kontroll', 'el-kontroll', 'fa-bolt', '#F59E0B', 36, 'Periodisk kontroll av elektriske anlegg', 1);
    elServiceId = result.lastInsertRowid;
  }
  console.log(`  ✓ El-Kontroll service type created (ID: ${elServiceId})`);

  // Insert El-Kontroll subtypes
  const elSubtypes = [
    { name: 'Landbruk', slug: 'landbruk', interval: 36, order: 1 },
    { name: 'Næring', slug: 'naering', interval: 12, order: 2 },
    { name: 'Bolig', slug: 'bolig', interval: 60, order: 3 },
    { name: 'Gartneri', slug: 'gartneri', interval: 36, order: 4 }
  ];

  for (const subtype of elSubtypes) {
    if (useSupabase) {
      await supabase.from('template_subtypes').insert({
        service_type_id: elServiceId,
        name: subtype.name,
        slug: subtype.slug,
        default_interval_months: subtype.interval,
        sort_order: subtype.order
      });
    } else {
      db.prepare(`
        INSERT INTO template_subtypes (service_type_id, name, slug, default_interval_months, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `).run(elServiceId, subtype.name, subtype.slug, subtype.interval, subtype.order);
    }
  }
  console.log('  ✓ El-Kontroll subtypes created (Landbruk, Næring, Bolig, Gartneri)');

  // Insert Brannvarsling service type
  let brannServiceId;
  if (useSupabase) {
    const { data, error } = await supabase
      .from('template_service_types')
      .insert({
        template_id: templateId,
        name: 'Brannvarsling',
        slug: 'brannvarsling',
        icon: 'fa-fire',
        color: '#DC2626',
        default_interval_months: 12,
        description: 'Årlig kontroll av brannvarslingssystemer',
        sort_order: 2
      })
      .select('id')
      .single();
    if (error) throw error;
    brannServiceId = data.id;
  } else {
    const result = db.prepare(`
      INSERT INTO template_service_types (template_id, name, slug, icon, color, default_interval_months, description, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(templateId, 'Brannvarsling', 'brannvarsling', 'fa-fire', '#DC2626', 12, 'Årlig kontroll av brannvarslingssystemer', 2);
    brannServiceId = result.lastInsertRowid;
  }
  console.log(`  ✓ Brannvarsling service type created (ID: ${brannServiceId})`);

  // Insert Brannvarsling equipment types
  const brannEquipment = [
    { name: 'Elotec', slug: 'elotec', order: 1 },
    { name: 'ICAS', slug: 'icas', order: 2 },
    { name: 'Elotec + ICAS', slug: 'elotec-icas', order: 3 },
    { name: '2 x Elotec', slug: '2x-elotec', order: 4 }
  ];

  for (const equip of brannEquipment) {
    if (useSupabase) {
      await supabase.from('template_equipment').insert({
        service_type_id: brannServiceId,
        name: equip.name,
        slug: equip.slug,
        sort_order: equip.order
      });
    } else {
      db.prepare(`
        INSERT INTO template_equipment (service_type_id, name, slug, sort_order)
        VALUES (?, ?, ?, ?)
      `).run(brannServiceId, equip.name, equip.slug, equip.order);
    }
  }
  console.log('  ✓ Brannvarsling equipment types created (Elotec, ICAS, etc.)');

  // Insert intervals for the template
  const intervals = [
    { months: 6, label: '6 mnd', isDefault: 0 },
    { months: 12, label: '1 år', isDefault: 0 },
    { months: 24, label: '2 år', isDefault: 0 },
    { months: 36, label: '3 år', isDefault: 1 },
    { months: 48, label: '4 år', isDefault: 0 },
    { months: 60, label: '5 år', isDefault: 0 }
  ];

  for (const interval of intervals) {
    if (useSupabase) {
      await supabase.from('template_intervals').insert({
        template_id: templateId,
        months: interval.months,
        label: interval.label,
        is_default: interval.isDefault
      });
    } else {
      db.prepare(`
        INSERT INTO template_intervals (template_id, months, label, is_default)
        VALUES (?, ?, ?, ?)
      `).run(templateId, interval.months, interval.label, interval.isDefault);
    }
  }
  console.log('  ✓ Control intervals created (6, 12, 24, 36, 48, 60 months)');
}

// Migrate existing customers to new customer_services structure
async function migrateExistingCustomers() {
  // Get service type IDs
  let elServiceType, brannServiceType;

  if (useSupabase) {
    const { data: elData } = await supabase
      .from('template_service_types')
      .select('id')
      .eq('slug', 'el-kontroll')
      .single();
    const { data: brannData } = await supabase
      .from('template_service_types')
      .select('id')
      .eq('slug', 'brannvarsling')
      .single();
    elServiceType = elData?.id;
    brannServiceType = brannData?.id;
  } else {
    elServiceType = db.prepare('SELECT id FROM template_service_types WHERE slug = ?').get('el-kontroll')?.id;
    brannServiceType = db.prepare('SELECT id FROM template_service_types WHERE slug = ?').get('brannvarsling')?.id;
  }

  if (!elServiceType || !brannServiceType) {
    console.log('  - Service types not found, skipping migration');
    return;
  }

  // Get subtype and equipment mappings
  let subtypeMap = {};
  let equipmentMap = {};

  if (useSupabase) {
    const { data: subtypes } = await supabase.from('template_subtypes').select('*');
    const { data: equipment } = await supabase.from('template_equipment').select('*');
    subtypes?.forEach(s => subtypeMap[s.name.toLowerCase()] = s.id);
    equipment?.forEach(e => equipmentMap[e.name.toLowerCase()] = e.id);
  } else {
    const subtypes = db.prepare('SELECT * FROM template_subtypes').all();
    const equipment = db.prepare('SELECT * FROM template_equipment').all();
    subtypes.forEach(s => subtypeMap[s.name.toLowerCase()] = s.id);
    equipment.forEach(e => equipmentMap[e.name.toLowerCase()] = e.id);
  }

  // Get all customers
  let customers;
  if (useSupabase) {
    const { data } = await supabase.from('kunder').select('*');
    customers = data || [];
  } else {
    customers = db.prepare('SELECT * FROM kunder').all();
  }

  console.log(`  Found ${customers.length} customers to migrate`);

  let migratedEl = 0;
  let migratedBrann = 0;

  for (const customer of customers) {
    const kategori = customer.kategori || '';

    // Check if already migrated
    let existingServices;
    if (useSupabase) {
      const { data } = await supabase
        .from('customer_services')
        .select('id')
        .eq('kunde_id', customer.id);
      existingServices = data || [];
    } else {
      existingServices = db.prepare('SELECT id FROM customer_services WHERE kunde_id = ?').all(customer.id);
    }

    if (existingServices.length > 0) {
      continue; // Already migrated
    }

    // Migrate El-Kontroll data
    if (kategori.includes('El-Kontroll') || customer.siste_el_kontroll || customer.neste_el_kontroll) {
      const subtypeId = customer.el_type ? subtypeMap[customer.el_type.toLowerCase()] : null;

      if (useSupabase) {
        await supabase.from('customer_services').insert({
          kunde_id: customer.id,
          service_type_id: elServiceType,
          subtype_id: subtypeId,
          siste_kontroll: customer.siste_el_kontroll,
          neste_kontroll: customer.neste_el_kontroll,
          intervall_months: customer.el_kontroll_intervall || 36
        });
      } else {
        db.prepare(`
          INSERT INTO customer_services (kunde_id, service_type_id, subtype_id, siste_kontroll, neste_kontroll, intervall_months)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          customer.id,
          elServiceType,
          subtypeId,
          customer.siste_el_kontroll,
          customer.neste_el_kontroll,
          customer.el_kontroll_intervall || 36
        );
      }
      migratedEl++;
    }

    // Migrate Brannvarsling data
    if (kategori.includes('Brannvarsling') || customer.siste_brann_kontroll || customer.neste_brann_kontroll) {
      const equipmentId = customer.brann_system ? equipmentMap[customer.brann_system.toLowerCase()] : null;

      if (useSupabase) {
        await supabase.from('customer_services').insert({
          kunde_id: customer.id,
          service_type_id: brannServiceType,
          equipment_type_id: equipmentId,
          siste_kontroll: customer.siste_brann_kontroll,
          neste_kontroll: customer.neste_brann_kontroll,
          intervall_months: customer.brann_kontroll_intervall || 12
        });
      } else {
        db.prepare(`
          INSERT INTO customer_services (kunde_id, service_type_id, equipment_type_id, siste_kontroll, neste_kontroll, intervall_months)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          customer.id,
          brannServiceType,
          equipmentId,
          customer.siste_brann_kontroll,
          customer.neste_brann_kontroll,
          customer.brann_kontroll_intervall || 12
        );
      }
      migratedBrann++;
    }
  }

  console.log(`  ✓ Migrated ${migratedEl} El-Kontroll services`);
  console.log(`  ✓ Migrated ${migratedBrann} Brannvarsling services`);
}

// Run migration
migrate().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});

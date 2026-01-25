/**
 * Migration: Organization Dynamic Fields
 *
 * This migration adds support for dynamic, organization-specific fields
 * that can be configured based on Excel imports.
 *
 * Run with: node migrations/004_organization_fields.js
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
      return true;
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
  console.log('  Organization Dynamic Fields Migration');
  console.log('========================================\n');

  await initDatabase();

  // Step 1: Create organization_fields table
  console.log('Step 1: Creating organization_fields table...');
  const organizationFieldsSQL = `
    CREATE TABLE IF NOT EXISTS organization_fields (
      id INTEGER PRIMARY KEY ${useSupabase ? '' : 'AUTOINCREMENT'},
      organization_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      field_type TEXT DEFAULT 'text',
      is_filterable INTEGER DEFAULT 0,
      is_required INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at ${useSupabase ? 'TIMESTAMP DEFAULT NOW()' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
      UNIQUE(organization_id, field_name)
    )
  `;

  if (useSupabase) {
    await supabaseExec(organizationFieldsSQL);
  } else {
    sqliteExec(organizationFieldsSQL);
  }
  console.log('  ✓ organization_fields created');

  // Step 2: Create organization_field_options table (for select/dropdown fields)
  console.log('Step 2: Creating organization_field_options table...');
  const fieldOptionsSQL = `
    CREATE TABLE IF NOT EXISTS organization_field_options (
      id INTEGER PRIMARY KEY ${useSupabase ? '' : 'AUTOINCREMENT'},
      field_id INTEGER NOT NULL REFERENCES organization_fields(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      display_name TEXT,
      color TEXT,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at ${useSupabase ? 'TIMESTAMP DEFAULT NOW()' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
      UNIQUE(field_id, value)
    )
  `;

  if (useSupabase) {
    await supabaseExec(fieldOptionsSQL);
  } else {
    sqliteExec(fieldOptionsSQL);
  }
  console.log('  ✓ organization_field_options created');

  // Step 3: Create organization_categories table (dynamic service types)
  console.log('Step 3: Creating organization_categories table...');
  const categoriesSQL = `
    CREATE TABLE IF NOT EXISTS organization_categories (
      id INTEGER PRIMARY KEY ${useSupabase ? '' : 'AUTOINCREMENT'},
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      icon TEXT DEFAULT 'fa-tag',
      color TEXT DEFAULT '#6B7280',
      default_interval_months INTEGER DEFAULT 12,
      sort_order INTEGER DEFAULT 0,
      aktiv INTEGER DEFAULT 1,
      created_at ${useSupabase ? 'TIMESTAMP DEFAULT NOW()' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
      UNIQUE(organization_id, slug)
    )
  `;

  if (useSupabase) {
    await supabaseExec(categoriesSQL);
  } else {
    sqliteExec(categoriesSQL);
  }
  console.log('  ✓ organization_categories created');

  // Step 4: Add custom_data column to kunder table
  console.log('Step 4: Adding custom_data column to kunder table...');
  try {
    const alterSQL = 'ALTER TABLE kunder ADD COLUMN custom_data TEXT DEFAULT \'{}\'';
    if (useSupabase) {
      await supabaseExec(alterSQL);
    } else {
      sqliteExec(alterSQL);
    }
    console.log('  ✓ kunder.custom_data added');
  } catch (e) {
    console.log('  - kunder.custom_data already exists (OK)');
  }

  // Step 5: Create indexes for performance
  console.log('Step 5: Creating indexes...');
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_org_fields_org ON organization_fields(organization_id)',
    'CREATE INDEX IF NOT EXISTS idx_org_field_options_field ON organization_field_options(field_id)',
    'CREATE INDEX IF NOT EXISTS idx_org_categories_org ON organization_categories(organization_id)'
  ];

  for (const indexSQL of indexes) {
    try {
      if (useSupabase) {
        await supabaseExec(indexSQL);
      } else {
        sqliteExec(indexSQL);
      }
    } catch (e) {
      // Index might already exist
    }
  }
  console.log('  ✓ Indexes created');

  // Step 6: Enable RLS for Supabase
  if (useSupabase) {
    console.log('Step 6: Enabling Row Level Security...');
    try {
      await supabaseExec('ALTER TABLE organization_fields ENABLE ROW LEVEL SECURITY');
      await supabaseExec('ALTER TABLE organization_field_options ENABLE ROW LEVEL SECURITY');
      await supabaseExec('ALTER TABLE organization_categories ENABLE ROW LEVEL SECURITY');
      console.log('  ✓ RLS enabled');
    } catch (e) {
      console.log('  - RLS already enabled (OK)');
    }
  }

  console.log('\n========================================');
  console.log('  Migration completed successfully!');
  console.log('========================================\n');

  console.log('New tables created:');
  console.log('  - organization_fields: Custom fields per organization');
  console.log('  - organization_field_options: Dropdown options for select fields');
  console.log('  - organization_categories: Dynamic categories per organization');
  console.log('  - kunder.custom_data: JSON storage for custom field values');
}

// Run migration
migrate().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
}).finally(() => {
  if (db) {
    db.close();
  }
});

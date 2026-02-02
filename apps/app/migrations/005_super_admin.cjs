/**
 * Migration: Super Admin Support
 *
 * This migration adds super admin functionality to allow
 * Efffekt staff to access all organizations' data.
 *
 * Run with: node migrations/005_super_admin.js
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
  console.log('  Super Admin Migration');
  console.log('========================================\n');

  await initDatabase();

  // Step 1: Add is_super_admin column to brukere table
  console.log('Step 1: Adding is_super_admin column to brukere table...');
  try {
    const alterSQL = 'ALTER TABLE brukere ADD COLUMN is_super_admin INTEGER DEFAULT 0';
    if (useSupabase) {
      await supabaseExec(alterSQL);
    } else {
      sqliteExec(alterSQL);
    }
    console.log('  ✓ brukere.is_super_admin added');
  } catch (e) {
    console.log('  - brukere.is_super_admin already exists (OK)');
  }

  // Step 2: Create index for super admin lookups
  console.log('Step 2: Creating index for super admin lookups...');
  try {
    const indexSQL = 'CREATE INDEX IF NOT EXISTS idx_brukere_super_admin ON brukere(is_super_admin)';
    if (useSupabase) {
      await supabaseExec(indexSQL);
    } else {
      sqliteExec(indexSQL);
    }
    console.log('  ✓ Index created');
  } catch (e) {
    console.log('  - Index already exists (OK)');
  }

  console.log('\n========================================');
  console.log('  Migration completed successfully!');
  console.log('========================================\n');

  console.log('Changes made:');
  console.log('  - brukere.is_super_admin: Boolean flag for super admin access');
  console.log('');
  console.log('To make a user a super admin, run:');
  console.log('  UPDATE brukere SET is_super_admin = 1 WHERE epost = \'your@email.com\'');
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

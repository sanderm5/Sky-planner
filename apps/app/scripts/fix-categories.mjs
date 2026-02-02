/**
 * Fix customer categories based on actual data
 *
 * This script analyzes each customer's data and sets the correct kategori:
 * - "El-Kontroll" - only has el-kontroll data
 * - "Brannvarsling" - only has brannvarsling data
 * - "El-Kontroll + Brannvarsling" - has both
 *
 * Usage:
 *   node scripts/fix-categories.mjs              # Dry-run (shows what would change)
 *   node scripts/fix-categories.mjs --update     # Actually update the database
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = !process.argv.includes('--update');

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Determine the correct category based on customer data
 * Only considers actual data fields, not default interval values
 */
function determineCategory(customer) {
  // Check for el-kontroll data (actual type or dates, not just interval which has default)
  const hasElData = Boolean(
    customer.el_type ||
    customer.siste_el_kontroll ||
    customer.neste_el_kontroll
  );

  // Check for brannvarsling data (actual system/type or dates)
  const hasBrannData = Boolean(
    customer.brann_system ||
    customer.brann_driftstype ||
    customer.siste_brann_kontroll ||
    customer.neste_brann_kontroll
  );

  if (hasElData && hasBrannData) {
    return 'El-Kontroll + Brannvarsling';
  } else if (hasBrannData) {
    return 'Brannvarsling';
  } else if (hasElData) {
    return 'El-Kontroll';
  } else {
    // No data at all - keep current or default to El-Kontroll
    return customer.kategori || 'El-Kontroll';
  }
}

async function fixCategories() {
  console.log('='.repeat(60));
  console.log('FIX CUSTOMER CATEGORIES');
  console.log('='.repeat(60));
  console.log(`\nModus: ${DRY_RUN ? 'DRY-RUN (ingen endringer)' : 'UPDATE'}\n`);

  // Fetch all customers
  const { data: customers, error } = await supabase
    .from('kunder')
    .select('id, navn, kategori, el_type, siste_el_kontroll, neste_el_kontroll, el_kontroll_intervall, brann_system, brann_driftstype, siste_brann_kontroll, neste_brann_kontroll');

  if (error) {
    console.error('Error fetching customers:', error);
    process.exit(1);
  }

  console.log(`Found ${customers.length} customers\n`);

  // Analyze and categorize
  const stats = {
    'El-Kontroll': { current: 0, new: 0 },
    'Brannvarsling': { current: 0, new: 0 },
    'El-Kontroll + Brannvarsling': { current: 0, new: 0 },
    'other': { current: 0, new: 0 }
  };

  const toUpdate = [];

  for (const customer of customers) {
    const currentKategori = customer.kategori || 'El-Kontroll';
    const correctKategori = determineCategory(customer);

    // Track current stats
    if (stats[currentKategori]) {
      stats[currentKategori].current++;
    } else {
      stats.other.current++;
    }

    // Track new stats
    stats[correctKategori].new++;

    // Check if update needed
    if (currentKategori !== correctKategori) {
      toUpdate.push({
        id: customer.id,
        navn: customer.navn,
        from: currentKategori,
        to: correctKategori
      });
    }
  }

  // Print statistics
  console.log('Current distribution:');
  console.log(`  El-Kontroll:                 ${stats['El-Kontroll'].current}`);
  console.log(`  Brannvarsling:               ${stats['Brannvarsling'].current}`);
  console.log(`  El-Kontroll + Brannvarsling: ${stats['El-Kontroll + Brannvarsling'].current}`);
  if (stats.other.current > 0) {
    console.log(`  Other:                       ${stats.other.current}`);
  }

  console.log('\nNew distribution (after fix):');
  console.log(`  El-Kontroll:                 ${stats['El-Kontroll'].new}`);
  console.log(`  Brannvarsling:               ${stats['Brannvarsling'].new}`);
  console.log(`  El-Kontroll + Brannvarsling: ${stats['El-Kontroll + Brannvarsling'].new}`);

  console.log(`\nCustomers to update: ${toUpdate.length}\n`);

  if (toUpdate.length === 0) {
    console.log('No changes needed!');
    return;
  }

  // Show changes (limit to first 20)
  console.log('Changes:');
  const showLimit = Math.min(toUpdate.length, 20);
  for (let i = 0; i < showLimit; i++) {
    const c = toUpdate[i];
    console.log(`  ${c.id}: "${c.navn}" - ${c.from} -> ${c.to}`);
  }
  if (toUpdate.length > showLimit) {
    console.log(`  ... and ${toUpdate.length - showLimit} more`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] No changes made. Run with --update to apply changes.');
    return;
  }

  // Apply updates
  console.log('\nApplying updates...');
  let updated = 0;
  let errors = 0;

  for (const c of toUpdate) {
    const { error } = await supabase
      .from('kunder')
      .update({ kategori: c.to })
      .eq('id', c.id);

    if (error) {
      console.error(`  Error updating ${c.id}:`, error.message);
      errors++;
    } else {
      updated++;
    }
  }

  console.log(`\nDone! Updated: ${updated}, Errors: ${errors}`);
}

fixCategories().catch(console.error);

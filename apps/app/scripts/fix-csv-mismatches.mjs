/**
 * Fix data mismatches between CSV and database for TRE Allservice
 * Based on verification report - CSV is the authoritative source
 *
 * Usage:
 *   node scripts/fix-csv-mismatches.mjs           # Dry-run (default)
 *   node scripts/fix-csv-mismatches.mjs --fix     # Apply fixes
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = !process.argv.includes('--fix');

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Fixes to apply based on verification report
const fixes = [
  {
    id: 411,
    name: 'Slettnes Maskindrift Frode Eide',
    updates: {
      brann_driftstype: 'Gartn'
    },
    reason: 'CSV has brann_driftstype="Gartn", DB has null'
  },
  {
    id: 419,
    name: 'Solvoll Gartneri May-Elin Hals',
    updates: {
      brann_driftstype: 'Gartn'
    },
    reason: 'CSV has brann_driftstype="Gartn", DB has null'
  },
  {
    id: 456,
    name: 'Johnsen Helge A',
    updates: {
      siste_el_kontroll: '2024-12-01',
      neste_el_kontroll: '2027-12-01',
      notater: 'Org.nr: 869716952'
    },
    reason: 'CSV has dates 2024-12/2027-12 (DB has 2024-11/2027-11), CSV has only org.nr in notater'
  },
  {
    id: 462,
    name: 'Lorentzen Gård',
    updates: {
      brann_driftstype: 'Sau'
    },
    reason: 'CSV has brann_driftstype="Sau", DB has null'
  },
  {
    id: 526,
    name: 'Draglands Planteskole',
    updates: {
      siste_el_kontroll: '2024-01-01',
      neste_el_kontroll: '2025-01-01'
    },
    reason: 'CSV has dates 2024-01/2025-01, DB has 2024-03/2025-03'
  }
];

async function applyFixes() {
  console.log('='.repeat(60));
  console.log('FIX CSV MISMATCHES - TRE Allservice');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no changes)' : 'APPLYING FIXES'}`);
  console.log(`Fixes to apply: ${fixes.length}`);
  console.log('');

  let success = 0;
  let failed = 0;

  for (const fix of fixes) {
    console.log(`\n[DB ID ${fix.id}] ${fix.name}`);
    console.log(`  Reason: ${fix.reason}`);
    console.log(`  Updates: ${JSON.stringify(fix.updates)}`);

    if (DRY_RUN) {
      console.log('  Status: WOULD UPDATE (dry-run)');
      success++;
      continue;
    }

    try {
      const { error } = await supabase
        .from('kunder')
        .update(fix.updates)
        .eq('id', fix.id);

      if (error) {
        console.log(`  Status: FAILED - ${error.message}`);
        failed++;
      } else {
        console.log('  Status: UPDATED');
        success++;
      }
    } catch (err) {
      console.log(`  Status: FAILED - ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);

  if (DRY_RUN) {
    console.log('\nTo apply fixes, run:');
    console.log('  node scripts/fix-csv-mismatches.mjs --fix');
  } else {
    console.log('\nRun verification to confirm:');
    console.log('  node scripts/verify-csv-import.mjs');
  }

  process.exit(failed > 0 ? 1 : 0);
}

applyFixes().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

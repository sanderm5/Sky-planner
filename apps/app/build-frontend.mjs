/**
 * Frontend build script - concatenates source modules into public/app.js
 *
 * Files are concatenated in the order listed below. All code shares global scope,
 * exactly like the original monolithic app.js.
 *
 * Usage:
 *   node build-frontend.mjs           # Build once
 *   node build-frontend.mjs --watch   # Watch for changes and rebuild
 */

import { readFileSync, writeFileSync, copyFileSync, watchFile, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source files in concatenation order.
// When extracting a module from app-legacy.js, add the new file here BEFORE app-legacy.js
const SOURCE_FILES = [
  // -- Extracted modules go here (in dependency order) --
  'frontend/modules/map-compat.js',
  'frontend/modules/cluster-manager.js',
  'frontend/modules/mapbox-matrix.js',
  'frontend/utils/escape.js',
  'frontend/utils/logger.js',
  'frontend/utils/csrf.js',
  'frontend/utils/focus-trap.js',
  'frontend/utils/modal.js',
  'frontend/constants/icons.js',
  'frontend/utils/theme.js',
  'frontend/utils/sorting.js',
  'frontend/services/feature-flags.js',
  'frontend/services/auth.js',
  'frontend/services/api.js',
  'frontend/services/subscription.js',
  'frontend/services/websocket.js',
  'frontend/modules/service-type-registry.js',
  'frontend/modules/smart-route-engine.js',
  'frontend/modules/chat.js',
  'frontend/modules/todays-work.js',
  'frontend/modules/onboarding-import.js',
  'frontend/modules/admin-fields.js',
  'frontend/modules/admin-tab.js',
  'frontend/modules/super-admin.js',
  'frontend/modules/mobile-ui.js',
  'frontend/modules/context-tips.js',
  'frontend/modules/markers.js',
  'frontend/modules/bulk-selection.js',
  'frontend/modules/geocoding.js',
  'frontend/modules/route-planning.js',
  'frontend/modules/email-dialog.js',
  'frontend/modules/overdue-warnings.js',
  'frontend/modules/weekplan.js',
  'frontend/modules/calendar.js',
  'frontend/modules/planner.js',
  'frontend/modules/inactivity.js',
  'frontend/modules/customer-details.js',
  'frontend/modules/control-dates.js',
  'frontend/modules/filter-panel.js',
  'frontend/modules/dashboard.js',
  'frontend/modules/map-core.js',
  'frontend/modules/spa-auth.js',
  'frontend/modules/industry.js',
  'frontend/modules/excel-import.js',
  'frontend/modules/weekplan-badges.js',
  'frontend/modules/ui-helpers.js',
  'frontend/modules/data-loading.js',
  'frontend/modules/filter-logic.js',
  'frontend/modules/context-menu.js',
  'frontend/modules/area-select.js',
  'frontend/modules/customer-form.js',
  'frontend/modules/customer-admin.js',
  'frontend/modules/proximity.js',

  // -- Legacy: global state + init + setupEventListeners --
  'frontend/app-legacy.js',
];

function buildFrontend() {
  const startTime = Date.now();

  const parts = SOURCE_FILES.map(file => {
    const fullPath = join(__dirname, file);
    const content = readFileSync(fullPath, 'utf8');
    return content;
  });

  const output = parts.join('\n\n');
  const outPath = join(__dirname, 'public/app.js');
  writeFileSync(outPath, output);

  const elapsed = Date.now() - startTime;
  const size = (statSync(outPath).size / 1024).toFixed(0);
  console.log(`✓ Built public/app.js (${size} KB) in ${elapsed}ms`);
}

// Copy shared theme CSS to public/
const themeSrc = join(__dirname, '../../packages/theme/polarnatt.css');
const themeDst = join(__dirname, 'public/polarnatt.css');
copyFileSync(themeSrc, themeDst);
console.log('✓ Copied polarnatt.css → public/');

// Build once
buildFrontend();

// Watch mode
if (process.argv.includes('--watch')) {
  console.log('Watching for changes...');
  for (const file of SOURCE_FILES) {
    const fullPath = join(__dirname, file);
    watchFile(fullPath, { interval: 500 }, () => {
      console.log(`Changed: ${file}`);
      buildFrontend();
    });
  }
}

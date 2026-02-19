// ========================================
// FEATURE MODULE SYSTEM
// Granular per-organization feature flags
// Replaces binary app_mode (mvp/full)
// ========================================

/**
 * Check if a specific feature module is enabled for this organization.
 * Features are loaded from the server config endpoint.
 */
function hasFeature(key) {
  return appConfig.enabledFeatures?.includes(key) ?? false;
}

/**
 * Get the configuration for a specific feature module.
 * Returns empty object if feature has no config or is not enabled.
 */
function getFeatureConfig(key) {
  return appConfig.featureConfigs?.[key] ?? {};
}

// Backwards-compatible helpers (used by existing code)
// These check enabledFeatures first, then fall back to legacy app_mode
function isFullMode() {
  // If features are loaded, check for industry-specific features
  if (appConfig.enabledFeatures && appConfig.enabledFeatures.length > 0) {
    return hasFeature('lifecycle_colors') || hasFeature('context_menu');
  }
  // Legacy fallback
  return appConfig.appMode === 'full' || localStorage.getItem('appMode') === 'full';
}

function isMvpMode() {
  return !isFullMode();
}

/**
 * Apply feature-based UI changes - hide/show elements based on enabled features.
 * Called after DOM is ready and on config changes.
 * Replaces the old binary MVP/full mode with granular feature checks.
 */
function applyMvpModeUI() {
  const isMvp = isMvpMode();

  // Elements to hide when industry-specific features are not enabled
  // Note: categoryFilterButtons is NOT hidden here — categories are shown for all companies
  const mvpHiddenElements = [
    document.getElementById('elTypeFilter'),
    document.getElementById('driftskategoriFilter'),
    document.getElementById('brannsystemFilter'),
    document.querySelector('.color-legend'),
    document.getElementById('dynamicFieldFilters'),
  ];

  mvpHiddenElements.forEach(el => {
    if (el) {
      el.style.display = isMvp ? 'none' : '';
    }
  });

  const filterHeader = document.querySelector('.filter-panel-header h3');
  if (filterHeader) {
    filterHeader.innerHTML = isMvp
      ? '<i class="fas fa-users"></i> Kunder'
      : '<i class="fas fa-filter"></i> Kunder';
  }

  Logger.log(`Feature mode UI applied: ${isMvp ? 'MVP (simplified)' : 'Full (features enabled)'}`);
  if (appConfig.enabledFeatures?.length) {
    Logger.log('Enabled features:', appConfig.enabledFeatures.join(', '));
  }
}

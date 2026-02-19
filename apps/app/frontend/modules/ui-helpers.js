// ===== UI HELPERS =====

// Update category tabs dynamically based on service types from config
function updateCategoryTabs() {
  if (!serviceTypeRegistry.initialized) return;

  const container = document.getElementById('kategoriTabs');
  if (!container) return;

  // Generate dynamic tabs
  container.innerHTML = serviceTypeRegistry.renderCategoryTabs(customerAdminKategori);

  Logger.log('Category tabs updated from service registry');
}

// Update badge visibility and count
function updateBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// Get the nearest upcoming control date for a customer (returns Date object)
function getNearestControlDate(customer) {
  const dates = [customer.neste_el_kontroll, customer.neste_brann_kontroll, customer.neste_kontroll]
    .filter(Boolean)
    .map(d => {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y, m - 1, day);
    });
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates));
}

// Load configuration from server
async function loadConfig() {
  try {
    // Use regular fetch for config - no auth required
    const response = await fetch('/api/config', { credentials: 'include' });
    if (!response.ok) throw new Error(`Config load failed: ${response.status}`);
    const configResponse = await response.json();
    appConfig = configResponse.data || configResponse;

    // Initialize service type registry from config
    serviceTypeRegistry.loadFromConfig(appConfig);

    // Check localStorage for saved industry (for login page display before auth)
    const savedIndustrySlug = localStorage.getItem('industrySlug');
    if (savedIndustrySlug) {
      try {
        await serviceTypeRegistry.loadFromIndustry(savedIndustrySlug);
        Logger.log('Loaded saved industry from localStorage:', savedIndustrySlug);
      } catch (e) {
        Logger.warn('Could not load saved industry:', e);
      }
    }

    // Update control section headers with dynamic service type names/icons
    updateControlSectionHeaders();

    // Render dynamic filter panel categories
    renderFilterPanelCategories();
    renderDriftskategoriFilter();

    // Apply MVP mode UI changes (hide industry-specific elements)
    applyMvpModeUI();

    Logger.log('Application configuration loaded:', appConfig);
    Logger.log('Route planning configured:', appConfig.orsApiKeyConfigured);
  } catch (error) {
    Logger.warn('Could not load configuration from server:', error);
    // Use defaults - requireAuth: true by default for safety
    appConfig = {
      appName: 'Sky Planner',
      companyName: '',
      companySubtitle: 'Kontroll. Oversikt. Alltid.',
      logoUrl: '/skyplanner-logo.svg',
      contactAddress: '',
      contactPhone: '',
      contactEmail: '',
      appYear: '2026',
      mapCenterLat: 65.5,
      mapCenterLng: 12.0,
      mapZoom: 5,
      mapClusterRadius: 80,
      enableRoutePlanning: true,
      showUpcomingWidget: true,
      upcomingControlDays: 30,
      defaultControlInterval: 12,
      controlIntervals: [6, 12, 24, 36],
      requireAuth: true
    };
  }
}

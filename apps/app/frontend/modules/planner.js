// Render planner - Smart Route Recommendations
function renderPlanner() {
  // Initialiser slider-lyttere og verdier
  initSmartRouteSettingsListeners();

  // Render anbefalinger
  renderSmartRecommendations();
}

// Create route for all customers in an area for a specific year
function createRouteForAreaYear(area, year) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get all customers in this area needing control in this year
  const areaCustomers = customers.filter(c => {
    if (!c.neste_kontroll) return false;
    const nextDate = new Date(c.neste_kontroll);
    return nextDate.getFullYear() === Number.parseInt(year) && (c.poststed === area);
  });

  if (areaCustomers.length === 0) {
    showMessage(`Ingen kunder i ${area} for ${year}`, 'info');
    return;
  }

  // Clear current selection and select all area customers
  selectedCustomers.clear();
  areaCustomers.forEach(c => {
    if (c.lat && c.lng) {
      selectedCustomers.add(c.id);
    }
  });

  updateSelectionUI();
  showNotification(`${areaCustomers.filter(c => c.lat && c.lng).length} kunder valgt for ${area} - ${year}. Bruk "Planlegg rute" for å beregne rute.`);

  // Zoom to area
  const areaData = areaCustomers.filter(c => c.lat && c.lng);
  if (areaData.length > 0) {
    const bounds = boundsFromCustomers(areaData);
    map.fitBounds(bounds, { padding: 50 });
  }
}

// Select all customers needing control
async function selectCustomersNeedingControl() {
  try {
    const response = await apiFetch('/api/kunder/kontroll-varsler?dager=30');
    const varselResult = await response.json();
    const varselKunder = varselResult.data || varselResult;

    selectedCustomers.clear();
    varselKunder.forEach(k => {
      if (k.lat && k.lng) {
        selectedCustomers.add(k.id);
      }
    });

    updateSelectionUI();

    if (selectedCustomers.size > 0) {
      // Zoom to selected customers
      const selectedData = customers.filter(c => selectedCustomers.has(c.id) && c.lat && c.lng);
      if (selectedData.length > 0) {
        const bounds = boundsFromCustomers(selectedData);
        map.fitBounds(bounds, { padding: 50 });
      }
    }
  } catch (error) {
    console.error('Feil ved henting av varsler:', error);
  }
}

// Check login and show user bar - redirect if not logged in
function checkLoginStatus() {
  // Check if auth is disabled via config (development mode)
  // Handle both boolean false and string "false"
  const authDisabled = appConfig.requireAuth === false || appConfig.requireAuth === 'false';
  Logger.log('checkLoginStatus: requireAuth =', appConfig.requireAuth, '-> authDisabled =', authDisabled);
  if (authDisabled) {
    // Auth disabled - allow access without login
    Logger.log('Auth disabled - bypassing login');
    const userBar = document.getElementById('userBar');
    if (userBar) userBar.style.display = 'none';
    return true;
  }

  // Auth is now cookie-based - check stored user info
  const navn = localStorage.getItem('userName');
  const rolle = localStorage.getItem('userRole');
  const userBar = document.getElementById('userBar');
  const userNameDisplay = document.getElementById('userNameDisplay');

  // If no stored user info, show SPA login overlay
  if (!navn) {
    showLoginView();
    return false;
  }

  // Multi-tenancy: Reload config with auth to get tenant-specific branding
  reloadConfigWithAuth();

  if (userBar) {
    userBar.style.display = 'flex';
    if (userNameDisplay) userNameDisplay.textContent = navn || 'Bruker';
  }

  // Hide email tab for non-admin users
  const emailTab = document.querySelector('.tab-item[data-tab="email"]');
  const isAdmin = rolle && rolle === 'admin';
  if (emailTab && !isAdmin) {
    emailTab.style.display = 'none';
  }

  return true;
}

// Logout function
function logoutUser(logoutAllDevices = false) {
  // Stop proactive token refresh
  stopTokenRefresh();

  // Send logout request (cookie-based auth, server clears cookie)
  const logoutHeaders = { 'Content-Type': 'application/json' };
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    logoutHeaders['X-CSRF-Token'] = csrfToken;
  }
  fetch('/api/klient/logout', {
    method: 'POST',
    headers: logoutHeaders,
    credentials: 'include',
    body: JSON.stringify({ logoutAll: logoutAllDevices })
  }).catch(() => {
    // Retry once after 1 second to ensure token is blacklisted
    setTimeout(() => {
      fetch('/api/klient/logout', {
        method: 'POST',
        headers: logoutHeaders,
        credentials: 'include',
        body: JSON.stringify({ logoutAll: logoutAllDevices })
      }).catch(err => console.error('Logout retry failed:', err));
    }, 1000);
  });

  // Clear UI-related localStorage (keep non-auth items)
  localStorage.removeItem('userName');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  localStorage.removeItem('isSuperAdmin');
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('impersonatingOrgName');
  // Multi-tenancy: Clear organization data
  localStorage.removeItem('organizationId');
  localStorage.removeItem('organizationSlug');
  localStorage.removeItem('organizationName');
  // Clear app mode and industry
  localStorage.removeItem('appMode');
  localStorage.removeItem('industrySlug');
  localStorage.removeItem('industryName');

  // Reset auth state
  authToken = null;

  // Stop inactivity tracking and dismiss any warning modal
  stopInactivityTracking();

  // Show login screen (SPA - no redirect)
  showLoginView();
}

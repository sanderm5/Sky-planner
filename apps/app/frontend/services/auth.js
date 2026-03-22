// ========================================
// AUTHENTICATION
// Logout, impersonation, session verification
// ========================================

/**
 * Check if current user has write permissions (redigerer or admin).
 * Returns false for leser role.
 */
function canEdit() {
  const role = localStorage.getItem('userRole') || 'leser';
  return role === 'admin' || role === 'teammedlem' || role === 'kontor';
}

/**
 * Check if current user is admin.
 */
function isAdmin() {
  const role = localStorage.getItem('userRole') || 'leser';
  return role === 'admin';
}

/**
 * Apply role-based UI classes to body.
 * Adds 'role-leser' when user is a reader (hides write UI via CSS).
 */
function applyRoleUI() {
  const role = localStorage.getItem('userRole') || 'leser';
  document.body.classList.remove('role-leser', 'role-redigerer', 'role-admin');
  document.body.classList.add(`role-${role}`);
}

// Handle logout (for SPA - shows login view without redirect)
function handleLogout() {
  // Stop proactive token refresh
  stopTokenRefresh();

  // Revoke session on server (cookie-based auth)
  const logoutHeaders = { 'Content-Type': 'application/json' };
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    logoutHeaders['X-CSRF-Token'] = csrfToken;
  }
  fetch('/api/klient/logout', {
    method: 'POST',
    headers: logoutHeaders,
    credentials: 'include'
  }).catch(err => console.error('Logout request failed:', err));

  authToken = null;
  isSuperAdmin = false;
  appInitialized = false;
  localStorage.removeItem('userName');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  localStorage.removeItem('isSuperAdmin');
  // Multi-tenancy: Clear organization data
  localStorage.removeItem('organizationId');
  localStorage.removeItem('organizationSlug');
  localStorage.removeItem('organizationName');
  // Clear app mode and industry (prevents stale settings on next login)
  localStorage.removeItem('appMode');
  localStorage.removeItem('industrySlug');
  localStorage.removeItem('industryName');
  // Clear impersonation data
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('impersonatingOrgId');
  localStorage.removeItem('impersonatingOrgName');
  // Reset appConfig to default
  appConfig.appMode = 'mvp';
  // Clear address/location so next login doesn't inherit previous org's data
  appConfig.routeStartLat = undefined;
  appConfig.routeStartLng = undefined;
  appConfig.routeStartAddress = undefined;

  // =====================================================
  // CRITICAL: Clear ALL in-memory data to prevent leaking
  // customer/organization data between different logins
  // =====================================================

  // Hide support widget
  const supportWidget = document.getElementById('supportWidget');
  if (supportWidget) supportWidget.style.display = 'none';
  const supportPanel = document.getElementById('supportWidgetPanel');
  if (supportPanel) supportPanel.style.display = 'none';

  // Clear customer data and map markers
  customers = [];
  selectedCustomers.clear();
  routeMarkers = [];
  avtaler = [];
  omrader = [];

  // Clear filter state
  currentFilter = 'alle';
  showOnlyWarnings = false;
  selectedCategory = 'all';
  selectedSubcategories = {};
  dynamicFieldFilters = {};
  if (filterAbortController) {
    filterAbortController.abort();
    filterAbortController = null;
  }

  // Clear organization-specific data
  organizationFields = [];
  organizationCategories = [];
  kundeSubcatMap = {};
  allSubcategoryGroups = [];
  teamMembersData = [];
  subscriptionInfo = null;
  accessTokenExpiresAt = null;

  // Clear calendar state
  currentCalendarMonth = new Date().getMonth();
  currentCalendarYear = new Date().getFullYear();
  calendarViewMode = 'month';
  currentWeekStart = null;

  // Clear weekplan state
  if (typeof weekPlanState !== 'undefined') {
    weekPlanState.days = {};
    weekPlanState.activeDay = null;
    weekPlanState.globalAssignedTo = '';
  }
  if (typeof wpTeamMembers !== 'undefined') wpTeamMembers = null;

  // Clear cluster data
  if (typeof clusterGeoJSONFeatures !== 'undefined') clusterGeoJSONFeatures = [];
  if (typeof _clusterSourceReady !== 'undefined') _clusterSourceReady = false;
  if (typeof clusterMarkers !== 'undefined') clusterMarkers.clear();

  // Close WebSocket connection (prevents data from previous session leaking via real-time updates)
  if (ws && ws.readyState <= 1) {
    ws.close();
  }
  ws = null;
  wsInitialized = false;
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  wsReconnectAttempts = 0;
  presenceClaims.clear();
  currentClaimedKundeId = null;
  myUserId = null;
  myInitials = null;

  // Clear route planning data
  if (typeof currentRouteData !== 'undefined') currentRouteData = null;

  // Remove office marker and address nudges from the map
  removeOfficeMarker();
  removeAddressNudge();
  const adminBadge = document.getElementById('adminAddressBadge');
  if (adminBadge) adminBadge.style.display = 'none';

  // Clear onboarding dismissals for next login
  sessionStorage.removeItem('addressBannerDismissed');
  sessionStorage.removeItem('inlineAddressDismissed');

  // Clean up onboarding UI
  if (typeof hideOnboardingChecklist === 'function') hideOnboardingChecklist();
  if (typeof removeInlineAddressCard === 'function') removeInlineAddressCard();
  localStorage.removeItem('skyplanner_checklistMinimized');

  showLoginView();
}

// Stop impersonation and return to admin panel (for super-admins)
async function stopImpersonation() {
  try {
    const stopImpHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      stopImpHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/super-admin/stop-impersonation', {
      method: 'POST',
      headers: stopImpHeaders,
      credentials: 'include'
    });

    if (!response.ok) {
      showNotification('Kunne ikke stoppe representasjon', 'error');
      return;
    }

    const data = await response.json();

    if (data.success) {
      // Clear impersonation data
      localStorage.removeItem('isImpersonating');
      localStorage.removeItem('impersonatingOrgId');
      localStorage.removeItem('impersonatingOrgName');

      // Redirect to admin panel
      window.location.href = '/admin';
    } else {
      console.error('Failed to stop impersonation:', data.error);
      alert('Kunne ikke avslutte impersonering');
    }
  } catch (error) {
    console.error('Error stopping impersonation:', error);
    alert('Kunne ikke avslutte impersonering');
  }
}

// Check if user is already logged in (supports both localStorage token and SSO cookie)
async function checkExistingAuth() {
  // First, try SSO verification (checks both Bearer token and SSO cookie)
  try {
    const response = await fetch('/api/klient/verify', {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();

      if (data.success && data.data && data.data.valid) {
        // SSO session found or token is valid
        const { token, user, organization } = data.data;

        // Keep token in memory (cookie is the primary auth mechanism)
        if (token) {
          authToken = token;
        }

        // Update user info
        if (user) {
          localStorage.setItem('userName', user.navn || 'Bruker');
          localStorage.setItem('userEmail', user.epost || '');
          localStorage.setItem('userType', user.type || 'klient');
          localStorage.setItem('userRole', user.rolle || (user.type === 'bruker' ? 'admin' : 'leser'));
          // Store super admin flag
          if (user.isSuperAdmin) {
            localStorage.setItem('isSuperAdmin', 'true');
          } else {
            localStorage.removeItem('isSuperAdmin');
          }
        }

        // Update organization branding and persist org data
        if (organization) {
          // Store organization data to localStorage (needed for reloadConfigWithAuth)
          localStorage.setItem('organizationId', organization.id);
          localStorage.setItem('organizationSlug', organization.slug);

          appConfig.companyName = organization.navn;
          appConfig.logoUrl = organization.logoUrl;
          appConfig.primaryColor = organization.primaryColor;
          appConfig.brandTitle = organization.brandTitle || organization.navn;
          // App mode: 'mvp' = enkel versjon, 'full' = komplett (TRE Allservice)
          appConfig.appMode = organization.appMode || 'mvp';
          localStorage.setItem('appMode', appConfig.appMode);

          // Store subscription info for timer
          subscriptionInfo = {
            status: organization.subscriptionStatus,
            trialEndsAt: organization.trialEndsAt,
            planType: organization.planType
          };

          // Load full tenant config (includes industry/service types) and apply branding
          await reloadConfigWithAuth();
        }

        // Apply role-based UI restrictions
        applyRoleUI();

        Logger.log('SSO session verified successfully');
        return true;
      }
    }
  } catch (error) {
    Logger.warn('SSO verification failed:', error);
  }

  // Fallback: try existing localStorage token with dashboard endpoint
  if (authToken) {
    try {
      const response = await fetch('/api/klient/dashboard', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.klient) {
          localStorage.setItem('userName', data.klient.navn || 'Bruker');
          localStorage.setItem('userRole', data.klient.rolle || 'leser');
          localStorage.setItem('userType', data.klient.type || 'klient');
        }
        applyRoleUI();
        return true;
      }
    } catch (error) {
      // Token verification failed
    }
  }

  // No valid session found - clear any stale data
  authToken = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('userName');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  return false;
}

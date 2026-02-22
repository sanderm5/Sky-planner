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
  return role === 'admin' || role === 'redigerer';
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

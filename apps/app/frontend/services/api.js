// ========================================
// API CLIENT
// Token refresh and authenticated fetch
// ========================================

// Helper function to make authenticated API calls
// Token refresh state to prevent multiple simultaneous refresh attempts
let refreshPromise = null;

// Check if access token is expiring soon (within 2 minutes)
function isAccessTokenExpiringSoon() {
  if (!accessTokenExpiresAt) return false;

  const expiryTime = typeof accessTokenExpiresAt === 'number' ? accessTokenExpiresAt : parseInt(accessTokenExpiresAt, 10);
  const bufferTime = 2 * 60 * 1000; // 2 minutes before expiry
  return Date.now() > (expiryTime - bufferTime);
}

// Refresh the access token using refresh token
async function refreshAccessToken() {
  // If already refreshing, reuse the existing promise (prevents race condition)
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const refreshHeaders = { 'Content-Type': 'application/json' };
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        refreshHeaders['X-CSRF-Token'] = csrfToken;
      }
      const response = await fetch('/api/klient/refresh', {
        method: 'POST',
        headers: refreshHeaders,
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();

        // Tokens are managed via httpOnly cookies
        authToken = data.accessToken || data.token;

        Logger.log('Access token refreshed successfully');
        return true;
      } else {
        // Refresh failed - clear tokens and redirect to login
        Logger.warn('Token refresh failed:', response.status);
        return false;
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Proactive token refresh - runs in background to prevent session expiry during idle
let tokenRefreshInterval = null;

function setupTokenRefresh() {
  // Clear any existing interval
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }

  // Check every minute for token expiry
  tokenRefreshInterval = setInterval(async () => {
    if (!accessTokenExpiresAt) return;

    const expiryTime = typeof accessTokenExpiresAt === 'number' ? accessTokenExpiresAt : parseInt(accessTokenExpiresAt, 10);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    // Refresh 5 minutes before expiry
    if (expiryTime - now < fiveMinutes && expiryTime > now) {
      Logger.log('Proactive token refresh triggered');
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Reload config to ensure we have fresh tenant data
        await reloadConfigWithAuth();
        Logger.log('Config reloaded after token refresh');
      } else {
        // Refresh failed - don't force logout, let next API call handle it
        Logger.warn('Proactive token refresh failed');
      }
    }
  }, 60000); // Check every minute

  Logger.log('Token refresh interval started');
}

function stopTokenRefresh() {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = null;
    Logger.log('Token refresh interval stopped');
  }
}

async function apiFetch(url, options = {}) {
  // Check if token needs refresh before making request
  if (authToken && isAccessTokenExpiringSoon()) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      // Refresh failed - redirect to login
      handleLogout();
      throw new Error('Sesjon utløpt');
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  // Add CSRF token for state-changing methods
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  const response = await fetch(url, { ...options, headers, credentials: 'include' });

  // Handle 401 - try to refresh token once, then logout if still failing
  if (response.status === 401) {
    const data = await response.json().catch(() => ({}));

    // Try to refresh token and retry the request
    if (authToken && !options._retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry the original request with new token
        return apiFetch(url, { ...options, _retried: true });
      }
    }

    if (data.requireLogin || data.error === 'Sesjonen har utløpt') {
      handleLogout();
      throw new Error('Ikke innlogget');
    }
  }

  // Handle 403 with subscription error - show modal and redirect
  if (response.status === 403) {
    const data = await response.clone().json().catch(() => ({}));

    if (data.code === 'SUBSCRIPTION_INACTIVE') {
      showSubscriptionError(data);
      throw new Error(data.error || 'Abonnementet er ikke aktivt');
    }
  }

  // Handle 503 maintenance mode (full block)
  if (response.status === 503) {
    const data = await response.clone().json().catch(() => ({}));
    if (data.error && data.error.code === 'MAINTENANCE') {
      showMaintenanceOverlay(data.error.message);
      throw new Error(data.error.message || 'Vedlikehold pågår');
    }
  }

  // Check for maintenance banner header (banner mode — app still works)
  const maintenanceHeader = response.headers.get('X-Maintenance');
  if (maintenanceHeader === 'banner') {
    const msg = response.headers.get('X-Maintenance-Message');
    showMaintenanceBanner(msg ? decodeURIComponent(msg) : 'Vedlikehold pågår');
  } else {
    hideMaintenanceBanner();
  }

  // Check for subscription warning header (grace period / trial ending soon)
  const subscriptionWarning = response.headers.get('X-Subscription-Warning');
  if (subscriptionWarning) {
    showSubscriptionWarningBanner(subscriptionWarning);
  }

  return response;
}

// Maintenance banner (yellow bar at top — app still usable)
let maintenanceBannerEl = null;

function showMaintenanceBanner(message) {
  if (maintenanceBannerEl) {
    maintenanceBannerEl.querySelector('.maintenance-banner-text').textContent = message;
    return;
  }

  maintenanceBannerEl = document.createElement('div');
  maintenanceBannerEl.id = 'maintenance-banner';
  maintenanceBannerEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:#f59e0b;color:#1a1a1a;text-align:center;padding:8px 16px;font-size:14px;font-weight:500;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
  maintenanceBannerEl.innerHTML = '<span class="maintenance-banner-text">' + escapeHtml(message) + '</span>';
  document.body.appendChild(maintenanceBannerEl);
}

function hideMaintenanceBanner() {
  if (maintenanceBannerEl) {
    maintenanceBannerEl.remove();
    maintenanceBannerEl = null;
  }
}

// Maintenance overlay (full screen block — app unusable)
let maintenanceOverlayEl = null;
let maintenancePollInterval = null;

function showMaintenanceOverlay(message) {
  if (maintenanceOverlayEl) return; // Already showing

  maintenanceOverlayEl = document.createElement('div');
  maintenanceOverlayEl.id = 'maintenance-overlay';
  maintenanceOverlayEl.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#0A0E16;display:flex;align-items:center;justify-content:center;';
  maintenanceOverlayEl.innerHTML = '<div style="text-align:center;padding:2rem;max-width:480px;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">'
    + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64" style="margin:0 auto 1.5rem;display:block;"><defs><linearGradient id="mg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#6366f1"/><stop offset="100%" style="stop-color:#a855f7"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#mg)"/><rect x="5" y="18" width="5" height="10" rx="1" fill="white" opacity="0.5"/><rect x="13" y="12" width="5" height="16" rx="1" fill="white" opacity="0.75"/><rect x="21" y="6" width="5" height="22" rx="1" fill="white"/><path d="M6 16L15 9L24 4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3"/></svg>'
    + '<h1 style="font-size:1.5rem;font-weight:600;margin-bottom:0.75rem;color:#fff;">Vedlikehold pågår</h1>'
    + '<p style="color:#94a3b8;font-size:1rem;line-height:1.6;margin-bottom:2rem;">' + escapeHtml(message) + '</p>'
    + '<div style="width:32px;height:32px;border:3px solid rgba(99,102,241,0.2);border-top-color:#6366f1;border-radius:50%;animation:mtspin 1s linear infinite;margin:0 auto 1rem;"></div>'
    + '<p style="color:#64748b;font-size:0.8rem;">Siden sjekker automatisk om vi er tilbake...</p>'
    + '</div>'
    + '<style>@keyframes mtspin{to{transform:rotate(360deg)}}</style>';
  document.body.appendChild(maintenanceOverlayEl);

  // Poll for maintenance end
  maintenancePollInterval = setInterval(function() {
    fetch('/api/maintenance/status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.maintenance || data.mode !== 'full') {
          clearInterval(maintenancePollInterval);
          maintenancePollInterval = null;
          if (maintenanceOverlayEl) {
            maintenanceOverlayEl.remove();
            maintenanceOverlayEl = null;
          }
          window.location.reload();
        }
      })
      .catch(function() {});
  }, 30000);
}

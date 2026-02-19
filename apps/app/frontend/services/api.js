// ========================================
// API CLIENT
// Token refresh and authenticated fetch
// ========================================

// Helper function to make authenticated API calls
// Token refresh state to prevent multiple simultaneous refresh attempts
let isRefreshingToken = false;
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
  // If already refreshing, wait for that promise
  if (isRefreshingToken && refreshPromise) {
    return refreshPromise;
  }

  isRefreshingToken = true;
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
      isRefreshingToken = false;
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

  // Check for subscription warning header (grace period / trial ending soon)
  const subscriptionWarning = response.headers.get('X-Subscription-Warning');
  if (subscriptionWarning) {
    showSubscriptionWarningBanner(subscriptionWarning);
  }

  return response;
}

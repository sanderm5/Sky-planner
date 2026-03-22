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
        if (data.expiresAt) {
          accessTokenExpiresAt = data.expiresAt;
        }

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
      showMaintenanceOverlay(data.error.message, data.error.startedAt, data.error.estimatedEnd);
      throw new Error(data.error.message || 'Vedlikehold pågår');
    }
  }

  // Maintenance banner + broadcast banner managed by background poller only (avoids flickering)

  // Check for subscription warning header (grace period / trial ending soon)
  const subscriptionWarning = response.headers.get('X-Subscription-Warning');
  if (subscriptionWarning) {
    showSubscriptionWarningBanner(subscriptionWarning);
  }

  return response;
}

// Maintenance timer helper
let maintenanceTimerInterval = null;
let maintenanceStartedAtISO = null;

function formatMaintenanceDuration(startedAt) {
  if (!startedAt) return null;
  var elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (elapsed < 0) elapsed = 0;
  var h = Math.floor(elapsed / 3600);
  var m = Math.floor((elapsed % 3600) / 60);
  var s = elapsed % 60;
  if (h > 0) return h + 't ' + (m < 10 ? '0' : '') + m + 'm ' + (s < 10 ? '0' : '') + s + 's';
  if (m > 0) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
  return s + 's';
}

function formatMaintenanceStartedTime(startedAt) {
  if (!startedAt) return '';
  var d = new Date(startedAt);
  var hh = String(d.getHours()).padStart(2, '0');
  var mm = String(d.getMinutes()).padStart(2, '0');
  return 'Startet kl. ' + hh + ':' + mm;
}

function updateMaintenanceTimers() {
  if (!maintenanceStartedAtISO) return;
  var text = formatMaintenanceDuration(maintenanceStartedAtISO);
  if (!text) return;
  // Update banner timer (in parentheses)
  var bannerTimer = document.getElementById('maintenance-banner-timer');
  if (bannerTimer) bannerTimer.textContent = '(' + text + ')';
  // Update overlay timer
  var overlayTimer = document.getElementById('maintenance-overlay-timer');
  if (overlayTimer) overlayTimer.textContent = text;
}

function startMaintenanceTimer(startedAt) {
  maintenanceStartedAtISO = startedAt;
  if (maintenanceTimerInterval) clearInterval(maintenanceTimerInterval);
  updateMaintenanceTimers();
  maintenanceTimerInterval = setInterval(updateMaintenanceTimers, 1000);
}

function stopMaintenanceTimer() {
  maintenanceStartedAtISO = null;
  if (maintenanceTimerInterval) {
    clearInterval(maintenanceTimerInterval);
    maintenanceTimerInterval = null;
  }
}

// Maintenance banner (yellow bar at top — app still usable)
let maintenanceBannerEl = null;

function showMaintenanceBanner(message, startedAt, estimatedEnd) {
  if (maintenanceBannerEl) {
    maintenanceBannerEl.querySelector('.maintenance-banner-text').textContent = message;
    var estEl = maintenanceBannerEl.querySelector('.maintenance-banner-est');
    if (estEl) estEl.textContent = estimatedEnd ? ' \u2014 Ferdig kl. ' + estimatedEnd : '';
    if (startedAt) startMaintenanceTimer(startedAt);
    return;
  }

  var timerText = startedAt ? formatMaintenanceDuration(startedAt) : '';
  var startedText = startedAt ? formatMaintenanceStartedTime(startedAt) : '';
  var estHtml = '<span class="maintenance-banner-est" style="opacity:0.7;margin-left:6px;font-weight:500;">' + (estimatedEnd ? ' \u2014 Ferdig kl. ' + escapeHtml(estimatedEnd) : '') + '</span>';
  var timerHtml = (startedText ? '<span style="opacity:0.7;margin-left:6px;font-weight:500;">' + startedText + '</span>' : '')
    + '<span id="maintenance-banner-timer" style="opacity:0.8;font-variant-numeric:tabular-nums;margin-left:6px;">' + (timerText ? '(' + timerText + ')' : '') + '</span>'
    + estHtml;

  var isMobile = window.innerWidth <= 768;
  maintenanceBannerEl = document.createElement('div');
  maintenanceBannerEl.id = 'maintenance-banner';
  if (isMobile) {
    maintenanceBannerEl.style.cssText = 'position:relative;z-index:999999;background:#f59e0b;color:#1a1a1a;padding:8px 12px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;text-align:center;';
    maintenanceBannerEl.innerHTML = '<i class="fas fa-tools" style="font-size:11px;flex-shrink:0;"></i><span class="maintenance-banner-text">' + escapeHtml(message) + '</span>' + timerHtml;
    var mfView = document.getElementById('mobileFieldView');
    if (mfView) {
      mfView.insertBefore(maintenanceBannerEl, mfView.firstChild);
    } else {
      document.body.insertBefore(maintenanceBannerEl, document.body.firstChild);
    }
  } else {
    maintenanceBannerEl.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:600px;z-index:999999;background:#f59e0b;color:#1a1a1a;padding:10px 16px;font-size:13px;font-weight:600;border-radius:10px;box-shadow:0 4px 20px rgba(245,158,11,0.4);display:flex;align-items:center;gap:8px;';
    maintenanceBannerEl.innerHTML = '<i class="fas fa-tools" style="font-size:14px;flex-shrink:0;"></i><span class="maintenance-banner-text">' + escapeHtml(message) + '</span>' + timerHtml;
    document.body.appendChild(maintenanceBannerEl);
  }

  if (startedAt) startMaintenanceTimer(startedAt);
}

function hideMaintenanceBanner() {
  if (maintenanceBannerEl) {
    maintenanceBannerEl.remove();
    maintenanceBannerEl = null;
    stopMaintenanceTimer();
  }
}

// System broadcast banner (blue bar — from superadmin)
let broadcastBannerEl = null;

function showBroadcastBanner(message) {
  if (broadcastBannerEl) {
    broadcastBannerEl.querySelector('.broadcast-banner-text').textContent = message;
    return;
  }

  var isMobile = window.innerWidth <= 768;
  broadcastBannerEl = document.createElement('div');
  broadcastBannerEl.id = 'broadcast-banner';
  if (isMobile) {
    // Mobile: static bar at top of body, pushes content down
    broadcastBannerEl.style.cssText = 'position:relative;z-index:999999;background:#6366f1;color:#fff;padding:8px 12px;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:6px;text-align:center;';
    broadcastBannerEl.innerHTML = '<i class="fas fa-bullhorn" style="font-size:11px;flex-shrink:0;"></i> <span class="broadcast-banner-text">' + escapeHtml(message) + '</span>';
    // Insert at very top of mobile view
    var mfView = document.getElementById('mobileFieldView');
    if (mfView) {
      mfView.insertBefore(broadcastBannerEl, mfView.firstChild);
    } else {
      document.body.insertBefore(broadcastBannerEl, document.body.firstChild);
    }
  } else {
    // Desktop: floating pill at bottom center
    broadcastBannerEl.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:600px;z-index:999999;background:#6366f1;color:#fff;padding:10px 16px;font-size:13px;font-weight:500;border-radius:10px;box-shadow:0 4px 20px rgba(99,102,241,0.4);display:flex;align-items:center;gap:8px;';
    broadcastBannerEl.innerHTML = '<i class="fas fa-bullhorn" style="font-size:14px;flex-shrink:0;"></i> <span class="broadcast-banner-text">' + escapeHtml(message) + '</span>';
    document.body.appendChild(broadcastBannerEl);
  }
}

function hideBroadcastBanner() {
  if (broadcastBannerEl) {
    broadcastBannerEl.remove();
    broadcastBannerEl = null;
  }
}

// Maintenance overlay (full screen block — app unusable)
let maintenanceOverlayEl = null;
let maintenancePollInterval = null;

function updateMaintenanceOverlayContent(message, estimatedEnd) {
  if (!maintenanceOverlayEl) return;
  var msgEl = maintenanceOverlayEl.querySelector('#maintenance-overlay-message');
  if (msgEl) msgEl.textContent = message;
  var estEl = maintenanceOverlayEl.querySelector('#maintenance-overlay-est');
  if (estEl) {
    if (estimatedEnd) {
      estEl.textContent = 'Forventet ferdig kl. ' + estimatedEnd;
      estEl.style.display = '';
    } else {
      estEl.textContent = '';
      estEl.style.display = 'none';
    }
  }
}

function showMaintenanceOverlay(message, startedAt, estimatedEnd) {
  if (maintenanceOverlayEl) {
    updateMaintenanceOverlayContent(message, estimatedEnd);
    return;
  }
  // Hide broadcast banner — maintenance takes priority
  hideBroadcastBanner();

  var timerText = startedAt ? formatMaintenanceDuration(startedAt) : '';

  maintenanceOverlayEl = document.createElement('div');
  maintenanceOverlayEl.id = 'maintenance-overlay';
  maintenanceOverlayEl.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(10,14,22,0.8);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;overflow-y:auto;-webkit-overflow-scrolling:touch;';
  maintenanceOverlayEl.innerHTML = ''
    // Logo + dashboard link top-right
    + '<a href="https://skyplanner.no/dashboard" style="position:absolute;top:20px;left:50%;transform:translateX(-50%);z-index:2;display:flex;align-items:center;gap:10px;text-decoration:none;color:#e2e8f0;opacity:0.7;transition:opacity 0.2s;" onmouseenter="this.style.opacity=\'1\'" onmouseleave="this.style.opacity=\'0.7\'">'
    + '  <img src="/skyplanner-logo.svg" alt="Sky Planner" style="width:28px;height:28px;">'
    + '  <span style="font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">Sky Planner</span>'
    + '</a>'
    // Content
    + '<div style="text-align:center;padding:2rem;max-width:480px;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;position:relative;z-index:1;">'
    + '  <h1 style="font-size:1.5rem;font-weight:600;margin-bottom:0.75rem;">Vedlikehold pågår</h1>'
    + '  <p id="maintenance-overlay-message" style="color:#94a3b8;font-size:1rem;line-height:1.6;margin-bottom:1rem;">' + escapeHtml(message) + '</p>'
    + (startedAt ? '  <p style="color:#64748b;font-size:0.8rem;margin-bottom:0.25rem;">' + formatMaintenanceStartedTime(startedAt) + '</p>' : '')
    + '  <p id="maintenance-overlay-est" style="color:#4ade80;font-size:0.9rem;font-weight:600;margin-bottom:0.5rem;' + (estimatedEnd ? '' : 'display:none;') + '">' + (estimatedEnd ? 'Forventet ferdig kl. ' + escapeHtml(estimatedEnd) : '') + '</p>'
    + '  <div id="maintenance-overlay-timer" style="color:#a5b4fc;font-size:1.5rem;font-weight:700;font-variant-numeric:tabular-nums;margin-bottom:1.5rem;letter-spacing:0.05em;">' + (timerText || '') + '</div>'
    + '  <div style="width:32px;height:32px;border:3px solid rgba(99,102,241,0.2);border-top-color:#6366f1;border-radius:50%;animation:mtspin 1s linear infinite;margin:0 auto 1rem;"></div>'
    + '  <p style="color:#64748b;font-size:0.8rem;">Siden sjekker automatisk om vi er tilbake...</p>'
    + '  <button id="maintenance-game-btn" data-action="startMaintenanceGame" style="margin-top:1.5rem;padding:10px 24px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:10px;color:#a5b4fc;font-size:0.9rem;font-weight:500;cursor:pointer;-webkit-tap-highlight-color:transparent;">Spill mens du venter?</button>'
    + '  <div id="maintenance-game-container" style="margin-top:1rem;"></div>'
    + '  <a href="/superlogin" style="display:inline-block;margin-top:1.5rem;color:rgba(255,255,255,0.06);font-size:0.6rem;text-decoration:none;" onmouseenter="this.style.color=\'rgba(255,255,255,0.2)\'" onmouseleave="this.style.color=\'rgba(255,255,255,0.06)\'">Admin</a>'
    + '</div>'
    + '<style>@keyframes mtspin{to{transform:rotate(360deg)}}</style>';

  if (startedAt) startMaintenanceTimer(startedAt);

  // Hide login and app UI — keep only the map visible behind overlay
  var loginOverlay = document.getElementById('loginOverlay');
  if (loginOverlay) loginOverlay.style.display = 'none';
  var appView = document.getElementById('appView');
  if (appView) appView.style.display = 'none';
  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = 'none';
  var filterPanel = document.getElementById('filterPanel');
  if (filterPanel) filterPanel.style.display = 'none';
  var userBar = document.getElementById('userBar');
  if (userBar) userBar.style.display = 'none';

  // Zoom map out to globe view centered on screen and start spinning
  if (typeof map !== 'undefined' && map) {
    try {
      map.resize();
      map.jumpTo({ center: [15.0, 65.0], zoom: 3.0, pitch: 20, bearing: 0 });
      if (typeof setMapInteractive === 'function') setMapInteractive(false);
      if (typeof startGlobeSpin === 'function') startGlobeSpin();
    } catch(e) {}
  }
  document.body.appendChild(maintenanceOverlayEl);

  // Poll for maintenance end (every 5s)
  maintenancePollInterval = setInterval(function() {
    fetch('/api/maintenance/status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.maintenance || data.mode !== 'full') {
          clearInterval(maintenancePollInterval);
          maintenancePollInterval = null;
          startMaintenanceCountdown();
        }
      })
      .catch(function() {});
  }, 5000);
}

function startMaintenanceCountdown() {
  if (!maintenanceOverlayEl) return;
  stopMaintenanceTimer();
  if (typeof destroyMaintenanceGame === 'function') destroyMaintenanceGame();
  var seconds = 10;
  // Replace spinner and auto-refresh text with countdown
  maintenanceOverlayEl.querySelector('h1').textContent = 'Vi er tilbake!';
  maintenanceOverlayEl.querySelector('h1').style.color = '#4ade80';
  var msgEl = maintenanceOverlayEl.querySelector('p');
  if (msgEl) msgEl.textContent = 'Vedlikeholdet er ferdig.';
  // Find spinner and replace with countdown
  var spinner = maintenanceOverlayEl.querySelector('[style*="animation"]');
  if (spinner) {
    spinner.style.cssText = 'width:64px;height:64px;border-radius:50%;background:rgba(99,102,241,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-size:1.5rem;font-weight:700;color:#6366f1;';
    spinner.textContent = seconds;
  }
  var autoRefreshEl = maintenanceOverlayEl.querySelectorAll('p');
  var lastP = autoRefreshEl[autoRefreshEl.length - 1];
  if (lastP) lastP.textContent = 'Laster inn på nytt om ' + seconds + ' sekunder...';

  var countdownInterval = setInterval(function() {
    seconds--;
    if (spinner) spinner.textContent = seconds;
    if (lastP) lastP.textContent = 'Laster inn på nytt om ' + seconds + ' sekunder...';
    if (seconds <= 0) {
      clearInterval(countdownInterval);
      if (maintenanceOverlayEl) {
        maintenanceOverlayEl.remove();
        maintenanceOverlayEl = null;
      }
      window.location.reload();
    }
  }, 1000);
}

// Background poller: check maintenance status every 15s
// Shows overlay even if user is idle (no API calls triggering 503)
(function startMaintenancePoller() {
  function checkMaintenanceAndBroadcast() {
    if (window.location.pathname.startsWith('/admin')) return;

    fetch('/api/maintenance/status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // Maintenance: full overlay or banner
        if (data.maintenance && data.mode === 'full') {
          showMaintenanceOverlay(data.message || 'Vedlikehold pågår', data.startedAt, data.estimatedEnd);
        } else if (data.maintenance && data.mode === 'banner') {
          showMaintenanceBanner(data.message || 'Vedlikehold pågår', data.startedAt, data.estimatedEnd);
        } else if (!data.maintenance) {
          hideMaintenanceBanner();
        }

        // Broadcast banner (hide if maintenance active)
        if (data.broadcast && !maintenanceBannerEl && !maintenanceOverlayEl) {
          showBroadcastBanner(data.broadcast);
        } else if (!data.broadcast || maintenanceBannerEl || maintenanceOverlayEl) {
          hideBroadcastBanner();
        }
      })
      .catch(function() {});
  }

  // Check immediately on load
  setTimeout(checkMaintenanceAndBroadcast, 2000);
  // Then every 5 seconds
  setInterval(checkMaintenanceAndBroadcast, 5000);
})();

// ============================================
// MOBILE FIELD VIEW — Dedicated mobile experience
// Replaces the full desktop app on mobile devices.
// Focused on: today's route, visit logging, navigation.
// ============================================

let mfCurrentDate = new Date().toISOString().split('T')[0];
let mfRouteData = null;
let mfActiveTab = 'ukeplan'; // 'ukeplan' | 'map' | 'account'
let mfMapInitialized = false;

// ---- Detection & activation ----

function isMobileDevice() {
  // Catch phones (<= 768px) and tablets (touch + <= 1024px)
  if (window.innerWidth <= 768) return true;
  if (window.innerWidth <= 1024 && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) return true;
  return false;
}

function showMobileFieldView() {
  const mfView = document.getElementById('mobileFieldView');
  const appView = document.getElementById('appView');
  if (!mfView) return;

  // Hide desktop app, show mobile field view
  if (appView) appView.classList.add('hidden');
  mfView.style.display = 'flex';

  // Allow renderMarkers() to run (it returns early when currentView === 'login')
  currentView = 'app';

  // Remove bottom tab bar if it was created by mobile-ui.js
  const bottomTabBar = document.getElementById('bottomTabBar');
  if (bottomTabBar) bottomTabBar.remove();

  // Remove other mobile-ui elements that conflict
  const searchFab = document.getElementById('mobileSearchFab');
  if (searchFab) searchFab.remove();
  const selectionFab = document.getElementById('mobileSelectionFab');
  if (selectionFab) selectionFab.remove();
  const moreMenu = document.getElementById('moreMenuOverlay');
  if (moreMenu) moreMenu.remove();

  // Show user bar (for token refresh etc)
  showUserBar();
  // But hide the desktop user bar on mobile field view
  const userBar = document.getElementById('userBar');
  if (userBar) userBar.style.display = 'none';

  // Start token refresh
  setupTokenRefresh();

  // Stop globe spin and prepare map for interactive use
  if (window.map) {
    stopGlobeSpin();
    setMapInteractive(true);

    // Load config to get office coordinates, then fly map to correct location
    (async () => {
      try { await loadConfig(); } catch (e) { /* continue with existing config */ }
      const hasOfficeLocation = appConfig.routeStartLat && appConfig.routeStartLng;
      map.flyTo({
        center: hasOfficeLocation
          ? [appConfig.routeStartLng, appConfig.routeStartLat]
          : NORWAY_CENTER,
        zoom: hasOfficeLocation ? 12 : 5,
        pitch: 0,
        bearing: 0,
        duration: 1500
      });
    })();
  }

  // Set active tab
  mfActiveTab = 'ukeplan';
  mfUpdateBottomBar();

  // Inject admin tabs if user is admin/bruker
  if (typeof mfSetupAdminTabs === 'function') {
    mfSetupAdminTabs();
  }

  // Inject calendar tab (all users)
  if (typeof mfSetupCalendarTab === 'function') {
    mfSetupCalendarTab();
  }

  // Inject chat tab (all users)
  if (typeof mfSetupChatTab === 'function') {
    mfSetupChatTab();
  }

  // Initialize inline weekplan
  if (typeof mfShowWeekplanInline === 'function') {
    mfShowWeekplanInline();
  }
}

function hideMobileFieldView() {
  const mfView = document.getElementById('mobileFieldView');
  if (mfView) mfView.style.display = 'none';
}

// ---- Date navigation ----

function mfPrevDay() {
  const d = new Date(mfCurrentDate);
  d.setDate(d.getDate() - 1);
  mfCurrentDate = d.toISOString().split('T')[0];
  mfLoadRoute();
}

function mfNextDay() {
  const d = new Date(mfCurrentDate);
  d.setDate(d.getDate() + 1);
  mfCurrentDate = d.toISOString().split('T')[0];
  mfLoadRoute();
}

function mfFormatDateLabel(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (dateStr === today) return 'I dag';
  if (dateStr === tomorrow) return 'I morgen';
  if (dateStr === yesterday) return 'I g\u00e5r';

  const d = new Date(dateStr);
  return d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' });
}

// ---- Route loading ----

async function mfLoadRoute() {
  const dateLabel = document.getElementById('mfDateLabel');
  if (dateLabel) dateLabel.textContent = mfFormatDateLabel(mfCurrentDate);

  // Show loading state
  const content = document.getElementById('mfRouteContent');
  if (content) {
    content.innerHTML = '<div class="mf-loading"><div class="mf-spinner"></div><p>Laster rute...</p></div>';
  }

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/my-route?date=${mfCurrentDate}`, {
      headers: { 'X-CSRF-Token': csrfToken },
      credentials: 'include'
    });

    if (!response.ok) {
      mfRouteData = null;
      mfRenderEmpty();
      return;
    }

    const json = await response.json();

    if (json.success && json.data) {
      mfRouteData = json.data;
      mfRenderRoute();

      // Cache for offline
      if (window.OfflineStorage) {
        const userId = localStorage.getItem('userId') || '0';
        OfflineStorage.saveTodaysRoute(mfCurrentDate, userId, json.data).catch(() => {});
        OfflineStorage.setLastSyncTime().catch(() => {});
      }
    } else {
      mfRouteData = null;
      mfRenderEmpty();
    }
  } catch (err) {
    console.error('Mobile field: Error loading route:', err);

    // Offline fallback
    if (window.OfflineStorage) {
      const userId = localStorage.getItem('userId') || '0';
      const cached = await OfflineStorage.getTodaysRoute(mfCurrentDate, userId);
      if (cached) {
        mfRouteData = cached;
        mfRenderRoute();
        mfShowBanner('Viser lagret rute (frakoblet)', 'warning');
        return;
      }
    }

    mfRouteData = null;
    mfRenderEmpty('Kunne ikke laste rute. Sjekk internettforbindelsen.');
  }
}

// ---- Rendering ----

function mfRenderEmpty(message) {
  const content = document.getElementById('mfRouteContent');
  if (!content) return;

  const msg = message || 'Ingen rute planlagt for denne dagen.';
  content.innerHTML = `
    <div class="mf-empty-state">
      <i class="fas fa-route" aria-hidden="true"></i>
      <p>${escapeHtml(msg)}</p>
      <span class="mf-empty-hint">Ruter planlegges fra desktop-versjonen.</span>
    </div>
  `;

  // Update progress
  const progress = document.getElementById('mfProgressBar');
  if (progress) progress.style.display = 'none';
}

function mfRenderRoute() {
  const route = mfRouteData;
  if (!route) return mfRenderEmpty();

  const content = document.getElementById('mfRouteContent');
  if (!content) return;

  const isStarted = !!route.execution_started_at;
  const isCompleted = !!route.execution_ended_at;
  const kunder = route.kunder || [];
  const visits = route.visits || [];
  const completed = isStarted ? (route.completed_count || 0) : 0;
  const total = route.total_count || kunder.length || 0;

  // Update progress bar
  mfUpdateProgress(completed, total, isCompleted);

  if (kunder.length === 0) {
    return mfRenderEmpty('Ruten har ingen kunder.');
  }

  // Find next unvisited stop
  let nextStopIndex = -1;
  if (isStarted && !isCompleted) {
    nextStopIndex = kunder.findIndex(k => {
      const v = visits.find(v => v.kunde_id === k.id);
      return !v || !v.completed;
    });
  }

  let html = '';

  // Start route button (if not started)
  if (!isStarted) {
    html += `
      <button class="mf-start-route-btn" data-action="mfStartRoute">
        <i class="fas fa-play-circle" aria-hidden="true"></i>
        Start ruten (${kunder.length} stopp)
      </button>
    `;
  }

  // Route summary with technician and time estimate
  const totalEstMin = kunder.reduce((sum, k) => sum + (k.estimert_tid || 30), 0);
  const estHours = Math.floor(totalEstMin / 60);
  const estMins = totalEstMin % 60;
  const estLabel = estHours > 0 ? `${estHours}t ${estMins > 0 ? estMins + 'min' : ''}` : `${estMins} min`;
  const assignedName = route.technician_name || route.assigned_to_name || '';

  html += `
    <div class="mf-route-summary">
      ${assignedName ? `<span><i class="fas fa-user-hard-hat" aria-hidden="true"></i> ${escapeHtml(assignedName)}</span>` : ''}
      ${route.total_distanse ? `<span><i class="fas fa-road" aria-hidden="true"></i> ${(route.total_distanse / 1000).toFixed(1)} km</span>` : ''}
      <span><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${total} stopp</span>
      <span><i class="fas fa-clock" aria-hidden="true"></i> ~${estLabel}</span>
      ${isCompleted ? '<span class="mf-route-done"><i class="fas fa-check-circle" aria-hidden="true"></i> Fullf\u00f8rt</span>' : ''}
    </div>
  `;

  // "Next stop" prominent card
  if (isStarted && !isCompleted && nextStopIndex >= 0) {
    const next = kunder[nextStopIndex];
    const address = [next.adresse, next.postnummer, next.poststed].filter(Boolean).join(', ');

    const nextEstMin = next.estimert_tid || 30;
    html += `
      <div class="mf-next-stop">
        <div class="mf-next-label">Neste stopp (${nextStopIndex + 1}/${kunder.length})</div>
        <h2 class="mf-next-name">${escapeHtml(next.navn)}</h2>
        <p class="mf-next-address">${escapeHtml(address)}</p>
        <div class="mf-next-est">
          <i class="fas fa-clock" aria-hidden="true"></i>
          <input type="number" class="mf-est-input" value="${nextEstMin}" min="5" step="5"
            data-on-change="mfSetEstimertTidHandler" data-args='[${next.id}]'>
          <span>min</span>
        </div>
        ${next.telefon ? `<a href="tel:${escapeHtml(next.telefon)}" class="mf-next-phone"><i class="fas fa-phone" aria-hidden="true"></i> ${escapeHtml(next.telefon)}</a>` : ''}
        <div class="mf-next-actions">
          <button class="mf-btn mf-btn-navigate" data-action="mfNavigate" data-args='[${next.id}]'>
            <i class="fas fa-directions" aria-hidden="true"></i> Naviger
          </button>
          ${next.epost ? `<button class="mf-btn mf-btn-notify" data-action="mfNotifyCustomer" data-args='[${next.id}]'>
            <i class="fas fa-envelope" aria-hidden="true"></i> Varsle
          </button>` : ''}
          <button class="mf-btn mf-btn-complete" data-action="mfShowVisitForm" data-args='[${next.id}]'>
            <i class="fas fa-check" aria-hidden="true"></i> Fullf\u00f8rt
          </button>
        </div>
      </div>
    `;
  }

  // Remaining stops
  const visitedCards = [];
  const remainingCards = [];

  kunder.forEach((kunde, index) => {
    const visit = isStarted ? visits.find(v => v.kunde_id === kunde.id) : null;
    const isVisited = visit && visit.completed === true;
    const isNext = index === nextStopIndex;

    if (isNext && isStarted) return; // Already rendered as "Next stop" card

    const address = [kunde.adresse, kunde.poststed].filter(Boolean).join(', ');
    const stopEstMin = kunde.estimert_tid || 30;
    const card = `
      <div class="mf-stop-card ${isVisited ? 'mf-stop-visited' : ''}" data-kunde-id="${kunde.id}">
        <div class="mf-stop-num">${index + 1}</div>
        <div class="mf-stop-info" data-action="mfShowCustomerInfo" data-args='[${kunde.id}]'>
          <h4>${escapeHtml(kunde.navn)}</h4>
          ${!isVisited ? `<p>${escapeHtml(address)}</p>` : ''}
        </div>
        ${!isVisited ? `
          <div class="mf-stop-est">
            <input type="number" class="mf-est-input" value="${stopEstMin}" min="5" step="5"
              data-on-change="mfSetEstimertTidHandler" data-args='[${kunde.id}]'>
            <span>min</span>
          </div>
        ` : ''}
        <div class="mf-stop-actions">
          ${isVisited
            ? '<span class="mf-visited-icon"><i class="fas fa-check-circle" aria-hidden="true"></i></span>'
            : `
              ${kunde.telefon ? `<a href="tel:${escapeHtml(kunde.telefon)}" class="mf-action-btn" title="Ring"><i class="fas fa-phone" aria-hidden="true"></i></a>` : ''}
              ${kunde.epost ? `<button class="mf-action-btn mf-action-notify" data-action="mfNotifyCustomer" data-args='[${kunde.id}]' title="Varsle kunde"><i class="fas fa-envelope" aria-hidden="true"></i></button>` : ''}
              <button class="mf-action-btn" data-action="mfNavigate" data-args='[${kunde.id}]' title="Naviger"><i class="fas fa-directions" aria-hidden="true"></i></button>
              <button class="mf-action-btn mf-action-complete" data-action="mfShowVisitForm" data-args='[${kunde.id}]' title="Fullf\u00f8rt"><i class="fas fa-check" aria-hidden="true"></i></button>
            `
          }
        </div>
      </div>
    `;

    if (isVisited) {
      visitedCards.push(card);
    } else {
      remainingCards.push(card);
    }
  });

  html += remainingCards.join('');

  // Visited section (collapsed)
  if (visitedCards.length > 0) {
    html += `
      <div class="mf-visited-section">
        <button class="mf-visited-toggle" data-action="toggleParentClass" data-class="expanded">
          <i class="fas fa-check-circle" aria-hidden="true"></i>
          <span>Bes\u00f8kt (${visitedCards.length})</span>
          <i class="fas fa-chevron-down mf-chevron" aria-hidden="true"></i>
        </button>
        <div class="mf-visited-list">
          ${visitedCards.join('')}
        </div>
      </div>
    `;
  }

  // Complete route button
  if (isStarted && !isCompleted && completed === total && total > 0) {
    html += `
      <button class="mf-complete-route-btn" data-action="mfCompleteRoute">
        <i class="fas fa-flag-checkered" aria-hidden="true"></i>
        Fullf\u00f8r ruten
      </button>
    `;
  }

  content.innerHTML = html;

  // Apply presence badges after render
  if (typeof presenceClaims !== 'undefined' && presenceClaims.size > 0) {
    for (const [kundeId] of presenceClaims) {
      mfUpdatePresenceOnRoute(kundeId);
    }
  }
}

function mfUpdateProgress(completed, total, isCompleted) {
  const bar = document.getElementById('mfProgressBar');
  if (!bar) return;

  if (total === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  const fill = bar.querySelector('.mf-progress-fill');
  const label = bar.querySelector('.mf-progress-label');
  const pct = total > 0 ? (completed / total) * 100 : 0;

  if (fill) fill.style.width = pct + '%';
  if (label) label.textContent = isCompleted ? 'Fullf\u00f8rt!' : `${completed} av ${total}`;
}

// ---- Actions ----

async function mfStartRoute() {
  if (!mfRouteData) return;

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/start-route/${mfRouteData.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include'
    });
    const json = await response.json();
    if (json.success) {
      mfShowBanner('Rute startet!', 'success');
      mfLoadRoute();
    }
  } catch (err) {
    mfShowBanner('Kunne ikke starte ruten', 'error');
  }
}

async function mfCompleteRoute() {
  if (!mfRouteData) return;

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/complete-route/${mfRouteData.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include'
    });
    const json = await response.json();
    if (json.success) {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      mfShowBanner('Ruten er fullf\u00f8rt!', 'success');
      mfLoadRoute();
    }
  } catch (err) {
    mfShowBanner('Kunne ikke fullf\u00f8re ruten', 'error');
  }
}

function mfNavigate(kundeId) {
  const kunde = mfRouteData?.kunder?.find(k => k.id === kundeId);
  if (!kunde) return;

  const address = [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean).join(', ');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (kunde.lat && kunde.lng) {
    if (isIOS) {
      window.open(`maps://maps.apple.com/?daddr=${kunde.lat},${kunde.lng}&dirflg=d`);
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${kunde.lat},${kunde.lng}`);
    }
  } else if (address) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`);
  }
}

// ---- Customer info card ----

function mfShowCustomerInfo(kundeId) {
  const kunde = mfRouteData?.kunder?.find(k => k.id === kundeId);
  if (!kunde) return;

  // Claim this customer (presence)
  mfClaimCustomer(kundeId);

  const address = [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean).join(', ');

  const overlay = document.createElement('div');
  overlay.className = 'mf-info-overlay';
  overlay.innerHTML = `
    <div class="mf-info-card">
      <div class="mf-info-header">
        <h3>${escapeHtml(kunde.navn)}</h3>
        <button class="mf-info-close" aria-label="Lukk"><i class="fas fa-times" aria-hidden="true"></i></button>
      </div>
      <div class="mf-info-body">
        ${address ? `<div class="mf-info-row"><i class="fas fa-map-marker-alt" aria-hidden="true"></i><span>${escapeHtml(address)}</span></div>` : ''}
        ${kunde.telefon ? `<div class="mf-info-row"><i class="fas fa-phone" aria-hidden="true"></i><a href="tel:${escapeHtml(kunde.telefon)}">${escapeHtml(kunde.telefon)}</a></div>` : ''}
        ${kunde.epost ? `<div class="mf-info-row"><i class="fas fa-envelope" aria-hidden="true"></i><a href="mailto:${escapeHtml(kunde.epost)}">${escapeHtml(kunde.epost)}</a></div>` : ''}
        ${kunde.kontaktperson ? `<div class="mf-info-row"><i class="fas fa-user" aria-hidden="true"></i><span>${escapeHtml(kunde.kontaktperson)}</span></div>` : ''}
        ${kunde.siste_kontroll ? `<div class="mf-info-row"><i class="fas fa-calendar-check" aria-hidden="true"></i><span>Siste kontroll: ${escapeHtml(new Date(kunde.siste_kontroll).toLocaleDateString('nb-NO'))}</span></div>` : ''}
        ${kunde.neste_kontroll ? `<div class="mf-info-row"><i class="fas fa-calendar-alt" aria-hidden="true"></i><span>Neste kontroll: ${escapeHtml(new Date(kunde.neste_kontroll).toLocaleDateString('nb-NO'))}</span></div>` : ''}
        ${kunde.estimert_tid ? `<div class="mf-info-row"><i class="fas fa-clock" aria-hidden="true"></i><span>Estimert tid: ${kunde.estimert_tid} min</span></div>` : ''}
        ${kunde.notat ? `<div class="mf-info-row mf-info-note"><i class="fas fa-sticky-note" aria-hidden="true"></i><span>${escapeHtml(kunde.notat)}</span></div>` : ''}
      </div>
      <div class="mf-info-actions">
        <button class="mf-btn mf-btn-navigate" data-action="mfNavigateAndCloseInfo" data-args='[${kunde.id}]'>
          <i class="fas fa-directions" aria-hidden="true"></i> Naviger
        </button>
        ${kunde.telefon ? `<a href="tel:${escapeHtml(kunde.telefon)}" class="mf-btn mf-btn-call"><i class="fas fa-phone" aria-hidden="true"></i> Ring</a>` : ''}
      </div>
    </div>
  `;

  document.getElementById('mobileFieldView').appendChild(overlay);

  // Close handlers — release presence on close
  const closeOverlay = () => {
    mfReleaseCustomer(kundeId);
    overlay.remove();
  };
  const closeBtn = overlay.querySelector('.mf-info-close');
  closeBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });
}

// ---- Bottom bar tab switching ----

function mfSwitchTab(tab) {
  const prevTab = mfActiveTab;
  mfActiveTab = tab;
  mfUpdateBottomBar();

  const weekplanView = document.getElementById('mfWeekplanView');
  const mapView = document.getElementById('mfMapView');
  const accountView = document.getElementById('mfAccountView');
  const teamView = document.getElementById('mfTeamView');
  const kunderView = document.getElementById('mfKunderView');
  const calendarView = document.getElementById('mfCalendarView');
  const chatView = document.getElementById('mfChatView');

  if (weekplanView) weekplanView.style.display = tab === 'ukeplan' ? 'flex' : 'none';
  if (mapView) mapView.style.display = tab === 'map' ? 'flex' : 'none';
  if (accountView) accountView.style.display = tab === 'account' ? 'flex' : 'none';
  if (teamView) teamView.style.display = tab === 'team' ? 'flex' : 'none';
  if (kunderView) kunderView.style.display = tab === 'kunder' ? 'flex' : 'none';
  if (calendarView) calendarView.style.display = tab === 'calendar' ? 'flex' : 'none';
  if (chatView) chatView.style.display = tab === 'chat' ? 'flex' : 'none';

  if (tab === 'ukeplan' && typeof mfShowWeekplanInline === 'function') {
    mfShowWeekplanInline();
  }

  if (tab === 'map') {
    if (!mfMapInitialized) mfInitMap();
    // Fly-to animation: only once after login
    if (map && !window._mobileMapIntroPlayed) {
      window._mobileMapIntroPlayed = true;
      const hasOffice = appConfig?.routeStartLat && appConfig?.routeStartLng;
      const target = hasOffice
        ? [appConfig.routeStartLng, appConfig.routeStartLat]
        : [10.0, 62.0];
      map.jumpTo({ center: target, zoom: 2.5 });
      setTimeout(() => {
        map.flyTo({
          center: target,
          zoom: hasOffice ? 8 : 5,
          duration: 3000,
          essential: true,
          curve: 1.6
        });
      }, 1200);
    }
  }

  if (tab === 'account') {
    mfRenderAccount();
  }

  // Admin tab hooks
  if (tab === 'team' && typeof mfOnTeamTabShown === 'function') {
    mfOnTeamTabShown();
  }
  if (prevTab === 'team' && tab !== 'team' && typeof mfOnTeamTabHidden === 'function') {
    mfOnTeamTabHidden();
  }
  if (tab === 'kunder' && typeof mfRenderKunderView === 'function') {
    mfRenderKunderView();
  }

  // Calendar tab hook
  if (tab === 'calendar' && typeof mfOnCalendarTabShown === 'function') {
    mfOnCalendarTabShown();
  }

  // Chat tab hooks
  if (tab === 'chat' && typeof mfOnChatTabShown === 'function') {
    mfOnChatTabShown();
  }
  if (prevTab === 'chat' && tab !== 'chat' && typeof mfOnChatTabHidden === 'function') {
    mfOnChatTabHidden();
  }
}

function mfUpdateBottomBar() {
  document.querySelectorAll('.mf-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === mfActiveTab);
  });
}

// ---- Simplified map ----

function mfInitMap() {
  const mapContainer = document.getElementById('mfMapContainer');
  if (!mapContainer || mfMapInitialized) return;

  // Reuse existing shared map if available, or create a simple one
  if (window.map && window.mapboxgl) {
    mfMapInitialized = true;
    // Move the shared map into the mobile map view temporarily
    const sharedMap = document.getElementById('sharedMapContainer');
    if (sharedMap) {
      mapContainer.appendChild(sharedMap);
      sharedMap.style.position = 'relative';
      sharedMap.style.width = '100%';
      sharedMap.style.height = '100%';
    }
    // Recalculate viewport after container move
    setTimeout(() => { if (map) map.resize(); }, 100);

    // Load all customers + clusters, then overlay today's stops
    mfInitMapData();
    mfShowStopsOnMap();
  }
}

async function mfInitMapData() {
  try {
    if (typeof initDOMElements === 'function') initDOMElements();
    if (typeof initClusterManager === 'function') initClusterManager();
    if (typeof waitForClusterReady === 'function') await waitForClusterReady(8000);

    await Promise.all([
      typeof loadOrganizationCategories === 'function' ? loadOrganizationCategories() : Promise.resolve(),
      typeof loadOrganizationFields === 'function' ? loadOrganizationFields() : Promise.resolve()
    ]);

    if (typeof loadCustomers === 'function' && (!customers || customers.length === 0)) {
      await loadCustomers();
    } else if (customers && customers.length > 0 && typeof applyFilters === 'function') {
      applyFilters();
    }
  } catch (err) {
    console.error('Mobile map data init error:', err);
  }
}

function mfShowStopsOnMap() {
  if (!window.map || !mfRouteData?.kunder) return;

  const kunder = mfRouteData.kunder;
  const visits = mfRouteData.visits || [];
  const bounds = new mapboxgl.LngLatBounds();
  let hasPoints = false;

  // Clear existing mobile markers
  document.querySelectorAll('.mf-map-marker').forEach(el => el.remove());

  kunder.forEach((kunde, index) => {
    if (!kunde.lat || !kunde.lng) return;

    const visit = visits.find(v => v.kunde_id === kunde.id);
    const isVisited = visit && visit.completed;

    const el = document.createElement('div');
    el.className = 'mf-map-marker' + (isVisited ? ' visited' : '');
    el.innerHTML = `<span>${index + 1}</span>`;
    el.addEventListener('click', () => mfShowCustomerInfo(kunde.id));

    new mapboxgl.Marker({ element: el })
      .setLngLat([kunde.lng, kunde.lat])
      .addTo(map);

    bounds.extend([kunde.lng, kunde.lat]);
    hasPoints = true;
  });

  if (hasPoints) {
    map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 500 });
  }
}

// ---- Account tab ----

function mfRenderAccount() {
  const container = document.getElementById('mfAccountContent');
  if (!container) return;

  const userName = localStorage.getItem('userName') || 'Bruker';
  const userEmail = localStorage.getItem('userEmail') || '';
  const orgName = localStorage.getItem('organizationName') || '';
  const isOnline = navigator.onLine;

  let pendingHtml = '';
  if (window.OfflineStorage) {
    OfflineStorage.getPendingActionCount().then(count => {
      const badge = document.getElementById('mfSyncBadge');
      if (badge) {
        badge.textContent = count > 0 ? `${count} ventende` : 'Synkronisert';
        badge.className = 'mf-sync-badge ' + (count > 0 ? 'pending' : 'synced');
      }
    });
  }

  container.innerHTML = `
    <div class="mf-account-card">
      <div class="mf-account-user">
        <div class="mf-account-avatar"><i class="fas fa-user" aria-hidden="true"></i></div>
        <div>
          <h3>${escapeHtml(userName)}</h3>
          <p>${escapeHtml(userEmail)}</p>
          ${orgName ? `<p class="mf-account-org">${escapeHtml(orgName)}</p>` : ''}
        </div>
      </div>
    </div>

    <div class="mf-account-card">
      <h4>Status</h4>
      <div class="mf-account-row">
        <span>Tilkobling</span>
        <span class="mf-status-dot ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Frakoblet'}</span>
      </div>
      <div class="mf-account-row">
        <span>Synkronisering</span>
        <span id="mfSyncBadge" class="mf-sync-badge synced">Synkronisert</span>
      </div>
    </div>

    <button class="mf-btn mf-btn-logout" data-action="mfLogout">
      <i class="fas fa-sign-out-alt" aria-hidden="true"></i> Logg ut
    </button>
  `;
}

// ---- Logout ----

async function mfLogout() {
  try {
    const csrfToken = getCsrfToken();
    await fetch('/api/klient/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include'
    });
  } catch (e) { /* continue anyway */ }

  // Clear local state
  localStorage.removeItem('userName');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  localStorage.removeItem('organizationId');
  localStorage.removeItem('organizationSlug');
  localStorage.removeItem('organizationName');
  localStorage.removeItem('appMode');
  localStorage.removeItem('isSuperAdmin');

  // Hide mobile field view, show login
  hideMobileFieldView();

  // Restore shared map if it was moved
  mfRestoreMap();

  // Show login overlay
  const loginOverlay = document.getElementById('loginOverlay');
  if (loginOverlay) {
    loginOverlay.classList.remove('hidden');
    // Reset login form
    const loginForm = document.getElementById('spaLoginForm');
    if (loginForm) loginForm.reset();
    resetLoginButton();
  }

  // Release any presence claim before closing WebSocket
  if (mfCurrentClaimedKundeId) {
    mfReleaseCustomer(mfCurrentClaimedKundeId);
  }

  // Close WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  wsInitialized = false;

  // Clean up admin polling timers
  if (typeof mfAdminCleanup === 'function') {
    mfAdminCleanup();
  }

  // Clean up chat
  if (typeof mfChatCleanup === 'function') {
    mfChatCleanup();
  }

  // Clean up calendar
  if (typeof mfCalendarCleanup === 'function') {
    mfCalendarCleanup();
  }

  // Reset state
  mfRouteData = null;
  mfMapInitialized = false;
  mfActiveTab = 'route';

  // Start globe spin
  if (window.map && typeof startGlobeSpin === 'function') {
    startGlobeSpin();
  }
}

function mfRestoreMap() {
  const sharedMap = document.getElementById('sharedMapContainer');
  if (sharedMap && sharedMap.parentElement?.id === 'mfMapContainer') {
    document.body.insertBefore(sharedMap, document.getElementById('loginOverlay'));
    sharedMap.style.position = 'fixed';
    sharedMap.style.width = '';
    sharedMap.style.height = '';
  }
  // Clean up mobile markers
  document.querySelectorAll('.mf-map-marker').forEach(el => el.remove());
  mfMapInitialized = false;
}

// ---- Estimated time adjustment ----

let mfEstSaveTimer = null;

// Called by delegation change handler — receives (kundeId, element)
function mfSetEstimertTidHandler(kundeId, el) {
  const val = Math.max(5, parseInt(el.value) || 30);
  el.value = val;
  mfSetEstimertTid(kundeId, val);
}

function mfSetEstimertTid(kundeId, val) {
  if (!val) val = 30;

  // Update local data
  if (mfRouteData?.kunder) {
    const kunde = mfRouteData.kunder.find(k => k.id === kundeId);
    if (kunde) kunde.estimert_tid = val;
  }

  // Update summary estimate display
  const kunder = mfRouteData?.kunder || [];
  const totalEstMin = kunder.reduce((sum, k) => sum + (k.estimert_tid || 30), 0);
  const estHours = Math.floor(totalEstMin / 60);
  const estMins = totalEstMin % 60;
  const estLabel = estHours > 0 ? `${estHours}t ${estMins > 0 ? estMins + 'min' : ''}` : `${estMins} min`;
  const summaryClockSpan = document.querySelector('.mf-route-summary .fa-clock')?.parentElement;
  if (summaryClockSpan) summaryClockSpan.innerHTML = `<i class="fas fa-clock" aria-hidden="true"></i> ~${estLabel}`;

  // Debounce save to backend
  if (mfEstSaveTimer) clearTimeout(mfEstSaveTimer);
  mfEstSaveTimer = setTimeout(() => mfSaveEstimertTid(kundeId, val), 1000);
}

async function mfSaveEstimertTid(kundeId, minutes) {
  try {
    const csrfToken = getCsrfToken();
    await fetch(`/api/kunder/${kundeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ estimert_tid: minutes })
    });
  } catch (err) {
    console.warn('Mobile field: Could not save estimated time:', err);
  }
}

// ---- Notification banner ----

function mfShowBanner(message, type) {
  const existing = document.querySelector('.mf-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className = `mf-banner mf-banner-${type || 'info'}`;
  banner.textContent = message;
  document.getElementById('mobileFieldView')?.prepend(banner);

  setTimeout(() => banner.remove(), 3000);
}

// ---- Prefetch customer details for offline ----

async function mfPrefetchCustomerDetails() {
  if (!mfRouteData?.kunder || !window.OfflineStorage) return;

  try {
    const kundeList = mfRouteData.kunder;
    // Save the embedded customer data to IndexedDB for offline access
    await OfflineStorage.saveCustomers(kundeList);
  } catch (e) {
    console.warn('Mobile field: Could not prefetch customer details:', e);
  }
}

// ---- WebSocket real-time handler for mobile ----

let mfWsReloadTimer = null;

function mfDebouncedRouteReload() {
  if (mfWsReloadTimer) clearTimeout(mfWsReloadTimer);
  mfWsReloadTimer = setTimeout(() => mfLoadRoute(), 500);
}

function isMobileFieldActive() {
  const mfView = document.getElementById('mobileFieldView');
  return mfView && mfView.style.display !== 'none';
}

// Mobile presence tracking
let mfCurrentClaimedKundeId = null;

function mfClaimCustomer(kundeId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (mfCurrentClaimedKundeId && mfCurrentClaimedKundeId !== kundeId) {
    mfReleaseCustomer(mfCurrentClaimedKundeId);
  }
  mfCurrentClaimedKundeId = kundeId;
  const userName = localStorage.getItem('userName') || 'Bruker';
  ws.send(JSON.stringify({ type: 'claim_customer', kundeId, userName }));
}

function mfReleaseCustomer(kundeId) {
  if (!kundeId) return;
  if (mfCurrentClaimedKundeId === kundeId) mfCurrentClaimedKundeId = null;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'release_customer', kundeId }));
}

function handleMobileRealtimeUpdate(message) {
  if (!isMobileFieldActive()) return;

  const { type, data } = message;

  switch (type) {
    // ---- Route sync ----
    case 'rute_created':
    case 'rute_updated':
    case 'rute_deleted':
      mfDebouncedRouteReload();
      break;

    // ---- Customer data sync ----
    case 'kunde_created':
    case 'kunde_deleted':
    case 'kunder_bulk_updated':
      // Reload route if any current route customer is affected
      if (mfRouteData?.kunder) mfDebouncedRouteReload();
      break;

    case 'kunde_updated':
      // Update customer data in current route if present
      if (mfRouteData?.kunder) {
        const idx = mfRouteData.kunder.findIndex(k => k.id === Number.parseInt(data.id));
        if (idx !== -1) {
          mfRouteData.kunder[idx] = { ...mfRouteData.kunder[idx], ...data };
          mfRenderRoute();
        }
      }
      break;

    // ---- Calendar sync ----
    case 'avtale_created':
    case 'avtale_updated':
    case 'avtale_deleted':
    case 'avtale_series_deleted':
    case 'avtaler_bulk_created':
      if (typeof mfLoadCalendarData === 'function') {
        mfLoadCalendarData();
      }
      break;

    // ---- Presence sync ----
    case 'customer_claimed':
      presenceClaims.set(data.kundeId, {
        userId: data.userId,
        userName: data.userName,
        initials: data.initials,
      });
      mfUpdatePresenceOnRoute(data.kundeId);
      break;

    case 'customer_released':
      presenceClaims.delete(data.kundeId);
      mfUpdatePresenceOnRoute(data.kundeId);
      break;

    case 'user_offline':
      for (const [kundeId, claim] of presenceClaims) {
        if (claim.userId === data.userId) {
          presenceClaims.delete(kundeId);
          mfUpdatePresenceOnRoute(kundeId);
        }
      }
      break;
  }

  // Chain to admin handler if present
  if (typeof handleMobileAdminRealtimeUpdate === 'function') {
    handleMobileAdminRealtimeUpdate(message);
  }

  // Chain to weekplan editor handler if present
  if (typeof handleMobileWeekplanRealtimeUpdate === 'function') {
    handleMobileWeekplanRealtimeUpdate(message);
  }
}

// Show presence indicators on mobile route stop cards
function mfUpdatePresenceOnRoute(kundeId) {
  const card = document.querySelector(`.mf-stop-card[data-kunde-id="${kundeId}"]`);
  if (!card) return;

  // Remove existing presence badge
  const existing = card.querySelector('.mf-presence-badge');
  if (existing) existing.remove();

  // Add badge if someone else has claimed this customer
  const claim = presenceClaims.get(kundeId);
  if (claim && claim.userId !== myUserId) {
    const badge = document.createElement('span');
    badge.className = 'mf-presence-badge';
    badge.textContent = claim.initials || '??';
    badge.title = `${claim.userName} jobber med denne kunden`;
    badge.style.backgroundColor = getPresenceColor(claim.userId);
    const info = card.querySelector('.mf-stop-info');
    if (info) info.appendChild(badge);
  }
}

// ---- Online/offline listener ----

function mfSetupConnectivityListeners() {
  window.addEventListener('online', () => {
    mfShowBanner('Tilkoblet igjen \u2014 synkroniserer...', 'success');
    // Reset WebSocket reconnect and reconnect immediately
    wsReconnectAttempts = 0;
    wsInitialized = false;
    initWebSocket();
    setTimeout(() => mfLoadRoute(), 1000);
  });

  window.addEventListener('offline', () => {
    mfShowBanner('Frakoblet \u2014 endringer lagres lokalt', 'warning');
  });

  // Reconnect WebSocket when app returns from background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isMobileFieldActive()) {
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        wsReconnectAttempts = 0;
        wsInitialized = false;
        initWebSocket();
      }
      mfDebouncedRouteReload();
    }
  });
}

// Initialize connectivity listeners on load
mfSetupConnectivityListeners();

// ---- Compound action wrappers (for data-action delegation) ----

// ---- Notify customer ("på vei" email) ----

async function mfNotifyCustomer(kundeId) {
  if (!mfRouteData || !mfRouteData.kunder) return;
  const kunde = mfRouteData.kunder.find(k => k.id === kundeId);
  if (!kunde) return;

  if (!kunde.epost) {
    mfShowBanner('Kunden har ikke registrert e-post', 'error');
    return;
  }

  const estMin = kunde.estimert_tid || 10;

  // Build confirmation dialog
  const overlay = document.createElement('div');
  overlay.className = 'mf-info-overlay';
  overlay.innerHTML = `
    <div class="mf-info-card" style="max-width:360px">
      <div class="mf-info-header">
        <h3>Varsle kunde</h3>
        <button class="mf-info-close" aria-label="Lukk"><i class="fas fa-times" aria-hidden="true"></i></button>
      </div>
      <div class="mf-info-body">
        <p style="margin:0 0 12px">Send «på vei»-varsel til <strong>${escapeHtml(kunde.kontaktperson || kunde.navn)}</strong>?</p>
        <p style="margin:0 0 8px;color:var(--color-text-muted);font-size:13px"><i class="fas fa-envelope" aria-hidden="true"></i> ${escapeHtml(kunde.epost)}</p>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px">
          <span>Estimert ankomst:</span>
          <input type="number" id="mfNotifyEstMin" value="${estMin}" min="1" max="180" step="5"
            style="width:60px;padding:4px 8px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-bg-tertiary);color:var(--color-text-primary);text-align:center">
          <span>min</span>
        </label>
      </div>
      <div class="mf-info-actions" style="gap:8px">
        <button class="mf-btn mf-btn-notify" id="mfNotifySendBtn">
          <i class="fas fa-paper-plane" aria-hidden="true"></i> Send varsel
        </button>
        <button class="mf-btn" id="mfNotifyCancelBtn" style="background:var(--color-bg-tertiary)">
          Avbryt
        </button>
      </div>
    </div>
  `;

  document.getElementById('mobileFieldView').appendChild(overlay);

  const closeOverlay = () => overlay.remove();
  overlay.querySelector('.mf-info-close').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
  overlay.querySelector('#mfNotifyCancelBtn').addEventListener('click', closeOverlay);

  overlay.querySelector('#mfNotifySendBtn').addEventListener('click', async () => {
    const minInput = document.getElementById('mfNotifyEstMin');
    const estimertTid = parseInt(minInput.value) || 10;
    const sendBtn = overlay.querySelector('#mfNotifySendBtn');
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Sender...';

    try {
      const csrfToken = typeof getCsrfToken === 'function' ? getCsrfToken() : '';
      const resp = await fetch(`/api/todays-work/notify-customer/${kundeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({ estimert_tid: estimertTid }),
      });
      const data = await resp.json();
      closeOverlay();

      if (data.success) {
        mfShowBanner(`Varsel sendt til ${escapeHtml(kunde.epost)}`, 'success');
        // Mark notify buttons for this customer as sent
        document.querySelectorAll(`[data-action="mfNotifyCustomer"][data-args='[${kundeId}]']`).forEach(btn => {
          btn.classList.add('mf-notified');
          btn.disabled = true;
          btn.title = 'Varsel sendt';
          if (btn.classList.contains('mf-btn')) {
            btn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Varslet';
          }
        });
      } else {
        mfShowBanner(data.error || 'Kunne ikke sende varsel', 'error');
      }
    } catch (err) {
      closeOverlay();
      mfShowBanner('Nettverksfeil — prøv igjen', 'error');
    }
  });
}

function mfNavigateAndCloseInfo(kundeId) {
  mfNavigate(kundeId);
  const overlay = document.querySelector('.mf-info-overlay');
  if (overlay) overlay.remove();
}

// ---- Expose globally ----

window.showMobileFieldView = showMobileFieldView;
window.hideMobileFieldView = hideMobileFieldView;
window.handleMobileRealtimeUpdate = handleMobileRealtimeUpdate;
window.isMobileFieldActive = isMobileFieldActive;
window.mfPrevDay = mfPrevDay;
window.mfNextDay = mfNextDay;
window.mfSwitchTab = mfSwitchTab;
window.mfNavigate = mfNavigate;
window.mfShowVisitForm = mfShowVisitForm; // Defined in mobile-visit-form.js
window.mfShowCustomerInfo = mfShowCustomerInfo;
window.mfStartRoute = mfStartRoute;
window.mfCompleteRoute = mfCompleteRoute;
window.mfLogout = mfLogout;
window.mfLoadRoute = mfLoadRoute;
window.mfNavigateAndCloseInfo = mfNavigateAndCloseInfo;
window.mfSetEstimertTid = mfSetEstimertTid;
window.mfSetEstimertTidHandler = mfSetEstimertTidHandler;
window.mfNotifyCustomer = mfNotifyCustomer;

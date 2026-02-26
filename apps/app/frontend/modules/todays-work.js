// ============================================
// TODAY'S WORK (Dagens arbeid)
// ============================================

let twCurrentDate = new Date().toISOString().split('T')[0];
let twRouteData = null;

function initTodaysWork() {
  // Show tab if feature is enabled
  if (hasFeature('todays_work')) {
    const tab = document.getElementById('todaysWorkTab');
    if (tab) tab.style.display = '';
  }

  // Date navigation
  document.getElementById('twPrevDay')?.addEventListener('click', () => {
    const d = new Date(twCurrentDate);
    d.setDate(d.getDate() - 1);
    twCurrentDate = d.toISOString().split('T')[0];
    loadTodaysWork();
  });

  document.getElementById('twNextDay')?.addEventListener('click', () => {
    const d = new Date(twCurrentDate);
    d.setDate(d.getDate() + 1);
    twCurrentDate = d.toISOString().split('T')[0];
    loadTodaysWork();
  });

  // Start route button
  document.getElementById('twStartRouteBtn')?.addEventListener('click', startTodaysRoute);
}

async function loadTodaysWork() {
  const dateLabel = document.getElementById('twDateLabel');
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  if (twCurrentDate === today) {
    dateLabel.textContent = 'I dag';
  } else if (twCurrentDate === tomorrow) {
    dateLabel.textContent = 'I morgen';
  } else {
    const d = new Date(twCurrentDate);
    dateLabel.textContent = d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/my-route?date=${twCurrentDate}`, {
      headers: { 'X-CSRF-Token': csrfToken }
    });
    if (!response.ok) return;
    const json = await response.json();

    if (json.success && json.data) {
      twRouteData = json.data;
      renderTodaysWork();
      // Cache for offline use
      if (window.OfflineStorage) {
        const userId = localStorage.getItem('userId') || '0';
        OfflineStorage.saveTodaysRoute(twCurrentDate, userId, json.data).catch(() => {});
        OfflineStorage.setLastSyncTime().catch(() => {});
      }
    } else {
      twRouteData = null;
      document.getElementById('twRouteCard').style.display = 'none';
      document.getElementById('twStopsList').innerHTML = '';
      document.getElementById('twEmpty').style.display = 'flex';
      updateTodaysWorkBadge(0, 0);
    }
  } catch (err) {
    console.error('Error loading todays work:', err);
    // Try offline fallback
    if (window.OfflineStorage && !navigator.onLine) {
      const userId = localStorage.getItem('userId') || '0';
      const cached = await OfflineStorage.getTodaysRoute(twCurrentDate, userId);
      if (cached) {
        twRouteData = cached;
        renderTodaysWork();
        showNotification('Viser lagret rute (frakoblet)', 'warning');
        return;
      }
    }
    showNotification('Kunne ikke laste dagens rute', 'error');
  }
}

function renderTodaysWork() {
  const route = twRouteData;
  if (!route) return;

  document.getElementById('twEmpty').style.display = 'none';
  document.getElementById('twRouteCard').style.display = 'block';

  document.getElementById('twRouteName').textContent = escapeHtml(route.navn || 'Rute');

  const isStarted = !!route.execution_started_at;
  const isCompleted = !!route.execution_ended_at;
  const statusEl = document.getElementById('twRouteStatus');

  if (isCompleted) {
    statusEl.textContent = 'Fullført';
    statusEl.className = 'tw-route-status tw-status-completed';
    document.getElementById('twStartRouteBtn').style.display = 'none';
  } else if (isStarted) {
    statusEl.textContent = 'Pågår';
    statusEl.className = 'tw-route-status tw-status-active';
    document.getElementById('twStartRouteBtn').style.display = 'none';
  } else {
    statusEl.textContent = 'Planlagt';
    statusEl.className = 'tw-route-status tw-status-planned';
    document.getElementById('twStartRouteBtn').style.display = '';
  }

  const completed = isStarted ? (route.completed_count || 0) : 0;
  const total = route.total_count || 0;
  document.getElementById('twCompleted').textContent = completed;
  document.getElementById('twTotal').textContent = total;

  const pct = total > 0 ? (completed / total) * 100 : 0;
  document.getElementById('twProgressFill').style.width = pct + '%';

  if (route.total_distanse) {
    document.getElementById('twDistanceStat').style.display = '';
    document.getElementById('twDistance').textContent = (route.total_distanse / 1000).toFixed(1) + ' km';
  }

  updateTodaysWorkBadge(completed, total);

  // Render customer stops
  const stopsList = document.getElementById('twStopsList');
  const kunder = route.kunder || [];
  const visits = route.visits || [];

  if (kunder.length === 0) {
    stopsList.innerHTML = '<p class="tw-no-stops">Ingen kunder på denne ruten.</p>';
    return;
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

  // Show prominent "Next Stop" card on mobile when route is active
  if (isStarted && !isCompleted && nextStopIndex >= 0) {
    const nextKunde = kunder[nextStopIndex];
    const address = [nextKunde.adresse, nextKunde.postnummer, nextKunde.poststed].filter(Boolean).join(', ');
    html += `
      <div class="tw-next-stop-card">
        <div class="tw-next-stop-label">
          <i aria-hidden="true" class="fas fa-arrow-right"></i> Neste stopp (${nextStopIndex + 1}/${kunder.length})
        </div>
        <h3 class="tw-next-stop-name">${escapeHtml(nextKunde.navn)}</h3>
        <p class="tw-next-stop-address">${escapeHtml(address)}</p>
        ${nextKunde.telefon ? `<p class="tw-next-stop-phone"><i aria-hidden="true" class="fas fa-phone"></i> ${escapeHtml(nextKunde.telefon)}</p>` : ''}
        <div class="tw-next-stop-actions">
          <button class="btn btn-primary tw-next-nav-btn" onclick="twNavigateToCustomer(${nextKunde.id})">
            <i aria-hidden="true" class="fas fa-directions"></i> Naviger hit
          </button>
          ${nextKunde.telefon ? `<a href="tel:${escapeHtml(nextKunde.telefon)}" class="btn btn-secondary tw-next-call-btn"><i aria-hidden="true" class="fas fa-phone"></i> Ring</a>` : ''}
          <button class="btn btn-success tw-next-done-btn" onclick="twMarkVisited(${nextKunde.id})">
            <i aria-hidden="true" class="fas fa-check"></i> Fullført
          </button>
        </div>
      </div>
    `;
  }

  // Render stops list - visited stops collapsed, next highlighted
  const visitedStops = [];
  const remainingStops = [];

  kunder.forEach((kunde, index) => {
    const visit = isStarted ? visits.find(v => v.kunde_id === kunde.id) : null;
    const isVisited = visit && visit.completed === true;
    const isNextStop = index === nextStopIndex;

    const card = `
      <div class="tw-stop-card ${isVisited ? 'tw-stop-completed' : ''} ${isNextStop ? 'tw-stop-next' : ''}" data-kunde-id="${kunde.id}">
        <div class="tw-stop-number">${index + 1}</div>
        <div class="tw-stop-info">
          <h4>${escapeHtml(kunde.navn)}</h4>
          ${!isVisited ? `<p>${escapeHtml(kunde.adresse || '')}${kunde.poststed ? ', ' + escapeHtml(kunde.poststed) : ''}</p>` : ''}
          ${!isVisited && kunde.telefon ? `<p class="tw-stop-phone">${escapeHtml(kunde.telefon)}</p>` : ''}
        </div>
        <div class="tw-stop-actions">
          ${!isVisited && kunde.telefon ? `<a href="tel:${escapeHtml(kunde.telefon)}" class="btn btn-icon btn-small tw-action-call" title="Ring"><i aria-hidden="true" class="fas fa-phone"></i></a>` : ''}
          ${!isVisited ? `<button class="btn btn-icon btn-small tw-action-nav" onclick="twNavigateToCustomer(${kunde.id})" title="Naviger"><i aria-hidden="true" class="fas fa-directions"></i></button>` : ''}
          ${isVisited
            ? '<span class="tw-visited-check"><i aria-hidden="true" class="fas fa-check-circle"></i></span>'
            : `<button class="btn btn-icon btn-small tw-action-visit" onclick="twMarkVisited(${kunde.id})" title="Marker besøkt"><i aria-hidden="true" class="fas fa-check"></i></button>`
          }
        </div>
      </div>
    `;

    if (isVisited) {
      visitedStops.push(card);
    } else {
      remainingStops.push(card);
    }
  });

  // Show remaining stops first, then collapsed visited section
  html += remainingStops.join('');

  if (visitedStops.length > 0) {
    html += `
      <div class="tw-visited-section">
        <button class="tw-visited-toggle" onclick="this.parentElement.classList.toggle('expanded')">
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <span>Besøkt (${visitedStops.length})</span>
          <i aria-hidden="true" class="fas fa-chevron-down tw-visited-chevron"></i>
        </button>
        <div class="tw-visited-list">
          ${visitedStops.join('')}
        </div>
      </div>
    `;
  }

  stopsList.innerHTML = html;
}

function updateTodaysWorkBadge(completed, total) {
  const badge = document.getElementById('todaysWorkBadge');
  if (badge) {
    if (total > 0) {
      badge.textContent = `${completed}/${total}`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}

async function startTodaysRoute() {
  if (!twRouteData) return;

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/start-route/${twRouteData.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
    });
    const json = await response.json();
    if (json.success) {
      showNotification('Rute startet!', 'success');
      loadTodaysWork();
    }
  } catch (err) {
    showNotification('Kunne ikke starte ruten', 'error');
  }
}

async function twMarkVisited(kundeId) {
  if (!twRouteData) return;

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/visit/${kundeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ rute_id: twRouteData.id, completed: true })
    });
    const json = await response.json();
    if (json.success) {
      showNotification('Kunde markert som besøkt', 'success');
      loadTodaysWork();
    }
  } catch (err) {
    // Offline: optimistic update + queue for sync
    if (!navigator.onLine && window.SyncManager) {
      // Update local state optimistically
      if (twRouteData.visits) {
        const existing = twRouteData.visits.find(v => v.kunde_id === kundeId);
        if (existing) {
          existing.completed = true;
          existing.visited_at = new Date().toISOString();
        } else {
          twRouteData.visits.push({ kunde_id: kundeId, completed: true, visited_at: new Date().toISOString() });
        }
      }
      twRouteData.completed_count = (twRouteData.completed_count || 0) + 1;
      renderTodaysWork();

      // Queue for sync
      await SyncManager.queueOfflineAction({
        type: 'VISIT_CUSTOMER',
        url: `/api/todays-work/visit/${kundeId}`,
        method: 'POST',
        body: { rute_id: twRouteData.id, completed: true }
      });

      // Update offline cache
      if (window.OfflineStorage) {
        const userId = localStorage.getItem('userId') || '0';
        OfflineStorage.saveTodaysRoute(twCurrentDate, userId, twRouteData).catch(() => {});
      }

      showNotification('Besøk registrert (synkroniseres når du er online)', 'warning');
    } else {
      showNotification('Kunne ikke registrere besøk', 'error');
    }
  }
}

function twNavigateToCustomer(kundeId) {
  const kunde = twRouteData?.kunder?.find(k => k.id === kundeId);
  if (!kunde) return;

  const address = [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean).join(', ');

  if (kunde.latitude && kunde.longitude) {
    // Use coordinates for precision
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      window.open(`maps://maps.apple.com/?daddr=${kunde.latitude},${kunde.longitude}&dirflg=d`);
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${kunde.latitude},${kunde.longitude}`);
    }
  } else if (address) {
    // Fallback to address
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`);
  }
}

window.twMarkVisited = twMarkVisited;
window.twNavigateToCustomer = twNavigateToCustomer;

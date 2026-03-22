// ============================================
// MOBILE WEEKPLAN EDITOR — Touch-friendly weekly plan editor
// Full-screen overlay for editing the weekly plan on mobile/tablet.
// Supports drag-and-drop reordering, day-to-day moves, technician
// assignment, customer search & add, and swipe-to-delete.
// ============================================

let mfWeekplanState = {
  weekStart: null,        // Date object (Monday)
  days: {},               // { 'mandag': { date: 'YYYY-MM-DD', stops: [{ ruteId, kundeId, kundeNavn, adresse, assignedTo, assignedToId, estimertTid, rekkefolge }] }, ... }
  teamMembers: [],        // cached team members
  routes: {},             // cached raw route data keyed by id
  dirty: false,           // unsaved changes flag
  dirtyGen: 0,            // generation counter — incremented on each change, used to detect concurrent edits during async save
  activeDay: 0            // index of currently visible day (0-4)
};

let mfWpAutoSaveTimer = null;
let mfWpSaving = false;

function mfWpScheduleAutoSave() {
  if (mfWpAutoSaveTimer) clearTimeout(mfWpAutoSaveTimer);
  mfWpAutoSaveTimer = setTimeout(() => {
    if (mfWeekplanState.dirty && !mfWpSaving) {
      mfWpSave();
    }
  }, 500);
}

const mfWpDayKeys = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag'];
const mfWpDayLabels = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'];

// ---- Drag state ----
let mfWpDragState = {
  active: false,
  element: null,
  ghostEl: null,
  kundeId: null,
  fromDay: null,
  startX: 0,
  startY: 0,
  offsetX: 0,
  offsetY: 0,
  longPressTimer: null,
  scrolling: false
};

// ---- Week helpers ----

function mfWpGetMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  if (day !== 1) {
    d.setDate(d.getDate() - ((day + 6) % 7));
  }
  return d;
}

function mfWpFormatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mfWpGetWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d - yearStart) / 86400000 + yearStart.getDay() + 6) / 7);
}

function mfWpGetInitials(name) {
  if (!name) return '??';
  name = String(name);
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// ---- Open / Close ----

function mfShowWeekplanEditor() {
  // Remove any existing overlay
  const existing = document.querySelector('.mf-weekplan-overlay');
  if (existing) existing.remove();

  // Initialize state
  mfWeekplanState.weekStart = mfWpGetMonday(new Date());
  mfWeekplanState.dirty = false;
  mfWeekplanState.activeDay = 0;

  // Init days
  mfWpInitDays();

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'mf-weekplan-overlay';
  overlay.id = 'mfWeekplanOverlay';

  const weekNum = mfWpGetWeekNumber(mfWeekplanState.weekStart);

  overlay.innerHTML = `
    <div class="mf-weekplan-header">
      <button class="mf-weekplan-close" data-action="mfCloseWeekplanEditor" aria-label="Lukk">
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>
      <div class="mf-weekplan-title-group">
        <button class="mf-weekplan-nav" data-action="mfWpNavigateWeek" data-args='[-1]' aria-label="Forrige uke">
          <i class="fas fa-chevron-left" aria-hidden="true"></i>
        </button>
        <h3 id="mfWpTitle">Uke ${weekNum}</h3>
        <button class="mf-weekplan-nav" data-action="mfWpNavigateWeek" data-args='[1]' aria-label="Neste uke">
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div class="mf-weekplan-day-dots" id="mfWpDayDots"></div>

    <div class="mf-weekplan-days" id="mfWpDaysContainer"></div>

    <div class="mf-weekplan-loading" id="mfWpLoading">
      <div class="mf-spinner"></div>
      <p>Laster ukeplan...</p>
    </div>
  `;

  const mfv = document.getElementById('mobileFieldView');
  const mountTarget = (mfv && mfv.style.display !== 'none') ? mfv : document.body;
  mountTarget.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add('open');
  });

  // Load data
  mfWpLoadWeek();
}

async function mfCloseWeekplanEditor() {
  // Cancel any pending auto-save timer
  if (mfWpAutoSaveTimer) { clearTimeout(mfWpAutoSaveTimer); mfWpAutoSaveTimer = null; }

  // Wait for any in-progress save, then save pending changes
  if (mfWpSaving) {
    // Wait for current save to finish (max 5s)
    for (let i = 0; i < 50 && mfWpSaving; i++) await new Promise(r => setTimeout(r, 100));
  }
  if (mfWeekplanState.dirty) {
    await mfWpSave();
  }

  const overlay = document.getElementById('mfWeekplanOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 300);
  }

  mfWeekplanState.dirty = false;
  mfWpCleanupDrag();

  // Refresh all views that depend on ruter/avtaler
  if (typeof raoLoadWeekData === 'function') raoLoadWeekData();
  if (typeof updateWeekPlanBadges === 'function') updateWeekPlanBadges();
  if (typeof loadAvtaler === 'function') {
    loadAvtaler().then(() => {
      if (typeof renderWeeklyPlan === 'function') renderWeeklyPlan();
    });
  }
}

// ---- Init days structure ----

function mfWpInitDays() {
  mfWeekplanState.days = {};
  const start = new Date(mfWeekplanState.weekStart);
  for (let i = 0; i < 5; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    mfWeekplanState.days[mfWpDayKeys[i]] = {
      date: mfWpFormatDate(d),
      stops: []
    };
  }
}

// ---- Load week data ----

async function mfWpLoadWeek() {
  const loading = document.getElementById('mfWpLoading');
  const container = document.getElementById('mfWpDaysContainer');
  if (loading) loading.style.display = 'flex';
  if (container) container.style.display = 'none';

  // Update title
  const weekNum = mfWpGetWeekNumber(mfWeekplanState.weekStart);
  const titleEl = document.getElementById('mfWpTitle');
  if (titleEl) titleEl.textContent = `Uke ${weekNum}`;

  // Init fresh days
  mfWpInitDays();

  try {
    // Load routes and team members in parallel
    const csrfToken = getCsrfToken();
    const [ruterResp, teamResp] = await Promise.all([
      fetch('/api/ruter', {
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'include'
      }),
      fetch('/api/team-members', {
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'include'
      })
    ]);

    const ruterJson = await ruterResp.json();
    const teamJson = await teamResp.json();

    if (teamJson.success && teamJson.data) {
      const members = Array.isArray(teamJson.data) ? teamJson.data : (teamJson.data.members || []);
      mfWeekplanState.teamMembers = members.filter(m => m.aktiv);
    }

    const rawRouteData = ruterJson.success ? ruterJson.data : [];
    const allRoutes = Array.isArray(rawRouteData) ? rawRouteData : (rawRouteData?.data || []);

    // Filter routes for this week's dates
    const weekDates = new Set();
    for (const dayKey of mfWpDayKeys) {
      weekDates.add(mfWeekplanState.days[dayKey].date);
    }

    const weekRoutes = allRoutes.filter(r => r.planlagt_dato && weekDates.has(r.planlagt_dato));

    // For each matching route, load its customers
    const routeDetails = await Promise.all(
      weekRoutes.map(async (route) => {
        try {
          const detailResp = await fetch(`/api/ruter/${route.id}`, {
            headers: { 'X-CSRF-Token': csrfToken },
            credentials: 'include'
          });
          const detailJson = await detailResp.json();
          return detailJson.success ? detailJson.data : null;
        } catch {
          return null;
        }
      })
    );

    // Build team member lookup map: id → name
    const teamLookup = new Map();
    if (mfWeekplanState.teamMembers) {
      for (const m of mfWeekplanState.teamMembers) {
        teamLookup.set(m.id, m.navn || m.name || '');
      }
    }

    // Map routes to days
    mfWeekplanState.routes = {};
    routeDetails.forEach(route => {
      if (!route) return;
      mfWeekplanState.routes[route.id] = route;

      // Find which day this route belongs to
      const dayKey = mfWpDayKeys.find(k => mfWeekplanState.days[k].date === route.planlagt_dato);
      if (!dayKey) return;

      // Resolve technician name from ID
      const rawAssignedTo = route.assigned_to;
      let assignedToId = null;
      let assignedToName = '';

      if (typeof rawAssignedTo === 'number') {
        assignedToId = rawAssignedTo;
        assignedToName = teamLookup.get(rawAssignedTo) || '';
      } else if (typeof rawAssignedTo === 'string' && rawAssignedTo) {
        // Already a name (shouldn't happen, but handle gracefully)
        assignedToName = rawAssignedTo;
      }

      const kunder = route.kunder || [];

      kunder.forEach((kunde, idx) => {
        mfWeekplanState.days[dayKey].stops.push({
          ruteId: route.id,
          kundeId: kunde.id,
          kundeNavn: kunde.navn || 'Ukjent',
          adresse: [kunde.adresse, kunde.poststed].filter(Boolean).join(', '),
          assignedTo: assignedToName,
          assignedToId: assignedToId,
          estimertTid: kunde.estimert_tid || 30,
          rekkefolge: kunde.rekkefolge || idx
        });
      });

      // Sort stops by rekkefolge
      mfWeekplanState.days[dayKey].stops.sort((a, b) => a.rekkefolge - b.rekkefolge);

      // Track known route IDs for this day (needed for delete/update save logic)
      if (!mfWeekplanState.days[dayKey].knownRouteIds) {
        mfWeekplanState.days[dayKey].knownRouteIds = new Set();
      }
      mfWeekplanState.days[dayKey].knownRouteIds.add(route.id);
    });

  } catch (err) {
    console.error('Mobile weekplan: Error loading week data:', err);
    mfShowBanner('Kunne ikke laste ukeplan', 'error');
  }

  if (loading) loading.style.display = 'none';
  if (container) container.style.display = 'flex';

  mfWeekplanState.dirty = false;
  mfWpUpdateSaveBtn();
  mfWpRenderDots();
  mfWpRenderDays();
  mfWpInitDragDrop();
  mfWpSetupScrollSnap();
}

// ---- Week navigation ----

async function mfWpNavigateWeek(direction) {
  // Save pending changes before switching week
  if (mfWpAutoSaveTimer) { clearTimeout(mfWpAutoSaveTimer); mfWpAutoSaveTimer = null; }
  if (mfWeekplanState.dirty && !mfWpSaving) {
    await mfWpSave();
  }
  const d = new Date(mfWeekplanState.weekStart);
  d.setDate(d.getDate() + (direction * 7));
  mfWeekplanState.weekStart = mfWpGetMonday(d);
  mfWeekplanState.activeDay = 0;
  mfWpLoadWeek();
}

// ---- Render day dots ----

function mfWpRenderDots() {
  const dotsEl = document.getElementById('mfWpDayDots');
  if (!dotsEl) return;

  let html = '';
  mfWpDayKeys.forEach((dayKey, i) => {
    const dayData = mfWeekplanState.days[dayKey];
    const count = dayData ? dayData.stops.length : 0;
    const isActive = i === mfWeekplanState.activeDay;
    const dayDate = dayData ? new Date(dayData.date) : null;
    const dayLabel = dayDate ? dayDate.getDate() : '';
    const shortLabel = mfWpDayLabels[i].substring(0, 3);

    html += `
      <button class="mf-wp-dot ${isActive ? 'active' : ''}" data-action="mfWpScrollToDay" data-args='[${i}]' aria-label="${mfWpDayLabels[i]}">
        <span class="mf-wp-dot-label">${escapeHtml(shortLabel)}</span>
        <span class="mf-wp-dot-date">${escapeHtml(String(dayLabel))}</span>
        ${count > 0 ? `<span class="mf-wp-dot-count">${count}</span>` : ''}
      </button>
    `;
  });

  dotsEl.innerHTML = html;
}

// ---- Render all days ----

function mfWpRenderDays() {
  const container = document.getElementById('mfWpDaysContainer');
  if (!container) return;

  let html = '';
  mfWpDayKeys.forEach((dayKey, i) => {
    html += mfWpRenderDay(dayKey, i);
  });

  container.innerHTML = html;
}

// ---- Render one day column ----

function mfWpRenderDay(dayKey, dayIndex) {
  const dayData = mfWeekplanState.days[dayKey];
  if (!dayData) return '';

  const dayDate = new Date(dayData.date);
  const dayNum = dayDate.getDate();
  const monthName = dayDate.toLocaleDateString('nb-NO', { month: 'short' });
  const stops = dayData.stops || [];
  const todayStr = mfWpFormatDate(new Date());
  const isToday = dayData.date === todayStr;

  // Group stops by technician
  const techGroups = new Map();
  const unassigned = [];

  stops.forEach((stop, idx) => {
    const tech = stop.assignedTo || '';
    if (!tech) {
      unassigned.push({ ...stop, displayIndex: idx + 1 });
    } else {
      if (!techGroups.has(tech)) {
        techGroups.set(tech, []);
      }
      techGroups.get(tech).push({ ...stop, displayIndex: idx + 1 });
    }
  });

  let stopsHtml = '';

  // Render tech groups
  techGroups.forEach((techStops, techName) => {
    const initials = mfWpGetInitials(techName);
    const techId = techStops[0]?.assignedToId || '';

    stopsHtml += `
      <div class="mf-wp-tech-group" data-tech-name="${escapeHtml(techName)}">
        <div class="mf-wp-tech-header">
          <span class="mf-wp-tech-avatar">${escapeHtml(initials)}</span>
          <span class="mf-wp-tech-name">${escapeHtml(techName)}</span>
          <span class="mf-wp-tech-count">${techStops.length} stopp</span>
        </div>
        ${techStops.map((stop, idx) => mfWpRenderStop(stop, dayKey, idx)).join('')}
      </div>
    `;
  });

  // Render unassigned stops
  if (unassigned.length > 0) {
    stopsHtml += `
      <div class="mf-wp-tech-group mf-wp-unassigned" data-tech-name="">
        <div class="mf-wp-tech-header">
          <span class="mf-wp-tech-avatar mf-wp-tech-unassigned">?</span>
          <span class="mf-wp-tech-name">Ikke tildelt</span>
          <span class="mf-wp-tech-count">${unassigned.length} stopp</span>
        </div>
        ${unassigned.map((stop, idx) => mfWpRenderStop(stop, dayKey, idx)).join('')}
      </div>
    `;
  }

  // Empty state
  if (stops.length === 0) {
    stopsHtml = `
      <div class="mf-wp-empty">
        <i class="fas fa-calendar-plus" aria-hidden="true"></i>
        <p>Ingen stopp</p>
      </div>
    `;
  }

  return `
    <div class="mf-weekplan-day ${isToday ? 'mf-wp-today' : ''}" data-day="${escapeHtml(dayKey)}" data-day-index="${dayIndex}">
      <div class="mf-weekplan-day-header">
        <div class="mf-wp-day-title">
          <h4>${escapeHtml(mfWpDayLabels[dayIndex])} ${dayNum}. ${escapeHtml(monthName)}</h4>
          ${isToday ? '<span class="mf-wp-today-badge">I dag</span>' : ''}
        </div>
        <div class="mf-wp-day-meta">
          <span class="mf-day-count">${stops.length} stopp</span>
          ${stops.length > 0 ? `<button class="mf-day-assign-all" data-action="mfWpShowAssignAll" data-args='["${escapeHtml(dayKey)}"]' title="Tildel alle" aria-label="Tildel alle">
            <i class="fas fa-user-check" aria-hidden="true"></i>
          </button>` : ''}
          <button class="mf-day-add" data-action="mfWpAddCustomer" data-args='["${escapeHtml(dayKey)}"]' title="Legg til kunde" aria-label="Legg til kunde">
            <i class="fas fa-plus" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="mf-wp-stops-list" data-day="${escapeHtml(dayKey)}">
        ${stopsHtml}
      </div>
    </div>
  `;
}

// ---- Render single stop card ----

function mfWpRenderStop(stop, dayKey, index) {
  const estMin = stop.estimertTid || 30;
  const assignedLabel = stop.assignedTo ? escapeHtml(stop.assignedTo) : '';
  return `
    <div class="mf-wp-stop" data-kunde-id="${stop.kundeId}" data-day="${escapeHtml(dayKey)}" data-rute-id="${stop.ruteId}">
      <div class="mf-wp-stop-delete" aria-hidden="true">
        <i class="fas fa-trash-alt" aria-hidden="true"></i>
      </div>
      <div class="mf-wp-stop-content">
        <div class="mf-wp-stop-num">${index + 1}</div>
        <div class="mf-wp-stop-info">
          <span class="mf-wp-stop-name">${escapeHtml(stop.kundeNavn)}</span>
          <span class="mf-wp-stop-addr">${escapeHtml(stop.adresse)}</span>
          <span class="mf-wp-stop-meta">
            ${assignedLabel ? `<span class="mf-wp-stop-tech"><i class="fas fa-user" aria-hidden="true"></i> ${assignedLabel}</span>` : ''}
            <span class="mf-wp-stop-time">
              <i class="fas fa-clock" aria-hidden="true"></i>
              <input type="number" class="mf-wp-est-input" value="${estMin}" min="5" step="5"
                data-on-change="mfWpSetEstimertTidHandler" data-args='[${stop.kundeId}, "${escapeHtml(dayKey)}"]'>min
            </span>
          </span>
        </div>
        <div class="mf-wp-stop-actions">
          <button class="mf-wp-reassign" data-action="mfWpShowReassign" data-args='[${stop.kundeId}, "${escapeHtml(dayKey)}"]' title="Tilordne teammedlem" aria-label="Tilordne teammedlem">
            <i class="fas fa-user" aria-hidden="true"></i>
          </button>
          <button class="mf-wp-delete-btn" data-action="mfWpRemoveStop" data-args='[${stop.kundeId}, "${escapeHtml(dayKey)}"]' title="Fjern kunde" aria-label="Fjern kunde">
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ---- Scroll snap setup ----

function mfWpSetupScrollSnap() {
  const container = document.getElementById('mfWpDaysContainer');
  if (!container) return;

  let scrollTimer = null;
  container.addEventListener('scroll', () => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      // Detect which day is in view
      const scrollLeft = container.scrollLeft;
      const dayWidth = container.querySelector('.mf-weekplan-day')?.offsetWidth || container.clientWidth;
      const gap = 12;
      const newIndex = Math.round(scrollLeft / (dayWidth + gap));
      const clampedIndex = Math.max(0, Math.min(4, newIndex));

      if (clampedIndex !== mfWeekplanState.activeDay) {
        mfWeekplanState.activeDay = clampedIndex;
        mfWpRenderDots();
      }
    }, 100);
  }, { passive: true });
}

function mfWpScrollToDay(dayIndex) {
  mfWeekplanState.activeDay = dayIndex;
  mfWpRenderDots();

  const container = document.getElementById('mfWpDaysContainer');
  if (!container) return;

  const dayEl = container.querySelector(`.mf-weekplan-day[data-day-index="${dayIndex}"]`);
  if (dayEl) {
    dayEl.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }
}

// ---- Touch drag-and-drop ----

function mfWpInitDragDrop() {
  const container = document.getElementById('mfWpDaysContainer');
  if (!container) return;

  // Remove old listeners by replacing the container's event delegation
  container.addEventListener('touchstart', mfWpOnTouchStart, { passive: false });
  container.addEventListener('touchmove', mfWpOnTouchMove, { passive: false });
  container.addEventListener('touchend', mfWpOnTouchEnd, { passive: false });

  // Swipe-to-delete setup
  mfWpInitSwipeDelete(container);
}

function mfWpOnTouchStart(e) {
  const stopEl = e.target.closest('.mf-wp-stop');
  if (!stopEl) return;

  // Don't intercept taps on buttons
  if (e.target.closest('button') || e.target.closest('a')) return;

  const touch = e.touches[0];
  mfWpDragState.startX = touch.clientX;
  mfWpDragState.startY = touch.clientY;
  mfWpDragState.element = stopEl;
  mfWpDragState.scrolling = false;

  // Start long press timer (300ms)
  mfWpDragState.longPressTimer = setTimeout(() => {
    if (!mfWpDragState.scrolling) {
      mfWpActivateDrag(stopEl, touch);
    }
  }, 300);
}

function mfWpOnTouchMove(e) {
  if (mfWpDragState.active) {
    e.preventDefault();
    const touch = e.touches[0];
    mfWpMoveDrag(touch);
    return;
  }

  // Check if user has moved enough to be considered scrolling
  if (mfWpDragState.longPressTimer) {
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - mfWpDragState.startX);
    const dy = Math.abs(touch.clientY - mfWpDragState.startY);
    if (dx > 10 || dy > 10) {
      // It's a scroll, cancel long press
      clearTimeout(mfWpDragState.longPressTimer);
      mfWpDragState.longPressTimer = null;
      mfWpDragState.scrolling = true;
    }
  }
}

function mfWpOnTouchEnd(e) {
  if (mfWpDragState.longPressTimer) {
    clearTimeout(mfWpDragState.longPressTimer);
    mfWpDragState.longPressTimer = null;
  }

  if (mfWpDragState.active) {
    mfWpEndDrag(e);
    return;
  }
}

function mfWpActivateDrag(stopEl, touch) {
  const kundeId = parseInt(stopEl.dataset.kundeId);
  const fromDay = stopEl.dataset.day;
  if (!kundeId || !fromDay) return;

  // Haptic feedback
  if (navigator.vibrate) navigator.vibrate(50);

  mfWpDragState.active = true;
  mfWpDragState.kundeId = kundeId;
  mfWpDragState.fromDay = fromDay;

  // Get the stop content element (not the delete bg)
  const contentEl = stopEl.querySelector('.mf-wp-stop-content');

  // Create ghost
  const rect = stopEl.getBoundingClientRect();
  const ghost = stopEl.cloneNode(true);
  ghost.className = 'mf-wp-stop mf-wp-drag-ghost';
  ghost.style.position = 'fixed';
  ghost.style.width = rect.width + 'px';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.zIndex = '10001';
  ghost.style.pointerEvents = 'none';

  document.body.appendChild(ghost);
  mfWpDragState.ghostEl = ghost;
  mfWpDragState.offsetX = touch.clientX - rect.left;
  mfWpDragState.offsetY = touch.clientY - rect.top;

  // Mark original as placeholder
  stopEl.classList.add('mf-wp-drag-placeholder');

  // Show drop zones
  document.querySelectorAll('.mf-wp-stops-list').forEach(list => {
    list.classList.add('mf-wp-drop-active');
  });
}

function mfWpMoveDrag(touch) {
  const ghost = mfWpDragState.ghostEl;
  if (!ghost) return;

  ghost.style.left = (touch.clientX - mfWpDragState.offsetX) + 'px';
  ghost.style.top = (touch.clientY - mfWpDragState.offsetY) + 'px';

  // Detect drop target via elementFromPoint
  ghost.style.display = 'none';
  const target = document.elementFromPoint(touch.clientX, touch.clientY);
  ghost.style.display = '';

  // Remove all drop indicators
  document.querySelectorAll('.mf-wp-drop-indicator').forEach(el => el.remove());
  document.querySelectorAll('.mf-wp-stop.mf-wp-drop-above').forEach(el => el.classList.remove('mf-wp-drop-above'));
  document.querySelectorAll('.mf-wp-stop.mf-wp-drop-below').forEach(el => el.classList.remove('mf-wp-drop-below'));

  if (!target) return;

  // Find nearest stop card or stops list
  const targetStop = target.closest('.mf-wp-stop:not(.mf-wp-drag-placeholder):not(.mf-wp-drag-ghost)');
  const targetList = target.closest('.mf-wp-stops-list');

  if (targetStop) {
    const rect = targetStop.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (touch.clientY < midY) {
      targetStop.classList.add('mf-wp-drop-above');
    } else {
      targetStop.classList.add('mf-wp-drop-below');
    }
  } else if (targetList) {
    // Dropping into empty area of the list
    targetList.classList.add('mf-wp-drop-zone-highlight');
    setTimeout(() => targetList.classList.remove('mf-wp-drop-zone-highlight'), 200);
  }

  // Auto-scroll horizontal container if near edges
  const container = document.getElementById('mfWpDaysContainer');
  if (container) {
    const cRect = container.getBoundingClientRect();
    const edgeThreshold = 50;
    if (touch.clientX < cRect.left + edgeThreshold) {
      container.scrollLeft -= 8;
    } else if (touch.clientX > cRect.right - edgeThreshold) {
      container.scrollLeft += 8;
    }
  }
}

function mfWpEndDrag() {
  if (!mfWpDragState.active) return;

  const ghost = mfWpDragState.ghostEl;
  if (ghost) {
    // Find drop target under ghost center
    const ghostRect = ghost.getBoundingClientRect();
    const cx = ghostRect.left + ghostRect.width / 2;
    const cy = ghostRect.top + ghostRect.height / 2;

    ghost.style.display = 'none';
    const target = document.elementFromPoint(cx, cy);
    ghost.style.display = '';

    if (target) {
      const targetStop = target.closest('.mf-wp-stop:not(.mf-wp-drag-placeholder):not(.mf-wp-drag-ghost)');
      const targetDay = target.closest('.mf-weekplan-day');

      if (targetDay) {
        const toDay = targetDay.dataset.day;
        let newIndex = -1;

        if (targetStop) {
          const targetKundeId = parseInt(targetStop.dataset.kundeId);
          const targetDayData = mfWeekplanState.days[toDay];
          const targetIdx = targetDayData.stops.findIndex(s => s.kundeId === targetKundeId);

          const rect = targetStop.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          newIndex = cy < midY ? targetIdx : targetIdx + 1;
        } else {
          // Drop at end
          newIndex = mfWeekplanState.days[toDay].stops.length;
        }

        mfWpOnDrop(mfWpDragState.kundeId, mfWpDragState.fromDay, toDay, newIndex);
      }
    }

    ghost.remove();
  }

  // Cleanup
  mfWpCleanupDrag();
  mfWpRenderDays();
  mfWpRenderDots();
  mfWpInitDragDrop();
}

function mfWpCleanupDrag() {
  if (mfWpDragState.longPressTimer) {
    clearTimeout(mfWpDragState.longPressTimer);
  }
  if (mfWpDragState.ghostEl) {
    mfWpDragState.ghostEl.remove();
  }

  document.querySelectorAll('.mf-wp-drag-placeholder').forEach(el => el.classList.remove('mf-wp-drag-placeholder'));
  document.querySelectorAll('.mf-wp-drop-active').forEach(el => el.classList.remove('mf-wp-drop-active'));
  document.querySelectorAll('.mf-wp-drop-above').forEach(el => el.classList.remove('mf-wp-drop-above'));
  document.querySelectorAll('.mf-wp-drop-below').forEach(el => el.classList.remove('mf-wp-drop-below'));
  document.querySelectorAll('.mf-wp-drop-indicator').forEach(el => el.remove());

  mfWpDragState = {
    active: false,
    element: null,
    ghostEl: null,
    kundeId: null,
    fromDay: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    longPressTimer: null,
    scrolling: false
  };
}

// ---- Drop handler ----

function mfWpOnDrop(kundeId, fromDay, toDay, newIndex) {
  const fromStops = mfWeekplanState.days[fromDay].stops;
  const stopIdx = fromStops.findIndex(s => s.kundeId === kundeId);
  if (stopIdx === -1) return;

  const stop = fromStops[stopIdx];

  // Remove from source
  fromStops.splice(stopIdx, 1);

  // Adjust index if moving within same day and from above target
  let insertIdx = newIndex;
  if (fromDay === toDay && stopIdx < newIndex) {
    insertIdx = Math.max(0, newIndex - 1);
  }

  // Insert into target
  const toStops = mfWeekplanState.days[toDay].stops;
  insertIdx = Math.max(0, Math.min(insertIdx, toStops.length));
  toStops.splice(insertIdx, 0, stop);

  mfWeekplanState.dirty = true; mfWeekplanState.dirtyGen++;
  mfWpUpdateSaveBtn();
  mfWpScheduleAutoSave();

  if (navigator.vibrate) navigator.vibrate(30);
}

// ---- Swipe-to-delete ----

function mfWpInitSwipeDelete(container) {
  let swipeState = { el: null, startX: 0, currentX: 0, swiping: false };

  container.addEventListener('touchstart', (e) => {
    if (mfWpDragState.active) return;
    const stopContent = e.target.closest('.mf-wp-stop-content');
    if (!stopContent) return;
    const stopEl = stopContent.closest('.mf-wp-stop');
    if (!stopEl) return;

    swipeState.el = stopEl;
    swipeState.startX = e.touches[0].clientX;
    swipeState.swiping = false;
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!swipeState.el || mfWpDragState.active) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeState.startX;
    const dy = Math.abs(touch.clientY - (swipeState.startY || touch.clientY));

    if (!swipeState.swiping && Math.abs(dx) > 15 && Math.abs(dx) > dy) {
      swipeState.swiping = true;
      swipeState.startY = touch.clientY;
    }

    if (swipeState.swiping && dx < 0) {
      // Only swipe left
      const translateX = Math.max(dx, -80);
      const content = swipeState.el.querySelector('.mf-wp-stop-content');
      if (content) {
        content.style.transform = `translateX(${translateX}px)`;
        content.style.transition = 'none';
      }
    }
  }, { passive: true });

  container.addEventListener('touchend', () => {
    if (!swipeState.el) return;
    const content = swipeState.el.querySelector('.mf-wp-stop-content');

    if (swipeState.swiping && content) {
      const matrix = window.getComputedStyle(content).transform;
      let currentX = 0;
      if (matrix && matrix !== 'none') {
        const values = matrix.split(',');
        currentX = parseFloat(values[4]) || 0;
      }

      if (currentX < -50) {
        // Delete threshold reached
        const kundeId = parseInt(swipeState.el.dataset.kundeId);
        const dayKey = swipeState.el.dataset.day;
        content.style.transition = 'transform 0.2s ease';
        content.style.transform = 'translateX(-100%)';
        setTimeout(() => {
          mfWpRemoveStop(kundeId, dayKey);
        }, 200);
      } else {
        // Snap back
        content.style.transition = 'transform 0.2s ease';
        content.style.transform = 'translateX(0)';
      }
    }

    swipeState = { el: null, startX: 0, currentX: 0, swiping: false };
  }, { passive: true });
}

// ---- Remove stop ----

function mfWpRemoveStop(kundeId, dayKey) {
  const stops = mfWeekplanState.days[dayKey]?.stops;
  if (!stops) return;

  const idx = stops.findIndex(s => s.kundeId === kundeId);
  if (idx === -1) return;

  const removed = stops[idx];
  const dayDate = mfWeekplanState.days[dayKey]?.date;
  stops.splice(idx, 1);

  mfWeekplanState.dirty = true; mfWeekplanState.dirtyGen++;
  mfWpUpdateSaveBtn();
  mfWpScheduleAutoSave();
  mfWpRenderDays();
  mfWpRenderDots();
  mfWpInitDragDrop();

  // Directly delete any avtaler for this customer on this date
  // (fixes orphaned avtaler that have stale/missing rute_id)
  if (dayDate) {
    mfWpDeleteAvtalerForCustomer(kundeId, dayDate);
  }

  if (typeof showToast === 'function') showToast(`${removed.kundeNavn} fjernet`, 'info');
  mfShowBanner(`${removed.kundeNavn} fjernet`, 'info');
}

// Delete all avtaler for a specific customer on a specific date.
// Fetches directly from API to find ALL duplicates (the local avtaler array
// is deduped by loadAvtaler and may miss older orphaned entries).
async function mfWpDeleteAvtalerForCustomer(kundeId, date) {
  try {
    const csrfToken = getCsrfToken();

    // Fetch all avtaler for this date range directly from API
    // (bypasses the deduped local array which hides duplicates)
    const resp = await fetch(`/api/avtaler?start=${date}&end=${date}`, {
      headers: { 'X-CSRF-Token': csrfToken },
      credentials: 'include'
    });
    if (!resp.ok) return;
    const json = await resp.json();
    const allAvtaler = json.data || [];
    const matching = allAvtaler.filter(a => a.kunde_id === kundeId);

    if (matching.length === 0) return;

    await Promise.all(matching.map(async (a) => {
      try {
        await fetch(`/api/avtaler/${a.id}`, {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': csrfToken },
          credentials: 'include'
        });
      } catch { /* ignore — auto-save will retry */ }
    }));

    // Remove from global avtaler array
    if (typeof avtaler !== 'undefined') {
      const idsToRemove = new Set(matching.map(a => a.id));
      const newAvtaler = avtaler.filter(a => !idsToRemove.has(a.id));
      avtaler.length = 0;
      avtaler.push(...newAvtaler);
    }
  } catch (e) {
    console.error('[mfWpDeleteAvtaler] Error:', e);
  }
}

// ---- Reassign technician ----

function mfWpShowReassign(kundeId, dayKey) {
  const stops = mfWeekplanState.days[dayKey]?.stops;
  if (!stops) return;
  const stop = stops.find(s => s.kundeId === kundeId);
  if (!stop) return;

  const members = mfWeekplanState.teamMembers || [];
  let memberOptions = '';
  members.forEach(m => {
    const name = m.navn || m.name || '';
    const selected = name === stop.assignedTo ? 'selected' : '';
    memberOptions += `<option value="${escapeHtml(String(m.id))}" data-name="${escapeHtml(name)}" ${selected}>${escapeHtml(name)}</option>`;
  });

  const overlay = document.createElement('div');
  overlay.className = 'mf-bottom-sheet';
  overlay.id = 'mfWpReassignSheet';
  overlay.innerHTML = `
    <div class="mf-sheet-backdrop" data-action="mfWpCloseReassign"></div>
    <div class="mf-sheet-content">
      <div class="mf-visit-handle"></div>
      <h3>Tilordne teammedlem</h3>
      <p class="mf-wp-reassign-customer">${escapeHtml(stop.kundeNavn)}</p>

      <label class="mf-sheet-label">Velg teammedlem</label>
      <select id="mfWpReassignSelect" class="mf-sheet-select">
        <option value="">Ikke tildelt</option>
        ${memberOptions}
      </select>

      <button class="mf-btn mf-btn-primary mf-sheet-submit" data-action="mfWpConfirmReassign" data-args='[${kundeId}, "${escapeHtml(dayKey)}"]'>
        <i class="fas fa-check" aria-hidden="true"></i> Tilordne
      </button>
    </div>
  `;

  const container = document.getElementById('mfWeekplanOverlay') || document.getElementById('mfWeekplanInline');
  if (!container) return;
  container.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function mfWpCloseReassign() {
  const sheet = document.getElementById('mfWpReassignSheet');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 300);
  }
}

function mfWpConfirmReassign(kundeId, dayKey) {
  const select = document.getElementById('mfWpReassignSelect');
  if (!select) return;

  const newTechId = select.value ? parseInt(select.value) : null;
  const selectedOption = select.options[select.selectedIndex];
  const newTechName = selectedOption?.dataset?.name || '';

  mfWpReassign(kundeId, dayKey, newTechId, newTechName);
  mfWpCloseReassign();
}

function mfWpReassign(kundeId, dayKey, newTechId, newTechName) {
  const stops = mfWeekplanState.days[dayKey]?.stops;
  if (!stops) return;

  const stop = stops.find(s => s.kundeId === kundeId);
  if (!stop) return;

  stop.assignedTo = newTechName;
  stop.assignedToId = newTechId;

  mfWeekplanState.dirty = true; mfWeekplanState.dirtyGen++;
  mfWpUpdateSaveBtn();
  mfWpScheduleAutoSave();
  mfWpRenderDays();
  mfWpInitDragDrop();
}

// ---- Assign all stops in a day ----

function mfWpShowAssignAll(dayKey) {
  const stops = mfWeekplanState.days[dayKey]?.stops;
  if (!stops || stops.length === 0) return;

  const members = mfWeekplanState.teamMembers || [];
  let memberOptions = '';
  members.forEach(m => {
    const name = m.navn || m.name || '';
    memberOptions += `<option value="${escapeHtml(String(m.id))}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
  });

  const dayLabel = mfWpDayLabels[mfWpDayKeys.indexOf(dayKey)];

  const overlay = document.createElement('div');
  overlay.className = 'mf-bottom-sheet';
  overlay.id = 'mfWpAssignAllSheet';
  overlay.innerHTML = `
    <div class="mf-sheet-backdrop" data-action="mfWpCloseAssignAll"></div>
    <div class="mf-sheet-content">
      <div class="mf-visit-handle"></div>
      <h3>Tildel teammedlem &mdash; ${escapeHtml(dayLabel)}</h3>
      <p style="color:var(--text-secondary);margin:0 0 16px;">Tilordner alle ${stops.length} stopp til valgt teammedlem</p>

      <label class="mf-sheet-label">Velg teammedlem</label>
      <select id="mfWpAssignAllSelect" class="mf-sheet-select">
        <option value="">Ikke tildelt</option>
        ${memberOptions}
      </select>

      <button class="mf-btn mf-btn-primary mf-sheet-submit" data-action="mfWpConfirmAssignAll" data-args='["${escapeHtml(dayKey)}"]'>
        <i class="fas fa-check" aria-hidden="true"></i> Tildel alle
      </button>
    </div>
  `;

  const container = document.getElementById('mfWeekplanOverlay') || document.getElementById('mfWeekplanInline');
  if (!container) return;
  container.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function mfWpCloseAssignAll() {
  const sheet = document.getElementById('mfWpAssignAllSheet');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 300);
  }
}

function mfWpConfirmAssignAll(dayKey) {
  const select = document.getElementById('mfWpAssignAllSelect');
  if (!select) return;

  const newTechId = select.value ? parseInt(select.value) : null;
  const selectedOption = select.options[select.selectedIndex];
  const newTechName = selectedOption?.dataset?.name || '';

  const stops = mfWeekplanState.days[dayKey]?.stops;
  if (!stops) return;

  stops.forEach(stop => {
    stop.assignedTo = newTechName;
    stop.assignedToId = newTechId;
  });

  mfWeekplanState.dirty = true; mfWeekplanState.dirtyGen++;
  mfWpUpdateSaveBtn();
  mfWpScheduleAutoSave();
  mfWpRenderDays();
  mfWpInitDragDrop();
  mfWpCloseAssignAll();

  const label = newTechName || 'Ikke tildelt';
  mfShowBanner(`${stops.length} stopp tildelt ${label}`, 'success');
}

// ---- Add customer ----

function mfWpAddCustomer(dayKey) {
  // Show method picker: search vs area browser
  if (typeof mfWpShowAddMethodPicker === 'function') {
    mfWpShowAddMethodPicker(dayKey);
    return;
  }
  // Fallback to direct search if area module not loaded
  mfWpAddCustomerDirect(dayKey);
}

function mfWpAddCustomerDirect(dayKey) {
  let searchTimer = null;

  // Build team member dropdown
  const members = mfWeekplanState.teamMembers || [];
  let memberOptions = '<option value="">Ikke tildelt</option>';
  members.forEach(m => {
    memberOptions += `<option value="${m.id}" data-name="${escapeHtml(m.navn)}">${escapeHtml(m.navn)}</option>`;
  });

  // Pre-select the most recent team member used on this day
  const dayStops = mfWeekplanState.days[dayKey]?.stops || [];
  const lastAssigned = [...dayStops].reverse().find(s => s.assignedToId);

  const overlay = document.createElement('div');
  overlay.className = 'mf-bottom-sheet';
  overlay.id = 'mfWpAddSheet';
  overlay.innerHTML = `
    <div class="mf-sheet-backdrop" data-action="mfWpCloseAddSheet"></div>
    <div class="mf-sheet-content mf-wp-add-content">
      <div class="mf-visit-handle"></div>
      <h3>Legg til kunde — ${escapeHtml(mfWpDayLabels[mfWpDayKeys.indexOf(dayKey)])}</h3>

      <label class="mf-sheet-label">Teammedlem</label>
      <select id="mfWpAddMemberSelect" class="mf-sheet-select">${memberOptions}</select>

      <label class="mf-sheet-label">Søk etter kunde</label>
      <input type="text" id="mfWpAddSearch" class="mf-search-input" placeholder="Søk navn, adresse..." autocomplete="off">

      <div id="mfWpAddResults" class="mf-assign-results"></div>
    </div>
  `;

  const container = document.getElementById('mfWeekplanOverlay') || document.getElementById('mfWeekplanInline');
  if (!container) return;
  container.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    // Pre-select last used team member on this day
    const memberSelect = document.getElementById('mfWpAddMemberSelect');
    if (memberSelect && lastAssigned?.assignedToId) {
      memberSelect.value = String(lastAssigned.assignedToId);
    }
    document.getElementById('mfWpAddSearch')?.focus();
  });

  // Setup search handler
  const searchInput = document.getElementById('mfWpAddSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (searchTimer) clearTimeout(searchTimer);
      if (query.length < 2) {
        document.getElementById('mfWpAddResults').innerHTML = '';
        return;
      }
      searchTimer = setTimeout(() => mfWpDoCustomerSearch(query, dayKey), 300);
    });
  }
}

async function mfWpDoCustomerSearch(query, dayKey) {
  const resultsDiv = document.getElementById('mfWpAddResults');
  if (!resultsDiv) return;

  try {
    const resp = await fetch(`/api/kunder?search=${encodeURIComponent(query)}&limit=10`, {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    // Paginated response: json.data is { data: [...], total, pagination }
    const rawData = json.success ? json.data : json;
    const kunder = Array.isArray(rawData) ? rawData : (rawData?.data || []);

    if (kunder.length === 0) {
      resultsDiv.innerHTML = '<p class="mf-assign-empty">Ingen treff</p>';
      return;
    }

    // Filter out already-added customers
    const existingIds = new Set(mfWeekplanState.days[dayKey].stops.map(s => s.kundeId));

    let html = '';
    kunder.forEach(k => {
      const address = [k.adresse, k.poststed].filter(Boolean).join(', ');
      const alreadyAdded = existingIds.has(k.id);

      html += `
        <div class="mf-assign-row ${alreadyAdded ? 'mf-assign-disabled' : ''}" ${alreadyAdded ? '' : `data-action="mfWpSelectCustomerToAdd" data-args='[${k.id}, "${escapeHtml(dayKey)}"]'`}>
          <div class="mf-assign-row-info">
            <strong>${escapeHtml(k.navn)}</strong>
            ${address ? `<span>${escapeHtml(address)}</span>` : ''}
          </div>
          ${alreadyAdded ? '<span class="mf-wp-already-badge">Allerede lagt til</span>' : '<i class="fas fa-plus" aria-hidden="true"></i>'}
        </div>
      `;
    });
    resultsDiv.innerHTML = html;
  } catch {
    resultsDiv.innerHTML = '<p class="mf-assign-empty">Feil ved søk</p>';
  }
}

function mfWpSelectCustomerToAdd(kundeId, dayKey) {
  // Close the sheet
  mfWpCloseAddSheet();

  // Add the customer to the day
  // We need customer data — fetch it
  mfWpAddCustomerToDay(kundeId, dayKey);
}

async function mfWpAddCustomerToDay(kundeId, dayKey) {
  try {
    const resp = await fetch(`/api/kunder/${kundeId}`, {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    const kunde = json.success ? json.data : json;

    if (!kunde) {
      mfShowBanner('Kunne ikke finne kunden', 'error');
      return;
    }

    const stops = mfWeekplanState.days[dayKey].stops;

    // Use selected team member from add-customer sheet (if open), else inherit from day
    let assignedTo = '';
    let assignedToId = null;
    const memberSelect = document.getElementById('mfWpAddMemberSelect');
    if (memberSelect && memberSelect.value) {
      assignedToId = parseInt(memberSelect.value);
      const selectedOption = memberSelect.options[memberSelect.selectedIndex];
      assignedTo = selectedOption?.dataset?.name || '';
    } else {
      // Fallback: inherit from existing stops
      const existingAssigned = stops.find(s => s.assignedToId);
      if (existingAssigned) {
        assignedTo = existingAssigned.assignedTo || '';
        assignedToId = existingAssigned.assignedToId || null;
      }
    }

    stops.push({
      ruteId: null, // Will be created on save
      kundeId: kunde.id,
      kundeNavn: kunde.navn || 'Ukjent',
      adresse: [kunde.adresse, kunde.poststed].filter(Boolean).join(', '),
      assignedTo,
      assignedToId,
      estimertTid: kunde.estimert_tid || 30,
      rekkefolge: stops.length
    });

    mfWeekplanState.dirty = true; mfWeekplanState.dirtyGen++;
    mfWpUpdateSaveBtn();
    mfWpRenderDays();
    mfWpRenderDots();
    mfWpInitDragDrop();

    mfShowBanner(`${escapeHtml(kunde.navn)} lagt til`, 'success');
  } catch {
    mfShowBanner('Feil ved å legge til kunde', 'error');
  }
}

function mfWpCloseAddSheet() {
  const sheet = document.getElementById('mfWpAddSheet');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 300);
  }
}

// ---- Save single day ----

async function mfWpSaveDay(dayKey, csrfToken) {
  let errors = 0;
  const dayData = mfWeekplanState.days[dayKey];
  if (!dayData) return 0;
  const stops = dayData.stops;
  const knownRouteIds = dayData.knownRouteIds || new Set();
  const dayLabel = mfWpDayLabels[mfWpDayKeys.indexOf(dayKey)];
  const weekNum = mfWpGetWeekNumber(mfWeekplanState.weekStart);

  // Group ALL stops by their CURRENT assignedToId (not by ruteId).
  // This ensures reassigned stops end up in the correct route.
  const byMember = new Map(); // techKey → { techId, techName, stops: [] }
  stops.forEach((stop, idx) => {
    const techKey = stop.assignedToId ? String(stop.assignedToId) : 'none';
    if (!byMember.has(techKey)) {
      byMember.set(techKey, {
        techId: stop.assignedToId || null,
        techName: stop.assignedTo || '',
        stops: []
      });
    }
    byMember.get(techKey).stops.push({ ...stop, newOrder: idx });
  });

  // For each member group, find an existing route to reuse (or create new)
  const usedRouteIds = new Set();

  await Promise.all([...byMember.entries()].map(async ([techKey, group]) => {
    if (group.stops.length === 0) return;
    const kundeIds = group.stops.sort((a, b) => a.newOrder - b.newOrder).map(s => s.kundeId);
    const techId = group.techId;
    const techName = group.techName;

    // Try to reuse an existing route that belonged to this member
    let ruteId = null;
    for (const stop of group.stops) {
      if (stop.ruteId && knownRouteIds.has(stop.ruteId) && !usedRouteIds.has(stop.ruteId)) {
        ruteId = stop.ruteId;
        break;
      }
    }

    if (ruteId) {
      // Update existing route
      usedRouteIds.add(ruteId);
      try {
        const resp = await fetch(`/api/ruter/${ruteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          credentials: 'include',
          body: JSON.stringify({ kunde_ids: kundeIds, planlagt_dato: dayData.date })
        });
        if (!resp.ok) { errors++; } else {
          await mfWpAssignRoute(ruteId, techId, techName, dayData.date, csrfToken);
          // Update stops with ruteId
          for (const s of group.stops) {
            const found = dayData.stops.find(ds => ds.kundeId === s.kundeId);
            if (found) found.ruteId = ruteId;
          }
        }
      } catch { errors++; }
    } else {
      // Create new route
      const suffix = techName ? ` (${techName})` : '';
      try {
        const createResp = await fetch('/api/ruter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          credentials: 'include',
          body: JSON.stringify({ navn: `Uke ${weekNum} - ${dayLabel}${suffix}`, planlagt_dato: dayData.date, kunde_ids: kundeIds })
        });
        if (!createResp.ok) { errors++; } else {
          const createJson = await createResp.json();
          if (!createJson.success) { errors++; }
          else if (createJson.data?.id) {
            const newRouteId = createJson.data.id;
            usedRouteIds.add(newRouteId);
            for (const s of group.stops) {
              const found = dayData.stops.find(ds => ds.kundeId === s.kundeId);
              if (found) found.ruteId = newRouteId;
            }
            if (!dayData.knownRouteIds) dayData.knownRouteIds = new Set();
            dayData.knownRouteIds.add(newRouteId);
            await mfWpAssignRoute(newRouteId, techId, techName, dayData.date, csrfToken);
          }
        }
      } catch { errors++; }
    }
  }));

  // Delete routes that lost all stops (no longer used by any member group)
  const routesToDelete = [...knownRouteIds].filter(id => !usedRouteIds.has(id));
  await Promise.all(routesToDelete.map(async ruteId => {
    try {
      const resp = await fetch(`/api/ruter/${ruteId}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken }, credentials: 'include' });
      if (!resp.ok) { errors++; } else { knownRouteIds.delete(ruteId); }
    } catch { errors++; }
  }));

  return errors;
}

// ---- Save changes ----

async function mfWpSave() {
  if (!mfWeekplanState.dirty || mfWpSaving) return;
  mfWpSaving = true;
  const saveGen = mfWeekplanState.dirtyGen; // snapshot — detect concurrent edits

  const csrfToken = getCsrfToken();
  let errors = 0;

  try {
    // Save all days in parallel for speed
    const dayResults = await Promise.all(mfWpDayKeys.map(dayKey => mfWpSaveDay(dayKey, csrfToken)));
    errors = dayResults.reduce((sum, e) => sum + e, 0);

    if (errors > 0) {
      mfShowBanner(`Lagret med ${errors} feil`, 'warning');
      if (typeof showToast === 'function') showToast(`Lagret med ${errors} feil`, 'warning');
    } else {
      mfShowBanner('Lagret', 'success');
      if (typeof showToast === 'function') showToast('Ukeplan lagret', 'success');
    }

    // Only clear dirty if no new changes happened during save AND no errors
    if (mfWeekplanState.dirtyGen === saveGen && errors === 0) {
      mfWeekplanState.dirty = false;
    }

    // Clear sidebar weekplan planned arrays to avoid showing duplicates
    // (customers are now saved as routes/avtaler in the database)
    if (typeof weekPlanState !== 'undefined' && weekPlanState.days) {
      for (const key of Object.keys(weekPlanState.days)) {
        if (weekPlanState.days[key]?.planned) {
          weekPlanState.days[key].planned = [];
        }
      }
    }

    // Reload avtaler + week matrix so all views reflect changes
    // MUST await so closing the editor doesn't show stale data
    if (typeof loadAvtaler === 'function') {
      await loadAvtaler();
      if (typeof renderWeeklyPlan === 'function') renderWeeklyPlan();
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof updateWeekPlanBadges === 'function') updateWeekPlanBadges();
    }
    if (typeof raoLoadWeekData === 'function') raoLoadWeekData();
    // Refresh mobile calendar
    if (typeof mfLoadCalendarData === 'function') {
      try { await mfLoadCalendarData(); } catch (e) { /* ignore */ }
    }
  } catch (err) {
    console.error('Mobile weekplan: Save error:', err);
    mfShowBanner('Feil ved lagring: ' + err.message, 'error');
  }

  mfWpSaving = false;

  // Re-schedule auto-save if there are still unsaved changes
  // (new edits during save, or errors that prevented clearing dirty)
  if (mfWeekplanState.dirty) {
    mfWpScheduleAutoSave();
  }
}

// ---- Route assignment helper ----

async function mfWpAssignRoute(ruteId, techId, techName, date, csrfToken) {
  try {
    const resp = await fetch(`/api/ruter/${ruteId}/assign`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      credentials: 'include',
      body: JSON.stringify({
        assigned_to: techId || null,
        planned_date: date,
        technician_name: techName || ''
      })
    });
    if (!resp.ok) {
      console.error('Mobile weekplan: assign route failed:', resp.status);
    }
  } catch (e) {
    console.error('Mobile weekplan: assign route error:', e);
  }
}

// ---- UI helpers ----

function mfWpUpdateSaveBtn() {
  // No-op: auto-save handles everything
}

// ---- Estimated time editing in weekplan ----

function mfWpSetEstimertTidHandler(kundeId, dayKey, el) {
  const val = Math.max(5, parseInt(el.value) || 30);
  el.value = val;

  // Update local state
  const stops = mfWeekplanState.days[dayKey]?.stops;
  if (stops) {
    const stop = stops.find(s => s.kundeId === kundeId);
    if (stop) {
      stop.estimertTid = val;
      mfWeekplanState.dirty = true; mfWeekplanState.dirtyGen++;
      mfWpScheduleAutoSave();
    }
  }

  // Also save to customer record so admin sees the update
  mfWpSaveEstimertTidToKunde(kundeId, val);
}

let mfWpEstSaveTimer = null;

function mfWpSaveEstimertTidToKunde(kundeId, minutes) {
  if (mfWpEstSaveTimer) clearTimeout(mfWpEstSaveTimer);
  mfWpEstSaveTimer = setTimeout(async () => {
    try {
      const csrfToken = getCsrfToken();
      await fetch(`/api/kunder/${kundeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({ estimert_tid: minutes })
      });
    } catch (err) {
      console.warn('Mobile weekplan: Could not save estimated time:', err);
    }
  }, 1000);
}

// ---- WebSocket sync: reload weekplan if another user changed routes ----

function handleMobileWeekplanRealtimeUpdate(message) {
  const overlay = document.getElementById('mfWeekplanOverlay');
  if (!overlay) return; // Editor not open

  const { type } = message;
  if (type === 'rute_created' || type === 'rute_updated' || type === 'rute_deleted') {
    // If we have unsaved changes, show a warning banner instead of auto-reloading
    if (mfWeekplanState.dirty) {
      mfShowBanner('En annen bruker endret ukeplanen. Lagre og \u00e5pne p\u00e5 nytt for \u00e5 se endringene.', 'warning');
    } else {
      // Safe to auto-reload
      mfWpInitDays();
    }
  }
}

// ---- Inline weekplan (rendered as tab, not overlay) ----

let mfWeekplanInlineInitialized = false;

function mfShowWeekplanInline() {
  const container = document.getElementById('mfWeekplanInline');
  if (!container || mfWeekplanInlineInitialized) return;
  mfWeekplanInlineInitialized = true;

  // Initialize state
  mfWeekplanState.weekStart = mfWpGetMonday(new Date());
  mfWeekplanState.dirty = false;
  mfWeekplanState.activeDay = 0;
  mfWpInitDays();

  const weekNum = mfWpGetWeekNumber(mfWeekplanState.weekStart);

  container.innerHTML = `
    <div class="mf-weekplan-header" style="position:sticky;top:0;z-index:10;">
      <div class="mf-weekplan-title-group">
        <button class="mf-weekplan-nav" data-action="mfWpNavigateWeek" data-args='[-1]' aria-label="Forrige uke">
          <i class="fas fa-chevron-left" aria-hidden="true"></i>
        </button>
        <h3 id="mfWpTitle">Uke ${weekNum}</h3>
        <button class="mf-weekplan-nav" data-action="mfWpNavigateWeek" data-args='[1]' aria-label="Neste uke">
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div class="mf-weekplan-day-dots" id="mfWpDayDots"></div>

    <div class="mf-weekplan-days" id="mfWpDaysContainer"></div>

    <div class="mf-weekplan-loading" id="mfWpLoading">
      <div class="mf-spinner"></div>
      <p>Laster ukeplan...</p>
    </div>
  `;

  // Load data
  mfWpLoadWeek();
}

// ---- Expose globally ----

window.mfShowWeekplanInline = mfShowWeekplanInline;
window.mfShowWeekplanEditor = mfShowWeekplanEditor;
window.handleMobileWeekplanRealtimeUpdate = handleMobileWeekplanRealtimeUpdate;
window.mfWpSetEstimertTidHandler = mfWpSetEstimertTidHandler;
window.mfCloseWeekplanEditor = mfCloseWeekplanEditor;
window.mfWpNavigateWeek = mfWpNavigateWeek;
window.mfWpScrollToDay = mfWpScrollToDay;
window.mfWpSave = mfWpSave;
window.mfWpShowReassign = mfWpShowReassign;
window.mfWpCloseReassign = mfWpCloseReassign;
window.mfWpConfirmReassign = mfWpConfirmReassign;
window.mfWpShowAssignAll = mfWpShowAssignAll;
window.mfWpCloseAssignAll = mfWpCloseAssignAll;
window.mfWpConfirmAssignAll = mfWpConfirmAssignAll;
window.mfWpAddCustomer = mfWpAddCustomer;
window.mfWpAddCustomerDirect = mfWpAddCustomerDirect;
window.mfWpCloseAddSheet = mfWpCloseAddSheet;
window.mfWpSelectCustomerToAdd = mfWpSelectCustomerToAdd;
window.mfWpRemoveStop = mfWpRemoveStop;

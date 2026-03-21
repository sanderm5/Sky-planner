/**
 * Route Assignment Overview — Week matrix view
 * Shows who has which route assigned across the week (Mon-Fri).
 * Integrates into the Oversikt tab via a Dag/Uke toggle.
 */

// ---- State ----
let raoWeekStart = null;
let raoWeekData = null;
let raoExpandedRouteId = null;
let raoAbortController = null;
let raoTeamMapActive = false;
let raoFocusedMember = null;
let raoMemberCustomerMap = null; // Map<memberName, Set<kundeId>>

// ---- Utilities ----

function raoGetWeekStart(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  // getDay: 0=Sun,1=Mon..6=Sat → shift so Monday=0
  const shift = (day + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  d.setDate(d.getDate() - shift);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function raoGetWeekNumber(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function raoFormatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'];
  return `${days[d.getDay()]} ${d.getDate()}.`;
}

function raoFormatMonthRange(weekStart) {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  const months = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}. - ${end.getDate()}. ${months[end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${start.getDate()}. ${months[start.getMonth()]} - ${end.getDate()}. ${months[end.getMonth()]} ${end.getFullYear()}`;
}

function raoGetInitials(name) {
  if (!name) return '?';
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ---- Data ----

async function raoLoadWeekData() {
  const container = document.getElementById('raoWeekView');
  if (!container) return;

  // Cancel any in-flight request to prevent race conditions
  if (raoAbortController) raoAbortController.abort();
  raoAbortController = new AbortController();

  try {
    const resp = await fetch(`/api/todays-work/team-overview-week?week_start=${raoWeekStart}`, {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
      signal: raoAbortController.signal
    });

    if (!resp.ok) {
      container.innerHTML = '<div class="to-empty"><i class="fas fa-exclamation-triangle"></i><p>Kunne ikke laste ukeoversikt.</p></div>';
      return;
    }

    const json = await resp.json();
    if (json.success && json.data) {
      raoWeekData = json.data;
    } else {
      raoWeekData = null;
    }
  } catch (e) {
    if (e.name === 'AbortError') return; // Silently ignore cancelled requests
    console.error('RAO: Failed to load week data', e);
    raoWeekData = null;
  }

  raoRenderWeekGrid();
  // Activate team map coloring after data loads
  raoActivateTeamMap();
}

// ---- Navigation ----

function raoFormatLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function raoPrevWeek() {
  const d = new Date(raoWeekStart + 'T00:00:00');
  d.setDate(d.getDate() - 7);
  raoWeekStart = raoFormatLocalDate(d);
  raoExpandedRouteId = null;
  raoLoadWeekData();
}

function raoNextWeek() {
  const d = new Date(raoWeekStart + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  raoWeekStart = raoFormatLocalDate(d);
  raoExpandedRouteId = null;
  raoLoadWeekData();
}

function raoThisWeek() {
  raoWeekStart = raoGetWeekStart();
  raoExpandedRouteId = null;
  raoLoadWeekData();
}

// ---- Expand route ----

function raoExpandRoute(routeId) {
  raoExpandedRouteId = raoExpandedRouteId === routeId ? null : routeId;
  raoRenderWeekGrid();
}

// ---- Navigate to weekplan ----

function raoOpenWeekplan() {
  // Open the same full-screen weekplan editor as the day view uses
  if (typeof mfShowWeekplanEditor === 'function') {
    mfShowWeekplanEditor();
    // Override to the week shown in the matrix (mfShowWeekplanEditor defaults to current week)
    if (raoWeekStart && typeof mfWpGetMonday === 'function' && typeof mfWpLoadWeek === 'function') {
      const targetMonday = mfWpGetMonday(new Date(raoWeekStart + 'T00:00:00'));
      const currentMonday = mfWpGetMonday(new Date());
      if (targetMonday.getTime() !== currentMonday.getTime()) {
        mfWeekplanState.weekStart = targetMonday;
        mfWeekplanState.activeDay = 0;
        mfWpLoadWeek();
      }
    }
  } else if (typeof switchArbeidView === 'function') {
    if (typeof initWeekPlanState === 'function' && raoWeekStart) {
      initWeekPlanState(new Date(raoWeekStart + 'T00:00:00'));
    }
    switchArbeidView('uke');
  }
}

// ---- Render ----

function raoRenderWeekGrid() {
  const container = document.getElementById('raoWeekView');
  if (!container) return;

  if (!raoWeekData) {
    container.innerHTML = '<div class="to-empty"><i class="fas fa-calendar-week"></i><p>Ingen data tilgjengelig.</p></div>';
    return;
  }

  const { dates, members, unassigned, summary } = raoWeekData;
  const weekNum = raoGetWeekNumber(raoWeekStart);
  const isThisWeek = raoWeekStart === raoGetWeekStart();
  const todayStr = new Date().toISOString().split('T')[0];
  const isSoloAdmin = members.length <= 1;

  let html = '';

  // Week navigation
  html += `
    <div class="to-date-nav">
      <button class="btn btn-icon btn-small" data-action="raoPrevWeek" title="Forrige uke">
        <i class="fas fa-chevron-left"></i>
      </button>
      <span class="to-date-label" data-action="raoThisWeek" title="Ga til denne uken" style="cursor:pointer;">
        Uke ${weekNum}: ${escapeHtml(raoFormatMonthRange(raoWeekStart))}${isThisWeek ? ' <span class="to-today-badge">denne uken</span>' : ''}
      </span>
      <button class="btn btn-icon btn-small" data-action="raoNextWeek" title="Neste uke">
        <i class="fas fa-chevron-right"></i>
      </button>
    </div>
  `;

  // Summary cards — simplified for solo admin
  if (isSoloAdmin) {
    html += `
      <div class="to-summary-row">
        <div class="to-summary-card">
          <div class="to-summary-num">${summary.total_routes}</div>
          <div class="to-summary-label">Ruter</div>
        </div>
        <div class="to-summary-card to-card-done">
          <div class="to-summary-num">${summary.total_customers}</div>
          <div class="to-summary-label">Kunder</div>
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="to-summary-row">
        <div class="to-summary-card">
          <div class="to-summary-num">${summary.total_routes}</div>
          <div class="to-summary-label">Ruter</div>
        </div>
        <div class="to-summary-card to-card-active">
          <div class="to-summary-num">${summary.assigned}</div>
          <div class="to-summary-label">Tildelte</div>
        </div>
        <div class="to-summary-card to-card-idle">
          <div class="to-summary-num">${summary.unassigned}</div>
          <div class="to-summary-label">Utildelte</div>
        </div>
        <div class="to-summary-card to-card-done">
          <div class="to-summary-num">${summary.total_customers}</div>
          <div class="to-summary-label">Kunder</div>
        </div>
      </div>
    `;
  }

  // Action buttons — solo admin gets simplified set, multi-member gets full set
  if (isSoloAdmin) {
    html += `
      <div class="to-actions">
        <button class="btn btn-primary btn-small" data-action="raoOpenWeekplan">
          <i class="fas fa-calendar-week"></i> Rediger ukeplan
        </button>
        <button class="btn btn-secondary btn-small" data-action="toShowCustomerLookup">
          <i class="fas fa-address-book"></i> Kundeoppslag
        </button>
      </div>
    `;
  } else {
    html += `
      <div class="to-actions">
        <button class="btn btn-primary btn-small" data-action="toShowPushRoute">
          <i class="fas fa-paper-plane"></i> Send rute
        </button>
        <button class="btn btn-secondary btn-small" data-action="toShowQuickAssign">
          <i class="fas fa-plus-circle"></i> Legg til kunde
        </button>
        <button class="btn btn-secondary btn-small" data-action="toShowCustomerLookup">
          <i class="fas fa-address-book"></i> Kundeoppslag
        </button>
        <button class="btn btn-secondary btn-small" data-action="raoOpenWeekplan">
          <i class="fas fa-calendar-week"></i> Rediger ukeplan
        </button>
      </div>
    `;
  }

  // Week grid
  html += '<div class="rao-grid">';

  // Header row
  html += '<div class="rao-header-cell rao-member-col"></div>';
  for (const date of dates) {
    const isToday = date === todayStr;
    html += `<div class="rao-header-cell${isToday ? ' rao-today' : ''}">${escapeHtml(raoFormatShortDate(date))}</div>`;
  }

  // Team member rows
  const TEAM_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#c026d3', '#ca8a04'];

  // Calculate workload per member per day for heatmap
  function raoGetDayMinutes(routes) {
    return routes.reduce((sum, r) => sum + (r.total_count || 0) * 30, 0);
  }
  function raoWorkloadClass(minutes) {
    if (minutes === 0) return '';
    if (minutes <= 360) return 'rao-load-green';
    if (minutes <= 480) return 'rao-load-yellow';
    return 'rao-load-red';
  }

  // Track column totals for summary row
  const dayTotals = {};
  for (const date of dates) dayTotals[date] = { minutes: 0, stops: 0 };

  members.forEach((member, mIdx) => {
    const color = TEAM_COLORS[mIdx % TEAM_COLORS.length];
    const initials = raoGetInitials(member.navn);
    const hasAnyRoutes = dates.some(d => member.days[d] && member.days[d].length > 0);

    const isMemberFocused = raoFocusedMember === member.navn;
    html += `<div class="rao-member-cell ${isMemberFocused ? 'rao-member-focused' : ''}" style="--member-color: ${color}" data-action="raoFocusMember" data-args='["${escapeHtml(member.navn)}"]' role="button" tabindex="0" title="Vis på kartet">
      <span class="rao-avatar" style="background: ${color}">${escapeHtml(initials)}</span>
      <span class="rao-member-name">${escapeHtml(member.navn)}</span>
    </div>`;

    for (const date of dates) {
      const routes = member.days[date] || [];
      const isToday = date === todayStr;
      const dayMinutes = raoGetDayMinutes(routes);
      const loadClass = raoWorkloadClass(dayMinutes);
      const dayStops = routes.reduce((s, r) => s + (r.total_count || 0), 0);
      dayTotals[date].minutes += dayMinutes;
      dayTotals[date].stops += dayStops;
      const loadTooltip = dayMinutes > 0 ? `~${Math.floor(dayMinutes / 60)}t ${dayMinutes % 60}m / 8t (${Math.round(dayMinutes / 480 * 100)}%)` : '';
      html += `<div class="rao-day-cell${isToday ? ' rao-today' : ''}${routes.length === 0 ? ' rao-empty-cell' : ''} ${loadClass}" ${loadTooltip ? `title="${loadTooltip}"` : ''}>`;

      if (routes.length === 0) {
        html += '<span class="rao-no-route">&mdash;</span>';
      } else {
        for (const route of routes) {
          const statusClass = route.execution_ended_at ? 'rao-route-cell--done'
            : route.execution_started_at ? 'rao-route-cell--active'
            : 'rao-route-cell--idle';
          const isExpanded = raoExpandedRouteId === route.id;

          const isActive = route.execution_started_at && !route.execution_ended_at;
          html += `<div class="rao-route-cell ${statusClass}${isExpanded ? ' rao-expanded' : ''}${isActive ? ' rao-pulse' : ''}" data-action="raoExpandRoute" data-args="[${route.id}]">
            <div class="rao-route-name">${escapeHtml(route.navn || 'Rute')}</div>
            <div class="rao-route-meta">${isActive ? `${route.completed_count || 0}/${route.total_count} fullført` : `${route.total_count} stopp`}</div>`;

          if (isActive && route.total_count > 0) {
            const pct = Math.round(((route.completed_count || 0) / route.total_count) * 100);
            html += `<div class="rao-progress"><div class="rao-progress-fill" style="width:${pct}%"></div></div>`;
          }
          if (route.execution_ended_at) {
            html += `<div class="rao-route-meta" style="color:var(--color-success, #16a34a)"><i class="fas fa-check" style="font-size:8px;margin-right:2px"></i>Fullført</div>`;
          }

          if (isExpanded && route.kunder && route.kunder.length > 0) {
            html += '<div class="rao-stop-list">';
            route.kunder.forEach((k, ki) => {
              html += `<div class="rao-stop-item">
                <span class="rao-stop-num">${ki + 1}</span>
                <span class="rao-stop-name">${escapeHtml(k.navn || 'Ukjent')}</span>
              </div>`;
            });
            html += '</div>';
          }

          html += '</div>';
        }
      }

      html += '</div>';
    }
  });

  // Unassigned row
  const hasUnassigned = dates.some(d => unassigned[d] && unassigned[d].length > 0);
  if (hasUnassigned) {
    html += `<div class="rao-member-cell rao-unassigned-row">
      <span class="rao-avatar rao-avatar-warn"><i class="fas fa-exclamation"></i></span>
      <span class="rao-member-name">Utildelt</span>
    </div>`;

    for (const date of dates) {
      const routes = unassigned[date] || [];
      const isToday = date === todayStr;
      html += `<div class="rao-day-cell rao-unassigned-row${isToday ? ' rao-today' : ''}${routes.length === 0 ? ' rao-empty-cell' : ''}">`;

      if (routes.length === 0) {
        html += '<span class="rao-no-route">&mdash;</span>';
      } else {
        for (const route of routes) {
          const isExpanded = raoExpandedRouteId === route.id;
          html += `<div class="rao-route-cell rao-route-cell--unassigned${isExpanded ? ' rao-expanded' : ''}" data-action="raoExpandRoute" data-args="[${route.id}]">
            <div class="rao-route-name">${escapeHtml(route.navn || 'Rute')}</div>
            <div class="rao-route-meta">${route.total_count} stopp</div>`;

          if (isExpanded && route.kunder && route.kunder.length > 0) {
            html += '<div class="rao-stop-list">';
            route.kunder.forEach((k, ki) => {
              html += `<div class="rao-stop-item">
                <span class="rao-stop-num">${ki + 1}</span>
                <span class="rao-stop-name">${escapeHtml(k.navn || 'Ukjent')}</span>
              </div>`;
            });
            html += '</div>';
          }

          html += '</div>';
        }
      }

      html += '</div>';
    }
  }

  // Workload summary row
  if (members.length > 0) {
    html += `<div class="rao-member-cell rao-summary-row">
      <span class="rao-member-name"><i class="fas fa-chart-bar" style="margin-right:4px;opacity:0.6"></i>Totalt</span>
    </div>`;
    for (const date of dates) {
      const t = dayTotals[date];
      const isToday = date === todayStr;
      html += `<div class="rao-day-cell rao-summary-row${isToday ? ' rao-today' : ''}">
        <span class="rao-summary-stops">${t.stops} stopp</span>
        <span class="rao-summary-time">~${Math.floor(t.minutes / 60)}t ${t.minutes % 60}m</span>
      </div>`;
    }
  }

  html += '</div>'; // close .rao-grid

  // Empty state
  if (members.length === 0 && !hasUnassigned) {
    html += '<div class="to-empty"><i class="fas fa-route"></i><p>Ingen ruter planlagt denne uken.</p></div>';
  }

  // Solo admin CTA — encourage adding team members
  if (isSoloAdmin) {
    html += `
      <div class="rao-solo-cta">
        <div class="rao-solo-cta-icon"><i class="fas fa-users"></i></div>
        <div class="rao-solo-cta-text">
          <strong>Legg til ansatte</strong>
          <p>Fordel arbeid og ruter mellom teammedlemmer for bedre oversikt og planlegging.</p>
        </div>
        <button class="btn btn-secondary btn-small" data-action="raoOpenTeamSettings">
          <i class="fas fa-user-plus"></i> Legg til
        </button>
      </div>
    `;
  }

  container.innerHTML = html;
}

// ---- Solo admin: open team settings ----

function raoOpenTeamSettings() {
  // Switch to Innstillinger tab and open team member section
  const adminTabBtn = document.querySelector('.tab-item[data-tab="admin"]');
  if (adminTabBtn) {
    adminTabBtn.click();
    setTimeout(() => {
      if (typeof loadTeamMembers === 'function') loadTeamMembers();
    }, 200);
  }
}

// ---- Team Map: color-code markers by team member ----

function raoActivateTeamMap() {
  if (!raoWeekData || !raoWeekData.members || raoWeekData.members.length === 0) return;
  if (typeof markers === 'undefined' || typeof customers === 'undefined') return;

  const todayStr = new Date().toISOString().split('T')[0];
  raoMemberCustomerMap = new Map();

  raoWeekData.members.forEach((member, mIdx) => {
    const kundeIds = new Set();
    const todayRoutes = member.days[todayStr] || [];
    for (const route of todayRoutes) {
      if (!route.kunder) continue;
      for (const k of route.kunder) {
        const full = customers.find(c => c.id === k.id);
        if (full && full.lat && full.lng) kundeIds.add(full.id);
      }
    }
    if (kundeIds.size > 0) {
      raoMemberCustomerMap.set(member.navn, { kundeIds, color: TEAM_COLORS[mIdx % TEAM_COLORS.length], initials: raoGetInitials(member.navn) });
    }
  });

  for (const kundeId of Object.keys(markers)) {
    const marker = markers[kundeId];
    if (!marker?._element && !marker?.getElement) continue;
    const el = marker._element || marker.getElement();
    if (!el) continue;
    const numId = Number(kundeId);
    let memberColor = null;
    for (const [, data] of raoMemberCustomerMap) {
      if (data.kundeIds.has(numId)) { memberColor = data.color; break; }
    }
    if (memberColor) {
      el.style.boxShadow = `inset 0 0 0 3px ${memberColor}`;
    }
  }

  raoTeamMapActive = true;
  raoShowTeamLegend();
}

function raoFocusMember(memberName) {
  if (raoFocusedMember === memberName) {
    raoFocusedMember = null;
    wpFocusedTeamMember = null;
    wpFocusedMemberIds = null;
    wpShowAllMarkers = false;
    if (typeof applyTeamFocusToMarkers === 'function') applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
    raoRenderWeekGrid();
    raoShowTeamLegend();
    return;
  }

  const memberData = raoMemberCustomerMap?.get(memberName);
  if (!memberData) return;

  raoFocusedMember = memberName;
  wpFocusedTeamMember = memberName;
  wpFocusedMemberIds = new Set([...memberData.kundeIds].map(id => Number(id)));
  wpShowAllMarkers = false;

  if (typeof applyTeamFocusToMarkers === 'function') applyTeamFocusToMarkers();
  if (typeof refreshClusters === 'function') refreshClusters();

  const boundsPoints = [];
  for (const kundeId of memberData.kundeIds) {
    const m = markers[kundeId];
    if (m && m.getLngLat) {
      const ll = m.getLngLat();
      boundsPoints.push([ll.lat, ll.lng]);
    }
  }
  if (boundsPoints.length > 0 && typeof boundsFromLatLngArray === 'function' && typeof map !== 'undefined' && map) {
    const bounds = boundsFromLatLngArray(boundsPoints);
    map.fitBounds(bounds, { padding: 50, maxZoom: 13 });
  }

  raoRenderWeekGrid();
  raoShowTeamLegend();
}

function raoCleanupTeamMap() {
  if (!raoTeamMapActive) return;
  if (typeof markers !== 'undefined') {
    for (const kundeId of Object.keys(markers)) {
      const marker = markers[kundeId];
      if (!marker?._element && !marker?.getElement) continue;
      const el = marker._element || marker.getElement();
      if (el) el.style.boxShadow = '';
    }
  }
  if (raoFocusedMember) {
    raoFocusedMember = null;
    wpFocusedTeamMember = null;
    wpFocusedMemberIds = null;
    wpShowAllMarkers = false;
    if (typeof applyTeamFocusToMarkers === 'function') applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
  }
  raoTeamMapActive = false;
  raoMemberCustomerMap = null;
  raoHideTeamLegend();
}

function raoShowTeamLegend() {
  raoHideTeamLegend();
  if (!raoMemberCustomerMap || raoMemberCustomerMap.size === 0) return;
  const legend = document.createElement('div');
  legend.id = 'raoTeamLegend';
  let html = '<div class="rao-legend-title">Team i dag</div>';
  for (const [name, data] of raoMemberCustomerMap) {
    const isFocused = raoFocusedMember === name;
    html += `<div class="rao-legend-item ${isFocused ? 'rao-legend-focused' : ''}" data-action="raoFocusMember" data-args='["${escapeHtml(name)}"]'>
      <span class="rao-legend-dot" style="background:${data.color}"></span>
      <span>${escapeHtml(data.initials)}</span>
      <span class="rao-legend-count">${data.kundeIds.size}</span>
    </div>`;
  }
  legend.innerHTML = html;
  const mapContainer = document.getElementById('map');
  if (mapContainer) mapContainer.parentElement.appendChild(legend);
}

function raoHideTeamLegend() {
  const el = document.getElementById('raoTeamLegend');
  if (el) el.remove();
}

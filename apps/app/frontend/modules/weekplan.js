// === Calendar helper functions ===

function formatDateISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getNextMonday(fromDate) {
  const d = new Date(fromDate);
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : (8 - day);
  d.setDate(d.getDate() + daysUntilMonday);
  return d;
}

function addDaysToDate(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getCreatorDisplay(name, short = false) {
  if (!name || name === 'admin' || !name.trim()) return '';
  const parts = name.trim().split(/\s+/);
  if (short) {
    // Initialer: "Sander Martinsen" → "SM"
    return parts.map(p => p[0].toUpperCase()).join('');
  }
  // Kort: "Sander Martinsen" → "Sander M."
  if (parts.length > 1) {
    return parts[0] + ' ' + parts[1][0].toUpperCase() + '.';
  }
  return parts[0];
}

function getUniqueAreas(dayAvtaler) {
  const areaMap = new Map();
  dayAvtaler.forEach(a => {
    const area = a.kunder?.poststed || a.poststed || null;
    if (!area) return;
    if (!areaMap.has(area)) {
      areaMap.set(area, { count: 0, customers: [] });
    }
    const group = areaMap.get(area);
    group.count++;
    group.customers.push(a.kunder?.navn || a.kunde_navn || 'Ukjent');
  });
  return areaMap;
}

function getAreaTooltip(dayAvtaler) {
  const areas = getUniqueAreas(dayAvtaler);
  return Array.from(areas.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([area, data]) => `${area}: ${data.count}`)
    .join(', ');
}

function renderAreaBadges(dayAvtaler) {
  const areas = getUniqueAreas(dayAvtaler);
  if (areas.size === 0) return '';

  const sorted = Array.from(areas.entries()).sort((a, b) => b[1].count - a[1].count);
  return `
    <div class="week-day-areas">
      ${sorted.map(([area, data]) => `
        <span class="area-badge" title="${escapeHtml(data.customers.join(', '))}">
          <i aria-hidden="true" class="fas fa-map-marker-alt"></i> ${escapeHtml(area)} (${data.count})
        </span>
      `).join('')}
    </div>
  `;
}

// === WEEKLY PLAN (Ukeplan - planlagte oppdrag) ===

const weekDayKeys = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag'];
const weekDayLabels = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'];
const monthNamesShort = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

function formatMinutes(totalMin) {
  if (!totalMin || totalMin <= 0) return '';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}t ${m}m` : `${h}t`;
}

function formatTimeOfDay(minutesOffset, startHour = 8, startMinute = 0) {
  const totalMinutes = (startHour * 60 + startMinute) + minutesOffset;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getDayEstimatedTotal(dayKey) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return 0;
  return dayData.planned.reduce((sum, c) => sum + (c.estimertTid || 30), 0);
}

const TEAM_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#c026d3', '#ca8a04'];
let wpFocusedTeamMember = null; // currently highlighted team member name
let wpFocusedMemberIds = null; // Set of customer IDs for focused member (used by cluster icons)
let wpRouteActive = false; // true when navigating a route (dims markers)
let wpRouteStopIds = null; // Set of customer IDs that are stops in the active route

function getWeekTeamMembers() {
  if (!weekPlanState.days) return [];
  const weekDates = new Set(weekDayKeys.map(k => weekPlanState.days[k]?.date).filter(Boolean));
  const teamMap = new Map(); // name → { initials, count, kundeIds: Set }

  // Planned (unsaved) - use global assigned technician, or current user
  const userName = localStorage.getItem('userName') || '';
  const globalAssigned = weekPlanState.globalAssignedTo || userName;
  for (const dayKey of weekDayKeys) {
    const dayData = weekPlanState.days[dayKey];
    if (!dayData || dayData.planned.length === 0) continue;
    const assignedName = globalAssigned || userName;
    if (!assignedName) continue;
    for (const c of dayData.planned) {
      if (!teamMap.has(assignedName)) teamMap.set(assignedName, { initials: getCreatorDisplay(assignedName, true), count: 0, kundeIds: new Set() });
      const entry = teamMap.get(assignedName);
      entry.count++;
      entry.kundeIds.add(c.id);
    }
  }

  // Existing avtaler this week
  for (const a of avtaler) {
    if (!weekDates.has(a.dato) || !a.kunde_id) continue;
    const creator = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
    if (!creator) continue;
    if (!teamMap.has(creator)) teamMap.set(creator, { initials: getCreatorDisplay(creator, true), count: 0, kundeIds: new Set() });
    const entry = teamMap.get(creator);
    if (!entry.kundeIds.has(a.kunde_id)) {
      entry.count++;
      entry.kundeIds.add(a.kunde_id);
    }
  }

  // Convert to array sorted by count desc, then assign colors by sorted position
  const sorted = Array.from(teamMap.entries()).map(([name, data]) => ({
    name,
    initials: data.initials,
    count: data.count,
    kundeIds: data.kundeIds,
    color: '' // assigned after sort
  })).sort((a, b) => b.count - a.count);

  sorted.forEach((member, idx) => {
    member.color = TEAM_COLORS[idx % TEAM_COLORS.length];
  });
  return sorted;
}

function focusTeamMemberOnMap(memberName) {
  if (wpFocusedTeamMember === memberName) {
    // Toggle off - remove focus
    wpFocusedTeamMember = null;
    wpFocusedMemberIds = null;
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
    renderWeeklyPlan();
    return;
  }

  wpFocusedTeamMember = memberName;
  const team = getWeekTeamMembers();
  const member = team.find(t => t.name === memberName);
  if (!member) return;

  // Normalize all IDs to numbers for consistent lookup
  wpFocusedMemberIds = new Set([...member.kundeIds].map(id => Number(id)));

  // Collect bounds from actual map markers
  const bounds = new mapboxgl.LngLatBounds();
  let hasPoints = false;
  for (const kundeId of wpFocusedMemberIds) {
    const m = markers[kundeId];
    if (m) {
      const ll = m.getLngLat();
      if (ll && ll.lat && ll.lng) {
        bounds.extend(ll);
        hasPoints = true;
      }
    }
  }

  // Zoom map FIRST, then apply styling after zoom settles
  if (hasPoints) {
    map.fitBounds(bounds, { maxZoom: 11, padding: 40 });
  }

  // Delay focus styling until after zoom animation completes
  setTimeout(() => {
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
  }, 400);

  renderWeeklyPlan();
}

// Refresh focused member IDs after plan changes (remove/delete).
// If the focused member no longer has customers, reset focus entirely.
function refreshTeamFocus() {
  if (!wpFocusedTeamMember) return;
  const team = getWeekTeamMembers();
  const member = team.find(t => t.name === wpFocusedTeamMember);
  if (!member || member.kundeIds.size === 0) {
    // Member no longer has any customers — clear focus
    wpFocusedTeamMember = null;
    wpFocusedMemberIds = null;
  } else {
    wpFocusedMemberIds = new Set([...member.kundeIds].map(id => Number(id)));
  }
  applyTeamFocusToMarkers();
  if (typeof refreshClusters === 'function') refreshClusters();
}

// Apply focus/dim styling to individual markers (called after zoom changes too)
function applyTeamFocusToMarkers() {
  for (const kundeId of Object.keys(markers)) {
    const el = markers[kundeId]?.getElement?.();
    if (!el) continue;
    const id = Number(kundeId);

    if (wpRouteActive) {
      // Route active: highlight route stops, dim everything else
      if (wpRouteStopIds && wpRouteStopIds.has(id)) {
        el.style.opacity = '1';
        el.style.filter = '';
        el.style.pointerEvents = '';
      } else {
        el.style.opacity = '0.3';
        el.style.filter = 'grayscale(0.8)';
        el.style.pointerEvents = 'none';
      }
    } else if (wpFocusedMemberIds) {
      // Team focus active
      if (wpFocusedMemberIds.has(id)) {
        el.style.opacity = '1';
        el.style.filter = '';
        el.style.pointerEvents = '';
      } else {
        el.style.opacity = '0.15';
        el.style.filter = 'grayscale(1)';
        el.style.pointerEvents = 'none';
      }
    } else {
      // Nothing active - reset
      el.style.opacity = '';
      el.style.filter = '';
      el.style.pointerEvents = '';
    }
  }
}

let weekPlanState = {
  weekStart: null,
  activeDay: null,
  days: {},
  globalAssignedTo: ''
};

function initWeekPlanState(weekStart) {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  // Ensure it's a Monday
  const day = start.getDay();
  if (day !== 1) {
    start.setDate(start.getDate() - ((day + 6) % 7));
  }
  weekPlanState.weekStart = new Date(start);
  weekPlanState.days = {};
  for (let i = 0; i < 5; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    weekPlanState.days[weekDayKeys[i]] = {
      date: formatDateISO(d),
      planned: [],
      assignedTo: ''
    };
  }
}

function getWeekPlanTotalPlanned() {
  let total = 0;
  for (const key of weekDayKeys) {
    total += (weekPlanState.days[key]?.planned?.length || 0);
  }
  return total;
}

let wpTeamMembers = null;
async function loadWpTeamMembers() {
  if (wpTeamMembers) return wpTeamMembers;
  try {
    const resp = await apiFetch('/api/team-members');
    const json = await resp.json();
    if (json.success && json.data) {
      wpTeamMembers = json.data.filter(m => m.aktiv);
    }
  } catch (e) { /* silent */ }
  return wpTeamMembers || [];
}

async function renderWeeklyPlan() {
  const container = document.getElementById('weeklyPlanContainer');
  if (!container) return;

  // Initialize state for current week if not set
  if (!weekPlanState.weekStart) {
    initWeekPlanState(new Date());
  }

  // Ensure avtaler are loaded
  if (avtaler.length === 0) {
    await loadAvtaler();
  }

  // Load team members for technician assignment dropdown
  const allTeamMembers = await loadWpTeamMembers();

  const weekNum = getISOWeekNumber(weekPlanState.weekStart);
  const totalPlanned = getWeekPlanTotalPlanned();
  const todayStr = formatDateISO(new Date());

  let html = `<div class="wp-container">`;

  // Header: week nav
  html += `
    <div class="wp-header">
      <button class="btn btn-small btn-secondary" data-action="weekPlanPrev" aria-label="Forrige uke"><i aria-hidden="true" class="fas fa-chevron-left"></i></button>
      <span class="wp-week-title">Uke ${weekNum}</span>
      <button class="btn btn-small btn-secondary" data-action="weekPlanNext" aria-label="Neste uke"><i aria-hidden="true" class="fas fa-chevron-right"></i></button>
    </div>
  `;

  // Admin: technician assignment panel
  const wpIsAdmin = localStorage.getItem('userRole') === 'admin' || localStorage.getItem('userType') === 'bruker';
  if (wpIsAdmin && allTeamMembers.length > 0) {
    const globalAssigned = weekPlanState.globalAssignedTo || '';
    const tmOpts = allTeamMembers.map(m =>
      `<option value="${escapeHtml(m.navn)}" ${globalAssigned === m.navn ? 'selected' : ''}>${escapeHtml(m.navn)}</option>`
    ).join('');
    html += `<div class="wp-dispatch-bar">
      <i aria-hidden="true" class="fas fa-user-hard-hat"></i>
      <span>Planlegg for:</span>
      <select class="wp-dispatch-select" id="wpDispatchSelect">
        <option value="">Meg selv</option>
        ${tmOpts}
      </select>
    </div>`;
  }

  // Customer search bar (always visible)
  html += `<div class="wp-search-container">
    <div class="wp-search-wrapper">
      <i aria-hidden="true" class="fas fa-search wp-search-icon"></i>
      <input type="text" class="wp-search-input" id="wpCustomerSearch"
        placeholder="S\u00f8k kunde (navn, adresse, sted)..." autocomplete="off">
    </div>
    <div class="wp-search-results" id="wpSearchResults"></div>
  </div>`;

  // Status bar when selecting
  if (weekPlanState.activeDay) {
    const dispatchName = weekPlanState.globalAssignedTo || '';
    const forWho = dispatchName ? ` for ${dispatchName}` : '';
    html += `<div class="wp-status"><i aria-hidden="true" class="fas fa-crosshairs"></i> Dra over kunder på kartet for <strong>${weekDayLabels[weekDayKeys.indexOf(weekPlanState.activeDay)]}</strong>${forWho}</div>`;
  } else if (totalPlanned === 0) {
    html += `<div class="wp-status muted"><i aria-hidden="true" class="fas fa-hand-pointer"></i> Velg en dag for å starte</div>`;
  }

  // Team bar - show all employees with planned work this week
  const teamMembers = getWeekTeamMembers();
  if (teamMembers.length > 0) {
    html += `<div class="wp-team-bar">`;
    html += `<span class="wp-team-label"><i aria-hidden="true" class="fas fa-users"></i></span>`;
    for (const member of teamMembers) {
      const isActive = wpFocusedTeamMember === member.name;
      html += `<span class="wp-team-chip ${isActive ? 'active' : ''}" style="background:${member.color}" data-action="focusTeamMember" data-member-name="${escapeHtml(member.name)}" title="Vis ${escapeHtml(member.name)} på kartet" role="button" tabindex="0">${escapeHtml(member.initials)} <span class="chip-count">${member.count}</span></span>`;
    }
    if (wpFocusedTeamMember) {
      html += `<span class="wp-team-chip" style="background:var(--bg-tertiary, #666);font-size:11px;" data-action="focusTeamMember" data-member-name="${escapeHtml(wpFocusedTeamMember)}" title="Vis alle" role="button" tabindex="0"><i aria-hidden="true" class="fas fa-times"></i></span>`;
    }
    html += `</div>`;
  }

  // Build team color map for consistent coloring
  const teamColorMap = new Map(teamMembers.map(m => [m.name, m.color]));
  const currentUser = localStorage.getItem('userName') || '';
  const currentUserColor = teamColorMap.get(currentUser) || TEAM_COLORS[0];

  // Day list
  html += `<div class="wp-days">`;

  for (let i = 0; i < 5; i++) {
    const dayKey = weekDayKeys[i];
    const dayData = weekPlanState.days[dayKey];
    const dateStr = dayData.date;
    const dayDate = new Date(dateStr + 'T00:00:00');
    const isActive = weekPlanState.activeDay === dayKey;
    const isToday = todayStr === dateStr;
    const existingAvtaler = avtaler.filter(a => a.dato === dateStr);
    const plannedCount = dayData.planned.length;
    const existingCount = existingAvtaler.length;
    const hasContent = plannedCount > 0 || existingCount > 0;

    // Day row (clickable header)
    html += `<div class="wp-day ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}" data-day="${dayKey}" data-action="setActiveDay" role="button" tabindex="0">`;

    // Day bar
    const estTotalBar = getDayEstimatedTotal(dayKey);
    html += `<div class="wp-day-bar">`;
    html += `<span class="wp-day-label">${weekDayLabels[i].substring(0, 3)}</span>`;
    html += `<span class="wp-day-date">${dayDate.getDate()}. ${monthNamesShort[dayDate.getMonth()]}</span>`;
    if (plannedCount > 0) {
      html += `<span class="wp-badge new">${plannedCount} ny${plannedCount > 1 ? 'e' : ''}</span>`;
    }
    if (existingCount > 0) {
      html += `<span class="wp-badge existing">${existingCount}</span>`;
    }
    if (estTotalBar > 0) {
      html += `<span class="wp-time-badge">~${formatMinutes(estTotalBar)}</span>`;
    }
    if (isActive) {
      html += `<i aria-hidden="true" class="fas fa-crosshairs wp-active-icon"></i>`;
    }
    html += `</div>`;

    // Expanded content (always visible if has content, or if active)
    if (hasContent || isActive) {
      html += `<div class="wp-day-content">`;

      // Progress bar showing estimated time vs 8-hour workday
      if (hasContent) {
        const estProgress = getDayEstimatedTotal(dayKey);
        const workdayMinutes = 480;
        const fillPct = Math.min(100, Math.round((estProgress / workdayMinutes) * 100));
        const overloaded = estProgress > workdayMinutes;
        html += `<div class="wp-progress-container">
          <div class="wp-progress-bar ${overloaded ? 'overloaded' : ''}" style="width:${fillPct}%"></div>
          <span class="wp-progress-label">${formatMinutes(estProgress)} / 8t</span>
        </div>`;
      }

      // Cumulative time tracker for timeline
      let cumulativeMin = 0;
      let stopIndex = 1;

      // Planned customers (new - with timeline)
      for (const c of dayData.planned) {
        const addrParts = [c.adresse, c.postnummer, c.poststed].filter(Boolean);
        const addrStr = addrParts.join(', ');
        const startTime = formatTimeOfDay(cumulativeMin);
        cumulativeMin += (c.estimertTid || 30);
        const endTime = formatTimeOfDay(cumulativeMin);
        const custAssignedName = c.addedBy || currentUser;
        const custInitials = custAssignedName ? getCreatorDisplay(custAssignedName, true) : '';
        const custColor = teamColorMap.get(custAssignedName) || currentUserColor;
        html += `
          <div class="wp-item new wp-timeline-item" data-customer-id="${c.id}" data-day="${dayKey}" style="border-left:3px solid ${custColor}">
            <span class="wp-stop-badge"><span class="wp-stop-num" style="background:${custColor}">${stopIndex}</span>${custInitials ? `<span class="wp-stop-initials" style="background:${custColor}">${escapeHtml(custInitials)}</span>` : ''}</span>
            <div class="wp-item-main">
              <span class="wp-item-name">${escapeHtml(c.navn)}</span>
              ${addrStr ? `<span class="wp-item-addr" title="${escapeHtml(addrStr)}">${escapeHtml(addrStr)}</span>` : ''}
              ${c.telefon ? `<span class="wp-item-phone"><i aria-hidden="true" class="fas fa-phone" style="font-size:8px;margin-right:3px;"></i>${escapeHtml(c.telefon)}</span>` : ''}
              <span class="wp-item-timerange"><i aria-hidden="true" class="fas fa-clock" style="font-size:8px;margin-right:2px;"></i>${startTime} - ${endTime}</span>
            </div>
            <div class="wp-item-meta">
              <input type="number" class="wp-time-input" value="${c.estimertTid || 30}" min="5" step="5"
                data-action="setEstimatedTime" data-day="${dayKey}" data-customer-id="${c.id}">
              <span>min</span>
              <button class="wp-remove" data-action="removeFromPlan" data-day="${dayKey}" data-customer-id="${c.id}" title="Fjern" aria-label="Fjern">&times;</button>
            </div>
          </div>`;
        stopIndex++;
      }

      // Existing avtaler (with team color-coded creator + timeline)
      for (const a of existingAvtaler) {
        const name = a.kunder?.navn || a.kunde_navn || 'Ukjent';
        const addr = [a.kunder?.adresse, a.kunder?.postnummer, a.kunder?.poststed].filter(Boolean).join(', ');
        const phone = a.kunder?.telefon || a.telefon || '';
        const creatorName = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
        const creatorColor = creatorName ? (teamColorMap.get(creatorName) || '#999') : '';
        const exStartTime = formatTimeOfDay(cumulativeMin);
        cumulativeMin += (a.varighet || 30);
        const exEndTime = formatTimeOfDay(cumulativeMin);
        html += `
          <div class="wp-item existing wp-timeline-item" data-avtale-id="${a.id}" data-avtale-name="${escapeHtml(name)}" style="${creatorColor ? 'border-left:3px solid ' + creatorColor : ''}" title="${creatorName ? 'Opprettet av ' + escapeHtml(creatorName) : ''}">
            <span class="wp-stop-badge"><span class="wp-stop-num" style="background:${creatorColor || 'var(--bg-tertiary, #666)'}">${stopIndex}</span>${creatorName ? `<span class="wp-stop-initials" style="background:${creatorColor || 'var(--bg-tertiary, #666)'}">${escapeHtml(getCreatorDisplay(creatorName, true))}</span>` : ''}</span>
            <div class="wp-item-main">
              <span class="wp-item-name">${escapeHtml(name)}</span>
              ${addr ? `<span class="wp-item-addr">${escapeHtml(addr)}</span>` : ''}
              ${phone ? `<span class="wp-item-phone"><i aria-hidden="true" class="fas fa-phone" style="font-size:8px;margin-right:3px;"></i>${escapeHtml(phone)}</span>` : ''}
              <span class="wp-item-timerange"><i aria-hidden="true" class="fas fa-clock" style="font-size:8px;margin-right:2px;"></i>${exStartTime} - ${exEndTime}</span>
            </div>
            <button class="wp-remove" data-action="deleteAvtale" data-avtale-id="${a.id}" data-avtale-name="${escapeHtml(name)}" title="Slett avtale" aria-label="Fjern">&times;</button>
          </div>`;
        stopIndex++;
      }

      // Empty active day hint
      if (!hasContent && isActive) {
        html += `<div class="wp-empty-hint"><i aria-hidden="true" class="fas fa-crosshairs"></i> Dra over kunder på kartet eller søk etter kunde</div>`;
      }

      html += `</div>`;

      // Day footer with summary and action buttons
      if (hasContent) {
        const estTotal = getDayEstimatedTotal(dayKey);
        const totalCount = plannedCount + existingCount;
        const hasCoords = dayData.planned.some(c => c.lat && c.lng) ||
          existingAvtaler.some(a => { const k = customers.find(c => c.id === a.kunde_id); return k?.lat && k?.lng; });
        html += `<div class="wp-day-footer">`;
        html += `<div class="wp-day-stats">`;
        html += `<span class="wp-day-summary">${totalCount} stopp${estTotal > 0 ? ` · ~${formatMinutes(estTotal)}` : ''}</span>`;
        html += `</div>`;
        html += `<div class="wp-day-actions">`;
        if (hasCoords && totalCount >= 3) {
          html += `<button class="btn btn-small btn-secondary wp-opt-btn" data-action="wpOptimizeOrder" data-day="${dayKey}" title="Optimaliser rekkefølge" aria-label="Optimaliser rekkefølge"><i aria-hidden="true" class="fas fa-sort-amount-down"></i></button>`;
        }
        if (hasCoords) {
          html += `<button class="btn btn-small btn-secondary wp-nav-btn" data-action="wpNavigateDay" data-day="${dayKey}"><i aria-hidden="true" class="fas fa-directions"></i> Naviger</button>`;
        }
        html += `</div>`;
        html += `</div>`;
      }
    }

    html += `</div>`; // close wp-day
  }

  html += `</div>`; // close wp-days

  // Action bar (sticky at bottom)
  if (totalPlanned > 0) {
    html += `
      <div class="wp-actions">
        <button class="btn btn-primary wp-save-btn" data-action="saveWeeklyPlan"><i aria-hidden="true" class="fas fa-check"></i> Opprett ${totalPlanned} avtale${totalPlanned > 1 ? 'r' : ''}</button>
        <button class="btn btn-secondary wp-clear-btn" data-action="clearWeekPlan" aria-label="Tøm plan"><i aria-hidden="true" class="fas fa-trash"></i></button>
      </div>`;
  }

  html += `</div>`; // close wp-container
  container.innerHTML = html;

  // Customer search handler for active day
  const wpSearchInput = document.getElementById('wpCustomerSearch');
  if (wpSearchInput) {
    wpSearchInput.addEventListener('input', debounce(function() {
      const query = this.value.toLowerCase().trim();
      const resultsDiv = document.getElementById('wpSearchResults');
      if (!resultsDiv) return;

      if (query.length < 1) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
        return;
      }

      const dayKey = weekPlanState.activeDay;
      if (!dayKey || !weekPlanState.days[dayKey]) {
        resultsDiv.innerHTML = '<div class="wp-search-item wp-search-no-results">Velg en dag først</div>';
        resultsDiv.style.display = 'block';
        return;
      }
      const dayData = weekPlanState.days[dayKey];
      const dateStr = dayData.date;
      const existingIds = new Set(avtaler.filter(a => a.dato === dateStr).map(a => a.kunde_id));
      const plannedIds = new Set(dayData.planned.map(c => c.id));

      const filtered = customers.filter(c =>
        (c.navn && c.navn.toLowerCase().includes(query)) ||
        (c.poststed && c.poststed.toLowerCase().includes(query)) ||
        (c.adresse && c.adresse.toLowerCase().includes(query))
      );
      const matches = sortByNavn(filtered).slice(0, 8);

      if (matches.length === 0) {
        resultsDiv.innerHTML = '<div class="wp-search-item wp-search-no-results">Ingen kunder funnet</div>';
        resultsDiv.style.display = 'block';
        return;
      }

      resultsDiv.innerHTML = matches.map(c => {
        const alreadyAdded = existingIds.has(c.id) || plannedIds.has(c.id);
        const addrText = [c.adresse, c.poststed].filter(Boolean).join(', ');
        return `<div class="wp-search-item ${alreadyAdded ? 'disabled' : ''}"
          data-action="wpAddSearchResult" data-customer-id="${c.id}"
          ${alreadyAdded ? 'title="Allerede lagt til"' : ''} role="button" tabindex="0">
          <span class="wp-search-name">${escapeHtml(c.navn)}</span>
          <span class="wp-search-addr">${escapeHtml(addrText)}</span>
          ${alreadyAdded ? '<i aria-hidden="true" class="fas fa-check" style="color:var(--color-success, #10b981);"></i>' : '<i aria-hidden="true" class="fas fa-plus"></i>'}
        </div>`;
      }).join('');
      resultsDiv.style.display = 'block';
    }, 200));
  }

  // Right-click context menu on weekplan items
  container.addEventListener('contextmenu', (e) => {
    // Existing avtaler
    const existingItem = e.target.closest('.wp-item.existing[data-avtale-id]');
    if (existingItem) {
      e.preventDefault();
      const avtaleId = Number(existingItem.dataset.avtaleId);
      const avtale = typeof avtaler !== 'undefined' ? avtaler.find(a => a.id === avtaleId) : null;
      if (avtale) {
        showWeekplanExistingContextMenu(avtale, e.clientX, e.clientY);
      }
      return;
    }
    // Planned (unsaved) items
    const plannedItem = e.target.closest('.wp-item.new[data-customer-id]');
    if (plannedItem) {
      e.preventDefault();
      const customerId = Number(plannedItem.dataset.customerId);
      const dayKey = plannedItem.dataset.day;
      const customer = typeof customers !== 'undefined' ? customers.find(c => c.id === customerId) : null;
      if (customer && dayKey) {
        showWeekplanPlannedContextMenu(customer, dayKey, e.clientX, e.clientY);
      }
      return;
    }
  });

  // Update map markers with plan badges
  updateWeekPlanBadges();

  // Load travel times asynchronously for each day with content
  if (typeof MatrixService !== 'undefined') {
    for (let i = 0; i < 5; i++) {
      const dayKey = weekDayKeys[i];
      const dayData = weekPlanState.days[dayKey];
      const dateStr = dayData.date;
      const existingCount = avtaler.filter(a => a.dato === dateStr).length;
      if (dayData.planned.length > 0 || existingCount > 0) {
        wpLoadTravelTimes(dayKey);
      }
    }
  }
}

// Load and display travel times between stops for a day
async function wpLoadTravelTimes(dayKey) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return;

  const dateStr = dayData.date;
  const routeStart = getRouteStartLocation();
  if (!routeStart) return;

  // Build coordinate array: [office, stop1, stop2, ..., office]
  const coords = [[routeStart.lng, routeStart.lat]];

  for (const c of dayData.planned) {
    if (c.lat && c.lng) coords.push([c.lng, c.lat]);
  }

  const existingAvtaler = avtaler.filter(a => a.dato === dateStr);
  for (const a of existingAvtaler) {
    const kunde = customers.find(c => c.id === a.kunde_id);
    if (kunde?.lat && kunde?.lng) {
      coords.push([kunde.lng, kunde.lat]);
    }
  }

  // Return to office
  coords.push([startLng, startLat]);

  if (coords.length < 3) return; // Need at least office + 1 stop + office

  const times = await MatrixService.getSequentialTimes(coords);
  if (!times || times.length === 0) return;

  // Verify we're still showing this day (user might have navigated away)
  const dayEl = document.querySelector(`.wp-day[data-day="${dayKey}"] .wp-day-content`);
  if (!dayEl) return;

  // Remove any previously inserted separators
  dayEl.querySelectorAll('.wp-drive-separator').forEach(el => el.remove());

  const items = dayEl.querySelectorAll('.wp-timeline-item');

  items.forEach((item, idx) => {
    const time = times[idx]; // drive from previous to this stop
    if (!time || time.durationSec === 0) return;

    const driveMin = Math.round(time.durationSec / 60);
    const sep = document.createElement('div');
    sep.className = 'wp-drive-separator';
    sep.innerHTML = `<i aria-hidden="true" class="fas fa-car" style="font-size:9px"></i> ${formatMinutes(driveMin) || '0m'} kjøretid`;
    item.parentNode.insertBefore(sep, item);
  });

  // Update the footer summary with total driving info
  const totalDriveSec = times.reduce((sum, t) => sum + t.durationSec, 0);
  const totalDriveMin = Math.round(totalDriveSec / 60);
  const totalKm = Math.round(times.reduce((sum, t) => sum + t.distanceM, 0) / 1000);

  const summaryEl = dayEl.parentNode.querySelector('.wp-day-stats .wp-day-summary');
  if (summaryEl && totalDriveMin > 0) {
    summaryEl.textContent += ` · ${formatMinutes(totalDriveMin)} kjøretid · ${totalKm} km`;
  }
}

// Day-picker popup for adding customers to weekly plan from overdue/upcoming views
function showWeekPlanDayPicker(customerIdStr, anchorEl) {
  if (!weekPlanState.weekStart) initWeekPlanState(new Date());
  closeWeekPlanDayPicker();

  const popup = document.createElement('div');
  popup.id = 'wpDayPickerPopup';
  popup.className = 'wp-day-picker-popup';

  let html = '<div class="wp-day-picker-header">Velg dag i ukeplan</div><div class="wp-day-picker-days">';
  weekDayKeys.forEach((key, i) => {
    const dayData = weekPlanState.days[key];
    if (!dayData) return;
    const d = new Date(dayData.date + 'T00:00:00');
    const dateNum = d.getDate();
    const monthStr = monthNamesShort[d.getMonth()];
    const label = weekDayLabels[i];
    const planned = dayData.planned?.length || 0;
    const badge = planned > 0 ? ` <span class="wp-dp-badge">${planned}</span>` : '';
    html += `<button class="wp-dp-day-btn" data-wp-day="${key}" data-customer-ids="${escapeHtml(customerIdStr)}">
      <span class="wp-dp-day-name">${label}</span>
      <span class="wp-dp-day-date">${dateNum}. ${monthStr}${badge}</span>
    </button>`;
  });
  html += '</div>';
  popup.innerHTML = html;
  document.body.appendChild(popup);

  // Position relative to anchor button
  const rect = anchorEl.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.left;
  if (top + popupRect.height > window.innerHeight) {
    top = rect.top - popupRect.height - 4;
  }
  if (left + popupRect.width > window.innerWidth) {
    left = window.innerWidth - popupRect.width - 8;
  }
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;

  // Day button click handlers
  popup.querySelectorAll('.wp-dp-day-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dayKey = btn.dataset.wpDay;
      const ids = btn.dataset.customerIds.split(',').map(id => Number.parseInt(id));
      const custList = ids.map(id => customers.find(c => c.id === id)).filter(Boolean);

      const prevActiveDay = weekPlanState.activeDay;
      weekPlanState.activeDay = dayKey;
      addCustomersToWeekPlan(custList);
      weekPlanState.activeDay = prevActiveDay;
      closeWeekPlanDayPicker();
    });
  });

  // Close on outside click (deferred)
  setTimeout(() => {
    const outsideHandler = (e) => {
      if (!popup.contains(e.target)) closeWeekPlanDayPicker();
    };
    document.addEventListener('click', outsideHandler, { once: true });
  }, 0);

  // Close on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeWeekPlanDayPicker();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeWeekPlanDayPicker() {
  document.getElementById('wpDayPickerPopup')?.remove();
}

function addCustomersToWeekPlan(customersList) {
  if (!weekPlanState.activeDay) return;

  const dayKey = weekPlanState.activeDay;
  const dayData = weekPlanState.days[dayKey];
  const dateStr = dayData.date;
  const existingAvtaleKundeIds = new Set(
    avtaler.filter(a => a.dato === dateStr).map(a => a.kunde_id)
  );

  let added = 0;
  let skippedExisting = 0;
  let skippedDuplicate = 0;

  for (const customer of customersList) {
    // Skip if already has an avtale for this date
    if (existingAvtaleKundeIds.has(customer.id)) {
      skippedExisting++;
      continue;
    }

    // Skip if already planned for this day
    if (dayData.planned.some(c => c.id === customer.id)) {
      skippedDuplicate++;
      continue;
    }

    dayData.planned.push({
      id: customer.id,
      navn: customer.navn,
      adresse: customer.adresse || '',
      postnummer: customer.postnummer || '',
      poststed: customer.poststed || '',
      telefon: customer.telefon || '',
      kategori: customer.kategori || null,
      lat: customer.lat || null,
      lng: customer.lng || null,
      estimertTid: customer.estimert_tid || 30,
      addedBy: weekPlanState.globalAssignedTo || localStorage.getItem('userName') || 'admin'
    });
    added++;
  }

  let msg = `${added} kunder lagt til ${weekDayLabels[weekDayKeys.indexOf(dayKey)]}`;
  if (skippedExisting > 0) msg += ` (${skippedExisting} har allerede avtale)`;
  if (skippedDuplicate > 0) msg += ` (${skippedDuplicate} allerede lagt til)`;
  showToast(msg, added > 0 ? 'success' : 'info');

  renderWeeklyPlan();
}

// Add a single customer to weekplan from map tooltip/context menu
function addToWeekPlanFromMap(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;
  if (!weekPlanState.activeDay) {
    showToast('Åpne ukeplanen og velg en dag først', 'info');
    return;
  }
  addCustomersToWeekPlan([customer]);
}

async function saveWeeklyPlan() {
  const totalPlanned = getWeekPlanTotalPlanned();
  if (totalPlanned === 0) return;

  const confirmed = await showConfirm(
    `Opprett ${totalPlanned} avtaler for uke ${getISOWeekNumber(weekPlanState.weekStart)}?`,
    'Bekreft oppretting'
  );
  if (!confirmed) return;

  let created = 0;
  let errors = 0;
  let lastError = '';
  const userName = localStorage.getItem('userName') || 'admin';

  // Collect all planned items with per-customer technician assignment
  const allItems = [];
  for (const dayKey of weekDayKeys) {
    const dayData = weekPlanState.days[dayKey];
    for (const customer of dayData.planned) {
      const assignedName = customer.addedBy || weekPlanState.globalAssignedTo || userName;
      allItems.push({ customer, date: dayData.date, opprettetAv: assignedName });
    }
  }

  // Show progress toast
  const progressToast = showToast(`Oppretter avtaler... 0/${allItems.length}`, 'info', 0);

  // Process in parallel batches of 5
  const BATCH_SIZE = 5;
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ customer, date, opprettetAv }) => {
        const payload = {
          kunde_id: customer.id,
          dato: date,
          beskrivelse: customer.kategori || 'Planlagt oppdrag',
          opprettet_av: opprettetAv,
          varighet: customer.estimertTid || 30
        };
        const response = await apiFetch('/api/avtaler', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.error?.message || errData.error || errData.message || response.statusText;
          throw new Error(`${customer.navn}: ${errMsg}`);
        }
        return customer.navn;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        created++;
      } else {
        errors++;
        lastError = r.reason?.message || 'Ukjent feil';
        console.error('Avtale-feil:', r.reason);
      }
    }

    // Update progress
    if (progressToast) {
      const done = Math.min(i + BATCH_SIZE, allItems.length);
      const span = progressToast.querySelector('span');
      if (span) span.textContent = `Oppretter avtaler... ${done}/${allItems.length}`;
    }
  }

  // Remove progress toast
  if (progressToast) progressToast.remove();

  if (created > 0) {
    showToast(`${created} avtaler opprettet!`, 'success');
  }
  if (errors > 0) {
    showToast(`${errors} avtaler feilet: ${lastError}`, 'error');
  }

  // Clear planned, reload
  for (const dayKey of weekDayKeys) {
    weekPlanState.days[dayKey].planned = [];
  }
  weekPlanState.activeDay = null;

  // Deactivate area select if active
  if (areaSelectMode) toggleAreaSelect();

  await loadAvtaler();
  refreshTeamFocus();
  renderWeeklyPlan();
}

// Weekplan context menu is now handled by the generic showContextMenu() system
// See context-menu.js: showWeekplanExistingContextMenu() and showWeekplanPlannedContextMenu()

function clearWeekPlan() {
  for (const dayKey of weekDayKeys) {
    weekPlanState.days[dayKey].planned = [];
  }
  weekPlanState.activeDay = null;
  if (areaSelectMode) toggleAreaSelect();
  refreshTeamFocus();
  renderWeeklyPlan();
  showToast('Plan tømt', 'info');
}

async function wpOptimizeOrder(dayKey) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return;

  const stops = dayData.planned.filter(c => c.lat && c.lng);
  if (stops.length < 3) {
    showToast('Trenger minst 3 stopp for optimalisering', 'info');
    return;
  }

  const routeStart = getRouteStartLocation();
  if (!routeStart) {
    showToast('Sett firmaadresse i admin for å optimalisere rekkefølge', 'warning');
    return;
  }
  const loadingToast = showToast('Optimaliserer rekkefølge...', 'info', 0);

  try {
    const optimizeBody = {
      jobs: stops.map((s, idx) => ({
        id: idx + 1,
        location: [s.lng, s.lat],
        service: (s.estimertTid || 30) * 60
      })),
      vehicles: [{
        id: 1,
        profile: 'driving-car',
        start: [routeStart.lng, routeStart.lat],
        end: [routeStart.lng, routeStart.lat]
      }]
    };

    const headers = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const response = await fetch('/api/routes/optimize', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(optimizeBody)
    });

    if (loadingToast) loadingToast.remove();

    if (!response.ok) {
      showToast('Kunne ikke optimalisere rute', 'error');
      return;
    }

    const result = await response.json();
    const optData = result.data || result;
    if (optData.routes?.[0]?.steps) {
      const jobSteps = optData.routes[0].steps.filter(s => s.type === 'job');
      const optimizedStops = jobSteps.map(step => stops[step.job - 1]).filter(Boolean);
      if (optimizedStops.length === stops.length) {
        const plannedOptimized = [];
        for (const s of optimizedStops) {
          const p = dayData.planned.find(c => c.id === s.id);
          if (p) plannedOptimized.push(p);
        }
        for (const p of dayData.planned) {
          if (!plannedOptimized.some(o => o.id === p.id)) plannedOptimized.push(p);
        }
        dayData.planned = plannedOptimized;
        renderWeeklyPlan();
        showToast('Rekkefølge optimalisert', 'success');
      }
    }
  } catch (err) {
    if (loadingToast) loadingToast.remove();
    console.warn('[wpOptimizeOrder] Failed:', err);
    showToast('Feil ved optimalisering', 'error');
  }
}

async function wpNavigateDay(dayKey) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return;
  const dateStr = dayData.date;

  // Collect all customers with coordinates + estimated time
  const stops = [];

  // Planned customers
  for (const c of dayData.planned) {
    if (c.lat && c.lng) {
      stops.push({ id: c.id, lat: c.lat, lng: c.lng, navn: c.navn, adresse: c.adresse || '', estimertTid: c.estimertTid || 30 });
    }
  }

  // Existing avtaler - look up coordinates from customers array
  const existingAvtaler = avtaler.filter(a => a.dato === dateStr);
  for (const a of existingAvtaler) {
    const kunde = customers.find(c => c.id === a.kunde_id);
    if (kunde?.lat && kunde?.lng) {
      if (!stops.some(s => s.lat === kunde.lat && s.lng === kunde.lng)) {
        stops.push({ id: kunde.id, lat: kunde.lat, lng: kunde.lng, navn: kunde.navn, adresse: kunde.adresse || '', estimertTid: 30 });
      }
    }
  }

  if (stops.length === 0) {
    showToast('Ingen kunder med koordinater for denne dagen', 'info');
    return;
  }

  const routeStart = getRouteStartLocation();
  if (!routeStart) {
    showToast('Sett firmaadresse i admin for å tegne rute', 'warning');
    return;
  }
  const startLatLng = [routeStart.lat, routeStart.lng];

  // Loading toast
  const loadingToast = showToast('Optimaliserer rute...', 'info', 0);

  // Step 1: Optimize stop order via VROOM (3+ stops)
  if (stops.length >= 3) {
    try {
      const optimizeBody = {
        jobs: stops.map((s, idx) => ({
          id: idx + 1,
          location: [s.lng, s.lat],
          service: (s.estimertTid || 30) * 60
        })),
        vehicles: [{
          id: 1,
          profile: 'driving-car',
          start: [routeStart.lng, routeStart.lat],
          end: [routeStart.lng, routeStart.lat]
        }]
      };

      const optHeaders = { 'Content-Type': 'application/json' };
      const optCsrf = getCsrfToken();
      if (optCsrf) optHeaders['X-CSRF-Token'] = optCsrf;

      const optResp = await fetch('/api/routes/optimize', {
        method: 'POST',
        headers: optHeaders,
        credentials: 'include',
        body: JSON.stringify(optimizeBody)
      });

      if (optResp.ok) {
        const optResult = await optResp.json();
        const optData = optResult.data || optResult;
        if (optData.routes?.[0]?.steps) {
          const jobSteps = optData.routes[0].steps.filter(s => s.type === 'job');
          const optimizedStops = jobSteps.map(step => stops[step.job - 1]).filter(Boolean);
          if (optimizedStops.length === stops.length) {
            // Reorder stops array
            stops.length = 0;
            stops.push(...optimizedStops);
            // Reorder planned array in state to match
            const plannedOptimized = [];
            for (const s of optimizedStops) {
              const p = dayData.planned.find(c => c.id === s.id);
              if (p) plannedOptimized.push(p);
            }
            for (const p of dayData.planned) {
              if (!plannedOptimized.some(o => o.id === p.id)) plannedOptimized.push(p);
            }
            dayData.planned = plannedOptimized;
            renderWeeklyPlan();
          }
        }
      }
    } catch (e) {
      console.warn('[wpNavigateDay] Optimization failed, using original order:', e);
    }
  }

  // Step 2: Build coordinates and get directions
  if (loadingToast) loadingToast.textContent = 'Beregner rute...';
  const coordinates = [
    [routeStart.lng, routeStart.lat],
    ...stops.map(s => [s.lng, s.lat]),
    [routeStart.lng, routeStart.lat]
  ];

  try {
    const headers = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const response = await fetch('/api/routes/directions', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ coordinates })
    });

    // Remove loading toast
    if (loadingToast) loadingToast.remove();

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error('[wpNavigateDay] API error:', response.status, errBody);
      showToast(`Kunne ikke beregne rute (${response.status})`, 'error');
      return;
    }

    const rawData = await response.json();

    // Handle wrapped ({ success, data: {...} }) or raw ORS response
    const geoData = rawData.data || rawData;
    const feature = geoData.features?.[0];

    // Extract driving summary
    let drivingSeconds = 0;
    let distanceMeters = 0;
    if (feature?.properties?.summary) {
      drivingSeconds = feature.properties.summary.duration || 0;
      distanceMeters = feature.properties.summary.distance || 0;
    }
    // Fallback: sum segments if no top-level summary
    if (drivingSeconds === 0 && feature?.properties?.segments?.length > 0) {
      for (const seg of feature.properties.segments) {
        drivingSeconds += seg.duration || 0;
        distanceMeters += seg.distance || 0;
      }
    }

    // Clear any existing route
    clearRoute();

    // Dim all markers/clusters via CSS class on map
    wpRouteActive = true;
    wpRouteStopIds = new Set(stops.map(s => Number(s.id)));
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();

    // Build route line: start → stop1 → stop2 → ... → start
    // Note: startLatLng is [lat, lng], convert to [lng, lat] for GeoJSON
    const lineCoords = [
      [startLatLng[1], startLatLng[0]],
      ...stops.map(s => [s.lng, s.lat]),
      [startLatLng[1], startLatLng[0]]
    ];

    // Try ORS road-following geometry, fall back to straight lines
    let routeDrawn = false;
    if (feature?.geometry?.coordinates?.length > 2) {
      try {
        const geomType = feature.geometry.type;
        let routeCoords;
        if (geomType === 'MultiLineString') {
          routeCoords = feature.geometry.coordinates.flat();
        } else {
          routeCoords = feature.geometry.coordinates;
        }
        if (routeCoords.length > 2 && !isNaN(routeCoords[0][0]) && !isNaN(routeCoords[0][1])) {
          drawRouteGeoJSON(routeCoords, { color: '#2563eb', width: 5, opacity: 0.85 });
          routeDrawn = true;
        }
      } catch (e) {
        console.warn('[wpNavigateDay] ORS geometry failed:', e);
      }
    }
    // Fallback: straight dashed lines between stops
    if (!routeDrawn) {
      drawRouteGeoJSON(lineCoords, { color: '#2563eb', width: 4, opacity: 0.7, dasharray: [10, 8] });
    }

    // Fit map to route
    const allBounds = boundsFromLatLngArray([startLatLng, ...stops.map(s => [s.lat, s.lng])]);
    map.fitBounds(allBounds, { padding: 50 });

    // Store for export to Maps
    currentRouteData = { customers: stops, duration: drivingSeconds, distance: distanceMeters };

    // Show summary panel
    showWpRouteSummary(dayKey, stops, drivingSeconds, distanceMeters);

  } catch (err) {
    if (loadingToast) loadingToast.remove();
    console.error('Ruteberegning feilet:', err);
    showToast('Feil ved ruteberegning', 'error');
    wpRouteActive = false;
    wpRouteStopIds = null;
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
  }
}

// Show weekly plan route summary panel
function showWpRouteSummary(dayKey, stops, drivingSeconds, distanceMeters) {
  // Only remove previous panel element (don't clear route - we just drew a new one)
  const oldPanel = document.getElementById('wpRouteSummary');
  if (oldPanel) oldPanel.remove();

  const drivingMin = Math.round(drivingSeconds / 60);
  const customerMin = stops.reduce((sum, s) => sum + (s.estimertTid || 30), 0);
  const totalMin = drivingMin + customerMin;
  const km = (distanceMeters / 1000).toFixed(1);
  const dayLabel = weekDayLabels[weekDayKeys.indexOf(dayKey)];

  const panel = document.createElement('div');
  panel.id = 'wpRouteSummary';
  panel.className = 'wp-route-summary';
  panel.innerHTML = `
    <div class="wp-route-header">
      <strong>${escapeHtml(dayLabel)} — ${stops.length} stopp</strong>
      <button class="wp-route-close" data-action="closeWpRoute" aria-label="Fjern">&times;</button>
    </div>
    <div class="wp-route-stats">
      <div class="wp-route-stat">
        <i aria-hidden="true" class="fas fa-car"></i>
        <span>Kjøretid: ~${formatMinutes(drivingMin)}</span>
      </div>
      <div class="wp-route-stat">
        <i aria-hidden="true" class="fas fa-user-clock"></i>
        <span>Hos kunder: ~${formatMinutes(customerMin)}</span>
      </div>
      <div class="wp-route-stat total">
        <i aria-hidden="true" class="fas fa-clock"></i>
        <span>Totalt: ~${formatMinutes(totalMin)}</span>
      </div>
      <div class="wp-route-stat">
        <i aria-hidden="true" class="fas fa-road"></i>
        <span>${km} km</span>
      </div>
    </div>
    <div class="wp-route-actions">
      <button class="btn btn-small btn-primary" data-action="wpExportMaps" data-day="${dayKey}">
        <i aria-hidden="true" class="fas fa-external-link-alt"></i> Åpne i Maps
      </button>
      <button class="btn btn-small btn-secondary" data-action="closeWpRoute">
        <i aria-hidden="true" class="fas fa-times"></i> Lukk rute
      </button>
    </div>
  `;

  document.body.appendChild(panel);
}

// Close weekly plan route summary and clear route from map
function closeWpRouteSummary() {
  const panel = document.getElementById('wpRouteSummary');
  if (panel) panel.remove();
  clearRoute();
  wpRouteActive = false;
  wpRouteStopIds = null;
  applyTeamFocusToMarkers();
  if (typeof refreshClusters === 'function') refreshClusters();
}

// Export weekly plan route to Google/Apple Maps
function wpExportToMaps() {
  if (!currentRouteData || !currentRouteData.customers.length) return;

  const stops = currentRouteData.customers;
  const routeStart = getRouteStartLocation();
  if (!routeStart) {
    showToast('Sett firmaadresse i admin for å eksportere rute', 'warning');
    return;
  }
  const startCoord = `${routeStart.lat},${routeStart.lng}`;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) {
    const daddr = stops.map(s => `${s.lat},${s.lng}`).join('+to:') + `+to:${startCoord}`;
    window.open(`https://maps.apple.com/?saddr=${startCoord}&daddr=${daddr}&dirflg=d`, '_blank');
  } else {
    const waypoints = stops.map(s => `${s.lat},${s.lng}`).join('|');
    let url = `https://www.google.com/maps/dir/?api=1&origin=${startCoord}&destination=${startCoord}`;
    url += `&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
    window.open(url, '_blank');
  }
}

// === Quick Calendar Menu (from map markers) ===

function closeCalendarQuickMenu() {
  document.getElementById('quickCalendarMenu')?.remove();
  document.removeEventListener('click', handleQuickMenuOutsideClick);
}

function handleQuickMenuOutsideClick(e) {
  const menu = document.getElementById('quickCalendarMenu');
  if (menu && !menu.contains(e.target)) {
    closeCalendarQuickMenu();
  }
}

function showCalendarQuickMenu(customerId, customerName, anchorEl) {
  closeCalendarQuickMenu();

  const today = new Date();
  const tomorrow = addDaysToDate(today, 1);
  const nextMonday = getNextMonday(today);

  const menu = document.createElement('div');
  menu.id = 'quickCalendarMenu';
  menu.className = 'quick-calendar-menu';
  menu.innerHTML = `
    <div class="quick-menu-header">${escapeHtml(customerName)}</div>
    <div class="quick-menu-item" data-action="quickAddAvtale" data-customer-id="${customerId}" data-customer-name="${escapeHtml(customerName)}" data-quick-date="${formatDateISO(today)}" role="button" tabindex="0">
      <i aria-hidden="true" class="fas fa-calendar-day"></i> I dag (${today.getDate()}.${today.getMonth() + 1})
    </div>
    <div class="quick-menu-item" data-action="quickAddAvtale" data-customer-id="${customerId}" data-customer-name="${escapeHtml(customerName)}" data-quick-date="${formatDateISO(tomorrow)}" role="button" tabindex="0">
      <i aria-hidden="true" class="fas fa-calendar-day"></i> I morgen (${tomorrow.getDate()}.${tomorrow.getMonth() + 1})
    </div>
    <div class="quick-menu-item" data-action="quickAddAvtale" data-customer-id="${customerId}" data-customer-name="${escapeHtml(customerName)}" data-quick-date="${formatDateISO(nextMonday)}" role="button" tabindex="0">
      <i aria-hidden="true" class="fas fa-calendar-week"></i> Neste mandag (${nextMonday.getDate()}.${nextMonday.getMonth() + 1})
    </div>
    <div class="quick-menu-item" data-action="addCustomerToCalendar" data-customer-id="${customerId}" data-customer-name="${escapeHtml(customerName)}" role="button" tabindex="0">
      <i aria-hidden="true" class="fas fa-calendar-alt"></i> Velg dato...
    </div>
  `;

  document.body.appendChild(menu);

  // Position near anchor element
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    menu.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';
  } else {
    menu.style.left = '50%';
    menu.style.top = '50%';
    menu.style.transform = 'translate(-50%, -50%)';
  }

  // Ensure menu stays within viewport
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - menuRect.height - 10) + 'px';
    }
    if (menuRect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - menuRect.width - 10) + 'px';
    }
  });

  setTimeout(() => {
    document.addEventListener('click', handleQuickMenuOutsideClick);
  }, 10);
}

async function quickAddAvtaleForDate(customerId, customerName, date) {
  const customer = customers.find(c => c.id === customerId);
  const avtaleType = customer?.kategori || 'Kontroll';
  const varighet = customer?.estimert_tid || undefined;

  try {
    const response = await apiFetch('/api/avtaler', {
      method: 'POST',
      body: JSON.stringify({
        kunde_id: customerId,
        dato: date,
        type: avtaleType,
        beskrivelse: avtaleType,
        varighet,
        opprettet_av: localStorage.getItem('userName') || 'admin'
      })
    });

    if (response.ok) {
      showToast(`${customerName} lagt til ${date}`, 'success');
      await loadAvtaler();
      renderCalendar();
      if (splitViewOpen) renderSplitWeekContent();
    } else {
      const err = await response.json().catch(() => ({}));
      showToast('Kunne ikke opprette avtale: ' + (err.error || 'ukjent feil'), 'error');
    }
  } catch (err) {
    console.error('Error quick-adding avtale:', err);
    showToast('Kunne ikke opprette avtale', 'error');
  }
}

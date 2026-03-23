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
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (short) {
    // Initialer: "Sander Martinsen" → "SM"
    return parts.map(p => p[0]?.toUpperCase() || '').join('');
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

const weekDayKeys = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lordag', 'sondag'];
const weekDayLabels = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const weekDayLabelsShort = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
const monthNamesShort = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

const NOTE_TYPES = [
  { key: 'ring',       label: 'Ring',       icon: 'fa-phone',           color: '#2563eb' },
  { key: 'besok',      label: 'Bes\u00f8k',      icon: 'fa-wrench',          color: '#16a34a' },
  { key: 'bestill',    label: 'Bestill',     icon: 'fa-box',             color: '#ea580c' },
  { key: 'oppfolging', label: 'Oppf\u00f8lging',  icon: 'fa-clipboard-check', color: '#9333ea' },
  { key: 'notat',      label: 'Notat',       icon: 'fa-sticky-note',     color: '#64748b' },
];

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

function wpGetDayCapacityByMember(dayKey) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return new Map();
  const userName = localStorage.getItem('userName') || '';
  const memberMap = new Map();
  for (const c of dayData.planned) {
    const name = c.addedBy || weekPlanState.globalAssignedTo || userName;
    if (!name) continue;
    if (!memberMap.has(name)) memberMap.set(name, { totalMin: 0, stopCount: 0 });
    const entry = memberMap.get(name);
    entry.totalMin += (c.estimertTid || 30);
    entry.stopCount++;
  }
  return memberMap;
}

function getWpDayTeamMembers(dayKey) {
  const memberCap = wpGetDayCapacityByMember(dayKey);
  return Array.from(memberCap.entries()).map(([name, data]) => ({ name, count: data.stopCount }));
}

async function getWpAvailableTeamMembers(dayKey) {
  const allMembers = await loadWpTeamMembers();
  if (!allMembers || allMembers.length === 0) return [];
  const dayMembers = getWpDayTeamMembers(dayKey);
  const dayMemberMap = new Map(dayMembers.map(m => [m.name, m.count]));
  // Include all team members + current user, show stop count for those with stops
  const currentUser = localStorage.getItem('userName') || '';
  const seen = new Set();
  const result = [];
  // First: members that have stops on this day
  for (const m of dayMembers) {
    result.push({ name: m.name, count: m.count });
    seen.add(m.name);
  }
  // Then: other team members without stops
  for (const m of allMembers) {
    if (!seen.has(m.navn)) {
      result.push({ name: m.navn, count: 0 });
      seen.add(m.navn);
    }
  }
  // Include current user if not already
  if (currentUser && !seen.has(currentUser)) {
    result.push({ name: currentUser, count: dayMemberMap.get(currentUser) || 0 });
  }
  return result;
}

function wpShowTeamMemberPicker(dayKey, members, totalDayStops) {
  return new Promise((resolve) => {
    // Build color map from TEAM_COLORS
    const colorMap = new Map();
    members.forEach((m, i) => { colorMap.set(m.name, TEAM_COLORS[i % TEAM_COLORS.length]); });

    let optionsHtml = members.map((m, i) => {
      const initials = getCreatorDisplay(m.name, true);
      const color = colorMap.get(m.name) || TEAM_COLORS[0];
      const countLabel = m.count > 0 ? `${m.count} stopp` : '';
      return `<button class="wp-team-picker-option" data-member-idx="${i}">
        <span class="wp-team-picker-avatar" style="background:${color}">${escapeHtml(initials)}</span>
        <span class="wp-team-picker-name">${escapeHtml(m.name)}</span>
        <span class="wp-team-picker-count">${countLabel}</span>
      </button>`;
    }).join('');

    optionsHtml += `<button class="wp-team-picker-option wp-team-picker-all" data-member-idx="__all__">
      <span class="wp-team-picker-avatar" style="background:#888"><i class="fas fa-users" aria-hidden="true" style="font-size:11px"></i></span>
      <span class="wp-team-picker-name">Alle</span>
      <span class="wp-team-picker-count">${totalDayStops} stopp</span>
    </button>`;

    const overlay = document.createElement('div');
    overlay.className = 'wp-team-picker-overlay';
    overlay.innerHTML = `<div class="wp-team-picker">
      <div class="wp-team-picker-title">Velg teammedlem</div>
      <div class="wp-team-picker-options">${optionsHtml}</div>
      <button class="btn btn-small btn-secondary wp-team-picker-cancel">Avbryt</button>
    </div>`;

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }

    overlay.addEventListener('click', (e) => {
      const opt = e.target.closest('.wp-team-picker-option');
      if (opt) {
        const idx = opt.dataset.memberIdx;
        if (idx === '__all__') { cleanup('__all__'); return; }
        const member = members[parseInt(idx, 10)];
        cleanup(member ? member.name : null);
        return;
      }
      if (e.target.closest('.wp-team-picker-cancel')) { cleanup(null); return; }
      if (e.target === overlay) { cleanup(null); }
    });

    document.body.appendChild(overlay);
  });
}

function wpRenderCapacityBars(dayKey, teamColorMap, currentUserColor) {
  const memberCap = wpGetDayCapacityByMember(dayKey);
  if (memberCap.size < 2) return '';
  const maxMin = 480;
  let html = '<div class="wp-capacity-section">';
  for (const [name, data] of memberCap) {
    const initials = getCreatorDisplay(name, true);
    const color = teamColorMap.get(name) || currentUserColor;
    const fillPct = Math.min(100, Math.round((data.totalMin / maxMin) * 100));
    const level = data.totalMin > maxMin ? 'wp-cap-red' : data.totalMin >= maxMin * 0.8 ? 'wp-cap-yellow' : 'wp-cap-green';
    html += `<div class="wp-capacity-member" title="${escapeHtml(name)}: ${data.stopCount} stopp">
      <span class="wp-capacity-avatar" style="background:${color}">${escapeHtml(initials)}</span>
      <span class="wp-capacity-time">${formatMinutes(data.totalMin)} / 8t</span>
      <div class="wp-capacity-bar-bg"><div class="wp-capacity-bar ${level}" style="width:${fillPct}%"></div></div>
    </div>`;
  }
  html += '</div>';
  return html;
}

const TEAM_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#c026d3', '#ca8a04'];
let wpFocusedTeamMember = null; // currently highlighted team member name
let wpFocusedMemberIds = null; // Set of customer IDs for focused member (used by cluster icons)
let wpRouteActive = false; // true when navigating a route (dims markers)
let wpRouteStopIds = null; // Set of customer IDs that are stops in the active route
let wpShowAllMarkers = false; // toggle: true = show dimmed, false = hide completely

function getWeekTeamMembers() {
  if (!weekPlanState.days) return [];
  const weekDates = new Set(weekDayKeys.map(k => weekPlanState.days[k]?.date).filter(Boolean));
  const teamMap = new Map(); // name → { initials, count, kundeIds: Set }

  // Planned (unsaved) - use per-customer addedBy, falling back to global assigned
  const userName = localStorage.getItem('userName') || '';
  for (const dayKey of weekDayKeys) {
    const dayData = weekPlanState.days[dayKey];
    if (!dayData || dayData.planned.length === 0) continue;
    for (const c of dayData.planned) {
      const assignedName = c.addedBy || weekPlanState.globalAssignedTo || userName;
      if (!assignedName) continue;
      if (!teamMap.has(assignedName)) teamMap.set(assignedName, { initials: getCreatorDisplay(assignedName, true), count: 0, kundeIds: new Set() });
      const entry = teamMap.get(assignedName);
      entry.count++;
      entry.kundeIds.add(c.id);
    }
  }

  // Existing avtaler this week
  for (const a of avtaler) {
    if (!weekDates.has(a.dato) || !a.kunde_id) continue;
    const creator = a.tildelt_tekniker || (a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '');
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
    wpShowAllMarkers = false;
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
    renderWeeklyPlan();
    return;
  }

  // Clear calendar focus if active
  if (typeof clearCalendarFocus === 'function' && calendarFocusedDay) clearCalendarFocus();

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
    const cp = document.querySelector('.content-panel');
    const cpWidth = (cp && !cp.classList.contains('closed')) ? cp.offsetWidth : 0;
    map.fitBounds(bounds, { maxZoom: 13, padding: { top: 60, bottom: 60, left: 60, right: cpWidth + 60 } });
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

    // Clear previous state
    el.classList.remove('route-hidden', 'route-dimmed');
    el.style.opacity = '';
    el.style.filter = '';
    el.style.pointerEvents = '';

    if (wpRouteActive) {
      if (wpRouteStopIds && wpRouteStopIds.has(id)) {
        // Route stop: always visible
      } else if (wpShowAllMarkers) {
        el.classList.add('route-dimmed');
      } else {
        el.classList.add('route-hidden');
      }
    } else if (wpFocusedMemberIds) {
      if (wpFocusedMemberIds.has(id)) {
        // Focused member's customer: visible
      } else if (wpShowAllMarkers) {
        el.classList.add('route-dimmed');
      } else {
        el.classList.add('route-hidden');
      }
    }
    // Else: no classes = fully visible (reset)
  }
}

function toggleRouteMarkerVisibility() {
  wpShowAllMarkers = !wpShowAllMarkers;
  applyTeamFocusToMarkers();
  if (typeof refreshClusters === 'function') refreshClusters();
  const btn = document.querySelector('[data-action="toggleRouteMarkers"]');
  if (btn) {
    btn.innerHTML = wpShowAllMarkers
      ? '<i aria-hidden="true" class="fas fa-eye-slash"></i> Skjul andre'
      : '<i aria-hidden="true" class="fas fa-eye"></i> Vis alle';
  }
}

let weekPlanState = {
  weekStart: null,
  activeDay: null,
  days: {},
  globalAssignedTo: '',
  notater: [],
  overforteNotater: [],
  noteFilter: 'alle'
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
  weekPlanState.notater = [];
  weekPlanState.overforteNotater = [];
  for (let i = 0; i < 7; i++) {
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
let wpTeamMembersLoadedAt = 0;
async function loadWpTeamMembers() {
  // Cache for 5 minutes, then refresh
  if (wpTeamMembers && (Date.now() - wpTeamMembersLoadedAt) < 5 * 60 * 1000) return wpTeamMembers;
  try {
    const resp = await apiFetch('/api/team-members');
    const json = await resp.json();
    const data = json.success && json.data;
    const members = Array.isArray(data?.members) ? data.members : Array.isArray(data) ? data : [];
    wpTeamMembers = members.filter(m => m.aktiv !== false);
    wpTeamMembersLoadedAt = Date.now();
  } catch (e) { console.warn('Failed to load team members:', e); }
  return wpTeamMembers || [];
}

// Build inline context (notes, overdue, huskeliste) for a planned customer
function wpGetCustomerContext(kundeId, fullCust) {
  const result = { html: '', icons: '' };
  const today = new Date();
  const todayStr = formatDateISO(today);
  const iconParts = [];

  // Overdue control check
  if (fullCust?.neste_kontroll && fullCust.neste_kontroll < todayStr) {
    iconParts.push(`<span class="wp-ctx-icon wp-overdue-badge" title="Forfalt kontroll: ${escapeHtml(fullCust.neste_kontroll)}"><i aria-hidden="true" class="fas fa-exclamation-triangle"></i></span>`);
  }

  // Huskeliste notes for this customer this week
  const custNotes = (weekPlanState.notater || []).filter(n => n.kunde_id === kundeId && !n.fullfort);
  for (const n of custNotes) {
    const nt = NOTE_TYPES.find(t => t.key === n.type) || NOTE_TYPES[4];
    iconParts.push(`<span class="wp-ctx-icon" style="color:${nt.color}" title="${escapeHtml(nt.label)}: ${escapeHtml(n.notat)}"><i aria-hidden="true" class="fas ${nt.icon}"></i></span>`);
  }

  if (iconParts.length > 0) {
    result.icons = ` <span class="wp-ctx-icons">${iconParts.join('')}</span>`;
  }

  // Customer note preview
  const contextParts = [];
  if (fullCust?.notater) {
    const truncated = fullCust.notater.length > 80 ? fullCust.notater.substring(0, 80) + '...' : fullCust.notater;
    contextParts.push(`<span class="wp-ctx-note" title="${escapeHtml(fullCust.notater)}"><i aria-hidden="true" class="fas fa-sticky-note" style="font-size:8px;margin-right:3px;opacity:0.6"></i>${escapeHtml(truncated)}</span>`);
  }

  // Last visit date
  if (fullCust?.last_visit_date || fullCust?.siste_kontroll) {
    const lastDate = fullCust.last_visit_date || fullCust.siste_kontroll;
    contextParts.push(`<span class="wp-ctx-lastvisit"><i aria-hidden="true" class="fas fa-history" style="font-size:8px;margin-right:3px;opacity:0.6"></i>Sist: ${escapeHtml(lastDate)}</span>`);
  }

  if (contextParts.length > 0) {
    result.html = `<div class="wp-item-context">${contextParts.join('')}</div>`;
  }

  return result;
}

// Drag-and-drop: reorder within day or move between days
function wpInitDragAndDrop(container) {
  let draggedItem = null;
  let draggedCustomerId = null;
  let draggedFromDay = null;

  container.addEventListener('dragstart', (e) => {
    draggedItem = e.target.closest('.wp-item.new[draggable]');
    if (!draggedItem) return;
    draggedCustomerId = Number(draggedItem.dataset.customerId);
    draggedFromDay = draggedItem.dataset.day;
    draggedItem.classList.add('wp-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedCustomerId);
  });

  container.addEventListener('dragend', (e) => {
    if (draggedItem) draggedItem.classList.remove('wp-dragging');
    container.querySelectorAll('.wp-drag-over').forEach(el => el.classList.remove('wp-drag-over'));
    container.querySelectorAll('.wp-drop-indicator').forEach(el => el.remove());
    draggedItem = null;
    draggedCustomerId = null;
    draggedFromDay = null;
  });

  container.addEventListener('dragover', (e) => {
    if (!draggedItem) return;
    const dayContent = e.target.closest('.wp-day-content');
    const dayEl = e.target.closest('.wp-day[data-day]');
    if (!dayEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Highlight target day
    container.querySelectorAll('.wp-drag-over').forEach(el => el.classList.remove('wp-drag-over'));
    if (dayContent) dayContent.classList.add('wp-drag-over');
    else dayEl.classList.add('wp-drag-over');
  });

  container.addEventListener('dragleave', (e) => {
    const dayContent = e.target.closest('.wp-day-content');
    if (dayContent && !dayContent.contains(e.relatedTarget)) {
      dayContent.classList.remove('wp-drag-over');
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedItem || !draggedFromDay || !draggedCustomerId) return;

    const targetDayEl = e.target.closest('.wp-day[data-day]');
    if (!targetDayEl) return;
    const targetDay = targetDayEl.dataset.day;

    const sourcePlanned = weekPlanState.days[draggedFromDay]?.planned;
    const targetPlanned = weekPlanState.days[targetDay]?.planned;
    if (!sourcePlanned || !targetPlanned) return;

    const sourceIndex = sourcePlanned.findIndex(c => c.id === draggedCustomerId);
    if (sourceIndex === -1) return;

    // Find drop position within target day
    const targetItems = targetDayEl.querySelectorAll('.wp-item.new[data-customer-id]');
    let dropIndex = targetPlanned.length;
    for (let i = 0; i < targetItems.length; i++) {
      const rect = targetItems[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        dropIndex = i;
        break;
      }
    }

    const [moved] = sourcePlanned.splice(sourceIndex, 1);

    if (draggedFromDay === targetDay) {
      // Reorder within same day — adjust index after removal
      const adjustedIndex = dropIndex > sourceIndex ? dropIndex - 1 : dropIndex;
      targetPlanned.splice(Math.max(0, adjustedIndex), 0, moved);
    } else {
      // Check duplicate in target day
      if (targetPlanned.some(c => c.id === draggedCustomerId)) {
        sourcePlanned.splice(sourceIndex, 0, moved); // put it back
        showToast('Kunden er allerede i planen for denne dagen', 'info');
        return;
      }
      targetPlanned.splice(dropIndex, 0, moved);
      const fromLabel = weekDayLabels[weekDayKeys.indexOf(draggedFromDay)];
      const toLabel = weekDayLabels[weekDayKeys.indexOf(targetDay)];
      showToast(`${escapeHtml(moved.navn)} flyttet fra ${fromLabel} til ${toLabel}`, 'success');
    }

    refreshTeamFocus();
    renderWeeklyPlan();
  });
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
  const currentEmail = (localStorage.getItem('userEmail') || '').toLowerCase();

  const weekNum = getISOWeekNumber(weekPlanState.weekStart);
  const totalPlanned = getWeekPlanTotalPlanned();
  const todayStr = formatDateISO(new Date());

  let html = `<div class="wp-container">`;

  // Header: week nav
  html += `
    <div class="wp-header">
      <button class="btn btn-small btn-secondary" data-action="weekPlanPrev" aria-label="Forrige uke"><i aria-hidden="true" class="fas fa-chevron-left"></i></button>
      <span class="wp-week-title" data-action="weekPlanPickDate" style="cursor:pointer" title="Klikk for \u00e5 velge uke">Uke ${weekNum} <i aria-hidden="true" class="fas fa-calendar-alt" style="font-size:10px;opacity:0.6;margin-left:2px"></i></span>
      <input type="date" id="wpDatePicker" value="${formatDateISO(weekPlanState.weekStart)}" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
      <button class="btn btn-small btn-secondary" data-action="weekPlanNext" aria-label="Neste uke"><i aria-hidden="true" class="fas fa-chevron-right"></i></button>
    </div>
  `;

  // Admin: technician assignment panel (show all team members including self)
  const wpIsAdmin = localStorage.getItem('userRole') === 'admin' || localStorage.getItem('userType') === 'bruker';
  if (wpIsAdmin && allTeamMembers.length > 1) {
    const globalAssigned = weekPlanState.globalAssignedTo || '';
    const tmOpts = allTeamMembers.map(m => {
      const isMe = (m.epost || '').toLowerCase() === currentEmail;
      const label = isMe ? `${m.navn} (meg)` : m.navn;
      return `<option value="${escapeHtml(m.navn)}" ${globalAssigned === m.navn ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    html += `<div class="wp-dispatch-bar">
      <i aria-hidden="true" class="fas fa-user-hard-hat"></i>
      <span>Planlegg for:</span>
      <select class="wp-dispatch-select" id="wpDispatchSelect">
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

  // Action buttons row
  html += `<div class="wp-action-row">`;
  if (weekPlanState.activeDay) {
    html += `<button class="btn btn-small btn-secondary wp-suggest-btn" data-action="wpSuggestStops" title="Foreslå kunder som trenger besøk i nærheten">
      <i aria-hidden="true" class="fas fa-lightbulb"></i> Foreslå stopp
    </button>`;
  }
  html += `<button class="btn btn-small btn-secondary" data-action="wpAutoFillWeek" title="Fordel kunder som trenger kontroll utover uken automatisk">
    <i aria-hidden="true" class="fas fa-magic"></i> ${totalPlanned > 0 ? 'Fyll gjenværende' : 'Fyll uke automatisk'}
  </button>`;
  html += `</div>`;

  // Suggestions container (filled by wpSuggestStops)
  html += `<div id="wpSuggestions" class="wp-suggestions"></div>`;

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
      html += `<span class="wp-team-chip" style="background:var(--color-bg-tertiary);font-size:11px;" data-action="focusTeamMember" data-member-name="${escapeHtml(wpFocusedTeamMember)}" title="Vis alle" role="button" tabindex="0"><i aria-hidden="true" class="fas fa-times"></i></span>`;
    }
    if (teamMembers.length >= 1) {
      const zonesActive = typeof TeamZones !== 'undefined' && TeamZones.visible;
      html += `<span class="wp-team-zone-toggle ${zonesActive ? 'active' : ''}" data-action="toggleTeamZones" title="Vis/skjul teamområder" role="button" tabindex="0"><i aria-hidden="true" class="fas fa-draw-polygon"></i></span>`;
    }
    html += `</div>`;
  }

  // Build team color map for consistent coloring
  const teamColorMap = new Map(teamMembers.map(m => [m.name, m.color]));
  const currentUser = localStorage.getItem('userName') || '';
  const currentUserColor = teamColorMap.get(currentUser) || TEAM_COLORS[0];

  // Day list
  html += `<div class="wp-days">`;

  for (let i = 0; i < 7; i++) {
    const dayKey = weekDayKeys[i];
    const dayData = weekPlanState.days[dayKey];
    if (!dayData) continue;
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
        html += `<div class="wp-progress-container" ${overloaded ? `title="Overstiger 8 timer — vurder å flytte stopp til en annen dag"` : ''}>
          <div class="wp-progress-bar ${overloaded ? 'overloaded' : ''}" style="width:${fillPct}%"></div>
          <span class="wp-progress-label">${formatMinutes(estProgress)} / 8t${overloaded ? ' ⚠' : ''}</span>
        </div>`;
        html += wpRenderCapacityBars(dayKey, teamColorMap, currentUserColor);
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

        // Inline context: notes, overdue status, huskeliste
        const fullCust = customers.find(fc => fc.id === c.id);
        const custContext = wpGetCustomerContext(c.id, fullCust);

        html += `
          <div class="wp-item new wp-timeline-item stagger-item" draggable="true" style="--stagger-index:${Math.min(stopIndex - 1, 15)};border-left:3px solid ${custColor}" data-customer-id="${c.id}" data-day="${dayKey}">
            <span class="wp-stop-badge"><span class="wp-stop-num" style="background:${custColor}">${stopIndex}</span>${custInitials ? `<span class="wp-stop-initials" style="background:${custColor}">${escapeHtml(custInitials)}</span>` : ''}</span>
            <div class="wp-item-main">
              <span class="wp-item-name"><span class="cnp-clickable" data-action="cnpShowPopover" data-args='[${c.id}]' data-kunde-id="${c.id}" title="Vis notater">${escapeHtml(c.navn)}</span>${custContext.icons}</span>
              ${addrStr ? `<span class="wp-item-addr" title="${escapeHtml(addrStr)}">${escapeHtml(addrStr)}</span>` : ''}
              ${c.telefon ? `<span class="wp-item-phone"><i aria-hidden="true" class="fas fa-phone" style="font-size:8px;margin-right:3px;"></i>${escapeHtml(c.telefon)}</span>` : ''}
              <span class="wp-item-timerange"><i aria-hidden="true" class="fas fa-clock" style="font-size:8px;margin-right:2px;"></i>${startTime} - ${endTime}</span>
              ${custContext.html}
            </div>
            <div class="wp-item-meta">
              ${fullCust && fullCust.epost ? `<button class="wp-notify-btn" data-action="wpNotifyCustomer" data-args='[${c.id}]' title="Send «på vei»-varsel"><i class="fas fa-envelope" aria-hidden="true"></i></button>` : ''}
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
        const creatorName = a.tildelt_tekniker || (a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '');
        const creatorColor = creatorName ? (teamColorMap.get(creatorName) || 'var(--color-text-muted)') : '';
        const exStartTime = formatTimeOfDay(cumulativeMin);
        cumulativeMin += (a.varighet || 30);
        const exEndTime = formatTimeOfDay(cumulativeMin);
        html += `
          <div class="wp-item existing wp-timeline-item" data-avtale-id="${a.id}" data-avtale-name="${escapeHtml(name)}" style="${creatorColor ? 'border-left:3px solid ' + creatorColor : ''}" title="${creatorName ? 'Opprettet av ' + escapeHtml(creatorName) : ''}">
            <span class="wp-stop-badge"><span class="wp-stop-num" style="background:${creatorColor || 'var(--color-bg-tertiary)'}">${stopIndex}</span>${creatorName ? `<span class="wp-stop-initials" style="background:${creatorColor || 'var(--color-bg-tertiary)'}">${escapeHtml(getCreatorDisplay(creatorName, true))}</span>` : ''}</span>
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
        if (hasCoords && totalCount >= 1) {
          html += `<button class="btn btn-small btn-primary wp-nav-btn" data-action="wpNavigateDay" data-day="${dayKey}"><i aria-hidden="true" class="fas fa-route"></i> Optimaliser rute</button>`;
        }
        html += `<button class="btn btn-small btn-danger" data-action="clearDayAvtaler" data-args='["${dayKey}","${dateStr}"]'><i aria-hidden="true" class="fas fa-trash-alt"></i> Slett alle</button>`;
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

  // ─── Huskeliste (weekly notes) ───
  html += `<div class="wp-notes-section">
    <div class="wp-notes-header">
      <i aria-hidden="true" class="fas fa-clipboard-list"></i> Huskeliste
      <span class="wp-notes-count" id="wpNotesCount"></span>
    </div>
    <div class="wp-notes-add">
      <div class="wp-search-wrapper">
        <i aria-hidden="true" class="fas fa-search wp-search-icon"></i>
        <input type="text" class="wp-search-input" id="wpNoteCustomerSearch"
          placeholder="S\u00f8k kunde for notat..." autocomplete="off">
      </div>
      <div class="wp-search-results" id="wpNoteSearchResults"></div>
      <div class="wp-note-compose" id="wpNoteCompose" style="display:none;">
        <div class="wp-note-compose-customer" id="wpNoteComposeCustomer"></div>
        <div class="wp-note-type-pills" id="wpNoteTypePills">
          ${NOTE_TYPES.map(t => `<button class="wp-note-type-pill${t.key === 'notat' ? ' active' : ''}" data-action="wpSelectNoteType" data-type="${t.key}" style="--pill-color:${t.color}"><i aria-hidden="true" class="fas ${t.icon}"></i> ${t.label}</button>`).join('')}
        </div>
        <textarea class="wp-note-input" id="wpNoteInput" placeholder="Skriv notat..." rows="2"></textarea>
        <div class="wp-note-compose-extras">
          <select class="wp-note-assign-select" id="wpNoteAssign">
            <option value="">Ingen tilordning</option>
          </select>
          <div class="wp-note-maldag-pills" id="wpNoteMaldagPills">
            ${weekDayKeys.map((dk, i) => `<button class="wp-note-maldag-pill" data-action="wpSetMaldag" data-maldag="${dk}">${weekDayLabelsShort[i]}</button>`).join('')}
          </div>
        </div>
        <div class="wp-note-compose-actions">
          <button class="btn btn-small btn-primary" data-action="wpSaveNote"><i aria-hidden="true" class="fas fa-plus"></i> Legg til</button>
          <button class="btn btn-small btn-secondary" data-action="wpCancelNote"><i aria-hidden="true" class="fas fa-times"></i></button>
        </div>
      </div>
    </div>
    <div class="wp-notes-filter">
      <button class="wp-notes-filter-btn${weekPlanState.noteFilter === 'alle' ? ' active' : ''}" data-action="wpFilterNotes" data-filter="alle">Alle</button>
      <button class="wp-notes-filter-btn${weekPlanState.noteFilter === 'mine' ? ' active' : ''}" data-action="wpFilterNotes" data-filter="mine">Mine</button>
    </div>
    <div id="wpNotesListContainer"></div>
  </div>`;
  // close wp-notes-section

  html += `</div>`; // close wp-container
  container.innerHTML = html;

  // Drag-and-drop for reordering and cross-day moves
  wpInitDragAndDrop(container);

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

  // Note customer search handler
  const wpNoteSearch = document.getElementById('wpNoteCustomerSearch');
  if (wpNoteSearch) {
    wpNoteSearch.addEventListener('input', debounce(function() {
      const query = this.value.toLowerCase().trim();
      const resultsDiv = document.getElementById('wpNoteSearchResults');
      if (!resultsDiv) return;

      if (query.length < 1) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
        return;
      }

      const filtered = customers.filter(c =>
        (c.navn && c.navn.toLowerCase().includes(query)) ||
        (c.poststed && c.poststed.toLowerCase().includes(query)) ||
        (c.adresse && c.adresse.toLowerCase().includes(query))
      );
      const matches = sortByNavn(filtered).slice(0, 6);

      if (matches.length === 0) {
        resultsDiv.innerHTML = '<div class="wp-search-item wp-search-no-results">Ingen kunder funnet</div>';
        resultsDiv.style.display = 'block';
        return;
      }

      resultsDiv.innerHTML = matches.map(c => {
        const addrText = [c.adresse, c.poststed].filter(Boolean).join(', ');
        return `<div class="wp-search-item" data-action="wpSelectNoteCustomer" data-customer-id="${c.id}" role="button" tabindex="0">
          <span class="wp-search-name">${escapeHtml(c.navn)}</span>
          <span class="wp-search-addr">${escapeHtml(addrText)}</span>
          <i aria-hidden="true" class="fas fa-sticky-note" style="opacity:0.5;font-size:11px;"></i>
        </div>`;
      }).join('');
      resultsDiv.style.display = 'block';
    }, 200));
  }

  // Note event delegation on container
  container.addEventListener('click', function(e) {
    const actionEl = e.target.closest('[data-action]');
    const action = actionEl?.dataset?.action;
    if (!action) return;

    if (action === 'wpSelectNoteCustomer') {
      const el = e.target.closest('[data-customer-id]');
      const customerId = Number(el.dataset.customerId);
      const customer = customers.find(c => c.id === customerId);
      if (!customer) return;

      const compose = document.getElementById('wpNoteCompose');
      const customerLabel = document.getElementById('wpNoteComposeCustomer');
      const noteInput = document.getElementById('wpNoteInput');
      const searchResults = document.getElementById('wpNoteSearchResults');
      const searchInput = document.getElementById('wpNoteCustomerSearch');

      if (compose) {
        compose.style.display = 'block';
        compose.dataset.customerId = customerId;
        compose.dataset.noteType = 'notat';
        compose.dataset.maldag = '';
      }
      if (customerLabel) customerLabel.innerHTML = `<i aria-hidden="true" class="fas fa-user"></i> ${escapeHtml(customer.navn)}`;
      if (noteInput) { noteInput.value = ''; noteInput.focus(); }
      if (searchResults) { searchResults.innerHTML = ''; searchResults.style.display = 'none'; }
      if (searchInput) searchInput.value = '';
      // Reset type pills
      document.querySelectorAll('.wp-note-type-pill').forEach(p => p.classList.toggle('active', p.dataset.type === 'notat'));
      // Reset maldag pills
      document.querySelectorAll('.wp-note-maldag-pill').forEach(p => p.classList.remove('active'));
      // Populate team assignment dropdown
      wpPopulateAssignSelect();
    }

    if (action === 'wpSelectNoteType') {
      const type = actionEl.dataset.type;
      const compose = document.getElementById('wpNoteCompose');
      if (compose) compose.dataset.noteType = type;
      document.querySelectorAll('.wp-note-type-pill').forEach(p => p.classList.toggle('active', p.dataset.type === type));
    }

    if (action === 'wpSetMaldag') {
      const maldag = actionEl.dataset.maldag;
      const compose = document.getElementById('wpNoteCompose');
      const isActive = actionEl.classList.contains('active');
      document.querySelectorAll('.wp-note-maldag-pill').forEach(p => p.classList.remove('active'));
      if (!isActive) {
        actionEl.classList.add('active');
        if (compose) compose.dataset.maldag = maldag;
      } else {
        if (compose) compose.dataset.maldag = '';
      }
    }

    if (action === 'wpSaveNote') {
      const compose = document.getElementById('wpNoteCompose');
      const noteInput = document.getElementById('wpNoteInput');
      const assignSelect = document.getElementById('wpNoteAssign');
      if (!compose || !noteInput) return;
      const customerId = Number(compose.dataset.customerId);
      const notat = noteInput.value.trim();
      if (!customerId || !notat) return;
      const type = compose.dataset.noteType || 'notat';
      const tilordnet = assignSelect?.value || '';
      const maldag = compose.dataset.maldag || '';
      wpAddNotat(customerId, notat, type, tilordnet, maldag);
    }

    if (action === 'wpCancelNote') {
      const compose = document.getElementById('wpNoteCompose');
      if (compose) compose.style.display = 'none';
    }

    if (action === 'wpToggleNote') {
      const noteId = Number(e.target.closest('[data-note-id]').dataset.noteId);
      wpToggleNotat(noteId);
    }

    if (action === 'wpDeleteNote') {
      const noteId = Number(e.target.closest('[data-note-id]').dataset.noteId);
      wpDeleteNotat(noteId);
    }

    if (action === 'wpToggleCompleted') {
      const list = document.getElementById('wpCompletedNotes');
      if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
    }

    if (action === 'wpToggleOverforte') {
      const list = document.getElementById('wpOverforteNotes');
      if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
    }

    if (action === 'wpTransferNote') {
      const noteId = Number(e.target.closest('[data-note-id]').dataset.noteId);
      wpTransferNote(noteId);
    }

    if (action === 'wpFilterNotes') {
      const filter = actionEl.dataset.filter;
      weekPlanState.noteFilter = filter;
      document.querySelectorAll('.wp-notes-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
      wpRenderNotater();
    }

    if (action === 'wpAddNoteToDay') {
      e.stopPropagation();
      const noteEl = e.target.closest('[data-note-id]');
      const kundeId = Number(noteEl?.dataset?.kundeId);
      const btn = e.target.closest('.wp-note-add-day');
      if (!kundeId || !btn) return;
      // Show day picker popup
      const existing = document.getElementById('wpNoteDayPicker');
      if (existing) existing.remove();
      const rect = btn.getBoundingClientRect();
      const picker = document.createElement('div');
      picker.id = 'wpNoteDayPicker';
      picker.className = 'wp-note-day-picker';
      picker.style.top = (rect.bottom + 4) + 'px';
      picker.style.left = rect.left + 'px';
      picker.innerHTML = weekDayKeys.map((dk, i) => `<button class="wp-note-day-option" data-action="wpSelectNoteDay" data-day="${dk}" data-kunde-id="${kundeId}">${weekDayLabelsShort[i]}</button>`).join('');
      document.body.appendChild(picker);
      setTimeout(() => document.addEventListener('click', function closePicker(ev) {
        if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', closePicker); }
      }), 0);
    }

    if (action === 'wpSelectNoteDay') {
      const dayKey = actionEl.dataset.day;
      const kundeId = Number(actionEl.dataset.kundeId);
      document.getElementById('wpNoteDayPicker')?.remove();
      wpAddNoteCustomerToDay(kundeId, dayKey);
    }
  });

  // Handle checkbox change events for note toggling
  container.addEventListener('change', function(e) {
    if (e.target.closest('[data-action="wpToggleNote"]')) {
      const noteId = Number(e.target.closest('[data-note-id]').dataset.noteId);
      wpToggleNotat(noteId);
    }
  });

  // Handle double-click for inline edit
  container.addEventListener('dblclick', function(e) {
    const textEl = e.target.closest('.wp-note-text');
    if (!textEl || textEl.contentEditable === 'true') return;
    const noteItem = textEl.closest('.wp-note-item');
    if (!noteItem || noteItem.classList.contains('completed')) return;
    const noteId = Number(noteItem.dataset.noteId);
    textEl.contentEditable = 'true';
    textEl.classList.add('editing');
    textEl.focus();
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function saveEdit() {
      textEl.contentEditable = 'false';
      textEl.classList.remove('editing');
      const newText = textEl.textContent.trim();
      if (newText && newText !== textEl.dataset.originalText) {
        wpUpdateNotatField(noteId, 'notat', newText);
      } else if (!newText) {
        textEl.textContent = textEl.dataset.originalText;
      }
      textEl.removeEventListener('blur', saveEdit);
      textEl.removeEventListener('keydown', handleKey);
    }
    function handleKey(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); saveEdit(); }
      if (ev.key === 'Escape') { textEl.textContent = textEl.dataset.originalText; saveEdit(); }
    }
    textEl.dataset.originalText = textEl.textContent;
    textEl.addEventListener('blur', saveEdit);
    textEl.addEventListener('keydown', handleKey);
  });

  // Load notes for current week
  wpLoadNotater();

  // Update map markers with plan badges
  updateWeekPlanBadges();

  // Restore team zone visibility from localStorage
  if (typeof TeamZones !== 'undefined') TeamZones.restore();

  // Load travel times asynchronously for each day with content
  if (typeof MatrixService !== 'undefined') {
    for (let i = 0; i < weekDayKeys.length; i++) {
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
  coords.push([routeStart.lng, routeStart.lat]);

  if (coords.length < 3) return; // Need at least office + 1 stop + office
  if (typeof MatrixService === 'undefined') return;

  let times;
  try {
    times = await MatrixService.getSequentialTimes(coords);
  } catch (e) {
    console.warn('Travel time calculation failed:', e);
    return;
  }
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
  if (wpDayPickerEscHandler) document.removeEventListener('keydown', wpDayPickerEscHandler);
  wpDayPickerEscHandler = (e) => {
    if (e.key === 'Escape') closeWeekPlanDayPicker();
  };
  document.addEventListener('keydown', wpDayPickerEscHandler);
}

let wpDayPickerEscHandler = null;

function closeWeekPlanDayPicker() {
  document.getElementById('wpDayPickerPopup')?.remove();
  if (wpDayPickerEscHandler) {
    document.removeEventListener('keydown', wpDayPickerEscHandler);
    wpDayPickerEscHandler = null;
  }
}

// ─── Huskeliste API functions ───

async function wpLoadNotater() {
  if (!weekPlanState.weekStart) return;
  const ukeStart = formatDateISO(weekPlanState.weekStart);
  try {
    const [notaterResp, overforteResp] = await Promise.all([
      apiFetch(`/api/ukeplan-notater?uke_start=${ukeStart}`),
      apiFetch(`/api/ukeplan-notater/overforte?uke_start=${ukeStart}`)
    ]);
    const notaterJson = await notaterResp.json();
    const overforteJson = await overforteResp.json();
    if (notaterJson.success && notaterJson.data) weekPlanState.notater = notaterJson.data;
    if (overforteJson.success && overforteJson.data) weekPlanState.overforteNotater = overforteJson.data;
    wpRenderNotater();
  } catch (e) { console.warn('Notatlasting feilet:', e); }
}

function wpGetNoteType(typeKey) {
  return NOTE_TYPES.find(t => t.key === typeKey) || NOTE_TYPES[4]; // default to 'notat'
}

function wpGetWeekNumber(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d - yearStart) / 86400000 + ((yearStart.getDay() + 6) % 7)) / 7);
}

function wpRenderNoteItem(n, options = {}) {
  const type = wpGetNoteType(n.type || 'notat');
  const isCompleted = n.fullfort;
  const isOverfort = options.overfort || false;
  const currentUser = localStorage.getItem('userEmail') || '';

  let assigneeBadge = '';
  if (n.tilordnet) {
    const initials = getCreatorDisplay(n.tilordnet, true);
    if (initials) {
      assigneeBadge = `<span class="wp-note-assignee" title="${escapeHtml(n.tilordnet)}">${escapeHtml(initials)}</span>`;
    }
  }

  let maldagBadge = '';
  if (n.maldag) {
    const dayIdx = weekDayKeys.indexOf(n.maldag);
    if (dayIdx >= 0) {
      maldagBadge = `<span class="wp-note-maldag">${weekDayLabelsShort[dayIdx]}</span>`;
    }
  }

  let weekBadge = '';
  if (isOverfort && n.uke_start) {
    weekBadge = `<span class="wp-note-week">Uke ${wpGetWeekNumber(n.uke_start)}</span>`;
  }

  let actions = '';
  if (isOverfort) {
    actions = `<button class="wp-note-transfer-btn" data-action="wpTransferNote" data-note-id="${n.id}" title="Overf\u00f8r til denne uken">Overf\u00f8r</button>
      <button class="wp-note-complete-btn" data-action="wpToggleNote" data-note-id="${n.id}" title="Marker fullf\u00f8rt"><i aria-hidden="true" class="fas fa-check"></i></button>
      <button class="wp-note-delete" data-action="wpDeleteNote" data-note-id="${n.id}" title="Slett" aria-label="Slett">&times;</button>`;
  } else {
    actions = `<button class="wp-note-add-day" data-action="wpAddNoteToDay" title="Legg i dagsplan"><i aria-hidden="true" class="fas fa-calendar-plus"></i></button>
      <button class="wp-note-delete" data-action="wpDeleteNote" data-note-id="${n.id}" title="Slett" aria-label="Slett">&times;</button>`;
  }

  return `<div class="wp-note-item${isCompleted ? ' completed' : ''}${isOverfort ? ' overfort' : ''}" data-note-id="${n.id}" data-kunde-id="${n.kunde_id}">
    ${!isOverfort ? `<label class="wp-note-check">
      <input type="checkbox" ${isCompleted ? 'checked' : ''} data-action="wpToggleNote" data-note-id="${n.id}">
      <span class="wp-note-checkmark"></span>
    </label>` : ''}
    <i aria-hidden="true" class="fas ${type.icon} wp-note-type-icon" style="color:${type.color}" title="${type.label}"></i>
    <div class="wp-note-content">
      <div class="wp-note-content-top">
        <span class="wp-note-customer">${escapeHtml(n.kunde_navn || 'Ukjent')}</span>
        ${maldagBadge}${weekBadge}${assigneeBadge}
      </div>
      <span class="wp-note-text">${escapeHtml(n.notat)}</span>
    </div>
    ${actions}
  </div>`;
}

function wpRenderNotater() {
  const container = document.getElementById('wpNotesListContainer');
  const countEl = document.getElementById('wpNotesCount');
  if (!container) return;

  const notater = weekPlanState.notater || [];
  const overforte = weekPlanState.overforteNotater || [];
  const currentUser = localStorage.getItem('userEmail') || '';

  // Apply filter
  const filterFn = weekPlanState.noteFilter === 'mine'
    ? n => (n.tilordnet || n.opprettet_av || '') === currentUser || n.opprettet_av === currentUser
    : () => true;

  const filteredNotater = notater.filter(filterFn);
  const activeNotater = filteredNotater.filter(n => !n.fullfort);
  const completedNotater = filteredNotater.filter(n => n.fullfort);
  const filteredOverforte = overforte.filter(filterFn);

  // Update count
  const totalActive = activeNotater.length + filteredOverforte.length;
  if (countEl) countEl.textContent = totalActive > 0 ? totalActive : '';

  let html = '';

  // Active notes — grouped by maldag
  if (activeNotater.length > 0) {
    const withMaldag = activeNotater.filter(n => n.maldag);
    const withoutMaldag = activeNotater.filter(n => !n.maldag);

    html += `<div class="wp-notes-list">`;

    // Group by maldag
    if (withMaldag.length > 0) {
      const grouped = {};
      for (const n of withMaldag) {
        if (!grouped[n.maldag]) grouped[n.maldag] = [];
        grouped[n.maldag].push(n);
      }
      for (let i = 0; i < weekDayKeys.length; i++) {
        const dk = weekDayKeys[i];
        if (!grouped[dk]) continue;
        html += `<div class="wp-notes-day-group"><span class="wp-notes-day-label">${weekDayLabels[i]}</span></div>`;
        for (const n of grouped[dk]) html += wpRenderNoteItem(n);
      }
    }
    // Ungrouped
    if (withoutMaldag.length > 0) {
      if (withMaldag.length > 0) {
        html += `<div class="wp-notes-day-group"><span class="wp-notes-day-label">Ikke planlagt</span></div>`;
      }
      for (const n of withoutMaldag) html += wpRenderNoteItem(n);
    }

    html += `</div>`;
  }

  // Overforte section
  if (filteredOverforte.length > 0) {
    html += `<div class="wp-notes-overforte">
      <div class="wp-notes-overforte-header" data-action="wpToggleOverforte" role="button" tabindex="0">
        <i aria-hidden="true" class="fas fa-history"></i> Ubehandlede fra tidligere uker (${filteredOverforte.length})
      </div>
      <div class="wp-notes-overforte-list" id="wpOverforteNotes" style="display:none;">`;
    for (const n of filteredOverforte) html += wpRenderNoteItem(n, { overfort: true });
    html += `</div></div>`;
  }

  // Completed
  if (completedNotater.length > 0) {
    html += `<div class="wp-notes-completed">
      <div class="wp-notes-completed-header" data-action="wpToggleCompleted" role="button" tabindex="0">
        <i aria-hidden="true" class="fas fa-check-circle"></i> Fullf\u00f8rt (${completedNotater.length})
      </div>
      <div class="wp-notes-completed-list" id="wpCompletedNotes" style="display:none;">`;
    for (const n of completedNotater) html += wpRenderNoteItem(n);
    html += `</div></div>`;
  }

  // Empty state
  if (activeNotater.length === 0 && filteredOverforte.length === 0 && completedNotater.length === 0) {
    html += `<div class="wp-notes-empty"><i aria-hidden="true" class="fas fa-sticky-note"></i> Ingen notater for denne uken</div>`;
  }

  container.innerHTML = html;
}

function wpPopulateAssignSelect() {
  const select = document.getElementById('wpNoteAssign');
  if (!select) return;
  const currentUser = localStorage.getItem('userName') || '';
  const globalAssigned = weekPlanState.globalAssignedTo || '';

  // Collect unique team names from week plan
  const teamNames = new Set();
  if (currentUser) teamNames.add(currentUser);
  if (globalAssigned && globalAssigned !== currentUser) teamNames.add(globalAssigned);
  for (const dk of weekDayKeys) {
    const dayData = weekPlanState.days[dk];
    if (!dayData) continue;
    for (const c of dayData.planned) {
      if (c.addedBy && c.addedBy !== 'admin') teamNames.add(c.addedBy);
    }
  }

  select.innerHTML = '<option value="">Ingen tilordning</option>' +
    Array.from(teamNames).map(name => `<option value="${escapeHtml(name)}" ${name === globalAssigned ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
}

async function wpAddNotat(kundeId, notat, type, tilordnet, maldag) {
  if (!weekPlanState.weekStart) return;
  const ukeStart = formatDateISO(weekPlanState.weekStart);
  const body = { kunde_id: kundeId, uke_start: ukeStart, notat, type: type || 'notat' };
  if (tilordnet) body.tilordnet = tilordnet;
  if (maldag) body.maldag = maldag;
  try {
    const resp = await apiFetch('/api/ukeplan-notater', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await resp.json();
    if (json.success && json.data) {
      weekPlanState.notater.push(json.data);
      wpRenderNotater();
      const compose = document.getElementById('wpNoteCompose');
      if (compose) compose.style.display = 'none';
      showToast('Notat lagt til', 'success');
    }
  } catch (e) {
    showToast('Kunne ikke lagre notat', 'error');
  }
}

async function wpToggleNotat(noteId) {
  // Check both current and overforte arrays
  let note = weekPlanState.notater.find(n => n.id === noteId);
  let isOverfort = false;
  if (!note) {
    note = weekPlanState.overforteNotater.find(n => n.id === noteId);
    isOverfort = true;
  }
  if (!note) return;
  const newStatus = !note.fullfort;
  try {
    const resp = await apiFetch(`/api/ukeplan-notater/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullfort: newStatus })
    });
    const json = await resp.json();
    if (json.success) {
      if (isOverfort && newStatus) {
        weekPlanState.overforteNotater = weekPlanState.overforteNotater.filter(n => n.id !== noteId);
      } else {
        note.fullfort = newStatus;
      }
      wpRenderNotater();
    }
  } catch (e) {
    showToast('Kunne ikke oppdatere notat', 'error');
  }
}

async function wpDeleteNotat(noteId) {
  try {
    const resp = await apiFetch(`/api/ukeplan-notater/${noteId}`, {
      method: 'DELETE'
    });
    const json = await resp.json();
    if (json.success) {
      weekPlanState.notater = weekPlanState.notater.filter(n => n.id !== noteId);
      weekPlanState.overforteNotater = weekPlanState.overforteNotater.filter(n => n.id !== noteId);
      wpRenderNotater();
      showToast('Notat slettet', 'success');
    }
  } catch (e) {
    showToast('Kunne ikke slette notat', 'error');
  }
}

async function wpTransferNote(noteId) {
  const note = weekPlanState.overforteNotater.find(n => n.id === noteId);
  if (!note || !weekPlanState.weekStart) return;
  const ukeStart = formatDateISO(weekPlanState.weekStart);
  try {
    // Create copy in current week
    const resp = await apiFetch('/api/ukeplan-notater', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kunde_id: note.kunde_id,
        uke_start: ukeStart,
        notat: note.notat,
        type: note.type || 'notat',
        tilordnet: note.tilordnet || '',
        maldag: note.maldag || '',
        overfort_fra: note.id
      })
    });
    const json = await resp.json();
    if (json.success && json.data) {
      // Mark original as completed
      await apiFetch(`/api/ukeplan-notater/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullfort: true })
      });
      weekPlanState.overforteNotater = weekPlanState.overforteNotater.filter(n => n.id !== noteId);
      weekPlanState.notater.push(json.data);
      wpRenderNotater();
      showToast('Notat overf\u00f8rt til denne uken', 'success');
    }
  } catch (e) {
    showToast('Kunne ikke overf\u00f8re notat', 'error');
  }
}

async function wpUpdateNotatField(noteId, field, value) {
  try {
    const resp = await apiFetch(`/api/ukeplan-notater/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
    const json = await resp.json();
    if (json.success && json.data) {
      const idx = weekPlanState.notater.findIndex(n => n.id === noteId);
      if (idx >= 0) weekPlanState.notater[idx] = json.data;
      wpRenderNotater();
    }
  } catch (e) {
    showToast('Kunne ikke oppdatere notat', 'error');
  }
}

// Check if customer is already planned on another day this week (cross-day conflict)
function wpFindConflict(kundeId, excludeDayKey) {
  for (const dk of weekDayKeys) {
    if (dk === excludeDayKey) continue;
    if (weekPlanState.days[dk]?.planned.some(c => c.id === kundeId)) {
      return weekDayLabels[weekDayKeys.indexOf(dk)];
    }
  }
  // Check existing avtaler for the week
  for (const dk of weekDayKeys) {
    if (dk === excludeDayKey) continue;
    const dateStr = weekPlanState.days[dk]?.date;
    if (dateStr && avtaler.some(a => a.kunde_id === kundeId && a.dato === dateStr)) {
      return weekDayLabels[weekDayKeys.indexOf(dk)] + ' (avtale)';
    }
  }
  return null;
}

async function wpAddNoteCustomerToDay(kundeId, dayKey) {
  const customer = customers.find(c => c.id === kundeId);
  if (!customer) return;
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return;
  // Check if already in plan for this day
  if (dayData.planned.some(c => c.id === kundeId)) {
    showToast('Kunden er allerede i planen for denne dagen', 'info');
    return;
  }
  // Cross-day conflict check
  const conflict = wpFindConflict(kundeId, dayKey);
  if (conflict) {
    const ok = await showConfirm(`${customer.navn} er allerede planlagt for ${conflict}. Legg til likevel?`, 'Dobbeltbooking');
    if (!ok) return;
  }
  const currentUser = weekPlanState.globalAssignedTo || localStorage.getItem('userName') || 'admin';
  dayData.planned.push({
    id: customer.id,
    navn: customer.navn,
    adresse: customer.adresse,
    postnummer: customer.postnummer,
    poststed: customer.poststed,
    telefon: customer.telefon,
    kategori: customer.kategori,
    lat: customer.lat,
    lng: customer.lng,
    estimertTid: customer.estimert_tid || 30,
    addedBy: currentUser
  });
  renderWeeklyPlan();
  showToast(`${escapeHtml(customer.navn)} lagt til ${weekDayLabels[weekDayKeys.indexOf(dayKey)]}`, 'success');
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
  let crossDayConflicts = 0;

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

    // Track cross-day conflicts (still add, but warn)
    if (wpFindConflict(customer.id, dayKey)) {
      crossDayConflicts++;
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
  if (crossDayConflicts > 0) msg += ` — ${crossDayConflicts} finnes på en annen dag`;
  showToast(msg, crossDayConflicts > 0 ? 'warning' : (added > 0 ? 'success' : 'info'));

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

// Add customer to a specific weekplan day (from popup quick-actions)
function popupAddToWeekDay(customerId, dayKey) {
  if (!weekPlanState.weekStart) {
    // Initialize weekplan for current week if not yet open
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    initWeekPlanState(monday);
  }
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return;

  // Check duplicates
  if (dayData.planned.some(c => c.id === customer.id)) {
    showToast(`${customer.navn} er allerede på ${weekDayLabels[weekDayKeys.indexOf(dayKey)]}`, 'info');
    return;
  }

  // Check if a team member was selected in popup
  const prevActiveDay = weekPlanState.activeDay;
  const prevAssigned = weekPlanState.globalAssignedTo;
  weekPlanState.activeDay = dayKey;
  if (currentPopup) {
    const popupEl = currentPopup.getElement();
    if (popupEl && popupEl.dataset.assignedMember) {
      weekPlanState.globalAssignedTo = popupEl.dataset.assignedMember;
    }
  }
  addCustomersToWeekPlan([customer]);
  weekPlanState.globalAssignedTo = prevAssigned;
  weekPlanState.activeDay = prevActiveDay;

  // Update the button in popup to show as planned
  if (currentPopup) {
    const popupEl = currentPopup.getElement();
    if (popupEl) {
      const btn = popupEl.querySelector(`[data-action="popupAddToWeekDay"][data-day-key="${dayKey}"]`);
      if (btn) {
        btn.classList.add('is-planned');
        btn.disabled = true;
        if (!btn.querySelector('.pwd-check')) {
          btn.insertAdjacentHTML('beforeend', '<i aria-hidden="true" class="fas fa-check pwd-check"></i>');
        }
      }
    }
  }
}

// Get weekplan status for a customer (which days they're on this week)
function getCustomerWeekPlanStatus(customerId) {
  if (!weekPlanState.weekStart) return null;
  const days = [];
  for (let i = 0; i < 5; i++) {
    const dayKey = weekDayKeys[i];
    const dayData = weekPlanState.days[dayKey];
    if (dayData && dayData.planned.some(c => c.id === customerId)) {
      days.push({ dayKey, label: weekDayLabelsShort[i] });
    }
  }
  // Also check saved avtaler for this week
  if (weekPlanState.days.mandag?.date) {
    const weekDates = weekDayKeys.slice(0, 5).map(k => weekPlanState.days[k]?.date).filter(Boolean);
    for (const a of avtaler) {
      if (a.kunde_id === customerId && weekDates.includes(a.dato)) {
        const idx = weekDates.indexOf(a.dato);
        if (idx >= 0 && !days.some(d => d.dayKey === weekDayKeys[idx])) {
          days.push({ dayKey: weekDayKeys[idx], label: weekDayLabelsShort[idx], saved: true });
        }
      }
    }
  }
  return days.length > 0 ? days : null;
}

// Build popup weekday picker HTML
function buildPopupWeekDayPicker(customerId) {
  const today = new Date();
  const todayISO = formatDateISO(today);

  // Ensure weekPlanState has a valid week
  let weekStart = weekPlanState.weekStart;
  if (!weekStart) {
    const day = today.getDay();
    weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((day + 6) % 7));
  }

  const status = getCustomerWeekPlanStatus(customerId);
  const plannedDays = new Set(status ? status.map(d => d.dayKey) : []);

  let html = '<div class="popup-weekday-picker">';
  for (let i = 0; i < 5; i++) {
    const dayKey = weekDayKeys[i];
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dateStr = formatDateISO(d);
    const isToday = dateStr === todayISO;
    const isPlanned = plannedDays.has(dayKey);
    const classes = ['popup-weekday-btn', isToday ? 'is-today' : '', isPlanned ? 'is-planned' : ''].filter(Boolean).join(' ');

    html += `<button class="${classes}" data-action="popupAddToWeekDay" data-customer-id="${customerId}" data-day-key="${dayKey}" ${isPlanned ? 'disabled' : ''} title="${weekDayLabels[i]} ${d.getDate()}.${d.getMonth() + 1}">
      <span class="pwd-label">${weekDayLabelsShort[i]}</span>
      <span class="pwd-date">${d.getDate()}.</span>
      ${isPlanned ? '<i aria-hidden="true" class="fas fa-check pwd-check"></i>' : ''}
    </button>`;
  }
  html += '</div>';
  return html;
}

// Build popup team assign HTML
function buildPopupTeamAssign(customerId) {
  if (!teamMembersData || teamMembersData.length === 0) return '';
  const activeMembers = teamMembersData.filter(m => m.aktiv);
  if (activeMembers.length === 0) return '';

  let html = '<div class="popup-team-assign">';
  for (const m of activeMembers) {
    const initials = getCreatorDisplay(m.navn, true);
    const color = m.farge || 'var(--color-accent)';
    html += `<button class="popup-team-btn" data-action="popupAssignTeam" data-customer-id="${customerId}" data-member-name="${escapeHtml(m.navn)}" title="${escapeHtml(m.navn)}" style="--team-color: ${escapeHtml(color)}">
      ${escapeHtml(initials)}
    </button>`;
  }
  html += '</div>';
  return html;
}

// Set globalAssignedTo temporarily for popup team assign
function popupAssignTeam(customerId, memberName) {
  const prev = weekPlanState.globalAssignedTo;
  weekPlanState.globalAssignedTo = memberName;
  showToast(`${memberName} valgt — legg til dager under`, 'info');
  weekPlanState.globalAssignedTo = prev;
  // We don't actually add to a day here — just set the assignment context
  // Instead, update the popup to reflect the selection
  if (currentPopup) {
    const el = currentPopup.getElement();
    if (el) {
      // Highlight selected team member
      el.querySelectorAll('.popup-team-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.memberName === memberName);
      });
      // Store on popup element for weekday buttons to use
      el.dataset.assignedMember = memberName;
    }
  }
}

let wpSaving = false;

async function saveWeeklyPlan() {
  if (wpSaving) return;
  const totalPlanned = getWeekPlanTotalPlanned();
  if (totalPlanned === 0) return;

  const confirmed = await showConfirm(
    `Opprett ${totalPlanned} avtaler for uke ${getISOWeekNumber(weekPlanState.weekStart)}?`,
    'Bekreft oppretting'
  );
  if (!confirmed) return;

  wpSaving = true;

  let created = 0;
  let errors = 0;
  let lastError = '';

  // Group planned customers by day AND team member
  // Each (day + member) combination becomes a separate route
  const routeGroups = [];
  for (const dayKey of weekDayKeys) {
    const dayData = weekPlanState.days[dayKey];
    if (dayData.planned.length === 0) continue;

    // Group customers by their addedBy (team member)
    const byMember = new Map();
    for (const c of dayData.planned) {
      const memberKey = c.addedBy || weekPlanState.globalAssignedTo || '';
      if (!byMember.has(memberKey)) byMember.set(memberKey, []);
      byMember.get(memberKey).push(c);
    }

    for (const [memberName, customers] of byMember) {
      routeGroups.push({ dayKey, date: dayData.date, memberName, customers });
    }
  }

  const groupCount = routeGroups.length;
  const progressToast = showToast(`Oppretter ruter... 0/${groupCount}`, 'info', 0);

  // For each (day + member): create/update a route, assign member, let backend create avtaler
  let daysDone = 0;
  try {
    for (const group of routeGroups) {
      const dayLabel = weekDayLabels[weekDayKeys.indexOf(group.dayKey)];
      const weekNum = getISOWeekNumber(weekPlanState.weekStart);
      const kundeIds = group.customers.map(c => c.id);
      const assignedName = group.memberName;

      // Resolve team member ID from name
      let techId = null;
      if (assignedName && wpTeamMembers) {
        const member = wpTeamMembers.find(m => m.navn === assignedName || m.name === assignedName);
        if (member) techId = member.id;
      }

      // Include member name in route name so different members get separate routes
      const memberSuffix = assignedName && assignedName !== '' ? ` (${assignedName})` : '';
      const routeName = `Uke ${weekNum} - ${dayLabel}${memberSuffix}`;

      try {
        let ruteId = null;

        // Check for existing route with same name+date (idempotent save)
        try {
          const findResp = await apiFetch(`/api/ruter/find-by-date?date=${group.date}&name=${encodeURIComponent(routeName)}`);
          if (findResp.ok) {
            const findJson = await findResp.json();
            if (findJson.data?.id) {
              ruteId = findJson.data.id;
              // Update existing route's customers
              await apiFetch(`/api/ruter/${ruteId}`, {
                method: 'PUT',
                body: JSON.stringify({ kunde_ids: kundeIds })
              });
            }
          }
        } catch { /* If find fails, create new */ }

        // Create new route if none found
        if (!ruteId) {
          const createResp = await apiFetch('/api/ruter', {
            method: 'POST',
            body: JSON.stringify({
              navn: routeName,
              planlagt_dato: group.date,
              kunde_ids: kundeIds
            })
          });

          if (!createResp.ok) {
            const errData = await createResp.json().catch(() => ({}));
            throw new Error(errData.error?.message || errData.error || 'Kunne ikke opprette rute');
          }

          const createJson = await createResp.json();
          ruteId = createJson.data?.id;
        }

        if (ruteId) {
          // Assign team member (triggers calendar sync in backend)
          await apiFetch(`/api/ruter/${ruteId}/assign`, {
            method: 'PUT',
            body: JSON.stringify({
              assigned_to: techId,
              planned_date: group.date
            })
          });
          created += kundeIds.length;
        }
      } catch (err) {
        errors += kundeIds.length;
        lastError = err.message || 'Ukjent feil';
        console.error('Rute-feil:', err);
      }

      daysDone++;
      if (progressToast) {
        const span = progressToast.querySelector('span');
        if (span) span.textContent = `Oppretter ruter... ${daysDone}/${groupCount}`;
      }
    }
  } finally {
    if (progressToast) progressToast.remove();
    wpSaving = false;
  }

  if (created > 0) {
    showToast(`${created} kunder planlagt i ${daysDone} ruter!`, 'success');
  }
  if (errors > 0) {
    showToast(`${errors} feilet: ${lastError}`, 'error');
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
    if (weekPlanState.days[dayKey]) weekPlanState.days[dayKey].planned = [];
  }
  weekPlanState.activeDay = null;
  if (areaSelectMode) toggleAreaSelect();
  refreshTeamFocus();
  renderWeeklyPlan();
  showToast('Plan tømt', 'info');
}

async function clearDayAvtaler(dayKey, dateStr) {
  // Called from button: data-action="clearDayAvtaler" data-args='["mandag","2026-03-23"]'
  // Also from legacy switch case with (dayKey, dateStr) from dataset
  if (!dayKey && !dateStr) return;
  const dayAvtaler = avtaler.filter(a => a.dato === dateStr);
  const dayPlanned = weekPlanState.days[dayKey]?.planned?.length || 0;
  const totalToRemove = dayAvtaler.length + dayPlanned;
  if (totalToRemove === 0) {
    showToast('Ingen stopp å slette', 'info');
    return;
  }

  const dayLabel = weekDayLabels[weekDayKeys.indexOf(dayKey)] || dayKey;
  const confirmClear = await showConfirm(
    `Slett alle ${totalToRemove} stopp for ${dayLabel}?${dayAvtaler.length > 0 ? ` ${dayAvtaler.length} avtale${dayAvtaler.length !== 1 ? 'r' : ''} slettes permanent.` : ''}`,
    'Slett alle'
  );
  if (!confirmClear) return;

  try {
    let errors = 0;
    for (const a of dayAvtaler) {
      const resp = await apiFetch(`/api/avtaler/${a.id}`, { method: 'DELETE' });
      if (!resp.ok) errors++;
    }
    // Delete routes for this date (fixes mobile weekplan + calendar sync)
    try {
      const ruterResp = await apiFetch('/api/ruter');
      if (ruterResp.ok) {
        const ruterJson = await ruterResp.json();
        const allRuter = ruterJson.data || [];
        const dayRuter = allRuter.filter(r => (r.planlagt_dato || r.planned_date) === dateStr);
        for (const r of dayRuter) {
          const resp = await apiFetch(`/api/ruter/${r.id}`, { method: 'DELETE' });
          if (!resp.ok) errors++;
        }
      }
    } catch { /* route cleanup best-effort */ }
    if (weekPlanState.days[dayKey]) {
      weekPlanState.days[dayKey].planned = [];
    }
    if (errors > 0) {
      showToast(`${errors} avtale(r) kunne ikke slettes`, 'warning');
    } else {
      showToast('Alle stopp slettet', 'success');
    }
    await loadAvtaler();
    refreshTeamFocus();
    renderWeeklyPlan();
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof applyFilters === 'function') applyFilters();
  } catch (err) {
    showToast('Feil ved sletting', 'error');
  }
}

// Helper: collect stops with coordinates for a weekplan day (planned + existing avtaler)
function getWpDayStops(dayKey, includeAvtaler = false, filterMember = null) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return null;

  const stops = [];
  for (const c of dayData.planned) {
    if (c.lat && c.lng) {
      stops.push({ id: c.id, lat: c.lat, lng: c.lng, navn: c.navn, adresse: c.adresse || '', estimertTid: c.estimertTid || 30 });
    }
  }

  if (includeAvtaler) {
    const dateStr = dayData.date;
    let existingAvtaler = avtaler.filter(a => a.dato === dateStr);
    if (filterMember) {
      existingAvtaler = existingAvtaler.filter(a => {
        const tech = a.tildelt_tekniker || a.opprettet_av || '';
        return tech === filterMember;
      });
    }
    for (const a of existingAvtaler) {
      const kunde = customers.find(c => c.id === a.kunde_id);
      if (kunde?.lat && kunde?.lng) {
        if (!stops.some(s => s.id === kunde.id)) {
          stops.push({ id: kunde.id, lat: kunde.lat, lng: kunde.lng, navn: kunde.navn, adresse: kunde.adresse || '', estimertTid: 30 });
        }
      }
    }
  }

  const routeStart = getRouteStartLocation();
  return { dayData, stops, routeStart };
}

// Helper: reorder dayData.planned based on VROOM optimized stops
function reorderPlannedStops(dayData, optimizedStops) {
  const plannedOptimized = [];
  for (const s of optimizedStops) {
    const p = dayData.planned.find(c => c.id === s.id);
    if (p) plannedOptimized.push(p);
  }
  // Append any stops without coordinates (not optimized)
  for (const p of dayData.planned) {
    if (!plannedOptimized.some(o => o.id === p.id)) plannedOptimized.push(p);
  }
  dayData.planned = plannedOptimized;
}

async function wpOptimizeOrder(dayKey) {
  const availableMembers = await getWpAvailableTeamMembers(dayKey);
  const dayStopCount = weekPlanState.days[dayKey]?.planned?.length || 0;
  let filterMember = null;
  if (availableMembers.length > 1) {
    filterMember = await wpShowTeamMemberPicker(dayKey, availableMembers, dayStopCount);
    if (filterMember === null) return;
  }
  // filterMember = who the route is FOR (display only), don't filter stops

  const result = getWpDayStops(dayKey);
  if (!result) return;
  const { dayData, stops, routeStart } = result;

  if (stops.length < 3) {
    showToast('Trenger minst 3 stopp for optimalisering', 'info');
    return;
  }
  if (!routeStart) {
    showToast('Sett firmaadresse i admin for å optimalisere rekkefølge', 'warning');
    return;
  }

  const loadingToast = showToast('Optimaliserer rekkefølge...', 'info', 0);

  try {
    const vroomRoute = await RouteService.optimize(stops, routeStart);
    if (loadingToast) loadingToast.remove();

    if (!vroomRoute) {
      showToast('Kunne ikke optimalisere rute', 'error');
      return;
    }

    const optimizedStops = RouteService.reorderByVroom(stops, vroomRoute);
    if (optimizedStops !== stops) {
      reorderPlannedStops(dayData, optimizedStops);
      renderWeeklyPlan();
      showToast('Rekkefølge optimalisert', 'success');
      localStorage.setItem('skyplanner_firstRoutePlanned', 'true');
      if (typeof refreshChecklistState === 'function') refreshChecklistState();
    }
  } catch (err) {
    if (loadingToast) loadingToast.remove();
    console.warn('[wpOptimizeOrder] Failed:', err);
    showToast('Feil ved optimalisering', 'error');
  }
}

// ---- Notify customer ("på vei" email) from weekplan ----

async function wpNotifyCustomer(kundeId) {
  const kunde = customers.find(c => c.id === kundeId);
  if (!kunde) return;

  if (!kunde.epost) {
    showToast('Kunden har ikke registrert e-post', 'error');
    return;
  }

  const estMin = kunde.estimert_tid || 10;
  const contactName = kunde.kontaktperson || kunde.navn;

  // Confirmation dialog
  const confirmed = await showConfirm(
    `Send «på vei»-varsel til ${contactName} (${kunde.epost})?`,
    'Varsle kunde'
  );
  if (!confirmed) return;

  try {
    const resp = await apiFetch(`/api/todays-work/notify-customer/${kundeId}`, {
      method: 'POST',
      body: JSON.stringify({ estimert_tid: estMin }),
    });
    const data = await resp.json();

    if (data.success) {
      showToast(`Varsel sendt til ${kunde.epost}`, 'success');
      // Mark button as sent
      const btn = document.querySelector(`[data-action="wpNotifyCustomer"][data-args='[${kundeId}]']`);
      if (btn) {
        btn.classList.add('wp-notified');
        btn.disabled = true;
        btn.title = 'Varsel sendt';
      }
    } else {
      showToast(data.error || 'Kunne ikke sende varsel', 'error');
    }
  } catch (err) {
    showToast('Kunne ikke sende varsel', 'error');
  }
}

async function wpNavigateDay(dayKey) {
  const availableMembers = await getWpAvailableTeamMembers(dayKey);
  const dayStopCount = weekPlanState.days[dayKey]?.planned?.length || 0;
  let filterMember = null;
  if (availableMembers.length > 1) {
    filterMember = await wpShowTeamMemberPicker(dayKey, availableMembers, dayStopCount);
    if (filterMember === null) return;
  }
  // filterMember selects which team member's avtaler to include
  const memberFilter = (filterMember && filterMember !== '__all__') ? filterMember : null;

  const result = getWpDayStops(dayKey, true, memberFilter);
  if (!result) return;
  const { dayData, stops, routeStart } = result;

  if (stops.length === 0) {
    showToast('Ingen kunder med koordinater for denne dagen', 'info');
    return;
  }
  if (!routeStart) {
    showToast('Sett firmaadresse i admin for å tegne rute', 'warning');
    return;
  }

  const loadingToast = showToast('Optimaliserer rute...', 'info', 0);

  // Step 1: Optimize stop order via VROOM (2+ stops)
  let etaData = null;
  if (stops.length >= 2) {
    try {
      const vroomRoute = await RouteService.optimize(stops, routeStart);
      if (vroomRoute) {
        const optimizedStops = RouteService.reorderByVroom(stops, vroomRoute);
        if (optimizedStops !== stops) {
          stops.length = 0;
          stops.push(...optimizedStops);
          reorderPlannedStops(dayData, optimizedStops);
          renderWeeklyPlan();
        }
        etaData = RouteService.calculateETAs(vroomRoute);
      }
    } catch (e) {
      console.warn('[wpNavigateDay] Optimization failed, using original order:', e);
    }
  }

  // Step 2: Render route on map
  if (loadingToast) loadingToast.textContent = 'Beregner rute...';

  try {
    // Dim all markers/clusters via CSS class on map
    wpRouteActive = true;
    wpRouteStopIds = new Set(stops.map(s => Number(s.id)));
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();

    const routeResult = await renderRouteOnMap(stops, routeStart, { etaData });
    if (loadingToast) loadingToast.remove();

    // Store for export to Maps
    currentRouteData = { customers: stops, duration: routeResult.drivingSeconds, distance: routeResult.distanceMeters };

    // Show summary panel
    showWpRouteSummary(dayKey, stops, routeResult.drivingSeconds, routeResult.distanceMeters, filterMember);

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
function showWpRouteSummary(dayKey, stops, drivingSeconds, distanceMeters, memberName = null) {
  // Only remove previous panel element (don't clear route - we just drew a new one)
  const oldPanel = document.getElementById('wpRouteSummary');
  if (oldPanel) oldPanel.remove();

  const drivingMin = Math.round(drivingSeconds / 60);
  const customerMin = stops.reduce((sum, s) => sum + (s.estimertTid || 30), 0);
  const totalMin = drivingMin + customerMin;
  const km = (distanceMeters / 1000).toFixed(1);
  const dayLabel = weekDayLabels[weekDayKeys.indexOf(dayKey)];
  const memberLabel = memberName && memberName !== '__all__' ? ` — ${escapeHtml(memberName)}` : '';

  const panel = document.createElement('div');
  panel.id = 'wpRouteSummary';
  panel.className = 'wp-route-summary';
  panel.innerHTML = `
    <div class="wp-route-header">
      <strong>${escapeHtml(dayLabel)}${memberLabel} — ${stops.length} stopp</strong>
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
      <button class="btn btn-small btn-ghost" data-action="toggleRouteMarkers">
        <i aria-hidden="true" class="fas fa-eye"></i> Vis alle
      </button>
      <button class="btn btn-small btn-secondary" data-action="closeWpRoute">
        <i aria-hidden="true" class="fas fa-eye-slash"></i> Skjul rute
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
  wpShowAllMarkers = false;
  applyTeamFocusToMarkers();
  if (typeof refreshClusters === 'function') refreshClusters();
  // Keep currentRouteData so "Optimaliser rute" can restore without re-calculating
}

// Suggest nearby stops from SmartRouteEngine clusters
function wpSuggestStops() {
  const container = document.getElementById('wpSuggestions');
  if (!container) return;

  // Toggle off if already showing
  if (container.innerHTML) {
    container.innerHTML = '';
    return;
  }

  if (typeof SmartRouteEngine === 'undefined') {
    showToast('Smarte ruter er ikke tilgjengelig', 'info');
    return;
  }

  const dayKey = weekPlanState.activeDay;
  if (!dayKey) {
    showToast('Velg en dag først', 'info');
    return;
  }

  const dayData = weekPlanState.days[dayKey];
  const dateStr = dayData.date;

  // Get existing IDs for this day (planned + avtaler) to exclude
  const existingIds = new Set(dayData.planned.map(c => c.id));
  avtaler.filter(a => a.dato === dateStr).forEach(a => existingIds.add(a.kunde_id));

  // Get recommendations from SmartRouteEngine
  const recommendations = SmartRouteEngine.generateRecommendations();

  if (!recommendations || recommendations.length === 0) {
    container.innerHTML = `<div class="wp-suggest-empty"><i aria-hidden="true" class="fas fa-check-circle"></i> Ingen kunder trenger besøk snart</div>`;
    return;
  }

  // Flatten all recommended customers, exclude already planned, sort by distance to existing stops
  const routeStart = getRouteStartLocation();
  const existingStops = dayData.planned.filter(c => c.lat && c.lng);

  // Calculate relevance: prefer customers near existing stops or company
  let candidatesWithScore = [];
  for (const rec of recommendations) {
    for (const customer of rec.customers) {
      if (existingIds.has(customer.id)) continue;
      if (!customer.lat || !customer.lng) continue;

      // Distance to nearest existing stop or company
      let minDist = Infinity;
      if (existingStops.length > 0) {
        for (const stop of existingStops) {
          const d = SmartRouteEngine.haversineDistance(customer.lat, customer.lng, stop.lat, stop.lng);
          if (d < minDist) minDist = d;
        }
      } else if (routeStart) {
        minDist = SmartRouteEngine.haversineDistance(customer.lat, customer.lng, routeStart.lat, routeStart.lng);
      }

      const nextDate = getNextControlDate(customer);
      const isOverdue = nextDate && nextDate < new Date();

      candidatesWithScore.push({
        customer,
        distance: minDist,
        isOverdue,
        cluster: rec.primaryArea,
        efficiencyScore: rec.efficiencyScore
      });
    }
  }

  // Sort: overdue first, then by distance (nearest first)
  candidatesWithScore.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return a.distance - b.distance;
  });

  // Limit to top 8
  candidatesWithScore = candidatesWithScore.slice(0, 8);

  if (candidatesWithScore.length === 0) {
    container.innerHTML = `<div class="wp-suggest-empty"><i aria-hidden="true" class="fas fa-check-circle"></i> Alle anbefalte kunder er allerede planlagt</div>`;
    return;
  }

  let html = `<div class="wp-suggest-header">
    <span><i aria-hidden="true" class="fas fa-lightbulb"></i> Foreslåtte stopp</span>
    <button class="wp-suggest-close" data-action="wpCloseSuggestions" aria-label="Lukk">&times;</button>
  </div>`;
  html += `<div class="wp-suggest-list">`;

  for (const item of candidatesWithScore) {
    const c = item.customer;
    const distLabel = item.distance < 1 ? `${Math.round(item.distance * 1000)}m` : `${item.distance.toFixed(1)}km`;
    const overdueClass = item.isOverdue ? 'overdue' : '';

    html += `<div class="wp-suggest-item ${overdueClass}" data-action="wpAddSuggested" data-customer-id="${c.id}" role="button" tabindex="0">
      <div class="wp-suggest-info">
        <span class="wp-suggest-name">${escapeHtml(c.navn)}</span>
        <span class="wp-suggest-meta">${escapeHtml(c.poststed || c.adresse || '')} · ${distLabel}${item.isOverdue ? ' · Forfalt' : ''}</span>
      </div>
      <i aria-hidden="true" class="fas fa-plus wp-suggest-add"></i>
    </div>`;
  }

  html += `</div>`;
  html += `<button class="btn btn-small btn-primary wp-suggest-all-btn" data-action="wpAddAllSuggested">
    <i aria-hidden="true" class="fas fa-plus-circle"></i> Legg til alle (${candidatesWithScore.length})
  </button>`;

  container.innerHTML = html;

  // Store candidates for "add all" action
  container._candidates = candidatesWithScore;
}

// Add a single suggested customer to weekplan
function wpAddSuggested(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;
  addCustomersToWeekPlan([customer]);

  // Remove from suggestions UI
  const item = document.querySelector(`[data-action="wpAddSuggested"][data-customer-id="${customerId}"]`);
  if (item) {
    item.style.opacity = '0.3';
    item.style.pointerEvents = 'none';
    item.querySelector('.wp-suggest-add').className = 'fas fa-check wp-suggest-add';
  }
}

// Add all suggested customers to weekplan
function wpAddAllSuggested() {
  const container = document.getElementById('wpSuggestions');
  if (!container?._candidates) return;

  const customerIds = container._candidates.map(c => c.customer.id);
  const customerObjects = customerIds.map(id => customers.find(c => c.id === id)).filter(Boolean);
  addCustomersToWeekPlan(customerObjects);

  // Close suggestions
  container.innerHTML = '';
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

// === Auto-fill week from SmartRouteEngine ===

function wpAutoFillWeek() {
  // Get customers needing control
  const needingControl = SmartRouteEngine.getCustomersNeedingControl();
  if (needingControl.length === 0) {
    showToast('Ingen kunder trenger kontroll de neste dagene', 'info');
    return;
  }

  // Filter out customers already planned this week (any day)
  const allPlannedIds = new Set();
  for (const dk of weekDayKeys) {
    for (const c of weekPlanState.days[dk].planned) allPlannedIds.add(c.id);
  }
  // Also exclude customers with existing avtaler this week
  for (const dk of weekDayKeys) {
    const dateStr = weekPlanState.days[dk].date;
    for (const a of avtaler.filter(av => av.dato === dateStr)) {
      if (a.kunde_id) allPlannedIds.add(a.kunde_id);
    }
  }
  const available = needingControl.filter(c => !allPlannedIds.has(c.id));
  if (available.length === 0) {
    showToast('Alle kunder som trenger kontroll er allerede planlagt', 'info');
    return;
  }

  // Cluster using DBSCAN
  const clusters = SmartRouteEngine.dbscanClustering(
    available,
    SmartRouteEngine.params.clusterRadiusKm,
    SmartRouteEngine.params.minClusterSize
  );

  // Collect unclustered customers (noise)
  const clusteredIds = new Set(clusters.flat().map(c => c.id));
  const noise = available.filter(c => !clusteredIds.has(c.id));

  // Build workload items: clusters first, then individual noise customers
  const workItems = [];
  for (const cluster of clusters) {
    workItems.push({ customers: cluster, minutes: cluster.length * 30 });
  }
  // Group noise by poststed for some locality
  const noiseByArea = {};
  for (const c of noise) {
    const area = c.poststed || 'Ukjent';
    if (!noiseByArea[area]) noiseByArea[area] = [];
    noiseByArea[area].push(c);
  }
  for (const [, group] of Object.entries(noiseByArea)) {
    workItems.push({ customers: group, minutes: group.length * 30 });
  }

  // Sort clusters largest first for better packing
  workItems.sort((a, b) => b.minutes - a.minutes);

  // Distribute across weekdays (Mon-Fri) with capacity limit
  const workdayMinutes = 480;
  const workdays = weekDayKeys.slice(0, 5); // Mon-Fri
  const dayLoad = {};
  for (const dk of workdays) {
    // Account for already planned items
    dayLoad[dk] = getDayEstimatedTotal(dk);
  }

  let totalAdded = 0;
  const currentUser = weekPlanState.globalAssignedTo || localStorage.getItem('userName') || 'admin';

  for (const item of workItems) {
    // Find day with most remaining capacity
    let bestDay = null;
    let bestRemaining = -1;
    for (const dk of workdays) {
      const remaining = workdayMinutes - dayLoad[dk];
      if (remaining >= item.minutes && remaining > bestRemaining) {
        bestDay = dk;
        bestRemaining = remaining;
      }
    }

    // If no day has full capacity, find one with most room (allow slight overflow)
    if (!bestDay) {
      for (const dk of workdays) {
        const remaining = workdayMinutes - dayLoad[dk];
        if (remaining > bestRemaining) {
          bestDay = dk;
          bestRemaining = remaining;
        }
      }
    }

    if (!bestDay || bestRemaining <= 0) continue;

    // Add customers to this day
    const dayData = weekPlanState.days[bestDay];
    for (const c of item.customers) {
      if (dayData.planned.some(p => p.id === c.id)) continue;
      dayData.planned.push({
        id: c.id,
        navn: c.navn,
        adresse: c.adresse || '',
        postnummer: c.postnummer || '',
        poststed: c.poststed || '',
        telefon: c.telefon || '',
        kategori: c.kategori || null,
        lat: c.lat || null,
        lng: c.lng || null,
        estimertTid: c.estimert_tid || 30,
        addedBy: currentUser
      });
      totalAdded++;
    }
    dayLoad[bestDay] += item.minutes;
  }

  if (totalAdded > 0) {
    const daysUsed = workdays.filter(dk => weekPlanState.days[dk].planned.length > 0).length;
    showToast(`${totalAdded} kunder fordelt på ${daysUsed} dager basert på område og kapasitet`, 'success');
    refreshTeamFocus();
    renderWeeklyPlan();
  } else {
    showToast('Kunne ikke plassere kunder — alle dager er fulle', 'warning');
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

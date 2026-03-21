// ============================================
// MOBILE WEEKPLAN AREAS — Geographic area browser for weekly planning
// Bottom sheet overlay that lets users browse overdue/upcoming areas
// and batch-add customers from an area to a specific day.
// Fetches customers via API since global customers[] may be empty on mobile.
// ============================================

let mfWpAreaState = {
  dayKey: null,
  activeTab: 'overdue',   // 'overdue' | 'upcoming' | 'search'
  selectedIds: new Set(),
  expandedArea: null,
  cachedCustomers: null,   // fetched from API, cached per session
  loading: false
};

// ---- Fetch customers (needed on mobile where global customers[] is empty) ----

async function mfWpEnsureCustomers() {
  // Use global customers if available and non-empty
  if (Array.isArray(customers) && customers.length > 0) {
    mfWpAreaState.cachedCustomers = customers;
    return;
  }
  // Use cache if already fetched
  if (mfWpAreaState.cachedCustomers && mfWpAreaState.cachedCustomers.length > 0) return;

  // Fetch from API
  try {
    const resp = await fetch('/api/kunder?limit=5000', {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    const rawData = json.success ? json.data : json;
    mfWpAreaState.cachedCustomers = Array.isArray(rawData) ? rawData : (rawData?.data || []);
  } catch {
    mfWpAreaState.cachedCustomers = [];
  }
}

function mfWpGetCustomersList() {
  return mfWpAreaState.cachedCustomers || [];
}

// ---- Area data helpers ----

function mfWpGetOverdueCustomers() {
  const allCustomers = mfWpGetCustomersList();
  if (allCustomers.length === 0) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  return allCustomers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    return controlMonthValue < currentMonthValue;
  }).map(c => {
    const nextDate = getNextControlDate(c);
    const daysOverdue = Math.ceil((today - nextDate) / (1000 * 60 * 60 * 24));
    return { ...c, daysOverdue, _controlDate: nextDate };
  });
}

function mfWpGetUpcomingCustomers() {
  const allCustomers = mfWpGetCustomersList();
  if (allCustomers.length === 0) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + 60);

  return allCustomers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    return controlMonthValue >= currentMonthValue && nextDate <= futureDate;
  }).map(c => {
    const nextDate = getNextControlDate(c);
    const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
    return { ...c, daysUntil, _controlDate: nextDate };
  });
}

function mfWpGroupByArea(customerList) {
  const byArea = {};
  customerList.forEach(c => {
    const area = c.poststed || 'Ukjent';
    if (!byArea[area]) byArea[area] = { name: area, customers: [] };
    byArea[area].customers.push(c);
  });
  return Object.values(byArea).sort((a, b) => b.customers.length - a.customers.length);
}

function mfWpGetPlannedIds() {
  const ids = new Set();
  if (!mfWeekplanState || !mfWeekplanState.days) return ids;
  for (const dayKey of mfWpDayKeys) {
    const dayData = mfWeekplanState.days[dayKey];
    if (dayData && dayData.stops) {
      dayData.stops.forEach(s => ids.add(s.kundeId));
    }
  }
  return ids;
}

// ---- Open / Close ----

async function mfWpShowAreaBrowser(dayKey) {
  mfWpAreaState.dayKey = dayKey;
  mfWpAreaState.selectedIds = new Set();
  mfWpAreaState.expandedArea = null;
  mfWpAreaState.activeTab = 'overdue';

  const overlay = document.createElement('div');
  overlay.className = 'mf-bottom-sheet';
  overlay.id = 'mfWpAreaSheet';
  overlay.innerHTML = `
    <div class="mf-sheet-backdrop" data-action="mfWpCloseAreaSheet"></div>
    <div class="mf-sheet-content mf-area-sheet-content">
      <div class="mf-visit-handle"></div>
      <h3>Velg fra omr&aring;de &mdash; ${escapeHtml(mfWpDayLabels[mfWpDayKeys.indexOf(dayKey)])}</h3>

      <div class="mf-area-tabs">
        <button class="mf-area-tab active" data-action="mfWpSwitchAreaTab" data-args='["overdue"]'>
          <i class="fas fa-exclamation-circle" aria-hidden="true"></i> Forfalte
        </button>
        <button class="mf-area-tab" data-action="mfWpSwitchAreaTab" data-args='["upcoming"]'>
          <i class="fas fa-clock" aria-hidden="true"></i> Kommende
        </button>
        <button class="mf-area-tab" data-action="mfWpSwitchAreaTab" data-args='["search"]'>
          <i class="fas fa-search" aria-hidden="true"></i> S&oslash;k
        </button>
      </div>

      <div id="mfWpAreaSearchWrap" class="mf-area-search-wrap" style="display:none;">
        <input type="text" id="mfWpAreaSearchInput" class="mf-search-input" placeholder="S&oslash;k omr&aring;de (poststed)..." autocomplete="off">
      </div>

      <div id="mfWpAreaList" class="mf-area-list">
        <div class="mf-area-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Laster kunder...</div>
      </div>

      <div id="mfWpAreaActionBar" class="mf-area-action-bar" style="display:none;">
        <button class="mf-area-add-btn" data-action="mfWpAddSelectedToDay">
          <i class="fas fa-plus" aria-hidden="true"></i>
          <span id="mfWpAreaAddCount">Legg til 0 kunder</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById('mfWeekplanOverlay').appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
  });

  // Fetch customers then render
  await mfWpEnsureCustomers();

  // Determine default tab based on data
  const overdueList = mfWpGetOverdueCustomers();
  if (overdueList.length === 0) {
    mfWpAreaState.activeTab = 'upcoming';
    // Update tab buttons
    document.querySelectorAll('.mf-area-tab').forEach(btn => btn.classList.remove('active'));
    const tabs = document.querySelectorAll('.mf-area-tab');
    if (tabs[1]) tabs[1].classList.add('active');
  }

  mfWpRenderAreaTab();

  // Setup search handler
  const searchInput = document.getElementById('mfWpAreaSearchInput');
  if (searchInput) {
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => mfWpRenderAreaTab(), 200);
    });
  }
}

function mfWpCloseAreaSheet() {
  const sheet = document.getElementById('mfWpAreaSheet');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 300);
  }
  mfWpAreaState.selectedIds = new Set();
  mfWpAreaState.expandedArea = null;
}

// ---- Tab switching ----

function mfWpSwitchAreaTab(tab) {
  mfWpAreaState.activeTab = tab;
  mfWpAreaState.expandedArea = null;
  mfWpAreaState.selectedIds = new Set();
  mfWpUpdateAreaActionBar();

  // Update tab buttons
  document.querySelectorAll('.mf-area-tab').forEach(btn => btn.classList.remove('active'));
  const tabs = document.querySelectorAll('.mf-area-tab');
  const tabMap = { overdue: 0, upcoming: 1, search: 2 };
  if (tabs[tabMap[tab]]) tabs[tabMap[tab]].classList.add('active');

  // Show/hide search input
  const searchWrap = document.getElementById('mfWpAreaSearchWrap');
  if (searchWrap) {
    searchWrap.style.display = tab === 'search' ? 'block' : 'none';
    if (tab === 'search') {
      setTimeout(() => document.getElementById('mfWpAreaSearchInput')?.focus(), 100);
    }
  }

  mfWpRenderAreaTab();
}

// ---- Render ----

function mfWpRenderAreaTab() {
  const listEl = document.getElementById('mfWpAreaList');
  if (!listEl) return;

  const allCustomers = mfWpGetCustomersList();
  let customerList = [];
  let emptyMsg = '';
  let isOverdueTab = false;

  if (mfWpAreaState.activeTab === 'overdue') {
    customerList = mfWpGetOverdueCustomers();
    emptyMsg = 'Ingen forfalte kontroller';
    isOverdueTab = true;
  } else if (mfWpAreaState.activeTab === 'upcoming') {
    customerList = mfWpGetUpcomingCustomers();
    emptyMsg = 'Ingen kommende kontroller';
  } else {
    // Search: group all customers, filter by search query
    const query = (document.getElementById('mfWpAreaSearchInput')?.value || '').trim().toLowerCase();
    if (query.length < 2) {
      listEl.innerHTML = '<p class="mf-area-hint">Skriv minst 2 tegn for &aring; s&oslash;ke</p>';
      return;
    }
    customerList = allCustomers.filter(c => {
      const poststed = (c.poststed || '').toLowerCase();
      const postnr = (c.postnummer || '').toLowerCase();
      return poststed.includes(query) || postnr.includes(query);
    });
    emptyMsg = 'Ingen kunder funnet i dette omr&aring;det';
  }

  if (customerList.length === 0) {
    listEl.innerHTML = `<div class="mf-area-empty"><i class="fas fa-check-circle" aria-hidden="true"></i><p>${emptyMsg}</p></div>`;
    return;
  }

  const groups = mfWpGroupByArea(customerList);
  const plannedIds = mfWpGetPlannedIds();

  let html = '';
  groups.forEach(group => {
    const isExpanded = mfWpAreaState.expandedArea === group.name;
    const availableCount = group.customers.filter(c => !plannedIds.has(c.id)).length;

    // Severity breakdown for overdue tab
    let severityHtml = '';
    if (isOverdueTab) {
      const critical = group.customers.filter(c => c.daysOverdue > 60).length;
      const warning = group.customers.filter(c => c.daysOverdue > 30 && c.daysOverdue <= 60).length;
      const mild = group.customers.filter(c => c.daysOverdue <= 30).length;
      if (critical > 0) severityHtml += `<span class="mf-area-sev critical">${critical} kritisk</span>`;
      if (warning > 0) severityHtml += `<span class="mf-area-sev warning">${warning} advarsel</span>`;
      if (mild > 0) severityHtml += `<span class="mf-area-sev mild">${mild} ny</span>`;
    }

    // Upcoming: show how soon
    if (mfWpAreaState.activeTab === 'upcoming') {
      const soon = group.customers.filter(c => c.daysUntil <= 14).length;
      const later = group.customers.filter(c => c.daysUntil > 14).length;
      if (soon > 0) severityHtml += `<span class="mf-area-sev warning">${soon} innen 2 uker</span>`;
      if (later > 0) severityHtml += `<span class="mf-area-sev mild">${later} senere</span>`;
    }

    html += `
      <div class="mf-area-card ${isExpanded ? 'expanded' : ''}">
        <div class="mf-area-card-header" data-action="mfWpExpandArea" data-args='["${escapeHtml(group.name)}"]'>
          <div class="mf-area-card-left">
            <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
            <div class="mf-area-card-info">
              <strong>${escapeHtml(group.name)}</strong>
              <span>${group.customers.length} kunder${availableCount < group.customers.length ? ` (${availableCount} tilgjengelig)` : ''}</span>
            </div>
          </div>
          <div class="mf-area-card-right">
            <div class="mf-area-sev-wrap">${severityHtml}</div>
            <i class="fas fa-chevron-${isExpanded ? 'up' : 'down'} mf-area-chevron" aria-hidden="true"></i>
          </div>
        </div>
        ${isExpanded ? mfWpRenderAreaCustomers(group) : ''}
      </div>
    `;
  });

  listEl.innerHTML = html;
}

function mfWpRenderAreaCustomers(group) {
  const plannedIds = mfWpGetPlannedIds();
  const dayKey = mfWpAreaState.dayKey;
  const dayPlannedIds = new Set();
  if (mfWeekplanState.days[dayKey]?.stops) {
    mfWeekplanState.days[dayKey].stops.forEach(s => dayPlannedIds.add(s.kundeId));
  }

  const available = group.customers.filter(c => !dayPlannedIds.has(c.id));
  const alreadyPlanned = group.customers.filter(c => dayPlannedIds.has(c.id));

  // Check if all available are selected
  const allSelected = available.length > 0 && available.every(c => mfWpAreaState.selectedIds.has(c.id));

  let html = `<div class="mf-area-customers">`;

  // Select all header
  if (available.length > 0) {
    html += `
      <div class="mf-area-select-all" data-action="mfWpSelectAllInArea" data-args='["${escapeHtml(group.name)}"]'>
        <div class="mf-area-checkbox ${allSelected ? 'checked' : ''}">
          ${allSelected ? '<i class="fas fa-check" aria-hidden="true"></i>' : ''}
        </div>
        <span>Velg alle (${available.length})</span>
      </div>
    `;
  }

  // Render available customers
  available.forEach(c => {
    const isSelected = mfWpAreaState.selectedIds.has(c.id);
    const inOtherDay = plannedIds.has(c.id) && !dayPlannedIds.has(c.id);

    let badgeHtml = '';
    if (c.daysOverdue != null) {
      const sevClass = c.daysOverdue > 60 ? 'critical' : c.daysOverdue > 30 ? 'warning' : 'mild';
      badgeHtml = `<span class="mf-area-badge ${sevClass}">${c.daysOverdue}d</span>`;
    } else if (c.daysUntil != null) {
      const sevClass = c.daysUntil <= 14 ? 'warning' : 'mild';
      badgeHtml = `<span class="mf-area-badge ${sevClass}">${c.daysUntil}d</span>`;
    }

    html += `
      <div class="mf-area-customer ${isSelected ? 'selected' : ''}" data-action="mfWpToggleCustomerSelect" data-args='[${c.id}]'>
        <div class="mf-area-checkbox ${isSelected ? 'checked' : ''}">
          ${isSelected ? '<i class="fas fa-check" aria-hidden="true"></i>' : ''}
        </div>
        <div class="mf-area-customer-info">
          <strong>${escapeHtml(c.navn)}</strong>
          <span>${escapeHtml(c.adresse || '')}</span>
        </div>
        ${badgeHtml}
        ${inOtherDay ? '<span class="mf-area-other-day">I annen dag</span>' : ''}
      </div>
    `;
  });

  // Render already planned customers (dimmed)
  alreadyPlanned.forEach(c => {
    html += `
      <div class="mf-area-customer disabled">
        <div class="mf-area-checkbox disabled"></div>
        <div class="mf-area-customer-info">
          <strong>${escapeHtml(c.navn)}</strong>
          <span>${escapeHtml(c.adresse || '')}</span>
        </div>
        <span class="mf-area-already">Allerede planlagt</span>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

// ---- Selection ----

function mfWpExpandArea(areaName) {
  if (mfWpAreaState.expandedArea === areaName) {
    mfWpAreaState.expandedArea = null;
  } else {
    mfWpAreaState.expandedArea = areaName;
  }
  mfWpRenderAreaTab();
}

function mfWpToggleCustomerSelect(kundeId) {
  if (mfWpAreaState.selectedIds.has(kundeId)) {
    mfWpAreaState.selectedIds.delete(kundeId);
  } else {
    mfWpAreaState.selectedIds.add(kundeId);
  }
  mfWpRenderAreaTab();
  mfWpUpdateAreaActionBar();
}

function mfWpSelectAllInArea(areaName) {
  let customerList;
  if (mfWpAreaState.activeTab === 'overdue') {
    customerList = mfWpGetOverdueCustomers();
  } else if (mfWpAreaState.activeTab === 'upcoming') {
    customerList = mfWpGetUpcomingCustomers();
  } else {
    const query = (document.getElementById('mfWpAreaSearchInput')?.value || '').trim().toLowerCase();
    const allCustomers = mfWpGetCustomersList();
    customerList = allCustomers.filter(c => {
      const poststed = (c.poststed || '').toLowerCase();
      const postnr = (c.postnummer || '').toLowerCase();
      return poststed.includes(query) || postnr.includes(query);
    });
  }

  const group = mfWpGroupByArea(customerList).find(g => g.name === areaName);
  if (!group) return;

  const dayPlannedIds = new Set();
  if (mfWeekplanState.days[mfWpAreaState.dayKey]?.stops) {
    mfWeekplanState.days[mfWpAreaState.dayKey].stops.forEach(s => dayPlannedIds.add(s.kundeId));
  }

  const available = group.customers.filter(c => !dayPlannedIds.has(c.id));
  const allSelected = available.every(c => mfWpAreaState.selectedIds.has(c.id));

  if (allSelected) {
    available.forEach(c => mfWpAreaState.selectedIds.delete(c.id));
  } else {
    available.forEach(c => mfWpAreaState.selectedIds.add(c.id));
  }

  mfWpRenderAreaTab();
  mfWpUpdateAreaActionBar();
}

// ---- Action bar ----

function mfWpUpdateAreaActionBar() {
  const bar = document.getElementById('mfWpAreaActionBar');
  const countEl = document.getElementById('mfWpAreaAddCount');
  if (!bar || !countEl) return;

  const count = mfWpAreaState.selectedIds.size;
  if (count > 0) {
    bar.style.display = 'flex';
    countEl.textContent = `Legg til ${count} kunde${count !== 1 ? 'r' : ''}`;
  } else {
    bar.style.display = 'none';
  }
}

// ---- Batch add ----

function mfWpAddSelectedToDay() {
  const dayKey = mfWpAreaState.dayKey;
  if (!dayKey || mfWpAreaState.selectedIds.size === 0) return;

  const stops = mfWeekplanState.days[dayKey].stops;
  const existingIds = new Set(stops.map(s => s.kundeId));
  const allCustomers = mfWpGetCustomersList();
  let addedCount = 0;

  mfWpAreaState.selectedIds.forEach(kundeId => {
    if (existingIds.has(kundeId)) return;

    const kunde = allCustomers.find(c => c.id === kundeId);
    if (!kunde) return;

    stops.push({
      ruteId: null,
      kundeId: kunde.id,
      kundeNavn: kunde.navn || 'Ukjent',
      adresse: [kunde.adresse, kunde.poststed].filter(Boolean).join(', '),
      assignedTo: '',
      assignedToId: null,
      estimertTid: kunde.estimert_tid || 30,
      rekkefolge: stops.length
    });
    addedCount++;
  });

  if (addedCount > 0) {
    mfWeekplanState.dirty = true;
    mfWpUpdateSaveBtn();
    mfWpScheduleAutoSave();
    mfWpRenderDays();
    mfWpRenderDots();
    mfWpInitDragDrop();
    mfShowBanner(`${addedCount} kunde${addedCount !== 1 ? 'r' : ''} lagt til`, 'success');
  }

  mfWpCloseAreaSheet();
}

// ---- Method picker (choice between name search and area browser) ----

function mfWpShowAddMethodPicker(dayKey) {
  const overlay = document.createElement('div');
  overlay.className = 'mf-bottom-sheet';
  overlay.id = 'mfWpMethodSheet';
  overlay.innerHTML = `
    <div class="mf-sheet-backdrop" data-action="mfWpCloseMethodSheet"></div>
    <div class="mf-sheet-content mf-method-content">
      <div class="mf-visit-handle"></div>
      <h3>Legg til kunder &mdash; ${escapeHtml(mfWpDayLabels[mfWpDayKeys.indexOf(dayKey)])}</h3>
      <div class="mf-method-options">
        <button class="mf-method-option" data-action="mfWpMethodSearch" data-args='["${escapeHtml(dayKey)}"]'>
          <div class="mf-method-icon"><i class="fas fa-search" aria-hidden="true"></i></div>
          <div class="mf-method-text">
            <strong>S&oslash;k etter kunde</strong>
            <span>Finn en bestemt kunde</span>
          </div>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
        <button class="mf-method-option" data-action="mfWpMethodArea" data-args='["${escapeHtml(dayKey)}"]'>
          <div class="mf-method-icon area"><i class="fas fa-map-marker-alt" aria-hidden="true"></i></div>
          <div class="mf-method-text">
            <strong>Velg fra omr&aring;de</strong>
            <span>Forfalte og kommende omr&aring;der</span>
          </div>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;

  document.getElementById('mfWeekplanOverlay').appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function mfWpCloseMethodSheet() {
  const sheet = document.getElementById('mfWpMethodSheet');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 300);
  }
}

// ---- Compound action wrappers (for data-action delegation) ----

function mfWpMethodSearch(dayKey) {
  mfWpCloseMethodSheet();
  mfWpAddCustomerDirect(dayKey);
}

function mfWpMethodArea(dayKey) {
  mfWpCloseMethodSheet();
  mfWpShowAreaBrowser(dayKey);
}

// ---- Expose globally ----

window.mfWpShowAreaBrowser = mfWpShowAreaBrowser;
window.mfWpCloseAreaSheet = mfWpCloseAreaSheet;
window.mfWpSwitchAreaTab = mfWpSwitchAreaTab;
window.mfWpExpandArea = mfWpExpandArea;
window.mfWpToggleCustomerSelect = mfWpToggleCustomerSelect;
window.mfWpSelectAllInArea = mfWpSelectAllInArea;
window.mfWpAddSelectedToDay = mfWpAddSelectedToDay;
window.mfWpShowAddMethodPicker = mfWpShowAddMethodPicker;
window.mfWpCloseMethodSheet = mfWpCloseMethodSheet;
window.mfWpMethodSearch = mfWpMethodSearch;
window.mfWpMethodArea = mfWpMethodArea;

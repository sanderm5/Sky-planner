/**
 * Team Overview — Desktop sidebar tab
 * Shows team status, routes, progress for admin users on desktop.
 * Actions: Push route, Quick-assign customer, Open weekplan.
 * Reuses /api/todays-work/team-overview endpoint.
 */

// ---- State ----
let teamOverviewDate = new Date().toISOString().split('T')[0];
let teamOverviewData = null;
let teamOverviewSummary = null;
let teamOverviewExpandedId = null;
let teamOverviewPollingTimer = null;
let toSearchTimer = null;
let toSearchResults = [];
let toSearchAbort = null;

// ---- Public API ----

function loadTeamOverview() {
  const container = document.getElementById('teamOverviewContent');
  if (!container) return;

  // Render week view container if not already present
  if (!document.getElementById('raoWeekView')) {
    container.innerHTML = '<div id="raoWeekView"></div>';
  }

  // Load week data
  if (typeof raoLoadWeekData === 'function') {
    if (!raoWeekStart) raoWeekStart = raoGetWeekStart();
    raoLoadWeekData();
  }
}

function unloadTeamOverview() {
  if (typeof raoCleanupTeamMap === 'function') raoCleanupTeamMap();
}

// ---- Date navigation ----

function teamOverviewPrevDay() {
  const d = new Date(teamOverviewDate);
  d.setDate(d.getDate() - 1);
  teamOverviewDate = d.toISOString().split('T')[0];
  teamOverviewFetchData();
}

function teamOverviewNextDay() {
  const d = new Date(teamOverviewDate);
  d.setDate(d.getDate() + 1);
  teamOverviewDate = d.toISOString().split('T')[0];
  teamOverviewFetchData();
}

function teamOverviewToday() {
  teamOverviewDate = new Date().toISOString().split('T')[0];
  teamOverviewFetchData();
}

// ---- Fetch data ----

async function teamOverviewFetchData() {
  // Reload week view data (day view removed)
  if (typeof raoLoadWeekData === 'function') {
    if (!raoWeekStart) raoWeekStart = raoGetWeekStart();
    raoLoadWeekData();
  }
}

// ============================================================
// PUSH ROUTE — Assign route to technician with date
// ============================================================

async function toShowPushRoute() {
  const [members, routesResp] = await Promise.all([
    toLoadTeamMembers(),
    fetch('/api/ruter', {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    }).then(r => r.json()).catch(() => {
      showToast('Kunne ikke laste ruter', 'error');
      return { success: false, data: [] };
    })
  ]);

  const routes = (routesResp.success ? routesResp.data : []) || [];
  const teamMembers = members || [];

  let routeOptions = '<option value="">Velg rute...</option>';
  routes.forEach(r => {
    routeOptions += `<option value="${r.id}">${escapeHtml(r.navn || 'Rute #' + r.id)}</option>`;
  });

  let memberOptions = '<option value="">Velg teammedlem...</option>';
  teamMembers.forEach(m => {
    memberOptions += `<option value="${m.id}">${escapeHtml(m.navn || '')}</option>`;
  });

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const overlay = document.createElement('div');
  overlay.className = 'to-modal-overlay';
  overlay.id = 'toPushRouteModal';
  overlay.innerHTML = `
    <div class="to-modal-backdrop" data-action="toClosePushRoute"></div>
    <div class="to-modal">
      <div class="to-modal-header">
        <h3>Send rute til teammedlem</h3>
        <button class="btn btn-icon btn-small" data-action="toClosePushRoute"><i class="fas fa-times"></i></button>
      </div>
      <div class="to-modal-body">
        <label class="to-label">Rute</label>
        <select id="toPushRouteSelect" class="to-select">${routeOptions}</select>

        <label class="to-label">Teammedlem</label>
        <select id="toPushMemberSelect" class="to-select">${memberOptions}</select>

        <label class="to-label">Dato</label>
        <div class="to-date-chips">
          <button class="to-chip active" data-action="toSetPushDate" data-args='["${today}"]' data-date="${today}">I dag</button>
          <button class="to-chip" data-action="toSetPushDate" data-args='["${tomorrow}"]' data-date="${tomorrow}">I morgen</button>
          <input type="date" id="toPushDateInput" class="to-date-input" value="${today}" data-on-change="toSetPushDateCustom">
        </div>
      </div>
      <div class="to-modal-footer">
        <button class="btn btn-secondary" data-action="toClosePushRoute">Avbryt</button>
        <button class="btn btn-primary" data-action="toSubmitPushRoute">
          <i class="fas fa-paper-plane"></i> Send rute
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function toSetPushDate(date) {
  document.querySelectorAll('#toPushRouteModal .to-chip').forEach(b => b.classList.remove('active'));
  const chip = document.querySelector(`#toPushRouteModal .to-chip[data-date="${date}"]`);
  if (chip) chip.classList.add('active');
  document.getElementById('toPushDateInput').value = date;
}

function toSetPushDateCustom(el) {
  const date = typeof el === 'string' ? el : el.value;
  document.querySelectorAll('#toPushRouteModal .to-chip').forEach(b => b.classList.remove('active'));
  document.getElementById('toPushDateInput').value = date;
}

function toClosePushRoute() {
  const modal = document.getElementById('toPushRouteModal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 200);
  }
}

async function toSubmitPushRoute() {
  const routeSelect = document.getElementById('toPushRouteSelect');
  const memberSelect = document.getElementById('toPushMemberSelect');
  const routeId = routeSelect?.value;
  const memberId = memberSelect?.value;
  const date = document.getElementById('toPushDateInput')?.value;

  if (!routeId || !memberId) {
    toShowNotice('Velg rute og teammedlem', 'warning');
    return;
  }

  // Capture names before closing modal
  const routeName = routeSelect?.selectedOptions[0]?.textContent || 'Rute';
  const memberName = memberSelect?.selectedOptions[0]?.textContent || 'Teammedlem';

  try {
    const resp = await fetch(`/api/ruter/${routeId}/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
      body: JSON.stringify({ assigned_to: parseInt(memberId, 10), planned_date: date })
    });

    const json = await resp.json();
    if (json.success) {
      toClosePushRoute();
      await teamOverviewFetchData();
      showToast(`Rute tildelt ${memberName}`, 'success');
    } else {
      toShowNotice(json.error || 'Kunne ikke sende ruten', 'error');
    }
  } catch (e) {
    toShowNotice('Feil ved sending av rute', 'error');
  }
}


// ============================================================
// QUICK-ASSIGN — Add customer to existing route
// ============================================================

async function toShowQuickAssign() {
  const overlay = document.createElement('div');
  overlay.className = 'to-modal-overlay';
  overlay.id = 'toQuickAssignModal';
  overlay.innerHTML = `
    <div class="to-modal-backdrop" data-action="toCloseQuickAssign"></div>
    <div class="to-modal">
      <div class="to-modal-header">
        <h3>Legg til kunde i rute</h3>
        <button class="btn btn-icon btn-small" data-action="toCloseQuickAssign"><i class="fas fa-times"></i></button>
      </div>
      <div class="to-modal-body">
        <label class="to-label">Søk etter kunde</label>
        <input type="text" id="toQuickAssignSearch" class="to-input" placeholder="Søk navn, adresse..." data-on-input="toQuickAssignSearchHandler" autocomplete="off">
        <div id="toQuickAssignResults" class="to-search-results"></div>

        <div id="toQuickAssignForm" style="display:none;">
          <div id="toQuickAssignSelected" class="to-selected-card"></div>

          <label class="to-label">Rute</label>
          <select id="toQuickAssignRoute" class="to-select">
            <option value="">Velg rute...</option>
          </select>
        </div>
      </div>
      <div class="to-modal-footer">
        <button class="btn btn-secondary" data-action="toCloseQuickAssign">Avbryt</button>
        <button class="btn btn-primary" id="toQuickAssignSubmitBtn" data-action="toSubmitQuickAssign" disabled>
          <i class="fas fa-plus-circle"></i> Legg til
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  // Load routes dropdown
  try {
    const resp = await fetch('/api/ruter', {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    const routes = (json.success ? json.data : []) || [];
    const select = document.getElementById('toQuickAssignRoute');
    if (select) {
      routes.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.navn || `Rute #${r.id}`;
        select.appendChild(opt);
      });
    }
  } catch (e) { /* ignore */ }

  document.getElementById('toQuickAssignSearch')?.focus();
}

function toQuickAssignSearchHandler(query) {
  if (toSearchTimer) clearTimeout(toSearchTimer);
  if (!query || query.length < 2) {
    const resultsDiv = document.getElementById('toQuickAssignResults');
    if (resultsDiv) resultsDiv.innerHTML = '';
    return;
  }
  toSearchTimer = setTimeout(() => toQuickAssignDoSearch(query), 300);
}

async function toQuickAssignDoSearch(query) {
  const resultsDiv = document.getElementById('toQuickAssignResults');
  if (!resultsDiv) return;

  if (toSearchAbort) toSearchAbort.abort();
  toSearchAbort = new AbortController();

  try {
    const resp = await fetch(`/api/kunder?search=${encodeURIComponent(query)}&limit=10`, {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
      signal: toSearchAbort.signal
    });
    const json = await resp.json();
    const rawData = json.success ? json.data : json;
    toSearchResults = Array.isArray(rawData) ? rawData : (rawData?.data || []);

    if (toSearchResults.length === 0) {
      resultsDiv.innerHTML = '<div class="to-search-empty">Ingen treff</div>';
      return;
    }

    let html = '';
    toSearchResults.forEach(k => {
      const address = [k.adresse, k.poststed].filter(Boolean).join(', ');
      html += `
        <div class="to-search-row" data-action="toSelectQuickAssignKunde" data-args='[${k.id}]'>
          <div>
            <strong>${escapeHtml(k.navn)}</strong>
            ${address ? `<br><span class="to-search-addr">${escapeHtml(address)}</span>` : ''}
          </div>
          <i class="fas fa-chevron-right"></i>
        </div>
      `;
    });
    resultsDiv.innerHTML = html;
  } catch (e) {
    if (e.name === 'AbortError') return;
    resultsDiv.innerHTML = '<div class="to-search-empty">Feil ved søk</div>';
  }
}

function toSelectQuickAssignKunde(kundeId) {
  const kunde = toSearchResults.find(k => k.id === kundeId);
  if (!kunde) return;

  const selectedDiv = document.getElementById('toQuickAssignSelected');
  if (selectedDiv) {
    selectedDiv.innerHTML = `
      <span>${escapeHtml(kunde.navn)}</span>
      <button class="btn btn-icon btn-small" data-action="toClearQuickAssignSelection" title="Fjern">
        <i class="fas fa-times"></i>
      </button>
    `;
    selectedDiv.dataset.kundeId = kundeId;
  }

  const form = document.getElementById('toQuickAssignForm');
  if (form) form.style.display = 'block';
  const btn = document.getElementById('toQuickAssignSubmitBtn');
  if (btn) btn.disabled = false;
  const results = document.getElementById('toQuickAssignResults');
  if (results) results.innerHTML = '';
  const search = document.getElementById('toQuickAssignSearch');
  if (search) search.value = '';
}

function toClearQuickAssignSelection() {
  const selectedDiv = document.getElementById('toQuickAssignSelected');
  if (selectedDiv) { selectedDiv.innerHTML = ''; selectedDiv.dataset.kundeId = ''; }
  const form = document.getElementById('toQuickAssignForm');
  if (form) form.style.display = 'none';
  const btn = document.getElementById('toQuickAssignSubmitBtn');
  if (btn) btn.disabled = true;
}

function toCloseQuickAssign() {
  const modal = document.getElementById('toQuickAssignModal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 200);
  }
}

async function toSubmitQuickAssign() {
  const kundeId = document.getElementById('toQuickAssignSelected')?.dataset?.kundeId;
  const routeId = document.getElementById('toQuickAssignRoute')?.value;

  if (!kundeId || !routeId) {
    toShowNotice('Velg kunde og rute', 'warning');
    return;
  }

  try {
    const resp = await fetch(`/api/ruter/${routeId}/add-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
      body: JSON.stringify({ kunde_id: parseInt(kundeId, 10) })
    });

    const json = await resp.json();
    if (json.success) {
      toShowNotice('Kunde lagt til i ruten!', 'success');
      toCloseQuickAssign();
      teamOverviewFetchData();
    } else {
      toShowNotice(json.error || 'Kunne ikke legge til kunde', 'error');
    }
  } catch (e) {
    toShowNotice('Feil ved tilordning', 'error');
  }
}

// ============================================================
// CUSTOMER LOOKUP — Quick customer search + history/details
// ============================================================

function toShowCustomerLookup() {
  const overlay = document.createElement('div');
  overlay.className = 'to-modal-overlay';
  overlay.id = 'toCustomerLookupModal';
  overlay.innerHTML = `
    <div class="to-modal-backdrop" data-action="toCloseCustomerLookup"></div>
    <div class="to-modal to-modal-wide">
      <div class="to-modal-header">
        <h3>Kundeoppslag</h3>
        <button class="btn btn-icon btn-small" data-action="toCloseCustomerLookup"><i class="fas fa-times"></i></button>
      </div>
      <div class="to-modal-body">
        <input type="text" id="toCustomerLookupSearch" class="to-input" placeholder="Søk etter kunde (navn, adresse)..." data-on-input="toCustomerLookupSearchHandler" autocomplete="off">
        <div id="toCustomerLookupResults" class="to-search-results">
          <div class="to-search-empty"><i class="fas fa-address-book"></i><br>Søk etter en kunde for å se detaljer og historikk.</div>
        </div>
        <div id="toCustomerLookupDetail" style="display:none;"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  document.getElementById('toCustomerLookupSearch')?.focus();
}

function toCloseCustomerLookup() {
  const modal = document.getElementById('toCustomerLookupModal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 200);
  }
}

let toCustomerSearchTimer = null;

function toCustomerLookupSearchHandler(query) {
  if (toCustomerSearchTimer) clearTimeout(toCustomerSearchTimer);
  // Hide detail, show results
  const detail = document.getElementById('toCustomerLookupDetail');
  if (detail) detail.style.display = 'none';
  const results = document.getElementById('toCustomerLookupResults');
  if (results) results.style.display = '';

  if (!query || query.length < 2) {
    if (results) results.innerHTML = '<div class="to-search-empty"><i class="fas fa-address-book"></i><br>Søk etter en kunde for å se detaljer og historikk.</div>';
    return;
  }
  toCustomerSearchTimer = setTimeout(() => toCustomerLookupDoSearch(query), 300);
}

async function toCustomerLookupDoSearch(query) {
  const resultsDiv = document.getElementById('toCustomerLookupResults');
  if (!resultsDiv) return;

  resultsDiv.innerHTML = '<div class="to-search-empty"><i class="fas fa-spinner fa-spin"></i></div>';

  try {
    const resp = await fetch(`/api/kunder?search=${encodeURIComponent(query)}&limit=20`, {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    const rawData = json.success ? json.data : json;
    const kunder = Array.isArray(rawData) ? rawData : (rawData?.data || []);

    if (kunder.length === 0) {
      resultsDiv.innerHTML = '<div class="to-search-empty">Ingen kunder funnet.</div>';
      return;
    }

    let html = '';
    kunder.forEach(k => {
      const address = [k.adresse, k.poststed].filter(Boolean).join(', ');
      html += `
        <div class="to-search-row to-customer-row" data-action="toShowCustomerDetail" data-args='[${k.id}]'>
          <div>
            <strong>${escapeHtml(k.navn)}</strong>
            ${address ? `<br><span class="to-search-addr">${escapeHtml(address)}</span>` : ''}
          </div>
          <div class="to-customer-row-actions">
            ${k.telefon ? `<a href="tel:${escapeHtml(k.telefon)}" class="to-action-icon" data-action="none" data-stop-propagation="true" title="Ring"><i class="fas fa-phone"></i></a>` : ''}
            <i class="fas fa-chevron-right" style="opacity:0.4;"></i>
          </div>
        </div>
      `;
    });
    resultsDiv.innerHTML = html;
  } catch (e) {
    resultsDiv.innerHTML = '<div class="to-search-empty">Feil ved søk. Prøv igjen.</div>';
  }
}

async function toShowCustomerDetail(kundeId) {
  const resultsDiv = document.getElementById('toCustomerLookupResults');
  const detailDiv = document.getElementById('toCustomerLookupDetail');
  if (!detailDiv) return;

  // Hide search results, show detail
  if (resultsDiv) resultsDiv.style.display = 'none';
  detailDiv.style.display = 'block';
  detailDiv.innerHTML = '<div class="to-search-empty"><i class="fas fa-spinner fa-spin"></i></div>';

  try {
    const csrfToken = getCsrfToken();
    const [kundeResp, logResp] = await Promise.all([
      fetch(`/api/kunder/${kundeId}`, {
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'include'
      }).then(r => r.json()),
      fetch(`/api/kontaktlogg/${kundeId}`, {
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'include'
      }).then(r => r.json()).catch(() => ({ success: false, data: [] }))
    ]);

    const kunde = kundeResp.success ? kundeResp.data : kundeResp;
    const logs = (logResp.success ? logResp.data : []) || [];

    if (!kunde) {
      detailDiv.innerHTML = '<div class="to-search-empty">Kunne ikke laste kundeinfo.</div>';
      return;
    }

    const address = [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean).join(', ');

    let html = '';

    // Back button
    html += `<button class="to-back-btn" data-action="toBackToCustomerSearch"><i class="fas fa-arrow-left"></i> Tilbake til søk</button>`;

    // Customer header
    html += `<div class="to-customer-header"><h3>${escapeHtml(kunde.navn)}</h3></div>`;

    // Info rows
    html += '<div class="to-detail-section">';
    if (address) html += `<div class="to-info-row"><i class="fas fa-map-marker-alt"></i><span>${escapeHtml(address)}</span></div>`;
    if (kunde.telefon) html += `<div class="to-info-row"><i class="fas fa-phone"></i><a href="tel:${escapeHtml(kunde.telefon)}">${escapeHtml(kunde.telefon)}</a></div>`;
    if (kunde.epost) html += `<div class="to-info-row"><i class="fas fa-envelope"></i><a href="mailto:${escapeHtml(kunde.epost)}">${escapeHtml(kunde.epost)}</a></div>`;
    if (kunde.kontaktperson) html += `<div class="to-info-row"><i class="fas fa-user"></i><span>${escapeHtml(kunde.kontaktperson)}</span></div>`;
    if (kunde.siste_kontroll) html += `<div class="to-info-row"><i class="fas fa-calendar-check"></i><span>Siste kontroll: ${escapeHtml(new Date(kunde.siste_kontroll).toLocaleDateString('nb-NO'))}</span></div>`;
    if (kunde.neste_kontroll) html += `<div class="to-info-row"><i class="fas fa-calendar-alt"></i><span>Neste kontroll: ${escapeHtml(new Date(kunde.neste_kontroll).toLocaleDateString('nb-NO'))}</span></div>`;
    if (kunde.notater) html += `<div class="to-info-row"><i class="fas fa-sticky-note"></i><span>${escapeHtml(kunde.notater)}</span></div>`;
    html += '</div>';

    // Contact log
    html += '<div class="to-detail-section">';
    html += '<h4>Kontaktlogg</h4>';
    if (logs.length === 0) {
      html += '<p class="to-detail-muted">Ingen kontaktlogg registrert.</p>';
    } else {
      logs.forEach(log => {
        const dateStr = log.opprettet_dato
          ? new Date(log.opprettet_dato).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
          : '';
        const typeIcon = log.type === 'telefon' ? 'fa-phone' : log.type === 'epost' ? 'fa-envelope' : log.type === 'besok' ? 'fa-walking' : 'fa-comment';
        html += `
          <div class="to-log-entry">
            <div class="to-log-icon"><i class="fas ${typeIcon}"></i></div>
            <div class="to-log-content">
              <div class="to-log-date">${escapeHtml(dateStr)}</div>
              <div class="to-log-text">${escapeHtml(log.notat || log.beskrivelse || '')}</div>
              ${log.utfort_av ? `<div class="to-log-by">${escapeHtml(log.utfort_av)}</div>` : ''}
            </div>
          </div>
        `;
      });
    }
    html += '</div>';

    detailDiv.innerHTML = html;
  } catch (e) {
    console.error('Team overview: Error loading customer detail:', e);
    detailDiv.innerHTML = '<div class="to-search-empty">Feil ved lasting av kundeinfo.</div>';
  }
}

function toBackToCustomerSearch() {
  const resultsDiv = document.getElementById('toCustomerLookupResults');
  const detailDiv = document.getElementById('toCustomerLookupDetail');
  if (resultsDiv) resultsDiv.style.display = '';
  if (detailDiv) detailDiv.style.display = 'none';
}

// ============================================================
// HELPERS
// ============================================================

async function toLoadTeamMembers() {
  try {
    const resp = await fetch('/api/team-members', {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    if (json.success && json.data) {
      const members = Array.isArray(json.data) ? json.data : (json.data.members || []);
      return members.filter(m => m.aktiv !== false);
    }
  } catch (e) {
    console.error('Team overview: Could not load team members:', e);
  }
  return [];
}

function teamOverviewToggle(routeId) {
  // Legacy day view toggle — no-op, week view uses raoExpandRoute
}

function teamOverviewGetInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function teamOverviewFormatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
  const months = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
  return `${days[d.getDay()]} ${d.getDate()}. ${months[d.getMonth()]}`;
}

function toOpenWeekplanEditor() {
  if (typeof mfShowWeekplanEditor === 'function') {
    mfShowWeekplanEditor();
  } else if (typeof switchArbeidView === 'function') {
    switchArbeidView('uke');
  }
}

function toShowNotice(message, type) {
  // Reuse mfShowBanner if available (mobile), otherwise create a temp notice
  if (typeof mfShowBanner === 'function') {
    mfShowBanner(message, type);
    return;
  }
  const notice = document.createElement('div');
  notice.className = `to-notice to-notice-${type}`;
  notice.textContent = message;
  document.body.appendChild(notice);
  requestAnimationFrame(() => notice.classList.add('visible'));
  setTimeout(() => {
    notice.classList.remove('visible');
    setTimeout(() => notice.remove(), 300);
  }, 3000);
}

// ============================================================
// SHOW ROUTE ON MAP — Load saved route onto map with focus mode
// ============================================================

async function toShowRouteOnMap(routeId) {
  const route = (teamOverviewData || []).find(r => r.id === routeId);
  if (!route || !route.kunder || route.kunder.length === 0) {
    toShowNotice('Ingen kunder i ruten', 'info');
    return;
  }

  // Build stops from route customers (match with loaded customer data for coordinates)
  const stops = [];
  for (const kunde of route.kunder) {
    // Try to find in loaded customers array for full data (lat/lng)
    const full = (typeof customers !== 'undefined' ? customers : []).find(c => c.id === kunde.id);
    if (full && full.lat && full.lng) {
      stops.push({
        id: full.id,
        navn: full.navn,
        adresse: full.adresse || '',
        lat: full.lat,
        lng: full.lng,
        estimertTid: kunde.estimert_tid || 30
      });
    } else if (kunde.lat && kunde.lng) {
      stops.push({
        id: kunde.id,
        navn: kunde.navn,
        adresse: kunde.adresse || '',
        lat: kunde.lat,
        lng: kunde.lng,
        estimertTid: kunde.estimert_tid || 30
      });
    }
  }

  if (stops.length === 0) {
    toShowNotice('Ingen kunder med koordinater i ruten', 'info');
    return;
  }

  // Get route start (company address)
  const routeStart = (typeof appConfig !== 'undefined' && appConfig.routeStartLat && appConfig.routeStartLng)
    ? { lat: appConfig.routeStartLat, lng: appConfig.routeStartLng }
    : null;

  if (!routeStart) {
    toShowNotice('Sett firmaadresse i admin for å tegne rute', 'warning');
    return;
  }

  // Activate route focus — hide non-route markers
  wpRouteActive = true;
  wpRouteStopIds = new Set(stops.map(s => Number(s.id)));
  wpShowAllMarkers = false;
  applyTeamFocusToMarkers();
  if (typeof refreshClusters === 'function') refreshClusters();

  const loadingToast = typeof showToast === 'function' ? showToast('Beregner rute...', 'info', 0) : null;

  try {
    // Build fallback ETA from cumulative estimertTid (no VROOM data available)
    let cumulativeMin = 0;
    const etaData = stops.map(s => {
      const arrivalMin = 480 + cumulativeMin;
      cumulativeMin += (s.estimertTid || 30);
      const h = Math.floor(arrivalMin / 60);
      const m = arrivalMin % 60;
      return { eta: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, arrivalMin };
    });
    const routeResult = await renderRouteOnMap(stops, routeStart, { etaData });
    if (loadingToast) loadingToast.remove();

    // Store for export
    currentRouteData = { customers: stops, duration: routeResult.drivingSeconds, distance: routeResult.distanceMeters };

    // Show summary panel (reuse weekplan's panel)
    toShowRouteSummaryPanel(route.navn || 'Rute', stops, routeResult.drivingSeconds, routeResult.distanceMeters);
  } catch (err) {
    if (loadingToast) loadingToast.remove();
    console.error('Route rendering failed:', err);
    toShowNotice('Feil ved ruteberegning', 'error');
    wpRouteActive = false;
    wpRouteStopIds = null;
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
  }
}

function toShowRouteSummaryPanel(routeName, stops, drivingSeconds, distanceMeters) {
  const oldPanel = document.getElementById('wpRouteSummary');
  if (oldPanel) oldPanel.remove();

  const drivingMin = Math.round(drivingSeconds / 60);
  const customerMin = stops.reduce((sum, s) => sum + (s.estimertTid || 30), 0);
  const totalMin = drivingMin + customerMin;
  const km = (distanceMeters / 1000).toFixed(1);

  const panel = document.createElement('div');
  panel.id = 'wpRouteSummary';
  panel.className = 'wp-route-summary';
  panel.innerHTML = `
    <div class="wp-route-header">
      <strong>${escapeHtml(routeName)} — ${stops.length} stopp</strong>
      <button class="wp-route-close" data-action="closeWpRoute" aria-label="Fjern">&times;</button>
    </div>
    <div class="wp-route-stats">
      <div class="wp-route-stat">
        <i aria-hidden="true" class="fas fa-car"></i>
        <span>Kjøretid: ~${typeof formatMinutes === 'function' ? formatMinutes(drivingMin) : drivingMin + ' min'}</span>
      </div>
      <div class="wp-route-stat">
        <i aria-hidden="true" class="fas fa-user-clock"></i>
        <span>Hos kunder: ~${typeof formatMinutes === 'function' ? formatMinutes(customerMin) : customerMin + ' min'}</span>
      </div>
      <div class="wp-route-stat total">
        <i aria-hidden="true" class="fas fa-clock"></i>
        <span>Totalt: ~${typeof formatMinutes === 'function' ? formatMinutes(totalMin) : totalMin + ' min'}</span>
      </div>
      <div class="wp-route-stat">
        <i aria-hidden="true" class="fas fa-road"></i>
        <span>${km} km</span>
      </div>
    </div>
    <div class="wp-route-actions">
      <button class="btn btn-small btn-primary" data-action="wpExportMaps">
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

// Expose globals
window.loadTeamOverview = loadTeamOverview;
window.unloadTeamOverview = unloadTeamOverview;
window.teamOverviewPrevDay = teamOverviewPrevDay;
window.teamOverviewNextDay = teamOverviewNextDay;
window.teamOverviewToday = teamOverviewToday;
window.teamOverviewToggle = teamOverviewToggle;
window.toShowPushRoute = toShowPushRoute;
window.toClosePushRoute = toClosePushRoute;
window.toSetPushDate = toSetPushDate;
window.toSetPushDateCustom = toSetPushDateCustom;
window.toSubmitPushRoute = toSubmitPushRoute;
window.toShowQuickAssign = toShowQuickAssign;
window.toCloseQuickAssign = toCloseQuickAssign;
window.toQuickAssignSearchHandler = toQuickAssignSearchHandler;
window.toSelectQuickAssignKunde = toSelectQuickAssignKunde;
window.toClearQuickAssignSelection = toClearQuickAssignSelection;
window.toSubmitQuickAssign = toSubmitQuickAssign;
window.toShowCustomerLookup = toShowCustomerLookup;
window.toCloseCustomerLookup = toCloseCustomerLookup;
window.toCustomerLookupSearchHandler = toCustomerLookupSearchHandler;
window.toShowCustomerDetail = toShowCustomerDetail;
window.toBackToCustomerSearch = toBackToCustomerSearch;
window.toOpenWeekplanEditor = toOpenWeekplanEditor;
window.toShowRouteOnMap = toShowRouteOnMap;

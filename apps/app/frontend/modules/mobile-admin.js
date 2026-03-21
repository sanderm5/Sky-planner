// ============================================
// MOBILE ADMIN — Admin/planner features for mobile field view
// Extends the mobile field view with Team overview, push-route,
// quick-assign, and customer history tabs (admin/bruker only).
// ============================================

let mfTeamDate = new Date().toISOString().split('T')[0];
let mfTeamData = null;
let mfTeamSummary = null;
let mfTeamPollingTimer = null;
let mfTeamMembers = null;
let mfExpandedRouteId = null;
let mfTeamWeekStart = null;
let mfTeamWeekData = null;
let mfTeamExpandedMember = null;
let mfTeamExpandedDay = null;
let mfKunderSearchTimer = null;
let mfKunderResults = [];

// ---- Role detection ----

function mfIsAdmin() {
  const role = localStorage.getItem('userRole');
  const type = localStorage.getItem('userType');
  return role === 'admin' || type === 'bruker';
}

// ---- Tab injection ----

function mfSetupAdminTabs() {
  if (!mfIsAdmin()) return;

  const mfView = document.getElementById('mobileFieldView');
  if (!mfView) return;

  const bottomBar = mfView.querySelector('.mf-bottom-bar');
  if (!bottomBar) return;

  // Check if already injected
  if (mfView.querySelector('#mfTeamView')) return;

  // Create Team tab view
  const teamView = document.createElement('div');
  teamView.className = 'mf-tab-view';
  teamView.id = 'mfTeamView';
  teamView.style.display = 'none';
  teamView.innerHTML = '<div class="mf-team-content" id="mfTeamContent"></div>';

  // Create Kunder tab view
  const kunderView = document.createElement('div');
  kunderView.className = 'mf-tab-view';
  kunderView.id = 'mfKunderView';
  kunderView.style.display = 'none';
  kunderView.innerHTML = '<div class="mf-kunder-content" id="mfKunderContent"></div>';

  // Insert before bottom bar
  mfView.insertBefore(teamView, bottomBar);
  mfView.insertBefore(kunderView, bottomBar);

  // Replace bottom bar with 5 tabs
  bottomBar.classList.add('admin-mode');
  bottomBar.innerHTML = `
    <button class="mf-tab-btn active" data-tab="ukeplan" data-action="mfSwitchTab" data-args='["ukeplan"]' role="tab" aria-label="Ukeplan">
      <i class="fas fa-calendar-week" aria-hidden="true"></i>
      <span>Ukeplan</span>
    </button>
    <button class="mf-tab-btn" data-tab="team" data-action="mfSwitchTab" data-args='["team"]' role="tab" aria-label="Team">
      <i class="fas fa-users" aria-hidden="true"></i>
      <span>Team</span>
    </button>
    <button class="mf-tab-btn" data-tab="map" data-action="mfSwitchTab" data-args='["map"]' role="tab" aria-label="Kart">
      <i class="fas fa-map" aria-hidden="true"></i>
      <span>Kart</span>
    </button>
    <button class="mf-tab-btn" data-tab="kunder" data-action="mfSwitchTab" data-args='["kunder"]' role="tab" aria-label="Kunder">
      <i class="fas fa-address-book" aria-hidden="true"></i>
      <span>Kunder</span>
    </button>
    <button class="mf-tab-btn" data-tab="account" data-action="mfSwitchTab" data-args='["account"]' role="tab" aria-label="Konto">
      <i class="fas fa-user-circle" aria-hidden="true"></i>
      <span>Konto</span>
    </button>
  `;
}

// ---- Team tab switching hooks ----

function mfOnTeamTabShown() {
  if (!mfTeamWeekStart) mfTeamWeekStart = mfGetWeekStart();
  mfLoadTeamWeekData();
  mfStartTeamPolling();
}

function mfOnTeamTabHidden() {
  mfStopTeamPolling();
}

function mfStartTeamPolling() {
  mfStopTeamPolling();
  mfTeamPollingTimer = setInterval(() => {
    mfLoadTeamWeekData();
  }, 30000);
}

function mfStopTeamPolling() {
  if (mfTeamPollingTimer) {
    clearInterval(mfTeamPollingTimer);
    mfTeamPollingTimer = null;
  }
}

function mfGetWeekStart(d) {
  const date = d ? new Date(d) : new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - ((day + 6) % 7));
  return date.toISOString().split('T')[0];
}

function mfTeamPrevWeek() {
  const d = new Date(mfTeamWeekStart);
  d.setDate(d.getDate() - 7);
  mfTeamWeekStart = d.toISOString().split('T')[0];
  mfLoadTeamWeekData();
}

function mfTeamNextWeek() {
  const d = new Date(mfTeamWeekStart);
  d.setDate(d.getDate() + 7);
  mfTeamWeekStart = d.toISOString().split('T')[0];
  mfLoadTeamWeekData();
}

function mfTeamThisWeek() {
  mfTeamWeekStart = mfGetWeekStart();
  mfLoadTeamWeekData();
}

async function mfLoadTeamWeekData() {
  const content = document.getElementById('mfTeamContent');
  if (!content) return;

  if (!mfTeamWeekData) {
    content.innerHTML = '<div class="mf-loading"><i class="fas fa-spinner fa-spin"></i> Laster...</div>';
  }

  try {
    const resp = await fetch(`/api/todays-work/team-overview-week?week_start=${mfTeamWeekStart}`, {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    mfTeamWeekData = (json.success && json.data) ? json.data : null;
  } catch (e) {
    console.error('Mobile team: Could not load week data:', e);
    mfTeamWeekData = null;
  }

  mfRenderTeamWeekView();
}

function mfToggleTeamMember(memberName) {
  if (mfTeamExpandedMember === memberName) {
    mfTeamExpandedMember = null;
    mfTeamExpandedDay = null;
  } else {
    mfTeamExpandedMember = memberName;
    mfTeamExpandedDay = null;
  }
  mfRenderTeamWeekView();
}

function mfToggleTeamDay(memberName, date) {
  if (mfTeamExpandedMember === memberName && mfTeamExpandedDay === date) {
    mfTeamExpandedDay = null;
  } else {
    mfTeamExpandedMember = memberName;
    mfTeamExpandedDay = date;
  }
  mfRenderTeamWeekView();
}

// ---- Team date navigation ----

function mfTeamPrevDay() {
  const d = new Date(mfTeamDate);
  d.setDate(d.getDate() - 1);
  mfTeamDate = d.toISOString().split('T')[0];
  mfLoadTeamData();
}

function mfTeamNextDay() {
  const d = new Date(mfTeamDate);
  d.setDate(d.getDate() + 1);
  mfTeamDate = d.toISOString().split('T')[0];
  mfLoadTeamData();
}

// ---- Load team members ----

async function mfLoadTeamMembers() {
  if (mfTeamMembers) return mfTeamMembers;
  try {
    const resp = await fetch('/api/team-members', {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    if (json.success && json.data) {
      const members = Array.isArray(json.data) ? json.data : (json.data.members || []);
      mfTeamMembers = members.filter(m => m.aktiv);
    }
  } catch (e) {
    console.error('Mobile admin: Could not load team members:', e);
  }
  return mfTeamMembers || [];
}

// ---- Render week-based team view ----

function mfRenderTeamWeekView() {
  const content = document.getElementById('mfTeamContent');
  if (!content) return;

  if (!mfTeamWeekData) {
    content.innerHTML = '<div class="mf-empty-state"><i class="fas fa-calendar-week"></i><p>Ingen data tilgjengelig.</p></div>';
    return;
  }

  const { dates, members, unassigned, summary } = mfTeamWeekData;
  const todayStr = new Date().toISOString().split('T')[0];
  const isThisWeek = mfTeamWeekStart === mfGetWeekStart();
  const TEAM_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#c026d3', '#ca8a04'];
  const dayLabelsShort = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];

  // Week number
  const ws = new Date(mfTeamWeekStart + 'T00:00:00');
  const weekNum = Math.ceil(((ws - new Date(ws.getFullYear(), 0, 1)) / 86400000 + new Date(ws.getFullYear(), 0, 1).getDay() + 1) / 7);

  let html = '';

  // Week navigation
  html += `
    <div class="mf-header mf-team-date-nav">
      <button class="mf-date-nav" data-action="mfTeamPrevWeek" aria-label="Forrige uke">
        <i class="fas fa-chevron-left" aria-hidden="true"></i>
      </button>
      <span class="mf-date-label" data-action="mfTeamThisWeek" style="cursor:pointer;">
        Uke ${weekNum}${isThisWeek ? ' <span style="color:var(--color-accent);font-size:11px;"> — denne uken</span>' : ''}
      </span>
      <button class="mf-date-nav" data-action="mfTeamNextWeek" aria-label="Neste uke">
        <i class="fas fa-chevron-right" aria-hidden="true"></i>
      </button>
    </div>
  `;

  // Summary
  html += `
    <div class="mf-summary-card">
      <div class="mf-summary-stat">
        <span class="mf-summary-num">${summary.total_routes}</span>
        <span>Ruter</span>
      </div>
      <div class="mf-summary-stat">
        <span class="mf-summary-num">${summary.total_customers}</span>
        <span>Kunder</span>
      </div>
      <div class="mf-summary-stat">
        <span class="mf-summary-num">${members.length}</span>
        <span>Teknikere</span>
      </div>
    </div>
  `;

  // Action buttons
  html += `
    <div class="mf-team-actions">
      <button class="mf-btn mf-btn-primary" data-action="mfShowWeekplanEditor">
        <i class="fas fa-calendar-week" aria-hidden="true"></i> Rediger ukeplan
      </button>
      <button class="mf-btn mf-btn-secondary" data-action="mfShowPushRouteSheet">
        <i class="fas fa-paper-plane" aria-hidden="true"></i> Send rute
      </button>
      <button class="mf-btn mf-btn-secondary" data-action="mfShowQuickAssign">
        <i class="fas fa-plus-circle" aria-hidden="true"></i> Legg til kunde
      </button>
    </div>
  `;

  // Team member cards with week overview
  if (members.length === 0) {
    html += '<div class="mf-empty-state"><i class="fas fa-users"></i><p>Ingen teammedlemmer med ruter denne uken.</p></div>';
  } else {
    members.forEach((member, mIdx) => {
      const color = TEAM_COLORS[mIdx % TEAM_COLORS.length];
      const initials = mfGetInitials(member.navn);
      const isExpanded = mfTeamExpandedMember === member.navn;
      const totalStops = dates.reduce((s, d) => {
        const routes = member.days[d] || [];
        return s + routes.reduce((rs, r) => rs + (r.total_count || 0), 0);
      }, 0);

      html += `
        <div class="mf-team-card ${isExpanded ? 'expanded' : ''}" data-action="mfToggleTeamMember" data-args='["${escapeHtml(member.navn)}"]'>
          <div class="mf-team-avatar" style="background:${color}">${escapeHtml(initials)}</div>
          <div class="mf-team-info">
            <h4>${escapeHtml(member.navn)}</h4>
            <p>${totalStops} stopp denne uken</p>
          </div>
          <div class="mf-team-progress">
            <i class="fas fa-chevron-${isExpanded ? 'up' : 'down'}" style="color:var(--color-text-secondary);font-size:12px;"></i>
          </div>
        </div>
      `;

      // Expanded: show each day
      if (isExpanded) {
        html += '<div class="mf-team-week-grid">';
        dates.forEach((date, dIdx) => {
          const routes = member.days[date] || [];
          const dayStops = routes.reduce((s, r) => s + (r.total_count || 0), 0);
          const isToday = date === todayStr;
          const isDayExpanded = mfTeamExpandedDay === date;
          const dayLabel = dayLabelsShort[dIdx] || date.slice(5);
          const dateNum = new Date(date + 'T00:00:00').getDate();

          html += `
            <div class="mf-team-day ${isToday ? 'mf-today' : ''} ${isDayExpanded ? 'expanded' : ''}" data-action="mfToggleTeamDay" data-args='["${escapeHtml(member.navn)}", "${date}"]'>
              <div class="mf-team-day-header">
                <span class="mf-team-day-label">${dayLabel} ${dateNum}.</span>
                <span class="mf-team-day-count">${dayStops > 0 ? dayStops + ' stopp' : '—'}</span>
              </div>
            </div>
          `;

          // Expanded day: show customer stops
          if (isDayExpanded && routes.length > 0) {
            html += '<div class="mf-team-stops">';
            for (const route of routes) {
              if (route.kunder && route.kunder.length > 0) {
                route.kunder.forEach((kunde, ki) => {
                  const isDone = kunde.completed || kunde.execution_ended_at;
                  html += `
                    <div class="mf-team-stop ${isDone ? 'mf-stop-done' : ''}">
                      <span class="mf-team-stop-num">${ki + 1}</span>
                      <span class="mf-team-stop-name">${escapeHtml(kunde.navn || 'Ukjent')}</span>
                      ${isDone ? '<i class="fas fa-check" style="color:var(--color-success);font-size:10px;margin-left:auto;"></i>' : ''}
                    </div>
                  `;
                });
              }
            }
            html += '</div>';
          }
        });
        html += '</div>';
      }
    });
  }

  // Unassigned routes
  const hasUnassigned = dates.some(d => unassigned[d] && unassigned[d].length > 0);
  if (hasUnassigned) {
    const totalUnassigned = dates.reduce((s, d) => s + (unassigned[d]?.length || 0), 0);
    html += `
      <div class="mf-team-section-label">Utildelte ruter (${totalUnassigned})</div>
    `;
    dates.forEach((date, dIdx) => {
      const routes = unassigned[date] || [];
      if (routes.length === 0) return;
      const dayLabel = dayLabelsShort[dIdx] || date.slice(5);
      const dateNum = new Date(date + 'T00:00:00').getDate();
      routes.forEach(route => {
        html += `
          <div class="mf-team-card mf-team-idle">
            <div class="mf-team-avatar mf-avatar-idle"><i class="fas fa-exclamation" style="font-size:11px;"></i></div>
            <div class="mf-team-info">
              <h4>${escapeHtml(route.navn || 'Rute')}</h4>
              <p>${dayLabel} ${dateNum}. — ${route.total_count || 0} stopp</p>
            </div>
          </div>
        `;
      });
    });
  }

  content.innerHTML = html;
}

function mfGetInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function mfExpandTeamRoute(routeId) {
  if (mfExpandedRouteId === routeId) {
    mfExpandedRouteId = null;
  } else {
    mfExpandedRouteId = routeId;
  }
  mfRenderTeamView();
}

// ---- Push Route (bottom sheet) ----

async function mfShowPushRouteSheet() {
  // Load data in parallel
  const [members, routesResp] = await Promise.all([
    mfLoadTeamMembers(),
    fetch('/api/ruter', {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    }).then(r => r.json()).catch(() => ({ success: false, data: [] }))
  ]);

  const routes = (routesResp.success ? routesResp.data : []) || [];
  const teamMembers = members || [];

  // Build route options
  let routeOptions = '<option value="">Velg rute...</option>';
  routes.forEach(r => {
    const name = r.navn || r.name || `Rute #${r.id}`;
    routeOptions += `<option value="${r.id}">${escapeHtml(name)}</option>`;
  });

  // Build team member options
  let memberOptions = '<option value="">Velg teammedlem...</option>';
  teamMembers.forEach(m => {
    const name = m.navn || m.name || '';
    memberOptions += `<option value="${m.id}">${escapeHtml(name)}</option>`;
  });

  // Today / tomorrow helper
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const overlay = document.createElement('div');
  overlay.className = 'mf-bottom-sheet';
  overlay.id = 'mfPushRouteSheet';
  overlay.innerHTML = `
    <div class="mf-sheet-backdrop" data-action="mfClosePushRouteSheet"></div>
    <div class="mf-sheet-content">
      <div class="mf-visit-handle"></div>
      <h3>Send rute til teammedlem</h3>

      <label class="mf-sheet-label">Rute</label>
      <select id="mfPushRouteSelect" class="mf-sheet-select">${routeOptions}</select>

      <label class="mf-sheet-label">Teammedlem</label>
      <select id="mfPushMemberSelect" class="mf-sheet-select">${memberOptions}</select>

      <label class="mf-sheet-label">Dato</label>
      <div class="mf-push-date-row">
        <button class="mf-btn mf-btn-chip mf-push-date-chip active" data-date="${today}" data-action="mfSetPushDate" data-args='["${today}"]'>I dag</button>
        <button class="mf-btn mf-btn-chip mf-push-date-chip" data-date="${tomorrow}" data-action="mfSetPushDate" data-args='["${tomorrow}"]'>I morgen</button>
        <input type="date" id="mfPushDateInput" class="mf-sheet-date" value="${today}" data-on-change="mfSetPushDateCustom">
      </div>

      <button class="mf-btn mf-btn-primary mf-sheet-submit" data-action="mfSubmitPushRoute">
        <i class="fas fa-paper-plane" aria-hidden="true"></i> Send rute
      </button>
    </div>
  `;

  document.getElementById('mobileFieldView').appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function mfSetPushDate(date) {
  document.querySelectorAll('.mf-push-date-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.date === date);
  });
  document.getElementById('mfPushDateInput').value = date;
}

function mfSetPushDateCustom() {
  const date = document.getElementById('mfPushDateInput')?.value || '';
  document.querySelectorAll('.mf-push-date-chip').forEach(b => b.classList.remove('active'));
}

function mfClosePushRouteSheet() {
  const sheet = document.getElementById('mfPushRouteSheet');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 300);
  }
}

async function mfSubmitPushRoute() {
  const routeSelect = document.getElementById('mfPushRouteSelect');
  const memberSelect = document.getElementById('mfPushMemberSelect');
  const routeId = routeSelect?.value;
  const memberId = memberSelect?.value;
  const date = document.getElementById('mfPushDateInput')?.value;

  if (!routeId || !memberId) {
    mfShowBanner('Velg rute og teammedlem', 'warning');
    return;
  }

  const routeName = routeSelect?.selectedOptions[0]?.textContent || 'Rute';
  const memberName = memberSelect?.selectedOptions[0]?.textContent || 'Teammedlem';

  try {
    const csrfToken = getCsrfToken();
    const resp = await fetch(`/api/ruter/${routeId}/assign`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      credentials: 'include',
      body: JSON.stringify({
        assigned_to: parseInt(memberId, 10),
        planned_date: date
      })
    });

    const json = await resp.json();
    if (json.success) {
      mfClosePushRouteSheet();
      // Navigate team overview to the assigned date so the update is visible
      if (date) mfTeamDate = date;
      mfLoadTeamData();
      mfShowBanner(`Rute tildelt ${memberName}`, 'success');
    } else {
      mfShowBanner(json.error || 'Kunne ikke sende ruten', 'error');
    }
  } catch (e) {
    mfShowBanner('Feil ved sending av rute', 'error');
  }
}


// ---- Quick-Assign Customer (bottom sheet) ----

function mfShowQuickAssign() {
  const overlay = document.createElement('div');
  overlay.className = 'mf-bottom-sheet';
  overlay.id = 'mfQuickAssignSheet';
  overlay.innerHTML = `
    <div class="mf-sheet-backdrop" data-action="mfCloseQuickAssign"></div>
    <div class="mf-sheet-content">
      <div class="mf-visit-handle"></div>
      <h3>Legg til kunde i rute</h3>

      <label class="mf-sheet-label">Søk etter kunde</label>
      <input type="text" id="mfQuickAssignSearch" class="mf-search-input" placeholder="Søk navn, adresse..." data-on-input="mfQuickAssignSearchHandler" autocomplete="off">

      <div id="mfQuickAssignResults" class="mf-assign-results"></div>

      <div id="mfQuickAssignForm" class="mf-assign-form" style="display:none;">
        <div id="mfQuickAssignSelected" class="mf-assign-selected"></div>

        <label class="mf-sheet-label">Teammedlem</label>
        <select id="mfQuickAssignMember" class="mf-sheet-select">
          <option value="">Velg teammedlem...</option>
        </select>

        <label class="mf-sheet-label">Rute</label>
        <select id="mfQuickAssignRoute" class="mf-sheet-select">
          <option value="">Velg rute...</option>
        </select>

        <button class="mf-btn mf-btn-primary mf-sheet-submit" data-action="mfSubmitQuickAssign">
          <i class="fas fa-plus-circle" aria-hidden="true"></i> Legg til
        </button>
      </div>
    </div>
  `;

  document.getElementById('mobileFieldView').appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  // Load dropdowns
  mfLoadQuickAssignOptions();
}

async function mfLoadQuickAssignOptions() {
  const [members, routesResp] = await Promise.all([
    mfLoadTeamMembers(),
    fetch('/api/ruter', {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    }).then(r => r.json()).catch(() => ({ success: false, data: [] }))
  ]);

  const memberSelect = document.getElementById('mfQuickAssignMember');
  if (memberSelect && members) {
    members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.navn || m.name || '';
      memberSelect.appendChild(opt);
    });
  }

  const routeSelect = document.getElementById('mfQuickAssignRoute');
  const routes = (routesResp.success ? routesResp.data : []) || [];
  if (routeSelect) {
    routes.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.navn || r.name || `Rute #${r.id}`;
      routeSelect.appendChild(opt);
    });
  }
}

function mfQuickAssignSearchHandler(query) {
  if (mfKunderSearchTimer) clearTimeout(mfKunderSearchTimer);
  if (!query || query.length < 2) {
    const resultsDiv = document.getElementById('mfQuickAssignResults');
    if (resultsDiv) resultsDiv.innerHTML = '';
    return;
  }
  mfKunderSearchTimer = setTimeout(() => mfQuickAssignDoSearch(query), 300);
}

async function mfQuickAssignDoSearch(query) {
  const resultsDiv = document.getElementById('mfQuickAssignResults');
  if (!resultsDiv) return;

  try {
    const resp = await fetch(`/api/kunder?search=${encodeURIComponent(query)}&limit=10`, {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    // Paginated response: json.data is { data: [...], total, pagination }
    const rawData = json.success ? json.data : json;
    mfKunderResults = Array.isArray(rawData) ? rawData : (rawData?.data || []);

    if (mfKunderResults.length === 0) {
      resultsDiv.innerHTML = '<p class="mf-assign-empty">Ingen treff</p>';
      return;
    }

    let html = '';
    mfKunderResults.forEach(k => {
      const address = [k.adresse, k.poststed].filter(Boolean).join(', ');
      html += `
        <div class="mf-assign-row" data-action="mfSelectQuickAssignKunde" data-args='[${k.id}]'>
          <div class="mf-assign-row-info">
            <strong>${escapeHtml(k.navn)}</strong>
            ${address ? `<span>${escapeHtml(address)}</span>` : ''}
          </div>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </div>
      `;
    });
    resultsDiv.innerHTML = html;
  } catch (e) {
    resultsDiv.innerHTML = '<p class="mf-assign-empty">Feil ved søk</p>';
  }
}

function mfSelectQuickAssignKunde(kundeId) {
  const kunde = mfKunderResults.find(k => k.id === kundeId);
  if (!kunde) return;

  const selectedDiv = document.getElementById('mfQuickAssignSelected');
  if (selectedDiv) {
    selectedDiv.innerHTML = `
      <div class="mf-assign-selected-card">
        <strong>${escapeHtml(kunde.navn)}</strong>
        <button class="mf-info-close" data-action="mfClearQuickAssignSelection" aria-label="Fjern">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
    `;
    selectedDiv.dataset.kundeId = kundeId;
  }

  const form = document.getElementById('mfQuickAssignForm');
  if (form) form.style.display = 'block';

  const results = document.getElementById('mfQuickAssignResults');
  if (results) results.innerHTML = '';

  const search = document.getElementById('mfQuickAssignSearch');
  if (search) search.value = '';
}

function mfClearQuickAssignSelection() {
  const selectedDiv = document.getElementById('mfQuickAssignSelected');
  if (selectedDiv) {
    selectedDiv.innerHTML = '';
    selectedDiv.dataset.kundeId = '';
  }
  const form = document.getElementById('mfQuickAssignForm');
  if (form) form.style.display = 'none';
}

function mfCloseQuickAssign() {
  const sheet = document.getElementById('mfQuickAssignSheet');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 300);
  }
}

async function mfSubmitQuickAssign() {
  const kundeId = document.getElementById('mfQuickAssignSelected')?.dataset?.kundeId;
  const routeId = document.getElementById('mfQuickAssignRoute')?.value;

  if (!kundeId || !routeId) {
    mfShowBanner('Velg kunde og rute', 'warning');
    return;
  }

  try {
    const csrfToken = getCsrfToken();
    const resp = await fetch(`/api/ruter/${routeId}/add-customer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      credentials: 'include',
      body: JSON.stringify({ kunde_id: parseInt(kundeId, 10) })
    });

    const json = await resp.json();
    if (json.success) {
      mfShowBanner('Kunde lagt til i ruten!', 'success');
      mfCloseQuickAssign();
      mfLoadTeamData();
    } else {
      mfShowBanner(json.error || 'Kunne ikke legge til kunde', 'error');
    }
  } catch (e) {
    mfShowBanner('Feil ved tilordning', 'error');
  }
}

// ---- Kunder (Customer History) tab ----

function mfRenderKunderView() {
  const content = document.getElementById('mfKunderContent');
  if (!content) return;

  content.innerHTML = `
    <div class="mf-kunder-search-bar">
      <i class="fas fa-search" aria-hidden="true"></i>
      <input type="text" id="mfKunderSearchInput" class="mf-search-input" placeholder="Søk kunde..." data-on-input="mfKunderSearchHandler" autocomplete="off">
    </div>
    <div id="mfKunderResultsList" class="mf-kunder-results">
      <div class="mf-empty-state">
        <i class="fas fa-address-book" aria-hidden="true"></i>
        <p>Søk etter en kunde for å se historikk.</p>
      </div>
    </div>
  `;
}

function mfKunderSearchHandler(query) {
  if (mfKunderSearchTimer) clearTimeout(mfKunderSearchTimer);
  if (!query || query.length < 2) {
    const list = document.getElementById('mfKunderResultsList');
    if (list) {
      list.innerHTML = `
        <div class="mf-empty-state">
          <i class="fas fa-address-book" aria-hidden="true"></i>
          <p>Søk etter en kunde for å se historikk.</p>
        </div>
      `;
    }
    return;
  }
  mfKunderSearchTimer = setTimeout(() => mfKunderDoSearch(query), 300);
}

async function mfKunderDoSearch(query) {
  const list = document.getElementById('mfKunderResultsList');
  if (!list) return;

  list.innerHTML = '<div class="mf-loading"><div class="mf-spinner"></div></div>';

  try {
    const resp = await fetch(`/api/kunder?search=${encodeURIComponent(query)}&limit=20`, {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    // Paginated response: json.data is { data: [...], total, pagination }
    const rawData = json.success ? json.data : json;
    const kunder = Array.isArray(rawData) ? rawData : (rawData?.data || []);

    if (kunder.length === 0) {
      list.innerHTML = `
        <div class="mf-empty-state">
          <i class="fas fa-search" aria-hidden="true"></i>
          <p>Ingen kunder funnet.</p>
        </div>
      `;
      return;
    }

    let html = '';
    kunder.forEach(k => {
      const address = [k.adresse, k.poststed].filter(Boolean).join(', ');
      html += `
        <div class="mf-kunder-card" data-action="mfShowCustomerHistory" data-args='[${k.id}]'>
          <div class="mf-kunder-card-info">
            <h4>${escapeHtml(k.navn)}</h4>
            ${address ? `<p>${escapeHtml(address)}</p>` : ''}
          </div>
          ${k.telefon ? `<a href="tel:${escapeHtml(k.telefon)}" class="mf-action-btn" data-action="none" data-stop-propagation="true" title="Ring"><i class="fas fa-phone" aria-hidden="true"></i></a>` : ''}
          <i class="fas fa-chevron-right mf-kunder-chevron" aria-hidden="true"></i>
        </div>
      `;
    });
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = `
      <div class="mf-empty-state">
        <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
        <p>Feil ved søk. Prøv igjen.</p>
      </div>
    `;
  }
}

async function mfShowCustomerHistory(kundeId) {
  const overlay = document.createElement('div');
  overlay.className = 'mf-history-overlay';
  overlay.innerHTML = `
    <div class="mf-history-card">
      <div class="mf-info-header">
        <h3>Laster...</h3>
        <button class="mf-info-close" aria-label="Lukk"><i class="fas fa-times" aria-hidden="true"></i></button>
      </div>
      <div class="mf-history-body">
        <div class="mf-loading"><div class="mf-spinner"></div></div>
      </div>
    </div>
  `;

  document.getElementById('mobileFieldView').appendChild(overlay);

  // Close handlers
  const closeBtn = overlay.querySelector('.mf-info-close');
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  try {
    // Load customer details and contact log in parallel
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
      overlay.remove();
      mfShowBanner('Kunne ikke laste kundeinfo', 'error');
      return;
    }

    const header = overlay.querySelector('.mf-info-header h3');
    if (header) header.textContent = kunde.navn || 'Ukjent kunde';

    const body = overlay.querySelector('.mf-history-body');
    if (!body) return;

    const address = [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean).join(', ');

    let html = '';

    // Customer info section
    html += '<div class="mf-history-section">';
    if (address) html += `<div class="mf-info-row"><i class="fas fa-map-marker-alt" aria-hidden="true"></i><span>${escapeHtml(address)}</span></div>`;
    if (kunde.telefon) html += `<div class="mf-info-row"><i class="fas fa-phone" aria-hidden="true"></i><a href="tel:${escapeHtml(kunde.telefon)}">${escapeHtml(kunde.telefon)}</a></div>`;
    if (kunde.epost) html += `<div class="mf-info-row"><i class="fas fa-envelope" aria-hidden="true"></i><a href="mailto:${escapeHtml(kunde.epost)}">${escapeHtml(kunde.epost)}</a></div>`;
    if (kunde.kontaktperson) html += `<div class="mf-info-row"><i class="fas fa-user" aria-hidden="true"></i><span>${escapeHtml(kunde.kontaktperson)}</span></div>`;
    if (kunde.siste_kontroll) html += `<div class="mf-info-row"><i class="fas fa-calendar-check" aria-hidden="true"></i><span>Siste kontroll: ${escapeHtml(new Date(kunde.siste_kontroll).toLocaleDateString('nb-NO'))}</span></div>`;
    if (kunde.neste_kontroll) html += `<div class="mf-info-row"><i class="fas fa-calendar-alt" aria-hidden="true"></i><span>Neste kontroll: ${escapeHtml(new Date(kunde.neste_kontroll).toLocaleDateString('nb-NO'))}</span></div>`;
    html += '</div>';

    // Contact log section
    html += '<div class="mf-history-section">';
    html += '<h4>Kontaktlogg</h4>';
    if (logs.length === 0) {
      html += '<p class="mf-history-empty">Ingen kontaktlogg registrert.</p>';
    } else {
      logs.forEach(log => {
        const dateStr = log.opprettet_dato
          ? new Date(log.opprettet_dato).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
          : '';
        const typeIcon = log.type === 'telefon' ? 'fa-phone' : log.type === 'epost' ? 'fa-envelope' : log.type === 'besok' ? 'fa-walking' : 'fa-comment';
        html += `
          <div class="mf-history-entry">
            <div class="mf-history-entry-icon"><i class="fas ${typeIcon}" aria-hidden="true"></i></div>
            <div class="mf-history-entry-content">
              <div class="mf-history-entry-date">${escapeHtml(dateStr)}</div>
              <div class="mf-history-entry-text">${escapeHtml(log.notat || log.beskrivelse || '')}</div>
              ${log.utfort_av ? `<div class="mf-history-entry-by">${escapeHtml(log.utfort_av)}</div>` : ''}
            </div>
          </div>
        `;
      });
    }
    html += '</div>';

    body.innerHTML = html;
  } catch (e) {
    console.error('Mobile admin: Error loading customer history:', e);
    overlay.remove();
    mfShowBanner('Kunne ikke laste kundehistorikk', 'error');
  }
}

// ---- WebSocket handler for admin views ----

function handleMobileAdminRealtimeUpdate(message) {
  if (!mfIsAdmin()) return;
  const teamView = document.getElementById('mfTeamView');
  if (!teamView || teamView.style.display === 'none') return;

  const { type } = message;
  switch (type) {
    case 'rute_created':
    case 'rute_updated':
    case 'rute_deleted':
      mfLoadTeamData();
      break;
  }
}

// ---- Cleanup ----

function mfAdminCleanup() {
  mfStopTeamPolling();
  mfTeamData = null;
  mfTeamSummary = null;
  mfTeamMembers = null;
  mfExpandedRouteId = null;
}

// ---- Expose globally ----

window.mfIsAdmin = mfIsAdmin;
window.mfSetupAdminTabs = mfSetupAdminTabs;
window.mfTeamPrevDay = mfTeamPrevDay;
window.mfTeamNextDay = mfTeamNextDay;
window.mfExpandTeamRoute = mfExpandTeamRoute;
window.mfShowPushRouteSheet = mfShowPushRouteSheet;
window.mfClosePushRouteSheet = mfClosePushRouteSheet;
window.mfSetPushDate = mfSetPushDate;
window.mfSetPushDateCustom = mfSetPushDateCustom;
window.mfSubmitPushRoute = mfSubmitPushRoute;
window.mfShowQuickAssign = mfShowQuickAssign;
window.mfCloseQuickAssign = mfCloseQuickAssign;
window.mfSelectQuickAssignKunde = mfSelectQuickAssignKunde;
window.mfClearQuickAssignSelection = mfClearQuickAssignSelection;
window.mfSubmitQuickAssign = mfSubmitQuickAssign;
window.mfRenderKunderView = mfRenderKunderView;
window.mfKunderSearchHandler = mfKunderSearchHandler;
window.mfShowCustomerHistory = mfShowCustomerHistory;
window.mfQuickAssignSearchHandler = mfQuickAssignSearchHandler;
window.mfAdminCleanup = mfAdminCleanup;
window.mfOnTeamTabShown = mfOnTeamTabShown;
window.mfOnTeamTabHidden = mfOnTeamTabHidden;
window.handleMobileAdminRealtimeUpdate = handleMobileAdminRealtimeUpdate;

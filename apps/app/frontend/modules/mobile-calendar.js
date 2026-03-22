// ============================================
// MOBILE CALENDAR — Agenda view for mobile field view
// Adds a Calendar tab to the bottom bar for ALL users.
// Shows upcoming appointments as a day-grouped list.
// ============================================

let mfCalAvtaler = [];
let mfCalLoading = false;
let mfCalTeamCache = null;

// ---- Tab injection ----

function mfSetupCalendarTab() {
  const mfView = document.getElementById('mobileFieldView');
  if (!mfView) return;

  const bottomBar = mfView.querySelector('.mf-bottom-bar');
  if (!bottomBar) return;

  // Check if already injected
  if (mfView.querySelector('#mfCalendarView')) return;

  // Create Calendar tab view container
  const calendarView = document.createElement('div');
  calendarView.className = 'mf-tab-view';
  calendarView.id = 'mfCalendarView';
  calendarView.style.display = 'none';
  calendarView.innerHTML = '<div class="mf-calendar-content" id="mfCalendarContent"></div>';

  // Insert before bottom bar
  mfView.insertBefore(calendarView, bottomBar);

  // Add Calendar tab button after Map tab
  const mapBtn = bottomBar.querySelector('[data-tab="map"]');
  if (mapBtn) {
    const calBtn = document.createElement('button');
    calBtn.className = 'mf-tab-btn';
    calBtn.dataset.tab = 'calendar';
    calBtn.dataset.action = 'mfSwitchTab';
    calBtn.dataset.args = '["calendar"]';
    calBtn.setAttribute('role', 'tab');
    calBtn.setAttribute('aria-label', 'Kalender');
    calBtn.innerHTML = `
      <i class="fas fa-calendar-alt" aria-hidden="true"></i>
      <span>Kalender</span>
    `;
    mapBtn.parentElement.insertBefore(calBtn, mapBtn.nextElementSibling);
  }
}

// ---- Tab lifecycle ----

function mfOnCalendarTabShown() {
  mfLoadCalendarData();
}

// ---- Load data ----

async function mfLoadCalendarData() {
  if (mfCalLoading) return;
  mfCalLoading = true;

  const content = document.getElementById('mfCalendarContent');
  if (content && mfCalAvtaler.length === 0) {
    content.innerHTML = '<div class="mf-loading"><div class="mf-spinner"></div><p>Laster avtaler...</p></div>';
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
    const csrfToken = getCsrfToken();

    const response = await fetch(`/api/avtaler?start=${today}&end=${endDate}`, {
      headers: { 'X-CSRF-Token': csrfToken },
      credentials: 'include'
    });

    if (!response.ok) {
      mfCalAvtaler = [];
      mfRenderCalendarView();
      return;
    }

    const json = await response.json();
    if (json.success && json.data) {
      mfCalAvtaler = json.data;
    } else {
      mfCalAvtaler = [];
    }
  } catch (err) {
    console.error('Mobile calendar: Error loading appointments:', err);
  } finally {
    mfCalLoading = false;
  }

  mfRenderCalendarView();
}

// ---- Render ----

function mfRenderCalendarView() {
  const content = document.getElementById('mfCalendarContent');
  if (!content) return;

  if (mfCalAvtaler.length === 0) {
    content.innerHTML = `
      <div class="mf-cal-header">
        <h3><i class="fas fa-calendar-alt" aria-hidden="true"></i> Kalender</h3>
        <button class="mf-action-btn" data-action="mfShowNewAvtaleSheet" aria-label="Ny avtale">
          <i class="fas fa-plus" aria-hidden="true"></i>
        </button>
      </div>
      <div class="mf-empty-state">
        <i class="fas fa-calendar-check" aria-hidden="true"></i>
        <p>Ingen avtaler de neste 14 dagene.</p>
      </div>
    `;
    return;
  }

  // Sort by date + time
  const sorted = [...mfCalAvtaler].sort((a, b) => {
    const dateCompare = (a.dato || '').localeCompare(b.dato || '');
    if (dateCompare !== 0) return dateCompare;
    return (a.klokkeslett || '').localeCompare(b.klokkeslett || '');
  });

  // Group by date
  const groups = {};
  for (const avtale of sorted) {
    const date = avtale.dato || 'Ukjent';
    if (!groups[date]) groups[date] = [];
    groups[date].push(avtale);
  }

  let html = `
    <div class="mf-cal-header">
      <h3><i class="fas fa-calendar-alt" aria-hidden="true"></i> Kalender</h3>
      <button class="mf-action-btn" data-action="mfShowNewAvtaleSheet" aria-label="Ny avtale">
        <i class="fas fa-plus" aria-hidden="true"></i>
      </button>
    </div>
  `;

  for (const [date, avtaler] of Object.entries(groups)) {
    const label = mfFormatDateLabel(date);
    html += `<div class="mf-cal-date-header">${escapeHtml(label)}</div>`;

    for (const avtale of avtaler) {
      const isCompleted = avtale.status === 'fullf\u00f8rt';
      const time = avtale.klokkeslett || '';
      const name = avtale.kunde_navn || 'Ingen kunde';
      const desc = avtale.beskrivelse || avtale.type || '';
      const address = [avtale.adresse, avtale.poststed].filter(Boolean).join(', ');

      html += `
        <div class="mf-cal-card ${isCompleted ? 'completed' : ''}">
          <div class="mf-cal-card-left">
            ${time ? `<div class="mf-cal-time">${escapeHtml(time)}</div>` : ''}
            <span class="mf-cal-status ${isCompleted ? 'done' : 'planned'}">${isCompleted ? 'Fullf\u00f8rt' : 'Planlagt'}</span>
          </div>
          <div class="mf-cal-card-info">
            <h4>${escapeHtml(name)}</h4>
            ${desc ? `<p class="mf-cal-desc">${escapeHtml(desc)}</p>` : ''}
            ${address ? `<p class="mf-cal-address"><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${escapeHtml(address)}</p>` : ''}
            ${avtale.opprettet_av ? `<p class="mf-cal-assigned"><i class="fas fa-user" aria-hidden="true"></i> ${escapeHtml(avtale.opprettet_av)}</p>` : ''}
          </div>
          <div class="mf-cal-card-actions">
            ${!isCompleted ? `
              <button class="mf-action-btn mf-action-complete" data-action="mfCompleteAvtale" data-args='[${avtale.id}]' title="Fullf\u00f8r">
                <i class="fas fa-check" aria-hidden="true"></i>
              </button>
            ` : `
              <span class="mf-visited-icon"><i class="fas fa-check-circle" aria-hidden="true"></i></span>
            `}
          </div>
        </div>
      `;
    }
  }

  content.innerHTML = html;
}

// ---- Complete appointment ----

async function mfCompleteAvtale(avtaleId) {
  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/avtaler/${avtaleId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include'
    });

    const json = await response.json();
    if (json.success) {
      if (navigator.vibrate) navigator.vibrate(100);
      mfShowBanner('Avtale markert som fullf\u00f8rt!', 'success');
      // Update locally
      const avtale = mfCalAvtaler.find(a => a.id === avtaleId);
      if (avtale) avtale.status = 'fullf\u00f8rt';
      mfRenderCalendarView();
    } else {
      mfShowBanner(json.error || 'Kunne ikke fullf\u00f8re avtalen', 'error');
    }
  } catch (err) {
    mfShowBanner('Feil ved fullf\u00f8ring av avtale', 'error');
  }
}

// ---- New appointment bottom sheet ----

function mfShowNewAvtaleSheet() {
  const today = new Date().toISOString().split('T')[0];

  const overlay = document.createElement('div');
  overlay.className = 'mf-bottom-sheet';
  overlay.id = 'mfNewAvtaleSheet';
  overlay.innerHTML = `
    <div class="mf-sheet-backdrop" data-action="mfCloseNewAvtaleSheet"></div>
    <div class="mf-sheet-content">
      <div class="mf-visit-handle"></div>
      <h3>Ny avtale</h3>

      <label class="mf-sheet-label">Kunde (s\u00f8k)</label>
      <input type="text" id="mfNewAvtaleKundeSearch" class="mf-search-input" placeholder="S\u00f8k kundenavn..." data-on-input="mfNewAvtaleSearchHandler" autocomplete="off">
      <div id="mfNewAvtaleKundeResults" class="mf-assign-results"></div>
      <div id="mfNewAvtaleKundeSelected" class="mf-assign-selected"></div>

      <label class="mf-sheet-label">Dato</label>
      <input type="date" id="mfNewAvtaleDato" class="mf-sheet-date" value="${today}">

      <label class="mf-sheet-label">Klokkeslett</label>
      <input type="time" id="mfNewAvtaleKlokkeslett" class="mf-sheet-date" value="09:00">

      <label class="mf-sheet-label">Beskrivelse</label>
      <textarea id="mfNewAvtaleBeskrivelse" class="mf-sheet-textarea" rows="3" placeholder="Valgfri beskrivelse..."></textarea>

      <div id="mfNewAvtaleTildeltWrapper" style="display:none">
        <label class="mf-sheet-label">Tildelt</label>
        <select id="mfNewAvtaleTildelt" class="mf-sheet-date">
          <option value="">Meg selv</option>
        </select>
      </div>

      <button class="mf-btn mf-btn-primary mf-sheet-submit" data-action="mfSubmitNewAvtale">
        <i class="fas fa-calendar-plus" aria-hidden="true"></i> Opprett avtale
      </button>
    </div>
  `;

  document.getElementById('mobileFieldView').appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  // Populate team member dropdown (hidden for solo admin)
  mfCalLoadTeamMembers().then(members => {
    const currentEmail = (localStorage.getItem('userEmail') || '').toLowerCase();
    const others = members.filter(m => (m.epost || '').toLowerCase() !== currentEmail);
    if (others.length === 0) return;
    const wrapper = document.getElementById('mfNewAvtaleTildeltWrapper');
    const select = document.getElementById('mfNewAvtaleTildelt');
    if (!wrapper || !select) return;
    wrapper.style.display = '';
    for (const m of others) {
      const opt = document.createElement('option');
      opt.value = m.navn;
      opt.textContent = m.navn;
      select.appendChild(opt);
    }
  });
}

function mfCloseNewAvtaleSheet() {
  const sheet = document.getElementById('mfNewAvtaleSheet');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 300);
  }
}

// Customer search for new appointment
let mfNewAvtaleSearchTimer = null;
let mfNewAvtaleKundeId = null;

function mfNewAvtaleSearchHandler(query) {
  if (mfNewAvtaleSearchTimer) clearTimeout(mfNewAvtaleSearchTimer);
  if (!query || query.length < 2) {
    const results = document.getElementById('mfNewAvtaleKundeResults');
    if (results) results.innerHTML = '';
    return;
  }
  mfNewAvtaleSearchTimer = setTimeout(() => mfNewAvtaleDoSearch(query), 300);
}

async function mfNewAvtaleDoSearch(query) {
  const results = document.getElementById('mfNewAvtaleKundeResults');
  if (!results) return;

  try {
    const resp = await fetch(`/api/kunder?search=${encodeURIComponent(query)}&limit=5`, {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    const rawData = json.success ? json.data : json;
    const kunder = Array.isArray(rawData) ? rawData : (rawData?.data || []);

    if (kunder.length === 0) {
      results.innerHTML = '<p class="mf-assign-empty">Ingen treff</p>';
      return;
    }

    let html = '';
    for (const k of kunder) {
      html += `
        <div class="mf-assign-row" data-action="mfSelectNewAvtaleKunde" data-args='[${k.id}, "${escapeHtml(k.navn).replace(/"/g, '&quot;')}"]'>
          <div class="mf-assign-row-info">
            <strong>${escapeHtml(k.navn)}</strong>
          </div>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </div>
      `;
    }
    results.innerHTML = html;
  } catch (e) {
    results.innerHTML = '<p class="mf-assign-empty">Feil ved s\u00f8k</p>';
  }
}

function mfSelectNewAvtaleKunde(kundeId, kundeName) {
  mfNewAvtaleKundeId = kundeId;

  const selected = document.getElementById('mfNewAvtaleKundeSelected');
  if (selected) {
    selected.innerHTML = `
      <div class="mf-assign-selected-card">
        <strong>${escapeHtml(kundeName)}</strong>
        <button class="mf-info-close" data-action="mfClearNewAvtaleKunde" aria-label="Fjern">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
    `;
  }

  const results = document.getElementById('mfNewAvtaleKundeResults');
  if (results) results.innerHTML = '';
  const search = document.getElementById('mfNewAvtaleKundeSearch');
  if (search) search.value = '';
}

function mfClearNewAvtaleKunde() {
  mfNewAvtaleKundeId = null;
  const selected = document.getElementById('mfNewAvtaleKundeSelected');
  if (selected) selected.innerHTML = '';
}

async function mfSubmitNewAvtale() {
  const dato = document.getElementById('mfNewAvtaleDato')?.value;
  const klokkeslett = document.getElementById('mfNewAvtaleKlokkeslett')?.value;
  const beskrivelse = document.getElementById('mfNewAvtaleBeskrivelse')?.value;

  if (!dato) {
    mfShowBanner('Velg en dato', 'warning');
    return;
  }

  try {
    const csrfToken = getCsrfToken();
    const tildelt = document.getElementById('mfNewAvtaleTildelt')?.value || '';
    const body = {
      dato,
      klokkeslett: klokkeslett || null,
      beskrivelse: beskrivelse || null,
      type: 'Sky Planner',
      kunde_id: mfNewAvtaleKundeId || null,
      opprettet_av: tildelt || (localStorage.getItem('userName') || null)
    };

    const resp = await fetch('/api/avtaler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify(body)
    });

    const json = await resp.json();
    if (json.success) {
      mfShowBanner('Avtale opprettet!', 'success');
      mfCloseNewAvtaleSheet();
      mfNewAvtaleKundeId = null;
      mfLoadCalendarData();
    } else {
      mfShowBanner(json.error || 'Kunne ikke opprette avtalen', 'error');
    }
  } catch (err) {
    mfShowBanner('Feil ved oppretting av avtale', 'error');
  }
}

// ---- Team member loading ----

async function mfCalLoadTeamMembers() {
  if (mfCalTeamCache) return mfCalTeamCache;
  try {
    const resp = await fetch('/api/team-members', {
      headers: { 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include'
    });
    const json = await resp.json();
    const data = json.success && json.data;
    const members = Array.isArray(data?.members) ? data.members : Array.isArray(data) ? data : [];
    mfCalTeamCache = members.filter(m => m.aktiv !== false);
  } catch (e) {
    mfCalTeamCache = [];
  }
  return mfCalTeamCache;
}

// ---- Cleanup ----

function mfCalendarCleanup() {
  mfCalAvtaler = [];
  mfCalLoading = false;
  mfNewAvtaleKundeId = null;
  mfCalTeamCache = null;
}

// ---- Expose globally ----

window.mfSetupCalendarTab = mfSetupCalendarTab;
window.mfOnCalendarTabShown = mfOnCalendarTabShown;
window.mfCompleteAvtale = mfCompleteAvtale;
window.mfShowNewAvtaleSheet = mfShowNewAvtaleSheet;
window.mfCloseNewAvtaleSheet = mfCloseNewAvtaleSheet;
window.mfNewAvtaleSearchHandler = mfNewAvtaleSearchHandler;
window.mfSelectNewAvtaleKunde = mfSelectNewAvtaleKunde;
window.mfClearNewAvtaleKunde = mfClearNewAvtaleKunde;
window.mfSubmitNewAvtale = mfSubmitNewAvtale;
window.mfCalendarCleanup = mfCalendarCleanup;

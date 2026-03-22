// ========================================
// CUSTOMER NOTE POPOVER
// Contextual popover showing notes, huskeliste and contact log
// when clicking a customer stop in RAO or Ukeplan
// ========================================

let cnpActivePopover = null;
let cnpCachedData = {};       // { [kundeId]: { kunde, kontaktlogg, ts } }
let cnpWeekNotes = [];        // batch-loaded ukeplan notes for current RAO week
let cnpWeekStart = null;      // current week start for batch notes
const CNP_CACHE_TTL = 5 * 60 * 1000; // 5 min

const CNP_NOTE_TYPES = [
  { key: 'ring',       label: 'Ring',       icon: 'fa-phone',           color: '#2563eb' },
  { key: 'besok',      label: 'Besøk',      icon: 'fa-wrench',          color: '#16a34a' },
  { key: 'bestill',    label: 'Bestill',     icon: 'fa-box',             color: '#ea580c' },
  { key: 'oppfolging', label: 'Oppfølging',  icon: 'fa-clipboard-check', color: '#9333ea' },
  { key: 'notat',      label: 'Notat',       icon: 'fa-sticky-note',     color: '#64748b' },
];

// ---- Data loading ----

async function cnpLoadWeekNotes(weekStart) {
  if (!weekStart) return;
  cnpWeekStart = weekStart;
  try {
    const resp = await apiFetch(`/api/ukeplan-notater?uke_start=${weekStart}`);
    if (resp.ok) {
      const json = await resp.json();
      cnpWeekNotes = json.success ? (json.data || []) : [];
    } else {
      cnpWeekNotes = [];
    }
  } catch (e) {
    console.error('CNP: Failed to load week notes', e);
    cnpWeekNotes = [];
  }
  cnpMarkStopsWithNotes();
}

function cnpGetCustomerWeekNotes(kundeId) {
  // If weekplan state has notes loaded (in Ukeplan view), prefer those
  if (typeof weekPlanState !== 'undefined' && weekPlanState.notater && weekPlanState.notater.length > 0) {
    return weekPlanState.notater.filter(n => n.kunde_id === kundeId && !n.fullfort);
  }
  return cnpWeekNotes.filter(n => n.kunde_id === kundeId && !n.fullfort);
}

async function cnpFetchCustomerData(kundeId) {
  const cached = cnpCachedData[kundeId];
  if (cached && (Date.now() - cached.ts) < CNP_CACHE_TTL) {
    return cached;
  }

  try {
    const [kundeResp, logResp] = await Promise.all([
      apiFetch(`/api/kunder/${kundeId}`),
      apiFetch(`/api/kunder/${kundeId}/kontaktlogg`)
    ]);

    let kunde = null;
    let kontaktlogg = [];

    if (kundeResp.ok) {
      const kj = await kundeResp.json();
      kunde = kj.success ? kj.data : (kj.kunde || kj);
    }
    if (logResp.ok) {
      const lj = await logResp.json();
      kontaktlogg = (lj.success ? lj.data : lj) || [];
    }

    const entry = { kunde, kontaktlogg: kontaktlogg.slice(0, 5), ts: Date.now() };
    cnpCachedData[kundeId] = entry;
    return entry;
  } catch (e) {
    console.error('CNP: Failed to fetch customer data', e);
    return { kunde: null, kontaktlogg: [], ts: Date.now() };
  }
}

// ---- Note indicators ----

function cnpMarkStopsWithNotes() {
  const indicators = document.querySelectorAll('.cnp-note-indicator');
  indicators.forEach(el => {
    const stopItem = el.closest('[data-kunde-id]');
    if (!stopItem) return;
    const kundeId = parseInt(stopItem.dataset.kundeId, 10);
    const hasNotes = cnpWeekNotes.some(n => n.kunde_id === kundeId && !n.fullfort);
    el.style.display = hasNotes ? 'inline' : 'none';
  });
}

// ---- Popover rendering ----

function cnpRenderContent(kunde, kontaktlogg, weekNotes) {
  const name = kunde?.navn || 'Ukjent kunde';
  let html = `<div class="cnp-header">
    <strong class="cnp-title">${escapeHtml(name)}</strong>
    <button class="cnp-close" data-action="cnpDismissPopover" aria-label="Lukk">&times;</button>
  </div><div class="cnp-body">`;

  // Section 1: Customer note
  if (kunde?.notater) {
    html += `<div class="cnp-section">
      <div class="cnp-section-label"><i class="fas fa-sticky-note" aria-hidden="true"></i> Notat</div>
      <div class="cnp-note-text">${escapeHtml(kunde.notater)}</div>
    </div>`;
  }

  // Section 2: Huskeliste (ukeplan notes)
  if (weekNotes.length > 0) {
    const weekNum = cnpGetWeekNumber(cnpWeekStart || raoWeekStart || weekPlanState?.weekStart);
    html += `<div class="cnp-section">
      <div class="cnp-section-label"><i class="fas fa-clipboard-list" aria-hidden="true"></i> Huskeliste${weekNum ? ` (uke ${weekNum})` : ''}</div>`;
    for (const n of weekNotes) {
      const nt = CNP_NOTE_TYPES.find(t => t.key === n.type) || CNP_NOTE_TYPES[4];
      const assignee = n.tilordnet ? ` <span class="cnp-assignee">${escapeHtml(cnpGetInitials(n.tilordnet))}</span>` : '';
      html += `<div class="cnp-task" style="--cnp-type-color:${nt.color}">
        <i class="fas ${nt.icon}" aria-hidden="true" style="color:${nt.color};width:14px;text-align:center"></i>
        <span class="cnp-task-text">${escapeHtml(n.notat)}</span>${assignee}
      </div>`;
    }
    html += '</div>';
  }

  // Section 3: Recent contact log
  if (kontaktlogg.length > 0) {
    html += `<div class="cnp-section">
      <div class="cnp-section-label"><i class="fas fa-history" aria-hidden="true"></i> Siste kontakt</div>`;
    for (const k of kontaktlogg) {
      const d = k.dato ? new Date(k.dato) : null;
      const dateStr = d ? `${d.getDate()}. ${['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'][d.getMonth()]}` : '';
      html += `<div class="cnp-log-entry">
        <span class="cnp-log-date">${escapeHtml(dateStr)}</span>
        <span class="cnp-log-type">${escapeHtml(k.type || 'Annet')}</span>
        ${k.notat ? `<span class="cnp-log-note">${escapeHtml(k.notat.length > 60 ? k.notat.substring(0, 60) + '...' : k.notat)}</span>` : ''}
      </div>`;
    }
    html += '</div>';
  }

  // Empty state
  if (!kunde?.notater && weekNotes.length === 0 && kontaktlogg.length === 0) {
    html += '<div class="cnp-empty"><i class="fas fa-info-circle" aria-hidden="true"></i> Ingen notater for denne kunden.</div>';
  }

  html += '</div>';

  // Quick-add section (always shown)
  const kundeId = kunde?.id;
  if (kundeId) {
    html += `<div class="cnp-add-section" id="cnpAddSection">
      <button class="cnp-add-btn" data-action="cnpToggleAddForm" data-args='[${kundeId}]'>
        <i class="fas fa-plus" aria-hidden="true"></i> Legg til huskeliste
      </button>
      <div class="cnp-add-form" id="cnpAddForm" style="display:none">
        <div class="cnp-type-pills">
          ${CNP_NOTE_TYPES.map((t, i) => `<button class="cnp-type-pill${i === 0 ? ' active' : ''}" data-action="cnpSelectType" data-args='["${t.key}"]' style="--pill-color:${t.color}" title="${escapeHtml(t.label)}"><i class="fas ${t.icon}" aria-hidden="true"></i></button>`).join('')}
        </div>
        <div class="cnp-input-row">
          <input type="text" class="cnp-input" id="cnpNoteInput" placeholder="Skriv notat..." maxlength="500">
          <button class="cnp-save-btn" data-action="cnpSaveQuickNote" data-args='[${kundeId}]' title="Lagre"><i class="fas fa-check" aria-hidden="true"></i></button>
        </div>
      </div>
    </div>`;
  }

  return html;
}

// ---- Popover show/dismiss ----

async function cnpShowPopover(kundeId, event) {
  // Prevent the click from also triggering raoExpandRoute
  if (event && event.stopPropagation) event.stopPropagation();

  kundeId = parseInt(kundeId, 10);
  if (!kundeId || isNaN(kundeId)) return;

  // Close existing
  cnpDismissPopover();

  // Find anchor element
  const anchor = event?.target?.closest?.('[data-kunde-id]') || event?.target;
  if (!anchor) return;

  // Create popover container
  const popover = document.createElement('div');
  popover.className = 'cnp-popover';
  popover.innerHTML = '<div class="cnp-loading"><i class="fas fa-spinner fa-spin"></i> Laster...</div>';
  document.body.appendChild(popover);
  cnpActivePopover = popover;

  // Position
  cnpPositionPopover(popover, anchor);

  // Attach dismiss listeners
  setTimeout(() => {
    document.addEventListener('mousedown', cnpOutsideClickHandler);
    document.addEventListener('keydown', cnpEscapeHandler);
  }, 10);

  // Fetch data and render
  const data = await cnpFetchCustomerData(kundeId);
  const weekNotes = cnpGetCustomerWeekNotes(kundeId);

  // Check popover still active (user may have clicked away)
  if (cnpActivePopover !== popover) {
    popover.remove();
    return;
  }

  popover.innerHTML = cnpRenderContent(data.kunde, data.kontaktlogg, weekNotes);
  // Reposition after content renders (size may have changed)
  cnpPositionPopover(popover, anchor);
}

function cnpPositionPopover(popover, anchor) {
  const rect = anchor.getBoundingClientRect();
  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    // Bottom sheet on mobile
    popover.classList.add('cnp-mobile');
    popover.style.left = '0';
    popover.style.right = '0';
    popover.style.bottom = '0';
    popover.style.top = 'auto';
    return;
  }

  // Desktop: position to the right of anchor, or left if near right edge
  const popW = 300;
  const popH = popover.offsetHeight || 300;
  const margin = 8;

  let left = rect.right + margin;
  let top = rect.top;

  // Flip left if too close to right edge
  if (left + popW > window.innerWidth - 16) {
    left = rect.left - popW - margin;
  }
  // Clamp left
  if (left < 8) left = 8;

  // Flip up if too close to bottom
  if (top + popH > window.innerHeight - 16) {
    top = window.innerHeight - popH - 16;
  }
  if (top < 8) top = 8;

  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
}

function cnpDismissPopover() {
  if (cnpActivePopover) {
    cnpActivePopover.remove();
    cnpActivePopover = null;
  }
  document.removeEventListener('mousedown', cnpOutsideClickHandler);
  document.removeEventListener('keydown', cnpEscapeHandler);
}

function cnpOutsideClickHandler(e) {
  if (cnpActivePopover && !cnpActivePopover.contains(e.target) && !e.target.closest('[data-action="cnpShowPopover"]')) {
    cnpDismissPopover();
  }
}

function cnpEscapeHandler(e) {
  if (e.key === 'Escape') {
    cnpDismissPopover();
  }
}

// ---- Quick-add note ----

let cnpSelectedType = 'ring';

function cnpToggleAddForm() {
  const form = document.getElementById('cnpAddForm');
  const btn = cnpActivePopover?.querySelector('.cnp-add-btn');
  if (!form) return;
  const showing = form.style.display !== 'none';
  form.style.display = showing ? 'none' : 'block';
  if (btn) btn.style.display = showing ? '' : 'none';
  if (!showing) {
    cnpSelectedType = 'ring';
    const input = document.getElementById('cnpNoteInput');
    if (input) { input.value = ''; input.focus(); }
  }
}

function cnpSelectType(typeKey) {
  cnpSelectedType = typeKey;
  const pills = cnpActivePopover?.querySelectorAll('.cnp-type-pill');
  if (pills) {
    pills.forEach(p => {
      const args = p.dataset.args;
      let key = '';
      try { key = args ? JSON.parse(args)[0] : ''; } catch { /* ignore */ }
      p.classList.toggle('active', key === typeKey);
    });
  }
}

async function cnpSaveQuickNote(kundeId) {
  kundeId = parseInt(kundeId, 10);
  const input = document.getElementById('cnpNoteInput');
  const notat = input?.value?.trim();
  if (!notat) return;

  // Determine current week start
  const weekStart = cnpWeekStart || raoWeekStart || (typeof weekPlanState !== 'undefined' ? weekPlanState.weekStart : null);
  if (!weekStart) {
    console.error('CNP: No week start available');
    return;
  }

  try {
    const resp = await apiFetch('/api/ukeplan-notater', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kunde_id: kundeId,
        uke_start: weekStart,
        notat: notat,
        type: cnpSelectedType
      })
    });

    if (resp.ok) {
      // Invalidate cache and reload
      delete cnpCachedData[kundeId];
      await cnpLoadWeekNotes(weekStart);

      // Also refresh weekplan state if in ukeplan view
      if (typeof wpLoadNotater === 'function') {
        try { await wpLoadNotater(); } catch (_) {}
      }

      // Re-render popover with fresh data
      const anchor = cnpActivePopover?.previousAnchor;
      if (cnpActivePopover) {
        const data = await cnpFetchCustomerData(kundeId);
        const weekNotes = cnpGetCustomerWeekNotes(kundeId);
        cnpActivePopover.innerHTML = cnpRenderContent(data.kunde, data.kontaktlogg, weekNotes);
      }
    }
  } catch (e) {
    console.error('CNP: Failed to save note', e);
  }
}

// ---- Helpers ----

function cnpGetInitials(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.map(p => (p[0] || '').toUpperCase()).join('');
}

function cnpGetWeekNumber(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

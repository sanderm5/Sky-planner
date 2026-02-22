function getAvtaleServiceColor(avtale) {
  const kunde = customers.find(c => c.id === avtale.kunde_id);
  const kategori = kunde?.kategori || avtale.type || '';
  if (!kategori) return null;
  const serviceTypes = serviceTypeRegistry.getAll();
  for (const st of serviceTypes) {
    if (kategori === st.name || kategori.includes(st.name)) return st.color;
  }
  return null;
}

function getAvtaleServiceIcon(avtale) {
  const kunde = customers.find(c => c.id === avtale.kunde_id);
  const kategori = kunde?.kategori || avtale.type || '';
  if (!kategori) return '';
  return serviceTypeRegistry.getIconForCategory(kategori);
}

async function loadAvtaler() {
  try {
    const response = await apiFetch('/api/avtaler');
    if (response.ok) {
      const avtaleResult = await response.json();
      avtaler = avtaleResult.data || avtaleResult;
      // Refresh plan badges on map if weekly plan is active
      if (weekPlanState.weekStart) {
        updateWeekPlanBadges();
      }
    }
  } catch (error) {
    console.error('Error loading avtaler:', error);
  }
}

// Calendar rendering with avtaler support
async function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  if (!container) return;

  // Load avtaler if not already loaded
  if (avtaler.length === 0) {
    await loadAvtaler();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get avtaler for this month
  const monthAvtaler = avtaler.filter(a => {
    const d = new Date(a.dato);
    return d.getMonth() === currentCalendarMonth && d.getFullYear() === currentCalendarYear;
  });

  const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
  const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();

  const monthNames = ['Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Desember'];

  let html = `
    <div class="calendar-header">
      <button class="calendar-nav" id="prevMonth" aria-label="Forrige måned"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
      <h3>${monthNames[currentCalendarMonth]} ${currentCalendarYear}</h3>
      <button class="calendar-nav" id="nextMonth" aria-label="Neste måned"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
      <div style="margin-left:auto;display:flex;gap:4px;">
        <button class="btn btn-small ${calendarViewMode === 'week' ? 'btn-primary' : 'btn-secondary'}" id="toggleWeekView">
          <i class="fas fa-calendar-week" aria-hidden="true"></i> Uke
        </button>
        <button class="btn btn-small btn-primary" id="openCalendarSplit" title="Åpne fullskjerm kalender" aria-label="Åpne fullskjerm kalender">
          <i class="fas fa-expand" aria-hidden="true"></i>
        </button>
        <button class="btn btn-primary calendar-add-btn" id="addAvtaleBtn">
          <i class="fas fa-plus" aria-hidden="true"></i> Ny avtale
        </button>
      </div>
    </div>
    <div class="calendar-grid">
      <div class="calendar-day-header">Man</div>
      <div class="calendar-day-header">Tir</div>
      <div class="calendar-day-header">Ons</div>
      <div class="calendar-day-header">Tor</div>
      <div class="calendar-day-header">Fre</div>
      <div class="calendar-day-header">Lør</div>
      <div class="calendar-day-header">Søn</div>
  `;

  // Adjust for Monday start (European calendar)
  const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;

  // Empty cells before first day
  for (let i = 0; i < adjustedFirstDay; i++) {
    html += '<div class="calendar-day empty"></div>';
  }

  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentCalendarYear}-${String(currentCalendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayAvtaler = monthAvtaler.filter(a => a.dato === dateStr);
    const dayDate = new Date(currentCalendarYear, currentCalendarMonth, day);
    const isToday = dayDate.getTime() === today.getTime();
    const isPast = dayDate < today;
    const hasContent = dayAvtaler.length > 0;

    const areaHint = dayAvtaler.length > 0 ? getAreaTooltip(dayAvtaler) : '';
    const areaCount = dayAvtaler.length > 0 ? getUniqueAreas(dayAvtaler).size : 0;

    html += `
      <div class="calendar-day ${isToday ? 'today' : ''} ${isPast ? 'past' : ''} ${hasContent ? 'has-content' : ''}"
           data-date="${dateStr}" data-action="openDayDetail" role="button" tabindex="0">
        <span class="day-number">${day}</span>
        ${areaCount > 0 ? `<span class="day-area-hint" title="${escapeHtml(areaHint)}">${areaCount} ${areaCount === 1 ? 'omr.' : 'omr.'}</span>` : ''}
        <div class="calendar-events">
          ${dayAvtaler.map(a => {
            const serviceColor = getAvtaleServiceColor(a);
            const serviceIcon = getAvtaleServiceIcon(a);
            const poststed = a.kunder?.poststed || '';
            return `
            <div class="calendar-avtale ${a.status === 'fullført' ? 'completed' : ''}"
                 data-avtale-id="${a.id}"${serviceColor ? ` style="border-left-color:${serviceColor}"` : ''}>
              <div class="avtale-content" data-avtale-id="${a.id}" data-action="editAvtale" role="button" tabindex="0">
                ${serviceIcon ? `<span class="avtale-service-icon">${serviceIcon}</span>` : ''}${a.rute_id ? '<i class="fas fa-route" style="font-size:0.6em;margin-right:2px;color:var(--primary)" title="Fra rute"></i>' : ''}${a.er_gjentakelse || a.original_avtale_id ? '<i class="fas fa-sync-alt" style="font-size:0.6em;margin-right:2px" title="Gjentakende"></i>' : ''}
                ${a.klokkeslett ? `<span class="avtale-time">${a.klokkeslett.substring(0, 5)}</span>` : ''}
                <span class="avtale-kunde">${escapeHtml(a.kunder?.navn || a.kunde_navn || 'Ukjent')}</span>
                ${poststed ? `<span class="avtale-poststed">${escapeHtml(poststed)}</span>` : ''}
                ${a.opprettet_av && a.opprettet_av !== 'admin' ? `<span class="avtale-creator" title="Opprettet av ${escapeHtml(a.opprettet_av)}">${escapeHtml(getCreatorDisplay(a.opprettet_av, true))}</span>` : ''}
              </div>
              <button class="avtale-quick-delete" data-action="quickDeleteAvtale" data-avtale-id="${a.id}" title="Slett avtale" aria-label="Slett avtale"><i class="fas fa-times" aria-hidden="true"></i></button>
            </div>
          `; }).join('')}
        </div>
      </div>
    `;
  }

  html += '</div>';

  // === UKEVISNING ===
  if (calendarViewMode === 'week' && currentWeekStart) {
    // Erstatt månedsgriden med ukevisning
    const weekDayNames = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
    const weekNum = getISOWeekNumber(currentWeekStart);

    html = `
      <div class="calendar-header">
        <button class="calendar-nav" id="prevWeek" aria-label="Forrige uke"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
        <h3>Uke ${weekNum} - ${currentWeekStart.getFullYear()}</h3>
        <button class="calendar-nav" id="nextWeek" aria-label="Neste uke"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
        <div style="margin-left:auto;display:flex;gap:4px;">
          <button class="btn btn-small btn-primary" id="openCalendarSplit" title="Åpne fullskjerm kalender" aria-label="Åpne fullskjerm kalender">
            <i class="fas fa-expand" aria-hidden="true"></i>
          </button>
          <button class="btn btn-small btn-secondary" id="toggleWeekView">
            <i class="fas fa-calendar-alt" aria-hidden="true"></i> Måned
          </button>
          <button class="btn btn-primary calendar-add-btn" id="addAvtaleBtn">
            <i class="fas fa-plus" aria-hidden="true"></i> Ny avtale
          </button>
        </div>
      </div>
      <div class="week-view">
    `;

    let totalWeekMinutes = 0;
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(currentWeekStart);
      dayDate.setDate(currentWeekStart.getDate() + i);
      const dateStr = formatDateISO(dayDate);
      const todayCheck = new Date();
      todayCheck.setHours(0, 0, 0, 0);
      const isToday = dayDate.getTime() === todayCheck.getTime();

      const dayAvtaler = avtaler.filter(a => a.dato === dateStr);

      // Beregn total estimert tid for denne dagen
      let dayMinutes = 0;
      dayAvtaler.forEach(a => {
        const kunde = customers.find(c => c.id === a.kunde_id);
        if (kunde?.estimert_tid) dayMinutes += kunde.estimert_tid;
      });
      totalWeekMinutes += dayMinutes;

      html += `
        <div class="week-day ${isToday ? 'today' : ''}" data-date="${dateStr}">
          <div class="week-day-header">
            <span class="week-day-name">${weekDayNames[i].substring(0, 3)}</span>
            <span class="week-day-date">${dayDate.getDate()}</span>
            ${dayMinutes > 0 ? `<span class="week-day-time">${Math.floor(dayMinutes / 60)}t ${dayMinutes % 60}m</span>` : ''}
          </div>
          ${renderAreaBadges(dayAvtaler)}
          <div class="week-day-content">
            ${dayAvtaler.map(a => {
              const navn = a.kunder?.navn || a.kunde_navn || 'Ukjent';
              const addr = [a.kunder?.adresse || '', a.kunder?.postnummer || '', a.kunder?.poststed || ''].filter(Boolean).join(', ');
              const phone = a.kunder?.telefon || a.telefon || '';
              const creator = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
              const initials = creator ? getCreatorDisplay(creator, true) : '';
              const serviceColor = getAvtaleServiceColor(a);
              const serviceIcon = getAvtaleServiceIcon(a);
              const kunde = customers.find(c => c.id === a.kunde_id);
              const estTid = a.varighet || kunde?.estimert_tid || 0;
              return `
                <div class="week-avtale-card ${a.status === 'fullført' ? 'completed' : ''}" data-avtale-id="${a.id}" data-action="editAvtale" role="button" tabindex="0"${serviceColor ? ` style="border-left-color:${serviceColor}"` : ''}>
                  <div class="week-card-header">
                    ${serviceIcon ? `<span class="avtale-service-icon">${serviceIcon}</span>` : ''}
                    ${initials ? `<span class="week-card-initials" title="${escapeHtml(creator)}">${escapeHtml(initials)}</span>` : ''}
                    <span class="week-card-name">${escapeHtml(navn)}</span>
                    ${estTid ? `<span class="avtale-duration">${estTid}m</span>` : ''}
                    <button class="week-card-delete" data-action="quickDeleteAvtale" data-avtale-id="${a.id}" title="Slett avtale" aria-label="Slett avtale"><i class="fas fa-times" aria-hidden="true"></i></button>
                  </div>
                  ${addr ? `<div class="week-card-addr">${escapeHtml(addr)}</div>` : ''}
                  ${phone ? `<div class="week-card-phone"><i class="fas fa-phone" aria-hidden="true"></i>${escapeHtml(phone)}</div>` : ''}
                  ${a.klokkeslett ? `<div class="week-card-time"><i class="fas fa-clock" aria-hidden="true"></i>${a.klokkeslett.substring(0, 5)}${a.varighet ? ` (${a.varighet}m)` : ''}</div>` : ''}
                </div>
              `;
            }).join('')}
            ${dayAvtaler.length === 0 ? '<div class="week-empty">Ingen avtaler</div>' : ''}
          </div>
          <div class="week-day-add" data-date="${dateStr}" data-action="openDayDetail" role="button" tabindex="0">
            <i class="fas fa-plus" aria-hidden="true"></i> Legg til
          </div>
        </div>
      `;
    }

    html += `</div>`;
    html += `<div class="week-summary"><strong>Total estimert tid denne uken:</strong> ${Math.floor(totalWeekMinutes / 60)}t ${totalWeekMinutes % 60}m</div>`;

    container.innerHTML = html;
    runTabCleanup('calendar');
    // Event listeners legges til nedenfor (felles kode)
  }

  if (calendarViewMode !== 'week') {
  // Upcoming section (kun månedsvisning)
  const upcomingAvtaler = avtaler
    .filter(a => new Date(a.dato) >= today && a.status !== 'fullført')
    .sort((a, b) => {
      const dateCompare = new Date(a.dato) - new Date(b.dato);
      if (dateCompare !== 0) return dateCompare;
      return (a.klokkeslett || '').localeCompare(b.klokkeslett || '');
    })
    .slice(0, 8);

  if (upcomingAvtaler.length > 0) {
    html += `
      <div class="upcoming-section">
        <h4><i class="fas fa-calendar-check"></i> Kommende avtaler</h4>
        <div class="upcoming-list">
          ${upcomingAvtaler.map(a => `
            <div class="upcoming-item" data-avtale-id="${a.id}" data-action="editAvtale" role="button" tabindex="0">
              <div class="upcoming-date">
                <span class="upcoming-day">${new Date(a.dato).getDate()}</span>
                <span class="upcoming-month">${monthNames[new Date(a.dato).getMonth()].substring(0, 3)}</span>
              </div>
              <div class="upcoming-info">
                <strong>${a.er_gjentakelse || a.original_avtale_id ? '<i class="fas fa-sync-alt" style="font-size:0.7em;margin-right:3px" title="Gjentakende"></i>' : ''}${escapeHtml(a.kunder?.navn || a.kunde_navn || 'Ukjent')}</strong>
                <span>${a.klokkeslett ? a.klokkeslett.substring(0, 5) : ''} ${a.type || ''}</span>
                ${a.opprettet_av && a.opprettet_av !== 'admin' ? `<span class="upcoming-creator">Av: ${escapeHtml(getCreatorDisplay(a.opprettet_av))}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  runTabCleanup('calendar');
  } // end if (calendarViewMode !== 'week')

  // Get elements
  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');
  const addBtn = document.getElementById('addAvtaleBtn');

  // Named handlers for cleanup
  const handlePrevMonth = () => {
    currentCalendarMonth--;
    if (currentCalendarMonth < 0) {
      currentCalendarMonth = 11;
      currentCalendarYear--;
    }
    renderCalendar();
  };

  const handleNextMonth = () => {
    currentCalendarMonth++;
    if (currentCalendarMonth > 11) {
      currentCalendarMonth = 0;
      currentCalendarYear++;
    }
    renderCalendar();
  };

  const handleAddAvtale = () => openAvtaleModal();
  const toggleWeekBtn = document.getElementById('toggleWeekView');
  const handleToggleWeek = () => {
    if (calendarViewMode === 'month') {
      calendarViewMode = 'week';
      // Sett ukestart til mandag i inneværende uke
      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      monday.setHours(0, 0, 0, 0);
      currentWeekStart = monday;
    } else {
      calendarViewMode = 'month';
    }
    renderCalendar();
  };

  // Add event listeners
  prevBtn?.addEventListener('click', handlePrevMonth);
  nextBtn?.addEventListener('click', handleNextMonth);
  addBtn?.addEventListener('click', handleAddAvtale);
  toggleWeekBtn?.addEventListener('click', handleToggleWeek);

  // Ukevisning: navigasjonsknapper
  const prevWeekBtn = document.getElementById('prevWeek');
  const nextWeekBtn = document.getElementById('nextWeek');
  const handlePrevWeek = () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    renderCalendar();
  };
  const handleNextWeek = () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    renderCalendar();
  };
  prevWeekBtn?.addEventListener('click', handlePrevWeek);
  nextWeekBtn?.addEventListener('click', handleNextWeek);

  // Open split view
  const splitBtn = document.getElementById('openCalendarSplit');
  const handleOpenSplit = () => openCalendarSplitView();
  splitBtn?.addEventListener('click', handleOpenSplit);

  // Store cleanup function
  tabCleanupFunctions.calendar = () => {
    prevBtn?.removeEventListener('click', handlePrevMonth);
    nextBtn?.removeEventListener('click', handleNextMonth);
    addBtn?.removeEventListener('click', handleAddAvtale);
    toggleWeekBtn?.removeEventListener('click', handleToggleWeek);
    prevWeekBtn?.removeEventListener('click', handlePrevWeek);
    nextWeekBtn?.removeEventListener('click', handleNextWeek);
    splitBtn?.removeEventListener('click', handleOpenSplit);
    closeCalendarSplitView();
  };
}

// ========== SPLIT VIEW: Calendar + Map side-by-side ==========
let splitViewOpen = false;
let splitWeekStart = null;
let splitDividerCleanup = null;
let splitViewState = { activeDay: null }; // ISO date string for active day

function openCalendarSplitView() {
  if (splitViewOpen) return; // Guard against double-open
  const overlay = document.getElementById('calendarSplitOverlay');
  if (!overlay) return;

  // Initialize week start from current calendar week or today
  if (currentWeekStart) {
    splitWeekStart = new Date(currentWeekStart);
  } else {
    const now = new Date();
    const dayOfWeek = now.getDay();
    splitWeekStart = new Date(now);
    splitWeekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    splitWeekStart.setHours(0, 0, 0, 0);
  }

  overlay.classList.remove('hidden');
  splitViewOpen = true;

  // Render content
  renderSplitWeekContent();

  // Navigation
  const prevBtn = document.getElementById('splitPrevWeek');
  const nextBtn = document.getElementById('splitNextWeek');
  const closeBtn = document.getElementById('closeSplitView');
  const addBtn = document.getElementById('addAvtaleSplit');

  const handlePrev = () => { splitWeekStart.setDate(splitWeekStart.getDate() - 7); renderSplitWeekContent(); };
  const handleNext = () => { splitWeekStart.setDate(splitWeekStart.getDate() + 7); renderSplitWeekContent(); };
  const handleClose = () => closeCalendarSplitView();
  const handleAdd = () => openAvtaleModal();

  prevBtn?.addEventListener('click', handlePrev);
  nextBtn?.addEventListener('click', handleNext);
  closeBtn?.addEventListener('click', handleClose);
  addBtn?.addEventListener('click', handleAdd);

  // ESC to close
  const handleEsc = (e) => { if (e.key === 'Escape') closeCalendarSplitView(); };
  document.addEventListener('keydown', handleEsc);

  // Drag divider
  setupSplitDivider();

  // Delegated event handlers for cards
  const content = document.getElementById('calendarSplitContent');
  const handleContentClick = async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'editAvtale') {
      const avtaleId = target.dataset.avtaleId;
      const avtale = avtaler.find(a => String(a.id) === String(avtaleId));
      if (avtale) openAvtaleModal(avtale);
    } else if (action === 'quickDeleteAvtale') {
      e.stopPropagation();
      const avtaleId = Number.parseInt(target.dataset.avtaleId);
      const delAvtale = avtaler.find(a => a.id === avtaleId);
      const delName = delAvtale?.kunder?.navn || delAvtale?.kunde_navn || 'denne avtalen';
      const confirmed = await showConfirm(`Slett avtale for ${delName}?`, 'Bekreft sletting');
      if (!confirmed) return;
      try {
        const delResp = await apiFetch(`/api/avtaler/${avtaleId}`, { method: 'DELETE' });
        if (delResp.ok) {
          showToast('Avtale slettet', 'success');
          await loadAvtaler();
          renderCalendar();
        } else {
          showToast('Kunne ikke slette avtalen', 'error');
        }
      } catch (err) {
        console.error('Error deleting avtale from split view:', err);
        showToast('Kunne ikke slette avtalen', 'error');
      }
    } else if (action === 'openDayDetail') {
      const date = target.dataset.date;
      if (date) openAvtaleModal(null, date);
    } else if (action === 'setSplitActiveDay') {
      e.stopPropagation();
      const clickedDate = target.dataset.date;
      if (splitViewState.activeDay === clickedDate) {
        splitViewState.activeDay = null;
        if (areaSelectMode) toggleAreaSelect();
      } else {
        splitViewState.activeDay = clickedDate;
        if (!areaSelectMode) toggleAreaSelect();
        const d = new Date(clickedDate + 'T00:00:00');
        showToast(`${d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' })} valgt — dra over kunder på kartet`, 'info');
      }
      renderSplitWeekContent();
    } else if (action === 'confirmDay') {
      e.stopPropagation();
      const date = target.dataset.date;
      if (date) showConfirmDayPanel(date);
    } else if (action === 'toggleUpcomingAreas') {
      const body = document.getElementById('splitUpcomingBody');
      if (body) body.classList.toggle('collapsed');
      const chevron = target.querySelector('.split-upcoming-chevron') || target.closest('[data-action]').querySelector('.split-upcoming-chevron');
      if (chevron) chevron.classList.toggle('rotated');
    }
  };
  content?.addEventListener('click', handleContentClick);

  // Store cleanup
  splitDividerCleanup = () => {
    prevBtn?.removeEventListener('click', handlePrev);
    nextBtn?.removeEventListener('click', handleNext);
    closeBtn?.removeEventListener('click', handleClose);
    addBtn?.removeEventListener('click', handleAdd);
    document.removeEventListener('keydown', handleEsc);
    content?.removeEventListener('click', handleContentClick);
  };

  // Invalidate map size so tiles re-render in the visible area
  setTimeout(() => {
    if (window.map) window.map.invalidateSize();
  }, 100);
}

function closeCalendarSplitView() {
  const overlay = document.getElementById('calendarSplitOverlay');
  if (!overlay) return;

  overlay.classList.add('hidden');
  splitViewOpen = false;

  // Deactivate area select if active
  splitViewState.activeDay = null;
  if (areaSelectMode) toggleAreaSelect();

  if (splitDividerCleanup) {
    splitDividerCleanup();
    splitDividerCleanup = null;
  }

  // Reset panel width
  const panel = document.getElementById('calendarSplitPanel');
  if (panel) panel.style.width = '';

  // Invalidate map size
  setTimeout(() => {
    if (window.map) window.map.invalidateSize();
  }, 100);
}

function renderSplitWeekContent() {
  const content = document.getElementById('calendarSplitContent');
  const titleEl = document.getElementById('calendarSplitTitle');
  if (!content || !splitWeekStart) return;

  const weekNum = getISOWeekNumber(splitWeekStart);
  if (titleEl) titleEl.textContent = `Uke ${weekNum} — ${splitWeekStart.getFullYear()}`;

  const weekDayNames = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Upcoming areas panel
  let html = renderUpcomingAreas(splitWeekStart);

  html += '<div class="split-week-grid">';

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(splitWeekStart);
    dayDate.setDate(splitWeekStart.getDate() + i);
    const dateStr = formatDateISO(dayDate);
    const isToday = dayDate.getTime() === today.getTime();
    const isActive = splitViewState.activeDay === dateStr;

    const dayAvtaler = avtaler.filter(a => a.dato === dateStr);

    // Estimate time
    let dayMinutes = 0;
    dayAvtaler.forEach(a => {
      dayMinutes += (a.varighet || 0);
      if (!a.varighet) {
        const kunde = customers.find(c => c.id === a.kunde_id);
        if (kunde?.estimert_tid) dayMinutes += kunde.estimert_tid;
      }
    });

    html += `
      <div class="split-week-day ${isToday ? 'today' : ''} ${isActive ? 'active' : ''}" data-date="${dateStr}">
        <div class="split-week-day-header" data-action="setSplitActiveDay" data-date="${dateStr}" title="${isActive ? 'Klikk for å deaktivere dag' : 'Klikk for å velge dag — dra over kartet for å legge til kunder'}" role="button" tabindex="0">
          <span class="split-day-name">${weekDayNames[i].substring(0, 3)}</span>
          <span class="split-day-date">${dayDate.getDate()}</span>
          ${isActive ? '<i class="fas fa-crosshairs split-active-icon" aria-hidden="true"></i>' : ''}
          ${dayMinutes > 0 ? `<span class="split-day-time">${Math.floor(dayMinutes / 60)}t ${dayMinutes % 60}m</span>` : ''}
          ${dayAvtaler.length > 0 ? `<span class="split-day-count">${dayAvtaler.length} avtale${dayAvtaler.length !== 1 ? 'r' : ''}</span>` : ''}
        </div>
        ${dayAvtaler.length > 0 ? renderAreaBadges(dayAvtaler) : ''}
        <div class="split-day-content">
    `;

    if (dayAvtaler.length === 0) {
      html += '<div class="split-day-empty">Ingen avtaler</div>';
    }

    dayAvtaler.forEach(a => {
      const navn = a.kunder?.navn || a.kunde_navn || 'Ukjent';
      const addr = [a.kunder?.adresse || '', a.kunder?.postnummer || '', a.kunder?.poststed || ''].filter(Boolean).join(', ');
      const phone = a.kunder?.telefon || a.telefon || '';
      const creator = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
      const initials = creator ? getCreatorDisplay(creator, true) : '';
      const serviceColor = getAvtaleServiceColor(a);
      const serviceIcon = getAvtaleServiceIcon(a);
      const kunde = customers.find(c => c.id === a.kunde_id);
      const estTid = a.varighet || kunde?.estimert_tid || 0;

      html += `
        <div class="split-avtale-card ${a.status === 'fullført' ? 'completed' : ''}" data-avtale-id="${a.id}" data-action="editAvtale" role="button" tabindex="0"${serviceColor ? ` style="border-left-color:${serviceColor}"` : ''}>
          <div class="split-card-header">
            ${serviceIcon ? `<span class="avtale-service-icon">${serviceIcon}</span>` : ''}
            ${initials ? `<span class="split-card-initials" title="${escapeHtml(creator)}">${escapeHtml(initials)}</span>` : ''}
            <span class="split-card-name">${escapeHtml(navn)}</span>
            ${estTid ? `<span class="avtale-duration">${estTid}m</span>` : ''}
            <button class="split-card-delete" data-action="quickDeleteAvtale" data-avtale-id="${a.id}" title="Slett avtale" aria-label="Slett avtale"><i class="fas fa-times" aria-hidden="true"></i></button>
          </div>
          ${addr ? `<div class="split-card-addr"><i class="fas fa-map-marker-alt" style="font-size:8px;margin-right:3px;" aria-hidden="true"></i>${escapeHtml(addr)}</div>` : ''}
          ${phone ? `<div class="split-card-phone"><i class="fas fa-phone" aria-hidden="true"></i>${escapeHtml(phone)}</div>` : ''}
          ${a.klokkeslett ? `<div class="split-card-time"><i class="fas fa-clock" aria-hidden="true"></i>${a.klokkeslett.substring(0, 5)}${a.varighet ? ` (${a.varighet}m)` : ''}</div>` : ''}
        </div>
      `;
    });

    const pendingAvtaler = dayAvtaler.filter(a => a.status !== 'fullført');
    html += `
        </div>
        <div class="split-day-footer">
          <div class="split-day-add" data-date="${dateStr}" data-action="openDayDetail" role="button" tabindex="0">
            <i class="fas fa-plus" aria-hidden="true"></i> Legg til
          </div>
          ${pendingAvtaler.length > 0 ? `
          <div class="split-day-confirm" data-date="${dateStr}" data-action="confirmDay" role="button" tabindex="0">
            <i class="fas fa-check-double" aria-hidden="true"></i> Bekreft dag
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  html += '</div>';
  content.innerHTML = html;
}

function renderUpcomingAreas(fromDate) {
  // Look ahead 4 weeks
  const endDate = new Date(fromDate);
  endDate.setDate(endDate.getDate() + 28);
  const fromStr = formatDateISO(fromDate);
  const endStr = formatDateISO(endDate);

  const upcoming = avtaler.filter(a => a.dato >= fromStr && a.dato <= endStr);
  if (upcoming.length === 0) return '';

  const areaMap = new Map();
  upcoming.forEach(a => {
    const area = a.kunder?.poststed || a.poststed || null;
    if (!area) return;
    if (!areaMap.has(area)) {
      areaMap.set(area, { count: 0, dates: new Set(), customers: [], types: {} });
    }
    const group = areaMap.get(area);
    group.count++;
    group.dates.add(a.dato);
    const name = a.kunder?.navn || a.kunde_navn || 'Ukjent';
    if (!group.customers.includes(name)) group.customers.push(name);
    // Track control types
    const kunde = customers.find(c => c.id === a.kunde_id);
    const kat = kunde?.kategori || a.type || '';
    if (kat) {
      group.types[kat] = (group.types[kat] || 0) + 1;
    }
  });

  if (areaMap.size === 0) return '';
  const sorted = Array.from(areaMap.entries()).sort((a, b) => b[1].count - a[1].count);

  return `
    <div class="split-upcoming-areas">
      <div class="split-upcoming-header" data-action="toggleUpcomingAreas" role="button" tabindex="0">
        <i class="fas fa-map-marked-alt" aria-hidden="true"></i>
        <span>Kommende områder (${sorted.length})</span>
        <i class="fas fa-chevron-down split-upcoming-chevron" aria-hidden="true"></i>
      </div>
      <div class="split-upcoming-body" id="splitUpcomingBody">
        ${sorted.slice(0, 10).map(([area, data]) => {
          const typeBadges = Object.entries(data.types).map(([kat, count]) =>
            `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${count} ${escapeHtml(kat)}</span>`
          ).join('');
          return `
          <div class="split-upcoming-item" title="${escapeHtml(data.customers.join(', '))}">
            <div class="split-upcoming-item-top">
              <span class="split-upcoming-area"><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ${escapeHtml(area)}</span>
              <span class="split-upcoming-count">${data.count} avtale${data.count !== 1 ? 'r' : ''}</span>
              <span class="split-upcoming-days">${data.dates.size} dag${data.dates.size !== 1 ? 'er' : ''}</span>
            </div>
            ${typeBadges ? `<div class="split-upcoming-types">${typeBadges}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function showConfirmDayPanel(dateStr) {
  const dayAvtaler = avtaler.filter(a => a.dato === dateStr && a.status !== 'fullført');
  if (dayAvtaler.length === 0) {
    showToast('Ingen ventende avtaler på denne dagen', 'info');
    return;
  }

  const datoLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });

  // Remove existing panel
  document.getElementById('confirmDayPanel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'confirmDayPanel';
  panel.className = 'confirm-day-panel';
  panel.innerHTML = `
    <div class="confirm-day-header">
      <div>
        <strong>Bekreft kontroll — ${escapeHtml(datoLabel)}</strong>
        <div style="font-size:11px;color:var(--color-text-secondary);">${dayAvtaler.length} kunde${dayAvtaler.length !== 1 ? 'r' : ''}</div>
      </div>
      <button class="area-select-close" id="closeConfirmDay" aria-label="Lukk">&times;</button>
    </div>
    <div class="confirm-day-list">
      ${dayAvtaler.map(a => {
        const navn = a.kunder?.navn || a.kunde_navn || 'Ukjent';
        const addr = a.kunder?.poststed || a.poststed || '';
        const kunde = customers.find(c => c.id === a.kunde_id);
        const kategoriInterval = kunde?.kontroll_intervall_mnd || null;
        return `
          <div class="confirm-day-item">
            <div class="confirm-day-item-info">
              <span class="confirm-day-item-name">${escapeHtml(navn)}</span>
              ${addr ? `<span class="confirm-day-item-area">${escapeHtml(addr)}</span>` : ''}
            </div>
            ${kategoriInterval ? `<span class="confirm-day-item-interval" title="Intervall fra kategori">${kategoriInterval} mnd</span>` : ''}
          </div>`;
      }).join('')}
    </div>
    <div class="confirm-day-interval">
      <label style="font-size:12px;font-weight:600;">Kontrollintervall</label>
      <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:4px;">Kunder med eksisterende intervall beholder sitt. Øvrige får verdien under.</div>
      <select id="confirmDayIntervalSelect" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--color-border);background:var(--bg-primary);color:var(--color-text-primary);">
        <option value="6">6 måneder</option>
        <option value="12" selected>12 måneder (1 år)</option>
        <option value="24">24 måneder (2 år)</option>
        <option value="36">36 måneder (3 år)</option>
        <option value="48">48 måneder (4 år)</option>
        <option value="60">60 måneder (5 år)</option>
      </select>
    </div>
    <div class="confirm-day-actions">
      <button class="btn btn-small btn-secondary" id="confirmDayCancel" style="flex:1;">Avbryt</button>
      <button class="btn btn-small btn-success" id="confirmDaySubmit" style="flex:2;">
        <i class="fas fa-check-double" aria-hidden="true"></i> Bekreft ${dayAvtaler.length} kunder
      </button>
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById('closeConfirmDay').addEventListener('click', () => panel.remove());
  document.getElementById('confirmDayCancel').addEventListener('click', () => panel.remove());

  document.getElementById('confirmDaySubmit').addEventListener('click', async () => {
    const submitBtn = document.getElementById('confirmDaySubmit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Bekrefter...';

    const fallbackInterval = Number.parseInt(document.getElementById('confirmDayIntervalSelect').value) || 12;

    // 1. Mark all avtaler as fullført
    let completedCount = 0;
    for (const a of dayAvtaler) {
      try {
        const resp = await apiFetch('/api/avtaler/' + a.id + '/complete', { method: 'POST' });
        if (resp.ok) completedCount++;
      } catch (err) {
        console.error('Error completing avtale:', err);
      }
    }

    // 2. Update kontroll dates for each customer
    const kundeIds = [...new Set(dayAvtaler.map(a => a.kunde_id).filter(Boolean))];
    if (kundeIds.length > 0) {
      const types = [...new Set(dayAvtaler.map(a => a.type).filter(Boolean))];
      const slugs = types.map(t => t.toLowerCase().replace(/\s+/g, '-'));

      try {
        await apiFetch('/api/kunder/mark-visited', {
          method: 'POST',
          body: JSON.stringify({
            kunde_ids: kundeIds,
            visited_date: dateStr,
            service_type_slugs: slugs
          })
        });
      } catch (err) {
        console.error('Error marking visited:', err);
      }

      // For customers without category interval, update kontroll_intervall_mnd
      for (const kundeId of kundeIds) {
        const kunde = customers.find(c => c.id === kundeId);
        if (kunde && !kunde.kontroll_intervall_mnd) {
          try {
            await apiFetch('/api/kunder/' + kundeId, {
              method: 'PUT',
              body: JSON.stringify({ kontroll_intervall_mnd: fallbackInterval })
            });
          } catch (err) {
            console.error('Error updating interval:', err);
          }
        }
      }
    }

    panel.remove();
    showToast(`${completedCount} avtale${completedCount !== 1 ? 'r' : ''} fullført — neste kontroll beregnet`, 'success');

    // Refresh data
    await loadAvtaler();
    await loadCustomers();
    renderCalendar();
    if (splitViewOpen) renderSplitWeekContent();
  });
}

function setupSplitDivider() {
  const divider = document.getElementById('calendarSplitDivider');
  const panel = document.getElementById('calendarSplitPanel');
  const overlay = document.getElementById('calendarSplitOverlay');
  if (!divider || !panel || !overlay) return;

  let isDragging = false;

  const onMouseDown = (e) => {
    isDragging = true;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;
    const overlayRect = overlay.getBoundingClientRect();
    const newWidth = e.clientX - overlayRect.left;
    const minW = 400;
    const maxW = overlayRect.width - 200;
    panel.style.width = Math.max(minW, Math.min(maxW, newWidth)) + 'px';
  };

  const onMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Re-render map
    setTimeout(() => { if (window.map) window.map.invalidateSize(); }, 50);
  };

  divider.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Touch support
  divider.addEventListener('touchstart', (e) => {
    isDragging = true;
    divider.classList.add('dragging');
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const overlayRect = overlay.getBoundingClientRect();
    const newWidth = touch.clientX - overlayRect.left;
    const minW = 400;
    const maxW = overlayRect.width - 200;
    panel.style.width = Math.max(minW, Math.min(maxW, newWidth)) + 'px';
  }, { passive: true });
  document.addEventListener('touchend', onMouseUp);

  // Extend cleanup to remove these listeners
  const existingCleanup = splitDividerCleanup;
  splitDividerCleanup = () => {
    if (existingCleanup) existingCleanup();
    divider.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('touchend', onMouseUp);
  };
}

// Re-render split view when avtaler change (if open)
const _origLoadAvtaler = loadAvtaler;
loadAvtaler = async function() {
  await _origLoadAvtaler();
  if (splitViewOpen) renderSplitWeekContent();
};

// Avtale modal functions
function openAvtaleModal(avtale = null, preselectedDate = null) {
  const modal = document.getElementById('avtaleModal');
  const form = document.getElementById('avtaleForm');
  const title = document.getElementById('avtaleModalTitle');
  const deleteBtn = document.getElementById('deleteAvtaleBtn');
  const deleteSeriesBtn = document.getElementById('deleteAvtaleSeriesBtn');
  const kundeSearch = document.getElementById('avtaleKundeSearch');
  const kundeInput = document.getElementById('avtaleKunde');
  const kundeResults = document.getElementById('avtaleKundeResults');
  const avtaleTypeSelect = document.getElementById('avtaleType');
  const gjentakelseSelect = document.getElementById('avtaleGjentakelse');
  const gjentakelseSluttGroup = document.getElementById('avtaleGjentakelseSluttGroup');
  const gjentakelseGroup = document.getElementById('avtaleGjentakelseGroup');

  // Populate type dropdown dynamically from ServiceTypeRegistry
  if (avtaleTypeSelect) {
    avtaleTypeSelect.innerHTML = serviceTypeRegistry.renderCategoryOptions('');
  }

  // Clear search field
  kundeSearch.value = '';
  kundeInput.value = '';
  kundeResults.innerHTML = '';
  kundeResults.classList.remove('active');

  // Toggle gjentakelse slutt visibility
  gjentakelseSelect.onchange = function() {
    gjentakelseSluttGroup.classList.toggle('hidden', !this.value);
  };

  if (avtale) {
    // Edit mode
    title.textContent = 'Rediger avtale';
    document.getElementById('avtaleId').value = avtale.id;
    kundeInput.value = avtale.kunde_id;
    // Find kunde name for display
    const kunde = customers.find(c => c.id === avtale.kunde_id);
    if (kunde) {
      kundeSearch.value = `${kunde.navn} (${kunde.poststed || 'Ukjent'})`;
    }
    document.getElementById('avtaleDato').value = avtale.dato;
    document.getElementById('avtaleKlokkeslett').value = avtale.klokkeslett || '';
    document.getElementById('avtaleType').value = avtale.type || serviceTypeRegistry.getDefaultServiceType().name;
    document.getElementById('avtaleBeskrivelse').value = avtale.beskrivelse || '';
    gjentakelseSelect.value = avtale.gjentakelse_regel || '';
    document.getElementById('avtaleGjentakelseSlutt').value = avtale.gjentakelse_slutt || '';
    gjentakelseSluttGroup.classList.toggle('hidden', !avtale.gjentakelse_regel);

    // Hide recurrence fields when editing (only on create)
    gjentakelseGroup.style.display = 'none';
    gjentakelseSluttGroup.style.display = 'none';

    deleteBtn.style.display = 'inline-block';
    // Show "delete series" button if this is part of a recurring series
    const isPartOfSeries = avtale.er_gjentakelse || avtale.original_avtale_id;
    deleteSeriesBtn.style.display = isPartOfSeries ? 'inline-block' : 'none';
  } else {
    // New avtale
    title.textContent = 'Ny avtale';
    form.reset();
    document.getElementById('avtaleId').value = '';
    kundeSearch.value = '';
    kundeInput.value = '';
    gjentakelseSelect.value = '';
    document.getElementById('avtaleGjentakelseSlutt').value = '';
    gjentakelseSluttGroup.classList.add('hidden');
    gjentakelseGroup.style.display = '';
    if (preselectedDate) {
      document.getElementById('avtaleDato').value = preselectedDate;
    }
    deleteBtn.style.display = 'none';
    deleteSeriesBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');

  // Focus on search field
  setTimeout(() => kundeSearch.focus(), 100);
}

// Kunde search for avtale modal
function setupAvtaleKundeSearch() {
  const searchInput = document.getElementById('avtaleKundeSearch');
  const kundeInput = document.getElementById('avtaleKunde');
  const resultsDiv = document.getElementById('avtaleKundeResults');

  if (!searchInput) return;

  searchInput.addEventListener('input', function() {
    const query = this.value.toLowerCase().trim();

    if (query.length < 1) {
      resultsDiv.innerHTML = '';
      resultsDiv.classList.remove('active');
      return;
    }

    // Filter customers
    const filtered = customers.filter(c =>
      c.navn.toLowerCase().includes(query) ||
      (c.poststed && c.poststed.toLowerCase().includes(query)) ||
      (c.adresse && c.adresse.toLowerCase().includes(query))
    );
    const matches = sortByNavn(filtered).slice(0, 10);

    if (matches.length === 0) {
      resultsDiv.innerHTML = '<div class="kunde-search-item no-results">Ingen kunder funnet</div>';
      resultsDiv.classList.add('active');
      return;
    }

    resultsDiv.innerHTML = matches.map(c => `
      <div class="kunde-search-item" data-id="${c.id}" data-name="${escapeHtml(c.navn)} (${c.poststed || 'Ukjent'})">
        <span class="kunde-name">${escapeHtml(c.navn)}</span>
        <span class="kunde-location">${c.poststed || 'Ukjent'}</span>
      </div>
    `).join('');
    resultsDiv.classList.add('active');
  });

  // Handle click on result
  resultsDiv.addEventListener('click', function(e) {
    const item = e.target.closest('.kunde-search-item');
    if (item && !item.classList.contains('no-results')) {
      kundeInput.value = item.dataset.id;
      searchInput.value = item.dataset.name;
      resultsDiv.innerHTML = '';
      resultsDiv.classList.remove('active');
    }
  });

  // Close results when clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.kunde-search-wrapper')) {
      resultsDiv.classList.remove('active');
    }
  });

  // Keyboard navigation
  searchInput.addEventListener('keydown', function(e) {
    const items = resultsDiv.querySelectorAll('.kunde-search-item:not(.no-results)');
    const activeItem = resultsDiv.querySelector('.kunde-search-item.active');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!activeItem && items.length > 0) {
        items[0].classList.add('active');
      } else if (activeItem && activeItem.nextElementSibling) {
        activeItem.classList.remove('active');
        activeItem.nextElementSibling.classList.add('active');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeItem && activeItem.previousElementSibling) {
        activeItem.classList.remove('active');
        activeItem.previousElementSibling.classList.add('active');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = activeItem || items[0];
      if (selected && !selected.classList.contains('no-results')) {
        kundeInput.value = selected.dataset.id;
        searchInput.value = selected.dataset.name;
        resultsDiv.innerHTML = '';
        resultsDiv.classList.remove('active');
      }
    }
  });
}

function closeAvtaleModal() {
  document.getElementById('avtaleModal').classList.add('hidden');
}

async function saveAvtale(e) {
  e.preventDefault();

  const avtaleId = document.getElementById('avtaleId').value;
  const gjentakelse = document.getElementById('avtaleGjentakelse').value;
  const data = {
    kunde_id: Number.parseInt(document.getElementById('avtaleKunde').value),
    dato: document.getElementById('avtaleDato').value,
    klokkeslett: document.getElementById('avtaleKlokkeslett').value || null,
    type: document.getElementById('avtaleType').value,
    beskrivelse: document.getElementById('avtaleBeskrivelse').value || null,
    opprettet_av: localStorage.getItem('userName') || 'admin',
    ...(gjentakelse && !avtaleId ? {
      gjentakelse_regel: gjentakelse,
      gjentakelse_slutt: document.getElementById('avtaleGjentakelseSlutt').value || undefined,
    } : {}),
  };

  try {
    let response;
    if (avtaleId) {
      response = await apiFetch(`/api/avtaler/${avtaleId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    } else {
      response = await apiFetch('/api/avtaler', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    }

    if (response.ok) {
      await loadAvtaler();
      renderCalendar();
      applyFilters(); // Oppdater kart-markører med ny avtale-status
      closeAvtaleModal();
    } else {
      const error = await response.json();
      showMessage('Kunne ikke lagre: ' + (error.error || 'Ukjent feil'), 'error');
    }
  } catch (error) {
    console.error('Error saving avtale:', error);
    showMessage('Kunne ikke lagre avtalen. Prøv igjen.', 'error');
  }
}

async function deleteAvtale() {
  const avtaleId = document.getElementById('avtaleId').value;
  if (!avtaleId) return;

  const confirmed = await showConfirm(
    'Er du sikker på at du vil slette denne avtalen?',
    'Slette avtale'
  );
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/avtaler/${avtaleId}`, { method: 'DELETE' });
    if (response.ok) {
      await loadAvtaler();
      renderCalendar();
      applyFilters(); // Oppdater kart-markører
      closeAvtaleModal();
    }
  } catch (error) {
    console.error('Error deleting avtale:', error);
    showMessage('Kunne ikke slette avtalen. Prøv igjen.', 'error');
  }
}

async function deleteAvtaleSeries() {
  const avtaleId = document.getElementById('avtaleId').value;
  if (!avtaleId) return;

  const confirmed = await showConfirm(
    'Er du sikker på at du vil slette hele serien? Alle gjentakende avtaler i denne serien vil bli slettet.',
    'Slette avtaleserie'
  );
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/avtaler/${avtaleId}/series`, { method: 'DELETE' });
    if (response.ok) {
      const result = await response.json();
      showMessage(`${result.data.deletedCount} avtaler slettet`, 'success');
      await loadAvtaler();
      renderCalendar();
      applyFilters(); // Oppdater kart-markører
      closeAvtaleModal();
    }
  } catch (error) {
    console.error('Error deleting avtale series:', error);
    showMessage('Kunne ikke slette avtaleserien. Prøv igjen.', 'error');
  }
}

// ========================================
// DASHBOARD FUNCTIONS
// ========================================

/**
 * Render all dashboard sections (called when dashboard tab is shown)
 */
function renderDashboardSections() {
  renderMorningBrief();
  if (typeof renderOverdue === 'function') renderOverdue();
  if (typeof renderWarnings === 'function') renderWarnings();
  if (typeof renderStatistikk === 'function') renderStatistikk();
  if (typeof renderMissingData === 'function') renderMissingData();
}

/**
 * Smart Morning Briefing Widget
 */
function renderMorningBrief() {
  const container = document.getElementById('morningBriefContainer');
  if (!container) return;

  // Check if collapsed this session
  if (sessionStorage.getItem('morningBriefCollapsed')) {
    container.innerHTML = '';
    return;
  }

  // Auto-collapse after 5 minutes
  if (!window._morningBriefTimer) {
    window._morningBriefTimer = setTimeout(() => {
      sessionStorage.setItem('morningBriefCollapsed', '1');
      const el = document.getElementById('morningBriefContainer');
      if (el) el.innerHTML = '';
    }, 5 * 60 * 1000);
  }

  const hour = new Date().getHours();
  let greeting, icon;
  if (hour < 12) { greeting = 'God morgen'; icon = 'fa-sun'; }
  else if (hour < 17) { greeting = 'God ettermiddag'; icon = 'fa-cloud-sun'; }
  else { greeting = 'God kveld'; icon = 'fa-moon'; }

  // Calculate stats from already-loaded data
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();
  let overdueCount = 0;
  let upcomingCount = 0;

  if (customers && customers.length > 0) {
    customers.forEach(c => {
      const nextDate = getNextControlDate(c);
      if (!nextDate) return;
      const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
      if (controlMonthValue < currentMonthValue) overdueCount++;
      else {
        const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 30) upcomingCount++;
      }
    });
  }

  // Get today's planned stops from weekplan if available
  let todayStops = 0;
  if (typeof weekPlanState !== 'undefined' && weekPlanState.days) {
    const todayStr = today.toISOString().split('T')[0];
    for (const dayKey of Object.keys(weekPlanState.days)) {
      if (weekPlanState.days[dayKey].date === todayStr) {
        todayStops = weekPlanState.days[dayKey].planned?.length || 0;
        break;
      }
    }
  }

  // Get top overdue area
  let topOverdueArea = '';
  if (customers && customers.length > 0) {
    const areaCounts = {};
    customers.forEach(c => {
      const nextDate = getNextControlDate(c);
      if (!nextDate) return;
      const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
      if (controlMonthValue < currentMonthValue && c.poststed) {
        areaCounts[c.poststed] = (areaCounts[c.poststed] || 0) + 1;
      }
    });
    const sorted = Object.entries(areaCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      topOverdueArea = `${sorted[0][1]} i ${sorted[0][0]}`;
    }
  }

  // Build message
  let message = '';
  if (todayStops > 0) {
    message += `Du har <strong>${todayStops} stopp</strong> planlagt i dag. `;
  }
  if (overdueCount > 0) {
    message += `<strong>${overdueCount}</strong> kunder trenger oppfølging`;
    if (topOverdueArea) message += ` (${topOverdueArea})`;
    message += '. ';
  }
  if (upcomingCount > 0) {
    message += `${upcomingCount} kontroller innen 30 dager.`;
  }
  if (!message && customers && customers.length > 0) {
    message = `Alt ser bra ut — ${customers.length} kunder i systemet.`;
  }
  if (!message) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="morning-brief">
      <div class="morning-brief-header">
        <span class="morning-brief-greeting"><i class="fas ${icon}" aria-hidden="true"></i>${greeting}!</span>
        <button class="morning-brief-close" data-action="closeMorningBrief" title="Lukk" aria-label="Lukk briefing"><i class="fas fa-times" aria-hidden="true"></i></button>
      </div>
      <div class="morning-brief-stats">
        <div class="morning-brief-stat"><span class="stat-num">${customers ? customers.length : 0}</span> kunder</div>
        ${overdueCount > 0 ? `<div class="morning-brief-stat"><span class="stat-num" style="color:var(--color-status-overdue)">${overdueCount}</span> forfalte</div>` : ''}
        ${todayStops > 0 ? `<div class="morning-brief-stat"><span class="stat-num" style="color:var(--color-accent)">${todayStops}</span> i dag</div>` : ''}
      </div>
      <div class="morning-brief-message">${message}</div>
      <div class="morning-brief-actions">
        ${overdueCount > 0 ? `<button class="btn btn-secondary btn-small" id="briefOverdueBtn"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i> Se forfalte</button>` : ''}
        <button class="btn btn-primary btn-small" id="briefWeekplanBtn"><i class="fas fa-clipboard-list" aria-hidden="true"></i> Åpne ukeplan</button>
      </div>
    </div>
  `;

  // Attach click handlers after rendering
  const overdueBtn = document.getElementById('briefOverdueBtn');
  if (overdueBtn) {
    overdueBtn.addEventListener('click', () => {
      const tab = document.getElementById('tab-btn-overdue');
      if (tab) tab.click();
    });
  }
  const weekplanBtn = document.getElementById('briefWeekplanBtn');
  if (weekplanBtn) {
    weekplanBtn.addEventListener('click', () => {
      switchToTab('weekly-plan');
    });
  }
}

function closeMorningBrief() {
  sessionStorage.setItem('morningBriefCollapsed', '1');
  const el = document.getElementById('morningBriefContainer');
  if (el) el.innerHTML = '';
  if (window._morningBriefTimer) {
    clearTimeout(window._morningBriefTimer);
    window._morningBriefTimer = null;
  }
}
window.closeMorningBrief = closeMorningBrief;

/**
 * Update dashboard with current customer statistics
 */
function updateDashboard() {
  if (!customers || customers.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let overdueCount = 0;
  let upcomingCount = 0;
  let okCount = 0;
  const categoryStats = {};

  customers.forEach(customer => {
    const nextDate = getNextControlDate(customer);

    if (nextDate) {
      const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));

      if (daysUntil < 0) {
        overdueCount++;
      } else if (daysUntil <= 30) {
        upcomingCount++;
      } else {
        okCount++;
      }
    }

    // Count by category
    const cat = customer.kategori || 'Ukjent';
    categoryStats[cat] = (categoryStats[cat] || 0) + 1;
  });

  // Update stat cards with animated counters
  const totalEl = document.getElementById('dashTotalKunder');
  const overdueEl = document.getElementById('dashForfalte');
  const upcomingEl = document.getElementById('dashKommende');
  const okEl = document.getElementById('dashFullfort');
  const overdueCountEl = document.getElementById('dashOverdueCount');

  if (typeof animateCounter === 'function') {
    animateCounter(totalEl, customers.length);
    animateCounter(overdueEl, overdueCount);
    animateCounter(upcomingEl, upcomingCount);
    animateCounter(okEl, okCount);
  } else {
    if (totalEl) totalEl.textContent = customers.length;
    if (overdueEl) overdueEl.textContent = overdueCount;
    if (upcomingEl) upcomingEl.textContent = upcomingCount;
    if (okEl) okEl.textContent = okCount;
  }
  if (overdueCountEl) overdueCountEl.textContent = overdueCount;

  // Update sidebar quick stats
  const quickKunder = document.getElementById('quickStatKunder');
  const quickForfalte = document.getElementById('quickStatForfalte');
  const quickKommende = document.getElementById('quickStatKommende');
  const quickOk = document.getElementById('quickStatOk');

  if (quickKunder) quickKunder.textContent = customers.length;
  if (quickForfalte) quickForfalte.textContent = overdueCount;
  if (quickKommende) quickKommende.textContent = upcomingCount;
  if (quickOk) quickOk.textContent = okCount;

  // Update category overview
  renderDashboardCategories(categoryStats);

  // Update area list
  renderDashboardAreas();
}

/**
 * Render category statistics in dashboard
 */
function renderDashboardCategories(categoryStats) {
  const container = document.getElementById('dashCategoryOverview');
  if (!container) return;

  const serviceTypes = serviceTypeRegistry.getAll();
  let html = '';

  // Use service types for display
  let catIndex = 0;
  serviceTypes.forEach(st => {
    const count = categoryStats[st.name] || 0;
    html += `
      <div class="category-stat stagger-item" style="--stagger-index:${catIndex++}">
        <i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i>
        <span class="cat-name">${st.name}</span>
        <span class="cat-count">${count}</span>
      </div>
    `;
  });

  // Add combined category if exists
  const combinedName = serviceTypes.map(st => st.name).join(' + ');
  const combinedCount = categoryStats[combinedName] || 0;
  if (combinedCount > 0) {
    const icons = serviceTypes.map(st => `<i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i>`).join('');
    html += `
      <div class="category-stat">
        ${icons}
        <span class="cat-name">${serviceTypes.length > 2 ? 'Alle' : 'Begge'}</span>
        <span class="cat-count">${combinedCount}</span>
      </div>
    `;
  }

  container.innerHTML = html;
}

/**
 * Render area quick links in dashboard
 */
function renderDashboardAreas() {
  const container = document.getElementById('dashAreaList');
  if (!container) return;

  // Count customers per area
  const areaCounts = {};
  customers.forEach(c => {
    const area = c.poststed || 'Ukjent';
    areaCounts[area] = (areaCounts[area] || 0) + 1;
  });

  // Sort by count descending, take top 10
  const sortedAreas = Object.entries(areaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  let html = '';
  sortedAreas.forEach(([area, count], index) => {
    html += `
      <div class="area-chip stagger-item" style="--stagger-index:${Math.min(index, 15)}" data-area="${escapeHtml(area)}">
        ${escapeHtml(area)}
        <span class="area-count">${count}</span>
      </div>
    `;
  });

  container.innerHTML = html;

  // Add click handlers
  container.querySelectorAll('.area-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const area = chip.dataset.area;
      // Switch to customers tab and filter by area
      switchToTab('customers');
      // Set area filter if available
      const areaSelect = document.getElementById('omradeFilter');
      if (areaSelect) {
        areaSelect.value = area;
        applyFilters();
      }
    });
  });
}

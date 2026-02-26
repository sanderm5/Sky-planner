// ========================================
// DASHBOARD FUNCTIONS
// ========================================

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

  // Update stat cards
  const totalEl = document.getElementById('dashTotalKunder');
  const overdueEl = document.getElementById('dashForfalte');
  const upcomingEl = document.getElementById('dashKommende');
  const okEl = document.getElementById('dashFullfort');
  const overdueCountEl = document.getElementById('dashOverdueCount');

  if (totalEl) totalEl.textContent = customers.length;
  if (overdueEl) overdueEl.textContent = overdueCount;
  if (upcomingEl) upcomingEl.textContent = upcomingCount;
  if (okEl) okEl.textContent = okCount;
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
  serviceTypes.forEach(st => {
    const count = categoryStats[st.name] || 0;
    html += `
      <div class="category-stat">
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
  sortedAreas.forEach(([area, count]) => {
    html += `
      <div class="area-chip" data-area="${escapeHtml(area)}">
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

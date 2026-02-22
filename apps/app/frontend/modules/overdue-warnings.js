function renderOverdue() {
  const container = document.getElementById('overdueContainer');
  const countHeader = document.getElementById('overdueCountHeader');
  const sortSelect = document.getElementById('overdueSortSelect');
  const sortBy = sortSelect?.value || 'proximity';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  // Get overdue customers - forfalt kun når kontrollens måned er passert
  let overdueCustomers = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    return controlMonthValue < currentMonthValue;
  });

  // Calculate days overdue for each
  overdueCustomers = overdueCustomers.map(c => {
    const nextDate = getNextControlDate(c);
    const daysOverdue = Math.ceil((today - nextDate) / (1000 * 60 * 60 * 24));
    return { ...c, daysOverdue, _controlDate: nextDate };
  });

  // Sort based on selection - default: ferskeste (lavest dager) først
  if (sortBy === 'days') {
    // Ferskeste først (lavest antall dager forfalt øverst)
    overdueCustomers.sort((a, b) => a.daysOverdue - b.daysOverdue);
  } else if (sortBy === 'days-desc') {
    // Eldste først (høyest antall dager forfalt øverst)
    overdueCustomers.sort((a, b) => b.daysOverdue - a.daysOverdue);
  } else if (sortBy === 'name') {
    sortByNavn(overdueCustomers);
  } else if (sortBy === 'category') {
    overdueCustomers.sort((a, b) => {
      const catA = a.kategori || 'Annen';
      const catB = b.kategori || 'Annen';
      if (catA !== catB) return compareNorwegian(catA, catB);
      return a.daysOverdue - b.daysOverdue;
    });
  } else if (sortBy === 'area') {
    overdueCustomers.sort((a, b) => {
      const areaA = a.poststed || 'Ukjent';
      const areaB = b.poststed || 'Ukjent';
      if (areaA !== areaB) return compareNorwegian(areaA, areaB);
      return a.daysOverdue - b.daysOverdue;
    });
  } else if (sortBy === 'proximity') {
    // No pre-sort needed - clustering handles grouping
  }

  // Update badge
  updateBadge('overdueBadge', overdueCustomers.length);

  // Update header count
  if (countHeader) {
    countHeader.textContent = overdueCustomers.length > 0
      ? `(${overdueCustomers.length} stk)`
      : '';
  }

  // Render
  let html = '';

  if (overdueCustomers.length === 0) {
    html = `
      <div class="overdue-empty">
        <i class="fas fa-check-circle"></i>
        <p>Ingen forfalte kontroller</p>
        <span>Bra jobba!</span>
      </div>
    `;
  } else {
    // Group by severity
    const critical = overdueCustomers.filter(c => c.daysOverdue > 60);
    const warning = overdueCustomers.filter(c => c.daysOverdue > 30 && c.daysOverdue <= 60);
    const mild = overdueCustomers.filter(c => c.daysOverdue <= 30);

    const renderGroup = (title, items, severity) => {
      if (items.length === 0) return '';
      return `
        <div class="overdue-section overdue-${severity}">
          <div class="overdue-section-header">
            <span class="overdue-severity-dot ${severity}"></span>
            ${title} (${items.length})
          </div>
          ${items.map(c => `
            <div class="overdue-item" data-action="focusOnCustomer" data-customer-id="${c.id}">
              <div class="overdue-customer-info">
                <div class="overdue-customer-main">
                  <h4>${escapeHtml(c.navn)}</h4>
                  <span class="overdue-category">${escapeHtml(c.kategori || 'Ukjent')}</span>
                </div>
                <p class="overdue-address">${escapeHtml(c.adresse)}, ${escapeHtml(c.poststed || '')}</p>
                ${c.telefon ? `<a href="tel:${c.telefon}" class="overdue-phone" onclick="event.stopPropagation();"><i class="fas fa-phone"></i> ${escapeHtml(c.telefon)}</a>` : ''}
              </div>
              <div class="overdue-status">
                <span class="overdue-days">${c.daysOverdue} dager</span>
                <span class="overdue-date">${formatDate(c._controlDate)}</span>
                <button class="btn-remind" data-action="sendReminder" data-customer-id="${c.id}" title="Send påminnelse">
                  <i class="fas fa-envelope"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    };

    const renderGroupedItems = (items) => {
      return items.map(c => {
        const kat = c.kategori || '';
        const katBadge = kat ? `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${escapeHtml(kat)}</span>` : '';
        return `
        <div class="overdue-item" data-action="focusOnCustomer" data-customer-id="${c.id}">
          <div class="overdue-customer-info">
            <div class="overdue-customer-main">
              <h4>${escapeHtml(c.navn)}</h4>
              ${katBadge}
              <span class="overdue-days-inline ${c.daysOverdue > 60 ? 'critical' : c.daysOverdue > 30 ? 'warning' : 'mild'}">${c.daysOverdue}d forfalt</span>
            </div>
            <p class="overdue-address">${escapeHtml(c.adresse)}, ${escapeHtml(c.poststed || '')}</p>
            ${c.telefon ? `<a href="tel:${c.telefon}" class="overdue-phone" onclick="event.stopPropagation();"><i class="fas fa-phone"></i> ${escapeHtml(c.telefon)}</a>` : ''}
          </div>
          <div class="overdue-status">
            <span class="overdue-date">${formatDate(c._controlDate)}</span>
            <button class="btn-remind" data-action="sendReminder" data-customer-id="${c.id}" title="Send påminnelse">
              <i class="fas fa-envelope"></i>
            </button>
            <button class="btn-wp-single" data-action="addGroupToWeekPlan" data-customer-ids="${c.id}" title="Legg til i ukeplan">
              <i class="fas fa-calendar-plus"></i>
            </button>
          </div>
        </div>
      `;
      }).join('');
    };

    // Helper: generate type breakdown badges for a group of customers
    const renderTypeBadges = (items) => {
      const types = {};
      items.forEach(c => {
        const kat = c.kategori || 'Annen';
        types[kat] = (types[kat] || 0) + 1;
      });
      return Object.entries(types).map(([kat, count]) =>
        `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${count} ${escapeHtml(kat)}</span>`
      ).join('');
    };

    if (sortBy === 'category') {
      // Group by category
      const byCategory = {};
      overdueCustomers.forEach(c => {
        const cat = c.kategori || 'Annen';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(c);
      });

      Object.keys(byCategory).sort((a, b) => a.localeCompare(b, 'no')).forEach(cat => {
        const customerIds = byCategory[cat].map(c => c.id).join(',');
        html += `
          <div class="overdue-section">
            <div class="overdue-section-header">
              <i class="fas fa-folder"></i>
              ${escapeHtml(cat)} (${byCategory[cat].length})
              <button class="btn-group-route" data-action="createRouteFromGroup" data-customer-ids="${customerIds}" title="Lag rute for denne gruppen">
                <i class="fas fa-route"></i>
              </button>
              <button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${customerIds}" title="Legg til i ukeplan">
                <i class="fas fa-calendar-plus"></i>
              </button>
            </div>
            ${renderGroupedItems(byCategory[cat])}
          </div>
        `;
      });
    } else if (sortBy === 'area') {
      // Group by area (poststed)
      const byArea = {};
      overdueCustomers.forEach(c => {
        const area = c.poststed || 'Ukjent område';
        if (!byArea[area]) byArea[area] = [];
        byArea[area].push(c);
      });

      Object.keys(byArea).sort(compareNorwegian).forEach(area => {
        const customerIds = byArea[area].map(c => c.id).join(',');
        html += `
          <div class="overdue-section overdue-area-section">
            <div class="overdue-section-header">
              <i class="fas fa-map-marker-alt"></i>
              ${escapeHtml(area)} (${byArea[area].length})
              <button class="btn-group-route" data-action="createRouteFromGroup" data-customer-ids="${customerIds}" title="Lag rute for ${escapeHtml(area)}">
                <i class="fas fa-route"></i>
              </button>
              <button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${customerIds}" title="Vis på kart">
                <i class="fas fa-map"></i>
              </button>
              <button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${customerIds}" title="Legg til i ukeplan">
                <i class="fas fa-calendar-plus"></i>
              </button>
            </div>
            <div class="overdue-type-summary">${renderTypeBadges(byArea[area])}</div>
            ${renderGroupedItems(byArea[area])}
          </div>
        `;
      });
    } else if (sortBy === 'proximity') {
      // Group by geographic proximity using DBSCAN clustering
      const { clusters, noise, summary } = clusterCustomersByProximity(overdueCustomers);

      // Summary line
      const overdueCustWord = overdueCustomers.length === 1 ? 'kunde' : 'kunder';
      const summaryParts = [];
      if (summary.clusterCount > 0) summaryParts.push(`${summary.clusterCount} ${summary.clusterCount === 1 ? 'område' : 'områder'}`);
      if (summary.noiseCount > 0) summaryParts.push(`${summary.noiseCount} ${summary.noiseCount === 1 ? 'spredt' : 'spredte'}`);
      html += `
        <div class="proximity-summary">
          <i class="fas fa-layer-group"></i>
          <span>${overdueCustomers.length} ${overdueCustWord} fordelt på ${summaryParts.join(' + ')}</span>
        </div>
      `;

      clusters.forEach((cluster, idx) => {
        // Sort customers within cluster: most overdue first
        cluster.customers.sort((a, b) => b.daysOverdue - a.daysOverdue);
        const customerIds = cluster.customers.map(c => c.id).join(',');
        const custWord = cluster.customers.length === 1 ? 'kunde' : 'kunder';
        const radiusText = cluster.radiusKm < 1
          ? `~${Math.round(cluster.radiusKm * 1000)}m`
          : `~${cluster.radiusKm.toFixed(1)} km`;

        // Severity breakdown for this cluster
        const critCount = cluster.customers.filter(c => c.daysOverdue > 60).length;
        const warnCount = cluster.customers.filter(c => c.daysOverdue > 30 && c.daysOverdue <= 60).length;
        const mildCount = cluster.customers.filter(c => c.daysOverdue <= 30).length;
        let severityBadges = '';
        if (critCount > 0) severityBadges += `<span class="proximity-severity critical">${critCount} kritisk</span>`;
        if (warnCount > 0) severityBadges += `<span class="proximity-severity warning">${warnCount} advarsel</span>`;
        if (mildCount > 0) severityBadges += `<span class="proximity-severity mild">${mildCount} ny</span>`;

        // Determine dominant severity for border color
        const severityClass = critCount > 0 ? 'severity-critical' : warnCount > 0 ? 'severity-warning' : 'severity-mild';

        html += `
          <div class="overdue-section overdue-proximity-section ${severityClass}">
            <div class="overdue-section-header">
              <span class="proximity-number">${idx + 1}</span>
              <i class="fas fa-map-pin"></i>
              ${escapeHtml(cluster.areaName)}
              <span class="proximity-meta">${cluster.customers.length} ${custWord}, ${radiusText}</span>
              ${severityBadges}
              <button class="btn-group-route" data-action="createRouteFromGroup" data-customer-ids="${customerIds}" title="Lag rute for denne klyngen">
                <i class="fas fa-route"></i>
              </button>
              <button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${customerIds}" title="Vis på kart">
                <i class="fas fa-map"></i>
              </button>
              <button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${customerIds}" title="Legg til i ukeplan">
                <i class="fas fa-calendar-plus"></i>
              </button>
            </div>
            <div class="overdue-type-summary">${renderTypeBadges(cluster.customers)}</div>
            ${renderGroupedItems(cluster.customers)}
          </div>
        `;
      });

      if (noise.length > 0) {
        // Sort noise: most overdue first
        noise.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
        const noiseIds = noise.filter(c => c.id).map(c => c.id).join(',');
        const noiseWord = noise.length === 1 ? 'kunde' : 'kunder';
        html += `
          <div class="overdue-section overdue-noise-section">
            <div class="overdue-section-header">
              <i class="fas fa-map-marker-alt"></i>
              Spredte ${noiseWord} (${noise.length})
              ${noiseIds ? `<button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${noiseIds}" title="Vis på kart"><i class="fas fa-map"></i></button>` : ''}
              ${noiseIds ? `<button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${noiseIds}" title="Legg til i ukeplan"><i class="fas fa-calendar-plus"></i></button>` : ''}
            </div>
            ${renderGroupedItems(noise)}
          </div>
        `;
      }
    } else {
      // Vis grupper basert på sorteringsvalg
      if (sortBy === 'days') {
        // Ferskeste først - mild først
        html += renderGroup('Nylig forfalt (1-30 dager)', mild, 'mild');
        html += renderGroup('Advarsel (31-60 dager)', warning, 'warning');
        html += renderGroup('Kritisk (over 60 dager)', critical, 'critical');
      } else {
        // Standard/eldste først - kritisk først
        html += renderGroup('Kritisk (over 60 dager)', critical, 'critical');
        html += renderGroup('Advarsel (31-60 dager)', warning, 'warning');
        html += renderGroup('Nylig forfalt (1-30 dager)', mild, 'mild');
      }
    }
  }

  container.innerHTML = html;

  // Show/hide proximity settings
  const proxSettings = document.getElementById('overdueProximitySettings');
  if (proxSettings) {
    proxSettings.style.display = sortBy === 'proximity' ? '' : 'none';
  }
}

// Update overdue badge count — same logic as renderOverdue()
function updateOverdueBadge() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  const overdueCount = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    return controlMonthValue < currentMonthValue;
  }).length;

  updateBadge('overdueBadge', overdueCount);

  // Also update upcoming badge
  updateUpcomingBadge();
}

function updateUpcomingBadge() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();
  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const upcomingCount = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    // Include current month (not overdue) up to 30 days from now
    return controlMonthValue >= currentMonthValue && nextDate <= thirtyDaysFromNow;
  }).length;

  updateBadge('upcomingBadge', upcomingCount);
}

// Render warnings for upcoming controls
function renderWarnings() {
  const container = document.getElementById('warningsContainer');
  const sortSelect = document.getElementById('warningSortSelect');
  const sortBy = sortSelect?.value || 'proximity';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  // Get customers needing control in next 30 days (includes current month past dates)
  const warningCustomers = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    // Include current month (not overdue) up to 30 days from now
    return controlMonthValue >= currentMonthValue && nextDate <= thirtyDaysFromNow;
  }).map(c => ({
    ...c,
    _nextDate: getNextControlDate(c)
  }));

  const renderWarningItem = (c) => {
    const controlStatus = getControlStatus(c);
    const daysUntil = Math.ceil((c._nextDate - today) / (1000 * 60 * 60 * 24));
    const dateStr = c._nextDate.toISOString().split('T')[0];
    const kat = c.kategori || '';
    const katBadge = kat ? `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${escapeHtml(kat)}</span>` : '';
    return `
      <div class="warning-item" data-action="focusOnCustomer" data-customer-id="${c.id}">
        <div class="warning-customer">
          <h4>${escapeHtml(c.navn)} ${katBadge}</h4>
          <p>${escapeHtml(c.adresse)} (${escapeHtml(c.postnummer)})</p>
        </div>
        <div class="warning-date">
          <span class="control-status ${controlStatus.class}">${daysUntil < 0 ? Math.abs(daysUntil) + ' dager over' : daysUntil + ' dager'}</span>
          <p style="font-size: 10px; color: #666; margin: 2px 0 0 0;">${escapeHtml(dateStr)}</p>
          <button class="btn-wp-single" data-action="addGroupToWeekPlan" data-customer-ids="${c.id}" title="Legg til i ukeplan">
            <i class="fas fa-calendar-plus"></i>
          </button>
        </div>
      </div>
    `;
  };

  // Helper: generate type breakdown badges for warning groups
  const renderWarningTypeBadges = (items) => {
    const types = {};
    items.forEach(c => {
      const kat = c.kategori || 'Annen';
      types[kat] = (types[kat] || 0) + 1;
    });
    return Object.entries(types).map(([kat, count]) =>
      `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${count} ${escapeHtml(kat)}</span>`
    ).join('');
  };

  // Render
  let html = '';

  if (warningCustomers.length === 0) {
    html = '<p style="padding: 20px; text-align: center; color: #666;">Ingen kommende kontroller</p>';
  } else if (sortBy === 'proximity') {
    // Group by geographic proximity
    const { clusters, noise, summary } = clusterCustomersByProximity(warningCustomers);

    // Summary line
    const warnCustWord = warningCustomers.length === 1 ? 'kunde' : 'kunder';
    const summaryParts = [];
    if (summary.clusterCount > 0) summaryParts.push(`${summary.clusterCount} ${summary.clusterCount === 1 ? 'område' : 'områder'}`);
    if (summary.noiseCount > 0) summaryParts.push(`${summary.noiseCount} ${summary.noiseCount === 1 ? 'spredt' : 'spredte'}`);
    html += `
      <div class="proximity-summary">
        <i class="fas fa-layer-group"></i>
        <span>${warningCustomers.length} ${warnCustWord} fordelt på ${summaryParts.join(' + ')}</span>
      </div>
    `;

    clusters.forEach((cluster, idx) => {
      // Sort customers within cluster: soonest control date first
      cluster.customers.sort((a, b) => a._nextDate - b._nextDate);
      const customerIds = cluster.customers.map(c => c.id).join(',');
      const custWord = cluster.customers.length === 1 ? 'kunde' : 'kunder';
      const radiusText = cluster.radiusKm < 1
        ? `~${Math.round(cluster.radiusKm * 1000)}m`
        : `~${cluster.radiusKm.toFixed(1)} km`;
      html += `<div class="warning-section overdue-proximity-section">
        <div class="warning-header proximity-header">
          <span class="proximity-number">${idx + 1}</span>
          <i class="fas fa-map-pin"></i>
          ${escapeHtml(cluster.areaName)}
          <span class="proximity-meta">${cluster.customers.length} ${custWord}, ${radiusText}</span>
          <button class="btn-group-route" data-action="createRouteFromGroup" data-customer-ids="${customerIds}" title="Lag rute for denne klyngen">
            <i class="fas fa-route"></i>
          </button>
          <button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${customerIds}" title="Vis på kart">
            <i class="fas fa-map"></i>
          </button>
          <button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${customerIds}" title="Legg til i ukeplan">
            <i class="fas fa-calendar-plus"></i>
          </button>
        </div>
        <div class="overdue-type-summary">${renderWarningTypeBadges(cluster.customers)}</div>
        ${cluster.customers.map(renderWarningItem).join('')}
      </div>`;
    });

    if (noise.length > 0) {
      // Sort noise: soonest control date first
      noise.sort((a, b) => (a._nextDate || 0) - (b._nextDate || 0));
      const noiseIds = noise.filter(c => c.id).map(c => c.id).join(',');
      const noiseWord = noise.length === 1 ? 'kunde' : 'kunder';
      html += `<div class="warning-section overdue-noise-section">
        <div class="warning-header proximity-header">
          <i class="fas fa-map-marker-alt"></i>
          Spredte ${noiseWord} (${noise.length})
          ${noiseIds ? `<button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${noiseIds}" title="Vis på kart"><i class="fas fa-map"></i></button>` : ''}
          ${noiseIds ? `<button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${noiseIds}" title="Legg til i ukeplan"><i class="fas fa-calendar-plus"></i></button>` : ''}
        </div>
        ${noise.map(renderWarningItem).join('')}
      </div>`;
    }
  } else {
    // Default: Group by kategori
    const byCategory = {};
    warningCustomers.forEach(c => {
      const cat = c.kategori || 'Annen';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(c);
    });

    Object.values(byCategory).forEach(sortByNavn);

    const categoryOrder = serviceTypeRegistry.getAll().map(st => st.name);
    const sortedCats = Object.keys(byCategory).sort((a, b) => {
      const indexA = categoryOrder.indexOf(a);
      const indexB = categoryOrder.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedCats.forEach(category => {
      html += `<div class="warning-section">
        <div class="warning-header">${escapeHtml(category)} (${byCategory[category].length})</div>
        ${byCategory[category].map(renderWarningItem).join('')}
      </div>`;
    });
  }

  container.innerHTML = html;

  // Show/hide proximity settings
  const proxSettings = document.getElementById('warningProximitySettings');
  if (proxSettings) {
    proxSettings.style.display = sortBy === 'proximity' ? '' : 'none';
  }
}


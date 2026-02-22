// Apply all filters
async function applyFilters() {
  // Avbryt pågående request for å unngå race condition
  if (filterAbortController) {
    filterAbortController.abort();
  }
  filterAbortController = new AbortController();

  let filtered = [...customers];
  const searchQuery = searchInput?.value?.toLowerCase() || '';

  // Category filter - matches if customer has the selected category (supports multi-category customers)
  if (selectedCategory !== 'all') {
    const beforeCount = filtered.length;
    const filterKats = selectedCategory.split(' + ').map(s => s.trim());
    filtered = filtered.filter(c => {
      if (!c.kategori) return false;
      const kundeKategorier = c.kategori.split(' + ').map(s => s.trim());
      // Customer must have ALL selected filter categories
      return filterKats.every(fk => kundeKategorier.includes(fk));
    });
    Logger.log(`applyFilters: "${selectedCategory}" - ${beforeCount} -> ${filtered.length} kunder`);
  }

  // Subcategory filter (AND logic between groups: customer must match all selected groups)
  const activeSubcatFilters = Object.entries(selectedSubcategories).filter(([_, v]) => v);
  if (activeSubcatFilters.length > 0) {
    filtered = filtered.filter(c => {
      const assignments = kundeSubcatMap[c.id] || [];
      return activeSubcatFilters.every(([groupId, subcatId]) => {
        return assignments.some(a => a.group_id === Number(groupId) && a.subcategory_id === Number(subcatId));
      });
    });
  }

  // Dynamic field filters
  if (Object.keys(dynamicFieldFilters).length > 0) {
    filtered = filtered.filter(customer => {
      let customData = customer.custom_data;
      if (typeof customData === 'string') {
        try { customData = JSON.parse(customData); } catch { customData = {}; }
      }
      customData = customData || {};

      return Object.entries(dynamicFieldFilters).every(([fieldName, filterValue]) => {
        const customerValue = customData[fieldName];
        const field = organizationFields.find(f => f.field_name === fieldName);

        if (!field) return true;

        switch (field.field_type) {
          case 'select':
            return customerValue === filterValue;

          case 'text':
            return customerValue && String(customerValue).toLowerCase().includes(String(filterValue).toLowerCase());

          case 'number':
            if (!customerValue && customerValue !== 0) return false;
            const num = parseFloat(customerValue);
            if (isNaN(num)) return false;
            if (filterValue.min && num < parseFloat(filterValue.min)) return false;
            if (filterValue.max && num > parseFloat(filterValue.max)) return false;
            return true;

          case 'date':
            if (!customerValue) return false;
            const date = new Date(customerValue);
            if (isNaN(date.getTime())) return false;
            if (filterValue.from && date < new Date(filterValue.from)) return false;
            if (filterValue.to && date > new Date(filterValue.to)) return false;
            return true;

          default:
            return customerValue && String(customerValue).toLowerCase().includes(String(filterValue).toLowerCase());
        }
      });
    });
  }

  // Område filter
  if (showOnlyWarnings) {
    try {
      const response = await apiFetch('/api/kunder/kontroll-varsler?dager=30', {
        signal: filterAbortController.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: Kunne ikke laste varsler`);
      const varselResult = await response.json();
      const varselKunder = varselResult.data || varselResult;
      const varselIds = new Set(varselKunder.map(k => k.id));
      filtered = filtered.filter(c => varselIds.has(c.id));
    } catch (error) {
      if (error.name === 'AbortError') return; // Request avbrutt av nyere request
      console.error('Feil ved henting av varsler:', error);
      showNotification('Kunne ikke laste varsler. Prøv igjen senere.', 'error');
    }
  } else if (currentFilter !== 'alle') {
    filtered = filtered.filter(c => c.poststed === currentFilter);
  }

  // Search filter
  if (searchQuery) {
    filtered = filtered.filter(c =>
      c.navn.toLowerCase().includes(searchQuery) ||
      c.adresse.toLowerCase().includes(searchQuery) ||
      (c.poststed && c.poststed.toLowerCase().includes(searchQuery)) ||
      (c.postnummer && c.postnummer.includes(searchQuery))
    );
  }

  renderCustomerList(filtered);
  renderMarkers(filtered);
  updateCategoryFilterCounts();

  // Fremhev søketreff på kartet
  const activeSearch = searchInput?.value?.trim();
  if (activeSearch && filtered.length > 0 && filtered.length < 50) {
    highlightCustomersOnMap(filtered.map(c => c.id));
  } else {
    clearMapHighlights();
  }

  // Update search result counter
  const counterEl = document.getElementById('filterResultCount');
  if (counterEl) {
    if (filtered.length !== customers.length) {
      counterEl.textContent = `Viser ${filtered.length} av ${customers.length} kunder`;
      counterEl.style.display = 'block';
    } else {
      counterEl.style.display = 'none';
    }
  }
}

// Update category filter button counts (exact match - matches filter behavior)
function updateCategoryFilterCounts() {
  const serviceTypes = serviceTypeRegistry.getAll();

  // "Alle" button (left sidebar + right sidebar tab)
  const allBtn = document.querySelector('[data-category="all"]');
  if (allBtn) allBtn.innerHTML = `<i class="fas fa-list"></i> Alle (${customers.length})`;
  const alleTab = document.querySelector('[data-kategori="alle"]');
  if (alleTab) alleTab.innerHTML = `Alle (${customers.length})`;

  // Update each service type button/tab dynamically
  serviceTypes.forEach(st => {
    // Count customers that have this category (supports multi-category customers)
    const count = customers.filter(c => {
      if (!c.kategori) return false;
      return c.kategori.split(' + ').map(s => s.trim()).includes(st.name);
    }).length;
    const icon = serviceTypeRegistry.getIcon(st);

    // Left sidebar category buttons
    const btn = document.querySelector(`[data-category="${st.name}"]`);
    if (btn) btn.innerHTML = `${icon} ${escapeHtml(st.name)} (${count})`;

    // Right sidebar kategori tabs
    const tab = document.querySelector(`[data-kategori="${st.name}"]`);
    if (tab) tab.innerHTML = `${icon} ${escapeHtml(st.name)} (${count})`;
  });

  // Combined category (when org has 2+ service types)
  if (serviceTypes.length >= 2) {
    const combinedName = serviceTypes.map(st => st.name).join(' + ');
    // Count customers that have ALL categories
    const beggeCount = customers.filter(c => {
      if (!c.kategori) return false;
      const kundeKats = c.kategori.split(' + ').map(s => s.trim());
      return serviceTypes.every(st => kundeKats.includes(st.name));
    }).length;
    const combinedIcons = serviceTypes.map(st => serviceTypeRegistry.getIcon(st)).join('');

    const combinedLabel = serviceTypes.length > 2 ? 'Alle' : 'Begge';
    const beggeBtn = document.querySelector(`[data-category="${combinedName}"]`);
    if (beggeBtn) beggeBtn.innerHTML = `${combinedIcons} ${combinedLabel} (${beggeCount})`;

    const beggeTab = document.querySelector(`[data-kategori="${combinedName}"]`);
    if (beggeTab) beggeTab.innerHTML = `${combinedIcons} ${combinedLabel} (${beggeCount})`;
  }

}

// Check if customer needs control soon - includes lifecycle stages when feature is enabled
function getControlStatus(customer) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Lifecycle-aware statuses (checked first, override date-based if active)
  if (hasFeature('lifecycle_colors')) {
    // Recently visited → dim/faded (low priority, already done)
    if (customer.last_visit_date) {
      const visitDate = new Date(customer.last_visit_date);
      const daysSinceVisit = Math.ceil((today - visitDate) / (1000 * 60 * 60 * 24));
      if (daysSinceVisit <= 14) {
        return { status: 'besøkt', label: `Besøkt ${daysSinceVisit}d siden`, class: 'status-visited', date: formatDateInline(visitDate), daysUntil: null };
      }
    }

    // Inquiry sent → purple pulsing (waiting for response)
    if (customer.inquiry_sent_date) {
      const inquiryDate = new Date(customer.inquiry_sent_date);
      const daysSinceInquiry = Math.ceil((today - inquiryDate) / (1000 * 60 * 60 * 24));
      if (daysSinceInquiry <= 30) {
        return { status: 'forespørsel', label: `Forespørsel sendt ${daysSinceInquiry}d siden`, class: 'status-inquiry', date: formatDateInline(inquiryDate), daysUntil: null };
      }
    }

    // Job confirmed → colored border based on type
    if (customer.job_confirmed_type) {
      const typeLabels = { a: 'Type A', b: 'Type B', begge: 'Begge' };
      const typeLabel = typeLabels[customer.job_confirmed_type] || customer.job_confirmed_type;
      const statusClass = customer.job_confirmed_type === 'begge' ? 'status-confirmed-both' :
        customer.job_confirmed_type === 'b' ? 'status-confirmed-b' : 'status-confirmed-a';
      return { status: 'bekreftet', label: `Bekreftet: ${typeLabel}`, class: statusClass, date: null, daysUntil: null };
    }
  }

  // Standard date-based control status
  const nextDate = getNextControlDate(customer);

  if (!nextDate) {
    return { status: 'ukjent', label: 'Ikke registrert', class: 'status-unknown', date: null, daysUntil: null };
  }

  const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
  const dateFormatted = formatDateInline(nextDate);

  // Forfalt = kun når kontrollens måned+år er i fortiden (ikke bare dato passert)
  const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  if (controlMonthValue < currentMonthValue) {
    return { status: 'forfalt', label: `${Math.abs(daysUntil)} dager over`, class: 'status-overdue', date: dateFormatted, daysUntil };
  } else if (daysUntil < 0) {
    // Current month but date has passed — show as overdue within month
    return { status: 'forfaller', label: `${Math.abs(daysUntil)} dager over`, class: 'status-this-week', date: dateFormatted, daysUntil };
  } else if (daysUntil <= 7) {
    return { status: 'denne-uke', label: `${daysUntil} dager`, class: 'status-this-week', date: dateFormatted, daysUntil };
  } else if (daysUntil <= 30) {
    return { status: 'snart', label: `${daysUntil} dager`, class: 'status-soon', date: dateFormatted, daysUntil };
  } else if (daysUntil <= 60) {
    return { status: 'neste-mnd', label: `${daysUntil} dager`, class: 'status-next-month', date: dateFormatted, daysUntil };
  } else if (daysUntil <= 90) {
    return { status: 'ok', label: `${daysUntil} dager`, class: 'status-ok', date: dateFormatted, daysUntil };
  }
  return { status: 'god', label: formatDate(nextDate), class: 'status-good', date: dateFormatted, daysUntil };
}

// Render customer list in sidebar
function renderCustomerList(customerData) {
  // Group by area/poststed first
  const groupedByArea = {};
  customerData.forEach(customer => {
    const area = customer.poststed || 'Ukjent område';
    if (!groupedByArea[area]) {
      groupedByArea[area] = [];
    }
    groupedByArea[area].push(customer);
  });

  // Sort areas by postnummer (ascending), then alphabetically
  const sortedAreas = Object.keys(groupedByArea).sort((a, b) => {
    const customerA = groupedByArea[a][0];
    const customerB = groupedByArea[b][0];
    const postnummerA = customerA?.postnummer || '9999';
    const postnummerB = customerB?.postnummer || '9999';
    if (postnummerA !== postnummerB) {
      return postnummerA.localeCompare(postnummerB);
    }
    return a.localeCompare(b);
  });

  // Sort customers within each area alphabetically by name
  sortedAreas.forEach(area => {
    sortByNavn(groupedByArea[area]);
  });

  // Count urgent/warning customers per area
  const getAreaStats = (customers) => {
    let urgent = 0, warning = 0;
    customers.forEach(c => {
      const status = getControlStatus(c);
      if (status.class === 'overdue') urgent++;
      else if (status.class === 'warning') warning++;
    });
    return { urgent, warning };
  };

  // Empty state
  if (customerData.length === 0) {
    if (customerList) {
      const isFiltered = customers.length > 0;
      customerList.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--color-text-secondary,#a0a0a0);">
          <i class="fas ${isFiltered ? 'fa-filter' : 'fa-users'}" style="font-size:32px;margin-bottom:12px;display:block;opacity:0.5;"></i>
          <p style="font-size:15px;margin:0 0 8px;">${isFiltered ? 'Ingen kunder matcher filteret' : 'Ingen kunder lagt til enn\u00e5'}</p>
          <p style="font-size:13px;margin:0;opacity:0.7;">${isFiltered ? 'Pr\u00f8v \u00e5 endre s\u00f8k eller filter' : 'Klikk + for \u00e5 legge til din f\u00f8rste kunde'}</p>
        </div>
      `;
    }
    return;
  }

  // Render list with area sections
  let html = '';
  sortedAreas.forEach((area) => {
    const areaCustomers = groupedByArea[area];
    const postnummer = areaCustomers[0]?.postnummer || '';
    const isExpanded = localStorage.getItem(`areaExpanded-${area}`) === 'true';
    const stats = getAreaStats(areaCustomers);

    // Build status badges
    let statusBadges = '';
    if (stats.urgent > 0) {
      statusBadges += `<span class="area-badge urgent">${stats.urgent}</span>`;
    }
    if (stats.warning > 0) {
      statusBadges += `<span class="area-badge warning">${stats.warning}</span>`;
    }

    html += `
      <div class="customer-section">
        <button class="section-header" data-area="${escapeHtml(area)}" data-action="toggleSection">
          <span class="section-toggle-icon">
            <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}"></i>
          </span>
          <span class="section-title">
            <span class="section-postnr">${postnummer}</span>
            <span class="section-name">${escapeHtml(area)}</span>
          </span>
          <span class="section-meta">
            ${statusBadges}
            <span class="section-count">${areaCustomers.length}</span>
          </span>
        </button>
        <div class="section-content ${isExpanded ? '' : 'collapsed'}">
          ${areaCustomers.map(customer => {
            const controlStatus = getControlStatus(customer);
            const nextDate = customer.neste_kontroll
              ? formatDateInline(new Date(customer.neste_kontroll))
              : 'Ikke satt';
            const daysUntil = customer.neste_kontroll
              ? Math.ceil((new Date(customer.neste_kontroll) - new Date()) / (1000 * 60 * 60 * 24))
              : null;

            let daysText = '';
            if (daysUntil !== null) {
              if (daysUntil < 0) {
                daysText = `${Math.abs(daysUntil)}d over`;
              } else if (daysUntil === 0) {
                daysText = 'I dag';
              } else {
                daysText = `${daysUntil}d`;
              }
            }

            const hasEmail = customer.epost && customer.epost.trim() !== '';
            return `
              <div class="customer-item ${selectedCustomers.has(customer.id) ? 'selected' : ''} ${controlStatus.class}"
                   data-id="${customer.id}" data-action="selectCustomer" data-customer-id="${customer.id}">
                <div class="customer-status-indicator ${controlStatus.class}"></div>
                <div class="customer-info">
                  <h3>${escapeHtml(customer.navn)}</h3>
                  <p>${escapeHtml(customer.adresse)}</p>
                </div>
                <div class="customer-actions">
                  <button class="customer-email-btn ${hasEmail ? '' : 'disabled'}"
                          data-action="sendEmail"
                          data-customer-id="${customer.id}"
                          title="${hasEmail ? 'Send e-post' : 'Ingen e-post registrert'}">
                    <i class="fas fa-envelope"></i>
                  </button>
                </div>
                <div class="customer-control-info">
                  <span class="control-date ${controlStatus.class}">${escapeHtml(nextDate)}</span>
                  ${daysText ? `<span class="control-days ${controlStatus.class}">${escapeHtml(daysText)}</span>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });

  customerList.innerHTML = html;
  // Event listeners are handled via event delegation in setupEventListeners()
  // Using data-action attributes on elements for CSP compliance and memory efficiency
}

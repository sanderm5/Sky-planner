// Load customers from API
async function loadCustomers() {
  Logger.log('loadCustomers() called, supercluster:', !!supercluster);
  try {
    const response = await apiFetch('/api/kunder');
    if (!response.ok) throw new Error(`HTTP ${response.status}: Kunne ikke laste kunder`);
    const result = await response.json();
    customers = result.data || result; // Handle both { data: [...] } and direct array
    Logger.log('loadCustomers() fetched', customers.length, 'customers');
    applyFilters(); // Handles both renderCustomerList(filtered) and renderMarkers(filtered)

    // If no office location is configured, fit map to all customers
    if (!appConfig.routeStartLat && !appConfig.routeStartLng && customers.length > 0 && map) {
      const customersWithCoords = customers.filter(c => c.lat && c.lng);
      if (customersWithCoords.length > 0) {
        const bounds = boundsFromCustomers(customersWithCoords);
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 1000 });
        }
      }
    }
    renderCustomerAdmin();
    updateOverdueBadge();
    renderMissingData(); // Update missing data badge and lists
    updateDashboard(); // Update dashboard stats
    updateGettingStartedBanner(); // Show/hide getting started banner

    // Reveal sidebar/filter panels if they were hidden for new users
    if (customers.length > 0 && typeof showAppPanels === 'function') {
      showAppPanels();
    }

    // Update onboarding checklist progress and attention badges
    if (typeof refreshChecklistState === 'function') refreshChecklistState();
    if (typeof refreshAttentionBadges === 'function') refreshAttentionBadges();

    // Load avtaler and subcategory assignments in parallel
    if (!weekPlanState.weekStart) initWeekPlanState(new Date());
    await Promise.all([
      loadAvtaler(),
      loadAllSubcategoryAssignments()
    ]);
  } catch (error) {
    console.error('Feil ved lasting av kunder:', error);
  }
}

// Getting started banner removed — onboarding now uses inline address card + checklist
function updateGettingStartedBanner() {}
function dismissGettingStartedBanner() {}

// Load områder for filter
async function loadOmrader() {
  try {
    const response = await apiFetch('/api/omrader');
    if (!response.ok) throw new Error(`HTTP ${response.status}: Kunne ikke laste områder`);
    const omrResult = await response.json();
    omrader = omrResult.data || omrResult;
    renderOmradeFilter();
  } catch (error) {
    console.error('Feil ved lasting av områder:', error);
  }
}

// Render område filter dropdown
function renderOmradeFilter() {
  const filterContainer = document.getElementById('omradeFilter');
  if (!filterContainer) return;

  filterContainer.innerHTML = `
    <div style="display:flex;gap:4px;align-items:center;">
      <select id="omradeSelect" style="flex:1;">
        <option value="alle">Alle områder</option>
        <option value="varsler">Trenger kontroll</option>
        ${omrader.map(o => `<option value="${escapeHtml(o.poststed)}">${escapeHtml(o.poststed)} (${o.antall})</option>`).join('')}
      </select>
      <button id="showOverdueInAreaBtn" class="btn btn-small btn-warning" style="display:none;white-space:nowrap;" title="Vis forfalte i området på kartet">
        <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
      </button>
    </div>
  `;

  // Use event delegation on filterContainer to avoid memory leaks
  // Remove old listener by replacing with clone, then add new one
  const oldSelect = document.getElementById('omradeSelect');
  const newSelect = oldSelect.cloneNode(true);
  oldSelect.parentNode.replaceChild(newSelect, oldSelect);

  newSelect.addEventListener('change', (e) => {
    currentFilter = e.target.value;
    showOnlyWarnings = currentFilter === 'varsler';
    applyFilters();

    // Vis/skjul knapp for å vise forfalte i valgt område
    const overdueBtn = document.getElementById('showOverdueInAreaBtn');
    if (overdueBtn) {
      overdueBtn.style.display = (currentFilter !== 'alle' && currentFilter !== 'varsler') ? 'inline-flex' : 'none';
    }
  });

  // Knapp: vis forfalte i valgt område på kartet
  const overdueBtn = document.getElementById('showOverdueInAreaBtn');
  if (overdueBtn) {
    overdueBtn.addEventListener('click', () => {
      const currentMonthValue = new Date().getFullYear() * 12 + new Date().getMonth();
      const overdueInArea = customers.filter(c => {
        if (c.poststed !== currentFilter) return false;
        const nextDate = getNextControlDate(c);
        if (!nextDate) return false;
        const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
        return controlMonthValue < currentMonthValue;
      });
      if (overdueInArea.length === 0) {
        showToast('Ingen forfalte kontroller i dette området', 'info');
        return;
      }
      const ids = overdueInArea.map(c => c.id);
      showCustomersOnMap(ids);
      highlightCustomersOnMap(ids);
      showToast(`${overdueInArea.length} forfalte kontroller i ${currentFilter}`, 'warning');
    });
  }
}

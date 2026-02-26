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

// Show or hide the getting started banner based on customer count
function updateGettingStartedBanner() {
  const existing = document.getElementById('gettingStartedBanner');

  // Remove banner if customers exist
  if (customers.length > 0) {
    if (existing) existing.remove();
    return;
  }

  // Don't show if user has dismissed it
  if (localStorage.getItem('gettingStartedDismissed') === 'true') {
    return;
  }

  // Don't show if banner already exists
  if (existing) return;

  // Create and insert banner
  const banner = document.createElement('div');
  banner.id = 'gettingStartedBanner';
  banner.className = 'getting-started-banner';
  banner.innerHTML = renderGettingStartedBanner();

  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer) {
    mapContainer.appendChild(banner);
  }

  // Event delegation for banner actions (avoids inline onclick for CSP compliance)
  banner.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'dismiss-getting-started') {
      dismissGettingStartedBanner();
    } else if (action === 'open-integrations') {
      window.open(target.dataset.url, '_blank');
    } else if (action === 'contact-import') {
      window.location.href = target.dataset.url;
    } else if (action === 'add-customer-manual') {
      dismissGettingStartedBanner();
      addCustomer();
    }
  });
}

// Render getting started banner HTML
function renderGettingStartedBanner() {
  const webUrl = appConfig.webUrl || '';

  return `
    <div class="getting-started-header">
      <div>
        <h2>Velkommen til Sky Planner!</h2>
        <p>Legg til dine kunder for å komme i gang.</p>
      </div>
      <button class="getting-started-close" data-action="dismiss-getting-started" title="Lukk">
        <i aria-hidden="true" class="fas fa-times"></i>
      </button>
    </div>
    <div class="getting-started-cards">
      <div class="getting-started-card" data-action="open-integrations" data-url="${escapeHtml(webUrl)}/dashboard/innstillinger/integrasjoner">
        <div class="getting-started-card-icon">
          <i aria-hidden="true" class="fas fa-plug"></i>
        </div>
        <h3>Koble til regnskapssystem</h3>
        <p>Synkroniser kunder fra Tripletex, Fiken eller PowerOffice.</p>
      </div>
      <div class="getting-started-card" data-action="contact-import" data-url="mailto:support@skyplanner.no?subject=Hjelp med dataimport">
        <div class="getting-started-card-icon">
          <i aria-hidden="true" class="fas fa-file-import"></i>
        </div>
        <h3>Importer eksisterende data</h3>
        <p>Har du data i Excel eller annet format? Kontakt oss, s&aring; hjelper vi deg.</p>
      </div>
      <div class="getting-started-card" data-action="add-customer-manual">
        <div class="getting-started-card-icon">
          <i aria-hidden="true" class="fas fa-plus-circle"></i>
        </div>
        <h3>Legg til manuelt</h3>
        <p>Opprett kunder en og en direkte i systemet.</p>
      </div>
    </div>
  `;
}

// Dismiss getting started banner
function dismissGettingStartedBanner() {
  localStorage.setItem('gettingStartedDismissed', 'true');
  const banner = document.getElementById('gettingStartedBanner');
  if (banner) {
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-20px)';
    setTimeout(() => banner.remove(), 300);
  }
}

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

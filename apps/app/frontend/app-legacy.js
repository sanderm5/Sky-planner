// @ts-nocheck
// State
let map;
// Single map architecture - map is always visible behind login/app overlays
let markers = {};
let markerClusterGroup = null;
let selectedCustomers = new Set();
let customers = [];
let routeLayer = null;
let routeMarkers = [];
let avtaler = [];
let omrader = [];
let currentFilter = 'alle';
let showOnlyWarnings = false;
let selectedCategory = 'all'; // 'all', 'El-Kontroll', 'Brannvarsling', 'El-Kontroll + Brannvarsling'
let selectedDriftskategori = localStorage.getItem('selectedDriftskategori') || 'all'; // 'all', 'Storfe', 'Sau', 'Geit', 'Gris', 'Gartneri'
let selectedBrannsystem = localStorage.getItem('selectedBrannsystem') || 'all'; // 'all', 'Elotec', 'ICAS', etc.
let selectedElType = localStorage.getItem('selectedElType') || 'all'; // 'all', 'Landbruk', 'Næring', 'Bolig', etc.
let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();
let calendarViewMode = 'month'; // 'month' or 'week'
let currentWeekStart = null; // Date object for start of current week view
let filterAbortController = null; // For å unngå race condition i applyFilters

// Organization Dynamic Fields
let organizationFields = [];
let organizationCategories = [];
let dynamicFieldFilters = {}; // { field_name: value or { min, max } or { from, to } }
let teamMembersData = []; // Store team members for event delegation

// SPA View State
let currentView = 'login'; // 'login' or 'app'
let appInitialized = false;

// Theme State
let currentTheme = localStorage.getItem('theme') || 'dark';

// Application Configuration
let appConfig = {};

// Authentication token (managed via httpOnly cookies, variable kept for backward compat)
let authToken = null;
let subscriptionInfo = null; // { status, trialEndsAt, planType } - populated from login/verify
let accessTokenExpiresAt = null; // Token expiry timestamp - for proactive refresh

// ========================================
// ACCESSIBLE MODAL HELPERS
// Wraps modal open/close with focus trap
// ========================================
function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('hidden');
  if (typeof FocusTrap !== 'undefined') {
    const content = modalEl.querySelector('.modal-content') || modalEl;
    FocusTrap.activate(content);
  }
}
function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  if (typeof FocusTrap !== 'undefined') {
    const content = modalEl.querySelector('.modal-content') || modalEl;
    FocusTrap.deactivate(content);
  }
}

// ========================================
// TAB CLEANUP REGISTRY
// Prevents memory leaks from accumulated event listeners
// ========================================
const tabCleanupFunctions = {
  calendar: null,
  overdue: null,
  warnings: null,
  planner: null,
  customers: null,
  statistikk: null,
  missingdata: null,
  admin: null
};

// Cleanup function runner
function runTabCleanup(tabName) {
  if (tabName && tabCleanupFunctions[tabName]) {
    tabCleanupFunctions[tabName]();
    tabCleanupFunctions[tabName] = null;
  }
}


// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Start inactivity tracking
  startInactivityTracking();
  // Attach event listeners for elements previously using inline handlers (CSP security)
  const stopImpersonationBtn = document.getElementById('stopImpersonationBtn');
  if (stopImpersonationBtn) stopImpersonationBtn.addEventListener('click', () => stopImpersonation());

  const smartDaysAhead = document.getElementById('smartDaysAhead');
  if (smartDaysAhead) smartDaysAhead.addEventListener('input', function() {
    document.getElementById('smartDaysAheadValue').textContent = this.value + ' dager';
  });

  const smartMaxCustomers = document.getElementById('smartMaxCustomers');
  if (smartMaxCustomers) smartMaxCustomers.addEventListener('input', function() {
    document.getElementById('smartMaxCustomersValue').textContent = this.value + ' kunder';
  });

  const smartClusterRadius = document.getElementById('smartClusterRadius');
  if (smartClusterRadius) smartClusterRadius.addEventListener('input', function() {
    document.getElementById('smartClusterRadiusValue').textContent = this.value + ' km';
  });

  const refreshSmartBtn = document.getElementById('refreshSmartRecommendationsBtn');
  if (refreshSmartBtn) refreshSmartBtn.addEventListener('click', () => renderSmartRecommendations());

  // Initialize theme immediately (before any content renders)
  initializeTheme();

  // Load configuration first
  await loadConfig();

  // Apply branding from config
  applyBranding();

  // ALWAYS initialize the shared map first (it's visible behind login overlay)
  initSharedMap();

  // Set up login form handler
  initLoginView();

  // Check if already logged in
  const isAuthenticated = await checkExistingAuth();

  if (isAuthenticated) {
    // Check for impersonation or super-admin redirect
    const isImpersonatingCheck = localStorage.getItem('isImpersonating') === 'true';
    const isSuperAdminCheck = localStorage.getItem('isSuperAdmin') === 'true';

    // If super-admin and NOT impersonating, redirect to admin panel
    if (isSuperAdminCheck && !isImpersonatingCheck) {
      window.location.href = '/admin';
      return;
    }

    // If impersonating, show the impersonation banner
    if (isImpersonatingCheck) {
      const banner = document.getElementById('impersonationBanner');
      const orgName = localStorage.getItem('impersonatingOrgName') || 'Ukjent bedrift';
      if (banner) {
        document.getElementById('impersonatingOrgName').textContent = orgName;
        banner.style.display = 'flex';
        document.body.classList.add('is-impersonating');
      }
    }

    // Already logged in - skip to app view directly (no animation)
    const loginOverlay = document.getElementById('loginOverlay');
    const appView = document.getElementById('appView');

    // Hide login overlay, show app
    if (loginOverlay) loginOverlay.classList.add('hidden');
    if (appView) appView.classList.remove('hidden');

    currentView = 'app';
    appInitialized = true;

    // Enable map interactivity for app mode
    if (map) {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoom.enable();
      map.keyboard.enable();
      L.control.zoom({ position: 'topright' }).addTo(map);

      // Set to app view position
      map.setView([67.5, 15.0], 6, { animate: false });
    }

    // Initialize DOM and app
    initDOMElements();
    initMap(); // Add map features (clustering, borders, etc.)
    // Load categories and fields first so markers render with correct icons
    await loadOrganizationCategories();
    await loadOrganizationFields();
    // Then load customers (renders markers using serviceTypeRegistry)
    loadCustomers();
    loadOmrader();
    initWebSocket();

    // Show user bar with name
    showUserBar();

    // Setup event listeners
    setupEventListeners();

    // Initialize chat system
    initChat();
    initChatEventListeners();
  } else {
    // Not logged in - login overlay is already visible by default
    currentView = 'login';

    // Hide tab navigation and sidebar toggle when not logged in
    const tabNavigation = document.querySelector('.tab-navigation');
    if (tabNavigation) {
      tabNavigation.style.opacity = '0';
      tabNavigation.style.pointerEvents = 'none';
    }
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
      sidebarToggle.style.opacity = '0';
      sidebarToggle.style.pointerEvents = 'none';
    }
  }
});

// Initialize the app after successful login
async function initializeApp() {
  Logger.log('initializeApp() starting...');

  // Initialize DOM references
  initDOMElements();

  // Initialize map features (clustering, borders, etc.)
  // The base map is already created by initSharedMap()
  initMap();
  Logger.log('initializeApp() after initMap, markerClusterGroup:', !!markerClusterGroup);

  // Load categories and fields first so markers render with correct icons
  try {
    await Promise.all([
      loadOrganizationCategories(),
      loadOrganizationFields()
    ]);
  } catch (err) {
    console.error('Error loading org config:', err);
  }

  // Then load remaining data in parallel
  Promise.all([
    loadCustomers(),
    loadOmrader()
  ]).then(() => {
    Logger.log('initializeApp() all data loaded');
  }).catch(err => {
    console.error('Error loading initial data:', err);
  });

  initWebSocket();

  // Setup event listeners
  setupEventListeners();

  // Initialize misc event listeners (import, map legend)
  initMiscEventListeners();

  // Update map legend with current service types
  updateMapLegend();

  // Apply MVP mode UI changes based on organization settings
  applyMvpModeUI();

  // Initialize Today's Work feature
  initTodaysWork();

  // Initialize chat system
  initChat();
  initChatEventListeners();

  Logger.log('initializeApp() complete');
}

// Setup all event listeners
function setupEventListeners() {
  // Patch notes
  checkForNewPatchNotes();
  document.getElementById('patchNotesLink')?.addEventListener('click', () => {
    loadAndShowPatchNotes(0);
  });

  // Logout button - use SPA logout
  document.getElementById('logoutBtnMain')?.addEventListener('click', handleLogout);

  // Nightmode toggle button (map tiles)
  document.getElementById('nightmodeBtn')?.addEventListener('click', toggleNightMode);

  // Theme toggle button (UI light/dark mode)
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);

  // Dashboard action cards
  document.querySelectorAll('.dashboard-actions .action-card').forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      if (action === 'showOverdueTab') {
        switchToTab('overdue');
      } else if (action === 'showRoutesTab') {
        switchToTab('routes');
      } else if (action === 'showCalendarTab') {
        switchToTab('calendar');
      }
    });
  });

  // Add event listeners with null checks
  searchInput?.addEventListener('input', debounce(() => filterCustomers(), 200));
  addCustomerBtn?.addEventListener('click', addCustomer);
  planRouteBtn?.addEventListener('click', planRoute);
  clearSelectionBtn?.addEventListener('click', clearSelection);

  // Mobile route FAB
  document.getElementById('mobileRouteFabBtn')?.addEventListener('click', planRoute);
  customerForm?.addEventListener('submit', saveCustomer);
  document.getElementById('cancelBtn')?.addEventListener('click', () => {
    releaseCustomer(currentClaimedKundeId);
    closeModal(customerModal);
  });
  document.getElementById('deleteCustomerBtn')?.addEventListener('click', deleteCustomer);
  document.getElementById('geocodeBtn')?.addEventListener('click', handleGeocode);
  document.getElementById('pickFromMapBtn')?.addEventListener('click', enableCoordinatePicking);

  // Setup address autocomplete and postnummer lookup
  setupAddressAutocomplete();

  // Kategori-endring oppdaterer synlige kontroll-seksjoner
  document.getElementById('kategori')?.addEventListener('change', (e) => {
    updateControlSectionsVisibility(e.target.value);
  });
  document.getElementById('saveApiKey')?.addEventListener('click', saveApiKey);

  // Warning actions
  document.getElementById('selectWarningsBtn')?.addEventListener('click', selectCustomersNeedingControl);

  // Customer admin tab
  document.getElementById('addCustomerBtnTab')?.addEventListener('click', addCustomer);
  document.getElementById('importCustomersBtn')?.addEventListener('click', showImportModal);

  // Export dropdown
  const exportBtn = document.getElementById('exportCustomersBtn');
  const exportDropdown = document.getElementById('exportDropdown');
  if (exportBtn && exportDropdown) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdown.classList.toggle('hidden');
    });
    exportDropdown.querySelectorAll('.export-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        const format = opt.dataset.format;
        exportDropdown.classList.add('hidden');
        try {
          const exportHeaders = {};
          const exportCsrf = getCsrfToken();
          if (exportCsrf) exportHeaders['X-CSRF-Token'] = exportCsrf;
          const response = await fetch(`/api/export/kunder?format=${format}`, {
            headers: exportHeaders,
            credentials: 'include'
          });
          if (!response.ok) throw new Error('Eksport feilet');
          const blob = await response.blob();
          const disposition = response.headers.get('Content-Disposition') || '';
          const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
          const filename = filenameMatch ? filenameMatch[1] : `kunder.${format}`;
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = filename;
          link.click();
          URL.revokeObjectURL(link.href);
          showNotification(`Eksportert ${format.toUpperCase()} med suksess`, 'success');
        } catch (err) {
          showNotification('Eksport feilet: ' + err.message, 'error');
        }
      });
    });
    // Close dropdown when clicking outside
    document.addEventListener('click', () => exportDropdown.classList.add('hidden'));
  }

  // Integration buttons in customer modal
  document.getElementById('pushToTripletexBtn')?.addEventListener('click', () => {
    const kundeId = Number(document.getElementById('customerId').value);
    if (kundeId) pushCustomerToTripletex(kundeId);
  });

  document.getElementById('createEkkReportBtn')?.addEventListener('click', async () => {
    const kundeId = Number(document.getElementById('customerId').value);
    if (!kundeId) return;
    try {
      const response = await apiFetch('/api/ekk/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kunde_id: kundeId, report_type: 'elkontroll' }),
      });
      const data = await response.json();
      if (data.success) {
        showNotification('EKK-rapport opprettet som utkast', 'success');
      } else {
        showNotification(data.error?.message || 'Kunne ikke opprette rapport', 'error');
      }
    } catch (err) {
      showNotification('Feil ved oppretting av EKK-rapport', 'error');
    }
  });

  document.getElementById('closeImportModal')?.addEventListener('click', closeImportModal);
  document.getElementById('customerSearchInput')?.addEventListener('input', (e) => {
    customerAdminSearch = e.target.value;
    renderCustomerAdmin();
  });

  // Kategori tabs
  document.getElementById('kategoriTabs')?.addEventListener('click', async (e) => {
    const tab = e.target.closest('.kategori-tab');
    if (!tab) return;

    // Update active state
    document.querySelectorAll('.kategori-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Filter - update both variables
    customerAdminKategori = tab.dataset.kategori;
    // Map kategori tab values to selectedCategory values
    if (customerAdminKategori === 'alle') {
      selectedCategory = 'all';
    } else {
      selectedCategory = customerAdminKategori;
    }

    renderCustomerAdmin();
    await applyFilters();
  });

  // Customer list toggle
  const toggleListBtn = document.getElementById('toggleCustomerList');
  const customerAdminList = document.getElementById('customerAdminList');

  if (toggleListBtn && customerAdminList) {
    toggleListBtn.addEventListener('click', () => {
      customerAdminList.classList.toggle('collapsed');
      toggleListBtn.classList.toggle('collapsed');
      localStorage.setItem('customerListCollapsed', customerAdminList.classList.contains('collapsed'));
    });

    // Restore state
    if (localStorage.getItem('customerListCollapsed') === 'true') {
      customerAdminList.classList.add('collapsed');
      toggleListBtn.classList.add('collapsed');
    }
  }

  // Sidebar toggle functionality
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      // Don't toggle collapsed on mobile
      if (window.innerWidth <= 768) return;

      sidebar.classList.toggle('collapsed');
      // Save preference to localStorage
      const isCollapsed = sidebar.classList.contains('collapsed');
      localStorage.setItem('sidebarCollapsed', isCollapsed);
    });

    // Restore sidebar state from localStorage (only on desktop)
    const wasCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (wasCollapsed && window.innerWidth > 768) {
      sidebar.classList.add('collapsed');
    }
  }

  // Customer list toggle functionality
  const customerListToggle = document.getElementById('customerListToggle');
  const customerListContainer = document.getElementById('customerListContainer');

  if (customerListToggle && customerListContainer) {
    customerListToggle.addEventListener('click', () => {
      customerListContainer.classList.toggle('hidden');
      customerListToggle.classList.toggle('collapsed');
      localStorage.setItem('customerListHidden', customerListContainer.classList.contains('hidden'));
    });

    // Restore customer list state from localStorage
    const wasHidden = localStorage.getItem('customerListHidden') === 'true';
    if (wasHidden) {
      customerListContainer.classList.add('hidden');
      customerListToggle.classList.add('collapsed');
    }
  }

  // Upcoming controls widget

  // Close modals on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      releaseCustomer(currentClaimedKundeId);
      closeModal(customerModal);
      closeModal(apiKeyModal);
    }
  });

  // Close modal on X button click
  document.getElementById('closeCustomerModal')?.addEventListener('click', () => {
    releaseCustomer(currentClaimedKundeId);
    closeModal(customerModal);
  });
  document.getElementById('closeApiKeyModal')?.addEventListener('click', () => {
    closeModal(apiKeyModal);
  });
  // Close modal on backdrop click
  customerModal.addEventListener('click', (e) => {
    if (e.target === customerModal) {
      releaseCustomer(currentClaimedKundeId);
      closeModal(customerModal);
    }
  });
  apiKeyModal.addEventListener('click', (e) => {
    if (e.target === apiKeyModal) {
      closeModal(apiKeyModal);
    }
  });
  // Avtale modal event listeners
  document.getElementById('closeAvtaleModal')?.addEventListener('click', closeAvtaleModal);
  document.getElementById('cancelAvtale')?.addEventListener('click', closeAvtaleModal);
  document.getElementById('avtaleForm')?.addEventListener('submit', saveAvtale);
  document.getElementById('deleteAvtaleBtn')?.addEventListener('click', deleteAvtale);
  document.getElementById('deleteAvtaleSeriesBtn')?.addEventListener('click', deleteAvtaleSeries);
  document.getElementById('avtaleModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'avtaleModal') closeAvtaleModal();
  });

  // Setup kunde search in avtale modal
  setupAvtaleKundeSearch();

  // Kontaktlogg event listeners
  document.getElementById('addKontaktBtn')?.addEventListener('click', addKontaktlogg);
  document.getElementById('kontaktNotat')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKontaktlogg();
    }
  });
  document.getElementById('kontaktloggList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="deleteKontakt"]');
    if (btn) {
      deleteKontaktlogg(btn.dataset.id);
    }
  });

  // Kontaktpersoner event listeners
  document.getElementById('addKontaktpersonBtn')?.addEventListener('click', addKontaktperson);
  document.getElementById('kontaktpersonNavn')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKontaktperson();
    }
  });
  document.getElementById('kontaktpersonerList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="deleteKontaktperson"]');
    if (btn) {
      deleteKontaktperson(btn.dataset.id);
    }
  });

  // Tag event listeners
  document.getElementById('addKundeTagBtn')?.addEventListener('click', () => {
    const select = document.getElementById('kundeTagSelect');
    const kundeId = document.getElementById('customerId')?.value;
    if (select.value && kundeId) {
      addTagToKunde(Number.parseInt(kundeId), Number.parseInt(select.value));
    }
  });
  document.getElementById('manageTagsBtn')?.addEventListener('click', openTagManager);
  document.getElementById('kundeTagsList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="removeKundeTag"]');
    if (btn) {
      removeTagFromKunde(Number.parseInt(btn.dataset.kundeId), Number.parseInt(btn.dataset.tagId));
    }
  });

  // Tab switching functionality
  const tabItems = document.querySelectorAll('.tab-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const contentPanel = document.getElementById('contentPanel');
  const contentPanelOverlay = document.getElementById('contentPanelOverlay');
  const panelTitle = document.getElementById('panelTitle');
  const contentPanelClose = document.getElementById('contentPanelClose');

  // Tab name to title mapping
  const tabTitles = {
    'dashboard': 'Dashboard',
    'customers': 'Kunder',
    'overdue': 'Forfalte',
    'warnings': 'Kommende kontroller',
    'calendar': 'Kalender',
    'weekly-plan': 'Planlagte oppdrag',
    'planner': 'Planlegger',
    'statistikk': 'Statistikk',
    'missingdata': 'Mangler data',
    'chat': 'Meldinger',
    'admin': 'Admin'
  };

  // Open content panel
  function openContentPanel() {
    if (contentPanel) {
      contentPanel.classList.remove('closed');
      contentPanel.classList.add('open');
      localStorage.setItem('contentPanelOpen', 'true');

      // On mobile, default to half-height mode
      if (isMobile && document.getElementById('bottomTabBar')) {
        contentPanel.classList.add('half-height');
        contentPanel.classList.remove('full-height');
        contentPanelMode = 'half';
      }
    }
    if (contentPanelOverlay && window.innerWidth <= 768 && contentPanelMode === 'full') {
      contentPanelOverlay.classList.add('visible');
    }
  }

  // Close content panel
  function closeContentPanel() {
    if (contentPanel) {
      contentPanel.classList.add('closed');
      contentPanel.classList.remove('open', 'half-height', 'full-height');
      localStorage.setItem('contentPanelOpen', 'false');
      contentPanelMode = 'closed';
    }
    if (contentPanelOverlay) {
      contentPanelOverlay.classList.remove('visible');
    }
  }

  // Close button click
  if (contentPanelClose) {
    contentPanelClose.addEventListener('click', () => {
      closeContentPanel();
      // Reset bottom tab bar to Kart when closing content panel
      if (isMobile && document.getElementById('bottomTabBar')) {
        document.querySelectorAll('.bottom-tab-item').forEach(b =>
          b.classList.toggle('active', b.dataset.bottomTab === 'map')
        );
        activeBottomTab = 'map';
        const fab = document.getElementById('mobileSearchFab');
        if (fab) fab.classList.remove('hidden');
      }
    });
  }

  // Overlay click to close (mobile)
  if (contentPanelOverlay) {
    contentPanelOverlay.addEventListener('click', () => {
      closeContentPanel();
      if (isMobile && document.getElementById('bottomTabBar')) {
        document.querySelectorAll('.bottom-tab-item').forEach(b =>
          b.classList.toggle('active', b.dataset.bottomTab === 'map')
        );
        activeBottomTab = 'map';
        const fab = document.getElementById('mobileSearchFab');
        if (fab) fab.classList.remove('hidden');
      }
    });
  }

  // Swipe gesture on content panel header for half/full toggle (mobile)
  if (contentPanel) {
    const panelHeader = contentPanel.querySelector('.content-panel-header');
    if (panelHeader) {
      let panelSwipeStartY = 0;

      panelHeader.addEventListener('touchstart', (e) => {
        panelSwipeStartY = e.touches[0].clientY;
      }, { passive: true });

      panelHeader.addEventListener('touchend', (e) => {
        if (!isMobile || !panelSwipeStartY) return;
        const diff = panelSwipeStartY - e.changedTouches[0].clientY;
        panelSwipeStartY = 0;

        // Swipe up: half → full
        if (diff > 50 && contentPanelMode === 'half') {
          contentPanel.classList.remove('half-height');
          contentPanel.classList.add('full-height');
          contentPanelMode = 'full';
          if (contentPanelOverlay) contentPanelOverlay.classList.add('visible');
        }
        // Swipe down: full → half
        else if (diff < -50 && contentPanelMode === 'full') {
          contentPanel.classList.remove('full-height');
          contentPanel.classList.add('half-height');
          contentPanelMode = 'half';
          if (contentPanelOverlay) contentPanelOverlay.classList.remove('visible');
        }
        // Swipe down: half → close
        else if (diff < -50 && contentPanelMode === 'half') {
          closeContentPanel();
          if (document.getElementById('bottomTabBar')) {
            document.querySelectorAll('.bottom-tab-item').forEach(b =>
              b.classList.toggle('active', b.dataset.bottomTab === 'map')
            );
            activeBottomTab = 'map';
            const fab = document.getElementById('mobileSearchFab');
            if (fab) fab.classList.remove('hidden');
          }
        }
      }, { passive: true });
    }
  }

  tabItems.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = tab.getAttribute('data-tab');

      // Cleanup previous tab's event listeners before switching
      const prevTab = document.querySelector('.tab-item.active')?.dataset.tab;
      if (prevTab) {
        runTabCleanup(prevTab);
      }

      // Deactivate weekly plan area-select mode when leaving that tab
      if (prevTab === 'weekly-plan') {
        if (weekPlanState.activeDay) {
          weekPlanState.activeDay = null;
          if (areaSelectMode) toggleAreaSelect();
        }
        // Reset team focus - restore all markers
        if (wpFocusedTeamMember) {
          wpFocusedTeamMember = null;
          wpFocusedMemberIds = null;
          applyTeamFocusToMarkers();
          if (markerClusterGroup) markerClusterGroup.refreshClusters();
        }
        // Close route summary if open
        closeWpRouteSummary();
      }

      // Remove active class from all tabs and panes
      tabItems.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tabPanes.forEach(p => p.classList.remove('active'));

      // Add active class to clicked tab and corresponding pane
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const tabPane = document.getElementById(`tab-${tabName}`);
      if (tabPane) {
        tabPane.classList.add('active');

        // Fjern compact-mode slik at alle faner kan scrolle
        contentPanel.classList.remove('compact-mode');

        // Update panel title
        if (panelTitle) {
          panelTitle.textContent = tabTitles[tabName] || tabName;
        }

        // Open content panel
        openContentPanel();

        // Sync map to tab context on mobile
        syncMapToTab(tabName);

        // Save active tab to localStorage
        localStorage.setItem('activeTab', tabName);

        // On mobile, close sidebar when opening content panel
        const isMobile = window.innerWidth <= 768;
        if (isMobile && typeof closeMobileSidebar === 'function') {
          closeMobileSidebar();
        }

        // Render content for the active tab
        if (tabName === 'overdue') {
          renderOverdue();
        } else if (tabName === 'warnings') {
          renderWarnings();
        } else if (tabName === 'calendar') {
          renderCalendar();
          openCalendarSplitView();
        } else if (tabName === 'weekly-plan') {
          renderWeeklyPlan();
        } else if (tabName === 'planner') {
          renderPlanner();
        } else if (tabName === 'email') {
          loadEmailData();
        } else if (tabName === 'statistikk') {
          renderStatistikk();
        } else if (tabName === 'missingdata') {
          renderMissingData();
        } else if (tabName === 'customers') {
          renderCustomerAdmin();
        } else if (tabName === 'admin') {
          loadAdminData();
        } else if (tabName === 'todays-work') {
          loadTodaysWork();
        } else if (tabName === 'chat') {
          onChatTabOpened();
        }
      }
    });
  });

  // Restore saved tab and content panel state
  const savedTab = localStorage.getItem('activeTab');
  const savedPanelState = localStorage.getItem('contentPanelOpen');

  // Always open content panel on desktop by default
  if (window.innerWidth > 768 && savedPanelState !== 'false') {
    openContentPanel();
  }

  // On mobile with bottom tab bar, start on map view (don't restore saved tab)
  const hasMobileTabBar = window.innerWidth <= 768;
  if (!hasMobileTabBar) {
    if (savedTab) {
      const savedTabBtn = document.querySelector(`.tab-item[data-tab="${savedTab}"]`);
      if (savedTabBtn) {
        setTimeout(() => {
          savedTabBtn.click();
        }, 100);
      }
    } else {
      // Click dashboard tab by default
      const dashboardTab = document.querySelector('.tab-item[data-tab="dashboard"]');
      if (dashboardTab) {
        setTimeout(() => dashboardTab.click(), 100);
      }
    }
  }

  // Email event listeners
  document.getElementById('sendTestEmailBtn')?.addEventListener('click', sendTestEmail);
  document.getElementById('triggerEmailCheckBtn')?.addEventListener('click', triggerEmailCheck);

  // Open/close test email panel
  document.getElementById('openTestEmailBtn')?.addEventListener('click', () => {
    document.getElementById('emailTestPanel')?.classList.remove('hidden');
  });
  document.getElementById('closeTestPanel')?.addEventListener('click', () => {
    document.getElementById('emailTestPanel')?.classList.add('hidden');
  });

  // Config card toggle
  document.getElementById('toggleEmailConfig')?.addEventListener('click', () => {
    document.getElementById('emailConfigCard')?.classList.toggle('collapsed');
  });

  // Overdue sort select
  document.getElementById('overdueSortSelect')?.addEventListener('change', () => {
    renderOverdue();
  });

  // Warning sort select
  document.getElementById('warningSortSelect')?.addEventListener('change', () => {
    renderWarnings();
  });

  // Proximity radius sliders (synced, persisted to localStorage)
  const savedRadius = getProximityRadius();
  const initProximitySlider = (sliderId, valueId, renderFn) => {
    const slider = document.getElementById(sliderId);
    const valueEl = document.getElementById(valueId);
    if (!slider) return;
    slider.value = savedRadius;
    if (valueEl) valueEl.textContent = `${savedRadius} km`;
    slider.addEventListener('input', () => {
      const val = Number(slider.value);
      if (valueEl) valueEl.textContent = `${val} km`;
      localStorage.setItem('proximity_radiusKm', val);
      // Sync the other slider
      document.querySelectorAll('.proximity-settings input[type="range"]').forEach(s => {
        if (s !== slider) s.value = val;
      });
      document.querySelectorAll('.proximity-radius-value').forEach(el => {
        el.textContent = `${val} km`;
      });
      renderFn();
    });
  };
  initProximitySlider('overdueProximityRadius', 'overdueProximityRadiusValue', renderOverdue);
  initProximitySlider('warningProximityRadius', 'warningProximityRadiusValue', renderWarnings);

  // Overdue map and route buttons
  document.getElementById('showOverdueOnMapBtn')?.addEventListener('click', showOverdueOnMap);
  document.getElementById('createOverdueRouteBtn')?.addEventListener('click', createOverdueRoute);

  // History filter
  document.getElementById('historyFilter')?.addEventListener('change', (e) => {
    loadEmailHistory(e.target.value);
  });

  // Email toggle in customer modal
  document.getElementById('emailAktiv')?.addEventListener('change', (e) => {
    const emailOptions = document.getElementById('emailOptions');
    if (emailOptions) {
      emailOptions.classList.toggle('hidden', !e.target.checked);
    }
  });

  // Filter panel toggle (collapse/expand)
  const filterPanelToggle = document.getElementById('filterPanelToggle');
  const filterPanel = document.getElementById('filterPanel');

  if (filterPanelToggle && filterPanel) {
    // Restore state from localStorage
    const wasCollapsed = localStorage.getItem('filterPanelCollapsed') === 'true';
    if (wasCollapsed) {
      filterPanel.classList.add('collapsed');
    }

    filterPanelToggle.addEventListener('click', () => {
      filterPanel.classList.toggle('collapsed');
      const isCollapsed = filterPanel.classList.contains('collapsed');
      localStorage.setItem('filterPanelCollapsed', isCollapsed);
    });
  }

  // Update total customer count
  function updateCustomerCount() {
    const countEl = document.getElementById('totalCustomerCount');
    if (countEl) {
      countEl.textContent = customers.length;
    }
  }

  // Category filter buttons (kun kategori, ikke drift)
  document.querySelectorAll('.category-btn[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state for category buttons only
      document.querySelectorAll('.category-btn[data-category]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Apply filter
      selectedCategory = btn.dataset.category;
      applyFilters();
    });
  });

  // Kundetype filter toggle (collapse/expand)
  const elTypeFilterToggle = document.getElementById('elTypeFilterToggle');
  const elTypeFilterButtons = document.getElementById('elTypeFilterButtons');
  if (elTypeFilterToggle && elTypeFilterButtons) {
    elTypeFilterToggle.addEventListener('click', () => {
      const isHidden = elTypeFilterButtons.style.display === 'none';
      elTypeFilterButtons.style.display = isHidden ? 'flex' : 'none';
      const icon = elTypeFilterToggle.querySelector('.toggle-icon');
      if (icon) {
        icon.classList.toggle('fa-chevron-right', !isHidden);
        icon.classList.toggle('fa-chevron-down', isHidden);
      }
    });
  }

  // Driftskategori filter toggle (collapse/expand)
  const driftFilterToggle = document.getElementById('driftFilterToggle');
  const driftFilterButtons = document.getElementById('driftFilterButtons');
  if (driftFilterToggle && driftFilterButtons) {
    driftFilterToggle.addEventListener('click', () => {
      const isHidden = driftFilterButtons.style.display === 'none';
      driftFilterButtons.style.display = isHidden ? 'flex' : 'none';
      const icon = driftFilterToggle.querySelector('.toggle-icon');
      if (icon) {
        icon.classList.toggle('fa-chevron-right', !isHidden);
        icon.classList.toggle('fa-chevron-down', isHidden);
      }
    });
  }

  // Brannsystem filter toggle (collapse/expand)
  const brannsystemFilterToggle = document.getElementById('brannsystemFilterToggle');
  const brannsystemFilterButtons = document.getElementById('brannsystemFilterButtons');
  if (brannsystemFilterToggle && brannsystemFilterButtons) {
    brannsystemFilterToggle.addEventListener('click', () => {
      const isHidden = brannsystemFilterButtons.style.display === 'none';
      brannsystemFilterButtons.style.display = isHidden ? 'flex' : 'none';
      const icon = brannsystemFilterToggle.querySelector('.toggle-icon');
      if (icon) {
        icon.classList.toggle('fa-chevron-right', !isHidden);
        icon.classList.toggle('fa-chevron-down', isHidden);
      }
    });
  }

  // Driftskategori filter buttons
  document.querySelectorAll('.drift-btn[data-drift]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state for drift buttons only
      document.querySelectorAll('.drift-btn[data-drift]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Apply filter
      selectedDriftskategori = btn.dataset.drift;
      // Save to localStorage
      localStorage.setItem('selectedDriftskategori', selectedDriftskategori);
      applyFilters();
    });
  });

  // Restore saved drift filter state on load
  const savedDrift = localStorage.getItem('selectedDriftskategori');
  if (savedDrift) {
    const savedBtn = document.querySelector(`.drift-btn[data-drift="${savedDrift}"]`);
    if (savedBtn) {
      document.querySelectorAll('.drift-btn[data-drift]').forEach(b => b.classList.remove('active'));
      savedBtn.classList.add('active');
    }
  }

  // Call once customers are loaded
  setTimeout(updateCustomerCount, 500);

  // Initialize WebSocket for real-time updates
  initWebSocket();

  // Auto-update day counters every minute to ensure accuracy
  setInterval(() => {
    updateDayCounters();
  }, 60 * 1000); // Every 60 seconds

  // Also update at midnight to ensure day changes are reflected
  scheduleNextMidnightUpdate();

  // Technician dispatch handler for weekly plan (admin only)
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('wp-dispatch-select')) {
      weekPlanState.globalAssignedTo = e.target.value;
      renderWeeklyPlan();
    }
  });

  // Estimated time input handler for weekly plan
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('wp-time-input')) {
      const input = e.target;
      const day = input.dataset.day;
      const customerId = Number.parseInt(input.dataset.customerId);
      const val = Math.max(5, parseInt(input.value) || 30);
      input.value = val;
      const item = weekPlanState.days[day]?.planned.find(c => c.id === customerId);
      if (item) {
        item.estimertTid = val;
        const dayEl = input.closest('.wp-day');
        const summaryEl = dayEl?.querySelector('.wp-day-summary');
        const badgeEl = dayEl?.querySelector('.wp-time-badge');
        const total = getDayEstimatedTotal(day);
        const dayPlanned = weekPlanState.days[day].planned.length;
        const dayExisting = avtaler.filter(a => a.dato === weekPlanState.days[day].date).length;
        if (summaryEl) summaryEl.textContent = `${dayPlanned + dayExisting} kunder · ~${formatMinutes(total)}`;
        if (badgeEl) badgeEl.textContent = `~${formatMinutes(total)}`;
      }
    }
  });

  // Global event delegation for data-action buttons (CSP-compliant)
  document.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    switch (action) {
      case 'focusOnCustomer':
        focusOnCustomer(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'toggleCustomerSelection':
        toggleCustomerSelection(Number.parseInt(actionEl.dataset.customerId));
        break;
      // === Weekly Plan actions ===
      case 'setActiveDay':
        e.stopPropagation();
        const clickedDay = actionEl.dataset.day;
        if (weekPlanState.activeDay === clickedDay) {
          // Deselect if clicking same day
          weekPlanState.activeDay = null;
          if (areaSelectMode) toggleAreaSelect();
          renderWeeklyPlan();
        } else {
          weekPlanState.activeDay = clickedDay;
          if (!areaSelectMode) toggleAreaSelect();
          showToast(`Dra over kunder på kartet for ${weekDayLabels[weekDayKeys.indexOf(clickedDay)]}`, 'info');
          renderWeeklyPlan();
        }
        break;
      case 'removeFromPlan':
        e.stopPropagation();
        const rmDay = actionEl.dataset.day;
        const rmId = Number.parseInt(actionEl.dataset.customerId);
        if (weekPlanState.days[rmDay]) {
          weekPlanState.days[rmDay].planned = weekPlanState.days[rmDay].planned.filter(c => c.id !== rmId);
          refreshTeamFocus();
          renderWeeklyPlan();
        }
        break;
      case 'deleteAvtale':
        e.stopPropagation();
        {
          const delId = actionEl.dataset.avtaleId;
          const delName = actionEl.dataset.avtaleName || 'denne avtalen';
          const confirmDel = await showConfirm(`Slett avtale for ${delName}?`, 'Slett');
          if (confirmDel) {
            try {
              const delResp = await apiFetch(`/api/avtaler/${delId}`, { method: 'DELETE' });
              if (delResp.ok) {
                showToast('Avtale slettet', 'success');
                await loadAvtaler();
                refreshTeamFocus();
                renderWeeklyPlan();
              } else {
                const delErr = await delResp.json().catch(() => ({}));
                showToast(delErr.error?.message || 'Kunne ikke slette avtale', 'error');
              }
            } catch (delError) {
              showToast('Feil ved sletting', 'error');
            }
          }
        }
        break;
      case 'wpAddSearchResult':
        e.stopPropagation();
        if (actionEl.classList.contains('disabled')) break;
        {
          const searchCustId = Number.parseInt(actionEl.dataset.customerId);
          const searchCust = customers.find(c => c.id === searchCustId);
          if (searchCust) {
            // Auto-select first day if none active
            if (!weekPlanState.activeDay) {
              weekPlanState.activeDay = weekDayKeys[0];
            }
            addCustomersToWeekPlan([searchCust]);
            const srchInput = document.getElementById('wpCustomerSearch');
            if (srchInput) srchInput.value = '';
            const srchResults = document.getElementById('wpSearchResults');
            if (srchResults) srchResults.style.display = 'none';
          }
        }
        break;
      case 'saveWeeklyPlan':
        e.stopPropagation();
        await saveWeeklyPlan();
        break;
      case 'clearWeekPlan':
        e.stopPropagation();
        clearWeekPlan();
        break;
      case 'weekPlanPrev':
        e.stopPropagation();
        if (getWeekPlanTotalPlanned() > 0) {
          const confirmNav = await showConfirm('Du har ulagrede endringer. Vil du bytte uke?', 'Bytt uke');
          if (!confirmNav) break;
        }
        closeWpRouteSummary();
        initWeekPlanState(addDaysToDate(weekPlanState.weekStart, -7));
        renderWeeklyPlan();
        break;
      case 'weekPlanNext':
        e.stopPropagation();
        if (getWeekPlanTotalPlanned() > 0) {
          const confirmNavNext = await showConfirm('Du har ulagrede endringer. Vil du bytte uke?', 'Bytt uke');
          if (!confirmNavNext) break;
        }
        closeWpRouteSummary();
        initWeekPlanState(addDaysToDate(weekPlanState.weekStart, 7));
        renderWeeklyPlan();
        break;
      case 'setEstimatedTime':
        e.stopPropagation();
        {
          const etDay = actionEl.dataset.day;
          const etId = Number.parseInt(actionEl.dataset.customerId);
          const etVal = Math.max(5, parseInt(actionEl.value) || 30);
          const etItem = weekPlanState.days[etDay]?.planned.find(c => c.id === etId);
          if (etItem) {
            etItem.estimertTid = etVal;
            // Update summary text without full re-render
            const summaryEl = actionEl.closest('.wp-day')?.querySelector('.wp-day-summary');
            const badgeEl = actionEl.closest('.wp-day')?.querySelector('.wp-time-badge');
            const total = getDayEstimatedTotal(etDay);
            const dayPlanned = weekPlanState.days[etDay].planned.length;
            const dayExisting = avtaler.filter(a => a.dato === weekPlanState.days[etDay].date).length;
            if (summaryEl) summaryEl.textContent = `${dayPlanned + dayExisting} kunder · ~${formatMinutes(total)}`;
            if (badgeEl) badgeEl.textContent = `~${formatMinutes(total)}`;
          }
        }
        break;
      case 'wpOptimizeOrder':
        e.stopPropagation();
        await wpOptimizeOrder(actionEl.dataset.day);
        break;
      case 'wpNavigateDay':
        e.stopPropagation();
        await wpNavigateDay(actionEl.dataset.day);
        break;
      case 'closeWpRoute':
        e.stopPropagation();
        closeWpRouteSummary();
        break;
      case 'wpExportMaps':
        e.stopPropagation();
        wpExportToMaps();
        break;
      case 'focusTeamMember':
        e.stopPropagation();
        focusTeamMemberOnMap(actionEl.dataset.memberName);
        break;

      case 'quickAddToday':
        e.stopPropagation();
        const todayCustomerId = Number.parseInt(actionEl.dataset.customerId);
        const todayCustomerName = actionEl.dataset.customerName;
        await quickAddAvtaleForDate(todayCustomerId, todayCustomerName, formatDateISO(new Date()));
        closeCalendarQuickMenu();
        break;
      case 'quickAddToSplitDay':
        e.stopPropagation();
        if (splitViewOpen && splitViewState.activeDay) {
          const splitCId = Number.parseInt(actionEl.dataset.customerId);
          const splitCName = actionEl.dataset.customerName;
          await quickAddAvtaleForDate(splitCId, splitCName, splitViewState.activeDay);
        }
        break;
      case 'showCalendarQuickMenu':
        e.stopPropagation();
        showCalendarQuickMenu(
          Number.parseInt(actionEl.dataset.customerId),
          actionEl.dataset.customerName,
          actionEl
        );
        break;
      case 'quickAddAvtale':
        e.stopPropagation();
        const qaCustomerId = Number.parseInt(actionEl.dataset.customerId);
        const qaCustomerName = actionEl.dataset.customerName;
        const qaDate = actionEl.dataset.quickDate;
        await quickAddAvtaleForDate(qaCustomerId, qaCustomerName, qaDate);
        closeCalendarQuickMenu();
        break;
      case 'addCustomerToCalendar':
        closeCalendarQuickMenu();
        const calCustomerId = Number.parseInt(actionEl.dataset.customerId);
        const calCustomerName = actionEl.dataset.customerName;
        openAvtaleModal(null, null);
        // Pre-fill kunde i avtale-modalen
        setTimeout(() => {
          const kundeSearch = document.getElementById('avtaleKundeSearch');
          const kundeHidden = document.getElementById('avtaleKunde');
          if (kundeSearch) kundeSearch.value = calCustomerName;
          if (kundeHidden) kundeHidden.value = calCustomerId;
        }, 100);
        break;
      case 'editCustomer':
        editCustomer(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'navigateToCustomer':
        navigateToCustomer(
          Number.parseFloat(actionEl.dataset.lat),
          Number.parseFloat(actionEl.dataset.lng),
          actionEl.dataset.name
        );
        break;
      case 'createRouteForArea':
        createRouteForAreaYear(actionEl.dataset.area, Number.parseInt(actionEl.dataset.year));
        break;
      case 'addClusterToRoute':
        const ids = actionEl.dataset.customerIds.split(',').map(id => Number.parseInt(id));
        addClusterToRoute(ids);
        break;
      case 'zoomToCluster':
        zoomToCluster(Number.parseFloat(actionEl.dataset.lat), Number.parseFloat(actionEl.dataset.lng));
        break;
      case 'filterByElType':
        selectedElType = actionEl.dataset.value;
        localStorage.setItem('selectedElType', selectedElType);
        renderElTypeFilter();
        applyFilters();
        map.closePopup();
        break;
      case 'filterByBrannsystem':
        selectedBrannsystem = actionEl.dataset.value;
        localStorage.setItem('selectedBrannsystem', selectedBrannsystem);
        renderBrannsystemFilter();
        applyFilters();
        map.closePopup();
        break;
      case 'filterByDrift':
        selectedDriftskategori = actionEl.dataset.value;
        localStorage.setItem('selectedDriftskategori', selectedDriftskategori);
        renderDriftskategoriFilter();
        applyFilters();
        map.closePopup();
        break;
      case 'sendReminder':
      case 'sendEmail':
        e.stopPropagation();
        sendManualReminder(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'createRouteFromGroup':
        e.stopPropagation();
        const groupIds = actionEl.dataset.customerIds.split(',').map(id => Number.parseInt(id));
        createRouteFromCustomerIds(groupIds);
        break;
      case 'showGroupOnMap':
        e.stopPropagation();
        const mapIds = actionEl.dataset.customerIds.split(',').map(id => Number.parseInt(id));
        showCustomersOnMap(mapIds);
        highlightCustomersOnMap(mapIds);
        break;
      case 'addGroupToWeekPlan':
        e.stopPropagation();
        showWeekPlanDayPicker(actionEl.dataset.customerIds, actionEl);
        break;
      case 'showClusterOnMap':
        SmartRouteEngine.showClusterOnMap(Number.parseInt(actionEl.dataset.clusterId));
        break;
      case 'createRouteFromCluster':
        SmartRouteEngine.createRouteFromCluster(Number.parseInt(actionEl.dataset.clusterId));
        break;
      case 'toggleShowAllRecommendations':
        toggleShowAllRecommendations();
        break;
      case 'editAvtale':
        e.stopPropagation();
        const editAvtaleId = Number.parseInt(actionEl.dataset.avtaleId);
        const editAvtale = avtaler.find(a => a.id === editAvtaleId);
        if (editAvtale) openAvtaleModal(editAvtale);
        break;
      case 'quickDeleteAvtale':
        e.stopPropagation();
        const delAvtaleId = Number.parseInt(actionEl.dataset.avtaleId);
        const delAvtale = avtaler.find(a => a.id === delAvtaleId);
        const delName = delAvtale?.kunder?.navn || delAvtale?.kunde_navn || 'denne avtalen';
        const delConfirmed = await showConfirm(
          `Slett avtale for ${delName}?`,
          'Bekreft sletting'
        );
        if (!delConfirmed) break;
        try {
          const delResponse = await apiFetch(`/api/avtaler/${delAvtaleId}`, { method: 'DELETE' });
          if (delResponse.ok) {
            showToast('Avtale slettet', 'success');
            await loadAvtaler();
            renderCalendar();
          } else {
            showToast('Kunne ikke slette avtalen', 'error');
          }
        } catch (err) {
          console.error('Error quick-deleting avtale:', err);
          showToast('Kunne ikke slette avtalen', 'error');
        }
        break;
      case 'quickMarkVisited':
        e.stopPropagation();
        quickMarkVisited(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'openDayDetail':
        const date = actionEl.dataset.date;
        openAvtaleModal(null, date);
        break;
      case 'toggleSection':
        e.preventDefault();
        const sectionArea = actionEl.dataset.area;
        const sectionContent = actionEl.nextElementSibling;
        const sectionIcon = actionEl.querySelector('.section-toggle-icon i');
        if (sectionContent && sectionIcon) {
          const isCollapsed = sectionContent.classList.contains('collapsed');
          if (isCollapsed) {
            sectionContent.classList.remove('collapsed');
            sectionIcon.classList.remove('fa-chevron-right');
            sectionIcon.classList.add('fa-chevron-down');
            localStorage.setItem(`areaExpanded-${sectionArea}`, 'true');
          } else {
            sectionContent.classList.add('collapsed');
            sectionIcon.classList.remove('fa-chevron-down');
            sectionIcon.classList.add('fa-chevron-right');
            localStorage.setItem(`areaExpanded-${sectionArea}`, 'false');
          }
        }
        break;
      case 'selectCustomer':
        // Skip if clicking on email button (already has its own handler)
        if (e.target.closest('[data-action="sendEmail"]')) return;
        const selectCustomerId = Number.parseInt(actionEl.dataset.customerId);
        focusOnCustomer(selectCustomerId);
        toggleCustomerSelection(selectCustomerId);
        break;
      case 'editTeamMember':
        e.stopPropagation();
        const editMemberId = Number.parseInt(actionEl.dataset.memberId);
        const editMember = teamMembersData.find(m => m.id === editMemberId);
        if (editMember) openTeamMemberModal(editMember);
        break;
      case 'deleteTeamMember':
        e.stopPropagation();
        const deleteMemberId = Number.parseInt(actionEl.dataset.memberId);
        const deleteMember = teamMembersData.find(m => m.id === deleteMemberId);
        if (deleteMember) deleteTeamMember(deleteMember);
        break;
    }
  });

  // Keyboard delegation for non-button data-action elements (WCAG 2.1.1)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    // Let native buttons/links/inputs handle their own keyboard events
    if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(actionEl.tagName)) return;
    e.preventDefault();
    actionEl.click();
  });

  // Arrow key navigation within tablist (WCAG tab pattern)
  const tabNav = document.querySelector('[role="tablist"]');
  if (tabNav) {
    tabNav.addEventListener('keydown', (e) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const tabs = [...tabNav.querySelectorAll('[role="tab"]:not([style*="display: none"])')];
      const current = tabs.indexOf(document.activeElement);
      if (current === -1) return;
      e.preventDefault();
      let next;
      if (e.key === 'ArrowDown') next = (current + 1) % tabs.length;
      else if (e.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      tabs[next].focus();
      tabs[next].click();
    });
  }

}
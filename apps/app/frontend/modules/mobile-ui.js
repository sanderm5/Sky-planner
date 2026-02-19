// ============================================
// MOBILE RESPONSIVENESS
// ============================================

let isMobile = window.innerWidth <= 768;
let contentPanelMode = 'closed'; // 'half' | 'full' | 'closed'
let touchStartY = 0;
let sidebarOpen = false;
let mobileFilterSheetExpanded = false;
let moreMenuOpen = false;
let activeBottomTab = 'map';

function initMobileUI() {
  // Check if mobile
  isMobile = window.innerWidth <= 768;

  if (isMobile) {
    initBottomTabBar();
  }

  // Listen for resize
  window.addEventListener('resize', debounce(() => {
    const wasMobile = isMobile;
    isMobile = window.innerWidth <= 768;

    if (isMobile && !wasMobile) {
      initBottomTabBar();
    } else if (!isMobile && wasMobile) {
      removeBottomTabBar();
    }
  }, 250));
}

// ============================================
// PATCH NOTES / NYHETER
// ============================================

const PATCH_NOTES_STORAGE_KEY = 'skyplanner_lastSeenPatchNote';

async function checkForNewPatchNotes() {
  try {
    const lastSeenId = parseInt(localStorage.getItem(PATCH_NOTES_STORAGE_KEY) || '0', 10);
    const csrfToken = getCsrfToken();
    const headers = {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch('/api/patch-notes/latest-id', {
      credentials: 'include',
      headers
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.data && result.data.latestId > lastSeenId) {
      showPatchNotesBadge();
      await loadAndShowPatchNotes(lastSeenId);
    }
  } catch (err) {
    console.warn('Could not check patch notes:', err);
  }
}

async function loadAndShowPatchNotes(sinceId) {
  try {
    const csrfToken = getCsrfToken();
    const headers = {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const url = sinceId > 0 ? `/api/patch-notes?since=${sinceId}` : '/api/patch-notes';
    const response = await fetch(url, {
      credentials: 'include',
      headers
    });
    if (!response.ok) return;
    const result = await response.json();
    const notes = result.data || [];
    if (notes.length === 0) {
      showPatchNotesEmptyState();
      return;
    }
    showPatchNotesModal(notes);
    const latestId = Math.max(...notes.map(n => n.id));
    localStorage.setItem(PATCH_NOTES_STORAGE_KEY, String(latestId));
    hidePatchNotesBadge();
  } catch (err) {
    console.warn('Could not load patch notes:', err);
  }
}

function showPatchNotesEmptyState() {
  const existing = document.getElementById('patchNotesModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'patchNotesModal';
  modal.className = 'patch-notes-overlay';
  modal.innerHTML = `<div class="patch-notes-modal">
    <div class="patch-notes-modal-header">
      <h2><i class="fas fa-bullhorn"></i> Nyheter</h2>
      <button class="patch-notes-close" id="closePatchNotesBtn" aria-label="Lukk">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="patch-notes-modal-body" style="display:flex;align-items:center;justify-content:center;text-align:center;min-height:200px;">
      <div>
        <i class="fas fa-newspaper" style="font-size:48px;color:var(--color-text-muted, #999);margin-bottom:16px;display:block;"></i>
        <p style="font-size:16px;color:var(--color-text-secondary, #666);margin:0 0 8px;">Ingen nyheter enn\u00e5</p>
        <p style="font-size:13px;color:var(--color-text-muted, #999);margin:0;">Nye funksjoner og oppdateringer vil vises her.</p>
      </div>
    </div>
    <div class="patch-notes-modal-footer">
      <button class="patch-notes-close-btn" id="closePatchNotesFooterBtn">Lukk</button>
    </div>
  </div>`;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#closePatchNotesBtn').addEventListener('click', closeModal);
  modal.querySelector('#closePatchNotesFooterBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

function showPatchNotesModal(notes) {
  const existing = document.getElementById('patchNotesModal');
  if (existing) existing.remove();

  const typeLabels = { nytt: 'Nytt', forbedring: 'Forbedring', fiks: 'Fiks' };
  const typeColors = { nytt: '#10b981', forbedring: '#3b82f6', fiks: '#f59e0b' };

  let contentHtml = '';
  for (const note of notes) {
    const dateStr = new Date(note.published_at).toLocaleDateString('nb-NO', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    const itemsHtml = (note.items || []).map(item => {
      const typeLabel = typeLabels[item.type] || item.type;
      const typeColor = typeColors[item.type] || '#666';
      const proBadge = item.visibility === 'full'
        ? '<span class="patch-note-pro-badge">Pro</span>'
        : '';
      const tabLink = item.tab
        ? `<button class="patch-note-tab-link" data-patch-tab="${escapeHtml(item.tab)}">Vis <i class="fas fa-arrow-right"></i></button>`
        : '';
      const descHtml = item.description
        ? `<span class="patch-note-description">${escapeHtml(item.description)}</span>`
        : '';
      return `<li class="patch-note-item">
        <span class="patch-note-type" style="background: ${typeColor};">${escapeHtml(typeLabel)}</span>
        <div class="patch-note-item-content">
          <span class="patch-note-text">${escapeHtml(item.text)}${proBadge}${tabLink}</span>
          ${descHtml}
        </div>
      </li>`;
    }).join('');

    contentHtml += `<div class="patch-note-release">
      <div class="patch-note-release-header">
        <span class="patch-note-version">${escapeHtml(note.version)}</span>
        <span class="patch-note-date">${escapeHtml(dateStr)}</span>
      </div>
      <h3 class="patch-note-title">${escapeHtml(note.title)}</h3>
      ${note.summary ? `<p class="patch-note-summary">${escapeHtml(note.summary)}</p>` : ''}
      <ul class="patch-note-items">${itemsHtml}</ul>
    </div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'patchNotesModal';
  modal.className = 'patch-notes-overlay';
  modal.innerHTML = `<div class="patch-notes-modal">
    <div class="patch-notes-modal-header">
      <h2><i class="fas fa-bullhorn"></i> Nyheter</h2>
      <button class="patch-notes-close" id="closePatchNotesBtn" aria-label="Lukk">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="patch-notes-modal-body">${contentHtml}</div>
    <div class="patch-notes-modal-footer">
      <button class="patch-notes-close-btn" id="closePatchNotesFooterBtn">Lukk</button>
    </div>
  </div>`;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#closePatchNotesBtn').addEventListener('click', closeModal);
  modal.querySelector('#closePatchNotesFooterBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Tab navigation links
  modal.querySelectorAll('.patch-note-tab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.patchTab;
      closeModal();
      switchToTab(tabName);
    });
  });
}

function showPatchNotesBadge() {
  const badge = document.getElementById('patchNotesBadge');
  if (badge) badge.style.display = '';
}

function hidePatchNotesBadge() {
  const badge = document.getElementById('patchNotesBadge');
  if (badge) badge.style.display = 'none';
}

// ============================================
// BOTTOM TAB BAR
// ============================================

function initBottomTabBar() {
  if (document.getElementById('bottomTabBar')) return;

  document.body.classList.add('has-bottom-tab-bar');

  const hasTodaysWork = hasFeature('todays_work');

  const tabs = [
    { id: 'map', icon: 'fa-map-marker-alt', label: 'Kart', action: 'showMap' },
    { id: 'work', icon: 'fa-briefcase', label: 'Arbeid',
      action: hasTodaysWork ? 'todays-work' : 'weekly-plan' },
    { id: 'calendar', icon: 'fa-calendar-alt', label: 'Kalender', action: 'calendar' },
    { id: 'more', icon: 'fa-ellipsis-h', label: 'Mer', action: 'showMore' }
  ];

  const bar = document.createElement('nav');
  bar.id = 'bottomTabBar';
  bar.className = 'bottom-tab-bar';
  bar.setAttribute('role', 'tablist');

  tabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'bottom-tab-item' + (tab.id === 'map' ? ' active' : '');
    btn.dataset.bottomTab = tab.id;
    btn.dataset.action = tab.action;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', tab.label);
    btn.innerHTML = `<i class="fas ${tab.icon}"></i><span>${tab.label}</span>`;

    btn.addEventListener('click', () => handleBottomTabClick(tab));
    bar.appendChild(btn);
  });

  document.body.appendChild(bar);

  // Create More menu (filter sheet is lazy-created on FAB click)
  createMoreMenuOverlay();

  // Create search FAB and selection indicator
  createMobileSearchFab();
  createMobileSelectionFab();

  // Prevent body scroll
  document.body.style.overflow = 'hidden';

  // Initial badge sync
  setTimeout(syncBottomBarBadges, 500);
}

function removeBottomTabBar() {
  document.body.classList.remove('has-bottom-tab-bar');

  const bar = document.getElementById('bottomTabBar');
  if (bar) bar.remove();

  const moreMenu = document.getElementById('moreMenuOverlay');
  if (moreMenu) moreMenu.remove();

  // Move filter panel back
  restoreFilterPanel();

  const filterSheet = document.getElementById('mobileFilterSheet');
  if (filterSheet) filterSheet.remove();

  const searchFab = document.getElementById('mobileSearchFab');
  if (searchFab) searchFab.remove();

  const selectionFab = document.getElementById('mobileSelectionFab');
  if (selectionFab) selectionFab.remove();

  document.body.style.overflow = '';
  moreMenuOpen = false;
  mobileFilterSheetExpanded = false;

  // Restore sidebar for desktop
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.style.display = '';
    sidebar.classList.remove('mobile-open');
  }
}

function handleBottomTabClick(tab) {
  // Update active state
  document.querySelectorAll('.bottom-tab-item').forEach(b =>
    b.classList.toggle('active', b.dataset.bottomTab === tab.id)
  );
  activeBottomTab = tab.id;

  // Hide search FAB when leaving map tab
  const searchFab = document.getElementById('mobileSearchFab');

  if (tab.action === 'showMap') {
    // Close content panel, close more menu, show search FAB
    closeContentPanelMobile();
    closeMoreMenu();
    hideMobileFilterSheet();
    if (searchFab) searchFab.classList.remove('hidden');
  } else if (tab.action === 'showMore') {
    closeContentPanelMobile();
    hideMobileFilterSheet();
    if (searchFab) searchFab.classList.add('hidden');
    toggleMoreMenu();
  } else {
    // Open the corresponding tab in the content panel
    closeMoreMenu();
    hideMobileFilterSheet();
    if (searchFab) searchFab.classList.add('hidden');
    switchToTab(tab.action);
  }
}

function closeContentPanelMobile() {
  const cp = document.getElementById('contentPanel');
  if (cp) {
    cp.classList.add('closed');
    cp.classList.remove('open', 'half-height', 'full-height');
    contentPanelMode = 'closed';
  }
  const overlay = document.getElementById('contentPanelOverlay');
  if (overlay) overlay.classList.remove('visible');
}

// ============================================
// MORE MENU
// ============================================

function createMoreMenuOverlay() {
  if (document.getElementById('moreMenuOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'moreMenuOverlay';
  overlay.className = 'more-menu-overlay';

  const userRole = localStorage.getItem('userRole') || '';
  const userType = localStorage.getItem('userType') || '';
  const isAdmin = userType === 'bruker' || userRole === 'admin';

  const items = [
    { tab: 'dashboard', icon: 'fa-th-large', label: 'Dashboard' },
    { tab: 'customers', icon: 'fa-users', label: 'Kunder' },
    { tab: 'overdue', icon: 'fa-exclamation-triangle', label: 'Forfalte', badgeId: 'overdueBadge' },
    { tab: 'warnings', icon: 'fa-bell', label: 'Kommende', badgeId: 'upcomingBadge' },
    { tab: 'planner', icon: 'fa-route', label: 'Planlegger' },
    { tab: 'statistikk', icon: 'fa-chart-line', label: 'Statistikk' },
    { tab: 'missingdata', icon: 'fa-exclamation-circle', label: 'Mangler data', badgeId: 'missingDataBadge' },
  ];

  if (isAdmin) {
    items.push({ tab: 'admin', icon: 'fa-shield-alt', label: 'Admin' });
  }

  // Add Today's Work to More menu if it's not the primary work tab
  const hasTodaysWork = hasFeature('todays_work');
  if (!hasTodaysWork) {
    const todaysWorkTab = document.getElementById('todaysWorkTab');
    if (todaysWorkTab && todaysWorkTab.style.display !== 'none') {
      items.splice(2, 0, { tab: 'todays-work', icon: 'fa-briefcase', label: 'Dagens arbeid', badgeId: 'todaysWorkBadge' });
    }
  }

  overlay.innerHTML = `
    <div class="more-menu-header">
      <h3>Alle funksjoner</h3>
      <button class="more-menu-close" id="moreMenuCloseBtn" aria-label="Lukk">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="more-menu-grid">
      ${items.map(item => `
        <button class="more-menu-item" data-more-tab="${escapeHtml(item.tab)}">
          <i class="fas ${escapeHtml(item.icon)}"></i>
          <span>${escapeHtml(item.label)}</span>
          ${item.badgeId ? `<span class="more-menu-badge" data-mirror-badge="${escapeHtml(item.badgeId)}" style="display:none;"></span>` : ''}
        </button>
      `).join('')}
      <button class="more-menu-item" id="moreMenuPatchNotes">
        <i class="fas fa-bullhorn"></i>
        <span>Nyheter</span>
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close button
  document.getElementById('moreMenuCloseBtn').addEventListener('click', closeMoreMenu);

  // Item click handlers
  overlay.querySelectorAll('.more-menu-item[data-more-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.moreTab;
      closeMoreMenu();
      // Keep "Mer" highlighted
      document.querySelectorAll('.bottom-tab-item').forEach(b =>
        b.classList.toggle('active', b.dataset.bottomTab === 'more')
      );
      activeBottomTab = 'more';
      hideMobileFilterSheet();
      switchToTab(tabName);
    });
  });

  // Patch notes button in More menu
  document.getElementById('moreMenuPatchNotes')?.addEventListener('click', () => {
    closeMoreMenu();
    loadAndShowPatchNotes(0);
  });
}

function toggleMoreMenu() {
  const overlay = document.getElementById('moreMenuOverlay');
  if (!overlay) return;

  moreMenuOpen = !moreMenuOpen;
  overlay.classList.toggle('open', moreMenuOpen);

  // Sync badges when opening
  if (moreMenuOpen) {
    syncMoreMenuBadges();
  }
}

function closeMoreMenu() {
  const overlay = document.getElementById('moreMenuOverlay');
  if (!overlay) return;

  moreMenuOpen = false;
  overlay.classList.remove('open');
}

// ============================================
// MOBILE FILTER SHEET
// ============================================

function createMobileFilterSheet() {
  if (document.getElementById('mobileFilterSheet')) return;

  const sheet = document.createElement('div');
  sheet.id = 'mobileFilterSheet';
  sheet.className = 'mobile-filter-sheet';

  sheet.innerHTML = `
    <div class="filter-sheet-handle" id="filterSheetHandle">
      <div class="filter-sheet-search-peek">
        <i class="fas fa-search"></i>
        <span>Søk og filtrer kunder</span>
        <span class="filter-sheet-count" id="filterSheetCount">0</span>
        <button class="filter-sheet-close" id="filterSheetClose" aria-label="Lukk">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>
    <div class="filter-sheet-content" id="filterSheetContent"></div>
  `;

  document.body.appendChild(sheet);

  // Close button
  const closeBtn = document.getElementById('filterSheetClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideMobileFilterSheet();
    });
  }

  // Handle click/tap - no longer toggles, sheet opens fully via FAB
  const handle = document.getElementById('filterSheetHandle');
  if (handle) {
    // Swipe gestures on filter sheet
    let sheetTouchStartY = 0;
    handle.addEventListener('touchstart', (e) => {
      sheetTouchStartY = e.touches[0].clientY;
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      if (!sheetTouchStartY) return;
      const diff = sheetTouchStartY - e.touches[0].clientY;
      // Swipe down: close filter sheet
      if (diff < -40) {
        e.preventDefault();
        hideMobileFilterSheet();
        sheetTouchStartY = 0;
      }
    }, { passive: false });

    handle.addEventListener('touchend', () => {
      sheetTouchStartY = 0;
    }, { passive: true });
  }
}

function moveFilterPanelToSheet() {
  const filterPanel = document.querySelector('.filter-panel');
  const sheetContent = document.getElementById('filterSheetContent');
  if (filterPanel && sheetContent && !sheetContent.contains(filterPanel)) {
    filterPanel.dataset.originalParent = filterPanel.parentElement?.id || 'map-container';
    sheetContent.appendChild(filterPanel);
    filterPanel.classList.remove('collapsed');
  }
  updateFilterSheetCount();
}

function restoreFilterPanel() {
  const filterPanel = document.querySelector('.filter-panel');
  if (!filterPanel || !filterPanel.dataset.originalParent) return;

  const originalParent = document.getElementById(filterPanel.dataset.originalParent) ||
                         document.querySelector('.map-container');
  if (originalParent) {
    originalParent.appendChild(filterPanel);
    delete filterPanel.dataset.originalParent;
  }
}

function showMobileFilterSheet() {
  let sheet = document.getElementById('mobileFilterSheet');
  // Lazy-create: only build the filter sheet when first needed
  if (!sheet) {
    createMobileFilterSheet();
    moveFilterPanelToSheet();
    sheet = document.getElementById('mobileFilterSheet');
  }
  if (sheet) {
    sheet.style.setProperty('display', 'block', 'important');
    mobileFilterSheetExpanded = true;
    updateFilterSheetCount();
  }
  // Hide search FAB when filter sheet is open
  const searchFab = document.getElementById('mobileSearchFab');
  if (searchFab) searchFab.classList.add('hidden');
}

function hideMobileFilterSheet() {
  const sheet = document.getElementById('mobileFilterSheet');
  if (sheet) {
    sheet.style.setProperty('display', 'none', 'important');
    mobileFilterSheetExpanded = false;
  }
  // Show search FAB when filter sheet is closed (only on map tab)
  if (activeBottomTab === 'map') {
    const searchFab = document.getElementById('mobileSearchFab');
    if (searchFab) searchFab.classList.remove('hidden');
  }
}

function updateFilterSheetCount() {
  const countEl = document.getElementById('filterSheetCount');
  if (countEl && typeof customers !== 'undefined') {
    countEl.textContent = customers.length;
  }
}

// Search FAB - opens filter sheet on tap
function createMobileSearchFab() {
  if (document.getElementById('mobileSearchFab')) return;
  const fab = document.createElement('button');
  fab.id = 'mobileSearchFab';
  fab.className = 'mobile-search-fab';
  fab.setAttribute('aria-label', 'Søk og filtrer kunder');
  fab.innerHTML = '<i class="fas fa-search"></i>';
  fab.addEventListener('click', () => {
    showMobileFilterSheet();
  });
  document.body.appendChild(fab);
}

// Selection FAB - shows count of selected customers
function createMobileSelectionFab() {
  if (document.getElementById('mobileSelectionFab')) return;
  const fab = document.createElement('button');
  fab.id = 'mobileSelectionFab';
  fab.className = 'mobile-selection-fab';
  fab.innerHTML = '<i class="fas fa-check-circle"></i> <span id="mobileSelectionCount">0</span> valgt';
  fab.addEventListener('click', () => {
    // Open planner tab to show selected customers
    switchToTab('planner');
    if (document.getElementById('bottomTabBar')) {
      document.querySelectorAll('.bottom-tab-item').forEach(b =>
        b.classList.toggle('active', b.dataset.bottomTab === 'planner')
      );
      activeBottomTab = 'planner';
    }
  });
  document.body.appendChild(fab);
}

// Update mobile selection indicator visibility
function updateMobileSelectionFab() {
  const fab = document.getElementById('mobileSelectionFab');
  const countEl = document.getElementById('mobileSelectionCount');
  if (!fab || !countEl) return;
  if (selectedCustomers.size > 0) {
    countEl.textContent = selectedCustomers.size;
    fab.classList.add('visible');
  } else {
    fab.classList.remove('visible');
  }
}

// ============================================
// BADGE SYNCHRONIZATION
// ============================================

function syncBottomBarBadges() {
  if (!document.getElementById('bottomTabBar')) return;

  // Work tab badge - mirror from todaysWorkBadge
  const workBtn = document.querySelector('.bottom-tab-item[data-bottom-tab="work"]');
  if (workBtn) {
    const source = document.getElementById('todaysWorkBadge');
    let badge = workBtn.querySelector('.bottom-tab-badge');

    if (source && source.style.display !== 'none' && source.textContent.trim()) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'bottom-tab-badge';
        workBtn.appendChild(badge);
      }
      badge.textContent = source.textContent;
      badge.style.display = '';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  // Sync More menu badges
  syncMoreMenuBadges();

  // Update filter sheet count
  updateFilterSheetCount();
}

function syncMoreMenuBadges() {
  document.querySelectorAll('[data-mirror-badge]').forEach(el => {
    const source = document.getElementById(el.dataset.mirrorBadge);
    if (source && source.style.display !== 'none' && source.textContent.trim()) {
      el.textContent = source.textContent;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });
}

// Hook badge sync into existing update cycles
const badgeIds = ['overdueBadge', 'upcomingBadge', 'todaysWorkBadge', 'missingDataBadge'];

// Use MutationObserver to detect badge changes
function setupBadgeObserver() {
  badgeIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const observer = new MutationObserver(() => {
      syncBottomBarBadges();
    });
    observer.observe(el, { childList: true, attributes: true, attributeFilter: ['style'] });
  });
}

// Delay observer setup until badges exist
setTimeout(setupBadgeObserver, 2000);

function setupMobileInteractions() {
  const sidebar = document.querySelector('.sidebar');
  const sidebarHeader = document.querySelector('.sidebar-header');
  const filterPanel = document.querySelector('.filter-panel');
  const customersTab = document.querySelector('#tab-customers');

  if (!sidebar) return;

  // Remove collapsed class on mobile - we use bottom sheet instead
  sidebar.classList.remove('collapsed');

  // Move filter panel (customer list) into the Kunder tab on mobile
  if (filterPanel && customersTab && !customersTab.contains(filterPanel)) {
    // Store original parent for when switching back to desktop
    filterPanel.dataset.originalParent = 'map-container';
    customersTab.appendChild(filterPanel);
    filterPanel.classList.remove('collapsed');
  }

  // Touch swipe to open/close sidebar
  if (sidebarHeader) {
    sidebarHeader.addEventListener('touchstart', handleTouchStart, { passive: true });
    sidebarHeader.addEventListener('touchmove', handleTouchMove, { passive: false });
    sidebarHeader.addEventListener('touchend', handleTouchEnd, { passive: true });

    // Click to toggle
    sidebarHeader.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // Don't toggle if clicking a button
      toggleMobileSidebar();
    });
  }

  // Close sidebar when clicking on map
  const mapContainer = document.querySelector('.map-container');
  if (mapContainer) {
    mapContainer.addEventListener('click', () => {
      if (sidebarOpen) {
        closeMobileSidebar();
      }
    });
  }

  // Add mobile menu toggle button
  addMobileMenuButton();

  // Prevent body scroll when sidebar is open
  document.body.style.overflow = 'hidden';
}

function removeMobileInteractions() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.remove('mobile-open');
  }

  // Move filter panel back to map container on desktop
  const filterPanel = document.querySelector('.filter-panel');
  const mapContainer = document.querySelector('.map-container');
  if (filterPanel && mapContainer && filterPanel.dataset.originalParent === 'map-container') {
    mapContainer.appendChild(filterPanel);
    delete filterPanel.dataset.originalParent;
  }

  // Remove mobile menu button
  const mobileBtn = document.querySelector('.mobile-menu-toggle');
  if (mobileBtn) {
    mobileBtn.remove();
  }

  document.body.style.overflow = '';
}

function addMobileMenuButton() {
  // Check if already exists
  if (document.querySelector('.mobile-menu-toggle')) return;

  const btn = document.createElement('button');
  btn.className = 'mobile-menu-toggle';
  btn.innerHTML = '<i class="fas fa-bars"></i>';
  btn.setAttribute('aria-label', 'Åpne meny');

  btn.addEventListener('click', () => {
    toggleMobileSidebar();
    btn.classList.toggle('active', sidebarOpen);
    btn.innerHTML = sidebarOpen ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
  });

  document.body.appendChild(btn);
}

function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('mobile-open', sidebarOpen);

  // Update button
  const btn = document.querySelector('.mobile-menu-toggle');
  if (btn) {
    btn.classList.toggle('active', sidebarOpen);
    btn.innerHTML = sidebarOpen ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
  }
}

function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  sidebarOpen = false;
  sidebar.classList.remove('mobile-open');

  const btn = document.querySelector('.mobile-menu-toggle');
  if (btn) {
    btn.classList.remove('active');
    btn.innerHTML = '<i class="fas fa-bars"></i>';
  }
}

function openMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  sidebarOpen = true;
  sidebar.classList.add('mobile-open');

  const btn = document.querySelector('.mobile-menu-toggle');
  if (btn) {
    btn.classList.add('active');
    btn.innerHTML = '<i class="fas fa-times"></i>';
  }
}

// Touch handlers for swipe gestures
function handleTouchStart(e) {
  touchStartY = e.touches[0].clientY;
}

function handleTouchMove(e) {
  if (!touchStartY) return;

  const currentY = e.touches[0].clientY;
  const diff = touchStartY - currentY;

  // If swiping up significantly, open sidebar
  if (diff > 50 && !sidebarOpen) {
    e.preventDefault();
    openMobileSidebar();
    touchStartY = 0;
  }
  // If swiping down significantly, close sidebar
  else if (diff < -50 && sidebarOpen) {
    e.preventDefault();
    closeMobileSidebar();
    touchStartY = 0;
  }
}

function handleTouchEnd() {
  touchStartY = 0;
}

// Initialize mobile UI after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Wait a bit for other initialization
  setTimeout(initMobileUI, 100);
});

// Also handle viewport meta for better mobile experience
function setViewportHeight() {
  // Fix for mobile browsers with dynamic toolbar
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

setViewportHeight();
window.addEventListener('resize', setViewportHeight);

// Export mobile functions
window.toggleMobileSidebar = toggleMobileSidebar;
window.closeMobileSidebar = closeMobileSidebar;
window.openMobileSidebar = openMobileSidebar;
window.closeMoreMenu = closeMoreMenu;
window.syncBottomBarBadges = syncBottomBarBadges;

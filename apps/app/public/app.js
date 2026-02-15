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
let savedRoutes = [];
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
let bulkSelectedCustomers = new Set(); // For bulk "marker som ferdig" funksjon
let bulkSelectMode = false; // Toggle for checkbox-modus
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

// ========================================
// LOGGER UTILITY
// ========================================
const Logger = {
  isDev: () => {
    return window.location.hostname === 'localhost'
      || window.location.hostname === '127.0.0.1'
      || window.location.search.includes('debug=true');
  },
  log: function(...args) {
    if (this.isDev()) console.log('[DEBUG]', ...args);
  },
  warn: function(...args) {
    if (this.isDev()) console.warn('[WARN]', ...args);
  },
  error: console.error.bind(console, '[ERROR]')
};

// ========================================
// FEATURE MODULE SYSTEM
// Granular per-organization feature flags
// Replaces binary app_mode (mvp/full)
// ========================================

/**
 * Check if a specific feature module is enabled for this organization.
 * Features are loaded from the server config endpoint.
 */
function hasFeature(key) {
  return appConfig.enabledFeatures?.includes(key) ?? false;
}

/**
 * Get the configuration for a specific feature module.
 * Returns empty object if feature has no config or is not enabled.
 */
function getFeatureConfig(key) {
  return appConfig.featureConfigs?.[key] ?? {};
}

// Backwards-compatible helpers (used by existing code)
// These check enabledFeatures first, then fall back to legacy app_mode
function isFullMode() {
  // If features are loaded, check for industry-specific features
  if (appConfig.enabledFeatures && appConfig.enabledFeatures.length > 0) {
    return hasFeature('lifecycle_colors') || hasFeature('context_menu');
  }
  // Legacy fallback
  return appConfig.appMode === 'full' || localStorage.getItem('appMode') === 'full';
}

function isMvpMode() {
  return !isFullMode();
}

/**
 * Apply feature-based UI changes - hide/show elements based on enabled features.
 * Called after DOM is ready and on config changes.
 * Replaces the old binary MVP/full mode with granular feature checks.
 */
function applyMvpModeUI() {
  const isMvp = isMvpMode();

  // Elements to hide when industry-specific features are not enabled
  // Note: categoryFilterButtons is NOT hidden here — categories are shown for all companies
  const mvpHiddenElements = [
    document.getElementById('elTypeFilter'),
    document.getElementById('driftskategoriFilter'),
    document.getElementById('brannsystemFilter'),
    document.querySelector('.color-legend'),
    document.getElementById('dynamicFieldFilters'),
  ];

  mvpHiddenElements.forEach(el => {
    if (el) {
      el.style.display = isMvp ? 'none' : '';
    }
  });

  const filterHeader = document.querySelector('.filter-panel-header h3');
  if (filterHeader) {
    filterHeader.innerHTML = isMvp
      ? '<i class="fas fa-users"></i> Kunder'
      : '<i class="fas fa-filter"></i> Kunder';
  }

  Logger.log(`Feature mode UI applied: ${isMvp ? 'MVP (simplified)' : 'Full (features enabled)'}`);
  if (appConfig.enabledFeatures?.length) {
    Logger.log('Enabled features:', appConfig.enabledFeatures.join(', '));
  }
}

// ========================================
// CSRF TOKEN HELPER
// Gets CSRF token from cookie for API requests
// ========================================
function getCsrfToken() {
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ========================================
// MODAL SYSTEM - Laila-vennlige dialoger
// Erstatter alert() og confirm() med store,
// lettleste norske dialoger
// ========================================

const ModalSystem = {
  container: null,

  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.id = 'modal-system-container';
    this.container.innerHTML = `
      <div class="modal-system-overlay" style="
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        z-index: 100000;
        justify-content: center;
        align-items: center;
        padding: 20px;
      ">
        <div class="modal-system-dialog" style="
          background: var(--color-bg-secondary, #1a1a1a);
          border-radius: 16px;
          max-width: 480px;
          width: 100%;
          padding: 32px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          border: 1px solid var(--color-border, #333);
        ">
          <div class="modal-system-icon" style="
            text-align: center;
            margin-bottom: 20px;
            font-size: 48px;
          "></div>
          <h2 class="modal-system-title" style="
            font-size: 22px;
            font-weight: 600;
            color: var(--color-text-primary, #fff);
            margin: 0 0 16px 0;
            text-align: center;
            line-height: 1.4;
          "></h2>
          <p class="modal-system-message" style="
            font-size: 18px;
            color: var(--color-text-secondary, #a0a0a0);
            margin: 0 0 28px 0;
            text-align: center;
            line-height: 1.6;
          "></p>
          <div class="modal-system-buttons" style="
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
          "></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.container);
  },

  show(options) {
    this.init();
    const overlay = this.container.querySelector('.modal-system-overlay');
    const iconEl = this.container.querySelector('.modal-system-icon');
    const titleEl = this.container.querySelector('.modal-system-title');
    const messageEl = this.container.querySelector('.modal-system-message');
    const buttonsEl = this.container.querySelector('.modal-system-buttons');

    // Set icon based on type
    const icons = {
      success: '<span style="color: #4CAF50;">&#10004;</span>',
      error: '<span style="color: #DC2626;">&#10006;</span>',
      warning: '<span style="color: #FFC107;">&#9888;</span>',
      info: '<span style="color: #42A5F5;">&#8505;</span>',
      confirm: '<span style="color: #F97316;">&#63;</span>'
    };
    iconEl.innerHTML = icons[options.type] || icons.info;

    // Set title
    titleEl.textContent = options.title || '';
    titleEl.style.display = options.title ? 'block' : 'none';

    // Set message
    messageEl.textContent = options.message || '';

    // Create buttons
    buttonsEl.innerHTML = '';
    const buttonStyle = `
      min-height: 52px;
      padding: 14px 28px;
      font-size: 18px;
      font-weight: 600;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 120px;
    `;

    if (options.buttons) {
      options.buttons.forEach((btn, index) => {
        const button = document.createElement('button');
        button.textContent = btn.text;
        button.style.cssText = buttonStyle;

        if (btn.primary) {
          button.style.background = 'var(--color-accent, #F97316)';
          button.style.color = '#fff';
        } else {
          button.style.background = 'var(--color-bg-tertiary, #252525)';
          button.style.color = 'var(--color-text-primary, #fff)';
          button.style.border = '1px solid var(--color-border, #333)';
        }

        button.onclick = () => {
          this.hide();
          if (btn.onClick) btn.onClick();
        };

        // Focus first button for keyboard users
        if (index === 0) {
          setTimeout(() => button.focus(), 100);
        }

        buttonsEl.appendChild(button);
      });
    }

    // Show with animation
    overlay.style.display = 'flex';
    overlay.style.opacity = '0';
    requestAnimationFrame(() => {
      overlay.style.transition = 'opacity 0.2s';
      overlay.style.opacity = '1';
    });

    // Close on escape key (store reference for cleanup in hide())
    this._escHandler = (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this._escHandler);
  },

  hide() {
    // Clean up escape key listener to prevent memory leaks
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    const overlay = this.container?.querySelector('.modal-system-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 200);
    }
  }
};

// Vennlig melding (erstatter alert)
function showMessage(message, type = 'info', title = '') {
  const titles = {
    success: 'Fullfort',
    error: 'Feil',
    warning: 'Advarsel',
    info: 'Informasjon'
  };

  ModalSystem.show({
    type: type,
    title: title || titles[type] || '',
    message: message,
    buttons: [
      { text: 'OK', primary: true }
    ]
  });
}

// Vennlig bekreftelse (erstatter confirm) - returnerer Promise
function showConfirm(message, title = 'Bekreft') {
  return new Promise((resolve) => {
    ModalSystem.show({
      type: 'confirm',
      title: title,
      message: message,
      buttons: [
        {
          text: 'Nei',
          primary: false,
          onClick: () => resolve(false)
        },
        {
          text: 'Ja',
          primary: true,
          onClick: () => resolve(true)
        }
      ]
    });
  });
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

// ========================================
// PREMIUM SVG ICONS FOR INDUSTRIES
// ========================================
/**
 * Premium SVG icons for map markers
 * Each icon is optimized for 42px display with 2px strokes
 * Uses currentColor for white on colored backgrounds
 */
const svgIcons = {
  // El-Kontroll - Lightning bolt with energy
  'el-kontroll': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>`,

  // Brannvarsling - Elegant flame
  'brannvarsling': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>
  </svg>`,

  // Borettslag/Sameie - Building with units
  'borettslag-sameie': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2"/>
    <path d="M9 22v-4h6v4"/>
    <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/>
  </svg>`,

  // Renhold - Sparkle/clean
  'renhold': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3v5m0 8v5M5.5 8.5l3.5 3.5m6 0l3.5-3.5M3 12h5m8 0h5"/>
    <circle cx="12" cy="12" r="2"/>
  </svg>`,

  // Vaktmester - Gear/wrench combo
  'vaktmester': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>`,

  // HVAC/Ventilasjon - Fan with airflow
  'hvac-ventilasjon': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 9a9.5 9.5 0 005-7"/>
    <path d="M15 12a9.5 9.5 0 007 5"/>
    <path d="M12 15a9.5 9.5 0 00-5 7"/>
    <path d="M9 12a9.5 9.5 0 00-7-5"/>
  </svg>`,

  // Heis/Løfteutstyr - Elevator with arrows
  'heis-lofteutstyr': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2"/>
    <path d="M9 8l3-3 3 3"/>
    <path d="M9 16l3 3 3-3"/>
    <line x1="12" y1="5" x2="12" y2="19"/>
  </svg>`,

  // Sikkerhet/Vakt - Shield with checkmark
  'sikkerhet-vakt': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <path d="M9 12l2 2 4-4"/>
  </svg>`,

  // Skadedyrkontroll - Bug with strike
  'skadedyrkontroll': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 2l1.88 1.88"/>
    <path d="M14.12 3.88L16 2"/>
    <path d="M9 7.13v-1a3.003 3.003 0 116 0v1"/>
    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6"/>
    <path d="M12 20v-9"/>
    <path d="M6.53 9C4.6 8.8 3 7.1 3 5"/>
    <path d="M6 13H2"/>
    <path d="M3 21c0-2.1 1.7-3.9 3.8-4"/>
    <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/>
    <path d="M22 13h-4"/>
    <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
  </svg>`,

  // VVS/Rørlegger - Pipe with droplet
  'vvs-rorlegger': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 6a4 4 0 01-4-4"/>
    <path d="M6 6a4 4 0 014-4"/>
    <path d="M6 6v6a6 6 0 0012 0V6"/>
    <path d="M12 16v4"/>
    <path d="M8 20h8"/>
    <path d="M12 12a2 2 0 100-4 2 2 0 000 4z"/>
  </svg>`,

  // Takservice - House with roof emphasis
  'takservice': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 12l9-9 9 9"/>
    <path d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10"/>
    <path d="M9 21v-6a2 2 0 012-2h2a2 2 0 012 2v6"/>
  </svg>`,

  // Hagearbeid - Stylized leaf
  'hagearbeid': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 20A7 7 0 019.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </svg>`,

  // IT-Service - Monitor with code
  'it-service': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
    <path d="M8 9l-2 2 2 2"/>
    <path d="M16 9l2 2-2 2"/>
  </svg>`,

  // Vinduspuss - Window with sparkle
  'vinduspuss': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="12" y1="3" x2="12" y2="21"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <path d="M18 6l-3 3"/>
    <path d="M16.5 4.5l1 1"/>
  </svg>`,

  // Avfallshåndtering - Recycle arrows
  'avfallshandtering': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 19H4.815a1.83 1.83 0 01-1.57-.881 1.785 1.785 0 01-.004-1.784L7.196 9.5"/>
    <path d="M11 19h8.203a1.83 1.83 0 001.556-.89 1.784 1.784 0 00-.004-1.775L16.8 9.5"/>
    <path d="M9.5 6.5l1.474-2.381A1.829 1.829 0 0112.54 3a1.78 1.78 0 011.578.885L17 9.5"/>
    <path d="M2.5 14.5L5 12l2.5 2.5"/>
    <path d="M16.5 12L19 14.5 21.5 12"/>
    <path d="M14 6l-2-3.5L10 6"/>
  </svg>`,

  // Vedlikehold Bygg - Hammer
  'vedlikehold-bygg': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 12l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 010-3L12 9"/>
    <path d="M17.64 15L22 10.64"/>
    <path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 00-3.94-1.64H9l.92.82A6.18 6.18 0 0112 8.4v1.56l2 2h2.47l2.26 1.91"/>
  </svg>`,

  // Serviceavtaler - Handshake
  'serviceavtaler-generell': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 17a4 4 0 01-8 0v-3a3 3 0 013-3h2"/>
    <path d="M13 17a4 4 0 008 0v-3a3 3 0 00-3-3h-2"/>
    <path d="M11.5 11L9 8.5 11 7l5 4.5"/>
    <path d="M17 8l-5.5 5.5"/>
    <path d="M6 10l1 3"/>
    <path d="M18 10l-1 3"/>
  </svg>`,

  // Generisk service - Wrench (skiftenøkkel)
  'service': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
  </svg>`
};

// ========================================
// PREMIUM COLOR PALETTES FOR INDUSTRIES
// ========================================
/**
 * Premium 3-color gradients for each industry
 * Each palette has: light (highlight), primary, dark (shadow)
 */
const industryPalettes = {
  'el-kontroll':         { light: '#FBBF24', primary: '#F59E0B', dark: '#D97706' },
  'brannvarsling':       { light: '#EF4444', primary: '#DC2626', dark: '#B91C1C' },
  'borettslag-sameie':   { light: '#60A5FA', primary: '#3B82F6', dark: '#2563EB' },
  'renhold':             { light: '#22D3EE', primary: '#06B6D4', dark: '#0891B2' },
  'vaktmester':          { light: '#FCD34D', primary: '#F59E0B', dark: '#D97706' },
  'hvac-ventilasjon':    { light: '#38BDF8', primary: '#0EA5E9', dark: '#0284C7' },
  'heis-lofteutstyr':    { light: '#818CF8', primary: '#6366F1', dark: '#4F46E5' },
  'sikkerhet-vakt':      { light: '#3B82F6', primary: '#1E40AF', dark: '#1E3A8A' },
  'skadedyrkontroll':    { light: '#A3E635', primary: '#84CC16', dark: '#65A30D' },
  'vvs-rorlegger':       { light: '#22D3EE', primary: '#0891B2', dark: '#0E7490' },
  'takservice':          { light: '#A8A29E', primary: '#78716C', dark: '#57534E' },
  'hagearbeid':          { light: '#4ADE80', primary: '#22C55E', dark: '#16A34A' },
  'it-service':          { light: '#A78BFA', primary: '#8B5CF6', dark: '#7C3AED' },
  'vinduspuss':          { light: '#7DD3FC', primary: '#38BDF8', dark: '#0EA5E9' },
  'avfallshandtering':   { light: '#4ADE80', primary: '#16A34A', dark: '#15803D' },
  'vedlikehold-bygg':    { light: '#B45309', primary: '#92400E', dark: '#78350F' },
  'serviceavtaler-generell': { light: '#C4B5FD', primary: '#A855F7', dark: '#9333EA' },
  'service':                 { light: '#60A5FA', primary: '#3B82F6', dark: '#2563EB' }
};

// ========================================
// THEME SYSTEM
// ========================================

// Initialize theme on page load
function initializeTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateMapTilesForTheme(currentTheme);
}

// Toggle between light and dark theme
function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('theme', currentTheme);
  updateMapTilesForTheme(currentTheme);
}

// Update map tiles based on theme
function updateMapTilesForTheme(theme) {
  if (!map) return;

  const darkTiles = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const lightTiles = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  // Find and update the current tile layer
  map.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      const url = layer._url;
      // Only update CartoDB tiles, not satellite
      if (url && (url.includes('dark_all') || url.includes('light_all'))) {
        layer.setUrl(theme === 'dark' ? darkTiles : lightTiles);
      }
    }
  });
}

// ========================================
// SORTING UTILITIES
// ========================================

// Sort array of objects by 'navn' property using Norwegian locale
function sortByNavn(arr) {
  return arr.sort((a, b) => a.navn.localeCompare(b.navn, 'nb'));
}

// Sort strings using Norwegian locale
function compareNorwegian(a, b) {
  return a.localeCompare(b, 'nb');
}

// Get next control date for a customer (DYNAMIC via customer.services)
function getNextControlDate(customer) {
  // Use dynamic services array if available
  if (customer.services && Array.isArray(customer.services) && customer.services.length > 0) {
    // Find the earliest upcoming control date from all services
    let earliestDate = null;
    for (const service of customer.services) {
      let nextDate = null;
      if (service.neste_kontroll) {
        nextDate = new Date(service.neste_kontroll);
      } else if (service.siste_kontroll) {
        nextDate = new Date(service.siste_kontroll);
        nextDate.setMonth(nextDate.getMonth() + (service.intervall_months || 12));
      }
      if (nextDate && (!earliestDate || nextDate < earliestDate)) {
        earliestDate = nextDate;
      }
    }
    if (earliestDate) return earliestDate;
  }

  // Legacy fallback: Use hardcoded columns
  const kategori = customer.kategori || '';

  // El-Kontroll or combined
  if (kategori.includes('El-Kontroll')) {
    if (customer.neste_el_kontroll) {
      return new Date(customer.neste_el_kontroll);
    }
    if (customer.siste_el_kontroll) {
      const date = new Date(customer.siste_el_kontroll);
      date.setMonth(date.getMonth() + (customer.el_kontroll_intervall || 36));
      return date;
    }
  }

  // Brannvarsling only
  if (kategori === 'Brannvarsling') {
    if (customer.neste_brann_kontroll) {
      return new Date(customer.neste_brann_kontroll);
    }
    if (customer.siste_brann_kontroll) {
      const date = new Date(customer.siste_brann_kontroll);
      date.setMonth(date.getMonth() + (customer.brann_kontroll_intervall || 12));
      return date;
    }
  }

  // Legacy generic fields fallback
  if (customer.neste_kontroll) {
    return new Date(customer.neste_kontroll);
  }
  if (customer.siste_kontroll) {
    const date = new Date(customer.siste_kontroll);
    date.setMonth(date.getMonth() + (customer.kontroll_intervall_mnd || 12));
    return date;
  }

  return null;
}

// Get all upcoming control dates for a customer (returns array of service dates)
function getCustomerServiceDates(customer) {
  const dates = [];

  // Use dynamic services array if available
  if (customer.services && Array.isArray(customer.services)) {
    for (const service of customer.services) {
      let nextDate = null;
      if (service.neste_kontroll) {
        nextDate = new Date(service.neste_kontroll);
      } else if (service.siste_kontroll) {
        nextDate = new Date(service.siste_kontroll);
        nextDate.setMonth(nextDate.getMonth() + (service.intervall_months || 12));
      }
      if (nextDate) {
        dates.push({
          service_type_name: service.service_type_name,
          service_type_slug: service.service_type_slug,
          service_type_icon: service.service_type_icon,
          service_type_color: service.service_type_color,
          neste_kontroll: nextDate,
          siste_kontroll: service.siste_kontroll ? new Date(service.siste_kontroll) : null,
          intervall_months: service.intervall_months
        });
      }
    }
  }

  return dates;
}

// ========================================
// SERVICE TYPE REGISTRY (Multi-Industry Support)
// ========================================

/**
 * ServiceTypeRegistry - Manages dynamic service types loaded from server config
 * Replaces hardcoded 'Sky Planner', 'Brannvarsling' with configurable service types
 */
class ServiceTypeRegistry {
  constructor() {
    this.serviceTypes = new Map();
    this.intervals = [];
    this.industryTemplate = null;
    this.initialized = false;
  }

  /**
   * Initialize registry from appConfig
   */
  loadFromConfig(config) {
    this.serviceTypes.clear();

    if (config.serviceTypes && Array.isArray(config.serviceTypes)) {
      config.serviceTypes.forEach(st => {
        this.serviceTypes.set(st.slug, {
          id: st.id,
          name: st.name,
          slug: st.slug,
          icon: st.icon || 'fa-wrench',
          color: st.color || '#F97316',
          defaultInterval: st.defaultInterval || 12,
          description: st.description || '',
          subtypes: st.subtypes || [],
          equipmentTypes: st.equipmentTypes || []
        });
      });
    }

    // Fallback: Generic service type if none were loaded from config
    // This only happens for unauthenticated requests (login page) or orgs without service types
    if (this.serviceTypes.size === 0) {
      this.serviceTypes.set('service', {
        id: 0,
        name: 'Service',
        slug: 'service',
        icon: 'fa-wrench',
        color: '#F97316',
        defaultInterval: 12,
        description: 'Generell tjeneste',
        subtypes: [],
        equipmentTypes: []
      });
      Logger.log('Using generic fallback service type (no types configured for this org)');
    }

    this.intervals = config.intervals || [];
    this.industryTemplate = config.industryTemplate || null;
    this.initialized = true;

    Logger.log(`ServiceTypeRegistry loaded: ${this.serviceTypes.size} service types`);
  }

  /**
   * Load service types from an industry template (fetched from API)
   */
  async loadFromIndustry(industrySlug) {
    try {
      const response = await fetch(`/api/industries/${industrySlug}`);
      const data = await response.json();

      if (data.success && data.data) {
        this.serviceTypes.clear();

        const industry = data.data;
        this.industryTemplate = {
          id: industry.id,
          name: industry.name,
          slug: industry.slug,
          icon: industry.icon,
          color: industry.color
        };

        // Load service types from industry
        if (industry.serviceTypes && Array.isArray(industry.serviceTypes)) {
          industry.serviceTypes.forEach(st => {
            this.serviceTypes.set(st.slug, {
              id: st.id,
              name: st.name,
              slug: st.slug,
              icon: st.icon || 'fa-wrench',
              color: st.color || '#F97316',
              defaultInterval: st.defaultInterval || 12,
              description: st.description || '',
              subtypes: st.subtypes || [],
              equipmentTypes: st.equipment || []
            });
          });
        }

        // Load intervals from industry
        if (industry.intervals && Array.isArray(industry.intervals)) {
          this.intervals = industry.intervals.map(i => ({
            months: i.months,
            label: i.label,
            isDefault: i.isDefault
          }));
        }

        this.initialized = true;
        Logger.log(`ServiceTypeRegistry loaded from industry '${industrySlug}': ${this.serviceTypes.size} service types`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error loading industry service types:', error);
      return false;
    }
  }

  /**
   * Get all service types as array
   */
  getAll() {
    return Array.from(this.serviceTypes.values());
  }

  /**
   * Get service type by slug
   */
  getBySlug(slug) {
    return this.serviceTypes.get(slug);
  }

  /**
   * Get service type by ID
   */
  getById(id) {
    return this.getAll().find(st => st.id === id);
  }

  /**
   * Get the default (first) service type for fallback behavior
   * Used when no specific category matches
   */
  getDefaultServiceType() {
    const all = this.getAll();
    return all.length > 0 ? all[0] : {
      slug: 'service',
      name: 'Service',
      icon: 'fa-wrench',
      color: '#F97316'
    };
  }

  /**
   * Generate icon HTML for a service type
   */
  getIcon(slugOrServiceType) {
    const st = typeof slugOrServiceType === 'string'
      ? this.getBySlug(slugOrServiceType)
      : slugOrServiceType;
    if (!st) return '<i class="fas fa-wrench"></i>';
    return `<i class="fas ${st.icon}" style="color: ${st.color}"></i>`;
  }

  /**
   * Format interval as label
   */
  formatInterval(months) {
    const interval = this.intervals.find(i => i.months === months);
    if (interval?.label) return interval.label;
    if (months < 12) return `${months} mnd`;
    if (months === 12) return '1 år';
    if (months % 12 === 0) return `${months / 12} år`;
    return `${months} mnd`;
  }

  /**
   * Get available intervals for dropdowns
   */
  getIntervalOptions() {
    if (this.intervals.length > 0) {
      return this.intervals.map(i => ({
        value: i.months,
        label: i.label || this.formatInterval(i.months),
        isDefault: i.isDefault
      }));
    }
    // Fallback to common intervals
    return [
      { value: 6, label: '6 mnd', isDefault: false },
      { value: 12, label: '1 år', isDefault: false },
      { value: 24, label: '2 år', isDefault: false },
      { value: 36, label: '3 år', isDefault: true },
      { value: 60, label: '5 år', isDefault: false }
    ];
  }

  /**
   * Generate category tabs HTML
   */
  renderCategoryTabs(activeCategory = 'all') {
    const serviceTypes = this.getAll();

    let html = `<button class="kategori-tab ${activeCategory === 'all' ? 'active' : ''}" data-kategori="alle">Alle</button>`;

    serviceTypes.forEach(st => {
      const isActive = activeCategory === st.slug || activeCategory === st.name;
      html += `<button class="kategori-tab ${isActive ? 'active' : ''}" data-kategori="${st.name}">
        ${this.getIcon(st)} ${st.name}
      </button>`;
    });

    // Add "Begge" tab for combined categories (backward compatibility)
    if (serviceTypes.length >= 2) {
      const combinedName = serviceTypes.map(st => st.name).join(' + ');
      const isActive = activeCategory === combinedName || activeCategory === 'El-Kontroll + Brannvarsling';
      html += `<button class="kategori-tab ${isActive ? 'active' : ''}" data-kategori="${combinedName}">
        ${serviceTypes.map(st => this.getIcon(st)).join('')} Begge
      </button>`;
    }

    return html;
  }

  /**
   * Generate category select options HTML
   */
  renderCategoryOptions(selectedValue = '') {
    const serviceTypes = this.getAll();
    let html = '';

    serviceTypes.forEach(st => {
      const selected = selectedValue === st.name || selectedValue === st.slug ? 'selected' : '';
      html += `<option value="${escapeHtml(st.name)}" ${selected}>${escapeHtml(st.name)}</option>`;
    });

    // Combined option for backward compatibility
    if (serviceTypes.length >= 2) {
      const combinedName = serviceTypes.map(st => st.name).join(' + ');
      const selected = selectedValue === combinedName ? 'selected' : '';
      html += `<option value="${escapeHtml(combinedName)}" ${selected}>Begge (${escapeHtml(combinedName)})</option>`;
    }

    return html;
  }

  /**
   * Generate subtype options for a service type
   */
  renderSubtypeOptions(serviceTypeSlug, selectedValue = '') {
    const st = this.getBySlug(serviceTypeSlug);
    if (!st || !st.subtypes || st.subtypes.length === 0) return '';

    let html = '<option value="">Ikke valgt</option>';
    st.subtypes.forEach(sub => {
      const selected = selectedValue === sub.name || selectedValue === sub.slug ? 'selected' : '';
      html += `<option value="${escapeHtml(sub.name)}" ${selected}>${escapeHtml(sub.name)}</option>`;
    });

    return html;
  }

  /**
   * Generate equipment options for a service type
   */
  renderEquipmentOptions(serviceTypeSlug, selectedValue = '') {
    const st = this.getBySlug(serviceTypeSlug);

    // Fallback for brannvarsling equipment types - grouped by brand
    if (serviceTypeSlug === 'brannvarsling' && (!st || !st.equipmentTypes || st.equipmentTypes.length === 0)) {
      const isSelected = (val) => selectedValue === val ? 'selected' : '';
      let html = '<option value="">Ikke valgt</option>';
      html += `<optgroup label="Elotec">`;
      html += `<option value="Elotec" ${isSelected('Elotec')}>Elotec</option>`;
      html += `<option value="ES 801" ${isSelected('ES 801')}>ES 801</option>`;
      html += `<option value="ES 601" ${isSelected('ES 601')}>ES 601</option>`;
      html += `<option value="2 x Elotec" ${isSelected('2 x Elotec')}>2 x Elotec</option>`;
      html += `</optgroup>`;
      html += `<optgroup label="ICAS">`;
      html += `<option value="ICAS" ${isSelected('ICAS')}>ICAS</option>`;
      html += `</optgroup>`;
      html += `<optgroup label="Begge">`;
      html += `<option value="Elotec + ICAS" ${isSelected('Elotec + ICAS')}>Elotec + ICAS</option>`;
      html += `</optgroup>`;
      return html;
    }

    if (!st || !st.equipmentTypes || st.equipmentTypes.length === 0) return '';

    let html = '<option value="">Ikke valgt</option>';
    st.equipmentTypes.forEach(eq => {
      const selected = selectedValue === eq.name || selectedValue === eq.slug ? 'selected' : '';
      html += `<option value="${escapeHtml(eq.name)}" ${selected}>${escapeHtml(eq.name)}</option>`;
    });

    return html;
  }

  /**
   * Generate interval select options
   */
  renderIntervalOptions(selectedValue = null) {
    const options = this.getIntervalOptions();
    let html = '';

    options.forEach(opt => {
      const selected = selectedValue === opt.value || (selectedValue === null && opt.isDefault) ? 'selected' : '';
      html += `<option value="${escapeHtml(String(opt.value))}" ${selected}>${escapeHtml(opt.label)}</option>`;
    });

    return html;
  }

  /**
   * Check if customer matches a category filter
   */
  matchesCategory(customer, categoryFilter) {
    if (categoryFilter === 'all' || categoryFilter === 'alle') return true;

    const kategori = customer.kategori || '';

    // Direct match with service type slug or name
    const st = this.getBySlug(categoryFilter);
    if (st) {
      // Exact match only - "Brannvarsling" should NOT match "El-Kontroll + Brannvarsling"
      return kategori === st.name;
    }

    // Check for combined category (backward compatibility)
    if (categoryFilter.includes('-') || categoryFilter.includes('+')) {
      const serviceTypes = this.getAll();
      const allMatched = serviceTypes.every(st => kategori.includes(st.name));
      return allMatched && kategori.includes('+');
    }

    // Legacy direct string match - exact match only
    return kategori === categoryFilter;
  }

  /**
   * Check if a category is known in the current industry
   */
  isKnownCategory(kategori) {
    if (!kategori) return true; // null/empty is considered "default"

    const serviceTypes = this.getAll();

    // Check for exact match
    for (const st of serviceTypes) {
      if (kategori === st.name) return true;
    }

    // Check for combined category (contains '+')
    if (kategori.includes('+')) {
      const parts = kategori.split('+').map(p => p.trim());
      return parts.every(part => serviceTypes.some(st => st.name === part));
    }

    // Check for partial match
    for (const st of serviceTypes) {
      if (kategori.toLowerCase().includes(st.slug.toLowerCase()) ||
          kategori.toLowerCase().includes(st.name.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get CSS class for category badge
   * Dynamically returns the service type slug as CSS class
   * Returns 'unknown-category' for categories not in current industry
   */
  getCategoryClass(kategori) {
    const serviceTypes = this.getAll();
    const defaultSt = this.getDefaultServiceType();

    // Helper to normalize category strings for comparison
    const normalizeCategory = (str) => {
      if (!str) return '';
      return str.toLowerCase()
        .replace(/[\s-]+/g, '')  // Remove spaces and hyphens
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // Remove accents
    };

    // Helper to find matching service type
    const findServiceType = (categoryName) => {
      const normalizedCat = normalizeCategory(categoryName);
      for (const st of serviceTypes) {
        if (normalizedCat === normalizeCategory(st.name) ||
            normalizedCat === normalizeCategory(st.slug)) {
          return st;
        }
      }
      for (const st of serviceTypes) {
        if (normalizedCat.includes(normalizeCategory(st.slug)) ||
            normalizeCategory(st.slug).includes(normalizedCat)) {
          return st;
        }
      }
      return null;
    };

    if (!kategori) return defaultSt.slug;

    // Combined category (contains '+')
    if (kategori.includes('+')) {
      const parts = kategori.split('+').map(p => p.trim());
      const matchedTypes = parts.map(part => findServiceType(part)).filter(Boolean);
      return matchedTypes.length > 0 ? 'combined' : defaultSt.slug;
    }

    // Single category - use normalized matching
    const matchedSt = findServiceType(kategori);
    if (matchedSt) {
      return matchedSt.slug;
    }

    // Fallback: check svgIcons directly for known categories
    const normalizedKat = normalizeCategory(kategori);
    for (const slug of Object.keys(svgIcons)) {
      if (normalizedKat.includes(normalizeCategory(slug)) ||
          normalizeCategory(slug).includes(normalizedKat)) {
        return slug;
      }
    }

    // Unknown category - use default service type as fallback
    return defaultSt.slug;
  }

  /**
   * Get icon HTML for a category (handles combined categories)
   * Uses premium SVG icons when available, falls back to default service type
   */
  getIconForCategory(kategori) {
    const serviceTypes = this.getAll();
    const defaultSt = this.getDefaultServiceType();

    // Helper to normalize category strings for comparison
    // "El-Kontroll" -> "elkontroll", "Brannvarsling" -> "brannvarsling"
    const normalizeCategory = (str) => {
      if (!str) return '';
      return str.toLowerCase()
        .replace(/[\s-]+/g, '')  // Remove spaces and hyphens
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // Remove accents
    };

    // Helper to get icon HTML - white FontAwesome icon on colored marker background
    const getIconHtml = (st) => {
      return `<i class="fas ${st.icon}"></i>`;
    };

    // Helper to find matching service type using normalized comparison
    const findServiceType = (categoryName) => {
      const normalizedCat = normalizeCategory(categoryName);
      // First: exact normalized match
      for (const st of serviceTypes) {
        if (normalizedCat === normalizeCategory(st.name) ||
            normalizedCat === normalizeCategory(st.slug)) {
          return st;
        }
      }
      // Second: partial normalized match
      for (const st of serviceTypes) {
        if (normalizedCat.includes(normalizeCategory(st.slug)) ||
            normalizeCategory(st.slug).includes(normalizedCat)) {
          return st;
        }
      }
      return null;
    };

    if (!kategori) return getIconHtml(defaultSt);

    // Check for combined category (contains '+')
    if (kategori.includes('+')) {
      const parts = kategori.split('+').map(p => p.trim());
      const matchedTypes = parts.map(part => findServiceType(part)).filter(Boolean);
      if (matchedTypes.length > 0) {
        return matchedTypes.map(st => getIconHtml(st)).join('');
      }
      return getIconHtml(defaultSt);
    }

    // Single service type - use normalized matching
    const matchedSt = findServiceType(kategori);
    if (matchedSt) {
      return getIconHtml(matchedSt);
    }

    // Fallback: check svgIcons directly for known categories
    const normalizedKat = normalizeCategory(kategori);
    for (const slug of Object.keys(svgIcons)) {
      if (normalizedKat.includes(normalizeCategory(slug)) ||
          normalizeCategory(slug).includes(normalizedKat)) {
        return `<span class="marker-svg-icon">${svgIcons[slug]}</span>`;
      }
    }

    // Unknown category - use default service type icon as fallback
    return getIconHtml(defaultSt);
  }

  /**
   * Generate driftskategori options (brann-related subtypes)
   */
  renderDriftsOptions(selectedValue = '') {
    const brannService = this.getBySlug('brannvarsling');
    if (!brannService || !brannService.subtypes || brannService.subtypes.length === 0) {
      // Fallback to default options - includes all common driftstyper
      const defaults = ['Storfe', 'Sau', 'Storfe/Sau', 'Geit', 'Gris', 'Svin', 'Gartneri', 'Korn', 'Fjærfeoppdrett', 'Sau/Geit'];
      let html = '<option value="">Ingen / Ikke valgt</option>';
      defaults.forEach(d => {
        const selected = selectedValue === d ? 'selected' : '';
        html += `<option value="${d}" ${selected}>${d}</option>`;
      });
      return html;
    }

    let html = '<option value="">Ingen / Ikke valgt</option>';
    brannService.subtypes.forEach(subtype => {
      const selected = subtype.name === selectedValue ? 'selected' : '';
      html += `<option value="${subtype.name}" ${selected}>${subtype.name}</option>`;
    });
    return html;
  }

  /**
   * Render dynamic service sections for customer modal
   * @param {Object} customer - Customer object with optional services array
   * @returns {string} HTML for all service sections
   */
  renderServiceSections(customer = {}) {
    const serviceTypes = this.getAll();
    if (serviceTypes.length === 0) return '';

    const services = customer.services || [];
    let html = '';

    serviceTypes.forEach(st => {
      // Find existing service data for this type
      const serviceData = services.find(s =>
        s.service_type_slug === st.slug || s.service_type_id === st.id
      ) || {};

      const hasSubtypes = st.subtypes && st.subtypes.length > 0;
      const hasEquipment = st.equipmentTypes && st.equipmentTypes.length > 0;

      html += `
        <div class="control-section service-section" data-service-slug="${st.slug}" data-service-id="${st.id}">
          <div class="control-section-header">
            <i class="fas ${st.icon}" style="color: ${st.color}"></i> ${st.name}
          </div>

          ${hasSubtypes ? `
          <div class="form-group">
            <label for="service_${st.slug}_subtype">Type</label>
            <select id="service_${st.slug}_subtype" name="service_${st.slug}_subtype">
              ${this.renderSubtypeOptions(st.slug, serviceData.subtype_name || '')}
            </select>
          </div>
          ` : ''}

          ${hasEquipment ? `
          <div class="form-group">
            <label for="service_${st.slug}_equipment">System/Utstyr</label>
            <select id="service_${st.slug}_equipment" name="service_${st.slug}_equipment">
              ${this.renderEquipmentOptions(st.slug, serviceData.equipment_name || '')}
            </select>
          </div>
          ` : ''}

          <div class="form-row">
            <div class="form-group">
              <label for="service_${st.slug}_siste">Siste kontroll</label>
              <input type="${appConfig.datoModus === 'month_year' ? 'month' : 'date'}" id="service_${st.slug}_siste" name="service_${st.slug}_siste"
                     value="${appConfig.datoModus === 'month_year' && serviceData.siste_kontroll ? serviceData.siste_kontroll.substring(0, 7) : (serviceData.siste_kontroll || '')}">
            </div>
            <div class="form-group">
              <label for="service_${st.slug}_neste">Neste kontroll</label>
              <input type="${appConfig.datoModus === 'month_year' ? 'month' : 'date'}" id="service_${st.slug}_neste" name="service_${st.slug}_neste"
                     value="${appConfig.datoModus === 'month_year' && serviceData.neste_kontroll ? serviceData.neste_kontroll.substring(0, 7) : (serviceData.neste_kontroll || '')}">
            </div>
          </div>

          <div class="form-group">
            <label for="service_${st.slug}_intervall">Intervall</label>
            <select id="service_${st.slug}_intervall" name="service_${st.slug}_intervall">
              ${this.renderIntervalOptions(serviceData.intervall_months || st.defaultInterval)}
            </select>
          </div>
        </div>
      `;
    });

    return html;
  }

  /**
   * Parse form data for services from dynamically rendered sections
   * @returns {Array} Array of service objects
   */
  parseServiceFormData() {
    const serviceTypes = this.getAll();
    const services = [];

    serviceTypes.forEach(st => {
      const section = document.querySelector(`.service-section[data-service-slug="${st.slug}"]`);
      if (!section) return;

      const sisteInput = document.getElementById(`service_${st.slug}_siste`);
      const nesteInput = document.getElementById(`service_${st.slug}_neste`);
      const intervallSelect = document.getElementById(`service_${st.slug}_intervall`);
      const subtypeSelect = document.getElementById(`service_${st.slug}_subtype`);
      const equipmentSelect = document.getElementById(`service_${st.slug}_equipment`);

      const siste = normalizeDateValue(sisteInput?.value) || null;
      const neste = normalizeDateValue(nesteInput?.value) || null;
      const intervall = intervallSelect?.value ? parseInt(intervallSelect.value, 10) : st.defaultInterval;
      const subtype = subtypeSelect?.value || null;
      const equipment = equipmentSelect?.value || null;

      // Only include service if it has dates
      if (siste || neste) {
        services.push({
          service_type_id: st.id,
          service_type_slug: st.slug,
          siste_kontroll: siste,
          neste_kontroll: neste,
          intervall_months: intervall,
          subtype_name: subtype,
          equipment_name: equipment
        });
      }
    });

    return services;
  }

  /**
   * Get the combined kategori string from services array
   * @param {Array} services - Array of service objects
   * @returns {string} Combined kategori like "El-Kontroll + Brannvarsling"
   */
  getKategoriFromServices(services) {
    if (!services || services.length === 0) return '';

    const serviceTypes = this.getAll();
    const activeServiceNames = [];

    services.forEach(service => {
      const st = serviceTypes.find(t =>
        t.slug === service.service_type_slug || t.id === service.service_type_id
      );
      if (st && !activeServiceNames.includes(st.name)) {
        activeServiceNames.push(st.name);
      }
    });

    return activeServiceNames.join(' + ');
  }

  /**
   * Generate dynamic popup control info HTML for a customer
   * Replaces hardcoded El-Kontroll/Brannvarsling popup content
   * @param {Object} customer - Customer object
   * @param {Object} controlStatus - Result from getControlStatus()
   * @returns {string} HTML string for control info section
   */
  renderPopupControlInfo(customer, controlStatus) {
    const serviceTypes = this.getAll();
    const kategori = customer.kategori || '';

    const formatDate = (dato) => {
      if (!dato) return null;
      const d = new Date(dato);
      return formatDateInline(d);
    };

    // MVP-modus: vis kontrollinfo per servicetype
    if (isMvpMode()) {
      // If organization has multiple service types, show each one for all customers
      if (serviceTypes.length >= 2) {
        let html = '<div class="popup-control-info">';
        serviceTypes.forEach(st => {
          let nesteKontroll = null;
          let sisteKontroll = null;
          let intervall = null;

          // Check customer service data first
          const serviceData = (customer.services || []).find(s =>
            s.service_type_slug === st.slug || s.service_type_id === st.id
          );
          if (serviceData) {
            nesteKontroll = serviceData.neste_kontroll;
            sisteKontroll = serviceData.siste_kontroll;
          }

          // Fallback to legacy columns based on slug
          if (st.slug === 'el-kontroll') {
            if (!nesteKontroll) nesteKontroll = customer.neste_el_kontroll;
            if (!sisteKontroll) sisteKontroll = customer.siste_el_kontroll;
            if (!intervall) intervall = customer.el_kontroll_intervall;
          } else if (st.slug === 'brannvarsling') {
            if (!nesteKontroll) nesteKontroll = customer.neste_brann_kontroll;
            if (!sisteKontroll) sisteKontroll = customer.siste_brann_kontroll;
            if (!intervall) intervall = customer.brann_kontroll_intervall;
          }

          // Final fallback to generic columns
          if (!nesteKontroll) nesteKontroll = customer.neste_kontroll;
          if (!sisteKontroll) sisteKontroll = customer.siste_kontroll || customer.last_visit_date;
          if (!intervall) intervall = customer.kontroll_intervall_mnd || st.defaultInterval;

          const intervallText = intervall ? ` (hver ${intervall}. mnd)` : '';

          html += `
            <div style="margin-bottom:8px;">
              <p style="margin:0;">
                <strong><i class="fas ${st.icon || 'fa-clipboard-check'}" style="color:${st.color || '#3B82F6'};"></i> ${escapeHtml(st.name)}:</strong>
              </p>
              <p style="margin:2px 0 0 20px;font-size:13px;">Neste: ${nesteKontroll ? formatDate(nesteKontroll) : '<span style="color:#F97316;">Ikke satt</span>'}${intervallText}</p>
              ${sisteKontroll ? `<p style="margin:2px 0 0 20px;font-size:11px;color:#888;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
            </div>`;
        });
        html += '</div>';
        return html;
      }

      // Single service type - simple view
      const sisteKontroll = customer.siste_kontroll || customer.siste_el_kontroll;
      return `
        <div class="popup-control-info">
          <p class="popup-status ${controlStatus.class}">
            <strong><span class="marker-svg-icon" style="display:inline-block;width:14px;height:14px;vertical-align:middle;color:#3B82F6;">${svgIcons['service']}</span> Neste kontroll:</strong>
            <span class="control-days">${escapeHtml(controlStatus.label)}</span>
          </p>
          ${sisteKontroll ? `<p style="font-size: 11px; color: #888; margin-top: 4px;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
        </div>`;
    }

    const isCombined = kategori.includes('+');

    if (isCombined && serviceTypes.length >= 2) {
      let html = '<div class="popup-controls">';
      serviceTypes.forEach(st => {
        const serviceData = (customer.services || []).find(s =>
          s.service_type_slug === st.slug || s.service_type_id === st.id
        );
        let nesteKontroll = serviceData?.neste_kontroll;
        let sisteKontroll = serviceData?.siste_kontroll;

        if (!nesteKontroll && st.slug === 'el-kontroll') {
          nesteKontroll = customer.neste_el_kontroll;
          sisteKontroll = customer.siste_el_kontroll;
        } else if (!nesteKontroll && st.slug === 'brannvarsling') {
          nesteKontroll = customer.neste_brann_kontroll;
          sisteKontroll = customer.siste_brann_kontroll;
        }

        html += `
          <p><strong><i class="fas ${st.icon}" style="color: ${st.color};"></i> ${st.name}:</strong></p>
          <p style="margin-left: 20px;">Neste: ${nesteKontroll ? escapeHtml(nesteKontroll) : 'Ikke satt'}</p>
          ${sisteKontroll ? `<p style="margin-left: 20px; font-size: 11px; color: #888;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
        `;
      });
      html += '</div>';
      return html;
    }

    const matchedSt = serviceTypes.find(st =>
      kategori === st.name || kategori.toLowerCase().includes(st.slug.toLowerCase())
    ) || serviceTypes[0];

    if (!matchedSt) {
      return `
        <div class="popup-control-info">
          <p class="popup-status ${controlStatus.class}">
            <strong>Neste kontroll:</strong>
            <span class="control-days">${escapeHtml(controlStatus.label)}</span>
          </p>
        </div>`;
    }

    const serviceData = (customer.services || []).find(s =>
      s.service_type_slug === matchedSt.slug || s.service_type_id === matchedSt.id
    );
    let sisteKontroll = serviceData?.siste_kontroll;

    if (!sisteKontroll) {
      if (matchedSt.slug === 'el-kontroll') {
        sisteKontroll = customer.siste_el_kontroll;
      } else if (matchedSt.slug === 'brannvarsling') {
        sisteKontroll = customer.siste_brann_kontroll;
      } else {
        sisteKontroll = customer.siste_kontroll;
      }
    }

    return `
      <div class="popup-control-info">
        <p class="popup-status ${controlStatus.class}">
          <strong><i class="fas ${matchedSt.icon}" style="color: ${matchedSt.color};"></i> Neste kontroll:</strong>
          <span class="control-days">${escapeHtml(controlStatus.label)}</span>
        </p>
        ${sisteKontroll ? `<p style="font-size: 11px; color: #888; margin-top: 4px;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
      </div>`;
  }

  /**
   * Parse custom_data field which may be string or object
   * @param {string|Object} customData - Customer custom_data field
   * @returns {Object} Parsed custom data object
   */
  parseCustomData(customData) {
    if (!customData) return {};
    if (typeof customData === 'object') return customData;
    try { return JSON.parse(customData); } catch { return {}; }
  }

  /**
   * Get appropriate label for subtype based on service type
   * @param {Object} serviceType - Service type object
   * @returns {string} Human-readable label
   */
  getSubtypeLabel(serviceType) {
    // Use industry-specific labels for known service types
    if (serviceType.slug === 'el-kontroll') return 'El-type';
    if (serviceType.slug === 'brannvarsling') return 'Driftstype';
    // Generic label based on service type name
    return `${serviceType.name} type`;
  }

  /**
   * Get appropriate label for equipment based on service type
   * @param {Object} serviceType - Service type object
   * @returns {string} Human-readable label
   */
  getEquipmentLabel(serviceType) {
    if (serviceType.slug === 'brannvarsling') return 'Brannsystem';
    // Generic label
    return `${serviceType.name} utstyr`;
  }

  /**
   * Get subtype value for a customer and service type
   * Checks services array, legacy fields, and custom_data
   * @param {Object} customer - Customer object
   * @param {Object} serviceType - Service type object
   * @returns {string|null} Subtype value or null
   */
  getCustomerSubtypeValue(customer, serviceType) {
    // Check in services array first (new normalized structure)
    const service = (customer.services || []).find(s =>
      s.service_type_id === serviceType.id || s.service_type_slug === serviceType.slug
    );
    if (service?.subtype_name) return service.subtype_name;

    // Fallback to legacy fields for backward compatibility
    if (serviceType.slug === 'el-kontroll' && customer.el_type) return customer.el_type;
    if (serviceType.slug === 'brannvarsling' && customer.brann_driftstype) return customer.brann_driftstype;

    // Check custom_data for other industries
    const customData = this.parseCustomData(customer.custom_data);
    return customData[`${serviceType.slug}_subtype`] || null;
  }

  /**
   * Get equipment value for a customer and service type
   * Checks services array, legacy fields, and custom_data
   * @param {Object} customer - Customer object
   * @param {Object} serviceType - Service type object
   * @returns {string|null} Equipment value or null
   */
  getCustomerEquipmentValue(customer, serviceType) {
    // Check in services array first
    const service = (customer.services || []).find(s =>
      s.service_type_id === serviceType.id || s.service_type_slug === serviceType.slug
    );
    if (service?.equipment_name) return service.equipment_name;

    // Fallback to legacy fields - use normalized value for brannvarsling
    if (serviceType.slug === 'brannvarsling' && customer.brann_system) {
      return normalizeBrannsystem(customer.brann_system);
    }

    // Check custom_data
    const customData = this.parseCustomData(customer.custom_data);
    return customData[`${serviceType.slug}_equipment`] || null;
  }

  /**
   * Render dynamic industry-specific fields for popup display
   * Replaces hardcoded el_type, brann_driftstype, brann_system fields
   * @param {Object} customer - Customer object
   * @returns {string} HTML string for industry fields
   */
  renderPopupIndustryFields(customer) {
    const serviceTypes = this.getAll();
    const kategori = customer.kategori || '';
    let html = '';

    // Find which service types apply to this customer
    let applicableServiceTypes = serviceTypes.filter(st =>
      kategori.includes(st.name) || kategori === st.name
    );

    // If no specific match, try partial matching
    if (applicableServiceTypes.length === 0 && serviceTypes.length > 0) {
      const partialMatch = serviceTypes.find(st =>
        kategori.toLowerCase().includes(st.slug) ||
        st.name.toLowerCase().includes(kategori.toLowerCase())
      );
      if (partialMatch) applicableServiceTypes.push(partialMatch);
    }

    for (const st of applicableServiceTypes) {
      // Render subtype field if service type has subtypes
      if (st.subtypes && st.subtypes.length > 0) {
        const subtypeValue = this.getCustomerSubtypeValue(customer, st);
        if (subtypeValue) {
          const subtypeLabel = this.getSubtypeLabel(st);
          html += `<p><strong>${escapeHtml(subtypeLabel)}:</strong> ${escapeHtml(subtypeValue)}</p>`;
        }
      }

      // Render equipment field if service type has equipment types
      if (st.equipmentTypes && st.equipmentTypes.length > 0) {
        const equipmentValue = this.getCustomerEquipmentValue(customer, st);
        if (equipmentValue) {
          const equipmentLabel = this.getEquipmentLabel(st);
          html += `<p><strong>${escapeHtml(equipmentLabel)}:</strong> ${escapeHtml(equipmentValue)}</p>`;
        }
      }
    }

    return html;
  }
}

// Global service type registry instance
const serviceTypeRegistry = new ServiceTypeRegistry();

// Update control section headers dynamically based on service types
function updateControlSectionHeaders() {
  const elService = serviceTypeRegistry.getBySlug('el-kontroll');
  const brannService = serviceTypeRegistry.getBySlug('brannvarsling');

  const elHeader = document.querySelector('#elKontrollSection .control-section-header');
  if (elHeader && elService) {
    elHeader.innerHTML = `<i class="fas ${elService.icon}" style="color: ${elService.color}"></i> ${elService.name}`;
  }

  const brannHeader = document.querySelector('#brannvarslingSection .control-section-header');
  if (brannHeader && brannService) {
    brannHeader.innerHTML = `<i class="fas ${brannService.icon}" style="color: ${brannService.color}"></i> ${brannService.name}`;
  }
}

// ========================================
// DYNAMIC FILTER PANEL CATEGORIES
// ========================================

/**
 * Render category filter buttons dynamically based on ServiceTypeRegistry
 */
function renderFilterPanelCategories() {
  const container = document.getElementById('categoryFilterButtons');
  if (!container) return;

  const serviceTypes = serviceTypeRegistry.getAll();

  // Start with "Alle" button
  let html = `
    <button class="category-btn ${selectedCategory === 'all' ? 'active' : ''}" data-category="all">
      <i class="fas fa-list"></i> Alle
    </button>
  `;

  // Add button for each service type
  serviceTypes.forEach(st => {
    const isActive = selectedCategory === st.name || selectedCategory === st.slug;
    html += `
      <button class="category-btn ${isActive ? 'active' : ''}" data-category="${st.name}">
        <i class="fas ${st.icon}" style="color: ${st.color}"></i> ${st.name}
      </button>
    `;
  });

  // Add combined option if 2+ service types
  if (serviceTypes.length >= 2) {
    const combinedName = serviceTypes.map(st => st.name).join(' + ');
    const icons = serviceTypes.map(st => `<i class="fas ${st.icon}" style="color: ${st.color}"></i>`).join('');
    const isActive = selectedCategory === combinedName;
    html += `
      <button class="category-btn ${isActive ? 'active' : ''}" data-category="${combinedName}">
        ${icons} Begge
      </button>
    `;
  }

  container.innerHTML = html;
  attachCategoryFilterHandlers();
  attachCategoryDropHandlers();
}

/**
 * No-op: drop handlers are handled by custom drag system
 */
function attachCategoryDropHandlers() {}

// ========================================
// MARKER DRAG-TO-CATEGORY SYSTEM
// ========================================

let dragGhost = null;
let dragHoveredBtn = null;

/**
 * Start custom drag from a map marker
 */
function startMarkerDrag(customerId, x, y) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  // Create floating ghost element
  dragGhost = document.createElement('div');
  dragGhost.className = 'drag-ghost';
  dragGhost.innerHTML = `<i class="fas fa-map-marker-alt"></i> ${escapeHtml(customer.navn)}`;
  dragGhost.style.left = x + 'px';
  dragGhost.style.top = y + 'px';
  document.body.appendChild(dragGhost);
  document.body.classList.add('marker-dragging');
}

/**
 * Update ghost position and highlight drop target
 */
function updateMarkerDrag(x, y) {
  if (!dragGhost) return;
  dragGhost.style.left = x + 'px';
  dragGhost.style.top = y + 'px';

  // Check which category button is under cursor
  const elUnder = document.elementFromPoint(x, y);
  const btn = elUnder?.closest('.category-btn');

  if (dragHoveredBtn && dragHoveredBtn !== btn) {
    dragHoveredBtn.classList.remove('drop-hover');
  }

  if (btn && btn.dataset.category && btn.dataset.category !== 'all') {
    btn.classList.add('drop-hover');
    dragHoveredBtn = btn;
  } else {
    dragHoveredBtn = null;
  }
}

/**
 * End drag - assign category if dropped on a button
 */
function endMarkerDrag(customerId) {
  const targetCategory = dragHoveredBtn?.dataset?.category;

  // Clean up
  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }
  if (dragHoveredBtn) {
    dragHoveredBtn.classList.remove('drop-hover');
    dragHoveredBtn = null;
  }
  document.body.classList.remove('marker-dragging');

  // Assign category if valid target
  if (targetCategory && targetCategory !== 'all') {
    assignCustomerCategory(customerId, targetCategory);
  }
}

/**
 * Assign a category to a customer via drag-and-drop
 */
async function assignCustomerCategory(customerId, categoryName) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  if (customer.kategori === categoryName) {
    showToast('Kunden har allerede denne kategorien', 'info');
    return;
  }

  try {
    const response = await apiFetch(`/api/kunder/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify({
        navn: customer.navn,
        adresse: customer.adresse,
        postnummer: customer.postnummer,
        poststed: customer.poststed,
        telefon: customer.telefon,
        epost: customer.epost,
        lat: customer.lat,
        lng: customer.lng,
        kategori: categoryName
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Kunne ikke oppdatere kategori');
    }

    // Update local data and re-render
    customer.kategori = categoryName;
    renderMarkers(customers.filter(c => c.lat && c.lng));
    updateCategoryFilterCounts();
    showToast(`${escapeHtml(customer.navn)} flyttet til ${escapeHtml(categoryName)}`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Render driftskategori filter buttons dynamically based on selected category
 */
/**
 * Normalize driftstype values for consistency
 */
function normalizeDriftstype(driftstype) {
  if (!driftstype) return null;
  const d = driftstype.trim();

  // Normalize common variations
  if (d.toLowerCase() === 'gartn' || d.toLowerCase() === 'gartneri') return 'Gartneri';
  if (d.toLowerCase() === 'sau / geit' || d.toLowerCase() === 'sau/geit') return 'Sau/Geit';
  if (d.toLowerCase() === 'storfe/sau' || d.toLowerCase() === 'storfe+sau') return 'Storfe/Sau';
  if (d.toLowerCase() === 'fjørfe' || d.toLowerCase() === 'fjærfeoppdrett') return 'Fjørfe';
  if (d.toLowerCase() === 'svin' || d.toLowerCase() === 'gris') return 'Gris';
  if (d.toLowerCase() === 'ingen' || d.startsWith('Utf:')) return null; // Skip invalid

  return d;
}

function renderDriftskategoriFilter() {
  const container = document.getElementById('driftFilterButtons');
  if (!container) return;

  // MVP-modus: Skjul avanserte filtre
  const filterContainer = container.parentElement;
  if (isMvpMode()) {
    if (filterContainer) filterContainer.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  // Get unique driftstype values from actual customer data
  const counts = {};
  customers.forEach(c => {
    if (c.brann_driftstype && c.brann_driftstype.trim()) {
      const normalized = normalizeDriftstype(c.brann_driftstype);
      if (normalized) {
        counts[normalized] = (counts[normalized] || 0) + 1;
      }
    }
  });

  // Sort by count (most common first)
  const driftstyper = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Hide filter container if no driftstype values
  if (filterContainer) {
    filterContainer.style.display = driftstyper.length > 0 ? 'block' : 'none';
  }

  if (driftstyper.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Start with "Alle" button
  let html = `
    <button class="category-btn drift-btn ${selectedDriftskategori === 'all' ? 'active' : ''}" data-drift="all">
      <i class="fas fa-list"></i> Alle
    </button>
  `;

  // Add button for each driftstype
  driftstyper.forEach(({ name, count }) => {
    const isActive = selectedDriftskategori === name;
    html += `
      <button class="category-btn drift-btn ${isActive ? 'active' : ''}" data-drift="${escapeHtml(name)}">${escapeHtml(name)} (${count})</button>
    `;
  });

  container.innerHTML = html;
  attachDriftFilterHandlers();
}

/**
 * Normalize brannsystem value to main category
 * ES 801, ES 601, "2 x Elotec" etc. → "Elotec"
 * "Icas" → "ICAS"
 * "Elotec + ICAS" etc. → "Begge"
 */
function normalizeBrannsystem(system) {
  if (!system) return null;
  const s = system.trim().toLowerCase();

  // Skip header/invalid values
  if (s === 'type') return null;

  // Check for "both" systems
  if (s.includes('elotec') && s.includes('icas')) return 'Begge';
  if (s.includes('es 801') && s.includes('icas')) return 'Begge';

  // Elotec variants (including ES 801, ES 601 which are Elotec models)
  if (s.includes('elotec') || s.startsWith('es 8') || s.startsWith('es 6') || s === '2 x elotec') return 'Elotec';

  // ICAS variants
  if (s.includes('icas')) return 'ICAS';

  // Other systems
  return 'Annet';
}

/**
 * Render brannsystem filter buttons
 */
function renderBrannsystemFilter() {
  const container = document.getElementById('brannsystemFilterButtons');
  if (!container) return;

  // MVP-modus: Skjul avanserte filtre
  const filterContainer = container.parentElement;
  if (isMvpMode()) {
    if (filterContainer) filterContainer.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  // Count customers per normalized brannsystem category
  const counts = { 'Elotec': 0, 'ICAS': 0, 'Begge': 0, 'Annet': 0 };
  customers.forEach(c => {
    if (c.brann_system && c.brann_system.trim()) {
      const normalized = normalizeBrannsystem(c.brann_system);
      if (normalized) counts[normalized]++;
    }
  });

  // Only show categories with customers
  const categories = Object.entries(counts).filter(([_, count]) => count > 0);

  // Hide filter container if no brannsystem values
  if (filterContainer) {
    filterContainer.style.display = categories.length > 0 ? 'block' : 'none';
  }

  if (categories.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Start with "Alle" button
  let html = `
    <button class="category-btn brannsystem-btn ${selectedBrannsystem === 'all' ? 'active' : ''}" data-brannsystem="all">
      <i class="fas fa-list"></i> Alle
    </button>
  `;

  // Add button for each category
  categories.forEach(([category, count]) => {
    const isActive = selectedBrannsystem === category;
    html += `
      <button class="category-btn brannsystem-btn ${isActive ? 'active' : ''}" data-brannsystem="${escapeHtml(category)}">${escapeHtml(category)} (${count})</button>
    `;
  });

  container.innerHTML = html;
  attachBrannsystemFilterHandlers();
}

/**
 * Attach click handlers to brannsystem filter buttons
 */
function attachBrannsystemFilterHandlers() {
  const container = document.getElementById('brannsystemFilterButtons');
  if (!container) return;

  container.querySelectorAll('.brannsystem-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all
      container.querySelectorAll('.brannsystem-btn').forEach(b => b.classList.remove('active'));
      // Add active to clicked
      btn.classList.add('active');
      // Update selected brannsystem
      selectedBrannsystem = btn.dataset.brannsystem;
      // Save to localStorage
      localStorage.setItem('selectedBrannsystem', selectedBrannsystem);
      // Apply filter
      applyFilters();
    });
  });
}

/**
 * Render kundetype (el_type) filter buttons
 */
function renderElTypeFilter() {
  const container = document.getElementById('elTypeFilterButtons');
  if (!container) return;

  // MVP-modus: Skjul avanserte filtre
  const filterContainer = container.parentElement;
  if (isMvpMode()) {
    if (filterContainer) filterContainer.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  // Count customers per el_type
  const counts = {};
  customers.forEach(c => {
    if (c.el_type && c.el_type.trim()) {
      const type = c.el_type.trim();
      counts[type] = (counts[type] || 0) + 1;
    }
  });

  // Sort by count
  const types = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Hide filter container if no values
  if (filterContainer) {
    filterContainer.style.display = types.length > 0 ? 'block' : 'none';
  }

  if (types.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Start with "Alle" button
  let html = `
    <button class="category-btn eltype-btn ${selectedElType === 'all' ? 'active' : ''}" data-eltype="all">
      <i class="fas fa-list"></i> Alle
    </button>
  `;

  // Add button for each type
  types.forEach(({ name, count }) => {
    const isActive = selectedElType === name;
    html += `
      <button class="category-btn eltype-btn ${isActive ? 'active' : ''}" data-eltype="${escapeHtml(name)}">${escapeHtml(name)} (${count})</button>
    `;
  });

  container.innerHTML = html;
  attachElTypeFilterHandlers();
}

/**
 * Attach click handlers to el_type filter buttons
 */
function attachElTypeFilterHandlers() {
  const container = document.getElementById('elTypeFilterButtons');
  if (!container) return;

  container.querySelectorAll('.eltype-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.eltype-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedElType = btn.dataset.eltype;
      localStorage.setItem('selectedElType', selectedElType);
      applyFilters();
    });
  });
}

/**
 * Attach click handlers to category filter buttons
 */
function attachCategoryFilterHandlers() {
  const container = document.getElementById('categoryFilterButtons');
  if (!container) return;

  container.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all
      container.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
      // Add active to clicked
      btn.classList.add('active');
      // Update selected category
      selectedCategory = btn.dataset.category;

      // Reset driftskategori when category changes (cascading behavior)
      selectedDriftskategori = 'all';
      localStorage.setItem('selectedDriftskategori', 'all');

      // Re-render driftskategori filter with new subtypes based on selected category
      renderDriftskategoriFilter();

      // Apply filter
      applyFilters();
    });
  });
}

/**
 * Attach click handlers to drift filter buttons
 */
function attachDriftFilterHandlers() {
  const container = document.getElementById('driftFilterButtons');
  if (!container) return;

  container.querySelectorAll('.drift-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all
      container.querySelectorAll('.drift-btn').forEach(b => b.classList.remove('active'));
      // Add active to clicked
      btn.classList.add('active');
      // Update selected driftskategori
      selectedDriftskategori = btn.dataset.drift;
      // Save to localStorage
      localStorage.setItem('selectedDriftskategori', selectedDriftskategori);
      // Apply filter
      applyFilters();
    });
  });
}

// ========================================
// DYNAMIC FIELD FILTERS
// ========================================

/**
 * Render dynamic filter sections for organization fields with is_filterable = 1
 */
function renderDynamicFieldFilters() {
  const container = document.getElementById('dynamicFieldFilters');
  if (!container) return;

  const filterableFields = organizationFields.filter(f => f.is_filterable === 1 || f.is_filterable === true);

  if (filterableFields.length === 0) {
    container.innerHTML = '';
    return;
  }

  const html = filterableFields.map(field => {
    const isExpanded = localStorage.getItem(`fieldFilterExpanded-${field.field_name}`) === 'true';

    return `
      <div class="category-filter dynamic-field-filter" data-field="${escapeHtml(field.field_name)}">
        <div class="category-filter-title clickable-header" data-toggle="field-${escapeHtml(field.field_name)}">
          <span>${escapeHtml(field.display_name)}</span>
          <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'} toggle-icon"></i>
        </div>
        <div class="dynamic-filter-content" id="fieldFilter-${escapeHtml(field.field_name)}" style="display: ${isExpanded ? 'block' : 'none'};">
          ${renderFieldFilterInput(field)}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  attachDynamicFilterHandlers();
}

/**
 * Render the appropriate filter input based on field type
 */
function renderFieldFilterInput(field) {
  const currentValue = dynamicFieldFilters[field.field_name];

  switch (field.field_type) {
    case 'select':
      return renderSelectFilterButtons(field, currentValue);
    case 'text':
      return renderTextFilterInput(field, currentValue);
    case 'number':
      return renderNumberRangeFilter(field, currentValue);
    case 'date':
      return renderDateRangeFilter(field, currentValue);
    default:
      return renderTextFilterInput(field, currentValue);
  }
}

/**
 * Render select field as button group
 */
function renderSelectFilterButtons(field, currentValue) {
  const options = field.options || [];
  let html = `<div class="category-filter-buttons">
    <button class="category-btn dynamic-field-btn ${!currentValue || currentValue === 'all' ? 'active' : ''}"
            data-field="${escapeHtml(field.field_name)}" data-value="all">
      <i class="fas fa-list"></i> Alle
    </button>`;

  options.forEach(opt => {
    const isActive = currentValue === opt.value;
    html += `
      <button class="category-btn dynamic-field-btn ${isActive ? 'active' : ''}"
              data-field="${escapeHtml(field.field_name)}" data-value="${escapeHtml(opt.value)}">
        ${escapeHtml(opt.display_name || opt.value)}
      </button>`;
  });

  html += '</div>';
  return html;
}

/**
 * Render text field as search input
 */
function renderTextFilterInput(field, currentValue) {
  return `
    <div class="filter-input-wrapper">
      <input type="text"
             class="dynamic-filter-input"
             data-field="${escapeHtml(field.field_name)}"
             placeholder="Filtrer på ${escapeHtml(field.display_name)}..."
             value="${escapeHtml(currentValue || '')}">
    </div>`;
}

/**
 * Render number field as min/max range
 */
function renderNumberRangeFilter(field, currentValue) {
  const min = currentValue?.min || '';
  const max = currentValue?.max || '';
  return `
    <div class="filter-range-wrapper">
      <input type="number" class="dynamic-filter-range" data-field="${escapeHtml(field.field_name)}" data-range="min" placeholder="Min" value="${min}">
      <span class="range-separator">-</span>
      <input type="number" class="dynamic-filter-range" data-field="${escapeHtml(field.field_name)}" data-range="max" placeholder="Maks" value="${max}">
    </div>`;
}

/**
 * Render date field as from/to range
 */
function renderDateRangeFilter(field, currentValue) {
  const from = currentValue?.from || '';
  const to = currentValue?.to || '';
  const dateInputType = appConfig.datoModus === 'month_year' ? 'month' : 'date';
  return `
    <div class="filter-range-wrapper">
      <input type="${dateInputType}" class="dynamic-filter-range" data-field="${escapeHtml(field.field_name)}" data-range="from" value="${from}">
      <span class="range-separator">til</span>
      <input type="${dateInputType}" class="dynamic-filter-range" data-field="${escapeHtml(field.field_name)}" data-range="to" value="${to}">
    </div>`;
}

/**
 * Attach event handlers for dynamic field filters
 */
function attachDynamicFilterHandlers() {
  const container = document.getElementById('dynamicFieldFilters');
  if (!container) return;

  // Toggle handlers for section headers
  container.querySelectorAll('.clickable-header').forEach(header => {
    header.addEventListener('click', () => {
      const fieldName = header.dataset.toggle.replace('field-', '');
      const content = document.getElementById(`fieldFilter-${fieldName}`);
      const icon = header.querySelector('.toggle-icon');

      if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.classList.replace('fa-chevron-right', 'fa-chevron-down');
        localStorage.setItem(`fieldFilterExpanded-${fieldName}`, 'true');
      } else {
        content.style.display = 'none';
        icon.classList.replace('fa-chevron-down', 'fa-chevron-right');
        localStorage.setItem(`fieldFilterExpanded-${fieldName}`, 'false');
      }
    });
  });

  // Select button handlers
  container.querySelectorAll('.dynamic-field-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldName = btn.dataset.field;
      const value = btn.dataset.value;

      // Update active state
      btn.parentElement.querySelectorAll('.dynamic-field-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update filter state
      if (value === 'all') {
        delete dynamicFieldFilters[fieldName];
      } else {
        dynamicFieldFilters[fieldName] = value;
      }

      applyFilters();
    });
  });

  // Text input handlers with debounce
  let textInputTimeout;
  container.querySelectorAll('.dynamic-filter-input').forEach(input => {
    input.addEventListener('input', () => {
      clearTimeout(textInputTimeout);
      textInputTimeout = setTimeout(() => {
        const fieldName = input.dataset.field;
        const value = input.value.trim();

        if (value) {
          dynamicFieldFilters[fieldName] = value;
        } else {
          delete dynamicFieldFilters[fieldName];
        }

        applyFilters();
      }, 300);
    });
  });

  // Range input handlers (number and date)
  container.querySelectorAll('.dynamic-filter-range').forEach(input => {
    input.addEventListener('change', () => {
      const fieldName = input.dataset.field;
      const rangeType = input.dataset.range;
      const value = input.value;

      if (!dynamicFieldFilters[fieldName] || typeof dynamicFieldFilters[fieldName] !== 'object') {
        dynamicFieldFilters[fieldName] = {};
      }

      if (value) {
        dynamicFieldFilters[fieldName][rangeType] = value;
      } else {
        delete dynamicFieldFilters[fieldName][rangeType];
        if (Object.keys(dynamicFieldFilters[fieldName]).length === 0) {
          delete dynamicFieldFilters[fieldName];
        }
      }

      applyFilters();
    });
  });
}

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
        <i class="fas ${st.icon}" style="color: ${st.color}"></i>
        <span class="cat-name">${st.name}</span>
        <span class="cat-count">${count}</span>
      </div>
    `;
  });

  // Add combined category if exists
  const combinedName = serviceTypes.map(st => st.name).join(' + ');
  const combinedCount = categoryStats[combinedName] || 0;
  if (combinedCount > 0) {
    const icons = serviceTypes.map(st => `<i class="fas ${st.icon}" style="color: ${st.color}"></i>`).join('');
    html += `
      <div class="category-stat">
        ${icons}
        <span class="cat-name">Begge</span>
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

// ========================================
// SMART ROUTE ENGINE
// Geografisk klynging med effektivitetsberegning
// ========================================

const SmartRouteEngine = {
  // Bruker-konfigurerbare parametere
  params: {
    daysAhead: parseInt(localStorage.getItem('smartRoute_daysAhead')) || 60,
    maxCustomersPerRoute: parseInt(localStorage.getItem('smartRoute_maxCustomers')) || 15,
    maxDrivingTimeMinutes: parseInt(localStorage.getItem('smartRoute_maxDrivingTime')) || 480,
    minClusterSize: 3,
    clusterRadiusKm: parseFloat(localStorage.getItem('smartRoute_clusterRadius')) || 5,
    serviceTimeMinutes: 30
  },

  // State
  clusters: [],
  selectedClusterId: null,
  clusterLayer: null,
  showAllRecommendations: false,

  // Lagre parametere til localStorage
  saveParams() {
    localStorage.setItem('smartRoute_daysAhead', this.params.daysAhead);
    localStorage.setItem('smartRoute_maxCustomers', this.params.maxCustomersPerRoute);
    localStorage.setItem('smartRoute_maxDrivingTime', this.params.maxDrivingTimeMinutes);
    localStorage.setItem('smartRoute_clusterRadius', this.params.clusterRadiusKm);
  },

  // Haversine-avstand mellom to punkter (km)
  haversineDistance(lat1, lng1, lat2, lng2) {
    // Valider at alle koordinater er gyldige tall
    if (!Number.isFinite(lat1) || !Number.isFinite(lng1) ||
        !Number.isFinite(lat2) || !Number.isFinite(lng2)) {
      return Infinity; // Ugyldig avstand - vil bli filtrert ut
    }
    const R = 6371; // Jordens radius i km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  // Beregn sentroid for en gruppe kunder
  getCentroid(customerList) {
    if (customerList.length === 0) return null;
    const sumLat = customerList.reduce((sum, c) => sum + c.lat, 0);
    const sumLng = customerList.reduce((sum, c) => sum + c.lng, 0);
    return {
      lat: sumLat / customerList.length,
      lng: sumLng / customerList.length
    };
  },

  // Beregn bounding box for en gruppe kunder
  getBoundingBox(customerList) {
    const lats = customerList.map(c => c.lat);
    const lngs = customerList.map(c => c.lng);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs)
    };
  },

  // Filtrer kunder som trenger kontroll
  getCustomersNeedingControl() {
    // Sjekk at customers array er tilgjengelig og gyldig
    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      return [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + this.params.daysAhead);

    return customers.filter(c => {
      if (!c) return false; // Hopp over null/undefined kunder
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return false; // Må ha gyldige koordinater
      const nextDate = getNextControlDate(c);
      if (!nextDate || !(nextDate instanceof Date) || isNaN(nextDate.getTime())) return false;
      return nextDate <= futureDate;
    });
  },

  // DBSCAN-klynging
  dbscanClustering(customerList, epsilon, minPoints) {
    const n = customerList.length;
    if (n === 0) return [];

    const visited = new Array(n).fill(false);
    const noise = new Array(n).fill(false);
    const clusterIds = new Array(n).fill(-1);
    let currentCluster = 0;

    // Bygg spatial grid for raskere nabo-oppslag (O(1) per celle i stedet for O(n))
    const cellSizeKm = epsilon; // Cellestørrelse lik epsilon
    const cellSizeDeg = cellSizeKm / 111; // Konverter km til grader (approx)
    const grid = {};

    // Plasser alle kunder i grid-celler
    customerList.forEach((c, idx) => {
      const cellX = Math.floor(c.lng / cellSizeDeg);
      const cellY = Math.floor(c.lat / cellSizeDeg);
      const key = `${cellX},${cellY}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(idx);
    });

    // Finn naboer via grid (sjekker kun 9 nærliggende celler)
    const getNeighbors = (pointIndex) => {
      const neighbors = [];
      const p = customerList[pointIndex];
      const cellX = Math.floor(p.lng / cellSizeDeg);
      const cellY = Math.floor(p.lat / cellSizeDeg);

      // Sjekk 3x3 celler rundt punktet
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${cellX + dx},${cellY + dy}`;
          const cellIndices = grid[key];
          if (cellIndices) {
            for (const i of cellIndices) {
              if (i !== pointIndex) {
                const dist = this.haversineDistance(p.lat, p.lng, customerList[i].lat, customerList[i].lng);
                if (dist <= epsilon) {
                  neighbors.push(i);
                }
              }
            }
          }
        }
      }
      return neighbors;
    };

    // Ekspander klynge (optimalisert med Set for O(1) lookup)
    const expandCluster = (pointIndex, neighbors, clusterId) => {
      clusterIds[pointIndex] = clusterId;
      const queue = [...neighbors];
      const queueSet = new Set(neighbors); // O(1) lookup i stedet for O(n)

      while (queue.length > 0) {
        const currentIndex = queue.shift();

        if (!visited[currentIndex]) {
          visited[currentIndex] = true;
          const currentNeighbors = getNeighbors(currentIndex);

          if (currentNeighbors.length >= minPoints) {
            for (const neighbor of currentNeighbors) {
              if (!queueSet.has(neighbor) && clusterIds[neighbor] === -1) {
                queue.push(neighbor);
                queueSet.add(neighbor);
              }
            }
          }
        }

        if (clusterIds[currentIndex] === -1) {
          clusterIds[currentIndex] = clusterId;
        }
      }
    };

    // Hovedløkke
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      visited[i] = true;

      const neighbors = getNeighbors(i);

      if (neighbors.length < minPoints) {
        noise[i] = true;
      } else {
        expandCluster(i, neighbors, currentCluster);
        currentCluster++;
      }
    }

    // Grupper kunder etter klynge-ID
    const clusters = [];
    for (let clusterId = 0; clusterId < currentCluster; clusterId++) {
      const clusterCustomers = customerList.filter((_, idx) => clusterIds[idx] === clusterId);
      if (clusterCustomers.length >= minPoints) {
        clusters.push(clusterCustomers);
      }
    }

    return clusters;
  },

  // Beregn effektivitetsscore for en klynge
  calculateClusterEfficiency(cluster) {
    const n = cluster.length;
    if (n < 2) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start-lokasjon (fra config eller default)
    const startLat = appConfig.routeStartLat || 59.9139;
    const startLng = appConfig.routeStartLng || 10.7522;

    // Sentroid
    const centroid = this.getCentroid(cluster);

    // Avstand fra start til sentroid
    const distanceToStart = this.haversineDistance(startLat, startLng, centroid.lat, centroid.lng);

    // Klyngens kompakthet (gjennomsnittlig avstand fra sentroid)
    const avgDistanceFromCentroid = cluster.reduce((sum, c) =>
      sum + this.haversineDistance(c.lat, c.lng, centroid.lat, centroid.lng), 0
    ) / n;

    // Kundetetthet (kunder per km²)
    const bbox = this.getBoundingBox(cluster);
    const latDiff = (bbox.maxLat - bbox.minLat) * 111; // ~111 km per grad lat
    const lngDiff = (bbox.maxLng - bbox.minLng) * 111 * Math.cos(centroid.lat * Math.PI / 180);
    const area = Math.max(latDiff * lngDiff, 0.1); // Minimum 0.1 km²
    const density = n / area;

    // Tell forfalte kunder
    const overdueCount = cluster.filter(c => {
      const nextDate = getNextControlDate(c);
      return nextDate && nextDate < today;
    }).length;

    // Estimert kjøretid (minutter)
    // - Tur-retur til klynge: avstand * 2 / 50 km/t * 60 min
    // - Intra-klynge kjøring: gjennomsnittlig avstand * antall * 2 / 30 km/t * 60 min
    // - Servicetid per kunde
    const travelToCluster = (distanceToStart * 2 / 50) * 60;
    const intraClusterTravel = (avgDistanceFromCentroid * n * 1.5 / 30) * 60;
    const serviceTime = n * this.params.serviceTimeMinutes;
    const estimatedMinutes = Math.round(travelToCluster + intraClusterTravel + serviceTime);

    // Estimert distanse (km)
    const estimatedKm = Math.round(distanceToStart * 2 + avgDistanceFromCentroid * n * 1.5);

    // Effektivitetsscore (0-100)
    // Høyere er bedre: belønner tetthet og antall, straffer lang avstand
    const rawScore = (density * n * 10) / (1 + distanceToStart * 0.05 + avgDistanceFromCentroid * 0.3);
    const efficiencyScore = Math.min(100, Math.round(rawScore * 10));

    // Finn primært område (mest vanlige poststed)
    const areaCount = {};
    cluster.forEach(c => {
      const area = c.poststed || 'Ukjent';
      areaCount[area] = (areaCount[area] || 0) + 1;
    });
    const sortedAreas = Object.entries(areaCount).sort((a, b) => b[1] - a[1]);
    const primaryArea = sortedAreas.length > 0 ? sortedAreas[0][0] : 'Ukjent';

    // Kategorier i klyngen
    const categories = [...new Set(cluster.map(c => c.kategori).filter(Boolean))];

    return {
      customers: cluster,
      customerCount: n,
      centroid,
      primaryArea,
      categories,
      overdueCount,
      upcomingCount: n - overdueCount,
      efficiencyScore,
      estimatedMinutes,
      estimatedKm,
      density: Math.round(density * 10) / 10,
      avgDistanceFromCentroid: Math.round(avgDistanceFromCentroid * 10) / 10,
      distanceToStart: Math.round(distanceToStart)
    };
  },

  // Generer anbefalinger
  generateRecommendations() {
    const customersNeedingControl = this.getCustomersNeedingControl();

    Logger.log('SmartRouteEngine: Kunder som trenger kontroll:', customersNeedingControl.length);

    if (customersNeedingControl.length < this.params.minClusterSize) {
      Logger.log('SmartRouteEngine: For få kunder, prøver fallback til område-basert');
      // Fallback til område-basert gruppering
      return this.generateAreaBasedRecommendations(customersNeedingControl);
    }

    // DBSCAN-klynging
    let rawClusters = this.dbscanClustering(
      customersNeedingControl,
      this.params.clusterRadiusKm,
      this.params.minClusterSize
    );

    Logger.log('SmartRouteEngine: DBSCAN fant', rawClusters.length, 'klynger');

    // Hvis DBSCAN ikke finner noe, prøv med større radius eller fallback
    if (rawClusters.length === 0 && customersNeedingControl.length >= 3) {
      Logger.log('SmartRouteEngine: Ingen DBSCAN-klynger, prøver større radius');
      // Prøv med dobbel radius
      rawClusters = this.dbscanClustering(
        customersNeedingControl,
        this.params.clusterRadiusKm * 2,
        this.params.minClusterSize
      );

      // Hvis fortsatt ingen, bruk område-basert fallback
      if (rawClusters.length === 0) {
        Logger.log('SmartRouteEngine: Bruker område-basert fallback');
        return this.generateAreaBasedRecommendations(customersNeedingControl);
      }
    }

    // Beregn effektivitet for hver klynge
    const scoredClusters = rawClusters
      .map((cluster, idx) => {
        const efficiency = this.calculateClusterEfficiency(cluster);
        if (!efficiency) return null;

        // Filtrer ut klynger som tar for lang tid
        if (efficiency.estimatedMinutes > this.params.maxDrivingTimeMinutes) {
          // Del opp i mindre klynger hvis for stor
          if (cluster.length > this.params.maxCustomersPerRoute) {
            return null; // For nå, hopp over
          }
        }

        // Begrens antall kunder per rute
        if (cluster.length > this.params.maxCustomersPerRoute) {
          // Ta de nærmeste til sentroiden
          const sorted = [...cluster].sort((a, b) => {
            const distA = this.haversineDistance(a.lat, a.lng, efficiency.centroid.lat, efficiency.centroid.lng);
            const distB = this.haversineDistance(b.lat, b.lng, efficiency.centroid.lat, efficiency.centroid.lng);
            return distA - distB;
          });
          const trimmed = sorted.slice(0, this.params.maxCustomersPerRoute);
          return this.calculateClusterEfficiency(trimmed);
        }

        return { ...efficiency, id: idx };
      })
      .filter(Boolean);

    // Sorter etter effektivitetsscore (høyest først)
    this.clusters = scoredClusters
      .sort((a, b) => b.efficiencyScore - a.efficiencyScore)
      .map((cluster, idx) => ({ ...cluster, id: idx }));

    return this.clusters;
  },

  // Vis/skjul klynge på kartet (toggle)
  showClusterOnMap(clusterId) {
    const cluster = this.clusters.find(c => c.id === clusterId);
    if (!cluster) return;

    // Sjekk at kart er initialisert
    if (!map) {
      showToast('Kartet er ikke lastet enda', 'warning');
      return;
    }

    // Toggle: Hvis samme klynge allerede vises, skjul den
    if (this.selectedClusterId === clusterId) {
      this.clearClusterVisualization();
      this.updateClusterButtons(); // Oppdater knapper
      return;
    }

    this.clearClusterVisualization();
    this.selectedClusterId = clusterId;
    this.updateClusterButtons(); // Oppdater knapper

    // Lag layer group for visualisering
    this.clusterLayer = L.layerGroup().addTo(map);

    // Tegn convex hull polygon rundt kundene
    const positions = cluster.customers.map(c => [c.lat, c.lng]);
    if (positions.length >= 3) {
      const hull = this.convexHull(positions);
      const polygon = L.polygon(hull, {
        color: '#ff6b00',
        weight: 2,
        fillColor: '#ff6b00',
        fillOpacity: 0.15,
        dashArray: '5, 5'
      }).addTo(this.clusterLayer);
    }

    // Marker kunder i klyngen
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    cluster.customers.forEach((c, idx) => {
      const nextDate = getNextControlDate(c);
      const isOverdue = nextDate && nextDate < today;

      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 10,
        color: isOverdue ? '#e74c3c' : '#f39c12',
        weight: 2,
        fillColor: isOverdue ? '#e74c3c' : '#f39c12',
        fillOpacity: 0.8
      }).addTo(this.clusterLayer);

      marker.bindPopup(`
        <strong>${escapeHtml(c.navn)}</strong><br>
        ${escapeHtml(c.adresse || '')}<br>
        <small>${isOverdue ? 'Forfalt' : 'Kommende'}</small>
      `);
    });

    // Marker sentroiden
    const centroidMarker = L.marker([cluster.centroid.lat, cluster.centroid.lng], {
      icon: L.divIcon({
        className: 'cluster-centroid-marker',
        html: `<div class="centroid-icon"><i class="fas fa-crosshairs"></i></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      })
    }).addTo(this.clusterLayer);

    // Zoom til klyngen
    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, { padding: [50, 50] });

    // Oppdater knapper etter visning
    this.updateClusterButtons();
  },

  // Fjern klynge-visualisering
  clearClusterVisualization() {
    if (this.clusterLayer && map) {
      map.removeLayer(this.clusterLayer);
      this.clusterLayer = null;
    }
    this.selectedClusterId = null;
  },

  // Oppdater knapper etter toggle
  updateClusterButtons() {
    // Finn alle "Vis detaljer" knapper og oppdater tekst
    document.querySelectorAll('.recommendation-card.enhanced').forEach(card => {
      const clusterId = parseInt(card.dataset.clusterId);
      const btn = card.querySelector('.rec-actions .btn-secondary');
      if (btn) {
        if (clusterId === this.selectedClusterId) {
          btn.innerHTML = '<i class="fas fa-eye-slash"></i> Skjul';
          card.classList.add('selected');
        } else {
          btn.innerHTML = '<i class="fas fa-map"></i> Vis detaljer';
          card.classList.remove('selected');
        }
      }
    });
  },

  // Convex hull algoritme (Gift wrapping)
  convexHull(points) {
    if (points.length < 3) return points;

    const cross = (o, a, b) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

    // Finn startpunkt (lavest lat, med tiebreaker på lng)
    let start = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] < points[start][0] ||
         (points[i][0] === points[start][0] && points[i][1] < points[start][1])) {
        start = i;
      }
    }

    const hull = [];
    let current = start;

    do {
      hull.push(points[current]);
      let next = 0;

      for (let i = 1; i < points.length; i++) {
        if (next === current || cross(points[current], points[next], points[i]) < 0) {
          next = i;
        }
      }

      current = next;
    } while (current !== start && hull.length < points.length);

    return hull;
  },

  // Opprett rute fra klynge
  createRouteFromCluster(clusterId) {
    const cluster = this.clusters.find(c => c.id === clusterId);
    if (!cluster) return;

    const customerIds = cluster.customers.map(c => c.id);
    createRouteFromCustomerIds(customerIds);
    switchToTab('routes');
    showToast(`Opprettet rute for ${cluster.primaryArea} med ${cluster.customerCount} kunder`);
  },

  // Fallback: Område-basert gruppering (som den gamle metoden)
  generateAreaBasedRecommendations(customersNeedingControl) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Hvis ingen kunder sendt inn, hent alle som trenger kontroll
    const customerList = customersNeedingControl.length > 0
      ? customersNeedingControl
      : this.getCustomersNeedingControl();

    if (customerList.length === 0) {
      this.clusters = [];
      return [];
    }

    // Grupper etter poststed
    const byArea = {};
    customerList.forEach(c => {
      const area = c.poststed || 'Ukjent';
      if (!byArea[area]) byArea[area] = [];
      byArea[area].push(c);
    });

    // Konverter til klynge-format med effektivitetsberegning
    const areaRecommendations = Object.entries(byArea)
      .filter(([area, custs]) => custs.length >= 2) // Minimum 2 kunder per område
      .map(([area, custs], idx) => {
        // Filtrer til kun kunder med koordinater
        const withCoords = custs.filter(c => c.lat && c.lng);
        if (withCoords.length < 2) return null;

        // Beregn effektivitet
        const efficiency = this.calculateClusterEfficiency(withCoords);
        if (!efficiency) return null;

        return {
          ...efficiency,
          id: idx,
          isAreaBased: true // Marker at dette er område-basert, ikke DBSCAN
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.efficiencyScore - a.efficiencyScore);

    this.clusters = areaRecommendations.map((cluster, idx) => ({ ...cluster, id: idx }));

    Logger.log('SmartRouteEngine: Område-basert fallback fant', this.clusters.length, 'klynger');

    return this.clusters;
  }
};

/**
 * Get smart area recommendations for route planning
 * Groups customers by poststed who need control within daysAhead days
 * @deprecated Use SmartRouteEngine.generateRecommendations() instead
 */
function getSmartAreaRecommendations(daysAhead = 60, minCustomers = 3) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + daysAhead);

  // Find customers needing control within daysAhead days
  const needsControl = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    return nextDate <= futureDate;
  });

  // Group by poststed
  const byArea = {};
  needsControl.forEach(c => {
    const area = c.poststed || 'Ukjent';
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push(c);
  });

  // Filter areas with at least minCustomers customers
  const recommendations = Object.entries(byArea)
    .filter(([area, custs]) => custs.length >= minCustomers)
    .map(([area, custs]) => ({
      area,
      customers: custs,
      count: custs.length,
      overdue: custs.filter(c => getNextControlDate(c) < today).length,
      categories: [...new Set(custs.map(c => c.kategori).filter(Boolean))]
    }))
    .sort((a, b) => b.count - a.count);

  return recommendations;
}

/**
 * Render smart recommendations in Ruteplanlegger tab
 * Uses SmartRouteEngine for geographic clustering
 */
function renderSmartRecommendations() {
  const container = document.getElementById('smartRecommendations');
  if (!container) return;

  // Oppdater SmartRouteEngine params fra HTML inputs
  const daysInput = document.getElementById('smartDaysAhead');
  const customersInput = document.getElementById('smartMaxCustomers');
  const radiusInput = document.getElementById('smartClusterRadius');

  if (daysInput) SmartRouteEngine.params.daysAhead = parseInt(daysInput.value) || 60;
  if (customersInput) SmartRouteEngine.params.maxCustomersPerRoute = parseInt(customersInput.value) || 15;
  if (radiusInput) SmartRouteEngine.params.clusterRadiusKm = parseFloat(radiusInput.value) || 5;

  // Lagre params
  SmartRouteEngine.saveParams();

  // Generer anbefalinger med SmartRouteEngine
  const recommendations = SmartRouteEngine.generateRecommendations();

  let html = '';

  if (recommendations.length === 0) {
    // Vis mer detaljert info om hvorfor ingen anbefalinger ble funnet
    const customersWithDates = customers.filter(c => getNextControlDate(c));
    const customersWithCoords = customers.filter(c => c.lat && c.lng);
    const needingControl = SmartRouteEngine.getCustomersNeedingControl();

    let emptyMessage = 'Ingen ruteklynger funnet.';
    let emptyHint = '';

    if (customers.length === 0) {
      emptyMessage = 'Ingen kunder i systemet.';
    } else if (customersWithCoords.length === 0) {
      emptyMessage = 'Ingen kunder har koordinater.';
      emptyHint = 'Legg til adresser med koordinater for å få ruteanbefalinger.';
    } else if (customersWithDates.length === 0) {
      emptyMessage = 'Ingen kunder har kontrolldatoer.';
      emptyHint = 'Legg til neste kontrolldato for å få ruteanbefalinger.';
    } else if (needingControl.length === 0) {
      emptyMessage = 'Ingen kontroller forfaller innen ' + SmartRouteEngine.params.daysAhead + ' dager.';
      emptyHint = 'Prøv å øke "Dager fremover" i innstillingene.';
    } else if (needingControl.length < 3) {
      emptyMessage = 'Kun ' + needingControl.length + ' kunde(r) trenger kontroll.';
      emptyHint = 'Minimum 2 kunder trengs for å danne en rute.';
    }

    html += `
      <div class="rec-empty">
        <i class="fas fa-info-circle"></i>
        <p>${emptyMessage}</p>
        ${emptyHint ? `<p class="rec-empty-hint">${emptyHint}</p>` : ''}
        <p class="rec-empty-stats">
          <small>${customers.length} kunder totalt | ${customersWithCoords.length} med koordinater | ${needingControl.length} trenger kontroll</small>
        </p>
      </div>`;
    container.innerHTML = html;
    return;
  }

  const maxVisible = SmartRouteEngine.showAllRecommendations ? recommendations.length : 6;
  recommendations.slice(0, maxVisible).forEach(rec => {
    // Bestem effektivitetsklasse
    let efficiencyClass = 'low';
    if (rec.efficiencyScore >= 70) efficiencyClass = 'high';
    else if (rec.efficiencyScore >= 40) efficiencyClass = 'medium';

    // Formater tid
    const hours = Math.floor(rec.estimatedMinutes / 60);
    const mins = rec.estimatedMinutes % 60;
    const timeStr = hours > 0 ? `${hours}t ${mins}m` : `${mins}m`;

    html += `
      <div class="recommendation-card enhanced ${SmartRouteEngine.selectedClusterId === rec.id ? 'selected' : ''}" data-cluster-id="${rec.id}">
        <div class="rec-header">
          <div class="rec-title">
            <span class="rec-cluster-id">#${rec.id + 1}</span>
            <h4><i class="fas fa-map-pin"></i> ${escapeHtml(rec.primaryArea)}</h4>
          </div>
          <div class="rec-efficiency ${efficiencyClass}">
            <span class="efficiency-score">${rec.efficiencyScore}%</span>
            <span class="efficiency-label">effektivitet</span>
          </div>
        </div>

        <div class="rec-metrics">
          <div class="metric">
            <i class="fas fa-users"></i>
            <span>${rec.customerCount} kunder</span>
          </div>
          <div class="metric">
            <i class="fas fa-road"></i>
            <span>~${rec.estimatedKm} km</span>
          </div>
          <div class="metric">
            <i class="fas fa-clock"></i>
            <span>~${timeStr}</span>
          </div>
          ${rec.overdueCount > 0 ? `
          <div class="metric urgency">
            <i class="fas fa-exclamation-triangle"></i>
            <span>${rec.overdueCount} forfalte</span>
          </div>
          ` : ''}
        </div>

        <div class="rec-categories">
          ${rec.categories.map(c => `<span class="category-tag">${escapeHtml(c)}</span>`).join('') || '<span class="category-tag">Diverse</span>'}
        </div>

        <div class="rec-actions">
          <button class="btn btn-secondary btn-small" onclick="SmartRouteEngine.showClusterOnMap(${rec.id})">
            ${SmartRouteEngine.selectedClusterId === rec.id
              ? '<i class="fas fa-eye-slash"></i> Skjul'
              : '<i class="fas fa-map"></i> Vis detaljer'}
          </button>
          <button class="btn btn-primary btn-small" onclick="SmartRouteEngine.createRouteFromCluster(${rec.id})">
            <i class="fas fa-route"></i> Opprett rute
          </button>
        </div>
      </div>
    `;
  });

  if (recommendations.length > 6) {
    if (SmartRouteEngine.showAllRecommendations) {
      html += `<button class="btn btn-link rec-toggle-all" onclick="toggleShowAllRecommendations()">
        <i class="fas fa-chevron-up"></i> Vis færre
      </button>`;
    } else {
      html += `<button class="btn btn-link rec-toggle-all" onclick="toggleShowAllRecommendations()">
        <i class="fas fa-chevron-down"></i> Vis alle ${recommendations.length} anbefalinger
      </button>`;
    }
  }

  container.innerHTML = html;
}

/**
 * Toggle showing all recommendations vs limited
 */
function toggleShowAllRecommendations() {
  SmartRouteEngine.showAllRecommendations = !SmartRouteEngine.showAllRecommendations;
  renderSmartRecommendations();
}

/**
 * Update smart route settings and regenerate recommendations
 */
function updateSmartRouteSettings() {
  // Hent verdier fra inputs
  const daysAhead = parseInt(document.getElementById('smartDaysAhead')?.value) || 60;
  const maxCustomers = parseInt(document.getElementById('smartMaxCustomers')?.value) || 15;
  const maxDrivingTime = parseInt(document.getElementById('smartMaxDrivingTime')?.value) || 480;
  const clusterRadius = parseFloat(document.getElementById('smartClusterRadius')?.value) || 5;

  // Oppdater SmartRouteEngine
  SmartRouteEngine.params.daysAhead = daysAhead;
  SmartRouteEngine.params.maxCustomersPerRoute = maxCustomers;
  SmartRouteEngine.params.maxDrivingTimeMinutes = maxDrivingTime;
  SmartRouteEngine.params.clusterRadiusKm = clusterRadius;

  // Lagre til localStorage
  SmartRouteEngine.saveParams();

  // Fjern eventuell klynge-visualisering
  SmartRouteEngine.clearClusterVisualization();

  // Regenerer anbefalinger
  renderSmartRecommendations();

  showToast('Innstillinger oppdatert');
}

// Flag for å unngå duplikate event listeners
let smartRouteListenersInitialized = false;

/**
 * Initialize smart route settings slider listeners and values
 */
function initSmartRouteSettingsListeners() {
  // Params er allerede lastet fra localStorage i SmartRouteEngine.params

  // Oppdater slider-verdier fra lagrede params
  const daysSlider = document.getElementById('smartDaysAhead');
  const customersSlider = document.getElementById('smartMaxCustomers');
  const radiusSlider = document.getElementById('smartClusterRadius');

  if (daysSlider) {
    daysSlider.value = SmartRouteEngine.params.daysAhead;
    const daysValue = document.getElementById('smartDaysAheadValue');
    if (daysValue) daysValue.textContent = `${SmartRouteEngine.params.daysAhead} dager`;
  }

  if (customersSlider) {
    customersSlider.value = SmartRouteEngine.params.maxCustomersPerRoute;
    const customersValue = document.getElementById('smartMaxCustomersValue');
    if (customersValue) customersValue.textContent = `${SmartRouteEngine.params.maxCustomersPerRoute} kunder`;
  }

  if (radiusSlider) {
    radiusSlider.value = SmartRouteEngine.params.clusterRadiusKm;
    const radiusValue = document.getElementById('smartClusterRadiusValue');
    if (radiusValue) radiusValue.textContent = `${SmartRouteEngine.params.clusterRadiusKm} km`;
  }

  // Bare legg til event listeners én gang - men kun hvis sliderne finnes
  if (smartRouteListenersInitialized) return;
  if (!daysSlider || !customersSlider || !radiusSlider) return; // Vent til DOM er klar
  smartRouteListenersInitialized = true;

  // Hjelpefunksjon for å vise tooltip ved slider
  const showSliderTooltip = (slider, value, unit) => {
    let tooltip = slider.parentElement.querySelector('.slider-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'slider-tooltip';
      slider.parentElement.style.position = 'relative';
      slider.parentElement.appendChild(tooltip);
    }

    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const percent = ((parseFloat(slider.value) - min) / (max - min)) * 100;

    tooltip.textContent = `${value}${unit}`;
    tooltip.style.left = `${percent}%`;
    tooltip.classList.add('visible');
  };

  const hideSliderTooltip = (slider) => {
    const tooltip = slider.parentElement.querySelector('.slider-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
    }
  };

  // Dager fremover
  if (daysSlider) {
    daysSlider.addEventListener('input', function() {
      const val = this.value;
      const valueEl = document.getElementById('smartDaysAheadValue');
      if (valueEl) valueEl.textContent = `${val} dager`;
      showSliderTooltip(this, val, ' dager');
    });
    daysSlider.addEventListener('mouseup', function() { hideSliderTooltip(this); });
    daysSlider.addEventListener('mouseleave', function() { hideSliderTooltip(this); });
    daysSlider.addEventListener('touchend', function() { hideSliderTooltip(this); });
  }

  // Maks kunder
  if (customersSlider) {
    customersSlider.addEventListener('input', function() {
      const val = this.value;
      const valueEl = document.getElementById('smartMaxCustomersValue');
      if (valueEl) valueEl.textContent = `${val} kunder`;
      showSliderTooltip(this, val, ' kunder');
    });
    customersSlider.addEventListener('mouseup', function() { hideSliderTooltip(this); });
    customersSlider.addEventListener('mouseleave', function() { hideSliderTooltip(this); });
    customersSlider.addEventListener('touchend', function() { hideSliderTooltip(this); });
  }

  // Klyngeradius
  if (radiusSlider) {
    radiusSlider.addEventListener('input', function() {
      const val = this.value;
      const valueEl = document.getElementById('smartClusterRadiusValue');
      if (valueEl) valueEl.textContent = `${val} km`;
      showSliderTooltip(this, val, ' km');
    });
    radiusSlider.addEventListener('mouseup', function() { hideSliderTooltip(this); });
    radiusSlider.addEventListener('mouseleave', function() { hideSliderTooltip(this); });
    radiusSlider.addEventListener('touchend', function() { hideSliderTooltip(this); });
  }
}

/**
 * Show customers from a specific area on the map
 */
function showAreaOnMap(area) {
  const areaCustomers = customers.filter(c => c.poststed === area);
  if (areaCustomers.length === 0) return;

  // Get valid coordinates
  const coords = areaCustomers
    .filter(c => c.lat && c.lng)
    .map(c => [c.lat, c.lng]);

  if (coords.length === 0) {
    showToast('Ingen kunder med koordinater i dette området', 'warning');
    return;
  }

  // Fit map to bounds
  const bounds = L.latLngBounds(coords);
  map.fitBounds(bounds, { padding: [50, 50] });

  // Highlight the customers
  highlightCustomersOnMap(areaCustomers.map(c => c.id));

  showToast(`Viser ${areaCustomers.length} kunder i ${area}`);
}

/**
 * Create a route for customers in a specific area
 */
function createRouteForArea(area, customerIds) {
  if (!customerIds || customerIds.length === 0) {
    showToast('Ingen kunder å lage rute for', 'warning');
    return;
  }

  // Use existing route creation function
  createRouteFromCustomerIds(customerIds);
  switchToTab('routes');
  showToast(`Opprettet rute for ${area} med ${customerIds.length} kunder`);
}

/**
 * Highlight specific customers on the map with area highlight
 */
function highlightCustomersOnMap(customerIds) {
  // Clear previous highlights
  clearMapHighlights();

  // Create a layer group for highlight rings
  window.highlightLayer = L.layerGroup().addTo(map);
  window.highlightedCustomerIds = customerIds;

  // Get positions of all customers to highlight
  const positions = [];
  customers.forEach(c => {
    if (customerIds.includes(c.id) && c.lat && c.lng) {
      positions.push([c.lat, c.lng]);
    }
  });

  if (positions.length === 0) {
    showToast('Ingen kunder med koordinater funnet', 'warning');
    return;
  }

  // Add small marker at each position
  positions.forEach(pos => {
    const dot = L.circleMarker(pos, {
      radius: 8,
      color: '#ff6b00',
      weight: 2,
      fillColor: '#ff6b00',
      fillOpacity: 0.8,
      className: 'highlight-dot'
    }).addTo(window.highlightLayer);
  });

  // Create area highlight around all points
  if (positions.length >= 3) {
    // Use convex hull for 3+ points
    const hull = getConvexHull(positions);
    const polygon = L.polygon(hull, {
      color: '#ff6b00',
      weight: 3,
      fillColor: '#ff6b00',
      fillOpacity: 0.1,
      dashArray: '8, 8',
      className: 'highlight-area'
    }).addTo(window.highlightLayer);
  } else if (positions.length === 2) {
    // Draw line between 2 points with buffer
    const line = L.polyline(positions, {
      color: '#ff6b00',
      weight: 4,
      dashArray: '8, 8',
      className: 'highlight-area'
    }).addTo(window.highlightLayer);
  } else {
    // Single point - draw larger circle
    const circle = L.circle(positions[0], {
      radius: 500,
      color: '#ff6b00',
      weight: 2,
      fillColor: '#ff6b00',
      fillOpacity: 0.1,
      dashArray: '8, 8',
      className: 'highlight-area'
    }).addTo(window.highlightLayer);
  }

  // Show count
  showToast(`${positions.length} kunder i området markert`, 'success');
}

/**
 * Calculate convex hull of points (Graham scan algorithm)
 */
function getConvexHull(points) {
  if (points.length < 3) return points;

  // Find lowest point
  let lowest = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] < points[lowest][0] ||
        (points[i][0] === points[lowest][0] && points[i][1] < points[lowest][1])) {
      lowest = i;
    }
  }

  // Swap lowest to first position
  [points[0], points[lowest]] = [points[lowest], points[0]];
  const pivot = points[0];

  // Sort by polar angle
  const sorted = points.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a[0] - pivot[0], a[1] - pivot[1]);
    const angleB = Math.atan2(b[0] - pivot[0], b[1] - pivot[1]);
    return angleA - angleB;
  });

  // Build hull
  const hull = [pivot];
  for (const point of sorted) {
    while (hull.length > 1 && crossProduct(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
      hull.pop();
    }
    hull.push(point);
  }

  return hull;
}

function crossProduct(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Clear all map highlights
 */
function clearMapHighlights() {
  if (window.highlightLayer) {
    window.highlightLayer.clearLayers();
    map.removeLayer(window.highlightLayer);
    window.highlightLayer = null;
  }
  window.highlightedCustomerIds = [];
}

/**
 * Switch to a specific tab
 */
function switchToTab(tabName) {
  const tabBtn = document.querySelector(`.tab-item[data-tab="${tabName}"]`);
  if (tabBtn) {
    tabBtn.click();
  }
}

// Sync map view to match the active tab context (mobile only)
function syncMapToTab(tabName) {
  if (!isMobile || !map) return;

  switch (tabName) {
    case 'customers': {
      const positions = customers
        .filter(c => c.lat && c.lng)
        .map(c => [c.lat, c.lng]);
      if (positions.length > 0) {
        map.fitBounds(L.latLngBounds(positions), { padding: [30, 30] });
      }
      break;
    }
    case 'routes': {
      if (routeLayer && routeLayer.getBounds) {
        try {
          map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
        } catch (e) {
          // routeLayer may be empty
        }
      }
      break;
    }
    case 'overdue': {
      const now = new Date();
      const overduePositions = customers
        .filter(c => c.neste_kontroll && c.lat && c.lng && new Date(c.neste_kontroll) < now)
        .map(c => [c.lat, c.lng]);
      if (overduePositions.length > 0) {
        map.fitBounds(L.latLngBounds(overduePositions), { padding: [30, 30] });
      }
      break;
    }
  }
}

// ========================================
// SPA VIEW MANAGEMENT
// ========================================

// Get Mapbox access token from server config
function getMapboxToken() {
  if (appConfig.mapboxAccessToken) {
    return appConfig.mapboxAccessToken;
  }
  Logger.error('Mapbox token mangler - sett MAPBOX_ACCESS_TOKEN i server-miljøvariabler');
  return '';
}

// Initialize the shared map (used for both login background and app)
// Get map tile layer - Mapbox Satellite Streets (satellite with roads and labels)
function getMapTileUrl() {
  // Mapbox Satellite Streets - satellittbilder med veier og stedsnavn
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${getMapboxToken()}`;
}

// Get attribution for current tile layer
function getMapAttribution() {
  return '&copy; <a href="https://mapbox.com/">Mapbox</a> &copy; <a href="https://openstreetmap.org/">OpenStreetMap</a>';
}

// Variable to store current tile layer for later switching
let currentTileLayer = null;

// Map mode: 'satellite' only (dark mode removed)
let mapMode = 'satellite';

// Toggle between street map and satellite view
function toggleNightMode() {
  if (!map || !currentTileLayer) return;

  const btn = document.getElementById('nightmodeBtn');
  const icon = btn?.querySelector('i');
  const mapContainer = document.getElementById('map');

  // Disable button during transition
  if (btn) btn.disabled = true;

  // Fade out the map
  mapContainer.style.transition = 'opacity 0.4s ease-out';
  mapContainer.style.opacity = '0';

  setTimeout(() => {
    if (mapMode === 'dark') {
      // Switch to Mapbox Satellite Streets (satellite with all roads and labels)
      map.removeLayer(currentTileLayer);
      currentTileLayer = L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${getMapboxToken()}`, {
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1,
        attribution: '&copy; Mapbox'
      }).addTo(map);

      mapMode = 'satellite';
      btn?.classList.add('satellite-active');
      if (icon) {
        icon.className = 'fas fa-sun';
      }
      btn?.setAttribute('title', 'Bytt til mørkt kart');
    } else {
      // Switch to Mapbox Navigation Night (dark with visible roads)
      map.removeLayer(currentTileLayer);
      currentTileLayer = L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/{z}/{x}/{y}?access_token=${getMapboxToken()}`, {
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1,
        attribution: '&copy; Mapbox'
      }).addTo(map);

      mapMode = 'dark';
      btn?.classList.remove('satellite-active');
      if (icon) {
        icon.className = 'fas fa-moon';
      }
      btn?.setAttribute('title', 'Bytt til satellittkart');
    }

    // Fade back in
    setTimeout(() => {
      mapContainer.style.opacity = '1';
      if (btn) btn.disabled = false;
    }, 100);
  }, 400);
}

// Office location marker (glowing house icon)
let officeMarker = null;

function initSharedMap() {
  const mapEl = document.getElementById('map');
  if (mapEl && !map) {
    // Start zoomed in on Troms region (company location) for login view
    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false
    }).setView([69.06888, 17.65274], 11);

    // Use dynamic tile layer based on time of day
    const tileUrl = getMapTileUrl();
    Logger.log('Map tile URL:', tileUrl, '| Hour:', new Date().getHours());

    currentTileLayer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      tileSize: 512,
      zoomOffset: -1,
      attribution: getMapAttribution()
    }).addTo(map);

    // Add glowing office marker (Brøstadveien 343, 9311 Brøstadbotn)
    const officeIcon = L.divIcon({
      className: 'office-marker-glow',
      html: `
        <div class="office-marker-container">
          <div class="office-glow-ring"></div>
          <div class="office-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [60, 60],
      iconAnchor: [30, 30]
    });

    officeMarker = L.marker([69.06888, 17.65274], {
      icon: officeIcon,
      interactive: false  // Not clickable - just visual decoration
    }).addTo(map);
  }
}

// Initialize login view (just set up form handler, map is already initialized)
function initLoginView() {
  // Set up login form handler
  const loginForm = document.getElementById('spaLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleSpaLogin);
  }
}

// Handle SPA login
async function handleSpaLogin(e) {
  e.preventDefault();

  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const rememberMe = document.getElementById('loginRememberMe').checked;
  const loginBtn = document.getElementById('spaLoginBtn');
  const errorMessage = document.getElementById('loginErrorMessage');
  const errorText = document.getElementById('loginErrorText');

  loginBtn.disabled = true;
  loginBtn.innerHTML = '<div class="login-spinner"></div><span>Logger inn...</span>';
  errorMessage.classList.remove('show');

  try {
    const loginHeaders = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      loginHeaders['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch('/api/klient/login', {
      method: 'POST',
      headers: loginHeaders,
      credentials: 'include',
      body: JSON.stringify({ epost: email, passord: password, rememberMe })
    });

    const rawData = await response.json();
    // Handle wrapped API response format: { success: true, data: { ... } }
    const data = rawData.success && rawData.data ? rawData.data : rawData;

    if (response.ok && (data.accessToken || data.token)) {
      // Auth is now managed via httpOnly cookies (set by server)
      // Keep authToken in memory for backward compat during transition
      authToken = data.accessToken || data.token;
      if (data.expiresAt) accessTokenExpiresAt = data.expiresAt;
      localStorage.setItem('userName', data.klient?.navn || data.bruker?.navn || 'Bruker');
      localStorage.setItem('userRole', data.klient?.rolle || data.bruker?.rolle || 'bruker');
      localStorage.setItem('userType', data.klient?.type || 'klient');

      // Multi-tenancy: Store organization context
      if (data.klient?.organizationId) {
        localStorage.setItem('organizationId', data.klient.organizationId);
        localStorage.setItem('organizationSlug', data.klient.organizationSlug || '');
        localStorage.setItem('organizationName', data.klient.organizationName || '');
      }

      // Multi-tenancy: Apply organization branding if returned with login
      if (data.organization) {
        appConfig.primaryColor = data.organization.primaryColor || appConfig.primaryColor;
        appConfig.secondaryColor = data.organization.secondaryColor || appConfig.secondaryColor;
        appConfig.logoUrl = data.organization.logoUrl || appConfig.logoUrl;
        appConfig.companyName = data.organization.navn || appConfig.companyName;
        appConfig.appName = data.organization.brandTitle || appConfig.appName;
        appConfig.companySubtitle = data.organization.brandSubtitle || appConfig.companySubtitle;
        // App mode: 'mvp' = enkel versjon, 'full' = komplett (TRE Allservice)
        appConfig.appMode = data.organization.appMode || 'mvp';
        localStorage.setItem('appMode', appConfig.appMode);

        // Store subscription info for timer
        subscriptionInfo = {
          status: data.organization.subscriptionStatus,
          trialEndsAt: data.organization.trialEndsAt,
          planType: data.organization.planType
        };

        applyBranding();
        applyMvpModeUI();
      }

      // Show admin tab and manage button if user is admin/bruker
      const isAdmin = data.klient?.type === 'bruker' || data.klient?.rolle === 'admin';
      const adminTab = document.getElementById('adminTab');
      if (adminTab) {
        adminTab.style.display = isAdmin ? 'flex' : 'none';
      }

      // Show success state
      loginBtn.innerHTML = `
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="18" height="18">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
        <span>Velkommen!</span>
      `;
      loginBtn.style.background = '#4CAF50';

      // Check if user is a super-admin - if so, redirect to admin panel
      console.log('[Login Debug] data.klient:', data.klient);
      console.log('[Login Debug] data.klient?.type:', data.klient?.type);
      console.log('[Login Debug] Is type === bruker?:', data.klient?.type === 'bruker');
      if (data.klient?.type === 'bruker') {
        console.log('[Login Debug] Condition matched! Calling verify...');
        // Verify super-admin status via API
        try {
          const verifyRes = await fetch('/api/klient/verify', {
            credentials: 'include'
          });
          const verifyData = await verifyRes.json();
          console.log('[Login Debug] Verify response:', verifyData);
          console.log('[Login Debug] isSuperAdmin:', verifyData.data?.user?.isSuperAdmin);
          if (verifyData.data?.user?.isSuperAdmin) {
            console.log('[Login Debug] User IS super-admin! Redirecting to /admin...');
            localStorage.setItem('isSuperAdmin', 'true');
            // Redirect to admin panel
            setTimeout(() => {
              window.location.href = '/admin';
            }, 500);
            return; // Don't continue to main app
          }
        } catch (e) {
          console.warn('Could not verify super-admin status:', e);
        }
      } else {
        console.log('[Login Debug] Condition NOT matched - data.klient?.type is not bruker');
      }

      // Check if onboarding is needed (first login / no industry selected)
      const needsOnboarding = data.organization && !data.organization.onboardingCompleted;

      // Start the transition to app view (with onboarding if needed)
      setTimeout(async () => {
        if (needsOnboarding) {
          // Show onboarding wizard
          await showOnboardingWizard();
        }
        transitionToAppView();
      }, 300);
    } else {
      // Handle both wrapped error format { error: { message } } and legacy format { error: "string" }
      const errorMsg = data.error?.message || data.error || rawData.error?.message || 'Feil e-post eller passord';
      errorText.textContent = errorMsg;
      errorMessage.classList.add('show');
      resetLoginButton();
    }
  } catch (error) {
    console.error('Login error:', error);
    // Gi mer spesifikk feilmelding basert på feiltype
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      errorText.textContent = 'Kunne ikke koble til server - sjekk internettforbindelsen';
    } else if (error.name === 'SyntaxError' || error.message.includes('JSON')) {
      errorText.textContent = 'Ugyldig respons fra server';
    } else if (error.name === 'AbortError') {
      errorText.textContent = 'Forespørselen ble avbrutt';
    } else {
      errorText.textContent = error.message || 'Ukjent feil ved innlogging';
    }
    errorMessage.classList.add('show');
    resetLoginButton();
  }
}

function resetLoginButton() {
  const loginBtn = document.getElementById('spaLoginBtn');
  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.style.background = '';
    loginBtn.innerHTML = `
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>
      </svg>
      <span>Logg inn</span>
    `;
  }
}

// Show user bar with name and update admin tab visibility
function showUserBar() {
  const userBar = document.getElementById('userBar');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const userName = localStorage.getItem('userName') || localStorage.getItem('klientNavn') || 'Bruker';
  const userRole = localStorage.getItem('userRole') || '';
  const userType = localStorage.getItem('userType') || '';

  if (userBar) {
    userBar.style.display = 'flex';
    if (userNameDisplay) userNameDisplay.textContent = userName;
  }

  // Show admin tab and manage button if user is admin/bruker
  const isAdmin = userType === 'bruker' || userRole === 'admin';
  const adminTab = document.getElementById('adminTab');
  if (adminTab) {
    adminTab.style.display = isAdmin ? 'flex' : 'none';
  }

  // Initialize subscription countdown timer
  initSubscriptionTimer();
}

// Hide user bar
function hideUserBar() {
  const userBar = document.getElementById('userBar');
  if (userBar) userBar.style.display = 'none';

  // Hide subscription timer
  hideSubscriptionTimer();
}

// ========================================
// ONBOARDING
// ========================================

// Update onboarding step via API
async function updateOnboardingStep(step, data = {}) {
  try {
    const onboardHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      onboardHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/onboarding/step', {
      method: 'POST',
      headers: onboardHeaders,
      credentials: 'include',
      body: JSON.stringify({ step, data })
    });
    return await response.json();
  } catch (error) {
    console.error('Error updating onboarding step:', error);
    return { success: false };
  }
}

// Skip onboarding entirely
async function skipOnboarding() {
  try {
    const skipHeaders = {
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      skipHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/onboarding/skip', {
      method: 'POST',
      headers: skipHeaders,
      credentials: 'include'
    });
    return await response.json();
  } catch (error) {
    console.error('Error skipping onboarding:', error);
    return { success: false };
  }
}

// Get onboarding status
async function getOnboardingStatus() {
  try {
    const response = await fetch('/api/onboarding/status', {
      credentials: 'include'
    });
    return await response.json();
  } catch (error) {
    console.error('Error getting onboarding status:', error);
    return { success: false };
  }
}

// ========================================
// ONBOARDING WIZARD - Multi-step
// ========================================

const onboardingWizard = {
  currentStep: 0,
  // Note: Industry selection has been moved to the website registration/settings
  steps: [
    { id: 'company', title: 'Firmainformasjon', icon: 'fa-building' },
    { id: 'map', title: 'Kartinnstillinger', icon: 'fa-map-marker-alt' },
    { id: 'complete', title: 'Ferdig', icon: 'fa-check-circle' }
  ],
  data: {
    industry: null,
    company: {},
    map: {}
  },
  overlay: null,
  resolve: null
};

// Show onboarding wizard
async function showOnboardingWizard() {
  return new Promise(async (resolve) => {
    onboardingWizard.resolve = resolve;
    onboardingWizard.currentStep = 0;

    // Industry selection is now handled on the website dashboard, not in the app
    // Build wizard steps (without industry selection)
    onboardingWizard.steps = [
      { id: 'company', title: 'Firmainformasjon', icon: 'fa-building' },
      { id: 'import', title: 'Importer kunder', icon: 'fa-file-excel' },
      { id: 'map', title: 'Kartinnstillinger', icon: 'fa-map-marker-alt' },
      { id: 'complete', title: 'Ferdig', icon: 'fa-check-circle' }
    ];

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'onboardingWizardOverlay';
    overlay.className = 'onboarding-overlay';
    onboardingWizard.overlay = overlay;

    document.body.appendChild(overlay);

    // Render initial step
    await renderWizardStep();

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });
  });
}

// Render current wizard step
async function renderWizardStep() {
  const overlay = onboardingWizard.overlay;
  const step = onboardingWizard.steps[onboardingWizard.currentStep];

  let stepContent = '';

  switch (step.id) {
    case 'company':
      stepContent = renderCompanyStep();
      break;
    case 'import':
      stepContent = renderWizardImportStep();
      break;
    case 'map':
      stepContent = renderMapStep();
      break;
    case 'complete':
      stepContent = renderCompleteStep();
      break;
  }

  overlay.innerHTML = `
    <div class="onboarding-container wizard-container">
      ${renderWizardProgress()}
      <div class="wizard-content" data-step="${step.id}">
        ${stepContent}
      </div>
    </div>
  `;

  // Attach step-specific event listeners
  attachStepListeners(step.id);
}

// Render progress indicator
function renderWizardProgress() {
  const steps = onboardingWizard.steps;
  const current = onboardingWizard.currentStep;

  return `
    <div class="wizard-progress">
      <div class="wizard-progress-bar">
        <div class="wizard-progress-fill" style="width: ${(current / (steps.length - 1)) * 100}%"></div>
      </div>
      <div class="wizard-steps">
        ${steps.map((step, index) => `
          <div class="wizard-step ${index < current ? 'completed' : ''} ${index === current ? 'active' : ''} ${index > current ? 'upcoming' : ''}">
            <div class="wizard-step-icon">
              ${index < current ? '<i class="fas fa-check"></i>' : `<span>${index + 1}</span>`}
            </div>
            <div class="wizard-step-label">${step.title}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Render company info step
function renderCompanyStep() {
  const data = onboardingWizard.data.company;

  return `
    <div class="wizard-step-header">
      <h1><i class="fas fa-building"></i> Firmainformasjon</h1>
      <p>Oppgi firmaets adresse. Dette brukes som utgangspunkt for ruteplanlegging.</p>
    </div>

    <div class="wizard-form">
      <div class="wizard-form-group">
        <label for="companyAddress"><i class="fas fa-map-marker-alt"></i> Firmaadresse</label>
        <div class="wizard-address-wrapper">
          <input type="text" id="companyAddress" placeholder="Begynn å skrive adresse..." value="${escapeHtml(data.address || '')}" autocomplete="off">
          <div class="wizard-address-suggestions" id="wizardAddressSuggestions"></div>
        </div>
      </div>

      <div class="wizard-form-row">
        <div class="wizard-form-group">
          <label for="companyPostnummer"><i class="fas fa-hashtag"></i> Postnummer</label>
          <div class="wizard-postnummer-wrapper">
            <input type="text" id="companyPostnummer" placeholder="0000" maxlength="4" value="${escapeHtml(data.postnummer || '')}" autocomplete="off">
            <span class="wizard-postnummer-status" id="wizardPostnummerStatus"></span>
          </div>
        </div>
        <div class="wizard-form-group">
          <label for="companyPoststed"><i class="fas fa-city"></i> Poststed</label>
          <input type="text" id="companyPoststed" placeholder="Fylles automatisk" value="${escapeHtml(data.poststed || '')}">
        </div>
      </div>

      <div class="wizard-form-group">
        <label><i class="fas fa-route"></i> Rute-startpunkt</label>
        <p class="wizard-form-hint">Klikk på kartet for å velge startpunkt for ruter, eller bruk firmaadresse.</p>
        <div id="wizardRouteMap" class="wizard-mini-map"></div>
        <div class="wizard-coordinates" id="routeCoordinates">
          ${data.route_start_lat ? `<span>Valgt: ${data.route_start_lat.toFixed(5)}, ${data.route_start_lng.toFixed(5)}</span>` : '<span class="not-set">Ikke valgt - klikk på kartet</span>'}
        </div>
        <button class="wizard-btn wizard-btn-secondary" onclick="useAddressAsRouteStart()">
          <i class="fas fa-home"></i> Bruk firmaadresse
        </button>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-skip" onclick="handleSkipOnboarding()">
        <i class="fas fa-forward"></i> Hopp over oppsett
      </button>
      <button class="wizard-btn wizard-btn-primary" onclick="nextWizardStep()">
        Neste <i class="fas fa-arrow-right"></i>
      </button>
    </div>
  `;
}

// Render map settings step
function renderMapStep() {
  const data = onboardingWizard.data.map;

  return `
    <div class="wizard-step-header">
      <h1><i class="fas fa-map-marker-alt"></i> Kartinnstillinger</h1>
      <p>Velg standard kartvisning. Dra og zoom kartet til ønsket område.</p>
    </div>

    <div class="wizard-form">
      <div class="wizard-form-group">
        <label><i class="fas fa-map"></i> Standard kartsentrum</label>
        <p class="wizard-form-hint">Panorer og zoom kartet til det området du vanligvis jobber i.</p>
        <div id="wizardMainMap" class="wizard-map"></div>
      </div>

      <div class="wizard-form-group">
        <label for="defaultZoom"><i class="fas fa-search-plus"></i> Standard zoom-nivå</label>
        <div class="wizard-slider-container">
          <input type="range" id="defaultZoom" min="5" max="18" value="${data.zoom || 10}">
          <span class="wizard-slider-value" id="zoomValue">${data.zoom || 10}</span>
        </div>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="prevWizardStep()">
        <i class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-primary" onclick="nextWizardStep()">
        Fullfør oppsett <i class="fas fa-check"></i>
      </button>
    </div>
  `;
}

// Render completion step
function renderCompleteStep() {
  // Use industry from appConfig (set during registration on website)
  const industryName = appConfig?.industry?.name || onboardingWizard.data.industry?.name || 'din virksomhet';

  return `
    <div class="wizard-step-header wizard-complete">
      <div class="wizard-complete-icon">
        <i class="fas fa-check-circle"></i>
      </div>
      <h1>Oppsettet er fullført!</h1>
      <p>Flott! Systemet er nå tilpasset for ${escapeHtml(industryName)}.</p>
    </div>

    <div class="wizard-complete-summary">
      <h3>Hva skjer nå?</h3>
      <ul class="wizard-tips-list">
        <li><i class="fas fa-users"></i> Legg til dine første kunder</li>
        <li><i class="fas fa-route"></i> Planlegg effektive ruter</li>
        <li><i class="fas fa-calendar-alt"></i> Bruk kalenderen for å holde oversikt</li>
        <li><i class="fas fa-cog"></i> Tilpass ytterligere i innstillinger</li>
      </ul>
    </div>

    <div class="wizard-footer wizard-footer-center">
      <button class="wizard-btn wizard-btn-primary wizard-btn-large" onclick="completeOnboardingWizard()">
        <i class="fas fa-rocket"></i> Start å bruke Sky Planner
      </button>
    </div>
  `;
}

// ========================================
// WIZARD IMPORT STEP - Excel/CSV Import
// ========================================

// Shared field type map for import mapping (used by both preview and commit)
const IMPORT_FIELD_TYPE_MAP = {
  navn: 'string', adresse: 'string', postnummer: 'postnummer', poststed: 'string',
  telefon: 'phone', epost: 'email', kontaktperson: 'string', notater: 'string',
  kategori: 'kategori', el_type: 'string', brann_system: 'string',
  brann_driftstype: 'string', driftskategori: 'string',
  siste_el_kontroll: 'date', neste_el_kontroll: 'date',
  siste_brann_kontroll: 'date', neste_brann_kontroll: 'date',
  siste_kontroll: 'date', neste_kontroll: 'date',
  kontroll_intervall_mnd: 'integer', el_kontroll_intervall: 'integer',
  brann_kontroll_intervall: 'integer', ekstern_id: 'string', org_nummer: 'string',
};

// State management for wizard import
const wizardImportState = {
  currentImportStep: 1, // Sub-steps: 1=upload, 2=cleaning, 3=mapping, 4=preview, 5=results
  sessionId: null,
  batchId: null, // Staging batch ID from advanced backend
  previewData: null,
  columnMapping: {},
  categoryMapping: {},
  customFieldMapping: {},  // Tracks what to do with unmapped columns
  validCategories: [],
  importResults: null,
  isLoading: false,
  loadingPhase: null, // 'uploading' | 'parsing' | 'ai-mapping' | 'validating' | 'importing'
  loadingProgress: 0, // 0-100 for import progress
  importedSoFar: 0,
  totalToImport: 0,
  aiQuestions: [], // Questions from AI for ambiguous mappings
  questionAnswers: {}, // User answers to AI questions
  requiredMappings: { navn: null, adresse: null }, // User-selected columns for required fields
  error: null,
  // Row selection and editing state
  selectedRows: new Set(), // Set of selected row indices
  editedRows: {}, // Map of row index to edited values { rowIndex: { field: newValue } }
  editingCell: null, // Currently editing cell { row: number, field: string }
  // Cleaning state
  cleaningReport: null,         // CleaningReport from backend
  cleanedPreview: null,         // Cleaned rows from backend
  originalPreview: null,        // Original (uncleaned) rows
  enabledCleaningRules: {},     // { ruleId: boolean } - user toggles
  useCleanedData: true,         // Whether to proceed with cleaned data
  // Pagination & display state
  cleaningTablePage: 0,         // Current page in cleaning full table
  previewTablePage: 0,          // Current page in preview table
  previewShowBeforeAfter: false, // Toggle before/after transformation view
  fieldToHeaderMapping: {},     // Maps target field -> source header name
  showMethodChoice: true        // Show import method choice (integration vs file) before upload
};

// Track if we're in standalone import mode (vs onboarding wizard)
let standaloneImportMode = false;

// Reset wizard import state
function resetWizardImportState() {
  wizardImportState.currentImportStep = 1;
  wizardImportState.sessionId = null;
  wizardImportState.batchId = null;
  wizardImportState.previewData = null;
  wizardImportState.columnMapping = {};
  wizardImportState.categoryMapping = {};
  wizardImportState.customFieldMapping = {};
  wizardImportState.validCategories = [];
  wizardImportState.importResults = null;
  wizardImportState.isLoading = false;
  wizardImportState.loadingPhase = null;
  wizardImportState.loadingProgress = 0;
  wizardImportState.importedSoFar = 0;
  wizardImportState.totalToImport = 0;
  wizardImportState.aiQuestions = [];
  wizardImportState.questionAnswers = {};
  wizardImportState.requiredMappings = { navn: null, adresse: null };
  wizardImportState.error = null;
  wizardImportState.selectedRows = new Set();
  wizardImportState.editedRows = {};
  wizardImportState.editingCell = null;
  wizardImportState.cleaningReport = null;
  wizardImportState.cleanedPreview = null;
  wizardImportState.originalPreview = null;
  wizardImportState.enabledCleaningRules = {};
  wizardImportState.useCleanedData = true;
  wizardImportState.cleaningTablePage = 0;
  wizardImportState.previewTablePage = 0;
  wizardImportState.previewShowBeforeAfter = false;
  wizardImportState.fieldToHeaderMapping = {};
  wizardImportState.showMethodChoice = true;
}

// Show standalone import modal
function showImportModal() {
  standaloneImportMode = true;
  resetWizardImportState();

  const modal = document.getElementById('importModal');
  const content = document.getElementById('importModalContent');

  if (!modal || !content) return;

  // Render the import wizard content (reuse existing function)
  content.innerHTML = renderStandaloneImportWizard();

  // Show the modal
  modal.classList.remove('hidden');

  // Attach import-specific event listeners
  attachWizardImportListeners();
}

// Close standalone import modal
function closeImportModal() {
  const modal = document.getElementById('importModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  standaloneImportMode = false;

  // If import was completed, refresh the customer list
  if (wizardImportState.importResults?.imported > 0) {
    loadCustomers();
  }

  resetWizardImportState();
}

// Render standalone import wizard (without onboarding wrapper)
function renderStandaloneImportWizard() {
  const importStep = wizardImportState.currentImportStep;

  return `
    <!-- Import sub-steps indicator -->
    <div class="wizard-import-steps">
      <div class="import-step-indicator ${importStep >= 1 ? 'active' : ''}" data-step="1">
        <span class="step-number">1</span>
        <span class="step-label">Last opp</span>
      </div>
      <div class="import-step-connector ${importStep >= 2 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 2 ? 'active' : ''}" data-step="2">
        <span class="step-number">2</span>
        <span class="step-label">Datarensing</span>
      </div>
      <div class="import-step-connector ${importStep >= 3 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 3 ? 'active' : ''}" data-step="3">
        <span class="step-number">3</span>
        <span class="step-label">Mapping</span>
      </div>
      <div class="import-step-connector ${importStep >= 4 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 4 ? 'active' : ''}" data-step="4">
        <span class="step-number">4</span>
        <span class="step-label">Forhåndsvis</span>
      </div>
      <div class="import-step-connector ${importStep >= 5 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 5 ? 'active' : ''}" data-step="5">
        <span class="step-number">5</span>
        <span class="step-label">Resultat</span>
      </div>
    </div>

    <!-- Dynamic content based on sub-step -->
    <div class="wizard-import-content" id="wizardImportContent">
      ${renderWizardImportSubStep(importStep)}
    </div>
  `;
}

// Update standalone import modal content
function updateStandaloneImportContent() {
  if (!standaloneImportMode) return;

  const content = document.getElementById('importModalContent');
  if (content) {
    content.innerHTML = renderStandaloneImportWizard();
    attachWizardImportListeners();
  }
}

/**
 * Convert backend mapping format to frontend format
 * Backend: { "ExcelHeader": "dbField" } e.g., { "Kundenavn": "navn" }
 * Frontend: { "dbField": columnIndex } e.g., { "navn": 0 }
 */
function convertBackendToFrontendMapping(backendMapping, headers) {
  const frontendMapping = {};
  for (const [header, field] of Object.entries(backendMapping)) {
    const index = headers.indexOf(header);
    if (index !== -1) {
      frontendMapping[field] = index;
    }
  }
  return frontendMapping;
}

/**
 * Convert frontend mapping format to backend format
 * Frontend: { "dbField": columnIndex } e.g., { "navn": 0 }
 * Backend: { "ExcelHeader": "dbField" } e.g., { "Kundenavn": "navn" }
 */
function convertFrontendToBackendMapping(frontendMapping, headers) {
  const backendMapping = {};
  for (const [field, index] of Object.entries(frontendMapping)) {
    if (index !== undefined && index !== '' && headers[index]) {
      backendMapping[headers[index]] = field;
    }
  }
  return backendMapping;
}

/**
 * Get sample value for a field from sample data
 * @param {Object} sampleData - First row of raw data
 * @param {number} columnIndex - Index of the column
 * @param {Array} headers - Array of header names
 */
function getSampleValueForColumn(sampleData, columnIndex, headers) {
  if (!sampleData || columnIndex === undefined || columnIndex === '' || !headers) {
    return '-';
  }
  const header = headers[columnIndex];
  if (!header) return '-';
  const value = sampleData[header];
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

// Render import method choice (integration vs file upload)
function renderWizardImportMethodChoice() {
  return `
    <div class="wizard-step-header">
      <h1><i class="fas fa-download"></i> Importer kunder</h1>
      <p>Velg hvordan du vil hente inn dine eksisterende kunder.</p>
    </div>

    <div class="wizard-import-method-choice">
      <div class="wizard-method-card" onclick="selectImportMethodIntegration()">
        <div class="wizard-method-icon">
          <i class="fas fa-plug"></i>
        </div>
        <h3>Regnskapssystem</h3>
        <p>Koble til Tripletex, Fiken eller PowerOffice og synkroniser kunder automatisk.</p>
        <span class="wizard-method-action">Koble til <i class="fas fa-external-link-alt"></i></span>
      </div>

      <div class="wizard-method-card" onclick="selectImportMethodFile()">
        <div class="wizard-method-icon">
          <i class="fas fa-file-excel"></i>
        </div>
        <h3>Excel / CSV</h3>
        <p>Last opp en fil med kundedata. AI-assistert mapping hjelper deg med kolonnene.</p>
        <span class="wizard-method-action">Last opp fil <i class="fas fa-arrow-right"></i></span>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="prevWizardStep()">
        <i class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-skip" onclick="skipWizardImport()">
        Hopp over <i class="fas fa-forward"></i>
      </button>
    </div>
  `;
}

// Handle integration method selection in onboarding wizard
function selectImportMethodIntegration() {
  const webUrl = appConfig.webUrl || '';
  window.open(webUrl + '/dashboard/innstillinger/integrasjoner', '_blank');
  showToast('Koble til regnskapssystemet i fanen som ble apnet. Kom tilbake hit for a fortsette oppsettet.', 'info', 8000);
}

// Handle file import method selection in onboarding wizard
function selectImportMethodFile() {
  wizardImportState.showMethodChoice = false;
  // Re-render the import step to show file upload
  const container = document.querySelector('.wizard-content[data-step="import"]');
  if (container) {
    container.innerHTML = renderWizardImportStep();
    attachWizardImportListeners();
  }
}

// Render wizard import step
function renderWizardImportStep() {
  // Show method choice screen if not yet selected (only in onboarding wizard, not standalone)
  if (wizardImportState.showMethodChoice && !standaloneImportMode) {
    return renderWizardImportMethodChoice();
  }

  const importStep = wizardImportState.currentImportStep;

  return `
    <div class="wizard-step-header">
      <h1><i class="fas fa-file-excel"></i> Importer kunder</h1>
      <p>Last opp en Excel- eller CSV-fil med dine eksisterende kunder.</p>
    </div>

    <!-- Import sub-steps indicator -->
    <div class="wizard-import-steps">
      <div class="import-step-indicator ${importStep >= 1 ? 'active' : ''}" data-step="1">
        <span class="step-number">1</span>
        <span class="step-label">Last opp</span>
      </div>
      <div class="import-step-connector ${importStep >= 2 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 2 ? 'active' : ''}" data-step="2">
        <span class="step-number">2</span>
        <span class="step-label">Datarensing</span>
      </div>
      <div class="import-step-connector ${importStep >= 3 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 3 ? 'active' : ''}" data-step="3">
        <span class="step-number">3</span>
        <span class="step-label">Mapping</span>
      </div>
      <div class="import-step-connector ${importStep >= 4 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 4 ? 'active' : ''}" data-step="4">
        <span class="step-number">4</span>
        <span class="step-label">Forhåndsvis</span>
      </div>
      <div class="import-step-connector ${importStep >= 5 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 5 ? 'active' : ''}" data-step="5">
        <span class="step-number">5</span>
        <span class="step-label">Resultat</span>
      </div>
    </div>

    <!-- Dynamic content based on sub-step -->
    <div class="wizard-import-content" id="wizardImportContent">
      ${renderWizardImportSubStep(importStep)}
    </div>
  `;
}

// Render loading state with phase-specific messages and AI animation
function renderWizardLoadingState() {
  const phase = wizardImportState.loadingPhase;
  const progress = wizardImportState.loadingProgress;

  const phases = {
    'uploading': { icon: 'fa-cloud-upload-alt', message: 'Laster opp fil...', isAI: false },
    'parsing': { icon: 'fa-file-excel', message: 'Leser kolonner og rader...', isAI: false },
    'ai-mapping': { icon: 'fa-robot', message: 'AI analyserer kolonner...', isAI: true },
    'cleaning': { icon: 'fa-broom', message: 'Renser data...', isAI: false },
    'mapping': { icon: 'fa-columns', message: 'Kobler kolonner til felt...', isAI: false },
    'validating': { icon: 'fa-check-circle', message: 'Validerer data...', isAI: false },
    'importing': { icon: 'fa-database', message: `Importerer kunder...`, isAI: false, showProgress: true }
  };

  const current = phases[phase] || { icon: 'fa-spinner', message: 'Behandler...', isAI: false };

  return `
    <div class="wizard-import-loading ${current.isAI ? 'ai-active' : ''}">
      <div class="wizard-loading-icon ${current.isAI ? 'ai-pulse' : 'spinning'}">
        <i class="fas ${current.icon}"></i>
      </div>
      <p class="wizard-loading-message">${current.message}</p>
      ${current.isAI ? `
        <div class="wizard-ai-thinking">
          <span class="ai-dot"></span>
          <span class="ai-dot"></span>
          <span class="ai-dot"></span>
        </div>
        <p class="wizard-ai-hint">AI forstår kolonnenavn som "Hvem ringer vi?" → kontaktperson</p>
      ` : ''}
      ${current.showProgress ? `
        <div class="wizard-progress-container">
          <div class="wizard-progress-bar">
            <div class="wizard-progress-fill" style="width: ${progress}%"></div>
          </div>
          <p class="wizard-progress-text">${wizardImportState.importedSoFar} av ${wizardImportState.totalToImport} kunder</p>
        </div>
      ` : ''}
    </div>
  `;
}

// Render sub-step content
function renderWizardImportSubStep(step) {
  if (wizardImportState.isLoading) {
    return renderWizardLoadingState();
  }

  if (wizardImportState.error) {
    return `
      <div class="wizard-import-error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>${escapeHtml(wizardImportState.error)}</p>
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardImportRetry()">
          <i class="fas fa-redo"></i> Prøv igjen
        </button>
      </div>
    `;
  }

  switch (step) {
    case 1:
      return renderWizardImportUpload();
    case 2:
      return renderWizardImportCleaning();
    case 3:
      return renderWizardImportMapping();
    case 4:
      return renderWizardImportPreview();
    case 5:
      return renderWizardImportResults();
    default:
      return renderWizardImportUpload();
  }
}

// Sub-step 2: Data cleaning preview
function renderWizardImportCleaning() {
  const report = wizardImportState.cleaningReport;
  const totalChanges = report ? (report.totalCellsCleaned + report.totalRowsRemoved) : 0;
  const data = wizardImportState.previewData;
  const totalRows = data ? data.totalRows : 0;

  // No issues found
  if (!report || totalChanges === 0) {
    return `
      <div class="wizard-cleaning-container">
        <div class="wizard-cleaning-summary wizard-cleaning-clean">
          <i class="fas fa-check-circle"></i>
          <div>
            <strong>Ingen problemer funnet</strong>
            <p>Filen ser bra ut! ${totalRows} rader klare for import.</p>
          </div>
        </div>
        <div class="wizard-import-actions">
          <button class="wizard-btn wizard-btn-secondary" onclick="wizardCleaningBack()">
            <i class="fas fa-arrow-left"></i> Tilbake
          </button>
          <button class="wizard-btn wizard-btn-primary" onclick="wizardCleaningApprove()">
            Gå videre <i class="fas fa-arrow-right"></i>
          </button>
        </div>
      </div>
    `;
  }

  // Get active changes based on enabled rules
  const enabledRules = wizardImportState.enabledCleaningRules;
  const activeCellChanges = report.cellChanges.filter(c => enabledRules[c.ruleId]);
  const activeRowRemovals = report.rowRemovals.filter(r => enabledRules[r.ruleId]);
  const activeTotal = activeCellChanges.length + activeRowRemovals.length;

  // Diff table - show max 50 cell changes
  const maxDiffRows = 50;
  const visibleChanges = activeCellChanges.slice(0, maxDiffRows);
  const hasMoreChanges = activeCellChanges.length > maxDiffRows;

  return `
    <div class="wizard-cleaning-container">
      <!-- Summary banner -->
      <div class="wizard-cleaning-summary">
        <i class="fas fa-broom"></i>
        <div>
          <strong>${activeTotal} ${activeTotal === 1 ? 'endring' : 'endringer'} funnet i ${totalRows} rader</strong>
          <p>${activeCellChanges.length} ${activeCellChanges.length === 1 ? 'celle' : 'celler'} renset, ${activeRowRemovals.length} ${activeRowRemovals.length === 1 ? 'rad' : 'rader'} foreslått fjernet.</p>
        </div>
      </div>

      <!-- Rule toggles -->
      <div class="wizard-cleaning-rules">
        <h3>Renseregler</h3>
        <div class="wizard-cleaning-rules-list">
          ${report.rules.filter(r => r.affectedCount > 0).map(rule => `
            <label class="wizard-cleaning-rule-toggle">
              <input type="checkbox" ${enabledRules[rule.ruleId] ? 'checked' : ''}
                onchange="wizardToggleCleaningRule('${rule.ruleId}', this.checked)">
              <span class="wizard-cleaning-rule-info">
                <span class="wizard-cleaning-rule-name">${escapeHtml(rule.name)}</span>
                <span class="wizard-cleaning-rule-desc">${escapeHtml(rule.description)}</span>
              </span>
              <span class="wizard-cleaning-rule-count">${rule.affectedCount} ${rule.category === 'rows' ? (rule.affectedCount === 1 ? 'rad' : 'rader') : (rule.affectedCount === 1 ? 'celle' : 'celler')}</span>
            </label>
          `).join('')}
        </div>
      </div>

      ${visibleChanges.length > 0 ? `
      <!-- Diff table -->
      <div class="wizard-cleaning-diff-section">
        <h3>Endringsoversikt</h3>
        <div class="wizard-cleaning-diff-table-wrapper">
          <table class="wizard-cleaning-diff-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Kolonne</th>
                <th>Rad</th>
                <th>Opprinnelig</th>
                <th>Renset</th>
              </tr>
            </thead>
            <tbody>
              ${visibleChanges.map((change, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(change.column)}</td>
                  <td>${change.rowIndex + 2}</td>
                  <td class="cell-original">${formatCleaningValue(change.originalValue)}</td>
                  <td class="cell-cleaned">${formatCleaningValue(change.cleanedValue)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${hasMoreChanges ? `
          <p class="wizard-cleaning-more">Viser ${maxDiffRows} av ${activeCellChanges.length} endringer</p>
        ` : ''}
      </div>
      ` : ''}

      ${renderCleaningFullTable()}

      ${activeRowRemovals.length > 0 ? `
      <!-- Removed rows -->
      <details class="wizard-cleaning-removed">
        <summary>${activeRowRemovals.length} ${activeRowRemovals.length === 1 ? 'rad' : 'rader'} fjernet</summary>
        <div class="wizard-cleaning-removed-list">
          ${activeRowRemovals.map(removal => `
            <div class="wizard-cleaning-removed-item">
              <span class="removal-row">Rad ${removal.rowIndex + 2}</span>
              <span class="removal-reason">${escapeHtml(removal.reason)}</span>
            </div>
          `).join('')}
        </div>
      </details>
      ` : ''}

      <!-- Actions -->
      <div class="wizard-import-actions">
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardCleaningBack()">
          <i class="fas fa-arrow-left"></i> Tilbake
        </button>
        <button class="wizard-btn wizard-btn-ghost" onclick="wizardCleaningSkip()">
          Hopp over rensing
        </button>
        <button class="wizard-btn wizard-btn-primary" onclick="wizardCleaningApprove()">
          <i class="fas fa-check"></i> Godkjenn rensing <i class="fas fa-arrow-right"></i>
        </button>
      </div>
    </div>
  `;
}

// Format a value for display in the diff table
function formatCleaningValue(val) {
  if (val === null || val === undefined) return '<span class="cleaning-null">(tom)</span>';
  const str = String(val);
  if (str === '') return '<span class="cleaning-null">(tom)</span>';
  // Show whitespace visually
  const visual = str.replace(/ /g, '\u00B7').replace(/\t/g, '\u2192');
  return escapeHtml(visual);
}

// Toggle a cleaning rule on/off
function wizardToggleCleaningRule(ruleId, enabled) {
  wizardImportState.enabledCleaningRules[ruleId] = enabled;
  updateWizardImportContent();
}

// Pagination for cleaning full table
function wizardCleaningTablePage(page) {
  wizardImportState.cleaningTablePage = Math.max(0, page);
  updateWizardImportContent();
}
window.wizardCleaningTablePage = wizardCleaningTablePage;

// Render full data table for cleaning step
function renderCleaningFullTable() {
  const originalRows = wizardImportState.originalPreview;
  const headers = wizardImportState.previewData?.headers || [];
  const report = wizardImportState.cleaningReport;
  const enabledRules = wizardImportState.enabledCleaningRules;

  if (!originalRows || originalRows.length === 0 || headers.length === 0) return '';

  // Build change map: "rowIndex|column" -> { originalValue, cleanedValue }
  const changeMap = new Map();
  if (report) {
    for (const change of report.cellChanges) {
      if (!enabledRules[change.ruleId]) continue;
      changeMap.set(`${change.rowIndex}|${change.column}`, change);
    }
  }

  // Build removed indices set
  const removedIndices = new Set();
  if (report) {
    for (const removal of report.rowRemovals) {
      if (enabledRules[removal.ruleId]) {
        removedIndices.add(removal.rowIndex);
      }
    }
  }

  // Pagination
  const pageSize = 50;
  const currentPage = wizardImportState.cleaningTablePage || 0;
  const totalPages = Math.ceil(originalRows.length / pageSize);
  const validPage = Math.min(currentPage, totalPages - 1);
  const startIdx = validPage * pageSize;
  const pageRows = originalRows.slice(startIdx, startIdx + pageSize);

  // Show max 8 columns, scrollable
  const maxCols = 8;
  const displayHeaders = headers.slice(0, maxCols);
  const hasMoreColumns = headers.length > maxCols;

  return `
    <div class="wizard-cleaning-fulltable-section">
      <h3><i class="fas fa-table"></i> Fullstendig dataoversikt</h3>
      <p class="wizard-section-desc">${originalRows.length} rader totalt. Endrede celler er markert. Fjernede rader er gjennomstreket.</p>
      <div class="wizard-cleaning-fulltable-wrapper">
        <table class="wizard-cleaning-fulltable">
          <thead>
            <tr>
              <th>#</th>
              ${displayHeaders.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
              ${hasMoreColumns ? '<th>...</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((row, i) => {
              const globalIdx = row._rowIndex !== undefined ? row._rowIndex : (startIdx + i);
              const isRemoved = removedIndices.has(globalIdx);
              return `
                <tr class="${isRemoved ? 'row-removed' : ''}">
                  <td>${globalIdx + 2}</td>
                  ${displayHeaders.map(col => {
                    const change = changeMap.get(`${globalIdx}|${col}`);
                    const value = isRemoved
                      ? String(row[col] ?? '')
                      : (change ? String(change.cleanedValue ?? '') : String(row[col] ?? ''));
                    const cellClass = change && !isRemoved ? 'cell-was-cleaned' : '';
                    const title = change && !isRemoved
                      ? `Opprinnelig: ${String(change.originalValue ?? '(tom)')}`
                      : (isRemoved ? 'Denne raden fjernes' : '');
                    return `<td class="${cellClass}" ${title ? `title="${escapeHtml(title)}"` : ''}>${escapeHtml(value || '-')}</td>`;
                  }).join('')}
                  ${hasMoreColumns ? '<td>...</td>' : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${totalPages > 1 ? `
        <div class="wizard-cleaning-pagination">
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardCleaningTablePage(${validPage - 1})" ${validPage === 0 ? 'disabled' : ''}>
            <i class="fas fa-chevron-left"></i> Forrige
          </button>
          <span>Side ${validPage + 1} av ${totalPages}</span>
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardCleaningTablePage(${validPage + 1})" ${validPage >= totalPages - 1 ? 'disabled' : ''}>
            Neste <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

// Go back from cleaning step to upload
function wizardCleaningBack() {
  wizardImportState.currentImportStep = 1;
  updateWizardImportContent();
}

// Skip cleaning and proceed with original data
function wizardCleaningSkip() {
  wizardImportState.useCleanedData = false;
  wizardImportState.currentImportStep = 3;
  updateWizardImportContent();
}

// Approve cleaning and proceed to mapping
function wizardCleaningApprove() {
  wizardImportState.useCleanedData = true;

  // Apply enabled rules to compute effective cleaned data
  const effectiveData = getEffectiveCleanedData();
  if (effectiveData) {
    wizardImportState.previewData = {
      ...wizardImportState.previewData,
      preview: effectiveData,
      totalRows: effectiveData.length,
    };
  }

  wizardImportState.currentImportStep = 3;
  updateWizardImportContent();
}

// Compute effective cleaned data based on enabled rules
function getEffectiveCleanedData() {
  const report = wizardImportState.cleaningReport;
  const originalRows = wizardImportState.originalPreview;
  if (!report || !originalRows) return null;

  const enabledRules = wizardImportState.enabledCleaningRules;

  // Start with deep copy of original rows
  let rows = originalRows.map(row => ({ ...row }));

  // Apply enabled row removals (collect indices to remove)
  const removedIndices = new Set();
  for (const removal of report.rowRemovals) {
    if (enabledRules[removal.ruleId]) {
      removedIndices.add(removal.rowIndex);
    }
  }
  rows = rows.filter((row, i) => !removedIndices.has(row._rowIndex !== undefined ? row._rowIndex : i));

  // Build a map of cell changes by (rowIndex, column) for enabled rules
  const changeMap = new Map();
  for (const change of report.cellChanges) {
    if (!enabledRules[change.ruleId]) continue;
    if (removedIndices.has(change.rowIndex)) continue; // Row was removed
    const key = `${change.rowIndex}|${change.column}`;
    // Later rules overwrite earlier ones (they are applied in order)
    changeMap.set(key, change.cleanedValue);
  }

  // Apply cell changes
  for (const row of rows) {
    const rowIdx = row._rowIndex !== undefined ? row._rowIndex : -1;
    for (const [key, cleanedValue] of changeMap) {
      const [changeRowIdx, column] = key.split('|');
      if (Number(changeRowIdx) === rowIdx) {
        row[column] = cleanedValue;
      }
    }
  }

  // Re-index rows
  return rows.map((row, i) => ({ ...row, _rowIndex: i }));
}

// Sub-step 1: File upload
function renderWizardImportUpload() {
  // Get industry name from appConfig if available
  const industryName = appConfig?.industry?.name || 'din bransje';

  return `
    <div class="wizard-import-upload">
      <!-- AI Feature Banner -->
      <div class="wizard-ai-feature-banner">
        <div class="ai-feature-icon">
          <i class="fas fa-robot"></i>
        </div>
        <div class="ai-feature-content">
          <h4><i class="fas fa-magic"></i> AI-assistert import</h4>
          <p>Vår AI forstår <strong>${escapeHtml(industryName)}</strong> og mapper automatisk kolonner til riktige felt - selv med kreative kolonnenavn!</p>
        </div>
      </div>

      <div class="wizard-import-dropzone" id="wizardImportDropzone">
        <i class="fas fa-cloud-upload-alt"></i>
        <p><strong>Dra og slipp fil her</strong></p>
        <p>eller klikk for å velge</p>
        <span class="import-formats">Støttede formater: .xlsx, .xls, .csv (maks 10MB)</span>
        <input type="file" id="wizardImportFileInput" accept=".xlsx,.xls,.csv" hidden>
      </div>

      <div class="wizard-import-tips">
        <h4><i class="fas fa-lightbulb"></i> Tips for import</h4>
        <ul>
          <li>Filen bør ha én rad per kunde</li>
          <li>Første rad bør inneholde kolonneoverskrifter</li>
          <li>Påkrevde felt: Navn og adresse</li>
          <li>AI gjenkjenner bransje-spesifikke felt automatisk</li>
        </ul>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="prevWizardStep()">
        <i class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-skip" onclick="skipWizardImport()">
        Hopp over <i class="fas fa-forward"></i>
      </button>
    </div>
  `;
}

// Render AI questions for ambiguous column mappings
function renderAIQuestions() {
  const questions = wizardImportState.aiQuestions || [];

  if (questions.length === 0) {
    return '';
  }

  return `
    <div class="wizard-ai-questions">
      <div class="wizard-ai-questions-header">
        <i class="fas fa-question-circle"></i>
        <span>AI trenger din hjelp med ${questions.length} ${questions.length === 1 ? 'kolonne' : 'kolonner'}</span>
        <button class="wizard-btn-link" onclick="skipAIQuestions()">Bruk AI-anbefalinger</button>
      </div>
      <div class="wizard-ai-questions-list">
        ${questions.map((q, index) => `
          <div class="wizard-ai-question-card" data-question-index="${index}">
            <div class="question-header">
              <span class="question-column">"${escapeHtml(q.header)}"</span>
              <span class="question-confidence">${Math.round((q.confidence || 0) * 100)}% sikker</span>
            </div>
            <p class="question-text">Hva inneholder denne kolonnen?</p>
            <div class="question-options">
              <label class="question-option ${wizardImportState.questionAnswers[q.header] === q.targetField ? 'selected' : ''}">
                <input type="radio" name="q_${index}" value="${q.targetField || ''}"
                  ${wizardImportState.questionAnswers[q.header] === q.targetField || (!wizardImportState.questionAnswers[q.header] && q.targetField) ? 'checked' : ''}
                  onchange="handleAIQuestionAnswer('${escapeHtml(q.header)}', '${q.targetField || ''}')">
                <span>${escapeHtml(q.targetField || 'Egendefinert felt')} <span class="recommended">(Anbefalt av AI)</span></span>
              </label>
              <label class="question-option ${wizardImportState.questionAnswers[q.header] === '_custom' ? 'selected' : ''}">
                <input type="radio" name="q_${index}" value="_custom"
                  ${wizardImportState.questionAnswers[q.header] === '_custom' ? 'checked' : ''}
                  onchange="handleAIQuestionAnswer('${escapeHtml(q.header)}', '_custom')">
                <span>Behold som egendefinert felt</span>
              </label>
              <label class="question-option ${wizardImportState.questionAnswers[q.header] === '_skip' ? 'selected' : ''}">
                <input type="radio" name="q_${index}" value="_skip"
                  ${wizardImportState.questionAnswers[q.header] === '_skip' ? 'checked' : ''}
                  onchange="handleAIQuestionAnswer('${escapeHtml(q.header)}', '_skip')">
                <span>Ignorer denne kolonnen</span>
              </label>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Handle AI question answer
function handleAIQuestionAnswer(header, value) {
  wizardImportState.questionAnswers[header] = value;
  updateWizardImportContent();
}

// Skip AI questions and use recommendations
function skipAIQuestions() {
  // Clear questions to hide the section
  wizardImportState.aiQuestions = [];
  updateWizardImportContent();
}

// Update required field mapping (navn or adresse)
function updateRequiredMapping(field, column) {
  wizardImportState.requiredMappings[field] = column;
  updateWizardImportContent();
}

// Check if required fields are mapped (and different)
function areRequiredFieldsMapped() {
  const { navn, adresse } = wizardImportState.requiredMappings;
  // Both must be selected
  if (!navn || !adresse) return false;
  // They must be different columns
  if (navn === adresse) return false;
  return true;
}

// Check if same column is selected for both required fields
function isSameColumnSelected() {
  const { navn, adresse } = wizardImportState.requiredMappings;
  return navn && adresse && navn === adresse;
}

// Render REQUIRED field selectors - user MUST confirm these before import
function renderRequiredFieldSelectors(data) {
  const allColumns = data.allColumns || data.headers || [];
  const currentMappings = wizardImportState.requiredMappings;

  if (allColumns.length === 0) {
    return '';
  }

  const bothMapped = currentMappings.navn && currentMappings.adresse &&
    currentMappings.navn !== '-- Velg kolonne --' && currentMappings.adresse !== '-- Velg kolonne --';

  return `
    <div class="wizard-required-fields ${bothMapped ? 'wizard-fields-ok' : ''}">
      ${bothMapped ? `
        <div class="wizard-required-header wizard-header-success">
          <i class="fas fa-check-circle"></i>
          <span>Kolonner gjenkjent automatisk</span>
        </div>
        <p class="wizard-required-desc">Endre hvis noe er feil.</p>
      ` : `
        <div class="wizard-required-header">
          <i class="fas fa-columns"></i>
          <span>Velg kolonner</span>
        </div>
        <p class="wizard-required-desc">Velg hvilken kolonne som er kundenavn og adresse.</p>
      `}

      <div class="wizard-required-grid">
        <div class="wizard-required-row">
          <label>
            <i class="fas fa-user"></i>
            Kundenavn
          </label>
          <select id="navnColumnSelect" onchange="updateRequiredMapping('navn', this.value)" class="wizard-required-select">
            <option value="">-- Velg kolonne --</option>
            ${allColumns.map(col => `
              <option value="${escapeHtml(col)}" ${currentMappings.navn === col ? 'selected' : ''}>
                ${escapeHtml(col)}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="wizard-required-row">
          <label>
            <i class="fas fa-map-marker-alt"></i>
            Adresse
          </label>
          <select id="adresseColumnSelect" onchange="updateRequiredMapping('adresse', this.value)" class="wizard-required-select">
            <option value="">-- Velg kolonne --</option>
            ${allColumns.map(col => `
              <option value="${escapeHtml(col)}" ${currentMappings.adresse === col ? 'selected' : ''}>
                ${escapeHtml(col)}
              </option>
            `).join('')}
          </select>
        </div>
      </div>

      ${isSameColumnSelected() ? `
        <div class="wizard-required-warning wizard-required-error">
          <i class="fas fa-times-circle"></i>
          <span>Kundenavn og adresse kan ikke bruke samme kolonne.</span>
        </div>
      ` : ''}
    </div>
  `;
}

// Sub-step 2: FULLAUTOMATISK forhåndsvisning
function renderWizardImportMapping() {
  const data = wizardImportState.previewData;
  if (!data) {
    return renderWizardImportUpload();
  }

  const stats = data.stats || {};
  const recognizedColumns = data.recognizedColumns || [];
  const newFields = data.newFields || [];
  const preview = data.preview || [];

  // Count AI-mapped columns
  const aiMappedCount = recognizedColumns.filter(c => c.source === 'ai').length;
  const deterministicCount = recognizedColumns.filter(c => c.source === 'deterministic').length;

  return `
    <div class="wizard-auto-preview">
      <!-- Summary header -->
      <div class="wizard-auto-summary">
        <div class="wizard-auto-success">
          <i class="fas fa-check-circle"></i>
          <span>Fant <strong>${data.totalRows || 0}</strong> kunder i filen</span>
        </div>

        <div class="wizard-auto-stats">
          <div class="wizard-auto-stat">
            <i class="fas fa-columns"></i>
            <span>${data.totalColumns || 0} kolonner totalt</span>
          </div>
          <div class="wizard-auto-stat wizard-auto-stat-success">
            <i class="fas fa-check"></i>
            <span>${recognizedColumns.length} gjenkjent</span>
          </div>
          ${newFields.length > 0 ? `
            <div class="wizard-auto-stat wizard-auto-stat-new">
              <i class="fas fa-plus"></i>
              <span>${newFields.length} nye felt</span>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Mapping Status indicator -->
      <div class="wizard-ai-status wizard-ai-enabled">
        <i class="fas fa-magic"></i>
        <span>
          <strong>Automatisk kolonnemap</strong>
          ${aiMappedCount > 0 ? `- ${aiMappedCount} kolonner gjenkjent` : '- Velg kolonner manuelt nedenfor'}
        </span>
      </div>

      <!-- REQUIRED: Column selection for name and address -->
      ${renderRequiredFieldSelectors(data)}

      <!-- AI Questions for ambiguous mappings -->
      ${renderAIQuestions()}

      <!-- Recognized columns -->
      ${recognizedColumns.length > 0 ? `
        <div class="wizard-auto-section">
          <h4><i class="fas fa-check-circle"></i> Gjenkjente kolonner</h4>
          <div class="wizard-auto-columns">
            ${recognizedColumns.map(col => `
              <div class="wizard-auto-column recognized ${col.source === 'ai' ? 'ai-mapped' : ''}">
                <span class="column-from">${escapeHtml(col.header)}</span>
                <i class="fas fa-arrow-right"></i>
                <span class="column-to">${escapeHtml(col.mappedTo)}</span>
                ${col.source === 'ai' ? `
                  <span class="mapping-source ai" title="Mappet av AI med ${Math.round((col.confidence || 0) * 100)}% sikkerhet">
                    <i class="fas fa-robot"></i>
                  </span>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- New fields that will be created -->
      ${newFields.length > 0 ? `
        <div class="wizard-auto-section">
          <h4><i class="fas fa-plus-circle"></i> Nye felt som opprettes automatisk</h4>
          <div class="wizard-auto-columns">
            ${newFields.map(f => `
              <div class="wizard-auto-column new-field">
                <span class="column-from">"${escapeHtml(f.header)}"</span>
                <i class="fas fa-arrow-right"></i>
                <span class="column-to">
                  ${escapeHtml(f.displayName)}
                  <span class="field-type">(${escapeHtml(f.typeDisplay)}${f.optionsCount > 0 ? `, ${f.optionsCount} valg` : ''})</span>
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Preview table -->
      ${preview.length > 0 ? `
        <div class="wizard-auto-section">
          <h4><i class="fas fa-table"></i> Forhåndsvisning</h4>
          <div class="wizard-auto-table-wrapper">
            <table class="wizard-auto-table">
              <thead>
                <tr>
                  ${Object.keys(preview[0] || {}).slice(0, 6).map(key => `
                    <th>${escapeHtml(key)}</th>
                  `).join('')}
                  ${Object.keys(preview[0] || {}).length > 6 ? '<th>...</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${preview.slice(0, 3).map(row => `
                  <tr>
                    ${Object.values(row).slice(0, 6).map(val => `
                      <td>${escapeHtml(String(val || '-'))}</td>
                    `).join('')}
                    ${Object.keys(row).length > 6 ? '<td>...</td>' : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- Validation info -->
      ${stats.invalid > 0 ? `
        <div class="wizard-auto-warning">
          <i class="fas fa-exclamation-triangle"></i>
          <span>${stats.invalid} rader mangler påkrevd data og vil bli hoppet over</span>
        </div>
      ` : ''}
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="wizardImportBack()">
        <i class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-primary"
        onclick="wizardImportNext()"
        ${!areRequiredFieldsMapped() ? 'disabled title="Velg kolonner for kundenavn og adresse først"' : ''}>
        Forhåndsvis <i class="fas fa-arrow-right"></i>
      </button>
    </div>
  `;
}

/**
 * Render section for unmapped columns (columns in Excel that aren't mapped to standard fields)
 */
function renderUnmappedColumnsSection(data, headers, mapping, targetFields) {
  const unmappedColumns = data.unmappedColumns || [];

  // If no unmapped columns, return empty
  if (unmappedColumns.length === 0) {
    return '';
  }

  // Get list of mapped column indices
  const mappedIndices = new Set(Object.values(mapping).filter(v => v !== undefined && v !== ''));

  // Filter to only show columns that are truly unmapped
  const visibleUnmapped = unmappedColumns.filter(col => {
    const index = headers.indexOf(col.header);
    return !mappedIndices.has(index);
  });

  if (visibleUnmapped.length === 0) {
    return '';
  }

  // Initialize customFieldMapping if not exists
  if (!wizardImportState.customFieldMapping) {
    wizardImportState.customFieldMapping = {};
  }

  return `
    <div class="wizard-unmapped-section">
      <h4 class="wizard-section-title">
        <i class="fas fa-plus-circle"></i>
        Ekstra kolonner i filen (${visibleUnmapped.length})
      </h4>
      <p class="wizard-section-desc">
        Disse kolonnene finnes ikke i standardfeltene. Velg hva du vil gjøre med dem:
      </p>

      <div class="wizard-unmapped-grid">
        ${visibleUnmapped.map(col => {
          const currentAction = wizardImportState.customFieldMapping[col.header] || 'ignore';
          return `
            <div class="wizard-unmapped-row">
              <div class="wizard-unmapped-info">
                <span class="wizard-unmapped-header">${escapeHtml(col.header)}</span>
                <span class="wizard-unmapped-sample">Eksempel: ${escapeHtml(col.sampleValue || '-')}</span>
              </div>
              <div class="wizard-unmapped-action">
                <select onchange="handleUnmappedColumn('${escapeHtml(col.header)}', this.value)">
                  <option value="ignore" ${currentAction === 'ignore' ? 'selected' : ''}>
                    Ignorer
                  </option>
                  <option value="create" ${currentAction === 'create' ? 'selected' : ''}>
                    Opprett felt "${escapeHtml(col.suggestedDisplayName || col.header)}"
                  </option>
                  ${targetFields.map(f => `
                    <option value="map:${f.key}" ${currentAction === 'map:' + f.key ? 'selected' : ''}>
                      Mapp til ${escapeHtml(f.label)}
                    </option>
                  `).join('')}
                </select>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/**
 * Handle user choice for unmapped column
 */
function handleUnmappedColumn(header, action) {
  if (!wizardImportState.customFieldMapping) {
    wizardImportState.customFieldMapping = {};
  }

  if (action === 'ignore') {
    delete wizardImportState.customFieldMapping[header];
  } else if (action === 'create') {
    wizardImportState.customFieldMapping[header] = 'create';
  } else if (action.startsWith('map:')) {
    const targetField = action.substring(4);
    // Map this column to the target field
    const headers = wizardImportState.previewData?.headers || [];
    const index = headers.indexOf(header);
    if (index !== -1) {
      wizardImportState.columnMapping[targetField] = index;
    }
    delete wizardImportState.customFieldMapping[header];
  }

  updateWizardImportContent();
}

// Expose to window
window.handleUnmappedColumn = handleUnmappedColumn;

// Sub-step 3: Preview with category mapping
function renderWizardImportPreview() {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) {
    return renderWizardImportMapping();
  }

  const preview = data.preview;
  const stats = data.stats || {};
  const categoryMatches = data.categoryMatches || [];
  const reimportPreview = data.reimportPreview || {};
  const features = data.features || {};
  const validCategories = wizardImportState.validCategories || [];

  // Build category mapping UI if there are unmatched categories
  let categoryMappingHtml = '';
  if (categoryMatches.length > 0) {
    categoryMappingHtml = `
      <div class="wizard-category-mapping">
        <h4><i class="fas fa-tags"></i> Kategori-mapping</h4>
        <p>Følgende kategorier ble funnet i filen. Koble dem til eksisterende kategorier eller opprett nye.</p>
        <div class="wizard-category-list">
          ${categoryMatches.map(match => `
            <div class="wizard-category-row">
              <div class="wizard-category-original">
                <span class="category-label">Fra fil:</span>
                <span class="category-value">${escapeHtml(match.original)}</span>
                <span class="category-count">(${match.count} kunder)</span>
              </div>
              <div class="wizard-category-arrow"><i class="fas fa-arrow-right"></i></div>
              <div class="wizard-category-select">
                <select data-original="${escapeHtml(match.original)}" onchange="updateWizardCategoryMapping('${escapeHtml(match.original)}', this.value)">
                  ${match.suggested ? `
                    <option value="${escapeHtml(match.suggested.id)}" selected>
                      ${escapeHtml(match.suggested.name)} (anbefalt)
                    </option>
                  ` : '<option value="">-- Velg kategori --</option>'}
                  ${validCategories.filter(c => !match.suggested || c.id !== match.suggested.id).map(cat => `
                    <option value="${escapeHtml(cat.id)}">${escapeHtml(cat.name)}</option>
                  `).join('')}
                  <option value="__skip__">Hopp over (ingen kategori)</option>
                  <option value="__new__">Opprett ny kategori</option>
                </select>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Determine display columns dynamically from mapped data
  const sampleRow = preview[0] || {};
  const allMappedFields = Object.keys(sampleRow).filter(k =>
    !k.startsWith('_') && k !== 'hasError' && k !== 'hasWarning' &&
    k !== 'errorMessage' && k !== 'validationErrors' && k !== 'fieldErrors'
  );
  const standardFields = ['navn', 'adresse', 'postnummer', 'poststed', 'epost', 'telefon', 'kontaktperson', 'kategori', 'siste_kontroll', 'neste_kontroll'];
  const displayColumns = [
    ...standardFields.filter(f => allMappedFields.includes(f)),
    ...allMappedFields.filter(f => !standardFields.includes(f))
  ];

  // Paginated preview
  const previewPageSize = 50;
  const previewPage = wizardImportState.previewTablePage || 0;
  const previewTotalPages = Math.ceil(preview.length / previewPageSize);
  const validPreviewPage = Math.min(previewPage, Math.max(0, previewTotalPages - 1));
  const previewRows = preview.slice(validPreviewPage * previewPageSize, (validPreviewPage + 1) * previewPageSize);

  // Before/after toggle state
  const showBeforeAfter = wizardImportState.previewShowBeforeAfter;
  const fieldToHeader = wizardImportState.fieldToHeaderMapping || {};

  return `
    <div class="wizard-import-preview">
      <!-- Stats summary -->
      <div class="wizard-preview-stats">
        <div class="stat-item">
          <i class="fas fa-file-alt"></i>
          <span class="stat-value">${stats.totalRows || 0}</span>
          <span class="stat-label">Totalt rader</span>
        </div>
        <div class="stat-item ${stats.validRows > 0 ? 'success' : ''}">
          <i class="fas fa-check-circle"></i>
          <span class="stat-value">${stats.validRows || 0}</span>
          <span class="stat-label">Gyldige</span>
        </div>
        <div class="stat-item ${stats.warnings > 0 ? 'warning' : ''}">
          <i class="fas fa-exclamation-triangle"></i>
          <span class="stat-value">${stats.warnings || 0}</span>
          <span class="stat-label">Advarsler</span>
        </div>
        <div class="stat-item ${stats.errors > 0 ? 'error' : ''}">
          <i class="fas fa-times-circle"></i>
          <span class="stat-value">${stats.errors || 0}</span>
          <span class="stat-label">Feil</span>
        </div>
        <div class="stat-item ${stats.duplicates > 0 ? 'warning' : ''}">
          <i class="fas fa-copy"></i>
          <span class="stat-value">${stats.duplicates || 0}</span>
          <span class="stat-label">Duplikater</span>
        </div>
      </div>

      ${features.updateEnabled || features.deletionDetectionEnabled ? `
        <!-- Re-import Preview Summary -->
        <div class="wizard-reimport-summary">
          <h4><i class="fas fa-sync-alt"></i> Oppsummering av import</h4>
          <div class="wizard-reimport-stats">
            <div class="reimport-stat-item new">
              <i class="fas fa-plus-circle"></i>
              <span class="stat-value">${reimportPreview.toCreate || 0}</span>
              <span class="stat-label">Nye kunder</span>
            </div>
            ${features.updateEnabled ? `
              <div class="reimport-stat-item update">
                <i class="fas fa-edit"></i>
                <span class="stat-value">${reimportPreview.toUpdate || 0}</span>
                <span class="stat-label">Oppdateres</span>
              </div>
              <div class="reimport-stat-item unchanged">
                <i class="fas fa-equals"></i>
                <span class="stat-value">${reimportPreview.unchanged || 0}</span>
                <span class="stat-label">Uendret</span>
              </div>
            ` : ''}
          </div>
          ${features.deletionDetectionEnabled && reimportPreview.notInImport && reimportPreview.notInImport.length > 0 ? `
            <div class="wizard-not-in-import-info">
              <i class="fas fa-info-circle"></i>
              <div>
                <strong>${reimportPreview.notInImport.length} eksisterende kunder finnes ikke i importfilen</strong>
                <p>Disse kundene vil <strong>IKKE</strong> bli slettet. De vises kun for informasjon.</p>
                <details>
                  <summary>Vis kunder</summary>
                  <ul class="not-in-import-list">
                    ${reimportPreview.notInImport.slice(0, 10).map(k => `
                      <li>${escapeHtml(k.navn)} - ${escapeHtml(k.adresse)}</li>
                    `).join('')}
                    ${reimportPreview.notInImport.length > 10 ? `<li>...og ${reimportPreview.notInImport.length - 10} flere</li>` : ''}
                  </ul>
                </details>
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${categoryMappingHtml}

      <!-- Preview table with selection -->
      <div class="wizard-preview-table-wrapper">
        <div class="wizard-preview-header">
          <h4><i class="fas fa-table"></i> Forhåndsvisning (${preview.length} rader)</h4>
          <div class="wizard-preview-controls">
            <label class="wizard-toggle-label">
              <input type="checkbox" ${showBeforeAfter ? 'checked' : ''}
                onchange="wizardToggleBeforeAfter(this.checked)">
              <span>Vis transformasjoner</span>
            </label>
            <div class="wizard-selection-actions">
              <button class="wizard-btn wizard-btn-small" onclick="wizardSelectAllRows()">
                <i class="fas fa-check-square"></i> Velg alle
              </button>
              <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDeselectAllRows()">
                <i class="fas fa-square"></i> Velg ingen
              </button>
              <span class="wizard-selection-count" id="wizardSelectionCount">
                ${getSelectedRowCount()} av ${stats.validRows || 0} valgt
              </span>
            </div>
          </div>
        </div>
        <p class="wizard-edit-hint"><i class="fas fa-info-circle"></i> Dobbeltklikk på en celle for å redigere</p>
        <table class="wizard-preview-table wizard-preview-table-editable">
          <thead>
            <tr>
              <th class="col-checkbox">
                <input type="checkbox" id="wizardSelectAllCheckbox" onchange="wizardToggleAllRows(this.checked)" ${areAllRowsSelected(previewRows) ? 'checked' : ''}>
              </th>
              <th class="col-rownum">#</th>
              ${displayColumns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}
              <th class="col-status">Status</th>
            </tr>
          </thead>
          <tbody>
            ${previewRows.map((row, localIdx) => {
              const globalIdx = validPreviewPage * previewPageSize + localIdx;
              const isSelected = wizardImportState.selectedRows.has(globalIdx);
              const rowEdits = wizardImportState.editedRows[globalIdx] || {};
              const rowClass = !isSelected ? 'row-excluded' : (row.hasError ? 'row-error' : (row.hasWarning ? 'row-warning' : 'row-valid'));

              return `
              <tr class="${rowClass}" data-row-index="${globalIdx}">
                <td class="col-checkbox">
                  <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="wizardToggleRow(${globalIdx}, this.checked)">
                </td>
                <td class="col-rownum">${globalIdx + 1}</td>
                ${displayColumns.map(col => {
                  const originalValue = row[col] || '';
                  const editedValue = rowEdits[col];
                  const displayValue = editedValue !== undefined ? editedValue : originalValue;
                  const isEdited = editedValue !== undefined && editedValue !== originalValue;
                  const hasFieldError = row.fieldErrors && row.fieldErrors[col];

                  // Before/after transformation comparison
                  const sourceHeader = fieldToHeader[col];
                  const rawVal = row._rawValues ? String(row._rawValues[sourceHeader] || row._rawValues[col] || '') : '';
                  const mappedVal = row._mappedValues ? String(row._mappedValues[col] || '') : '';
                  const wasTransformed = showBeforeAfter && rawVal && mappedVal && rawVal !== mappedVal;

                  const cellTitle = wasTransformed
                    ? `Fra fil: ${String(rawVal)}`
                    : (hasFieldError ? escapeHtml(hasFieldError) : (isEdited ? 'Redigert (original: ' + escapeHtml(originalValue) + ')' : 'Dobbeltklikk for å redigere'));

                  return `
                  <td class="import-cell-editable ${isEdited ? 'cell-edited' : ''} ${hasFieldError ? 'cell-error' : ''} ${wasTransformed ? 'cell-transformed' : ''}"
                      data-row="${globalIdx}"
                      data-field="${col}"
                      data-original="${escapeHtml(originalValue)}"
                      ondblclick="wizardStartCellEdit(${globalIdx}, '${col}')"
                      title="${escapeHtml(cellTitle)}">
                    ${wasTransformed ? `<span class="cell-before">${escapeHtml(rawVal)}</span> <i class="fas fa-arrow-right cell-arrow"></i> <span class="cell-after">${escapeHtml(mappedVal)}</span>` : escapeHtml(displayValue || '-')}
                  </td>
                `;}).join('')}
                <td class="col-status">
                  ${!isSelected ? '<span class="status-excluded" title="Ikke valgt for import"><i class="fas fa-minus-circle"></i></span>' :
                    row.hasError ? `<span class="status-error" title="${escapeHtml(row.errorMessage || 'Feil')}"><i class="fas fa-times-circle"></i></span>` :
                    row.hasWarning ? `<span class="status-warning" title="${escapeHtml(row.warningMessage || 'Advarsel')}"><i class="fas fa-exclamation-triangle"></i></span>` :
                    '<span class="status-ok"><i class="fas fa-check-circle"></i></span>'}
                </td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
      </div>

      ${previewTotalPages > 1 ? `
        <div class="wizard-preview-pagination">
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardPreviewTablePage(${validPreviewPage - 1})" ${validPreviewPage === 0 ? 'disabled' : ''}>
            <i class="fas fa-chevron-left"></i> Forrige
          </button>
          <span>Side ${validPreviewPage + 1} av ${previewTotalPages}</span>
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardPreviewTablePage(${validPreviewPage + 1})" ${validPreviewPage >= previewTotalPages - 1 ? 'disabled' : ''}>
            Neste <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      ` : ''}

      ${stats.errors > 0 ? `
        <div class="wizard-preview-warning">
          <i class="fas fa-info-circle"></i>
          <p>${stats.errors} rad(er) har feil og vil ikke bli importert. Du kan redigere eller fjerne dem fra utvalget.</p>
        </div>
      ` : ''}

      ${renderErrorGrouping(preview)}

      ${data.qualityReport ? renderQualityReport(data.qualityReport) : ''}
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="wizardImportBack()">
        <i class="fas fa-arrow-left"></i> Tilbake
      </button>
      <div class="wizard-footer-right">
        ${wizardImportState.batchId ? `
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDownloadErrorReport()" title="Last ned feilrapport som CSV">
            <i class="fas fa-download"></i> Feilrapport
          </button>
        ` : ''}
        <button class="wizard-btn wizard-btn-primary" onclick="wizardStartImport()" ${getSelectedValidRowCount() === 0 ? 'disabled' : ''}>
          <i class="fas fa-file-import"></i> Importer ${getSelectedValidRowCount()} kunder
        </button>
      </div>
    </div>
  `;
}

// Sub-step 4: Import results
function renderWizardImportResults() {
  const results = wizardImportState.importResults;
  if (!results) {
    return renderWizardImportPreview();
  }

  const isSuccess = results.success && results.importedCount > 0;

  return `
    <div class="wizard-import-results">
      <div class="wizard-results-icon ${isSuccess ? 'success' : 'partial'}">
        <i class="fas ${isSuccess ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
      </div>

      <h2>${isSuccess ? 'Import fullført!' : 'Import delvis fullført'}</h2>

      <div class="wizard-results-stats">
        ${results.createdCount > 0 ? `
          <div class="result-stat success">
            <i class="fas fa-plus"></i>
            <span class="stat-value">${results.createdCount}</span>
            <span class="stat-label">Nye kunder opprettet</span>
          </div>
        ` : ''}
        ${results.updatedCount > 0 ? `
          <div class="result-stat info">
            <i class="fas fa-sync-alt"></i>
            <span class="stat-value">${results.updatedCount}</span>
            <span class="stat-label">Eksisterende oppdatert</span>
          </div>
        ` : ''}
        ${!results.createdCount && !results.updatedCount ? `
          <div class="result-stat success">
            <i class="fas fa-check"></i>
            <span class="stat-value">${results.importedCount || 0}</span>
            <span class="stat-label">Kunder importert</span>
          </div>
        ` : ''}
        ${results.skippedCount > 0 ? `
          <div class="result-stat warning">
            <i class="fas fa-forward"></i>
            <span class="stat-value">${results.skippedCount}</span>
            <span class="stat-label">Hoppet over</span>
          </div>
        ` : ''}
        ${results.errorCount > 0 ? `
          <div class="result-stat error">
            <i class="fas fa-times"></i>
            <span class="stat-value">${results.errorCount}</span>
            <span class="stat-label">Feilet</span>
          </div>
        ` : ''}
      </div>

      ${results.importedCount > 0 || results.createdCount > 0 || results.updatedCount > 0 ? `
        <p class="wizard-results-message">
          Kundene er nå tilgjengelige i systemet. Du kan se dem på kartet etter at oppsettet er fullført.
          ${results.durationMs ? `<br><small>Importert på ${(results.durationMs / 1000).toFixed(1)} sekunder.</small>` : ''}
        </p>
      ` : ''}

      ${results.errors && results.errors.length > 0 ? `
        <div class="wizard-results-errors">
          <h4><i class="fas fa-exclamation-triangle"></i> Feil under import</h4>
          <ul>
            ${results.errors.slice(0, 5).map(err => `
              <li>${escapeHtml((err.rowNumber || err.row) ? `Rad ${err.rowNumber || err.row}: ` : '')}${escapeHtml(err.error || err.message || 'Ukjent feil')}</li>
            `).join('')}
            ${results.errors.length > 5 ? `<li>...og ${results.errors.length - 5} flere feil</li>` : ''}
          </ul>
        </div>
      ` : ''}
    </div>

    <div class="wizard-footer wizard-footer-center">
      ${results.batchId ? `
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardRollbackImport()" title="Angre hele importen">
          <i class="fas fa-undo"></i> Angre import
        </button>
      ` : ''}
      ${results.errorCount > 0 ? `
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardReimportFailed()" title="Prøv å importere feilede rader på nytt">
          <i class="fas fa-redo"></i> Reimporter feilede (${results.errorCount})
        </button>
      ` : ''}
      ${results.batchId ? `
        <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDownloadErrorReport()" title="Last ned feilrapport">
          <i class="fas fa-download"></i> Feilrapport
        </button>
      ` : ''}
      ${standaloneImportMode ? `
        <button class="wizard-btn wizard-btn-primary" onclick="closeImportModal()">
          <i class="fas fa-check"></i> Ferdig
        </button>
      ` : `
        <button class="wizard-btn wizard-btn-primary" onclick="wizardImportComplete()">
          Fortsett til neste steg <i class="fas fa-arrow-right"></i>
        </button>
      `}
    </div>
  `;
}

// ========================================
// ROW SELECTION AND EDITING FUNCTIONS
// ========================================

// Initialize row selection when preview data is loaded
function initializeRowSelection() {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) return;

  // Select all valid rows by default
  wizardImportState.selectedRows = new Set();
  data.preview.forEach((row, index) => {
    if (!row.hasError) {
      wizardImportState.selectedRows.add(index);
    }
  });
}

// Get count of selected rows
function getSelectedRowCount() {
  return wizardImportState.selectedRows.size;
}

// Get count of selected valid rows (for import)
function getSelectedValidRowCount() {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) return 0;

  let count = 0;
  wizardImportState.selectedRows.forEach(index => {
    if (data.preview[index] && !data.preview[index].hasError) {
      count++;
    }
  });
  return count;
}

// Check if all valid rows are selected
function areAllRowsSelected(previewRows) {
  if (!previewRows || previewRows.length === 0) return false;

  for (let i = 0; i < previewRows.length; i++) {
    if (!previewRows[i].hasError && !wizardImportState.selectedRows.has(i)) {
      return false;
    }
  }
  return true;
}

// Toggle single row selection
function wizardToggleRow(rowIndex, isSelected) {
  if (isSelected) {
    wizardImportState.selectedRows.add(rowIndex);
  } else {
    wizardImportState.selectedRows.delete(rowIndex);
  }
  updateSelectionDisplay();
}

// Toggle all rows
function wizardToggleAllRows(isSelected) {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) return;

  if (isSelected) {
    data.preview.forEach((row, index) => {
      if (!row.hasError) {
        wizardImportState.selectedRows.add(index);
      }
    });
  } else {
    wizardImportState.selectedRows.clear();
  }
  updateWizardImportContent();
}

// Select all valid rows
function wizardSelectAllRows() {
  wizardToggleAllRows(true);
}

// Deselect all rows
function wizardDeselectAllRows() {
  wizardToggleAllRows(false);
}

// Update selection count display
function updateSelectionDisplay() {
  const countEl = document.getElementById('wizardSelectionCount');
  const data = wizardImportState.previewData;
  if (countEl && data && data.stats) {
    countEl.textContent = `${getSelectedRowCount()} av ${data.stats.validRows || 0} valgt`;
  }

  // Update select all checkbox
  const selectAllCheckbox = document.getElementById('wizardSelectAllCheckbox');
  if (selectAllCheckbox && data && data.preview) {
    selectAllCheckbox.checked = areAllRowsSelected(data.preview.slice(0, 10));
  }

  // Update import button
  const importBtn = document.querySelector('.wizard-footer .wizard-btn-primary');
  if (importBtn) {
    const count = getSelectedValidRowCount();
    importBtn.disabled = count === 0;
    importBtn.innerHTML = `<i class="fas fa-file-import"></i> Importer ${count} kunder`;
  }

  // Update row styling
  document.querySelectorAll('.wizard-preview-table tbody tr').forEach(row => {
    const index = parseInt(row.dataset.rowIndex);
    const isSelected = wizardImportState.selectedRows.has(index);
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = isSelected;

    // Update row class
    row.classList.toggle('row-excluded', !isSelected);
  });
}

// Start editing a cell
function wizardStartCellEdit(rowIndex, field) {
  const cell = document.querySelector(`td[data-row="${rowIndex}"][data-field="${field}"]`);
  if (!cell) return;

  const originalValue = cell.dataset.original || '';
  const currentValue = wizardImportState.editedRows[rowIndex]?.[field] ?? originalValue;

  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cell-edit-input';
  input.value = currentValue;

  // Clear cell and add input
  cell.innerHTML = '';
  cell.appendChild(input);
  cell.classList.add('cell-editing');

  // Focus and select all
  input.focus();
  input.select();

  // Handle blur (save)
  input.addEventListener('blur', () => {
    wizardSaveCellEdit(rowIndex, field, input.value, originalValue);
  });

  // Handle keyboard
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      wizardCancelCellEdit(rowIndex, field, originalValue);
    } else if (e.key === 'Tab') {
      // Allow tab to save and move to next cell
      input.blur();
    }
  });

  wizardImportState.editingCell = { row: rowIndex, field };
}

// Save cell edit
function wizardSaveCellEdit(rowIndex, field, newValue, originalValue) {
  const cell = document.querySelector(`td[data-row="${rowIndex}"][data-field="${field}"]`);
  if (!cell) return;

  // Store edited value if different from original
  if (newValue !== originalValue) {
    if (!wizardImportState.editedRows[rowIndex]) {
      wizardImportState.editedRows[rowIndex] = {};
    }
    wizardImportState.editedRows[rowIndex][field] = newValue;
  } else {
    // Remove edit if reverted to original
    if (wizardImportState.editedRows[rowIndex]) {
      delete wizardImportState.editedRows[rowIndex][field];
      if (Object.keys(wizardImportState.editedRows[rowIndex]).length === 0) {
        delete wizardImportState.editedRows[rowIndex];
      }
    }
  }

  // Update cell display
  const isEdited = newValue !== originalValue;
  cell.innerHTML = escapeHtml(newValue || '-');
  cell.classList.remove('cell-editing');
  cell.classList.toggle('cell-edited', isEdited);
  cell.title = isEdited ? `Redigert (original: ${originalValue})` : 'Dobbeltklikk for å redigere';

  wizardImportState.editingCell = null;
}

// Cancel cell edit
function wizardCancelCellEdit(rowIndex, field, originalValue) {
  const cell = document.querySelector(`td[data-row="${rowIndex}"][data-field="${field}"]`);
  if (!cell) return;

  const currentValue = wizardImportState.editedRows[rowIndex]?.[field] ?? originalValue;
  const isEdited = currentValue !== originalValue;

  cell.innerHTML = escapeHtml(currentValue || '-');
  cell.classList.remove('cell-editing');
  cell.classList.toggle('cell-edited', isEdited);

  wizardImportState.editingCell = null;
}

// Expose functions to window for onclick handlers
window.wizardToggleRow = wizardToggleRow;
window.wizardToggleAllRows = wizardToggleAllRows;
window.wizardSelectAllRows = wizardSelectAllRows;
window.wizardDeselectAllRows = wizardDeselectAllRows;
window.wizardStartCellEdit = wizardStartCellEdit;

// Update column mapping
function updateWizardMapping(field, value) {
  if (value === '') {
    delete wizardImportState.columnMapping[field];
  } else {
    wizardImportState.columnMapping[field] = parseInt(value, 10);
  }
}

// Update category mapping
function updateWizardCategoryMapping(original, value) {
  if (value === '' || value === '__skip__') {
    delete wizardImportState.categoryMapping[original];
  } else if (value === '__new__') {
    // Create new category with same name
    wizardImportState.categoryMapping[original] = { createNew: true, name: original };
  } else {
    wizardImportState.categoryMapping[original] = value;
  }
}

// Validate required mappings
function validateWizardMapping() {
  const required = wizardImportState.requiredMappings;
  const errors = [];

  if (!required.navn || required.navn === '' || required.navn === '-- Velg kolonne --') {
    errors.push('Kundenavn er påkrevd - velg kolonne for navn');
  }
  if (!required.adresse || required.adresse === '' || required.adresse === '-- Velg kolonne --') {
    errors.push('Adresse er påkrevd - velg kolonne for adresse');
  }

  return errors;
}

// Navigate between import sub-steps
function wizardImportBack() {
  if (wizardImportState.currentImportStep > 1) {
    wizardImportState.currentImportStep--;
    wizardImportState.error = null;
    updateWizardImportContent();
  }
}

async function wizardImportNext() {
  const currentStep = wizardImportState.currentImportStep;

  if (currentStep === 3) {
    // Validate mapping before proceeding (mapping is now step 3)
    const errors = validateWizardMapping();
    if (errors.length > 0) {
      showMessage(errors.join('. '), 'error');
      return;
    }

    // Call preview API with mapping
    await wizardFetchPreview();
  } else if (currentStep < 5) {
    wizardImportState.currentImportStep++;
    updateWizardImportContent();
  }
}

// Skip import and go to next wizard step
function skipWizardImport() {
  resetWizardImportState();
  nextWizardStep();
}

// Complete import and go to next wizard step
function wizardImportComplete() {
  resetWizardImportState();
  nextWizardStep();
}

// Retry after error
function wizardImportRetry() {
  wizardImportState.error = null;
  wizardImportState.isLoading = false;
  if (wizardImportState.currentImportStep > 1) {
    wizardImportState.currentImportStep = 1;
  }
  updateWizardImportContent();
}

// Update wizard import content without re-rendering entire wizard
function updateWizardImportContent() {
  const container = document.getElementById('wizardImportContent');
  if (container) {
    container.innerHTML = renderWizardImportSubStep(wizardImportState.currentImportStep);
    attachWizardImportListeners();
  }

  // Update sub-step indicators
  const indicators = document.querySelectorAll('.import-step-indicator');
  const connectors = document.querySelectorAll('.import-step-connector');
  indicators.forEach((indicator, index) => {
    const step = index + 1;
    indicator.classList.toggle('active', step <= wizardImportState.currentImportStep);
  });
  connectors.forEach((connector, index) => {
    const step = index + 2;
    connector.classList.toggle('active', step <= wizardImportState.currentImportStep);
  });
}

// Attach event listeners for wizard import
function attachWizardImportListeners() {
  const dropzone = document.getElementById('wizardImportDropzone');
  const fileInput = document.getElementById('wizardImportFileInput');

  if (!dropzone || !fileInput) return;

  // Click to select file
  dropzone.addEventListener('click', () => fileInput.click());

  // Drag and drop handlers
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      wizardHandleFileSelect(files[0]);
    }
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      wizardHandleFileSelect(e.target.files[0]);
    }
  });
}

// Handle file selection
async function wizardHandleFileSelect(file) {
  // Validate file type
  const validTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv', // .csv
    'application/csv'
  ];
  const validExtensions = ['.xlsx', '.xls', '.csv'];
  const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

  if (!validTypes.includes(file.type) && !validExtensions.includes(extension)) {
    showMessage('Ugyldig filtype. Bruk .xlsx, .xls eller .csv', 'error');
    return;
  }

  // Validate file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    showMessage('Filen er for stor. Maks størrelse er 10MB', 'error');
    return;
  }

  // Show loading with phases
  wizardImportState.isLoading = true;
  wizardImportState.loadingPhase = 'uploading';
  updateWizardImportContent();

  try {
    // Upload file and get initial preview
    const formData = new FormData();
    formData.append('file', file);

    // Switch to parsing phase after a brief moment (track timers for cleanup)
    const phaseTimer1 = setTimeout(() => {
      if (wizardImportState.isLoading) {
        wizardImportState.loadingPhase = 'parsing';
        updateWizardImportContent();
      }
    }, 500);

    // Switch to AI mapping phase after parsing starts
    const phaseTimer2 = setTimeout(() => {
      if (wizardImportState.isLoading) {
        wizardImportState.loadingPhase = 'ai-mapping';
        updateWizardImportContent();
      }
    }, 1200);

    const importPreviewHeaders = {
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      importPreviewHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/import/upload', {
      method: 'POST',
      headers: importPreviewHeaders,
      credentials: 'include',
      body: formData
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      const errorMsg = result.error?.message || (typeof result.error === 'string' ? result.error : null) || 'Kunne ikke behandle filen';
      throw new Error(errorMsg);
    }

    // Store batch ID from staging backend
    wizardImportState.batchId = result.data.batchId;

    // Store preview data in memory
    wizardImportState.previewData = result.data;

    // Store original and cleaned preview data for the cleaning step
    wizardImportState.originalPreview = result.data.originalPreview;
    wizardImportState.cleanedPreview = result.data.cleanedPreview || result.data.originalPreview;
    wizardImportState.cleaningReport = result.data.cleaningReport || null;

    // Initialize cleaning rule toggles (all enabled by default)
    if (result.data.cleaningReport && result.data.cleaningReport.rules) {
      const enabledRules = {};
      result.data.cleaningReport.rules.forEach(rule => {
        enabledRules[rule.ruleId] = rule.enabled;
      });
      wizardImportState.enabledCleaningRules = enabledRules;
    }

    // Initialize required field mappings from suggested mapping
    const suggestedMapping = result.data.suggestedMapping || {};
    const headers = result.data.headers || [];

    // Find which header maps to 'navn' and 'adresse'
    let navnHeader = null;
    let adresseHeader = null;
    for (const [header, field] of Object.entries(suggestedMapping)) {
      if (field === 'navn') navnHeader = header;
      if (field === 'adresse') adresseHeader = header;
    }

    wizardImportState.requiredMappings = {
      navn: navnHeader || headers[0] || null,
      adresse: adresseHeader || headers[1] || null
    };
    console.log('[DEBUG] Required mappings initialized:', wizardImportState.requiredMappings);

    // Convert backend mapping format to frontend format (header -> field becomes field -> headerIndex)
    const backendMapping = suggestedMapping;
    wizardImportState.columnMapping = convertBackendToFrontendMapping(backendMapping, headers);

    wizardImportState.validCategories = result.data.validCategories || [];
    wizardImportState.isLoading = false;
    clearTimeout(phaseTimer1);
    clearTimeout(phaseTimer2);

    // Pre-fill category mapping with suggestions
    if (result.data.categoryMatches) {
      result.data.categoryMatches.forEach(match => {
        if (match.suggested) {
          wizardImportState.categoryMapping[match.original] = match.suggested.id;
        }
      });
    }

    // Always go to cleaning step first (step 2)
    wizardImportState.currentImportStep = 2;
    updateWizardImportContent();

  } catch (error) {
    console.error('Wizard import error:', error);
    wizardImportState.isLoading = false;
    clearTimeout(phaseTimer1);
    clearTimeout(phaseTimer2);
    wizardImportState.error = error.message || 'En feil oppstod under behandling av filen';
    updateWizardImportContent();
  }
}

// Apply mapping and show preview (all in memory, no backend call)
async function wizardFetchPreview() {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) {
    wizardImportState.error = 'Ingen data å vise';
    updateWizardImportContent();
    return;
  }

  // Validate required mappings
  const { navn, adresse } = wizardImportState.requiredMappings;
  if (!navn || !adresse) {
    showMessage('Du må velge kolonner for navn og adresse', 'warning');
    return;
  }

  // Build reverse mapping: field -> header (from columnMapping which is field -> headerIndex)
  const headers = data.headers || [];
  const fieldToHeader = {};
  for (const [field, headerIndex] of Object.entries(wizardImportState.columnMapping)) {
    if (headerIndex !== undefined && headers[headerIndex]) {
      fieldToHeader[field] = headers[headerIndex];
    }
  }
  // Ensure required fields are in the mapping
  fieldToHeader['navn'] = navn;
  fieldToHeader['adresse'] = adresse;

  // Store field→header mapping for before/after comparison in preview
  wizardImportState.fieldToHeaderMapping = { ...fieldToHeader };

  // If we have a batchId, use the staging API for mapping + validation
  if (wizardImportState.batchId) {
    try {
      wizardImportState.isLoading = true;
      wizardImportState.loadingPhase = 'validating';
      updateWizardImportContent();

      const csrfToken = getCsrfToken();
      const apiHeaders = { 'Content-Type': 'application/json' };
      if (csrfToken) apiHeaders['X-CSRF-Token'] = csrfToken;

      // Build ImportMappingConfig for the staging API
      const mappings = [];
      for (const [field, header] of Object.entries(fieldToHeader)) {
        mappings.push({
          sourceColumn: header,
          targetField: field,
          targetFieldType: IMPORT_FIELD_TYPE_MAP[field] || 'string',
          required: field === 'navn' || field === 'adresse',
        });
      }

      const mappingConfig = {
        version: '1.0',
        mappings,
        options: {
          skipHeaderRows: 1,
          skipEmptyRows: true,
          trimWhitespace: true,
          duplicateDetection: 'name_address',
          duplicateAction: 'skip',
          stopOnFirstError: false,
          maxErrors: 0,
          dateFormat: 'DD.MM.YYYY',
          fallbackDateFormats: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
          autoCreateCategories: false,
        }
      };

      // Step 1: Apply mapping to staging rows
      const mappingResponse = await fetch(`/api/import/batches/${wizardImportState.batchId}/mapping`, {
        method: 'POST',
        headers: apiHeaders,
        credentials: 'include',
        body: JSON.stringify({ mappingConfig })
      });

      const mappingResult = await mappingResponse.json();
      if (!mappingResponse.ok || !mappingResult.success) {
        throw new Error(mappingResult.error || 'Mapping feilet');
      }

      // Step 2: Validate mapped data
      const validateResponse = await fetch(`/api/import/batches/${wizardImportState.batchId}/validate`, {
        method: 'POST',
        headers: apiHeaders,
        credentials: 'include',
      });

      const validateResult = await validateResponse.json();
      if (!validateResponse.ok || !validateResult.success) {
        throw new Error(validateResult.error || 'Validering feilet');
      }

      // Step 3: Get preview with errors
      const previewResponse = await fetch(`/api/import/batches/${wizardImportState.batchId}/preview?showErrors=true&limit=200`, {
        method: 'GET',
        headers: apiHeaders,
        credentials: 'include',
      });

      const previewResult = await previewResponse.json();
      if (!previewResponse.ok || !previewResult.success) {
        throw new Error(previewResult.error || 'Forhåndsvisning feilet');
      }

      const previewData = previewResult.data;
      const validationData = validateResult.data;

      // Convert staging preview rows to format compatible with existing frontend
      const mappedPreview = previewData.previewRows.map((row, index) => {
        const hasError = row.validationStatus === 'invalid';
        const hasWarning = row.validationStatus === 'warning';
        const errorMessages = (row.errors || []).map(e => e.message).join('; ');

        // Use mapped_data for display, fall back to raw values
        const rawValues = row.values || {};
        const displayData = row.mappedValues || rawValues;

        return {
          ...rawValues,
          _rowIndex: index,
          _stagingRowId: row.stagingRowId || row.rowNumber, // Use actual DB ID for exclusion/edits
          _selected: !hasError,
          _rawValues: rawValues,        // Preserve raw for before/after comparison
          _mappedValues: displayData,   // Preserve mapped for before/after comparison
          hasError,
          hasWarning,
          errorMessage: errorMessages,
          validationErrors: row.errors || [],
          ...displayData
        };
      });

      // Update preview data with validated results
      wizardImportState.previewData = {
        ...data,
        preview: mappedPreview,
        stats: {
          totalRows: previewData.totalRows,
          validRows: validationData.validCount,
          warnings: validationData.warningCount,
          errors: validationData.errorCount,
        }
      };

      wizardImportState.isLoading = false;
      wizardImportState.currentImportStep = 4;
      initializeRowSelection();
      updateWizardImportContent();
      return;

    } catch (error) {
      console.error('Staging API preview error:', error);
      wizardImportState.isLoading = false;
      // Fall through to client-side preview as fallback
    }
  }

  // Fallback: Client-side mapping preview (when no batchId)
  let validRows = 0;
  let errorRows = 0;

  const mappedPreview = data.preview.map((row, index) => {
    const mappedRow = { ...row };
    const navnValue = String(row[navn] || '').trim();
    const adresseValue = String(row[adresse] || '').trim();

    let hasError = false;
    let errorMessage = '';

    if (!navnValue) {
      hasError = true;
      errorMessage = 'Mangler navn';
    } else if (!adresseValue) {
      hasError = true;
      errorMessage = 'Mangler adresse';
    }

    if (hasError) {
      errorRows++;
    } else {
      validRows++;
    }

    const mappedFields = {};
    for (const [field, header] of Object.entries(fieldToHeader)) {
      mappedFields[field] = String(row[header] || '').trim();
    }

    return {
      ...mappedRow,
      _rowIndex: index,
      _selected: !hasError,
      _rawValues: { ...row },
      _mappedValues: { ...mappedFields },
      hasError,
      errorMessage,
      ...mappedFields
    };
  });

  wizardImportState.previewData = {
    ...data,
    preview: mappedPreview,
    stats: {
      totalRows: data.totalRows,
      validRows: validRows,
      warnings: 0,
      errors: errorRows
    }
  };

  wizardImportState.isLoading = false;
  wizardImportState.currentImportStep = 4;
  initializeRowSelection();
  updateWizardImportContent();
}

// Execute import - sends requiredMappings to override AI mapping
async function wizardStartImport(confirmUpdate = false, confirmDeletions = false) {
  // Enhanced validation of required field mappings
  const { navn, adresse } = wizardImportState.requiredMappings;

  if (!navn || navn === '' || navn === '-- Velg kolonne --') {
    showMessage('Du må velge hvilken kolonne som inneholder kundenavn', 'error');
    return;
  }

  if (!adresse || adresse === '' || adresse === '-- Velg kolonne --') {
    showMessage('Du må velge hvilken kolonne som inneholder adresse', 'error');
    return;
  }

  // Check if same column is selected for both fields
  if (navn === adresse) {
    showMessage('Kundenavn og adresse kan ikke bruke samme kolonne. Velg forskjellige kolonner.', 'error');
    return;
  }

  // Get selected rows (with any edits applied)
  const previewData = wizardImportState.previewData;
  const allRows = previewData?.preview || [];
  const selectedRows = allRows.filter((row, idx) => wizardImportState.selectedRows.has(idx));

  // Apply any edits to selected rows (use original _rowIndex for edit lookup)
  const rowsToImport = selectedRows.map(row => {
    const originalIndex = row._rowIndex !== undefined ? row._rowIndex : 0;
    const edits = wizardImportState.editedRows[originalIndex] || {};
    return { ...row, ...edits };
  });

  // Build column mapping (header name -> field name)
  const columnMapping = {
    navn: navn,
    adresse: adresse
  };

  // Add other mappings from wizardImportState.columnMapping if available
  const headers = previewData?.headers || [];
  for (const [field, headerIndex] of Object.entries(wizardImportState.columnMapping)) {
    if (headerIndex !== undefined && headers[headerIndex]) {
      columnMapping[field] = headers[headerIndex];
    }
  }

  // Log what we're sending for debugging
  console.log('Starting import with:', {
    selectedCount: rowsToImport.length,
    columnMapping: columnMapping
  });

  wizardImportState.isLoading = true;
  wizardImportState.loadingPhase = 'importing';
  wizardImportState.loadingProgress = 0;
  wizardImportState.importedSoFar = 0;
  wizardImportState.totalToImport = rowsToImport.length;
  updateWizardImportContent();

  try {
    const executeHeaders = {
      'Content-Type': 'application/json'
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      executeHeaders['X-CSRF-Token'] = csrfToken;
    }

    // Use staging commit API if we have a batchId, otherwise fall back to simple API
    if (wizardImportState.batchId) {
      const batchId = wizardImportState.batchId;

      // --- Step 1: Apply column mapping ---
      wizardImportState.loadingPhase = 'mapping';
      updateWizardImportContent();

      // Build ImportMappingConfig from frontend state
      const mappingHeaders = wizardImportState.previewData?.headers || [];
      const mappings = [];

      // Add required mappings (navn, adresse) from requiredMappings (header names)
      for (const [field, headerName] of Object.entries(wizardImportState.requiredMappings)) {
        if (headerName) {
          const idx = mappingHeaders.indexOf(headerName);
          mappings.push({
            sourceColumn: headerName,
            sourceColumnIndex: idx >= 0 ? idx : undefined,
            targetField: field,
            targetFieldType: IMPORT_FIELD_TYPE_MAP[field] || 'string',
            required: true,
            humanConfirmed: true,
          });
        }
      }

      // Add other mappings from columnMapping (field -> headerIndex)
      for (const [field, headerIndex] of Object.entries(wizardImportState.columnMapping)) {
        // Skip if already added via requiredMappings
        if (field === 'navn' || field === 'adresse') continue;
        if (headerIndex === undefined || headerIndex === '') continue;
        const sourceColumn = mappingHeaders[headerIndex];
        if (!sourceColumn) continue;
        mappings.push({
          sourceColumn: sourceColumn,
          sourceColumnIndex: parseInt(headerIndex, 10),
          targetField: field,
          targetFieldType: IMPORT_FIELD_TYPE_MAP[field] || 'string',
          required: false,
          humanConfirmed: true,
        });
      }

      const mappingConfig = {
        version: '1.0',
        mappings: mappings,
        options: {
          skipHeaderRows: 1,
          skipEmptyRows: true,
          trimWhitespace: true,
          duplicateDetection: 'name_address',
          duplicateAction: 'skip',
          stopOnFirstError: false,
          maxErrors: 0,
          dateFormat: 'DD.MM.YYYY',
          fallbackDateFormats: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
          autoCreateCategories: false,
        }
      };

      console.log('[Import] Applying mapping config:', mappingConfig);

      const mappingResponse = await fetch(`/api/import/batches/${batchId}/mapping`, {
        method: 'POST',
        headers: executeHeaders,
        credentials: 'include',
        body: JSON.stringify({ mappingConfig })
      });

      const mappingResult = await mappingResponse.json();
      if (!mappingResponse.ok || !mappingResult.success) {
        const msg = mappingResult.error?.message || mappingResult.message || 'Mapping feilet';
        throw new Error(msg);
      }
      console.log('[Import] Mapping applied:', mappingResult.data);

      // --- Step 2: Validate ---
      wizardImportState.loadingPhase = 'validating';
      wizardImportState.loadingProgress = 30;
      updateWizardImportContent();

      const validateResponse = await fetch(`/api/import/batches/${batchId}/validate`, {
        method: 'POST',
        headers: executeHeaders,
        credentials: 'include',
        body: JSON.stringify({})
      });

      const validateResult = await validateResponse.json();
      if (!validateResponse.ok || !validateResult.success) {
        const msg = validateResult.error?.message || validateResult.message || 'Validering feilet';
        throw new Error(msg);
      }
      console.log('[Import] Validation result:', validateResult.data);

      // --- Step 3: Commit ---
      wizardImportState.loadingPhase = 'importing';
      wizardImportState.loadingProgress = 60;
      updateWizardImportContent();

      // Build excluded row IDs from deselected rows
      const allRows = wizardImportState.previewData?.preview || [];
      const excludedRowIds = [];
      allRows.forEach((row, idx) => {
        if (!wizardImportState.selectedRows.has(idx)) {
          // Use staging row number if available
          if (row._stagingRowId) {
            excludedRowIds.push(row._stagingRowId);
          }
        }
      });

      // Build row edits keyed by staging row ID
      const rowEdits = {};
      for (const [rowIdx, edits] of Object.entries(wizardImportState.editedRows)) {
        const row = allRows[parseInt(rowIdx)];
        if (row && row._stagingRowId) {
          rowEdits[row._stagingRowId] = edits;
        }
      }

      const response = await fetch(`/api/import/batches/${batchId}/commit`, {
        method: 'POST',
        headers: executeHeaders,
        credentials: 'include',
        body: JSON.stringify({
          dryRun: false,
          excludedRowIds,
          rowEdits,
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorMsg = typeof result.error === 'string'
          ? result.error
          : (result.error?.message || result.message || 'Import feilet');
        throw new Error(errorMsg);
      }

      wizardImportState.importResults = {
        success: true,
        importedCount: result.data.created + result.data.updated,
        createdCount: result.data.created,
        updatedCount: result.data.updated,
        skippedCount: result.data.skipped,
        errorCount: result.data.failed,
        errors: result.data.errors || [],
        batchId: wizardImportState.batchId,
        durationMs: result.data.durationMs,
      };
      wizardImportState.isLoading = false;
      wizardImportState.currentImportStep = 5;

      updateWizardImportContent();

      if (result.data.created > 0 || result.data.updated > 0) {
        refreshCustomerData();
      }

    } else {
      // Fallback: Simple import API (no staging)
      const response = await fetch('/api/kunder/import/execute', {
        method: 'POST',
        headers: executeHeaders,
        credentials: 'include',
        body: JSON.stringify({
          rows: rowsToImport,
          columnMapping: columnMapping
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorMsg = typeof result.error === 'string'
          ? result.error
          : (result.error?.message || result.message || 'Import feilet');
        throw new Error(errorMsg);
      }

      wizardImportState.importResults = {
        success: true,
        importedCount: result.data.created,
        createdCount: result.data.created,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: result.data.failed,
        errors: result.data.errors || []
      };
      wizardImportState.isLoading = false;
      wizardImportState.currentImportStep = 5;

      updateWizardImportContent();

      if (result.data.created > 0) {
        refreshCustomerData();
      }
    }

  } catch (error) {
    console.error('Wizard import execute error:', error);
    wizardImportState.isLoading = false;
    let errorMsg = 'En feil oppstod under import';
    if (typeof error === 'string') {
      errorMsg = error;
    } else if (error && typeof error.message === 'string') {
      errorMsg = error.message;
    } else if (error && typeof error.error === 'string') {
      errorMsg = error.error;
    }
    wizardImportState.error = errorMsg;
    updateWizardImportContent();
  }
}

// Refresh customer data after import
// Rollback a committed import batch
async function wizardRollbackImport() {
  const results = wizardImportState.importResults;
  if (!results || !results.batchId) {
    showMessage('Ingen import å angre', 'error');
    return;
  }

  if (!confirm('Er du sikker på at du vil angre hele importen? Alle opprettede kunder vil bli slettet.')) {
    return;
  }

  try {
    const apiHeaders = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) apiHeaders['X-CSRF-Token'] = csrfToken;

    const response = await fetch(`/api/import/batches/${results.batchId}/rollback`, {
      method: 'POST',
      headers: apiHeaders,
      credentials: 'include',
      body: JSON.stringify({ reason: 'Bruker angret importen' })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || (typeof result.error === 'string' ? result.error : null) || 'Kunne ikke angre importen');
    }

    showMessage(`Import angret: ${result.data.recordsDeleted} kunder slettet`, 'success');
    resetWizardImportState();
    updateWizardImportContent();
    refreshCustomerData();

  } catch (error) {
    console.error('Rollback error:', error);
    showMessage(error.message || 'Kunne ikke angre importen', 'error');
  }
}

async function refreshCustomerData() {
  try {
    // This will be available after wizard completes and app loads
    if (typeof loadCustomers === 'function') {
      await loadCustomers();
    }
  } catch (error) {
    console.error('Error refreshing customer data:', error);
  }
}

// ========================================
// ERROR GROUPING & QUALITY REPORT
// ========================================

function renderErrorGrouping(preview) {
  if (!preview || !Array.isArray(preview)) return '';

  // Collect errors grouped by type
  const errorGroups = {};
  for (const row of preview) {
    if (!row.fieldErrors) continue;
    for (const [field, message] of Object.entries(row.fieldErrors)) {
      const key = `${field}:${message}`;
      if (!errorGroups[key]) {
        errorGroups[key] = { field, message, count: 0, rows: [] };
      }
      errorGroups[key].count++;
      errorGroups[key].rows.push(row);
    }
  }

  const groups = Object.values(errorGroups).sort((a, b) => b.count - a.count);
  if (groups.length === 0) return '';

  return `
    <div class="wizard-error-groups">
      <h4><i class="fas fa-layer-group"></i> Feilsammendrag</h4>
      <div class="error-group-list">
        ${groups.slice(0, 8).map(group => `
          <div class="error-group-item">
            <div class="error-group-info">
              <span class="error-group-field">${escapeHtml(group.field)}</span>
              <span class="error-group-message">${escapeHtml(group.message)}</span>
              <span class="error-group-count">${group.count} rader</span>
            </div>
            ${group.field === 'epost' && group.message.includes('skrivefeil') ? `
              <button class="wizard-btn wizard-btn-small" onclick="wizardFixAllSimilar('${escapeHtml(group.field)}', '${escapeHtml(group.message)}')">
                <i class="fas fa-magic"></i> Fiks alle
              </button>
            ` : `
              <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDeselectErrorRows('${escapeHtml(group.field)}', '${escapeHtml(group.message)}')">
                <i class="fas fa-minus-circle"></i> Fjern fra import
              </button>
            `}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderQualityReport(report) {
  if (!report) return '';

  const scoreColor = report.overallScore >= 80 ? 'success' : report.overallScore >= 60 ? 'warning' : 'error';

  return `
    <div class="wizard-quality-report">
      <h4><i class="fas fa-chart-bar"></i> Kvalitetsrapport</h4>
      <div class="quality-score-bar">
        <div class="quality-score-fill ${scoreColor}" style="width: ${report.overallScore}%"></div>
        <span class="quality-score-label">${report.overallScore}%</span>
      </div>
      ${report.suggestions && report.suggestions.length > 0 ? `
        <ul class="quality-suggestions">
          ${report.suggestions.map(s => `<li><i class="fas fa-lightbulb"></i> ${escapeHtml(s)}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `;
}

function wizardFixAllSimilar(field, message) {
  const preview = wizardImportState.previewData?.preview;
  if (!preview) return;

  let fixCount = 0;
  for (let i = 0; i < preview.length; i++) {
    const row = preview[i];
    if (row.fieldErrors && row.fieldErrors[field] === message && row.suggestion && row.suggestion[field]) {
      if (!wizardImportState.editedRows[i]) wizardImportState.editedRows[i] = {};
      wizardImportState.editedRows[i][field] = row.suggestion[field];
      fixCount++;
    }
  }

  if (fixCount > 0) {
    showMessage(`${fixCount} felt korrigert automatisk`, 'success');
    updateWizardImportContent();
  }
}

function wizardDeselectErrorRows(field, message) {
  const preview = wizardImportState.previewData?.preview;
  if (!preview) return;

  let count = 0;
  for (let i = 0; i < preview.length; i++) {
    if (preview[i].fieldErrors && preview[i].fieldErrors[field] === message) {
      wizardImportState.selectedRows.delete(i);
      count++;
    }
  }

  if (count > 0) {
    showMessage(`${count} rader fjernet fra import`, 'info');
    updateWizardImportContent();
  }
}

async function wizardDownloadErrorReport() {
  const batchId = wizardImportState.batchId;
  if (!batchId) {
    showMessage('Ingen batch tilgjengelig for feilrapport', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/import/batches/${batchId}/error-report`, {
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Kunne ikke laste ned feilrapport');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feilrapport-batch-${batchId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Download error:', error);
    showMessage(error.message || 'Kunne ikke laste ned feilrapport', 'error');
  }
}

async function wizardReimportFailed() {
  const results = wizardImportState.importResults;
  if (!results || !results.batchId) {
    showMessage('Ingen import å reimportere', 'error');
    return;
  }

  showMessage('Setter opp reimport av feilede rader...', 'info');

  // Go back to preview step with only failed rows selected
  wizardImportState.currentImportStep = 4; // Preview step
  // The batchId is preserved, so re-validating will re-fetch the batch
  wizardImportState.importResults = null;
  updateWizardImportContent();
}

// Attach event listeners for current step
function attachStepListeners(stepId) {
  switch (stepId) {
    case 'company':
      attachCompanyListeners();
      break;
    case 'import':
      attachWizardImportListeners();
      break;
    case 'map':
      attachMapListeners();
      break;
  }
}

// Company step listeners
let wizardRouteMap = null;
let wizardRouteMarker = null;

function attachCompanyListeners() {
  // Initialize mini map for route start
  setTimeout(() => {
    const mapContainer = document.getElementById('wizardRouteMap');
    if (mapContainer && !wizardRouteMap) {
      const data = onboardingWizard.data.company;
      const lat = data.route_start_lat || 59.9139;
      const lng = data.route_start_lng || 10.7522;

      wizardRouteMap = L.map('wizardRouteMap').setView([lat, lng], 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(wizardRouteMap);

      if (data.route_start_lat) {
        wizardRouteMarker = L.marker([lat, lng]).addTo(wizardRouteMap);
      }

      wizardRouteMap.on('click', (e) => {
        if (wizardRouteMarker) {
          wizardRouteMap.removeLayer(wizardRouteMarker);
        }
        wizardRouteMarker = L.marker(e.latlng).addTo(wizardRouteMap);
        onboardingWizard.data.company.route_start_lat = e.latlng.lat;
        onboardingWizard.data.company.route_start_lng = e.latlng.lng;
        document.getElementById('routeCoordinates').innerHTML =
          `<span>Valgt: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}</span>`;
      });
    }
  }, 100);

  // Basic input listeners for manual typing (poststed only, others handled by autocomplete)
  const poststedInput = document.getElementById('companyPoststed');
  if (poststedInput) poststedInput.addEventListener('input', (e) => {
    onboardingWizard.data.company.poststed = e.target.value;
  });

  // Setup address autocomplete with Kartverket
  setupWizardAddressAutocomplete();

  // Setup postal code lookup with Bring
  setupWizardPostnummerLookup();
}

// Wizard address autocomplete state
let wizardAddressSuggestions = [];
let wizardSelectedIndex = -1;

// Setup address autocomplete for the wizard
function setupWizardAddressAutocomplete() {
  const addressInput = document.getElementById('companyAddress');
  const suggestionsContainer = document.getElementById('wizardAddressSuggestions');

  if (!addressInput || !suggestionsContainer) return;

  // Debounced search using Kartverket API
  const debouncedSearch = debounce(async (query) => {
    if (query.length < 3) {
      suggestionsContainer.classList.remove('visible');
      wizardAddressSuggestions = [];
      return;
    }

    wizardAddressSuggestions = await searchAddresses(query);
    wizardSelectedIndex = -1;
    renderWizardAddressSuggestions(wizardAddressSuggestions);
  }, 300);

  // Input event - update state and search
  addressInput.addEventListener('input', (e) => {
    onboardingWizard.data.company.address = e.target.value;
    debouncedSearch(e.target.value);
  });

  // Keyboard navigation
  addressInput.addEventListener('keydown', (e) => {
    if (!wizardAddressSuggestions.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      wizardSelectedIndex = Math.min(wizardSelectedIndex + 1, wizardAddressSuggestions.length - 1);
      updateWizardSuggestionSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      wizardSelectedIndex = Math.max(wizardSelectedIndex - 1, 0);
      updateWizardSuggestionSelection();
    } else if (e.key === 'Enter' && wizardSelectedIndex >= 0) {
      e.preventDefault();
      selectWizardAddressSuggestion(wizardAddressSuggestions[wizardSelectedIndex]);
    } else if (e.key === 'Escape') {
      suggestionsContainer.classList.remove('visible');
      wizardAddressSuggestions = [];
    }
  });

  // Click outside to close suggestions
  document.addEventListener('click', (e) => {
    if (!addressInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
      suggestionsContainer.classList.remove('visible');
    }
  });
}

// Render wizard address suggestions dropdown
function renderWizardAddressSuggestions(results) {
  const container = document.getElementById('wizardAddressSuggestions');
  if (!container) return;

  if (!results || results.length === 0) {
    container.innerHTML = '';
    container.classList.remove('visible');
    return;
  }

  container.innerHTML = results.map((addr, index) => `
    <div class="wizard-address-suggestion" data-index="${index}">
      <i class="fas fa-map-marker-alt"></i>
      <div class="wizard-address-text">
        <div class="wizard-address-main">${escapeHtml(addr.adresse)}</div>
        <div class="wizard-address-detail">${escapeHtml(addr.postnummer)} ${escapeHtml(addr.poststed)}${addr.kommune ? `, ${escapeHtml(addr.kommune)}` : ''}</div>
      </div>
    </div>
  `).join('');

  container.classList.add('visible');

  // Add click handlers to each suggestion
  container.querySelectorAll('.wizard-address-suggestion').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      selectWizardAddressSuggestion(wizardAddressSuggestions[index]);
    });
  });
}

// Update visual selection in suggestions
function updateWizardSuggestionSelection() {
  const items = document.querySelectorAll('.wizard-address-suggestion');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === wizardSelectedIndex);
  });
}

// Select an address suggestion and fill all fields
function selectWizardAddressSuggestion(suggestion) {
  const addressInput = document.getElementById('companyAddress');
  const postnummerInput = document.getElementById('companyPostnummer');
  const poststedInput = document.getElementById('companyPoststed');
  const suggestionsContainer = document.getElementById('wizardAddressSuggestions');

  // Fill form fields
  if (addressInput) addressInput.value = suggestion.adresse;
  if (postnummerInput) postnummerInput.value = suggestion.postnummer;
  if (poststedInput) {
    poststedInput.value = suggestion.poststed;
    poststedInput.classList.add('auto-filled');
  }

  // Update wizard state
  onboardingWizard.data.company.address = suggestion.adresse;
  onboardingWizard.data.company.postnummer = suggestion.postnummer;
  onboardingWizard.data.company.poststed = suggestion.poststed;
  onboardingWizard.data.company.route_start_lat = suggestion.lat;
  onboardingWizard.data.company.route_start_lng = suggestion.lng;

  // Update map marker
  if (wizardRouteMap) {
    if (wizardRouteMarker) wizardRouteMap.removeLayer(wizardRouteMarker);
    wizardRouteMarker = L.marker([suggestion.lat, suggestion.lng]).addTo(wizardRouteMap);
    wizardRouteMap.setView([suggestion.lat, suggestion.lng], 14);
  }

  // Update coordinates display
  const coordsEl = document.getElementById('routeCoordinates');
  if (coordsEl) {
    coordsEl.innerHTML = `<span>Valgt: ${suggestion.lat.toFixed(5)}, ${suggestion.lng.toFixed(5)}</span>`;
  }

  // Update postnummer status
  updateWizardPostnummerStatus('valid');

  // Hide suggestions
  if (suggestionsContainer) {
    suggestionsContainer.classList.remove('visible');
    wizardAddressSuggestions = [];
  }
}

// Setup postal code lookup for the wizard
function setupWizardPostnummerLookup() {
  const postnummerInput = document.getElementById('companyPostnummer');
  const poststedInput = document.getElementById('companyPoststed');

  if (!postnummerInput) return;

  postnummerInput.addEventListener('input', async (e) => {
    const value = e.target.value;
    onboardingWizard.data.company.postnummer = value;

    // Only lookup when we have exactly 4 digits
    if (value.length === 4 && /^\d{4}$/.test(value)) {
      updateWizardPostnummerStatus('loading');

      const poststed = await lookupPostnummer(value);

      if (poststed) {
        if (poststedInput) {
          poststedInput.value = poststed;
          poststedInput.classList.add('auto-filled');
        }
        onboardingWizard.data.company.poststed = poststed;
        updateWizardPostnummerStatus('valid');
      } else {
        updateWizardPostnummerStatus('invalid');
      }
    } else if (value.length < 4) {
      updateWizardPostnummerStatus('');
    }
  });
}

// Update wizard postnummer status indicator
function updateWizardPostnummerStatus(status) {
  const statusEl = document.getElementById('wizardPostnummerStatus');
  if (!statusEl) return;

  statusEl.className = 'wizard-postnummer-status';

  switch (status) {
    case 'valid':
      statusEl.innerHTML = '<i class="fas fa-check"></i>';
      statusEl.classList.add('valid');
      break;
    case 'invalid':
      statusEl.innerHTML = '<i class="fas fa-times"></i>';
      statusEl.classList.add('invalid');
      break;
    case 'loading':
      statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      statusEl.classList.add('loading');
      break;
    default:
      statusEl.innerHTML = '';
  }
}

// Map step listeners
let wizardMainMap = null;

function attachMapListeners() {
  setTimeout(() => {
    const mapContainer = document.getElementById('wizardMainMap');
    if (mapContainer && !wizardMainMap) {
      const data = onboardingWizard.data.map;
      const company = onboardingWizard.data.company;
      const lat = data.center_lat || company.route_start_lat || 59.9139;
      const lng = data.center_lng || company.route_start_lng || 10.7522;
      const zoom = data.zoom || 10;

      wizardMainMap = L.map('wizardMainMap').setView([lat, lng], zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(wizardMainMap);

      wizardMainMap.on('moveend', () => {
        const center = wizardMainMap.getCenter();
        onboardingWizard.data.map.center_lat = center.lat;
        onboardingWizard.data.map.center_lng = center.lng;
        onboardingWizard.data.map.zoom = wizardMainMap.getZoom();
        document.getElementById('defaultZoom').value = wizardMainMap.getZoom();
        document.getElementById('zoomValue').textContent = wizardMainMap.getZoom();
      });
    }
  }, 100);

  const zoomSlider = document.getElementById('defaultZoom');
  if (zoomSlider) {
    zoomSlider.addEventListener('input', (e) => {
      const zoom = parseInt(e.target.value);
      document.getElementById('zoomValue').textContent = zoom;
      onboardingWizard.data.map.zoom = zoom;
      if (wizardMainMap) {
        wizardMainMap.setZoom(zoom);
      }
    });
  }
}

// Use company address as route start
async function useAddressAsRouteStart() {
  const address = onboardingWizard.data.company.address;
  const postnummer = onboardingWizard.data.company.postnummer;
  const poststed = onboardingWizard.data.company.poststed;

  if (!address || !postnummer || !poststed) {
    showMessage('Fyll ut firmaadresse først', 'warning');
    return;
  }

  const fullAddress = `${address}, ${postnummer} ${poststed}, Norge`;

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}`);
    const data = await response.json();

    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);

      onboardingWizard.data.company.route_start_lat = lat;
      onboardingWizard.data.company.route_start_lng = lng;

      if (wizardRouteMap) {
        if (wizardRouteMarker) {
          wizardRouteMap.removeLayer(wizardRouteMarker);
        }
        wizardRouteMarker = L.marker([lat, lng]).addTo(wizardRouteMap);
        wizardRouteMap.setView([lat, lng], 14);
      }

      document.getElementById('routeCoordinates').innerHTML =
        `<span>Valgt: ${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`;
    } else {
      showMessage('Kunne ikke finne adressen. Prøv å klikke på kartet manuelt.', 'warning');
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    showMessage('Feil ved søk etter adresse', 'error');
  }
}

// Navigate to next step
async function nextWizardStep() {
  try {
    console.log('nextWizardStep called, current step:', onboardingWizard.currentStep);
    const currentStepId = onboardingWizard.steps[onboardingWizard.currentStep].id;
    console.log('Current step ID:', currentStepId);

    // Save current step data to server
    if (currentStepId === 'company') {
      const data = onboardingWizard.data.company;
      console.log('Saving company data:', data);
      const result = await updateOnboardingStep('company_info', {
        company_address: data.address,
        company_postnummer: data.postnummer,
        company_poststed: data.poststed,
        route_start_lat: data.route_start_lat,
        route_start_lng: data.route_start_lng
      });
      console.log('Company step save result:', result);
    } else if (currentStepId === 'map') {
      const data = onboardingWizard.data.map;
      console.log('Saving map data:', data);
      const result = await updateOnboardingStep('map_settings', {
        map_center_lat: data.center_lat,
        map_center_lng: data.center_lng,
        map_zoom: data.zoom
      });
      console.log('Map step save result:', result);
    }

    // Cleanup maps before step change
    cleanupWizardMaps();

    onboardingWizard.currentStep++;
    console.log('Moving to step:', onboardingWizard.currentStep);
    await renderWizardStep();
  } catch (error) {
    console.error('Error in nextWizardStep:', error);
    showMessage('Det oppstod en feil. Prøv igjen.', 'error');
  }
}

// Navigate to previous step
async function prevWizardStep() {
  if (onboardingWizard.currentStep > 0) {
    cleanupWizardMaps();
    onboardingWizard.currentStep--;
    await renderWizardStep();
  }
}

// Cleanup wizard maps
function cleanupWizardMaps() {
  if (wizardRouteMap) {
    wizardRouteMap.remove();
    wizardRouteMap = null;
    wizardRouteMarker = null;
  }
  if (wizardMainMap) {
    wizardMainMap.remove();
    wizardMainMap = null;
  }
}

// Complete onboarding wizard
async function completeOnboardingWizard() {
  await updateOnboardingStep('completed', {});

  cleanupWizardMaps();

  const overlay = onboardingWizard.overlay;
  overlay.classList.remove('visible');

  setTimeout(() => {
    overlay.remove();
    onboardingWizard.overlay = null;

    // Show first-time tips
    showContextTips();

    if (onboardingWizard.resolve) {
      onboardingWizard.resolve();
    }
  }, 400);
}

// Skip onboarding
async function handleSkipOnboarding() {
  const confirmed = await showConfirm('Er du sikker på at du vil hoppe over oppsettet? Du kan alltid endre innstillinger senere.', 'Hopp over oppsett');
  if (confirmed) {
    await skipOnboarding();
    cleanupWizardMaps();

    const overlay = onboardingWizard.overlay;
    overlay.classList.remove('visible');

    setTimeout(() => {
      overlay.remove();
      onboardingWizard.overlay = null;

      if (onboardingWizard.resolve) {
        onboardingWizard.resolve();
      }
    }, 400);
  }
}

// Export wizard functions for onclick handlers
window.nextWizardStep = nextWizardStep;
window.prevWizardStep = prevWizardStep;
window.handleSkipOnboarding = handleSkipOnboarding;
window.useAddressAsRouteStart = useAddressAsRouteStart;
window.completeOnboardingWizard = completeOnboardingWizard;

// Pagination for preview table
function wizardPreviewTablePage(page) {
  wizardImportState.previewTablePage = Math.max(0, page);
  updateWizardImportContent();
}

// Toggle before/after transformation view in preview
function wizardToggleBeforeAfter(show) {
  wizardImportState.previewShowBeforeAfter = show;
  updateWizardImportContent();
}

// Export wizard import functions for onclick handlers
window.skipWizardImport = skipWizardImport;
window.wizardImportBack = wizardImportBack;
window.wizardImportNext = wizardImportNext;
window.wizardStartImport = wizardStartImport;
window.wizardRollbackImport = wizardRollbackImport;
window.wizardReimportFailed = wizardReimportFailed;
window.wizardDownloadErrorReport = wizardDownloadErrorReport;
window.wizardFixAllSimilar = wizardFixAllSimilar;
window.wizardDeselectErrorRows = wizardDeselectErrorRows;
window.wizardImportComplete = wizardImportComplete;
window.wizardImportRetry = wizardImportRetry;
window.updateWizardMapping = updateWizardMapping;
window.updateWizardCategoryMapping = updateWizardCategoryMapping;
window.wizardPreviewTablePage = wizardPreviewTablePage;
window.wizardToggleBeforeAfter = wizardToggleBeforeAfter;

// ========================================
// CONTEXT TIPS - First-time user guidance
// ========================================

const contextTips = {
  tips: [
    {
      id: 'map-intro',
      target: '#map',
      title: 'Interaktivt kart',
      message: 'Her ser du alle kundene dine på kartet. Klikk på en markør for å se detaljer.',
      position: 'top',
      icon: 'fa-map-marked-alt'
    },
    {
      id: 'add-customer',
      target: '.customer-add-btn, .add-client-btn, #addClientBtn',
      title: 'Legg til kunder',
      message: 'Klikk her for å legge til din første kunde.',
      position: 'bottom',
      icon: 'fa-user-plus'
    },
    {
      id: 'route-planning',
      target: '.route-btn, #routeBtn, [data-action="route"]',
      title: 'Ruteplanlegging',
      message: 'Planlegg effektive ruter mellom kundene dine.',
      position: 'bottom',
      icon: 'fa-route'
    },
    {
      id: 'calendar',
      target: '.calendar-btn, #calendarBtn, [data-view="calendar"]',
      title: 'Kalender',
      message: 'Hold oversikt over avtaler og oppgaver i kalenderen.',
      position: 'bottom',
      icon: 'fa-calendar-alt'
    }
  ],
  shownTips: [],
  currentTipIndex: 0,
  tipOverlay: null
};

// Initialize context tips
function initContextTips() {
  const stored = localStorage.getItem('shownContextTips');
  if (stored) {
    try {
      contextTips.shownTips = JSON.parse(stored);
    } catch (e) {
      contextTips.shownTips = [];
    }
  }
}

// Show context tips for first-time users
function showContextTips() {
  initContextTips();

  // Filter tips that haven't been shown
  const unshownTips = contextTips.tips.filter(tip => !contextTips.shownTips.includes(tip.id));

  if (unshownTips.length === 0) return;

  // Show first unshown tip after a delay
  setTimeout(() => {
    showTip(unshownTips[0]);
  }, 1000);
}

// Show a single tip
function showTip(tip) {
  const target = document.querySelector(tip.target);
  if (!target) {
    // Target not found, mark as shown and try next
    markTipAsShown(tip.id);
    showNextTip();
    return;
  }

  // Create tip overlay
  const overlay = document.createElement('div');
  overlay.className = 'context-tip-overlay';
  overlay.innerHTML = `
    <div class="context-tip-backdrop" onclick="dismissCurrentTip()"></div>
    <div class="context-tip" id="contextTip-${tip.id}">
      <div class="context-tip-arrow"></div>
      <div class="context-tip-icon">
        <i class="fas ${tip.icon}"></i>
      </div>
      <div class="context-tip-content">
        <h4>${escapeHtml(tip.title)}</h4>
        <p>${escapeHtml(tip.message)}</p>
      </div>
      <div class="context-tip-actions">
        <button class="context-tip-btn context-tip-btn-skip" onclick="skipAllTips()">
          Hopp over alle
        </button>
        <button class="context-tip-btn context-tip-btn-next" onclick="dismissCurrentTip()">
          Forstått <i class="fas fa-check"></i>
        </button>
      </div>
      <div class="context-tip-progress">
        ${contextTips.currentTipIndex + 1} av ${contextTips.tips.length - contextTips.shownTips.length}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  contextTips.tipOverlay = overlay;

  // Position the tip near the target
  positionTip(overlay.querySelector('.context-tip'), target, tip.position);

  // Highlight target
  target.classList.add('context-tip-highlight');

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
  });
}

// Position tip relative to target
function positionTip(tipElement, target, position) {
  const targetRect = target.getBoundingClientRect();
  const tipRect = tipElement.getBoundingClientRect();

  let top, left;
  const margin = 12;

  switch (position) {
    case 'top':
      top = targetRect.top - tipRect.height - margin;
      left = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);
      tipElement.classList.add('position-top');
      break;
    case 'bottom':
      top = targetRect.bottom + margin;
      left = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);
      tipElement.classList.add('position-bottom');
      break;
    case 'left':
      top = targetRect.top + (targetRect.height / 2) - (tipRect.height / 2);
      left = targetRect.left - tipRect.width - margin;
      tipElement.classList.add('position-left');
      break;
    case 'right':
      top = targetRect.top + (targetRect.height / 2) - (tipRect.height / 2);
      left = targetRect.right + margin;
      tipElement.classList.add('position-right');
      break;
    default:
      top = targetRect.bottom + margin;
      left = targetRect.left;
  }

  // Keep within viewport
  left = Math.max(16, Math.min(left, window.innerWidth - tipRect.width - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - tipRect.height - 16));

  tipElement.style.position = 'fixed';
  tipElement.style.top = `${top}px`;
  tipElement.style.left = `${left}px`;
}

// Mark tip as shown
function markTipAsShown(tipId) {
  if (!contextTips.shownTips.includes(tipId)) {
    contextTips.shownTips.push(tipId);
    localStorage.setItem('shownContextTips', JSON.stringify(contextTips.shownTips));
  }
}

// Dismiss current tip and show next
function dismissCurrentTip() {
  const unshownTips = contextTips.tips.filter(tip => !contextTips.shownTips.includes(tip.id));

  if (unshownTips.length > 0) {
    markTipAsShown(unshownTips[0].id);
  }

  // Remove highlight from all elements
  document.querySelectorAll('.context-tip-highlight').forEach(el => {
    el.classList.remove('context-tip-highlight');
  });

  // Remove overlay
  if (contextTips.tipOverlay) {
    contextTips.tipOverlay.classList.remove('visible');
    setTimeout(() => {
      contextTips.tipOverlay.remove();
      contextTips.tipOverlay = null;
      showNextTip();
    }, 300);
  }
}

// Show next tip
function showNextTip() {
  contextTips.currentTipIndex++;
  const unshownTips = contextTips.tips.filter(tip => !contextTips.shownTips.includes(tip.id));

  if (unshownTips.length > 0) {
    setTimeout(() => showTip(unshownTips[0]), 500);
  }
}

// Skip all tips
function skipAllTips() {
  contextTips.tips.forEach(tip => {
    markTipAsShown(tip.id);
  });

  // Remove highlight from all elements
  document.querySelectorAll('.context-tip-highlight').forEach(el => {
    el.classList.remove('context-tip-highlight');
  });

  if (contextTips.tipOverlay) {
    contextTips.tipOverlay.classList.remove('visible');
    setTimeout(() => {
      contextTips.tipOverlay.remove();
      contextTips.tipOverlay = null;
    }, 300);
  }
}

// Reset context tips (for testing)
function resetContextTips() {
  contextTips.shownTips = [];
  contextTips.currentTipIndex = 0;
  localStorage.removeItem('shownContextTips');
}


// Apply industry changes to entire UI
function applyIndustryChanges() {
  Logger.log('Applying industry changes...');

  // Update login page features to match current industry
  renderLoginFeatures();

  // Update category tabs in customer admin view
  const kategoriTabs = document.getElementById('kategoriTabs');
  if (kategoriTabs) {
    kategoriTabs.innerHTML = serviceTypeRegistry.renderCategoryTabs(selectedCategory);
    // Re-attach click handlers
    attachKategoriTabHandlers();
  }

  // Update filter panel categories (right side panel)
  renderFilterPanelCategories();
  renderDriftskategoriFilter();

  // Apply MVP mode UI changes (hide industry-specific elements)
  applyMvpModeUI();

  // Update all dropdowns that depend on service types
  updateServiceTypeDropdowns();

  // Update map legend
  updateMapLegend();

  // Apply dynamic CSS colors for service types
  applyIndustryColors();

  // Refresh markers with new colors/icons
  if (customers && customers.length > 0) {
    renderMarkers(customers);
    renderCustomerAdmin();

    // Check for customers with unknown categories and show notification
    const unknownCategoryCount = customers.filter(c =>
      c.kategori && !serviceTypeRegistry.isKnownCategory(c.kategori)
    ).length;

    if (unknownCategoryCount > 0) {
      showUnknownCategoryNotification(unknownCategoryCount);
    }
  }

  // Update branding (titles, features, etc.) to match new industry
  applyBranding();

  Logger.log('Industry changes applied');
}

// Show notification about customers with unknown categories
function showUnknownCategoryNotification(count) {
  // Remove existing notification if present
  const existingNotification = document.getElementById('unknownCategoryNotification');
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement('div');
  notification.id = 'unknownCategoryNotification';
  notification.className = 'unknown-category-notification';
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fas fa-exclamation-triangle"></i>
      <span><strong>${count}</strong> kunde${count > 1 ? 'r' : ''} har kategorier fra tidligere bransje og m&aring; oppdateres.</span>
      <button class="btn-close-notification" onclick="this.parentElement.parentElement.remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;

  // Insert after header or at top of main content
  const mainContent = document.querySelector('.content') || document.querySelector('main') || document.body;
  mainContent.insertBefore(notification, mainContent.firstChild);

  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }
  }, 10000);
}

// Attach click handlers to kategori tabs
function attachKategoriTabHandlers() {
  const tabs = document.querySelectorAll('#kategoriTabs .category-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedCategory = tab.dataset.category || 'all';
      applyFilters();
    });
  });
}

// Update all dropdowns that depend on service types
function updateServiceTypeDropdowns() {
  // Customer modal category dropdown
  const kategoriSelect = document.getElementById('kategori');
  if (kategoriSelect) {
    const currentValue = kategoriSelect.value;
    const serviceTypes = serviceTypeRegistry.getAll();
    let options = '';

    serviceTypes.forEach(st => {
      options += `<option value="${st.name}">${st.name}</option>`;
    });

    // Add combined option if there are multiple service types
    if (serviceTypes.length >= 2) {
      const combinedName = serviceTypes.map(st => st.name).join(' + ');
      options += `<option value="${combinedName}">Begge (${combinedName})</option>`;
    }

    kategoriSelect.innerHTML = options;

    // Try to restore previous value
    if (currentValue) {
      kategoriSelect.value = currentValue;
    }
  }
}

// Apply dynamic CSS variables for industry service type colors
function applyIndustryColors() {
  const serviceTypes = serviceTypeRegistry.getAll();
  const root = document.documentElement;

  serviceTypes.forEach((st) => {
    root.style.setProperty(`--service-color-${st.slug}`, st.color);
  });

  // For combined markers - gradient of first two service types
  if (serviceTypes.length >= 2) {
    const gradient = `linear-gradient(135deg, ${serviceTypes[0].color} 50%, ${serviceTypes[1].color} 50%)`;
    root.style.setProperty('--service-color-combined', gradient);
  }

  // Inject dynamic marker CSS styles based on loaded service types
  injectDynamicMarkerStyles();
}

/**
 * Darken a hex color by a percentage
 * @param {string} hex - Hex color code (with or without #)
 * @param {number} percent - Percentage to darken (0-100)
 * @returns {string} Darkened hex color
 */
function darkenColor(hex, percent) {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Darken
  r = Math.max(0, Math.floor(r * (1 - percent / 100)));
  g = Math.max(0, Math.floor(g * (1 - percent / 100)));
  b = Math.max(0, Math.floor(b * (1 - percent / 100)));

  // Convert back to hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Inject dynamic CSS for marker category styles based on loaded service types
 * Uses premium 3-layer gradients and sophisticated shadows for professional look
 */
function injectDynamicMarkerStyles() {
  // Remove any previously injected dynamic styles
  const existingStyle = document.getElementById('dynamic-marker-styles');
  if (existingStyle) {
    existingStyle.remove();
  }

  const serviceTypes = serviceTypeRegistry.getAll();
  if (serviceTypes.length === 0) return;

  const styleElement = document.createElement('style');
  styleElement.id = 'dynamic-marker-styles';

  let css = '';

  // Generate premium styles for each service type
  serviceTypes.forEach((st) => {
    // Use premium palette if available, otherwise calculate colors
    const palette = industryPalettes[st.slug] || {
      light: st.color,
      primary: st.color,
      dark: darkenColor(st.color, 20)
    };

    // Premium 3-layer gradient with inner highlight
    css += `
      /* Premium marker style for ${st.name} */
      .custom-marker-with-label .marker-icon.${st.slug} {
        background: linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%);
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.25);
      }

      .custom-marker-with-label .marker-icon.${st.slug}[data-status="forfalt"] {
        background: linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%) !important;
      }

      .custom-marker-with-label .marker-icon.${st.slug}[data-status="snart"] {
        background: linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%) !important;
      }
    `;
  });

  // Generate combined style if multiple service types exist
  if (serviceTypes.length >= 2) {
    const palette1 = industryPalettes[serviceTypes[0].slug] || { primary: serviceTypes[0].color };
    const palette2 = industryPalettes[serviceTypes[1].slug] || { primary: serviceTypes[1].color };
    const color1 = palette1.primary;
    const color2 = palette2.primary;

    css += `
      /* Premium combined marker style */
      .custom-marker-with-label .marker-icon.combined {
        width: 48px;
        height: 48px;
        min-width: 48px;
        min-height: 48px;
        background: linear-gradient(135deg, ${color1} 0%, ${color1} 48%, ${color2} 52%, ${color2} 100%);
        font-size: 15px;
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      .custom-marker-with-label .marker-icon.combined[data-status="forfalt"] {
        background: linear-gradient(135deg, ${color1} 0%, ${color1} 48%, ${color2} 52%, ${color2} 100%) !important;
      }

      .custom-marker-with-label .marker-icon.combined[data-status="snart"] {
        background: linear-gradient(135deg, ${color1} 0%, ${color1} 48%, ${color2} 52%, ${color2} 100%) !important;
      }
    `;
  }

  styleElement.textContent = css;
  document.head.appendChild(styleElement);

  Logger.log('Premium marker styles injected for', serviceTypes.length, 'service types');
}

// Update map legend for current industry with premium styling
function updateMapLegend() {
  const legendItems = document.getElementById('legendItems');
  if (!legendItems) return;

  const serviceTypes = serviceTypeRegistry.getAll();

  if (serviceTypes.length === 0) {
    legendItems.innerHTML = '<div class="legend-item"><span class="legend-color" style="background: linear-gradient(135deg, #FBBF24, #D97706)"></span> Kunde</div>';
    return;
  }

  // Use premium palettes for legend
  legendItems.innerHTML = serviceTypes.map(st => {
    const palette = industryPalettes[st.slug] || { light: st.color, primary: st.color, dark: st.color };
    const gradient = `linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%)`;
    return `
      <div class="legend-item">
        <span class="legend-color" style="background: ${gradient}"></span>
        <span>${st.name}</span>
      </div>
    `;
  }).join('');

  // Add combined if multiple service types
  if (serviceTypes.length >= 2) {
    const palette1 = industryPalettes[serviceTypes[0].slug] || { primary: serviceTypes[0].color };
    const palette2 = industryPalettes[serviceTypes[1].slug] || { primary: serviceTypes[1].color };
    const combinedGradient = `linear-gradient(135deg, ${palette1.primary} 48%, ${palette2.primary} 52%)`;
    const combinedName = serviceTypes.map(st => escapeHtml(st.name)).join(' + ');
    legendItems.innerHTML += `
      <div class="legend-item">
        <span class="legend-color" style="background: ${combinedGradient}"></span>
        <span>${combinedName}</span>
      </div>
    `;
  }
}

// Toggle map legend visibility
function toggleMapLegend() {
  const legend = document.getElementById('mapLegend');
  if (legend) {
    legend.classList.toggle('expanded');
  }
}

// Simple toast notification
function showToast(message, type = 'info') {
  // Remove existing toast
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.innerHTML = `
    <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Initialize misc event listeners
function initMiscEventListeners() {
  // Excel/CSV Import functionality
  initExcelImport();

  // Map legend toggle
  const legendToggle = document.getElementById('legendToggle');
  if (legendToggle) {
    legendToggle.addEventListener('click', toggleMapLegend);
  }
}

/**
 * Enhanced Excel/CSV import functionality with wizard UI
 */
function initExcelImport() {
  // State
  const importState = {
    sessionId: null,
    previewData: null,
    columnMapping: {},
    categoryMapping: {},
    currentPage: 0,
    rowsPerPage: 50,
    validCategories: []
  };

  // Elements
  const dropzone = document.getElementById('importDropzone');
  const fileInput = document.getElementById('importFileInput');
  const steps = {
    step1: document.getElementById('importStep1'),
    step2: document.getElementById('importStep2'),
    step3: document.getElementById('importStep3'),
    step4: document.getElementById('importStep4')
  };

  if (!dropzone || !fileInput) return;

  // Step navigation
  function showStep(stepNum) {
    // Hide all steps
    Object.values(steps).forEach(step => {
      if (step) step.classList.add('hidden');
    });

    // Show target step
    const targetStep = steps[`step${stepNum}`];
    if (targetStep) targetStep.classList.remove('hidden');

    // Update step indicator
    document.querySelectorAll('.step-item').forEach(item => {
      const itemStep = parseInt(item.dataset.step);
      item.classList.remove('active', 'completed');
      if (itemStep < stepNum) item.classList.add('completed');
      if (itemStep === stepNum) item.classList.add('active');
    });
  }

  // File selection handlers
  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileSelect(fileInput.files[0]);
    }
  });

  async function handleFileSelect(file) {
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

    if (!validExtensions.includes(ext)) {
      showNotification('Ugyldig filtype. Kun Excel (.xlsx, .xls) og CSV (.csv) er tillatt.', 'error');
      return;
    }

    // Show loading state
    dropzone.innerHTML = `
      <i class="fas fa-spinner fa-spin"></i>
      <p>Analyserer fil...</p>
      <span class="import-formats">${file.name}</span>
    `;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await apiFetch('/api/kunder/import-excel/preview', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        importState.sessionId = data.sessionId;
        importState.previewData = data;
        importState.validCategories = data.validCategories || [];

        // Initialize column mapping from detected columns
        importState.columnMapping = {};
        data.columns.detected.forEach(col => {
          if (col.suggestedMapping) {
            importState.columnMapping[col.excelHeader] = col.suggestedMapping;
          }
        });

        renderColumnMapping(data);
        showStep(2);
      } else {
        throw new Error(data.error || 'Kunne ikke analysere filen');
      }
    } catch (error) {
      showNotification(error.message, 'error');
      resetDropzone();
    }
  }

  function resetDropzone() {
    dropzone.innerHTML = `
      <i class="fas fa-cloud-upload-alt"></i>
      <p>Dra og slipp fil her, eller klikk for å velge</p>
      <span class="import-formats">Støttede formater: .xlsx, .xls, .csv (maks 10MB)</span>
    `;
    fileInput.value = '';
  }

  function resetImport() {
    importState.sessionId = null;
    importState.previewData = null;
    importState.columnMapping = {};
    importState.categoryMapping = {};
    importState.currentPage = 0;
    resetDropzone();
    showStep(1);
  }

  // Column mapping UI
  function renderColumnMapping(data) {
    const container = document.getElementById('columnMappingContainer');
    if (!container) return;

    const dbFields = [
      { value: '', label: '-- Ignorer --' },
      { value: 'navn', label: 'Navn *', required: true },
      { value: 'adresse', label: 'Adresse *', required: true },
      { value: 'postnummer', label: 'Postnummer' },
      { value: 'poststed', label: 'Poststed' },
      { value: 'telefon', label: 'Telefon' },
      { value: 'epost', label: 'E-post' },
      { value: 'kategori', label: 'Kategori' },
      { value: 'el_type', label: 'El-type' },
      { value: 'brann_system', label: 'Brannsystem' },
      { value: 'brann_driftstype', label: 'Driftstype' },
      { value: 'notater', label: 'Notater' },
      { value: 'lat', label: 'Breddegrad' },
      { value: 'lng', label: 'Lengdegrad' }
    ];

    container.innerHTML = data.columns.detected.map(col => `
      <div class="mapping-row">
        <div class="mapping-excel">
          <strong>${escapeHtml(col.excelHeader)}</strong>
          <span class="sample-values">${col.sampleValues.map(v => escapeHtml(v)).join(', ') || 'Ingen verdier'}</span>
        </div>
        <i class="fas fa-arrow-right mapping-arrow"></i>
        <div class="mapping-db">
          <select class="column-select" data-excel="${escapeHtml(col.excelHeader)}">
            ${dbFields.map(f => `
              <option value="${f.value}" ${col.suggestedMapping === f.value ? 'selected' : ''}>
                ${f.label}
              </option>
            `).join('')}
          </select>
          ${col.confidence < 1 && col.suggestedMapping ?
            `<span class="confidence-badge">${Math.round(col.confidence * 100)}%</span>` : ''}
        </div>
      </div>
    `).join('');

    // Add change listeners
    container.querySelectorAll('.column-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const excelCol = e.target.dataset.excel;
        importState.columnMapping[excelCol] = e.target.value;
      });
    });
  }

  // Preview table
  function renderPreview(data) {
    const analysis = data.analysis;

    // Update summary cards
    document.getElementById('newCount').textContent = analysis.toCreate || 0;
    document.getElementById('updateCount').textContent = analysis.toUpdate || 0;
    document.getElementById('warningCount').textContent = analysis.warningRows || 0;
    document.getElementById('errorCount').textContent = analysis.errorRows || 0;

    // Update import button count
    const importableCount = (analysis.toCreate || 0) + (analysis.toUpdate || 0);
    document.getElementById('importCountLabel').textContent = importableCount;

    // Render category mapping if needed
    renderCategoryMapping(data.categoryAnalysis);

    // Render dynamic schema suggestions
    renderDynamicSchema(data.dynamicSchema);

    // Render preview table
    renderPreviewTable(data.previewData);
  }

  function renderCategoryMapping(categoryAnalysis) {
    const section = document.getElementById('categoryMappingSection');
    const list = document.getElementById('categoryMappingList');

    if (!categoryAnalysis || categoryAnalysis.unknown.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    list.innerHTML = categoryAnalysis.unknown.map(item => `
      <div class="category-mapping-row">
        <span class="original-value">"${escapeHtml(item.value)}"</span>
        <span class="occurrence-count">(${item.count} forekomster)</span>
        <select class="category-select" data-original="${escapeHtml(item.value)}">
          <option value="">-- Velg kategori --</option>
          ${importState.validCategories.map(cat => `
            <option value="${cat}">${cat}</option>
          `).join('')}
        </select>
      </div>
    `).join('');

    // Add change listeners
    list.querySelectorAll('.category-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const originalValue = e.target.dataset.original;
        importState.categoryMapping[originalValue] = e.target.value;
      });
    });
  }

  // Render dynamic schema suggestions from Excel analysis
  function renderDynamicSchema(dynamicSchema) {
    const section = document.getElementById('dynamicSchemaSection');
    const newCategoriesSection = document.getElementById('newCategoriesSection');
    const newFieldsSection = document.getElementById('newFieldsSection');
    const newFieldValuesSection = document.getElementById('newFieldValuesSection');

    if (!section || !dynamicSchema) {
      if (section) section.classList.add('hidden');
      return;
    }

    const hasNewCategories = dynamicSchema.newCategories && dynamicSchema.newCategories.length > 0;
    const hasNewFields = dynamicSchema.newFields && dynamicSchema.newFields.length > 0;
    const hasNewFieldValues = dynamicSchema.newFieldValues && Object.keys(dynamicSchema.newFieldValues).length > 0;

    // Hide if nothing to show
    if (!hasNewCategories && !hasNewFields && !hasNewFieldValues) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');

    // Initialize state for tracking selections
    importState.dynamicSchema = {
      selectedCategories: {},
      selectedFields: {},
      selectedFieldValues: {}
    };

    // Render new categories
    if (hasNewCategories) {
      newCategoriesSection.classList.remove('hidden');
      const list = document.getElementById('newCategoriesList');
      list.innerHTML = dynamicSchema.newCategories.map((cat, idx) => `
        <div class="schema-item">
          <input type="checkbox" class="schema-item-checkbox" id="newCat_${idx}" data-category="${escapeHtml(cat.name)}" checked>
          <div class="schema-item-color" style="background-color: ${cat.color}"></div>
          <div class="schema-item-icon">
            <i class="fas ${cat.icon}"></i>
          </div>
          <div class="schema-item-info">
            <label for="newCat_${idx}" class="schema-item-name">${escapeHtml(cat.name)}</label>
            <div class="schema-item-meta">Intervall: ${cat.default_interval_months || 12} mnd</div>
          </div>
        </div>
      `).join('');

      // Track selections
      list.querySelectorAll('.schema-item-checkbox').forEach(checkbox => {
        const catName = checkbox.dataset.category;
        importState.dynamicSchema.selectedCategories[catName] = checkbox.checked;
        checkbox.addEventListener('change', (e) => {
          importState.dynamicSchema.selectedCategories[catName] = e.target.checked;
        });
      });
    } else {
      newCategoriesSection.classList.add('hidden');
    }

    // Render new fields
    if (hasNewFields) {
      newFieldsSection.classList.remove('hidden');
      const list = document.getElementById('newFieldsList');
      list.innerHTML = dynamicSchema.newFields.map((field, idx) => `
        <div class="schema-item">
          <input type="checkbox" class="schema-item-checkbox" id="newField_${idx}" data-field="${escapeHtml(field.field_name)}" checked>
          <div class="schema-item-info">
            <label for="newField_${idx}" class="schema-item-name">${escapeHtml(field.display_name)}</label>
            <div class="schema-item-meta">
              <span class="schema-field-type">${field.field_type}</span>
              ${field.is_filterable ? '<span class="schema-field-type" style="background: #10B981;">Filtrerbart</span>' : ''}
            </div>
            ${field.options && field.options.length > 0 ? `
              <div class="schema-item-preview">
                ${field.options.slice(0, 5).map(opt => `
                  <span class="schema-item-preview-tag">${escapeHtml(opt.value || opt)}</span>
                `).join('')}
                ${field.options.length > 5 ? `<span class="schema-item-preview-tag">+${field.options.length - 5} mer</span>` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      `).join('');

      // Track selections
      list.querySelectorAll('.schema-item-checkbox').forEach(checkbox => {
        const fieldName = checkbox.dataset.field;
        importState.dynamicSchema.selectedFields[fieldName] = checkbox.checked;
        checkbox.addEventListener('change', (e) => {
          importState.dynamicSchema.selectedFields[fieldName] = e.target.checked;
        });
      });
    } else {
      newFieldsSection.classList.add('hidden');
    }

    // Render new field values
    if (hasNewFieldValues) {
      newFieldValuesSection.classList.remove('hidden');
      const list = document.getElementById('newFieldValuesList');
      const entries = Object.entries(dynamicSchema.newFieldValues);

      list.innerHTML = entries.map(([fieldName, values], idx) => `
        <div class="schema-item">
          <input type="checkbox" class="schema-item-checkbox" id="newValues_${idx}" data-field="${escapeHtml(fieldName)}" checked>
          <div class="schema-item-info">
            <label for="newValues_${idx}" class="schema-item-name">${escapeHtml(fieldName)}</label>
            <div class="schema-item-preview">
              ${values.slice(0, 5).map(v => `
                <span class="schema-item-preview-tag">${escapeHtml(v)}</span>
              `).join('')}
              ${values.length > 5 ? `<span class="schema-item-preview-tag">+${values.length - 5} mer</span>` : ''}
            </div>
          </div>
        </div>
      `).join('');

      // Track selections
      list.querySelectorAll('.schema-item-checkbox').forEach(checkbox => {
        const fieldName = checkbox.dataset.field;
        importState.dynamicSchema.selectedFieldValues[fieldName] = checkbox.checked;
        checkbox.addEventListener('change', (e) => {
          importState.dynamicSchema.selectedFieldValues[fieldName] = e.target.checked;
        });
      });
    } else {
      newFieldValuesSection.classList.add('hidden');
    }
  }

  function renderPreviewTable(rows) {
    const thead = document.getElementById('previewTableHead');
    const tbody = document.getElementById('previewTableBody');

    if (!rows || rows.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td colspan="5">Ingen data</td></tr>';
      return;
    }

    // Headers
    thead.innerHTML = `
      <tr>
        <th>Rad</th>
        <th>Status</th>
        <th>Navn</th>
        <th>Adresse</th>
        <th>Info</th>
      </tr>
    `;

    // Paginate
    const start = importState.currentPage * importState.rowsPerPage;
    const pageRows = rows.slice(start, start + importState.rowsPerPage);

    tbody.innerHTML = pageRows.map(row => {
      const statusClass = {
        'valid': 'status-new',
        'warning': 'status-warning',
        'error': 'status-error',
        'duplicate': 'status-update'
      }[row.status] || '';

      const statusIcon = {
        'valid': '<i class="fas fa-plus-circle"></i>',
        'warning': '<i class="fas fa-exclamation-triangle"></i>',
        'error': '<i class="fas fa-times-circle"></i>',
        'duplicate': '<i class="fas fa-sync-alt"></i>'
      }[row.status] || '';

      const statusText = {
        'valid': 'Ny',
        'warning': 'Advarsel',
        'error': 'Feil',
        'duplicate': 'Oppdateres'
      }[row.status] || row.status;

      return `
        <tr class="${statusClass}">
          <td>${row.rowNumber}</td>
          <td><span class="status-badge ${statusClass}">${statusIcon} ${statusText}</span></td>
          <td>${escapeHtml(row.normalizedData?.navn || '-')}</td>
          <td>${escapeHtml(row.normalizedData?.adresse || '-')}</td>
          <td class="info-cell">
            ${row.issues.length > 0 ?
              `<span class="issues-tooltip" title="${row.issues.map(i => escapeHtml(i)).join('\n')}">
                <i class="fas fa-info-circle"></i> ${row.issues.length} melding${row.issues.length > 1 ? 'er' : ''}
              </span>` : '-'}
          </td>
        </tr>
      `;
    }).join('');

    // Update pagination
    updatePagination(rows.length);
  }

  function updatePagination(totalRows) {
    const totalPages = Math.ceil(totalRows / importState.rowsPerPage);
    const currentPage = importState.currentPage + 1;

    document.getElementById('pageInfo').textContent = `Side ${currentPage} av ${totalPages}`;
    document.getElementById('prevPageBtn').disabled = importState.currentPage === 0;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
  }

  // Pagination handlers
  document.getElementById('prevPageBtn')?.addEventListener('click', () => {
    if (importState.currentPage > 0) {
      importState.currentPage--;
      renderPreviewTable(importState.previewData.previewData);
    }
  });

  document.getElementById('nextPageBtn')?.addEventListener('click', () => {
    const totalPages = Math.ceil(importState.previewData.previewData.length / importState.rowsPerPage);
    if (importState.currentPage < totalPages - 1) {
      importState.currentPage++;
      renderPreviewTable(importState.previewData.previewData);
    }
  });

  // Navigation buttons
  document.getElementById('backToStep1Btn')?.addEventListener('click', resetImport);

  document.getElementById('proceedToStep3Btn')?.addEventListener('click', () => {
    // Validate required mappings
    const hasNavn = Object.values(importState.columnMapping).includes('navn');
    const hasAdresse = Object.values(importState.columnMapping).includes('adresse');

    if (!hasNavn || !hasAdresse) {
      showNotification('Du må mappe minst "Navn" og "Adresse" kolonnene.', 'error');
      return;
    }

    renderPreview(importState.previewData);
    showStep(3);
  });

  document.getElementById('backToStep2Btn')?.addEventListener('click', () => {
    showStep(2);
  });

  // Execute import
  document.getElementById('startImportBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('startImportBtn');
    btn.disabled = true;

    showStep(4);
    document.getElementById('importProgress').classList.remove('hidden');
    document.getElementById('importResult').classList.add('hidden');

    const progressFill = document.getElementById('importProgressFill');
    const progressText = document.getElementById('importProgressText');

    progressFill.style.width = '5%';
    progressText.textContent = 'Oppretter nye kategorier og felt...';

    try {
      // First, create selected dynamic schema items
      if (importState.dynamicSchema) {
        const dynamicSchema = importState.previewData?.dynamicSchema;

        // Create selected categories
        const selectedCategories = dynamicSchema?.newCategories?.filter(cat =>
          importState.dynamicSchema.selectedCategories[cat.name]
        ) || [];

        if (selectedCategories.length > 0) {
          progressText.textContent = `Oppretter ${selectedCategories.length} nye kategorier...`;
          for (const cat of selectedCategories) {
            try {
              await apiFetch('/api/service-types', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: cat.name,
                  icon: cat.icon || 'fa-wrench',
                  color: cat.color || '#F97316',
                  default_interval_months: cat.default_interval_months || 12,
                })
              });
            } catch (catError) {
              console.warn(`Could not create category ${cat.name}:`, catError);
            }
          }
          await loadOrganizationCategories();
          renderFilterPanelCategories();
        }

        progressFill.style.width = '10%';

        // Create selected fields
        const selectedFields = dynamicSchema?.newFields?.filter(field =>
          importState.dynamicSchema.selectedFields[field.field_name]
        ) || [];

        if (selectedFields.length > 0) {
          progressText.textContent = `Oppretter ${selectedFields.length} nye felt...`;
          try {
            await apiFetch('/api/fields/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: selectedFields })
            });
          } catch (fieldError) {
            console.warn('Could not create fields:', fieldError);
          }
        }

        progressFill.style.width = '15%';
      }

      progressFill.style.width = '20%';
      progressText.textContent = 'Starter kundeimport...';

      const response = await apiFetch('/api/kunder/import-excel/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: importState.sessionId,
          categoryMapping: importState.categoryMapping,
          geocodeAfterImport: document.getElementById('geocodeAfterImport')?.checked || false
        })
      });

      progressFill.style.width = '90%';
      progressText.textContent = 'Fullfører...';

      const data = await response.json();

      progressFill.style.width = '100%';

      // Show result
      setTimeout(() => {
        document.getElementById('importProgress').classList.add('hidden');
        document.getElementById('importResult').classList.remove('hidden');
        showImportResult(response.ok && data.success, data);

        if (response.ok && data.success) {
          loadCustomers();
        }
      }, 500);

    } catch (error) {
      document.getElementById('importProgress').classList.add('hidden');
      document.getElementById('importResult').classList.remove('hidden');
      showImportResult(false, { error: error.message });
    }

    btn.disabled = false;
  });

  function showImportResult(success, data) {
    const icon = document.getElementById('resultIcon');
    const title = document.getElementById('importResultTitle');

    if (success) {
      icon.innerHTML = '<i class="fas fa-check-circle"></i>';
      icon.className = 'result-icon success';
      title.textContent = 'Import fullført!';

      document.getElementById('resultCreated').textContent = data.created || 0;
      document.getElementById('resultUpdated').textContent = data.updated || 0;
      document.getElementById('resultSkipped').textContent = data.skipped || 0;

      // Show errors if any
      const errorsSection = document.getElementById('resultErrors');
      const errorList = document.getElementById('errorList');
      if (data.errors && data.errors.length > 0) {
        errorsSection.classList.remove('hidden');
        errorList.innerHTML = data.errors.slice(0, 10).map(e =>
          `<li>Rad ${e.row}: ${escapeHtml(e.navn || '')} - ${escapeHtml(e.error)}</li>`
        ).join('');
        if (data.errors.length > 10) {
          errorList.innerHTML += `<li>... og ${data.errors.length - 10} flere</li>`;
        }
      } else {
        errorsSection.classList.add('hidden');
      }

      // Show geocoding note
      const noteEl = document.getElementById('resultNote');
      if (data.geocodingNote) {
        noteEl.textContent = data.geocodingNote;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    } else {
      icon.innerHTML = '<i class="fas fa-times-circle"></i>';
      icon.className = 'result-icon error';
      title.textContent = 'Import feilet';

      document.getElementById('resultCreated').textContent = '0';
      document.getElementById('resultUpdated').textContent = '0';
      document.getElementById('resultSkipped').textContent = '0';

      const noteEl = document.getElementById('resultNote');
      noteEl.textContent = data.error || 'En ukjent feil oppstod.';
      noteEl.classList.remove('hidden');
    }
  }

  // Close result
  document.getElementById('closeImportResultBtn')?.addEventListener('click', resetImport);

  // Helper function
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
}

// Transition from login to app view with smooth animations
// Single map architecture: map never changes, only UI overlays animate
function transitionToAppView() {
  const loginOverlay = document.getElementById('loginOverlay');
  const appView = document.getElementById('appView');
  const sidebar = document.getElementById('sidebar');
  const filterPanel = document.getElementById('filterPanel');
  const loginSide = document.querySelector('.login-side');
  const loginBrandContent = document.querySelector('.login-brand-content');
  const loginMapOverlay = document.querySelector('.login-map-overlay');

  // Show user bar
  showUserBar();

  // Start proactive token refresh
  setupTokenRefresh();

  // Always show app view and prepare for animation
  appView.classList.remove('hidden');

  // Pre-position sidebar and filter for animation (every time)
  if (sidebar) {
    sidebar.style.transform = 'translateX(-100%)';
    sidebar.style.opacity = '0';
  }
  if (filterPanel) {
    filterPanel.style.transform = 'translateX(100%)';
    filterPanel.style.opacity = '0';
  }

  // Pre-position content panel if it should be open (from localStorage)
  const contentPanel = document.getElementById('contentPanel');
  const shouldOpenPanel = localStorage.getItem('contentPanelOpen') === 'true';
  if (shouldOpenPanel && contentPanel) {
    contentPanel.style.transform = 'translateX(-100%)';
    contentPanel.style.opacity = '0';
    contentPanel.classList.remove('closed');
    contentPanel.classList.add('open');
  }

  // Set currentView to 'app' BEFORE loading customers (so renderMarkers isn't blocked)
  currentView = 'app';

  // PHASE 1: Slide out login form (left side)
  if (loginSide) {
    loginSide.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease-out';
    loginSide.style.transform = 'translateX(-100%)';
    loginSide.style.opacity = '0';
  }

  // PHASE 2: Fade out brand content and gradient overlay
  setTimeout(() => {
    if (loginBrandContent) {
      loginBrandContent.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
      loginBrandContent.style.opacity = '0';
      loginBrandContent.style.transform = 'translateY(-30px)';
    }
    if (loginMapOverlay) {
      loginMapOverlay.style.transition = 'opacity 0.6s ease-out';
      loginMapOverlay.style.opacity = '0';
    }
  }, 200);

  // PHASE 3: Fly to overview (always zoom out after login)
  setTimeout(() => {
    if (map) {
      map.flyTo([67.5, 15.0], 6, {
        duration: 1.8,
        easeLinearity: 0.1
      });
    }
  }, 400);

  // PHASE 4: Hide login overlay completely (pointer-events already handled by CSS)
  setTimeout(() => {
    loginOverlay.classList.add('hidden');
  }, 900);

  // PHASE 5: Enable map interactivity
  setTimeout(() => {
    if (map) {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoom.enable();
      map.keyboard.enable();
      // Add zoom control after login
      if (!map._zoomControl) {
        map._zoomControl = L.control.zoom({ position: 'topright' }).addTo(map);
      }
      // Block browser context menu on map area to prevent it interfering with marker context menus
      map.getContainer().addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });
    }
  }, 1000);

  // PHASE 5b: Load data AFTER flyTo animation completes (~2.2s from start)
  // This prevents UI jank during the login transition
  setTimeout(() => {
    if (!appInitialized) {
      initializeApp();
      appInitialized = true;
    } else {
      loadCustomers();
    }
  }, 2300);

  // PHASE 6: Slide in sidebar and show tab navigation
  setTimeout(() => {
    if (sidebar) {
      sidebar.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out';
      sidebar.style.transform = 'translateX(0)';
      sidebar.style.opacity = '1';
    }
    // Show tab navigation and sidebar toggle (hidden on logout)
    const tabNavigation = document.querySelector('.tab-navigation');
    if (tabNavigation) {
      tabNavigation.style.transition = 'opacity 0.4s ease-out';
      tabNavigation.style.opacity = '1';
      tabNavigation.style.pointerEvents = 'auto';
    }
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
      sidebarToggle.style.transition = 'opacity 0.4s ease-out';
      sidebarToggle.style.opacity = '1';
      sidebarToggle.style.pointerEvents = 'auto';
    }
  }, 1100);

  // PHASE 7: Slide in filter panel
  setTimeout(() => {
    if (filterPanel) {
      filterPanel.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out';
      filterPanel.style.transform = 'translateX(0)';
      filterPanel.style.opacity = '1';
    }

    // Slide in content panel if it should be open
    const contentPanel = document.getElementById('contentPanel');
    const shouldOpenPanel = localStorage.getItem('contentPanelOpen') === 'true';
    if (shouldOpenPanel && contentPanel) {
      contentPanel.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out';
      contentPanel.style.transform = 'translateX(0)';
      contentPanel.style.opacity = '1';
    }
  }, 1250);

  // PHASE 8: Clean up inline styles
  setTimeout(() => {
    // Clean up sidebar/filter inline styles
    if (sidebar) {
      sidebar.style.transition = '';
      sidebar.style.transform = '';
      sidebar.style.opacity = '';
    }
    if (filterPanel) {
      filterPanel.style.transition = '';
      filterPanel.style.transform = '';
      filterPanel.style.opacity = '';
    }

    // Clean up content panel inline styles
    const contentPanel = document.getElementById('contentPanel');
    if (contentPanel) {
      contentPanel.style.transition = '';
      contentPanel.style.transform = '';
      contentPanel.style.opacity = '';
    }

    // Reset login elements for potential re-login
    if (loginSide) {
      loginSide.style.transition = '';
      loginSide.style.transform = '';
      loginSide.style.opacity = '';
    }
    if (loginBrandContent) {
      loginBrandContent.style.transition = '';
      loginBrandContent.style.opacity = '';
      loginBrandContent.style.transform = '';
    }
    if (loginMapOverlay) {
      loginMapOverlay.style.transition = '';
      loginMapOverlay.style.opacity = '';
    }
  }, 2000);
}

// Show login view (for logout)
function showLoginView() {
  const loginOverlay = document.getElementById('loginOverlay');
  const appView = document.getElementById('appView');
  const sidebar = document.getElementById('sidebar');
  const filterPanel = document.getElementById('filterPanel');
  const loginSide = document.querySelector('.login-side');
  const loginBrandContent = document.querySelector('.login-brand-content');
  const loginMapOverlay = document.querySelector('.login-map-overlay');

  // Hide user bar with fade
  hideUserBar();

  // Reset login form
  const loginForm = document.getElementById('spaLoginForm');
  if (loginForm) loginForm.reset();
  resetLoginButton();

  // Hide error message
  const errorMessage = document.getElementById('loginErrorMessage');
  if (errorMessage) errorMessage.classList.remove('show');

  // Step 1: Prepare login elements for fade-in (start invisible)
  if (loginSide) {
    loginSide.style.transition = 'none';
    loginSide.style.transform = 'translateX(-30px)';
    loginSide.style.opacity = '0';
  }
  if (loginBrandContent) {
    loginBrandContent.style.transition = 'none';
    loginBrandContent.style.transform = 'scale(0.9)';
    loginBrandContent.style.opacity = '0';
  }
  if (loginMapOverlay) {
    loginMapOverlay.style.transition = 'none';
    loginMapOverlay.style.opacity = '0';
  }

  // Step 2: Fade out sidebar and filter panel
  const isMobile = window.innerWidth <= 768;
  if (sidebar) {
    sidebar.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out';
    // On mobile, sidebar is a bottom sheet - slide down instead of left
    sidebar.style.transform = isMobile ? 'translateY(100%)' : 'translateX(-100%)';
    sidebar.style.opacity = '0';
    sidebar.classList.remove('mobile-open');
  }
  if (filterPanel) {
    filterPanel.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out';
    filterPanel.style.transform = isMobile ? 'translateY(100%)' : 'translateX(100%)';
    filterPanel.style.opacity = '0';
  }

  // Animate out content panel if open
  const contentPanel = document.getElementById('contentPanel');
  if (contentPanel && !contentPanel.classList.contains('closed')) {
    contentPanel.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out';
    contentPanel.style.transform = 'translateX(-100%)';
    contentPanel.style.opacity = '0';
  }

  // Hide bulk action bar if visible
  const bulkActionBar = document.querySelector('.bulk-action-bar');
  if (bulkActionBar) {
    bulkActionBar.classList.remove('visible');
  }

  // Hide mobile route FAB
  const mobileRouteFab = document.getElementById('mobileRouteBtn');
  if (mobileRouteFab) {
    mobileRouteFab.classList.add('hidden');
  }

  // Hide tab navigation and sidebar toggle on mobile (logout)
  const tabNavigation = document.querySelector('.tab-navigation');
  if (tabNavigation) {
    tabNavigation.style.transition = 'opacity 0.3s ease-out';
    tabNavigation.style.opacity = '0';
    tabNavigation.style.pointerEvents = 'none';
  }
  const sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.style.transition = 'opacity 0.3s ease-out';
    sidebarToggle.style.opacity = '0';
    sidebarToggle.style.pointerEvents = 'none';
  }

  // Step 3: Fade out markers gradually
  if (markerClusterGroup) {
    // Add fade-out class to markers before removing
    const markerPane = document.querySelector('.leaflet-marker-pane');
    if (markerPane) {
      markerPane.style.transition = 'opacity 0.5s ease-out';
      markerPane.style.opacity = '0';
    }
    setTimeout(() => {
      markerClusterGroup.clearLayers();
      if (markerPane) {
        markerPane.style.transition = '';
        markerPane.style.opacity = '';
      }
    }, 500);
  }

  // Clear route if any
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  // Step 4: Show login overlay and start map fly animation
  setTimeout(() => {
    loginOverlay.classList.remove('hidden');

    // Step 5: Animate login elements in with smooth timing
    setTimeout(() => {
      // Fade in the dark overlay
      if (loginMapOverlay) {
        loginMapOverlay.style.transition = 'opacity 0.8s ease-out';
        loginMapOverlay.style.opacity = '1';
      }

      // Slide in and fade login side panel
      if (loginSide) {
        loginSide.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s ease-out';
        loginSide.style.transform = 'translateX(0)';
        loginSide.style.opacity = '1';
      }

      // Scale and fade brand content with slight delay
      setTimeout(() => {
        if (loginBrandContent) {
          loginBrandContent.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease-out';
          loginBrandContent.style.transform = 'scale(1)';
          loginBrandContent.style.opacity = '1';
        }
      }, 150);
    }, 50);
  }, 300);

  // Zoom map back to login position with smooth animation
  if (map) {
    // Disable interactivity
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoom.disable();
    map.keyboard.disable();

    // Remove zoom control if present
    if (map._zoomControl) {
      map.removeControl(map._zoomControl);
      map._zoomControl = null;
    }

    map.flyTo([69.06888, 17.65274], 11, {
      duration: 1.8,
      easeLinearity: 0.15
    });
  }

  // Step 6: Hide app view and reset styles after animation completes
  setTimeout(() => {
    appView.classList.add('hidden');

    // Reset sidebar/filter styles for next login
    if (sidebar) {
      sidebar.style.transition = '';
      sidebar.style.transform = '';
      sidebar.style.opacity = '';
    }
    if (filterPanel) {
      filterPanel.style.transition = '';
      filterPanel.style.transform = '';
      filterPanel.style.opacity = '';
    }

    // Reset content panel styles and close it
    const contentPanel = document.getElementById('contentPanel');
    if (contentPanel) {
      contentPanel.style.transition = '';
      contentPanel.style.transform = '';
      contentPanel.style.opacity = '';
      contentPanel.classList.add('closed');
      contentPanel.classList.remove('open');
    }

    // Reset login element transitions (keep final positions)
    if (loginSide) {
      loginSide.style.transition = '';
    }
    if (loginBrandContent) {
      loginBrandContent.style.transition = '';
    }
    if (loginMapOverlay) {
      loginMapOverlay.style.transition = '';
    }
  }, 1000);

  currentView = 'login';
}

// Handle logout (for SPA - shows login view without redirect)
function handleLogout() {
  // Stop proactive token refresh
  stopTokenRefresh();

  // Revoke session on server (cookie-based auth)
  const logoutHeaders = { 'Content-Type': 'application/json' };
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    logoutHeaders['X-CSRF-Token'] = csrfToken;
  }
  fetch('/api/klient/logout', {
    method: 'POST',
    headers: logoutHeaders,
    credentials: 'include'
  }).catch(err => console.error('Logout request failed:', err));

  authToken = null;
  isSuperAdmin = false;
  localStorage.removeItem('userName');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  localStorage.removeItem('isSuperAdmin');
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('impersonatingOrgName');
  // Multi-tenancy: Clear organization data
  localStorage.removeItem('organizationId');
  localStorage.removeItem('organizationSlug');
  localStorage.removeItem('organizationName');
  // Clear app mode and industry (prevents stale settings on next login)
  localStorage.removeItem('appMode');
  localStorage.removeItem('industrySlug');
  localStorage.removeItem('industryName');
  // Reset appConfig to default
  appConfig.appMode = 'mvp';
  // Clear impersonation data
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('impersonatingOrgId');
  localStorage.removeItem('impersonatingOrgName');

  showLoginView();
}

// Stop impersonation and return to admin panel (for super-admins)
async function stopImpersonation() {
  try {
    const stopImpHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      stopImpHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/super-admin/stop-impersonation', {
      method: 'POST',
      headers: stopImpHeaders,
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success) {
      // Clear impersonation data
      localStorage.removeItem('isImpersonating');
      localStorage.removeItem('impersonatingOrgId');
      localStorage.removeItem('impersonatingOrgName');

      // Redirect to admin panel
      window.location.href = '/admin';
    } else {
      console.error('Failed to stop impersonation:', data.error);
      alert('Kunne ikke avslutte impersonering');
    }
  } catch (error) {
    console.error('Error stopping impersonation:', error);
    alert('Kunne ikke avslutte impersonering');
  }
}

// Check if user is already logged in (supports both localStorage token and SSO cookie)
async function checkExistingAuth() {
  // First, try SSO verification (checks both Bearer token and SSO cookie)
  try {
    const response = await fetch('/api/klient/verify', {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();

      if (data.success && data.data && data.data.valid) {
        // SSO session found or token is valid
        const { token, user, organization } = data.data;

        // Keep token in memory (cookie is the primary auth mechanism)
        if (token) {
          authToken = token;
        }

        // Update user info
        if (user) {
          localStorage.setItem('userName', user.navn || 'Bruker');
          localStorage.setItem('userType', user.type || 'klient');
          localStorage.setItem('userRole', user.type === 'bruker' ? 'admin' : 'klient');
          // Store super admin flag
          if (user.isSuperAdmin) {
            localStorage.setItem('isSuperAdmin', 'true');
          } else {
            localStorage.removeItem('isSuperAdmin');
          }
        }

        // Update organization branding and persist org data
        if (organization) {
          // Store organization data to localStorage (needed for reloadConfigWithAuth)
          localStorage.setItem('organizationId', organization.id);
          localStorage.setItem('organizationSlug', organization.slug);

          appConfig.companyName = organization.navn;
          appConfig.logoUrl = organization.logoUrl;
          appConfig.primaryColor = organization.primaryColor;
          appConfig.brandTitle = organization.brandTitle || organization.navn;
          // App mode: 'mvp' = enkel versjon, 'full' = komplett (TRE Allservice)
          appConfig.appMode = organization.appMode || 'mvp';
          localStorage.setItem('appMode', appConfig.appMode);

          // Store subscription info for timer
          subscriptionInfo = {
            status: organization.subscriptionStatus,
            trialEndsAt: organization.trialEndsAt,
            planType: organization.planType
          };

          // Load full tenant config (includes industry/service types) and apply branding
          await reloadConfigWithAuth();
        }

        Logger.log('SSO session verified successfully');
        return true;
      }
    }
  } catch (error) {
    Logger.warn('SSO verification failed:', error);
  }

  // Fallback: try existing localStorage token with dashboard endpoint
  if (authToken) {
    try {
      const response = await fetch('/api/klient/dashboard', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.klient) {
          localStorage.setItem('userName', data.klient.navn || 'Bruker');
          localStorage.setItem('userRole', data.klient.rolle || 'klient');
          localStorage.setItem('userType', data.klient.type || 'klient');
        }
        return true;
      }
    } catch (error) {
      // Token verification failed
    }
  }

  // No valid session found - clear any stale data
  authToken = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('userName');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  return false;
}

// Helper function to make authenticated API calls
// Token refresh state to prevent multiple simultaneous refresh attempts
let isRefreshingToken = false;
let refreshPromise = null;

// Check if access token is expiring soon (within 2 minutes)
function isAccessTokenExpiringSoon() {
  if (!accessTokenExpiresAt) return false;

  const expiryTime = typeof accessTokenExpiresAt === 'number' ? accessTokenExpiresAt : parseInt(accessTokenExpiresAt, 10);
  const bufferTime = 2 * 60 * 1000; // 2 minutes before expiry
  return Date.now() > (expiryTime - bufferTime);
}

// Refresh the access token using refresh token
async function refreshAccessToken() {
  // If already refreshing, wait for that promise
  if (isRefreshingToken && refreshPromise) {
    return refreshPromise;
  }

  isRefreshingToken = true;
  refreshPromise = (async () => {
    try {
      const refreshHeaders = { 'Content-Type': 'application/json' };
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        refreshHeaders['X-CSRF-Token'] = csrfToken;
      }
      const response = await fetch('/api/klient/refresh', {
        method: 'POST',
        headers: refreshHeaders,
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();

        // Tokens are managed via httpOnly cookies
        authToken = data.accessToken || data.token;

        Logger.log('Access token refreshed successfully');
        return true;
      } else {
        // Refresh failed - clear tokens and redirect to login
        Logger.warn('Token refresh failed:', response.status);
        return false;
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    } finally {
      isRefreshingToken = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Proactive token refresh - runs in background to prevent session expiry during idle
let tokenRefreshInterval = null;

function setupTokenRefresh() {
  // Clear any existing interval
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }

  // Check every minute for token expiry
  tokenRefreshInterval = setInterval(async () => {
    if (!accessTokenExpiresAt) return;

    const expiryTime = typeof accessTokenExpiresAt === 'number' ? accessTokenExpiresAt : parseInt(accessTokenExpiresAt, 10);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    // Refresh 5 minutes before expiry
    if (expiryTime - now < fiveMinutes && expiryTime > now) {
      Logger.log('Proactive token refresh triggered');
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Reload config to ensure we have fresh tenant data
        await reloadConfigWithAuth();
        Logger.log('Config reloaded after token refresh');
      } else {
        // Refresh failed - don't force logout, let next API call handle it
        Logger.warn('Proactive token refresh failed');
      }
    }
  }, 60000); // Check every minute

  Logger.log('Token refresh interval started');
}

function stopTokenRefresh() {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = null;
    Logger.log('Token refresh interval stopped');
  }
}

async function apiFetch(url, options = {}) {
  // Check if token needs refresh before making request
  if (authToken && isAccessTokenExpiringSoon()) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      // Refresh failed - redirect to login
      handleLogout();
      throw new Error('Sesjon utløpt');
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  // Add CSRF token for state-changing methods
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  const response = await fetch(url, { ...options, headers, credentials: 'include' });

  // Handle 401 - try to refresh token once, then logout if still failing
  if (response.status === 401) {
    const data = await response.json().catch(() => ({}));

    // Try to refresh token and retry the request
    if (authToken && !options._retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry the original request with new token
        return apiFetch(url, { ...options, _retried: true });
      }
    }

    if (data.requireLogin || data.error === 'Sesjonen har utløpt') {
      handleLogout();
      throw new Error('Ikke innlogget');
    }
  }

  // Handle 403 with subscription error - show modal and redirect
  if (response.status === 403) {
    const data = await response.clone().json().catch(() => ({}));

    if (data.code === 'SUBSCRIPTION_INACTIVE') {
      showSubscriptionError(data);
      throw new Error(data.error || 'Abonnementet er ikke aktivt');
    }
  }

  // Check for subscription warning header (grace period / trial ending soon)
  const subscriptionWarning = response.headers.get('X-Subscription-Warning');
  if (subscriptionWarning) {
    showSubscriptionWarningBanner(subscriptionWarning);
  }

  return response;
}

// ========================================
// SUBSCRIPTION ERROR HANDLING
// ========================================

/**
 * Shows a warning banner for subscription issues (grace period, trial ending)
 * Does not block app usage, just shows a dismissible warning
 */
function showSubscriptionWarningBanner(message) {
  // Only show once per session to avoid spamming
  if (window._subscriptionWarningShown) return;
  window._subscriptionWarningShown = true;

  // Remove existing banner if any
  const existing = document.getElementById('subscriptionWarningBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'subscriptionWarningBanner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-size:14px;';

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <i class="fas fa-exclamation-circle"></i>
      <span>${escapeHtml(message)}</span>
    </div>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:white;cursor:pointer;font-size:18px;padding:0 5px;">&times;</button>
  `;

  document.body.prepend(banner);
}

// ========================================
// SUBSCRIPTION COUNTDOWN TIMER
// ========================================

let subscriptionTimerInterval = null;

/**
 * Decodes a JWT token to extract payload (without verification)
 */
function decodeJWT(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

/**
 * Initializes the subscription countdown timer
 * Only shows for users with active trial period
 */
function initSubscriptionTimer() {
  // Skip timer for enterprise plans - they don't have trials
  if (subscriptionInfo?.planType === 'enterprise') {
    hideSubscriptionTimer();
    return;
  }

  if (!subscriptionInfo) return;

  const { status: subscriptionStatus, trialEndsAt } = subscriptionInfo;

  // Only show timer for trialing subscriptions
  if (subscriptionStatus !== 'trialing') {
    hideSubscriptionTimer();
    return;
  }

  // Only show for trialing with valid end date
  if (!trialEndsAt) {
    hideSubscriptionTimer();
    return;
  }

  const targetDate = new Date(trialEndsAt);
  const timerLabel = 'Prøveperiode';

  // Start the countdown
  updateSubscriptionTimer(targetDate, timerLabel);

  // Clear any existing interval
  if (subscriptionTimerInterval) clearInterval(subscriptionTimerInterval);

  // Update every minute
  subscriptionTimerInterval = setInterval(() => {
    updateSubscriptionTimer(targetDate, timerLabel);
  }, 60000);
}

/**
 * Updates the subscription timer display
 */
function updateSubscriptionTimer(targetDate, label) {
  const timerEl = document.getElementById('subscriptionTimer');
  const timerText = document.getElementById('subscriptionTimerText');

  if (!timerEl || !timerText) return;

  const now = new Date();
  const diff = targetDate - now;

  if (diff <= 0) {
    timerText.textContent = 'Utløpt';
    timerEl.classList.add('warning');
    timerEl.style.display = 'flex';
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  let timeStr = '';
  if (days > 0) {
    timeStr = `${days}d ${hours}t`;
  } else if (hours > 0) {
    timeStr = `${hours}t ${minutes}m`;
  } else {
    timeStr = `${minutes}m`;
  }

  timerText.textContent = `${label}: ${timeStr}`;

  // Add warning class if less than 3 days
  if (days < 3) {
    timerEl.classList.add('warning');
  } else {
    timerEl.classList.remove('warning');
  }

  timerEl.style.display = 'flex';
}

/**
 * Hides the subscription timer
 */
function hideSubscriptionTimer() {
  const timerEl = document.getElementById('subscriptionTimer');
  if (timerEl) timerEl.style.display = 'none';

  if (subscriptionTimerInterval) {
    clearInterval(subscriptionTimerInterval);
    subscriptionTimerInterval = null;
  }
}

/**
 * Shows a modal when subscription is inactive
 * Prevents further app usage until subscription is resolved
 */
function showSubscriptionError(errorData) {
  const message = errorData.error || 'Abonnementet er ikke aktivt';
  const details = errorData.details || {};

  // Remove existing modal if any
  const existing = document.getElementById('subscriptionErrorModal');
  if (existing) existing.remove();

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'subscriptionErrorModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const statusMessages = {
    trial_expired: 'Prøveperioden din har utløpt',
    canceled: 'Abonnementet er kansellert',
    past_due: 'Betalingen har feilet',
    incomplete: 'Abonnementet er ikke fullført',
    grace_period_exceeded: 'Betalingsfristen er utløpt'
  };

  const statusTitle = statusMessages[details.reason] || 'Abonnement kreves';

  modal.innerHTML = `
    <div style="background:var(--card-bg, #1a1a2e);border-radius:12px;padding:32px;max-width:450px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
      <div style="width:64px;height:64px;margin:0 auto 20px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:flex;align-items:center;justify-content:center;">
        <i class="fas fa-exclamation-triangle" style="font-size:28px;color:white;"></i>
      </div>
      <h2 style="color:var(--text-primary, #fff);margin:0 0 12px;font-size:24px;">${escapeHtml(statusTitle)}</h2>
      <p style="color:var(--text-secondary, #a0a0a0);margin:0 0 24px;font-size:15px;line-height:1.6;">${escapeHtml(message)}</p>
      <p style="font-size:13px;color:var(--text-muted, #666);">
        Kontakt administrator for å håndtere abonnementet, eller <a href="mailto:sander@efffekt.no" style="color:#3b82f6;">ta kontakt med support</a>.
      </p>
    </div>
  `;

  document.body.appendChild(modal);

  // Prevent any interaction with the app
  modal.addEventListener('click', (e) => {
    // Only allow clicking the email link
    if (e.target.tagName !== 'A') {
      e.stopPropagation();
    }
  });
}

// WebSocket for real-time updates
let ws = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// Initialize WebSocket connection for real-time updates
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      Logger.log('WebSocket connected - sanntidsoppdateringer aktiv');
      wsReconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleRealtimeUpdate(message);
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      Logger.log('WebSocket disconnected');
      attemptReconnect();
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
  }
}

// Attempt to reconnect WebSocket
function attemptReconnect() {
  if (wsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    Logger.log('Max reconnection attempts reached');
    return;
  }

  wsReconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 30000);

  wsReconnectTimer = setTimeout(() => {
    Logger.log(`Attempting WebSocket reconnection (${wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    initWebSocket();
  }, delay);
}

// Handle real-time updates from WebSocket
function handleRealtimeUpdate(message) {
  const { type, data } = message;

  switch (type) {
    case 'connected':
      Logger.log('Server:', data || message.message);
      break;

    case 'kunde_created':
      // Add new customer to list and re-render
      customers.push(data);
      applyFilters();
      renderCustomerAdmin();
      renderMissingData(); // Update missing data badge
      updateOverdueBadge();
      showNotification(`Ny kunde opprettet: ${data.navn}`);
      break;

    case 'kunde_updated':
      // Update existing customer
      const updateIndex = customers.findIndex(c => c.id === Number.parseInt(data.id));
      if (updateIndex !== -1) {
        customers[updateIndex] = { ...customers[updateIndex], ...data };
        applyFilters();
        renderCustomerAdmin();
        renderMissingData(); // Update missing data badge
        updateOverdueBadge();
      }
      break;

    case 'kunde_deleted':
      // Remove customer from list
      customers = customers.filter(c => c.id !== data.id);
      selectedCustomers.delete(data.id);
      applyFilters();
      renderCustomerAdmin();
      renderMissingData(); // Update missing data badge
      updateOverdueBadge();
      updateSelectionUI();
      break;

    case 'time_update':
      // Periodic time update - refresh day counters
      updateDayCounters();
      break;
  }
}

// Update all day counters in the UI (called periodically)
function updateDayCounters() {
  // Re-render lists that show day counts
  const activeTab = document.querySelector('.tab-item.active')?.dataset.tab;

  if (activeTab === 'customers') {
    renderCustomerAdmin();
  } else if (activeTab === 'overdue') {
    renderOverdue();
  } else if (activeTab === 'warnings') {
    renderWarnings();
  } else if (activeTab === 'planner') {
    renderPlanner();
  }

  // Always update the badges
  updateOverdueBadge();
  renderMissingData(); // Update missing data badge


  // Update filter panel customer list
  applyFilters();
}

// Schedule update at next midnight to refresh day counters
function scheduleNextMidnightUpdate() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 1, 0); // 1 second after midnight

  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    Logger.log('Midnight update - refreshing day counters');
    updateDayCounters();
    // Schedule next midnight update
    scheduleNextMidnightUpdate();
  }, msUntilMidnight);

  Logger.log(`Next midnight update scheduled in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
}

// ===== SECURITY: XSS Protection =====
// Use this function to escape all user-provided data before inserting into HTML
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== UI HELPERS =====

// Update category tabs dynamically based on service types from config
function updateCategoryTabs() {
  if (!serviceTypeRegistry.initialized) return;

  const container = document.getElementById('kategoriTabs');
  if (!container) return;

  // Generate dynamic tabs
  container.innerHTML = serviceTypeRegistry.renderCategoryTabs(customerAdminKategori);

  Logger.log('Category tabs updated from service registry');
}

// Update badge visibility and count
function updateBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// Get the nearest upcoming control date for a customer (returns Date object)
function getNearestControlDate(customer) {
  const dates = [customer.neste_el_kontroll, customer.neste_brann_kontroll, customer.neste_kontroll]
    .filter(Boolean)
    .map(d => {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y, m - 1, day);
    });
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates));
}


// Load configuration from server
async function loadConfig() {
  try {
    // Use regular fetch for config - no auth required
    const response = await fetch('/api/config');
    const configResponse = await response.json();
    appConfig = configResponse.data || configResponse;

    // Initialize service type registry from config
    serviceTypeRegistry.loadFromConfig(appConfig);

    // Check localStorage for saved industry (for login page display before auth)
    const savedIndustrySlug = localStorage.getItem('industrySlug');
    if (savedIndustrySlug) {
      try {
        await serviceTypeRegistry.loadFromIndustry(savedIndustrySlug);
        Logger.log('Loaded saved industry from localStorage:', savedIndustrySlug);
      } catch (e) {
        Logger.warn('Could not load saved industry:', e);
      }
    }

    // Update control section headers with dynamic service type names/icons
    updateControlSectionHeaders();

    // Render dynamic filter panel categories
    renderFilterPanelCategories();
    renderDriftskategoriFilter();

    // Apply MVP mode UI changes (hide industry-specific elements)
    applyMvpModeUI();

    Logger.log('Application configuration loaded:', appConfig);
    Logger.log('Route planning configured:', appConfig.orsApiKeyConfigured);
  } catch (error) {
    Logger.warn('Could not load configuration from server:', error);
    // Use defaults - requireAuth: true by default for safety
    appConfig = {
      appName: 'Sky Planner',
      companyName: '',
      companySubtitle: 'Kontroll. Oversikt. Alltid.',
      logoUrl: '/skyplanner-logo.svg',
      contactAddress: '',
      contactPhone: '',
      contactEmail: '',
      appYear: '2026',
      mapCenterLat: 65.5,
      mapCenterLng: 12.0,
      mapZoom: 5,
      mapClusterRadius: 80,
      enableRoutePlanning: true,
      showUpcomingWidget: true,
      upcomingControlDays: 30,
      defaultControlInterval: 12,
      controlIntervals: [6, 12, 24, 36],
      requireAuth: true
    };
  }
}

// Apply branding from config to UI elements
function applyBranding() {
  // Login page branding
  const loginLogo = document.getElementById('loginLogo');
  const loginBrandTitle = document.getElementById('loginBrandTitle');
  const loginBrandSubtitle = document.getElementById('loginBrandSubtitle');
  const loginContact = document.getElementById('loginContact');
  const loginAddress = document.getElementById('loginAddress');
  const loginContactLinks = document.getElementById('loginContactLinks');
  const loginFooterCopyright = document.getElementById('loginFooterCopyright');

  // Header/sidebar branding
  const headerLogo = document.getElementById('headerLogo');
  const headerCompanyName = document.getElementById('headerCompanyName');
  const headerAppName = document.getElementById('headerAppName');
  const headerYear = document.getElementById('headerYear');

  // Apply logo if configured
  if (appConfig.logoUrl) {
    if (loginLogo) {
      loginLogo.src = appConfig.logoUrl;
      loginLogo.style.display = 'block';
    }
    if (headerLogo) {
      headerLogo.src = appConfig.logoUrl;
      headerLogo.style.display = 'block';
    }
  }

  // Apply organization name to sidebar H1 (fallback to app name, then Sky Planner)
  if (headerAppName) {
    headerAppName.textContent = appConfig.companyName || appConfig.appName || 'Sky Planner';
  }

  // Apply industry name as subtitle in header
  const industryName = appConfig.industry?.name;
  if (industryName) {
    if (headerCompanyName) {
      headerCompanyName.textContent = industryName;
      headerCompanyName.style.display = '';
    }
  } else {
    // Hide industry name element if not available
    if (headerCompanyName) headerCompanyName.style.display = 'none';
  }

  // Apply company name to login brand title
  if (appConfig.companyName && loginBrandTitle) {
    loginBrandTitle.textContent = appConfig.companyName;
  }

  // Apply year dynamically
  const currentYear = appConfig.appYear || new Date().getFullYear();
  if (headerYear) {
    headerYear.textContent = currentYear;
  }

  // Apply login footer copyright
  if (loginFooterCopyright) {
    const developerName = appConfig.developerName || 'Efffekt AS';
    loginFooterCopyright.innerHTML = `&copy; ${currentYear} ${escapeHtml(developerName)}. All rights reserved.`;
  }

  // Apply subtitle
  if (loginBrandSubtitle && appConfig.companySubtitle) {
    loginBrandSubtitle.textContent = appConfig.companySubtitle;
  }

  // Apply contact info if configured
  if (loginContact && (appConfig.contactAddress || appConfig.contactPhone || appConfig.contactEmail)) {
    loginContact.style.display = 'block';

    if (loginAddress && appConfig.contactAddress) {
      loginAddress.textContent = appConfig.contactAddress;
    }

    if (loginContactLinks) {
      let links = [];
      if (appConfig.contactPhone) {
        // Validate phone format: only digits, spaces, +, and - allowed
        const phoneClean = appConfig.contactPhone.replace(/[^\d\s\+\-\(\)]/g, '');
        const phoneHref = phoneClean.replace(/\s/g, '');
        links.push(`<a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(phoneClean)}</a>`);
      }
      if (appConfig.contactEmail) {
        links.push(`<a href="mailto:${escapeHtml(appConfig.contactEmail)}">${escapeHtml(appConfig.contactEmail)}</a>`);
      }
      loginContactLinks.innerHTML = links.join('<span class="login-contact-divider">·</span>');
    }
  }

  // Multi-tenancy: Apply custom colors from tenant config
  applyTenantColors();

  // Multi-tenancy: Update page title
  if (appConfig.appName) {
    document.title = appConfig.appName;
  }

  // Update dynamic UI elements based on service types
  updateCategoryTabs();

  // Render dynamic login features based on industry/service types
  renderLoginFeatures();

  Logger.log('Branding applied from config');
}

// Render dynamic login features based on industry/service types
function renderLoginFeatures() {
  const container = document.getElementById('loginFeatures');
  if (!container) return;

  // Get service types from registry (or use defaults)
  let serviceTypes = [];
  try {
    serviceTypes = serviceTypeRegistry.getAll() || [];
  } catch (e) {
    // ServiceTypeRegistry not initialized yet
  }

  // Default features if no service types configured
  const defaultFeatures = [
    { icon: 'fas fa-bolt', name: 'El-kontroll', description: 'Periodisk kontroll for næring og bolig' },
    { icon: 'fas fa-fire', name: 'Brannvarsling', description: 'Service og kontroll av anlegg' }
  ];

  // Use service types or defaults
  const features = serviceTypes.length > 0
    ? serviceTypes.slice(0, 3).map(s => {
        // Ensure icon has 'fas' prefix for Font Awesome 5
        let icon = s.icon || 'fa-check-circle';
        if (!icon.startsWith('fas ') && !icon.startsWith('far ') && !icon.startsWith('fab ')) {
          icon = 'fas ' + icon;
        }
        return {
          icon: icon,
          name: s.name,
          description: s.description || 'Periodisk kontroll'
        };
      })
    : defaultFeatures;

  // Always add standard features
  const standardFeatures = [
    { icon: 'fas fa-route', name: 'Ruteplanlegging', description: 'Effektive serviceruter' },
    { icon: 'fas fa-bell', name: 'Varsler', description: 'Automatiske påminnelser' }
  ];

  const allFeatures = [...features, ...standardFeatures];

  // Render feature cards
  container.innerHTML = allFeatures.map(feature => `
    <div class="login-feature">
      <div class="login-feature-icon">
        <i class="${feature.icon}"></i>
      </div>
      <div class="login-feature-text">
        <h4>${feature.name}</h4>
        <p>${feature.description}</p>
      </div>
    </div>
  `).join('');
}

// Apply tenant-specific colors using CSS custom properties
function applyTenantColors() {
  const root = document.documentElement;

  // Primary color (accent color)
  if (appConfig.primaryColor) {
    root.style.setProperty('--color-accent', appConfig.primaryColor);
    root.style.setProperty('--color-accent-hover', adjustColor(appConfig.primaryColor, -20));
    root.style.setProperty('--color-accent-light', adjustColor(appConfig.primaryColor, 40));
  }

  // Secondary color (sidebar/background)
  if (appConfig.secondaryColor) {
    root.style.setProperty('--color-sidebar-bg', appConfig.secondaryColor);
  }

  Logger.log('Tenant colors applied:', {
    primary: appConfig.primaryColor,
    secondary: appConfig.secondaryColor
  });
}

// Helper: Adjust color brightness (positive = lighter, negative = darker)
function adjustColor(hex, percent) {
  if (!hex) return hex;

  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Adjust brightness
  r = Math.min(255, Math.max(0, r + Math.round(r * percent / 100)));
  g = Math.min(255, Math.max(0, g + Math.round(g * percent / 100)));
  b = Math.min(255, Math.max(0, b + Math.round(b * percent / 100)));

  // Convert back to hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Reload config with auth token (after login for tenant-specific branding)
async function reloadConfigWithAuth() {
  try {
    const response = await fetch('/api/config', {
      credentials: 'include'
    });

    if (response.ok) {
      const configResponse = await response.json();
      appConfig = configResponse.data || configResponse;

      // Load service types: prefer org-specific types from config, fall back to industry template
      if (appConfig.serviceTypes && appConfig.serviceTypes.length > 0) {
        // Org has custom service types (from organization_service_types table)
        serviceTypeRegistry.loadFromConfig(appConfig);
        Logger.log('Service types loaded from org config:', appConfig.serviceTypes.length);
      } else {
        // Fall back to industry template service types
        const serverIndustry = appConfig.industry;
        if (serverIndustry && serverIndustry.slug) {
          localStorage.setItem('industrySlug', serverIndustry.slug);
          localStorage.setItem('industryName', serverIndustry.name || serverIndustry.slug);
          await serviceTypeRegistry.loadFromIndustry(serverIndustry.slug);
          Logger.log('Industry loaded from server:', serverIndustry.slug);
        } else {
          const industrySlug = localStorage.getItem('industrySlug');
          if (industrySlug) {
            await serviceTypeRegistry.loadFromIndustry(industrySlug);
          } else {
            serviceTypeRegistry.loadFromConfig(appConfig);
          }
        }
      }

      updateControlSectionHeaders();
      renderFilterPanelCategories();
      renderDriftskategoriFilter();
      applyMvpModeUI();
      applyBranding();
      applyDateModeToInputs();
      Logger.log('Tenant-specific config loaded:', appConfig.organizationSlug);
    }
  } catch (error) {
    Logger.warn('Could not reload tenant config:', error);
  }
}

// DOM Elements (initialized after DOM is ready)
let customerList;
let searchInput;
let addCustomerBtn;
let planRouteBtn;
let clearSelectionBtn;
let selectedCount;
let customerModal;
let customerForm;
let apiKeyModal;
let routeInfo;

// Initialize DOM references
function initDOMElements() {
  customerList = document.getElementById('customerList');
  searchInput = document.getElementById('searchInput');
  addCustomerBtn = document.getElementById('addCustomerBtn');
  planRouteBtn = document.getElementById('planRouteBtn');
  clearSelectionBtn = document.getElementById('clearSelectionBtn');
  selectedCount = document.getElementById('selectedCount');
  customerModal = document.getElementById('customerModal');
  customerForm = document.getElementById('customerForm');
  apiKeyModal = document.getElementById('apiKeyModal');
  routeInfo = document.getElementById('routeInfo');
}

// Initialize map features (clustering, borders, etc.)
// Note: The base map is created in initSharedMap() at page load
function initMap() {
  Logger.log('initMap() starting, map exists:', !!map);
  // Map should already exist from initSharedMap()
  if (!map) {
    console.error('Map not initialized - call initSharedMap() first');
    return;
  }

  // Add Norway border overlay from Kartverket
  addNorwayBorder();

  // Add scale control
  L.control.scale({
    metric: true,
    imperial: false,
    position: 'bottomleft'
  }).addTo(map);

  // Add "My location" button
  const LocateControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function() {
      const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      btn.innerHTML = '<a href="#" title="Min posisjon" role="button" aria-label="Min posisjon" style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;font-size:16px;"><i class="fas fa-location-crosshairs"></i></a>';
      let locationMarker = null;
      L.DomEvent.on(btn, 'click', function(e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        map.locate({ setView: true, maxZoom: 15 });
      });
      map.on('locationfound', function(e) {
        if (locationMarker) map.removeLayer(locationMarker);
        locationMarker = L.circleMarker(e.latlng, {
          radius: 8, fillColor: '#4285F4', fillOpacity: 1,
          color: '#fff', weight: 2
        }).addTo(map).bindPopup('Du er her');
      });
      map.on('locationerror', function() {
        showNotification('Kunne ikke finne posisjonen din', 'error');
      });
      return btn;
    }
  });
  new LocateControl().addTo(map);

  // Initialize marker cluster group - reduced radius for better overview
  const clusterRadius = appConfig.mapClusterRadius || 60;
  markerClusterGroup = L.markerClusterGroup({
    maxClusterRadius: clusterRadius,
    iconCreateFunction: createClusterIcon,
    // Disable clustering at zoom 14 - keep clustering longer for better performance
    disableClusteringAtZoom: 14,
    // Enable spiderfy only at max zoom (not on every zoom)
    spiderfyOnMaxZoom: true,
    spiderfyOnEveryZoom: false,
    spiderfyDistanceMultiplier: 2.5,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true, // Zoom to bounds instead of spiderfying immediately
    // Animate cluster split
    animate: true,
    animateAddingMarkers: false,
    // Keep single markers visible (not clustered alone)
    singleMarkerMode: false
  });
  map.addLayer(markerClusterGroup);

  // Handle spiderfied markers - make them compact
  markerClusterGroup.on('spiderfied', (e) => {
    e.markers.forEach(marker => {
      if (marker._icon) {
        marker._icon.classList.add('spiderfied-marker');
      }
    });
  });

  markerClusterGroup.on('unspiderfied', (e) => {
    e.markers.forEach(marker => {
      if (marker._icon) {
        marker._icon.classList.remove('spiderfied-marker');
      }
    });
  });
  Logger.log('initMap() markerClusterGroup created and added to map');

  // Handle cluster click - show popup with options
  markerClusterGroup.on('clusterclick', function(e) {
    const cluster = e.layer;
    const childMarkers = cluster.getAllChildMarkers();
    const customerIds = [];
    const customerNames = [];

    // Extract customer IDs from markers
    childMarkers.forEach(marker => {
      // Find customer ID by matching marker position
      for (const [id, m] of Object.entries(markers)) {
        if (m === marker) {
          customerIds.push(Number.parseInt(id));
          const customer = customers.find(c => c.id === Number.parseInt(id));
          if (customer) {
            customerNames.push(customer.navn);
          }
          break;
        }
      }
    });

    // Create popup content with options
    const areaNames = new Set();
    const typeCounts = {};  // el_type: Landbruk, Næring, etc.
    const driftCounts = {}; // brann_driftstype: Storfe, Sau, etc.
    const systemCounts = {}; // brann_system: Elotec, ICAS, etc.

    customerIds.forEach(id => {
      const customer = customers.find(c => c.id === id);
      if (customer) {
        if (customer.poststed) areaNames.add(customer.poststed);

        // Count el_type (Landbruk, Næring, Bolig, etc.)
        if (customer.el_type) typeCounts[customer.el_type] = (typeCounts[customer.el_type] || 0) + 1;

        // Count driftstype
        const drift = normalizeDriftstype(customer.brann_driftstype);
        if (drift) driftCounts[drift] = (driftCounts[drift] || 0) + 1;

        // Count brannsystem
        const system = normalizeBrannsystem(customer.brann_system);
        if (system) systemCounts[system] = (systemCounts[system] || 0) + 1;
      }
    });

    // Build category summary HTML
    let categoryHtml = '';
    const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const driftEntries = Object.entries(driftCounts).sort((a, b) => b[1] - a[1]);
    const systemEntries = Object.entries(systemCounts).sort((a, b) => b[1] - a[1]);

    if (typeEntries.length > 0 || driftEntries.length > 0 || systemEntries.length > 0) {
      categoryHtml = '<div class="cluster-categories">';
      if (typeEntries.length > 0) {
        categoryHtml += '<div class="cluster-category-group"><strong>Type:</strong> ';
        categoryHtml += typeEntries.map(([name, count]) => `<span class="cluster-tag type-tag clickable" data-action="filterByElType" data-value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</span>`).join(' ');
        categoryHtml += '</div>';
      }
      if (systemEntries.length > 0) {
        categoryHtml += '<div class="cluster-category-group"><strong>System:</strong> ';
        categoryHtml += systemEntries.map(([name, count]) => `<span class="cluster-tag system-tag clickable" data-action="filterByBrannsystem" data-value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</span>`).join(' ');
        categoryHtml += '</div>';
      }
      if (driftEntries.length > 0) {
        categoryHtml += '<div class="cluster-category-group"><strong>Drift:</strong> ';
        categoryHtml += driftEntries.map(([name, count]) => `<span class="cluster-tag drift-tag clickable" data-action="filterByDrift" data-value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</span>`).join(' ');
        categoryHtml += '</div>';
      }
      categoryHtml += '</div>';
    }

    const areaText = Array.from(areaNames).slice(0, 2).join(' / ') || 'Område';
    const popupContent = `
      <div class="cluster-popup">
        <h3>${escapeHtml(areaText)}</h3>
        <p><strong>${customerIds.length}</strong> kunder i dette området</p>
        ${categoryHtml}
        <div class="cluster-popup-actions">
          <button class="btn btn-primary btn-small" data-action="addClusterToRoute" data-customer-ids="${customerIds.join(',')}">
            <i class="fas fa-route"></i> Legg til rute
          </button>
          <button class="btn btn-secondary btn-small" data-action="zoomToCluster" data-lat="${e.latlng.lat}" data-lng="${e.latlng.lng}">
            <i class="fas fa-search-plus"></i> Zoom inn
          </button>
        </div>
        <div class="cluster-customer-list">
          ${customerNames.slice(0, 5).map(name => `<span class="cluster-customer-name">${escapeHtml(name)}</span>`).join('')}
          ${customerNames.length > 5 ? `<span class="cluster-more">+${customerNames.length - 5} flere...</span>` : ''}
        </div>
      </div>
    `;

    L.popup()
      .setLatLng(e.latlng)
      .setContent(popupContent)
      .openOn(map);
  });

  // Update marker labels visibility based on zoom level
  map.on('zoomend', updateMarkerLabelsVisibility);
}

// Show/hide marker labels based on zoom level
function updateMarkerLabelsVisibility() {
  const zoom = map.getZoom();
  const mapContainer = document.getElementById('map');

  // At low zoom levels (zoomed out), hide labels to reduce clutter
  // Show labels when zoomed in (zoom >= 10) so names and addresses are visible
  if (zoom < 10) {
    mapContainer.classList.add('hide-marker-labels');
  } else {
    mapContainer.classList.remove('hide-marker-labels');
  }
}

// Load customers from API
async function loadCustomers() {
  Logger.log('loadCustomers() called, markerClusterGroup:', !!markerClusterGroup);
  try {
    const response = await apiFetch('/api/kunder');
    if (!response.ok) throw new Error(`HTTP ${response.status}: Kunne ikke laste kunder`);
    const result = await response.json();
    customers = result.data || result; // Handle both { data: [...] } and direct array
    Logger.log('loadCustomers() fetched', customers.length, 'customers');
    renderElTypeFilter(); // Update kundetype filter with customer data
    renderDriftskategoriFilter(); // Update driftskategori filter with customer data
    renderBrannsystemFilter(); // Update brannsystem filter with customer data
    applyFilters();
    renderMarkers(customers);
    renderCustomerAdmin();
    updateOverdueBadge();
    renderMissingData(); // Update missing data badge and lists
    updateDashboard(); // Update dashboard stats
    updateGettingStartedBanner(); // Show/hide getting started banner
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
}

// Render getting started banner HTML
function renderGettingStartedBanner() {
  const webUrl = appConfig.webUrl || '';

  return `
    <div class="getting-started-header">
      <div>
        <h2>Velkommen til Sky Planner!</h2>
        <p>Legg til dine kunder for a komme i gang.</p>
      </div>
      <button class="getting-started-close" onclick="dismissGettingStartedBanner()" title="Lukk">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="getting-started-cards">
      <div class="getting-started-card" onclick="window.open('${escapeHtml(webUrl)}/dashboard/innstillinger/integrasjoner', '_blank')">
        <div class="getting-started-card-icon">
          <i class="fas fa-plug"></i>
        </div>
        <h3>Koble til regnskapssystem</h3>
        <p>Synkroniser kunder fra Tripletex, Fiken eller PowerOffice.</p>
      </div>
      <div class="getting-started-card" onclick="showImportModal()">
        <div class="getting-started-card-icon">
          <i class="fas fa-file-excel"></i>
        </div>
        <h3>Importer fra Excel / CSV</h3>
        <p>Last opp en fil med dine eksisterende kundedata.</p>
      </div>
      <div class="getting-started-card" onclick="dismissGettingStartedBanner(); addCustomer();">
        <div class="getting-started-card-icon">
          <i class="fas fa-plus-circle"></i>
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

// Load saved routes
async function loadRoutes() {
  try {
    const response = await apiFetch('/api/ruter');
    if (!response.ok) throw new Error(`HTTP ${response.status}: Kunne ikke laste ruter`);
    const ruterResult = await response.json();
    savedRoutes = ruterResult.data || ruterResult;
    renderSavedRoutes();
  } catch (error) {
    console.error('Feil ved lasting av ruter:', error);
  }
}

// Render område filter dropdown
function renderOmradeFilter() {
  const filterContainer = document.getElementById('omradeFilter');
  if (!filterContainer) return;

  filterContainer.innerHTML = `
    <select id="omradeSelect">
      <option value="alle">Alle områder</option>
      <option value="varsler">Trenger kontroll</option>
      ${omrader.map(o => `<option value="${escapeHtml(o.poststed)}">${escapeHtml(o.poststed)} (${o.antall})</option>`).join('')}
    </select>
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
  });
}

// Apply all filters
async function applyFilters() {
  // Avbryt pågående request for å unngå race condition
  if (filterAbortController) {
    filterAbortController.abort();
  }
  filterAbortController = new AbortController();

  let filtered = [...customers];
  const searchQuery = searchInput?.value?.toLowerCase() || '';

  // Category filter - exact match
  if (selectedCategory !== 'all') {
    const beforeCount = filtered.length;
    filtered = filtered.filter(c => c.kategori === selectedCategory);
    Logger.log(`applyFilters: "${selectedCategory}" - ${beforeCount} -> ${filtered.length} kunder`);
  }

  // Driftskategori filter (uses normalized values)
  if (selectedDriftskategori !== 'all') {
    filtered = filtered.filter(c => normalizeDriftstype(c.brann_driftstype) === selectedDriftskategori);
  }

  // Brannsystem filter (uses normalized categories: Elotec, ICAS, Begge, Annet)
  if (selectedBrannsystem !== 'all') {
    filtered = filtered.filter(c => normalizeBrannsystem(c.brann_system) === selectedBrannsystem);
  }

  // Kundetype filter (el_type: Landbruk, Næring, Bolig, etc.)
  if (selectedElType !== 'all') {
    filtered = filtered.filter(c => c.el_type === selectedElType);
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
  const elCount = customers.filter(c => c.kategori === 'El-Kontroll').length;
  const brannCount = customers.filter(c => c.kategori === 'Brannvarsling').length;
  const beggeCount = customers.filter(c => c.kategori === 'El-Kontroll + Brannvarsling').length;

  // Update category-btn (left sidebar)
  const allBtn = document.querySelector('[data-category="all"]');
  const elBtn = document.querySelector('[data-category="El-Kontroll"]');
  const brannBtn = document.querySelector('[data-category="Brannvarsling"]');
  const beggeBtn = document.querySelector('[data-category="El-Kontroll + Brannvarsling"]');

  if (allBtn) allBtn.innerHTML = `<i class="fas fa-list"></i> Alle (${customers.length})`;
  if (elBtn) elBtn.innerHTML = `<i class="fas fa-bolt"></i> El-Kontroll (${elCount})`;
  if (brannBtn) brannBtn.innerHTML = `<i class="fas fa-fire"></i> Brannvarsling (${brannCount})`;
  if (beggeBtn) beggeBtn.innerHTML = `<i class="fas fa-bolt"></i><i class="fas fa-fire"></i> Begge (${beggeCount})`;

  // Update kategori-tabs (right sidebar) - preserve icons by using innerHTML
  const alleTab = document.querySelector('[data-kategori="alle"]');
  const elTab = document.querySelector('[data-kategori="El-Kontroll"]');
  const brannTab = document.querySelector('[data-kategori="Brannvarsling"]');
  const beggeTab = document.querySelector('[data-kategori="El-Kontroll + Brannvarsling"]');

  if (alleTab) alleTab.innerHTML = `Alle (${customers.length})`;
  if (elTab) elTab.innerHTML = `${serviceTypeRegistry.getIcon(serviceTypeRegistry.getBySlug('el-kontroll'))} El-Kontroll (${elCount})`;
  if (brannTab) brannTab.innerHTML = `${serviceTypeRegistry.getIcon(serviceTypeRegistry.getBySlug('brannvarsling'))} Brannvarsling (${brannCount})`;
  if (beggeTab) {
    const elIcon = serviceTypeRegistry.getIcon(serviceTypeRegistry.getBySlug('el-kontroll'));
    const brannIcon = serviceTypeRegistry.getIcon(serviceTypeRegistry.getBySlug('brannvarsling'));
    beggeTab.innerHTML = `${elIcon}${brannIcon} Begge (${beggeCount})`;
  }

  // Update driftskategori filter counts
  const driftCategories = ['Storfe', 'Sau', 'Geit', 'Gris', 'Gartneri', 'Storfe/Sau'];
  driftCategories.forEach(drift => {
    const btn = document.querySelector(`[data-drift="${drift}"]`);
    if (btn) {
      const count = customers.filter(c => c.brann_driftstype === drift).length;
      btn.textContent = `${drift} (${count})`;
    }
  });

  // Update "Alle" button for drift
  const allDriftBtn = document.querySelector('[data-drift="all"]');
  const driftCount = customers.filter(c => c.brann_driftstype).length;
  if (allDriftBtn) allDriftBtn.innerHTML = `<i class="fas fa-list"></i> Alle (${driftCount})`;
}

// Add Norway border visualization
function addNorwayBorder() {
  // Norge-Sverige grense (forenklet men synlig)
  const borderCoords = [
    [69.06, 20.55], // Treriksrøysa (Norge-Sverige-Finland)
    [68.95, 20.10],
    [68.45, 18.10],
    [68.15, 17.90],
    [67.95, 17.15],
    [67.50, 16.40],
    [66.60, 15.50],
    [66.15, 14.60],
    [65.10, 14.25],
    [64.15, 13.95],
    [63.70, 12.70],
    [62.65, 12.30],
    [61.80, 12.10],
    [61.00, 12.15],
    [59.80, 11.80],
    [59.10, 11.45],
    [58.95, 11.15]  // Svinesund
  ];

  // Grense som stiplet linje
  L.polyline(borderCoords, {
    color: '#ef4444',
    weight: 2,
    opacity: 0.7,
    dashArray: '8, 4'
  }).addTo(map);

  // Sverige-etikett (nærmere grensen i Troms-området)
  L.marker([68.5, 19.5], {
    icon: L.divIcon({
      className: 'country-label',
      html: '<span>SVERIGE</span>',
      iconSize: [100, 20]
    })
  }).addTo(map);

  // Dim overlay over Sverige (øst for grensen)
  L.polygon([
    [71.5, 20.5], [71.5, 32.0], [58.0, 32.0], [58.0, 11.0],
    [59.0, 11.5], [61.0, 12.2], [63.5, 12.5], [66.0, 14.5],
    [68.0, 17.5], [69.0, 20.0], [71.5, 20.5]
  ], {
    color: 'transparent',
    fillColor: '#000',
    fillOpacity: 0.25,
    interactive: false
  }).addTo(map);
}

// Create custom cluster icon with area name and warning count
function createClusterIcon(cluster) {
  const markers = cluster.getAllChildMarkers();
  const areaNames = new Set();
  let warningCount = 0;

  // Collect all unique area names and count warnings from marker options (not popup)
  markers.forEach(marker => {
    // Use stored customer data on marker (set in renderMarkers)
    const customerData = marker.options.customerData;
    if (customerData) {
      if (customerData.poststed) {
        areaNames.add(customerData.poststed);
      }
      if (customerData.hasWarning) {
        warningCount++;
      }
    }
  });

  const size = markers.length;
  const warningBadge = warningCount > 0 ? `<div class="cluster-warning">${warningCount}</div>` : '';

  // Use "Region Nord" only when nearly all customers are clustered (zoomed fully out)
  let areaText;
  if (size >= 100) {
    areaText = 'Region Nord';
  } else {
    areaText = Array.from(areaNames).slice(0, 2).join(' / ');
  }

  // Size class determines color gradient (green → blue → orange → red)
  let sizeClass = 'cluster-small';
  if (size >= 50) sizeClass = 'cluster-xlarge';
  else if (size >= 20) sizeClass = 'cluster-large';
  else if (size >= 8) sizeClass = 'cluster-medium';

  return L.divIcon({
    html: `
      <div class="cluster-icon ${sizeClass}">
        <div class="cluster-count">${size}</div>
        <div class="cluster-area">${areaText}</div>
        ${warningBadge}
      </div>
    `,
    className: 'custom-cluster',
    iconSize: [70, 70],
    iconAnchor: [35, 35]
  });
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

  if (daysUntil < 0) {
    return { status: 'forfalt', label: `${Math.abs(daysUntil)} dager over`, class: 'status-overdue', date: dateFormatted, daysUntil };
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

// Generate popup content lazily (performance optimization - only called when popup opens)
function generatePopupContent(customer) {
  const isSelected = selectedCustomers.has(customer.id);
  const controlStatus = getControlStatus(customer);
  const hasEmail = customer.epost && customer.epost.trim() !== '';

  // Generate dynamic popup control info based on selected industry
  const kontrollInfoHtml = serviceTypeRegistry.renderPopupControlInfo(customer, controlStatus);

  // Generate dynamic industry-specific fields
  const industryFieldsHtml = serviceTypeRegistry.renderPopupIndustryFields(customer);

  // Generate custom organization fields from Excel import
  const customFieldsHtml = renderPopupCustomFields(customer);

  // Fallback: show el_type, brann_system, brann_driftstype directly if not rendered by service type registry
  let directFieldsHtml = '';
  if (!industryFieldsHtml) {
    if (customer.el_type) directFieldsHtml += `<p><strong>Type:</strong> ${escapeHtml(customer.el_type)}</p>`;
    if (customer.brann_system) directFieldsHtml += `<p><strong>Brannsystem:</strong> ${escapeHtml(customer.brann_system)}</p>`;
    if (customer.brann_driftstype) directFieldsHtml += `<p><strong>Driftstype:</strong> ${escapeHtml(customer.brann_driftstype)}</p>`;
  }
  // Extract org_nr from notater [ORGNR:X] tag
  if (customer.notater) {
    const orgNrMatch = customer.notater.match(/\[ORGNR:(\d{9})\]/);
    if (orgNrMatch) directFieldsHtml += `<p><strong>Org.nr:</strong> ${escapeHtml(orgNrMatch[1])}</p>`;
  }

  // Show notater if present (strip internal tags for cleaner display)
  let notatHtml = '';
  if (customer.notater) {
    const cleanedNotater = customer.notater
      .replace(/\[TRIPLETEX:[^\]]*\]\s*/g, '')
      .replace(/\[ORGNR:[^\]]*\]\s*/g, '')
      .replace(/^\s*\|\s*/, '')
      .trim();
    if (cleanedNotater) {
      notatHtml = `<p class="popup-notater"><strong>Notater:</strong> ${escapeHtml(cleanedNotater)}</p>`;
    }
  }

  return `
    <h3>${escapeHtml(customer.navn)}</h3>
    <p><strong>Kategori:</strong> ${escapeHtml(customer.kategori || 'Annen')}</p>
    ${industryFieldsHtml}
    ${directFieldsHtml}
    ${customFieldsHtml}
    <p>${escapeHtml(customer.adresse)}</p>
    <p>${escapeHtml(customer.postnummer || '')} ${escapeHtml(customer.poststed || '')}</p>
    ${customer.telefon ? `<p>Tlf: ${escapeHtml(customer.telefon)}</p>` : ''}
    ${customer.epost ? `<p>E-post: ${escapeHtml(customer.epost)}</p>` : ''}
    ${kontrollInfoHtml}
    ${notatHtml}
    <div class="popup-actions">
      <button class="btn btn-small btn-navigate" data-action="navigateToCustomer" data-lat="${customer.lat}" data-lng="${customer.lng}" data-name="${escapeHtml(customer.navn)}">
        <i class="fas fa-directions"></i> Naviger
      </button>
      <button class="btn btn-small btn-primary" data-action="toggleCustomerSelection" data-customer-id="${customer.id}">
        ${isSelected ? 'Fjern fra rute' : 'Legg til rute'}
      </button>
      <button class="btn btn-small btn-success" data-action="quickMarkVisited" data-customer-id="${customer.id}">
        <i class="fas fa-check"></i> Marker besøkt
      </button>
      <button class="btn btn-small ${bulkSelectedCustomers.has(customer.id) ? 'btn-warning' : 'btn-complete'}"
              data-action="toggleBulkSelect"
              data-customer-id="${customer.id}">
        <i class="fas ${bulkSelectedCustomers.has(customer.id) ? 'fa-check-circle' : 'fa-list'}"></i>
        ${bulkSelectedCustomers.has(customer.id) ? 'I avhuking' : 'Legg til avhuking'}
      </button>
      <button class="btn btn-small btn-secondary" data-action="editCustomer" data-customer-id="${customer.id}">
        Rediger
      </button>
      <button class="btn btn-small ${hasEmail ? 'btn-email' : 'btn-disabled'}"
              data-action="sendEmail"
              data-customer-id="${customer.id}"
              ${hasEmail ? '' : 'disabled'}>
        <i class="fas fa-envelope"></i> E-post
      </button>
    </div>
  `;
}

// ========================================
// CONTEXT MENU (Feature: context_menu)
// Right-click menu on map markers
// ========================================

let activeContextMenu = null;
let contextMenuCustomerId = null;

function showMarkerContextMenu(customer, x, y) {
  closeContextMenu();
  contextMenuCustomerId = customer.id;

  const menu = document.createElement('div');
  menu.className = 'marker-context-menu';
  menu.setAttribute('role', 'menu');

  const isSelected = selectedCustomers.has(customer.id);
  const isBulkSelected = bulkSelectedCustomers.has(customer.id);
  const hasEmail = customer.epost && customer.epost.trim() !== '';

  // Build menu items dynamically based on enabled features
  let menuHtml = `
    <div class="context-menu-header">${escapeHtml(customer.navn)}</div>
    <div class="context-menu-item" role="menuitem" data-action="ctx-details" data-id="${customer.id}">
      <i class="fas fa-info-circle"></i> Se detaljer
    </div>
    <div class="context-menu-item" role="menuitem" data-action="ctx-navigate" data-lat="${customer.lat}" data-lng="${customer.lng}">
      <i class="fas fa-directions"></i> Naviger hit
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" role="menuitem" data-action="ctx-add-route" data-id="${customer.id}">
      <i class="fas fa-route"></i> ${isSelected ? 'Fjern fra rute' : 'Legg til i rute'}
    </div>
    <div class="context-menu-item" role="menuitem" data-action="ctx-mark-complete" data-id="${customer.id}">
      <i class="fas ${isBulkSelected ? 'fa-check-circle' : 'fa-check'}"></i> ${isBulkSelected ? 'Fjern ferdig-markering' : 'Marker som ferdig'}
    </div>`;

  // Email option (feature: email_templates or always if email exists)
  if (hasEmail) {
    menuHtml += `
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" role="menuitem" data-action="ctx-email" data-id="${customer.id}">
      <i class="fas fa-envelope"></i> Send e-post
    </div>`;
  }

  // Tripletex project creation (feature: tripletex_projects)
  if (hasFeature('tripletex_projects') && appConfig.integrations?.tripletex?.active !== false) {
    const categories = getFeatureConfig('tripletex_projects')?.project_categories || [
      { key: 'elkontroll', label: '01 - Elkontroll' },
      { key: 'arskontroll', label: '02 - Årskontroll' },
      { key: 'begge', label: '03 - Begge' }
    ];

    menuHtml += `
    <div class="context-menu-divider"></div>
    <div class="context-menu-item context-menu-parent" role="menuitem">
      <span><i class="fas fa-folder-plus"></i> Opprett prosjekt</span>
      <i class="fas fa-chevron-right context-menu-arrow"></i>
      <div class="context-menu-submenu" role="menu">
        ${categories.map(cat => `
          <div class="context-menu-item" role="menuitem" data-action="ctx-create-project" data-id="${customer.id}" data-type="${escapeHtml(cat.key)}">
            ${escapeHtml(cat.label)}
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  // Push/sync customer to Tripletex (if Tripletex is connected)
  if (appConfig.integrations?.tripletex?.active !== false) {
    const isLinked = customer.external_source === 'tripletex' && customer.external_id;
    menuHtml += `
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" role="menuitem" data-action="ctx-push-tripletex" data-id="${customer.id}">
      <i class="fas ${isLinked ? 'fa-sync' : 'fa-cloud-upload-alt'}"></i> ${isLinked ? 'Oppdater i Tripletex' : 'Opprett i Tripletex'}
    </div>`;
  }

  menu.innerHTML = menuHtml;

  // Position menu within viewport bounds
  document.body.appendChild(menu);
  const menuRect = menu.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  if (x + menuRect.width > viewportW) x = viewportW - menuRect.width - 8;
  if (y + menuRect.height > viewportH) y = viewportH - menuRect.height - 8;
  if (x < 8) x = 8;
  if (y < 8) y = 8;

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  activeContextMenu = menu;

  // Event delegation for menu items
  menu.addEventListener('click', handleContextMenuClick);

  // Close on outside click (deferred to avoid immediate close)
  requestAnimationFrame(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
    document.addEventListener('contextmenu', closeContextMenu, { once: true });
  });

  // Close on Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
    contextMenuCustomerId = null;
  }
}

function handleContextMenuClick(e) {
  const item = e.target.closest('[data-action]');
  if (!item) return;

  const action = item.dataset.action;
  const id = Number(item.dataset.id);

  closeContextMenu();

  switch (action) {
    case 'ctx-details':
      editCustomer(id);
      break;
    case 'ctx-navigate': {
      const lat = Number(item.dataset.lat);
      const lng = Number(item.dataset.lng);
      navigateToCustomer(lat, lng);
      break;
    }
    case 'ctx-add-route':
      toggleCustomerSelection(id);
      break;
    case 'ctx-mark-complete':
      toggleBulkSelectFromMap(id);
      break;
    case 'ctx-email':
      // Open email dialog for this customer
      if (typeof openEmailDialog === 'function') {
        openEmailDialog(id);
      } else {
        // Fallback: open customer edit dialog on contact tab
        editCustomer(id);
      }
      break;
    case 'ctx-create-project': {
      const projectType = item.dataset.type;
      createTripletexProjectFromMenu(id, projectType);
      break;
    }
    case 'ctx-push-tripletex':
      pushCustomerToTripletex(id);
      break;
  }
}

// Create a Tripletex project from the map context menu
async function createTripletexProjectFromMenu(kundeId, projectType) {
  try {
    showNotification('Oppretter prosjekt i Tripletex...', 'info');

    const featureConfig = getFeatureConfig('tripletex_projects');
    const categories = featureConfig?.project_categories || [];
    const matchedCategory = categories.find(c => c.key === projectType);

    const response = await apiFetch('/api/integrations/tripletex/create-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kunde_id: kundeId,
        category_id: matchedCategory?.tripletex_category_id || null,
        description: matchedCategory?.label || projectType,
      }),
    });

    const data = await response.json();

    if (data.success) {
      showNotification(`Prosjekt ${data.data.projectNumber} opprettet i Tripletex`, 'success');

      // Update the local customer data with the new project number
      const customer = customers.find(c => c.id === kundeId);
      if (customer) {
        const existing = customer.prosjektnummer ? customer.prosjektnummer.split(', ') : [];
        existing.push(data.data.projectNumber);
        customer.prosjektnummer = existing.join(', ');
      }
    } else {
      showNotification(data.error || 'Kunne ikke opprette prosjekt', 'error');
    }
  } catch (error) {
    console.error('Tripletex project creation failed:', error);
    showNotification('Feil ved opprettelse av prosjekt i Tripletex', 'error');
  }
}

// Push (create or update) a customer to Tripletex
async function pushCustomerToTripletex(kundeId) {
  try {
    const customer = customers.find(c => c.id === kundeId);
    const isUpdate = customer?.external_source === 'tripletex' && customer?.external_id;
    showNotification(isUpdate ? 'Oppdaterer kunde i Tripletex...' : 'Oppretter kunde i Tripletex...', 'info');

    const response = await apiFetch('/api/integrations/tripletex/push-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kunde_id: kundeId }),
    });

    const data = await response.json();

    if (data.success) {
      showNotification(data.message, 'success');

      // Update local customer data with Tripletex link
      if (customer && data.data.action === 'created') {
        customer.external_source = 'tripletex';
        customer.external_id = String(data.data.tripletexId);
        if (data.data.customerNumber) {
          customer.kundenummer = String(data.data.customerNumber);
        }
      }
    } else {
      showNotification(data.error || 'Kunne ikke sende kunde til Tripletex', 'error');
    }
  } catch (error) {
    console.error('Tripletex customer push failed:', error);
    showNotification('Feil ved sending av kunde til Tripletex', 'error');
  }
}

// ========================================
// HOVER TOOLTIP (Feature: hover_tooltip)
// Lightweight info on marker hover
// ========================================

let activeTooltipEl = null;

function showMarkerTooltip(customer, markerIconEl, mouseEvent) {
  hideMarkerTooltip();

  const controlStatus = getControlStatus(customer);

  // Get service type summary
  let serviceInfo = 'Ikke spesifisert';
  if (customer.services && customer.services.length > 0) {
    serviceInfo = customer.services.map(s => s.service_type_name).filter(Boolean).join(', ');
  } else if (customer.kategori) {
    serviceInfo = customer.kategori;
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'marker-hover-tooltip';
  tooltip.innerHTML = `
    <div class="tooltip-header">${escapeHtml(customer.navn)}</div>
    <div class="tooltip-body">
      <div class="tooltip-row"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(customer.adresse || '')}</div>
      ${customer.telefon ? `<div class="tooltip-row"><i class="fas fa-phone"></i> ${escapeHtml(customer.telefon)}</div>` : ''}
      <div class="tooltip-service"><i class="fas fa-tools"></i> ${escapeHtml(serviceInfo)}</div>
      <div class="tooltip-status ${controlStatus.class}">${escapeHtml(controlStatus.label)}</div>
    </div>
  `;

  document.body.appendChild(tooltip);

  // Position: use mouse coordinates if available, fall back to marker icon position
  const tooltipRect = tooltip.getBoundingClientRect();
  let left, top;

  if (mouseEvent) {
    left = mouseEvent.clientX + 12;
    top = mouseEvent.clientY - 10;
  } else if (markerIconEl) {
    const rect = markerIconEl.getBoundingClientRect();
    left = rect.left + rect.width / 2 + 12;
    top = rect.top - 4;
  } else {
    left = 100;
    top = 100;
  }

  // Keep within viewport
  if (left + tooltipRect.width > window.innerWidth) {
    left = (mouseEvent ? mouseEvent.clientX : left) - tooltipRect.width - 12;
  }
  if (top + tooltipRect.height > window.innerHeight) {
    top = window.innerHeight - tooltipRect.height - 8;
  }
  if (left < 4) left = 4;
  if (top < 4) top = 4;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  activeTooltipEl = tooltip;
}

function hideMarkerTooltip() {
  if (activeTooltipEl) {
    activeTooltipEl.remove();
    activeTooltipEl = null;
  }
}

// ========================================

// Render markers on map
let renderMarkersRetryCount = 0;
const MAX_RENDER_RETRIES = 10;

function renderMarkers(customerData) {
  // Don't render markers if still on login view (prevents markers showing through login overlay)
  if (currentView === 'login') {
    Logger.log('renderMarkers skipped - still on login view');
    renderMarkersRetryCount = 0;
    return;
  }

  // Safety check - markerClusterGroup must be initialized
  if (!markerClusterGroup) {
    if (renderMarkersRetryCount >= MAX_RENDER_RETRIES) {
      console.error('renderMarkers failed after max retries - markerClusterGroup never initialized');
      renderMarkersRetryCount = 0;
      return;
    }
    renderMarkersRetryCount++;
    console.error(`renderMarkers called but markerClusterGroup is null - retry ${renderMarkersRetryCount}/${MAX_RENDER_RETRIES}`);
    setTimeout(() => renderMarkers(customerData), 100);
    return;
  }

  // Reset retry count on successful render
  renderMarkersRetryCount = 0;

  // Clear existing markers from cluster (with error handling for animation edge cases)
  try {
    markerClusterGroup.clearLayers();
  } catch (e) {
    // Leaflet animation race condition - recreate cluster group
    console.warn('clearLayers failed, recreating cluster group:', e.message);
    map.removeLayer(markerClusterGroup);
    markerClusterGroup = L.markerClusterGroup({
      maxClusterRadius: appConfig.mapClusterRadius || 60,
      iconCreateFunction: createClusterIcon,
      disableClusteringAtZoom: 14,
      spiderfyOnMaxZoom: true,
      spiderfyOnEveryZoom: false,
      spiderfyDistanceMultiplier: 2.5,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      animate: true,
      animateAddingMarkers: false,
      singleMarkerMode: false
    });
    map.addLayer(markerClusterGroup);
  }
  markers = {};

  // Log what we're rendering
  const kategorier = {};
  customerData.forEach(c => {
    const kat = c.kategori || 'null';
    kategorier[kat] = (kategorier[kat] || 0) + 1;
  });
  Logger.log('renderMarkers:', customerData.length, 'kunder', kategorier);

  // Collect markers to add with staggered animation
  const markersToAdd = [];

  customerData.forEach(customer => {
    if (customer.lat && customer.lng) {
      const isSelected = selectedCustomers.has(customer.id);
      const controlStatus = getControlStatus(customer);

      // Create marker with simplified label (performance optimization)
      const shortName = customer.navn.length > 20 ? customer.navn.substring(0, 18) + '...' : customer.navn;

      // Show warning icon for urgent statuses
      const showWarning = controlStatus.status === 'forfalt' || controlStatus.status === 'denne-uke' || controlStatus.status === 'snart';
      const warningBadge = showWarning ? '<span class="marker-warning-badge">!</span>' : '';

      // Determine category icon dynamically from ServiceTypeRegistry
      let categoryIcon, categoryClass;
      const serviceTypes = serviceTypeRegistry.getAll();
      if (customer.kategori && serviceTypes.length > 0) {
        // Use the customer's own category to determine icon
        categoryIcon = serviceTypeRegistry.getIconForCategory(customer.kategori);
        categoryClass = serviceTypeRegistry.getCategoryClass(customer.kategori);
      } else if (serviceTypes.length > 0) {
        const defaultSt = serviceTypeRegistry.getDefaultServiceType();
        categoryIcon = serviceTypeRegistry.getIconForCategory(defaultSt.name);
        categoryClass = serviceTypeRegistry.getCategoryClass(defaultSt.name);
      } else {
        categoryIcon = `<span class="marker-svg-icon">${svgIcons['service']}</span>`;
        categoryClass = 'service';
      }

      const icon = L.divIcon({
        className: `custom-marker-with-label ${isSelected ? 'selected' : ''} ${controlStatus.class}`,
        html: `
          <div class="marker-icon ${categoryClass} ${controlStatus.class}" data-status="${controlStatus.status}">
            ${categoryIcon}
            ${warningBadge}
          </div>
          <div class="marker-label">
            <span class="marker-name">${escapeHtml(shortName)}</span>
          </div>
        `,
        iconSize: [42, 42],
        iconAnchor: [21, 35]
      });

      // Lazy popup - generate content only when opened (performance optimization)
      // Store customer data on marker for cluster icon (avoids parsing popup content)
      const marker = L.marker([customer.lat, customer.lng], {
        icon,
        customerData: {
          poststed: customer.poststed,
          hasWarning: showWarning
        }
      }).bindPopup(() => generatePopupContent(customer), { maxWidth: 350 });

      marker.on('click', () => {
        marker.openPopup();
      });

      // Context menu (right-click on PC, long-press on mobile)
      // Leaflet contextmenu event on marker
      marker.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        showMarkerContextMenu(customer, e.originalEvent.clientX, e.originalEvent.clientY);
      });

      // Also attach native contextmenu to DOM element for reliability
      // Leaflet's divIcon can miss events depending on click target within the icon
      marker.on('add', () => {
        const el = marker.getElement();
        if (el) {
          el.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            showMarkerContextMenu(customer, ev.clientX, ev.clientY);
          });
        }
      });

      // Long-press for mobile (500ms threshold)
      let longPressTimer = null;
      marker.on('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          const touch = e.originalEvent.touches[0];
          if (touch) {
            showMarkerContextMenu(customer, touch.clientX, touch.clientY);
          }
        }, 500);
      });
      marker.on('touchend touchmove', () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });

      // Hover tooltip (PC only - mouseover)
      if (hasFeature('hover_tooltip')) {
        marker.on('mouseover', (e) => {
          if (window.innerWidth > 768 && !marker.isPopupOpen()) {
            showMarkerTooltip(customer, e.target._icon, e.originalEvent);
          }
        });
        marker.on('mouseout', () => {
          hideMarkerTooltip();
        });
        marker.on('popupopen', () => {
          hideMarkerTooltip();
        });
      }

      // Drag-to-category: custom drag with mousedown/mousemove/mouseup
      marker.on('add', () => {
        const el = marker.getElement();
        if (el && !el.dataset.dragInit) {
          el.dataset.dragInit = 'true';
          el.dataset.customerId = String(customer.id);
          let dragTimeout = null;

          el.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return; // Only left click
            const startX = ev.clientX;
            const startY = ev.clientY;
            let isDragging = false;

            // Start drag after holding 300ms (avoids conflict with click)
            dragTimeout = setTimeout(() => {
              isDragging = true;
              map.dragging.disable();
              startMarkerDrag(customer.id, startX, startY);
            }, 300);

            const onMouseMove = (moveEv) => {
              // Cancel if mouse moved significantly before timeout (user is panning)
              if (!isDragging) {
                const dist = Math.abs(moveEv.clientX - startX) + Math.abs(moveEv.clientY - startY);
                if (dist > 10) {
                  clearTimeout(dragTimeout);
                  document.removeEventListener('mousemove', onMouseMove);
                  document.removeEventListener('mouseup', onMouseUp);
                }
                return;
              }
              updateMarkerDrag(moveEv.clientX, moveEv.clientY);
            };

            const onMouseUp = () => {
              clearTimeout(dragTimeout);
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
              if (isDragging) {
                endMarkerDrag(customer.id);
                map.dragging.enable();
              }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          });
        }
      });

      // Collect marker for staggered animation
      markersToAdd.push({ marker, customerId: customer.id });
      markers[customer.id] = marker;
    }
  });

  // Add markers to the map
  if (markersToAdd.length > 0) {
    // Add all markers at once
    markersToAdd.forEach(item => {
      markerClusterGroup.addLayer(item.marker);
    });
    Logger.log('renderMarkers: Added', markersToAdd.length, 'markers to cluster group');
  }
}

// Focus on customer on map
function focusOnCustomer(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  // On mobile: close content panel and switch to map view
  if (isMobile && document.getElementById('bottomTabBar')) {
    closeContentPanelMobile();
    hideMobileFilterSheet();
    document.querySelectorAll('.bottom-tab-item').forEach(b =>
      b.classList.toggle('active', b.dataset.bottomTab === 'map')
    );
    activeBottomTab = 'map';
    const searchFab = document.getElementById('mobileSearchFab');
    if (searchFab) searchFab.classList.remove('hidden');
  }

  if (customer.lat && customer.lng) {
    const delay = isMobile ? 150 : 0;
    setTimeout(() => {
      map.invalidateSize();
      map.setView([customer.lat, customer.lng], 14);
      if (markers[customerId]) {
        markers[customerId].openPopup();
      }
    }, delay);
  } else {
    showNotification(`${customer.navn} mangler koordinater - bruk geokoding`);
  }
}

// Toggle customer selection
function toggleCustomerSelection(customerId) {
  if (selectedCustomers.has(customerId)) {
    selectedCustomers.delete(customerId);
  } else {
    selectedCustomers.add(customerId);
  }
  updateSelectionUI();
}

// Update UI based on selection
function updateSelectionUI() {
  selectedCount.textContent = selectedCustomers.size;
  planRouteBtn.disabled = selectedCustomers.size < 2;
  clearSelectionBtn.disabled = selectedCustomers.size === 0;

  // Update mobile FAB visibility
  const mobileRouteFab = document.getElementById('mobileRouteBtn');
  const mobileRouteCount = document.getElementById('mobileRouteCount');
  if (mobileRouteFab && mobileRouteCount) {
    if (selectedCustomers.size >= 2) {
      mobileRouteFab.classList.remove('hidden');
      mobileRouteCount.textContent = selectedCustomers.size;
    } else {
      mobileRouteFab.classList.add('hidden');
    }
  }

  // Update mobile selection indicator
  updateMobileSelectionFab();

  // Update list items
  document.querySelectorAll('.customer-item').forEach(item => {
    const id = Number.parseInt(item.dataset.id);
    item.classList.toggle('selected', selectedCustomers.has(id));
  });

  // Update markers
  renderMarkers(customers);
}

// Clear selection
function clearSelection() {
  selectedCustomers.clear();
  updateSelectionUI();
  clearRoute();
}

// ===== BULK SELECTION FOR "MARKER SOM FERDIG" =====

// Update the bulk selection UI (floating action bar)
function updateBulkSelectionUI() {
  let actionBar = document.getElementById('bulkActionBar');

  // Create action bar if it doesn't exist
  if (!actionBar) {
    actionBar = document.createElement('div');
    actionBar.id = 'bulkActionBar';
    actionBar.className = 'bulk-action-bar';
    document.body.appendChild(actionBar);
  }

  // Get selected customer names
  const selectedNames = Array.from(bulkSelectedCustomers)
    .map(id => customers.find(c => c.id === id))
    .filter(c => c)
    .map(c => c.navn);

  // Update content with customer names
  actionBar.innerHTML = `
    <div class="bulk-action-content">
      <div class="bulk-info">
        <span class="bulk-count"><i class="fas fa-check-circle"></i> ${bulkSelectedCustomers.size} valgt for avhuking</span>
        ${selectedNames.length > 0 ? `
          <div class="bulk-names">
            ${selectedNames.slice(0, 5).map(n => `<span class="bulk-name-tag">${escapeHtml(n)}</span>`).join('')}
            ${selectedNames.length > 5 ? `<span class="bulk-name-more">+${selectedNames.length - 5} flere</span>` : ''}
          </div>
        ` : ''}
      </div>
      <div class="bulk-actions">
        <button class="btn btn-secondary btn-sm" onclick="clearBulkSelection()">
          <i class="fas fa-times"></i> Avbryt
        </button>
        <button class="btn btn-success btn-sm" onclick="executeAvhuking()">
          <i class="fas fa-check"></i> Marker som besøkt
        </button>
      </div>
    </div>
  `;

  // Show/hide action bar
  if (bulkSelectedCustomers.size > 0) {
    actionBar.classList.add('visible');
  } else {
    actionBar.classList.remove('visible');
  }
}

// Clear bulk selection
function clearBulkSelection() {
  bulkSelectedCustomers.clear();
  updateBulkSelectionUI();
  renderAvhukingTab();
  renderCustomerAdmin();
}

// Render the Avhuking tab content
function renderAvhukingTab() {
  const container = document.getElementById('avhukingList');
  const countHeader = document.getElementById('avhukingCountHeader');
  const badge = document.getElementById('avhukingBadge');
  const clearBtn = document.getElementById('clearAvhukingBtn');
  const completeBtn = document.getElementById('completeAvhukingBtn');
  const optionsPanel = document.getElementById('avhukingOptions');
  const actionsPanel = document.getElementById('avhukingActions');
  const dateInput = document.getElementById('avhukingDate');

  if (!container) return;

  const count = bulkSelectedCustomers.size;

  // Update header count
  if (countHeader) {
    countHeader.textContent = `${count} valgt`;
  }

  // Update badge
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  // Show/hide options and actions panels
  if (optionsPanel) optionsPanel.style.display = count > 0 ? 'block' : 'none';
  if (actionsPanel) actionsPanel.style.display = count > 0 ? 'flex' : 'none';

  // Set default date to today if not already set
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  // Render dynamic kontroll type checkboxes from serviceTypeRegistry
  const kontrollContainer = document.getElementById('avhukingKontrollTypes');
  if (kontrollContainer && !kontrollContainer.dataset.initialized) {
    const serviceTypes = serviceTypeRegistry.getAll();
    if (serviceTypes.length > 0) {
      kontrollContainer.innerHTML = serviceTypes.map(st => `
        <label class="avhuking-checkbox-label">
          <input type="checkbox" class="avhuking-kontroll-cb" data-slug="${escapeHtml(st.slug)}" checked>
          <span><i class="fas ${escapeHtml(st.icon || 'fa-wrench')}" style="color:${escapeHtml(st.color || '#F97316')}"></i> ${escapeHtml(st.name)}</span>
        </label>
      `).join('');
    } else {
      kontrollContainer.innerHTML = '<p class="avhuking-kontroll-hint">Ingen tjenestetyper konfigurert</p>';
    }
    kontrollContainer.dataset.initialized = 'true';
  }

  // Enable/disable buttons
  if (clearBtn) clearBtn.disabled = count === 0;
  if (completeBtn) completeBtn.disabled = count === 0;

  // Render list
  if (count === 0) {
    container.innerHTML = `
      <div class="avhuking-empty">
        <i class="fas fa-clipboard-list"></i>
        <p>Ingen kunder valgt</p>
        <span>Klikk "Legg til avhuking" på en kunde i kartet</span>
      </div>
    `;
    return;
  }

  // Get selected customers
  const selectedCustomers = Array.from(bulkSelectedCustomers)
    .map(id => customers.find(c => c.id === id))
    .filter(c => c);

  container.innerHTML = selectedCustomers.map(c => {
    return `
      <div class="avhuking-item" data-id="${c.id}">
        <div class="avhuking-item-info">
          <span class="avhuking-item-name">${escapeHtml(c.navn)}</span>
          <span class="avhuking-item-address">${escapeHtml(c.adresse || '')}${c.poststed ? `, ${escapeHtml(c.poststed)}` : ''}</span>
        </div>
        <div class="avhuking-item-actions">
          <button class="btn btn-small btn-secondary" data-action="focusAvhukingCustomer" data-customer-id="${c.id}" title="Vis på kart">
            <i class="fas fa-map-marker-alt"></i>
          </button>
          <button class="btn btn-small btn-danger" data-action="removeFromAvhuking" data-customer-id="${c.id}" title="Fjern">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}


// Remove customer from avhuking list
function removeFromAvhuking(customerId) {
  bulkSelectedCustomers.delete(customerId);
  updateBulkSelectionUI();
  renderAvhukingTab();
  renderCustomerAdmin();

  const customer = customers.find(c => c.id === customerId);
  showNotification(`${customer?.navn || 'Kunde'} fjernet fra avhuking`);
}

// Toggle bulk select from map popup
function toggleBulkSelectFromMap(customerId) {
  if (bulkSelectedCustomers.has(customerId)) {
    bulkSelectedCustomers.delete(customerId);
  } else {
    bulkSelectedCustomers.add(customerId);
  }

  // Update the bulk selection UI (floating action bar)
  updateBulkSelectionUI();

  // Update just the button in the popup (don't re-render all markers)
  const customer = customers.find(c => c.id === customerId);
  const isNowSelected = bulkSelectedCustomers.has(customerId);

  // Find and update the button in the open popup
  const popup = document.querySelector('.leaflet-popup-content');
  if (popup) {
    const bulkBtn = popup.querySelector('[data-action="toggleBulkSelect"]');
    if (bulkBtn) {
      bulkBtn.className = `btn btn-small ${isNowSelected ? 'btn-warning' : 'btn-complete'}`;
      bulkBtn.innerHTML = `<i class="fas ${isNowSelected ? 'fa-check-circle' : 'fa-list'}"></i> ${isNowSelected ? 'I avhuking' : 'Legg til avhuking'}`;
    }
  }

  // Update avhuking tab and customer admin list
  renderAvhukingTab();
  renderCustomerAdmin();

  // Show notification
  showNotification(isNowSelected
    ? `${customer?.navn || 'Kunde'} lagt til for avhuking (${bulkSelectedCustomers.size} valgt)`
    : `${customer?.navn || 'Kunde'} fjernet fra avhuking`
  );
}

// Toggle select all visible customers
function toggleSelectAllVisible() {
  const container = document.getElementById('customerAdminList');
  const checkboxes = container.querySelectorAll('.bulk-checkbox');

  // Check if all are selected
  const allSelected = Array.from(checkboxes).every(cb => cb.checked);

  checkboxes.forEach(cb => {
    const id = Number.parseInt(cb.dataset.id);
    if (allSelected) {
      bulkSelectedCustomers.delete(id);
    } else {
      bulkSelectedCustomers.add(id);
    }
  });

  updateBulkSelectionUI();
  renderCustomerAdmin();
}

// Execute avhuking - mark selected customers as visited using inline controls
async function executeAvhuking() {
  if (bulkSelectedCustomers.size === 0) {
    showNotification('Velg minst én kunde først');
    return;
  }

  const dateInput = document.getElementById('avhukingDate');
  const dateValue = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];

  if (!dateValue) {
    showNotification('Velg en dato');
    return;
  }

  // Read dynamic kontroll checkboxes
  const kontrollCheckboxes = document.querySelectorAll('.avhuking-kontroll-cb:checked');
  const selectedSlugs = Array.from(kontrollCheckboxes).map(cb => cb.dataset.slug);

  const customerIds = Array.from(bulkSelectedCustomers);

  try {
    const response = await apiFetch('/api/kunder/mark-visited', {
      method: 'POST',
      body: JSON.stringify({
        kunde_ids: customerIds,
        visited_date: dateValue,
        service_type_slugs: selectedSlugs
      })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      const msg = selectedSlugs.length > 0
        ? `${result.data.updated} kunder markert som besøkt (kontrolldatoer oppdatert)`
        : `${result.data.updated} kunder markert som besøkt`;
      showNotification(msg);

      clearBulkSelection();
      await loadCustomers();
      renderAvhukingTab();
    } else {
      const errMsg = typeof result.error === 'string' ? result.error : (result.message || 'Kunne ikke oppdatere kunder');
      showNotification(errMsg, 'error');
    }
  } catch (error) {
    console.error('Feil ved avhuking:', error);
    showNotification('Feil ved oppdatering: ' + error.message, 'error');
  }
}

// Quick mark a single customer as visited from map popup
async function quickMarkVisited(customerId) {
  const customer = customers.find(c => c.id === customerId);
  const serviceTypes = serviceTypeRegistry.getAll();
  const today = new Date().toISOString().split('T')[0];

  // Build service type checkboxes
  const checkboxesHtml = serviceTypes.map(st => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:15px;color:var(--color-text-primary,#fff);cursor:pointer;">
      <input type="checkbox" class="qmv-kontroll-cb" data-slug="${escapeHtml(st.slug)}" checked
        style="width:20px;height:20px;accent-color:${escapeHtml(st.color || '#F97316')};">
      <i class="fas ${escapeHtml(st.icon || 'fa-clipboard-check')}" style="color:${escapeHtml(st.color || '#F97316')};"></i>
      ${escapeHtml(st.name)}
    </label>
  `).join('');

  // Create dialog overlay
  const overlay = document.createElement('div');
  overlay.className = 'qmv-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:100001;display:flex;justify-content:center;align-items:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--color-bg-secondary,#1a1a1a);border-radius:16px;max-width:400px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid var(--color-border,#333);">
      <h3 style="margin:0 0 16px;font-size:18px;color:var(--color-text-primary,#fff);">
        Marker besøkt: ${escapeHtml(customer?.navn || 'Kunde')}
      </h3>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Dato for besøk</label>
        <input type="${appConfig.datoModus === 'month_year' ? 'month' : 'date'}" id="qmvDate" value="${appConfig.datoModus === 'month_year' ? today.substring(0, 7) : today}" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);font-size:15px;">
      </div>
      ${serviceTypes.length > 0 ? `
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Oppdater kontrolldatoer</label>
          ${checkboxesHtml}
        </div>
      ` : ''}
      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button id="qmvCancel" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);cursor:pointer;">Avbryt</button>
        <button id="qmvConfirm" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:none;background:var(--color-accent,#F97316);color:#fff;cursor:pointer;">Marker besøkt</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on escape or overlay click
  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', escHandler); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', escHandler);

  overlay.querySelector('#qmvCancel').addEventListener('click', close);
  overlay.querySelector('#qmvConfirm').addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('#qmvConfirm');
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Oppdaterer...';

    const dateValue = normalizeDateValue(document.getElementById('qmvDate').value);
    const selectedSlugs = Array.from(overlay.querySelectorAll('.qmv-kontroll-cb:checked')).map(cb => cb.dataset.slug);

    close();

    try {
      const response = await apiFetch('/api/kunder/mark-visited', {
        method: 'POST',
        body: JSON.stringify({
          kunde_ids: [customerId],
          visited_date: dateValue,
          service_type_slugs: selectedSlugs
        })
      });

      const result = await response.json();
      if (response.ok && result.success) {
        const msg = selectedSlugs.length > 0
          ? `${escapeHtml(customer?.navn || 'Kunde')} markert som besøkt (kontrolldatoer oppdatert)`
          : `${escapeHtml(customer?.navn || 'Kunde')} markert som besøkt`;
        showNotification(msg);
        await loadCustomers();
      } else {
        showNotification(typeof result.error === 'string' ? result.error : 'Kunne ikke markere som besøkt', 'error');
      }
    } catch (error) {
      console.error('Feil ved rask avhuking:', error);
      showNotification('Feil ved oppdatering', 'error');
    }
  });
}

// Make functions globally available
window.clearBulkSelection = clearBulkSelection;
window.toggleSelectAllVisible = toggleSelectAllVisible;
window.executeAvhuking = executeAvhuking;
window.quickMarkVisited = quickMarkVisited;

// Search/filter customers
function filterCustomers() {
  applyFilters();
}

// Geocode address using Kartverket API
async function geocodeAddress(address, postnummer, poststed) {
  const fullAddress = `${address}, ${postnummer || ''} ${poststed || ''}`.trim();

  try {
    // Try Kartverket first (best for Norwegian addresses)
    const response = await fetch(
      `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(fullAddress)}&fuzzy=true&treffPerSide=1`
    );
    if (response.ok) {
      const data = await response.json();
      if (data.adresser && data.adresser.length > 0) {
        const result = data.adresser[0];
        return {
          lat: result.representasjonspunkt.lat,
          lng: result.representasjonspunkt.lon,
          formatted: `${result.adressetekst}, ${result.postnummer} ${result.poststed}`
        };
      }
    }

    // Fallback to Nominatim
    const nomResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&format=json&countrycodes=no&limit=1`
    );
    if (nomResponse.ok) {
      const nomData = await nomResponse.json();
      if (nomData.length > 0) {
        return {
          lat: Number.parseFloat(nomData[0].lat),
          lng: Number.parseFloat(nomData[0].lon),
          formatted: nomData[0].display_name
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Geocoding feil:', error);
    return null;
  }
}

// ============================================
// Address Autocomplete & Postnummer Lookup
// ============================================

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Search addresses using Kartverket API
async function searchAddresses(query) {
  if (!query || query.length < 3) return [];

  try {
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(query)}&fuzzy=true&treffPerSide=5`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      return data.adresser.map(a => ({
        adresse: a.adressetekst,
        postnummer: a.postnummer,
        poststed: a.poststed,
        lat: a.representasjonspunkt.lat,
        lng: a.representasjonspunkt.lon,
        kommune: a.kommunenavn || ''
      }));
    }
    return [];
  } catch (error) {
    console.error('Adressesøk feilet:', error);
    return [];
  }
}

// Lookup postal code using Bring API
async function lookupPostnummer(postnummer) {
  if (!/^\d{4}$/.test(postnummer)) return null;

  try {
    const url = `https://api.bring.com/shippingguide/api/postalCode.json?clientUrl=elkontroll&country=NO&pnr=${postnummer}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.valid) {
      return data.result;
    }
    return null;
  } catch (error) {
    console.error('Postnummer-oppslag feilet:', error);
    return null;
  }
}

// Render address suggestions dropdown
function renderAddressSuggestions(results) {
  const container = document.getElementById('addressSuggestions');
  if (!container) return;

  if (!results || results.length === 0) {
    container.innerHTML = '';
    container.classList.remove('visible');
    return;
  }

  container.innerHTML = results.map((addr, index) => `
    <div class="address-suggestion-item" data-index="${index}">
      <i class="fas fa-map-marker-alt"></i>
      <div class="address-suggestion-text">
        <div class="address-suggestion-main">${escapeHtml(addr.adresse)}</div>
        <div class="address-suggestion-detail">${escapeHtml(addr.postnummer)} ${escapeHtml(addr.poststed)}${addr.kommune ? `, ${escapeHtml(addr.kommune)}` : ''}</div>
      </div>
    </div>
  `).join('');

  container.classList.add('visible');
}

// Select an address suggestion and fill form fields
function selectAddressSuggestion(suggestion) {
  const adresseInput = document.getElementById('adresse');
  const postnummerInput = document.getElementById('postnummer');
  const poststedInput = document.getElementById('poststed');
  const latInput = document.getElementById('lat');
  const lngInput = document.getElementById('lng');
  const suggestionsContainer = document.getElementById('addressSuggestions');

  if (adresseInput) adresseInput.value = suggestion.adresse;
  if (postnummerInput) postnummerInput.value = suggestion.postnummer;
  if (poststedInput) {
    poststedInput.value = suggestion.poststed;
    poststedInput.classList.add('auto-filled');
  }
  if (latInput) latInput.value = suggestion.lat.toFixed(6);
  if (lngInput) lngInput.value = suggestion.lng.toFixed(6);

  // Update geocode quality badge
  updateGeocodeQualityBadge('exact');

  // Hide suggestions
  if (suggestionsContainer) {
    suggestionsContainer.classList.remove('visible');
  }

  // Update postnummer status
  updatePostnummerStatus('valid');

  showNotification(`Adresse valgt: ${suggestion.adresse}, ${suggestion.postnummer} ${suggestion.poststed}`);
}

// Update postnummer status indicator
function updatePostnummerStatus(status) {
  const statusEl = document.getElementById('postnummerStatus');
  if (!statusEl) return;

  statusEl.className = 'postnummer-status';

  switch (status) {
    case 'valid':
      statusEl.innerHTML = '<i class="fas fa-check"></i>';
      statusEl.classList.add('valid');
      break;
    case 'invalid':
      statusEl.innerHTML = '<i class="fas fa-times"></i>';
      statusEl.classList.add('invalid');
      break;
    case 'loading':
      statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      statusEl.classList.add('loading');
      break;
    default:
      statusEl.innerHTML = '';
  }
}

// Address autocomplete state
let addressSuggestions = [];
let selectedSuggestionIndex = -1;

// Setup address autocomplete functionality
function setupAddressAutocomplete() {
  const adresseInput = document.getElementById('adresse');
  const postnummerInput = document.getElementById('postnummer');
  const poststedInput = document.getElementById('poststed');
  const suggestionsContainer = document.getElementById('addressSuggestions');

  if (!adresseInput || !suggestionsContainer) return;

  // Debounced search function
  const debouncedSearch = debounce(async (query) => {
    if (query.length < 3) {
      suggestionsContainer.classList.remove('visible');
      return;
    }

    addressSuggestions = await searchAddresses(query);
    selectedSuggestionIndex = -1;
    renderAddressSuggestions(addressSuggestions);
  }, 300);

  // Input event for address search
  adresseInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  // Keyboard navigation
  adresseInput.addEventListener('keydown', (e) => {
    if (!suggestionsContainer.classList.contains('visible')) return;

    const items = suggestionsContainer.querySelectorAll('.address-suggestion-item');

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
        updateSelectedSuggestion(items);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
        updateSelectedSuggestion(items);
        break;
      case 'Enter':
        if (selectedSuggestionIndex >= 0 && addressSuggestions[selectedSuggestionIndex]) {
          e.preventDefault();
          selectAddressSuggestion(addressSuggestions[selectedSuggestionIndex]);
        }
        break;
      case 'Escape':
        suggestionsContainer.classList.remove('visible');
        selectedSuggestionIndex = -1;
        break;
    }
  });

  // Click on suggestion
  suggestionsContainer.addEventListener('click', (e) => {
    const item = e.target.closest('.address-suggestion-item');
    if (item) {
      const index = parseInt(item.dataset.index, 10);
      if (addressSuggestions[index]) {
        selectAddressSuggestion(addressSuggestions[index]);
      }
    }
  });

  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.address-autocomplete-wrapper')) {
      suggestionsContainer.classList.remove('visible');
    }
  });

  // Postnummer auto-lookup
  if (postnummerInput && poststedInput) {
    postnummerInput.addEventListener('input', async (e) => {
      const value = e.target.value.replace(/\D/g, '').slice(0, 4);
      e.target.value = value;

      // Remove auto-filled class from poststed when user edits postnummer
      poststedInput.classList.remove('auto-filled');
      updatePostnummerStatus('');

      if (value.length === 4) {
        updatePostnummerStatus('loading');
        const result = await lookupPostnummer(value);

        if (result) {
          poststedInput.value = result;
          poststedInput.classList.add('auto-filled');
          updatePostnummerStatus('valid');
        } else {
          updatePostnummerStatus('invalid');
        }
      }
    });
  }
}

// Update visual selection in suggestions list
function updateSelectedSuggestion(items) {
  items.forEach((item, index) => {
    if (index === selectedSuggestionIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

// Plan route using OpenRouteService
async function planRoute() {
  // Check if route planning is configured on server (uses server-side proxy)
  if (!appConfig.orsApiKeyConfigured) {
    showMessage('Ruteplanlegging er ikke konfigurert. Kontakt administrator.', 'warning');
    return;
  }

  const selectedCustomerData = customers.filter(c => selectedCustomers.has(c.id) && c.lat && c.lng);

  if (selectedCustomerData.length < 1) {
    showMessage('Velg minst 1 kunde med gyldige koordinater', 'warning');
    return;
  }

  planRouteBtn.classList.add('loading');
  planRouteBtn.disabled = true;

  // Get start location from config (company address)
  const startLocation = [
    appConfig.routeStartLng || 17.65274,
    appConfig.routeStartLat || 69.06888
  ];

  try {

    // Use server-side proxy for route optimization (protects API key)
    const optimizeHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      optimizeHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/routes/optimize', {
      method: 'POST',
      headers: optimizeHeaders,
      credentials: 'include',
      body: JSON.stringify({
        jobs: selectedCustomerData.map((c, i) => ({
          id: i + 1,
          location: [c.lng, c.lat],
          service: 1800 // 30 min per kunde
        })),
        vehicles: [{
          id: 1,
          profile: 'driving-car',
          start: startLocation,  // Always start from company address
          end: startLocation     // Return to company address
        }]
      })
    });

    if (!response.ok) {
      // Fallback to simple directions if optimization fails
      showMessage('Ruteoptimering ikke tilgjengelig, bruker enkel rute', 'info');
      await planSimpleRoute(selectedCustomerData);
      return;
    }

    const data = await response.json();

    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const orderedCustomers = route.steps
        .filter(s => s.type === 'job')
        .map(s => selectedCustomerData[s.job - 1]);

      await drawRoute(orderedCustomers);
      showRouteInfo(orderedCustomers, route.duration, route.distance);
    }
  } catch (error) {
    console.error('Ruteplanlegging feil:', error);
    // Try simple route as fallback
    await planSimpleRoute(customers.filter(c => selectedCustomers.has(c.id) && c.lat && c.lng));
  } finally {
    planRouteBtn.classList.remove('loading');
    planRouteBtn.disabled = false;
  }
}

// Simple route without optimization
async function planSimpleRoute(customerData) {
  try {
    // Get start location from config (company address)
    const startLocation = [
      appConfig.routeStartLng || 17.65274,
      appConfig.routeStartLat || 69.06888
    ];
    const startLatLng = [appConfig.routeStartLat || 69.06888, appConfig.routeStartLng || 17.65274];

    // Build coordinates: start -> customers -> start
    const coordinates = [
      startLocation,
      ...customerData.map(c => [c.lng, c.lat]),
      startLocation  // Return to start
    ];

    // Use server-side proxy for directions (protects API key)
    const directionsHeaders = {
      'Content-Type': 'application/json',
    };
    const dirCsrfToken = getCsrfToken();
    if (dirCsrfToken) {
      directionsHeaders['X-CSRF-Token'] = dirCsrfToken;
    }
    const response = await fetch('/api/routes/directions', {
      method: 'POST',
      headers: directionsHeaders,
      credentials: 'include',
      body: JSON.stringify({
        coordinates: coordinates
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // Parse ORS error message
      if (data.error && data.error.message) {
        if (data.error.message.includes('Could not find routable point')) {
          throw new Error('En eller flere kunder har koordinater som ikke er nær en vei. Velg andre kunder eller oppdater koordinatene.');
        }
        throw new Error(data.error.message);
      }
      throw new Error('Kunne ikke beregne rute');
    }

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      drawRouteFromGeoJSON(feature);

      // Add start marker (company location)
      const startIcon = L.divIcon({
        className: 'route-marker route-start',
        html: '<i class="fas fa-home"></i>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      const startMarker = L.marker(startLatLng, { icon: startIcon }).addTo(map);
      startMarker.bindPopup(`<strong>Start:</strong><br>${appConfig.routeStartAddress || 'Brøstadveien 343'}`);
      routeMarkers.push(startMarker);

      // Add numbered markers for customers
      customerData.forEach((customer, index) => {
        const icon = L.divIcon({
          className: 'route-marker',
          html: `${index + 1}`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });

        const marker = L.marker([customer.lat, customer.lng], { icon }).addTo(map);
        routeMarkers.push(marker);
      });

      // Fit map to route (include start location)
      const allPoints = [startLatLng, ...customerData.map(c => [c.lat, c.lng])];
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [50, 50] });

      showRouteInfo(
        customerData,
        feature.properties.summary.duration,
        feature.properties.summary.distance
      );
    }
  } catch (error) {
    console.error('Enkel rute feil:', error);
    showMessage(error.message || 'Kunne ikke beregne rute.', 'error');
  }
}

// Draw route on map
async function drawRoute(orderedCustomers) {
  clearRoute();

  // Get start location from config (company address)
  const startLocation = [
    appConfig.routeStartLng || 17.65274,
    appConfig.routeStartLat || 69.06888
  ];
  const startLatLng = [appConfig.routeStartLat || 69.06888, appConfig.routeStartLng || 17.65274];

  // Build coordinates: start -> customers -> start
  const coordinates = [
    startLocation,
    ...orderedCustomers.map(c => [c.lng, c.lat]),
    startLocation  // Return to start
  ];

  try {
    // Use server-side proxy for directions (protects API key)
    const directionsHeaders = {
      'Content-Type': 'application/json',
    };
    const dirCsrfToken = getCsrfToken();
    if (dirCsrfToken) {
      directionsHeaders['X-CSRF-Token'] = dirCsrfToken;
    }
    const response = await fetch('/api/routes/directions', {
      method: 'POST',
      headers: directionsHeaders,
      credentials: 'include',
      body: JSON.stringify({ coordinates })
    });

    const data = await response.json();

    if (data.features && data.features.length > 0) {
      drawRouteFromGeoJSON(data.features[0]);
    }
  } catch (error) {
    console.error('Tegning av rute feil:', error);
  }

  // Add start marker (company location)
  const startIcon = L.divIcon({
    className: 'route-marker route-start',
    html: '<i class="fas fa-home"></i>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
  const startMarker = L.marker(startLatLng, { icon: startIcon }).addTo(map);
  startMarker.bindPopup(`<strong>Start:</strong><br>${appConfig.routeStartAddress || 'Brøstadveien 343'}`);
  routeMarkers.push(startMarker);

  // Add numbered markers for customers
  orderedCustomers.forEach((customer, index) => {
    const icon = L.divIcon({
      className: 'route-marker',
      html: `${index + 1}`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const marker = L.marker([customer.lat, customer.lng], { icon }).addTo(map);
    routeMarkers.push(marker);
  });

  // Fit map to route (include start location)
  const allPoints = [startLatLng, ...orderedCustomers.map(c => [c.lat, c.lng])];
  const bounds = L.latLngBounds(allPoints);
  map.fitBounds(bounds, { padding: [50, 50] });
}

// Draw route from GeoJSON
function drawRouteFromGeoJSON(feature) {
  clearRoute();

  // Create route pane if it doesn't exist (ensures route is above tiles)
  if (!map.getPane('routePane')) {
    map.createPane('routePane');
    map.getPane('routePane').style.zIndex = 450;
  }

  routeLayer = L.geoJSON(feature, {
    pane: 'routePane',
    style: {
      color: '#2563eb',
      weight: 6,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }
  }).addTo(map);

  // Bring route to front
  routeLayer.bringToFront();
}

// Clear route from map
function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  routeMarkers.forEach(m => map.removeLayer(m));
  routeMarkers = [];
}

// Current route data for saving
let currentRouteData = null;

// Show route information panel
function showRouteInfo(orderedCustomers, durationSeconds, distanceMeters) {
  const routeDetails = document.getElementById('routeDetails');

  // Store for saving
  currentRouteData = {
    customers: orderedCustomers,
    duration: durationSeconds,
    distance: distanceMeters
  };

  const stops = orderedCustomers.map((customer, index) => `
    <div class="route-stop sortable-item" draggable="true" data-customer-id="${customer.id}">
      <div class="drag-handle"><i class="fas fa-grip-vertical"></i></div>
      <div class="stop-number">${index + 1}</div>
      <div class="stop-details">
        <h4>${escapeHtml(customer.navn)}</h4>
        <p>${escapeHtml(customer.adresse)}</p>
        ${customer.telefon ? `<p>Tlf: ${escapeHtml(customer.telefon)}</p>` : ''}
      </div>
    </div>
  `).join('');

  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const km = (distanceMeters / 1000).toFixed(1);

  routeDetails.innerHTML = `
    <div id="routeStopsList">
      ${stops}
    </div>
    <div class="route-summary" id="routeSummary">
      <p><strong>Total kjøretid:</strong> <span id="routeDuration">${hours > 0 ? `${hours}t ` : ''}${minutes} min</span></p>
      <p><strong>Total distanse:</strong> <span id="routeDistance">${km} km</span></p>
      <p><strong>Antall stopp:</strong> ${orderedCustomers.length}</p>
    </div>
    <div class="route-actions">
      <button id="saveRouteBtn" class="btn btn-primary">Lagre rute</button>
      <button id="exportGoogleBtn" class="btn btn-secondary">Google Maps</button>
      <button id="exportAppleBtn" class="btn btn-secondary">Apple Maps</button>
    </div>
  `;

  routeInfo.classList.remove('hidden');

  // Initialize drag-and-drop for route stops
  initRouteStopsSortable();

  // Add event listeners for new buttons
  document.getElementById('saveRouteBtn').addEventListener('click', showSaveRouteModal);
  document.getElementById('exportGoogleBtn').addEventListener('click', () => exportToMaps('google'));
  document.getElementById('exportAppleBtn').addEventListener('click', () => exportToMaps('apple'));
}

// Initialize sortable for route stops with live updates
function initRouteStopsSortable() {
  const container = document.getElementById('routeStopsList');
  if (!container) return;

  let draggedItem = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.sortable-item');
    if (!item) return;
    draggedItem = item;
    draggedItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', async () => {
    if (draggedItem) {
      draggedItem.classList.remove('dragging');
      draggedItem = null;

      // Update stop numbers and recalculate route
      await updateRouteAfterReorder();
    }
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedItem) return;

    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement == null) {
      container.appendChild(draggedItem);
    } else {
      container.insertBefore(draggedItem, afterElement);
    }

    // Update stop numbers live while dragging
    updateStopNumbers();
  });
}

// Update stop numbers after reordering
function updateStopNumbers() {
  const stops = document.querySelectorAll('#routeStopsList .route-stop');
  stops.forEach((stop, index) => {
    const numberEl = stop.querySelector('.stop-number');
    if (numberEl) {
      numberEl.textContent = index + 1;
    }
  });
}

// Recalculate route after reordering stops
async function updateRouteAfterReorder() {
  const container = document.getElementById('routeStopsList');
  if (!container || !currentRouteData) return;

  // Get new order of customers
  const stops = container.querySelectorAll('.route-stop');
  const newCustomerOrder = [];

  stops.forEach(stop => {
    const customerId = parseInt(stop.dataset.customerId);
    const customer = currentRouteData.customers.find(c => c.id === customerId);
    if (customer) {
      newCustomerOrder.push(customer);
    }
  });

  // Update stored data
  currentRouteData.customers = newCustomerOrder;

  // Show loading state
  const summaryEl = document.getElementById('routeSummary');
  summaryEl.classList.add('loading');

  try {
    // Recalculate route with new order
    const startLocation = [
      appConfig.routeStartLng || 17.65274,
      appConfig.routeStartLat || 69.06888
    ];

    const coordinates = [
      startLocation,
      ...newCustomerOrder.map(c => [c.lng, c.lat]),
      startLocation
    ];

    const response = await fetch('/api/routes/directions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ coordinates })
    });

    if (response.ok) {
      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const props = feature.properties.summary;

        // Update stats
        currentRouteData.duration = props.duration;
        currentRouteData.distance = props.distance;

        const hours = Math.floor(props.duration / 3600);
        const minutes = Math.floor((props.duration % 3600) / 60);
        const km = (props.distance / 1000).toFixed(1);

        document.getElementById('routeDuration').textContent = `${hours > 0 ? `${hours}t ` : ''}${minutes} min`;
        document.getElementById('routeDistance').textContent = `${km} km`;

        // Redraw route on map
        drawRouteFromGeoJSON(feature);

        // Update route markers
        updateRouteMarkers(newCustomerOrder);
      }
    }
  } catch (error) {
    console.error('Kunne ikke oppdatere rute:', error);
  } finally {
    summaryEl.classList.remove('loading');
  }
}

// Update route markers on map after reorder
function updateRouteMarkers(orderedCustomers) {
  // Remove existing customer markers (keep start marker)
  routeMarkers.forEach((marker, index) => {
    if (index > 0) { // Skip start marker
      map.removeLayer(marker);
    }
  });
  routeMarkers = routeMarkers.slice(0, 1); // Keep only start marker

  // Add new numbered markers
  orderedCustomers.forEach((customer, index) => {
    const icon = L.divIcon({
      className: 'route-marker',
      html: `${index + 1}`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const marker = L.marker([customer.lat, customer.lng], { icon }).addTo(map);
    routeMarkers.push(marker);
  });
}

// Navigate to a single customer using device maps app
function navigateToCustomer(lat, lng, _name) {
  // Detect if iOS or Android
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const startLat = appConfig.routeStartLat || 69.06888;
  const startLng = appConfig.routeStartLng || 17.65274;

  if (isIOS) {
    // Apple Maps
    const url = `https://maps.apple.com/?saddr=${startLat},${startLng}&daddr=${lat},${lng}&dirflg=d`;
    window.open(url, '_blank');
  } else {
    // Google Maps (works on Android and desktop)
    const url = `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${lat},${lng}&travelmode=driving`;
    window.open(url, '_blank');
  }

  // Close popup
  map.closePopup();
}

// Export to Google Maps or Apple Maps
function exportToMaps(type) {
  if (!currentRouteData || !currentRouteData.customers.length) return;

  const customers = currentRouteData.customers;

  // Always start and end at company address
  const startLat = appConfig.routeStartLat || 69.06888;
  const startLng = appConfig.routeStartLng || 17.65274;
  const startCoord = `${startLat},${startLng}`;

  if (type === 'google') {
    // Google Maps directions URL
    // Waypoints must be URL-encoded for proper parsing
    const waypoints = customers.map(c => `${c.lat},${c.lng}`).join('|');

    let url = `https://www.google.com/maps/dir/?api=1&origin=${startCoord}&destination=${startCoord}`;
    if (waypoints) {
      url += `&waypoints=${encodeURIComponent(waypoints)}`;
    }
    url += '&travelmode=driving';

    window.open(url, '_blank');
  } else if (type === 'apple') {
    // Apple Maps URL with multiple stops
    // Format: maps.apple.com/?saddr=X&daddr=A+to:B+to:C
    const allStops = customers.map(c => `${c.lat},${c.lng}`);
    allStops.push(startCoord); // Add return to company

    // Build daddr with +to: separator (Apple Maps format)
    const daddr = allStops.join('+to:');

    const url = `https://maps.apple.com/?saddr=${startCoord}&daddr=${daddr}&dirflg=d`;

    window.open(url, '_blank');
  }
}

// Show save route modal
async function showSaveRouteModal() {
  const modal = document.getElementById('saveRouteModal');
  document.getElementById('ruteNavn').value = '';
  document.getElementById('ruteBeskrivelse').value = '';
  document.getElementById('ruteDato').value = '';

  // Load team members for assignment dropdown
  const assignGroup = document.getElementById('ruteAssignGroup');
  const assignSelect = document.getElementById('ruteAssignTo');
  if (hasFeature('todays_work') && assignGroup && assignSelect) {
    try {
      const resp = await fetch('/api/team-members', { headers: { 'X-CSRF-Token': csrfToken } });
      const json = await resp.json();
      if (json.success && json.data) {
        assignSelect.innerHTML = '<option value="">Ikke tildelt</option>';
        json.data.filter(m => m.aktiv).forEach(m => {
          assignSelect.innerHTML += `<option value="${m.id}">${escapeHtml(m.navn)}</option>`;
        });
        assignGroup.style.display = '';
      }
    } catch (err) {
      // Silently fail - assignment is optional
    }
  }

  modal.classList.remove('hidden');
}

// Save route to database
async function saveRoute() {
  if (!currentRouteData) return;

  const navn = document.getElementById('ruteNavn').value.trim();
  const beskrivelse = document.getElementById('ruteBeskrivelse').value.trim();
  const planlagt_dato = normalizeDateValue(document.getElementById('ruteDato').value);

  if (!navn) {
    showMessage('Skriv inn et navn for ruten', 'warning');
    return;
  }

  const assignToValue = document.getElementById('ruteAssignTo')?.value;
  const assigned_to = assignToValue ? parseInt(assignToValue) : null;

  try {
    const response = await apiFetch('/api/ruter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        navn,
        beskrivelse,
        planlagt_dato: planlagt_dato || null,
        total_distanse: currentRouteData.distance,
        total_tid: currentRouteData.duration,
        kunde_ids: currentRouteData.customers.map(c => c.id)
      })
    });

    if (response.ok) {
      const result = await response.json();
      // Assign route to technician if selected
      if (assigned_to && result.data?.id) {
        await apiFetch(`/api/ruter/${result.data.id}/assign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_to, planned_date: planlagt_dato || null })
        });
      }
      showMessage('Ruten er lagret!', 'success');
      document.getElementById('saveRouteModal').classList.add('hidden');
      await loadRoutes();
    }
  } catch (error) {
    console.error('Feil ved lagring av rute:', error);
    showMessage('Kunne ikke lagre ruten. Prøv igjen.', 'error');
  }
}

// Render saved routes list
function renderSavedRoutes() {
  const container = document.getElementById('savedRoutesList');
  if (!container) return;

  if (savedRoutes.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:30px 20px;color:var(--color-text-secondary,#a0a0a0);">
        <i class="fas fa-route" style="font-size:28px;margin-bottom:10px;display:block;opacity:0.5;"></i>
        <p style="font-size:14px;margin:0 0 6px;">Ingen lagrede ruter</p>
        <p style="font-size:12px;margin:0;opacity:0.7;">Velg kunder og klikk "Planlegg rute" for \u00e5 komme i gang</p>
      </div>`;
    return;
  }

  container.innerHTML = savedRoutes.map(route => {
    const km = route.total_distanse ? (route.total_distanse / 1000).toFixed(1) : '-';
    const statusClass = route.status === 'fullført' ? 'status-completed' : 'status-planned';

    return `
      <div class="saved-route-item" data-id="${route.id}">
        <div class="route-header">
          <h4>${escapeHtml(route.navn)}</h4>
          <span class="route-status ${statusClass}">${escapeHtml(route.status)}</span>
        </div>
        <p>${route.antall_kunder} kunder • ${km} km</p>
        ${route.planlagt_dato ? `<p class="route-date">Planlagt: ${formatDate(route.planlagt_dato)}</p>` : ''}
        <div class="route-item-actions">
          <button class="btn btn-small btn-primary" data-action="loadSavedRoute" data-route-id="${route.id}">Last inn</button>
          ${route.status !== 'fullført' ? `<button class="btn btn-small btn-field-work" data-action="startFieldWork" data-route-id="${route.id}"><i class="fas fa-route"></i> Kjør rute</button>` : ''}
          ${route.status !== 'fullført' ? `<button class="btn btn-small btn-success" data-action="markRouteVisited" data-route-id="${route.id}"><i class="fas fa-check"></i> Marker besøkt</button>` : ''}
          <button class="btn btn-small btn-danger" data-action="deleteRoute" data-route-id="${route.id}">Slett</button>
        </div>
      </div>
    `;
  }).join('');
}

// Load a saved route
async function loadSavedRoute(routeId) {
  try {
    const response = await apiFetch(`/api/ruter/${routeId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Kunne ikke laste rute`);
    const route = await response.json();

    // Clear current selection
    selectedCustomers.clear();

    // Select all customers in the route
    route.kunder.forEach(kunde => {
      selectedCustomers.add(kunde.id);
    });

    updateSelectionUI();

    // Plan the route
    await planRoute();

    // Close routes panel if open
    document.getElementById('routesPanel')?.classList.add('hidden');
  } catch (error) {
    console.error('Feil ved lasting av rute:', error);
    showMessage('Kunne ikke laste ruten. Prøv igjen.', 'error');
  }
}

// Complete a route and update control dates
async function completeRoute(routeId) {
  const confirmed = await showConfirm(
    'Marker ruten som fullført? Dette vil oppdatere kontroll-datoene for alle kunder i ruten.',
    'Fullfør rute'
  );
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/ruter/${routeId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ dato: new Date().toISOString().split('T')[0] })
    });

    if (response.ok) {
      await loadRoutes();
      await loadCustomers();
      showMessage('Ruten er markert som fullført og kontroll-datoer er oppdatert!', 'success');
    }
  } catch (error) {
    console.error('Feil ved fullføring av rute:', error);
    showMessage('Kunne ikke fullføre ruten. Prøv igjen.', 'error');
  }
}

// Mark all customers in a route as visited (new flow)
async function markRouteVisited(routeId) {
  try {
    const response = await apiFetch(`/api/ruter/${routeId}`);
    if (!response.ok) throw new Error('Kunne ikke laste ruten');
    const routeData = await response.json();

    const kunder = routeData.data?.kunder || [];
    if (kunder.length === 0) {
      showNotification('Ruten har ingen kunder', 'error');
      return;
    }

    const kundeIds = kunder.map(k => k.id);
    const today = new Date().toISOString().split('T')[0];

    // Get all active service type slugs for kontroll update
    const allServiceTypes = serviceTypeRegistry.getAll();
    const allSlugs = allServiceTypes.map(st => st.slug);

    const msg = allSlugs.length > 0
      ? `Marker ${kunder.length} kunder som besøkt og oppdater kontrolldatoer?`
      : `Marker ${kunder.length} kunder som besøkt?`;

    const confirmed = await showConfirm(msg, 'Marker besøkt');
    if (!confirmed) return;

    const markResponse = await apiFetch('/api/kunder/mark-visited', {
      method: 'POST',
      body: JSON.stringify({
        kunde_ids: kundeIds,
        visited_date: today,
        service_type_slugs: allSlugs
      })
    });

    const result = await markResponse.json();
    if (markResponse.ok && result.success) {
      // Also mark route status as completed
      await apiFetch(`/api/ruter/${routeId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ dato: today, kontrollType: 'both' })
      });

      await loadRoutes();
      await loadCustomers();
      showNotification(`${result.data.updated} kunder markert som besøkt`);
    } else {
      showNotification(typeof result.error === 'string' ? result.error : 'Kunne ikke markere ruten', 'error');
    }
  } catch (error) {
    console.error('Feil ved rute-avhuking:', error);
    showNotification('Kunne ikke markere ruten. Prøv igjen.', 'error');
  }
}

// Delete a saved route
async function deleteRoute(routeId) {
  const confirmed = await showConfirm(
    'Er du sikker på at du vil slette denne ruten?',
    'Slette rute'
  );
  if (!confirmed) return;

  try {
    await apiFetch(`/api/ruter/${routeId}`, { method: 'DELETE' });
    await loadRoutes();
  } catch (error) {
    console.error('Feil ved sletting av rute:', error);
    showMessage('Kunne ikke slette ruten. Prøv igjen.', 'error');
  }
}

// ========================================
// FIELD WORK MODE (Feature: field_work)
// Full-screen route execution UI
// ========================================

let fieldWorkState = null; // { ruteId, kunder, currentIndex, visits, startedAt }

async function startFieldWork(routeId) {
  try {
    // Load the route with customers
    const response = await apiFetch(`/api/ruter/${routeId}`);
    if (!response.ok) throw new Error('Kunne ikke laste ruten');
    const routeData = await response.json();

    if (!routeData.data?.kunder || routeData.data.kunder.length === 0) {
      showNotification('Ruten har ingen kunder', 'error');
      return;
    }

    // Start execution on backend
    await apiFetch(`/api/ruter/${routeId}/start-execution`, { method: 'POST' });

    // Initialize field work state
    fieldWorkState = {
      ruteId: routeId,
      routeName: routeData.data.navn,
      kunder: routeData.data.kunder.sort((a, b) => (a.rekkefolge || 0) - (b.rekkefolge || 0)),
      currentIndex: 0,
      visits: {},
      startedAt: new Date(),
    };

    renderFieldWorkUI();
  } catch (error) {
    console.error('Failed to start field work:', error);
    showNotification('Kunne ikke starte feltarbeid', 'error');
  }
}

function renderFieldWorkUI() {
  if (!fieldWorkState) return;

  const { kunder, currentIndex, routeName, visits } = fieldWorkState;
  const current = kunder[currentIndex];
  const completedCount = Object.values(visits).filter(v => v.completed).length;
  const progress = Math.round((completedCount / kunder.length) * 100);

  // Create or get the field work overlay
  let overlay = document.getElementById('fieldWorkOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'fieldWorkOverlay';
    overlay.className = 'field-work-overlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="fw-header">
      <div class="fw-header-left">
        <button class="fw-close-btn" onclick="endFieldWork()"><i class="fas fa-times"></i></button>
        <span class="fw-title">${escapeHtml(routeName)}</span>
      </div>
      <div class="fw-progress">
        <span>${completedCount}/${kunder.length}</span>
        <div class="fw-progress-bar"><div class="fw-progress-fill" style="width:${progress}%"></div></div>
      </div>
    </div>

    <div class="fw-body">
      <div class="fw-customer-nav">
        <button class="fw-nav-btn" onclick="fieldWorkNav(-1)" ${currentIndex === 0 ? 'disabled' : ''}>
          <i class="fas fa-chevron-left"></i>
        </button>
        <div class="fw-customer-info">
          <div class="fw-stop-number">Stopp ${currentIndex + 1} av ${kunder.length}</div>
          <h2 class="fw-customer-name">${escapeHtml(current.navn)}</h2>
          <div class="fw-customer-address">
            <i class="fas fa-map-marker-alt"></i> ${escapeHtml(current.adresse || '')}${current.poststed ? `, ${escapeHtml(current.poststed)}` : ''}
          </div>
          ${current.telefon ? `<a class="fw-phone-link" href="tel:${escapeHtml(current.telefon)}"><i class="fas fa-phone"></i> ${escapeHtml(current.telefon)}</a>` : ''}
        </div>
        <button class="fw-nav-btn" onclick="fieldWorkNav(1)" ${currentIndex === kunder.length - 1 ? 'disabled' : ''}>
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>

      <div class="fw-visit-form">
        <div class="fw-actions fw-actions-primary">
          <button class="fw-btn fw-btn-complete ${visits[current.id]?.completed ? 'fw-btn-completed' : ''}" onclick="completeFieldWorkVisit()">
            <i class="fas ${visits[current.id]?.completed ? 'fa-check-circle' : 'fa-check'}"></i>
            ${visits[current.id]?.completed ? 'Fullført' : 'Marker fullført'}
          </button>
        </div>
        <div class="fw-actions fw-actions-secondary">
          <button class="fw-btn fw-btn-navigate" onclick="navigateToFieldWorkCustomer()">
            <i class="fas fa-directions"></i> Naviger
          </button>
        </div>
        <div class="fw-form-group">
          <label>Kommentar</label>
          <textarea id="fwComment" class="fw-textarea" rows="2" placeholder="Valgfritt notat...">${escapeHtml(visits[current.id]?.comment || '')}</textarea>
        </div>
        ${appConfig.appMode === 'full' ? `
        <div class="fw-form-group">
          <label>Materialer brukt</label>
          <input id="fwMaterials" class="fw-input" type="text" placeholder="Kommaseparert liste..." value="${escapeHtml((visits[current.id]?.materials_used || []).join(', '))}">
        </div>
        <div class="fw-form-group">
          <label>Utstyr registrert</label>
          <input id="fwEquipment" class="fw-input" type="text" placeholder="Kommaseparert liste..." value="${escapeHtml((visits[current.id]?.equipment_registered || []).join(', '))}">
        </div>
        ` : ''}
      </div>
    </div>

    <div class="fw-stop-dots">
      ${kunder.map((k, i) => `<div class="fw-dot ${i === currentIndex ? 'fw-dot-active' : ''} ${visits[k.id]?.completed ? 'fw-dot-completed' : ''}" onclick="fieldWorkGoTo(${i})"></div>`).join('')}
    </div>
  `;

  overlay.classList.add('active');
}

function fieldWorkNav(delta) {
  if (!fieldWorkState) return;
  saveFieldWorkFormData();
  const newIndex = fieldWorkState.currentIndex + delta;
  if (newIndex >= 0 && newIndex < fieldWorkState.kunder.length) {
    fieldWorkState.currentIndex = newIndex;
    renderFieldWorkUI();
  }
}

function fieldWorkGoTo(index) {
  if (!fieldWorkState) return;
  saveFieldWorkFormData();
  fieldWorkState.currentIndex = index;
  renderFieldWorkUI();
}

function saveFieldWorkFormData() {
  if (!fieldWorkState) return;
  const current = fieldWorkState.kunder[fieldWorkState.currentIndex];
  const comment = document.getElementById('fwComment')?.value || '';
  const materialsEl = document.getElementById('fwMaterials');
  const equipmentEl = document.getElementById('fwEquipment');

  if (!fieldWorkState.visits[current.id]) {
    fieldWorkState.visits[current.id] = { completed: false };
  }
  fieldWorkState.visits[current.id].comment = comment;
  if (materialsEl) {
    fieldWorkState.visits[current.id].materials_used = materialsEl.value ? materialsEl.value.split(',').map(s => s.trim()).filter(Boolean) : [];
  }
  if (equipmentEl) {
    fieldWorkState.visits[current.id].equipment_registered = equipmentEl.value ? equipmentEl.value.split(',').map(s => s.trim()).filter(Boolean) : [];
  }
}

async function completeFieldWorkVisit() {
  if (!fieldWorkState) return;
  saveFieldWorkFormData();

  const current = fieldWorkState.kunder[fieldWorkState.currentIndex];
  const visitData = fieldWorkState.visits[current.id] || {};
  const wasCompleted = visitData.completed;

  // Toggle completion
  visitData.completed = !wasCompleted;
  fieldWorkState.visits[current.id] = visitData;

  try {
    await apiFetch(`/api/ruter/${fieldWorkState.ruteId}/visit-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kunde_id: current.id,
        completed: visitData.completed,
        comment: visitData.comment,
        materials_used: visitData.materials_used,
        equipment_registered: visitData.equipment_registered,
      }),
    });

    // Auto-advance to next unvisited if completing
    if (visitData.completed && fieldWorkState.currentIndex < fieldWorkState.kunder.length - 1) {
      const nextUnvisited = fieldWorkState.kunder.findIndex(
        (k, i) => i > fieldWorkState.currentIndex && !fieldWorkState.visits[k.id]?.completed
      );
      if (nextUnvisited >= 0) {
        fieldWorkState.currentIndex = nextUnvisited;
      } else {
        fieldWorkState.currentIndex = Math.min(fieldWorkState.currentIndex + 1, fieldWorkState.kunder.length - 1);
      }
    }

    renderFieldWorkUI();
  } catch (error) {
    console.error('Failed to record visit:', error);
    showNotification('Kunne ikke lagre besøk', 'error');
  }
}

function navigateToFieldWorkCustomer() {
  if (!fieldWorkState) return;
  const current = fieldWorkState.kunder[fieldWorkState.currentIndex];
  if (current.lat && current.lng) {
    // Open in external maps app
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${current.lat},${current.lng}`;
    window.open(mapsUrl, '_blank');
  }
}

async function endFieldWork() {
  if (!fieldWorkState) return;

  saveFieldWorkFormData();
  const completedCount = Object.values(fieldWorkState.visits).filter(v => v.completed).length;

  const confirmed = await showConfirm(
    `Avslutt feltarbeid? ${completedCount} av ${fieldWorkState.kunder.length} kunder besøkt.`,
    'Avslutt feltarbeid'
  );
  if (!confirmed) return;

  try {
    await apiFetch(`/api/ruter/${fieldWorkState.ruteId}/end-execution`, { method: 'POST' });
  } catch (error) {
    console.error('Failed to end field work:', error);
  }

  // Remove overlay
  const overlay = document.getElementById('fieldWorkOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  }

  fieldWorkState = null;
  showNotification(`Feltarbeid avsluttet. ${completedCount} kunder besøkt.`, 'success');
  await loadRoutes();
  await loadCustomers();
}

// ========================================
// EMAIL DIALOG (Feature: email_templates)
// ========================================

let emailDialogState = {
  kundeId: null,
  templates: [],
  selectedTemplateId: null,
};

async function openEmailDialog(kundeId) {
  const customer = allCustomers.find(c => c.id === kundeId);
  if (!customer) {
    showNotification('Kunde ikke funnet', 'error');
    return;
  }

  if (!customer.epost) {
    showNotification('Kunden har ingen e-postadresse', 'error');
    return;
  }

  emailDialogState.kundeId = kundeId;

  // Fetch templates
  try {
    const res = await apiFetch('/api/customer-emails/templates');
    emailDialogState.templates = res.data || [];
  } catch {
    showNotification('Kunne ikke hente e-postmaler', 'error');
    return;
  }

  renderEmailDialog(customer);
}

function renderEmailDialog(customer) {
  // Remove existing dialog
  const existing = document.querySelector('.email-dialog-overlay');
  if (existing) existing.remove();

  const templates = emailDialogState.templates;
  const firstTemplate = templates[0];
  emailDialogState.selectedTemplateId = firstTemplate?.id || null;

  const overlay = document.createElement('div');
  overlay.className = 'email-dialog-overlay';
  overlay.innerHTML = `
    <div class="email-dialog">
      <div class="email-dialog-header">
        <h3><i class="fas fa-envelope"></i> Send e-post</h3>
        <button class="email-dialog-close" onclick="closeEmailDialog()"><i class="fas fa-times"></i></button>
      </div>
      <div class="email-dialog-body">
        <div class="email-dialog-recipient">
          <label>Til:</label>
          <span>${escapeHtml(customer.navn)} &lt;${escapeHtml(customer.epost)}&gt;</span>
        </div>

        <div class="email-dialog-field">
          <label for="emailTemplateSelect">Velg mal:</label>
          <select id="emailTemplateSelect" class="email-dialog-select" onchange="onEmailTemplateChange()">
            ${templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(t.category)})</option>`).join('')}
          </select>
        </div>

        <div id="emailCustomFields" class="email-dialog-custom-fields" style="display:none">
          <div class="email-dialog-field">
            <label for="emailCustomSubject">Emne:</label>
            <input id="emailCustomSubject" type="text" class="email-dialog-input" placeholder="Skriv emne...">
          </div>
          <div class="email-dialog-field">
            <label for="emailCustomMessage">Melding:</label>
            <textarea id="emailCustomMessage" class="email-dialog-textarea" rows="4" placeholder="Skriv melding..."></textarea>
          </div>
        </div>

        <div class="email-dialog-preview-section">
          <button class="email-dialog-preview-btn" onclick="previewEmail()">
            <i class="fas fa-eye"></i> Forhåndsvis
          </button>
          <div id="emailPreviewContainer" class="email-preview-container" style="display:none">
            <div class="email-preview-subject" id="emailPreviewSubject"></div>
            <iframe id="emailPreviewFrame" class="email-preview-frame"></iframe>
          </div>
        </div>
      </div>
      <div class="email-dialog-footer">
        <button class="btn btn-secondary" onclick="closeEmailDialog()">Avbryt</button>
        <button class="btn btn-primary email-send-btn" onclick="sendEmailFromDialog()">
          <i class="fas fa-paper-plane"></i> Send e-post
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEmailDialog();
  });

  // Show custom fields for "generell" template
  onEmailTemplateChange();
}

function onEmailTemplateChange() {
  const select = document.getElementById('emailTemplateSelect');
  if (!select) return;
  emailDialogState.selectedTemplateId = Number(select.value);

  const template = emailDialogState.templates.find(t => t.id === emailDialogState.selectedTemplateId);
  const customFields = document.getElementById('emailCustomFields');
  if (customFields) {
    customFields.style.display = template?.category === 'generell' ? 'block' : 'none';
  }

  // Hide preview when template changes
  const previewContainer = document.getElementById('emailPreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';
}

async function previewEmail() {
  if (!emailDialogState.selectedTemplateId || !emailDialogState.kundeId) return;

  const customVariables = {};
  const template = emailDialogState.templates.find(t => t.id === emailDialogState.selectedTemplateId);
  if (template?.category === 'generell') {
    const subjectEl = document.getElementById('emailCustomSubject');
    const messageEl = document.getElementById('emailCustomMessage');
    if (subjectEl) customVariables.emne = subjectEl.value;
    if (messageEl) customVariables.melding = messageEl.value;
  }

  try {
    const res = await apiFetch('/api/customer-emails/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: emailDialogState.selectedTemplateId,
        kunde_id: emailDialogState.kundeId,
        custom_variables: customVariables,
      }),
    });

    const previewContainer = document.getElementById('emailPreviewContainer');
    const subjectEl = document.getElementById('emailPreviewSubject');
    const frameEl = document.getElementById('emailPreviewFrame');

    if (previewContainer && subjectEl && frameEl) {
      previewContainer.style.display = 'block';
      subjectEl.textContent = `Emne: ${res.data.subject}`;
      // Write HTML into iframe for safe rendering
      const doc = frameEl.contentDocument || frameEl.contentWindow.document;
      doc.open();
      doc.write(res.data.html);
      doc.close();
    }
  } catch {
    showNotification('Kunne ikke generere forhåndsvisning', 'error');
  }
}

async function sendEmailFromDialog() {
  if (!emailDialogState.selectedTemplateId || !emailDialogState.kundeId) return;

  const sendBtn = document.querySelector('.email-send-btn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sender...';
  }

  const customVariables = {};
  const template = emailDialogState.templates.find(t => t.id === emailDialogState.selectedTemplateId);
  if (template?.category === 'generell') {
    const subjectEl = document.getElementById('emailCustomSubject');
    const messageEl = document.getElementById('emailCustomMessage');
    if (subjectEl) customVariables.emne = subjectEl.value;
    if (messageEl) customVariables.melding = messageEl.value;

    if (!customVariables.emne || !customVariables.melding) {
      showNotification('Fyll inn emne og melding', 'error');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send e-post';
      }
      return;
    }
  }

  try {
    await apiFetch('/api/customer-emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: emailDialogState.selectedTemplateId,
        kunde_id: emailDialogState.kundeId,
        custom_variables: customVariables,
      }),
    });

    showNotification('E-post sendt!', 'success');
    closeEmailDialog();

    // Refresh customers to update lifecycle colors
    await loadCustomers();
  } catch (err) {
    showNotification(err.message || 'Kunne ikke sende e-post', 'error');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send e-post';
    }
  }
}

function closeEmailDialog() {
  const overlay = document.querySelector('.email-dialog-overlay');
  if (overlay) overlay.remove();
  emailDialogState = { kundeId: null, templates: [], selectedTemplateId: null };
}

// Populate dynamic dropdowns from ServiceTypeRegistry
function populateDynamicDropdowns(customer = null) {
  // Kategori dropdown
  const kategoriSelect = document.getElementById('kategori');
  if (kategoriSelect) {
    kategoriSelect.innerHTML = serviceTypeRegistry.renderCategoryOptions(customer?.kategori || '');
  }

  // El-type (subtypes for el-kontroll)
  const elTypeSelect = document.getElementById('el_type');
  if (elTypeSelect) {
    elTypeSelect.innerHTML = serviceTypeRegistry.renderSubtypeOptions('el-kontroll', customer?.el_type || '');
  }

  // Brann system (equipment for brannvarsling)
  const brannSystemSelect = document.getElementById('brann_system');
  if (brannSystemSelect) {
    brannSystemSelect.innerHTML = serviceTypeRegistry.renderEquipmentOptions('brannvarsling', customer?.brann_system || '');
  }

  // Intervaller
  const elIntervallSelect = document.getElementById('el_kontroll_intervall');
  if (elIntervallSelect) {
    elIntervallSelect.innerHTML = serviceTypeRegistry.renderIntervalOptions(customer?.el_kontroll_intervall || 36);
  }

  const brannIntervallSelect = document.getElementById('brann_kontroll_intervall');
  if (brannIntervallSelect) {
    brannIntervallSelect.innerHTML = serviceTypeRegistry.renderIntervalOptions(customer?.brann_kontroll_intervall || 12);
  }

  // Driftskategori (brann-relatert subtype)
  const driftsSelect = document.getElementById('driftskategori');
  if (driftsSelect) {
    driftsSelect.innerHTML = serviceTypeRegistry.renderDriftsOptions(customer?.brann_driftstype || '');
  }
}

// Edit customer
function editCustomer(id) {
  const customer = customers.find(c => c.id === id);
  if (!customer) return;

  // Populate dynamic dropdowns first
  populateDynamicDropdowns(customer);

  document.getElementById('modalTitle').textContent = 'Rediger kunde';
  document.getElementById('customerId').value = customer.id;
  document.getElementById('navn').value = customer.navn || '';
  document.getElementById('adresse').value = customer.adresse || '';
  document.getElementById('postnummer').value = customer.postnummer || '';
  document.getElementById('poststed').value = customer.poststed || '';
  document.getElementById('telefon').value = customer.telefon || '';
  document.getElementById('epost').value = customer.epost || '';
  const trimDate = (v) => appConfig.datoModus === 'month_year' && v && v.length >= 7 ? v.substring(0, 7) : (v || '');
  document.getElementById('siste_kontroll').value = trimDate(customer.siste_kontroll);
  document.getElementById('neste_kontroll').value = trimDate(customer.neste_kontroll);
  document.getElementById('kontroll_intervall').value = customer.kontroll_intervall_mnd || 12;
  document.getElementById('notater').value = customer.notater || '';
  document.getElementById('lat').value = customer.lat || '';
  document.getElementById('lng').value = customer.lng || '';

  // Update geocode quality badge
  updateGeocodeQualityBadge(customer.geocode_quality || (customer.lat ? 'exact' : null));

  // Separate kontroll-felt for El-Kontroll
  document.getElementById('siste_el_kontroll').value = trimDate(customer.siste_el_kontroll);
  document.getElementById('neste_el_kontroll').value = trimDate(customer.neste_el_kontroll);

  // Separate kontroll-felt for Brannvarsling
  document.getElementById('siste_brann_kontroll').value = trimDate(customer.siste_brann_kontroll);
  document.getElementById('neste_brann_kontroll').value = trimDate(customer.neste_brann_kontroll);

  // Vis/skjul kontroll-seksjoner basert på kategori
  updateControlSectionsVisibility(customer.kategori);

  // Load email settings for this customer
  loadCustomerEmailSettings(customer.id);

  // Populate custom organization fields
  populateCustomFields(customer.custom_data);

  // Show kontaktlogg section and load data
  document.getElementById('kontaktloggSection').style.display = 'block';
  loadKontaktlogg(customer.id);

  // Load tags for this customer
  loadKundeTags(customer.id);

  // Load kontaktpersoner for this customer
  loadKontaktpersoner(customer.id);

  document.getElementById('deleteCustomerBtn').classList.remove('hidden');
  customerModal.classList.remove('hidden');

  // Highlight missing fields
  highlightMissingFields(customer);
}

// Highlight fields that are missing data
function highlightMissingFields(customer) {
  // Remove previous highlights
  document.querySelectorAll('.missing-field').forEach(el => el.classList.remove('missing-field'));

  // Check and highlight missing fields
  const fieldsToCheck = [
    { id: 'telefon', value: customer.telefon },
    { id: 'epost', value: customer.epost },
    { id: 'neste_el_kontroll', value: customer.neste_el_kontroll, condition: customer.kategori?.includes('El-Kontroll') },
    { id: 'neste_brann_kontroll', value: customer.neste_brann_kontroll, condition: customer.kategori?.includes('Brann') }
  ];

  fieldsToCheck.forEach(field => {
    // Skip if condition is defined and false
    if (field.condition === false) return;

    const element = document.getElementById(field.id);
    if (element && (!field.value || field.value.trim() === '')) {
      element.classList.add('missing-field');
    }
  });
}

// ========================================
// ORGANIZATION DYNAMIC FIELDS
// ========================================

/**
 * Load organization-specific custom fields from the API
 */
async function loadOrganizationFields() {
  try {
    const response = await apiFetch('/api/fields');
    if (response.ok) {
      organizationFields = await response.json();
      renderCustomFieldsInForm();
      renderDynamicFieldFilters();
      Logger.log('Loaded organization fields:', organizationFields.length);
    }
  } catch (error) {
    Logger.warn('Could not load organization fields:', error);
    organizationFields = [];
  }
}

/**
 * Load organization-specific categories
 */
async function loadOrganizationCategories() {
  try {
    const response = await apiFetch('/api/service-types');
    if (response.ok) {
      const result = await response.json();
      organizationCategories = result.data || result;

      // Sync serviceTypeRegistry so sidebar/filter UI stays up to date
      if (appConfig) {
        appConfig.serviceTypes = organizationCategories.map(cat => ({
          id: cat.id, name: cat.name, slug: cat.slug,
          icon: cat.icon, color: cat.color,
          defaultInterval: cat.default_interval_months,
        }));
        serviceTypeRegistry.loadFromConfig(appConfig);
      }

      // Re-render category UI to reflect loaded categories
      renderFilterPanelCategories();
      updateMapLegend();

      Logger.log('Loaded organization categories:', organizationCategories.length);
    }
  } catch (error) {
    Logger.warn('Could not load organization categories:', error);
    organizationCategories = [];
  }
}

/**
 * Render custom organization fields for the popup display
 * Shows fields from Excel import stored in custom_data
 * @param {Object} customer - Customer object with custom_data
 * @returns {string} HTML string for custom fields section
 */
function renderPopupCustomFields(customer) {
  // Filter to only visible fields
  const visibleFields = organizationFields.filter(f =>
    f.is_visible && f.is_visible !== 0
  );

  if (visibleFields.length === 0) return '';

  // Parse custom_data
  let customData = customer.custom_data;
  if (typeof customData === 'string') {
    try { customData = JSON.parse(customData); } catch { customData = {}; }
  }
  customData = customData || {};

  let html = '';

  for (const field of visibleFields) {
    const value = customData[field.field_name];
    if (value !== undefined && value !== null && value !== '') {
      // Format value based on field type
      let displayValue = value;

      if (field.field_type === 'date') {
        try {
          displayValue = formatDate(value);
        } catch { displayValue = value; }
      } else if (field.field_type === 'select' && field.options) {
        // Find display_name for the value
        const option = field.options.find(o => o.value === value);
        displayValue = option?.display_name || value;
      }

      html += `<p><strong>${escapeHtml(field.display_name)}:</strong> ${escapeHtml(String(displayValue))}</p>`;
    }
  }

  return html;
}

/**
 * Render custom fields in the customer form based on organization_fields
 */
function renderCustomFieldsInForm() {
  const section = document.getElementById('customFieldsSection');
  const container = document.getElementById('customFieldsContainer');

  if (!section || !container) return;

  // Filter to only visible fields
  const visibleFields = organizationFields.filter(f => f.is_visible);

  if (visibleFields.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  // Generate form fields
  container.innerHTML = visibleFields.map(field => {
    const fieldId = `custom_${field.field_name}`;
    const required = field.is_required ? 'required' : '';
    const requiredMark = field.is_required ? ' *' : '';

    let inputHtml = '';

    switch (field.field_type) {
      case 'select':
        const options = (field.options || []).map(opt =>
          `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.display_name || opt.value)}</option>`
        ).join('');
        inputHtml = `
          <select id="${fieldId}" ${required}>
            <option value="">-- Velg --</option>
            ${options}
          </select>
        `;
        break;

      case 'date':
        inputHtml = `<input type="date" id="${fieldId}" ${required}>`;
        break;

      case 'number':
        inputHtml = `<input type="number" id="${fieldId}" ${required}>`;
        break;

      case 'text':
      default:
        inputHtml = `<input type="text" id="${fieldId}" ${required}>`;
        break;
    }

    return `
      <div class="form-group">
        <label for="${fieldId}">${escapeHtml(field.display_name)}${requiredMark}</label>
        ${inputHtml}
      </div>
    `;
  }).join('');
}

/**
 * Populate custom fields with customer data
 * @param {Object} customData - The custom_data JSON from the customer record
 */
function populateCustomFields(customData) {
  if (!customData) return;

  let data = customData;
  if (typeof customData === 'string') {
    try {
      data = JSON.parse(customData);
    } catch (e) {
      data = {};
    }
  }

  for (const field of organizationFields) {
    const element = document.getElementById(`custom_${field.field_name}`);
    if (element && data[field.field_name] !== undefined) {
      element.value = data[field.field_name];
    }
  }
}

/**
 * Clear all custom fields in the form
 */
function clearCustomFields() {
  for (const field of organizationFields) {
    const element = document.getElementById(`custom_${field.field_name}`);
    if (element) {
      element.value = '';
    }
  }
}

/**
 * Collect custom field values from the form
 * @returns {Object} Custom data object
 */
function collectCustomFieldValues() {
  const customData = {};

  for (const field of organizationFields) {
    const element = document.getElementById(`custom_${field.field_name}`);
    if (element && element.value) {
      customData[field.field_name] = element.value;
    }
  }

  return customData;
}

// ========================================
// ADMIN: FIELD MANAGEMENT
// ========================================

/**
 * Get field type display name
 */
function getFieldTypeName(type) {
  const types = { text: 'Tekst', select: 'Rullegardin', number: 'Tall', date: 'Dato' };
  return types[type] || type;
}

/**
 * Render organization fields in admin panel
 */
function renderAdminFields() {
  const listContainer = document.getElementById('fieldsList');
  const emptyContainer = document.getElementById('fieldsEmpty');

  if (!listContainer) return;

  if (organizationFields.length === 0) {
    listContainer.style.display = 'none';
    if (emptyContainer) emptyContainer.style.display = 'block';
    return;
  }

  listContainer.style.display = 'flex';
  if (emptyContainer) emptyContainer.style.display = 'none';

  listContainer.innerHTML = organizationFields.map((field, index) => `
    <div class="sortable-item" data-id="${field.id}" data-index="${index}" draggable="true">
      <div class="drag-handle">
        <i class="fas fa-grip-vertical"></i>
      </div>
      <div class="item-info">
        <span class="item-name">${escapeHtml(field.display_name)}</span>
        <span class="item-meta">
          ${escapeHtml(field.field_name)} | ${getFieldTypeName(field.field_type)}
          ${field.is_filterable ? '<span class="badge">Filter</span>' : ''}
          ${field.is_required ? '<span class="badge warning">Obligatorisk</span>' : ''}
          ${!field.is_visible ? '<span class="badge muted">Skjult</span>' : ''}
        </span>
      </div>
      <div class="item-actions">
        <button class="btn-icon" onclick="openFieldModal(${field.id})" title="Rediger">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icon danger" onclick="confirmDeleteField(${field.id})" title="Slett">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');

  initSortable(listContainer, 'fields');
}

/**
 * Open field modal for adding/editing
 */
function openFieldModal(fieldId = null) {
  const modal = document.getElementById('fieldModal');
  const title = document.getElementById('fieldModalTitle');
  const deleteBtn = document.getElementById('deleteFieldBtn');
  const fieldNameInput = document.getElementById('fieldName');

  // Reset form
  document.getElementById('fieldForm').reset();
  document.getElementById('fieldId').value = '';
  document.getElementById('fieldVisible').checked = true;
  document.getElementById('fieldOptionsSection').style.display = 'none';
  document.getElementById('fieldOptionsList').innerHTML = '';

  if (fieldId) {
    const field = organizationFields.find(f => f.id === fieldId);
    if (!field) return;

    title.textContent = 'Rediger felt';
    document.getElementById('fieldId').value = field.id;
    document.getElementById('fieldDisplayName').value = field.display_name;
    fieldNameInput.value = field.field_name;
    fieldNameInput.disabled = true; // Can't change field_name
    document.getElementById('fieldType').value = field.field_type;
    document.getElementById('fieldFilterable').checked = field.is_filterable === 1 || field.is_filterable === true;
    document.getElementById('fieldRequired').checked = field.is_required === 1 || field.is_required === true;
    document.getElementById('fieldVisible').checked = field.is_visible === 1 || field.is_visible === true;

    if (field.field_type === 'select') {
      document.getElementById('fieldOptionsSection').style.display = 'block';
      renderFieldOptions(field.options || []);
    }

    deleteBtn.style.display = 'inline-block';
  } else {
    title.textContent = 'Nytt felt';
    fieldNameInput.disabled = false;
    deleteBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');
}

/**
 * Render options list for select fields
 */
function renderFieldOptions(options) {
  const container = document.getElementById('fieldOptionsList');
  container.innerHTML = options.map((opt, index) => `
    <div class="option-item" data-index="${index}" data-id="${opt.id || ''}">
      <input type="text" class="option-value" value="${escapeHtml(opt.value || '')}" placeholder="Verdi">
      <input type="text" class="option-display" value="${escapeHtml(opt.display_name || '')}" placeholder="Visningsnavn">
      <button type="button" class="btn-icon danger" onclick="removeFieldOption(this)" title="Fjern">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
}

/**
 * Add a new option input
 */
function addFieldOption() {
  const container = document.getElementById('fieldOptionsList');
  const index = container.children.length;
  const html = `
    <div class="option-item" data-index="${index}" data-id="">
      <input type="text" class="option-value" placeholder="Verdi">
      <input type="text" class="option-display" placeholder="Visningsnavn">
      <button type="button" class="btn-icon danger" onclick="removeFieldOption(this)" title="Fjern">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', html);
}

/**
 * Remove an option input
 */
function removeFieldOption(btn) {
  const item = btn.closest('.option-item');
  if (item) item.remove();
}

/**
 * Save field (create or update)
 */
async function saveField(event) {
  event.preventDefault();

  const id = document.getElementById('fieldId').value;
  const data = {
    field_name: document.getElementById('fieldName').value,
    display_name: document.getElementById('fieldDisplayName').value,
    field_type: document.getElementById('fieldType').value,
    is_filterable: document.getElementById('fieldFilterable').checked ? 1 : 0,
    is_required: document.getElementById('fieldRequired').checked ? 1 : 0,
    is_visible: document.getElementById('fieldVisible').checked ? 1 : 0
  };

  try {
    const url = id ? `/api/fields/${id}` : '/api/fields';
    const method = id ? 'PUT' : 'POST';

    const response = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Kunne ikke lagre felt');
    }

    const savedField = await response.json();

    // If select type, save options
    if (data.field_type === 'select') {
      await saveFieldOptions(savedField.id || id);
    }

    // Reload fields and close modal
    await loadOrganizationFields();
    renderAdminFields();
    document.getElementById('fieldModal').classList.add('hidden');

    showToast('Felt lagret', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Save field options
 */
async function saveFieldOptions(fieldId) {
  const optionItems = document.querySelectorAll('#fieldOptionsList .option-item');
  const existingField = organizationFields.find(f => f.id === parseInt(fieldId));
  const existingOptions = existingField?.options || [];

  // Collect current options from form
  const currentOptions = [];
  optionItems.forEach((item, index) => {
    const value = item.querySelector('.option-value').value.trim();
    const displayName = item.querySelector('.option-display').value.trim();
    const existingId = item.dataset.id;
    if (value) {
      currentOptions.push({
        id: existingId ? parseInt(existingId) : null,
        value,
        display_name: displayName || value,
        sort_order: index
      });
    }
  });

  // Delete removed options
  for (const existingOpt of existingOptions) {
    const stillExists = currentOptions.some(opt => opt.id === existingOpt.id);
    if (!stillExists) {
      try {
        await apiFetch(`/api/fields/${fieldId}/options/${existingOpt.id}`, { method: 'DELETE' });
      } catch (e) {
        Logger.warn('Could not delete option:', e);
      }
    }
  }

  // Add new options (those without id)
  for (const opt of currentOptions) {
    if (!opt.id) {
      try {
        await apiFetch(`/api/fields/${fieldId}/options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opt)
        });
      } catch (e) {
        Logger.warn('Could not add option:', e);
      }
    }
  }
}

/**
 * Confirm and delete field
 */
async function confirmDeleteField(id) {
  const confirmed = await showConfirm('Er du sikker på at du vil slette dette feltet? Data i kunderegistreringer vil bli beholdt, men ikke lenger vises.', 'Slette felt');
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/fields/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Kunne ikke slette felt');

    await loadOrganizationFields();
    renderAdminFields();
    renderDynamicFieldFilters();
    showToast('Felt slettet', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ========================================
// ADMIN: CATEGORY MANAGEMENT
// ========================================

/**
 * Render organization categories in admin panel
 */
/**
 * Open category list modal (from gear icon)
 */
function openCategoryListModal() {
  renderCategoryListItems();
  document.getElementById('categoryListModal').classList.remove('hidden');
}

/**
 * Render category list inside the list modal
 */
function renderCategoryListItems() {
  const container = document.getElementById('categoryListItems');
  if (!container) return;

  if (organizationCategories.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--color-text-muted); padding: 16px 0;">Ingen kategorier enda.</p>';
    return;
  }

  container.innerHTML = organizationCategories.map(cat => `
    <div class="category-list-item">
      <div class="category-list-info">
        <i class="fas ${escapeHtml(cat.icon || 'fa-tag')}" style="color: ${escapeHtml(cat.color || '#6B7280')}; margin-right: 8px;"></i>
        <span>${escapeHtml(cat.name)}</span>
        <span class="category-list-meta">${cat.default_interval_months || 12} mnd</span>
      </div>
      <div class="category-list-actions">
        <button class="btn-icon" onclick="document.getElementById('categoryListModal').classList.add('hidden'); openCategoryModal(${cat.id});" title="Rediger">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icon danger" onclick="confirmDeleteCategory(${cat.id})" title="Slett">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function renderAdminCategories() {
  const listContainer = document.getElementById('categoriesList');
  const emptyContainer = document.getElementById('categoriesEmpty');

  if (!listContainer) return;

  if (organizationCategories.length === 0) {
    listContainer.style.display = 'none';
    if (emptyContainer) emptyContainer.style.display = 'block';
    return;
  }

  listContainer.style.display = 'flex';
  if (emptyContainer) emptyContainer.style.display = 'none';

  listContainer.innerHTML = organizationCategories.map((cat, index) => `
    <div class="sortable-item" data-id="${cat.id}" data-index="${index}" draggable="true">
      <div class="drag-handle">
        <i class="fas fa-grip-vertical"></i>
      </div>
      <div class="item-info">
        <span class="item-name">
          <i class="fas ${escapeHtml(cat.icon || 'fa-tag')}" style="color: ${escapeHtml(cat.color || '#6B7280')}; margin-right: 8px;"></i>
          ${escapeHtml(cat.name)}
        </span>
        <span class="item-meta">
          ${escapeHtml(cat.slug)} | ${cat.default_interval_months || 12} mnd intervall
        </span>
      </div>
      <div class="item-actions">
        <button class="btn-icon" onclick="openCategoryModal(${cat.id})" title="Rediger">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-icon danger" onclick="confirmDeleteCategory(${cat.id})" title="Slett">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');

  initSortable(listContainer, 'categories');
}

/**
 * Open category modal for adding/editing
 */
const CATEGORY_ICONS = [
  'fa-wrench', 'fa-bolt', 'fa-fire', 'fa-fan',
  'fa-faucet', 'fa-shield-alt', 'fa-thermometer-half', 'fa-building',
  'fa-solar-panel', 'fa-tools', 'fa-hard-hat', 'fa-plug',
  'fa-tractor', 'fa-home', 'fa-cog', 'fa-check-circle'
];

function renderCategoryIconPicker(selectedIcon) {
  const container = document.getElementById('categoryIconPicker');
  if (!container) return;

  container.innerHTML = CATEGORY_ICONS.map(icon => `
    <button type="button" class="icon-btn ${icon === selectedIcon ? 'selected' : ''}"
            data-icon="${escapeHtml(icon)}" title="${escapeHtml(icon.replace('fa-', ''))}"
            onclick="selectCategoryIcon(this, '${escapeHtml(icon)}')">
      <i class="fas ${escapeHtml(icon)}"></i>
    </button>
  `).join('');
}

function selectCategoryIcon(btn, icon) {
  document.querySelectorAll('#categoryIconPicker .icon-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('categoryIcon').value = icon;
  console.log('[Category] Icon selected:', icon);
}

function updateCategoryColorPreview(color) {
  const preview = document.getElementById('categoryColorPreview');
  if (preview) preview.style.background = color;
}

function openCategoryModal(categoryId = null) {
  const modal = document.getElementById('categoryModal');
  const title = document.getElementById('categoryModalTitle');
  const deleteBtn = document.getElementById('deleteCategoryBtn');
  const sourceGroup = document.getElementById('categorySourceGroup');

  // Reset form
  document.getElementById('categoryForm').reset();
  document.getElementById('categoryId').value = '';
  document.getElementById('categorySlug').value = '';
  document.getElementById('categoryColor').value = '#F97316';
  document.getElementById('categoryInterval').value = '12';
  document.getElementById('categoryIcon').value = 'fa-wrench';
  document.getElementById('categoryDescription').value = '';
  sourceGroup.style.display = 'none';
  updateCategoryColorPreview('#F97316');
  renderCategoryIconPicker('fa-wrench');

  if (categoryId) {
    const category = organizationCategories.find(c => c.id === categoryId);
    if (!category) return;

    title.textContent = 'Rediger kategori';
    document.getElementById('categoryId').value = category.id;
    document.getElementById('categoryName').value = category.name;
    document.getElementById('categorySlug').value = category.slug;
    document.getElementById('categoryIcon').value = category.icon || 'fa-wrench';
    document.getElementById('categoryColor').value = category.color || '#F97316';
    document.getElementById('categoryInterval').value = String(category.default_interval_months || 12);
    document.getElementById('categoryDescription').value = category.description || '';

    updateCategoryColorPreview(category.color || '#F97316');
    renderCategoryIconPicker(category.icon || 'fa-wrench');

    // Show source badge
    if (category.source) {
      sourceGroup.style.display = 'block';
      const badge = document.getElementById('categorySourceBadge');
      const sourceLabels = { template: 'Bransjemal', tripletex: 'Tripletex', manual: 'Manuell' };
      badge.textContent = sourceLabels[category.source] || 'Manuell';
      badge.className = 'source-badge ' + (category.source || 'manual');
    }

    deleteBtn.style.display = 'inline-block';
  } else {
    title.textContent = 'Ny kategori';
    deleteBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');
}

/**
 * Save category (create or update)
 */
async function saveCategory(event) {
  event.preventDefault();

  const id = document.getElementById('categoryId').value;
  const name = document.getElementById('categoryName').value.trim();
  if (!name) return;

  // Use existing slug when editing, auto-generate for new
  let slug = document.getElementById('categorySlug').value;
  if (!slug) {
    slug = name.toLowerCase()
      .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'o').replace(/[å]/g, 'a')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  const description = document.getElementById('categoryDescription').value.trim();
  const icon = document.getElementById('categoryIcon').value;
  const color = document.getElementById('categoryColor').value;
  const data = {
    name,
    slug,
    icon,
    color,
    default_interval_months: parseInt(document.getElementById('categoryInterval').value) || 12,
    description: description || undefined
  };

  // Remember old name so we can update local customers if renamed
  let oldName = null;
  if (id) {
    const existing = organizationCategories.find(c => c.id === parseInt(id));
    if (existing && existing.name !== name) {
      oldName = existing.name;
    }
  }

  console.log('[Category] Saving:', data, oldName ? `(renaming from "${oldName}")` : '');

  try {
    const url = id ? `/api/service-types/${id}` : '/api/service-types';
    const method = id ? 'PUT' : 'POST';

    const response = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || error.error || 'Kunne ikke lagre kategori');
    }

    // Update local customers if category was renamed (backend already updated DB)
    if (oldName) {
      customers.forEach(c => {
        if (c.kategori === oldName) {
          c.kategori = name;
        }
      });
    }

    // Reload categories and close modal
    await loadOrganizationCategories();
    renderAdminCategories();
    renderFilterPanelCategories();
    renderCategoryListItems();
    renderMarkers(customers.filter(c => c.lat && c.lng));
    updateCategoryFilterCounts();
    document.getElementById('categoryModal').classList.add('hidden');

    showToast('Kategori lagret', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Confirm and delete category
 */
async function confirmDeleteCategory(id) {
  const confirmed = await showConfirm('Er du sikker på at du vil slette denne kategorien?', 'Slette kategori');
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/service-types/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Kunne ikke slette kategori');

    await loadOrganizationCategories();
    renderAdminCategories();
    renderFilterPanelCategories();
    renderCategoryListItems();
    renderMarkers(customers.filter(c => c.lat && c.lng));
    updateCategoryFilterCounts();
    showToast('Kategori slettet', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ========================================
// ADMIN: DRAG AND DROP SORTING
// ========================================

/**
 * Initialize drag-and-drop sorting for a list container
 */
function initSortable(container, type) {
  if (!container) return;

  // Skip if already initialized (prevent duplicate listeners)
  if (container.dataset.sortableInitialized === 'true') return;
  container.dataset.sortableInitialized = 'true';

  let draggedItem = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.sortable-item');
    if (!item) return;
    draggedItem = item;
    draggedItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', () => {
    if (draggedItem) {
      draggedItem.classList.remove('dragging');
      updateSortOrder(container, type);
      draggedItem = null;
    }
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedItem) return;

    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement == null) {
      container.appendChild(draggedItem);
    } else {
      container.insertBefore(draggedItem, afterElement);
    }
  });
}

/**
 * Get the element after which the dragged item should be inserted
 */
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.sortable-item:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * Update sort order after drag-and-drop
 */
async function updateSortOrder(container, type) {
  const items = container.querySelectorAll('.sortable-item');
  const updates = [];

  items.forEach((item, index) => {
    updates.push({ id: parseInt(item.dataset.id), sort_order: index });
  });

  try {
    // Update sort_order for each item
    for (const update of updates) {
      const endpoint = type === 'fields'
        ? `/api/fields/${update.id}`
        : `/api/service-types/${update.id}`;

      await apiFetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: update.sort_order })
      });
    }

    // Reload to ensure consistency
    if (type === 'fields') {
      await loadOrganizationFields();
    } else {
      await loadOrganizationCategories();
    }
  } catch (error) {
    Logger.error('Failed to update sort order:', error);
    showToast('Kunne ikke oppdatere rekkefølge', 'error');
  }
}

// Add new customer
function addCustomer() {
  // Populate dynamic dropdowns first (with defaults)
  populateDynamicDropdowns(null);

  document.getElementById('modalTitle').textContent = 'Ny kunde';
  customerForm.reset();
  document.getElementById('customerId').value = '';
  document.getElementById('kontroll_intervall').value = 12;
  document.getElementById('lat').value = '';
  document.getElementById('lng').value = '';
  updateGeocodeQualityBadge(null);

  // Clear custom organization fields
  clearCustomFields();

  // Reset separate kontroll-felt
  document.getElementById('siste_el_kontroll').value = '';
  document.getElementById('neste_el_kontroll').value = '';
  document.getElementById('el_kontroll_intervall').value = 36;
  document.getElementById('siste_brann_kontroll').value = '';
  document.getElementById('neste_brann_kontroll').value = '';
  document.getElementById('brann_kontroll_intervall').value = 12;

  // Vis kontroll-seksjoner basert på valgt kategori (eller default)
  const kategoriSelect = document.getElementById('kategori');
  // MVP: ingen default kategori, Full mode: El-Kontroll som default
  const defaultKategori = isMvpMode() ? '' : 'El-Kontroll';
  const selectedKategori = kategoriSelect ? kategoriSelect.value : defaultKategori;
  updateControlSectionsVisibility(selectedKategori);

  // Reset email settings to defaults
  const emailAktiv = document.getElementById('emailAktiv');
  const forsteVarsel = document.getElementById('forsteVarsel');
  const paaminnelseEtter = document.getElementById('paaminnelseEtter');
  const emailOptions = document.getElementById('emailOptions');
  if (emailAktiv) emailAktiv.checked = true;
  if (forsteVarsel) forsteVarsel.value = 30;
  if (paaminnelseEtter) paaminnelseEtter.value = 7;
  if (emailOptions) emailOptions.classList.remove('hidden');

  // Hide kontaktlogg for new customers
  document.getElementById('kontaktloggSection').style.display = 'none';
  document.getElementById('kontaktloggList').innerHTML = '';

  // Hide kontaktpersoner for new customers
  document.getElementById('kontaktpersonerSection').style.display = 'none';
  document.getElementById('kontaktpersonerList').innerHTML = '';

  document.getElementById('deleteCustomerBtn').classList.add('hidden');
  customerModal.classList.remove('hidden');
}

// Vis/skjul kontroll-seksjoner basert på kategori og app mode
function updateControlSectionsVisibility(kategori) {
  const elSection = document.getElementById('elKontrollSection');
  const brannSection = document.getElementById('brannvarslingSection');
  const mvpSection = document.getElementById('mvpKontrollSection');
  const driftskategoriGroup = document.getElementById('driftskategori')?.closest('.form-group');
  const kategoriGroup = document.getElementById('kategori')?.closest('.form-group');

  console.log('[MVP Debug] updateControlSectionsVisibility called:', {
    kategori,
    appMode: appConfig.appMode,
    isMvpMode: isMvpMode(),
    mvpSectionFound: !!mvpSection
  });

  if (!elSection || !brannSection) return;

  // MVP-modus: Vis enkel oppfølgings-seksjon, skjul avanserte seksjoner
  if (isMvpMode()) {
    console.log('[MVP Debug] Setting MVP mode - showing mvpSection');
    elSection.style.display = 'none';
    brannSection.style.display = 'none';
    if (mvpSection) mvpSection.style.display = 'block';
    if (driftskategoriGroup) driftskategoriGroup.style.display = 'none';
    if (kategoriGroup) kategoriGroup.style.display = 'none';
    return;
  }

  // Full mode (TRE Allservice): Skjul MVP-seksjon, vis avanserte basert på kategori
  if (mvpSection) mvpSection.style.display = 'none';
  if (driftskategoriGroup) driftskategoriGroup.style.display = 'block';
  if (kategoriGroup) kategoriGroup.style.display = 'block';

  const kat = (kategori || '').toLowerCase();

  if (kat.includes('el') && kat.includes('brann')) {
    // Kombinert - vis begge
    elSection.style.display = 'block';
    brannSection.style.display = 'block';
  } else if (kat.includes('brann')) {
    // Kun brannvarsling
    elSection.style.display = 'none';
    brannSection.style.display = 'block';
  } else {
    // Kun el-kontroll (standard)
    elSection.style.display = 'block';
    brannSection.style.display = 'none';
  }
}

// Auto-geocode address
async function geocodeAddressAuto(adresse, postnummer, poststed) {
  const fullAddress = `${adresse}, ${postnummer} ${poststed}, Norway`;

  // Try Kartverket first
  try {
    const kartverketUrl = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(fullAddress)}&fuzzy=true&treffPerSide=1`;
    const response = await fetch(kartverketUrl);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      const addr = data.adresser[0];
      if (addr.representasjonspunkt) {
        return { lat: addr.representasjonspunkt.lat, lng: addr.representasjonspunkt.lon };
      }
    }
  } catch (error) {
    Logger.log('Kartverket geocode failed:', error);
  }

  // Try with just poststed
  try {
    const simpleAddress = `${postnummer} ${poststed}`;
    const kartverketUrl = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(simpleAddress)}&fuzzy=true&treffPerSide=1`;
    const response = await fetch(kartverketUrl);
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      const addr = data.adresser[0];
      if (addr.representasjonspunkt) {
        return { lat: addr.representasjonspunkt.lat, lng: addr.representasjonspunkt.lon };
      }
    }
  } catch (error) {
    Logger.log('Kartverket poststed geocode failed:', error);
  }

  // Fallback to Nominatim
  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;
    const response = await fetch(nominatimUrl);
    const data = await response.json();

    if (data && data.length > 0) {
      return { lat: Number.parseFloat(data[0].lat), lng: Number.parseFloat(data[0].lon) };
    }
  } catch (error) {
    Logger.log('Nominatim geocode failed:', error);
  }

  return null;
}

// Save customer
async function saveCustomer(e) {
  e.preventDefault();

  const customerId = document.getElementById('customerId').value;
  let lat = Number.parseFloat(document.getElementById('lat').value) || null;
  let lng = Number.parseFloat(document.getElementById('lng').value) || null;

  const adresse = document.getElementById('adresse').value;
  const postnummer = document.getElementById('postnummer').value;
  const poststed = document.getElementById('poststed').value;

  // Auto-geocode if no coordinates
  if (!lat || !lng) {
    showNotification('Geokoder adresse...');
    const coords = await geocodeAddressAuto(adresse, postnummer, poststed);
    if (coords) {
      lat = coords.lat;
      lng = coords.lng;
      document.getElementById('lat').value = lat;
      document.getElementById('lng').value = lng;
    }
  }

  // MVP: ingen kategori (null), Full mode: bruk dropdown-verdi eller El-Kontroll som default
  let kategori = null;
  if (!isMvpMode()) {
    kategori = document.getElementById('kategori').value || 'El-Kontroll';
  }

  const data = {
    navn: document.getElementById('navn').value,
    adresse: adresse,
    postnummer: postnummer,
    poststed: poststed,
    telefon: document.getElementById('telefon').value,
    epost: document.getElementById('epost').value,
    lat: lat,
    lng: lng,
    siste_kontroll: normalizeDateValue(document.getElementById('siste_kontroll').value) || null,
    neste_kontroll: normalizeDateValue(document.getElementById('neste_kontroll').value) || null,
    kontroll_intervall_mnd: Number.parseInt(document.getElementById('kontroll_intervall').value) || 12,
    kategori: kategori,
    notater: document.getElementById('notater').value,
    // El-type specification
    el_type: document.getElementById('el_type') ? document.getElementById('el_type').value : null,
    // Separate El-Kontroll felt
    siste_el_kontroll: normalizeDateValue(document.getElementById('siste_el_kontroll').value) || null,
    neste_el_kontroll: normalizeDateValue(document.getElementById('neste_el_kontroll').value) || null,
    el_kontroll_intervall: Number.parseInt(document.getElementById('el_kontroll_intervall').value) || 36,
    // Brann-system specification
    brann_system: document.getElementById('brann_system') ? document.getElementById('brann_system').value : null,
    // Separate Brannvarsling felt
    siste_brann_kontroll: normalizeDateValue(document.getElementById('siste_brann_kontroll').value) || null,
    neste_brann_kontroll: normalizeDateValue(document.getElementById('neste_brann_kontroll').value) || null,
    brann_kontroll_intervall: Number.parseInt(document.getElementById('brann_kontroll_intervall').value) || 12,
    // Driftskategori
    brann_driftstype: document.getElementById('driftskategori').value || null,
    // Custom organization fields
    custom_data: JSON.stringify(collectCustomFieldValues())
  };

  try {
    const url = customerId ? `/api/kunder/${customerId}` : '/api/kunder';
    const method = customerId ? 'PUT' : 'POST';

    Logger.log('Saving customer:', { url, method, data });

    const response = await apiFetch(url, {
      method,
      body: JSON.stringify(data)
    });

    const result = await response.json();
    Logger.log('Server response:', response.status, result);

    if (!response.ok) {
      const errorMsg = result.errors ? result.errors.join(', ') : (result.error || 'Ukjent feil');
      showMessage('Kunne ikke lagre: ' + errorMsg, 'error');
      return;
    }

    const savedCustomerId = customerId || result.id;

    // Save email settings
    if (savedCustomerId) {
      await saveCustomerEmailSettings(savedCustomerId);
    }

    customerModal.classList.add('hidden');

    // Reset filter to show all customers so the new/updated one is visible
    currentFilter = 'alle';
    showOnlyWarnings = false;
    const omradeSelect = document.getElementById('omradeSelect');
    if (omradeSelect) omradeSelect.value = 'alle';

    await loadCustomers();
    await loadOmrader();
    showNotification('Kunde lagret!');
  } catch (error) {
    console.error('Lagring feilet:', error);
    showMessage('Kunne ikke lagre kunden: ' + error.message, 'error');
  }
}

// Delete customer
async function deleteCustomer() {
  const customerId = document.getElementById('customerId').value;
  if (!customerId) return;

  const kundeNavn = document.getElementById('navn').value || 'denne kunden';
  const confirmed = await showConfirm(
    `Er du sikker på at du vil slette "${kundeNavn}"? Dette kan ikke angres.`,
    'Slette kunde'
  );
  if (!confirmed) return;

  try {
    await apiFetch(`/api/kunder/${customerId}`, { method: 'DELETE' });
    customerModal.classList.add('hidden');
    selectedCustomers.delete(Number.parseInt(customerId));
    await loadCustomers();
    await loadOmrader();
    updateSelectionUI();
  } catch (error) {
    console.error('Sletting feilet:', error);
    showMessage('Kunne ikke slette kunden. Prøv igjen senere.', 'error');
  }
}

// Geocode button handler
async function handleGeocode() {
  const address = document.getElementById('adresse').value;
  const postnummer = document.getElementById('postnummer').value;
  const poststed = document.getElementById('poststed').value;

  if (!address) {
    showMessage('Skriv inn en adresse først', 'warning');
    return;
  }

  const geocodeBtn = document.getElementById('geocodeBtn');
  geocodeBtn.classList.add('loading');
  geocodeBtn.disabled = true;

  const result = await geocodeAddress(address, postnummer, poststed);

  geocodeBtn.classList.remove('loading');
  geocodeBtn.disabled = false;

  if (result) {
    document.getElementById('lat').value = result.lat;
    document.getElementById('lng').value = result.lng;
    updateGeocodeQualityBadge('exact');
    showNotification('Koordinater funnet!', 'success');
  } else {
    showMessage('Kunne ikke finne koordinater for adressen. Sjekk at adressen er riktig.', 'warning');
  }
}

// Enable coordinate picking from map
let isPickingCoordinates = false;
let pickingIndicator = null;

function enableCoordinatePicking() {
  if (isPickingCoordinates) {
    disableCoordinatePicking();
    return;
  }

  isPickingCoordinates = true;

  // Hide the customer modal temporarily
  const customerModal = document.getElementById('customerModal');
  customerModal.classList.add('hidden');

  // Add picking mode class to map
  const mapContainer = document.getElementById('sharedMapContainer');
  mapContainer.classList.add('map-picking-mode');

  // Show indicator
  pickingIndicator = document.createElement('div');
  pickingIndicator.className = 'picking-mode-indicator';
  pickingIndicator.innerHTML = '<i class="fas fa-crosshairs"></i> Klikk på kartet for å velge posisjon';
  document.body.appendChild(pickingIndicator);

  // Add click handler to map
  map.once('click', handleMapPick);

  // Allow escape to cancel
  document.addEventListener('keydown', handlePickingEscape);
}

function handleMapPick(e) {
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;

  // Update form fields
  document.getElementById('lat').value = lat.toFixed(6);
  document.getElementById('lng').value = lng.toFixed(6);

  // Update quality badge
  updateGeocodeQualityBadge('manual');

  // Show notification
  showNotification(`Koordinater valgt: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');

  // Clean up and show modal again
  disableCoordinatePicking();

  // Show modal again
  const customerModal = document.getElementById('customerModal');
  customerModal.classList.remove('hidden');
}

function handlePickingEscape(e) {
  if (e.key === 'Escape' && isPickingCoordinates) {
    disableCoordinatePicking();
    // Show modal again
    const customerModal = document.getElementById('customerModal');
    customerModal.classList.remove('hidden');
    showNotification('Avbrutt', 'info');
  }
}

function disableCoordinatePicking() {
  isPickingCoordinates = false;

  // Remove picking mode class
  const mapContainer = document.getElementById('sharedMapContainer');
  mapContainer.classList.remove('map-picking-mode');

  // Remove indicator
  if (pickingIndicator) {
    pickingIndicator.remove();
    pickingIndicator = null;
  }

  // Remove event listeners
  map.off('click', handleMapPick);
  document.removeEventListener('keydown', handlePickingEscape);
}

function updateGeocodeQualityBadge(quality) {
  const badge = document.getElementById('geocodeQualityBadge');
  const warning = document.getElementById('geocodeWarning');

  if (!badge) return;

  badge.className = 'geocode-quality-badge';

  switch (quality) {
    case 'exact':
      badge.textContent = 'Eksakt';
      badge.classList.add('quality-exact');
      if (warning) warning.style.display = 'none';
      break;
    case 'street':
      badge.textContent = 'Gate-nivå';
      badge.classList.add('quality-street');
      if (warning) warning.style.display = 'none';
      break;
    case 'area':
      badge.textContent = 'Område-nivå';
      badge.classList.add('quality-area');
      if (warning) warning.style.display = 'flex';
      break;
    case 'manual':
      badge.textContent = 'Manuelt valgt';
      badge.classList.add('quality-manual');
      if (warning) warning.style.display = 'none';
      break;
    default:
      badge.textContent = '';
      if (warning) warning.style.display = 'none';
  }
}

// Format date
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  if (appConfig.datoModus === 'month_year') {
    return date.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('nb-NO');
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  if (appConfig.datoModus === 'month_year') {
    return date.toLocaleDateString('nb-NO', { month: 'short', year: 'numeric' });
  }
  return date.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' });
}

function formatDateInline(date) {
  if (!date) return '';
  if (isNaN(date.getTime())) return '';
  if (appConfig.datoModus === 'month_year') {
    return date.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalizeDateValue(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return value + '-01';
  return value;
}

function applyDateModeToInputs() {
  if (appConfig.datoModus !== 'month_year') return;
  document.querySelectorAll('input[type="date"]').forEach(input => {
    input.type = 'month';
    if (input.value && input.value.length === 10) {
      input.value = input.value.substring(0, 7);
    }
  });
}

// Save API key
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (apiKey) {
    localStorage.setItem('ors_api_key', apiKey);
    apiKeyModal.classList.add('hidden');
    planRoute(); // Retry route planning
  }
}

// ============================================
// CUSTOMER ADMIN TAB
// ============================================

let customerAdminKategori = 'alle';
let customerAdminSearch = '';

function renderCustomerAdmin() {
  const container = document.getElementById('customerAdminList');
  const countDisplay = document.getElementById('customerCountDisplay');

  if (!container) return;

  // Set up event delegation for buttons (only once)
  if (!container.dataset.delegationSetup) {
    container.dataset.delegationSetup = 'true';
    container.addEventListener('click', (e) => {
      // Handle checkbox clicks
      if (e.target.classList.contains('bulk-checkbox')) {
        e.stopPropagation();
        const id = Number.parseInt(e.target.dataset.id);
        if (e.target.checked) {
          bulkSelectedCustomers.add(id);
        } else {
          bulkSelectedCustomers.delete(id);
        }
        updateBulkSelectionUI();
        return;
      }

      const item = e.target.closest('.customer-admin-item');
      if (!item) return;

      const id = Number.parseInt(item.dataset.id);
      // Click on item opens edit (unless clicking checkbox)
      if (!e.target.classList.contains('bulk-checkbox')) {
        editCustomer(id);
      }
    });
  }

  // Filter customers
  let filtered = [...customers];

  // Kategori filter (using dynamic service type registry)
  if (customerAdminKategori !== 'alle') {
    const beforeCount = filtered.length;
    filtered = filtered.filter(c => serviceTypeRegistry.matchesCategory(c, customerAdminKategori));
    Logger.log(`Filter: "${customerAdminKategori}" - ${beforeCount} -> ${filtered.length} kunder`);
  }

  // Search filter
  if (customerAdminSearch) {
    const search = customerAdminSearch.toLowerCase();
    filtered = filtered.filter(c =>
      c.navn.toLowerCase().includes(search) ||
      (c.adresse && c.adresse.toLowerCase().includes(search)) ||
      (c.poststed && c.poststed.toLowerCase().includes(search))
    );
  }

  // Sort by name
  sortByNavn(filtered);

  // Update stats
  if (countDisplay) countDisplay.textContent = `${filtered.length} av ${customers.length} kunder`;

  // Render list
  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-text-muted);">Ingen kunder funnet</div>';
    return;
  }

  container.innerHTML = filtered.map(c => {
    const hasCoords = c.lat && c.lng;

    // Beregn neste kontroll status
    let nextControlInfo = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (c.kategori === 'El-Kontroll' || c.kategori === 'El-Kontroll + Brannvarsling') {
      if (c.neste_el_kontroll) {
        const nextDate = new Date(c.neste_el_kontroll);
        const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
        const statusClass = daysUntil < 0 ? 'overdue' : daysUntil <= 30 ? 'warning' : 'ok';
        nextControlInfo += `<span class="control-badge ${statusClass}">El: ${escapeHtml(formatDateShort(c.neste_el_kontroll))}</span>`;
      }
    }
    if (c.kategori === 'Brannvarsling' || c.kategori === 'El-Kontroll + Brannvarsling') {
      if (c.neste_brann_kontroll) {
        const nextDate = new Date(c.neste_brann_kontroll);
        const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
        const statusClass = daysUntil < 0 ? 'overdue' : daysUntil <= 30 ? 'warning' : 'ok';
        nextControlInfo += `<span class="control-badge ${statusClass}">Brann: ${escapeHtml(formatDateShort(c.neste_brann_kontroll))}</span>`;
      }
    }

    const isChecked = bulkSelectedCustomers.has(c.id);

    // Build service info badges (el_type, brannsystem, driftstype) - use normalized values
    let serviceInfo = '';
    if (c.el_type) {
      serviceInfo += `<span class="service-badge type-badge">${escapeHtml(c.el_type)}</span>`;
    }
    if (c.brann_system) {
      const normalizedSystem = normalizeBrannsystem(c.brann_system);
      if (normalizedSystem) {
        serviceInfo += `<span class="service-badge system-badge">${escapeHtml(normalizedSystem)}</span>`;
      }
    }
    if (c.brann_driftstype) {
      const normalizedDrift = normalizeDriftstype(c.brann_driftstype);
      if (normalizedDrift) {
        serviceInfo += `<span class="service-badge drift-badge">${escapeHtml(normalizedDrift)}</span>`;
      }
    }

    return `
      <div class="customer-admin-item ${!hasCoords ? 'no-coords' : ''} ${isChecked ? 'bulk-selected' : ''}" data-id="${c.id}">
        <input type="checkbox" class="bulk-checkbox" data-id="${c.id}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation()">
        <div class="customer-info">
          <span class="customer-name">${escapeHtml(c.navn)}</span>
          <span class="customer-location">${escapeHtml(c.poststed || '')}</span>
          ${serviceInfo}
          ${nextControlInfo}
        </div>
      </div>
    `;
  }).join('');

  // Update bulk selection UI
  updateBulkSelectionUI();
}

async function deleteCustomerAdmin(id) {
  const customer = customers.find(c => c.id === id);
  if (!customer) return;

  const confirmed = await showConfirm(
    `Er du sikker på at du vil slette "${customer.navn}"? Dette kan ikke angres.`,
    'Slette kunde'
  );
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/kunder/${id}`, { method: 'DELETE' });
    if (response.ok) {
      await loadCustomers();
      await loadOmrader();
      showNotification('Kunde slettet');
    }
  } catch (error) {
    console.error('Feil ved sletting:', error);
    showMessage('Kunne ikke slette kunden. Prøv igjen senere.', 'error');
  }
}

// Make available globally
window.deleteCustomerAdmin = deleteCustomerAdmin;

// Render overdue controls (forfalt)
function renderOverdue() {
  const container = document.getElementById('overdueContainer');
  const countHeader = document.getElementById('overdueCountHeader');
  const sortSelect = document.getElementById('overdueSortSelect');
  const sortBy = sortSelect?.value || 'days';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get overdue customers - use getNextControlDate to check all date fields
  let overdueCustomers = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    return nextDate < today;
  });

  // Calculate days overdue for each
  overdueCustomers = overdueCustomers.map(c => {
    const nextDate = getNextControlDate(c);
    const daysOverdue = Math.ceil((today - nextDate) / (1000 * 60 * 60 * 24));
    return { ...c, daysOverdue };
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
                <span class="overdue-date">${formatDate(c.neste_kontroll)}</span>
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
      return items.map(c => `
        <div class="overdue-item" data-action="focusOnCustomer" data-customer-id="${c.id}">
          <div class="overdue-customer-info">
            <div class="overdue-customer-main">
              <h4>${escapeHtml(c.navn)}</h4>
              <span class="overdue-days-inline ${c.daysOverdue > 60 ? 'critical' : c.daysOverdue > 30 ? 'warning' : 'mild'}">${c.daysOverdue}d forfalt</span>
            </div>
            <p class="overdue-address">${escapeHtml(c.adresse)}, ${escapeHtml(c.poststed || '')}</p>
            ${c.telefon ? `<a href="tel:${c.telefon}" class="overdue-phone" onclick="event.stopPropagation();"><i class="fas fa-phone"></i> ${escapeHtml(c.telefon)}</a>` : ''}
          </div>
          <div class="overdue-status">
            <span class="overdue-date">${formatDate(c.neste_kontroll)}</span>
            <button class="btn-remind" data-action="sendReminder" data-customer-id="${c.id}" title="Send påminnelse">
              <i class="fas fa-envelope"></i>
            </button>
          </div>
        </div>
      `).join('');
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
            </div>
            ${renderGroupedItems(byArea[area])}
          </div>
        `;
      });
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
}

// Update overdue badge count
function updateOverdueBadge() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdueCount = customers.filter(c => {
    // Check all date fields for overdue
    const dates = [c.neste_el_kontroll, c.neste_brann_kontroll, c.neste_kontroll].filter(Boolean);
    if (dates.length === 0) return false;
    // Customer is overdue if ANY of their control dates are past due
    return dates.some(d => new Date(d) < today);
  }).length;

  updateBadge('overdueBadge', overdueCount);

  // Also update upcoming badge
  updateUpcomingBadge();
}

function updateUpcomingBadge() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const upcomingCount = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    return nextDate >= today && nextDate <= thirtyDaysFromNow;
  }).length;

  updateBadge('upcomingBadge', upcomingCount);
}

// Render warnings for upcoming controls
function renderWarnings() {
  const container = document.getElementById('warningsContainer');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  // Get customers needing control in next 30 days
  const warningCustomers = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    return nextDate >= today && nextDate <= thirtyDaysFromNow;
  }).map(c => ({
    ...c,
    _nextDate: getNextControlDate(c)
  }));

  // Group by kategori
  const byCategory = {};
  warningCustomers.forEach(c => {
    const cat = c.kategori || 'Annen';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(c);
  });

  // Sort alphabetically by name
  Object.values(byCategory).forEach(sortByNavn);

  // Render
  let html = '';

  if (warningCustomers.length === 0) {
    html = '<p style="padding: 20px; text-align: center; color: #666;">Ingen kommende kontroller</p>';
  } else {
    // Sort categories
    const categoryOrder = ['El-Kontroll', 'Brannvarsling'];
    const sortedCats = Object.keys(byCategory).sort((a, b) => {
      const indexA = categoryOrder.indexOf(a);
      const indexB = categoryOrder.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedCats.forEach(category => {
      html += `<div class="warning-section">
        <div class="warning-header">${escapeHtml(category)} (${byCategory[category].length})</div>
        ${byCategory[category].map(c => {
          const controlStatus = getControlStatus(c);
          const daysUntil = Math.ceil((c._nextDate - today) / (1000 * 60 * 60 * 24));
          const dateStr = c._nextDate.toISOString().split('T')[0];
          return `
            <div class="warning-item" data-action="focusOnCustomer" data-customer-id="${c.id}">
              <div class="warning-customer">
                <h4>${escapeHtml(c.navn)}</h4>
                <p>${escapeHtml(c.adresse)} (${escapeHtml(c.postnummer)})</p>
              </div>
              <div class="warning-date">
                <span class="control-status ${controlStatus.class}">${daysUntil} dager</span>
                <p style="font-size: 10px; color: #666; margin: 2px 0 0 0;">${escapeHtml(dateStr)}</p>
              </div>
            </div>
          `;
        }).join('')}
      </div>`;
    });
  }

  container.innerHTML = html;
}

// Load avtaler from API
async function loadAvtaler() {
  try {
    const response = await apiFetch('/api/avtaler');
    if (response.ok) {
      const avtaleResult = await response.json();
      avtaler = avtaleResult.data || avtaleResult;
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

  // Get routes for this month
  const monthRoutes = savedRoutes.filter(r => {
    if (!r.planlagt_dato) return false;
    const d = new Date(r.planlagt_dato);
    return d.getMonth() === currentCalendarMonth && d.getFullYear() === currentCalendarYear;
  });

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
      <button class="calendar-nav" id="prevMonth"><i class="fas fa-chevron-left"></i></button>
      <h3>${monthNames[currentCalendarMonth]} ${currentCalendarYear}</h3>
      <button class="calendar-nav" id="nextMonth"><i class="fas fa-chevron-right"></i></button>
      <button class="btn btn-primary calendar-add-btn" id="addAvtaleBtn">
        <i class="fas fa-plus"></i> Ny avtale
      </button>
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
    const dayRoutes = monthRoutes.filter(r => r.planlagt_dato === dateStr);
    const dayAvtaler = monthAvtaler.filter(a => a.dato === dateStr);
    const dayDate = new Date(currentCalendarYear, currentCalendarMonth, day);
    const isToday = dayDate.getTime() === today.getTime();
    const isPast = dayDate < today;
    const hasContent = dayRoutes.length > 0 || dayAvtaler.length > 0;

    html += `
      <div class="calendar-day ${isToday ? 'today' : ''} ${isPast ? 'past' : ''} ${hasContent ? 'has-content' : ''}"
           data-date="${dateStr}" data-action="openDayDetail">
        <span class="day-number">${day}</span>
        <div class="calendar-events">
          ${dayAvtaler.map(a => `
            <div class="calendar-avtale ${a.status === 'fullført' ? 'completed' : ''}"
                 data-avtale-id="${a.id}" data-action="editAvtale">
              ${a.er_gjentakelse || a.original_avtale_id ? '<i class="fas fa-sync-alt" style="font-size:0.6em;margin-right:2px" title="Gjentakende"></i>' : ''}
              ${a.klokkeslett ? `<span class="avtale-time">${a.klokkeslett.substring(0, 5)}</span>` : ''}
              <span class="avtale-kunde">${escapeHtml(a.kunder?.navn || a.kunde_navn || 'Ukjent')}</span>
            </div>
          `).join('')}
          ${dayRoutes.map(r => `
            <div class="calendar-route" data-route-id="${r.id}" data-action="loadSavedRoute">
              <i class="fas fa-route"></i> ${escapeHtml(r.navn)}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  html += '</div>';

  // Upcoming section
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
            <div class="upcoming-item" data-avtale-id="${a.id}" data-action="editAvtale">
              <div class="upcoming-date">
                <span class="upcoming-day">${new Date(a.dato).getDate()}</span>
                <span class="upcoming-month">${monthNames[new Date(a.dato).getMonth()].substring(0, 3)}</span>
              </div>
              <div class="upcoming-info">
                <strong>${a.er_gjentakelse || a.original_avtale_id ? '<i class="fas fa-sync-alt" style="font-size:0.7em;margin-right:3px" title="Gjentakende"></i>' : ''}${escapeHtml(a.kunder?.navn || a.kunde_navn || 'Ukjent')}</strong>
                <span>${a.klokkeslett ? a.klokkeslett.substring(0, 5) : ''} ${a.type || ''}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Cleanup old listeners first
  runTabCleanup('calendar');

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

  // Add event listeners
  prevBtn?.addEventListener('click', handlePrevMonth);
  nextBtn?.addEventListener('click', handleNextMonth);
  addBtn?.addEventListener('click', handleAddAvtale);

  // Store cleanup function
  tabCleanupFunctions.calendar = () => {
    prevBtn?.removeEventListener('click', handlePrevMonth);
    nextBtn?.removeEventListener('click', handleNextMonth);
    addBtn?.removeEventListener('click', handleAddAvtale);
  };
}

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
  gjentakelseSelect.addEventListener('change', function() {
    gjentakelseSluttGroup.classList.toggle('hidden', !this.value);
  });

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
    document.getElementById('avtaleType').value = avtale.type || 'El-Kontroll';
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
    opprettet_av: localStorage.getItem('klientEpost') || 'admin',
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
      closeAvtaleModal();
    }
  } catch (error) {
    console.error('Error deleting avtale series:', error);
    showMessage('Kunne ikke slette avtaleserien. Prøv igjen.', 'error');
  }
}

// Render planner - Smart Route Recommendations
function renderPlanner() {
  // Initialiser slider-lyttere og verdier
  initSmartRouteSettingsListeners();

  // Render anbefalinger
  renderSmartRecommendations();
}

// Create route for all customers in an area for a specific year
function createRouteForAreaYear(area, year) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get all customers in this area needing control in this year
  const areaCustomers = customers.filter(c => {
    if (!c.neste_kontroll) return false;
    const nextDate = new Date(c.neste_kontroll);
    return nextDate.getFullYear() === Number.parseInt(year) && (c.poststed === area);
  });

  if (areaCustomers.length === 0) {
    showMessage(`Ingen kunder i ${area} for ${year}`, 'info');
    return;
  }

  // Clear current selection and select all area customers
  selectedCustomers.clear();
  areaCustomers.forEach(c => {
    if (c.lat && c.lng) {
      selectedCustomers.add(c.id);
    }
  });

  updateSelectionUI();

  // Show the plan route dialog
  const ruteNavn = `${area} - ${year}`;
  document.getElementById('ruteNavn').value = ruteNavn;
  document.getElementById('ruteDato').value = `${year}-01-01`;
  document.getElementById('saveRouteModal').classList.remove('hidden');

  // Zoom to area
  const areaData = areaCustomers.filter(c => c.lat && c.lng);
  if (areaData.length > 0) {
    const bounds = L.latLngBounds(areaData.map(c => [c.lat, c.lng]));
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}


// Select all customers needing control
async function selectCustomersNeedingControl() {
  try {
    const response = await apiFetch('/api/kunder/kontroll-varsler?dager=30');
    const varselResult = await response.json();
    const varselKunder = varselResult.data || varselResult;

    selectedCustomers.clear();
    varselKunder.forEach(k => {
      if (k.lat && k.lng) {
        selectedCustomers.add(k.id);
      }
    });

    updateSelectionUI();

    if (selectedCustomers.size > 0) {
      // Zoom to selected customers
      const selectedData = customers.filter(c => selectedCustomers.has(c.id) && c.lat && c.lng);
      if (selectedData.length > 0) {
        const bounds = L.latLngBounds(selectedData.map(c => [c.lat, c.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  } catch (error) {
    console.error('Feil ved henting av varsler:', error);
  }
}

// Check login and show user bar - redirect if not logged in
function checkLoginStatus() {
  // Check if auth is disabled via config (development mode)
  // Handle both boolean false and string "false"
  const authDisabled = appConfig.requireAuth === false || appConfig.requireAuth === 'false';
  Logger.log('checkLoginStatus: requireAuth =', appConfig.requireAuth, '-> authDisabled =', authDisabled);
  if (authDisabled) {
    // Auth disabled - allow access without login
    Logger.log('Auth disabled - bypassing login');
    const userBar = document.getElementById('userBar');
    if (userBar) userBar.style.display = 'none';
    return true;
  }

  // Auth is now cookie-based - check stored user info
  const navn = localStorage.getItem('userName');
  const rolle = localStorage.getItem('userRole');
  const userBar = document.getElementById('userBar');
  const userNameDisplay = document.getElementById('userNameDisplay');

  // If no stored user info, redirect to login (cookie will be validated server-side)
  if (!navn) {
    window.location.href = '/login.html';
    return false;
  }

  // Multi-tenancy: Reload config with auth to get tenant-specific branding
  reloadConfigWithAuth();

  if (userBar) {
    userBar.style.display = 'flex';
    if (userNameDisplay) userNameDisplay.textContent = navn || 'Bruker';
  }

  // Hide email tab for non-admin users
  const emailTab = document.querySelector('.tab-item[data-tab="email"]');
  const isAdmin = rolle && rolle === 'admin';
  if (emailTab && !isAdmin) {
    emailTab.style.display = 'none';
  }

  return true;
}

// Logout function
function logoutUser(logoutAllDevices = false) {
  // Stop proactive token refresh
  stopTokenRefresh();

  // Send logout request (cookie-based auth, server clears cookie)
  const logoutHeaders = { 'Content-Type': 'application/json' };
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    logoutHeaders['X-CSRF-Token'] = csrfToken;
  }
  fetch('/api/klient/logout', {
    method: 'POST',
    headers: logoutHeaders,
    credentials: 'include',
    body: JSON.stringify({ logoutAll: logoutAllDevices })
  }).catch(() => {
    // Retry once after 1 second to ensure token is blacklisted
    setTimeout(() => {
      fetch('/api/klient/logout', {
        method: 'POST',
        headers: logoutHeaders,
        credentials: 'include',
        body: JSON.stringify({ logoutAll: logoutAllDevices })
      }).catch(err => console.error('Logout retry failed:', err));
    }, 1000);
  });

  // Clear UI-related localStorage (keep non-auth items)
  localStorage.removeItem('userName');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  localStorage.removeItem('isSuperAdmin');
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('impersonatingOrgName');
  // Multi-tenancy: Clear organization data
  localStorage.removeItem('organizationId');
  localStorage.removeItem('organizationSlug');
  localStorage.removeItem('organizationName');
  // Clear app mode and industry
  localStorage.removeItem('appMode');
  localStorage.removeItem('industrySlug');
  localStorage.removeItem('industryName');

  // Reset auth state
  authToken = null;

  window.location.href = '/login.html';
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
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
    loadRoutes();
    initWebSocket();

    // Show user bar with name
    showUserBar();

    // Setup event listeners
    setupEventListeners();
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
    loadOmrader(),
    loadRoutes()
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

  Logger.log('initializeApp() complete');
}

// Setup all event listeners
function setupEventListeners() {
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
    customerModal.classList.add('hidden');
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
  document.getElementById('closeRouteInfo')?.addEventListener('click', () => {
    routeInfo.classList.add('hidden');
    clearRoute();
    renderMarkers(customers);
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
          const response = await fetch(`/api/export/kunder?format=${format}`, {
            headers: { 'X-CSRF-Token': csrfToken }
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

  // Save route modal
  document.getElementById('saveRouteSubmit')?.addEventListener('click', saveRoute);
  document.getElementById('cancelSaveRoute')?.addEventListener('click', () => {
    document.getElementById('saveRouteModal').classList.add('hidden');
  });

  // Close modals on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      customerModal.classList.add('hidden');
      apiKeyModal.classList.add('hidden');
      document.getElementById('saveRouteModal')?.classList.add('hidden');
    }
  });

  // Close modal on X button click
  document.getElementById('closeCustomerModal')?.addEventListener('click', () => {
    customerModal.classList.add('hidden');
  });
  document.getElementById('closeApiKeyModal')?.addEventListener('click', () => {
    apiKeyModal.classList.add('hidden');
  });
  document.getElementById('closeSaveRouteModal')?.addEventListener('click', () => {
    document.getElementById('saveRouteModal').classList.add('hidden');
  });

  // Close modal on backdrop click
  customerModal.addEventListener('click', (e) => {
    if (e.target === customerModal) {
      customerModal.classList.add('hidden');
    }
  });
  apiKeyModal.addEventListener('click', (e) => {
    if (e.target === apiKeyModal) {
      apiKeyModal.classList.add('hidden');
    }
  });
  document.getElementById('saveRouteModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'saveRouteModal') {
      document.getElementById('saveRouteModal').classList.add('hidden');
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
    'avhuking': 'Avhuking',
    'routes': 'Ruter',
    'calendar': 'Kalender',
    'planner': 'Planlegger',
    'statistikk': 'Statistikk',
    'missingdata': 'Mangler data',
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

      // Remove active class from all tabs and panes
      tabItems.forEach(t => t.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      // Add active class to clicked tab and corresponding pane
      tab.classList.add('active');
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
        } else if (tabName === 'routes') {
          renderSavedRoutes();
        } else if (tabName === 'calendar') {
          renderCalendar();
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

  // Global event delegation for data-action buttons (CSP-compliant)
  document.addEventListener('click', (e) => {
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
      case 'loadSavedRoute':
        loadSavedRoute(Number.parseInt(actionEl.dataset.routeId));
        break;
      case 'completeRoute':
        completeRoute(Number.parseInt(actionEl.dataset.routeId));
        break;
      case 'startFieldWork':
        startFieldWork(Number.parseInt(actionEl.dataset.routeId));
        break;
      case 'markRouteVisited':
        markRouteVisited(Number.parseInt(actionEl.dataset.routeId));
        break;
      case 'deleteRoute':
        deleteRoute(Number.parseInt(actionEl.dataset.routeId));
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
        break;
      case 'editAvtale':
        e.stopPropagation();
        const avtaleId = Number.parseInt(actionEl.dataset.avtaleId);
        const avtale = avtaler.find(a => a.id === avtaleId);
        if (avtale) openAvtaleModal(avtale);
        break;
      case 'quickMarkVisited':
        e.stopPropagation();
        quickMarkVisited(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'toggleBulkSelect':
        e.stopPropagation();
        const bulkCustomerId = Number.parseInt(actionEl.dataset.customerId);
        toggleBulkSelectFromMap(bulkCustomerId);
        break;
      case 'focusAvhukingCustomer':
        e.stopPropagation();
        focusOnCustomer(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'removeFromAvhuking':
        e.stopPropagation();
        removeFromAvhuking(Number.parseInt(actionEl.dataset.customerId));
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

  // Avhuking tab button handlers
  document.getElementById('clearAvhukingBtn')?.addEventListener('click', clearBulkSelection);
  document.getElementById('completeAvhukingBtn')?.addEventListener('click', executeAvhuking);
}

// Open email client to contact customer about scheduling control
function sendManualReminder(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  if (!customer.epost) {
    showMessage(`${customer.navn} har ingen e-postadresse registrert.`, 'warning');
    return;
  }

  // Determine control type
  const kontrollType = customer.kategori || 'El-kontroll';

  // Build email subject and body
  const companySignature = appConfig.companyName || 'Sky Planner';
  const subject = encodeURIComponent(`${kontrollType} - Avtale tid for kontroll`);
  const body = encodeURIComponent(
    `Hei!\n\n` +
    `Vi ønsker å avtale tid for ${kontrollType.toLowerCase()} hos ${customer.navn}.\n\n` +
    `Adresse: ${customer.adresse || ''}, ${customer.postnummer || ''} ${customer.poststed || ''}\n\n` +
    `Vennligst gi beskjed om når det passer for deg.\n\n` +
    `Med vennlig hilsen\n` +
    `${companySignature}`
  );

  // Open mailto link
  window.location.href = `mailto:${customer.epost}?subject=${subject}&body=${body}`;
}

// === OVERDUE MAP FUNCTIONS ===

// Get all overdue customers
function getOverdueCustomers() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return customers.filter(c => {
    if (!c.neste_kontroll) return false;
    return new Date(c.neste_kontroll) < today;
  });
}

// Show all overdue customers on the map
function showOverdueOnMap() {
  const overdueCustomers = getOverdueCustomers();

  if (overdueCustomers.length === 0) {
    showMessage('Ingen forfalte kontroller å vise på kartet.', 'info');
    return;
  }

  // Clear current selection and add overdue customers
  selectedCustomers.clear();
  overdueCustomers.forEach(c => selectedCustomers.add(c.id));

  // Re-render markers to highlight overdue
  renderMarkers(customers);

  // Zoom to fit all overdue customers
  const bounds = L.latLngBounds(
    overdueCustomers
      .filter(c => c.lat && c.lng)
      .map(c => [c.lat, c.lng])
  );

  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }

  // Show notification
  const notification = document.createElement('div');
  notification.className = 'map-notification';
  notification.innerHTML = `<i class="fas fa-map-marker-alt"></i> Viser ${overdueCustomers.length} forfalte kunder på kartet`;
  document.querySelector('.map-container')?.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

// Show specific customers on map by IDs
function showCustomersOnMap(customerIds) {
  const customersToShow = customers.filter(c => customerIds.includes(c.id));

  if (customersToShow.length === 0) return;

  // Clear current selection and add these customers
  selectedCustomers.clear();
  customersToShow.forEach(c => selectedCustomers.add(c.id));

  // Re-render markers
  renderMarkers(customers);

  // Zoom to fit these customers
  const bounds = L.latLngBounds(
    customersToShow
      .filter(c => c.lat && c.lng)
      .map(c => [c.lat, c.lng])
  );

  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

// Create route from all overdue customers
async function createOverdueRoute() {
  const overdueCustomers = getOverdueCustomers();

  if (overdueCustomers.length === 0) {
    showMessage('Ingen forfalte kontroller å lage rute for.', 'info');
    return;
  }

  if (overdueCustomers.length > 25) {
    const proceed = await showConfirm(`Du har ${overdueCustomers.length} forfalte kontroller. OpenRouteService har en grense på 25 stopp per rute. Vil du velge de 25 mest kritiske?`, 'For mange kontroller');
    if (!proceed) return;

    // Sort by most overdue and take first 25
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    overdueCustomers.sort((a, b) => {
      const daysA = Math.ceil((today - new Date(a.neste_kontroll)) / (1000 * 60 * 60 * 24));
      const daysB = Math.ceil((today - new Date(b.neste_kontroll)) / (1000 * 60 * 60 * 24));
      return daysB - daysA;
    });
    overdueCustomers.length = 25;
  }

  createRouteFromCustomerIds(overdueCustomers.map(c => c.id));
}

// Create route from specific customer IDs
function createRouteFromCustomerIds(customerIds) {
  const customersForRoute = customers.filter(c => customerIds.includes(c.id) && c.lat && c.lng);

  if (customersForRoute.length === 0) {
    showMessage('Ingen kunder med gyldige koordinater.', 'warning');
    return;
  }

  if (customersForRoute.length > 25) {
    showMessage('Maks 25 stopp per rute. Velg færre kunder.', 'warning');
    return;
  }

  // Clear current selection and add these
  selectedCustomers.clear();
  customersForRoute.forEach(c => selectedCustomers.add(c.id));

  // Re-render markers
  renderMarkers(customers);

  // Switch to routes tab
  const routesTab = document.querySelector('[data-tab="routes"]');
  if (routesTab) {
    routesTab.click();
  }

  // Update route panel
  updateRouteSelection();

  // Show confirmation
  showMessage(`${customersForRoute.length} kunder lagt til for ruteplanlegging. Klikk "Beregn rute" for å lage kjørerute.`, 'success');
}

// === EMAIL FUNCTIONS ===

// Load all email data
async function loadEmailData() {
  await Promise.all([
    loadEmailStats(),
    loadEmailUpcoming(),
    loadEmailStatus(),
    loadEmailHistory()
  ]);
}

// Load email statistics
async function loadEmailStats() {
  try {
    const response = await apiFetch('/api/email/stats');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const stats = await response.json();

    document.getElementById('statPending').textContent = stats.pending || 0;
    document.getElementById('statSent').textContent = stats.sent || 0;
    document.getElementById('statFailed').textContent = stats.failed || 0;
  } catch (error) {
    console.error('Feil ved lasting av e-post-statistikk:', error);
  }
}

// Load upcoming notifications
async function loadEmailUpcoming() {
  try {
    const response = await apiFetch('/api/email/upcoming');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const upcoming = await response.json();

    const content = document.getElementById('emailUpcomingContent');
    const countBadge = document.getElementById('upcomingCount');
    if (!content) return;

    if (countBadge) countBadge.textContent = upcoming.length;

    if (upcoming.length === 0) {
      content.innerHTML = '<div class="upcoming-empty">Ingen kommende varsler de neste 30 dagene</div>';
      return;
    }

    content.innerHTML = upcoming.map(item => {
      const days = item.days_until;
      let daysClass = 'normal';
      let daysText = `${days} dager`;

      if (days <= 0) {
        daysClass = 'urgent';
        daysText = days === 0 ? 'I dag' : `${Math.abs(days)} dager siden`;
      } else if (days <= 10) {
        daysClass = 'urgent';
      } else if (days <= 30) {
        daysClass = 'soon';
      }

      const hasEmail = item.epost && item.epost.trim() !== '';
      return `
        <div class="upcoming-item" data-customer-id="${item.id}">
          <div class="upcoming-info">
            <span class="upcoming-name">${item.navn}</span>
            <span class="upcoming-email">${item.epost || 'Mangler e-post'}</span>
          </div>
          <div class="upcoming-actions">
            <button class="upcoming-email-btn ${hasEmail ? '' : 'disabled'}"
                    data-action="sendEmail"
                    data-customer-id="${item.id}"
                    title="${hasEmail ? 'Send e-post' : 'Ingen e-post registrert'}">
              <i class="fas fa-envelope"></i>
            </button>
            <span class="upcoming-days ${daysClass}">${daysText}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Feil ved lasting av kommende varsler:', error);
  }
}

// Load email status/config
async function loadEmailStatus() {
  try {
    const response = await apiFetch('/api/email/status');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();

    const content = document.getElementById('emailStatusContent');
    if (!content) return;

    content.innerHTML = `
      <div class="config-item">
        <span class="config-label">E-postvarsling</span>
        <span class="config-value ${status.enabled ? 'enabled' : 'disabled'}">
          ${status.enabled ? 'Aktivert' : 'Deaktivert'}
        </span>
      </div>
      <div class="config-item">
        <span class="config-label">E-post server</span>
        <span class="config-value ${status.emailConfigured ? 'enabled' : 'disabled'}">
          ${status.emailConfigured ? 'Konfigurert' : 'Ikke konfigurert'}
        </span>
      </div>
      <div class="config-item">
        <span class="config-label">Første varsel</span>
        <span class="config-value">${status.firstReminderDays} dager før</span>
      </div>
      <div class="config-item">
        <span class="config-label">Påminnelse</span>
        <span class="config-value">${status.reminderAfterDays} dager etter første</span>
      </div>
    `;
  } catch (error) {
    console.error('Feil ved lasting av e-post-status:', error);
  }
}

// Load email history with optional filter
async function loadEmailHistory(filter = 'all') {
  try {
    const response = await apiFetch('/api/email/historikk?limit=50');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let history = await response.json();

    // Apply filter
    if (filter !== 'all') {
      history = history.filter(item => item.status === filter);
    }

    const content = document.getElementById('emailHistoryContent');
    if (!content) return;

    if (history.length === 0) {
      content.innerHTML = '<div class="email-history-empty">Ingen varsler å vise</div>';
      return;
    }

    content.innerHTML = history.map(item => {
      const statusText = {
        'sent': 'Sendt',
        'failed': 'Feilet',
        'pending': 'Venter'
      }[item.status] || item.status;

      return `
        <div class="email-history-item">
          <div class="history-header">
            <span class="history-customer">${escapeHtml(item.kunde_navn || 'Test')}</span>
            <span class="history-status ${escapeHtml(item.status)}">${escapeHtml(statusText)}</span>
          </div>
          <div class="history-subject">${escapeHtml(item.emne || '')}</div>
          <div class="history-message">${escapeHtml(item.melding.substring(0, 80))}${item.melding.length > 80 ? '...' : ''}</div>
          <div class="history-date">${new Date(item.opprettet).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })}</div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Feil ved lasting av e-post-historikk:', error);
  }
}

// Send test email
async function sendTestEmail() {
  const epost = document.getElementById('testEmailAddress')?.value;
  const melding = document.getElementById('testEmailMessage')?.value;

  if (!epost) {
    showMessage('Skriv inn en e-postadresse', 'warning');
    return;
  }

  const btn = document.getElementById('sendTestEmailBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sender...';
  }

  try {
    const response = await apiFetch('/api/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epost, melding })
    });

    const result = await response.json();

    if (result.success) {
      showMessage('Test e-post sendt!', 'success');
      loadEmailHistory();
    } else {
      showMessage('Feil ved sending: ' + (result.error || 'Ukjent feil'), 'error');
    }
  } catch (error) {
    console.error('Feil ved sending av test e-post:', error);
    showMessage('Kunne ikke sende e-post. Prøv igjen.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Test';
    }
  }
}

// Trigger email check manually
async function triggerEmailCheck() {
  const btn = document.getElementById('triggerEmailCheckBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sender...';
  }

  try {
    const response = await apiFetch('/api/email/send-varsler', { method: 'POST' });
    const result = await response.json();

    showMessage(`Varselsjekk fullført! Sendt: ${result.sent}, Hoppet over: ${result.skipped}, Feil: ${result.errors}`, 'success', 'Varsler sendt');
    // Refresh all email data
    loadEmailData();
  } catch (error) {
    console.error('Feil ved varselsjekk:', error);
    showMessage('Kunne ikke kjøre varselsjekk', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i><span>Send varsler nå</span>';
    }
  }
}

// Load email settings for a customer
async function loadCustomerEmailSettings(kundeId) {
  try {
    const response = await apiFetch(`/api/email/innstillinger/${kundeId}`);
    const settings = await response.json();

    const emailAktiv = document.getElementById('emailAktiv');
    const forsteVarsel = document.getElementById('forsteVarsel');
    const paaminnelseEtter = document.getElementById('paaminnelseEtter');
    const emailOptions = document.getElementById('emailOptions');

    if (emailAktiv) emailAktiv.checked = settings.email_aktiv === 1;
    if (forsteVarsel) forsteVarsel.value = settings.forste_varsel_dager;
    if (paaminnelseEtter) paaminnelseEtter.value = settings.paaminnelse_etter_dager;

    // Toggle options visibility
    if (emailOptions) {
      emailOptions.classList.toggle('hidden', !emailAktiv?.checked);
    }
  } catch (error) {
    console.error('Feil ved lasting av e-post-innstillinger:', error);
  }
}

// Save email settings for a customer
async function saveCustomerEmailSettings(kundeId) {
  const emailAktiv = document.getElementById('emailAktiv')?.checked;
  const forsteVarsel = document.getElementById('forsteVarsel')?.value;
  const paaminnelseEtter = document.getElementById('paaminnelseEtter')?.value;

  try {
    await apiFetch(`/api/email/innstillinger/${kundeId}`, {
      method: 'PUT',
      body: JSON.stringify({
        email_aktiv: emailAktiv,
        forste_varsel_dager: Number.parseInt(forsteVarsel) || 30,
        paaminnelse_etter_dager: Number.parseInt(paaminnelseEtter) || 7
      })
    });
  } catch (error) {
    console.error('Feil ved lagring av e-post-innstillinger:', error);
  }
}

// ==================== KONTAKTLOGG ====================

let currentKontaktloggKundeId = null;

// ========================================
// KUNDE TAGS
// ========================================

let allTags = [];

async function loadAllTags() {
  try {
    const response = await apiFetch('/api/tags');
    if (response.ok) {
      const result = await response.json();
      allTags = result.data || [];
    }
  } catch (error) {
    console.error('Error loading tags:', error);
  }
}

async function loadKundeTags(kundeId) {
  const listEl = document.getElementById('kundeTagsList');
  const selectEl = document.getElementById('kundeTagSelect');
  document.getElementById('kundeTagsSection').style.display = 'block';

  // Load all tags if not loaded
  if (allTags.length === 0) await loadAllTags();

  try {
    const response = await apiFetch(`/api/tags/kunder/${kundeId}/tags`);
    if (!response.ok) return;
    const result = await response.json();
    const kundeTags = result.data || [];

    // Render assigned tags
    listEl.innerHTML = kundeTags.length === 0
      ? '<span class="tags-empty">Ingen tags</span>'
      : kundeTags.map(tag => `
          <span class="tag-badge" style="background:${escapeHtml(tag.farge)}20;color:${escapeHtml(tag.farge)};border:1px solid ${escapeHtml(tag.farge)}40">
            ${escapeHtml(tag.navn)}
            <button class="tag-remove" data-action="removeKundeTag" data-kunde-id="${kundeId}" data-tag-id="${tag.id}" title="Fjern">&times;</button>
          </span>
        `).join('');

    // Populate select with unassigned tags
    const assignedIds = new Set(kundeTags.map(t => t.id));
    const available = allTags.filter(t => !assignedIds.has(t.id));
    selectEl.innerHTML = '<option value="">Velg tag...</option>' +
      available.map(t => `<option value="${t.id}">${escapeHtml(t.navn)}</option>`).join('');
  } catch (error) {
    console.error('Error loading kunde tags:', error);
  }
}

async function addTagToKunde(kundeId, tagId) {
  try {
    const response = await apiFetch(`/api/tags/kunder/${kundeId}/tags/${tagId}`, { method: 'POST' });
    if (response.ok) {
      await loadKundeTags(kundeId);
    }
  } catch (error) {
    console.error('Error adding tag:', error);
  }
}

async function removeTagFromKunde(kundeId, tagId) {
  try {
    const response = await apiFetch(`/api/tags/kunder/${kundeId}/tags/${tagId}`, { method: 'DELETE' });
    if (response.ok) {
      await loadKundeTags(kundeId);
    }
  } catch (error) {
    console.error('Error removing tag:', error);
  }
}

function openTagManager() {
  const existingModal = document.getElementById('tagManagerModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'tagManagerModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:400px">
      <div class="modal-header">
        <h2>Administrer tags</h2>
        <button class="modal-close" id="closeTagManager">&times;</button>
      </div>
      <div class="tag-manager-list" id="tagManagerList"></div>
      <div class="tag-manager-add">
        <input type="text" id="newTagName" placeholder="Ny tag..." maxlength="50">
        <select id="newTagColor">
          <option value="#3b82f6" style="color:#3b82f6">Blå</option>
          <option value="#ef4444" style="color:#ef4444">Rød</option>
          <option value="#22c55e" style="color:#22c55e">Grønn</option>
          <option value="#f59e0b" style="color:#f59e0b">Gul</option>
          <option value="#8b5cf6" style="color:#8b5cf6">Lilla</option>
          <option value="#ec4899" style="color:#ec4899">Rosa</option>
          <option value="#06b6d4" style="color:#06b6d4">Turkis</option>
          <option value="#64748b" style="color:#64748b">Grå</option>
        </select>
        <button class="btn btn-primary btn-small" id="createTagBtn">Opprett</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  renderTagManagerList();

  document.getElementById('closeTagManager').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.getElementById('createTagBtn').addEventListener('click', createNewTag);
  document.getElementById('newTagName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createNewTag(); }
  });
}

function renderTagManagerList() {
  const listEl = document.getElementById('tagManagerList');
  if (!listEl) return;
  listEl.innerHTML = allTags.length === 0
    ? '<p style="padding:8px;color:var(--color-text-muted)">Ingen tags opprettet</p>'
    : allTags.map(tag => `
        <div class="tag-manager-item">
          <span class="tag-badge" style="background:${escapeHtml(tag.farge)}20;color:${escapeHtml(tag.farge)};border:1px solid ${escapeHtml(tag.farge)}40">
            ${escapeHtml(tag.navn)}
          </span>
          <button class="btn btn-small btn-danger tag-delete-btn" data-tag-id="${tag.id}">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `).join('');

  // Attach delete handlers
  listEl.querySelectorAll('.tag-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tagId = btn.dataset.tagId;
      const response = await apiFetch(`/api/tags/${tagId}`, { method: 'DELETE' });
      if (response.ok) {
        await loadAllTags();
        renderTagManagerList();
        // Reload current customer tags if open
        const kundeId = document.getElementById('customerId')?.value;
        if (kundeId) loadKundeTags(Number.parseInt(kundeId));
      }
    });
  });
}

async function createNewTag() {
  const nameInput = document.getElementById('newTagName');
  const colorSelect = document.getElementById('newTagColor');
  const navn = nameInput.value.trim();
  if (!navn) return;

  try {
    const response = await apiFetch('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ navn, farge: colorSelect.value }),
    });
    if (response.ok) {
      nameInput.value = '';
      await loadAllTags();
      renderTagManagerList();
    } else {
      const err = await response.json();
      showMessage(err.error || 'Kunne ikke opprette tag', 'error');
    }
  } catch (error) {
    console.error('Error creating tag:', error);
  }
}

async function loadKontaktlogg(kundeId) {
  currentKontaktloggKundeId = kundeId;
  const listEl = document.getElementById('kontaktloggList');

  try {
    const response = await apiFetch(`/api/kunder/${kundeId}/kontaktlogg`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const logg = await response.json();

    if (logg.length === 0) {
      listEl.innerHTML = '<div class="kontaktlogg-empty">Ingen registrerte kontakter</div>';
      return;
    }

    listEl.innerHTML = logg.map(k => {
      const dato = new Date(k.dato);
      const datoStr = dato.toLocaleDateString('nb-NO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <div class="kontaktlogg-item" data-id="${k.id}">
          <div class="kontaktlogg-info">
            <div class="kontaktlogg-header">
              <span class="kontaktlogg-type">${escapeHtml(k.type)}</span>
              <span class="kontaktlogg-date">${datoStr}</span>
            </div>
            ${k.notat ? `<div class="kontaktlogg-notat">${escapeHtml(k.notat)}</div>` : ''}
          </div>
          <button type="button" class="kontaktlogg-delete" data-action="deleteKontakt" data-id="${k.id}" title="Slett">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Feil ved lasting av kontaktlogg:', error);
    listEl.innerHTML = '<div class="kontaktlogg-empty">Feil ved lasting</div>';
  }
}

async function addKontaktlogg() {
  if (!currentKontaktloggKundeId) return;

  const typeEl = document.getElementById('kontaktType');
  const notatEl = document.getElementById('kontaktNotat');

  const type = typeEl.value;
  const notat = notatEl.value.trim();

  if (!notat) {
    showMessage('Vennligst skriv et notat', 'warning');
    notatEl.focus();
    return;
  }

  try {
    await apiFetch(`/api/kunder/${currentKontaktloggKundeId}/kontaktlogg`, {
      method: 'POST',
      body: JSON.stringify({
        type,
        notat,
        opprettet_av: localStorage.getItem('userName') || 'Ukjent'
      })
    });

    // Clear input and reload
    notatEl.value = '';
    await loadKontaktlogg(currentKontaktloggKundeId);
  } catch (error) {
    console.error('Feil ved lagring av kontakt:', error);
    showMessage('Feil ved lagring av kontakt', 'error');
  }
}

async function deleteKontaktlogg(id) {
  const confirmed = await showConfirm('Slette denne kontaktregistreringen?', 'Slette kontakt');
  if (!confirmed) return;

  try {
    await apiFetch(`/api/kontaktlogg/${id}`, { method: 'DELETE' });
    await loadKontaktlogg(currentKontaktloggKundeId);
  } catch (error) {
    console.error('Feil ved sletting av kontakt:', error);
  }
}

// === KONTAKTPERSONER FUNCTIONS ===

let currentKontaktpersonerKundeId = null;

async function loadKontaktpersoner(kundeId) {
  currentKontaktpersonerKundeId = kundeId;
  const listEl = document.getElementById('kontaktpersonerList');
  document.getElementById('kontaktpersonerSection').style.display = 'block';

  try {
    const response = await apiFetch(`/api/kunder/${kundeId}/kontaktpersoner`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    const personer = result.data || [];

    if (personer.length === 0) {
      listEl.innerHTML = '<div class="kontaktpersoner-empty">Ingen registrerte kontaktpersoner</div>';
      return;
    }

    const rolleLabels = { teknisk: 'Teknisk', faktura: 'Faktura', daglig: 'Daglig leder', annet: 'Annet' };

    listEl.innerHTML = personer.map(p => {
      const rolleBadge = p.rolle
        ? `<span class="kontaktperson-rolle">${escapeHtml(rolleLabels[p.rolle] || p.rolle)}</span>`
        : '';
      const primaerBadge = p.er_primaer
        ? '<span class="kontaktperson-primaer-badge"><i class="fas fa-star"></i> Primær</span>'
        : '';

      return `
        <div class="kontaktperson-item" data-id="${p.id}">
          <div class="kontaktperson-info">
            <div class="kontaktperson-header">
              <span class="kontaktperson-navn">${escapeHtml(p.navn)}</span>
              ${rolleBadge}
              ${primaerBadge}
            </div>
            <div class="kontaktperson-details">
              ${p.telefon ? `<span class="kontaktperson-detail"><i class="fas fa-phone"></i> ${escapeHtml(p.telefon)}</span>` : ''}
              ${p.epost ? `<span class="kontaktperson-detail"><i class="fas fa-envelope"></i> ${escapeHtml(p.epost)}</span>` : ''}
            </div>
          </div>
          <button type="button" class="kontaktperson-delete" data-action="deleteKontaktperson" data-id="${p.id}" title="Slett">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Feil ved lasting av kontaktpersoner:', error);
    listEl.innerHTML = '<div class="kontaktpersoner-empty">Feil ved lasting</div>';
  }
}

async function addKontaktperson() {
  if (!currentKontaktpersonerKundeId) return;

  const navnEl = document.getElementById('kontaktpersonNavn');
  const rolleEl = document.getElementById('kontaktpersonRolle');
  const telefonEl = document.getElementById('kontaktpersonTelefon');
  const epostEl = document.getElementById('kontaktpersonEpost');
  const primaerEl = document.getElementById('kontaktpersonPrimaer');

  const navn = navnEl.value.trim();
  if (!navn) {
    showMessage('Vennligst fyll inn navn', 'warning');
    navnEl.focus();
    return;
  }

  try {
    await apiFetch(`/api/kunder/${currentKontaktpersonerKundeId}/kontaktpersoner`, {
      method: 'POST',
      body: JSON.stringify({
        navn,
        rolle: rolleEl.value || undefined,
        telefon: telefonEl.value.trim() || undefined,
        epost: epostEl.value.trim() || undefined,
        er_primaer: primaerEl.checked
      })
    });

    navnEl.value = '';
    rolleEl.value = '';
    telefonEl.value = '';
    epostEl.value = '';
    primaerEl.checked = false;
    await loadKontaktpersoner(currentKontaktpersonerKundeId);
  } catch (error) {
    console.error('Feil ved lagring av kontaktperson:', error);
    showMessage('Feil ved lagring av kontaktperson', 'error');
  }
}

async function deleteKontaktperson(id) {
  const confirmed = await showConfirm('Slette denne kontaktpersonen?', 'Slette kontaktperson');
  if (!confirmed) return;

  try {
    await apiFetch(`/api/kontaktpersoner/${id}`, { method: 'DELETE' });
    await loadKontaktpersoner(currentKontaktpersonerKundeId);
  } catch (error) {
    console.error('Feil ved sletting av kontaktperson:', error);
  }
}

// === MISSING DATA FUNCTIONS ===

function renderMissingData() {
  // Filter customers by missing data
  const missingPhone = customers.filter(c => !c.telefon || c.telefon.trim() === '');
  const missingEmail = customers.filter(c => !c.epost || c.epost.trim() === '');
  const missingCoords = customers.filter(c => c.lat === null || c.lng === null);
  const missingControl = customers.filter(c => !c.neste_kontroll && !c.neste_el_kontroll && !c.neste_brann_kontroll);

  // Update counts
  document.getElementById('missingPhoneCount').textContent = missingPhone.length;
  document.getElementById('missingEmailCount').textContent = missingEmail.length;
  document.getElementById('missingCoordsCount').textContent = missingCoords.length;
  document.getElementById('missingControlCount').textContent = missingControl.length;

  // Update badge
  const totalMissing = missingPhone.length + missingEmail.length + missingCoords.length + missingControl.length;
  updateBadge('missingDataBadge', totalMissing);

  // Render lists
  renderMissingList('missingPhoneList', missingPhone, 'telefon');
  renderMissingList('missingEmailList', missingEmail, 'e-post');
  renderMissingList('missingCoordsList', missingCoords, 'koordinater');
  renderMissingList('missingControlList', missingControl, 'neste kontroll');
}

function renderMissingList(containerId, customersList, missingType) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (customersList.length === 0) {
    container.innerHTML = `<div class="missing-empty">Ingen kunder mangler ${escapeHtml(missingType)}</div>`;
    return;
  }

  container.innerHTML = customersList.map(c => `
    <div class="missing-item" data-action="editCustomer" data-customer-id="${c.id}">
      <div class="missing-item-name">${escapeHtml(c.navn)}</div>
      <div class="missing-item-address">${escapeHtml(c.adresse || '')}${c.poststed ? ', ' + escapeHtml(c.poststed) : ''}</div>
    </div>
  `).join('');
}

// Handle toggle for missing data sections
document.addEventListener('click', function(e) {
  const header = e.target.closest('.missing-header');
  if (header) {
    const toggleId = header.dataset.toggle;
    // Convert 'missing-phone' to 'missingPhoneList'
    const listId = 'missing' + toggleId.replace('missing-', '').charAt(0).toUpperCase() + toggleId.replace('missing-', '').slice(1) + 'List';
    const list = document.getElementById(listId);
    if (list) {
      list.classList.toggle('collapsed');
      header.querySelector('.toggle-icon').classList.toggle('rotated');
    }
  }
});

// === STATISTIKK FUNCTIONS ===

function renderStatistikk() {
  // Calculate status counts
  let forfalte = 0;
  let snart = 0;
  let ok = 0;

  customers.forEach(c => {
    const status = getControlStatus(c);
    if (status.status === 'forfalt') forfalte++;
    else if (status.status === 'snart') snart++;
    else if (status.status === 'ok' || status.status === 'god') ok++;
  });

  // Update overview cards
  document.getElementById('statTotalKunder').textContent = customers.length;
  document.getElementById('statForfalte').textContent = forfalte;
  document.getElementById('statSnart').textContent = snart;
  document.getElementById('statOk').textContent = ok;

  // Render season chart (kontroller per måned)
  renderSeasonChart();

  // Render category stats
  renderCategoryStats();

  // Render area stats
  renderAreaStats();

  // Render el-type stats
  renderEltypeStats();

  // Render brann-system stats
  renderBrannsystemStats();
}

// ========================================
// ADMIN TAB FUNCTIONS
// ========================================

let loginLogOffset = 0;
const LOGIN_LOG_LIMIT = 20;

async function loadAdminData() {
  // Initialize team members UI
  initTeamMembersUI();
  // Initialize fields management UI
  initFieldsManagementUI();

  // Load team members
  await loadTeamMembers();
  // Load login stats
  await loadLoginStats();
  // Load login log
  loginLogOffset = 0;
  await loadLoginLog(false);

  // Render admin fields and categories
  renderAdminFields();
  renderAdminCategories();

  // Check and load super admin data if applicable
  await checkSuperAdminStatus();

  // Setup load more button
  document.getElementById('loadMoreLogins')?.addEventListener('click', () => loadLoginLog(true));
}

async function loadTeamMembers() {
  try {
    const response = await fetch('/api/team-members', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load team members');
      return;
    }

    const result = await response.json();
    const list = document.getElementById('teamMembersList');
    const emptyState = document.getElementById('teamMembersEmpty');
    const quotaBadge = document.getElementById('teamQuotaBadge');

    if (!list) return;

    // Update quota badge
    if (quotaBadge && result.data?.limits) {
      const { current_count, max_brukere } = result.data.limits;
      quotaBadge.textContent = `${current_count} / ${max_brukere}`;
      quotaBadge.classList.remove('near-limit', 'at-limit');
      if (current_count >= max_brukere) {
        quotaBadge.classList.add('at-limit');
      } else if (current_count >= max_brukere - 1) {
        quotaBadge.classList.add('near-limit');
      }
    }

    list.innerHTML = '';

    const members = result.data?.members || [];
    // Store for event delegation lookup
    teamMembersData = members;

    if (members.length > 0) {
      if (emptyState) emptyState.style.display = 'none';
      list.style.display = 'flex';

      // Use innerHTML with data-action attributes for event delegation
      list.innerHTML = members.map(member => {
        const initials = getInitials(member.navn);
        const lastLogin = member.sist_innlogget
          ? formatRelativeTime(member.sist_innlogget)
          : 'Aldri innlogget';

        return `
          <div class="team-member-item" data-action="editTeamMember" data-member-id="${member.id}">
            <div class="team-member-status ${member.aktiv ? '' : 'inactive'}"></div>
            <div class="team-member-avatar">${initials}</div>
            <div class="team-member-info">
              <div class="team-member-name">${escapeHtml(member.navn)}</div>
              <div class="team-member-email">${escapeHtml(member.epost)}</div>
              <div class="team-member-meta">
                <span class="team-member-role">${escapeHtml(member.rolle || 'medlem')}</span>
                <span class="team-member-last-login">Sist: ${lastLogin}</span>
              </div>
            </div>
            <div class="team-member-actions">
              <button class="btn-icon" data-action="editTeamMember" data-member-id="${member.id}" title="Rediger"><i class="fas fa-pen"></i></button>
              <button class="btn-icon delete" data-action="deleteTeamMember" data-member-id="${member.id}" title="Slett"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      list.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
    }
  } catch (error) {
    console.error('Error loading team members:', error);
  }
}

function openTeamMemberModal(member = null) {
  const modal = document.getElementById('teamMemberModal');
  const title = document.getElementById('teamMemberModalTitle');
  const form = document.getElementById('teamMemberForm');
  const deleteBtn = document.getElementById('deleteTeamMemberBtn');
  const passwordInput = document.getElementById('memberPassord');

  if (!modal || !form) return;

  // Reset form
  form.reset();
  document.getElementById('teamMemberId').value = '';

  if (member) {
    // Edit mode
    title.textContent = 'Rediger teammedlem';
    document.getElementById('teamMemberId').value = member.id;
    document.getElementById('memberNavn').value = member.navn || '';
    document.getElementById('memberEpost').value = member.epost || '';
    document.getElementById('memberTelefon').value = member.telefon || '';
    document.getElementById('memberRolle').value = member.rolle || 'medlem';
    passwordInput.required = false;
    passwordInput.placeholder = 'La stå tom for å beholde';
    deleteBtn.style.display = 'inline-flex';
  } else {
    // Create mode
    title.textContent = 'Nytt teammedlem';
    passwordInput.required = true;
    passwordInput.placeholder = 'Minst 8 tegn';
    deleteBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');
}

function closeTeamMemberModal() {
  const modal = document.getElementById('teamMemberModal');
  if (modal) modal.classList.add('hidden');
}

async function saveTeamMember(e) {
  e.preventDefault();

  const memberId = document.getElementById('teamMemberId').value;
  const isEdit = !!memberId;

  const data = {
    navn: document.getElementById('memberNavn').value.trim(),
    epost: document.getElementById('memberEpost').value.trim(),
    telefon: document.getElementById('memberTelefon').value.trim() || null,
    rolle: document.getElementById('memberRolle').value
  };

  const password = document.getElementById('memberPassord').value;
  if (password) {
    data.passord = password;
  } else if (!isEdit) {
    showToast('Passord er påkrevd', 'error');
    return;
  }

  try {
    const url = isEdit ? `/api/team-members/${memberId}` : '/api/team-members';
    const method = isEdit ? 'PUT' : 'POST';

    const teamMemberHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      teamMemberHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(url, {
      method,
      headers: teamMemberHeaders,
      credentials: 'include',
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
      showToast(result.error?.message || 'Kunne ikke lagre bruker', 'error');
      return;
    }

    showToast(isEdit ? 'Bruker oppdatert' : 'Bruker opprettet', 'success');
    closeTeamMemberModal();
    await loadTeamMembers();
  } catch (error) {
    console.error('Error saving team member:', error);
    showToast('En feil oppstod', 'error');
  }
}

async function deleteTeamMember(member) {
  const confirmed = await showConfirm(`Er du sikker på at du vil slette ${member.navn}?`, 'Slette teammedlem');
  if (!confirmed) return;

  try {
    const deleteHeaders = {};
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      deleteHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(`/api/team-members/${member.id}`, {
      method: 'DELETE',
      headers: deleteHeaders,
      credentials: 'include'
    });

    if (!response.ok) {
      const result = await response.json();
      showToast(result.error?.message || 'Kunne ikke slette bruker', 'error');
      return;
    }

    showToast('Bruker slettet', 'success');
    closeTeamMemberModal();
    await loadTeamMembers();
  } catch (error) {
    console.error('Error deleting team member:', error);
    showToast('En feil oppstod', 'error');
  }
}

function initTeamMembersUI() {
  // Add member buttons
  document.getElementById('addTeamMemberBtn')?.addEventListener('click', () => openTeamMemberModal());
  document.getElementById('addFirstMemberBtn')?.addEventListener('click', () => openTeamMemberModal());

  // Modal close buttons
  document.getElementById('closeTeamMemberModal')?.addEventListener('click', closeTeamMemberModal);
  document.getElementById('cancelTeamMember')?.addEventListener('click', closeTeamMemberModal);

  // Form submit
  document.getElementById('teamMemberForm')?.addEventListener('submit', saveTeamMember);

  // Delete button in modal
  document.getElementById('deleteTeamMemberBtn')?.addEventListener('click', () => {
    const memberId = document.getElementById('teamMemberId').value;
    if (memberId) {
      const memberName = document.getElementById('memberNavn').value;
      deleteTeamMember({ id: memberId, navn: memberName });
    }
  });
}

/**
 * Initialize field and category management UI
 */
function initFieldsManagementUI() {
  // Field buttons
  document.getElementById('addFieldBtn')?.addEventListener('click', () => openFieldModal());
  document.getElementById('addFirstFieldBtn')?.addEventListener('click', () => openFieldModal());

  // Field modal
  document.getElementById('closeFieldModal')?.addEventListener('click', () => {
    document.getElementById('fieldModal').classList.add('hidden');
  });
  document.getElementById('cancelField')?.addEventListener('click', () => {
    document.getElementById('fieldModal').classList.add('hidden');
  });
  document.getElementById('fieldForm')?.addEventListener('submit', saveField);
  document.getElementById('deleteFieldBtn')?.addEventListener('click', () => {
    const fieldId = document.getElementById('fieldId').value;
    if (fieldId) confirmDeleteField(parseInt(fieldId));
  });

  // Field type change - show/hide options section
  document.getElementById('fieldType')?.addEventListener('change', (e) => {
    const optionsSection = document.getElementById('fieldOptionsSection');
    if (optionsSection) {
      optionsSection.style.display = e.target.value === 'select' ? 'block' : 'none';
    }
  });

  // Add field option button
  document.getElementById('addFieldOptionBtn')?.addEventListener('click', addFieldOption);

  // Auto-generate field_name from display_name
  document.getElementById('fieldDisplayName')?.addEventListener('input', (e) => {
    const fieldNameInput = document.getElementById('fieldName');
    if (fieldNameInput && !fieldNameInput.disabled) {
      fieldNameInput.value = e.target.value.toLowerCase()
        .replace(/[æ]/g, 'ae')
        .replace(/[ø]/g, 'o')
        .replace(/[å]/g, 'a')
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    }
  });

  // Category buttons
  document.getElementById('addCategoryBtn')?.addEventListener('click', () => openCategoryModal());
  document.getElementById('addFirstCategoryBtn')?.addEventListener('click', () => openCategoryModal());
  document.getElementById('manageCategoriesBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCategoryModal();
  });

  // Category modal
  document.getElementById('closeCategoryModal')?.addEventListener('click', () => {
    document.getElementById('categoryModal').classList.add('hidden');
  });
  document.getElementById('cancelCategory')?.addEventListener('click', () => {
    document.getElementById('categoryModal').classList.add('hidden');
  });
  document.getElementById('categoryForm')?.addEventListener('submit', saveCategory);
  document.getElementById('deleteCategoryBtn')?.addEventListener('click', () => {
    const categoryId = document.getElementById('categoryId').value;
    if (categoryId) confirmDeleteCategory(parseInt(categoryId));
  });

  // Auto-generate slug from name (only for new categories)
  document.getElementById('categoryName')?.addEventListener('input', (e) => {
    const slugInput = document.getElementById('categorySlug');
    const idInput = document.getElementById('categoryId');
    // Only auto-generate slug for new categories (no id yet)
    if (slugInput && !idInput?.value) {
      slugInput.value = e.target.value.toLowerCase()
        .replace(/[æ]/g, 'ae')
        .replace(/[ø]/g, 'o')
        .replace(/[å]/g, 'a')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
  });

  // Icon picker grid click handler
  document.getElementById('categoryIconPicker')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-btn');
    if (!btn) return;
    document.querySelectorAll('#categoryIconPicker .icon-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('categoryIcon').value = btn.dataset.icon;
  });

  // Color preview update
  document.getElementById('categoryColor')?.addEventListener('input', (e) => {
    updateCategoryColorPreview(e.target.value);
  });
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Ukjent';

  let date = dateString;
  if (!date.endsWith('Z') && !date.includes('+')) {
    date = date.replace(' ', 'T') + 'Z';
  }

  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Nå';
  if (diffMins < 60) return `${diffMins} min siden`;
  if (diffHours < 24) return `${diffHours} t siden`;
  if (diffDays < 7) return `${diffDays} d siden`;

  return then.toLocaleDateString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

async function loadLoginStats() {
  try {
    const response = await fetch('/api/login-logg/stats', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load login stats');
      return;
    }

    const stats = await response.json();

    document.getElementById('statTotalLogins').textContent = stats.total || 0;
    document.getElementById('statSuccessLogins').textContent = stats.vellykket || 0;
    document.getElementById('statFailedLogins').textContent = stats.feilet || 0;
    document.getElementById('statLast24h').textContent = stats.siste24t || 0;
  } catch (error) {
    console.error('Error loading login stats:', error);
  }
}

async function loadLoginLog(append = false) {
  try {
    if (!append) {
      loginLogOffset = 0;
    }

    const response = await fetch(`/api/login-logg?limit=${LOGIN_LOG_LIMIT}&offset=${loginLogOffset}`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load login log');
      return;
    }

    const data = await response.json();
    const tbody = document.getElementById('loginLogBody');

    if (!append) {
      tbody.innerHTML = '';
    }

    if (data.logg && data.logg.length > 0) {
      data.logg.forEach(entry => {
        const row = document.createElement('tr');
        // SQLite stores UTC, add 'Z' suffix if missing to parse as UTC
        let tidspunkt = entry.tidspunkt;
        if (tidspunkt && !tidspunkt.endsWith('Z') && !tidspunkt.includes('+')) {
          tidspunkt = tidspunkt.replace(' ', 'T') + 'Z';
        }
        const tid = new Date(tidspunkt).toLocaleString('nb-NO', {
          timeZone: 'Europe/Oslo',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const statusClass = entry.status === 'vellykket' ? 'success' : 'failed';
        const statusText = entry.status === 'vellykket' ? 'OK' : 'Feilet';
        const statusIcon = entry.status === 'vellykket' ? 'fa-check' : 'fa-times';

        // Parse user agent for device info
        const ua = entry.user_agent || '';
        let device = 'Ukjent';
        if (ua.includes('iPhone')) device = 'iPhone';
        else if (ua.includes('iPad')) device = 'iPad';
        else if (ua.includes('Android')) device = 'Android';
        else if (ua.includes('Windows')) device = 'Windows';
        else if (ua.includes('Mac')) device = 'Mac';
        else if (ua.includes('Linux')) device = 'Linux';

        row.innerHTML = `
          <td>${tid}</td>
          <td>${escapeHtml(entry.bruker_navn || '-')}</td>
          <td>${escapeHtml(entry.epost)}</td>
          <td><span class="status-badge ${statusClass}"><i class="fas ${statusIcon}"></i> ${statusText}</span></td>
          <td class="ip-address">${escapeHtml(entry.ip_adresse || '-')}</td>
          <td class="user-agent" title="${escapeHtml(ua)}">${device}</td>
        `;
        tbody.appendChild(row);
      });

      loginLogOffset += data.logg.length;

      // Hide load more if no more data
      const loadMoreBtn = document.getElementById('loadMoreLogins');
      if (loadMoreBtn) {
        loadMoreBtn.style.display = data.logg.length < LOGIN_LOG_LIMIT ? 'none' : 'block';
      }
    } else if (!append) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--color-text-tertiary);">Ingen innlogginger registrert</td></tr>';
    }
  } catch (error) {
    console.error('Error loading login log:', error);
  }
}

function renderSeasonChart() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthCounts = new Array(12).fill(0);

  // Count kontroller per month (based on neste_el_kontroll and neste_brann_kontroll)
  customers.forEach(c => {
    // El-kontroll
    if (c.neste_el_kontroll) {
      const date = new Date(c.neste_el_kontroll);
      if (!Number.isNaN(date.getTime())) {
        monthCounts[date.getMonth()]++;
      }
    }
    // Brann-kontroll
    if (c.neste_brann_kontroll) {
      const date = new Date(c.neste_brann_kontroll);
      if (!Number.isNaN(date.getTime())) {
        monthCounts[date.getMonth()]++;
      }
    }
  });

  const maxCount = Math.max(...monthCounts, 1);

  const container = document.getElementById('seasonChart');
  if (!container) return;

  container.innerHTML = months.map((month, i) => {
    const count = monthCounts[i];
    const height = (count / maxCount) * 100;
    return `
      <div class="season-bar">
        <span class="season-bar-value">${count}</span>
        <div class="season-bar-fill combined" style="height: ${height}%"></div>
        <span class="season-bar-label">${month}</span>
      </div>
    `;
  }).join('');
}

// Generic helper for rendering bar statistics
function renderBarStats(containerId, data, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (options.limit) sorted.splice(options.limit);

  if (sorted.length === 0) {
    container.innerHTML = '<p style="color: var(--color-text-muted); font-size: 13px;">Ingen data</p>';
    return;
  }

  const total = options.total || Object.values(data).reduce((a, b) => a + b, 0) || 1;
  const maxForPct = options.useMaxAsBase ? (sorted[0]?.[1] || 1) : total;

  container.innerHTML = sorted.map(([label, count]) => {
    const pct = (count / maxForPct) * 100;
    const barClass = options.getBarClass ? options.getBarClass(label) : options.barClass || 'default';
    const valueText = options.showPercent === false ? `${count}` : `${count} (${pct.toFixed(0)}%)`;
    return `
      <div class="stat-bar-item">
        <div class="stat-bar-header">
          <span class="stat-bar-label">${label}</span>
          <span class="stat-bar-value">${valueText}</span>
        </div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill ${barClass}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCategoryStats() {
  const categories = {};
  customers.forEach(c => {
    const cat = c.kategori || 'Ukjent';
    categories[cat] = (categories[cat] || 0) + 1;
  });

  renderBarStats('categoryStats', categories, {
    total: customers.length,
    getBarClass: (cat) => {
      if (cat === 'El-Kontroll') return 'el-kontroll';
      if (cat === 'Brannvarsling') return 'brannvarsling';
      return 'combined';
    }
  });
}

function renderAreaStats() {
  const areas = {};
  customers.forEach(c => {
    const area = c.poststed || 'Ukjent';
    areas[area] = (areas[area] || 0) + 1;
  });

  renderBarStats('areaStats', areas, {
    limit: 10,
    useMaxAsBase: true,
    showPercent: false,
    barClass: 'area'
  });
}

function renderEltypeStats() {
  const types = {};
  customers.forEach(c => {
    if (c.el_type) types[c.el_type] = (types[c.el_type] || 0) + 1;
  });

  renderBarStats('eltypeStats', types, { barClass: 'eltype' });
}

function renderBrannsystemStats() {
  const systems = {};
  customers.forEach(c => {
    if (c.brann_system) systems[c.brann_system] = (systems[c.brann_system] || 0) + 1;
  });

  renderBarStats('brannsystemStats', systems, { barClass: 'brannsystem' });
}

// Add all customers from a cluster to route
function addClusterToRoute(customerIds) {
  customerIds.forEach(id => {
    if (!selectedCustomers.has(id)) {
      selectedCustomers.add(id);
    }
  });
  updateSelectionUI();
  map.closePopup();

  // Show feedback
  const count = customerIds.length;
  showNotification(`${count} kunder lagt til ruten`);
}

// Zoom to cluster location
function zoomToCluster(lat, lng) {
  map.closePopup();
  map.setView([lat, lng], map.getZoom() + 2);
}

// Simple notification toast
function showNotification(message, type = 'success') {
  // Remove existing notification
  const existing = document.querySelector('.notification-toast');
  if (existing) existing.remove();

  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  };

  const toast = document.createElement('div');
  toast.className = `notification-toast notification-${type}`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i> ${escapeHtml(message)}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Make functions available globally for onclick handlers
window.editCustomer = editCustomer;
window.toggleCustomerSelection = toggleCustomerSelection;
window.loadSavedRoute = loadSavedRoute;
window.completeRoute = completeRoute;
window.deleteRoute = deleteRoute;
window.focusOnCustomer = focusOnCustomer;
window.createRouteForArea = createRouteForArea;
window.addClusterToRoute = addClusterToRoute;
window.zoomToCluster = zoomToCluster;

// ========================================
// SUPER ADMIN FUNCTIONS
// ========================================

let isSuperAdmin = false;
let superAdminOrganizations = [];
let selectedOrgId = null;
let selectedOrgData = null;

async function checkSuperAdminStatus() {
  // Check if user is super admin from the login response stored in sessionStorage/localStorage
  // This is set during login
  const storedSuperAdmin = sessionStorage.getItem('isSuperAdmin') || localStorage.getItem('isSuperAdmin');
  isSuperAdmin = storedSuperAdmin === 'true';

  if (isSuperAdmin) {
    const superAdminSection = document.getElementById('superAdminSection');
    if (superAdminSection) {
      superAdminSection.style.display = 'block';
      await loadSuperAdminData();
    }
  }
}

async function loadSuperAdminData() {
  if (!isSuperAdmin) return;

  try {
    // Load global statistics
    await loadGlobalStatistics();
    // Load organizations list
    await loadOrganizations();
    // Setup event listeners
    initSuperAdminUI();
  } catch (error) {
    console.error('Error loading super admin data:', error);
  }
}

async function loadGlobalStatistics() {
  try {
    const response = await fetch('/api/super-admin/statistics', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load global statistics');
      return;
    }

    const result = await response.json();
    if (result.success && result.data) {
      const stats = result.data;
      updateElement('statTotalOrgs', stats.totalOrganizations || 0);
      updateElement('statGlobalKunder', stats.totalKunder || 0);
      updateElement('statGlobalBrukere', stats.totalBrukere || 0);
      updateElement('statActiveOrgs', stats.activeOrganizations || 0);
    }
  } catch (error) {
    console.error('Error loading global statistics:', error);
  }
}

function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function loadOrganizations() {
  try {
    const response = await fetch('/api/super-admin/organizations', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load organizations');
      return;
    }

    const result = await response.json();
    if (result.success) {
      // Support paginated response format
      const data = result.data;
      superAdminOrganizations = Array.isArray(data) ? data : (data.organizations || []);
      renderOrganizationList();
    }
  } catch (error) {
    console.error('Error loading organizations:', error);
  }
}

function renderOrganizationList(filter = '') {
  const tbody = document.getElementById('orgListBody');
  if (!tbody) return;

  const filtered = filter
    ? superAdminOrganizations.filter(org =>
        org.navn.toLowerCase().includes(filter.toLowerCase()) ||
        org.slug.toLowerCase().includes(filter.toLowerCase())
      )
    : superAdminOrganizations;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          ${filter ? 'Ingen organisasjoner funnet' : 'Ingen organisasjoner registrert'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(org => {
    const planBadge = getPlanBadge(org.plan_type);
    const statusBadge = getSubscriptionStatusBadge(org.subscription_status);
    const opprettet = org.opprettet ? new Date(org.opprettet).toLocaleDateString('nb-NO') : '-';

    return `
      <tr data-org-id="${org.id}">
        <td><strong>${escapeHtml(org.navn)}</strong><br><small style="color: var(--text-tertiary);">${escapeHtml(org.slug)}</small></td>
        <td>${planBadge}</td>
        <td>${statusBadge}</td>
        <td>${org.kunde_count || 0}</td>
        <td>${org.bruker_count || 0}</td>
        <td>${opprettet}</td>
        <td>
          <button class="btn btn-small btn-secondary" onclick="selectOrganization(${org.id})">
            <i class="fas fa-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function getPlanBadge(plan) {
  const badges = {
    'free': '<span class="badge badge-secondary">Gratis</span>',
    'standard': '<span class="badge badge-primary">Standard</span>',
    'premium': '<span class="badge badge-success">Premium</span>',
    'enterprise': '<span class="badge badge-warning">Enterprise</span>'
  };
  return badges[plan] || badges.free;
}

function getSubscriptionStatusBadge(status) {
  const badges = {
    'active': '<span class="badge badge-success">Aktiv</span>',
    'trialing': '<span class="badge badge-info">Prøveperiode</span>',
    'past_due': '<span class="badge badge-warning">Forfalt</span>',
    'canceled': '<span class="badge badge-danger">Kansellert</span>',
    'incomplete': '<span class="badge badge-secondary">Ufullstendig</span>'
  };
  return badges[status] || '<span class="badge badge-secondary">Ukjent</span>';
}

async function selectOrganization(orgId) {
  selectedOrgId = orgId;

  try {
    // Load organization details
    const response = await fetch(`/api/super-admin/organizations/${orgId}`, {
      credentials: 'include'
    });

    if (!response.ok) {
      showNotification('Kunne ikke laste organisasjonsdetaljer', 'error');
      return;
    }

    const result = await response.json();
    if (result.success) {
      selectedOrgData = result.data;
      renderSelectedOrganization();

      // Show the details section
      const detailsSection = document.getElementById('selectedOrgSection');
      if (detailsSection) {
        detailsSection.style.display = 'block';
        detailsSection.scrollIntoView({ behavior: 'smooth' });
      }

      // Load customers for this org
      await loadOrgCustomers(orgId);
      await loadOrgUsers(orgId);
    }
  } catch (error) {
    console.error('Error loading organization:', error);
    showNotification('Feil ved lasting av organisasjon', 'error');
  }
}

function renderSelectedOrganization() {
  if (!selectedOrgData) return;

  updateElement('selectedOrgName', selectedOrgData.navn);
  updateElement('orgInfoSlug', selectedOrgData.slug);
  updateElement('orgInfoPlan', selectedOrgData.plan_type || 'free');
  updateElement('orgInfoSubscription', selectedOrgData.subscription_status || 'ukjent');
  updateElement('orgInfoIndustry', selectedOrgData.industry_template_id ? `ID: ${selectedOrgData.industry_template_id}` : 'Ingen');
}

async function loadOrgCustomers(orgId) {
  try {
    const response = await fetch(`/api/super-admin/organizations/${orgId}/kunder`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load org customers');
      return;
    }

    const result = await response.json();
    if (result.success) {
      renderOrgCustomers(result.data || []);
      updateElement('orgCustomerCount', (result.data || []).length);
    }
  } catch (error) {
    console.error('Error loading org customers:', error);
  }
}

function renderOrgCustomers(customers) {
  const tbody = document.getElementById('orgCustomersBody');
  if (!tbody) return;

  if (customers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          Ingen kunder registrert
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = customers.map(kunde => `
    <tr data-kunde-id="${kunde.id}">
      <td><strong>${escapeHtml(kunde.navn)}</strong></td>
      <td>${escapeHtml(kunde.adresse || '-')}</td>
      <td>${escapeHtml(kunde.telefon || '-')}</td>
      <td>${escapeHtml(kunde.epost || '-')}</td>
      <td>
        <button class="btn-icon" onclick="editOrgCustomer(${kunde.id})" title="Rediger">
          <i class="fas fa-pen"></i>
        </button>
        <button class="btn-icon delete" onclick="deleteOrgCustomer(${kunde.id})" title="Slett">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

async function loadOrgUsers(orgId) {
  try {
    const response = await fetch(`/api/super-admin/organizations/${orgId}/brukere`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load org users');
      return;
    }

    const result = await response.json();
    if (result.success) {
      renderOrgUsers(result.data || []);
      updateElement('orgUserCount', (result.data || []).length);
    }
  } catch (error) {
    console.error('Error loading org users:', error);
  }
}

function renderOrgUsers(users) {
  const tbody = document.getElementById('orgUsersBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          Ingen brukere registrert
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = users.map(user => {
    const sistInnlogget = user.sist_innlogget
      ? formatRelativeTime(user.sist_innlogget)
      : 'Aldri';
    const opprettet = user.opprettet
      ? new Date(user.opprettet).toLocaleDateString('nb-NO')
      : '-';

    return `
      <tr>
        <td><strong>${escapeHtml(user.navn)}</strong></td>
        <td>${escapeHtml(user.epost)}</td>
        <td>${sistInnlogget}</td>
        <td>${opprettet}</td>
      </tr>
    `;
  }).join('');
}

function closeOrgDetails() {
  selectedOrgId = null;
  selectedOrgData = null;
  const detailsSection = document.getElementById('selectedOrgSection');
  if (detailsSection) {
    detailsSection.style.display = 'none';
  }
}

async function addOrgCustomer() {
  if (!selectedOrgId) return;

  // Use the existing customer modal but in "add for org" mode
  openCustomerModal(null, selectedOrgId);
}

async function editOrgCustomer(kundeId) {
  if (!selectedOrgId) return;

  try {
    // Fetch customer data
    const response = await fetch(`/api/super-admin/organizations/${selectedOrgId}/kunder`, {
      credentials: 'include'
    });

    if (!response.ok) return;

    const result = await response.json();
    const kunde = (result.data || []).find(k => k.id === kundeId);

    if (kunde) {
      openCustomerModal(kunde, selectedOrgId);
    }
  } catch (error) {
    console.error('Error fetching customer:', error);
  }
}

async function deleteOrgCustomer(kundeId) {
  if (!selectedOrgId) return;

  if (!confirm('Er du sikker på at du vil slette denne kunden?')) {
    return;
  }

  try {
    const deleteHeaders = {};
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      deleteHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(`/api/super-admin/organizations/${selectedOrgId}/kunder/${kundeId}`, {
      method: 'DELETE',
      headers: deleteHeaders,
      credentials: 'include'
    });

    if (response.ok) {
      showNotification('Kunde slettet');
      await loadOrgCustomers(selectedOrgId);
      await loadGlobalStatistics();
    } else {
      const result = await response.json();
      showNotification(result.error?.message || 'Kunne ikke slette kunden', 'error');
    }
  } catch (error) {
    console.error('Error deleting customer:', error);
    showNotification('Feil ved sletting av kunde', 'error');
  }
}

// Open customer modal for super admin - reuse existing modal or create simple version
function openCustomerModal(kunde = null, forOrgId = null) {
  // For super admin, we'll create a simple modal inline
  const existingModal = document.getElementById('superAdminCustomerModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'superAdminCustomerModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <div class="modal-header">
        <h2>${kunde ? 'Rediger kunde' : 'Ny kunde'}</h2>
        <button class="modal-close" onclick="closeSuperAdminCustomerModal()">&times;</button>
      </div>
      <form id="superAdminCustomerForm" onsubmit="saveSuperAdminCustomer(event)">
        <input type="hidden" id="saKundeId" value="${kunde?.id || ''}">
        <input type="hidden" id="saKundeOrgId" value="${forOrgId || ''}">

        <div class="form-group">
          <label for="saKundeNavn">Navn *</label>
          <input type="text" id="saKundeNavn" value="${escapeHtml(kunde?.navn || '')}" required>
        </div>

        <div class="form-group">
          <label for="saKundeAdresse">Adresse *</label>
          <input type="text" id="saKundeAdresse" value="${escapeHtml(kunde?.adresse || '')}" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="saKundePostnummer">Postnummer</label>
            <input type="text" id="saKundePostnummer" value="${escapeHtml(kunde?.postnummer || '')}">
          </div>
          <div class="form-group">
            <label for="saKundePoststed">Poststed</label>
            <input type="text" id="saKundePoststed" value="${escapeHtml(kunde?.poststed || '')}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="saKundeTelefon">Telefon</label>
            <input type="text" id="saKundeTelefon" value="${escapeHtml(kunde?.telefon || '')}">
          </div>
          <div class="form-group">
            <label for="saKundeEpost">E-post</label>
            <input type="email" id="saKundeEpost" value="${escapeHtml(kunde?.epost || '')}">
          </div>
        </div>

        <div class="form-group">
          <label for="saKundeKontaktperson">Kontaktperson</label>
          <input type="text" id="saKundeKontaktperson" value="${escapeHtml(kunde?.kontaktperson || '')}">
        </div>

        <div class="form-group">
          <label for="saKundeNotater">Notater</label>
          <textarea id="saKundeNotater" rows="3">${escapeHtml(kunde?.notater || '')}</textarea>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="closeSuperAdminCustomerModal()">Avbryt</button>
          <button type="submit" class="btn btn-primary">${kunde ? 'Lagre' : 'Opprett'}</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
}

function closeSuperAdminCustomerModal() {
  const modal = document.getElementById('superAdminCustomerModal');
  if (modal) modal.remove();
}

async function saveSuperAdminCustomer(e) {
  e.preventDefault();

  const kundeId = document.getElementById('saKundeId').value;
  const orgId = document.getElementById('saKundeOrgId').value;

  const data = {
    navn: document.getElementById('saKundeNavn').value,
    adresse: document.getElementById('saKundeAdresse').value,
    postnummer: document.getElementById('saKundePostnummer').value,
    poststed: document.getElementById('saKundePoststed').value,
    telefon: document.getElementById('saKundeTelefon').value,
    epost: document.getElementById('saKundeEpost').value,
    kontaktperson: document.getElementById('saKundeKontaktperson').value,
    notater: document.getElementById('saKundeNotater').value
  };

  try {
    let url = `/api/super-admin/organizations/${orgId}/kunder`;
    let method = 'POST';

    if (kundeId) {
      url += `/${kundeId}`;
      method = 'PUT';
    }

    const saHeaders = {
      'Content-Type': 'application/json'
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      saHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(url, {
      method,
      headers: saHeaders,
      credentials: 'include',
      body: JSON.stringify(data)
    });

    if (response.ok) {
      showNotification(kundeId ? 'Kunde oppdatert' : 'Kunde opprettet');
      closeSuperAdminCustomerModal();
      await loadOrgCustomers(orgId);
      await loadGlobalStatistics();
    } else {
      const result = await response.json();
      showNotification(result.error?.message || 'Kunne ikke lagre kunden', 'error');
    }
  } catch (error) {
    console.error('Error saving customer:', error);
    showNotification('Feil ved lagring av kunde', 'error');
  }
}

function initSuperAdminUI() {
  // Organization search
  const orgSearchInput = document.getElementById('orgSearchInput');
  if (orgSearchInput) {
    orgSearchInput.addEventListener('input', debounce((e) => {
      renderOrganizationList(e.target.value);
    }, 300));
  }

  // Close org details button
  const closeOrgBtn = document.getElementById('closeOrgDetailsBtn');
  if (closeOrgBtn) {
    closeOrgBtn.addEventListener('click', closeOrgDetails);
  }

  // Add customer button
  const addOrgCustomerBtn = document.getElementById('addOrgCustomerBtn');
  if (addOrgCustomerBtn) {
    addOrgCustomerBtn.addEventListener('click', addOrgCustomer);
  }

  // Organization detail tabs
  const tabBtns = document.querySelectorAll('.org-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // Update active button
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide tabs
      document.getElementById('orgCustomersTab').style.display = tab === 'customers' ? 'block' : 'none';
      document.getElementById('orgUsersTab').style.display = tab === 'users' ? 'block' : 'none';
    });
  });
}

// Make super admin functions available globally
window.selectOrganization = selectOrganization;
window.editOrgCustomer = editOrgCustomer;
window.deleteOrgCustomer = deleteOrgCustomer;
window.closeSuperAdminCustomerModal = closeSuperAdminCustomerModal;
window.saveSuperAdminCustomer = saveSuperAdminCustomer;

// ============================================
// TODAY'S WORK (Dagens arbeid)
// ============================================

let twCurrentDate = new Date().toISOString().split('T')[0];
let twRouteData = null;

function initTodaysWork() {
  // Show tab if feature is enabled
  if (hasFeature('todays_work')) {
    const tab = document.getElementById('todaysWorkTab');
    if (tab) tab.style.display = '';
  }

  // Date navigation
  document.getElementById('twPrevDay')?.addEventListener('click', () => {
    const d = new Date(twCurrentDate);
    d.setDate(d.getDate() - 1);
    twCurrentDate = d.toISOString().split('T')[0];
    loadTodaysWork();
  });

  document.getElementById('twNextDay')?.addEventListener('click', () => {
    const d = new Date(twCurrentDate);
    d.setDate(d.getDate() + 1);
    twCurrentDate = d.toISOString().split('T')[0];
    loadTodaysWork();
  });

  // Start route button
  document.getElementById('twStartRouteBtn')?.addEventListener('click', startTodaysRoute);
}

async function loadTodaysWork() {
  const dateLabel = document.getElementById('twDateLabel');
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  if (twCurrentDate === today) {
    dateLabel.textContent = 'I dag';
  } else if (twCurrentDate === tomorrow) {
    dateLabel.textContent = 'I morgen';
  } else {
    const d = new Date(twCurrentDate);
    dateLabel.textContent = d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  try {
    const response = await fetch(`/api/todays-work/my-route?date=${twCurrentDate}`, {
      headers: { 'X-CSRF-Token': csrfToken }
    });
    const json = await response.json();

    if (json.success && json.data) {
      twRouteData = json.data;
      renderTodaysWork();
      // Cache for offline use
      if (window.OfflineStorage) {
        const userId = localStorage.getItem('userId') || '0';
        OfflineStorage.saveTodaysRoute(twCurrentDate, userId, json.data).catch(() => {});
        OfflineStorage.setLastSyncTime().catch(() => {});
      }
    } else {
      twRouteData = null;
      document.getElementById('twRouteCard').style.display = 'none';
      document.getElementById('twStopsList').innerHTML = '';
      document.getElementById('twEmpty').style.display = 'flex';
      updateTodaysWorkBadge(0, 0);
    }
  } catch (err) {
    console.error('Error loading todays work:', err);
    // Try offline fallback
    if (window.OfflineStorage && !navigator.onLine) {
      const userId = localStorage.getItem('userId') || '0';
      const cached = await OfflineStorage.getTodaysRoute(twCurrentDate, userId);
      if (cached) {
        twRouteData = cached;
        renderTodaysWork();
        showNotification('Viser lagret rute (frakoblet)', 'warning');
        return;
      }
    }
    showNotification('Kunne ikke laste dagens rute', 'error');
  }
}

function renderTodaysWork() {
  const route = twRouteData;
  if (!route) return;

  document.getElementById('twEmpty').style.display = 'none';
  document.getElementById('twRouteCard').style.display = 'block';

  document.getElementById('twRouteName').textContent = escapeHtml(route.navn || 'Rute');

  const isStarted = !!route.execution_started_at;
  const isCompleted = !!route.execution_ended_at;
  const statusEl = document.getElementById('twRouteStatus');

  if (isCompleted) {
    statusEl.textContent = 'Fullført';
    statusEl.className = 'tw-route-status tw-status-completed';
    document.getElementById('twStartRouteBtn').style.display = 'none';
  } else if (isStarted) {
    statusEl.textContent = 'Pågår';
    statusEl.className = 'tw-route-status tw-status-active';
    document.getElementById('twStartRouteBtn').style.display = 'none';
  } else {
    statusEl.textContent = 'Planlagt';
    statusEl.className = 'tw-route-status tw-status-planned';
    document.getElementById('twStartRouteBtn').style.display = '';
  }

  const completed = isStarted ? (route.completed_count || 0) : 0;
  const total = route.total_count || 0;
  document.getElementById('twCompleted').textContent = completed;
  document.getElementById('twTotal').textContent = total;

  const pct = total > 0 ? (completed / total) * 100 : 0;
  document.getElementById('twProgressFill').style.width = pct + '%';

  if (route.total_distanse) {
    document.getElementById('twDistanceStat').style.display = '';
    document.getElementById('twDistance').textContent = (route.total_distanse / 1000).toFixed(1) + ' km';
  }

  updateTodaysWorkBadge(completed, total);

  // Render customer stops
  const stopsList = document.getElementById('twStopsList');
  const kunder = route.kunder || [];
  const visits = route.visits || [];

  if (kunder.length === 0) {
    stopsList.innerHTML = '<p class="tw-no-stops">Ingen kunder på denne ruten.</p>';
    return;
  }

  // Find next unvisited stop
  let nextStopIndex = -1;
  if (isStarted && !isCompleted) {
    nextStopIndex = kunder.findIndex(k => {
      const v = visits.find(v => v.kunde_id === k.id);
      return !v || !v.completed;
    });
  }

  let html = '';

  // Show prominent "Next Stop" card on mobile when route is active
  if (isStarted && !isCompleted && nextStopIndex >= 0) {
    const nextKunde = kunder[nextStopIndex];
    const address = [nextKunde.adresse, nextKunde.postnummer, nextKunde.poststed].filter(Boolean).join(', ');
    html += `
      <div class="tw-next-stop-card">
        <div class="tw-next-stop-label">
          <i class="fas fa-arrow-right"></i> Neste stopp (${nextStopIndex + 1}/${kunder.length})
        </div>
        <h3 class="tw-next-stop-name">${escapeHtml(nextKunde.navn)}</h3>
        <p class="tw-next-stop-address">${escapeHtml(address)}</p>
        ${nextKunde.telefon ? `<p class="tw-next-stop-phone"><i class="fas fa-phone"></i> ${escapeHtml(nextKunde.telefon)}</p>` : ''}
        <div class="tw-next-stop-actions">
          <button class="btn btn-primary tw-next-nav-btn" onclick="twNavigateToCustomer(${nextKunde.id})">
            <i class="fas fa-directions"></i> Naviger hit
          </button>
          ${nextKunde.telefon ? `<a href="tel:${escapeHtml(nextKunde.telefon)}" class="btn btn-secondary tw-next-call-btn"><i class="fas fa-phone"></i> Ring</a>` : ''}
          <button class="btn btn-success tw-next-done-btn" onclick="twMarkVisited(${nextKunde.id})">
            <i class="fas fa-check"></i> Fullført
          </button>
        </div>
      </div>
    `;
  }

  // Render stops list - visited stops collapsed, next highlighted
  const visitedStops = [];
  const remainingStops = [];

  kunder.forEach((kunde, index) => {
    const visit = isStarted ? visits.find(v => v.kunde_id === kunde.id) : null;
    const isVisited = visit && visit.completed === true;
    const isNextStop = index === nextStopIndex;

    const card = `
      <div class="tw-stop-card ${isVisited ? 'tw-stop-completed' : ''} ${isNextStop ? 'tw-stop-next' : ''}" data-kunde-id="${kunde.id}">
        <div class="tw-stop-number">${index + 1}</div>
        <div class="tw-stop-info">
          <h4>${escapeHtml(kunde.navn)}</h4>
          ${!isVisited ? `<p>${escapeHtml(kunde.adresse || '')}${kunde.poststed ? ', ' + escapeHtml(kunde.poststed) : ''}</p>` : ''}
          ${!isVisited && kunde.telefon ? `<p class="tw-stop-phone">${escapeHtml(kunde.telefon)}</p>` : ''}
        </div>
        <div class="tw-stop-actions">
          ${!isVisited && kunde.telefon ? `<a href="tel:${escapeHtml(kunde.telefon)}" class="btn btn-icon btn-small tw-action-call" title="Ring"><i class="fas fa-phone"></i></a>` : ''}
          ${!isVisited ? `<button class="btn btn-icon btn-small tw-action-nav" onclick="twNavigateToCustomer(${kunde.id})" title="Naviger"><i class="fas fa-directions"></i></button>` : ''}
          ${isVisited
            ? '<span class="tw-visited-check"><i class="fas fa-check-circle"></i></span>'
            : `<button class="btn btn-icon btn-small tw-action-visit" onclick="twMarkVisited(${kunde.id})" title="Marker besøkt"><i class="fas fa-check"></i></button>`
          }
        </div>
      </div>
    `;

    if (isVisited) {
      visitedStops.push(card);
    } else {
      remainingStops.push(card);
    }
  });

  // Show remaining stops first, then collapsed visited section
  html += remainingStops.join('');

  if (visitedStops.length > 0) {
    html += `
      <div class="tw-visited-section">
        <button class="tw-visited-toggle" onclick="this.parentElement.classList.toggle('expanded')">
          <i class="fas fa-check-circle"></i>
          <span>Besøkt (${visitedStops.length})</span>
          <i class="fas fa-chevron-down tw-visited-chevron"></i>
        </button>
        <div class="tw-visited-list">
          ${visitedStops.join('')}
        </div>
      </div>
    `;
  }

  stopsList.innerHTML = html;
}

function updateTodaysWorkBadge(completed, total) {
  const badge = document.getElementById('todaysWorkBadge');
  if (badge) {
    if (total > 0) {
      badge.textContent = `${completed}/${total}`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}

async function startTodaysRoute() {
  if (!twRouteData) return;

  try {
    const response = await fetch(`/api/todays-work/start-route/${twRouteData.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
    });
    const json = await response.json();
    if (json.success) {
      showNotification('Rute startet!', 'success');
      loadTodaysWork();
    }
  } catch (err) {
    showNotification('Kunne ikke starte ruten', 'error');
  }
}

async function twMarkVisited(kundeId) {
  if (!twRouteData) return;

  try {
    const response = await fetch(`/api/todays-work/visit/${kundeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ rute_id: twRouteData.id, completed: true })
    });
    const json = await response.json();
    if (json.success) {
      showNotification('Kunde markert som besøkt', 'success');
      loadTodaysWork();
    }
  } catch (err) {
    // Offline: optimistic update + queue for sync
    if (!navigator.onLine && window.SyncManager) {
      // Update local state optimistically
      if (twRouteData.visits) {
        const existing = twRouteData.visits.find(v => v.kunde_id === kundeId);
        if (existing) {
          existing.completed = true;
          existing.visited_at = new Date().toISOString();
        } else {
          twRouteData.visits.push({ kunde_id: kundeId, completed: true, visited_at: new Date().toISOString() });
        }
      }
      twRouteData.completed_count = (twRouteData.completed_count || 0) + 1;
      renderTodaysWork();

      // Queue for sync
      await SyncManager.queueOfflineAction({
        type: 'VISIT_CUSTOMER',
        url: `/api/todays-work/visit/${kundeId}`,
        method: 'POST',
        body: { rute_id: twRouteData.id, completed: true }
      });

      // Update offline cache
      if (window.OfflineStorage) {
        const userId = localStorage.getItem('userId') || '0';
        OfflineStorage.saveTodaysRoute(twCurrentDate, userId, twRouteData).catch(() => {});
      }

      showNotification('Besøk registrert (synkroniseres når du er online)', 'warning');
    } else {
      showNotification('Kunne ikke registrere besøk', 'error');
    }
  }
}

function twNavigateToCustomer(kundeId) {
  const kunde = twRouteData?.kunder?.find(k => k.id === kundeId);
  if (!kunde) return;

  const address = [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean).join(', ');

  if (kunde.latitude && kunde.longitude) {
    // Use coordinates for precision
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      window.open(`maps://maps.apple.com/?daddr=${kunde.latitude},${kunde.longitude}&dirflg=d`);
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${kunde.latitude},${kunde.longitude}`);
    }
  } else if (address) {
    // Fallback to address
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`);
  }
}

window.twMarkVisited = twMarkVisited;
window.twNavigateToCustomer = twNavigateToCustomer;

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
// BOTTOM TAB BAR
// ============================================

function initBottomTabBar() {
  if (document.getElementById('bottomTabBar')) return;

  document.body.classList.add('has-bottom-tab-bar');

  const hasTodaysWork = hasFeature('todays_work');

  const tabs = [
    { id: 'map', icon: 'fa-map-marker-alt', label: 'Kart', action: 'showMap' },
    { id: 'work', icon: 'fa-briefcase', label: 'Arbeid',
      action: hasTodaysWork ? 'todays-work' : 'avhuking' },
    { id: 'routes', icon: 'fa-route', label: 'Ruter', action: 'routes' },
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

  // Check if Today's Work and Avhuking should both appear
  const hasTodaysWork = hasFeature('todays_work');
  if (hasTodaysWork) {
    // Avhuking is in More since Today's Work is in the bottom bar
    items.splice(2, 0, { tab: 'avhuking', icon: 'fa-clipboard-check', label: 'Avhuking', badgeId: 'avhukingBadge' });
  } else {
    // Today's Work tab goes in More if available but not the primary work tab
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
    </div>
  `;

  document.body.appendChild(overlay);

  // Close button
  document.getElementById('moreMenuCloseBtn').addEventListener('click', closeMoreMenu);

  // Item click handlers
  overlay.querySelectorAll('.more-menu-item').forEach(btn => {
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
    // Open routes tab to show selected customers
    switchToTab('routes');
    if (document.getElementById('bottomTabBar')) {
      document.querySelectorAll('.bottom-tab-item').forEach(b =>
        b.classList.toggle('active', b.dataset.bottomTab === 'routes')
      );
      activeBottomTab = 'routes';
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

  // Work tab badge - mirror from todaysWorkBadge or avhukingBadge
  const workBtn = document.querySelector('.bottom-tab-item[data-bottom-tab="work"]');
  if (workBtn) {
    const hasTW = hasFeature('todays_work');
    const sourceId = hasTW ? 'todaysWorkBadge' : 'avhukingBadge';
    const source = document.getElementById(sourceId);
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
const badgeIds = ['overdueBadge', 'upcomingBadge', 'todaysWorkBadge', 'avhukingBadge', 'missingDataBadge'];

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
window.closeContentPanelMobile = closeContentPanelMobile;

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
              ${index < current ? '<i aria-hidden="true" class="fas fa-check"></i>' : `<span>${index + 1}</span>`}
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
      <h1><i aria-hidden="true" class="fas fa-building"></i> Firmainformasjon</h1>
      <p>Oppgi firmaets adresse. Dette brukes som utgangspunkt for ruteplanlegging.</p>
    </div>

    <div class="wizard-form">
      <div class="wizard-form-group">
        <label for="companyAddress"><i aria-hidden="true" class="fas fa-map-marker-alt"></i> Firmaadresse</label>
        <div class="wizard-address-wrapper">
          <input type="text" id="companyAddress" placeholder="Begynn å skrive adresse..." value="${escapeHtml(data.address || '')}" autocomplete="off">
          <div class="wizard-address-suggestions" id="wizardAddressSuggestions"></div>
        </div>
      </div>

      <div class="wizard-form-row">
        <div class="wizard-form-group">
          <label for="companyPostnummer"><i aria-hidden="true" class="fas fa-hashtag"></i> Postnummer</label>
          <div class="wizard-postnummer-wrapper">
            <input type="text" id="companyPostnummer" placeholder="0000" maxlength="4" value="${escapeHtml(data.postnummer || '')}" autocomplete="off">
            <span class="wizard-postnummer-status" id="wizardPostnummerStatus"></span>
          </div>
        </div>
        <div class="wizard-form-group">
          <label for="companyPoststed"><i aria-hidden="true" class="fas fa-city"></i> Poststed</label>
          <input type="text" id="companyPoststed" placeholder="Fylles automatisk" value="${escapeHtml(data.poststed || '')}">
        </div>
      </div>

      <div class="wizard-form-group">
        <label><i aria-hidden="true" class="fas fa-route"></i> Rute-startpunkt</label>
        <p class="wizard-form-hint">Klikk på kartet for å velge startpunkt for ruter, eller bruk firmaadresse.</p>
        <div id="wizardRouteMap" class="wizard-mini-map"></div>
        <div class="wizard-coordinates" id="routeCoordinates">
          ${data.route_start_lat ? `<span>Valgt: ${data.route_start_lat.toFixed(5)}, ${data.route_start_lng.toFixed(5)}</span>` : '<span class="not-set">Ikke valgt - klikk på kartet</span>'}
        </div>
        <button class="wizard-btn wizard-btn-secondary" onclick="useAddressAsRouteStart()">
          <i aria-hidden="true" class="fas fa-home"></i> Bruk firmaadresse
        </button>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-skip" onclick="handleSkipOnboarding()">
        <i aria-hidden="true" class="fas fa-forward"></i> Hopp over oppsett
      </button>
      <button class="wizard-btn wizard-btn-primary" onclick="nextWizardStep()">
        Neste <i aria-hidden="true" class="fas fa-arrow-right"></i>
      </button>
    </div>
  `;
}

// Render map settings step
function renderMapStep() {
  const data = onboardingWizard.data.map;

  return `
    <div class="wizard-step-header">
      <h1><i aria-hidden="true" class="fas fa-map-marker-alt"></i> Kartinnstillinger</h1>
      <p>Velg standard kartvisning. Dra og zoom kartet til ønsket område.</p>
    </div>

    <div class="wizard-form">
      <div class="wizard-form-group">
        <label><i aria-hidden="true" class="fas fa-map"></i> Standard kartsentrum</label>
        <p class="wizard-form-hint">Panorer og zoom kartet til det området du vanligvis jobber i.</p>
        <div id="wizardMainMap" class="wizard-map"></div>
      </div>

      <div class="wizard-form-group">
        <label for="defaultZoom"><i aria-hidden="true" class="fas fa-search-plus"></i> Standard zoom-nivå</label>
        <div class="wizard-slider-container">
          <input type="range" id="defaultZoom" min="5" max="18" value="${data.zoom || 10}">
          <span class="wizard-slider-value" id="zoomValue">${data.zoom || 10}</span>
        </div>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="prevWizardStep()">
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-primary" onclick="nextWizardStep()">
        Fullfør oppsett <i aria-hidden="true" class="fas fa-check"></i>
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
        <i aria-hidden="true" class="fas fa-check-circle"></i>
      </div>
      <h1>Oppsettet er fullført!</h1>
      <p>Flott! Systemet er nå tilpasset for ${escapeHtml(industryName)}.</p>
    </div>

    <div class="wizard-complete-summary">
      <h3>Hva skjer nå?</h3>
      <ul class="wizard-tips-list">
        <li><i aria-hidden="true" class="fas fa-users"></i> Legg til dine første kunder</li>
        <li><i aria-hidden="true" class="fas fa-route"></i> Planlegg effektive ruter</li>
        <li><i aria-hidden="true" class="fas fa-calendar-alt"></i> Bruk kalenderen for å holde oversikt</li>
        <li><i aria-hidden="true" class="fas fa-cog"></i> Tilpass ytterligere i innstillinger</li>
      </ul>
    </div>

    <div class="wizard-footer wizard-footer-center">
      <button class="wizard-btn wizard-btn-primary wizard-btn-large" onclick="completeOnboardingWizard()">
        <i aria-hidden="true" class="fas fa-rocket"></i> Start å bruke Sky Planner
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
      <h1><i aria-hidden="true" class="fas fa-download"></i> Importer kunder</h1>
      <p>Velg hvordan du vil hente inn dine eksisterende kunder.</p>
    </div>

    <div class="wizard-import-method-choice">
      <div class="wizard-method-card" role="button" tabindex="0" onclick="selectImportMethodIntegration()">
        <div class="wizard-method-icon">
          <i aria-hidden="true" class="fas fa-plug"></i>
        </div>
        <h3>Regnskapssystem</h3>
        <p>Koble til Tripletex, Fiken eller PowerOffice og synkroniser kunder automatisk.</p>
        <span class="wizard-method-action">Koble til <i aria-hidden="true" class="fas fa-external-link-alt"></i></span>
      </div>

      <div class="wizard-method-card" role="button" tabindex="0" onclick="selectImportMethodFile()">
        <div class="wizard-method-icon">
          <i aria-hidden="true" class="fas fa-file-excel"></i>
        </div>
        <h3>Excel / CSV</h3>
        <p>Last opp en fil med kundedata. AI-assistert mapping hjelper deg med kolonnene.</p>
        <span class="wizard-method-action">Last opp fil <i aria-hidden="true" class="fas fa-arrow-right"></i></span>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="prevWizardStep()">
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-skip" onclick="skipWizardImport()">
        Hopp over <i aria-hidden="true" class="fas fa-forward"></i>
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
      <h1><i aria-hidden="true" class="fas fa-file-excel"></i> Importer kunder</h1>
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
        <i aria-hidden="true" class="fas ${current.icon}"></i>
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
        <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
        <p>${escapeHtml(wizardImportState.error)}</p>
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardImportRetry()">
          <i aria-hidden="true" class="fas fa-redo"></i> Prøv igjen
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
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <div>
            <strong>Ingen problemer funnet</strong>
            <p>Filen ser bra ut! ${totalRows} rader klare for import.</p>
          </div>
        </div>
        <div class="wizard-import-actions">
          <button class="wizard-btn wizard-btn-secondary" onclick="wizardCleaningBack()">
            <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
          </button>
          <button class="wizard-btn wizard-btn-primary" onclick="wizardCleaningApprove()">
            Gå videre <i aria-hidden="true" class="fas fa-arrow-right"></i>
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
        <i aria-hidden="true" class="fas fa-broom"></i>
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
          <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
        </button>
        <button class="wizard-btn wizard-btn-ghost" onclick="wizardCleaningSkip()">
          Hopp over rensing
        </button>
        <button class="wizard-btn wizard-btn-primary" onclick="wizardCleaningApprove()">
          <i aria-hidden="true" class="fas fa-check"></i> Godkjenn rensing <i aria-hidden="true" class="fas fa-arrow-right"></i>
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
      <h3><i aria-hidden="true" class="fas fa-table"></i> Fullstendig dataoversikt</h3>
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
            <i aria-hidden="true" class="fas fa-chevron-left"></i> Forrige
          </button>
          <span>Side ${validPage + 1} av ${totalPages}</span>
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardCleaningTablePage(${validPage + 1})" ${validPage >= totalPages - 1 ? 'disabled' : ''}>
            Neste <i aria-hidden="true" class="fas fa-chevron-right"></i>
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
          <i aria-hidden="true" class="fas fa-robot"></i>
        </div>
        <div class="ai-feature-content">
          <h4><i aria-hidden="true" class="fas fa-magic"></i> AI-assistert import</h4>
          <p>Vår AI forstår <strong>${escapeHtml(industryName)}</strong> og mapper automatisk kolonner til riktige felt - selv med kreative kolonnenavn!</p>
        </div>
      </div>

      <div class="wizard-import-dropzone" id="wizardImportDropzone" role="button" tabindex="0" aria-label="Last opp fil. Dra og slipp, eller trykk for å velge fil.">
        <i aria-hidden="true" class="fas fa-cloud-upload-alt"></i>
        <p><strong>Dra og slipp fil her</strong></p>
        <p>eller klikk for å velge</p>
        <span class="import-formats">Støttede formater: .xlsx, .xls, .csv (maks 10MB)</span>
        <input type="file" id="wizardImportFileInput" accept=".xlsx,.xls,.csv" hidden>
      </div>

      <div class="wizard-import-tips">
        <h4><i aria-hidden="true" class="fas fa-lightbulb"></i> Tips for import</h4>
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
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-skip" onclick="skipWizardImport()">
        Hopp over <i aria-hidden="true" class="fas fa-forward"></i>
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
        <i aria-hidden="true" class="fas fa-question-circle"></i>
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
                  onchange="handleAIQuestionAnswer('${escapeJsString(q.header)}', '${escapeJsString(q.targetField || '')}')">
                <span>${escapeHtml(q.targetField || 'Egendefinert felt')} <span class="recommended">(Anbefalt av AI)</span></span>
              </label>
              <label class="question-option ${wizardImportState.questionAnswers[q.header] === '_custom' ? 'selected' : ''}">
                <input type="radio" name="q_${index}" value="_custom"
                  ${wizardImportState.questionAnswers[q.header] === '_custom' ? 'checked' : ''}
                  onchange="handleAIQuestionAnswer('${escapeJsString(q.header)}', '_custom')">
                <span>Behold som egendefinert felt</span>
              </label>
              <label class="question-option ${wizardImportState.questionAnswers[q.header] === '_skip' ? 'selected' : ''}">
                <input type="radio" name="q_${index}" value="_skip"
                  ${wizardImportState.questionAnswers[q.header] === '_skip' ? 'checked' : ''}
                  onchange="handleAIQuestionAnswer('${escapeJsString(q.header)}', '_skip')">
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
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <span>Kolonner gjenkjent automatisk</span>
        </div>
        <p class="wizard-required-desc">Endre hvis noe er feil.</p>
      ` : `
        <div class="wizard-required-header">
          <i aria-hidden="true" class="fas fa-columns"></i>
          <span>Velg kolonner</span>
        </div>
        <p class="wizard-required-desc">Velg hvilken kolonne som er kundenavn og adresse.</p>
      `}

      <div class="wizard-required-grid">
        <div class="wizard-required-row">
          <label>
            <i aria-hidden="true" class="fas fa-user"></i>
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
            <i aria-hidden="true" class="fas fa-map-marker-alt"></i>
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
          <i aria-hidden="true" class="fas fa-times-circle"></i>
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
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <span>Fant <strong>${data.totalRows || 0}</strong> kunder i filen</span>
        </div>

        <div class="wizard-auto-stats">
          <div class="wizard-auto-stat">
            <i aria-hidden="true" class="fas fa-columns"></i>
            <span>${data.totalColumns || 0} kolonner totalt</span>
          </div>
          <div class="wizard-auto-stat wizard-auto-stat-success">
            <i aria-hidden="true" class="fas fa-check"></i>
            <span>${recognizedColumns.length} gjenkjent</span>
          </div>
          ${newFields.length > 0 ? `
            <div class="wizard-auto-stat wizard-auto-stat-new">
              <i aria-hidden="true" class="fas fa-plus"></i>
              <span>${newFields.length} nye felt</span>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Mapping Status indicator -->
      <div class="wizard-ai-status wizard-ai-enabled">
        <i aria-hidden="true" class="fas fa-magic"></i>
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
          <h4><i aria-hidden="true" class="fas fa-check-circle"></i> Gjenkjente kolonner</h4>
          <div class="wizard-auto-columns">
            ${recognizedColumns.map(col => `
              <div class="wizard-auto-column recognized ${col.source === 'ai' ? 'ai-mapped' : ''}">
                <span class="column-from">${escapeHtml(col.header)}</span>
                <i aria-hidden="true" class="fas fa-arrow-right"></i>
                <span class="column-to">${escapeHtml(col.mappedTo)}</span>
                ${col.source === 'ai' ? `
                  <span class="mapping-source ai" title="Mappet av AI med ${Math.round((col.confidence || 0) * 100)}% sikkerhet">
                    <i aria-hidden="true" class="fas fa-robot"></i>
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
          <h4><i aria-hidden="true" class="fas fa-plus-circle"></i> Nye felt som opprettes automatisk</h4>
          <div class="wizard-auto-columns">
            ${newFields.map(f => `
              <div class="wizard-auto-column new-field">
                <span class="column-from">"${escapeHtml(f.header)}"</span>
                <i aria-hidden="true" class="fas fa-arrow-right"></i>
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
          <h4><i aria-hidden="true" class="fas fa-table"></i> Forhåndsvisning</h4>
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
          <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
          <span>${stats.invalid} rader mangler påkrevd data og vil bli hoppet over</span>
        </div>
      ` : ''}
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="wizardImportBack()">
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-primary"
        onclick="wizardImportNext()"
        ${!areRequiredFieldsMapped() ? 'disabled title="Velg kolonner for kundenavn og adresse først"' : ''}>
        Forhåndsvis <i aria-hidden="true" class="fas fa-arrow-right"></i>
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
        <i aria-hidden="true" class="fas fa-plus-circle"></i>
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
                <select onchange="handleUnmappedColumn('${escapeJsString(col.header)}', this.value)">
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
        <h4><i aria-hidden="true" class="fas fa-tags"></i> Kategori-mapping</h4>
        <p>Følgende kategorier ble funnet i filen. Koble dem til eksisterende kategorier eller opprett nye.</p>
        <div class="wizard-category-list">
          ${categoryMatches.map(match => `
            <div class="wizard-category-row">
              <div class="wizard-category-original">
                <span class="category-label">Fra fil:</span>
                <span class="category-value">${escapeHtml(match.original)}</span>
                <span class="category-count">(${match.count} kunder)</span>
              </div>
              <div class="wizard-category-arrow"><i aria-hidden="true" class="fas fa-arrow-right"></i></div>
              <div class="wizard-category-select">
                <select data-original="${escapeHtml(match.original)}" onchange="updateWizardCategoryMapping('${escapeJsString(match.original)}', this.value)">
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
          <i aria-hidden="true" class="fas fa-file-alt"></i>
          <span class="stat-value">${stats.totalRows || 0}</span>
          <span class="stat-label">Totalt rader</span>
        </div>
        <div class="stat-item ${stats.validRows > 0 ? 'success' : ''}">
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <span class="stat-value">${stats.validRows || 0}</span>
          <span class="stat-label">Gyldige</span>
        </div>
        <div class="stat-item ${stats.warnings > 0 ? 'warning' : ''}">
          <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
          <span class="stat-value">${stats.warnings || 0}</span>
          <span class="stat-label">Advarsler</span>
        </div>
        <div class="stat-item ${stats.errors > 0 ? 'error' : ''}">
          <i aria-hidden="true" class="fas fa-times-circle"></i>
          <span class="stat-value">${stats.errors || 0}</span>
          <span class="stat-label">Feil</span>
        </div>
        <div class="stat-item ${stats.duplicates > 0 ? 'warning' : ''}">
          <i aria-hidden="true" class="fas fa-copy"></i>
          <span class="stat-value">${stats.duplicates || 0}</span>
          <span class="stat-label">Duplikater</span>
        </div>
      </div>

      ${features.updateEnabled || features.deletionDetectionEnabled ? `
        <!-- Re-import Preview Summary -->
        <div class="wizard-reimport-summary">
          <h4><i aria-hidden="true" class="fas fa-sync-alt"></i> Oppsummering av import</h4>
          <div class="wizard-reimport-stats">
            <div class="reimport-stat-item new">
              <i aria-hidden="true" class="fas fa-plus-circle"></i>
              <span class="stat-value">${reimportPreview.toCreate || 0}</span>
              <span class="stat-label">Nye kunder</span>
            </div>
            ${features.updateEnabled ? `
              <div class="reimport-stat-item update">
                <i aria-hidden="true" class="fas fa-edit"></i>
                <span class="stat-value">${reimportPreview.toUpdate || 0}</span>
                <span class="stat-label">Oppdateres</span>
              </div>
              <div class="reimport-stat-item unchanged">
                <i aria-hidden="true" class="fas fa-equals"></i>
                <span class="stat-value">${reimportPreview.unchanged || 0}</span>
                <span class="stat-label">Uendret</span>
              </div>
            ` : ''}
          </div>
          ${features.deletionDetectionEnabled && reimportPreview.notInImport && reimportPreview.notInImport.length > 0 ? `
            <div class="wizard-not-in-import-info">
              <i aria-hidden="true" class="fas fa-info-circle"></i>
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
          <h4><i aria-hidden="true" class="fas fa-table"></i> Forhåndsvisning (${preview.length} rader)</h4>
          <div class="wizard-preview-controls">
            <label class="wizard-toggle-label">
              <input type="checkbox" ${showBeforeAfter ? 'checked' : ''}
                onchange="wizardToggleBeforeAfter(this.checked)">
              <span>Vis transformasjoner</span>
            </label>
            <div class="wizard-selection-actions">
              <button class="wizard-btn wizard-btn-small" onclick="wizardSelectAllRows()">
                <i aria-hidden="true" class="fas fa-check-square"></i> Velg alle
              </button>
              <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDeselectAllRows()">
                <i aria-hidden="true" class="fas fa-square"></i> Velg ingen
              </button>
              <span class="wizard-selection-count" id="wizardSelectionCount">
                ${getSelectedRowCount()} av ${stats.validRows || 0} valgt
              </span>
            </div>
          </div>
        </div>
        <p class="wizard-edit-hint"><i aria-hidden="true" class="fas fa-info-circle"></i> Dobbeltklikk på en celle for å redigere</p>
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
                    ${wasTransformed ? `<span class="cell-before">${escapeHtml(rawVal)}</span> <i aria-hidden="true" class="fas fa-arrow-right cell-arrow"></i> <span class="cell-after">${escapeHtml(mappedVal)}</span>` : escapeHtml(displayValue || '-')}
                  </td>
                `;}).join('')}
                <td class="col-status">
                  ${!isSelected ? '<span class="status-excluded" title="Ikke valgt for import"><i aria-hidden="true" class="fas fa-minus-circle"></i></span>' :
                    row.hasError ? `<span class="status-error" title="${escapeHtml(row.errorMessage || 'Feil')}"><i aria-hidden="true" class="fas fa-times-circle"></i></span>` :
                    row.hasWarning ? `<span class="status-warning" title="${escapeHtml(row.warningMessage || 'Advarsel')}"><i aria-hidden="true" class="fas fa-exclamation-triangle"></i></span>` :
                    '<span class="status-ok"><i aria-hidden="true" class="fas fa-check-circle"></i></span>'}
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
            <i aria-hidden="true" class="fas fa-chevron-left"></i> Forrige
          </button>
          <span>Side ${validPreviewPage + 1} av ${previewTotalPages}</span>
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardPreviewTablePage(${validPreviewPage + 1})" ${validPreviewPage >= previewTotalPages - 1 ? 'disabled' : ''}>
            Neste <i aria-hidden="true" class="fas fa-chevron-right"></i>
          </button>
        </div>
      ` : ''}

      ${stats.errors > 0 ? `
        <div class="wizard-preview-warning">
          <i aria-hidden="true" class="fas fa-info-circle"></i>
          <p>${stats.errors} rad(er) har feil og vil ikke bli importert. Du kan redigere eller fjerne dem fra utvalget.</p>
        </div>
      ` : ''}

      ${renderErrorGrouping(preview)}

      ${data.qualityReport ? renderQualityReport(data.qualityReport) : ''}
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="wizardImportBack()">
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <div class="wizard-footer-right">
        ${wizardImportState.batchId ? `
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDownloadErrorReport()" title="Last ned feilrapport som CSV">
            <i aria-hidden="true" class="fas fa-download"></i> Feilrapport
          </button>
        ` : ''}
        <button class="wizard-btn wizard-btn-primary" onclick="wizardStartImport()" ${getSelectedValidRowCount() === 0 ? 'disabled' : ''}>
          <i aria-hidden="true" class="fas fa-file-import"></i> Importer ${getSelectedValidRowCount()} kunder
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
        <i aria-hidden="true" class="fas ${isSuccess ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
      </div>

      <h2>${isSuccess ? 'Import fullført!' : 'Import delvis fullført'}</h2>

      <div class="wizard-results-stats">
        ${results.createdCount > 0 ? `
          <div class="result-stat success">
            <i aria-hidden="true" class="fas fa-plus"></i>
            <span class="stat-value">${results.createdCount}</span>
            <span class="stat-label">Nye kunder opprettet</span>
          </div>
        ` : ''}
        ${results.updatedCount > 0 ? `
          <div class="result-stat info">
            <i aria-hidden="true" class="fas fa-sync-alt"></i>
            <span class="stat-value">${results.updatedCount}</span>
            <span class="stat-label">Eksisterende oppdatert</span>
          </div>
        ` : ''}
        ${!results.createdCount && !results.updatedCount ? `
          <div class="result-stat success">
            <i aria-hidden="true" class="fas fa-check"></i>
            <span class="stat-value">${results.importedCount || 0}</span>
            <span class="stat-label">Kunder importert</span>
          </div>
        ` : ''}
        ${results.skippedCount > 0 ? `
          <div class="result-stat warning">
            <i aria-hidden="true" class="fas fa-forward"></i>
            <span class="stat-value">${results.skippedCount}</span>
            <span class="stat-label">Hoppet over</span>
          </div>
        ` : ''}
        ${results.errorCount > 0 ? `
          <div class="result-stat error">
            <i aria-hidden="true" class="fas fa-times"></i>
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
          <h4><i aria-hidden="true" class="fas fa-exclamation-triangle"></i> Feil under import</h4>
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
          <i aria-hidden="true" class="fas fa-undo"></i> Angre import
        </button>
      ` : ''}
      ${results.errorCount > 0 ? `
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardReimportFailed()" title="Prøv å importere feilede rader på nytt">
          <i aria-hidden="true" class="fas fa-redo"></i> Reimporter feilede (${results.errorCount})
        </button>
      ` : ''}
      ${results.batchId ? `
        <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDownloadErrorReport()" title="Last ned feilrapport">
          <i aria-hidden="true" class="fas fa-download"></i> Feilrapport
        </button>
      ` : ''}
      ${standaloneImportMode ? `
        <button class="wizard-btn wizard-btn-primary" onclick="closeImportModal()">
          <i aria-hidden="true" class="fas fa-check"></i> Ferdig
        </button>
      ` : `
        <button class="wizard-btn wizard-btn-primary" onclick="wizardImportComplete()">
          Fortsett til neste steg <i aria-hidden="true" class="fas fa-arrow-right"></i>
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
function areAllRowsSelected(previewRows, startIdx = 0) {
  if (!previewRows || previewRows.length === 0) return false;

  for (let i = 0; i < previewRows.length; i++) {
    const globalIdx = previewRows[i]._originalIndex !== undefined ? previewRows[i]._originalIndex : (startIdx + i);
    if (!previewRows[i].hasError && !wizardImportState.selectedRows.has(globalIdx)) {
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
    importBtn.innerHTML = `<i aria-hidden="true" class="fas fa-file-import"></i> Importer ${count} kunder`;
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

  // Keyboard support for dropzone (WCAG 2.1.1)
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

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

  let phaseTimer1, phaseTimer2;
  try {
    // Upload file and get initial preview
    const formData = new FormData();
    formData.append('file', file);

    // Switch to parsing phase after a brief moment (track timers for cleanup)
    phaseTimer1 = setTimeout(() => {
      if (wizardImportState.isLoading) {
        wizardImportState.loadingPhase = 'parsing';
        updateWizardImportContent();
      }
    }, 500);

    // Switch to AI mapping phase after parsing starts
    phaseTimer2 = setTimeout(() => {
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

  const confirmed = await showConfirm('Er du sikker på at du vil angre hele importen? Alle opprettede kunder vil bli slettet.', 'Angre import');
  if (!confirmed) return;

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
      <h4><i aria-hidden="true" class="fas fa-layer-group"></i> Feilsammendrag</h4>
      <div class="error-group-list">
        ${groups.slice(0, 8).map(group => `
          <div class="error-group-item">
            <div class="error-group-info">
              <span class="error-group-field">${escapeHtml(group.field)}</span>
              <span class="error-group-message">${escapeHtml(group.message)}</span>
              <span class="error-group-count">${group.count} rader</span>
            </div>
            ${group.field === 'epost' && group.message.includes('skrivefeil') ? `
              <button class="wizard-btn wizard-btn-small" onclick="wizardFixAllSimilar('${escapeJsString(group.field)}', '${escapeJsString(group.message)}')">
                <i aria-hidden="true" class="fas fa-magic"></i> Fiks alle
              </button>
            ` : `
              <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDeselectErrorRows('${escapeJsString(group.field)}', '${escapeJsString(group.message)}')">
                <i aria-hidden="true" class="fas fa-minus-circle"></i> Fjern fra import
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
      <h4><i aria-hidden="true" class="fas fa-chart-bar"></i> Kvalitetsrapport</h4>
      <div class="quality-score-bar">
        <div class="quality-score-fill ${scoreColor}" style="width: ${report.overallScore}%"></div>
        <span class="quality-score-label">${report.overallScore}%</span>
      </div>
      ${report.suggestions && report.suggestions.length > 0 ? `
        <ul class="quality-suggestions">
          ${report.suggestions.map(s => `<li><i aria-hidden="true" class="fas fa-lightbulb"></i> ${escapeHtml(s)}</li>`).join('')}
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

      wizardRouteMap = new mapboxgl.Map({
        container: 'wizardRouteMap',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [lng, lat],
        zoom: 10,
        accessToken: mapboxgl.accessToken
      });

      if (data.route_start_lat) {
        wizardRouteMarker = new mapboxgl.Marker().setLngLat([lng, lat]).addTo(wizardRouteMap);
      }

      wizardRouteMap.on('click', (e) => {
        if (wizardRouteMarker) wizardRouteMarker.remove();
        wizardRouteMarker = new mapboxgl.Marker().setLngLat(e.lngLat).addTo(wizardRouteMap);
        onboardingWizard.data.company.route_start_lat = e.lngLat.lat;
        onboardingWizard.data.company.route_start_lng = e.lngLat.lng;
        document.getElementById('routeCoordinates').innerHTML =
          `<span>Valgt: ${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}</span>`;
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
      <i aria-hidden="true" class="fas fa-map-marker-alt"></i>
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
    if (wizardRouteMarker) wizardRouteMarker.remove();
    wizardRouteMarker = new mapboxgl.Marker().setLngLat([suggestion.lng, suggestion.lat]).addTo(wizardRouteMap);
    wizardRouteMap.flyTo({ center: [suggestion.lng, suggestion.lat], zoom: 14 });
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
      statusEl.innerHTML = '<i aria-hidden="true" class="fas fa-check"></i>';
      statusEl.classList.add('valid');
      break;
    case 'invalid':
      statusEl.innerHTML = '<i aria-hidden="true" class="fas fa-times"></i>';
      statusEl.classList.add('invalid');
      break;
    case 'loading':
      statusEl.innerHTML = '<i aria-hidden="true" class="fas fa-spinner fa-spin"></i>';
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

      wizardMainMap = new mapboxgl.Map({
        container: 'wizardMainMap',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [lng, lat],
        zoom: zoom,
        accessToken: mapboxgl.accessToken
      });

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
        if (wizardRouteMarker) wizardRouteMarker.remove();
        wizardRouteMarker = new mapboxgl.Marker().setLngLat([lng, lat]).addTo(wizardRouteMap);
        wizardRouteMap.flyTo({ center: [lng, lat], zoom: 14 });
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

// Render subcategory dropdowns (standalone, not tied to service types)
function renderSubcategoryDropdowns(customer = null) {
  const section = document.getElementById('subcategorySection');
  const container = document.getElementById('subcategoryDropdowns');
  if (!section || !container) return;

  const groups = allSubcategoryGroups || [];
  if (groups.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Get existing assignments for this customer
  const kundeId = customer?.id;
  const assignments = kundeId ? (kundeSubcatMap[kundeId] || []) : [];

  let html = '';
  groups.forEach(group => {
    if (!group.subcategories || group.subcategories.length === 0) return;

    const currentAssignment = assignments.find(a => a.group_id === group.id);
    const selectedSubId = currentAssignment?.subcategory_id || '';

    html += `
      <div class="form-group">
        <label for="subcat_group_${group.id}">${escapeHtml(group.navn)}</label>
        <select id="subcat_group_${group.id}" data-group-id="${group.id}" class="subcat-dropdown">
          <option value="">Ikke valgt</option>
          ${group.subcategories.map(sub =>
            `<option value="${sub.id}" ${sub.id === selectedSubId ? 'selected' : ''}>${escapeHtml(sub.navn)}</option>`
          ).join('')}
        </select>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Collect subcategory assignments from dropdowns
function collectSubcategoryAssignments() {
  const assignments = [];
  document.querySelectorAll('.subcat-dropdown').forEach(select => {
    const groupId = parseInt(select.dataset.groupId, 10);
    const subcatId = parseInt(select.value, 10);
    if (groupId && subcatId) {
      assignments.push({ group_id: groupId, subcategory_id: subcatId });
    }
  });
  return assignments;
}

// Populate dynamic dropdowns from ServiceTypeRegistry
function populateDynamicDropdowns(customer = null) {
  // Kategori checkboxes (multi-select)
  const kategoriContainer = document.getElementById('kategoriCheckboxes');
  if (kategoriContainer) {
    kategoriContainer.innerHTML = serviceTypeRegistry.renderCategoryCheckboxes(customer?.kategori || '');
    // Attach change handlers for control section visibility
    kategoriContainer.querySelectorAll('input[name="kategori"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const selected = serviceTypeRegistry.getSelectedCategories();
        updateControlSectionsVisibility(selected);
        renderSubcategoryDropdowns(customer);
      });
    });
  }

  // Render subcategory dropdowns for selected service type
  renderSubcategoryDropdowns(customer);

  // Intervaller (populeres alltid, også i MVP-modus)
  const elIntervallSelect = document.getElementById('el_kontroll_intervall');
  if (elIntervallSelect) {
    elIntervallSelect.innerHTML = serviceTypeRegistry.renderIntervalOptions(customer?.el_kontroll_intervall || 36);
  }

  const brannIntervallSelect = document.getElementById('brann_kontroll_intervall');
  if (brannIntervallSelect) {
    brannIntervallSelect.innerHTML = serviceTypeRegistry.renderIntervalOptions(customer?.brann_kontroll_intervall || 12);
  }

}

// Edit customer
function editCustomer(id) {
  const customer = customers.find(c => c.id === id);
  if (!customer) return;

  // Sett referanse til kunden som redigeres (brukes av renderDynamicServiceSections)
  _editingCustomer = customer;

  // Claim this customer (presence system)
  claimCustomer(id);

  // Reset address autocomplete state from previous session
  resetAddressAutocomplete();

  // Populate dynamic dropdowns first
  populateDynamicDropdowns(customer);

  document.getElementById('modalTitle').textContent = 'Rediger kunde';

  // Show presence warning if another user is working on this customer
  const existingBanner = document.getElementById('presenceWarningBanner');
  if (existingBanner) existingBanner.remove();
  const claim = presenceClaims.get(id);
  if (claim && claim.userId !== myUserId) {
    const banner = document.createElement('div');
    banner.id = 'presenceWarningBanner';
    banner.style.cssText = `background:${getPresenceColor(claim.userId)}18;border-left:3px solid ${getPresenceColor(claim.userId)};padding:8px 12px;margin-bottom:12px;border-radius:4px;font-size:13px;color:#333;`;
    banner.innerHTML = `<strong>${escapeHtml(claim.initials)}</strong> ${escapeHtml(claim.userName)} jobber med denne kunden`;
    const modalTitle = document.getElementById('modalTitle');
    modalTitle.parentNode.insertBefore(banner, modalTitle.nextSibling);
  }

  document.getElementById('customerId').value = customer.id;
  document.getElementById('navn').value = customer.navn || '';
  document.getElementById('adresse').value = customer.adresse || '';
  document.getElementById('postnummer').value = customer.postnummer || '';
  document.getElementById('poststed').value = customer.poststed || '';
  // Fyll org_nummer fra dedikert felt, eller fallback til [ORGNR:] tag i notater
  const orgNrValue = customer.org_nummer || (customer.notater && customer.notater.match(/\[ORGNR:(\d{9})\]/)?.[1]) || '';
  document.getElementById('org_nummer').value = orgNrValue;
  // Set estimated time (hours + minutes inputs)
  if (window.setEstimertTidFromMinutes) {
    window.setEstimertTidFromMinutes(customer.estimert_tid || 0);
  } else {
    document.getElementById('estimert_tid').value = customer.estimert_tid || '';
  }
  document.getElementById('telefon').value = customer.telefon || '';
  document.getElementById('epost').value = customer.epost || '';
  const trimDate = (v) => appConfig.datoModus === 'month_year' && v && v.length >= 7 ? v.substring(0, 7) : (v || '');
  document.getElementById('siste_kontroll').value = trimDate(customer.siste_kontroll);
  document.getElementById('neste_kontroll').value = trimDate(customer.neste_kontroll);
  document.getElementById('kontroll_intervall').value = customer.kontroll_intervall_mnd || 12;
  document.getElementById('notater').value = (customer.notater || '').replace(/\[ORGNR:\d{9}\]\s*/g, '').replace(/^\s*\|\s*/, '').trim();
  document.getElementById('lat').value = customer.lat ? Number(customer.lat).toFixed(6) : '';
  document.getElementById('lng').value = customer.lng ? Number(customer.lng).toFixed(6) : '';

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

  // Load subcategories for this customer
  loadKundeSubcategories(customer.id);

  // Load kontaktpersoner for this customer
  loadKontaktpersoner(customer.id);

  document.getElementById('deleteCustomerBtn').classList.remove('hidden');
  openModal(customerModal);

  // Highlight missing fields
  highlightMissingFields(customer);

  // Show integration buttons if relevant
  const integrationSection = document.getElementById('integrationActionsSection');
  const tripletexBtn = document.getElementById('pushToTripletexBtn');
  const ekkBtn = document.getElementById('createEkkReportBtn');
  let showIntegrationSection = false;

  if (tripletexBtn && appConfig.integrations?.tripletex?.active !== false) {
    const isLinked = customer.external_source === 'tripletex' && customer.external_id;
    document.getElementById('tripletexBtnLabel').textContent = isLinked ? 'Oppdater i Tripletex' : 'Opprett i Tripletex';
    tripletexBtn.classList.remove('hidden');
    showIntegrationSection = true;
  } else if (tripletexBtn) {
    tripletexBtn.classList.add('hidden');
  }

  if (ekkBtn && hasFeature('ekk_integration')) {
    ekkBtn.classList.remove('hidden');
    showIntegrationSection = true;
  } else if (ekkBtn) {
    ekkBtn.classList.add('hidden');
  }

  if (integrationSection) {
    integrationSection.classList.toggle('hidden', !showIntegrationSection);
  }
}

// Highlight fields that are missing data
function highlightMissingFields(customer) {
  // Remove previous highlights and aria-invalid
  document.querySelectorAll('.missing-field').forEach(el => {
    el.classList.remove('missing-field');
    el.removeAttribute('aria-invalid');
  });

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
      element.setAttribute('aria-invalid', 'true');
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
        injectDynamicMarkerStyles();
      }

      // Re-render category UI to reflect loaded categories
      renderFilterPanelCategories();
      renderSubcategoryFilter();
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


// Add new customer
async function addCustomer() {
  // Nullstill referanse til redigert kunde
  _editingCustomer = null;

  // Populate dynamic dropdowns first (with defaults)
  populateDynamicDropdowns(null);

  // Reset address autocomplete state from previous session
  resetAddressAutocomplete();

  document.getElementById('modalTitle').textContent = 'Ny kunde';
  customerForm.reset();
  document.getElementById('customerId').value = '';
  document.getElementById('kontroll_intervall').value = 12;
  // Clear estimated time
  if (window.setEstimertTidFromMinutes) {
    window.setEstimertTidFromMinutes(0);
  }
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

  // Tøm dynamiske service-seksjoner
  const dynContainer = document.getElementById('dynamicServiceSections');
  if (dynContainer) dynContainer.innerHTML = '';

  // Vis kontroll-seksjoner basert på valgt kategori (eller default)
  const selectedKategori = serviceTypeRegistry.getSelectedCategories() ||
    (isMvpMode() ? '' : serviceTypeRegistry.getDefaultServiceType().name);
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

  // Render subcategory dropdowns for new customer
  renderSubcategoryDropdowns(null);

  document.getElementById('deleteCustomerBtn').classList.add('hidden');
  openModal(customerModal);
}

// Referanse til kunden som redigeres (for å populere dynamiske seksjoner)
let _editingCustomer = null;

// Render dynamiske service-seksjoner basert på valgte kategorier
function renderDynamicServiceSections(customer = null) {
  const container = document.getElementById('dynamicServiceSections');
  if (!container) return;

  const selected = serviceTypeRegistry.getSelectedCategories();
  const selectedNames = selected ? selected.split(' + ').map(s => s.trim()).filter(Boolean) : [];

  if (selectedNames.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Lagre eksisterende verdier fra dynamiske seksjoner før re-render
  const savedValues = {};
  container.querySelectorAll('.service-section').forEach(section => {
    const slug = section.dataset.serviceSlug;
    if (!slug) return;
    const sisteInput = document.getElementById(`service_${slug}_siste`);
    const nesteInput = document.getElementById(`service_${slug}_neste`);
    const intervallSelect = document.getElementById(`service_${slug}_intervall`);
    const subtypeSelect = document.getElementById(`service_${slug}_subtype`);
    const equipmentSelect = document.getElementById(`service_${slug}_equipment`);
    savedValues[slug] = {
      siste: sisteInput?.value || '',
      neste: nesteInput?.value || '',
      intervall: intervallSelect?.value || '',
      subtype: subtypeSelect?.value || '',
      equipment: equipmentSelect?.value || ''
    };
  });

  // Render nye seksjoner kun for valgte kategorier
  const customerData = customer || _editingCustomer || {};
  container.innerHTML = serviceTypeRegistry.renderServiceSections(customerData, selectedNames);

  // Gjenopprett lagrede verdier for seksjoner som fortsatt finnes
  Object.entries(savedValues).forEach(([slug, vals]) => {
    const sisteInput = document.getElementById(`service_${slug}_siste`);
    const nesteInput = document.getElementById(`service_${slug}_neste`);
    const intervallSelect = document.getElementById(`service_${slug}_intervall`);
    const subtypeSelect = document.getElementById(`service_${slug}_subtype`);
    const equipmentSelect = document.getElementById(`service_${slug}_equipment`);
    if (sisteInput && vals.siste) sisteInput.value = vals.siste;
    if (nesteInput && vals.neste) nesteInput.value = vals.neste;
    if (intervallSelect && vals.intervall) intervallSelect.value = vals.intervall;
    if (subtypeSelect && vals.subtype) subtypeSelect.value = vals.subtype;
    if (equipmentSelect && vals.equipment) equipmentSelect.value = vals.equipment;
  });
}

// Vis/skjul kontroll-seksjoner basert på kategori og app mode
function updateControlSectionsVisibility(kategori) {
  const elSection = document.getElementById('elKontrollSection');
  const brannSection = document.getElementById('brannvarslingSection');
  const mvpSection = document.getElementById('mvpKontrollSection');
  const driftskategoriGroup = document.getElementById('driftskategori')?.closest('.form-group');

  // Skjul alle legacy-seksjoner — vi bruker dynamiske seksjoner i stedet
  if (elSection) elSection.style.display = 'none';
  if (brannSection) brannSection.style.display = 'none';
  if (mvpSection) mvpSection.style.display = 'none';
  if (driftskategoriGroup && isMvpMode()) driftskategoriGroup.style.display = 'none';

  // Render dynamiske dato-seksjoner per valgt kategori
  renderDynamicServiceSections();
}

// Auto-geocode address via backend proxy (Mapbox → Kartverket → Nominatim)
async function geocodeAddressAuto(adresse, postnummer, poststed) {
  const query = `${adresse || ''}, ${postnummer || ''} ${poststed || ''}`.trim();
  if (!query || query.length < 3) return null;

  // Try Kartverket directly first (fast)
  try {
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(query)}&fuzzy=true&treffPerSide=1`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const addr = data.adresser?.[0];
      if (addr?.representasjonspunkt) {
        return { lat: addr.representasjonspunkt.lat, lng: addr.representasjonspunkt.lon };
      }
    }
  } catch (error) {
    // Kartverket failed, fall through to backend
  }

  // Fallback to backend proxy (Mapbox → Kartverket)
  try {
    const response = await apiFetch('/api/geocode/forward', {
      method: 'POST',
      body: JSON.stringify({ query, limit: 1 })
    });
    if (response.ok) {
      const result = await response.json();
      const suggestion = result.data?.suggestions?.[0];
      if (suggestion) {
        return { lat: suggestion.lat, lng: suggestion.lng };
      }
    }
  } catch (error) {
    Logger.log('Geocode auto failed:', error);
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
      document.getElementById('lat').value = lat.toFixed(6);
      document.getElementById('lng').value = lng.toFixed(6);
    }
  }


  // Bruk kategori-checkboxes for alle (MVP + Full)
  let kategori = serviceTypeRegistry.getSelectedCategories() || null;

  // Finn valgte kategori-slugs for å nullstille datoer for avhukede kategorier
  const selectedNames = (kategori || '').split(' + ').map(s => s.trim()).filter(Boolean);
  const allServiceTypes = serviceTypeRegistry.getAll();
  const selectedSlugs = selectedNames.map(name => {
    const st = allServiceTypes.find(s => s.name === name);
    return st?.slug;
  }).filter(Boolean);

  const hasEl = selectedSlugs.includes('el-kontroll');
  const hasBrann = selectedSlugs.includes('brannvarsling');

  // Parse services FØR vi leser legacy-felt, fordi parseServiceFormData()
  // kopierer datoer til legacy-feltene for default-kategorien (id=0)
  const parsedServices = serviceTypeRegistry.parseServiceFormData();

  const data = {
    navn: document.getElementById('navn').value,
    adresse: adresse,
    postnummer: postnummer,
    poststed: poststed,
    telefon: document.getElementById('telefon').value,
    epost: document.getElementById('epost').value,
    org_nummer: document.getElementById('org_nummer').value || null,
    estimert_tid: Number.parseInt(document.getElementById('estimert_tid').value) || null,
    lat: lat,
    lng: lng,
    // Legacy date fields: prefer form value, fallback to existing customer data (hidden inputs may be empty)
    siste_kontroll: normalizeDateValue(document.getElementById('siste_kontroll').value) || (_editingCustomer?.siste_kontroll || null),
    neste_kontroll: normalizeDateValue(document.getElementById('neste_kontroll').value) || (_editingCustomer?.neste_kontroll || null),
    kontroll_intervall_mnd: Number.parseInt(document.getElementById('kontroll_intervall').value) || (_editingCustomer?.kontroll_intervall_mnd || 12),
    kategori: kategori,
    notater: (document.getElementById('notater').value || '').replace(/\[ORGNR:\d{9}\]\s*/g, '').trim(),
    // Separate El-Kontroll felt — null ut hvis el-kontroll ikke er valgt, bevar eksisterende verdier
    siste_el_kontroll: hasEl ? (normalizeDateValue(document.getElementById('siste_el_kontroll').value) || (_editingCustomer?.siste_el_kontroll || null)) : null,
    neste_el_kontroll: hasEl ? (normalizeDateValue(document.getElementById('neste_el_kontroll').value) || (_editingCustomer?.neste_el_kontroll || null)) : null,
    el_kontroll_intervall: hasEl ? (Number.parseInt(document.getElementById('el_kontroll_intervall').value) || (_editingCustomer?.el_kontroll_intervall || 36)) : null,
    // Separate Brannvarsling felt — null ut hvis brannvarsling ikke er valgt, bevar eksisterende verdier
    siste_brann_kontroll: hasBrann ? (normalizeDateValue(document.getElementById('siste_brann_kontroll').value) || (_editingCustomer?.siste_brann_kontroll || null)) : null,
    neste_brann_kontroll: hasBrann ? (normalizeDateValue(document.getElementById('neste_brann_kontroll').value) || (_editingCustomer?.neste_brann_kontroll || null)) : null,
    brann_kontroll_intervall: hasBrann ? (Number.parseInt(document.getElementById('brann_kontroll_intervall').value) || (_editingCustomer?.brann_kontroll_intervall || 12)) : null,
    // Dynamiske tjeneste-datoer fra dynamiske seksjoner
    services: parsedServices,
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
      const validationErrors = result.error?.details?.errors;
      const errorMsg = Array.isArray(validationErrors)
        ? validationErrors.map(e => e.message).join(', ')
        : (result.error?.message || (typeof result.error === 'string' ? result.error : null) || 'Ukjent feil');
      showMessage('Kunne ikke lagre: ' + errorMsg, 'error');
      return;
    }

    const kundeData = result.data || result;
    const savedCustomerId = customerId || kundeData.id;

    // Close modal and show notification immediately — don't block on secondary saves
    releaseCustomer(currentClaimedKundeId);
    customerModal.classList.add('hidden');
    showNotification('Kunde lagret!');

    // Fire secondary saves and data reload in parallel (non-blocking for UX)
    const secondarySaves = [];
    if (savedCustomerId) {
      const subcatAssignments = collectSubcategoryAssignments();
      secondarySaves.push(
        apiFetch(`/api/subcategories/kunde/${savedCustomerId}`, {
          method: 'PUT',
          body: JSON.stringify({ assignments: subcatAssignments })
        }).catch(err => console.error('Error saving subcategory assignments:', err))
      );
      secondarySaves.push(
        saveCustomerEmailSettings(savedCustomerId).catch(err => console.error('Error saving email settings:', err))
      );
    }
    await Promise.all(secondarySaves);

    // Reset filter to show all customers so the new/updated one is visible
    currentFilter = 'alle';
    showOnlyWarnings = false;
    const omradeSelect = document.getElementById('omradeSelect');
    if (omradeSelect) omradeSelect.value = 'alle';

    // Reload data in parallel
    await Promise.all([loadCustomers(), loadOmrader()]);

    // Refresh open popup with updated customer data
    if (savedCustomerId) {
      const updatedCustomer = customers.find(c => c.id === Number(savedCustomerId));
      if (updatedCustomer && updatedCustomer.lat && updatedCustomer.lng) {
        showMapPopup(
          [updatedCustomer.lng, updatedCustomer.lat],
          generatePopupContent(updatedCustomer),
          { maxWidth: '350px', offset: [0, -35] }
        );
      }
    }
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
    releaseCustomer(currentClaimedKundeId);
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
    document.getElementById('lat').value = result.lat.toFixed(6);
    document.getElementById('lng').value = result.lng.toFixed(6);
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
  pickingIndicator.innerHTML = '<i aria-hidden="true" class="fas fa-crosshairs"></i> Klikk på kartet for å velge posisjon';
  document.body.appendChild(pickingIndicator);

  // Add click handler to map
  map.once('click', handleMapPick);

  // Allow escape to cancel
  document.addEventListener('keydown', handlePickingEscape);
}

async function handleMapPick(e) {
  const lat = e.lngLat.lat;
  const lng = e.lngLat.lng;

  // Update form fields
  document.getElementById('lat').value = lat.toFixed(6);
  document.getElementById('lng').value = lng.toFixed(6);

  // Update quality badge
  updateGeocodeQualityBadge('manual');

  // Clean up and show modal again
  disableCoordinatePicking();
  const customerModal = document.getElementById('customerModal');
  openModal(customerModal);

  // Reverse geocode to fill address fields
  try {
    const response = await apiFetch('/api/geocode/reverse', {
      method: 'POST',
      body: JSON.stringify({ lat, lng })
    });
    if (response.ok) {
      const result = await response.json();
      const addr = result.data;
      if (addr) {
        const adresseInput = document.getElementById('adresse');
        const postnummerInput = document.getElementById('postnummer');
        const poststedInput = document.getElementById('poststed');

        if (adresseInput && addr.address && !adresseInput.value) {
          adresseInput.value = addr.address;
        }
        if (postnummerInput && addr.postnummer && !postnummerInput.value) {
          postnummerInput.value = addr.postnummer;
        }
        if (poststedInput && addr.poststed && !poststedInput.value) {
          poststedInput.value = addr.poststed;
          poststedInput.classList.add('auto-filled');
        }
        showNotification(`Adresse funnet: ${escapeHtml(addr.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`)}`, 'success');
      } else {
        showNotification(`Koordinater valgt: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
      }
    } else {
      showNotification(`Koordinater valgt: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
    }
  } catch (err) {
    Logger.log('Reverse geocode failed:', err);
    showNotification(`Koordinater valgt: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
  }
}

function handlePickingEscape(e) {
  if (e.key === 'Escape' && isPickingCoordinates) {
    disableCoordinatePicking();
    // Show modal again
    const customerModal = document.getElementById('customerModal');
    openModal(customerModal);
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

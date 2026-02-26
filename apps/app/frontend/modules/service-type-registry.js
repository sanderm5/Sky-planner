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
          color: st.color || '#5E81AC',
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
        color: '#5E81AC',
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
      if (!response.ok) return false;
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
              color: st.color || '#5E81AC',
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
      color: '#5E81AC'
    };
  }

  /**
   * Generate icon HTML for a service type
   */
  getIcon(slugOrServiceType) {
    const st = typeof slugOrServiceType === 'string'
      ? this.getBySlug(slugOrServiceType)
      : slugOrServiceType;
    if (!st) return '<i aria-hidden="true" class="fas fa-wrench"></i>';
    return `<i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i>`;
  }

  /**
   * Format interval as label
   */
  formatInterval(value) {
    const interval = this.intervals.find(i => i.months === value);
    if (interval?.label) return interval.label;
    // Negative values = days (for weekly intervals)
    if (value < 0) {
      const days = Math.abs(value);
      if (days === 7) return '1 uke';
      if (days % 7 === 0) return `${days / 7} uker`;
      return `${days} dager`;
    }
    if (value < 12) return `${value} mnd`;
    if (value === 12) return '1 år';
    if (value % 12 === 0) return `${value / 12} år`;
    return `${value} mnd`;
  }

  /**
   * Get available intervals for dropdowns
   * Negative values = days (e.g. -7 = weekly, -14 = biweekly)
   * Positive values = months
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
      { value: -7, label: '1 uke', isDefault: false },
      { value: -14, label: '2 uker', isDefault: false },
      { value: 1, label: '1 mnd', isDefault: false },
      { value: 3, label: '3 mnd', isDefault: false },
      { value: 6, label: '6 mnd', isDefault: false },
      { value: 12, label: '1 år', isDefault: true },
      { value: 24, label: '2 år', isDefault: false },
      { value: 36, label: '3 år', isDefault: false },
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

    // Add combined tab for all categories
    if (serviceTypes.length >= 2) {
      const combinedName = serviceTypes.map(st => st.name).join(' + ');
      const combinedLabel = serviceTypes.length > 2 ? 'Alle' : 'Begge';
      const isActive = activeCategory === combinedName || activeCategory === 'El-Kontroll + Brannvarsling';
      html += `<button class="kategori-tab ${isActive ? 'active' : ''}" data-kategori="${combinedName}">
        ${serviceTypes.map(st => this.getIcon(st)).join('')} ${combinedLabel}
      </button>`;
    }

    return html;
  }

  /**
   * Generate category checkbox HTML (multi-select)
   */
  renderCategoryCheckboxes(selectedValue = '') {
    const serviceTypes = this.getAll();
    const selectedNames = selectedValue.split(' + ').map(s => s.trim()).filter(Boolean);
    const selectedNamesLower = selectedNames.map(s => s.toLowerCase());
    let html = '';

    serviceTypes.forEach(st => {
      // Match by name or slug (case-insensitive)
      const nameMatch = selectedNamesLower.includes(st.name.toLowerCase()) || selectedNamesLower.includes(st.slug.toLowerCase());
      // Auto-check if only one service type and customer has any category
      const autoCheck = serviceTypes.length === 1 && selectedNames.length > 0;
      const checked = nameMatch || autoCheck ? 'checked' : '';
      html += `
        <label class="kategori-checkbox-label">
          <input type="checkbox" name="kategori" value="${escapeHtml(st.name)}" ${checked}>
          <i aria-hidden="true" class="fas ${st.icon || 'fa-clipboard-check'}" style="color:${st.color || '#3B82F6'}"></i>
          ${escapeHtml(st.name)}
        </label>`;
    });

    return html;
  }

  /**
   * Get selected categories from checkboxes as " + " joined string
   */
  getSelectedCategories() {
    const checkboxes = document.querySelectorAll('#kategoriCheckboxes input[name="kategori"]:checked');
    return Array.from(checkboxes).map(cb => cb.value).join(' + ');
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
    if (!kategori) return false;
    const kundeKats = kategori.split(' + ').map(s => s.trim());

    // Direct match with service type slug or name
    const st = this.getBySlug(categoryFilter);
    if (st) {
      return kundeKats.includes(st.name);
    }

    // Combined filter (e.g. "El-Kontroll + Brannvarsling") — customer must have ALL
    const filterKats = categoryFilter.split(' + ').map(s => s.trim());
    if (filterKats.length > 1) {
      return filterKats.every(fk => kundeKats.includes(fk));
    }

    // Direct name match
    return kundeKats.includes(categoryFilter);
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
      return `<i aria-hidden="true" class="fas ${st.icon}"></i>`;
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

  // renderDriftsOptions() removed — migrated to subcategory system (migration 044)

  /**
   * Render dynamic service sections for customer modal
   * @param {Object} customer - Customer object with optional services array
   * @param {Array<string>} selectedNames - Optional filter: only render sections for these category names
   * @returns {string} HTML for all service sections
   */
  renderServiceSections(customer = {}, selectedNames = null) {
    let serviceTypes = this.getAll();
    if (serviceTypes.length === 0) return '';

    // Filter to only selected categories if specified
    if (selectedNames && selectedNames.length > 0) {
      serviceTypes = serviceTypes.filter(st => selectedNames.includes(st.name));
    }
    if (serviceTypes.length === 0) return '';

    const services = customer.services || [];
    let html = '';

    serviceTypes.forEach(st => {
      // Find existing service data for this type
      let serviceData = services.find(s =>
        s.service_type_slug === st.slug || s.service_type_id === st.id
      ) || {};

      // Fallback to legacy columns if no dynamic service data
      if (!serviceData.siste_kontroll && !serviceData.neste_kontroll) {
        if (st.slug === 'el-kontroll' && (customer.siste_el_kontroll || customer.neste_el_kontroll)) {
          serviceData = {
            ...serviceData,
            siste_kontroll: customer.siste_el_kontroll || '',
            neste_kontroll: customer.neste_el_kontroll || '',
            intervall_months: customer.el_kontroll_intervall || st.defaultInterval
          };
        } else if (st.slug === 'brannvarsling' && (customer.siste_brann_kontroll || customer.neste_brann_kontroll)) {
          serviceData = {
            ...serviceData,
            siste_kontroll: customer.siste_brann_kontroll || '',
            neste_kontroll: customer.neste_brann_kontroll || '',
            intervall_months: customer.brann_kontroll_intervall || st.defaultInterval
          };
        } else if (customer.siste_kontroll || customer.neste_kontroll) {
          serviceData = {
            ...serviceData,
            siste_kontroll: customer.siste_kontroll || '',
            neste_kontroll: customer.neste_kontroll || '',
            intervall_months: customer.kontroll_intervall_mnd || st.defaultInterval
          };
        }
      }

      const hasSubtypes = st.subtypes && st.subtypes.length > 0;
      const hasEquipment = st.equipmentTypes && st.equipmentTypes.length > 0;

      html += `
        <div class="control-section service-section" data-service-slug="${st.slug}" data-service-id="${st.id}">
          <div class="control-section-header">
            <i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i> ${st.name}
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

      // Fallback service type (id=0) has no real DB row — writing to
      // customer_services would violate the foreign key constraint.
      // Instead, copy dates to the legacy form fields so they get saved
      // on the main customer record.
      if (!st.id || st.id === 0) {
        const legacySiste = document.getElementById('siste_kontroll');
        const legacyNeste = document.getElementById('neste_kontroll');
        const legacyIntervall = document.getElementById('kontroll_intervall');
        if (legacySiste) legacySiste.value = siste || '';
        if (legacyNeste) legacyNeste.value = neste || '';
        if (legacyIntervall && intervall) legacyIntervall.value = intervall;
        return;
      }

      // Always include rendered service sections (even without dates)
      // Null dates = "service type selected but no dates set yet"
      services.push({
        service_type_id: st.id,
        service_type_slug: st.slug,
        siste_kontroll: siste,
        neste_kontroll: neste,
        intervall_months: intervall,
        subtype_name: subtype,
        equipment_name: equipment
      });
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
      // Filter service types based on customer's kategori
      if (serviceTypes.length >= 2) {
        const kundeKats = kategori ? kategori.split(' + ').map(s => s.trim()) : [];
        const relevantTypes = kundeKats.length > 0
          ? serviceTypes.filter(st => kundeKats.includes(st.name))
          : serviceTypes;
        const typesToShow = relevantTypes.length > 0 ? relevantTypes : serviceTypes;

        // If only one type matches, use simple single-type view
        if (typesToShow.length === 1) {
          const st = typesToShow[0];
          let nesteKontroll = null;
          let sisteKontroll = null;

          const serviceData = (customer.services || []).find(s =>
            s.service_type_slug === st.slug || s.service_type_id === st.id
          );
          if (serviceData) {
            nesteKontroll = serviceData.neste_kontroll;
            sisteKontroll = serviceData.siste_kontroll;
          }
          if (st.slug === 'el-kontroll') {
            if (!nesteKontroll) nesteKontroll = customer.neste_el_kontroll;
            if (!sisteKontroll) sisteKontroll = customer.siste_el_kontroll;
          } else if (st.slug === 'brannvarsling') {
            if (!nesteKontroll) nesteKontroll = customer.neste_brann_kontroll;
            if (!sisteKontroll) sisteKontroll = customer.siste_brann_kontroll;
          }
          if (!nesteKontroll) nesteKontroll = customer.neste_kontroll;
          if (!sisteKontroll) sisteKontroll = customer.siste_kontroll || customer.last_visit_date;

          return `
            <div class="popup-control-info">
              <p class="popup-status ${controlStatus.class}">
                <strong><i aria-hidden="true" class="fas ${st.icon || 'fa-clipboard-check'}" style="color:${st.color || '#3B82F6'};display:inline-block;width:14px;text-align:center;"></i> Neste kontroll:</strong>
                <span class="control-days">${nesteKontroll ? formatDate(nesteKontroll) : '<span style="color:#5E81AC;">Ikke satt</span>'}</span>
              </p>
              ${sisteKontroll ? `<p style="font-size: 11px; color: var(--color-text-muted, #b3b3b3); margin-top: 4px;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
            </div>`;
        }

        let html = '<div class="popup-control-info">';
        typesToShow.forEach(st => {
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

          html += `
            <div style="margin-bottom:8px;">
              <p style="margin:0;">
                <strong><i aria-hidden="true" class="fas ${st.icon || 'fa-clipboard-check'}" style="color:${st.color || '#3B82F6'};"></i> ${escapeHtml(st.name)}:</strong>
              </p>
              <p style="margin:2px 0 0 20px;font-size:13px;">Neste: ${nesteKontroll ? formatDate(nesteKontroll) : '<span style="color:#5E81AC;">Ikke satt</span>'}</p>
              ${sisteKontroll ? `<p style="margin:2px 0 0 20px;font-size:11px;color:var(--color-text-muted, #b3b3b3);">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
            </div>`;
        });
        html += '</div>';
        return html;
      }

      // Single service type - simple view
      const st = serviceTypes[0];
      let nesteKontroll = null;
      let sisteKontroll = null;

      const serviceData = (customer.services || []).find(s =>
        s.service_type_slug === st.slug || s.service_type_id === st.id
      );
      if (serviceData) {
        nesteKontroll = serviceData.neste_kontroll;
        sisteKontroll = serviceData.siste_kontroll;
      }
      if (st.slug === 'el-kontroll') {
        if (!nesteKontroll) nesteKontroll = customer.neste_el_kontroll;
        if (!sisteKontroll) sisteKontroll = customer.siste_el_kontroll;
      } else if (st.slug === 'brannvarsling') {
        if (!nesteKontroll) nesteKontroll = customer.neste_brann_kontroll;
        if (!sisteKontroll) sisteKontroll = customer.siste_brann_kontroll;
      }
      if (!nesteKontroll) nesteKontroll = customer.neste_kontroll;
      if (!sisteKontroll) sisteKontroll = customer.siste_kontroll || customer.last_visit_date;

      return `
        <div class="popup-control-info">
          <p class="popup-status ${controlStatus.class}">
            <strong><i aria-hidden="true" class="fas ${st.icon || 'fa-clipboard-check'}" style="color:${st.color || '#3B82F6'};display:inline-block;width:14px;text-align:center;"></i> Neste kontroll:</strong>
            <span class="control-days">${nesteKontroll ? formatDate(nesteKontroll) : '<span style="color:#5E81AC;">Ikke satt</span>'}</span>
          </p>
          ${sisteKontroll ? `<p style="font-size: 11px; color: var(--color-text-muted, #b3b3b3); margin-top: 4px;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
        </div>`;
    }

    const isCombined = kategori.includes('+');

    if (isCombined && serviceTypes.length >= 2) {
      // Filter service types to only those in the customer's kategori
      const kundeKats = kategori.split(' + ').map(s => s.trim());
      const relevantTypes = serviceTypes.filter(st => kundeKats.includes(st.name));
      const typesToShow = relevantTypes.length > 0 ? relevantTypes : serviceTypes;

      let html = '<div class="popup-controls">';
      typesToShow.forEach(st => {
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
          <p><strong><i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color};"></i> ${st.name}:</strong></p>
          <p style="margin-left: 20px;">Neste: ${nesteKontroll ? escapeHtml(nesteKontroll) : 'Ikke satt'}</p>
          ${sisteKontroll ? `<p style="margin-left: 20px; font-size: 11px; color: var(--color-text-muted, #b3b3b3);">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
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
          <strong><i aria-hidden="true" class="fas ${matchedSt.icon}" style="color: ${matchedSt.color};"></i> Neste kontroll:</strong>
          <span class="control-days">${escapeHtml(controlStatus.label)}</span>
        </p>
        ${sisteKontroll ? `<p style="font-size: 11px; color: var(--color-text-muted, #b3b3b3); margin-top: 4px;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
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
    const service = (customer.services || []).find(s =>
      s.service_type_id === serviceType.id || s.service_type_slug === serviceType.slug
    );
    if (service?.subtype_name) return service.subtype_name;

    const customData = this.parseCustomData(customer.custom_data);
    return customData[`${serviceType.slug}_subtype`] || null;
  }

  getCustomerEquipmentValue(customer, serviceType) {
    const service = (customer.services || []).find(s =>
      s.service_type_id === serviceType.id || s.service_type_slug === serviceType.slug
    );
    if (service?.equipment_name) return service.equipment_name;

    const customData = this.parseCustomData(customer.custom_data);
    return customData[`${serviceType.slug}_equipment`] || null;
  }

  // renderPopupIndustryFields() removed — replaced by renderPopupSubcategories() in map-core.js
}

// Global service type registry instance
const serviceTypeRegistry = new ServiceTypeRegistry();

// Update control section headers dynamically based on service types
function updateControlSectionHeaders() {
  const elService = serviceTypeRegistry.getBySlug('el-kontroll');
  const brannService = serviceTypeRegistry.getBySlug('brannvarsling');

  const elHeader = document.querySelector('#elKontrollSection .control-section-header');
  if (elHeader && elService) {
    elHeader.innerHTML = `<i aria-hidden="true" class="fas ${escapeHtml(elService.icon)}" style="color: ${escapeHtml(elService.color)}"></i> ${escapeHtml(elService.name)}`;
  }

  const brannHeader = document.querySelector('#brannvarslingSection .control-section-header');
  if (brannHeader && brannService) {
    brannHeader.innerHTML = `<i aria-hidden="true" class="fas ${escapeHtml(brannService.icon)}" style="color: ${escapeHtml(brannService.color)}"></i> ${escapeHtml(brannService.name)}`;
  }
}


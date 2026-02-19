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

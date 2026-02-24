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
        ${icons} ${serviceTypes.length > 2 ? 'Alle' : 'Begge'}
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

// Legacy filter functions (normalizeDriftstype, renderDriftskategoriFilter,
// normalizeBrannsystem, renderBrannsystemFilter, renderElTypeFilter, etc.)
// removed — migrated to subcategory system (migration 044).
// All filtering now handled by renderSubcategoryFilter() below.

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

      // Apply filter
      applyFilters();
    });
  });
}

// ========================================
// SUBCATEGORY FILTER
// ========================================

/**
 * Render subcategory filter buttons grouped by service type and subcategory group
 */
/**
 * Render subcategory section: filter buttons + inline management.
 * Always visible when organization has service types.
 */
let subcatAdminMode = false;
let collapsedSubcatGroups = (() => {
  try {
    const saved = localStorage.getItem('skyplanner_subcatCollapsed');
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
})();

function renderSubcategoryFilter() {
  const contentEl = document.getElementById('subcategoryFilterContent');
  const filterContainer = document.getElementById('subcategoryFilter');
  if (!contentEl || !filterContainer) return;

  const groups = allSubcategoryGroups || [];

  if (groups.length === 0) {
    // Still show filter container with add-group input for admins
    filterContainer.style.display = 'block';
    contentEl.innerHTML = `<div class="subcat-add-row subcat-add-group-row">
      <input type="text" class="subcat-add-input" placeholder="Ny gruppe..." maxlength="100" data-add-group-input>
      <button class="subcat-add-btn subcat-add-group-btn" data-action="addGroup" title="Legg til gruppe"><i class="fas fa-plus"></i> Gruppe</button>
    </div>`;
    attachSubcategoryHandlers();
    return;
  }

  filterContainer.style.display = 'block';

  // Sync admin toggle button state
  const toggleBtn = document.getElementById('subcatAdminToggle');
  if (toggleBtn) toggleBtn.classList.toggle('active', subcatAdminMode);

  // Count customers per subcategory
  const subcatCounts = {};
  Object.values(kundeSubcatMap).forEach(assignments => {
    assignments.forEach(a => {
      const key = `${a.group_id}_${a.subcategory_id}`;
      subcatCounts[key] = (subcatCounts[key] || 0) + 1;
    });
  });

  // Initialize collapsed state: default all groups to collapsed on first render
  if (!collapsedSubcatGroups) {
    collapsedSubcatGroups = {};
    groups.forEach(g => { collapsedSubcatGroups[g.id] = true; });
    try { localStorage.setItem('skyplanner_subcatCollapsed', JSON.stringify(collapsedSubcatGroups)); } catch {}
  }

  let html = '';

  groups.forEach(group => {
    const subs = group.subcategories || [];
    const activeSubcatId = selectedSubcategories[group.id];
    // Default new groups to collapsed
    const isCollapsed = collapsedSubcatGroups[group.id] !== false;
    const activeSub = activeSubcatId ? subs.find(s => s.id === activeSubcatId) : null;

    // Group heading (clickable for collapse)
    html += `<div class="subcat-group ${isCollapsed ? 'subcat-group-collapsed' : ''}">
      <div class="subcat-group-header">
        <span class="subcat-group-name" data-toggle-group="${group.id}">
          <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'} subcat-chevron"></i>
          ${escapeHtml(group.navn)}
          ${isCollapsed && activeSub ? `<span class="subcat-active-indicator">${escapeHtml(activeSub.navn)}</span>` : ''}
        </span>
        <span class="subcat-admin-only">
          <button class="category-manage-btn" data-action="editGroup" data-group-id="${group.id}" data-group-navn="${escapeHtml(group.navn)}" title="Rediger"><i class="fas fa-pen"></i></button>
          <button class="category-manage-btn subcat-delete-btn" data-action="deleteGroup" data-group-id="${group.id}" data-group-navn="${escapeHtml(group.navn)}" title="Slett"><i class="fas fa-trash"></i></button>
        </span>
      </div>`;

    // Filter buttons (hidden when collapsed)
    html += `<div class="subcat-group-body">`;
    if (subs.length > 0) {
      html += `<div class="category-filter-buttons subcat-filter-buttons">`;
      html += `<button class="category-btn subcat-btn ${!activeSubcatId ? 'active' : ''}" data-group-id="${group.id}" data-subcat-id="all">Alle</button>`;
      subs.forEach(sub => {
        const count = subcatCounts[`${group.id}_${sub.id}`] || 0;
        const isActive = activeSubcatId === sub.id;
        html += `<span class="subcat-btn-wrapper">
          <button class="category-btn subcat-btn ${isActive ? 'active' : ''}" data-group-id="${group.id}" data-subcat-id="${sub.id}">
            ${escapeHtml(sub.navn)} <span class="subcat-count">${count}</span>
          </button>
          <span class="subcat-admin-only subcat-item-actions">
            <button class="category-manage-btn" data-action="editSubcat" data-subcat-id="${sub.id}" data-subcat-navn="${escapeHtml(sub.navn)}" title="Rediger"><i class="fas fa-pen"></i></button>
            <button class="category-manage-btn subcat-delete-btn" data-action="deleteSubcat" data-subcat-id="${sub.id}" data-subcat-navn="${escapeHtml(sub.navn)}" title="Slett"><i class="fas fa-trash"></i></button>
          </span>
        </span>`;
      });
      html += `</div>`;
    }

    // Add subcategory input (admin only)
    html += `<div class="subcat-add-row subcat-admin-only">
      <input type="text" class="subcat-add-input" placeholder="Ny underkategori..." maxlength="100" data-add-subcat-input data-group-id="${group.id}">
      <button class="subcat-add-btn" data-action="addSubcat" data-group-id="${group.id}" title="Legg til"><i class="fas fa-plus"></i></button>
    </div>`;

    html += `</div>`; // close subcat-group-body
    html += `</div>`; // close subcat-group
  });

  // Add group input (admin only)
  html += `<div class="subcat-add-row subcat-add-group-row subcat-admin-only">
    <input type="text" class="subcat-add-input" placeholder="Ny gruppe..." maxlength="100" data-add-group-input>
    <button class="subcat-add-btn subcat-add-group-btn" data-action="addGroup" title="Legg til gruppe"><i class="fas fa-plus"></i> Gruppe</button>
  </div>`;

  contentEl.innerHTML = html;
  contentEl.classList.toggle('subcat-admin-active', subcatAdminMode);
  attachSubcategoryHandlers();
}

/**
 * Attach click handlers for subcategory filter buttons and CRUD actions
 */
function attachSubcategoryHandlers() {
  const contentEl = document.getElementById('subcategoryFilterContent');
  if (!contentEl) return;

  // Admin toggle button (outside contentEl — attach once globally)
  const adminToggle = document.getElementById('subcatAdminToggle');
  if (adminToggle && !adminToggle.dataset.handlerAttached) {
    adminToggle.dataset.handlerAttached = 'true';
    adminToggle.addEventListener('click', () => {
      subcatAdminMode = !subcatAdminMode;
      adminToggle.classList.toggle('active', subcatAdminMode);
      contentEl.classList.toggle('subcat-admin-active', subcatAdminMode);
    });
  }

  // All handlers via delegation (only attach once)
  if (contentEl.dataset.subcatHandlersAttached) return;
  contentEl.dataset.subcatHandlersAttached = 'true';

  contentEl.addEventListener('click', async (e) => {
    // Collapse/expand group toggle
    const groupToggle = e.target.closest('[data-toggle-group]');
    if (groupToggle) {
      const groupId = parseInt(groupToggle.dataset.toggleGroup, 10);
      // Toggle: if currently collapsed (true or undefined), open it (false); if open (false), collapse it (true)
      collapsedSubcatGroups[groupId] = collapsedSubcatGroups[groupId] === false;
      try { localStorage.setItem('skyplanner_subcatCollapsed', JSON.stringify(collapsedSubcatGroups)); } catch {}
      renderSubcategoryFilter();
      return;
    }

    // Filter button clicks
    const filterBtn = e.target.closest('.subcat-btn');
    if (filterBtn) {
      const groupId = parseInt(filterBtn.dataset.groupId, 10);
      const subcatId = filterBtn.dataset.subcatId;
      if (subcatId === 'all') {
        delete selectedSubcategories[groupId];
      } else {
        selectedSubcategories[groupId] = parseInt(subcatId, 10);
      }
      renderSubcategoryFilter();
      applyFilters();
      return;
    }

    // CRUD action buttons
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;

    if (action === 'addGroup') {
      const input = contentEl.querySelector('input[data-add-group-input]');
      const navn = input?.value?.trim();
      if (!navn) { input?.focus(); return; }
      btn.disabled = true;
      try {
        const res = await apiFetch('/api/subcategories/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ navn })
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'Feil'); }
        const json = await res.json();
        subcatRegistryAddGroup(json.data || { id: Date.now(), navn });
        showToast('Gruppe opprettet', 'success');
        renderSubcategoryFilter();
      } catch (err) { showToast(err.message, 'error'); }
      finally { btn.disabled = false; }
    }

    else if (action === 'addSubcat') {
      const groupId = parseInt(btn.dataset.groupId, 10);
      const input = contentEl.querySelector(`input[data-add-subcat-input][data-group-id="${groupId}"]`);
      const navn = input?.value?.trim();
      if (!navn) { input?.focus(); return; }
      btn.disabled = true;
      try {
        const res = await apiFetch('/api/subcategories/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: groupId, navn })
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'Feil'); }
        const json = await res.json();
        subcatRegistryAddItem(groupId, json.data || { id: Date.now(), navn });
        showToast('Underkategori opprettet', 'success');
        renderSubcategoryFilter();
      } catch (err) { showToast(err.message, 'error'); }
      finally { btn.disabled = false; }
    }

    else if (action === 'editGroup') {
      const groupId = parseInt(btn.dataset.groupId, 10);
      const currentName = btn.dataset.groupNavn;
      const newName = prompt('Nytt navn for gruppen:', currentName);
      if (!newName || newName.trim() === currentName) return;
      try {
        const res = await apiFetch(`/api/subcategories/groups/${groupId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ navn: newName.trim() })
        });
        if (!res.ok) throw new Error('Kunne ikke oppdatere');
        subcatRegistryEditGroup(groupId, newName.trim());
        showToast('Gruppe oppdatert', 'success');
        renderSubcategoryFilter();
      } catch (err) { showToast(err.message, 'error'); }
    }

    else if (action === 'deleteGroup') {
      const groupId = parseInt(btn.dataset.groupId, 10);
      const navn = btn.dataset.groupNavn;
      const confirmed = await showConfirm(`Slett gruppen "${navn}"? Alle underkategorier slettes også.`, 'Slette gruppe');
      if (!confirmed) return;
      try {
        const res = await apiFetch(`/api/subcategories/groups/${groupId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Kunne ikke slette');
        subcatRegistryDeleteGroup(groupId);
        delete selectedSubcategories[groupId];
        showToast('Gruppe slettet', 'success');
        renderSubcategoryFilter();
        applyFilters();
      } catch (err) { showToast(err.message, 'error'); }
    }

    else if (action === 'editSubcat') {
      const subcatId = parseInt(btn.dataset.subcatId, 10);
      const currentName = btn.dataset.subcatNavn;
      const newName = prompt('Nytt navn:', currentName);
      if (!newName || newName.trim() === currentName) return;
      try {
        const res = await apiFetch(`/api/subcategories/items/${subcatId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ navn: newName.trim() })
        });
        if (!res.ok) throw new Error('Kunne ikke oppdatere');
        subcatRegistryEditItem(subcatId, newName.trim());
        showToast('Underkategori oppdatert', 'success');
        renderSubcategoryFilter();
      } catch (err) { showToast(err.message, 'error'); }
    }

    else if (action === 'deleteSubcat') {
      const subcatId = parseInt(btn.dataset.subcatId, 10);
      const navn = btn.dataset.subcatNavn;
      const confirmed = await showConfirm(`Slett "${navn}"?`, 'Slette underkategori');
      if (!confirmed) return;
      try {
        const res = await apiFetch(`/api/subcategories/items/${subcatId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Kunne ikke slette');
        subcatRegistryDeleteItem(subcatId);
        showToast('Underkategori slettet', 'success');
        renderSubcategoryFilter();
        applyFilters();
      } catch (err) { showToast(err.message, 'error'); }
    }
  });

  // Enter key to submit inline inputs
  contentEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target;
    if (input.dataset.addGroupInput !== undefined) {
      contentEl.querySelector('button[data-action="addGroup"]')?.click();
      e.preventDefault();
    } else if (input.dataset.addSubcatInput !== undefined) {
      const groupId = input.dataset.groupId;
      contentEl.querySelector(`button[data-action="addSubcat"][data-group-id="${groupId}"]`)?.click();
      e.preventDefault();
    }
  });
}

/**
 * Local registry helpers — update allSubcategoryGroups in-place
 * instead of reloading the full /api/config (which runs 6+ DB queries).
 */
function subcatRegistryAddGroup(group) {
  allSubcategoryGroups.push({ id: group.id, navn: group.navn, subcategories: [] });
}

function subcatRegistryAddItem(groupId, item) {
  const group = allSubcategoryGroups.find(g => g.id === groupId);
  if (group) {
    if (!group.subcategories) group.subcategories = [];
    group.subcategories.push({ id: item.id, navn: item.navn });
  }
}

function subcatRegistryEditGroup(groupId, newName) {
  const group = allSubcategoryGroups.find(g => g.id === groupId);
  if (group) group.navn = newName;
}

function subcatRegistryDeleteGroup(groupId) {
  const idx = allSubcategoryGroups.findIndex(g => g.id === groupId);
  if (idx !== -1) allSubcategoryGroups.splice(idx, 1);
}

function subcatRegistryEditItem(subcatId, newName) {
  for (const group of allSubcategoryGroups) {
    const item = (group.subcategories || []).find(s => s.id === subcatId);
    if (item) { item.navn = newName; return; }
  }
}

function subcatRegistryDeleteItem(subcatId) {
  for (const group of allSubcategoryGroups) {
    if (!group.subcategories) continue;
    const idx = group.subcategories.findIndex(s => s.id === subcatId);
    if (idx !== -1) { group.subcategories.splice(idx, 1); return; }
  }
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

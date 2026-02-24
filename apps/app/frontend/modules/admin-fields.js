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
            onclick="selectCategoryIcon(this, '${escapeJsString(icon)}')">
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
  document.getElementById('categoryColor').value = '#5E81AC';
  document.getElementById('categoryInterval').value = '12';
  document.getElementById('categoryIcon').value = 'fa-wrench';
  document.getElementById('categoryDescription').value = '';
  sourceGroup.style.display = 'none';
  updateCategoryColorPreview('#5E81AC');
  renderCategoryIconPicker('fa-wrench');

  if (categoryId) {
    const category = organizationCategories.find(c => c.id === categoryId);
    if (!category) return;

    title.textContent = 'Rediger kategori';
    document.getElementById('categoryId').value = category.id;
    document.getElementById('categoryName').value = category.name;
    document.getElementById('categorySlug').value = category.slug;
    document.getElementById('categoryIcon').value = category.icon || 'fa-wrench';
    document.getElementById('categoryColor').value = category.color || '#5E81AC';
    document.getElementById('categoryInterval').value = String(category.default_interval_months || 12);
    document.getElementById('categoryDescription').value = category.description || '';

    updateCategoryColorPreview(category.color || '#5E81AC');
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
// ADMIN: SUBCATEGORIES MANAGEMENT
// ========================================

/**
 * Render subcategory management section in admin tab.
 * Shows groups + subcategories (standalone, not per service type).
 */
async function renderAdminSubcategories() {
  const content = document.getElementById('subcategoriesAdminContent');
  const empty = document.getElementById('subcategoriesAdminEmpty');
  if (!content) return;

  const groups = allSubcategoryGroups || [];

  content.style.display = 'block';
  if (empty) empty.style.display = groups.length === 0 ? 'block' : 'none';

  content.innerHTML = groups.map(group => `
    <div class="subcat-group" data-group-id="${group.id}" style="margin-bottom: 10px; border-left: 2px solid var(--color-border, #444); padding-left: 10px;">
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
        <i class="fas fa-folder" style="color: var(--color-text-muted, #888); font-size: 11px;"></i>
        <span style="color: var(--color-text, #fff); font-size: 13px; font-weight: 500;">${escapeHtml(group.navn)}</span>
        <span style="color: var(--color-text-muted, #888); font-size: 11px;">(${(group.subcategories || []).length})</span>
        <button class="btn-icon" style="padding: 2px 4px;" onclick="editSubcatGroup(${group.id}, '${escapeJsString(group.navn)}')" title="Gi nytt navn">
          <i class="fas fa-pen" style="font-size: 10px;"></i>
        </button>
        <button class="btn-icon danger" style="padding: 2px 4px;" onclick="deleteSubcatGroup(${group.id}, '${escapeJsString(group.navn)}')" title="Slett gruppe">
          <i class="fas fa-trash" style="font-size: 10px;"></i>
        </button>
      </div>

      ${(group.subcategories || []).map(sub => `
        <div style="display: flex; align-items: center; gap: 6px; margin-left: 16px; padding: 2px 0;">
          <span style="width: 5px; height: 5px; border-radius: 50%; background: var(--color-text-muted, #888); flex-shrink: 0;"></span>
          <span style="color: var(--color-text-secondary, #ccc); font-size: 13px;">${escapeHtml(sub.navn)}</span>
          <button class="btn-icon" style="padding: 2px 4px; opacity: 0.5;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5" onclick="editSubcatItem(${sub.id}, '${escapeJsString(sub.navn)}')" title="Gi nytt navn">
            <i class="fas fa-pen" style="font-size: 10px;"></i>
          </button>
          <button class="btn-icon danger" style="padding: 2px 4px; opacity: 0.5;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5" onclick="deleteSubcatItem(${sub.id}, '${escapeJsString(sub.navn)}')" title="Slett">
            <i class="fas fa-trash" style="font-size: 10px;"></i>
          </button>
        </div>
      `).join('')}

      <div style="display: flex; gap: 6px; margin-left: 16px; margin-top: 4px;">
        <input type="text" class="form-control" placeholder="Ny underkategori..." maxlength="100"
          style="flex: 1; font-size: 12px; padding: 4px 8px; height: 28px;"
          data-add-subcat-for-group="${group.id}"
          onkeydown="if(event.key==='Enter'){addSubcatItem(${group.id}, this); event.preventDefault();}">
        <button class="btn btn-primary btn-small" style="font-size: 11px; padding: 4px 8px; height: 28px;" onclick="addSubcatItem(${group.id}, this.previousElementSibling)">
          <i class="fas fa-plus"></i>
        </button>
      </div>
    </div>
  `).join('') + `
    <div style="display: flex; gap: 6px; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--color-border, #333);">
      <input type="text" class="form-control" placeholder="Ny gruppe..." maxlength="100"
        style="flex: 1; font-size: 12px; padding: 4px 8px; height: 28px;"
        id="adminAddGroupInput"
        onkeydown="if(event.key==='Enter'){addSubcatGroup(this); event.preventDefault();}">
      <button class="btn btn-secondary btn-small" style="font-size: 11px; padding: 4px 8px; height: 28px;" onclick="addSubcatGroup(document.getElementById('adminAddGroupInput'))">
        <i class="fas fa-plus" style="margin-right: 4px;"></i> Gruppe
      </button>
    </div>
  `;
}

async function addSubcatGroup(inputEl) {
  const navn = inputEl.value.trim();
  if (!navn) { inputEl.focus(); return; }

  try {
    const res = await apiFetch('/api/subcategories/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navn })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Kunne ikke opprette gruppe');
    }
    const json = await res.json();
    subcatRegistryAddGroup(json.data || { id: Date.now(), navn });
    showToast('Gruppe opprettet', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function addSubcatItem(groupId, inputEl) {
  const navn = inputEl.value.trim();
  if (!navn) { inputEl.focus(); return; }

  try {
    const res = await apiFetch('/api/subcategories/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId, navn })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Kunne ikke opprette underkategori');
    }
    const json = await res.json();
    subcatRegistryAddItem(groupId, json.data || { id: Date.now(), navn });
    showToast('Underkategori opprettet', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function editSubcatGroup(groupId, currentName) {
  const newName = prompt('Nytt navn for gruppen:', currentName);
  if (!newName || newName.trim() === currentName) return;

  try {
    const res = await apiFetch(`/api/subcategories/groups/${groupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navn: newName.trim() })
    });
    if (!res.ok) throw new Error('Kunne ikke oppdatere gruppe');
    subcatRegistryEditGroup(groupId, newName.trim());
    showToast('Gruppe oppdatert', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteSubcatGroup(groupId, groupName) {
  const confirmed = await showConfirm(`Slett gruppen "${groupName}"? Alle underkategorier i gruppen slettes også.`, 'Slette gruppe');
  if (!confirmed) return;

  try {
    const res = await apiFetch(`/api/subcategories/groups/${groupId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Kunne ikke slette gruppe');
    subcatRegistryDeleteGroup(groupId);
    showToast('Gruppe slettet', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function editSubcatItem(subcatId, currentName) {
  const newName = prompt('Nytt navn:', currentName);
  if (!newName || newName.trim() === currentName) return;

  try {
    const res = await apiFetch(`/api/subcategories/items/${subcatId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navn: newName.trim() })
    });
    if (!res.ok) throw new Error('Kunne ikke oppdatere underkategori');
    subcatRegistryEditItem(subcatId, newName.trim());
    showToast('Underkategori oppdatert', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteSubcatItem(subcatId, subcatName) {
  const confirmed = await showConfirm(`Slett underkategorien "${subcatName}"?`, 'Slette underkategori');
  if (!confirmed) return;

  try {
    const res = await apiFetch(`/api/subcategories/items/${subcatId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Kunne ikke slette underkategori');
    subcatRegistryDeleteItem(subcatId);
    showToast('Underkategori slettet', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// reloadAppConfig removed — subcategory CRUD now updates serviceTypeRegistry in-place
// via subcatRegistry* helpers in filter-panel.js (shared global scope)

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

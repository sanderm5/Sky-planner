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
  const hasEmail = customer.epost && customer.epost.trim() !== '';

  // Build menu items dynamically based on enabled features
  let menuHtml = `
    <div class="context-menu-header">${escapeHtml(customer.navn)}</div>
    <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="ctx-details" data-id="${customer.id}">
      <i class="fas fa-info-circle"></i> Se detaljer
    </div>
    <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="ctx-navigate" data-lat="${customer.lat}" data-lng="${customer.lng}">
      <i class="fas fa-directions"></i> Naviger hit
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="ctx-add-route" data-id="${customer.id}">
      <i class="fas fa-route"></i> ${isSelected ? 'Fjern fra rute' : 'Legg til i rute'}
    </div>
    <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="ctx-mark-visited" data-id="${customer.id}">
      <i class="fas fa-check"></i> Marker besøkt
    </div>`;

  // Email option (feature: email_templates or always if email exists)
  if (hasEmail) {
    menuHtml += `
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="ctx-email" data-id="${customer.id}">
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
    <div class="context-menu-item context-menu-parent" role="menuitem" tabindex="-1">
      <span><i class="fas fa-folder-plus"></i> Opprett prosjekt</span>
      <i class="fas fa-chevron-right context-menu-arrow"></i>
      <div class="context-menu-submenu" role="menu">
        ${categories.map(cat => `
          <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="ctx-create-project" data-id="${customer.id}" data-type="${escapeHtml(cat.key)}">
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
    <div class="context-menu-item" role="menuitem" tabindex="-1" data-action="ctx-push-tripletex" data-id="${customer.id}">
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

  // Keyboard navigation for menu items (arrow keys, Enter/Space, Escape)
  const keydownHandler = (e) => {
    if (!activeContextMenu) {
      document.removeEventListener('keydown', keydownHandler);
      return;
    }

    const menuItems = Array.from(activeContextMenu.querySelectorAll(':scope > [role="menuitem"]'));
    const currentIndex = menuItems.indexOf(document.activeElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
        menuItems[nextIndex].focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
        menuItems[prevIndex].focus();
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (document.activeElement && document.activeElement.closest('.marker-context-menu')) {
          document.activeElement.click();
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        closeContextMenu();
        document.removeEventListener('keydown', keydownHandler);
        return;
    }
  };
  document.addEventListener('keydown', keydownHandler);

  // Focus the first menuitem after the menu is shown
  const firstItem = menu.querySelector('[role="menuitem"]');
  if (firstItem) {
    firstItem.focus();
  }
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
    case 'ctx-mark-visited':
      quickMarkVisited(id);
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

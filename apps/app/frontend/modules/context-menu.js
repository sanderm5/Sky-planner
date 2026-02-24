// ========================================
// CONTEXT MENU — Generisk system
// Brukes av kart, kundeliste, kalender, ukeplan
// ========================================

let activeContextMenu = null;
let activeContextMenuContext = null;
const contextMenuActions = new Map();

// ── Generisk motor ──────────────────────────────────────────

function registerContextMenuAction(name, handler) {
  contextMenuActions.set(name, handler);
}

/**
 * Vis en kontekstmeny ved gitte koordinater.
 * @param {Object} opts
 * @param {string} opts.header - Tittel (escapes automatisk)
 * @param {Array}  opts.items  - Menyvalg-definisjoner
 * @param {number} opts.x      - clientX
 * @param {number} opts.y      - clientY
 * @param {Object} [opts.context] - Vilkårlig data tilgjengelig for action-handlers
 */
function showContextMenu({ header, items, x, y, context }) {
  closeContextMenu();
  activeContextMenuContext = context || {};

  const menu = document.createElement('div');
  menu.className = 'marker-context-menu';
  menu.setAttribute('role', 'menu');

  let menuHtml = `<div class="context-menu-header">${escapeHtml(header)}</div>`;

  for (const item of items) {
    if (item.hidden) continue;

    if (item.type === 'divider') {
      menuHtml += '<div class="context-menu-divider"></div>';
      continue;
    }

    // Data-attributter
    const dataAttrs = [`data-action="${escapeHtml(item.action || '')}"`];
    if (item.data) {
      for (const [k, v] of Object.entries(item.data)) {
        if (v != null) dataAttrs.push(`data-${escapeHtml(k)}="${escapeHtml(String(v))}"`);
      }
    }

    const cssClass = `context-menu-item${item.className ? ' ' + item.className : ''}${item.disabled ? ' disabled' : ''}`;

    if (item.type === 'submenu' && item.children) {
      menuHtml += `
      <div class="${cssClass} context-menu-parent" role="menuitem" tabindex="-1">
        <span>${item.icon ? `<i class="${item.icon}"></i> ` : ''}${escapeHtml(item.label)}</span>
        <i class="fas fa-chevron-right context-menu-arrow"></i>
        <div class="context-menu-submenu" role="menu">
          ${item.children.filter(c => !c.hidden).map(child => {
            const childDataAttrs = [`data-action="${escapeHtml(child.action || '')}"`];
            if (child.data) {
              for (const [k, v] of Object.entries(child.data)) {
                if (v != null) childDataAttrs.push(`data-${escapeHtml(k)}="${escapeHtml(String(v))}"`);
              }
            }
            return `<div class="context-menu-item" role="menuitem" tabindex="-1" ${childDataAttrs.join(' ')}>${child.icon ? `<i class="${child.icon}"></i> ` : ''}${escapeHtml(child.label)}</div>`;
          }).join('')}
        </div>
      </div>`;
    } else {
      menuHtml += `
      <div class="${cssClass}" role="menuitem" tabindex="-1" ${dataAttrs.join(' ')}>
        ${item.icon ? `<i class="${item.icon}"></i> ` : ''}${escapeHtml(item.label)}
      </div>`;
    }
  }

  menu.innerHTML = menuHtml;

  // Posisjonering innenfor viewport
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

  // Klikk-delegering
  menu.addEventListener('click', handleContextMenuClick);

  // Lukk ved klikk utenfor (utsatt for å unngå umiddelbar lukking)
  requestAnimationFrame(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
    document.addEventListener('contextmenu', closeContextMenu, { once: true });
  });

  // Tastaturnavigasjon
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
      case ' ':
        e.preventDefault();
        if (document.activeElement && document.activeElement.closest('.marker-context-menu')) {
          document.activeElement.click();
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeContextMenu();
        document.removeEventListener('keydown', keydownHandler);
        return;
    }
  };
  document.addEventListener('keydown', keydownHandler);

  // Fokuser første element
  const firstItem = menu.querySelector('[role="menuitem"]');
  if (firstItem) firstItem.focus();
}

function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
    activeContextMenuContext = null;
  }
}

function handleContextMenuClick(e) {
  const item = e.target.closest('[data-action]');
  if (!item || !item.dataset.action) return;

  const action = item.dataset.action;
  const ctx = activeContextMenuContext || {};

  closeContextMenu();

  const handler = contextMenuActions.get(action);
  if (handler) {
    handler(item.dataset, ctx);
  }
}

// ── Registrer felles actions ────────────────────────────────

registerContextMenuAction('ctx-details', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id) editCustomer(id);
});

registerContextMenuAction('ctx-navigate', (data) => {
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  if (lat && lng) navigateToCustomer(lat, lng);
});

registerContextMenuAction('ctx-add-route', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id) toggleCustomerSelection(id);
});

registerContextMenuAction('ctx-mark-visited', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id) quickMarkVisited(id);
});

registerContextMenuAction('ctx-email', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (typeof openEmailDialog === 'function') {
    openEmailDialog(id);
  } else {
    editCustomer(id);
  }
});

registerContextMenuAction('ctx-focus-map', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id && typeof focusOnCustomer === 'function') {
    focusOnCustomer(id);
  } else {
    // Fallback: fly til koordinater
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    if (lat && lng && typeof map !== 'undefined' && map) {
      map.flyTo({ center: [lng, lat], zoom: 16 });
    }
  }
});

registerContextMenuAction('ctx-add-weekplan', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id && typeof addToWeekPlanFromMap === 'function') addToWeekPlanFromMap(id);
});

registerContextMenuAction('ctx-new-avtale', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id && typeof openNewAvtaleForCustomer === 'function') openNewAvtaleForCustomer(id);
});

// Tripletex-spesifikke actions
registerContextMenuAction('ctx-create-project', (data) => {
  const id = Number(data.id);
  const projectType = data.type;
  if (id) createTripletexProjectFromMenu(id, projectType);
});

registerContextMenuAction('ctx-push-tripletex', (data) => {
  const id = Number(data.id);
  if (id) pushCustomerToTripletex(id);
});

// Avtale-actions (kalender + ukeplan)
registerContextMenuAction('ctx-edit-avtale', (data, ctx) => {
  if (ctx.avtale && typeof openAvtaleModal === 'function') {
    openAvtaleModal(ctx.avtale);
  } else {
    const avtaleId = ctx.avtaleId || Number(data.avtaleId);
    const avtale = typeof avtaler !== 'undefined' ? avtaler.find(a => a.id === avtaleId) : null;
    if (avtale && typeof openAvtaleModal === 'function') openAvtaleModal(avtale);
  }
});

registerContextMenuAction('ctx-toggle-complete-avtale', async (data, ctx) => {
  const avtaleId = ctx.avtaleId || Number(data.avtaleId);
  if (!avtaleId) return;
  try {
    const resp = await apiFetch(`/api/avtaler/${avtaleId}/complete`, { method: 'POST' });
    if (resp.ok) {
      showToast('Avtale oppdatert', 'success');
      if (typeof loadAvtaler === 'function') await loadAvtaler();
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderWeeklyPlan === 'function') renderWeeklyPlan();
    } else {
      showToast('Kunne ikke oppdatere avtale', 'error');
    }
  } catch (err) {
    showToast('Feil ved oppdatering: ' + err.message, 'error');
  }
});

registerContextMenuAction('ctx-delete-avtale', async (data, ctx) => {
  const avtaleId = ctx.avtaleId || Number(data.avtaleId);
  if (!avtaleId) return;
  try {
    const resp = await apiFetch(`/api/avtaler/${avtaleId}`, { method: 'DELETE' });
    if (resp.ok) {
      showToast('Avtale slettet', 'success');
      if (typeof loadAvtaler === 'function') await loadAvtaler();
      if (typeof refreshTeamFocus === 'function') refreshTeamFocus();
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderWeeklyPlan === 'function') renderWeeklyPlan();
      if (typeof applyFilters === 'function') applyFilters();
    } else {
      const err = await resp.json().catch(() => ({}));
      showToast(err.error?.message || 'Kunne ikke slette avtale', 'error');
    }
  } catch (err) {
    showToast('Feil ved sletting: ' + err.message, 'error');
  }
});

registerContextMenuAction('ctx-remove-from-plan', (data) => {
  const dayKey = data.day;
  const customerId = Number(data.customerId);
  if (dayKey && customerId && typeof weekPlanState !== 'undefined') {
    weekPlanState.days[dayKey].planned = weekPlanState.days[dayKey].planned.filter(c => c.id !== customerId);
    if (typeof renderWeeklyPlan === 'function') renderWeeklyPlan();
    if (typeof updateWeekPlanBadges === 'function') updateWeekPlanBadges();
  }
});

// ── Kart-markør kontekstmeny (wrapper) ──────────────────────

function getMarkerContextMenuItems(customer) {
  const isSelected = selectedCustomers.has(customer.id);
  const hasEmail = customer.epost && customer.epost.trim() !== '';

  const items = [
    { type: 'item', label: 'Se detaljer', icon: 'fas fa-info-circle', action: 'ctx-details', data: { id: customer.id } },
    { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', data: { lat: customer.lat, lng: customer.lng } },
    { type: 'divider' },
    { type: 'item', label: isSelected ? 'Fjern fra rute' : 'Legg til i rute', icon: 'fas fa-route', action: 'ctx-add-route', data: { id: customer.id } },
    { type: 'item', label: 'Marker besøkt', icon: 'fas fa-check', action: 'ctx-mark-visited', data: { id: customer.id } },
    { type: 'divider', hidden: !hasEmail },
    { type: 'item', label: 'Send e-post', icon: 'fas fa-envelope', action: 'ctx-email', data: { id: customer.id }, hidden: !hasEmail },
  ];

  // Tripletex project creation (feature: tripletex_projects)
  if (typeof hasFeature === 'function' && hasFeature('tripletex_projects') && appConfig.integrations?.tripletex?.active !== false) {
    const categories = (typeof getFeatureConfig === 'function' ? getFeatureConfig('tripletex_projects')?.project_categories : null) || [
      { key: 'elkontroll', label: '01 - Elkontroll' },
      { key: 'arskontroll', label: '02 - Årskontroll' },
      { key: 'begge', label: '03 - Begge' }
    ];

    items.push({ type: 'divider' });
    items.push({
      type: 'submenu',
      label: 'Opprett prosjekt',
      icon: 'fas fa-folder-plus',
      children: categories.map(cat => ({
        type: 'item',
        label: cat.label,
        action: 'ctx-create-project',
        data: { id: customer.id, type: cat.key }
      }))
    });
  }

  // Push/sync customer to Tripletex (if connected)
  if (typeof appConfig !== 'undefined' && appConfig.integrations?.tripletex?.active !== false) {
    const isLinked = customer.external_source === 'tripletex' && customer.external_id;
    items.push({ type: 'divider' });
    items.push({
      type: 'item',
      label: isLinked ? 'Oppdater i Tripletex' : 'Opprett i Tripletex',
      icon: isLinked ? 'fas fa-sync' : 'fas fa-cloud-upload-alt',
      action: 'ctx-push-tripletex',
      data: { id: customer.id }
    });
  }

  return items;
}

function showMarkerContextMenu(customer, x, y) {
  showContextMenu({
    header: customer.navn,
    items: getMarkerContextMenuItems(customer),
    x, y,
    context: { customer, customerId: customer.id }
  });
}

// ── Kundeliste kontekstmeny ─────────────────────────────────

function showCustomerListContextMenu(customer, x, y) {
  const isSelected = selectedCustomers.has(customer.id);
  const hasEmail = customer.epost && customer.epost.trim() !== '';
  const hasCoords = customer.lat && customer.lng;

  showContextMenu({
    header: customer.navn,
    items: [
      { type: 'item', label: 'Se detaljer', icon: 'fas fa-info-circle', action: 'ctx-details' },
      { type: 'item', label: 'Vis på kart', icon: 'fas fa-map-marker-alt', action: 'ctx-focus-map', hidden: !hasCoords, data: { lat: customer.lat, lng: customer.lng } },
      { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', hidden: !hasCoords, data: { lat: customer.lat, lng: customer.lng } },
      { type: 'divider' },
      { type: 'item', label: isSelected ? 'Fjern fra rute' : 'Legg til i rute', icon: 'fas fa-route', action: 'ctx-add-route' },
      { type: 'item', label: 'Legg til i ukeplan', icon: 'fas fa-calendar-week', action: 'ctx-add-weekplan' },
      { type: 'item', label: 'Ny avtale', icon: 'fas fa-calendar-plus', action: 'ctx-new-avtale' },
      { type: 'item', label: 'Marker besøkt', icon: 'fas fa-check', action: 'ctx-mark-visited' },
      { type: 'divider', hidden: !hasEmail },
      { type: 'item', label: 'Send e-post', icon: 'fas fa-envelope', action: 'ctx-email', hidden: !hasEmail },
    ],
    x, y,
    context: { customer, customerId: customer.id }
  });
}

// ── Kalender kontekstmeny ───────────────────────────────────

function showCalendarContextMenu(avtale, x, y) {
  const kunde = typeof customers !== 'undefined' ? customers.find(c => c.id === avtale.kunde_id) : null;
  const hasCoords = kunde && kunde.lat && kunde.lng;
  const isCompleted = avtale.status === 'fullført';

  showContextMenu({
    header: kunde?.navn || avtale.kunde_navn || 'Avtale',
    items: [
      { type: 'item', label: 'Rediger avtale', icon: 'fas fa-edit', action: 'ctx-edit-avtale' },
      { type: 'item', label: isCompleted ? 'Marker uferdig' : 'Marker fullført', icon: 'fas fa-check-circle', action: 'ctx-toggle-complete-avtale' },
      { type: 'divider' },
      { type: 'item', label: 'Se kundedetaljer', icon: 'fas fa-user', action: 'ctx-details', hidden: !avtale.kunde_id },
      { type: 'item', label: 'Vis på kart', icon: 'fas fa-map-marker-alt', action: 'ctx-focus-map', hidden: !hasCoords, data: { lat: kunde?.lat, lng: kunde?.lng } },
      { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', hidden: !hasCoords, data: { lat: kunde?.lat, lng: kunde?.lng } },
      { type: 'divider' },
      { type: 'item', label: 'Slett avtale', icon: 'fas fa-trash', action: 'ctx-delete-avtale', className: 'danger' },
    ],
    x, y,
    context: { avtale, avtaleId: avtale.id, customerId: avtale.kunde_id }
  });
}

// ── Ukeplan kontekstmeny ────────────────────────────────────

function showWeekplanExistingContextMenu(avtale, x, y) {
  const kunde = typeof customers !== 'undefined' ? customers.find(c => c.id === avtale.kunde_id) : null;
  const hasCoords = kunde && kunde.lat && kunde.lng;

  showContextMenu({
    header: kunde?.navn || avtale.kunde_navn || 'Avtale',
    items: [
      { type: 'item', label: 'Rediger avtale', icon: 'fas fa-edit', action: 'ctx-edit-avtale' },
      { type: 'item', label: 'Marker fullført', icon: 'fas fa-check-circle', action: 'ctx-toggle-complete-avtale' },
      { type: 'divider' },
      { type: 'item', label: 'Se kundedetaljer', icon: 'fas fa-user', action: 'ctx-details', hidden: !avtale.kunde_id },
      { type: 'item', label: 'Vis på kart', icon: 'fas fa-map-marker-alt', action: 'ctx-focus-map', hidden: !hasCoords, data: { lat: kunde?.lat, lng: kunde?.lng } },
      { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', hidden: !hasCoords, data: { lat: kunde?.lat, lng: kunde?.lng } },
      { type: 'divider' },
      { type: 'item', label: 'Slett avtale', icon: 'fas fa-trash', action: 'ctx-delete-avtale', className: 'danger' },
    ],
    x, y,
    context: { avtale, avtaleId: avtale.id, customerId: avtale.kunde_id }
  });
}

function showWeekplanPlannedContextMenu(customer, dayKey, x, y) {
  const hasCoords = customer.lat && customer.lng;

  showContextMenu({
    header: customer.navn,
    items: [
      { type: 'item', label: 'Se kundedetaljer', icon: 'fas fa-user', action: 'ctx-details' },
      { type: 'item', label: 'Vis på kart', icon: 'fas fa-map-marker-alt', action: 'ctx-focus-map', hidden: !hasCoords, data: { lat: customer.lat, lng: customer.lng } },
      { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', hidden: !hasCoords, data: { lat: customer.lat, lng: customer.lng } },
      { type: 'divider' },
      { type: 'item', label: 'Fjern fra plan', icon: 'fas fa-times', action: 'ctx-remove-from-plan', className: 'danger', data: { day: dayKey, customerId: customer.id } },
    ],
    x, y,
    context: { customer, customerId: customer.id }
  });
}

// ── Tripletex-hjelpefunksjoner (uendret) ────────────────────

async function createTripletexProjectFromMenu(kundeId, projectType) {
  try {
    showNotification('Oppretter prosjekt i Tripletex...', 'info');

    const featureConfig = typeof getFeatureConfig === 'function' ? getFeatureConfig('tripletex_projects') : null;
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

  const isSelected = selectedCustomers.has(customer.id);

  const tooltip = document.createElement('div');
  tooltip.className = 'marker-hover-tooltip';
  tooltip.innerHTML = `
    <div class="tooltip-header">${escapeHtml(customer.navn)}</div>
    <div class="tooltip-body">
      <div class="tooltip-row"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(customer.adresse || '')}${customer.postnummer ? `, ${escapeHtml(customer.postnummer)}` : ''} ${escapeHtml(customer.poststed || '')}</div>
      ${customer.telefon ? `<div class="tooltip-row"><i class="fas fa-phone"></i> ${escapeHtml(customer.telefon)}</div>` : ''}
      <div class="tooltip-service"><i class="fas fa-tools"></i> ${escapeHtml(serviceInfo)}</div>
      <div class="tooltip-status ${controlStatus.class}">${escapeHtml(controlStatus.label)}</div>
    </div>
    <div class="tooltip-actions">
      <button class="tooltip-action-btn" data-action="select" title="${isSelected ? 'Fjern fra utvalg' : 'Velg kunde'}">
        <i class="fas ${isSelected ? 'fa-check-square' : 'fa-square'}"></i>
      </button>
      <button class="tooltip-action-btn" data-action="weekplan" title="Legg til ukeplan">
        <i class="fas fa-calendar-week"></i>
      </button>
      <button class="tooltip-action-btn" data-action="calendar" title="Ny avtale">
        <i class="fas fa-calendar-plus"></i>
      </button>
    </div>
  `;

  // Prevent tooltip from disappearing when hovering over it
  tooltip.addEventListener('mouseenter', () => { tooltip._hovered = true; });
  tooltip.addEventListener('mouseleave', () => {
    tooltip._hovered = false;
    hideMarkerTooltip();
  });

  // Quick action buttons
  tooltip.addEventListener('click', (e) => {
    const btn = e.target.closest('.tooltip-action-btn');
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    if (action === 'select') {
      toggleCustomerSelection(customer.id);
      hideMarkerTooltip();
    } else if (action === 'weekplan') {
      hideMarkerTooltip();
      if (typeof addToWeekPlanFromMap === 'function') addToWeekPlanFromMap(customer.id);
    } else if (action === 'calendar') {
      hideMarkerTooltip();
      if (typeof openNewAvtaleForCustomer === 'function') openNewAvtaleForCustomer(customer.id);
    }
  });

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

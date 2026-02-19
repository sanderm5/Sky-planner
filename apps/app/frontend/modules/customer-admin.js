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
      // Handle map focus button clicks
      const mapBtn = e.target.closest('.btn-map-focus');
      if (mapBtn) {
        e.stopPropagation();
        const customerId = Number.parseInt(mapBtn.dataset.customerId);
        focusOnCustomer(customerId);
        return;
      }

      const item = e.target.closest('.customer-admin-item');
      if (!item) return;

      const id = Number.parseInt(item.dataset.id);
      editCustomer(id);
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
      <div class="customer-admin-item ${!hasCoords ? 'no-coords' : ''}" data-id="${c.id}">
        <div class="customer-info">
          <span class="customer-name">${escapeHtml(c.navn)}</span>
          <span class="customer-location">${escapeHtml(c.poststed || '')}</span>
          ${serviceInfo}
          ${nextControlInfo}
        </div>
        ${hasCoords ? `<button class="btn-map-focus" data-customer-id="${c.id}" title="Vis på kart"><i class="fas fa-map-marker-alt"></i></button>` : ''}
      </div>
    `;
  }).join('');
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

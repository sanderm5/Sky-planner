// Open email client to contact customer about scheduling control
function sendManualReminder(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  if (!customer.epost || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.epost)) {
    showMessage(`${customer.navn} har ingen gyldig e-postadresse registrert.`, 'warning');
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

  // Open mailto link with encoded email
  window.location.href = `mailto:${encodeURIComponent(customer.epost)}?subject=${subject}&body=${body}`;
}

// === OVERDUE MAP FUNCTIONS ===

// Get all overdue customers
function getOverdueCustomers() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  return customers.filter(c => {
    if (!c.neste_kontroll) return false;
    const nextDate = new Date(c.neste_kontroll);
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    return controlMonthValue < currentMonthValue;
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
  const bounds = boundsFromCustomers(overdueCustomers.filter(c => c.lat && c.lng));

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 50 });
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
  const bounds = boundsFromCustomers(customersToShow.filter(c => c.lat && c.lng));

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 50 });
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

  // Update UI
  updateSelectionUI();
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
            <span class="upcoming-name">${escapeHtml(item.navn)}</span>
            <span class="upcoming-email">${escapeHtml(item.epost || 'Mangler e-post')}</span>
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
      showMessage('Feil ved sending: ' + (result.error?.message || (typeof result.error === 'string' ? result.error : null) || 'Ukjent feil'), 'error');
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
    showMessage('Kunne ikke lagre e-post-innstillinger. Prøv igjen.', 'error');
  }
}

// ==================== KONTAKTLOGG ====================

let currentKontaktloggKundeId = null;

// ========================================
// SUBCATEGORY MANAGEMENT
// ========================================

// Load all subcategory assignments for the organization (bulk, for filtering)
async function loadAllSubcategoryAssignments() {
  try {
    const response = await apiFetch('/api/subcategories/kunde-assignments');
    if (response.ok) {
      const result = await response.json();
      const assignments = result.data || [];
      kundeSubcatMap = {};
      assignments.forEach(a => {
        if (!kundeSubcatMap[a.kunde_id]) kundeSubcatMap[a.kunde_id] = [];
        kundeSubcatMap[a.kunde_id].push({ group_id: a.group_id, subcategory_id: a.subcategory_id });
      });
    }
  } catch (error) {
    console.error('Error loading subcategory assignments:', error);
  }
  renderSubcategoryFilter();
}

// Load subcategories for a specific customer (for edit form)
async function loadKundeSubcategories(kundeId) {
  try {
    const response = await apiFetch(`/api/subcategories/kunde/${kundeId}`);
    if (!response.ok) return;
    const result = await response.json();
    const assignments = result.data || [];
    // Update local cache and re-render dropdowns with actual data
    kundeSubcatMap[kundeId] = assignments.map(a => ({ group_id: a.group_id, subcategory_id: a.subcategory_id }));
    const customer = customers.find(c => c.id === kundeId);
    renderSubcategoryDropdowns(customer || { id: kundeId });
  } catch (error) {
    console.error('Error loading kunde subcategories:', error);
  }
}

// Subcategory manager modal — manage subcategory groups and items per service type
function openSubcategoryManager() {
  const existingModal = document.getElementById('subcatManagerModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'subcatManagerModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:560px">
      <div class="modal-header">
        <h2>Administrer underkategorier</h2>
        <button class="modal-close" id="closeSubcatManager">&times;</button>
      </div>
      <div id="subcatManagerBody" style="max-height:60vh;overflow-y:auto;padding:12px;"></div>
    </div>
  `;
  document.body.appendChild(modal);

  renderSubcatManagerBody();

  document.getElementById('closeSubcatManager').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function renderSubcatManagerBody() {
  const bodyEl = document.getElementById('subcatManagerBody');
  if (!bodyEl) return;

  const groups = allSubcategoryGroups || [];

  let html = '';

  if (groups.length === 0) {
    html += `<p style="padding:8px 0;color:var(--color-text-muted);font-size:13px;">
      Ingen underkategori-grupper opprettet enda.
    </p>`;
  }

  for (const group of groups) {
    const subs = group.subcategories || [];
    html += `
      <div class="subcat-group-item" data-group-id="${group.id}" style="margin-bottom:12px;border:1px solid var(--color-border);border-radius:6px;padding:10px;">
        <div style="display:flex;align-items:center;gap:6px;padding:4px 0;">
          <i class="fas fa-folder" style="color:var(--color-text-muted);font-size:12px;"></i>
          <strong style="font-size:13px;">${escapeHtml(group.navn)}</strong>
          <span style="font-size:11px;color:var(--color-text-muted)">(${subs.length})</span>
          <button class="btn-icon-tiny btn-icon-danger" data-action="deleteGroup" data-group-id="${group.id}" title="Slett gruppe">
            <i class="fas fa-trash"></i>
          </button>
        </div>
        <div style="margin-left:12px;">
          ${subs.map(sub => `
            <div style="display:flex;align-items:center;gap:4px;padding:2px 0;font-size:13px;">
              <span>${escapeHtml(sub.navn)}</span>
              <button class="btn-icon-tiny btn-icon-danger" data-action="deleteSubcat" data-subcat-id="${sub.id}" title="Slett">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          `).join('')}
          <div style="display:flex;gap:4px;margin-top:4px;">
            <input type="text" class="subcat-inline-input" placeholder="Ny underkategori..." maxlength="100" data-group-id="${group.id}" style="flex:1;padding:4px 8px;font-size:12px;border:1px solid var(--color-border);border-radius:4px;">
            <button class="btn btn-small btn-primary subcat-inline-add" data-group-id="${group.id}" style="padding:4px 8px;">
              <i class="fas fa-plus"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Add new group form
  html += `
    <div style="margin-top:8px;">
      <div style="display:flex;gap:4px;">
        <input type="text" class="new-group-input" placeholder="Ny gruppe..." maxlength="100" style="flex:1;padding:4px 8px;font-size:12px;border:1px solid var(--color-border);border-radius:4px;">
        <button class="btn btn-small btn-secondary new-group-add" style="padding:4px 8px;">
          <i class="fas fa-plus"></i> Gruppe
        </button>
      </div>
    </div>
  `;

  bodyEl.innerHTML = html;
  attachSubcatManagerHandlers();
}

function attachSubcatManagerHandlers() {
  const bodyEl = document.getElementById('subcatManagerBody');
  if (!bodyEl) return;

  // Delete group
  bodyEl.querySelectorAll('[data-action="deleteGroup"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const groupId = btn.dataset.groupId;
      if (!confirm('Slett denne gruppen og alle underkategorier?')) return;
      const response = await apiFetch(`/api/subcategories/groups/${groupId}`, { method: 'DELETE' });
      if (response.ok) {
        await reloadServiceTypesAndRefresh();
        renderSubcatManagerBody();
      }
    });
  });

  // Delete subcategory
  bodyEl.querySelectorAll('[data-action="deleteSubcat"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const subcatId = btn.dataset.subcatId;
      const response = await apiFetch(`/api/subcategories/items/${subcatId}`, { method: 'DELETE' });
      if (response.ok) {
        await reloadServiceTypesAndRefresh();
        renderSubcatManagerBody();
      }
    });
  });

  // Add subcategory inline
  bodyEl.querySelectorAll('.subcat-inline-add').forEach(btn => {
    btn.addEventListener('click', () => addSubcategoryInline(Number(btn.dataset.groupId)));
  });
  bodyEl.querySelectorAll('.subcat-inline-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSubcategoryInline(Number(input.dataset.groupId));
      }
    });
  });

  // Add new group
  bodyEl.querySelectorAll('.new-group-add').forEach(btn => {
    btn.addEventListener('click', () => addGroupInline());
  });
  bodyEl.querySelectorAll('.new-group-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addGroupInline();
      }
    });
  });
}

async function addSubcategoryInline(groupId) {
  const input = document.querySelector(`.subcat-inline-input[data-group-id="${groupId}"]`);
  const navn = input?.value?.trim();
  if (!navn) return;

  try {
    const response = await apiFetch('/api/subcategories/items', {
      method: 'POST',
      body: JSON.stringify({ group_id: groupId, navn }),
    });
    if (response.ok) {
      input.value = '';
      await reloadServiceTypesAndRefresh();
      renderSubcatManagerBody();
    } else {
      const err = await response.json();
      showMessage(err.error?.message || 'Kunne ikke opprette underkategori', 'error');
    }
  } catch (error) {
    console.error('Error creating subcategory:', error);
  }
}

async function addGroupInline() {
  const input = document.querySelector('.new-group-input');
  const navn = input?.value?.trim();
  if (!navn) return;

  try {
    const response = await apiFetch('/api/subcategories/groups', {
      method: 'POST',
      body: JSON.stringify({ navn }),
    });
    if (response.ok) {
      input.value = '';
      await reloadServiceTypesAndRefresh();
      renderSubcatManagerBody();
    } else {
      const err = await response.json();
      showMessage(err.error?.message || 'Kunne ikke opprette gruppe', 'error');
    }
  } catch (error) {
    console.error('Error creating group:', error);
  }
}

// Create a new service type inline (from subcategory manager)
// Reload service types from server and update registry
async function reloadServiceTypesAndRefresh() {
  try {
    const response = await apiFetch('/api/config');
    if (response.ok) {
      const result = await response.json();
      // Always reload — handles adding first type and removing last type
      serviceTypeRegistry.loadFromConfig(result.data);
      allSubcategoryGroups = result.data.subcategoryGroups || [];
    }
  } catch (error) {
    console.error('Error reloading service types:', error);
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


// Add all customers from a cluster to route
function addClusterToRoute(customerIds) {
  customerIds.forEach(id => {
    if (!selectedCustomers.has(id)) {
      selectedCustomers.add(id);
    }
  });
  updateSelectionUI();
  closeMapPopup();

  // Show feedback
  const count = customerIds.length;
  showNotification(`${count} kunder lagt til ruten`);
}

// Zoom to cluster location
function zoomToCluster(lat, lng) {
  closeMapPopup();
  map.flyTo({ center: [lng, lat], zoom: map.getZoom() + 2 });
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
window.focusOnCustomer = focusOnCustomer;
window.createRouteForArea = createRouteForArea;
window.addClusterToRoute = addClusterToRoute;
window.zoomToCluster = zoomToCluster;




window.closeContentPanelMobile = closeContentPanelMobile;

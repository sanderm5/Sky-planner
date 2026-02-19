// ===== QUICK MARK VISITED + SEARCH FILTER =====

// Quick mark a single customer as visited from map popup
async function quickMarkVisited(customerId) {
  const customer = customers.find(c => c.id === customerId);
  const serviceTypes = serviceTypeRegistry.getAll();
  const today = new Date().toISOString().split('T')[0];

  // Build service type checkboxes
  const checkboxesHtml = serviceTypes.map(st => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:15px;color:var(--color-text-primary,#fff);cursor:pointer;">
      <input type="checkbox" class="qmv-kontroll-cb" data-slug="${escapeHtml(st.slug)}" checked
        style="width:20px;height:20px;accent-color:${escapeHtml(st.color || '#5E81AC')};">
      <i class="fas ${escapeHtml(st.icon || 'fa-clipboard-check')}" style="color:${escapeHtml(st.color || '#5E81AC')};"></i>
      ${escapeHtml(st.name)}
    </label>
  `).join('');

  // Create dialog overlay
  const overlay = document.createElement('div');
  overlay.className = 'qmv-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:100001;display:flex;justify-content:center;align-items:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--color-bg-secondary,#1a1a1a);border-radius:16px;max-width:400px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid var(--color-border,#333);">
      <h3 style="margin:0 0 16px;font-size:18px;color:var(--color-text-primary,#fff);">
        Marker besøkt: ${escapeHtml(customer?.navn || 'Kunde')}
      </h3>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Dato for besøk</label>
        <input type="${appConfig.datoModus === 'month_year' ? 'month' : 'date'}" id="qmvDate" value="${appConfig.datoModus === 'month_year' ? today.substring(0, 7) : today}" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);font-size:15px;">
      </div>
      ${serviceTypes.length > 0 ? `
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Oppdater kontrolldatoer</label>
          ${checkboxesHtml}
        </div>
      ` : ''}
      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button id="qmvCancel" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);cursor:pointer;">Avbryt</button>
        <button id="qmvConfirm" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:none;background:var(--color-accent,#5E81AC);color:#fff;cursor:pointer;">Marker besøkt</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on escape or overlay click
  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', escHandler); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', escHandler);

  overlay.querySelector('#qmvCancel').addEventListener('click', close);
  overlay.querySelector('#qmvConfirm').addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('#qmvConfirm');
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Oppdaterer...';

    const dateValue = normalizeDateValue(document.getElementById('qmvDate').value);
    const selectedSlugs = Array.from(overlay.querySelectorAll('.qmv-kontroll-cb:checked')).map(cb => cb.dataset.slug);

    close();

    try {
      const response = await apiFetch('/api/kunder/mark-visited', {
        method: 'POST',
        body: JSON.stringify({
          kunde_ids: [customerId],
          visited_date: dateValue,
          service_type_slugs: selectedSlugs
        })
      });

      const result = await response.json();
      if (response.ok && result.success) {
        const msg = selectedSlugs.length > 0
          ? `${escapeHtml(customer?.navn || 'Kunde')} markert som besøkt (kontrolldatoer oppdatert)`
          : `${escapeHtml(customer?.navn || 'Kunde')} markert som besøkt`;
        showNotification(msg);
        await loadCustomers();
      } else {
        showNotification(typeof result.error === 'string' ? result.error : 'Kunne ikke markere som besøkt', 'error');
      }
    } catch (error) {
      console.error('Feil ved rask avhuking:', error);
      showNotification('Feil ved oppdatering', 'error');
    }
  });
}

// Bulk mark visited for multiple customers (used by area-select)
async function bulkMarkVisited(customerIds) {
  const serviceTypes = serviceTypeRegistry.getAll();
  const today = new Date().toISOString().split('T')[0];
  const count = customerIds.length;

  const checkboxesHtml = serviceTypes.map(st => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:15px;color:var(--color-text-primary,#fff);cursor:pointer;">
      <input type="checkbox" class="bmv-kontroll-cb" data-slug="${escapeHtml(st.slug)}" checked
        style="width:20px;height:20px;accent-color:${escapeHtml(st.color || '#5E81AC')};">
      <i class="fas ${escapeHtml(st.icon || 'fa-clipboard-check')}" style="color:${escapeHtml(st.color || '#5E81AC')};"></i>
      ${escapeHtml(st.name)}
    </label>
  `).join('');

  const overlay = document.createElement('div');
  overlay.className = 'qmv-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:100001;display:flex;justify-content:center;align-items:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--color-bg-secondary,#1a1a1a);border-radius:16px;max-width:400px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid var(--color-border,#333);">
      <h3 style="margin:0 0 16px;font-size:18px;color:var(--color-text-primary,#fff);">
        Marker ${count} kunder som besøkt
      </h3>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Dato for besøk</label>
        <input type="${appConfig.datoModus === 'month_year' ? 'month' : 'date'}" id="bmvDate" value="${appConfig.datoModus === 'month_year' ? today.substring(0, 7) : today}" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);font-size:15px;">
      </div>
      ${serviceTypes.length > 0 ? `
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Oppdater kontrolldatoer</label>
          ${checkboxesHtml}
        </div>
      ` : ''}
      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button id="bmvCancel" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);cursor:pointer;">Avbryt</button>
        <button id="bmvConfirm" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:none;background:var(--color-accent,#5E81AC);color:#fff;cursor:pointer;">Marker besøkt</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', escHandler); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', escHandler);

  overlay.querySelector('#bmvCancel').addEventListener('click', close);
  overlay.querySelector('#bmvConfirm').addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('#bmvConfirm');
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Oppdaterer...';

    const dateValue = normalizeDateValue(document.getElementById('bmvDate').value);
    const selectedSlugs = Array.from(overlay.querySelectorAll('.bmv-kontroll-cb:checked')).map(cb => cb.dataset.slug);

    close();

    try {
      const response = await apiFetch('/api/kunder/mark-visited', {
        method: 'POST',
        body: JSON.stringify({
          kunde_ids: customerIds,
          visited_date: dateValue,
          service_type_slugs: selectedSlugs
        })
      });

      const result = await response.json();
      if (response.ok && result.success) {
        showNotification(`${result.data.updated} kunder markert som besøkt`);
        await loadCustomers();
      } else {
        showNotification(typeof result.error === 'string' ? result.error : 'Kunne ikke markere som besøkt', 'error');
      }
    } catch (error) {
      console.error('Feil ved bulk avhuking:', error);
      showNotification('Feil ved oppdatering', 'error');
    }
  });
}

// Make functions globally available
window.quickMarkVisited = quickMarkVisited;
window.bulkMarkVisited = bulkMarkVisited;

// Search/filter customers
function filterCustomers() {
  applyFilters();
}

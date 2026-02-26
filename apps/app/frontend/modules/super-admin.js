// ========================================
// SUPER ADMIN FUNCTIONS
// ========================================

let isSuperAdmin = false;
let superAdminOrganizations = [];
let selectedOrgId = null;
let selectedOrgData = null;

async function checkSuperAdminStatus() {
  // Check if user is super admin from the login response stored in sessionStorage/localStorage
  // This is set during login
  const storedSuperAdmin = sessionStorage.getItem('isSuperAdmin') || localStorage.getItem('isSuperAdmin');
  isSuperAdmin = storedSuperAdmin === 'true';

  if (isSuperAdmin) {
    const superAdminSection = document.getElementById('superAdminSection');
    if (superAdminSection) {
      superAdminSection.style.display = 'block';
      await loadSuperAdminData();
    }
  }
}

async function loadSuperAdminData() {
  if (!isSuperAdmin) return;

  try {
    // Load global statistics
    await loadGlobalStatistics();
    // Load organizations list
    await loadOrganizations();
    // Setup event listeners
    initSuperAdminUI();
  } catch (error) {
    console.error('Error loading super admin data:', error);
  }
}

async function loadGlobalStatistics() {
  try {
    const response = await fetch('/api/super-admin/statistics', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load global statistics');
      return;
    }

    const result = await response.json();
    if (result.success && result.data) {
      const stats = result.data;
      updateElement('statTotalOrgs', stats.totalOrganizations || 0);
      updateElement('statGlobalKunder', stats.totalKunder || 0);
      updateElement('statGlobalBrukere', stats.totalBrukere || 0);
      updateElement('statActiveOrgs', stats.activeOrganizations || 0);
    }
  } catch (error) {
    console.error('Error loading global statistics:', error);
  }
}

function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function loadOrganizations() {
  try {
    const response = await fetch('/api/super-admin/organizations', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load organizations');
      return;
    }

    const result = await response.json();
    if (result.success) {
      // Support paginated response format
      const data = result.data;
      superAdminOrganizations = Array.isArray(data) ? data : (data.organizations || []);
      renderOrganizationList();
    }
  } catch (error) {
    console.error('Error loading organizations:', error);
  }
}

function renderOrganizationList(filter = '') {
  const tbody = document.getElementById('orgListBody');
  if (!tbody) return;

  const filtered = filter
    ? superAdminOrganizations.filter(org =>
        org.navn.toLowerCase().includes(filter.toLowerCase()) ||
        org.slug.toLowerCase().includes(filter.toLowerCase())
      )
    : superAdminOrganizations;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          ${filter ? 'Ingen organisasjoner funnet' : 'Ingen organisasjoner registrert'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(org => {
    const planBadge = getPlanBadge(org.plan_type);
    const statusBadge = getSubscriptionStatusBadge(org.subscription_status);
    const opprettet = org.opprettet ? new Date(org.opprettet).toLocaleDateString('nb-NO') : '-';

    return `
      <tr data-org-id="${org.id}">
        <td><strong>${escapeHtml(org.navn)}</strong><br><small style="color: var(--text-tertiary);">${escapeHtml(org.slug)}</small></td>
        <td>${planBadge}</td>
        <td>${statusBadge}</td>
        <td>${org.kunde_count || 0}</td>
        <td>${org.bruker_count || 0}</td>
        <td>${opprettet}</td>
        <td>
          <button class="btn btn-small btn-secondary" data-action="selectOrganization" data-org-id="${org.id}">
            <i aria-hidden="true" class="fas fa-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function getPlanBadge(plan) {
  const badges = {
    'free': '<span class="badge badge-secondary">Gratis</span>',
    'standard': '<span class="badge badge-primary">Standard</span>',
    'premium': '<span class="badge badge-success">Premium</span>',
    'enterprise': '<span class="badge badge-warning">Enterprise</span>'
  };
  return badges[plan] || badges.free;
}

function getSubscriptionStatusBadge(status) {
  const badges = {
    'active': '<span class="badge badge-success">Aktiv</span>',
    'trialing': '<span class="badge badge-info">Prøveperiode</span>',
    'past_due': '<span class="badge badge-warning">Forfalt</span>',
    'canceled': '<span class="badge badge-danger">Kansellert</span>',
    'incomplete': '<span class="badge badge-secondary">Ufullstendig</span>'
  };
  return badges[status] || '<span class="badge badge-secondary">Ukjent</span>';
}

async function selectOrganization(orgId) {
  selectedOrgId = orgId;

  try {
    // Load organization details
    const response = await fetch(`/api/super-admin/organizations/${orgId}`, {
      credentials: 'include'
    });

    if (!response.ok) {
      showNotification('Kunne ikke laste organisasjonsdetaljer', 'error');
      return;
    }

    const result = await response.json();
    if (result.success) {
      selectedOrgData = result.data;
      renderSelectedOrganization();

      // Show the details section
      const detailsSection = document.getElementById('selectedOrgSection');
      if (detailsSection) {
        detailsSection.style.display = 'block';
        detailsSection.scrollIntoView({ behavior: 'smooth' });
      }

      // Load customers for this org
      await loadOrgCustomers(orgId);
      await loadOrgUsers(orgId);
    }
  } catch (error) {
    console.error('Error loading organization:', error);
    showNotification('Feil ved lasting av organisasjon', 'error');
  }
}

function renderSelectedOrganization() {
  if (!selectedOrgData) return;

  updateElement('selectedOrgName', selectedOrgData.navn);
  updateElement('orgInfoSlug', selectedOrgData.slug);
  updateElement('orgInfoPlan', selectedOrgData.plan_type || 'free');
  updateElement('orgInfoSubscription', selectedOrgData.subscription_status || 'ukjent');
  updateElement('orgInfoIndustry', selectedOrgData.industry_template_id ? `ID: ${selectedOrgData.industry_template_id}` : 'Ingen');
}

async function loadOrgCustomers(orgId) {
  try {
    const response = await fetch(`/api/super-admin/organizations/${orgId}/kunder`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load org customers');
      return;
    }

    const result = await response.json();
    if (result.success) {
      const kunder = result.data?.data || [];
      renderOrgCustomers(kunder);
      updateElement('orgCustomerCount', kunder.length);
    }
  } catch (error) {
    console.error('Error loading org customers:', error);
  }
}

function renderOrgCustomers(customers) {
  const tbody = document.getElementById('orgCustomersBody');
  if (!tbody) return;

  if (customers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          Ingen kunder registrert
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = customers.map(kunde => `
    <tr data-kunde-id="${kunde.id}">
      <td><strong>${escapeHtml(kunde.navn)}</strong></td>
      <td>${escapeHtml(kunde.adresse || '-')}</td>
      <td>${escapeHtml(kunde.telefon || '-')}</td>
      <td>${escapeHtml(kunde.epost || '-')}</td>
      <td>
        <button class="btn-icon" data-action="editOrgCustomer" data-kunde-id="${kunde.id}" title="Rediger">
          <i aria-hidden="true" class="fas fa-pen"></i>
        </button>
        <button class="btn-icon delete" data-action="deleteOrgCustomer" data-kunde-id="${kunde.id}" title="Slett">
          <i aria-hidden="true" class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

async function loadOrgUsers(orgId) {
  try {
    const response = await fetch(`/api/super-admin/organizations/${orgId}/brukere`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load org users');
      return;
    }

    const result = await response.json();
    if (result.success) {
      renderOrgUsers(result.data || []);
      updateElement('orgUserCount', (result.data || []).length);
    }
  } catch (error) {
    console.error('Error loading org users:', error);
  }
}

function renderOrgUsers(users) {
  const tbody = document.getElementById('orgUsersBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          Ingen brukere registrert
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = users.map(user => {
    const sistInnlogget = user.sist_innlogget
      ? formatRelativeTime(user.sist_innlogget)
      : 'Aldri';
    const opprettet = user.opprettet
      ? new Date(user.opprettet).toLocaleDateString('nb-NO')
      : '-';

    return `
      <tr>
        <td><strong>${escapeHtml(user.navn)}</strong></td>
        <td>${escapeHtml(user.epost)}</td>
        <td>${sistInnlogget}</td>
        <td>${opprettet}</td>
      </tr>
    `;
  }).join('');
}

function closeOrgDetails() {
  selectedOrgId = null;
  selectedOrgData = null;
  const detailsSection = document.getElementById('selectedOrgSection');
  if (detailsSection) {
    detailsSection.style.display = 'none';
  }
}

async function addOrgCustomer() {
  if (!selectedOrgId) return;

  // Use the existing customer modal but in "add for org" mode
  openCustomerModal(null, selectedOrgId);
}

async function editOrgCustomer(kundeId) {
  if (!selectedOrgId) return;

  try {
    // Fetch customer data
    const response = await fetch(`/api/super-admin/organizations/${selectedOrgId}/kunder`, {
      credentials: 'include'
    });

    if (!response.ok) return;

    const result = await response.json();
    const kunde = (result.data?.data || []).find(k => k.id === kundeId);

    if (kunde) {
      openCustomerModal(kunde, selectedOrgId);
    }
  } catch (error) {
    console.error('Error fetching customer:', error);
  }
}

async function deleteOrgCustomer(kundeId) {
  if (!selectedOrgId) return;

  const confirmed = await showConfirm('Er du sikker på at du vil slette denne kunden?', 'Slett');
  if (!confirmed) return;

  try {
    const deleteHeaders = {};
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      deleteHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(`/api/super-admin/organizations/${selectedOrgId}/kunder/${kundeId}`, {
      method: 'DELETE',
      headers: deleteHeaders,
      credentials: 'include'
    });

    if (response.ok) {
      showNotification('Kunde slettet');
      await loadOrgCustomers(selectedOrgId);
      await loadGlobalStatistics();
    } else {
      const result = await response.json();
      showNotification(result.error?.message || 'Kunne ikke slette kunden', 'error');
    }
  } catch (error) {
    console.error('Error deleting customer:', error);
    showNotification('Feil ved sletting av kunde', 'error');
  }
}

// Open customer modal for super admin - reuse existing modal or create simple version
function openCustomerModal(kunde = null, forOrgId = null) {
  // For super admin, we'll create a simple modal inline
  const existingModal = document.getElementById('superAdminCustomerModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'superAdminCustomerModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <div class="modal-header">
        <h2>${kunde ? 'Rediger kunde' : 'Ny kunde'}</h2>
        <button class="modal-close" id="saCloseModalBtn">&times;</button>
      </div>
      <form id="superAdminCustomerForm">
        <input type="hidden" id="saKundeId" value="${kunde?.id || ''}">
        <input type="hidden" id="saKundeOrgId" value="${forOrgId || ''}">

        <div class="form-group">
          <label for="saKundeNavn">Navn *</label>
          <input type="text" id="saKundeNavn" value="${escapeHtml(kunde?.navn || '')}" required>
        </div>

        <div class="form-group">
          <label for="saKundeAdresse">Adresse *</label>
          <input type="text" id="saKundeAdresse" value="${escapeHtml(kunde?.adresse || '')}" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="saKundePostnummer">Postnummer</label>
            <input type="text" id="saKundePostnummer" value="${escapeHtml(kunde?.postnummer || '')}">
          </div>
          <div class="form-group">
            <label for="saKundePoststed">Poststed</label>
            <input type="text" id="saKundePoststed" value="${escapeHtml(kunde?.poststed || '')}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="saKundeTelefon">Telefon</label>
            <input type="text" id="saKundeTelefon" value="${escapeHtml(kunde?.telefon || '')}">
          </div>
          <div class="form-group">
            <label for="saKundeEpost">E-post</label>
            <input type="email" id="saKundeEpost" value="${escapeHtml(kunde?.epost || '')}">
          </div>
        </div>

        <div class="form-group">
          <label for="saKundeKontaktperson">Kontaktperson</label>
          <input type="text" id="saKundeKontaktperson" value="${escapeHtml(kunde?.kontaktperson || '')}">
        </div>

        <div class="form-group">
          <label for="saKundeNotater">Notater</label>
          <textarea id="saKundeNotater" rows="3">${escapeHtml(kunde?.notater || '')}</textarea>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="saCancelModalBtn">Avbryt</button>
          <button type="submit" class="btn btn-primary">${kunde ? 'Lagre' : 'Opprett'}</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  // Attach event listeners (CSP-compliant, no inline handlers)
  document.getElementById('saCloseModalBtn').addEventListener('click', closeSuperAdminCustomerModal);
  document.getElementById('saCancelModalBtn').addEventListener('click', closeSuperAdminCustomerModal);
  document.getElementById('superAdminCustomerForm').addEventListener('submit', saveSuperAdminCustomer);
}

function closeSuperAdminCustomerModal() {
  const modal = document.getElementById('superAdminCustomerModal');
  if (modal) modal.remove();
}

async function saveSuperAdminCustomer(e) {
  e.preventDefault();

  const kundeId = document.getElementById('saKundeId').value;
  const orgId = document.getElementById('saKundeOrgId').value;

  const data = {
    navn: document.getElementById('saKundeNavn').value,
    adresse: document.getElementById('saKundeAdresse').value,
    postnummer: document.getElementById('saKundePostnummer').value,
    poststed: document.getElementById('saKundePoststed').value,
    telefon: document.getElementById('saKundeTelefon').value,
    epost: document.getElementById('saKundeEpost').value,
    kontaktperson: document.getElementById('saKundeKontaktperson').value,
    notater: document.getElementById('saKundeNotater').value
  };

  try {
    let url = `/api/super-admin/organizations/${orgId}/kunder`;
    let method = 'POST';

    if (kundeId) {
      url += `/${kundeId}`;
      method = 'PUT';
    }

    const saHeaders = {
      'Content-Type': 'application/json'
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      saHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(url, {
      method,
      headers: saHeaders,
      credentials: 'include',
      body: JSON.stringify(data)
    });

    if (response.ok) {
      showNotification(kundeId ? 'Kunde oppdatert' : 'Kunde opprettet');
      closeSuperAdminCustomerModal();
      await loadOrgCustomers(orgId);
      await loadGlobalStatistics();
    } else {
      const result = await response.json();
      showNotification(result.error?.message || 'Kunne ikke lagre kunden', 'error');
    }
  } catch (error) {
    console.error('Error saving customer:', error);
    showNotification('Feil ved lagring av kunde', 'error');

  }
}

function initSuperAdminUI() {
  // Organization search
  const orgSearchInput = document.getElementById('orgSearchInput');
  if (orgSearchInput) {
    orgSearchInput.addEventListener('input', debounce((e) => {
      renderOrganizationList(e.target.value);
    }, 300));
  }

  // Close org details button
  const closeOrgBtn = document.getElementById('closeOrgDetailsBtn');
  if (closeOrgBtn) {
    closeOrgBtn.addEventListener('click', closeOrgDetails);
  }

  // Add customer button
  const addOrgCustomerBtn = document.getElementById('addOrgCustomerBtn');
  if (addOrgCustomerBtn) {
    addOrgCustomerBtn.addEventListener('click', addOrgCustomer);
  }

  // Organization detail tabs
  const tabBtns = document.querySelectorAll('.org-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // Update active button
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide tabs
      document.getElementById('orgCustomersTab').style.display = tab === 'customers' ? 'block' : 'none';
      document.getElementById('orgUsersTab').style.display = tab === 'users' ? 'block' : 'none';
    });
  });

  // Event delegation for super admin data-action buttons (CSP-compliant)
  const superAdminSection = document.getElementById('superAdminSection');
  if (superAdminSection) {
    superAdminSection.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;

      const action = actionEl.dataset.action;
      switch (action) {
        case 'selectOrganization': {
          const orgId = Number(actionEl.dataset.orgId);
          if (orgId) selectOrganization(orgId);
          break;
        }
        case 'editOrgCustomer': {
          const kundeId = Number(actionEl.dataset.kundeId);
          if (kundeId) editOrgCustomer(kundeId);
          break;
        }
        case 'deleteOrgCustomer': {
          const kundeId = Number(actionEl.dataset.kundeId);
          if (kundeId) deleteOrgCustomer(kundeId);
          break;
        }
      }
    });
  }
}

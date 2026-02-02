/**
 * Efffekt Admin Panel JavaScript
 * Super-admin functionality for managing all organizations
 */

const API_BASE = '/api/super-admin';
const AUTH_API = '/api/klient';

// State
let organizations = [];
let selectedOrgId = null;
let editingCustomerId = null;

// DOM Elements
const loadingOverlay = document.getElementById('loadingOverlay');
const adminApp = document.getElementById('adminApp');
const orgPanel = document.getElementById('orgPanel');
const customerModal = document.getElementById('customerModal');

// ========================================
// INITIALIZATION
// ========================================

async function initAdminPanel() {
  try {
    // Get token from localStorage
    const token = localStorage.getItem('authToken');
    console.log('[Admin] Token found:', !!token);

    if (!token) {
      console.log('[Admin] No token, redirecting to login');
      redirectToLogin();
      return;
    }

    // Verify super-admin status
    const verifyRes = await fetchWithAuth(`${AUTH_API}/verify`);
    console.log('[Admin] Verify response status:', verifyRes.status);

    if (!verifyRes.ok) {
      console.log('[Admin] Verify failed, redirecting to login');
      redirectToLogin();
      return;
    }

    const verifyData = await verifyRes.json();
    console.log('[Admin] Verify data:', verifyData);
    console.log('[Admin] User isSuperAdmin:', verifyData.data?.user?.isSuperAdmin);

    if (!verifyData.data?.user?.isSuperAdmin) {
      console.log('[Admin] Not super-admin, redirecting to main app');
      // Not a super-admin, redirect to main app
      window.location.href = '/';
      return;
    }

    // Show admin app
    loadingOverlay.style.display = 'none';
    adminApp.style.display = 'block';

    // Set user name
    document.getElementById('adminUserName').textContent = verifyData.data.user.navn || verifyData.data.user.epost;

    // Setup event listeners
    setupEventListeners();

    // Load data
    await Promise.all([
      loadGlobalStats(),
      loadOrganizations()
    ]);

  } catch (error) {
    console.error('Failed to initialize admin panel:', error);
    showError('Kunne ikke laste admin panel');
  }
}

function redirectToLogin() {
  localStorage.removeItem('authToken');
  window.location.href = '/?redirect=admin';
}

// ========================================
// EVENT LISTENERS
// ========================================

function setupEventListeners() {
  // Logout
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // Search
  document.getElementById('orgSearchInput').addEventListener('input', handleSearch);

  // Panel close
  document.getElementById('closePanelBtn').addEventListener('click', closePanel);

  // Impersonate button
  document.getElementById('impersonateBtn').addEventListener('click', () => {
    if (selectedOrgId) {
      impersonateOrg(selectedOrgId);
    }
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = e.currentTarget.dataset.tab;
      switchTab(tabId);
    });
  });

  // Add customer button
  document.getElementById('addCustomerBtn').addEventListener('click', () => {
    openCustomerModal();
  });

  // Customer modal
  document.getElementById('closeCustomerModal').addEventListener('click', closeCustomerModal);
  document.getElementById('cancelCustomerBtn').addEventListener('click', closeCustomerModal);
  document.querySelector('#customerModal .modal-backdrop').addEventListener('click', closeCustomerModal);
  document.getElementById('customerForm').addEventListener('submit', handleCustomerSubmit);

  // Click outside panel to close
  document.addEventListener('click', (e) => {
    if (orgPanel.classList.contains('open') &&
        !orgPanel.contains(e.target) &&
        !e.target.closest('.btn-view') &&
        !e.target.closest('.btn-impersonate-small')) {
      closePanel();
    }
  });
}

// ========================================
// API HELPERS
// ========================================

async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('authToken');
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });
}

// ========================================
// DATA LOADING
// ========================================

async function loadGlobalStats() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/statistics`);
    const data = await res.json();

    if (data.success) {
      document.getElementById('statTotalOrgs').textContent = data.data.totalOrganizations || 0;
      document.getElementById('statTotalCustomers').textContent = data.data.totalKunder || 0;
      document.getElementById('statActiveSubscriptions').textContent = data.data.activeSubscriptions || 0;
      document.getElementById('statTotalUsers').textContent = data.data.totalBrukere || 0;
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

async function loadOrganizations() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/organizations`);
    const data = await res.json();

    if (data.success) {
      organizations = data.data || [];
      renderOrganizations(organizations);
    }
  } catch (error) {
    console.error('Failed to load organizations:', error);
    showError('Kunne ikke laste bedrifter');
  }
}

// ========================================
// RENDERING
// ========================================

function renderOrganizations(orgs) {
  const tbody = document.getElementById('orgsTableBody');

  if (orgs.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">Ingen bedrifter funnet</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = orgs.map(org => `
    <tr data-org-id="${org.id}">
      <td class="org-name-cell">
        <strong>${escapeHtml(org.navn)}</strong>
        <small>${escapeHtml(org.slug)}</small>
      </td>
      <td>
        <span class="count-badge">${org.stats?.kundeCount || 0}</span>
        <small class="muted">/ ${org.stats?.maxKunder || 100}</small>
      </td>
      <td>
        <span class="count-badge">${org.stats?.brukerCount || 0}</span>
        <small class="muted">/ ${org.stats?.maxBrukere || 5}</small>
      </td>
      <td>
        <span class="plan-badge plan-${org.plan_type || 'free'}">${getPlanLabel(org.plan_type)}</span>
      </td>
      <td>
        <span class="status-badge status-${org.subscription_status || 'inactive'}">${getStatusLabel(org.subscription_status)}</span>
      </td>
      <td>
        <span class="date-text">${formatDate(org.opprettet)}</span>
      </td>
      <td class="actions-cell">
        <button class="btn-sm btn-view" onclick="selectOrg(${org.id})">
          <i class="fas fa-eye"></i> Vis
        </button>
        <button class="btn-sm btn-impersonate-small" onclick="impersonateOrg(${org.id})">
          <i class="fas fa-user-secret"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function getPlanLabel(plan) {
  const labels = {
    'free': 'Gratis',
    'standard': 'Standard',
    'premium': 'Premium',
    'enterprise': 'Enterprise'
  };
  return labels[plan] || 'Gratis';
}

function getStatusLabel(status) {
  const labels = {
    'active': 'Aktiv',
    'trialing': 'Proveperiode',
    'past_due': 'Forfalt',
    'canceled': 'Avsluttet',
    'incomplete': 'Ufullstendig'
  };
  return labels[status] || 'Inaktiv';
}

// ========================================
// ORGANIZATION PANEL
// ========================================

async function selectOrg(orgId) {
  selectedOrgId = orgId;
  orgPanel.classList.add('open');

  // Find org in list
  const org = organizations.find(o => o.id === orgId);
  if (!org) return;

  document.getElementById('orgPanelTitle').textContent = org.navn;

  // Render org info
  const infoGrid = document.getElementById('orgInfoGrid');
  infoGrid.innerHTML = `
    <div class="info-item">
      <label>Slug</label>
      <span>${escapeHtml(org.slug)}</span>
    </div>
    <div class="info-item">
      <label>Plan</label>
      <span class="plan-badge plan-${org.plan_type || 'free'}">${getPlanLabel(org.plan_type)}</span>
    </div>
    <div class="info-item">
      <label>Status</label>
      <span class="status-badge status-${org.subscription_status || 'inactive'}">${getStatusLabel(org.subscription_status)}</span>
    </div>
    <div class="info-item">
      <label>Opprettet</label>
      <span>${formatDate(org.opprettet)}</span>
    </div>
    <div class="info-item">
      <label>Maks kunder</label>
      <span>${org.stats?.kundeCount || 0} / ${org.stats?.maxKunder || 100}</span>
    </div>
    <div class="info-item">
      <label>Maks brukere</label>
      <span>${org.stats?.brukerCount || 0} / ${org.stats?.maxBrukere || 5}</span>
    </div>
  `;

  // Load customers and users
  await Promise.all([
    loadOrgCustomers(orgId),
    loadOrgUsers(orgId)
  ]);
}

async function loadOrgCustomers(orgId) {
  const customersList = document.getElementById('customersList');
  customersList.innerHTML = '<div class="loading-text"><i class="fas fa-spinner fa-spin"></i> Laster kunder...</div>';

  try {
    const res = await fetchWithAuth(`${API_BASE}/organizations/${orgId}/kunder`);
    const data = await res.json();

    if (data.success) {
      const kunder = data.data.kunder || [];
      document.getElementById('customerCount').textContent = `${kunder.length} kunder`;

      if (kunder.length === 0) {
        customersList.innerHTML = '<div class="empty-text">Ingen kunder registrert</div>';
        return;
      }

      customersList.innerHTML = kunder.map(k => `
        <div class="customer-card" data-id="${k.id}">
          <div class="customer-main">
            <strong>${escapeHtml(k.navn)}</strong>
            <span class="customer-address">${escapeHtml(k.adresse || '')} ${escapeHtml(k.poststed || '')}</span>
          </div>
          <div class="customer-actions">
            <button class="btn-icon" onclick="editCustomer(${k.id})" title="Rediger">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon btn-danger" onclick="deleteCustomer(${k.id})" title="Slett">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Failed to load customers:', error);
    customersList.innerHTML = '<div class="error-text">Kunne ikke laste kunder</div>';
  }
}

async function loadOrgUsers(orgId) {
  const usersList = document.getElementById('usersList');
  usersList.innerHTML = '<div class="loading-text"><i class="fas fa-spinner fa-spin"></i> Laster brukere...</div>';

  try {
    const res = await fetchWithAuth(`${API_BASE}/organizations/${orgId}/brukere`);
    const data = await res.json();

    if (data.success) {
      const users = data.data || [];

      if (users.length === 0) {
        usersList.innerHTML = '<div class="empty-text">Ingen brukere registrert</div>';
        return;
      }

      usersList.innerHTML = users.map(u => `
        <div class="user-card">
          <div class="user-avatar">
            <i class="fas fa-user"></i>
          </div>
          <div class="user-info">
            <strong>${escapeHtml(u.navn)}</strong>
            <span>${escapeHtml(u.epost)}</span>
            <span class="user-role">${u.rolle || 'Bruker'}</span>
          </div>
          <div class="user-status ${u.aktiv ? 'active' : 'inactive'}">
            ${u.aktiv ? 'Aktiv' : 'Inaktiv'}
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Failed to load users:', error);
    usersList.innerHTML = '<div class="error-text">Kunne ikke laste brukere</div>';
  }
}

function closePanel() {
  orgPanel.classList.remove('open');
  selectedOrgId = null;
}

function switchTab(tabId) {
  // Update buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabId}`);
  });
}

// ========================================
// IMPERSONATION
// ========================================

async function impersonateOrg(orgId) {
  const org = organizations.find(o => o.id === orgId);
  const orgName = org?.navn || 'denne bedriften';

  if (!confirm(`Du vil na logge inn som "${orgName}".\n\nDu vil se appen akkurat som denne bedriften ser den.\n\nFortsett?`)) {
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/impersonate/${orgId}`, {
      method: 'POST'
    });
    const data = await res.json();

    if (data.success) {
      // Store impersonation token and state
      localStorage.setItem('authToken', data.data.token);
      localStorage.setItem('isImpersonating', 'true');
      localStorage.setItem('impersonatingOrgId', orgId.toString());
      localStorage.setItem('impersonatingOrgName', data.data.organization.navn);

      // Redirect to main app
      window.location.href = '/';
    } else {
      showError(data.error?.message || 'Kunne ikke logge inn som bedriften');
    }
  } catch (error) {
    console.error('Impersonation failed:', error);
    showError('Kunne ikke logge inn som bedriften');
  }
}

// ========================================
// CUSTOMER MANAGEMENT
// ========================================

function openCustomerModal(customerId = null) {
  editingCustomerId = customerId;
  document.getElementById('customerModalTitle').textContent = customerId ? 'Rediger kunde' : 'Legg til kunde';
  document.getElementById('customerForm').reset();

  // TODO: If editing, load customer data into form

  customerModal.classList.add('open');
}

function closeCustomerModal() {
  customerModal.classList.remove('open');
  editingCustomerId = null;
}

async function handleCustomerSubmit(e) {
  e.preventDefault();

  const form = e.target;
  const formData = new FormData(form);
  const customerData = Object.fromEntries(formData.entries());
  const saveBtn = document.getElementById('saveCustomerBtn');
  const originalBtnText = saveBtn.textContent;

  // Set loading state
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Lagrer...';

  try {
    let res;
    if (editingCustomerId) {
      // Update existing customer
      res = await fetchWithAuth(`${API_BASE}/organizations/${selectedOrgId}/kunder/${editingCustomerId}`, {
        method: 'PUT',
        body: JSON.stringify(customerData)
      });
    } else {
      // Create new customer
      res = await fetchWithAuth(`${API_BASE}/organizations/${selectedOrgId}/kunder`, {
        method: 'POST',
        body: JSON.stringify(customerData)
      });
    }

    const data = await res.json();

    if (data.success) {
      closeCustomerModal();
      await loadOrgCustomers(selectedOrgId);
      await loadGlobalStats();
      showSuccess(editingCustomerId ? 'Kunde oppdatert' : 'Kunde opprettet');
    } else {
      showError(data.error?.message || 'Kunne ikke lagre kunde');
    }
  } catch (error) {
    console.error('Failed to save customer:', error);
    showError('Kunne ikke lagre kunde');
  } finally {
    // Always reset button state
    saveBtn.disabled = false;
    saveBtn.textContent = originalBtnText;
  }
}

async function editCustomer(customerId) {
  // Capture current org ID to prevent race conditions
  const orgIdAtStart = selectedOrgId;

  if (!orgIdAtStart) {
    showError('Ingen organisasjon valgt');
    return;
  }

  try {
    // Get current customer data from the list
    const res = await fetchWithAuth(`${API_BASE}/organizations/${orgIdAtStart}/kunder?limit=500`);
    const data = await res.json();

    // Check if org changed during the async operation
    if (selectedOrgId !== orgIdAtStart) {
      console.log('Organization changed during edit, aborting');
      return;
    }

    if (data.success) {
      const customer = data.data.kunder.find(k => k.id === customerId);
      if (customer) {
        // Only set editingCustomerId after we've verified the data is valid
        editingCustomerId = customerId;
        document.getElementById('customerModalTitle').textContent = 'Rediger kunde';
        document.getElementById('kundeNavn').value = customer.navn || '';
        document.getElementById('kundeAdresse').value = customer.adresse || '';
        document.getElementById('kundePostnummer').value = customer.postnummer || '';
        document.getElementById('kundePoststed').value = customer.poststed || '';
        document.getElementById('kundeTelefon').value = customer.telefon || '';
        document.getElementById('kundeEpost').value = customer.epost || '';
        document.getElementById('kundeKontaktperson').value = customer.kontaktperson || '';
        document.getElementById('kundeNotater').value = customer.notater || '';
        customerModal.classList.add('open');
      } else {
        showError('Kunde ikke funnet');
      }
    }
  } catch (error) {
    console.error('Failed to load customer:', error);
    showError('Kunne ikke laste kundedata');
  }
}

async function deleteCustomer(customerId) {
  if (!confirm('Er du sikker pa at du vil slette denne kunden?')) {
    return;
  }

  try {
    const res = await fetchWithAuth(`${API_BASE}/organizations/${selectedOrgId}/kunder/${customerId}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (data.success) {
      await loadOrgCustomers(selectedOrgId);
      await loadGlobalStats();
      showSuccess('Kunde slettet');
    } else {
      showError(data.error?.message || 'Kunne ikke slette kunde');
    }
  } catch (error) {
    console.error('Failed to delete customer:', error);
    showError('Kunne ikke slette kunde');
  }
}

// ========================================
// SEARCH & FILTER
// ========================================

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();

  if (!query) {
    renderOrganizations(organizations);
    return;
  }

  const filtered = organizations.filter(org =>
    org.navn.toLowerCase().includes(query) ||
    org.slug.toLowerCase().includes(query)
  );

  renderOrganizations(filtered);
}

// ========================================
// LOGOUT
// ========================================

async function handleLogout() {
  try {
    await fetchWithAuth(`${AUTH_API}/logout`, { method: 'POST' });
  } catch (error) {
    console.error('Logout request failed:', error);
  }

  localStorage.removeItem('authToken');
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('impersonatingOrgId');
  localStorage.removeItem('impersonatingOrgName');
  window.location.href = '/';
}

// ========================================
// UTILITIES
// ========================================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('nb-NO');
  } catch {
    return dateStr;
  }
}

function showError(message) {
  // Simple alert for now - can be replaced with toast/notification
  alert(message);
}

function showSuccess(message) {
  // Simple alert for now - can be replaced with toast/notification
  console.log('Success:', message);
}

// ========================================
// STARTUP
// ========================================

document.addEventListener('DOMContentLoaded', initAdminPanel);

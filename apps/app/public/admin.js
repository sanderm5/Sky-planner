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
let editingUserId = null;

// Chart instances
let growthChart = null;
let activityChart = null;
let planChart = null;

// DOM Elements
const loadingOverlay = document.getElementById('loadingOverlay');
const adminApp = document.getElementById('adminApp');
const orgPanel = document.getElementById('orgPanel');
const customerModal = document.getElementById('customerModal');
const userModal = document.getElementById('userModal');

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
      loadOrganizations(),
      loadGrowthChart(),
      loadActivityChart(),
      loadBillingOverview()
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

  // User modal
  document.getElementById('closeUserModal').addEventListener('click', closeUserModal);
  document.getElementById('cancelUserBtn').addEventListener('click', closeUserModal);
  document.querySelector('#userModal .modal-backdrop').addEventListener('click', closeUserModal);
  document.getElementById('userForm').addEventListener('submit', handleUserSubmit);
  document.getElementById('resetPasswordBtn').addEventListener('click', handleResetPassword);

  // Login history
  document.getElementById('viewLoginHistoryBtn').addEventListener('click', () => showLoginHistory());
  document.getElementById('backToUsersBtn').addEventListener('click', () => hideLoginHistory());
  document.getElementById('loginStatusFilter').addEventListener('change', () => loadLoginHistory(selectedOrgId));
  document.getElementById('loginEpostFilter').addEventListener('input', debounce(() => loadLoginHistory(selectedOrgId), 300));

  // Chart period selectors
  document.getElementById('growthPeriodSelect').addEventListener('change', (e) => {
    loadGrowthChart(parseInt(e.target.value));
  });
  document.getElementById('activityPeriodSelect').addEventListener('change', (e) => {
    loadActivityChart(parseInt(e.target.value));
  });

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
      document.getElementById('statTotalCustomers').textContent = data.data.totalCustomers || data.data.totalKunder || 0;
      document.getElementById('statActiveSubscriptions').textContent = data.data.activeSubscriptions || 0;
      document.getElementById('statTotalUsers').textContent = data.data.totalUsers || data.data.totalBrukere || 0;

      // Update plan chart
      if (data.data.organizationsByPlan) {
        updatePlanChart(data.data.organizationsByPlan);
      }
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

// ========================================
// CHARTS
// ========================================

async function loadGrowthChart(months = 12) {
  try {
    const res = await fetchWithAuth(`${API_BASE}/statistics/growth?months=${months}`);
    const data = await res.json();

    if (data.success) {
      const { organizations, customers, users } = data.data;

      // Calculate growth rate
      if (organizations.length >= 2) {
        const lastMonth = organizations[organizations.length - 1]?.count || 0;
        const prevMonth = organizations[organizations.length - 2]?.count || 0;
        const growthRate = prevMonth > 0 ? Math.round((lastMonth / prevMonth - 1) * 100) : 0;
        document.getElementById('kpiGrowthRate').textContent = `${growthRate >= 0 ? '+' : ''}${growthRate}%`;
      }

      // Create/update chart
      const ctx = document.getElementById('growthChart').getContext('2d');

      if (growthChart) {
        growthChart.destroy();
      }

      // Fill in missing months
      const allMonths = generateMonthLabels(months);
      const orgData = mapDataToMonths(organizations, allMonths);
      const customerData = mapDataToMonths(customers, allMonths);
      const userData = mapDataToMonths(users, allMonths);

      growthChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: allMonths.map(m => formatMonthLabel(m)),
          datasets: [
            {
              label: 'Organisasjoner',
              data: orgData,
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              tension: 0.3,
              fill: true
            },
            {
              label: 'Kunder',
              data: customerData,
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              tension: 0.3,
              fill: true
            },
            {
              label: 'Brukere',
              data: userData,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              tension: 0.3,
              fill: true
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#a0a0a0', boxWidth: 12, padding: 16 }
            }
          },
          scales: {
            x: {
              grid: { color: '#333333' },
              ticks: { color: '#a0a0a0' }
            },
            y: {
              grid: { color: '#333333' },
              ticks: { color: '#a0a0a0' },
              beginAtZero: true
            }
          }
        }
      });
    }
  } catch (error) {
    console.error('Failed to load growth chart:', error);
  }
}

async function loadActivityChart(days = 30) {
  try {
    const res = await fetchWithAuth(`${API_BASE}/statistics/activity?days=${days}`);
    const data = await res.json();

    if (data.success) {
      const { loginsByDay, activeUsers7Days, activeUsers30Days, totalLogins } = data.data;

      // Update KPIs
      document.getElementById('kpiActiveUsers7').textContent = activeUsers7Days || 0;
      document.getElementById('kpiActiveUsers30').textContent = activeUsers30Days || 0;
      document.getElementById('kpiTotalLogins').textContent = totalLogins || 0;

      // Create/update chart
      const ctx = document.getElementById('activityChart').getContext('2d');

      if (activityChart) {
        activityChart.destroy();
      }

      activityChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: loginsByDay.map(d => formatDateShort(d.date)),
          datasets: [
            {
              label: 'Vellykkede',
              data: loginsByDay.map(d => d.successful),
              backgroundColor: 'rgba(34, 197, 94, 0.7)',
              borderRadius: 4
            },
            {
              label: 'Feilede',
              data: loginsByDay.map(d => d.failed),
              backgroundColor: 'rgba(239, 68, 68, 0.7)',
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#a0a0a0', boxWidth: 12, padding: 16 }
            }
          },
          scales: {
            x: {
              stacked: true,
              grid: { display: false },
              ticks: { color: '#a0a0a0', maxRotation: 45 }
            },
            y: {
              stacked: true,
              grid: { color: '#333333' },
              ticks: { color: '#a0a0a0' },
              beginAtZero: true
            }
          }
        }
      });
    }
  } catch (error) {
    console.error('Failed to load activity chart:', error);
  }
}

function updatePlanChart(planData) {
  const ctx = document.getElementById('planChart').getContext('2d');

  if (planChart) {
    planChart.destroy();
  }

  const labels = [];
  const values = [];
  const colors = {
    free: '#666666',
    standard: '#3b82f6',
    premium: '#a855f7',
    enterprise: '#f59e0b'
  };
  const bgColors = [];

  for (const [plan, count] of Object.entries(planData)) {
    labels.push(getPlanLabel(plan));
    values.push(count);
    bgColors.push(colors[plan] || '#666666');
  }

  planChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#a0a0a0', boxWidth: 12, padding: 12 }
        }
      }
    }
  });
}

// Chart helpers
function generateMonthLabels(months) {
  const labels = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return labels;
}

function mapDataToMonths(data, months) {
  const map = {};
  for (const item of data) {
    map[item.month] = item.count;
  }
  return months.map(m => map[m] || 0);
}

function formatMonthLabel(month) {
  const [year, m] = month.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${monthNames[parseInt(m) - 1]} ${year.slice(2)}`;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
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
      document.getElementById('userCount').textContent = `${users.length} brukere`;

      if (users.length === 0) {
        usersList.innerHTML = '<div class="empty-text">Ingen brukere registrert</div>';
        return;
      }

      usersList.innerHTML = users.map(u => `
        <div class="user-card" onclick="openUserModal(${u.id})" data-user-id="${u.id}">
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

      // Store users for modal
      window.currentOrgUsers = users;
    }
  } catch (error) {
    console.error('Failed to load users:', error);
    usersList.innerHTML = '<div class="error-text">Kunne ikke laste brukere</div>';
  }
}

// ========================================
// USER MANAGEMENT
// ========================================

function openUserModal(userId) {
  editingUserId = userId;
  const user = window.currentOrgUsers?.find(u => u.id === userId);

  if (!user) {
    showError('Bruker ikke funnet');
    return;
  }

  document.getElementById('userModalTitle').textContent = 'Rediger bruker';
  document.getElementById('editUserId').value = userId;
  document.getElementById('userNavn').value = user.navn || '';
  document.getElementById('userEpost').value = user.epost || '';
  document.getElementById('userTelefon').value = user.telefon || '';
  document.getElementById('userRolle').value = user.rolle || 'medlem';
  document.getElementById('userAktiv').value = user.aktiv ? 'true' : 'false';

  userModal.classList.add('open');
}

function closeUserModal() {
  userModal.classList.remove('open');
  editingUserId = null;
}

async function handleUserSubmit(e) {
  e.preventDefault();

  if (!editingUserId || !selectedOrgId) return;

  const saveBtn = document.getElementById('saveUserBtn');
  const originalText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Lagrer...';

  try {
    const userData = {
      navn: document.getElementById('userNavn').value,
      epost: document.getElementById('userEpost').value,
      telefon: document.getElementById('userTelefon').value,
      rolle: document.getElementById('userRolle').value,
      aktiv: document.getElementById('userAktiv').value === 'true'
    };

    const res = await fetchWithAuth(`${API_BASE}/organizations/${selectedOrgId}/brukere/${editingUserId}`, {
      method: 'PUT',
      body: JSON.stringify(userData)
    });

    const data = await res.json();

    if (data.success) {
      closeUserModal();
      await loadOrgUsers(selectedOrgId);
      showSuccess('Bruker oppdatert');
    } else {
      showError(data.error?.message || 'Kunne ikke oppdatere bruker');
    }
  } catch (error) {
    console.error('Failed to update user:', error);
    showError('Kunne ikke oppdatere bruker');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

async function handleResetPassword() {
  if (!editingUserId || !selectedOrgId) return;

  const user = window.currentOrgUsers?.find(u => u.id === editingUserId);
  if (!confirm(`Send e-post for tilbakestilling av passord til ${user?.epost || 'denne brukeren'}?`)) {
    return;
  }

  const btn = document.getElementById('resetPasswordBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sender...';

  try {
    const res = await fetchWithAuth(`${API_BASE}/organizations/${selectedOrgId}/brukere/${editingUserId}/reset-password`, {
      method: 'POST'
    });

    const data = await res.json();

    if (data.success) {
      showSuccess(`E-post sendt til ${data.data.epost}`);
    } else {
      showError(data.error?.message || 'Kunne ikke sende reset-epost');
    }
  } catch (error) {
    console.error('Failed to reset password:', error);
    showError('Kunne ikke sende reset-epost');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// ========================================
// LOGIN HISTORY
// ========================================

function showLoginHistory() {
  document.getElementById('tab-users').classList.remove('active');
  document.getElementById('tab-login-history').classList.add('active');
  loadLoginHistory(selectedOrgId);
}

function hideLoginHistory() {
  document.getElementById('tab-login-history').classList.remove('active');
  document.getElementById('tab-users').classList.add('active');
}

async function loadLoginHistory(orgId) {
  if (!orgId) return;

  const list = document.getElementById('loginHistoryList');
  list.innerHTML = '<div class="loading-text"><i class="fas fa-spinner fa-spin"></i> Laster historikk...</div>';

  const status = document.getElementById('loginStatusFilter').value;
  const epost = document.getElementById('loginEpostFilter').value;

  let url = `${API_BASE}/organizations/${orgId}/login-history?limit=50`;
  if (status) url += `&status=${status}`;
  if (epost) url += `&epost=${encodeURIComponent(epost)}`;

  try {
    const res = await fetchWithAuth(url);
    const data = await res.json();

    if (data.success) {
      const { logs, total } = data.data;

      if (logs.length === 0) {
        list.innerHTML = '<div class="empty-text">Ingen innlogginger funnet</div>';
        return;
      }

      list.innerHTML = logs.map(log => `
        <div class="login-entry">
          <div class="login-status-icon ${log.status === 'vellykket' ? 'success' : 'failed'}">
            <i class="fas fa-${log.status === 'vellykket' ? 'check' : 'times'}"></i>
          </div>
          <div class="login-details">
            <strong>${escapeHtml(log.bruker_navn || log.epost)}</strong>
            <small>${escapeHtml(log.epost)}</small>
            ${log.feil_melding ? `<small style="color: #f87171;">${escapeHtml(log.feil_melding)}</small>` : ''}
          </div>
          <div class="login-time">
            ${formatDateTime(log.tidspunkt)}
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Failed to load login history:', error);
    list.innerHTML = '<div class="error-text">Kunne ikke laste historikk</div>';
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('nb-NO', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

// ========================================
// BILLING
// ========================================

async function loadBillingOverview() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/billing/overview`);
    const data = await res.json();

    if (data.success) {
      document.getElementById('statMRR').textContent = data.data.mrrFormatted || '0 kr';
    }
  } catch (error) {
    console.error('Failed to load billing overview:', error);
  }
}

async function loadOrgBilling(orgId) {
  const billingInfo = document.getElementById('billingInfo');
  const invoicesList = document.getElementById('invoicesList');

  billingInfo.innerHTML = '<div class="loading-text"><i class="fas fa-spinner fa-spin"></i> Laster faktureringsinformasjon...</div>';
  invoicesList.innerHTML = '';

  try {
    // Load billing info and invoices in parallel
    const [billingRes, invoicesRes] = await Promise.all([
      fetchWithAuth(`${API_BASE}/organizations/${orgId}/billing`),
      fetchWithAuth(`${API_BASE}/organizations/${orgId}/invoices`)
    ]);

    const billingData = await billingRes.json();
    const invoicesData = await invoicesRes.json();

    if (billingData.success) {
      const billing = billingData.data;

      if (!billing.hasStripe) {
        billingInfo.innerHTML = `
          <div class="no-stripe-message">
            <i class="fas fa-credit-card"></i>
            <p>Ingen Stripe-kunde tilknyttet</p>
            <small>Plan: ${getPlanLabel(billing.plan_type)}</small>
          </div>
        `;
      } else if (billing.stripeError) {
        billingInfo.innerHTML = `
          <div class="no-stripe-message">
            <i class="fas fa-exclamation-triangle"></i>
            <p>Kunne ikke hente Stripe-data</p>
            <small>Plan: ${getPlanLabel(billing.plan_type)} | Status: ${getStatusLabel(billing.subscription_status)}</small>
          </div>
        `;
      } else {
        const sub = billing.subscription;
        billingInfo.innerHTML = `
          <div class="billing-grid">
            <div class="billing-grid-item">
              <div class="value">${getPlanLabel(billing.plan_type)}</div>
              <div class="label">Plan</div>
            </div>
            <div class="billing-grid-item">
              <div class="value status-badge status-${billing.subscription_status}">${getStatusLabel(billing.subscription_status)}</div>
              <div class="label">Status</div>
            </div>
            ${sub ? `
              <div class="billing-grid-item">
                <div class="value">${formatAmount(sub.amount, sub.currency)}</div>
                <div class="label">Per ${sub.interval === 'month' ? 'mnd' : 'ar'}</div>
              </div>
              <div class="billing-grid-item">
                <div class="value">${formatDate(sub.current_period_end)}</div>
                <div class="label">Neste faktura</div>
              </div>
            ` : ''}
          </div>
          ${billing.customer ? `
            <div class="billing-card">
              <h5>Stripe-kunde</h5>
              <div class="billing-value">${escapeHtml(billing.customer.name || billing.customer.email)}</div>
              <div class="billing-detail">${escapeHtml(billing.customer.email)}</div>
              <div class="billing-detail">ID: ${billing.customer.id}</div>
            </div>
          ` : ''}
          ${sub?.trial_end ? `
            <div class="billing-card">
              <h5>Proveperiode</h5>
              <div class="billing-value">Utloper ${formatDate(sub.trial_end)}</div>
            </div>
          ` : ''}
          ${sub?.cancel_at_period_end ? `
            <div class="billing-card" style="border-left: 3px solid var(--danger-color);">
              <h5>Avslutning</h5>
              <div class="billing-value">Avsluttes ${formatDate(sub.current_period_end)}</div>
            </div>
          ` : ''}
        `;
      }
    }

    // Render invoices
    if (invoicesData.success && invoicesData.data.invoices?.length > 0) {
      invoicesList.innerHTML = invoicesData.data.invoices.map(inv => `
        <div class="invoice-item">
          <div class="invoice-info">
            <strong>${inv.number || inv.id.slice(-8)}</strong>
            <small>${formatDate(inv.created)}</small>
          </div>
          <div class="invoice-amount">
            ${formatAmount(inv.amount, inv.currency)}
            <span class="invoice-status ${inv.status}">${getInvoiceStatusLabel(inv.status)}</span>
          </div>
          <div class="invoice-actions">
            ${inv.hosted_invoice_url ? `<a href="${inv.hosted_invoice_url}" target="_blank" title="Vis faktura"><i class="fas fa-external-link-alt"></i></a>` : ''}
            ${inv.invoice_pdf ? `<a href="${inv.invoice_pdf}" target="_blank" title="Last ned PDF"><i class="fas fa-file-pdf"></i></a>` : ''}
          </div>
        </div>
      `).join('');
    } else {
      invoicesList.innerHTML = '<div class="empty-text">Ingen fakturaer</div>';
    }

  } catch (error) {
    console.error('Failed to load billing:', error);
    billingInfo.innerHTML = '<div class="error-text">Kunne ikke laste faktureringsinformasjon</div>';
  }
}

function formatAmount(amount, currency = 'nok') {
  if (!amount) return '0 kr';
  const value = amount / 100; // Stripe amounts are in cents
  return `${value.toLocaleString('nb-NO')} ${currency.toUpperCase() === 'NOK' ? 'kr' : currency.toUpperCase()}`;
}

function getInvoiceStatusLabel(status) {
  const labels = {
    'paid': 'Betalt',
    'open': 'Apen',
    'draft': 'Utkast',
    'uncollectible': 'Ikke innkrevbar',
    'void': 'Kansellert'
  };
  return labels[status] || status;
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

  // Load billing data when switching to billing tab
  if (tabId === 'billing' && selectedOrgId) {
    loadOrgBilling(selectedOrgId);
  }
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

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// ========================================
// STARTUP
// ========================================

document.addEventListener('DOMContentLoaded', initAdminPanel);

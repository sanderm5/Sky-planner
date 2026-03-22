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
let sentryChart = null;

// Sentry monitoring state
let sentryConfigured = false;
let sentryAutoRefreshInterval = null;

// DOM Elements
const loadingOverlay = document.getElementById('loadingOverlay');
const adminApp = document.getElementById('adminApp');
const orgPanel = document.getElementById('orgPanel');
const customerModal = document.getElementById('customerModal');
const userModal = document.getElementById('userModal');
const deleteOrgModal = document.getElementById('deleteOrgModal');

// State for delete modal
let orgToDelete = null;

// ========================================
// INITIALIZATION
// ========================================

async function initAdminPanel() {
  try {
    // Verify super-admin status (auth via httpOnly cookie)
    const verifyRes = await fetchWithAuth(`${AUTH_API}/verify`);

    if (!verifyRes.ok) {
      redirectToLogin();
      return;
    }

    const verifyData = await verifyRes.json();

    if (!verifyData.data?.user?.isSuperAdmin) {
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
      loadBillingOverview(),
      loadSentryStatus(),
      loadSystemMonitor(),
      loadSupportConversations(),
      loadBroadcastStatus(),
      loadMaintenanceStatus()
    ]);

    // Start system monitor auto-refresh
    startSystemMonitorAutoRefresh();

    // Setup broadcast + maintenance (run first — critical)
    setupBroadcastListeners();

    // Setup support chat
    setupSupportChatListeners();
    initSupportWebSocket();

  } catch (error) {
    console.error('Failed to initialize admin panel:', error);
    showError('Kunne ikke laste admin panel');
  }
}

function redirectToLogin() {
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

  // Delete organization
  document.getElementById('deleteOrgBtn').addEventListener('click', () => {
    if (selectedOrgId) {
      openDeleteOrgModal(selectedOrgId);
    }
  });
  document.getElementById('closeDeleteOrgModal').addEventListener('click', closeDeleteOrgModal);
  document.getElementById('cancelDeleteOrgBtn').addEventListener('click', closeDeleteOrgModal);
  document.querySelector('#deleteOrgModal .modal-backdrop').addEventListener('click', closeDeleteOrgModal);
  document.getElementById('confirmOrgName').addEventListener('input', validateDeleteConfirmation);
  document.getElementById('confirmDeleteOrgBtn').addEventListener('click', handleDeleteOrg);

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

  // Sentry monitoring
  document.getElementById('sentryRefreshBtn').addEventListener('click', loadSentryOverview);
  document.getElementById('sentryAutoRefresh').addEventListener('change', toggleSentryAutoRefresh);
  document.getElementById('sentrySortSelect').addEventListener('change', (e) => {
    loadSentryIssues(e.target.value);
  });

  // System monitoring
  document.getElementById('monitorRefreshBtn').addEventListener('click', loadSystemMonitor);
  document.getElementById('monitorAutoRefresh').addEventListener('change', toggleSystemMonitorAutoRefresh);

  // Event delegation for dynamically rendered buttons (CSP-compliant, no inline onclick)
  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      switch (action) {
        case 'selectOrg': {
          const orgId = Number(actionEl.dataset.orgId);
          if (orgId) selectOrg(orgId);
          break;
        }
        case 'impersonateOrg': {
          const orgId = Number(actionEl.dataset.orgId);
          if (orgId) impersonateOrg(orgId);
          break;
        }
        case 'editCustomer': {
          const customerId = Number(actionEl.dataset.customerId);
          if (customerId) editCustomer(customerId);
          break;
        }
        case 'deleteCustomer': {
          const customerId = Number(actionEl.dataset.customerId);
          if (customerId) deleteCustomer(customerId);
          break;
        }
        case 'openUserModal': {
          const userId = Number(actionEl.dataset.userId);
          if (userId) openUserModal(userId);
          break;
        }
      }
      return; // Handled action, skip click-outside check
    }

    // Click outside panel to close (but not when modals are open)
    if (orgPanel.classList.contains('open') &&
        !orgPanel.contains(e.target) &&
        !e.target.closest('.btn-view') &&
        !e.target.closest('.btn-impersonate-small') &&
        !e.target.closest('.modal')) {
      closePanel();
    }
  });
}

// ========================================
// API HELPERS
// ========================================

function getCsrfToken() {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : '';
}

async function fetchWithAuth(url, options = {}) {
  const csrfToken = getCsrfToken();
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
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
      // Handle paginated response format: { organizations: [...], pagination: {...} }
      organizations = Array.isArray(data.data) ? data.data : (data.data?.organizations || []);
      renderOrganizations(organizations);
    } else {
      console.error('Failed to load organizations:', data);
      const tbody = document.getElementById('orgsTableBody');
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7" style="color: #f87171;">Feil: ${escapeHtml(data.error?.message || 'Ukjent feil')}</td>
        </tr>
      `;
    }
  } catch (error) {
    console.error('Failed to load organizations:', error);
    const tbody = document.getElementById('orgsTableBody');
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7" style="color: #f87171;">Nettverksfeil: ${escapeHtml(error.message)}</td>
      </tr>
    `;
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
        <button class="btn-sm btn-view" data-action="selectOrg" data-org-id="${org.id}">
          <i class="fas fa-eye"></i> Vis
        </button>
        <button class="btn-sm btn-impersonate-small" data-action="impersonateOrg" data-org-id="${org.id}">
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
      const kunder = data.data.data || [];
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
            <button class="btn-icon" data-action="editCustomer" data-customer-id="${k.id}" title="Rediger">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon btn-danger" data-action="deleteCustomer" data-customer-id="${k.id}" title="Slett">
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
        <div class="user-card" data-action="openUserModal" data-user-id="${u.id}">
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
                <div class="label">Per ${sub.interval === 'month' ? 'mnd' : 'år'}</div>
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
    'open': 'Åpen',
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
      // Store impersonation state (token is set via httpOnly cookie by server)
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
      const customer = (data.data.data || []).find(k => k.id === customerId);
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
  if (!confirm('Er du sikker på at du vil slette denne kunden?')) {
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
// ORGANIZATION DELETION
// ========================================

function openDeleteOrgModal(orgId) {
  const org = organizations.find(o => o.id === orgId);
  if (!org) return;

  orgToDelete = org;

  document.getElementById('deleteOrgName').textContent = org.navn;
  document.getElementById('confirmOrgName').value = '';
  document.getElementById('confirmDeleteOrgBtn').disabled = true;

  // Show stats
  const stats = org.stats || {};
  document.getElementById('deletionStats').innerHTML = `
    <div class="stat-item">
      <i class="fas fa-users"></i>
      <span><strong>${stats.kundeCount || 0}</strong> kunder</span>
    </div>
    <div class="stat-item">
      <i class="fas fa-user-cog"></i>
      <span><strong>${stats.brukerCount || 0}</strong> brukere</span>
    </div>
  `;

  deleteOrgModal.classList.add('open');
}

function closeDeleteOrgModal() {
  deleteOrgModal.classList.remove('open');
  orgToDelete = null;
}

function validateDeleteConfirmation() {
  const input = document.getElementById('confirmOrgName').value.trim();
  const confirmBtn = document.getElementById('confirmDeleteOrgBtn');

  // Enable button only if org name matches exactly
  confirmBtn.disabled = !orgToDelete || input !== orgToDelete.navn;
}

async function handleDeleteOrg() {
  if (!orgToDelete) return;

  const orgId = orgToDelete.id;
  const orgName = orgToDelete.navn;

  // Double-confirm
  if (!confirm(`ADVARSEL: Du er i ferd med å permanent slette "${orgName}" og ALLE tilknyttede data.\n\nDenne handlingen KAN IKKE ANGRES.\n\nEr du helt sikker?`)) {
    return;
  }

  const btn = document.getElementById('confirmDeleteOrgBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sletter...';

  try {
    const res = await fetchWithAuth(`${API_BASE}/organizations/${orgId}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (data.success) {
      closeDeleteOrgModal();
      closePanel();
      await loadOrganizations();
      await loadGlobalStats();
      showSuccess('Bedrift slettet');
    } else {
      showError(data.error?.message || 'Kunne ikke slette bedrift');
    }
  } catch (error) {
    console.error('Failed to delete organization:', error);
    showError('Kunne ikke slette bedrift');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
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

  // Close support chat WebSocket
  closeSupportWebSocket();

  // Clear UI state (auth cookie is cleared by server)
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('impersonatingOrgId');
  localStorage.removeItem('impersonatingOrgName');
  localStorage.removeItem('userName');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  localStorage.removeItem('isSuperAdmin');
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
// SENTRY MONITORING
// ========================================

async function loadSentryStatus() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/sentry/status`);
    const data = await res.json();

    if (data.success && data.data.configured) {
      sentryConfigured = true;
      document.getElementById('sentrySection').style.display = 'block';
      await loadSentryOverview();
      startSentryAutoRefresh();
    }
  } catch (error) {
    console.error('Failed to check Sentry status:', error);
  }
}

async function loadSentryOverview() {
  if (!sentryConfigured) return;

  try {
    const res = await fetchWithAuth(`${API_BASE}/sentry/overview`);
    const data = await res.json();

    if (data.success) {
      const { unresolvedCount, criticalCount, eventsToday, issues, eventsTrend } = data.data;

      document.getElementById('sentryUnresolvedCount').textContent = unresolvedCount;
      document.getElementById('sentryCriticalCount').textContent = criticalCount;
      document.getElementById('sentryEventsToday').textContent = eventsToday;

      updateSentryHealthStatus(criticalCount, unresolvedCount);
      renderSentryIssues(issues);

      if (eventsTrend && eventsTrend.length > 0) {
        renderSentryChart(eventsTrend);
      }
    }
  } catch (error) {
    console.error('Failed to load Sentry overview:', error);
    document.getElementById('sentryIssuesList').innerHTML =
      '<div class="sentry-error-text">Kunne ikke laste feildata fra Sentry</div>';
  }
}

function updateSentryHealthStatus(criticalCount, unresolvedCount) {
  const statusEl = document.getElementById('sentryHealthStatus');
  const iconEl = document.getElementById('sentryHealthIcon');

  if (criticalCount > 0) {
    statusEl.textContent = 'Kritisk';
    statusEl.className = 'sentry-stat-value sentry-health-critical';
    iconEl.className = 'sentry-stat-icon sentry-health-critical-icon';
  } else if (unresolvedCount > 5) {
    statusEl.textContent = 'Advarsel';
    statusEl.className = 'sentry-stat-value sentry-health-warning';
    iconEl.className = 'sentry-stat-icon sentry-health-warning-icon';
  } else {
    statusEl.textContent = 'OK';
    statusEl.className = 'sentry-stat-value sentry-health-ok';
    iconEl.className = 'sentry-stat-icon sentry-health-ok-icon';
  }
}

function renderSentryIssues(issues) {
  const list = document.getElementById('sentryIssuesList');

  if (!issues || issues.length === 0) {
    list.innerHTML = '<div class="sentry-empty-state"><i class="fas fa-check-circle"></i><span>Ingen uloste feil!</span></div>';
    return;
  }

  list.innerHTML = issues.slice(0, 15).map(issue => `
    <div class="sentry-issue-item sentry-level-${escapeHtml(issue.level)}">
      <div class="sentry-issue-level">
        <i class="fas fa-${getSentryLevelIcon(issue.level)}"></i>
      </div>
      <div class="sentry-issue-info">
        <div class="sentry-issue-title" title="${escapeHtml(issue.title)}">${escapeHtml(issue.title)}</div>
        <div class="sentry-issue-meta">
          <span class="sentry-issue-culprit">${escapeHtml(issue.culprit || '')}</span>
          <span class="sentry-issue-id">${escapeHtml(issue.shortId)}</span>
        </div>
      </div>
      <div class="sentry-issue-stats">
        <span class="sentry-issue-count" title="Antall hendelser">${escapeHtml(String(issue.count))}</span>
        <span class="sentry-issue-users" title="Berarte brukere"><i class="fas fa-users"></i> ${issue.userCount || 0}</span>
        <span class="sentry-issue-time">${formatSentryTimeAgo(issue.lastSeen)}</span>
      </div>
      <div class="sentry-issue-actions">
        <a href="${escapeHtml(issue.permalink)}" target="_blank" rel="noopener noreferrer"
           class="btn-icon" title="Apne i Sentry">
          <i class="fas fa-external-link-alt"></i>
        </a>
      </div>
    </div>
  `).join('');
}

function getSentryLevelIcon(level) {
  const icons = {
    'fatal': 'skull-crossbones',
    'error': 'exclamation-circle',
    'warning': 'exclamation-triangle',
    'info': 'info-circle',
    'debug': 'bug'
  };
  return icons[level] || 'exclamation-circle';
}

function renderSentryChart(eventsTrend) {
  const ctx = document.getElementById('sentryErrorChart').getContext('2d');

  if (sentryChart) {
    sentryChart.destroy();
  }

  const labels = eventsTrend.map(p => {
    const d = new Date(p.timestamp * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  sentryChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Feilhendelser',
        data: eventsTrend.map(p => p.count),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        tension: 0.3,
        fill: true,
        pointRadius: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { color: '#333333' },
          ticks: { color: '#a0a0a0', maxTicksLimit: 12 }
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

function formatSentryTimeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Akkurat na';
  if (diffMin < 60) return `${diffMin}m siden`;
  if (diffHrs < 24) return `${diffHrs}t siden`;
  return `${diffDays}d siden`;
}

function startSentryAutoRefresh() {
  if (sentryAutoRefreshInterval) clearInterval(sentryAutoRefreshInterval);
  sentryAutoRefreshInterval = setInterval(loadSentryOverview, 60000);
}

function stopSentryAutoRefresh() {
  if (sentryAutoRefreshInterval) {
    clearInterval(sentryAutoRefreshInterval);
    sentryAutoRefreshInterval = null;
  }
}

function toggleSentryAutoRefresh(e) {
  if (e.target.checked) {
    startSentryAutoRefresh();
  } else {
    stopSentryAutoRefresh();
  }
}

async function loadSentryIssues(sort) {
  if (!sentryConfigured) return;

  const list = document.getElementById('sentryIssuesList');
  list.innerHTML = '<div class="loading-text"><i class="fas fa-spinner fa-spin"></i> Laster feil...</div>';

  try {
    const res = await fetchWithAuth(`${API_BASE}/sentry/issues?sort=${encodeURIComponent(sort)}&limit=15`);
    const data = await res.json();

    if (data.success) {
      renderSentryIssues(data.data.issues);
    }
  } catch (error) {
    console.error('Failed to load Sentry issues:', error);
    list.innerHTML = '<div class="sentry-error-text">Kunne ikke laste feil</div>';
  }
}

// ========================================
// SYSTEM MONITORING
// ========================================

let systemMonitorInterval = null;

async function loadSystemMonitor() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/system-monitor`);
    if (!res.ok) {
      console.warn('System monitor endpoint returned', res.status);
      return;
    }
    const data = await res.json();

    if (data.success && data.data) {
      const d = data.data;
      renderMonitorSummaryCards(d);
      renderDetectedIssues(d.issues || []);
      renderRequestMetrics(d.requests || {});
      renderCircuitBreakers(d.circuit_breakers || {});
      renderCronJobs(d.cron_jobs || []);
      renderIntegrationSyncs(d.integrations || { total_active: 0, recent_syncs: [], failed_items_count: 0 });
      renderServiceHealth(d.services || {});
      renderFrontendErrors(d.frontend_errors || { total_15m: 0, unique_errors: 0, errors: [] });
      renderSecurityEvents(d.security || { failed_logins_24h: 0, locked_accounts: 0, recent_events: [] });
      renderDataIntegrity(d.data_integrity || {});
    }
  } catch (error) {
    console.error('Failed to load system monitor:', error);
  }
}

function renderMonitorSummaryCards(data) {
  // Uptime
  document.getElementById('monitorUptime').textContent = formatUptime(data.server.uptime_seconds);

  // Memory — show current + peak
  const memEl = document.getElementById('monitorMemory');
  const mem = data.memory;
  memEl.textContent = `${mem.heap_used_mb} MB`;
  if (mem.peak_heap_mb > 0) {
    memEl.textContent += ` (topp: ${mem.peak_heap_mb})`;
  }
  const memCard = memEl.closest('.sentry-stat-card');
  memCard.className = 'sentry-stat-card monitor-stat-memory';
  if (mem.heap_used_mb > 1024) memCard.classList.add('status-critical');
  else if (mem.heap_used_mb > 512) memCard.classList.add('status-warning');
  else memCard.classList.add('status-healthy');

  // Database — show live latency + rolling average
  const dbEl = document.getElementById('monitorDbLatency');
  const dbCard = dbEl.closest('.sentry-stat-card');
  dbCard.className = 'sentry-stat-card monitor-stat-db';
  const db = data.database;
  if (db.status === 'healthy') {
    let dbText = `${db.latency_ms} ms`;
    if (db.samples > 1) dbText += ` (snitt: ${db.avg_ms}, p95: ${db.p95_ms})`;
    dbEl.textContent = dbText;
    dbCard.classList.add('status-healthy');
  } else if (db.status === 'degraded') {
    dbEl.textContent = `${db.latency_ms} ms (treg, snitt: ${db.avg_ms})`;
    dbCard.classList.add('status-warning');
  } else {
    dbEl.textContent = 'Nede';
    dbCard.classList.add('status-critical');
  }

  // Request metrics cards
  const rps = data.requests;
  document.getElementById('monitorRps').textContent = rps ? `${rps.per_second}` : '-';
  document.getElementById('monitorAvgResponse').textContent = rps ? `${rps.avg_response_ms} ms` : '-';

  const errorRateEl = document.getElementById('monitorErrorRate');
  if (rps) {
    errorRateEl.textContent = `${rps.error_rate_percent}%`;
    const errorCard = errorRateEl.closest('.sentry-stat-card');
    errorCard.className = 'sentry-stat-card monitor-stat-errors';
    if (rps.error_rate_percent > 5) errorCard.classList.add('status-critical');
    else if (rps.error_rate_percent > 1) errorCard.classList.add('status-warning');
    else errorCard.classList.add('status-healthy');
  }

  // WebSocket connections
  const wsEl = document.getElementById('monitorWsConnections');
  const ws = data.websocket;
  wsEl.textContent = ws ? `${ws.total} (${ws.organizations} org)` : '-';

  // Overall status
  const overallEl = document.getElementById('monitorOverallStatus');
  const overallCard = overallEl.closest('.sentry-stat-card');
  overallCard.className = 'sentry-stat-card monitor-stat-overall';
  const statusLabels = { healthy: 'Alt OK', degraded: 'Degradert', unhealthy: 'Kritisk' };
  const statusClasses = { healthy: 'status-healthy', degraded: 'status-warning', unhealthy: 'status-critical' };
  overallEl.textContent = statusLabels[data.overall_status] || data.overall_status;
  overallCard.classList.add(statusClasses[data.overall_status] || 'status-healthy');

  const iconEl = document.getElementById('monitorOverallIcon');
  iconEl.style.color = data.overall_status === 'healthy' ? 'var(--success-color)' :
    data.overall_status === 'degraded' ? 'var(--warning-color)' : 'var(--danger-color)';
}

function renderDetectedIssues(issues) {
  const container = document.getElementById('monitorIssuesContainer');
  const list = document.getElementById('monitorIssuesList');
  const countEl = document.getElementById('monitorIssuesCount');

  if (!issues || issues.length === 0) {
    container.style.display = 'block';
    countEl.style.background = 'var(--success-color)';
    countEl.textContent = '0';
    list.innerHTML = '<div class="monitor-no-issues"><i class="fas fa-check-circle"></i>Ingen problemer oppdaget</div>';
    return;
  }

  container.style.display = 'block';
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  countEl.textContent = issues.length;
  countEl.style.background = criticalCount > 0 ? 'var(--danger-color)' : 'var(--warning-color)';

  const severityIcons = {
    critical: 'fas fa-times',
    warning: 'fas fa-exclamation',
    info: 'fas fa-info',
  };

  list.innerHTML = issues.map(issue => {
    const icon = severityIcons[issue.severity] || 'fas fa-info';
    return `<div class="monitor-issue-item">
      <div class="monitor-issue-icon ${issue.severity}">
        <i class="${icon}"></i>
      </div>
      <div class="monitor-issue-body">
        <div class="monitor-issue-title">${escapeHtml(issue.title)}</div>
        <div class="monitor-issue-detail">${escapeHtml(issue.detail)}</div>
      </div>
      ${issue.metric ? `<div class="monitor-issue-metric">${escapeHtml(issue.metric)}</div>` : ''}
    </div>`;
  }).join('');
}

function renderRequestMetrics(requests) {
  const container = document.getElementById('monitorRequests');
  if (!requests || !requests.total_15m) {
    container.innerHTML = '<div class="monitor-empty">Ingen forespørsler registrert ennå</div>';
    return;
  }

  const sc = requests.status_codes || {};
  let html = `<div class="monitor-summary-row">
    <div class="monitor-summary-item">
      <span class="monitor-summary-value">${requests.total_15m}</span>
      <span class="monitor-summary-label">Totalt (15 min)</span>
    </div>
    <div class="monitor-summary-item">
      <span class="monitor-summary-value">${requests.p95_response_ms} ms</span>
      <span class="monitor-summary-label">P95 responstid</span>
    </div>
    <div class="monitor-summary-item">
      <span class="monitor-summary-value">${requests.p99_response_ms} ms</span>
      <span class="monitor-summary-label">P99 responstid</span>
    </div>
    <div class="monitor-summary-item">
      <span class="monitor-summary-value" style="color: var(--success-color)">${sc['2xx'] || 0}</span>
      <span class="monitor-summary-label">2xx</span>
    </div>
    <div class="monitor-summary-item">
      <span class="monitor-summary-value" style="color: var(--warning-color)">${sc['4xx'] || 0}</span>
      <span class="monitor-summary-label">4xx</span>
    </div>
    <div class="monitor-summary-item">
      <span class="monitor-summary-value" style="color: var(--danger-color)">${sc['5xx'] || 0}</span>
      <span class="monitor-summary-label">5xx</span>
    </div>
  </div>`;

  // Slowest endpoints
  if (requests.slowest_endpoints && requests.slowest_endpoints.length > 0) {
    html += `<table class="monitor-table">
      <thead><tr><th>Endepunkt</th><th>Snitt</th><th>Maks</th><th>Kall</th></tr></thead>
      <tbody>${requests.slowest_endpoints.map(ep => {
        const avgColor = ep.avgMs > 500 ? 'var(--danger-color)' : ep.avgMs > 200 ? 'var(--warning-color)' : 'var(--text-primary)';
        return `<tr>
          <td><code>${escapeHtml(ep.endpoint)}</code></td>
          <td style="color: ${avgColor}">${ep.avgMs} ms</td>
          <td>${ep.maxMs} ms</td>
          <td>${ep.count}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  container.innerHTML = html;
}

function renderCircuitBreakers(breakers) {
  const container = document.getElementById('monitorCircuitBreakers');
  const entries = Object.values(breakers);

  if (entries.length === 0) {
    container.innerHTML = '<div class="monitor-empty"><i class="fas fa-check-circle"></i>Ingen tjenester registrert ennå</div>';
    return;
  }

  container.innerHTML = entries.map(cb => {
    const dotClass = cb.state === 'CLOSED' ? 'healthy' : cb.state === 'HALF_OPEN' ? 'warning' : 'critical';
    const badgeClass = dotClass;
    const stateLabel = cb.state === 'CLOSED' ? 'OK' : cb.state === 'HALF_OPEN' ? 'Tester' : 'Nede';
    const lastChange = cb.lastStateChange ? formatMonitorTimeAgo(cb.lastStateChange) : '-';

    return `<div class="monitor-service-item">
      <div class="monitor-service-name">
        <span class="status-dot ${dotClass}"></span>
        ${escapeHtml(cb.name)}
      </div>
      <div class="monitor-service-meta">
        <span class="status-badge ${badgeClass}">${stateLabel}</span>
        <span title="Suksess / Feil">${cb.totalSuccesses ?? 0} / ${cb.totalFailures ?? 0}</span>
        <span title="Siste endring">${lastChange}</span>
      </div>
    </div>`;
  }).join('');
}

function renderCronJobs(jobs) {
  const container = document.getElementById('monitorCronJobs');

  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<div class="monitor-empty"><i class="fas fa-check-circle"></i>Ingen cron-jobber registrert</div>';
    return;
  }

  container.innerHTML = jobs.map(job => {
    let dotClass = 'healthy';
    if (job.consecutiveFailures >= 3) dotClass = 'critical';
    else if (job.consecutiveFailures >= 1) dotClass = 'warning';

    const lastRun = job.lastRun ? formatMonitorTimeAgo(job.lastRun) : 'Aldri';
    const lastSuccess = job.lastSuccess ? formatMonitorTimeAgo(job.lastSuccess) : 'Aldri';
    const runningBadge = job.isRunning ? '<span class="status-badge running">Kjører</span>' : '';

    return `<div class="monitor-service-item">
      <div class="monitor-service-name">
        <span class="status-dot ${dotClass}"></span>
        ${escapeHtml(job.name)}
        ${runningBadge}
      </div>
      <div class="monitor-service-meta">
        <span title="Siste kjøring">${lastRun}</span>
        <span title="Kjøringer: ${job.totalRuns}, Feil: ${job.totalFailures}">${job.totalRuns}/${job.totalFailures}</span>
        ${job.consecutiveFailures > 0 ? `<span class="status-badge ${dotClass}">${job.consecutiveFailures}x feil</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderIntegrationSyncs(data) {
  const container = document.getElementById('monitorIntegrations');

  let html = `<div class="monitor-summary-row">
    <div class="monitor-summary-item">
      <span class="monitor-summary-value">${data.total_active}</span>
      <span class="monitor-summary-label">Aktive</span>
    </div>
    <div class="monitor-summary-item">
      <span class="monitor-summary-value" style="color: ${data.failed_items_count > 0 ? 'var(--danger-color)' : 'var(--text-primary)'}">${data.failed_items_count}</span>
      <span class="monitor-summary-label">I feilkø</span>
    </div>
  </div>`;

  if (data.recent_syncs.length === 0) {
    html += '<div class="monitor-empty">Ingen synkroniseringer ennå</div>';
  } else {
    html += `<table class="monitor-table">
      <thead><tr><th>Integrasjon</th><th>Status</th><th>Tidspunkt</th></tr></thead>
      <tbody>${data.recent_syncs.map(s => {
        const statusClass = s.status === 'completed' ? 'healthy' : s.status === 'failed' ? 'critical' : 'warning';
        const statusLabel = s.status === 'completed' ? 'OK' : s.status === 'failed' ? 'Feilet' : s.status;
        const time = s.completed_at ? formatMonitorTimeAgo(s.completed_at) : '-';
        return `<tr>
          <td>${escapeHtml(s.integration_id)}</td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td>${time}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  container.innerHTML = html;
}

function renderSecurityEvents(data) {
  const container = document.getElementById('monitorSecurity');

  let html = `<div class="monitor-summary-row">
    <div class="monitor-summary-item">
      <span class="monitor-summary-value" style="color: ${data.failed_logins_24h > 10 ? 'var(--danger-color)' : 'var(--text-primary)'}">${data.failed_logins_24h}</span>
      <span class="monitor-summary-label">Feilede innlogginger (24t)</span>
    </div>
    <div class="monitor-summary-item">
      <span class="monitor-summary-value" style="color: ${data.locked_accounts > 0 ? 'var(--warning-color)' : 'var(--text-primary)'}">${data.locked_accounts}</span>
      <span class="monitor-summary-label">Låste kontoer</span>
    </div>
  </div>`;

  if (data.recent_events.length === 0) {
    html += '<div class="monitor-empty"><i class="fas fa-shield-alt"></i>Ingen feilede innlogginger</div>';
  } else {
    html += `<table class="monitor-table">
      <thead><tr><th>E-post</th><th>IP</th><th>Tidspunkt</th></tr></thead>
      <tbody>${data.recent_events.map(e => {
        const time = e.tidspunkt ? formatMonitorTimeAgo(e.tidspunkt) : '-';
        return `<tr>
          <td>${escapeHtml(e.epost || '-')}</td>
          <td>${escapeHtml(e.ip_adresse || '-')}</td>
          <td>${time}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  container.innerHTML = html;
}

function renderServiceHealth(services) {
  const container = document.getElementById('monitorServices');
  const labels = {
    email: { name: 'E-post', icon: 'fa-envelope' },
    webhook: { name: 'Webhooks', icon: 'fa-link' },
    geocoding: { name: 'Geokoding', icon: 'fa-map-marker-alt' },
    route_optimization: { name: 'Ruteoptimalisering', icon: 'fa-route' },
  };

  const entries = Object.entries(services);
  if (entries.length === 0) {
    container.innerHTML = '<div class="monitor-empty"><i class="fas fa-check-circle"></i>Ingen data ennå</div>';
    return;
  }

  container.innerHTML = entries.map(function([key, data]) {
    const label = labels[key] || { name: key, icon: 'fa-cog' };
    let dotClass = 'healthy';
    if (data.total >= 3 && data.failure_rate > 50) dotClass = 'critical';
    else if (data.total >= 2 && data.failure_rate > 20) dotClass = 'warning';
    else if (data.failures > 0) dotClass = 'warning';

    return '<div class="monitor-service-item">' +
      '<div class="monitor-service-name">' +
        '<span class="status-dot ' + dotClass + '"></span>' +
        '<i class="fas ' + label.icon + '" style="color: var(--text-muted); font-size: 11px;"></i> ' +
        escapeHtml(label.name) +
      '</div>' +
      '<div class="monitor-service-meta">' +
        '<span>' + data.successes + ' OK</span>' +
        (data.failures > 0 ? '<span style="color: var(--danger-color)">' + data.failures + ' feil</span>' : '') +
        (data.total > 0 ? '<span>' + data.total + ' totalt</span>' : '<span style="color: var(--text-muted)">0 kall</span>') +
      '</div>' +
    '</div>';
  }).join('');
}

function renderFrontendErrors(data) {
  const container = document.getElementById('monitorFrontendErrors');

  if (data.total_15m === 0) {
    container.innerHTML = '<div class="monitor-empty"><i class="fas fa-check-circle"></i>Ingen JavaScript-feil</div>';
    return;
  }

  let html = '<div class="monitor-summary-row">' +
    '<div class="monitor-summary-item">' +
      '<span class="monitor-summary-value" style="color: var(--danger-color)">' + data.total_15m + '</span>' +
      '<span class="monitor-summary-label">Feil (15 min)</span>' +
    '</div>' +
    '<div class="monitor-summary-item">' +
      '<span class="monitor-summary-value">' + data.unique_errors + '</span>' +
      '<span class="monitor-summary-label">Unike feil</span>' +
    '</div>' +
  '</div>';

  if (data.errors && data.errors.length > 0) {
    html += data.errors.map(function(err) {
      return '<div class="monitor-service-item">' +
        '<div class="monitor-service-name" style="flex-direction: column; align-items: flex-start; gap: 2px;">' +
          '<span style="font-weight: 600; color: var(--danger-color);">' + escapeHtml(err.message) + '</span>' +
          (err.source ? '<span style="font-size: 11px; color: var(--text-muted);">' + escapeHtml(err.source) + (err.line ? ':' + err.line : '') + '</span>' : '') +
        '</div>' +
        '<div class="monitor-service-meta">' +
          '<span class="status-badge critical">' + err.count + 'x</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  container.innerHTML = html;
}

function renderDataIntegrity(data) {
  const container = document.getElementById('monitorDataIntegrity');

  const checks = [
    {
      name: 'Kunder uten koordinater',
      value: data.customers_without_coords || 0,
      icon: 'fa-map-marker-alt',
      warn: 10,
      critical: 50,
      detail: 'Vises ikke på kartet',
    },
    {
      name: 'Ugruperte tags',
      value: data.orphaned_tags || 0,
      icon: 'fa-tags',
      warn: 20,
      critical: 100,
      detail: 'Tags uten gruppe',
    },
  ];

  container.innerHTML = checks.map(function(check) {
    let dotClass = 'healthy';
    if (check.value >= check.critical) dotClass = 'critical';
    else if (check.value >= check.warn) dotClass = 'warning';

    return '<div class="monitor-service-item">' +
      '<div class="monitor-service-name">' +
        '<span class="status-dot ' + dotClass + '"></span>' +
        '<i class="fas ' + check.icon + '" style="color: var(--text-muted); font-size: 11px;"></i> ' +
        escapeHtml(check.name) +
      '</div>' +
      '<div class="monitor-service-meta">' +
        '<span style="font-weight: 600;">' + check.value + '</span>' +
        (check.value > 0 ? '<span style="color: var(--text-muted); font-size: 11px;">' + check.detail + '</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}t ${mins}m`;
  if (hours > 0) return `${hours}t ${mins}m`;
  return `${mins}m`;
}

function formatMonitorTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Nå';
  if (mins < 60) return `${mins}m siden`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}t siden`;
  const days = Math.floor(hours / 24);
  return `${days}d siden`;
}

function startSystemMonitorAutoRefresh() {
  if (systemMonitorInterval) clearInterval(systemMonitorInterval);
  systemMonitorInterval = setInterval(loadSystemMonitor, 30000);
}

function stopSystemMonitorAutoRefresh() {
  if (systemMonitorInterval) {
    clearInterval(systemMonitorInterval);
    systemMonitorInterval = null;
  }
}

function toggleSystemMonitorAutoRefresh(e) {
  if (e.target.checked) {
    startSystemMonitorAutoRefresh();
  } else {
    stopSystemMonitorAutoRefresh();
  }
}

// ========================================
// SYSTEM BROADCAST
// ========================================

async function loadBroadcastStatus() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/broadcast`);
    if (!res.ok) return;
    const result = await res.json();
    if (result.success && result.data) {
      updateBroadcastUI(result.data.enabled, result.data.message);
    }
  } catch (e) {
    // Silent fail
  }
}

function updateBroadcastUI(enabled, message) {
  const status = document.getElementById('broadcastStatus');
  const textarea = document.getElementById('broadcastMessage');
  const sendBtn = document.getElementById('broadcastSendBtn');
  const clearBtn = document.getElementById('broadcastClearBtn');

  if (enabled && message) {
    status.innerHTML = '<span class="broadcast-status-dot active"></span><span>Aktiv: ' + escapeHtmlAdmin(message) + '</span>';
    textarea.value = message;
    sendBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Oppdater';
    clearBtn.style.display = 'inline-flex';
  } else {
    status.innerHTML = '<span class="broadcast-status-dot inactive"></span><span>Ingen aktiv melding</span>';
    textarea.value = '';
    sendBtn.innerHTML = '<i class="fas fa-bullhorn"></i> Publiser';
    clearBtn.style.display = 'none';
  }
}

async function sendBroadcast() {
  console.log('sendBroadcast called');
  const message = document.getElementById('broadcastMessage').value.trim();
  console.log('message:', message);
  if (!message) return alert('Skriv en melding først');

  try {
    const res = await fetchWithAuth(`${API_BASE}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({ enabled: true, message }),
    });
    console.log('broadcast response status:', res.status);
    const result = await res.json();
    console.log('broadcast result:', result);
    if (result.success) {
      updateBroadcastUI(true, result.data.message);
    }
  } catch (e) {
    console.error('Failed to send broadcast:', e);
  }
}

async function clearBroadcast() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    });
    if (!res.ok) return;
    updateBroadcastUI(false, '');
  } catch (e) {
    console.error('Failed to clear broadcast:', e);
  }
}

let adminMaintenanceTimerInterval = null;
let adminMaintenanceStartedAt = null;

function formatAdminMaintenanceDuration(startedAt) {
  if (!startedAt) return '';
  let elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (elapsed < 0) elapsed = 0;
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  if (h > 0) return `${h}t ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2,'0')}s`;
  return `${s}s`;
}

function startAdminMaintenanceTimer(startedAt, estimatedEnd) {
  adminMaintenanceStartedAt = startedAt;
  const timerEl = document.getElementById('maintenanceTimer');
  if (!timerEl) return;
  timerEl.style.display = 'block';
  const startTime = new Date(startedAt);
  const hh = String(startTime.getHours()).padStart(2, '0');
  const mm = String(startTime.getMinutes()).padStart(2, '0');
  const estText = estimatedEnd ? ` — Forventet ferdig kl. ${escapeHtmlAdmin(estimatedEnd)}` : '';
  timerEl.innerHTML = `<i class="fas fa-clock" style="margin-right:4px;font-size:11px;"></i> Startet kl. ${hh}:${mm}${estText} — Varighet: <span id="maintenanceTimerValue">${formatAdminMaintenanceDuration(startedAt)}</span>`;
  if (adminMaintenanceTimerInterval) clearInterval(adminMaintenanceTimerInterval);
  adminMaintenanceTimerInterval = setInterval(() => {
    const valEl = document.getElementById('maintenanceTimerValue');
    if (valEl) valEl.textContent = formatAdminMaintenanceDuration(adminMaintenanceStartedAt);
  }, 1000);
}

function stopAdminMaintenanceTimer() {
  adminMaintenanceStartedAt = null;
  if (adminMaintenanceTimerInterval) {
    clearInterval(adminMaintenanceTimerInterval);
    adminMaintenanceTimerInterval = null;
  }
  const timerEl = document.getElementById('maintenanceTimer');
  if (timerEl) timerEl.style.display = 'none';
}

async function loadMaintenanceStatus() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/maintenance`);
    if (!res.ok) return;
    const result = await res.json();
    if (result.success && result.data) {
      updateMaintenanceUI(result.data.enabled, result.data.mode, result.data.message, result.data.startedAt, result.data.estimatedEnd);
    }
  } catch (e) {
    // Silent fail
  }
}

function updateMaintenanceUI(enabled, mode, message, startedAt, estimatedEnd) {
  const status = document.getElementById('maintenanceStatus');
  const textarea = document.getElementById('maintenanceMessage');
  const onBtn = document.getElementById('maintenanceOnBtn');
  const offBtn = document.getElementById('maintenanceOffBtn');
  const estimatedEndInput = document.getElementById('maintenanceEstimatedEnd');

  if (enabled) {
    const modeText = mode === 'full' ? 'Full blokkering' : 'Banner';
    status.innerHTML = `<span class="broadcast-status-dot active" style="background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,0.4);"></span><span>Aktiv — ${escapeHtmlAdmin(modeText)}</span>`;
    if (message) textarea.value = message;
    if (estimatedEnd && estimatedEndInput) estimatedEndInput.value = estimatedEnd;
    onBtn.style.display = 'none';
    offBtn.style.display = 'inline-flex';
    // Set radio
    const radio = document.querySelector(`input[name="maintenanceMode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    if (startedAt) startAdminMaintenanceTimer(startedAt, estimatedEnd);
  } else {
    status.innerHTML = '<span class="broadcast-status-dot inactive"></span><span>Av</span>';
    onBtn.style.display = 'inline-flex';
    offBtn.style.display = 'none';
    if (estimatedEndInput) estimatedEndInput.value = '';
    stopAdminMaintenanceTimer();
  }
}

function isMaintenanceActive() {
  const offBtn = document.getElementById('maintenanceOffBtn');
  return offBtn && offBtn.style.display !== 'none';
}

function getMaintenanceFormValues() {
  const message = document.getElementById('maintenanceMessage').value.trim();
  const modeRadio = document.querySelector('input[name="maintenanceMode"]:checked');
  const mode = modeRadio ? modeRadio.value : 'banner';
  const estimatedEndInput = document.getElementById('maintenanceEstimatedEnd');
  const estimatedEnd = estimatedEndInput ? estimatedEndInput.value : '';
  return { message, mode, estimatedEnd };
}

async function sendMaintenanceUpdate(enabled) {
  const { message, mode, estimatedEnd } = getMaintenanceFormValues();
  try {
    const res = await fetchWithAuth(`${API_BASE}/maintenance`, {
      method: 'POST',
      body: JSON.stringify({ enabled, mode, message: message || undefined, estimatedEnd: estimatedEnd || null }),
    });
    if (!res.ok) return;
    const result = await res.json();
    if (result.success) {
      updateMaintenanceUI(result.data.enabled, result.data.mode, result.data.message, result.data.startedAt, result.data.estimatedEnd);
    }
  } catch (e) {
    console.error('Failed to update maintenance:', e);
  }
}

async function toggleMaintenance(enabled) {
  if (enabled) {
    const { message } = getMaintenanceFormValues();
    if (!message) return alert('Skriv en vedlikeholdsmelding først');
  }
  await sendMaintenanceUpdate(enabled);
}

function onMaintenanceSettingChanged() {
  if (isMaintenanceActive()) sendMaintenanceUpdate(true);
}

function setupBroadcastListeners() {
  const sendBtn = document.getElementById('broadcastSendBtn');
  if (sendBtn) sendBtn.addEventListener('click', sendBroadcast);
  const clearBtn = document.getElementById('broadcastClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearBroadcast);

  const maintenanceOnBtn = document.getElementById('maintenanceOnBtn');
  if (maintenanceOnBtn) maintenanceOnBtn.addEventListener('click', () => toggleMaintenance(true));
  const maintenanceOffBtn = document.getElementById('maintenanceOffBtn');
  if (maintenanceOffBtn) maintenanceOffBtn.addEventListener('click', () => toggleMaintenance(false));

  const estimatedEndInput = document.getElementById('maintenanceEstimatedEnd');
  if (estimatedEndInput) estimatedEndInput.addEventListener('change', onMaintenanceSettingChanged);

  // Mode radio — live update when maintenance active
  document.querySelectorAll('input[name="maintenanceMode"]').forEach(radio => {
    radio.addEventListener('change', onMaintenanceSettingChanged);
  });

  // Preset buttons — fill textarea on click (+ live update if active)
  document.querySelectorAll('#broadcastPresets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('broadcastMessage').value = btn.dataset.msg;
    });
  });
  document.querySelectorAll('#maintenancePresets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('maintenanceMessage').value = btn.dataset.msg;
      onMaintenanceSettingChanged();
    });
  });
}

// ========================================
// SUPPORT CHAT
// ========================================

const SUPPORT_API = '/api/super-admin/support-chat';
let supportConversations = [];
let activeSupportConvId = null;
let activeSupportOrgName = null;
let supportMessages = [];
let supportWs = null;
let supportWsReconnectTimer = null;

async function loadSupportConversations() {
  try {
    const res = await fetchWithAuth(`${SUPPORT_API}/conversations`);
    if (!res.ok) return;
    const result = await res.json();
    if (result.success && result.data) {
      supportConversations = result.data;
      renderSupportConversations();
      updateSupportTotalBadge();
    }
  } catch (e) {
    console.error('Failed to load support conversations:', e);
  }
}

function renderSupportConversations() {
  const container = document.getElementById('supportConvList');
  if (!container) return;

  if (supportConversations.length === 0) {
    container.innerHTML = `
      <div class="support-empty">
        <i class="fas fa-comments" aria-hidden="true"></i>
        <p>Ingen support-samtaler ennå</p>
      </div>`;
    return;
  }

  container.innerHTML = supportConversations.map(conv => {
    const preview = conv.last_message
      ? escapeHtmlAdmin(conv.last_message.content.substring(0, 60))
      : 'Ingen meldinger ennå';
    const time = conv.last_message ? formatSupportTime(conv.last_message.created_at) : '';
    const unread = conv.unread_count || 0;
    const isClosed = conv.status === 'closed';
    const statusBadge = isClosed
      ? '<span class="support-status-badge closed">Lukket</span>'
      : '<span class="support-status-badge open">Åpen</span>';

    return `
      <div class="support-conv-item ${unread > 0 ? 'unread' : ''} ${activeSupportConvId === conv.id ? 'active' : ''} ${isClosed ? 'closed' : ''}"
           data-conv-id="${conv.id}" data-org-name="${escapeHtmlAdmin(conv.organization_name)}">
        <div class="support-conv-icon"><i class="fas fa-building" aria-hidden="true"></i></div>
        <div class="support-conv-info">
          <div class="support-conv-name">${escapeHtmlAdmin(conv.organization_name)} <span class="support-ticket-id">#${conv.id}</span></div>
          <div class="support-conv-subject">${escapeHtmlAdmin(conv.subject || '')} ${statusBadge}</div>
          <div class="support-conv-preview">${preview}</div>
        </div>
        <div class="support-conv-meta">
          <span class="support-conv-time">${time}</span>
          ${unread > 0 ? `<span class="support-conv-unread">${unread}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  // Click handlers
  container.querySelectorAll('.support-conv-item').forEach(item => {
    item.addEventListener('click', () => {
      const convId = parseInt(item.dataset.convId, 10);
      const orgName = item.dataset.orgName;
      openSupportConversation(convId, orgName);
    });
  });
}

async function openSupportConversation(convId, orgName) {
  activeSupportConvId = convId;
  activeSupportOrgName = orgName;

  const conv = supportConversations.find(c => c.id === convId);
  const isClosed = conv?.status === 'closed';

  // Update header
  const nameEl = document.getElementById('supportMsgOrgName');
  if (nameEl) nameEl.innerHTML = `${escapeHtmlAdmin(orgName)} <span class="support-ticket-id">#${convId}</span>` +
    (conv?.subject ? ` — ${escapeHtmlAdmin(conv.subject)}` : '');

  // Show close or reopen button
  const closeBtn = document.getElementById('supportCloseTicketBtn');
  const reopenBtn = document.getElementById('supportReopenTicketBtn');
  if (closeBtn) closeBtn.style.display = isClosed ? 'none' : 'inline-flex';
  if (reopenBtn) reopenBtn.style.display = isClosed ? 'inline-flex' : 'none';
  const inputArea = document.querySelector('#supportMsgArea .support-input-area');
  if (inputArea) inputArea.style.display = isClosed ? 'none' : 'flex';

  // Show message area
  document.getElementById('supportMsgArea').style.display = 'flex';

  // Highlight active in list
  renderSupportConversations();

  // Load messages
  await loadSupportMessages(convId);
  scrollSupportToBottom();

  // Mark as read
  await markSupportAsRead(convId);

  // Focus input
  if (!isClosed) {
    const input = document.getElementById('supportChatInput');
    if (input) input.focus();
  }
}

async function closeSupportTicket() {
  if (!activeSupportConvId) return;
  if (!confirm('Lukk denne saken?')) return;
  try {
    await fetchWithAuth(`${SUPPORT_API}/conversations/${activeSupportConvId}/close`, { method: 'PUT' });
    const conv = supportConversations.find(c => c.id === activeSupportConvId);
    if (conv) conv.status = 'closed';
    openSupportConversation(activeSupportConvId, activeSupportOrgName);
  } catch (e) {
    console.error('Failed to close ticket:', e);
  }
}

async function deleteSupportTicket() {
  if (!activeSupportConvId) return;
  if (!confirm('Er du sikker på at du vil slette denne saken og alle meldinger permanent?')) return;
  try {
    const res = await fetchWithAuth(`${SUPPORT_API}/conversations/${activeSupportConvId}`, { method: 'DELETE' });
    if (!res.ok) return;
    activeSupportConvId = null;
    document.getElementById('supportMsgArea').style.display = 'none';
    await loadSupportConversations();
  } catch (e) {
    console.error('Failed to delete ticket:', e);
  }
}

async function reopenSupportTicket() {
  if (!activeSupportConvId) return;
  try {
    await fetchWithAuth(`${SUPPORT_API}/conversations/${activeSupportConvId}/reopen`, { method: 'PUT' });
    const conv = supportConversations.find(c => c.id === activeSupportConvId);
    if (conv) conv.status = 'open';
    openSupportConversation(activeSupportConvId, activeSupportOrgName);
  } catch (e) {
    console.error('Failed to reopen ticket:', e);
  }
}

async function loadSupportMessages(convId) {
  try {
    const res = await fetchWithAuth(`${SUPPORT_API}/conversations/${convId}/messages?limit=50`);
    if (!res.ok) return;
    const result = await res.json();
    if (result.success && result.data) {
      supportMessages = result.data;
      renderSupportMessages();
    }
  } catch (e) {
    console.error('Failed to load support messages:', e);
  }
}

function renderSupportMessages() {
  const container = document.getElementById('supportMessages');
  if (!container) return;

  if (supportMessages.length === 0) {
    container.innerHTML = `
      <div class="support-empty-msgs">
        <p>Ingen meldinger ennå. Skriv den første meldingen!</p>
      </div>`;
    return;
  }

  let html = '';
  let lastDate = '';

  for (const msg of supportMessages) {
    const msgDate = new Date(msg.created_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'long', year: 'numeric' });
    if (msgDate !== lastDate) {
      html += `<div class="support-date-sep">${msgDate}</div>`;
      lastDate = msgDate;
    }

    const isSelf = msg.sender_name === 'Efffekt Support';
    const time = new Date(msg.created_at).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

    html += `
      <div class="support-msg ${isSelf ? 'self' : 'other'}">
        ${!isSelf ? `<div class="support-msg-sender">${escapeHtmlAdmin(msg.sender_name)}</div>` : ''}
        <div class="support-msg-content">${escapeHtmlAdmin(msg.content)}</div>
        <div class="support-msg-time">${time}</div>
      </div>`;
  }

  container.innerHTML = html;
}

function scrollSupportToBottom() {
  const container = document.getElementById('supportMessages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

async function sendSupportMessage() {
  if (!activeSupportConvId) return;

  const input = document.getElementById('supportChatInput');
  const content = input?.value?.trim();
  if (!content) return;

  input.value = '';

  try {
    const res = await fetchWithAuth(`${SUPPORT_API}/conversations/${activeSupportConvId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    if (!res.ok) return;
    const result = await res.json();
    if (result.success && result.data) {
      supportMessages.push(result.data);
      renderSupportMessages();
      scrollSupportToBottom();
      // Update conversation list (move to top)
      loadSupportConversations();
    }
  } catch (e) {
    console.error('Failed to send support message:', e);
  }
}

async function markSupportAsRead(convId) {
  if (supportMessages.length === 0) return;
  const lastMsg = supportMessages[supportMessages.length - 1];
  try {
    await fetchWithAuth(`${SUPPORT_API}/conversations/${convId}/read`, {
      method: 'PUT',
      body: JSON.stringify({ messageId: lastMsg.id }),
    });
    // Update local unread count
    const conv = supportConversations.find(c => c.id === convId);
    if (conv) conv.unread_count = 0;
    renderSupportConversations();
    updateSupportTotalBadge();
  } catch (e) {
    // Non-critical
  }
}

function updateSupportTotalBadge() {
  const badge = document.getElementById('supportTotalUnread');
  if (!badge) return;
  const total = supportConversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
  badge.textContent = total;
  badge.style.display = total > 0 ? 'inline-flex' : 'none';
}

function formatSupportTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'I går';
  } else if (diffDays < 7) {
    return d.toLocaleDateString('no-NO', { weekday: 'short' });
  }
  return d.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
}

function escapeHtmlAdmin(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// WebSocket for real-time support messages
function initSupportWebSocket() {
  if (supportWs) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    supportWs = new WebSocket(wsUrl);

    supportWs.addEventListener('open', () => {
      console.log('Support WebSocket connected');
    });

    supportWs.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'support_chat_message') {
          handleSupportWsMessage(msg.data);
        }
      } catch {
        // Ignore malformed
      }
    });

    supportWs.addEventListener('close', () => {
      supportWs = null;
      // Reconnect after 5 seconds
      supportWsReconnectTimer = setTimeout(initSupportWebSocket, 5000);
    });

    supportWs.addEventListener('error', () => {
      supportWs?.close();
    });
  } catch (e) {
    console.error('Support WebSocket error:', e);
  }
}

function handleSupportWsMessage(data) {
  // If this message is for the currently active conversation, add it
  if (data.conversation_id === activeSupportConvId) {
    // Avoid duplicates
    if (!supportMessages.find(m => m.id === data.id)) {
      supportMessages.push(data);
      renderSupportMessages();
      scrollSupportToBottom();
      // Auto-mark as read since we're viewing
      markSupportAsRead(activeSupportConvId);
    }
  }

  // Reload conversation list to update unread/ordering
  loadSupportConversations();
}

function closeSupportWebSocket() {
  if (supportWsReconnectTimer) {
    clearTimeout(supportWsReconnectTimer);
    supportWsReconnectTimer = null;
  }
  if (supportWs) {
    supportWs.close();
    supportWs = null;
  }
}

function setupSupportChatListeners() {
  // Send button
  const sendBtn = document.getElementById('supportSendBtn');
  if (sendBtn) sendBtn.addEventListener('click', sendSupportMessage);

  // Enter to send
  const input = document.getElementById('supportChatInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendSupportMessage();
      }
    });
  }

  // Back button (for smaller screens)
  const backBtn = document.getElementById('supportBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      activeSupportConvId = null;
      document.getElementById('supportMsgArea').style.display = 'none';
      renderSupportConversations();
    });
  }

  // Refresh button
  const refreshBtn = document.getElementById('supportRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadSupportConversations);

  // Close ticket button
  const closeTicketBtn = document.getElementById('supportCloseTicketBtn');
  if (closeTicketBtn) closeTicketBtn.addEventListener('click', closeSupportTicket);

  // Reopen ticket button
  const reopenTicketBtn = document.getElementById('supportReopenTicketBtn');
  if (reopenTicketBtn) reopenTicketBtn.addEventListener('click', reopenSupportTicket);

  // Delete ticket button
  const deleteTicketBtn = document.getElementById('supportDeleteTicketBtn');
  if (deleteTicketBtn) deleteTicketBtn.addEventListener('click', deleteSupportTicket);
}

// ========================================
// STARTUP
// ========================================

document.addEventListener('DOMContentLoaded', initAdminPanel);

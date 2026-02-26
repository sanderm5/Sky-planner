// ========================================
// ADMIN TAB FUNCTIONS
// ========================================

let loginLogOffset = 0;
const LOGIN_LOG_LIMIT = 20;

async function loadAdminData() {
  // Initialize team members UI
  initTeamMembersUI();
  // Initialize fields management UI
  initFieldsManagementUI();

  // Load team members
  await loadTeamMembers();
  // Load login stats
  await loadLoginStats();
  // Load login log
  loginLogOffset = 0;
  await loadLoginLog(false);

  // Render admin fields, categories, and subcategories
  renderAdminFields();
  renderAdminCategories();
  renderAdminSubcategories();

  // Check and load super admin data if applicable
  await checkSuperAdminStatus();

  // Setup load more button
  document.getElementById('loadMoreLogins')?.addEventListener('click', () => loadLoginLog(true));
}

async function loadTeamMembers() {
  try {
    const response = await apiFetch('/api/team-members');

    if (!response.ok) {
      console.error('Failed to load team members');
      return;
    }

    const result = await response.json();
    const list = document.getElementById('teamMembersList');
    const emptyState = document.getElementById('teamMembersEmpty');
    const quotaBadge = document.getElementById('teamQuotaBadge');

    if (!list) return;

    // Update quota badge
    if (quotaBadge && result.data?.limits) {
      const { current_count, max_brukere } = result.data.limits;
      quotaBadge.textContent = `${current_count} / ${max_brukere}`;
      quotaBadge.classList.remove('near-limit', 'at-limit');
      if (current_count >= max_brukere) {
        quotaBadge.classList.add('at-limit');
      } else if (current_count >= max_brukere - 1) {
        quotaBadge.classList.add('near-limit');
      }
    }

    list.innerHTML = '';

    const members = result.data?.members || [];
    // Store for event delegation lookup
    teamMembersData = members;

    if (members.length > 0) {
      if (emptyState) emptyState.style.display = 'none';
      list.style.display = 'flex';

      // Use innerHTML with data-action attributes for event delegation
      list.innerHTML = members.map(member => {
        const initials = getInitials(member.navn);
        const lastLogin = member.sist_innlogget
          ? formatRelativeTime(member.sist_innlogget)
          : 'Aldri innlogget';

        return `
          <div class="team-member-item" data-action="editTeamMember" data-member-id="${member.id}">
            <div class="team-member-status ${member.aktiv ? '' : 'inactive'}"></div>
            <div class="team-member-avatar">${initials}</div>
            <div class="team-member-info">
              <div class="team-member-name">${escapeHtml(member.navn)}</div>
              <div class="team-member-email">${escapeHtml(member.epost)}</div>
              <div class="team-member-meta">
                <span class="team-member-role">${escapeHtml(member.rolle || 'medlem')}</span>
                <span class="team-member-last-login">Sist: ${lastLogin}</span>
              </div>
            </div>
            <div class="team-member-actions">
              <button class="btn-icon" data-action="editTeamMember" data-member-id="${member.id}" title="Rediger"><i aria-hidden="true" class="fas fa-pen"></i></button>
              <button class="btn-icon delete" data-action="deleteTeamMember" data-member-id="${member.id}" title="Slett"><i aria-hidden="true" class="fas fa-trash"></i></button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      list.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
    }
  } catch (error) {
    console.error('Error loading team members:', error);
  }
}

function openTeamMemberModal(member = null) {
  const modal = document.getElementById('teamMemberModal');
  const title = document.getElementById('teamMemberModalTitle');
  const form = document.getElementById('teamMemberForm');
  const deleteBtn = document.getElementById('deleteTeamMemberBtn');
  const passwordInput = document.getElementById('memberPassord');

  if (!modal || !form) return;

  // Reset form
  form.reset();
  document.getElementById('teamMemberId').value = '';

  if (member) {
    // Edit mode
    title.textContent = 'Rediger teammedlem';
    document.getElementById('teamMemberId').value = member.id;
    document.getElementById('memberNavn').value = member.navn || '';
    document.getElementById('memberEpost').value = member.epost || '';
    document.getElementById('memberTelefon').value = member.telefon || '';
    document.getElementById('memberRolle').value = member.rolle || 'medlem';
    passwordInput.required = false;
    passwordInput.placeholder = 'La stå tom for å beholde';
    deleteBtn.style.display = 'inline-flex';
  } else {
    // Create mode
    title.textContent = 'Nytt teammedlem';
    passwordInput.required = true;
    passwordInput.placeholder = 'Minst 8 tegn';
    deleteBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');
}

function closeTeamMemberModal() {
  const modal = document.getElementById('teamMemberModal');
  if (modal) modal.classList.add('hidden');
}

async function saveTeamMember(e) {
  e.preventDefault();

  const memberId = document.getElementById('teamMemberId').value;
  const isEdit = !!memberId;

  const data = {
    navn: document.getElementById('memberNavn').value.trim(),
    epost: document.getElementById('memberEpost').value.trim(),
    telefon: document.getElementById('memberTelefon').value.trim() || null,
    rolle: document.getElementById('memberRolle').value
  };

  const password = document.getElementById('memberPassord').value;
  if (password) {
    data.passord = password;
  } else if (!isEdit) {
    showToast('Passord er påkrevd', 'error');
    return;
  }

  try {
    const url = isEdit ? `/api/team-members/${memberId}` : '/api/team-members';
    const method = isEdit ? 'PUT' : 'POST';

    const teamMemberHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      teamMemberHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(url, {
      method,
      headers: teamMemberHeaders,
      credentials: 'include',
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
      showToast(result.error?.message || 'Kunne ikke lagre bruker', 'error');
      return;
    }

    showToast(isEdit ? 'Bruker oppdatert' : 'Bruker opprettet', 'success');
    closeTeamMemberModal();
    await loadTeamMembers();
  } catch (error) {
    console.error('Error saving team member:', error);
    showToast('En feil oppstod', 'error');
  }
}

async function deleteTeamMember(member) {
  const confirmed = await showConfirm(`Er du sikker på at du vil slette ${member.navn}?`, 'Slette teammedlem');
  if (!confirmed) return;

  try {
    const deleteHeaders = {};
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      deleteHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(`/api/team-members/${member.id}`, {
      method: 'DELETE',
      headers: deleteHeaders,
      credentials: 'include'
    });
    if (!response.ok) {
      const result = await response.json();
      showToast(result.error?.message || 'Kunne ikke slette bruker', 'error');
      return;
    }

    showToast('Bruker slettet', 'success');
    closeTeamMemberModal();
    await loadTeamMembers();
  } catch (error) {
    console.error('Error deleting team member:', error);
    showToast('En feil oppstod', 'error');
  }
}

function initTeamMembersUI() {
  // Add member buttons
  document.getElementById('addTeamMemberBtn')?.addEventListener('click', () => openTeamMemberModal());
  document.getElementById('addFirstMemberBtn')?.addEventListener('click', () => openTeamMemberModal());

  // Modal close buttons
  document.getElementById('closeTeamMemberModal')?.addEventListener('click', closeTeamMemberModal);
  document.getElementById('cancelTeamMember')?.addEventListener('click', closeTeamMemberModal);

  // Form submit
  document.getElementById('teamMemberForm')?.addEventListener('submit', saveTeamMember);

  // Delete button in modal
  document.getElementById('deleteTeamMemberBtn')?.addEventListener('click', () => {
    const memberId = document.getElementById('teamMemberId').value;
    if (memberId) {
      const memberName = document.getElementById('memberNavn').value;
      deleteTeamMember({ id: memberId, navn: memberName });
    }
  });
}

/**
 * Initialize field and category management UI
 */
function initFieldsManagementUI() {
  // Field buttons
  document.getElementById('addFieldBtn')?.addEventListener('click', () => openFieldModal());
  document.getElementById('addFirstFieldBtn')?.addEventListener('click', () => openFieldModal());

  // Field modal
  document.getElementById('closeFieldModal')?.addEventListener('click', () => {
    document.getElementById('fieldModal').classList.add('hidden');
  });
  document.getElementById('cancelField')?.addEventListener('click', () => {
    document.getElementById('fieldModal').classList.add('hidden');
  });
  document.getElementById('fieldForm')?.addEventListener('submit', saveField);
  document.getElementById('deleteFieldBtn')?.addEventListener('click', () => {
    const fieldId = document.getElementById('fieldId').value;
    if (fieldId) confirmDeleteField(parseInt(fieldId));
  });

  // Field type change - show/hide options section
  document.getElementById('fieldType')?.addEventListener('change', (e) => {
    const optionsSection = document.getElementById('fieldOptionsSection');
    if (optionsSection) {
      optionsSection.style.display = e.target.value === 'select' ? 'block' : 'none';
    }
  });

  // Add field option button
  document.getElementById('addFieldOptionBtn')?.addEventListener('click', addFieldOption);

  // Auto-generate field_name from display_name
  document.getElementById('fieldDisplayName')?.addEventListener('input', (e) => {
    const fieldNameInput = document.getElementById('fieldName');
    if (fieldNameInput && !fieldNameInput.disabled) {
      fieldNameInput.value = e.target.value.toLowerCase()
        .replace(/[æ]/g, 'ae')
        .replace(/[ø]/g, 'o')
        .replace(/[å]/g, 'a')
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    }
  });

  // Category buttons
  document.getElementById('addCategoryBtn')?.addEventListener('click', () => openCategoryModal());
  document.getElementById('addFirstCategoryBtn')?.addEventListener('click', () => openCategoryModal());
  document.getElementById('manageCategoriesBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCategoryListModal();
  });

  // Category modal
  document.getElementById('closeCategoryModal')?.addEventListener('click', () => {
    document.getElementById('categoryModal').classList.add('hidden');
  });
  document.getElementById('cancelCategory')?.addEventListener('click', () => {
    document.getElementById('categoryModal').classList.add('hidden');
  });
  document.getElementById('categoryForm')?.addEventListener('submit', saveCategory);
  document.getElementById('deleteCategoryBtn')?.addEventListener('click', () => {
    const categoryId = document.getElementById('categoryId').value;
    if (categoryId) confirmDeleteCategory(parseInt(categoryId));
  });

  // Auto-generate slug from name (only for new categories)
  document.getElementById('categoryName')?.addEventListener('input', (e) => {
    const slugInput = document.getElementById('categorySlug');
    const idInput = document.getElementById('categoryId');
    // Only auto-generate slug for new categories (no id yet)
    if (slugInput && !idInput?.value) {
      slugInput.value = e.target.value.toLowerCase()
        .replace(/[æ]/g, 'ae')
        .replace(/[ø]/g, 'o')
        .replace(/[å]/g, 'a')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
  });

  // Icon picker grid click handler
  document.getElementById('categoryIconPicker')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-btn');
    if (!btn) return;
    document.querySelectorAll('#categoryIconPicker .icon-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('categoryIcon').value = btn.dataset.icon;
  });

  // Color preview update
  document.getElementById('categoryColor')?.addEventListener('input', (e) => {
    updateCategoryColorPreview(e.target.value);
  });
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Ukjent';

  let date = dateString;
  if (!date.endsWith('Z') && !date.includes('+')) {
    date = date.replace(' ', 'T') + 'Z';
  }

  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Nå';
  if (diffMins < 60) return `${diffMins} min siden`;
  if (diffHours < 24) return `${diffHours} t siden`;
  if (diffDays < 7) return `${diffDays} d siden`;

  return then.toLocaleDateString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

async function loadLoginStats() {
  try {
    const response = await fetch('/api/login-logg/stats', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load login stats');
      return;
    }

    const stats = await response.json();

    document.getElementById('statTotalLogins').textContent = stats.total || 0;
    document.getElementById('statSuccessLogins').textContent = stats.vellykket || 0;
    document.getElementById('statFailedLogins').textContent = stats.feilet || 0;
    document.getElementById('statLast24h').textContent = stats.siste24t || 0;
  } catch (error) {
    console.error('Error loading login stats:', error);
  }
}

async function loadLoginLog(append = false) {
  try {
    if (!append) {
      loginLogOffset = 0;
    }

    const response = await fetch(`/api/login-logg?limit=${LOGIN_LOG_LIMIT}&offset=${loginLogOffset}`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load login log');
      return;
    }

    const data = await response.json();
    const tbody = document.getElementById('loginLogBody');

    if (!append) {
      tbody.innerHTML = '';
    }

    if (data.logg && data.logg.length > 0) {
      data.logg.forEach(entry => {
        const row = document.createElement('tr');
        // SQLite stores UTC, add 'Z' suffix if missing to parse as UTC
        let tidspunkt = entry.tidspunkt;
        if (tidspunkt && !tidspunkt.endsWith('Z') && !tidspunkt.includes('+')) {
          tidspunkt = tidspunkt.replace(' ', 'T') + 'Z';
        }
        const tid = new Date(tidspunkt).toLocaleString('nb-NO', {
          timeZone: 'Europe/Oslo',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const statusClass = entry.status === 'vellykket' ? 'success' : 'failed';
        const statusText = entry.status === 'vellykket' ? 'OK' : 'Feilet';
        const statusIcon = entry.status === 'vellykket' ? 'fa-check' : 'fa-times';

        // Parse user agent for device info
        const ua = entry.user_agent || '';
        let device = 'Ukjent';
        if (ua.includes('iPhone')) device = 'iPhone';
        else if (ua.includes('iPad')) device = 'iPad';
        else if (ua.includes('Android')) device = 'Android';
        else if (ua.includes('Windows')) device = 'Windows';
        else if (ua.includes('Mac')) device = 'Mac';
        else if (ua.includes('Linux')) device = 'Linux';

        row.innerHTML = `
          <td>${tid}</td>
          <td>${escapeHtml(entry.bruker_navn || '-')}</td>
          <td>${escapeHtml(entry.epost)}</td>
          <td><span class="status-badge ${statusClass}"><i aria-hidden="true" class="fas ${statusIcon}"></i> ${statusText}</span></td>
          <td class="ip-address">${escapeHtml(entry.ip_adresse || '-')}</td>
          <td class="user-agent" title="${escapeHtml(ua)}">${device}</td>
        `;
        tbody.appendChild(row);
      });

      loginLogOffset += data.logg.length;

      // Hide load more if no more data
      const loadMoreBtn = document.getElementById('loadMoreLogins');
      if (loadMoreBtn) {
        loadMoreBtn.style.display = data.logg.length < LOGIN_LOG_LIMIT ? 'none' : 'block';
      }
    } else if (!append) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--color-text-tertiary);">Ingen innlogginger registrert</td></tr>';
    }
  } catch (error) {
    console.error('Error loading login log:', error);
  }
}

function renderSeasonChart() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthCounts = new Array(12).fill(0);

  // Count kontroller per month (based on neste_el_kontroll and neste_brann_kontroll)
  customers.forEach(c => {
    // El-kontroll
    if (c.neste_el_kontroll) {
      const date = new Date(c.neste_el_kontroll);
      if (!Number.isNaN(date.getTime())) {
        monthCounts[date.getMonth()]++;
      }
    }
    // Brann-kontroll
    if (c.neste_brann_kontroll) {
      const date = new Date(c.neste_brann_kontroll);
      if (!Number.isNaN(date.getTime())) {
        monthCounts[date.getMonth()]++;
      }
    }
  });

  const maxCount = Math.max(...monthCounts, 1);

  const container = document.getElementById('seasonChart');
  if (!container) return;

  container.innerHTML = months.map((month, i) => {
    const count = monthCounts[i];
    const height = (count / maxCount) * 100;
    return `
      <div class="season-bar">
        <span class="season-bar-value">${count}</span>
        <div class="season-bar-fill combined" style="height: ${height}%"></div>
        <span class="season-bar-label">${month}</span>
      </div>
    `;
  }).join('');
}

// Generic helper for rendering bar statistics
function renderBarStats(containerId, data, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (options.limit) sorted.splice(options.limit);

  if (sorted.length === 0) {
    container.innerHTML = '<p style="color: var(--color-text-muted); font-size: 13px;">Ingen data</p>';
    return;
  }

  const total = options.total || Object.values(data).reduce((a, b) => a + b, 0) || 1;
  const maxForPct = options.useMaxAsBase ? (sorted[0]?.[1] || 1) : total;

  container.innerHTML = sorted.map(([label, count]) => {
    const pct = (count / maxForPct) * 100;
    const barClass = options.getBarClass ? options.getBarClass(label) : options.barClass || 'default';
    const valueText = options.showPercent === false ? `${count}` : `${count} (${pct.toFixed(0)}%)`;
    return `
      <div class="stat-bar-item">
        <div class="stat-bar-header">
          <span class="stat-bar-label">${label}</span>
          <span class="stat-bar-value">${valueText}</span>
        </div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill ${barClass}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCategoryStats() {
  const categories = {};
  customers.forEach(c => {
    const cat = c.kategori || 'Ukjent';
    categories[cat] = (categories[cat] || 0) + 1;
  });

  renderBarStats('categoryStats', categories, {
    total: customers.length,
    getBarClass: (cat) => serviceTypeRegistry.getCategoryClass(cat)
  });
}

function renderAreaStats() {
  const areas = {};
  customers.forEach(c => {
    const area = c.poststed || 'Ukjent';
    areas[area] = (areas[area] || 0) + 1;
  });

  renderBarStats('areaStats', areas, {
    limit: 10,
    useMaxAsBase: true,
    showPercent: false,
    barClass: 'area'
  });
}

function renderEltypeStats() {
  const types = {};
  customers.forEach(c => {
    if (c.el_type) types[c.el_type] = (types[c.el_type] || 0) + 1;
  });

  renderBarStats('eltypeStats', types, { barClass: 'eltype' });
}

function renderBrannsystemStats() {
  const systems = {};
  customers.forEach(c => {
    if (c.brann_system) systems[c.brann_system] = (systems[c.brann_system] || 0) + 1;
  });

  renderBarStats('brannsystemStats', systems, { barClass: 'brannsystem' });
}


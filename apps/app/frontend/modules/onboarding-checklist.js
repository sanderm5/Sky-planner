// ========================================
// ONBOARDING CHECKLIST - Persistent setup progress
// ========================================

const onboardingChecklist = {
  tasks: [
    {
      id: 'set-address',
      label: 'Sett firmaadresse',
      description: 'Startpunkt for ruter og avstandsberegninger',
      icon: 'fa-map-marker-alt',
      check: () => !!(appConfig.routeStartLat && appConfig.routeStartLng),
      action: () => {
        if (typeof navigateAndHighlightAddress === 'function') {
          navigateAndHighlightAddress();
        }
      }
    },
    {
      id: 'add-customer',
      label: 'Legg til kunder',
      description: 'Importer fra fil, koble regnskap eller opprett manuelt',
      icon: 'fa-user-plus',
      check: () => typeof customers !== 'undefined' && customers.length > 0,
      action: () => {
        showAddCustomerOptions();
      }
    },
    {
      id: 'plan-route',
      label: 'Planlegg en rute',
      description: 'Legg inn stopp i ukeplanen og optimaliser rekkefølgen',
      icon: 'fa-route',
      check: () => localStorage.getItem('skyplanner_firstRoutePlanned') === 'true',
      action: () => {
        if (typeof navigateAndHighlightWeekplan === 'function') {
          navigateAndHighlightWeekplan();
        }
      }
    },
    {
      id: 'invite-team',
      label: 'Inviter teammedlem',
      description: 'Del tilgang med kollegaer for samarbeid',
      icon: 'fa-user-friends',
      check: () => localStorage.getItem('skyplanner_teamInviteSent') === 'true',
      action: () => {
        if (typeof navigateAndHighlightTeam === 'function') {
          navigateAndHighlightTeam();
        }
      }
    }
  ],
  completedTasks: [],
  minimized: false,
  dismissed: false
};

// Show popover with add-customer options (import, manual, accounting)
function showAddCustomerOptions() {
  // Remove existing popover
  const existing = document.getElementById('addCustomerPopover');
  if (existing) { existing.remove(); return; }

  const webUrl = appConfig.webUrl || '';

  const popover = document.createElement('div');
  popover.id = 'addCustomerPopover';
  popover.className = 'add-customer-popover';
  popover.innerHTML = `
    <div class="add-customer-popover-backdrop"></div>
    <div class="add-customer-popover-content">
      <div class="popover-option" data-action="popover-import">
        <i class="fas fa-file-import" aria-hidden="true"></i>
        <div>
          <strong>Importer fra fil</strong>
          <span>Excel eller CSV</span>
        </div>
      </div>
      <div class="popover-option" data-action="popover-manual">
        <i class="fas fa-plus-circle" aria-hidden="true"></i>
        <div>
          <strong>Legg til manuelt</strong>
          <span>Opprett en og en</span>
        </div>
      </div>
      <div class="popover-option" data-action="popover-accounting">
        <i class="fas fa-plug" aria-hidden="true"></i>
        <div>
          <strong>Koble regnskapssystem</strong>
          <span>Tripletex, Fiken, PowerOffice</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(popover);
  requestAnimationFrame(() => popover.classList.add('visible'));

  popover.addEventListener('click', (e) => {
    const option = e.target.closest('[data-action]');
    const action = option ? option.dataset.action : null;

    if (action === 'popover-import') {
      if (typeof showImportModal === 'function') showImportModal();
    } else if (action === 'popover-manual') {
      if (typeof addCustomer === 'function') addCustomer();
    } else if (action === 'popover-accounting') {
      if (webUrl) window.open(webUrl + '/dashboard/innstillinger/integrasjoner', '_blank');
    }

    // Close popover
    popover.classList.remove('visible');
    setTimeout(() => popover.remove(), 200);
  });
}

// Calculate right offset based on filter panel state
function getChecklistRightOffset() {
  const filterPanel = document.getElementById('filterPanel');
  if (!filterPanel) return '24px';
  const isCollapsed = filterPanel.classList.contains('collapsed');
  return isCollapsed ? '64px' : '350px';
}

// Initialize the onboarding checklist
function initOnboardingChecklist() {
  if (!isGuidanceEnabled()) return;
  if (localStorage.getItem('skyplanner_checklistDismissed') === 'true') return;

  // Refresh state to see which tasks are done
  refreshChecklistState();

  // All tasks done — no need to show
  if (onboardingChecklist.completedTasks.length === onboardingChecklist.tasks.length) return;

  // Restore minimized state
  onboardingChecklist.minimized = localStorage.getItem('skyplanner_checklistMinimized') === 'true';
  onboardingChecklist.dismissed = false;

  renderChecklist();
}

// Refresh which tasks are completed
function refreshChecklistState() {
  const prevCompleted = onboardingChecklist.completedTasks.length;
  onboardingChecklist.completedTasks = onboardingChecklist.tasks
    .filter(task => task.check())
    .map(task => task.id);

  // If checklist is visible, re-render
  const existing = document.getElementById('onboardingChecklist') || document.getElementById('checklistFab');
  if (existing) {
    renderChecklist();

    // Animate newly completed task
    if (onboardingChecklist.completedTasks.length > prevCompleted) {
      animateTaskCompletion();
    }

    // All tasks complete — congratulate and auto-minimize
    if (onboardingChecklist.completedTasks.length === onboardingChecklist.tasks.length) {
      if (typeof showToast === 'function') {
        showToast('Alle oppstartsoppgaver fullført!', 'success');
      }
      setTimeout(() => {
        minimizeChecklist();
      }, 3000);
    }
  }
}

// Animate when a task is newly completed
function animateTaskCompletion() {
  const checklist = document.getElementById('onboardingChecklist');
  if (!checklist) return;

  const completedItems = checklist.querySelectorAll('.checklist-task.completed');
  const lastCompleted = completedItems[completedItems.length - 1];
  if (lastCompleted) {
    lastCompleted.classList.add('just-completed');
    setTimeout(() => lastCompleted.classList.remove('just-completed'), 600);
  }
}

// Render the checklist (expanded or minimized)
function renderChecklist() {
  // Remove existing
  const existingChecklist = document.getElementById('onboardingChecklist');
  if (existingChecklist) existingChecklist.remove();
  const existingFab = document.getElementById('checklistFab');
  if (existingFab) existingFab.remove();

  if (onboardingChecklist.dismissed) return;

  const completedCount = onboardingChecklist.completedTasks.length;
  const totalCount = onboardingChecklist.tasks.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (onboardingChecklist.minimized) {
    renderChecklistFab(completedCount, totalCount, progressPercent);
  } else {
    renderChecklistExpanded(completedCount, totalCount, progressPercent);
  }
}

// Render the minimized FAB (floating action button with progress ring)
function renderChecklistFab(completedCount, totalCount, progressPercent) {
  const fab = document.createElement('button');
  fab.id = 'checklistFab';
  fab.className = 'checklist-fab';
  fab.style.right = getChecklistRightOffset();
  fab.title = 'Vis sjekkliste';
  fab.onclick = expandChecklist;

  // SVG progress ring
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progressPercent / 100) * circumference;

  fab.innerHTML = `
    <svg class="checklist-fab-ring" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="${radius}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
      <circle cx="26" cy="26" r="${radius}" fill="none" stroke="currentColor" stroke-width="3"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
        stroke-linecap="round" transform="rotate(-90 26 26)"/>
    </svg>
    <span class="checklist-fab-count">${completedCount}/${totalCount}</span>
  `;

  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer) {
    mapContainer.appendChild(fab);
  } else {
    document.body.appendChild(fab);
  }
}

// Render the expanded checklist widget
function renderChecklistExpanded(completedCount, totalCount, progressPercent) {
  const widget = document.createElement('div');
  widget.id = 'onboardingChecklist';
  widget.className = 'onboarding-checklist';

  const tasksHtml = onboardingChecklist.tasks.map(task => {
    const isCompleted = onboardingChecklist.completedTasks.includes(task.id);
    return `
      <div class="checklist-task ${isCompleted ? 'completed' : ''}" data-task-id="${task.id}">
        <div class="checklist-task-check">
          ${isCompleted
            ? '<i aria-hidden="true" class="fas fa-check-circle"></i>'
            : '<i aria-hidden="true" class="far fa-circle"></i>'}
        </div>
        <div class="checklist-task-content">
          <span class="checklist-task-label">${escapeHtml(task.label)}</span>
          <span class="checklist-task-desc">${escapeHtml(task.description)}</span>
        </div>
        ${!isCompleted ? '<i aria-hidden="true" class="fas fa-chevron-right checklist-task-arrow"></i>' : ''}
      </div>
    `;
  }).join('');

  widget.innerHTML = `
    <div class="checklist-header">
      <div class="checklist-header-top">
        <h3><i aria-hidden="true" class="fas fa-clipboard-check"></i> Kom i gang</h3>
        <div class="checklist-header-actions">
          <button class="checklist-header-btn" data-action="minimizeChecklist" title="Minimer">
            <i aria-hidden="true" class="fas fa-minus"></i>
          </button>
          <button class="checklist-header-btn" data-action="dismissChecklist" title="Lukk">
            <i aria-hidden="true" class="fas fa-times"></i>
          </button>
        </div>
      </div>
      <div class="checklist-progress">
        <div class="checklist-progress-bar">
          <div class="checklist-progress-fill" style="width: ${progressPercent}%"></div>
        </div>
        <span class="checklist-progress-text">${completedCount} av ${totalCount} fullført</span>
      </div>
    </div>
    <div class="checklist-tasks">
      ${tasksHtml}
    </div>
  `;

  // Event delegation for task clicks
  widget.addEventListener('click', (e) => {
    const taskEl = e.target.closest('.checklist-task:not(.completed)');
    if (!taskEl) return;
    const taskId = taskEl.dataset.taskId;
    const task = onboardingChecklist.tasks.find(t => t.id === taskId);
    if (task && task.action) {
      task.action();
    }
  });

  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer) {
    mapContainer.appendChild(widget);
  } else {
    document.body.appendChild(widget);
  }

  // Animate in
  requestAnimationFrame(() => {
    widget.classList.add('visible');
  });
}

// Minimize the checklist to a FAB
function minimizeChecklist() {
  onboardingChecklist.minimized = true;
  localStorage.setItem('skyplanner_checklistMinimized', 'true');
  renderChecklist();
}

// Expand the checklist from FAB
function expandChecklist() {
  onboardingChecklist.minimized = false;
  localStorage.setItem('skyplanner_checklistMinimized', 'false');
  renderChecklist();
}

// Permanently dismiss the checklist
function dismissChecklist() {
  onboardingChecklist.dismissed = true;
  localStorage.setItem('skyplanner_checklistDismissed', 'true');

  const widget = document.getElementById('onboardingChecklist');
  if (widget) {
    widget.classList.remove('visible');
    widget.classList.add('dismissing');
    setTimeout(() => widget.remove(), 300);
  }
  const fab = document.getElementById('checklistFab');
  if (fab) fab.remove();
}

// Hide the checklist without dismissing (used on logout or guidance toggle off)
function hideOnboardingChecklist() {
  const widget = document.getElementById('onboardingChecklist');
  if (widget) widget.remove();
  const fab = document.getElementById('checklistFab');
  if (fab) fab.remove();
}

// Show the checklist again (used when guidance toggled back on or "Vis sjekkliste" clicked)
function showOnboardingChecklist() {
  localStorage.removeItem('skyplanner_checklistDismissed');
  onboardingChecklist.dismissed = false;
  onboardingChecklist.minimized = false;
  localStorage.removeItem('skyplanner_checklistMinimized');
  initOnboardingChecklist();
}

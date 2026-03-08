// ========================================
// ONBOARDING CHECKLIST - Persistent setup progress
// ========================================

const onboardingChecklist = {
  tasks: [
    {
      id: 'set-address',
      label: 'Sett firmaadresse',
      description: 'Startpunkt for alle ruter og avstandsberegninger',
      icon: 'fa-map-marker-alt',
      check: () => !!(appConfig.routeStartLat && appConfig.routeStartLng),
      action: () => {
        const adminTab = document.querySelector('[data-tab="admin"]');
        if (adminTab) adminTab.click();
        setTimeout(() => {
          const section = document.getElementById('companyAddressSection');
          if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
    },
    {
      id: 'add-customer',
      label: 'Legg til din første kunde',
      description: 'Opprett manuelt eller importer fra Excel/CSV',
      icon: 'fa-user-plus',
      check: () => typeof customers !== 'undefined' && customers.length > 0,
      action: () => {
        if (typeof addCustomer === 'function') addCustomer();
      }
    },
    {
      id: 'plan-route',
      label: 'Planlegg en rute',
      description: 'Bruk ukeplanen til å legge inn stopp og optimaliser rekkefølgen',
      icon: 'fa-route',
      check: () => localStorage.getItem('skyplanner_firstRoutePlanned') === 'true',
      action: () => {
        const wpTab = document.querySelector('[data-tab="weekly-plan"]');
        if (wpTab) wpTab.click();
      }
    },
    {
      id: 'calendar-event',
      label: 'Opprett en avtale',
      description: 'Klikk på en dato i kalenderen for å opprette en avtale',
      icon: 'fa-calendar-plus',
      check: () => localStorage.getItem('skyplanner_firstEventCreated') === 'true',
      action: () => {
        const calTab = document.querySelector('[data-tab="calendar"]');
        if (calTab) calTab.click();
      }
    },
    {
      id: 'invite-team',
      label: 'Inviter et teammedlem',
      description: 'Del tilgang med kollegaer for samarbeid',
      icon: 'fa-user-friends',
      check: () => localStorage.getItem('skyplanner_teamInviteSent') === 'true',
      action: () => {
        const adminTab = document.querySelector('[data-tab="admin"]');
        if (adminTab) adminTab.click();
        setTimeout(() => {
          const section = document.getElementById('teamMembersSection');
          if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
    }
  ],
  completedTasks: [],
  minimized: false,
  dismissed: false
};

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
  const progressPercent = Math.round((completedCount / totalCount) * 100);

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
          <button class="checklist-header-btn" onclick="minimizeChecklist()" title="Minimer">
            <i aria-hidden="true" class="fas fa-minus"></i>
          </button>
          <button class="checklist-header-btn" onclick="dismissChecklist()" title="Lukk">
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

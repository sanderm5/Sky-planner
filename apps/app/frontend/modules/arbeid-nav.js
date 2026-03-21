// ============================================
// ARBEID TAB - Sub-navigation controller
// Manages switching between Oversikt/Ukeplan/Kalender/Planlegger sub-views
// ============================================

let currentArbeidView = 'idag';
let arbeidViewRendered = { idag: false, uke: false, maaned: false, planlegger: false };

function initArbeidNav() {
  // Use event delegation on the sub-nav container for reliability
  const nav = document.querySelector('.arbeid-sub-nav');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const pill = e.target.closest('.arbeid-pill');
    if (!pill) return;
    const view = pill.dataset.arbeidView;
    if (view && view !== currentArbeidView) {
      switchArbeidView(view);
    }
  });
}

function switchArbeidView(view) {
  // Cleanup previous view
  cleanupArbeidView(currentArbeidView);

  // Update pill active state
  document.querySelectorAll('.arbeid-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.arbeidView === view);
  });

  // Hide all views, show target
  document.querySelectorAll('.arbeid-view').forEach(v => {
    v.style.display = 'none';
    v.classList.remove('active');
  });
  const targetView = document.getElementById(`arbeid-${view}`);
  if (targetView) {
    targetView.style.display = '';
    targetView.classList.add('active');
  }

  currentArbeidView = view;

  // Render content for the view
  renderArbeidView(view);
}

function renderArbeidView(view) {
  switch (view) {
    case 'idag':
      if (typeof loadTeamOverview === 'function') loadTeamOverview();
      if (typeof loadTodaysWork === 'function' && hasFeature('todays_work')) {
        const dateNav = document.getElementById('twDateNav');
        if (dateNav) dateNav.style.display = '';
        loadTodaysWork();
      }
      break;
    case 'uke':
      if (typeof renderWeeklyPlan === 'function') renderWeeklyPlan();
      break;
    case 'maaned':
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof openCalendarSplitView === 'function') openCalendarSplitView();
      break;
    case 'planlegger':
      if (typeof renderPlanner === 'function') renderPlanner();
      break;
  }
  arbeidViewRendered[view] = true;
}

function cleanupArbeidView(view) {
  switch (view) {
    case 'idag':
      if (typeof unloadTeamOverview === 'function') unloadTeamOverview();
      break;
    case 'uke':
      if (typeof weekPlanState !== 'undefined' && weekPlanState.activeDay) {
        weekPlanState.activeDay = null;
        if (typeof areaSelectMode !== 'undefined' && areaSelectMode && typeof toggleAreaSelect === 'function') {
          toggleAreaSelect();
        }
      }
      if (typeof wpFocusedTeamMember !== 'undefined' && wpFocusedTeamMember) {
        wpFocusedTeamMember = null;
        wpFocusedMemberIds = null;
        if (typeof applyTeamFocusToMarkers === 'function') applyTeamFocusToMarkers();
        if (typeof refreshClusters === 'function') refreshClusters();
      }
      if (typeof closeWpRouteSummary === 'function') closeWpRouteSummary();
      break;
    case 'maaned':
      if (typeof clearCalendarFocus === 'function') clearCalendarFocus();
      break;
    case 'planlegger':
      // Planner cleanup handled by tab cleanup registry
      break;
  }
}

function loadArbeidTab() {
  renderArbeidView(currentArbeidView);
}

function unloadArbeidTab() {
  cleanupArbeidView(currentArbeidView);
  arbeidViewRendered = { idag: false, uke: false, maaned: false, planlegger: false };
}

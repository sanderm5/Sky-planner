/**
 * Update week plan badges on map markers.
 * Shows initials of who planned/owns each customer for the current week.
 */
function updateWeekPlanBadges() {
  if (!markers) return;

  // Use team members to get consistent colors per person
  const teamMembers = getWeekTeamMembers();
  const colorByName = new Map();
  teamMembers.forEach(m => colorByName.set(m.name, m.color));

  // Build a map: kundeId → { initials, day, color }
  const planMap = new Map();
  const userName = localStorage.getItem('userName') || '';
  const userInitials = getCreatorDisplay(userName, true);

  // Planned (unsaved) customers from weekly plan
  if (weekPlanState.days) {
    for (const dayKey of weekDayKeys) {
      const dayData = weekPlanState.days[dayKey];
      if (!dayData) continue;
      for (const c of dayData.planned) {
        planMap.set(c.id, {
          initials: userInitials,
          day: weekDayLabels[weekDayKeys.indexOf(dayKey)].substring(0, 3),
          color: colorByName.get(userName) || TEAM_COLORS[0],
          creator: userName
        });
      }
    }
  }

  // Existing avtaler for the current week
  if (weekPlanState.days) {
    const weekDates = new Set(weekDayKeys.map(k => weekPlanState.days[k]?.date).filter(Boolean));
    for (const a of avtaler) {
      if (!weekDates.has(a.dato) || !a.kunde_id) continue;
      if (planMap.has(a.kunde_id)) continue;
      const creator = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
      if (!creator) continue;
      const initials = getCreatorDisplay(creator, true);
      const dayDate = new Date(a.dato + 'T00:00:00');
      const dayIdx = (dayDate.getDay() + 6) % 7;
      planMap.set(a.kunde_id, {
        initials,
        day: dayIdx < 5 ? weekDayLabels[dayIdx].substring(0, 3) : '',
        color: colorByName.get(creator) || TEAM_COLORS[1],
        creator
      });
    }
  }

  // Update all markers
  for (const kundeId of Object.keys(markers)) {
    const marker = markers[kundeId];
    const el = marker.getElement();
    if (!el) continue;

    // Remove existing plan badge
    const existing = el.querySelector('.wp-plan-badge');
    if (existing) existing.remove();

    const plan = planMap.get(Number(kundeId));
    if (plan) {
      const badge = document.createElement('div');
      badge.className = 'wp-plan-badge';
      badge.style.backgroundColor = plan.color;
      badge.textContent = plan.initials;
      badge.title = `${plan.day} - ${plan.initials}`;
      el.appendChild(badge);
    }
  }

  // Store plan data on markers for cluster icon access
  for (const [kundeId, plan] of planMap) {
    if (markers[kundeId]) {
      markers[kundeId]._customerData = {
        ...markers[kundeId]._customerData,
        planned: true,
        plannedInitials: plan.initials,
        plannedColor: plan.color
      };
    }
  }
  // Clear planned flag for non-planned markers
  for (const kundeId of Object.keys(markers)) {
    if (!planMap.has(Number(kundeId)) && markers[kundeId]._customerData) {
      delete markers[kundeId]._customerData.planned;
      delete markers[kundeId]._customerData.plannedInitials;
      delete markers[kundeId]._customerData.plannedColor;
    }
  }
  if (typeof refreshClusters === 'function') refreshClusters();
}

// Lightweight re-apply of plan badges on visible markers (uses data stored on marker.options)
function reapplyPlanBadges() {
  if (!markers) return;

  for (const kundeId of Object.keys(markers)) {
    const marker = markers[kundeId];
    const el = marker.getElement();
    if (!el) continue;

    // Skip if badge already exists
    if (el.querySelector('.wp-plan-badge')) continue;

    const cd = marker._customerData;
    if (cd && cd.planned && cd.plannedInitials) {
      const badge = document.createElement('div');
      badge.className = 'wp-plan-badge';
      badge.style.backgroundColor = cd.plannedColor || TEAM_COLORS[0];
      badge.textContent = cd.plannedInitials;
      el.appendChild(badge);
    }
  }
}

// Update all day counters in the UI (called periodically)
function updateDayCounters() {
  // Re-render lists that show day counts
  const activeTab = document.querySelector('.tab-item.active')?.dataset.tab;

  if (activeTab === 'customers') {
    renderCustomerAdmin();
  } else if (activeTab === 'overdue') {
    renderOverdue();
  } else if (activeTab === 'warnings') {
    renderWarnings();
  } else if (activeTab === 'planner') {
    renderPlanner();
  }

  // Always update the badges
  updateOverdueBadge();
  renderMissingData(); // Update missing data badge

  // Update filter panel customer list
  applyFilters();
}

// Schedule update at next midnight to refresh day counters
function scheduleNextMidnightUpdate() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 1, 0); // 1 second after midnight

  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    Logger.log('Midnight update - refreshing day counters');
    updateDayCounters();
    // Schedule next midnight update
    scheduleNextMidnightUpdate();
  }, msUntilMidnight);

  Logger.log(`Next midnight update scheduled in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
}

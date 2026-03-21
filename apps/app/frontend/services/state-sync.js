// ========================================
// STATE SYNC - Sentralisert WS → UI oppdatering
// Mapper WebSocket-events til state-mutasjoner og render-funksjoner.
// Debouncer burst-events og prioriterer aktiv tab.
// ========================================

// Named helper for calendar reload (same reference = dedup works)
function _syncReloadCalendar() {
  if (typeof loadAvtaler === 'function') {
    return loadAvtaler().then(() => {
      if (typeof renderCalendar === 'function') renderCalendar();
    });
  }
}

// Refresh Arbeid "idag" sub-view (team-overview + todays-work)
// Debounced to avoid 10+ concurrent fetches during batch route creation
let _arbeidRefreshTimer = null;
function _syncRefreshArbeidIdag() {
  if (_arbeidRefreshTimer) clearTimeout(_arbeidRefreshTimer);
  _arbeidRefreshTimer = setTimeout(() => {
    _arbeidRefreshTimer = null;
    if (typeof currentArbeidView !== 'undefined' && currentArbeidView === 'idag') {
      if (typeof teamOverviewFetchData === 'function') teamOverviewFetchData();
      if (typeof loadTodaysWork === 'function' && typeof hasFeature === 'function' && hasFeature('todays_work')) {
        loadTodaysWork();
      }
    }
  }, 500);
}

// Refresh weekplan badges after avtale changes
function _syncRefreshWeekPlanBadges() {
  if (typeof updateWeekPlanBadges === 'function') updateWeekPlanBadges();
}

// Declarative event → mutation + render map
// _always: runs regardless of active tab
// Tab-keyed arrays: only run when that tab is active, otherwise tab is marked dirty
// immediate: bypass debounce (for latency-sensitive events)
const STATE_SYNC_MAP = {
  // ---- Kunde events ----
  kunde_created: {
    mutate(data) {
      customers.push(data);
    },
    renders: {
      _always: [applyFilters],
      customers: [renderCustomerAdmin],
      dashboard: [updateDashboard, renderMissingData, updateOverdueBadge],
    },
    notify(data) { return `Ny kunde opprettet: ${escapeHtml(data.navn || '')}`; },
  },

  kunde_updated: {
    mutate(data) {
      const idx = customers.findIndex(c => c.id === Number.parseInt(data.id));
      if (idx !== -1) customers[idx] = { ...customers[idx], ...data };
      // Sync embedded customer data in todays-work cache
      if (typeof twRouteData !== 'undefined' && twRouteData && twRouteData.kunder) {
        const twIdx = twRouteData.kunder.findIndex(k => k.id === Number.parseInt(data.id));
        if (twIdx !== -1) {
          twRouteData.kunder[twIdx] = { ...twRouteData.kunder[twIdx], ...data };
          if (typeof renderTodaysWork === 'function') renderTodaysWork();
        }
      }
    },
    renders: {
      _always: [applyFilters],
      customers: [renderCustomerAdmin],
      dashboard: [updateDashboard, renderMissingData, updateOverdueBadge],
    },
  },

  kunde_deleted: {
    mutate(data) {
      customers = customers.filter(c => c.id !== data.id);
      selectedCustomers.delete(data.id);
    },
    renders: {
      _always: [applyFilters, updateSelectionUI],
      customers: [renderCustomerAdmin],
      dashboard: [updateDashboard, renderMissingData, updateOverdueBadge],
    },
  },

  kunder_bulk_updated: {
    mutate: null,
    renders: { _always: [loadCustomers] },
  },

  // ---- Avtale events ----
  avtale_created:        { mutate: null, renders: { _always: [_syncRefreshWeekPlanBadges], arbeid: [_syncRefreshArbeidIdag], calendar: [_syncReloadCalendar] } },
  avtale_updated:        { mutate: null, renders: { _always: [_syncRefreshWeekPlanBadges], arbeid: [_syncRefreshArbeidIdag], calendar: [_syncReloadCalendar] } },
  avtale_deleted:        { mutate: null, renders: { _always: [_syncRefreshWeekPlanBadges], arbeid: [_syncRefreshArbeidIdag], calendar: [_syncReloadCalendar] } },
  avtale_series_deleted: { mutate: null, renders: { _always: [_syncRefreshWeekPlanBadges], arbeid: [_syncRefreshArbeidIdag], calendar: [_syncReloadCalendar] } },
  avtaler_bulk_created:  { mutate: null, renders: { _always: [_syncRefreshWeekPlanBadges], arbeid: [_syncRefreshArbeidIdag], calendar: [_syncReloadCalendar] } },

  // ---- Rute events ----
  rute_created: { mutate: null, renders: { _always: [loadCustomers], arbeid: [_syncRefreshArbeidIdag] } },
  rute_updated: { mutate: null, renders: { _always: [loadCustomers], arbeid: [_syncRefreshArbeidIdag] } },
  rute_deleted: { mutate: null, renders: { _always: [loadCustomers], arbeid: [_syncRefreshArbeidIdag] } },

  // ---- Presence events (immediate, no debounce) ----
  customer_claimed: {
    mutate(data) {
      presenceClaims.set(data.kundeId, {
        userId: data.userId,
        userName: data.userName,
        initials: data.initials,
      });
    },
    renders: { _always: ['_presenceBadge'] },
    immediate: true,
  },

  customer_released: {
    mutate(data) {
      presenceClaims.delete(data.kundeId);
    },
    renders: { _always: ['_presenceBadge'] },
    immediate: true,
  },

  user_offline: {
    mutate(data) {
      for (const [kundeId, claim] of presenceClaims) {
        if (claim.userId === data.userId) {
          presenceClaims.delete(kundeId);
          updatePresenceBadgeForKunde(kundeId);
        }
      }
    },
    renders: {},
    immediate: true,
  },

  // ---- Chat events (immediate, delegated) ----
  chat_message:     { mutate: null, renders: { _always: ['_chatMessage'] }, immediate: true },
  chat_typing:      { mutate: null, renders: { _always: ['_chatTyping'] }, immediate: true },
  chat_typing_stop: { mutate: null, renders: { _always: ['_chatTypingStop'] }, immediate: true },

  // ---- Time update ----
  time_update: { mutate: null, renders: { _always: ['_timeUpdate'] }, immediate: true },
};

// ========================================
// DEBOUNCE & DIRTY-TAB QUEUE
// ========================================

const SYNC_DEBOUNCE_MS = 150;
let _syncFlushTimer = null;
const _pendingRenderFns = new Set();
const _pendingTabKeys = new Set();
const _dirtyTabs = new Set();

function _getActiveTab() {
  return document.querySelector('.tab-item.active')?.dataset?.tab || 'dashboard';
}

function _scheduleSyncFlush() {
  if (_syncFlushTimer) clearTimeout(_syncFlushTimer);
  _syncFlushTimer = setTimeout(_flushSyncRenders, SYNC_DEBOUNCE_MS);
}

function _flushSyncRenders() {
  _syncFlushTimer = null;
  const activeTab = _getActiveTab();

  for (const fn of _pendingRenderFns) {
    // Check if this fn belongs to _always or the active tab
    // We run all collected fns — tab filtering was done at collection time
    try { fn(); } catch (e) { console.error('State sync render error:', e); }
  }

  // Mark non-active tabs as dirty
  for (const tabKey of _pendingTabKeys) {
    if (tabKey !== '_always' && tabKey !== activeTab) {
      _dirtyTabs.add(tabKey);
    }
  }

  _pendingRenderFns.clear();
  _pendingTabKeys.clear();
}

// Tab re-render map: what to run when switching to a dirty tab
const _tabRefreshMap = {
  customers:      () => { if (typeof renderCustomerAdmin === 'function') renderCustomerAdmin(); },
  dashboard:      () => { if (typeof updateDashboard === 'function') updateDashboard(); if (typeof renderMissingData === 'function') renderMissingData(); if (typeof updateOverdueBadge === 'function') updateOverdueBadge(); },
  overdue:        () => { if (typeof renderOverdueTab === 'function') renderOverdueTab(); },
  upcoming:       () => { if (typeof renderUpcomingTab === 'function') renderUpcomingTab(); },
  calendar:       () => _syncReloadCalendar(),
  'weekly-plan':  () => { if (typeof renderWeekPlan === 'function') renderWeekPlan(); },
  arbeid:         () => { if (typeof renderArbeidView === 'function') renderArbeidView(typeof currentArbeidView !== 'undefined' ? currentArbeidView : 'idag'); },
  chat:           () => { if (typeof renderChatConversations === 'function') renderChatConversations(); },
};

// Called from app-legacy.js on tab switch
function onTabSwitch(tabName) {
  if (_dirtyTabs.has(tabName)) {
    _dirtyTabs.delete(tabName);
    const refreshFn = _tabRefreshMap[tabName];
    if (refreshFn) {
      try { refreshFn(); } catch (e) { console.error('Tab refresh error:', e); }
    }
  }
}

// ========================================
// MAIN DISPATCH
// ========================================

function dispatchStateSync(message) {
  const { type, data } = message;
  const entry = STATE_SYNC_MAP[type];
  if (!entry) return;

  // 1. Always run mutation immediately
  if (entry.mutate) {
    try { entry.mutate(data); } catch (e) { console.error('State sync mutate error:', e); }
  }

  // 2. Notification
  if (entry.notify) {
    const msg = entry.notify(data);
    if (msg && typeof showNotification === 'function') showNotification(msg);
  }

  // 3. Immediate events — bypass debounce
  if (entry.immediate) {
    _executeImmediateRenders(entry, data);
    return;
  }

  // 4. Debounced — collect renders and schedule flush
  const activeTab = _getActiveTab();
  for (const [tabKey, fns] of Object.entries(entry.renders)) {
    _pendingTabKeys.add(tabKey);
    if (tabKey === '_always' || tabKey === activeTab) {
      for (const fn of fns) {
        _pendingRenderFns.add(fn); // dedup by reference
      }
    }
  }
  _scheduleSyncFlush();
}

function _executeImmediateRenders(entry, data) {
  for (const [tabKey, fns] of Object.entries(entry.renders)) {
    if (tabKey !== '_always') continue;
    for (const fn of fns) {
      try {
        // Handle string-tagged immediate renders
        if (fn === '_presenceBadge') {
          updatePresenceBadgeForKunde(data.kundeId);
        } else if (fn === '_chatMessage') {
          if (typeof handleIncomingChatMessage === 'function') handleIncomingChatMessage(data);
        } else if (fn === '_chatTyping') {
          if (typeof handleChatTyping === 'function') handleChatTyping(data);
        } else if (fn === '_chatTypingStop') {
          if (typeof handleChatTypingStop === 'function') handleChatTypingStop(data);
        } else if (fn === '_timeUpdate') {
          if (typeof updateDayCounters === 'function') updateDayCounters();
        } else if (typeof fn === 'function') {
          fn(data);
        }
      } catch (e) {
        console.error('State sync immediate render error:', e);
      }
    }
  }
}

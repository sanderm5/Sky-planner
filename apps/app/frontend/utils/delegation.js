// ========================================
// GLOBAL EVENT DELEGATION (with allowlist)
// Replaces inline onclick/onchange/onsubmit/oninput handlers
// for CSP scriptSrcAttr compliance (no 'unsafe-inline')
//
// SECURITY: Only allowlisted function names can be called.
// This prevents injected HTML from invoking arbitrary globals.
// ========================================

(function initGlobalDelegation() {

  // ---- Allowlisted action names ----
  // Only these functions can be invoked via data-action/data-on-change/etc.
  // To add a new delegated action, add its name here.
  const ALLOWED_ACTIONS = new Set([
    // Built-in (handled internally)
    'none','toggleParentClass','hideElement','removeSelf','removeParent','removeAncestor',
    // Navigation & general (handled by app-legacy switch-case, NOT delegation)
    // 'focusOnCustomer','navigateToCustomer','selectCustomer','editCustomer','toggleCustomerSelection',
    // 'selectOrganization','toggleSection',
    // Calendar (handled by app-legacy switch-case, NOT delegation)
    // 'calendar','openDayDetail','confirmDay','editAvtale','deleteAvtale',
    // 'quickAddAvtale','quickAddToday','quickAddToSplitDay','quickDeleteAvtale','quickMarkVisited',
    // 'showCalendarQuickMenu','addCustomerToCalendar','setActiveDay','setSplitActiveDay',
    // Weekplan — delegation-only actions (use data-args, no switch-case)
    'clearDayAvtaler',
    'wpAddNoteToDay','wpCancelNote',
    'wpDeleteNote','wpFilterNotes',
    'wpSaveNote','wpSelectNoteCustomer','wpSelectNoteDay','wpSelectNoteType','wpSetMaldag',
    'wpNotifyCustomer',
    'wpToggleCompleted','wpToggleNote','wpToggleOverforte','wpTransferNote',
    // Weekplan — handled by app-legacy switch-case, NOT delegation
    // 'weekPlanNext','weekPlanPrev','weekPlanPickDate','saveWeeklyPlan','clearWeekPlan',
    // 'closeWpRoute','removeFromPlan','setEstimatedTime','toggleRouteMarkers','toggleShowAllRecommendations',
    // 'wpAddAllSuggested','wpAddSearchResult','wpAddSuggested','wpAutoFillWeek',
    // 'wpCloseSuggestions','wpExportMaps','wpNavigateDay','wpOptimizeOrder','wpSuggestStops',
    // Mobile field
    'mfNavigate','mfNavigateAndCloseInfo','mfNotifyCustomer','mfStartRoute','mfCompleteRoute','mfShowVisitForm',
    'mfShowCustomerInfo','mfLogout','mfSwitchTab','mfPrevDay','mfNextDay',
    // Mobile chat
    'mfOpenChatConversation','mfSendChatMessage','mfShowChatList','mfShowNewDmView','mfStartDm',
    // Mobile calendar
    'mfCompleteAvtale','mfShowNewAvtaleSheet','mfCloseNewAvtaleSheet','mfSubmitNewAvtale',
    'mfSelectNewAvtaleKunde','mfClearNewAvtaleKunde',
    // Mobile admin
    'mfTeamPrevDay','mfTeamNextDay','mfExpandTeamRoute','mfShowWeekplanEditor',
    'mfTeamPrevWeek','mfTeamNextWeek','mfTeamThisWeek','mfToggleTeamMember','mfToggleTeamDay',
    'mfShowPushRouteSheet','mfClosePushRouteSheet','mfSetPushDate','mfSubmitPushRoute',
    'mfShowQuickAssign','mfCloseQuickAssign','mfSelectQuickAssignKunde',
    'mfClearQuickAssignSelection','mfSubmitQuickAssign','mfShowCustomerHistory',
    // Mobile weekplan editor
    'mfCloseWeekplanEditor','mfWpNavigateWeek','mfWpSave','mfWpScrollToDay',
    'mfWpAddCustomer','mfWpShowAssignAll','mfWpShowReassign','mfWpRemoveStop',
    'mfWpCloseReassign','mfWpConfirmReassign','mfWpCloseAssignAll','mfWpConfirmAssignAll',
    'mfWpCloseAddSheet','mfWpSelectCustomerToAdd',
    // Mobile weekplan areas
    'mfWpCloseAreaSheet','mfWpSwitchAreaTab','mfWpAddSelectedToDay','mfWpExpandArea',
    'mfWpSelectAllInArea','mfWpToggleCustomerSelect','mfWpCloseMethodSheet',
    'mfWpMethodSearch','mfWpMethodArea',
    // Team overview
    'teamOverviewPrevDay','teamOverviewNextDay','teamOverviewToday','teamOverviewToggle',
    'raoToggleView','raoPrevWeek','raoNextWeek','raoThisWeek','raoExpandRoute','raoOpenWeekplan','raoOpenTeamSettings',
    'toShowPushRoute','toClosePushRoute','toSetPushDate','toSubmitPushRoute',
    'toShowQuickAssign','toCloseQuickAssign','toSelectQuickAssignKunde',
    'toClearQuickAssignSelection','toSubmitQuickAssign','toShowCustomerLookup',
    'toCloseCustomerLookup','toShowCustomerDetail','toBackToCustomerSearch',
    'toOpenWeekplanEditor','toShowRouteOnMap',
    // Todays work
    'twNavigateToCustomer','twMarkVisited',
    // Overdue warnings (handled by app-legacy switch-case)
    // 'sendReminder','addGroupToWeekPlan',
    'toggleUpcomingAreas',
    // Dashboard
    'closeMorningBrief',
    // Chat
    'loadOlderChatMessages',
    // Email dialog
    'closeEmailDialog','previewEmail','sendEmailFromDialog',
    // Onboarding wizard
    'nextWizardStep','prevWizardStep','handleSkipOnboarding','completeOnboardingWizard',
    'useAddressAsRouteStart','selectImportMethodFile','selectImportMethodIntegration',
    'skipWizardImport','wizardImportRetry','wizardCleaningBack','wizardCleaningApprove',
    'wizardCleaningSkip','wizardCleaningTablePage','wizardImportBack','wizardImportNext',
    'skipAIQuestions','wizardPreviewTablePage','wizardSelectAllRows','wizardDeselectAllRows',
    'wizardStartImport','wizardImportComplete','wizardRollbackImport','wizardReimportFailed',
    'wizardDownloadErrorReport','wizardFixAllSimilar','wizardDeselectErrorRows',
    'closeImportModal',
    // Admin fields & categories
    'openFieldModal','confirmDeleteField','openCategoryListModal','openCategoryModal',
    'openCategoryModalFromList','deleteCategoryFromBtn','confirmDeleteCategory',
    'selectCategoryIcon','addSubcatGroupBtn','addSubcatItemBtn',
    'editCategoryFromList','editSubcatGroup','deleteSubcatGroup',
    'editSubcatItem','deleteSubcatItem',
    // Admin tab (editTeamMember, deleteTeamMember, focusTeamMember handled by switch-case)
    'selectAdminAddressSuggestionByIndex',
    'rerun-wizard','reset-tips','show-checklist','toggle-guidance',
    // Map & address
    'openAdminAddressTab','dismissAddressBanner','saveCompanyAddress','clearCompanyAddress',
    'saveInlineAddress','dismissInlineAddress',
    // Context tips & onboarding checklist
    'dismissCurrentTip','skipAllTips','dismissMiniTourTip','skipMiniTour',
    'minimizeChecklist','dismissChecklist',
    // Route groups & clusters (showGroupOnMap, createRouteFromGroup, showClusterOnMap, createRouteFromCluster handled by switch-case)
    'editGroup','deleteGroup','addGroup',
    // Coverage area
    'coverageFilterAll','coverageFilterInside','coverageFilterOutside',
    // Isochrone
    'isochroneClose',
    // Industry
    'select',
    // Subscription (sendEmail handled by switch-case)
    // Org customer admin (editOrgCustomer, deleteOrgCustomer, selectOrganization handled by switch-case)
    // Arbeid
    'showArbeidUke','showArbeidMaaned',
    // Popup weekplan & team assign
    'popupAddToWeekDay','popupAssignTeam',
    // Calendar map focus
    'focusCalendarDayOnMap',
    // Team map (RAO)
    'raoFocusMember',
    // Popover
    'popover-accounting','popover-import','popover-manual',
    // Add subcat
    'addSubcat','editSubcat','deleteSubcat',
  ]);

  // ---- Allowlisted handler names for change/input/submit/keydown ----
  const ALLOWED_HANDLERS = new Set([
    // Change handlers
    'handleAIQuestionAnswer','handleUnmappedColumn','mfSetPushDateCustom',
    'onEmailTemplateChange','toSetPushDateCustom','updateRequiredMapping',
    'updateWizardCategoryMapping','wizardToggleAllRows','wizardToggleBeforeAfter',
    'wizardToggleCleaningRule','wizardToggleRow',
    // Input handlers
    'mfKunderSearchHandler','mfQuickAssignSearchHandler','mfNewAvtaleSearchHandler',
    'mfSetEstimertTidHandler','mfWpSetEstimertTidHandler','toCustomerLookupSearchHandler',
    'toQuickAssignSearchHandler','updateCategoryColorPreview',
    // Submit handlers
    'saveCategory',
    // Keydown handlers
    'addSubcatGroupFromInput','addSubcatItemFromInput',
  ]);

  // ---- Built-in actions ----
  const BUILTIN_ACTIONS = {
    'none': () => {},
    'toggleParentClass': (el) => {
      const cls = el.dataset.class || 'expanded';
      el.parentElement.classList.toggle(cls);
    },
    'hideElement': (el) => {
      const targetId = el.dataset.target;
      if (targetId) {
        const target = document.getElementById(targetId);
        if (target) target.classList.add('hidden');
      }
    },
    'removeSelf': (el) => { el.remove(); },
    'removeParent': (el) => { el.parentElement.remove(); },
    'removeAncestor': (el) => {
      const selector = el.dataset.ancestor;
      if (selector) {
        const ancestor = el.closest(selector);
        if (ancestor) ancestor.remove();
      }
    },
  };

  function resolveArgs(el) {
    if (el.dataset.args) {
      try { return JSON.parse(el.dataset.args); }
      catch { return []; }
    }
    return null;
  }

  function callAction(actionName, el, event) {
    if (BUILTIN_ACTIONS[actionName]) {
      BUILTIN_ACTIONS[actionName](el, event);
      return;
    }
    if (!ALLOWED_ACTIONS.has(actionName)) return;
    const fn = window[actionName];
    if (typeof fn !== 'function') return;
    const args = resolveArgs(el);
    if (args !== null) { fn(...args); } else { fn(); }
  }

  function callHandler(actionName, el, extraArgs) {
    if (!ALLOWED_HANDLERS.has(actionName)) {
      console.warn(`[delegation] Blocked disallowed handler: ${actionName}`);
      return;
    }
    const fn = window[actionName];
    if (typeof fn !== 'function') return;
    const args = resolveArgs(el);
    if (args !== null) { fn(...args, ...extraArgs); } else { fn(...extraArgs); }
  }

  // Click
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.stopPropagation === 'true') e.stopPropagation();
    callAction(el.dataset.action, el, e);
  });

  // Change — passes element as last arg for .checked/.value access
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-on-change]');
    if (!el) return;
    callHandler(el.dataset.onChange, el, [el]);
  });

  // Submit — passes event
  document.addEventListener('submit', (e) => {
    const el = e.target.closest('[data-on-submit]');
    if (!el) return;
    callHandler(el.dataset.onSubmit, el, [e]);
  });

  // Input — passes el.value
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-on-input]');
    if (!el) return;
    callHandler(el.dataset.onInput, el, [el.value]);
  });

  // Keydown — filters by data-key, passes element
  document.addEventListener('keydown', (e) => {
    const el = e.target.closest('[data-on-keydown]');
    if (!el) return;
    const key = el.dataset.key;
    if (key && e.key !== key) return;
    e.preventDefault();
    callHandler(el.dataset.onKeydown, el, [el]);
  });
})();

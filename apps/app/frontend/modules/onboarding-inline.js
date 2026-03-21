// ========================================
// ONBOARDING ATTENTION SYSTEM
// Highlights fields and sections that need
// user attention. No overlays — works directly
// with the real UI elements.
// ========================================

// Active attention highlights (so we can clear them)
let activeAttentionElements = [];
let attentionCleanupTimer = null;

// Highlight a DOM element with a glowing attention effect
// Automatically clears after duration (default 6s), or when user interacts
function highlightElement(el, options = {}) {
  if (!el) return;
  const { duration = 6000, scrollIntoView = true, focusInput = true } = options;

  el.classList.add('onboard-attention');
  activeAttentionElements.push(el);

  if (scrollIntoView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Focus the first input/textarea inside if present
  if (focusInput) {
    const input = el.querySelector('input:not([type="hidden"]):not([type="checkbox"]), textarea');
    if (input) {
      setTimeout(() => input.focus(), 400);
    }
  }

  // Auto-clear after duration
  setTimeout(() => removeHighlight(el), duration);

  // Clear on any interaction inside the element
  const onInteract = () => {
    removeHighlight(el);
    el.removeEventListener('input', onInteract);
    el.removeEventListener('click', onInteract);
  };
  el.addEventListener('input', onInteract, { once: true });
  el.addEventListener('click', onInteract, { once: true });
}

// Remove highlight from a single element
function removeHighlight(el) {
  if (!el) return;
  el.classList.remove('onboard-attention');
  activeAttentionElements = activeAttentionElements.filter(e => e !== el);
}

// Clear all active highlights
function clearAllHighlights() {
  activeAttentionElements.forEach(el => el.classList.remove('onboard-attention'));
  activeAttentionElements = [];
}

// ========================================
// ATTENTION BADGES — small dots on fields
// that haven't been filled yet
// ========================================

// Check which fields need attention and show/hide badges
function refreshAttentionBadges() {
  if (!isGuidanceEnabled()) return;

  // Address section in admin tab
  const addressSection = document.getElementById('companyAddressSection');
  if (addressSection) {
    const hasAddress = !!(appConfig.routeStartLat && appConfig.routeStartLng);
    toggleAttentionBadge(addressSection, !hasAddress, 'Firmaadresse mangler');
  }

  // Admin tab itself (show dot if address is missing)
  const adminTab = document.getElementById('adminTab');
  if (adminTab) {
    const hasAddress = !!(appConfig.routeStartLat && appConfig.routeStartLng);
    const adminBadge = document.getElementById('adminAddressBadge');
    if (adminBadge) adminBadge.style.display = hasAddress ? 'none' : 'inline-flex';
  }

  // Customers area — show badge on add-customer button if no customers
  const addCustBtn = document.getElementById('addCustomerBtnTab');
  if (addCustBtn) {
    const hasCustomers = typeof customers !== 'undefined' && customers.length > 0;
    toggleAttentionBadge(addCustBtn, !hasCustomers, 'Legg til din første kunde');
  }
}

// Toggle a small attention dot on an element
function toggleAttentionBadge(el, show, tooltip) {
  if (!el) return;
  let badge = el.querySelector('.onboard-badge');

  if (show && !badge) {
    badge = document.createElement('span');
    badge.className = 'onboard-badge';
    if (tooltip) badge.title = tooltip;
    el.style.position = el.style.position || 'relative';
    el.appendChild(badge);
  } else if (!show && badge) {
    badge.remove();
  }
}

// ========================================
// NAVIGATE & HIGHLIGHT — used by checklist
// Navigate to the right tab/section and
// highlight the fields that need filling
// ========================================

// Navigate to admin address section and highlight it
function navigateAndHighlightAddress() {
  clearAllHighlights();
  const adminTab = document.querySelector('[data-tab="admin"]');
  if (adminTab) adminTab.click();

  setTimeout(() => {
    const section = document.getElementById('companyAddressSection');
    if (section) {
      highlightElement(section, { duration: 8000 });
    }
  }, 300);
}

// Navigate to admin team section and highlight it
function navigateAndHighlightTeam() {
  clearAllHighlights();
  const adminTab = document.querySelector('[data-tab="admin"]');
  if (adminTab) adminTab.click();

  setTimeout(() => {
    const section = document.getElementById('teamMembersSection');
    if (section) {
      highlightElement(section, { duration: 8000 });
      // Focus the add-button instead of an input
      const addBtn = document.getElementById('addTeamMemberBtn') || document.getElementById('addFirstMemberBtn');
      if (addBtn) {
        addBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, 300);
}

// Navigate to weekplan tab and highlight the search
function navigateAndHighlightWeekplan() {
  clearAllHighlights();
  // Switch to arbeid tab, then ukeplan sub-view
  const arbeidTab = document.querySelector('[data-tab="arbeid"]');
  if (arbeidTab) arbeidTab.click();

  setTimeout(() => {
    // Click ukeplan pill if available
    const ukePill = document.querySelector('.arbeid-pill[data-view="uke"]');
    if (ukePill) ukePill.click();

    setTimeout(() => {
      const search = document.getElementById('wpCustomerSearch');
      if (search) {
        highlightElement(search.closest('.wp-search-container') || search.parentElement, { duration: 8000 });
      }
      // Also highlight day selector
      const firstDay = document.querySelector('.wp-day');
      if (firstDay) {
        highlightElement(firstDay.parentElement, { duration: 8000, focusInput: false, scrollIntoView: false });
      }
    }, 300);
  }, 300);
}

// ========================================
// INITIAL ONBOARDING SCAN
// Show attention on fields that need it
// when a new user first enters the app
// ========================================

function showInlineAddressSetup() {
  // This function is called from spa-auth after login
  // Instead of showing an overlay, we highlight fields that need attention
  refreshAttentionBadges();

  // For users without address: open admin tab and highlight address section
  if (!appConfig.routeStartLat && !appConfig.routeStartLng) {
    // Show panels first so user can see the admin tab
    if (typeof showAppPanels === 'function') showAppPanels();

    // Brief delay, then navigate to admin and highlight address
    setTimeout(() => {
      navigateAndHighlightAddress();
    }, 800);
  }
}

// Stub for backward compat (called on logout)
function removeInlineAddressCard() {
  clearAllHighlights();
}

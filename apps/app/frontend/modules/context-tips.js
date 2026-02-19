// CONTEXT TIPS - First-time user guidance
// ========================================

const contextTips = {
  tips: [
    {
      id: 'map-intro',
      target: '#map',
      title: 'Interaktivt kart',
      message: 'Her ser du alle kundene dine på kartet. Klikk på en markør for å se detaljer.',
      position: 'top',
      icon: 'fa-map-marked-alt'
    },
    {
      id: 'add-customer',
      target: '.customer-add-btn, .add-client-btn, #addClientBtn',
      title: 'Legg til kunder',
      message: 'Klikk her for å legge til din første kunde.',
      position: 'bottom',
      icon: 'fa-user-plus'
    },
    {
      id: 'route-planning',
      target: '.route-btn, #routeBtn, [data-action="route"]',
      title: 'Ruteplanlegging',
      message: 'Planlegg effektive ruter mellom kundene dine.',
      position: 'bottom',
      icon: 'fa-route'
    },
    {
      id: 'calendar',
      target: '.calendar-btn, #calendarBtn, [data-view="calendar"]',
      title: 'Kalender',
      message: 'Hold oversikt over avtaler og oppgaver i kalenderen.',
      position: 'bottom',
      icon: 'fa-calendar-alt'
    }
  ],
  shownTips: [],
  currentTipIndex: 0,
  tipOverlay: null
};

// Initialize context tips
function initContextTips() {
  const stored = localStorage.getItem('shownContextTips');
  if (stored) {
    try {
      contextTips.shownTips = JSON.parse(stored);
    } catch (e) {
      contextTips.shownTips = [];
    }
  }
}

// Show context tips for first-time users
function showContextTips() {
  initContextTips();

  // Filter tips that haven't been shown
  const unshownTips = contextTips.tips.filter(tip => !contextTips.shownTips.includes(tip.id));

  if (unshownTips.length === 0) return;

  // Show first unshown tip after a delay
  setTimeout(() => {
    showTip(unshownTips[0]);
  }, 1000);
}

// Show a single tip
function showTip(tip) {
  const target = document.querySelector(tip.target);
  if (!target) {
    // Target not found, mark as shown and try next
    markTipAsShown(tip.id);
    showNextTip();
    return;
  }

  // Create tip overlay
  const overlay = document.createElement('div');
  overlay.className = 'context-tip-overlay';
  overlay.innerHTML = `
    <div class="context-tip-backdrop" onclick="dismissCurrentTip()"></div>
    <div class="context-tip" id="contextTip-${tip.id}">
      <div class="context-tip-arrow"></div>
      <div class="context-tip-icon">
        <i class="fas ${tip.icon}"></i>
      </div>
      <div class="context-tip-content">
        <h4>${escapeHtml(tip.title)}</h4>
        <p>${escapeHtml(tip.message)}</p>
      </div>
      <div class="context-tip-actions">
        <button class="context-tip-btn context-tip-btn-skip" onclick="skipAllTips()">
          Hopp over alle
        </button>
        <button class="context-tip-btn context-tip-btn-next" onclick="dismissCurrentTip()">
          Forstått <i class="fas fa-check"></i>
        </button>
      </div>
      <div class="context-tip-progress">
        ${contextTips.currentTipIndex + 1} av ${contextTips.tips.length - contextTips.shownTips.length}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  contextTips.tipOverlay = overlay;

  // Position the tip near the target
  positionTip(overlay.querySelector('.context-tip'), target, tip.position);

  // Highlight target
  target.classList.add('context-tip-highlight');

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
  });
}

// Position tip relative to target
function positionTip(tipElement, target, position) {
  const targetRect = target.getBoundingClientRect();
  const tipRect = tipElement.getBoundingClientRect();

  let top, left;
  const margin = 12;

  switch (position) {
    case 'top':
      top = targetRect.top - tipRect.height - margin;
      left = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);
      tipElement.classList.add('position-top');
      break;
    case 'bottom':
      top = targetRect.bottom + margin;
      left = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);
      tipElement.classList.add('position-bottom');
      break;
    case 'left':
      top = targetRect.top + (targetRect.height / 2) - (tipRect.height / 2);
      left = targetRect.left - tipRect.width - margin;
      tipElement.classList.add('position-left');
      break;
    case 'right':
      top = targetRect.top + (targetRect.height / 2) - (tipRect.height / 2);
      left = targetRect.right + margin;
      tipElement.classList.add('position-right');
      break;
    default:
      top = targetRect.bottom + margin;
      left = targetRect.left;
  }

  // Keep within viewport
  left = Math.max(16, Math.min(left, window.innerWidth - tipRect.width - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - tipRect.height - 16));

  tipElement.style.position = 'fixed';
  tipElement.style.top = `${top}px`;
  tipElement.style.left = `${left}px`;
}

// Mark tip as shown
function markTipAsShown(tipId) {
  if (!contextTips.shownTips.includes(tipId)) {
    contextTips.shownTips.push(tipId);
    localStorage.setItem('shownContextTips', JSON.stringify(contextTips.shownTips));
  }
}

// Dismiss current tip and show next
function dismissCurrentTip() {
  const unshownTips = contextTips.tips.filter(tip => !contextTips.shownTips.includes(tip.id));

  if (unshownTips.length > 0) {
    markTipAsShown(unshownTips[0].id);
  }

  // Remove highlight from all elements
  document.querySelectorAll('.context-tip-highlight').forEach(el => {
    el.classList.remove('context-tip-highlight');
  });

  // Remove overlay
  if (contextTips.tipOverlay) {
    contextTips.tipOverlay.classList.remove('visible');
    setTimeout(() => {
      contextTips.tipOverlay.remove();
      contextTips.tipOverlay = null;
      showNextTip();
    }, 300);
  }
}

// Show next tip
function showNextTip() {
  contextTips.currentTipIndex++;
  const unshownTips = contextTips.tips.filter(tip => !contextTips.shownTips.includes(tip.id));

  if (unshownTips.length > 0) {
    setTimeout(() => showTip(unshownTips[0]), 500);
  }
}

// Skip all tips
function skipAllTips() {
  contextTips.tips.forEach(tip => {
    markTipAsShown(tip.id);
  });

  // Remove highlight from all elements
  document.querySelectorAll('.context-tip-highlight').forEach(el => {
    el.classList.remove('context-tip-highlight');
  });

  if (contextTips.tipOverlay) {
    contextTips.tipOverlay.classList.remove('visible');
    setTimeout(() => {
      contextTips.tipOverlay.remove();
      contextTips.tipOverlay = null;
    }, 300);
  }
}

// Reset context tips (for testing)
function resetContextTips() {
  contextTips.shownTips = [];
  contextTips.currentTipIndex = 0;
  localStorage.removeItem('shownContextTips');
}

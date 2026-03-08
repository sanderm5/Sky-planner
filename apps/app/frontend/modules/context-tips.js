// CONTEXT TIPS - First-time user guidance
// ========================================

// Check if guidance is enabled (global helper used by multiple modules)
function isGuidanceEnabled() {
  return localStorage.getItem('skyplanner_guidanceEnabled') !== 'false';
}

const contextTips = {
  tips: [
    {
      id: 'map-intro',
      target: '#map',
      title: 'Interaktivt kart',
      message: 'Kartet viser alle kundene dine som markører. Klikk på en markør for å se kundedetaljer, og bruk musehjulet for å zoome inn/ut. Markører grupperes automatisk i klynger når du zoomer ut.',
      position: 'top',
      icon: 'fa-map-marked-alt'
    },
    {
      id: 'sidebar-nav',
      target: '#sidebar',
      title: 'Navigasjon',
      message: 'Sidemenyen gir tilgang til alle funksjonene: Kundeoversikt, Kalender, Ukeplan, Oversiktstavle og Innstillinger. Klikk på en fane for å bytte visning.',
      position: 'right',
      icon: 'fa-bars'
    },
    {
      id: 'add-customer',
      target: '#addCustomerBtn, #addCustomerBtnTab',
      title: 'Legg til kunde',
      message: 'Klikk her for å registrere en ny kunde. Fyll ut navn, adresse og kontaktinfo. Adressen blir automatisk plassert på kartet.',
      position: 'bottom',
      icon: 'fa-user-plus'
    },
    {
      id: 'import-customers',
      target: '#importCustomersBtn',
      title: 'Importer kunder',
      message: 'Importer kundelisten din fra Excel eller CSV. Veiviseren hjelper deg med å koble kolonnene til riktige felt og renser dataene automatisk.',
      position: 'bottom',
      icon: 'fa-file-import'
    },
    {
      id: 'filter-panel',
      target: '#filterPanelToggle',
      title: 'Filtrer og søk',
      message: 'Åpne filterpanelet for å søke etter kunder, filtrere på kategorier og tags, eller velge kunder for ruteplanlegging. Markerte kunder vises direkte på kartet.',
      position: 'left',
      icon: 'fa-filter'
    },
    {
      id: 'weekly-plan-intro',
      target: '[data-tab="weekly-plan"]',
      title: 'Ukeplan',
      message: 'Planlegg ukens ruter dag for dag. Søk opp kunder, legg dem til som nummererte stopp, og optimaliser rekkefølgen for korteste kjørerute.',
      position: 'bottom',
      icon: 'fa-calendar-week'
    },
    {
      id: 'calendar-intro',
      target: '[data-tab="calendar"]',
      title: 'Kalender',
      message: 'Opprett og administrer avtaler. Klikk på en dato for å legge til en avtale, og dra for å flytte den. Bytt mellom måned- og ukevisning.',
      position: 'bottom',
      icon: 'fa-calendar-alt'
    },
    {
      id: 'plan-route-btn',
      target: '#planRouteBtn',
      title: 'Planlegg rute',
      message: 'Velg kunder i filterpanelet og klikk her for å beregne optimal kjørerute mellom dem. Ruten vises på kartet med avstand og estimert tid.',
      position: 'bottom',
      icon: 'fa-route'
    },
    {
      id: 'admin-settings',
      target: '#adminTab',
      title: 'Innstillinger',
      message: 'Sett firmaadresse (startpunkt for ruter), administrer kategorier og egendefinerte felt, inviter teammedlemmer og tilpass appen.',
      position: 'bottom',
      icon: 'fa-cog'
    }
  ],
  shownTips: [],
  currentTipIndex: 0,
  tipOverlay: null
};

// Feature-specific mini-tours (shown when entering a feature tab for the first time)
const featureTours = {
  'weekly-plan': {
    id: 'tour-weekplan',
    storageKey: 'skyplanner_tour_weekplan',
    tips: [
      {
        target: '.wp-day',
        title: 'Velg dag',
        message: 'Klikk på en ukedag for å planlegge stopp. Hver dag viser antall stopp og estimert tid. Aktiv dag er markert med blå farge.',
        position: 'bottom',
        icon: 'fa-calendar-day'
      },
      {
        target: '#wpCustomerSearch',
        title: 'Søk og legg til stopp',
        message: 'Skriv kundenavn eller adresse for å søke. Klikk på en kunde i resultatlisten for å legge den til som stopp i dagens rute.',
        position: 'bottom',
        icon: 'fa-search'
      },
      {
        target: '[data-action="wpOptimizeOrder"]',
        title: 'Optimaliser rekkefølge',
        message: 'Beregner den korteste kjøreruten mellom alle stoppene for valgt dag. Bruker firmaadresse som start- og sluttpunkt.',
        position: 'bottom',
        icon: 'fa-sort-amount-down'
      }
    ]
  },
  'calendar': {
    id: 'tour-calendar',
    storageKey: 'skyplanner_tour_calendar',
    tips: [
      {
        target: '#calendarContainer',
        title: 'Opprett avtale',
        message: 'Klikk på en dato i kalenderen for å opprette en ny avtale. Du kan velge kunde, sette tidspunkt og legge til beskrivelse.',
        position: 'top',
        icon: 'fa-calendar-plus'
      },
      {
        target: '.fc-toolbar',
        title: 'Navigasjon og visning',
        message: 'Bruk pilene for å bla mellom måneder/uker. Knappene til høyre bytter mellom måneds- og ukevisning.',
        position: 'bottom',
        icon: 'fa-exchange-alt'
      }
    ]
  },
  'customers': {
    id: 'tour-customers',
    storageKey: 'skyplanner_tour_customers',
    tips: [
      {
        target: '#searchInput',
        title: 'Søk etter kunder',
        message: 'Skriv inn kundenavn, adresse eller telefonnummer for å finne kunder raskt. Resultatlisten oppdateres mens du skriver.',
        position: 'bottom',
        icon: 'fa-search'
      },
      {
        target: '#categoryFilterButtons',
        title: 'Filtrer på kategori',
        message: 'Klikk på en kategori for å vise kun kunder i den kategorien. Du kan kombinere flere kategorier.',
        position: 'bottom',
        icon: 'fa-tags'
      }
    ]
  }
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
  if (!isGuidanceEnabled()) return;

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
  if (!isGuidanceEnabled()) return;

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
        <i aria-hidden="true" class="fas ${tip.icon}"></i>
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
          Forstått <i aria-hidden="true" class="fas fa-check"></i>
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

// ========================================
// FEATURE-SPECIFIC MINI-TOURS
// ========================================

// Active mini-tour state
let activeMiniTour = null;
let miniTourTipIndex = 0;

// Show feature tour when entering a tab for the first time
function showFeatureTourIfNeeded(tabName) {
  if (!isGuidanceEnabled()) return;

  const tour = featureTours[tabName];
  if (!tour) return;

  // Already shown this tour
  if (localStorage.getItem(tour.storageKey) === 'true') return;

  // Delay to let tab content render
  setTimeout(() => {
    showMiniTour(tour);
  }, 600);
}

// Show a mini-tour (sequence of tips for a specific feature)
function showMiniTour(tour) {
  if (!isGuidanceEnabled()) return;

  activeMiniTour = tour;
  miniTourTipIndex = 0;
  showMiniTourTip();
}

// Show current mini-tour tip
function showMiniTourTip() {
  if (!activeMiniTour || miniTourTipIndex >= activeMiniTour.tips.length) {
    completeMiniTour();
    return;
  }

  const tip = activeMiniTour.tips[miniTourTipIndex];
  const target = document.querySelector(tip.target);

  if (!target) {
    // Skip this tip, try next
    miniTourTipIndex++;
    showMiniTourTip();
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'context-tip-overlay mini-tour-overlay';
  overlay.innerHTML = `
    <div class="context-tip-backdrop" onclick="dismissMiniTourTip()"></div>
    <div class="context-tip mini-tour-tip" id="miniTourTip-${miniTourTipIndex}">
      <div class="context-tip-arrow"></div>
      <div class="context-tip-icon">
        <i aria-hidden="true" class="fas ${tip.icon}"></i>
      </div>
      <div class="context-tip-content">
        <h4>${escapeHtml(tip.title)}</h4>
        <p>${escapeHtml(tip.message)}</p>
      </div>
      <div class="context-tip-actions">
        <button class="context-tip-btn context-tip-btn-skip" onclick="skipMiniTour()">
          Hopp over
        </button>
        <button class="context-tip-btn context-tip-btn-next" onclick="dismissMiniTourTip()">
          ${miniTourTipIndex < activeMiniTour.tips.length - 1 ? 'Neste <i aria-hidden="true" class="fas fa-arrow-right"></i>' : 'Forstått <i aria-hidden="true" class="fas fa-check"></i>'}
        </button>
      </div>
      <div class="context-tip-progress">
        ${miniTourTipIndex + 1} av ${activeMiniTour.tips.length}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  contextTips.tipOverlay = overlay;

  positionTip(overlay.querySelector('.context-tip'), target, tip.position);
  target.classList.add('context-tip-highlight');

  requestAnimationFrame(() => {
    overlay.classList.add('visible');
  });
}

// Dismiss current mini-tour tip and show next
function dismissMiniTourTip() {
  document.querySelectorAll('.context-tip-highlight').forEach(el => {
    el.classList.remove('context-tip-highlight');
  });

  if (contextTips.tipOverlay) {
    contextTips.tipOverlay.classList.remove('visible');
    setTimeout(() => {
      contextTips.tipOverlay.remove();
      contextTips.tipOverlay = null;
      miniTourTipIndex++;
      showMiniTourTip();
    }, 300);
  }
}

// Skip entire mini-tour
function skipMiniTour() {
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

  completeMiniTour();
}

// Mark mini-tour as completed
function completeMiniTour() {
  if (activeMiniTour) {
    localStorage.setItem(activeMiniTour.storageKey, 'true');
    activeMiniTour = null;
    miniTourTipIndex = 0;
  }
}

// Reset all feature tours (for testing / re-run)
function resetFeatureTours() {
  Object.values(featureTours).forEach(tour => {
    localStorage.removeItem(tour.storageKey);
  });
}

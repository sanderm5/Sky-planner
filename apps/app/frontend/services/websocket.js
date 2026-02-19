// ========================================
// WEBSOCKET & REAL-TIME UPDATES
// Connection, presence tracking, message handling
// ========================================

// WebSocket for real-time updates
let ws = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;
let wsInitialized = false;
const MAX_RECONNECT_ATTEMPTS = 10;

// Presence tracking: kundeId → { userId, userName, initials }
const presenceClaims = new Map();
let currentClaimedKundeId = null;
let myUserId = null;
let myInitials = null;

// Update connection indicator in UI
function updateWsConnectionIndicator(connected) {
  const indicator = document.getElementById('ws-connection-indicator');
  if (indicator) {
    indicator.className = connected ? 'ws-indicator ws-connected' : 'ws-indicator ws-disconnected';
    indicator.title = connected ? 'Sanntidsoppdateringer aktiv' : 'Frakoblet - prøver å koble til...';
  }
}

// Initialize WebSocket connection for real-time updates
function initWebSocket() {
  // Guard: only initialize once (called from multiple init paths)
  if (wsInitialized && ws && ws.readyState !== WebSocket.CLOSED) return;
  wsInitialized = true;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      Logger.log('WebSocket connected - sanntidsoppdateringer aktiv');
      wsReconnectAttempts = 0;
      updateWsConnectionIndicator(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleRealtimeUpdate(message);
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      Logger.log('WebSocket disconnected');
      updateWsConnectionIndicator(false);
      attemptReconnect();
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      updateWsConnectionIndicator(false);
    };
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    updateWsConnectionIndicator(false);
  }
}

// Attempt to reconnect WebSocket
function attemptReconnect() {
  if (wsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    Logger.log('Max reconnection attempts reached');
    return;
  }

  wsReconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 30000);

  wsReconnectTimer = setTimeout(() => {
    Logger.log(`Attempting WebSocket reconnection (${wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    wsInitialized = false; // Allow re-init for reconnect
    initWebSocket();
  }, delay);
}

// Handle real-time updates from WebSocket
function handleRealtimeUpdate(message) {
  const { type, data } = message;

  switch (type) {
    case 'connected':
      Logger.log('Server:', data || message.message);
      // Store own identity
      if (data && data.userId) {
        myUserId = data.userId;
        myInitials = data.initials || '';
      }
      // Load initial presence state
      if (data && data.presence) {
        presenceClaims.clear();
        for (const [kundeId, claim] of Object.entries(data.presence)) {
          presenceClaims.set(Number(kundeId), claim);
        }
        updatePresenceBadges();
      }
      break;

    case 'kunde_created':
      // Add new customer to list and re-render
      customers.push(data);
      applyFilters();
      renderCustomerAdmin();
      renderMissingData(); // Update missing data badge
      updateOverdueBadge();
      showNotification(`Ny kunde opprettet: ${data.navn}`);
      break;

    case 'kunde_updated':
      // Update existing customer
      const updateIndex = customers.findIndex(c => c.id === Number.parseInt(data.id));
      if (updateIndex !== -1) {
        customers[updateIndex] = { ...customers[updateIndex], ...data };
        applyFilters();
        renderCustomerAdmin();
        renderMissingData(); // Update missing data badge
        updateOverdueBadge();
      }
      break;

    case 'kunde_deleted':
      // Remove customer from list
      customers = customers.filter(c => c.id !== data.id);
      selectedCustomers.delete(data.id);
      applyFilters();
      renderCustomerAdmin();
      renderMissingData(); // Update missing data badge
      updateOverdueBadge();
      updateSelectionUI();
      break;

    case 'kunder_bulk_updated':
      // Bulk update - reload all customers
      Logger.log(`Bulk update: ${data.count} kunder oppdatert av annen bruker`);
      loadCustomers();
      break;

    case 'avtale_created':
    case 'avtale_updated':
    case 'avtale_deleted':
    case 'avtale_series_deleted':
    case 'avtaler_bulk_created':
      // Calendar changed - reload if calendar is visible
      Logger.log(`Avtale ${type.replace('avtale_', '').replace('avtaler_', '')}`);
      if (typeof loadAvtaler === 'function') {
        loadAvtaler();
      }
      break;

    case 'customer_claimed':
      // Someone started working on a customer
      presenceClaims.set(data.kundeId, {
        userId: data.userId,
        userName: data.userName,
        initials: data.initials,
      });
      updatePresenceBadgeForKunde(data.kundeId);
      // Show notification if someone else claimed (not ourselves)
      if (data.userId !== myUserId) {
        Logger.log(`${data.userName} jobber med kunde #${data.kundeId}`);
      }
      break;

    case 'customer_released':
      // Someone stopped working on a customer
      presenceClaims.delete(data.kundeId);
      updatePresenceBadgeForKunde(data.kundeId);
      break;

    case 'user_offline':
      // Another user went offline — remove all their claims
      for (const [kundeId, claim] of presenceClaims) {
        if (claim.userId === data.userId) {
          presenceClaims.delete(kundeId);
          updatePresenceBadgeForKunde(kundeId);
        }
      }
      Logger.log(`Bruker frakoblet: ${data.userName}`);
      break;

    case 'time_update':
      // Periodic time update - refresh day counters
      updateDayCounters();
      break;

    case 'chat_message':
      handleIncomingChatMessage(data);
      break;

    case 'chat_typing':
      handleChatTyping(data);
      break;

    case 'chat_typing_stop':
      handleChatTypingStop(data);
      break;

    case 'pong':
      break;
  }
}

// ========================================
// PRESENCE: Show who is working on which customer
// ========================================

/**
 * Send a claim_customer message via WebSocket
 */
function claimCustomer(kundeId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // Release previous claim if any
  if (currentClaimedKundeId && currentClaimedKundeId !== kundeId) {
    releaseCustomer(currentClaimedKundeId);
  }
  currentClaimedKundeId = kundeId;
  const userName = localStorage.getItem('userName') || 'Bruker';
  ws.send(JSON.stringify({ type: 'claim_customer', kundeId, userName }));
}

/**
 * Send a release_customer message via WebSocket
 */
function releaseCustomer(kundeId) {
  if (!kundeId) return;
  if (currentClaimedKundeId === kundeId) {
    currentClaimedKundeId = null;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'release_customer', kundeId }));
}

/**
 * Get a deterministic color for a user ID (for presence badges)
 * Uses 10 visually distinct colors — each user always gets the same one
 */
const PRESENCE_COLORS = [
  '#2563eb', // blå
  '#dc2626', // rød
  '#16a34a', // grønn
  '#9333ea', // lilla
  '#ea580c', // oransje
  '#0891b2', // cyan
  '#c026d3', // magenta
  '#ca8a04', // gul
  '#4f46e5', // indigo
  '#0d9488', // teal
];
function getPresenceColor(userId) {
  return PRESENCE_COLORS[userId % PRESENCE_COLORS.length];
}

/**
 * Update presence badge on a specific customer's marker
 */
function updatePresenceBadgeForKunde(kundeId) {
  if (!markers || !markers[kundeId]) return;
  const marker = markers[kundeId];
  const el = marker.getElement();
  if (!el) return;

  // Remove existing presence badge
  const existing = el.querySelector('.presence-badge');
  if (existing) existing.remove();

  // Add badge if someone has claimed this customer
  const claim = presenceClaims.get(kundeId);
  if (claim && claim.userId !== myUserId) {
    const badge = document.createElement('div');
    badge.className = 'presence-badge';
    badge.style.backgroundColor = getPresenceColor(claim.userId);
    badge.textContent = claim.initials;
    badge.title = `${claim.userName} jobber med denne kunden`;
    el.appendChild(badge);
  }
}

/**
 * Update all presence badges on map markers
 */
function updatePresenceBadges() {
  if (!markers) return;
  for (const kundeId of Object.keys(markers)) {
    updatePresenceBadgeForKunde(Number(kundeId));
  }
}

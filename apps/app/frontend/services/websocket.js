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

  // Mobile field view: update status dot in Account tab
  const mfStatusDot = document.querySelector('#mfAccountContent .mf-status-dot');
  if (mfStatusDot) {
    mfStatusDot.className = 'mf-status-dot ' + (connected ? 'online' : 'offline');
    mfStatusDot.textContent = connected ? 'Online' : 'Frakoblet';
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

  // Connection-level events stay here (not state-sync concerns)
  if (type === 'connected') {
    Logger.log('Server:', data || message.message);
    if (data && data.userId) {
      myUserId = data.userId;
      myInitials = data.initials || '';
    }
    if (data && data.presence) {
      presenceClaims.clear();
      for (const [kundeId, claim] of Object.entries(data.presence)) {
        presenceClaims.set(Number(kundeId), claim);
      }
      updatePresenceBadges();
    }
    return;
  }

  if (type === 'pong') return;

  // Delegate all state/render events to centralized sync
  if (typeof dispatchStateSync === 'function') {
    dispatchStateSync(message);
  }

  // Dispatch to mobile field view handler (if active)
  if (typeof handleMobileRealtimeUpdate === 'function') {
    handleMobileRealtimeUpdate(message);
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

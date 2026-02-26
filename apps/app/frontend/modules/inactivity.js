// ========================================
// INACTIVITY AUTO-LOGOUT (15 min)
// ========================================
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const INACTIVITY_WARNING_MS = 13 * 60 * 1000; // Warning at 13 min (2 min before logout)
let inactivityTimer = null;
let inactivityWarningTimer = null;
let inactivityWarningVisible = false;

function resetInactivityTimers() {
  if (inactivityWarningVisible) return; // Don't reset if warning is showing

  clearTimeout(inactivityTimer);
  clearTimeout(inactivityWarningTimer);

  // Only track when user is logged in
  if (!authToken && !document.cookie.includes('skyplanner_session')) return;

  inactivityWarningTimer = setTimeout(showInactivityWarning, INACTIVITY_WARNING_MS);
  inactivityTimer = setTimeout(() => {
    dismissInactivityWarning();
    logoutUser();
  }, INACTIVITY_TIMEOUT_MS);
}

function showInactivityWarning() {
  if (inactivityWarningVisible) return;
  inactivityWarningVisible = true;

  const existing = document.getElementById('inactivityWarningModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'inactivityWarningModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10001;';

  let secondsLeft = 120;
  modal.innerHTML = `
    <div style="background:var(--card-bg, #1a1a2e);border-radius:12px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
      <div style="width:64px;height:64px;margin:0 auto 20px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:flex;align-items:center;justify-content:center;">
        <i aria-hidden="true" class="fas fa-clock" style="font-size:28px;color:white;"></i>
      </div>
      <h2 style="color:var(--text-primary, #fff);margin:0 0 12px;font-size:20px;">Inaktivitet oppdaget</h2>
      <p style="color:var(--text-secondary, #a0a0a0);margin:0 0 8px;font-size:15px;">Du logges ut om <strong id="inactivityCountdown">${secondsLeft}</strong> sekunder på grunn av inaktivitet.</p>
      <p style="color:var(--text-muted, #666);margin:0 0 24px;font-size:13px;">Klikk knappen under for å forbli innlogget.</p>
      <button id="extendSessionBtn" style="background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;border:none;padding:12px 32px;border-radius:8px;font-size:15px;cursor:pointer;font-weight:600;">Fortsett sesjonen</button>
    </div>
  `;

  document.body.appendChild(modal);

  const countdownEl = document.getElementById('inactivityCountdown');
  const countdownInterval = setInterval(() => {
    secondsLeft--;
    if (countdownEl) countdownEl.textContent = secondsLeft;
    if (secondsLeft <= 0) clearInterval(countdownInterval);
  }, 1000);

  document.getElementById('extendSessionBtn').addEventListener('click', () => {
    clearInterval(countdownInterval);
    dismissInactivityWarning();
    resetInactivityTimers();
  });

  modal._countdownInterval = countdownInterval;
}

function dismissInactivityWarning() {
  inactivityWarningVisible = false;
  const modal = document.getElementById('inactivityWarningModal');
  if (modal) {
    if (modal._countdownInterval) clearInterval(modal._countdownInterval);
    modal.remove();
  }
}

const INACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

function startInactivityTracking() {
  // Remove any existing listeners first to prevent duplicates
  stopInactivityTracking();
  INACTIVITY_EVENTS.forEach(event => {
    document.addEventListener(event, resetInactivityTimers, { passive: true });
  });
  resetInactivityTimers();
}

function stopInactivityTracking() {
  clearTimeout(inactivityTimer);
  clearTimeout(inactivityWarningTimer);
  // Remove event listeners to prevent memory leaks
  INACTIVITY_EVENTS.forEach(event => {
    document.removeEventListener(event, resetInactivityTimers);
  });
  dismissInactivityWarning();
}

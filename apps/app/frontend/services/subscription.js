// ========================================
// SUBSCRIPTION ERROR HANDLING
// ========================================

/**
 * Shows a warning banner for subscription issues (grace period, trial ending)
 * Does not block app usage, just shows a dismissible warning
 */
function showSubscriptionWarningBanner(message) {
  // Only show once per session to avoid spamming
  if (window._subscriptionWarningShown) return;
  window._subscriptionWarningShown = true;

  // Remove existing banner if any
  const existing = document.getElementById('subscriptionWarningBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'subscriptionWarningBanner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-size:14px;';

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <i aria-hidden="true" class="fas fa-exclamation-circle"></i>
      <span>${escapeHtml(message)}</span>
    </div>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:white;cursor:pointer;font-size:18px;padding:0 5px;">&times;</button>
  `;

  document.body.prepend(banner);
}

// ========================================
// SUBSCRIPTION COUNTDOWN TIMER
// ========================================

let subscriptionTimerInterval = null;

/**
 * Decodes a JWT token to extract payload (without verification)
 */
function decodeJWT(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

/**
 * Initializes the subscription countdown timer
 * Only shows for users with active trial period
 */
function initSubscriptionTimer() {
  // Skip timer for enterprise plans - they don't have trials
  if (subscriptionInfo?.planType === 'enterprise') {
    hideSubscriptionTimer();
    return;
  }

  if (!subscriptionInfo) return;

  const { status: subscriptionStatus, trialEndsAt } = subscriptionInfo;

  // Only show timer for trialing subscriptions
  if (subscriptionStatus !== 'trialing') {
    hideSubscriptionTimer();
    return;
  }

  // Only show for trialing with valid end date
  if (!trialEndsAt) {
    hideSubscriptionTimer();
    return;
  }

  const targetDate = new Date(trialEndsAt);
  const timerLabel = 'Prøveperiode';

  // Start the countdown
  updateSubscriptionTimer(targetDate, timerLabel);

  // Clear any existing interval
  if (subscriptionTimerInterval) clearInterval(subscriptionTimerInterval);

  // Update every minute
  subscriptionTimerInterval = setInterval(() => {
    updateSubscriptionTimer(targetDate, timerLabel);
  }, 60000);
}

/**
 * Updates the subscription timer display
 */
function updateSubscriptionTimer(targetDate, label) {
  const timerEl = document.getElementById('subscriptionTimer');
  const timerText = document.getElementById('subscriptionTimerText');

  if (!timerEl || !timerText) return;

  const now = new Date();
  const diff = targetDate - now;

  if (diff <= 0) {
    timerText.textContent = 'Utløpt';
    timerEl.classList.add('warning');
    timerEl.style.display = 'flex';
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  let timeStr = '';
  if (days > 0) {
    timeStr = `${days}d ${hours}t`;
  } else if (hours > 0) {
    timeStr = `${hours}t ${minutes}m`;
  } else {
    timeStr = `${minutes}m`;
  }

  timerText.textContent = `${label}: ${timeStr}`;

  // Add warning class if less than 3 days
  if (days < 3) {
    timerEl.classList.add('warning');
  } else {
    timerEl.classList.remove('warning');
  }

  timerEl.style.display = 'flex';
}

/**
 * Hides the subscription timer
 */
function hideSubscriptionTimer() {
  const timerEl = document.getElementById('subscriptionTimer');
  if (timerEl) timerEl.style.display = 'none';

  if (subscriptionTimerInterval) {
    clearInterval(subscriptionTimerInterval);
    subscriptionTimerInterval = null;
  }
}

/**
 * Shows a modal when subscription is inactive
 * Prevents further app usage until subscription is resolved
 */
function showSubscriptionError(errorData) {
  const message = errorData.error || 'Abonnementet er ikke aktivt';
  const details = errorData.details || {};

  // Remove existing modal if any
  const existing = document.getElementById('subscriptionErrorModal');
  if (existing) existing.remove();

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'subscriptionErrorModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const statusMessages = {
    trial_expired: 'Prøveperioden din har utløpt',
    canceled: 'Abonnementet er kansellert',
    past_due: 'Betalingen har feilet',
    incomplete: 'Abonnementet er ikke fullført',
    grace_period_exceeded: 'Betalingsfristen er utløpt'
  };

  const statusTitle = statusMessages[details.reason] || 'Abonnement kreves';

  modal.innerHTML = `
    <div style="background:var(--card-bg, #1a1a2e);border-radius:12px;padding:32px;max-width:450px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
      <div style="width:64px;height:64px;margin:0 auto 20px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:flex;align-items:center;justify-content:center;">
        <i aria-hidden="true" class="fas fa-exclamation-triangle" style="font-size:28px;color:white;"></i>
      </div>
      <h2 style="color:var(--text-primary, #fff);margin:0 0 12px;font-size:24px;">${escapeHtml(statusTitle)}</h2>
      <p style="color:var(--text-secondary, #a0a0a0);margin:0 0 24px;font-size:15px;line-height:1.6;">${escapeHtml(message)}</p>
      <p style="font-size:13px;color:var(--text-muted, #666);">
        Kontakt administrator for å håndtere abonnementet, eller <a href="mailto:sander@efffekt.no" style="color:#3b82f6;">ta kontakt med support</a>.
      </p>
    </div>
  `;

  document.body.appendChild(modal);

  // Prevent any interaction with the app
  modal.addEventListener('click', (e) => {
    // Only allow clicking the email link
    if (e.target.tagName !== 'A') {
      e.stopPropagation();
    }
  });
}

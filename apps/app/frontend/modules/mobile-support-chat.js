// ============================================
// MOBILE SUPPORT CHAT — Support tab for mobile field view
// Adds a Support tab to the bottom bar for ALL users.
// Reuses supportWidgetState and API functions from support-widget.js.
// ============================================

let mfSupportInitialized = false;

// ---- Tab injection ----

function mfSetupSupportTab() {
  const mfView = document.getElementById('mobileFieldView');
  if (!mfView) return;

  const bottomBar = mfView.querySelector('.mf-bottom-bar');
  if (!bottomBar) return;

  // Check if already injected
  if (mfView.querySelector('#mfSupportView')) return;

  // Create Support tab view container
  const supportView = document.createElement('div');
  supportView.className = 'mf-tab-view';
  supportView.id = 'mfSupportView';
  supportView.style.display = 'none';
  supportView.innerHTML = `
    <div id="mfSupportListView" class="mf-support-list-view">
      <div class="mf-chat-header">
        <h3><i class="fas fa-headset" aria-hidden="true"></i> Support</h3>
      </div>
      <div id="mfSupportContent" class="mf-support-content"></div>
    </div>
    <div id="mfSupportMessageView" class="mf-support-message-view" style="display:none;">
      <div class="mf-chat-msg-header">
        <button class="mf-action-btn" data-action="mfSupportShowList" aria-label="Tilbake">
          <i class="fas fa-arrow-left" aria-hidden="true"></i>
        </button>
        <span id="mfSupportMessageTitle">Support</span>
      </div>
      <div id="mfSupportMessages" class="mf-chat-messages"></div>
      <div id="mfSupportClosedNotice" class="mf-support-closed-notice" style="display:none;">
        <span>Denne saken er lukket</span>
        <button class="mf-btn mf-btn-small" id="mfSupportReopenBtn" data-action="mfSupportReopenTicket">
          <i class="fas fa-redo" aria-hidden="true"></i> Gjenåpne
        </button>
      </div>
      <div class="mf-chat-input-area" id="mfSupportInputArea">
        <input type="text" id="mfSupportInput" class="mf-chat-input" placeholder="Skriv en melding..." maxlength="2000" autocomplete="off">
        <button class="mf-chat-send-btn" data-action="mfSupportSendMessage" aria-label="Send">
          <i class="fas fa-paper-plane" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;

  // Insert before bottom bar
  mfView.insertBefore(supportView, bottomBar);

  // Add Support tab button before Account tab
  const accountBtn = bottomBar.querySelector('[data-tab="account"]');
  if (accountBtn) {
    const supportBtn = document.createElement('button');
    supportBtn.className = 'mf-tab-btn';
    supportBtn.dataset.tab = 'support';
    supportBtn.dataset.action = 'mfSwitchTab';
    supportBtn.dataset.args = '["support"]';
    supportBtn.setAttribute('role', 'tab');
    supportBtn.setAttribute('aria-label', 'Support');
    supportBtn.innerHTML = `
      <i class="fas fa-headset" aria-hidden="true"></i>
      <span>Support</span>
      <span id="mfSupportBadge" class="mf-tab-badge" style="display:none;"></span>
    `;
    accountBtn.parentElement.insertBefore(supportBtn, accountBtn);
  }

  // Set up input event listener
  mfSetupSupportInputListeners();
}

// ---- Input listeners ----

function mfSetupSupportInputListeners() {
  const input = document.getElementById('mfSupportInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        mfSupportSendMessage();
      }
    });
  }
}

// ---- Tab lifecycle hooks ----

function mfOnSupportTabShown() {
  if (!mfSupportInitialized) {
    mfSupportInitialized = true;
  }
  // Always reload tickets when tab is shown
  mfSupportLoadTickets();
}

// ---- Load tickets ----

async function mfSupportLoadTickets() {
  try {
    const response = await fetch('/api/support-chat/tickets', { credentials: 'include' });
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      supportWidgetState.tickets = result.data;
      mfSupportUpdateBadge();
      if (supportWidgetState.view !== 'messages' || !supportWidgetState.activeTicketId) {
        mfSupportRenderList();
      }
    }
  } catch (e) {
    // Silent fail
  }
}

// ---- Render ticket list ----

function mfSupportRenderList() {
  const container = document.getElementById('mfSupportContent');
  if (!container) return;

  const openTickets = supportWidgetState.tickets.filter(t => t.status === 'open');
  const closedTickets = supportWidgetState.tickets.filter(t => t.status === 'closed');

  let html = `
    <div class="mf-support-topics">
      <p class="mf-support-topics-title">Hva trenger du hjelp med?</p>
      <div class="mf-support-topic-grid">
        <button class="mf-support-topic-btn" data-action="mfSupportCreateTicket" data-args='["Rapporter bug"]'>
          <i class="fas fa-bug" aria-hidden="true"></i>
          <span>Rapporter bug</span>
        </button>
        <button class="mf-support-topic-btn" data-action="mfSupportCreateTicket" data-args='["Trenger hjelp"]'>
          <i class="fas fa-question-circle" aria-hidden="true"></i>
          <span>Trenger hjelp</span>
        </button>
        <button class="mf-support-topic-btn" data-action="mfSupportCreateTicket" data-args='["Forslag til forbedring"]'>
          <i class="fas fa-lightbulb" aria-hidden="true"></i>
          <span>Forslag</span>
        </button>
        <button class="mf-support-topic-btn" data-action="mfSupportCreateTicket" data-args='["Annet"]'>
          <i class="fas fa-comment" aria-hidden="true"></i>
          <span>Annet</span>
        </button>
      </div>
    </div>`;

  if (openTickets.length > 0) {
    html += '<div class="mf-support-section"><div class="mf-support-section-title">Åpne saker</div>';
    for (const t of openTickets) {
      const time = t.updated_at ? new Date(t.updated_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'short' }) : '';
      html += `
        <div class="mf-chat-conv-item" data-action="mfSupportOpenTicket" data-args='[${t.id}]'>
          <div class="mf-chat-conv-icon"><i class="fas fa-headset" aria-hidden="true"></i></div>
          <div class="mf-chat-conv-info">
            <div class="mf-chat-conv-name">#${t.id} ${escapeHtml(t.subject || 'Support')}</div>
            <div class="mf-chat-conv-preview">${escapeHtml(t.last_message?.content?.substring(0, 60) || 'Ingen meldinger')}</div>
          </div>
          <div class="mf-chat-conv-meta">
            <span class="mf-chat-conv-time">${time}</span>
          </div>
        </div>`;
    }
    html += '</div>';
  }

  if (closedTickets.length > 0) {
    html += '<div class="mf-support-section"><div class="mf-support-section-title">Lukket</div>';
    for (const t of closedTickets.slice(0, 5)) {
      html += `
        <div class="mf-chat-conv-item mf-support-closed" data-action="mfSupportOpenTicket" data-args='[${t.id}]'>
          <div class="mf-chat-conv-icon" style="opacity:0.5;"><i class="fas fa-headset" aria-hidden="true"></i></div>
          <div class="mf-chat-conv-info">
            <div class="mf-chat-conv-name">#${t.id} ${escapeHtml(t.subject || 'Support')}</div>
          </div>
          <span class="mf-support-closed-badge">Lukket</span>
        </div>`;
    }
    html += '</div>';
  }

  if (openTickets.length === 0 && closedTickets.length === 0) {
    html += `
      <div class="mf-empty-state" style="margin-top:16px;">
        <i class="fas fa-headset" aria-hidden="true"></i>
        <p>Ingen support-saker ennå</p>
        <span class="mf-empty-hint">Velg et emne over for å kontakte oss</span>
      </div>`;
  }

  container.innerHTML = html;
}

// ---- Create ticket ----

async function mfSupportCreateTicket(topic) {
  try {
    const response = await fetch('/api/support-chat/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
      body: JSON.stringify({ subject: topic }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (typeof mfShowBanner === 'function') {
        mfShowBanner(err.error || 'Kunne ikke opprette sak', 'error');
      }
      return;
    }
    const result = await response.json();
    if (result.success && result.data) {
      await mfSupportLoadTickets();
      mfSupportOpenTicket(result.data.ticketId);
    }
  } catch (e) {
    if (typeof mfShowBanner === 'function') {
      mfShowBanner('Feil ved opprettelse av sak', 'error');
    }
  }
}

// ---- Open ticket (message view) ----

async function mfSupportOpenTicket(ticketId) {
  supportWidgetState.activeTicketId = ticketId;
  supportWidgetState.view = 'messages';

  const ticket = supportWidgetState.tickets.find(t => t.id === ticketId);
  const isClosed = ticket?.status === 'closed';

  // Set title
  const titleEl = document.getElementById('mfSupportMessageTitle');
  if (titleEl) titleEl.textContent = `#${ticketId} — ${ticket?.subject || 'Support'}`;

  // Show message view, hide list
  const listView = document.getElementById('mfSupportListView');
  const msgView = document.getElementById('mfSupportMessageView');
  if (listView) listView.style.display = 'none';
  if (msgView) msgView.style.display = 'flex';

  // Show/hide input and closed notice
  const inputArea = document.getElementById('mfSupportInputArea');
  const closedNotice = document.getElementById('mfSupportClosedNotice');
  if (inputArea) inputArea.style.display = isClosed ? 'none' : 'flex';
  if (closedNotice) closedNotice.style.display = isClosed ? 'flex' : 'none';

  // Store ticketId for reopen button
  const reopenBtn = document.getElementById('mfSupportReopenBtn');
  if (reopenBtn) {
    reopenBtn.dataset.args = `[${ticketId}]`;
  }

  // Load messages
  await mfSupportLoadMessages(ticketId);
  mfSupportScrollToBottom();

  // Mark as read
  if (supportWidgetState.messages.length > 0) {
    mfSupportMarkAsRead(ticketId);
  }

  // Focus input
  if (!isClosed) {
    setTimeout(() => {
      const input = document.getElementById('mfSupportInput');
      if (input) input.focus();
    }, 300);
  }
}

// ---- Load messages ----

async function mfSupportLoadMessages(ticketId) {
  try {
    const url = `/api/chat/conversations/${ticketId}/messages?limit=50`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      supportWidgetState.messages = result.data;
      mfSupportRenderMessages();
    }
  } catch (e) {
    // Silent fail
  }
}

// ---- Render messages ----

function mfSupportRenderMessages() {
  const container = document.getElementById('mfSupportMessages');
  if (!container) return;

  if (supportWidgetState.messages.length === 0) {
    container.innerHTML = `
      <div class="mf-empty-state">
        <i class="fas fa-comment-dots" aria-hidden="true"></i>
        <p>Beskriv problemet ditt, så hjelper vi deg!</p>
      </div>`;
    return;
  }

  let html = '';
  let lastDate = '';

  for (const msg of supportWidgetState.messages) {
    const msgDate = new Date(msg.created_at).toLocaleDateString('no-NO', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    if (msgDate !== lastDate) {
      html += `<div class="mf-chat-date-sep">${msgDate}</div>`;
      lastDate = msgDate;
    }

    const isSupport = msg.sender_name === 'Efffekt Support';
    const time = new Date(msg.created_at).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

    html += `
      <div class="mf-chat-msg ${isSupport ? 'other' : 'self'}">
        ${isSupport ? '<div class="mf-chat-msg-sender">Efffekt Support</div>' : ''}
        <div class="mf-chat-msg-content">${escapeHtml(msg.content)}</div>
        <div class="mf-chat-msg-time">${time}</div>
      </div>`;
  }

  container.innerHTML = html;
  mfSupportScrollToBottom();
}

// ---- Scroll to bottom ----

function mfSupportScrollToBottom() {
  const container = document.getElementById('mfSupportMessages');
  if (container) {
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }
}

// ---- Send message ----

async function mfSupportSendMessage() {
  const ticketId = supportWidgetState.activeTicketId;
  if (!ticketId) return;

  const input = document.getElementById('mfSupportInput');
  const content = input?.value?.trim();
  if (!content) return;

  input.value = '';

  try {
    const response = await fetch(`/api/chat/conversations/${ticketId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
      body: JSON.stringify({ content }),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      supportWidgetState.messages.push(result.data);
      mfSupportRenderMessages();
      mfSupportScrollToBottom();
    }
  } catch (e) {
    // Silent fail
  }
}

// ---- Mark as read ----

async function mfSupportMarkAsRead(ticketId) {
  if (supportWidgetState.messages.length === 0) return;
  const lastMsg = supportWidgetState.messages[supportWidgetState.messages.length - 1];
  try {
    await fetch(`/api/chat/conversations/${ticketId}/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
      body: JSON.stringify({ messageId: lastMsg.id }),
    });
  } catch (e) {
    // Non-critical
  }
}

// ---- Navigation ----

function mfSupportShowList() {
  supportWidgetState.view = 'list';
  supportWidgetState.activeTicketId = null;

  const listView = document.getElementById('mfSupportListView');
  const msgView = document.getElementById('mfSupportMessageView');
  if (msgView) msgView.style.display = 'none';
  if (listView) listView.style.display = '';

  mfSupportLoadTickets();
}

// ---- Reopen ticket ----

async function mfSupportReopenTicket(ticketId) {
  try {
    const response = await fetch(`/api/support-chat/tickets/${ticketId}/reopen`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
    });
    if (response.ok) {
      await mfSupportLoadTickets();
      mfSupportOpenTicket(ticketId);
    }
  } catch (e) {
    // Silent fail
  }
}

// ---- Badge update ----

function mfSupportUpdateBadge() {
  const badge = document.getElementById('mfSupportBadge');
  if (!badge) return;
  const openCount = supportWidgetState.tickets.filter(t => t.status === 'open').length;
  if (openCount > 0) {
    badge.textContent = openCount;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ---- Handle incoming WebSocket messages (called from support-widget.js) ----

function mfHandleSupportMessage(data) {
  const ticketId = data.conversation_id;
  const supportView = document.getElementById('mfSupportView');
  const isVisible = supportView && supportView.style.display !== 'none';

  if (isVisible && supportWidgetState.activeTicketId === ticketId) {
    // Currently viewing this ticket — add message
    if (!supportWidgetState.messages.find(m => m.id === data.id)) {
      supportWidgetState.messages.push(data);
      mfSupportRenderMessages();
      mfSupportScrollToBottom();
      mfSupportMarkAsRead(ticketId);
    }
  }

  // Update badge
  mfSupportLoadTickets();
}

// ---- Handle ticket closed/reopened events ----

function mfHandleSupportTicketClosed(data) {
  if (supportWidgetState.activeTicketId === data.conversationId) {
    const inputArea = document.getElementById('mfSupportInputArea');
    const closedNotice = document.getElementById('mfSupportClosedNotice');
    if (inputArea) inputArea.style.display = 'none';
    if (closedNotice) closedNotice.style.display = 'flex';
  }
  mfSupportLoadTickets();
}

// ---- Cleanup ----

function mfSupportCleanup() {
  mfSupportInitialized = false;
  supportWidgetState.activeTicketId = null;
  supportWidgetState.view = 'list';
}

// ---- Expose globally ----

window.mfSetupSupportTab = mfSetupSupportTab;
window.mfOnSupportTabShown = mfOnSupportTabShown;
window.mfSupportShowList = mfSupportShowList;
window.mfSupportOpenTicket = mfSupportOpenTicket;
window.mfSupportCreateTicket = mfSupportCreateTicket;
window.mfSupportSendMessage = mfSupportSendMessage;
window.mfSupportReopenTicket = mfSupportReopenTicket;
window.mfSupportUpdateBadge = mfSupportUpdateBadge;
window.mfHandleSupportMessage = mfHandleSupportMessage;
window.mfHandleSupportTicketClosed = mfHandleSupportTicketClosed;
window.mfSupportCleanup = mfSupportCleanup;

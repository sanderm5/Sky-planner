// ========================================
// SUPPORT CHAT (TICKET SYSTEM)
// Integrated into Meldinger tab as "Support" sub-view
// ========================================

// Two-tone "ding-dong" notification for support messages
function playSupportNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // First tone — high
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.frequency.value = 587; // D5
    osc1.type = 'sine';
    gain1.gain.setValueAtTime(0.12, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.25);

    // Second tone — lower, slight delay
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.frequency.value = 440; // A4
    osc2.type = 'sine';
    gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.45);

    // Clean up
    setTimeout(() => ctx.close(), 600);
  } catch (e) {
    // Silent fail
  }
}

const supportWidgetState = {
  tickets: [],          // Open tickets for this org
  activeTicketId: null,
  messages: [],
  unreadCounts: {},     // { ticketId: count }
  view: 'list',         // 'list' | 'messages'
};

async function initSupportWidget() {
  // Load existing tickets
  await loadSupportTickets();

  // Enter key listener
  const input = document.getElementById('supportWidgetInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendSupportWidgetMessage();
      }
    });
  }
}

async function loadSupportTickets() {
  try {
    const response = await fetch('/api/support-chat/tickets', { credentials: 'include' });
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      supportWidgetState.tickets = result.data;
      updateSupportWidgetBadge();
      if (supportWidgetState.view === 'list') {
        renderSupportTicketList();
      }
    }
  } catch (e) {
    // Silent fail
  }
}

function showSupportTicketList() {
  supportWidgetState.view = 'list';
  supportWidgetState.activeTicketId = null;
  const ticketList = document.getElementById('supportTicketList');
  const messagesArea = document.getElementById('supportWidgetMessagesArea');
  if (ticketList) ticketList.style.display = '';
  if (messagesArea) messagesArea.style.display = 'none';
  renderSupportTicketList();
}

function renderSupportTicketList() {
  const container = document.getElementById('supportWidgetMessages');
  if (!container) return;

  const openTickets = supportWidgetState.tickets.filter(t => t.status === 'open');
  const closedTickets = supportWidgetState.tickets.filter(t => t.status === 'closed');

  let html = `
    <div class="support-welcome-inline">
      <p>Hva trenger du hjelp med?</p>
      <div class="sw-topics">
        <button class="sw-topic-btn" data-action="sendSupportWidgetTopic" data-args='["Rapporter bug"]'>
          <i class="fas fa-bug" aria-hidden="true"></i> Rapporter bug
        </button>
        <button class="sw-topic-btn" data-action="sendSupportWidgetTopic" data-args='["Trenger hjelp"]'>
          <i class="fas fa-question-circle" aria-hidden="true"></i> Trenger hjelp
        </button>
        <button class="sw-topic-btn" data-action="sendSupportWidgetTopic" data-args='["Forslag til forbedring"]'>
          <i class="fas fa-lightbulb" aria-hidden="true"></i> Forslag
        </button>
        <button class="sw-topic-btn" data-action="sendSupportWidgetTopic" data-args='["Annet"]'>
          <i class="fas fa-comment" aria-hidden="true"></i> Annet
        </button>
      </div>
    </div>`;

  if (openTickets.length > 0) {
    html += '<div class="sw-ticket-section"><div class="sw-ticket-section-title">\u00c5pne saker</div>';
    for (const t of openTickets) {
      html += `
        <div class="sw-ticket-item" data-action="openSupportTicket" data-args='[${t.id}]'>
          <div class="sw-ticket-info">
            <span class="sw-ticket-id">#${t.id}</span>
            <span class="sw-ticket-subject">${escapeHtml(t.subject || 'Uten emne')}</span>
          </div>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </div>`;
    }
    html += '</div>';
  }

  if (closedTickets.length > 0) {
    html += '<div class="sw-ticket-section"><div class="sw-ticket-section-title">Lukket</div>';
    for (const t of closedTickets.slice(0, 5)) {
      html += `
        <div class="sw-ticket-item closed" data-action="openSupportTicket" data-args='[${t.id}]'>
          <div class="sw-ticket-info">
            <span class="sw-ticket-id">#${t.id}</span>
            <span class="sw-ticket-subject">${escapeHtml(t.subject || 'Uten emne')}</span>
          </div>
          <span class="sw-ticket-closed-badge">Lukket</span>
        </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

async function sendSupportWidgetTopic(topic) {
  try {
    const response = await fetch('/api/support-chat/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
      body: JSON.stringify({ subject: topic }),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      const ticketId = result.data.ticketId;
      // Reload tickets and open the new one
      await loadSupportTickets();
      openSupportTicket(ticketId);
    }
  } catch (e) {
    // Silent fail
  }
}

async function openSupportTicket(ticketId) {
  supportWidgetState.activeTicketId = ticketId;
  supportWidgetState.view = 'messages';

  const ticket = supportWidgetState.tickets.find(t => t.id === ticketId);
  const isClosed = ticket?.status === 'closed';

  // Update header title
  const title = document.getElementById('supportMessageTitle');
  if (title) title.textContent = `#${ticketId} \u2014 ${ticket?.subject || 'Support'}`;

  // Show messages area, hide ticket list
  const ticketList = document.getElementById('supportTicketList');
  const messagesArea = document.getElementById('supportWidgetMessagesArea');
  const inputArea = document.getElementById('supportInlineInput');
  if (ticketList) ticketList.style.display = 'none';
  if (messagesArea) messagesArea.style.display = 'flex';
  if (inputArea) inputArea.style.display = isClosed ? 'none' : 'flex';

  // Show/hide reopen button for closed tickets
  const msgList = document.getElementById('supportWidgetMsgList');
  const existingReopen = document.getElementById('swReopenBtn');
  if (existingReopen) existingReopen.remove();
  if (isClosed && msgList) {
    const reopenDiv = document.createElement('div');
    reopenDiv.className = 'sw-closed-notice';
    reopenDiv.id = 'swReopenBtn';
    reopenDiv.innerHTML = `
      <span>Denne saken er lukket</span>
      <button class="sw-reopen-btn" data-action="reopenSupportWidgetTicket" data-args='[${ticketId}]'>
        <i class="fas fa-redo"></i> Gjen\u00e5pne
      </button>`;
    msgList.parentElement.appendChild(reopenDiv);
  }

  // Load messages
  await loadSupportWidgetMessages(ticketId);
  scrollSupportWidgetToBottom();

  // Mark as read
  if (supportWidgetState.messages.length > 0) {
    markSupportWidgetAsRead(ticketId);
  }

  // Focus input
  if (!isClosed) {
    setTimeout(() => {
      const input = document.getElementById('supportWidgetInput');
      if (input) input.focus();
    }, 100);
  }
}

function supportWidgetBack() {
  showSupportTicketList();
}

async function loadSupportWidgetMessages(ticketId) {
  try {
    const url = `/api/chat/conversations/${ticketId}/messages?limit=50`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      supportWidgetState.messages = result.data;
      renderSupportWidgetMessages();
    }
  } catch (e) {
    // Silent fail
  }
}

function renderSupportWidgetMessages() {
  const container = document.getElementById('supportWidgetMsgList');
  if (!container) return;

  if (supportWidgetState.messages.length === 0) {
    container.innerHTML = '<div class="sw-empty-msgs"><p>Beskriv problemet ditt, s\u00e5 hjelper vi deg!</p></div>';
    return;
  }

  let html = '';
  let lastDate = '';

  for (const msg of supportWidgetState.messages) {
    const msgDate = new Date(msg.created_at).toLocaleDateString('no-NO', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    if (msgDate !== lastDate) {
      html += `<div class="sw-date-sep">${msgDate}</div>`;
      lastDate = msgDate;
    }

    const isSupport = msg.sender_name === 'Efffekt Support';
    const time = new Date(msg.created_at).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

    html += `
      <div class="sw-msg ${isSupport ? 'support' : 'self'}">
        ${isSupport ? '<div class="sw-msg-sender">Efffekt Support</div>' : ''}
        <div class="sw-msg-content">${escapeHtml(msg.content)}</div>
        <div class="sw-msg-time">${time}</div>
      </div>`;
  }

  container.innerHTML = html;
}

function scrollSupportWidgetToBottom() {
  const container = document.getElementById('supportWidgetMsgList');
  if (container) {
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }
}

async function sendSupportWidgetMessage() {
  const ticketId = supportWidgetState.activeTicketId;
  if (!ticketId) return;

  const input = document.getElementById('supportWidgetInput');
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
      renderSupportWidgetMessages();
      scrollSupportWidgetToBottom();
    }
  } catch (e) {
    // Silent fail
  }
}

async function markSupportWidgetAsRead(ticketId) {
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

function updateSupportWidgetBadge() {
  const badge = document.getElementById('supportUnreadBadge');
  if (!badge) return;
  const openCount = supportWidgetState.tickets.filter(t => t.status === 'open').length;
  badge.textContent = openCount;
  badge.style.display = openCount > 0 ? '' : 'none';
}

// Handle incoming support messages via WebSocket
function handleSupportWidgetMessage(data) {
  const ticketId = data.conversation_id;

  // Check if support tab is active and viewing this ticket
  const supportPane = document.getElementById('tab-support');
  const isViewingSupport = supportPane && supportPane.classList.contains('active');
  const isViewingTicket = isViewingSupport && supportWidgetState.activeTicketId === ticketId;

  if (isViewingTicket) {
    if (!supportWidgetState.messages.find(m => m.id === data.id)) {
      supportWidgetState.messages.push(data);
      renderSupportWidgetMessages();
      scrollSupportWidgetToBottom();
      markSupportWidgetAsRead(ticketId);
    }
  } else {
    // Play support-specific notification sound
    playSupportNotificationSound();
  }

  // Reload tickets to update badge
  loadSupportTickets();

  // Also notify mobile support tab
  if (typeof mfHandleSupportMessage === 'function') {
    mfHandleSupportMessage(data);
  }
}

async function reopenSupportWidgetTicket(ticketId) {
  try {
    const response = await fetch(`/api/support-chat/tickets/${ticketId}/reopen`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
    });
    if (response.ok) {
      await loadSupportTickets();
      openSupportTicket(ticketId);
    }
  } catch (e) {
    // Silent fail
  }
}

// Handle ticket closed event from WebSocket
function handleSupportTicketClosed(data) {
  const ticket = supportWidgetState.tickets.find(t => t.id === data.conversationId);
  if (ticket) ticket.status = 'closed';

  if (supportWidgetState.activeTicketId === data.conversationId) {
    // Hide input, show closed notice
    const inputArea = document.getElementById('supportInlineInput');
    if (inputArea) inputArea.style.display = 'none';
  }

  if (supportWidgetState.view === 'list') {
    renderSupportTicketList();
  }
  updateSupportWidgetBadge();

  // Also notify mobile support tab
  if (typeof mfHandleSupportTicketClosed === 'function') {
    mfHandleSupportTicketClosed(data);
  }
}

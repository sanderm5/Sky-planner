// ========================================
// SUPPORT CHAT WIDGET (TICKET SYSTEM)
// Floating widget — each request creates a ticket with ID
// ========================================

const supportWidgetState = {
  tickets: [],          // Open tickets for this org
  activeTicketId: null,
  messages: [],
  unreadCounts: {},     // { ticketId: count }
  isOpen: false,
  view: 'list',         // 'list' | 'messages'
};

async function initSupportWidget() {
  // Show widget (hidden by default on login screen)
  const widget = document.getElementById('supportWidget');
  if (widget) widget.style.display = '';

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

function toggleSupportWidget() {
  supportWidgetState.isOpen = !supportWidgetState.isOpen;
  const panel = document.getElementById('supportWidgetPanel');
  const btn = document.getElementById('supportWidgetBtn');
  if (!panel || !btn) return;

  if (supportWidgetState.isOpen) {
    panel.style.display = 'flex';
    btn.classList.add('active');
    loadSupportTickets();
    showSupportTicketList();
  } else {
    panel.style.display = 'none';
    btn.classList.remove('active');
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
      if (supportWidgetState.isOpen && supportWidgetState.view === 'list') {
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
  const messagesArea = document.getElementById('supportWidgetMessagesArea');
  const listArea = document.getElementById('supportWidgetMessages');
  const backBtn = document.querySelector('.sw-back-btn');
  if (messagesArea) messagesArea.style.display = 'none';
  if (listArea) listArea.style.display = 'flex';
  if (backBtn) backBtn.style.display = 'none';
  renderSupportTicketList();
}

function renderSupportTicketList() {
  const container = document.getElementById('supportWidgetMessages');
  if (!container) return;

  const openTickets = supportWidgetState.tickets.filter(t => t.status === 'open');
  const closedTickets = supportWidgetState.tickets.filter(t => t.status === 'closed');

  let html = `
    <div class="support-widget-welcome">
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
    html += '<div class="sw-ticket-section"><div class="sw-ticket-section-title">Åpne saker</div>';
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

  // Update header
  const header = document.querySelector('.support-widget-header-info span');
  if (header) header.textContent = `#${ticketId} — ${ticket?.subject || 'Support'}`;

  // Show messages area, hide list
  const listArea = document.getElementById('supportWidgetMessages');
  const messagesArea = document.getElementById('supportWidgetMessagesArea');
  const inputArea = document.querySelector('.support-widget-input');
  const backBtn = document.querySelector('.sw-back-btn');
  if (listArea) listArea.style.display = 'none';
  if (messagesArea) messagesArea.style.display = 'flex';
  if (inputArea) inputArea.style.display = isClosed ? 'none' : 'flex';
  if (backBtn) backBtn.style.display = 'inline-flex';

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
  const header = document.querySelector('.support-widget-header-info span');
  if (header) header.textContent = 'Support';
  const inputArea = document.querySelector('.support-widget-input');
  if (inputArea) inputArea.style.display = 'none';
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
    container.innerHTML = '<div class="sw-empty-msgs"><p>Beskriv problemet ditt, så hjelper vi deg!</p></div>';
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
  const badge = document.getElementById('supportWidgetBadge');
  if (!badge) return;
  const openCount = supportWidgetState.tickets.filter(t => t.status === 'open').length;
  badge.textContent = openCount;
  badge.style.display = openCount > 0 ? 'flex' : 'none';
}

// Handle incoming support messages via WebSocket
function handleSupportWidgetMessage(data) {
  const ticketId = data.conversation_id;

  if (supportWidgetState.isOpen && supportWidgetState.activeTicketId === ticketId) {
    if (!supportWidgetState.messages.find(m => m.id === data.id)) {
      supportWidgetState.messages.push(data);
      renderSupportWidgetMessages();
      scrollSupportWidgetToBottom();
      markSupportWidgetAsRead(ticketId);
    }
  }

  // Reload tickets to update badge
  loadSupportTickets();
}

// Handle ticket closed event from WebSocket
function handleSupportTicketClosed(data) {
  const ticket = supportWidgetState.tickets.find(t => t.id === data.conversationId);
  if (ticket) ticket.status = 'closed';

  if (supportWidgetState.activeTicketId === data.conversationId) {
    // Hide input, show closed notice
    const inputArea = document.querySelector('.support-widget-input');
    if (inputArea) inputArea.style.display = 'none';
  }

  if (supportWidgetState.view === 'list') {
    renderSupportTicketList();
  }
  updateSupportWidgetBadge();
}

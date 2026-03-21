// ============================================
// MOBILE CHAT — Chat tab for mobile field view
// Adds a Chat tab to the bottom bar for ALL users.
// Reuses chatState and API functions from chat.js.
// ============================================

let mfChatInitialized = false;

// ---- Tab injection ----

function mfSetupChatTab() {
  const mfView = document.getElementById('mobileFieldView');
  if (!mfView) return;

  const bottomBar = mfView.querySelector('.mf-bottom-bar');
  if (!bottomBar) return;

  // Check if already injected
  if (mfView.querySelector('#mfChatView')) return;

  // Create Chat tab view container
  const chatView = document.createElement('div');
  chatView.className = 'mf-tab-view';
  chatView.id = 'mfChatView';
  chatView.style.display = 'none';
  chatView.innerHTML = `
    <div id="mfChatListView" class="mf-chat-list-view">
      <div class="mf-chat-header">
        <h3><i class="fas fa-comments" aria-hidden="true"></i> Meldinger</h3>
        <button class="mf-action-btn" data-action="mfShowNewDmView" aria-label="Ny melding">
          <i class="fas fa-plus" aria-hidden="true"></i>
        </button>
      </div>
      <div id="mfChatConversations" class="mf-chat-conversations"></div>
    </div>
    <div id="mfChatMessageView" class="mf-chat-message-view" style="display:none;">
      <div class="mf-chat-msg-header">
        <button class="mf-action-btn" data-action="mfShowChatList" aria-label="Tilbake">
          <i class="fas fa-arrow-left" aria-hidden="true"></i>
        </button>
        <span id="mfChatMessageTitle">Teamchat</span>
      </div>
      <div id="mfChatMessages" class="mf-chat-messages"></div>
      <div id="mfChatTypingIndicator" class="mf-chat-typing" style="display:none;">
        <span id="mfChatTypingText"></span>
      </div>
      <div class="mf-chat-input-area">
        <input type="text" id="mfChatInput" class="mf-chat-input" placeholder="Skriv en melding..." maxlength="2000" autocomplete="off">
        <button class="mf-chat-send-btn" data-action="mfSendChatMessage" aria-label="Send">
          <i class="fas fa-paper-plane" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div id="mfChatNewDm" class="mf-chat-newdm-view" style="display:none;">
      <div class="mf-chat-msg-header">
        <button class="mf-action-btn" data-action="mfShowChatList" aria-label="Tilbake">
          <i class="fas fa-arrow-left" aria-hidden="true"></i>
        </button>
        <span>Ny melding</span>
      </div>
      <div id="mfChatTeamList" class="mf-chat-team-list"></div>
    </div>
  `;

  // Insert before bottom bar
  mfView.insertBefore(chatView, bottomBar);

  // Add Chat tab button to bottom bar (before Account tab)
  const accountBtn = bottomBar.querySelector('[data-tab="account"]');
  if (accountBtn) {
    const chatBtn = document.createElement('button');
    chatBtn.className = 'mf-tab-btn';
    chatBtn.dataset.tab = 'chat';
    chatBtn.dataset.action = 'mfSwitchTab';
    chatBtn.dataset.args = '["chat"]';
    chatBtn.setAttribute('role', 'tab');
    chatBtn.setAttribute('aria-label', 'Chat');
    chatBtn.innerHTML = `
      <i class="fas fa-comments" aria-hidden="true"></i>
      <span>Chat</span>
      <span id="mfChatBadge" class="mf-tab-badge" style="display:none;"></span>
    `;
    accountBtn.parentElement.insertBefore(chatBtn, accountBtn);
  }

  // Set up input event listeners
  mfSetupChatInputListeners();
}

// ---- Input listeners ----

function mfSetupChatInputListeners() {
  // Enter key to send
  const input = document.getElementById('mfChatInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        mfSendChatMessage();
      }
    });

    // Typing indicator
    input.addEventListener('input', () => {
      if (chatState.activeConversation) {
        sendChatTypingStart(chatState.activeConversation);
      }
    });
  }
}

// ---- Tab lifecycle hooks ----

function mfOnChatTabShown() {
  if (!mfChatInitialized) {
    initChat().then(() => {
      mfChatInitialized = true;
      loadChatConversations();
    });
  } else {
    loadChatConversations();
  }
}

function mfOnChatTabHidden() {
  // Nothing to clean up on hide
}

// ---- Conversation list rendering ----

function mfRenderChatConversations() {
  const container = document.getElementById('mfChatConversations');
  if (!container) return;

  if (chatState.conversations.length === 0) {
    container.innerHTML = `
      <div class="mf-empty-state">
        <i class="fas fa-comments" aria-hidden="true"></i>
        <p>Ingen samtaler enn\u00e5</p>
        <span class="mf-empty-hint">Trykk + for \u00e5 starte en ny samtale</span>
      </div>
    `;
    return;
  }

  let html = '';
  for (const conv of chatState.conversations) {
    const unread = chatState.unreadCounts[conv.id] || 0;
    const isOrg = conv.type === 'org';
    const name = isOrg ? 'Teamchat' : escapeHtml(conv.participant_name || 'Ukjent');
    const icon = isOrg ? 'fa-users' : 'fa-user';
    const preview = conv.last_message
      ? escapeHtml(conv.last_message.content.substring(0, 60))
      : 'Ingen meldinger enn\u00e5';
    const time = conv.last_message ? formatChatTime(conv.last_message.created_at) : '';

    html += `
      <div class="mf-chat-conv-item ${unread > 0 ? 'unread' : ''}" data-action="mfOpenChatConversation" data-args='[${conv.id}, "${conv.type}"]'>
        <div class="mf-chat-conv-icon"><i class="fas ${icon}" aria-hidden="true"></i></div>
        <div class="mf-chat-conv-info">
          <div class="mf-chat-conv-name">${name}</div>
          <div class="mf-chat-conv-preview">${preview}</div>
        </div>
        <div class="mf-chat-conv-meta">
          <span class="mf-chat-conv-time">${time}</span>
          ${unread > 0 ? `<span class="mf-chat-conv-unread">${unread}</span>` : ''}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// ---- Open conversation ----

async function mfOpenChatConversation(conversationId, type) {
  chatState.activeConversation = conversationId;
  chatState.activeConversationType = type;
  chatState.view = 'messages';

  // Set title
  const titleEl = document.getElementById('mfChatMessageTitle');
  if (titleEl) {
    if (type === 'org') {
      titleEl.textContent = 'Teamchat';
    } else {
      const conv = chatState.conversations.find(c => c.id === conversationId);
      titleEl.textContent = conv?.participant_name || 'Direktemelding';
    }
  }

  // Show message view, hide others
  const listView = document.getElementById('mfChatListView');
  const msgView = document.getElementById('mfChatMessageView');
  const newDmView = document.getElementById('mfChatNewDm');
  if (listView) listView.style.display = 'none';
  if (newDmView) newDmView.style.display = 'none';
  if (msgView) msgView.style.display = 'flex';

  // Load messages
  await loadChatMessages(conversationId);
  mfScrollChatToBottom();

  // Mark as read
  markChatAsRead(conversationId);

  // Focus input
  const input = document.getElementById('mfChatInput');
  if (input) setTimeout(() => input.focus(), 300);
}

// ---- Render messages ----

function mfRenderChatMessages(conversationId) {
  const container = document.getElementById('mfChatMessages');
  if (!container || chatState.activeConversation !== conversationId) return;

  // Only render if mobile chat view is visible
  const chatView = document.getElementById('mfChatView');
  if (!chatView || chatView.style.display === 'none') return;

  const messages = chatState.messages[conversationId] || [];
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="mf-empty-state">
        <i class="fas fa-comment-dots" aria-hidden="true"></i>
        <p>Ingen meldinger enn\u00e5. Si hei!</p>
      </div>
    `;
    return;
  }

  let lastDate = '';
  let html = '';

  // Load more button
  if (messages.length >= 50) {
    html += `<div class="mf-chat-load-more"><button data-action="loadOlderChatMessages">Last eldre meldinger</button></div>`;
  }

  for (const msg of messages) {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      html += `<div class="mf-chat-date-sep">${formatChatDate(msg.created_at)}</div>`;
    }

    const isSelf = msg.sender_id === myUserId;
    const time = new Date(msg.created_at).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

    html += `
      <div class="mf-chat-msg ${isSelf ? 'self' : 'other'}">
        ${!isSelf ? `<div class="mf-chat-msg-sender">${escapeHtml(msg.sender_name)}</div>` : ''}
        <div class="mf-chat-msg-content">${escapeHtml(msg.content)}</div>
        <div class="mf-chat-msg-time">${time}</div>
      </div>
    `;
  }

  container.innerHTML = html;
  mfScrollChatToBottom();
}

// ---- Scroll to bottom ----

function mfScrollChatToBottom() {
  const container = document.getElementById('mfChatMessages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

// ---- Send message ----

function mfSendChatMessage() {
  const input = document.getElementById('mfChatInput');
  if (!input || !chatState.activeConversation) return;
  const content = input.value.trim();
  if (!content) return;

  sendChatMessage(chatState.activeConversation, content);
  input.value = '';
  chatIsTyping = false;
}

// ---- Navigation ----

function mfShowChatList() {
  chatState.view = 'list';
  chatState.activeConversation = null;
  chatState.activeConversationType = null;

  const listView = document.getElementById('mfChatListView');
  const msgView = document.getElementById('mfChatMessageView');
  const newDmView = document.getElementById('mfChatNewDm');
  if (msgView) msgView.style.display = 'none';
  if (newDmView) newDmView.style.display = 'none';
  if (listView) listView.style.display = '';

  loadChatConversations();
}

// ---- New DM view ----

async function mfShowNewDmView() {
  chatState.view = 'newDm';

  const listView = document.getElementById('mfChatListView');
  const msgView = document.getElementById('mfChatMessageView');
  const newDmView = document.getElementById('mfChatNewDm');
  if (listView) listView.style.display = 'none';
  if (msgView) msgView.style.display = 'none';
  if (newDmView) newDmView.style.display = 'flex';

  const container = document.getElementById('mfChatTeamList');
  if (!container) return;

  container.innerHTML = '<div class="mf-loading"><div class="mf-spinner"></div><p>Laster teammedlemmer...</p></div>';

  try {
    const response = await fetch('/api/chat/team-members');
    if (!response.ok) {
      container.innerHTML = `
        <div class="mf-empty-state">
          <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
          <p>Kunne ikke laste teammedlemmer</p>
        </div>
      `;
      return;
    }
    const result = await response.json();
    if (result.success && result.data) {
      if (result.data.length === 0) {
        container.innerHTML = `
          <div class="mf-empty-state">
            <i class="fas fa-user-slash" aria-hidden="true"></i>
            <p>Ingen andre teammedlemmer funnet</p>
          </div>
        `;
        return;
      }

      let html = '';
      for (const member of result.data) {
        const initials = mfGetInitials(member.navn);
        html += `
          <div class="mf-chat-team-item" data-action="mfStartDm" data-args='[${member.id}]'>
            <div class="mf-chat-team-avatar">${escapeHtml(initials)}</div>
            <div class="mf-chat-team-name">${escapeHtml(member.navn)}</div>
            <i class="fas fa-chevron-right" aria-hidden="true" style="opacity:0.3;"></i>
          </div>
        `;
      }
      container.innerHTML = html;
    }
  } catch (e) {
    console.error('Mobile chat: Failed to load team members:', e);
    container.innerHTML = `
      <div class="mf-empty-state">
        <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
        <p>Feil ved lasting av teammedlemmer</p>
      </div>
    `;
  }
}

async function mfStartDm(targetUserId) {
  const convId = await startDmConversation(targetUserId);
  if (convId) {
    await loadChatConversations();
    mfOpenChatConversation(convId, 'dm');
  }
}

// ---- Typing indicator ----

function mfRenderTypingIndicator(conversationId) {
  const indicator = document.getElementById('mfChatTypingIndicator');
  const text = document.getElementById('mfChatTypingText');
  if (!indicator || !text || chatState.activeConversation !== conversationId) return;

  const prefix = `${conversationId}-`;
  const typingNames = Object.entries(chatState.typingUsers)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, name]) => name);

  if (typingNames.length === 0) {
    indicator.style.display = 'none';
  } else {
    indicator.style.display = '';
    text.textContent = typingNames.length === 1
      ? `${typingNames[0]} skriver...`
      : `${typingNames.join(' og ')} skriver...`;
  }
}

// ---- Badge update ----

function mfUpdateChatBadge() {
  const badge = document.getElementById('mfChatBadge');
  if (!badge) return;
  if (chatState.totalUnread > 0) {
    badge.textContent = chatState.totalUnread > 99 ? '99+' : chatState.totalUnread;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ---- Cleanup ----

function mfChatCleanup() {
  mfChatInitialized = false;
  chatState.activeConversation = null;
  chatState.view = 'list';
}

// ---- Expose globally ----

window.mfSetupChatTab = mfSetupChatTab;
window.mfOnChatTabShown = mfOnChatTabShown;
window.mfOnChatTabHidden = mfOnChatTabHidden;
window.mfRenderChatConversations = mfRenderChatConversations;
window.mfOpenChatConversation = mfOpenChatConversation;
window.mfRenderChatMessages = mfRenderChatMessages;
window.mfScrollChatToBottom = mfScrollChatToBottom;
window.mfSendChatMessage = mfSendChatMessage;
window.mfShowChatList = mfShowChatList;
window.mfShowNewDmView = mfShowNewDmView;
window.mfStartDm = mfStartDm;
window.mfRenderTypingIndicator = mfRenderTypingIndicator;
window.mfUpdateChatBadge = mfUpdateChatBadge;
window.mfChatCleanup = mfChatCleanup;

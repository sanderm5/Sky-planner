// ========================================
// CHAT / MESSAGING SYSTEM
// ========================================

const chatState = {
  conversations: [],
  activeConversation: null,
  activeConversationType: null,
  messages: {},
  unreadCounts: {},
  totalUnread: 0,
  orgConversationId: null,
  typingUsers: {},
  view: 'list', // 'list' | 'messages' | 'newDm'
};

let chatTypingTimer = null;
let chatIsTyping = false;
let chatNotificationSound = null;

// Initialize notification sound (small beep)
function initChatSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    chatNotificationSound = audioCtx;
  } catch (e) {
    // Audio not supported
  }
}

function playChatNotificationSound() {
  try {
    if (!chatNotificationSound) initChatSound();
    if (!chatNotificationSound) return;
    const ctx = chatNotificationSound;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // Silent fail
  }
}

// Build headers for chat API calls (includes CSRF token)
function chatHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

// Initialize chat system
async function initChat() {
  try {
    const response = await fetch('/api/chat/init', {
      method: 'POST',
      headers: chatHeaders(),
    });
    if (!response.ok) {
      console.error('Chat init failed:', response.status, response.statusText);
      try { console.error('Chat init body:', await response.text()); } catch {}
      return;
    }
    const result = await response.json();
    if (result.success && result.data) {
      chatState.orgConversationId = result.data.orgConversationId;
      chatState.totalUnread = result.data.totalUnread;
      updateChatBadge();
    }
  } catch (e) {
    console.error('Failed to init chat:', e);
  }
}

// Fetch conversations
async function loadChatConversations() {
  try {
    const response = await fetch('/api/chat/conversations');
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      chatState.conversations = result.data;
      // Update unread counts
      chatState.totalUnread = 0;
      chatState.unreadCounts = {};
      for (const conv of result.data) {
        if (conv.unread_count > 0) {
          chatState.unreadCounts[conv.id] = conv.unread_count;
          chatState.totalUnread += conv.unread_count;
        }
      }
      updateChatBadge();
      renderChatConversations();
    }
  } catch (e) {
    console.error('Failed to load conversations:', e);
  }
}

// Fetch messages for a conversation
async function loadChatMessages(conversationId, before) {
  try {
    let url = `/api/chat/conversations/${conversationId}/messages?limit=50`;
    if (before) url += `&before=${before}`;
    const response = await fetch(url);
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      if (before) {
        // Prepend older messages
        chatState.messages[conversationId] = [...result.data, ...(chatState.messages[conversationId] || [])];
      } else {
        chatState.messages[conversationId] = result.data;
      }
      renderChatMessages(conversationId);
    }
  } catch (e) {
    console.error('Failed to load messages:', e);
  }
}

// Send a message
async function sendChatMessage(conversationId, content) {
  if (!content.trim()) return;
  try {
    const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: chatHeaders(),
      body: JSON.stringify({ content: content.trim() }),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      // Add message locally (optimistic)
      if (!chatState.messages[conversationId]) chatState.messages[conversationId] = [];
      chatState.messages[conversationId].push(result.data);
      renderChatMessages(conversationId);
      scrollChatToBottom();
      // Update conversation list
      loadChatConversations();
    }
  } catch (e) {
    console.error('Failed to send message:', e);
  }
}

// Mark conversation as read
async function markChatAsRead(conversationId) {
  const messages = chatState.messages[conversationId];
  if (!messages || messages.length === 0) return;
  const lastMsg = messages[messages.length - 1];
  try {
    await fetch(`/api/chat/conversations/${conversationId}/read`, {
      method: 'PUT',
      headers: chatHeaders(),
      body: JSON.stringify({ messageId: lastMsg.id }),
    });
    // Update local state
    const prevCount = chatState.unreadCounts[conversationId] || 0;
    chatState.totalUnread = Math.max(0, chatState.totalUnread - prevCount);
    delete chatState.unreadCounts[conversationId];
    updateChatBadge();
  } catch (e) {
    console.error('Failed to mark as read:', e);
  }
}

// Create or find DM conversation
async function startDmConversation(targetUserId) {
  try {
    const response = await fetch('/api/chat/conversations/dm', {
      method: 'POST',
      headers: chatHeaders(),
      body: JSON.stringify({ targetUserId }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result.success && result.data) {
      return result.data.id;
    }
  } catch (e) {
    console.error('Failed to start DM:', e);
  }
  return null;
}

// Handle incoming chat message from WebSocket
function handleIncomingChatMessage(data) {
  const convId = data.conversation_id;
  // Add to local messages if we have this conversation loaded
  if (chatState.messages[convId]) {
    // Avoid duplicates
    if (!chatState.messages[convId].some(m => m.id === data.id)) {
      chatState.messages[convId].push(data);
    }
  }

  // Update unread count (if not viewing this conversation)
  const isViewingThis = chatState.activeConversation === convId && chatState.view === 'messages';
  if (!isViewingThis) {
    chatState.unreadCounts[convId] = (chatState.unreadCounts[convId] || 0) + 1;
    chatState.totalUnread++;
    updateChatBadge();
    playChatNotificationSound();
  } else {
    // Auto-mark as read if viewing
    markChatAsRead(convId);
    renderChatMessages(convId);
    scrollChatToBottom();
  }

  // Update conversation list
  renderChatConversations();

  // Remove typing indicator for this user
  handleChatTypingStop({ conversationId: convId, userId: data.sender_id });
}

// Handle typing indicator
function handleChatTyping(data) {
  const key = `${data.conversationId}-${data.userId}`;
  chatState.typingUsers[key] = data.userName;
  renderTypingIndicator(data.conversationId);
  // Auto-clear after 5 seconds
  setTimeout(() => {
    delete chatState.typingUsers[key];
    renderTypingIndicator(data.conversationId);
  }, 5000);
}

function handleChatTypingStop(data) {
  const key = `${data.conversationId}-${data.userId}`;
  delete chatState.typingUsers[key];
  renderTypingIndicator(data.conversationId);
}

// Send typing indicator
function sendChatTypingStart(conversationId) {
  if (chatIsTyping) return;
  chatIsTyping = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat_typing_start', conversationId }));
  }
  clearTimeout(chatTypingTimer);
  chatTypingTimer = setTimeout(() => {
    chatIsTyping = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat_typing_stop', conversationId }));
    }
  }, 3000);
}

// Update chat badge
function updateChatBadge() {
  const badge = document.getElementById('chatUnreadBadge');
  if (!badge) return;
  if (chatState.totalUnread > 0) {
    badge.textContent = chatState.totalUnread > 99 ? '99+' : chatState.totalUnread;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// Format chat timestamp
function formatChatTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return time;
  return d.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' }) + ' ' + time;
}

function formatChatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'I dag';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'I g\u00e5r';
  return d.toLocaleDateString('no-NO', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Get initials from name
function getChatInitials(name) {
  if (!name) return '??';
  const parts = name.split(/[\s.\-_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

// Render conversation list
function renderChatConversations() {
  const container = document.getElementById('chatConversations');
  if (!container) return;

  if (chatState.conversations.length === 0) {
    container.innerHTML = `
      <div class="chat-empty-state">
        <i class="fas fa-comments"></i>
        <p>Ingen samtaler enn\u00e5</p>
        <p>Start en ny samtale med en kollega</p>
      </div>`;
    return;
  }

  container.innerHTML = chatState.conversations.map(conv => {
    const unread = chatState.unreadCounts[conv.id] || 0;
    const isOrg = conv.type === 'org';
    const name = isOrg ? 'Teamchat' : escapeHtml(conv.participant_name || 'Ukjent');
    const icon = isOrg ? 'fa-users' : 'fa-user';
    const preview = conv.last_message
      ? escapeHtml(conv.last_message.content.substring(0, 50))
      : 'Ingen meldinger enn\u00e5';
    const time = conv.last_message ? formatChatTime(conv.last_message.created_at) : '';

    return `
      <div class="chat-conv-item ${unread > 0 ? 'unread' : ''}" data-conv-id="${conv.id}" data-conv-type="${conv.type}">
        <div class="chat-conv-icon"><i class="fas ${icon}"></i></div>
        <div class="chat-conv-info">
          <div class="chat-conv-name">${name}</div>
          <div class="chat-conv-preview">${preview}</div>
        </div>
        <div class="chat-conv-meta">
          <span class="chat-conv-time">${time}</span>
          ${unread > 0 ? `<span class="chat-conv-unread">${unread}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  // Attach click handlers
  container.querySelectorAll('.chat-conv-item').forEach(item => {
    item.addEventListener('click', () => {
      const convId = parseInt(item.dataset.convId, 10);
      const convType = item.dataset.convType;
      openChatConversation(convId, convType);
    });
  });
}

// Open a conversation
async function openChatConversation(conversationId, type) {
  chatState.activeConversation = conversationId;
  chatState.activeConversationType = type;
  chatState.view = 'messages';

  // Set title
  const titleEl = document.getElementById('chatMessageTitle');
  if (type === 'org') {
    titleEl.textContent = 'Teamchat';
  } else {
    const conv = chatState.conversations.find(c => c.id === conversationId);
    titleEl.textContent = conv?.participant_name || 'Direktemelding';
  }

  // Show message view, hide others
  document.getElementById('chatConversationList').style.display = 'none';
  document.getElementById('chatNewDm').style.display = 'none';
  document.getElementById('chatMessageView').style.display = 'flex';

  // Load messages
  await loadChatMessages(conversationId);
  scrollChatToBottom();

  // Mark as read
  markChatAsRead(conversationId);
}

// Render messages
function renderChatMessages(conversationId) {
  const container = document.getElementById('chatMessages');
  if (!container || chatState.activeConversation !== conversationId) return;

  const messages = chatState.messages[conversationId] || [];
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="chat-empty-state">
        <i class="fas fa-comment-dots"></i>
        <p>Ingen meldinger enn\u00e5. Si hei!</p>
      </div>`;
    return;
  }

  // Group by date
  let lastDate = '';
  let html = '';

  // Load more button if we have exactly 50 messages (might be more)
  if (messages.length >= 50) {
    html += `<div class="chat-load-more"><button onclick="loadOlderChatMessages()">Last eldre meldinger</button></div>`;
  }

  for (const msg of messages) {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      html += `<div class="chat-msg-date-separator">${formatChatDate(msg.created_at)}</div>`;
    }

    const isSelf = msg.sender_id === myUserId;
    const time = new Date(msg.created_at).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

    html += `
      <div class="chat-msg ${isSelf ? 'self' : 'other'}">
        <div class="chat-msg-sender">${escapeHtml(msg.sender_name)}</div>
        <div class="chat-msg-content">${escapeHtml(msg.content)}</div>
        <div class="chat-msg-time">${time}</div>
      </div>`;
  }

  container.innerHTML = html;
}

// Scroll chat to bottom
function scrollChatToBottom() {
  const container = document.getElementById('chatMessages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

// Load older messages
function loadOlderChatMessages() {
  if (!chatState.activeConversation) return;
  const messages = chatState.messages[chatState.activeConversation] || [];
  if (messages.length === 0) return;
  const oldestId = messages[0].id;
  loadChatMessages(chatState.activeConversation, oldestId);
}

// Render typing indicator
function renderTypingIndicator(conversationId) {
  const indicator = document.getElementById('chatTypingIndicator');
  const text = document.getElementById('chatTypingText');
  if (!indicator || !text || chatState.activeConversation !== conversationId) return;

  const prefix = `${conversationId}-`;
  const typingNames = Object.entries(chatState.typingUsers)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, name]) => name);

  if (typingNames.length === 0) {
    indicator.style.display = 'none';
  } else {
    indicator.style.display = '';
    if (typingNames.length === 1) {
      text.textContent = `${typingNames[0]} skriver...`;
    } else {
      text.textContent = `${typingNames.join(' og ')} skriver...`;
    }
  }
}

// Show new DM view
async function showNewDmView() {
  chatState.view = 'newDm';
  document.getElementById('chatConversationList').style.display = 'none';
  document.getElementById('chatMessageView').style.display = 'none';
  document.getElementById('chatNewDm').style.display = 'flex';

  const container = document.getElementById('chatTeamList');
  container.innerHTML = `
    <div class="chat-empty-state">
      <i class="fas fa-spinner fa-spin"></i>
      <p>Laster teammedlemmer...</p>
    </div>`;

  // Load team members
  try {
    const response = await fetch('/api/chat/team-members');
    if (!response.ok) {
      console.error('Team members failed:', response.status, response.statusText);
      try { console.error('Team members body:', await response.text()); } catch {}
      container.innerHTML = `
        <div class="chat-empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Kunne ikke laste teammedlemmer</p>
          <p style="font-size:12px;opacity:0.7">Bruk Teamchat for \u00e5 sende melding til alle</p>
        </div>`;
      return;
    }
    const result = await response.json();
    if (result.success && result.data) {
      if (result.data.length === 0) {
        container.innerHTML = `
          <div class="chat-empty-state">
            <i class="fas fa-user-slash"></i>
            <p>Ingen andre teammedlemmer funnet</p>
            <p style="font-size:12px;opacity:0.7">G\u00e5 tilbake og bruk Teamchat for \u00e5 sende melding til alle</p>
          </div>`;
        return;
      }

      container.innerHTML = result.data.map(member => `
        <div class="chat-team-item" data-user-id="${member.id}">
          <div class="chat-team-avatar">${getChatInitials(member.navn)}</div>
          <div class="chat-team-name">${escapeHtml(member.navn)}</div>
        </div>
      `).join('');

      container.querySelectorAll('.chat-team-item').forEach(item => {
        item.addEventListener('click', async () => {
          const userId = parseInt(item.dataset.userId, 10);
          const convId = await startDmConversation(userId);
          if (convId) {
            await loadChatConversations();
            openChatConversation(convId, 'dm');
          }
        });
      });
    }
  } catch (e) {
    console.error('Failed to load team members:', e);
    container.innerHTML = `
      <div class="chat-empty-state">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Feil ved lasting av teammedlemmer</p>
        <p style="font-size:12px;opacity:0.7">G\u00e5 tilbake og bruk Teamchat for \u00e5 sende melding til alle</p>
      </div>`;
  }
}

// Navigate back to conversation list
function showChatConversationList() {
  chatState.view = 'list';
  chatState.activeConversation = null;
  chatState.activeConversationType = null;
  document.getElementById('chatMessageView').style.display = 'none';
  document.getElementById('chatNewDm').style.display = 'none';
  document.getElementById('chatConversationList').style.display = '';
  loadChatConversations();
}

// Initialize chat event listeners
function initChatEventListeners() {
  // Send button
  document.getElementById('chatSendBtn')?.addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    if (input && chatState.activeConversation) {
      sendChatMessage(chatState.activeConversation, input.value);
      input.value = '';
      chatIsTyping = false;
    }
  });

  // Enter key to send
  document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const input = e.target;
      if (input.value.trim() && chatState.activeConversation) {
        sendChatMessage(chatState.activeConversation, input.value);
        input.value = '';
        chatIsTyping = false;
      }
    }
  });

  // Typing indicator
  document.getElementById('chatInput')?.addEventListener('input', () => {
    if (chatState.activeConversation) {
      sendChatTypingStart(chatState.activeConversation);
    }
  });

  // Back button
  document.getElementById('chatBackBtn')?.addEventListener('click', showChatConversationList);

  // New DM button
  document.getElementById('chatNewDmBtn')?.addEventListener('click', showNewDmView);

  // New DM back button
  document.getElementById('chatNewDmBackBtn')?.addEventListener('click', showChatConversationList);
}

// Load chat when chat tab is opened
function onChatTabOpened() {
  loadChatConversations();
  resizeChatContainer();
}

// Explicitly size the chat container to fill available space
function resizeChatContainer() {
  const tabContent = document.querySelector('.tab-content');
  const chatPane = document.getElementById('tab-chat');
  if (!tabContent || !chatPane) return;
  const available = tabContent.clientHeight;
  chatPane.style.height = available + 'px';
  chatPane.style.maxHeight = available + 'px';
}

// Re-size on window resize
window.addEventListener('resize', () => {
  const chatPane = document.getElementById('tab-chat');
  if (chatPane && chatPane.classList.contains('active')) {
    resizeChatContainer();
  }
});

// Make load older messages available globally
window.loadOlderChatMessages = loadOlderChatMessages;

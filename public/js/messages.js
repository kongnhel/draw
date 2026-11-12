/* ArtSpace Messenger — private user-to-user chat (Messenger style).
   Self-contained page script; destroys itself when the SPA swaps routes. */
(() => {
  'use strict';

  const root = document.querySelector('[data-messenger]');
  if (!root) return;

  // Destroy any previous instance (SPA navigation back to this page).
  if (window.__artspaceMessenger && typeof window.__artspaceMessenger.destroy === 'function') {
    window.__artspaceMessenger.destroy();
  }

  const viewerId = Number(root.dataset.viewerId) || 0;
  const viewerAvatar = root.dataset.viewerAvatar || '/images/default-avatar.svg';
  const initialConversationId = Number(root.dataset.initialConversation) || 0;
  const initialTo = String(root.dataset.initialTo || '');
  const shareArtworkId = Number(root.dataset.shareArtworkId) || 0;

  const qs = (selector, scope = root) => scope.querySelector(selector);
  const sidebar = qs('[data-messenger-sidebar]');
  const listEl = qs('[data-conversation-list]');
  const listSkeleton = qs('[data-list-skeleton]');
  const listEmpty = qs('[data-list-empty]');
  const listError = qs('[data-list-error]');
  const searchInput = qs('[data-conversation-search]');
  const chatEmpty = qs('[data-chat-empty]');
  const chatSkeleton = qs('[data-chat-skeleton]');
  const chatThread = qs('[data-chat-thread]');
  const messageList = qs('[data-message-list]');
  const scrollEl = qs('[data-message-scroll]');
  const typingEl = qs('[data-typing-indicator]');
  const typingAvatar = qs('[data-typing-indicator] img');
  const typingLabel = qs('[data-typing-label]');
  const chatAvatar = qs('[data-chat-avatar]');
  const chatStatusDot = qs('[data-chat-status-dot]');
  const chatName = qs('[data-chat-name]');
  const chatStatus = qs('[data-chat-status]');
  const chatBanner = qs('[data-chat-banner]');
  const loadOlderBtn = qs('[data-load-older]');
  const input = qs('[data-message-input]');
  const sendBtn = qs('[data-send-button]');
  const attachButton = qs('[data-attach-button]');
  const attachInput = qs('[data-attach-input]');
  const emojiButton = qs('[data-emoji-button]');
  const emojiPicker = qs('[data-emoji-picker]');
  const replyPreview = qs('[data-reply-preview]');
  const replyName = qs('[data-reply-name]');
  const replyContent = qs('[data-reply-content]');
  const replyCancel = qs('[data-reply-cancel]');
  const pendingArtworkEl = qs('[data-pending-artwork]');
  const pendingArtworkCard = qs('[data-pending-artwork-card]');
  const pendingArtworkCancel = qs('[data-pending-artwork-cancel]');
  const menuToggle = qs('[data-conversation-menu-toggle]');
  const conversationMenu = qs('[data-conversation-menu]');
  const newChatDialog = qs('[data-new-chat-dialog]');
  const newChatNote = qs('[data-new-chat-note]');
  const userSearch = qs('[data-user-search]');
  const userResults = qs('[data-user-results]');
  const forwardDialog = qs('[data-forward-dialog]');
  const forwardPreview = qs('[data-forward-preview]');
  const forwardList = qs('[data-forward-list]');
  const forwardNote = qs('[data-forward-note]');
  const reportDialog = qs('[data-report-dialog]');
  const reportReason = qs('[data-report-reason]');
  const reportNote = qs('[data-report-note]');
  const confirmDialog = qs('[data-confirm-dialog]');
  const confirmTitle = qs('[data-confirm-title]');
  const confirmCopy = qs('[data-confirm-copy]');
  const toasts = qs('[data-toasts]');

  const state = {
    conversations: new Map(),
    conversationOrder: [],
    activeId: 0,
    activeOther: null,
    messages: [],
    hasMore: false,
    oldestId: 0,
    lastMessageId: 0,
    participantsLastRead: new Map(),
    blocked: { iBlocked: false, blockedMe: false },
    isMuted: false,
    replyTo: null,
    pendingArtworkId: 0,
    pendingArtwork: null,
    sending: false,
    listTimer: 0,
    chatTimer: 0,
    badgeTimer: 0,
    typingSentAt: 0,
    typingActive: false,
    lastListFetch: 0,
    destroyed: false,
    typingTimer: 0,
    loadingOlder: false,
    readTimer: 0,
    openingChat: false
  };

  const jsonHeaders = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
  const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (!response.ok) {
      const err = new Error((payload && payload.error) || 'Something went wrong. Please try again.');
      err.status = response.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  };

  /* ---------------- utilities ---------------- */

  const formatTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const formatListTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return formatTime(value);
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatDayLabel = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now - 86400000).toDateString();
    if (date.toDateString() === today) return 'Today';
    if (date.toDateString() === yesterday) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  };

  const formatLastSeen = (value, online) => {
    if (online) return 'Online';
    if (!value) return 'Offline';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Offline';
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'Active just now';
    if (minutes < 60) return `Active ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Active ${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `Active ${days}d ago`;
    return 'Offline';
  };

  const truncate = (value, max = 80) => {
    const text = String(value || '').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  const toast = (message, tone = '') => {
    if (!toasts) return;
    const item = document.createElement('div');
    item.className = `msc-toast${tone ? ` is-${tone}` : ''}`;
    item.setAttribute('data-i18n-skip', '');
    item.textContent = message;
    toasts.appendChild(item);
    window.setTimeout(() => {
      item.classList.add('is-leaving');
      window.setTimeout(() => item.remove(), 300);
    }, 2600);
  };

  const updateBadges = (unread) => {
    document.querySelectorAll('[data-messages-badge]').forEach((badge) => {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.hidden = !unread;
    });
  };

  const setButtonsDisabled = (disabled) => {
    [sendBtn, attachButton, emojiButton].forEach((button) => {
      if (button) button.disabled = Boolean(disabled);
    });
    if (input) input.disabled = Boolean(disabled);
  };

  /* ---------------- conversation list ---------------- */

  const avatarSrc = (path) => path || '/images/default-avatar.svg';

  const renderConversationItem = (conversation) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = [
      'msb-item',
      conversation.unread_count > 0 ? 'is-unread' : '',
      conversation.is_muted ? 'is-muted' : '',
      Number(conversation.id) === state.activeId ? 'is-active' : ''
    ].filter(Boolean).join(' ');
    item.dataset.conversationId = String(conversation.id);
    item.setAttribute('role', 'listitem');

    const avatar = document.createElement('span');
    avatar.className = 'msb-avatar';
    const img = document.createElement('img');
    img.src = avatarSrc(conversation.other_user && conversation.other_user.avatar);
    img.alt = '';
    img.loading = 'lazy';
    img.dataset.fallbackSrc = '/images/default-avatar.svg';
    avatar.appendChild(img);
    if (conversation.other_user && conversation.other_user.online) {
      const dot = document.createElement('i');
      dot.className = 'msb-online-dot';
      avatar.appendChild(dot);
    }

    const copy = document.createElement('span');
    copy.className = 'msb-copy';
    const name = document.createElement('strong');
    name.className = 'msb-name';
    name.setAttribute('data-i18n-skip', '');
    name.textContent = conversation.other_user ? conversation.other_user.display_name : 'Unknown';
    copy.appendChild(name);

    const preview = document.createElement('span');
    preview.className = 'msb-preview';
    const last = conversation.last_message;
    if (conversation.other_user && conversation.other_user.status === 'suspended') {
      preview.textContent = 'Account unavailable';
    } else if (last) {
      const prefix = last.is_mine ? 'You: ' : '';
      let text = prefix + truncate(last.content, 60);
      if (last.type === 'artwork' && !last.content) text = `${prefix}Artwork`;
      if (last.type === 'image' && !last.content) text = `${prefix}Photo`;
      preview.textContent = text;
    } else {
      preview.textContent = 'No messages yet';
    }
    preview.setAttribute('data-i18n-skip', '');
    copy.appendChild(preview);

    const meta = document.createElement('span');
    meta.className = 'msb-meta';
    const time = document.createElement('span');
    time.className = 'msb-time';
    time.textContent = formatListTime(last ? last.created_at : conversation.updated_at);
    time.setAttribute('data-i18n-skip', '');
    meta.appendChild(time);
    if (conversation.unread_count > 0) {
      const badge = document.createElement('span');
      badge.className = 'msb-badge';
      badge.textContent = conversation.unread_count > 9 ? '9+' : String(conversation.unread_count);
      meta.appendChild(badge);
    }

    item.append(avatar, copy, meta);
    return item;
  };

  const renderConversationList = () => {
    if (!listEl) return;
    const items = state.conversationOrder
      .map((id) => state.conversations.get(id))
      .filter(Boolean);

    if (listSkeleton) listSkeleton.hidden = true;
    if (listError) listError.hidden = true;
    if (listEmpty) listEmpty.hidden = items.length > 0;

    const searchValue = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const visible = searchValue
      ? items.filter((conversation) => {
          const other = conversation.other_user || {};
          return (other.display_name || '').toLowerCase().includes(searchValue)
            || (other.username || '').toLowerCase().includes(searchValue);
        })
      : items;

    listEl.replaceChildren(...visible.map(renderConversationItem));
  };

  const loadConversations = async (force = false) => {
    if (!listEl) return;
    if (listSkeleton) listSkeleton.hidden = false;
    if (listEmpty) listEmpty.hidden = true;
    if (listError) listError.hidden = true;
    try {
      const query = (searchInput && searchInput.value.trim()) ? `?q=${encodeURIComponent(searchInput.value.trim().slice(0, 60))}` : '';
      const data = await fetchJson(`/api/messages/conversations${query}`);
      if (state.destroyed) return;
      state.lastListFetch = Date.now();
      state.conversations.clear();
      state.conversationOrder = [];
      (data.conversations || []).forEach((conversation) => {
        state.conversations.set(Number(conversation.id), conversation);
        state.conversationOrder.push(Number(conversation.id));
      });
      renderConversationList();
      const totalUnread = (data.conversations || []).reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0);
      updateBadges(totalUnread);
    } catch (error) {
      if (state.destroyed) return;
      if (listSkeleton) listSkeleton.hidden = true;
      if (listError) {
        listError.hidden = false;
        listError.textContent = error.message || 'Could not load conversations.';
      }
    }
  };

  /* ---------------- chat rendering ---------------- */

  const shouldShowAvatar = (row, index) => {
    if (row.is_mine) return false;
    const previous = state.messages[index - 1];
    if (!previous) return true;
    return previous.sender_id !== row.sender_id
      || (new Date(row.created_at) - new Date(previous.created_at)) > 5 * 60 * 1000;
  };

  const isSameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

  const buildArtworkCard = (artwork) => {
    const card = document.createElement('a');
    card.className = 'msc-artwork-card';
    card.href = `/art/${artwork.id}`;
    card.setAttribute('data-i18n-skip', '');

    const thumb = document.createElement('span');
    thumb.className = 'msc-artwork-thumb';
    const image = document.createElement('img');
    image.src = artwork.thumbnail || '/images/default-artwork.svg';
    image.alt = artwork.title || 'Artwork';
    image.loading = 'lazy';
    image.dataset.fallbackSrc = '/images/default-artwork.svg';
    thumb.appendChild(image);
    card.appendChild(thumb);

    const caption = document.createElement('span');
    caption.className = 'msc-artwork-caption';
    const title = document.createElement('strong');
    title.textContent = artwork.title || 'Artwork';
    const artist = document.createElement('small');
    artist.textContent = artwork.artist_name ? `by ${artwork.artist_name}` : (artwork.artist_username ? `by @${artwork.artist_username}` : 'ArtSpace artist');
    const open = document.createElement('span');
    open.className = 'msc-artwork-open';
    open.textContent = 'View artwork';
    caption.append(title, artist, open);
    card.appendChild(caption);
    return card;
  };

  const buildMessageBubble = (row) => {
    const bubble = document.createElement('div');
    bubble.className = `msc-bubble${row.type === 'artwork' ? ' msc-bubble-artwork' : ''}${row.type === 'image' ? ' msc-bubble-image' : ''}`;
    bubble.setAttribute('data-i18n-skip', '');

    if (row.removed_for_everyone) {
      bubble.classList.add('msc-bubble-removed');
      bubble.textContent = row.is_mine ? 'You deleted this message' : 'This message was deleted';
      return bubble;
    }

    if (row.reply_to) {
      const quote = document.createElement('div');
      quote.className = 'msc-quote';
      quote.setAttribute('data-i18n-skip', '');
      quote.dataset.replyTarget = String(row.reply_to.id);
      const quoteName = document.createElement('em');
      quoteName.textContent = row.reply_to.sender_name || 'Message';
      const quoteContent = document.createElement('span');
      quoteContent.textContent = row.reply_to.content || (row.reply_to.type === 'artwork' ? 'Artwork' : 'Photo');
      quote.append(quoteName, quoteContent);
      bubble.appendChild(quote);
    }

    if (row.type === 'artwork') {
      if (row.content) {
        const caption = document.createElement('div');
        caption.className = 'msc-image-caption';
        caption.textContent = row.content;
        bubble.appendChild(caption);
      }
      if (row.artwork) {
        bubble.appendChild(buildArtworkCard(row.artwork));
      } else {
        const note = document.createElement('div');
        note.textContent = 'Artwork unavailable';
        bubble.appendChild(note);
      }
      return bubble;
    }

    if (row.type === 'image' && row.attachment && row.attachment.path) {
      const image = document.createElement('img');
      image.src = row.attachment.path;
      image.alt = 'Photo';
      image.loading = 'lazy';
      image.dataset.fallbackSrc = '/images/default-artwork.svg';
      const wrap = document.createElement('div');
      wrap.className = 'msc-image-msg';
      wrap.appendChild(image);
      bubble.appendChild(wrap);
      if (row.content) {
        const caption = document.createElement('div');
        caption.className = 'msc-image-caption';
        caption.textContent = row.content;
        bubble.appendChild(caption);
      }
      return bubble;
    }

    bubble.textContent = row.content || '';
    if (row.edited_at) {
      const edited = document.createElement('span');
      edited.className = 'msc-bubble-edited';
      edited.textContent = '(edited)';
      bubble.appendChild(edited);
    }
    return bubble;
  };

  const buildRowActions = (row) => {
    const actions = document.createElement('span');
    actions.className = 'msc-row-actions';

    const add = (label, svgPath, handler) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'msc-row-action';
      button.title = label;
      button.setAttribute('aria-label', label);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', svgPath);
      svg.appendChild(path);
      button.appendChild(svg);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        handler();
      });
      actions.appendChild(button);
    };

    add('Reply', 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z', () => startReply(row));
    if (row.is_mine && row.type === 'text' && !row.removed_for_everyone) {
      add('Edit', 'M4 20l1.2-4.2L14.5 6.5a2.12 2.12 0 0 1 3 3L8.2 18.8 4 20Z', () => startEdit(row));
    }
    add('Copy text', 'M8 8h11v11H8zM16 16V5H5v11z', () => copyMessage(row));
    add('Forward', 'M14 5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11Z', () => openForward(row));

    const overflow = document.createElement('button');
    overflow.type = 'button';
    overflow.className = 'msc-row-action';
    overflow.title = 'More';
    overflow.setAttribute('aria-label', 'More actions');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'].forEach((d) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    overflow.appendChild(svg);
    overflow.addEventListener('click', (event) => {
      event.stopPropagation();
      openRowMenu(event.currentTarget, row);
    });
    actions.appendChild(overflow);

    return actions;
  };

  const renderMessages = (animateLast = true) => {
    if (!messageList) return;
    messageList.replaceChildren();

    let previous = null;
    state.messages.forEach((row, index) => {
      if (!previous || !isSameDay(previous.created_at, row.created_at)) {
        const divider = document.createElement('div');
        divider.className = 'msc-day-divider';
        divider.setAttribute('data-i18n-skip', '');
        divider.textContent = formatDayLabel(row.created_at);
        messageList.appendChild(divider);
      }

      const isFirst = !previous || previous.sender_id !== row.sender_id || !isSameDay(previous.created_at, row.created_at);
      const isLastMine = row.is_mine && (!(state.messages[index + 1] && state.messages[index + 1].is_mine));

      const rowEl = document.createElement('div');
      rowEl.className = `msc-row${row.is_mine ? ' is-mine' : ''}${isFirst ? ' is-first' : ''}${isLastMine ? ' is-last' : ''}`;
      rowEl.dataset.messageId = String(row.id);
      rowEl.setAttribute('role', 'listitem');

      if (!row.is_mine) {
        const avatar = document.createElement('span');
        avatar.className = 'msc-row-avatar';
        const img = document.createElement('img');
        img.src = avatarSrc(row.sender_avatar);
        img.alt = '';
        img.loading = 'lazy';
        img.dataset.fallbackSrc = '/images/default-avatar.svg';
        avatar.appendChild(img);
        rowEl.appendChild(avatar);
      }

      const wrap = document.createElement('span');
      wrap.className = 'msc-bubble-wrap';
      wrap.appendChild(buildMessageBubble(row));

      const meta = document.createElement('span');
      meta.className = 'msc-meta';
      const time = document.createElement('time');
      time.textContent = formatTime(row.created_at);
      time.setAttribute('data-i18n-skip', '');
      meta.appendChild(time);
      if (row.is_mine && !row.removed_for_everyone) {
        const receipt = document.createElement('span');
        receipt.className = 'msc-receipt';
        receipt.dataset.receiptFor = String(row.id);
        const other = state.activeOther;
        const otherRead = other && state.participantsLastRead.get(other.id);
        const readAt = otherRead ? new Date(otherRead).getTime() : 0;
        const mineAt = new Date(row.created_at).getTime();
        const seen = readAt >= mineAt;
        receipt.classList.toggle('is-read', seen);
        receipt.title = seen ? 'Seen' : 'Sent';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', seen ? 'm2.5 12.5 4.5 4.5L16.5 7.5M10 17l1.6 1.6L22.5 7.5' : 'm4.5 12.5 4.5 4.5L19.5 7.5');
        svg.appendChild(path);
        receipt.appendChild(svg);
        meta.appendChild(receipt);
      }
      wrap.appendChild(meta);
      rowEl.appendChild(wrap);
      rowEl.appendChild(buildRowActions(row));
      messageList.appendChild(rowEl);

      previous = row;
    });

    if (loadOlderBtn) loadOlderBtn.hidden = !state.hasMore;
    if (animateLast) scrollToBottom();
    refreshReceipts();
  };

  const refreshReceipts = () => {
    const other = state.activeOther;
    if (!other) return;
    const readAt = state.participantsLastRead.get(other.id);
    if (!readAt) return;
    const readTime = new Date(readAt).getTime();
    document.querySelectorAll('[data-receipt-for]').forEach((receipt) => {
      const row = state.messages.find((message) => message.id === Number(receipt.dataset.receiptFor));
      if (!row || !row.is_mine) return;
      const seen = readTime >= new Date(row.created_at).getTime();
      receipt.classList.toggle('is-read', seen);
      receipt.title = seen ? 'Seen' : 'Sent';
    });
  };

  const scrollToBottom = (smooth = true) => {
    if (!scrollEl) return;
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  const nearBottom = () => {
    if (!scrollEl) return true;
    return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 140;
  };

  /* ---------------- conversation lifecycle ---------------- */

  const showThread = (show) => {
    if (chatThread) chatThread.hidden = !show;
    if (chatEmpty) chatEmpty.hidden = show;
    if (chatSkeleton) chatSkeleton.hidden = true;
    if (root.classList) {
      root.classList.toggle('is-chat-open', Boolean(show));
    }
  };

  const updateChatHeader = (conversation) => {
    const other = conversation.other_user;
    state.activeOther = other || null;
    if (chatAvatar) chatAvatar.src = avatarSrc(other && other.avatar);
    if (chatName) chatName.textContent = other ? other.display_name : 'Unknown';
    const online = Boolean(other && other.online);
    const suspended = Boolean(other && other.status === 'suspended');
    if (chatStatus) {
      chatStatus.textContent = suspended ? 'Account unavailable' : formatLastSeen(other && other.last_seen_at, online);
      chatStatus.classList.toggle('is-online', online);
    }
    if (chatStatusDot) chatStatusDot.classList.toggle('is-online', online);
  };

  const updateBanner = () => {
    if (!chatBanner) return;
    const other = state.activeOther;
    let html = '';
    if (state.blocked.iBlocked) {
      html = `<span>You blocked ${other ? other.display_name : 'this member'}. Unblock to exchange messages.</span><button type="button" class="msc-banner-action" data-action="unblock">Unblock</button>`;
    } else if (state.blocked.blockedMe) {
      html = '<span>You cannot send messages to this member.</span>';
    } else if (state.isMuted) {
      html = '<span>This conversation is muted. You will not get notifications.</span><button type="button" class="msc-banner-action" data-action="unmute">Unmute</button>';
    }
    if (html) {
      chatBanner.innerHTML = html;
      chatBanner.hidden = false;
      chatBanner.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => handleMenuAction(button.dataset.action));
      });
    } else {
      chatBanner.hidden = true;
      chatBanner.innerHTML = '';
    }
    setButtonsDisabled(state.blocked.iBlocked || state.blocked.blockedMe);
  };

  const updateMenuLabels = () => {
    const muteLabel = qs('[data-mute-label]');
    if (muteLabel) muteLabel.textContent = state.isMuted ? 'Unmute' : 'Mute';
    const blockLabel = qs('[data-block-label]');
    if (blockLabel) blockLabel.textContent = state.blocked.iBlocked ? 'Unblock user' : 'Block user';
  };

  const openConversation = async (conversationId, options = {}) => {
    const id = Number(conversationId);
    if (!id) return;
    if (state.activeId !== id) {
      state.activeId = id;
      state.messages = [];
      state.hasMore = false;
      state.oldestId = 0;
      state.lastMessageId = 0;
      state.replyTo = null;
      hideReplyPreview();
      renderConversationList();
      showThread(false);
      if (chatSkeleton) chatSkeleton.hidden = false;
    }

    try {
      const data = await fetchJson(`/api/messages/conversations/${id}`);
      if (state.destroyed) return;
      const conversation = data.conversation;
      if (!conversation) return;

      state.activeId = id;
      state.messages = conversation.messages || [];
      state.hasMore = Boolean(conversation.has_more);
      state.participantsLastRead = new Map(
        (conversation.participants || []).map((participant) => [Number(participant.id), participant.last_read_at])
      );
      state.blocked = conversation.blocked || { iBlocked: false, blockedMe: false };
      state.isMuted = Boolean(conversation.is_muted);
      state.oldestId = state.messages.length ? Number(state.messages[0].id) : 0;
      state.lastMessageId = state.messages.length ? Number(state.messages[state.messages.length - 1].id) : 0;

      showThread(true);
      updateChatHeader({ other_user: conversation.other_user });
      updateBanner();
      updateMenuLabels();
      renderMessages(false);
      scrollToBottom(false);
      updateBadges(Number(data.unread_messages || 0));
      refreshConversationFromData({ id, other_user: conversation.other_user, last_read_at: conversation.participants ? (conversation.participants.find((p) => Number(p.id) === viewerId) || {}).last_read_at : null, is_muted: conversation.is_muted });
      if (options.focus) focusInput();
      startChatPolling();
    } catch (error) {
      if (state.destroyed) return;
      if (chatSkeleton) chatSkeleton.hidden = true;
      if (error.status === 404) {
        showThread(false);
        toast('That conversation is not available.', 'error');
        state.activeId = 0;
        loadConversations(true);
      } else {
        toast(error.message || 'Could not open that conversation.', 'error');
      }
    }
  };

  const refreshConversationFromData = ({ id, other_user, last_read_at, is_muted }) => {
    const existing = state.conversations.get(Number(id));
    if (!existing) return;
    if (other_user) existing.other_user = { ...existing.other_user, ...other_user };
    if (last_read_at) {
      existing.last_read_at = last_read_at;
      existing.unread_count = 0;
    }
    if (typeof is_muted === 'boolean') existing.is_muted = is_muted;
    renderConversationList();
  };

  /* ---------------- polling ---------------- */

  const startChatPolling = () => {
    window.clearInterval(state.chatTimer);
    state.chatTimer = window.setInterval(pollActiveMessages, 2500);
    pollActiveMessages();
  };

  const pollActiveMessages = async () => {
    if (state.destroyed || !state.activeId || !document.contains(root)) {
      if (!document.contains(root)) destroy();
      return;
    }
    if (document.hidden) return;

    const conversationId = state.activeId;
    try {
      const data = await fetchJson(`/api/messages/conversations/${conversationId}/messages?after_id=${state.lastMessageId}`);
      if (state.destroyed || state.activeId !== conversationId) return;

      const newMessages = data.messages || [];
      if (newMessages.length) {
        const known = new Set(state.messages.map((message) => message.id));
        newMessages.forEach((message) => {
          if (!known.has(message.id)) state.messages.push(message);
        });
        state.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);
        state.lastMessageId = Number(state.messages[state.messages.length - 1].id);
        renderMessages(nearBottom());
        if (nearBottom()) scheduleMarkRead();
      }

      (data.participants_last_read || []).forEach((entry) => {
        state.participantsLastRead.set(Number(entry.user_id), entry.last_read_at);
      });
      refreshReceipts();

      const typing = data.typing || [];
      if (typingEl) {
        if (typing.length) {
          if (typingAvatar) typingAvatar.src = avatarSrc(state.activeOther && state.activeOther.avatar);
          if (typingLabel) {
            typingLabel.textContent = typing.length === 1
              ? `${typing[0].display_name} is typing…`
              : 'Several people are typing…';
          }
          typingEl.hidden = false;
          if (nearBottom()) scrollToBottom();
        } else {
          typingEl.hidden = true;
        }
      }

      if (Number(data.unread) > 0 && document.hasFocus && document.hasFocus()) scheduleMarkRead();
    } catch (error) {
      /* transient polling errors are ignored */
    }
  };

  const scheduleMarkRead = () => {
    window.clearTimeout(state.readTimer);
    state.readTimer = window.setTimeout(async () => {
      if (state.destroyed || !state.activeId || !document.contains(root)) return;
      try {
        const data = await fetchJson(`/api/messages/conversations/${state.activeId}/read`, { method: 'POST', headers: jsonHeaders, body: '{}' });
        updateBadges(Number(data.unread || 0));
        if (typeof data.unread_notifications === 'number' && typeof window.updateNotificationBadges === 'function') {
          window.updateNotificationBadges(Number(data.unread_notifications));
        }
        state.conversations.forEach((conversation) => {
          if (Number(conversation.id) === state.activeId) conversation.unread_count = 0;
        });
        renderConversationList();
      } catch (error) {
        /* ignore */
      }
    }, 400);
  };

  const startListPolling = () => {
    window.clearInterval(state.listTimer);
    state.listTimer = window.setInterval(async () => {
      if (state.destroyed || !document.contains(root)) return;
      if (document.hidden) return;
      if (Date.now() - state.lastListFetch < 4000) return;
      if (state.searchInputBusy) return;
      loadConversations(true);
    }, 5000);
  };

  const startBadgePolling = () => {
    window.clearInterval(state.badgeTimer);
    state.badgeTimer = window.setInterval(async () => {
      if (state.destroyed || !document.contains(root)) return;
      if (document.hidden) return;
      try {
        const data = await fetchJson('/api/messages/unread-count');
        updateBadges(Number(data.unread || 0));
      } catch (error) {
        /* ignore */
      }
    }, 45000);
  };

  /* ---------------- composer ---------------- */

  const focusInput = () => {
    if (input && !input.disabled) {
      input.focus({ preventScroll: true });
      autoGrow();
    }
  };

  const autoGrow = () => {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  };

  const hideReplyPreview = () => {
    if (replyPreview) replyPreview.hidden = true;
  };

  const startReply = (row) => {
    state.replyTo = row;
    if (replyName) replyName.textContent = row.is_mine ? 'You' : (row.sender_name || 'Artist');
    if (replyContent) {
      replyContent.textContent = row.removed_for_everyone
        ? 'Message deleted'
        : (row.content || (row.type === 'artwork' ? 'Artwork' : 'Photo'));
    }
    if (replyPreview) replyPreview.hidden = false;
    focusInput();
  };

  let editingRow = null;

  const startEdit = (row) => {
    editingRow = row;
    state.replyTo = null;
    hideReplyPreview();
    if (input) {
      input.value = row.content || '';
      autoGrow();
      focusInput();
    }
    if (sendBtn) sendBtn.title = 'Save edit';
    toast('Editing message. Send to save changes.');
  };

  const cancelEdit = () => {
    editingRow = null;
    if (input) input.value = '';
    autoGrow();
    if (sendBtn) sendBtn.title = 'Send message';
  };

  const copyMessage = async (row) => {
    const text = row.removed_for_everyone ? '' : (row.content || '');
    if (!text) {
      toast('Nothing to copy for this message.', 'error');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard.', 'success');
        return;
      }
    } catch (error) {
      /* fall through */
    }
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    try {
      document.execCommand('copy');
      toast('Copied to clipboard.', 'success');
    } catch (error) {
      toast('Could not copy automatically.', 'error');
    }
    field.remove();
  };

  /* Row context menu (delete for me / everyone, report) */

  let rowMenu = null;

  const closeRowMenu = () => {
    if (rowMenu) {
      rowMenu.remove();
      rowMenu = null;
    }
    document.removeEventListener('click', onDocumentClickForMenu, true);
  };

  const onDocumentClickForMenu = (event) => {
    if (rowMenu && !rowMenu.contains(event.target)) closeRowMenu();
  };

  const openRowMenu = (anchor, row) => {
    closeRowMenu();
    rowMenu = document.createElement('div');
    rowMenu.className = 'msc-row-menu';

    const addItem = (label, danger, handler) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'msc-menu-item';
      button.setAttribute('data-i18n-skip', '');
      if (danger) button.classList.add('is-danger');
      button.textContent = label;
      button.addEventListener('click', () => {
        closeRowMenu();
        handler();
      });
      rowMenu.appendChild(button);
    };

    if (row.is_mine && !row.removed_for_everyone) {
      const withinWindow = (Date.now() - new Date(row.created_at).getTime()) <= 24 * 60 * 60 * 1000;
      if (withinWindow) {
        addItem('Delete for everyone', true, () => deleteMessage(row, 'everyone'));
      }
    }
    addItem('Delete for me', false, () => deleteMessage(row, 'self'));
    addItem('Report message', false, () => openReport(row.id));
    addItem('Copy text', false, () => copyMessage(row));
    addItem('Forward', false, () => openForward(row));

    document.body.appendChild(rowMenu);
    const rect = anchor.getBoundingClientRect();
    const menuRect = rowMenu.getBoundingClientRect();
    let top = rect.bottom + 4;
    if (top + menuRect.height > window.innerHeight - 8) top = rect.top - menuRect.height - 4;
    let left = Math.min(rect.left, window.innerWidth - menuRect.width - 8);
    rowMenu.style.top = `${Math.max(8, top)}px`;
    rowMenu.style.left = `${Math.max(8, left)}px`;
    document.addEventListener('click', onDocumentClickForMenu, true);
  };

  const deleteMessage = async (row, scope) => {
    const confirmed = scope === 'everyone'
      ? window.confirm('Delete this message for everyone in this conversation?')
      : window.confirm('Delete this message for you only?');
    if (!confirmed) return;
    try {
      const data = await fetchJson(`/api/messages/${row.id}/delete`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ scope })
      });
      updateBadges(Number(data.unread_messages || 0));
      if (scope === 'everyone') {
        const target = state.messages.find((message) => message.id === row.id);
        if (target) {
          target.removed_for_everyone = true;
          target.content = null;
        }
        renderMessages(false);
      } else {
        state.messages = state.messages.filter((message) => message.id !== row.id);
        renderMessages(false);
      }
      toast(scope === 'everyone' ? 'Deleted for everyone.' : 'Deleted for you.', 'success');
    } catch (error) {
      toast(error.message || 'Could not delete that message.', 'error');
    }
  };

  /* Forward dialog */

  let forwarding = null;

  const openForward = (row) => {
    forwarding = {
      type: row.type,
      content: row.removed_for_everyone ? '' : (row.content || ''),
      artworkId: row.artwork ? row.artwork.id : 0
    };
    if (forwardPreview) {
      forwardPreview.textContent = row.removed_for_everyone
        ? 'Message deleted'
        : (row.content || (row.type === 'artwork' ? `Artwork: ${row.artwork ? row.artwork.title : ''}` : 'Photo'));
    }
    if (forwardNote) forwardNote.hidden = true;
    renderForwardList();
    if (forwardDialog && typeof forwardDialog.showModal === 'function') forwardDialog.showModal();
  };

  const renderForwardList = () => {
    if (!forwardList) return;
    forwardList.replaceChildren();
    const conversations = state.conversationOrder.map((id) => state.conversations.get(id)).filter(Boolean);
    if (!conversations.length) {
      const note = document.createElement('p');
      note.className = 'msc-dialog-note';
      note.textContent = 'No other conversations yet.';
      forwardList.appendChild(note);
      return;
    }
    conversations.forEach((conversation) => {
      if (Number(conversation.id) === state.activeId) return;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'msc-user-item';
      const avatar = document.createElement('img');
      avatar.src = avatarSrc(conversation.other_user && conversation.other_user.avatar);
      avatar.alt = '';
      avatar.loading = 'lazy';
      avatar.dataset.fallbackSrc = '/images/default-avatar.svg';
      const copy = document.createElement('span');
      copy.className = 'msc-user-copy';
      const name = document.createElement('strong');
      name.textContent = conversation.other_user ? conversation.other_user.display_name : 'Unknown';
      name.setAttribute('data-i18n-skip', '');
      const handle = document.createElement('small');
      handle.textContent = `@${conversation.other_user ? conversation.other_user.username : ''}`;
      handle.setAttribute('data-i18n-skip', '');
      copy.append(name, handle);
      item.append(avatar, copy);
      item.addEventListener('click', () => forwardTo(conversation.other_user));
      forwardList.appendChild(item);
    });
  };

  const forwardTo = async (other) => {
    if (!forwarding || !other) return;
    try {
      const opened = await fetchJson('/api/messages/conversations', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ user_id: other.id })
      });
      if (forwardDialog && forwardDialog.open) forwardDialog.close();
      toast(`Forwarded to ${other.display_name}.`, 'success');
      await loadConversations(true);
      const conversationId = opened.conversation ? Number(opened.conversation.id) : 0;
      await openConversation(conversationId);
      await sendMessage({
        type: forwarding.type,
        content: forwarding.content,
        artworkId: forwarding.artworkId
      });
      forwarding = null;
    } catch (error) {
      if (forwardNote) {
        forwardNote.hidden = false;
        forwardNote.textContent = error.message || 'Could not forward that message.';
        forwardNote.className = 'msc-dialog-note is-error';
      }
    }
  };

  /* Sending */

  const sendMessage = async ({ type = 'text', content = '', artworkId = 0, attachment = null }) => {
    if (!state.activeId || state.sending) return false;
    const conversationId = state.activeId;
    state.sending = true;
    if (sendBtn) sendBtn.classList.add('is-sending');

    try {
      let payload;
      if (attachment) {
        const form = new FormData();
        form.append('image', attachment.file);
        if (attachment.caption) form.append('content', attachment.caption);
        payload = await fetchJson(`/api/messages/conversations/${conversationId}/attachments`, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
          body: form
        });
      } else {
        payload = await fetchJson(`/api/messages/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            message_type: type,
            content: content || undefined,
            artwork_id: artworkId || undefined,
            reply_to_id: state.replyTo ? state.replyTo.id : undefined
          })
        });
      }

      if (state.destroyed) return true;
      if (payload && payload.message) {
        const message = payload.message;
        const known = state.messages.some((existing) => existing.id === message.id);
        if (!known) {
          state.messages.push(message);
          state.lastMessageId = Math.max(state.lastMessageId, message.id);
        }
        state.replyTo = null;
        hideReplyPreview();
        renderMessages();
        scheduleMarkRead();
      }

      if (state.conversations.has(conversationId)) {
        const conversation = state.conversations.get(conversationId);
        const message = payload && payload.message;
        let previewContent = content || '';
        if (type === 'artwork') {
          previewContent = message && message.artwork && message.artwork.title
            ? `Artwork · ${message.artwork.title}`
            : 'Artwork';
        } else if (type === 'image') {
          previewContent = content ? `Photo · ${content}` : 'Photo';
        }
        conversation.last_message = {
          id: message ? Number(message.id) : 0,
          type,
          content: previewContent,
          is_mine: true,
          sender_name: 'You',
          created_at: new Date().toISOString()
        };
        conversation.unread_count = 0;
        renderConversationList();
      }
      return true;
    } catch (error) {
      if (state.destroyed) return false;
      toast(error.message || 'Could not send that message.', 'error');
      if (error.status === 403) {
        state.blocked = { iBlocked: state.blocked.iBlocked, blockedMe: true };
        updateBanner();
      }
      if (error.status === 404) {
        state.activeId = 0;
        showThread(false);
      }
      return false;
    } finally {
      state.sending = false;
      if (sendBtn) sendBtn.classList.remove('is-sending');
    }
  };

  const handleSend = async () => {
    if (!state.activeId) return;
    const raw = input ? input.value : '';

    if (editingRow) {
      const text = raw.trim();
      if (!text) return;
      const target = editingRow;
      try {
        const data = await fetchJson(`/api/messages/${target.id}/edit`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ content: text })
        });
        if (data && data.message) {
          const index = state.messages.findIndex((message) => message.id === target.id);
          if (index >= 0) state.messages[index] = data.message;
          renderMessages(false);
        }
        cancelEdit();
        toast('Message updated.', 'success');
      } catch (error) {
        toast(error.message || 'Could not edit that message.', 'error');
      }
      return;
    }

    const text = raw.trim();
    if (state.pendingArtworkId) {
      const artworkId = state.pendingArtworkId;
      const caption = text;
      clearPendingArtwork();
      if (input) input.value = '';
      autoGrow();
      const sent = await sendMessage({ type: 'artwork', content: caption, artworkId });
      if (sent) focusInput();
      return;
    }

    if (!text) return;
    if (input) input.value = '';
    autoGrow();
    const sent = await sendMessage({ type: 'text', content: text });
    if (sent) {
      focusInput();
    } else if (input && !input.value) {
      input.value = text;
      autoGrow();
    }
  };

  /* Attachment upload */

  const handleAttachment = async (file) => {
    if (!state.activeId || !file) return;
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
      toast('Only JPG, PNG, and WEBP images can be attached.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('That image is larger than 8 MB.', 'error');
      return;
    }
    toast('Sending photo…');
    await sendMessage({ attachment: { file, caption: '' } });
  };

  /* Pending artwork (deep link ?share=ID) */

  const setPendingArtwork = (artwork) => {
    state.pendingArtworkId = Number(artwork.id) || 0;
    state.pendingArtwork = artwork;
    if (pendingArtworkEl && pendingArtworkCard) {
      pendingArtworkCard.replaceChildren();
      const image = document.createElement('img');
      image.src = artwork.thumbnail || '/images/default-artwork.svg';
      image.alt = '';
      image.dataset.fallbackSrc = '/images/default-artwork.svg';
      const title = document.createElement('strong');
      title.textContent = artwork.title || 'Artwork';
      pendingArtworkCard.append(image, title);
      pendingArtworkEl.hidden = false;
    }
  };

  const clearPendingArtwork = () => {
    state.pendingArtworkId = 0;
    state.pendingArtwork = null;
    if (pendingArtworkEl) pendingArtworkEl.hidden = true;
  };

  const loadPendingArtwork = async (artworkId) => {
    try {
      const response = await fetch(`/api/artworks/${artworkId}/brief`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      if (data && data.artwork) setPendingArtwork(data.artwork);
    } catch (error) {
      /* ignore */
    }
  };

  /* ---------------- new chat dialog ---------------- */

  const renderUserResults = (users, context) => {
    if (!userResults) return;
    userResults.replaceChildren();
    if (!users.length) {
      const note = document.createElement('p');
      note.className = 'msc-dialog-note';
      note.textContent = 'No artists found. Try another name.';
      userResults.appendChild(note);
      return;
    }
    users.forEach((user) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'msc-user-item';
      const avatar = document.createElement('img');
      avatar.src = avatarSrc(user.avatar);
      avatar.alt = '';
      avatar.loading = 'lazy';
      avatar.dataset.fallbackSrc = '/images/default-avatar.svg';
      const copy = document.createElement('span');
      copy.className = 'msc-user-copy';
      const name = document.createElement('strong');
      name.textContent = user.display_name;
      name.setAttribute('data-i18n-skip', '');
      const handle = document.createElement('small');
      handle.textContent = `@${user.username}`;
      handle.setAttribute('data-i18n-skip', '');
      copy.append(name, handle);
      const online = document.createElement('span');
      online.className = `msc-user-online${user.online ? '' : ' is-offline'}`;
      item.append(avatar, copy, online);
      item.addEventListener('click', () => startChatWith(user, context));
      userResults.appendChild(item);
    });
  };

  const searchUsers = async (query, context, resultsEl, render) => {
    if (!query) {
      render([], context);
      return;
    }
    try {
      const data = await fetchJson(`/api/messages/users?q=${encodeURIComponent(query.slice(0, 60))}`);
      render(data.users || [], context);
    } catch (error) {
      render([], context);
    }
  };

  const startChatWith = async (user, context) => {
    if (state.openingChat) return;
    state.openingChat = true;
    const note = context === 'new-chat' ? newChatNote : null;
    if (note) {
      note.hidden = false;
      note.textContent = 'Opening conversation…';
      note.className = 'msc-dialog-note';
    }
    try {
      const data = await fetchJson('/api/messages/conversations', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ user_id: user.id })
      });
      if (newChatDialog && newChatDialog.open) newChatDialog.close();
      await loadConversations(true);
      if (data.conversation) {
        await openConversation(data.conversation.id, { focus: true });
      }
      if (note) note.hidden = true;
    } catch (error) {
      if (note) {
        note.hidden = false;
        note.textContent = error.message || 'Could not start that conversation.';
        note.className = 'msc-dialog-note is-error';
      } else {
        toast(error.message || 'Could not start that conversation.', 'error');
      }
    } finally {
      state.openingChat = false;
    }
  };

  /* ---------------- conversation menu actions ---------------- */

  const handleMenuAction = async (action) => {
    closeConversationMenu();
    const conversationId = state.activeId;
    if (!conversationId) return;
    const other = state.activeOther;

    if (action === 'mute') {
      try {
        const data = await fetchJson(`/api/messages/conversations/${conversationId}/mute`, { method: 'POST', headers: jsonHeaders, body: '{}' });
        state.isMuted = Boolean(data.is_muted);
        updateBanner();
        updateMenuLabels();
        toast(state.isMuted ? 'Conversation muted.' : 'Conversation unmuted.', 'success');
      } catch (error) {
        toast(error.message || 'Could not update the conversation.', 'error');
      }
      return;
    }

    if (action === 'block') {
      const message = state.blocked.iBlocked
        ? `Unblock ${other ? other.display_name : 'this member'}? They will be able to message you again.`
        : `Block ${other ? other.display_name : 'this member'}? Neither of you will be able to send new messages.`;
      const confirmed = await askConfirm(state.blocked.iBlocked ? 'Unblock user' : 'Block user', message, state.blocked.iBlocked ? 'Unblock' : 'Block');
      if (!confirmed) return;
      try {
        const data = await fetchJson(`/api/messages/conversations/${conversationId}/${state.blocked.iBlocked ? 'unblock' : 'block'}`, { method: 'POST', headers: jsonHeaders, body: '{}' });
        state.blocked.iBlocked = Boolean(data.blocked);
        updateBanner();
        updateMenuLabels();
        toast(state.blocked.iBlocked ? 'User blocked.' : 'User unblocked.', 'success');
      } catch (error) {
        toast(error.message || 'Could not update blocking.', 'error');
      }
      return;
    }

    if (action === 'unblock') {
      try {
        const data = await fetchJson(`/api/messages/conversations/${conversationId}/unblock`, { method: 'POST', headers: jsonHeaders, body: '{}' });
        state.blocked.iBlocked = false;
        updateBanner();
        updateMenuLabels();
        toast('User unblocked.', 'success');
      } catch (error) {
        toast(error.message || 'Could not unblock this member.', 'error');
      }
      return;
    }

    if (action === 'unmute') {
      try {
        const data = await fetchJson(`/api/messages/conversations/${conversationId}/mute`, { method: 'POST', headers: jsonHeaders, body: '{}' });
        state.isMuted = Boolean(data.is_muted);
        updateBanner();
        toast(state.isMuted ? 'Conversation muted.' : 'Conversation unmuted.', 'success');
      } catch (error) {
        toast(error.message || 'Could not unmute this conversation.', 'error');
      }
      return;
    }

    if (action === 'report') {
      openReport(0);
      return;
    }

    if (action === 'delete-conversation') {
      const confirmed = await askConfirm(
        'Delete for me?',
        `This removes the conversation from your inbox only. ${other ? other.display_name : 'The other member'} keeps their copy.`,
        'Delete for me'
      );
      if (!confirmed) return;
      try {
        const data = await fetchJson(`/api/messages/conversations/${conversationId}/delete`, { method: 'POST', headers: jsonHeaders, body: '{}' });
        updateBadges(Number(data.unread_messages || 0));
        state.activeId = 0;
        state.messages = [];
        showThread(false);
        await loadConversations(true);
        toast('Conversation removed from your inbox.', 'success');
      } catch (error) {
        toast(error.message || 'Could not delete the conversation.', 'error');
      }
      return;
    }
  };

  const closeConversationMenu = () => {
    if (conversationMenu) conversationMenu.hidden = true;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  };

  /* Report dialog */

  let reportingMessageId = 0;

  const openReport = (messageId) => {
    reportingMessageId = Number(messageId) || 0;
    if (reportReason) reportReason.value = '';
    if (reportNote) reportNote.hidden = true;
    if (reportDialog && typeof reportDialog.showModal === 'function') reportDialog.showModal();
  };

  /* Confirm dialog */

  let confirmResolver = null;

  const askConfirm = (title, copy, actionLabel) => new Promise((resolve) => {
    if (!confirmDialog || typeof confirmDialog.showModal !== 'function') {
      resolve(window.confirm(copy));
      return;
    }
    confirmResolver = resolve;
    if (confirmTitle) confirmTitle.textContent = title;
    if (confirmCopy) confirmCopy.textContent = copy;
    const accept = qs('[data-confirm-accept]', confirmDialog);
    if (accept) accept.textContent = actionLabel || 'Confirm';
    confirmDialog.showModal();
  });

  /* ---------------- events ---------------- */

  listEl && listEl.addEventListener('click', (event) => {
    const item = event.target instanceof Element ? event.target.closest('[data-conversation-id]') : null;
    if (!item) return;
    openConversation(item.dataset.conversationId, { focus: true });
  });

  let searchTimerHandle = 0;
  searchInput && searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimerHandle);
    searchTimerHandle = window.setTimeout(() => {
      state.searchInputBusy = true;
      renderConversationList();
      state.searchInputBusy = false;
    }, 120);
  });

  document.querySelectorAll('[data-new-chat]').forEach((button) => {
    button.addEventListener('click', () => {
      if (userSearch) userSearch.value = '';
      if (newChatNote) newChatNote.hidden = true;
      if (userResults) {
        userResults.replaceChildren();
        const hint = document.createElement('p');
        hint.className = 'msc-dialog-note';
        hint.textContent = 'Search ArtSpace members by name or @username.';
        userResults.appendChild(hint);
      }
      if (newChatDialog && typeof newChatDialog.showModal === 'function') {
        newChatDialog.showModal();
        if (userSearch) userSearch.focus({ preventScroll: true });
      }
    });
  });

  let userSearchTimer = 0;
  userSearch && userSearch.addEventListener('input', () => {
    window.clearTimeout(userSearchTimer);
    userSearchTimer = window.setTimeout(() => {
      searchUsers(userSearch.value.trim(), 'new-chat', userResults, renderUserResults);
    }, 220);
  });

  qs('[data-new-chat-close]') && qs('[data-new-chat-close]').addEventListener('click', () => newChatDialog && newChatDialog.close());
  newChatDialog && newChatDialog.addEventListener('click', (event) => {
    if (event.target === newChatDialog) newChatDialog.close();
  });

  qs('[data-forward-close]') && qs('[data-forward-close]').addEventListener('click', () => forwardDialog && forwardDialog.close());
  forwardDialog && forwardDialog.addEventListener('click', (event) => {
    if (event.target === forwardDialog) forwardDialog.close();
  });

  qs('[data-report-close]') && qs('[data-report-close]').addEventListener('click', () => reportDialog && reportDialog.close());
  qs('[data-report-cancel]') && qs('[data-report-cancel]').addEventListener('click', () => reportDialog && reportDialog.close());
  reportDialog && reportDialog.addEventListener('click', (event) => {
    if (event.target === reportDialog) reportDialog.close();
  });
  qs('[data-report-submit]') && qs('[data-report-submit]').addEventListener('click', async () => {
    if (!state.activeId) return;
    try {
      await fetchJson(`/api/messages/conversations/${state.activeId}/report`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ message_id: reportingMessageId || undefined, reason: reportReason ? reportReason.value.trim() : '' })
      });
      if (reportDialog) reportDialog.close();
      toast('Report sent. Our team will take a look.', 'success');
    } catch (error) {
      if (reportNote) {
        reportNote.hidden = false;
        reportNote.textContent = error.message || 'Could not send that report.';
        reportNote.className = 'msc-dialog-note is-error';
      }
    }
  });

  qs('[data-confirm-cancel]') && qs('[data-confirm-cancel]').addEventListener('click', () => {
    if (confirmDialog) confirmDialog.close();
    if (confirmResolver) {
      confirmResolver(false);
      confirmResolver = null;
    }
  });
  qs('[data-confirm-accept]') && qs('[data-confirm-accept]').addEventListener('click', () => {
    if (confirmDialog) confirmDialog.close();
    if (confirmResolver) {
      confirmResolver(true);
      confirmResolver = null;
    }
  });
  confirmDialog && confirmDialog.addEventListener('close', () => {
    if (confirmResolver) {
      confirmResolver(false);
      confirmResolver = null;
    }
  });

  qs('[data-chat-back]') && qs('[data-chat-back]').addEventListener('click', () => {
    state.activeId = 0;
    showThread(false);
    window.clearInterval(state.chatTimer);
  });

  menuToggle && menuToggle.addEventListener('click', () => {
    const willOpen = conversationMenu ? conversationMenu.hidden : true;
    if (conversationMenu) conversationMenu.hidden = !willOpen;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', String(willOpen));
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('[data-conversation-menu]') && !event.target.closest('[data-conversation-menu-toggle]')) {
      closeConversationMenu();
    }
    if (!event.target.closest('[data-emoji-picker]') && !event.target.closest('[data-emoji-button]')) {
      if (emojiPicker) emojiPicker.hidden = true;
      if (emojiButton) emojiButton.setAttribute('aria-expanded', 'false');
    }
  });

  loadOlderBtn && loadOlderBtn.addEventListener('click', async () => {
    if (!state.activeId || !state.oldestId || state.loadingOlder) return;
    state.loadingOlder = true;
    const previousHeight = scrollEl ? scrollEl.scrollHeight : 0;
    try {
      const data = await fetchJson(`/api/messages/conversations/${state.activeId}/messages?before_id=${state.oldestId}`);
      const older = data.messages || [];
      if (older.length) {
        const known = new Set(state.messages.map((message) => message.id));
        older.forEach((message) => {
          if (!known.has(message.id)) state.messages.unshift(message);
        });
        state.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);
        state.oldestId = Number(state.messages[0].id);
        state.hasMore = Boolean(data.has_more);
        renderMessages(false);
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight - previousHeight;
      } else {
        state.hasMore = false;
        if (loadOlderBtn) loadOlderBtn.hidden = true;
      }
    } catch (error) {
      toast(error.message || 'Could not load earlier messages.', 'error');
    } finally {
      state.loadingOlder = false;
    }
  });

  scrollEl && scrollEl.addEventListener('scroll', () => {
    if (nearBottom() && state.activeId) scheduleMarkRead();
  });

  input && input.addEventListener('input', () => {
    autoGrow();
    const now = Date.now();
    if (state.activeId && !state.typingActive) {
      state.typingActive = true;
      fetch(`/api/messages/conversations/${state.activeId}/typing`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ typing: true })
      }).catch(() => {});
    }
    state.typingSentAt = now;
    window.clearTimeout(state.typingTimer);
    state.typingTimer = window.setTimeout(() => {
      state.typingActive = false;
      if (state.activeId) {
        fetch(`/api/messages/conversations/${state.activeId}/typing`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ typing: false })
        }).catch(() => {});
      }
    }, 2500);
  });

  input && input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
    if (event.key === 'Escape' && editingRow) {
      cancelEdit();
      toast('Edit cancelled.');
    }
  });

  sendBtn && sendBtn.addEventListener('click', handleSend);

  attachButton && attachButton.addEventListener('click', () => attachInput && attachInput.click());
  attachInput && attachInput.addEventListener('change', () => {
    const file = attachInput.files && attachInput.files[0];
    if (file) handleAttachment(file);
    attachInput.value = '';
  });

  pendingArtworkCancel && pendingArtworkCancel.addEventListener('click', () => {
    clearPendingArtwork();
    toast('Artwork removed from the composer.');
  });

  replyCancel && replyCancel.addEventListener('click', () => {
    state.replyTo = null;
    hideReplyPreview();
  });

  /* Emoji picker */

  const EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '😍', '🥰', '😎', '🤩', '🥳', '😇', '🙂', '😉', '😢', '😭', '😤', '😡', '🤔', '🤗', '🤝', '🙏', '👍', '👏', '🙌', '💪', '✨', '❤️', '🎨', '🖌️', '🖼️', '🔥', '⭐'];
  emojiButton && emojiButton.addEventListener('click', () => {
    if (!emojiPicker) return;
    const willOpen = emojiPicker.hidden;
    if (willOpen && !emojiPicker.childElementCount) {
      EMOJIS.forEach((emoji) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'msc-emoji';
        button.textContent = emoji;
        button.setAttribute('aria-label', `Insert ${emoji}`);
        button.addEventListener('click', () => {
          if (!input) return;
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? input.value.length;
          input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus({ preventScroll: true });
          input.setSelectionRange(start + emoji.length, start + emoji.length);
        });
        emojiPicker.appendChild(button);
      });
    }
    emojiPicker.hidden = !willOpen;
    if (emojiButton) emojiButton.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) emojiPicker.querySelector('.msc-emoji') && emojiPicker.querySelector('.msc-emoji').focus();
  });

  /* Cleanup when SPA navigates away */
  const onNavigation = () => {
    if (!document.contains(root)) destroy();
  };
  window.addEventListener('artspace:navigation', onNavigation);

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    window.clearInterval(state.chatTimer);
    window.clearInterval(state.listTimer);
    window.clearInterval(state.badgeTimer);
    window.clearTimeout(state.readTimer);
    window.clearTimeout(state.typingTimer);
    window.clearTimeout(searchTimerHandle);
    window.clearTimeout(userSearchTimer);
    window.removeEventListener('artspace:navigation', onNavigation);
    closeRowMenu();
    if (window.__artspaceMessenger === instance) window.__artspaceMessenger = null;
  }

  const instance = {
    destroy,
    openConversation,
    setPendingArtwork
  };
  window.__artspaceMessenger = instance;

  /* ---------------- boot ---------------- */

  loadConversations(true);
  startListPolling();
  startBadgePolling();

  if (initialConversationId) {
    openConversation(initialConversationId, { focus: true });
  } else if (initialTo) {
    (async () => {
      try {
        const data = await fetchJson('/api/messages/conversations', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ username: initialTo })
        });
        await loadConversations(true);
        if (data.conversation) {
          await openConversation(data.conversation.id, { focus: true });
          if (shareArtworkId) loadPendingArtwork(shareArtworkId);
        }
      } catch (error) {
        toast(error.message || 'Could not start that conversation.', 'error');
      }
    })();
  } else if (shareArtworkId) {
    toast('Choose a conversation, or start a new chat, to share this artwork.');
  }
})();

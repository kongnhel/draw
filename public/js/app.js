const root = document.documentElement;
const toggleButton = document.querySelector('.theme-toggle');
const themeStorageKey = 'artspace-sketchbook-theme';
const pageCleanups = [];

const registerPageCleanup = (cleanup) => {
  if (typeof cleanup === 'function') pageCleanups.push(cleanup);
};

const runPageCleanups = () => {
  while (pageCleanups.length) {
    const cleanup = pageCleanups.pop();
    try {
      cleanup();
    } catch (error) {
    }
  }
};

const applyTheme = (theme) => {
  const safeTheme = theme === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', safeTheme);
  localStorage.setItem(themeStorageKey, safeTheme);

  if (toggleButton) {
    toggleButton.setAttribute('aria-label', safeTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    toggleButton.title = safeTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  }
};

applyTheme(localStorage.getItem(themeStorageKey) || 'light');

const setActionLabel = (button, text) => {
  const label = button?.querySelector('[data-action-label]');
  if (label) label.textContent = text;
  else if (button) button.textContent = text;
};

const updateLikeButton = (button, liked) => {
  if (!button) return;
  button.classList.toggle('active', liked);
  setActionLabel(button, liked ? 'Unlike' : 'Like');
  button.setAttribute('aria-pressed', String(Boolean(liked)));
  if (button.classList.contains('ad-tool')) {
    button.setAttribute('aria-label', liked ? 'Unlike this artwork' : 'Like this artwork');
  } else if (button.classList.contains('pf-art-action')) {
    button.setAttribute('aria-label', liked ? 'Unlike this artwork' : 'Like this artwork');
    button.title = liked ? 'Unlike' : 'Like';
  }

  if (liked && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    button.classList.remove('like-pop');
    void button.offsetWidth;
    button.classList.add('like-pop');
    button.addEventListener('animationend', () => button.classList.remove('like-pop'), { once: true });
  }
};

const updateSavedButton = (button, saved) => {
  if (!button) return;
  button.classList.toggle('active', saved);
  setActionLabel(button, saved ? 'Saved' : 'Save');
  button.setAttribute('aria-pressed', String(saved));
  if (button.classList.contains('ad-tool')) {
    button.setAttribute('aria-label', saved ? 'Remove from saved artwork' : 'Save this artwork');
  } else if (button.classList.contains('pf-art-action')) {
    button.setAttribute('aria-label', saved ? 'Remove from saved artwork' : 'Save this artwork');
    button.title = saved ? 'Remove from saved artwork' : 'Save this artwork';
  }
};

const updateLikeCounter = (card, likesCount) => {
  const likeCounter = card?.querySelector('[data-portfolio-likes]') || card?.querySelector('.metric-inline span') || document.querySelector('[data-detail-likes-count]') || document.querySelector('[data-viewer-like-count]');
  if (!likeCounter) return;
  const value = Number.parseInt(likeCounter.textContent.replace(/[^\d]/g, ''), 10) || 0;
  const nextCount = Math.max(0, likesCount ?? value);
  const isPlainCounter = likeCounter.hasAttribute('data-portfolio-likes')
    || likeCounter.hasAttribute('data-viewer-like-count')
    || likeCounter.hasAttribute('data-detail-likes-count');
  likeCounter.textContent = isPlainCounter ? String(nextCount) : `❤ ${nextCount}`;
  if (card?.hasAttribute('data-portfolio-card')) card.dataset.likes = String(nextCount);
};

const bindQuickActions = () => {
  document.querySelectorAll('form[action$="/like"]').forEach((form) => {
    if (form.dataset.quickBound === 'true') return;
    form.dataset.quickBound = 'true';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      const card = form.closest('.art-card, [data-portfolio-card]');

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams(new FormData(form))
        });

        if (!response.ok) {
          throw new Error('Like request failed');
        }

        const data = await response.json();
        updateLikeButton(button, data.liked);
        updateLikeCounter(card, data.likes_count);
        const artworkId = form.action.match(/\/art\/(\d+)\/like$/)?.[1];
        if (artworkId) document.dispatchEvent(new CustomEvent('artwork:like-changed', { detail: { id: artworkId, liked: data.liked, likes: data.likes_count } }));
      } catch (error) {
        form.submit();
      }
    });
  });

  document.querySelectorAll('form[action$="/bookmark"]').forEach((form) => {
    if (form.dataset.quickBound === 'true') return;
    form.dataset.quickBound = 'true';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams(new FormData(form))
        });

        if (!response.ok) {
          throw new Error('Bookmark request failed');
        }

        const data = await response.json();
        updateSavedButton(button, data.bookmarked);
        const artworkId = form.action.match(/\/art\/(\d+)\/bookmark$/)?.[1];
        if (artworkId) document.dispatchEvent(new CustomEvent('artwork:bookmark-changed', { detail: { id: artworkId, saved: data.bookmarked } }));
      } catch (error) {
        form.submit();
      }
    });
  });
};

const bindPortfolioCollection = () => {
  const collection = document.querySelector('[data-portfolio]');
  const gallery = collection?.querySelector('[data-portfolio-gallery]');
  if (!collection || !gallery) return;

  const cards = Array.from(gallery.querySelectorAll('[data-portfolio-card]'));
  if (!cards.length) return;

  const searchInput = collection.querySelector('[data-portfolio-search]');
  const searchClear = collection.querySelector('[data-portfolio-search-clear]');
  const sortButtons = Array.from(collection.querySelectorAll('[data-portfolio-sort]'));
  const categoryButtons = Array.from(collection.querySelectorAll('[data-portfolio-category]'));
  const resetButtons = Array.from(collection.querySelectorAll('[data-portfolio-reset]'));
  const statusLabel = collection.querySelector('[data-portfolio-status]');
  const noResults = collection.querySelector('[data-portfolio-no-results]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const originalOrder = cards.slice();
  let activeSort = 'all';
  let activeCategory = 'all';
  let filterTimer = null;

  const normalize = (value) => String(value || '').trim().toLowerCase();

  const setPressed = (buttons, current) => {
    buttons.forEach((button) => {
      const isActive = button === current;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  };

  const applyFilters = (animate = true) => {
    const term = normalize(searchInput?.value);
    const visibleCards = cards.filter((card) => {
      const matchesCategory = activeCategory === 'all'
        || normalize(card.dataset.category) === activeCategory;
      const searchText = normalize(`${card.dataset.title} ${card.dataset.tags} ${card.dataset.category} ${card.dataset.artist}`);
      return matchesCategory && (!term || searchText.includes(term));
    });

    if (activeSort === 'popular') {
      visibleCards.sort((a, b) => Number(b.dataset.likes || 0) - Number(a.dataset.likes || 0));
    } else if (activeSort === 'recent') {
      visibleCards.sort((a, b) => Number(b.dataset.created || 0) - Number(a.dataset.created || 0));
    } else {
      visibleCards.sort((a, b) => originalOrder.indexOf(a) - originalOrder.indexOf(b));
    }

    cards.forEach((card) => {
      card.hidden = !visibleCards.includes(card);
    });
    visibleCards.forEach((card) => gallery.appendChild(card));

    if (statusLabel) {
      statusLabel.innerHTML = visibleCards.length === 1
        ? 'Showing <strong>1</strong> piece'
        : `Showing <strong>${visibleCards.length}</strong> of <strong>${cards.length}</strong> pieces`;
    }

    if (noResults) noResults.hidden = visibleCards.length !== 0;

    const hasActiveFilters = Boolean(term) || activeCategory !== 'all';
    resetButtons.forEach((button) => {
      button.hidden = !hasActiveFilters;
    });

    if (searchClear) searchClear.hidden = !(searchInput && searchInput.value);

    if (!animate || reducedMotion.matches) return;

    gallery.classList.remove('is-filtering');
    void gallery.offsetWidth;
    gallery.classList.add('is-filtering');
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => gallery.classList.remove('is-filtering'), 340);
  };

  const resetFilters = () => {
    activeSort = 'all';
    activeCategory = 'all';
    if (searchInput) searchInput.value = '';
    setPressed(sortButtons, sortButtons.find((button) => button.dataset.portfolioSort === 'all'));
    setPressed(categoryButtons, categoryButtons.find((button) => button.dataset.portfolioCategory === 'all'));
    applyFilters();
  };

  sortButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeSort = button.dataset.portfolioSort || 'all';
      setPressed(sortButtons, button);
      applyFilters();
    });
  });

  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextCategory = normalize(button.dataset.portfolioCategory || 'all');
      activeCategory = activeCategory === nextCategory && nextCategory !== 'all' ? 'all' : nextCategory;
      setPressed(
        categoryButtons,
        categoryButtons.find((item) => normalize(item.dataset.portfolioCategory) === activeCategory)
      );
      applyFilters();
    });
  });

  searchInput?.addEventListener('input', () => applyFilters());

  searchInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !searchInput.value) return;
    searchInput.value = '';
    applyFilters();
    searchInput.focus();
  });

  searchClear?.addEventListener('click', () => {
    if (!searchInput) return;
    searchInput.value = '';
    applyFilters();
    searchInput.focus();
  });

  resetButtons.forEach((button) => button.addEventListener('click', resetFilters));

  applyFilters(false);
};

const bindArtworkEditPreview = () => {
  const form = document.querySelector('[data-artwork-edit-form]');
  if (!form) return;

  const titleInput = form.querySelector('[data-ae-title]');
  const descriptionInput = form.querySelector('[data-ae-description]');
  const categoryInput = form.querySelector('[data-ae-category]');
  const previewTitle = document.querySelector('[data-ae-preview-title]');
  const previewCategory = document.querySelector('[data-ae-preview-category]');
  const titleCount = document.querySelector('[data-ae-title-count]');
  const descriptionCount = document.querySelector('[data-ae-description-count]');

  const update = () => {
    if (previewTitle && titleInput) {
      previewTitle.textContent = titleInput.value.trim() || 'Untitled artwork';
    }
    if (previewCategory && categoryInput) {
      previewCategory.textContent = categoryInput.selectedOptions[0]?.textContent.trim() || 'Artwork';
    }
    if (titleCount && titleInput) {
      titleCount.textContent = `${titleInput.value.length}/120`;
    }
    if (descriptionCount && descriptionInput) {
      descriptionCount.textContent = `${descriptionInput.value.length}/1200`;
    }
  };

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
};

const bindArtworkDeleteDialog = () => {
  const modal = document.querySelector('[data-delete-modal]');
  if (!modal) return;

  const openButton = document.querySelector('[data-delete-open]');
  const card = modal.querySelector('[data-delete-card]');
  const form = modal.querySelector('[data-delete-form]');
  const submitButton = modal.querySelector('[data-delete-submit]');
  const status = modal.querySelector('[data-delete-status]');
  const cancelButtons = Array.from(modal.querySelectorAll('[data-delete-cancel]'));
  const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let lastTrigger = null;
  let isDeleting = false;

  const setStatus = (message, type = '') => {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', type === 'error');
    status.classList.toggle('is-success', type === 'success');
  };

  const getFocusable = () => Array
    .from(modal.querySelectorAll(focusableSelector))
    .filter((element) => element.tabIndex >= 0 && !element.disabled);

  const resetButtons = () => {
    card?.setAttribute('aria-busy', 'false');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Delete artwork';
    }
    cancelButtons.forEach((button) => {
      button.disabled = false;
    });
  };

  const open = () => {
    lastTrigger = document.activeElement;
    isDeleting = false;
    setStatus('');
    resetButtons();
    modal.hidden = false;
    document.body.classList.add('ae-modal-open');
    modal.querySelector('.ae-modal-cancel')?.focus();
  };

  const close = () => {
    if (isDeleting) return;
    modal.hidden = true;
    document.body.classList.remove('ae-modal-open');
    setStatus('');
    if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
  };

  openButton?.addEventListener('click', open);
  cancelButtons.forEach((button) => button.addEventListener('click', close));

  const handleDeleteKeydown = (event) => {
    if (modal.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', handleDeleteKeydown);
  registerPageCleanup(() => document.removeEventListener('keydown', handleDeleteKeydown));

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isDeleting) return;

    isDeleting = true;
    card?.setAttribute('aria-busy', 'true');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Deleting…';
    }
    cancelButtons.forEach((button) => {
      button.disabled = true;
    });
    setStatus('Deleting this page…');

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json'
        }
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'We could not delete this artwork. Please try again.');
      }

      setStatus('Artwork deleted. Returning to your collection…', 'success');
      const redirectUrl = payload.redirectUrl || form.dataset.deleteRedirect || '/';
      window.setTimeout(() => window.location.assign(redirectUrl), 650);
    } catch (error) {
      isDeleting = false;
      resetButtons();
      setStatus(error.message || 'We could not delete this artwork. Please try again.', 'error');
    }
  });
};

const bindProfileFlash = () => {
  const flash = document.querySelector('[data-profile-flash]');
  if (!flash) return;

  flash.querySelector('[data-profile-flash-close]')?.addEventListener('click', () => {
    flash.hidden = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('deleted');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  });
};

const bindCommentForms = () => {
  document.querySelectorAll('.comment-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const textarea = form.querySelector('textarea[name="body"]');
      const button = form.querySelector('button[type="submit"]');
      const message = (textarea?.value || '').trim();

      if (!textarea || !message) {
        if (textarea) textarea.focus();
        return;
      }

      const previousText = button ? button.textContent : 'Post comment';
      if (button) {
        button.disabled = true;
        button.textContent = 'Posting...';
      }

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams({ body: message })
        });

        if (!response.ok) {
          throw new Error('Comment request failed');
        }

        const data = await response.json();
        if (!data.ok || !data.comment) {
          throw new Error('Comment not accepted');
        }

        const list = document.querySelector('.comment-list');
        if (list) {
          const emptyState = list.querySelector('.empty-state');
          if (emptyState) emptyState.remove();

          const item = document.createElement('div');
          item.className = 'comment-item';

          const avatar = document.createElement('img');
          avatar.src = data.comment.avatar || '/uploads/avatars/default-avatar.png';
          avatar.alt = data.comment.display_name || data.comment.username;

          const body = document.createElement('div');
          body.className = 'comment-body';

          const name = document.createElement('strong');
          name.textContent = data.comment.display_name || data.comment.username;

          const text = document.createElement('p');
          text.textContent = data.comment.body;

          body.appendChild(name);
          body.appendChild(text);
          item.appendChild(avatar);
          item.appendChild(body);
          list.prepend(item);
        }

        const commentSummary = [...document.querySelectorAll('.info-item')].find((item) => item.querySelector('span')?.textContent.trim() === 'Comments');
        if (commentSummary) {
          const counter = commentSummary.querySelector('strong');
          if (counter) counter.textContent = data.comments_count ?? '0';
        }

        form.reset();
      } catch (error) {
        form.submit();
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = previousText;
        }
      }
    });
  });
};

const bindShareButtons = () => {
  document.querySelectorAll('[data-share-artwork]').forEach((button) => {
    if (button.dataset.shareBound === 'true') return;
    button.dataset.shareBound = 'true';

    button.addEventListener('click', async () => {
      const label = button.querySelector('[data-share-label]') || button.querySelector('[data-action-label]');
      const originalText = label ? label.textContent : 'Share';
      const shareUrl = new URL(button.dataset.shareUrl || window.location.pathname, window.location.origin).toString();
      const shareData = {
        title: button.dataset.shareTitle || 'ArtSpace artwork',
        text: button.dataset.shareText || 'Artwork on ArtSpace',
        url: shareUrl
      };

      const flashLabel = (text) => {
        if (!label) return;
        label.textContent = text;
        window.clearTimeout(button._shareTimer);
        button._shareTimer = window.setTimeout(() => { if (button.isConnected) label.textContent = originalText; }, 1800);
      };

      try {
        if (navigator.share) {
          await navigator.share(shareData);
          return;
        }
        await navigator.clipboard.writeText(shareData.url);
        flashLabel('Copied!');
      } catch (error) {
        if (error?.name === 'AbortError') return;
        try {
          const field = document.createElement('textarea');
          field.value = shareData.url;
          field.setAttribute('readonly', '');
          field.style.position = 'fixed';
          field.style.opacity = '0';
          document.body.appendChild(field);
          field.select();
          document.execCommand('copy');
          document.body.removeChild(field);
          flashLabel('Copied!');
        } catch {
          flashLabel('Share unavailable');
        }
      }
    });
  });
};

const bindScrollReveal = () => {
  const targets = document.querySelectorAll('.ad-reveal');
  if (!targets.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    targets.forEach((target) => target.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      currentObserver.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px 48px 0px' });
  registerPageCleanup(() => observer.disconnect());

  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

  targets.forEach((target, index) => {
    const rect = target.getBoundingClientRect();
    if (rect.top < viewportHeight && rect.bottom > 0) {
      target.classList.add('is-visible');
      return;
    }

    target.classList.add('ad-reveal-pending');
    target.style.transitionDelay = `${(index % 5) * 70}ms`;
    observer.observe(target);
  });
};

const markCurrentNavigation = () => {
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

  document.querySelectorAll('.nav-link-group a').forEach((link) => {
    const linkPath = new URL(link.href, window.location.origin).pathname.replace(/\/$/, '') || '/';
    const isCurrent = linkPath === currentPath || (linkPath !== '/' && currentPath.startsWith(`${linkPath}/`));

    link.classList.toggle('is-current', isCurrent);
    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
};

const revealArtworkCards = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;

  const cards = document.querySelectorAll('.art-card');
  if (!cards.length) return;

  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      currentObserver.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px 40px 0px' });
  registerPageCleanup(() => observer.disconnect());

  cards.forEach((card, index) => {
    card.classList.add('motion-pending');
    card.style.transitionDelay = `${(index % 6) * 55}ms`;
    observer.observe(card);
  });
};

const bindArtworkImageFallback = (image, container) => {
  if (!image || image.dataset.imageFallbackBound === 'true') return;
  image.dataset.imageFallbackBound = 'true';

  const handleError = () => {
    const fallback = image.dataset.fallbackSrc;
    const fallbackUrl = fallback ? new URL(fallback, window.location.href).href : '';

    if (fallbackUrl && image.currentSrc !== fallbackUrl && image.dataset.fallbackTried !== 'true') {
      image.dataset.fallbackTried = 'true';
      image.src = fallback;
      return;
    }

    container?.classList.add('is-image-missing');
  };

  image.addEventListener('error', handleError);
  if (image.hasAttribute('src') && image.complete && image.naturalWidth === 0) handleError();
};

const bindFlipbook = () => {
  const experience = document.querySelector('[data-art-book]');
  const book = experience?.querySelector('[data-book-root]');
  if (!experience || !book || !window.St?.PageFlip) return;

  const pages = [...book.querySelectorAll('[data-book-page]')];
  const artworkPages = pages.filter((page) => page.querySelector('[data-book-image]'));
  const previousButton = experience.querySelector('[data-book-prev]');
  const nextButton = experience.querySelector('[data-book-next]');
  const currentLabel = experience.querySelector('[data-book-current]');
  const liveLabel = experience.querySelector('[data-book-live]');
  const closeBookButton = experience.querySelector('[data-book-close]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!pages.length || !artworkPages.length) return;

  const pageFlip = new window.St.PageFlip(book, {
    width: 480,
    height: 580,
    size: 'stretch',
    minWidth: 250,
    maxWidth: 480,
    minHeight: 360,
    maxHeight: 580,
    drawShadow: true,
    flippingTime: reducedMotion ? 1 : 1000,
    usePortrait: true,
    autoSize: false,
    maxShadowOpacity: 0.3,
    showCover: true,
    mobileScrollSupport: false,
    clickEventForward: true,
    useMouseEvents: true,
    swipeDistance: 28,
    disableFlipByClick: false
  });

  const bookSoundCues = new Map();
  const bookCueKinds = ['open', 'page', 'reveal', 'close'];
  let bookAudioContext = null;
  let bookPageTimer = 0;
  let bookRevealTimer = 0;
  let bookCloseTimer = 0;
  let bookResetTimer = 0;

  const getBookAudioContext = () => {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return null;
    if (!bookAudioContext || bookAudioContext.state === 'closed') bookAudioContext = new AudioContextConstructor();
    if (bookAudioContext.state === 'suspended') bookAudioContext.resume().catch(() => {});
    return bookAudioContext;
  };

  const playBookSynthCue = (kind) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      const audioContext = getBookAudioContext();
      if (!audioContext) return;
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const volume = audioContext.createGain();
      const shape = kind === 'close'
        ? { start: 520, end: 260, duration: 0.28 }
        : kind === 'page'
          ? { start: 330, end: 440, duration: 0.2 }
          : { start: 180, end: 620, duration: 0.5 };

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(shape.start, now);
      oscillator.frequency.exponentialRampToValueAtTime(shape.end, now + shape.duration);
      volume.gain.setValueAtTime(0.0001, now);
      volume.gain.exponentialRampToValueAtTime(kind === 'open' || kind === 'close' ? 0.02 : 0.014, now + 0.04);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + shape.duration);
      oscillator.connect(volume);
      volume.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + shape.duration);
    } catch {
    }
  };

  const createBookCue = (kind) => {
    const cue = new Audio(`/audio/art-${kind}.wav`);
    cue.preload = 'auto';
    cue.volume = kind === 'reveal' ? 0.12 : 0.16;
    cue.addEventListener('error', () => {
      cue.dataset.unavailable = 'true';
    }, { once: true });
    cue.load();
    bookSoundCues.set(kind, cue);
    return cue;
  };

  const playBookCue = (kind) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let soundPref = 'on';
    try { soundPref = localStorage.getItem('artspace-art-sound') || 'on'; } catch { /* private mode */ }
    if (soundPref === 'off') return;

    try {
      let cue = bookSoundCues.get(kind);
      if (!cue) cue = createBookCue(kind);

      if (cue.dataset.unavailable) {
        playBookSynthCue(kind);
        return;
      }

      cue.pause();
      cue.currentTime = 0;
      cue.play().catch(() => playBookSynthCue(kind));
    } catch {
      playBookSynthCue(kind);
    }
  };

  const resetBookAudioCues = () => {
    bookSoundCues.forEach((cue) => {
      cue.pause();
      cue.currentTime = 0;
    });
  };

  const clearBookAudioCues = () => {
    resetBookAudioCues();
    bookSoundCues.forEach((cue) => {
      cue.removeAttribute('src');
      cue.load();
    });
    bookSoundCues.clear();

    if (bookAudioContext && bookAudioContext.state !== 'closed') {
      bookAudioContext.close().catch(() => {});
    }
    bookAudioContext = null;
  };

  bookCueKinds.forEach((kind) => {
    if (!bookSoundCues.has(kind)) createBookCue(kind);
  });
  window.addEventListener('pagehide', clearBookAudioCues, { once: true });

  let bookOpenState = false;
  const setBookOpenState = (next) => {
    bookOpenState = next;
    experience.dataset.open = String(next);
    book.classList.toggle('is-open', next);
    if (closeBookButton) closeBookButton.hidden = !next;
  };

  const syncBookOpenState = (pageIndex) => {
    const next = pageIndex > 0;
    setBookOpenState(next);
    if (!next) {
      book.classList.remove('is-opening', 'is-open');
      window.clearTimeout(bookRevealTimer);
    }
  };

  const openBook = (flip = false) => {
    if (!pageFlip || bookOpenState) return;
    setBookOpenState(true);
    book.classList.add('is-opening');
    book.classList.remove('is-closing');
    playBookCue('open');
    window.clearTimeout(bookPageTimer);
    window.clearTimeout(bookRevealTimer);
    window.clearTimeout(bookCloseTimer);
    window.clearTimeout(bookResetTimer);
    bookPageTimer = window.setTimeout(() => playBookCue('page'), reducedMotion ? 0 : 220);
    bookRevealTimer = window.setTimeout(() => {
      if (bookOpenState) {
        book.classList.remove('is-opening');
        book.classList.add('is-open');
        playBookCue('reveal');
      }
    }, reducedMotion ? 0 : 1000);
    if (flip) pageFlip.flipNext();
  };

  const closeBook = () => {
    if (!pageFlip || !bookOpenState) return;
    setBookOpenState(false);
    book.classList.add('is-closing');
    playBookCue('close');
    pageFlip.flip(0);
    window.clearTimeout(bookPageTimer);
    window.clearTimeout(bookRevealTimer);
    bookPageTimer = window.setTimeout(() => playBookCue('page'), reducedMotion ? 0 : 220);
    bookResetTimer = window.setTimeout(resetBookAudioCues, reducedMotion ? 0 : 1800);
    bookCloseTimer = window.setTimeout(() => {
      book.classList.remove('is-closing');
    }, reducedMotion ? 0 : 1000);
  };

  const loadNearbyImages = (pageIndex) => {
    const firstArtworkIndex = Math.max(0, Math.min(artworkPages.length - 1, pageIndex - 1));
    const firstToLoad = Math.max(0, firstArtworkIndex - 1);
    const lastToLoad = Math.min(artworkPages.length - 1, firstArtworkIndex + 3);

    for (let index = firstToLoad; index <= lastToLoad; index += 1) {
      const image = artworkPages[index].querySelector('[data-book-image]');
        if (!image || image.hasAttribute('src') || !image.dataset.src) continue;
      bindArtworkImageFallback(image, image.closest('.book-artwork-link'));
      image.src = image.dataset.src;
      delete image.dataset.src;
    }
  };

  const updateBookControls = (pageIndex = pageFlip.getCurrentPageIndex()) => {
    const spreadIndex = pageFlip.getPageCollection().getCurrentSpreadIndex();
    const portrait = pageFlip.getOrientation() === 'portrait';
    const lastSpreadIndex = portrait ? artworkPages.length : Math.ceil(artworkPages.length / 2);
    book.dataset.orientation = portrait ? 'portrait' : 'landscape';

    if (previousButton) previousButton.disabled = spreadIndex === 0;
    if (nextButton) nextButton.disabled = spreadIndex >= lastSpreadIndex;

    if (pageIndex === 0) {
      if (currentLabel) currentLabel.textContent = 'Cover';
      if (liveLabel) liveLabel.textContent = 'Turn the cover to explore the collection.';
      return;
    }

    const firstArtworkIndex = Math.min(artworkPages.length - 1, Math.max(0, pageIndex - 1));
    const lastArtworkIndex = portrait
      ? firstArtworkIndex
      : Math.min(artworkPages.length - 1, firstArtworkIndex + 1);
    const firstPageNumber = String(firstArtworkIndex + 1).padStart(2, '0');
    const lastPageNumber = String(lastArtworkIndex + 1).padStart(2, '0');
      const pageRange = firstArtworkIndex === lastArtworkIndex
        ? firstPageNumber
        : `${firstPageNumber}-${lastPageNumber}`;

    if (currentLabel) currentLabel.textContent = pageRange;
    if (liveLabel) {
      const title = artworkPages[firstArtworkIndex].querySelector('.book-artwork-title')?.textContent.trim();
      const artist = artworkPages[firstArtworkIndex].querySelector('.book-artwork-artist')?.textContent.trim().replace(/^by\s+/i, '');
      liveLabel.textContent = title && artist ? `${title} by ${artist}` : title || 'Artwork collection';
    }
  };

  pageFlip.loadFromHTML(pages);
  registerPageCleanup(() => {
    window.clearTimeout(bookPageTimer);
    window.clearTimeout(bookRevealTimer);
    window.clearTimeout(bookCloseTimer);
    window.clearTimeout(bookResetTimer);
    window.removeEventListener('pagehide', clearBookAudioCues);
    clearBookAudioCues();
    try {
      pageFlip.destroy();
    } catch (error) {
    }
  });
  loadNearbyImages(0);
  experience.addEventListener('mousedown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const interactive = target?.closest('a[href], button, form, input, textarea, select, [contenteditable], .book-controls, [data-book-close]');
    if (interactive || event.defaultPrevented) return;
    if (bookOpenState) return;
    openBook();
  }, true);

  pageFlip.on('flip', (event) => {
    loadNearbyImages(event.data);
    updateBookControls(event.data);
    syncBookOpenState(event.data);
  });
  pageFlip.on('changeOrientation', () => updateBookControls());

  closeBookButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeBook();
  });

  previousButton?.addEventListener('click', () => {
    playBookCue('page');
    pageFlip.flipPrev();
  });
  nextButton?.addEventListener('click', () => {
    if (!bookOpenState) {
      openBook(true);
      return;
    }
    playBookCue('page');
    pageFlip.flipNext();
  });
  book.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      playBookCue('page');
      pageFlip.flipPrev();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (!bookOpenState) {
        openBook(true);
      } else {
        playBookCue('page');
        pageFlip.flipNext();
      }
    }
    if (event.key === 'Escape' && bookOpenState) {
      event.preventDefault();
      closeBook();
    }
  });

  updateBookControls(0);
};

const bindArtViewer = () => {
  const viewer = document.querySelector('[data-art-viewer]');
  if (!viewer || typeof viewer.showModal !== 'function') return;

  const viewerImage = viewer.querySelector('[data-viewer-image]');
  const imageStage = viewer.querySelector('.art-viewer-stage');
  const drawnFrame = viewer.querySelector('[data-viewer-frame]');
  const particleLayer = viewer.querySelector('[data-viewer-particles]');
  const titleLabel = viewer.querySelector('[data-viewer-title]');
  const artistLabel = viewer.querySelector('[data-viewer-artist]');
  const descriptionLabel = viewer.querySelector('[data-viewer-description]');
  const dateLabel = viewer.querySelector('[data-viewer-date]');
  const countLabel = viewer.querySelector('[data-viewer-count]');
  const detailLink = viewer.querySelector('[data-viewer-detail]');
  const previousButton = viewer.querySelector('[data-viewer-prev]');
  const nextButton = viewer.querySelector('[data-viewer-next]');
  const closeButton = viewer.querySelector('[data-viewer-close]');
  const zoomButton = viewer.querySelector('[data-viewer-zoom]');
  const fullscreenButton = viewer.querySelector('[data-viewer-fullscreen]');
  const soundButton = viewer.querySelector('[data-viewer-sound]');
  const effectsButton = viewer.querySelector('[data-viewer-effects]');
  const likeForm = viewer.querySelector('[data-viewer-like-form]');
  const likeButton = viewer.querySelector('[data-viewer-like]');
  const likeCountLabel = viewer.querySelector('[data-viewer-like-count]');
  const bookmarkForm = viewer.querySelector('[data-viewer-bookmark-form]');
  const bookmarkButton = viewer.querySelector('[data-viewer-bookmark]');
  const shareButton = viewer.querySelector('[data-viewer-share]');
  const relatedToggle = viewer.querySelector('[data-viewer-related-toggle]');
  const relatedPanel = viewer.querySelector('[data-viewer-related]');
  const relatedList = viewer.querySelector('[data-viewer-related-list]');
  const relatedClose = viewer.querySelector('[data-viewer-related-close]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effectNames = ['portrait', 'sketch', 'digital', 'nature', 'khmer', 'default'];
  const effectParticles = {
    portrait: ['petal', 'flower', 'glow', 'spark'],
    sketch: ['pencil', 'paper', 'graphite', 'sketch-line'],
    digital: ['paint', 'paint-stroke', 'spark', 'glow'],
    nature: ['leaf', 'flower', 'wind', 'glow'],
    khmer: ['gold', 'ornament', 'spark', 'paper'],
    default: ['paper', 'spark', 'glow', 'leaf']
  };
  const audioCues = new Map();
  let artworkRecords = [];
  let activeIndex = 0;
  let activeOpener = null;
  let transitionClone = null;
  let animationTimer = 0;
  let soundTimer = 0;
  let shareTimer = 0;
  let parallaxFrame = 0;
  let frameResizeObserver = null;
  let loadSequence = 0;
  let soundEnabled = localStorage.getItem('artspace-art-sound') !== 'off';
  let visualEffectsEnabled = localStorage.getItem('artspace-art-effects') !== 'off';
  let audioContext = null;
  let isZoomed = false;
  let panX = 0;
  let panY = 0;
  let panStart = null;
  let pointerX = 0.5;
  let pointerY = 0.5;

  const setSoundButtonState = () => {
    soundButton?.setAttribute('aria-pressed', String(soundEnabled));
    soundButton?.setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Enable sound');
    if (soundButton) soundButton.title = soundEnabled ? 'Mute sound' : 'Enable subtle sound';
  };

  const setEffectsButtonState = () => {
    effectsButton?.setAttribute('aria-pressed', String(visualEffectsEnabled));
    effectsButton?.setAttribute('aria-label', visualEffectsEnabled ? 'Disable visual effects' : 'Enable visual effects');
    if (effectsButton) effectsButton.title = visualEffectsEnabled ? 'Disable visual effects' : 'Enable visual effects';
    viewer.classList.toggle('effects-off', !visualEffectsEnabled);
  };

  const resolveEffectPreset = (artwork) => {
    if (effectNames.includes(artwork.effect) && artwork.effect !== 'default') return artwork.effect;
    const metadata = `${artwork.category} ${artwork.tags} ${artwork.title}`.toLowerCase();
    if (/khmer|traditional|ornament/.test(metadata)) return 'khmer';
    if (/portrait|human|figure|character|anime|manga/.test(metadata)) return 'portrait';
    if (/pencil|sketch|graphite|drawing/.test(metadata)) return 'sketch';
    if (/digital|3d art|abstract/.test(metadata)) return 'digital';
    if (/nature|landscape|forest|botanical|flower/.test(metadata)) return 'nature';
    return 'default';
  };

  const updateArtworkFrame = () => {
    if (!drawnFrame || !viewerImage?.naturalWidth || !imageStage) return;
    const stageBounds = imageStage.getBoundingClientRect();
    const scale = Math.min(stageBounds.width / viewerImage.naturalWidth, stageBounds.height / viewerImage.naturalHeight);
    const frameWidth = viewerImage.naturalWidth * scale;
    const frameHeight = viewerImage.naturalHeight * scale;
    drawnFrame.style.width = `${frameWidth}px`;
    drawnFrame.style.height = `${frameHeight}px`;
    drawnFrame.style.left = `${(stageBounds.width - frameWidth) / 2}px`;
    drawnFrame.style.top = `${(stageBounds.height - frameHeight) / 2}px`;
    if (!drawnFrame.classList.contains('is-drawn')) requestAnimationFrame(() => drawnFrame.classList.add('is-drawn'));
  };

  const getArtworkRecords = () => {
    const bookPages = [...document.querySelectorAll('[data-book-page][data-artwork-view]')];
    const otherArtwork = [...document.querySelectorAll('[data-artwork-view][data-artwork-id]')]
      .filter((element) => !element.hasAttribute('data-book-page'));
    const seenIds = new Set();

    return [...bookPages, ...otherArtwork].flatMap((element) => {
      const id = element.dataset.artworkId;
      const fullImage = element.dataset.artworkFull;
      if (!id || !fullImage || seenIds.has(id)) return [];
      seenIds.add(id);
      return [{
        id,
        href: `/art/${encodeURIComponent(id)}`,
        fullImage,
        thumbnail: element.dataset.artworkThumb || '',
        title: element.dataset.artworkTitle || 'Untitled artwork',
        description: element.dataset.artworkDescription || '',
        category: element.dataset.artworkCategory || '',
        tags: element.dataset.artworkTags || '',
        effect: element.dataset.artworkEffect || 'auto',
        artist: element.dataset.artworkArtist || 'ArtSpace artist',
        artistUrl: element.dataset.artworkArtistUrl || '',
        date: element.dataset.artworkDate || '',
        liked: element.dataset.artworkLiked === 'true',
        saved: element.dataset.artworkSaved === 'true',
        likes: Number(element.dataset.artworkLikes || 0)
      }];
    });
  };

  const playSynthSound = (kind) => {
    if (!soundEnabled) return;

    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) return;
      if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextConstructor();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const volume = audioContext.createGain();
      const soundShape = kind === 'close'
        ? { start: 520, end: 260, duration: 0.28 }
        : kind === 'page'
          ? { start: 330, end: 440, duration: 0.2 }
          : { start: 180, end: 620, duration: 0.5 };

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(soundShape.start, now);
      oscillator.frequency.exponentialRampToValueAtTime(soundShape.end, now + soundShape.duration);
      volume.gain.setValueAtTime(0.0001, now);
      volume.gain.exponentialRampToValueAtTime(kind === 'open' ? 0.022 : 0.014, now + 0.04);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + soundShape.duration);
      oscillator.connect(volume);
      volume.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + soundShape.duration);
    } catch (error) {
      soundEnabled = false;
      localStorage.setItem('artspace-art-sound', 'off');
      setSoundButtonState();
    }
  };

  const playSound = (kind) => {
    if (!soundEnabled) return;
    const cueName = ['open', 'reveal', 'page', 'close'].includes(kind) ? kind : 'open';

    try {
      let cue = audioCues.get(cueName);
      if (!cue) {
        cue = new Audio(`/audio/art-${cueName}.wav`);
        cue.preload = 'none';
        cue.volume = cueName === 'reveal' ? 0.12 : 0.16;
        cue.addEventListener('error', () => cue.dataset.unavailable = 'true', { once: true });
        audioCues.set(cueName, cue);
      }

      if (cue.dataset.unavailable) {
        playSynthSound(cueName);
        return;
      }

      cue.pause();
      cue.currentTime = 0;
      cue.play().catch(() => playSynthSound(cueName));
    } catch (error) {
      playSynthSound(cueName);
    }
  };

  const closeAudio = () => {
    audioCues.forEach((cue) => {
      cue.pause();
      cue.currentTime = 0;
      cue.removeAttribute('src');
      cue.load();
    });
    audioCues.clear();
    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
    audioContext = null;
  };

  const createParticles = (preset) => {
    if (!particleLayer) return;
    particleLayer.replaceChildren();
    if (reducedMotion || !visualEffectsEnabled) return;

    const lowPower = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches
      || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
      || navigator.connection?.saveData;
    const particleCount = lowPower ? 5 : 9;
    const kinds = effectParticles[preset] || effectParticles.default;

    for (let index = 0; index < particleCount; index += 1) {
      const particle = document.createElement('span');
      const kind = kinds[index % kinds.length];
      particle.className = `art-particle art-particle--${kind}`;
      particle.setAttribute('aria-hidden', 'true');
      particle.style.setProperty('--particle-left', `${Math.round(Math.random() * 100)}%`);
      particle.style.setProperty('--particle-drift', `${Math.round((Math.random() - 0.5) * 28)}vw`);
      particle.style.setProperty('--particle-duration', `${(4.5 + Math.random() * 3.5).toFixed(2)}s`);
      particle.style.setProperty('--particle-delay', `${(index * 110 + Math.random() * 220).toFixed(0)}ms`);
      particle.style.setProperty('--particle-spin', `${Math.round((Math.random() - 0.5) * 540)}deg`);
      particle.style.setProperty('--particle-size', `${(0.72 + Math.random() * 0.72).toFixed(2)}`);
      particleLayer.appendChild(particle);
      particle.addEventListener('animationend', () => particle.remove(), { once: true });
    }
  };

  const updateRelatedWorks = (artwork) => {
    if (!relatedList || !relatedPanel || !relatedToggle) return;
    const matches = [];
    const matchedIndices = new Set();

    artworkRecords.forEach((record, index) => {
      if (record.id === artwork.id) return;
      const score = (record.artist === artwork.artist ? 2 : 0) + (record.category === artwork.category ? 1 : 0);
      if (!score) return;
      const match = { record, index, score };
      const insertAt = matches.findIndex((candidate) => candidate.score < score);
      matches.splice(insertAt < 0 ? matches.length : insertAt, 0, match);
      matchedIndices.add(index);
      if (matches.length > 4) {
        const removed = matches.pop();
        matchedIndices.delete(removed.index);
      }
    });

    for (let index = 0; matches.length < 4 && index < artworkRecords.length; index += 1) {
      if (artworkRecords[index].id === artwork.id || matchedIndices.has(index)) continue;
      matches.push({ record: artworkRecords[index], index, score: 0 });
      matchedIndices.add(index);
    }

    relatedList.replaceChildren();
    matches.forEach(({ record, index }) => {
      const button = document.createElement('button');
      button.className = 'art-viewer-related-item';
      button.type = 'button';
      button.dataset.artworkIndex = String(index);
      button.setAttribute('aria-label', `View ${record.title} by ${record.artist}`);

      const thumbnail = document.createElement('img');
      thumbnail.src = record.thumbnail || record.fullImage;
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';

      const title = document.createElement('span');
      title.textContent = record.title;
      button.append(thumbnail, title);
      relatedList.appendChild(button);
    });

    relatedPanel.hidden = matches.length === 0;
    relatedToggle.disabled = matches.length === 0;
    relatedToggle.setAttribute('aria-expanded', 'false');
    if (matches.length) relatedPanel.hidden = true;
  };

  const updateViewerControls = () => {
    if (countLabel) countLabel.textContent = `${String(activeIndex + 1).padStart(2, '0')} / ${String(artworkRecords.length).padStart(2, '0')}`;
    if (previousButton) previousButton.disabled = activeIndex <= 0;
    if (nextButton) nextButton.disabled = activeIndex >= artworkRecords.length - 1;
  };

  const showArtwork = (index, direction = 0) => {
    if (!artworkRecords.length) return;
    activeIndex = Math.max(0, Math.min(artworkRecords.length - 1, index));
    const artwork = artworkRecords[activeIndex];
    const preset = resolveEffectPreset(artwork);
    const requestId = ++loadSequence;
    const glowColors = {
      portrait: 'rgba(217, 164, 160, 0.3)',
      sketch: 'rgba(207, 199, 183, 0.2)',
      digital: 'rgba(195, 142, 151, 0.28)',
      nature: 'rgba(166, 186, 149, 0.27)',
      khmer: 'rgba(215, 183, 121, 0.32)',
      default: 'rgba(222, 194, 157, 0.22)'
    };

    viewer.classList.remove('is-revealed', 'is-image-missing', 'is-changing-next', 'is-changing-previous', ...effectNames.map((name) => `effect-${name}`));
    viewer.classList.add(`effect-${preset}`);
    viewer.classList.toggle('effects-off', !visualEffectsEnabled);
    viewer.dataset.effect = preset;
    viewer.style.setProperty('--viewer-glow', glowColors[preset]);
    if (direction) viewer.classList.add(direction > 0 ? 'is-changing-next' : 'is-changing-previous');
    viewer.classList.add('is-loading');
    drawnFrame?.classList.remove('is-drawn');
    createParticles(preset);
    updateRelatedWorks(artwork);
    if (viewerImage) {
      viewerImage.alt = artwork.title;
      viewerImage.onload = () => {
        if (requestId !== loadSequence) return;
        viewer.classList.remove('is-changing-next', 'is-changing-previous', 'is-loading');
        viewer.classList.add('is-revealed');
        updateArtworkFrame();
      };
      viewerImage.onerror = () => {
        if (requestId === loadSequence) {
          viewer.classList.remove('is-changing-next', 'is-changing-previous', 'is-loading');
          viewer.classList.add('is-image-missing', 'is-revealed');
          drawnFrame?.classList.remove('is-drawn');
        }
      };
      viewerImage.src = artwork.fullImage;
      if (viewerImage.complete) {
        viewer.classList.remove('is-loading');
        if (viewerImage.naturalWidth) {
          viewer.classList.add('is-revealed');
          updateArtworkFrame();
        }
        else if (viewerImage.getAttribute('src')) viewer.classList.add('is-image-missing', 'is-revealed');
      }
    }

    if (titleLabel) titleLabel.textContent = artwork.title;
    if (artistLabel) {
      artistLabel.textContent = artwork.artist;
      artistLabel.href = artwork.artistUrl || '#';
    }
    if (descriptionLabel) {
      descriptionLabel.textContent = artwork.description;
      descriptionLabel.hidden = !artwork.description;
    }
    if (dateLabel) dateLabel.textContent = artwork.date;
    if (detailLink) detailLink.href = artwork.href;
    if (shareButton) shareButton.textContent = 'Share';
    if (likeForm) likeForm.action = `${artwork.href}/like`;
    if (likeButton) {
      likeButton.textContent = artwork.liked ? 'Unlike' : 'Like';
      likeButton.classList.toggle('active', artwork.liked);
      likeButton.setAttribute('aria-pressed', String(artwork.liked));
    }
    if (likeCountLabel) likeCountLabel.textContent = String(artwork.likes || 0);
    if (bookmarkForm) bookmarkForm.action = `${artwork.href}/bookmark`;
    if (bookmarkButton) {
      bookmarkButton.textContent = artwork.saved ? 'Saved' : 'Save';
      bookmarkButton.classList.toggle('active', artwork.saved);
      bookmarkButton.setAttribute('aria-pressed', String(artwork.saved));
    }
    if (zoomButton) {
      isZoomed = false;
      panX = 0;
      panY = 0;
      viewerImage?.classList.remove('is-zoomed');
      viewerImage?.style.setProperty('--pan-x', '0px');
      viewerImage?.style.setProperty('--pan-y', '0px');
      zoomButton.setAttribute('aria-label', 'Zoom in');
      zoomButton.title = 'Zoom in';
    }
    updateViewerControls();
  };

  const createTransitionClone = (sourceImage, destination) => {
    if (!sourceImage || !destination || reducedMotion) return null;
    const sourceBounds = sourceImage.getBoundingClientRect();
    if (sourceBounds.width < 2 || sourceBounds.height < 2 || !sourceImage.naturalWidth) return null;

    const clone = document.createElement('img');
    clone.className = 'art-transition-clone';
    clone.alt = '';
    clone.src = sourceImage.currentSrc || sourceImage.dataset.src || sourceImage.src;
    clone.style.top = `${sourceBounds.top}px`;
    clone.style.left = `${sourceBounds.left}px`;
    clone.style.width = `${sourceBounds.width}px`;
    clone.style.height = `${sourceBounds.height}px`;
    clone.style.objectFit = getComputedStyle(sourceImage).objectFit || 'cover';
    viewer.appendChild(clone);

    requestAnimationFrame(() => {
      const targetBounds = destination.getBoundingClientRect();
      clone.style.top = `${targetBounds.top}px`;
      clone.style.left = `${targetBounds.left}px`;
      clone.style.width = `${targetBounds.width}px`;
      clone.style.height = `${targetBounds.height}px`;
      clone.style.objectFit = 'contain';
      clone.classList.add('is-expanding');
    });

    return clone;
  };

  const clearViewer = () => {
    window.clearTimeout(animationTimer);
    window.clearTimeout(soundTimer);
    window.clearTimeout(shareTimer);
    if (parallaxFrame) cancelAnimationFrame(parallaxFrame);
    frameResizeObserver?.disconnect();
    frameResizeObserver = null;
    animationTimer = 0;
    soundTimer = 0;
    shareTimer = 0;
    parallaxFrame = 0;
    loadSequence += 1;
    transitionClone?.remove();
    transitionClone = null;
    particleLayer?.replaceChildren();
    viewer.classList.remove('is-open', 'is-revealed', 'is-closing', 'is-changing-next', 'is-changing-previous', 'is-image-missing', 'is-loading', ...effectNames.map((name) => `effect-${name}`));
    viewer.classList.toggle('effects-off', !visualEffectsEnabled);
    viewerImage?.classList.remove('is-zoomed');
    viewerImage?.classList.remove('is-panning');
    if (viewerImage) {
      viewerImage.onload = null;
      viewerImage.onerror = null;
      viewerImage.removeAttribute('src');
      viewerImage.alt = '';
    }
    viewerImage?.style.setProperty('--pan-x', '0px');
    viewerImage?.style.setProperty('--pan-y', '0px');
    panX = 0;
    panY = 0;
    panStart = null;
    relatedPanel.hidden = true;
    relatedToggle?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('art-viewer-open');
    setSoundButtonState();
    setEffectsButtonState();
    closeAudio();
  };

  const closeViewer = () => {
    if (!viewer.open || viewer.classList.contains('is-closing')) return Promise.resolve();
    viewer.classList.add('is-closing');
    playSound('close');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const sourceImage = activeOpener?.querySelector('img');
    const source = sourceImage?.isConnected ? sourceImage : null;
    const sourceBounds = source?.getBoundingClientRect();
    const imageBounds = viewerImage?.getBoundingClientRect();

    transitionClone?.remove();
    transitionClone = null;
    if (!reducedMotion && sourceBounds?.width > 1 && imageBounds?.width > 1 && viewerImage?.naturalWidth) {
      transitionClone = createTransitionClone(viewerImage, source);
      if (transitionClone) {
        transitionClone.style.top = `${imageBounds.top}px`;
        transitionClone.style.left = `${imageBounds.left}px`;
        transitionClone.style.width = `${imageBounds.width}px`;
        transitionClone.style.height = `${imageBounds.height}px`;
        transitionClone.style.objectFit = 'contain';
        viewerImage.classList.remove('is-revealed');
        requestAnimationFrame(() => {
          transitionClone?.classList.remove('is-expanding');
          transitionClone?.style.setProperty('top', `${sourceBounds.top}px`);
          transitionClone?.style.setProperty('left', `${sourceBounds.left}px`);
          transitionClone?.style.setProperty('width', `${sourceBounds.width}px`);
          transitionClone?.style.setProperty('height', `${sourceBounds.height}px`);
          transitionClone?.style.setProperty('object-fit', getComputedStyle(sourceImage).objectFit || 'cover');
        });
      }
    }

    return new Promise((resolve) => {
      animationTimer = window.setTimeout(() => {
        if (viewer.open) viewer.close();
        clearViewer();
        if (activeOpener?.isConnected) activeOpener.focus({ preventScroll: true });
        activeOpener = null;
        resolve();
      }, reducedMotion ? 0 : 760);
    });
  };

  const openViewer = (record, sourceImage, opener) => {
    artworkRecords = getArtworkRecords();
    activeIndex = Math.max(0, artworkRecords.findIndex((artwork) => artwork.id === record.id));
    activeOpener = opener;
    viewer.classList.remove('is-open', 'is-revealed', 'is-closing', 'is-image-missing');
    document.body.classList.add('art-viewer-open');
    viewer.showModal();
    if (window.ResizeObserver && imageStage) {
      frameResizeObserver = new ResizeObserver(updateArtworkFrame);
      frameResizeObserver.observe(imageStage);
    }
    setSoundButtonState();
    setEffectsButtonState();
    showArtwork(activeIndex);
    playSound(resolveEffectPreset(artworkRecords[activeIndex]) === 'sketch' ? 'page' : 'open');
    soundTimer = window.setTimeout(() => {
      if (viewer.open) playSound('reveal');
    }, reducedMotion ? 0 : 520);
    closeButton?.focus({ preventScroll: true });

    requestAnimationFrame(() => {
      viewer.classList.add('is-open');
      transitionClone = createTransitionClone(sourceImage, imageStage);
      if (transitionClone) {
        animationTimer = window.setTimeout(() => {
          transitionClone?.remove();
          transitionClone = null;
          viewer.classList.add('is-revealed');
        }, reducedMotion ? 0 : 780);
      } else {
        viewer.classList.add('is-revealed');
      }
    });
  };

  const changeArtwork = (direction) => {
    const nextIndex = activeIndex + direction;
    if (nextIndex < 0 || nextIndex >= artworkRecords.length) return;
    playSound('page');
    showArtwork(nextIndex, direction);
  };

  document.addEventListener('artwork:like-changed', (event) => {
    document.querySelectorAll('[data-artwork-view]').forEach((element) => {
      if (element.dataset.artworkId === event.detail.id) element.dataset.artworkLiked = String(event.detail.liked);
    });
    const artwork = artworkRecords.find((record) => record.id === event.detail.id);
    if (!artwork) return;
    artwork.liked = event.detail.liked;
    artwork.likes = event.detail.likes;
    if (activeIndex === artworkRecords.indexOf(artwork)) {
      if (likeCountLabel) likeCountLabel.textContent = String(artwork.likes);
      if (likeButton) likeButton.setAttribute('aria-pressed', String(artwork.liked));
    }
  });

  document.addEventListener('artwork:bookmark-changed', (event) => {
    document.querySelectorAll('[data-artwork-view]').forEach((element) => {
      if (element.dataset.artworkId === event.detail.id) element.dataset.artworkSaved = String(event.detail.saved);
    });
    const artwork = artworkRecords.find((record) => record.id === event.detail.id);
    if (!artwork) return;
    artwork.saved = event.detail.saved;
    if (activeIndex === artworkRecords.indexOf(artwork) && bookmarkButton) {
      bookmarkButton.textContent = artwork.saved ? 'Saved' : 'Save';
      bookmarkButton.classList.toggle('active', artwork.saved);
      bookmarkButton.setAttribute('aria-pressed', String(artwork.saved));
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const trigger = target?.closest('a[href^="/art/"], [data-artwork-open]');
    if (!trigger) return;

    if (trigger instanceof HTMLAnchorElement && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || trigger.target === '_blank')) return;
    const artworkElement = trigger.closest('[data-artwork-view]');
    if (!artworkElement?.dataset.artworkId || !artworkElement.dataset.artworkFull) return;

    const record = {
      id: artworkElement.dataset.artworkId,
      title: artworkElement.dataset.artworkTitle || 'Untitled artwork',
      artist: artworkElement.dataset.artworkArtist || 'ArtSpace artist',
      date: artworkElement.dataset.artworkDate || '',
      fullImage: artworkElement.dataset.artworkFull,
      href: `/art/${encodeURIComponent(artworkElement.dataset.artworkId)}`
    };
    const sourceImage = artworkElement.querySelector('img');
    if (!sourceImage) return;
    event.preventDefault();
    openViewer(record, sourceImage, trigger);
  });

  previousButton?.addEventListener('click', () => changeArtwork(-1));
  nextButton?.addEventListener('click', () => changeArtwork(1));
  closeButton?.addEventListener('click', closeViewer);
  effectsButton?.addEventListener('click', () => {
    visualEffectsEnabled = !visualEffectsEnabled;
    localStorage.setItem('artspace-art-effects', visualEffectsEnabled ? 'on' : 'off');
    setEffectsButtonState();
    if (visualEffectsEnabled) createParticles(viewer.dataset.effect || 'default');
    else particleLayer?.replaceChildren();
  });

  relatedToggle?.addEventListener('click', () => {
    const expanded = relatedToggle.getAttribute('aria-expanded') === 'true';
    relatedToggle.setAttribute('aria-expanded', String(!expanded));
    relatedPanel.hidden = expanded;
    if (!expanded) relatedList.querySelector('button')?.focus({ preventScroll: true });
  });
  relatedClose?.addEventListener('click', () => {
    relatedPanel.hidden = true;
    relatedToggle?.setAttribute('aria-expanded', 'false');
    relatedToggle?.focus({ preventScroll: true });
  });
  relatedList?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-artwork-index]') : null;
    if (!target) return;
    const index = Number(target.dataset.artworkIndex);
    if (!Number.isInteger(index)) return;
    showArtwork(index, index > activeIndex ? 1 : -1);
  });

  shareButton?.addEventListener('click', async () => {
    const artwork = artworkRecords[activeIndex];
    if (!artwork) return;
    const shareData = { title: artwork.title, text: `${artwork.title} by ${artwork.artist}`, url: new URL(artwork.href, window.location.origin).href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareData.url);
        } else {
          const field = document.createElement('textarea');
          field.value = shareData.url;
          field.setAttribute('readonly', '');
          field.style.position = 'fixed';
          field.style.opacity = '0';
          document.body.appendChild(field);
          field.select();
          const copied = document.execCommand('copy');
          field.remove();
          if (!copied) throw new Error('Clipboard unavailable');
        }
        shareButton.textContent = 'Copied';
        window.clearTimeout(shareTimer);
        shareTimer = window.setTimeout(() => { if (shareButton.isConnected) shareButton.textContent = 'Share'; }, 1400);
      }
    } catch (error) {
      if (error.name !== 'AbortError') shareButton.textContent = 'Share unavailable';
    }
  });

  imageStage?.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isZoomed) {
      panStart = { x: event.clientX, y: event.clientY, panX, panY };
      viewerImage?.classList.add('is-panning');
      viewerImage?.setPointerCapture(event.pointerId);
    } else if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      panStart = { x: event.clientX, y: event.clientY, panX: 0, panY: 0, swipe: true };
    }
  });

  imageStage?.addEventListener('pointermove', (event) => {
    if (!panStart || !isZoomed || panStart.swipe) return;
    const bounds = imageStage.getBoundingClientRect();
    panX = Math.max(-bounds.width * 0.38, Math.min(bounds.width * 0.38, panStart.panX + event.clientX - panStart.x));
    panY = Math.max(-bounds.height * 0.38, Math.min(bounds.height * 0.38, panStart.panY + event.clientY - panStart.y));
    viewerImage?.style.setProperty('--pan-x', `${panX}px`);
    viewerImage?.style.setProperty('--pan-y', `${panY}px`);
  });

  imageStage?.addEventListener('pointerup', (event) => {
    if (!panStart) return;
    if (panStart.swipe) {
      const deltaX = event.clientX - panStart.x;
      const deltaY = event.clientY - panStart.y;
      if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) changeArtwork(deltaX < 0 ? 1 : -1);
    }
    panStart = null;
    viewerImage?.classList.remove('is-panning');
  });
  imageStage?.addEventListener('pointercancel', () => {
    panStart = null;
    viewerImage?.classList.remove('is-panning');
  });

  viewer.addEventListener('pointermove', (event) => {
    if (reducedMotion || !visualEffectsEnabled || event.pointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches) return;
    pointerX = event.clientX / window.innerWidth - 0.5;
    pointerY = event.clientY / window.innerHeight - 0.5;
    if (parallaxFrame) return;
    parallaxFrame = requestAnimationFrame(() => {
      parallaxFrame = 0;
      particleLayer?.querySelectorAll('.art-particle').forEach((particle, index) => {
        const depth = 0.4 + (index % 4) * 0.2;
        particle.style.setProperty('--particle-parallax-x', `${Math.round(pointerX * 28 * depth)}px`);
        particle.style.setProperty('--particle-parallax-y', `${Math.round(pointerY * 18 * depth)}px`);
      });
    });
  });
  viewer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeViewer();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      changeArtwork(-1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      changeArtwork(1);
    }
  });

  viewer.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeViewer();
  });
  viewer.addEventListener('click', (event) => {
    if (event.target === viewer) closeViewer();
  });

  detailLink?.addEventListener('click', (event) => {
    const destination = detailLink.href;
    event.preventDefault();
    closeViewer().then(() => {
      if (window.ArtSpaceNavigation?.navigate) window.ArtSpaceNavigation.navigate(destination);
      else window.location.assign(destination);
    });
  });

  zoomButton?.addEventListener('click', () => {
    isZoomed = !isZoomed;
    if (!isZoomed) {
      panX = 0;
      panY = 0;
      viewerImage?.style.setProperty('--pan-x', '0px');
      viewerImage?.style.setProperty('--pan-y', '0px');
    }
    viewerImage?.classList.toggle('is-zoomed', isZoomed);
    zoomButton.setAttribute('aria-label', isZoomed ? 'Reset zoom' : 'Zoom in');
    zoomButton.title = isZoomed ? 'Reset zoom' : 'Zoom in';
  });

  fullscreenButton?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        try {
          await viewer.requestFullscreen();
        } catch (error) {
          await document.documentElement.requestFullscreen();
        }
      }
      const isFullscreen = Boolean(document.fullscreenElement);
      fullscreenButton.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
      fullscreenButton.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
    } catch (error) {
      fullscreenButton.disabled = true;
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!fullscreenButton) return;
    const isFullscreen = Boolean(document.fullscreenElement);
    fullscreenButton.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    fullscreenButton.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
  });

  soundButton?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('artspace-art-sound', soundEnabled ? 'on' : 'off');
    if (!soundEnabled) closeAudio();
    if (soundEnabled) playSound('page');
    setSoundButtonState();
  });

  viewer.addEventListener('close', clearViewer);
};

if (toggleButton) {
  toggleButton.addEventListener('click', () => {
    const nextTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
  });
}

bindArtViewer();

const initStudioDashboard = () => {
  const studioDashboard = document.querySelector('[data-studio-dashboard]');
  if (!studioDashboard) return;

  const studioCollectionDialog = document.querySelector('[data-collection-dialog]');
  const studioMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const studioSoundStorageKey = 'artspace-pencil-sound';
  const studioSoundButton = studioDashboard.querySelector('[data-pencil-sound]');
  const studioSoundState = studioDashboard.querySelector('[data-pencil-sound-state]');
  let studioSoundEnabled = localStorage.getItem(studioSoundStorageKey) === 'on';
  let studioAudioContext = null;
  let studioLastStroke = 0;

  const prepareStudioDoodles = (scope) => {
    scope?.querySelectorAll('[data-doodle] path, .studio-art-frame-line path').forEach((path) => {
      if (!path.hasAttribute('pathLength')) path.setAttribute('pathLength', '1');
    });
  };

  const setStudioSection = (sectionId) => {
    if (!sectionId) return;
    studioDashboard.querySelectorAll('[data-studio-nav]').forEach((link) => {
      link.classList.toggle('is-active', link.dataset.studioNav === sectionId);
    });
  };

  const studioNavLinks = Array.from(studioDashboard.querySelectorAll('[data-studio-nav]'));
  const studioSections = studioNavLinks
    .map((link) => document.getElementById(link.dataset.studioNav))
    .filter(Boolean);
  let studioScrollFrame = null;

  const updateStudioSectionFromScroll = () => {
    studioScrollFrame = null;
    if (!studioSections.length) return;
    const marker = window.scrollY + 170;
    let currentSection = studioSections[0];

    studioSections.forEach((section) => {
      const sectionTop = section.getBoundingClientRect().top + window.scrollY;
      if (sectionTop <= marker) currentSection = section;
    });

    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      currentSection = studioSections[studioSections.length - 1];
    }

    setStudioSection(currentSection.id);
  };

  const requestStudioSectionUpdate = () => {
    if (studioScrollFrame !== null) return;
    studioScrollFrame = window.requestAnimationFrame(updateStudioSectionFromScroll);
  };

  studioNavLinks.forEach((link) => {
    link.addEventListener('click', () => setStudioSection(link.dataset.studioNav));
  });

  window.addEventListener('scroll', requestStudioSectionUpdate, { passive: true });
  window.addEventListener('resize', requestStudioSectionUpdate);
  updateStudioSectionFromScroll();

  const studioRevealTargets = [
    ...studioDashboard.querySelectorAll('[data-doodle], .studio-art-card, .studio-stat-card, .studio-quick-card'),
    ...(studioCollectionDialog ? studioCollectionDialog.querySelectorAll('[data-doodle]') : [])
  ];

  prepareStudioDoodles(studioDashboard);
  prepareStudioDoodles(studioCollectionDialog);

  if (!studioMotionQuery.matches && 'IntersectionObserver' in window) {
    const studioRevealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        studioRevealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
    registerPageCleanup(() => studioRevealObserver.disconnect());

    studioDashboard.classList.add('is-enhanced');
    studioCollectionDialog?.classList.add('is-enhanced');
    studioRevealTargets.forEach((target) => studioRevealObserver.observe(target));
  } else {
    studioRevealTargets.forEach((target) => target.classList.add('is-visible'));
  }

  if (studioCollectionDialog) {
    const openStudioCollectionDialog = () => {
      if (typeof studioCollectionDialog.showModal === 'function') {
        if (!studioCollectionDialog.open) studioCollectionDialog.showModal();
      } else {
        studioCollectionDialog.setAttribute('open', '');
      }
      document.body.classList.add('studio-dialog-open');
      window.setTimeout(() => {
        studioCollectionDialog.querySelector('#collection-name')?.focus();
      }, 80);
    };

    const closeStudioCollectionDialog = () => {
      if (typeof studioCollectionDialog.close === 'function') {
        studioCollectionDialog.close();
      } else {
        studioCollectionDialog.removeAttribute('open');
        document.body.classList.remove('studio-dialog-open');
      }
    };

    document.querySelectorAll('[data-open-collection]').forEach((button) => {
      button.addEventListener('click', openStudioCollectionDialog);
    });

    studioCollectionDialog.querySelectorAll('[data-close-collection]').forEach((button) => {
      button.addEventListener('click', closeStudioCollectionDialog);
    });

    studioCollectionDialog.addEventListener('click', (event) => {
      if (event.target === studioCollectionDialog) closeStudioCollectionDialog();
    });

    studioCollectionDialog.addEventListener('close', () => {
      document.body.classList.remove('studio-dialog-open');
    });
  }

  const getStudioAudioContext = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!studioAudioContext) studioAudioContext = new AudioContextClass();
    if (studioAudioContext.state === 'suspended') studioAudioContext.resume();
    return studioAudioContext;
  };

  const playStudioPencilStroke = () => {
    if (!studioSoundEnabled) return;
    const now = window.performance.now();
    if (now - studioLastStroke < 60) return;
    studioLastStroke = now;

    const audioContext = getStudioAudioContext();
    if (!audioContext) return;

    const duration = 0.1;
    const buffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * duration), audioContext.sampleRate);
    const channel = buffer.getChannelData(0);

    for (let index = 0; index < channel.length; index += 1) {
      const progress = index / channel.length;
      channel[index] = (Math.random() * 2 - 1) * (1 - progress) * 0.16;
    }

    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1400 + Math.random() * 1100;
    filter.Q.value = 0.9;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, audioContext.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    source.connect(filter).connect(gain).connect(audioContext.destination);
    source.start();
  };

  const setStudioSoundState = () => {
    if (!studioSoundButton) return;
    studioSoundButton.setAttribute('aria-pressed', studioSoundEnabled ? 'true' : 'false');
    studioSoundButton.title = studioSoundEnabled ? 'Disable pencil sounds' : 'Enable pencil sounds';
    if (studioSoundState) studioSoundState.textContent = studioSoundEnabled ? 'On' : 'Off';
  };

  setStudioSoundState();

  studioSoundButton?.addEventListener('click', () => {
    studioSoundEnabled = !studioSoundEnabled;
    localStorage.setItem(studioSoundStorageKey, studioSoundEnabled ? 'on' : 'off');
    setStudioSoundState();
    if (studioSoundEnabled) {
      getStudioAudioContext();
      playStudioPencilStroke();
    }
  });

  [studioDashboard, studioCollectionDialog].forEach((scope) => {
    scope?.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Element && event.target.closest('a, button')) {
        playStudioPencilStroke();
      }
    }, { passive: true });
  });

  registerPageCleanup(() => {
    window.removeEventListener('scroll', requestStudioSectionUpdate);
    window.removeEventListener('resize', requestStudioSectionUpdate);
    if (studioScrollFrame !== null) window.cancelAnimationFrame(studioScrollFrame);
    if (studioAudioContext && studioAudioContext.state !== 'closed') studioAudioContext.close().catch(() => {});
  });
};

const initUploadPage = () => {
  const uploadPage = document.querySelector('[data-upload-studio]');
  if (!uploadPage) return;

  const form = uploadPage.querySelector('[data-upload-form]');
  const dropzone = uploadPage.querySelector('[data-upload-dropzone]');
  const fileInput = uploadPage.querySelector('#images');
  const emptyState = uploadPage.querySelector('[data-upload-empty]');
  const preview = uploadPage.querySelector('[data-upload-preview]');
  const previewImage = uploadPage.querySelector('[data-upload-preview-image]');
  const replaceButton = uploadPage.querySelector('[data-upload-replace]');
  const removeButton = uploadPage.querySelector('[data-upload-remove]');
  const fileInfo = uploadPage.querySelector('[data-upload-file]');
  const fileName = uploadPage.querySelector('[data-upload-file-name]');
  const fileSize = uploadPage.querySelector('[data-upload-file-size]');
  const fileError = uploadPage.querySelector('[data-upload-error]');
  const formError = uploadPage.querySelector('[data-upload-form-error]');
  const formErrorText = uploadPage.querySelector('[data-upload-form-error-text]');
  const dismissError = uploadPage.querySelector('[data-upload-dismiss-error]');
  const titleInput = uploadPage.querySelector('#title');
  const categoryInput = uploadPage.querySelector('#category');
  const publishButton = uploadPage.querySelector('[data-upload-publish]');
  const publishLabel = uploadPage.querySelector('[data-upload-publish-label]');
  const draftButton = uploadPage.querySelector('[data-upload-draft]');
  const readiness = uploadPage.querySelector('[data-upload-readiness]');
  const progressPanel = uploadPage.querySelector('[data-upload-progress]');
  const progressPercent = uploadPage.querySelector('[data-upload-progress-percent]');
  const progressLine = uploadPage.querySelector('[data-upload-progress-line]');
  const progressTrack = uploadPage.querySelector('[data-upload-progress-track]');
  const progressLabel = uploadPage.querySelector('[data-upload-progress-label]');
  const progressDetail = uploadPage.querySelector('[data-upload-progress-detail]');
  const progressKicker = uploadPage.querySelector('[data-upload-progress-kicker]');
  const successPanel = uploadPage.querySelector('[data-upload-success]');
  const successImage = uploadPage.querySelector('[data-upload-success-image]');
  const successTitle = uploadPage.querySelector('[data-upload-success-title]');
  const successNote = uploadPage.querySelector('[data-upload-success-note]');
  const successView = uploadPage.querySelector('[data-upload-success-view]');
  const maxFileSize = 8 * 1024 * 1024;
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const allowedExtension = /\.(jpe?g|png|webp)$/i;
  let selectedFile = null;
  let previewUrl = '';
  let isUploading = false;
  let uploadMode = 'publish';
  let activeRequest = null;
  let dragDepth = 0;

  if (!form || !dropzone || !fileInput || !publishButton || !draftButton) return;

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const clearFileError = () => {
    if (!fileError) return;
    fileError.hidden = true;
    fileError.textContent = '';
    dropzone.removeAttribute('aria-invalid');
  };

  const showFileError = (message) => {
    if (!fileError) return;
    fileError.textContent = message;
    fileError.hidden = false;
    dropzone.setAttribute('aria-invalid', 'true');
  };

  const clearFormError = () => {
    if (!formError) return;
    formError.hidden = true;
    if (formErrorText) formErrorText.textContent = '';
  };

  const showFormError = (message, scrollToError = true) => {
    if (!formError || !formErrorText) return;
    formErrorText.textContent = message;
    formError.hidden = false;
    if (scrollToError) {
      formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const getReadinessMessage = () => {
    const missing = [];
    if (!selectedFile) missing.push('a drawing');
    if (!titleInput?.value.trim()) missing.push('a title');
    if (!categoryInput?.value) missing.push('a category');
    if (missing.length === 0) return 'Ready when you are. Pin this page to your collection.';
    if (missing.length === 1) return `Add ${missing[0]} to finish this page.`;
    if (missing.length === 2) return `Add ${missing[0]} and ${missing[1]} to finish this page.`;
    return `Add ${missing[0]}, ${missing[1]}, and ${missing[2]} to finish this page.`;
  };

  const updateReadiness = () => {
    const ready = Boolean(selectedFile && titleInput?.value.trim() && categoryInput?.value);
    publishButton.disabled = !ready || isUploading;
    draftButton.disabled = !ready || isUploading;
    if (readiness) {
      readiness.textContent = isUploading ? 'Your page is being pressed into the gallery…' : getReadinessMessage();
      readiness.classList.toggle('is-ready', ready && !isUploading);
    }
  };

  const resetProgress = () => {
    if (!progressPanel) return;
    progressPanel.classList.remove('is-complete', 'is-processing');
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressLine) progressLine.style.strokeDashoffset = '100';
    if (progressTrack) progressTrack.style.setProperty('--upload-progress', '0%');
    if (progressLabel) progressLabel.textContent = 'Uploading your page…';
    if (progressDetail) progressDetail.textContent = 'Keep this page open while the ink dries.';
    if (progressKicker) progressKicker.textContent = 'Pressing pencil to paper';
  };

  const setProgress = (value) => {
    const percent = Math.max(0, Math.min(100, Math.round(value)));
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressLine) progressLine.style.strokeDashoffset = String(100 - percent);
    if (progressTrack) progressTrack.style.setProperty('--upload-progress', `${percent}%`);

    if (percent >= 100) {
      progressPanel?.classList.add('is-processing');
      if (progressKicker) progressKicker.textContent = 'Drying the ink';
      if (progressLabel) progressLabel.textContent = 'Finishing your gallery page…';
      if (progressDetail) progressDetail.textContent = 'Your drawing arrived. We are pressing it into its final page shape.';
      return;
    }

    if (percent > 0) {
      if (progressDetail) progressDetail.textContent = 'Sending your drawing to the studio…';
    }
  };

  const clearPreviewUrl = () => {
    if (!previewUrl) return;
    URL.revokeObjectURL(previewUrl);
    previewUrl = '';
  };

  const clearSelectedFile = () => {
    clearPreviewUrl();
    selectedFile = null;
    fileInput.value = '';
    dropzone.classList.remove('has-file', 'is-dragging');
    if (emptyState) emptyState.hidden = false;
    if (preview) preview.hidden = true;
    if (preview) preview.classList.remove('is-loaded');
    if (previewImage) previewImage.removeAttribute('src');
    if (fileInfo) fileInfo.hidden = true;
    clearFileError();
    updateReadiness();
  };

  const selectFile = (file) => {
    clearFileError();

    if (!file) return;

    const validType = allowedTypes.has(file.type) || allowedExtension.test(file.name);
    if (!validType) {
      fileInput.value = '';
      showFileError('That file is not a JPG, PNG, or WEBP image. Choose one of those formats.');
      updateReadiness();
      return;
    }

    if (file.size > maxFileSize) {
      fileInput.value = '';
      showFileError('That image is larger than 8 MB. Please choose a smaller file.');
      updateReadiness();
      return;
    }

    if (file.size === 0) {
      fileInput.value = '';
      showFileError('That image appears to be empty. Please choose another file.');
      updateReadiness();
      return;
    }

    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
    } catch (error) {
      fileInput.value = '';
    }

    clearPreviewUrl();
    selectedFile = file;
    previewUrl = URL.createObjectURL(file);
    dropzone.classList.add('has-file');

    if (previewImage) {
      previewImage.onload = () => preview?.classList.add('is-loaded');
      previewImage.src = previewUrl;
      previewImage.alt = `Preview of ${file.name}`;
    }

    if (preview) preview.hidden = false;
    if (emptyState) emptyState.hidden = true;
    if (fileInfo) fileInfo.hidden = false;
    if (fileName) fileName.textContent = file.name;
    if (fileSize) fileSize.textContent = `${formatFileSize(file.size)} · ${file.type.replace('image/', '').toUpperCase()}`;

    updateReadiness();
  };

  const restoreActions = () => {
    isUploading = false;
    activeRequest = null;
    window.__artspaceUploading = false;
    form.removeAttribute('aria-busy');
    publishButton.classList.remove('is-loading');
    if (publishLabel) publishLabel.textContent = 'Publish Artwork';
    draftButton.textContent = 'Save as draft';
    updateReadiness();
  };

  const showUploadError = (message) => {
    restoreActions();
    if (progressPanel) progressPanel.hidden = true;
    resetProgress();
    showFormError(message);
  };

  const showSuccess = (payload) => {
    isUploading = false;
    activeRequest = null;
    window.__artspaceUploading = false;
    form.removeAttribute('aria-busy');
    publishButton.classList.remove('is-loading');
    if (progressPercent) progressPercent.textContent = '100%';
    if (progressLine) progressLine.style.strokeDashoffset = '0';
    if (progressTrack) progressTrack.style.setProperty('--upload-progress', '100%');
    progressPanel?.classList.remove('is-processing');
    progressPanel?.classList.add('is-complete');
    if (progressKicker) progressKicker.textContent = 'Page pinned';
    if (progressLabel) progressLabel.textContent = 'Your page is safe in the collection.';
    if (progressDetail) progressDetail.textContent = 'The ink is dry.';

    const wasDraft = Boolean(payload?.isDraft);
    const isPrivate = Boolean(payload?.isPrivate);
    const isHidden = wasDraft || isPrivate;

    if (successTitle) {
      successTitle.textContent = wasDraft
        ? 'Your draft is tucked safely into your collection!'
        : isPrivate
          ? 'Your artwork is saved in your private collection!'
          : 'Your artwork has been added to your collection!';
    }
    if (successNote) {
      successNote.textContent = wasDraft
        ? 'Only you can see it until you are ready to publish.'
        : isPrivate
          ? 'Only you can see it until you choose to share it.'
          : 'It is pinned to your gallery and ready for the world to see.';
    }
    if (successImage && payload?.artworkImageUrl) {
      successImage.src = payload.artworkImageUrl;
      successImage.alt = wasDraft
        ? 'Your saved draft artwork'
        : isPrivate
          ? 'Your privately saved artwork'
          : 'Your newly published artwork';
    }
    if (successView) {
      successView.href = isHidden
        ? (payload?.artworkEditUrl || '/dashboard')
        : (payload?.artworkUrl || '/dashboard');
      successView.textContent = wasDraft ? 'View Draft' : isPrivate ? 'View in Studio' : 'View Artwork';
    }

    window.setTimeout(() => {
      form.hidden = true;
      if (successPanel) {
        successPanel.hidden = false;
        successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        successTitle?.focus({ preventScroll: true });
      }
    }, 380);
  };

  const startUpload = (mode) => {
    if (isUploading) return;

    if (!selectedFile) {
      showFileError('Add an image of your artwork before publishing.');
      dropzone.focus();
      return;
    }

    if (!titleInput?.value.trim()) {
      showFormError('Give your artwork a title before publishing.');
      titleInput?.focus();
      return;
    }

    if (!categoryInput?.value) {
      showFormError('Choose a category for your artwork.');
      categoryInput?.focus();
      return;
    }

    clearFileError();
    clearFormError();
    isUploading = true;
    window.__artspaceUploading = true;
    uploadMode = mode;
    form.setAttribute('aria-busy', 'true');
    publishButton.disabled = true;
    draftButton.disabled = true;
    if (progressPanel) progressPanel.hidden = false;
    resetProgress();
    setProgress(0);

    if (mode === 'draft') {
      draftButton.textContent = 'Saving…';
    } else {
      publishButton.classList.add('is-loading');
      if (publishLabel) publishLabel.textContent = 'Publishing…';
    }
    updateReadiness();

    const formData = new FormData(form);
    formData.delete('images');
    formData.append('images', selectedFile, selectedFile.name);
    formData.delete('save_as_draft');
    if (uploadMode === 'draft') formData.append('save_as_draft', 'on');

    const xhr = new XMLHttpRequest();
    activeRequest = xhr;
    xhr.open('POST', form.getAttribute('action') || '/upload', true);
    xhr.timeout = 120000;
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      setProgress((event.loaded / event.total) * 100);
    });

    xhr.upload.addEventListener('load', () => {
      setProgress(100);
    });

    xhr.addEventListener('load', () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch (error) {
        payload = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && payload?.ok) {
        showSuccess(payload);
        return;
      }

      showUploadError(payload?.error || 'We could not pin this page. Please try again.');
    });

    xhr.addEventListener('error', () => {
      showUploadError('The upload lost its connection. Check your connection and try again.');
    });

    xhr.addEventListener('timeout', () => {
      showUploadError('This upload took too long. Please try again with a smaller image.');
    });

    xhr.send(formData);
  };

  fileInput.addEventListener('change', () => {
    selectFile(fileInput.files?.[0]);
  });

  dropzone.addEventListener('click', (event) => {
    if (isUploading) return;
    if (event.target instanceof Element && event.target.closest('button, label, input')) return;
    fileInput.click();
  });

  dropzone.addEventListener('keydown', (event) => {
    if (isUploading) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target instanceof Element && event.target.closest('button, input')) return;
    event.preventDefault();
    fileInput.click();
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (isUploading) return;
      if (eventName === 'dragenter') dragDepth += 1;
      dropzone.classList.add('is-dragging');
    });
  });

  dropzone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('is-dragging');
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-dragging');
    if (isUploading) return;
    selectFile(event.dataTransfer?.files?.[0]);
  });

  replaceButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!isUploading) fileInput.click();
  });

  removeButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!isUploading) clearSelectedFile();
  });

  dismissError?.addEventListener('click', clearFormError);
  titleInput?.addEventListener('input', updateReadiness);
  categoryInput?.addEventListener('change', updateReadiness);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isUploading) return;
    const isDraft = event.submitter === draftButton;
    startUpload(isDraft ? 'draft' : 'publish');
  });

  const handleUploadBeforeUnload = (event) => {
    if (!isUploading) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', handleUploadBeforeUnload);
  registerPageCleanup(() => {
    window.removeEventListener('beforeunload', handleUploadBeforeUnload);
    if (activeRequest && typeof activeRequest.abort === 'function') activeRequest.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    window.__artspaceUploading = false;
  });

  if (fileError) fileError.hidden = true;
  if (progressPanel) progressPanel.hidden = true;
  updateReadiness();
};

const initExplorePage = () => {
  const explorePage = document.querySelector('[data-explore-page]');
  if (!explorePage) return;

  const pageController = new AbortController();
  const pageSignal = pageController.signal;
  registerPageCleanup(() => {
    pageController.abort();
    if (exploreRequest) exploreRequest.abort();
  });

  const exploreForm = explorePage.querySelector('[data-explore-form]');
  const exploreGallery = document.getElementById('explore-gallery');
  const exploreQueryInput = explorePage.querySelector('[data-explore-query]');
  const exploreCategoryInput = explorePage.querySelector('[data-explore-category-input]');
  const exploreSortInput = explorePage.querySelector('[data-explore-sort-input]');
  const exploreReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const exploreAnnouncer = document.createElement('p');
  let exploreRequest = null;
  let exploreState = exploreForm ? {
    q: (exploreForm.elements.q?.value || '').trim(),
    category: exploreForm.elements.category?.value || 'all',
    sort: exploreForm.elements.sort?.value || 'latest'
  } : { q: '', category: 'all', sort: 'latest' };

  exploreAnnouncer.className = 'studio-explore-sr-only';
  exploreAnnouncer.setAttribute('aria-live', 'polite');
  explorePage.prepend(exploreAnnouncer);

  const getExploreResults = () => exploreGallery?.querySelector('[data-explore-results]') || null;

  const bindExploreMedia = (scope = explorePage) => {
    scope.querySelectorAll('[data-explore-card], .studio-explore-spotlight').forEach((container) => {
      const image = container.querySelector('img');
      if (!image || image.dataset.exploreFallbackBound === 'true') return;
      image.dataset.exploreFallbackBound = 'true';
      bindArtworkImageFallback(image, container);
    });

    scope.querySelectorAll('[data-explore-avatar]').forEach((image) => {
      if (image.dataset.exploreAvatarBound === 'true') return;
      image.dataset.exploreAvatarBound = 'true';
      const fallback = image.dataset.exploreAvatar;
      if (!fallback) return;
      const handleAvatarError = () => {
        if (image.getAttribute('src') === fallback) return;
        image.src = fallback;
      };
      image.addEventListener('error', handleAvatarError);
      if (image.complete && image.naturalWidth === 0) handleAvatarError();
    });
  };

  const buildExploreUrl = (nextState) => {
    const url = new URL('/explore', window.location.origin);
    if (nextState.category && nextState.category !== 'all') url.searchParams.set('category', nextState.category);
    if (nextState.sort && nextState.sort !== 'latest') url.searchParams.set('sort', nextState.sort);
    if (nextState.q) url.searchParams.set('q', nextState.q);
    return url;
  };

  const getExploreStateFromUrl = (url) => {
    const sortAliases = {
      newest: 'latest',
      views: 'views',
      viewed: 'views',
      'most-viewed': 'views',
      popular: 'popular',
      liked: 'popular',
      'most-liked': 'popular',
      trending: 'popular'
    };
    const rawSort = (url.searchParams.get('sort') || 'latest').toLowerCase();
    return {
      q: (url.searchParams.get('q') || '').trim(),
      category: (url.searchParams.get('category') || 'all').toLowerCase(),
      sort: sortAliases[rawSort] || 'latest'
    };
  };

  const syncExploreControls = () => {
    if (exploreQueryInput && document.activeElement !== exploreQueryInput) exploreQueryInput.value = exploreState.q;
    if (exploreCategoryInput) exploreCategoryInput.value = exploreState.category;
    if (exploreSortInput) exploreSortInput.value = exploreState.sort;

    explorePage.querySelectorAll('[data-explore-category]').forEach((link) => {
      link.href = buildExploreUrl({ ...exploreState, category: link.dataset.exploreCategory }).toString();
      const isActive = link.dataset.exploreCategory === exploreState.category;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    explorePage.querySelectorAll('[data-explore-sort]').forEach((link) => {
      link.href = buildExploreUrl({ ...exploreState, sort: link.dataset.exploreSort }).toString();
      const isActive = link.dataset.exploreSort === exploreState.sort;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };

  const updateExploreTotalLabel = (total) => {
    const totalLabel = explorePage.querySelector('[data-explore-total-label]');
    if (totalLabel) totalLabel.textContent = `${Number(total) || 0} ${Number(total) === 1 ? 'work' : 'works'}`;
  };

  const announceExploreResults = (total) => {
    exploreAnnouncer.textContent = `${Number(total) || 0} ${Number(total) === 1 ? 'artwork' : 'artworks'} found.`;
  };

  const loadExplore = async (url, options = {}) => {
    const { push = true, scroll = true } = options;
    const currentResults = getExploreResults();
    if (!currentResults) {
      window.location.assign(url.toString());
      return;
    }

    if (exploreRequest) exploreRequest.abort();
    const controller = new AbortController();
    exploreRequest = controller;
    const fetchUrl = new URL(url);
    fetchUrl.searchParams.set('partial', '1');
    currentResults.classList.add('is-loading');
    currentResults.setAttribute('aria-busy', 'true');
    const skeleton = currentResults.querySelector('[data-explore-skeleton]');
    if (skeleton) skeleton.hidden = false;

    try {
      const response = await fetch(fetchUrl, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error('Explore request failed');

      const html = await response.text();
      const documentFragment = new DOMParser().parseFromString(html, 'text/html');
      const incomingResults = documentFragment.querySelector('[data-explore-results]');
      if (!incomingResults) throw new Error('Explore response was incomplete');

      exploreState = getExploreStateFromUrl(url);
      currentResults.replaceWith(incomingResults);
      syncExploreControls();
      updateExploreTotalLabel(incomingResults.dataset.total);
      announceExploreResults(incomingResults.dataset.total);
      bindExploreMedia(incomingResults);
      bindQuickActions();

      if (push) window.history.pushState({ explore: true }, '', url.toString());
      if (scroll) exploreGallery.scrollIntoView({ behavior: exploreReducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    } catch (error) {
      if (error.name === 'AbortError') return;
      currentResults.classList.remove('is-loading');
      currentResults.setAttribute('aria-busy', 'false');
      if (skeleton) skeleton.hidden = true;
      window.location.assign(url.toString());
    } finally {
      if (exploreRequest === controller) exploreRequest = null;
    }
  };

  exploreForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(exploreForm);
    loadExplore(buildExploreUrl({
      q: String(formData.get('q') || '').trim(),
      category: String(formData.get('category') || 'all'),
      sort: String(formData.get('sort') || 'latest')
    }));
  }, { signal: pageSignal });

  explorePage.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const moreButton = target.closest('[data-explore-more]');
    if (moreButton) {
      const results = getExploreResults();
      const nextUrl = moreButton.dataset.nextUrl;
      if (!results || !nextUrl || moreButton.disabled) return;

      const fetchUrl = new URL(nextUrl, window.location.origin);
      fetchUrl.searchParams.set('partial', '1');
      const originalMarkup = moreButton.innerHTML;
      moreButton.disabled = true;
      moreButton.querySelector('span').textContent = 'Turning the page...';

      try {
        const response = await fetch(fetchUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!response.ok) throw new Error('Could not load more artwork');

        const html = await response.text();
        const documentFragment = new DOMParser().parseFromString(html, 'text/html');
        const incomingResults = documentFragment.querySelector('[data-explore-results]');
        const incomingMasonry = incomingResults?.querySelector('[data-explore-masonry]');
        const currentMasonry = results.querySelector('[data-explore-masonry]');
        if (!incomingResults || !incomingMasonry || !currentMasonry) throw new Error('Could not load more artwork');

        const existingIds = new Set([...currentMasonry.querySelectorAll('[data-explore-card]')].map((card) => card.dataset.artworkId));
        incomingMasonry.querySelectorAll('[data-explore-card]').forEach((card) => {
          if (!existingIds.has(card.dataset.artworkId)) currentMasonry.appendChild(card);
        });

        const incomingMeta = incomingResults.querySelector('[data-explore-meta]');
        const currentMeta = results.querySelector('[data-explore-meta]');
        if (incomingMeta && currentMeta) currentMeta.replaceWith(incomingMeta);

        results.querySelector('.studio-explore-more-wrap')?.remove();
        const incomingMore = incomingResults.querySelector('[data-explore-more]');
        if (incomingMore) {
          const nextWrap = document.createElement('div');
          nextWrap.className = 'studio-explore-more-wrap';
          nextWrap.appendChild(incomingMore);
          results.appendChild(nextWrap);
        } else {
          const endNote = incomingResults.querySelector('.studio-explore-end-note');
          if (endNote) results.appendChild(endNote);
        }

        results.dataset.page = incomingResults.dataset.page;
        results.dataset.total = incomingResults.dataset.total;
        results.dataset.hasMore = incomingResults.dataset.hasMore;
        updateExploreTotalLabel(incomingResults.dataset.total);
        announceExploreResults(incomingResults.dataset.total);
        bindExploreMedia(currentMasonry);
        bindQuickActions();
      } catch (error) {
        moreButton.innerHTML = originalMarkup;
        moreButton.disabled = false;
        exploreAnnouncer.textContent = 'More artwork could not be loaded. Please try again.';
      }

      return;
    }

    const link = target.closest('a[data-explore-link]');
    if (!link) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;

    const url = new URL(link.href, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== '/explore') return;
    event.preventDefault();
    loadExplore(url);
  }, { signal: pageSignal });

  document.addEventListener('artwork:like-changed', (event) => {
    explorePage.querySelectorAll('[data-explore-likes-for]').forEach((label) => {
      if (label.dataset.exploreLikesFor === String(event.detail.id)) label.textContent = String(event.detail.likes);
    });
  }, { signal: pageSignal });

  document.addEventListener('artwork:bookmark-changed', (event) => {
    explorePage.querySelectorAll('[data-explore-card]').forEach((card) => {
      if (card.dataset.artworkId !== String(event.detail.id)) return;
      const button = card.querySelector('.studio-explore-save button');
      if (button) button.setAttribute('aria-label', event.detail.saved ? 'Remove from saved artworks' : 'Save artwork');
    });
  }, { signal: pageSignal });

  bindExploreMedia();
  syncExploreControls();
};

const initHomePage = () => {
  const homePage = document.querySelector('[data-sketch-home]');
  if (!homePage) return;

  const homeReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionTargets = [...homePage.querySelectorAll('[data-motion]')];
  if (motionTargets.length && !homeReducedMotion.matches && 'IntersectionObserver' in window) {
    motionTargets.forEach((target, index) => {
      target.classList.add('motion-pending');
      target.style.setProperty('--motion-delay', `${(index % 4) * 70}ms`);
    });

    const motionObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('motion-pending');
        entry.target.classList.add('is-motion-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
    registerPageCleanup(() => motionObserver.disconnect());

    motionTargets.forEach((target) => motionObserver.observe(target));
  } else {
    motionTargets.forEach((target) => target.classList.remove('motion-pending'));
  }

  homePage.querySelectorAll('a[href^="#"]').forEach((link) => {
    const hash = link.getAttribute('href');
    if (!hash || hash === '#') return;
    const destination = document.querySelector(hash);
    if (!destination) return;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      destination.scrollIntoView({
        behavior: homeReducedMotion.matches ? 'auto' : 'smooth',
        block: 'start'
      });
      window.history.replaceState(null, '', hash);
    });
  });
};

const initPage = () => {
  bindQuickActions();
  bindPortfolioCollection();
  bindArtworkEditPreview();
  bindArtworkDeleteDialog();
  bindProfileFlash();
  bindCommentForms();
  bindShareButtons();
  bindScrollReveal();

  const heroArtwork = document.querySelector('[data-home-feature-image]');
  bindArtworkImageFallback(heroArtwork, heroArtwork?.closest('.home-hero-feature'));
  document.querySelectorAll('img[data-fallback-src]').forEach((image) => {
    bindArtworkImageFallback(image, image.closest('.art-card-media, .studio-explore-card, .studio-explore-spotlight, .book-artwork-link, .home-hero-feature, .pf-art-image'));
  });

  bindFlipbook();
  markCurrentNavigation();
  revealArtworkCards();
  initStudioDashboard();
  initUploadPage();
  initExplorePage();
  initHomePage();
};

initPage();
window.ArtSpacePage = {
  init: initPage,
  cleanup: runPageCleanups,
  markCurrentNavigation
};

(() => {
  const topbar = document.querySelector('[data-topbar]');
  if (!topbar) return;

  const mobileQuery = window.matchMedia('(max-width: 767px)');
  const tabletDrawerQuery = window.matchMedia('(max-width: 1023px)');
  const nav = topbar.querySelector('#primary-nav');
  const navToggles = Array.from(topbar.querySelectorAll('[data-nav-toggle]'));
  const navToggle = navToggles[0] || null;
  const navClose = topbar.querySelector('[data-nav-close]');
  const backdrop = topbar.querySelector('[data-nav-backdrop]');
  const profileWraps = Array.from(topbar.querySelectorAll('[data-profile-menu-wrap]'));
  const profileButtons = Array.from(topbar.querySelectorAll('[data-profile-menu-button]'));
  const profileMenu = topbar.querySelector('[data-profile-menu]');
  const searchForm = topbar.querySelector('[data-nav-search]');
  const searchInput = topbar.querySelector('#nav-search-input');
  const searchToggles = Array.from(topbar.querySelectorAll('[data-search-toggle]'));
  const searchClear = topbar.querySelector('[data-search-clear]');
  const navInk = topbar.querySelector('[data-nav-ink]');
  const bottomNav = document.querySelector('[data-mobile-bottom-nav]');
  const currentUsername = document.querySelector('meta[name="current-username"]')?.content || '';

  let lastFocused = null;
  let keyboardBlurTimer = 0;

  const updateBottomNavActive = () => {
    if (!bottomNav) return;

    const path = window.location.pathname;
    const ownProfilePath = currentUsername ? `/profile/${encodeURIComponent(currentUsername)}` : '';
    const active = {
      home: path === '/',
      explore: path.startsWith('/explore') || path.startsWith('/search'),
      create: path.startsWith('/upload'),
      community: path.startsWith('/community'),
      profile:
        path === '/profile/edit'
        || path.startsWith('/dashboard')
        || path.startsWith('/messages')
        || path.startsWith('/notifications')
        || path.startsWith('/admin')
        || (path.startsWith('/profile/') && (!ownProfilePath || path === ownProfilePath))
    };

    bottomNav.querySelectorAll('[data-mbn-key]').forEach((item) => {
      const isActive = Boolean(active[item.dataset.mbnKey]);
      item.classList.toggle('is-active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  };

  const isFormField = (target) => {
    const element = target instanceof Element ? target : null;
    return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
  };

  const closeMobileKeyboardState = () => {
    window.clearTimeout(keyboardBlurTimer);
    keyboardBlurTimer = 0;
    if (!isFormField(document.activeElement)) {
      document.body.classList.remove('mobile-keyboard-open');
    }
  };

  document.addEventListener('focusin', (event) => {
    if (!mobileQuery.matches || !isFormField(event.target)) return;
    window.clearTimeout(keyboardBlurTimer);
    document.body.classList.add('mobile-keyboard-open');
  });

  document.addEventListener('focusout', (event) => {
    if (!isFormField(event.target)) return;
    window.clearTimeout(keyboardBlurTimer);
    keyboardBlurTimer = window.setTimeout(closeMobileKeyboardState, 160);
  });

  updateBottomNavActive();

  const updateNavIndicator = () => {
    if (!navInk) return;
    const currentLink = nav?.querySelector('.nav-link-group a.is-current');
    if (!currentLink || tabletDrawerQuery.matches || nav?.classList.contains('is-open')) {
      navInk.classList.remove('is-visible');
      return;
    }
    navInk.style.left = `${currentLink.offsetLeft}px`;
    navInk.style.width = `${currentLink.offsetWidth}px`;
    navInk.classList.add('is-visible');
  };

  const setDrawerState = (open, restoreFocus = true) => {
    if (!nav) return;

    nav.classList.toggle('is-open', open);
    navToggles.forEach((toggle) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    document.body.classList.toggle('nav-open', open && tabletDrawerQuery.matches);
    updateNavIndicator();

    if (open) {
      closeProfileMenu(false);
      setSearchOpen(false, false);
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      window.setTimeout(() => {
        if (nav.classList.contains('is-open')) navClose?.focus({ preventScroll: true });
      }, 80);
    } else if (restoreFocus) {
      const focusTarget = lastFocused && lastFocused !== document.body ? lastFocused : navToggle;
      focusTarget?.focus({ preventScroll: true });
      lastFocused = null;
    }
  };

  const focusableInDrawer = () =>
    Array.from(
      nav?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') || []
    ).filter((element) => element.getClientRects().length > 0);

  navToggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const isOpen = nav?.classList.contains('is-open');
      setDrawerState(!isOpen);
    });
  });

  navClose?.addEventListener('click', () => setDrawerState(false));
  backdrop?.addEventListener('click', () => setDrawerState(false));

  nav?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a');
    if (link && nav.classList.contains('is-open') && tabletDrawerQuery.matches) {
      setDrawerState(false, false);
    }
  });

  const setProfileOpen = (open) => {
    if (!profileMenu) return;

    profileWraps.forEach((wrap) => wrap.classList.toggle('is-open', open));
    profileButtons.forEach((button) => button.setAttribute('aria-expanded', String(open)));
    profileMenu.setAttribute('aria-hidden', String(!open));
  };

  const closeProfileMenu = (restoreFocus = true) => {
    const wasOpen = profileWraps.some((wrap) => wrap.classList.contains('is-open'));
    setProfileOpen(false);
    if (wasOpen && restoreFocus) profileButtons[0]?.focus({ preventScroll: true });
  };

  const menuItems = () => Array.from(profileMenu?.querySelectorAll('[role="menuitem"]') || []);

  profileButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const willOpen = !profileWraps.some((wrap) => wrap.classList.contains('is-open'));
      if (willOpen) setSearchOpen(false, false);
      setProfileOpen(willOpen);
    });

    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      setProfileOpen(true);
      const items = menuItems();
      if (!items.length) return;
      (event.key === 'ArrowDown' ? items[0] : items[items.length - 1]).focus();
    });
  });

  profileMenu?.addEventListener('keydown', (event) => {
    const items = menuItems();
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      closeProfileMenu();
      return;
    }

    if (event.key === 'Tab') {
      closeProfileMenu(false);
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;

    event.preventDefault();
    let nextIndex = currentIndex;

    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;

    items[nextIndex]?.focus();
  });

  profileMenu?.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) setProfileOpen(false);
  });

  const setSearchOpen = (open, focusInput = true) => {
    topbar.classList.toggle('is-search-open', Boolean(open));
    searchToggles.forEach((toggle) => {
      toggle.setAttribute('aria-expanded', String(Boolean(open)));
      toggle.setAttribute('aria-label', open ? 'Close search' : 'Open search');
    });

    if (open) {
      closeProfileMenu(false);
      if (nav?.classList.contains('is-open')) setDrawerState(false, false);
      if (focusInput) {
        window.setTimeout(() => {
          if (topbar.classList.contains('is-search-open')) searchInput?.focus({ preventScroll: true });
        }, 40);
      }
    }
  };

  const syncSearchClear = () => {
    if (searchClear && searchInput) searchClear.hidden = searchInput.value.length === 0;
  };

  searchToggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      setSearchOpen(!topbar.classList.contains('is-search-open'));
    });
  });

  searchInput?.addEventListener('input', syncSearchClear);
  syncSearchClear();

  searchClear?.addEventListener('click', () => {
    if (!searchInput) return;
    searchInput.value = '';
    syncSearchClear();
    searchInput.focus({ preventScroll: true });
  });

  searchForm?.addEventListener('submit', (event) => {
    if (!searchInput) return;
    const value = searchInput.value.trim();
    searchInput.value = value;
    if (!value) {
      event.preventDefault();
      searchInput.focus({ preventScroll: true });
    }
  });

  const anyProfileOpen = () => profileWraps.some((wrap) => wrap.classList.contains('is-open'));

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Node)) return;
    if (anyProfileOpen() && !profileWraps.some((wrap) => wrap.contains(event.target))) {
      setProfileOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (anyProfileOpen()) {
      event.preventDefault();
      closeProfileMenu();
      return;
    }

    if (nav?.classList.contains('is-open')) {
      event.preventDefault();
      setDrawerState(false);
      return;
    }

    if (topbar.classList.contains('is-search-open')) {
      event.preventDefault();
      setSearchOpen(false, false);
      searchToggles[0]?.focus({ preventScroll: true });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !nav?.classList.contains('is-open')) return;

    const focusable = focusableInDrawer();
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !nav.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !nav.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });

  const handleViewportChange = () => {
    if (!tabletDrawerQuery.matches) {
      if (nav?.classList.contains('is-open')) setDrawerState(false, false);
      document.body.classList.remove('nav-open');
      topbar.classList.remove('is-search-open');
      searchToggles.forEach((toggle) => {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open search');
      });
    }
    if (!mobileQuery.matches) {
      document.body.classList.remove('mobile-keyboard-open');
    }
    updateNavIndicator();
  };

  [mobileQuery, tabletDrawerQuery].forEach((query) => {
    if (typeof query.addEventListener === 'function') query.addEventListener('change', handleViewportChange);
    else if (typeof query.addListener === 'function') query.addListener(handleViewportChange);
  });

  const handleScroll = () => {
    topbar.classList.toggle('is-scrolled', window.scrollY > 8);
  };

  handleScroll();
  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', updateNavIndicator, { passive: true });
  window.addEventListener('artspace:navigation', () => {
    document.body.classList.remove('mobile-keyboard-open');
    window.requestAnimationFrame(() => {
      updateNavIndicator();
      updateBottomNavActive();
    });
  });
  updateNavIndicator();
})();

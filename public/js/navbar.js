(() => {
  const topbar = document.querySelector('[data-topbar]');
  if (!topbar) return;

  const mobileQuery = window.matchMedia('(max-width: 1080px)');
  const nav = topbar.querySelector('#primary-nav');
  const navToggle = topbar.querySelector('[data-nav-toggle]');
  const navClose = topbar.querySelector('[data-nav-close]');
  const backdrop = topbar.querySelector('[data-nav-backdrop]');
  const profileWrap = topbar.querySelector('[data-profile-menu-wrap]');
  const profileButton = topbar.querySelector('[data-profile-menu-button]');
  const profileMenu = topbar.querySelector('[data-profile-menu]');
  const searchForm = topbar.querySelector('[data-nav-search]');
  const searchInput = topbar.querySelector('#nav-search-input');
  const searchToggle = topbar.querySelector('[data-search-toggle]');
  const searchClear = topbar.querySelector('[data-search-clear]');

  let lastFocused = null;

  const setDrawerState = (open, restoreFocus = true) => {
    if (!nav || !navToggle) return;

    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('nav-open', open && mobileQuery.matches);

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

  navToggle?.addEventListener('click', () => {
    const isOpen = nav?.classList.contains('is-open');
    setDrawerState(!isOpen);
  });

  navClose?.addEventListener('click', () => setDrawerState(false));
  backdrop?.addEventListener('click', () => setDrawerState(false));

  nav?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a');
    if (link && nav.classList.contains('is-open') && mobileQuery.matches) {
      setDrawerState(false, false);
    }
  });

  const setProfileOpen = (open) => {
    if (!profileWrap || !profileButton || !profileMenu) return;

    profileWrap.classList.toggle('is-open', open);
    profileButton.setAttribute('aria-expanded', String(open));
    profileMenu.setAttribute('aria-hidden', String(!open));
  };

  const closeProfileMenu = (restoreFocus = true) => {
    const wasOpen = profileWrap?.classList.contains('is-open');
    setProfileOpen(false);
    if (wasOpen && restoreFocus) profileButton?.focus({ preventScroll: true });
  };

  const menuItems = () => Array.from(profileMenu?.querySelectorAll('[role="menuitem"]') || []);

  profileButton?.addEventListener('click', () => {
    const willOpen = !profileWrap.classList.contains('is-open');
    if (willOpen) setSearchOpen(false, false);
    setProfileOpen(willOpen);
  });

  profileButton?.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setProfileOpen(true);
    const items = menuItems();
    if (!items.length) return;
    (event.key === 'ArrowDown' ? items[0] : items[items.length - 1]).focus();
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
    searchToggle?.setAttribute('aria-expanded', String(Boolean(open)));
    searchToggle?.setAttribute('aria-label', open ? 'Close search' : 'Open search');

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

  searchToggle?.addEventListener('click', () => {
    setSearchOpen(!topbar.classList.contains('is-search-open'));
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

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Node)) return;
    if (profileWrap?.classList.contains('is-open') && !profileWrap.contains(event.target)) {
      setProfileOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (profileWrap?.classList.contains('is-open')) {
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
      searchToggle?.focus({ preventScroll: true });
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
    if (!mobileQuery.matches) {
      if (nav?.classList.contains('is-open')) setDrawerState(false, false);
      document.body.classList.remove('nav-open');
      topbar.classList.remove('is-search-open');
      searchToggle?.setAttribute('aria-expanded', 'false');
      searchToggle?.setAttribute('aria-label', 'Open search');
    }
  };

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', handleViewportChange);
  } else if (typeof mobileQuery.addListener === 'function') {
    mobileQuery.addListener(handleViewportChange);
  }

  const handleScroll = () => {
    topbar.classList.toggle('is-scrolled', window.scrollY > 8);
  };

  handleScroll();
  window.addEventListener('scroll', handleScroll, { passive: true });
})();

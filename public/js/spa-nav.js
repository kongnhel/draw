(() => {
  const routeView = document.querySelector('[data-route-view]');
  const loader = document.querySelector('[data-route-loader]');
  const announcer = document.querySelector('[data-route-announcer]');
  if (!routeView) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const loadedVendors = new Set(
    Array.from(document.querySelectorAll('script[src]'))
      .map((script) => new URL(script.getAttribute('src'), window.location.href).href)
      .filter((src) => src.includes('/vendor/'))
  );
  const filePattern = /\.(?:avif|bmp|css|gif|ico|jpe?g|js|json|map|md|mp3|mp4|ogg|pdf|png|svg|txt|wav|webm|webp|woff2?|zip)(?:$|\?)/i;
  const managedState = (scrollY) => ({ artspace: true, scrollY: Math.max(0, Math.round(Number(scrollY) || 0)) });
  const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  let navigationId = 0;
  let activeController = null;
  let loaderTimer = 0;
  let isLoaderVisible = false;

  const showLoader = () => {
    window.clearTimeout(loaderTimer);
    loaderTimer = 0;
    if (!loader || isLoaderVisible) return;
    loader.hidden = false;
    isLoaderVisible = true;
    window.requestAnimationFrame(() => loader.classList.add('is-visible'));
  };

  const hideLoader = () => {
    window.clearTimeout(loaderTimer);
    loaderTimer = 0;
    if (!loader || !isLoaderVisible) return;
    loader.classList.remove('is-visible');
    isLoaderVisible = false;
    window.setTimeout(() => {
      if (!isLoaderVisible) loader.hidden = true;
    }, reducedMotion.matches ? 0 : 220);
  };

  const scheduleLoader = () => {
    window.clearTimeout(loaderTimer);
    loaderTimer = window.setTimeout(showLoader, 180);
  };

  const saveScrollPosition = () => {
    try {
      const nextState = { ...(history.state || {}), ...managedState(window.scrollY) };
      history.replaceState(nextState, '', window.location.href);
    } catch (error) {
    }
  };

  const closePersistentOverlays = () => {
    const viewer = document.querySelector('[data-art-viewer]');
    if (viewer?.open && typeof viewer.close === 'function') viewer.close();

    const topbar = document.querySelector('[data-topbar]');
    topbar?.classList.remove('is-open', 'is-search-open');

    const navToggle = topbar?.querySelector('[data-nav-toggle]');
    navToggle?.setAttribute('aria-expanded', 'false');
    navToggle?.setAttribute('aria-label', 'Open menu');

    document.body.classList.remove('nav-open', 'ae-modal-open', 'art-viewer-open', 'studio-dialog-open');
  };

  const syncDocumentHead = (doc) => {
    const nextTitle = doc.title && doc.title.trim();
    if (nextTitle) document.title = nextTitle;

    const nextDescription = doc.querySelector('meta[name="description"]')?.getAttribute('content');
    const currentDescription = document.querySelector('meta[name="description"]');
    if (nextDescription && currentDescription) currentDescription.setAttribute('content', nextDescription);
  };

  const syncBodyClass = (doc) => {
    const incomingClass = doc.body?.getAttribute('class')?.trim() || '';
    const nextClasses = new Set(incomingClass.split(/\s+/).filter(Boolean));
    if (document.body.classList.contains('pencil-on')) nextClasses.add('pencil-on');
    document.body.className = Array.from(nextClasses).join(' ');
  };

  const getHashTarget = (hash) => {
    if (!hash || hash === '#') return null;
    let id;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch (error) {
      id = hash.slice(1);
    }
    return document.getElementById(id);
  };

  const scrollToHash = (hash, behavior) => {
    const target = getHashTarget(hash);
    if (!target) return false;
    target.scrollIntoView({ behavior, block: 'start' });
    return true;
  };

  const restoreScroll = (scrollY, hash) => {
    if (hash) {
      const didScrollToHash = scrollToHash(hash, reducedMotion.matches ? 'auto' : 'smooth');
      if (didScrollToHash) return;
    }
    window.scrollTo({ top: Math.max(0, Number(scrollY) || 0), left: 0, behavior: 'auto' });
  };

  const isNavigableUrl = (url) => {
    if (url.origin !== window.location.origin) return false;
    if (filePattern.test(url.pathname)) return false;
    if (url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/audio/')) return false;
    if (url.pathname === '/logout') return false;
    return true;
  };

  const isSamePathWithHash = (url) => {
    return url.pathname === window.location.pathname
      && url.search === window.location.search
      && Boolean(url.hash);
  };

  const loadScript = (src) => new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.remove();
      resolve(true);
    };
    script.onerror = () => {
      script.remove();
      resolve(false);
    };
    document.body.appendChild(script);
  });

  const loadPageScripts = async (scripts) => {
    for (const script of scripts) {
      const url = new URL(script.src, window.location.href).href;
      if (url.includes('/vendor/')) {
        if (loadedVendors.has(url)) continue;
        const loaded = await loadScript(url);
        if (loaded) loadedVendors.add(url);
        continue;
      }
      await loadScript(url);
    }
  };

  const parseHtml = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('parsererror')) throw new Error('Could not parse server response');
    return doc;
  };

  const navigate = async (rawUrl, options = {}) => {
    const id = ++navigationId;
    const startedAt = window.performance.now();
    const isPopState = options.source === 'pop';
    let target;

    try {
      target = new URL(rawUrl, window.location.href);
    } catch (error) {
      window.location.assign(rawUrl);
      return;
    }

    if (!isPopState && target.href === window.location.href) return;

    if (!isPopState && isSamePathWithHash(target)) {
      scrollToHash(target.hash, reducedMotion.matches ? 'auto' : 'smooth');
      return;
    }

    if ((window.__artspaceUploading || window.__artspaceUnsavedChanges) && options.source !== 'pop') {
      const shouldLeave = window.confirm('You have unsaved changes. Leave this page?');
      if (!shouldLeave) return;
    }

    saveScrollPosition();
    closePersistentOverlays();

    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;

    routeView.classList.add('is-route-leaving');
    document.documentElement.classList.add('route-busy');
    scheduleLoader();

    try {
      const response = await fetch(target.href, {
        credentials: 'same-origin',
        cache: options.source === 'refresh' ? 'no-store' : 'default',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'X-Requested-With': 'XMLHttpRequest'
        },
        signal: controller.signal
      });

      const contentType = response.headers.get('content-type') || '';
      const looksLikeHtml = !contentType || contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
      const html = looksLikeHtml ? await response.text() : '';

      if (id !== navigationId) return;

      const finalUrl = new URL(response.url || target.href, window.location.origin);
      if (response.redirected && finalUrl.pathname === '/login') {
        hideLoader();
        routeView.classList.remove('is-route-leaving');
        document.documentElement.classList.remove('route-busy');
        window.location.assign(finalUrl.href);
        return;
      }

      if (!looksLikeHtml || (!response.ok && !html)) {
        hideLoader();
        routeView.classList.remove('is-route-leaving');
        document.documentElement.classList.remove('route-busy');
        window.location.assign(finalUrl.href);
        return;
      }

      const doc = parseHtml(html);
      const incoming = doc.querySelector('[data-route-view]');
      if (!incoming) throw new Error('Server response did not include the route shell');

      const pageScripts = Array.from(incoming.querySelectorAll('script[src]')).map((script) => ({
        src: script.getAttribute('src')
      }));

      window.ArtSpacePage?.cleanup?.();
      window.__artspaceUnsavedChanges = false;

      const leaveDuration = reducedMotion.matches ? 0 : 180;
      const remainingLeaveTime = Math.max(0, leaveDuration - (window.performance.now() - startedAt));
      if (remainingLeaveTime > 0) await wait(remainingLeaveTime);
      if (id !== navigationId) return;

      routeView.innerHTML = incoming.innerHTML;
      routeView.querySelectorAll('script').forEach((script) => script.remove());

      syncDocumentHead(doc);
      syncBodyClass(doc);

      const historyUrl = response.redirected ? finalUrl : target;
      const searchInput = document.querySelector('#nav-search-input');
      if (searchInput) {
        searchInput.value = historyUrl.searchParams.get('q') || '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (isPopState) {
        try {
          history.replaceState({ ...(history.state || {}), ...managedState(options.scrollY || 0) }, '', historyUrl.href);
        } catch (error) {
        }
      } else if (options.replace) {
        history.replaceState(managedState(0), '', historyUrl.href);
      } else {
        history.pushState(managedState(0), '', historyUrl.href);
      }

      await loadPageScripts(pageScripts);
      if (id !== navigationId) return;

      window.ArtSpacePage?.init?.();
      const restoreTarget = {
        y: isPopState ? options.scrollY : 0,
        hash: target.hash
      };
      restoreScroll(restoreTarget.y, restoreTarget.hash);
      const restoreStartedAt = window.performance.now();
      const retryScrollRestore = () => {
        if (id !== navigationId) return;
      restoreScroll(restoreTarget.y, restoreTarget.hash);
      if (!restoreTarget.hash && restoreTarget.y === 0) {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
      }
        const needsRetry = restoreTarget.hash
          ? !getHashTarget(restoreTarget.hash)
          : window.scrollY + 2 < restoreTarget.y;
        if (needsRetry && window.performance.now() - restoreStartedAt < 1200) {
          window.setTimeout(retryScrollRestore, 120);
        }
      };
      window.requestAnimationFrame(retryScrollRestore);

      if (announcer) announcer.textContent = `Loaded ${document.title}`;

      routeView.classList.remove('is-route-leaving');
      routeView.classList.add('is-route-entering');
      routeView.focus({ preventScroll: true });

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => routeView.classList.remove('is-route-entering'));
      });

      hideLoader();
      document.documentElement.classList.remove('route-busy');
      window.dispatchEvent(new CustomEvent('artspace:navigation', {
        detail: { url: historyUrl.href, title: document.title }
      }));
    } catch (error) {
      hideLoader();
      document.documentElement.classList.remove('route-busy');
      routeView.classList.remove('is-route-leaving', 'is-route-entering');
      if (error?.name === 'AbortError' || id !== navigationId) return;
      window.location.assign(target.href);
    } finally {
      if (activeController === controller) activeController = null;
    }
  };

  const shouldHandleClick = (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor || event.defaultPrevented) return null;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    if (anchor.target && anchor.target.toLowerCase() !== '_self') return null;
    if (anchor.relList?.contains('external')) return null;
    if (anchor.hasAttribute('download') || anchor.dataset.noSpa === 'true') return null;
    if (anchor.hasAttribute('data-explore-link')) return null;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return { anchor, url: new URL(href || '#', window.location.href), hashOnly: true };
    if (/^(?:mailto|tel|sms|javascript):/i.test(href)) return null;

    let url;
    try {
      url = new URL(href, window.location.href);
    } catch (error) {
      return null;
    }

    if (!isNavigableUrl(url)) return null;
    return { anchor, url, hashOnly: false };
  };

  document.addEventListener('click', (event) => {
    const match = shouldHandleClick(event);
    if (!match) return;

    const { url, hashOnly } = match;
    event.preventDefault();

    if (hashOnly || isSamePathWithHash(url)) {
      if (scrollToHash(url.hash, reducedMotion.matches ? 'auto' : 'smooth')) {
        history.pushState(managedState(window.scrollY), '', url.href);
      }
      return;
    }

    navigate(url.href, { source: 'click' });
  });

  window.addEventListener('popstate', (event) => {
    navigate(window.location.href, {
      source: 'pop',
      scrollY: event.state?.artspaceScrollY ?? event.state?.scrollY ?? 0
    });
  });

  window.addEventListener('beforeunload', saveScrollPosition);

  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    if (!history.state?.artspace) history.replaceState(managedState(window.scrollY), '', window.location.href);
  } catch (error) {
  }

  window.ArtSpaceNavigation = { navigate, refresh: () => navigate(window.location.href, { source: 'refresh', replace: true }) };
})();

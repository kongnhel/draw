(() => {
  const consent = document.querySelector('meta[name="ads-consent"]')?.content || 'unset';
  const client = document.querySelector('meta[name="adsense-client"]')?.content || '';
  const scriptUrl = document.querySelector('meta[name="adsense-script"]')?.content || '';
  if (consent !== 'granted' || !client) return;

  const ADSENSE_SELECTOR = '#artspace-adsense-script';
  let scriptPromise = null;

  const ensureAdsenseScript = () => {
    if (scriptPromise) return scriptPromise;

    const existing = document.querySelector(ADSENSE_SELECTOR);
    if (existing) {
      scriptPromise = Promise.resolve(existing);
      return scriptPromise;
    }

    if (!scriptUrl) {
      scriptPromise = Promise.resolve(null);
      return scriptPromise;
    }

    scriptPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.id = 'artspace-adsense-script';
      script.src = scriptUrl;
      script.addEventListener('load', () => resolve(script), { once: true });
      script.addEventListener('error', () => resolve(null), { once: true });
      document.head.appendChild(script);
    });

    return scriptPromise;
  };

  const watchUnit = (unit) => {
    const container = unit.closest('[data-ad-unit]');
    if (!container) return;

    const settle = () => {
      if (!unit.isConnected) return;
      const status = unit.getAttribute('data-ad-status');
      if (status === 'filled') {
        container.classList.add('is-filled');
        container.classList.remove('is-unfilled');
        return;
      }
      if (status === 'unfilled') {
        container.classList.remove('is-filled');
        container.classList.add('is-unfilled');
      }
    };

    const observer = new MutationObserver(settle);
    observer.observe(unit, { attributes: true, attributeFilter: ['data-ad-status'] });

    window.setTimeout(() => {
      observer.disconnect();
      if (!unit.getAttribute('data-ad-status') && unit.isConnected) {
        container.classList.add('is-unfilled');
      } else {
        settle();
      }
    }, 10000);
  };

  const isAdEligiblePage = () => {
    const path = window.location.pathname;
    if (path === '/' || path === '/explore') return true;
    if (/^\/art\/\d+\/?$/.test(path)) return true;
    if (/^\/profile\/[^/]+\/?$/.test(path) && path !== '/profile/edit' && path !== '/profile/edit/') {
      const tab = new URLSearchParams(window.location.search).get('tab');
      return tab !== 'saved' && tab !== 'pinned';
    }
    return false;
  };

  const initAds = () => {
    if (!isAdEligiblePage()) return;

    const units = [...document.querySelectorAll('ins.adsbygoogle[data-ad-slot]')]
      .filter((unit) => unit.dataset.adsInitialized !== 'true');

    ensureAdsenseScript().then(() => {
      if (!units.length) return;
      units.forEach((unit) => {
        if (!unit.isConnected || unit.dataset.adsInitialized === 'true') return;
        unit.dataset.adsInitialized = 'true';
        try {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
          watchUnit(unit);
        } catch (error) {
          unit.closest('[data-ad-unit]')?.classList.add('is-unfilled');
        }
      });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAds, { once: true });
  } else {
    initAds();
  }

  window.addEventListener('artspace:navigation', () => window.requestAnimationFrame(initAds));
})();

/* ==========================================================================
   Sketchbook Interactions — Artwork Magnifier + Global Click Sounds
   Magnifier: exact source-region zoom at 2x (1.5x-3x via data-magnifier-zoom).
   Sounds: Web Audio synthesized cues, on by default unless muted, toggled anywhere via
   [data-sound-toggle] (footer) and the viewer toolbar [data-viewer-sound].
   Shared preference key with the viewer: "artspace-art-sound".
   ========================================================================== */
(() => {
  'use strict';

  const SOUND_PREF_KEY = 'artspace-art-sound';
  const isSoundOn = () => {
    try { return localStorage.getItem(SOUND_PREF_KEY) !== 'off'; } catch { return true; }
  };
  const setSoundPref = (on) => {
    try { localStorage.setItem(SOUND_PREF_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /* ==========================================================================
     SECTION 1 — Web Audio synthesized cues (no extra files, tiny footprint)
     ========================================================================== */

  let audioContext = null;
  let noiseBuffer = null;
  let lastPlayedAt = 0;

  const getAudioContext = () => {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) return null;
    if (!audioContext || audioContext.state === 'closed') audioContext = new Constructor();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  };

  const getNoiseBuffer = (ctx) => {
    if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
      const length = Math.floor(ctx.sampleRate * 0.5);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    return noiseBuffer;
  };

  const playNoiseCue = (ctx, { duration, type, frequency, q, gain, sweepTo }) => {
    const source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
    filter.Q.setValueAtTime(q || 0.9, ctx.currentTime);
    const volume = ctx.createGain();
    volume.gain.setValueAtTime(0.0001, ctx.currentTime);
    volume.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.012);
    volume.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(volume);
    volume.connect(ctx.destination);
    source.start(ctx.currentTime);
    source.stop(ctx.currentTime + duration + 0.02);
  };

  const playToneCue = (ctx, { type, start, end, duration, gain }) => {
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(end, ctx.currentTime + duration);
    const volume = ctx.createGain();
    volume.gain.setValueAtTime(0.0001, ctx.currentTime);
    volume.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.014);
    volume.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    oscillator.connect(volume);
    volume.connect(ctx.destination);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration + 0.02);
  };

  const CUES = {
    tap: (ctx) => playNoiseCue(ctx, { duration: 0.07, type: 'bandpass', frequency: 1750, sweepTo: 850, q: 1.1, gain: 0.055 }),
    click: (ctx) => {
      playToneCue(ctx, { type: 'triangle', start: 720, end: 480, duration: 0.055, gain: 0.032 });
      playNoiseCue(ctx, { duration: 0.035, type: 'highpass', frequency: 2600, q: 0.7, gain: 0.02 });
    },
    pop: (ctx) => playToneCue(ctx, { type: 'sine', start: 470, end: 700, duration: 0.095, gain: 0.05 }),
    save: (ctx) => playNoiseCue(ctx, { duration: 0.16, type: 'lowpass', frequency: 2600, sweepTo: 640, q: 0.8, gain: 0.05 }),
    artwork: (ctx) => {
      playToneCue(ctx, { type: 'sine', start: 210, end: 165, duration: 0.11, gain: 0.05 });
      playNoiseCue(ctx, { duration: 0.1, type: 'lowpass', frequency: 1050, sweepTo: 420, q: 0.9, gain: 0.04 });
    }
  };

  const playCue = (name) => {
    if (!isSoundOn()) return;
    const now = performance.now();
    if (now - lastPlayedAt < 45) return; // no machine-gun overlapping
    const cue = CUES[name];
    if (!cue) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      cue(ctx);
      lastPlayedAt = now;
    } catch {
      /* audio unavailable — site keeps working silently */
    }
  };

  /* ==========================================================================
     SECTION 2 — Global delegated click sounds
     ========================================================================== */

  /* Viewer controls carry their own sound cues in app.js — never double-play. */
  const VIEWER_OWNED_SELECTOR = '[data-viewer-like], [data-viewer-bookmark], [data-viewer-close], [data-viewer-sound], [data-viewer-zoom], [data-viewer-fullscreen], [data-viewer-effects], [data-viewer-share], [data-artwork-open], .art-viewer a[href^="/art/"], [data-book-close], [data-book-prev], [data-book-next], .book-controls';

  const EDITABLE_SELECTOR = 'input, textarea, select, option, [contenteditable="true"], [contenteditable=""]';
  const BUTTON_SELECTOR = 'button, [role="button"], input[type="submit"], input[type="button"], .btn, .action-btn, .category-pill, .sound-toggle';
  const LIKE_SELECTOR = 'form[action$="/like"]';
  const SAVE_SELECTOR = 'form[action$="/bookmark"]';

  const cueFor = (target) => {
    if (!(target instanceof Element)) return null;
    if (target.closest(VIEWER_OWNED_SELECTOR)) return null;
    if (target.closest(LIKE_SELECTOR)) return 'pop';
    if (target.closest(SAVE_SELECTOR)) return 'save';
    if (target.closest(EDITABLE_SELECTOR)) return null; // no sound while typing / focusing fields
    if (target.closest('a[href]')) return 'tap';
    if (target.closest(BUTTON_SELECTOR)) return 'click';
    return null;
  };

  document.addEventListener('click', (event) => {
    if (!isSoundOn()) return;
    if (event.defaultPrevented) return;
    const cue = cueFor(event.target);
    if (cue) playCue(cue);
  }, { passive: true });

  /* ==========================================================================
     SECTION 3 — Sound toggles (footer + viewer toolbar), shared preference
     ========================================================================== */

  const syncSoundToggles = () => {
    const on = isSoundOn();
    document.querySelectorAll('[data-sound-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', on ? 'Sound effects on, activate to turn off' : 'Sound effects off, activate to turn on');
      const label = button.querySelector('[data-sound-label]');
      if (label) label.textContent = on ? 'Sound On' : 'Sound Off';
    });
    document.querySelectorAll('[data-viewer-sound]').forEach((button) => {
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', on ? 'Mute sound' : 'Enable sound');
      button.title = on ? 'Mute sound' : 'Enable subtle sound';
    });
  };

  document.addEventListener('click', (event) => {
    const toggle = event.target instanceof Element ? event.target.closest('[data-sound-toggle]') : null;
    if (toggle) {
      const next = !isSoundOn();
      setSoundPref(next);
      syncSoundToggles();
      if (next) playCue('tap'); // audible confirmation the moment it is enabled
      return;
    }
    /* The viewer toolbar sound button toggles the same preference itself —
       just mirror its new state onto every other toggle. */
    if (event.target instanceof Element && event.target.closest('[data-viewer-sound]')) {
      window.setTimeout(syncSoundToggles, 0);
    }
  }, { passive: true });

  /* ==========================================================================
     SECTION 4 — Artwork magnifier (fine pointers only)
     ========================================================================== */

  const finePointerQuery = window.matchMedia('(pointer: fine)');
  // Every artwork / preview image on the site gets the magnifier.
  // Opt out per image with data-magnify="false"; opt in anything else with data-magnify.
  const MAGNIFY_SELECTOR = [
    '[data-magnify]',
    '.ad-artwork-open img',           // artwork detail hero
    '.art-card-media img',            // shared cards (home, explore, search, profile, related, dashboard)
    '.studio-explore-spotlight img',  // explore featured artwork
    '.studio-explore-card-image img', // explore grid cards
    '.home-artwork-frame img',        // home hero artwork
    '.studio-art-frame img',          // dashboard uploads grid
    '.studio-sketch-item img',        // dashboard recent uploads
    '.studio-collection-cover img',   // dashboard collection covers
    '.studio-clipping img',           // dashboard bookmarks
    '.studio-favorite-card img',      // dashboard liked artwork
    '.studio-page-choice-card img',   // dashboard collection page picker
    '.studio-preview-frame img',      // upload live preview
    '.studio-success-art img',        // upload success artwork
    '.auth-visual img'                // login/register gallery painting
  ].join(',');
  const LENS_SIZE = 190;
  const LENS_RADIUS = LENS_SIZE / 2;
  const MIN_IMAGE_SIDE = 48; // even small thumbnails deserve the lens

  let lens = null;
  let hint = null;
  let activeImage = null;
  let hovering = false;
  let positionFrame = 0;
  let zoomOf = new WeakMap();

  const ensureMagnifierLayers = () => {
    if (!lens) {
      lens = document.createElement('div');
      lens.className = 'art-magnifier';
      lens.setAttribute('aria-hidden', 'true');
      document.body.appendChild(lens);
    }
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'magnifier-hint';
      hint.textContent = 'Inspect Details +';
      hint.setAttribute('aria-hidden', 'true');
      document.body.appendChild(hint);
    }
    return { lens, hint };
  };

  const zoomFor = (img) => {
    if (!zoomOf.has(img)) {
      const parsed = Number.parseFloat(img.dataset.magnifierZoom || '2');
      zoomOf.set(img, Number.isFinite(parsed) ? clamp(parsed, 1.5, 3) : 2);
    }
    return zoomOf.get(img);
  };

  /* Reproduce object-fit math so the lens shows the exact source pixels. */
  const fitMetrics = (img, rect) => {
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const fit = (getComputedStyle(img).objectFit || 'fill').trim();

    if (!natW || !natH || fit === 'fill') {
      return { scaleX: rect.width / (natW || rect.width), scaleY: rect.height / (natH || rect.height), offsetX: 0, offsetY: 0, drawnW: rect.width, drawnH: rect.height };
    }

    let scale;
    if (fit === 'cover') scale = Math.max(rect.width / natW, rect.height / natH);
    else if (fit === 'none') scale = 1;
    else scale = Math.min(rect.width / natW, rect.height / natH); // contain / scale-down

    const drawnW = natW * scale;
    const drawnH = natH * scale;
    return {
      scale,
      scaleX: scale,
      scaleY: scale,
      drawnW,
      drawnH,
      offsetX: (rect.width - drawnW) / 2,
      offsetY: (rect.height - drawnH) / 2
    };
  };

  const hideMagnifier = () => {
    hovering = false;
    activeImage = null;
    if (positionFrame) {
      cancelAnimationFrame(positionFrame);
      positionFrame = 0;
    }
    lens?.classList.remove('is-visible');
    hint?.classList.remove('is-visible');
  };

  const positionMagnifier = (clientX, clientY) => {
    const img = activeImage;
    if (!img || !lens || !hint) return;

    const rect = img.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8 || rect.bottom < 0 || rect.top > window.innerHeight) {
      hideMagnifier();
      return;
    }

    const metrics = fitMetrics(img, rect);
    const zoom = zoomFor(img);

    const px = clamp(clientX - rect.left, 0, rect.width);
    const py = clamp(clientY - rect.top, 0, rect.height);

    /* Lens stays fully inside the image box */
    const minCX = rect.left + Math.min(LENS_RADIUS, rect.width / 2);
    const maxCX = rect.right - Math.min(LENS_RADIUS, rect.width / 2);
    const minCY = rect.top + Math.min(LENS_RADIUS, rect.height / 2);
    const maxCY = rect.bottom - Math.min(LENS_RADIUS, rect.height / 2);
    const centerX = clamp(clientX, minCX, Math.max(minCX, maxCX));
    const centerY = clamp(clientY, minCY, Math.max(minCY, maxCY));

    lens.style.left = `${centerX - LENS_RADIUS}px`;
    lens.style.top = `${centerY - LENS_RADIUS}px`;
    lens.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
    lens.style.backgroundSize = `${metrics.drawnW * zoom}px ${metrics.drawnH * zoom}px`;
    lens.style.backgroundPosition = `${LENS_RADIUS - (px - metrics.offsetX) * zoom}px ${LENS_RADIUS - (py - metrics.offsetY) * zoom}px`;

    hint.style.left = `${rect.left + rect.width / 2}px`;
    hint.style.top = `${clamp(rect.bottom - 40, 8, window.innerHeight - 40)}px`;
  };

  const queuePosition = (clientX, clientY) => {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      if (hovering) positionMagnifier(clientX, clientY);
    });
  };

  const activateMagnifier = (img, event) => {
    if (img.dataset.magnify === 'false') return; // explicit opt-out
    if (!finePointerQuery.matches) return;

    const rect = img.getBoundingClientRect();
    if (rect.width < MIN_IMAGE_SIDE || rect.height < MIN_IMAGE_SIDE) return;
    if (!img.complete || img.naturalWidth === 0) return; // mousemove retries once loaded

    ensureMagnifierLayers();
    activeImage = img;
    hovering = true;
    lens.classList.add('is-visible');
    hint.classList.add('is-visible');
    positionMagnifier(event.clientX, event.clientY);
  };

  const imageFromTarget = (target) => {
    if (!(target instanceof Element)) return null;
    const img = target.closest(MAGNIFY_SELECTOR);
    return img instanceof HTMLImageElement ? img : null;
  };

  const initMagnifier = () => {
    /* Delegated handlers — work for current and dynamically injected images. */
    document.addEventListener('mouseover', (event) => {
      const img = imageFromTarget(event.target);
      if (img && img !== activeImage) activateMagnifier(img, event);
    }, { passive: true });

    document.addEventListener('mousemove', (event) => {
      const img = imageFromTarget(event.target);
      if (img && img === activeImage) {
        queuePosition(event.clientX, event.clientY);
        return;
      }
      if (img && hovering === false) activateMagnifier(img, event);
    }, { passive: true });

    document.addEventListener('mouseout', (event) => {
      if (!activeImage) return;
      if (event.target === activeImage) hideMagnifier();
    }, { passive: true });

    /* A click on the artwork opens the viewer — dismiss the lens first. */
    document.addEventListener('pointerdown', () => hideMagnifier(), { passive: true, capture: true });
    window.addEventListener('scroll', () => hideMagnifier(), { passive: true, capture: true });
    window.addEventListener('resize', () => hideMagnifier(), { passive: true });

    const onModeChange = () => { if (!finePointerQuery.matches) hideMagnifier(); };
    if (typeof finePointerQuery.addEventListener === 'function') finePointerQuery.addEventListener('change', onModeChange);
    else if (typeof finePointerQuery.addListener === 'function') finePointerQuery.addListener(onModeChange);
  };

  /* Convenient escape hatch for overlays: window.artspaceMagnifier = { hide } */
  window.artspaceMagnifier = { hide: hideMagnifier };

  syncSoundToggles();
  initMagnifier();
})();

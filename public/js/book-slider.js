(() => {
  'use strict';

  const previous = window.__artspaceBookSlider;
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  const root = document.querySelector('[data-asb-root]');
  if (!root) return;

  const dataNode = root.querySelector('[data-asb-data]');
  let artworks = [];
  try {
    artworks = JSON.parse(dataNode ? dataNode.textContent : '[]');
  } catch (error) {
    artworks = [];
  }

  if (!Array.isArray(artworks) || !artworks.length) return;

  const book = root.querySelector('[data-asb-book]');
  const prevButton = root.querySelector('[data-asb-prev]');
  const nextButton = root.querySelector('[data-asb-next]');
  const counter = root.querySelector('[data-asb-counter]');
  const progressBar = root.querySelector('[data-asb-progress]');
  if (!book) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const vendorSrc = root.dataset.asbVendor || '/vendor/page-flip.browser.js';
  const SOUND_PREF_KEY = 'artspace-art-sound';

  let pageFlip = null;
  let destroyed = false;
  let chromeFrame = 0;
  let libraryPromise = null;
  let audioContext = null;
  let noiseBuffer = null;
  let lastTurnSoundAt = 0;

  const pad = (value) => String(value).padStart(2, '0');

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));

  const isSoundOn = () => {
    try {
      return localStorage.getItem(SOUND_PREF_KEY) === 'on';
    } catch (error) {
      return false;
    }
  };

  const getAudioContext = () => {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) return null;
    if (!audioContext || audioContext.state === 'closed') audioContext = new Constructor();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  };

  const getNoiseBuffer = (ctx) => {
    if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 0.9);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    return noiseBuffer;
  };

  const playPaperTurn = (forward) => {
    if (!isSoundOn()) return;

    const now = performance.now();
    if (now - lastTurnSoundAt < 140) return;
    lastTurnSoundAt = now;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const start = ctx.currentTime + 0.006;
      const duration = 0.5 + Math.random() * 0.1;
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      let output = ctx.destination;

      if (panner) {
        panner.pan.setValueAtTime(forward ? 0.34 : -0.34, start);
        panner.pan.linearRampToValueAtTime(forward ? -0.22 : 0.22, start + duration);
        panner.connect(ctx.destination);
        output = panner;
      }

      const swish = ctx.createBufferSource();
      swish.buffer = getNoiseBuffer(ctx);
      const swishFilter = ctx.createBiquadFilter();
      swishFilter.type = 'bandpass';
      swishFilter.Q.setValueAtTime(0.72, start);
      swishFilter.frequency.setValueAtTime((forward ? 1500 : 1750) * (0.9 + Math.random() * 0.2), start);
      swishFilter.frequency.exponentialRampToValueAtTime(560 * (0.88 + Math.random() * 0.24), start + duration);
      const swishGain = ctx.createGain();
      swishGain.gain.setValueAtTime(0.0001, start);
      swishGain.gain.exponentialRampToValueAtTime(0.06, start + 0.055);
      swishGain.gain.exponentialRampToValueAtTime(0.034, start + 0.2);
      swishGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      swish.connect(swishFilter).connect(swishGain).connect(output);
      swish.start(start, Math.random() * 0.22, duration + 0.05);

      const edge = ctx.createBufferSource();
      edge.buffer = getNoiseBuffer(ctx);
      const edgeFilter = ctx.createBiquadFilter();
      edgeFilter.type = 'highpass';
      edgeFilter.frequency.setValueAtTime(3100, start);
      edgeFilter.Q.setValueAtTime(0.55, start);
      const edgeGain = ctx.createGain();
      edgeGain.gain.setValueAtTime(0.0001, start);
      edgeGain.gain.exponentialRampToValueAtTime(0.018, start + 0.018);
      edgeGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
      edge.connect(edgeFilter).connect(edgeGain).connect(output);
      edge.start(start, Math.random() * 0.22, 0.13);

      const settleStart = start + duration * 0.66;
      const settle = ctx.createBufferSource();
      settle.buffer = getNoiseBuffer(ctx);
      const settleFilter = ctx.createBiquadFilter();
      settleFilter.type = 'lowpass';
      settleFilter.frequency.setValueAtTime(420, settleStart);
      settleFilter.Q.setValueAtTime(0.5, settleStart);
      const settleGain = ctx.createGain();
      settleGain.gain.setValueAtTime(0.0001, settleStart);
      settleGain.gain.exponentialRampToValueAtTime(0.014, settleStart + 0.02);
      settleGain.gain.exponentialRampToValueAtTime(0.0001, settleStart + 0.18);
      settle.connect(settleFilter).connect(settleGain).connect(output);
      settle.start(settleStart, Math.random() * 0.2, 0.2);

      const body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.setValueAtTime(150, settleStart);
      body.frequency.exponentialRampToValueAtTime(92, settleStart + 0.16);
      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.0001, settleStart);
      bodyGain.gain.exponentialRampToValueAtTime(0.011, settleStart + 0.03);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, settleStart + 0.18);
      body.connect(bodyGain).connect(output);
      body.start(settleStart);
      body.stop(settleStart + 0.2);

      const crackleCount = 2 + Math.floor(Math.random() * 2);
      for (let index = 0; index < crackleCount; index += 1) {
        const at = start + 0.05 + Math.random() * (duration * 0.65);
        const crackle = ctx.createBufferSource();
        crackle.buffer = getNoiseBuffer(ctx);
        const crackleFilter = ctx.createBiquadFilter();
        crackleFilter.type = 'bandpass';
        crackleFilter.frequency.setValueAtTime(2200 + Math.random() * 2200, at);
        crackleFilter.Q.setValueAtTime(4 + Math.random() * 3, at);
        const crackleGain = ctx.createGain();
        crackleGain.gain.setValueAtTime(0.0001, at);
        crackleGain.gain.exponentialRampToValueAtTime(0.005 + Math.random() * 0.005, at + 0.008);
        crackleGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
        crackle.connect(crackleFilter).connect(crackleGain).connect(output);
        crackle.start(at, Math.random() * 0.4, 0.05);
      }
    } catch (error) {
    }
  };

  const uniqueArtists = Array.from(new Set(
    artworks.map((artwork) => String(artwork.artist || '').trim()).filter(Boolean)
  ));
  const years = Array.from(new Set(
    artworks.map((artwork) => String(artwork.year || '').trim()).filter(Boolean)
  )).sort();
  const drawingCount = `${artworks.length} ${artworks.length === 1 ? 'drawing' : 'drawings'}`;
  const yearsLabel = years.length === 1
    ? years[0]
    : years.length > 1
      ? `${years[0]}\u2013${years[years.length - 1]}`
      : '';
  const coverTitle = uniqueArtists.length === 1 ? uniqueArtists[0] : 'The community book';
  const coverByline = uniqueArtists.length === 1 ? 'All drawings by' : 'A community collection';
  const showArtistInIndex = uniqueArtists.length !== 1;
  const INDEX_PAGE_SIZE = 6;

  function coverTemplate() {
    return `
      <div class="asb-content asb-content--cover">
        <div class="asb-cover-head">
          <span>ArtSpace / The community book</span>
          <span class="font-khmer asb-head-khmer" aria-hidden="true">សិល្បៈ</span>
        </div>
        <div class="asb-cover-identity">
          <span class="asb-cover-eyebrow">${coverByline}</span>
          <h2 data-i18n-skip>${escapeHTML(coverTitle)}</h2>
          <span class="asb-cover-rule" aria-hidden="true"></span>
          <p>${drawingCount}${yearsLabel ? ` · ${escapeHTML(yearsLabel)}` : ''}</p>
        </div>
        <div class="asb-cover-foot">
          <span class="asb-cover-mark" aria-hidden="true">A/S</span>
          <span>The complete index is inside</span>
        </div>
        <span class="asb-cover-khmer" aria-hidden="true">សិល្បៈ</span>
      </div>
    `;
  }

  function contentsTemplate(pageArtworks, pageIndex, pageCount, offset) {
    const items = pageArtworks.map((artwork, index) => {
      const medium = escapeHTML(artwork.medium || 'Original artwork');
      const artist = escapeHTML(artwork.artist || '');
      const meta = showArtistInIndex && artist ? `${medium} · ${artist}` : medium;

      return `
        <li class="asb-contents-item">
          <span class="asb-contents-index">${pad(offset + index + 1)}</span>
          <span class="asb-contents-copy">
            <span class="asb-contents-title" data-i18n-skip>${escapeHTML(artwork.title)}</span>
            <span class="asb-contents-meta">${meta}</span>
          </span>
        </li>
      `;
    }).join('');
    const pageLabel = pageCount > 1
      ? `<span class="asb-index-counter"> · ${pad(pageIndex + 1)} / ${pad(pageCount)}</span>`
      : '';

    return `
      <div class="asb-content asb-content--contents">
        <div class="asb-head">
          <span>ArtSpace / Contents</span>
          <span class="font-khmer asb-head-khmer" aria-hidden="true">សិល្បៈ</span>
        </div>
        <div class="asb-contents-intro">
          <span class="asb-meta">The index${pageLabel}</span>
          <h2>All the drawings.</h2>
        </div>
        <ol class="asb-contents-list">${items}</ol>
        <span class="asb-folio">Index</span>
      </div>
    `;
  }

  function dividerTemplate() {
    return `
      <div class="asb-content asb-content--divider" aria-hidden="true">
        <span class="asb-divider-rule"></span>
        <span class="asb-divider-mark">A/S</span>
        <span class="asb-divider-rule"></span>
      </div>
    `;
  }

  function pageTemplate(artwork, folio) {
    if (!artwork) {
      return `
        <div class="asb-content asb-content--closing">
          <span class="asb-khmer" aria-hidden="true">សិល្បៈ</span>
          <span class="asb-meta">The last page</span>
          <h2>Every sketch tells a story.</h2>
          <p>Wander back through the book, or start a new page of your own.</p>
          <span class="asb-folio">End</span>
        </div>
      `;
    }

    const title = escapeHTML(artwork.title);
    const artist = escapeHTML(artwork.artist);
    const medium = escapeHTML(artwork.medium);
    const year = escapeHTML(artwork.year);
    const src = escapeHTML(artwork.src);

    return `
      <div class="asb-content">
        <div class="asb-head">
          <span>ArtSpace / Plate ${String(folio).padStart(2, '0')}</span>
          <span class="font-khmer asb-head-khmer" aria-hidden="true">សិល្បៈ</span>
        </div>
        <div class="asb-art-frame">
          <img
            src="${src}"
            alt="${title} by ${artist}"
            width="900"
            height="1200"
            loading="eager"
            decoding="async"
          />
        </div>
        <div class="asb-caption">
          <span class="asb-meta">${medium} · ${year}</span>
          <h2 data-i18n-skip>${title}</h2>
          <p>by ${artist}</p>
        </div>
        <span class="asb-folio">${folio}</span>
      </div>
    `;
  }

  const makeSheet = (artwork, folio) => {
    const sheet = document.createElement('div');
    sheet.className = 'asb-sheet asb-paper';
    sheet.dataset.density = 'soft';
    sheet.innerHTML = pageTemplate(artwork, folio);
    return sheet;
  };

  const makeFrontMatterSheet = (html, variant) => {
    const sheet = document.createElement('div');
    sheet.className = `asb-sheet asb-paper asb-sheet--${variant}`;
    sheet.dataset.density = 'soft';
    sheet.innerHTML = html;
    return sheet;
  };

  const indexPages = [];
  for (let start = 0; start < artworks.length; start += INDEX_PAGE_SIZE) {
    indexPages.push(artworks.slice(start, start + INDEX_PAGE_SIZE));
  }

  const frontMatter = [
    makeFrontMatterSheet(coverTemplate(), 'cover'),
    ...indexPages.map((pageArtworks, pageIndex) => makeFrontMatterSheet(
      contentsTemplate(pageArtworks, pageIndex, indexPages.length, pageIndex * INDEX_PAGE_SIZE),
      'contents'
    ))
  ];
  if (frontMatter.length % 2 === 1) {
    frontMatter.push(makeFrontMatterSheet(dividerTemplate(), 'divider'));
  }

  const sheets = [
    ...frontMatter,
    ...artworks.map((artwork, index) => makeSheet(artwork, index + 1))
  ];
  if (sheets.length % 2 === 1) sheets.push(makeSheet(null, sheets.length + 1));

  const preview = document.createElement('div');
  preview.className = 'asb-preview';
  preview.setAttribute('aria-hidden', 'true');
  sheets.slice(0, 2).forEach((sheet) => preview.append(sheet));
  book.append(preview);

  function updateChrome() {
    if (!pageFlip) return;
    const collection = pageFlip.getPageCollection();
    if (!collection) return;

    const orientation = pageFlip.getOrientation() === 'portrait' ? 'portrait' : 'landscape';
    book.dataset.asbOrientation = orientation;

    const portrait = orientation === 'portrait';
    const spreads = collection.getSpread() || [];
    const total = portrait ? collection.getPageCount() : spreads.length;
    const position = portrait ? pageFlip.getCurrentPageIndex() : collection.getCurrentSpreadIndex();
    const current = Math.min(total, Math.max(1, Number(position) + 1));

    if (counter) counter.textContent = `${pad(current)} / ${pad(total)}`;

    const busy = pageFlip.getState() !== 'read';
    if (prevButton) prevButton.disabled = busy || position <= 0;
    if (nextButton) nextButton.disabled = busy || position >= total - 1;
    if (progressBar) progressBar.style.width = `${total <= 1 ? 100 : (position / (total - 1)) * 100}%`;

    book.setAttribute(
      'aria-label',
      portrait
        ? `Artwork book, page ${current} of ${total}`
        : `Artwork book, spread ${current} of ${total}`
    );
  }

  function scheduleChrome() {
    if (chromeFrame) return;
    chromeFrame = window.requestAnimationFrame(() => {
      chromeFrame = 0;
      updateChrome();
    });
  }

  function showStaticFallback() {
    if (counter) counter.textContent = `01 / ${pad(Math.ceil(sheets.length / 2))}`;
    if (prevButton) prevButton.disabled = true;
    if (nextButton) nextButton.disabled = true;
    if (progressBar) progressBar.style.width = '0%';
    book.setAttribute('aria-label', 'Artwork book preview');
  }

  const loadPageFlip = () => {
    if (window.St?.PageFlip) return Promise.resolve(window.St.PageFlip);
    if (libraryPromise) return libraryPromise;

    libraryPromise = new Promise((resolve) => {
      const resolveLibrary = () => resolve(window.St?.PageFlip || null);
      const existing = document.querySelector('script[data-asb-pageflip-loader]');

      if (existing) {
        existing.addEventListener('load', resolveLibrary, { once: true });
        existing.addEventListener('error', () => resolve(null), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = vendorSrc;
      script.async = true;
      script.dataset.asbPageflipLoader = 'true';
      script.addEventListener('load', resolveLibrary, { once: true });
      script.addEventListener('error', () => resolve(null), { once: true });
      document.head.appendChild(script);
    });

    return libraryPromise;
  };

  const bindPageFlip = (PageFlip) => {
    if (destroyed || !book.isConnected) return;

    pageFlip = new PageFlip(book, {
      width: 600,
      height: 800,
      size: 'stretch',
      minWidth: 240,
      maxWidth: 560,
      minHeight: 300,
      maxHeight: 900,
      drawShadow: true,
      flippingTime: reduceMotion.matches ? 1 : 920,
      usePortrait: true,
      autoSize: true,
      maxShadowOpacity: 0.34,
      showCover: false,
      mobileScrollSupport: true,
      swipeDistance: 26,
      clickEventForward: true,
      useMouseEvents: true,
      showPageCorners: true,
      disableFlipByClick: false
    });

    pageFlip.on('flip', scheduleChrome);
    pageFlip.on('init', scheduleChrome);
    pageFlip.on('changeOrientation', scheduleChrome);
    pageFlip.on('changeState', (event) => {
      if (event?.data === 'flipping') {
        let direction = null;
        try {
          direction = pageFlip.getFlipController().getCalculation()?.getDirection();
        } catch (error) {
        }
        playPaperTurn(direction !== 1);
      }
      scheduleChrome();
    });

    try {
      pageFlip.loadFromHTML(sheets);
    } catch (error) {
      pageFlip = null;
      showStaticFallback();
      return;
    }

    preview.remove();
    scheduleChrome();
    window.setTimeout(() => {
      if (!destroyed) scheduleChrome();
    }, 80);
  };

  const unlockAudio = () => {
    if (!isSoundOn()) return;
    getAudioContext();
  };

  root.addEventListener('pointerenter', unlockAudio, { once: true, passive: true });
  root.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  root.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
  root.addEventListener('keydown', unlockAudio, { once: true });

  book.addEventListener('keydown', (event) => {
    if (!pageFlip || pageFlip.getState() !== 'read') return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      pageFlip.flipPrev();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      pageFlip.flipNext();
    }
  });

  prevButton?.addEventListener('click', (event) => {
    event.preventDefault();
    pageFlip?.flipPrev();
  });

  nextButton?.addEventListener('click', (event) => {
    event.preventDefault();
    pageFlip?.flipNext();
  });

  function destroy() {
    destroyed = true;
    if (chromeFrame) window.cancelAnimationFrame(chromeFrame);
    chromeFrame = 0;

    if (pageFlip) {
      try {
        pageFlip.destroy();
      } catch (error) {
      }
      pageFlip = null;
    }

    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
    audioContext = null;
    noiseBuffer = null;

    if (window.__artspaceBookSlider === instance) window.__artspaceBookSlider = null;
  }

  const instance = { destroy };
  window.__artspaceBookSlider = instance;

  loadPageFlip()
    .then((PageFlip) => {
      if (!PageFlip) {
        showStaticFallback();
        return;
      }
      bindPageFlip(PageFlip);
    })
    .catch(() => showStaticFallback());
})();

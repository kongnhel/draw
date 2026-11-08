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
  const leftPage = root.querySelector('[data-asb-page-left]');
  const rightPage = root.querySelector('[data-asb-page-right]');
  const flipLayer = root.querySelector('[data-asb-flip-layer]');
  const prevButton = root.querySelector('[data-asb-prev]');
  const nextButton = root.querySelector('[data-asb-next]');
  const counter = root.querySelector('[data-asb-counter]');
  const progressBar = root.querySelector('[data-asb-progress]');

  if (!book || !leftPage || !rightPage || !flipLayer) return;

  const mobileQuery = window.matchMedia('(max-width: 768px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let isMobile = mobileQuery.matches;
  let index = 0;
  let animating = false;
  let flipTimer = 0;
  let suppressClickUntil = 0;
  let touchStart = null;
  let touchAxis = null;

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));

  const totalSpreads = () => Math.ceil(artworks.length / 2);
  const maxIndex = () => (isMobile ? artworks.length - 1 : totalSpreads() - 1);

  function pageTemplate(artwork, { side = 'right', folio = 1, eager = false } = {}) {
    if (!artwork) {
      return `
        <div class="asb-content asb-content--closing asb-content--${side}">
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
    const loading = eager ? 'eager' : 'lazy';

    return `
      <div class="asb-content asb-content--${side}">
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
            loading="${loading}"
            decoding="async"
          />
        </div>
        <div class="asb-caption">
          <span class="asb-meta">${medium} · ${year}</span>
          <h2>${title}</h2>
          <p>by ${artist}</p>
        </div>
        <span class="asb-folio">${folio}</span>
      </div>
    `;
  }

  function blankBackTemplate() {
    return `
      <div class="asb-content asb-content--blank asb-content--single">
        <span class="asb-khmer" aria-hidden="true">សិល្បៈ</span>
        <h2>ArtSpace</h2>
        <p>A living sketchbook.<br />Original work, kept with care.</p>
      </div>
    `;
  }

  function renderStatic() {
    if (isMobile) {
      leftPage.innerHTML = '';
      leftPage.setAttribute('aria-hidden', 'true');
      rightPage.removeAttribute('aria-hidden');
      rightPage.innerHTML = pageTemplate(artworks[index], {
        side: 'single',
        folio: index + 1,
        eager: true
      });
    } else {
      leftPage.removeAttribute('aria-hidden');
      rightPage.removeAttribute('aria-hidden');

      leftPage.innerHTML = pageTemplate(artworks[index * 2], {
        side: 'left',
        folio: index * 2 + 1,
        eager: true
      });
      rightPage.innerHTML = pageTemplate(artworks[index * 2 + 1], {
        side: 'right',
        folio: index * 2 + 2,
        eager: true
      });
    }

    updateChrome();
  }

  function updateChrome() {
    const total = isMobile ? artworks.length : totalSpreads();
    const current = index + 1;
    const max = maxIndex();

    counter.textContent = `${String(current).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    prevButton.disabled = animating || index <= 0;
    nextButton.disabled = animating || index >= max;
    progressBar.style.width = `${max === 0 ? 100 : (index / max) * 100}%`;

    book.setAttribute(
      'aria-label',
      isMobile
        ? `Artwork book, page ${current} of ${total}`
        : `Artwork book, spread ${current} of ${total}`
    );
  }

  function turn(direction) {
    if (animating) return;

    const target = index + direction;
    if (target < 0 || target > maxIndex()) return;

    if (reduceMotion.matches) {
      index = target;
      renderStatic();
      return;
    }

    animating = true;

    const single = isMobile;
    const frontPage = single || direction > 0 ? rightPage : leftPage;
    const frontHTML = frontPage.innerHTML;

    let backHTML;
    if (single) {
      backHTML = blankBackTemplate();
    } else if (direction > 0) {
      backHTML = pageTemplate(artworks[target * 2], {
        side: 'left',
        folio: target * 2 + 1,
        eager: true
      });
    } else {
      backHTML = pageTemplate(artworks[target * 2 + 1], {
        side: 'right',
        folio: target * 2 + 2,
        eager: true
      });
    }

    /*
     * The destination is placed underneath immediately.
     * The flipping sheet covers it until it has rotated far enough.
     */
    if (single) {
      rightPage.innerHTML = pageTemplate(artworks[target], {
        side: 'single',
        folio: target + 1,
        eager: true
      });
    } else if (direction > 0) {
      rightPage.innerHTML = pageTemplate(artworks[target * 2 + 1], {
        side: 'right',
        folio: target * 2 + 2,
        eager: true
      });
    } else {
      leftPage.innerHTML = pageTemplate(artworks[target * 2], {
        side: 'left',
        folio: target * 2 + 1,
        eager: true
      });
    }

    index = target;
    updateChrome();
    createFlip({ direction, frontHTML, backHTML, single });
  }

  function createFlip({ direction, frontHTML, backHTML, single }) {
    const flip = document.createElement('div');
    flip.className = `asb-flip ${direction > 0 ? 'asb-flip--next' : 'asb-flip--prev'}`;
    flip.setAttribute('aria-hidden', 'true');

    const frontSide = direction > 0 ? 'right' : 'left';
    const backSide = direction > 0 ? 'left' : 'right';

    const front = document.createElement('div');
    front.className = `asb-face asb-face--front asb-paper${single ? '' : ` asb-paper--${frontSide}`}`;
    front.innerHTML = frontHTML;

    const back = document.createElement('div');
    back.className = `asb-face asb-face--back asb-paper${single ? '' : ` asb-paper--${backSide}`}`;
    back.innerHTML = backHTML;

    flip.append(front, back);
    flipLayer.append(flip);

    // Paint the sheet at 0deg before applying the rotated state.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => flip.classList.add('is-flipping'));
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(flipTimer);
      flip.removeEventListener('transitionend', onTransitionEnd);
      flip.remove();
      renderStatic();
      animating = false;
      updateChrome();
    };

    const onTransitionEnd = (event) => {
      if (event.propertyName === 'transform') finish();
    };

    flip.addEventListener('transitionend', onTransitionEnd);
    flipTimer = window.setTimeout(finish, 1200);
  }

  function cancelFlip() {
    window.clearTimeout(flipTimer);
    flipLayer.replaceChildren();
    animating = false;
    resetDrag();
  }

  function resetDrag() {
    book.classList.remove('is-dragging', 'is-dragging-next', 'is-dragging-prev');
    book.style.removeProperty('--asb-drag-x');
  }

  book.addEventListener('touchstart', (event) => {
    if (animating || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY, time: performance.now() };
    touchAxis = null;
    resetDrag();
  }, { passive: true });

  book.addEventListener('touchmove', (event) => {
    if (!touchStart || animating || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;

    if (!touchAxis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      touchAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }

    if (touchAxis !== 'x') return;

    // Horizontal swipe belongs to the book; vertical scrolling stays native.
    event.preventDefault();

    const clamped = Math.max(-70, Math.min(70, dx));
    book.style.setProperty('--asb-drag-x', `${clamped}px`);
    book.classList.add('is-dragging');
    book.classList.toggle('is-dragging-next', dx < 0);
    book.classList.toggle('is-dragging-prev', dx > 0);
  }, { passive: false });

  book.addEventListener('touchend', (event) => {
    if (!touchStart) return;

    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    const elapsed = performance.now() - touchStart.time;
    const wasHorizontal = touchAxis === 'x';

    resetDrag();
    touchStart = null;
    touchAxis = null;

    if (!wasHorizontal) return;

    suppressClickUntil = performance.now() + 450;

    const threshold = 42;
    if (Math.abs(dx) < threshold || Math.abs(dy) > 70 || elapsed > 800) return;
    turn(dx < 0 ? 1 : -1);
  }, { passive: true });

  book.addEventListener('touchcancel', () => {
    touchStart = null;
    touchAxis = null;
    resetDrag();
  }, { passive: true });

  book.addEventListener('click', (event) => {
    if (animating || performance.now() < suppressClickUntil) return;

    const rect = book.getBoundingClientRect();
    const x = event.clientX - rect.left;
    turn(x < rect.width / 2 ? -1 : 1);
  });

  book.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      turn(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      turn(1);
    }
  });

  prevButton?.addEventListener('click', () => turn(-1));
  nextButton?.addEventListener('click', () => turn(1));

  function handleModeChange(event) {
    const currentArtwork = isMobile ? index : index * 2;
    isMobile = event.matches;

    cancelFlip();

    index = isMobile
      ? Math.min(currentArtwork, Math.max(0, artworks.length - 1))
      : Math.min(Math.floor(currentArtwork / 2), Math.max(0, totalSpreads() - 1));

    index = Math.max(0, index);
    renderStatic();
  }

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', handleModeChange);
  } else if (typeof mobileQuery.addListener === 'function') {
    mobileQuery.addListener(handleModeChange);
  }

  function destroy() {
    window.clearTimeout(flipTimer);
    if (typeof mobileQuery.removeEventListener === 'function') {
      mobileQuery.removeEventListener('change', handleModeChange);
    } else if (typeof mobileQuery.removeListener === 'function') {
      mobileQuery.removeListener(handleModeChange);
    }
    if (window.__artspaceBookSlider === instance) window.__artspaceBookSlider = null;
  }

  const instance = { destroy };
  window.__artspaceBookSlider = instance;

  renderStatic();
  updateChrome();
})();

/* ==========================================================================
   Pencil Cursor — The Living Sketchbook
   Custom pencil cursor, graphite ink trail and click particle bursts.
   Fine pointers: pencil follows the mouse. Coarse pointers: pencil follows touch.
   Disable via localStorage "artspace-pencil-cursor" = "off".
   ========================================================================== */
(() => {
  'use strict';

  const STORAGE_KEY = 'artspace-pencil-cursor';
  const TRAIL_LIFE_MS = 950;
  const TRAIL_MAX_POINTS = 130;
  const PARTICLE_CAP = 110;

  const finePointerQuery = window.matchMedia('(pointer: fine)');
  const hoverQuery = window.matchMedia('(hover: hover)');
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const isDisabledByUser = () => {
    try { return localStorage.getItem(STORAGE_KEY) === 'off'; } catch { return false; }
  };

  const isLowPerf = () => {
    if (document.documentElement.getAttribute('data-perf') === 'low') return true;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const memory = Number(navigator.deviceMemory) || 8;
    const cores = Number(navigator.hardwareConcurrency) || 8;
    return memory <= 2
      || (memory <= 4 && cores <= 4)
      || Boolean(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')));
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const TAU = Math.PI * 2;

  /* ------------------------------ SVG artwork ------------------------------ */

  const PENCIL_SVG = `
<svg class="pencil-art" viewBox="0 0 60 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2 4.6c0-.9.7-1.6 1.6-1.6h4.2c.9 0 1.6.7 1.6 1.6v6.8c0 .9-.7 1.6-1.6 1.6H3.6c-.9 0-1.6-.7-1.6-1.6V4.6Z" fill="#a5543f" stroke="#5d2d22" stroke-width="0.7" stroke-linejoin="round"/>
  <path d="M9.4 3.2h2.6v9.6H9.4z" fill="#b9b4a8" stroke="#6f6a5e" stroke-width="0.55"/>
  <path d="M11.2 3.2v9.6" stroke="#6f6a5e" stroke-width="0.45"/>
  <path d="M12 3.2h25.6c.6 0 1 .3 1.3.9L45 8c-.6 3.9-1.4 4.5-2.6 4.5H12c-.8 0-1.3-.4-1.3-1.1V4.3c0-.7.5-1.1 1.3-1.1Z" fill="#45433e" stroke="#242220" stroke-width="0.8" stroke-linejoin="round"/>
  <path d="M12.8 5.1h28.2" stroke="#5a5852" stroke-width="1.05" stroke-linecap="round" opacity="0.85"/>
  <path d="M12.8 11h28" stroke="#2e2c28" stroke-width="0.8" stroke-linecap="round" opacity="0.9"/>
  <path d="M39.8 3.2 50 8l-10.2 4.8c.9-1.6 1.4-3.1 1.4-4.8s-.5-3.2-1.4-4.8Z" fill="#d9b382" stroke="#8a6b45" stroke-width="0.7" stroke-linejoin="round"/>
  <path d="M44.6 5.4 54.6 8l-10 2.6c.7-.9 1.1-1.8 1.1-2.6s-.4-1.7-1.1-2.6Z" fill="#efe0c8" stroke="#8a6b45" stroke-width="0.5" stroke-linejoin="round"/>
  <path d="M51.5 6.4 59 8l-7.5 1.6c.6-.5.9-1 .9-1.6s-.3-1.1-.9-1.6Z" fill="#2e2c28"/>
  <path d="M56.4 7.2 59 8l-2.6.8" stroke="#6e6b62" stroke-width="0.4" stroke-linecap="round"/>
</svg>`;

  const RING_SVG = `
<svg class="pencil-cursor-ring" viewBox="0 0 38 38" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M19.2 2.6c8.6-.4 15.9 6.2 15.5 14.9-.4 8.8-6.8 14.9-15.6 14.5C10.5 31.7 3.1 25 3.4 16.4 3.8 8.2 10.9 3 19.2 2.6Z" fill="none" stroke="#9a8066" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="6.5 5.5" opacity="0.95"/>
  <path d="M12 12.5c2.2-1.6 4.6-2.4 7.2-2.3" fill="none" stroke="#9a8066" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/>
</svg>`;

  const ZOOM_SVG = `
<svg class="pencil-cursor-zoom" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="11" cy="11" r="9.6" fill="rgba(41,40,36,0.88)" stroke="#f5f0e4" stroke-opacity="0.35" stroke-width="1"/>
  <path d="M11 7.6v6.8M7.6 11h6.8" stroke="#f5f0e4" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

  const FRAME_SVG = `
<svg class="pencil-cursor-frame" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2.5 11.5V2.5h9" fill="none" stroke="#9a8066" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M30.5 2.5h9v9" fill="none" stroke="#9a8066" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M2.5 30.5v9h9" fill="none" stroke="#9a8066" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M30.5 39.5h9v-9" fill="none" stroke="#9a8066" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

  /* --------------------------- State & elements --------------------------- */

  const layers = { canvas: null, cursor: null };
  let mode = 'off'; // 'off' | 'full' | 'touch'

  let pointerX = -100;
  let pointerY = -100;
  let pencilAngle = -Math.PI / 6;
  let targetAngle = -Math.PI / 6;
  let pencilApplied = { x: -9999, y: -9999, angle: 0 };
  let pencilVisible = false;
  let lastMoveAt = 0;

  const trailPoints = [];
  const particles = [];
  let trailWidth = 1.15;
  let rafId = 0;
  let lastFrame = 0;
  let graphite = { r: 58, g: 56, b: 51 };

  const TOUCH_TRAIL_LIFE_MS = 620;
  const TOUCH_TRAIL_MAX_POINTS = 52;
  const TOUCH_PARTICLE_CAP = 42;
  const TOUCH_HOVER_CLASS = 'touch-hovered';
  const TOUCH_HOVER_SELECTOR = 'a[href], button, [role="button"], input[type="submit"], .btn, .action-btn, .category-pill, .nav-auth-link, .nav-auth-join, .hs-btn, .hs-category-row';
  const CARD_HOVER_SELECTOR = '.art-card, .studio-explore-card, .pf-art-card';

  let activeTouchId = null;
  const activeTouches = new Set();
  let touchHoverEl = null;
  let touchHoverTimer = 0;
  let touchFadeTimer = 0;
  let lastDustAt = 0;

  const TEXT_ZONE_SELECTOR = 'input, textarea, select, option, [contenteditable="true"], [contenteditable=""]';
  const NATIVE_ZONE_SELECTOR = '.art-viewer, .ie-overlay, .intro-overlay, dialog, [data-native-cursor]';
  const IMAGE_ZONE_SELECTOR = '.ad-artwork-open, .art-card-media';
  const BUTTON_ZONE_SELECTOR = 'button, [role="button"], input[type="submit"], .btn, .action-btn, .category-pill';
  const ARTWORK_ZONE_SELECTOR = '.art-card';
  const LINK_ZONE_SELECTOR = 'a[href]';

  const parseColor = (value) => {
    const probe = document.createElement('span');
    probe.style.color = value;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    const match = rgb.match(/[\d.]+/g);
    return match ? { r: Number(match[0]), g: Number(match[1]), b: Number(match[2]) } : { r: 58, g: 56, b: 51 };
  };

  const refreshGraphite = () => {
    const text = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    if (text) graphite = parseColor(text);
  };

  /* ------------------------------- Canvas --------------------------------- */

  const resizeCanvas = () => {
    if (!layers.canvas) return;
    const maxDpr = mode === 'touch' ? 1.5 : 2;
    const dpr = clamp(window.devicePixelRatio || 1, 1, maxDpr);
    layers.canvas.width = Math.round(window.innerWidth * dpr);
    layers.canvas.height = Math.round(window.innerHeight * dpr);
    const ctx = layers.canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const clearCanvas = () => {
    const ctx = layers.canvas?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };

  /* ------------------------------- Trail ----------------------------------- */

  const pushTrailPoint = (x, y) => {
    const last = trailPoints[trailPoints.length - 1];
    const dist = last ? Math.hypot(x - last.x, y - last.y) : Number.POSITIVE_INFINITY;
    if (dist < 3) return;

    trailWidth = clamp(trailWidth + rand(-0.24, 0.24), 0.75, 2.05);
    trailPoints.push({
      x, y,
      w: trailWidth * rand(0.85, 1.2),
      skew: rand(-1.1, 1.1),
      life: 1
    });
    const limit = mode === 'touch' ? TOUCH_TRAIL_MAX_POINTS : TRAIL_MAX_POINTS;
    if (trailPoints.length > limit) trailPoints.shift();
    wake();
  };

  const drawTrail = (ctx) => {
    if (trailPoints.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < trailPoints.length; i += 1) {
      const a = trailPoints[i - 1];
      const b = trailPoints[i];
      const life = Math.min(a.life, b.life);
      if (life <= 0.02) continue;

      const alpha = Math.pow(life, 1.55) * 0.5;
      const width = (a.w + b.w) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const nx = -dy;
      const ny = dx;
      const norm = Math.hypot(nx, ny) || 1;

      ctx.strokeStyle = `rgba(${graphite.r},${graphite.g},${graphite.b},${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      /* faint sketchy echo stroke */
      if (mode !== 'touch') {
        ctx.strokeStyle = `rgba(${graphite.r},${graphite.g},${graphite.b},${alpha * 0.35})`;
        ctx.lineWidth = Math.max(0.5, width * 0.55);
        ctx.beginPath();
        ctx.moveTo(a.x + (nx / norm) * a.skew, a.y + (ny / norm) * a.skew);
        ctx.lineTo(b.x + (nx / norm) * b.skew, b.y + (ny / norm) * b.skew);
        ctx.stroke();
      }
    }
  };

  /* ------------------------------ Particles -------------------------------- */

  const spawnParticle = (x, y, scale) => {
    const angle = rand(0, TAU);
    const speed = rand(0.55, 2.45) * (scale || 1);
    const roll = Math.random();
    const type = roll < 0.32 ? 'dust'
      : roll < 0.52 ? 'shaving'
      : roll < 0.72 ? 'paper'
      : roll < 0.87 ? 'star'
      : 'hatch';

    return {
      type,
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rand(0.2, 0.9),
      rot: rand(0, TAU),
      spin: rand(-0.16, 0.16),
      size: type === 'star' ? rand(2.6, 4.6) : rand(1.6, 4.6),
      life: 1,
      decay: 1 / rand(430, 760),
      gravity: type === 'dust' || type === 'shaving' ? rand(0.016, 0.03) : rand(0.004, 0.012)
    };
  };

  const burst = (x, y, count, scale) => {
    const cap = mode === 'touch' ? TOUCH_PARTICLE_CAP : PARTICLE_CAP;
    if (particles.length >= cap) particles.splice(0, particles.length - cap + count);
    for (let i = 0; i < count; i += 1) particles.push(spawnParticle(x, y, scale));
    wake();
  };

  const drawParticle = (ctx, p) => {
    const life = clamp(p.life, 0, 1);
    const alpha = life * (p.type === 'dust' ? 0.6 : 0.85);
    const size = p.size * (0.45 + 0.55 * life);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha;

    if (p.type === 'dust') {
      ctx.fillStyle = `rgb(${graphite.r},${graphite.g},${graphite.b})`;
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, TAU);
      ctx.fill();
    } else if (p.type === 'shaving') {
      ctx.strokeStyle = '#c8a06b';
      ctx.lineWidth = Math.max(0.8, size * 0.62);
      ctx.beginPath();
      ctx.arc(0, 0, size, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else if (p.type === 'paper') {
      ctx.fillStyle = '#f5f0e4';
      ctx.strokeStyle = 'rgba(41,40,36,0.4)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.rect(-size, -size * 0.72, size * 2, size * 1.44);
      ctx.fill();
      ctx.stroke();
    } else if (p.type === 'star') {
      ctx.strokeStyle = '#9a8066';
      ctx.lineWidth = 1.15;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(0, size);
      ctx.moveTo(-size, 0);
      ctx.lineTo(size, 0);
      ctx.moveTo(-size * 0.62, -size * 0.62);
      ctx.lineTo(size * 0.62, size * 0.62);
      ctx.moveTo(size * 0.62, -size * 0.62);
      ctx.lineTo(-size * 0.62, size * 0.62);
      ctx.stroke();
    } else {
      /* hatch, a tiny sketch mark */
      ctx.strokeStyle = `rgb(${graphite.r},${graphite.g},${graphite.b})`;
      ctx.lineWidth = 1.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-size, size * 0.75);
      ctx.lineTo(size, -size * 0.75);
      ctx.moveTo(-size * 0.3, size * 0.95);
      ctx.lineTo(size * 0.95, -size * 0.15);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  };

  const updateParticles = (dt) => {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.vy += p.gravity * (dt / 16.7);
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.x += p.vx * (dt / 16.7);
      p.y += p.vy * (dt / 16.7);
      p.rot += p.spin * (dt / 16.7);
      p.life -= p.decay * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  };

  /* ------------------------------ Frame loop ------------------------------- */

  const smoothAngle = (current, target, dt) => {
    let delta = (target - current) % TAU;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    return current + delta * (1 - Math.exp(-dt / 85));
  };

  const applyPencil = () => {
    if (!layers.cursor) return;
    const sameSpot = Math.abs(pointerX - pencilApplied.x) < 0.1
      && Math.abs(pointerY - pencilApplied.y) < 0.1
      && Math.abs(pencilAngle - pencilApplied.angle) < 0.001;
    if (sameSpot) return;

    layers.cursor.style.transform = `translate3d(${pointerX}px,${pointerY}px,0) rotate(${pencilAngle}rad)`;
    pencilApplied = { x: pointerX, y: pointerY, angle: pencilAngle };
  };

  const tick = (now) => {
    rafId = 0;
    const dt = clamp(now - lastFrame || 16.7, 1, 50);
    lastFrame = now;

    const ctx = layers.canvas?.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (let i = trailPoints.length - 1; i >= 0; i -= 1) {
      trailPoints[i].life -= dt / (mode === 'touch' ? TOUCH_TRAIL_LIFE_MS : TRAIL_LIFE_MS);
      if (trailPoints[i].life <= 0) trailPoints.splice(i, 1);
    }
    updateParticles(dt);

    if (trailPoints.length) drawTrail(ctx);
    if (particles.length) particles.forEach((p) => drawParticle(ctx, p));

    if (trailPoints.length || particles.length) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };

  const wake = () => {
    if (rafId) return;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(tick);
  };

  /* --------------------------- Pointer & hover ----------------------------- */

  const setCursorState = (stateName) => {
    if (!layers.cursor) return;
    layers.cursor.classList.toggle('is-hidden', stateName === 'hidden');
    layers.cursor.classList.toggle('is-link', stateName === 'link');
    layers.cursor.classList.toggle('is-button', stateName === 'button');
    layers.cursor.classList.toggle('is-artwork', stateName === 'artwork');
    layers.cursor.classList.toggle('is-image', stateName === 'image');
  };

  const detectHoverState = (target) => {
    if (!(target instanceof Element)) return null;
    if (target.closest(TEXT_ZONE_SELECTOR)) return 'hidden';
    if (target.closest(NATIVE_ZONE_SELECTOR)) return 'hidden';
    if (target.closest(IMAGE_ZONE_SELECTOR)) return 'image';
    if (target.closest(BUTTON_ZONE_SELECTOR)) return 'button';
    if (target.closest(ARTWORK_ZONE_SELECTOR)) return 'artwork';
    if (target.closest(LINK_ZONE_SELECTOR)) return 'link';
    return null;
  };

  const clearTouchHover = () => {
    if (touchHoverTimer) {
      window.clearTimeout(touchHoverTimer);
      touchHoverTimer = 0;
    }
    if (touchHoverEl) {
      touchHoverEl.classList.remove(TOUCH_HOVER_CLASS);
      touchHoverEl = null;
    }
  };

  const CONTROL_HOVER_SELECTOR = 'button, [role="button"], input[type="submit"], .action-btn, .btn';

  const applyTouchHover = (target) => {
    if (!(target instanceof Element)) {
      clearTouchHover();
      return;
    }
    if (target.closest(NATIVE_ZONE_SELECTOR)) {
      clearTouchHover();
      return;
    }
    const control = target.closest(CONTROL_HOVER_SELECTOR);
    const element = control
      || target.closest(CARD_HOVER_SELECTOR)
      || target.closest(TOUCH_HOVER_SELECTOR);
    if (!element) {
      clearTouchHover();
      return;
    }
    if (element === touchHoverEl) return;
    clearTouchHover();
    touchHoverEl = element;
    element.classList.add(TOUCH_HOVER_CLASS);
  };

  const releaseTouchHover = () => {
    if (!touchHoverEl || touchHoverTimer) return;
    touchHoverTimer = window.setTimeout(() => {
      touchHoverEl?.classList.remove(TOUCH_HOVER_CLASS);
      touchHoverEl = null;
      touchHoverTimer = 0;
    }, 340);
  };

  const movePencilTo = (x, y, dt) => {
    const dx = x - pointerX;
    const dy = y - pointerY;
    pointerX = x;
    pointerY = y;
    if (Math.hypot(dx, dy) > 2) targetAngle = Math.atan2(dy, dx);
    pencilAngle = smoothAngle(pencilAngle, targetAngle, dt);
    pushTrailPoint(pointerX, pointerY);
    applyPencil();
    if (!pencilVisible) {
      pencilVisible = true;
      layers.cursor?.classList.add('is-visible');
    }
    if (!rafId) wake();
  };

  const startTouchPencil = (event) => {
    if (mode !== 'touch' && mode !== 'full') return;
    if (event.target instanceof Element && event.target.closest(NATIVE_ZONE_SELECTOR)) return;
    if (activeTouchId !== null && activeTouchId !== event.pointerId) {
      finishTouchPencil(0);
      return;
    }
    if (!layers.canvas) createLayers();
    activeTouchId = event.pointerId;
    pointerX = event.clientX;
    pointerY = event.clientY;
    pencilApplied = { x: -9999, y: -9999, angle: 0 };
    pencilVisible = true;
    layers.cursor?.classList.add('is-visible');
    setCursorState(detectHoverState(event.target) || 'default');
    applyPencil();
    burst(event.clientX, event.clientY, 6, 0.72);
    applyTouchHover(event.target);
    lastDustAt = performance.now();
    wake();
  };

  const finishTouchPencil = (delay = 260) => {
    activeTouchId = null;
    if (touchFadeTimer) {
      window.clearTimeout(touchFadeTimer);
      touchFadeTimer = 0;
    }
    if (delay <= 0) {
      layers.cursor?.classList.remove('is-visible');
      pencilVisible = false;
      return;
    }
    touchFadeTimer = window.setTimeout(() => {
      layers.cursor?.classList.remove('is-visible');
      pencilVisible = false;
      touchFadeTimer = 0;
    }, delay);
    releaseTouchHover();
    if (!rafId) wake();
  };

  const onPointerMove = (event) => {
    if (event.pointerType === 'touch') {
      if (event.pointerId !== activeTouchId) return;
      if (mode !== 'touch' && mode !== 'full') return;
      const now = performance.now();
      const dtMove = clamp(now - lastMoveAt || 16.7, 1, 64);
      lastMoveAt = now;
      movePencilTo(event.clientX, event.clientY, dtMove);
      if (now - lastDustAt > 60) {
        lastDustAt = now;
        burst(event.clientX, event.clientY, 1, 0.5);
      }
      return;
    }

    const dx = event.clientX - pointerX;
    const dy = event.clientY - pointerY;
    pointerX = event.clientX;
    pointerY = event.clientY;

    if (mode !== 'full') return;

    const now = performance.now();
    const dtMove = clamp(now - lastMoveAt || 16.7, 1, 64);
    lastMoveAt = now;

    const distance = Math.hypot(dx, dy);
    if (distance > 2.5) targetAngle = Math.atan2(dy, dx);
    pencilAngle = smoothAngle(pencilAngle, targetAngle, dtMove);

    pushTrailPoint(pointerX, pointerY);
    applyPencil();

    if (!pencilVisible) {
      pencilVisible = true;
      layers.cursor?.classList.add('is-visible');
    }
    setCursorState(detectHoverState(event.target) || 'default');
    if (!rafId) wake();
  };

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'pen' && event.button !== 0) return;

    if (event.pointerType === 'touch') {
      activeTouches.add(event.pointerId);
      if (activeTouches.size > 1) {
        clearTouchHover();
        finishTouchPencil(0);
        return;
      }
      startTouchPencil(event);
      return;
    }

    if (mode !== 'full') return;

    burst(event.clientX, event.clientY, Math.round(rand(7, 12)), 1);
  };

  const onPointerUp = (event) => {
    if (event.pointerType !== 'touch') return;
    activeTouches.delete(event.pointerId);
    if (event.pointerId !== activeTouchId) return;
    finishTouchPencil(260);
  };

  const onPointerCancel = (event) => {
    if (event.pointerType !== 'touch') return;
    activeTouches.delete(event.pointerId);
    if (activeTouchId !== null && event.pointerId !== activeTouchId) return;
    clearTouchHover();
    finishTouchPencil(0);
  };

  const onScroll = () => {
    if (activeTouchId !== null) return;
    clearTouchHover();
  };

  const onNavigation = () => {
    activeTouches.clear();
    clearTouchHover();
    finishTouchPencil(0);
    trailPoints.length = 0;
    clearCanvas();
  };

  const onPointerLeaveWindow = (event) => {
    if (event.type === 'pointerleave' || event.relatedTarget === null) {
      layers.cursor?.classList.remove('is-visible');
      pencilVisible = false;
    }
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      trailPoints.length = 0;
      clearCanvas();
      clearTouchHover();
      activeTouches.clear();
      finishTouchPencil(0);
    }
  };

  const onResize = () => {
    resizeCanvas();
    clearCanvas();
  };

  /* --------------------------- Lifecycle control --------------------------- */

  const createLayers = () => {
    if (layers.canvas) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'pen-cursor-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    const cursor = document.createElement('div');
    cursor.className = 'pencil-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = `${PENCIL_SVG}${RING_SVG}${ZOOM_SVG}${FRAME_SVG}`;

    document.body.appendChild(canvas);
    document.body.appendChild(cursor);
    layers.canvas = canvas;
    layers.cursor = cursor;
    resizeCanvas();
  };

  const destroyLayers = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (touchFadeTimer) window.clearTimeout(touchFadeTimer);
    touchFadeTimer = 0;
    activeTouchId = null;
    activeTouches.clear();
    clearTouchHover();
    trailPoints.length = 0;
    particles.length = 0;
    layers.canvas?.remove();
    layers.cursor?.remove();
    layers.canvas = null;
    layers.cursor = null;
    pencilVisible = false;
    document.body.classList.remove('pencil-on');
  };

  const bindGlobalListeners = () => {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerCancel, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('artspace:navigation', onNavigation);
    document.documentElement.addEventListener('pointerleave', onPointerLeaveWindow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('resize', onResize, { passive: true });
  };

  const unbindGlobalListeners = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('artspace:navigation', onNavigation);
    document.documentElement.removeEventListener('pointerleave', onPointerLeaveWindow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('resize', onResize);
  };

  let listenersBound = false;

  const applyMode = () => {
    const off = isDisabledByUser();
    const lowPerf = isLowPerf();
    const wantFull = !lowPerf && finePointerQuery.matches && hoverQuery.matches && !reducedMotionQuery.matches && !off;
    const wantTouch = !lowPerf && !wantFull && !reducedMotionQuery.matches && !off;
    const next = wantFull ? 'full' : wantTouch ? 'touch' : 'off';

    if (next === mode) return;
    mode = next;

    destroyLayers();

    if (mode === 'full') {
      createLayers();
      document.body.classList.add('pencil-on');
      refreshGraphite();
      pencilVisible = false;
      if (!listenersBound) { bindGlobalListeners(); listenersBound = true; }
    } else if (mode === 'touch') {
      if (!listenersBound) { bindGlobalListeners(); listenersBound = true; }
    } else if (listenersBound) {
      unbindGlobalListeners();
      listenersBound = false;
    }
  };

  /* React to theme flips so the graphite tone follows the paper */
  const themeObserver = new MutationObserver(() => refreshGraphite());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  [finePointerQuery, hoverQuery, reducedMotionQuery].forEach((query) => {
    if (typeof query.addEventListener === 'function') query.addEventListener('change', applyMode);
    else if (typeof query.addListener === 'function') query.addListener(applyMode);
  });

  applyMode();
})();

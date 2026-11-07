(() => {
  'use strict';

  const READY_KEY = 'artspace-intro-seen-v1';
  const SOUND_KEY = 'artspace-intro-sound';
  const DURATION = 3600;
  const ENTRY = 520;

  const overlay = document.querySelector('[data-intro-overlay]');
  if (!overlay) return;

  window.__introReady = true;
  if (window.__introFallback) {
    window.clearTimeout(window.__introFallback);
    window.__introFallback = null;
  }

  const root = document.documentElement;
  const pageShell = document.querySelector('.page-shell');
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const lowPerf = (() => {
    if (document.documentElement.getAttribute('data-perf') === 'low') return true;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const memory = Number(navigator.deviceMemory) || 8;
    const cores = Number(navigator.hardwareConcurrency) || 8;
    return memory <= 2
      || (memory <= 4 && cores <= 4)
      || Boolean(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')));
  })();
  const svg = overlay.querySelector('.intro-logo-svg');
  const track = document.getElementById('intro-pencil-path');
  const revealRect = overlay.querySelector('[data-intro-reveal]');
  const pencil = overlay.querySelector('[data-intro-pencil]');
  const welcome = overlay.querySelector('[data-intro-welcome]');
  const progressFill = overlay.querySelector('[data-intro-progress]');
  const particles = overlay.querySelector('[data-intro-particles]');
  const soundButton = overlay.querySelector('[data-intro-sound]');
  const soundLabel = overlay.querySelector('[data-intro-sound-label]');
  const skipButton = overlay.querySelector('[data-intro-skip]');
  const enterButton = overlay.querySelector('[data-intro-enter]');
  const replayButton = document.querySelector('[data-intro-replay]');

  if (!svg || !track || !revealRect || !pencil || !welcome) return;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);
  const smoothstep = (value) => value * value * (3 - 2 * value);

  let active = false;
  let completed = false;
  let leaving = false;
  let rafId = 0;
  let startTime = 0;
  let autoTimer = null;
  let leaveTimer = null;
  let lastParticleAt = 0;
  let previousFocus = null;
  let soundEnabled = readSoundPref();
  let audioCtx = null;
  let noiseBuffer = null;
  let scratchSource = null;
  let scratchGain = null;
  let scratchTimer = null;
  let audioCloseTimer = null;

  const trackLength = track.getTotalLength();
  const startPoint = track.getPointAtLength(0);
  const endPoint = track.getPointAtLength(trackLength);

  function readSeen() {
    try {
      return window.localStorage.getItem(READY_KEY) === '1';
    } catch (error) {
      return true;
    }
  }

  function markSeen() {
    try {
      window.localStorage.setItem(READY_KEY, '1');
    } catch (error) {
      /* private browsing */
    }
  }

  function readSoundPref() {
    try {
      return window.localStorage.getItem(SOUND_KEY) === 'on';
    } catch (error) {
      return false;
    }
  }

  function writeSoundPref() {
    try {
      window.localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off');
    } catch (error) {
      /* private browsing */
    }
  }

  function setSoundUI() {
    if (!soundButton) return;
    soundButton.setAttribute('aria-pressed', String(soundEnabled));
    soundButton.setAttribute('aria-label', soundEnabled ? 'Disable intro sound' : 'Enable intro sound');
    if (soundLabel) soundLabel.textContent = soundEnabled ? 'Sound on' : 'Sound off';
  }

  function ensureAudio() {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) return null;

    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new Constructor();
      noiseBuffer = null;
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function getNoiseBuffer(ctx) {
    if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 1.2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * 0.9;
    }
    noiseBuffer = buffer;
    return buffer;
  }

  function startScratch() {
    if (!soundEnabled || !active || completed || reduceQuery.matches) return;
    if (scratchSource) return;

    const ctx = ensureAudio();
    if (!ctx) return;

    const source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer(ctx);
    source.loop = true;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 560;
    highpass.Q.value = 0.55;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1650;
    bandpass.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    scratchSource = source;
    scratchGain = gain;

    const modulate = () => {
      if (!scratchGain || !audioCtx || audioCtx.state === 'closed') return;
      const level = 0.018 + Math.random() * 0.032;
      scratchGain.gain.setTargetAtTime(level, audioCtx.currentTime, 0.055);
      scratchTimer = window.setTimeout(modulate, 70 + Math.random() * 90);
    };
    modulate();
  }

  function stopScratch() {
    window.clearTimeout(scratchTimer);
    scratchTimer = null;

    if (scratchGain && audioCtx) {
      try {
        scratchGain.gain.cancelScheduledValues(audioCtx.currentTime);
        scratchGain.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.025);
      } catch (error) {
        /* already disconnected */
      }
    }

    if (scratchSource) {
      const source = scratchSource;
      scratchSource = null;
      window.setTimeout(() => {
        try {
          source.stop();
        } catch (error) {
          /* already stopped */
        }
      }, 100);
    }

    scratchGain = null;
  }

  function playFinishChime() {
    if (!soundEnabled || reduceQuery.matches) return;
    const ctx = ensureAudio();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [
      { frequency: 523.25, start: 0, duration: 0.52, gain: 0.026, type: 'sine' },
      { frequency: 659.25, start: 0.12, duration: 0.62, gain: 0.022, type: 'sine' }
    ];

    notes.forEach((note) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, now + note.start);
      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(note.gain, now + note.start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now + note.start);
      oscillator.stop(now + note.start + note.duration + 0.03);
    });
  }

  function closeAudioSoon(delay = 1100) {
    window.clearTimeout(audioCloseTimer);
    const ctx = audioCtx;
    if (!ctx) return;
    audioCloseTimer = window.setTimeout(() => {
      if (audioCtx !== ctx) return;
      audioCtx = null;
      noiseBuffer = null;
      try {
        ctx.close();
      } catch (error) {
        /* already closed */
      }
    }, delay);
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    writeSoundPref();
    setSoundUI();

    if (!soundEnabled) {
      stopScratch();
      closeAudioSoon(260);
      return;
    }

    ensureAudio();
    startScratch();
  }

  function setBackgroundInert(value) {
    if (pageShell) pageShell.inert = value;
  }

  function setPencilAt(x, y, angle) {
    pencil.setAttribute('transform', `translate(${x} ${y}) rotate(${angle})`);
  }

  function pencilAngle(distance) {
    const ahead = track.getPointAtLength(Math.min(trackLength, distance + 3));
    const behind = track.getPointAtLength(Math.max(0, distance - 3));
    return Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * (180 / Math.PI) - 45;
  }

  function spawnParticle(x, y) {
    if (!particles || !svg || document.hidden) return;
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const screen = point.matrixTransform(matrix);
    const bounds = overlay.getBoundingClientRect();
    const particle = document.createElement('span');
    particle.className = 'intro-particle';
    particle.style.left = `${screen.x - bounds.left}px`;
    particle.style.top = `${screen.y - bounds.top}px`;
    particle.style.opacity = '0.45';
    particles.appendChild(particle);

    const driftX = (Math.random() - 0.5) * 14;
    const driftY = 8 + Math.random() * 18;
    const animation = particle.animate(
      [
        { opacity: 0.5, transform: 'translate(0, 0) scale(1)' },
        { opacity: 0, transform: `translate(${driftX}px, ${driftY}px) scale(0.35)` }
      ],
      { duration: 520 + Math.random() * 420, easing: 'ease-out' }
    );
    animation.onfinish = () => particle.remove();
  }

  function clearParticles() {
    if (particles) particles.replaceChildren();
  }

  function tick(now) {
    if (!active) return;
    const elapsed = now - startTime;
    const entryProgress = clamp(elapsed / ENTRY, 0, 1);

    if (entryProgress < 1) {
      const eased = easeOutCubic(entryProgress);
      const startAngle = pencilAngle(0);
      setPencilAt(
        startPoint.x + 46 * (1 - eased),
        startPoint.y + 132 * (1 - eased),
        startAngle
      );
      revealRect.setAttribute('width', '0');
      progressFill.style.width = '0%';
      rafId = window.requestAnimationFrame(tick);
      return;
    }

    const draw = smoothstep(clamp((elapsed - ENTRY) / (DURATION - ENTRY), 0, 1));
    const distance = trackLength * draw;
    const point = track.getPointAtLength(distance);
    const angle = pencilAngle(distance);
    const wobble = Math.sin(draw * Math.PI * 7) * 1.2;

    setPencilAt(point.x, point.y, angle + wobble);
    revealRect.setAttribute('x', '60');
    revealRect.setAttribute('width', String(846 * draw));
    progressFill.style.width = `${clamp((elapsed / DURATION) * 100, 0, 100)}%`;

    if (!lowPerf && now - lastParticleAt > 38) {
      lastParticleAt = now;
      spawnParticle(point.x - 1, point.y + 3);
      if (Math.random() > 0.64) spawnParticle(point.x + 4, point.y + 7);
    } else if (lowPerf && now - lastParticleAt > 140) {
      lastParticleAt = now;
      spawnParticle(point.x - 1, point.y + 3);
    }

    if (draw >= 1) {
      completeDrawing();
      return;
    }

    rafId = window.requestAnimationFrame(tick);
  }

  function completeDrawing() {
    if (completed) return;
    completed = true;
    window.cancelAnimationFrame(rafId);
    rafId = 0;
    revealRect.setAttribute('width', '906');
    progressFill.style.width = '100%';
    overlay.classList.remove('is-drawing');
    overlay.classList.add('is-complete');
    welcome.inert = false;
    welcome.removeAttribute('aria-hidden');
    stopScratch();
    playFinishChime();
    closeAudioSoon(1300);
    markSeen();
    autoTimer = window.setTimeout(() => finishIntro('auto'), 2400);
  }

  function cleanupAnimation() {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
    window.clearTimeout(autoTimer);
    autoTimer = null;
    window.clearTimeout(leaveTimer);
    leaveTimer = null;
    stopScratch();
    closeAudioSoon(300);
    clearParticles();
  }

  function finishIntro(reason = 'skip') {
    if (!active || leaving) return;
    leaving = true;
    active = false;
    window.clearTimeout(autoTimer);
    autoTimer = null;
    window.cancelAnimationFrame(rafId);
    rafId = 0;
    markSeen();

    if (reason === 'skip' || reason === 'escape') {
      stopScratch();
      closeAudioSoon(260);
    }

    overlay.classList.remove('is-entering', 'is-drawing');
    overlay.classList.add('is-leaving');
    const delay = reduceQuery.matches ? 0 : 560;

    leaveTimer = window.setTimeout(() => {
      root.classList.remove('intro-pending');
      overlay.classList.remove('is-leaving', 'is-complete');
      overlay.setAttribute('aria-hidden', 'true');
      completed = false;
      leaving = false;
      welcome.inert = true;
      revealRect.setAttribute('x', '60');
      revealRect.setAttribute('width', '0');
      progressFill.style.width = '0%';
      pencil.removeAttribute('transform');
      clearParticles();
      setBackgroundInert(false);
      const focusTarget = previousFocus && previousFocus.isConnected
        ? previousFocus
        : document.querySelector('.topbar .brand');
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus({ preventScroll: true });
      }
      previousFocus = null;
    }, delay);
  }

  function showReducedIntro() {
    overlay.classList.add('is-complete');
    welcome.inert = false;
    welcome.removeAttribute('aria-hidden');
    revealRect.setAttribute('x', '60');
    revealRect.setAttribute('width', '906');
    progressFill.style.width = '100%';
    markSeen();
    setBackgroundInert(true);
    overlay.setAttribute('aria-hidden', 'false');
    root.classList.add('intro-pending');
    window.setTimeout(() => finishIntro('auto'), 1300);
    skipButton?.focus({ preventScroll: true });
  }

  async function beginIntro(isReplay = false) {
    if (active) return;
    active = true;
    completed = false;
    leaving = false;
    previousFocus = document.activeElement;
    setBackgroundInert(true);
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.remove('is-complete', 'is-leaving', 'is-drawing');

    if (isReplay) {
      root.classList.add('intro-pending');
      overlay.classList.add('is-entering');
    }

    if (reduceQuery.matches) {
      showReducedIntro();
      return;
    }

    welcome.inert = true;
    welcome.setAttribute('aria-hidden', 'true');
    revealRect.setAttribute('x', '60');
    revealRect.setAttribute('width', '0');
    progressFill.style.width = '0%';
    setPencilAt(startPoint.x + 46, startPoint.y + 132, pencilAngle(0));
    pencil.style.opacity = '0';
    overlay.classList.add('is-drawing');
    setSoundUI();

    if (isReplay && soundEnabled) startScratch();
    else {
      const unlock = () => {
        if (active && soundEnabled) startScratch();
      };
      overlay.addEventListener('pointerdown', unlock, { once: true });
      overlay.addEventListener('keydown', unlock, { once: true });
    }

    skipButton?.focus({ preventScroll: true });

    if (document.fonts && document.fonts.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 900))
      ]);
    }

    if (!active) return;
    pencil.style.opacity = '1';
    startTime = performance.now();
    rafId = window.requestAnimationFrame(tick);
  }

  function replayIntro() {
    if (active || leaving) return;
    soundEnabled = readSoundPref();
    setSoundUI();
    if (reduceQuery.matches) {
      active = true;
      completed = true;
      leaving = false;
      previousFocus = document.activeElement;
      root.classList.add('intro-pending');
      showReducedIntro();
      return;
    }
    beginIntro(true);
  }

  soundButton?.addEventListener('click', toggleSound);
  skipButton?.addEventListener('click', () => finishIntro('skip'));
  enterButton?.addEventListener('click', () => finishIntro('enter'));
  replayButton?.addEventListener('click', replayIntro);

  document.addEventListener('keydown', (event) => {
    if (!active) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      finishIntro('escape');
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = Array.from(overlay.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((element) => element.tabIndex >= 0
        && !element.disabled
        && element.getClientRects().length > 0
        && !element.closest('[inert]'));

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
  });

  setSoundUI();

  const shouldShow = root.classList.contains('intro-pending') && !readSeen();

  if (reduceQuery.matches) {
    if (!readSeen()) markSeen();
    root.classList.remove('intro-pending');
    overlay.setAttribute('aria-hidden', 'true');
    return;
  }

  if (shouldShow) {
    beginIntro(false).catch(() => {
      root.classList.remove('intro-pending');
      overlay.setAttribute('aria-hidden', 'true');
      markSeen();
    });
  } else {
    root.classList.remove('intro-pending');
    overlay.setAttribute('aria-hidden', 'true');
  }
})();

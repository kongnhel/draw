(() => {
  'use strict';

  const READY_KEY = 'artspace-intro-seen-v1';
  const SOUND_KEY = 'artspace-intro-sound';
  const DURATION = 3800;
  const ENTRY = 600;
  const GESTURES = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

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
  const soundLabel = overlay.querySelector('[data-intro-sound-label]');
  const soundButton = overlay.querySelector('[data-intro-sound-toggle]');
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
  let audioCtx = null;
  let noiseBuffer = null;
  let roomSource = null;
  let roomGain = null;
  let scratchSource = null;
  let scratchGain = null;
  let scratchFilter = null;
  let scratchTimer = null;
  let audioCloseTimer = null;
  let audioBound = false;
  let soundEnabled = readSoundPref();

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

  function storeSoundPref() {
    try {
      window.localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off');
    } catch (error) {
      /* private browsing */
    }
  }

  function updateSoundButton() {
    const on = soundEnabled;
    if (soundButton) {
      soundButton.setAttribute('aria-pressed', String(on));
      soundButton.setAttribute('aria-label', on ? 'Mute intro sound' : 'Enable intro sound');
      soundButton.title = on ? 'Mute intro sound' : 'Enable intro sound';
    }
    overlay.classList.toggle('has-audio', on && !reduceQuery.matches && active && !completed && !leaving);
    if (soundLabel) soundLabel.textContent = on ? 'Sound on' : 'Sound off';
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
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * 0.9;
    }
    noiseBuffer = buffer;
    return buffer;
  }

  function startRoomTone() {
    if (!active || completed || leaving || reduceQuery.matches || !soundEnabled || roomSource) return;
    const ctx = ensureAudio();
    if (!ctx) return;

    const source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer(ctx);
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 460;
    filter.Q.value = 0.3;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    gain.gain.setTargetAtTime(0.016, ctx.currentTime, 0.8);

    roomSource = source;
    roomGain = gain;
  }

  function stopRoomTone() {
    if (roomGain && audioCtx) {
      try {
        roomGain.gain.cancelScheduledValues(audioCtx.currentTime);
        roomGain.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.22);
      } catch (error) {
        /* already disconnected */
      }
    }

    if (roomSource) {
      const source = roomSource;
      roomSource = null;
      window.setTimeout(() => {
        try {
          source.stop();
        } catch (error) {
          /* already stopped */
        }
      }, 480);
    }

    roomGain = null;
  }

  function startScratch() {
    if (!active || completed || leaving || reduceQuery.matches || !soundEnabled) return;
    if (scratchSource) return;

    const ctx = ensureAudio();
    if (!ctx) return;

    const source = ctx.createBufferSource();
    source.buffer = getNoiseBuffer(ctx);
    source.loop = true;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 460;
    highpass.Q.value = 0.55;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1650;
    bandpass.Q.value = 0.75;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    scratchSource = source;
    scratchGain = gain;
    scratchFilter = bandpass;

    const modulate = () => {
      if (!scratchGain || !scratchFilter || !audioCtx || audioCtx.state === 'closed') return;
      const now = audioCtx.currentTime;
      const level = 0.05 + Math.random() * 0.05;
      scratchGain.gain.setTargetAtTime(level, now, 0.06);
      scratchFilter.frequency.setTargetAtTime(1200 + Math.random() * 1500, now, 0.08);
      scratchTimer = window.setTimeout(modulate, 62 + Math.random() * 84);
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
    scratchFilter = null;
  }

  function playEntryTap() {
    if (reduceQuery.matches) return;
    const ctx = ensureAudio();
    if (!ctx) return;

    const now = ctx.currentTime;

    const oscillator = ctx.createOscillator();
    const toneGain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(190, now);
    oscillator.frequency.exponentialRampToValueAtTime(85, now + 0.13);
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.exponentialRampToValueAtTime(0.05, now + 0.015);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(toneGain);
    toneGain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);

    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.9;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.028, now + 0.012);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.12);
  }

  function playFinishChime() {
    if (reduceQuery.matches) return;
    const ctx = ensureAudio();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [
      { frequency: 523.25, start: 0, duration: 0.55, gain: 0.032 },
      { frequency: 659.25, start: 0.13, duration: 0.66, gain: 0.028 },
      { frequency: 783.99, start: 0.26, duration: 0.82, gain: 0.024 }
    ];

    notes.forEach((note) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, now + note.start);
      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(note.gain, now + note.start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now + note.start);
      oscillator.stop(now + note.start + note.duration + 0.03);
    });

    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1300, now);
    filter.frequency.linearRampToValueAtTime(2600, now + 0.5);
    filter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.02, now + 0.08);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.65);
  }

  function closeAudioSoon(delay = 1100) {
    window.clearTimeout(audioCloseTimer);
    stopRoomTone();
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

  function activateAudio() {
    if (!active || completed || leaving || !soundEnabled || reduceQuery.matches) return;
    const ctx = ensureAudio();
    if (!ctx || ctx.state !== 'running') return;
    updateSoundButton();
    playEntryTap();
    startRoomTone();
    startScratch();
    unbindAudioUnlock();
  }

  function unlockAudio() {
    if (!soundEnabled) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'running') {
      activateAudio();
      return;
    }
    ctx.resume().then(() => {
      if (ctx.state === 'running') activateAudio();
    }).catch(() => {});
  }

  function tryAudioNow() {
    if (!soundEnabled) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'running') {
      activateAudio();
      return;
    }
    ctx.resume().then(() => {
      if (ctx.state === 'running') activateAudio();
    }).catch(() => {});
  }

  function bindAudioUnlock() {
    if (!soundEnabled || audioBound) return;
    audioBound = true;
    GESTURES.forEach((type) => {
      window.addEventListener(type, unlockAudio, { capture: true, passive: true });
    });
  }

  function unbindAudioUnlock() {
    if (!audioBound) return;
    audioBound = false;
    GESTURES.forEach((type) => {
      window.removeEventListener(type, unlockAudio, { capture: true });
    });
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

  function spawnParticle(x, y, strength = 1) {
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
    particle.style.opacity = String(clamp(0.28 + Math.random() * 0.4, 0.2, 0.7) * strength);
    const size = 1 + Math.random() * 1.9;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particles.appendChild(particle);

    const driftX = (Math.random() - 0.5) * 18;
    const driftY = 8 + Math.random() * 22;
    const animation = particle.animate(
      [
        { opacity: particle.style.opacity, transform: 'translate(0, 0) scale(1)' },
        { opacity: 0, transform: `translate(${driftX}px, ${driftY}px) scale(0.3)` }
      ],
      { duration: 520 + Math.random() * 460, easing: 'ease-out' }
    );
    animation.onfinish = () => particle.remove();
  }

  function spawnEntryBurst() {
    if (!particles || lowPerf) return;
    const count = 10;
    for (let index = 0; index < count; index += 1) {
      const offsetX = startPoint.x + 40 + (Math.random() - 0.5) * 18;
      const offsetY = startPoint.y + 120 + (Math.random() - 0.5) * 26;
      spawnParticle(offsetX, offsetY, 0.7);
    }
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

    if (!lowPerf && now - lastParticleAt > 32) {
      lastParticleAt = now;
      spawnParticle(point.x - 1, point.y + 3);
      if (Math.random() > 0.6) spawnParticle(point.x + 4, point.y + 7, 0.8);
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
    closeAudioSoon(1600);
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
    stopRoomTone();
    closeAudioSoon(300);
    unbindAudioUnlock();
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
    unbindAudioUnlock();

    if (reason === 'skip' || reason === 'escape') {
      stopScratch();
      stopRoomTone();
      closeAudioSoon(260);
    }

    overlay.classList.remove('is-entering', 'is-drawing');
    overlay.classList.add('is-leaving');
    const delay = reduceQuery.matches ? 0 : 560;

    leaveTimer = window.setTimeout(() => {
      root.classList.remove('intro-pending');
      overlay.classList.remove('is-leaving', 'is-complete', 'has-audio');
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
    overlay.classList.remove('is-complete', 'is-leaving', 'is-drawing', 'has-audio');
    updateSoundButton();

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
    if (soundEnabled) {
      bindAudioUnlock();
      tryAudioNow();
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
    spawnEntryBurst();
    rafId = window.requestAnimationFrame(tick);
  }

  function replayIntro() {
    if (active || leaving) return;
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

  const onIntroSoundToggle = () => {
    soundEnabled = !soundEnabled;
    storeSoundPref();
    if (soundEnabled) {
      updateSoundButton();
      if (active && !completed && !leaving) tryAudioNow();
    } else {
      stopScratch();
      stopRoomTone();
      unbindAudioUnlock();
      overlay.classList.remove('has-audio');
      updateSoundButton();
      closeAudioSoon(300);
    }
  };
  soundButton?.addEventListener('click', onIntroSoundToggle);

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

(() => {
  const layer = document.querySelector('.bg-falling');
  const canvas = document.querySelector('[data-bg-falling]');
  if (!layer || !canvas) return;

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const effectsKey = 'artspace-art-effects';

  const readLowPerf = () => {
    if (document.documentElement.getAttribute('data-perf') === 'low') return true;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const memory = Number(navigator.deviceMemory) || 8;
    const cores = Number(navigator.hardwareConcurrency) || 8;
    return memory <= 2
      || (memory <= 4 && cores <= 4)
      || Boolean(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')));
  };

  const ICON_SVGS = {
    pencil: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v12.5l-3 4.8-3-4.8V3Z"/><path d="M9 6.5h6"/><path d="M9 15.5h6"/><path d="M9 15.5h6L12 20.3Z" fill="__ACCENT__" stroke="none" opacity=".55"/></svg>',
    brush: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15.6 3.4 9 10l2 2 6.6-6.6a1.42 1.42 0 0 0-2-2Z"/><path d="m9 10 2 2"/><path d="M10.4 10.6c-2.4.4-4 2-4.7 4.7 1.9.5 3.8 0 5.7-1.8" stroke="__ACCENT__"/></svg>',
    palette: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.2c-4.4 0-7.8 3-7.8 7 0 3.4 2.4 5.6 4.8 5.6 1.6 0 2.4-.9 2.4-2 0-1.2-1-1.7-1-2.7 0-1.2 1-2 2.2-2h2.1c2 0 3.5-1.4 3.5-3.2 0-1.6-2.4-2.7-6.2-2.7Z"/><circle cx="8.6" cy="8.4" r=".8" fill="__ACCENT__" stroke="none"/><circle cx="12" cy="6.8" r=".8" fill="__ACCENT__" stroke="none"/><circle cx="15.4" cy="8.2" r=".8" fill="__ACCENT__" stroke="none"/></svg>',
    eraser: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14.5 14.7 5a2 2 0 0 1 2.8 0l1.9 1.9a2 2 0 0 1 0 2.8L10.6 18.5H7.4L6 17.2a2 2 0 0 1 0-2.7Z"/><path d="m11.2 8.6 5.4 5.4"/><path d="M10.6 18.5h8.4"/></svg>',
    sharpener: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4.2" y="7.6" width="15.6" height="8.8" rx="2.2"/><circle cx="9.2" cy="12" r="2.2" stroke="__ACCENT__"/><path d="M13.4 12h4.2M7 19.6h10"/></svg>',
    ruler: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 14.8 14.8 3.2l6 6L9.2 20.8l-6-6Z"/><path d="m8 10.4 1.6 1.6M11 7.4l1.6 1.6M5.6 12.8l1.6 1.6M13.8 4.6l1.6 1.6" stroke="__ACCENT__"/></svg>',
    paintTube: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 6.5h7v11a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-11Z"/><path d="M8.5 6.5 10.5 3h3l2 3.5"/><path d="M8.5 10h7"/><path d="M10.4 15.2c1 .9 2.2.9 3.2 0" stroke="__ACCENT__"/></svg>',
    pen: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16.8 3.5a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8l-9 9-4.6 1.6 1.6-4.6 9-9Z"/><path d="m14.6 5.7 3.7 3.7"/><path d="M5.4 18.6 4 20l-1.4-1.4L4 17.2" stroke="__ACCENT__"/></svg>',
    marker: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14.2 3.6 20 9.4l-6.4 6.4-5.8-5.8 6.4-6.4Z"/><path d="m7.8 10 5.8 5.8-5.2 5.2H4.6v-3.8L7.8 10Z"/><path d="M4.6 21h14.8" stroke="__ACCENT__"/></svg>',
    droplet: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5c3.3 4 5.2 6.8 5.2 9.4a5.2 5.2 0 1 1-10.4 0c0-2.6 1.9-5.4 5.2-9.4Z"/><path d="M9.4 14.2c.2 1.5 1.2 2.5 2.7 2.8" stroke="__ACCENT__"/></svg>',
    cube: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__INK__" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4 20 7.6v8.8L12 20.6 4 16.4V7.6L12 3.4Z"/><path d="M4 7.6 12 12l8-4.4M12 12v8.6" stroke="__ACCENT__"/></svg>',
  };

  const SCENES = {
    mixed: ['pencil', 'brush', 'palette', 'eraser', 'sharpener', 'ruler', 'paintTube', 'pen', 'marker', 'droplet', 'cube'],
    sketch: ['pencil', 'eraser', 'sharpener', 'ruler', 'pencil'],
    portrait: ['pencil', 'eraser', 'brush', 'pencil'],
    watercolor: ['brush', 'paintTube', 'droplet', 'palette'],
    oil: ['brush', 'palette', 'paintTube', 'ruler'],
    digital: ['pen', 'cube', 'ruler', 'pen'],
    anime: ['pen', 'marker', 'pencil', 'eraser'],
    character: ['pencil', 'marker', 'ruler', 'eraser'],
    abstract: ['palette', 'paintTube', 'droplet', 'brush'],
    landscape: ['pencil', 'brush', 'ruler', 'eraser'],
    threeD: ['cube', 'pen', 'ruler'],
  };

  const ROTATION = ['sketch', 'watercolor', 'oil', 'digital', 'anime', 'abstract', 'landscape', 'character', 'mixed'];
  const SCENE_ALIASES = {
    pencil: 'sketch',
    pencildrawing: 'sketch',
    sketching: 'sketch',
    portraitdrawing: 'portrait',
    watercolour: 'watercolor',
    oilpainting: 'oil',
    digitalart: 'digital',
    '3d': 'threeD',
    '3dart': 'threeD',
    animemanga: 'anime',
    mangaanime: 'anime',
    characterdesign: 'character',
    abstractart: 'abstract',
    landscapedrawing: 'landscape',
    otherart: 'mixed',
    all: 'mixed',
  };

  const normalizeKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const resolveScene = (raw) => {
    const key = normalizeKey(raw);
    if (!key) {
      const index = Math.floor(Date.now() / 86400000) % ROTATION.length;
      return ROTATION[index];
    }
    if (SCENES[key]) return key;
    if (SCENE_ALIASES[key]) return SCENE_ALIASES[key];
    const partial = Object.keys(SCENES).find((name) => key.includes(name));
    if (partial) return partial;
    if (key.includes('water')) return 'watercolor';
    if (key.includes('oil')) return 'oil';
    if (key.includes('digital') || key.includes('3d')) return 'digital';
    if (key.includes('anime') || key.includes('manga')) return 'anime';
    if (key.includes('character')) return 'character';
    if (key.includes('abstract')) return 'abstract';
    if (key.includes('landscape')) return 'landscape';
    if (key.includes('portrait')) return 'portrait';
    if (key.includes('pencil') || key.includes('sketch')) return 'sketch';
    return 'mixed';
  };

  const scene = resolveScene(canvas.dataset.scene || document.body?.dataset.bgScene);
  const sceneIcons = SCENES[scene] || SCENES.mixed;
  canvas.dataset.sceneActive = scene;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const TAU = Math.PI * 2;
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let imageCache = new Map();
  let themeKey = '';
  let rafId = 0;
  let lastTime = 0;
  let running = false;
  let enabled = true;
  let lowPerf = readLowPerf();

  const readColors = () => {
    const styles = getComputedStyle(document.documentElement);
    const ink = (styles.getPropertyValue('--muted') || '').trim() || '#77736c';
    const accent = (styles.getPropertyValue('--secondary') || '').trim() || '#9a8066';
    return { ink, accent };
  };

  const buildImages = () => {
    const { ink, accent } = readColors();
    const key = `${ink}|${accent}`;
    if (key === themeKey) return;
    themeKey = key;
    imageCache = new Map();

    Object.entries(ICON_SVGS).forEach(([name, markup]) => {
      const svg = markup.split('__INK__').join(ink).split('__ACCENT__').join(accent);
      const image = new Image();
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      imageCache.set(name, image);
    });
  };

  const desiredCount = () => {
    const area = width * height;
    const base = Math.round(area / 120000);
    const mobile = width < 640;
    const max = lowPerf ? (mobile ? 5 : 7) : 15;
    return clamp(mobile ? base - 1 : base, mobile ? 4 : 6, max);
  };

  const createParticle = (spawnAnywhere = false) => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const size = rand(20, 42) * (width < 640 ? 0.82 : 1);
    return {
      icon: pick(sceneIcons),
      size,
      x: rand(-20, width + 20),
      y: spawnAnywhere ? rand(-height, height) : rand(-height * 0.6, -size),
      speed: rand(13, 30),
      sway: rand(8, 26),
      swayFreq: rand(0.25, 0.7),
      phase: rand(0, TAU),
      rotation: rand(0, TAU),
      spin: rand(-0.35, 0.35),
      alpha: isDark ? rand(0.18, 0.32) : rand(0.14, 0.26),
      age: spawnAnywhere ? rand(0.6, 1.4) : 0,
    };
  };

  const respawn = (particle) => {
    const fresh = createParticle(false);
    Object.assign(particle, fresh, { x: rand(-20, width + 20) });
  };

  const syncParticles = () => {
    const target = desiredCount();
    while (particles.length < target) particles.push(createParticle(true));
    if (particles.length > target) particles.length = target;
  };

  const resize = () => {
    lowPerf = readLowPerf();
    dpr = Math.min(window.devicePixelRatio || 1, lowPerf ? 1 : 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncParticles();
  };

  const frame = (time) => {
    if (!running) return;
    const elapsed = time || 0;
    const dt = Math.min(0.05, (elapsed - lastTime) / 1000 || 0.016);
    lastTime = elapsed;
    const seconds = elapsed / 1000;

    ctx.clearRect(0, 0, width, height);

    for (const particle of particles) {
      particle.y += particle.speed * dt;
      particle.rotation += particle.spin * dt;
      particle.age = Math.min(particle.age + dt, 1.4);

      if (particle.y - particle.size > height) {
        respawn(particle);
        continue;
      }

      const drawX = particle.x + Math.sin(particle.phase + seconds * particle.swayFreq) * particle.sway;
      const fade = Math.min(1, particle.age / 0.9);
      const image = imageCache.get(particle.icon);
      if (!image || !image.complete || !image.naturalWidth) continue;

      ctx.save();
      ctx.globalAlpha = particle.alpha * fade;
      ctx.translate(drawX, particle.y);
      ctx.rotate(particle.rotation);
      ctx.drawImage(image, -particle.size / 2, -particle.size / 2, particle.size, particle.size);
      ctx.restore();
    }

    rafId = window.requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || !enabled) return;
    running = true;
    lastTime = 0;
    rafId = window.requestAnimationFrame(frame);
  };

  const stop = () => {
    running = false;
    window.cancelAnimationFrame(rafId);
    ctx.clearRect(0, 0, width, height);
  };

  const evaluate = () => {
    lowPerf = readLowPerf();
    const effectsOff = (() => {
      try { return localStorage.getItem(effectsKey) === 'off'; } catch { return false; }
    })();
    enabled = !lowPerf && !reducedMotionQuery.matches && !effectsOff;
    layer.dataset.bgMotion = enabled ? 'on' : 'off';
    if (enabled) start();
    else stop();
  };

  resize();

  const boot = () => {
    buildImages();
    evaluate();
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(boot, { timeout: 1500 });
  } else {
    window.setTimeout(boot, 250);
  }

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
    });
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else evaluate();
  });

  reducedMotionQuery.addEventListener?.('change', evaluate);

  window.addEventListener('storage', (event) => {
    if (event.key === effectsKey) evaluate();
  });

  new MutationObserver(() => {
    buildImages();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.ArtSpaceBackground = {
    get scene() { return scene; },
    get count() { return particles.length; },
    get running() { return running; },
  };
})();

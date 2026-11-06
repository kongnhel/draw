(() => {
  'use strict';

  const MOOD_KEY = 'artspace-mood-v1';
  const VOLUME_KEY = 'artspace-mood-volume-v1';
  const STARTED_KEY = 'artspace-mood-started-v1';
  const DEFAULT_MOOD = 'cool';
  const DEFAULT_VOLUME = 0.45;
  const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
  const TAU = Math.PI * 2;

  const MOODS = {
    cool: { label: 'COOL', emoji: '❄️', note: 'Snowfall · chill lo-fi' },
    love: { label: 'LOVE', emoji: '💕', note: 'Soft hearts · love piano' },
    romantic: { label: 'ROMANTIC', emoji: '🌹', note: 'Rose petals · dreamy piano' },
    sad: { label: 'SAD', emoji: '🌧️', note: 'Rain · melancholic piano' }
  };

  const MUSIC = {
    cool: {
      bpm: 66,
      chords: [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]],
      scale: [62, 64, 66, 69, 71, 74, 76, 78],
      arp: [0, 2, 1, 3, -1, 2, 1, 3],
      melody: [-1, 3, -1, -1, 5, -1, 4, -1, -1, 2, -1, 3, -1, -1, 1, -1, -1, 4, -1, -1, 6, -1, 5, -1, -1, 3, -1, 2, -1, -1, 1, -1],
      arpTone: 'keys',
      arpDuration: 1.4,
      arpVelocity: 0.05,
      melodyTone: 'keys',
      melodyDuration: 2.1,
      melodyVelocity: 0.045,
      padLevel: 0.1,
      padCutoff: 820,
      bassLevel: 0.11,
      reverb: 0.2,
      noise: 'vinyl',
      noiseLevel: 0.012,
      brush: true,
      kick: true
    },
    love: {
      bpm: 52,
      chords: [[41, 48, 53, 57], [38, 45, 50, 53], [46, 53, 57, 62], [36, 43, 48, 52]],
      scale: [53, 55, 57, 58, 60, 62, 64, 65, 67, 69, 70, 72],
      arp: [0, 2, 1, 3, 2, 1, 0, 2],
      melody: [-1, -1, 4, -1, -1, 6, -1, -1, 3, -1, -1, 5, -1, 4, -1, -1, -1, 2, -1, -1, 4, -1, -1, 5, -1, -1, 6, -1, -1, 3, -1, -1],
      arpTone: 'piano',
      arpDuration: 2.2,
      arpVelocity: 0.05,
      melodyTone: 'bell',
      melodyDuration: 3,
      melodyVelocity: 0.04,
      padLevel: 0.1,
      padCutoff: 920,
      bassLevel: 0.095,
      reverb: 0.34,
      noise: null,
      noiseLevel: 0,
      brush: false,
      kick: false
    },
    romantic: {
      bpm: 48,
      chords: [[39, 46, 51, 55], [36, 43, 48, 51], [44, 51, 55, 58], [46, 53, 57, 62]],
      scale: [58, 60, 63, 65, 67, 70, 72, 75, 77],
      arp: [0, 2, 3, 1, 2, 0, 3, 2],
      melody: [-1, 3, -1, -1, 5, -1, 6, -1, -1, 4, -1, -1, 7, -1, 5, -1, -1, 2, -1, -1, 4, -1, -1, 6, -1, -1, 3, -1, -1, 5, -1, -1],
      arpTone: 'piano',
      arpDuration: 2.7,
      arpVelocity: 0.046,
      melodyTone: 'bell',
      melodyDuration: 3.4,
      melodyVelocity: 0.038,
      padLevel: 0.125,
      padCutoff: 1080,
      bassLevel: 0.08,
      reverb: 0.42,
      noise: null,
      noiseLevel: 0,
      brush: false,
      kick: false,
      shimmer: true
    },
    sad: {
      bpm: 44,
      chords: [[45, 52, 57, 60], [41, 48, 53, 57], [36, 43, 48, 52], [40, 47, 52, 56]],
      scale: [57, 60, 62, 64, 65, 67, 69, 72],
      arp: [0, -1, -1, 2, -1, -1, 1, -1],
      melody: [-1, -1, -1, 2, -1, -1, -1, -1, 4, -1, -1, -1, -1, 3, -1, -1, -1, -1, 1, -1, -1, -1, -1, 5, -1, -1, -1, 3, -1, -1, -1, -1],
      arpTone: 'piano',
      arpDuration: 3.1,
      arpVelocity: 0.038,
      melodyTone: 'piano',
      melodyDuration: 3.8,
      melodyVelocity: 0.038,
      padLevel: 0.085,
      padCutoff: 720,
      bassLevel: 0.075,
      reverb: 0.46,
      noise: 'rain',
      noiseLevel: 0.03,
      brush: false,
      kick: false
    }
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const storage = {
    get(key, fallback) {
      try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, String(value));
      } catch (error) {
        /* storage unavailable */
      }
    }
  };

  const readMood = () => {
    const value = storage.get(MOOD_KEY, DEFAULT_MOOD);
    return MOODS[value] ? value : DEFAULT_MOOD;
  };

  const readVolume = () => {
    const value = Number.parseFloat(storage.get(VOLUME_KEY, ''));
    return Number.isFinite(value) ? clamp(value, 0, 1) : DEFAULT_VOLUME;
  };

  const readStarted = () => storage.get(STARTED_KEY, '') === '1';

  const motionQuery = window.matchMedia(MOTION_QUERY);

  let dom = null;
  let currentMood = readMood();
  let visualMood = null;
  let volume = readVolume();
  let experienceStarted = readStarted();
  let reducedMotion = motionQuery.matches;
  let mutedMemory = volume > 0 ? volume : DEFAULT_VOLUME;
  let activeScene = null;
  let sceneTimers = new Set();
  let panelOpen = false;
  let startOverlayOpen = false;
  let introWatcher = null;
  let introTimer = 0;
  let lastFocusedElement = null;

  const audioEngine = (() => {
    const AudioConstructor = window.AudioContext || window.webkitAudioContext;
    const supported = Boolean(AudioConstructor);
    const tracks = new Set();
    const noiseCache = new Map();
    let context = null;
    let master = null;
    let reverb = null;
    let reverbReturn = null;
    let activeTrack = null;
    let volumeLevel = DEFAULT_VOLUME;
    let stateListener = null;

    const masterLevel = (value) => (value <= 0 ? 0 : Math.pow(clamp(value, 0, 1), 1.35) * 0.9);

    const makeImpulse = (duration, decay) => {
      const rate = context.sampleRate;
      const length = Math.max(1, Math.floor(rate * duration));
      const buffer = context.createBuffer(2, length, rate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < length; index += 1) {
          const ratio = index / length;
          data[index] = (Math.random() * 2 - 1) * Math.pow(1 - ratio, decay) * (1 - ratio * 0.2);
        }
      }
      return buffer;
    };

    const ensure = () => {
      if (!supported) return null;
      if (context && context.state === 'closed') {
        context = null;
        master = null;
        reverb = null;
        reverbReturn = null;
      }
      if (context) return context;

      try {
        context = new AudioConstructor();
      } catch (error) {
        return null;
      }

      master = context.createGain();
      master.gain.value = masterLevel(volumeLevel);

      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 24;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.02;
      compressor.release.value = 0.4;

      master.connect(compressor);
      compressor.connect(context.destination);

      reverb = context.createConvolver();
      reverb.buffer = makeImpulse(2.9, 2.3);
      reverbReturn = context.createGain();
      reverbReturn.gain.value = 0.55;
      reverb.connect(reverbReturn);
      reverbReturn.connect(master);

      context.onstatechange = () => {
        if (stateListener) stateListener();
      };

      return context;
    };

    const resume = () => {
      const ctx = ensure();
      if (!ctx) return Promise.resolve(false);
      if (ctx.state === 'suspended') {
        return ctx.resume().then(() => true).catch(() => false);
      }
      return Promise.resolve(ctx.state === 'running');
    };

    const getNoiseBuffer = (kind) => {
      if (noiseCache.has(kind)) return noiseCache.get(kind);
      const seconds = kind === 'vinyl' ? 4 : 3;
      const length = Math.max(1, Math.floor(context.sampleRate * seconds));
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);

      if (kind === 'vinyl') {
        for (let index = 0; index < length; index += 1) {
          data[index] = (Math.random() * 2 - 1) * 0.045;
        }
        const pops = Math.floor(length / 2200);
        for (let index = 0; index < pops; index += 1) {
          const at = Math.floor(Math.random() * length);
          data[at] += (Math.random() * 2 - 1) * (0.35 + Math.random() * 0.5);
        }
      } else {
        for (let index = 0; index < length; index += 1) {
          data[index] = (Math.random() * 2 - 1) * 0.7;
        }
      }

      noiseCache.set(kind, buffer);
      return buffer;
    };

    const startNoiseLoop = (track, kind, level) => {
      if (!context || level <= 0) return;
      const source = context.createBufferSource();
      source.buffer = getNoiseBuffer(kind);
      source.loop = true;

      const highpass = context.createBiquadFilter();
      const lowpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      lowpass.type = 'lowpass';

      if (kind === 'rain') {
        highpass.frequency.value = 340;
        highpass.Q.value = 0.2;
        lowpass.frequency.value = 2200;
        lowpass.Q.value = 0.4;
      } else {
        highpass.frequency.value = 1100;
        highpass.Q.value = 0.5;
        lowpass.frequency.value = 6200;
        lowpass.Q.value = 0.3;
      }

      const gain = context.createGain();
      gain.gain.value = level;

      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(track.bus);

      source.start();
      track.sources.add(source);

      source.onended = () => {
        track.sources.delete(source);
        try { source.disconnect(); } catch (error) { /* already disconnected */ }
        try { highpass.disconnect(); } catch (error) { /* already disconnected */ }
        try { lowpass.disconnect(); } catch (error) { /* already disconnected */ }
        try { gain.disconnect(); } catch (error) { /* already disconnected */ }
      };
    };

    const playKey = (track, frequency, when, duration, velocity, tone, pan) => {
      if (!context || track.dead) return;

      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();

      oscillator.type = tone === 'bell' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, when);

      filter.type = 'lowpass';
      filter.Q.value = tone === 'bell' ? 0.3 : 0.55;
      filter.frequency.setValueAtTime(Math.min(8000, Math.max(1200, frequency * 5)), when);
      filter.frequency.exponentialRampToValueAtTime(Math.max(420, frequency * 1.5), when + Math.min(duration * 0.8, 1.6));

      const attack = tone === 'bell' ? 0.004 : 0.009;
      envelope.gain.setValueAtTime(0.0001, when);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, velocity), when + attack);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);

      oscillator.connect(filter);
      filter.connect(envelope);

      let output = envelope;
      if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner();
        panner.pan.value = clamp(pan || 0, -1, 1);
        envelope.connect(panner);
        panner.connect(track.bus);
        output = panner;
      } else {
        envelope.connect(track.bus);
      }

      const oscillators = [oscillator];
      let body = null;

      if (tone !== 'bell') {
        body = context.createOscillator();
        body.type = 'sine';
        body.frequency.setValueAtTime(frequency * 2.003, when);
        const bodyGain = context.createGain();
        bodyGain.gain.value = tone === 'piano' ? 0.24 : 0.16;
        body.connect(bodyGain);
        bodyGain.connect(filter);
        oscillators.push(body);
      }

      oscillators.forEach((item) => {
        item.start(when);
        item.stop(when + duration + 0.04);
        track.sources.add(item);
      });

      oscillator.onended = () => {
        track.sources.delete(oscillator);
        oscillators.forEach((item) => track.sources.delete(item));
        try { oscillator.disconnect(); } catch (error) { /* already disconnected */ }
        try { filter.disconnect(); } catch (error) { /* already disconnected */ }
        try { envelope.disconnect(); } catch (error) { /* already disconnected */ }
        try { output.disconnect(); } catch (error) { /* already disconnected */ }
        if (body) {
          try { body.disconnect(); } catch (error) { /* already disconnected */ }
        }
      };
    };

    const playPad = (track, notes, when, duration, level, cutoff) => {
      if (!context || track.dead) return;

      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      const attack = Math.min(2, duration * 0.32);
      const release = Math.min(2.4, duration * 0.4);
      const sustainEnd = Math.max(when + attack + 0.02, when + duration - release);

      filter.type = 'lowpass';
      filter.Q.value = 0.4;
      filter.frequency.setValueAtTime(cutoff * 0.55, when);
      filter.frequency.linearRampToValueAtTime(cutoff, when + duration * 0.55);
      filter.frequency.linearRampToValueAtTime(cutoff * 0.62, when + duration);

      envelope.gain.setValueAtTime(0.0001, when);
      envelope.gain.linearRampToValueAtTime(level, when + attack);
      envelope.gain.setValueAtTime(level, sustainEnd);
      envelope.gain.linearRampToValueAtTime(0.0001, when + duration);

      filter.connect(envelope);
      envelope.connect(track.bus);

      const oscillators = [];

      notes.forEach((midi, index) => {
        const frequency = midiToFreq(midi);
        const noteGain = context.createGain();
        noteGain.gain.value = index === 0 ? 0.2 : 0.12;

        const warm = context.createOscillator();
        warm.type = index === 0 ? 'sine' : 'triangle';
        warm.frequency.setValueAtTime(frequency, when);
        warm.detune.value = -3;

        const air = context.createOscillator();
        air.type = 'sawtooth';
        air.frequency.setValueAtTime(frequency, when);
        air.detune.value = 4;

        warm.connect(noteGain);
        air.connect(noteGain);
        noteGain.connect(filter);
        oscillators.push(warm, air);

        [warm, air].forEach((item) => {
          item.start(when);
          item.stop(when + duration + 0.08);
          track.sources.add(item);
        });
      });

      const cleanup = () => {
        oscillators.forEach((item) => track.sources.delete(item));
        try { filter.disconnect(); } catch (error) { /* already disconnected */ }
        try { envelope.disconnect(); } catch (error) { /* already disconnected */ }
      };
      oscillators[0].onended = cleanup;
    };

    const playBass = (track, midi, when, duration, level) => {
      if (!context || track.dead) return;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const filter = context.createBiquadFilter();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(midiToFreq(midi), when);
      filter.type = 'lowpass';
      filter.frequency.value = 360;
      filter.Q.value = 0.5;

      envelope.gain.setValueAtTime(0.0001, when);
      envelope.gain.linearRampToValueAtTime(level, when + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);

      oscillator.connect(filter);
      filter.connect(envelope);
      envelope.connect(track.bus);

      oscillator.start(when);
      oscillator.stop(when + duration + 0.05);
      track.sources.add(oscillator);

      oscillator.onended = () => {
        track.sources.delete(oscillator);
        try { oscillator.disconnect(); } catch (error) { /* already disconnected */ }
        try { filter.disconnect(); } catch (error) { /* already disconnected */ }
        try { envelope.disconnect(); } catch (error) { /* already disconnected */ }
      };
    };

    const playBrush = (track, when, level) => {
      if (!context || track.dead) return;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();

      source.buffer = getNoiseBuffer('rain');
      filter.type = 'bandpass';
      filter.frequency.value = 1900;
      filter.Q.value = 0.7;

      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(level, when + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(track.bus);

      source.start(when);
      source.stop(when + 0.14);
      track.sources.add(source);

      source.onended = () => {
        track.sources.delete(source);
        try { source.disconnect(); } catch (error) { /* already disconnected */ }
        try { filter.disconnect(); } catch (error) { /* already disconnected */ }
        try { gain.disconnect(); } catch (error) { /* already disconnected */ }
      };
    };

    const playKick = (track, when, level) => {
      if (!context || track.dead) return;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(110, when);
      oscillator.frequency.exponentialRampToValueAtTime(44, when + 0.22);

      envelope.gain.setValueAtTime(0.0001, when);
      envelope.gain.linearRampToValueAtTime(level, when + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + 0.34);

      oscillator.connect(envelope);
      envelope.connect(track.bus);

      oscillator.start(when);
      oscillator.stop(when + 0.38);
      track.sources.add(oscillator);

      oscillator.onended = () => {
        track.sources.delete(oscillator);
        try { oscillator.disconnect(); } catch (error) { /* already disconnected */ }
        try { envelope.disconnect(); } catch (error) { /* already disconnected */ }
      };
    };

    const scheduleStep = (track, step, when) => {
      const config = track.config;
      const chordIndex = Math.floor(step / 8) % config.chords.length;
      const stepInChord = step % 8;
      const chord = config.chords[chordIndex];

      if (stepInChord === 0) {
        const chordDuration = track.stepDuration * 8;
        playPad(track, chord, when, chordDuration + 0.5, config.padLevel, config.padCutoff);
        playBass(track, chord[0] - 12, when, chordDuration * 0.9, config.bassLevel);

        if (config.shimmer) {
          playKey(track, midiToFreq(config.scale[6]), when + 0.2, 3.6, config.melodyVelocity * 0.7, 'bell', 0.28);
        }
      }

      const arpIndex = config.arp[stepInChord];
      if (arpIndex >= 0) {
        const note = chord[arpIndex] + 12;
        const velocity = config.arpVelocity * (0.82 + 0.18 * Math.sin((step + 1) * 1.7));
        playKey(track, midiToFreq(note), when, config.arpDuration, velocity, config.arpTone, Math.sin(step * 0.8) * 0.18);
      }

      const melodyIndex = config.melody[step % config.melody.length];
      if (melodyIndex >= 0) {
        const note = config.scale[melodyIndex % config.scale.length];
        playKey(track, midiToFreq(note), when + 0.03, config.melodyDuration, config.melodyVelocity, config.melodyTone, Math.cos(step * 0.55) * 0.3);
      }

      if (config.brush && (stepInChord === 2 || stepInChord === 6)) {
        playBrush(track, when, 0.032);
      }

      if (config.kick && stepInChord === 0) {
        playKick(track, when, 0.07);
      }
    };

    const startSequencer = (track) => {
      const tick = () => {
        if (track.dead || !context) return;
        const horizon = context.currentTime + 0.6;
        let guard = 0;

        while (track.nextTime < horizon && guard < 48) {
          scheduleStep(track, track.step, track.nextTime);
          track.nextTime += track.stepDuration;
          track.step += 1;
          guard += 1;
        }

        const timer = window.setTimeout(() => {
          track.timers.delete(timer);
          tick();
        }, 160);
        track.timers.add(timer);
      };

      tick();
    };

    const disposeTrack = (track) => {
      if (!track || track.dead) return;
      track.dead = true;
      window.clearTimeout(track.disposeTimer);
      track.timers.forEach((timer) => window.clearTimeout(timer));
      track.timers.clear();
      track.sources.forEach((source) => {
        try { source.stop(); } catch (error) { /* already stopped */ }
        try { source.disconnect(); } catch (error) { /* already disconnected */ }
      });
      track.sources.clear();
      try { track.bus.disconnect(); } catch (error) { /* already disconnected */ }
      try { track.send.disconnect(); } catch (error) { /* already disconnected */ }
      tracks.delete(track);
      if (activeTrack === track) activeTrack = null;
      if (stateListener) stateListener();
    };

    const fadeIn = (track, seconds) => {
      const now = context.currentTime;
      track.bus.gain.cancelScheduledValues(now);
      track.bus.gain.setValueAtTime(0.0001, now);
      track.bus.gain.exponentialRampToValueAtTime(1, now + seconds);
    };

    const fadeOut = (track, seconds) => {
      if (!track || track.dead) return;
      window.clearTimeout(track.disposeTimer);
      const now = context.currentTime;
      const current = Math.max(0.0001, track.bus.gain.value);
      track.bus.gain.cancelScheduledValues(now);
      track.bus.gain.setValueAtTime(current, now);
      track.bus.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      track.disposeTimer = window.setTimeout(() => disposeTrack(track), Math.ceil(seconds * 1000) + 180);
    };

    const createTrack = (mood) => {
      const config = MUSIC[mood];
      if (!context || !config) return null;

      const bus = context.createGain();
      bus.gain.value = 0.0001;
      bus.connect(master);

      const send = context.createGain();
      send.gain.value = config.reverb;
      bus.connect(send);
      send.connect(reverb);

      const track = {
        mood,
        config,
        bus,
        send,
        sources: new Set(),
        timers: new Set(),
        dead: false,
        disposeTimer: 0,
        nextTime: context.currentTime + 0.14,
        step: 0,
        stepDuration: 60 / config.bpm / 2
      };

      if (config.noise) startNoiseLoop(track, config.noise, config.noiseLevel);
      startSequencer(track);
      return track;
    };

    const play = (mood) => {
      if (!ensure()) return false;
      resume();

      if (activeTrack && activeTrack.mood === mood && !activeTrack.dead) {
        if (stateListener) stateListener();
        return true;
      }

      const track = createTrack(mood);
      if (!track) return false;
      tracks.add(track);

      if (activeTrack && !activeTrack.dead) fadeOut(activeTrack, 1.6);
      activeTrack = track;
      fadeIn(track, 2.2);

      if (stateListener) stateListener();
      return true;
    };

    const setVolume = (value) => {
      volumeLevel = clamp(value, 0, 1);
      if (context && master) {
        master.gain.setTargetAtTime(masterLevel(volumeLevel), context.currentTime, 0.08);
      }
    };

    const stopAll = () => {
      Array.from(tracks).forEach(disposeTrack);
      activeTrack = null;
      if (stateListener) stateListener();
    };

    return {
      supported,
      play,
      resume,
      setVolume,
      stopAll,
      isPlaying: () => Boolean(activeTrack) && Boolean(context) && context.state === 'running',
      setStateListener: (listener) => { stateListener = listener; }
    };
  })();

  const particleCountFor = (mood) => {
    const mobile = window.innerWidth < 700;
    if (mood === 'cool') return { snow: mobile ? 26 : 54, mote: mobile ? 5 : 11 };
    if (mood === 'love') return { heart: mobile ? 13 : 24, floatHeart: mobile ? 4 : 8, mote: mobile ? 4 : 8 };
    if (mood === 'romantic') return { petal: mobile ? 14 : 26, mote: mobile ? 5 : 10, spark: mobile ? 8 : 16 };
    return { rain: mobile ? 42 : 82, droplet: mobile ? 4 : 8, mist: mobile ? 4 : 7 };
  };

  const makeSprite = (width, height, draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context) draw(context, width, height);
    return canvas;
  };

  const makeGlowSprite = (rgb) => makeSprite(96, 96, (context, width) => {
    const center = width / 2;
    const gradient = context.createRadialGradient(center, center, 1, center, center, center);
    gradient.addColorStop(0, `rgba(${rgb}, 0.9)`);
    gradient.addColorStop(0.35, `rgba(${rgb}, 0.36)`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(center, center, center, 0, TAU);
    context.fill();
  });

  const makeSnowSprite = () => makeSprite(96, 96, (context, size) => {
    const center = size / 2;
    const gradient = context.createRadialGradient(center, center, 1, center, center, center);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
    gradient.addColorStop(0.38, 'rgba(224, 242, 254, 0.74)');
    gradient.addColorStop(1, 'rgba(191, 219, 254, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(center, center, center, 0, TAU);
    context.fill();

    context.strokeStyle = 'rgba(224, 242, 254, 0.86)';
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    for (let index = 0; index < 6; index += 1) {
      const angle = (index * TAU) / 6;
      context.beginPath();
      context.moveTo(center + Math.cos(angle) * 7, center + Math.sin(angle) * 7);
      context.lineTo(center + Math.cos(angle) * 33, center + Math.sin(angle) * 33);
      context.stroke();
    }
  });

  const makeHeartSprite = () => makeSprite(96, 96, (context) => {
    const gradient = context.createLinearGradient(22, 14, 78, 82);
    gradient.addColorStop(0, 'rgba(255, 228, 235, 0.98)');
    gradient.addColorStop(0.55, 'rgba(251, 113, 133, 0.92)');
    gradient.addColorStop(1, 'rgba(225, 29, 72, 0.82)');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(48, 82);
    context.bezierCurveTo(12, 55, 13, 22, 34, 19);
    context.bezierCurveTo(43, 17.5, 48, 25, 48, 34);
    context.bezierCurveTo(48, 25, 53, 17.5, 62, 19);
    context.bezierCurveTo(83, 22, 84, 55, 48, 82);
    context.closePath();
    context.fill();
    context.fillStyle = 'rgba(255, 255, 255, 0.35)';
    context.beginPath();
    context.ellipse(33, 34, 6, 9, -0.6, 0, TAU);
    context.fill();
  });

  const makePetalSprite = () => makeSprite(96, 96, (context) => {
    const gradient = context.createLinearGradient(28, 10, 70, 88);
    gradient.addColorStop(0, 'rgba(255, 237, 213, 0.96)');
    gradient.addColorStop(0.42, 'rgba(253, 164, 175, 0.9)');
    gradient.addColorStop(1, 'rgba(190, 24, 93, 0.72)');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(50, 8);
    context.bezierCurveTo(82, 24, 88, 56, 60, 84);
    context.bezierCurveTo(52, 91, 44, 91, 36, 84);
    context.bezierCurveTo(8, 56, 18, 24, 50, 8);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    context.lineWidth = 1.8;
    context.beginPath();
    context.moveTo(50, 18);
    context.quadraticCurveTo(52, 50, 48, 78);
    context.stroke();
  });

  const makeSparkSprite = () => makeSprite(64, 64, (context, size) => {
    const center = size / 2;
    const gradient = context.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, 'rgba(255, 251, 235, 1)');
    gradient.addColorStop(0.24, 'rgba(253, 230, 138, 0.9)');
    gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(center, center, center, 0, TAU);
    context.fill();
    context.strokeStyle = 'rgba(255, 251, 235, 0.85)';
    context.lineWidth = 1.6;
    context.beginPath();
    context.moveTo(center, 4);
    context.lineTo(center, size - 4);
    context.moveTo(4, center);
    context.lineTo(size - 4, center);
    context.stroke();
  });

  const makeDropSprite = () => makeSprite(64, 128, (context) => {
    const trail = context.createLinearGradient(0, 14, 0, 92);
    trail.addColorStop(0, 'rgba(219, 234, 254, 0)');
    trail.addColorStop(1, 'rgba(219, 234, 254, 0.55)');
    context.fillStyle = trail;
    context.beginPath();
    context.ellipse(32, 56, 2.4, 38, 0, 0, TAU);
    context.fill();

    const drop = context.createRadialGradient(30, 88, 1, 32, 92, 12);
    drop.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    drop.addColorStop(0.36, 'rgba(191, 219, 254, 0.72)');
    drop.addColorStop(1, 'rgba(96, 165, 250, 0.08)');
    context.fillStyle = drop;
    context.beginPath();
    context.ellipse(32, 92, 8, 11, 0, 0, TAU);
    context.fill();
  });

  const buildSprites = (mood) => {
    if (mood === 'cool') {
      return { snow: makeSnowSprite(), mote: makeGlowSprite('147, 197, 253') };
    }
    if (mood === 'love') {
      return { heart: makeHeartSprite(), mote: makeGlowSprite('244, 114, 182') };
    }
    if (mood === 'romantic') {
      return { petal: makePetalSprite(), mote: makeGlowSprite('251, 191, 36'), spark: makeSparkSprite() };
    }
    return { droplet: makeDropSprite(), mist: makeGlowSprite('96, 165, 250') };
  };

  const createParticleField = (canvas, mood) => {
    const context2d = canvas.getContext('2d');
    if (!context2d) {
      return { destroy() {} };
    }

    const sprites = buildSprites(mood);
    let width = 1;
    let height = 1;
    let dpr = 1;
    let particles = [];
    let running = false;
    let destroyed = false;
    let animationId = 0;
    let lastTime = 0;
    let resizeTimer = 0;

    const resize = () => {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (particle, initial) => {
      const type = particle.type;

      if (type === 'snow') {
        particle.x = rand(-20, width + 20);
        particle.y = initial ? rand(-height, height) : rand(-120, -20);
        particle.size = rand(3.5, 11);
        particle.speed = rand(15, 42);
        particle.sway = rand(10, 34);
        particle.swaySpeed = rand(0.25, 0.75);
        particle.alpha = rand(0.35, 0.75);
        particle.rotation = rand(0, TAU);
        particle.spin = rand(-0.3, 0.3);
      } else if (type === 'heart') {
        particle.x = rand(-30, width + 30);
        particle.y = initial ? rand(-height, height) : rand(-100, -20);
        particle.size = rand(9, 20);
        particle.speed = rand(16, 38);
        particle.sway = rand(14, 38);
        particle.swaySpeed = rand(0.3, 0.8);
        particle.alpha = rand(0.28, 0.62);
        particle.rotation = rand(-0.3, 0.3);
        particle.spin = rand(-0.5, 0.5);
      } else if (type === 'floatHeart') {
        particle.x = rand(0, width);
        particle.y = initial ? rand(0, height) : rand(height + 20, height + 160);
        particle.size = rand(7, 15);
        particle.speed = rand(-8, -2.5);
        particle.sway = rand(10, 30);
        particle.swaySpeed = rand(0.2, 0.5);
        particle.alpha = rand(0.14, 0.3);
        particle.rotation = rand(-0.4, 0.4);
        particle.spin = rand(-0.2, 0.2);
      } else if (type === 'petal') {
        particle.x = rand(-30, width + 30);
        particle.y = initial ? rand(-height, height) : rand(-100, -20);
        particle.size = rand(10, 24);
        particle.speed = rand(12, 34);
        particle.sway = rand(20, 52);
        particle.swaySpeed = rand(0.25, 0.7);
        particle.alpha = rand(0.34, 0.72);
        particle.rotation = rand(0, TAU);
        particle.spin = rand(-0.8, 0.8);
      } else if (type === 'mote') {
        particle.x = rand(0, width);
        particle.y = initial ? rand(0, height) : rand(height + 40, height + 180);
        particle.size = rand(30, 92);
        particle.speed = rand(-9, -2);
        particle.sway = rand(10, 40);
        particle.swaySpeed = rand(0.15, 0.4);
        particle.alpha = rand(0.04, 0.1);
        particle.pulse = rand(0, TAU);
      } else if (type === 'spark') {
        particle.x = rand(0, width);
        particle.y = initial ? rand(0, height) : rand(-30, height + 30);
        particle.size = rand(1.5, 4.5);
        particle.speed = rand(-3, 3);
        particle.sway = rand(4, 14);
        particle.swaySpeed = rand(0.4, 1.2);
        particle.alpha = rand(0.2, 0.72);
        particle.pulse = rand(0, TAU);
        particle.rotation = rand(0, TAU);
        particle.spin = rand(-0.5, 0.5);
      } else if (type === 'rain') {
        particle.x = rand(-width * 0.12, width * 1.12);
        particle.y = initial ? rand(-height, height) : rand(-height * 0.4, -30);
        particle.size = rand(10, 30);
        particle.speed = rand(620, 1050);
        particle.drift = rand(12, 42);
        particle.alpha = rand(0.1, 0.3);
        particle.weight = rand(0.6, 1.3);
      } else if (type === 'droplet') {
        particle.x = rand(0, width);
        particle.y = initial ? rand(0, height) : rand(-40, 0);
        particle.size = rand(2.2, 5);
        particle.speed = rand(0, 2);
        particle.alpha = rand(0.22, 0.46);
      } else if (type === 'mist') {
        particle.x = rand(-width * 0.2, width * 1.2);
        particle.y = rand(height * 0.2, height);
        particle.size = rand(70, 170);
        particle.speedX = rand(-8, 8);
        particle.swaySpeed = rand(0.1, 0.3);
        particle.sway = rand(6, 18);
        particle.phase = rand(0, TAU);
        particle.alpha = rand(0.022, 0.06);
      }
    };

    const createParticle = (type, initial) => {
      const particle = { type, phase: rand(0, TAU) };
      spawn(particle, initial);
      return particle;
    };

    const buildParticles = () => {
      const counts = particleCountFor(mood);
      particles = [];
      Object.keys(counts).forEach((type) => {
        for (let index = 0; index < counts[type]; index += 1) {
          particles.push(createParticle(type, true));
        }
      });
    };

    const drawSprite = (sprite, size, x, y, rotation) => {
      if (!sprite) return;
      if (rotation) {
        context2d.save();
        context2d.translate(x, y);
        context2d.rotate(rotation);
        context2d.drawImage(sprite, -size / 2, -size / 2, size, size);
        context2d.restore();
      } else {
        context2d.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      }
    };

    const advance = (particle, delta, time) => {
      const type = particle.type;

      if (type === 'snow' || type === 'heart' || type === 'petal') {
        particle.y += particle.speed * delta;
        particle.rotation += particle.spin * delta;
        if (particle.y - particle.size > height + 30) spawn(particle, false);
      } else if (type === 'floatHeart' || type === 'mote') {
        particle.y += particle.speed * delta;
        if (particle.y + particle.size < -50) spawn(particle, false);
      } else if (type === 'spark') {
        particle.y += particle.speed * delta;
        particle.rotation += particle.spin * delta;
        if (particle.y < -40 || particle.y > height + 40) spawn(particle, false);
      } else if (type === 'rain') {
        particle.y += particle.speed * delta;
        particle.x -= particle.drift * delta;
        if (particle.y - particle.size > height + 20) spawn(particle, false);
      } else if (type === 'droplet') {
        if (particle.speed > 0) {
          particle.speed = Math.min(particle.speed + delta * 2.4, 18);
          particle.y += particle.speed * delta;
        } else if (Math.random() < 0.08 * delta) {
          particle.speed = rand(4, 14);
        }
        if (particle.y - 20 > height) spawn(particle, false);
      } else if (type === 'mist') {
        particle.x += particle.speedX * delta;
        particle.y += Math.sin(time * particle.swaySpeed + particle.phase) * 2 * delta;
        if (particle.x > width + particle.size) particle.x = -particle.size;
        if (particle.x < -particle.size) particle.x = width + particle.size;
      }
    };

    const paint = (particle, time) => {
      const type = particle.type;
      const swayX = particle.sway
        ? particle.x + Math.sin(time * particle.swaySpeed + particle.phase) * particle.sway
        : particle.x;
      context2d.globalAlpha = particle.alpha;

      if (type === 'snow') {
        drawSprite(sprites.snow, particle.size, swayX, particle.y, particle.rotation);
      } else if (type === 'heart' || type === 'floatHeart') {
        drawSprite(sprites.heart, particle.size, swayX, particle.y, particle.rotation);
      } else if (type === 'petal') {
        drawSprite(sprites.petal, particle.size, swayX, particle.y, particle.rotation);
      } else if (type === 'mote') {
        const pulse = 0.78 + 0.22 * Math.sin(time * 0.8 + particle.pulse);
        context2d.globalAlpha = particle.alpha * pulse;
        context2d.globalCompositeOperation = 'lighter';
        drawSprite(sprites.mote, particle.size, swayX, particle.y, 0);
        context2d.globalCompositeOperation = 'source-over';
      } else if (type === 'spark') {
        const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(time * 1.1 + particle.pulse));
        context2d.globalAlpha = particle.alpha * twinkle;
        context2d.globalCompositeOperation = 'lighter';
        drawSprite(sprites.spark, particle.size * 2.2, swayX, particle.y, particle.rotation);
        context2d.globalCompositeOperation = 'source-over';
      } else if (type === 'rain') {
        context2d.strokeStyle = `rgba(165, 205, 245, ${particle.alpha})`;
        context2d.lineWidth = particle.weight;
        context2d.lineCap = 'round';
        context2d.beginPath();
        context2d.moveTo(particle.x, particle.y);
        context2d.lineTo(particle.x - 2, particle.y + particle.size);
        context2d.stroke();
      } else if (type === 'droplet') {
        const dropWidth = particle.size * 4;
        const dropHeight = particle.size * 8;
        context2d.drawImage(
          sprites.droplet,
          particle.x - dropWidth / 2,
          particle.y - dropHeight * 0.72,
          dropWidth,
          dropHeight
        );
      } else if (type === 'mist') {
        context2d.globalCompositeOperation = 'source-over';
        drawSprite(sprites.mist, particle.size, particle.x, particle.y, 0);
      }

      context2d.globalAlpha = 1;
    };

    const drawStaticFrame = () => {
      context2d.clearRect(0, 0, width, height);
      particles.forEach((particle) => paint(particle, 12.3));
    };

    const frame = (now) => {
      if (!running || destroyed) return;
      const delta = Math.min(0.05, Math.max(0.001, (now - (lastTime || now)) / 1000));
      lastTime = now;
      const time = now / 1000;

      context2d.clearRect(0, 0, width, height);
      particles.forEach((particle) => {
        advance(particle, delta, time);
        paint(particle, time);
      });
      animationId = window.requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || destroyed || reducedMotion) return;
      running = true;
      lastTime = 0;
      animationId = window.requestAnimationFrame(frame);
    };

    const stop = () => {
      running = false;
      window.cancelAnimationFrame(animationId);
      animationId = 0;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!reducedMotion) start();
    };

    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (destroyed) return;
        resize();
        buildParticles();
        if (reducedMotion) drawStaticFrame();
      }, 160);
    };

    resize();
    buildParticles();
    if (reducedMotion) drawStaticFrame();
    else start();

    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    return {
      destroy() {
        destroyed = true;
        stop();
        window.clearTimeout(resizeTimer);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVisibility);
        particles = [];
        context2d.clearRect(0, 0, width, height);
      }
    };
  };

  const transitionScene = (mood) => {
    if (!dom || !dom.atmosphere || visualMood === mood) return;
    visualMood = mood;

    const scene = document.createElement('div');
    scene.className = `mood-scene mood-scene--${mood}`;

    const wash = document.createElement('div');
    wash.className = 'mood-scene-wash';

    const canvas = document.createElement('canvas');
    canvas.className = 'mood-scene-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    scene.appendChild(wash);
    scene.appendChild(canvas);

    const controller = createParticleField(canvas, mood);
    const nextScene = { element: scene, controller };
    const previous = activeScene;
    activeScene = nextScene;

    dom.atmosphere.appendChild(scene);
    void scene.offsetWidth;
    scene.classList.add('is-active');

    if (previous) {
      previous.element.classList.remove('is-active');
      const timer = window.setTimeout(() => {
        sceneTimers.delete(timer);
        previous.controller.destroy();
        previous.element.remove();
      }, reducedMotion ? 30 : 1250);
      sceneTimers.add(timer);
    }
  };

  const updateVolumeUI = () => {
    if (!dom) return;
    const percent = Math.round(volume * 100);
    if (dom.volumeInput) {
      dom.volumeInput.value = String(percent);
      dom.volumeInput.style.setProperty('--mood-volume', `${percent}%`);
    }
    if (dom.volumeValue) dom.volumeValue.textContent = `${percent}%`;
    if (dom.volumeIcon) {
      const muted = volume <= 0;
      dom.volumeIcon.classList.toggle('is-muted', muted);
      dom.volumeIcon.setAttribute('aria-pressed', String(muted));
      dom.volumeIcon.setAttribute('aria-label', muted ? 'Unmute mood music' : 'Mute mood music');
    }
  };

  const updateMusicUI = () => {
    if (!dom) return;
    const mood = MOODS[currentMood];
    const playing = experienceStarted && volume > 0 && audioEngine.isPlaying();
    let status = 'Tap to start the music';

    if (!audioEngine.supported) status = 'Music is not supported here';
    else if (!experienceStarted) status = 'Tap to start the music';
    else if (volume <= 0) status = 'Music muted';
    else if (playing) status = `Playing · ${mood.label}`;
    else status = 'Tap anywhere to play';

    if (dom.status) dom.status.textContent = status;

    dom.currentNames.forEach((element) => { element.textContent = mood.label; });
    dom.currentLabels.forEach((element) => { element.textContent = mood.label; });
    dom.currentIcons.forEach((element) => { element.textContent = mood.emoji; });

    dom.options.forEach((option) => {
      const selected = option.dataset.mood === currentMood;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });

    dom.toggles.forEach((button) => {
      button.setAttribute('aria-expanded', String(panelOpen));
      button.setAttribute('aria-label', `Open mood selector · ${mood.label}`);
    });

    if (dom.fab) dom.fab.classList.toggle('is-playing', playing);
    if (dom.panel) dom.panel.classList.toggle('is-playing', playing);
  };

  const applyMood = (mood) => {
    if (!MOODS[mood]) return;
    const changed = visualMood !== mood;
    currentMood = mood;
    storage.set(MOOD_KEY, mood);
    document.documentElement.setAttribute('data-mood', mood);
    if (changed || !activeScene) transitionScene(mood);
    updateMusicUI();
  };

  const setVolume = (value) => {
    volume = clamp(value, 0, 1);
    if (volume > 0) mutedMemory = volume;
    storage.set(VOLUME_KEY, volume.toFixed(3));
    audioEngine.setVolume(volume);
    updateVolumeUI();
    updateMusicUI();
    if (experienceStarted && volume > 0 && !audioEngine.isPlaying()) {
      audioEngine.play(currentMood);
    }
  };

  const toggleMute = () => {
    if (volume > 0) {
      mutedMemory = volume;
      setVolume(0);
    } else {
      setVolume(mutedMemory > 0 ? mutedMemory : DEFAULT_VOLUME);
    }
  };

  const selectMood = (mood) => {
    if (!MOODS[mood]) return;
    applyMood(mood);
    if (experienceStarted && volume > 0) audioEngine.play(mood);
    closePanel();
    if (!experienceStarted) maybeShowStartOverlay();
  };

  const openPanel = () => {
    if (!dom || !dom.panel || panelOpen || startOverlayOpen) return;
    panelOpen = true;
    lastFocusedElement = document.activeElement;
    dom.panel.classList.add('is-open');
    dom.panel.setAttribute('aria-hidden', 'false');
    if (dom.backdrop) dom.backdrop.classList.add('is-open');
    dom.toggles.forEach((button) => button.setAttribute('aria-expanded', 'true'));

    const selected = dom.options.find((option) => option.dataset.mood === currentMood);
    window.setTimeout(() => {
      if (panelOpen) (selected || dom.panelClose || dom.panel).focus({ preventScroll: true });
    }, 60);
  };

  const closePanel = (options = {}) => {
    if (!dom || !dom.panel || !panelOpen) return;
    panelOpen = false;
    dom.panel.classList.remove('is-open');
    dom.panel.setAttribute('aria-hidden', 'true');
    if (dom.backdrop) dom.backdrop.classList.remove('is-open');
    dom.toggles.forEach((button) => button.setAttribute('aria-expanded', 'false'));

    if (options.restoreFocus !== false && lastFocusedElement && lastFocusedElement.isConnected) {
      lastFocusedElement.focus({ preventScroll: true });
    }
    lastFocusedElement = null;
  };

  const isIntroActive = () => {
    const overlay = document.querySelector('[data-intro-overlay]');
    if (!overlay) return false;
    if (document.documentElement.classList.contains('intro-pending')) return true;
    if (overlay.classList.contains('is-leaving')) return true;
    return overlay.getAttribute('aria-hidden') === 'false';
  };

  const stopWatchingIntro = () => {
    if (introWatcher) {
      introWatcher.disconnect();
      introWatcher = null;
    }
    if (introTimer) {
      window.clearInterval(introTimer);
      introTimer = 0;
    }
  };

  const showStartOverlay = () => {
    if (!dom || !dom.startOverlay || experienceStarted || startOverlayOpen) return;
    stopWatchingIntro();
    startOverlayOpen = true;
    dom.startOverlay.hidden = false;
    dom.startOverlay.classList.remove('is-leaving', 'is-visible');
    void dom.startOverlay.offsetWidth;
    dom.startOverlay.classList.add('is-visible');
    document.documentElement.classList.add('mood-start-open');

    window.setTimeout(() => {
      if (startOverlayOpen && dom.startButton) dom.startButton.focus({ preventScroll: true });
    }, 80);
  };

  const watchIntroThenShow = () => {
    if (introWatcher) return;
    const check = () => {
      if (experienceStarted || startOverlayOpen) {
        stopWatchingIntro();
        return;
      }
      if (!isIntroActive()) {
        stopWatchingIntro();
        showStartOverlay();
      }
    };

    introWatcher = new MutationObserver(check);
    introWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const overlay = document.querySelector('[data-intro-overlay]');
    if (overlay) {
      introWatcher.observe(overlay, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    }
    introTimer = window.setInterval(check, 700);
  };

  const maybeShowStartOverlay = () => {
    if (experienceStarted || startOverlayOpen) return;
    if (isIntroActive()) {
      watchIntroThenShow();
      return;
    }
    showStartOverlay();
  };

  const hideStartOverlay = () => {
    if (!dom || !dom.startOverlay || !startOverlayOpen) return;
    startOverlayOpen = false;
    dom.startOverlay.classList.remove('is-visible');
    dom.startOverlay.classList.add('is-leaving');
    document.documentElement.classList.remove('mood-start-open');

    window.setTimeout(() => {
      if (!startOverlayOpen) {
        dom.startOverlay.hidden = true;
        dom.startOverlay.classList.remove('is-leaving');
      }
    }, reducedMotion ? 30 : 460);
  };

  const startExperience = (mood, options = {}) => {
    if (MOODS[mood]) applyMood(mood);
    experienceStarted = true;
    storage.set(STARTED_KEY, '1');

    if (options.silent) {
      if (volume > 0) mutedMemory = volume;
      setVolume(0);
    } else if (volume > 0) {
      audioEngine.play(currentMood);
    }

    hideStartOverlay();
    updateMusicUI();
  };

  const handleFirstInteraction = () => {
    if (!experienceStarted || volume <= 0) return;
    if (!audioEngine.isPlaying()) {
      audioEngine.play(currentMood);
      updateMusicUI();
    }
  };

  const handleMotionChange = () => {
    reducedMotion = motionQuery.matches;
    if (!activeScene || !visualMood) return;
    const mood = visualMood;
    activeScene.controller.destroy();
    activeScene.element.remove();
    activeScene = null;
    visualMood = null;
    transitionScene(mood);
  };

  const handleStorage = (event) => {
    if (event.key === VOLUME_KEY) {
      volume = readVolume();
      if (volume > 0) mutedMemory = volume;
      audioEngine.setVolume(volume);
      updateVolumeUI();
      updateMusicUI();
    } else if (event.key === MOOD_KEY) {
      const next = readMood();
      if (next !== currentMood) {
        applyMood(next);
        if (experienceStarted && volume > 0) audioEngine.play(next);
      }
    } else if (event.key === STARTED_KEY) {
      experienceStarted = readStarted();
      updateMusicUI();
      if (experienceStarted && volume > 0) audioEngine.play(currentMood);
    }
  };

  const bindEvents = () => {
    dom.toggles.forEach((button) => {
      button.addEventListener('click', () => {
        if (panelOpen) closePanel();
        else openPanel();
      });
    });

    if (dom.panelClose) dom.panelClose.addEventListener('click', () => closePanel());
    if (dom.backdrop) dom.backdrop.addEventListener('click', () => closePanel());
    if (dom.volumeIcon) dom.volumeIcon.addEventListener('click', toggleMute);

    if (dom.volumeInput) {
      dom.volumeInput.addEventListener('input', (event) => {
        setVolume(Number(event.target.value) / 100);
      });
    }

    dom.options.forEach((option) => {
      option.addEventListener('click', () => selectMood(option.dataset.mood));
    });

    dom.startMoods.forEach((button) => {
      button.addEventListener('click', () => startExperience(button.dataset.startMood));
    });

    if (dom.startButton) {
      dom.startButton.addEventListener('click', () => startExperience(currentMood));
    }

    if (dom.startSkip) {
      dom.startSkip.addEventListener('click', () => startExperience(currentMood, { silent: true }));
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (startOverlayOpen) {
        startExperience(currentMood, { silent: true });
      } else if (panelOpen) {
        closePanel();
      }
    });

    document.addEventListener('pointerdown', handleFirstInteraction, { passive: true });
    document.addEventListener('keydown', handleFirstInteraction);

    window.addEventListener('storage', handleStorage);
    motionQuery.addEventListener?.('change', handleMotionChange);
    window.addEventListener('pagehide', () => audioEngine.stopAll());

    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      if (experienceStarted && volume > 0) audioEngine.play(currentMood);
      if (!experienceStarted) maybeShowStartOverlay();
    });

    if (dom.startOverlay) {
      dom.startOverlay.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;
        const focusable = Array.from(dom.startOverlay.querySelectorAll('button:not([disabled])'));
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
    }
  };

  const init = () => {
    dom = {
      atmosphere: document.querySelector('[data-mood-atmosphere]'),
      panel: document.querySelector('[data-mood-panel]'),
      backdrop: document.querySelector('[data-mood-backdrop]'),
      fab: document.querySelector('.mood-fab'),
      panelClose: document.querySelector('[data-mood-close]'),
      options: Array.from(document.querySelectorAll('.mood-option[data-mood]')),
      volumeInput: document.querySelector('[data-mood-volume]'),
      volumeValue: document.querySelector('[data-mood-volume-value]'),
      volumeIcon: document.querySelector('[data-mood-mute]'),
      status: document.querySelector('[data-mood-status]'),
      currentNames: Array.from(document.querySelectorAll('[data-mood-current-name]')),
      currentLabels: Array.from(document.querySelectorAll('[data-mood-current-label]')),
      currentIcons: Array.from(document.querySelectorAll('[data-mood-current-icon]')),
      toggles: Array.from(document.querySelectorAll('[data-mood-toggle]')),
      startOverlay: document.querySelector('[data-mood-start-overlay]'),
      startButton: document.querySelector('[data-mood-start]'),
      startSkip: document.querySelector('[data-mood-start-skip]'),
      startMoods: Array.from(document.querySelectorAll('[data-start-mood]'))
    };

    if (!dom.atmosphere || !dom.panel) return;

    audioEngine.setVolume(volume);
    audioEngine.setStateListener(updateMusicUI);

    applyMood(currentMood);
    updateVolumeUI();
    updateMusicUI();
    bindEvents();

    if (experienceStarted) {
      if (volume > 0) audioEngine.play(currentMood);
    } else {
      maybeShowStartOverlay();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

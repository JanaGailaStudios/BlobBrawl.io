/**
 * Zero-asset audio. Every sound effect is synthesised with the Web Audio API so
 * the game needs no downloads and works offline.
 */
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.enabled = true;
    this.musicEnabled = false;
    this.sfxVolume = 0.7;
    this.musicVolume = 0.4;
    this.musicNodes = [];
    this.musicTimer = null;
    this.bellTimer = null;
    this.lastOrb = 0;
    this.unlocked = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.master);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);
    } catch { return null; }
    return this.ctx;
  }

  unlock() {
    this.ensure();
    this.unlocked = true;
    if (this.musicEnabled) this.startMusic();
  }

  applySettings({ sound, music, sfxVolume, musicVolume }) {
    if (typeof sound === 'boolean') this.enabled = sound;
    if (typeof music === 'boolean') {
      const changed = music !== this.musicEnabled;
      this.musicEnabled = music;
      if (changed) {
        if (music) { if (this.unlocked) this.startMusic(); }
        else this.stopMusic();
      }
    }
    if (typeof sfxVolume === 'number') this.sfxVolume = Math.max(0, Math.min(1, sfxVolume));
    if (typeof musicVolume === 'number') this.musicVolume = Math.max(0, Math.min(1, musicVolume));
    if (this.sfxGain) this.sfxGain.gain.value = this.enabled ? this.sfxVolume : 0;
    if (this.musicGain && this.musicEnabled) this.musicGain.gain.value = this.musicVolume * 0.45;
  }

  tone({ freq = 440, to, dur = 0.12, type = 'sine', gain = 0.15, delay = 0, attack = 0.005, bus }) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(bus || this.sfxGain || ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  noise({ dur = 0.2, gain = 0.12, freq = 900, q = 1, sweepTo, delay = 0 }) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain || ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  play(name) {
    if (!this.enabled) return;
    if (!this.ctx) this.ensure();
    switch (name) {
      case 'orb': {
        const now = performance.now();
        if (now - this.lastOrb < 42) return;
        this.lastOrb = now;
        const base = 620 + Math.random() * 240;
        this.tone({ freq: base, to: base * 1.32, dur: 0.07, type: 'sine', gain: 0.07 });
        break;
      }
      case 'click':
        this.tone({ freq: 360, to: 300, dur: 0.05, type: 'triangle', gain: 0.05 });
        break;
      case 'hover':
        this.tone({ freq: 520, dur: 0.03, type: 'sine', gain: 0.02 });
        break;
      case 'boost':
        this.noise({ dur: 0.34, gain: 0.1, freq: 420, q: 0.8, sweepTo: 1600 });
        this.tone({ freq: 180, to: 320, dur: 0.22, type: 'sawtooth', gain: 0.035 });
        break;
      case 'kill':
        this.tone({ freq: 220, to: 70, dur: 0.28, type: 'square', gain: 0.11 });
        this.noise({ dur: 0.2, gain: 0.12, freq: 700, q: 0.7, sweepTo: 180 });
        this.tone({ freq: 880, to: 1320, dur: 0.16, type: 'sine', gain: 0.06, delay: 0.03 });
        break;
      case 'death':
        this.tone({ freq: 300, to: 70, dur: 0.7, type: 'sawtooth', gain: 0.1 });
        this.tone({ freq: 150, to: 48, dur: 0.9, type: 'sine', gain: 0.12, delay: 0.05 });
        this.noise({ dur: 0.5, gain: 0.08, freq: 500, q: 0.6, sweepTo: 120 });
        break;
      case 'levelup':
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.22, type: 'triangle', gain: 0.08, delay: i * 0.09 }));
        break;
      case 'buy':
        this.tone({ freq: 660, dur: 0.09, type: 'triangle', gain: 0.08 });
        this.tone({ freq: 990, dur: 0.16, type: 'triangle', gain: 0.07, delay: 0.09 });
        break;
      case 'error':
        this.tone({ freq: 200, to: 140, dur: 0.18, type: 'square', gain: 0.06 });
        break;
      case 'start':
        [330, 440, 554, 660].forEach((f, i) => this.tone({ freq: f, dur: 0.18, type: 'sawtooth', gain: 0.045, delay: i * 0.06 }));
        this.noise({ dur: 0.5, gain: 0.05, freq: 300, q: 0.6, sweepTo: 1400 });
        break;
      case 'spawn':
        this.tone({ freq: 180, to: 520, dur: 0.3, type: 'sine', gain: 0.08 });
        break;
      case 'achievement':
        [784, 988, 1319].forEach((f, i) => this.tone({ freq: f, dur: 0.26, type: 'sine', gain: 0.075, delay: i * 0.11 }));
        break;
      case 'drop':
        [1046, 1318, 1568, 2093].forEach((f, i) => this.tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.07, delay: i * 0.08 }));
        break;
      default:
        break;
    }
  }

  startMusic() {
    const ctx = this.ensure();
    if (!ctx || !this.musicGain || this.musicNodes.length) return;
    this.musicGain.gain.cancelScheduledValues(ctx.currentTime);
    this.musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(this.musicVolume * 0.45, ctx.currentTime + 2.5);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.7;
    filter.connect(this.musicGain);

    [55, 82.5, 110, 164.81].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.16 : 0.07;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.045 + i * 0.017;
      lfoGain.gain.value = 0.04;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      osc.connect(g);
      g.connect(filter);
      osc.start();
      lfo.start();
      this.musicNodes.push(osc, lfo);
    });

    // Sparse random bells for texture.
    const bell = () => {
      if (!this.musicEnabled || !this.enabled) return;
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      const freq = notes[(Math.random() * notes.length) | 0];
      this.tone({ freq, dur: 2.4, type: 'sine', gain: 0.028, attack: 0.4 });
      this.bellTimer = setTimeout(bell, 4200 + Math.random() * 7000);
    };
    this.bellTimer = setTimeout(bell, 3500);
  }

  stopMusic() {
    if (!this.ctx) return;
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.musicGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
    }
    clearTimeout(this.bellTimer);
    const nodes = this.musicNodes;
    this.musicNodes = [];
    setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch { /* ignore */ } }), 800);
  }
}

export const audio = new AudioEngine();

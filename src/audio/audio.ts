// Minimal synthesized audio for the greybox: whistle patterns and spatialised barks.
// No samples yet; these exist so the whistle vocabulary and bark directions can be
// learned by ear, which is the GDD's main UI channel.

import type { BarkKind } from '../core/events';

const BARK_PITCH: Record<BarkKind, number> = {
  alert: 1.0,
  warning: 0.85,
  attack: 0.75,
  happy: 1.25,
  found: 1.1,
};
const BARK_COUNT: Record<BarkKind, number> = { alert: 2, warning: 1, attack: 3, happy: 1, found: 2 };

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.6;

  constructor() {
    // Browsers only allow audio after a user gesture.
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** Master volume for every sound effect and the ambience, 0..1. */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    return this.ctx;
  }

  /** The live context, master bus and noise buffer, once a gesture has unlocked audio. */
  context(): { ctx: AudioContext; master: GainNode; noise: AudioBuffer } | null {
    if (!this.ctx || !this.master || !this.noise || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, master: this.master, noise: this.noise };
  }

  /** Place the listener (camera) in the world. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }

  /** Shepherd's whistle: a sine with a little vibrato per note. */
  whistle(notes: [number, number][]): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    let t = ctx.currentTime + 0.02;
    for (const [f, dur] of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      // Rising/falling feel: glide 6% across the note.
      osc.frequency.linearRampToValueAtTime(f * (f > 2200 ? 0.8 : 1.06), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.02);
      g.gain.setValueAtTime(0.25, t + dur - 0.03);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur + 0.07;
    }
  }

  private eng: {
    o1: OscillatorNode;
    o2: OscillatorNode;
    lp: BiquadFilterNode;
    gain: GainNode;
    crunch: GainNode;
    pan: PannerNode;
  } | null = null;

  private panner(x: number, y: number, z: number): PannerNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.rolloffFactor = 1;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(this.master);
    return p;
  }

  /**
   * Two-stroke single: a buzzy saw + square pair through a low-pass that opens with the
   * throttle, pitched from rpm; plus gravel crunch from slide/wheelspin. Call every frame.
   */
  engine(on: boolean, rpm: number, throttle: number, slip: number, x: number, y: number, z: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    if (!this.eng) {
      if (!on) return;
      const pan = this.panner(x, y, z)!;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 4;
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      const o2 = ctx.createOscillator();
      o2.type = 'square';
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      o1.connect(lp);
      o2.connect(g2).connect(lp);
      lp.connect(gain).connect(pan);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2200;
      bp.Q.value = 0.8;
      const crunch = ctx.createGain();
      crunch.gain.value = 0;
      src.connect(bp).connect(crunch).connect(pan);
      o1.start();
      o2.start();
      src.start();
      this.eng = { o1, o2, lp, gain, crunch, pan };
    }
    const e = this.eng;
    const t = ctx.currentTime;
    const f = Math.max(20, (rpm / 60) * 2);
    e.o1.frequency.setTargetAtTime(f, t, 0.03);
    e.o2.frequency.setTargetAtTime(f * 2.01, t, 0.03);
    e.lp.frequency.setTargetAtTime(350 + throttle * 2400 + rpm * 0.1, t, 0.05);
    e.gain.gain.setTargetAtTime(on ? 0.05 + throttle * 0.11 : 0, t, on ? 0.05 : 0.25);
    e.crunch.gain.setTargetAtTime(Math.min(0.5, slip) * 0.6, t, 0.05);
    e.pan.positionX.setTargetAtTime(x, t, 0.02);
    e.pan.positionY.setTargetAtTime(y, t, 0.02);
    e.pan.positionZ.setTargetAtTime(z, t, 0.02);
  }

  /** Short percussive sounds at a position: kick-start, suspension thunk, horn. */
  bikeSound(kind: 'kick' | 'kickFail' | 'thunk' | 'horn', strength: number, x: number, y: number, z: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const pan = this.panner(x, y, z);
    if (!pan) return;
    const t = ctx.currentTime + 0.01;
    if (kind === 'horn') {
      for (const f of [415, 523]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.02);
        g.gain.setValueAtTime(0.12, t + 0.42);
        g.gain.linearRampToValueAtTime(0, t + 0.48);
        o.connect(g).connect(pan);
        o.start(t);
        o.stop(t + 0.5);
      }
      return;
    }
    if (kind === 'thunk') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5 * strength, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.16);
      return;
    }
    // Kick: a clunk of the lever, and on success a cough.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'kick' ? 900 : 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'kick' ? 0.35 : 0.12));
    src.connect(lp).connect(g).connect(pan);
    src.start(t, 0, 0.4);
  }

  /** Pocket-watch tick: a tiny bright click. */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.035, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.025);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.03);
  }

  /** Prayer beads: two soft wooden clicks. */
  bead(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    for (const dt of [0, 0.06]) {
      const t = ctx.currentTime + 0.01 + dt;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t, Math.random() * 0.3, 0.05);
    }
  }

  /** Filtered noise burst at a place (or at the listener if no position). */
  private noiseHit(freq: number, q: number, gain: number, len: number, pos?: { x: number; y: number; z: number }, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq, t);
    if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t + len);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    const out = pos ? this.panner(pos.x, pos.y, pos.z) : this.master;
    if (!out) return;
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 0.2, len + 0.05);
  }

  /** Sling: the whirl and release. */
  sling(): void {
    this.ensure();
    this.noiseHit(500, 2, 0.35, 0.25, undefined, 1800);
  }

  /** A stone landing. */
  thud(x: number, y: number, z: number): void {
    this.noiseHit(220, 3, 0.9, 0.12, { x, y, z });
  }

  /** Stone on stone while building. */
  knock(): void {
    this.noiseHit(1100, 8, 0.4, 0.06);
  }

  /** Karabaş bitten: a sharp yelp. */
  yelp(x: number, y: number, z: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const pan = this.panner(x, y, z);
    if (!pan) return;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(pan);
    o.start(t);
    o.stop(t + 0.32);
  }

  /** Task done: two soft bell notes. */
  chime(): void {
    this.bellNotes([880, 1320], 0.14, 0.18);
  }

  /** Three low, descending notes signal the last hour of daylight. */
  /** A wolf howling far off: a slow rising-falling glide with vibrato, from (x, y, z). */
  howl(x: number, y: number, z: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const pan = this.panner(x, y, z);
    if (!pan) return;
    pan.refDistance = 60; // carries a long way
    const t = ctx.currentTime + 0.05;
    for (const [delay, pitch, gainMul] of [
      [0, 1, 1],
      [1.1, 1.12, 0.6],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 9;
      vib.connect(vibGain).connect(o.frequency);
      const s = t + delay;
      o.frequency.setValueAtTime(330 * pitch, s);
      o.frequency.linearRampToValueAtTime(560 * pitch, s + 0.9);
      o.frequency.linearRampToValueAtTime(520 * pitch, s + 1.9);
      o.frequency.linearRampToValueAtTime(380 * pitch, s + 2.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.22 * gainMul, s + 0.5);
      g.gain.setValueAtTime(0.22 * gainMul, s + 2.1);
      g.gain.linearRampToValueAtTime(0, s + 2.9);
      o.connect(g).connect(pan);
      o.start(s);
      vib.start(s);
      o.stop(s + 3);
      vib.stop(s + 3);
    }
  }

  goldenHour(): void {
    this.bellNotes([440, 349.23, 261.63], 0.38, 0.23);
  }

  private bellNotes(frequencies: number[], spacing: number, volume: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    let t = ctx.currentTime + 0.02;
    for (const f of frequencies) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 1);
      t += spacing;
    }
  }

  /** A big dog's bark at a world position: filtered noise burst + low growl tone. */
  bark(kind: BarkKind, x: number, y: number, z: number, nightAlarm = false): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = nightAlarm ? 12 : 4;
    panner.rolloffFactor = 1.2;
    panner.positionX.value = x;
    panner.positionY.value = y + 0.7;
    panner.positionZ.value = z;
    panner.connect(this.master);
    const pitch = BARK_PITCH[kind];
    let t = ctx.currentTime + 0.01;
    for (let i = 0; i < BARK_COUNT[kind]; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520 * pitch;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.9, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.01, t + 0.16);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(190 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(110 * pitch, t + 0.15);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.25, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.01, t + 0.16);
      src.connect(bp).connect(g).connect(panner);
      osc.connect(og).connect(panner);
      src.start(t, Math.random() * 0.3, 0.2);
      osc.start(t);
      osc.stop(t + 0.2);
      t += kind === 'attack' ? 0.17 : 0.28;
    }
  }
}

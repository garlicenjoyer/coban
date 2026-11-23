// The valley's ambient sound (GDD feature 4): what the land sounds like when nothing is
// happening. All synthesized, like the rest of the greybox audio.
//
//   cicadas        a shimmering bed through the hot middle of the day
//   crickets       after dusk, a few chirping close by
//   a scops owl    the Aegean summer night's one soft note, every few seconds
//   sheep bells    six or seven of the flock wear one (the bellwether the big one); they clank as the
//                  sheep walk, now and then while they graze, and not at all when hushed
//   the ezan       the call to prayer from the village minaret at the afternoon, evening and
//                  night prayers, faint from the homestead, full in the square
//
// The level curves, the bell rates and the prayer times are plain functions (tested); the
// class turns them into Web Audio nodes.

import { SIM_DT } from '../core/config';
import type { Sheep } from '../flock/sheep';
import type { GameAudio } from './audio';

// ---------- what plays when (pure) ----------

const ramp = (h: number, a: number, b: number) => Math.min(1, Math.max(0, (h - a) / (b - a)));

/** Cicadas: silent in the cool of the morning, full from late morning, gone after sunset. */
export function cicadaLevel(hour: number): number {
  return ramp(hour, 7.5, 11) * (1 - ramp(hour, 17.5, 19.6));
}

/** Crickets and the owl: from dusk to just before dawn. */
export function nightLevel(hour: number): number {
  const h = hour % 24;
  return h >= 12 ? ramp(h, 19.3, 20.5) : 1 - ramp(h, 5, 6.3);
}

/** Prayer times in in-game hours (öğle, ikindi, akşam, yatsı); sabah is before the day starts. */
export const PRAYER_HOURS = [13.2, 16.8, 19.15, 20.6] as const;

/**
 * The prayer whose time fell between two clock readings, if any. A jump longer than a
 * quarter of an hour (sleeping, a debug skip) plays nothing: the time passed unheard.
 */
export function prayerDue(prevHour: number, hour: number): number | null {
  if (hour <= prevHour || hour - prevHour > 0.25) return null;
  return PRAYER_HOURS.find((t) => prevHour < t && t <= hour) ?? null;
}

/** Which sheep wear a bell: the bellwether and every fourth ewe (six or seven in a flock of 24). */
export const wearsBell = (s: Sheep): boolean => s.isLeader || s.id % 4 === 2;

/** Clanks per second for a belled sheep: walking rings, grazing knocks now and then, hushed is silent. */
export function bellRate(s: Sheep): number {
  if (s.hushed) return 0;
  const speed = Math.hypot(s.x - s.px, s.z - s.pz) / SIM_DT;
  if (speed > 0.35) return Math.min(4, 1.2 + speed * 0.9);
  return s.inPen ? 0.06 : 0.18;
}

/** A bell's pitch: the bellwether's is big and low, the rest by size. */
export const bellPitch = (s: Sheep): number => (s.isLeader ? 470 : 640 + ((s.id * 53) % 7) * 55);

// ---------- the sound ----------

export interface AmbienceFrame {
  hour: number;
  listener: { x: number; y: number; z: number };
  sheep: readonly Sheep[];
  /** The minaret's balcony, if the map has a village. */
  minaret: { x: number; y: number; z: number } | null;
}

/** The call to prayer in Hicaz on A: A B♭ C♯ D E F G A (semitones from A3). */
const HICAZ = [0, 1, 4, 5, 7, 8, 10, 12, 13];
const EZAN_BASE = 220;
/** Phrases of [scale degree, seconds]: long held openings, ornaments, a fall to the tonic. */
const EZAN_PHRASES: [number, number][][] = [
  [[0, 0.7], [0, 1.5], [1, 0.3], [2, 0.5], [3, 0.45], [2, 0.3], [1, 0.3], [0, 1.9]],
  [[2, 0.5], [3, 0.4], [4, 1.4], [5, 0.3], [4, 0.3], [3, 0.4], [2, 0.4], [1, 0.3], [2, 0.4], [0, 2.0]],
  [[4, 0.6], [5, 0.4], [7, 1.8], [6, 0.3], [5, 0.3], [4, 0.6], [3, 0.3], [2, 0.3], [4, 0.9], [2, 0.4], [1, 0.3], [0, 2.0]],
  [[4, 0.5], [7, 0.5], [8, 1.6], [7, 0.35], [6, 0.3], [5, 0.5], [4, 0.9], [3, 0.3], [2, 0.4], [1, 0.4], [0, 2.4]],
  [[2, 0.5], [3, 0.4], [4, 1.4], [5, 0.3], [4, 0.3], [3, 0.4], [2, 0.4], [1, 0.3], [2, 0.4], [0, 2.0]],
  [[0, 0.7], [1, 0.4], [2, 1.2], [1, 0.3], [0, 2.6]],
];

interface Chorus {
  gain: GainNode;
  level: number;
  timer: number;
}

export class Ambience {
  /** Master level of the ambient layer (the debug panel tunes it). */
  volume = 0.7;
  private bus: GainNode | null = null;
  private choruses: Chorus[] = [];
  private cicadaBed: GainNode | null = null;
  private prevHour = -1;
  private cricketTimers = [0.4, 1.1];
  private owl = { timer: 3, x: 0, z: 0, quietFor: 0 };
  private bellBudget = 0;
  private ezanUntil = 0;

  constructor(private audio: GameAudio) {}

  /** Lazily build the bus and the cicada bed once audio is unlocked. */
  private ready(): { ctx: AudioContext; bus: GainNode; noise: AudioBuffer } | null {
    const a = this.audio.context();
    if (!a) return null;
    const { ctx, master, noise } = a;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = this.volume;
      this.bus.connect(master);
      this.cicadaBed = ctx.createGain();
      this.cicadaBed.gain.value = 0;
      this.cicadaBed.connect(this.bus);
      // Two cicada choruses, left and right: band-passed noise pulsed fast by a square LFO.
      for (const [freq, rate, pan] of [
        [4700, 41, -0.6],
        [5900, 53, 0.55],
      ] as const) {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = freq;
        bp.Q.value = 7;
        const pulse = ctx.createGain();
        pulse.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = rate;
        const depth = ctx.createGain();
        depth.gain.value = 0.45;
        lfo.connect(depth).connect(pulse.gain);
        const swell = ctx.createGain();
        swell.gain.value = 0;
        const sp = ctx.createStereoPanner();
        sp.pan.value = pan;
        src.connect(bp).connect(pulse).connect(swell).connect(sp).connect(this.cicadaBed);
        src.start(ctx.currentTime, Math.random() * 0.4);
        lfo.start();
        this.choruses.push({ gain: swell, level: 0, timer: Math.random() * 3 });
      }
    }
    return { ctx, bus: this.bus, noise };
  }

  /** Call every rendered frame. */
  update(dt: number, f: AmbienceFrame): void {
    const r = this.ready();
    if (!r) return;
    const { ctx } = r;
    const now = ctx.currentTime;
    this.bus!.gain.setTargetAtTime(this.volume, now, 0.1);

    // Cicadas: the bed follows the clock; each chorus swells and dies away on its own.
    const day = cicadaLevel(f.hour);
    this.cicadaBed!.gain.setTargetAtTime(day * 0.16, now, 1.5);
    for (const c of this.choruses) {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.level = c.level > 0.5 ? 0.15 + Math.random() * 0.3 : 0.7 + Math.random() * 0.3;
        c.timer = 3 + Math.random() * 7;
        c.gain.gain.setTargetAtTime(c.level, now, c.level > 0.5 ? 1.2 : 2.2);
      }
    }

    // Night: crickets close by, a scops owl further off.
    const night = nightLevel(f.hour);
    if (night > 0.05) {
      this.cricketTimers = this.cricketTimers.map((t, i) => {
        t -= dt;
        if (t > 0) return t;
        this.cricket(4100 + i * 650, i ? 0.5 : -0.4, 0.05 * night);
        return 0.55 + Math.random() * 0.9;
      });
      const o = this.owl;
      o.timer -= dt;
      if (o.timer <= 0) {
        if (o.quietFor > 0) {
          o.quietFor = 0;
          const a = Math.random() * Math.PI * 2;
          o.x = f.listener.x + Math.cos(a) * 45;
          o.z = f.listener.z + Math.sin(a) * 45;
        }
        this.owlNote(o.x, f.listener.y + 6, o.z, 0.12 * night);
        // He calls every 2.6 s for a while, then goes quiet and moves to another tree.
        if (Math.random() < 0.03) {
          o.quietFor = 1;
          o.timer = 25 + Math.random() * 30;
        } else o.timer = 2.6 + (Math.random() - 0.5) * 0.15;
      }
    }

    // Bells: a clank budget keeps a running flock from turning into a carillon.
    this.bellBudget = Math.min(10, this.bellBudget + dt * 10);
    for (const s of f.sheep) {
      if (!wearsBell(s)) continue;
      const d = Math.hypot(s.x - f.listener.x, s.z - f.listener.z);
      if (d > 70) continue;
      if (Math.random() < bellRate(s) * dt && this.bellBudget >= 1) {
        this.bellBudget -= 1;
        this.bell(bellPitch(s), s.x, s.y + 0.5, s.z, s.isLeader ? 0.2 : 0.13);
      }
    }

    // The call to prayer, when its time comes round.
    if (this.prevHour >= 0 && f.minaret && prayerDue(this.prevHour, f.hour) !== null) this.callToPrayer(f.minaret, f.listener);
    this.prevHour = f.hour;
  }

  private cricket(freq: number, pan: number, gain: number): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, bus } = r;
    const sp = ctx.createStereoPanner();
    sp.pan.value = pan;
    sp.connect(bus);
    let t = ctx.currentTime + 0.01;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.004);
      g.gain.linearRampToValueAtTime(0, t + 0.018);
      o.connect(g).connect(sp);
      o.start(t);
      o.stop(t + 0.02);
      t += 0.042;
    }
  }

  private panner(ctx: AudioContext, bus: GainNode, x: number, y: number, z: number, ref: number): PannerNode {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(bus);
    return p;
  }

  /** The scops owl: one soft, slightly falling "tyoo". */
  private owlNote(x: number, y: number, z: number, gain: number): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, bus } = r;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1260, t);
    o.frequency.linearRampToValueAtTime(1180, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.22);
    o.connect(g).connect(this.panner(ctx, bus, x, y, z, 25));
    o.start(t);
    o.stop(t + 0.25);
  }

  /** A copper sheep bell: inharmonic partials, a quick clapper click, often struck twice. */
  private bell(f: number, x: number, y: number, z: number, gain: number): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, bus, noise } = r;
    const pan = this.panner(ctx, bus, x, y, z, 3);
    const strikes = Math.random() < 0.55 ? 2 : 1;
    let t = ctx.currentTime + 0.01;
    for (let k = 0; k < strikes; k++) {
      const amp = gain * (k ? 0.55 : 1) * (0.7 + Math.random() * 0.3);
      for (const [ratio, rel, decay] of [
        [1, 1, 0.7],
        [2.32, 0.5, 0.45],
        [4.25, 0.3, 0.25],
        [6.63, 0.15, 0.15],
      ] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = f * ratio;
        const g = ctx.createGain();
        g.gain.setValueAtTime(amp * rel, t);
        g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        o.connect(g).connect(pan);
        o.start(t);
        o.stop(t + decay + 0.02);
      }
      const click = ctx.createBufferSource();
      click.buffer = noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(amp * 0.6, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      click.connect(hp).connect(cg).connect(pan);
      click.start(t, Math.random() * 0.4, 0.04);
      t += 0.08 + Math.random() * 0.06;
    }
  }

  /**
   * The ezan from the minaret: a voice made of a sawtooth through vowel formants, sung in
   * long melismatic phrases with vibrato, echoing off the hills. Wordless, and soft with
   * distance: from the homestead it is a far thread of sound.
   */
  callToPrayer(at: { x: number; y: number; z: number }, listener: { x: number; z: number }): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, bus } = r;
    if (ctx.currentTime < this.ezanUntil) return;
    const dist = Math.hypot(at.x - listener.x, at.z - listener.z);
    const t0 = ctx.currentTime + 0.1;

    const pan = this.panner(ctx, bus, at.x, at.y, at.z, 90);
    // Distance takes the top off the voice.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(1400, 5200 - dist * 3.5);
    // The hills answer a third of a second later.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    echo.connect(fb).connect(echo);
    lp.connect(pan);
    lp.connect(echo);
    echo.connect(pan);

    const voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.4;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 0;
    vib.connect(vibDepth).connect(voice.frequency);
    const env = ctx.createGain();
    env.gain.value = 0;
    // Formants of an open "a".
    for (const [fq, q, g] of [
      [730, 7, 1],
      [1090, 9, 0.5],
      [2440, 11, 0.22],
    ] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = g;
      voice.connect(bp).connect(fg).connect(env);
    }
    env.connect(lp);

    const hz = (deg: number) => EZAN_BASE * Math.pow(2, HICAZ[deg] / 12);
    let t = t0;
    const level = 0.35;
    voice.frequency.setValueAtTime(hz(0), t);
    for (const phrase of EZAN_PHRASES) {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(level, t + 0.35);
      voice.frequency.setValueAtTime(hz(phrase[0][0]) * 0.97, t);
      for (const [deg, dur] of phrase) {
        // Glide into each note, and let vibrato bloom on the long ones.
        voice.frequency.linearRampToValueAtTime(hz(deg), t + Math.min(0.12, dur * 0.4));
        vibDepth.gain.setValueAtTime(0, t);
        vibDepth.gain.linearRampToValueAtTime(dur > 1 ? hz(deg) * 0.014 : hz(deg) * 0.004, t + Math.min(dur, 0.8));
        // A slight dip in level within the short notes, like syllables.
        env.gain.linearRampToValueAtTime(level * (dur > 1 ? 1 : 0.82), t + dur * 0.5);
        env.gain.linearRampToValueAtTime(level, t + dur);
        t += dur;
      }
      env.gain.linearRampToValueAtTime(0, t + 0.5);
      t += 2.6;
    }
    voice.start(t0);
    vib.start(t0);
    voice.stop(t);
    vib.stop(t);
    this.ezanUntil = t;
  }
}

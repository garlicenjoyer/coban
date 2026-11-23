// Grazing map (GDD: one texel per 2 m). Sheep eat it down; it regrows logistically
// in in-game hours; a cell eaten to zero is an overgrazed scar that only re-seeds slowly.

import { config } from '../core/config';
import { fbm } from './noise';
import { Surface, type Terrain } from './terrain';

export const GRASS_TEXEL_M = 2;

/** Logistic growth rate per in-game hour, by surface. 0.1 -> 0.9 takes ~4.4 / r hours. */
const GROWTH: Partial<Record<Surface, number>> = {
  [Surface.Pasture]: 0.04, // ~4.5 days from bare-ish to lush
  [Surface.Grass]: 0.025,
};

/** How many texels either side a grazing sheep reaches (see meanAround). */
const REACH = 2;

/** Below this a cell counts as a scar: logistic growth would stall, so it re-seeds linearly. */
const SCAR = 0.01;
/** Re-seed to 0.05 over 7 in-game days. */
const SEED_PER_HOUR = 0.05 / (7 * 24);

export class GrassMap {
  readonly W: number;
  readonly size: number;
  readonly half: number;
  readonly value: Float32Array;
  readonly rate: Float32Array;
  /**
   * Trail wear, 0..1: hooves on the same route day after day. A worn texel is a packed
   * path: the flock walks it faster and calmer, and grass can't grow back on it.
   */
  readonly wear: Float32Array;
  /** Bumped whenever values change, so the view knows to re-upload. */
  version = 0;

  constructor(terrain: Terrain) {
    this.size = terrain.size;
    this.half = terrain.half;
    this.W = Math.round(terrain.size / GRASS_TEXEL_M);
    this.value = new Float32Array(this.W * this.W);
    this.rate = new Float32Array(this.W * this.W);
    this.wear = new Float32Array(this.W * this.W);
    for (let j = 0; j < this.W; j++) {
      for (let i = 0; i < this.W; i++) {
        const x = -this.half + (i + 0.5) * GRASS_TEXEL_M;
        const z = -this.half + (j + 0.5) * GRASS_TEXEL_M;
        const s = terrain.surfaceAt(x, z);
        const k = j * this.W + i;
        const n = fbm(x / 25, z / 25, 3, 31);
        if (s === Surface.Pasture) this.value[k] = 0.9 + 0.08 * n;
        else if (s === Surface.Grass) this.value[k] = Math.max(0.05, 0.45 + 0.25 * n);
        else this.value[k] = 0;
        this.rate[k] = GROWTH[s] ?? 0;
      }
    }
  }

  private index(x: number, z: number): number {
    const i = Math.floor((x + this.half) / GRASS_TEXEL_M);
    const j = Math.floor((z + this.half) / GRASS_TEXEL_M);
    if (i < 0 || j < 0 || i >= this.W || j >= this.W) return -1;
    return j * this.W + i;
  }

  at(x: number, z: number): number {
    const k = this.index(x, z);
    return k < 0 ? 0 : this.value[k];
  }

  /** Remove up to `amount`; returns how much was actually eaten. */
  eat(x: number, z: number, amount: number): number {
    const k = this.index(x, z);
    if (k < 0 || this.rate[k] === 0) return 0;
    const v = this.value[k];
    const e = Math.min(v, amount);
    this.value[k] = v - e;
    return e;
  }

  /**
   * Mean grass over the 5×5 texels (10 m square) round (x, z): what a grazing sheep works
   * through in an in-game hour. The clock runs 60× fast, so in a real minute she crops a
   * far wider patch than she visibly walks.
   */
  meanAround(x: number, z: number): number {
    let sum = 0;
    for (let dj = -REACH; dj <= REACH; dj++) for (let di = -REACH; di <= REACH; di++) sum += this.at(x + di * GRASS_TEXEL_M, z + dj * GRASS_TEXEL_M);
    return sum / ((2 * REACH + 1) * (2 * REACH + 1));
  }

  /**
   * Crop up to `amount` from the 5×5 texels round (x, z), each giving in proportion to what
   * it holds (a sheep moves her head to the thicker tufts). Returns how much was eaten.
   */
  eatAround(x: number, z: number, amount: number): number {
    const ks: number[] = [];
    let total = 0;
    for (let dj = -REACH; dj <= REACH; dj++)
      for (let di = -REACH; di <= REACH; di++) {
        const k = this.index(x + di * GRASS_TEXEL_M, z + dj * GRASS_TEXEL_M);
        if (k < 0 || this.rate[k] === 0) continue;
        ks.push(k);
        total += this.value[k];
      }
    if (total <= 0) return 0;
    const take = Math.min(amount, total);
    for (const k of ks) this.value[k] = Math.max(0, this.value[k] - take * (this.value[k] / total));
    return take;
  }

  wearAt(x: number, z: number): number {
    const k = this.index(x, z);
    return k < 0 ? 0 : this.wear[k];
  }

  /** Hooves passing: wear the ground (grazeable ground only; roads are roads already). */
  tread(x: number, z: number, amount: number): void {
    const k = this.index(x, z);
    if (k < 0 || this.rate[k] === 0) return;
    this.wear[k] = Math.min(1, this.wear[k] + amount);
    // Trampled grass.
    this.value[k] = Math.max(0, this.value[k] - amount * 0.5);
  }

  /** Advance regrowth by `hours` of in-game time. Trails slowly grass over when unused. */
  grow(hours: number): void {
    const v = this.value;
    const r = this.rate;
    const w = this.wear;
    const decay = config.trails.decayPerHour * hours;
    const cap = config.trails.grassCap;
    for (let k = 0; k < v.length; k++) {
      if (r[k] === 0) continue;
      const g = v[k];
      let next = g < SCAR ? g + SEED_PER_HOUR * hours : Math.min(1, g + r[k] * g * (1 - g) * hours);
      if (w[k] > 0) {
        next = Math.min(next, Math.max(g, 1 - w[k] * cap));
        w[k] = Math.max(0, w[k] - decay);
      }
      v[k] = next;
    }
    this.version++;
  }

  /** Mean grass in a disc (pasture readings for the debug panel and tests). */
  meanIn(cx: number, cz: number, radius: number): number {
    let sum = 0;
    let n = 0;
    for (let z = cz - radius; z <= cz + radius; z += GRASS_TEXEL_M) {
      for (let x = cx - radius; x <= cx + radius; x += GRASS_TEXEL_M) {
        if (Math.hypot(x - cx, z - cz) > radius) continue;
        sum += this.at(x, z);
        n++;
      }
    }
    return n ? sum / n : 0;
  }
}

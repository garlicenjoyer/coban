// Wolves stalk the flock or probe the pen, rush exposed sheep, and retreat
// when driven off.

import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/events';
import type { Flock } from '../flock/flock';
import { NavAgent, navFor } from '../world/nav';
import type { Obstacles } from '../world/obstacles';
import type { Terrain } from '../world/terrain';
import { layout } from '../world/map';

export type WolfState = 'stalk' | 'hunt' | 'flee';

export interface Wolf {
  id: number;
  kind: 'flock' | 'pen';
  age: number;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vz: number;
  heading: number;
  prevHeading: number;
  state: WolfState;
  morale: number;
  target: number;
  fromX: number;
  fromZ: number;
  gaitPhase: number;
  /** Route round fences and buildings. */
  route: NavAgent;
}

export interface DogPressure {
  x: number;
  z: number;
  /** Barked within the last second. */
  barking: boolean;
  charging: boolean;
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class Wolves {
  readonly list: Wolf[] = [];
  bites = 0;
  private nextId = 0;
  private crooks: GameEvents['crookWave'][] = [];
  private unsub: () => void;

  constructor(
    private terrain: Terrain,
    private obstacles: Obstacles,
    private events: EventBus,
  ) {
    this.unsub = events.on('crookWave', (e) => this.crooks.push(e));
  }

  dispose(): void {
    this.unsub();
  }

  spawn(x: number, z: number, kind: Wolf['kind'] = 'flock'): Wolf {
    const y = this.terrain.heightAt(x, z);
    const w: Wolf = {
      id: this.nextId++,
      kind,
      age: 0,
      x,
      y,
      z,
      px: x,
      py: y,
      pz: z,
      vx: 0,
      vz: 0,
      heading: 0,
      prevHeading: 0,
      state: 'stalk',
      morale: config.wolf.morale.start,
      target: -1,
      fromX: x,
      fromZ: z,
      gaitPhase: 0,
      route: new NavAgent(navFor(this.terrain, this.obstacles), { maxSlope: 40, softSlope: 32 }, 0.6, this.nextId * 0.41),
    };
    this.list.push(w);
    return w;
  }

  retire(wolf: Wolf): void {
    const i = this.list.indexOf(wolf);
    if (i >= 0) this.list.splice(i, 1);
    wolf.state = 'flee';
  }

  /** A sudden loud noise (the horn): morale drops for wolves within `radius`. */
  scare(x: number, z: number, radius: number, morale: number): void {
    for (const w of this.list) if (Math.hypot(w.x - x, w.z - z) < radius) w.morale -= morale;
  }

  /** Wolves a sheep or dog should currently worry about. */
  active(): Wolf[] {
    return this.list.filter((w) => w.state !== 'flee');
  }

  step(
    dt: number,
    tick: number,
    flock: Flock,
    dog: DogPressure | null,
    player: { x: number; z: number },
    /** The shepherd's hush: sheep inside it are only noticed from very close. */
    quiet: { x: number; z: number; radius: number } | null = null,
  ): void {
    const wc = config.wolf;
    for (const w of this.list) {
      w.px = w.x;
      w.py = w.y;
      w.pz = w.z;
      w.prevHeading = w.heading;
    }
    // Crook hits.
    for (const e of this.crooks) {
      for (const w of this.list) {
        const dx = w.x - e.origin.x;
        const dz = w.z - e.origin.z;
        const d = Math.hypot(dx, dz);
        if (d < e.range && d > 1e-3 && (dx * e.dirX + dz * e.dirZ) / d >= Math.cos(e.halfAngle)) w.morale -= wc.morale.crookHit;
      }
    }
    this.crooks.length = 0;

    for (const w of this.list) {
      w.age += dt;
      const pen = w.kind === 'pen' ? layout.pen : null;
      const c = pen ?? flock.centroid;
      // Morale.
      if (dog) {
        const dd = Math.hypot(dog.x - w.x, dog.z - w.z);
        if (dog.barking && dd < 20) w.morale -= wc.morale.dogBarkPerSec * dt;
        if (dog.charging && dd < 6) w.morale -= wc.morale.dogChargePerSec * dt;
      }
      if (Math.hypot(player.x - w.x, player.z - w.z) < 8) w.morale -= wc.morale.playerNearPerSec * dt;
      if (w.morale <= 0 || (pen && w.age >= wc.probeSeconds)) w.state = 'flee';

      // Target selection.
      // Pace along the gate side while looking for exposed sheep.
      let tx = pen ? pen.x + pen.hx + 2 : c.x;
      let tz = pen ? pen.z + 4 * Math.sin(w.age * 0.65) : c.z;
      let speed = wc.speeds.stalk;
      if (w.state !== 'flee') {
        let best = wc.huntRange;
        let bi = -1;
        flock.sheep.forEach((s, i) => {
          // The daytime encounter retains its flock target. A pen probe can
          // enter through an open gate and threaten sheep still in the yard.
          if (s.inPen && (!pen || !flock.gateOpen)) return;
          const d = Math.hypot(s.x - w.x, s.z - w.z);
          const hushed = quiet && Math.hypot(s.x - quiet.x, s.z - quiet.z) < quiet.radius;
          if (hushed && d > wc.hushHuntRange) return;
          if (d >= wc.huntRange) return;
          // Wolves single out the weak: a worn-down sheep looks closer than she is.
          const score = d - (100 - s.condition) * 0.08;
          if (score < best) {
            best = score;
            bi = i;
          }
        });
        if (bi >= 0) {
          w.state = 'hunt';
          w.target = bi;
        } else if (w.target < 0 || (flock.sheep[w.target].inPen && (!pen || !flock.gateOpen))) {
          w.state = 'stalk';
          w.target = -1;
        }
        if (w.state === 'hunt' && w.target >= 0) {
          const s = flock.sheep[w.target];
          const outsideGate = pen && s.inPen && w.x > pen.x + pen.hx && Math.abs(w.z - pen.z) > pen.gateWidth * 0.25;
          tx = outsideGate ? pen.x + pen.hx + 0.3 : s.x;
          tz = outsideGate ? pen.z : s.z;
          speed = wc.speeds.hunt;
          if (Math.hypot(s.x - w.x, s.z - w.z) < wc.biteRange) {
            flock.bite(w.target, w.x, w.z);
            this.bites++;
            this.events.emit('wolfBite', { sheep: w.target, tick });
            w.state = 'flee';
          }
        }
      }
      if (w.state === 'flee') {
        const dx = w.x - c.x;
        const dz = w.z - c.z;
        const d = Math.max(1e-3, Math.hypot(dx, dz));
        tx = w.x + (dx / d) * 10;
        tz = w.z + (dz / d) * 10;
        speed = wc.speeds.flee;
      }

      // Move, round obstacles rather than into them.
      const way = w.route.steer(w.x, w.z, tx, tz, dt);
      const dx = way.x - w.x;
      const dz = way.z - w.z;
      const d = Math.max(1e-3, Math.hypot(dx, dz));
      const k = 1 - Math.exp(-6 * dt);
      w.vx += ((dx / d) * speed - w.vx) * k;
      w.vz += ((dz / d) * speed - w.vz) * k;
      let nx = w.x + w.vx * dt;
      let nz = w.z + w.vz * dt;
      const p = this.obstacles.pushOut(nx, nz, wc.radius);
      nx = Math.max(-(this.terrain.half - 5), Math.min(this.terrain.half - 5, p.x));
      nz = Math.max(-(this.terrain.half - 5), Math.min(this.terrain.half - 5, p.z));
      w.vx = (nx - w.x) / dt;
      w.vz = (nz - w.z) / dt;
      w.x = nx;
      w.z = nz;
      w.y = this.terrain.heightAt(w.x, w.z);
      const sp = Math.hypot(w.vx, w.vz);
      if (sp > 0.1) w.heading = wrap(w.heading + wrap(Math.atan2(w.vx, w.vz) - w.heading) * Math.min(1, 10 * dt));
      w.gaitPhase += sp * dt * 5;
    }

    // Despawn wolves that have run far enough.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i];
      const c = w.kind === 'pen' ? layout.pen : flock.centroid;
      if (w.state === 'flee' && Math.hypot(w.x - c.x, w.z - c.z) > wc.despawnDistance) this.list.splice(i, 1);
    }
  }

  stateKey(): number[] {
    const out: number[] = [this.bites];
    for (const w of this.list) out.push(w.id, w.kind === 'pen' ? 1 : 0, w.age, w.x, w.z, w.morale, w.target);
    return out;
  }
}

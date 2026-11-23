// Flock simulation (GDD Part III, Flock AI).
//   needs and mode               -> graze, herd, flee, or stop for water
//   steering (every tick)         -> weighted boids + herding forces -> velocity
// Headless and deterministic: seeded RNG, fixed iteration order, no wall-clock reads in state.

import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/events';
import type { InputFrame } from '../core/input';
import type { Gait } from '../player/controller';
import type { GrassMap } from '../world/grassMap';
import { rng as makeRng } from '../world/noise';
import { NavAgent, navFor, type NavGrid } from '../world/nav';
import type { Obstacles } from '../world/obstacles';
import { SpatialHash } from '../world/spatialHash';
import type { Terrain } from '../world/terrain';
import { insidePen, layout } from '../world/map';
import type { WaterPoint, WaterSupply } from '../world/water';
import { createSheep, HIST_LEN, Mode, Personality, PERSONALITY_MODS, type Sheep } from './sheep';

const DEG = Math.PI / 180;

export interface FlockContext {
  player: { x: number; z: number; vx: number; vz: number; gait: Gait };
  frame: InputFrame;
  tick: number;
  dt: number;
  /** In-game hours that pass this tick. */
  hours: number;
  hot?: boolean;
  water?: WaterSupply;
  /** The shepherd is hushing the flock: sheep in this circle freeze, heads down, and calm faster. */
  hush?: { x: number; z: number; radius: number } | null;
  /** A salt lick set down: sheep near it stay calm and graze around it. */
  salt?: { x: number; z: number; radius: number } | null;
  /** The interact button is being used for the gate, not for freeing sheep. */
  interactUsedByGate: boolean;
  /** The Kangal, if present. A moving dog presses sheep; a resting one calms them. */
  dog?: {
    x: number;
    z: number;
    vx: number;
    vz: number;
    resting: boolean;
    pushX?: number;
    pushZ?: number;
    /** Gathering: sheep near him stop grazing and bunch up. */
    gathering?: boolean;
  } | null;
  /** Active predators: big flight zones, no pressure cone, lots of stress. */
  wolves?: { x: number; z: number; vx: number; vz: number }[];
  /** The motorcycle: solid, and its engine noise frightens sheep (GDD: within 25 m above idle). */
  bike?: { x: number; z: number; vx: number; vz: number; heading: number; noise: number } | null;
}

interface Threat {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  /** Directional pressure (move on ahead) instead of plain away. */
  cone: boolean;
  /** Press in this direction instead of along the presser's velocity (a working dog). */
  pushX?: number;
  pushZ?: number;
  stressGain: number;
  /** Only the shepherd's zone shrinks for sheep he has just called. */
  shepherd: boolean;
  /** Reaction scales with how directly it is coming at the sheep (the dog). */
  passing?: boolean;
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

function clampLen(x: number, z: number, max: number): [number, number] {
  const l = Math.hypot(x, z);
  return l > max ? [(x / l) * max, (z / l) * max] : [x, z];
}

export class Flock {
  readonly sheep: Sheep[] = [];
  /** The bellwether. Replaced if she is lost. */
  leader: Sheep;
  readonly grid = new SpatialHash(8);
  private nb: number[] = [];
  private rand: () => number;
  private crooks: GameEvents['crookWave'][] = [];
  private calls: GameEvents['call'][] = [];
  private noises: GameEvents['playerNoise'][] = [];
  private unsub: (() => void)[] = [];
  private nav: NavGrid;
  /** Per-sheep routes: to the bellwether, to the shepherd, to water. */
  private routes = new WeakMap<Sheep, { lead: NavAgent; call: NavAgent; water: NavAgent }>();

  centroid = { x: 0, z: 0 };
  /** Radius around the centroid holding 80% of the non-stray flock. */
  radius80 = 5;
  inPen = 0;
  strays = 0;
  stuck = 0;
  strayEvents = 0;
  stuckEvents = 0;
  /** Wall-clock cost per step, ms, smoothed (profiling only, not state). */
  lastStepMs = 0;

  constructor(
    private terrain: Terrain,
    private grass: GrassMap,
    private obstacles: Obstacles,
    events: EventBus,
    count = config.flock.count,
    seed = 7,
  ) {
    this.rand = makeRng(seed);
    this.nav = navFor(terrain, obstacles);
    const r = this.rand;

    // Personalities: one bellwether, then wanderers, timid and greedy sheep, rest steady.
    const kinds: Personality[] = [];
    const share = Math.max(1, Math.round(count / 6));
    for (let i = 0; i < share; i++) kinds.push(Personality.Wanderer, Personality.Timid, Personality.Greedy);
    while (kinds.length < count - 1) kinds.push(Personality.Steady);
    kinds.length = count - 1;
    kinds.push(Personality.Bellwether);
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }

    // Spawn on a jittered grid inside the pen.
    const pen = layout.pen;
    const cols = 6;
    for (let i = 0; i < count; i++) {
      const cx = i % cols;
      const cz = Math.floor(i / cols);
      const x = pen.x - pen.hx + 3 + cx * 2.6 + (r() - 0.5) * 0.6;
      const z = pen.z - pen.hz + 2 + cz * 2.2 + (r() - 0.5) * 0.6;
      this.sheep.push(createSheep(i, kinds[i], x, terrain.heightAt(x, z), z, r() * Math.PI * 2));
    }
    this.leader = this.sheep.find((s) => s.isLeader)!;

    this.unsub.push(
      events.on('crookWave', (e) => this.crooks.push(e)),
      events.on('call', (e) => this.calls.push(e)),
      events.on('playerNoise', (e) => this.noises.push(e)),
    );
    this.updateCounts();
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }

  // ---------------------------------------------------------------- events

  private applyEvents(): void {
    const fc = config.flock;
    for (const e of this.crooks) {
      const cosHalf = Math.cos(e.halfAngle);
      for (const s of this.sheep) {
        if (s.stuck !== 'none') continue;
        const dx = s.x - e.origin.x;
        const dz = s.z - e.origin.z;
        const d = Math.hypot(dx, dz);
        const m = PERSONALITY_MODS[s.personality];
        if (d < e.range && d > 1e-3 && (dx * e.dirX + dz * e.dirZ) / d >= cosHalf) {
          // Inside the swing: run along the swing, a little away from the shepherd.
          const fx = e.dirX * 0.7 + (dx / d) * 0.3;
          const fz = e.dirZ * 0.7 + (dz / d) * 0.3;
          const l = Math.hypot(fx, fz);
          s.fleeX = fx / l;
          s.fleeZ = fz / l;
          s.fleeTimer = fc.crook.fleeSeconds;
          s.stress = Math.min(100, s.stress + fc.stress.crook * m.stress);
          s.callTimer = 0;
          if (s.stress > fc.stress.scatterAt) s.scatterAngle = (this.rand() - 0.5) * 1.6;
        } else if (d < e.range * 1.6) {
          s.stress = Math.min(100, s.stress + fc.stress.crookNear * m.stress);
        }
      }
    }
    for (const e of this.calls) {
      for (const s of this.sheep) {
        const d = Math.hypot(s.x - e.origin.x, s.z - e.origin.z);
        if (d > e.radius || s.stress >= fc.stress.panicAt) continue;
        s.callTimer = s.isLeader ? fc.call.leaderFollowSeconds : fc.call.followSeconds;
        s.stress = Math.max(0, s.stress - fc.call.calm);
      }
    }
    for (const e of this.noises) {
      for (const s of this.sheep) {
        const d = Math.hypot(s.x - e.origin.x, s.z - e.origin.z);
        if (d < e.radius) s.stress = Math.min(100, s.stress + fc.stress.sprintNoise * (1 - d / e.radius) * PERSONALITY_MODS[s.personality].stress);
      }
    }
    this.crooks.length = this.calls.length = this.noises.length = 0;
  }

  // ---------------------------------------------------------------- helpers

  private slopeAt(x: number, z: number): number {
    return this.terrain.slopeDegAt(x, z);
  }

  private chooseWater(s: Sheep, water?: WaterSupply): WaterPoint | undefined {
    const { drinkAt, seekAt, satisfied, searchRadius } = config.flock.thirst;
    if (!water || s.thirst <= satisfied || (s.waterTarget < 0 && s.thirst < drinkAt)) return;
    let nearest: WaterPoint | undefined;
    let best = Infinity;
    for (const point of water.points) {
      if (point.liters === 0 || point.inPen !== s.inPen) continue;
      const distance = Math.hypot(point.x - s.x, point.z - s.z);
      const limit = s.thirst >= seekAt || point.id === s.waterTarget ? searchRadius : point.radius + 2.5;
      if (distance < limit && distance < best) {
        nearest = point;
        best = distance;
      }
    }
    return nearest;
  }

  /** Point is somewhere a sheep should not walk into. */
  private bad(x: number, z: number): boolean {
    const fc = config.flock;
    return (
      Math.abs(x) > layout.bounds.walk ||
      Math.abs(z) > layout.bounds.walk ||
      this.obstacles.blocked(x, z, fc.radius) ||
      this.slopeAt(x, z) > fc.slope.avoidDeg
    );
  }

  private pickWanderDir(s: Sheep, grazeBias: boolean): void {
    let best = -Infinity;
    let bx = 0;
    let bz = 0;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    for (let k = 0; k < 6; k++) {
      const a = s.heading + (k / 6) * Math.PI * 2 + (this.rand() - 0.5) * 0.5;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const px = s.x + dx * 5;
      const pz = s.z + dz * 5;
      let score = 0.35 * (dx * fx + dz * fz) + this.rand() * 0.25;
      // The grass she can see ahead. The bellwether looks past the flock's own eaten patch,
      // so the flock drifts on to fresh grass instead of standing on what it cropped.
      if (grazeBias) {
        const ahead = this.grass.meanAround(px, pz);
        score += (s.isLeader ? Math.max(ahead, this.grass.meanAround(s.x + dx * 14, s.z + dz * 14)) : ahead) * 1.2;
      }
      if (this.bad(px, pz)) score -= 1.5;
      if (score > best) {
        best = score;
        bx = dx;
        bz = dz;
      }
    }
    s.wanderX = bx;
    s.wanderZ = bz;
  }

  /** Set by the sim every tick. */
  gateOpen = false;

  private routesOf(s: Sheep): { lead: NavAgent; call: NavAgent; water: NavAgent } {
    let r = this.routes.get(s);
    if (!r) {
      const sl = config.flock.slope;
      // Steep ground is costly but not ruled out: a sheep can still blunder up a bank and get stuck.
      const o = { maxSlope: 90, softSlope: sl.avoidDeg };
      const ph = (s.id * 0.37) % 1;
      r = { lead: new NavAgent(this.nav, o, 0.8, ph), call: new NavAgent(this.nav, o, 0.6, ph), water: new NavAgent(this.nav, o, 0.8, ph) };
      this.routes.set(s, r);
    }
    return r;
  }

  private updateCounts(): void {
    let cx = 0;
    let cz = 0;
    let n = 0;
    let inPen = 0;
    let strays = 0;
    let stuck = 0;
    for (const s of this.sheep) {
      if (s.inPen) inPen++;
      if (s.isStray) strays++;
      if (s.stuck !== 'none') stuck++;
      if (!s.isStray) {
        cx += s.x;
        cz += s.z;
        n++;
      }
    }
    if (n > 0) {
      this.centroid = { x: cx / n, z: cz / n };
      const ds = this.sheep
        .filter((s) => !s.isStray)
        .map((s) => Math.hypot(s.x - this.centroid.x, s.z - this.centroid.z))
        .sort((a, b) => a - b);
      this.radius80 = Math.max(3, ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.8))]);
    }
    this.inPen = inPen;
    this.strays = strays;
    this.stuck = stuck;
  }

  /** A wolf reached this sheep: it bolts away in panic, hurt. */
  bite(i: number, fromX: number, fromZ: number): void {
    const s = this.sheep[i];
    const dx = s.x - fromX;
    const dz = s.z - fromZ;
    const d = Math.max(1e-3, Math.hypot(dx, dz));
    s.condition = Math.max(5, s.condition - config.condition.bite);
    s.stress = 100;
    s.fleeX = dx / d;
    s.fleeZ = dz / d;
    s.fleeTimer = 3;
    s.callTimer = 0;
  }

  /** A sling stone lands: sheep close by jump away from the thud. */
  startleFrom(x: number, z: number, radius: number, stress: number): void {
    for (const s of this.sheep) {
      if (s.stuck !== 'none' || s.led) continue;
      const dx = s.x - x;
      const dz = s.z - z;
      const d = Math.hypot(dx, dz);
      if (d >= radius) continue;
      const k = 1 - d / radius;
      s.stress = Math.min(100, s.stress + stress * k * PERSONALITY_MODS[s.personality].stress);
      s.fleeX = d > 1e-3 ? dx / d : 1;
      s.fleeZ = d > 1e-3 ? dz / d : 0;
      s.fleeTimer = Math.max(s.fleeTimer, 0.8 + 1.2 * k);
      s.callTimer = 0;
    }
  }

  /** Lift a stuck sheep out straight away (the halter rope). */
  freeNow(s: Sheep, player: { x: number; z: number }): void {
    if (s.stuck !== 'none') this.free(s, player);
  }

  /** A whistle close by makes sheep jump a little. */
  startle(x: number, z: number, radius: number, stress: number): void {
    for (const s of this.sheep) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < radius) s.stress = Math.min(100, s.stress + stress * (1 - d / radius) * PERSONALITY_MODS[s.personality].stress);
    }
  }

  /**
   * The dog shoves a slope-stuck sheep free: it is set down on the first gentle,
   * unobstructed ground in the direction of (tx, tz).
   */
  shoveFree(s: Sheep, tx: number, tz: number): void {
    if (s.stuck !== 'slope') return;
    const dx = tx - s.x;
    const dz = tz - s.z;
    const d = Math.max(1e-3, Math.hypot(dx, dz));
    let x = s.x;
    let z = s.z;
    for (let r = 1; r <= 20; r += 0.5) {
      const px = s.x + (dx / d) * r;
      const pz = s.z + (dz / d) * r;
      if (this.terrain.slopeDegAt(px, pz) < 20 && !this.obstacles.blocked(px, pz, config.flock.radius)) {
        x = px;
        z = pz;
        break;
      }
    }
    this.free(s, { x: x + (dx / d) * 0.01, z: z + (dz / d) * 0.01 }, { x, z });
  }

  private free(s: Sheep, player: { x: number; z: number }, placeAt?: { x: number; z: number }): void {
    const dx = player.x - s.x;
    const dz = player.z - s.z;
    const d = Math.max(1e-3, Math.hypot(dx, dz));
    if (placeAt) {
      s.x = placeAt.x;
      s.z = placeAt.z;
    } else if (s.stuck === 'thorn') {
      s.x += (dx / d) * 0.9;
      s.z += (dz / d) * 0.9;
    } else {
      // Lifted out of the ravine/slope: set down just past the shepherd.
      s.x = player.x + (dx / d) * 1.0;
      s.z = player.z + (dz / d) * 1.0;
    }
    const p = this.obstacles.pushOut(s.x, s.z, config.flock.radius);
    s.x = p.x;
    s.z = p.z;
    s.y = this.terrain.heightAt(s.x, s.z);
    s.px = s.x;
    s.pz = s.z;
    s.stuck = 'none';
    s.freeProgress = 0;
    s.histCount = 0;
    s.stress = 30;
    s.vx = s.vz = 0;
  }

  // ---------------------------------------------------------------- step

  step(ctx: FlockContext): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const fc = config.flock;
    const dt = ctx.dt;
    const thirst = fc.thirst;
    const thirstGain = thirst.perHour * ctx.hours * (ctx.hot ? thirst.middayMultiplier : 1);
    const P = ctx.player;
    const coneCos = Math.cos(fc.pressureConeDeg * DEG);
    const tanClimb = Math.tan(fc.slope.maxClimbDeg * DEG);
    const L = this.leader;
    const leaderSpeed = Math.hypot(L.vx, L.vz);
    const leaderFx = Math.sin(L.heading);
    const leaderFz = Math.cos(L.heading);

    this.grid.clear();
    for (const s of this.sheep) {
      s.px = s.x;
      s.py = s.y;
      s.pz = s.z;
      s.prevHeading = s.heading;
      this.grid.insert(s.id, s.x, s.z);
    }

    this.applyEvents();

    // Freeing stuck sheep: hold interact next to one.
    let target: Sheep | null = null;
    if (ctx.frame.interactHeld && !ctx.interactUsedByGate) {
      let best = fc.stuck.freeReach;
      for (const s of this.sheep) {
        if (s.stuck === 'none') continue;
        const d = Math.hypot(s.x - P.x, s.z - P.z);
        if (d < best) {
          best = d;
          target = s;
        }
      }
    }
    for (const s of this.sheep) {
      if (s !== target) s.freeProgress = 0;
      else if ((s.freeProgress += dt) >= fc.stuck.freeSeconds) this.free(s, P);
    }

    const threats: Threat[] = [
      { x: P.x, z: P.z, vx: P.vx, vz: P.vz, radius: fc.flightZone[P.gait], cone: true, stressGain: fc.stress.zoneGain, shepherd: true },
    ];
    const D = ctx.dog;
    let calmDog: { x: number; z: number } | null = null;
    const workingDog = D && D.gathering ? D : null;
    if (D) {
      const ds = Math.hypot(D.vx, D.vz);
      if (D.resting || ds < 0.2) calmDog = D;
      else {
        const dz = config.dog.sheepFlightZone;
        threats.push({
          x: D.x,
          z: D.z,
          vx: D.vx,
          vz: D.vz,
          pushX: D.pushX,
          pushZ: D.pushZ,
          radius: ds > 2.5 ? dz.run : dz.walk,
          cone: true,
          stressGain: fc.stress.zoneGain,
          shepherd: false,
          passing: true,
        });
      }
    }
    for (const w of ctx.wolves ?? []) {
      threats.push({ x: w.x, z: w.z, vx: w.vx, vz: w.vz, radius: config.wolf.sheepFlightZone, cone: false, stressGain: config.wolf.sheepStressGain, shepherd: false });
    }
    const B = ctx.bike;
    const bn = config.bike.noise;
    if (B && B.noise > 0) {
      const bs = Math.hypot(B.vx, B.vz);
      threats.push({
        x: B.x,
        z: B.z,
        vx: B.vx,
        vz: B.vz,
        radius: Math.min(bn.zoneMax, bn.zoneBase + bn.zonePerMps * bs) * (0.5 + 0.5 * B.noise),
        cone: true,
        stressGain: fc.stress.zoneGain,
        shepherd: false,
      });
    }

    const tr = config.trails;
    const Salt = ctx.salt;
    for (const s of this.sheep) {
      const m = PERSONALITY_MODS[s.personality];
      s.forces.fill(0);
      s.fleeTimer = Math.max(0, s.fleeTimer - dt);
      s.callTimer = Math.max(0, s.callTimer - dt);
      s.drinking = false;
      // On the halter rope: always coming along behind the shepherd, calmly.
      if (s.led) {
        s.callTimer = Math.max(s.callTimer, 0.5);
        s.isStray = false;
        s.strayTimer = 0;
      }
      const wear = this.grass.wearAt(s.x, s.z);
      const onTrail = Math.max(0, Math.min(1, (wear - 0.3) / 0.4));
      const nearSalt = !!Salt && Math.hypot(s.x - Salt.x, s.z - Salt.z) < Salt.radius;

      if (s.stuck !== 'none') {
        s.mode = Mode.Stuck;
        s.vx = s.vz = 0;
        s.desiredSpeed = 0;
        continue;
      }

      // ---- threats: shepherd, dog, wolves (flight zones; shepherd and dog press forward)
      let zfx = 0;
      let zfz = 0;
      let threatened = false;
      let inZone = false;
      for (const T of threats) {
        if (T.shepherd && s.led) continue; // the rope: he's leading her, not pushing
        let R = T.radius;
        if (T.shepherd && s.callTimer > 0) R *= fc.call.flightZoneScale;
        const dx = s.x - T.x;
        const dz = s.z - T.z;
        const d = Math.hypot(dx, dz);
        if (d >= R || d < 1e-3) continue;
        let k = 1 - d / R;
        let ax = dx / d;
        let az = dz / d;
        const tSpeed = Math.hypot(T.vx, T.vz);
        const hasPush = T.pushX !== undefined && (T.pushX !== 0 || T.pushZ !== 0);
        if (T.passing && !hasPush && tSpeed > 0.5) {
          // An animal running past is less frightening than one running at you.
          const toward = (T.vx * ax + T.vz * az) / tSpeed; // +1 = coming straight at the sheep
          k *= 0.35 + 0.65 * Math.max(0, toward);
        }
        if (T.cone && (tSpeed > 0.3 || hasPush)) {
          const mx = hasPush ? T.pushX! : T.vx / tSpeed;
          const mz = hasPush ? T.pushZ! : T.vz / tSpeed;
          if (ax * mx + az * mz > coneCos) {
            // Pressure from behind: move on ahead of the presser, not sideways.
            ax += mx * fc.pressureForwardBlend;
            az += mz * fc.pressureForwardBlend;
            const l = Math.hypot(ax, az);
            ax /= l;
            az /= l;
          }
        }
        zfx += ax * k;
        zfz += az * k;
        // Keep running briefly after leaving the zone (momentum), in the same direction.
        if (s.fleeTimer < 0.6) {
          s.fleeX = ax;
          s.fleeZ = az;
          s.fleeTimer = 0.6;
        }
        s.stress = Math.min(100, s.stress + T.stressGain * k * dt * m.stress);
        threatened = true;
        inZone = true;
      }
      let ffx = zfx;
      let ffz = zfz;
      // A crook swing (long timer) always adds its push; the short after-run only
      // applies once the shepherd's zone no longer reaches the sheep.
      if (s.fleeTimer > 0 && !(inZone && s.fleeTimer <= 0.6)) {
        const k = Math.min(1, s.fleeTimer / fc.crook.fleeSeconds + 0.3);
        ffx += s.fleeX * k;
        ffz += s.fleeZ * k;
        threatened = true;
      }
      [ffx, ffz] = clampLen(ffx, ffz, 1);
      const fleeMag = Math.hypot(ffx, ffz);
      if (B && B.noise > 0) {
        const dn = Math.hypot(s.x - B.x, s.z - B.z);
        if (dn < bn.radius) {
          s.stress = Math.min(100, s.stress + B.noise * bn.stressPerSec * (1 - dn / bn.radius) * dt * m.stress);
          threatened = true;
        }
      }
      const Hz = ctx.hush;
      s.hushed = !!Hz && Math.hypot(s.x - Hz.x, s.z - Hz.z) < Hz.radius;
      if (!threatened) {
        const calm = calmDog && Math.hypot(calmDog.x - s.x, calmDog.z - s.z) < config.dog.calmRadius ? config.dog.calmFactor : 1;
        const familiar = 1 + (tr.calmBonus - 1) * onTrail;
        s.stress = Math.max(0, s.stress - fc.stress.decay * dt * (s.inPen ? 2 : 1) * calm * (s.hushed ? 2 : 1) * (nearSalt ? 2 : 1) * (s.led ? 2 : 1) * familiar);
      }

      // ---- mode
      const dLeader = Math.hypot(L.x - s.x, L.z - s.z);
      let bunching = false;
      let water: WaterPoint | undefined;
      // Flee needs a live threat (or its short after-run). High stress alone does not make
      // a sheep run; it makes the next scare worse (scatter above 70, panic above 90).
      if (s.fleeTimer > 0 || fleeMag > 0.25) s.mode = Mode.Flee;
      else if (s.callTimer > 0) s.mode = Mode.Follow;
      else if (
        workingDog &&
        !s.inPen &&
        Math.hypot(workingDog.x - s.x, workingDog.z - s.z) < config.dog.bunchRadius
      ) {
        // A gathering dog nearby: stop grazing and close ranks.
        s.mode = Mode.Follow;
        bunching = true;
      }
      else if ((water = this.chooseWater(s, ctx.water))) s.mode = Mode.SeekWater;
      else if (s.inPen && (s.isLeader || L.inPen)) s.mode = Mode.Penned;
      else if (
        !s.isLeader &&
        !s.isStray &&
        dLeader < fc.awareness &&
        (dLeader > fc.followDistance || leaderSpeed > 0.6 || s.inPen)
      )
        // The flock follows the bellwether, out of the pen too.
        s.mode = Mode.Follow;
      else s.mode = Mode.Graze;
      if (water) s.waterTarget = water.id;
      else if (s.thirst <= thirst.satisfied || s.mode === Mode.Graze || s.mode === Mode.Penned) s.waterTarget = -1;

      const W = water ? fc.weights.water : bunching
        ? fc.weights.bunch
        : s.mode === Mode.Flee
          ? fc.weights.flee
          : s.mode === Mode.Follow
            ? fc.weights.follow
            : s.mode === Mode.Penned
              ? fc.weights.penned
              : fc.weights.graze;

      // ---- neighbours: separation, alignment, cohesion
      let sepX = 0;
      let sepZ = 0;
      let aliX = 0;
      let aliZ = 0;
      let nA = 0;
      let cohX = 0;
      let cohZ = 0;
      let nC = 0;
      this.grid.query(s.x, s.z, fc.cohesionRadius, this.nb);
      for (const j of this.nb) {
        if (j === s.id) continue;
        const o = this.sheep[j];
        const dx = o.x - s.x;
        const dz = o.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d < fc.separationRadius && d > 1e-4) {
          const k = 1 - d / fc.separationRadius;
          sepX -= (dx / d) * k;
          sepZ -= (dz / d) * k;
        }
        if (d < fc.alignRadius) {
          aliX += o.vx;
          aliZ += o.vz;
          nA++;
        }
        if (d < fc.cohesionRadius && o.inPen === s.inPen) {
          cohX += o.x;
          cohZ += o.z;
          nC++;
        }
      }
      [sepX, sepZ] = clampLen(sepX, sepZ, 1);
      if (nA > 0) [aliX, aliZ] = clampLen(aliX / nA / fc.speeds.follow, aliZ / nA / fc.speeds.follow, 1);
      if (nC > 0) [cohX, cohZ] = clampLen((cohX / nC - s.x) / fc.cohesionRadius, (cohZ / nC - s.z) / fc.cohesionRadius, 1);
      else if (!s.isStray && !s.isLeader) {
        // Alone: drift back toward the flock.
        const dx = this.centroid.x - s.x;
        const dz = this.centroid.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d > 1 && d < fc.awareness) [cohX, cohZ] = [(dx / d) * Math.min(1, d / 30), (dz / d) * Math.min(1, d / 30)];
      }

      // ---- follow the bellwether (a point just behind her)
      let leadX = 0;
      let leadZ = 0;
      if (!s.isLeader && !s.isStray && dLeader < fc.awareness) {
        const ax = L.x - leaderFx * fc.leaderOffset;
        const az = L.z - leaderFz * fc.leaderOffset;
        // Round fences and walls rather than into them (out through the gate, round the house).
        const route = this.routesOf(s).lead;
        const way = route.steer(s.x, s.z, ax, az, dt);
        const tx = way.x - s.x;
        const tz = way.z - s.z;
        const d = Math.hypot(tx, tz);
        if (d > 0.5 || route.detour) {
          const k = route.detour ? Math.min(1, Math.max(0.6, dLeader / 10)) : Math.min(1, d / 6) * Math.min(1, Math.max(0.3, dLeader / 10));
          leadX = (tx / d) * k;
          leadZ = (tz / d) * k;
        }
      }

      // ---- the shepherd's call: come to him, stop a few metres short
      let callX = 0;
      let callZ = 0;
      if (s.callTimer > 0 || bunching) {
        const route = this.routesOf(s).call;
        const way = route.steer(s.x, s.z, P.x, P.z, dt);
        const dx = way.x - s.x;
        const dz = way.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-3) {
          const stop = s.led ? config.satchel.ropeStop : fc.call.stopDistance;
          const k = route.detour ? 1 : Math.min(1, Math.max(0, (d - stop) / (s.led ? 2 : 6)));
          callX = (dx / d) * k;
          callZ = (dz / d) * k;
        }
      }

      // ---- grazing / idling cycle
      let wanX = 0;
      let wanZ = 0;
      let waterDistance = Infinity;
      if (water) {
        waterDistance = Math.hypot(water.x - s.x, water.z - s.z);
        const route = this.routesOf(s).water;
        // Far off, find the way there; at the trough, close the last metre directly.
        const way = waterDistance > water.radius + 2 ? route.steer(s.x, s.z, water.x, water.z, dt) : water;
        const dx = way.x - s.x;
        const dz = way.z - s.z;
        const wd = Math.hypot(dx, dz);
        const approach = way === water ? Math.max(-0.6, Math.min(1, (waterDistance - water.radius - 0.55) / 1.4)) : 1;
        if (wd > 1e-3) {
          wanX = approach * dx / wd;
          wanZ = approach * dz / wd;
        }
      }
      if (s.mode === Mode.Graze || s.mode === Mode.Penned) {
        s.actTimer -= dt;
        if (s.actTimer <= 0) {
          const r = this.rand();
          if (s.eating) {
            s.eating = false;
            s.actTimer = fc.graze.walkMin + r * (fc.graze.walkMax - fc.graze.walkMin);
            this.pickWanderDir(s, s.mode === Mode.Graze);
          } else {
            s.eating = true;
            const linger = this.grass.at(s.x, s.z) > 0.5 ? m.linger : 1;
            s.actTimer = (fc.graze.eatMin + r * (fc.graze.eatMax - fc.graze.eatMin)) * linger;
          }
        }
        if (!s.eating) {
          wanX = s.wanderX * 0.7;
          wanZ = s.wanderZ * 0.7;
        }
        // Salt lick: graze around it rather than drifting off.
        if (Salt && nearSalt && s.mode === Mode.Graze) {
          const dx = Salt.x - s.x;
          const dz = Salt.z - s.z;
          const d = Math.hypot(dx, dz);
          if (d > 6) {
            const k = Math.min(1, (d - 6) / 8) * 0.9;
            wanX += (dx / d) * k;
            wanZ += (dz / d) * k;
          }
        }
      } else {
        s.eating = false;
      }

      // ---- stay inside the pen, away from the gate
      let penX = 0;
      let penZ = 0;
      if (s.mode === Mode.Penned) {
        const dx = layout.pen.x - 2 - s.x;
        const dz = layout.pen.z - s.z;
        [penX, penZ] = clampLen(dx / 6, dz / 6, 1);
      }

      // On the rope she goes where the shepherd goes, not where the flock is.
      if (s.led) {
        aliX = aliZ = cohX = cohZ = leadX = leadZ = 0;
        callX *= 1.5;
        callZ *= 1.5;
      }

      // ---- combine
      let wAli = W.ali;
      let wCoh = W.coh * m.coh;
      if (s.stress > fc.stress.scatterAt) {
        wAli *= 0.3;
        wCoh *= 0.3;
        const c = Math.cos(s.scatterAngle);
        const sn = Math.sin(s.scatterAngle);
        [ffx, ffz] = [ffx * c - ffz * sn, ffx * sn + ffz * c];
      }
      const parts: [number, number, number][] = [
        [sepX, sepZ, W.sep],
        [aliX, aliZ, wAli],
        [cohX, cohZ, wCoh],
        [leadX, leadZ, W.lead * m.lead],
        [ffx, ffz, W.flee * m.flee],
        [callX, callZ, W.call],
        [wanX, wanZ, W.wander],
        [penX, penZ, W.pen],
      ];
      let sumX = 0;
      let sumZ = 0;
      parts.forEach(([x, z, w], k) => {
        sumX += x * w;
        sumZ += z * w;
        s.forces[k * 2] = x * w;
        s.forces[k * 2 + 1] = z * w;
      });

      // ---- avoidance feelers: obstacles, steep ground, map edge
      const sp = Math.hypot(s.vx, s.vz);
      const sumL = Math.hypot(sumX, sumZ);
      if (sumL > 0.05 || sp > 0.1) {
        const dirX = sp > 0.1 ? s.vx / sp : sumX / sumL;
        const dirZ = sp > 0.1 ? s.vz / sp : sumZ / sumL;
        const look = 0.8 + sp * 0.9;
        if (this.bad(s.x + dirX * look, s.z + dirZ * look)) {
          const a = 40 * DEG;
          const lx = dirX * Math.cos(a) - dirZ * Math.sin(a);
          const lz = dirX * Math.sin(a) + dirZ * Math.cos(a);
          const rx = dirX * Math.cos(-a) - dirZ * Math.sin(-a);
          const rz = dirX * Math.sin(-a) + dirZ * Math.cos(-a);
          const leftBad = this.bad(s.x + lx * look, s.z + lz * look);
          const rightBad = this.bad(s.x + rx * look, s.z + rz * look);
          let avX = -dirX;
          let avZ = -dirZ;
          if (!leftBad || !rightBad) {
            // Prefer the free side; if both are free, the side closer to where we want to go.
            const useLeft = !leftBad && (rightBad || lx * sumX + lz * sumZ >= rx * sumX + rz * sumZ);
            avX = (useLeft ? lx : rx) - dirX * 0.6;
            avZ = (useLeft ? lz : rz) - dirZ * 0.6;
          }
          [avX, avZ] = clampLen(avX, avZ, 1);
          sumX += avX * fc.avoidWeight;
          sumZ += avZ * fc.avoidWeight;
          s.forces[16] = avX * fc.avoidWeight;
          s.forces[17] = avZ * fc.avoidWeight;
        }
      }
      const edge = layout.bounds.edge;
      if (Math.abs(s.x) > edge) sumX -= Math.sign(s.x) * ((Math.abs(s.x) - edge) / 10) * fc.boundsWeight;
      if (Math.abs(s.z) > edge) sumZ -= Math.sign(s.z) * ((Math.abs(s.z) - edge) / 10) * fc.boundsWeight;

      // ---- desired velocity -> acceleration-limited steering
      let maxSpeed =
        s.mode === Mode.Flee
          ? s.stress > fc.stress.panicAt
            ? fc.speeds.panic
            : fc.speeds.flee
          : s.mode === Mode.Follow
            ? fc.speeds.follow
            : s.mode === Mode.Penned
              ? fc.speeds.penned
              : fc.speeds.graze;
      if ((s.mode === Mode.Graze || s.mode === Mode.Penned) && s.eating) maxSpeed *= 0.3;
      if (water) maxSpeed = waterDistance < water.radius + 0.85 ? 0.23 : fc.speeds.follow * 0.8;
      maxSpeed *= 0.7 + 0.3 * s.health / 100;
      // A familiar worn path: they know the way.
      if (s.mode === Mode.Follow) maxSpeed *= 1 + tr.speedBonus * onTrail;
      // Worn down: limping.
      if (s.condition < config.condition.limpBelow) maxSpeed *= config.condition.limpSpeed;
      if (s.hushed && s.mode !== Mode.Flee) {
        // Hushed: stand still, heads down.
        maxSpeed *= 0.1;
        s.eating = true;
      }
      const mag = Math.hypot(sumX, sumZ);
      let dvx = 0;
      let dvz = 0;
      if (mag > 1e-4) {
        const spd = maxSpeed * Math.min(1, mag);
        dvx = (sumX / mag) * spd;
        dvz = (sumZ / mag) * spd;
      }
      s.desiredSpeed = Math.hypot(dvx, dvz);
      const [ax, az] = clampLen(dvx - s.vx, dvz - s.vz, fc.maxAccel * dt);
      s.vx += ax;
      s.vz += az;
    }

    // ---- integrate with terrain, obstacle and body constraints
    const solids = [{ x: P.x, z: P.z, r: config.player.capsuleRadius }];
    if (D) solids.push({ x: D.x, z: D.z, r: config.dog.radius });
    for (const w of ctx.wolves ?? []) solids.push({ x: w.x, z: w.z, r: config.wolf.radius });
    if (B) for (const off of [-0.62, 0.05, 0.72]) solids.push({ x: B.x + Math.sin(B.heading) * off, z: B.z + Math.cos(B.heading) * off, r: 0.4 });
    for (const s of this.sheep) {
      if (s.stuck !== 'none') continue;
      const m = PERSONALITY_MODS[s.personality];
      let nx = s.x + s.vx * dt;
      let nz = s.z + s.vz * dt;
      const h0 = this.terrain.heightAt(s.x, s.z);
      const tooSteep = (x: number, z: number) => {
        const st = Math.hypot(x - s.x, z - s.z);
        return st > 1e-5 && (this.terrain.heightAt(x, z) - h0) / st > tanClimb;
      };
      s.slopeBlocked = false;
      if (tooSteep(nx, nz)) {
        s.slopeBlocked = true;
        if (!tooSteep(nx, s.z)) nz = s.z;
        else if (!tooSteep(s.x, nz)) nx = s.x;
        else {
          nx = s.x;
          nz = s.z;
        }
      }
      const pushed = this.obstacles.pushOut(nx, nz, fc.radius);
      nx = pushed.x;
      nz = pushed.z;
      if (pushed.hit === 'thorn') {
        const p = (s.mode === Mode.Flee ? fc.stuck.thornCatchFleeing : fc.stuck.thornCatchCalm * m.catchMul) * dt;
        if (this.rand() < p) {
          s.stuck = 'thorn';
          s.condition = Math.max(0, s.condition - config.condition.thornCatch);
          this.stuckEvents++;
        }
      }
      // The shepherd, the dog and wolves are solid to sheep.
      for (const b of solids) {
        const pdx = nx - b.x;
        const pdz = nz - b.z;
        const pd = Math.hypot(pdx, pdz);
        const minP = b.r + fc.radius;
        if (pd < minP && pd > 1e-4) {
          nx = b.x + (pdx / pd) * minP;
          nz = b.z + (pdz / pd) * minP;
        }
      }
      nx = Math.max(-(this.terrain.half - 5), Math.min(this.terrain.half - 5, nx));
      nz = Math.max(-(this.terrain.half - 5), Math.min(this.terrain.half - 5, nz));
      // Push-outs move the body but must not turn into speed (a sheep set down right
      // next to the shepherd would otherwise shoot off).
      [s.vx, s.vz] = clampLen((nx - s.x) / dt, (nz - s.z) / dt, fc.speeds.panic * 1.2);
      s.x = nx;
      s.z = nz;
      if (s.stuck !== 'none') s.vx = s.vz = 0;
    }

    // ---- body overlap relaxation (one pass)
    const minD = fc.radius * 2 * 0.95;
    for (const s of this.sheep) {
      this.grid.query(s.x, s.z, 1.5, this.nb);
      for (const j of this.nb) {
        if (j <= s.id) continue;
        const o = this.sheep[j];
        const dx = o.x - s.x;
        const dz = o.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d >= minD) continue;
        const nx = d > 1e-5 ? dx / d : 1;
        const nz = d > 1e-5 ? dz / d : 0;
        const push = (minD - d) / 2;
        const sFixed = s.stuck !== 'none';
        const oFixed = o.stuck !== 'none';
        if (!sFixed) {
          s.x -= nx * push * (oFixed ? 2 : 1);
          s.z -= nz * push * (oFixed ? 2 : 1);
        }
        if (!oFixed) {
          o.x += nx * push * (sFixed ? 2 : 1);
          o.z += nz * push * (sFixed ? 2 : 1);
        }
      }
    }

    // ---- post: height, heading, grazing, needs, stuck/stray detection, pen
    for (const s of this.sheep) {
      if (s.stuck === 'none') {
        const p = this.obstacles.pushOut(s.x, s.z, fc.radius);
        s.x = p.x;
        s.z = p.z;
      }
      s.y = this.terrain.heightAt(s.x, s.z);
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 0.08) s.heading = wrap(s.heading + wrap(Math.atan2(s.vx, s.vz) - s.heading) * Math.min(1, fc.turnRate * dt));
      s.gaitPhase += sp * dt * 6;
      s.inPen = insidePen(s.x, s.z, -0.3);

      s.thirst = Math.min(100, s.thirst + thirstGain);
      const point = ctx.water?.points[s.waterTarget];
      if (ctx.water && point && s.mode === Mode.SeekWater && s.stuck === 'none' && sp < 0.4 &&
          point.inPen === s.inPen && Math.hypot(s.x - point.x, s.z - point.z) <= point.radius + 0.9) {
        const request = Math.max(0, Math.min(thirst.drinkPerSecond * dt, s.thirst - thirst.satisfied));
        const amount = ctx.water.drink(point, request * thirst.litersPerPoint);
        if (amount > 0) {
          s.thirst -= amount / thirst.litersPerPoint;
          s.drinking = true;
          s.lastDrinkAt = ctx.tick;
          s.lastDrinkFrom = point.id;
          const face = Math.atan2(point.x - s.x, point.z - s.z);
          s.heading = wrap(s.heading + wrap(face - s.heading) * Math.min(1, fc.turnRate * dt));
        }
      }
      if (s.thirst > thirst.damageAt) s.health = Math.max(0, s.health - thirst.damagePerHour * ctx.hours);
      else if (s.thirst < thirst.drinkAt) s.health = Math.min(100, s.health + thirst.recoveryPerHour * ctx.hours);

      // Eating and hunger.
      s.hunger = Math.min(100, s.hunger + fc.hunger.perHour * ctx.hours);
      if (s.mode === Mode.Graze && s.eating && s.hunger > 10) {
        // Thin grass gives smaller bites; what is eaten is what feeds.
        const bite = Math.min(1, this.grass.meanAround(s.x, s.z) / fc.graze.fullBiteAt);
        const eaten = this.grass.eatAround(s.x, s.z, fc.graze.consumePerHour * bite * ctx.hours);
        s.hunger = Math.max(0, s.hunger - eaten * fc.hunger.feedPerGrass);
      }

      // Walking the same way again and again wears a path.
      if (sp > tr.minSpeed && s.stuck === 'none') this.grass.tread(s.x, s.z, tr.wearPerSheepSecond * dt);

      // Condition: worn down by fear and heat, restored by calm grazing and the fold.
      const cc = config.condition;
      if (s.stress > cc.stressAbove) s.condition -= cc.stressLossPerHour * ((s.stress - cc.stressAbove) / (100 - cc.stressAbove)) * ctx.hours;
      if (ctx.hot && s.thirst > cc.heatThirst) s.condition -= cc.heatLossPerHour * ctx.hours;
      if (s.stress < 20 && (s.inPen || (s.eating && this.grass.meanAround(s.x, s.z) > 0.4) || s.led)) s.condition += cc.recoverPerHour * ctx.hours;
      s.condition = Math.max(0, Math.min(100, s.condition));

      // Stuck on a slope: wanted to move for 5 s, went nowhere, standing on steep ground.
      if (s.stuck === 'none') {
        s.histTimer += dt;
        const every = fc.stuck.windowSeconds / HIST_LEN;
        if (s.histTimer >= every) {
          s.histTimer -= every;
          const k = s.histCount % HIST_LEN;
          s.hist[k * 2] = s.x;
          s.hist[k * 2 + 1] = s.z;
          s.histWant[k] = s.desiredSpeed > 0.3 ? 1 : 0;
          s.histCount++;
          if (s.histCount >= HIST_LEN) {
            const oldest = s.histCount % HIST_LEN;
            const moved = Math.hypot(s.x - s.hist[oldest * 2], s.z - s.hist[oldest * 2 + 1]);
            let wanted = true;
            for (let i = 0; i < HIST_LEN; i++) if (!s.histWant[i]) wanted = false;
            if (wanted && moved < fc.stuck.minDisplacement && (s.slopeBlocked || this.slopeAt(s.x, s.z) > fc.stuck.slopeDeg)) {
              s.stuck = 'slope';
              s.condition = Math.max(0, s.condition - config.condition.slopeStuck);
              s.vx = s.vz = 0;
              this.stuckEvents++;
            }
          }
        }
      }

      // Stray check, once a second per sheep, staggered.
      if ((ctx.tick + s.id * 7) % 60 === 0) {
        const d = Math.hypot(s.x - this.centroid.x, s.z - this.centroid.z);
        if (!s.isStray) {
          s.strayTimer = d > fc.stray.distance ? s.strayTimer + 1 : 0;
          if (s.strayTimer >= fc.stray.seconds) {
            s.isStray = true;
            this.strayEvents++;
          }
        } else if (d < fc.stray.rejoin) {
          s.isStray = false;
          s.strayTimer = 0;
        }
      }
    }

    this.updateCounts();
    // Smoothed: browsers coarsen performance.now() to ~0.1 ms.
    if (t0) this.lastStepMs += (performance.now() - t0 - this.lastStepMs) * 0.05;
  }

  /** Exact state digest for determinism checks. */
  /**
   * Take sheep out of the flock (lost to wolves). Ids are re-numbered to stay equal to
   * array indices; if the bellwether is lost, the steadiest remaining ewe takes over.
   */
  remove(lost: Sheep[]): void {
    if (!lost.length) return;
    const gone = new Set(lost);
    const keep = this.sheep.filter((s) => !gone.has(s));
    this.sheep.length = 0;
    keep.forEach((s, i) => {
      s.id = i;
      this.sheep.push(s);
    });
    if (gone.has(this.leader) && this.sheep.length) {
      const next = this.sheep.find((s) => s.personality === Personality.Steady) ?? this.sheep[0];
      next.personality = Personality.Bellwether;
      next.isLeader = true;
      this.leader = next;
    }
    this.updateCounts();
  }

  stateKey(): number[] {
    const out: number[] = [];
    for (const s of this.sheep) out.push(s.x, s.z, s.stress, s.hunger, s.thirst, s.health, s.condition, s.mode, s.waterTarget, s.lastDrinkAt, s.lastDrinkFrom);
    return out;
  }
}


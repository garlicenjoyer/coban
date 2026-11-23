// The Kangal (GDD Part III, Kangal AI): a layered state machine.
//   1 Override    stamina empty          Exhausted -> Recover (lies down where he is)
//   2 Threat      predator perceived     Alert -> Interpose -> Charge -> Return
//   3 Command     whistle / gesture      Acknowledge -> bond delay -> Execute -> praise window
//   4 Autonomous  default                Drink / Eat when he needs to, else Patrol <-> Rest
// The highest layer that wants control runs; lower layers keep their state (paused) and
// carry on when it lets go. Layers only choose a target and a gait; locomotion is shared.

import { config } from '../core/config';
import type { BarkKind, EventBus } from '../core/events';
import type { Flock } from '../flock/flock';
import type { Wolf, Wolves } from '../predators/wolf';
import { NavAgent, navFor } from '../world/nav';
import type { Obstacles } from '../world/obstacles';
import type { Terrain } from '../world/terrain';
import { DogCare, type Bowl } from './care';
import type { DogCommand } from './commands';

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export type Gait = 'stop' | 'walk' | 'trot' | 'run';
export type LayerName = 'override' | 'threat' | 'command' | 'autonomous';

export interface DogContext {
  dt: number;
  tick: number;
  flock: Flock;
  wolves: Wolves;
  player: { x: number; z: number; yaw: number };
  rand: () => number;
  /** Water he can drink from (troughs, springs, the cistern, a basin). */
  water?: readonly { x: number; z: number; radius: number; liters: number | null }[];
}

interface Layer {
  name: LayerName;
  wants(d: Kangal, c: DogContext): boolean;
  update(d: Kangal, c: DogContext): void;
}

export class Kangal {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx = 0;
  vz = 0;
  /** Forward = (sin heading, cos heading), like the sheep. */
  heading = 0;
  prevHeading = 0;
  gaitPhase = 0;

  bond = config.dog.startBond;
  stamina = config.dog.stamina.max;
  exhausted = false;
  /** 0..100: bitten driving off a wolf. Limps until salved or healed over nights. */
  wound = 0;
  /** Food, water, ticks (GDD feature 5). The sim replaces it with one that knows the bowl. */
  care: DogCare;
  /** Seconds left of standing still for the shepherd (ticks being picked off). */
  heldStill = 0;
  /** Seconds left of a scratch (ticks itch): the view plays it. */
  scratching = 0;
  /** What he wears round his neck (upgrades bought in the village), for the view. */
  collar: '' | 'tick' | 'spiked' = '';

  // Locomotion request (set by the active layer each tick).
  tx: number;
  tz: number;
  gait: Gait = 'stop';
  lying = false;
  /** Face this point when standing still (ack, alert). */
  lookX: number | null = null;
  lookZ: number | null = null;
  /** Direction he is driving sheep in (unit), or 0,0 to press along his own velocity. */
  pushX = 0;
  pushZ = 0;

  active: LayerName = 'autonomous';
  /** Human-readable state of the active layer (debug). */
  state = 'patrol';
  time = 0;

  // Perception.
  perceived: Wolf | null = null;
  private perceiveTimer = 0;

  // Barks.
  lastBarkTime = -100;
  lastBarkKind: BarkKind = 'alert';

  // Command layer.
  command: DogCommand | null = null;
  pending: { command: DogCommand; at: number; aimYaw: number } | null = null;
  cmdState = '';
  cmdTimer = 0;
  cmdAimYaw = 0;
  holdX = 0;
  holdZ = 0;
  pushTarget = -1;
  searchTarget = -1;
  searchFoundAt = -1;
  attackTarget: Wolf | null = null;
  ackTimer = 0;
  praiseTimer = 0;
  petCooldown = 0;
  /** Last command result, for the debug panel and tests. */
  lastResult = '';

  // Autonomous layer.
  autoState: 'patrol' | 'rest' | 'drink' | 'eat' = 'patrol';
  autoTimer = 0;
  patrolDir = 1;

  // Threat layer.
  threatState: 'alert' | 'interpose' | 'charge' | 'return' | 'none' = 'none';
  threatTimer = 0;

  constructor(
    x: number,
    z: number,
    private terrain: Terrain,
    private obstacles: Obstacles,
    readonly events: EventBus,
  ) {
    this.x = this.px = this.tx = x;
    this.z = this.pz = this.tz = z;
    this.y = this.py = terrain.heightAt(x, z);
    this.care = new DogCare({ x, z });
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** Resting dogs calm sheep; moving ones press them. */
  get resting(): boolean {
    return this.lying || this.speed < 0.2;
  }

  get charging(): boolean {
    return this.active === 'threat' && this.threatState === 'charge';
  }

  get barkingRecently(): boolean {
    return this.time - this.lastBarkTime < 1;
  }

  bark(kind: BarkKind, tick: number, minGap = 1.2): void {
    if (this.time - this.lastBarkTime < minGap) return;
    this.lastBarkTime = this.time;
    this.lastBarkKind = kind;
    this.events.emit('bark', { kind, x: this.x, z: this.z, dirX: Math.sin(this.heading), dirZ: Math.cos(this.heading), tick });
  }

  // ------------------------------------------------------------- commands

  /** A whistle or gesture reached the dog. Bond turns into latency and reliability. */
  receive(command: DogCommand, aimYaw: number, c: { tick: number; rand: () => number; player: { x: number; z: number } }): void {
    const dc = config.dog;
    const b = Math.max(0, Math.min(100, this.bond)) / 100;
    const delay = lerp(dc.delay.atZero, dc.delay.atFull, b);
    const willObey = c.rand() >= lerp(dc.ignore.atZero, dc.ignore.atFull, b);
    // Instant feedback, always: ear flick and a look back at the shepherd.
    this.ackTimer = dc.ackSeconds;
    this.events.emit('dogAck', { command, willObey, delay, tick: c.tick });
    if (willObey) this.pending = { command, at: this.time + delay, aimYaw };
  }

  /** Petting (E next to the dog). Praise inside the window after a finished command counts more. */
  pet(tick: number): void {
    this.care.pettedToday = true;
    const praise = this.praiseTimer > 0;
    if (!praise && this.petCooldown > 0) return;
    this.bond = Math.min(100, this.bond + (praise ? 3 : 1));
    this.praiseTimer = 0;
    this.petCooldown = 10;
    this.events.emit('dogPetted', { praise, bond: this.bond, tick });
    this.bark('happy', tick, 0);
  }

  /** A command ended (used by the layers): opens the praise window. */
  finish(result: string, success = false): void {
    if (this.command) this.events.emit('dogTaskDone', { command: this.command, success, result, tick: 0 });
    this.lastResult = result;
    this.command = null;
    this.cmdState = '';
    this.praiseTimer = config.dog.praiseWindow;
  }

  // ------------------------------------------------------------- perception

  private perceive(c: DogContext): void {
    const pc = config.dog.perception;
    const hearing = this.bond >= 75 ? pc.hearingHighBond : pc.hearing;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const cosSight = Math.cos(pc.sightHalfAngleDeg * DEG);
    let best: Wolf | null = null;
    let bestD = Infinity;
    for (const w of c.wolves.list) {
      if (w.state === 'flee') continue;
      const dx = w.x - this.x;
      const dz = w.z - this.z;
      const d = Math.hypot(dx, dz);
      const seen = d < pc.sight && (dx * fx + dz * fz) / Math.max(d, 1e-3) > cosSight;
      if ((d < hearing || seen) && d < bestD) {
        best = w;
        bestD = d;
      }
    }
    this.perceived = best;
  }

  // ------------------------------------------------------------- step

  step(c: DogContext): void {
    const dc = config.dog;
    const dt = c.dt;
    this.time += dt;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.prevHeading = this.heading;
    this.ackTimer = Math.max(0, this.ackTimer - dt);
    this.praiseTimer = Math.max(0, this.praiseTimer - dt);
    this.petCooldown = Math.max(0, this.petCooldown - dt);
    this.heldStill = Math.max(0, this.heldStill - dt);
    this.scratching = Math.max(0, this.scratching - dt);

    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      this.perceiveTimer += dc.perception.everySeconds;
      this.perceive(c);
    }
    if (this.perceived && this.perceived.state === 'flee') this.perceived = null;

    // Stamina: empty -> exhausted until recovered.
    if (this.stamina <= 0) this.exhausted = true;
    if (this.exhausted && this.stamina >= dc.stamina.recoverTo) this.exhausted = false;

    this.lookX = this.lookZ = null;
    this.pushX = this.pushZ = 0;
    this.lying = false;
    const layer = LAYERS.find((l) => l.wants(this, c))!;
    if (layer.name !== this.active) this.active = layer.name;
    layer.update(this, c);

    // A fresh acknowledgement overrides where he looks (and he stops for it).
    if (this.ackTimer > 0) {
      this.lookX = c.player.x;
      this.lookZ = c.player.z;
    }

    this.move(c);

    const sp = this.speed;
    const s = dc.stamina;
    if (sp > dc.speeds.trot + 0.3) this.stamina -= s.runDrainPerSec * dt;
    else if (sp > dc.speeds.walk + 0.3) this.stamina -= s.trotDrainPerSec * dt;
    // A hungry dog gets his wind back at half the rate; ticks lower the ceiling.
    else this.stamina += s.regenPerSec * dt * (this.lying ? 1.5 : 1) * this.care.regenScale;
    this.stamina = Math.max(0, Math.min(this.care.staminaMax, this.stamina));
    // Ticks itch: now and then, lying or standing, he stops to scratch.
    if (this.care.ticks > 0 && this.scratching === 0 && sp < 0.3 && c.rand() < this.care.ticks * 0.004) this.scratching = 1.2;
  }

  /** Running at a trot or faster (hunger doubles). */
  get running(): boolean {
    return this.speed > config.dog.speeds.trot + 0.3;
  }

  private route: NavAgent | null = null;

  private move(c: DogContext): void {
    const dc = config.dog;
    const dt = c.dt;
    let gait = this.gait;
    if (this.exhausted && gait !== 'stop') gait = 'walk';
    // A thirsty dog won't run.
    if (gait === 'run' && !this.care.canRun) gait = 'trot';
    const max = (gait === 'stop' ? 0 : dc.speeds[gait]) * (this.wound > 0 ? config.dogInjury.limp : 1);
    const goal = Math.hypot(this.tx - this.x, this.tz - this.z);
    let wantX = 0;
    let wantZ = 0;
    if (goal > 0.3 && max > 0) {
      // Head for the next waypoint round whatever is in the way; slow down only at the goal.
      this.route ??= new NavAgent(navFor(this.terrain, this.obstacles), { maxSlope: dc.maxClimbDeg, softSlope: dc.maxClimbDeg - 8 }, 0.5);
      const way = this.route.steer(this.x, this.z, this.tx, this.tz, dt);
      const dx = way.x - this.x;
      const dz = way.z - this.z;
      const d = Math.max(1e-3, Math.hypot(dx, dz));
      const spd = max * Math.min(1, goal / 2.5); // arrive
      wantX = (dx / d) * spd;
      wantZ = (dz / d) * spd;
    }
    const ax = wantX - this.vx;
    const az = wantZ - this.vz;
    const al = Math.hypot(ax, az);
    const amax = dc.maxAccel * dt;
    const k = al > amax ? amax / al : 1;
    this.vx += ax * k;
    this.vz += az * k;

    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    // Too steep to climb?
    const h0 = this.terrain.heightAt(this.x, this.z);
    const tan = Math.tan(dc.maxClimbDeg * DEG);
    const steep = (x: number, z: number) => {
      const st = Math.hypot(x - this.x, z - this.z);
      return st > 1e-5 && (this.terrain.heightAt(x, z) - h0) / st > tan;
    };
    if (steep(nx, nz)) {
      if (!steep(nx, this.z)) nz = this.z;
      else if (!steep(this.x, nz)) nx = this.x;
      else {
        nx = this.x;
        nz = this.z;
      }
    }
    const p = this.obstacles.pushOut(nx, nz, dc.radius);
    nx = Math.max(-(this.terrain.half - 5), Math.min(this.terrain.half - 5, p.x));
    nz = Math.max(-(this.terrain.half - 5), Math.min(this.terrain.half - 5, p.z));
    this.vx = (nx - this.x) / dt;
    this.vz = (nz - this.z) / dt;
    this.x = nx;
    this.z = nz;
    this.y = this.terrain.heightAt(nx, nz);

    const sp = this.speed;
    let face: number | null = null;
    if (sp > 0.15) face = Math.atan2(this.vx, this.vz);
    else if (this.lookX !== null && this.lookZ !== null) face = Math.atan2(this.lookX - this.x, this.lookZ - this.z);
    if (face !== null) this.heading = wrap(this.heading + wrap(face - this.heading) * Math.min(1, dc.turnRate * dt));
    this.gaitPhase += sp * dt * 4;
  }

  /** Point on a ring around (cx, cz) at radius r, `step` radians from the dog's current bearing toward `want`. */
  orbitToward(cx: number, cz: number, r: number, want: number, maxStep = 0.5): { x: number; z: number; remaining: number } {
    const ang = Math.atan2(this.z - cz, this.x - cx);
    const da = wrap(want - ang);
    const step = Math.sign(da) * Math.min(Math.abs(da), maxStep);
    return { x: cx + Math.cos(ang + step) * r, z: cz + Math.sin(ang + step) * r, remaining: Math.abs(da) };
  }

  stateKey(): number[] {
    return [this.x, this.z, this.stamina, this.bond, this.wound, LAYERS.findIndex((l) => l.name === this.active)];
  }
}

// =============================================================== layers

const Override: Layer = {
  name: 'override',
  wants: (d) => d.exhausted || d.heldStill > 0,
  update(d, c) {
    if (d.heldStill > 0 && !d.exhausted) {
      // Lying still while the shepherd goes through his coat for ticks.
      d.gait = 'stop';
      d.lying = d.speed < 0.5;
      d.lookX = c.player.x;
      d.lookZ = c.player.z;
      d.state = 'being looked over';
      return;
    }
    // Exhausted: slow to a stop and lie down where he is until stamina is back to 40;
    // whatever he was doing resumes afterwards. He can still bark.
    d.gait = 'stop';
    d.lying = d.speed < 0.5;
    d.state = d.lying ? 'recover' : 'exhausted';
    if (d.perceived) {
      d.lookX = d.perceived.x;
      d.lookZ = d.perceived.z;
      d.bark('warning', c.tick, 2.5);
    }
  },
};

const Threat: Layer = {
  name: 'threat',
  wants: (d) => d.perceived !== null || d.threatState === 'return',
  update(d, c) {
    const dc = config.dog;
    const fc = c.flock.centroid;
    const R = c.flock.radius80;
    const w = d.perceived;
    if (w && (d.threatState === 'none' || d.threatState === 'return')) {
      d.threatState = 'alert';
      d.threatTimer = 0;
    }
    d.threatTimer += c.dt;
    const distFlock = Math.hypot(d.x - fc.x, d.z - fc.z);

    switch (d.threatState) {
      case 'alert': {
        d.state = 'alert';
        d.gait = 'stop';
        if (w) {
          d.lookX = w.x;
          d.lookZ = w.z;
        }
        d.bark('alert', c.tick, 0.8);
        if (d.threatTimer > 1) {
          d.threatState = 'interpose';
          d.threatTimer = 0;
        }
        break;
      }
      case 'interpose': {
        d.state = 'interpose';
        if (!w) {
          d.threatState = 'return';
          break;
        }
        // Stand between the flock and the wolf, just outside the flock.
        const ax = w.x - fc.x;
        const az = w.z - fc.z;
        const ad = Math.max(1e-3, Math.hypot(ax, az));
        d.tx = fc.x + (ax / ad) * (R + 6);
        d.tz = fc.z + (az / ad) * (R + 6);
        d.gait = 'run';
        d.lookX = w.x;
        d.lookZ = w.z;
        d.bark('warning', c.tick, 2);
        const wolfToDog = Math.hypot(w.x - d.x, w.z - d.z);
        if (wolfToDog < 15 || ad < R + 15 || w.state === 'hunt') {
          d.threatState = 'charge';
          d.threatTimer = 0;
        }
        break;
      }
      case 'charge': {
        d.state = 'charge';
        if (!w || distFlock > dc.leash) {
          d.threatState = 'return';
          d.threatTimer = 0;
          break;
        }
        d.tx = w.x + w.vx * 0.5;
        d.tz = w.z + w.vz * 0.5;
        d.gait = 'run';
        d.bark('attack', c.tick, 1.5);
        break;
      }
      case 'return': {
        d.state = 'return';
        const ang = Math.atan2(d.z - fc.z, d.x - fc.x);
        d.tx = fc.x + Math.cos(ang) * (R + 5);
        d.tz = fc.z + Math.sin(ang) * (R + 5);
        d.gait = 'trot';
        if (distFlock < R + 8 || d.threatTimer > 15) d.threatState = 'none';
        break;
      }
      default:
        d.threatState = 'none';
    }
  },
};

const Command: Layer = {
  name: 'command',
  wants: (d) => d.command !== null || d.pending !== null,
  update(d, c) {
    const dc = config.dog;
    // Bond delay: stand and look at the shepherd, then go.
    if (d.pending) {
      if (d.time < d.pending.at) {
        d.state = 'listening';
        d.gait = 'stop';
        d.lookX = c.player.x;
        d.lookZ = c.player.z;
        return;
      }
      d.command = d.pending.command;
      d.cmdAimYaw = d.pending.aimYaw;
      d.pending = null;
      d.cmdTimer = 0;
      d.cmdState = 'start';
      d.pushTarget = -1;
      d.searchTarget = -1;
      d.attackTarget = null;
    }
    d.cmdTimer += c.dt;
    switch (d.command) {
      case 'gather':
        return gather(d, c);
      case 'hold':
        return hold(d, c);
      case 'search':
        return search(d, c);
      case 'attack':
        return attack(d, c);
      case 'heel': {
        // Follow at the shepherd's left side.
        const fx = -Math.sin(c.player.yaw);
        const fz = -Math.cos(c.player.yaw);
        const lx = -Math.cos(c.player.yaw);
        const lz = Math.sin(c.player.yaw);
        d.tx = c.player.x + lx * dc.heel.offset - fx * 0.5;
        d.tz = c.player.z + lz * dc.heel.offset - fz * 0.5;
        const dist = Math.hypot(d.tx - d.x, d.tz - d.z);
        d.gait = dist > 10 ? 'run' : dist > 3 ? 'trot' : 'walk';
        d.state = 'heel';
        return;
      }
    }
  },
};

function gather(d: Kangal, c: DogContext): void {
  const g = config.dog.gather;
  const f = c.flock;
  const C = f.centroid;
  const P = c.player;
  const n = f.sheep.length;
  const near = f.sheep.filter((s) => Math.hypot(s.x - P.x, s.z - P.z) < g.doneRadius).length;
  if (near >= Math.ceil(n * g.doneShare)) return d.finish(`gather done in ${d.cmdTimer.toFixed(1)} s`, true);
  if (d.cmdTimer > g.timeout) return d.finish('gather timed out');

  // Outrun to the far side of the flock (opposite the shepherd), then fetch toward him,
  // sweeping side to side. The sheep run from the dog; the shepherd is where they end up.
  const nx0 = C.x - P.x;
  const nz0 = C.z - P.z;
  const nd = Math.max(1e-3, Math.hypot(nx0, nz0));
  const nx = nx0 / nd;
  const nz = nz0 / nd;
  // Ring wide enough to sweep in the outliers, not just the core.
  let far = 0;
  for (const s of f.sheep) far = Math.max(far, Math.hypot(s.x - C.x, s.z - C.z));
  const R = Math.min(45, Math.max(f.radius80, far * 0.85) + g.margin);
  const want = Math.atan2(nz, nx);
  if (d.cmdState === 'start' || d.cmdState === 'outrun') {
    const o = d.orbitToward(C.x, C.z, R, want, 0.45);
    d.tx = o.x;
    d.tz = o.z;
    d.gait = 'run';
    d.cmdState = 'outrun';
    d.state = 'gather: outrun';
    if (o.remaining < 35 * DEG) d.cmdState = 'fetch';
    return;
  }
  // Fetch: press on the back edge of the flock and sweep side to side, so it walks on
  // ahead of him toward the shepherd.
  const px = -nz;
  const pz = nx;
  // Aim just inside the back edge so he keeps walking into the flock and it keeps moving.
  const back = Math.max(1.5, f.radius80 - 1);
  const sweep = Math.sin(d.cmdTimer * 1.5) * Math.max(3, f.radius80) * g.sweep * 1.4;
  d.tx = C.x + nx * back + px * sweep;
  d.tz = C.z + nz * back + pz * sweep;
  d.pushX = -nx;
  d.pushZ = -nz;
  d.gait = 'trot';
  d.state = 'gather: fetch';
  // If he slipped round to the shepherd's side, go back out.
  const side = ((d.x - C.x) * nx + (d.z - C.z) * nz) / Math.max(1e-3, Math.hypot(d.x - C.x, d.z - C.z));
  if (side < Math.cos(70 * DEG)) d.cmdState = 'outrun';
  // Don't push the flock through the shepherd.
  if (Math.hypot(d.x - P.x, d.z - P.z) < 7) d.gait = 'stop';
}

/**
 * Head for (x, z) without cutting through the flock: until he is on that side of it, run an
 * arc round it beyond the sheep's flight zone. Returns true while he is going round.
 */
function goRound(d: Kangal, f: DogContext['flock'], x: number, z: number): boolean {
  d.tx = x;
  d.tz = z;
  const cx = f.centroid.x;
  const cz = f.centroid.z;
  const ring = f.radius80 + config.dog.sheepFlightZone.run + 1;
  if (Math.hypot(x - cx, z - cz) < 1 || Math.hypot(d.x - cx, d.z - cz) > ring + 12) return false;
  const aDog = Math.atan2(d.z - cz, d.x - cx);
  let da = Math.atan2(z - cz, x - cx) - aDog;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  if (Math.abs(da) <= 0.35) return false;
  const a = aDog + Math.sign(da) * Math.min(Math.abs(da), 0.6);
  d.tx = cx + Math.cos(a) * ring;
  d.tz = cz + Math.sin(a) * ring;
  return true;
}

function hold(d: Kangal, c: DogContext): void {
  const h = config.dog.hold;
  const f = c.flock;
  if (d.cmdState === 'start') {
    d.holdX = f.centroid.x;
    d.holdZ = f.centroid.z;
    d.cmdState = 'goto';
  }
  const cx = f.centroid.x;
  const cz = f.centroid.z;
  const ring = f.radius80 + config.dog.sheepFlightZone.run + 1;
  const nearFlock = Math.hypot(d.x - cx, d.z - cz) < ring;
  d.lying = false;

  // Wear: grazing has drawn the whole flock off the hold point. Walk into the drifting edge
  // from outside and turn it back, rather than fetching sheep one by one through the middle.
  const drift = Math.hypot(cx - d.holdX, cz - d.holdZ);
  if (d.cmdState !== 'wear' && drift > h.wearFrom) d.cmdState = 'wear';
  if (d.cmdState === 'wear') {
    if (drift < h.wearUntil) d.cmdState = 'guard';
    else {
      const ux = (cx - d.holdX) / drift;
      const uz = (cz - d.holdZ) / drift;
      const round = goRound(d, f, cx + ux * (f.radius80 - 1), cz + uz * (f.radius80 - 1));
      d.pushX = -ux;
      d.pushZ = -uz;
      d.gait = round ? 'run' : 'walk';
      d.state = round ? 'hold: going round' : 'hold: wear';
      return;
    }
  }

  if (d.cmdState === 'push' || d.cmdState === 'press') {
    const s = f.sheep[d.pushTarget];
    const sd = s ? Math.hypot(s.x - d.holdX, s.z - d.holdZ) : 0;
    if (!s || sd < h.radius - 4 || s.stuck !== 'none') {
      d.cmdState = 'guard';
    } else {
      // Get outside the wanderer, then walk her back in.
      const ox = (s.x - d.holdX) / sd;
      const oz = (s.z - d.holdZ) / sd;
      const outX = s.x + ox * h.pushOutside;
      const outZ = s.z + oz * h.pushOutside;
      if (d.cmdState === 'push' && Math.hypot(outX - d.x, outZ - d.z) < 2) d.cmdState = 'press';
      // She slipped past him: go round again.
      if (d.cmdState === 'press' && Math.hypot(s.x - d.x, s.z - d.z) > h.pushOutside + 5) d.cmdState = 'push';
      if (d.cmdState === 'press') {
        // Press her in at a walk, keeping behind her.
        d.tx = s.x - ox * 2;
        d.tz = s.z - oz * 2;
        d.pushX = -ox;
        d.pushZ = -oz;
        d.gait = 'walk';
        d.state = 'hold: press';
        return;
      }
      goRound(d, f, outX, outZ);
      d.gait = 'run';
      d.state = 'hold: push';
      return;
    }
  }

  // Guard: lie down near the hold point (a resting dog calms the flock) and watch the edge.
  // If he is already close, he lies where he is rather than walking into the flock.
  const fromPoint = Math.hypot(d.x - d.holdX, d.z - d.holdZ);
  const settle = d.cmdState === 'guard' ? h.radius - 4 : 2;
  if (fromPoint < settle) {
    d.tx = d.x;
    d.tz = d.z;
    d.gait = 'stop';
    d.lying = true;
    d.cmdState = 'guard';
    d.state = 'hold: guard';
  } else {
    goRound(d, f, d.holdX, d.holdZ);
    d.gait = nearFlock ? 'walk' : 'trot';
    d.cmdState = 'goto';
    d.state = 'hold: goto';
  }
  // Check the edge for a lone wanderer.
  let worst = -1;
  let worstD = h.radius - 2;
  f.sheep.forEach((s, i) => {
    if (s.stuck !== 'none') return;
    const sd = Math.hypot(s.x - d.holdX, s.z - d.holdZ);
    if (sd > worstD) {
      worstD = sd;
      worst = i;
    }
  });
  if (worst >= 0) {
    d.pushTarget = worst;
    d.cmdState = 'push';
  }
}

function search(d: Kangal, c: DogContext): void {
  const sc = config.dog.search;
  const f = c.flock;
  if (d.cmdTimer > sc.timeout) return d.finish('search timed out');
  if (d.cmdState === 'start') {
    // Strays and stuck sheep, nearest first, biased toward where the shepherd is looking.
    const ax = -Math.sin(d.cmdAimYaw);
    const az = -Math.cos(d.cmdAimYaw);
    let best = Infinity;
    let bi = -1;
    f.sheep.forEach((s, i) => {
      if (!s.isStray && s.stuck === 'none') return;
      const dx = s.x - c.player.x;
      const dz = s.z - c.player.z;
      const dist = Math.hypot(s.x - d.x, s.z - d.z);
      const cos = (dx * ax + dz * az) / Math.max(1e-3, Math.hypot(dx, dz));
      const score = dist - 25 * cos;
      if (score < best) {
        best = score;
        bi = i;
      }
    });
    if (bi < 0) {
      d.cmdState = 'spiral';
    } else {
      d.searchTarget = bi;
      d.cmdState = 'seek';
    }
  }
  if (d.cmdState === 'spiral') {
    // Nothing known: cast in a widening spiral around the shepherd, then give up.
    const t = d.cmdTimer;
    const r = 10 + t * 2;
    const a = t * 0.6;
    d.tx = c.player.x + Math.cos(a) * r;
    d.tz = c.player.z + Math.sin(a) * r;
    d.gait = 'trot';
    d.state = 'search: casting';
    if (t > 20) d.finish('search found nothing');
    return;
  }
  const s = f.sheep[d.searchTarget];
  if (!s) return d.finish('search lost the target');
  const dist = Math.hypot(s.x - d.x, s.z - d.z);
  if (d.cmdState === 'seek') {
    d.tx = s.x;
    d.tz = s.z;
    d.gait = 'run';
    d.state = 'search: seek';
    if (dist < sc.findDistance) {
      d.cmdState = 'found';
      d.searchFoundAt = d.time;
      d.cmdTimer = Math.min(d.cmdTimer, sc.timeout - 30); // leave time to bring it back
      d.bark('found', c.tick, 0);
    }
    return;
  }
  if (d.cmdState === 'found') {
    d.gait = 'stop';
    d.lookX = s.x;
    d.lookZ = s.z;
    if (s.stuck === 'slope') {
      // He can shove a sheep off a slope; thorns need the shepherd's hands.
      d.state = 'search: shoving free';
      if (d.time - d.searchFoundAt > sc.freeSlopeSeconds) f.shoveFree(s, f.centroid.x, f.centroid.z);
      return;
    }
    if (s.stuck === 'thorn') {
      d.state = 'search: guarding (thorns)';
      d.bark('found', c.tick, sc.barkEvery);
      return;
    }
    d.cmdState = 'fetch';
  }
  if (d.cmdState === 'fetch') {
    const C = f.centroid;
    const toFlock = Math.hypot(s.x - C.x, s.z - C.z);
    if (toFlock < sc.rejoinDistance || (!s.isStray && toFlock < 20)) return d.finish('search: stray brought back', true);
    // Get behind the stray (away from the flock) and walk it home.
    const ox = (s.x - C.x) / toFlock;
    const oz = (s.z - C.z) / toFlock;
    const bx = s.x + ox * 4;
    const bz = s.z + oz * 4;
    const behind = Math.hypot(bx - d.x, bz - d.z) < 2.5;
    d.tx = behind ? s.x - ox * 2 : bx;
    d.tz = behind ? s.z - oz * 2 : bz;
    if (behind) {
      d.pushX = -ox;
      d.pushZ = -oz;
    }
    d.gait = behind ? 'walk' : 'trot';
    d.state = 'search: bringing back';
  }
}

function attack(d: Kangal, c: DogContext): void {
  const dc = config.dog;
  const C = c.flock.centroid;
  if (d.cmdState === 'start') {
    // The wolf nearest the line the shepherd points along, else the nearest one he senses.
    const ax = -Math.sin(d.cmdAimYaw);
    const az = -Math.cos(d.cmdAimYaw);
    let best = -Infinity;
    for (const w of c.wolves.list) {
      if (w.state === 'flee') continue;
      const dx = w.x - c.player.x;
      const dz = w.z - c.player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 90) continue;
      const score = (dx * ax + dz * az) / Math.max(dist, 1e-3) - dist / 200;
      if (score > best) {
        best = score;
        d.attackTarget = w;
      }
    }
    d.attackTarget ??= d.perceived;
    d.cmdState = d.attackTarget ? 'charge' : 'bluff';
    d.holdX = d.x - Math.sin(d.cmdAimYaw) * 15;
    d.holdZ = d.z - Math.cos(d.cmdAimYaw) * 15;
  }
  if (d.cmdState === 'bluff') {
    // Nothing to attack: rush where he was sent, bark, and come back.
    d.tx = d.holdX;
    d.tz = d.holdZ;
    d.gait = 'run';
    d.state = 'attack: bluff';
    if (Math.hypot(d.holdX - d.x, d.holdZ - d.z) < 2) {
      d.bark('warning', c.tick, 0);
      d.finish('attack: nothing there');
    }
    return;
  }
  const w = d.attackTarget;
  if (!w || !c.wolves.list.includes(w)) return d.finish('attack: wolf gone');
  if (Math.hypot(d.x - C.x, d.z - C.z) > dc.leash) return d.finish('attack: leash');
  if (w.state === 'flee') {
    if (d.cmdState !== 'chaseOff') {
      d.cmdState = 'chaseOff';
      d.cmdTimer = 0;
    }
    if (d.cmdTimer > 3) return d.finish('attack: wolf driven off', true);
  }
  d.tx = w.x + w.vx * 0.5;
  d.tz = w.z + w.vz * 0.5;
  d.gait = 'run';
  d.state = 'attack: charge';
  d.bark('attack', c.tick, 1.5);
}

/** Left to himself and in need, he goes to water or to his bowl. True while he does. */
function seeNeeds(d: Kangal, c: DogContext): boolean {
  const cc = config.dogCare;
  const care = d.care;
  // Water: the nearest point with something in it, within reach.
  if (care.hydration < (d.autoState === 'drink' ? 99 : cc.seekWater) && c.water) {
    let best: { x: number; z: number; radius: number } | null = null;
    let bd = cc.waterReach;
    for (const w of c.water) {
      if (w.liters !== null && w.liters <= 0) continue;
      const dist = Math.hypot(w.x - d.x, w.z - d.z) - w.radius;
      if (dist < bd) {
        bd = dist;
        best = w;
      }
    }
    if (best) {
      const ax = d.x - best.x;
      const az = d.z - best.z;
      const ad = Math.max(1e-3, Math.hypot(ax, az));
      d.tx = best.x + (ax / ad) * (best.radius + 0.5);
      d.tz = best.z + (az / ad) * (best.radius + 0.5);
      const there = bd < 0.9;
      d.gait = there ? 'stop' : 'trot';
      if (there) {
        care.drink(c.dt);
        d.lookX = best.x;
        d.lookZ = best.z;
      }
      d.autoState = 'drink';
      d.state = there ? 'drinking' : 'going to drink';
      return true;
    }
  }
  // Food: the bowl by the porch, if there is something in it.
  const bowl: Bowl = care.bowl;
  if (care.satiety < cc.seekFood && bowl.meals > 0 && Math.hypot(bowl.x - d.x, bowl.z - d.z) < cc.bowlReach) {
    d.tx = bowl.x;
    d.tz = bowl.z + 0.6;
    const there = Math.hypot(d.tx - d.x, d.tz - d.z) < 0.8;
    d.gait = there ? 'stop' : 'trot';
    if (there) {
      care.eatFromBowl();
      d.events.emit('dogFed', { how: 'bowl', satiety: care.satiety });
    }
    d.autoState = 'eat';
    d.state = there ? 'eating' : 'going to his bowl';
    return true;
  }
  if (d.autoState === 'drink' || d.autoState === 'eat') {
    d.autoState = 'rest';
    d.autoTimer = 0;
  }
  return false;
}

const Autonomous: Layer = {
  name: 'autonomous',
  wants: () => true,
  update(d, c) {
    const dc = config.dog;
    const f = c.flock;
    const C = f.centroid;
    const R = f.radius80 + dc.patrol.margin;
    d.autoTimer += c.dt;
    if (seeNeeds(d, c)) return;
    const distFlock = Math.hypot(d.x - C.x, d.z - C.z);
    if (distFlock > dc.leash * 0.6) {
      // Too far from the flock: go back.
      d.tx = C.x;
      d.tz = C.z;
      d.gait = 'trot';
      d.state = 'returning to flock';
      return;
    }
    if (d.autoState === 'patrol') {
      // Walk the flock's perimeter.
      const ang = Math.atan2(d.z - C.z, d.x - C.x) + 0.35 * d.patrolDir;
      d.tx = C.x + Math.cos(ang) * R;
      d.tz = C.z + Math.sin(ang) * R;
      d.gait = 'walk';
      d.state = 'patrol';
      if (d.autoTimer > dc.patrol.seconds) {
        d.autoState = 'rest';
        d.autoTimer = 0;
      }
    } else {
      // Lie down on the flock's edge, between it and the shepherd, watching.
      const ax = c.player.x - C.x;
      const az = c.player.z - C.z;
      const ad = Math.max(1e-3, Math.hypot(ax, az));
      d.tx = C.x + (ax / ad) * (f.radius80 + 2);
      d.tz = C.z + (az / ad) * (f.radius80 + 2);
      const there = Math.hypot(d.tx - d.x, d.tz - d.z) < 1.5;
      d.gait = there ? 'stop' : 'walk';
      d.lying = there;
      d.state = 'rest';
      if (d.autoTimer > dc.rest.seconds) {
        d.autoState = 'patrol';
        d.autoTimer = 0;
        d.patrolDir = c.rand() < 0.5 ? -1 : 1;
      }
    }
  },
};

const LAYERS: Layer[] = [Override, Threat, Command, Autonomous];
export const LAYER_ORDER: LayerName[] = LAYERS.map((l) => l.name);

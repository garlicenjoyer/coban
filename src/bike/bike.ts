// The old motorcycle (GDD: The old motorcycle, Motorcycle physics).
//
// A two-wheel model integrated in our own fixed step (deterministic, no rigid-body
// tip-over instability): both wheels sample the same heightfield the physics world
// uses; loads come from slope, weight shift and acceleration; the engine drives the rear
// wheel through three automatic ranges; tyre grip comes from the surface table and is
// shared between driving/braking and cornering (friction circle). When cornering needs
// more grip than is left, the rear steps out (slip angle β) and counter-steer catches it.
// Lean is a PD controller toward the lean a real bike would need. Falls are explicit
// rules: a slide past 40°, a hard impact, or stopping on steep ground before your foot
// is down.

import { BikeCare } from './care';
import { config } from '../core/config';
import type { EventBus } from '../core/events';
import type { Obstacles } from '../world/obstacles';
import { Surface, type Terrain } from '../world/terrain';

const DEG = Math.PI / 180;
const G = 9.81;

export interface SurfaceGrip {
  long: number;
  lat: number;
  roll: number;
  /** Loose ground ploughs: rolling resistance grows with speed², ×(1 + loose·v²). */
  loose: number;
}

/** GDD surface table. Pasture rides like grass/maquis. */
export const SURFACE_GRIP: Record<Surface, SurfaceGrip> = {
  [Surface.Asphalt]: { long: 1.0, lat: 1.0, roll: 0.015, loose: 0 },
  [Surface.Dirt]: { long: 0.8, lat: 0.75, roll: 0.03, loose: 0.01 },
  [Surface.Gravel]: { long: 0.6, lat: 0.45, roll: 0.05, loose: 0.05 },
  [Surface.Grass]: { long: 0.65, lat: 0.55, roll: 0.06, loose: 0.02 },
  [Surface.Pasture]: { long: 0.65, lat: 0.55, roll: 0.06, loose: 0.02 },
  [Surface.Mud]: { long: 0.35, lat: 0.3, roll: 0.12, loose: 0.08 },
  [Surface.Rock]: { long: 0.7, lat: 0.6, roll: 0.02, loose: 0.005 },
};

export type BikeState = 'parked' | 'riding' | 'fallen';

export interface BikeInput {
  throttle: number;
  brake: number;
  steer: number;
  weightShift: number;
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function engineTorque(rpm: number): number {
  const t = config.bike.engine.torque;
  if (rpm <= t[0][0]) return t[0][1] * Math.max(0, rpm / t[0][0]);
  for (let i = 1; i < t.length; i++) {
    if (rpm <= t[i][0]) {
      const [r0, q0] = t[i - 1];
      const [r1, q1] = t[i];
      return q0 + ((q1 - q0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return 0; // past redline: rev limiter
}

export class Bike {
  /** Ground point under the centre of mass. */
  x: number;
  z: number;
  y: number;
  px: number;
  py: number;
  pz: number;
  /** Where the bike points: forward = (sin heading, cos heading). */
  heading: number;
  prevHeading: number;
  /** Direction of travel. Slip angle β = heading − course. */
  course: number;
  /** Signed speed along the course, m/s. */
  u = 0;
  pitch = 0;
  prevPitch = 0;
  lean = 0;
  prevLean = 0;
  leanVel = 0;
  steerAngle = 0;
  state: BikeState = 'parked';
  rider = false;

  engineOn = false;
  rpm = 0;
  gear = 1;
  private shiftTimer = 0;
  launchTimer = 0;
  private launchArmed = false;
  /** 0..1: how much of the rear tyre's grip the engine is overpowering. */
  wheelspin = 0;
  /** Slip angle β = heading − course, radians (same sign as the turn's course change). */
  beta = 0;
  /** Lateral grip used, 0..1+ (debug and audio). */
  gripUse = 0;
  footDown = 0;
  /** Seconds of throttle on mud with no progress (Day 2 task). */
  bogged = 0;
  surfaceRear: Surface = Surface.Grass;
  wheelSpinR = 0;
  wheelSpinF = 0;
  suspF = 0;
  suspR = 0;
  private suspVF = 0;
  private suspVR = 0;
  private lastHF = 0;
  private lastHR = 0;
  private lastVF = 0;
  private lastVR = 0;
  private thunkCooldown = 0;
  fallSide = 1;
  liftProgress = 0;
  lamp = false;
  waterCans = 0;
  /** Fuel, plug, carb, tyre, chain (GDD feature 5). */
  readonly care = new BikeCare();
  /** Seconds since the bike existed (kick needle runs off this). */
  time = 0;
  private ax = 0;
  /** Last frame's throttle, for audio and sheep noise. */
  throttle = 0;
  falls = 0;
  lastFall = '';

  constructor(
    x: number,
    z: number,
    heading: number,
    private terrain: Terrain,
    private obstacles: Obstacles,
    private events: EventBus,
  ) {
    this.x = this.px = x;
    this.z = this.pz = z;
    this.y = this.py = terrain.heightAt(x, z);
    this.heading = this.prevHeading = this.course = heading;
    this.lastHF = this.lastHR = this.y;
  }

  get speed(): number {
    return Math.abs(this.u);
  }

  get kmh(): number {
    return this.speed * 3.6;
  }

  /** Kick-start needle, 0..1 around the ring. */
  get kickPhase(): number {
    const k = config.bike.kick;
    return (this.time % k.cycle) / k.cycle;
  }

  get kickInWindow(): boolean {
    const k = config.bike.kick;
    const p = this.kickPhase;
    return p >= k.windowStart && p <= k.windowEnd;
  }

  /** Wheel positions on the ground (rear, front). */
  wheels(): { rx: number; rz: number; fx: number; fz: number } {
    const b = config.bike;
    const sx = Math.sin(this.heading);
    const cz = Math.cos(this.heading);
    const rx = this.x - sx * b.cgFromRear;
    const rz = this.z - cz * b.cgFromRear;
    return { rx, rz, fx: rx + sx * b.wheelbase, fz: rz + cz * b.wheelbase };
  }

  /** Steepest ground under the bike, degrees. */
  slopeDeg(): number {
    return this.terrain.slopeDegAt(this.x, this.z);
  }

  kick(tick: number): boolean {
    if (this.engineOn || this.state !== 'riding') return false;
    this.care.kicked();
    // In the window is only half of it: a worn plug or an empty tank won't catch.
    const ok = this.kickInWindow && this.care.kickCatches();
    this.events.emit('bikeKick', { success: ok, tick });
    if (ok) {
      this.engineOn = true;
      this.rpm = config.bike.engine.idleRpm;
      this.gear = 1;
      this.events.emit('bikeEngine', { on: true, reason: 'kick', tick });
    }
    return ok;
  }

  stopEngine(reason: 'stall' | 'fall' | 'off' | 'empty', tick: number): void {
    if (!this.engineOn) return;
    this.engineOn = false;
    this.events.emit('bikeEngine', { on: false, reason, tick });
  }

  fall(reason: string, tick: number): void {
    if (this.state === 'fallen') return;
    this.state = 'fallen';
    this.fallSide = this.lean !== 0 ? Math.sign(this.lean) : this.beta >= 0 ? 1 : -1;
    this.stopEngine('fall', tick);
    this.falls++;
    this.lastFall = reason;
    this.events.emit('bikeFall', { reason, tick });
  }

  lift(): void {
    this.state = 'parked';
    this.u = 0;
    this.beta = 0;
    this.lean = 0;
    this.leanVel = 0;
    this.course = this.heading;
    this.liftProgress = 0;
  }

  step(dt: number, input: BikeInput, tick: number): void {
    const b = config.bike;
    this.time += dt;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.prevHeading = this.heading;
    this.prevPitch = this.pitch;
    this.prevLean = this.lean;
    this.thunkCooldown = Math.max(0, this.thunkCooldown - dt);
    this.throttle = this.state === 'riding' ? input.throttle : 0;

    // ---- ground under the wheels
    const w = this.wheels();
    const hr = this.terrain.heightAt(w.rx, w.rz);
    const hf = this.terrain.heightAt(w.fx, w.fz);
    this.pitch = Math.atan2(hf - hr, b.wheelbase);
    this.y = hr + ((hf - hr) * b.cgFromRear) / b.wheelbase;
    this.surfaceRear = this.terrain.surfaceAt(w.rx, w.rz);
    // A soft or flat tyre grips less and drags more.
    // Off-road tread bites into mud.
    const tyre = (s: Surface): SurfaceGrip => {
      const g = SURFACE_GRIP[s];
      const k = this.care.tyreGrip * (this.care.offroad && s === Surface.Mud ? config.economy.upgrade.tyresMudGrip : 1);
      return k !== 1 || this.care.tyreRoll > 1 ? { ...g, long: g.long * k, lat: g.lat * k, roll: g.roll * this.care.tyreRoll } : g;
    };
    const gr = tyre(this.surfaceRear);
    const gf = tyre(this.terrain.surfaceAt(w.fx, w.fz));
    const hours = dt / config.time.secondsPerHour;

    this.suspension(hf, hr, dt, tick);

    if (this.state === 'parked') {
      this.u = 0;
      this.rpm = this.engineOn ? b.engine.idleRpm : 0;
      this.care.wear(0, this.surfaceRear, this.engineOn, this.engineOn, hours);
      if (this.engineOn && this.care.empty) this.stopEngine('empty', tick);
      // On its stand: leans a little; falls over on steep ground.
      this.lean += (-8 * DEG - this.lean) * Math.min(1, dt * 6);
      if (this.slopeDeg() > b.tipSlopeDeg + 3) this.fall('fell off its stand on the slope', tick);
      return;
    }

    if (this.state === 'fallen') {
      // Sliding on its side to a stop.
      const s = this.speed;
      const ns = Math.max(0, s - 6 * dt);
      this.u = s > 0 ? (this.u / s) * ns : 0;
      this.lean += (this.fallSide * 82 * DEG - this.lean) * Math.min(1, dt * 8);
      this.rpm = 0;
      this.move(dt, tick, false);
      return;
    }

    // ---- riding
    const m = b.mass;
    const L = b.wheelbase;
    const cosT = Math.cos(this.pitch);
    const sinT = Math.sin(this.pitch);
    const cg = b.cgFromRear + input.weightShift * b.weightShift;
    const Ntot = m * G * cosT;
    let Nr = m * G * (cosT * ((L - cg) / L) + (sinT * b.cgHeight) / L) + (m * this.ax * b.cgHeight) / L;
    Nr = Math.max(0, Math.min(Ntot, Nr));
    const Nf = Ntot - Nr;

    // ---- engine and clutch (automatic)
    const e = b.engine;
    const v = this.speed;
    const T = this.engineOn ? Math.max(0, Math.min(1, input.throttle)) : 0;
    this.shiftTimer += dt;
    const ratio = e.gears[this.gear - 1];
    const wheelRpm = ((v / b.wheelRadius) * ratio * 60) / (2 * Math.PI);
    let Fdrive = 0;
    if (this.engineOn) {
      // Clutch-drop launch: hold the brake and rev, then let go of the brake.
      const revving = input.brake > 0.5 && T > 0.3 && v < 0.5;
      if (revving) {
        this.launchArmed = true;
        this.rpm += (e.idleRpm + T * 5000 - this.rpm) * Math.min(1, dt * 6);
      } else {
        if (this.launchArmed && T > 0.3) this.launchTimer = e.launchSeconds;
        this.launchArmed = false;
        const engaged = this.gear > 1 || T > 0.05 || wheelRpm > 1600;
        if (engaged) {
          // In first gear the clutch slips until the wheel catches up with the engine.
          const slipRpm = e.idleRpm + T * 3200;
          this.rpm = this.gear === 1 && wheelRpm < slipRpm && T > 0.05 ? slipRpm : wheelRpm;
          if (T < 0.05 && this.rpm < e.stallRpm && this.gear >= 2) {
            this.stopEngine('stall', tick);
          }
        } else {
          this.rpm += (e.idleRpm - this.rpm) * Math.min(1, dt * 4);
        }
        if (this.engineOn && engaged) {
          const boost = this.launchTimer > 0 ? e.launchBoost : 1;
          Fdrive = ((engineTorque(this.rpm) * T * ratio) / b.wheelRadius) * e.efficiency * boost;
        }
        // Misfires, chain skips, sputter and a choked carb take their share.
        const faults = this.care.faults;
        const power = this.care.power(dt, T);
        Fdrive *= power;
        // On a flat tyre you can only crawl home.
        if (this.care.flat && v > config.bikeCare.flatMaxSpeed) Fdrive = 0;
        if (power < 0.1) this.rpm *= 0.97;
        if (this.care.faults !== faults && this.care.lastFault) this.events.emit('bikeFault', { kind: this.care.lastFault });
        if (T < 0.05 && v < 0.5 && this.care.idleStalls(dt)) this.stopEngine('stall', tick);
        if (this.care.empty) this.stopEngine('empty', tick);
      }
      // Automatic ranges.
      if (this.shiftTimer > 0.35) {
        if (this.rpm > e.upshiftRpm && this.gear < e.gears.length && !revving) {
          this.gear++;
          this.shiftTimer = 0;
        } else if (this.gear > 1 && wheelRpm < e.downshiftRpm) {
          this.gear--;
          this.shiftTimer = 0;
        }
      }
    } else {
      this.rpm += (0 - this.rpm) * Math.min(1, dt * 3);
    }
    this.launchTimer = Math.max(0, this.launchTimer - dt);

    // ---- longitudinal: traction-limited drive, grip-limited brakes, rolling, drag, slope
    const driveMax = gr.long * Nr;
    this.wheelspin = Fdrive > driveMax ? Math.min(1, (Fdrive - driveMax) / Math.max(1, driveMax)) : 0;
    const Fd = Math.min(Fdrive, driveMax);
    const Fb = input.brake * b.brakeG * m * G;
    const Fbf = Math.min(Fb * b.brakeFrontShare, gf.long * Nf);
    const Fbr = Math.min(Fb * (1 - b.brakeFrontShare), Math.max(0, gr.long * Nr - Fd));
    const v2 = this.u * this.u;
    const roll = gr.roll * Nr * (1 + gr.loose * v2) + gf.roll * Nf * (1 + gf.loose * v2);
    const drag = 0.5 * 1.2 * b.cdA * this.u * Math.abs(this.u);
    const grav = m * G * sinT;
    const scrub = Math.abs(Math.sin(this.beta)) * ((gr.lat + gf.lat) / 2) * Ntot * 0.6;
    const push = Fd - drag - grav;
    const resist = Fbf + Fbr + roll + scrub;
    if (Math.abs(this.u) < 0.05 && Math.abs(push) <= resist) {
      this.u = 0; // held by the brakes and the ground
    } else {
      const dir = Math.abs(this.u) < 0.05 ? Math.sign(push) : Math.sign(this.u);
      const nu = this.u + ((push - dir * resist) / m) * dt;
      // Resistive forces stop the bike; they never reverse it.
      this.u = Math.sign(nu) !== Math.sign(this.u) && this.u !== 0 && Math.abs(push) < resist ? 0 : nu;
    }
    this.ax = (Fd - Fbf - Fbr - drag) / m;
    this.care.wear(Math.abs(this.u) * dt, this.surfaceRear, this.engineOn, this.engineOn && Math.abs(this.u) < 0.5, hours);

    // ---- steering, cornering grip, slides
    const vNow = this.speed;
    const latMu = (gr.lat * Nr + gf.lat * Nf) / Math.max(1, Ntot);
    const steerMax = (b.maxSteerDeg * DEG) / (1 + vNow / b.steerSpeedFalloff);
    this.steerAngle += ((input.steer + this.care.wobble(this.time, vNow)) * steerMax - this.steerAngle) * Math.min(1, dt * 10);
    let yawRate = 0;
    if (vNow > 0.3) {
      // What you asked for, capped at what pure cornering grip allows: steering alone
      // doesn't slide; throttle, brakes or bumps on top of a full turn do.
      // Steering right turns clockwise seen from above, i.e. the course angle decreases.
      let rDes = -(this.u * Math.tan(this.steerAngle)) / L;
      const rCap = (0.95 * latMu * Ntot) / (m * vNow);
      rDes = Math.max(-rCap, Math.min(rCap, rDes));
      const use = Math.min(1.2, (Fd + Fbr) / Math.max(1, gr.long * Nr) * 0.7 + Fbf / Math.max(1, gf.long * Nf + 1) * 0.5);
      const avail = latMu * Ntot * Math.sqrt(Math.max(0.05, 1 - use * use));
      const Freq = m * vNow * Math.abs(rDes);
      this.gripUse = Freq / Math.max(1, avail);
      if (Freq <= avail) {
        yawRate = rDes;
        this.beta -= this.beta * Math.min(1, b.slide.recover * (1.2 - this.gripUse) * dt);
      } else {
        yawRate = (Math.sign(rDes) * avail) / (m * vNow);
        const excess = (Freq - avail) / (m * G);
        this.beta += Math.sign(rDes) * Math.sign(this.u) * excess * b.slide.gain * dt;
      }
      // Wheelspin in a turn kicks the rear out further.
      if (this.wheelspin > 0 && Math.abs(this.steerAngle) > 0.03) this.beta -= Math.sign(this.steerAngle) * this.wheelspin * 0.6 * dt;
      // Counter-steer (steering toward the slide, against the turn) catches it.
      if (input.steer * this.beta > 0) this.beta -= this.beta * b.slide.counter * Math.abs(input.steer) * dt;
      this.course = wrap(this.course + yawRate * dt);
      if (Math.abs(this.beta) > b.slide.crashDeg * DEG && vNow > b.slide.crashMinSpeed) {
        this.fall(this.wheelspin > 0.2 ? 'spun the rear out' : 'slid out on the ' + (this.surfaceRear === Surface.Gravel ? 'gravel' : 'ground'), tick);
        return;
      }
    } else {
      this.beta *= 0.9;
      this.gripUse = 0;
      // At walking pace the rider paddles the bike round with his feet.
      this.course = wrap(this.course - input.steer * 0.6 * dt * (vNow > 0.05 ? 1 : 0));
    }
    this.heading = wrap(this.course + this.beta);

    // ---- lean toward what the turn needs
    const target =
      vNow > b.footDownSpeed
        ? Math.max(-b.maxLeanDeg * DEG, Math.min(b.maxLeanDeg * DEG, Math.atan((vNow * yawRate * Math.sign(this.u)) / G) + this.beta * 0.3))
        : 0;
    this.leanVel += (b.lean.kp * (target - this.lean) - b.lean.kd * this.leanVel) * dt;
    this.lean += this.leanVel * dt;

    // ---- foot down at walking pace; stopping on steep ground before it is down tips you over
    this.footDown = vNow < b.footDownSpeed ? Math.min(1, this.footDown + dt / b.footDownSeconds) : 0;
    // Only an actual stop (brakes, or throttle closed) catches you out; bogging down with
    // the throttle open, the rider is still driving and dabs a foot.
    const stopping = input.brake > 0.3 || T < 0.1;
    if (vNow < 0.2 && this.footDown < 1 && stopping && this.slopeDeg() > b.tipSlopeDeg) {
      this.fall('stopped on the slope before getting a foot down', tick);
      return;
    }

    // Bogged in mud: throttle open, going nowhere (or backwards).
    this.bogged = this.surfaceRear === Surface.Mud && T > 0.5 && this.u < 0.6 && this.pitch > 12 * DEG ? this.bogged + dt : 0;

    this.move(dt, tick, true);
    this.wheelSpinR += (this.u / b.wheelRadius + this.wheelspin * 25) * dt;
    this.wheelSpinF += (this.u / b.wheelRadius) * dt;
  }

  private move(dt: number, tick: number, riding: boolean): void {
    const b = config.bike;
    let x = this.x + this.u * Math.sin(this.course) * dt;
    let z = this.z + this.u * Math.cos(this.course) * dt;
    // Wheels and engine block as three discs along the bike.
    const sx = Math.sin(this.heading);
    const cz = Math.cos(this.heading);
    let pushX = 0;
    let pushZ = 0;
    for (const off of [-0.62, 0.05, 0.72]) {
      const cx = x + sx * off;
      const cz2 = z + cz * off;
      const p = this.obstacles.pushOut(cx, cz2, 0.38);
      const dx = p.x - cx;
      const dz = p.z - cz2;
      if (Math.abs(dx) + Math.abs(dz) > Math.abs(pushX) + Math.abs(pushZ)) {
        pushX = dx;
        pushZ = dz;
      }
    }
    const pl = Math.hypot(pushX, pushZ);
    if (pl > 1e-6) {
      x += pushX;
      z += pushZ;
      const nx = pushX / pl;
      const nz = pushZ / pl;
      const vx = this.u * Math.sin(this.course);
      const vz = this.u * Math.cos(this.course);
      const into = -(vx * nx + vz * nz);
      if (into > 0) {
        if (riding && into > b.impactCrashSpeed) {
          this.x = x;
          this.z = z;
          this.fall('hit something too fast', tick);
          this.u *= 0.2;
          return;
        }
        // Lose the speed going into the obstacle, keep the rest (scrape along it).
        const rvx = vx + nx * into;
        const rvz = vz + nz * into;
        const rs = Math.hypot(rvx, rvz);
        if (rs < 0.05) this.u = 0;
        else {
          const fwd = rvx * Math.sin(this.heading) + rvz * Math.cos(this.heading);
          this.u = Math.sign(fwd || 1) * rs;
          this.course = Math.atan2(Math.sign(fwd || 1) * rvx, Math.sign(fwd || 1) * rvz);
        }
        if (into > 2 && this.thunkCooldown === 0) {
          this.events.emit('bikeThunk', { strength: Math.min(1, into / 6), tick });
          this.thunkCooldown = 0.3;
        }
      }
    }
    this.x = Math.max(-(this.terrain.half - 10), Math.min(this.terrain.half - 10, x));
    this.z = Math.max(-(this.terrain.half - 10), Math.min(this.terrain.half - 10, z));
  }

  /** Visual suspension driven by how sharply the ground under each wheel changes. */
  private suspension(hf: number, hr: number, dt: number, tick: number): void {
    const vF = (hf - this.lastHF) / dt;
    const vR = (hr - this.lastHR) / dt;
    const aF = (vF - this.lastVF) / dt;
    const aR = (vR - this.lastVR) / dt;
    this.lastHF = hf;
    this.lastHR = hr;
    this.lastVF = vF;
    this.lastVR = vR;
    const k = 220;
    const c = 22;
    this.suspVF += (-k * this.suspF - c * this.suspVF + Math.max(-60, Math.min(60, aF)) * 0.35) * dt;
    this.suspVR += (-k * this.suspR - c * this.suspVR + Math.max(-60, Math.min(60, aR)) * 0.35) * dt;
    this.suspF = Math.max(-0.12, Math.min(0.12, this.suspF + this.suspVF * dt));
    this.suspR = Math.max(-0.12, Math.min(0.12, this.suspR + this.suspVR * dt));
    const hit = Math.max(Math.abs(aF), Math.abs(aR));
    if (this.state === 'riding' && hit > 30 && this.thunkCooldown === 0 && this.time > 0.5) {
      this.events.emit('bikeThunk', { strength: Math.min(1, hit / 80), tick });
      this.thunkCooldown = 0.25;
    }
  }

  /** Velocity on the ground, m/s. */
  get vx(): number {
    return this.u * Math.sin(this.course);
  }

  get vz(): number {
    return this.u * Math.cos(this.course);
  }

  /** How loud the engine is for sheep, 0..1. */
  get noise(): number {
    if (!this.engineOn) return 0;
    return Math.min(1, 0.25 + 0.75 * this.throttle + this.speed / 30);
  }

  stateKey(): number[] {
    return [this.x, this.z, this.u, this.heading, this.beta, this.rpm, this.gear, this.state === 'riding' ? 1 : this.state === 'fallen' ? 2 : 0];
  }
}

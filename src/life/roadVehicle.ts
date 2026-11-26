import { SURFACE_GRIP } from '../bike/bike';
import { boxContact, circleContact, resolveContact, type Chassis } from './chassisContact';
import type { InputFrame } from '../core/input';
import type { Terrain } from '../world/terrain';
import type { Obstacles } from '../world/obstacles';
import type { V2 } from '../world/mapTypes';

export interface VehicleParking extends V2 { yaw: number }

export const vehicleSpecs = {
  tractor: {
    width: 0.72, height: 0.52, length: 1.24,
    topSpeed: 12, acceleration: 4.5, mass: 2450, wheelbase: 1.70, maxSteer: 0.57, cgHeight: 0.86,
    seatX: 0, seatY: 0, seatZ: 0, frontWheel: 0.355, rearWheel: 0.56,
  },
  car: {
    width: 0.87, height: 0.70, length: 1.90,
    topSpeed: 22, acceleration: 6.5, mass: 1120, wheelbase: 2.45, maxSteer: 0.61, cgHeight: 0.49,
    seatX: 0.38, seatY: -0.21, seatZ: 0.51, frontWheel: 0.31, rearWheel: 0.31,
  },
  van: {
    width: 0.94, height: 0.94, length: 2.12,
    topSpeed: 17, acceleration: 4.9, mass: 1880, wheelbase: 2.82, maxSteer: 0.55, cgHeight: 0.76,
    seatX: 0.38, seatY: -0.03, seatZ: 1.19, frontWheel: 0.36, rearWheel: 0.36,
  },
} as const;
export type VehicleKind = keyof typeof vehicleSpecs;

const clamp = (n: number, limit: number) => Math.max(-limit, Math.min(limit, n));
const gravity = 9.81;

export class RoadVehicle implements Chassis {
  x: number; y: number; z: number; yaw: number;
  px: number; py: number; pz: number; previousYaw: number;
  steerAngle = 0;
  vx = 0; vz = 0; spin = 0;
  private pitchRate = 0;
  private rollRate = 0;
  private lastAccel = 0;
  get width() { return vehicleSpecs[this.kind].width; }
  get length() { return vehicleSpecs[this.kind].length; }
  get mass() { return vehicleSpecs[this.kind].mass; }
  get speed(): number { return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw); }
  set speed(value: number) { this.vx = value * Math.sin(this.yaw); this.vz = value * Math.cos(this.yaw); }
  get moving(): boolean { return Math.hypot(this.vx, this.vz) > 0.025 || Math.abs(this.spin) > 0.015; }
  travel = 0;
  pitch = 0;
  roll = 0;
  occupied = false;

  constructor(at: VehicleParking, private terrain: Terrain, private obstacles: Obstacles, readonly kind: VehicleKind) {
    this.x = this.px = at.x;
    this.z = this.pz = at.z;
    this.y = this.py = terrain.heightAt(at.x, at.z);
    this.yaw = this.previousYaw = at.yaw;
    const ground = this.wheelGround();
    this.pitch = -Math.atan(ground.grade);
    this.roll = Math.atan(ground.bank);
  }

  /** Axle slip forces act on the chassis at the wheelbase, sharing grip with acceleration and braking. */
  step(dt: number, input?: Pick<InputFrame, 'steer' | 'throttle' | 'brake'>): number {
    this.px = this.x; this.py = this.y; this.pz = this.z; this.previousYaw = this.yaw;
    const spec = vehicleSpecs[this.kind], ground = this.wheelGround();
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const forward = this.speed, side = this.vx * fz - this.vz * fx;
    const steer = -(input?.steer ?? 0) * spec.maxSteer / (1 + Math.abs(forward) * 0.034);
    this.steerAngle += clamp(steer - this.steerAngle, dt * 2.3);
    const throttle = input?.throttle ?? 0, pedal = input?.brake ?? 0;
    const front = SURFACE_GRIP[ground.front], rear = SURFACE_GRIP[ground.rear];
    const grip = (front.long + rear.long) * 0.5;
    const loadF = Math.max(0.27, Math.min(0.73, 0.52 - this.lastAccel * spec.cgHeight / (gravity * spec.wheelbase)));
    const brake = input ? (forward > 0.12 ? pedal : forward < -0.12 ? throttle : 0) : 0.72;
    const drive = throttle * spec.acceleration * Math.max(0, 1 - (Math.max(0, forward) / spec.topSpeed) ** 2)
      - (forward <= 0.12 ? pedal * 3.6 * Math.max(0, 1 - (Math.min(0, forward) / 4.6) ** 2) : 0);
    const drag = (front.roll + rear.roll) * 0.5 * gravity * (1 + rear.loose * forward ** 2 * 0.20) + 0.002 * forward ** 2;
    const slope = -gravity * ground.grade / Math.hypot(1, ground.grade);
    const engine = clamp(drive, rear.long * gravity * (1 - loadF));
    const stop = clamp(forward / dt + engine + slope, grip * gravity * brake + drag);
    const longitudinal = engine - stop;
    const frictionShare = Math.sqrt(Math.max(0.04, 1 - Math.min(1, Math.abs(longitudinal) / (grip * gravity)) ** 2));
    const half = spec.wheelbase * 0.5;
    const cs = Math.cos(this.steerAngle), sn = Math.sin(this.steerAngle);
    const slipFront = (side + this.spin * half) * cs - forward * sn;
    const slipRear = side - this.spin * half;
    const cornerF = clamp(-slipFront * 10, front.lat * gravity * loadF * frictionShare);
    const cornerR = clamp(-slipRear * 10, rear.lat * gravity * (1 - loadF) * frictionShare);
    const ax = longitudinal + slope - cornerF * sn;
    const lateral = cornerF * cs + cornerR - gravity * ground.bank / Math.hypot(1, ground.bank);
    this.vx += (ax * fx + lateral * fz) * dt;
    this.vz += (ax * fz - lateral * fx) * dt;
    this.spin += ((cornerF * cs - cornerR) * half * 3 / (this.width ** 2 + this.length ** 2) - 0.42 * this.spin) * dt;
    this.yaw += this.spin * dt;
    this.x += this.vx * dt; this.z += this.vz * dt;
    const impact = this.constrain();
    // A parked vehicle settles against its handbrake after the collision impulse dissipates.
    if (!input && Math.hypot(this.vx, this.vz) < 0.09 && Math.abs(this.spin) < 0.06) {
      this.vx = this.vz = this.spin = 0;
    }
    this.lastAccel = clamp((this.speed - forward) / dt, gravity);
    const pitch = -Math.atan(ground.grade) - clamp(this.lastAccel * spec.cgHeight * 0.014, 0.11);
    const roll = Math.atan(ground.bank) + clamp((cornerF * cs + cornerR) * spec.cgHeight * 0.024, 0.19);
    this.pitchRate += ((pitch - this.pitch) * 66 - this.pitchRate * 12) * dt;
    this.rollRate += ((roll - this.roll) * 57 - this.rollRate * 10) * dt;
    this.pitch += this.pitchRate * dt; this.roll += this.rollRate * dt;
    this.travel += (this.x - this.px) * fx + (this.z - this.pz) * fz;
    return impact;
  }

  constrain(): number {
    const reach = Math.hypot(this.length, this.width);
    let impact = 0;
    this.obstacles.forEachNear(this.x, this.z, reach, prop => {
      const contact = prop.kind === 'circle' ? circleContact(this, prop.x, prop.z, prop.r) :
        boxContact(this, { x: (prop.minX + prop.maxX) * 0.5, z: (prop.minZ + prop.maxZ) * 0.5,
          width: (prop.maxX - prop.minX) * 0.5, length: (prop.maxZ - prop.minZ) * 0.5, yaw: 0 });
      if (contact) impact = Math.max(impact, resolveContact(this, null, contact));
    });
    const limit = this.terrain.half - reach;
    if (Math.abs(this.x) > limit) { this.x = clamp(this.x, limit); this.vx *= -0.1; }
    if (Math.abs(this.z) > limit) { this.z = clamp(this.z, limit); this.vz *= -0.1; }
    this.y = this.terrain.heightAt(this.x, this.z);
    return impact;
  }

  private wheelGround() {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const half = vehicleSpecs[this.kind].wheelbase / 2, track = this.width * 0.86;
    const frontX = this.x + fx * half, frontZ = this.z + fz * half;
    const rearX = this.x - fx * half, rearZ = this.z - fz * half;
    const dx = fz * track, dz = -fx * track;
    const fr = this.terrain.heightAt(frontX + dx, frontZ + dz), fl = this.terrain.heightAt(frontX - dx, frontZ - dz);
    const rr = this.terrain.heightAt(rearX + dx, rearZ + dz), rl = this.terrain.heightAt(rearX - dx, rearZ - dz);
    return { grade: (fr + fl - rr - rl) / (4 * half), bank: (fr + rr - fl - rl) / (4 * track),
      front: this.terrain.surfaceAt(frontX, frontZ), rear: this.terrain.surfaceAt(rearX, rearZ) };
  }

  beside(): V2 | undefined {
    for (const turn of [Math.PI / 2, -Math.PI / 2, Math.PI, 0]) {
      const reach = Math.max(2.1, (Math.abs(Math.sin(turn)) > 0.5 ? vehicleSpecs[this.kind].width : vehicleSpecs[this.kind].length) + 0.8);
      const x = this.x + Math.sin(this.yaw + turn) * reach, z = this.z + Math.cos(this.yaw + turn) * reach;
      if (Math.max(Math.abs(x), Math.abs(z)) < this.terrain.half - 0.6
        && !this.obstacles.blocked(x, z, 0.48) && this.terrain.slopeDegAt(x, z) < 35) return { x, z };
    }
  }
}

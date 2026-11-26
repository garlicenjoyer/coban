import type { InputFrame } from '../core/input';
import type { Terrain } from '../world/terrain';
import type { Obstacles } from '../world/obstacles';
import type { V2 } from '../world/mapTypes';

export interface VehicleParking extends V2 { yaw: number }

export const vehicleSpecs = {
  tractor: {
    width: 0.72, height: 0.52, length: 1.24,
    topSpeed: 12, acceleration: 4.5, turn: 1.15,
    seatX: 0, seatY: 0, seatZ: 0, frontWheel: 0.355, rearWheel: 0.56,
  },
  car: {
    width: 0.87, height: 0.70, length: 1.90,
    topSpeed: 22, acceleration: 6.5, turn: 1.32,
    seatX: 0.38, seatY: -0.21, seatZ: 0.51, frontWheel: 0.31, rearWheel: 0.31,
  },
  van: {
    width: 0.94, height: 0.94, length: 2.12,
    topSpeed: 17, acceleration: 4.9, turn: 1.00,
    seatX: 0.38, seatY: -0.03, seatZ: 1.19, frontWheel: 0.36, rearWheel: 0.36,
  },
} as const;
export type VehicleKind = keyof typeof vehicleSpecs;

export class RoadVehicle {
  x: number; y: number; z: number; yaw: number;
  px: number; py: number; pz: number; previousYaw: number;
  steerAngle = 0;
  speed = 0;
  travel = 0;
  pitch = 0;
  roll = 0;
  occupied = false;

  constructor(at: VehicleParking, private terrain: Terrain, private obstacles: Obstacles, readonly kind: VehicleKind) {
    this.x = this.px = at.x;
    this.z = this.pz = at.z;
    this.y = this.py = terrain.heightAt(at.x, at.z);
    this.yaw = this.previousYaw = at.yaw;
    this.fitGround();
  }

  step(dt: number, input: InputFrame, blockers: readonly V2[]): void {
    this.px = this.x; this.py = this.y; this.pz = this.z; this.previousYaw = this.yaw;
    const specs = vehicleSpecs[this.kind];
    const target = input.throttle * specs.topSpeed - input.brake * 4;
    const rate = target === 0 ? 3.8 : this.speed * target < 0 ? 10 : specs.acceleration;
    this.speed += Math.max(-rate * dt, Math.min(rate * dt, target - this.speed));
    this.steerAngle = -input.steer * 0.48;
    const yaw = this.yaw - input.steer * Math.max(-1, Math.min(1, this.speed / 3)) * specs.turn * dt;
    const distance = this.speed * dt;
    const x = this.x + Math.sin(yaw) * distance, z = this.z + Math.cos(yaw) * distance;
    const nose = Math.sign(distance) * (specs.length - 0.41);
    const nx = x + Math.sin(yaw) * nose, nz = z + Math.cos(yaw) * nose;
    if (Math.max(Math.abs(nx), Math.abs(nz)) > this.terrain.half - 2
      || this.obstacles.blocked(nx, nz, specs.width + 0.12) || this.terrain.slopeDegAt(x, z) > 32
      || blockers.some(p => Math.hypot(p.x - nx, p.z - nz) < 1.45)) {
      this.speed = 0;
      return;
    }
    this.x = x; this.z = z; this.yaw = yaw;
    this.travel += distance;
    this.fitGround();
  }

  private fitGround(): void {
    const { x, z, yaw, terrain } = this;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    this.y = terrain.heightAt(x, z);
    this.pitch = Math.atan2(terrain.heightAt(x - fx, z - fz) - terrain.heightAt(x + fx, z + fz), 2);
    this.roll = Math.atan2(terrain.heightAt(x + fz, z - fx) - terrain.heightAt(x - fz, z + fx), 2);
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

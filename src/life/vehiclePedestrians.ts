import * as THREE from 'three';
import { SIM_DT } from '../core/config';
import type { Sim } from '../sim';
import { vehicleSpecs, type RoadVehicle } from './roadVehicle';
import { circleContact } from './chassisContact';
import type { Bike } from '../bike/bike';
import { jointsOf } from './residentRig';
import type { Resident } from './residents';

export interface PedestrianTarget {
  root: THREE.Object3D;
  resident?: Resident;
  dodging?: boolean;
  presentAt?(hour: number): boolean;
}

interface Jump {
  target: PedestrianTarget;
  home: THREE.Vector3;
  start: THREE.Vector3;
  landing: THREE.Vector3;
  age: number;
  returning: number;
  joints: ReturnType<typeof jointsOf>;
}

const windup = 0.14, airtime = 0.46, returnTime = 0.95;
const { clamp, smoothstep, lerp } = THREE.MathUtils;

function feet(target: PedestrianTarget): THREE.Vector3 {
  return target.resident ? new THREE.Vector3().copy(target.resident) : target.root.getWorldPosition(new THREE.Vector3());
}

function move(target: PedestrianTarget, p: THREE.Vector3): void {
  if (target.resident) {
    target.resident.x = p.x;
    target.resident.y = p.y;
    target.resident.z = p.z;
  }
  target.root.position.copy(target.root.parent ? target.root.parent.worldToLocal(p.clone()) : p);
}

function visible(target: PedestrianTarget): boolean {
  if (!target.root.visible) return false;
  for (let node = target.root.parent; node; node = node.parent) if (!node.visible) return false;
  return true;
}

function sweep(vehicle: RoadVehicle | Bike) {
  const dx = vehicle.x - vehicle.px, dz = vehicle.z - vehicle.pz;
  const distance = Math.hypot(dx, dz), speed = distance / SIM_DT;
  if (speed < 1.6) return;
  const road = 'kind' in vehicle;
  const yaw = road ? vehicle.yaw : vehicle.heading;
  const previousYaw = road ? vehicle.previousYaw : vehicle.prevHeading;
  const turn = Math.atan2(Math.sin(yaw - previousYaw), Math.cos(yaw - previousYaw));
  const { width, length } = road ? vehicleSpecs[vehicle.kind] : { width: 0.35, length: 0.99 };
  const fx = dx / distance, fz = dz / distance;
  const fore = Math.abs(Math.sin(yaw) * fx + Math.cos(yaw) * fz);
  const side = Math.abs(Math.cos(yaw) * fx - Math.sin(yaw) * fz);
  return { vehicle, distance, speed, fx, fz, width, length, previousYaw, turn,
    lead: fore * length + side * width, breadth: side * length + fore * width };
}
type Pass = NonNullable<ReturnType<typeof sweep>>;

function contacts(pass: Pass, p: THREE.Vector3): boolean {
  const { vehicle: v, width, length, previousYaw, turn } = pass;
  const steps = Math.min(16, Math.max(1, Math.ceil((pass.distance + Math.abs(turn) * length) / 0.18)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (Math.abs(p.y - lerp(v.py, v.y, t)) < 1.6 && circleContact({
      x: lerp(v.px, v.x, t), z: lerp(v.pz, v.z, t), yaw: previousYaw + turn * t, width, length,
    }, p.x, p.z, 0.32)) return true;
  }
  return false;
}

/** Fixed-step contacts use the same displaced feet that the character is drawn at. */
export class VehiclePedestrians {
  private jumps = new Map<THREE.Object3D, Jump>();
  private posed: { bone: THREE.Object3D; rotation: THREE.Quaternion; y: number }[] = [];

  constructor(private sim: Sim, private targets: () => PedestrianTarget[],
    private down: (target: PedestrianTarget) => boolean,
    private hit: (target: PedestrianTarget, dirX: number, dirZ: number, speed: number) => void) {}

  step(vehicle: RoadVehicle | null): void {
    const vehicles: (RoadVehicle | Bike)[] = [];
    if (vehicle) vehicles.push(vehicle);
    else if (this.sim.bike.rider) vehicles.push(this.sim.bike);
    for (const owner of this.sim.residents.list) {
      if (owner.vehicle && owner.vehicle !== vehicle && owner.vehicle.moving) vehicles.push(owner.vehicle);
    }
    const passes = vehicles.map(sweep).filter((p): p is Pass => !!p);
    if (!passes.length && !this.jumps.size) return;
    const targets = this.targets();
    for (const target of targets) {
      if (target.resident && (target.resident.driving || !this.sim.residents.list.includes(target.resident))) continue;
      if (this.down(target)) continue;
      let jump = this.jumps.get(target.root);
      if (!target.resident && !(target.presentAt?.(this.sim.hour) ?? visible(target))) {
        if (jump) this.advance(jump);
        continue;
      }
      if (!jump && !passes.length) continue;
      const p = feet(target);
      let struck = false;
      for (const pass of passes) {
        if (Math.abs(p.y - pass.vehicle.y) >= 4) continue;
        const dx = p.x - pass.vehicle.px, dz = p.z - pass.vehicle.pz;
        const along = dx * pass.fx + dz * pass.fz, side = dx * pass.fz - dz * pass.fx;
        const gap = along - pass.lead - pass.distance;
        if (Math.abs(side) > pass.breadth + 0.55 || along < -pass.lead - 0.55) continue;
        if (gap < 0.55 && contacts(pass, p)) {
          move(target, p);
          this.hit(target, pass.fx, pass.fz, pass.speed);
          struck = true;
          break;
        }
        if ((!jump || jump.age >= windup + airtime) && gap > 0 && gap < pass.speed * 0.88
          && this.seesVehicle(target, p, pass.vehicle)) {
          const landing = this.landing(p, side, pass, target, targets);
          if (landing) {
            jump = { target, home: jump?.home ?? p.clone(), start: p, landing, age: 0, returning: 0,
              joints: jump?.joints ?? jointsOf(target.root) };
            this.jumps.set(target.root, jump);
            (target.resident ?? target).dodging = true;
          }
        }
      }
      if (jump && !struck) this.advance(jump);
    }
  }

  private seesVehicle(target: PedestrianTarget, p: THREE.Vector3, v: RoadVehicle | Bike): boolean {
    const heading = target.resident && target.resident.yaw + target.resident.glance;
    const gaze = heading === undefined ? target.root.getWorldDirection(new THREE.Vector3())
      : new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const dx = v.x - p.x, dz = v.z - p.z;
    return gaze.x * dx + gaze.z * dz >= -0.18 * Math.hypot(dx, dz) && this.sim.obstacles.clearBetween(p, v);
  }

  private landing(p: THREE.Vector3, side: number, pass: Pass, target: PedestrianTarget, targets: PedestrianTarget[]): THREE.Vector3 | undefined {
    const nearest = side < 0 ? -1 : 1;
    for (const sign of [nearest, -nearest]) {
      const reach = sign * (pass.breadth + 1.1) - side;
      const x = p.x + reach * pass.fz, z = p.z - reach * pass.fx;
      const y = this.sim.terrain.heightAt(x, z);
      const samples = Math.ceil(Math.abs(reach) / 0.3);
      let open = true;
      for (let i = 1; i <= samples; i++) {
        const sx = lerp(p.x, x, i / samples), sz = lerp(p.z, z, i / samples);
        if (this.sim.obstacles.blocked(sx, sz, 0.31) || this.sim.terrain.slopeDegAt(sx, sz) > 32) {
          open = false;
          break;
        }
      }
      if (open && !this.occupied(x, z) && !targets.some(other => {
        if (other.root === target.root || !visible(other)) return false;
        const otherPoint = this.jumps.get(other.root)?.landing ?? feet(other);
        return Math.hypot(x - otherPoint.x, z - otherPoint.z) < 0.72;
      })) return new THREE.Vector3(x, y, z);
    }
  }

  private occupied(x: number, z: number): boolean {
    for (const owner of this.sim.residents.list) {
      if (!owner.driving && !owner.vehicle) continue;
      const v = owner.vehicle ?? owner;
      const dx = x - v.x, dz = z - v.z, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const spec = vehicleSpecs[owner.vehicleKind];
      if (Math.abs(dx * fx + dz * fz) < spec.length + 0.38 && Math.abs(dx * fz - dz * fx) < spec.width + 0.38) return true;
    }
    return false;
  }

  private advance(jump: Jump): void {
    jump.age += SIM_DT;
    const t = clamp((jump.age - windup) / airtime, 0, 1);
    const p = jump.start.clone().lerp(jump.landing, smoothstep(t, 0, 1));
    p.y += 0.48 * 4 * t * (1 - t);
    if (jump.age > 1.2) {
      const step = Math.min(1, jump.returning + SIM_DT / returnTime);
      const next = jump.landing.clone().lerp(jump.home, step);
      if (!this.occupied(next.x, next.z) && !this.occupied(jump.home.x, jump.home.z)) jump.returning = step;
      p.copy(jump.landing).lerp(jump.home, jump.returning);
      if (jump.returning === 1) {
        (jump.target.resident ?? jump.target).dodging = false;
        this.jumps.delete(jump.target.root);
      }
    }
    move(jump.target, p);
  }

  interrupt(target: PedestrianTarget): void {
    const jump = this.jumps.get(target.root);
    if (!jump) return;
    jump.landing.copy(feet(target));
    jump.landing.y = this.sim.terrain.heightAt(jump.landing.x, jump.landing.z);
    jump.age = windup + airtime;
    jump.returning = 0;
  }

  restoreAnimation(): void {
    for (const { bone, rotation, y } of this.posed) {
      bone.quaternion.copy(rotation);
      bone.position.y = y;
    }
    this.posed.length = 0;
  }

  pose(): void {
    for (const jump of this.jumps.values()) {
      if (this.down(jump.target)) continue;
      const tuck = Math.sin(Math.PI * clamp((jump.age - windup) / airtime, 0, 1));
      const weight = smoothstep(jump.age, 0, windup) * (1 - smoothstep(jump.returning, 0.68, 1));
      const set = (name: string, x: number, z = 0) => {
        const bone = jump.joints(name);
        this.posed.push({ bone, rotation: bone.quaternion.clone(), y: bone.position.y });
        bone.rotation.set(lerp(bone.rotation.x, x, weight), bone.rotation.y * (1 - weight), lerp(bone.rotation.z, z, weight));
        return bone;
      };
      const hips = set('Hips', 0);
      hips.position.y = lerp(hips.position.y, 0.84 - 0.06 * tuck, weight);
      set('Chest', 0.15 - 0.20 * tuck);
      for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
        const stride = sign * Math.sin(jump.returning * Math.PI * 4);
        set(side + ' Arm', -0.66 - 0.40 * tuck + 0.28 * stride, sign * (0.34 + 0.42 * tuck));
        set(side + ' Elbow', -0.9);
        set(side + ' Leg', -0.14 - 0.55 * tuck - 0.36 * stride, sign * 0.13 * tuck);
        set(side + ' Knee', 0.26 + 0.83 * tuck + Math.max(0, stride) * 0.33);
        set(side + ' Foot', -0.12 - 0.24 * tuck);
      }
    }
  }

  reset(): void {
    this.restoreAnimation();
    for (const jump of this.jumps.values()) {
      (jump.target.resident ?? jump.target).dodging = false;
      if (!jump.target.resident) move(jump.target, jump.home);
    }
    this.jumps.clear();
  }
}

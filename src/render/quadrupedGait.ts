import * as THREE from 'three';
import { modelPart } from './gameModel';

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const CYCLE = 2 * Math.PI;
// Right hind, right fore, left hind, left fore in a walk. At a jog the
// diagonal pairs land together, and at a gallop the hind pair leads.
const WALK = [0.75, 0.25, 0, 0.50];
const TROT = [0.83, 0.33, 0.33, 0.83];
const GALLOP = [0.52, 0.39, 0, 0.89];

function blendCycle(from: number, to: number, weight: number): number {
  const delta = to - from;
  return from + (delta - Math.round(delta)) * weight;
}

interface Leg {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  paw: THREE.Object3D;
  hip: THREE.Vector3;
  neutralPaw: THREE.Vector3;
  upperAxis: THREE.Vector3;
  lowerAxis: THREE.Vector3;
  upperLength: number;
  lowerLength: number;
  sole: number;
  contact: THREE.Vector3;
  landing: THREE.Vector3;
  swinging: boolean;
  swingPosition: THREE.Vector3;
  lift: number;
}

/** Visual-only foot placement. The simulation still owns the animal's position. */
export class QuadrupedGait {
  readonly legs: Leg[];
  speed = 0;
  bound = 0;
  phase = 0;
  groundPitch = 0;
  groundRoll = 0;
  private cycle = 0;
  private stepLength = 0.45;
  private stance = 0.67;
  private trot = 0;
  private movement = 0;
  private previousYaw = 0;
  private initialized = false;
  private plant = true;
  private idleBlend = 0;
  private readonly bodyOrigin: THREE.Vector3;
  private readonly previous = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly target = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly down = new THREE.Vector3();
  private readonly segment = new THREE.Vector3();
  private readonly level = new THREE.Quaternion();
  private readonly pawPitch = new THREE.Euler();

  constructor(
    private readonly root: THREE.Object3D,
    private readonly body: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly strideScale = 1,
    jointOf = (name: string) => modelPart(root, name),
  ) {
    this.bodyOrigin = body.position.clone();
    this.legs = Array.from({ length: 4 }, (_, i) => {
      const upper = jointOf(`Leg ${i}`);
      const lower = jointOf(`Lower ${i}`);
      const paw = jointOf(`Paw ${i}`);
      return {
        upper, lower, paw, hip: upper.position.clone(),
        neutralPaw: upper.position.clone().add(lower.position).add(paw.position),
        upperAxis: lower.position.clone().normalize(),
        lowerAxis: paw.position.clone().normalize(),
        upperLength: lower.position.length(),
        lowerLength: paw.position.length(),
        sole: jointOf(`Sole ${i}`).position.y,
        contact: new THREE.Vector3(), landing: new THREE.Vector3(), swinging: false,
        swingPosition: new THREE.Vector3(), lift: 0,
      };
    });
  }

  reset(): void {
    this.initialized = false;
    this.velocity.set(0, 0, 0);
    this.speed = this.bound = this.cycle = this.phase = 0;
  }

  /** Advance by the distance actually rendered, including turns in place. */
  advance(dt: number): void {
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    this.position.setFromMatrixPosition(this.root.matrixWorld);
    this.delta.subVectors(this.position, this.previous);
    this.delta.y = 0;
    const distance = this.delta.length();
    const yaw = this.root.rotation.y;
    const turn = yaw - this.previousYaw;
    const yawDistance = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) * 0.31;
    this.plant = !this.initialized || distance > Math.max(0.85, dt * 11);
    this.initialized = true;
    this.previous.copy(this.position);
    this.previousYaw = yaw;
    if (this.plant) {
      this.velocity.set(0, 0, 0);
      this.speed = this.bound = this.cycle = 0;
    } else {
      const rate = 1 - Math.exp(-dt * 16);
      this.velocity.lerp(this.delta.multiplyScalar(1 / Math.max(dt, 1 / 240)), rate);
      this.speed = this.velocity.length();
    }
    this.idleBlend = 1 - Math.exp(-dt * 12);
    this.movement = smoothstep(this.speed + (this.plant ? 0 : yawDistance / Math.max(dt, 1 / 240)), 0.045, 0.33);
    this.trot = smoothstep(this.speed, 1.75, 3.45);
    this.bound = smoothstep(this.speed, 3.7, 6.25);
    const size = this.root.scale.y;
    this.stepLength = (lerp(lerp(0.42, 0.73, smoothstep(this.speed, 0.15, 1.55)), 1.25, this.trot) + this.bound * 1.42) * size * this.strideScale;
    this.stance = lerp(lerp(0.67, 0.48, this.trot), 0.245, this.bound);
    if (!this.plant) this.cycle += (distance + yawDistance * (1 - this.trot) * 0.8) / this.stepLength;
    this.phase = this.cycle * CYCLE;
    const slopeBlend = this.plant ? 1 : this.idleBlend;
    const pitch = Math.atan2(this.heightAtLocal(0, -0.42) - this.heightAtLocal(0, 0.42), 0.84 * size);
    const roll = Math.atan2(this.heightAtLocal(0.22, 0) - this.heightAtLocal(-0.22, 0), 0.44 * size);
    this.groundPitch = lerp(this.groundPitch, clamp(pitch, -0.55, 0.55), slopeBlend);
    this.groundRoll = lerp(this.groundRoll, clamp(roll, -0.45, 0.45), slopeBlend);
  }

  private heightAtLocal(x: number, z: number): number {
    const p = this.target.set(x, 0, z).applyMatrix4(this.root.matrixWorld);
    return this.groundAt(p.x, p.z);
  }

  pose(rest = 0): void {
    this.forward.copy(this.velocity);
    if (this.speed > 0.08) this.forward.divideScalar(this.speed);
    else this.forward.set(0, 0, 0);

    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      const front = i < 2;
      const offset = blendCycle(blendCycle(WALK[i], TROT[i], this.trot), GALLOP[i], this.bound);
      const cycle = this.cycle + offset;
      const phase = cycle - Math.floor(cycle);
      const moving = this.movement > 0.01 && rest < 0.7;
      const swinging = phase >= this.stance && moving;
      const neutral = this.target.copy(leg.neutralPaw);
      // Center the moving stride under the joint, especially for the bent hind legs.
      neutral.z = lerp(neutral.z, leg.hip.z, this.movement * 0.85);
      neutral.applyMatrix4(this.root.matrixWorld);
      neutral.y = this.groundAt(neutral.x, neutral.z);
      if (this.plant) {
        leg.contact.copy(neutral);
        leg.landing.copy(neutral);
        leg.swinging = false;
        leg.lift = 0;
      }

      let pitch = 0;
      if (swinging) {
        const swing = (phase - this.stance) / (1 - this.stance);
        const lead = this.stepLength * (1 - phase + this.stance * 0.49);
        leg.landing.copy(neutral).addScaledVector(this.forward, lead);
        leg.landing.y = this.groundAt(leg.landing.x, leg.landing.z);
        const arc = Math.sin(Math.PI * swing);
        leg.lift = arc ** 1.6 * lerp(0.062 + this.trot * 0.065, 0.27, this.bound) * this.movement * this.strideScale;
        pitch = -Math.sin(CYCLE * swing) * lerp(0.26, 0.48, this.bound);
        this.target.copy(leg.contact).lerp(leg.landing, smoothstep(swing, 0, 1));
        this.target.y = Math.max(this.target.y, this.groundAt(this.target.x, this.target.z));
        leg.swingPosition.copy(this.target);
      } else {
        if (leg.swinging) leg.contact.copy(moving ? leg.landing : leg.swingPosition);
        leg.lift = moving ? 0 : lerp(leg.lift, 0, this.idleBlend);
        if (!moving) {
          leg.contact.lerp(neutral, this.idleBlend);
          leg.contact.y = this.groundAt(leg.contact.x, leg.contact.z);
        }
        this.target.copy(leg.contact);
      }
      leg.swinging = swinging;
      this.target.y += (leg.lift - leg.sole) * this.root.scale.y;
      this.target.applyMatrix4(this.inverse);

      leg.upper.position.copy(leg.hip).sub(this.bodyOrigin).applyQuaternion(this.body.quaternion).add(this.body.position);
      this.solve(leg, front);
      this.pawPitch.set(pitch + this.groundPitch * 0.68, 0, this.groundRoll * 0.65);
      this.level.setFromEuler(this.pawPitch);
      leg.paw.quaternion.copy(leg.upper.quaternion).multiply(leg.lower.quaternion).invert().multiply(this.level);
      if (rest > 0) {
        // Karabaş tucks his hocks and stretches out his front paws when he lies down.
        leg.upper.position.y += (front ? -0.031 : 0.005) * rest;
        leg.upper.position.x *= 1 + 0.10 * rest;
        leg.upper.rotation.x = lerp(leg.upper.rotation.x, front ? 1.39 : -1.20, rest);
        leg.upper.rotation.z = lerp(leg.upper.rotation.z, leg.hip.x * 0.52, rest);
        leg.lower.rotation.x = lerp(leg.lower.rotation.x, front ? 0.2 : 2.36, rest);
        leg.paw.quaternion.slerp(this.level.identity(), rest);
      }
    }
  }

  private solve(leg: Leg, front: boolean): void {
    const a = leg.upperLength;
    const b = leg.lowerLength;
    const path = this.down.subVectors(this.target, leg.upper.position);
    const distance = clamp(path.length(), Math.abs(a - b) + 0.006, a + b - 0.002);
    path.normalize();
    // The front elbows fold back. The hind stifles fold forward.
    const bend = this.pole.set(leg.hip.x * 0.44, 0, front ? 1 : -1);
    bend.addScaledVector(path, -bend.dot(path)).normalize();
    const foot = (a * a + distance * distance - b * b) / (2 * distance);
    const thigh = this.segment.copy(path).multiplyScalar(foot).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - foot * foot)));
    leg.upper.quaternion.setFromUnitVectors(leg.upperAxis, this.target.copy(thigh).normalize());
    this.level.copy(leg.upper.quaternion).invert();
    const shin = path.multiplyScalar(distance).sub(thigh).normalize().applyQuaternion(this.level);
    leg.lower.quaternion.setFromUnitVectors(leg.lowerAxis, shin);
  }
}

import * as THREE from 'three';
import type { Bike } from '../bike/bike';
import type { BikeView } from '../bike/bikeView';

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const up = new THREE.Vector3(0, 1, 0);
const CRASH_DURATION = 1.34;
const HIP = 0.81;

export interface CrashPose {
  kind: 'crash';
  strength: number;
  impact: number;
  kneel: number;
  side: number;
  brace: THREE.Vector3;
}

export interface LiftPose {
  kind: 'lift';
  grip: number;
  crouch: number;
  hands: [THREE.Vector3, THREE.Vector3];
}

export type BikeBodyPose = CrashPose | LiftPose;

export class MotorcycleIncident {
  private crashAge = -1;
  private readonly launch = new THREE.Vector3();
  private readonly launchFacing = new THREE.Quaternion();
  private readonly landing = new THREE.Vector3();
  private readonly path = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly facing = new THREE.Quaternion();
  private readonly poseRotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private crashYaw = 0;
  private crashSide = 1;
  private speed = 0;
  private hasLanding = false;
  private liftSide = 0;
  private readonly crashPose: CrashPose = { kind: 'crash', strength: 0, impact: 0, kneel: 0, side: 1, brace: new THREE.Vector3() };
  private readonly liftPose: LiftPose = { kind: 'lift', grip: 0, crouch: 0, hands: [new THREE.Vector3(), new THREE.Vector3()] };

  constructor(private readonly view: BikeView, private readonly groundAt: (x: number, z: number) => number) {}

  reset(): void {
    this.crashAge = -1;
    this.liftSide = 0;
  }

  get crashing(): boolean {
    return this.crashAge >= 0;
  }

  get crashSeat(): number {
    return this.crashing ? 1 - smoothstep(this.crashAge, 0, 0.21) : 0;
  }

  fall(root: THREE.Group, bike: Bike): void {
    this.launchFacing.copy(root.quaternion);
    this.launch.copy(root.position).addScaledVector(this.axis.copy(up).applyQuaternion(this.launchFacing), HIP);
    this.crashYaw = bike.heading + Math.PI;
    this.crashSide = bike.fallSide;
    this.speed = clamp(bike.speed, 0, 14);
    this.crashAge = 0;
    this.hasLanding = false;
    this.liftSide = 0;
  }

  landAt(position: { x: number; y: number; z: number }): void {
    this.landing.set(position.x, position.y, position.z);
    const dx = position.x - this.launch.x, dz = position.z - this.launch.z;
    const across = dx * Math.cos(this.crashYaw) - dz * Math.sin(this.crashYaw);
    if (Math.abs(across) > 0.25) this.crashSide = Math.sign(across);
    this.hasLanding = true;
  }

  update(root: THREE.Group, onFoot: THREE.Vector3, yaw: number, bike: Bike, dt: number): BikeBodyPose | undefined {
    if (this.crashing) return this.crash(root, onFoot, yaw, dt);
    const progress = this.view.liftPhase;
    if (progress <= 0) {
      this.liftSide = 0;
      return undefined;
    }
    if (!this.liftSide) {
      this.axis.subVectors(onFoot, this.view.root.position);
      const across = this.axis.x * Math.cos(bike.heading + Math.PI) - this.axis.z * Math.sin(bike.heading + Math.PI);
      this.liftSide = Math.abs(across) > 0.2 ? Math.sign(across) : -bike.fallSide;
    }
    const prep = smoothstep(progress, 0, 0.32);
    const raise = smoothstep(progress, 0.28, 0.89);
    const release = smoothstep(progress, 0.89, 1);
    const side = this.liftSide;
    const nearFall = side === -bike.fallSide;
    const liftYaw = this.view.root.rotation.y + side * Math.PI / 2;
    const reach = prep * (1 - release);
    const anchorX = side * lerp(nearFall ? 1.09 : 0.025, 0.49, smoothstep(raise, 0.10, 0.94));
    this.facing.setFromAxisAngle(up, this.view.root.rotation.y);
    this.path.set(anchorX, 0, 0.12).applyQuaternion(this.facing).add(this.view.root.position);
    this.path.y = this.groundAt(this.path.x, this.path.z);
    root.position.copy(onFoot).lerp(this.path, reach);
    root.quaternion.slerp(this.facing.setFromAxisAngle(up, liftYaw), reach);

    const pose = this.liftPose;
    pose.grip = smoothstep(progress, 0.12, 0.33) * (1 - release);
    pose.crouch = reach * (1 - 0.90 * raise);
    const upper = bike.fallSide > 0 ? 1 : 0;
    const frontHand = side < 0 ? 0 : 1;
    const front = nearFall ? this.view.grips[upper] : this.view.recoveryFrame[upper];
    front.getWorldPosition(pose.hands[frontHand]);
    this.view.recoveryRails[upper].getWorldPosition(pose.hands[1 - frontHand]);
    // As the bike comes up, slide toward the near grip and the near end of the rail.
    this.view.grips[frontHand].getWorldPosition(this.axis);
    pose.hands[frontHand].lerp(this.axis, smoothstep(raise, 0.21, 0.69));
    this.view.recoveryRails[frontHand].getWorldPosition(this.axis);
    pose.hands[1 - frontHand].lerp(this.axis, smoothstep(raise, 0.28, 0.82));
    return pose;
  }

  private crash(root: THREE.Group, onFoot: THREE.Vector3, yaw: number, dt: number): CrashPose {
    if (!this.hasLanding) this.landAt(onFoot);
    const p = Math.min(1, this.crashAge / CRASH_DURATION);
    const eject = smoothstep(p, 0, 0.45);
    const recover = smoothstep(p, 0.67, 1);
    const impact = smoothstep(p, 0.19, 0.39) * (1 - smoothstep(p, 0.55, 0.80));
    const kneel = smoothstep(p, 0.48, 0.70) * (1 - smoothstep(p, 0.79, 1));
    const arc = Math.sin(Math.PI * smoothstep(p, 0, 0.36));
    const travel = 0.40 * this.speed / 14 * arc;
    this.path.copy(this.launch).lerp(this.landing, eject).lerp(onFoot, recover);
    this.path.x -= Math.sin(this.crashYaw) * travel;
    this.path.z -= Math.cos(this.crashYaw) * travel;
    const ground = this.groundAt(this.path.x, this.path.z);
    const bounced = 0.14 + this.speed * 0.009;
    const height = lerp(this.launch.y, ground + 0.24, smoothstep(p, 0.11, 0.39))
      + bounced * arc + 0.057 * Math.sin(Math.PI * smoothstep(p, 0.36, 0.51));
    this.path.y = lerp(height + kneel * 0.16, onFoot.y + HIP, recover);

    const roll = -this.crashSide * (1.54 * impact + 0.37 * arc);
    this.euler.set(0.22 * arc + 0.33 * kneel, this.crashYaw - this.crashSide * (0.25 * arc + 0.43 * impact), roll, 'YXZ');
    this.poseRotation.setFromEuler(this.euler);
    root.quaternion.copy(this.launchFacing).slerp(this.poseRotation, smoothstep(p, 0, 0.24));
    root.quaternion.slerp(this.facing.setFromAxisAngle(up, yaw), recover);
    root.position.copy(this.path).addScaledVector(this.axis.copy(up).applyQuaternion(root.quaternion), -HIP);

    const pose = this.crashPose;
    pose.strength = smoothstep(p, 0, 0.16) * (1 - recover);
    pose.impact = impact;
    pose.kneel = kneel;
    pose.side = this.crashSide;
    this.axis.set(this.crashSide * 0.31, 0, -0.35).applyQuaternion(this.facing.setFromAxisAngle(up, this.crashYaw));
    pose.brace.copy(this.path).add(this.axis);
    pose.brace.y = this.groundAt(pose.brace.x, pose.brace.z) + 0.047;
    this.crashAge = p >= 1 ? -1 : this.crashAge + dt;
    return pose;
  }
}

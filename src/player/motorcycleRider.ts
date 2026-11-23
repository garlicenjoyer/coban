import * as THREE from 'three';
import type { Bike } from '../bike/bike';
import type { BikeView } from '../bike/bikeView';
import { kickFoot, kickStroke } from '../bike/kickMotion';

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const up = new THREE.Vector3(0, 1, 0);

export interface RiderPose {
  seat: number;
  grips: readonly THREE.Object3D[];
  hands: [number, number];
  boots: [THREE.Vector3, THREE.Vector3];
  feet: [number, number];
  bootPitch: [number, number];
  lean: number;
  dab: number;
  kick: number;
  legSwing: [number, number];
  look: number;
  headRoll: number;
  weightShift: number;
}

export class MotorcycleRider {
  private readonly pose: RiderPose;
  private from?: { kind: 'mount' | 'dismount'; side: number; progress: number };
  private readonly endpoint = new THREE.Vector3();
  private readonly endpointFacing = new THREE.Quaternion();
  private readonly seat = new THREE.Vector3();
  private readonly bikeRotation = new THREE.Quaternion();
  private readonly upright = new THREE.Quaternion();
  private readonly standing = new THREE.Quaternion();
  private readonly brace = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly swing = new THREE.Vector3();
  private readonly nearBoot = new THREE.Vector3();
  private readonly startBoot = new THREE.Vector3();
  private readonly braceBoot = new THREE.Vector3();
  private readonly kickBoot = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private supportSide = -1;
  private supportWeight = 0;

  constructor(
    private readonly view: BikeView,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.pose = {
      seat: 0, grips: view.grips, hands: [0, 0], boots: [new THREE.Vector3(), new THREE.Vector3()],
      feet: [0, 0], bootPitch: [0, 0], lean: 0, dab: 0, kick: 0, legSwing: [0, 0], look: 0, headRoll: 0, weightShift: 0,
    };
  }

  reset(): void {
    this.from = undefined;
    this.supportSide = -1;
    this.supportWeight = this.pose.lean = this.pose.look = this.pose.headRoll = this.pose.weightShift = 0;
  }

  start(on: boolean, position: { x: number; y: number; z: number }, yaw: number, bike: Bike): void {
    const dx = position.x - bike.x;
    const dz = position.z - bike.z;
    const lateral = -dx * Math.cos(bike.heading) + dz * Math.sin(bike.heading);
    const side = Math.abs(lateral) < 0.20 ? this.supportSide : Math.sign(lateral);
    this.endpoint.set(position.x, position.y, position.z);
    this.endpointFacing.setFromAxisAngle(up, yaw);
    const previous = this.from;
    const progress = previous?.side === side ? previous.progress : Number(!on);
    this.from = { kind: on ? 'mount' : 'dismount', side, progress };
    this.supportSide = side;
  }

  interrupt(): void {
    this.from = undefined;
  }

  get kickstandFold(): number | undefined {
    return this.from ? smoothstep(this.from.progress, 0.29, 0.73) : undefined;
  }

  get onFootTransition(): boolean {
    return !!this.from && this.from.progress < 0.33;
  }

  update(
    root: THREE.Group, bike: Bike, dt: number, riding: boolean, fallSeat: number, weightShift: number, kickPhase = 0,
  ): RiderPose | undefined {
    const transition = this.from;
    if (!transition && !riding && fallSeat <= 0) return undefined;
    const view = this.view;
    const pose = this.pose;
    view.root.getWorldQuaternion(this.bikeRotation);
    view.seat.getWorldPosition(this.seat);
    this.seat.addScaledVector(this.axis.copy(up).applyQuaternion(this.bikeRotation), -0.78);
    const bikeYaw = view.root.rotation.y;
    this.upright.setFromAxisAngle(up, bikeYaw);

    const key = 1 - Math.exp(-dt * 9);
    const cornering = smoothstep(bike.speed, 1.6, 9.3);
    const steer = view.steering;
    const bank = view.root.rotation.z;
    const lean = clamp(bank * 1.45 - steer * 0.34, -0.85, 0.85) * cornering;
    this.supportWeight = lerp(this.supportWeight, bike.footDown, key);
    pose.lean = lerp(pose.lean, lean, key);
    pose.look = lerp(pose.look, clamp(lean * 0.32 - steer * 0.52, -0.36, 0.36), key);
    pose.headRoll = lerp(pose.headRoll, clamp(bank * 0.54 + lean * 0.14, -0.42, 0.42), key);
    pose.weightShift = lerp(pose.weightShift, weightShift, key);

    for (const [i, peg] of view.pegs.entries()) {
      peg.getWorldPosition(pose.boots[i]);
      pose.hands[i] = pose.feet[i] = fallSeat || Number(riding);
      pose.bootPitch[i] = 0.12;
      pose.legSwing[i] = 0;
    }
    pose.seat = fallSeat || Number(riding);
    pose.dab = pose.kick = 0;
    const near = this.supportSide < 0 ? 0 : 1;
    this.groundPoint(this.supportSide * 0.46, 0.04, 0.146, this.nearBoot);
    if (!transition) {
      root.position.lerp(this.seat, pose.seat);
      root.quaternion.slerp(this.bikeRotation, pose.seat);
      pose.boots[near].lerp(this.nearBoot, this.supportWeight * (riding ? 1 : 0));
      pose.bootPitch[near] *= 1 - this.supportWeight;
      pose.dab = -this.supportSide * this.supportWeight * Number(riding);
      if (kickPhase > 0 && riding) this.kick(kickPhase, bike.speed);
      return pose;
    }

    // Reverse the same leg-over-saddle sequence on exit. The simulation still
    // owns the arrival point and can move on while the last step plays out.
    const p = transition.progress;
    const approaching = smoothstep(p, 0, 0.34);
    const transfer = smoothstep(p, 0.36, 0.82);
    const straddle = smoothstep(p, 0.33, 0.90);
    const arc = Math.sin(Math.PI * straddle);
    const seatBlend = smoothstep(p, 0.25, 0.90);
    const braceYaw = bikeYaw + transition.side * 0.57;
    this.standing.setFromAxisAngle(up, braceYaw);
    this.groundPoint(transition.side * 0.54, 0.19, 0, this.brace);
    if (transition.kind === 'mount') {
      this.goal.copy(this.endpoint);
      root.quaternion.copy(this.endpointFacing);
    } else {
      this.goal.copy(this.endpoint).lerp(root.position, 1 - smoothstep(p, 0, 0.28));
    }
    root.position.copy(this.goal).lerp(this.brace, approaching).lerp(this.seat, transfer);
    root.position.y += arc * 0.17;
    root.quaternion.slerp(this.standing, approaching).slerp(this.bikeRotation, transfer);
    pose.seat = seatBlend;
    pose.hands[near] = smoothstep(p, 0.19, 0.37);
    pose.hands[1 - near] = smoothstep(p, 0.43, 0.69);
    pose.feet[near] = smoothstep(p, 0.23, 0.35);
    pose.feet[1 - near] = smoothstep(p, 0.25, 0.36);

    const far = 1 - near;
    this.groundPoint(transition.side * 0.40, 0.31, 0.145, this.startBoot);
    // Lead the boot up behind the saddle before taking it across the bike.
    view.root.localToWorld(this.swing.set(transition.side * 0.07, 1.02, 0.45));
    if (straddle < 0.5) {
      pose.boots[far].copy(this.startBoot).lerp(this.swing, smoothstep(straddle, 0, 0.5));
    } else {
      pose.boots[far].lerp(this.swing, 1 - smoothstep(straddle, 0.5, 1));
    }
    this.groundPoint(transition.side * 0.65, 0.13, 0.146, this.braceBoot);
    const brace = 1 - smoothstep(p, 0.43, 0.66);
    const dab = smoothstep(p, 0.78, 1) * this.supportWeight;
    pose.boots[near].lerp(this.braceBoot, brace).lerp(this.nearBoot, dab);
    pose.bootPitch[near] *= (1 - brace) * (1 - dab);
    pose.legSwing[far] = arc;
    pose.dab = -transition.side * dab;
    pose.bootPitch[far] = 0.14 - arc * 0.58;
    pose.lean *= transfer;
    pose.headRoll *= transfer;
    pose.look = lerp(transition.side * 0.20, pose.look, transfer);
    if (kickPhase > 0 && riding) this.kick(kickPhase, bike.speed, smoothstep(p, 0.55, 0.90));

    const direction = transition.kind === 'mount' ? 1 : -1;
    transition.progress = clamp(p + direction * dt / (direction > 0 ? 1.11 : 1.02), 0, 1);
    if ((p === 1 && direction > 0) || (p === 0 && direction < 0)) this.from = undefined;
    return pose;
  }

  private kick(phase: number, speed: number, weight = 1): void {
    const pose = this.pose;
    const reach = kickFoot(phase) * weight;
    const stroke = kickStroke(phase);
    this.view.kickPedal.getWorldPosition(this.kickBoot);
    this.kickBoot.y += 0.145 + 0.10 * Math.sin(Math.PI * smoothstep(phase, 0.06, 0.30)) * (1 - stroke);
    pose.boots[1].lerp(this.kickBoot, reach);
    pose.feet[1] = Math.max(reach, pose.feet[1]);
    pose.bootPitch[1] = lerp(pose.bootPitch[1], -0.16 + 0.49 * stroke, reach);
    pose.legSwing[1] = reach * (1 - stroke) * 0.28;
    pose.kick = reach * (0.26 + 0.74 * stroke);
    const support = reach * (1 - smoothstep(speed, 0.15, 0.95));
    this.groundPoint(-0.42, 0.06, 0.145, this.nearBoot);
    pose.boots[0].lerp(this.nearBoot, support);
    pose.dab = lerp(pose.dab, 1, support);
  }

  private groundPoint(x: number, z: number, height: number, out: THREE.Vector3): void {
    this.view.root.localToWorld(out.set(x, 0, z));
    out.y = this.groundAt(out.x, out.z) + height;
  }
}

import * as THREE from 'three';
import { modelPart } from '../render/gameModel';
import { QuadrupedGait } from '../render/quadrupedGait';
import { Mode, type Sheep } from './sheep';
import { config } from '../core/config';
import type { MilkingSubject } from '../player/stationWork';

const { lerp, smoothstep } = THREE.MathUtils;
const TAU = 2 * Math.PI;

export class SheepPose {
  readonly root: THREE.Group;
  readonly wool: THREE.Object3D;
  readonly neck: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly jaw: THREE.Object3D;
  readonly horns: THREE.Object3D;
  readonly tail: THREE.Object3D;
  readonly gait: QuadrupedGait;
  private readonly headPivot: THREE.Object3D;
  private readonly jawPivot: THREE.Object3D;
  private readonly jawOrigin: THREE.Vector3;
  private readonly muzzle: THREE.Object3D;
  private readonly neckOrigin: THREE.Vector3;
  private readonly headOffset: THREE.Vector3;
  private readonly tailOrigin: THREE.Vector3;
  private readonly woolOrigin: THREE.Vector3;
  private readonly muzzleWorld = new THREE.Vector3();
  private readonly neckRotation = new THREE.Quaternion();
  private readonly reach = new THREE.Vector3();
  private readonly hinge = new THREE.Euler(0, 0, 0, 'YXZ');
  private sheep?: Sheep;
  private headDown = 0;
  private chew = 0;
  private time = 0;
  private staging = 0;
  private stageYaw = 0;
  private readonly stagePosition = new THREE.Vector3();

  constructor(model: THREE.Group, private readonly groundAt: (x: number, z: number) => number) {
    this.root = model.clone();
    this.wool = modelPart(this.root, 'Wool');
    this.neck = modelPart(this.root, 'Neck');
    this.headPivot = modelPart(this.root, 'Head pivot');
    this.head = modelPart(this.headPivot, 'Head');
    this.jawPivot = modelPart(this.headPivot, 'Jaw pivot');
    this.jawOrigin = this.jawPivot.position.clone();
    this.jaw = modelPart(this.jawPivot, 'Jaw');
    this.muzzle = modelPart(this.headPivot, 'Muzzle point');
    this.horns = modelPart(this.headPivot, 'Ram horns and bell');
    this.tail = modelPart(this.root, 'Tail');
    this.neckOrigin = this.neck.position.clone();
    this.headOffset = this.headPivot.position.clone().sub(this.neck.position);
    this.tailOrigin = this.tail.position.clone();
    this.woolOrigin = this.wool.position.clone();
    this.gait = new QuadrupedGait(this.root, this.wool, groundAt, 0.69);
  }

  update(s: Sheep, alpha: number, dt: number, stage?: MilkingSubject): void {
    if (s !== this.sheep) {
      this.sheep = s;
      this.gait.reset();
      this.headDown = this.chew = this.staging = 0;
      this.time = (s.id * 0.61803398875) % 5;
    }
    this.time += dt;
    this.root.position.set(lerp(s.px, s.x, alpha), lerp(s.py, s.y, alpha), lerp(s.pz, s.z, alpha));
    const turn = s.heading - s.prevHeading;
    this.root.rotation.y = s.prevHeading + Math.atan2(Math.sin(turn), Math.cos(turn)) * alpha + Math.PI;
    if (stage?.sheep === s) {
      this.stagePosition.copy(stage.position);
      this.stageYaw = stage.yaw;
    }
    const staged = stage?.sheep === s ? stage.weight : 0;
    this.staging = lerp(this.staging, staged, 1 - Math.exp(-dt * 4));
    if (this.staging > 0.001) {
      this.root.position.lerp(this.stagePosition, this.staging);
      const delta = this.stageYaw - this.root.rotation.y;
      this.root.rotation.y += Math.atan2(Math.sin(delta), Math.cos(delta)) * this.staging;
    }
    this.gait.advance(dt);

    const speed = this.gait.speed;
    const stride = this.gait.phase;
    const effort = smoothstep(speed, 0.06, 1.4);
    const bound = this.gait.bound;
    const eating = s.eating && (s.mode === Mode.Graze || s.mode === Mode.Penned);
    const reach = (s.drinking ? 1 : Number(eating)) * (1 - smoothstep(speed, 0.09, 0.40)) * (1 - this.staging);
    this.headDown = lerp(this.headDown, reach, 1 - Math.exp(-dt * (reach > this.headDown ? 5 : 9)));
    const down = smoothstep(this.headDown, 0, 1);

    // Chew in short bouts, with a quick tug as each mouthful comes away.
    const bout = (this.time * (0.82 + (s.id % 5) * 0.025)) % 1;
    const bite = smoothstep(bout, 0, 0.06) * (1 - smoothstep(bout, 0.06, 0.28)) * down * Number(eating && !s.drinking);
    const jawBeat = this.time * (s.drinking ? 4.1 : 3.0 + (s.id % 4) * 0.17) * TAU;
    const chewTarget = s.drinking ? down * 0.55 : eating ? (0.10 + down * 0.90) * (1 - smoothstep(bout, 0.68, 1)) : 0;
    this.chew = lerp(this.chew, chewTarget, 1 - Math.exp(-dt * 9));

    const pitch = this.gait.groundPitch + Math.cos(stride) * effort * (0.013 + bound * 0.07) - down * 0.073;
    const roll = this.gait.groundRoll + Math.sin(stride) * effort * (0.025 - bound * 0.016);
    this.wool.rotation.set(pitch, 0, roll);
    this.wool.position.y = this.woolOrigin.y - 0.049 * effort - 0.022 * down
      + Math.sin(stride * 2 - 0.5) * effort * 0.009 + Math.sin(stride) * bound * 0.023;

    this.neck.position.copy(this.neckOrigin).sub(this.woolOrigin).applyQuaternion(this.wool.quaternion).add(this.wool.position);
    const scan = Math.sin(this.time * 2.1) * down * 0.13;
    this.hinge.set(-down * 1.52 + bite * 0.12, scan, 0);
    this.neckRotation.setFromEuler(this.hinge);
    this.neck.quaternion.copy(this.wool.quaternion).multiply(this.neckRotation);
    this.reach.copy(this.headOffset).multiplyScalar(1 + down * 0.16);
    this.headPivot.position.copy(this.reach.applyQuaternion(this.neck.quaternion)).add(this.neck.position);
    this.neck.scale.setScalar(1 + down * 0.16);
    const pant = s.thirst >= config.flock.thirst.seekAt && !s.drinking && !eating
      ? 0.025 + Math.sin(this.time * 17) * 0.025 : 0;
    this.headPivot.rotation.set(-1.22 * down + pitch * 0.42 + bite * 0.13 + pant, scan, -roll * 0.24);
    if (down > 0.48) {
      this.muzzle.getWorldPosition(this.muzzleWorld);
      const height = this.groundAt(this.muzzleWorld.x, this.muzzleWorld.z);
      const clearance = (s.drinking ? 0.027 : 0.047 + bite * 0.021) * this.root.scale.y;
      this.headPivot.position.y += THREE.MathUtils.clamp(
        (height + clearance - this.muzzleWorld.y) / this.root.scale.y, -0.085, 0.13,
      ) * smoothstep(down, 0.48, 0.95);
    }

    const lateralChew = Math.sin(jawBeat * 0.52);
    this.jawPivot.position.x = this.jawOrigin.x + lateralChew * this.chew * 0.012;
    this.jawPivot.rotation.set(-this.chew * (0.065 + Math.sin(jawBeat) * 0.061) - pant * 1.8, lateralChew * this.chew * 0.105, 0);

    this.tail.position.copy(this.tailOrigin).sub(this.woolOrigin).applyQuaternion(this.wool.quaternion).add(this.wool.position);
    this.tail.rotation.set(-0.31 * bound, Math.sin(this.time * 3.4 + stride * effort) * (0.10 + 0.17 * effort), roll * 0.50);
    this.gait.pose();
    this.root.updateMatrixWorld(true);
  }
}

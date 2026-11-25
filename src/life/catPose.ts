import * as THREE from 'three';
import { QuadrupedGait } from '../render/quadrupedGait';
import { jointsOf } from './residentRig';
import { angleDelta } from './residents';
import type { Animal } from './wildlife';

const { lerp, smoothstep } = THREE.MathUtils;

export class CatPose {
  readonly root: THREE.Object3D;
  private readonly body: THREE.Object3D;
  private readonly head: THREE.Object3D;
  private readonly ears: THREE.Object3D[];
  private readonly tail: THREE.Object3D[];
  private readonly eyes: THREE.Object3D;
  private readonly lids: THREE.Object3D;
  private readonly gait: QuadrupedGait;
  private readonly joint = new THREE.Quaternion();
  private readonly angles = new THREE.Euler();
  private rest = 0;

  constructor(model: THREE.Object3D, private readonly groundAt: (x: number, z: number) => number) {
    this.root = model.clone(true);
    this.root.visible = false;
    const joint = jointsOf(this.root);
    this.body = joint('Body');
    this.head = joint('Head');
    this.ears = ['Ear left', 'Ear right'].map(joint);
    this.tail = Array.from({ length: 5 }, (_, i) => joint(`Tail ${i}`));
    this.eyes = joint('Open eyes');
    this.lids = joint('Closed eyes');
    this.gait = new QuadrupedGait(this.root, this.body, groundAt, 0.58, joint);
  }

  update(cat: Animal, alpha: number, dt: number, camera: THREE.Vector3, index: number): void {
    const entering = !this.root.visible;
    this.root.visible = cat.visible && Math.hypot(cat.x - camera.x, cat.z - camera.z) < 82;
    if (!this.root.visible) return;
    const x = lerp(cat.px, cat.x, alpha), z = lerp(cat.pz, cat.z, alpha);
    this.root.position.set(x, this.groundAt(x, z), z);
    this.root.rotation.y = cat.previousYaw + angleDelta(cat.previousYaw, cat.yaw) * alpha;
    if (entering) this.gait.reset();
    const blend = entering ? 1 : 1 - Math.exp(-dt * 6);
    this.rest = lerp(this.rest, Number(cat.state === 'sleep'), blend);
    const rest = this.rest;
    const time = cat.age + index * 0.74;
    this.gait.advance(dt);
    const effort = smoothstep(this.gait.speed, 0.045, 0.80) * (1 - rest);
    const stride = this.gait.phase;
    this.body.position.y = lerp(0.231, 0.125, rest) + Math.sin(time * 3.1) * 0.003 + Math.cos(stride * 2) * 0.009 * effort;
    this.body.rotation.set(this.gait.groundPitch * 0.62 + Math.sin(stride) * 0.055 * effort,
      -0.15 * rest, this.gait.groundRoll * 0.62 - rest * 0.11 + Math.sin(stride) * 0.07 * effort);
    this.head.position.y = lerp(0.045, 0.009, rest);
    this.head.rotation.set(0.27 * rest + 0.044 * Math.sin(time * 2.7) * (1 - rest), 0.48 * rest + 0.12 * Math.sin(time * 1.45) * (1 - rest),
      -rest * 0.24);
    this.lids.visible = rest > 0.52 || time % 4.7 > 4.54;
    this.eyes.visible = !this.lids.visible;
    const twitch = Math.max(0, Math.sin(time * 1.24)) ** 21;
    this.ears.forEach((ear, i) => {
      ear.rotation.set(0.24 * rest + twitch * 0.22, (i ? 1 : -1) * twitch * 0.17, (i ? -1 : 1) * rest * 0.15);
    });
    this.tail.forEach((joint, i) => {
      const lift = i === 0 ? 0.91 + effort * 0.48 : -0.21 - i * 0.036;
      const curl = i === 0 ? -0.44 : i === 1 ? 0.31 : 0.05;
      joint.rotation.x = lerp(lift, curl, rest);
      joint.rotation.y = lerp(Math.sin(time * 2.2 - i * 0.56) * (0.13 + effort * 0.11), 0.52 + i * 0.13, rest);
    });
    this.gait.pose();
    if (rest < 0.001) return;
    for (const [i, leg] of this.gait.legs.entries()) {
      const front = i < 2, side = i % 2 ? 1 : -1;
      leg.upper.position.y += 0.026 * rest;
      leg.upper.position.x += side * 0.015 * rest;
      leg.upper.quaternion.slerp(this.joint.setFromEuler(this.angles.set(front ? 1.10 : -1.16, 0, side * 0.18)), rest);
      leg.lower.quaternion.slerp(this.joint.setFromEuler(this.angles.set(front ? -2.32 : 2.15, 0, side * -0.14)), rest);
      leg.paw.quaternion.slerp(this.joint.setFromEuler(this.angles.set(front ? 1.17 : -0.95, 0, 0)), rest);
    }
  }
}

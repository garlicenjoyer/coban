import * as THREE from 'three';
import { modelPart } from '../render/gameModel';
import { QuadrupedGait } from '../render/quadrupedGait';
import type { Wolf, Wolves } from './wolf';

const { lerp, smoothstep } = THREE.MathUtils;
const TAU = Math.PI * 2;

/** Each active wolf has its own joints and shares the painted meshes with the pack. */
class WolfPose {
  readonly root: THREE.Group;
  private readonly body: THREE.Object3D;
  private readonly head: THREE.Object3D;
  private readonly jaw: THREE.Object3D;
  private readonly ears: THREE.Object3D[];
  private readonly tail: THREE.Object3D;
  private readonly gait: QuadrupedGait;
  private wolf?: Wolf;
  private crouch = 0;
  private retreat = 0;

  constructor(model: THREE.Group, groundAt: (x: number, z: number) => number) {
    this.root = model.clone(true);
    this.body = modelPart(this.root, 'Body');
    this.head = modelPart(this.root, 'Head');
    this.jaw = modelPart(this.head, 'Jaw');
    this.ears = ['Ear left', 'Ear right'].map((name) => modelPart(this.head, name));
    this.tail = modelPart(this.root, 'Tail');
    this.gait = new QuadrupedGait(this.root, this.body, groundAt);
  }

  update(w: Wolf | undefined, alpha: number, dt: number): void {
    this.root.visible = !!w;
    if (w !== this.wolf) {
      this.wolf = w;
      this.gait.reset();
      this.crouch = w?.state === 'stalk' ? 1 : 0;
      this.retreat = w?.state === 'flee' ? 1 : 0;
    }
    if (!w) return;
    this.root.position.set(lerp(w.px, w.x, alpha), lerp(w.py, w.y, alpha), lerp(w.pz, w.z, alpha));
    const angle = w.heading - w.prevHeading;
    this.root.rotation.y = w.prevHeading + Math.atan2(Math.sin(angle), Math.cos(angle)) * alpha + Math.PI;
    this.root.scale.setScalar(0.96 + w.id % 5 * 0.021);

    this.gait.advance(dt);
    const effort = smoothstep(this.gait.speed, 0.05, 1.5);
    const bound = this.gait.bound;
    const phase = this.gait.phase;
    const blend = 1 - Math.exp(-dt * 9);
    this.crouch = lerp(this.crouch, w.state === 'stalk' ? 1 - bound : 0, blend);
    this.retreat = lerp(this.retreat, Number(w.state === 'flee'), blend);
    const bob = Math.cos(phase * 2 - 0.6) * effort * 0.011 + Math.sin(phase) * bound * 0.044;
    const breathing = Math.sin(w.age * 4 + w.id) * 0.004;
    const pitch = this.gait.groundPitch + Math.cos(phase) * effort * (0.025 + 0.109 * bound);
    this.body.position.y = 0.63 + bob + breathing - effort * 0.065 - bound * 0.039 - this.crouch * 0.023;
    this.body.rotation.set(pitch, 0, this.gait.groundRoll + Math.sin(phase) * effort * (1 - bound) * 0.026);
    this.head.position.y = this.body.position.y + 0.215 - pitch * 0.46 - 0.07 * this.crouch;
    this.head.rotation.set(-0.14 * this.crouch + pitch * 0.34, Math.sin(w.age * 2.3 + w.id) * 0.10 * this.crouch, 0);
    this.jaw.rotation.x = -(w.state === 'hunt' ? 0.24 : 0.095) * effort + 0.018 * Math.sin(phase) * effort;
    for (const ear of this.ears) {
      // The ears tip back during a chase or as the wolf retreats.
      ear.rotation.x = 0.04 + lerp(0.28 * bound, 0.57, this.retreat);
      ear.rotation.z = Math.sin(w.age * 3.2 + ear.position.x * 17) * 0.045;
    }
    this.tail.position.y = this.body.position.y + 0.066 + pitch * 0.48;
    this.tail.rotation.x = lerp(-0.11 - bound * 0.30, 0.63, this.retreat) + Math.sin(phase) * effort * 0.12;
    this.tail.rotation.y = Math.sin(phase + TAU * w.id / 5) * effort * 0.20;

    this.gait.pose();
  }
}

export class WolfView {
  readonly root = new THREE.Group();
  private readonly pool: WolfPose[] = [];

  constructor(
    private readonly getWolves: () => Wolves,
    private readonly model: THREE.Group,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.root.name = 'wolves';
  }

  update(alpha: number, dt: number): void {
    const list = this.getWolves().list;
    while (this.pool.length < list.length) {
      const pose = new WolfPose(this.model, this.groundAt);
      this.pool.push(pose);
      this.root.add(pose.root);
    }
    this.pool.forEach((pose, i) => pose.update(list[i], alpha, dt));
  }
}

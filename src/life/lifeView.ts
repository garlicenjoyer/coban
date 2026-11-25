import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { ShepherdFootwork } from '../player/shepherdFootwork';
import { modelPart } from '../render/gameModel';
import { angleDelta, type Resident, type Residents } from './residents';
import type { Animal, Species, Wildlife } from './wildlife';
import { residentFace, residentGesture, residentWork, type GesturePose } from './residentAnimation';
import { speechMouth } from './residentSpeech';

const { lerp, clamp } = THREE.MathUtils;
const speciesModels: Record<Species, string> = { swallow: 'Swallow', hoopoe: 'Hoopoe', hare: 'Hare', fox: 'Fox' };
const sides = ['Left', 'Right'];

interface Moving {
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  yaw: number; previousYaw: number;
}

function place(root: THREE.Object3D, m: Moving, alpha: number): void {
  root.position.set(lerp(m.px, m.x, alpha), lerp(m.py, m.y, alpha), lerp(m.pz, m.z, alpha));
  root.rotation.y = m.previousYaw + angleDelta(m.previousYaw, m.yaw) * alpha;
}

function jointsOf(root: THREE.Object3D): (name: string) => THREE.Object3D {
  const joints = new Map<string, THREE.Object3D>();
  // A catalogue can repeat joint names. GLTFLoader preserves the authored name in userData.
  root.traverse((node) => {
    if (typeof node.userData.name === 'string') joints.set(node.userData.name, node);
  });
  return (name) => {
    const joint = joints.get(name);
    if (!joint) throw new Error(`${root.name}: missing joint "${name}"`);
    return joint;
  };
}

class ResidentPose {
  readonly root: THREE.Object3D;
  private head: THREE.Object3D;
  private hips: THREE.Object3D;
  private chest: THREE.Object3D;
  private hipsHeight: number;
  private arms: THREE.Object3D[];
  private elbows: THREE.Object3D[];
  private legs: THREE.Object3D[];
  private knees: THREE.Object3D[];
  private feet: THREE.Object3D[];
  private hands: THREE.Object3D[];
  private eyes: THREE.Object3D[];
  private mouth: THREE.Object3D;
  private steering?: THREE.Object3D;
  private axles: THREE.Object3D[];
  private wheels: THREE.Object3D[];
  private tools?: Record<'broom' | 'tea', THREE.Object3D>;
  private footwork?: ShepherdFootwork;
  private working = 0;
  private pose: GesturePose = {};

  constructor(resident: Resident, models: THREE.Group, private groundAt: (x: number, z: number) => number) {
    this.root = cloneSkeleton(modelPart(models, resident.profile.model));
    this.root.rotation.order = 'YXZ';
    this.root.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false;
    });
    const joint = jointsOf(this.root);
    this.head = joint('Head');
    this.hips = joint('Hips');
    this.hipsHeight = this.hips.position.y;
    this.chest = joint('Chest');
    this.arms = sides.map((s) => joint(`${s} Arm`));
    this.elbows = sides.map((s) => joint(`${s} Elbow`));
    this.legs = sides.map((s) => joint(`${s} Leg`));
    this.knees = sides.map((s) => joint(`${s} Knee`));
    this.feet = sides.map((s) => joint(`${s} Foot`));
    this.hands = sides.map((s) => joint(`${s} Hand`));
    this.eyes = sides.map((s) => joint(`${s} Eye`));
    this.mouth = joint('Mouth');
    this.steering = resident.tractor ? joint('Steering Wheel') : undefined;
    this.axles = resident.tractor ? sides.map((s) => joint(`Front ${s} Axle`)) : [];
    this.wheels = resident.tractor ? ['Front', 'Rear'].flatMap((end) =>
      sides.map((s) => joint(`${end} ${s} Wheel`))) : [];
    if (!resident.tractor) {
      const rest = this.feet.map((foot) => this.root.worldToLocal(foot.getWorldPosition(new THREE.Vector3())));
      this.footwork = new ShepherdFootwork(rest[0], rest[1]);
      const broom = modelPart(models, 'Hand broom').clone(true);
      const tea = modelPart(models, 'Tea glass').clone(true);
      broom.position.set(0.018, -0.063, 0.028);
      tea.position.set(0.005, -0.061, 0.040);
      broom.visible = tea.visible = false;
      this.hands[1].add(broom, tea);
      this.tools = { broom, tea };
    }
  }

  update(r: Resident, alpha: number, dt: number, camera: THREE.Vector3, time: number): void {
    this.root.visible = Math.hypot(r.x - camera.x, r.z - camera.z) < 225;
    if (!this.root.visible) return;
    place(this.root, r, alpha);
    this.head.rotation.y = r.glance;
    this.head.rotation.x = Math.sin(time * 1.6) * 0.026;
    const face = residentFace(r.id, time, r.lineAge, r.speaking);
    this.eyes.forEach((eye) => { eye.scale.y = face.eyes; });
    this.mouth.scale.y = r.speech ? speechMouth(r.speech, r.lineAge) : face.mouth;
    const pose = r.settled ? r.destination.pose : undefined;
    this.working = lerp(this.working, r.workPose ? 1 : 0, 1 - Math.exp(-dt * 7));
    if (r.tractor) {
      const strain = Math.min(1, r.speed / 4);
      const steering = clamp(angleDelta(r.previousYaw, r.yaw) * 18, -0.38, 0.38) * strain;
      this.root.rotation.x = r.pitch + Math.sin(time * 36) * (r.parked ? 0 : 0.0024);
      this.root.rotation.z = r.roll;
      this.axles.forEach((axle) => { axle.rotation.y = steering; });
      this.wheels.forEach((wheel, i) => { wheel.rotation.x = r.travel / (i < 2 ? 0.355 : 0.56); });
      this.chest.rotation.x = 0.11 + 0.018 * Math.sin(time * 2.1);
      this.chest.rotation.y = 0;
      this.steering!.rotation.set(1.25, 0, lerp(this.steering!.rotation.z, -steering * 1.25, 1 - Math.exp(-dt * 7)));
      this.arms[1].rotation.set(-0.78, 0, 0.24);
      this.elbows[1].rotation.set(-0.74, 0, 0);
    } else {
      const phase = r.travel * 5.6;
      const motion = clamp(r.speed / 1.25, 0, 1);
      this.hips.position.y = this.hipsHeight - motion * 0.027 + Math.cos(phase * 2) * motion * 0.017;
      this.hips.rotation.z = Math.cos(phase) * motion * 0.036;
      this.chest.rotation.y = Math.sin(phase) * motion * 0.09;
      this.chest.rotation.x = Math.sin(time * 1.95) * 0.023 + motion * 0.065;
      this.arms.forEach((arm, i) => {
        const stride = Math.sin(phase + i * Math.PI);
        arm.rotation.x = -stride * 0.37 * motion;
        arm.rotation.z = i === 0 ? -0.10 : 0.10;
        this.elbows[i].rotation.x = -0.10 - Math.max(0, -stride) * 0.25 * motion;
      });
      this.hips.rotation.x = 0;
      if (this.tools) {
        this.tools.broom.visible = pose === 'sweep' && this.working > 0.48;
        this.tools.tea.visible = pose === 'tea' && this.working > 0.48;
        this.tools.broom.rotation.set(0.42, 0, -(this.pose.wrist ?? 0) * 0.75);
        this.tools.tea.rotation.x = 1.12;
      }
    }

    const work = pose ? residentWork(r.id, pose, r.workTime) : {};
    const gesture = r.gesturing ? residentGesture(r.id, r.gesture, r.lineAge)
      : r.wave > 0 ? residentGesture(r.id, 'greet', 1.5 - r.wave) : {};
    const k = 1 - Math.exp(-dt * 15);
    const channels = new Set([...Object.keys(this.pose), ...Object.keys(gesture), ...Object.keys(work)] as (keyof GesturePose)[]);
    for (const channel of channels) {
      this.pose[channel] = lerp(this.pose[channel] ?? 0, (work[channel] ?? 0) * this.working + (gesture[channel] ?? 0), k);
    }
    this.applyGesture(r.tractor);
    if (r.tractor) this.fitDriver(clamp(this.pose.release ?? 0, 0, 1));
    else {
      this.plantFeet(r.speed, dt);
      if (this.tools?.broom.visible) {
        const handle = this.tools.broom.localToWorld(new THREE.Vector3(0, 0.17, 0));
        this.reach(this.arms[0], this.elbows[0], this.hands[0], handle, new THREE.Vector3(-0.4, -1, 0).transformDirection(this.root.matrixWorld));
      }
    }
  }

  private applyGesture(seated: boolean): void {
    const p = this.pose;
    this.chest.rotation.x += p.bow ?? 0;
    this.chest.rotation.y += p.twist ?? 0;
    this.head.rotation.set(this.head.rotation.x + (p.nod ?? 0), this.head.rotation.y + (p.look ?? 0), p.tilt ?? 0);
    if (!seated) {
      this.arms[0].rotation.x += p.left ?? 0;
      this.arms[0].rotation.z -= p.leftOut ?? 0;
      this.elbows[0].rotation.x += p.leftBend ?? 0;
    }
    this.arms[1].rotation.x += p.right ?? 0;
    this.arms[1].rotation.z += p.rightOut ?? 0;
    this.elbows[1].rotation.x += p.rightBend ?? 0;
    this.hands[1].rotation.set(-(p.wrist ?? 0) * 0.55, 0, p.wrist ?? 0);
  }

  private plantFeet(speed: number, dt: number): void {
    const footwork = this.footwork!;
    const frame = this.root.matrixWorld;
    this.root.updateWorldMatrix(true, false);
    footwork.advance(frame, dt, speed, 0, 0, true, this.groundAt);
    const orientation = this.root.getWorldQuaternion(new THREE.Quaternion());
    for (const [i, step] of footwork.feet.entries()) {
      this.reach(this.legs[i], this.knees[i], this.feet[i],
        step.target.clone().applyMatrix4(frame), new THREE.Vector3(i === 0 ? -0.12 : 0.12, 0, 1).transformDirection(frame));
      const foot = this.feet[i];
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), step.pitch);
      foot.quaternion.copy(foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(orientation).multiply(pitch);
    }
  }

  private fitDriver(release: number): void {
    const orientation = this.root.getWorldQuaternion(new THREE.Quaternion());
    for (const [i, foot] of this.feet.entries()) {
      const side = i === 0 ? -1 : 1;
      const pedal = this.root.localToWorld(new THREE.Vector3(side * 0.225, 0.766, -0.225));
      this.reach(this.legs[i], this.knees[i], foot, pedal,
        new THREE.Vector3(side * 0.30, 0.14, 1).transformDirection(this.root.matrixWorld));
      foot.quaternion.copy(foot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(orientation);
    }
    for (const [i, hand] of this.hands.entries()) {
      const weight = i === 0 ? 1 : 1 - release;
      if (weight < 0.01) continue;
      const side = i === 0 ? -1 : 1;
      const grip = this.steering!.localToWorld(new THREE.Vector3(side * 0.153, -0.047, -0.040));
      grip.lerp(hand.getWorldPosition(new THREE.Vector3()), 1 - weight);
      this.reach(this.arms[i], this.elbows[i], hand, grip,
        new THREE.Vector3(side * 0.62, -1, -0.12).transformDirection(this.root.matrixWorld));
    }
  }

  /** Solve around the anatomical knee or elbow bend while keeping the hand or foot on target. */
  private reach(upper: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
    const origin = upper.getWorldPosition(new THREE.Vector3());
    const joint = mid.getWorldPosition(new THREE.Vector3());
    const tip = end.getWorldPosition(new THREE.Vector3());
    const a = origin.distanceTo(joint), b = joint.distanceTo(tip);
    const dir = target.sub(origin);
    const distance = clamp(dir.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
    dir.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const bend = origin.clone().addScaledVector(dir, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
    const reachable = origin.addScaledVector(dir, distance);
    const aim = (bone: THREE.Object3D, child: THREE.Object3D, world: THREE.Vector3) => {
      const direction = bone.parent!.worldToLocal(world).sub(bone.position).normalize();
      bone.quaternion.setFromUnitVectors(child.position.clone().normalize(), direction);
    };
    aim(upper, mid, bend);
    aim(mid, end, reachable);
  }
}

class AnimalPose {
  readonly root: THREE.Object3D;
  private body: THREE.Object3D;
  private head: THREE.Object3D;
  private tail: THREE.Object3D;
  private wings: THREE.Object3D[];
  private ears: THREE.Object3D[];
  private legs: THREE.Object3D[];
  private crest: THREE.Object3D | null;
  private feet: THREE.Object3D | null;
  private spread: number;
  private readonly bodyHeight: number;

  constructor(model: THREE.Object3D, species: Species) {
    this.root = model.clone(true);
    this.root.rotation.order = 'YXZ';
    const joint = jointsOf(this.root);
    this.body = joint('Body');
    this.bodyHeight = this.body.position.y;
    this.head = joint('Head');
    this.tail = joint('Tail');
    const bird = species === 'swallow' || species === 'hoopoe';
    this.wings = bird ? sides.map((s) => joint(`${s} Wing`)) : [];
    this.ears = bird ? [] : sides.map((s) => joint(`${s} Ear`));
    this.legs = bird ? [] : ['Front', 'Rear'].flatMap((end) => sides.map((s) => joint(`${end} ${s} Leg`)));
    this.crest = species === 'hoopoe' ? joint('Crest') : null;
    this.feet = bird ? joint('Feet') : null;
    this.spread = species === 'swallow' ? 1 : 0;
    if (bird) this.root.traverse((node) => { if (node instanceof THREE.Mesh) node.castShadow = false; });
  }

  update(a: Animal, alpha: number, dt: number, camera: THREE.Vector3, index: number): void {
    const bird = this.wings.length > 0;
    this.root.visible = a.visible && Math.hypot(a.x - camera.x, a.z - camera.z) < (bird ? 135 : 115);
    if (!this.root.visible) return;
    place(this.root, a, alpha);
    const time = a.age + index * 0.81;
    const idle = Math.sin(time * 2.7);
    const dashing = a.state === 'flee';
    if (bird) {
      const moving = Math.min(1, a.speed / 0.68);
      const peck = Math.max(0, Math.sin(time * 5.2)) ** 5;
      this.spread = lerp(this.spread, Number(a.airborne), 1 - Math.exp(-dt * 10));
      const flight = this.spread;
      const glide = a.species === 'swallow' && Math.sin(time * 4.8) < 0;
      const flap = glide ? 0.06 : Math.sin(time * (a.species === 'swallow' ? 70 : 54)) * 0.82;
      this.body.position.y = this.bodyHeight + (a.airborne ? flap * 0.04 : moving * Math.abs(Math.sin(time * 12)) * 0.032);
      this.body.rotation.x = flight * clamp((a.py - a.y) * 2.5, -0.44, 0.48);
      this.root.rotation.z = a.bank * flight;
      this.wings.forEach((wing, i) => {
        const s = i === 0 ? -1 : 1;
        wing.rotation.set(0, s * (1 - flight) * 1.28, s * (flight * flap - (1 - flight) * 0.21));
      });
      this.head.rotation.x = a.state === 'forage' ? peck * 0.63 : idle * 0.055;
      this.head.rotation.y = idle * (a.state === 'alert' ? 0.26 : 0.09);
      this.tail.rotation.x = flight * Math.sin(time * 8) * 0.11;
      if (this.crest) this.crest.rotation.x = a.state === 'alert' ? 0.56 : -0.71 + idle * 0.06;
      if (this.feet) this.feet.visible = flight < 0.55;
    } else {
      const move = Math.min(1, a.speed / (dashing ? 4 : 1.1));
      const hare = a.species === 'hare';
      const phase = a.travel * (hare ? 10.5 : 5.7);
      const bound = Math.max(0, Math.sin(phase));
      this.body.position.y = this.bodyHeight + (hare ? bound * (dashing ? 0.31 : 0.086) : Math.abs(Math.cos(phase)) * (dashing ? 0.125 : 0.035)) * move;
      this.body.rotation.x = Math.cos(phase) * move * (hare ? 0.18 : 0.08);
      this.legs.forEach((leg, i) => {
        const stride = hare || dashing ? Math.sin(phase + (i > 1 ? 2.65 : 0)) : Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI));
        leg.rotation.x = stride * move * (dashing ? 1.03 : 0.59);
      });
      this.ears.forEach((ear, i) => {
        ear.rotation.x = (dashing ? 0.69 : 0.04) + idle * 0.11;
        ear.rotation.z = (i ? -1 : 1) * (a.state === 'alert' ? 0.14 : 0.06) + Math.sin(time * 4.5) * 0.046;
      });
      this.head.rotation.x = a.state === 'forage' ? 0.22 + idle * 0.13 : 0.01;
      this.head.rotation.y = a.state === 'alert' ? idle * 0.10 : idle * 0.16;
      this.tail.rotation.y = Math.sin(phase * 0.7 + time) * (hare ? 0.08 : 0.22);
    }
  }
}

export class LifeView {
  readonly root = new THREE.Group();
  private residents: ResidentPose[] = [];
  private animals: AnimalPose[] = [];
  private world?: Wildlife;

  constructor(private models: THREE.Group, private groundAt: (x: number, z: number) => number) {
    this.root.name = 'Valley residents and wildlife';
  }

  update(residents: Residents, wildlife: Wildlife, alpha: number, dt: number, camera: THREE.Vector3, time: number): void {
    if (this.world !== wildlife) {
      this.world = wildlife;
      this.root.clear();
      this.residents = residents.list.map((resident) => new ResidentPose(resident, this.models, this.groundAt));
      this.animals = wildlife.animals.map((animal) => new AnimalPose(modelPart(this.models, speciesModels[animal.species]), animal.species));
      this.root.add(...this.residents.map((pose) => pose.root), ...this.animals.map((pose) => pose.root));
      for (const resident of residents.list) {
        for (const { x, z, yaw } of resident.sortingStands.values()) {
          const stand = modelPart(this.models, 'Olive sorting stand').clone(true);
          stand.position.set(x, this.groundAt(x, z), z);
          stand.rotation.y = yaw;
          this.root.add(stand);
        }
      }
    }
    this.residents.forEach((pose, i) => pose.update(residents.list[i], alpha, dt, camera, time));
    this.animals.forEach((pose, i) => pose.update(wildlife.animals[i], alpha, dt, camera, i));
  }
}

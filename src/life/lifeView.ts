import * as THREE from 'three';
import { modelPart } from '../render/gameModel';
import { angleDelta, type Resident, type Residents } from './residents';
import type { Animal, Species, Wildlife } from './wildlife';

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
  private arms: THREE.Object3D[];
  private elbows: THREE.Object3D[];
  private legs: THREE.Object3D[];
  private knees: THREE.Object3D[];
  private axles: THREE.Object3D[];
  private wheels: THREE.Object3D[];
  private tools?: Record<'broom' | 'tea', THREE.Object3D>;
  private working = 0;
  private lift = 0;

  constructor(resident: Resident, models: THREE.Group) {
    this.root = modelPart(models, resident.profile.model).clone(true);
    this.root.rotation.order = 'YXZ';
    const joint = jointsOf(this.root);
    this.head = joint('Head');
    this.hips = joint('Hips');
    this.arms = sides.map((s) => joint(`${s} Arm`));
    this.elbows = sides.map((s) => joint(`${s} Elbow`));
    this.legs = sides.map((s) => joint(`${s} Leg`));
    this.knees = sides.map((s) => joint(`${s} Knee`));
    this.axles = resident.tractor ? sides.map((s) => joint(`Front ${s} Axle`)) : [];
    this.wheels = resident.tractor ? ['Front', 'Rear'].flatMap((end) =>
      sides.map((s) => joint(`${end} ${s} Wheel`))) : [];
    if (!resident.tractor) {
      const broom = modelPart(models, 'Hand broom').clone(true);
      const tea = modelPart(models, 'Tea glass').clone(true);
      broom.position.set(0.045, -0.21, 0.05);
      tea.position.set(0.016, -0.215, 0.056);
      broom.visible = tea.visible = false;
      this.elbows[1].add(broom, tea);
      this.tools = { broom, tea };
    }
  }

  update(r: Resident, alpha: number, dt: number, camera: THREE.Vector3, time: number): void {
    this.root.visible = Math.hypot(r.x - camera.x, r.z - camera.z) < 225;
    if (!this.root.visible) return;
    place(this.root, r, alpha);
    this.head.rotation.y = r.glance;
    this.head.rotation.x = Math.sin(time * 1.6) * 0.026;
    this.lift = lerp(this.lift, Math.min(1, r.wave * 4), 1 - Math.exp(-dt * 11));
    const pose = r.settled ? r.destination.pose : undefined;
    const active = !!pose && !r.speaking && r.wave === 0;
    this.working = lerp(this.working, active ? 1 : 0, 1 - Math.exp(-dt * 7));
    if (r.tractor) {
      const strain = Math.min(1, r.speed / 4);
      this.root.rotation.x = r.pitch + Math.sin(time * 36) * (r.parked ? 0 : 0.0024);
      this.root.rotation.z = r.roll;
      this.axles.forEach((axle) => { axle.rotation.y = clamp(angleDelta(r.previousYaw, r.yaw) * 18, -0.38, 0.38) * strain; });
      this.wheels.forEach((wheel, i) => { wheel.rotation.x = r.travel / (i < 2 ? 0.355 : 0.56); });
      this.arms[1].rotation.x = -0.75;
      if (pose === 'check') this.head.rotation.x += 0.13 * this.working * (1 + Math.sin(time * 1.8));
    } else {
      const phase = r.travel * 5.6;
      const motion = clamp(r.speed / 1.25, 0, 1);
      this.hips.position.y = 0.88 + Math.cos(phase * 2) * motion * 0.022;
      this.hips.rotation.z = Math.cos(phase) * motion * 0.047;
      this.legs.forEach((leg, i) => {
        const stride = Math.sin(phase + i * Math.PI);
        leg.rotation.x = stride * 0.54 * motion;
        this.knees[i].rotation.x = Math.max(0, stride) * 0.69 * motion;
        this.arms[i].rotation.x = -stride * 0.37 * motion;
        this.elbows[i].rotation.x = -0.10 - Math.max(0, -stride) * 0.25 * motion;
      });
      const effort = this.working;
      const swing = Math.sin(time * 4);
      this.hips.rotation.x = 0;
      if (this.tools) {
        this.tools.broom.visible = pose === 'sweep' && effort > 0.65;
        this.tools.tea.visible = pose === 'tea' && effort > 0.65;
        this.tools.broom.rotation.set(0.5, 0, -swing * 0.18);
        this.tools.tea.rotation.x = 1.12;
      }
      if (pose === 'sweep') {
        this.hips.rotation.x = 0.14 * effort;
        this.hips.rotation.z += swing * effort * 0.08;
        this.arms[1].rotation.x -= (0.28 + swing * 0.21) * effort;
        this.elbows[1].rotation.x -= 0.26 * effort;
      } else if (pose === 'sort') {
        this.hips.rotation.x = 0.18 * effort;
        this.head.rotation.x += 0.22 * effort;
        this.arms[0].rotation.x -= (0.48 + swing * 0.14) * effort;
        this.arms[1].rotation.x -= (0.48 - swing * 0.14) * effort;
        this.elbows.forEach((elbow) => { elbow.rotation.x -= 0.60 * effort; });
      } else if (pose === 'tea') {
        const sip = Math.max(0, Math.sin(time * 0.65)) ** 5;
        this.arms[1].rotation.x -= (0.20 + sip * 0.49) * effort;
        this.elbows[1].rotation.x -= (0.61 + sip * 0.77) * effort;
      }
    }

    const right = this.arms[1];
    right.rotation.x = lerp(right.rotation.x, -0.54, this.lift);
    right.rotation.z = lerp(r.tractor ? 0 : 0.07, 1.75, this.lift);
    this.elbows[1].rotation.x = lerp(r.tractor ? -0.65 : this.elbows[1].rotation.x, -1.03, this.lift);
    this.elbows[1].rotation.z = Math.sin(time * 17) * this.lift * 0.33;
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
      this.residents = residents.list.map((resident) => new ResidentPose(resident, this.models));
      this.animals = wildlife.animals.map((animal) => new AnimalPose(modelPart(this.models, speciesModels[animal.species]), animal.species));
      this.root.add(...this.residents.map((pose) => pose.root), ...this.animals.map((pose) => pose.root));
      for (const resident of residents.list) {
        for (const stop of resident.stops) {
          if (stop.pose !== 'sort') continue;
          const point = resident.circuit.atStop(stop.point);
          const at = resident.circuit.at(point);
          const yaw = resident.circuit.headingAt(point);
          const x = at.x + Math.sin(yaw) * 0.69, z = at.z + Math.cos(yaw) * 0.69;
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

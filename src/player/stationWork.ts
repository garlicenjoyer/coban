import * as THREE from 'three';
import { config } from '../core/config';
import type { Sheep } from '../flock/sheep';
import { modelPart } from '../render/gameModel';
import { toonMaterial } from '../render/toon';
import type { Sim } from '../sim';

const { lerp, smoothstep, clamp } = THREE.MathUtils;
const TAU = 2 * Math.PI;
const up = new THREE.Vector3(0, 1, 0);

export interface StationPose {
  weight: number;
  sit: number;
  lean: number;
  twist: number;
  sip: number;
  hands: [THREE.Vector3, THREE.Vector3];
  contact: [number, number];
}

export interface MilkingSubject {
  sheep: Sheep;
  position: THREE.Vector3;
  yaw: number;
  weight: number;
}

export interface WorkStations {
  teaTable: THREE.Object3D;
  milkingStation: THREE.Object3D;
  press: THREE.Object3D;
}

type Job = 'tea' | 'served' | 'milk' | 'press';

export class StationWork {
  private selected?: MilkingSubject;
  private job?: Job;
  private active = false;
  private elapsed = 0;
  private phase = 0;
  private strength = 0;
  private served = 0;
  private readonly pose: StationPose = {
    weight: 0, sit: 0, lean: 0, twist: 0, sip: 0,
    hands: [new THREE.Vector3(), new THREE.Vector3()], contact: [0, 0],
  };
  private readonly kettle: THREE.Object3D;
  private readonly cup: THREE.Object3D;
  private readonly fieldKettle: THREE.Object3D;
  private readonly fieldCup: THREE.Object3D;
  private readonly stream: THREE.Mesh;
  private readonly milk: THREE.Mesh;
  private readonly milkJets: THREE.Mesh[];
  private readonly portable = new THREE.Group();
  private readonly tray = new THREE.Group();
  private readonly spindle: THREE.Object3D;
  private readonly handles: readonly [THREE.Object3D, THREE.Object3D];
  private readonly potRest: THREE.Vector3;
  private readonly cupRest: THREE.Vector3;
  private readonly potYaw: number;
  private readonly mark = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly tilt = new THREE.Quaternion();
  private readonly end = new THREE.Vector3();
  private readonly pourStart = new THREE.Vector3();
  private cupInUse?: THREE.Object3D;
  private pickup = 0;
  private porch = false;
  private pressSide = 1;

  constructor(private readonly sim: Sim, private readonly stations: WorkStations, scene: THREE.Scene) {
    this.kettle = modelPart(stations.teaTable, 'Tea kettle');
    this.cup = modelPart(stations.teaTable, 'Tea cup');
    this.potRest = this.kettle.position.clone();
    this.cupRest = this.cup.position.clone();
    this.potYaw = this.kettle.rotation.y;
    this.fieldKettle = this.kettle.clone();
    this.fieldCup = this.cup.clone();
    this.fieldKettle.scale.setScalar(0.82);
    const trayWood = toonMaterial({ color: 0x805839 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.036, 0.34), trayWood);
    top.position.y = 0.282;
    top.castShadow = top.receiveShadow = true;
    this.tray.add(top);
    const leg = new THREE.BoxGeometry(0.042, 0.27, 0.041);
    for (const x of [-0.22, 0.22]) for (const z of [-0.119, 0.119]) {
      const foot = new THREE.Mesh(leg, trayWood);
      foot.position.set(x, 0.135, z);
      foot.castShadow = true;
      this.tray.add(foot);
    }
    this.tray.position.z = -0.46;
    this.portable.add(this.tray, this.fieldKettle, this.fieldCup);
    this.portable.visible = false;
    scene.add(this.portable);
    this.spindle = modelPart(stations.press, 'Press spindle');
    this.handles = [modelPart(this.spindle, 'Press handle left'), modelPart(this.spindle, 'Press handle right')];
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.004, 1, 5), toonMaterial({ color: 0xaf602e }));
    this.stream.visible = false;
    this.milk = new THREE.Mesh(new THREE.CircleGeometry(0.106, 16).rotateX(-Math.PI / 2), toonMaterial({ color: 0xf6ecdb }));
    this.milk.visible = false;
    this.milk.position.set(0.39, 0.036, 0.115);
    const jet = new THREE.CylinderGeometry(0.003, 0.002, 1, 5);
    this.milkJets = Array.from({ length: 2 }, () => {
      const ribbon = new THREE.Mesh(jet, this.milk.material);
      ribbon.visible = false;
      stations.milkingStation.add(ribbon);
      return ribbon;
    });
    stations.milkingStation.add(this.milk);
    scene.add(this.stream);
    sim.events.on('teaServed', () => { this.served = 1.65; });
  }

  get milking(): MilkingSubject | undefined {
    return this.selected;
  }

  reset(): void {
    this.job = undefined;
    this.active = false;
    this.selected = undefined;
    this.strength = this.served = this.pickup = 0;
    this.restore();
  }

  private restore(): void {
    this.kettle.position.copy(this.potRest);
    this.kettle.rotation.set(0, this.potYaw, 0);
    this.cup.position.copy(this.cupRest);
    this.cup.rotation.set(0, 0, 0);
    this.fieldCup.rotation.set(0, 0, 0);
    this.portable.visible = this.stream.visible = this.milk.visible = false;
    for (const jet of this.milkJets) jet.visible = false;
    this.spindle.rotation.y = 0;
    this.spindle.position.y = 0;
    this.cupInUse = undefined;
  }

  update(root: THREE.Group, dt: number, speed: number, available: boolean): StationPose | undefined {
    if (this.job) this.restore();
    if (this.selected) this.selected.weight = 0;
    if (!available || speed > 0.32) this.served = 0;
    const sim = this.sim;
    const next: Job | undefined = !available ? undefined : sim.brewing > 0 ? 'tea'
      : sim.milkingNow ? 'milk' : sim.pressingNow ? 'press' : this.served > 0 ? 'served' : undefined;
    if (next && (next !== this.job || !this.active)) {
      this.job = next;
      this.elapsed = this.phase = 0;
      this.strength = 0;
      this.stations.teaTable.getWorldPosition(this.mark);
      const dx = root.position.x - this.mark.x, dz = root.position.z - this.mark.z;
      this.porch = next === 'tea' && Math.hypot(dx, dz) < 1.35;
      this.stations.press.getWorldPosition(this.mark);
      this.pressSide = root.position.z >= this.mark.z ? 1 : -1;
      this.selected = next === 'milk' ? this.selectSheep() : undefined;
    }
    this.served = Math.max(0, this.served - dt);
    if (!available) {
      this.reset();
      return undefined;
    }
    this.active = next !== undefined;
    this.strength = lerp(this.strength, Number(this.active), 1 - Math.exp(-dt * 8));
    if (!this.job || this.strength < 0.009) {
      this.job = this.selected = undefined;
      return undefined;
    }

    this.elapsed += dt;
    const pose = this.pose;
    pose.weight = this.strength;
    pose.sit = pose.lean = pose.twist = pose.sip = this.pickup = 0;
    pose.contact[0] = pose.contact[1] = 0;
    if (next === 'milk') this.phase = sim.economy.milking;
    if (next === 'press') this.phase = sim.pressProgress;
    if (next === 'tea') this.phase = clamp(1 - sim.brewing / config.satchel.caySeconds, 0, 1);
    if (next === 'served') this.phase = clamp(this.elapsed / 1.65, 0, 1);

    if (this.job === 'milk') this.milkSheep(root, pose);
    else if (this.job === 'press') this.press(root, pose);
    else this.tea(root, pose);
    return pose;
  }

  /** Keep the glass on the solved wrist as it leaves the table and returns. */
  afterPose(hand: THREE.Vector3, facing: THREE.Quaternion): void {
    const cup = this.cupInUse;
    if (!cup || this.pickup <= 0) return;
    this.mark.copy(hand);
    this.mark.y -= 0.050;
    cup.parent!.worldToLocal(this.mark);
    cup.position.lerp(this.mark, this.pickup);
    cup.parent!.getWorldQuaternion(this.tilt).invert().multiply(facing);
    cup.quaternion.slerp(this.tilt, this.pickup);
    cup.rotateX(this.pose.sip * 0.48 * this.pickup);
  }

  private standAt(root: THREE.Group, station: THREE.Object3D, x: number, z: number, yaw: number): void {
    station.localToWorld(this.mark.set(x, 0, z));
    this.mark.y = this.sim.terrain.heightAt(this.mark.x, this.mark.z);
    root.position.lerp(this.mark, this.strength);
    root.quaternion.slerp(this.tilt.setFromAxisAngle(up, yaw), this.strength);
  }

  private tea(root: THREE.Group, pose: StationPose): void {
    const t = this.phase;
    const served = this.job === 'served';
    if (this.porch) {
      const moveToCup = smoothstep(t, 0.56, 0.72);
      this.standAt(root, this.stations.teaTable, lerp(-0.22, 0.04, moveToCup), -0.49, Math.PI + 0.22);
      pose.sit = 0.098 * (1 - moveToCup);
      pose.lean = 0.58;
    } else {
      root.updateWorldMatrix(true, false);
      this.portable.position.copy(root.position);
      this.portable.quaternion.copy(root.quaternion);
      this.portable.visible = true;
      this.tray.visible = this.fieldKettle.visible = !served;
      this.fieldKettle.position.set(0.13, 0.301, -0.48);
      this.fieldKettle.rotation.set(0, Math.PI, 0);
      this.fieldCup.position.set(-0.18, served ? 1.05 : 0.301, -0.45);
      pose.sit = served ? 0 : 0.38;
      pose.lean = served ? 0 : 0.82;
    }
    const pot = this.porch ? this.kettle : this.fieldKettle;
    const cup = this.porch ? this.cup : this.fieldCup;
    const tilt = smoothstep(t, 0.28, 0.39) * (1 - smoothstep(t, 0.47, 0.56));
    const transfer = smoothstep(t, 0.17, 0.38) * (1 - smoothstep(t, 0.49, 0.63));
    cup.getWorldPosition(this.end);
    this.end.y += 0.095;
    if (!served) {
      pot.getWorldPosition(this.mark);
      this.pourStart.subVectors(this.end, this.mark).setY(0).normalize();
      const aim = Math.atan2(-this.pourStart.z, this.pourStart.x);
      pot.parent!.getWorldQuaternion(this.tilt).invert();
      this.local.copy(this.end).addScaledVector(this.pourStart, -0.23);
      this.local.y += 0.11;
      pot.position.lerp(pot.parent!.worldToLocal(this.local), transfer * this.strength);
      const worldTurn = new THREE.Quaternion().setFromAxisAngle(up, aim);
      pot.quaternion.slerp(this.tilt.multiply(worldTurn), transfer * this.strength);
      pot.rotateZ(-tilt * this.strength * 0.83);
      pot.localToWorld(pose.hands[1].set(-0.125, 0.121, 0));
      pose.contact[1] = smoothstep(t, 0.08, 0.21) * (1 - smoothstep(t, 0.59, 0.69));
      if (tilt > 0.52) {
        pot.localToWorld(this.pourStart.set(0.161, 0.273, 0.009));
        this.local.subVectors(this.end, this.pourStart);
        this.stream.visible = this.local.length() < 0.34;
        this.stream.position.copy(this.pourStart).lerp(this.end, 0.5);
        this.stream.scale.y = Math.max(0.01, this.local.length());
        this.stream.quaternion.setFromUnitVectors(up, this.local.normalize());
      }
    }
    cup.localToWorld(pose.hands[0].set(0, 0.050, 0));
    this.pickup = served ? 1 : smoothstep(t, 0.61, 0.72) * (1 - smoothstep(t, 0.88, 0.99));
    pose.sip = (served ? smoothstep(t, 0, 0.31) * (1 - smoothstep(t, 0.68, 1)) : this.pickup);
    pose.contact[0] = served ? 0.95 : smoothstep(t, 0.54, 0.66) * (1 - smoothstep(t, 0.93, 1));
    pose.lean *= 1 - pose.sip * 0.75;
    this.cupInUse = cup;
    this.pickup *= this.strength;
  }

  private selectSheep(): MilkingSubject | undefined {
    this.stations.milkingStation.localToWorld(this.mark.set(0.64, 0, -0.19));
    this.mark.y = this.sim.terrain.heightAt(this.mark.x, this.mark.z);
    let sheep: Sheep | undefined;
    let nearest = Infinity;
    for (const s of this.sim.flock.sheep) {
      const distance = Math.hypot(s.x - this.mark.x, s.z - this.mark.z);
      if (s.inPen && distance < nearest) {
        nearest = distance;
        sheep = s;
      }
    }
    return sheep && { sheep, position: this.mark.clone(), yaw: 0, weight: 0 };
  }

  private milkSheep(root: THREE.Group, pose: StationPose): void {
    const station = this.stations.milkingStation;
    this.standAt(root, station, -0.07, 0.035, -Math.PI / 2);
    pose.sit = 0.385;
    pose.lean = 1.00;
    const pumping = this.elapsed * 1.85 * TAU;
    pose.twist = Math.sin(pumping) * 0.031;
    pose.contact[0] = pose.contact[1] = smoothstep(this.elapsed, 0.10, 0.46);
    for (const [i, hand] of pose.hands.entries()) {
      const pull = 0.5 + Math.sin(pumping + i * Math.PI) * 0.5;
      hand.set(0.439 - pull * 0.025, 0.381 - pull * 0.051, -0.027 + i * 0.126);
      const jet = this.milkJets[i];
      jet.visible = !!this.selected && this.strength > 0.86 && this.phase > 0.05 && pull > 0.56 && this.sim.milkingNow;
      if (jet.visible) {
        this.local.set(0.39, 0.040 + this.phase * 0.13, 0.115).sub(hand);
        jet.position.copy(hand).addScaledVector(this.local, 0.54);
        jet.scale.y = this.local.length() * 0.92;
        jet.quaternion.setFromUnitVectors(up, this.local.normalize());
      }
      station.localToWorld(hand);
    }
    if (this.selected) this.selected.weight = this.strength;
    this.milk.visible = this.phase > 0.04;
    this.milk.position.y = 0.045 + this.phase * 0.13;
  }

  private press(root: THREE.Group, pose: StationPose): void {
    this.standAt(root, this.stations.press, 0, this.pressSide * 0.41, this.pressSide > 0 ? 0 : Math.PI);
    const cycles = this.phase * 5.0;
    const stroke = cycles % 1;
    const turn = smoothstep(stroke, 0.14, 0.79);
    this.spindle.rotation.y = (Math.floor(cycles) + turn) * Math.PI;
    this.spindle.position.y = -this.phase * 0.086 * this.strength;
    const switchHands = (Math.cos(this.spindle.rotation.y) < 0) !== (this.pressSide < 0);
    const load = smoothstep(stroke, 0.07, 0.22) * (1 - smoothstep(stroke, 0.69, 0.94));
    const regrip = smoothstep(Math.abs(stroke - 0.465), 0.04, 0.19);
    for (const [i, hand] of pose.hands.entries()) {
      this.handles[switchHands ? 1 - i : i].getWorldPosition(hand);
      pose.contact[i] = load * regrip;
    }
    pose.lean = 0.13 + 0.18 * load;
    pose.twist = Math.sin(turn * Math.PI) * 0.26 * this.pressSide;
  }
}

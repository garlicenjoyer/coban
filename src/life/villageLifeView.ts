import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { Vec3Like } from '../core/events';
import { modelPart } from '../render/gameModel';
import { toonMaterial } from '../render/toon';
import type { Layout, ResidentId } from '../world/mapTypes';
import type { Terrain } from '../world/terrain';
import { CAFE, CAFE_TABLES, LAUNDRY, cafePoint } from '../world/villagePlan';
import type { ValleyProps } from '../world/valleyProps';
import type { Obstacles } from '../world/obstacles';
import { angleDelta, witnessesTheft } from './residents';
import { residentFace, residentGesture } from './residentAnimation';
import { jointsOf, reachLimb } from './residentRig';
import { planResidentSpeech, speechMouth, type ResidentSpeech } from './residentSpeech';
import type { WorkSound } from './residentWork';

type Village = NonNullable<Layout['village']>;
type Side = 0 | 1;

interface VillageSounds {
  voice: (point: Vec3Like, id: ResidentId, speech: ResidentSpeech) => void;
  work: (kind: WorkSound, point: Vec3Like) => void;
}

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const sides = ['Left', 'Right'] as const;
const paint = (color: number) => toonMaterial({ color });
const wood = paint(0x79563b);
const darkWood = paint(0x594031);
const pale = paint(0xe3c498);
const black = paint(0x584238);
const ceramic = paint(0xe6d9bd);

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const node = new THREE.Mesh(geometry, material);
  node.position.set(x, y, z);
  node.castShadow = node.receiveShadow = true;
  parent.add(node);
  return node;
}

function box(parent: THREE.Object3D, material: THREE.Material, dims: [number, number, number], x: number, y: number, z: number): THREE.Mesh {
  return mesh(parent, new THREE.BoxGeometry(...dims), material, x, y, z);
}

class Villager {
  readonly root: THREE.Object3D;
  private readonly head: THREE.Object3D;
  private readonly mouth: THREE.Object3D;
  private readonly eyes: THREE.Object3D[];
  private readonly hips: THREE.Object3D;
  private readonly chest: THREE.Object3D;
  private readonly arms: THREE.Object3D[];
  private readonly elbows: THREE.Object3D[];
  private readonly hands: THREE.Object3D[];
  private readonly restHeight: number;

  constructor(models: THREE.Group, name: string, readonly voice: ResidentId, private readonly seated = false) {
    this.root = cloneSkeleton(modelPart(models, name));
    this.root.traverse((node) => { if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false; });
    const joint = jointsOf(this.root);
    this.head = joint('Head');
    this.mouth = joint('Mouth');
    this.hips = joint('Hips');
    this.chest = joint('Chest');
    this.restHeight = seated ? 0.53 : this.hips.position.y;
    this.eyes = sides.map((side) => joint(side + ' Eye'));
    this.arms = sides.map((side) => joint(side + ' Arm'));
    this.elbows = sides.map((side) => joint(side + ' Elbow'));
    this.hands = sides.map((side) => joint(side + ' Hand'));
    if (seated) for (const side of sides) {
      joint(side + ' Leg').rotation.x = -1.34;
      joint(side + ' Knee').rotation.x = 1.57;
      joint(side + ' Foot').rotation.x = -0.23;
    }
  }

  dodging = false;
  alarmAt = -Infinity;
  alarmed(time: number, target: Vec3Like): boolean {
    if (this.dodging) {
      this.pose(time);
      return true;
    }
    const age = time - this.alarmAt;
    if (age < 0 || age >= 2.6) return false;
    const local = this.root.worldToLocal(new THREE.Vector3(target.x, target.y, target.z));
    this.pose(time, clamp(Math.atan2(local.x, local.z), -1.25, 1.25), -0.1);
    const p = residentGesture(this.voice, 'startle', age);
    this.arms[0].rotation.x += p.left ?? 0;
    this.arms[1].rotation.x += p.right ?? 0;
    this.elbows[0].rotation.x += p.leftBend ?? 0;
    this.elbows[1].rotation.x += p.rightBend ?? 0;
    return true;
  }

  pose(time: number, gaze = 0, lean = 0, lower = 0, line?: ResidentSpeech, age = 0): void {
    const gesture = line ? residentGesture(this.voice, 'explain', age) : {};
    const face = residentFace(this.voice, time, age, !!line);
    this.eyes.forEach((eye) => { eye.scale.y = face.eyes; });
    this.mouth.scale.y = line ? speechMouth(line, age) : face.mouth;
    this.hips.position.y = this.restHeight - lower;
    this.head.rotation.set(0.025 * Math.sin(time * 1.7) + (gesture.nod ?? 0) + gaze * 0.06, gaze * 0.99 + (gesture.look ?? 0) * (1 - Math.min(1, Math.abs(gaze))),
      gaze * -0.095 + (gesture.tilt ?? 0));
    this.chest.rotation.set(lean + 0.025 * Math.sin(time * 1.8) + (gesture.bow ?? 0), gaze * 0.21 + (gesture.twist ?? 0), 0);
    this.arms[0].rotation.set((this.seated ? -0.30 : 0) + (gesture.left ?? 0), 0, -0.10 - (gesture.leftOut ?? 0));
    this.arms[1].rotation.set((this.seated ? -0.32 : 0.02) + (gesture.right ?? 0), 0, 0.10 + (gesture.rightOut ?? 0));
    this.elbows[0].rotation.set((this.seated ? -0.99 : -0.16) + (gesture.leftBend ?? 0), 0, 0);
    this.elbows[1].rotation.set((this.seated ? -1.01 : -0.23) + (gesture.rightBend ?? 0), 0, 0);
  }

  reach(side: Side, target: THREE.Vector3, weight = 1): void {
    if (weight <= 0) return;
    const hand = this.hands[side];
    const position = hand.getWorldPosition(new THREE.Vector3()).lerp(target, weight);
    const pole = new THREE.Vector3(side ? 0.65 : -0.65, -1, -0.1).transformDirection(this.root.matrixWorld);
    reachLimb(this.arms[side], this.elbows[side], hand, position, pole);
  }

  handPosition(side: Side): THREE.Vector3 {
    return this.hands[side].getWorldPosition(new THREE.Vector3());
  }
}

function tavlaBoard(root: THREE.Group): THREE.Mesh[] {
  box(root, darkWood, [0.61, 0.034, 0.37], 0, 0.017, 0);
  box(root, pale, [0.575, 0.009, 0.334], 0, 0.036, 0);
  for (const x of [-0.295, 0, 0.295]) box(root, wood, [0.016, 0.022, 0.36], x, 0.041, 0);
  for (const z of [-0.178, 0.178]) box(root, wood, [0.60, 0.022, 0.014], 0, 0.041, z);
  for (const [stripe, material] of [paint(0xa55741), paint(0x526e63)].entries()) {
    const points: number[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        if (i % 2 !== stripe) continue;
        const x = (i - 5.5) * 0.046 + (i < 6 ? -0.005 : 0.005);
        const z = side * 0.167;
        const half = side * 0.021;
        points.push(x + half, 0.041, z, x, 0.041, z - side * 0.137, x - half, 0.041, z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.computeVertexNormals();
    mesh(root, geometry, material, 0, 0, 0);
  }
  const checker = new THREE.CylinderGeometry(0.0177, 0.018, 0.008, 10);
  const moving = [];
  for (const [side, material] of [[-1, pale], [1, black]] as const) {
    // Two checkers on the 24-point, five on the 13, three on the 8, and five on the 6.
    for (const [x, z, count] of [[-0.271, -0.136, 2], [-0.029, 0.136, 5], [0.199, 0.136, 3], [0.029, -0.136, 4]]) {
      for (let i = 0; i < count; i++) {
        mesh(root, checker, material, x * side, 0.048 + Math.max(i - 2, 0) * 0.008, z * side - Math.sign(z * side) * Math.min(i, 2) * 0.038);
      }
    }
    moving.push(mesh(root, checker, material, side * 0.211, 0.048, side * 0.102));
  }
  for (const [x, z, turn] of [[0.096, -0.016, -0.32], [0.149, 0.026, 0.4]]) {
    const die = box(root, ceramic, [0.026, 0.026, 0.026], x, 0.054, z);
    die.rotation.y = turn;
    for (const d of [-0.006, 0.006]) mesh(die, new THREE.CircleGeometry(0.0027, 7).rotateX(-Math.PI / 2), black, d, 0.0131, d);
  }
  return moving;
}

class Clothesline {
  readonly root = new THREE.Group();
  private readonly pin: THREE.Group;
  private readonly resting: THREE.Group[] = [];
  private readonly ground: number;
  private readonly top: (t: number) => number;

  constructor(readonly worker: Villager, props: ValleyProps, village: Village, terrain: Terrain) {
    const { x, z, halfSpan, height } = LAUNDRY;
    const wx = village.x + x, wz = village.z + z;
    this.ground = terrain.heightAt(wx, wz);
    this.root.name = 'Emine’s washing';
    this.root.position.set(wx, this.ground, wz);
    const endHeights = [-halfSpan, halfSpan].map((dx) => terrain.heightAt(wx + dx, wz) - this.ground);
    const post = new THREE.CylinderGeometry(0.047, 0.062, height + 0.04, 7);
    endHeights.forEach((y, i) => mesh(this.root, post, wood, i ? halfSpan : -halfSpan, y + height / 2, 0));
    this.top = (t) => lerp(endHeights[0], endHeights[1], t) + height - 0.03 - 0.13 * Math.sin(Math.PI * t);
    const points = Array.from({ length: 17 }, (_, i) => new THREE.Vector3(lerp(-halfSpan, halfSpan, i / 16), this.top(i / 16), 0));
    const rope = new THREE.CatmullRomCurve3(points);
    mesh(this.root, new THREE.TubeGeometry(rope, 24, 0.008, 5, false), pale, 0, 0, 0);
    for (const [t, width, length, color] of [[0.16, 0.96, 0.80, 0xf2e0c3], [0.36, 0.66, 0.61, 0x9fb3ad], [0.82, 0.64, 0.70, 0xb25845]]) {
      this.resting.push(this.cloth(t, width, length, color));
    }
    this.pin = this.cloth(0.60, 0.53, 0.51, 0xd6a75b);
    const basketX = 0.90, basketZ = 0.49;
    const seat = terrain.heightAt(wx + basketX, wz + basketZ) - this.ground;
    props.place(this.root, 'Wooden stool', basketX, seat, basketZ);
    const basket = new THREE.LatheGeometry([[0, 0], [0.15, 0], [0.21, 0.15], [0.20, 0.16], [0.187, 0.146], [0.13, 0.025], [0, 0.025]]
      .map(([r, h]) => new THREE.Vector2(r, h)), 20);
    mesh(this.root, basket, paint(0xa68051), basketX, seat + 0.40, basketZ);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.TorusGeometry(0.16 + i * 0.014, 0.009, 5, 20).rotateX(Math.PI / 2);
      mesh(this.root, ring, i % 2 ? wood : pale, basketX, seat + 0.429 + i * 0.036, basketZ);
    }
    box(this.root, paint(0x8e9da2), [0.25, 0.045, 0.22], basketX, seat + 0.55, basketZ);
    worker.root.position.set(wx + 0.43, terrain.heightAt(wx + 0.43, wz + 0.49), wz + 0.49);
    worker.root.rotation.y = Math.PI;
    this.root.add(worker.root);
    worker.root.position.sub(this.root.position);
  }

  private cloth(t: number, width: number, height: number, color: number): THREE.Group {
    const cloth = new THREE.Group();
    cloth.position.set((t * 2 - 1) * LAUNDRY.halfSpan, this.top(t), 0);
    this.root.add(cloth);
    const panel = new THREE.PlaneGeometry(width, height, 8, 6).translate(0, -height / 2, 0);
    const points = panel.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const y = points.getY(i);
      points.setZ(i, Math.sin(points.getX(i) * 21) * y * 0.09);
    }
    panel.computeVertexNormals();
    mesh(cloth, panel, toonMaterial({ color, side: THREE.DoubleSide }), 0, 0, 0);
    for (const side of [-1, 1]) box(cloth, pale, [0.023, 0.072, 0.022], side * width * 0.41, 0.003, 0);
    return cloth;
  }

  update(hour: number, time: number, camera: THREE.Vector3, player: Vec3Like): void {
    this.root.visible = Math.hypot(camera.x - this.root.position.x, camera.z - this.root.position.z) < 115;
    if (!this.root.visible) return;
    this.resting.forEach((cloth, i) => { cloth.rotation.x = 0.09 * Math.sin(time * 1.6 + i * 1.3) + 0.04 * Math.sin(time * 3.9 + i); });
    const worker = this.worker;
    worker.root.visible = hour >= 6.8 && hour < 18.3;
    const phase = time % 19;
    const lift = smoothstep(phase, 1.4, 3.9) - smoothstep(phase, 15.0, 17.3);
    const grip = smoothstep(phase, 0.4, 1.4) - smoothstep(phase, 4.8, 5.8)
      + smoothstep(phase, 13.7, 14.8) - smoothstep(phase, 17.5, 18.6);
    const raising = worker.root.visible ? lift : 1;
    this.pin.position.set(lerp(0.80, 0.50, raising), lerp(0.69, this.top(0.6), raising), lerp(0.47, 0, raising));
    this.pin.rotation.x = lerp(-Math.PI * 0.43, 0.10 * Math.sin(time * 1.8), raising);
    this.pin.rotation.z = 0.13 * (1 - raising);
    if (!worker.root.visible || worker.alarmed(time, player)) return;
    worker.pose(time, -0.15 * (1 - raising), 0.13 + (1 - raising) * 0.57 * grip, 0.10 * grip * (1 - raising));
    for (const side of [0, 1] as const) {
      const clip = this.pin.localToWorld(new THREE.Vector3(side ? -0.21 : 0.21, 0.028, 0.035));
      worker.reach(side, clip, grip);
    }
  }
}

interface CafeSeat {
  person: Villager;
  cup: THREE.Object3D;
  saucer: THREE.Vector3;
  gaze: number;
  phase: number;
}

export class VillageLifeView {
  readonly root = new THREE.Group();
  get people() { return [...this.pair, ...this.seats.map(s => s.person), this.laundry.worker]; }
  private readonly cafe = new THREE.Group();
  private readonly board = new THREE.Group();
  private readonly seats: CafeSeat[];
  private readonly checkers: THREE.Mesh[];
  private readonly pair: Villager[];
  private readonly laundry: Clothesline;
  private readonly tablePosition: THREE.Vector3;
  private readonly streetLines: readonly ResidentSpeech[];
  private readonly cafeLines: readonly ResidentSpeech[];
  private readonly welcome: ResidentSpeech;
  private previousTime = -1;
  private arrivedAt = -Infinity;
  private approachClear = true;

  constructor(village: Village, terrain: Terrain, models: THREE.Group, props: ValleyProps) {
    this.root.name = 'Village daily life';
    this.cafe.name = 'Kıraathane · çay and tavla';
    this.cafe.rotation.y = CAFE.facing;
    this.root.add(this.cafe);
    const x = village.x + CAFE.x, z = village.z + CAFE.z;
    this.cafe.position.set(x, terrain.heightAt(x, z), z);
    const cafeGround = (along: number, out: number) => {
      const p = cafePoint(along, out);
      return terrain.heightAt(village.x + p.x, village.z + p.z) - this.cafe.position.y;
    };
    for (const table of CAFE_TABLES) props.place(this.cafe, 'Cafe tea table', table.x, cafeGround(table.x, table.z), table.z);
    const game = CAFE_TABLES[1];
    const tea = CAFE_TABLES[0];
    this.board.position.set(game.x, cafeGround(game.x, game.z) + 0.80, game.z);
    this.cafe.add(this.board);
    this.checkers = tavlaBoard(this.board);
    this.tablePosition = this.board.getWorldPosition(new THREE.Vector3());
    const places = [
      { name: 'Ismail', voice: 'hasan', x: game.x - 0.78, z: game.z, yaw: Math.PI / 2, cupX: game.x - 0.21, cupZ: game.z - 0.23, phase: 6 },
      { name: 'Riza', voice: 'emre', x: game.x + 0.78, z: game.z, yaw: -Math.PI / 2, cupX: game.x + 0.20, cupZ: game.z + 0.23, phase: 15 },
      { name: 'Cemal', voice: 'hasan', x: tea.x, z: tea.z - 0.73, yaw: 0, cupX: tea.x + 0.14, cupZ: tea.z - 0.17, phase: 3 },
    ] as const;
    this.seats = places.map(({ name, voice, x, z, yaw, cupX, cupZ, phase }, i) => {
      const person = new Villager(models, name, voice, true);
      const ground = cafeGround(x, z);
      person.root.position.set(x, ground + 0.035, z);
      person.root.rotation.y = yaw;
      props.place(this.cafe, 'Wooden stool', x, ground + 0.035, z, yaw - 0.2);
      this.cafe.add(person.root);
      const table = CAFE_TABLES[i < 2 ? 1 : 0];
      const top = cafeGround(table.x, table.z) + 0.81;
      mesh(this.cafe, new THREE.CylinderGeometry(0.064, 0.053, 0.011, 16), ceramic, cupX, top, cupZ);
      const cup = modelPart(models, 'Tea glass').clone();
      this.cafe.add(cup);
      const saucer = new THREE.Vector3(cupX, top + 0.05, cupZ);
      cup.position.copy(saucer);
      return { person, cup, saucer, gaze: 0, phase };
    });
    props.place(this.cafe, 'Wooden stool', tea.x - 0.71, cafeGround(tea.x - 0.71, tea.z), tea.z, 0.8);

    this.pair = [new Villager(models, 'Nermin', 'zeynep'), new Villager(models, 'Selma', 'ayse')];
    for (const [i, person] of this.pair.entries()) {
      const x = village.x - 7.9 + i * 1.16, z = village.z + 8.35 - i * 0.19;
      person.root.position.set(x, terrain.heightAt(x, z) + 0.035, z);
      person.root.rotation.y = Math.atan2(1.16, -0.19) + i * Math.PI;
      this.root.add(person.root);
    }
    const worker = new Villager(models, 'Emine', 'ayse');
    this.laundry = new Clothesline(worker, props, village, terrain);
    this.root.add(this.laundry.root);
    this.streetLines = ['Pazara indin mi bugün?', 'İndim, domatesler pek güzel bu sene.', 'Akşama uğra, bir çay içeriz.']
      .map((line, i) => planResidentSpeech(this.pair[i % 2].voice, line, 'explain'));
    this.cafeLines = ['Hadi İsmail, sıra sende.', 'Gördün mü zarı? Yine düştü şeş beş.']
      .map((line, i) => planResidentSpeech(this.seats[i].person.voice, line, 'explain'));
    this.welcome = planResidentSpeech(this.seats[2].person.voice, 'Günaydın komşu, çay hazır.', 'explain');
  }

  witnessTheft(at: Vec3Like, time: number, obstacles: Obstacles): void {
    for (const person of this.people) {
      if (person.root.visible && person.root.parent?.visible && witnessesTheft(person.root.getWorldPosition(new THREE.Vector3()), at, obstacles)) person.alarmAt = time;
    }
  }

  update(hour: number, time: number, dt: number, player: Vec3Like, camera: THREE.Vector3, sounds: VillageSounds): void {
    if (time < this.previousTime - 0.25) {
      this.arrivedAt = -Infinity;
      for (const person of this.people) person.alarmAt = -Infinity;
      this.approachClear = true;
    }
    const previous = time > this.previousTime && time - this.previousTime < 0.25 ? this.previousTime : time;
    this.previousTime = time;
    const near = Math.hypot(camera.x - this.cafe.position.x, camera.z - this.cafe.position.z);
    this.cafe.visible = near < 135;
    if (this.cafe.visible) this.atCafe(hour, time, previous, dt, player, sounds);
    this.inSquare(hour, time, previous, camera, sounds, player);
    this.laundry.update(hour, time, camera, player);
  }

  private atCafe(hour: number, time: number, previous: number, dt: number, player: Vec3Like, sounds: VillageSounds): void {
    const open = hour >= 6.35 && hour < 20.5;
    const distance = Math.hypot(player.x - this.cafe.position.x, player.z - this.cafe.position.z);
    const arriving = open && player.x < this.cafe.position.x - 4 && distance < 15;
    if (distance > 22) this.approachClear = true;
    if (arriving && this.approachClear) {
      this.arrivedAt = time;
      this.approachClear = false;
    }
    const sinceArrival = time - this.arrivedAt;
    const attention = arriving ? smoothstep(sinceArrival, 0, 0.7) * (1 - smoothstep(sinceArrival, 4.0, 7.8)) : 0;
    const cafeTime = time % 22;
    const crossing = (period: number, offset: number) => Math.floor((previous - offset) / period) < Math.floor((time - offset) / period);

    for (const [i, seat] of this.seats.entries()) {
      const { person, cup, saucer, phase } = seat;
      person.root.visible = open;
      cup.position.copy(saucer);
      cup.rotation.set(0, 0, 0);
      if (!open || person.alarmed(time, player)) continue;
      const p = person.root.getWorldPosition(new THREE.Vector3());
      const yaw = CAFE.facing + person.root.rotation.y;
      const toward = Math.atan2(player.x - p.x, player.z - p.z);
      seat.gaze = lerp(seat.gaze, clamp(angleDelta(yaw, toward), -1.18, 1.18) * attention, 1 - Math.exp(-dt * 6));
      const welcomeAge = sinceArrival - 0.72;
      const chatAge = cafeTime - (i ? 12.2 : 10);
      const cue = i === 2 ? this.welcome : this.cafeLines[i];
      const age = i === 2 ? welcomeAge : chatAge;
      const speaking = age >= 0 && age < cue.duration;
      const voiceStarts = i === 2 ? previous < this.arrivedAt + 0.72 && welcomeAge >= 0 : crossing(22, i ? 12.2 : 10);
      if (voiceStarts && speaking) sounds.voice({ x: p.x, y: p.y + 1.13, z: p.z }, person.voice, cue);

      const playAt = i === 0 ? 0.7 : 8.3;
      const play = cafeTime - playAt;
      const reaching = i < 2 ? smoothstep(play, 0, 0.69) - smoothstep(play, 1.60, 2.38) : 0;
      const sip = (time + 22 - phase) % 22;
      const lifting = smoothstep(sip, 0.45, 1.12) - smoothstep(sip, 1.92, 2.73);
      const drinking = smoothstep(sip, 0, 0.52) - smoothstep(sip, 2.78, 3.24);
      const lean = 0.13 + reaching * 0.22 + drinking * (1 - lifting) * 0.22;
      person.pose(time + i * 1.4, seat.gaze, lean, 0, speaking ? cue : undefined, age);

      if (i < 2) {
        const checker = this.checkers[i];
        const side = i ? 1 : -1;
        const forward = Math.floor(time / 22) % 2 === 0;
        const slide = smoothstep(play, 0.69, 1.6);
        checker.position.x = side * lerp(0.211, 0.131, forward ? slide : 1 - slide);
        checker.position.y = 0.048 + Math.sin(slide * Math.PI) * 0.041;
        checker.position.z = 0.102 * side;
        const target = checker.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.039, 0));
        person.reach(1, target, reaching);
        if (crossing(22, playAt + 1.6)) sounds.work('tavla', this.tablePosition);
      }

      if (drinking > 0 && reaching === 0) {
        const target = this.cafe.localToWorld(saucer.clone());
        const mouth = person.root.localToWorld(new THREE.Vector3(0.052, 1.17, 0.13));
        target.lerp(mouth, lifting);
        person.reach(1, target, drinking);
        if (sip >= 0.45 && sip < 2.73) {
          cup.position.copy(this.cafe.worldToLocal(person.handPosition(1)));
          cup.rotation.x = -0.30 * lifting;
        }
        if (crossing(22, phase + 1.43)) sounds.work('teaSip', target);
      }
    }
  }

  private inSquare(hour: number, time: number, previous: number, camera: THREE.Vector3, sounds: VillageSounds, player: Vec3Like): void {
    const cycle = (time + 5) % 17;
    const offsets = [1.0, 3.5, 7.2];
    for (const [index, person] of this.pair.entries()) {
      const p = person.root.position;
      person.root.visible = hour >= 6.6 && hour < 19.6 && Math.hypot(camera.x - p.x, camera.z - p.z) < 100;
      if (!person.root.visible || person.alarmed(time, player)) continue;
      const turn = offsets.findIndex((start, i) => i % 2 === index && cycle >= start && cycle - start < this.streetLines[i].duration);
      const line = this.streetLines[turn];
      const age = line ? cycle - offsets[turn] : 0;
      person.pose(time + index, Math.sin(time * 0.85 + index) * 0.13, 0.03, 0, line, age);
      if (line && age < time - previous) sounds.voice({ x: p.x, y: p.y + 1.52, z: p.z }, person.voice, line);
    }
  }
}

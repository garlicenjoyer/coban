import * as THREE from 'three';
import { isThursday } from '../economy/calendar';
import type { ShopId } from '../economy/economy';
import { modelMesh, modelPart } from '../render/gameModel';
import { toonMaterial, toonRamp } from '../render/toon';
import type { BoxProp, Layout, MapProps } from './mapTypes';
import type { Terrain } from './terrain';
import type { ValleyProps } from './valleyProps';
import { villagePaving } from './villageGround';
import { CAFE, COFFEEHOUSE, MEMORIAL, MOSQUE, SQUARE_TREE } from './villagePlan';

type Village = NonNullable<Layout['village']>;
type SignedShop = Exclude<ShopId, 'dealer' | 'vet'>;

const signs: Record<SignedShop, [text: string, bg: string, fg: string]> = {
  dairy: ['SÜT VE PEYNİR', '#456568', '#eccfaa'],
  bakkal: ['BAKKAL', '#834f43', '#ebd4a7'],
  usta: ['OTO TAMİR', '#4d5a52', '#e5c89a'],
  kahvehane: ['KIRAATHANE', '#536957', '#edd6ac'],
  muze: ['MÜZE', '#80634c', '#efdcaf'],
};

const houses = ['Whitewashed house', 'Ochre house', 'Rose house', 'Stone house'];
const plank = toonMaterial({ color: 0x6a4b37 });
const hardware = toonMaterial({ color: 0x4e4639 });

function signTexture([text, bg, fg]: [string, string, string]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#f0d5b3';
  for (let i = 0; i < 35; i++) {
    const y = (i * 39.7) % 128;
    ctx.globalAlpha = 0.055 + (i % 5) * 0.018;
    ctx.beginPath();
    ctx.moveTo(5 + (i * 147.7) % 460, y);
    ctx.lineTo(40 + (i * 197.3) % 470, y + Math.sin(i * 5) * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ctx.fillStyle = fg;
  ctx.lineWidth = 3;
  ctx.strokeRect(11, 11, 490, 106);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(19, 18, 474, 92);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 56px Georgia, serif';
  ctx.fillText(text, 256, 68, 402);
  for (const x of [37, 475]) {
    ctx.beginPath();
    ctx.moveTo(x, 56);
    ctx.lineTo(x + 7, 64);
    ctx.lineTo(x, 72);
    ctx.lineTo(x - 7, 64);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSign(id: SignedShop): THREE.Group {
  const broad = id === 'kahvehane';
  const w = broad ? 3.86 : 2.56;
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(w + 0.11, 0.55, 0.08), plank);
  board.castShadow = true;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.48), toonMaterial({ map: signTexture(signs[id]) }));
  face.position.z = 0.045;
  face.receiveShadow = true;
  g.add(board, face);
  const chain = new THREE.CylinderGeometry(0.016, 0.019, 0.21, 6);
  for (const x of [-w * 0.37, w * 0.37]) {
    const link = new THREE.Mesh(chain, hardware);
    link.position.set(x, 0.34, 0);
    g.add(link);
  }
  g.position.set(0, broad ? 2.16 : 2.18, broad ? 2.65 : 0.57);
  g.name = `Painted ${id} sign`;
  return g;
}

function memorialInscription(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 384;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#706253';
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, 732, 348);
  for (const [label, size, y] of [['MUSTAFA KEMAL', 47, 106], ['ATATÜRK', 102, 198], ['1881–1938', 46, 302]] as const) {
    ctx.font = `bold ${size}px Georgia, serif`;
    ctx.fillStyle = '#e0d4bc';
    ctx.fillText(label, 384, y + 2);
    ctx.fillStyle = '#3d352a';
    ctx.fillText(label, 384, y);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const lettering = new THREE.Mesh(new THREE.PlaneGeometry(1.03, 0.515),
    toonMaterial({ map, color: 0xe1d8c7, transparent: true, depthWrite: false }));
  lettering.name = 'Mustafa Kemal Atatürk · 1881–1938';
  lettering.position.set(0, 0.86, 0.482);
  lettering.receiveShadow = true;
  return lettering;
}

const terraceRuns = [
  [[-44, 16], [-34, 16]], [[-14.5, 40.1], [0, 40.1]],
  [[8, 22], [16, 22]], [[16, 22], [16, 13]], [[26, 32], [38, 32]],
  [[-35, -31], [-31, -31]], [[-15, -30], [-9, -30]], [[6, -33], [17, -33]],
  [[20, -29], [29, -29]], [[40, -46], [31, -46]], [[47, -30], [49, -25]],
  [[53, -33], [62, -33]], [[65, -14], [65, 4]], [[45, 11], [57, 11]], [[57, 11], [65, 4]],
] as const;

export class VillageView {
  readonly root = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];
  private lanternFinish?: THREE.MeshToonMaterial;
  private vet?: THREE.Object3D;

  constructor(
    private readonly terrain: Terrain,
    private readonly plan: Village,
    map: MapProps,
    private readonly library: THREE.Group,
    private readonly props: ValleyProps,
  ) {
    this.root.name = 'Village';
    this.root.add(villagePaving(terrain, plan));

    let dwelling = 0;
    for (const p of map.props) {
      if (p.kind === 'box' && p.role === 'building') {
        const dx = p.x - plan.x, dz = p.z - plan.z;
        if (dx === COFFEEHOUSE[0] && dz === COFFEEHOUSE[1]) {
          this.place('Coffeehouse', dx, dz, CAFE.facing).scale.set(p.hz / 6, p.hy / 1.8, p.hx / 4);
        } else if (dx === MOSQUE[0] && dz === MOSQUE[1]) {
          this.place('Village mosque', dx, dz, Math.PI / 2);
        } else {
          this.house(p, dwelling++);
        }
      }
      if (p.kind === 'cyl' && p.role === 'minaret') this.place('Mosque minaret', p.x - plan.x, p.z - plan.z, 0);
      if (p.kind === 'cyl' && p.role === 'villageTree') {
        this.place('Square plane tree', p.x - plan.x, p.z - plan.z, p.x * 0.25)
          .scale.setScalar(p.height / SQUARE_TREE.height);
      }
      if (p.kind === 'cyl' && p.role === 'villageFountain') this.place('Square fountain', p.x - plan.x, p.z - plan.z, Math.PI / 8);
    }

    for (const s of plan.shops ?? []) this.market(s);
    this.square();
    this.terraces();
    this.pennants(-19.5, 1.3, -5.8, -7.6);
    this.pennants(5.9, 8.7, 17.1, 3.7);
  }

  private place(name: string, dx: number, dz: number, yaw: number): THREE.Object3D {
    const node = modelPart(this.library, name).clone();
    const x = this.plan.x + dx, z = this.plan.z + dz;
    node.position.set(x, this.terrain.heightAt(x, z), z);
    node.rotation.y = yaw;
    this.root.add(node);
    return node;
  }

  private house(p: BoxProp, i: number): void {
    const x = p.x - this.plan.x, z = p.z - this.plan.z;
    const quarter = Math.round(Math.atan2(-x, -z) / (Math.PI / 2));
    const yaw = quarter * (Math.PI / 2);
    const look = [0, 3, 2, 1, 0, 1, 2, 1, 3, 2, 1, 0, 3, 0, 1, 2][i % 16];
    const building = this.place(houses[look], x, z, yaw);
    const side = quarter % 2 !== 0;
    building.scale.set((side ? p.hz : p.hx) / 4, p.hy / 2.25, (side ? p.hx : p.hz) / 3.5);
    const facade = (side ? p.hx : p.hz) + 0.52;
    if (i < 8 || i % 3 === 0) {
      const offset = (i % 2 ? -1 : 1) * 2.75;
      const dx = x + Math.sin(yaw) * facade + Math.cos(yaw) * offset;
      const dz = z + Math.cos(yaw) * facade - Math.sin(yaw) * offset;
      this.place('Geranium pot', dx, dz, i * 1.5).scale.setScalar(0.78 + i % 3 * 0.14);
      if (i % 3 === 1) this.place('Geranium pot', dx + Math.cos(yaw) * 0.72, dz - Math.sin(yaw) * 0.72, 2.1)
        .scale.setScalar(0.63);
    }
    if (i === 5 || i === 8 || i === 10) {
      const offset = i === 8 ? 2.48 : -2.42;
      const dx = x + Math.sin(yaw) * (facade - 0.42) + Math.cos(yaw) * offset;
      const dz = z + Math.cos(yaw) * (facade - 0.42) - Math.sin(yaw) * offset;
      this.place('Woven rug', dx, dz, yaw).position.y += p.hy * 0.62;
    }
  }

  private market(s: NonNullable<Village['shops']>[number]): void {
    const dx = s.x - this.plan.x, dz = s.z - this.plan.z;
    const stand = this.place(`Market ${s.id}`, dx, dz, s.facing);
    if (s.id === 'vet') {
      this.vet = stand;
      this.vet.visible = false;
      return;
    }
    if (s.id === 'dealer') {
      this.props.place(stand, 'Wooden stool', 0.83, 0, -0.55, -0.2);
      return;
    }
    stand.add(makeSign(s.id));
    if (s.id === 'kahvehane') {
      this.props.place(stand, 'Cafe tea counter', 0, 1.001, -1.02);
      for (const x of [-3.86, 3.86]) {
        const pot = modelPart(this.library, 'Geranium pot').clone();
        pot.position.set(x, 0, 2.03);
        pot.scale.setScalar(1.10);
        stand.add(pot);
      }
      const rug = modelPart(this.library, 'Woven rug').clone();
      rug.position.set(-3.31, 0.68, -1.15);
      rug.rotation.y = 0.11;
      stand.add(rug);
    }
  }

  private square(): void {
    const { x, z, facing } = MEMORIAL;
    const memorial = this.place('Atatürk memorial', x, z, facing);
    const bust = modelMesh(memorial, 'Atatürk carved bust');
    // Soft light keeps the shallow carving around the eyes and mouth visible.
    const gradientMap = toonRamp().clone();
    gradientMap.minFilter = gradientMap.magFilter = THREE.LinearFilter;
    gradientMap.needsUpdate = true;
    bust.material = toonMaterial({ vertexColors: true, gradientMap });
    memorial.add(memorialInscription());
    for (const [x, z, facing] of [[-10.6, -9.1, 0.12], [-13.9, -6.38, Math.PI / 2], [7.74, -6.84, -0.70],
      [9.22, 9.6, Math.PI], [-6.65, 11.2, Math.PI], [-34.7, 15.4, 0.30], [33.94, -19.6, 0.52]]) {
      this.place('Stone and timber bench', x, z, facing);
    }
    this.lanternFinish = toonMaterial({ vertexColors: true, emissive: 0xf0aa58, emissiveIntensity: 0.08 });
    for (const [x, z, turn, shines] of [[-19.8, 6.9, 0.42, true], [13.7, 8.5, Math.PI, true], [7.2, -8.2, -0.87, true],
      [-13.7, 38.6, Math.PI * 0.50, true], [-33.2, 13.7, 0.08, false], [-8.6, -17.1, 0.82, false],
      [29.1, -14.4, 0.94, false], [42.2, -19.4, 0.46, false], [-17.8, -3.1, 1.35, false]] as const) {
      const lamp = this.place('Street lamp', x, z, turn);
      const glass = modelMesh(lamp, 'Lantern panes');
      glass.material = this.lanternFinish;
      glass.castShadow = false;
      if (!shines) continue;
      const light = new THREE.PointLight(0xffc180, 0, 13, 1.65);
      light.position.set(0, 2.10, 0.51);
      light.visible = false;
      lamp.add(light);
      this.lights.push(light);
    }
    for (const [x, z, size] of [[5.8, -7.8, 0.77], [8.03, -4.74, 0.81], [-10.85, -10.2, 0.84],
      [-33.6, 14.85, 0.90], [-33.6, 3.25, 0.59], [12.7, -11.0, 0.94], [-14.4, 8.5, 0.73], [25.6, 22.0, 0.95]]) {
      this.place('Geranium pot', x, z, (x + z) * 0.58).scale.setScalar(size);
    }
  }

  private terraces(): void {
    const template = modelMesh(this.library, 'Terrace masonry painted mesh');
    const segments = terraceRuns.map(([[ax, az], [bx, bz]]) => {
      const length = Math.hypot(bx - ax, bz - az);
      return { ax, az, bx, bz, length, count: Math.ceil(length / 2.35) };
    });
    const masonry = new THREE.InstancedMesh(template.geometry, template.material,
      segments.reduce((total, run) => total + run.count, 0));
    masonry.name = 'Terrace retaining walls';
    const stamp = new THREE.Object3D();
    let index = 0;
    for (const { ax, az, bx, bz, length, count } of segments) {
      stamp.rotation.y = Math.atan2(az - bz, bx - ax);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const x = this.plan.x + THREE.MathUtils.lerp(ax, bx, t);
        const z = this.plan.z + THREE.MathUtils.lerp(az, bz, t);
        stamp.position.set(x, this.terrain.heightAt(x, z) - 0.015, z);
        stamp.scale.set(length / count / 2.34, 0.84 + (i % 3) * 0.075, 1);
        stamp.updateMatrix();
        masonry.setMatrixAt(index++, stamp.matrix);
      }
    }
    masonry.castShadow = masonry.receiveShadow = true;
    this.root.add(masonry);
  }

  private pennants(ax: number, az: number, bx: number, bz: number): void {
    const start = new THREE.Vector3(this.plan.x + ax, 0, this.plan.z + az);
    const end = new THREE.Vector3(this.plan.x + bx, 0, this.plan.z + bz);
    start.y = this.terrain.heightAt(start.x, start.z) + 4.30;
    end.y = this.terrain.heightAt(end.x, end.z) + 4.28;
    const point = (t: number) => start.clone().lerp(end, t).add(new THREE.Vector3(0, -0.65 * Math.sin(t * Math.PI), 0));
    for (const top of [start, end]) {
      const h = 4.48;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.087, h, 7), plank);
      pole.position.copy(top);
      pole.position.y -= h * 0.41;
      pole.castShadow = true;
      this.root.add(pole);
    }
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => point(i / 16)));
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 22, 0.013, 5, false), hardware);
    this.root.add(cable);
    const positions: number[] = [], colors: number[] = [];
    const palette = [0xc89e72, 0xb06b59, 0x809183, 0xddc9a0, 0x7d8c96];
    const face = (indices: number[], vertices: THREE.Vector3[], c: THREE.Color) => {
      for (const i of indices) {
        positions.push(...vertices[i].toArray());
        colors.push(c.r, c.g, c.b);
      }
    };
    const distance = start.distanceTo(end);
    const count = Math.floor(distance / 0.83);
    const side = new THREE.Vector3(end.z - start.z, 0, start.x - end.x).normalize();
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const a = point(t - 0.26 / distance), b = point(t + 0.26 / distance);
      const fold = point(t).addScaledVector(side, -0.10);
      const tail = point(t + 0.04 / distance).addScaledVector(side, Math.sin(i * 7) * 0.085);
      tail.y -= 0.34 + i % 3 * 0.065;
      const color = new THREE.Color(palette[(i + (ax > 0 ? 1 : 0)) % palette.length]);
      const vertices = [a, fold, b, tail];
      face([0, 1, 3], vertices, color);
      face([1, 2, 3], vertices, color.multiplyScalar(0.81));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const cloth = new THREE.Mesh(geo, toonMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    cloth.castShadow = true;
    this.root.add(cloth);
  }

  update(hour: number, day: number, eye: THREE.Vector3): void {
    if (this.vet) this.vet.visible = isThursday(day);
    const fade = Math.max(
      1 - THREE.MathUtils.smoothstep(hour, 5.1, 6.7),
      THREE.MathUtils.smoothstep(hour, 18.7, 20.0),
    );
    const near = Math.hypot(eye.x - this.plan.x, eye.z - this.plan.z) < 160;
    for (const light of this.lights) {
      light.visible = near && fade > 0;
      light.intensity = fade * 6.6;
    }
    if (this.lanternFinish) this.lanternFinish.emissiveIntensity = 0.08 + fade * 0.98;
  }
}

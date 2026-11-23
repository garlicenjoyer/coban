// The shepherd's cottage: a small lime-washed stone house in the style of the hill villages
// above Selçuk. Stone plinth and corner quoins, terracotta hip roof with a chimney (smoking),
// wooden door and shuttered windows with geranium boxes, a vine pergola over the porch with
// a bench and a table set for çay, clay pots, a woodpile and a lantern by the door.

import * as THREE from 'three';
import { toonMaterial } from '../render/toon';
import type { Terrain } from './terrain';
import type { ValleyProps } from './valleyProps';
import { layout } from './map';

const C = {
  lime: 0xf5ecdc,
  stone: 0xcab697,
  stoneDark: 0xb19c7d,
  roof: 0xc9673f,
  ridge: 0xa9522f,
  wood: 0x8b5a36,
  woodDark: 0x63401f,
  shutter: 0x6f9a8e,
  glass: 0x34444b,
  vine: 0x6f9a4c,
  vineDark: 0x557c3c,
  grape: 0x6b4a7a,
  pot: 0xc07549,
  geranium: 0xd9473d,
  leaf: 0x5f8e46,
};

/** Hip roof over a w×d rectangle, eaves at y=0, ridge along x at height h. */
function hipRoof(w: number, d: number, h: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const r = Math.max(0, hw - hd); // ridge half-length
  const v = {
    a: [-hw, 0, -hd],
    b: [hw, 0, -hd],
    c: [hw, 0, hd],
    d: [-hw, 0, hd],
    r0: [-r, h, 0],
    r1: [r, h, 0],
  };
  const tris = [
    [v.a, v.r0, v.r1],
    [v.a, v.r1, v.b], // front (north, -z)
    [v.c, v.r1, v.r0],
    [v.c, v.r0, v.d], // back
    [v.b, v.r1, v.c], // east hip
    [v.d, v.r0, v.a], // west hip
  ];
  const pos: number[] = [];
  for (const t of tris) for (const p of t) pos.push(...p);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class HouseView {
  readonly root = new THREE.Group();
  readonly teaTable: THREE.Object3D;
  private puffs: { mesh: THREE.Mesh; phase: number }[] = [];
  private chimneyTop = new THREE.Vector3();

  constructor(terrain: Terrain, props: ValleyProps) {
    const hs = layout.house;
    const y0 = terrain.heightAt(hs.x, hs.z);
    this.root.position.set(hs.x, y0, hs.z);
    this.root.name = 'house';
    const W = hs.hx * 2;
    const D = hs.hz * 2;
    const H = hs.wallHeight;
    const front = -hs.hz; // north face z
    const m = (c: number) => toonMaterial({ color: c });
    const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, parent: THREE.Object3D = this.root) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c));
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const cyl = (rt: number, rb: number, h: number, c: number, x: number, y: number, z: number, seg = 10) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m(c));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.root.add(mesh);
      return mesh;
    };

    // Body: stone plinth, lime-washed walls, quoins.
    box(W + 0.3, 0.5, D + 0.3, C.stone, 0, 0.25, 0);
    box(W, H - 0.5, D, C.lime, 0, 0.5 + (H - 0.5) / 2, 0);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (let i = 0; i < 4; i++) {
          const long = i % 2 === 0;
          box(long ? 0.5 : 0.3, 0.32, long ? 0.3 : 0.5, i % 2 ? C.stoneDark : C.stone, sx * (W / 2 - (long ? 0.2 : 0.1)), 0.75 + i * 0.5, sz * (D / 2 - (long ? 0.1 : 0.2)));
        }

    // Roof with eaves, ridge cap and fascia.
    const roof = new THREE.Mesh(hipRoof(W + 0.9, D + 0.9, 1.45), m(C.roof));
    roof.position.y = H;
    roof.castShadow = true;
    this.root.add(roof);
    box(Math.max(0.2, W + 0.9 - (D + 0.9)) + 0.1, 0.12, 0.16, C.ridge, 0, H + 1.45, 0);
    box(W + 0.95, 0.08, D + 0.95, C.lime, 0, H - 0.02, 0);

    // Chimney (smoke puffs animate in update()).
    box(0.62, 1.7, 0.62, C.stone, W / 2 - 1.1, H + 1.0, D / 2 - 0.9);
    box(0.8, 0.1, 0.8, C.stoneDark, W / 2 - 1.1, H + 1.88, D / 2 - 0.9);
    this.chimneyTop.set(W / 2 - 1.1, H + 2.0, D / 2 - 0.9);
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0xf2eee6, transparent: true, opacity: 0.6, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), smokeMat.clone());
      this.root.add(puff);
      this.puffs.push({ mesh: puff, phase: i / 7 });
    }

    // Door (north face, centre) with frame, planks and a little step.
    box(1.25, 2.2, 0.08, C.woodDark, 0, 0.5 + 1.05, front - 0.02);
    box(1.0, 2.0, 0.08, C.wood, 0, 0.5 + 1.0, front - 0.06);
    for (const px of [-0.25, 0.25]) box(0.03, 1.9, 0.02, C.woodDark, px, 1.5, front - 0.11);
    box(0.08, 0.08, 0.06, 0xd8b45a, 0.36, 1.45, front - 0.12); // latch
    box(1.4, 0.14, 0.5, C.stone, 0, 0.07, front - 0.35); // step

    // Windows: frame, glass, open shutters, sill and geranium box.
    const addWindow = (x: number, z: number, faceX: number, faceZ: number, flowers: boolean) => {
      const g = new THREE.Group();
      g.position.set(x, 1.65, z);
      g.rotation.y = Math.atan2(faceX, faceZ);
      this.root.add(g);
      box(0.95, 1.05, 0.06, C.woodDark, 0, 0, 0.02, g);
      box(0.75, 0.85, 0.06, C.glass, 0, 0, 0.05, g);
      box(0.06, 0.85, 0.07, C.woodDark, 0, 0, 0.07, g);
      for (const s of [-1, 1]) {
        const sh = box(0.42, 0.9, 0.04, C.shutter, s * 0.72, 0, 0.12, g);
        sh.rotation.y = s * 0.35;
        for (let k = -2; k <= 2; k++) box(0.38, 0.03, 0.02, 0x5b8278, s * 0.72, k * 0.16, 0.15, g).rotation.y = s * 0.35;
      }
      box(1.05, 0.08, 0.22, C.stone, 0, -0.56, 0.1, g);
      if (flowers) {
        box(0.85, 0.18, 0.2, C.pot, 0, -0.44, 0.22, g);
        for (let k = 0; k < 6; k++) {
          const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), m(k % 2 ? C.geranium : C.leaf));
          f.position.set(-0.35 + k * 0.14, -0.3 + (k % 2) * 0.05, 0.24);
          g.add(f);
        }
      }
    };
    addWindow(-2.1, front - 0.01, 0, -1, true);
    addWindow(2.1, front - 0.01, 0, -1, true);
    addWindow(-W / 2 - 0.01, 0.3, -1, 0, false);
    addWindow(W / 2 + 0.01, -0.3, 1, 0, false);

    // Pergola (çardak) over the porch: posts, beams, slats, vine and grapes.
    const pd = hs.porchDepth;
    const postZ = front - pd + 0.3;
    for (const px of [-2.5, 2.5]) {
      cyl(0.1, 0.12, 2.5, C.wood, px, 1.25, postZ);
      cyl(0.08, 0.08, 0.2, C.woodDark, px, 2.55, front - 0.15);
    }
    for (const px of [-2.5, 2.5]) box(0.12, 0.14, pd + 0.2, C.wood, px, 2.5, front - pd / 2);
    box(5.4, 0.14, 0.14, C.wood, 0, 2.58, postZ);
    for (let i = 0; i < 7; i++) box(0.08, 0.06, pd, C.woodDark, -2.4 + i * 0.8, 2.66, front - pd / 2);
    const r = (s: number) => {
      const x = Math.sin(s * 127.1) * 43758.5453;
      return x - Math.floor(x);
    };
    for (let i = 0; i < 26; i++) {
      const v = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 + r(i) * 0.3, 0), m(i % 3 ? C.vine : C.vineDark));
      v.position.set(-2.6 + r(i + 3) * 5.2, 2.75 + r(i + 7) * 0.25, front - 0.2 - r(i + 11) * (pd - 0.1));
      v.scale.y = 0.55;
      v.castShadow = true;
      this.root.add(v);
    }
    for (let i = 0; i < 5; i++) {
      const gr = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), m(C.grape));
      gr.position.set(-2 + i * 1, 2.38, front - 0.8 - (i % 2) * 1.1);
      gr.scale.y = 1.6;
      this.root.add(gr);
    }

    props.place(this.root, 'Porch bench', -2.2, 0, front - 0.47);
    this.teaTable = props.place(this.root, 'Porch tea table', 1.6, 0, front - 1.5);

    // Clay pots of geraniums by the door, a lantern, the woodpile.
    for (const [px, pz, s] of [
      [-0.95, front - 0.45, 1],
      [0.95, front - 0.45, 0.85],
      [-3.1, front - 2.6, 1.15],
    ] as const) {
      cyl(0.18 * s, 0.13 * s, 0.32 * s, C.pot, px, 0.16 * s, pz, 10);
      for (let k = 0; k < 5; k++) {
        const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09 * s, 0), m(k < 3 ? C.geranium : C.leaf));
        f.position.set(px + Math.cos(k * 1.3) * 0.1 * s, 0.38 * s + (k % 2) * 0.06, pz + Math.sin(k * 1.3) * 0.1 * s);
        this.root.add(f);
      }
    }
    const lantern = box(0.16, 0.24, 0.16, 0x2b2622, 0.85, 2.1, front - 0.12);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), toonMaterial({ color: 0xffd27a, emissive: 0xffb84a, emissiveIntensity: 0.6 }));
    glow.position.copy(lantern.position);
    this.root.add(glow);

    const logs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.85, 8).rotateZ(Math.PI / 2), m(0x9c7148), 36);
    const d = new THREE.Object3D();
    let k = 0;
    for (let row = 0; row < 6; row++)
      for (let i = 0; i < 6; i++) {
        d.position.set(W / 2 + 0.6, 0.12 + row * 0.2, 0.5 - 1.25 + i * 0.5 + (row % 2) * 0.12);
        d.rotation.set(0, Math.PI / 2 + (r(k) - 0.5) * 0.15, 0);
        d.updateMatrix();
        logs.setMatrixAt(k++, d.matrix);
      }
    logs.castShadow = true;
    this.root.add(logs);
  }

  /** Chimney smoke: soft puffs drifting up and away with the breeze. */
  update(time: number): void {
    for (const p of this.puffs) {
      const t = (time * 0.12 + p.phase) % 1;
      p.mesh.position.set(this.chimneyTop.x + t * 2.2 + Math.sin(t * 6 + p.phase * 9) * 0.25, this.chimneyTop.y + t * 5.5, this.chimneyTop.z - t * 0.8);
      p.mesh.scale.setScalar(0.5 + t * 2.2);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t) * Math.min(1, t * 6);
    }
  }
}

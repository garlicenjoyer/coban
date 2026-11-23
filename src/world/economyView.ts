// What the economy looks like in the world (GDD feature 6): the shopfronts on the village
// square (a counter under an awning, a painted sign, the goods), the wild herb patches
// (cropped once picked), and at the ağıl the milking stand and the churn.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/toon';
import type { Sim } from '../sim';
import { isThursday } from '../economy/calendar';
import { yardLayout } from './homestead';
import { activeMap, layout } from './map';
import type { Terrain } from './terrain';
import type { ValleyProps } from './valleyProps';
import { modelMesh } from '../render/gameModel';

const SIGNS: Record<string, { text: string; bg: string; fg: string; awning: [number, number] }> = {
  dairy: { text: 'SÜT · PEYNİR', bg: '#2f5d7a', fg: '#f4efe4', awning: [0xf2ece0, 0x3f7aa0] },
  bakkal: { text: 'BAKKAL', bg: '#7a2f2f', fg: '#f4efe4', awning: [0xf2ece0, 0xb5402f] },
  usta: { text: 'OTO · TAMİR', bg: '#3b3b3b', fg: '#ffd98a', awning: [0xe8d9b0, 0x5a5a5a] },
  kahvehane: { text: 'KAHVEHANE', bg: '#3d5a3a', fg: '#f4efe4', awning: [0xf2ece0, 0x4f7448] },
  muze: { text: 'MÜZE', bg: '#5a4630', fg: '#f4e2b0', awning: [0xe8d9b0, 0x8a6a40] },
};

function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = fg;
  g.lineWidth = 3;
  g.strokeRect(5, 5, 246, 54);
  g.fillStyle = fg;
  g.font = 'bold 30px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const HERB_LOOK: Record<string, { leaf: number; flower: number; r: number; h: number }> = {
  thyme: { leaf: 0x6f7f4f, flower: 0xb48ac8, r: 0.45, h: 0.28 },
  sage: { leaf: 0x93a38a, flower: 0x8f86c4, r: 0.55, h: 0.45 },
  tea: { leaf: 0x8a9a6a, flower: 0xe8c64a, r: 0.4, h: 0.5 },
};

export class EconomyView {
  readonly root = new THREE.Group();
  private herbs: { id: string; group: THREE.Group; flowers: THREE.Object3D }[] = [];
  private churnFull: THREE.Group;
  private churnEmpty: THREE.Group;
  private finds: THREE.Group[] = [];
  private vetTable: THREE.Group | null = null;
  private goat: THREE.Group;
  readonly press: THREE.Group;
  readonly milkingStation: THREE.Object3D;
  private wheels: THREE.Mesh[] = [];

  constructor(private t: Terrain, private readonly props: ValleyProps) {
    this.root.name = 'economy';
    this.shopfronts();
    this.herbPatches();
    const { churnFull, churnEmpty, station } = this.milking();
    this.milkingStation = station;
    this.churnFull = churnFull;
    this.churnEmpty = churnEmpty;
    this.press = this.cheesePress();
    this.goat = this.makeGoat();
    // Up to four finds glinting in the mud at the ruin.
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const thing = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 10), toonMaterial({ color: 0xb08a4a, emissive: 0x3a2a10 }));
      thing.position.y = 0.03;
      thing.rotation.z = 0.3;
      const glint = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: 0xfff4c0, transparent: true, opacity: 0.9, depthWrite: false }));
      glint.name = 'glint';
      glint.position.y = 0.18;
      const mud = new THREE.Mesh(new THREE.CircleGeometry(0.3, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5a4632, transparent: true, opacity: 0.5, depthWrite: false }));
      mud.position.y = 0.02;
      g.add(mud, thing, glint);
      g.visible = false;
      this.root.add(g);
      this.finds.push(g);
    }
  }

  /** The cheese press by the cottage and its shelf of ageing wheels (shown once bought). */
  private cheesePress(): THREE.Group {
    const p = yardLayout(layout).press;
    const g = new THREE.Group();
    g.position.set(p.x, this.ground(p.x, p.z), p.z);
    this.props.place(g, 'Cheese press and shelf', 0, 0, 0);
    for (let i = 0; i < 8; i++) {
      const wheel = this.props.place(g, 'Cheese wheel', 1, (i < 4 ? 0.49 : 0.99) + 0.062, -0.50 + (i % 4) * 0.33, i * 0.57);
      const mesh = modelMesh(wheel, 'Cheese wheel mesh');
      mesh.material = mesh.material.clone();
      this.wheels.push(mesh);
    }
    g.visible = false;
    this.root.add(g);
    return g;
  }

  private ground(x: number, z: number): number {
    return this.t.heightAt(x, z);
  }

  private shopfronts(): void {
    for (const s of layout.village?.shops ?? []) {
      if (s.id === 'dealer') {
        this.dealerCorner(s);
        continue;
      }
      if (s.id === 'vet') {
        this.vetTable = this.vetCorner(s);
        continue;
      }
      const look = SIGNS[s.id];
      const g = new THREE.Group();
      g.name = `shop ${s.id}`;
      // Local frame: +z is the way the shopkeeper looks (toward the square).
      g.position.set(s.x, this.ground(s.x, s.z), s.z);
      g.rotation.y = s.facing;
      const wood = toonMaterial({ color: 0x7a5636 });
      if (s.id !== 'kahvehane') {
        const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.95, 0.7), wood);
        counter.position.set(0, 0.47, -1.1);
        const top = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.06, 0.8), toonMaterial({ color: 0x9a7048 }));
        top.position.set(0, 0.97, -1.1);
        g.add(counter, top);
      }
      // A striped awning on two poles.
      const stripes = 7;
      for (let i = 0; i < stripes; i++) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(3.2 / stripes, 0.03, 1.7), toonMaterial({ color: look.awning[i % 2] }));
        strip.position.set(-1.6 + (i + 0.5) * (3.2 / stripes), 2.45, -1.2);
        strip.rotation.x = 0.28;
        g.add(strip);
      }
      for (const sx of [-1.5, 1.5]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5), wood);
        pole.position.set(sx, 1.1, -0.45);
        g.add(pole);
      }
      // The painted sign above the awning.
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: signTexture(look.text, look.bg, look.fg) }));
      // Every counter stands 1.5 m out from its shop's wall: the sign hangs just in front of it.
      sign.position.set(0, 2.85, -1.44);
      sign.rotation.x = -0.05;
      g.add(sign);
      this.goods(s.id, g);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
      });
      this.root.add(g);
    }
  }

  /** Round the back of the kahvehane: an upturned crate, a stool, a lamp on a nail. Nothing to read. */
  private dealerCorner(s: { x: number; z: number; facing: number }): void {
    const g = new THREE.Group();
    g.position.set(s.x, this.ground(s.x, s.z), s.z);
    g.rotation.y = s.facing;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.6), toonMaterial({ color: 0x6b4e32 }));
    crate.position.set(0, 0.35, -1.0);
    const stool = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.35), toonMaterial({ color: 0x5a3a20 }));
    stool.position.set(0.7, 0.22, -1.3);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffcf7a }));
    lamp.position.set(-0.4, 2.0, -1.45);
    g.add(crate, stool, lamp);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.root.add(g);
  }

  /** The vet's folding table under a parasol, there on Thursdays. */
  private vetCorner(s: { x: number; z: number; facing: number }): THREE.Group {
    const g = new THREE.Group();
    g.position.set(s.x, this.ground(s.x, s.z), s.z);
    g.rotation.y = s.facing;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.7), toonMaterial({ color: 0xe8e4da }));
    top.position.set(0, 0.8, -0.9);
    g.add(top);
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, -1.2], [0.6, -1.2]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), toonMaterial({ color: 0x8a8f96 }));
      leg.position.set(x, 0.4, z);
      g.add(leg);
    }
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.22), toonMaterial({ color: 0x5a3a20 }));
    bag.position.set(-0.3, 0.95, -0.9);
    const bottles = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8), toonMaterial({ color: 0x6b4a20 }));
    bottles.position.set(0.35, 0.92, -0.85);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 5), toonMaterial({ color: 0x8a8f96 }));
    pole.position.set(0, 1.2, -0.9);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.5, 10, 1, true), toonMaterial({ color: 0xd9473d, side: THREE.DoubleSide }));
    shade.position.set(0, 2.45, -0.9);
    g.add(bag, bottles, pole, shade);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    g.visible = false;
    this.root.add(g);
    return g;
  }

  /** Mehmet's runaway goat: brown, with a bell and a broken rope. */
  private makeGoat(): THREE.Group {
    const g = new THREE.Group();
    const coat = toonMaterial({ color: 0x7a4e2a });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.7), coat);
    body.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.28), coat);
    head.position.set(0, 0.8, 0.42);
    const horns = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 4).rotateX(-0.5), toonMaterial({ color: 0x3a3330 }));
    horns.position.set(0, 0.96, 0.36);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), toonMaterial({ color: 0xc9a14a }));
    bell.position.set(0, 0.6, 0.38);
    g.add(body, head, horns, bell);
    for (const [x, z] of [[-0.11, 0.25], [0.11, 0.25], [-0.11, -0.25], [0.11, -0.25]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4), coat);
      leg.position.set(x, 0.2, z);
      g.add(leg);
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    g.visible = false;
    this.root.add(g);
    return g;
  }

  /** A little of what each shop sells, on and around its counter. */
  private goods(id: string, g: THREE.Group): void {
    const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, toonMaterial({ color }));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    if (id === 'dairy') {
      for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.17, 0.2, 0.55, 10), 0xc9ccd0, -1.4 - i * 0.05, 0.28, -0.4 + i * 0.45);
      for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 12), 0xf4efe4, -0.7 + i * 0.4, 1.06, -1.1);
    } else if (id === 'bakkal') {
      const crate = new THREE.BoxGeometry(0.5, 0.3, 0.4);
      const fill = [0xd94a3a, 0xe8b23a, 0x6f9a4c, 0xd98a3a];
      fill.forEach((c, i) => {
        add(crate, 0x9a7048, -0.75 + i * 0.5, 1.15, -1.1);
        add(new THREE.BoxGeometry(0.44, 0.08, 0.34), c, -0.75 + i * 0.5, 1.32, -1.1);
      });
      add(new THREE.CylinderGeometry(0.25, 0.28, 0.6, 8), 0xc8ad7a, 1.5, 0.3, -0.6);
    } else if (id === 'usta') {
      for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.32, 0.1, 6, 14).rotateX(Math.PI / 2), 0x2b2b2b, 1.6, 0.1 + i * 0.2, -0.5);
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), 0xb5402f, -1.6, 0.45, -0.5);
      add(new THREE.BoxGeometry(0.4, 0.25, 0.3), 0x5a6f80, 0.4, 1.12, -1.1);
    } else if (id === 'kahvehane') {
      this.props.place(g, 'Cafe tea counter', 0, 1.001, -1.1);
      for (const [x, angle] of [[-1.2, -0.24], [1.2, 0.45]]) {
        this.props.place(g, 'Cafe tea table', x, 0, 0.90, angle);
        this.props.place(g, 'Wooden stool', x - 0.54, 0, 0.98, 0.49);
        this.props.place(g, 'Wooden stool', x + 0.54, 0, 0.80, -0.66);
      }
    } else {
      for (const [x, z] of [
        [-1.2, 0.9],
        [1.2, 0.9],
      ]) {
        add(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 12), 0x9a7048, x, 0.72, z);
        add(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 6), 0x5a3a20, x, 0.35, z);
        add(new THREE.CylinderGeometry(0.03, 0.025, 0.08, 8), 0xb5402f, x + 0.1, 0.78, z);
        for (const dx of [-0.55, 0.55]) add(new THREE.BoxGeometry(0.35, 0.45, 0.35), 0x7a5636, x + dx, 0.22, z);
      }
    }
  }

  private herbPatches(): void {
    for (const h of activeMap().herbs ?? []) {
      const look = HERB_LOOK[h.kind];
      const g = new THREE.Group();
      g.position.set(h.x, this.ground(h.x, h.z), h.z);
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(look.r, 0).scale(1.2, look.h / look.r, 1.2), toonMaterial({ color: look.leaf }));
      leaves.position.y = look.h * 0.5;
      // Nine flower heads, merged into one mesh.
      const heads: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        heads.push(new THREE.SphereGeometry(0.05, 5, 4).translate(Math.cos(a) * look.r * 0.7, look.h * 0.95 + (i % 3) * 0.04, Math.sin(a) * look.r * 0.7));
      }
      const flowers = new THREE.Mesh(mergeGeometries(heads)!, toonMaterial({ color: look.flower }));
      g.add(leaves, flowers);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      this.root.add(g);
      this.herbs.push({ id: h.id, group: g, flowers });
    }
  }

  private milking(): { churnFull: THREE.Group; churnEmpty: THREE.Group; station: THREE.Object3D } {
    const y = yardLayout(layout);
    const station = this.props.place(this.root, 'Milking station', y.milking.x, this.ground(y.milking.x, y.milking.z), y.milking.z);
    const cy = this.ground(y.churn.x, y.churn.z);
    const full = new THREE.Group();
    full.position.set(y.churn.x, cy, y.churn.z);
    this.root.add(full);
    this.props.place(full, 'Milk churn', 0, 0, 0);
    this.props.place(full, 'Churn lid', 0, 0.823, 0);
    const empty = new THREE.Group();
    empty.position.set(y.churn.x, cy + 0.85, y.churn.z);
    empty.rotation.x = Math.PI;
    this.root.add(empty);
    this.props.place(empty, 'Milk churn', 0, 0, 0);
    return { churnFull: full, churnEmpty: empty, station };
  }

  update(sim: Sim): void {
    const day = sim.tasks.day;
    for (const h of this.herbs) {
      const picked = sim.herbsPicked.get(h.id) === day;
      h.group.scale.setScalar(picked ? 0.6 : 1);
      h.flowers.visible = !picked;
    }
    this.churnFull.visible = sim.economy.churn > 0;
    this.churnEmpty.visible = sim.economy.churn <= 0;
    const t = performance.now() / 1000;
    this.finds.forEach((g, i) => {
      const f = sim.finds[i];
      g.visible = !!f;
      if (!f) return;
      g.position.set(f.x, this.ground(f.x, f.z), f.z);
      const glint = g.getObjectByName('glint')!;
      glint.rotation.y = t * 2 + i;
      glint.scale.setScalar(0.6 + 0.5 * Math.max(0, Math.sin(t * 3 + i * 1.7)));
    });
    const e = sim.economy;
    if (this.vetTable) this.vetTable.visible = isThursday(sim.tasks.day);
    const goat = sim.goat;
    this.goat.visible = !!goat;
    if (goat) {
      this.goat.position.set(goat.x, this.ground(goat.x, goat.z), goat.z);
      this.goat.rotation.y = Math.sin(t * 0.3) * 0.8;
    }
    this.press.visible = e.has('press');
    this.wheels.forEach((w, i) => {
      const c = e.cheese[i];
      w.visible = !!c;
      if (c) ((w.material as THREE.MeshToonMaterial).color as THREE.Color).setHex(c.age >= 3 ? 0xe8d49a : 0xf4efe0);
    });
  }
}

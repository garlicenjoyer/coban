// What the shepherd builds and leaves on the land, and the signs he reads there:
//   build sites (stakes and string, or Uncle Ahmet's fallen hut; walls rising as the work
//   goes on), the hut and its
//   stone fold, cairns, the salt lick, sling stones in flight, the halter rope, and the
//   wolves' signs (bones, scat, a tuft of wool, prints).

import * as THREE from 'three';
import { toonMaterial } from '../render/toon';
import { modelMesh, modelPart } from '../render/gameModel';
import { HalterRope } from './halterRope';
import type { Sim } from '../sim';
import { hutRuinWalls } from './homestead';
import { layout } from './map';
import type { WorkKind } from './works';

const stoneMat = toonMaterial({ color: 0xc9b89a });
const darkStone = toonMaterial({ color: 0xa8977c });
const roofMat = toonMaterial({ color: 0xb8653f });
const woodMat = toonMaterial({ color: 0x7a5636 });
const stakeMat = toonMaterial({ color: 0xd9b27a });
const boneMat = toonMaterial({ color: 0xece3cf });
const scatMat = toonMaterial({ color: 0x5a4a3a });
const woolMat = toonMaterial({ color: 0xf5efe2 });
const stringMat = new THREE.LineBasicMaterial({ color: 0xf4efe4, transparent: true, opacity: 0.8 });

export class WorksView {
  readonly root = new THREE.Group();
  private sites = new Map<WorkKind, { stakes: THREE.Group; built: THREE.Group | null; rising: THREE.Group | null }>();
  private cairnGroup = new THREE.Group();
  private cairnCount = -1;
  private readonly salt: THREE.Object3D;
  private readonly stones: THREE.InstancedMesh;
  private readonly rope: HalterRope;
  private readonly stonePose = new THREE.Object3D();
  private simRef: Sim | null = null;

  constructor(private sim: () => Sim, fieldProps: THREE.Group) {
    this.root.name = 'Works';
    this.root.add(this.cairnGroup);
    this.salt = modelPart(fieldProps, 'Salt lick').clone();
    this.salt.visible = false;
    this.root.add(this.salt);
    const stone = modelMesh(fieldProps, 'Sling stone mesh');
    this.stones = new THREE.InstancedMesh(stone.geometry, stone.material, 8);
    this.stones.count = 0;
    this.stones.frustumCulled = false;
    this.root.add(this.stones);
    this.rope = new HalterRope(fieldProps);
    this.root.add(this.rope.mesh);
  }

  private ground(x: number, z: number): number {
    return this.sim().terrain.heightAt(x, z);
  }

  /** Rebuild everything for a fresh sim (reset). */
  private rebuild(): void {
    const sim = this.sim();
    this.simRef = sim;
    for (const v of this.sites.values()) {
      this.root.remove(v.stakes);
      if (v.built) this.root.remove(v.built);
      if (v.rising) this.root.remove(v.rising);
    }
    this.sites.clear();
    for (const site of sim.works.sites) {
      const stakes = this.stakesFor(site.id);
      this.root.add(stakes);
      this.sites.set(site.id, { stakes, built: null, rising: null });
    }
    this.cairnCount = -1;
    this.buildSigns();
  }

  private signs: THREE.Group | null = null;

  private buildSigns(): void {
    if (this.signs) this.root.remove(this.signs);
    const g = new THREE.Group();
    g.name = 'Wolf signs';
    for (const sg of layout.wolfSigns) {
      const y = this.ground(sg.x, sg.z);
      const at = new THREE.Group();
      at.position.set(sg.x, y, sg.z);
      if (sg.kind === 'bones') {
        // A ribcage and a skull, bleached.
        for (let i = 0; i < 5; i++) {
          const rib = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 4, 10, Math.PI), boneMat);
          rib.position.set(-0.35 + i * 0.16, 0.02, 0);
          rib.rotation.set(0, Math.PI / 2, 0);
          at.add(rib);
        }
        const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), boneMat);
        skull.scale.set(1.4, 0.8, 0.9);
        skull.position.set(0.6, 0.08, 0.15);
        at.add(skull);
      } else if (sg.kind === 'scat') {
        for (let i = 0; i < 3; i++) {
          const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.1, 2, 6), scatMat);
          m.rotation.z = Math.PI / 2;
          m.rotation.y = i * 0.9;
          m.position.set(i * 0.07, 0.03, i * 0.05);
          at.add(m);
        }
      } else if (sg.kind === 'tuft') {
        // Wool caught on a thorn twig.
        const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.6, 4), woodMat);
        twig.position.y = 0.3;
        twig.rotation.z = 0.3;
        const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), woolMat);
        tuft.position.set(0.08, 0.45, 0);
        tuft.scale.set(1.3, 0.8, 1);
        at.add(twig, tuft);
      } else {
        // Prints: a short trail of paw marks.
        const paw = new THREE.CircleGeometry(0.12, 8).rotateX(-Math.PI / 2);
        for (let i = 0; i < 6; i++) {
          const m = new THREE.Mesh(paw, new THREE.MeshBasicMaterial({ color: 0x3b2c20, transparent: true, opacity: 0.6, depthWrite: false }));
          const px = i * 0.55;
          const pz = (i % 2 ? 0.18 : -0.18);
          m.position.set(px, this.ground(sg.x + px, sg.z + pz) - y + 0.03, pz);
          at.add(m);
        }
        at.rotation.y = 0.7;
      }
      g.add(at);
    }
    this.signs = g;
    this.root.add(g);
  }

  /**
   * Uncle Ahmet's fallen hut: broken walls with ragged tops, the roof beams down inside,
   * the door flat in the grass, rubble round the walls and the fold tumbled to heaps.
   * Children named 'rubble' shrink away as the mending goes on.
   */
  private fallenHut(): THREE.Group {
    const g = new THREE.Group();
    g.name = "Uncle Ahmet's fallen hut";
    const h = layout.works.hut;
    const f = layout.works.fold;
    const y = this.ground(h.x, h.z);
    const r = (k: number) => ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1;
    let k = 0;
    // Walls in courses of rough blocks, each a little higher or lower than the last.
    for (const w of hutRuinWalls(h)) {
      const along = w.hx > w.hz ? 'x' : 'z';
      const len = 2 * Math.max(w.hx, w.hz);
      const n = Math.max(1, Math.round(len / 0.55));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const hh = Math.max(0.25, w.height * (0.75 + r(++k) * 0.45));
        const bx = along === 'x' ? len / n + 0.02 : w.hx * 2 + 0.04;
        const bz = along === 'z' ? len / n + 0.02 : w.hz * 2 + 0.04;
        const m = new THREE.Mesh(new THREE.BoxGeometry(bx, hh, bz), r(++k) > 0.5 ? stoneMat : darkStone);
        m.position.set(w.x + (along === 'x' ? t * len : 0), y + hh / 2 - 0.1, w.z + (along === 'z' ? t * len : 0));
        m.rotation.y = (r(++k) - 0.5) * 0.08;
        m.castShadow = m.receiveShadow = true;
        m.name = 'wall';
        g.add(m);
      }
    }
    // Two roof beams down inside, one still leaning on the back wall.
    const beam = (x: number, z: number, len: number, rx: number, ry: number, rz: number, lift: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, len, 6), woodMat);
      m.position.set(x, y + lift, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      m.name = 'rubble';
      g.add(m);
    };
    beam(h.x - 0.6, h.z - 0.2, 3.6, 0, 0.3, 1.15, 0.85);
    beam(h.x + 0.4, h.z + 0.5, 3.2, Math.PI / 2, 0, 0.25, 0.15);
    // His door, flat in the grass by the doorway.
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 1.6), woodMat);
    door.position.set(h.x + h.hx + 1.6, this.ground(h.x + h.hx + 1.6, h.z + 1.3) + 0.03, h.z + 1.3);
    door.rotation.y = 0.35;
    door.name = 'rubble';
    g.add(door);
    // Fallen stones round the walls, mostly where the south wall came down.
    const stone = (x: number, z: number, s: number) => {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0).scale(1, 0.7, 1), r(++k) > 0.5 ? stoneMat : darkStone);
      m.position.set(x, this.ground(x, z) + s * 0.4, z);
      m.rotation.set(r(++k) * 3, r(++k) * 3, 0);
      m.castShadow = true;
      m.name = 'rubble';
      g.add(m);
    };
    for (let i = 0; i < 26; i++) {
      const a = r(++k) * Math.PI * 2;
      const south = i < 12;
      const x = south ? h.x + (r(++k) - 0.2) * h.hx * 1.6 : h.x + Math.cos(a) * (h.hx + 0.5 + r(++k) * 1.2);
      const z = south ? h.z + h.hz + 0.4 + r(++k) * 1.4 : h.z + Math.sin(a) * (h.hz + 0.5 + r(++k) * 1.2);
      // Keep the doorway clear.
      if (x > h.x + h.hx && Math.abs(z - h.z) < 0.9) continue;
      stone(x, z, 0.14 + r(++k) * 0.16);
    }
    // The fold: its walls tumbled to low heaps along the old lines, gaps where they spilled.
    const heapLine = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.round(len / 0.7);
      for (let i = 0; i <= n; i++) {
        if (r(++k) < 0.22) continue;
        const t = i / n;
        const x = ax + (bx - ax) * t + (r(++k) - 0.5) * 0.5;
        const z = az + (bz - az) * t + (r(++k) - 0.5) * 0.5;
        stone(x, z, 0.16 + r(++k) * 0.14);
      }
    };
    heapLine(f.xMin, f.zMin, f.xMax, f.zMin);
    heapLine(f.xMin, f.zMax, f.xMax, f.zMax);
    heapLine(f.xMin, f.zMin, f.xMin, f.zMax);
    return g;
  }

  private stakesFor(id: WorkKind): THREE.Group {
    if (id === 'hut' && layout.works.hut.ruined) return this.fallenHut();
    const g = new THREE.Group();
    const corners: [number, number][] = [];
    if (id === 'hut') {
      const h = layout.works.hut;
      const f = layout.works.fold;
      corners.push([h.x - h.hx, h.z - h.hz], [h.x + h.hx, h.z - h.hz], [h.x + h.hx, h.z + h.hz], [h.x - h.hx, h.z + h.hz]);
      corners.push([f.xMax, f.zMin], [f.xMin, f.zMin], [f.xMin, f.zMax], [f.xMax, f.zMax]);
    } else {
      const c = layout.works.cistern;
      for (let k = 0; k < 6; k++) corners.push([c.x + Math.cos((k / 6) * Math.PI * 2) * (c.radius + 0.3), c.z + Math.sin((k / 6) * Math.PI * 2) * (c.radius + 0.3)]);
    }
    const pts: THREE.Vector3[] = [];
    corners.forEach(([x, z], i) => {
      const y = this.ground(x, z);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.8, 5), stakeMat);
      st.position.set(x, y + 0.4, z);
      g.add(st);
      pts.push(new THREE.Vector3(x, y + 0.55, z));
      // The hut's string loops close per outline.
      if (id === 'hut' && (i === 3 || i === 7)) {
        pts.push(pts[0].clone());
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.splice(0)), stringMat));
      }
    });
    if (pts.length) {
      pts.push(pts[0].clone());
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), stringMat));
    }
    // A pile of stones waiting by the site.
    const site = this.sim().works.site(id);
    for (let k = 0; k < 7; k++) {
      const r = 0.16 + (k % 3) * 0.06;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), k % 2 ? stoneMat : darkStone);
      const x = site.x + 0.9 + (k % 3) * 0.32;
      const z = site.z - 0.6 + Math.floor(k / 3) * 0.3;
      m.position.set(x, this.ground(x, z) + r * 0.7 + (k > 4 ? 0.2 : 0), z);
      m.rotation.set(k, k * 2, 0);
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }

  /** The finished structure, scaled vertically by `rise` (0..1) while it is being built. */
  private structure(id: WorkKind): THREE.Group {
    const g = new THREE.Group();
    if (id === 'hut') {
      const h = layout.works.hut;
      const f = layout.works.fold;
      const y = this.ground(h.x, h.z);
      const walls = new THREE.Mesh(new THREE.BoxGeometry(h.hx * 2, h.wallHeight, h.hz * 2), stoneMat);
      walls.position.set(h.x, y + h.wallHeight / 2 - 0.1, h.z);
      walls.castShadow = walls.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(h.hx, h.hz) * 1.08, 1.2, 4, 1), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(h.hx / Math.hypot(h.hx, h.hz) * 1.5, 1, h.hz / Math.hypot(h.hx, h.hz) * 1.5);
      roof.position.set(h.x, y + h.wallHeight + 0.5, h.z);
      roof.castShadow = true;
      roof.name = 'late';
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.85), woodMat);
      door.position.set(h.x + h.hx + 0.02, y + 0.75, h.z);
      door.name = 'late';
      g.add(walls, roof, door);
      // Fold walls, rough-topped.
      const wall = (ax: number, az: number, bx: number, bz: number) => {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(len / 3));
        for (let i = 0; i < n; i++) {
          const x0 = ax + ((bx - ax) * i) / n;
          const z0 = az + ((bz - az) * i) / n;
          const x1 = ax + ((bx - ax) * (i + 1)) / n;
          const z1 = az + ((bz - az) * (i + 1)) / n;
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;
          const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.55, Math.abs(x1 - x0)), f.wall * (0.9 + ((i * 37) % 10) / 50), Math.max(0.55, Math.abs(z1 - z0))), i % 2 ? stoneMat : darkStone);
          m.position.set(mx, this.ground(mx, mz) + f.wall / 2 - 0.1, mz);
          m.castShadow = m.receiveShadow = true;
          g.add(m);
        }
      };
      wall(f.xMin, f.zMin, f.xMax, f.zMin);
      wall(f.xMin, f.zMax, f.xMax, f.zMax);
      wall(f.xMin, f.zMin, f.xMin, f.zMax);
    } else {
      // The cistern basin itself is drawn by the water view; add a little stone lip and a gutter post.
      const c = layout.works.cistern;
      const y = this.ground(c.x, c.z);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(c.radius + 0.1, 0.14, 5, 16), darkStone);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(c.x, y + 0.4, c.z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 5), woodMat);
      post.position.set(c.x - c.radius - 0.3, y + 0.8, c.z);
      const gutter = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.16), woodMat);
      gutter.position.set(c.x - c.radius + 0.1, y + 1.55, c.z);
      gutter.rotation.z = -0.25;
      g.add(lip, post, gutter);
    }
    return g;
  }

  private cairn(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const y = this.ground(x, z);
    let h = 0;
    for (let k = 0; k < 5; k++) {
      const r = 0.32 - k * 0.05;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), k % 2 ? darkStone : stoneMat);
      m.scale.y = 0.6;
      m.position.set((k % 2 ? 0.03 : -0.03), y + h + r * 0.5, 0);
      m.rotation.y = k * 1.3;
      m.castShadow = true;
      h += r * 0.95;
      g.add(m);
    }
    g.position.set(x, 0, z);
    return g;
  }

  update(hand: THREE.Vector3, halter: THREE.Vector3): void {
    const sim = this.sim();
    if (sim !== this.simRef || this.sites.size !== sim.works.sites.length) this.rebuild();

    for (const site of sim.works.sites) {
      const v = this.sites.get(site.id)!;
      if (site.built && !v.built) {
        if (v.rising) this.root.remove(v.rising);
        v.rising = null;
        v.built = this.structure(site.id);
        this.root.add(v.built);
        v.stakes.visible = false;
      } else if (!site.built && site.progress > 0) {
        if (!v.rising) {
          v.rising = this.structure(site.id);
          this.root.add(v.rising);
        }
        // Mending: the new walls rise from where his still stand, and the rubble is used up.
        if (site.repair) {
          for (const o of v.stakes.children) {
            if (o.name === 'wall') o.visible = false;
            else o.scale.setScalar(Math.max(0.001, 1 - site.progress));
          }
        }
        // Walls rise course by course.
        const k = site.repair ? 0.4 + 0.6 * site.progress : Math.max(0.05, site.progress);
        v.rising.scale.y = k;
        // The roof and door go on last.
        for (const o of v.rising.children) if (o.name === 'late') o.visible = site.progress > 0.85;
        v.rising.position.y = (1 - k) * this.ground(site.x, site.z);
      }
    }

    if (sim.works.cairns.length !== this.cairnCount) {
      this.cairnCount = sim.works.cairns.length;
      this.cairnGroup.clear();
      for (const c of sim.works.cairns) this.cairnGroup.add(this.cairn(c.x, c.z));
    }

    const s = sim.saltLick;
    this.salt.visible = !!s;
    if (s) this.salt.position.set(s.x, this.ground(s.x, s.z), s.z);

    const d = this.stonePose;
    this.stones.count = Math.min(8, sim.stones.length);
    for (let i = 0; i < this.stones.count; i++) {
      const st = sim.stones[i];
      d.position.set(st.x, st.y, st.z);
      d.rotation.set(st.t * 17, st.t * 12 + i, st.t * 8);
      d.updateMatrix();
      this.stones.setMatrixAt(i, d.matrix);
    }
    this.stones.instanceMatrix.needsUpdate = true;

    this.rope.mesh.visible = !!sim.ledSheep;
    if (sim.ledSheep) this.rope.update(hand, halter);
  }
}

// Detailed environment: gnarled olive trees, cypresses, scattered pines, boulders, dry-stone
// walls, the temple ruin, maquis shrubs and drifting clouds.
// Everything solid here has a matching collider prop in testMap.ts; this file only draws.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/toon';
import { cloudOffset, sway, type SwayOptions } from '../render/wind';
import { rng } from './noise';
import type { Terrain } from './terrain';
import { layout, type BoxProp, type CylProp, type MapProps } from './map';

const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => {
  p.deleteAttribute('uv');
  return p;
}))!;

/** A gnarled olive: a split, leaning trunk and a broad, lumpy silver-green crown. */
function oliveGeometries(seed: number) {
  const r = rng(seed);
  const trunk: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(0.12, 0.22, 1.6, 6);
    g.translate(0, 0.8, 0);
    g.rotateZ((r() - 0.5) * 0.7);
    g.rotateX((r() - 0.5) * 0.5);
    g.rotateY(r() * Math.PI * 2);
    trunk.push(g);
  }
  const crown: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.IcosahedronGeometry(0.7 + r() * 0.5, 0);
    g.scale(1, 0.62, 1);
    const a = r() * Math.PI * 2;
    const d = r() * 1.1;
    g.translate(Math.cos(a) * d, 1.7 + r() * 0.7, Math.sin(a) * d);
    crown.push(g);
  }
  return { trunk: merge(trunk), crown: merge(crown) };
}

function cypressGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.9 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.8) * (1 - t * 0.35), t));
  }
  return new THREE.LatheGeometry(pts, 8);
}

function pineCanopy(): THREE.BufferGeometry {
  const lower = new THREE.ConeGeometry(1, 0.62, 7).translate(0, -0.19, 0);
  const upper = new THREE.ConeGeometry(0.7, 0.55, 7).translate(0, 0.22, 0);
  return merge([lower, upper]);
}

function shrubGeometry(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(0.45 + r() * 0.3, 0);
    g.scale(1, 0.7, 1);
    g.translate((r() - 0.5) * 0.8, 0.3 + r() * 0.2, (r() - 0.5) * 0.8);
    parts.push(g);
  }
  return merge(parts);
}

// How each kind of tree takes the wind. Trunk and crown share a bend so they stay joined;
// only the leaves flutter. Olive leaves are grey-green above and silver below, so a gust
// turns a grove silver as it passes.
const OLIVE: SwayOptions = { key: 'olive', bend: 0.11, refHeight: 3 };
const OLIVE_CROWN: SwayOptions = { ...OLIVE, key: 'oliveCrown', flutter: 0.035, shimmerColor: 0xdfe5d6, shimmer: 0.5 };
const CYPRESS: SwayOptions = { key: 'cypress', bend: 0.32, refHeight: 10, flutter: 0.02 };
const PINE: SwayOptions = { key: 'pine', bend: 0.22, refHeight: 12 };
const PINE_CANOPY: SwayOptions = { ...PINE, key: 'pineCanopy', flutter: 0.04 };
const SHRUB: SwayOptions = { key: 'shrub', bend: 0.05, refHeight: 1, flutter: 0.02, shimmerColor: 0xb9c79a, shimmer: 0.25 };

function swaying(mat: THREE.Material, o: SwayOptions): THREE.Material {
  sway(mat, o);
  return mat;
}

export class EnvironmentView {
  readonly root = new THREE.Group();
  private clouds: THREE.Group;

  constructor(t: Terrain, map: MapProps) {
    this.root.name = 'environment';
    const cyl = (role: CylProp['role']) => map.props.filter((p): p is CylProp => p.kind === 'cyl' && p.role === role);
    const boxes = (role: BoxProp['role']) => map.props.filter((p): p is BoxProp => p.kind === 'box' && p.role === role);
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    const r = rng(4242);
    const add = (m: THREE.Object3D, shadow = true) => {
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = shadow;
          o.receiveShadow = true;
        }
      });
      this.root.add(m);
    };

    // ---- olive trees (two shape variants, instanced)
    const olives = cyl('olive');
    for (let v = 0; v < 2; v++) {
      const g = oliveGeometries(11 + v * 7);
      const mine = olives.filter((_, i) => i % 2 === v);
      const trunk = new THREE.InstancedMesh(g.trunk, swaying(toonMaterial({ color: 0x7e6a55 }), OLIVE), mine.length);
      const crown = new THREE.InstancedMesh(g.crown, swaying(toonMaterial({ color: 0x9aab7c }), OLIVE_CROWN), mine.length);
      mine.forEach((p, i) => {
        d.position.set(p.x, p.y, p.z);
        d.rotation.set(0, r() * Math.PI * 2, 0);
        d.scale.setScalar(p.height / 2.6);
        d.updateMatrix();
        trunk.setMatrixAt(i, d.matrix);
        crown.setMatrixAt(i, d.matrix);
        crown.setColorAt(i, col.setHSL(0.21 + r() * 0.04, 0.2 + r() * 0.08, 0.52 + r() * 0.06));
      });
      add(trunk);
      add(crown);
    }

    // ---- cypresses
    const cyp = cyl('cypress');
    const cypMesh = new THREE.InstancedMesh(cypressGeometry(), swaying(toonMaterial({ color: 0x4f7448 }), CYPRESS), cyp.length);
    cyp.forEach((p, i) => {
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(0, r() * 6, 0);
      d.scale.set(1, p.height, 1);
      d.updateMatrix();
      cypMesh.setMatrixAt(i, d.matrix);
    });
    add(cypMesh);

    // ---- scattered pines (same silhouette as the forest)
    const pines = cyl('pine');
    const pTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.2, 1, 7), swaying(toonMaterial({ color: 0x8a6446 }), PINE), pines.length);
    const pCanopy = new THREE.InstancedMesh(pineCanopy(), swaying(toonMaterial({ color: 0x6e9a5a }), PINE_CANOPY), pines.length);
    pines.forEach((p, i) => {
      d.rotation.set(0, 0, 0);
      d.position.set(p.x, p.y + p.height / 2, p.z);
      d.scale.set(p.radius, p.height, p.radius);
      d.updateMatrix();
      pTrunk.setMatrixAt(i, d.matrix);
      const ch = p.height * 0.6;
      d.position.set(p.x, p.y + p.height - ch / 2 + 1.5, p.z);
      d.scale.set(2.6, ch, 2.6);
      d.updateMatrix();
      pCanopy.setMatrixAt(i, d.matrix);
    });
    add(pTrunk);
    add(pCanopy);

    // ---- boulders
    const rocks = cyl('rock');
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), toonMaterial({ color: 0xffffff }), rocks.length);
    rocks.forEach((p, i) => {
      d.position.set(p.x, p.y + p.height * 0.35, p.z);
      d.rotation.set(r() * 0.4, r() * 6, r() * 0.4);
      d.scale.set(p.radius * 1.05, p.height * 0.75, p.radius * (0.8 + r() * 0.3));
      d.updateMatrix();
      rockMesh.setMatrixAt(i, d.matrix);
      rockMesh.setColorAt(i, col.setHSL(0.09 + r() * 0.03, 0.12 + r() * 0.08, 0.66 + r() * 0.08));
    });
    add(rockMesh);

    // ---- dry-stone walls: 1 m courses of uneven stones with a capping row
    const walls = boxes('wall');
    const stones: THREE.Matrix4[] = [];
    const stoneCols: number[] = [];
    for (const w of walls) {
      const alongX = w.hx > w.hz;
      const len = (alongX ? w.hx : w.hz) * 2;
      const n = Math.max(1, Math.round(len));
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + (i + 0.5) * (len / n);
        const x = alongX ? w.x + u : w.x;
        const z = alongX ? w.z : w.z + u;
        const gy = t.heightAt(x, z);
        const h = w.hy * 2 * (0.88 + r() * 0.24);
        d.position.set(x, gy + h / 2 - 0.1, z);
        d.rotation.set(0, (r() - 0.5) * 0.06, 0);
        d.scale.set(alongX ? len / n + 0.02 : 0.55, h, alongX ? 0.55 : len / n + 0.02);
        d.updateMatrix();
        stones.push(d.matrix.clone());
        stoneCols.push(r());
        d.position.y = gy + h - 0.06;
        d.scale.set(alongX ? len / n * 0.9 : 0.62, 0.14, alongX ? 0.62 : len / n * 0.9);
        d.rotation.set(0, (r() - 0.5) * 0.2, 0);
        d.updateMatrix();
        stones.push(d.matrix.clone());
        stoneCols.push(-1);
      }
    }
    const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), toonMaterial({ color: 0xffffff }), stones.length);
    stones.forEach((mtx, i) => {
      wallMesh.setMatrixAt(i, mtx);
      const v = stoneCols[i];
      wallMesh.setColorAt(i, v < 0 ? col.setHex(0xb8a68a) : col.setHSL(0.1, 0.18 + v * 0.08, 0.66 + v * 0.08));
    });
    add(wallMesh);

    // ---- the ruin
    const marble = toonMaterial({ color: 0xece4d4 });
    const marbleOld = toonMaterial({ color: 0xd9cfbb });
    const ru = layout.ruins;
    const ry = t.heightAt(ru.x, ru.z);
    const ruin = new THREE.Group();
    ruin.position.set(ru.x, ry, ru.z);
    const step = (w: number, h: number, dz: number, y: number, mat: THREE.Material) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, dz), mat);
      s.position.y = y;
      ruin.add(s);
    };
    step(ru.hx * 2 + 0.8, 0.22, ru.hz * 2 + 0.8, -0.05, marbleOld);
    step(ru.hx * 2, 0.16, ru.hz * 2, 0.12, marble);
    for (const c of cyl('column')) {
      const g = new THREE.Group();
      g.position.set(c.x - ru.x, c.y - ry, c.z - ru.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.25, 16), marbleOld);
      base.position.y = 0.12;
      g.add(base);
      const shaftH = Math.max(0.2, c.height - 0.25 - (c.height > 4 ? 0.35 : 0));
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, shaftH, 16, 1), marble);
      shaft.position.y = 0.25 + shaftH / 2;
      if (c.height < 4) shaft.rotation.set((r() - 0.5) * 0.08, r() * 6, (r() - 0.5) * 0.08); // broken: slightly askew
      g.add(shaft);
      if (c.height > 4) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 1.0), marbleOld);
        cap.position.y = 0.25 + shaftH + 0.15;
        g.add(cap);
      } else {
        // Jagged break: a tilted wedge on top.
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.38, 0.25, 7), marble);
        top.position.y = 0.25 + shaftH + 0.1;
        top.rotation.z = 0.4;
        g.add(top);
      }
      ruin.add(g);
    }
    for (const b of boxes('ruin').slice(1)) {
      const along = b.hx > b.hz ? 'x' : 'z';
      const isDrum = Math.abs(b.hy - 0.4) < 0.01;
      const mesh = isDrum
        ? new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, (along === 'x' ? b.hx : b.hz) * 2, 16), marble)
        : new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), marbleOld);
      if (isDrum) mesh.rotation.set(along === 'z' ? Math.PI / 2 : 0, 0, along === 'x' ? Math.PI / 2 : 0);
      mesh.position.set(b.x - ru.x, b.y - ry, b.z - ru.z);
      ruin.add(mesh);
    }
    for (let i = 0; i < 14; i++) {
      // Small marble fragments scattered in the grass.
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.3 + r() * 0.5, 0.15 + r() * 0.2, 0.25 + r() * 0.4), i % 2 ? marble : marbleOld);
      const a = r() * Math.PI * 2;
      const dd = 7 + r() * 6;
      f.position.set(Math.cos(a) * dd, t.heightAt(ru.x + Math.cos(a) * dd, ru.z + Math.sin(a) * dd) - ry + 0.05, Math.sin(a) * dd);
      f.rotation.set(r() * 0.5, r() * 6, r() * 0.5);
      ruin.add(f);
    }
    add(ruin);

    // ---- maquis shrubs (decoration)
    const shrubColors = [0x5f7f4b, 0x718f56, 0x8c9a6e, 0x6a8a5a];
    for (let v = 0; v < 3; v++) {
      const mine = map.decor.filter((s) => Math.floor(s.v * 3) === v);
      const mesh = new THREE.InstancedMesh(shrubGeometry(100 + v), swaying(toonMaterial({ color: 0xffffff }), SHRUB), mine.length);
      mine.forEach((s, i) => {
        d.position.set(s.x, t.heightAt(s.x, s.z) - 0.05, s.z);
        d.rotation.set(0, s.rot, 0);
        d.scale.set(s.s, s.s * (0.8 + (s.v * 7) % 0.4), s.s);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        mesh.setColorAt(i, col.setHex(shrubColors[Math.floor(s.v * 97) % shrubColors.length]));
      });
      add(mesh);
    }

    // (The çeşme is drawn by the homestead view.)

    // ---- clouds: soft flat puffs drifting high over the valley (the haze tints them)
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0 });
    for (let i = 0; i < 16; i++) {
      const c = new THREE.Group();
      const n = 4 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), cloudMat);
        puff.position.set((k - n / 2) * 22 + r() * 10, r() * 8, (r() - 0.5) * 18);
        puff.scale.set(26 + r() * 18, 12 + r() * 8, 22 + r() * 12);
        c.add(puff);
      }
      const a = r() * Math.PI * 2;
      const dist = 600 + r() * 1300;
      c.position.set(Math.cos(a) * dist, 240 + r() * 200, Math.sin(a) * dist);
      c.rotation.y = r() * 6;
      c.userData.base = c.position.clone();
      this.clouds.add(c);
    }
    this.root.add(this.clouds);
  }

  /** Drift with the wind (the same field their shadows use), wrapping around. */
  update(): void {
    const wrap = (v: number) => ((((v + 2000) % 4000) + 4000) % 4000) - 2000;
    for (const c of this.clouds.children) {
      const b = c.userData.base as THREE.Vector3;
      c.position.x = wrap(b.x + cloudOffset.x);
      c.position.z = wrap(b.z + cloudOffset.y);
    }
  }
}

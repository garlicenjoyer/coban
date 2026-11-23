// Ground dressing (visual only, no colliders, no effect on play): limestone outcrops breaking
// through the steep ground, loose stones scattered over the rough country, and oleanders in
// pink and white flower along the dere's banks.
//
// Outcrops sit low in the ground (no more than ~0.5 m showing), mostly where it is too
// steep for the flock, smaller on the gentler slopes; nothing is placed on roads, in walls or buildings, or at fords.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/toon';
import { sway } from '../render/wind';
import type { GroundZones } from './mapTypes';
import { fbm, rng } from './noise';
import { Surface, type Terrain } from './terrain';

const merge = (parts: THREE.BufferGeometry[]) =>
  mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => {
    p.deleteAttribute('uv');
    return p;
  }))!;

/** A weathered limestone slab: a squashed, jittered lump, flat-topped. */
function slabGeometry(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Same jitter for shared corners, so the lump stays closed.
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.8 + r() * 0.4);
    const k = seen.get(key)!;
    v.multiplyScalar(k);
    v.y = Math.min(v.y, 0.55) * 0.6; // a flat, weathered top
    p.setXYZ(i, v.x * 1.3, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function oleanderGeometry(seed: number): { leaves: THREE.BufferGeometry; flowers: THREE.BufferGeometry } {
  const r = rng(seed);
  const leaves: THREE.BufferGeometry[] = [];
  const flowers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.15 + r() * 0.5;
    const h = 0.55 + r() * 0.9;
    // Narrow upright clumps: oleander grows as a fountain of straight stems.
    const clump = new THREE.IcosahedronGeometry(0.42 + r() * 0.18, 0).scale(0.75, 1.5, 0.75);
    clump.translate(Math.cos(a) * d, h, Math.sin(a) * d);
    leaves.push(clump);
    for (let k = 0; k < 5; k++) {
      const fa = r() * Math.PI * 2;
      const fl = new THREE.IcosahedronGeometry(0.09 + r() * 0.05, 0);
      fl.translate(Math.cos(a) * d + Math.cos(fa) * 0.33, h + 0.25 + r() * 0.5, Math.sin(a) * d + Math.sin(fa) * 0.33);
      flowers.push(fl);
    }
  }
  return { leaves: merge(leaves), flowers: merge(flowers) };
}

/** Side of a dressing cell (m): each cell is its own instanced mesh, culled on its own. */
const CELL = 120;

interface Cell {
  mesh: THREE.InstancedMesh;
  cx: number;
  cz: number;
  range: number;
}

/**
 * Bucket instances into CELL-sized meshes with tight bounds, so the camera and the shadow
 * camera skip whatever is out of view, and far cells can be hidden by range.
 */
function cells(
  parent: THREE.Object3D,
  list: { m: THREE.Matrix4; c?: THREE.Color }[],
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  range: number,
  shadow: boolean,
  out: Cell[],
): void {
  const buckets = new Map<string, typeof list>();
  for (const it of list) {
    const k = `${Math.floor(it.m.elements[12] / CELL)},${Math.floor(it.m.elements[14] / CELL)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(it);
  }
  for (const items of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    let cx = 0;
    let cz = 0;
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (it.c) mesh.setColorAt(i, it.c);
      cx += it.m.elements[12];
      cz += it.m.elements[14];
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    out.push({ mesh, cx: cx / items.length, cz: cz / items.length, range });
  }
}

export interface DressingInput {
  terrain: Terrain;
  zones?: GroundZones;
  roadDistance: (x: number, z: number) => number;
  /** Is anything solid (walls, buildings, trees) within r of (x, z)? */
  blocked: (x: number, z: number, r: number) => boolean;
  /** Keep out of the homestead, the pen and the village. */
  reserved: (x: number, z: number) => boolean;
}

export class GroundDressing {
  readonly root = new THREE.Group();

  constructor(o: DressingInput) {
    this.root.name = 'ground dressing';
    const t = o.terrain;
    const r = rng(9090);
    const d = new THREE.Object3D();
    const half = t.half - 12;
    const clear = (x: number, z: number, rr: number) => o.roadDistance(x, z) > 4 + rr && !o.blocked(x, z, rr) && !o.reserved(x, z);

    // ---- limestone outcrops on the steep ground, in clusters
    const slabs: { x: number; z: number; s: number; rot: number; tilt: number }[] = [];
    for (let x = -half; x < half; x += 3) {
      for (let z = -half; z < half; z += 3) {
        const jx = x + (r() - 0.5) * 3;
        const jz = z + (r() - 0.5) * 3;
        const sl = t.slopeDegAt(jx, jz);
        if (sl < 19) continue;
        const cluster = fbm(jx / 16, jz / 16, 2, 97) * 0.5 + 0.5;
        if (r() > (cluster - 0.35) * 1.6 * Math.min(1, (sl - 17) / 12)) continue;
        // Smaller on the gentler slopes the flock still crosses.
        const s = (0.5 + r() * 1.5) * Math.min(1, 0.45 + (sl - 19) / 12);
        if (!clear(jx, jz, s)) continue;
        slabs.push({ x: jx, z: jz, s, rot: r() * Math.PI * 2, tilt: sl });
      }
    }
    const slabMat = toonMaterial({ color: 0xffffff });
    const normal = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    for (let v = 0; v < 3; v++) {
      const mine = slabs.filter((_, i) => i % 3 === v);
      if (!mine.length) continue;
      const list = mine.map((p) => {
        // Lie along the slope, sunk so only the top shows.
        const e = 1.5;
        const hx = t.heightAt(p.x + e, p.z) - t.heightAt(p.x - e, p.z);
        const hz = t.heightAt(p.x, p.z + e) - t.heightAt(p.x, p.z - e);
        normal.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
        q.setFromUnitVectors(up, normal);
        d.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(up, p.rot));
        d.position.set(p.x, t.heightAt(p.x, p.z) - 0.1 * p.s, p.z);
        d.scale.set(p.s, p.s * (0.7 + r() * 0.4), p.s * (0.7 + r() * 0.3));
        d.updateMatrix();
        return { m: d.matrix.clone(), c: new THREE.Color().setHSL(0.09 + r() * 0.03, 0.1 + r() * 0.08, 0.6 + r() * 0.1) };
      });
      cells(this.root, list, slabGeometry(300 + v), slabMat, 420, true, this.cells);
    }
    this.slabCount = slabs.length;

    // ---- loose stones over the rough country (maquis, slopes, the forest edge, banks)
    const stones: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    for (let tries = 0; stones.length < 4000 && tries < 60000; tries++) {
      const x = (r() - 0.5) * half * 2;
      const z = (r() - 0.5) * half * 2;
      const s = t.surfaceAt(x, z);
      if (s !== Surface.Grass && s !== Surface.Dirt && s !== Surface.Rock) continue;
      const sl = t.slopeDegAt(x, z);
      const want = 0.08 + Math.min(1, sl / 26) * 0.45 + (o.zones?.maquis(x, z) ?? 0) * 0.4;
      if (r() > want || !clear(x, z, 0.4)) continue;
      const sz = 0.12 + r() * r() * 0.35;
      d.quaternion.setFromAxisAngle(up, r() * 6.28);
      d.position.set(x, t.heightAt(x, z) - sz * 0.25, z);
      d.scale.set(sz, sz * 0.7, sz * 0.85);
      d.updateMatrix();
      stones.push({ m: d.matrix.clone(), c: new THREE.Color().setHSL(0.08 + r() * 0.04, 0.1 + r() * 0.1, 0.62 + r() * 0.14) });
    }
    // Small things: only drawn near the camera, no shadows.
    cells(this.root, stones, new THREE.IcosahedronGeometry(1, 0), toonMaterial({ color: 0xffffff }), 160, false, this.cells);

    // ---- oleanders along the dere's banks, in clumps, clear of the fords and roads
    const zones = o.zones;
    const oleanders: { x: number; z: number; s: number; rot: number; white: boolean }[] = [];
    if (zones) {
      for (let tries = 0; oleanders.length < 320 && tries < 40000; tries++) {
        const x = (r() - 0.5) * half * 2;
        const z = (r() - 0.5) * half * 2;
        const dd = zones.dere(x, z);
        if (dd < zones.dereHalf - 0.5 || dd > zones.dereHalf + zones.dereBank + 3) continue;
        if (zones.fords.some((f) => Math.hypot(x - f.x, z - f.z) < 22)) continue;
        if (fbm(x / 22, z / 22, 2, 99) < 0.05) continue; // in clumps, with open stretches between
        if (!clear(x, z, 1.2)) continue;
        oleanders.push({ x, z, s: 0.9 + r() * 0.7, rot: r() * 6.28, white: r() < 0.22 });
      }
    }
    if (oleanders.length) {
      const g = oleanderGeometry(77);
      const leafMat = toonMaterial({ color: 0x4f7a44 });
      sway(leafMat, { key: 'oleander', bend: 0.06, refHeight: 2, flutter: 0.03 });
      const flowerMat = toonMaterial({ color: 0xffffff });
      sway(flowerMat, { key: 'oleanderFlower', bend: 0.06, refHeight: 2, flutter: 0.03 });
      const leafList: { m: THREE.Matrix4 }[] = [];
      const flowerList: { m: THREE.Matrix4; c: THREE.Color }[] = [];
      for (const p of oleanders) {
        d.quaternion.setFromAxisAngle(up, p.rot);
        d.position.set(p.x, t.heightAt(p.x, p.z) - 0.1, p.z);
        d.scale.setScalar(p.s);
        d.updateMatrix();
        leafList.push({ m: d.matrix.clone() });
        flowerList.push({ m: d.matrix.clone(), c: new THREE.Color(p.white ? 0xf6f0e6 : r() < 0.5 ? 0xe57fa6 : 0xd9608c) });
      }
      cells(this.root, leafList, g.leaves, leafMat, 380, true, this.cells);
      cells(this.root, flowerList, g.flowers, flowerMat, 260, false, this.cells);
    }
    this.oleanderCount = oleanders.length;
  }

  readonly slabCount: number;
  readonly oleanderCount: number;
  private readonly cells: Cell[] = [];

  /** Hide cells beyond their range (the haze has them by then). */
  update(eye: { x: number; z: number }): void {
    for (const c of this.cells) c.mesh.visible = Math.hypot(c.cx - eye.x, c.cz - eye.z) < c.range + CELL * 0.75;
  }
}

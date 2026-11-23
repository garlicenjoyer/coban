// The homestead's art pass (GDD feature 4: full art only near the homestead). Everything
// here is drawn over colliders that homestead.ts already placed:
//
//   the ağıl     dry-stone walls in rough courses with capstones, dry thorn brush along the
//                top against wolves, stout gate posts, a lean-to shelter on the north wall,
//                straw on the floor (the plank gate itself is in propsView: main.ts hinges it)
//   the çeşme    an Ottoman village fountain: a pointed-arch niche, a marble inscription
//                panel, a cornice under a little tiled roof, a brass spout and running water
//   the yard     a fig tree behind the cottage, a haystack, the tandır oven, a clothesline
//                with the washing out, flagstones from the porch toward the gate, and hens

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/toon';
import { sway } from '../render/wind';
import { cesmeWall, SHELTER, shelterPosts, yardLayout } from './homestead';
import { layout, type BoxProp, type MapProps } from './map';
import { rng } from './noise';
import type { Terrain } from './terrain';

const COL = {
  wood: 0x8b5f3a,
  woodDk: 0x63432a,
  tile: 0xc1653f,
  tileDk: 0xa4502f,
  straw: 0xdcbb68,
  strawDk: 0xb9964a,
  thorn: 0x5e4a36,
  stone: 0xcab697,
  stoneDk: 0xa99476,
  marble: 0xeee6d6,
  brass: 0xc9a14a,
  clay: 0xc4865a,
  figLeaf: 0x557f3a,
  figBark: 0x9d958a,
};

const merge = (parts: THREE.BufferGeometry[]) =>
  mergeGeometries(
    parts.map((p) => {
      const q = p.index ? p.toNonIndexed() : p;
      q.deleteAttribute('uv');
      return q;
    }),
  )!;

const shadowed = <T extends THREE.Object3D>(o: T, cast = true): T => {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.castShadow = cast;
      c.receiveShadow = true;
    }
  });
  return o;
};

/**
 * Merge a static group's plain meshes into one mesh per material (fewer draw calls).
 * Meshes named 'live' (animated or transparent) are left alone.
 */
function bake(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const done: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.name === 'live' || Array.isArray(o.material)) return;
    const geo = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(inv.clone().multiply(o.matrixWorld));
    const list = byMat.get(o.material) ?? [];
    list.push(geo);
    byMat.set(o.material, list);
    done.push(o);
  });
  for (const m of done) m.removeFromParent();
  for (const [mat, geos] of byMat) group.add(new THREE.Mesh(merge(geos), mat));
  return group;
}

interface Hen {
  root: THREE.Group;
  head: THREE.Group;
  wings: THREE.Mesh[];
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  peck: number;
  phase: number;
  fleeing: number;
}

export interface HomesteadFrame {
  time: number;
  hour: number;
  /** Meals in Karabaş's bowl, and left in the sack. */
  bowlMeals: number;
  /** The reinforced ağıl (an upgrade): a palisade of stakes on the walls. */
  penReinforced: boolean;
  sackMeals: number;
  player: { x: number; z: number };
  /** Is this spot blocked for a hen (radius r)? */
  blocked: (x: number, z: number, r: number) => boolean;
}

export class HomesteadView {
  readonly root = new THREE.Group();
  private stream: THREE.Mesh | null = null;
  private ripples: THREE.Mesh[] = [];
  private washing: { pivot: THREE.Object3D; phase: number }[] = [];
  private hens: Hen[] = [];
  private kibble: THREE.Mesh | null = null;
  private palisade: THREE.InstancedMesh | null = null;
  private sack: THREE.Mesh | null = null;
  private r = rng(5150);

  constructor(private t: Terrain, map: MapProps) {
    this.root.name = 'homestead';
    this.agil(map);
    this.cesme(map);
    this.fig();
    this.haystack();
    this.oven();
    this.clothesline();
    this.flagstones();
    this.dogCorner();
    this.makeHens();
  }

  private ground(x: number, z: number): number {
    return this.t.heightAt(x, z);
  }

  // ---------- the ağıl ----------

  private agil(map: MapProps): void {
    const pen = layout.pen;
    const r = this.r;
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    const stones: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const twigs: THREE.Matrix4[] = [];
    const fences = map.props.filter((p): p is BoxProp => p.kind === 'box' && p.role === 'fence');
    const thick = 0.42;
    for (const w of fences) {
      const alongX = w.hx > w.hz;
      const len = (alongX ? w.hx : w.hz) * 2;
      // Outward from the pen, so the inner face stays where the collider's is.
      const out = alongX ? Math.sign(w.z - pen.z) : Math.sign(w.x - pen.x);
      const shift = out * (thick / 2 - 0.08);
      const cx = alongX ? w.x : w.x + shift;
      const cz = alongX ? w.z + shift : w.z;
      const H = w.hy * 2;
      // Uneven courses of rough fieldstones, staggered and jostled, then capstones.
      let y = 0;
      while (y < H - 0.2) {
        const ch = Math.min(H - 0.12 - y, 0.2 + r() * 0.16);
        let u = -len / 2 - r() * 0.3;
        while (u < len / 2) {
          const sl = 0.28 + r() * 0.4;
          const a = Math.max(u, -len / 2);
          const b = Math.min(u + sl, len / 2);
          u += sl;
          if (b - a < 0.1) continue;
          const mid = (a + b) / 2;
          const jit = (r() - 0.5) * 0.06;
          const x = alongX ? cx + mid : cx + jit;
          const z = alongX ? cz + jit : cz + mid;
          const sh = ch * (0.8 + r() * 0.4);
          d.position.set(x, this.ground(x, z) + y + sh / 2 - 0.08 + (r() - 0.5) * 0.04, z);
          d.rotation.set((r() - 0.5) * 0.14, (r() - 0.5) * 0.2, (r() - 0.5) * 0.16);
          const sw = thick * (0.85 + r() * 0.25);
          d.scale.set(alongX ? b - a - 0.04 : sw, sh, alongX ? sw : b - a - 0.04);
          d.updateMatrix();
          const dark = r() < 0.15;
          stones.push({ m: d.matrix.clone(), c: col.setHSL(0.07 + r() * 0.05, 0.1 + r() * 0.14, dark ? 0.45 + r() * 0.06 : 0.53 + r() * 0.14).clone() });
        }
        y += ch;
      }
      // Coping: narrow stones set on edge across the top.
      for (let u = -len / 2 + 0.1; u < len / 2 - 0.05; u += 0.17 + r() * 0.06) {
        const x = alongX ? cx + u : cx;
        const z = alongX ? cz : cz + u;
        const ch = 0.18 + r() * 0.1;
        d.position.set(x, this.ground(x, z) + y - 0.1 + ch / 2, z);
        d.rotation.set(alongX ? 0 : (r() - 0.5) * 0.3, 0, alongX ? (r() - 0.5) * 0.3 : 0);
        const across = thick * (0.8 + r() * 0.2);
        d.scale.set(alongX ? 0.11 + r() * 0.05 : across, ch, alongX ? across : 0.11 + r() * 0.05);
        d.updateMatrix();
        stones.push({ m: d.matrix.clone(), c: col.setHSL(0.08 + r() * 0.03, 0.1 + r() * 0.1, 0.48 + r() * 0.12).clone() });
      }
      // Dry thorn brush tangled along the top: wolves don't like climbing through it.
      const top = y + 0.08;
      for (let u = -len / 2; u < len / 2; u += 0.07) {
        const x = (alongX ? cx + u : cx) + (r() - 0.5) * 0.3;
        const z = (alongX ? cz : cz + u) + (r() - 0.5) * 0.3;
        d.position.set(x, this.ground(x, z) + top - 0.12, z);
        d.rotation.set(0, r() * Math.PI * 2, 0);
        // Mostly lying, a few sticking up.
        d.rotateZ(r() < 0.8 ? 1.0 + r() * 0.5 : 0.3 + r() * 0.5);
        d.scale.set(0.6 + r() * 0.5, 0.25 + r() * 0.45, 0.6 + r() * 0.5);
        d.updateMatrix();
        twigs.push(d.matrix.clone());
      }
    }
    const stoneMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), toonMaterial({ color: 0xffffff }), stones.length);
    stones.forEach((s, i) => {
      stoneMesh.setMatrixAt(i, s.m);
      stoneMesh.setColorAt(i, s.c);
    });
    this.root.add(shadowed(stoneMesh));
    const twigGeo = new THREE.CylinderGeometry(0.008, 0.016, 1, 3).translate(0, 0.5, 0);
    const twigMesh = new THREE.InstancedMesh(twigGeo, toonMaterial({ color: COL.thorn }), twigs.length);
    twigs.forEach((m, i) => twigMesh.setMatrixAt(i, m));
    this.root.add(shadowed(twigMesh, false));

    // Gate posts: two stout timbers either side of the gate.
    const gx = pen.x + pen.hx;
    const gy = this.ground(gx, pen.z);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.75, 0.24), toonMaterial({ color: COL.woodDk }));
      post.position.set(gx + 0.05, gy + 0.8, pen.z + s * (pen.gateWidth / 2 + 0.14));
      this.root.add(shadowed(post));
    }

    this.shelter();
    this.straw();
    this.buildPalisade(fences);
  }

  /** Stout stakes along the wall tops, shown once the ağıl is reinforced. */
  private buildPalisade(fences: BoxProp[]): void {
    const pen = layout.pen;
    const ms: THREE.Matrix4[] = [];
    const d = new THREE.Object3D();
    for (const w of fences) {
      const alongX = w.hx > w.hz;
      const len = (alongX ? w.hx : w.hz) * 2;
      const out = alongX ? Math.sign(w.z - pen.z) : Math.sign(w.x - pen.x);
      for (let u = -len / 2 + 0.15; u < len / 2; u += 0.3) {
        const x = alongX ? w.x + u : w.x + out * 0.05;
        const z = alongX ? w.z + out * 0.05 : w.z + u;
        d.position.set(x, this.ground(x, z) + w.hy * 2 + 0.25, z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 0.85 + ((u * 7.3) % 0.3), 1);
        d.updateMatrix();
        ms.push(d.matrix.clone());
      }
    }
    const geo = new THREE.CylinderGeometry(0.05, 0.06, 0.8, 5);
    geo.translate(0, 0.15, 0);
    this.palisade = new THREE.InstancedMesh(geo, toonMaterial({ color: 0x7a5636 }), ms.length);
    ms.forEach((m, i) => this.palisade!.setMatrixAt(i, m));
    this.palisade.castShadow = true;
    this.palisade.visible = false;
    this.root.add(this.palisade);
  }

  private shelter(): void {
    const pen = layout.pen;
    const wood = toonMaterial({ color: COL.wood });
    const woodDk = toonMaterial({ color: COL.woodDk });
    const g = new THREE.Group();
    g.name = 'ağıl shelter';
    const zBack = pen.z - pen.hz + 0.12;
    const zFront = pen.z - pen.hz + SHELTER.depth;
    const half = pen.hx * 0.72;
    const gy = this.ground(pen.x, pen.z);
    for (const p of shelterPosts(layout)) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, SHELTER.front, 6), wood);
      post.position.set(p.x, this.ground(p.x, p.z) + SHELTER.front / 2, p.z);
      g.add(post);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.14, SHELTER.back, 0.14), woodDk);
      back.position.set(p.x, this.ground(p.x, zBack) + SHELTER.back / 2, zBack);
      g.add(back);
    }
    for (const [z, y] of [
      [zFront, SHELTER.front],
      [zBack, SHELTER.back],
    ]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.6, 0.14, 0.16), woodDk);
      beam.position.set(pen.x, gy + y, z);
      g.add(beam);
    }
    // The roof: pantiles in rows down the slope, overhanging the front.
    const run = zFront - zBack + 0.5;
    const drop = SHELTER.back - SHELTER.front + 0.08;
    const slope = Math.atan2(drop, run);
    const slant = Math.hypot(run, drop);
    const tiles: THREE.BufferGeometry[] = [];
    const tilesDk: THREE.BufferGeometry[] = [];
    const width = half * 2 + 1.2;
    const nTiles = Math.round(width / 0.26);
    for (let i = 0; i < nTiles; i++) {
      const x = -width / 2 + (i + 0.5) * (width / nTiles);
      // A half-round pantile lying down the slope, convex side up.
      const tile = new THREE.CylinderGeometry(0.13, 0.13, slant, 6, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(x, 0, 0);
      (i % 2 ? tilesDk : tiles).push(tile);
    }
    const roof = new THREE.Group();
    roof.add(new THREE.Mesh(merge(tiles), toonMaterial({ color: COL.tile, side: THREE.DoubleSide })));
    roof.add(new THREE.Mesh(merge(tilesDk), toonMaterial({ color: COL.tileDk, side: THREE.DoubleSide })));
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, slant), woodDk);
    deck.position.y = -0.04;
    roof.add(deck);
    roof.position.set(pen.x, gy + (SHELTER.back + SHELTER.front) / 2 + 0.12, (zBack + zFront + 0.5) / 2);
    roof.rotation.x = slope;
    g.add(roof);
    this.root.add(shadowed(bake(g)));
  }

  private straw(): void {
    const pen = layout.pen;
    const r = this.r;
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    const n = 700;
    // Bedding: pale mats of trodden straw, thickest under the shelter.
    const mats: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 26; i++) {
      const under = i < 14;
      const x = pen.x + (r() * 2 - 1) * (pen.hx - 1.2);
      const z = under ? pen.z - pen.hz + 0.6 + r() * (SHELTER.depth - 0.6) : pen.z + (r() * 2 - 1) * (pen.hz - 1.2);
      const g = new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2);
      g.scale(0.8 + r() * 1.1, 1, 0.6 + r() * 0.8);
      g.rotateY(r() * Math.PI);
      g.translate(x, this.ground(x, z) + 0.012 + i * 0.0004, z);
      mats.push(g);
    }
    const bedding = new THREE.Mesh(merge(mats), toonMaterial({ color: 0xd8c08a, transparent: true, opacity: 0.85, depthWrite: false }));
    bedding.receiveShadow = true;
    this.root.add(bedding);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.014, 0.07), toonMaterial({ color: 0xffffff }), n);
    for (let i = 0; i < n; i++) {
      // Denser under the shelter, where they bed down.
      const under = i < n * 0.45;
      const x = pen.x + (r() * 2 - 1) * (pen.hx - 0.4);
      const z = under ? pen.z - pen.hz + 0.3 + r() * (SHELTER.depth - 0.2) : pen.z + (r() * 2 - 1) * (pen.hz - 0.4);
      d.position.set(x, this.ground(x, z) + 0.015 + r() * 0.03, z);
      d.rotation.set((r() - 0.5) * 0.2, r() * Math.PI, (r() - 0.5) * 0.2);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      mesh.setColorAt(i, col.setHex(r() < 0.4 ? COL.strawDk : COL.straw));
    }
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  // ---------- the çeşme ----------

  private cesme(map: MapProps): void {
    const tr = map.props.find((p): p is BoxProp => p.kind === 'box' && p.role === 'trough');
    if (!tr) return;
    const fw = cesmeWall(layout);
    const ty = this.ground(tr.x, tr.z);
    const g = new THREE.Group();
    g.name = 'çeşme';
    g.position.set(tr.x, ty, tr.z);
    const stone = toonMaterial({ color: COL.stone });
    const stoneDk = toonMaterial({ color: COL.stoneDk });
    const marble = toonMaterial({ color: COL.marble });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };

    // The trough: a long stone basin with a thick rim.
    const bh = tr.hy * 2;
    add(new THREE.BoxGeometry(tr.hx * 2, bh - 0.14, tr.hz * 2), stone, 0, (bh - 0.14) / 2, 0);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.12, 0.16, tr.hz * 2 + 0.04), stoneDk, s * (tr.hx - 0.04), bh - 0.06, 0);
      add(new THREE.BoxGeometry(tr.hx * 2, 0.16, 0.12), stoneDk, 0, bh - 0.06, s * (tr.hz - 0.04));
    }
    const water = add(new THREE.BoxGeometry(tr.hx * 2 - 0.2, 0.03, tr.hz * 2 - 0.2), new THREE.MeshBasicMaterial({ color: 0x8cc6d4 }), 0, bh - 0.1, 0);
    water.name = 'live';

    // The fountain wall (its collider is fw), facing the trough.
    const wx = fw.x - tr.x;
    const wz = fw.z - tr.z;
    add(new THREE.BoxGeometry(fw.hx * 2 + 0.1, 0.3, fw.hz * 2 + 0.2), stoneDk, wx, 0.15, wz); // plinth
    add(new THREE.BoxGeometry(fw.hx * 2, fw.h - 0.5, fw.hz * 2), stone, wx, 0.3 + (fw.h - 0.5) / 2, wz);
    // Cornice and a little hipped roof of tiles.
    add(new THREE.BoxGeometry(fw.hx * 2 + 0.3, 0.14, fw.hz * 2 + 0.3), stoneDk, wx, fw.h - 0.13, wz);
    const roof = add(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0), toonMaterial({ color: COL.tile }), wx, fw.h - 0.06, wz);
    roof.scale.set(fw.hx * 2 + 0.35, 0.45, fw.hz * 2 + 0.35);

    // The pointed arch on the face toward the trough: a pale frame, a shadowed niche.
    const face = wx - fw.hx; // local x of the wall's west face
    const arch = (w: number, h: number) => {
      const s = new THREE.Shape();
      const hw = w / 2;
      const spring = h - w * 0.75;
      s.moveTo(-hw, 0);
      s.lineTo(-hw, spring);
      s.quadraticCurveTo(-hw, spring + w * 0.5, 0, h);
      s.quadraticCurveTo(hw, spring + w * 0.5, hw, spring);
      s.lineTo(hw, 0);
      s.closePath();
      return new THREE.ShapeGeometry(s, 8).rotateY(-Math.PI / 2);
    };
    add(arch(1.25, 1.75), marble, face - 0.012, 0.32, wz);
    add(arch(1.0, 1.55), toonMaterial({ color: 0x8f7b62 }), face - 0.02, 0.36, wz);
    // The inscription panel above the spout, with incised lines.
    add(new THREE.BoxGeometry(0.03, 0.34, 0.62), marble, face - 0.035, 1.42, wz);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.01, 0.025, 0.46 - i * 0.08), toonMaterial({ color: 0x8a8070 }), face - 0.052, 1.52 - i * 0.09, wz);
    // A rosette above the arch.
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 10).rotateZ(Math.PI / 2), marble, face - 0.02, 2.0, wz);
    // The brass spout (lüle) and the water running from it.
    const brass = toonMaterial({ color: COL.brass });
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10).rotateZ(Math.PI / 2), brass, face - 0.04, 0.98, wz);
    add(new THREE.CylinderGeometry(0.028, 0.035, 0.32, 8).rotateZ(Math.PI / 2 - 0.25), brass, face - 0.2, 0.95, wz);
    const streamTop = 0.9;
    const streamBottom = bh - 0.1;
    this.stream = add(
      new THREE.CylinderGeometry(0.018, 0.03, streamTop - streamBottom, 6),
      new THREE.MeshBasicMaterial({ color: 0xd4eef4, transparent: true, opacity: 0.75 }),
      face - 0.36,
      (streamTop + streamBottom) / 2,
      wz,
    );
    this.stream.name = 'live';
    for (let i = 0; i < 2; i++) {
      const ring = add(
        new THREE.RingGeometry(0.9, 1, 20).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xeaf7fa, transparent: true, opacity: 0.5, depthWrite: false }),
        face - 0.36,
        bh - 0.08,
        wz,
      );
      ring.name = 'live';
      this.ripples.push(ring);
    }
    // Wet, darker stone where the water slops over, and a few flat stones to stand on.
    const wet = add(new THREE.CircleGeometry(1.4, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5f5a48, transparent: true, opacity: 0.35, depthWrite: false }), -tr.hx - 0.6, 0.03, 0);
    wet.scale.set(0.8, 1, 1.4);
    wet.name = 'live';
    const r = this.r;
    for (let i = 0; i < 6; i++) {
      const z = -tr.hz + 0.3 + i * 0.55;
      const x = -tr.hx - 0.55 - r() * 0.25;
      const s = add(new THREE.CylinderGeometry(0.28 + r() * 0.08, 0.3 + r() * 0.08, 0.07, 7), stoneDk, x, this.ground(tr.x + x, tr.z + z) - ty + 0.03, z);
      s.rotation.y = r() * 3;
    }
    this.root.add(shadowed(bake(g)));
    water.castShadow = false;
    wet.castShadow = false;
    this.stream.castShadow = false;
    for (const ring of this.ripples) ring.castShadow = false;
  }

  // ---------- the yard ----------

  private fig(): void {
    const f = yardLayout(layout).fig;
    const r = rng(808);
    const g = new THREE.Group();
    g.name = 'fig tree';
    g.position.set(f.x, this.ground(f.x, f.z) - 0.05, f.z);
    const bark: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const limb = new THREE.CylinderGeometry(0.09, 0.2, 2.4, 6).translate(0, 1.2, 0);
      limb.rotateZ(0.25 + r() * 0.35);
      limb.rotateY((i / 4) * Math.PI * 2 + r() * 0.6);
      bark.push(limb);
    }
    const figWind = { key: 'fig', bend: 0.07, refHeight: 3.5 };
    const bm = toonMaterial({ color: COL.figBark });
    sway(bm, figWind);
    g.add(new THREE.Mesh(merge(bark), bm));
    // Big, dark, layered leaf clumps: a broad, low dome.
    const leaves: THREE.BufferGeometry[] = [];
    const leavesDk: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 14; i++) {
      const s = 0.85 + r() * 0.6;
      const clump = new THREE.IcosahedronGeometry(s, 0).scale(1.2, 0.55, 1.2);
      const a = r() * Math.PI * 2;
      const dd = r() * 2.4;
      clump.translate(Math.cos(a) * dd, 2.2 + r() * 1.2 - dd * 0.25, Math.sin(a) * dd);
      (i % 3 ? leaves : leavesDk).push(clump);
    }
    for (const [geo, color] of [[merge(leaves), COL.figLeaf], [merge(leavesDk), 0x46703a]] as const) {
      const lm = toonMaterial({ color });
      sway(lm, { ...figWind, key: `figLeaf${color}`, flutter: 0.03 });
      g.add(new THREE.Mesh(geo, lm));
    }
    this.root.add(shadowed(g));
  }

  private haystack(): void {
    const h = yardLayout(layout).hay;
    const r = this.r;
    const g = new THREE.Group();
    g.name = 'haystack';
    g.position.set(h.x, this.ground(h.x, h.z) - 0.1, h.z);
    const profile = [
      [0.01, 0],
      [h.r * 0.95, 0],
      [h.r * 1.05, h.h * 0.25],
      [h.r * 1.0, h.h * 0.5],
      [h.r * 0.75, h.h * 0.78],
      [h.r * 0.35, h.h * 0.95],
      [0.01, h.h * 1.02],
    ].map(([a, b]) => new THREE.Vector2(a, b));
    const stack = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), toonMaterial({ color: COL.straw }));
    g.add(stack);
    for (const [y, rr] of [
      [h.h * 0.42, h.r * 1.03],
      [h.h * 0.7, h.r * 0.82],
    ]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.06, 4, 18).rotateX(Math.PI / 2), toonMaterial({ color: COL.strawDk }));
      band.position.y = y;
      g.add(band);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.4, 5), toonMaterial({ color: COL.woodDk }));
    pole.position.y = h.h + 0.4;
    pole.rotation.z = 0.08;
    g.add(pole);
    // Loose hay round the foot of the stack.
    const d = new THREE.Object3D();
    const n = 120;
    const loose = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.015, 0.05), toonMaterial({ color: COL.straw }), n);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const dd = h.r + r() * 1.3;
      d.position.set(Math.cos(a) * dd, this.ground(h.x + Math.cos(a) * dd, h.z + Math.sin(a) * dd) - g.position.y + 0.02, Math.sin(a) * dd);
      d.rotation.set(0, r() * Math.PI, 0);
      d.updateMatrix();
      loose.setMatrixAt(i, d.matrix);
    }
    g.add(loose);
    this.root.add(shadowed(g));
    loose.castShadow = false;
  }

  private oven(): void {
    const o = yardLayout(layout).oven;
    const g = new THREE.Group();
    g.name = 'tandır';
    g.position.set(o.x, this.ground(o.x, o.z), o.z);
    const R = o.r;
    const profile = [
      [R * 1.0, 0],
      [R * 1.03, 0.3],
      [R * 0.85, 0.65],
      [R * 0.45, 0.92],
      [R * 0.32, 0.98],
      [R * 0.28, 0.9],
    ].map(([a, b]) => new THREE.Vector2(a, b));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 16), toonMaterial({ color: COL.clay, side: THREE.DoubleSide })));
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(R * 0.29, 12).rotateX(-Math.PI / 2), toonMaterial({ color: 0x2e2420 }));
    mouth.position.y = 0.9;
    g.add(mouth);
    // The draught hole at its foot, facing the yard, and a ring of stones round it.
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10), toonMaterial({ color: 0x2e2420 }));
    hole.position.set(-R * 1.0, 0.18, 0);
    hole.rotation.y = -Math.PI / 2;
    g.add(hole);
    const ring: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ring.push(new THREE.DodecahedronGeometry(0.14, 0).scale(1, 0.6, 1).rotateY(i).translate(Math.cos(a) * (R + 0.15), 0.05, Math.sin(a) * (R + 0.15)));
    }
    g.add(new THREE.Mesh(merge(ring), toonMaterial({ color: COL.stoneDk })));
    // A wooden lid leaning on it.
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 12), toonMaterial({ color: COL.wood }));
    lid.position.set(R * 0.6, 0.5, R * 0.95);
    lid.rotation.set(1.2, 0, 0.3);
    g.add(lid);
    this.root.add(shadowed(bake(g)));
  }

  private clothesline(): void {
    const [a, b] = yardLayout(layout).line;
    const wood = toonMaterial({ color: COL.wood });
    const top = 1.85;
    const ya = this.ground(a.x, a.z);
    const yb = this.ground(b.x, b.z);
    for (const [p, y] of [
      [a, ya],
      [b, yb],
    ] as const) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, top + 0.1, 6), wood);
      post.position.set(p.x, y + (top + 0.1) / 2, p.z);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), wood);
      bar.position.set(p.x, y + top, p.z);
      this.root.add(shadowed(post), shadowed(bar));
    }
    // The line sags between the posts.
    const pts: THREE.Vector3[] = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * k, ya + (yb - ya) * k + top - 0.02 - Math.sin(k * Math.PI) * 0.18, a.z + (b.z - a.z) * k));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe9e2d2 }));
    this.root.add(line);
    // The washing: a sheet, a shirt, a striped towel and a kilim airing.
    const items: { at: number; w: number; h: number; mat: THREE.Material }[] = [
      { at: 0.16, w: 0.9, h: 1.0, mat: toonMaterial({ color: 0xf6f1e7, side: THREE.DoubleSide }) },
      { at: 0.38, w: 0.5, h: 0.62, mat: toonMaterial({ color: 0x5b7fa6, side: THREE.DoubleSide }) },
      { at: 0.55, w: 0.4, h: 0.55, mat: toonMaterial({ color: 0xd9a441, side: THREE.DoubleSide }) },
      { at: 0.8, w: 1.1, h: 0.8, mat: toonMaterial({ map: kilimTexture(), side: THREE.DoubleSide }) },
    ];
    const along = Math.atan2(b.x - a.x, b.z - a.z);
    items.forEach((it, i) => {
      const k = it.at;
      const p = pts[Math.round(k * n)];
      const pivot = new THREE.Object3D();
      pivot.position.copy(p);
      pivot.rotation.y = along - Math.PI / 2;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(it.w, it.h, 1, 3).translate(0, -it.h / 2, 0), it.mat);
      cloth.castShadow = true;
      pivot.add(cloth);
      this.root.add(pivot);
      this.washing.push({ pivot, phase: i * 1.7 });
    });
  }

  private flagstones(): void {
    const { from, to } = yardLayout(layout).path;
    const r = this.r;
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.floor(len / 0.75);
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 7), toonMaterial({ color: 0xffffff }), n);
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n;
      const x = from.x + (to.x - from.x) * k + (r() - 0.5) * 0.35;
      const z = from.z + (to.z - from.z) * k + (r() - 0.5) * 0.35;
      d.position.set(x, this.ground(x, z) + 0.02, z);
      d.rotation.set(0, r() * 3, 0);
      d.scale.set(0.24 + r() * 0.1, 0.05, 0.2 + r() * 0.1);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      mesh.setColorAt(i, col.setHSL(0.08 + r() * 0.03, 0.1 + r() * 0.08, 0.5 + r() * 0.1));
    }
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** Karabaş's bowl by the door and Uncle Ahmet's sack of kibble beside it. */
  private dogCorner(): void {
    const y = yardLayout(layout);
    const b = y.bowl;
    const by = this.ground(b.x, b.z);
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(0.1, 0), new THREE.Vector2(0.2, 0.02), new THREE.Vector2(0.23, 0.09), new THREE.Vector2(0.2, 0.09), new THREE.Vector2(0.17, 0.03)], 14),
      toonMaterial({ color: 0x9a3f2c, side: THREE.DoubleSide }),
    );
    bowl.position.set(b.x, by, b.z);
    this.kibble = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.04, 12), toonMaterial({ color: 0x8a5a32 }));
    this.kibble.position.set(b.x, by + 0.06, b.z);
    const s = y.sack;
    const sy = this.ground(s.x, s.z);
    // A hessian sack, slumping as it empties.
    this.sack = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(0.01, 0), new THREE.Vector2(0.24, 0.02), new THREE.Vector2(0.27, 0.25), new THREE.Vector2(0.22, 0.5), new THREE.Vector2(0.12, 0.6), new THREE.Vector2(0.06, 0.66), new THREE.Vector2(0.01, 0.68)], 10),
      toonMaterial({ color: 0xc8ad7a }),
    );
    this.sack.position.set(s.x, sy, s.z);
    this.sack.rotation.set(0.05, 0.6, -0.08);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 4, 10).rotateX(Math.PI / 2), toonMaterial({ color: 0x6b4e2e }));
    tie.position.y = 0.58;
    this.sack.add(tie);
    this.root.add(shadowed(bowl), shadowed(this.kibble), shadowed(this.sack));
  }

  // ---------- hens ----------

  private makeHens(): void {
    const area = yardLayout(layout).hens;
    const r = this.r;
    const coats = [0x9b5a2e, 0xa8683a, 0xf2ece0, 0x3a3330, 0x8a4c26];
    const comb = toonMaterial({ color: 0xc8352b });
    const beak = toonMaterial({ color: 0xe0b040 });
    for (let i = 0; i < coats.length; i++) {
      const coat = toonMaterial({ color: coats[i] });
      const root = new THREE.Group();
      root.name = 'hen';
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6).scale(0.95, 0.85, 1.25), coat);
      body.position.y = 0.2;
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 5).rotateX(-0.7), coat);
      tail.position.set(0, 0.3, -0.17);
      const wings = [-1, 1].map((s) => {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4).scale(0.35, 0.7, 1.3), coat);
        w.position.set(s * 0.13, 0.22, 0);
        return w;
      });
      const head = new THREE.Group();
      head.position.set(0, 0.28, 0.14);
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.065, 7, 5), coat);
      skull.position.set(0, 0.07, 0.04);
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.07), comb);
      c.position.set(0, 0.14, 0.04);
      const wattle = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), comb);
      wattle.position.set(0, 0.02, 0.09);
      const b = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 4).rotateX(Math.PI / 2), beak);
      b.position.set(0, 0.06, 0.12);
      head.add(skull, c, wattle, b);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), beak);
        leg.position.set(s * 0.05, 0.05, 0);
        root.add(leg);
      }
      root.add(body, tail, head, ...wings);
      // Only the body casts a shadow: five hens shouldn't cost fifty shadow draws.
      shadowed(root, false);
      body.castShadow = true;
      const x = area.xMin + r() * (area.xMax - area.xMin);
      const z = area.zMin + r() * (area.zMax - area.zMin);
      this.root.add(root);
      this.hens.push({ root, head, wings, x, z, heading: r() * 6.28, tx: x, tz: z, peck: r() * 2, phase: r() * 10, fleeing: 0 });
    }
  }

  private updateHens(dt: number, f: HomesteadFrame): void {
    const area = yardLayout(layout).hens;
    const fig = yardLayout(layout).fig;
    const r = this.r;
    const night = f.hour >= 20.5 || f.hour < 6;
    this.hens.forEach((h, i) => {
      h.phase += dt;
      const toPlayer = Math.hypot(h.x - f.player.x, h.z - f.player.z);
      let speed = 0;
      if (night) {
        // Roosting: huddled together under the fig.
        const a = (i / this.hens.length) * Math.PI * 2;
        h.tx = fig.x + Math.cos(a) * 1.1;
        h.tz = fig.z + Math.sin(a) * 1.1;
      } else if (toPlayer < 2.4) {
        // Scatter from the shepherd's feet.
        h.fleeing = 0.8;
        const ax = h.x - f.player.x;
        const az = h.z - f.player.z;
        h.tx = h.x + (ax / (toPlayer || 1)) * 3 + (r() - 0.5);
        h.tz = h.z + (az / (toPlayer || 1)) * 3 + (r() - 0.5);
      } else if (h.peck <= 0 && Math.hypot(h.tx - h.x, h.tz - h.z) < 0.15) {
        // Pick somewhere new to scratch.
        for (let k = 0; k < 6; k++) {
          const x = Math.min(area.xMax, Math.max(area.xMin, h.x + (r() - 0.5) * 6));
          const z = Math.min(area.zMax, Math.max(area.zMin, h.z + (r() - 0.5) * 6));
          if (!f.blocked(x, z, 0.25)) {
            h.tx = x;
            h.tz = z;
            break;
          }
        }
        h.peck = 1 + r() * 4;
      }
      h.fleeing = Math.max(0, h.fleeing - dt);
      const dx = h.tx - h.x;
      const dz = h.tz - h.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.1) {
        speed = h.fleeing > 0 ? 2.6 : night ? 0.8 : 0.55;
        // Hens walk in little bursts.
        if (h.fleeing === 0 && Math.sin(h.phase * 5) < -0.2) speed *= 0.2;
        const want = Math.atan2(dx, dz);
        let da = want - h.heading;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        h.heading += da * Math.min(1, dt * 8);
        const step = Math.min(dist, speed * dt);
        const nx = h.x + Math.sin(h.heading) * step;
        const nz = h.z + Math.cos(h.heading) * step;
        if (!f.blocked(nx, nz, 0.2)) {
          h.x = nx;
          h.z = nz;
        } else {
          h.tx = h.x;
          h.tz = h.z;
        }
      } else if (!night) h.peck -= dt;
      const pecking = speed === 0 && !night && h.peck > 0 && Math.sin(h.phase * 7) > 0.3;
      h.head.rotation.x = pecking ? 1.1 : speed > 0 ? Math.sin(h.phase * 14) * 0.15 : 0;
      for (const [k, w] of h.wings.entries()) w.rotation.z = h.fleeing > 0 ? (k ? -1 : 1) * (0.6 + Math.sin(h.phase * 40) * 0.4) : 0;
      h.root.position.set(h.x, this.ground(h.x, h.z) + (speed > 1 ? Math.abs(Math.sin(h.phase * 18)) * 0.05 : 0), h.z);
      h.root.rotation.y = h.heading;
      h.root.scale.y = night && dist < 0.2 ? 0.75 : 1;
    });
  }

  update(dt: number, f: HomesteadFrame): void {
    if (this.palisade) this.palisade.visible = f.penReinforced;
    if (this.kibble) this.kibble.visible = f.bowlMeals > 0;
    if (this.sack) {
      const full = Math.min(1, f.sackMeals / 14);
      this.sack.visible = f.sackMeals > 0;
      this.sack.scale.set(1 + (1 - full) * 0.2, 0.45 + 0.55 * full, 1 + (1 - full) * 0.2);
    }
    if (this.stream) {
      this.stream.scale.x = this.stream.scale.z = 0.85 + Math.sin(f.time * 23) * 0.15;
    }
    this.ripples.forEach((ring, i) => {
      const k = (f.time * 0.9 + i * 0.5) % 1;
      ring.scale.setScalar(0.06 + k * 0.28);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
    });
    for (const w of this.washing) w.pivot.rotation.x = Math.sin(f.time * 1.3 + w.phase) * 0.12 + Math.sin(f.time * 3.1 + w.phase) * 0.04 - 0.05;
    this.updateHens(Math.min(dt, 0.1), f);
  }
}

/** A small kilim: red and indigo bands with a row of diamonds. */
function kilimTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a8352a';
  g.fillRect(0, 0, 64, 48);
  g.fillStyle = '#2f3f6b';
  g.fillRect(0, 6, 64, 5);
  g.fillRect(0, 37, 64, 5);
  g.fillStyle = '#e9d9b0';
  for (let x = 4; x < 64; x += 14) {
    g.beginPath();
    g.moveTo(x + 6, 15);
    g.lineTo(x + 12, 24);
    g.lineTo(x + 6, 33);
    g.lineTo(x, 24);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#d9a441';
  for (let x = 8; x < 64; x += 14) g.fillRect(x + 1, 22, 4, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

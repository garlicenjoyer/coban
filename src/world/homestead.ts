// Prop builders shared by every map: the ağıl with its gate, the çeşme trough, the cottage
// with porch and cypresses, dry-stone walls, the terraced olive grove and the temple ruin.
// Each takes positions from the map's layout, so the homestead looks and collides the same
// wherever a map puts it.

import type { Label, Layout, Prop, V2 } from './mapTypes';
import { rng } from './noise';
import type { Terrain } from './terrain';

export interface Grove {
  xMin: number;
  xMax: number;
  rows: number[];
  spacing: number;
  walls: number[];
  wallFrom: number;
  wallTo: number;
  gaps: number[];
}

/** Pen fences, the gate (a separate box the sim opens and closes) and the çeşme trough. */
export function penProps(t: Terrain, l: Layout, props: Prop[], labels: Label[]): { gy: number } {
  const pen = l.pen;
  const gy = t.heightAt(pen.x, pen.z);
  const fh = pen.fenceHeight / 2;
  const th = 0.08;
  const x0 = pen.x - pen.hx;
  const x1 = pen.x + pen.hx;
  const z0 = pen.z - pen.hz;
  const z1 = pen.z + pen.hz;
  const gw = pen.gateWidth / 2;
  const wall = (ax: number, az: number, bx: number, bz: number) =>
    props.push({
      kind: 'box',
      role: 'fence',
      x: (ax + bx) / 2,
      y: gy + fh,
      z: (az + bz) / 2,
      hx: Math.max(th, Math.abs(bx - ax) / 2),
      hy: fh,
      hz: Math.max(th, Math.abs(bz - az) / 2),
    });
  wall(x0, z0, x1, z0); // north
  wall(x0, z1, x1, z1); // south
  wall(x0, z0, x0, z1); // west
  wall(x1, z0, x1, pen.z - gw); // east, north of gate
  wall(x1, pen.z + gw, x1, z1); // east, south of gate
  props.push({ kind: 'box', role: 'gate', x: x1, y: gy + fh, z: pen.z, hx: th, hy: fh, hz: gw });

  const cesme = l.cesme;
  props.push({ kind: 'box', role: 'trough', ...cesme, y: gy + 0.3, hx: 0.4, hy: 0.3, hz: 1.5 });
  // The fountain wall behind the trough, and the shelter's front posts inside the ağıl.
  const fw = cesmeWall(l);
  props.push({ kind: 'box', role: 'cesme', x: fw.x, y: t.heightAt(fw.x, fw.z) + fw.h / 2, z: fw.z, hx: fw.hx, hy: fw.h / 2, hz: fw.hz });
  for (const p of shelterPosts(l)) props.push({ kind: 'cyl', role: 'post', x: p.x, y: t.heightAt(p.x, p.z), z: p.z, radius: 0.09, height: SHELTER.front });
  labels.push({ text: 'Çeşme', ...cesme, lift: 2.3, color: 0x9fd0dc });
  for (const spring of l.springs) labels.push({ text: spring.name, x: spring.x, z: spring.z, lift: 2.1, color: 0x9fd0dc });
  return { gy };
}

// ---------- the homestead's dressing (positions shared by the colliders and the views) ----------

/** The lean-to shelter along the ağıl's north wall: depth, and roof height at the wall and the front. */
export const SHELTER = { depth: 2.4, back: 2.1, front: 1.75 };

/** The shelter's front posts, inside the pen. */
export function shelterPosts(l: Layout): V2[] {
  const p = l.pen;
  const z = p.z - p.hz + SHELTER.depth;
  return [-0.6, 0, 0.6].map((k) => ({ x: p.x + k * p.hx, z }));
}

/** The çeşme's fountain wall, on the far side of its trough from the pen. */
export function cesmeWall(l: Layout): { x: number; z: number; hx: number; hz: number; h: number } {
  return { x: l.cesme.x + 0.4 + 0.45, z: l.cesme.z, hx: 0.45, hz: 1.15, h: 2.2 };
}

/** Where the yard's things stand, relative to the cottage and the ağıl. */
export function yardLayout(l: Layout) {
  const h = l.house;
  const p = l.pen;
  return {
    /** Behind the cottage, shading the back wall. */
    fig: { x: h.x - 1, z: h.z + h.hz + 5.5 },
    /** A tall stack of hay south of the ağıl, for the winter. */
    hay: { x: p.x - 5, z: p.z + p.hz + 5.5, r: 1.4, h: 2.4 },
    /** The clay bread oven, east of the cottage by the woodpile. */
    oven: { x: h.x + h.hx + 4, z: h.z - 2.5, r: 0.6 },
    /** Clothesline posts, west of the porch. */
    line: [
      { x: h.x - h.hx - 2.3, z: h.z - h.hz - 3.9 },
      { x: h.x - h.hx - 2.3, z: h.z - h.hz + 1.3 },
    ] as V2[],
    /** Flagstones from the porch toward the gate. */
    path: { from: { x: h.x - 0.5, z: h.z - h.hz - h.porchDepth - 0.4 }, to: { x: p.x + p.hx + 4, z: p.z + 2 } },
    /** The milking stand inside the ağıl, by the gate, and the churn waiting outside it. */
    milking: { x: p.x + p.hx - 2.5, z: p.z + p.hz - 1.8 },
    churn: { x: p.x + p.hx + 1.8, z: p.z - p.gateWidth / 2 - 2.4 },
    /** Where the cheese press and its ageing shelf go, east of the cottage. */
    press: { x: h.x + h.hx + 3.6, z: h.z + 0.2 },
    /** Karabaş's bowl and Uncle Ahmet's sack of kibble, on the porch east of the door. */
    bowl: { x: h.x + 3.0, z: h.z - h.hz - 0.5 },
    sack: { x: h.x + 3.6, z: h.z - h.hz - 0.25 },
    /** Where the hens scratch about. */
    hens: { xMin: h.x - h.hx - 3, xMax: h.x + h.hx + 6, zMin: h.z - h.hz - h.porchDepth - 5, zMax: h.z + h.hz + 4 },
  };
}

/** The yard's solid things: the fig's trunk, the haystack, the oven, the clothesline posts. */
export function yardProps(t: Terrain, l: Layout, props: Prop[]): void {
  const y = yardLayout(l);
  props.push({ kind: 'cyl', role: 'fig', x: y.fig.x, y: t.heightAt(y.fig.x, y.fig.z), z: y.fig.z, radius: 0.3, height: 2.2 });
  props.push({ kind: 'cyl', role: 'hay', x: y.hay.x, y: t.heightAt(y.hay.x, y.hay.z), z: y.hay.z, radius: y.hay.r, height: y.hay.h });
  props.push({ kind: 'cyl', role: 'oven', x: y.oven.x, y: t.heightAt(y.oven.x, y.oven.z), z: y.oven.z, radius: y.oven.r, height: 1.0 });
  for (const q of y.line) props.push({ kind: 'cyl', role: 'post', x: q.x, y: t.heightAt(q.x, q.z), z: q.z, radius: 0.06, height: 1.9 });
}

/** Dry-stone wall colliders in ~6 m pieces so they sit on the ground as it rolls. */
export function stoneWaller(t: Terrain, props: Prop[]) {
  return (ax: number, az: number, bx: number, bz: number, height = 0.75) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 6));
    for (let i = 0; i < n; i++) {
      const x0 = ax + ((bx - ax) * i) / n;
      const z0 = az + ((bz - az) * i) / n;
      const x1 = ax + ((bx - ax) * (i + 1)) / n;
      const z1 = az + ((bz - az) * (i + 1)) / n;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      props.push({
        kind: 'box',
        role: 'wall',
        x: mx,
        y: t.heightAt(mx, mz) + height / 2 - 0.1,
        z: mz,
        hx: Math.max(0.28, Math.abs(x1 - x0) / 2),
        hy: height / 2,
        hz: Math.max(0.28, Math.abs(z1 - z0) / 2),
      });
    }
  };
}

/** The cottage, its porch (bench, çay table, woodpile) and three cypresses. */
export function houseProps(t: Terrain, l: Layout, props: Prop[]): void {
  const hs = l.house;
  const hy = t.heightAt(hs.x, hs.z);
  props.push({ kind: 'box', role: 'house', x: hs.x, y: hy + hs.wallHeight / 2, z: hs.z, hx: hs.hx + 0.15, hy: hs.wallHeight / 2, hz: hs.hz + 0.15 });
  const porchZ = hs.z - hs.hz - hs.porchDepth + 0.3;
  for (const px of [hs.x - 2.5, hs.x + 2.5]) props.push({ kind: 'cyl', role: 'porch', x: px, y: hy, z: porchZ, radius: 0.12, height: 2.4 });
  props.push({ kind: 'box', role: 'porch', x: hs.x - 2.2, y: hy + 0.22, z: hs.z - hs.hz - 0.45, hx: 0.8, hy: 0.22, hz: 0.22 }); // bench
  props.push({ kind: 'box', role: 'porch', x: hs.x + 1.6, y: hy + 0.4, z: hs.z - hs.hz - 1.5, hx: 0.35, hy: 0.4, hz: 0.35 }); // çay table
  props.push({ kind: 'box', role: 'porch', x: hs.x + hs.hx + 0.6, y: hy + 0.55, z: hs.z + 0.5, hx: 0.45, hy: 0.55, hz: 1.4 }); // woodpile
  for (const [cx, cz] of [
    [hs.x - hs.hx - 2.6, hs.z + 2.2],
    [hs.x + hs.hx + 2.2, hs.z + 3.0],
    [l.pen.x - l.pen.hx - 3, l.pen.z + l.pen.hz + 2],
  ])
    props.push({ kind: 'cyl', role: 'cypress', x: cx, y: t.heightAt(cx, cz) - 0.2, z: cz, radius: 0.45, height: 8 + ((cx * 7 + cz) % 3) });
  yardProps(t, l, props);
}

/** The grove's terrace walls (with gaps to walk through) and the yard's west wall. */
export function groveWalls(l: Layout, gr: Grove, stoneWall: ReturnType<typeof stoneWaller>): void {
  for (const wz of gr.walls) {
    let x = gr.wallFrom;
    for (const gap of [...gr.gaps, Infinity]) {
      const end = Math.min(gr.wallTo, gap - 1.6);
      if (end > x) stoneWall(x, wz, end, wz);
      x = gap + 1.6;
      if (x >= gr.wallTo) break;
    }
  }
  const hs = l.house;
  stoneWall(hs.x - hs.hx - 4.5, hs.z - hs.hz - 2, hs.x - hs.hx - 4.5, hs.z + hs.hz + 4, 0.65);
}

/** Olive trees in the grove rows, kept off the roads. */
export function groveOlives(t: Terrain, gr: Grove, props: Prop[], roadDistance: (x: number, z: number) => number): void {
  const ro = rng(77);
  for (const rz of gr.rows) {
    for (let ox = gr.xMin; ox <= gr.xMax; ox += gr.spacing) {
      const x = ox + (ro() - 0.5) * 2.5;
      const z = rz + (ro() - 0.5) * 2;
      if (roadDistance(x, z) < 7) continue;
      props.push({ kind: 'cyl', role: 'olive', x, y: t.heightAt(x, z) - 0.1, z, radius: 0.35, height: 2.2 + ro() * 1.4 });
    }
  }
}

/** The ruin: a low platform, columns (some broken), fallen drums and blocks. */
export function ruinProps(t: Terrain, l: Layout, props: Prop[]): void {
  const ru = l.ruins;
  const ry = t.heightAt(ru.x, ru.z);
  props.push({ kind: 'box', role: 'ruin', x: ru.x, y: ry + 0.05, z: ru.z, hx: ru.hx, hy: 0.15, hz: ru.hz, ramp: 0.3 });
  const colHeights = [4.6, 2.1, 4.6, 0.6, 3.3, 4.6, 1.4, 4.6];
  let ci = 0;
  for (const cz of [-2.6, 2.6])
    for (const cx of [-4.5, -1.5, 1.5, 4.5]) {
      props.push({ kind: 'cyl', role: 'column', x: ru.x + cx, y: ry + 0.2, z: ru.z + cz, radius: 0.42, height: colHeights[ci++] });
    }
  props.push({ kind: 'box', role: 'ruin', x: ru.x + 3, y: ry + 0.4, z: ru.z + 6.2, hx: 1.6, hy: 0.4, hz: 0.42 }); // fallen drum
  props.push({ kind: 'box', role: 'ruin', x: ru.x - 8.5, y: ry + 0.4, z: ru.z - 1, hx: 0.42, hy: 0.4, hz: 1.2 }); // fallen drum
  props.push({ kind: 'box', role: 'ruin', x: ru.x - 3.5, y: ry + 0.35, z: ru.z - 5.6, hx: 1.3, hy: 0.35, hz: 0.5 }); // architrave block
}

/** One stretch of a broken wall: centre, half extents and how high it still stands. */
export interface RuinWall {
  x: number;
  z: number;
  hx: number;
  hz: number;
  height: number;
}

/**
 * Uncle Ahmet's fallen hut: the walls still stand to between knee and chest height, the
 * roof is down, and the doorway faces east (where the new door goes).
 */
export function hutRuinWalls(h: Layout['works']['hut']): RuinWall[] {
  const t = 0.3;
  const door = 0.5;
  const eastN = (h.z - h.hz + (h.z - door)) / 2;
  const eastS = (h.z + door + (h.z + h.hz)) / 2;
  const eastHalf = (h.hz - door) / 2;
  return [
    { x: h.x - h.hx + t / 2, z: h.z, hx: t / 2, hz: h.hz, height: 1.45 }, // west, the back wall
    { x: h.x, z: h.z - h.hz + t / 2, hx: h.hx, hz: t / 2, height: 1.05 }, // north
    { x: h.x - h.hx / 2, z: h.z + h.hz - t / 2, hx: h.hx / 2, hz: t / 2, height: 0.9 }, // south, west half
    { x: h.x + h.hx / 2, z: h.z + h.hz - t / 2, hx: h.hx / 2, hz: t / 2, height: 0.45 }, // south, fallen in
    { x: h.x + h.hx - t / 2, z: eastN, hx: t / 2, hz: eastHalf, height: 1.15 }, // east, north of the door
    { x: h.x + h.hx - t / 2, z: eastS, hx: t / 2, hz: eastHalf, height: 0.6 }, // east, south of the door
  ];
}

/** Colliders for the fallen hut's walls. */
export function hutRuinProps(t: Terrain, l: Layout, props: Prop[]): void {
  const h = l.works.hut;
  const y = t.heightAt(h.x, h.z);
  for (const w of hutRuinWalls(h)) props.push({ kind: 'box', role: 'hutRuin', x: w.x, y: y + w.height / 2 - 0.1, z: w.z, hx: w.hx, hy: w.height / 2, hz: w.hz });
}

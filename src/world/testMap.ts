// The greybox test map (GDD, Part IV): 400 x 400 m with a pen, three pastures at
// ~100/250/350 m, a 25° hill, a 35° cliff band, a ravine, a gravel loop, a mud patch,
// thorn bushes, a trough and a strip of forest. Pure data: no three.js, no Rapier,
// so the simulation and tests can build it headless.

import type { Decor, Label, Layout, MapDef, MapProps, Prop, Sketcher } from './mapTypes';
import { groveOlives, groveWalls, houseProps, penProps, ruinProps, stoneWaller } from './homestead';
import { fbm, rng } from './noise';
import { Surface, Terrain } from './terrain';

export type { BoxProp, CylProp, Decor, Label, MapProps, Prop, PropRole } from './mapTypes';

export const MAP_SIZE = 400;
export const MAP_SAMPLES = 257; // 256 cells, 1.5625 m per cell

type V2 = { x: number; z: number };

export const layout = {
  bounds: { walk: 172, edge: 165 },
  pen: { x: -140, z: 140, hx: 10, hz: 7, gateWidth: 3, fenceHeight: 1.2 },
  cesme: { x: -126, z: 146 },
  penTrough: { x: -146, z: 143 },
  springs: [
    { name: 'Pasture A spring', x: -47, z: 88, radius: 2.4 },
    { name: 'Pasture B spring', x: 99, z: 17, radius: 2.4 },
  ],
  pastures: [
    { id: 'A', x: -50, z: 100, r: 24, color: 0xe0b040 },
    { id: 'B', x: 90, z: 20, r: 28, color: 0xd06a3a },
    { id: 'C', x: 120, z: -90, r: 28, color: 0x9a5ac8, note: 'dry' },
  ] as Layout['pastures'],
  hill: {
    x: -20,
    z: -40,
    plateau: 12,
    flank: 43,
    height: 20, // 20/43 ≈ 25°
    // The gravel loop crosses the hill as a packed-dirt road (the bike can climb 25° on dirt).
    /** A muddy flank to the south-east: too slippery to ride up (walk-only ground). */
    mudFlank: { angleDeg: 45, halfWidthDeg: 16 },
  },
  cliff: { zFoot: -150, rise: 12, run: 17, xMin: -195, xMax: 60, rampRun: 25 }, // 12/17 ≈ 35°
  ravine: { a: { x: -170, z: -100 }, b: { x: -90, z: 10 }, depth: 6, halfWidth: 10, wall: 6 },
  mud: { x: 40, z: 120, r: 16 },
  track: { cx: 20, cz: 40, rx: 130, rz: 95, halfWidth: 3 },
  spur: { a: { x: -128, z: 140 }, b: { x: -92.6, z: 87.5 }, halfWidth: 2.2 },
  thornCluster: { x: -50, z: 40, r: 22, count: 18 },
  forest: { xMin: -185, xMax: -40, zMin: -146, zMax: -112, count: 46 },
  /** The shepherd's cottage: door on the north side, facing the ağıl. */
  house: { x: -112, z: 160, hx: 3.5, hz: 2.5, wallHeight: 2.7, porchDepth: 3 },
  /** Terraced olive grove south of pasture A: rows of trees behind dry-stone walls. */
  grove: { xMin: -96, xMax: -40, rows: [134, 142, 150, 158], spacing: 8, walls: [130, 146], wallFrom: -100, wallTo: -48, gaps: [-75, -48] },
  /** A small ancient temple ruin in a clearing in the forest strip. */
  ruins: { x: -75, z: -128, hx: 6, hz: 3.5, clear: 16 },
  /** Where the wolves live: deep in the forest strip to the north-west. */
  wolfDen: { x: -160, z: -132 },
  /** Their ground announces itself: old bones, scat, a tuft of wool, prints in the dust. */
  wolfSigns: [
    { x: -140, z: -104, kind: 'bones' },
    { x: -128, z: -118, kind: 'scat' },
    { x: -150, z: -97, kind: 'tuft' },
    { x: -122, z: -106, kind: 'prints' },
    { x: -178, z: -108, kind: 'scat' },
    { x: -135, z: -90, kind: 'prints' },
    { x: -115, z: -122, kind: 'bones' },
  ] as Layout['wolfSigns'],
  /**
   * Things the shepherd can build that stay. The hut by Pasture B has a dry-stone fold
   * (open to the east) where the flock can spend the night with him; the cistern at dry
   * Pasture C collects rain.
   */
  works: {
    hut: { x: 58, z: 40.5, hx: 2.4, hz: 1.8, wallHeight: 2.3 },
    fold: { xMin: 54, xMax: 66, zMin: 44, zMax: 53, wall: 0.8 },
    cistern: { x: 104, z: -76, radius: 1.5 },
  },
  /** Places whose first arrival is worth a moment (and the music). */
  places: [
    { id: 'A', label: 'Pasture A', x: -50, z: 100, r: 17, by: 'flock' },
    { id: 'B', label: 'Pasture B', x: 90, z: 20, r: 20, by: 'flock' },
    { id: 'C', label: 'Pasture C', x: 120, z: -90, r: 20, by: 'flock' },
    { id: 'hilltop', label: 'the hilltop', x: -20, z: -40, r: 11, by: 'player' },
    { id: 'ruins', label: 'the ruins', x: -75, z: -128, r: 9, by: 'player' },
  ] as { id: string; label: string; x: number; z: number; r: number; by: 'flock' | 'player' }[],
  spawn: { x: -124, z: 136 },
  bikeSpawn: { x: -117, z: 147, headingDeg: 60 },
  dogSpawn: { x: -122, z: 131 },
};

// ---------- geometry helpers ----------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

function segInfo(p: V2, a: V2, b: V2): { d: number; t: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const t = clamp01(((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz));
  const qx = a.x + abx * t;
  const qz = a.z + abz * t;
  return { d: Math.hypot(p.x - qx, p.z - qz), t };
}

/** Approximate distance from p to the track ellipse (radial). */
export function trackDistance(x: number, z: number): number {
  const { cx, cz, rx, rz } = layout.track;
  const dx = x - cx;
  const dz = z - cz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return Math.min(rx, rz);
  const q = Math.hypot(dx / rx, dz / rz);
  return Math.abs(len - len / q);
}

export function spurDistance(x: number, z: number): number {
  return segInfo({ x, z }, layout.spur.a, layout.spur.b).d;
}

export function ravineInfo(x: number, z: number) {
  return segInfo({ x, z }, layout.ravine.a, layout.ravine.b);
}

/** The packed-dirt yard around the cottage (and its porch). */
export function inYard(x: number, z: number, margin = 0): boolean {
  const h = layout.house;
  return x > h.x - h.hx - 4 - margin && x < h.x + h.hx + 3 + margin && z > h.z - h.hz - h.porchDepth - 2.5 - margin && z < h.z + h.hz + 3 + margin;
}

export function inGrove(x: number, z: number, margin = 0): boolean {
  const g = layout.grove;
  return x > g.wallFrom - margin && x < g.wallTo + margin && z > g.walls[0] - margin && z < g.rows[g.rows.length - 1] + 5 + margin;
}

export function nearRuins(x: number, z: number, margin = 0): boolean {
  const r = layout.ruins;
  return Math.hypot(x - r.x, z - r.z) < r.clear + margin;
}

export function insideFold(x: number, z: number, margin = 0): boolean {
  const f = layout.works.fold;
  return x > f.xMin + f.wall / 2 - margin && x < f.xMax + margin && z > f.zMin + f.wall / 2 - margin && z < f.zMax - f.wall / 2 + margin;
}

export function insidePen(x: number, z: number, margin = 0): boolean {
  const p = layout.pen;
  return Math.abs(x - p.x) <= p.hx + margin && Math.abs(z - p.z) <= p.hz + margin;
}

// ---------- height ----------

function rawHeight(x: number, z: number): number {
  // Gentle rolling base with a little small-scale roughness.
  let h = 1.6 * fbm(x / 70 + 10, z / 70 - 4, 4, 3) + 0.35 * fbm(x / 14, z / 14, 3, 11);

  // 25° hill: plateau + linear flank.
  const hl = layout.hill;
  const rh = Math.hypot(x - hl.x, z - hl.z);
  h += hl.height * clamp01((hl.plateau + hl.flank - rh) / hl.flank);

  // 35° cliff band to the north, with a gentle ramp at its east end.
  const c = layout.cliff;
  const across = clamp01((c.zFoot - z) / c.run);
  const along = clamp01((c.xMax - x) / c.rampRun);
  h += c.rise * across * along;

  // Ravine: steep walls, gentle exit ramps at both ends.
  const rv = ravineInfo(x, z);
  const endRamp = smooth(clamp01(rv.t / 0.18)) * smooth(clamp01((1 - rv.t) / 0.18));
  h -= layout.ravine.depth * clamp01((layout.ravine.halfWidth - rv.d) / layout.ravine.wall) * endRamp;

  // Mud sits in a shallow dip.
  const m = layout.mud;
  h -= 0.5 * smooth(clamp01((m.r - Math.hypot(x - m.x, z - m.z)) / 6));

  // Map rim: gentle grassy hills rolling up toward the edge (under 25°), so the valley
  // runs on into the distant landscape instead of ending at a wall.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 165) {
    const t = Math.min(1, (edge - 165) / 35);
    h += ((9 * (1 - Math.cos(Math.PI * t))) / 2) * (0.8 + 0.2 * fbm(x / 50, z / 50, 2, 91));
  }

  return h;
}

export function buildTerrain(): Terrain {
  const t = new Terrain(MAP_SIZE, MAP_SAMPLES);
  const N = t.N;
  const pen = layout.pen;
  const penLevel = rawHeight(pen.x, pen.z);
  const penFlat = (x: number, z: number) => {
    const h = rawHeight(x, z);
    return h + (penLevel - h) * smooth(clamp01((36 - Math.hypot(x - pen.x, z - pen.z)) / 14));
  };
  const hs = layout.house;
  const houseLevel = penFlat(hs.x, hs.z - 1);
  const ru = layout.ruins;
  const ruinLevel = rawHeight(ru.x, ru.z);

  for (let ix = 0; ix < N; ix++) {
    for (let iz = 0; iz < N; iz++) {
      const x = t.xOf(ix);
      const z = t.zOf(iz);
      // Flatten the homestead: the pen, then the house pad and yard.
      let h = penFlat(x, z);
      const rh = Math.max(Math.abs(x - hs.x) - hs.hx - 3, Math.abs(z - hs.z + 1) - hs.hz - 3.5, 0);
      h += (houseLevel - h) * smooth(clamp01(1 - rh / 9));
      // Level the ruin's footprint so its platform sits flat and can be stepped onto.
      const rr = Math.max(Math.abs(x - ru.x) - ru.hx - 2, Math.abs(z - ru.z) - ru.hz - 2, 0);
      h += (ruinLevel - h) * smooth(clamp01(1 - rr / 8));
      t.heights[t.idx(ix, iz)] = h;
    }
  }

  // Surfaces (needs final heights for slope).
  for (let ix = 0; ix < N; ix++) {
    for (let iz = 0; iz < N; iz++) {
      const x = t.xOf(ix);
      const z = t.zOf(iz);
      const wobble = 2.5 * fbm(x / 9, z / 9, 2, 23);
      let s = Surface.Grass;
      for (const p of layout.pastures) if (Math.hypot(x - p.x, z - p.z) < p.r + wobble) s = Surface.Pasture;
      if (insidePen(x, z, 1) || inYard(x, z)) s = Surface.Dirt;
      if (t.slopeDegAtSample(ix, iz) > 30) s = Surface.Rock;
      const hl = layout.hill;
      const rHill = Math.hypot(x - hl.x, z - hl.z);
      const onHill = rHill < hl.plateau + hl.flank + 4;
      if (onHill && rHill > hl.plateau - 2) {
        const ang = (Math.atan2(z - hl.z, x - hl.x) * 180) / Math.PI;
        let da = ang - hl.mudFlank.angleDeg;
        while (da > 180) da -= 360;
        while (da < -180) da += 360;
        if (Math.abs(da) < hl.mudFlank.halfWidthDeg + wobble * 2) s = Surface.Mud;
      }
      if (trackDistance(x, z) < layout.track.halfWidth || spurDistance(x, z) < layout.spur.halfWidth)
        s = onHill ? Surface.Dirt : Surface.Gravel;
      if (Math.hypot(x - layout.mud.x, z - layout.mud.z) < layout.mud.r + wobble) s = Surface.Mud;
      t.surfaces[t.idx(ix, iz)] = s;
    }
  }
  return t;
}

// ---------- props ----------

export function buildProps(t: Terrain): MapProps {
  const props: Prop[] = [];
  const labels: Label[] = [];
  const pen = layout.pen;
  penProps(t, layout, props, labels);
  const x1 = pen.x + pen.hx;
  const z1 = pen.z + pen.hz;
  const gate = { x: x1, z: pen.z };
  const pastureDistances: Record<string, number> = {};
  for (const p of layout.pastures) {
    const d = Math.round(Math.hypot(p.x - gate.x, p.z - gate.z));
    pastureDistances[p.id] = d;
    props.push({ kind: 'cyl', role: 'marker', x: p.x, y: t.heightAt(p.x, p.z), z: p.z, radius: 0.12, height: 4 });
    labels.push({ text: `Pasture ${p.id} · ${d} m${p.note ? ` · ${p.note}` : ''}`, x: p.x, z: p.z, lift: 5, color: p.color });
  }

  // Thorn bushes: a dense cluster plus scattered maquis.
  const r = rng(42);
  const okForBush = (x: number, z: number) =>
    trackDistance(x, z) > 6 &&
    spurDistance(x, z) > 5 &&
    !insidePen(x, z, 16) &&
    !inYard(x, z, 6) &&
    !inGrove(x, z, 4) &&
    !nearRuins(x, z, 2) &&
    ravineInfo(x, z).d > 12 &&
    Math.abs(x) < 175 &&
    Math.abs(z) < 175 &&
    layout.pastures.every((p) => Math.hypot(x - p.x, z - p.z) > p.r + 4) &&
    t.slopeDegAt(x, z) < 28;
  const addBush = (x: number, z: number) => {
    const radius = 0.7 + r() * 0.9;
    props.push({ kind: 'cyl', role: 'thorn', x, y: t.heightAt(x, z) - 0.1, z, radius, height: 0.9 + r() * 0.5 });
  };
  const tc = layout.thornCluster;
  for (let i = 0, tries = 0; i < tc.count && tries < 500; tries++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * tc.r;
    const x = tc.x + Math.cos(a) * d;
    const z = tc.z + Math.sin(a) * d;
    if (!okForBush(x, z)) continue;
    addBush(x, z);
    i++;
  }
  for (let i = 0, tries = 0; i < 45 && tries < 2000; tries++) {
    const x = (r() - 0.5) * 340;
    const z = (r() - 0.5) * 340;
    if (!okForBush(x, z)) continue;
    addBush(x, z);
    i++;
  }

  // Forest strip at the foot of the cliff.
  const f = layout.forest;
  for (let i = 0, tries = 0; i < f.count && tries < 1000; tries++) {
    const x = f.xMin + r() * (f.xMax - f.xMin);
    const z = f.zMin + r() * (f.zMax - f.zMin);
    if (ravineInfo(x, z).d < 12 || t.slopeDegAt(x, z) > 30 || nearRuins(x, z)) continue;
    props.push({ kind: 'cyl', role: 'trunk', x, y: t.heightAt(x, z) - 0.2, z, radius: 0.28, height: 7 + r() * 3 });
    i++;
  }

  // ---------------------------------------------------------------- homestead
  const hs = layout.house;
  houseProps(t, layout, props);
  const gr = layout.grove;
  groveWalls(layout, gr, stoneWaller(t, props));
  groveOlives(t, gr, props, trackDistance);
  const ru = layout.ruins;
  ruinProps(t, layout, props);

  // Boulders and scattered trees: anywhere open, away from paths and pastures.
  const open = (x: number, z: number, pad: number) =>
    trackDistance(x, z) > pad + 4 &&
    spurDistance(x, z) > pad + 3 &&
    !insidePen(x, z, pad + 10) &&
    !inYard(x, z, pad + 2) &&
    !inGrove(x, z, pad + 1) &&
    !nearRuins(x, z, pad) &&
    ravineInfo(x, z).d > pad + 11 &&
    Math.abs(x) < 172 &&
    Math.abs(z) < 172 &&
    layout.pastures.every((pa) => Math.hypot(x - pa.x, z - pa.z) > pa.r + pad + 3) &&
    Math.hypot(x - layout.mud.x, z - layout.mud.z) > layout.mud.r + 4 &&
    !props.some((q) => q.kind === 'cyl' && Math.hypot(q.x - x, q.z - z) < q.radius + pad + 1);
  const rr = rng(99);
  for (let i = 0, tries = 0; i < 48 && tries < 4000; tries++) {
    const x = (rr() - 0.5) * 340;
    const z = (rr() - 0.5) * 340;
    const radius = 0.5 + rr() * rr() * 1.4;
    if (!open(x, z, radius) || t.slopeDegAt(x, z) > 32) continue;
    props.push({ kind: 'cyl', role: 'rock', x, y: t.heightAt(x, z) - radius * 0.3, z, radius, height: radius * (0.9 + rr() * 0.6) });
    i++;
  }
  for (let i = 0, tries = 0; i < 20 && tries < 3000; tries++) {
    const x = (rr() - 0.5) * 340;
    const z = (rr() - 0.5) * 340;
    if (!open(x, z, 2) || t.slopeDegAt(x, z) > 26) continue;
    props.push({ kind: 'cyl', role: 'pine', x, y: t.heightAt(x, z) - 0.2, z, radius: 0.3, height: 7 + rr() * 4 });
    i++;
  }

  // Maquis shrubs (decoration only): denser on slopes and toward the edges.
  const decor: Decor[] = [];
  const rd = rng(55);
  for (let tries = 0; decor.length < 650 && tries < 20000; tries++) {
    const x = (rd() - 0.5) * 360;
    const z = (rd() - 0.5) * 360;
    const sl = t.slopeDegAt(x, z);
    const want = 0.15 + Math.min(1, sl / 25) * 0.5 + (Math.max(Math.abs(x), Math.abs(z)) > 130 ? 0.3 : 0);
    if (rd() > want || sl > 34 || !open(x, z, 0.5)) continue;
    decor.push({ kind: 'shrub', x, z, s: 0.5 + rd() * 0.9, rot: rd() * Math.PI * 2, v: rd() });
  }

  const hl = layout.hill;
  labels.push(
    { text: 'Home', x: hs.x, z: hs.z, lift: 5 },
    { text: 'Olive grove', x: (gr.xMin + gr.xMax) / 2, z: 146, lift: 5 },
    { text: 'Ruins', x: ru.x, z: ru.z, lift: 6 },
    { text: 'Ağıl (pen)', x: pen.x, z: pen.z, lift: 4 },
    { text: 'Trough', x: x1 + 4, z: z1 - 1, lift: 2 },
    { text: 'Hill · 25° · dirt road', x: hl.x, z: hl.z, lift: 4 },
    {
      text: 'Mud flank',
      x: hl.x + Math.cos((hl.mudFlank.angleDeg * Math.PI) / 180) * (hl.plateau + hl.flank * 0.6),
      z: hl.z + Math.sin((hl.mudFlank.angleDeg * Math.PI) / 180) * (hl.plateau + hl.flank * 0.6),
      lift: 3,
    },
    { text: 'Cliff · 35°', x: -80, z: layout.cliff.zFoot - 8, lift: 4 },
    { text: 'Ravine', x: -130, z: -45, lift: 2 },
    { text: 'Mud', x: layout.mud.x, z: layout.mud.z, lift: 3 },
    { text: 'Thorns', x: tc.x, z: tc.z, lift: 3 },
    { text: 'Forest', x: (f.xMin + f.xMax) / 2, z: (f.zMin + f.zMax) / 2, lift: 11 },
    { text: 'Gravel loop', x: layout.track.cx + layout.track.rx, z: layout.track.cz, lift: 3 },
  );

  return { props, labels, decor, pastureDistances };
}

// ---------- map definition ----------

/** The test map's own features on the paper map: mud, ravine, cliffs, the gravel loop. */
function sketch(s: Sketcher): void {
  const { g, px, py, label, rnd } = s;
  const m = layout.mud;
  g.fillStyle = 'rgba(110, 80, 50, 0.35)';
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * m.r;
    g.fillRect(px(m.x + Math.cos(a) * r), py(m.z + Math.sin(a) * r), 2, 2);
  }
  label('mud', m.x, m.z + 2, 12, s.pencil);
  const rv = layout.ravine;
  g.strokeStyle = s.ink;
  g.lineWidth = 1.2;
  const rdx = rv.b.x - rv.a.x;
  const rdz = rv.b.z - rv.a.z;
  const rl = Math.hypot(rdx, rdz);
  const nx = -rdz / rl;
  const nz = rdx / rl;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(px(rv.a.x + nx * 5 * side), py(rv.a.z + nz * 5 * side));
    g.lineTo(px(rv.b.x + nx * 5 * side), py(rv.b.z + nz * 5 * side));
    g.stroke();
  }
  for (let d = 6; d < rl - 6; d += 4) {
    const x = rv.a.x + (rdx / rl) * d;
    const z = rv.a.z + (rdz / rl) * d;
    g.beginPath();
    g.moveTo(px(x + nx * 5), py(z + nz * 5));
    g.lineTo(px(x + nx * 2.5), py(z + nz * 2.5));
    g.moveTo(px(x - nx * 5), py(z - nz * 5));
    g.lineTo(px(x - nx * 2.5), py(z - nz * 2.5));
    g.stroke();
  }
  label('ravine', rv.a.x + rdx * 0.45 + nx * 12, rv.a.z + rdz * 0.45 + nz * 12, 13);
  const cl = layout.cliff;
  for (let x = cl.xMin + 4; x < cl.xMax - 10; x += 3) {
    g.beginPath();
    g.moveTo(px(x), py(cl.zFoot - cl.run));
    g.lineTo(px(x), py(cl.zFoot - cl.run + 6));
    g.stroke();
  }
  label('cliffs', -110, cl.zFoot - cl.run - 4, 13);

  // Roads: the gravel loop (dashed) and the track to the gate.
  const tr = layout.track;
  g.strokeStyle = 'rgba(120, 80, 40, 0.8)';
  g.lineWidth = 2;
  g.setLineDash([7, 5]);
  g.beginPath();
  g.ellipse(px(tr.cx), py(tr.cz), tr.rx * s.scale, tr.rz * s.scale, 0, 0, Math.PI * 2);
  g.moveTo(px(layout.spur.a.x), py(layout.spur.a.z));
  g.lineTo(px(layout.spur.b.x), py(layout.spur.b.z));
  g.stroke();
  g.setLineDash([]);

  label('olive grove', -68, 168, 14);
  label('forest', -150, -110, 15);
  label('ruins', layout.ruins.x, layout.ruins.z - 9, 13);
  label('hill', layout.hill.x, layout.hill.z + 3, 13);
}

export const TEST_MAP: MapDef = {
  id: 'test',
  title: 'The valley below Şirince',
  size: MAP_SIZE,
  layout,
  buildTerrain,
  buildProps,
  roadDistance: (x, z) => Math.min(trackDistance(x, z), spurDistance(x, z)),
  sketch,
  teleports: () => ({
    'Pen gate': [layout.spawn.x, layout.spawn.z],
    'Pasture A': [layout.pastures[0].x, layout.pastures[0].z],
    'Pasture B': [layout.pastures[1].x, layout.pastures[1].z],
    'Pasture C': [layout.pastures[2].x, layout.pastures[2].z],
    'Çeşme': [layout.cesme.x - 1.3, layout.cesme.z],
    'Pasture B spring': [layout.springs[1].x, layout.springs[1].z + 4],
    'Hill foot (south)': [layout.hill.x, layout.hill.z + layout.hill.plateau + layout.hill.flank + 6],
    'Cliff foot': [-100, layout.cliff.zFoot + 6],
    'Ravine floor': [(layout.ravine.a.x + layout.ravine.b.x) / 2, (layout.ravine.a.z + layout.ravine.b.z) / 2],
    'Mud patch': [layout.mud.x, layout.mud.z],
    'Thorn cluster': [layout.thornCluster.x + 26, layout.thornCluster.z],
    Forest: [-110, -128],
    'To the flock': [0, 0],
  }),
  scenario: {
    meadow: { x: -20, z: 98 },
    lost: { x: (layout.ravine.a.x + layout.ravine.b.x) / 2, z: (layout.ravine.a.z + layout.ravine.b.z) / 2 },
    lostWhere: 'the ravine',
    lostFlock: { x: -75, z: 70 },
    // The GDD's herding fun test: pen → Pasture B (about 260 m) → pen in 8 minutes.
    trialPasture: 'B',
    trialSeconds: 8 * 60,
  },
};

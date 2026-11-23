// The valley (GDD Part V, feature 4): the real map, about 1.2 km square, south-east of
// Selçuk below a Şirince-like village. Sized to the clock: one in-game hour is one real
// minute and a driven flock covers only about 650 m in a day, so the flock's pastures sit
// in rings around the ağıl and the outer ring is reached by bike.
//
//   up to ~150 m   the ağıl, çeşme, olive terraces, Pasture A (near, with a spring)
//   150–350 m      maquis hills: Pasture D (best grazing, spring), dry Pasture C (cistern)
//   350–600 m      far Pasture B (hut and fold, spring), Pasture E at the pine forest's edge
//                  (wolf country), the ruin in the pines
//   bike only      the hilltop lookout (dirt road) and the village (~1 km of gravel road)
//
// Uncle Ahmet walked these routes for forty years; his cairns still stand along them.
// Pure data like the test map: no three.js, no Rapier.

import { groveOlives, groveWalls, houseProps, hutRuinProps, penProps, ruinProps, stoneWaller, type Grove } from './homestead';
import type { Decor, Label, Layout, MapDef, MapProps, Prop, Sketcher, V2 } from './mapTypes';
import { fbm, rng } from './noise';
import { valleyNotes } from './valleyNotes';
import { Surface, Terrain } from './terrain';

export const VALLEY_SIZE = 1200;
export const VALLEY_SAMPLES = 601; // 600 cells, 2 m per cell (the grass map's texel)

const HALF = VALLEY_SIZE / 2;

// ---------- layout ----------

/** The homestead sits in the south-west, where the valley floor is lowest. */
const pen = { x: -380, z: 300, hx: 10, hz: 7, gateWidth: 3, fenceHeight: 1.2 };
const B = { id: 'B', x: -40, z: 50, r: 30, color: 0xd06a3a, note: 'far' };
const C = { id: 'C', x: -90, z: 335, r: 30, color: 0x9a5ac8, note: 'dry' };

export const valleyLayout: Layout & { grove: Grove; village: NonNullable<Layout['village']> } = {
  bounds: { walk: 556, edge: 545 },
  pen,
  cesme: { x: -366, z: 306 },
  penTrough: { x: -386, z: 303 },
  springs: [
    { name: 'Pasture A spring', x: -297, z: 193, radius: 2.4 },
    { name: 'Pasture B spring', x: -31, z: 47, radius: 2.4 },
    { name: 'Pasture D spring', x: -412, z: 10, radius: 2.4 },
    { name: 'the dere spring', x: -197, z: 74, radius: 2.4 },
  ],
  // Order matters (see Layout): A near, B far with the hut, C dry with the cistern.
  pastures: [
    { id: 'A', x: -300, z: 205, r: 26, color: 0xe0b040 },
    B,
    C,
    { id: 'D', x: -400, z: 20, r: 32, color: 0x5aa06a },
    { id: 'E', x: -470, z: -205, r: 30, color: 0x4a8ac0, note: 'wolf country' },
  ],
  hill: { x: 120, z: -140, plateau: 14, flank: 80, height: 34, mudFlank: { angleDeg: 45, halfWidthDeg: 16 } },
  thornCluster: { x: -360, z: 150, r: 22, count: 22 },
  house: { x: -352, z: 320, hx: 3.5, hz: 2.5, wallHeight: 2.7, porchDepth: 3 },
  /** Terraced olive grove east of the cottage. */
  grove: { xMin: -336, xMax: -280, rows: [294, 302, 310, 318], spacing: 8, walls: [290, 306], wallFrom: -340, wallTo: -288, gaps: [-315, -288] },
  ruins: { x: -260, z: -235, hx: 6, hz: 3.5, clear: 16 },
  wolfDen: { x: -480, z: -345 },
  wolfSigns: [
    { x: -470, z: -300, kind: 'bones' },
    { x: -455, z: -320, kind: 'scat' },
    { x: -500, z: -290, kind: 'tuft' },
    { x: -440, z: -305, kind: 'prints' },
    { x: -512, z: -330, kind: 'scat' },
    { x: -482, z: -268, kind: 'prints' },
    { x: -430, z: -336, kind: 'bones' },
  ],
  works: {
    hut: { x: B.x - 32, z: B.z + 20.5, hx: 2.4, hz: 1.8, wallHeight: 2.3, ruined: true },
    fold: { xMin: B.x - 36, xMax: B.x - 24, zMin: B.z + 24, zMax: B.z + 33, wall: 0.8 },
    cistern: { x: C.x - 16, z: C.z + 14, radius: 1.5 },
  },
  places: [
    { id: 'A', label: 'Pasture A', x: -300, z: 205, r: 18, by: 'flock' },
    { id: 'B', label: 'Pasture B', x: B.x, z: B.z, r: 21, by: 'flock' },
    { id: 'C', label: 'Pasture C', x: C.x, z: C.z, r: 21, by: 'flock' },
    { id: 'D', label: 'Pasture D', x: -400, z: 20, r: 22, by: 'flock' },
    { id: 'E', label: 'Pasture E', x: -470, z: -205, r: 21, by: 'flock' },
    { id: 'hilltop', label: 'the hilltop', x: 120, z: -140, r: 12, by: 'player' },
    { id: 'ruins', label: 'the ruins', x: -260, z: -235, r: 9, by: 'player' },
    { id: 'village', label: 'the village', x: 410, z: -365, r: 22, by: 'player' },
  ],
  spawn: { x: -364, z: 296 },
  bikeSpawn: { x: -357, z: 307, headingDeg: 60 },
  dogSpawn: { x: -362, z: 291 },
  village: {
    x: 410,
    z: -365,
    r: 22,
    minaret: { x: 410 - 26, z: -365 + 36, h: 16 },
    // Counters in front of the shops on the square (facing: the way the shopkeeper looks, radians).
    shops: [
      { id: 'dairy', x: 410 - 20.5, z: -365 - 4, facing: Math.PI / 2 },
      { id: 'bakkal', x: 410 + 20, z: -365 - 6, facing: -Math.PI / 2 },
      { id: 'usta', x: 410 + 22, z: -365 + 9, facing: -Math.PI / 2 },
      { id: 'kahvehane', x: 410, z: -365 + 13.5, facing: Math.PI },
      { id: 'muze', x: 410 - 22, z: -365 + 12, facing: Math.PI / 2 },
      // Round the back of the kahvehane, away from the square.
      { id: 'dealer', x: 410 + 4, z: -365 + 24.6, facing: 0 },
      // The vet's table under a parasol on the square (Thursdays only).
      { id: 'vet', x: 410 - 7, z: -365 + 5, facing: Math.PI },
    ],
  },
};

const L = valleyLayout;
const V = L.village;

/** The village square: flat, packed earth, the kahvehane on its south side. */
const SQUARE = { hx: 16, hz: 12 };

/** Village houses relative to the square: dx, dz, half-width, half-depth, wall height. */
const HOUSES: [number, number, number, number, number][] = [
  [-26, -4, 4, 3.5, 3.2],
  [-27, 12, 3.5, 3, 4.6],
  [26, -6, 4.5, 3.5, 4.8],
  [27, 9, 3.5, 3.5, 3.2],
  [-12, -24, 4, 3, 4.6],
  [6, -26, 4.5, 3.5, 3.2],
  [24, -24, 3.5, 3, 4.8],
  [43, -12, 4, 3.5, 3.2],
  [44, 6, 3.5, 3, 4.6],
  [-4, -42, 4, 3.5, 4.6],
  [16, -44, 3.5, 3, 3.2],
  [36, -40, 4, 3.5, 4.8],
  [56, -28, 3.5, 3.5, 3.2],
  [60, -6, 4, 3, 4.6],
  [-30, -26, 3.5, 3, 3.2],
  [32, 27, 4, 3, 3.2],
];
const KAHVEHANE: [number, number, number, number, number] = [0, 19, 6, 4, 3.6];
const MOSQUE: [number, number, number, number, number] = [-34, 28, 5, 5, 5];
const MINARET = { dx: V.minaret!.x - V.x, dz: V.minaret!.z - V.z, r: 1.1, h: V.minaret!.h };

// ---------- roads, riverbed, routes ----------

/** The gravel road: from the gate east along the valley floor, then up to the village. */
const MAIN_ROAD: V2[] = [
  { x: -368, z: 300 },
  { x: -345, z: 262 },
  { x: -290, z: 250 },
  { x: -200, z: 240 },
  { x: -120, z: 228 },
  { x: -30, z: 205 },
  { x: 60, z: 168 },
  { x: 150, z: 100 },
  { x: 230, z: 20 },
  { x: 285, z: -80 },
  { x: 320, z: -180 },
  { x: 350, z: -270 },
  { x: 385, z: -330 },
  { x: V.x, z: V.z },
];
/** The dirt road up to the lookout, leaving the gravel road and climbing the west flank. */
const HILL_ROAD: V2[] = [
  { x: 150, z: 100 },
  { x: 105, z: 30 },
  { x: 95, z: -60 },
  { x: 115, z: -128 },
];
/** The dere: a dry stony riverbed running down the valley from the north-east hills. */
const DERE: V2[] = [
  { x: 60, z: -620 },
  { x: -40, z: -380 },
  { x: -130, z: -200 },
  { x: -185, z: -40 },
  { x: -205, z: 70 },
  { x: -235, z: 160 },
  { x: -250, z: 260 },
  { x: -290, z: 400 },
  { x: -330, z: 620 },
];
const DERE_DEPTH = 3;
const DERE_HALF = 9;
const DERE_WALL = 7;
const MUD = { x: -202, z: 96, r: 12 };

/** Uncle Ahmet's old routes, marked with his cairns: home to D and on to E, home to B. */
const AHMET_ROUTES: V2[][] = [
  [
    { x: -375, z: 280 },
    { x: -395, z: 185 },
    { x: -405, z: 60 },
    { x: -415, z: -20 },
    { x: -450, z: -120 },
    { x: -466, z: -172 },
  ],
  [
    { x: -362, z: 285 },
    { x: -250, z: 205 },
    { x: -150, z: 125 },
    { x: -82, z: 80 },
  ],
];

const ROAD_HALF = { main: 3, hill: 2.6 };

/** Uncle Ahmet's notes and pencil marks (positions from the layout above). */
const AHMET = valleyNotes({ layout: L, routes: AHMET_ROUTES, ford: { x: -247, z: 252 } });

// ---------- geometry helpers ----------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

interface PolyHit {
  d: number;
  /** Arc length along the polyline at the nearest point, metres. */
  s: number;
}

function polyInfo(x: number, z: number, pts: V2[]): PolyHit {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const len = Math.sqrt(len2);
    const t = clamp01(((x - a.x) * abx + (z - a.z) * abz) / len2);
    const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
    if (d < best) {
      best = d;
      bestS = acc + t * len;
    }
    acc += len;
  }
  return { d: best, s: bestS };
}

function polyLength(pts: V2[]): number {
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) acc += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
  return acc;
}

function pointAt(pts: V2[], s: number): V2 {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= len || i + 2 === pts.length) {
      const t = clamp01(s / len);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    s -= len;
  }
  return pts[pts.length - 1];
}

export const mainRoadDistance = (x: number, z: number) => polyInfo(x, z, MAIN_ROAD).d;
export const hillRoadDistance = (x: number, z: number) => polyInfo(x, z, HILL_ROAD).d;
export const dereDistance = (x: number, z: number) => polyInfo(x, z, DERE).d;

/** Distance to the nearest road's centreline (both roads are about 6 m wide). */
function roadDistance(x: number, z: number): number {
  return Math.min(mainRoadDistance(x, z), hillRoadDistance(x, z));
}

export function inYard(x: number, z: number, margin = 0): boolean {
  const h = L.house;
  return x > h.x - h.hx - 4 - margin && x < h.x + h.hx + 3 + margin && z > h.z - h.hz - h.porchDepth - 2.5 - margin && z < h.z + h.hz + 3 + margin;
}

export function insidePen(x: number, z: number, margin = 0): boolean {
  return Math.abs(x - pen.x) <= pen.hx + margin && Math.abs(z - pen.z) <= pen.hz + margin;
}

function inGrove(x: number, z: number, margin = 0): boolean {
  const g = L.grove;
  return x > g.wallFrom - margin && x < g.wallTo + margin && z > g.walls[0] - margin && z < g.rows[g.rows.length - 1] + 5 + margin;
}

function nearRuins(x: number, z: number, margin = 0): boolean {
  return Math.hypot(x - L.ruins.x, z - L.ruins.z) < L.ruins.clear + margin;
}

function inVillage(x: number, z: number, margin = 0): boolean {
  return x > V.x - 48 - margin && x < V.x + 70 + margin && z > V.z - 56 - margin && z < V.z + 44 + margin;
}

function nearWorks(x: number, z: number, margin = 0): boolean {
  const f = L.works.fold;
  const c = L.works.cistern;
  return (x > f.xMin - 9 - margin && x < f.xMax + 4 + margin && z > f.zMin - 9 - margin && z < f.zMax + 3 + margin) || Math.hypot(x - c.x, z - c.z) < 7 + margin;
}

/** 1 in the pine forest (the north-west, thinning out at its ragged southern edge). */
function forestness(x: number, z: number): number {
  const edgeZ = -150 + 40 * fbm(x / 110, 3, 2, 61) + Math.max(0, x + 60) * 0.9;
  return smooth(clamp01((edgeZ - z) / 40)) * smooth(clamp01((40 - x) / 60));
}

/** The maquis band: rough, shrubby hills between the homestead and the forest. */
function maquisness(x: number, z: number): number {
  return smooth(clamp01((250 - z) / 150)) * smooth(clamp01((60 - x) / 120)) * (1 - forestness(x, z) * 0.6);
}

function pastureMask(x: number, z: number): number {
  let m = 0;
  for (const p of L.pastures) m = Math.max(m, smooth(clamp01((p.r + 25 - Math.hypot(x - p.x, z - p.z)) / 25)));
  return m;
}

// ---------- height ----------

function rawHeight(x: number, z: number): number {
  // The valley tilts down to the south-west: the village sits ~55 m above the homestead,
  // which stays near 0 m like the test map's (the morning mist pools below a few metres).
  let h = 22 + 0.03 * (x - z);
  // Gentle rolling everywhere, a little small-scale roughness.
  h += 2.4 * fbm(x / 140 + 10, z / 140 - 4, 4, 3) + 0.35 * fbm(x / 14, z / 14, 3, 11);
  // Maquis hills: bigger lumps, smoothed out where the pastures lie.
  h += 6 * fbm(x / 85 - 3, z / 85 + 7, 4, 19) * maquisness(x, z) * (1 - pastureMask(x, z));

  // The lookout hill: plateau + linear flank, a little lumpy.
  const hl = L.hill;
  const rh = Math.hypot(x - hl.x, z - hl.z);
  h += hl.height * clamp01((hl.plateau + hl.flank - rh) / hl.flank) * (1 + 0.06 * fbm(x / 30, z / 30, 2, 5));

  // The village knoll.
  h += 12 * smooth(clamp01((170 - Math.hypot(x - V.x, z - V.z)) / 130));

  // The dere: a shallow stony bed with sloping banks the flock can cross.
  const dd = dereDistance(x, z);
  h -= DERE_DEPTH * clamp01((DERE_HALF + DERE_WALL - dd) / DERE_WALL);

  // Mud sits in a shallow dip by the dere spring.
  h -= 0.5 * smooth(clamp01((MUD.r - Math.hypot(x - MUD.x, z - MUD.z)) / 6));

  // Map rim: hills rolling up toward the edge, so the valley runs on into the landscape.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > 540) {
    const t = Math.min(1, (edge - 540) / 60);
    h += ((22 * (1 - Math.cos(Math.PI * t))) / 2) * (0.8 + 0.2 * fbm(x / 60, z / 60, 2, 91));
  }
  return h;
}

/** Ease terrain toward a pad height inside a rectangle (plus a soft rim). */
function flattenRect(h: number, x: number, z: number, cx: number, cz: number, hx: number, hz: number, level: number, rim: number): number {
  const r = Math.max(Math.abs(x - cx) - hx, Math.abs(z - cz) - hz, 0);
  return h + (level - h) * smooth(clamp01(1 - r / rim));
}

/** Smooth a road's ground into a rideable profile (a running mean of the ground along it). */
function smoothRoad(t: Terrain, pts: V2[], half: number, window: number): void {
  const len = polyLength(pts);
  const STEP = 2;
  const n = Math.ceil(len / STEP) + 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = pointAt(pts, i * STEP);
    raw[i] = t.heightAt(p.x, p.z);
  }
  const w = Math.round(window / STEP);
  const prof = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) {
      sum += raw[k];
      cnt++;
    }
    prof[i] = sum / cnt;
  }
  const reach = half + 12;
  const minX = Math.min(...pts.map((p) => p.x)) - reach;
  const maxX = Math.max(...pts.map((p) => p.x)) + reach;
  const minZ = Math.min(...pts.map((p) => p.z)) - reach;
  const maxZ = Math.max(...pts.map((p) => p.z)) + reach;
  const next = new Map<number, number>();
  for (let ix = 0; ix < t.N; ix++) {
    const x = t.xOf(ix);
    if (x < minX || x > maxX) continue;
    for (let iz = 0; iz < t.N; iz++) {
      const z = t.zOf(iz);
      if (z < minZ || z > maxZ) continue;
      const hit = polyInfo(x, z, pts);
      if (hit.d > reach) continue;
      const k = Math.min(n - 1, Math.max(0, hit.s / STEP));
      const k0 = Math.floor(k);
      const k1 = Math.min(n - 1, k0 + 1);
      const level = prof[k0] + (prof[k1] - prof[k0]) * (k - k0);
      const i = t.idx(ix, iz);
      next.set(i, t.heights[i] + (level - t.heights[i]) * smooth(clamp01((reach - hit.d) / 12)));
    }
  }
  for (const [i, h] of next) t.heights[i] = h;
}

export function buildTerrain(): Terrain {
  const t = new Terrain(VALLEY_SIZE, VALLEY_SAMPLES);
  const N = t.N;
  const penLevel = rawHeight(pen.x, pen.z);
  const penFlat = (x: number, z: number) => {
    const h = rawHeight(x, z);
    return h + (penLevel - h) * smooth(clamp01((36 - Math.hypot(x - pen.x, z - pen.z)) / 14));
  };
  const hs = L.house;
  const houseLevel = penFlat(hs.x, hs.z - 1);
  const ru = L.ruins;
  const ruinLevel = rawHeight(ru.x, ru.z);
  const f = L.works.fold;
  const foldLevel = rawHeight((f.xMin + f.xMax) / 2 - 3, (f.zMin + f.zMax) / 2 - 3);
  const squareLevel = rawHeight(V.x, V.z);
  const pads = [...HOUSES, KAHVEHANE, MOSQUE].map(([dx, dz, hx, hz]) => ({ x: V.x + dx, z: V.z + dz, hx: hx + 1.5, hz: hz + 1.5, level: rawHeight(V.x + dx, V.z + dz) }));

  for (let ix = 0; ix < N; ix++) {
    for (let iz = 0; iz < N; iz++) {
      const x = t.xOf(ix);
      const z = t.zOf(iz);
      let h = penFlat(x, z);
      // The house pad and yard.
      const rh = Math.max(Math.abs(x - hs.x) - hs.hx - 3, Math.abs(z - hs.z + 1) - hs.hz - 3.5, 0);
      h += (houseLevel - h) * smooth(clamp01(1 - rh / 9));
      // The ruin's platform, the hut and fold at Pasture B.
      h = flattenRect(h, x, z, ru.x, ru.z, ru.hx + 2, ru.hz + 2, ruinLevel, 8);
      h = flattenRect(h, x, z, (f.xMin + f.xMax) / 2 - 3, (f.zMin + f.zMax) / 2 - 3, (f.xMax - f.xMin) / 2 + 6, (f.zMax - f.zMin) / 2 + 7, foldLevel, 10);
      // The village: a flat square, each house on its own terrace.
      if (inVillage(x, z, 12)) {
        h = flattenRect(h, x, z, V.x, V.z, SQUARE.hx, SQUARE.hz, squareLevel, 8);
        for (const p of pads) h = flattenRect(h, x, z, p.x, p.z, p.hx, p.hz, p.level, 4);
      }
      t.heights[t.idx(ix, iz)] = h;
    }
  }
  smoothRoad(t, MAIN_ROAD, ROAD_HALF.main, 22);
  smoothRoad(t, HILL_ROAD, ROAD_HALF.hill, 12);

  // Surfaces (needs final heights for slope).
  for (let ix = 0; ix < N; ix++) {
    for (let iz = 0; iz < N; iz++) {
      const x = t.xOf(ix);
      const z = t.zOf(iz);
      const wobble = 2.5 * fbm(x / 9, z / 9, 2, 23);
      let s = Surface.Grass;
      for (const p of L.pastures) if (Math.hypot(x - p.x, z - p.z) < p.r + wobble) s = Surface.Pasture;
      if (insidePen(x, z, 1) || inYard(x, z)) s = Surface.Dirt;
      const dd = dereDistance(x, z);
      if (dd < DERE_HALF - 1 + wobble * 0.5) s = Surface.Gravel;
      if (t.slopeDegAtSample(ix, iz) > 30) s = Surface.Rock;
      const hl = L.hill;
      const rHill = Math.hypot(x - hl.x, z - hl.z);
      if (rHill < hl.plateau + hl.flank + 4 && rHill > hl.plateau - 2) {
        const ang = (Math.atan2(z - hl.z, x - hl.x) * 180) / Math.PI;
        let da = ang - hl.mudFlank.angleDeg;
        while (da > 180) da -= 360;
        while (da < -180) da += 360;
        if (Math.abs(da) < hl.mudFlank.halfWidthDeg + wobble * 2) s = Surface.Mud;
      }
      if (Math.hypot(x - MUD.x, z - MUD.z) < MUD.r + wobble) s = Surface.Mud;
      if (mainRoadDistance(x, z) < ROAD_HALF.main) s = Surface.Gravel;
      if (hillRoadDistance(x, z) < ROAD_HALF.hill) s = Surface.Dirt;
      if (Math.abs(x - V.x) < SQUARE.hx && Math.abs(z - V.z) < SQUARE.hz) s = Surface.Dirt;
      t.surfaces[t.idx(ix, iz)] = s;
    }
  }
  return t;
}

// ---------- props ----------

export function buildProps(t: Terrain): MapProps {
  const props: Prop[] = [];
  const labels: Label[] = [];
  penProps(t, L, props, labels);
  const gate = { x: pen.x + pen.hx, z: pen.z };
  const pastureDistances: Record<string, number> = {};
  for (const p of L.pastures) {
    const d = Math.round(Math.hypot(p.x - gate.x, p.z - gate.z));
    pastureDistances[p.id] = d;
    props.push({ kind: 'cyl', role: 'marker', x: p.x, y: t.heightAt(p.x, p.z), z: p.z, radius: 0.12, height: 4 });
    labels.push({ text: `Pasture ${p.id} · ${d} m${p.note ? ` · ${p.note}` : ''}`, x: p.x, z: p.z, lift: 5, color: p.color });
  }

  // Homestead, grove and ruin: the same builders as every map.
  houseProps(t, L, props);
  const stoneWall = stoneWaller(t, props);
  groveWalls(L, L.grove, stoneWall);
  groveOlives(t, L.grove, props, roadDistance);
  ruinProps(t, L, props);
  hutRuinProps(t, L, props);

  // Open ground: away from the homestead, roads, pastures, the dere, works and the village.
  const blockedBy = (x: number, z: number, r: number) => props.some((q) => q.kind === 'cyl' && Math.hypot(q.x - x, q.z - z) < q.radius + r);
  const open = (x: number, z: number, pad: number) =>
    roadDistance(x, z) > pad + 4 &&
    !insidePen(x, z, pad + 12) &&
    !inYard(x, z, pad + 3) &&
    !inGrove(x, z, pad + 1) &&
    !nearRuins(x, z, pad) &&
    !nearWorks(x, z, pad) &&
    !inVillage(x, z, pad + 6) &&
    dereDistance(x, z) > DERE_HALF + DERE_WALL + pad &&
    Math.abs(x) < 548 &&
    Math.abs(z) < 548 &&
    L.pastures.every((pa) => Math.hypot(x - pa.x, z - pa.z) > pa.r + pad + 4) &&
    L.springs.every((sp) => Math.hypot(x - sp.x, z - sp.z) > sp.radius + pad + 3) &&
    Math.hypot(x - MUD.x, z - MUD.z) > MUD.r + 4 &&
    Math.hypot(x - L.hill.x, z - L.hill.z) > L.hill.plateau + 2 &&
    AHMET.notes.every((n) => Math.hypot(x - n.x, z - n.z) > pad + 3);

  // Uncle Ahmet's cairns along his old routes, every ~45 m.
  for (const route of AHMET_ROUTES) {
    const len = polyLength(route);
    for (let s = 20; s < len - 10; s += 45) {
      // Beside the path, not on it: alternate sides, 2.5 m off the line.
      const a = pointAt(route, s);
      const n = pointAt(route, s + 1);
      const l = Math.max(1e-3, Math.hypot(n.x - a.x, n.z - a.z));
      const side = Math.round(s / 45) % 2 ? 2.5 : -2.5;
      const p = { x: a.x - ((n.z - a.z) / l) * side, z: a.z + ((n.x - a.x) / l) * side };
      if (!open(p.x, p.z, 0.5) || t.slopeDegAt(p.x, p.z) > 25) continue;
      props.push({ kind: 'cyl', role: 'cairn', x: p.x, y: t.heightAt(p.x, p.z) - 0.05, z: p.z, radius: 0.45, height: 1.1 });
    }
  }

  // Thorns: the thicket west of Pasture A, scattered maquis, thicker in the maquis band.
  const r = rng(42);
  const okForBush = (x: number, z: number) => open(x, z, 1) && t.slopeDegAt(x, z) < 28 && !blockedBy(x, z, 3);
  const addBush = (x: number, z: number) => {
    const radius = 0.7 + r() * 0.9;
    props.push({ kind: 'cyl', role: 'thorn', x, y: t.heightAt(x, z) - 0.1, z, radius, height: 0.9 + r() * 0.5 });
  };
  const tc = L.thornCluster;
  for (let i = 0, tries = 0; i < tc.count && tries < 600; tries++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * tc.r;
    const x = tc.x + Math.cos(a) * d;
    const z = tc.z + Math.sin(a) * d;
    if (!okForBush(x, z)) continue;
    addBush(x, z);
    i++;
  }
  for (let i = 0, tries = 0; i < 260 && tries < 12000; tries++) {
    const x = (r() - 0.5) * 1080;
    const z = (r() - 0.5) * 1080;
    if (r() > 0.15 + 0.85 * maquisness(x, z) || !okForBush(x, z)) continue;
    addBush(x, z);
    i++;
  }

  // The pine forest, plus pines scattered across the valley.
  const rp = rng(7);
  for (let i = 0, tries = 0; i < 900 && tries < 30000; tries++) {
    const x = (rp() - 0.5) * 1090;
    const z = (rp() - 0.5) * 1090;
    const f = forestness(x, z);
    if (rp() > 0.04 + f * 0.96 || !open(x, z, 2) || t.slopeDegAt(x, z) > 30) continue;
    if (Math.hypot(x - L.wolfDen.x, z - L.wolfDen.z) < 8) continue;
    if (blockedBy(x, z, 3.2)) continue;
    props.push({ kind: 'cyl', role: 'pine', x, y: t.heightAt(x, z) - 0.2, z, radius: 0.3, height: 7 + rp() * 5 });
    i++;
  }

  // Boulders, more on the maquis hills and the lookout's flanks.
  const rr = rng(99);
  for (let i = 0, tries = 0; i < 220 && tries < 12000; tries++) {
    const x = (rr() - 0.5) * 1080;
    const z = (rr() - 0.5) * 1080;
    const radius = 0.5 + rr() * rr() * 1.6;
    if (rr() > 0.25 + 0.75 * maquisness(x, z) || !open(x, z, radius) || t.slopeDegAt(x, z) > 32 || blockedBy(x, z, radius + 1)) continue;
    props.push({ kind: 'cyl', role: 'rock', x, y: t.heightAt(x, z) - radius * 0.3, z, radius, height: radius * (0.9 + rr() * 0.6) });
    i++;
  }

  // A few more olives and cypresses along the road near home.
  const ro = rng(78);
  for (let i = 0, tries = 0; i < 40 && tries < 3000; tries++) {
    const x = -420 + ro() * 260;
    const z = 220 + ro() * 160;
    if (!open(x, z, 2) || t.slopeDegAt(x, z) > 20 || blockedBy(x, z, 4)) continue;
    const cypress = ro() < 0.2;
    props.push(
      cypress
        ? { kind: 'cyl', role: 'cypress', x, y: t.heightAt(x, z) - 0.2, z, radius: 0.45, height: 8 + ro() * 3 }
        : { kind: 'cyl', role: 'olive', x, y: t.heightAt(x, z) - 0.1, z, radius: 0.35, height: 2.2 + ro() * 1.4 },
    );
    i++;
  }

  // ---------------------------------------------------------------- the village (a shell)
  for (const [dx, dz, hx, hz, h] of [...HOUSES, KAHVEHANE, MOSQUE]) {
    const x = V.x + dx;
    const z = V.z + dz;
    const y = t.heightAt(x, z);
    props.push({ kind: 'box', role: 'building', x, y: y + h / 2, z, hx, hy: h / 2, hz });
  }
  const mx = V.x + MINARET.dx;
  const mz = V.z + MINARET.dz;
  props.push({ kind: 'cyl', role: 'minaret', x: mx, y: t.heightAt(mx, mz), z: mz, radius: MINARET.r, height: MINARET.h });
  // A plane-tree-sized pine shading the square's corner.
  props.push({ kind: 'cyl', role: 'pine', x: V.x - 11, y: t.heightAt(V.x - 11, V.z - 7) - 0.2, z: V.z - 7, radius: 0.5, height: 13 });

  // Maquis shrubs (decoration only): densest on the maquis hills.
  const decor: Decor[] = [];
  const rd = rng(55);
  for (let tries = 0; decor.length < 3200 && tries < 60000; tries++) {
    const x = (rd() - 0.5) * 1100;
    const z = (rd() - 0.5) * 1100;
    const sl = t.slopeDegAt(x, z);
    const want = 0.08 + Math.min(1, sl / 25) * 0.3 + maquisness(x, z) * 0.6 + (Math.max(Math.abs(x), Math.abs(z)) > 500 ? 0.3 : 0);
    if (rd() > want || sl > 34 || !open(x, z, 0.5)) continue;
    decor.push({ kind: 'shrub', x, z, s: 0.5 + rd() * 0.9, rot: rd() * Math.PI * 2, v: rd() });
  }

  const hs = L.house;
  labels.push(
    { text: 'Home', x: hs.x, z: hs.z, lift: 5 },
    { text: 'Ağıl (pen)', x: pen.x, z: pen.z, lift: 4 },
    { text: 'Olive grove', x: (L.grove.xMin + L.grove.xMax) / 2, z: 306, lift: 5 },
    { text: 'Ruins', x: L.ruins.x, z: L.ruins.z, lift: 6 },
    { text: 'Lookout · dirt road', x: L.hill.x, z: L.hill.z, lift: 4 },
    { text: 'Mud flank', x: L.hill.x + 62, z: L.hill.z + 62, lift: 3 },
    { text: 'The dere (dry riverbed)', x: -190, z: -20, lift: 3 },
    { text: 'Mud', x: MUD.x, z: MUD.z, lift: 3 },
    { text: 'Thorns', x: tc.x, z: tc.z, lift: 3 },
    { text: 'Pine forest', x: -330, z: -330, lift: 14 },
    { text: 'Wolf den', x: L.wolfDen.x, z: L.wolfDen.z, lift: 4, color: 0xd08070 },
    { text: 'Village', x: V.x, z: V.z, lift: 8 },
    { text: 'Gravel road', x: 230, z: 20, lift: 3 },
  );

  return { props, labels, decor, pastureDistances };
}

// ---------- paper map ----------

function sketch(s: Sketcher): void {
  const { g, px, py, label, rnd } = s;
  const line = (pts: V2[]) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(px(p.x), py(p.z)) : g.moveTo(px(p.x), py(p.z))));
    g.stroke();
  };
  // The dere: two banks with hatching between, and the stones on its bed.
  g.strokeStyle = s.ink;
  g.lineWidth = 1;
  const len = polyLength(DERE);
  for (const side of [-1, 1]) {
    g.beginPath();
    for (let d = 0; d <= len; d += 6) {
      const a = pointAt(DERE, d);
      const b = pointAt(DERE, Math.min(len, d + 1));
      const l = Math.max(1e-3, Math.hypot(b.x - a.x, b.z - a.z));
      const x = a.x + ((-(b.z - a.z) / l) * DERE_HALF * side);
      const z = a.z + (((b.x - a.x) / l) * DERE_HALF * side);
      if (d === 0) g.moveTo(px(x), py(z));
      else g.lineTo(px(x), py(z));
    }
    g.stroke();
  }
  g.fillStyle = 'rgba(110, 90, 70, 0.4)';
  for (let d = 0; d < len; d += 5) {
    const p = pointAt(DERE, d + rnd() * 4);
    g.fillRect(px(p.x + (rnd() - 0.5) * 10), py(p.z + (rnd() - 0.5) * 10), 1.5, 1.5);
  }
  label('the dere', -190, -60, 13);

  // Mud by the dere spring.
  g.fillStyle = 'rgba(110, 80, 50, 0.35)';
  for (let i = 0; i < 80; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * MUD.r;
    g.fillRect(px(MUD.x + Math.cos(a) * r), py(MUD.z + Math.sin(a) * r), 2, 2);
  }

  // Roads: gravel dashed, the dirt road to the lookout dotted.
  g.strokeStyle = 'rgba(120, 80, 40, 0.8)';
  g.lineWidth = 2;
  g.setLineDash([7, 5]);
  line(MAIN_ROAD);
  g.setLineDash([2, 4]);
  line(HILL_ROAD);
  g.setLineDash([]);

  // The village: little blocks for its houses, the minaret a dot.
  g.fillStyle = 'rgba(190, 100, 60, 0.75)';
  for (const [dx, dz, hx, hz] of [...HOUSES, KAHVEHANE, MOSQUE]) g.fillRect(px(V.x + dx - hx), py(V.z + dz - hz), hx * 2 * s.scale + 1, hz * 2 * s.scale + 1);
  label('the village', V.x, V.z + 62, 15);

  // Area names.
  label('olive grove', (L.grove.xMin + L.grove.xMax) / 2, 335, 13);
  label('maquis', -300, 80, 15);
  label('pine forest', -330, -400, 16);
  label('ruins', L.ruins.x, L.ruins.z - 12, 13);
  label('lookout', L.hill.x, L.hill.z + 4, 13);
}

// ---------- map definition ----------

export const VALLEY_MAP: MapDef = {
  id: 'valley',
  title: 'The valley below Şirince',
  size: VALLEY_SIZE,
  layout: L,
  buildTerrain,
  buildProps,
  roadDistance,
  sketch,
  ground: {
    forest: forestness,
    maquis: maquisness,
    grove: (x, z) => {
      const g = L.grove;
      const d = Math.max(g.wallFrom - x, x - g.wallTo, g.walls[0] - z, z - (g.rows[g.rows.length - 1] + 5), 0);
      return smooth(clamp01(1 - d / 6));
    },
    dere: dereDistance,
    dereHalf: DERE_HALF,
    dereBank: DERE_WALL,
    fords: [{ x: -247, z: 252 }],
  },
  teleports: () => ({
    'Pen gate': [L.spawn.x, L.spawn.z],
    'Pasture A': [L.pastures[0].x, L.pastures[0].z],
    'Pasture B (far)': [B.x, B.z],
    "Uncle Ahmet's hut": [L.works.hut.x + L.works.hut.hx + 4, L.works.hut.z + 1],
    'Pasture C (dry)': [C.x, C.z],
    'Pasture D': [L.pastures[3].x, L.pastures[3].z],
    'Pasture E (forest edge)': [L.pastures[4].x, L.pastures[4].z],
    'Çeşme': [L.cesme.x - 1.3, L.cesme.z],
    'Cottage yard': [L.house.x - 2, L.house.z - L.house.hz - 6],
    'Thorn thicket': [L.thornCluster.x + 26, L.thornCluster.z],
    'Dere ford': [-247, 252],
    'Mud by the dere': [MUD.x, MUD.z],
    'Hill road foot': [105, 30],
    Lookout: [L.hill.x, L.hill.z],
    'Village square': [V.x, V.z],
    Ruins: [L.ruins.x, L.ruins.z + 8],
    'Wolf ground': [-470, -280],
    'To the flock': [0, 0],
  }),
  notes: AHMET.notes,
  pencil: AHMET.pencil,
  goatSpots: [
    { x: L.thornCluster.x + 30, z: L.thornCluster.z - 10 },
    { x: L.pastures[3].x + 45, z: L.pastures[3].z + 30 },
    { x: -217, z: 90 },
    { x: L.ruins.x + 30, z: L.ruins.z + 26 },
  ],
  // Thyme on the dry hills round Pasture C, sage by the ruins, mountain tea up on the lookout.
  herbs: [
    { id: 'thyme1', kind: 'thyme', x: C.x - 42, z: C.z - 8 },
    { id: 'thyme2', kind: 'thyme', x: C.x + 30, z: C.z + 30 },
    { id: 'thyme3', kind: 'thyme', x: C.x - 10, z: C.z - 44 },
    { id: 'thyme4', kind: 'thyme', x: C.x + 44, z: C.z - 20 },
    { id: 'sage1', kind: 'sage', x: L.ruins.x + 14, z: L.ruins.z + 18 },
    { id: 'sage2', kind: 'sage', x: L.ruins.x - 18, z: L.ruins.z - 12 },
    { id: 'sage3', kind: 'sage', x: L.ruins.x + 22, z: L.ruins.z - 16 },
    { id: 'tea1', kind: 'tea', x: L.hill.x - 6, z: L.hill.z + 7 },
    { id: 'tea2', kind: 'tea', x: L.hill.x + 8, z: L.hill.z - 6 },
  ],
  scenario: {
    meadow: { x: -330, z: 110 },
    lost: { x: -215, z: 125 },
    lostWhere: 'the dere',
    lostFlock: { x: -290, z: 140 },
    // The same test at the same distance: Pasture D is 282 m out (B, at 414 m, is half a day).
    trialPasture: 'D',
    trialSeconds: 8 * 60,
  },
  tuftDensity: (x, z) => {
    const d = Math.hypot(x - pen.x, z - pen.z);
    return d < 220 ? 1 : Math.max(0.3, 1 - (d - 220) / 300);
  },
};

export const VALLEY_HALF = HALF;

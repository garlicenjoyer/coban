// The painted ground: what colour the land is at each terrain sample, and which kind of
// fine detail the shader paints on top.
//
// An Aegean valley in high summer: the meadows have gone to straw, greener only in hollows,
// on north-facing slopes and along the dere. Red terra rossa shows through where the grass is
// thin (on the maquis hills, on slopes, under the ploughed olives). Pale limestone breaks out
// on the steep ground. The pine forest floor is needle-brown. The dere's bed is pale cobbles.
// Hollows sit a shade darker and ridges a shade lighter, as a painter would.
//
// Colours are blended in blotches with fairly hard edges rather than smooth gradients, so the
// ground reads as dabs of paint and fits the cel look.

import * as THREE from 'three';
import type { GroundZones } from './mapTypes';
import { fbm } from './noise';
import { Surface, type Terrain } from './terrain';

const C = (hex: number) => new THREE.Color(hex);

export const GROUND = {
  straw: C(0xd3bf74),
  meadow: C(0xa9b862),
  lush: C(0x8fb45a),
  pasture: C(0x86c05a),
  rossa: C(0xb2694a),
  rossaPale: C(0xc98b5c),
  needles: C(0x96774f),
  forestGreen: C(0x7d8d4e),
  maquis: C(0x969c5c),
  limestone: C(0xdcd5c6),
  limestoneShade: C(0xb9ad99),
  dirt: C(0xd9a66c),
  gravel: C(0xeee0c0),
  cobbles: C(0xd8cfbc),
  mud: C(0x7a583f),
  asphalt: C(0x7a777c),
};

/**
 * Per-sample paint. Every sample carries two colours: the "soft" ground (meadow, maquis,
 * forest floor, limestone, the dere's bed) and the "hard" one (road, yard, mud) it would show
 * if it were path, plus `hard`, a blurred 0..1 mask of where the hard surfaces are. The shader
 * draws the boundary where the interpolated mask crosses 0.5, so roads and mud get smooth
 * edges instead of the 2 m saw-teeth of the surface grid.
 */
export interface GroundPaint {
  color: Float32Array;
  hardColor: Float32Array;
  hard: Float32Array;
  /** rgba = rock, cobbles, soil, grass detail weights (0..1) on the soft ground. */
  detail: Float32Array;
}

const smoothstep = THREE.MathUtils.smoothstep;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A blotch: 0..1 with a narrow edge around `threshold`, from noise in -1..1. */
const blotch = (n: number, threshold: number, edge = 0.06) => smoothstep(n * 0.5 + 0.5, threshold - edge, threshold + edge);

export function paintGround(t: Terrain, zones?: GroundZones, roadDistance?: (x: number, z: number) => number): GroundPaint {
  const N = t.N;
  const color = new Float32Array(N * N * 3);
  const hardRaw = new Float32Array(N * N * 3);
  const hardColor = new Float32Array(N * N * 3);
  const isHard = new Uint8Array(N * N);
  const hard = new Float32Array(N * N);
  const detail = new Float32Array(N * N * 4);
  const c = new THREE.Color();
  const hc = new THREE.Color();
  const tmp = new THREE.Color();
  const H = (ix: number, iz: number) => t.heights[t.idx(Math.max(0, Math.min(N - 1, ix)), Math.max(0, Math.min(N - 1, iz)))];
  // Cavity over about 4 m either side, whatever the cell size.
  const reach = Math.max(1, Math.round(4 / t.cellSize));

  for (let ix = 0; ix < N; ix++) {
    for (let iz = 0; iz < N; iz++) {
      const i = t.idx(ix, iz);
      const x = t.xOf(ix);
      const z = t.zOf(iz);
      const s = t.surfaces[i] as Surface;
      const slope = t.slopeDegAtSample(ix, iz);
      const h = t.heights[i];
      // Which way the ground faces: +z is south, so dz > 0 means it rises to the south (faces north).
      const northFacing = clamp01(((H(ix, iz + reach) - H(ix, iz - reach)) / (2 * reach * t.cellSize)) * 3);
      const cavity = (H(ix - reach, iz) + H(ix + reach, iz) + H(ix, iz - reach) + H(ix, iz + reach)) / 4 - h;

      const forest = zones?.forest(x, z) ?? 0;
      const maquis = zones?.maquis(x, z) ?? 0;
      const grove = zones?.grove(x, z) ?? 0;
      const dd = zones ? zones.dere(x, z) : Infinity;
      const bank = zones ? smoothstep(-dd, -(zones.dereHalf + zones.dereBank + 30), -zones.dereHalf) : 0;
      const inBed = !!zones && dd < zones.dereHalf;

      let rock = 0;
      let cobble = 0;
      let soil = 0;
      let grass = 0;

      // ---- the soft ground, painted everywhere (under roads too, for their edges)
      if (s === Surface.Rock) {
        c.copy(GROUND.limestone).lerp(GROUND.limestoneShade, blotch(fbm(x / 6, z / 6, 2, 89), 0.55) * 0.7);
        rock = 1;
      } else {
        // Moisture: big soft drifts, wetter by the dere, in hollows and on north faces.
        const moist = clamp01(0.52 + 0.55 * fbm(x / 95 + 3, z / 95 - 8, 3, 71) + 0.45 * bank + 0.25 * northFacing + 0.5 * Math.max(0, cavity) - slope / 90);
        // Two or three tones per field, in dabs, never a smooth ramp.
        const m = moist + fbm(x / 11, z / 11, 2, 73) * 0.25;
        c.copy(GROUND.straw);
        c.lerp(GROUND.meadow, smoothstep(m, 0.38, 0.5));
        c.lerp(GROUND.lush, smoothstep(m, 0.72, 0.8) * 0.8);
        if (s === Surface.Pasture) c.lerp(GROUND.pasture, 0.75);
        // Maquis ground, the forest floor.
        c.lerp(GROUND.maquis, maquis * 0.45);
        if (forest > 0) {
          tmp.copy(GROUND.needles).lerp(GROUND.forestGreen, blotch(fbm(x / 9, z / 9, 2, 77), 0.55));
          c.lerp(tmp, forest);
        }
        // Terra rossa through thin grass, in streaks: maquis hills, slopes.
        const thin = clamp01(maquis * 0.55 + smoothstep(slope, 10, 26) * 0.45 + forest * 0.2 - bank * 0.4) * (s === Surface.Pasture ? 0.25 : 1);
        const red = blotch(fbm(x / 19 + 11, z / 8, 3, 79), 1 - thin * 0.6) * 0.72;
        tmp.copy(GROUND.rossa).lerp(GROUND.rossaPale, 0.35 + blotch(fbm(x / 5, z / 5, 2, 83), 0.5) * 0.45);
        c.lerp(tmp, red);
        // The grove: ploughed red earth between the rows, grass creeping back in dabs.
        const plough = grove * (0.45 + 0.35 * blotch(fbm(x / 6 - 4, z / 6, 2, 81), 0.5));
        c.lerp(GROUND.rossaPale, plough);
        // Limestone breaking out as it steepens.
        const lime = smoothstep(slope, 21, 29) * blotch(fbm(x / 7 + 5, z / 7, 2, 87), 0.45);
        c.lerp(GROUND.limestone, lime);
        rock = lime;
        soil = Math.max(red, plough);
        grass = clamp01(1 - soil - rock - forest * 0.5);
      }

      // The dere's stony bed, from its distance rather than the surface grid, so its edge runs
      // as a smooth wobbly line. Roads crossing it are hard ground and draw over it.
      if (zones && dd < zones.dereHalf + 2) {
        const bed = smoothstep(-(dd + 1.2 * fbm(x / 7, z / 7, 2, 93)), -(zones.dereHalf + 0.8), -(zones.dereHalf - 1.6));
        c.lerp(GROUND.cobbles, bed);
        cobble = bed;
        grass *= 1 - bed;
        soil *= 1 - bed;
        rock *= 1 - bed;
      }

      // ---- the hard ground: roads, yards, mud
      const road = s === Surface.Gravel && !(inBed && !((roadDistance?.(x, z) ?? Infinity) < 3.5));
      if (s === Surface.Dirt || s === Surface.Mud || s === Surface.Asphalt || road) {
        isHard[i] = 1;
        if (s === Surface.Dirt) hc.copy(GROUND.dirt).lerp(GROUND.rossaPale, blotch(fbm(x / 8, z / 8, 2, 91), 0.6) * 0.5);
        else if (s === Surface.Mud) hc.copy(GROUND.mud).lerp(GROUND.dirt, blotch(fbm(x / 6, z / 6, 2, 95), 0.62) * 0.35);
        else if (s === Surface.Asphalt) hc.copy(GROUND.asphalt);
        else hc.copy(GROUND.gravel).lerp(GROUND.dirt, blotch(fbm(x / 9, z / 9, 2, 97), 0.66) * 0.25);
        hardRaw[i * 3] = hc.r;
        hardRaw[i * 3 + 1] = hc.g;
        hardRaw[i * 3 + 2] = hc.b;
      }

      // Hollows a shade darker, ridges a shade lighter.
      const ao = THREE.MathUtils.clamp(cavity / 0.5, -1, 1);
      const shade = 1 - 0.12 * Math.max(ao, 0) + 0.05 * Math.max(-ao, 0);
      color[i * 3] = c.r * shade;
      color[i * 3 + 1] = c.g * shade;
      color[i * 3 + 2] = c.b * shade;
      hard[i] = shade; // the shade, for the hard colour below
      detail.set([rock, cobble, soil, grass], i * 4);
    }
  }

  // Each sample's hard colour: its own, or its hard neighbours' (so the colour across an edge
  // is the road's on both sides), and the blurred mask.
  for (let ix = 0; ix < N; ix++) {
    for (let iz = 0; iz < N; iz++) {
      const i = t.idx(ix, iz);
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let mask = 0;
      let cnt = 0;
      // Gaussian 3×3 (1 2 1 / 2 4 2 / 1 2 1): a smooth field whose 0.5 line is a smooth curve.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const jx = ix + dx;
          const jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= N || jz >= N) continue;
          const j = t.idx(jx, jz);
          const wgt = (dx ? 1 : 2) * (dz ? 1 : 2);
          cnt += wgt;
          if (!isHard[j]) continue;
          mask += wgt;
          n++;
          r += hardRaw[j * 3];
          g += hardRaw[j * 3 + 1];
          b += hardRaw[j * 3 + 2];
        }
      }
      const shade = hard[i];
      if (isHard[i]) {
        hardColor[i * 3] = hardRaw[i * 3] * shade;
        hardColor[i * 3 + 1] = hardRaw[i * 3 + 1] * shade;
        hardColor[i * 3 + 2] = hardRaw[i * 3 + 2] * shade;
      } else if (n) {
        hardColor[i * 3] = (r / n) * shade;
        hardColor[i * 3 + 1] = (g / n) * shade;
        hardColor[i * 3 + 2] = (b / n) * shade;
      } else {
        hardColor.set([color[i * 3], color[i * 3 + 1], color[i * 3 + 2]], i * 3);
      }
      hard[i] = mask / cnt;
    }
  }
  return { color, hardColor, hard, detail };
}

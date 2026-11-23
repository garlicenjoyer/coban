// Dense grass, built on the GPU.
//
// One 8 m patch of ~1,800 blades is drawn again and again in tiles around the camera (one
// instance per tile). Everything about a blade is worked out in the vertex shader from
// textures: where the ground is (the terrain's own triangles, so blades sit on it exactly),
// whether grass grows there and what colour it is (baked once from the painted ground), how
// much the flock has grazed it and whether it's a worn trail (the live grass map), how the
// wind bends it (the shared meltem), and whether the shepherd, the dog, the bike or a sheep
// is pressing it down. The CPU only picks which tiles are in view each frame.
//
// Density falls in rings: every blade within ~26 m, under a third out to ~52 m, a ninth to ~95 m,
// each blade shrinking away as it drops out, so there is no visible edge. Tiles are rotated
// and mirrored by a hash of where they sit, so the repeat doesn't show.

import * as THREE from 'three';
import { noiseTexture } from '../render/noiseTex';
import { toonMaterial } from '../render/toon';
import { GUST_GLSL, windUniforms } from '../render/wind';
import type { GroundZones } from './mapTypes';
import { fbm, rng } from './noise';
import { Surface, type Terrain } from './terrain';

export const grassSettings = {
  /** Share of blades drawn (1 = all; lower it on slow machines). */
  density: 1,
  /** Overall blade height multiplier. */
  height: 1,
  /** Draw the grass at all. */
  enabled: true,
};

const TILE = 8;
/** Blades per square metre in the nearest ring. */
const NEAR_DENSITY = 36;
const BLADES = TILE * TILE * NEAR_DENSITY;
/** Ring edges (m) and the share of blades kept beyond each. */
const RINGS = { near: 26, mid: 52, far: 95, midKeep: 0.3, farKeep: 0.11 };
/** How many things can press the grass down at once (shepherd, dog, bike, 24+ sheep). */
const MAX_PUSHERS = 32;

export interface GrassFieldInput {
  terrain: Terrain;
  zones?: GroundZones;
  /** Painted ground colour under a point (blades take their colour from it). */
  groundColor: (x: number, z: number, out: THREE.Color) => THREE.Color;
  /** Is grass allowed at (x, z)? Roads, the pen, springs, walls and buildings say no. */
  allowed: (x: number, z: number) => boolean;
  /** Optional thinning by map (the valley's far reaches). */
  density?: (x: number, z: number) => number;
  /** The live grass map texture uniform (grazing in R, trail wear in G, grazeable in A). */
  grassMap: { value: THREE.Texture | null };
}

/** The 0..1 share of blades kept at a distance (matches the shader). */
export function keepAt(d: number): number {
  const s = THREE.MathUtils.smoothstep;
  const { near, mid, far, midKeep, farKeep } = RINGS;
  return 1 - (1 - midKeep) * s(d, near - 6, near + 6) - (midKeep - farKeep) * s(d, mid - 7, mid + 7) - farKeep * s(d, far - 12, far);
}

/** A tuft's colour from the ground: nudged toward green and a little richer. */
const hsl = { h: 0, s: 0, l: 0 };
function bladeColor(c: THREE.Color): THREE.Color {
  c.getHSL(hsl);
  return c.setHSL(hsl.h + (0.25 - hsl.h) * 0.25, Math.min(1, hsl.s * 1.12 + 0.03), hsl.l);
}

function bladeGeometry(): THREE.BufferGeometry {
  const r = rng(4711);
  // Per vertex: aBlade = (local x, local z, rank 0..1, random), aShape = (t up the blade, side).
  const blade = new Float32Array(BLADES * 5 * 4);
  const shape = new Float32Array(BLADES * 5 * 2);
  const index = new Uint32Array(BLADES * 9);
  // Ranks are a shuffled 0..1 ramp, so "the first N" is an even spread over the tile.
  const ranks = Array.from({ length: BLADES }, (_, i) => (i + 0.5) / BLADES);
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
  }
  // Blades in loose clumps: a clump centre, a few blades round it.
  const order: { x: number; z: number; rank: number; rnd: number }[] = [];
  let cx = 0;
  let cz = 0;
  for (let b = 0; b < BLADES; b++) {
    if (b % 5 === 0) {
      cx = r() * TILE;
      cz = r() * TILE;
    }
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.22;
    const x = (((cx + Math.cos(a) * d) % TILE) + TILE) % TILE;
    const z = (((cz + Math.sin(a) * d) % TILE) + TILE) % TILE;
    order.push({ x, z, rank: ranks[b], rnd: r() });
  }
  // Sort by rank so a draw range of the first N blades keeps the ones with rank < N / BLADES.
  order.sort((p, q) => p.rank - q.rank);
  const SHAPE = [
    [0, -1],
    [0, 1],
    [0.55, -0.62],
    [0.55, 0.62],
    [1, 0],
  ];
  order.forEach((o, b) => {
    for (let v = 0; v < 5; v++) {
      blade.set([o.x, o.z, o.rank, o.rnd], (b * 5 + v) * 4);
      shape.set(SHAPE[v], (b * 5 + v) * 2);
    }
    const k = b * 5;
    index.set([k, k + 1, k + 2, k + 1, k + 3, k + 2, k + 2, k + 3, k + 4], b * 9);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('aBlade', new THREE.BufferAttribute(blade, 4));
  g.setAttribute('aShape', new THREE.BufferAttribute(shape, 2));
  // three.js wants a position attribute; the shader builds the real one.
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BLADES * 5 * 3), 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

const GRASS_VERTEX_HEAD = /* glsl */ `
${GUST_GLSL}
attribute vec4 aBlade;
attribute vec2 aShape;
uniform sampler2D uHeight;
uniform sampler2D uField;
uniform sampler2D uGrassMap;
uniform sampler2D uNoiseTex;
uniform float uHalf;
uniform float uCell;
uniform float uN;
uniform float uSize;
uniform float uDensity;
uniform float uHeightScale;
uniform float uHasGrassMap;
uniform vec4 uPush[${MAX_PUSHERS}];
uniform int uPushN;
/** World size of one screen pixel per metre of distance (2 tan(fov/2) / height in pixels). */
uniform float uPxAngle;
varying vec3 vGrassCol;
varying float vGrassT;
varying float vGrassGust;

// The terrain's own surface: its cells are split on the (1,0)-(0,1) diagonal.
float terrainH(vec2 p) {
  vec2 f = (p + uHalf) / uCell;
  ivec2 i = clamp(ivec2(floor(f)), ivec2(0), ivec2(int(uN) - 2));
  vec2 t = clamp(f - vec2(i), 0.0, 1.0);
  float a = texelFetch(uHeight, i, 0).r;
  float b = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
  float d = texelFetch(uHeight, i + ivec2(0, 1), 0).r;
  float e = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
  return t.x + t.y <= 1.0 ? a + (b - a) * t.x + (d - a) * t.y : e + (d - e) * (1.0 - t.x) + (b - e) * (1.0 - t.y);
}

float keepAt(float d) {
  return 1.0 - ${(1 - RINGS.midKeep).toFixed(3)} * smoothstep(${RINGS.near - 6}.0, ${RINGS.near + 6}.0, d)
    - ${(RINGS.midKeep - RINGS.farKeep).toFixed(3)} * smoothstep(${RINGS.mid - 7}.0, ${RINGS.mid + 7}.0, d)
    - ${RINGS.farKeep.toFixed(3)} * smoothstep(${RINGS.far - 12}.0, ${RINGS.far}.0, d);
}
`;

const GRASS_VERTEX_BODY = /* glsl */ `
  // Which tile, and its variant: one of 8 rotations/mirrors, so the patch doesn't repeat visibly.
  vec2 tileO = instanceMatrix[3].xz;
  vec2 tc = floor(tileO / ${TILE}.0 + 0.5);
  float hv = fract(sin(dot(tc, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 lp = aBlade.xy - ${TILE / 2}.0;
  int rot = int(hv * 4.0);
  if (rot == 1) lp = vec2(-lp.y, lp.x);
  else if (rot == 2) lp = -lp;
  else if (rot == 3) lp = vec2(lp.y, -lp.x);
  if (fract(hv * 8.0) > 0.5) lp.x = -lp.x;
  lp += ${TILE / 2}.0;
  vec2 wp = tileO + lp;

  // Is there grass here, how much, what colour.
  vec4 field = texture2D(uField, ((wp + uHalf) / uCell + 0.5) / uN);
  float dist = distance(wp, cameraPosition.xz);
  float present = clamp((keepAt(dist) * uDensity * field.a - aBlade.z) / 0.04, 0.0, 1.0);
  float t = aShape.x;
  vec3 grassRoot;
  if (present <= 0.0) {
    // Not drawn here (thinned out, a road, bare ground): a zero-size blade, and none of the
    // wind, trampling or shading work below. Most blades past the near ring end here.
    transformed = vec3(lp.x, -1e4, lp.y);
    grassRoot = transformed;
    vGrassCol = vec3(0.0);
    vGrassT = 0.0;
    vGrassGust = 0.0;
    vShimmer = 0.0;
  } else {

  // Grazed short by the flock, short on worn trails.
  float graze = 1.0;
  if (uHasGrassMap > 0.5) {
    vec4 gm = texture2D(uGrassMap, (wp + uHalf) / uSize);
    if (gm.a > 0.5) graze = clamp(gm.r * 1.5 + 0.08, 0.12, 1.15);
    graze *= 1.0 - 0.8 * smoothstep(0.25, 0.75, gm.g);
  }

  // Taller drifts and shorter ones, blade by blade a little different.
  float tall = texture2D(uNoiseTex, wp * (0.0625 / 9.0)).r;
  // Per-blade variety fades with distance, so far grass reads as one mass, not speckle.
  float near = 1.0 - smoothstep(8.0, 40.0, dist);
  float h = uHeightScale * mix(0.3, 0.88, smoothstep(0.25, 0.75, tall)) * (1.0 + (aBlade.w - 0.5) * 0.6 * mix(0.35, 1.0, near)) * graze * present;
  // Never thinner than ~0.8 px on screen: sub-pixel blades are what flicker.
  float w = max(0.034 * (0.75 + 0.5 * fract(aBlade.w * 7.31)), dist * uPxAngle * 0.8) * present;
  float yaw = aBlade.w * 18.85;
  vec2 across = vec2(cos(yaw), sin(yaw));

  // Bend: a natural lean, the wind, and anything walking through.
  vec2 lean = vec2(cos(yaw * 1.7 + 1.0), sin(yaw * 1.7 + 1.0)) * (0.18 + 0.2 * fract(aBlade.w * 3.7));
  float gust = windGust(wp);
  // Coherent motion: neighbouring blades sway together (phase from position, not per blade),
  // so the field moves in waves instead of fizzing.
  float phase = dot(wp, vec2(0.31, 0.23)) + aBlade.w * 0.6;
  vec2 windV = uWindDir * (0.12 + 0.9 * gust) * uWindStrength
    + vec2(sin(uWindTime * 1.7 + phase), cos(uWindTime * 1.4 + phase * 1.3)) * 0.05 * (0.4 + gust) * uWindStrength;
  vec2 push = vec2(0.0);
  // The two root vertices (t = 0) never move, so only the upper three look for pushers.
  if (dist < 40.0 && t > 0.0) {
    for (int i = 0; i < ${MAX_PUSHERS}; i++) {
      if (i >= uPushN) break;
      vec2 dp = wp - uPush[i].xy;
      float l = length(dp);
      float r = uPush[i].z;
      if (l < r) push += dp / max(l, 0.05) * (1.0 - l / r) * 1.6;
    }
  }
  vec2 bend = lean + windV + push;
  float bl = length(bend);
  if (bl > 1.4) bend *= 1.4 / bl;
  // The blade arcs over: sideways with t², and loses a little height as it bends.
  vec2 side = across * w * aShape.y;
  vec2 off = bend * h * t * t;
  float ground = terrainH(wp);
  float y = ground - 0.03 + h * t * (1.0 - 0.3 * min(bl, 1.0) * t);
  // Tile-local: instanceMatrix adds the tile's origin.
  transformed = vec3(lp.x + side.x + off.x, y, lp.y + side.y + off.y);
  // The blade's root: shadows are looked up here, so a blade takes the ground's shadow
  // as one piece instead of shadow-map edges crawling up thin geometry.
  grassRoot = vec3(lp.x, ground, lp.y);

  // Darker at the root, lighter and a touch drier at the tip (less contrast far away).
  float grad = mix(0.86, 0.72, near);
  vGrassCol = field.rgb * mix(grad, 1.1, t);
  vGrassCol = mix(vGrassCol, vec3(0.9, 0.86, 0.6) * dot(field.rgb, vec3(0.45, 0.75, 0.2)), t * t * 0.18);
  vGrassT = t;
  vGrassGust = gust * uWindStrength;
  vShimmer = 0.0;
  }
`;

export class GrassField {
  readonly root = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly frustum = new THREE.Frustum();
  private readonly mat4 = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly terrain: Terrain;
  /** Tiles drawn last frame, per ring (near, mid, far). */
  readonly drawn = [0, 0, 0];
  /** The drawing buffer's height in pixels (for the minimum blade width); set on resize. */
  bufferHeight = 0;

  constructor(o: GrassFieldInput) {
    this.root.name = 'grass field';
    const t = o.terrain;
    this.terrain = t;
    const N = t.N;

    // Heights at the terrain's samples: texel (ix, iz).
    const hData = new Float32Array(N * N);
    for (let ix = 0; ix < N; ix++) for (let iz = 0; iz < N; iz++) hData[iz * N + ix] = t.heights[t.idx(ix, iz)];
    const heightTex = new THREE.DataTexture(hData, N, N, THREE.RedFormat, THREE.FloatType);
    heightTex.minFilter = heightTex.magFilter = THREE.NearestFilter;
    heightTex.needsUpdate = true;

    // Where grass grows and its colour, at the same samples (sRGB, so dark greens keep precision).
    const fData = new Uint8Array(N * N * 4);
    const c = new THREE.Color();
    for (let ix = 0; ix < N; ix++) {
      for (let iz = 0; iz < N; iz++) {
        const x = t.xOf(ix);
        const z = t.zOf(iz);
        const s = t.surfaces[t.idx(ix, iz)];
        let dens = 0;
        if ((s === Surface.Grass || s === Surface.Pasture) && t.slopeDegAtSample(ix, iz) < 32 && o.allowed(x, z)) {
          const patch = 0.5 + 0.5 * fbm(x / 18, z / 18, 3, 41);
          dens = s === Surface.Pasture ? 1 : 0.55 + 0.45 * patch;
          dens *= 1 - 0.6 * (o.zones?.forest(x, z) ?? 0);
          if (o.density) dens *= 0.5 + 0.5 * o.density(x, z);
        }
        bladeColor(o.groundColor(x, z, c)).convertLinearToSRGB();
        const k = (iz * N + ix) * 4;
        fData[k] = Math.round(THREE.MathUtils.clamp(c.r, 0, 1) * 255);
        fData[k + 1] = Math.round(THREE.MathUtils.clamp(c.g, 0, 1) * 255);
        fData[k + 2] = Math.round(THREE.MathUtils.clamp(c.b, 0, 1) * 255);
        fData[k + 3] = Math.round(dens * 255);
      }
    }
    const fieldTex = new THREE.DataTexture(fData, N, N, THREE.RGBAFormat);
    fieldTex.colorSpace = THREE.SRGBColorSpace;
    fieldTex.magFilter = THREE.LinearFilter;
    fieldTex.minFilter = THREE.LinearFilter;
    fieldTex.needsUpdate = true;

    this.uniforms = {
      ...windUniforms,
      uHeight: { value: heightTex },
      uField: { value: fieldTex },
      uGrassMap: o.grassMap,
      uHasGrassMap: { value: 0 },
      uNoiseTex: { value: noiseTexture() },
      uHalf: { value: t.half },
      uCell: { value: t.cellSize },
      uN: { value: N },
      uSize: { value: t.size },
      uDensity: { value: 1 },
      uHeightScale: { value: 1 },
      uPush: { value: Array.from({ length: MAX_PUSHERS }, () => new THREE.Vector4()) },
      uPushN: { value: 0 },
      uPxAngle: { value: 0.001 },
    };

    const mat = toonMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    mat.customProgramCacheKey = () => 'grassField';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GRASS_VERTEX_HEAD}`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(0.0);\n${GRASS_VERTEX_BODY}`)
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          #ifdef USE_SHADOWMAP
            worldPosition = modelMatrix * instanceMatrix * vec4(grassRoot, 1.0);
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;\nvarying float vGrassT;\nvarying float vGrassGust;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrassCol;')
        // Both faces shade as the ground does: three.js flips a double-sided back face's normal,
        // which made every blade seen from behind dark, the main source of the speckle.
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          #if NUM_DIR_LIGHTS > 0
            // Backlight: with the sun behind the grass, light comes through the blades and the
            // tips glow (strongest at golden hour, when the sun is low).
            vec3 toCam = normalize(vViewPosition);
            float back = pow(max(dot(-toCam, directionalLights[0].direction), 0.0), 5.0);
            totalEmissiveRadiance += vGrassCol * directionalLights[0].color * back * vGrassT * vGrassT * 0.35;
          #endif
          // A sheen where a gust rolls through: the bent blades catch the light.
          totalEmissiveRadiance += vGrassCol * vGrassGust * vGrassT * 0.12;`,
        )
        // Alpha 0 marks grass for the post pass, which leaves ink outlines off blades.
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a = 0.0;');
    };

    // Three rings share the blade buffers; each draws only its first N blades.
    const geo = bladeGeometry();
    const keeps = [1, RINGS.midKeep + 0.06, RINGS.farKeep + 0.04];
    const maxTiles = [64, 160, 420];
    keeps.forEach((k, ring) => {
      const g = new THREE.BufferGeometry();
      for (const name of ['aBlade', 'aShape', 'position']) g.setAttribute(name, geo.getAttribute(name));
      g.setIndex(geo.getIndex());
      g.setDrawRange(0, Math.ceil(Math.min(1, k) * BLADES) * 9);
      const mesh = new THREE.InstancedMesh(g, mat, maxTiles[ring]);
      mesh.count = 0;
      mesh.frustumCulled = false; // tiles are culled here, one by one
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(mesh);
      this.meshes.push(mesh);
    });
  }

  /** Pick the tiles in view, and pass in who is treading on the grass. */
  update(camera: THREE.Camera, pushers: { x: number; z: number; r: number }[], hasGrassMap: boolean): void {
    const u = this.uniforms;
    this.root.visible = grassSettings.enabled;
    if (!grassSettings.enabled) return;
    u.uDensity.value = grassSettings.density;
    u.uHeightScale.value = grassSettings.height;
    u.uHasGrassMap.value = hasGrassMap ? 1 : 0;
    // Only pushers the shader can use (it tramples within 40 m of the camera): every one
    // passed in costs a loop iteration for each nearby blade vertex.
    const px = camera.position.x;
    const pz = camera.position.z;
    let n = 0;
    for (let i = 0; i < pushers.length && n < MAX_PUSHERS; i++) {
      const p = pushers[i];
      if (p.r <= 0 || Math.hypot(p.x - px, p.z - pz) > 40 + p.r) continue;
      (u.uPush.value as THREE.Vector4[])[n++].set(p.x, p.z, p.r, 0);
    }
    u.uPushN.value = n;
    if (camera instanceof THREE.PerspectiveCamera) {
      // Rendered height in pixels (canvas buffer, so pixel ratio is included).
      const hPx = this.bufferHeight || 1080;
      u.uPxAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / hPx;
    }

    this.frustum.setFromProjectionMatrix(this.mat4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cx = camera.position.x;
    const cz = camera.position.z;
    const t = this.terrain;
    const R = RINGS.far;
    const counts = [0, 0, 0];
    const caps = this.meshes.map((m) => m.instanceMatrix.count);
    const i0 = Math.floor((cx - R) / TILE);
    const i1 = Math.floor((cx + R) / TILE);
    const j0 = Math.floor((cz - R) / TILE);
    const j1 = Math.floor((cz + R) / TILE);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const x0 = i * TILE;
        const z0 = j * TILE;
        if (x0 + TILE < -t.half || z0 + TILE < -t.half || x0 > t.half || z0 > t.half) continue;
        // Nearest point of the tile to the camera decides its ring.
        const nx = Math.max(x0, Math.min(cx, x0 + TILE));
        const nz = Math.max(z0, Math.min(cz, z0 + TILE));
        const d = Math.hypot(nx - cx, nz - cz);
        if (d > R) continue;
        const y = t.heightAt(x0 + TILE / 2, z0 + TILE / 2);
        this.box.min.set(x0 - 1, y - 6, z0 - 1);
        this.box.max.set(x0 + TILE + 1, y + 6, z0 + TILE + 1);
        if (!this.frustum.intersectsBox(this.box)) continue;
        const ring = d < RINGS.near + 6 ? 0 : d < RINGS.mid + 7 ? 1 : 2;
        if (counts[ring] >= caps[ring]) continue;
        const arr = this.meshes[ring].instanceMatrix.array as Float32Array;
        const k = counts[ring]++ * 16;
        arr.fill(0, k, k + 16);
        arr[k] = arr[k + 5] = arr[k + 10] = arr[k + 15] = 1;
        arr[k + 12] = x0;
        arr[k + 14] = z0;
      }
    }
    this.meshes.forEach((m, ring) => {
      m.count = counts[ring];
      m.instanceMatrix.needsUpdate = true;
      this.drawn[ring] = counts[ring];
    });
  }
}

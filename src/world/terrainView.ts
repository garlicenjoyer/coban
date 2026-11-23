// Terrain mesh: one vertex per heightfield sample, painted by `groundPaint.ts` (soils,
// meadows, limestone, the dere's cobbles), with fine world-space detail drawn on top near the
// camera so the 2 m vertex spacing never reads as smudge. The 10 m greybox grid is a debug
// toggle (View → 10 m grid).

import * as THREE from 'three';
import { noiseTexture } from '../render/noiseTex';
import { toonMaterial } from '../render/toon';
import type { GrassMap } from './grassMap';
import type { Obstacles } from './obstacles';
import type { WaterPoint } from './water';
import { paintGround } from './groundPaint';
import type { GroundZones } from './mapTypes';
import { Surface, type Terrain } from './terrain';


/**
 * Fine ground detail, in world space, posterized into dabs: grass speckle, soil clods,
 * limestone strata and cracks, the dere's cobbles. `k` fades it out with distance.
 */
const GROUND_DETAIL_GLSL = /* glsl */ `
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 gHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// Smooth value noise with cell = 1, from the shared baked tile (16 cells across).
float gNoise(vec2 p) { return texture2D(uNoiseTex, p * 0.0625).r; }
// Three steps: a darker dab, nothing, a lighter dab.
float dabs(float n, float lo, float hi) { return smoothstep(hi - 0.03, hi + 0.03, n) - smoothstep(lo + 0.03, lo - 0.03, n); }
vec3 groundDetail(vec3 col, vec3 p, vec4 w, float k) {
  if (k <= 0.001) return col;
  // Grass: little tonal dabs, slightly lighter and yellower in the light ones.
  if (w.a > 0.01) {
    float d = dabs(gNoise(p.xz * 1.7) * 0.6 + gNoise(p.xz * 4.3) * 0.4, 0.3, 0.68);
    col *= 1.0 + d * 0.07 * w.a * k * vec3(1.05, 1.0, 0.8);
  }
  // Soil: clods and pebbles.
  if (w.b > 0.01) {
    float d = dabs(gNoise(p.xz * 3.1 + 7.0) * 0.55 + gNoise(p.xz * 9.0) * 0.45, 0.28, 0.72);
    col *= 1.0 + d * 0.09 * w.b * k;
  }
  // Limestone: strata bands that follow the height, broken by cracks.
  if (w.r > 0.01) {
    float wob = gNoise(p.xz * 0.35) * 1.6;
    float band = fract(p.y * 1.1 + wob);
    float strata = smoothstep(0.82, 0.88, band) * (1.0 - smoothstep(0.94, 0.99, band));
    float crack = smoothstep(0.035, 0.0, abs(gNoise(p.xz * 0.9 + vec2(p.y)) - 0.5));
    col *= 1.0 - (strata * 0.14 + crack * 0.07) * w.r * k;
    col *= 1.0 + dabs(gNoise(p.xz * 2.2 + 3.0), 0.3, 0.7) * 0.05 * w.r * k;
  }
  // Cobbles: rounded stones in cells, each its own shade, dark gaps between; bigger stones
  // in places, and drifts of sand where the last flood left it.
  if (w.g > 0.01) {
    float sand = smoothstep(0.58, 0.64, gNoise(p.xz * 0.11 + 31.0) * 0.7 + gNoise(p.xz * 0.5) * 0.3);
    // Two fixed stone sizes in zones (a size that varied smoothly would swirl the cells).
    float size = gNoise(p.xz * 0.07 - 9.0) > 0.56 ? 0.72 : 0.4;
    vec2 q = p.xz / size;
    vec2 cell = floor(q);
    float d1 = 9.0;
    float d2 = 9.0;
    vec2 best = cell;
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        float d = length(q - c - gHash2(c) * 0.8 - 0.1);
        if (d < d1) { d2 = d1; d1 = d; best = c; }
        else if (d < d2) d2 = d;
      }
    // Rounded stones bedded in sand: each a disc of its own size and shade, a darker rim.
    float rad = 0.3 + 0.14 * gHash(best * 3.3);
    float stoneMask = smoothstep(rad + 0.05, rad - 0.02, d1) * smoothstep(0.0, 0.08, d2 - d1);
    float rim = smoothstep(rad - 0.12, rad, d1) * stoneMask;
    float tone = gHash(best * 1.7) - 0.5;
    vec3 stone = col * (1.03 + tone * 0.3) * mix(vec3(1.0), vec3(1.04, 0.98, 0.9), step(0.15, tone));
    vec3 sandy = col * vec3(1.0, 0.95, 0.84);
    float cw = smoothstep(0.35, 0.65, w.g) * k;
    vec3 bed = mix(sandy, stone * (1.0 - rim * 0.22), stoneMask * (1.0 - sand * 0.9));
    col = mix(col, bed, cw);
  }
  return col;
}
`;

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(0, 0, 128, 2);
  g.fillRect(0, 0, 2, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface TerrainView {
  /** The terrain: chunks sharing one set of vertices, each culled on its own. */
  mesh: THREE.Object3D;
  setGrid(on: boolean): void;
  /** Re-upload the grass texture when the grass map changed (cheap no-op otherwise). */
  updateGrass(grass: GrassMap, show: boolean): void;
  /** Bake the hazard map read by "read the land" (slopes, mud, thorns, water). */
  bakeHazards(obstacles: Obstacles, water: readonly WaterPoint[]): void;
  /** Reading the land: 0..1 strength, centred on the shepherd. */
  setReadLand(strength: number, x: number, z: number): void;
  /** Fine ground detail near the camera, 0..1 (0 skips it: a cheaper fragment shader path). */
  setDetail(k: number): void;
  /** The live grass map texture (grazing, trail wear) as a shared uniform. */
  grassMap: { value: THREE.DataTexture | null };
  /** The painted (soft) ground colour at (x, z), interpolated between samples. */
  groundColorAt(x: number, z: number, out: THREE.Color): THREE.Color;
}

export function createTerrainMesh(t: Terrain, zones?: GroundZones, roadDistance?: (x: number, z: number) => number): TerrainView {
  const N = t.N;
  const pos = new Float32Array(N * N * 3);
  const uv = new Float32Array(N * N * 2);
  const GRID_M = 10;
  const paint = paintGround(t, zones, roadDistance);

  for (let ix = 0; ix < N; ix++) {
    for (let iz = 0; iz < N; iz++) {
      const i = t.idx(ix, iz);
      const x = t.xOf(ix);
      const z = t.zOf(iz);
      pos[i * 3] = x;
      pos[i * 3 + 1] = t.heights[i];
      pos[i * 3 + 2] = z;
      uv[i * 2] = x / GRID_M;
      uv[i * 2 + 1] = z / GRID_M;
    }
  }

  // Two triangles per cell, split on the (1,0)-(0,1) diagonal like Rapier's heightfield.
  const cells = N - 1;
  const index = new Uint32Array(cells * cells * 6);
  let k = 0;
  for (let ix = 0; ix < cells; ix++) {
    for (let iz = 0; iz < cells; iz++) {
      const a = t.idx(ix, iz);
      const b = t.idx(ix + 1, iz);
      const d = t.idx(ix, iz + 1);
      const e = t.idx(ix + 1, iz + 1);
      index[k++] = a;
      index[k++] = d;
      index[k++] = b;
      index[k++] = b;
      index[k++] = d;
      index[k++] = e;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(paint.color, 3));
  geo.setAttribute('aDetail', new THREE.BufferAttribute(paint.detail, 4));
  geo.setAttribute('aHardColor', new THREE.BufferAttribute(paint.hardColor, 3));
  geo.setAttribute('aHard', new THREE.BufferAttribute(paint.hard, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();

  const grid = gridTexture();
  const mat = toonMaterial({ vertexColors: true, map: grid });
  // Chunks of CHUNK×CHUNK cells share the vertex buffers; each has its own index range and
  // bounds, so whatever is behind the camera is skipped.
  const mesh = new THREE.Group();
  mesh.name = 'terrain';
  const CHUNK = 100;
  const attrs = ['position', 'color', 'aDetail', 'aHardColor', 'aHard', 'uv', 'normal'] as const;
  for (let cx0 = 0; cx0 < cells; cx0 += CHUNK) {
    for (let cz0 = 0; cz0 < cells; cz0 += CHUNK) {
      const cx1 = Math.min(cells, cx0 + CHUNK);
      const cz1 = Math.min(cells, cz0 + CHUNK);
      const sub = new Uint32Array((cx1 - cx0) * (cz1 - cz0) * 6);
      let n = 0;
      const box = new THREE.Box3();
      for (let ix = cx0; ix < cx1; ix++) {
        // Cells were written ix-major, cz-minor: copy this chunk's run from each column.
        const from = (ix * cells + cz0) * 6;
        sub.set(index.subarray(from, from + (cz1 - cz0) * 6), n);
        n += (cz1 - cz0) * 6;
      }
      for (const ix of [cx0, cx1])
        for (const iz of [cz0, cz1]) box.expandByPoint(new THREE.Vector3(t.xOf(ix), 0, t.zOf(iz)));
      let lo = Infinity;
      let hi = -Infinity;
      for (let ix = cx0; ix <= cx1; ix++)
        for (let iz = cz0; iz <= cz1; iz++) {
          const y = t.heights[t.idx(ix, iz)];
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      box.min.y = lo;
      box.max.y = hi;
      const g = new THREE.BufferGeometry();
      for (const a of attrs) g.setAttribute(a, geo.getAttribute(a));
      g.setIndex(new THREE.BufferAttribute(sub, 1));
      g.boundingBox = box;
      g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      const chunk = new THREE.Mesh(g, mat);
      chunk.receiveShadow = true;
      chunk.name = 'terrain chunk';
      mesh.add(chunk);
    }
  }

  // Grass overlay: R = grass amount, A = grazeable. Grazed ground fades to bare soil.
  let grassTex: THREE.DataTexture | null = null;
  let grassData: Uint8Array | null = null;
  let lastVersion = -1;
  let lastGrass: GrassMap | null = null;
  const uniforms = {
    uGrassMap: { value: null as THREE.DataTexture | null },
    uGrassSize: { value: t.size },
    uGrassHalf: { value: t.half },
    uShowGrass: { value: 1 },
    uHazard: { value: null as THREE.DataTexture | null },
    uRead: { value: 0 },
    uReadAt: { value: new THREE.Vector2() },
    uDetail: { value: 1 },
    uNoiseTex: { value: noiseTexture() },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGrassSize;\nuniform float uGrassHalf;\nvarying vec2 vGrassUv;\nattribute vec4 aDetail;\nvarying vec4 vDetail;\nvarying vec3 vGroundPos;\nattribute vec3 aHardColor;\nattribute float aHard;\nvarying vec3 vHardColor;\nvarying float vHard;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrassUv = (position.xz + uGrassHalf) / uGrassSize;\nvDetail = aDetail;\nvGroundPos = position;\nvHardColor = aHardColor;\nvHard = aHard;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGrassMap;
        uniform sampler2D uHazard;
        uniform float uShowGrass;
        uniform float uRead;
        uniform vec2 uReadAt;
        uniform float uGrassSize;
        uniform float uGrassHalf;
        uniform float uDetail;
        uniform sampler2D uNoiseTex;
        varying vec2 vGrassUv;
        varying vec4 vDetail;
        varying vec3 vGroundPos;
        varying vec3 vHardColor;
        varying float vHard;
        ${GROUND_DETAIL_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Roads, yards and mud: a crisp edge where the blurred mask crosses 0.5, a little ragged.
        float hardEdge = smoothstep(0.46, 0.54, vHard + (gNoise(vGroundPos.xz * 0.7) - 0.5) * 0.12);
        diffuseColor.rgb = mix(diffuseColor.rgb, vHardColor, hardEdge);
        vec4 detailW = vec4(vDetail.r, vDetail.g, vDetail.b, vDetail.a) * (1.0 - hardEdge) + vec4(0.0, 0.0, 0.85, 0.0) * hardEdge;
        diffuseColor.rgb = groundDetail(diffuseColor.rgb, vGroundPos, detailW, uDetail * (1.0 - smoothstep(35.0, 110.0, distance(vGroundPos, cameraPosition))));
        if (uShowGrass > 0.5) {
          vec4 gm = texture2D(uGrassMap, vGrassUv);
          if (gm.a > 0.5) {
            vec3 bare = vec3(0.30, 0.20, 0.11);
            vec3 lush = diffuseColor.rgb * (0.82 + 0.36 * gm.r);
            diffuseColor.rgb = mix(bare, lush, smoothstep(0.0, 0.7, gm.r));
            // Worn trail: packed, sun-bleached earth.
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.63, 0.43), smoothstep(0.25, 0.75, gm.g) * 0.85);
          }
        }
        if (uRead > 0.001) {
          // Reading the land: hatch what's hard going for sheep, near the shepherd.
          vec2 w = vGrassUv * uGrassSize - uGrassHalf;
          float fall = 1.0 - smoothstep(30.0, 45.0, distance(w, uReadAt));
          vec4 hz = texture2D(uHazard, vGrassUv);
          float stripe = step(0.5, fract((w.x + w.y) * 0.6));
          vec3 tint = diffuseColor.rgb;
          tint = mix(tint, vec3(0.86, 0.28, 0.2), hz.r * (0.55 + 0.35 * stripe));
          tint = mix(tint, vec3(0.55, 0.35, 0.18), hz.g * 0.6);
          tint = mix(tint, vec3(0.72, 0.3, 0.62), hz.b * (0.5 + 0.4 * stripe));
          tint = mix(tint, vec3(0.25, 0.55, 0.85), hz.a * 0.7);
          vec4 gm2 = texture2D(uGrassMap, vGrassUv);
          tint = mix(tint, vec3(1.0, 0.86, 0.35), smoothstep(0.25, 0.7, gm2.g) * 0.7);
          diffuseColor.rgb = mix(diffuseColor.rgb, tint, uRead * fall);
        }`,
      );
  };

  return {
    mesh,
    setGrid(on: boolean) {
      mat.map = on ? grid : null;
      mat.needsUpdate = true;
    },
    updateGrass(grass: GrassMap, show: boolean) {
      uniforms.uShowGrass.value = show ? 1 : 0;
      if (!grassTex || grassTex.image.width !== grass.W) {
        grassData = new Uint8Array(grass.W * grass.W * 4);
        grassTex = new THREE.DataTexture(grassData, grass.W, grass.W, THREE.RGBAFormat);
        grassTex.magFilter = THREE.LinearFilter;
        grassTex.minFilter = THREE.LinearFilter;
        uniforms.uGrassMap.value = grassTex;
        lastVersion = -1;
      }
      if (grass === lastGrass && grass.version === lastVersion) return;
      lastGrass = grass;
      lastVersion = grass.version;
      const d = grassData!;
      for (let k = 0; k < grass.value.length; k++) {
        d[k * 4] = Math.round(grass.value[k] * 255);
        d[k * 4 + 1] = Math.round(grass.wear[k] * 255);
        d[k * 4 + 3] = grass.rate[k] > 0 ? 255 : 0;
      }
      grassTex.needsUpdate = true;
    },
    bakeHazards(obstacles: Obstacles, water: readonly WaterPoint[]) {
      // 1 m texels: R too steep for sheep, G mud, B thorns, A water.
      const W = Math.round(t.size);
      const data = new Uint8Array(W * W * 4);
      const thorns = obstacles.byRole('thorn');
      for (let j = 0; j < W; j++) {
        for (let i = 0; i < W; i++) {
          const x = -t.half + i + 0.5;
          const z = -t.half + j + 0.5;
          const k = (j * W + i) * 4;
          const sl = t.slopeDegAt(x, z);
          data[k] = sl > 28 ? 255 : sl > 22 ? 110 : 0;
          data[k + 1] = t.surfaceAt(x, z) === Surface.Mud ? 255 : 0;
          let thorn = 0;
          for (const o of thorns) {
            if (o.kind !== 'circle') continue;
            const d = Math.hypot(x - o.x, z - o.z) - o.r;
            if (d < 2) thorn = Math.max(thorn, 1 - Math.max(0, d) / 2);
          }
          data[k + 2] = Math.round(thorn * 255);
          let wet = 0;
          for (const p of water) {
            const d = Math.hypot(x - p.x, z - p.z) - p.radius;
            if (d < 1.5) wet = 1;
          }
          data[k + 3] = wet ? 255 : 0;
        }
      }
      const tex = new THREE.DataTexture(data, W, W, THREE.RGBAFormat);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      uniforms.uHazard.value = tex;
    },
    grassMap: uniforms.uGrassMap,
    groundColorAt(x: number, z: number, out: THREE.Color) {
      const fx = Math.max(0, Math.min(N - 1.001, (x + t.half) / t.cellSize));
      const fz = Math.max(0, Math.min(N - 1.001, (z + t.half) / t.cellSize));
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const c = paint.color;
      const ch = (k: number) => {
        const a = c[t.idx(ix, iz) * 3 + k];
        const b = c[t.idx(ix + 1, iz) * 3 + k];
        const d = c[t.idx(ix, iz + 1) * 3 + k];
        const e = c[t.idx(ix + 1, iz + 1) * 3 + k];
        return (a + (b - a) * tx) * (1 - tz) + (d + (e - d) * tx) * tz;
      };
      return out.setRGB(ch(0), ch(1), ch(2));
    },
    setDetail(k: number) {
      uniforms.uDetail.value = k;
    },
    setReadLand(strength: number, x: number, z: number) {
      uniforms.uRead.value = strength;
      uniforms.uReadAt.value.set(x, z);
    },
  };
}

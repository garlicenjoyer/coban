// A pre-baked, tiling noise texture shared by the shaders: one texture read instead of a
// handful of sin() hashes per lookup, which matters at full-screen retina resolution.
//
//   R  smooth value noise, 16 lattice cells across the tile (sample at p / 16 for cell = 1)
//   G  fBm for the cloud shadows: 8, 16 and 32 cells across, weighted 0.55 / 0.3 / 0.15

import * as THREE from 'three';

const SIZE = 256;

function hash(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Tiling value noise in 0..1 with `cells` lattice cells across the tile, at texel (x, y). */
function tiled(x: number, y: number, cells: number, seed: number): number {
  const fx = (x / SIZE) * cells;
  const fy = (y / SIZE) * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const s = (t: number) => t * t * (3 - 2 * t);
  const tx = s(fx - ix);
  const ty = s(fy - iy);
  const h = (a: number, b: number) => hash(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, seed);
  const top = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * tx;
  const bot = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * tx;
  return top + (bot - top) * ty;
}

let tex: THREE.DataTexture | null = null;
let cloudSorted: Float32Array | null = null;

export function noiseTexture(): THREE.DataTexture {
  if (tex) return tex;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const cloud = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const k = y * SIZE + x;
      const g = tiled(x, y, 8, 11) * 0.55 + tiled(x, y, 16, 12) * 0.3 + tiled(x, y, 32, 13) * 0.15;
      cloud[k] = g;
      data[k * 4] = Math.round(tiled(x, y, 16, 7) * 255);
      data[k * 4 + 1] = Math.round(g * 255);
      data[k * 4 + 3] = 255;
    }
  }
  cloudSorted = cloud.sort();
  tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** The cloud fBm value above which a share `cover` (0..1) of the ground lies in shadow. */
export function cloudThreshold(cover: number): number {
  noiseTexture();
  const s = cloudSorted!;
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((1 - cover) * s.length)));
  return s[i];
}

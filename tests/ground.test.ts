import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GROUND, paintGround } from '../src/world/groundPaint';
import { VALLEY_MAP, valleyLayout as L } from '../src/world/valley';

const t = VALLEY_MAP.buildTerrain();
const paint = paintGround(t, VALLEY_MAP.ground, VALLEY_MAP.roadDistance);

/** Nearest sample index to (x, z). */
const at = (x: number, z: number) => t.idx(Math.round((x + t.half) / t.cellSize), Math.round((z + t.half) / t.cellSize));
const rgb = (arr: Float32Array, i: number) => new THREE.Color(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);

describe('the painted ground', () => {
  it('marks roads and the yard as hard ground and the pastures as soft', () => {
    const p = L.pastures[0];
    expect(paint.hard[at(p.x, p.z)]).toBe(0);
    // The square in the village is packed dirt.
    expect(paint.hard[at(L.village.x, L.village.z)]).toBeGreaterThan(0.9);
    // The main road at its first bend from the homestead.
    let roadHits = 0;
    for (let x = -500; x < 500; x += 4)
      for (let z = -500; z < 500; z += 4) if (VALLEY_MAP.roadDistance(x, z) < 1) roadHits += paint.hard[at(x, z)] > 0.5 ? 1 : 0;
    expect(roadHits).toBeGreaterThan(100);
  });

  it('paints the dere bed as cobbles with soft edges, and its banks greener', () => {
    const g = VALLEY_MAP.ground!;
    let bed = 0;
    let edge = 0;
    for (let x = -500; x < 500; x += 3)
      for (let z = -500; z < 500; z += 3) {
        const d = g.dere(x, z);
        const c = paint.detail[at(x, z) * 4 + 1];
        if (d < 2 && VALLEY_MAP.roadDistance(x, z) > 8) bed += c > 0.9 ? 1 : 0;
        if (Math.abs(d - g.dereHalf) < 0.5) edge += c > 0.05 && c < 0.95 ? 1 : 0;
      }
    expect(bed).toBeGreaterThan(30);
    expect(edge).toBeGreaterThan(10);
  });

  it('shows red earth in the olive grove and keeps every colour in range', () => {
    const gr = L.grove;
    const c = rgb(paint.color, at((gr.xMin + gr.xMax) / 2, gr.rows[1]));
    // Redder than the straw meadow: more red than green, relatively.
    expect(c.r / c.g).toBeGreaterThan(GROUND.straw.r / GROUND.straw.g);
    for (const arr of [paint.color, paint.hardColor]) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of arr) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1.1);
    }
  });
});

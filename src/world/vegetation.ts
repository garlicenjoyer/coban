// Wildflower patches: small things near the camera are what make the distance feel far.
// Instanced, nodding in the shared wind. (The grass itself is the GPU grass field,
// `grassField.ts`.)

import * as THREE from 'three';
import { toonMaterial } from '../render/toon';
import { sway } from '../render/wind';
import { fbm, rng } from './noise';
import type { Obstacles } from './obstacles';
import { Surface, type Terrain } from './terrain';
import { activeMap, insidePen, layout, roadDistance } from './map';
import { onVillagePaving } from './villagePlan';

const BASE_FLOWERS = 7000;

/** Flowers are drawn this far from the camera (metres), shrinking away over the last stretch. */
const FLOWER_RANGE = 260;
const FADE = 40;
/** Side of a flower cell (metres): each is its own instanced mesh, so it can be culled. */
const CELL = 75;

/** Where grass and flowers may grow: off roads, out of the pen and springs, clear of walls. */
export function grassAllowed(obstacles: Obstacles): (x: number, z: number) => boolean {
  const half = activeMap().size / 2;
  return (x, z) =>
    roadDistance(x, z) > 3.2 &&
    !insidePen(x, z, 1.5) &&
    !onVillagePaving(layout.village, x, z, 0.40) &&
    !layout.springs.some((spring) => Math.hypot(x - spring.x, z - spring.z) < spring.radius + 0.2) &&
    !obstacles.blocked(x, z, 0.35) &&
    Math.abs(x) < half - 4 &&
    Math.abs(z) < half - 4;
}

/** Bucket points into CELL-sized cells. */
function bucket<T extends { x: number; z: number }>(items: T[]): Map<string, T[]> {
  const cells = new Map<string, T[]>();
  for (const it of items) {
    const key = `${Math.floor(it.x / CELL)},${Math.floor(it.z / CELL)}`;
    const list = cells.get(key);
    if (list) list.push(it);
    else cells.set(key, [it]);
  }
  return cells;
}

export class Vegetation {
  readonly root = new THREE.Group();
  private flowerCells: { mesh: THREE.InstancedMesh; cx: number; cz: number }[] = [];
  private dummy = new THREE.Object3D();

  constructor(terrain: Terrain, obstacles: Obstacles) {
    this.root.name = 'vegetation';
    const r = rng(1234);
    const map = activeMap();
    const half = map.size / 2;
    const density = map.tuftDensity;
    const area = (map.size / 400) ** 2;
    const FLOWERS = Math.round(Math.min(20000, BASE_FLOWERS * area * (density ? 0.3 : 1)));
    const allowed = grassAllowed(obstacles);
    const ok = (x: number, z: number) => {
      const s = terrain.surfaceAt(x, z);
      return (s === Surface.Grass || s === Surface.Pasture) && terrain.slopeDegAt(x, z) < 30 && allowed(x, z) && (!density || r() < density(x, z));
    };

    // Wildflowers in drifts: thyme pink, chamomile white, broom yellow, sage lavender. They
    // stand at the height of the grass heads, so the taller grass doesn't swallow them.
    const colors = [0xf4f1e6, 0xf2c94c, 0xc9a7e0, 0xe7a3c0];
    const fGeo = new THREE.IcosahedronGeometry(0.08, 0);
    const fMat = toonMaterial({ color: 0xffffff });
    const prelude = `#ifdef USE_INSTANCING
          float keep = 1.0 - smoothstep(${(FLOWER_RANGE - FADE).toFixed(1)}, ${FLOWER_RANGE.toFixed(1)}, distance(instanceMatrix[3].xz, cameraPosition.xz));
          transformed *= keep;
        #endif`;
    sway(fMat, { key: `flower${FLOWER_RANGE}`, mode: 'rigid', bend: 0.07, refHeight: 1, prelude });
    const flowers: { x: number; z: number; m: THREE.Matrix4; color: number }[] = [];
    for (let tries = 0; flowers.length < FLOWERS && tries < FLOWERS * 30; tries++) {
      const x = (r() - 0.5) * (half * 2 - 8);
      const z = (r() - 0.5) * (half * 2 - 8);
      const drift = fbm(x / 30 + 7, z / 30 - 3, 3, 59);
      if (drift < 0.25 || !ok(x, z)) continue;
      const kind = Math.floor((fbm(x / 60, z / 60, 2, 83) * 0.5 + 0.5) * colors.length) % colors.length;
      this.dummy.position.set(x, terrain.heightAt(x, z) + 0.3 + r() * 0.3, z);
      this.dummy.scale.setScalar(0.8 + r() * 0.6);
      this.dummy.updateMatrix();
      flowers.push({ x, z, m: this.dummy.matrix.clone(), color: colors[kind] });
    }
    const c = new THREE.Color();
    for (const list of bucket(flowers).values()) {
      const mesh = new THREE.InstancedMesh(fGeo, fMat, list.length);
      let cx = 0;
      let cz = 0;
      list.forEach((f, i) => {
        mesh.setMatrixAt(i, f.m);
        mesh.setColorAt(i, c.setHex(f.color));
        cx += f.x;
        cz += f.z;
      });
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      this.flowerCells.push({ mesh, cx: cx / list.length, cz: cz / list.length });
    }
  }

  /** Show only nearby cells. */
  update(eye: { x: number; z: number }): void {
    // A cell's centre can sit up to half a diagonal from its farthest flower.
    const reach = CELL * 0.75;
    for (const c of this.flowerCells) c.mesh.visible = Math.hypot(c.cx - eye.x, c.cz - eye.z) < FLOWER_RANGE + reach;
  }
}

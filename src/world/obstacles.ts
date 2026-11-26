// Static 2D obstacles for animals (sheep do not use Rapier: 30 cheap discs on a
// heightfield is all the greybox needs). Built from the same props as the colliders.

import type { MapProps, Prop, PropRole } from './map';

export interface CircleObstacle {
  kind: 'circle';
  role: PropRole;
  x: number;
  z: number;
  r: number;
  enabled: boolean;
}

export interface BoxObstacle {
  kind: 'box';
  role: PropRole;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  enabled: boolean;
}

export type Obstacle = CircleObstacle | BoxObstacle;

export interface PushResult {
  x: number;
  z: number;
  /** Role of the last obstacle that pushed, or null. */
  hit: PropRole | null;
}

const CELL = 8;

export class Obstacles {
  readonly list: Obstacle[] = [];
  private grid = new Map<number, number[]>();

  constructor(map: MapProps) {
    for (const p of map.props) this.add(p);
  }

  /** Add a prop's footprint (map props, and things the shepherd builds later). */
  add(p: Prop): void {
    let o: Obstacle;
    if (p.kind === 'box') {
      o = { kind: 'box', role: p.role, minX: p.x - p.hx, maxX: p.x + p.hx, minZ: p.z - p.hz, maxZ: p.z + p.hz, enabled: true };
    } else if (p.role !== 'marker') {
      o = { kind: 'circle', role: p.role, x: p.x, z: p.z, r: p.radius, enabled: true };
    } else return;
    const i = this.list.length;
    this.list.push(o);
    const [minX, maxX, minZ, maxZ] =
      o.kind === 'box' ? [o.minX, o.maxX, o.minZ, o.maxZ] : [o.x - o.r, o.x + o.r, o.z - o.r, o.z + o.r];
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const k = (ix + 4096) * 8192 + (iz + 4096);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(i);
      }
    }
  }

  byRole(role: PropRole): Obstacle[] {
    return this.list.filter((o) => o.role === role);
  }

  forEachNear(x: number, z: number, r: number, cb: (o: Obstacle) => void): void {
    const seen = new Set<number>();
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const arr = this.grid.get((ix + 4096) * 8192 + (iz + 4096));
        if (!arr) continue;
        for (const i of arr) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (this.list[i].enabled) cb(this.list[i]);
        }
      }
    }
  }

  /** True if a disc of radius r at (x, z) overlaps any enabled obstacle. */
  blocked(x: number, z: number, r: number): boolean {
    let hit = false;
    this.forEachNear(x, z, r, (o) => {
      if (hit) return;
      if (o.kind === 'circle') hit = Math.hypot(x - o.x, z - o.z) < o.r + r;
      else {
        const cx = Math.max(o.minX, Math.min(x, o.maxX));
        const cz = Math.max(o.minZ, Math.min(z, o.maxZ));
        hit = Math.hypot(x - cx, z - cz) < r;
      }
    });
    return hit;
  }

  clearBetween(a: { x: number; z: number }, b: { x: number; z: number }, radius = 0.1): boolean {
    const dx = b.x - a.x, dz = b.z - a.z;
    const samples = Math.ceil(Math.hypot(dx, dz) / 0.45);
    for (let i = 1; i < samples; i++) {
      if (this.blocked(a.x + dx * i / samples, a.z + dz * i / samples, radius)) return false;
    }
    return true;
  }

  /** Push a disc out of every obstacle it penetrates. */
  pushOut(x: number, z: number, r: number): PushResult {
    let hit: PropRole | null = null;
    this.forEachNear(x, z, r + 0.5, (o) => {
      if (o.kind === 'circle') {
        const dx = x - o.x;
        const dz = z - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.r + r;
        if (d < min) {
          const nx = d > 1e-6 ? dx / d : 1;
          const nz = d > 1e-6 ? dz / d : 0;
          x = o.x + nx * min;
          z = o.z + nz * min;
          hit = o.role;
        }
      } else {
        const cx = Math.max(o.minX, Math.min(x, o.maxX));
        const cz = Math.max(o.minZ, Math.min(z, o.maxZ));
        const dx = x - cx;
        const dz = z - cz;
        const d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-6) {
            x = cx + (dx / d) * r;
            z = cz + (dz / d) * r;
          } else {
            // Centre inside the box: leave by the nearest face.
            const opts = [
              [x - o.minX + r, -1, 0],
              [o.maxX - x + r, 1, 0],
              [z - o.minZ + r, 0, -1],
              [o.maxZ - z + r, 0, 1],
            ];
            opts.sort((a, b) => a[0] - b[0]);
            x += opts[0][1] * opts[0][0];
            z += opts[0][2] * opts[0][0];
          }
          hit = o.role;
        }
      }
    });
    return { x, z, hit };
  }
}

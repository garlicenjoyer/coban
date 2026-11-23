// Grid pathfinding for the animals (sheep, the Kangal, wolves).
//
// Steering alone heads straight for the goal and slides along whatever is in the way, so a
// sheep behind the pen fence, or a dog on the far side of a house, presses into it forever.
// NavGrid rasterises the static obstacles (inflated by a body clearance) onto a 1 m grid and
// answers two questions: is the straight line clear, and if not, which way round (A*).
// NavAgent wraps that per animal: straight at the goal while the line is clear, otherwise
// along a cached, string-pulled path that is re-planned now and then or when the goal moves.
//
// Dynamic obstacles (the pen gate) are re-checked on every query, so an open gate is a way
// through and a shut one is a wall. Steep ground is blocked above `maxSlope` and costs more
// above `softSlope`. Everything is deterministic: no clocks, no randomness.

import type { Obstacle, Obstacles } from './obstacles';
import type { Terrain } from './terrain';

export interface NavOptions {
  /** Cells steeper than this (degrees) are impassable. */
  maxSlope: number;
  /** Cells steeper than this cost extra, so paths prefer gentler ground. */
  softSlope: number;
}

const DEFAULT_OPTS: NavOptions = { maxSlope: 90, softSlope: 90 };
const MAX_EXPANSIONS = 30000;
const UNKNOWN_SLOPE = 255;

export class NavGrid {
  /** Cell size, metres. */
  readonly cell = 1;
  /** Cells per side. */
  readonly n: number;
  /** World coordinate of the grid's low edge (x and z). */
  readonly origin: number;
  /** Bumped whenever the blocked set changes (gate opened, prop built). */
  version = 0;

  /** Number of enabled obstacles covering each cell. */
  private count: Uint16Array;
  private slope: Uint8Array;
  /** Cells within this many of the map edge are blocked. */
  private edge: number;
  private applied: boolean[] = [];
  private dynamic: number[] = [];

  // A* scratch, reused across searches (stamp = gen*2 open, gen*2+1 closed).
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private gen = 0;
  private heapIdx = new Int32Array(4096);
  private heapF = new Float32Array(4096);
  private heapSize = 0;

  constructor(
    private terrain: Terrain,
    private obstacles: Obstacles,
    /** Body clearance baked into the grid (largest animal radius plus a little). */
    readonly clearance = 0.5,
  ) {
    this.n = Math.ceil(terrain.size / this.cell);
    this.origin = -terrain.half;
    const N = this.n * this.n;
    this.count = new Uint16Array(N);
    this.slope = new Uint8Array(N).fill(UNKNOWN_SLOPE);
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.edge = Math.ceil(5 / this.cell);
    this.sync();
  }

  // ------------------------------------------------------------ grid state

  /** Pick up toggled gates and newly built props. Cheap: call before queries. */
  sync(): void {
    const L = this.obstacles.list;
    if (L.length !== this.applied.length) {
      for (let k = this.applied.length; k < L.length; k++) {
        this.applied.push(false);
        if (L[k].role === 'gate') this.dynamic.push(k);
      }
      for (let k = 0; k < L.length; k++) this.syncOne(k);
      return;
    }
    for (const k of this.dynamic) this.syncOne(k);
  }

  private syncOne(k: number): void {
    const o = this.obstacles.list[k];
    if (o.enabled === this.applied[k]) return;
    this.applied[k] = o.enabled;
    this.rasterise(o, o.enabled ? 1 : -1);
    this.version++;
  }

  private rasterise(o: Obstacle, delta: number): void {
    const c = this.clearance;
    const h = this.cell / 2;
    const pad = Math.max(c, h) + this.cell;
    const [minX, maxX, minZ, maxZ] =
      o.kind === 'box' ? [o.minX, o.maxX, o.minZ, o.maxZ] : [o.x - o.r, o.x + o.r, o.z - o.r, o.z + o.r];
    const ix0 = Math.max(0, this.toCell(minX - pad));
    const ix1 = Math.min(this.n - 1, this.toCell(maxX + pad));
    const iz0 = Math.max(0, this.toCell(minZ - pad));
    const iz1 = Math.min(this.n - 1, this.toCell(maxZ + pad));
    for (let ix = ix0; ix <= ix1; ix++) {
      const cx = this.centre(ix);
      for (let iz = iz0; iz <= iz1; iz++) {
        const cz = this.centre(iz);
        let hit: boolean;
        if (o.kind === 'circle') {
          // Centre within clearance, or the raw disc overlaps the cell square (thin
          // things never fall between cell centres).
          const qx = Math.max(cx - h, Math.min(o.x, cx + h));
          const qz = Math.max(cz - h, Math.min(o.z, cz + h));
          hit = Math.hypot(cx - o.x, cz - o.z) < o.r + c || Math.hypot(o.x - qx, o.z - qz) < o.r;
        } else {
          const dx = Math.max(o.minX - cx, 0, cx - o.maxX);
          const dz = Math.max(o.minZ - cz, 0, cz - o.maxZ);
          hit = Math.hypot(dx, dz) < c || (o.minX < cx + h && o.maxX > cx - h && o.minZ < cz + h && o.maxZ > cz - h);
        }
        if (hit) {
          const i = ix * this.n + iz;
          this.count[i] = Math.max(0, this.count[i] + delta);
        }
      }
    }
  }

  toCell(v: number): number {
    return Math.floor((v - this.origin) / this.cell);
  }

  centre(i: number): number {
    return this.origin + (i + 0.5) * this.cell;
  }

  private slopeOf(i: number): number {
    let s = this.slope[i];
    if (s === UNKNOWN_SLOPE) {
      const ix = Math.floor(i / this.n);
      const iz = i - ix * this.n;
      s = Math.min(254, Math.round(this.terrain.slopeDegAt(this.centre(ix), this.centre(iz))));
      this.slope[i] = s;
    }
    return s;
  }

  private inside(ix: number, iz: number): boolean {
    return ix >= this.edge && iz >= this.edge && ix < this.n - this.edge && iz < this.n - this.edge;
  }

  /** Cell (ix, iz) can't be stood in. */
  blockedCell(ix: number, iz: number, o: NavOptions = DEFAULT_OPTS): boolean {
    if (!this.inside(ix, iz)) return true;
    const i = ix * this.n + iz;
    if (this.count[i] > 0) return true;
    return o.maxSlope < 90 && this.slopeOf(i) > o.maxSlope;
  }

  /** World point lies in a blocked cell. */
  blockedAt(x: number, z: number, o: NavOptions = DEFAULT_OPTS): boolean {
    return this.blockedCell(this.toCell(x), this.toCell(z), o);
  }

  // ------------------------------------------------------------ line of sight

  /**
   * Every cell the segment passes through is free (supercover walk). The start and end
   * cells are not checked: an animal pressed against a fence, or a goal on a trough, still
   * counts as reachable in a straight line if nothing lies between.
   */
  clear(x0: number, z0: number, x1: number, z1: number, o: NavOptions = DEFAULT_OPTS): boolean {
    let ix = this.toCell(x0);
    let iz = this.toCell(z0);
    const ex = this.toCell(x1);
    const ez = this.toCell(z1);
    if (ix === ex && iz === ez) return true;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const cs = this.cell;
    const tdx = sx !== 0 ? cs / Math.abs(dx) : Infinity;
    const tdz = sz !== 0 ? cs / Math.abs(dz) : Infinity;
    const bx = this.origin + (ix + (sx > 0 ? 1 : 0)) * cs;
    const bz = this.origin + (iz + (sz > 0 ? 1 : 0)) * cs;
    let tmx = sx !== 0 ? (bx - x0) / dx : Infinity;
    let tmz = sz !== 0 ? (bz - z0) / dz : Infinity;
    const limit = Math.abs(ex - ix) + Math.abs(ez - iz) + 2;
    for (let step = 0; step < limit; step++) {
      if (Math.abs(tmx - tmz) < 1e-9) {
        // Through a corner: both side cells must be free too.
        if (!(ix + sx === ex && iz === ez) && this.blockedCell(ix + sx, iz, o)) return false;
        if (!(ix === ex && iz + sz === ez) && this.blockedCell(ix, iz + sz, o)) return false;
        ix += sx;
        iz += sz;
        tmx += tdx;
        tmz += tdz;
      } else if (tmx < tmz) {
        ix += sx;
        tmx += tdx;
      } else {
        iz += sz;
        tmz += tdz;
      }
      if (ix === ex && iz === ez) return true;
      if (this.blockedCell(ix, iz, o)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ A*

  /** Nearest free cell to (x, z) within `reach` cells, or -1. */
  private nearestFree(x: number, z: number, reach: number, o: NavOptions): number {
    const cx = this.toCell(x);
    const cz = this.toCell(z);
    if (!this.blockedCell(cx, cz, o)) return cx * this.n + cz;
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= reach; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          if (this.blockedCell(ix, iz, o)) continue;
          const d = Math.hypot(this.centre(ix) - x, this.centre(iz) - z);
          if (d < bestD) {
            bestD = d;
            best = ix * this.n + iz;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  private push(i: number, f: number): void {
    if (this.heapSize >= this.heapIdx.length) {
      const ni = new Int32Array(this.heapIdx.length * 2);
      const nf = new Float32Array(this.heapF.length * 2);
      ni.set(this.heapIdx);
      nf.set(this.heapF);
      this.heapIdx = ni;
      this.heapF = nf;
    }
    let k = this.heapSize++;
    const H = this.heapIdx;
    const F = this.heapF;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (F[p] <= f) break;
      H[k] = H[p];
      F[k] = F[p];
      k = p;
    }
    H[k] = i;
    F[k] = f;
  }

  private pop(): number {
    const H = this.heapIdx;
    const F = this.heapF;
    const top = H[0];
    const n = --this.heapSize;
    if (n > 0) {
      const li = H[n];
      const lf = F[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        H[k] = H[c];
        F[k] = F[c];
        k = c;
      }
      H[k] = li;
      F[k] = lf;
    }
    return top;
  }

  /**
   * Path from (x0, z0) toward (x1, z1) as world waypoints (start excluded, string-pulled).
   * If the goal can't be reached, the path ends at the closest reachable point and
   * `partial` is set. Returns null if the start is boxed in.
   */
  findPath(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    o: NavOptions = DEFAULT_OPTS,
    maxExpansions = MAX_EXPANSIONS,
  ): { points: number[]; partial: boolean } | null {
    this.sync();
    const n = this.n;
    const start = this.nearestFree(x0, z0, 3, o);
    if (start < 0) return null;
    const goalFree = this.nearestFree(x1, z1, 4, o);
    const goal = goalFree >= 0 ? goalFree : this.toCell(x1) * n + this.toCell(z1);
    const gx = Math.floor(goal / n);
    const gz = goal - gx * n;

    if (++this.gen > 0x7ffffffe) {
      this.stamp.fill(0);
      this.gen = 1;
    }
    const OPEN = this.gen * 2;
    const CLOSED = OPEN + 1;
    const G = this.g;
    const P = this.parent;
    const S = this.stamp;
    const soft = o.softSlope < 90;
    const h = (ix: number, iz: number) => {
      const dx = Math.abs(ix - gx);
      const dz = Math.abs(iz - gz);
      return (dx > dz ? dx + 0.41421356 * dz : dz + 0.41421356 * dx) * this.cell;
    };

    this.heapSize = 0;
    const sx = Math.floor(start / n);
    const sz = start - sx * n;
    G[start] = 0;
    P[start] = -1;
    S[start] = OPEN;
    this.push(start, h(sx, sz));
    let best = start;
    let bestH = h(sx, sz);
    let reached = false;
    let expanded = 0;

    while (this.heapSize > 0) {
      const cur = this.pop();
      if (S[cur] === CLOSED) continue;
      S[cur] = CLOSED;
      if (cur === goal) {
        reached = true;
        best = cur;
        break;
      }
      if (++expanded > maxExpansions) break;
      const cx = Math.floor(cur / n);
      const cz = cur - cx * n;
      const ch = h(cx, cz);
      if (ch < bestH) {
        bestH = ch;
        best = cur;
      }
      const g0 = G[cur];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          const ni = nx * n + nz;
          if (S[ni] === CLOSED) continue;
          if (this.blockedCell(nx, nz, o)) continue;
          const diag = dx !== 0 && dz !== 0;
          // No cutting corners past a blocked cell.
          if (diag && (this.blockedCell(cx + dx, cz, o) || this.blockedCell(cx, cz + dz, o))) continue;
          let step = (diag ? Math.SQRT2 : 1) * this.cell;
          if (soft) {
            const sl = this.slopeOf(ni);
            if (sl > o.softSlope) step *= 1 + ((sl - o.softSlope) / Math.max(1, o.maxSlope - o.softSlope)) * 3;
          }
          const ng = g0 + step;
          if (S[ni] === OPEN && ng >= G[ni]) continue;
          G[ni] = ng;
          P[ni] = cur;
          S[ni] = OPEN;
          this.push(ni, ng + h(nx, nz));
        }
      }
    }

    // Walk back, then string-pull from the real start position.
    const cells: number[] = [];
    for (let c = best; c >= 0; c = P[c]) cells.push(c);
    cells.reverse();
    const pts: number[] = [];
    const cxOf = (c: number) => this.centre(Math.floor(c / n));
    const czOf = (c: number) => this.centre(c - Math.floor(c / n) * n);
    let ax = x0;
    let az = z0;
    for (let k = 1; k < cells.length; k++) {
      const nextX = k + 1 < cells.length ? cxOf(cells[k + 1]) : cxOf(cells[k]);
      const nextZ = k + 1 < cells.length ? czOf(cells[k + 1]) : czOf(cells[k]);
      if (k + 1 < cells.length && this.clear(ax, az, nextX, nextZ, o)) continue;
      ax = cxOf(cells[k]);
      az = czOf(cells[k]);
      pts.push(ax, az);
    }
    const partial = !reached || goalFree < 0;
    // The last leg goes to the real goal when it was reached in its own cell.
    if (!partial && goal === this.toCell(x1) * n + this.toCell(z1)) {
      if (pts.length >= 2) {
        pts[pts.length - 2] = x1;
        pts[pts.length - 1] = z1;
      } else pts.push(x1, z1);
    } else if (pts.length === 0) pts.push(cxOf(best), czOf(best));
    return { points: pts, partial };
  }
}

const grids = new WeakMap<Obstacles, NavGrid>();

/** The shared nav grid for a set of obstacles (built on first use). */
export function navFor(terrain: Terrain, obstacles: Obstacles): NavGrid {
  let g = grids.get(obstacles);
  if (!g) grids.set(obstacles, (g = new NavGrid(terrain, obstacles)));
  return g;
}

/**
 * One animal's route to one kind of goal. Call `steer` every tick with the current goal;
 * it returns the point to head for right now (the goal itself when the way is clear).
 */
export class NavAgent {
  private pts: number[] = [];
  private idx = 0;
  private goalX = NaN;
  private goalZ = NaN;
  private age: number;
  private version = -1;
  private partial = false;
  /** True while the returned point is a detour waypoint, not the goal. */
  detour = false;

  constructor(
    private grid: NavGrid,
    private opts: NavOptions,
    /** Seconds between re-plans while following a path. */
    private replanEvery = 0.75,
    /** Spread re-plans of many agents over different ticks. */
    phase = 0,
  ) {
    this.age = (phase % 1) * replanEvery;
  }

  reset(): void {
    this.pts.length = 0;
    this.detour = false;
  }

  steer(x: number, z: number, tx: number, tz: number, dt: number): { x: number; z: number } {
    const nav = this.grid;
    nav.sync();
    if (nav.clear(x, z, tx, tz, this.opts)) {
      this.pts.length = 0;
      this.detour = false;
      return { x: tx, z: tz };
    }
    this.age += dt;
    const dist = Math.hypot(tx - x, tz - z);
    const moved = Math.hypot(tx - this.goalX, tz - this.goalZ);
    const wp = this.idx * 2;
    const lost =
      this.pts.length > 0 && Math.hypot(this.pts[wp] - x, this.pts[wp + 1] - z) > 4 && !nav.clear(x, z, this.pts[wp], this.pts[wp + 1], this.opts);
    if (
      this.pts.length === 0 ||
      this.version !== nav.version ||
      !(moved < Math.max(1.5, dist * 0.25)) ||
      this.age >= (this.partial ? this.replanEvery * 2 : this.replanEvery) ||
      lost
    ) {
      this.age = 0;
      this.goalX = tx;
      this.goalZ = tz;
      this.version = nav.version;
      const r = nav.findPath(x, z, tx, tz, this.opts);
      this.pts = r ? r.points : [];
      this.partial = r ? r.partial : true;
      this.idx = 0;
    }
    if (this.pts.length === 0) {
      this.detour = false;
      return { x: tx, z: tz };
    }
    // Move on to later waypoints as soon as they come into view.
    const last = this.pts.length / 2 - 1;
    while (this.idx < last) {
      const i = this.idx * 2;
      const near = Math.hypot(this.pts[i] - x, this.pts[i + 1] - z) < 0.6;
      if (near || nav.clear(x, z, this.pts[i + 2], this.pts[i + 3], this.opts)) this.idx++;
      else break;
    }
    const i = this.idx * 2;
    const px = this.pts[i];
    const pz = this.pts[i + 1];
    // At the end of a full path: head for the goal itself.
    if (this.idx === last && !this.partial && Math.hypot(px - x, pz - z) < 0.6) {
      this.detour = false;
      return { x: tx, z: tz };
    }
    this.detour = true;
    return { x: px, z: pz };
  }
}

// Heightfield + surface map container with sampling helpers.
// Storage layout matches Rapier's heightfield (column-major): index = iz + ix * N,
// where ix runs along +x and iz along +z, both starting at -size/2.

export enum Surface {
  Grass = 0,
  Dirt = 1,
  Gravel = 2,
  Mud = 3,
  Rock = 4,
  Pasture = 5,
  /** Village road (not on the test map yet; used by bike tests). */
  Asphalt = 6,
}

export const SURFACE_NAMES = ['grass', 'dirt', 'gravel', 'mud', 'rock', 'pasture', 'asphalt'] as const;

export class Terrain {
  /** Samples per side. */
  readonly N: number;
  /** Cells per side (N - 1). */
  readonly cells: number;
  readonly cellSize: number;
  readonly half: number;
  readonly heights: Float32Array;
  readonly surfaces: Uint8Array;

  constructor(readonly size: number, samples: number) {
    this.N = samples;
    this.cells = samples - 1;
    this.cellSize = size / this.cells;
    this.half = size / 2;
    this.heights = new Float32Array(samples * samples);
    this.surfaces = new Uint8Array(samples * samples);
  }

  idx(ix: number, iz: number): number {
    return iz + ix * this.N;
  }

  /** World x of sample column ix. */
  xOf(ix: number): number {
    return -this.half + ix * this.cellSize;
  }

  zOf(iz: number): number {
    return -this.half + iz * this.cellSize;
  }

  h(ix: number, iz: number): number {
    const n = this.N - 1;
    ix = ix < 0 ? 0 : ix > n ? n : ix;
    iz = iz < 0 ? 0 : iz > n ? n : iz;
    return this.heights[iz + ix * this.N];
  }

  /**
   * Height at a world position, interpolated on the same two triangles per cell
   * that the render mesh and Rapier's heightfield use (diagonal (1,0)-(0,1),
   * verified against Rapier ray casts in tests/world.test.ts).
   */
  heightAt(x: number, z: number): number {
    const gx = (x + this.half) / this.cellSize;
    const gz = (z + this.half) / this.cellSize;
    let ix = Math.floor(gx);
    let iz = Math.floor(gz);
    ix = Math.max(0, Math.min(this.cells - 1, ix));
    iz = Math.max(0, Math.min(this.cells - 1, iz));
    const fx = Math.max(0, Math.min(1, gx - ix));
    const fz = Math.max(0, Math.min(1, gz - iz));
    const h10 = this.h(ix + 1, iz);
    const h01 = this.h(ix, iz + 1);
    if (fx + fz <= 1) {
      const h00 = this.h(ix, iz);
      return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    }
    const h11 = this.h(ix + 1, iz + 1);
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  surfaceAt(x: number, z: number): Surface {
    const ix = Math.round((x + this.half) / this.cellSize);
    const iz = Math.round((z + this.half) / this.cellSize);
    if (ix < 0 || iz < 0 || ix >= this.N || iz >= this.N) return Surface.Rock;
    return this.surfaces[this.idx(ix, iz)] as Surface;
  }

  /** Slope in degrees at a sample, from central differences. */
  slopeDegAtSample(ix: number, iz: number): number {
    const dx = (this.h(ix + 1, iz) - this.h(ix - 1, iz)) / (2 * this.cellSize);
    const dz = (this.h(ix, iz + 1) - this.h(ix, iz - 1)) / (2 * this.cellSize);
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  }

  slopeDegAt(x: number, z: number): number {
    const e = this.cellSize;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  }
}

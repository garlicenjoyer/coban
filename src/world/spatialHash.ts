// Uniform 2D grid over x/z for neighbour queries. Rebuilt every tick for moving
// agents (sheep now; dog and predators later). Cell size 8 m per the GDD.

export class SpatialHash {
  private cells = new Map<number, number[]>();
  private pool: number[][] = [];

  constructor(readonly cellSize = 8) {}

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  clear(): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.cells.clear();
  }

  insert(id: number, x: number, z: number): void {
    const k = this.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    let arr = this.cells.get(k);
    if (!arr) {
      arr = this.pool.pop() ?? [];
      this.cells.set(k, arr);
    }
    arr.push(id);
  }

  /** Ids in every cell overlapping the square around (x, z) of half-size r. Order is deterministic. */
  query(x: number, z: number, r: number, out: number[]): number[] {
    out.length = 0;
    const s = this.cellSize;
    const x0 = Math.floor((x - r) / s);
    const x1 = Math.floor((x + r) / s);
    const z0 = Math.floor((z - r) / s);
    const z1 = Math.floor((z + r) / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(this.key(ix, iz));
        if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }
}

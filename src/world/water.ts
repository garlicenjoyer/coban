import { insidePen, layout } from './map';

export const CAN_LITERS = 20;
export const RACK_CANS = 2;

export interface WaterPoint {
  readonly id: number;
  readonly kind: 'fountain' | 'trough' | 'spring' | 'basin';
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly inPen: boolean;
  /** Null for flowing water. */
  liters: number | null;
  /** Most it can hold (the built cistern); unlimited if unset. */
  readonly capacity?: number;
}

export class WaterSupply {
  readonly points: WaterPoint[] = [];

  constructor() {
    this.add('fountain', 'the çeşme', layout.cesme.x, layout.cesme.z, 1.15);
    this.add('trough', 'the pen trough', layout.penTrough.x, layout.penTrough.z, 1.25);
    for (const { name, x, z, radius } of layout.springs) this.add('spring', name, x, z, radius);
  }

  private add(kind: WaterPoint['kind'], name: string, x: number, z: number, radius: number, liters: number | null = null, capacity?: number): WaterPoint {
    const point: WaterPoint = { id: this.points.length, kind, name, x, z, radius, inPen: insidePen(x, z), liters, capacity };
    this.points.push(point);
    return point;
  }

  /** A vessel you can pour into: a folding basin, or the built cistern. */
  basinNear(x: number, z: number): WaterPoint | undefined {
    const inPen = insidePen(x, z);
    return this.points.find((p) =>
      (p.kind === 'basin' || (p.capacity !== undefined && p.liters !== null)) &&
      p.inPen === inPen && Math.hypot(p.x - x, p.z - z) < (p.capacity !== undefined ? 4.5 : 3.5));
  }

  pourCan(x: number, z: number): WaterPoint {
    const basin = this.basinNear(x, z);
    if (!basin) return this.add('basin', 'the folding basin', x, z, 1.05, CAN_LITERS);
    basin.liters = Math.min(basin.capacity ?? Infinity, basin.liters! + CAN_LITERS);
    return basin;
  }

  /** The stone cistern at the dry pasture, once built. */
  /** Put back a water point from a save: fill an existing one by name, or add a basin. */
  restore(kind: WaterPoint['kind'], name: string, x: number, z: number, radius: number, liters: number | null, capacity?: number): void {
    const existing = this.points.find((p) => p.name === name && p.kind === kind && Math.hypot(p.x - x, p.z - z) < 0.5);
    if (existing) existing.liters = liters;
    else this.add(kind, name, x, z, radius, liters, capacity);
  }

  addCistern(name: string, x: number, z: number, radius: number, capacity: number): WaterPoint {
    return this.add('trough', name, x, z, radius, 0, capacity);
  }

  /** Overnight rain collects in cisterns. */
  rain(liters: number): void {
    for (const p of this.points) if (p.capacity !== undefined && p.liters !== null) p.liters = Math.min(p.capacity, p.liters + liters);
  }

  drink(point: WaterPoint, requested: number): number {
    if (point.liters === null) return requested;
    const amount = Math.min(requested, point.liters);
    point.liters -= amount;
    return amount;
  }

  stateKey(): number[][] {
    return this.points.filter((p) => p.liters !== null).map((p) => [p.x, p.z, p.liters!]);
  }
}

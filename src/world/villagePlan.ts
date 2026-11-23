import type { Layout } from './mapTypes';

type Village = NonNullable<Layout['village']>;
type Point = readonly [x: number, z: number];

export const COFFEEHOUSE: [number, number, number, number, number] = [0, 19, 6, 4, 3.6];
export const MOSQUE: [number, number, number, number, number] = [-34, 28, 5, 5, 5];
export const SQUARE_TREE = { x: -11, z: -7, radius: 0.50, height: 13 };
export const COURTYARD_TREES = [[-34.4, 16.8], [-23.8, -12.9], [-4.15, -22.6], [19.2, -29.1],
  [42.4, -2.8], [49.8, -27.5], [53.1, 3.5], [-7.5, 25.4]].map(([x, z], i) => ({
  x, z, radius: 0.23, height: 5.3 + (i % 3) * 0.65,
}));
export const FOUNTAIN = { x: 5.7, z: -5.4, radius: 1.73, height: 0.80 };

const lanes: { width: number; course: Point[] }[] = [
  { width: 2.74, course: [[-30, 42], [-23, 33], [-17, 24], [-10, 14], [-5, 7], [0, 0]] },
  { width: 2.22, course: [[-42, 35], [-34, 35], [-27, 33], [-22, 32]] },
  { width: 2.42, course: [[-31, 18], [-20, 13], [-17, 12], [-11, 6]] },
  { width: 2.38, course: [[-21, -3], [-17, -1], [-13, 0]] },
  { width: 2.53, course: [[12, -2], [17, -4], [20, -5], [23, -7]] },
  { width: 2.24, course: [[11, 7], [17, 8], [21, 10], [25, 11]] },
  { width: 2.24, course: [[-19, -10], [-19, -15], [-11, -17], [0, -17], [12, -15], [22, -17], [34, -20], [48, -19], [60, -18]] },
  { width: 1.92, course: [[-8, -11], [-6, -17], [-3, -28], [0, -36], [13, -36], [26, -36], [36, -32], [46, -25], [51, -19]] },
  { width: 1.65, course: [[-19, -15], [-22, -21], [-23, -30], [-16, -34], [-5, -36]] },
  { width: 1.89, course: [[32, -20], [34, -13], [34, -5], [37, 2], [44, -1], [52, -4], [59, -2]] },
  { width: 1.78, course: [[17, 9], [22, 18], [27, 23], [33, 23]] },
];

const aprons = [
  [-19.9, -3.8, 2.50, 3.32], [-21.3, 11.9, 2.90, 3.32], [20.6, -5.4, 2.38, 3.35],
  [22.1, 9.0, 2.35, 3.31], [0, 12, 5.85, 3.46], [-31.8, 28, 4.05, 3.55],
] as const;

const edges = lanes.flatMap(({ width, course }) => course.slice(1).map(([x, z], i) => {
  const [ax, az] = course[i];
  const dx = x - ax, dz = z - az;
  return { ax, az, dx, dz, width, inverseLength: 1 / (dx * dx + dz * dz) };
}));

/** A signed distance used by the paving mesh and nearby vegetation. Coordinates are square-relative. */
export function pavingDistance(x: number, z: number): number {
  if (x < -48 || x > 68 || z < -53 || z > 48) return Infinity;
  let d = Math.max(Math.abs(x + 0.34) - 15.65, Math.abs(z + 0.18) - 10.88);
  if (d < -0.5) return d;
  for (const [ax, az, hx, hz] of aprons) {
    d = Math.min(d, Math.max(Math.abs(x - ax) - hx, Math.abs(z - az) - hz));
  }
  for (const edge of edges) {
    const dx = x - edge.ax, dz = z - edge.az;
    const t = Math.max(0, Math.min(1, (dx * edge.dx + dz * edge.dz) * edge.inverseLength));
    d = Math.min(d, Math.hypot(dx - t * edge.dx, dz - t * edge.dz) - edge.width);
  }
  return d;
}

export function onVillagePaving(village: Village | undefined, x: number, z: number, margin = 0): boolean {
  return !!village && pavingDistance(x - village.x, z - village.z) < margin;
}

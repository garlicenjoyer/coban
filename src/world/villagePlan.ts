import type { Layout } from './mapTypes';

type Village = NonNullable<Layout['village']>;
type Point = readonly [x: number, z: number];

export const COFFEEHOUSE = [-4, 33, 4.8, 6.6, 4.3] as const;
export const MOSQUE = [-38.5, 9, 5, 5, 4.6] as const;
export const MINARET = { x: -43.5, z: 2.5, h: 16, r: 1.1 };
export const CAFE = { x: COFFEEHOUSE[0] - COFFEEHOUSE[2] - 1.3, z: COFFEEHOUSE[1], facing: -Math.PI / 2 };
export const CAFE_TABLES = [{ x: -2.52, z: 1.45 }, { x: 2.52, z: 1.45 }] as const;
export const LAUNDRY = { x: -27, z: 19.4, halfSpan: 2.5, height: 1.91 };

export function cafePoint(along: number, out: number): { x: number; z: number } {
  return { x: CAFE.x - out, z: CAFE.z + along };
}

/** House centres, half extents and eave heights, in metres. */
export const HOUSES = [
  [-26.5, -4, 4.4, 3.9, 4.5],
  [-27.6, 12, 3.9, 3.4, 5.0],
  [26.8, -6, 4.6, 3.7, 5.2],
  [27.8, 9, 4.0, 3.8, 4.4],
  [-12, -24, 4.2, 3.4, 5.1],
  [6, -26, 4.7, 3.8, 4.5],
  [24, -24, 3.8, 3.3, 5.2],
  [43, -12, 4.4, 3.8, 4.35],
  [44, 6, 3.8, 3.4, 5.0],
  [-4, -43, 4.3, 3.8, 5.2],
  [16, -44, 3.9, 3.5, 4.5],
  [36, -40, 4.3, 3.8, 5.3],
  [56, -28, 3.9, 3.9, 4.5],
  [60, -6, 4.3, 3.4, 5.1],
  [-30, -26, 3.8, 3.3, 4.4],
  [32, 27, 4.5, 3.5, 4.5],
] as const;

export const VILLAGE_BUILDINGS = [...HOUSES, COFFEEHOUSE, MOSQUE];
export const SQUARE_TREE = { x: -11, z: -7, radius: 0.50, height: 13 };
export const COURTYARD_TREES = [[-36, 18.6], [-23.8, -12.9], [-4.15, -22.6], [19.2, -29.1],
  [42.4, -2.8], [49.8, -27.5], [53.1, 3.5], [-7.2, 24.1], [-5, 41.5]].map(([x, z], i) => ({
  x, z, radius: 0.23, height: 5.3 + (i % 3) * 0.65,
}));
export const FOUNTAIN = { x: 5.7, z: -5.4, radius: 1.73, height: 0.80 };
export const MEMORIAL = { x: 0, z: 0, radius: 1.28, height: 2.95, facing: -Math.PI / 5 };
export const SQUARE_ENTRANCE = [-4, 5.6] as const;

/** The first point of each circuit is a sunny or sheltered spot for a nap. */
export const VILLAGE_CATS = [
  { coat: 'ginger', start: 0, yaw: -2.1, route: [
    [-11.3, 33.3], [-14.1, 33.05], [-15.5, 34.6], [-15.2, 38.0], [-12.6, 39.0], [-10.4, 37.6], [-10.4, 33.4],
  ] },
  { coat: 'calico', start: 4, yaw: -1.2, route: [
    [-11.8, -8.45], [-8.0, -9.0], [-4.6, -6.9], [-2.8, -2.7], [-3.5, 1.6], [-6.8, 3.4], [-10.0, 0.3],
    [-12.6, -3.2], [-12.4, -8.5],
  ] },
  { coat: 'grey', start: 0, yaw: 0.37, route: [
    [-24.0, 17.55], [-21.8, 17.2], [-18.9, 15.5], [-18.2, 12.9], [-19.8, 9.0], [-20.7, 11.0], [-22.3, 15.8],
  ] },
] as const;
export type CatCoat = typeof VILLAGE_CATS[number]['coat'];

const lanes: { width: number; course: Point[] }[] = [
  { width: 3.24, course: [[-30, 42], [-24, 34], [-17, 24], [-10, 14], [-5, 7], SQUARE_ENTRANCE] },
  { width: 2.2, course: [[-23, 33], [-17, 32.4], [-12.2, 32.4], [CAFE.x, CAFE.z]] },
  { width: 1.8, course: [[-21, 29.8], [-27, 25], [-32.6, 18], [-32.6, 9]] },
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
  [22.1, 9.0, 2.35, 3.31], [CAFE.x - 1.8, CAFE.z, 3.05, 5.95], [-32.6, 9, 2.25, 5.0],
  [-27, 18.5, 3.3, 1.9],
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

// The active map. Game systems read `layout` and the helpers here; main.ts picks the map
// (the valley, or the greybox test map with ?map=test) before the simulation is built.
// Tests use the test map, which stays the default so headless runs behave as before.

import type { Layout, MapDef, MapProps } from './mapTypes';
import type { Terrain } from './terrain';
import { TEST_MAP } from './testMap';
import { VALLEY_MAP } from './valley';

export const MAPS: Record<MapDef['id'], MapDef> = { test: TEST_MAP, valley: VALLEY_MAP };

let current: MapDef = TEST_MAP;

/** The active map's layout. The object stays the same; its fields are swapped by useMap. */
export const layout: Layout = { ...TEST_MAP.layout };

/** Make a map active. Call before building a Sim (and before any view reads the layout). */
export function useMap(def: MapDef): void {
  current = def;
  const l = layout as unknown as Record<string, unknown>;
  for (const k of Object.keys(l)) delete l[k];
  Object.assign(l, def.layout);
}

export function activeMap(): MapDef {
  return current;
}

export const buildTerrain = (): Terrain => current.buildTerrain();
export const buildProps = (t: Terrain): MapProps => current.buildProps(t);
export const roadDistance = (x: number, z: number): number => current.roadDistance(x, z);

export function insidePen(x: number, z: number, margin = 0): boolean {
  const p = layout.pen;
  return Math.abs(x - p.x) <= p.hx + margin && Math.abs(z - p.z) <= p.hz + margin;
}

/** The packed-dirt yard around the cottage (and its porch). */
export function inYard(x: number, z: number, margin = 0): boolean {
  const h = layout.house;
  return x > h.x - h.hx - 4 - margin && x < h.x + h.hx + 3 + margin && z > h.z - h.hz - h.porchDepth - 2.5 - margin && z < h.z + h.hz + 3 + margin;
}

export function insideFold(x: number, z: number, margin = 0): boolean {
  const f = layout.works.fold;
  return x > f.xMin + f.wall / 2 - margin && x < f.xMax + margin && z > f.zMin + f.wall / 2 - margin && z < f.zMax - f.wall / 2 + margin;
}

export type { BoxProp, CylProp, Layout, MapDef, MapProps, Prop, PropRole } from './mapTypes';

// Things the shepherd builds that stay (Death Stranding's lesson: progress you can see on
// the land). Building costs daylight: while you work, in-game time runs fast, and the flock
// is on its own. Headless; the sim applies what a finished structure does.
//
//   hut      by Pasture B: sleep there with the flock in its dry-stone fold (safe overnight).
//            In the valley it is Uncle Ahmet's fallen hut: building it means mending his.
//   cistern  at dry Pasture C: fill it with the bike's cans; it collects rain every night
//   cairn    a stack of stones anywhere: a waymark, on the land and on the paper map

import { config } from '../core/config';
import type { Terrain } from './terrain';
import { inYard, insidePen, layout, type BoxProp } from './map';

export type WorkKind = 'hut' | 'cistern';

export interface WorkSite {
  readonly id: WorkKind;
  readonly name: string;
  /** Where you stand to build it (the stakes and string). */
  readonly x: number;
  readonly z: number;
  /** In-game hours of work. */
  readonly hours: number;
  /** Mending something that stood before (Uncle Ahmet's hut), not building from stakes. */
  readonly repair: boolean;
  progress: number;
  built: boolean;
}

export interface Cairn {
  x: number;
  z: number;
}

export const SITE_REACH = 3.5;

export class Works {
  readonly sites: WorkSite[];
  readonly cairns: Cairn[] = [];
  /** Seconds spent stacking the next cairn. */
  cairnProgress = 0;

  constructor() {
    const f = layout.works.fold;
    const c = layout.works.cistern;
    const h = layout.works.hut;
    // His hut is mended from its doorway; a new one is staked out by the fold's mouth.
    const hut: WorkSite = h.ruined
      ? { id: 'hut', name: "the hillside hut", ...this.hutDoor, hours: 3, repair: true, progress: 0, built: false }
      : { id: 'hut', name: "the shepherd's hut", x: f.xMax + 1.5, z: (f.zMin + f.zMax) / 2, hours: 3, repair: false, progress: 0, built: false };
    this.sites = [hut, { id: 'cistern', name: 'the rain cistern', x: c.x + 2.6, z: c.z, hours: 1.5, repair: false, progress: 0, built: false }];
  }

  site(id: WorkKind): WorkSite {
    return this.sites.find((s) => s.id === id)!;
  }

  built(id: WorkKind): boolean {
    return this.site(id).built;
  }

  /** The unbuilt site within reach, if any. */
  siteNear(x: number, z: number): WorkSite | null {
    return this.sites.find((s) => !s.built && Math.hypot(s.x - x, s.z - z) < SITE_REACH) ?? null;
  }

  /** Where you'd sleep at the hut. */
  get hutDoor(): { x: number; z: number } {
    const h = layout.works.hut;
    return { x: h.x + h.hx + 0.9, z: h.z };
  }

  nearHutDoor(x: number, z: number): boolean {
    const d = this.hutDoor;
    return this.built('hut') && Math.hypot(x - d.x, z - d.z) < 2;
  }

  /** A cairn can go here: open ground, not crowding another, not at the homestead. */
  canStack(x: number, z: number, terrain: Terrain, blocked: (x: number, z: number, r: number) => boolean): boolean {
    return (
      this.cairns.length < config.works.maxCairns &&
      !insidePen(x, z, 3) &&
      !inYard(x, z, 2) &&
      terrain.slopeDegAt(x, z) < 25 &&
      !blocked(x, z, 0.6) &&
      this.cairns.every((c) => Math.hypot(c.x - x, c.z - z) > 6)
    );
  }

  /** Colliders a finished structure adds to the world. */
  propsFor(id: WorkKind, terrain: Terrain): BoxProp[] {
    if (id !== 'hut') return [];
    const h = layout.works.hut;
    const f = layout.works.fold;
    const hy = terrain.heightAt(h.x, h.z);
    const props: BoxProp[] = [{ kind: 'box', role: 'house', x: h.x, y: hy + h.wallHeight / 2, z: h.z, hx: h.hx, hy: h.wallHeight / 2, hz: h.hz }];
    // Fold: dry-stone walls on the north, west and south; open to the east.
    const wall = (ax: number, az: number, bx: number, bz: number) => {
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      props.push({
        kind: 'box',
        role: 'wall',
        x: mx,
        y: terrain.heightAt(mx, mz) + f.wall / 2 - 0.1,
        z: mz,
        hx: Math.max(0.28, Math.abs(bx - ax) / 2),
        hy: f.wall / 2,
        hz: Math.max(0.28, Math.abs(bz - az) / 2),
      });
    };
    for (let x = f.xMin; x < f.xMax - 0.1; x += 6) {
      wall(x, f.zMin, Math.min(f.xMax, x + 6), f.zMin);
      wall(x, f.zMax, Math.min(f.xMax, x + 6), f.zMax);
    }
    wall(f.xMin, f.zMin, f.xMin, f.zMax);
    return props;
  }

  stateKey(): number[] {
    return [...this.sites.flatMap((s) => [s.progress, s.built ? 1 : 0]), ...this.cairns.flatMap((c) => [c.x, c.z])];
  }
}

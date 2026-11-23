import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPhysicsWorld } from '../src/world/physics';
import { Surface } from '../src/world/terrain';
import { buildProps, buildTerrain, layout } from '../src/world/testMap';

const terrain = buildTerrain();
const map = buildProps(terrain);

beforeAll(async () => {
  await RAPIER.init();
});

describe('test map terrain', () => {
  it('Rapier heightfield matches Terrain.heightAt (render and physics agree)', () => {
    const { world, terrainCollider } = createPhysicsWorld(RAPIER, terrain, map);
    let maxErr = 0;
    let n = 0;
    for (let i = 0; i < 400; i++) {
      // Deterministic pseudo-random points inside the playable area.
      const x = ((i * 7919) % 340) - 170 + 0.37;
      const z = ((i * 104729) % 340) - 170 + 0.61;
      const ray = new RAPIER.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 });
      const hit = terrainCollider.castRay(ray, 400, true);
      if (hit === null) continue;
      const hy = 200 - hit;
      maxErr = Math.max(maxErr, Math.abs(hy - terrain.heightAt(x, z)));
      n++;
    }
    world.free();
    expect(n).toBeGreaterThan(390);
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('hill flank is about 25°, cliff face about 35°', () => {
    const hl = layout.hill;
    const r = hl.plateau + hl.flank / 2;
    const hill = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
      const a = (k / 8) * Math.PI * 2;
      return terrain.slopeDegAt(hl.x + Math.cos(a) * r, hl.z + Math.sin(a) * r);
    });
    const avgHill = hill.reduce((s, v) => s + v, 0) / hill.length;
    expect(avgHill).toBeGreaterThan(21);
    expect(avgHill).toBeLessThan(29);

    const c = layout.cliff;
    const cliff = terrain.slopeDegAt(-100, c.zFoot - c.run / 2);
    expect(cliff).toBeGreaterThan(31);
    expect(cliff).toBeLessThan(40);
  });

  it('pastures sit at roughly 100, 250 and 350 m from the pen gate', () => {
    const d = map.pastureDistances;
    expect(Math.abs(d.A - 100)).toBeLessThan(15);
    expect(Math.abs(d.B - 250)).toBeLessThan(25);
    expect(Math.abs(d.C - 350)).toBeLessThan(25);
  });

  it('paints every surface type somewhere', () => {
    const seen = new Set(terrain.surfaces);
    for (const s of [Surface.Grass, Surface.Dirt, Surface.Gravel, Surface.Mud, Surface.Rock, Surface.Pasture]) {
      expect(seen.has(s)).toBe(true);
    }
    expect(terrain.surfaceAt(layout.mud.x, layout.mud.z)).toBe(Surface.Mud);
    expect(terrain.surfaceAt(layout.pen.x, layout.pen.z)).toBe(Surface.Dirt);
  });

  it('places thorn bushes and forest trees', () => {
    expect(map.props.filter((p) => p.role === 'thorn').length).toBeGreaterThan(40);
    expect(map.props.filter((p) => p.role === 'trunk').length).toBeGreaterThan(30);
  });
});

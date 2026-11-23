// Grazing feeds the flock (free days' "Graze the flock where the grass is good"): on a fresh
// pasture a starving flock is fed within a morning; on grass already eaten down it isn't,
// which is what makes resting pastures matter.

import RAPIER from '@dimforge/rapier3d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyFrame } from '../src/core/input';
import { Sim } from '../src/sim';
import { layout, useMap } from '../src/world/map';
import { TEST_MAP } from '../src/world/testMap';
import { VALLEY_MAP } from '../src/world/valley';
import { initRapier, placeFlock } from './helpers';

const terrain = VALLEY_MAP.buildTerrain();
const HOUR = 60 * 60; // ticks: 1 in-game hour = 60 s at 60 Hz

beforeAll(async () => {
  await initRapier();
  useMap(VALLEY_MAP);
});
afterAll(() => useMap(TEST_MAP));

function graze(hours: number, thin: boolean) {
  const sim = new Sim(RAPIER, terrain);
  sim.tasks.enabled = false;
  const P = layout.pastures[0];
  if (thin) for (let k = 0; k < sim.grass.value.length; k++) sim.grass.value[k] = Math.min(sim.grass.value[k], 0.25);
  placeFlock(sim, P.x, P.z);
  for (const s of sim.flock.sheep) {
    s.hunger = 99;
    s.thirst = 0;
  }
  const before = sim.grass.meanIn(P.x, P.z, P.r);
  for (let i = 0; i < hours * HOUR; i++) sim.step(emptyFrame());
  const hunger = sim.flock.sheep.reduce((a, s) => a + s.hunger, 0) / sim.flock.sheep.length;
  return { hunger, eaten: before - sim.grass.meanIn(P.x, P.z, P.r) };
}

describe('grazing', () => {
  it('feeds a starving flock (99 → under 25) within 5 hours on fresh Pasture A', () => {
    const r = graze(5, false);
    console.log(`[grazing fresh] hunger ${r.hunger.toFixed(1)}, pasture mean down ${r.eaten.toFixed(2)}`);
    expect(r.hunger).toBeLessThan(25);
    // It shows on the pasture, but one morning doesn't ruin it.
    expect(r.eaten).toBeGreaterThan(0.03);
    expect(r.eaten).toBeLessThan(0.3);
  });

  it('barely feeds them on grass already eaten down', () => {
    const r = graze(3, true);
    console.log(`[grazing thin] hunger ${r.hunger.toFixed(1)}`);
    expect(r.hunger).toBeGreaterThan(80);
  });
});

// The debug scenarios on the valley (GDD feature 4: "the debug scenarios checked on the
// valley"). Each runs through the same Scenarios class the debug panel's buttons use, then
// gives Karabaş the command a tester would, and checks the M3 acceptance numbers.

import RAPIER from '@dimforge/rapier3d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { emptyFrame } from '../src/core/input';
import { Scenarios } from '../src/debug/scenarios';
import { Trial } from '../src/debug/trial';
import { Sim } from '../src/sim';
import { useMap } from '../src/world/map';
import { TEST_MAP } from '../src/world/testMap';
import { VALLEY_MAP, valleyLayout as L } from '../src/world/valley';
import { initRapier, yawToward } from './helpers';

const terrain = VALLEY_MAP.buildTerrain();
const S = VALLEY_MAP.scenario;

beforeAll(async () => {
  await initRapier();
  useMap(VALLEY_MAP);
});
afterAll(() => useMap(TEST_MAP));

function setup() {
  const sim = new Sim(RAPIER, terrain);
  return { sim, sc: new Scenarios(sim) };
}

function step(sim: Sim, sc: Scenarios, frames: number, make = () => emptyFrame()) {
  for (let i = 0; i < frames; i++) {
    sim.step(make());
    sc.afterStep(1 / 60);
  }
}

describe('debug scenarios on the valley', () => {
  it.each([5, 11, 23, 42, 77, 101])('Gather: 90%% of the scattered flock with you within 30 s (seed %i)', (seed) => {
    const { sim, sc } = setup();
    sc.gather(seed);
    const P = { ...sim.player.pos };
    sim.giveCommand('gather', yawToward(P.x, P.z, S.meadow.x, S.meadow.z));
    let t = 0;
    while (t < 30 && !sc.status.includes('PASS')) {
      step(sim, sc, 1);
      t += 1 / 60;
    }
    console.log(`[valley gather ${seed}] ${sc.status}`);
    expect(sc.status).toMatch(/PASS/);
  });

  it('Hold: the flock stays within 20 m for 3 minutes while you walk 100 m away', () => {
    const { sim, sc } = setup();
    sc.holdTest();
    sim.giveCommand('hold', 0);
    step(sim, sc, 180);
    const yaw = yawToward(0, 0, 1, 0);
    const x0 = sim.player.pos.x;
    step(sim, sc, 180 * 60, () => ({ ...emptyFrame(yaw), moveY: sim.player.pos.x - x0 < 100 ? 1 : 0 }));
    console.log(`[valley hold] ${sc.status}`);
    expect(sim.player.pos.x - x0).toBeGreaterThan(95);
    const worst = Number(/worst (\d+)%/.exec(sc.status)![1]);
    expect(worst).toBeGreaterThanOrEqual(Math.floor((23 / 24) * 100));
    expect(sim.flock.strayEvents).toBe(0);
  });

  it('Search: Karabaş finds the sheep lost by the dere within 60 s', () => {
    const { sim, sc } = setup();
    sc.search();
    expect(sc.status).toContain('the dere');
    sim.giveCommand('search', yawToward(S.lostFlock.x, S.lostFlock.z, S.lost.x, S.lost.z));
    let t = 0;
    while (t < 60 && sim.dog.searchFoundAt < 0) {
      step(sim, sc, 1);
      t += 1 / 60;
    }
    console.log(`[valley search] ${sc.status}`);
    expect(sc.status).toMatch(/PASS/);
  });

  it("Wolf: it comes from the den's side, and Karabaş meets it with no bites", () => {
    const { sim, sc } = setup();
    sc.holdTest();
    sc.wolf();
    const w = sim.wolves.list[0];
    const c = sim.flock.centroid;
    // Between the flock and the den, 70 m out.
    expect(Math.hypot(w.x - c.x, w.z - c.z)).toBeCloseTo(70, 0);
    expect(Math.hypot(w.x - L.wolfDen.x, w.z - L.wolfDen.z)).toBeLessThan(Math.hypot(c.x - L.wolfDen.x, c.z - L.wolfDen.z));
    const states = new Set<string>();
    for (let i = 0; i < 90 * 60 && sim.wolves.list.length; i++) {
      step(sim, sc, 1);
      states.add(sim.dog.state);
    }
    console.log(`[valley wolf] ${sc.status}`);
    expect(sim.wolves.bites).toBe(0);
    expect(states.has('charge')).toBe(true);
    expect(sim.wolves.list.length).toBe(0);
  });

  it('the herding trial goes to Pasture D and keeps the 8-minute target', () => {
    const sim = new Sim(RAPIER, terrain);
    const trial = new Trial(sim);
    expect(trial.pasture.id).toBe('D');
    expect(trial.targetSeconds).toBe(config.time.secondsPerHour * 8);
    trial.start();
    expect(trial.status).toContain('Pasture D');
  });
});

describe('frame-rate check', () => {
  it('tours seven spots in the valley, each where the shepherd can stand', async () => {
    const { benchSpots } = await import('../src/debug/bench');
    const sim = new Sim(RAPIER, terrain);
    const spots = benchSpots();
    expect(spots.map((s) => s.name)).toEqual(['ağıl and flock', 'cottage yard', 'lookout over the valley', 'pasture A', 'forest edge', 'the ruins', 'village square']);
    for (const s of spots) {
      expect(sim.obstacles.blocked(s.x, s.z, 0.4), s.name).toBe(false);
      expect(Math.abs(s.x) < L.bounds.walk && Math.abs(s.z) < L.bounds.walk, s.name).toBe(true);
    }
  });
});

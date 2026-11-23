// The valley (GDD Part V, feature 4): the real map. Checks that its layout keeps the
// promises the design makes (pastures in rings by walking time, a ~1 km road to the
// village, rideable grades, clear ground where the game needs it) and that the game's
// systems run on it: the flock can be led out to the near and the far pasture in the
// daylight the clock allows.

import RAPIER from '@dimforge/rapier3d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config, SIM_DT } from '../src/core/config';
import { emptyFrame, type InputFrame } from '../src/core/input';
import { Sim } from '../src/sim';
import { day2Plan } from '../src/tasks/day2';
import { layout, useMap } from '../src/world/map';
import type { V2 } from '../src/world/mapTypes';
import { Obstacles } from '../src/world/obstacles';
import { createPhysicsWorld } from '../src/world/physics';
import { Surface } from '../src/world/terrain';
import { TEST_MAP } from '../src/world/testMap';
import { dereDistance, hillRoadDistance, mainRoadDistance, VALLEY_MAP, valleyLayout as L } from '../src/world/valley';
import { initRapier, yawToward } from './helpers';

const terrain = VALLEY_MAP.buildTerrain();
const map = VALLEY_MAP.buildProps(terrain);
const obstacles = new Obstacles(map);
const gate = { x: L.pen.x + L.pen.hx, z: L.pen.z };
const fromGate = (p: V2) => Math.hypot(p.x - gate.x, p.z - gate.z);
const TRACE = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TRACE;
const pasture = (id: string) => L.pastures.find((p) => p.id === id)!;

beforeAll(async () => {
  await initRapier();
  useMap(VALLEY_MAP);
});
afterAll(() => useMap(TEST_MAP));

describe('valley layout', () => {
  it('pastures sit in rings by walking distance from the gate', () => {
    expect(fromGate(pasture('A'))).toBeLessThan(150);
    for (const id of ['C', 'D']) {
      expect(fromGate(pasture(id))).toBeGreaterThan(150);
      expect(fromGate(pasture(id))).toBeLessThan(350);
    }
    for (const id of ['B', 'E']) {
      expect(fromGate(pasture(id))).toBeGreaterThan(350);
      expect(fromGate(pasture(id))).toBeLessThan(600);
    }
    // The village is bike country: about a kilometre away.
    expect(fromGate(L.village)).toBeGreaterThan(900);
  });

  it('Rapier heightfield matches Terrain.heightAt across the valley', () => {
    const { world, terrainCollider } = createPhysicsWorld(RAPIER, terrain, map);
    let maxErr = 0;
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const x = ((i * 7919) % 1080) - 540 + 0.37;
      const z = ((i * 104729) % 1080) - 540 + 0.61;
      const hit = terrainCollider.castRay(new RAPIER.Ray({ x, y: 300, z }, { x: 0, y: -1, z: 0 }), 600, true);
      if (hit === null) continue;
      maxErr = Math.max(maxErr, Math.abs(300 - hit - terrain.heightAt(x, z)));
      n++;
    }
    world.free();
    expect(n).toBeGreaterThan(390);
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('the gravel road to the village and the dirt road to the lookout are rideable', () => {
    const grade = (dist: (x: number, z: number) => number, half: number) => {
      // Walk every 2 m cell on the road and take the steepest slope along it.
      let worst = 0;
      for (let ix = 0; ix < terrain.N; ix++)
        for (let iz = 0; iz < terrain.N; iz++) {
          const x = terrain.xOf(ix);
          const z = terrain.zOf(iz);
          if (dist(x, z) < half - 1) worst = Math.max(worst, terrain.slopeDegAt(x, z));
        }
      return worst;
    };
    // Gravel: the bike can't climb 25° on gravel, so the main road stays gentle.
    expect(grade(mainRoadDistance, 3)).toBeLessThan(14);
    expect(grade(hillRoadDistance, 2.6)).toBeLessThan(27);
    expect(terrain.surfaceAt(200, 50)).not.toBe(Surface.Rock);
    // The roads carry their surfaces.
    expect(terrain.surfaceAt(-120, 228)).toBe(Surface.Gravel);
    expect(terrain.surfaceAt(105, 30)).toBe(Surface.Dirt);
  });

  it('the lookout stands above everything it overlooks', () => {
    const top = terrain.heightAt(L.hill.x, L.hill.z);
    for (const p of [...L.pastures, L.pen, L.ruins]) expect(top).toBeGreaterThan(terrain.heightAt(p.x, p.z) + 15);
    expect(top).toBeGreaterThan(terrain.heightAt(L.village.x, L.village.z));
  });

  it('pastures are gentle, open grazing and every spring can be reached', () => {
    for (const p of L.pastures) {
      expect(terrain.surfaceAt(p.x, p.z)).toBe(Surface.Pasture);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        expect(terrain.slopeDegAt(p.x + Math.cos(a) * p.r * 0.7, p.z + Math.sin(a) * p.r * 0.7)).toBeLessThan(14);
      }
      const solid = map.props.filter((q) => q.role !== 'marker' && Math.hypot(q.x - p.x, q.z - p.z) < p.r);
      expect(solid).toEqual([]);
    }
    for (const s of L.springs) expect(obstacles.blocked(s.x, s.z, s.radius + 1)).toBe(false);
  });

  it('nothing solid stands on the roads, at the works sites or in the dere', () => {
    for (const p of map.props) {
      if (p.role === 'marker' || p.role === 'building' || p.role === 'minaret') continue;
      const r = p.kind === 'cyl' ? p.radius : Math.max(p.hx, p.hz);
      if (p.role !== 'fence' && p.role !== 'gate' && p.role !== 'trough') {
        expect(mainRoadDistance(p.x, p.z) - r, `${p.role} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBeGreaterThan(3.5);
      }
      expect(hillRoadDistance(p.x, p.z) - r).toBeGreaterThan(3);
      expect(dereDistance(p.x, p.z) - r).toBeGreaterThan(8);
    }
    const f = L.works.fold;
    expect(obstacles.blocked((f.xMin + f.xMax) / 2, (f.zMin + f.zMax) / 2, 6)).toBe(false);
    // At the hut, only Uncle Ahmet's fallen walls stand.
    const h = L.works.hut;
    const nearHut = map.props.filter((p) => p.role !== 'marker' && Math.abs(p.x - h.x) < h.hx + 3 && Math.abs(p.z - h.z) < h.hz + 3);
    expect(nearHut.length).toBeGreaterThan(0);
    expect(nearHut.every((p) => p.role === 'hutRuin')).toBe(true);
    expect(obstacles.blocked(L.works.cistern.x, L.works.cistern.z, 3)).toBe(false);
  });

  it("the hut by Pasture B is Uncle Ahmet's, fallen: knee-to-chest walls with an open doorway", () => {
    const h = L.works.hut;
    expect(h.ruined).toBe(true);
    const walls = map.props.filter((p) => p.role === 'hutRuin');
    expect(walls.length).toBeGreaterThanOrEqual(4);
    for (const w of walls) {
      expect(w.kind).toBe('box');
      if (w.kind === 'box') expect(w.hy * 2).toBeLessThan(h.wallHeight * 0.7);
    }
    // The doorway (east) and the inside are open.
    expect(obstacles.blocked(h.x + h.hx, h.z, 0.3)).toBe(false);
    expect(obstacles.blocked(h.x, h.z, 1)).toBe(false);
  });

  it("Uncle Ahmet's cairns mark his routes, and the village has its houses and minaret", () => {
    expect(map.props.filter((p) => p.role === 'cairn').length).toBeGreaterThanOrEqual(10);
    expect(map.props.filter((p) => p.role === 'building').length).toBeGreaterThanOrEqual(15);
    expect(map.props.filter((p) => p.role === 'minaret').length).toBe(1);
  });
});

/** Lead the flock by calling and walking a route; wait whenever it falls behind. */
function leadTo(sim: Sim, route: V2[], target: V2 & { r: number }, maxHours: number): { hours: number; arrived: number } {
  const N = sim.flock.sheep.length;
  const GATE_OUT = { x: gate.x + 1.6, z: gate.z };
  let wp = 0;
  let callTimer = 0;
  const startHour = sim.hour;
  const frame = (): InputFrame => {
    const p = sim.player.pos;
    if (!sim.gateOpen) {
      if (Math.hypot(p.x - GATE_OUT.x, p.z - GATE_OUT.z) > 1) {
        const f = emptyFrame(yawToward(p.x, p.z, GATE_OUT.x, GATE_OUT.z));
        f.moveY = 1;
        return f;
      }
      return { ...emptyFrame(), interact: true };
    }
    const goal = route[Math.min(wp, route.length - 1)];
    if (wp < route.length - 1 && Math.hypot(goal.x - p.x, goal.z - p.z) < 4) wp++;
    const c = sim.flock.centroid;
    const f = emptyFrame(yawToward(p.x, p.z, goal.x, goal.z));
    if (Math.hypot(c.x - p.x, c.z - p.z) < 16 && Math.hypot(goal.x - p.x, goal.z - p.z) > 1) f.moveY = 1;
    callTimer -= SIM_DT;
    if (callTimer <= 0) {
      f.call = true;
      callTimer = 3;
    }
    return f;
  };
  const arrived = () => sim.flock.sheep.filter((s) => Math.hypot(s.x - target.x, s.z - target.z) < target.r + 8).length;
  let k = 0;
  while (sim.hour - startHour < maxHours && arrived() < Math.ceil(N * 0.85)) {
    sim.step(frame());
    if (TRACE && ++k % 1800 === 0) {
      const p = sim.player.pos;
      const c = sim.flock.centroid;
      console.log(`t=${(k / 60).toFixed(0)}s gate=${sim.gateOpen} p=${p.x.toFixed(0)},${p.z.toFixed(0)} c=${c.x.toFixed(0)},${c.z.toFixed(0)} inPen=${sim.flock.inPen} strays=${sim.flock.strays} wp=${wp}`);
    }
  }
  return { hours: sim.hour - startHour, arrived: arrived() };
}

describe('the flock in the valley', () => {
  const newValleySim = () => {
    const sim = new Sim(RAPIER, terrain);
    sim.tasks.enabled = false;
    return sim;
  };

  it('starts penned at the homestead', () => {
    const sim = newValleySim();
    expect(sim.sheepInPen).toBe(sim.flock.sheep.length);
    expect(layout.pen.x).toBe(L.pen.x);
    expect(sim.player.pos.x).toBeCloseTo(L.spawn.x, 0);
  });

  it('leading the flock to near Pasture A takes about an hour and a half', () => {
    const sim = newValleySim();
    const A = pasture('A');
    const r = leadTo(sim, [{ x: gate.x + 12, z: gate.z - 4 }, { x: A.x, z: A.z }], A, 4);
    console.log(`[valley] to Pasture A (${Math.round(fromGate(A))} m): ${r.hours.toFixed(2)} in-game h, ${r.arrived} sheep`);
    expect(r.arrived).toBeGreaterThanOrEqual(Math.ceil(sim.flock.sheep.length * 0.85));
    expect(r.hours).toBeLessThan(3);
  });

  it("the far pasture B along Uncle Ahmet's cairns takes most of a morning", () => {
    const sim = newValleySim();
    const B = pasture('B');
    const route = [{ x: gate.x + 12, z: gate.z - 4 }, { x: -250, z: 205 }, { x: -150, z: 125 }, { x: -82, z: 80 }, { x: B.x, z: B.z }];
    const r = leadTo(sim, route, B, 11);
    console.log(`[valley] to Pasture B (${Math.round(fromGate(B))} m): ${r.hours.toFixed(2)} in-game h, ${r.arrived} sheep`);
    expect(r.arrived).toBeGreaterThanOrEqual(Math.ceil(sim.flock.sheep.length * 0.85));
    // Far enough to cost a real share of the day, near enough to build and fold before dark:
    // Day 4 starts at 06:30; sunset is at 19:00 and the hut takes three hours.
    expect(r.hours).toBeGreaterThan(3);
    expect(r.hours + 3).toBeLessThan(19 - config.time.startHour);
  });

  it("mending Uncle Ahmet's hut from its doorway takes three hours and leaves a hut and fold to sleep in", () => {
    const sim = newValleySim();
    const site = sim.works.site('hut');
    expect(site.repair).toBe(true);
    expect(site.name).toBe("Uncle Ahmet's hut");
    sim.teleport(site.x, site.z);
    const h0 = sim.hour;
    const built: { id: string; repair?: boolean }[] = [];
    sim.events.on('built', (e) => built.push(e));
    let frames = 0;
    while (!site.built && frames < 60 * 60) {
      sim.step({ ...emptyFrame(), interactHeld: true });
      frames++;
    }
    expect(built).toEqual([expect.objectContaining({ id: 'hut', repair: true })]);
    expect(sim.hour - h0).toBeGreaterThan(2.9);
    const h = L.works.hut;
    expect(sim.obstacles.blocked(h.x, h.z, 0.3)).toBe(true);
    expect(sim.obstacles.blocked(L.works.fold.xMin, (L.works.fold.zMin + L.works.fold.zMax) / 2, 0.3)).toBe(true);
    expect(sim.works.nearHutDoor(site.x, site.z)).toBe(true);
  });

  it("the herding trial's Pasture D is out and back within the GDD's 8 minutes", () => {
    const sim = newValleySim();
    expect(VALLEY_MAP.scenario.trialPasture).toBe('D');
    const D = pasture('D');
    const route = [{ x: gate.x + 12, z: gate.z - 4 }, { x: -362, z: 262 }, { x: -398, z: 190 }, { x: -404, z: 90 }, { x: D.x, z: D.z }];
    const r = leadTo(sim, route, D, 8);
    console.log(`[valley] trial pasture D (${Math.round(fromGate(D))} m): ${r.hours.toFixed(2)} in-game h, ${r.arrived} sheep`);
    expect(r.arrived).toBeGreaterThanOrEqual(Math.ceil(sim.flock.sheep.length * 0.85));
    // One in-game hour is a real minute: the way out must leave time to come home.
    expect(r.hours * config.time.secondsPerHour).toBeLessThan(VALLEY_MAP.scenario.trialSeconds / 2);
  });

  it('Day 2 in the valley rides to the village instead of lapping a loop', () => {
    const ids = day2Plan().map((t) => t.id);
    expect(ids).toContain('toVillage');
    expect(ids).not.toContain('lap');
  });
});

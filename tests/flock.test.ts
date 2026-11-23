import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { emptyFrame } from '../src/core/input';
import { Flock } from '../src/flock/flock';
import { Personality } from '../src/flock/sheep';
import { EventBus } from '../src/core/events';
import { GrassMap } from '../src/world/grassMap';
import { Obstacles } from '../src/world/obstacles';
import { buildProps, layout } from '../src/world/testMap';
import {
  centroid,
  initRapier,
  minPairDistance,
  newSim,
  placeFlock,
  run,
  spread,
  terrain,
  yawToward,
} from './helpers';

beforeAll(initRapier);

// Open, gentle ground between pasture A and the gravel loop.
const FIELD = { x: -20, z: 98 };

describe('flock basics', () => {
  it('starts in the pen with one bellwether and mixed personalities', () => {
    const sim = newSim();
    const f = sim.flock;
    expect(f.sheep.length).toBe(config.flock.count);
    expect(f.inPen).toBe(config.flock.count);
    expect(f.sheep.filter((s) => s.personality === Personality.Bellwether).length).toBe(1);
    for (const p of [Personality.Wanderer, Personality.Timid, Personality.Greedy, Personality.Steady])
      expect(f.sheep.some((s) => s.personality === p)).toBe(true);
  });

  it('stays in the closed pen without overlapping', () => {
    const sim = newSim();
    sim.teleport(-110, 120); // shepherd well away
    run(sim, 60 * 60);
    expect(sim.flock.inPen).toBe(config.flock.count);
    expect(minPairDistance(sim)).toBeGreaterThan(0.6);
  });

  it('mostly stays home with the gate open and nobody around', () => {
    const sim = newSim();
    sim.setGate(true);
    sim.teleport(-110, 120);
    run(sim, 60 * 60);
    expect(sim.flock.inPen).toBeGreaterThanOrEqual(config.flock.count - 2);
  });

  it('grazes as a loose group without drifting apart', () => {
    const sim = newSim();
    placeFlock(sim, FIELD.x, FIELD.z);
    sim.teleport(FIELD.x + 40, FIELD.z);
    run(sim, 60 * 90);
    expect(spread(sim)).toBeLessThan(18);
    expect(sim.flock.strays).toBe(0);
    expect(minPairDistance(sim)).toBeGreaterThan(0.6);
  });
});

describe('herding verbs', () => {
  it('walking up behind the flock drives it forward as a body', () => {
    const sim = newSim();
    placeFlock(sim, FIELD.x, FIELD.z);
    sim.teleport(FIELD.x, FIELD.z + 9); // south of the flock
    const c0 = centroid(sim);
    const yaw = yawToward(0, 0, 0, -1); // walk north
    run(sim, 60 * 20, () => ({ ...emptyFrame(yaw), moveY: 1 }));
    const c1 = centroid(sim);
    expect(c0.z - c1.z).toBeGreaterThan(12); // moved north
    expect(Math.abs(c1.x - c0.x)).toBeLessThan(8); // not sideways
    expect(spread(sim)).toBeLessThan(16);
  });

  it('calling and walking away leads the flock after the shepherd', () => {
    const sim = newSim();
    placeFlock(sim, FIELD.x, FIELD.z);
    sim.teleport(FIELD.x, FIELD.z - 8); // north of the flock
    const c0 = centroid(sim);
    const yaw = yawToward(0, 0, 0, -1);
    run(sim, 60 * 40, (i) => ({ ...emptyFrame(yaw), moveY: 1, call: i % 180 === 0 }));
    const c1 = centroid(sim);
    expect(c0.z - c1.z).toBeGreaterThan(30);
    const L = sim.flock.leader;
    expect(Math.hypot(L.x - sim.player.pos.x, L.z - sim.player.pos.z)).toBeLessThan(12);
    expect(sim.flock.strays).toBe(0);
  });

  it('a crook swing sends the sheep in the cone running along the swing', () => {
    const sim = newSim();
    placeFlock(sim, FIELD.x, FIELD.z, 1.6);
    sim.teleport(FIELD.x, FIELD.z + 7);
    run(sim, 30);
    const yaw = yawToward(0, 0, 0, -1);
    sim.step({ ...emptyFrame(yaw), crook: true });
    const hit = sim.flock.sheep.filter((s) => s.fleeTimer > 0);
    expect(hit.length).toBeGreaterThan(0);
    const z0 = hit.map((s) => s.z);
    run(sim, 60);
    hit.forEach((s, i) => expect(s.z).toBeLessThan(z0[i])); // all moved north, away from the swing
  });
});

describe('strays, stuck sheep and freeing', () => {
  it('a sheep left far from the flock for 30 s becomes a stray, and rejoins', () => {
    const sim = newSim();
    placeFlock(sim, FIELD.x, FIELD.z);
    sim.teleport(FIELD.x + 60, FIELD.z);
    const s = sim.flock.sheep.find((x) => !x.isLeader)!;
    s.x = s.px = FIELD.x - 50;
    s.z = s.pz = FIELD.z + 40;
    run(sim, 60 * 35);
    expect(s.isStray).toBe(true);
    expect(sim.flock.strayEvents).toBe(1);
    expect(sim.flock.strays).toBe(1);
    // Brought back next to the flock, it rejoins.
    s.x = s.px = sim.flock.centroid.x + 3;
    s.z = s.pz = sim.flock.centroid.z;
    run(sim, 60 * 3);
    expect(s.isStray).toBe(false);
  });

  it('holding interact next to a sheep caught in thorns frees it after 2 s', () => {
    const sim = newSim();
    placeFlock(sim, FIELD.x, FIELD.z);
    const bush = sim.obstacles.byRole('thorn')[0];
    if (bush.kind !== 'circle') throw new Error('thorns are circles');
    const s = sim.flock.sheep[3];
    s.x = s.px = bush.x + bush.r + config.flock.radius - 0.05;
    s.z = s.pz = bush.z;
    s.stuck = 'thorn';
    sim.teleport(bush.x + bush.r + 1.6, bush.z);
    run(sim, 60, () => ({ ...emptyFrame(), interactHeld: true }));
    expect(s.stuck).toBe('thorn'); // 1 s is not enough
    run(sim, 75, () => ({ ...emptyFrame(), interactHeld: true }));
    expect(s.stuck).toBe('none');
  });

  it('releasing interact early resets the freeing progress', () => {
    const sim = newSim();
    const s = sim.flock.sheep[2];
    s.stuck = 'thorn';
    s.inPen = false;
    sim.setGate(false);
    sim.teleport(s.x + 1.2, s.z);
    run(sim, 90, () => ({ ...emptyFrame(), interactHeld: true }));
    run(sim, 2);
    run(sim, 90, () => ({ ...emptyFrame(), interactHeld: true }));
    expect(s.stuck).toBe('thorn');
  });

  it('a sheep trying to climb the 45° ravine wall gets stuck, and can be lifted out', () => {
    const sim = newSim();
    const rv = layout.ravine;
    const mid = { x: (rv.a.x + rv.b.x) / 2, z: (rv.a.z + rv.b.z) / 2 };
    // Perpendicular to the ravine, pointing at the north-east rim.
    const ax = rv.b.x - rv.a.x;
    const az = rv.b.z - rv.a.z;
    const len = Math.hypot(ax, az);
    const nx = az / len;
    const nz = -ax / len;
    placeFlock(sim, mid.x + nx * 25, mid.z + nz * 25); // flock up on the rim
    const s = sim.flock.sheep.find((x) => !x.isLeader)!;
    s.x = s.px = mid.x;
    s.z = s.pz = mid.z;
    const rimX = mid.x + nx * 12;
    const rimZ = mid.z + nz * 12;
    sim.teleport(rimX, rimZ);
    // Keep calling from the rim so the sheep wants to come up.
    run(sim, 60 * 20, (i) => ({ ...emptyFrame(), call: i % 120 === 0 }));
    expect(s.stuck).toBe('slope');
    // Walk down to the sheep and lift it out.
    sim.teleport(rimX - nx * 4, rimZ - nz * 4);
    const d = Math.hypot(s.x - sim.player.pos.x, s.z - sim.player.pos.z);
    if (d > config.flock.stuck.freeReach) sim.teleport(s.x + nx * 1.2, s.z + nz * 1.2);
    run(sim, 150, () => ({ ...emptyFrame(), interactHeld: true }));
    expect(s.stuck).toBe('none');
  });
});

describe('grass', () => {
  it('grazing eats a pasture down and it regrows with rest', () => {
    const sim = newSim();
    const A = layout.pastures[0];
    const before = sim.grass.meanIn(A.x, A.z, A.r);
    placeFlock(sim, A.x, A.z);
    sim.teleport(A.x + 45, A.z);
    run(sim, 60 * 60 * 4); // 4 real minutes = 4 in-game hours
    const grazed = sim.grass.meanIn(A.x, A.z, A.r);
    expect(grazed).toBeLessThan(before - 0.03);
    sim.grass.grow(48);
    expect(sim.grass.meanIn(A.x, A.z, A.r)).toBeGreaterThan(grazed + 0.01);
  });

  it('a bare cell is a scar that only re-seeds slowly', () => {
    const g = new GrassMap(terrain);
    const A = layout.pastures[0];
    g.eat(A.x, A.z, 1);
    expect(g.at(A.x, A.z)).toBe(0);
    g.grow(24);
    expect(g.at(A.x, A.z)).toBeLessThan(0.01);
    g.grow(24 * 7);
    expect(g.at(A.x, A.z)).toBeGreaterThan(0.04);
  });
});

describe('performance', () => {
  it('30 sheep cost well under 2 ms per step', () => {
    const map = buildProps(terrain);
    const flock = new Flock(terrain, new GrassMap(terrain), new Obstacles(map), new EventBus(), 30);
    const ctx = (tick: number) => ({
      player: { x: -120, z: 140, vx: 0, vz: 0, gait: 'walk' as const },
      frame: emptyFrame(),
      tick,
      dt: 1 / 60,
      hours: 1 / 3600,
      interactUsedByGate: false,
    });
    for (let i = 0; i < 120; i++) flock.step(ctx(i)); // warm up
    const t0 = performance.now();
    const N = 600;
    for (let i = 0; i < N; i++) flock.step(ctx(120 + i));
    const ms = (performance.now() - t0) / N;
    expect(ms).toBeLessThan(2);
  });
});

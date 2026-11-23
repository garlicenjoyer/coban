import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { config, SIM_DT } from '../src/core/config';
import { emptyFrame, type InputFrame } from '../src/core/input';
import { Sim } from '../src/sim';
import { buildTerrain, layout } from '../src/world/testMap';

const terrain = buildTerrain();

beforeAll(async () => {
  await RAPIER.init();
});

/** Camera yaw that makes "forward" point from (x0,z0) toward (x1,z1). */
const yawToward = (x0: number, z0: number, x1: number, z1: number) => Math.atan2(-(x1 - x0), -(z1 - z0));

function run(sim: Sim, frames: number, make: (i: number) => InputFrame) {
  for (let i = 0; i < frames; i++) sim.step(make(i));
}

const place = (sim: Sim, x: number, z: number) => sim.teleport(x, z);

describe('player controller', () => {
  it('lands on the ground at spawn and stays grounded when idle', () => {
    const sim = new Sim(RAPIER, terrain);
    run(sim, 120, () => emptyFrame());
    const p = sim.player;
    expect(p.grounded).toBe(true);
    expect(Math.abs(p.pos.y - terrain.heightAt(p.pos.x, p.pos.z))).toBeLessThan(0.1);
  });

  it('walks at ~1.4 m/s, sprints at ~4.5 m/s, sneaks at ~0.8 m/s', () => {
    for (const [mode, expected] of [
      ['walk', config.player.walkSpeed],
      ['sprint', config.player.sprintSpeed],
      ['sneak', config.player.sneakSpeed],
    ] as const) {
      const sim = new Sim(RAPIER, terrain);
      place(sim, 40, 165); // open, gentle grass in the south-east
      const yaw = yawToward(40, 165, 100, 165);
      const f = (i: number) => ({
        ...emptyFrame(yaw),
        moveY: 1,
        sprint: mode === 'sprint',
        sneak: mode === 'sneak',
        crook: i < 0,
      });
      run(sim, 60, f); // accelerate
      const x0 = sim.player.pos.x;
      const z0 = sim.player.pos.z;
      run(sim, 120, f); // 2 seconds steady
      const v = Math.hypot(sim.player.pos.x - x0, sim.player.pos.z - z0) / (120 * SIM_DT);
      expect(v).toBeGreaterThan(expected * 0.85);
      expect(v).toBeLessThan(expected * 1.1);
    }
  });

  it('climbs the 25° hill to the plateau', () => {
    const sim = new Sim(RAPIER, terrain);
    const hl = layout.hill;
    const sx = hl.x;
    const sz = hl.z + hl.plateau + hl.flank + 8;
    place(sim, sx, sz);
    const yaw = yawToward(sx, sz, hl.x, hl.z);
    let minDist = Infinity;
    let maxY = -Infinity;
    // Track the closest approach: at sprint speed it runs over the top and down again.
    for (let i = 0; i < 60 * 20; i++) {
      sim.step({ ...emptyFrame(yaw), moveY: 1, sprint: true });
      minDist = Math.min(minDist, Math.hypot(sim.player.pos.x - hl.x, sim.player.pos.z - hl.z));
      maxY = Math.max(maxY, sim.player.pos.y);
    }
    expect(minDist).toBeLessThan(hl.plateau);
    expect(maxY).toBeGreaterThan(terrain.heightAt(sx, sz) + 15);
  });

  it('can scramble up the 35° cliff (player slope limit is 40°)', () => {
    const sim = new Sim(RAPIER, terrain);
    const c = layout.cliff;
    place(sim, -100, c.zFoot + 6);
    const y0 = sim.player.pos.y;
    run(sim, 60 * 15, () => ({ ...emptyFrame(0), moveY: 1, sprint: true })); // yaw 0 = north (-z)
    expect(sim.player.pos.y - y0).toBeGreaterThan(c.rise * 0.8);
  });

  it('cannot climb the 45° ravine walls, but walks out of the ravine ends', () => {
    const rv = layout.ravine;
    const mid = { x: (rv.a.x + rv.b.x) / 2, z: (rv.a.z + rv.b.z) / 2 };
    const ax = rv.b.x - rv.a.x;
    const az = rv.b.z - rv.a.z;
    const len = Math.hypot(ax, az);
    const dist = () => {
      const px = sim.player.pos.x - mid.x;
      const pz = sim.player.pos.z - mid.z;
      return Math.abs((px * az - pz * ax) / len); // distance from the ravine centre line
    };
    const sim = new Sim(RAPIER, terrain);
    // Sideways, toward both walls.
    for (const side of [1, -1]) {
      place(sim, mid.x, mid.z);
      const yaw = yawToward(0, 0, side * az, -side * ax);
      run(sim, 60 * 10, () => ({ ...emptyFrame(yaw), moveY: 1, sprint: true }));
      expect(dist()).toBeLessThan(rv.halfWidth - 1);
    }
    // Along the ravine floor: the end ramp lets you out.
    place(sim, mid.x, mid.z);
    const yawAlong = yawToward(rv.a.x, rv.a.z, rv.b.x, rv.b.z);
    run(sim, 60 * 25, () => ({ ...emptyFrame(yawAlong), moveY: 1, sprint: true }));
    const past = ((sim.player.pos.x - rv.a.x) * ax + (sim.player.pos.z - rv.a.z) * az) / (len * len);
    expect(past).toBeGreaterThan(1);
  });

  it('is stopped by the fence and the closed gate, and leaves through the open gate', () => {
    const sim = new Sim(RAPIER, terrain);
    const pen = layout.pen;
    // Inside the pen, walk west into the fence.
    place(sim, pen.x, pen.z);
    run(sim, 60 * 12, () => ({ ...emptyFrame(yawToward(0, 0, -1, 0)), moveY: 1, sprint: true }));
    expect(sim.player.pos.x).toBeGreaterThan(pen.x - pen.hx);
    // The gate starts closed: walking east is blocked too.
    place(sim, pen.x, pen.z);
    run(sim, 60 * 8, () => ({ ...emptyFrame(yawToward(0, 0, 1, 0)), moveY: 1, sprint: true }));
    expect(sim.player.pos.x).toBeLessThan(pen.x + pen.hx);
    // Open it and walk east through the opening.
    sim.setGate(true);
    place(sim, pen.x, pen.z);
    run(sim, 60 * 8, () => ({ ...emptyFrame(yawToward(0, 0, 1, 0)), moveY: 1, sprint: true }));
    expect(sim.player.pos.x).toBeGreaterThan(pen.x + pen.hx + 2);
  });

  it('emits crook and call events with cooldowns', () => {
    const sim = new Sim(RAPIER, terrain);
    let crooks = 0;
    let calls = 0;
    sim.events.on('crookWave', () => crooks++);
    sim.events.on('call', () => calls++);
    // Press crook and call every tick for 1 s: cooldowns allow 2 crooks (0.6 s) and 1 call (1.5 s).
    run(sim, 60, () => ({ ...emptyFrame(), crook: true, call: true }));
    expect(crooks).toBe(2);
    expect(calls).toBe(1);
  });
});

describe('determinism (M0 acceptance)', () => {
  it('the same recorded input produces the same end state twice', () => {
    // A scripted wander: changing camera yaw, sprint bursts, crook and call presses.
    const script = (i: number): InputFrame => ({
      ...emptyFrame(-0.8 + Math.sin(i / 90) * 0.4), // drifting north-east, toward pasture A
      moveX: Math.sin(i / 37) * 0.6,
      moveY: 0.8 + 0.2 * Math.cos(i / 53),
      sprint: i % 400 < 150,
      sneak: i % 700 > 620,
      crook: i % 97 === 0,
      call: i % 233 === 0,
    });
    const frames = Array.from({ length: 60 * 40 }, (_, i) => script(i));

    const a = new Sim(RAPIER, terrain);
    for (const f of frames) a.step(f);
    const keyA = a.stateKey();

    // Same Sim instance after reset (the in-game replay path) …
    a.reset();
    for (const f of frames) a.step(f);
    const keyA2 = a.stateKey();

    // … and a fresh Sim.
    const b = new Sim(RAPIER, terrain);
    for (const f of frames) b.step(f);

    expect(keyA2).toBe(keyA);
    expect(b.stateKey()).toBe(keyA);
    // Sanity: the script actually moved the player somewhere.
    expect(Math.hypot(b.player.pos.x - layout.spawn.x, b.player.pos.z - layout.spawn.z)).toBeGreaterThan(20);
  });
});

// M4 acceptance on the real test map, plus riding integration (mount, kick, noise, horn).
//   A lap of the gravel loop in under 2 minutes without falling (scripted rider).
//   The bike climbs the 25° hill on the dirt road but not up the muddy flank.

import { beforeAll, describe, expect, it } from 'vitest';
import { config, SIM_DT } from '../src/core/config';
import { emptyFrame, type InputFrame } from '../src/core/input';
import type { Sim } from '../src/sim';
import { Surface } from '../src/world/terrain';
import { layout } from '../src/world/testMap';
import { initRapier, newSim, placeFlock, run } from './helpers';

beforeAll(initRapier);

const DEG = Math.PI / 180;
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Put the bike somewhere, pointing somewhere, rider on, engine running. */
function startRiding(sim: Sim, x: number, z: number, heading: number) {
  const b = sim.bike;
  b.x = b.px = x;
  b.z = b.pz = z;
  b.heading = b.prevHeading = b.course = heading;
  b.state = 'parked';
  sim.teleport(x + 1, z);
  sim.mount();
  b.engineOn = true;
  b.rpm = config.bike.engine.idleRpm;
}

const tr = layout.track;
const ellipse = (th: number) => ({ x: tr.cx + tr.rx * Math.cos(th), z: tr.cz + tr.rz * Math.sin(th) });

/** Pure-pursuit rider along the loop (direction of increasing ellipse angle). */
function lapRider(sim: Sim): InputFrame {
  const b = sim.bike;
  const th = Math.atan2((b.z - tr.cz) / tr.rz, (b.x - tr.cx) / tr.rx);
  const localR = Math.hypot(tr.rx * Math.sin(th), tr.rz * Math.cos(th));
  const look = 7 + b.speed * 0.9;
  const t = ellipse(th + look / localR);
  const want = Math.atan2(t.x - b.x, t.z - b.z);
  const err = wrap(want - b.heading);
  const surf = sim.terrain.surfaceAt(b.x, b.z);
  const vt = surf === Surface.Mud ? 5 : surf === Surface.Dirt ? 9 : 9.5;
  const sliding = Math.abs(b.beta) > 8 * DEG;
  return {
    ...emptyFrame(),
    steer: Math.max(-1, Math.min(1, -err * 2.2)) * (sliding ? 0.5 : 1),
    throttle: sliding ? 0.15 : Math.max(0, Math.min(1, 0.45 + (vt - b.speed) * 0.5)),
    brake: b.speed > vt + 2 ? 0.4 : 0,
    weightShift: b.pitch > 8 * DEG ? 0.4 : 0,
  };
}

describe('M4 acceptance', () => {
  it('laps the gravel loop in under 2 minutes without falling', () => {
    const sim = newSim();
    sim.tasks.enabled = false;
    const th0 = (140 * Math.PI) / 180;
    const p0 = ellipse(th0);
    startRiding(sim, p0.x, p0.z, Math.atan2(-tr.rx * Math.sin(th0), tr.rz * Math.cos(th0)));
    let lap = -1;
    let falls = 0;
    sim.events.on('lap', (e) => {
      if (lap < 0) lap = e.seconds;
    });
    sim.events.on('bikeFall', () => falls++);
    let t = 0;
    let maxSpeed = 0;
    while (lap < 0 && t < 200) {
      sim.step(lapRider(sim));
      t += SIM_DT;
      maxSpeed = Math.max(maxSpeed, sim.bike.kmh);
      if (!sim.bike.rider) break;
    }
    console.log(`[lap] ${lap.toFixed(1)} s, falls ${falls}, top ${maxSpeed.toFixed(0)} km/h, lap msg "${sim.lap.message}"`);
    expect(falls).toBe(0);
    expect(lap).toBeGreaterThan(0);
    expect(lap).toBeLessThan(120);
    expect(sim.lap.best).toBeCloseTo(lap, 5);
  }, 60_000);

  const hill = layout.hill;
  const climbFrom = (angleDeg: number) => {
    const sim = newSim();
    sim.tasks.enabled = false;
    const a = angleDeg * DEG;
    const r = hill.plateau + hill.flank + 6;
    const x = hill.x + Math.cos(a) * r;
    const z = hill.z + Math.sin(a) * r;
    startRiding(sim, x, z, Math.atan2(hill.x - x, hill.z - z));
    let minR = Infinity;
    let bogged = 0;
    for (let t = 0; t < 25 && sim.bike.state === 'riding'; t += SIM_DT) {
      const b = sim.bike;
      const want = Math.atan2(hill.x - b.x, hill.z - b.z);
      sim.step({ ...emptyFrame(), throttle: 1, steer: Math.max(-1, Math.min(1, -wrap(want - b.heading) * 2)), weightShift: 0.3 });
      minR = Math.min(minR, Math.hypot(sim.bike.x - hill.x, sim.bike.z - hill.z));
      bogged = Math.max(bogged, sim.bike.bogged);
    }
    return { minR, bogged, sim };
  };

  it('climbs the 25° hill on the dirt road', () => {
    // The loop crosses the hill west-east; ride up its western ramp.
    const westOnRoad = Math.atan2(-50 - hill.z, -70 - hill.x) / DEG;
    const { minR, sim } = climbFrom(westOnRoad);
    console.log(`[hill] dirt road: got within ${minR.toFixed(1)} m of the top, surface ${sim.terrain.surfaceAt(sim.bike.x, sim.bike.z)}`);
    expect(minR).toBeLessThan(hill.plateau);
  });

  it('cannot climb the muddy flank', () => {
    const { minR, bogged } = climbFrom(hill.mudFlank.angleDeg);
    console.log(`[hill] mud flank: closest ${minR.toFixed(1)} m from the top, bogged ${bogged.toFixed(1)} s`);
    expect(minR).toBeGreaterThan(hill.plateau + hill.flank * 0.5);
    expect(bogged).toBeGreaterThan(2);
  });
});

describe('riding', () => {
  it('E next to the bike gets on and off; the shepherd rides with it', () => {
    const sim = newSim();
    const b = sim.bike;
    sim.teleport(b.x + 1.2, b.z);
    sim.step({ ...emptyFrame(), interact: true });
    expect(sim.riding).toBe(true);
    expect(sim.player.collider.isEnabled()).toBe(false);
    b.engineOn = true;
    run(sim, 120, () => ({ ...emptyFrame(), throttle: 0.6 }));
    expect(Math.hypot(sim.player.pos.x - b.x, sim.player.pos.z - b.z)).toBeLessThan(0.5);
    sim.step({ ...emptyFrame(), interact: true });
    expect(sim.riding).toBe(false);
    expect(sim.player.collider.isEnabled()).toBe(true);
    expect(Math.hypot(sim.player.pos.x - b.x, sim.player.pos.z - b.z)).toBeGreaterThan(0.8);
  });

  it('kick-starts on Space when the needle is in the green', () => {
    const sim = newSim();
    sim.teleport(sim.bike.x + 1.2, sim.bike.z);
    sim.step({ ...emptyFrame(), interact: true });
    const k = config.bike.kick;
    // Wait for the needle to come round into the window, then kick.
    while (!sim.bike.kickInWindow) sim.step(emptyFrame());
    sim.step({ ...emptyFrame(), kick: true });
    expect(sim.bike.engineOn).toBe(true);
    expect(k.windowEnd).toBeGreaterThan(k.windowStart);
  });

  it('a revving engine near the flock stresses the sheep; a silent bike does not', () => {
    const measure = (engine: boolean) => {
      const sim = newSim();
      sim.tasks.enabled = false;
      placeFlock(sim, -20, 98);
      startRiding(sim, -20, 112, Math.PI);
      sim.bike.engineOn = engine;
      run(sim, 60 * 4, () => ({ ...emptyFrame(), throttle: engine ? 0.8 : 0, brake: 1 }));
      return sim.flock.sheep.reduce((a, s) => a + s.stress, 0) / sim.flock.sheep.length;
    };
    const loud = measure(true);
    const quiet = measure(false);
    console.log(`[noise] mean sheep stress: engine revving ${loud.toFixed(0)}, engine off ${quiet.toFixed(0)}`);
    expect(loud).toBeGreaterThan(20);
    expect(quiet).toBeLessThan(5);
  });

  it('the horn breaks a wolf’s nerve', () => {
    const sim = newSim();
    sim.tasks.enabled = false;
    const w = sim.spawnWolf(sim.bike.x + 10, sim.bike.z);
    const m0 = w.morale;
    sim.teleport(sim.bike.x + 1.2, sim.bike.z);
    sim.step({ ...emptyFrame(), interact: true });
    sim.step({ ...emptyFrame(), horn: true });
    expect(w.morale).toBeLessThan(m0 - 30);
  });
});

describe('Day 2 (motorcycle tasks)', () => {
  it('walks through the whole day', () => {
    const sim = newSim();
    sim.startDay(2);
    const T = sim.tasks;
    const id = () => T.task?.id;
    run(sim, 1);
    expect(id()).toBe('getOn');
    sim.teleport(sim.bike.x + 1.2, sim.bike.z);
    sim.step({ ...emptyFrame(), interact: true });
    run(sim, 1);
    expect(id()).toBe('kick');
    while (!sim.bike.kickInWindow) sim.step(emptyFrame());
    sim.step({ ...emptyFrame(), kick: true });
    run(sim, 1);
    expect(id()).toBe('toLoop');
    // Put the bike just before the start line, heading along the loop.
    const th0 = (146 * Math.PI) / 180;
    const p0 = ellipse(th0);
    const b = sim.bike;
    b.x = b.px = p0.x;
    b.z = b.pz = p0.z;
    b.heading = b.course = Math.atan2(-tr.rx * Math.sin(th0), tr.rz * Math.cos(th0));
    run(sim, 1);
    expect(id()).toBe('lap');
    for (let t = 0; t < 150 && id() === 'lap'; t += SIM_DT) sim.step(lapRider(sim));
    run(sim, 2);
    expect(id()).toBe('hill'); // the first lap was clean and under 2:00, so fastLap ticked off too
    // Up the dirt road.
    const hill = layout.hill;
    const climb = (angleDeg: number, seconds: number, until: () => boolean) => {
      const a = angleDeg * DEG;
      const r = hill.plateau + hill.flank + 6;
      b.x = b.px = hill.x + Math.cos(a) * r;
      b.z = b.pz = hill.z + Math.sin(a) * r;
      b.heading = b.course = Math.atan2(hill.x - b.x, hill.z - b.z);
      b.u = 0;
      for (let t = 0; t < seconds && !until(); t += SIM_DT) {
        const want = Math.atan2(hill.x - b.x, hill.z - b.z);
        sim.step({ ...emptyFrame(), throttle: 1, steer: Math.max(-1, Math.min(1, -wrap(want - b.heading) * 2)), weightShift: 0.3 });
      }
    };
    climb(Math.atan2(-50 - hill.z, -70 - hill.x) / DEG, 25, () => id() !== 'hill');
    expect(id()).toBe('mud');
    climb(hill.mudFlank.angleDeg, 15, () => id() !== 'mud');
    expect(id()).toBe('scout');
    if (b.state === 'fallen') {
      sim.dismount();
      b.lift();
      sim.mount();
      b.engineOn = true;
    }
    const C = layout.pastures[2];
    b.x = b.px = C.x;
    b.z = b.pz = C.z + 5;
    run(sim, 3);
    expect(id()).toBe('park');
    // Park 40 m east of the pen, walk to the gate, let the flock settle.
    b.x = b.px = layout.pen.x + 40;
    b.z = b.pz = layout.pen.z;
    sim.dismount();
    sim.teleport(sim.gatePos.x + 2, sim.gatePos.z);
    run(sim, 60 * 15);
    expect(T.finished).toBe(true);
  }, 60_000);
});

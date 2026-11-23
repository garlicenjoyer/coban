// M3 acceptance (GDD Part IV) plus the Kangal's layer behaviour.
//   Gather brings 90% of a scattered flock to the shepherd within 30 s on the meadow.
//   Hold keeps the flock within 20 m for 3 minutes while the shepherd walks 100 m away.
//   Search finds a stray in the ravine within 60 s.

import { beforeAll, describe, expect, it } from 'vitest';
import { config, FIRST_NIGHT_HOUR, SIM_DT } from '../src/core/config';
import { emptyFrame } from '../src/core/input';
import type { Sim } from '../src/sim';
import { rng } from '../src/world/noise';
import { layout } from '../src/world/testMap';
import { initRapier, newSim, placeFlock, run, yawToward } from './helpers';

beforeAll(initRapier);

it('warns and drives off the first night wolf with no commands from the cottage', () => {
  const sim = newSim();
  sim.teleport(sim.doorPos.x, sim.doorPos.z);
  const barks: string[] = [];
  const stages = new Set<string>();
  sim.events.on('bark', ({ kind }) => barks.push(kind));

  sim.hour = FIRST_NIGHT_HOUR - 1;
  run(sim, 1);
  expect(sim.nightWolf).toBeNull();

  sim.hour = FIRST_NIGHT_HOUR - SIM_DT / config.time.secondsPerHour / 2;
  run(sim, 1);
  const wolf = sim.nightWolf!;
  expect(wolf.kind).toBe('pen');

  while (wolf.state !== 'flee' && wolf.age < config.wolf.probeSeconds + 1) {
    run(sim, 1);
    stages.add(sim.dog.state);
  }
  expect(barks[0]).toBe('alert');
  expect(stages.has('interpose')).toBe(true);
  expect(stages.has('charge')).toBe(true);
  expect(wolf.state).toBe('flee');
  expect(wolf.morale).toBeLessThanOrEqual(0);
  expect(sim.wolves.bites).toBe(0);
  expect(sim.sheepInPen).toBe(sim.flock.sheep.length);

  sim.hour = FIRST_NIGHT_HOUR - SIM_DT / config.time.secondsPerHour / 2;
  run(sim, 1);
  expect(sim.nightWolf).toBe(wolf);
});

it('a night wolf can get to sheep through an open gate when Karabaş is away', () => {
  const sim = newSim();
  sim.setGate(true);
  const far = layout.pastures[2];
  sim.teleport(far.x, far.z);
  placeDog(sim, far.x + 10, far.z);

  sim.hour = FIRST_NIGHT_HOUR - SIM_DT / config.time.secondsPerHour / 2;
  run(sim, 1);
  const wolf = sim.nightWolf!;
  while (wolf.state !== 'flee' && wolf.age < config.wolf.probeSeconds + 1) run(sim, 1);
  expect(sim.wolves.bites).toBe(1);
});

const TRACE = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TRACE;

const MEADOW = { x: -20, z: 98 };

function placeDog(sim: Sim, x: number, z: number) {
  const d = sim.dog;
  d.x = d.px = x;
  d.z = d.pz = z;
  d.y = d.py = sim.terrain.heightAt(x, z);
  d.vx = d.vz = 0;
}

/** Scatter the flock over a disc; seeded, so every run is the same. */
function scatter(sim: Sim, cx: number, cz: number, r: number, seed = 5) {
  const rand = rng(seed);
  for (const s of sim.flock.sheep) {
    for (let k = 0; k < 50; k++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * r;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (sim.obstacles.blocked(x, z, 0.6) || sim.terrain.slopeDegAt(x, z) > 20) continue;
      s.x = s.px = x;
      s.z = s.pz = z;
      s.y = s.py = sim.terrain.heightAt(x, z);
      break;
    }
    s.inPen = false;
  }
}

const shareWithin = (sim: Sim, x: number, z: number, r: number) =>
  sim.flock.sheep.filter((s) => Math.hypot(s.x - x, s.z - z) < r).length / sim.flock.sheep.length;

describe('M3 acceptance', () => {
  it.each([5, 11, 23, 42, 77, 101])('Gather brings 90%% of a scattered flock to the shepherd within 30 s (scatter seed %i)', (seed) => {
    const sim = newSim();
    placeFlock(sim, MEADOW.x, MEADOW.z);
    scatter(sim, MEADOW.x, MEADOW.z, 25, seed);
    const P = { x: MEADOW.x, z: MEADOW.z + 28 };
    sim.teleport(P.x, P.z);
    placeDog(sim, P.x + 2, P.z);
    sim.giveCommand('gather', yawToward(P.x, P.z, MEADOW.x, MEADOW.z));
    let t = 0;
    let reached = -1;
    while (t < 30) {
      sim.step(emptyFrame());
      t += 1 / 60;
      if (reached < 0 && shareWithin(sim, P.x, P.z, 12) >= 0.9) reached = t;
      if (TRACE && sim.tick % 60 === 0) {
        const d = sim.dog;
        const C = sim.flock.centroid;
        const modes = [0, 0, 0, 0, 0];
        for (const s of sim.flock.sheep) modes[s.mode]++;
        console.log(
          `${t.toFixed(0)}s ${d.active}/${d.state} dog(${d.x.toFixed(0)},${d.z.toFixed(0)}) st${d.stamina.toFixed(0)} C(${C.x.toFixed(0)},${C.z.toFixed(0)}) r80 ${sim.flock.radius80.toFixed(0)} near12 ${(shareWithin(sim, P.x, P.z, 12) * 24).toFixed(0)} modes ${modes.join('/')} L(${sim.flock.leader.x.toFixed(0)},${sim.flock.leader.z.toFixed(0)} m${sim.flock.leader.mode} st${sim.flock.leader.stress.toFixed(0)})`,
        );
      }
    }
    console.log(`[gather seed ${seed}] 90% within 12 m after ${reached.toFixed(1)} s; dog: ${sim.dog.lastResult}`);
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(30);
  });

  it('Hold keeps the flock within 20 m for 3 minutes while the shepherd walks 100 m away', () => {
    const sim = newSim();
    placeFlock(sim, MEADOW.x, MEADOW.z);
    sim.teleport(MEADOW.x, MEADOW.z + 10);
    placeDog(sim, MEADOW.x + 3, MEADOW.z + 8);
    sim.giveCommand('hold', 0);
    run(sim, 60 * 3);
    const hx = sim.dog.holdX;
    const hz = sim.dog.holdZ;
    // Walk 100 m east, then stand.
    const yaw = yawToward(0, 0, 1, 0);
    const start = sim.player.pos.x;
    let worst = 1;
    let t = 0;
    while (t < 180) {
      const away = sim.player.pos.x - start < 100;
      sim.step({ ...emptyFrame(yaw), moveY: away ? 1 : 0 });
      t += 1 / 60;
      if (sim.tick % 60 === 0) worst = Math.min(worst, shareWithin(sim, hx, hz, config.dog.hold.radius));
    }
    console.log(`[hold] worst share within 20 m over 3 min: ${(worst * 100).toFixed(0)}%; shepherd ${(sim.player.pos.x - start).toFixed(0)} m away`);
    expect(sim.player.pos.x - start).toBeGreaterThan(95);
    expect(worst).toBeGreaterThanOrEqual(23 / 24);
    expect(sim.flock.strayEvents).toBe(0);
  });

  it('Search finds a stray in the ravine within 60 s', () => {
    const sim = newSim();
    const home = { x: -75, z: 70 };
    placeFlock(sim, home.x, home.z);
    const rv = layout.ravine;
    const floor = { x: (rv.a.x + rv.b.x) / 2, z: (rv.a.z + rv.b.z) / 2 };
    const s = sim.flock.sheep.find((x) => !x.isLeader)!;
    s.x = s.px = floor.x;
    s.z = s.pz = floor.z;
    s.y = s.py = sim.terrain.heightAt(floor.x, floor.z);
    s.isStray = true;
    sim.teleport(home.x + 6, home.z + 6);
    placeDog(sim, home.x + 8, home.z + 6);
    sim.giveCommand('search', yawToward(home.x, home.z, floor.x, floor.z));
    let t = 0;
    while (t < 60 && sim.dog.searchFoundAt < 0) {
      sim.step(emptyFrame());
      t += 1 / 60;
    }
    console.log(`[search] found the ravine stray after ${t.toFixed(1)} s (${Math.hypot(home.x - floor.x, home.z - floor.z).toFixed(0)} m away)`);
    expect(sim.dog.searchFoundAt).toBeGreaterThan(0);
    expect(t).toBeLessThan(60);
  });
});

describe('Kangal behaviour', () => {
  it('acknowledges at once; bond sets the delay (2 s at 0, 0.3 s at 100)', () => {
    for (const [bond, delay] of [
      [0, 2.0],
      [100, 0.3],
    ]) {
      const sim = newSim();
      sim.dog.bond = bond;
      const acks: number[] = [];
      sim.events.on('dogAck', (e) => acks.push(e.delay));
      // Try until one is obeyed (bond 0 ignores 30%).
      for (let i = 0; i < 10 && !sim.dog.pending; i++) sim.giveCommand('heel', 0);
      expect(acks.length).toBeGreaterThan(0);
      expect(acks[0]).toBeCloseTo(delay, 5);
      expect(sim.dog.ackTimer).toBeGreaterThan(0);
      run(sim, Math.round(delay * 60) - 3);
      expect(sim.dog.command).toBeNull();
      run(sim, 6);
      expect(sim.dog.command).toBe('heel');
    }
  });

  it('a low-bond dog sometimes ignores a command; a devoted one never does', () => {
    const count = (bond: number) => {
      const sim = newSim();
      sim.dog.bond = bond;
      let obeyed = 0;
      sim.events.on('dogAck', (e) => (obeyed += e.willObey ? 1 : 0));
      for (let i = 0; i < 200; i++) sim.giveCommand('heel', 0);
      return obeyed;
    };
    const low = count(0);
    expect(low).toBeGreaterThan(110);
    expect(low).toBeLessThan(170);
    expect(count(100)).toBe(200);
  });

  it('close and in sight = silent gesture; far = whistle (startles sheep); beyond 150 m nobody hears', () => {
    const sim = newSim();
    const modes: string[] = [];
    sim.events.on('dogCommand', (e) => modes.push(`${e.mode}:${e.heard}`));
    sim.teleport(-40, 182);
    placeDog(sim, -32, 182);
    sim.giveCommand('heel', 0);
    placeDog(sim, -40 + 60, 182);
    sim.giveCommand('heel', 0);
    placeDog(sim, -40 + 170, 182);
    sim.giveCommand('heel', 0);
    expect(modes).toEqual(['gesture:true', 'whistle:true', 'whistle:false']);
  });

  it('Heel keeps the dog at the shepherd’s side on a walk', () => {
    const sim = newSim();
    sim.teleport(-40, 182);
    placeDog(sim, -20, 175);
    sim.dog.bond = 100;
    sim.giveCommand('heel', 0);
    const yaw = yawToward(0, 0, 1, 0);
    run(sim, 60 * 30, () => ({ ...emptyFrame(yaw), moveY: 1 }));
    const d = Math.hypot(sim.dog.x - sim.player.pos.x, sim.dog.z - sim.player.pos.z);
    expect(d).toBeLessThan(4);
  });

  it('runs out of stamina, lies down, and gets up again at 40', () => {
    const sim = newSim();
    placeFlock(sim, 40, 165);
    sim.teleport(40, 155);
    placeDog(sim, 44, 158);
    sim.dog.stamina = 0;
    sim.dog.bond = 100;
    sim.giveCommand('heel', 0);
    run(sim, 60 * 2);
    expect(sim.dog.active).toBe('override');
    let t = 0;
    while (sim.dog.exhausted && t < 30) {
      sim.step(emptyFrame());
      t += 1 / 60;
    }
    expect(sim.dog.exhausted).toBe(false);
    expect(sim.dog.stamina).toBeGreaterThanOrEqual(config.dog.stamina.recoverTo);
    expect(sim.dog.command).toBe('heel'); // resumed what he was doing
  });

  it('petting raises bond; praise right after a finished command raises it more', () => {
    const sim = newSim();
    sim.dog.bond = 50;
    sim.dog.pet(0);
    expect(sim.dog.bond).toBe(51);
    sim.dog.pet(0); // cooldown
    expect(sim.dog.bond).toBe(51);
    sim.dog.finish('test');
    sim.dog.pet(0);
    expect(sim.dog.bond).toBe(54);
  });

  it('meets a wolf: alerts, stands between, charges, and drives it off before it bites', () => {
    const sim = newSim();
    placeFlock(sim, MEADOW.x, MEADOW.z);
    sim.teleport(MEADOW.x + 60, MEADOW.z); // shepherd far away: the dog is on his own
    placeDog(sim, MEADOW.x, MEADOW.z + 8);
    run(sim, 60);
    const wolf = sim.spawnWolf(MEADOW.x - 70, MEADOW.z - 10);
    const states = new Set<string>();
    const barks = new Set<string>();
    sim.events.on('bark', (e) => barks.add(e.kind));
    let t = 0;
    while (t < 60 && sim.wolves.list.includes(wolf) && wolf.state !== 'flee') {
      sim.step(emptyFrame());
      if (sim.dog.active === 'threat') states.add(sim.dog.threatState);
      t += 1 / 60;
    }
    console.log(`[wolf] driven off after ${t.toFixed(1)} s, bites ${sim.wolves.bites}, dog states ${[...states].join(' > ')}`);
    expect(wolf.state).toBe('flee');
    expect(sim.wolves.bites).toBe(0);
    expect(states.has('alert')).toBe(true);
    expect(states.has('charge')).toBe(true);
    expect(barks.has('alert')).toBe(true);
    // He comes back to the flock afterwards.
    run(sim, 60 * 20);
    expect(Math.hypot(sim.dog.x - sim.flock.centroid.x, sim.dog.z - sim.flock.centroid.z)).toBeLessThan(sim.flock.radius80 + 12);
  });

  it('without the dog the same wolf gets a sheep', () => {
    const sim = newSim();
    placeFlock(sim, MEADOW.x, MEADOW.z);
    sim.teleport(MEADOW.x + 60, MEADOW.z);
    placeDog(sim, 150, -150); // far away, out of earshot
    sim.dog.exhausted = true;
    sim.dog.stamina = 0;
    config.dog.stamina.regenPerSec = 0;
    try {
      const wolf = sim.spawnWolf(MEADOW.x - 70, MEADOW.z - 10);
      run(sim, 60 * 60);
      expect(sim.wolves.bites + (wolf.state === 'flee' ? 0 : 0)).toBeGreaterThan(0);
    } finally {
      config.dog.stamina.regenPerSec = 6;
    }
  });
});

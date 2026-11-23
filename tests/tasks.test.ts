// Day 1 task chain: every task completes from world state, in order, and the day ends.

import { beforeAll, expect, it } from 'vitest';
import { config, GOLDEN_HOUR, SIM_DT, SUNSET_HOUR } from '../src/core/config';
import { emptyFrame } from '../src/core/input';
import { layout } from '../src/world/testMap';
import { initRapier, newSim, placeFlock, run } from './helpers';

beforeAll(initRapier);

const halfClockStep = () => SIM_DT / config.time.secondsPerHour / 2;

it('announces golden hour once and freezes the closed-pen tally at sunset', () => {
  const sim = newSim();
  const days: number[] = [];
  sim.events.on('goldenHour', ({ day }) => days.push(day));

  sim.hour = GOLDEN_HOUR - halfClockStep();
  run(sim, 2);
  expect(days).toEqual([1]);
  expect(sim.sunsetTally()).toBeUndefined();

  const ewe = sim.flock.sheep[0];
  ewe.x = layout.pastures[0].x;
  ewe.z = layout.pastures[0].z;
  const total = sim.flock.sheep.length;
  sim.hour = SUNSET_HOUR - halfClockStep();
  run(sim, 1);
  expect(sim.sunsetTally()).toEqual({ inPen: total - 1, safe: total - 1, total, gateClosed: true });

  sim.setGate(true);
  sim.hour = GOLDEN_HOUR - halfClockStep();
  run(sim, 1);
  sim.hour = SUNSET_HOUR - halfClockStep();
  run(sim, 1);
  expect(days).toEqual([1]);
  expect(sim.sunsetTally()?.safe).toBe(total - 1);

  sim.startDay(2);
  sim.hour = GOLDEN_HOUR - halfClockStep();
  run(sim, 1);
  expect(days).toEqual([1, 2]);
  expect(sim.sunsetTally()).toBeUndefined();
  expect(sim.sunsetTally(1)?.safe).toBe(total - 1);
});

it('records sheep behind an open gate separately from safely penned sheep', () => {
  const sim = newSim();
  sim.setGate(true);
  sim.hour = SUNSET_HOUR - halfClockStep();
  run(sim, 1);
  const total = sim.flock.sheep.length;
  expect(sim.sunsetTally()).toEqual({ inPen: total, safe: 0, total, gateClosed: false });

  sim.reset();
  expect(sim.sunsetTally()).toBeUndefined();
});

it('walks through all of Day 1', () => {
  const sim = newSim();
  const T = sim.tasks;
  const started: string[] = [];
  sim.events.on('taskStarted', (e) => started.push(e.id));
  const step = (frames = 1, f = emptyFrame) => run(sim, frames, () => f());
  step();
  expect(T.task?.id).toBe('gate');

  // 1. Open the gate (E at the gate).
  sim.teleport(sim.gatePos.x + 1.5, sim.gatePos.z);
  step(1, () => ({ ...emptyFrame(), interact: true }));
  step();
  expect(T.task?.id).toBe('leadOut');

  // 2-3. Flock out and onto pasture A.
  const A = layout.pastures[0];
  placeFlock(sim, A.x, A.z);
  step(2);
  expect(T.task?.id).toBe('graze');

  // 4. An hour of calm grazing (shepherd standing off to the side).
  sim.teleport(A.x + 30, A.z);
  step(60 * (config.time.secondsPerHour + 20));
  expect(T.task?.id).toBe('pet');

  // 5. Pet the dog.
  sim.teleport(sim.dog.x + 1, sim.dog.z);
  step(1, () => ({ ...emptyFrame(), interact: true }));
  step();
  expect(T.task?.id).toBe('gather');

  // 6. Gather (a devoted dog, flock already close by): success counts.
  sim.dog.bond = 100;
  sim.teleport(A.x + 6, A.z);
  sim.giveCommand('gather', 0);
  step(60 * 20);
  expect(T.task?.id).toBe('hold');

  // 7. Hold, then stay 60 m away for 30 s.
  sim.giveCommand('hold', 0);
  step(60);
  sim.teleport(sim.dog.holdX + 60, sim.dog.holdZ);
  step(60 * 32);
  expect(T.task?.id).toBe('lost');

  // 8. A ewe is lost in the thorns.
  const ewe = sim.flock.sheep[T.state.n.ewe];
  expect(ewe.stuck).toBe('thorn');
  expect(ewe.isStray).toBe(true);
  sim.teleport(ewe.x + 1.6, ewe.z);
  step(2);
  expect(T.task?.id).toBe('free');

  // 9. Free her.
  step(60 * 2.5, () => ({ ...emptyFrame(), interactHeld: true }));
  expect(ewe.stuck).toBe('none');
  step();
  expect(T.task?.id).toBe('rejoin');

  // 10. Bring her back.
  ewe.x = ewe.px = sim.flock.centroid.x + 2;
  ewe.z = ewe.pz = sim.flock.centroid.z;
  step(60 * 2);
  expect(T.task?.id).toBe('wolf');

  // 11. A wolf comes; Karabaş deals with it.
  expect(sim.wolves.list.length).toBe(1);
  let t = 0;
  while (T.task?.id === 'wolf' && t < 90) {
    step();
    t += 1 / 60;
  }
  expect(T.task?.id).toBe('home');

  // 12. Everyone in the pen, gate closed.
  sim.flock.sheep.forEach((s, i) => {
    s.x = s.px = layout.pen.x - 6 + (i % 6) * 1.6;
    s.z = s.pz = layout.pen.z - 4 + Math.floor(i / 6) * 1.6;
    s.isStray = false;
  });
  sim.setGate(false);
  step(2);
  expect(T.finished).toBe(true);
  expect(T.dayDoneAt).toBeGreaterThan(0);
  expect(started).toEqual(sim.tasks.tasks.map((x) => x.id));
}, 60_000);

it('doing things early ticks tasks off at once', () => {
  const sim = newSim();
  sim.setGate(true);
  placeFlock(sim, layout.pastures[0].x, layout.pastures[0].z);
  run(sim, 5);
  expect(sim.tasks.task?.id).toBe('graze');
});

it('petting Karabaş before the task comes up still counts', () => {
  const sim = newSim();
  sim.dog.care.pettedToday = true;
  const pet = sim.tasks.tasks.findIndex((t) => t.id === 'pet');
  run(sim, 1);
  while (sim.tasks.index < pet) sim.tasks.skip();
  run(sim, 2);
  expect(sim.tasks.task?.id).toBe('gather');
});

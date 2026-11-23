import { beforeAll, expect, it } from 'vitest';
import { config, SIM_HZ } from '../src/core/config';
import { emptyFrame } from '../src/core/input';
import type { Sim } from '../src/sim';
import { layout } from '../src/world/testMap';
import { CAN_LITERS, RACK_CANS } from '../src/world/water';
import { initRapier, newSim, placeFlock, run } from './helpers';

beforeAll(initRapier);

const C = layout.pastures[2];
const useWater = () => ({ ...emptyFrame(), water: true });

function park(sim: Sim, x: number, z: number) {
  sim.bike.x = x;
  sim.bike.z = z;
  sim.bike.y = sim.terrain.heightAt(x, z);
}

function giveSpace(sim: Sim, x: number, z: number) {
  sim.teleport(x, z);
  sim.dog.x = x + 30;
  sim.dog.z = z;
}

it('drinks at the çeşme and inside the closed pen', () => {
  const sim = newSim();
  giveSpace(sim, 70, -80);
  const cesme = layout.cesme;
  placeFlock(sim, cesme.x + 5, cesme.z + 4, 1.2);
  sim.flock.sheep.forEach((s) => (s.thirst = 65));
  run(sim, SIM_HZ * 32);
  const fountain = sim.water.points.find((p) => p.kind === 'fountain')!;
  expect(sim.flock.sheep.filter((s) => s.lastDrinkFrom === fountain.id && s.thirst < 27).length).toBeGreaterThanOrEqual(12);

  sim.reset();
  giveSpace(sim, 70, -80);
  sim.flock.sheep.forEach((s) => (s.thirst = 65));
  run(sim, SIM_HZ * 30);
  expect(sim.sheepInPen).toBe(sim.flock.sheep.length);
  const trough = sim.water.points.find((p) => p.kind === 'trough')!;
  expect(sim.flock.sheep.filter((s) => s.lastDrinkFrom === trough.id && s.thirst < 27).length).toBeGreaterThanOrEqual(18);
});

it('midday heat raises thirst and dehydration damages health at dry Pasture C', () => {
  const sim = newSim();
  giveSpace(sim, C.x - 45, C.z + 20);
  placeFlock(sim, C.x, C.z);
  const ewe = sim.flock.sheep[0];
  ewe.thirst = 94;
  sim.hour = 12;
  run(sim, SIM_HZ * 10);
  expect(ewe.thirst).toBeCloseTo(94 + 10 / config.time.secondsPerHour * config.flock.thirst.perHour * config.flock.thirst.middayMultiplier, 5);
  expect(ewe.health).toBeLessThan(100);
  expect(ewe.lastDrinkAt).toBe(-1);
});

it('Day 3 accepts a spring stop followed by a trip to the dry pasture', () => {
  const sim = newSim();
  sim.startDay(3);
  const spring = layout.springs[1];
  giveSpace(sim, spring.x - 38, spring.z + 28);
  placeFlock(sim, spring.x - 8, spring.z, 1.5);
  sim.flock.sheep.forEach((s) => (s.thirst = 67));
  run(sim, SIM_HZ * 38);
  expect(sim.tasks.task?.id).toBe('waterDryPasture');
  placeFlock(sim, C.x, C.z);
  run(sim, 1);
  expect(sim.tasks.task?.id).toBe('home');
  expect(sim.bike.waterCans).toBe(0);
});

it('Day 3 still counts a flock that drank at a spring and got thirsty again on the long walk to C', () => {
  const sim = newSim();
  sim.startDay(3);
  const spring = layout.springs[1];
  giveSpace(sim, spring.x - 38, spring.z + 28);
  placeFlock(sim, spring.x - 8, spring.z, 1.5);
  sim.flock.sheep.forEach((s) => (s.thirst = 67));
  run(sim, SIM_HZ * 38);
  expect(sim.tasks.task?.id).toBe('waterDryPasture');
  // Hours on the road: thirsty again by the time they reach C.
  sim.flock.sheep.forEach((s) => (s.thirst = config.flock.thirst.seekAt + 10));
  placeFlock(sim, C.x, C.z);
  sim.flock.sheep.forEach((s) => (s.thirst = config.flock.thirst.seekAt + 10));
  run(sim, 1);
  expect(sim.tasks.task?.id).toBe('home');
});

it('loads, hauls and pours a finite supply to complete Day 3 at Pasture C', () => {
  const sim = newSim();
  sim.startDay(3);
  park(sim, layout.cesme.x + 4, layout.cesme.z);
  sim.teleport(layout.cesme.x + 2, layout.cesme.z);
  run(sim, 2, useWater);
  expect(sim.bike.waterCans).toBe(RACK_CANS);
  expect(sim.water.points.every((p) => p.liters === null)).toBe(true);
  sim.mount();
  run(sim, 1, useWater);
  expect(sim.bike.waterCans).toBe(RACK_CANS);
  sim.dismount();

  park(sim, C.x - 6, C.z + 1);
  sim.teleport(C.x - 3, C.z + 1);
  run(sim, 2, useWater);
  const basin = sim.water.points.find((p) => p.kind === 'basin')!;
  expect(sim.bike.waterCans).toBe(0);
  expect(basin.liters).toBe(CAN_LITERS * RACK_CANS);
  run(sim, 1, useWater);
  expect(basin.liters).toBe(CAN_LITERS * RACK_CANS);

  giveSpace(sim, C.x - 40, C.z + 20);
  placeFlock(sim, C.x + 3, C.z);
  sim.flock.sheep.forEach((s) => (s.thirst = 75));
  run(sim, SIM_HZ * 40);
  expect(sim.tasks.task?.id).toBe('home');
  expect(basin.liters).toBeGreaterThanOrEqual(0);
  expect(basin.liters).toBeLessThan(CAN_LITERS);
  expect(sim.flock.sheep.some((s) => s.lastDrinkFrom === basin.id)).toBe(true);
});

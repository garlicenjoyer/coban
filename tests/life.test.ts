import RAPIER from '@dimforge/rapier3d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config, SIM_DT } from '../src/core/config';
import { EventBus } from '../src/core/events';
import { emptyFrame } from '../src/core/input';
import { snapshot } from '../src/core/save';
import { Errands } from '../src/life/errands';
import { Resident, Residents } from '../src/life/residents';
import { Wildlife } from '../src/life/wildlife';
import { Sim } from '../src/sim';
import { useMap } from '../src/world/map';
import { Obstacles } from '../src/world/obstacles';
import { TEST_MAP } from '../src/world/testMap';
import { VALLEY_MAP } from '../src/world/valley';

const terrain = VALLEY_MAP.buildTerrain();
const obstacles = new Obstacles(VALLEY_MAP.buildProps(terrain));
const routes = VALLEY_MAP.residents!;
const distant = { x: 0, y: 0, z: 0 };
const quiet = { player: distant, rider: false, playerSpeed: 0, bike: distant, dog: distant, sheep: [], hour: 10, honking: false };

beforeAll(async () => {
  await RAPIER.init();
  useMap(VALLEY_MAP);
});
afterAll(() => useMap(TEST_MAP));

describe('valley life', () => {
  it('keeps each circuit clear and reaches every scheduled stop before the next one', () => {
    for (const route of routes) {
      const resident = new Resident(route, terrain, obstacles);
      const road = resident.circuit;
      for (let s = 0; s < road.length; s += 0.25) {
        const p = road.at(s);
        expect(obstacles.blocked(p.x, p.z, resident.clearance), `${resident.id} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(false);
      }
      let time = 0;
      for (let i = 0; i < route.stops.length; i++) {
        const stop = route.stops[i];
        const beforeNext = (route.stops[i + 1]?.hour ?? 24) - 0.1;
        for (; time < beforeNext * config.time.secondsPerHour; time += 1 / 18) {
          resident.step(1 / 18, { ...quiet, hour: time / config.time.secondsPerHour });
        }
        expect(resident.destination, resident.id).toBe(stop);
        expect(resident.settled, `${resident.id} at ${stop.place}`).toBe(true);
        expect(resident.speed).toBe(0);
        const position = road.at(road.atStop(stop.point));
        expect(Math.hypot(resident.x - position.x, resident.z - position.z)).toBeLessThan(0.01);
      }
      expect(resident.travel, resident.id).toBeCloseTo(road.length, 1);
    }
  });

  it('yields to traffic, remembers a greeting and resumes when the way clears', () => {
    const events = new EventBus();
    const residents = new Residents(routes, terrain, obstacles, events);
    const tractor = residents.list[0];
    for (let i = 0; i < 120; i++) residents.step(SIM_DT, quiet);
    const p = { x: tractor.x + Math.sin(tractor.yaw) * 6, z: tractor.z + Math.cos(tractor.yaw) * 6, y: tractor.y };
    for (let i = 0; i < 135; i++) residents.step(SIM_DT, { ...quiet, player: p, rider: true });
    expect(tractor.yielding).toBe(true);
    expect(tractor.speed).toBeLessThan(0.1);
    const lines: string[] = [];
    events.on('encounter', ({ text }) => lines.push(text));
    const hello = { day: 1, hour: 10, gateOpen: false, flockExposed: false };
    const beside = { x: tractor.x + Math.cos(tractor.yaw) * 2, y: tractor.y, z: tractor.z - Math.sin(tractor.yaw) * 2 };
    expect(residents.near(beside)).toBe(tractor);
    residents.greet(tractor, hello);
    expect(residents.near(beside)).toBeUndefined();
    for (let i = 0; i < 340; i++) residents.step(SIM_DT, { ...quiet, player: beside });
    expect(tractor.action(1)).toContain('advice');
    residents.greet(tractor, hello);
    expect(lines[0]).toContain('room');
    expect(lines[1]).toContain('lookout');
    for (let i = 0; i < 560; i++) residents.step(SIM_DT, quiet);
    expect(tractor.speed).toBeGreaterThan(1);
  });

  it('rewards a quiet approach and takes off when the shepherd sprints at a bird', () => {
    const events = new EventBus();
    const life = new Wildlife(VALLEY_MAP, terrain, obstacles, events);
    const hoopoe = life.animals.find((animal) => animal.species === 'hoopoe')!;
    const player = { x: hoopoe.x + 3, y: hoopoe.y, z: hoopoe.z };
    const ctx = { player, gait: 'sneak' as const, bike: distant, bikeRunning: false, dog: distant, dogRunning: false, honking: false, hour: 8 };
    const sounds: string[] = [];
    events.on('lifeSound', ({ kind }) => sounds.push(kind));
    life.step(SIM_DT, ctx);
    expect(hoopoe.state).toBe('alert');
    expect(hoopoe.observe(player)).toBe(true);
    life.step(SIM_DT, { ...ctx, gait: 'sprint' });
    expect(hoopoe.airborne).toBe(true);
    expect(sounds).toContain('wings');
    for (let i = 0; i < 1020; i++) life.step(SIM_DT, { ...ctx, player: distant });
    expect(hoopoe.airborne).toBe(false);
    life.step(SIM_DT, { ...ctx, hour: 22 });
    expect(hoopoe.visible).toBe(false);
    expect(life.animals.some((a) => a.species === 'fox' && a.visible)).toBe(true);
  });

  it('leaves the gate interaction available even when a villager stands in reach', () => {
    const sim = new Sim(RAPIER, terrain);
    try {
      const resident = sim.residents.list[2];
      sim.teleport(sim.gatePos.x + 1.45, sim.gatePos.z);
      Object.assign(resident, { x: sim.player.pos.x + 1, y: sim.player.pos.y, z: sim.player.pos.z });
      const original = VALLEY_MAP.errands![0];
      sim.errands = new Errands([{ ...original, stops: [{ ...original.stops[0], x: sim.player.pos.x, z: sim.player.pos.z, seconds: undefined }] }]);
      sim.errands.discuss(original.resident);
      sim.errands.discuss(original.resident);
      expect(sim.residents.near(sim.player.pos)).toBe(resident);
      const encounters: string[] = [];
      sim.events.on('encounter', (event) => encounters.push(event.name));
      sim.step({ ...emptyFrame(), interact: true });
      expect(sim.gateOpen).toBe(true);
      expect(encounters).toEqual([]);
      expect(sim.errands.status(original.resident)).toBe(0);
    } finally {
      sim.world.free();
    }
  });

  it('keeps declined work optional and lets all four accepted errands pay out once', () => {
    const sim = new Sim(RAPIER, terrain);
    const tap = () => sim.step({ ...emptyFrame(), interact: true, interactHeld: true });
    const wait = (ticks: number) => { for (let i = 0; i < ticks; i++) sim.step(emptyFrame()); };
    const completeStop = (stop: NonNullable<typeof VALLEY_MAP.errands>[number]['stops'][number]) => {
      sim.teleport(stop.x, stop.z);
      if (!stop.seconds) return tap();
      for (let i = 0; i <= stop.seconds / SIM_DT + 1; i++) sim.step({ ...emptyFrame(), interactHeld: true });
    };
    try {
      sim.dog.care.pettedToday = true;
      const task = sim.tasks.task;
      const wallet = sim.economy.lira;
      sim.economy.job = { id: 'thyme' };
      for (const errand of sim.errands.definitions) {
        const resident = sim.residents.list.find((r) => r.id === errand.resident)!;
        for (const stop of errand.stops) expect(obstacles.blocked(stop.x, stop.z, 0.5), stop.place).toBe(false);
        const approach = [[0, 2], [2, 0], [0, -2], [-2, 0]].map(([x, z]) => ({ x: x + resident.x, z: z + resident.z }))
          .find(({ x, z }) => !sim.obstacles.blocked(x, z, 0.6) && resident.canTalk({ x, z, y: terrain.heightAt(x, z) }))!;
        sim.teleport(approach.x, approach.z);
        expect(sim.encounterPrompt).toContain('about an errand');
        tap();
        expect(sim.errands.status(errand.resident)).toBeUndefined();
        wait(112);
        expect(sim.encounterPrompt).toContain('accept');
        tap();
        expect(sim.errands.status(errand.resident)).toBe(0);
        const first = errand.stops[0];
        if (first.seconds) {
          sim.teleport(first.x, first.z);
          sim.step({ ...emptyFrame(), interactHeld: true });
          expect(sim.errands.fraction(first)).toBeGreaterThan(0);
          sim.step(emptyFrame());
          expect(sim.errands.fraction(first)).toBe(0);
          expect(sim.errands.status(errand.resident)).toBe(0);
        }
        for (const stop of errand.stops) completeStop(stop);
        expect(sim.errands.status(errand.resident)).toBe(errand.stops.length);
        tap();
      }
      expect(sim.tasks.task).toBe(task);
      expect(sim.economy.job).toEqual({ id: 'thyme' });
      expect(sim.economy.reputation).toBe(4);
      expect(sim.economy.lira - wallet).toBe(sim.errands.definitions.reduce((sum, e) => sum + e.reward, 0));
    } finally {
      sim.world.free();
    }
  });

  it('restores a delivery in transit and keeps unfinished errands across dawn', () => {
    const sim = new Sim(RAPIER, terrain);
    try {
      const errand = VALLEY_MAP.errands!.find((e) => e.resident === 'zeynep')!;
      sim.errands.discuss('zeynep');
      sim.errands.discuss('zeynep');
      const [pickup, drop] = errand.stops;
      sim.teleport(pickup.x, pickup.z);
      sim.step({ ...emptyFrame(), interact: true });
      expect(sim.errands.status('zeynep')).toBe(1);
      const save = snapshot(sim, { midday: true });
      sim.restore(save);
      expect(sim.errands.status('zeynep')).toBe(1);
      sim.startDay(2);
      sim.teleport(drop.x, drop.z);
      sim.step({ ...emptyFrame(), interact: true });
      expect(sim.errands.status('zeynep')).toBe(2);
      expect(sim.economy.ledger.filter((e) => e.text === errand.title)).toHaveLength(1);
    } finally {
      sim.world.free();
    }
  });
});

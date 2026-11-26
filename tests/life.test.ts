import RAPIER from '@dimforge/rapier3d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config, SIM_DT } from '../src/core/config';
import { EventBus } from '../src/core/events';
import { emptyFrame } from '../src/core/input';
import { snapshot } from '../src/core/save';
import { Errands } from '../src/life/errands';
import { Resident, Residents } from '../src/life/residents';
import { planResidentSpeech, speechMouth } from '../src/life/residentSpeech';
import { Wildlife } from '../src/life/wildlife';
import { Sim } from '../src/sim';
import { useMap } from '../src/world/map';
import { Obstacles } from '../src/world/obstacles';
import { TEST_MAP } from '../src/world/testMap';
import { VALLEY_MAP } from '../src/world/valley';
import { COFFEEHOUSE, MOSQUE } from '../src/world/villagePlan';

const terrain = VALLEY_MAP.buildTerrain();
const obstacles = new Obstacles(VALLEY_MAP.buildProps(terrain));
const routes = VALLEY_MAP.residents!.filter(route => !route.circulates);
const distant = { x: 0, y: 0, z: 0 };
const quiet = { player: distant, rider: false, playerSpeed: 0, bike: distant, dog: distant, sheep: [], hour: 10, honking: false };

beforeAll(async () => {
  await RAPIER.init();
  useMap(VALLEY_MAP);
});
afterAll(() => useMap(TEST_MAP));

describe('valley life', () => {
  it('keeps each circuit clear and reaches every scheduled stop before the next one', () => {
    const house = VALLEY_MAP.layout.house;
    for (const route of routes) {
      const resident = new Resident(route, terrain, obstacles);
      const road = resident.circuit;
      for (let s = 0; s < road.length; s += 0.25) {
        const p = road.at(s);
        expect(obstacles.blocked(p.x, p.z, resident.clearance), `${resident.id} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(false);
        expect(Math.hypot(p.x - house.x, p.z - house.z), resident.id).toBeGreaterThan(36);
      }
      let time = 0;
      for (let i = 0; i < route.stops.length; i++) {
        const stop = route.stops[i];
        const beforeNext = (route.stops[i + 1]?.hour ?? 24) - 0.1;
        const position = road.at(road.atStop(stop.point));
        let reached = false;
        for (; time < beforeNext * config.time.secondsPerHour; time += 1 / 18) {
          resident.step(1 / 18, { ...quiet, hour: time / config.time.secondsPerHour });
          if (resident.destination === stop && resident.settled) {
            reached ||= Math.hypot(resident.x - position.x, resident.z - position.z) < 0.01 && resident.speed === 0;
          }
        }
        expect(resident.destination, resident.id).toBe(stop);
        expect(reached, `${resident.id} at ${stop.place}`).toBe(true);
      }
      if (resident.driving) expect(resident.travel, resident.id).toBeCloseTo(road.length, 1);
      else expect(resident.travel, resident.id).toBeGreaterThan(road.length + 30);
    }
  });

  it('loads old village saves clear of the relocated buildings', () => {
    const sim = new Sim(RAPIER, terrain);
    const village = VALLEY_MAP.layout.village!;
    const inside = ([dx, dz]: readonly number[]) => ({ x: village.x + dx, z: village.z + dz });
    const save = snapshot(sim);
    Object.assign(save.player, inside(COFFEEHOUSE));
    Object.assign(save.bike, inside(MOSQUE));
    sim.restore(save);
    const player = sim.player.pos;
    expect(sim.obstacles.blocked(player.x, player.z, config.player.capsuleRadius)).toBe(false);
    expect(sim.obstacles.blocked(sim.bike.x, sim.bike.z, 1)).toBe(false);
    expect(Math.hypot(player.x - save.player.x, player.z - save.player.z)).toBeLessThan(7);
  });

  it('takes a short walk between work cycles and resumes work at the same spot', () => {
    const resident = new Resident(routes.find((route) => route.resident === 'ayse')!, terrain, obstacles);
    const hour = 7.88;
    resident.setTime(hour);
    const station = { x: resident.x, z: resident.z };
    const step = (seconds: number) => {
      for (let i = 0; i < seconds / SIM_DT; i++) resident.step(SIM_DT, { ...quiet, hour });
    };
    step(25);
    expect(resident.routine()).toContain('short walk');
    expect(Math.hypot(resident.x - station.x, resident.z - station.z)).toBeGreaterThan(3);
    expect(resident.workPose).toBeUndefined();
    const walking = resident.travel;
    resident.conversation = true;
    step(5);
    expect(resident.travel - walking).toBeLessThan(0.3);
    resident.conversation = false;
    step(18);
    expect(resident.workPose).toBe('sort');
    expect(Math.hypot(resident.x - station.x, resident.z - station.z)).toBeLessThan(0.01);
  });

  it('yields to traffic and resumes its route after a conversation ends', () => {
    const events = new EventBus();
    const residents = new Residents(routes, terrain, obstacles, events);
    const tractor = residents.list[0];
    for (let i = 0; i < 120; i++) residents.step(SIM_DT, quiet);
    const p = { x: tractor.x + Math.sin(tractor.yaw) * 6, z: tractor.z + Math.cos(tractor.yaw) * 6, y: tractor.y };
    for (let i = 0; i < 135; i++) residents.step(SIM_DT, { ...quiet, player: p, rider: true });
    expect(tractor.yielding).toBe(true);
    expect(tractor.speed).toBeLessThan(0.1);
    const hello = { hour: 10, gateOpen: false, flockExposed: false };
    const beside = { x: tractor.x + Math.cos(tractor.yaw) * 2, y: tractor.y, z: tractor.z - Math.sin(tractor.yaw) * 2 };
    expect(residents.near(beside)).toBe(tractor);
    expect(tractor.greeting(hello)).toContain('room');
    expect(tractor.advice(hello)).toContain('lookout');
    tractor.conversation = true;
    tractor.perform('explain', 2.5);
    for (let i = 0; i < 340; i++) residents.step(SIM_DT, quiet);
    expect(tractor.speed).toBe(0);
    expect(tractor.conversation).toBe(true);
    expect(tractor.speaking).toBe(false);
    tractor.conversation = false;
    for (let i = 0; i < 560; i++) residents.step(SIM_DT, quiet);
    expect(tractor.speed).toBeGreaterThan(1);
  });

  it('slows for a shepherd standing beside the road and continues after the brief stop', () => {
    const tractor = new Resident(routes[0], terrain, obstacles);
    for (let i = 0; i < 180; i++) tractor.step(SIM_DT, quiet);
    const player = { x: tractor.x + Math.cos(tractor.yaw) * 3.1, y: tractor.y, z: tractor.z - Math.sin(tractor.yaw) * 3.1 };
    expect(tractor.speed).toBeGreaterThan(1);
    for (let i = 0; i < 66; i++) tractor.step(SIM_DT, { ...quiet, player });
    expect(tractor.canTalk(player)).toBe(true);
    const stoppedAt = tractor.travel;
    for (let i = 0; i < 280; i++) tractor.step(SIM_DT, { ...quiet, player });
    expect(tractor.travel - stoppedAt).toBeGreaterThan(3);
  });

  it('sounds the daily work beats nearby and suspends them during a conversation', () => {
    const activities = [
      ['ayse', 8, ['oliveRustle', 'oliveDrop']], ['hasan', 11, ['broom', 'broom']],
      ['emre', 7.8, ['tractorCheck']], ['zeynep', 8, ['churn']], ['ayse', 11, ['teaSip']],
    ] as const;
    for (const [id, hour, expected] of activities) {
      const events = new EventBus();
      const residents = new Residents(routes.filter((route) => route.resident === id), terrain, obstacles, events);
      residents.setTime(hour);
      const resident = residents.list[0];
      const ctx = { ...quiet, hour, rider: true, player: { x: resident.x + 4, y: resident.y, z: resident.z } };
      const heard: string[] = [];
      events.on('workSound', (event) => {
        expect(Math.hypot(event.x - resident.x, event.z - resident.z)).toBeLessThan(1);
        heard.push(event.kind);
      });
      const step = (context = ctx) => {
        for (let i = 0; i < 3.5 / SIM_DT; i++) residents.step(SIM_DT, context);
      };
      resident.conversation = true;
      step();
      expect(heard).toEqual([]);
      expect(resident.workTime).toBe(0);
      resident.conversation = false;
      step();
      expect(heard).toEqual(expected);
      step({ ...ctx, player: distant });
      expect(heard).toEqual(expected);
    }
  });

  it('creates distinct speech rhythms and mouth cues from any dialogue text', () => {
    const text = 'Günaydın, çoban. Would you help with the olives?';
    const voices = routes.map(({ resident }) => planResidentSpeech(resident, text, 'greet'));
    expect(new Set(voices.map((voice) => Math.round(voice.syllables[0].pitch))).size).toBe(4);
    expect(new Set(voices.map((voice) => voice.duration)).size).toBe(4);
    for (const voice of voices) {
      expect(voice.syllables.length).toBeGreaterThan(10);
      expect(voice.syllables.at(-1)?.bend).toBeGreaterThan(0);
      const first = voice.syllables[0];
      expect(speechMouth(voice, first.start + first.length * 0.5)).toBeGreaterThan(0.3);
      expect(speechMouth(voice, voice.duration)).toBe(0.04);
    }
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

  it('lets village cats finish their circuits and nap, with a quiet approach leaving them asleep', () => {
    const life = new Wildlife(VALLEY_MAP, terrain, obstacles, new EventBus());
    const cats = life.animals.filter((animal) => animal.species === 'cat');
    expect(cats.map((cat) => cat.coat)).toEqual(['ginger', 'calico', 'grey']);
    const ginger = cats[0];
    const player = { x: ginger.x - 1.1, y: ginger.y, z: ginger.z };
    const ctx = { player, gait: 'sneak' as const, bike: distant, bikeRunning: false, dog: distant, dogRunning: false, honking: false, hour: 13 };
    life.step(SIM_DT, ctx);
    expect(ginger.state).toBe('sleep');
    life.step(SIM_DT, { ...ctx, gait: 'sprint' });
    expect(ginger.state).toBe('alert');

    const returned = new Set();
    for (let time = 0; time < 125; time += 0.1) {
      for (const cat of cats) {
        cat.step(0.1, { ...ctx, player: distant });
        expect(obstacles.blocked(cat.x, cat.z, 0.40), cat.coat).toBe(false);
        if (cat.state === 'sleep' && cat.travel > 5) returned.add(cat.coat);
      }
    }
    expect([...returned].sort()).toEqual(['calico', 'ginger', 'grey']);
    expect(new Wildlife(TEST_MAP, TEST_MAP.buildTerrain(), obstacles, new EventBus()).animals.some((cat) => cat.coat)).toBe(false);
  });

  it('leaves the gate interaction available even when a villager stands in reach', () => {
    const sim = new Sim(RAPIER, terrain);
    try {
      const resident = sim.residents.list[2];
      sim.teleport(sim.gatePos.x + 1.45, sim.gatePos.z);
      Object.assign(resident, { x: sim.player.pos.x + 1, y: sim.player.pos.y, z: sim.player.pos.z });
      const original = VALLEY_MAP.errands![0];
      sim.errands = new Errands([{ ...original, stops: [{ ...original.stops[0], x: sim.player.pos.x, z: sim.player.pos.z, seconds: undefined }] }]);
      sim.errands.accept(original.resident);
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
    const say = (dialogue: NonNullable<ReturnType<typeof emptyFrame>['dialogue']>) => sim.step({ ...emptyFrame(), dialogue });
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
        expect(sim.encounterPrompt).toContain('talk to');
        tap();
        expect(sim.errands.status(errand.resident)).toBeUndefined();
        say('accept');
        expect(sim.errands.status(errand.resident)).toBeUndefined();
        say('errand');
        expect(sim.dialogue?.offer).toBe(errand);
        say('leave');
        expect(sim.dialogue).toBeNull();
        expect(sim.errands.status(errand.resident)).toBeUndefined();
        tap();
        say('errand');
        tap();
        expect(sim.dialogue).toBeNull();
        expect(sim.errands.status(errand.resident)).toBeUndefined();
        tap();
        say('errand');
        say('accept');
        expect(sim.errands.status(errand.resident)).toBe(0);
        expect(sim.dialogue?.text).toContain(errand.stops[0].place);
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
        say('leave');
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
      sim.errands.accept('zeynep');
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

  it('closes stale conversations on departure and keeps the gate available while talking', () => {
    const sim = new Sim(RAPIER, terrain);
    try {
      const ayse = sim.residents.list.find((resident) => resident.id === 'ayse')!;
      sim.dog.care.pettedToday = true;
      sim.teleport(ayse.x + 1.5, ayse.z);
      sim.step({ ...emptyFrame(), interact: true });
      expect(sim.dialogue?.resident).toBe(ayse);
      sim.step({ ...emptyFrame(), dialogue: 'advice' });
      expect(sim.dialogue?.text).toContain('spring');
      expect(ayse.gesture).toBe('explain');
      sim.step({ ...emptyFrame(), dialogue: 'errand' });
      sim.teleport(sim.gatePos.x + 1.4, sim.gatePos.z);
      sim.step({ ...emptyFrame(), interact: true, dialogue: 'accept' });
      expect(sim.dialogue).toBeNull();
      expect(sim.errands.status('ayse')).toBeUndefined();
      expect(sim.gateOpen).toBe(true);
    } finally {
      sim.world.free();
    }
  });
});

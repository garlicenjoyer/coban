import RAPIER from '@dimforge/rapier3d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyFrame } from '../src/core/input';
import { snapshot, canCheckpoint } from '../src/core/save';
import { ValleySprint } from '../src/bike/valleySprint';
import { EventBus } from '../src/core/events';
import { Residents, witnessesTheft } from '../src/life/residents';
import { Obstacles } from '../src/world/obstacles';
import { Sim } from '../src/sim';
import { useMap } from '../src/world/map';
import { TEST_MAP } from '../src/world/testMap';
import { VALLEY_MAP } from '../src/world/valley';
import { initRapier } from './helpers';

const terrain = VALLEY_MAP.buildTerrain();
beforeAll(async () => { await initRapier(); useMap(VALLEY_MAP); });
afterAll(() => useMap(TEST_MAP));

describe('free roam', () => {
  it('starts by the square, stays open across midnight, and ignores legacy story progress', () => {
    const sim = new Sim(RAPIER, terrain);
    const village = VALLEY_MAP.layout.village!;
    expect(Math.hypot(sim.player.pos.x - village.x, sim.player.pos.z - village.z)).toBeLessThan(10);
    expect(sim.tasks.tasks).toEqual([]);
    expect(sim.firstNightPending).toBe(false);
    expect([...sim.errands.targets()]).toEqual([]);
    sim.hour = 23.99999;
    sim.step(emptyFrame());
    expect(sim.tasks.day).toBe(2);
    const save = snapshot(sim, { midday: true });
    save.midday!.hour = 22.35;
    save.midday!.task = 5;
    save.notesRead = ['letter', 'museum1'];
    sim.restore(save);
    expect(sim.hour).toBe(22.35);
    expect(sim.tasks.tasks).toEqual([]);
    expect([...sim.notesRead]).toEqual(['museum1']);
    expect(canCheckpoint(sim)).toBe(true);
    expect(sim.sleep()).toBe(true);
    expect(sim.tasks.tasks).toEqual([]);
  });

  it('separates a tractor from its owner, drives, parks, reloads and re-enters it', () => {
    const sim = new Sim(RAPIER, terrain);
    const bike = { x: sim.bike.x, z: sim.bike.z };
    const owner = sim.residents.list.find(r => r.id === 'zeynep')!;
    sim.teleport(owner.x + 1.6, owner.z);
    sim.step({ ...emptyFrame(), takeVehicle: true });
    const tractor = sim.drivenVehicle!;
    expect(tractor).toBe(owner.vehicle);
    expect(owner.driving).toBe(false);
    expect(sim.bike.rider).toBe(false);
    expect(sim.player.collider.isEnabled()).toBe(false);
    const start = { x: tractor.x, z: tractor.z };
    for (let i = 0; i < 75; i++) sim.step({ ...emptyFrame(), throttle: 1, steer: 0.12 });
    expect(Math.hypot(tractor.x - start.x, tractor.z - start.z)).toBeGreaterThan(2);
    expect(sim.player.pos.x).toBeCloseTo(tractor.x, 3);
    expect(sim.bike.x).toBe(bike.x);
    expect(sim.bike.z).toBe(bike.z);
    const save = snapshot(sim, { midday: true });
    sim.step({ ...emptyFrame(), interact: true });
    expect(sim.riding).toBe(false);
    expect(sim.player.collider.isEnabled()).toBe(true);
    sim.restore(save);
    expect(sim.riding).toBe(false);
    expect(sim.vehicleNear?.vehicle?.x).toBeCloseTo(tractor.x);
    sim.step({ ...emptyFrame(), takeVehicle: true });
    expect(sim.drivenVehicle?.x).toBeCloseTo(tractor.x);
  });

  it('keeps the four drivers circulating on clear lanes while the player stays at spawn', () => {
    const obstacles = new Obstacles(VALLEY_MAP.buildProps(terrain));
    const residents = new Residents(VALLEY_MAP.residents!, terrain, obstacles, new EventBus());
    residents.setTime(7);
    const player = { x: 404, y: terrain.heightAt(404, -360), z: -360 };
    const context = { player, rider: false, playerSpeed: 0, dog: { x: 402, z: -358 }, bike: { x: 407, z: -358 }, sheep: [], hour: 7, honking: false };
    const traffic = residents.list.filter(r => r.circulates);
    expect(traffic.map(r => r.vehicleKind).sort()).toEqual(['car', 'car', 'van', 'van']);
    for (let i = 0; i < 3600; i++) residents.step(1 / 30, context);
    for (const driver of traffic) {
      expect(driver.travel, driver.id).toBeGreaterThan(driver.circuit.length * 2);
      expect(driver.driving).toBe(true);
    }
    const road = traffic[0].circuit;
    for (let d = 0; d < road.length; d += 0.33) {
      const p = road.at(d);
      expect(obstacles.blocked(p.x, p.z, 1.1)).toBe(false);
    }
  });

  it.each(['deniz', 'murat'] as const)('lets the player take %s’s vehicle and triggers one witnessed theft', id => {
    const sim = new Sim(RAPIER, terrain);
    const owner = sim.residents.list.find(r => r.id === id)!;
    const witness = sim.residents.list.find(r => r.id === 'hasan')!;
    const distant = sim.residents.list.find(r => r.id === 'emre')!;
    const beside = { x: owner.x + Math.cos(owner.yaw) * 2, z: owner.z - Math.sin(owner.yaw) * 2 };
    sim.teleport(beside.x, beside.z);
    Object.assign(witness, { ...beside, y: owner.y });
    const shouts: string[] = [];
    sim.events.on('residentShout', e => shouts.push(e.resident));
    sim.step({ ...emptyFrame(), takeVehicle: true });
    expect(sim.drivenVehicle?.kind).toBe(id === 'deniz' ? 'car' : 'van');
    expect(owner.gesture).toBe('protest');
    expect(witness.gesture).toBe('startle');
    expect(distant.gesturing).toBe(false);
    expect(shouts).toEqual([id]);
    const vehicle = sim.drivenVehicle!;
    for (let i = 0; i < 65; i++) sim.step({ ...emptyFrame(), throttle: 1 });
    expect(vehicle.travel).toBeGreaterThan(1);
    sim.step({ ...emptyFrame(), interact: true });
    expect(sim.riding).toBe(false);
    sim.step({ ...emptyFrame(), takeVehicle: true });
    expect(sim.drivenVehicle).toBe(vehicle);
    expect(shouts).toEqual([id]);
    sim.restore(snapshot(sim, { midday: true }));
    expect(sim.vehicleNear?.vehicle?.x).toBeCloseTo(vehicle.x);
    expect(sim.vehicleNear?.driving).toBe(false);
  });

  it('keeps theft reactions local and blocks sight through a house', () => {
    const obstacles = new Obstacles(VALLEY_MAP.buildProps(terrain));
    const house = { x: 416, z: -391 };
    const p = (offset: number) => ({ x: house.x + offset, y: 0, z: house.z });
    expect(witnessesTheft(p(-7), p(-5.5), obstacles)).toBe(true);
    expect(witnessesTheft(p(-7), p(7), obstacles)).toBe(false);
    expect(witnessesTheft(p(-7), p(-30), obstacles)).toBe(false);
  });

  it('runs a timed sprint only on request, checks gates in order and allows retries', () => {
    const race = new ValleySprint();
    const start = race.marker;
    race.step(1, start, false);
    expect(race.running).toBe(false);
    race.step(1, start, true);
    race.step(1, start, false);
    expect(race.gate).toBe(0);
    race.step(4, race.marker, false);
    race.step(8, race.marker, false);
    expect(race.step(8, start, false)).toContain('Personal best');
    expect(race.best).toBe(21);
    race.step(1, start, true);
    expect(race.step(1, null, false)).toContain('ended');
    race.step(1, start, true);
    expect(race.step(91, race.marker, false)).toContain('ended');
    expect(race.best).toBe(21);
  });
});

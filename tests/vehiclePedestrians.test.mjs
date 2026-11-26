import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { SIM_DT } from '../src/core/config';
import { emptyFrame } from '../src/core/input';
import { Ragdolls } from '../src/life/ragdolls';
import { Resident } from '../src/life/residents';
import { RoadVehicle } from '../src/life/roadVehicle';
import { jointsOf } from '../src/life/residentRig';
import { modelPart } from '../src/render/gameModel';
import { Sim } from '../src/sim';
import { initRapier } from './helpers';

let model, sim;
beforeAll(async () => {
  await initRapier();
  const bytes = readFileSync(new URL('../public/models/valley-life.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  model = modelPart(scene, 'Hasan');
});
afterEach(() => sim.world.free());

function crossing(kind, startZ, speed, facing, routine = false) {
  sim = new Sim(RAPIER);
  const root = clone(model);
  const parent = new Group();
  parent.position.set(59, 0, 57);
  parent.rotation.y = 0.6;
  parent.add(root);
  const home = new Vector3(64, sim.terrain.heightAt(64, 60), 60);
  root.position.copy(parent.worldToLocal(home.clone()));
  root.rotation.y = facing - parent.rotation.y;
  const target = { root };
  if (routine) {
    const points = [{ x: 64, z: 60 }, { x: 64, z: 65 }, { x: 66, z: 65 }];
    const resident = new Resident({ resident: 'hasan', points, stops: [{ hour: 0, point: 0, place: '', activity: '' }] }, sim.terrain, sim.obstacles);
    sim.residents.list.push(resident);
    Object.assign(resident, home, { yaw: facing, previousYaw: facing, settled: true });
    // Keep this pedestrian on the spot before the vehicle enters his field of view.
    resident.perform('startle', 4);
    target.resident = resident;
  }
  const vehicle = new RoadVehicle({ x: 64, z: startZ, yaw: 0 }, sim.terrain, sim.obstacles, kind);
  vehicle.speed = speed;
  vehicle.occupied = true;
  sim.drivenVehicle = vehicle;
  let hits = 0;
  const falls = new Ragdolls(sim, () => [target], () => hits++);
  const step = () => {
    sim.step({ ...emptyFrame(), throttle: speed > 0 ? speed / (kind === 'van' ? 17 : 22) : 0, brake: speed < 0 ? 1 : 0 });
    if (sim.tick % 5 === 0) {
      falls.restoreAnimation();
      falls.pose();
    }
  };
  return { root, home, target, vehicle, falls, step, hits: () => hits };
}

it('jumps clear in world space, tucks the knees, lands and goes back to the same activity', () => {
  const { root, home, target, step, hits } = crossing('car', 48, 12, Math.PI);
  const knee = jointsOf(root)('Right Knee');
  let lift = 0, sideways = 0, tuck = 0;
  for (let i = 0; i < 180; i++) {
    step();
    const p = root.getWorldPosition(new Vector3());
    lift = Math.max(lift, p.y - sim.terrain.heightAt(p.x, p.z));
    sideways = Math.max(sideways, Math.abs(p.x - home.x));
    tuck = Math.max(tuck, knee.rotation.x);
  }
  expect(sim.drivenVehicle.z).toBeGreaterThan(home.z + 6);
  expect(lift).toBeGreaterThan(0.35);
  expect(sideways).toBeGreaterThan(1.5);
  expect(tuck).toBeGreaterThan(0.8);
  expect(hits()).toBe(0);
  expect(target.dodging).toBe(false);
  expect(root.getWorldPosition(new Vector3()).distanceTo(home)).toBeLessThan(0.001);
});

it.each([['car', 54, 12, 0], ['van', 64, -4, Math.PI]])('ragdolls on contact with a %s, including reverse, and recovers once', (kind, z, speed, facing) => {
  const { root, step, hits } = crossing(kind, z, speed, facing);
  for (let i = 0; i < 64; i++) step();
  expect(hits()).toBe(1);
  expect(sim.world.impulseJoints.len()).toBe(10);
  const hips = jointsOf(root)('Hips');
  expect((hips.getWorldPosition(new Vector3()).z - 60) * Math.sign(speed)).toBeGreaterThan(1);
  for (let i = 0; i < 240; i++) step();
  expect(hits()).toBe(1);
  expect(sim.world.impulseJoints.len()).toBe(0);
});

it('can catch a pedestrian who sees the van too late to finish jumping', () => {
  const { step, hits, target } = crossing('van', 56, 15, Math.PI, true);
  step();
  expect(target.resident.dodging).toBe(true);
  for (let i = 0; i < 20; i++) step();
  expect(hits()).toBe(1);
  expect(target.resident.down).toBe(true);
  for (let i = 0; i < 365; i++) step();
  expect(target.resident.dodging).toBe(false);
  expect(target.resident.down).toBe(false);
});

it('takes the other side when a wall blocks the nearer landing', () => {
  const { step, root, hits } = crossing('car', 48, 12, Math.PI);
  sim.obstacles.add({ kind: 'box', role: 'wall', x: 66, z: 60, hx: 0.6, hz: 1.4 });
  for (let i = 0; i < 60; i++) step();
  expect(root.getWorldPosition(new Vector3()).x).toBeLessThan(62.5);
  expect(hits()).toBe(0);
});

it('keeps people behind a wall at their activity and clears a jump on world reset', () => {
  const { step, target, root, home } = crossing('car', 50, 12, Math.PI);
  sim.obstacles.add({ kind: 'box', role: 'wall', x: 64, z: 56.3, hx: 4, hz: 0.14 });
  for (let i = 0; i < 60; i++) step();
  expect(target.dodging).toBeFalsy();
  sim.obstacles.byRole('wall').at(-1).enabled = false;
  sim.drivenVehicle.speed = 12;
  for (let i = 0; i < 16; i++) step();
  expect(target.dodging).toBe(true);
  sim.reset();
  expect(target.dodging).toBe(false);
  expect(root.getWorldPosition(new Vector3()).distanceTo(home)).toBeLessThan(0.001);
});

it.each([['van', 60, 0], ['car', 59, 1], ['tractor', 58, 7]])('ignores a parked or creeping vehicle and preserves tractor behaviour', (kind, z, speed) => {
  const { step, target, hits } = crossing(kind, z, speed, 0);
  for (let i = 0; i < 45; i++) step();
  expect(target.dodging).toBeFalsy();
  expect(hits()).toBe(0);
});

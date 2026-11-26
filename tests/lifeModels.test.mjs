import RAPIER from '@dimforge/rapier3d-compat';
import { Ragdolls } from '../src/life/ragdolls';
import { jointsOf } from '../src/life/residentRig';
import { Sim } from '../src/sim';
import { initRapier } from './helpers';
import { readFileSync } from 'node:fs';
import { SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { SIM_DT } from '../src/core/config';
import { EventBus } from '../src/core/events';
import { RoadVehicle, vehicleSpecs } from '../src/life/roadVehicle';
import { LifeView } from '../src/life/lifeView';
import { Residents } from '../src/life/residents';
import { VillageLifeView } from '../src/life/villageLifeView';
import { Wildlife } from '../src/life/wildlife';
import { modelPart } from '../src/render/gameModel';
import { Obstacles } from '../src/world/obstacles';
import { activeMap, useMap } from '../src/world/map';
import { VALLEY_MAP } from '../src/world/valley';
import { ValleyProps } from '../src/world/valleyProps';
import { CAFE, LAUNDRY } from '../src/world/villagePlan';

it('binds each pose to its own joints in the exported model catalogue', async () => {
  const bytes = readFileSync(new URL('../public/models/valley-life.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  const terrain = VALLEY_MAP.buildTerrain();
  const obstacles = new Obstacles(VALLEY_MAP.buildProps(terrain));
  const events = new EventBus();
  const residents = new Residents(VALLEY_MAP.residents, terrain, obstacles, events);
  const wildlife = new Wildlife(VALLEY_MAP, terrain, obstacles, events);
  const view = new LifeView(scene, (x, z) => terrain.heightAt(x, z), VALLEY_MAP.layout.village);
  view.update(residents, wildlife, 1, SIM_DT, new Vector3(-360, 40, 290), 0);
  const sortingStands = residents.list.flatMap((resident) => resident.stops).filter((stop) => stop.pose === 'sort').length;
  expect(view.root.children.length).toBe(residents.list.length + wildlife.animals.length + sortingStands);
  expect(modelPart(view.root, 'Rust Tractor').visible).toBe(true);
  expect(modelPart(view.root, 'Blue Tractor').visible).toBe(false);

  const ginger = wildlife.animals.find((animal) => animal.coat === 'ginger');
  const camera = new Vector3(ginger.x, ginger.y + 1.0, ginger.z);
  view.update(residents, wildlife, 1, SIM_DT, camera, 0);
  const cat = modelPart(view.root, 'Village Cat Ginger');
  const joint = (name) => {
    let result;
    cat.traverse((node) => { if (node.userData.name === name) result = node; });
    return result;
  };
  expect(joint('Open eyes').visible).toBe(false);
  expect(joint('Closed eyes').visible).toBe(true);
  expect(joint('Body').position.y).toBeLessThan(0.14);
  const curl = joint('Tail 2').rotation.y;
  ginger.state = 'alert';
  view.update(residents, wildlife, 1, 0.8, camera, 0);
  expect(joint('Open eyes').visible).toBe(true);
  expect(joint('Body').position.y).toBeGreaterThan(0.21);
  expect(joint('Tail 2').rotation.y).toBeLessThan(curl - 0.4);

  for (const resident of residents.list) {
    const source = modelPart(scene, resident.profile.model).getObjectByProperty('type', 'SkinnedMesh');
    const actor = modelPart(view.root, resident.profile.model);
    const skin = actor.getObjectByProperty('type', 'SkinnedMesh');
    expect(skin, resident.id).toBeInstanceOf(SkinnedMesh);
    expect(skin.skeleton, resident.id).not.toBe(source.skeleton);
    expect(skin.skeleton.bones.every((bone) => actor.getObjectById(bone.id) === bone), resident.id).toBe(true);
    expect(skin.skeleton.bones).toHaveLength(18);
    const weights = skin.geometry.getAttribute('skinWeight');
    for (let i = 0; i < weights.count; i += 31) {
      expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1, 5);
    }

    const camera = new Vector3(resident.x, resident.y, resident.z);
    const joint = (name) => skin.skeleton.bones.find((bone) => bone.userData.name === name);
    view.update(residents, wildlife, 1, SIM_DT, camera, 0);
    const restChest = joint('Chest').quaternion.clone();
    resident.perform('explain', 4);
    resident.lineAge = 0.65;
    view.update(residents, wildlife, 1, 0.12, camera, 2.05);
    expect(joint('Mouth').scale.y, resident.id).toBeGreaterThan(0.04);
    expect(joint('Chest').quaternion.angleTo(restChest), resident.id).toBeGreaterThan(0.04);

    if (!resident.driving) continue;
    view.update(residents, wildlife, 1, SIM_DT, camera, 1);
    for (const [side, x] of [['Left', -0.225], ['Right', 0.225]]) {
      const foot = skin.skeleton.bones.find((bone) => bone.userData.name === `${side} Foot`);
      const onDeck = actor.worldToLocal(foot.getWorldPosition(new Vector3()));
      const { seatX, seatY, seatZ } = vehicleSpecs[resident.vehicleKind];
      expect(onDeck.distanceTo(new Vector3(x + seatX, 0.766 + seatY, -0.225 + seatZ)), resident.id).toBeLessThan(0.02);
    }
  }
});

async function load(name) {
  const bytes = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
  return (await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')).scene;
}

it('plays the village activities, reacts to an arrival, and clears the seats after hours', async () => {
  const [life, props] = await Promise.all([load('valley-life'), load('valley-props')]);
  const village = VALLEY_MAP.layout.village;
  const terrain = VALLEY_MAP.buildTerrain();
  const view = new VillageLifeView(village, terrain, life, new ValleyProps(props));
  const actor = (name) => modelPart(view.root, name);
  const joint = (name, bone) => {
    const skin = actor(name).getObjectByProperty('type', 'SkinnedMesh');
    return skin.skeleton.bones.find((b) => b.userData.name === bone);
  };
  const x = village.x + CAFE.x - 10, z = village.z + CAFE.z;
  const player = { x, y: terrain.heightAt(x, z), z };
  const camera = new Vector3(x, player.y + 2, z);
  const calls = [];
  const sounds = { voice: () => calls.push('voice'), work: (sound) => calls.push(sound) };
  const update = (from, to, hour = 10) => {
    for (let time = from; time <= to; time += SIM_DT) view.update(hour, time, SIM_DT, player, camera, sounds);
  };

  update(0, 1);
  expect(Math.abs(joint('Ismail', 'Head').rotation.y)).toBeGreaterThan(0.4);
  expect(calls).toEqual(['voice']);
  const hand = joint('Emine', 'Right Hand').getWorldPosition(new Vector3());
  update(1 + SIM_DT, 4.5);
  expect(calls).toContain('tavla');
  expect(calls).toContain('teaSip');
  expect(joint('Emine', 'Right Hand').getWorldPosition(new Vector3()).y - hand.y).toBeGreaterThan(0.6);
  expect(actor('Nermin').visible).toBe(true);

  const corner = actor('Nermin').getWorldPosition(new Vector3());
  const onlookers = view.people.filter(person => person.root.position.distanceTo(corner) < 2);
  view.witnessTheft(corner, 4.5, new Obstacles(VALLEY_MAP.buildProps(terrain)));
  expect(onlookers).toHaveLength(2);
  expect(onlookers.every(person => person.alarmAt === 4.5)).toBe(true);
  expect(view.people.find(person => person.root === actor('Ismail')).alarmAt).toBe(-Infinity);
  update(4.5 + SIM_DT, 4.85);
  expect(joint('Nermin', 'Right Arm').rotation.x).toBeLessThan(-1);

  update(4.85 + SIM_DT, 4.95, 22);
  expect(actor('Ismail').visible).toBe(false);
  expect(actor('Emine').visible).toBe(false);
  expect(actor('Nermin').visible).toBe(false);
  const line = view.root.getObjectByName('Emine’s washing');
  expect(line.position.x).toBe(village.x + LAUNDRY.x);
  expect(line.visible).toBe(true);
});

it('knocks a visible villager into an articulated fall and restores the working skeleton', async () => {
  const bytes = readFileSync(new URL('../public/models/valley-life.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  await initRapier();
  const sim = new Sim(RAPIER);
  const root = modelPart(scene, 'Hasan');
  const origin = sim.player.pos;
  root.position.set(origin.x, origin.y, origin.z - 1.5);
  const hips = jointsOf(root)('Hips');
  const rest = hips.position.clone();
  let hits = 0;
  const ragdolls = new Ragdolls(sim, () => [{ root }], () => hits++);
  const wave = { origin, dirX: 0, dirZ: 1, halfAngle: 0.78, range: 6, tick: 0 };
  sim.events.emit('crookWave', wave);
  expect(hits).toBe(0);
  sim.events.emit('crookWave', { ...wave, dirZ: -1 });
  expect(hits).toBe(1);
  expect(sim.world.impulseJoints.len()).toBe(10);
  for (let i = 0; i < 60; i++) sim.world.step();
  sim.tick += 60;
  ragdolls.pose();
  expect(hips.position.distanceTo(rest)).toBeGreaterThan(0.5);
  ragdolls.restoreAnimation();
  sim.tick += 200;
  ragdolls.pose();
  expect(hips.position.distanceTo(rest)).toBeLessThan(0.001);
  expect(sim.world.impulseJoints.len()).toBe(0);
  sim.world.free();
});

it.each(['car', 'van'])('can physically reach each village pedestrian with a %s, even between render updates', async kind => {
  const [models, props] = await Promise.all([load('valley-life'), load('valley-props'), initRapier()]);
  const previous = activeMap();
  useMap(VALLEY_MAP);
  const sim = new Sim(RAPIER);
  try {
    const ground = (x, z) => sim.terrain.heightAt(x, z);
    const routines = new LifeView(models, ground, VALLEY_MAP.layout.village);
    routines.update(sim.residents, sim.wildlife, 1, SIM_DT, new Vector3(), 0);
    const activities = new VillageLifeView(VALLEY_MAP.layout.village, sim.terrain, models, new ValleyProps(props));
    for (const r of sim.residents.list) if (r.driving) r.releaseVehicle();
    const people = [...routines.people, ...activities.people];
    expect(people).toHaveLength(14);
    let target;
    let hits = 0;
    new Ragdolls(sim, () => [target], () => hits++);
    for (const [index, person] of people.entries()) {
      target = person;
      const p = person.resident ?? person.root.getWorldPosition(new Vector3());
      const name = person.resident?.id ?? person.root.name;
      person.root.visible = false;
      // Try a short, straight approach on each side of the actual furniture and buildings.
      for (let a = 0; a < 32 && hits === index; a++) {
        const yaw = Math.PI * 2 * a / 32, range = vehicleSpecs[kind].length + 0.55;
        const car = new RoadVehicle({ x: p.x - Math.sin(yaw) * range, z: p.z - Math.cos(yaw) * range, yaw },
          sim.terrain, sim.obstacles, kind);
        car.constrain();
        if (Math.hypot(car.x - car.px, car.z - car.pz) > 0.01) continue;
        car.speed = 8;
        for (let t = 0; t < 6 && hits === index; t++) {
          car.step(SIM_DT, { throttle: 0, steer: 0, brake: 0 });
          sim.events.emit('roadVehicleStep', { vehicle: car });
        }
      }
      expect(hits, name).toBe(index + 1);
      expect(sim.world.impulseJoints.len(), name).toBe(10 * (index + 1));
    }
  } finally {
    sim.world.free();
    useMap(previous);
  }
});

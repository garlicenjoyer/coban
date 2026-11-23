import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { StationWork } from '../src/player/stationWork';
import { modelPart } from '../src/render/gameModel';
import { initRapier, newSim } from './helpers';

let library;
beforeAll(async () => {
  await initRapier();
  const bytes = readFileSync(new URL('../public/models/valley-props.glb', import.meta.url));
  library = (await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '')).scene;
});

function setup() {
  const sim = newSim();
  const scene = new THREE.Scene();
  const stations = {
    teaTable: modelPart(library, 'Porch tea table').clone(),
    milkingStation: modelPart(library, 'Milking station').clone(),
    press: modelPart(library, 'Cheese press and shelf').clone(),
  };
  stations.teaTable.position.set(0, 0, 0);
  scene.add(...Object.values(stations));
  const work = new StationWork(sim, stations, scene);
  const root = new THREE.Group();
  scene.add(root);
  return { sim, work, stations, root };
}

it('restores the porch kettle and stages a field tea kit on an immediate repeat', () => {
  const { sim, root, stations, work } = setup();
  const kettle = modelPart(stations.teaTable, 'Tea kettle');
  const atRest = kettle.position.clone();
  const dt = 1 / 60;
  const frame = (x, z) => {
    root.position.set(x, 0, z);
    root.rotation.set(0, 0, 0);
    work.update(root, dt, 0, true);
  };
  sim.brewing = config.satchel.caySeconds * 0.61;
  for (let i = 0; i < 30; i++) frame(0, -0.8);
  expect(kettle.rotation.z).toBeLessThan(-0.65);

  sim.brewing = 0;
  frame(0, -0.8);
  sim.brewing = config.satchel.caySeconds * 0.61;
  for (let i = 0; i < 30; i++) frame(15, -8);
  expect(work.portable.visible).toBe(true);
  expect(new THREE.Vector3(1, 0, 0).applyQuaternion(work.fieldKettle.quaternion).y).toBeLessThan(-0.60);
  expect(kettle.position.distanceTo(atRest)).toBeLessThan(0.0001);
});

it('turns and lowers the spindle during pressing, then resets when interrupted', () => {
  const { sim, root, stations, work } = setup();
  const spindle = modelPart(stations.press, 'Press spindle');
  sim.pressingNow = true;
  sim.pressProgress = 0.7;
  for (let i = 0; i < 40; i++) work.update(root, 1 / 60, 0, true);
  expect(spindle.rotation.y).toBeGreaterThan(3 * Math.PI);
  expect(spindle.position.y).toBeLessThan(-0.05);
  work.update(root, 1 / 60, 0, false);
  expect(spindle.rotation.y).toBe(0);
  expect(spindle.position.y).toBe(0);
});

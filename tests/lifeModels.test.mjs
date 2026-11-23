import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { SIM_DT } from '../src/core/config';
import { EventBus } from '../src/core/events';
import { LifeView } from '../src/life/lifeView';
import { Residents } from '../src/life/residents';
import { Wildlife } from '../src/life/wildlife';
import { modelPart } from '../src/render/gameModel';
import { Obstacles } from '../src/world/obstacles';
import { VALLEY_MAP } from '../src/world/valley';

it('binds each pose to its own joints in the exported model catalogue', async () => {
  const bytes = readFileSync(new URL('../public/models/valley-life.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  const terrain = VALLEY_MAP.buildTerrain();
  const obstacles = new Obstacles(VALLEY_MAP.buildProps(terrain));
  const events = new EventBus();
  const residents = new Residents(VALLEY_MAP.residents, terrain, obstacles, events);
  const wildlife = new Wildlife(VALLEY_MAP, terrain, obstacles, events);
  const view = new LifeView(scene, (x, z) => terrain.heightAt(x, z));
  view.update(residents, wildlife, 1, SIM_DT, new Vector3(-360, 40, 290), 0);
  expect(view.root.children.length).toBe(residents.list.length + wildlife.animals.length + 2);
  expect(modelPart(view.root, 'Rust Tractor').visible).toBe(true);
  expect(modelPart(view.root, 'Blue Tractor').visible).toBe(false);
});

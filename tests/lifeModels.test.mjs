import { readFileSync } from 'node:fs';
import { SkinnedMesh, Vector3 } from 'three';
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

    if (!resident.tractor) continue;
    view.update(residents, wildlife, 1, SIM_DT, camera, 1);
    for (const [side, x] of [['Left', -0.225], ['Right', 0.225]]) {
      const foot = skin.skeleton.bones.find((bone) => bone.userData.name === `${side} Foot`);
      const onDeck = actor.worldToLocal(foot.getWorldPosition(new Vector3()));
      expect(onDeck.distanceTo(new Vector3(x, 0.766, -0.225)), resident.id).toBeLessThan(0.02);
    }
  }
});

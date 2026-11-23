import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { modelPart } from '../src/render/gameModel';
import { QuadrupedGait } from '../src/render/quadrupedGait';
import { SheepPose } from '../src/flock/sheepPose';
import { createSheep, Mode, Personality } from '../src/flock/sheep';

async function loadModel(asset) {
  const bytes = readFileSync(new URL(`../public/models/${asset}.glb`, import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
  return scene;
}

describe.each([
  ['karabas', 'Body', 1, 0.06],
  ['anatolian-wolf', 'Body', 1, 0.06],
  ['aegean-sheep', 'Wool', 0.69, 0.049],
])('%s foot placement', (asset, torso, strideScale, drop) => {
  it('plants paws through stance and lifts them in a four-beat walk', async () => {
    const scene = await loadModel(asset);
    const body = modelPart(scene, torso);
    const ground = (x, z) => x * 0.05 + z * 0.08;
    const gait = new QuadrupedGait(scene, body, ground, strideScale);
    body.position.y -= drop;

    const position = new Vector3();
    const previous = Array.from({ length: 4 }, () => new Vector3());
    const swing = Array(4).fill(false);
    const peakLift = Array(4).fill(0);
    const touchdown = [];
    let worstSlip = 0;
    let groundedSamples = 0;
    for (let frame = 0; frame < 170; frame++) {
      const z = -1.6 * frame / 60;
      scene.position.set(0, ground(0, z), z);
      gait.advance(1 / 60);
      body.rotation.set(gait.groundPitch, 0, gait.groundRoll);
      gait.pose();
      for (const [i, leg] of gait.legs.entries()) {
        leg.paw.getWorldPosition(position);
        if (frame > 38) {
          if (swing[i] && !leg.swinging) touchdown.push(i);
          if (leg.swinging) peakLift[i] = Math.max(peakLift[i], position.y + leg.sole - ground(position.x, position.z));
          if (!leg.swinging && !swing[i]) {
            worstSlip = Math.max(worstSlip, position.distanceTo(previous[i]));
            if (Math.abs(position.y + leg.sole - ground(position.x, position.z)) < 0.014) groundedSamples++;
          }
        }
        swing[i] = leg.swinging;
        previous[i].copy(position);
      }
    }

    const order = [2, 0, 3, 1];
    expect(touchdown.length).toBeGreaterThan(8);
    for (let i = 1; i < touchdown.length; i++) {
      expect(touchdown[i]).toBe(order[(order.indexOf(touchdown[i - 1]) + 1) % order.length]);
    }
    expect(Math.min(...peakLift)).toBeGreaterThan(0.04 * strideScale);
    expect(worstSlip).toBeLessThan(0.014);
    expect(groundedSamples).toBeGreaterThan(230);
  });
});


it('grazes at grass height, chews, and raises the head when moving off', async () => {
  const scene = await loadModel('aegean-sheep');
  const ground = (x, z) => x * 0.05 + z * 0.08;
  const pose = new SheepPose(scene, ground);
  const sheep = createSheep(3, Personality.Steady, 0, 0, 0, Math.PI);
  pose.root.scale.set(0.79, 0.74, 0.77);
  sheep.mode = Mode.Graze;
  const muzzle = modelPart(pose.root, 'Muzzle point');
  const jaw = modelPart(pose.root, 'Jaw pivot');
  const position = new Vector3();
  const jawAngles = [];
  let highestBite = 0;
  let lowestBite = Infinity;
  for (let frame = 0; frame < 160; frame++) {
    pose.update(sheep, 1, 1 / 60);
    if (frame > 59) {
      muzzle.getWorldPosition(position);
      const aboveGround = position.y - ground(position.x, position.z);
      highestBite = Math.max(highestBite, aboveGround);
      lowestBite = Math.min(lowestBite, aboveGround);
      jawAngles.push(jaw.rotation.x);
    }
  }
  expect(lowestBite).toBeGreaterThan(0.015);
  expect(highestBite).toBeLessThan(0.095);
  expect(Math.max(...jawAngles) - Math.min(...jawAngles)).toBeGreaterThan(0.06);

  sheep.eating = false;
  for (let i = 0; i < 30; i++) {
    sheep.pz = sheep.z;
    sheep.z -= 1.6 / 60;
    sheep.py = sheep.y;
    sheep.y = ground(0, sheep.z);
    pose.update(sheep, 1, 1 / 60);
  }
  muzzle.getWorldPosition(position);
  expect(position.y - ground(position.x, position.z)).toBeGreaterThan(0.35);
});

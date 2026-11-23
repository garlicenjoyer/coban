import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, expect, it } from 'vitest';
import { modelMesh, modelPart } from '../src/render/gameModel';
import { HalterRope } from '../src/world/halterRope';

let library;
beforeAll(async () => {
  const bytes = readFileSync(new URL('../public/models/field-props.glb', import.meta.url));
  library = (await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '')).scene;
});

it('keeps independently hideable flowering tips on each loaded herb', () => {
  for (const name of ['Wild thyme', 'Wild sage', 'Mountain tea']) {
    const patch = modelPart(library, name);
    const foliage = modelMesh(patch, name + ' foliage');
    const tips = modelMesh(patch, name + ' flowering tips');
    expect(foliage.parent).toBe(patch);
    expect(tips.parent).toBe(patch);
    expect(tips.geometry.getAttribute('color').count).toBeGreaterThan(0);
  }
});

it('exports a solid stone face beneath the fragment’s inscription', () => {
  const piece = modelPart(library, 'Inscribed fragment').clone();
  piece.position.set(0, 0, 0);
  piece.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 0.09), new THREE.Vector3(0, -1, 0));
  const [face] = ray.intersectObject(piece);
  expect(face?.point.y).toBeCloseTo(0.063, 3);
});

it('drapes the rope in three dimensions while keeping its ends at the grip and halter', () => {
  const rope = new HalterRope(library);
  const grip = new THREE.Vector3(4, 1.9, 0.8);
  const halter = new THREE.Vector3(5.6, 1.52, 1.3);
  const rest = modelMesh(library, 'Braided line').geometry.getAttribute('position');
  const bent = rope.mesh.geometry.getAttribute('position');
  const world = new THREE.Vector3();
  rope.update(grip, halter);
  for (const [t, target] of [[0, grip], [0.5, grip.clone().lerp(halter, 0.5).add(new THREE.Vector3(0, -0.28, 0))], [1, halter]]) {
    const i = Array.from({ length: rest.count }, (_, j) => j).find(j => Math.abs(rest.getY(j) - t) < 1e-5);
    world.fromBufferAttribute(bent, i).add(rope.mesh.position);
    expect(world.distanceTo(target)).toBeLessThan(0.015);
  }
});

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, expect, it, vi } from 'vitest';
import { ShepherdRig } from '../src/player/shepherdRig';
import type { RiderPose } from '../src/player/motorcycleRider';
import type { Gait } from '../src/player/controller';
import { initRapier, newSim } from './helpers';

beforeAll(initRapier);

const { process } = globalThis as typeof globalThis & {
  process: {
    getBuiltinModule(name: 'node:fs/promises'): { readFile(url: URL): Promise<Uint8Array<ArrayBuffer>> };
  };
};

it('keeps the cape attached and clear of the body cores through motion, mounting and reset', async () => {
  const { readFile } = process.getBuiltinModule('node:fs/promises');
  const file = await readFile(new URL('../public/models/turkish-shepherd.glb', import.meta.url));
  const { buffer, byteOffset, byteLength } = file;
  const asset = await new GLTFLoader().parseAsync(buffer.slice(byteOffset, byteOffset + byteLength), '');
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValueOnce(asset);
  const shepherd = await ShepherdRig.load('test-shepherd.glb').finally(() => load.mockRestore());

  const root = new THREE.Group();
  const grips = [new THREE.Object3D(), new THREE.Object3D()];
  grips[0].position.set(-0.27, 0.9, -0.52);
  grips[1].position.set(0.27, 0.9, -0.52);
  root.add(shepherd.model, ...grips);
  const cape = shepherd.model.getObjectByName('Simulated cape') as THREE.Mesh;
  const { bones, boneInverses } = (cape.parent as THREE.SkinnedMesh).skeleton;
  const positions = cape.geometry.attributes.position;
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  const near = new THREE.Vector3();
  const limb = new THREE.Line3();
  const inverseBone = new THREE.Matrix4();
  const sim = newSim();
  const dt = 1 / 60;
  const pose = (gait: Gait, speed: number, ride = 0, fall = 0) => {
    root.updateMatrixWorld(true);
    const rider: RiderPose | undefined = ride ? {
      seat: ride, grips, hands: [ride, ride], feet: [ride, ride],
      boots: [new THREE.Vector3(-0.23, 0.47, -0.16), new THREE.Vector3(0.23, 0.47, -0.16)],
      bootPitch: [0.18, 0.18], lean: 0, dab: 0, kick: 0, legSwing: [0, 0], look: 0, headRoll: 0, weightShift: 0,
    } : undefined;
    const impact = fall ? { kind: 'crash' as const, strength: fall, impact: fall, kneel: 0, side: 1, brace: new THREE.Vector3(0.37, 0.05, -0.32) } : undefined;
    shepherd.update(dt, gait, speed, true, undefined, undefined, sim.bike, rider, impact, false);
  };

  const checkClearance = () => {
    let minimum = Infinity;
    for (const side of ['L', 'R']) {
      for (const [start, end] of [['thigh', 'shin'], ['shin', 'foot'], ['upper_arm', 'forearm'], ['forearm', 'hand']]) {
        shepherd.model.getObjectByName(start + side)!.getWorldPosition(limb.start);
        shepherd.model.getObjectByName(end + side)!.getWorldPosition(limb.end);
        for (let i = 0; i < positions.count; i++) {
          world.fromBufferAttribute(positions, i).applyMatrix4(cape.matrixWorld);
          minimum = Math.min(minimum, limb.closestPointToPoint(world, true, near).distanceTo(world));
        }
      }
    }
    expect(minimum).toBeGreaterThan(0.059);
    for (const [name, height] of [['pelvis', 0.87], ['spine', 1.09], ['chest', 1.27]] as const) {
      const joint = bones.findIndex((bone) => bone.name === name);
      inverseBone.multiplyMatrices(bones[joint].matrixWorld, boneInverses[joint]).invert();
      let nearest = Infinity;
      for (let i = 0; i < positions.count; i++) {
        local.fromBufferAttribute(positions, i).applyMatrix4(cape.matrixWorld).applyMatrix4(inverseBone);
        const squaredRadius = (local.x / 0.175) ** 2 + ((local.y - height) / 0.18) ** 2 + (local.z / 0.115) ** 2;
        nearest = Math.min(nearest, squaredRadius);
      }
      expect(nearest).toBeGreaterThan(1);
    }
  };

  for (let i = 0; i < 25; i++) pose('idle', 0);
  const hem = Array.from({ length: positions.count }, (_, i) => i).filter((i) => positions.getY(i) < 0.55);
  expect(hem.length).toBeGreaterThan(0);
  const trailingEdge = () => hem.reduce((sum, i) => sum + positions.getZ(i), 0) / hem.length;
  const standing = trailingEdge();

  for (let i = 0; i < 50; i++) {
    root.position.z -= 4.5 * dt;
    pose('sprint', 4.5);
    if (i % 10 === 0) checkClearance();
  }
  expect(trailingEdge()).toBeLessThan(standing - 0.08);

  for (let i = 0; i < 18; i++) {
    root.rotation.y += Math.PI / 18;
    pose('sneak', 0.8);
    if (i % 5 === 0) checkClearance();
  }
  for (let i = 0; i < 15; i++) pose('idle', 0, (i + 1) / 15);
  checkClearance();
  sim.bike.fallSide = 1;
  pose('idle', 0, 0, 0.85);
  checkClearance();

  root.position.set(100, 8, -60);
  shepherd.reset();
  pose('idle', 0);
  let extent = 0;
  for (let i = 0; i < positions.count; i++) extent = Math.max(extent, local.fromBufferAttribute(positions, i).length());
  expect(extent).toBeLessThan(2);
  checkClearance();
}, 15_000);

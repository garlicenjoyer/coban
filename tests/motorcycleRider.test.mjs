import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeView } from '../src/bike/bikeView';
import { MotorcycleRider } from '../src/player/motorcycleRider';
import { ShepherdRig } from '../src/player/shepherdRig';
import { initRapier, newSim } from './helpers';

beforeAll(initRapier);

async function model(name) {
  const bytes = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
  return new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
}

describe.each([-1, 1])('rider on side %s', (side) => {
  it('swings the outside boot over the saddle and keeps contact while cornering', async () => {
    const [motorcycle, shepherd] = await Promise.all([model('field-motorcycle'), model('turkish-shepherd')]);
    const bike = newSim().bike;
    bike.x = bike.px = bike.y = bike.py = bike.z = bike.pz = 0;
    bike.heading = bike.prevHeading = Math.PI;
    bike.state = 'riding';
    bike.footDown = 1;
    const view = new BikeView(() => bike, motorcycle.scene);
    const rider = new MotorcycleRider(view, () => 0);
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValueOnce(shepherd);
    const rig = await ShepherdRig.load('shepherd').finally(() => load.mockRestore());
    const root = new THREE.Group();
    root.add(rig.model);
    const endpoint = new THREE.Vector3(side * 1.3, 0, 0.24);
    const point = new THREE.Vector3();
    const anchor = new THREE.Vector3();
    const dt = 1 / 60;
    const near = side === -1 ? 0 : 1;
    const far = 1 - near;

    const update = (riding) => {
      root.position.copy(endpoint);
      root.rotation.set(0, 0, 0);
      view.update(1, dt);
      const pose = rider.update(root, bike, dt, riding, 0, 0);
      rig.update(dt, 'idle', 0, true, undefined, undefined, bike, pose, undefined, false);
      return pose;
    };
    const error = (bone, object) => rig.model.getObjectByName(bone).getWorldPosition(point)
      .distanceTo(object.getWorldPosition(anchor));

    rider.start(true, endpoint, 0, bike);
    let maximum = 0;
    let braced = false;
    for (let i = 0; i < 74; i++) {
      const pose = update(true);
      if (pose.hands[near] > 0.98 && pose.hands[far] < 0.12) braced = true;
      const ankleY = rig.model.getObjectByName(far === 0 ? 'footL' : 'footR').getWorldPosition(point).y;
      maximum = Math.max(maximum, ankleY);
    }
    expect(braced).toBe(true);
    expect(maximum).toBeGreaterThan(0.89);
    expect(root.position.x).toBeCloseTo(0, 3);
    expect(error('handL', view.grips[0])).toBeLessThan(0.03);
    expect(error('handR', view.grips[1])).toBeLessThan(0.03);
    expect(error(far === 0 ? 'footL' : 'footR', view.pegs[far])).toBeLessThan(0.03);

    bike.footDown = 0;
    bike.u = 10;
    bike.lean = bike.prevLean = side * 0.43;
    bike.steerAngle = -side * 0.19;
    let turn;
    for (let i = 0; i < 32; i++) turn = update(true);
    expect(turn.lean * side).toBeGreaterThan(0.45);
    expect(turn.look * side).toBeGreaterThan(0.15);
    expect(error('handL', view.grips[0])).toBeLessThan(0.055);
    expect(error('handR', view.grips[1])).toBeLessThan(0.055);
    expect(error('footL', view.pegs[0])).toBeLessThan(0.025);
    expect(error('footR', view.pegs[1])).toBeLessThan(0.025);

    bike.u = 0;
    bike.footDown = 1;
    bike.lean = bike.prevLean = 0;
    bike.steerAngle = 0;
    bike.state = 'parked';
    rider.start(false, endpoint, 0, bike);
    maximum = 0;
    for (let i = 0; i < 68; i++) {
      update(false);
      maximum = Math.max(maximum, rig.model.getObjectByName(far === 0 ? 'footL' : 'footR').getWorldPosition(point).y);
    }
    expect(maximum).toBeGreaterThan(0.89);
    expect(root.position.distanceTo(endpoint)).toBeLessThan(0.001);
    expect(update(false)).toBeUndefined();
  });
});

it.each([-1, 1])('drives the pedal, crashes to side %s, and follows the held lift', async (side) => {
  const { MotorcycleIncident } = await import('../src/player/motorcycleIncident');
  const [motorcycle, shepherd] = await Promise.all([model('field-motorcycle'), model('turkish-shepherd')]);
  const bike = newSim().bike;
  bike.x = bike.px = bike.y = bike.py = bike.z = bike.pz = 0;
  bike.heading = bike.prevHeading = Math.PI;
  bike.state = 'riding';
  bike.footDown = 1;
  const view = new BikeView(() => bike, motorcycle.scene);
  const motion = new MotorcycleRider(view, () => 0);
  const incident = new MotorcycleIncident(view, () => 0);
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValueOnce(shepherd);
  const rig = await ShepherdRig.load('shepherd').finally(() => load.mockRestore());
  const body = new THREE.Group();
  body.add(rig.model);
  const dt = 1 / 60;
  const onFoot = new THREE.Vector3(side * 1.3, 0, 0);
  const point = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const update = (riding, kick = 0) => {
    body.position.copy(onFoot);
    body.quaternion.identity();
    view.update(1, dt);
    view.setKick(kick);
    const pose = motion.update(body, bike, dt, riding, incident.crashSeat, 0, kick);
    const impact = incident.update(body, onFoot, 0, bike, dt);
    rig.update(dt, 'idle', 0, true, undefined, undefined, bike, pose, impact, false);
    return impact;
  };

  for (let i = 0; i < 24; i++) update(true);
  update(true, 0.31);
  const start = rig.model.getObjectByName('footR').getWorldPosition(point).y;
  update(true, 0.57);
  const finish = rig.model.getObjectByName('footR').getWorldPosition(point).y;
  view.kickPedal.getWorldPosition(anchor);
  expect(start - finish).toBeGreaterThan(0.17);
  expect(point.distanceTo(anchor.add(new THREE.Vector3(0, 0.145, 0)))).toBeLessThan(0.06);

  bike.u = 8;
  bike.fallSide = side;
  incident.fall(body, bike);
  incident.landAt(onFoot);
  bike.state = 'fallen';
  bike.lean = bike.prevLean = side * 1.42;
  let sideways = 0;
  let away = 0;
  for (let i = 0; i < 90; i++) {
    update(false);
    axis.set(0, 1, 0).applyQuaternion(body.quaternion);
    sideways = Math.max(sideways, Math.abs(axis.x));
    away = Math.max(away, side * body.position.x);
  }
  expect(sideways).toBeGreaterThan(0.8);
  expect(away).toBeGreaterThan(0.8);
  expect(body.position.distanceTo(onFoot)).toBeLessThan(0.002);

  onFoot.x = 1.3; // Approach the bike from either its high side or its low side.
  for (let i = 0; i < 57; i++) {
    bike.liftProgress = i * dt;
    update(false);
  }
  expect(Math.abs(view.root.rotation.z)).toBeLessThan(1.0);
  expect(bike.state).toBe('fallen');
  bike.liftProgress = 0;
  for (let i = 0; i < 40; i++) update(false);
  expect(view.root.rotation.z).toBeCloseTo(side * 1.42, 4);

  let bestGrip = Infinity;
  let gripError = 0;
  let samples = 0;
  for (let i = 0; i < 90; i++) {
    bike.liftProgress = i * dt;
    const lift = update(false);
    if (lift?.kind !== 'lift' || lift.grip < 0.99) continue;
    const left = rig.model.getObjectByName('handL').getWorldPosition(point).distanceTo(lift.hands[0]);
    const right = rig.model.getObjectByName('handR').getWorldPosition(point).distanceTo(lift.hands[1]);
    bestGrip = Math.min(bestGrip, Math.max(left, right));
    gripError += Math.max(left, right);
    samples++;
  }
  expect(bestGrip).toBeLessThan(0.055);
  expect(gripError / samples).toBeLessThan(0.10);
  bike.lift();
  for (let i = 0; i < 25; i++) update(false);
  expect(view.liftPhase).toBe(0);
  expect(body.position.distanceTo(onFoot)).toBeLessThan(0.002);
});

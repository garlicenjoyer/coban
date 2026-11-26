import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { GameEvents } from '../core/events';
import { SIM_DT } from '../core/config';
import type { Sim } from '../sim';
import { jointsOf } from './residentRig';
import { VehiclePedestrians, type PedestrianTarget } from './vehiclePedestrians';

const segments: [string, string | undefined, number, number][] = [
  ['Hips', undefined, 0.14, 0.09], ['Chest', 'Hips', 0.16, 0.14], ['Head', 'Chest', 0.11, 0.11],
];
for (const side of ['Left', 'Right']) {
  segments.push([`${side} Arm`, 'Chest', 0.07, -0.12], [`${side} Elbow`, `${side} Arm`, 0.058, -0.12],
    [`${side} Leg`, 'Hips', 0.09, -0.19], [`${side} Knee`, `${side} Leg`, 0.07, -0.19]);
}

interface Link {
  bone: THREE.Object3D;
  body: RAPIER.RigidBody;
  localRotation: THREE.Quaternion;
  localPosition: THREE.Vector3;
}

interface Fall { links: Link[]; until: number; target: PedestrianTarget }

/** The actual character skeleton follows jointed Rapier bodies until the get-up blend finishes. */
export class Ragdolls {
  private pedestrians: VehiclePedestrians;
  private falls = new Map<THREE.Object3D, Fall>();

  constructor(private sim: Sim, private targets: () => PedestrianTarget[], private impact: (at: THREE.Vector3) => void) {
    this.pedestrians = new VehiclePedestrians(sim, targets, target => this.falls.has(target.root) || !!target.resident?.down,
      (target, dx, dz, speed) => this.strike(target, target.root.getWorldPosition(new THREE.Vector3()), dx, dz,
        Math.min(13, 2.5 + speed * 0.62), Math.min(5.6, 1.7 + speed * 0.21)));
    sim.events.on('roadVehicleStep', ({ vehicle }) => this.pedestrians.step(vehicle));
    sim.events.on('slept', () => this.pedestrians.reset());
    sim.events.on('crookWave', wave => this.swing(wave));
    // Reset replaces the entire Rapier world, including all transient bodies.
    sim.events.on('simReset', () => { this.restoreAnimation(); this.pedestrians.reset(); this.falls.clear(); });
  }

  private swing(wave: GameEvents['crookWave']): void {
    for (const target of this.targets()) {
      let visible = true;
      target.root.traverseAncestors(node => { if (!node.visible) visible = false; });
      if (!visible || !target.root.visible) continue;
      const fall = this.falls.get(target.root);
      const at = fall ? new THREE.Vector3().copy(fall.links[0].body.translation())
        : jointsOf(target.root)('Hips').getWorldPosition(new THREE.Vector3());
      const dx = at.x - wave.origin.x, dz = at.z - wave.origin.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 2.35 || Math.abs(at.y - wave.origin.y - 0.85) > 1.25
        || (distance > 0.32 && dx * wave.dirX + dz * wave.dirZ < distance * Math.cos(wave.halfAngle))) continue;
      if ([0.25, 0.5, 0.75].some(t => this.sim.obstacles.blocked(wave.origin.x + dx * t, wave.origin.z + dz * t, 0.05))) continue;
      this.strike(target, at, wave.dirX, wave.dirZ, 6.3, 2.7);
    }
  }

  private strike(target: PedestrianTarget, at: THREE.Vector3, dx: number, dz: number, strength: number, lift: number): void {
    const hit = this.falls.get(target.root) ?? this.create(target);
    this.pedestrians.interrupt(target);
    hit.until = this.sim.tick + Math.round(3.4 / SIM_DT);
    hit.links.forEach(({ body }, i) => {
      const v = body.linvel();
      const kick = strength * (i === 1 ? 1 : 0.45);
      body.setLinvel({ x: v.x * 0.35 + dx * kick, y: lift + (i === 1 ? 1.5 : 0), z: v.z * 0.35 + dz * kick }, true);
    });
    hit.links[1].body.setAngvel({ x: dz * 4, y: 1.3, z: -dx * 4 }, true);
    this.impact(at);
  }

  private create(target: PedestrianTarget): Fall {
    const joint = jointsOf(target.root);
    const bodies = new Map<string, RAPIER.RigidBody>();
    const links: Link[] = [];
    for (const [name, parentName, radius, center] of segments) {
      const bone = joint(name);
      const origin = bone.getWorldPosition(new THREE.Vector3());
      const rotation = bone.getWorldQuaternion(new THREE.Quaternion());
      const body = this.sim.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z).setRotation(rotation).setAngularDamping(1.9).setLinearDamping(0.48));
      const shape = RAPIER.ColliderDesc.capsule(Math.max(0.01, Math.abs(center) - radius * 0.5), radius)
        .setTranslation(0, center, 0).setMass(name === 'Chest' ? 5 : 1.5).setFriction(0.88).setCollisionGroups(0x00020001);
      this.sim.world.createCollider(shape, body);
      if (parentName) {
        const parent = bodies.get(parentName)!;
        const anchor = origin.clone().sub(parent.translation()).applyQuaternion(new THREE.Quaternion().copy(parent.rotation()).invert());
        this.sim.world.createImpulseJoint(RAPIER.JointData.spherical(anchor, { x: 0, y: 0, z: 0 }), parent, body, true);
      }
      bodies.set(name, body);
      links.push({ bone, body, localRotation: bone.quaternion.clone(), localPosition: bone.position.clone() });
    }
    if (target.resident) {
      target.resident.down = true;
      target.resident.speed = 0;
    }
    const fall = { links, until: 0, target };
    this.falls.set(target.root, fall);
    return fall;
  }

  /** Let the normal locomotion, work poses and IK run from their own pose every frame. */
  restoreAnimation(): void {
    this.pedestrians.restoreAnimation();
    for (const { links } of this.falls.values()) for (const link of links) {
      link.bone.position.copy(link.localPosition);
      link.bone.quaternion.copy(link.localRotation);
    }
  }

  pose(): void {
    this.pedestrians.pose();
    for (const [root, { links, until, target }] of this.falls) {
      const weight = THREE.MathUtils.smoothstep((until - this.sim.tick) * SIM_DT, 0, 0.55);
      if (weight === 0) {
        for (const { body } of links) this.sim.world.removeRigidBody(body);
        if (target.resident) target.resident.down = false;
        this.falls.delete(root);
        continue;
      }
      links.forEach(({ bone, body, localPosition, localRotation }, index) => {
        localPosition.copy(bone.position);
        localRotation.copy(bone.quaternion);
        const parent = bone.parent!;
        if (index === 0) bone.position.lerp(parent.worldToLocal(new THREE.Vector3().copy(body.translation())), weight);
        const relative = parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().copy(body.rotation()));
        bone.quaternion.slerp(relative, weight);
      });
    }
  }
}

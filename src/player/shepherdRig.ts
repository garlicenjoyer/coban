import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { config } from '../core/config';
import type { Bike } from '../bike/bike';
import type { DogCommand } from '../dog/commands';
import { toonMaterial } from '../render/toon';
import type { Gait } from './controller';
import { CapeCloth } from './capeCloth';
import { ShepherdFootwork } from './shepherdFootwork';
import type { RiderPose } from './motorcycleRider';
import type { BikeBodyPose } from './motorcycleIncident';
import type { StationPose } from './stationWork';

const TAU = Math.PI * 2;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const xAxis = v(1);
const yAxis = v(0, 1);
const zAxis = v(0, 0, 1);
const { clamp, lerp, smoothstep } = THREE.MathUtils;

type Side = 'L' | 'R';
export type ShepherdCue = DogCommand | 'crook' | 'call' | 'whistle' | 'pet' | 'gate' | 'horn';
interface Limb {
  upper: THREE.Bone;
  lower: THREE.Bone;
  end: THREE.Bone;
  restEnd: THREE.Vector3;
  restRotation: THREE.Quaternion;
}

const arm = (side: Side) => [`upper_arm${side}`, `forearm${side}`, `hand${side}`] as const;
const leg = (side: Side) => [`thigh${side}`, `shin${side}`, `foot${side}`] as const;

export class ShepherdRig {
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly bones: Map<string, THREE.Bone>;
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly modelRotation = new THREE.Quaternion();
  private readonly modelInverse = new THREE.Matrix4();
  private readonly basePose: { bone: THREE.Bone; position: THREE.Vector3; rotation: THREE.Quaternion }[];
  private readonly footwork: ShepherdFootwork;
  private elapsed = 0;
  private pace = 0;
  private crouch = 0;
  private sprint = 0;
  private reach = 0;

  private constructor(
    readonly model: THREE.Group,
    clips: THREE.AnimationClip[],
    private readonly staff: THREE.Material,
    private readonly cape: CapeCloth,
    bones: THREE.Bone[],
  ) {
    this.basePose = bones.map((bone) => ({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone() }));
    this.bones = new Map(bones.map((bone) => [bone.name, bone]));
    model.updateMatrixWorld(true);
    const limb = ([a, b, c]: readonly string[]): Limb => {
      const end = this.bone(c);
      return {
        upper: this.bone(a), lower: this.bone(b), end,
        restEnd: end.getWorldPosition(v()),
        restRotation: end.getWorldQuaternion(new THREE.Quaternion()),
      };
    };
    this.armL = limb(arm('L'));
    this.armR = limb(arm('R'));
    this.legL = limb(leg('L'));
    this.legR = limb(leg('R'));
    this.footwork = new ShepherdFootwork(this.legL.restEnd, this.legR.restEnd);
    this.mixer = new THREE.AnimationMixer(model);
    const play = (name: string) => {
      const clip = THREE.AnimationClip.findByName(clips, name)!;
      const tracks = clip.tracks.filter((track) => !track.name.startsWith('cape'));
      return this.mixer.clipAction(new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode)).play();
    };
    this.idle = play('Idle');
    this.walk = play('Walk');
    // The asset faces +Z, while the player and the bike face -Z.
    model.rotation.y = Math.PI;
  }

  static async load(url: string): Promise<ShepherdRig> {
    const { scene, animations } = await new GLTFLoader().loadAsync(url);
    let skin: THREE.SkinnedMesh | undefined;
    scene.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) skin = o;
    });
    if (!skin) throw new Error('The shepherd model has no skin.');

    const material = toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const staff = material.clone();
    const cape = new CapeCloth(skin, material);

    // The crook is part of the same mesh. Give its fully staff-weighted triangles a
    // separate material so it can be put away when the shepherd needs both hands.
    const geometry = skin.geometry;
    const index = geometry.getIndex()!;
    const { skinIndex, skinWeight } = geometry.attributes;
    const staffJoint = skin.skeleton.bones.findIndex((bone) => bone.name === 'staff');
    const onStaff = (i: number) => skinIndex.getX(i) === staffJoint && skinWeight.getX(i) > 0.99;
    const bodyIndices: number[] = [];
    const staffIndices: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      (onStaff(a) && onStaff(b) && onStaff(c) ? staffIndices : bodyIndices).push(a, b, c);
    }
    geometry.setIndex(bodyIndices.concat(staffIndices));
    geometry.clearGroups();
    geometry.addGroup(0, bodyIndices.length, 0);
    geometry.addGroup(bodyIndices.length, staffIndices.length, 1);
    skin.material = [material, staff];
    skin.castShadow = skin.receiveShadow = true;
    skin.frustumCulled = false; // The bind pose bounds don't cover the action poses.

    return new ShepherdRig(scene, animations, staff, cape, skin.skeleton.bones);
  }

  reset(): void {
    this.elapsed = this.pace = this.crouch = this.sprint = this.reach = 0;
    this.cape.reset();
    this.footwork.reset();
  }

  private bone(name: string): THREE.Bone {
    return this.bones.get(name)!;
  }

  leftHandPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.armL.end.getWorldPosition(target);
  }

  private modelPosition(bone: THREE.Object3D): THREE.Vector3 {
    return bone.getWorldPosition(v()).applyMatrix4(this.modelInverse);
  }

  private rotate(name: string, axis: THREE.Vector3, radians: number): void {
    const bone = this.bone(name);
    const axisInParent = axis.clone().applyQuaternion(this.modelRotation)
      .applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
    bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axisInParent, radians));
  }

  /** Solve a two-bone limb with a knee/elbow pole expressed in character space. */
  private reachTo(limb: Limb, target: THREE.Vector3, pole: THREE.Vector3, weight: number, footPitch?: number): void {
    if (weight <= 0.001) return;
    const { upper, lower, end } = limb;
    const origin = this.modelPosition(upper);
    const currentJoint = this.modelPosition(lower);
    const currentEnd = this.modelPosition(end);
    const direction = currentEnd.clone().lerp(target, weight).sub(origin);
    const upperLength = lower.position.length();
    const lowerLength = end.position.length();
    const distance = clamp(direction.length(), Math.abs(upperLength - lowerLength) + 0.001, upperLength + lowerLength - 0.001);
    direction.normalize();
    const along = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * distance);
    const bend = currentJoint.clone().sub(origin).normalize().lerp(pole, weight);
    bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    const joint = origin.clone().addScaledVector(direction, along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
    const tip = origin.clone().addScaledVector(direction, distance);

    this.aim(upper, lower, joint);
    this.aim(lower, end, tip);
    if (footPitch !== undefined) {
      const world = new THREE.Quaternion().setFromAxisAngle(xAxis, footPitch).multiply(limb.restRotation);
      const local = end.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.modelRotation).multiply(world);
      end.quaternion.slerp(local, weight);
    }
  }

  private aim(bone: THREE.Bone, child: THREE.Bone, target: THREE.Vector3): void {
    const localTarget = bone.parent!.worldToLocal(target.clone().applyMatrix4(this.model.matrixWorld)).sub(bone.position).normalize();
    const current = child.position.clone().normalize().applyQuaternion(bone.quaternion);
    bone.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(current, localTarget));
  }

  update(
    dt: number, gait: Gait, speed: number, grounded: boolean,
    cue: { kind: ShepherdCue; progress: number } | undefined,
    interaction: 'free' | undefined,
    bike: Bike, rider: RiderPose | undefined, incident: BikeBodyPose | undefined,
    lantern: boolean,
    groundAt?: (x: number, z: number) => number,
    work?: StationPose,
  ): void {
    this.elapsed += dt;
    const ride = rider?.seat ?? 0;
    const working = work?.weight ?? 0;
    const sitting = (work?.sit ?? 0) * working;
    const weightShift = rider?.weightShift ?? 0;
    const kick = rider?.kick ?? 0;
    const crash = incident?.kind === 'crash' ? incident : undefined;
    const lift = incident?.kind === 'lift' ? incident : undefined;
    const { walkSpeed, sprintSpeed } = config.player;
    const blend = 1 - Math.exp(-dt * 13);
    this.pace = lerp(this.pace, clamp(speed / 0.55, 0, 1) * (1 - ride), blend);
    this.crouch = lerp(this.crouch, gait === 'sneak' ? smoothstep(speed, 0.07, 0.52) * (1 - ride) : 0, blend);
    this.sprint = lerp(this.sprint, gait === 'sprint' || speed > walkSpeed ? smoothstep(speed, walkSpeed * 1.12, sprintSpeed * 0.97) * (1 - ride) : 0, blend);
    this.reach = lerp(this.reach, interaction ? 1 : 0, blend);
    this.model.updateWorldMatrix(true, false);
    this.footwork.advance(this.model.matrixWorld, dt, speed * (1 - ride), this.crouch, this.sprint,
      grounded && ride < 0.18 && !crash && sitting < 0.16, groundAt);
    const stride = this.footwork.phase;
    this.walk.time = stride * this.walk.getClip().duration;
    this.walk.paused = true;
    this.walk.setEffectiveWeight(this.pace * (1 - 0.74 * this.sprint) * (1 - 0.76 * this.crouch));
    this.idle.setEffectiveWeight(1 - this.walk.getEffectiveWeight());
    // The mixer skips writes to unchanged tracks. Restore their sampled values
    // before evaluating so procedural offsets never accumulate across frames.
    for (const { bone, position, rotation } of this.basePose) {
      bone.position.copy(position);
      bone.quaternion.copy(rotation);
    }
    this.mixer.update(dt);
    for (const { bone, position, rotation } of this.basePose) {
      position.copy(bone.position);
      rotation.copy(bone.quaternion);
    }

    this.modelInverse.copy(this.model.matrixWorld).invert();
    this.model.getWorldQuaternion(this.modelRotation);
    const pelvis = this.bone('pelvis');
    const phase = stride * TAU;
    const horn = cue?.kind === 'horn' ? Math.sin(Math.PI * cue.progress) : 0;
    const engine = bike.engineOn ? Math.sin(this.elapsed * 36) * 0.004 : 0;
    const reach = Math.max(this.reach, cue?.kind === 'pet' ? Math.sin(Math.PI * cue.progress) : 0) * (1 - ride) * Number(!incident) * (1 - working);

    const onFoot = (1 - ride) * (1 - (crash?.strength ?? 0));
    const armDrive = Math.sin(phase + 0.30);
    const lean = 0.08 * this.pace + 0.26 * this.crouch + 0.23 * this.sprint;
    const settle = -0.057 * this.pace - 0.126 * this.crouch - 0.053 * this.sprint;
    const bob = -Math.cos(phase * 2 + 0.25) * lerp(0.012, 0.033, this.sprint) * this.pace;
    pelvis.position.y = lerp(pelvis.position.y, 0.821 + settle + bob, this.pace) - 0.22 * reach;
    pelvis.position.x = lerp(pelvis.position.x, Math.cos(phase + 0.24) * (0.022 + this.crouch * 0.016), this.pace * onFoot);
    const corner = (rider?.lean ?? 0) * ride;
    const dab = rider?.dab ?? 0;
    const crouchLift = lift?.crouch ?? 0;
    const braceLift = (lift?.grip ?? 0) * (1 - crouchLift);
    pelvis.position.x += corner * 0.077 + dab * 0.071;
    pelvis.position.z += (0.032 * this.sprint + 0.028 * this.crouch) * onFoot;
    pelvis.position.y = lerp(pelvis.position.y, 0.88 + engine - 0.093 * kick, ride);
    pelvis.position.z = lerp(pelvis.position.z, 0.10 + weightShift * 0.035, ride);
    pelvis.position.y -= sitting + 0.36 * crouchLift + 0.18 * braceLift + Math.abs(dab) * 0.105;
    this.rotate('pelvis', zAxis, Math.cos(phase) * 0.050 * this.pace * onFoot);
    this.rotate('pelvis', yAxis, armDrive * (0.055 + 0.052 * this.sprint) * this.pace * onFoot);
    this.rotate('spine', xAxis, lean * onFoot + 0.64 * reach + (0.83 + weightShift * 0.10) * ride + 0.24 * kick + 1.25 * crouchLift + 0.72 * braceLift + 0.30 * (crash?.kneel ?? 0) + (work?.lean ?? 0) * working);
    this.rotate('spine', zAxis, -corner * 0.23 + dab * 0.11);
    this.rotate('chest', yAxis, working * (work?.twist ?? 0));
    this.rotate('chest', yAxis, (rider?.look ?? 0) * ride * 0.36);
    this.rotate('chest', yAxis, -armDrive * (0.072 + 0.11 * this.sprint) * this.pace * onFoot);
    this.rotate('head', xAxis, -lean * 0.58 * onFoot - 0.21 * ride + 0.17 * reach);
    this.rotate('head', yAxis, (rider?.look ?? 0) * ride * 0.75);
    this.rotate('head', zAxis, (rider?.headRoll ?? 0) * ride);
    this.rotate('satchel', zAxis, Math.sin(phase - 0.6) * (0.052 * this.pace + 0.14 * this.sprint) * onFoot);
    this.rotate('head', xAxis, -0.55 * crouchLift - 0.27 * braceLift - 0.16 * (crash?.impact ?? 0) - working * ((work?.lean ?? 0) * 0.54 + (work?.sip ?? 0) * 0.18));
    this.staff.visible = (rider?.hands[1] ?? 0) < 0.32 && ride < 0.33 && !crash && working < 0.30 && (lift?.grip ?? 0) < 0.18;

    for (const [index, limb] of [this.legL, this.legR].entries()) {
      const step = this.footwork.feet[index];
      const side = index === 0 ? 1 : -1;
      const foot = step.target.clone();
      if (sitting > 0.001) {
        const seatedFoot = limb.restEnd.clone().add(v(side * 0.063, 0, 0.32));
        foot.lerp(seatedFoot, smoothstep(sitting, 0, 0.32));
      }
      const contact = rider?.feet[index] ?? 0;
      if (rider && contact > 0) {
        const seated = rider.boots[index].clone().applyMatrix4(this.modelInverse);
        foot.lerp(seated, contact);
      }
      const pitch = rider?.bootPitch[index] ?? 0;
      if (crash) {
        const lower = (index === 1 ? 1 : -1) === crash.side;
        const bent = v(side * (0.19 + crash.impact * 0.12),
          lower ? 0.18 + crash.kneel * 0.18 : 0.38 - crash.kneel * 0.18,
          lower ? -0.12 : 0.36 - crash.kneel * 0.12);
        foot.lerp(bent, crash.strength);
        if (groundAt && crash.impact > 0) {
          foot.applyMatrix4(this.model.matrixWorld);
          foot.y = Math.max(foot.y, groundAt(foot.x, foot.z) + 0.07);
          foot.applyMatrix4(this.modelInverse);
        }
      }
      const arc = rider?.legSwing[index] ?? 0;
      this.reachTo(limb, foot, v(side * (0.27 * ride + 0.75 * arc) - corner * 0.19, 0.48 * arc, 1 - 1.58 * arc),
        (grounded || contact > 0 || crash ? 1 : Math.max(0.28, this.pace)), lerp(step.pitch, pitch, contact));
    }

    if (reach > 0.001) {
      const petting = cue?.kind === 'pet';
      const pulse = Math.sin(this.elapsed * (petting ? 17 : 8));
      const y = 0.54 + pulse * 0.055;
      this.reachTo(this.armL, v(0.23, y, 0.55 + pulse * 0.045), v(1, -1), reach);
      if (!petting) this.reachTo(this.armR, v(-0.23, y - pulse * 0.045, 0.52), v(-1, -1), reach);
    }

    const freeArms = onFoot * (1 - reach);
    const freeRight = freeArms * (1 - (rider?.hands[1] ?? 0));
    const swing = Math.cos(phase + 0.30);
    this.rotate('upper_armL', xAxis, swing * (0.14 * this.pace + 0.72 * this.sprint) * freeArms);
    this.rotate('forearmL', xAxis, (-0.30 * this.crouch - (0.59 + swing * 0.12) * this.sprint) * freeArms);
    this.rotate('upper_armR', xAxis, (-0.13 * this.crouch - (0.18 + swing * 0.23) * this.sprint) * freeArms);
    if (this.pace * freeRight > 0.01) {
      const staffLift = 0.054 * this.pace + 0.065 * this.crouch + 0.085 * this.sprint;
      const hand = this.modelPosition(this.armR.end).add(v(0, staffLift, 0));
      this.reachTo(this.armR, hand, v(-1, -1, 0), freeRight * 0.75);
    }
    this.rotate('staff', xAxis, (-0.14 * this.crouch - 0.39 * this.sprint) * freeArms);

    if (rider) {
      this.reachTo(this.armL, this.modelPosition(rider.grips[0]).add(v(0, horn * 0.018, 0)),
        v(0.70 + corner * 0.22, -1, -0.16), rider.hands[0]);
      this.reachTo(this.armR, this.modelPosition(rider.grips[1]),
        v(-0.70 + corner * 0.22, -1, -0.16), rider.hands[1]);
    }

    if (lantern) {
      this.reachTo(this.armL, v(0.36, 1.17, 0.39 + Math.sin(phase) * 0.035 * this.pace), v(1, -1), 1 - reach);
    }

    if (cue && cue.kind !== 'horn' && cue.kind !== 'pet' && !incident && !work) {
      const onBike = cue.kind !== 'crook' && cue.kind !== 'call' && cue.kind !== 'gate';
      this.act(cue.kind, cue.progress, onBike ? 1 - ride * 0.15 : 1 - ride);
    }
    if (lift) {
      this.reachTo(this.armL, lift.hands[0].clone().applyMatrix4(this.modelInverse), v(0.86, -1, 0), lift.grip);
      this.reachTo(this.armR, lift.hands[1].clone().applyMatrix4(this.modelInverse), v(-0.86, -1, 0), lift.grip);
    }
    if (crash) {
      const rightDown = crash.side > 0;
      const bracing = rightDown ? this.armR : this.armL;
      const other = rightDown ? this.armL : this.armR;
      const side = rightDown ? -1 : 1;
      const palm = v(side * 0.48, 1.15, 0.35)
        .lerp(crash.brace.clone().applyMatrix4(this.modelInverse), Math.max(crash.impact, crash.kneel) * 0.90);
      this.reachTo(bracing, palm, v(side, -0.5, 0), crash.strength);
      this.reachTo(other, v(-side * 0.46, 1.34 - crash.impact * 0.31, 0.24), v(-side, -0.8, 0), crash.strength);
    }
    if (work) {
      const left = work.hands[0].clone().applyMatrix4(this.modelInverse);
      if (work.sip > 0) {
        const mouth = this.bone('head').localToWorld(v(0.006, 0.076, 0.091)).applyMatrix4(this.modelInverse);
        // The wrist is below and ahead of the lip of the tipped glass.
        left.lerp(mouth.add(v(0.006, -0.040, 0.047)), work.sip);
      }
      this.reachTo(this.armL, left, v(0.85, -1, 0), work.contact[0] * working);
      this.reachTo(this.armR, work.hands[1].clone().applyMatrix4(this.modelInverse), v(-0.85, -1, 0), work.contact[1] * working);
    }
    this.model.updateMatrixWorld(true);
    const origin = this.model.matrixWorld.elements;
    const floor = crash && crash.impact > 0 ? groundAt?.(origin[12], origin[14]) : undefined;
    this.cape.update(dt, floor);
  }

  private act(kind: Exclude<ShepherdCue, 'horn' | 'pet'>, t: number, weight: number): void {
    const amount = smoothstep(t, 0, 0.22) * (1 - smoothstep(t, 0.67, 1)) * weight;
    switch (kind) {
      case 'crook': {
        const sweep = smoothstep(t, 0.20, 0.52);
        this.rotate('chest', yAxis, lerp(-0.32, 0.53, sweep) * amount);
        this.reachTo(this.armR, v(lerp(-0.53, 0.10, sweep), 1.21, lerp(0.16, 0.50, sweep)), v(-1, -1), amount);
        this.rotate('staff', zAxis, lerp(-0.80, 1.04, sweep) * amount);
        this.rotate('staff', xAxis, -0.49 * amount);
        break;
      }
      case 'call':
      case 'whistle':
        this.rotate('head', xAxis, -0.12 * amount);
        this.reachTo(this.armL, v(kind === 'whistle' ? 0.032 : 0.12, 1.51, 0.157), v(1, -1, 0.28), amount);
        break;
      case 'gather':
        this.reachTo(this.armL, v(0.30 + Math.sin(t * TAU) * 0.25, 1.49 + Math.cos(t * TAU) * 0.26, 0.32), v(1, -1), amount);
        break;
      case 'hold':
        this.reachTo(this.armL, v(0.23, 1.36, 0.45), v(1, -1), amount);
        this.rotate('handL', xAxis, -0.55 * amount);
        break;
      case 'search':
        this.reachTo(this.armL, v(0.40, 1.42 + 0.12 * Math.sin(2 * TAU * t), 0.41), v(1, -1), amount);
        break;
      case 'attack':
        this.rotate('chest', xAxis, 0.14 * amount);
        this.reachTo(this.armL, v(0.12, 1.38, 0.61), v(1, -1), amount);
        break;
      case 'heel':
        this.reachTo(this.armL, v(0.185 + 0.075 * Math.sin(3 * TAU * t), 0.87, 0.10), v(1, -0.5), amount);
        break;
      case 'gate':
        this.rotate('chest', yAxis, -0.24 * amount);
        this.reachTo(this.armL, v(0.27, 1.02, 0.47), v(1, -1), amount);
        break;
    }
  }
}

// Simulation-side shepherd: Rapier kinematic character controller (capsule),
// camera-relative movement, crook wave and call. No rendering here.

import type RAPIERType from '@dimforge/rapier3d-compat';
import { config } from '../core/config';
import type { EventBus } from '../core/events';
import type { InputFrame } from '../core/input';
import type { Rapier } from '../world/physics';

const DEG = Math.PI / 180;

export type Gait = 'idle' | 'sneak' | 'walk' | 'sprint';

export interface PlayerSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class PlayerController {
  readonly body: RAPIERType.RigidBody;
  readonly collider: RAPIERType.Collider;
  private cc: RAPIERType.KinematicCharacterController;

  /** Feet position (bottom of the capsule). */
  pos = { x: 0, y: 0, z: 0 };
  prev: PlayerSnapshot = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Facing; forward = (-sin yaw, 0, -cos yaw), same convention as the camera. */
  yaw = 0;
  vel = { x: 0, z: 0 };
  vy = 0;
  grounded = false;
  gait: Gait = 'idle';
  crookCooldown = 0;
  callCooldown = 0;
  noiseTimer = 0;
  lastCrookTick = -1000;
  lastCallTick = -1000;

  private readonly halfTotal: number;

  constructor(
    R: Rapier,
    world: RAPIERType.World,
    private events: EventBus,
    spawn: { x: number; y: number; z: number },
  ) {
    const pc = config.player;
    this.halfTotal = pc.capsuleHalfHeight + pc.capsuleRadius;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + this.halfTotal, spawn.z),
    );
    this.collider = world.createCollider(R.ColliderDesc.capsule(pc.capsuleHalfHeight, pc.capsuleRadius), this.body);

    this.cc = world.createCharacterController(0.02);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.setSlideEnabled(true);
    this.cc.setMaxSlopeClimbAngle(pc.maxSlopeDeg * DEG);
    this.cc.setMinSlopeSlideAngle((pc.maxSlopeDeg + 5) * DEG);
    this.cc.enableAutostep(pc.stepHeight, 0.2, false);
    this.cc.enableSnapToGround(pc.snapToGround);
    this.cc.setApplyImpulsesToDynamicBodies(false);

    this.pos = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.snapshotPrev();
  }

  private snapshotPrev(): void {
    this.prev = { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw };
  }

  /** Before world.step(): read input, compute a collision-corrected move, queue it. */
  preStep(f: InputFrame, dt: number, tick: number): void {
    this.snapshotPrev();
    const pc = config.player;

    // Camera-relative wish direction.
    const sin = Math.sin(f.camYaw);
    const cos = Math.cos(f.camYaw);
    const fwdX = -sin;
    const fwdZ = -cos;
    const rightX = cos;
    const rightZ = -sin;
    let wx = rightX * f.moveX + fwdX * f.moveY;
    let wz = rightZ * f.moveX + fwdZ * f.moveY;
    const mag = Math.min(1, Math.hypot(wx, wz));
    if (mag > 1e-4) {
      const l = Math.hypot(wx, wz);
      wx /= l;
      wz /= l;
    }

    let speed = 0;
    if (mag > 1e-4) {
      if (f.hush) {
        // Hushing the flock: crouched, barely moving.
        speed = pc.sneakSpeed * Math.min(1, mag);
        this.gait = 'sneak';
      } else if (f.sprint) {
        speed = pc.sprintSpeed;
        this.gait = 'sprint';
      } else if (f.sneak) {
        speed = pc.sneakSpeed * Math.min(1, mag / pc.sneakStickThreshold);
        this.gait = 'sneak';
      } else {
        speed = pc.walkSpeed * mag;
        this.gait = 'walk';
      }
    } else {
      this.gait = 'idle';
    }

    const k = 1 - Math.exp(-pc.acceleration * dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;

    // Face the direction of travel.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.15) {
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      this.yaw = wrapAngle(this.yaw + wrapAngle(target - this.yaw) * (1 - Math.exp(-pc.turnRate * dt)));
    }

    // Gravity.
    if (this.grounded) this.vy = -1;
    else this.vy = Math.max(this.vy - pc.gravity * dt, -40);

    const desired = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    this.cc.computeColliderMovement(this.collider, desired);
    const mv = this.cc.computedMovement();
    this.grounded = this.cc.computedGrounded();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });

    // Actions.
    this.crookCooldown = Math.max(0, this.crookCooldown - dt);
    this.callCooldown = Math.max(0, this.callCooldown - dt);
    this.noiseTimer = Math.max(0, this.noiseTimer - dt);
    const origin = { x: t.x, y: t.y - this.halfTotal, z: t.z };

    if (f.crook && this.crookCooldown === 0) {
      // Aim where the camera looks; the shepherd turns to swing that way.
      this.yaw = Math.atan2(-fwdX, -fwdZ);
      this.crookCooldown = pc.crookCooldown;
      this.lastCrookTick = tick;
      this.events.emit('crookWave', {
        origin,
        dirX: fwdX,
        dirZ: fwdZ,
        range: pc.crookRange,
        halfAngle: pc.crookHalfAngleDeg * DEG,
        tick,
      });
    }
    if (f.call && this.callCooldown === 0) {
      this.callCooldown = pc.callCooldown;
      this.lastCallTick = tick;
      this.events.emit('call', { origin, radius: pc.callRadius, tick });
    }
    if (this.gait === 'sprint' && this.noiseTimer === 0) {
      this.noiseTimer = 0.5;
      this.events.emit('playerNoise', { origin, radius: pc.sprintNoiseRadius, tick });
    }
  }

  /** After world.step(): read back the body position. */
  postStep(): void {
    const t = this.body.translation();
    this.pos.x = t.x;
    this.pos.y = t.y - this.halfTotal;
    this.pos.z = t.z;
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}

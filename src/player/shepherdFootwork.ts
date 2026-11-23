import * as THREE from 'three';

const { lerp, smoothstep, clamp } = THREE.MathUtils;

interface Step {
  rest: THREE.Vector3;
  target: THREE.Vector3;
  pitch: number;
  lift: number;
  roll: number;
  planted: boolean;
  contact: THREE.Vector3;
  landing: THREE.Vector3;
  last: THREE.Vector3;
  swinging: boolean;
}

export class ShepherdFootwork {
  readonly feet: readonly [Step, Step];
  phase = 0;
  private cycle = 0;
  private ready = false;
  private readonly previous = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly facing = new THREE.Vector3();
  private readonly neutral = new THREE.Vector3();
  private previousYaw = 0;
  private readonly inverse = new THREE.Matrix4();

  constructor(left: THREE.Vector3, right: THREE.Vector3) {
    const foot = (rest: THREE.Vector3): Step => ({
      rest, target: rest.clone(), pitch: 0, lift: 0, roll: 0, planted: false, swinging: false,
      contact: new THREE.Vector3(), landing: new THREE.Vector3(), last: new THREE.Vector3(),
    });
    this.feet = [foot(left), foot(right)];
  }

  reset(): void {
    this.ready = false;
    this.phase = this.cycle = 0;
  }

  advance(
    world: THREE.Matrix4, dt: number, speed: number, crouch: number, run: number, grounded: boolean,
    groundAt?: (x: number, z: number) => number,
  ): void {
    this.origin.setFromMatrixPosition(world);
    this.facing.setFromMatrixColumn(world, 2).setY(0).normalize();
    const yaw = Math.atan2(this.facing.x, this.facing.z);
    const angle = yaw - this.previousYaw;
    const turn = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
    this.direction.subVectors(this.origin, this.previous).setY(0);
    const travel = this.direction.length();
    const fresh = !this.ready || travel > 0.70 || Math.abs(this.origin.y - this.previous.y) > 0.47;
    this.ready = grounded;
    this.previous.copy(this.origin);
    this.previousYaw = yaw;
    this.inverse.copy(world).invert();
    if (travel > 0.0001) this.direction.divideScalar(travel);
    else this.direction.copy(this.facing);
    const turning = !fresh && speed < 0.20 && turn > 0.003;
    const moving = !fresh && (speed > 0.10 || turning);
    const length = lerp(lerp(0.73, 1.10, smoothstep(speed, 0.15, 1.35)), 0.77, crouch) + run * 1.07;
    const duty = lerp(lerp(0.61, 0.72, crouch), 0.36, run);
    if (!fresh) this.cycle += (travel + (turning ? turn * Math.max(0, 0.18 - travel * 4) : 0)) / length;
    this.phase = this.cycle % 1;

    const baseGround = groundAt?.(this.origin.x, this.origin.z) ?? this.origin.y;
    const terrainOffset = this.origin.y - baseGround;
    // If standing on a collider well above the terrain, plant on the collider plane.
    const terrain = groundAt && Math.abs(terrainOffset) < 0.32 ? groundAt : undefined;
    const height = (x: number, z: number) => terrain
      ? this.origin.y + clamp(terrain(x, z) - baseGround, -0.24, 0.24)
      : this.origin.y;

    for (const [index, foot] of this.feet.entries()) {
      const phase = (this.phase + index * 0.5) % 1;
      this.neutral.copy(foot.rest);
      this.neutral.x *= 1 - run * 0.23 + crouch * 0.14;
      this.neutral.z = -0.012;
      this.neutral.applyMatrix4(world);
      this.neutral.y = height(this.neutral.x, this.neutral.z);
      if (fresh) {
        foot.contact.copy(this.neutral);
        foot.last.copy(this.neutral);
        foot.swinging = false;
        foot.lift = foot.roll = 0;
      }

      const swinging = moving && phase >= duty;
      let lift = 0;
      let pitch = 0;
      if (swinging) {
        const t = (phase - duty) / (1 - duty);
        const lead = turning ? 0 : length * (1 - phase + duty * lerp(0.50, 0.35, run));
        foot.landing.copy(this.neutral).addScaledVector(this.direction, lead);
        foot.landing.y = height(foot.landing.x, foot.landing.z);
        foot.last.copy(foot.contact).lerp(foot.landing, smoothstep(t, 0, 1));
        const roll = lerp(lerp(0.30, 0.16, crouch), 0.43, run);
        pitch = lerp(roll, lerp(-0.13, 0.08, run), smoothstep(t, 0.08, 0.90));
        lift = Math.sin(Math.PI * t) ** 1.45 * lerp(lerp(0.097, 0.058, crouch), 0.28, run)
          + (1 - smoothstep(t, 0, 0.31)) * roll * 0.20 + smoothstep(t, 0.84, 1) * 0.012;
      } else {
        if (foot.swinging) foot.contact.copy(moving ? foot.landing : foot.last);
        if (!moving) foot.contact.lerp(this.neutral, 1 - Math.exp(-dt * 11));
        foot.contact.y = height(foot.contact.x, foot.contact.z);
        foot.last.copy(foot.contact);
        if (moving) {
          const stance = phase / duty;
          const push = smoothstep(stance, 0.69, 1);
          const land = 1 - smoothstep(stance, 0, 0.22);
          pitch = push * lerp(lerp(0.30, 0.16, crouch), 0.43, run) + land * lerp(-0.13, 0.08, run);
          lift = push * lerp(lerp(0.060, 0.032, crouch), 0.086, run) + land * 0.012;
        } else {
          const settle = Math.exp(-dt * 19);
          lift = foot.lift * settle;
          pitch = foot.roll * settle;
        }
      }
      foot.lift = lift;
      foot.roll = pitch;
      foot.swinging = swinging;
      foot.planted = !swinging && grounded;
      const x = foot.last.x, z = foot.last.z;
      const slope = Math.atan2(height(x - this.facing.x * 0.10, z - this.facing.z * 0.10)
        - height(x + this.facing.x * 0.16, z + this.facing.z * 0.16), 0.26);
      foot.pitch = pitch + clamp(slope, -0.52, 0.52);
      foot.target.copy(foot.last).addScaledVector(THREE.Object3D.DEFAULT_UP, foot.rest.y + lift).applyMatrix4(this.inverse);
      if (!grounded) {
        foot.pitch = 0.16 * run;
        foot.target.copy(foot.rest);
        foot.target.y += 0.065 + 0.05 * run * index;
        foot.target.z += (index ? -0.16 : 0.19) * run;
      }
    }
  }
}

// Third-person spring-arm camera: orbit with mouse or right stick, over-the-shoulder
// offset, zoom on the wheel, pulled in by obstacles and kept above the terrain.

import type RAPIERType from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../core/config';
import type { Input } from '../core/input';
import type { Rapier } from '../world/physics';

const DEG = Math.PI / 180;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Orbit yaw; the camera looks along (-sin yaw, -cos yaw) when pitch is 0. */
  yaw = Math.PI * 0.75;
  /** Elevation of the camera above the pivot, radians. Positive = looking down. */
  pitch = 18 * DEG;
  private distance = config.camera.distance;
  private zoom = config.camera.distance;
  private readonly pivot = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private conversationBlend = 0;
  private readonly conversationTarget = new THREE.Vector3();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    private R: Rapier,
    private getWorld: () => RAPIERType.World,
    private getPlayerCollider: () => RAPIERType.Collider,
    private groundAt: (x: number, z: number) => number,
    canvas: HTMLCanvasElement,
  ) {
    this.camera = new THREE.PerspectiveCamera(config.camera.fov, 1, 0.3, 6000);
    canvas.addEventListener(
      'wheel',
      (e) => {
        const c = config.camera;
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.001), c.minDistance + 0.5, c.maxDistance);
        config.camera.distance = this.zoom;
      },
      { passive: true },
    );
  }

  private sinceLook = 99;

  /**
   * `bike` switches to the riding camera: it swings in behind the bike when you are not
   * steering the camera, pulls back and widens with speed, and rolls a little with the lean.
   */
  update(
    target: THREE.Vector3, input: Input, dt: number,
    bike?: { heading: number; speed: number; lean: number } | null,
    speaker?: { x: number; y: number; z: number },
  ): void {
    const c = config.camera;
    this.zoom = c.distance;

    const m = input.consumeMouseLook();
    const st = input.stickLook();
    const manual = Math.abs(m.dx) + Math.abs(m.dy) > 0 || Math.abs(st.x) + Math.abs(st.y) > 0;
    this.sinceLook = manual ? 0 : this.sinceLook + dt;
    this.yaw -= m.dx * c.mouseSensitivity + st.x * c.stickSensitivity * dt;
    this.pitch += m.dy * c.mouseSensitivity + st.y * c.stickSensitivity * dt;
    if (bike && this.sinceLook > 0.8) {
      // Chase: settle behind the bike (camera forward = bike forward).
      let d = bike.heading + Math.PI - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * (1 + Math.min(1, bike.speed / 4) * 2.5));
      this.pitch += (14 * DEG - this.pitch) * Math.min(1, dt * 1.5);
    }
    if (bike) this.zoom = Math.max(c.distance, 5 + bike.speed * 0.08);
    const frameSpeaker = speaker && !bike && !this.reducedMotion.matches && this.sinceLook > 0.7;
    this.conversationBlend += (Number(!!frameSpeaker) - this.conversationBlend) * (1 - Math.exp(-dt * 4));
    if (frameSpeaker) {
      this.conversationTarget.set(speaker.x, speaker.y, speaker.z);
      const heading = Math.atan2(target.x - speaker.x, target.z - speaker.z) + 0.24;
      const difference = heading - this.yaw;
      this.yaw += Math.atan2(Math.sin(difference), Math.cos(difference)) * Math.min(1, dt * 3.8);
    }
    if (!bike) this.zoom = THREE.MathUtils.lerp(this.zoom, 4.35, this.conversationBlend);
    this.pitch = THREE.MathUtils.clamp(this.pitch, c.pitchMinDeg * DEG, c.pitchMaxDeg * DEG);

    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const cp = Math.cos(this.pitch);
    // Back direction (from pivot toward the camera).
    const bx = sy * cp;
    const by = Math.sin(this.pitch);
    const bz = cy * cp;

    const shoulder = bike ? 0 : c.shoulder;
    this.pivot.set(target.x + cy * shoulder, target.y + c.height + (bike ? 0.2 : 0), target.z - sy * shoulder);
    const blend = this.conversationBlend * 0.62;
    this.pivot.x = THREE.MathUtils.lerp(this.pivot.x, this.conversationTarget.x, blend);
    this.pivot.y = THREE.MathUtils.lerp(this.pivot.y, this.conversationTarget.y + 1.15, blend);
    this.pivot.z = THREE.MathUtils.lerp(this.pivot.z, this.conversationTarget.z, blend);

    // Spring arm: shorten when something is between the pivot and the camera.
    let allowed = this.zoom;
    const ray = new this.R.Ray({ x: this.pivot.x, y: this.pivot.y, z: this.pivot.z }, { x: bx, y: by, z: bz });
    const hit = this.getWorld().castRay(ray, this.zoom, true, undefined, undefined, this.getPlayerCollider());
    if (hit) allowed = Math.max(c.minDistance, hit.timeOfImpact - 0.3);

    // Pull in fast, ease out slowly (avoids popping when passing behind a post).
    const k = allowed < this.distance ? 1 - Math.exp(-30 * dt) : 1 - Math.exp(-4 * dt);
    this.distance += (allowed - this.distance) * k;

    this.desired.set(this.pivot.x + bx * this.distance, this.pivot.y + by * this.distance, this.pivot.z + bz * this.distance);
    const floor = this.groundAt(this.desired.x, this.desired.z) + 0.4;
    if (this.desired.y < floor) this.desired.y = floor;

    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.pivot.x, this.pivot.y, this.pivot.z);
    if (bike) this.camera.rotateZ(bike.lean * 0.3);
    const fov = c.fov + (bike ? 8 * Math.min(1, bike.speed / 20) : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

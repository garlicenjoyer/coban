import * as THREE from 'three';
import { config } from '../core/config';
import { modelMesh, modelPart } from '../render/gameModel';
import { toonMaterial } from '../render/toon';
import { RACK_CANS } from '../world/water';
import type { Bike } from './bike';
import { kickStroke } from './kickMotion';

export class BikeView {
  /** Outer transform leans about the tyre contact line. */
  readonly root: THREE.Group;
  private readonly rearWheel: THREE.Object3D;
  private readonly frontWheel: THREE.Object3D;
  private readonly fork: THREE.Object3D;
  private readonly stand: THREE.Object3D;
  private readonly starter: THREE.Object3D;
  private readonly lampMat: THREE.MeshToonMaterial;
  private readonly lampLight: THREE.SpotLight;
  private readonly cans: THREE.Group[] = [];
  readonly seat: THREE.Object3D;
  readonly grips: readonly [THREE.Object3D, THREE.Object3D];
  readonly pegs: readonly [THREE.Object3D, THREE.Object3D];
  readonly kickPedal: THREE.Object3D;
  readonly recoveryFrame: readonly [THREE.Object3D, THREE.Object3D];
  readonly recoveryRails: readonly [THREE.Object3D, THREE.Object3D];
  steering = 0;
  liftPhase = 0;
  private fallenBank = 0;
  private completingLift = false;
  private previousState?: Bike['state'];
  private standFold = 0;
  private bike?: Bike;
  readonly renderPos = new THREE.Vector3();

  constructor(private getBike: () => Bike, model: THREE.Group) {
    this.root = model;
    this.root.rotation.order = 'YXZ';
    this.rearWheel = modelPart(model, 'Rear wheel');
    this.frontWheel = modelPart(model, 'Front wheel');
    this.fork = modelPart(model, 'Fork');
    this.stand = modelPart(model, 'Kickstand');
    this.starter = modelPart(model, 'Kick starter');
    this.kickPedal = modelPart(this.starter, 'Kick pedal anchor');
    this.recoveryFrame = [modelPart(model, 'Left recovery frame'), modelPart(model, 'Right recovery frame')];
    this.recoveryRails = [modelPart(model, 'Left recovery rail'), modelPart(model, 'Right recovery rail')];
    this.seat = modelPart(model, 'Saddle anchor');
    this.grips = [modelPart(model, 'Left grip anchor'), modelPart(model, 'Right grip anchor')];
    this.pegs = [modelPart(model, 'Left peg anchor'), modelPart(model, 'Right peg anchor')];
    const lens = modelMesh(model, 'Headlamp lens');
    this.lampMat = lens.material = lens.material.clone();

    // Local nodes survive glTF quaternion loading. Set the Euler order before driving steering.
    this.fork.rotation.reorder('XYZ');
    this.frontWheel.rotation.order = 'YXZ';
    this.lampLight = new THREE.SpotLight(0xfff0c8, 0, 40, 0.45, 0.5, 1.2);
    this.lampLight.position.set(0, 0.064, -0.235);
    this.lampLight.target.position.set(0, -5.65, -12);
    this.fork.add(this.lampLight, this.lampLight.target);

    const canBody = new THREE.BoxGeometry(0.17, 0.29, 0.29);
    const canHandle = new THREE.TorusGeometry(0.055, 0.012, 6, 14);
    const canMaterial = toonMaterial({ color: 0x638793 });
    const strap = toonMaterial({ color: 0x3c332a });
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.35), strap);
    rack.position.set(0, 0.72, 0.64);
    this.root.add(rack);
    for (let i = 0; i < RACK_CANS; i++) {
      const can = new THREE.Group();
      can.position.set(i === 0 ? -0.095 : 0.095, 0.875, 0.64);
      const body = new THREE.Mesh(canBody, canMaterial);
      const handle = new THREE.Mesh(canHandle, canMaterial);
      handle.rotation.y = Math.PI / 2;
      handle.position.y = 0.145;
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.176, 0.30, 0.038), strap);
      can.add(body, handle, band);
      can.visible = false;
      this.cans.push(can);
      this.root.add(can);
    }
  }

  setKick(phase: number): void {
    this.starter.rotation.x = 1.86 * kickStroke(phase);
  }

  update(alpha: number, dt = 1 / 60, kickstandFold?: number): void {
    const bk = this.getBike();
    const { lerp, smoothstep } = THREE.MathUtils;
    if (bk !== this.bike) {
      this.bike = bk;
      this.steering = bk.steerAngle;
      this.standFold = kickstandFold ?? Number(bk.state !== 'parked');
      this.liftPhase = 0;
      this.completingLift = false;
      this.previousState = bk.state;
      this.setKick(0);
    }
    this.renderPos.set(lerp(bk.px, bk.x, alpha), lerp(bk.py, bk.y, alpha), lerp(bk.pz, bk.z, alpha));
    this.root.position.copy(this.renderPos);
    const change = bk.heading - bk.prevHeading;
    let bank = lerp(bk.prevLean, bk.lean, alpha);
    const stand = this.updateLift(bk, dt, bank, kickstandFold);
    if (this.liftPhase > 0) bank = lerp(this.fallenBank, -8 * Math.PI / 180, smoothstep(this.liftPhase, 0.22, 0.89));
    // Keep the low handlebar above the dirt when the bike rests on its side.
    this.root.position.y += 0.20 * smoothstep(Math.abs(bank), 0.76, 1.43);
    this.root.rotation.set(
      lerp(bk.prevPitch, bk.pitch, alpha),
      bk.prevHeading + Math.atan2(Math.sin(change), Math.cos(change)) * alpha + Math.PI,
      bank,
    );
    const r = config.bike.wheelRadius;
    this.rearWheel.rotation.x = -bk.wheelSpinR;
    this.steering = lerp(this.steering, bk.steerAngle, 1 - Math.exp(-dt * 26));
    this.frontWheel.rotation.set(-bk.wheelSpinF, -this.steering, 0);
    this.fork.rotation.y = -this.steering;
    this.rearWheel.position.y = r - bk.suspR * 0.5;
    this.frontWheel.position.y = r - bk.suspF * 0.5;
    this.standFold = lerp(this.standFold, stand, 1 - Math.exp(-dt * 10));
    this.stand.rotation.set(-1.47 * this.standFold, 0, 0.41 * this.standFold);
    this.lampMat.emissive.setHex(bk.lamp ? 0xffe9a8 : 0x000000);
    this.lampLight.intensity = bk.lamp ? 40 : 0;
    this.cans.forEach((can, i) => (can.visible = i < bk.waterCans));
  }

  private updateLift(bike: Bike, dt: number, bank: number, kickstandFold?: number): number {
    const { clamp, smoothstep } = THREE.MathUtils;
    if (bike.state === 'fallen') {
      this.fallenBank = bank;
      this.completingLift = false;
      const progress = clamp(bike.liftProgress / config.bike.liftSeconds, 0, 1);
      this.liftPhase += clamp(progress - this.liftPhase, -dt * 2.8, dt * 2.3);
    } else {
      if (this.previousState === 'fallen') this.completingLift = bike.state === 'parked' && this.liftPhase > 0.15;
      if (this.completingLift && bike.state === 'parked' && this.liftPhase < 1) {
        this.liftPhase = Math.min(1, this.liftPhase + dt * 3);
      } else {
        this.liftPhase = 0;
        this.completingLift = false;
      }
    }
    this.previousState = bike.state;
    if (this.liftPhase > 0 || bike.state === 'fallen') return 1 - smoothstep(this.liftPhase, 0.84, 0.98);
    return kickstandFold ?? Number(bike.state !== 'parked');
  }

}

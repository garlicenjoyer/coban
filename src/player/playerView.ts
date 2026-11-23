import * as THREE from 'three';
import type { BikeView } from '../bike/bikeView';
import { SIM_DT } from '../core/config';
import type { Vec3Like } from '../core/events';
import { commandInfo } from '../dog/commands';
import type { Sim } from '../sim';
import { LanternView } from './lanternView';
import { MotorcycleRider } from './motorcycleRider';
import { MotorcycleIncident } from './motorcycleIncident';
import { StationWork, type WorkStations } from './stationWork';
import { KICK_DURATION, KICK_IMPACT } from '../bike/kickMotion';
import { ShepherdRig, type ShepherdCue } from './shepherdRig';

const up = new THREE.Vector3(0, 1, 0);
const { lerp, smoothstep } = THREE.MathUtils;

interface Fx {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
  radius?: number;
}

interface Action {
  kind: ShepherdCue;
  age: number;
  duration: number;
  target?: { x: number; z: number };
}

export class PlayerView {
  readonly root = new THREE.Group();
  /** Interpolated feet position, for the camera. */
  readonly renderPos = new THREE.Vector3();
  private readonly rider: MotorcycleRider;
  private readonly work: StationWork;
  private readonly incident: MotorcycleIncident;
  private readonly previousVisualPosition = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly lantern: LanternView;
  private readonly fx: Fx[] = [];
  private action?: Action;
  private kick?: { age: number; success: boolean; struck: boolean };
  private lookOffset = 0;
  private readonly groundAt = (x: number, z: number) => this.sim.terrain.heightAt(x, z);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sim: Sim,
    private readonly rig: ShepherdRig,
    private readonly bikeView: BikeView,
    stations: WorkStations,
    private readonly playKick: (success: boolean) => void = () => {},
  ) {
    this.root.add(rig.model);
    scene.add(this.root);
    this.lantern = new LanternView(scene);
    this.rider = new MotorcycleRider(bikeView, this.groundAt);
    this.incident = new MotorcycleIncident(bikeView, this.groundAt);
    this.work = new StationWork(sim, stations, scene);
    const { events } = sim;
    events.on('crookWave', (e) => {
      this.play('crook', 0.55);
      const g = new THREE.CircleGeometry(e.range, 24, -e.halfAngle, e.halfAngle * 2);
      const m = this.decal(g, 0xffe08a, e.origin, 0.08);
      m.rotation.set(-Math.PI / 2, 0, Math.atan2(-e.dirZ, e.dirX));
      this.fx.push({ mesh: m, age: 0, life: 0.45 });
    });
    events.on('call', (e) => {
      this.play('call', 0.85);
      const g = new THREE.RingGeometry(0.92, 1, 48);
      const m = this.decal(g, 0x9fd3ff, e.origin, 0.1);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(0, 0, 1);
      this.fx.push({ mesh: m, age: 0, life: 0.8, radius: e.radius });
    });
    events.on('dogCommand', ({ mode, command }) => {
      if (this.kick || this.incident.crashing) return;
      if (mode === 'gesture') {
        this.play(command, command === 'gather' ? 0.95 : 0.7, sim.dog);
      } else {
        const notes = commandInfo(command).notes;
        this.play('whistle', 0.33 + notes.reduce((time, [, length]) => time + length + 0.05, 0));
      }
    });
    events.on('dogPetted', () => this.play('pet', 1.0, sim.dog));
    events.on('gateInteract', () => this.play('gate', 0.65, sim.gatePos));
    events.on('bikeKick', ({ success }) => {
      // A retry can arrive before the previous return stroke finishes.
      this.kick = { age: 0, success, struck: false };
      this.action = undefined;
    });
    events.on('bikeHorn', () => { if (!this.kick) this.play('horn', 0.3); });
    events.on('bikeFall', () => {
      if (!sim.riding) return;
      this.incident.fall(this.root, sim.bike);
      this.rider.interrupt();
      this.action = this.kick = undefined;
    });
    events.on('bikeMount', ({ on }) => {
      this.action = this.kick = undefined;
      if (!on && this.incident.crashing) this.incident.landAt(sim.player.pos);
      else {
        if (on) this.incident.reset();
        this.rider.start(on, sim.player.pos, sim.player.yaw, sim.bike);
      }
    });
    events.on('simReset', () => {
      this.action = this.kick = undefined;
      this.lookOffset = 0;
      this.rider.reset();
      this.incident.reset();
      this.work.reset();
      rig.reset();
      for (const { mesh } of this.fx) this.disposeDecal(mesh);
      this.fx.length = 0;
    });
  }

  private play(kind: ShepherdCue, duration: number, target?: Action['target']): void {
    // A physical swing takes priority over another gesture fired on the same tick.
    if (this.action?.kind === 'crook' && this.action.age < 0.20 && kind !== 'crook') return;
    this.action = { kind, age: 0, duration, target };
  }

  private decal(g: THREE.BufferGeometry, color: number, origin: Vec3Like, height: number): Fx['mesh'] {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(g, mat);
    m.position.set(origin.x, this.sim.terrain.heightAt(origin.x, origin.z) + height, origin.z);
    m.renderOrder = 5;
    this.scene.add(m);
    return m;
  }

  private disposeDecal(mesh: Fx['mesh']): void {
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  get milkingSubject() {
    return this.work.milking;
  }

  get kickstandFold(): number | undefined {
    return this.rider.kickstandFold;
  }

  get cranking(): boolean {
    return !!this.kick?.success && !this.kick.struck;
  }

  update(alpha: number, dt: number, weightShift: number): void {
    const { player: p, bike, riding } = this.sim;
    this.renderPos.set(lerp(p.prev.x, p.pos.x, alpha), lerp(p.prev.y, p.pos.y, alpha), lerp(p.prev.z, p.pos.z, alpha));
    const speed = Math.hypot(p.pos.x - p.prev.x, p.pos.z - p.prev.z) / SIM_DT;
    const yaw = p.prev.yaw + Math.atan2(Math.sin(p.yaw - p.prev.yaw), Math.cos(p.yaw - p.prev.yaw)) * alpha;
    const action = this.action;
    const progress = action ? Math.min(1, action.age / action.duration) : 0;
    const sheep = this.sim.flock.sheep.find((s) => s.freeProgress > 0);
    const interaction = sheep ? 'free' : undefined;
    const target = action?.target ?? sheep;
    let lookOffset = 0;
    if (!riding && target) {
      const dx = this.renderPos.x - target.x;
      const dz = this.renderPos.z - target.z;
      if (Math.hypot(dx, dz) > 0.05) {
        const angle = Math.atan2(dx, dz) - yaw;
        const turn = action?.target ? smoothstep(progress, 0, 0.25) * (1 - smoothstep(progress, 0.72, 1)) : 1;
        lookOffset = Math.atan2(Math.sin(angle), Math.cos(angle)) * turn * (1 - smoothstep(speed, 0.2, 1.1));
      }
    }
    this.lookOffset = lerp(this.lookOffset, lookOffset, 1 - Math.exp(-dt * 18));
    this.root.position.copy(this.renderPos);
    this.root.quaternion.setFromAxisAngle(up, yaw + this.lookOffset);

    let kickPhase = 0;
    if (this.kick && riding) {
      this.kick.age += dt;
      kickPhase = Math.min(1, this.kick.age / KICK_DURATION);
      if (kickPhase >= KICK_IMPACT && !this.kick.struck) {
        this.kick.struck = true;
        this.playKick(this.kick.success);
      }
      if (kickPhase >= 1) this.kick = undefined;
    }
    this.bikeView.setKick(kickPhase);

    const stepping = this.rider.onFootTransition;
    const rider = this.rider.update(this.root, bike, dt, riding, this.incident.crashSeat, weightShift, kickPhase);
    const incident = this.incident.update(this.root, this.renderPos, yaw + this.lookOffset, bike, dt);
    const work = this.work.update(this.root, dt, speed, !riding && !rider && !incident);
    const transitionSpeed = Math.hypot(this.root.position.x - this.previousVisualPosition.x,
      this.root.position.z - this.previousVisualPosition.z) / Math.max(dt, 1 / 240);
    this.previousVisualPosition.copy(this.root.position);
    if (rider || incident || work) this.renderPos.copy(this.root.position);
    if (riding && rider) this.renderPos.lerp(this.bikeView.renderPos, smoothstep(rider.seat, 0.72, 1));
    const speedOnFoot = stepping ? Math.min(1.6, transitionSpeed) : riding || incident || work ? 0 : Math.min(speed, p.speed);
    const lantern = this.sim.lanternOn && !riding && !rider && !incident && !work;
    this.rig.update(dt, stepping ? 'walk' : p.gait, speedOnFoot, p.grounded || stepping,
      action && { kind: action.kind, progress }, interaction, bike, rider, incident, lantern, this.groundAt, work);
    if (lantern || work) this.rig.leftHandPosition(this.hand);
    if (work) this.work.afterPose(this.hand, this.root.quaternion);
    this.lantern.update(lantern, this.hand, yaw + this.lookOffset);
    if (action) {
      action.age += dt;
      if (progress >= 1) this.action = undefined;
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        this.disposeDecal(f.mesh);
        this.fx.splice(i, 1);
        continue;
      }
      f.mesh.material.opacity = 0.55 * (1 - t);
      if (f.radius !== undefined) {
        const r = f.radius * Math.min(1, t * 1.6);
        f.mesh.scale.set(r, r, 1);
      }
    }
  }
}

import * as THREE from 'three';
import { modelMesh, modelPart } from '../render/gameModel';
import { config } from '../core/config';
import type { Flock } from './flock';
import { FORCE_KEYS, Mode, Personality, type Sheep } from './sheep';
import { SheepPose } from './sheepPose';
import type { MilkingSubject } from '../player/stationWork';

interface Coat {
  fleece: number;
  points: number;
  size: number;
}

interface SheepPaint {
  coats: Coat[];
  bellwether: Coat;
}

function appearance(s: Sheep, paint: SheepPaint) {
  if (s.personality === Personality.Bellwether) {
    const { fleece, points, size } = paint.bellwether;
    return { fleece, points, width: size * 1.03, height: size, length: size * 1.056 };
  }
  const { coats } = paint;
  const { fleece, points } = coats[(s.id * 13 + Math.floor(s.id / 7)) % coats.length];
  const juvenile = s.id % 9 === 3 || s.id % 9 === 7;
  const size = juvenile ? 0.71 + (s.id % 6) * 0.021 : 0.90 + (s.id % 8) * 0.026;
  return { fleece, points, width: size * (0.96 + (s.id % 5) * 0.028), height: size, length: size * (0.96 + (s.id % 4) * 0.027) };
}

export const MODE_COLORS: Record<Mode, number> = {
  [Mode.Graze]: 0x6fbf4a,
  [Mode.Follow]: 0x4a90e2,
  [Mode.Flee]: 0xe2574a,
  [Mode.Stuck]: 0xd64ad6,
  [Mode.Penned]: 0x9a9a9a,
  [Mode.SeekWater]: 0x69c9cf,
};

const FORCE_COLORS: Record<(typeof FORCE_KEYS)[number], number> = {
  sep: 0xff5555,
  ali: 0x55e0e0,
  coh: 0x5577ff,
  lead: 0xffd84a,
  flee: 0xff55ff,
  call: 0x9fd3ff,
  wander: 0x66dd66,
  pen: 0xaaaaaa,
  avoid: 0xff9933,
};

function markerSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 42px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.7, 0.7, 1);
  s.renderOrder = 20;
  return s;
}

/** The pale pink-cream of a freshly shorn sheep. */
const SHORN = new THREE.Color(0xf0dcc8);
const SHORN_SCALE = new THREE.Vector3(0.72, 0.76, 0.88);

export class FlockView {
  readonly root = new THREE.Group();
  private body!: THREE.InstancedMesh;
  private neck!: THREE.InstancedMesh;
  readonly halterPoint = new THREE.Vector3();
  private head!: THREE.InstancedMesh;
  private jaw!: THREE.InstancedMesh;
  private limbMeshes!: THREE.InstancedMesh[];
  private meshes: THREE.InstancedMesh[] = [];
  private poses: SheepPose[] = [];
  private tails!: THREE.InstancedMesh;
  private leader!: THREE.InstancedMesh;
  private rings!: THREE.InstancedMesh;
  private forces = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
  );
  private markers: THREE.Sprite[] = [];
  private strayMarkers: THREE.Sprite[] = [];
  private count = -1;
  private part = new THREE.Object3D();
  private readonly matrix = new THREE.Matrix4();
  private readonly paint: SheepPaint;

  constructor(
    private getFlock: () => Flock,
    private model: THREE.Group,
    private groundAt: (x: number, z: number) => number,
  ) {
    this.paint = modelPart(model, 'Aegean sheep').userData as SheepPaint;
    this.root.name = 'flock';
    this.forces.frustumCulled = false;
    this.forces.renderOrder = 15;
    this.root.add(this.forces);
  }

  private build(n: number): void {
    for (const m of this.meshes) {
      this.root.remove(m);
      m.dispose();
    }
    this.rings?.geometry.dispose();
    (this.rings?.material as THREE.Material | undefined)?.dispose();
    for (const s of [...this.markers, ...this.strayMarkers]) {
      this.root.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
    const part = (name: string, count: number) => {
      const { geometry, material } = modelMesh(this.model, name);
      const instance = new THREE.InstancedMesh(geometry, material, count);
      instance.name = name;
      instance.castShadow = instance.receiveShadow = true;
      return instance;
    };
    this.body = part('Wool', n);
    this.neck = part('Neck', n);
    this.head = part('Head', n);
    this.jaw = part('Jaw', n);
    this.limbMeshes = ['Upper sheep leg', 'Lower sheep leg', 'Cloven hoof'].map((name) => part(name, n * 4));
    this.tails = part('Tail', n);
    this.leader = part('Ram horns and bell', 1);
    this.leader.count = 0;
    this.rings = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.62, 0.78, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }),
      n,
    );
    this.rings.renderOrder = 4;
    this.meshes = [this.body, this.neck, this.head, this.jaw, ...this.limbMeshes, this.tails, this.leader, this.rings];
    for (const m of this.meshes) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.root.add(m);
    }
    this.markers = [];
    this.strayMarkers = [];
    for (let i = 0; i < n; i++) {
      const s = markerSprite('!', '#d6336c');
      s.visible = false;
      this.markers.push(s);
      const q = markerSprite('?', '#e8590c');
      q.visible = false;
      this.strayMarkers.push(q);
      this.root.add(s, q);
    }
    this.poses = Array.from({ length: n }, () => new SheepPose(this.model, this.groundAt));
    this.count = n;
  }

  update(alpha: number, dt: number, time: number, motionDt = dt, milk?: MilkingSubject): void {
    const flock = this.getFlock();
    const sheep = flock.sheep;
    if (sheep.length !== this.count) this.build(sheep.length);
    const showModes = config.debug.showSheepModes;
    this.rings.visible = showModes;
    const c = new THREE.Color();
    this.leader.count = 0;

    sheep.forEach((s: Sheep, i) => {
      const pose = this.poses[i];
      const look = appearance(s, this.paint);
      pose.root.scale.set(look.width, look.height, look.length);
      pose.update(s, alpha, motionDt, milk);
      const { x, y, z } = pose.root.position;

      const body = this.matrix.copy(pose.wool.matrixWorld);
      if (s.shorn) body.scale(SHORN_SCALE);
      this.body.setMatrixAt(i, body);
      this.body.setColorAt(i, s.shorn ? c.setHex(look.fleece).lerp(SHORN, 0.75) : c.setHex(look.fleece));
      this.neck.setMatrixAt(i, pose.neck.matrixWorld);
      if (s.led) this.halterPoint.set(0, 0.036, -0.198).applyMatrix4(pose.neck.matrixWorld);
      this.neck.setColorAt(i, c.setHex(look.fleece));
      this.tails.setMatrixAt(i, pose.tail.matrixWorld);
      this.tails.setColorAt(i, c);

      this.head.setMatrixAt(i, pose.head.matrixWorld);
      this.head.setColorAt(i, c.setHex(look.points));
      this.jaw.setMatrixAt(i, pose.jaw.matrixWorld);
      this.jaw.setColorAt(i, c);
      if (s.isLeader) {
        this.leader.count = 1;
        this.leader.setMatrixAt(0, pose.horns.matrixWorld);
      }

      for (const [k, { upper, lower, paw }] of pose.gait.legs.entries()) {
        const index = i * 4 + k;
        this.limbMeshes[0].setMatrixAt(index, upper.matrixWorld);
        this.limbMeshes[1].setMatrixAt(index, lower.matrixWorld);
        this.limbMeshes[2].setMatrixAt(index, paw.matrixWorld);
        for (const mesh of this.limbMeshes) mesh.setColorAt(index, c);
      }

      if (showModes) {
        this.part.position.y = 0.06;
        this.part.updateMatrix();
        this.rings.setMatrixAt(i, this.matrix.multiplyMatrices(pose.root.matrixWorld, this.part.matrix));
        this.rings.setColorAt(i, c.setHex(MODE_COLORS[s.mode]));
      }

      const mk = this.markers[i];
      mk.visible = s.stuck !== 'none';
      if (mk.visible) {
        const pulse = 1 + 0.15 * Math.sin(time * 6) + s.freeProgress * 0.4;
        mk.scale.set(0.7 * pulse, 0.7 * pulse, 1);
        mk.position.set(x, y + 1.58 * look.height, z);
      }
      const q = this.strayMarkers[i];
      q.visible = showModes && s.isStray;
      if (q.visible) q.position.set(x, y + 1.58 * look.height, z);
    });

    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // Steering vectors (scaled: 1 unit of weighted force = 1.5 m).
    this.forces.visible = config.debug.showSheepForces;
    if (this.forces.visible) {
      const nF = FORCE_KEYS.length;
      const pos = new Float32Array(sheep.length * nF * 6);
      const col = new Float32Array(sheep.length * nF * 6);
      let k = 0;
      sheep.forEach((s) => {
        const y = s.y + 1.1;
        FORCE_KEYS.forEach((key, f) => {
          const fx = s.forces[f * 2] * 1.5;
          const fz = s.forces[f * 2 + 1] * 1.5;
          c.setHex(FORCE_COLORS[key]);
          pos.set([s.x, y, s.z, s.x + fx, y, s.z + fz], k * 6);
          col.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
          k++;
        });
      });
      const g = this.forces.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
  }
}

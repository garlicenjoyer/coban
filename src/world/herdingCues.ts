// Herding made visible: what the shepherd's voice and crook reach, and who is listening.
//
//   call   a warm ring runs out over the ground to the call's 15 m reach and fades: the
//          sheep inside it heard you.
//   crook  a rust-coloured fan sweeps across the 6 m cone in front of you: the sheep in it
//          are pushed away from you.
//   follow a small warm light rides above each sheep that is following your call, fading
//          as she loses interest: call again when the lights go out.
//
// The same warm colour ties the call to the sheep it caught. Ground shapes are draped over
// the terrain and drawn over the grass (no depth test), so tall grass can't hide them.

import * as THREE from 'three';
import type { EventBus, GameEvents } from '../core/events';
import type { Sheep } from '../flock/sheep';

const CALL = new THREE.Color(0xffe2a0);
const CROOK = new THREE.Color(0xffa57a);
const LIFT = 0.18;

export const herdingCueSettings = { enabled: true };

const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface CallFx {
  x: number;
  z: number;
  r: number;
  age: number;
}

interface CrookFx {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  range: number;
  half: number;
  age: number;
}

const CALL_EXPAND = 0.5;
const CALL_LIFE = 1.5;
const CROOK_SWEEP = 0.16;
const CROOK_LIFE = 0.6;

/** A flat ring of `seg` quads, its vertices re-draped each frame. */
class RingMesh {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  constructor(
    private seg: number,
    color: THREE.Color,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((seg + 1) * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
  }

  set(x: number, z: number, r: number, width: number, opacity: number, groundAt: (x: number, z: number) => number): void {
    const p = this.pos;
    for (let i = 0; i <= this.seg; i++) {
      const a = (i / this.seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (let k = 0; k < 2; k++) {
        const rr = Math.max(0, r + (k ? width : -width) / 2);
        const vx = x + c * rr;
        const vz = z + s * rr;
        const o = (i * 2 + k) * 3;
        p[o] = vx;
        p[o + 1] = groundAt(vx, vz) + LIFT;
        p[o + 2] = vz;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    this.mesh.visible = opacity > 0.01;
  }
}

/** A draped fan (sector) with per-vertex alpha, for the crook's sweep. */
class FanMesh {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private static A = 18;
  private static R = 5;
  constructor(color: THREE.Color) {
    const A = FanMesh.A;
    const R = FanMesh.R;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((A + 1) * (R + 1) * 3);
    this.col = new Float32Array((A + 1) * (R + 1) * 4);
    for (let i = 0; i < (A + 1) * (R + 1); i++) this.col.set([color.r, color.g, color.b, 0], i * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let a = 0; a < A; a++)
      for (let r = 0; r < R; r++) {
        const v = a * (R + 1) + r;
        idx.push(v, v + 1, v + R + 1, v + 1, v + R + 2, v + R + 1);
      }
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
  }

  set(f: CrookFx, groundAt: (x: number, z: number) => number): void {
    const A = FanMesh.A;
    const R = FanMesh.R;
    const sweep = easeOut(Math.min(1, f.age / CROOK_SWEEP));
    const fade = f.age < CROOK_SWEEP ? 1 : Math.max(0, 1 - (f.age - CROOK_SWEEP) / (CROOK_LIFE - CROOK_SWEEP));
    const base = Math.atan2(f.dirZ, f.dirX);
    const r0 = 0.9;
    for (let a = 0; a <= A; a++) {
      const u = a / A; // 0..1 across the cone, swept from one side to the other
      const ang = base - f.half + u * f.half * 2;
      const lit = u <= sweep ? 1 : 0;
      for (let r = 0; r <= R; r++) {
        const v = r / R;
        const rr = r0 + (f.range - r0) * v;
        const x = f.x + Math.cos(ang) * rr;
        const z = f.z + Math.sin(ang) * rr;
        const i = a * (R + 1) + r;
        this.pos.set([x, groundAt(x, z) + LIFT, z], i * 3);
        // Stronger toward the rim and the side edges, so the shape reads as a cone.
        const edge = Math.max(v ** 2, Math.abs(u - 0.5) > 0.45 ? 0.6 : 0);
        this.col[i * 4 + 3] = lit * fade * (0.12 + 0.5 * edge);
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    this.mesh.visible = fade > 0.01;
  }
}

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class HerdingCues {
  readonly root = new THREE.Group();
  private calls: CallFx[] = [];
  private crooks: CrookFx[] = [];
  private callRings = [new RingMesh(72, CALL), new RingMesh(72, CALL)];
  private fans = [new FanMesh(CROOK), new FanMesh(CROOK)];
  private dots: THREE.Sprite[] = [];
  private dotTex = dotTexture();

  constructor(
    events: EventBus<GameEvents>,
    private groundAt: (x: number, z: number) => number,
    private sheep: () => Sheep[],
    /** Seconds a call keeps a sheep following (for the light's fade). */
    private followSeconds: number,
  ) {
    this.root.name = 'herding cues';
    for (const r of this.callRings) this.root.add(r.mesh);
    for (const f of this.fans) this.root.add(f.mesh);
    events.on('call', (e) => {
      this.calls.unshift({ x: e.origin.x, z: e.origin.z, r: e.radius, age: 0 });
      this.calls.length = Math.min(this.calls.length, this.callRings.length);
    });
    events.on('crookWave', (e) => {
      this.crooks.unshift({ x: e.origin.x, z: e.origin.z, dirX: e.dirX, dirZ: e.dirZ, range: e.range, half: e.halfAngle, age: 0 });
      this.crooks.length = Math.min(this.crooks.length, this.fans.length);
    });
    events.on('simReset', () => {
      this.calls.length = 0;
      this.crooks.length = 0;
    });
  }

  /** `dt`: world seconds (0 while paused); `alpha`: the render interpolation. */
  update(dt: number, alpha: number): void {
    const on = herdingCueSettings.enabled;
    this.root.visible = on;
    if (!on) return;

    this.callRings.forEach((ring, i) => {
      const c = this.calls[i];
      if (!c) return void (ring.mesh.visible = false);
      c.age += dt;
      const t = c.age;
      const r = c.r * easeOut(Math.min(1, t / CALL_EXPAND));
      const opacity = t < CALL_EXPAND ? 0.75 : Math.max(0, 0.75 * (1 - (t - CALL_EXPAND) / (CALL_LIFE - CALL_EXPAND)));
      ring.set(c.x, c.z, r, 0.5 + 0.4 * (1 - Math.min(1, t / CALL_EXPAND)), opacity, this.groundAt);
    });
    this.calls = this.calls.filter((c) => c.age < CALL_LIFE);

    this.fans.forEach((fan, i) => {
      const f = this.crooks[i];
      if (!f) return void (fan.mesh.visible = false);
      f.age += dt;
      fan.set(f, this.groundAt);
    });
    this.crooks = this.crooks.filter((f) => f.age < CROOK_LIFE);

    // Who is following: a light over her head that fades with her interest.
    const sheep = this.sheep();
    while (this.dots.length < sheep.length) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dotTex, color: CALL, transparent: true, depthWrite: false }));
      s.scale.set(0.34, 0.34, 1);
      s.renderOrder = 13;
      this.dots.push(s);
      this.root.add(s);
    }
    this.dots.forEach((d, i) => {
      const s = sheep[i];
      const k = s ? Math.min(1, s.callTimer / Math.max(0.5, this.followSeconds * 0.35)) : 0;
      d.visible = k > 0.02;
      if (!d.visible) return;
      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha;
      const z = s.pz + (s.z - s.pz) * alpha;
      d.position.set(x, y + 1.55, z);
      d.material.opacity = 0.9 * k;
    });
  }
}

import * as THREE from 'three';
import { modelPart } from '../render/gameModel';
import { QuadrupedGait } from '../render/quadrupedGait';
import { config } from '../core/config';
import type { BarkKind, EventBus } from '../core/events';
import type { Kangal } from './kangal';

const BARK_COLORS: Record<BarkKind, string> = {
  alert: '#f2c94c',
  warning: '#f2994a',
  attack: '#eb5757',
  happy: '#6fcf97',
  found: '#56ccf2',
};

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

function textSprite(text: string, color: string, bg = 'rgba(20,18,14,0.6)'): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = '600 44px system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 32;
  c.width = w;
  c.height = 72;
  g.font = '600 44px system-ui, sans-serif';
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 4, w, 64, 14);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 16, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set((0.5 * w) / 72, 0.5, 1);
  s.renderOrder = 20;
  return s;
}

interface Fx {
  obj: THREE.Object3D;
  age: number;
  life: number;
  kind: 'ring' | 'word';
}

export class DogView {
  readonly root: THREE.Group;
  private readonly body: THREE.Object3D;
  private readonly headPivot: THREE.Object3D;
  private readonly earL: THREE.Object3D;
  private readonly earR: THREE.Object3D;
  private readonly jaw: THREE.Object3D;
  private readonly tail: THREE.Object3D;
  private readonly gait: QuadrupedGait;
  private rest = 0;
  private fx: Fx[] = [];
  private label: THREE.Sprite | null = null;
  private labelText = '';
  readonly renderPos = new THREE.Vector3();
  /** Collars bought in the village: a plain tick collar, or the iron-spiked tasma. */
  private readonly tickCollar: THREE.Object3D;
  private readonly tasma: THREE.Object3D;

  constructor(
    private scene: THREE.Scene,
    private getDog: () => Kangal,
    events: EventBus,
    model: THREE.Group,
    groundAt: (x: number, z: number) => number,
  ) {
    this.root = model;
    this.body = modelPart(model, 'Body');
    this.headPivot = modelPart(model, 'Head');
    this.earL = modelPart(model, 'Ear left');
    this.earR = modelPart(model, 'Ear right');
    this.jaw = modelPart(model, 'Jaw');
    this.tail = modelPart(model, 'Tail');
    this.gait = new QuadrupedGait(this.root, this.body, groundAt);
    scene.add(this.root);
    this.tickCollar = modelPart(this.body, 'Plain tick collar');
    this.tasma = modelPart(this.body, 'Spiked tasma');
    this.tickCollar.visible = this.tasma.visible = false;
    events.on('simReset', () => {
      this.rest = 0;
      this.gait.reset();
    });

    events.on('bark', (e) => {
      const d = this.getDog();
      const y = d.y + 0.9;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: BARK_COLORS[e.kind], transparent: true, depthWrite: false }),
      );
      ring.position.set(e.x, y - 0.7, e.z);
      this.scene.add(ring);
      this.fx.push({ obj: ring, age: 0, life: 0.7, kind: 'ring' });
      const word = textSprite(e.kind === 'happy' ? 'wuff ♥' : e.kind === 'attack' ? 'GRRAWF!' : 'WOOF', BARK_COLORS[e.kind]);
      word.position.set(e.x, y + 0.9, e.z);
      this.scene.add(word);
      this.fx.push({ obj: word, age: 0, life: 1.1, kind: 'word' });
    });
  }

  update(alpha: number, dt: number, motionDt = dt): void {
    const d = this.getDog();
    const x = d.px + (d.x - d.px) * alpha;
    const y = d.py + (d.y - d.py) * alpha;
    const z = d.pz + (d.z - d.pz) * alpha;
    const h = lerpAngle(d.prevHeading, d.heading, alpha);
    this.renderPos.set(x, y, z);
    this.root.position.set(x, y, z);
    this.root.rotation.y = h + Math.PI;

    const { lerp } = THREE.MathUtils;
    this.rest = lerp(this.rest, d.lying ? 1 : 0, 1 - Math.exp(-dt * 6));
    this.gait.advance(motionDt);
    const stride = this.gait.phase;
    const effort = THREE.MathUtils.smoothstep(this.gait.speed, 0.06, 1.45) * (1 - this.rest);
    const bound = this.gait.bound;
    const bob = Math.cos(stride * 2 - 0.6) * effort * 0.012 + Math.sin(stride) * bound * 0.044;
    const bodyY = lerp(0.66 - effort * 0.068 - bound * 0.037 + bob, 0.302, this.rest);
    const breath = Math.sin(d.time * (d.exhausted ? 9 : 3.4));
    const pitch = this.gait.groundPitch * (1 - this.rest) + Math.cos(stride) * effort * (0.031 + 0.102 * bound);
    this.body.position.y = bodyY + breath * 0.005;
    this.body.rotation.set(pitch, 0, this.gait.groundRoll * (1 - this.rest) + Math.sin(stride) * effort * (1 - bound) * 0.030);
    this.headPivot.position.set(0, bodyY + lerp(0.26, 0.146, this.rest) - pitch * 0.50, -0.58);
    const alert = d.active === 'threat' || d.ackTimer > 0;
    const barkAge = d.time - d.lastBarkTime;
    const bark = barkAge < 0.32 ? Math.sin(barkAge / 0.32 * Math.PI) : 0;
    this.headPivot.rotation.x = lerp(alert ? -0.19 : 0.055, 0.12, this.rest) + pitch * 0.30 - bark * 0.14;
    this.jaw.rotation.x = -bark * 0.57 - (d.exhausted ? 0.18 + 0.062 * breath : effort * 0.13);
    const flick = d.ackTimer > 0 ? Math.sin((d.ackTimer / config.dog.ackSeconds) * Math.PI * 3) * 0.43 : 0;
    // Hungry or thirsty: ears go back and the head hangs a little.
    const need = d.care.need;
    this.headPivot.rotation.x += need * 0.18 * (1 - this.rest);
    this.earL.rotation.z = -0.14 - need * 0.25 + flick - Math.sin(stride) * effort * 0.07;
    this.earR.rotation.z = 0.14 + need * 0.25 - flick + Math.sin(stride) * effort * 0.07;

    const happy = d.praiseTimer > 0 || d.lastBarkKind === 'happy' && barkAge < 2.2;
    this.tail.position.y = bodyY + 0.144 + pitch * 0.47;
    // The tail carries his mood: high when alert or pleased, low when he is in need.
    this.tail.rotation.x = lerp(d.exhausted ? 0.73 : alert || happy ? -0.13 : 0.17 + need * 0.45, 0.62, this.rest);
    this.tail.rotation.y = Math.sin(d.time * (happy ? 12 : 3.7 - need * 2) + effort * stride) * (happy ? 0.57 : (0.15 + effort * 0.11) * (1 - need * 0.6));

    this.gait.pose(this.rest);
    // Ticks itch: a quick scratch with a hind leg behind the ear.
    if (d.scratching > 0) {
      const { upper, lower } = this.gait.legs[3];
      upper.rotation.x -= 0.9 + Math.sin(d.scratching * 40) * 0.35;
      lower.rotation.x += 0.6;
    }
    this.headPivot.rotation.z = d.scratching > 0 ? 0.25 : 0;
    this.tickCollar.visible = d.collar === 'tick';
    this.tasma.visible = d.collar === 'spiked';

    // Debug label: layer and state.
    const want = config.debug.showSheepModes ? `${d.active}: ${d.state}` : '';
    if (want !== this.labelText) {
      if (this.label) this.scene.remove(this.label);
      this.label = want ? textSprite(want, '#ffffff') : null;
      if (this.label) this.scene.add(this.label);
      this.labelText = want;
    }
    if (this.label) this.label.position.set(x, y + 1.6, z);

    for (const f of this.fx) {
      f.age += dt;
      const t = f.age / f.life;
      if (f.kind === 'ring') {
        const r = 1 + t * 10;
        f.obj.scale.set(r, 1, r);
        ((f.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
      } else {
        f.obj.position.y += dt * 0.6;
        ((f.obj as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 1 - t * t;
      }
    }
    this.fx = this.fx.filter((f) => {
      if (f.age < f.life) return true;
      this.scene.remove(f.obj);
      return false;
    });
  }
}

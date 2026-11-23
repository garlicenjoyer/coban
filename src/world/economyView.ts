// Wild herbs, ruin finds and the dairy work at the ağıl.

import * as THREE from 'three';
import { toonMaterial } from '../render/toon';
import type { Sim } from '../sim';
import { yardLayout } from './homestead';
import { activeMap, layout } from './map';
import type { Terrain } from './terrain';
import type { ValleyProps } from './valleyProps';
import { modelMesh, modelPart } from '../render/gameModel';
import type { ArtifactKind, HerbId } from '../economy/economy';

const HERB_MODELS: Record<HerbId, string> = { thyme: 'Wild thyme', sage: 'Wild sage', tea: 'Mountain tea' };
const FIND_MODELS = {
  coin: { name: 'Bronze coin', sparkle: 0.135 },
  lamp: { name: 'Clay oil lamp', sparkle: 0.212 },
  fragment: { name: 'Inscribed fragment', sparkle: 0.174 },
} satisfies Record<ArtifactKind, { name: string; sparkle: number }>;

interface FindView {
  root: THREE.Group;
  pieces: Record<ArtifactKind, THREE.Object3D>;
  glint: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  find?: Sim['finds'][number];
}

export class EconomyView {
  readonly root = new THREE.Group();
  private herbs: { id: string; group: THREE.Object3D; flowers: THREE.Object3D }[] = [];
  private churnFull: THREE.Group;
  private churnEmpty: THREE.Group;
  private finds: FindView[] = [];
  private goat: THREE.Group;
  readonly press: THREE.Group;
  readonly milkingStation: THREE.Object3D;
  private wheels: THREE.Mesh[] = [];

  constructor(private t: Terrain, private readonly props: ValleyProps, fieldProps: THREE.Group) {
    this.root.name = 'economy';
    this.herbPatches(fieldProps);
    const { churnFull, churnEmpty, station } = this.milking();
    this.milkingStation = station;
    this.churnFull = churnFull;
    this.churnEmpty = churnEmpty;
    this.press = this.cheesePress();
    this.goat = this.makeGoat();
    // Up to four finds glinting in the mud at the ruin.
    const star = new THREE.OctahedronGeometry(1);
    const mudGeometry = new THREE.CircleGeometry(0.27, 15).rotateX(-Math.PI / 2).scale(1.2, 1, 0.73);
    const mudMaterial = new THREE.MeshBasicMaterial({ color: 0x66533f, transparent: true, opacity: 0.42, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const root = new THREE.Group();
      const pieces = {
        coin: modelPart(fieldProps, FIND_MODELS.coin.name).clone(),
        lamp: modelPart(fieldProps, FIND_MODELS.lamp.name).clone(),
        fragment: modelPart(fieldProps, FIND_MODELS.fragment.name).clone(),
      };
      for (const piece of Object.values(pieces)) {
        piece.position.set(0, 0, 0);
        piece.rotation.y = i * 2.2 + 0.23;
        root.add(piece);
      }
      const glint = new THREE.Mesh(star, new THREE.MeshBasicMaterial({
        color: 0xffe8ab, transparent: true, depthWrite: false,
      }));
      const mud = new THREE.Mesh(mudGeometry, mudMaterial);
      mud.position.y = 0.008;
      root.add(mud, glint);
      root.visible = false;
      this.root.add(root);
      this.finds.push({ root, pieces, glint });
    }
  }

  /** The cheese press by the cottage and its shelf of ageing wheels (shown once bought). */
  private cheesePress(): THREE.Group {
    const p = yardLayout(layout).press;
    const g = new THREE.Group();
    g.position.set(p.x, this.ground(p.x, p.z), p.z);
    this.props.place(g, 'Cheese press and shelf', 0, 0, 0);
    for (let i = 0; i < 8; i++) {
      const wheel = this.props.place(g, 'Cheese wheel', 1, (i < 4 ? 0.49 : 0.99) + 0.062, -0.50 + (i % 4) * 0.33, i * 0.57);
      const mesh = modelMesh(wheel, 'Cheese wheel mesh');
      mesh.material = mesh.material.clone();
      this.wheels.push(mesh);
    }
    g.visible = false;
    this.root.add(g);
    return g;
  }

  private ground(x: number, z: number): number {
    return this.t.heightAt(x, z);
  }

  /** Mehmet's runaway goat: brown, with a bell and a broken rope. */
  private makeGoat(): THREE.Group {
    const g = new THREE.Group();
    const coat = toonMaterial({ color: 0x7a4e2a });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.7), coat);
    body.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.28), coat);
    head.position.set(0, 0.8, 0.42);
    const horns = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 4).rotateX(-0.5), toonMaterial({ color: 0x3a3330 }));
    horns.position.set(0, 0.96, 0.36);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), toonMaterial({ color: 0xc9a14a }));
    bell.position.set(0, 0.6, 0.38);
    g.add(body, head, horns, bell);
    for (const [x, z] of [[-0.11, 0.25], [0.11, 0.25], [-0.11, -0.25], [0.11, -0.25]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4), coat);
      leg.position.set(x, 0.2, z);
      g.add(leg);
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    g.visible = false;
    this.root.add(g);
    return g;
  }

  private herbPatches(fieldProps: THREE.Group): void {
    for (const [i, h] of (activeMap().herbs ?? []).entries()) {
      const patch = modelPart(fieldProps, HERB_MODELS[h.kind]).clone();
      patch.position.set(h.x, this.ground(h.x, h.z) - 0.028, h.z);
      patch.rotation.y = i * 2.39996;
      this.root.add(patch);
      this.herbs.push({ id: h.id, group: patch, flowers: modelPart(patch, HERB_MODELS[h.kind] + ' flowering tips') });
    }
  }

  private milking(): { churnFull: THREE.Group; churnEmpty: THREE.Group; station: THREE.Object3D } {
    const y = yardLayout(layout);
    const station = this.props.place(this.root, 'Milking station', y.milking.x, this.ground(y.milking.x, y.milking.z), y.milking.z);
    const cy = this.ground(y.churn.x, y.churn.z);
    const full = new THREE.Group();
    full.position.set(y.churn.x, cy, y.churn.z);
    this.root.add(full);
    this.props.place(full, 'Milk churn', 0, 0, 0);
    this.props.place(full, 'Churn lid', 0, 0.823, 0);
    const empty = new THREE.Group();
    empty.position.set(y.churn.x, cy + 0.85, y.churn.z);
    empty.rotation.x = Math.PI;
    this.root.add(empty);
    this.props.place(empty, 'Milk churn', 0, 0, 0);
    return { churnFull: full, churnEmpty: empty, station };
  }

  update(sim: Sim): void {
    const day = sim.tasks.day;
    for (const h of this.herbs) {
      const picked = sim.herbsPicked.get(h.id) === day;
      h.group.scale.setScalar(picked ? 0.6 : 1);
      h.flowers.visible = !picked;
    }
    this.churnFull.visible = sim.economy.churn > 0;
    this.churnEmpty.visible = sim.economy.churn <= 0;
    const t = performance.now() / 1000;
    this.finds.forEach((view, i) => {
      const find = sim.finds[i];
      const { root, pieces, glint } = view;
      root.visible = !!find;
      if (!find) {
        view.find = undefined;
        return;
      }
      if (find !== view.find) {
        view.find = find;
        const { x, z } = find;
        const step = 0.16;
        root.position.set(x, this.ground(x, z), z);
        const normal = new THREE.Vector3(this.ground(x - step, z) - this.ground(x + step, z), step * 2,
          this.ground(x, z - step) - this.ground(x, z + step)).normalize();
        root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        for (const piece of Object.values(pieces)) piece.visible = piece === pieces[find.kind];
        glint.position.set(0, FIND_MODELS[find.kind].sparkle, 0);
      }
      const pulse = Math.max(0, Math.sin(t * 3 + i * 1.7));
      glint.rotation.y = t * 2 + i;
      glint.scale.set(0.013 + 0.019 * pulse, 0.022 + 0.038 * pulse, 0.013 + 0.019 * pulse);
      glint.material.opacity = 0.36 + 0.59 * pulse;
    });
    const e = sim.economy;
    const goat = sim.goat;
    this.goat.visible = !!goat;
    if (goat) {
      this.goat.position.set(goat.x, this.ground(goat.x, goat.z), goat.z);
      this.goat.rotation.y = Math.sin(t * 0.3) * 0.8;
    }
    this.press.visible = e.has('press');
    this.wheels.forEach((w, i) => {
      const c = e.cheese[i];
      w.visible = !!c;
      if (c) ((w.material as THREE.MeshToonMaterial).color as THREE.Color).setHex(c.age >= 3 ? 0xe8d49a : 0xf4efe0);
    });
  }
}

// Wolf tracks the morning after a raid: a trail of paw prints from the forest den toward
// where the wolves went. They fade through the morning and are gone by noon.

import * as THREE from 'three';
import type { Sim } from '../sim';

const MAX = 600;

export class TracksView {
  readonly root = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private shown = -1;

  constructor(private sim: () => Sim) {
    // One paw: a pad and three toes, flat on the ground.
    const parts = [new THREE.CircleGeometry(0.07, 8)];
    for (const [x, z] of [
      [-0.06, -0.09],
      [0, -0.11],
      [0.06, -0.09],
    ])
      parts.push(new THREE.CircleGeometry(0.03, 6).translate(x, z, 0));
    const pos: number[] = [];
    for (const p of parts) pos.push(...(p.toNonIndexed().attributes.position.array as Float32Array));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.rotateX(-Math.PI / 2);
    geo.scale(2, 1, 2); // readable from the follow camera
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x3b2c20, transparent: true, opacity: 0.7, depthWrite: false }),
      MAX,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.root.add(this.mesh);
  }

  update(): void {
    const sim = this.sim();
    const day = sim.tasks.day;
    const report = sim.nightReport(day - 1);
    const morning = sim.hour < 12;
    const want = report && morning ? day : -1;
    if (want !== this.shown) {
      this.shown = want;
      this.mesh.count = 0;
      if (report && want > 0) {
        const d = new THREE.Object3D();
        let k = 0;
        for (const t of report.tracks) {
          if (k >= MAX - 1) break;
          // Two prints per step, left and right of the line.
          for (const side of [-1, 1]) {
            const ox = Math.cos(t.h) * 0.25 * side;
            const oz = -Math.sin(t.h) * 0.25 * side;
            const x = t.x + ox + side * 0.35 * Math.sin(t.h);
            const z = t.z + oz + side * 0.35 * Math.cos(t.h);
            d.position.set(x, sim.terrain.heightAt(x, z) + 0.03, z);
            d.rotation.set(0, t.h + Math.PI, 0);
            d.updateMatrix();
            this.mesh.setMatrixAt(k++, d.matrix);
          }
        }
        this.mesh.count = k;
        this.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    // Fade from dawn to noon.
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.shown > 0 ? 0.7 * Math.max(0, Math.min(1, (12 - sim.hour) / 4)) : 0;
  }
}

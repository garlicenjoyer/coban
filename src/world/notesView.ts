// Uncle Ahmet's notes in the world: a folded square of paper weighted with a flat stone,
// or, for the letter, lying on the porch table. Drawn only; reading them is the sim's job.

import * as THREE from 'three';
import { toonMaterial } from '../render/toon';
import { activeMap, type MapProps } from './map';
import type { Terrain } from './terrain';

export class NotesView {
  readonly root = new THREE.Group();

  constructor(terrain: Terrain, map: MapProps) {
    this.root.name = 'ahmetNotes';
    const paperMat = toonMaterial({ color: 0xf2ead2, side: THREE.DoubleSide });
    const stoneMat = toonMaterial({ color: 0x9a8f80 });
    const half = new THREE.PlaneGeometry(0.17, 0.24).rotateX(-Math.PI / 2);
    const stoneGeo = new THREE.IcosahedronGeometry(0.1, 0).scale(1.3, 0.55, 1);
    for (const n of activeMap().notes ?? []) {
      // Rest on whatever box is under it (the porch table), else on the ground.
      let y = terrain.heightAt(n.x, n.z);
      let onTable = false;
      for (const p of map.props) {
        if (p.kind === 'box' && Math.abs(n.x - p.x) <= p.hx && Math.abs(n.z - p.z) <= p.hz && p.y + p.hy > y) {
          y = p.y + p.hy;
          onTable = true;
        }
      }
      const note = new THREE.Group();
      note.position.set(n.x, y + 0.012, n.z);
      note.rotation.y = (n.x * 1.7 + n.z) % (Math.PI * 2);
      if (n.id === 'letter' && onTable) {
        note.position.x -= 0.022;
        note.position.z -= 0.09;
        note.rotation.y = 0;
        note.scale.setScalar(0.74);
      }
      // Two halves of a folded sheet, opened a little like a tent.
      for (const side of [-1, 1]) {
        const leaf = new THREE.Mesh(half, paperMat);
        leaf.position.x = side * 0.083;
        leaf.rotation.z = side * -0.18;
        leaf.position.y = 0.012;
        leaf.receiveShadow = true;
        note.add(leaf);
      }
      if (!onTable) {
        const stone = new THREE.Mesh(stoneGeo, stoneMat);
        stone.position.set(0.02, 0.05, 0.03);
        stone.castShadow = true;
        note.add(stone);
      }
      this.root.add(note);
    }
  }
}

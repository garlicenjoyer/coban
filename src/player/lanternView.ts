import * as THREE from 'three';
import { toonMaterial } from '../render/toon';

export class LanternView {
  private readonly model = new THREE.Group();
  private readonly light = new THREE.PointLight(0xffbc72, 0, 17, 1.65);

  constructor(scene: THREE.Scene) {
    const metal = toonMaterial({ color: 0x43382f });
    const glass = new THREE.MeshBasicMaterial({ color: 0xffc36b });
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.008, 6, 16), metal);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.086, 0.036, 10), metal);
    cap.position.y = -0.08;
    const chamber = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.073, 0.13, 10), glass);
    chamber.position.y = -0.16;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.076, 0.085, 0.035, 10), metal);
    base.position.y = -0.237;
    this.model.add(handle, cap, chamber, base);
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 5), metal);
      const angle = (i + 0.5) * Math.PI / 2;
      bar.position.set(Math.cos(angle) * 0.073, -0.156, Math.sin(angle) * 0.073);
      this.model.add(bar);
    }
    this.model.name = 'Shepherd’s lantern';
    this.model.visible = false;
    this.light.name = 'Lantern light';
    scene.add(this.model, this.light);
  }

  update(lit: boolean, hand: THREE.Vector3, yaw: number): void {
    this.model.visible = lit;
    this.light.intensity = lit ? 12 : 0;
    if (!lit) return;
    this.model.position.copy(hand);
    this.model.rotation.y = yaw;
    this.light.position.copy(hand);
    this.light.position.y -= 0.16;
  }
}

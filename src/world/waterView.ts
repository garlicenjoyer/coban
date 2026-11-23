import * as THREE from 'three';
import { toonMaterial } from '../render/toon';
import type { Terrain } from './terrain';
import { CAN_LITERS, RACK_CANS, type WaterPoint, type WaterSupply } from './water';

export class WaterView {
  readonly root = new THREE.Group();
  private readonly views = new Map<number, { model: THREE.Group; surface: THREE.Mesh }>();
  private readonly stone = toonMaterial({ color: 0xb9ac8c });
  private readonly canvas = toonMaterial({ color: 0x385d69, side: THREE.DoubleSide });
  private readonly water = toonMaterial({ color: 0x7ab9c9, emissive: 0x112026 });

  constructor(private readonly terrain: Terrain) {
    this.root.name = 'Water sources';
  }

  reset(): void {
    for (const { model } of this.views.values()) {
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    }
    this.root.clear();
    this.views.clear();
  }

  private build(point: WaterPoint) {
    const { radius: r } = point;
    const portable = point.kind === 'basin';
    const spring = point.kind === 'spring';
    const height = portable ? 0.25 : 0.38;
    const rim = new THREE.Mesh(
      new THREE.LatheGeometry([
        new THREE.Vector2(r * 0.74, 0),
        new THREE.Vector2(r * 0.79, height),
        new THREE.Vector2(r, height),
        new THREE.Vector2(r * 0.92, 0),
      ], spring ? 14 : 20),
      portable ? this.canvas : this.stone,
    );
    rim.castShadow = true;
    const surface = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.79, r * 0.79, 0.025, 24), this.water);
    surface.position.y = height - 0.035;
    const model = new THREE.Group();
    model.name = point.name;
    model.position.set(point.x, this.terrain.heightAt(point.x, point.z), point.z);
    model.add(rim, surface);
    this.root.add(model);
    return { model, surface };
  }

  update(supply: WaterSupply): void {
    for (const point of supply.points) {
      // The fountain already has a basin and a running stream in the environment.
      if (point.kind === 'fountain') continue;
      let view = this.views.get(point.id);
      if (!view) {
        view = this.build(point);
        this.views.set(point.id, view);
      }
      if (point.liters !== null) {
        view.surface.visible = point.liters > 0;
        view.surface.position.y = 0.08 + 0.14 * Math.min(1, point.liters / (RACK_CANS * CAN_LITERS));
      }
    }
  }
}

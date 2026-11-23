import * as THREE from 'three';
import { modelPart } from '../render/gameModel';
import type { Terrain } from '../world/terrain';
import type { Errands, ErrandProp } from './errands';
import type { ResidentId } from '../world/mapTypes';

const models: Record<ErrandProp, string> = {
  olives: 'Olive basket',
  stones: 'Loose stones',
  cans: 'Milk can crate',
  broom: 'Broom and leaves',
};

export class ErrandsView {
  readonly root = new THREE.Group();
  private readonly sites: {
    resident: ResidentId;
    index: number;
    active: THREE.Object3D;
    finished?: THREE.Object3D;
  }[] = [];

  constructor(errands: Errands, terrain: Terrain, library: THREE.Group) {
    this.root.name = 'Valley errand sites';
    for (const { resident, stops } of errands.definitions) {
      stops.forEach((stop, index) => {
        const place = (model: string) => {
          const prop = modelPart(library, model).clone(true);
          prop.position.set(stop.x, terrain.heightAt(stop.x, stop.z), stop.z);
          prop.rotation.y = index % 2 ? -0.32 : 0.14;
          prop.visible = false;
          this.root.add(prop);
          return prop;
        };
        const active = place(models[stop.prop]);
        const final = index === stops.length - 1;
        const finished = stop.prop === 'stones' ? place('Restacked stones')
          : final && (stop.prop === 'cans' || stop.prop === 'olives') ? place(models[stop.prop]) : undefined;
        if (finished && stop.prop === 'olives') {
          const other = modelPart(library, 'Olive basket').clone(true);
          other.position.x = 0.5;
          other.rotation.y = 0.6;
          finished.add(other);
        }
        this.sites.push({ resident, index, active, finished });
      });
    }
  }

  update(errands: Errands): void {
    for (const { resident, index, active, finished } of this.sites) {
      const step = errands.status(resident);
      active.visible = step === index;
      if (finished) finished.visible = step !== undefined && step > index;
    }
  }
}

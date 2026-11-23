import * as THREE from 'three';
import { modelPart } from '../render/gameModel';

type PropName = 'Porch tea table' | 'Porch bench' | 'Cafe tea table' | 'Cafe tea counter' | 'Wooden stool'
  | 'Milking station' | 'Milk churn' | 'Churn lid' | 'Cheese press and shelf' | 'Cheese wheel';

export class ValleyProps {
  constructor(private readonly library: THREE.Group) {}

  place(parent: THREE.Object3D, name: PropName, x: number, y: number, z: number, yaw = 0): THREE.Object3D {
    const prop = modelPart(this.library, name).clone();
    prop.position.set(x, y, z);
    prop.rotation.y = yaw;
    parent.add(prop);
    return prop;
  }
}

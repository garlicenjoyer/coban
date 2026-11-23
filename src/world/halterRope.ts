import * as THREE from 'three';
import { modelMesh } from '../render/gameModel';

export class HalterRope {
  readonly mesh: THREE.Mesh;
  private readonly rest: THREE.BufferAttribute;
  private readonly restNormals: THREE.BufferAttribute;
  private readonly positions: THREE.BufferAttribute;
  private readonly normals: THREE.BufferAttribute;
  private readonly delta = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly binormal = new THREE.Vector3();
  private readonly vertex = new THREE.Vector3();

  constructor(library: THREE.Group) {
    const template = modelMesh(library, 'Braided line');
    this.rest = template.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.restNormals = template.geometry.getAttribute('normal') as THREE.BufferAttribute;
    this.mesh = new THREE.Mesh(template.geometry.clone(), template.material);
    this.mesh.name = 'Halter rope';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.positions = (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.normals = (this.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
  }

  update(from: THREE.Vector3, to: THREE.Vector3): void {
    const { delta, across, tangent, binormal, vertex } = this;
    delta.subVectors(to, from);
    const sag = Math.min(0.28, delta.length() * 0.19);
    across.set(delta.z, 0, -delta.x);
    if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
    across.normalize();
    const { positions, normals } = this;
    this.mesh.position.copy(from);

    // The narrow vertex-painted strands follow the same sagging curve, keeping their width.
    for (let i = 0; i < this.rest.count; i++) {
      const t = this.rest.getY(i);
      tangent.copy(delta);
      tangent.y -= 4 * sag * (1 - 2 * t);
      if (tangent.lengthSq() < 1e-8) tangent.set(0, 1, 0);
      tangent.normalize();
      binormal.crossVectors(across, tangent);
      vertex.copy(delta).multiplyScalar(t);
      vertex.y -= 4 * sag * t * (1 - t);
      vertex.addScaledVector(across, this.rest.getX(i)).addScaledVector(binormal, this.rest.getZ(i));
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
      vertex.copy(across).multiplyScalar(this.restNormals.getX(i)).addScaledVector(tangent, this.restNormals.getY(i))
        .addScaledVector(binormal, this.restNormals.getZ(i));
      normals.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    positions.needsUpdate = normals.needsUpdate = true;
  }
}

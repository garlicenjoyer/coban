import * as THREE from 'three';

export function jointsOf(root: THREE.Object3D): (name: string) => THREE.Object3D {
  const joints = new Map<string, THREE.Object3D>();
  // A catalogue can repeat joint names. GLTFLoader preserves the authored name in userData.
  root.traverse((node) => {
    if (typeof node.userData.name === 'string') joints.set(node.userData.name, node);
  });
  return (name) => {
    const joint = joints.get(name);
    if (!joint) throw new Error(`${root.name}: missing joint "${name}"`);
    return joint;
  };
}

/** Solve around the anatomical knee or elbow bend while keeping the hand or foot on target. */
export function reachLimb(upper: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3): void {
  const origin = upper.getWorldPosition(new THREE.Vector3());
  const joint = mid.getWorldPosition(new THREE.Vector3());
  const tip = end.getWorldPosition(new THREE.Vector3());
  const a = origin.distanceTo(joint), b = joint.distanceTo(tip);
  const dir = target.sub(origin);
  const distance = THREE.MathUtils.clamp(dir.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
  dir.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  pole.addScaledVector(dir, -pole.dot(dir)).normalize();
  const bend = origin.clone().addScaledVector(dir, along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
  const reachable = origin.addScaledVector(dir, distance);
  const aim = (bone: THREE.Object3D, child: THREE.Object3D, world: THREE.Vector3) => {
    const direction = bone.parent!.worldToLocal(world).sub(bone.position).normalize();
    bone.quaternion.setFromUnitVectors(child.position.clone().normalize(), direction);
  };
  aim(upper, mid, bend);
  aim(mid, end, reachable);
}

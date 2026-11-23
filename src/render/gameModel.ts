import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toonMaterial } from './toon';

const loader = new GLTFLoader();

export async function loadGameModel(filename: string): Promise<THREE.Group> {
  const { scene } = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${filename}.glb`);
  const paint = toonMaterial({ vertexColors: true });
  let skinPaint: THREE.MeshToonMaterial | undefined;
  const sourceMaterials = new Set<THREE.Material>();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    sourceMaterials.add(node.material as THREE.Material);
    if (node instanceof THREE.SkinnedMesh) {
      skinPaint ??= toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
      node.material = skinPaint;
    } else node.material = paint;
    node.castShadow = node.receiveShadow = true;
  });
  for (const material of sourceMaterials) material.dispose();
  return scene;
}

export function modelPart(model: THREE.Object3D, name: string): THREE.Object3D {
  const part = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  if (!part) throw new Error(`${model.name}: missing model part "${name}"`);
  return part;
}

export function modelMesh(model: THREE.Object3D, name: string): THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial> {
  const node = modelPart(model, name);
  if (!(node instanceof THREE.Mesh)) throw new Error(`${name} must be a mesh`);
  return node;
}

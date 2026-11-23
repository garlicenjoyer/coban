// Cel shading: one shared four-step light ramp for every material, so the whole world
// shares the same banding. Shadows are tinted warm by the lighting setup (see style.ts).

import * as THREE from 'three';

let ramp: THREE.DataTexture | null = null;

/** Four soft bands: shade, half-shade, lit, highlight. */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const steps = [92, 150, 214, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  ramp = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/** Drop-in replacement for MeshLambertMaterial with cel shading. */
export function toonMaterial(params: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params });
}

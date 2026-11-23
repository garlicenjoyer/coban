// The land beyond the map: rolling ground out to the horizon and three layers of hill
// silhouettes (cut-paper style) that the aerial-perspective haze fades into the sky, plus
// a glimpse of the Aegean to the west. This is most of what makes the valley read as big.

import * as THREE from 'three';
import { fbm } from '../world/noise';
import { toonMaterial } from './toon';

const WEST = Math.PI; // angle of -x in the xz-plane, measured as atan2(z, x)

/** How much a direction is "toward the sea" (west, a little south), 0..1. */
function seaness(a: number): number {
  let d = a - (WEST - 0.25);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.max(0, 1 - Math.abs(d) / 0.75);
}

function hillRing(radius: number, height: number, roughness: number, color: number, seed: number, seaCut: number): THREE.Mesh {
  const seg = 360;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const n = fbm(Math.cos(a) * roughness + seed, Math.sin(a) * roughness - seed, 4, seed);
    const h = Math.max(4, height * (0.55 + 0.6 * n) * (1 - seaCut * seaness(a)));
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    pos.push(x, -30, z, x, h, z);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  return m;
}

/** `half` = half the map's side: the skirt starts past the corners, the rest scales with it. */
export function createBackdrop(half = 200): THREE.Group {
  const root = new THREE.Group();
  root.name = 'backdrop';

  // Ground skirt from just past the map's corners (the rim hills hide the seam) out to
  // the far hills, gently rolling.
  const inner = half * 1.42 + 1;
  const k = Math.max(1, (inner + 535) / 820);
  const skirt = new THREE.RingGeometry(inner, 2600 * k, 96, 12);
  skirt.rotateX(-Math.PI / 2);
  const p = skirt.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const toSea = seaness(a) * Math.min(1, Math.max(0, (r - inner - 165) / 300));
    p.setY(i, (10 + 12 * fbm(x / 260, z / 260, 3, 77) + Math.min(14, (r - inner) * 0.02)) * (1 - 0.95 * toSea));
  }
  skirt.computeVertexNormals();
  const ground = new THREE.Mesh(skirt, toonMaterial({ color: 0xa6c06a }));
  ground.receiveShadow = false;
  root.add(ground);

  // The Aegean, west beyond the near hills.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8cc4d6 }));
  sea.position.set(-(2500 + inner + 300), 2, 0);
  root.add(sea);

  // Silhouette layers, nearer = greener and darker; the haze lightens them further.
  root.add(hillRing(820 * k, 70 * k, 3.2, 0x8f9f6c, 3, 0.85));
  root.add(hillRing(1400 * k, 150 * k, 2.4, 0x9aa98a, 9, 0.75));
  root.add(hillRing(2300 * k, 300 * k, 1.7, 0xa8b4a6, 17, 0.4));
  return root;
}

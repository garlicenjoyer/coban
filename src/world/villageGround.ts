import * as THREE from 'three';
import { toonMaterial } from '../render/toon';
import type { Layout } from './mapTypes';
import type { Terrain } from './terrain';
import { FOUNTAIN, pavingDistance } from './villagePlan';

const limestone = [0xb6a991, 0xc7b89b, 0xcdbd9f, 0xbba990, 0xbbafa0, 0xd1bea1, 0xb2a18d, 0xc4b6a2];
const border = [0x928674, 0xa69982, 0x9b8e7a, 0xa89881];
const palette = limestone.map((color) => new THREE.Color(color));
const edging = border.map((color) => new THREE.Color(color));

export function villagePaving(t: Terrain, village: NonNullable<Layout['village']>): THREE.Mesh {
  const positions: number[] = [], colors: number[] = [];
  let state = 78201;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const point = (x: number, z: number, y: number): [number, number, number] => {
    const wx = village.x + x, wz = village.z + z;
    return [x, t.heightAt(wx, wz) - baseHeight + y, z];
  };
  const tri = (a: number[], b: number[], c: number[], paint: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    colors.push(paint.r, paint.g, paint.b, paint.r, paint.g, paint.b, paint.r, paint.g, paint.b);
  };
  const baseHeight = t.heightAt(village.x, village.z);
  const chip = new THREE.Color();
  const bedding = new THREE.Color(0xa6987d);
  const depth = 0.76, width = 1.13;

  for (let row = -69; row < 63; row++) {
    const z = row * depth + 0.37;
    for (let col = -43; col < 60; col++) {
      const x = (col + (row & 1) * 0.48) * width;
      const d = pavingDistance(x, z);
      if (d > 0.16 || d > -0.33 && random() < 0.14) continue;
      const apron = Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z);
      const plazaFrame = Math.max(Math.abs(x + 0.34) - 14.4, Math.abs(z + 0.18) - 9.60);
      const dark = d > -0.64 || Math.abs(plazaFrame) < 0.41 || apron > 2.06 && apron < 2.46;
      const set = dark ? edging : palette;
      const color = set[Math.floor(random() * set.length)];
      const gx = x + (random() - 0.5) * 0.12, gz = z + (random() - 0.5) * 0.08;
      const w = 0.51 + random() * 0.046, h = 0.332 + random() * 0.034;
      const corners = [[-w, -h * 0.5], [-w * 0.82, -h], [w * 0.75, -h], [w, -h * 0.68],
        [w * 0.94, h * 0.67], [w * 0.71, h], [-w * 0.84, h], [-w, h * 0.59]];
      const height = 0.036 + random() * 0.016;
      const support = [[x - width / 2, z - depth / 2], [x - width / 2, z + depth / 2],
        [x + width / 2, z + depth / 2], [x + width / 2, z - depth / 2]].map(([cx, cz]) => point(cx, cz, 0.012));
      chip.copy(bedding).multiplyScalar(0.90 + random() * 0.15);
      tri(support[0], support[1], support[2], chip);
      tri(support[0], support[2], support[3], chip);
      const top = corners.map(([cx, cz]) => point(gx + cx * 0.976, gz + cz * 0.976, height));
      const base = corners.map(([cx, cz]) => point(gx + cx, gz + cz, 0.007));
      const center = point(gx, gz, height + 0.010);
      for (const [i, a] of top.entries()) {
        const j = (i + 1) % top.length;
        tri(center, top[j], a, chip.copy(color).multiplyScalar(0.94 + random() * 0.13));
        chip.copy(color).multiplyScalar(0.78 + random() * 0.12);
        tri(a, top[j], base[i], chip);
        tri(base[i], top[j], base[j], chip);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const paved = new THREE.Mesh(geometry, toonMaterial({ vertexColors: true }));
  paved.name = 'Limestone square and lanes';
  paved.position.set(village.x, baseHeight, village.z);
  paved.receiveShadow = true;
  return paved;
}

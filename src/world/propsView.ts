// Greybox props: instanced primitives for fences, thorns, trees, markers, plus
// floating text labels so testers can name places in feedback.

import * as THREE from 'three';
import { toonMaterial } from '../render/toon';
import type { Terrain } from './terrain';
import { layout, type BoxProp, type CylProp, type MapProps } from './map';

const COLORS = {
  fence: 0xa47450,
  gate: 0xbd8a59,
  trough: 0x8eaab1,
  thorn: 0x7d8c4f,
  trunk: 0x8a6446,
  canopy: 0x6e9a5a,
  marker: 0xf4efe6,
  cairn: 0xb5a690,
};

function labelSprite(text: string, color = 0xffffff): THREE.Sprite {
  const pad = 24;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = '600 56px system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  c.width = w;
  c.height = 96;
  g.font = '600 56px system-ui, sans-serif';
  g.fillStyle = 'rgba(20, 18, 14, 0.62)';
  g.beginPath();
  g.roundRect(0, 8, w, 80, 18);
  g.fill();
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.textBaseline = 'middle';
  g.fillText(text, pad, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const s = new THREE.Sprite(mat);
  const hM = 1.1; // label height in metres
  s.scale.set((hM * w) / c.height, hM, 1);
  s.renderOrder = 10;
  return s;
}

/**
 * The ağıl's gate: vertical planks on two rails with a diagonal brace, centred where the
 * gate collider is (main.ts hinges it by name).
 */
function plankGate(p: BoxProp): THREE.Group {
  const g = new THREE.Group();
  g.name = 'prop-gate';
  g.position.set(p.x, p.y, p.z);
  const wood = toonMaterial({ color: 0x9a6b42 });
  const woodDk = toonMaterial({ color: 0x74502f });
  const span = p.hz * 2;
  const h = p.hy * 2;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const ph = h * (0.94 + ((i * 37) % 5) * 0.025);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.05, ph, span / n - 0.04), i % 2 ? wood : woodDk);
    plank.position.set(0, ph / 2 - h / 2, -span / 2 + (i + 0.5) * (span / n));
    g.add(plank);
  }
  for (const y of [-h * 0.3, h * 0.3]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, span - 0.05), woodDk);
    rail.position.set(-0.06, y, 0);
    g.add(rail);
  }
  const len = Math.hypot(span - 0.2, h * 0.6);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, len), woodDk);
  brace.position.set(-0.06, 0, 0);
  brace.rotation.x = Math.atan2(h * 0.6, span - 0.2);
  g.add(brace);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}

export function createPropsView(t: Terrain, map: MapProps): THREE.Group {
  const root = new THREE.Group();
  root.name = 'props';

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const p of map.props) {
    // House, porch, walls, ruin and the trough (çeşme) have their own models.
    if (p.kind !== 'box' || p.role === 'house' || p.role === 'porch' || p.role === 'wall' || p.role === 'ruin' || p.role === 'trough' || p.role === 'building' || p.role === 'hutRuin' || p.role === 'cesme' || p.role === 'fence') continue;
    if (p.role === 'gate') {
      root.add(plankGate(p));
      continue;
    }
    const m = new THREE.Mesh(boxGeo, toonMaterial({ color: COLORS[p.role as 'fence' | 'gate' | 'trough'] }));
    m.name = `prop-${p.role}`;
    m.position.set(p.x, p.y, p.z);
    m.scale.set(p.hx * 2, p.hy * 2, p.hz * 2);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }

  const cyls = (role: CylProp['role']) => map.props.filter((p): p is CylProp => p.kind === 'cyl' && p.role === role);
  const tmp = new THREE.Object3D();

  // Thorn bushes: squat cylinders.
  const thorns = cyls('thorn');
  const thornMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1.1, 1, 9),
    toonMaterial({ color: COLORS.thorn }),
    thorns.length,
  );
  thorns.forEach((p, i) => {
    tmp.position.set(p.x, p.y + p.height / 2, p.z);
    tmp.scale.set(p.radius, p.height, p.radius);
    tmp.updateMatrix();
    thornMesh.setMatrixAt(i, tmp.matrix);
  });
  thornMesh.castShadow = thornMesh.receiveShadow = true;
  root.add(thornMesh);

  // Trees: trunk + cone canopy.
  const trunks = cyls('trunk');
  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1.2, 1, 7),
    toonMaterial({ color: COLORS.trunk }),
    trunks.length,
  );
  // Two stacked cones per pine: a simple, friendly silhouette.
  const pineGeo = (() => {
    const lower = new THREE.ConeGeometry(1, 0.62, 7).translate(0, -0.19, 0);
    const upper = new THREE.ConeGeometry(0.7, 0.55, 7).translate(0, 0.22, 0);
    const pos = [...lower.toNonIndexed().attributes.position.array, ...upper.toNonIndexed().attributes.position.array];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  })();
  const canopyMesh = new THREE.InstancedMesh(
    pineGeo,
    toonMaterial({ color: COLORS.canopy }),
    trunks.length,
  );
  trunks.forEach((p, i) => {
    tmp.position.set(p.x, p.y + p.height / 2, p.z);
    tmp.scale.set(p.radius, p.height, p.radius);
    tmp.updateMatrix();
    trunkMesh.setMatrixAt(i, tmp.matrix);
    const ch = p.height * 0.6;
    tmp.position.set(p.x, p.y + p.height - ch / 2 + 1.5, p.z);
    tmp.scale.set(2.4, ch, 2.4);
    tmp.updateMatrix();
    canopyMesh.setMatrixAt(i, tmp.matrix);
  });
  trunkMesh.castShadow = canopyMesh.castShadow = true;
  root.add(trunkMesh, canopyMesh);

  // Uncle Ahmet's cairns: three stacked, slightly offset stones.
  const cairns = cyls('cairn');
  if (cairns.length) {
    const stoneMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), toonMaterial({ color: COLORS.cairn }), cairns.length * 3);
    cairns.forEach((c, i) => {
      for (let k = 0; k < 3; k++) {
        const s = c.radius * (1 - k * 0.28);
        tmp.position.set(c.x + ((i * 7 + k * 3) % 5) * 0.03 - 0.06, c.y + c.height * (0.18 + k * 0.32), c.z);
        tmp.scale.set(s, s * 0.6, s * 0.9);
        tmp.rotation.set(0, i + k, 0);
        tmp.updateMatrix();
        stoneMesh.setMatrixAt(i * 3 + k, tmp.matrix);
      }
    });
    tmp.rotation.set(0, 0, 0);
    stoneMesh.castShadow = stoneMesh.receiveShadow = true;
    root.add(stoneMesh);
  }

  // Pasture marker poles with a coloured flag.
  for (const p of layout.pastures) {
    const y = t.heightAt(p.x, p.z);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 4, 6),
      toonMaterial({ color: COLORS.marker }),
    );
    pole.position.set(p.x, y + 2, p.z);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.7),
      toonMaterial({ color: p.color, side: THREE.DoubleSide }),
    );
    flag.position.set(p.x + 0.6, y + 3.6, p.z);
    pole.castShadow = flag.castShadow = true;
    root.add(pole, flag);
  }

  // Labels (greybox naming aid; hidden unless the debug view asks for them).
  const labels = new THREE.Group();
  labels.name = 'labels';
  for (const l of map.labels) {
    const s = labelSprite(l.text, l.color ?? 0xffffff);
    s.position.set(l.x, t.heightAt(l.x, l.z) + l.lift, l.z);
    labels.add(s);
  }
  root.add(labels);

  return root;
}

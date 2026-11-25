import { Int16BufferAttribute, Uint8BufferAttribute } from 'three';
import { group, Parts } from './model-parts.mjs';
import { HOUSE_NAMES, coffeehouse, house, minaret, mosque, planeTree } from './village-buildings.mjs';
import { bench, carpet, dealer, flowerPot, fountain, lamp, market, shopModels, terraceWall, vet } from './village-market.mjs';
import { ataturkBust, ataturkPlinth } from './village-memorial.mjs';

export function villageModels() {
  const root = group(null, 'Village model library');
  const templates = [
    ...HOUSE_NAMES.map((name, i) => [name, (p) => house(p, i)]),
    ['Coffeehouse', coffeehouse], ['Village mosque', mosque], ['Mosque minaret', minaret], ['Square plane tree', planeTree],
    ...Object.keys(shopModels).map((id) => [`Market ${id}`, (p) => market(p, id)]),
    ['Market vet', vet], ['Market dealer', dealer], ['Square fountain', fountain], ['Stone and timber bench', bench],
    ['Geranium pot', flowerPot], ['Terrace masonry', terraceWall], ['Woven rug', carpet],
  ];
  for (const [i, [name, build]] of templates.entries()) {
    const template = group(root, name, [i % 5 * 15, 0, Math.floor(i / 5) * 15]);
    const p = new Parts();
    build(p);
    p.mesh(template, name + ' painted mesh');
  }
  const fixture = group(root, 'Street lamp', [0, 0, 61]);
  const frame = new Parts(), glass = new Parts();
  lamp(frame, glass);
  frame.mesh(fixture, 'Lantern ironwork');
  glass.mesh(fixture, 'Lantern panes');
  const memorial = group(root, 'Atatürk memorial', [15, 0, 61]);
  const plinth = new Parts(), bust = new Parts();
  ataturkPlinth(plinth);
  ataturkBust(bust);
  plinth.mesh(memorial, 'Memorial plinth');
  bust.mesh(memorial, 'Atatürk carved bust');
  // Keep the high-detail set compact on the initial valley load.
  root.traverse((node) => {
    if (!node.isMesh) return;
    const geometry = node.geometry;
    const { color, normal } = geometry.attributes;
    const colors = Uint8Array.from(color.array, (value) => Math.round(Math.min(1, Math.max(0, value)) * 255));
    const normals = new Int16Array(normal.array.length);
    for (let i = 0; i < normals.length; i += 3) {
      const x = normal.array[i], y = normal.array[i + 1], z = normal.array[i + 2];
      const length = Math.hypot(x, y, z);
      const scale = 32767 / (length || 1);
      normals[i] = Math.round(x * scale);
      normals[i + 1] = length ? Math.round(y * scale) : 32767;
      normals[i + 2] = Math.round(z * scale);
    }
    geometry.setAttribute('color', new Uint8BufferAttribute(colors, 3, true));
    geometry.setAttribute('normal', new Int16BufferAttribute(normals, 3, true));
  });
  return root;
}

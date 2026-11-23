import * as T from 'three';
import { group, Parts, vec } from './model-parts.mjs';

const TAU = 2 * Math.PI;

// Folded blades catch the light along the vein and keep their silhouette from the side.
function leaf(parts, at, angle, length, width, rise, colors) {
  const forward = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const across = new T.Vector3(-forward.z, 0, forward.x);
  const base = vec(at);
  const point = (along, lateral, y) => base.clone().addScaledVector(forward, length * along)
    .addScaledVector(across, width * lateral).add(new T.Vector3(0, rise * along + y, 0));
  const points = [base, point(0.33, -0.42, 0), point(0.66, -0.39, -width * 0.13),
    point(1, 0, -width * 0.36), point(0.66, 0.39, -width * 0.13), point(0.33, 0.42, 0),
    point(0.47, 0, width * 0.27)];
  const faces = [
    [[0, 1, 6], [1, 2, 6], [2, 3, 6]],
    [[3, 4, 6], [4, 5, 6], [5, 0, 6]],
    [[0, 5, 3], [5, 4, 3], [3, 2, 0], [2, 1, 0]],
  ];
  for (const [i, triangles] of faces.entries()) {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(triangles.flatMap((tri) =>
      [tri[0], tri[2], tri[1]].flatMap((j) => points[j].toArray())), 3));
    geo.computeVertexNormals();
    parts.add(geo, colors[i], undefined, undefined, undefined, 0.075);
  }
}

const palettes = {
  thyme: [[0x7d8b56, 0x586843, 0x63774d], [0x9b9a64, 0x687749, 0x7c8552]],
  sage: [[0xb5c0a0, 0x7e9480, 0x8ca18b], [0x9cab91, 0x687e70, 0x879887]],
  tea: [[0xa6ac77, 0x778452, 0x879760], [0xc0bd87, 0x8b9c67, 0x9ba970]],
};

function thyme(foliage, flowers, random) {
  for (let i = 0; i < 38; i++) {
    const a = i * 2.4, r = 0.018 + random() * 0.29;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.12 + random() * 0.135 - r * 0.16;
    const spread = 0.068 + random() * 0.084;
    const point = (t) => [x + Math.cos(a) * spread * t, 0.012 + h * t, z + Math.sin(a) * spread * t];
    foliage.rod(point(0), point(1), 0.006, 0.0027, i % 3 === 0 ? 0x8c7660 : 0x5d6944, 5);
    for (const t of [0.33, 0.50, 0.67, 0.82]) {
      for (const side of [-1, 1]) {
        leaf(foliage, point(t), a + side * (0.75 + random() * 1.0), 0.040 + random() * 0.030,
          0.018 + random() * 0.010, 0.005 + random() * 0.017, palettes.thyme[i % 2]);
      }
    }
    if (i % 4 === 0) continue;
    const tip = point(1);
    for (let j = 0; j < 5; j++) {
      const b = j * 2.4 + a, d = 0.009 + random() * 0.018;
      flowers.oval([tip[0] + Math.cos(b) * d, tip[1] + random() * 0.019, tip[2] + Math.sin(b) * d],
        [0.010, 0.008, 0.011], [0xb680ae, 0xd4a6c6, 0xe1b6c7][j % 3], [0.1, a, 0.4], 6);
    }
  }
}

function upright(kind, foliage, flowers, random) {
  const sage = kind === 'sage';
  const count = sage ? 11 : 9;
  for (let i = 0; i < count; i++) {
    const a = i * 2.4, r = Math.sqrt(random()) * (sage ? 0.23 : 0.17);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const height = (sage ? 0.31 : 0.4) + random() * 0.28;
    const bend = 0.05 + random() * (sage ? 0.14 : 0.10);
    const point = (t) => [x + Math.cos(a) * bend * t * t, height * t, z + Math.sin(a) * bend * t * t];
    foliage.rod(point(0), point(0.40), 0.009, 0.007, sage ? 0x7b856a : 0x91916a, 5)
      .rod(point(0.40), point(0.68), 0.007, 0.004, sage ? 0x8d9d76 : 0x919664, 5);
    for (const [j, t] of [0.18, 0.32, 0.48, 0.62].entries()) {
      const turn = a + j * 1.36;
      const length = (0.19 + random() * 0.04) * (1.05 - t) * (sage ? 1.2 : 0.92);
      for (const offset of [0, Math.PI]) {
        leaf(foliage, point(t), turn + offset, length, length * (sage ? 0.44 : 0.31),
          length * (sage ? 0.29 : 0.49), palettes[kind][(i + j) % 2]);
      }
    }
    if (sage && i % 4 === 0) continue;
    flowers.rod(point(0.68), point(0.99), 0.0045, 0.0018, sage ? 0x685b69 : 0x9e985e, 5);
    for (let j = 0; j < (sage ? 5 : 4); j++) {
      const t = 0.71 + j * (sage ? 0.06 : 0.08);
      const [px, py, pz] = point(t);
      const size = 1.14 - j * 0.14;
      const n = sage ? 3 : 5;
      for (let k = 0; k < n; k++) {
        const b = a + TAU * k / n + j * 0.81;
        const dx = Math.cos(b), dz = Math.sin(b);
        const stem = [px + dx * 0.014 * size, py, pz + dz * 0.014 * size];
        if (!sage) leaf(flowers, [px, py - 0.009, pz], b, 0.039 * size, 0.021 * size, 0.016,
          [0xc5b570, 0xa59756, 0x998a4d]);
        flowers.oval(stem, [0.013 * size, 0.016 * size, 0.010 * size],
          sage ? 0x83749d : 0xbda45e, [0, -b, -0.52], 7);
        flowers.oval([stem[0] + dx * 0.009 * size, py + 0.009 * size, stem[2] + dz * 0.009 * size],
          [0.015 * size, 0.009 * size, 0.008 * size], sage ? [0xae91cc, 0xc3a9da, 0xa185bc][k] : [0xf3da8b, 0xe5bd61][k % 2],
          [0, -b, 0.47], 7);
      }
    }
  }
}

export function herbs(root) {
  for (const [i, [kind, name]] of [['thyme', 'Wild thyme'], ['sage', 'Wild sage'], ['tea', 'Mountain tea']].entries()) {
    let state = 4381 + i * 79;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const patch = group(root, name, [i * 1.3, 0, 2.6]);
    const foliage = new Parts(), flowers = new Parts();
    if (kind === 'thyme') thyme(foliage, flowers, random);
    else upright(kind, foliage, flowers, random);
    foliage.mesh(patch, name + ' foliage');
    flowers.mesh(patch, name + ' flowering tips');
  }
}

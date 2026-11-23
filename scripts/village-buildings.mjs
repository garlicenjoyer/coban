import * as T from 'three';
import { Parts, vec } from './model-parts.mjs';

const timber = 0x513b32;
const shade = 0x42382f;
const mortar = 0x847d6d;
const tau = Math.PI * 2;
const flat = [Math.PI / 2, 0, 0];

export function wash(light, shadow, frequency = 1) {
  const high = new T.Color(light), low = new T.Color(shadow);
  return (x, y, z) => high.clone().lerp(low, T.MathUtils.clamp(
    0.28 + Math.sin((x + z * 1.3) * frequency * 3.1 + y * 12.8) * 0.12
      + Math.cos((x - z) * frequency + y * 3.2) * 0.20 + Math.sin(y * 21 + x * 9.4 - z * 17.3) * 0.09, 0, 1));
}

export function lathe(p, at, profile, color, sides = 20) {
  return p.add(new T.LatheGeometry(profile.map(([r, h]) => new T.Vector2(r, h)), sides), color, at);
}

export function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function append(p, q, angle, x, y, z) {
  for (const g of q.geometries) p.geometries.push(g.rotateY(angle).translate(x, y, z));
}

function face(p, points, color) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(points.flatMap((p) => p.toArray()), 3));
  g.computeVertexNormals();
  p.add(g, color);
}

function uprightFace(p, a, b, c, color) {
  const y = b.clone().sub(a).cross(c.clone().sub(a)).y;
  if (y < -1e-8) face(p, [a, c, b], color);
  else if (y > 1e-8) face(p, [a, b, c], color);
}

function roof(p, width, depth, y, crown, tonality, ridgeWidth, gablePaint) {
  const x = width / 2 + 0.36, z = depth / 2 + 0.39;
  const corners = [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]].map(vec);
  const halfRidge = gablePaint ? x : ridgeWidth;
  const left = vec([-halfRidge, y + crown, 0]), right = vec([halfRidge, y + crown, 0]);
  const ridge = [left, right, right, left];
  const underTile = wash(0x8b4f38, 0x65443c, 1.4);
  const random = seeded(927 + Math.floor(100 * crown));
  const tiles = tonality.map((c) => wash(c, 0x814d3f, 3.2));
  for (let side = 0; side < 4; side++) {
    const a = corners[side], b = corners[(side + 1) % 4], c = ridge[side], d = ridge[(side + 1) % 4];
    const innerA = vec([Math.sign(a.x) * (width / 2 - 0.06), y - 0.079, Math.sign(a.z) * (depth / 2 - 0.06)]);
    const innerB = vec([Math.sign(b.x) * (width / 2 - 0.06), y - 0.079, Math.sign(b.z) * (depth / 2 - 0.06)]);
    const outerA = a.clone().setY(y - 0.079), outerB = b.clone().setY(y - 0.079);
    face(p, [outerA, innerA, outerB, outerB, innerA, innerB], shade);
    if (gablePaint && side % 2 === 1) {
      const wallX = Math.sign(a.x) * width / 2;
      face(p, [vec([wallX, y - 0.01, b.z * 0.91]), vec([wallX, y + crown, 0]), vec([wallX, y - 0.01, a.z * 0.91])], gablePaint);
      for (const edge of [a, b]) p.rod(edge.toArray(), c.toArray(), 0.073, 0.061, timber, 7);
      continue;
    }
    uprightFace(p, a, b, c, underTile);
    if (c !== d) uprightFace(p, b, d, c, underTile);
    p.rod(a.clone().setY(y - 0.055).toArray(), b.clone().setY(y - 0.055).toArray(), 0.077, 0.077, timber, 5);
    const rows = 9;
    for (let row = 0; row < rows; row++) {
      const t0 = row / rows, t1 = Math.min(1, (row + 1.03) / rows);
      const from = a.clone().lerp(c, t0), to = b.clone().lerp(d, t0);
      const hiFrom = a.clone().lerp(c, t1), hiTo = b.clone().lerp(d, t1);
      const cols = Math.max(1, Math.round(from.distanceTo(to) / 0.46));
      for (let col = 0; col < cols; col++) {
        const u = (col + 0.017) / cols, v = (col + 0.983) / cols;
        const lowL = from.clone().lerp(to, u).add(vec([0, 0.027, 0]));
        const lowR = from.clone().lerp(to, v).add(vec([0, 0.027, 0]));
        const highL = hiFrom.clone().lerp(hiTo, u).add(vec([0, 0.029, 0]));
        const highR = hiFrom.clone().lerp(hiTo, v).add(vec([0, 0.029, 0]));
        const crest = 0.038 + 0.037 * random();
        const lowM = lowL.clone().lerp(lowR, 0.5).add(vec([0, crest, 0]));
        const highM = highL.clone().lerp(highR, 0.5).add(vec([0, crest * 0.79, 0]));
        const palette = tiles[Math.floor(random() * tiles.length)];
        uprightFace(p, lowL, lowM, highL, palette);
        uprightFace(p, lowM, highM, highL, palette);
        uprightFace(p, lowM, lowR, highR, palette);
        uprightFace(p, lowM, highR, highM, palette);
        face(p, [lowR, lowM, lowL], 0x694238);
      }
    }
    const end = a.clone().lerp(c, 0.04);
    p.rod(end.toArray(), c.toArray(), 0.086, 0.084, tonality[1], 8);
    const rafters = Math.ceil(a.distanceTo(b) / 0.68);
    for (let r = 1; r < rafters; r++) {
      const tail = a.clone().lerp(b, r / rafters).setY(y - 0.15);
      const inward = tail.clone().lerp(vec([0, y - 0.15, 0]), 0.11);
      p.rod(tail.toArray(), inward.toArray(), 0.049, 0.049, shade, 4);
    }
  }
  const count = Math.ceil(halfRidge * 2 / 0.34);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const from = left.clone().lerp(right, t).add(vec([0, 0.057, 0]));
    const to = left.clone().lerp(right, (i + 1.04) / count).add(vec([0, 0.057, 0]));
    p.rod(from.toArray(), to.toArray(), 0.12, 0.108, tonality[i % tonality.length], 8);
  }
}

function archShape(w, floor, spring) {
  const s = new T.Shape();
  s.moveTo(-w, floor);
  s.lineTo(w, floor);
  s.lineTo(w, spring);
  s.absarc(0, spring, w, 0, Math.PI, false);
  s.lineTo(-w, floor);
  return s;
}

function insetArch(p, x, y, z, width, spring, border, inner) {
  p.add(new T.ExtrudeGeometry(archShape(width, 0, spring), { depth: 0.085, bevelEnabled: false, curveSegments: 10 }),
    border, [x, y, z]);
  p.add(new T.ExtrudeGeometry(archShape(width - 0.095, 0.065, spring), { depth: 0.02, bevelEnabled: false, curveSegments: 10 }),
    inner, [x, y, z + 0.085]);
}

function window(p, x, y, width, height, paint, options = {}) {
  const stone = options.stone ?? 0xd8c4a4;
  const sill = y - height / 2;
  p.box([x, y, 0.009], [width + 0.20, height + 0.17, 0.052], stone)
    .box([x, y, 0.044], [width, height, 0.057], timber)
    .box([x, y, 0.076], [width - 0.10, height - 0.12, 0.014], wash(0x536c68, 0x333b3c, 1.6))
    .box([x, y, 0.091], [0.043, height - 0.10, 0.023], 0xc2a482)
    .box([x, y + 0.10, 0.093], [width - 0.09, 0.039, 0.023], 0xc2a482)
    .box([x, sill - 0.041, 0.073], [width + 0.30, 0.103, 0.25], stone);
  if (options.lattice) {
    for (const u of [-0.25, 0.25]) p.box([x + u * width, y, 0.097], [0.022, height - 0.10, 0.023], timber);
    for (const v of [-0.24, 0.24]) p.box([x, y + v * height, 0.102], [width - 0.10, 0.022, 0.024], timber);
    return;
  }
  for (const s of [-1, 1]) {
    const dx = s * width * 0.72;
    p.box([x + dx, y, 0.07], [width * 0.45, height + 0.035, 0.079], paint, [0, -s * 0.09, 0]);
    for (let i = 0; i < 7; i++) {
      p.box([x + dx, y - height * 0.41 + height * 0.136 * i, 0.114], [width * 0.37, 0.036, 0.021],
        i % 3 ? paint : 0x61574a, [0.22, -s * 0.09, 0]);
    }
    for (const v of [-0.36, 0.36]) p.box([x + s * width * 0.55, y + v * height, 0.119], [0.080, 0.029, 0.022], timber);
  }
}

function foundation(p, width, depth, height, seed) {
  p.box([0, (height - 0.9) / 2, 0], [width + 0.095, height + 0.9, depth + 0.095], mortar);
  const random = seeded(seed);
  const palette = [0xada08a, 0xb4a48b, 0xc0ae95, 0x9b9180, 0xc6b59d, 0xb3ac9b];
  for (let side = 0; side < 4; side++) {
    const edge = side % 2 ? depth : width;
    const q = new Parts();
    const columns = Math.ceil(edge / 0.62);
    for (let row = 0; row < 4; row++) {
      const bottom = height - 0.22 * (row + 1);
      for (let j = 0; j < columns; j++) {
        const length = edge / columns;
        const x = -edge / 2 + length * (j + 0.5 + (row % 2 ? 0.21 : -0.19));
        q.box([x, bottom + 0.10, 0.045], [length - 0.027, 0.175 + random() * 0.042, 0.096],
          palette[Math.floor(random() * palette.length)], [0, (random() - 0.5) * 0.15, (random() - 0.5) * 0.10]);
      }
    }
    const angle = side * Math.PI / 2;
    const d = (side % 2 ? width : depth) / 2;
    append(p, q, angle, d * Math.sin(angle), 0, d * Math.cos(angle));
  }
}

function chimney(p, x, y, z) {
  p.box([x, y, z], [0.61, 1.12, 0.58], wash(0xb7a08c, 0x876e62, 3))
    .box([x, y + 0.49, z], [0.77, 0.12, 0.71], 0x765445)
    .box([x, y + 0.67, z], [0.75, 0.10, 0.69], 0xb37752);
  for (const dx of [-0.26, 0.26]) p.box([x + dx, y + 0.57, z], [0.12, 0.20, 0.53], 0x8d6d60);
}

const homes = [
  { wall: [0xe4d5be, 0xbfa387], skirt: 0xd0b799, shutter: 0x57756c, door: 0x44645b, tile: [0xbb7354, 0xcc8564, 0xc77b57, 0xaf6247, 0xa86856], rise: 1.38 },
  { wall: [0xd7b782, 0xad8267], skirt: 0xb69671, shutter: 0x657961, door: 0x586753, tile: [0xba7653, 0xcd8b62, 0xb36b52, 0xa45f47, 0xc17d5d], rise: 1.54 },
  { wall: [0xddb6a2, 0xb7907d], skirt: 0xc4a78f, shutter: 0x607d8e, door: 0x446578, tile: [0xad6552, 0xbc7556, 0xab6957, 0xab5f45, 0xc18361], rise: 1.38 },
  { wall: [0xd6d4c4, 0xa9a894], skirt: 0xbfbfa9, shutter: 0x8c6350, door: 0x724e43, tile: [0xa16a56, 0xb77c5e, 0xb78463, 0x9a654f, 0xc08462], rise: 1.27 },
];
export const HOUSE_NAMES = ['Whitewashed house', 'Ochre house', 'Rose house', 'Stone house'];
const H = 4.5;

export function house(p, variant) {
  const look = homes[variant];
  const plaster = wash(...look.wall, 0.85);
  p.add(new T.BoxGeometry(8, H + 0.25, 7, 16, 12, 14), plaster, [0, (H - 0.25) / 2, 0]);
  foundation(p, 8, 7, variant === 3 ? 0.92 : 0.63, variant + 158);
  for (const s of [-1, 1]) {
    for (const z of [-3.48, 3.48]) {
      p.box([s * 3.93, 2.53, z], [0.17, 3.84, 0.17], look.skirt);
    }
    p.box([0, H - 0.16, s * 3.51], [8.11, 0.18, 0.10], timber);
    p.box([s * 4.01, H - 0.16, 0], [0.10, 0.18, 7.11], timber);
  }

  for (let side = 0; side < 4; side++) {
    const q = new Parts();
    const front = side === 0;
    const decorated = front || side === 2;
    const tone = wash(look.shutter, timber, 4);
    const random = seeded(738 + variant * 33 + side * 19);
    const wallEdge = side % 2 ? 3.5 : 4;
    for (let i = 0; i < 9; i++) {
      const x = (random() * 2 - 1) * (wallEdge - 0.36);
      const y = 0.80 + random() * 3.14;
      q.oval([x, y, 0.004], [0.12 + random() * 0.36, 0.018 + random() * 0.045, 0.009], look.skirt,
        [0, 0, (random() - 0.5) * 0.68], 7);
    }
    for (const i of [-1, 1]) {
      const x = i * (decorated ? 2.22 : 1.95);
      window(q, x, 3.23, 0.86, 1.09, tone, { stone: look.skirt, lattice: !front && variant === 3 });
      if (!front || variant !== 2) window(q, x + (front ? -0.21 : 0), 1.58, 0.88, 1.10, tone, { stone: look.skirt });
    }
    if (front) {
      const doorX = variant === 1 ? 0.28 : -0.21;
      insetArch(q, doorX, 0.12, 0.009, 0.68, 1.66, look.skirt, timber);
      insetArch(q, doorX, 0.20, 0.095, 0.554, 1.57, look.door, look.door);
      for (let i = -2; i <= 2; i++) {
        q.box([doorX + i * 0.185, 1.04, 0.205], [0.014, 1.53, 0.013], timber);
      }
      q.box([doorX, 0.16, 0.194], [1.54, 0.22, 0.53], look.skirt)
        .box([doorX, 1.41, 0.22], [0.99, 0.066, 0.038], look.shutter);
      q.torus([doorX + 0.30, 1.06, 0.236], 0.051, 0.009, 0xcb9a60, undefined, [0.78, 1, 1], tau, 12);
    }
    if (side === 0 && (variant === 0 || variant === 2)) {
      // Timber bay over the street with a small turned balustrade.
      q.box([0, 2.66, 0.44], [2.7, 0.16, 1.0], timber);
      q.box([0, 3.56, 0.91], [2.74, 0.092, 0.13], wash(0x8a674b, timber, 3));
      for (let i = 0; i < 12; i++) {
        const x = -1.29 + i * 0.233;
        q.rod([x, 2.73, 0.89], [x, 3.52, 0.89], 0.033, 0.032, timber, 6)
          .oval([x, 3.11, 0.89], [0.047, 0.12, 0.047], look.shutter, undefined, 7);
      }
      for (const x of [-1.10, 1.10]) {
        q.rod([x, 1.91, 0.025], [x, 2.65, 0.82], 0.067, 0.059, timber, 5);
      }
      if (variant === 2) for (const [i, color] of [0xc6b88f, 0xa66b51, 0x9caa99].entries()) {
        const x = -0.92 + i * 0.48;
        q.add(new T.PlaneGeometry(0.39, 0.49, 3, 3), wash(color, 0x725850, 4), [x, 3.32 - i * 0.05, 0.971]);
        q.box([x, 3.13 - i * 0.05, 0.982], [0.39, 0.038, 0.024], 0xc2a27d);
      }
    }
    const angle = side * Math.PI / 2, d = side % 2 ? 4 : 3.5;
    append(p, q, angle, d * Math.sin(angle), 0, d * Math.cos(angle));
  }
  roof(p, 8, 7, H, look.rise, look.tile, variant === 1 ? 2.44 : 1.49, variant === 3 ? plaster : undefined);
  chimney(p, variant % 2 ? -1.65 : 1.75, H + 1.17, variant % 2 ? 0.65 : -0.54);
}

export function coffeehouse(p) {
  const floor = wash(0xdcc9ac, 0xb49d84, 1.2);
  p.add(new T.BoxGeometry(12, 3.83, 8, 19, 10, 14), floor, [0, 1.69, 0]);
  foundation(p, 12, 8, 0.58, 341);
  roof(p, 12, 8, 3.6, 1.42, [0xc97d59, 0xbd6d4f, 0xa4604c, 0xca8767, 0xa46a53], 3.65);
  chimney(p, 3.95, 4.40, -0.74);
  const front = new Parts();
  const blue = wash(0x698d87, 0x465c5a, 2.8);
  for (const x of [-4.4, 4.4]) window(front, x, 1.88, 1.30, 1.66, blue);
  for (const x of [-1.62, 1.62]) {
    insetArch(front, x, 0.42, 0.02, 0.95, 1.61, 0xd6b58a, 0x506b61);
    for (let j = 0; j < 4; j++) front.box([x - 0.55 + j * 0.36, 1.49, 0.14], [0.044, 1.74, 0.06], timber);
    front.box([x, 1.19, 0.157], [1.63, 0.058, 0.07], timber);
  }
  for (const x of [-5.84, 5.84]) front.box([x, 2.07, 0.018], [0.14, 3.12, 0.12], timber);
  front.box([0, 3.23, 0.062], [12.07, 0.15, 0.15], timber);
  for (const [i, color] of [0x5c8379, 0xe1c9a3, 0xab684f, 0xe1c9a3].entries()) {
    front.box([0, 2.88 + i * 0.1, 0.031], [11.4, 0.080, 0.034], color);
  }
  append(p, front, 0, 0, 0, 4);
  for (const side of [-1, 1]) {
    const q = new Parts();
    for (const x of [-1.9, 1.9]) window(q, x, 1.79, 1.28, 1.46, blue, { lattice: true });
    append(p, q, side * Math.PI / 2, side * 6, 0, 0);
  }
  const back = new Parts();
  insetArch(back, -2.0, 0.18, 0.008, 0.76, 1.51, 0xc7aa87, 0x534f42);
  window(back, 2.4, 1.77, 1.34, 1.44, blue);
  append(p, back, Math.PI, 0, 0, -4);
}

export function mosque(p) {
  const plaster = wash(0xe3d9bd, 0xb3ac96, 1.3);
  const stone = wash(0xe1d1ae, 0xa28f7d, 2.5);
  const lead = wash(0x899895, 0x535b5c, 2.2);
  const metal = 0xa78b55;
  p.add(new T.BoxGeometry(10, 4.84, 10, 16, 14, 16), plaster, [0, 2.16, 0]);
  foundation(p, 10, 10, 0.81, 331);
  p.box([0, 4.61, 0], [10.42, 0.26, 10.41], stone)
    .box([0, 4.81, 0], [10.12, 0.15, 10.11], 0xafa388);
  lathe(p, [0, 4.82, 0], [[0, 0], [3.63, 0], [3.85, 0.14], [3.82, 0.78], [3.57, 0.98], [0, 0.98]], stone, 16);
  const dome = [[3.60, 0], [3.58, 0.30], [3.33, 1.04], [2.81, 1.65], [2.05, 2.14], [1.11, 2.52], [0.22, 2.66], [0, 2.68]];
  lathe(p, [0, 5.7, 0], dome, lead, 32);
  for (let i = 0; i < 16; i++) {
    const a = i * tau / 16;
    p.sweep(dome.slice(0, -1).map(([r, y]) => [Math.cos(a) * (r + 0.014), y + 5.725,
      Math.sin(a) * (r + 0.014), 0.026, 0.024]), 0x697572, 5, 2);
  }
  p.rod([0, 8.30, 0], [0, 8.81, 0], 0.058, 0.031, metal, 9);
  p.torus([0, 8.81, 0], 0.155, 0.043, metal, [0, 0, 0.31], undefined, Math.PI * 1.48, 18);
  const front = new Parts();
  insetArch(front, 0, 0.16, 0.013, 0.92, 1.96, 0xbeb28f, 0x5b6658);
  for (const x of [-3.06, 3.06]) {
    insetArch(front, x, 1.42, 0.019, 0.74, 1.31, 0xc4b997, 0x566c68);
    for (const off of [-0.32, 0, 0.32]) front.box([x + off, 2.28, 0.14], [0.029, 1.60, 0.034], shade);
    for (const y of [1.68, 2.04, 2.4, 2.75]) front.box([x, y, 0.14], [1.22, 0.026, 0.034], shade);
  }
  append(p, front, 0, 0, 0, 5);
  for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const q = new Parts();
    for (const x of [-2.6, 0, 2.6]) window(q, x, 2.35, 0.95, 1.55, 0x778c7c, { stone: 0xd1c3a2, lattice: true });
    append(p, q, angle, 5 * Math.sin(angle), 0, 5 * Math.cos(angle));
  }
  // A shallow porch and four columns; the prayer room remains a solid façade.
  p.box([0, 0.082, 5.68], [9.37, 0.17, 1.57], stone);
  p.box([0, 3.71, 5.68], [9.56, 0.21, 1.77], stone);
  for (let i = 0; i < 4; i++) {
    const x = -4.30 + i * 2.867;
    p.rod([x, 0.14, 6.28], [x, 3.57, 6.28], 0.161, 0.138, stone, 10)
      .box([x, 0.26, 6.28], [0.48, 0.22, 0.49], stone)
      .box([x, 3.52, 6.28], [0.48, 0.20, 0.49], stone);
  }
  for (let i = 0; i < 3; i++) {
    const x = -2.867 + i * 2.867, radius = 1.32;
    for (let j = 0; j < 13; j++) {
      const a = j * Math.PI / 13, b = (j + 0.93) * Math.PI / 13;
      const at = (k) => [x + Math.cos(k) * radius, 2.34 + Math.sin(k) * radius, 6.28];
      p.rod(at(a), at(b), 0.146, 0.146, j % 3 === 0 ? 0xc8b799 : stone, 5);
    }
  }
  for (let i = 0; i < 20; i++) p.rod([-4.73 + i * 0.49, 3.82, 5], [-4.73 + i * 0.49, 3.76, 6.61], 0.071, 0.060, 0xa8674f, 8);
}

export function minaret(p) {
  const limestone = wash(0xe0d4b8, 0xae9e88, 2.1);
  const lead = wash(0x83928e, 0x4c595a, 2.4);
  const bronze = 0xac8951;
  p.box([0, 0.38, 0], [1.96, 0.94, 1.96], limestone);
  lathe(p, [0, 0, 0], [[0.99, 0.40], [0.99, 1.72], [0.84, 2.59], [0.65, 3.0], [0.61, 11.70],
    [0.68, 11.95], [1.04, 12.44], [1.20, 12.57], [1.20, 12.79], [0.63, 12.79],
    [0.55, 13.21], [0.52, 15.73], [0.61, 16.0]], limestone, 16);
  for (const [r, h] of [[0.99, 0.84], [0.92, 1.8], [0.73, 2.89], [0.63, 3.15], [0.62, 10.87],
    [0.65, 11.75], [1.13, 12.51], [1.20, 12.77], [0.58, 15.71], [0.63, 15.95]]) {
    p.torus([0, h, 0], r, 0.047, 0xc6b594, flat, undefined, tau, 24);
  }
  p.torus([0, 13.45, 0], 1.095, 0.092, limestone, flat, undefined, tau, 24);
  for (let i = 0; i < 20; i++) {
    const a = i * tau / 20;
    p.rod([Math.cos(a) * 1.10, 12.80, Math.sin(a) * 1.10],
      [Math.cos(a) * 1.09, 13.44, Math.sin(a) * 1.09], 0.051, 0.053, limestone, 6);
  }
  lathe(p, [0, 15.96, 0], [[0.68, 0], [0.64, 0.19], [0.48, 0.74], [0.27, 1.37], [0.13, 1.94], [0.028, 2.53]], lead, 20);
  p.rod([0, 18.46, 0], [0, 19.03, 0], 0.043, 0.028, bronze, 8)
    .oval([0, 18.55, 0], [0.095, 0.103, 0.095], bronze, undefined, 12)
    .torus([0, 19.10, 0], 0.174, 0.046, bronze, [0, 0.2, 0.25], undefined, Math.PI * 1.48, 19);
}

export function planeTree(p) {
  const random = seeded(2961);
  const bark = wash(0x9c8a6e, 0x645c48, 1.8);
  const curb = wash(0xb7ad94, 0x918676, 4);
  lathe(p, [0, 0, 0], [[1.44, -0.05], [1.44, 0.098], [1.39, 0.168], [1.29, 0.168],
    [1.23, 0.109], [1.23, 0.03]], curb, 12);
  lathe(p, [0, 0, 0], [[1.25, 0.051], [0.68, 0.078], [0, 0.085]], wash(0x927956, 0x746148, 3), 12);
  p.sweep([[0, -0.33, 0, 0.69, 0.58], [0.02, 0.68, 0, 0.52, 0.46],
    [0.18, 2.36, -0.17, 0.43, 0.40], [0.10, 4.19, -0.02, 0.36, 0.33], [-0.31, 5.6, 0.27, 0.24, 0.26],
    [-0.49, 7.40, 0.51, 0.07, 0.07]], bark, 13);
  for (const [i, hull] of [[-2.9, 6.3, 0.9], [2.9, 6.35, 0.7], [1.19, 7.12, -2.59], [-1.62, 7.49, -2.36],
    [0.48, 7.20, 3.16], [1.78, 8.01, 1.18], [-2.05, 8.45, -0.2], [0.1, 9.33, -0.75]].entries()) {
    const [x, y, z] = hull;
    p.sweep([[0.07, 2.6 + (i % 4) * 0.54, 0, 0.24 - i * 0.016, 0.22 - i * 0.014],
      [x * 0.36, y - 1.52, z * 0.32, 0.13, 0.11], [x, y - 0.39, z, 0.057, 0.048],
      [x * 1.21, y + 0.34, z * 1.20, 0.012, 0.009]], bark, 9);
    for (let j = 0; j < 5; j++) {
      const a = j * tau / 5 + i, r = j === 0 ? 0.18 : 1.12;
      const leaves = [0x718257, 0x87995c, 0x929b60, 0x687b53, 0x7e8e57][(i + j) % 5];
      p.add(new T.IcosahedronGeometry(1, 1), wash(leaves, 0x4d613f, 1.25),
        [x + Math.cos(a) * r, y + random() * 0.97 - 0.36, z + Math.sin(a) * r],
        [1.19 + random() * 0.69, 0.81 + random() * 0.77, 1.06 + random() * 0.75], [0.3, a, -0.19], 0.085);
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = i * tau / 6;
    p.rod([0, 0.43, 0], [Math.sin(a) * 0.94, -0.035, Math.cos(a) * 0.87], 0.22, 0.088, bark, 6);
  }
}

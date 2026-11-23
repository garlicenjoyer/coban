import * as T from 'three';
import { Parts, vec } from './model-parts.mjs';
import { lathe, seeded, wash } from './village-buildings.mjs';

const wood = wash(0x916846, 0x524134, 4);
const darkWood = 0x4b3830, wrought = 0x504840, metal = 0x9c9b8c, canvas = 0xe8d0a4;
const brass = 0xbd9560, cream = 0xe2cfaa;
const flat = [Math.PI / 2, 0, 0];
const tau = Math.PI * 2;

function clothPanel(p, corners, color) {
  const positions = corners.flatMap((v) => v.toArray());
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]);
  g.computeVertexNormals();
  // The two faces share a plane and need separate normals.
  const flatFaces = g.toNonIndexed();
  flatFaces.computeVertexNormals();
  p.add(flatFaces, color);
}

const awnings = {
  dairy: [0x72909a, 0xe4d1ad, 0x5b7986],
  bakkal: [0xad604d, 0xddbc89, 0xa85b47],
  usta: [0x54625e, 0xbda577, 0x626c62],
  muze: [0x8c7760, 0xdfcfaa, 0x806b55],
  kahvehane: [0x6d8b76, 0xd9caa2, 0x71866d],
};

function awning(p, id) {
  const cafe = id === 'kahvehane';
  const width = cafe ? 8.10 : id === 'usta' ? 4.45 : 4.0;
  const start = cafe ? -1.28 : -1.62;
  const front = cafe ? 2.58 : 0.48;
  const posts = cafe ? [-width / 2, -width / 6, width / 6, width / 2] : [-width / 2, width / 2];
  const peak = cafe ? 3.13 : 2.90;
  const drop = cafe ? 0.61 : 0.48;
  const stripes = cafe ? 15 : 9;
  const fabric = awnings[id].map((t) => wash(t, 0x755d4c, 8));
  const pt = (x, t) => vec([x, peak - drop * t - 0.16 * Math.sin(Math.PI * t)
    + 0.029 * Math.cos(x * Math.PI * stripes / width), T.MathUtils.lerp(start, front, t)]);
  for (const x of posts) {
    p.box([x, (peak - drop) / 2, front + 0.04], [0.13, peak - drop, 0.13], wood)
      .box([x, 0.11, front + 0.04], [0.23, 0.22, 0.23], 0xb3a18a)
      .rod([x, peak - drop - 0.53, front + 0.03], [x, peak - drop + 0.02, front - 0.46], 0.045, 0.043, wood, 6)
      .rod(pt(x, 0).toArray(), pt(x, 1).toArray(), 0.060, 0.052, wood, 6);
  }
  p.rod([-width / 2 - 0.045, peak - drop - 0.033, front], [width / 2 + 0.045, peak - drop - 0.033, front],
    0.057, 0.057, darkWood, 7);
  for (let i = 0; i < stripes; i++) {
    const x0 = width * (i / stripes - 0.5), x1 = x0 + width / stripes;
    const paint = fabric[i % 2];
    for (let row = 0; row < 7; row++) {
      clothPanel(p, [pt(x0, row / 7), pt(x1, row / 7), pt(x1, (row + 1) / 7), pt(x0, (row + 1) / 7)], paint);
    }
    const hem = (x, s) => pt(x, 1).add(vec([0, -0.20 - 0.14 * Math.sin(s * Math.PI), 0.085]));
    for (let j = 0; j < 4; j++) {
      const a = T.MathUtils.lerp(x0, x1, j / 4), b = T.MathUtils.lerp(x0, x1, (j + 1) / 4);
      const lowerA = hem(a, j / 4), lowerB = hem(b, (j + 1) / 4);
      clothPanel(p, [pt(a, 1), pt(b, 1), lowerB, lowerA], paint);
      p.rod(lowerA.toArray(), lowerB.toArray(), 0.008, 0.008, i % 2 ? 0xbd9c74 : awnings[id][2], 5);
    }
  }
}

function counter(p, accent, width = 2.76) {
  const y = 0.93, z = -0.94;
  p.box([0, y, z], [width + 0.18, 0.13, 0.84], wood)
    .box([0, y - 0.13, z + 0.35], [width + 0.06, 0.082, 0.13], darkWood);
  for (const x of [-width / 2 + 0.11, width / 2 - 0.11]) {
    for (const dz of [-0.29, 0.29]) p.box([x, 0.43, z + dz], [0.15, 0.87, 0.14], wood);
  }
  const panel = wash(accent, darkWood, 6);
  for (let i = 0; i < 10; i++) p.box([width * ((i + 0.5) / 10 - 0.5), 0.43, z + 0.305],
    [width / 10 - 0.012, 0.69, 0.055], panel, [0, 0, (i % 3 - 1) * 0.01]);
  p.box([0, 0.19, z + 0.355], [width, 0.085, 0.057], darkWood);
}

export function crate(p, x, y, z, w = 0.68, d = 0.48, h = 0.31) {
  p.box([x, y + 0.032, z], [w, 0.064, d], darkWood);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      const level = y + (row + 0.5) * h / 3;
      p.box([x, level, z + side * d / 2], [w + 0.02, h / 3 - 0.019, 0.042], wood)
        .box([x + side * w / 2, level, z], [0.038, h / 3 - 0.019, d], wood);
    }
    for (const edge of [-1, 1]) p.box([x + side * w * 0.39, y + h / 2, z + edge * (d / 2 + 0.019)],
      [0.066, h + 0.022, 0.032], 0x8d6b4c);
  }
}

function jug(p, x, y, z, r, h, enamel) {
  lathe(p, [x, y, z], [[0, 0], [r * 0.79, 0], [r * 0.97, h * 0.14], [r, h * 0.43],
    [r * 0.93, h * 0.74], [r * 0.61, h * 0.88], [r * 0.57, h], [r * 0.48, h], [r * 0.47, h * 0.75], [0, h * 0.75]],
  enamel, 16);
  p.torus([x, y + h, z], r * 0.54, r * 0.075, enamel, flat, undefined, tau, 18)
    .torus([x + r * 0.88, y + h * 0.65, z], h * 0.21, r * 0.09, enamel, undefined, [0.82, 1, 1], tau, 14);
}

function bottle(p, x, y, z, radius, height, color, stopper = brass) {
  lathe(p, [x, y, z], [[0, 0], [radius * 0.91, 0], [radius, 0.02], [radius, height * 0.72],
    [radius * 0.45, height * 0.85], [radius * 0.45, height], [0, height]], color, 10);
  p.rod([x, y + height * 0.94, z], [x, y + height * 1.06, z], radius * 0.50, radius * 0.49, stopper, 9);
  p.box([x, y + height * 0.43, z + radius * 0.93], [radius * 1.24, height * 0.28, 0.011], 0xdac7a2);
}

function dairy(p) {
  counter(p, 0x73928d);
  const tin = wash(0xc8c3ad, 0x858c88, 10);
  for (const x of [-1.71, -1.44, 1.59]) {
    const z = x === -1.71 ? -0.56 : -1.05;
    jug(p, x, 0.02, z, 0.218, 0.53, tin);
    p.torus([x, 0.57, z], 0.108, 0.012, darkWood, flat, undefined, tau, 15);
  }
  for (let i = 0; i < 6; i++) {
    const x = -1.10 + (i % 3) * 0.37, z = -0.73 - Math.floor(i / 3) * 0.35;
    lathe(p, [x, 1.006, z], [[0, 0], [0.14, 0], [0.157, 0.022], [0.158, 0.082], [0.136, 0.10], [0, 0.10]],
      wash(i % 2 ? 0xe2bf7b : 0xead8ab, 0xbe985f, 8), 16);
  }
  for (const [i, x] of [0.42, 0.74, 1.07].entries()) bottle(p, x, 1.00, -0.89 - i % 2 * 0.18, 0.079, 0.27, 0xe2d9bb, 0x577775);
}

function grocer(p) {
  counter(p, 0x9b6551, 2.85);
  const random = seeded(542);
  const palettes = [
    [0xc07d42, 0xd89a52, 0xae693d], [0xba5845, 0xd27d51, 0xa95040],
    [0x768950, 0x8f9759, 0x9cab62], [0xcba662, 0xd7ae58, 0xcca06a],
  ];
  for (const [i, [x, y, z]] of [[-0.95, 1.00, -0.83], [-0.20, 1.00, -0.85], [0.57, 1.00, -0.87],
    [1.60, 0, -0.75]].entries()) {
    crate(p, x, y, z, 0.67, 0.44, 0.16 + (y ? 0 : 0.13));
    for (let j = 0; j < 22; j++) {
      const r = 0.041 + random() * 0.032;
      const px = x + (random() - 0.5) * 0.52, pz = z + (random() - 0.5) * 0.31;
      const py = y + (y ? 0.145 : 0.27) + random() * 0.058;
      p.oval([px, py, pz], [r * 1.10, r, r * 0.94], palettes[i][j % 3], [0.2, j, 0.47], 8);
    }
  }
  for (const x of [-1.58, 1.52]) {
    const j = x > 0 ? -0.17 : -0.36;
    p.oval([x, 0.27, j], [0.25, 0.33, 0.224], wash(0xc4a578, 0xa68762, 7),
      [0.10, x, x > 0 ? -0.10 : 0.12], 12)
      .oval([x, 0.61, j], [0.102, 0.068, 0.082], 0xb19a73, undefined, 8)
      .torus([x, 0.57, j], 0.078, 0.012, 0x745c47, flat, undefined, tau, 13);
  }
}

function workshop(p) {
  counter(p, 0x596e65, 2.70);
  const tyre = wash(0x4a4540, 0x312e2a, 10);
  for (let i = 0; i < 3; i++) {
    p.torus([1.69 + i * 0.034, 0.12 + i * 0.193, -0.74 - i * 0.034], 0.36, 0.09, tyre,
      [1.43 + 0.06 * i, 0.24 * i, 0], undefined, tau, 22);
  }
  p.torus([-1.64, 0.49, -1.18], 0.43, 0.08, tyre, [0.09, 0.37, 0.17], undefined, tau, 24);
  p.torus([-1.64, 0.49, -1.18], 0.31, 0.027, metal, [0.09, 0.37, 0.17], undefined, tau, 24);
  p.box([-0.69, 1.08, -0.91], [0.67, 0.174, 0.34], wash(0x985b49, 0x653f36, 6))
    .box([-0.69, 1.17, -0.91], [0.70, 0.03, 0.36], 0xa87154)
    .torus([-0.69, 1.18, -0.91], 0.110, 0.019, metal, undefined, [1, 0.61, 1], Math.PI, 16);
  for (const [i, len] of [0.21, 0.29, 0.39].entries()) {
    const x = 0.11 + i * 0.27, z = -0.72 - i * 0.10, y = 1.03;
    p.rod([x - len * 0.1, y, z - 0.11], [x + len * 0.10, y, z + len - 0.08], 0.015, 0.018, metal, 6)
      .torus([x, y, z - 0.125], 0.040, 0.012, metal, [Math.PI / 2, 0, i], undefined, tau * 0.79, 12);
  }
  const oil = wash(0xa06348, 0x694638, 6);
  jug(p, -1.56, 0.01, -0.48, 0.20, 0.56, oil);
}

function museum(p) {
  counter(p, 0xa08164, 2.72);
  const panel = wash(0xd1b99a, 0x947c63, 8);
  const cloth = wash(0x6e8281, 0x545e60, 9);
  p.box([-0.66, 1.014, -0.90], [0.76, 0.035, 0.56], cloth);
  p.box([0.29, 1.079, -0.90], [0.71, 0.15, 0.46], panel)
    .box([0.29, 1.157, -0.90], [0.76, 0.037, 0.51], darkWood);
  p.box([0.74, 1.016, -0.91], [0.49, 0.047, 0.34], cloth);
  for (const [i, x] of [-1.67, 1.66].entries()) {
    jug(p, x, 0.025, -0.62 - i * 0.35, 0.235, 0.56 + i * 0.12, wash(0xbc846a, 0x925f4e, 9));
    p.torus([x, 0.41 + i * 0.085, -0.62 - i * 0.35], 0.209, 0.013, 0x96704e, flat, undefined, tau, 20);
  }
  // A ledger in front of the curator, with raised corners and individual folios.
  p.box([0.31, 1.196, -0.90], [0.42, 0.050, 0.30], 0xd5bb98, [0, 0.36, -0.02]);
  p.box([0.32, 1.202, -0.90], [0.011, 0.029, 0.26], darkWood, [0, 0.36, -0.02]);
}

export const shopModels = { dairy, bakkal: grocer, usta: workshop, muze: museum, kahvehane: () => {} };

export function market(p, id) {
  awning(p, id);
  shopModels[id](p);
}

export function vet(p) {
  const top = wash(0xb4bdaf, 0x858c7c, 6);
  p.box([0, 0.85, -0.81], [2.0, 0.115, 0.79], top);
  for (const x of [-0.85, 0.85]) {
    p.rod([x, 0.02, -1.12], [x, 0.791, -0.49], 0.036, 0.031, wrought, 7)
      .rod([x, 0.02, -0.49], [x, 0.791, -1.12], 0.036, 0.031, wrought, 7);
  }
  const leather = wash(0x9c714c, 0x614534, 8);
  p.box([-0.50, 1.06, -0.86], [0.54, 0.31, 0.29], leather)
    .box([-0.50, 1.20, -0.86], [0.56, 0.13, 0.32], leather)
    .torus([-0.50, 1.245, -0.86], 0.136, 0.018, darkWood, undefined, [1, 0.59, 1], Math.PI, 13)
    .box([-0.50, 1.098, -0.692], [0.096, 0.061, 0.024], brass);
  for (const [i, r] of [0.068, 0.059, 0.083].entries()) bottle(p, 0.09 + i * 0.22, 0.91, -0.77 - i % 2 * 0.22,
    r, 0.23 + i * 0.047, i % 2 ? 0x7d865c : 0x8d6548);
  const x = 1.2, z = -1.35;
  p.box([x, 0.09, z], [0.42, 0.18, 0.46], 0xbca883)
    .rod([x, 0.14, z], [x, 2.94, z], 0.041, 0.034, wood, 8);
  const color = [wash(0xb06b59, 0x815045, 4), wash(0xe0c7a4, 0x9f8064, 4)];
  for (let i = 0; i < 12; i++) {
    const at = (a, r, y) => vec([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
    const a = i * tau / 12, b = (i + 1) * tau / 12;
    const pane = color[i % 2];
    clothPanel(p, [at(a, 0.13, 2.97), at(b, 0.13, 2.97), at(b, 0.90, 2.73), at(a, 0.90, 2.73)], pane);
    clothPanel(p, [at(a, 0.90, 2.73), at(b, 0.90, 2.73), at(b, 1.44, 2.51), at(a, 1.44, 2.51)], pane);
    clothPanel(p, [at(a, 1.44, 2.51), at(b, 1.44, 2.51), at(b, 1.46, 2.34), at(a, 1.46, 2.34)], pane);
    p.rod(at(a, 0.14, 2.94).toArray(), at(a, 1.45, 2.49).toArray(), 0.015, 0.012, brass, 5);
  }
  p.oval([x, 3.00, z], [0.13, 0.063, 0.13], 0x996a52, undefined, 11);
}

export function dealer(p) {
  crate(p, 0.09, 0.03, -0.89, 0.93, 0.51, 0.54);
  crate(p, 0.86, 0.01, -1.23, 0.48, 0.38, 0.29);
  const tarp = wash(0x89735b, 0x655242, 7);
  p.oval([0.03, 0.593, -0.86], [0.48, 0.06, 0.29], tarp, [0.04, 0.3, 0.07], 12);
  jug(p, -0.58, 0.01, -0.92, 0.16, 0.35, 0x9a704f);
  bottle(p, 0.31, 0.62, -0.84, 0.084, 0.24, 0x778170, 0x9f8563);
}

export function fountain(p) {
  const stone = wash(0xd5c6aa, 0xa2947d, 3);
  const dark = wash(0xb8ab91, 0x887863, 3.4);
  lathe(p, [0, 0, 0], [[0, -0.18], [1.88, -0.18], [1.89, 0.10], [1.78, 0.14], [1.54, 0.17],
    [1.54, 0.63], [1.63, 0.67], [1.63, 0.75], [1.48, 0.80], [1.30, 0.79], [1.25, 0.65], [1.25, 0.28],
    [0, 0.25]], stone, 8);
  lathe(p, [0, 0, 0], [[0, 0.493], [1.32, 0.493], [1.342, 0.509], [0, 0.510]],
    wash(0x819c8e, 0x526c6c, 3), 32);
  lathe(p, [0, 0.08, 0], [[0.43, 0.37], [0.43, 0.60], [0.31, 0.64], [0.28, 1.22],
    [0.39, 1.30], [0.69, 1.45], [0.72, 1.50], [0.66, 1.57], [0.62, 1.54], [0.58, 1.42],
    [0.29, 1.37], [0.19, 1.48], [0.14, 1.65], [0.18, 1.72], [0.14, 1.82], [0, 1.92]], stone, 16);
  p.torus([0, 1.58, 0], 0.676, 0.024, dark, flat, undefined, tau, 24);
  for (let i = 0; i < 5; i++) {
    const a = (i + 0.32) * tau / 5;
    const at = (r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
    p.sweep([[0.7, 1.565, 0.016], [0.77, 1.52, 0.017], [0.87, 1.31, 0.013],
      [0.98, 0.95, 0.012], [1.00, 0.52, 0.016]].map(([r, y, w]) => [...at(r, y), w, w]),
    wash(0xbed2be, 0x809d94, 9), 7, 3);
    p.torus(at(1.0, 0.512), 0.132, 0.012, 0x9db4a1, flat, [1.1, 0.85, 1], tau * 0.89, 16);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * tau / 8;
    const x = 1.46 * Math.sin(a), z = 1.46 * Math.cos(a);
    p.box([x, 0.42, z], [0.88, 0.27, 0.11], dark, [0, a, 0])
      .box([x * 1.044, 0.43, z * 1.044], [0.65, 0.15, 0.022], stone, [0, a, 0]);
  }
}

export function bench(p) {
  for (const x of [-0.68, 0.68]) {
    p.box([x, 0.205, 0], [0.25, 0.40, 0.48], wash(0xbcb295, 0x8e8472, 5));
    p.rod([x, 0.34, -0.15], [x, 0.81, -0.24], 0.040, 0.036, wrought, 7);
  }
  for (let i = 0; i < 4; i++) p.box([0, 0.427 + i * 0.004, -0.20 + i * 0.13], [1.72, 0.069, 0.122], wood);
  for (const y of [0.64, 0.80]) p.box([0, y, -0.24], [1.68, 0.137, 0.049], wood, [-0.16, 0, 0]);
}

export function flowerPot(p) {
  const terracotta = wash(0xb47c5c, 0x975949, 8);
  lathe(p, [0, 0, 0], [[0, 0.01], [0.245, 0.01], [0.265, 0.08], [0.315, 0.38],
    [0.348, 0.408], [0.343, 0.465], [0.307, 0.453], [0.291, 0.385], [0, 0.379]], terracotta, 16);
  p.torus([0, 0.425, 0], 0.328, 0.019, 0xcc8f67, flat, undefined, tau, 20);
  const random = seeded(849);
  for (let i = 0; i < 17; i++) {
    const a = i * 2.4, r = random() * 0.38, y = 0.48 + random() * 0.46;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    p.rod([x * 0.32, 0.35, z * 0.32], [x, y, z], 0.014, 0.009, 0x626b4c, 5);
    p.oval([x * 0.83, y - 0.084, z * 0.86], [0.116, 0.029, 0.092], i % 2 ? 0x7d8b5d : 0x5d7451,
      [0.15, a, 0.43], 8);
    if (i % 3 === 0) continue;
    for (let j = 0; j < 3; j++) p.oval([x + Math.cos(j * tau / 3) * 0.051, y + random() * 0.048,
      z + Math.sin(j * tau / 3) * 0.051], [0.048, 0.037, 0.053],
    [0xbf725e, 0xd78f72, 0xa65a4d, 0xde9c7e][(i + j) % 4], [0.06, i, j], 8);
  }
}

export function lamp(frame, glass) {
  const top = [0, 2.7, 0];
  frame.rod([0, 0.02, 0], [0, 0.33, 0], 0.14, 0.094, wrought, 10)
    .rod([0, 0.34, 0], top, 0.055, 0.038, wrought, 10)
    .sweep([[0, 2.67, 0, 0.047, 0.047], [0, 2.91, 0, 0.038, 0.042], [0, 3.10, 0.20, 0.033, 0.031],
      [0, 3.04, 0.45, 0.029, 0.028], [0, 2.93, 0.51, 0.030, 0.027]], wrought, 9);
  lathe(frame, [0, 2.48, 0.51], [[0, 0], [0.130, 0.018], [0.145, 0.058], [0.135, 0.10]], wrought, 10);
  lathe(frame, [0, 2.79, 0.51], [[0.18, 0], [0.183, 0.044], [0.117, 0.11], [0.041, 0.165], [0, 0.182]], wrought, 10);
  lathe(glass, [0, 2.56, 0.51], [[0.114, 0.0], [0.137, 0.029], [0.158, 0.24], [0, 0.246]],
    wash(0xe5bc75, 0xba8e5f, 12), 10);
  for (let i = 0; i < 5; i++) {
    const a = i * tau / 5 + Math.PI / 2;
    frame.rod([Math.sin(a) * 0.135, 2.55, 0.51 + Math.cos(a) * 0.135],
      [Math.sin(a) * 0.16, 2.81, 0.51 + Math.cos(a) * 0.16], 0.012, 0.010, wrought, 5);
  }
}

export function terraceWall(p) {
  p.box([0, 0.23, 0], [2.40, 0.76, 0.39], 0x8f8776);
  const random = seeded(442);
  const colors = [0xb6a78d, 0xc9baa0, 0xa59783, 0xb5ad99, 0xc1ab91];
  for (let row = 0; row < 4; row++) {
    for (let j = 0; j < 5; j++) {
      const x = (j - 2) * 0.48 + (row % 2 ? 0.09 : -0.08);
      p.box([x, -0.06 + row * 0.177, 0], [0.46, 0.164, 0.48 + random() * 0.06],
        colors[Math.floor(random() * colors.length)], [(random() - 0.5) * 0.19, 0.04, (random() - 0.5) * 0.13]);
    }
  }
  for (let i = 0; i < 4; i++) p.box([(i - 1.5) * 0.60, 0.582, 0], [0.58, 0.171, 0.57],
    colors[i], [0.12, (i % 2 - 0.5) * 0.12, 0.02]);
}

export function carpet(p) {
  const red = wash(0xa86856, 0x81534d, 10);
  p.add(new T.PlaneGeometry(1.17, 1.30, 5, 6), red, [0, 0.66, 0.0]);
  p.add(new T.PlaneGeometry(1.17, 1.30, 5, 6), red, [0, 0.66, 0.0], undefined, [0, Math.PI, 0]);
  for (const s of [-1, 1]) {
    for (const y of [0.12, 1.22]) p.box([0, y, s * 0.007], [1.17, 0.044, 0.015], cream);
    for (const x of [-0.51, 0.51]) p.box([x, 0.67, s * 0.007], [0.052, 1.20, 0.015], 0xd0ab75);
  }
  for (let i = 0; i < 3; i++) {
    const x = 0.31 * (i - 1), y = 0.65 + ((i % 2) - 0.5) * 0.11;
    p.box([x, y, 0], [0.21, 0.21, 0.037], 0xdaaf72, [0, 0, Math.PI / 4])
      .box([x, y, 0], [0.125, 0.125, 0.044], 0x6b8180, [0, 0, Math.PI / 4]);
  }
  for (let i = 0; i < 23; i++) {
    const x = (i - 11) * 0.049;
    p.rod([x, 0.028, 0], [x + 0.010 * Math.sin(i * 2), -0.047 - i % 3 * 0.014, 0.004], 0.007, 0.005, cream, 5);
  }
}

import * as T from 'three';
import { group, Parts } from './model-parts.mjs';
import { teaTray } from './field-props.mjs';

const wood = 0x875e3e;
const endgrain = 0x513b30;
const iron = 0x514b40;
const brass = 0xdca363;
const porcelain = 0xebe4ce;
const blue = 0x54888e;
const tin = (x, y, z) => new T.Color(0x9d9d94)
  .lerp(new T.Color(0xd6cfb6), 0.25 + 0.22 * Math.sin(x * 23 + z * 15) + Math.sin(y * 89) * 0.051);
const copper = (x, y, z) => new T.Color(0xa75437)
  .lerp(new T.Color(0xdb9f5c), 0.28 + 0.21 * Math.sin(x * 15 + z * 13) + Math.sin(y * 210) * 0.055);

function lathe(parts, at, profile, color, sides = 24) {
  return parts.add(new T.LatheGeometry(profile.map(([radius, y]) => new T.Vector2(radius, y)), sides), color, at);
}

const ring = (p, at, radius, width, color) => p.torus(at, radius, width, color, [Math.PI / 2, 0, 0], undefined, Math.PI * 2, 24);

function dish(p, [x, y, z]) {
  lathe(p, [x, y, z], [[0, 0], [0.047, 0], [0.070, 0.007], [0.076, 0.016], [0.073, 0.020], [0.053, 0.010], [0.040, 0.007], [0, 0.007]], porcelain);
  ring(p, [x, y + 0.015, z], 0.067, 0.0019, blue);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    p.oval([x + Math.cos(a) * 0.059, y + 0.015, z + Math.sin(a) * 0.059], [0.005, 0.0015, 0.0026], 0xab4f3e, [0, -a, 0], 6);
  }
}

function teaGlass(p, [x, y, z], filled = true) {
  // The liquid and the thin open mouth stay distinct at gameplay distance.
  y += 0.010;
  if (filled) {
    const tea = (x, y, z) => new T.Color(0x8e3826).lerp(new T.Color(0xc5642a), 0.35 + 0.24 * Math.sin(x * 53 + z * 79));
    lathe(p, [x, y, z], [[0, 0.006], [0.024, 0.006], [0.028, 0.028], [0.022, 0.052], [0.025, 0.073],
      [0.031, 0.091], [0, 0.091]], tea, 20);
    ring(p, [x, y + 0.091, z], 0.029, 0.0019, 0xb15a32);
  } else {
    const glass = (x, y, z) => new T.Color(0x8faba6).lerp(new T.Color(0xece4c9),
      0.38 + 0.32 * Math.sin(x * 67 + z * 84));
    lathe(p, [x, y, z], [[0, 0.006], [0.024, 0.006], [0.028, 0.028], [0.022, 0.052], [0.025, 0.073],
      [0.031, 0.098], [0.029, 0.098], [0.022, 0.053], [0.025, 0.026], [0.018, 0.012], [0, 0.012]], glass, 20);
  }
  ring(p, [x, y + 0.005, z], 0.024, 0.003, 0xd9c6ab);
  lathe(p, [x, y, z], [[0.029, 0.087], [0.034, 0.103], [0.035, 0.106], [0.0325, 0.106], [0.031, 0.100], [0.027, 0.087]],
    0xd6d4bb, 20);
  p.sweep([[x + 0.023, y + 0.016, z + 0.013, 0.0014, 0.0014], [x + 0.025, y + 0.036, z + 0.010, 0.002, 0.0015],
    [x + 0.022, y + 0.070, z + 0.009, 0.002, 0.0014], [x + 0.031, y + 0.098, z + 0.011, 0.001, 0.0012]], 0xe6ae72, 6, 2);
}

function spoon(p, [x, y, z]) {
  p.rod([x, y, z - 0.034], [x + 0.014, y, z + 0.040], 0.0027, 0.0036, tin, 7)
    .oval([x, y - 0.001, z - 0.041], [0.008, 0.0031, 0.015], tin, undefined, 9);
}

function kettle(p, at, size, rotation, enamel) {
  const [x, y, z] = at;
  const pos = (a, b, c) => [x + size * (a * Math.cos(rotation) + c * Math.sin(rotation)),
    y + size * b, z + size * (-a * Math.sin(rotation) + c * Math.cos(rotation))];
  const profile = (rows) => rows.map(([r, h]) => [r * size, h * size]);
  const lower = [[0, 0], [0.100, 0], [0.117, 0.012], [0.124, 0.046], [0.124, 0.108], [0.109, 0.153],
    [0.086, 0.171], [0.077, 0.182], [0, 0.182]];
  const upper = [[0, 0.175], [0.079, 0.175], [0.088, 0.192], [0.091, 0.233], [0.079, 0.271],
    [0.058, 0.284], [0.059, 0.291], [0.047, 0.303], [0, 0.309]];
  lathe(p, at, profile(lower), copper);
  lathe(p, at, profile(upper), enamel);
  for (const [r, h] of [[0.115, 0.019], [0.117, 0.129], [0.082, 0.174], [0.058, 0.289]]) ring(p, pos(0, h, 0), r * size, 0.0032 * size, brass);
  p.oval(pos(0, 0.319, 0), [0.019 * size, 0.016 * size, 0.019 * size], endgrain);
  for (const [h, s] of [[0, 1], [0.175, 0.73]]) {
    const spout = [[0.094, 0.058, 0, 0.028], [0.141, 0.066, 0, 0.023], [0.171, 0.107, 0.004, 0.014],
      [0.186, 0.169, 0.009, 0.012], [0.205, 0.176, 0.013, 0.013]];
    p.sweep(spout.map(([x, y, z, r]) => [...pos(x * s, y * s + h, z), r * size * s, r * size * s]),
      h ? enamel : copper, 12, 3);
    p.oval(pos(0.204 * s, h + 0.176 * s, 0.013), [0.005 * size, 0.009 * size, 0.010 * size], iron);
    p.sweep([[-0.088, 0.052], [-0.146, 0.037], [-0.189, 0.062], [-0.188, 0.122],
      [-0.154, 0.155], [-0.088, 0.142]].map(([x, y]) => [...pos(x * s, y * s + h, 0), 0.010 * size, 0.011 * size]), endgrain, 9, 3);
  }
}

function table(p, radius) {
  lathe(p, [0, 0, 0], [[0, 0.74], [radius - 0.027, 0.74], [radius, 0.756],
    [radius, 0.786], [radius - 0.014, 0.80], [0, 0.80]], wood, 30);
  lathe(p, [0, 0, 0], [[0, 0.08], [0.061, 0.08], [0.075, 0.11], [0.051, 0.16],
    [0.045, 0.37], [0.059, 0.45], [0.049, 0.55], [0.066, 0.71], [0.11, 0.734], [0, 0.735]], 0x654937);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + 0.22;
    p.sweep([[0, 0.27, 0, 0.039, 0.044], [Math.cos(a) * 0.11, 0.145, Math.sin(a) * 0.11, 0.034, 0.045],
      [Math.cos(a) * 0.22, 0.07, Math.sin(a) * 0.22, 0.03, 0.039],
      [Math.cos(a) * 0.30, 0.038, Math.sin(a) * 0.30, 0.025, 0.032]], 0x704e36, 9, 3);
  }
  for (const stripe of [-0.20, -0.088, 0.088, 0.20]) {
    const length = Math.sqrt((radius - 0.018) ** 2 - stripe ** 2);
    p.rod([-length, 0.800, stripe], [length, 0.800, stripe], 0.0018, 0.0018, endgrain, 5);
  }
  ring(p, [0, 0.774, 0], radius + 0.0008, 0.0029, 0x4f3a31);
}

function porchTable() {
  const p = new Parts();
  table(p, 0.346);
  // Leave the center of the table clear for Uncle Ahmet's letter.
  teaTray(p, [0.188, 0.801, -0.02], 0.206, 0.65);
  for (const [x, z] of [[0.19, -0.137], [0.208, 0.082]]) {
    dish(p, [x, 0.812, z]);
    if (z > 0) teaGlass(p, [x, 0.812, z]);
    spoon(p, [x - 0.048, 0.838, z + 0.031]);
  }
  return p;
}

function cafeTable() {
  const p = new Parts();
  table(p, 0.4);
  return p;
}

function cafeCounter() {
  const p = new Parts();
  // The serving surface is the placement origin. Frame and panels hang below it.
  for (const x of [-1.035, 1.035]) for (const z of [-0.302, 0.302]) {
    p.box([x, -0.510, z], [0.086, 0.955, 0.086], endgrain);
    p.box([x, -0.946, z], [0.091, 0.086, 0.091], iron);
  }
  const green = [0x4f6e5e, 0x637866, 0x547362, 0x486759];
  for (let i = 0; i < 13; i++) {
    p.box([-0.92 + i * 0.154, -0.51, 0.299], [0.148, 0.67, 0.032], green[i % green.length]);
  }
  for (const x of [-1.028, 1.028]) for (let i = 0; i < 4; i++) {
    p.box([x, -0.51, -0.216 + i * 0.145], [0.044, 0.67, 0.144], green[i % green.length]);
  }
  for (const y of [-0.845, -0.177]) {
    p.box([0, y, 0.317], [2.12, 0.071, 0.054], wood);
    for (const x of [-1.037, 1.037]) p.box([x, y, 0], [0.062, 0.071, 0.63], wood);
  }
  p.box([0, -0.06, 0], [2.17, 0.051, 0.688], endgrain);
  for (let i = 0; i < 4; i++) p.box([0, -0.026, (i - 1.5) * 0.187], [2.29, 0.052, 0.186], i % 2 ? 0x9c714c : wood);
  p.box([0, -0.292, -0.087], [2.028, 0.038, 0.485], wood);
  const at = [-0.70, 0, 0.015];
  const [x, , z] = at;
  lathe(p, at, [[0, 0], [0.188, 0], [0.195, 0.027], [0.146, 0.038], [0.137, 0.095],
    [0.176, 0.105], [0.192, 0.19], [0.187, 0.324], [0.164, 0.402], [0.104, 0.428], [0, 0.428]], copper, 30);
  for (const [y, r, w] of [[0.033, 0.183, 0.008], [0.105, 0.171, 0.006], [0.313, 0.186, 0.006], [0.398, 0.163, 0.007]]) {
    ring(p, [x, y, z], r, w, brass);
  }
  for (const side of [-1, 1]) p.sweep([[x + side * 0.165, 0.292, z, 0.013, 0.013],
    [x + side * 0.239, 0.287, z, 0.013, 0.014], [x + side * 0.251, 0.235, z, 0.012, 0.014],
    [x + side * 0.181, 0.211, z, 0.011, 0.012]], brass, 10, 3);
  p.sweep([[x, 0.184, z + 0.168, 0.017, 0.017], [x, 0.162, z + 0.225, 0.013, 0.013],
    [x, 0.146, z + 0.257, 0.012, 0.012], [x, 0.124, z + 0.257, 0.011, 0.011]], brass, 11, 3);
  p.rod([x, 0.167, z + 0.229], [x, 0.213, z + 0.229], 0.008, 0.008, iron);
  p.rod([x - 0.023, 0.213, z + 0.229], [x + 0.023, 0.213, z + 0.229], 0.008, 0.008, endgrain);
  lathe(p, [x, 0.428, z], [[0, 0], [0.084, 0], [0.091, 0.041], [0.081, 0.092], [0.068, 0.116],
    [0.059, 0.127], [0, 0.140]], 0x789495);
  p.oval([x, 0.575, z], [0.017, 0.015, 0.017], iron);
  p.sweep([[x + 0.073, 0.462, z, 0.022, 0.022], [x + 0.117, 0.476, z, 0.017, 0.017],
    [x + 0.149, 0.514, z + 0.010, 0.011, 0.011], [x + 0.166, 0.543, z + 0.012, 0.011, 0.010]], 0x789495, 11);
  p.sweep([[x - 0.076, 0.462, z, 0.009, 0.009], [x - 0.133, 0.459, z, 0.010, 0.010],
    [x - 0.150, 0.508, z, 0.009, 0.009], [x - 0.090, 0.524, z, 0.010, 0.009]], endgrain, 9);
  lathe(p, [0.10, 0, 0.027], [[0, 0.015], [0.29, 0.015], [0.31, 0.020], [0.312, 0.037],
    [0.298, 0.038], [0.285, 0.030], [0, 0.029]], brass);
  for (const [gx, gz] of [[-0.035, 0.12], [0.12, 0.145], [0.235, 0.04], [0.069, -0.078]]) {
    dish(p, [gx, 0.028, gz]);
    teaGlass(p, [gx, 0.033, gz], gx < 0.15);
  }
  for (let i = 0; i < 2; i++) {
    const x = 0.66 + i * 0.25;
    const y = 0.16 + i * 0.048;
    p.box([x, y / 2, -0.093], [0.185, y, 0.134], i ? 0x456866 : 0xa2523c)
      .box([x, y, -0.093], [0.197, 0.022, 0.147], brass)
      .box([x, y * 0.52, -0.022], [0.135, 0.084, 0.004], 0xd7bf8d);
    for (const z of [y * 0.48, y * 0.56]) p.box([x, z, -0.019], [0.067, 0.006, 0.004], i ? 0x4b685d : 0x8c4c38);
  }
  return p;
}

function stool(p) {
  lathe(p, [0, 0, 0], [[0, 0.343], [0.164, 0.343], [0.188, 0.351], [0.190, 0.38],
    [0.172, 0.399], [0, 0.399]], wood, 18);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + 0.2;
    const feet = [Math.cos(a) * 0.166, 0.02, Math.sin(a) * 0.166];
    p.rod(feet, [feet[0] * 0.71, 0.355, feet[2] * 0.71], 0.023, 0.028, 0x735137, 7);
    const b = a + 2 * Math.PI / 3;
    p.rod([feet[0] * 0.91, 0.127, feet[2] * 0.91],
      [Math.cos(b) * 0.151, 0.165, Math.sin(b) * 0.151], 0.013, 0.014, endgrain, 7);
  }
  return p;
}

function bench() {
  const p = new Parts();
  for (let i = 0; i < 3; i++) {
    p.box([0, 0.421 + (i % 2) * 0.005, (i - 1) * 0.131], [1.58, 0.054, 0.120], i % 2 ? 0x9b704a : wood);
    p.box([0, 0.59 + i * 0.123, 0.169 + i * 0.018], [1.57, 0.094, 0.046], i % 2 ? 0x9a704a : wood, [-0.15, 0, 0]);
  }
  for (const x of [-0.63, 0.63]) {
    p.rod([x, 0.021, -0.14], [x * 0.93, 0.417, -0.113], 0.026, 0.032, endgrain, 6);
    p.rod([x, 0.018, 0.179], [x * 0.93, 0.88, 0.218], 0.032, 0.027, endgrain, 6);
    p.box([x, 0.214, 0.013], [0.061, 0.059, 0.35], 0x76563c);
    for (const z of [-0.136, 0, 0.138]) p.oval([x, 0.453, z], [0.008, 0.004, 0.008], iron, undefined, 8);
  }
  return p;
}

function bucket(p, [x, y, z]) {
  lathe(p, [x, y, z], [[0, 0], [0.098, 0], [0.112, 0.010], [0.137, 0.236], [0.139, 0.253],
    [0.128, 0.253], [0.125, 0.232], [0.100, 0.022], [0, 0.022]], tin);
  for (const [r, h] of [[0.111, 0.026], [0.128, 0.177], [0.137, 0.248]]) ring(p, [x, y + h, z], r, 0.0048, 0xc1bba6);
  p.sweep([[-0.132, 0.20, 0], [-0.153, 0.25, -0.037], [-0.119, 0.32, -0.064], [0, 0.35, -0.076],
    [0.119, 0.32, -0.064], [0.153, 0.25, -0.037], [0.132, 0.20, 0]]
    .map(([a, b, c]) => [x + a, y + b, z + c, 0.0049, 0.0049]), iron, 7, 3);
  p.rod([x - 0.047, y + 0.350, z - 0.075], [x + 0.047, y + 0.350, z - 0.075], 0.012, 0.012, wood, 11);
}

function churn() {
  const p = new Parts();
  lathe(p, [0, 0, 0], [[0, 0], [0.226, 0], [0.249, 0.017], [0.256, 0.042], [0.244, 0.523],
    [0.228, 0.626], [0.196, 0.675], [0.144, 0.743], [0.147, 0.829], [0.163, 0.837],
    [0.163, 0.850], [0.133, 0.85], [0.127, 0.755], [0.175, 0.658], [0.218, 0.611],
    [0.23, 0.042], [0, 0.042]], tin, 28);
  for (const [r, h] of [[0.254, 0.067], [0.244, 0.518], [0.151, 0.823]]) ring(p, [0, h, 0], r, 0.006, 0x6d7473);
  for (const s of [-1, 1]) {
    p.sweep([[s * 0.153, 0.730, 0, 0.013, 0.014], [s * 0.252, 0.726, 0, 0.014, 0.014],
      [s * 0.265, 0.660, 0, 0.014, 0.014], [s * 0.200, 0.643, 0, 0.013, 0.014]], tin, 9);
    p.oval([s * 0.149, 0.721, 0.01], [0.016, 0.025, 0.025], iron);
  }
  return p;
}

function press() {
  const p = new Parts();
  p.box([0, 0.49, 0], [0.80, 0.077, 0.60], wood)
    .box([0, 0.413, 0.23], [0.75, 0.10, 0.05], endgrain);
  for (const x of [-0.295, 0.295]) {
    for (const z of [-0.21, 0.21]) {
      p.rod([x * 1.12, 0.009, z * 1.10], [x, 0.452, z], 0.037, 0.047, wood, 6);
    }
    p.box([x, 0.94, 0], [0.083, 0.92, 0.118], 0x835d41);
    for (const h of [0.54, 1.37]) p.box([x, h, 0], [0.089, 0.055, 0.125], iron);
  }
  p.box([0, 1.391, 0], [0.80, 0.119, 0.166], wood);
  lathe(p, [0, 0.526, 0], [[0, 0], [0.190, 0], [0.207, 0.035], [0.218, 0.242],
    [0.204, 0.246], [0.189, 0.031], [0, 0.031]], 0xb39068);
  for (const [r, h] of [[0.207, 0.574], [0.215, 0.728]]) ring(p, [0, h, 0], r, 0.013, 0x66635a);
  for (const z of [-0.63, 0.63]) for (const x of [0.84, 1.16]) {
    p.rod([x, 0, z], [x, 1.053, z], 0.027, 0.028, endgrain, 5);
  }
  for (const h of [0.49, 0.99]) for (const x of [0.88, 1, 1.12]) p.box([x, h, 0], [0.112, 0.043, 1.42], wood);
  return p;
}

function pressSpindle(root) {
  const spindle = group(root, 'Press spindle');
  const moving = new Parts().rod([0, 0.797, 0], [0, 1.554, 0], 0.029, 0.028, iron, 12);
  const screw = Array.from({ length: 65 }, (_, i) => {
    const a = i / 64 * Math.PI * 22;
    return [Math.cos(a) * 0.034, 0.811 + i / 64 * 0.674, Math.sin(a) * 0.034, 0.006, 0.006];
  });
  moving.sweep(screw, 0x88877b, 6, 1);
  moving.rod([-0.275, 1.505, 0], [0.275, 1.505, 0], 0.013, 0.013, iron)
    .oval([-0.282, 1.505, 0], [0.030, 0.026, 0.026], wood)
    .oval([0.279, 1.505, 0], [0.030, 0.026, 0.026], wood);
  lathe(moving, [0, 0.735, 0], [[0, 0], [0.174, 0], [0.174, 0.061], [0, 0.061]], 0xd5ba8a);
  moving.mesh(spindle, 'Screw and crossbar');
  group(spindle, 'Press handle left', [-0.23, 1.52, 0]);
  group(spindle, 'Press handle right', [0.23, 1.52, 0]);
}

function teaProps(root) {
  const pot = group(root, 'Tea kettle', [-0.138, 0.802, 0.169]);
  pot.rotation.y = -0.92;
  const kettleParts = new Parts();
  kettle(kettleParts, [0, 0, 0], 0.90, 0, 0xc2764e);
  kettleParts.mesh(pot, 'Çaydanlık');
  const cup = group(root, 'Tea cup', [0.19, 0.824, -0.137]);
  const glass = new Parts();
  teaGlass(glass, [0, -0.012, 0]);
  glass.mesh(cup, 'Tulip glass');
}

function fieldTeaKit(table) {
  const kit = group(table, 'Field tea kit', [0, 0, 1.3]);
  const tray = new Parts();
  teaTray(tray, [0, 0.287, -0.46], 0.299, 1.13);
  const timber = (x, y, z) => new T.Color(0x654735).lerp(new T.Color(0xac7850),
    0.43 + 0.25 * Math.sin(x * 11 + z * 84) + 0.15 * Math.cos(y * 102 - x * 48));
  for (const z of [-0.613, -0.302]) {
    tray.rod([-0.239, 0.004, z], [0.226, 0.277, z], 0.018, 0.021, timber, 8)
      .rod([0.238, 0.004, z], [-0.226, 0.277, z], 0.018, 0.021, timber, 8)
      .rod([0, 0.143, z - 0.024], [0, 0.143, z + 0.024], 0.011, 0.012, iron, 8);
    tray.box([0, 0.270, z], [0.52, 0.033, 0.046], timber);
  }
  for (const x of [-0.237, 0.237]) {
    tray.rod([x, 0.019, -0.621], [x, 0.019, -0.293], 0.020, 0.020, timber, 8);
    tray.torus([x * 1.31, 0.307, -0.46], 0.034, 0.004, brass, [Math.PI / 2, 0, 0],
      [1, 1.31, 1], Math.PI * 2, 18);
  }
  dish(tray, [-0.171, 0.298, -0.45]);
  spoon(tray, [-0.217, 0.321, -0.425]);
  const pouch = (x, y, z) => new T.Color(0x805840).lerp(new T.Color(0xbd8a5f),
    0.48 + 0.27 * Math.sin(x * 71 + y * 25 + z * 83));
  tray.oval([-0.104, 0.325, -0.262], [0.074, 0.028, 0.052], pouch, [0, -0.25, 0.1], 16)
    .oval([-0.139, 0.357, -0.267], [0.025, 0.028, 0.021], pouch, [0, 0.26, 0.35], 11)
    .torus([-0.141, 0.348, -0.268], 0.019, 0.0025, 0xdac291, [Math.PI / 2, 0, 0.35], undefined, Math.PI * 2, 16);
  const sugar = [0.079, 0.298, -0.267];
  lathe(tray, sugar, [[0, 0], [0.031, 0], [0.039, 0.007], [0.040, 0.050],
    [0.036, 0.055], [0.040, 0.059], [0.039, 0.065], [0, 0.069]], blue);
  ring(tray, [sugar[0], 0.355, sugar[2]], 0.039, 0.0025, tin);
  tray.mesh(kit, 'Hammered tray and folding stand');

  const pot = group(kit, 'Field kettle', [0.132, 0.298, -0.48]);
  pot.rotation.y = Math.PI;
  const kettleParts = new Parts();
  kettle(kettleParts, [0, 0, 0], 0.90, 0, 0x697d77);
  kettleParts.mesh(pot, 'Travel çaydanlık');
  pot.scale.setScalar(0.82);

  const cup = group(kit, 'Field glass', [-0.171, 0.320, -0.45]);
  const glass = new Parts();
  teaGlass(glass, [0, -0.012, 0]);
  glass.mesh(cup, 'Tulip glass');
}

export function yardProps() {
  const root = group(null, 'Valley prop library');
  const lid = new Parts();
  lathe(lid, [0, 0, 0], [[0, 0.008], [0.132, 0.008], [0.169, 0.023], [0.169, 0.047],
    [0.075, 0.061], [0, 0.061]], tin);
  lid.sweep([[-0.061, 0.052, 0, 0.011, 0.011], [-0.038, 0.091, 0, 0.010, 0.010],
    [0.038, 0.091, 0, 0.010, 0.010], [0.061, 0.052, 0, 0.011, 0.011]], iron, 9);
  const milking = stool(new Parts());
  bucket(milking, [0.39, 0, 0.115]);
  const wheel = new Parts();
  lathe(wheel, [0, 0, 0], [[0, -0.039], [0.092, -0.039], [0.107, -0.029], [0.11, 0.023],
    [0.099, 0.039], [0.064, 0.043], [0, 0.041]], 0xece1bd, 18);
  ring(wheel, [0, -0.028, 0], 0.104, 0.0028, 0xccba90);
  // Spread the templates out when the GLB is opened outside the game.
  const templates = [
    ['Porch tea table', porchTable()], ['Porch bench', bench()], ['Cafe tea table', cafeTable()],
    ['Cafe tea counter', cafeCounter()], ['Wooden stool', stool(new Parts())],
    ['Milking station', milking], ['Milk churn', churn()], ['Churn lid', lid],
    ['Cheese press and shelf', press()], ['Cheese wheel', wheel],
  ];
  for (const [i, [name, parts]] of templates.entries()) {
    const origin = [(i % 5) * 2.7, 0, Math.floor(i / 5) * 2.6];
    const prop = group(root, name, origin);
    parts.mesh(prop, name + ' mesh');
    if (name === 'Porch tea table') {
      teaProps(prop);
      fieldTeaKit(prop);
    }
    if (name === 'Cheese press and shelf') pressSpindle(prop);
  }
  return root;
}

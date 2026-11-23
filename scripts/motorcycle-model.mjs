import * as T from 'three';
import { Parts, group } from './model-parts.mjs';

const steel = 0x9b9c95;
const chrome = 0xd0c9b7;
const iron = 0x4b4d47;
const rubber = 0x292724;
const frame = 0x353a30;
const brass = 0xad8b54;
const leather = 0x48332b;
const green = (x, y, z) => {
  const wear = Math.sin(x * 183 + y * 287) * Math.cos(z * 226 - y * 97);
  if (wear > 0.95) return 0x766e50;
  return new T.Color(0x68765a).lerp(new T.Color(0x3b5044), T.MathUtils.smoothstep(-y, -0.99, -0.76));
};

function wheel(root, name, z, r, rear) {
  const pivot = group(root, name, [0, r, z]);
  const wheel = new Parts();
  const across = [0, Math.PI / 2, 0];
  wheel.torus([0, 0, 0], r - 0.048, 0.048, rubber, across, [1, 1, rear ? 1.1 : 0.91]);
  for (const side of [-1, 1]) {
    wheel.torus([side * 0.033, 0, 0], r - 0.067, 0.012, 0x443e36, across);
    wheel.torus([side * 0.029, 0, 0], r - 0.084, 0.012, chrome, across);
    wheel.torus([side * 0.031, 0, 0], r - 0.096, 0.006, iron, across);
    for (let i = 0; i < 14; i++) {
      const a = i * Math.PI / 7 + side * 0.11;
      const b = a + side * (i % 2 ? 0.34 : -0.34);
      wheel.rod([side * 0.052, Math.cos(a) * 0.063, Math.sin(a) * 0.063],
        [side * 0.023, Math.cos(b) * (r - 0.085), Math.sin(b) * (r - 0.085)], 0.0031, 0.0033, steel, 5);
    }
  }
  wheel.rod([-0.065, 0, 0], [0.065, 0, 0], 0.058, 0.058, iron, 16);
  wheel.rod([-0.076, 0, 0], [-0.06, 0, 0], 0.043, 0.045, steel, 12);
  wheel.rod([0.059, 0, 0], [0.074, 0, 0], 0.062, 0.057, steel, 16);
  const tread = 36;
  for (let i = 0; i < tread; i++) {
    const a = i * Math.PI * 2 / tread;
    for (const side of [-1, 1]) {
      const b = a + side * 0.034;
      wheel.box([side * 0.024, (r - 0.004) * Math.cos(b), (r - 0.004) * Math.sin(b)],
        [0.032, 0.008, 0.018], 0x302d28, [b, 0, side * 0.20]);
    }
  }
  wheel.mesh(pivot, rear ? 'Rear tyre and laced rim' : 'Front tyre and laced rim');
}

function mudguard(parts, center, radius, width, start, end) {
  const [x, y, z] = center;
  const rows = Array.from({ length: 12 }, (_, i) => {
    const a = T.MathUtils.lerp(start, end, i / 11);
    const taper = i === 0 || i === 11 ? 0.52 : 1;
    return [x, y + Math.cos(a) * radius, z + Math.sin(a) * radius, width * taper, 0.015 * taper];
  });
  parts.sweep(rows, green, 12, 3, [1, 0, 0]);
  for (const s of [-1, 1]) {
    parts.sweep(rows.map(([x, y, z], i) => [x + s * width * 0.85 * (i === 0 || i === 11 ? 0.52 : 1),
      y + 0.008, z, 0.0038, 0.0038]), brass, 6, 2);
  }
}

export function motorcycleModel({ wheelRadius: r, cgFromRear: rz, wheelbase }) {
  const fz = rz - wheelbase;
  const root = group(null, '175 cc field motorcycle');
  wheel(root, 'Rear wheel', rz, r, true);
  wheel(root, 'Front wheel', fz, r, false);
  const body = new Parts();
  const frameX = 0.097;
  for (const s of [-1, 1]) {
    const x = s * frameX;
    body.rod([x, 0.775, fz + 0.205], [x, 0.735, 0.26], 0.029, 0.025, frame)
      .rod([x, 0.77, fz + 0.22], [x, 0.285, -0.28], 0.022, 0.022, frame)
      .rod([x, 0.285, -0.28], [x, 0.278, 0.20], 0.021, 0.023, frame)
      .rod([x, 0.278, 0.20], [x, 0.735, 0.21], 0.021, 0.024, frame)
      .rod([x * 1.38, 0.39, 0.17], [x * 1.26, r, rz], 0.024, 0.019, frame)
      .rod([x, 0.72, 0.15], [x * 1.22, 0.744, rz + 0.28], 0.021, 0.019, frame)
      .rod([x * 1.75, 0.39, 0.07], [x * 2.63, 0.39, 0.07], 0.021, 0.019, rubber)
      .rod([x * 1.44, 0.365, 0.37], [x * 2.25, 0.365, 0.37], 0.019, 0.017, iron);
    const shockStart = new T.Vector3(x * 1.37, r + 0.023, rz - 0.01);
    const shockEnd = new T.Vector3(x * 1.36, 0.729, rz - 0.11);
    const axis = shockEnd.clone().sub(shockStart);
    body.rod(shockStart.toArray(), shockEnd.toArray(), 0.018, 0.016, chrome);
    const spring = Array.from({ length: 63 }, (_, i) => {
      const t = i / 62, a = t * Math.PI * 14;
      return [...shockStart.clone().addScaledVector(axis, 0.11 + t * 0.79)
        .add(new T.Vector3(Math.cos(a) * 0.025, Math.sin(a) * 0.004, Math.sin(a) * 0.026)).toArray(), 0.006, 0.006];
    });
    body.sweep(spring, iron, 6, 1);

    body.oval([x * 1.21, 0.635, 0.191], [0.033, 0.11, 0.178], green, [0.30, 0, 0], 14);
    body.rod([x * 1.4, 0.731, 0.49], [x * 1.4, 0.757, 0.917], 0.011, 0.011, chrome);
  }
  for (let i = 0; i < 5; i++) {
    const z = 0.52 + i * 0.087;
    body.rod([-0.141, 0.737 + i * 0.004, z], [0.141, 0.737 + i * 0.004, z], 0.009, 0.009, steel, 8);
  }

  // Engine, fins, crankcase, carburetor, and the swept exhaust.
  body.oval([0.02, 0.392, -0.019], [0.149, 0.131, 0.207], steel, [0.04, 0, 0], 18);
  body.rod([-0.153, 0.392, -0.052], [-0.128, 0.392, -0.052], 0.093, 0.101, chrome, 20);
  body.rod([0.119, 0.39, 0.079], [0.167, 0.39, 0.079], 0.066, 0.072, iron, 16);
  body.rod([0, 0.392, -0.099], [0, 0.66, -0.155], 0.106, 0.109, iron, 10);
  for (let i = 0; i < 9; i++) {
    const y = 0.478 + i * 0.022;
    const z = -0.12 - i * 0.0045;
    body.oval([0, y, z], [0.132 - 0.002 * i, 0.009, 0.114 - 0.001 * i], i % 3 === 0 ? chrome : steel, [-0.15, 0, 0], 14);
  }
  body.oval([0, 0.678, -0.165], [0.11, 0.028, 0.108], iron, [-0.16, 0, 0], 14);
  body.rod([0, 0.604, -0.055], [0, 0.565, 0.103], 0.042, 0.059, steel);
  body.sweep([[0.059, 0.59, -0.229, 0.024, 0.024], [0.085, 0.563, -0.345, 0.024, 0.024],
    [0.130, 0.39, -0.369, 0.024, 0.024], [0.173, 0.311, -0.238, 0.025, 0.025],
    [0.182, 0.31, 0.244, 0.028, 0.028], [0.184, 0.339, 0.396, 0.036, 0.036],
    [0.187, 0.375, 0.78, 0.046, 0.046], [0.188, 0.391, 0.885, 0.032, 0.032]], chrome, 16);
  body.rod([0.188, 0.391, 0.881], [0.188, 0.394, 0.897], 0.027, 0.023, rubber, 14);
  body.rod([-0.162, 0.41, 0.053], [-0.196, 0.487, -0.086], 0.009, 0.009, steel);

  // Painted fuel tank, knee pads, coachlines, leather saddle, and rear rack.
  body.sweep([[0, 0.818, -0.487, 0.014, 0.014], [0, 0.851, -0.411, 0.111, 0.104],
    [0, 0.846, -0.266, 0.134, 0.163], [0, 0.826, -0.101, 0.121, 0.157],
    [0, 0.788, 0.045, 0.067, 0.107], [0, 0.783, 0.109, 0.018, 0.021]], green, 24, 5, [0, 1, 0]);
  body.rod([0, 0.963, -0.300], [0, 0.984, -0.300], 0.041, 0.039, chrome, 18);
  for (const s of [-1, 1]) {
    body.oval([s * 0.136, 0.796, -0.12], [0.018, 0.053, 0.133], 0x393b32, [-0.16, s * -0.22, 0], 14);
    body.sweep([[s * 0.096, 0.883, -0.432, 0.003, 0.003], [s * 0.148, 0.908, -0.336, 0.004, 0.004],
      [s * 0.144, 0.898, -0.173, 0.004, 0.004], [s * 0.111, 0.856, -0.028, 0.003, 0.003]], 0xd2b984, 8, 4);
    body.oval([s * 0.161, 0.864, -0.253], [0.007, 0.027, 0.063], brass, undefined, 16);
    body.oval([s * 0.167, 0.865, -0.253], [0.006, 0.012, 0.043], 0x2e483f);
  }
  body.sweep([[0, 0.791, 0.028, 0.013, 0.015], [0, 0.814, 0.077, 0.032, 0.106],
    [0, 0.819, 0.176, 0.045, 0.144], [0, 0.808, 0.327, 0.047, 0.159],
    [0, 0.805, 0.46, 0.038, 0.13], [0, 0.804, 0.507, 0.009, 0.029]], leather, 22, 5, [0, 1, 0]);
  for (const s of [-1, 1]) {
    body.sweep([[s * 0.054, 0.827, 0.066, 0.0025, 0.0025], [s * 0.128, 0.835, 0.164, 0.0025, 0.0025],
      [s * 0.15, 0.827, 0.317, 0.0025, 0.0025], [s * 0.117, 0.828, 0.451, 0.0025, 0.0025],
      [0, 0.816, 0.503, 0.0025, 0.0025]], 0xa48161, 6);
  }
  mudguard(body, [0, r, rz], r + 0.065, 0.091, -0.9, 1.55);
  body.oval([0, 0.608, rz + 0.30], [0.054, 0.042, 0.044], 0x7c352e, [0.36, 0, 0], 12);
  body.box([0, 0.525, rz + 0.335], [0.124, 0.062, 0.011], 0xb6ae95, [-0.27, 0, 0]);
  body.mesh(root, 'Frame and engine');

  const fork = group(root, 'Fork', [0, 0.86, fz + 0.2]);
  fork.rotation.order = 'XYZ';
  fork.rotation.x = 0.42;
  const front = new Parts();
  for (const s of [-1, 1]) {
    front.rod([s * 0.091, -0.575, 0.043], [s * 0.091, -0.208, 0.043], 0.033, 0.029, steel);
    front.rod([s * 0.091, -0.28, 0.043], [s * 0.091, 0.039, 0.043], 0.019, 0.019, chrome);
    for (let i = 0; i < 6; i++) {
      const y = -0.224 + i * 0.022;
      front.rod([s * 0.091, y, 0.043], [s * 0.091, y + 0.011, 0.043], 0.028, 0.027, rubber);
    }
    front.rod([s * 0.19, 0.133, 0.118], [s * 0.352, 0.132, 0.151], 0.027, 0.024, rubber);
    front.rod([s * 0.351, 0.132, 0.151], [s * 0.363, 0.132, 0.154], 0.022, 0.022, chrome);
    front.sweep([[s * 0.20, 0.135, 0.12, 0.007, 0.007], [s * 0.248, 0.14, 0.071, 0.007, 0.007],
      [s * 0.315, 0.138, 0.071, 0.007, 0.007], [s * 0.348, 0.132, 0.082, 0.005, 0.005]], chrome, 8);
    front.sweep([[s * 0.203, 0.132, 0.118, 0.004, 0.004], [s * 0.104, 0.062, -0.012, 0.004, 0.004],
      [s * 0.045, -0.081, -0.033, 0.004, 0.004], [s * 0.091, -0.31, 0.031, 0.004, 0.004]], iron, 8);
  }
  front.rod([-0.117, 0.002, 0.044], [0.117, 0.002, 0.044], 0.024, 0.024, iron)
    .rod([-0.115, -0.127, 0.044], [0.115, -0.127, 0.044], 0.027, 0.027, iron);
  front.sweep([[-0.199, 0.131, 0.119, 0.014, 0.014], [-0.123, 0.101, 0.108, 0.014, 0.014],
    [-0.071, 0.057, 0.074, 0.014, 0.014], [0.071, 0.057, 0.074, 0.014, 0.014],
    [0.123, 0.101, 0.108, 0.014, 0.014], [0.199, 0.131, 0.119, 0.014, 0.014]], chrome, 10);
  front.oval([0, 0.064, -0.121], [0.111, 0.109, 0.108], green, undefined, 20);
  front.torus([0, 0.064, -0.200], 0.104, 0.013, chrome, undefined, [1, 1, 0.7]);
  front.rod([0.061, 0.074, 0.025], [0.061, 0.131, 0.044], 0.042, 0.042, iron, 16);
  front.rod([0.061, 0.132, 0.044], [0.061, 0.135, 0.045], 0.035, 0.035, 0xc0ae90, 16);
  // Counter-rotate the fender about the raked steering head to follow the tire.
  const fender = group(fork, 'Front fender');
  fender.rotation.x = -0.42;
  fender.position.set(0, r - 0.86, -0.2).applyAxisAngle(new T.Vector3(1, 0, 0), -0.42);
  const guard = new Parts();
  mudguard(guard, [0, 0, 0], r + 0.046, 0.07, -1.20, 1.19);
  guard.mesh(fender, 'Front painted mudguard');
  front.mesh(fork, 'Suspension and handlebars');

  const lens = new Parts().oval([0, 0.064, -0.201], [0.096, 0.096, 0.027], 0xf5e0a9, undefined, 24);
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.021;
    const y = Math.sqrt(0.092 ** 2 - x ** 2) * 0.88;
    lens.oval([x, 0.064, -0.222 + Math.abs(i) * 0.0017], [0.0025, y, 0.005], 0xcab886, undefined, 8);
  }
  lens.mesh(fork, 'Headlamp lens');

  new Parts().rod([0, 0, 0], [-0.161, -0.345, 0.033], 0.013, 0.01, iron)
    .box([-0.167, -0.345, 0.04], [0.06, 0.017, 0.067], steel, [0, -0.26, 0])
    .mesh(root, 'Kickstand', [-0.116, 0.34, 0.17]);

  const starter = group(root, 'Kick starter', [0.167, 0.39, 0.049]);
  new Parts()
    .rod([0, 0, 0], [0.054, 0.171, 0.067], 0.012, 0.012, steel)
    .rod([0.049, 0.171, 0.067], [0.119, 0.171, 0.067], 0.015, 0.015, rubber)
    .mesh(starter, 'Starter pedal');
  group(starter, 'Kick pedal anchor', [0.083, 0.171, 0.067]);
  group(root, 'Left recovery frame', [-0.147, 0.51, -0.15]);
  group(root, 'Right recovery frame', [0.147, 0.51, -0.15]);
  group(root, 'Left recovery rail', [-0.145, 0.743, 0.52]);
  group(root, 'Right recovery rail', [0.145, 0.743, 0.52]);

  group(root, 'Saddle anchor', [0, 0.765, 0.23]);
  // Ankle centers while the soles are on the foot pegs.
  group(root, 'Left peg anchor', [-0.226, 0.55, 0.132]);
  group(root, 'Right peg anchor', [0.226, 0.55, 0.132]);
  group(fork, 'Left grip anchor', [-0.29, 0.155, 0.139]);
  group(fork, 'Right grip anchor', [0.29, 0.155, 0.139]);
  return root;
}

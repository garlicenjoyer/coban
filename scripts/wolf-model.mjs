import * as T from 'three';
import { group, Parts } from './model-parts.mjs';

const sides = [-1, 1];
const saddle = new T.Color(0x575651);
const mantle = new T.Color(0x858078);
const underfur = new T.Color(0xb8a990);
const muzzle = 0x6c665b;
const nose = 0x282626;
const { smoothstep } = T.MathUtils;

function coat(x, y, z) {
  const edge = Math.sin(z * 24 + x * 17) * 0.033 + Math.cos(z * 11) * 0.025;
  return mantle.clone()
    .lerp(saddle, smoothstep(y + edge, 0.03, 0.29) * 0.92)
    .lerp(underfur, 1 - smoothstep(y + edge, -0.20, 0.015));
}

export function wolfModel() {
  const root = group(null, 'Anatolian gray wolf');
  const body = group(root, 'Body', [0, 0.63, 0]);
  const p = new Parts()
    .sweep([
      [0, 0.17, -0.67, 0.034, 0.053],
      [0, 0.119, -0.49, 0.253, 0.200],
      [0, 0.027, -0.31, 0.266, 0.226],
      [0, 0.03, -0.11, 0.223, 0.180],
      [0, 0.061, 0.16, 0.167, 0.143],
      [0, 0.038, 0.37, 0.198, 0.179],
      [0, 0.033, 0.51, 0.152, 0.142],
      [0, 0.070, 0.60, 0.037, 0.053],
    ], coat, 20, 4, [0, 1, 0])
    .oval([0, 0.106, -0.398], [0.208, 0.251, 0.249], coat, [-0.32, 0, 0], 17);
  for (const s of sides) {
    // Tapered locks give the shoulder and ruff an uneven silhouette.
    p.sweep([
      [s * 0.111, 0.238, -0.514, 0.075, 0.070],
      [s * 0.174, 0.152, -0.422, 0.092, 0.055],
      [s * 0.211, 0.033, -0.300, 0.047, 0.034],
      [s * 0.201, -0.053, -0.228, 0.006, 0.004],
    ], coat, 11, 3, [1, 0, 0]);
    p.sweep([
      [s * 0.075, 0.025, -0.587, 0.051, 0.065],
      [s * 0.122, -0.037, -0.486, 0.088, 0.076],
      [s * 0.127, -0.131, -0.409, 0.043, 0.039],
      [s * 0.087, -0.204, -0.335, 0.004, 0.006],
    ], 0xafa48f, 10, 3, [1, 0, 0]);
  }
  p.mesh(body, 'Coat and ruff');

  const head = group(root, 'Head', [0, 0.845, -0.526]);
  const face = (x, y, z) => new T.Color(y > 0.039 ? 0x736b60 : 0xaa9e88)
    .lerp(mantle, smoothstep(Math.abs(x), 0.083, 0.153) * 0.40)
    .lerp(saddle, smoothstep(-z, 0.18, 0.46) * 0.62);
  const skull = new Parts()
    .oval([0, 0.025, -0.123], [0.152, 0.141, 0.199], face, [0.1, 0, 0], 18)
    .sweep([
      [0, 0.025, -0.166, 0.097, 0.122],
      [0, -0.006, -0.264, 0.074, 0.088],
      [0, -0.045, -0.378, 0.051, 0.064],
      [0, -0.047, -0.445, 0.036, 0.052],
    ], face, 16, 4, [0, 1, 0])
    .oval([0, -0.038, -0.447], [0.058, 0.038, 0.042], nose, undefined, 14);
  for (const s of sides) {
    skull.sweep([
      [s * 0.088, -0.047, -0.220, 0.059, 0.039],
      [s * 0.124, -0.046, -0.144, 0.067, 0.054],
      [s * 0.147, -0.064, -0.062, 0.047, 0.030],
      [s * 0.171, -0.091, 0.013, 0.004, 0.004],
    ], 0xaa9d87, 10, 3, [0, 1, 0]);
    skull.oval([s * 0.114, 0.032, -0.257], [0.027, 0.023, 0.041], 0x4c4036, [0, -s * 0.45, -s * 0.25], 12)
      .oval([s * 0.133, 0.032, -0.269], [0.012, 0.014, 0.021], 0xc99346)
      .oval([s * 0.141, 0.033, -0.274], [0.007, 0.009, 0.011], nose)
      .oval([s * 0.145, 0.037, -0.277], [0.003, 0.0035, 0.0035], 0xe9ddc4);
    const ear = group(head, s === -1 ? 'Ear left' : 'Ear right', [s * 0.094, 0.112, -0.069]);
    new Parts().sweep([
      [0, -0.022, 0.010, 0.055, 0.043],
      [s * 0.010, 0.040, -0.004, 0.061, 0.039],
      [s * 0.024, 0.114, -0.018, 0.034, 0.021],
      [s * 0.034, 0.178, -0.016, 0.004, 0.005],
    ], (x, y, z) => z < -0.024 && y < 0.126 ? 0xa28d80 : y > 0.11 ? 0x5e5751 : 0x80756a,
    12, 3, [1, 0, 0]).mesh(ear, 'Pointed ear');
  }
  skull.mesh(head, 'Skull and muzzle');

  const jaw = group(head, 'Jaw', [0, -0.063, -0.153]);
  new Parts()
    .oval([0, -0.037, -0.131], [0.067, 0.037, 0.149], muzzle, [0.12, 0, 0], 16)
    .oval([0, -0.013, -0.150], [0.054, 0.017, 0.113], 0x4c3736, undefined, 12)
    .oval([0, -0.004, -0.168], [0.039, 0.009, 0.076], 0x9e6961)
    .mesh(jaw, 'Lower jaw');

  const tail = group(root, 'Tail', [0, 0.696, 0.533]);
  new Parts().sweep([
    [0, 0.002, -0.037, 0.052, 0.053],
    [0.005, -0.056, 0.112, 0.068, 0.060],
    [0.009, -0.150, 0.270, 0.071, 0.061],
    [0.016, -0.239, 0.396, 0.056, 0.052],
    [0.020, -0.291, 0.487, 0.034, 0.028],
    [0.023, -0.310, 0.550, 0.004, 0.004],
  ], (x, y, z) => z > 0.38 ? 0x4d4741 : y > -0.13 ? 0x68655f : 0x8e8274, 14, 4)
    .mesh(tail, 'Brush tail');

  for (const [i, s, front] of [[0, 1, true], [1, -1, true], [2, 1, false], [3, -1, false]]) {
    const upper = group(root, `Leg ${i}`, [s * (front ? 0.139 : 0.120), 0.595, front ? -0.344 : 0.368]);
    new Parts().oval([s * 0.013, -0.065, front ? -0.025 : -0.050],
      [front ? 0.081 : 0.103, 0.208, front ? 0.090 : 0.119],
      (x, y, z) => y < -0.13 ? 0x79736a : coat(x, y - 0.06, z), [front ? 0.115 : 0.23, 0, s * 0.038], 14)
      .mesh(upper, 'Upper leg');
    const lower = group(upper, `Lower ${i}`, [s * 0.016, -0.256, front ? 0.005 : -0.062]);
    new Parts().sweep([
      [0, 0.052, 0.001, 0.054, 0.054], [0, -0.079, front ? 0.015 : 0.071, 0.042, 0.047],
      [0, -0.186, front ? 0.020 : 0.061, 0.030, 0.040],
      [0, -0.278, -0.013, 0.032, 0.040],
    ], (x, y, z) => y < -0.17 ? 0x544e46 : y < -0.08 ? 0x7b7163 : 0x968b79, 12)
      .mesh(lower, 'Lower leg');
    const paw = group(lower, `Paw ${i}`, [0, -0.294, -0.030]);
    new Parts().oval([0, 0, 0], [0.051, 0.045, 0.072], 0x5c574e, [0.08, 0, 0], 12).mesh(paw, 'Paw mesh');
    group(paw, `Sole ${i}`, [0, -0.045, 0]);
  }
  return root;
}

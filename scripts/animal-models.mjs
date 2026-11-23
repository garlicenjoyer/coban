import * as T from 'three';
import { group, Parts } from './model-parts.mjs';

const sign = [-1, 1];

const coats = [
  { name: 'Ivory', fleece: 0xfffaf0, points: 0xffede0, size: 1.02 },
  { name: 'Oatmeal', fleece: 0xf1dbbb, points: 0xe5b591, size: 0.91 },
  { name: 'Ash', fleece: 0xd4c7b9, points: 0xc9c5c8, size: 0.99 },
  { name: 'Honey lamb', fleece: 0xd2a87e, points: 0xdec095, size: 0.77 },
  { name: 'Russet', fleece: 0xb88465, points: 0xcc9271, size: 1.06 },
  { name: 'Dark grey', fleece: 0x80716c, points: 0xa08b87, size: 0.94 },
  { name: 'Cream lamb with dark points', fleece: 0xf5e9d0, points: 0xc2aea1, size: 0.73 },
];
const bellwether = { name: 'Bellwether', fleece: 0x92705b, points: 0xae8e79, size: 1.07 };

export function sheepModel() {
  const root = group(null, 'Aegean sheep');
  root.userData.coats = coats;
  root.userData.bellwether = bellwether;
  const body = new Parts();
  const wool = (x, y, z) => new T.Color(0xf9f1e2)
    .lerp(new T.Color(0x9b8068), T.MathUtils.clamp((-y + Math.sin(z * 10) * 0.045) * 1.35, 0, 0.56));
  body.oval([0, 0.01, 0.025], [0.323, 0.292, 0.489], wool, undefined, 20);
  body.oval([0, 0.046, -0.25], [0.274, 0.269, 0.278], wool);
  body.oval([0, -0.001, 0.31], [0.287, 0.259, 0.226], wool);
  // Uneven overlapping locks follow the barrel of the fleece.
  for (let row = 0; row < 6; row++) {
    const z = -0.37 + row * 0.147;
    const taper = Math.sqrt(1 - (z / 0.55) ** 2);
    for (let k = 0; k < 9; k++) {
      const a = Math.PI * 2 * (k + (row % 2) * 0.52) / 9;
      const w = 0.94 + 0.11 * Math.sin(k * 3.8 + row * 5.1);
      const x = Math.cos(a) * 0.247 * taper;
      const y = Math.sin(a) * 0.218 * taper + 0.026;
      body.oval([x, y, z], [0.112 * w, 0.092 * w, 0.111 * w], wool, [0.3 * Math.sin(k + row), 0, a], 8, 0.07);
    }
  }
  body.mesh(root, 'Wool', [0, 0.63, 0]);

  const face = new Parts();
  const dark = (x, y, z) => new T.Color(z < -0.39 ? 0x524137 : y > 0.02 ? 0x927863 : 0x634e43);
  new Parts()
    .sweep([[0, 0.085, 0.076, 0.148, 0.128], [0, 0.129, -0.062, 0.169, 0.143],
      [0, 0.172, -0.200, 0.121, 0.109], [0, 0.173, -0.295, 0.071, 0.071]], wool, 15, 4, [0, 1, 0])
    .mesh(root, 'Neck', [0, 0.59, -0.34]);
  face.oval([0, 0.022, -0.264], [0.117, 0.122, 0.139], dark, [-0.38, 0, 0], 14);
  face.oval([0, -0.052, -0.351], [0.086, 0.061, 0.128], dark, [-0.34, 0, 0], 14);
  face.oval([0, -0.098, -0.448], [0.064, 0.037, 0.036], 0x352b29);
  face.oval([0, 0.127, -0.225], [0.121, 0.077, 0.108], wool, undefined, 11);
  for (const s of sign) {
    face.oval([s * 0.178, 0.042, -0.234], [0.111, 0.038, 0.05], dark, [0, s * 0.18, s * -0.24], 12);
    face.oval([s * 0.190, 0.057, -0.241], [0.075, 0.023, 0.035], 0x9c7364, [0, s * 0.18, s * -0.24], 10);
    face.oval([s * 0.103, 0.048, -0.316], [0.018, 0.024, 0.031], 0x332825, [0, s * -0.3, 0]);
    face.oval([s * 0.116, 0.051, -0.322], [0.007, 0.011, 0.019], 0xd3a35f);
    face.oval([s * 0.121, 0.051, -0.322], [0.005, 0.007, 0.013], 0x221d1c);
  }
  const head = group(root, 'Head pivot', [0, 0.77, -0.60]);
  face.mesh(head, 'Head', [0, 0, 0.22]);
  const jaw = group(head, 'Jaw pivot', [0, -0.053, -0.033]);
  new Parts().oval([0, -0.051, -0.091], [0.071, 0.035, 0.112], 0x685346, [-0.30, 0, 0], 14)
    .oval([0, -0.042, -0.119], [0.051, 0.015, 0.076], 0x463a34, [-0.20, 0, 0], 12)
    .mesh(jaw, 'Jaw');
  group(head, 'Muzzle point', [0, -0.109, -0.238]);

  const leader = new Parts();
  for (const s of sign) {
    const rows = Array.from({ length: 11 }, (_, i) => {
      const t = i / 10, a = t * Math.PI * 1.68;
      const r = 0.078 - t * 0.025;
      const width = 0.041 * (1 - t) ** 0.8 + 0.001;
      return [s * (0.091 + 0.071 * Math.sin(t * Math.PI * 0.89)), 0.065 + r * Math.cos(a),
        -0.243 + r * Math.sin(a), width, width * 0.88];
    });
    leader.sweep(rows, (x, y, z) => Math.sin((z + y * 0.9 + Math.abs(x)) * 129) < -0.18 ? 0x9e7e57 : 0xc2a071, 10, 2);
  }
  leader.torus([0, -0.026, -0.103], 0.137, 0.012, 0x613624, [Math.PI / 2 - 0.24, 0, 0], [1, 1, 1]);
  leader.rod([0, -0.149, -0.205], [0, -0.226, -0.205], 0.045, 0.027, 0xac742f);
  leader.torus([0, -0.226, -0.205], 0.043, 0.006, 0xd69948, [Math.PI / 2, 0, 0]);
  leader.oval([0, -0.234, -0.205], [0.014, 0.016, 0.014], 0x634628);
  leader.mesh(head, 'Ram horns and bell', [0, 0, 0.22]);

  const legPositions = [[0.16, -0.29], [-0.16, -0.29], [0.16, 0.29], [-0.16, 0.29]];
  let meshes;
  for (const [i, [x, z]] of legPositions.entries()) {
    const hip = group(root, `Leg ${i}`, [x, 0.42, z]);
    const knee = group(hip, `Lower ${i}`, [0, -0.205, 0.019]);
    const hoof = group(knee, `Paw ${i}`, [0, -0.182, -0.041]);
    group(hoof, `Sole ${i}`, [0, -0.034, 0]);
    if (meshes) {
      [hip, knee, hoof].forEach((pivot, k) => pivot.add(meshes[k].clone()));
      continue;
    }
    const upper = new Parts()
      .oval([0, -0.029, 0.015], [0.092, 0.151, 0.099], wool)
      .sweep([[0, -0.085, 0.018, 0.054, 0.055], [0, -0.153, 0.032, 0.043, 0.041],
        [0, -0.216, 0.023, 0.037, 0.039]], 0x635144, 10)
      .mesh(hip, 'Upper sheep leg');
    const lower = new Parts()
      .sweep([[0, 0.019, 0.008, 0.039, 0.038], [0, -0.064, 0.006, 0.031, 0.033],
        [0, -0.121, -0.012, 0.025, 0.031], [0, -0.18, -0.033, 0.036, 0.041]], 0x635144, 10)
      .mesh(knee, 'Lower sheep leg');
    const toes = new Parts();
    for (const s of sign) toes.oval([s * 0.018, -0.001, -0.006], [0.018, 0.032, 0.047], 0x302624, [0.11, 0, 0], 10);
    meshes = [upper, lower, toes.mesh(hoof, 'Cloven hoof')];
  }
  new Parts().oval([0, -0.07, 0.08], [0.063, 0.141, 0.082], wool, [-0.63, 0, 0]).mesh(root, 'Tail', [0, 0.64, 0.444]);
  return root;
}

/** The game instances the first scene; model viewers can select the finished variants. */
export function sheepScenes() {
  const base = sheepModel();
  const template = new T.Scene();
  template.name = 'Paintable sheep';
  template.add(base);

  const variants = [...coats, bellwether].map((coat) => {
    const scene = new T.Scene();
    scene.name = coat.name;
    const sheep = base.clone();
    sheep.scale.setScalar(coat.size);
    const horns = sheep.getObjectByName('Ram horns and bell');
    if (coat !== bellwether) horns.removeFromParent();
    const material = base.getObjectByName('Wool').material;
    const fleece = material.clone();
    fleece.color.setHex(coat.fleece);
    const points = material.clone();
    points.color.setHex(coat.points);
    sheep.traverse((node) => {
      if (node.isMesh && node !== horns) node.material = ['Wool', 'Neck', 'Tail'].includes(node.name) ? fleece : points;
    });
    scene.add(sheep);
    return scene;
  });
  return [template, ...variants];
}

export function dogModel() {
  const root = group(null, 'Karabaş');
  const fur = (x, y, z) => new T.Color(0xdab37a).lerp(new T.Color(y > 0 ? 0x865f40 : 0xebd0a1),
    T.MathUtils.clamp(Math.abs(y) * 2.15 + Math.sin((x + z) * 12) * 0.095, 0, 0.59));
  const mask = 0x362e2a, nose = 0x221d1d;
  const body = group(root, 'Body', [0, 0.66, 0]);
  new Parts()
    .sweep([[0, 0.08, -0.64, 0.013, 0.012], [0, 0.035, -0.45, 0.252, 0.225],
      [0, -0.009, -0.23, 0.291, 0.247], [0, 0.03, 0.03, 0.225, 0.199],
      [0, 0.067, 0.27, 0.164, 0.178], [0, 0.035, 0.45, 0.238, 0.217],
      [0, 0.04, 0.59, 0.159, 0.155], [0, 0.09, 0.65, 0.006, 0.006]], fur, 18, 4, [0, 1, 0])
    .oval([0, 0.124, -0.451], [0.238, 0.299, 0.235], fur, [-0.40, 0, 0], 16)
    .oval([0, -0.073, -0.445], [0.17, 0.156, 0.164], 0xddbd8e, [-0.24, 0, 0], 14)
    .mesh(body, 'Coat');

  const head = group(root, 'Head', [0, 0.92, -0.58]);
  const face = (x, y, z) => new T.Color(0xc59b63).lerp(new T.Color(mask),
    T.MathUtils.smoothstep(-z + Math.max(0, -y) * 0.46 - Math.abs(x) * 0.25, 0.10, 0.255));
  const skull = new Parts()
    .oval([0, 0.01, -0.095], [0.187, 0.166, 0.207], face, [0.10, 0, 0], 18)
    .oval([0, -0.025, -0.222], [0.135, 0.106, 0.158], face, [-0.24, 0, 0], 16)
    .oval([0, -0.051, -0.331], [0.094, 0.067, 0.106], mask, [-0.12, 0, 0], 16)
    .oval([0, -0.029, -0.413], [0.073, 0.043, 0.042], nose, undefined, 14);
  for (const s of sign) {
    skull.oval([s * 0.137, 0.033, -0.221], [0.027, 0.028, 0.047], 0x38302a, [0, -s * 0.39, s * 0.18], 12);
    skull.oval([s * 0.154, 0.034, -0.241], [0.012, 0.016, 0.023], 0xb27939);
    skull.oval([s * 0.162, 0.035, -0.244], [0.008, 0.011, 0.012], nose);
    skull.oval([s * 0.168, 0.040, -0.247], [0.003, 0.004, 0.004], 0xf3dabb);
    skull.oval([s * 0.139, 0.069, -0.201], [0.04, 0.023, 0.058], 0xae8050, [0, s * -0.32, 0], 10);
    const ear = group(head, s > 0 ? 'Ear right' : 'Ear left', [s * 0.151, 0.104, -0.023]);
    new Parts().sweep([[0, 0, 0, 0.063, 0.033], [s * 0.038, -0.05, -0.009, 0.066, 0.030],
      [s * 0.047, -0.126, -0.022, 0.048, 0.024], [s * 0.031, -0.191, -0.035, 0.006, 0.005]],
      (x, y) => y > -0.042 ? 0x77553a : x * s > 0.04 ? 0x554032 : 0x41312a, 12).mesh(ear, 'Ear fur');
  }
  skull.mesh(head, 'Skull');
  const jaw = group(head, 'Jaw', [0, -0.073, -0.133]);
  new Parts().oval([0, -0.042, -0.143], [0.101, 0.05, 0.136], 0x49382e, [0.08, 0, 0], 14)
    .oval([0, -0.009, -0.176], [0.066, 0.016, 0.075], 0xb46656, undefined, 12).mesh(jaw, 'Lower jaw');

  const collar = new Parts().torus([0, 0.225, -0.518], 0.184, 0.027, 0x65362b, [Math.PI / 2 - 0.32, 0, 0], [1.05, 1, 0.82]);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    collar.oval([Math.cos(a) * 0.204, 0.225 + Math.sin(a) * 0.055, -0.518 + Math.sin(a) * 0.18],
      [0.014, 0.015, 0.014], 0xa38a57, undefined, 8);
  }
  collar.oval([0, 0.139, -0.698], [0.032, 0.041, 0.012], 0xb68c49).mesh(body, 'Leather collar');

  const tail = group(root, 'Tail', [0, 0.804, 0.53]);
  new Parts().sweep([[0, 0, 0, 0.077, 0.077], [0.008, 0.090, 0.107, 0.065, 0.064],
    [0.014, 0.233, 0.155, 0.056, 0.053], [0.016, 0.366, 0.09, 0.043, 0.042],
    [0.019, 0.375, -0.054, 0.032, 0.033], [0.014, 0.291, -0.114, 0.021, 0.022],
    [0.013, 0.242, -0.067, 0.005, 0.006]], fur, 14).mesh(tail, 'Curled tail');

  for (const [i, s, front] of [[0, 1, true], [1, -1, true], [2, 1, false], [3, -1, false]]) {
    const upper = group(root, `Leg ${i}`, [s * 0.166, 0.62, front ? -0.398 : 0.398]);
    new Parts().oval([s * 0.018, -0.075, front ? 0.005 : -0.028], [0.103, 0.214, front ? 0.113 : 0.144], fur,
      [front ? 0.04 : 0.30, 0, s * 0.035], 14).mesh(upper, 'Upper leg');
    const lower = group(upper, `Lower ${i}`, [s * 0.018, -0.268, front ? 0.014 : -0.049]);
    new Parts().sweep([[0, 0.045, 0.009, 0.061, 0.068], [0, -0.093, front ? 0.011 : 0.063, 0.047, 0.051],
      [0, -0.212, 0.032, 0.041, 0.041], [0, -0.290, 0, 0.035, 0.048]], fur, 12)
      .mesh(lower, 'Lower leg');
    const paw = group(lower, `Paw ${i}`, [0, -0.303, -0.019]);
    new Parts().oval([0, 0, 0], [0.059, 0.048, 0.081], 0xceaa75, [0.10, 0, 0], 12).mesh(paw, 'Paw mesh');
    group(paw, `Sole ${i}`, [0, -0.049, 0]);
  }
  return root;
}

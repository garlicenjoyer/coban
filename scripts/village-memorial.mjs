import * as T from 'three';
import { lathe, wash } from './village-buildings.mjs';

const stone = wash(0xc9c0ad, 0xa49a87, 2.5);
const cut = wash(0xbcb4a2, 0x948b79, 3.4);
const polished = wash(0xaaa391, 0x797464, 1.7);
const carve = wash(0xd0c9ba, 0xaaa292, 2.1);
const fold = wash(0xb9b3a5, 0x979184, 2.3);
const tau = Math.PI * 2;
const { lerp, smoothstep } = T.MathUtils;

// Cross-sections from the square chin to the swept crown, in portrait coordinates.
const skull = [
  [0, 0.077, 0.124, 0.021], [0.036, 0.137, 0.164, 0.060],
  [0.094, 0.181, 0.177, 0.113], [0.153, 0.205, 0.169, 0.153],
  [0.238, 0.212, 0.169, 0.192], [0.341, 0.224, 0.177, 0.221],
  [0.451, 0.224, 0.183, 0.232], [0.540, 0.224, 0.190, 0.239],
  [0.635, 0.218, 0.185, 0.232], [0.734, 0.196, 0.163, 0.213],
  [0.812, 0.146, 0.110, 0.167], [0.857, 0.089, 0.048, 0.107],
  [0.876, 0.011, -0.021, 0.030],
];
const portraitStone = wash(0xccc7b8, 0xb5afa0, 1.75);
const jacketStone = wash(0xb9b3a6, 0x989285, 2.1);
const bell = (delta, width) => Math.exp(-((delta / width) ** 2));

function faceRelief(x, y) {
  const side = Math.abs(x);
  const gap = (side - 0.104) / 0.052;
  const eyeY = 0.443 + gap * 0.008;
  const arch = Math.sqrt(Math.max(0, 1 - gap ** 2));
  const eyeWidth = 1 - smoothstep(Math.abs(gap), 0.76, 1.07);
  const upperLid = eyeY + arch * 0.014;
  const lowerLid = eyeY - arch * 0.009;
  const aperture = eyeWidth * smoothstep(y, lowerLid - 0.004, lowerLid + 0.004)
    * (1 - smoothstep(y, upperLid - 0.004, upperLid + 0.005));
  const lid = eyeWidth * (bell(y - upperLid, 0.006) + 0.58 * bell(y - lowerLid, 0.006));
  const socket = bell(side - 0.107, 0.063) * bell(y - (eyeY + 0.010), 0.038);
  const eyeFold = eyeWidth * bell(y - upperLid - 0.014, 0.007);
  const iris = bell(x - Math.sign(x) * 0.102 - 0.005, 0.013) * aperture;
  const browLine = 0.482 + 0.018 * smoothstep(side, 0.034, 0.111) - 0.012 * smoothstep(side, 0.134, 0.193);
  const brow = bell(side - 0.106, 0.067) * bell(y - browLine, 0.021);
  const eyebrow = (1 - smoothstep(Math.abs(side - 0.105), 0.054, 0.082)) * bell(y - browLine, 0.009);
  const frown = bell(side - (0.014 + (y - 0.49) * 0.22), 0.006) * bell(y - 0.526, 0.036);

  const bridge = bell(x, 0.030 + 0.012 * smoothstep(y, 0.33, 0.52)) * bell(y - 0.360, 0.118);
  const tip = bell(x, 0.031) * bell(y - 0.291, 0.033);
  const wing = bell(side - 0.039, 0.024) * bell(y - 0.273, 0.023);
  const nostril = bell(side - 0.031, 0.011) * bell(y - 0.259, 0.009);
  const cheekbone = bell(side - 0.159, 0.052) * bell(y - 0.356, 0.061);
  const cheekHollow = bell(side - (0.138 + 0.37 * (0.22 - y)), 0.065) * bell(y - 0.218, 0.085);
  const jaw = bell(side - 0.144, 0.059) * bell(y - 0.110, 0.054);
  const smileLine = bell(side - (0.05 + (0.267 - y) * 0.56), 0.009) * bell(y - 0.216, 0.049);
  const lipY = 0.150 - 0.088 * side + 0.003 * bell(x, 0.020);
  const lipWidth = 1 - smoothstep(side, 0.068, 0.096);
  const mouth = lipWidth * bell(y - lipY, 0.006);
  const upperLip = lipWidth * bell(y - lipY - 0.014, 0.015);
  const lowerLip = lipWidth * bell(y - lipY + 0.016, 0.013);
  const chin = bell(x, 0.101) * bell(y - 0.062, 0.046);
  return {
    depth: 0.040 * brow + 0.012 * eyebrow - 0.008 * frown - 0.044 * socket + 0.024 * aperture + 0.017 * lid
      - 0.008 * eyeFold + 0.094 * bridge + 0.067 * tip + 0.027 * wing - 0.016 * nostril
      + 0.035 * cheekbone - 0.021 * cheekHollow + 0.025 * jaw - 0.009 * smileLine
      + 0.022 * upperLip + 0.018 * lowerLip - 0.010 * mouth + 0.033 * chin,
    tone: -0.29 * eyebrow - 0.12 * socket + 0.10 * aperture - 0.24 * iris - 0.14 * eyeFold - 0.11 * frown
      - 0.24 * nostril - 0.070 * smileLine - 0.26 * mouth - 0.027 * cheekHollow,
  };
}

function hairRelief(x, y, z, front) {
  const temple = bell(Math.abs(x) - 0.146, 0.056);
  const center = bell(x + 0.032, 0.088);
  const line = lerp(0.351, 0.692 + 0.064 * temple - 0.053 * center, smoothstep(front, -0.065, 0.80));
  const coverage = smoothstep(y, line - 0.003, line + 0.025);
  const sweep = x + 0.52 * z - 0.44 * y + 0.56 * y * y;
  const strands = 0.72 * Math.cos(sweep * 123) + 0.28 * Math.cos(sweep * 205 + x * 26);
  const part = bell(sweep - 0.011, 0.011) * smoothstep(y, 0.65, 0.76) * smoothstep(front, -0.3, 0.84);
  return {
    depth: coverage * (0.010 + 0.0026 * strands - 0.006 * part),
    tone: coverage * (-0.40 + 0.052 * strands + 0.07 * part),
  };
}

function head(p, baseY) {
  const rings = 77, sides = 112;
  const headHeight = 0.84;
  const positions = [], indices = [], tones = [];
  const first = p.geometries.length;
  for (let ring = 0; ring <= rings; ring++) {
    const y = skull.at(-1)[0] * ring / rings;
    const end = skull.findIndex(([h]) => h >= y - 1e-8);
    const a = skull[Math.max(0, end - 1)], b = skull[end];
    const t = end ? (y - a[0]) / (b[0] - a[0]) : 0;
    const width = lerp(a[1], b[1], t);
    for (let side = 0; side < sides; side++) {
      const theta = tau * side / sides;
      const sine = Math.sin(theta), cosine = Math.cos(theta);
      const squareJaw = 1 - 0.16 * bell(y - 0.128, 0.105);
      const x = Math.sign(sine) * Math.abs(sine) ** squareJaw * width;
      const z = cosine * (cosine >= 0 ? lerp(a[2], b[2], t) : lerp(a[3], b[3], t));
      const face = faceRelief(x, y);
      const hair = hairRelief(x, y, z, cosine);
      const front = smoothstep(cosine, 0.15, 0.72);
      positions.push(x + sine * hair.depth, y * headHeight, z + cosine * hair.depth + front * face.depth);
      tones.push(1 + front * face.tone + hair.tone);
      if (ring === rings) continue;
      const v = ring * sides + side, next = ring * sides + (side + 1) % sides;
      indices.push(v, next, v + sides, next, next + sides, v + sides);
    }
  }
  const crown = positions.length / 3;
  positions.push(0, skull.at(-1)[0] * headHeight, -0.025);
  tones.push(0.71);
  for (let i = 0; i < sides; i++) indices.push(crown, rings * sides + i, rings * sides + (i + 1) % sides);

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  p.add(geometry, portraitStone, [0, baseY, 0], undefined, undefined, 0.014);
  const colors = p.geometries.at(-1).attributes.color.array;
  // Parts expands indexed faces in index order before describing their stone finish.
  for (let i = 0; i < indices.length; i++) {
    const tone = tones[indices[i]], offset = i * 3;
    colors[offset] *= tone;
    colors[offset + 1] *= tone;
    colors[offset + 2] *= tone;
  }
  for (const side of [-1, 1]) {
    p.oval([side * 0.222, baseY + 0.301, -0.015], [0.039, 0.084, 0.052], portraitStone, [0.13, 0.07 * side, 0], 20);
    p.oval([side * 0.246, baseY + 0.306, 0.010], [0.020, 0.053, 0.032], fold, [0.15, 0.09 * side, 0], 16);
  }
  for (const geometry of p.geometries.slice(first)) {
    geometry.translate(0, -baseY, 0).rotateY(0.39).rotateX(-0.046).translate(0, baseY, 0);
  }
}

const jacket = [[0, 1.59, 0.004, 0.30, 0.186], [0, 1.66, 0.008, 0.41, 0.214], [0, 1.82, -0.012, 0.505, 0.239],
  [0, 1.96, -0.039, 0.459, 0.239], [0, 2.06, -0.044, 0.247, 0.200], [0, 2.14, -0.063, 0.124, 0.149],
  [0, 2.24, -0.046, 0.138, 0.151]];

function relief(p, points, material) {
  const shape = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)));
  const geometry = new T.ExtrudeGeometry(shape, { depth: 0.012, bevelSize: 0.008, bevelThickness: 0.005, bevelSegments: 1 });
  const vertices = geometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const y = vertices.getY(i), x = vertices.getX(i);
    const index = jacket.findIndex((row) => row[1] >= y);
    const a = jacket[index - 1], b = jacket[index];
    const blend = (y - a[1]) / (b[1] - a[1]);
    const width = lerp(a[3], b[3], blend);
    const front = lerp(a[2], b[2], blend) + lerp(a[4], b[4], blend) * Math.sqrt(Math.max(0, 1 - (x / width) ** 2));
    vertices.setZ(i, vertices.getZ(i) + front + 0.014);
  }
  geometry.computeVertexNormals();
  p.add(geometry, material);
}

export function ataturkPlinth(p) {
  lathe(p, [0, 0, 0], [[0, -0.06], [1.28, -0.06], [1.28, 0.09], [1.24, 0.135],
    [0.99, 0.135], [0.99, 0.25], [0.94, 0.29], [0, 0.29]], stone, 8);
  p.box([0, 0.81, 0], [1.22, 1.09, 0.91], polished)
    .box([0, 0.31, 0], [1.33, 0.13, 1.01], cut)
    .box([0, 1.35, 0], [1.30, 0.09, 0.99], cut)
    .box([0, 1.44, 0], [1.42, 0.12, 1.10], stone)
    .box([0, 1.51, 0], [1.30, 0.048, 0.99], cut)
    .box([0, 0.86, 0.457], [1.08, 0.53, 0.047], cut);
}

export function ataturkBust(p) {
  // Formal white tie, with the wing collar and pocket square from the 1930s portrait.
  lathe(p, [0, 0, 0], [[0, 1.53], [0.32, 1.53], [0.34, 1.56], [0.31, 1.64], [0, 1.64]], cut, 20);
  p.sweep(jacket, jacketStone, 40, 4, [1, 0, 0]);
  relief(p, [[-0.108, 2.136], [0.110, 2.136], [0.092, 1.92], [0.014, 1.715], [-0.090, 1.92]], carve);
  relief(p, [[-0.078, 2.059], [-0.001, 2.035], [0.080, 2.056], [0.069, 1.997], [0.009, 2.014],
    [-0.069, 1.988]], stone);
  relief(p, [[0.239, 1.800], [0.271, 1.821], [0.304, 1.813], [0.331, 1.816], [0.327, 1.788], [0.246, 1.782]], carve);
  for (const side of [-1, 1]) {
    relief(p, [[0.122, 2.111], [0.234, 2.009], [0.184, 1.962], [0.235, 1.918], [0.034, 1.678], [0.094, 1.913]]
      .map(([x, y]) => [side * x, y]), fold);
    relief(p, [[0.103, 2.133], [0.126, 2.091], [0.079, 2.026], [0.031, 2.070]].map(([x, y]) => [side * x, y]), carve);
  }
  head(p, 2.213);
}

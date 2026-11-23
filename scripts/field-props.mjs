import * as T from 'three';
import { group, Parts } from './model-parts.mjs';
import { herbs } from './herb-models.mjs';

const TAU = Math.PI * 2;
const flat = [Math.PI / 2, 0, 0];
const iron = 0x403e39;
const brass = 0xc39255;
const copper = painted(0x8a4934, 0xd69a65, 20);

function painted(shadow, light, frequency) {
  const dark = new T.Color(shadow);
  const bright = new T.Color(light);
  return (x, y, z) => dark.clone().lerp(bright,
    0.45 + 0.28 * Math.sin((x + z * 0.71) * frequency + Math.sin(y * frequency * 0.7))
    + 0.16 * Math.cos((y - z * 0.68) * frequency * 2.4));
}

function lathe(p, at, profile, color, sides = 20) {
  return p.add(new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), sides), color, at);
}

function ring(p, at, r, width, color, stretch = 1) {
  return p.torus(at, r, width, color, flat, [stretch, 1, 1], TAU, 24);
}

function roundedPanel(outline, depth, bevel) {
  const shape = new T.Shape(outline.map(([x, y]) => new T.Vector2(x, y)));
  return new T.ExtrudeGeometry(shape, { depth, steps: 1, bevelSegments: 1, bevelSize: bevel, bevelThickness: bevel });
}

function lantern(root) {
  const p = new Parts();
  // Origin is the center of the handgrip. Dark copper encloses a separate glass chamber.
  p.torus([0, -0.068, 0], 0.068, 0.0065, iron, undefined, [1.23, 1, 1], Math.PI, 20);
  p.rod([-0.030, -0.001, 0], [0.030, -0.001, 0], 0.009, 0.009, 0x5d4638);
  lathe(p, [0, 0, 0], [[0, -0.079], [0.041, -0.079], [0.046, -0.092], [0.069, -0.107],
    [0.090, -0.113], [0.092, -0.121], [0.082, -0.128], [0, -0.128]].reverse(), copper);
  lathe(p, [0, 0, 0], [[0, -0.315], [0.073, -0.315], [0.094, -0.306], [0.101, -0.289],
    [0.099, -0.269], [0.088, -0.255], [0.065, -0.25], [0, -0.25]], copper);
  for (const [y, r] of [[-0.123, 0.085], [-0.257, 0.084], [-0.289, 0.1], [-0.305, 0.09]]) {
    ring(p, [0, y, 0], r, 0.0035, y === -0.289 ? iron : brass);
  }
  for (const s of [-1, 1]) {
    p.sweep([[s * 0.064, -0.278, 0, 0.010, 0.009], [s * 0.104, -0.224, 0, 0.011, 0.009],
      [s * 0.102, -0.13, 0, 0.010, 0.009], [s * 0.083, -0.068, 0, 0.008, 0.007],
      [s * 0.042, -0.089, 0, 0.006, 0.006]], copper, 9);
    p.rod([s * 0.065, -0.068, 0], [s * 0.087, -0.068, 0], 0.011, 0.011, brass);
  }
  for (const angle of [-2.4, -0.7, 0.7, 2.4]) {
    const guard = (r, y) => [r * Math.cos(angle), y, r * Math.sin(angle)];
    p.rod(guard(0.081, -0.258), guard(0.072, -0.123), 0.0045, 0.0045, iron, 6);
  }
  p.rod([0, -0.29, 0.096], [0, -0.29, 0.113], 0.012, 0.011, iron);
  p.mesh(root, 'Copper body and guards');
  const panes = new Parts();
  lathe(panes, [0, 0, 0], [[0, -0.259], [0.065, -0.259], [0.073, -0.227], [0.072, -0.181],
    [0.060, -0.126], [0, -0.126]], painted(0xba6237, 0xffd694, 57), 16);
  // Long broad reflections are painted onto the curved glass.
  for (const [angle, color, w] of [[0.8, 0xffdc9b, 0.006], [1.22, 0xfff1bb, 0.0035], [-2.08, 0xf8c080, 0.005]]) {
    const pt = (r, y, width) => [r * Math.cos(angle), y, r * Math.sin(angle), width, width * 0.8];
    panes.sweep([pt(0.069, -0.239, 0.001), pt(0.0735, -0.217, w), pt(0.073, -0.186, w * 0.75),
      pt(0.066, -0.148, 0.001)], color, 6, 2);
  }
  panes.mesh(root, 'Amber glass');
}

function salt(p) {
  const crystals = painted(0xb9a69c, 0xffeee2, 35);
  const shape = [[-0.172, 0.025], [-0.140, 0.161], [-0.074, 0.207], [0.031, 0.198], [0.113, 0.215],
    [0.165, 0.146], [0.157, 0.056], [0.124, 0.016], [-0.084, 0.014]];
  p.add(roundedPanel(shape, 0.198, 0.014), crystals, [0, 0, -0.1], undefined, [0, -0.13, 0]);
  const chips = [[-0.15, 0.039, 0.108, 0.027], [0.10, 0.20, 0.058, 0.023], [-0.09, 0.20, -0.052, 0.024],
    [0.14, 0.14, -0.105, 0.028], [0.18, 0.027, 0.091, 0.025], [0.095, 0.015, 0.148, 0.017]];
  for (const [x, y, z, r] of chips) {
    p.add(new T.DodecahedronGeometry(r, 0), crystals, [x, y, z], [1, 0.68, 0.82], [0.4, z * 9, x * 7]);
  }
  for (const [x, y, z, len] of [[-0.072, 0.204, -0.003, 0.07], [0.032, 0.208, 0.049, 0.052], [-0.086, 0.156, 0.121, 0.082]]) {
    p.rod([x, y, z], [x + len, y - 0.010, z - 0.008], 0.003, 0.001, 0xe5c6bb, 5);
  }
}

function pebble(p) {
  const geometry = new T.IcosahedronGeometry(1, 1);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const rough = 1 + 0.065 * Math.sin(x * 9.4 + y * 13.1 + z * 7.7);
    position.setXYZ(i, x * rough, T.MathUtils.clamp(y * rough, -0.83, 0.91), z * rough);
  }
  geometry.computeVertexNormals();
  const stonePaint = painted(0x615e5d, 0x93837a, 50);
  const flint = (x, y, z) => {
    const vein = Math.abs(y + 0.42 * x - 0.35 * z + 0.004 * Math.sin(x * 80));
    return vein < 0.007 ? 0xbca595 : stonePaint(x, y, z);
  };
  p.add(geometry, flint, [0, 0, 0], [0.082, 0.056, 0.061], [0.14, 0.55, 0.35]);
}

function halter(root) {
  const rope = new Parts();
  const fibre = [0xa37d4f, 0xc39b60, 0xe0ba80];
  for (let strand = 0; strand < 3; strand++) {
    const steps = 144;
    const sides = 6;
    const positions = [];
    const indices = [];
    for (let i = 0; i <= steps; i++) {
      const y = i / steps;
      const twist = TAU * (y * 16 + strand / 3);
      for (let j = 0; j < sides; j++) {
        const a = twist + TAU * j / sides;
        positions.push(0.0044 * Math.cos(twist) + 0.0049 * Math.cos(a), y,
          0.0044 * Math.sin(twist) + 0.0049 * Math.sin(a));
        if (i === steps) continue;
        const v = i * sides + j, next = i * sides + (j + 1) % sides;
        indices.push(v, v + sides, next, next, v + sides, next + sides);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    rope.add(geo, fibre[strand]);
  }
  // A leather whipping at the grip and a thicker tied end at the ewe.
  for (const [y, length, color] of [[0.021, 0.029, 0x746047], [0.983, 0.031, 0x9d7948]]) {
    for (let i = 0; i < 5; i++) {
      ring(rope, [0, y + (i / 4 - 0.5) * length, 0], 0.0094, 0.0024, color);
    }
  }
  rope.mesh(root, 'Braided line');
}

function coin(p) {
  const bronze = (x, y, z) => {
    const patina = Math.sin(x * 89 + z * 40) * Math.cos(z * 95 - y * 39);
    return new T.Color(patina > 0.41 ? 0x648476 : patina < -0.22 ? 0x8c643f : 0xb18a52);
  };
  const disk = new Parts();
  lathe(disk, [0, 0, 0], [[0, -0.008], [0.092, -0.008], [0.104, -0.003], [0.103, 0.009],
    [0.095, 0.016], [0, 0.016]], bronze, 22);
  ring(disk, [0, 0.016, 0], 0.089, 0.004, 0xb28b55);
  for (let i = 0; i < 18; i++) {
    const a = i * TAU / 18;
    disk.oval([Math.cos(a) * 0.077, 0.017, Math.sin(a) * 0.077], [0.0035, 0.0022, 0.0035], 0xc39d63, undefined, 6);
  }
  // Worn portrait in relief, with the brow, nose and throat still legible.
  disk.oval([-0.010, 0.019, -0.011], [0.030, 0.005, 0.037], 0xbe975d, [0, 0.32, 0], 10)
    .oval([0.015, 0.020, 0.002], [0.023, 0.005, 0.012], 0xcca76b, [0, -0.4, 0], 8)
    .oval([-0.004, 0.019, 0.036], [0.038, 0.005, 0.020], 0xa17d4b, [0, 0.13, 0], 10);
  for (const geo of disk.geometries) p.geometries.push(geo.rotateX(0.18).translate(0, 0.022, 0));
}

function clayLamp(p) {
  const clay = painted(0x985142, 0xcd896c, 31);
  lathe(p, [-0.028, 0, 0], [[0, 0.012], [0.080, 0.012], [0.103, 0.032], [0.114, 0.058],
    [0.111, 0.087], [0.092, 0.109], [0.059, 0.122], [0.034, 0.116], [0.03, 0.102],
    [0.036, 0.075], [0, 0.067]], clay);
  ring(p, [-0.028, 0.115, 0], 0.065, 0.005, 0xd69d7c);
  ring(p, [-0.028, 0.119, 0], 0.035, 0.004, 0x995441);
  p.sweep([[0.039, 0.064, 0, 0.049, 0.046], [0.106, 0.057, 0, 0.044, 0.027],
    [0.154, 0.062, 0, 0.034, 0.023], [0.173, 0.065, 0, 0.019, 0.016],
    [0.184, 0.068, 0, 0.002, 0.003]], clay, 12, 3, [0, 0, 1]);
  p.oval([0.154, 0.083, 0], [0.025, 0.004, 0.020], 0x4b3631, undefined, 12);
  p.torus([-0.145, 0.061, 0], 0.037, 0.012, clay, undefined, [1.1, 0.78, 1], TAU, 18);
  for (let i = 0; i < 14; i++) {
    const a = i * TAU / 14;
    p.oval([-0.028 + 0.080 * Math.cos(a), 0.115, 0.080 * Math.sin(a)],
      [0.009, 0.0025, 0.003], 0xbe7c5e, [0, -a, 0], 6);
  }
}

function inscribedFragment(p) {
  const edge = [[-0.167, 0.031], [-0.142, -0.105], [-0.061, -0.132], [-0.008, -0.126], [0.065, -0.143],
    [0.145, -0.089], [0.154, -0.024], [0.113, 0.044], [0.133, 0.097], [0.019, 0.127], [-0.102, 0.091]];
  p.add(roundedPanel(edge, 0.039, 0.013), painted(0x8e8372, 0xcfbf9e, 39), [0, 0.011, 0], undefined, [-Math.PI / 2, 0, 0]);
  const lettering = [
    [[[-1, 0], [0, 2], [1, 0]], [[-0.5, 0.8], [0.5, 0.8]]],
    [[[-1, 2], [1, 2], [0, 1], [1, 0], [-1, 0]]],
    [[[-1, 0], [-1, 2], [1, 2], [1, 0]]],
    [[[0, 0], [0, 2]], [[-1, 2], [1, 2]]],
    [[[-1, 0], [-1, 2], [1, 2]], [[-1, 1], [0.55, 1]]],
  ];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 4; i++) {
      const x = -0.105 + i * 0.063 + row * 0.013;
      const z = -0.021 + row * 0.063;
      for (const line of lettering[(i + row * 3) % lettering.length]) {
        for (let j = 1; j < line.length; j++) {
          const at = ([dx, dz], height) => [x + dx * 0.018, height, z - dz * 0.019];
          p.rod(at(line[j - 1], 0.0640), at(line[j], 0.0640), 0.0037, 0.0028, 0x655949, 5);
          p.rod(at(line[j - 1], 0.0645).map((v, k) => k === 0 ? v + 0.003 : v),
            at(line[j], 0.0645).map((v, k) => k === 0 ? v + 0.003 : v), 0.0018, 0.0014, 0xb8a98b, 5);
        }
      }
    }
  }
}

function salve(p) {
  const amber = painted(0x635640, 0x9b6a3c, 63);
  lathe(p, [0, 0, 0], [[0, 0.01], [0.034, 0.01], [0.046, 0.017], [0.049, 0.036],
    [0.045, 0.064], [0.032, 0.071], [0.031, 0.082], [0, 0.084]], amber);
  lathe(p, [0, 0, 0], [[0.026, 0.077], [0.035, 0.077], [0.037, 0.083], [0.036, 0.099],
    [0.030, 0.103], [0, 0.104]], painted(0x586556, 0x89937d, 63));
  ring(p, [0, 0.095, 0], 0.0365, 0.0015, 0x9ca485);
  for (let i = 0; i < 18; i++) {
    const a = i * TAU / 18, x = 0.036 * Math.cos(a), z = 0.036 * Math.sin(a);
    p.rod([x, 0.081, z], [x, 0.094, z], 0.0018, 0.0013, 0x475649, 5);
  }
  lathe(p, [0, 0, 0], [[0.048, 0.023], [0.0495, 0.037], [0.047, 0.060]],
    painted(0xc7ae78, 0xead7a6, 115));
  p.oval([0, 0.043, 0.0485], [0.024, 0.016, 0.0035], 0xebe1b6, undefined, 10);
  p.rod([-0.012, 0.034, 0.052], [0.011, 0.054, 0.052], 0.0017, 0.0012, 0x526348, 5);
  for (const s of [-1, 1]) {
    p.oval([s * 0.005, 0.045, 0.0525], [0.007, 0.0031, 0.001], 0x67785b, [0, 0, s * 0.62], 7);
  }
  p.oval([0, 0.1045, 0], [0.023, 0.0017, 0.023], 0xc2a780, undefined, 12);
}

function bread(p) {
  const crust = painted(0xa96339, 0xe5b46b, 48);
  p.add(roundedPanel([[-0.129, -0.049], [-0.105, -0.091], [0.070, -0.099], [0.121, -0.045],
    [0.116, 0.067], [0.054, 0.095], [-0.087, 0.089], [-0.129, 0.049]], 0.004, 0.005),
    painted(0x9c685c, 0xc38772, 64), [0, 0.011, 0], undefined, [-Math.PI / 2, 0.04, 0]);
  for (const z of [-0.05, -0.036, 0.05, 0.063]) {
    p.rod([-0.104, 0.020, z], [0.116, 0.020, z + 0.006], 0.0022, 0.0022, 0xe2b59b, 5);
  }
  p.oval([-0.049, 0.048, -0.025], [0.082, 0.034, 0.054], crust, [0.03, 0.23, -0.12], 18);
  p.oval([-0.079, 0.027, 0.024], [0.063, 0.016, 0.034], 0xe0b97d, [0, -0.46, 0], 12);
  for (let i = 0; i < 3; i++) {
    const x = -0.092 + i * 0.031;
    p.sweep([[x - 0.013, 0.071, -0.060, 0.001, 0.001], [x, 0.083, -0.035, 0.004, 0.002],
      [x + 0.007, 0.079, -0.015, 0.004, 0.0018], [x + 0.022, 0.070, -0.006, 0.001, 0.001]],
      0xf3c784, 6, 2);
  }
  const bowl = [0.066, 0.016, 0.02];
  lathe(p, bowl, [[0, 0], [0.028, 0], [0.040, 0.008], [0.055, 0.025],
    [0.058, 0.041], [0.052, 0.041], [0.044, 0.024], [0.02, 0.010], [0, 0.010]],
    painted(0x698686, 0xb8c4ad, 53));
  lathe(p, bowl, [[0, 0.028], [0.038, 0.028], [0.049, 0.034], [0.043, 0.036], [0, 0.038]], 0xffeed8, 22);
  ring(p, [bowl[0], 0.055, bowl[2]], 0.056, 0.0022, 0xd6c9a1);
  p.torus([0.069, 0.054, 0.020], 0.020, 0.0016, 0xcfbea8, flat, [0.69, 1, 1], Math.PI * 1.3, 16);
}

export function teaTray(p, at, radius, stretch = 1) {
  const [x, y, z] = at;
  const profile = [[0, 0], [0.89, 0], [0.98, 0.007], [1, 0.017], [0.99, 0.020],
    [0.965, 0.020], [0.91, 0.010], [0, 0.009]];
  p.add(new T.LatheGeometry(profile.map(([r, h]) => new T.Vector2(r * radius, h)), 40),
    copper, at, [stretch, 1, 1]);
  ring(p, [x, y + 0.019, z], radius * 0.986, 0.0018, brass, stretch);
  ring(p, [x, y + 0.011, z], radius * 0.86, 0.0013, 0xbe7c50, stretch);
  for (let i = 0; i < 24; i++) {
    const a = i * TAU / 24, r = radius * 0.91;
    p.oval([x + stretch * r * Math.cos(a), y + 0.012, z + r * Math.sin(a)],
      [0.007, 0.0018, 0.0026], i % 2 ? 0xc98a59 : 0x9b5c43, [0, -a + 0.7, 0], 6);
  }
}

export function fieldProps() {
  const root = group(null, 'Field prop library');
  const objects = [['Hand lantern', lantern, true], ['Salt lick', salt], ['Sling stone', pebble],
    ['Halter rope', halter, true], ['Bronze coin', coin], ['Clay oil lamp', clayLamp],
    ['Inscribed fragment', inscribedFragment], ['Wound salve', salve], ['Bread and yoghurt', bread]];
  for (const [i, [name, build, nested]] of objects.entries()) {
    const entry = group(root, name, [i % 5 * 1.3, name === 'Hand lantern' ? 0.32 : 0, Math.floor(i / 5) * 1.3]);
    if (nested) build(entry);
    else {
      const parts = new Parts();
      build(parts);
      parts.mesh(entry, name + ' mesh');
    }
  }
  herbs(root);
  return root;
}

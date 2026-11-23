import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { group, Parts } from './model-parts.mjs';

const TAU = Math.PI * 2;
const { lerp, smoothstep, clamp } = T.MathUtils;
const clothGrain = (x, y, z) => Math.sin(x * 73 + y * 43 + z * 31) * Math.cos(y * 94 - z * 65);

const villagers = {
  ayse: {
    size: 0.96, build: 1.08, face: [0.103, 0.99, 0.76, 0.94, 0.94, 0.004],
    skin: '#ca9475', warmth: '#ad695f', line: '#8d6555', lip: '#a3675f', iris: '#535036', hair: '#4f3731',
    shirt: '#666083', light: '#807795', dark: '#48425e', seam: '#b198a4',
    pants: '#655363', boots: '#645044', accent: '#bc8a57',
    wrap: '#943f4c', wrapLight: '#bf6670', trim: '#e4b78a', cloth: 'apron', grain: 2.71,
  },
  hasan: {
    size: 1.015, build: 0.93, face: [0.092, 1.07, 0.95, 1.08, 0.73, -0.002],
    skin: '#bc8a70', warmth: '#9d6958', line: '#785748', lip: '#8e5b52', iris: '#5c644d', hair: '#b8aaa0',
    shirt: '#b4ae92', light: '#d3c6a4', dark: '#897c66', seam: '#dbcaaa',
    pants: '#554e49', boots: '#59483a', accent: '#95684a',
    wrap: '#bdb398', wrapLight: '#d7c5a5', trim: '#907b62', cloth: 'vest', grain: 4.57,
  },
  emre: {
    size: 1.025, build: 1.15, face: [0.102, 1.03, 1.02, 1.10, 0.89, 0.001],
    skin: '#c68f71', warmth: '#a57258', line: '#865c4c', lip: '#956254', iris: '#493b2d', hair: '#49352e',
    shirt: '#746e4f', light: '#928463', dark: '#514b38', seam: '#b4a17b',
    pants: '#58605c', boots: '#665043', accent: '#a15141',
    wrap: '#49352e', wrapLight: '#695043', trim: '#bc9871', cloth: 'jacket', grain: 6.17,
  },
  zeynep: {
    size: 0.96, build: 0.95, face: [0.089, 0.98, 0.71, 0.88, 1.12, 0.007],
    skin: '#d2a184', warmth: '#b77b6c', line: '#956551', lip: '#a46c63', iris: '#504235', hair: '#493431',
    shirt: '#ad7344', light: '#cb9963', dark: '#82563d', seam: '#dcc397',
    pants: '#515766', boots: '#655348', accent: '#bb8660',
    wrap: '#336160', wrapLight: '#4f8077', trim: '#c9b080', cloth: 'vest', grain: 1.94,
  },
};

const colors = new Map();
function pigment(hex) {
  if (!colors.has(hex)) colors.set(hex, new T.Color(hex));
  return colors.get(hex);
}
const color = (hex) => pigment(hex).clone();

function paint(base, light, dark, seed) {
  return (x, y, z) => {
    const wash = 0.44 * Math.sin(x * 11 + y * 17 - z * 8 + seed)
      + 0.29 * Math.sin(y * 39 + Math.cos(z * 34 + x * 12)) + 0.15 * clothGrain(x, y, z);
    return color(base).lerp(pigment(wash > 0 ? light : dark), Math.abs(wash) * 0.34);
  };
}

function sample(rows, height) {
  let i = 0;
  while (i < rows.length - 2 && height > rows[i + 1][0]) i++;
  const a = rows[i], b = rows[i + 1];
  const t = clamp((height - a[0]) / (b[0] - a[0]), 0, 1);
  const dims = Array.from({ length: Math.max(a.length, b.length) - 1 }, (_, k) => lerp(a[k + 1] ?? 0, b[k + 1] ?? 0, t));
  return [height, ...dims];
}

function rowsBetween(rows, pieces) {
  const y0 = rows[0][0], y1 = rows.at(-1)[0];
  return Array.from({ length: pieces + 1 }, (_, i) => sample(rows, lerp(y0, y1, i / pieces)));
}

function surface(parts, rows, segments, point, tint, wrap = false) {
  const positions = [], triangles = [];
  const count = wrap ? segments : segments + 1;
  for (const [i, row] of rows.entries()) {
    for (let j = 0; j < count; j++) {
      positions.push(...point(row, j / segments));
      if (i === rows.length - 1 || (!wrap && j === segments)) continue;
      const a = i * count + j, b = i * count + (j + 1) % count;
      const c = a + count, d = b + count;
      triangles.push(a, b, c, b, d, c);
    }
  }
  const mesh = new T.BufferGeometry();
  mesh.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  mesh.setIndex(triangles);
  mesh.computeVertexNormals();
  parts.add(mesh, tint, undefined, undefined, undefined, 0.013);
}

/** Cross sections are height, half-width, front depth, back depth, and center offsets. */
function contour([y, width, front, back, x = 0, z = 0], angle, folds = 0) {
  const c = Math.cos(angle);
  return [x + Math.sin(angle) * width * (1 + folds), y, z + c * (c > 0 ? front : back) * (1 + folds)];
}

function volume(parts, rows, tint, folds = () => 0, segments = 32) {
  surface(parts, rows, segments, (row, u) => contour(row, u * TAU, folds(row[0], u * TAU)), tint, true);
}

function stroke(parts, points, radii, tint, sides = 7) {
  const sizes = Array.isArray(radii) ? radii : points.map(() => radii);
  parts.sweep(points.map((point, i) => [...point, sizes[i], sizes[i] * 0.78]), tint, sides, 2);
}

function makeRig(root, p, id) {
  const joints = [];
  const add = (parent, name, x, y, z) => {
    const bone = new T.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    parent.add(bone);
    joints.push(bone);
    return joints.length - 1;
  };
  const hips = add(root, 'Hips', 0, 0.865, 0);
  const chest = add(joints[hips], 'Chest', 0, 0.27, 0);
  const head = add(joints[chest], 'Head', 0, 0.347, 0.017);
  const face = headShape(p, id);
  const faceJoint = (name, x, y, lift) => {
    const position = face.front(x, face.h(y), lift);
    return add(joints[head], name, position[0], position[1] - 1.482, position[2] - 0.017);
  };
  const eyes = [-1, 1].map((side, i) => faceJoint(i === 0 ? 'Left Eye' : 'Right Eye',
    side * face.width * 0.439, 1.630 + side * face.tilt * 0.26, 0.003));
  const mouth = faceJoint('Mouth', 0, id === 'hasan' ? 1.541 : 1.550, 0.003);
  const arms = [], legs = [];
  for (const [name, s] of [['Left', -1], ['Right', 1]]) {
    const arm = add(joints[chest], `${name} Arm`, s * 0.195 * p.build, 0.181, 0);
    const elbow = add(joints[arm], `${name} Elbow`, s * 0.023, -0.24, 0.016);
    const hand = add(joints[elbow], `${name} Hand`, s * 0.012, -0.228, 0.014);
    arms.push({ arm, elbow, hand, s });
    const leg = add(joints[hips], `${name} Leg`, s * 0.098 * p.build, -0.034, 0);
    const knee = add(joints[leg], `${name} Knee`, s * 0.009, -0.385, 0.019);
    const foot = add(joints[knee], `${name} Foot`, s * 0.005, -0.376, -0.026);
    legs.push({ leg, knee, foot, s });
  }
  root.updateMatrixWorld(true);
  const position = joints.map((bone) => bone.getWorldPosition(new T.Vector3()));
  return { joints, position, hips, chest, head, eyes, mouth, arms, legs };
}

function skinnedPaint(root, rig) {
  const layers = [];
  return {
    parts(weights) {
      const parts = new Parts();
      layers.push({ parts, weights: typeof weights === 'number' ? () => [[weights, 1]] : weights });
      return parts;
    },
    finish() {
      const buffer = [];
      for (const { parts, weights } of layers) {
        for (const geometry of parts.geometries) {
          const positions = geometry.attributes.position;
          const indices = new Uint8Array(positions.count * 4);
          const values = new Uint8Array(positions.count * 4);
          for (let i = 0; i < positions.count; i++) {
            const influences = weights(positions.getX(i), positions.getY(i), positions.getZ(i));
            const first = Math.round(influences[0][1] * 255);
            for (const [j, [bone]] of influences.entries()) {
              indices[i * 4 + j] = bone;
              values[i * 4 + j] = j === 0 ? first : 255 - first;
            }
          }
          geometry.setAttribute('skinIndex', new T.Uint8BufferAttribute(indices, 4));
          geometry.setAttribute('skinWeight', new T.Uint8BufferAttribute(values, 4, true));
          buffer.push(geometry);
        }
      }
      const geometry = mergeVertices(mergeGeometries(buffer));
      const rgb = geometry.attributes.color;
      const packed = new Uint8Array(rgb.count * 4);
      for (let i = 0; i < rgb.count; i++) {
        packed[i * 4] = Math.round(clamp(rgb.getX(i), 0, 1) * 255);
        packed[i * 4 + 1] = Math.round(clamp(rgb.getY(i), 0, 1) * 255);
        packed[i * 4 + 2] = Math.round(clamp(rgb.getZ(i), 0, 1) * 255);
        packed[i * 4 + 3] = 255;
      }
      geometry.setAttribute('color', new T.Uint8BufferAttribute(packed, 4, true));
      const mesh = new T.SkinnedMesh(geometry, new T.MeshStandardMaterial({
        vertexColors: true, side: T.DoubleSide, roughness: 0.91,
      }));
      mesh.name = 'Painted character';
      root.add(mesh);
      mesh.bind(new T.Skeleton(rig.joints));
    },
  };
}

const blend = (lower, upper, mix) => [[lower, 1 - mix], [upper, mix]];

function clothing(skin, rig, p, id) {
  const ink = paint(p.shirt, p.light, p.dark, p.grain);
  const linen = paint('#b6aa8e', '#d5c8a8', '#887f6c', p.grain);
  const vest = id === 'hasan' ? paint('#536e6e', '#81918a', '#374e51', p.grain)
    : paint('#495c65', '#798388', '#34414f', p.grain);
  const shell = p.cloth === 'vest' ? vest : ink;
  const seam = p.cloth === 'vest' ? '#38474d' : p.dark;
  const bottom = paint(p.pants, '#7a776f', '#3e3841', p.grain + 2);
  const folds = (y, a) => 0.022 * Math.sin(7 * a + 17 * y + p.grain)
    + 0.014 * Math.cos(a * 15 - y * 21) + 0.021 * Math.sin(y * 63 + 4 * a) * smoothstep(1.23 - y, 0, 0.23);
  const body = skin.parts((x, y) => blend(rig.hips, rig.chest, smoothstep(y, 0.91, 1.30)));
  const rows = [
    [p.cloth === 'apron' ? 0.80 : 0.86, 0.166, 0.120, 0.111],
    [0.89, 0.178, 0.126, 0.122], [0.96, 0.173, 0.120, 0.118],
    [1.04, 0.172, 0.118, 0.117], [1.13, 0.180, 0.124, 0.122],
    [1.22, 0.187, 0.136, 0.115], [1.30, 0.205, 0.126, 0.112, 0, -0.004],
    [1.36, 0.192, 0.105, 0.099], [1.40, 0.136, 0.086, 0.085, 0, 0.007],
    [1.425, 0.079, 0.070, 0.067, 0, 0.012], [1.434, 0.064, 0.058, 0.058, 0, 0.014],
  ].map(([y, w, ...dims]) => [y, w * p.build, ...dims]);
  volume(body, rowsBetween(rows, 36), shell, folds, 40);
  const chestAt = (x, y, lift = 0.002) => {
    const row = sample(rows, y);
    const a = Math.asin(clamp(x / row[1], -0.99, 0.99));
    return [x, y, contour(row, a, folds(y, a))[2] + lift];
  };
  const panelLine = (points, width, tint, lift) =>
    stroke(body, points.map(([x, y]) => chestAt(x, y, lift)), width, tint);

  // A fitted collar and facing sit on the sculpted torso.
  const bibRows = Array.from({ length: 16 }, (_, i) => {
    const t = i / 15;
    return [lerp(p.cloth === 'vest' ? 1.094 : 1.264, 1.423, t), lerp(0.018, 0.079, t ** 0.7)];
  });
  if (id !== 'ayse') surface(body, bibRows, 20, ([y, w], u) => chestAt((u * 2 - 1) * w, y, 0.009),
    id === 'zeynep' ? ink : linen);
  for (const s of [-1, 1]) {
    if (id !== 'ayse') panelLine(bibRows.filter((_, i) => i % 3 === 0).map(([y, w]) => [s * w, y]), 0.0033, seam, 0.010);
    panelLine([[s * 0.063, 1.421], [s * 0.103, 1.399], [s * 0.094, 1.365], [s * 0.067, 1.339], [s * 0.029, 1.384]],
      [0.002, 0.0037, 0.0036, 0.0029, 0.0015], p.seam, 0.010);
    panelLine([[s * 0.137, 1.352], [s * 0.171, 1.326], [s * 0.174, 1.282], [s * 0.166, 1.245]], 0.0024, seam);
    panelLine([[s * 0.075, 0.942], [s * 0.092, 0.965], [s * 0.119, 0.972]],
      [0.0007, 0.0023, 0.0008], seam);
    panelLine([[s * 0.072, 1.018], [s * 0.089, 1.038], [s * 0.131, 1.061]],
      [0.0008, 0.0019, 0.0008], p.seam);
  }
  const placket = p.cloth === 'apron' ? 1.105 : 0.875;
  panelLine([[0.007, placket], [0.006, 0.979 + (placket - 0.875) * 0.63], [0.009, 1.139], [0.007, 1.282]], 0.0035, seam);
  if (id !== 'emre') {
    volume(body, [[1.405, 0.084, 0.077, 0.066, 0, 0.013], [1.431, 0.078, 0.073, 0.069, 0, 0.013],
      [1.442, 0.066, 0.071, 0.068, 0, 0.015]], p.cloth === 'apron' ? ink : seam, () => 0, 32);
  }
  if (id === 'ayse') {
    for (const s of [-1, 1]) {
      panelLine([[0, 1.359], [s * 0.034, 1.361], [s * 0.065, 1.380], [s * 0.077, 1.414]],
        [0.002, 0.0025, 0.0022, 0.0012], p.dark, 0.008);
      for (let i = 1; i <= 5; i++) {
        const x = s * i * 0.0136, y = 1.362 + i ** 2 * 0.00135;
        panelLine([[x - 0.004, y + 0.003], [x, y], [x + 0.004, y + 0.003]], 0.0014, p.accent, 0.011);
      }
    }
  }
  for (let i = 0; i < (p.cloth === 'apron' ? 2 : 5); i++) {
    const at = chestAt(-0.008, 1.174 - 0.064 * i, 0.009);
    body.oval(at, [0.0082, 0.0082, 0.0036], i % 2 ? p.accent : '#685346', undefined, 12);
    body.oval([at[0] - 0.0018, at[1] + 0.0017, at[2] + 0.003], [0.0015, 0.0015, 0.0010], '#cfb591', undefined, 7);
  }
  if (p.cloth !== 'apron') {
    const s = id === 'emre' ? -1 : 1;
    const pocket = [[s * 0.061, 1.20], [s * 0.119, 1.197], [s * 0.121, 1.137], [s * 0.098, 1.122], [s * 0.066, 1.131], [s * 0.061, 1.20]];
    panelLine(pocket, 0.0027, seam, 0.004);
    panelLine([[s * 0.060, 1.201], [s * 0.084, 1.206], [s * 0.121, 1.198]], 0.004, p.seam, 0.008);
  }

  // Pelvis fabric overlaps both legs in their relaxed pose.
  const seat = skin.parts((x, y) => {
    const thigh = rig.legs[x < 0 ? 0 : 1].leg;
    return blend(thigh, rig.hips, smoothstep(y, 0.76, 0.90));
  });
  volume(seat, [[0.72, 0.083, 0.086, 0.083], [0.76, 0.165 * p.build, 0.120, 0.112],
    [0.83, 0.177 * p.build, 0.117, 0.121], [0.90, 0.155 * p.build, 0.109, 0.115]], bottom, folds);
  if (p.cloth === 'apron') {
    const apron = skin.parts((x, y) => blend(rig.legs[x < 0 ? 0 : 1].leg, rig.hips, smoothstep(y, 0.56, 0.82)));
    const hem = [[0.47, 0.203, 0.153], [0.49, 0.199, 0.161], [0.60, 0.195, 0.161],
      [0.71, 0.180, 0.155], [0.85, 0.170, 0.150], [0.991, 0.170, 0.134]];
    const wrap = ([y, w, z], u) => {
      const a = (u - 0.5) * 2.84;
      const wave = 0.012 * Math.cos(a * 13 + y * 3) * smoothstep(1 - y, 0, 0.30);
      return [Math.sin(a) * w, y + (0.014 * Math.cos(4 * a) - 0.01 * Math.sin(a)) * (1 - u * 0.3), (z + wave) * Math.cos(a) + 0.028];
    };
    const band = paint('#817e64', '#aca186', '#5c5d4a', p.grain);
    const apronPaint = (x, y, z) => {
      const base = band(x, y, z);
      const a = Math.atan2(x, z - 0.025);
      const stripe = Math.abs(Math.sin(a * 16 + 0.3)) > 0.93;
      if (y < 0.51) return base.lerp(pigment(y < 0.486 ? p.accent : '#4e5045'), 0.67);
      return stripe ? base.lerp(pigment('#cabc96'), 0.44) : base;
    };
    // A second face keeps the folded apron readable from both sides.
    surface(apron, rowsBetween(hem, 40), 62, wrap, apronPaint);
    stroke(apron, Array.from({length: 25}, (_, i) => wrap(hem[0], i / 24)), 0.0032, '#686450');
    for (const u of [0.0, 1]) stroke(apron, hem.map((r) => wrap(r, u)), [0.003, 0.003, 0.0026, 0.0026, 0.0029, 0.0035], '#5b5847');
    volume(body, [[0.949, 0.193, 0.146, 0.123], [0.966, 0.192, 0.147, 0.126], [0.984, 0.191, 0.142, 0.125],
      [0.994, 0.188, 0.136, 0.125]], paint('#7e6d53', '#9e855f', '#5b513f', p.grain), folds);
    stroke(body, [[0.135, 0.968, -0.067], [0.162, 0.963, -0.083], [0.156, 0.919, -0.088], [0.133, 0.89, -0.09]],
      [0.018, 0.021, 0.015, 0.007], '#a18c68');
  } else {
    const belt = [[0.849, 0.191, 0.136, 0.137], [0.857, 0.194, 0.138, 0.140], [0.880, 0.194, 0.141, 0.140],
      [0.887, 0.192, 0.139, 0.139]].map(([y, w, f, b]) => [y, w * p.build, f, b]);
    volume(body, belt, paint(id === 'hasan' ? '#89654b' : '#635141', '#a98762', '#46392f', p.grain), () => 0, 32);
    body.box([0.007, 0.868, 0.146], [0.035, 0.026, 0.012], '#ad8d63', [0, 0, -0.07]);
    body.box([0.006, 0.868, 0.152], [0.018, 0.013, 0.006], '#584b3b', [0, 0, -0.07]);
  }

  const scarf = skin.parts(rig.chest);
  if (id === 'emre') {
    volume(scarf, [[1.39, 0.077, 0.067, 0.069, 0, 0.012], [1.413, 0.089, 0.084, 0.077, 0, 0.009],
      [1.438, 0.080, 0.079, 0.072, 0, 0.013], [1.448, 0.075, 0.072, 0.069, 0, 0.013]],
      paint(p.accent, '#c98063', '#633a34', p.grain), folds);
    scarf.oval([0.031, 1.403, 0.095], [0.028, 0.018, 0.013], '#9e5447', [0, 0, 0.4], 14);
    stroke(scarf, [[0.034, 1.403, 0.097], [0.064, 1.369, 0.107], [0.069, 1.336, 0.101]],
      [0.018, 0.017, 0.004], '#a9614d');
  }
  if (id === 'hasan') {
    for (let i = 0; i < 9; i++) {
      const x = -0.050 + i * 0.012;
      panelLine([[x, 1.28], [x + 0.002, 1.329], [x + 0.003, 1.371]], 0.0009, '#8f8876', 0.011);
    }
  }

  for (const { arm, elbow, hand, s } of rig.arms) {
    const upper = rig.position[arm], joint = rig.position[elbow], wrist = rig.position[hand];
    const sleeves = skin.parts((x, y) => y > 1.28
      ? blend(arm, rig.chest, smoothstep(y, 1.28, 1.365) *
        (1 - smoothstep(Math.abs(x), Math.abs(upper.x) - 0.072, Math.abs(upper.x) + 0.031)))
      : blend(elbow, arm, smoothstep(y, joint.y - 0.081, joint.y + 0.079)));
    const end = id === 'emre' ? wrist.y + 0.081 : wrist.y + 0.013;
    const at = (y, w, f, z, x) => [y, w, f, f * 1.02, x, z];
    const armRows = [
      at(end, 0.035, 0.034, wrist.z, wrist.x),
      at(end + 0.014, 0.043, 0.040, wrist.z, wrist.x),
      at(end + 0.052, 0.038, 0.039, wrist.z + 0.001, wrist.x - s * 0.007),
      at(joint.y - 0.094, 0.048, 0.045, joint.z + 0.014, joint.x + s * 0.006),
      at(joint.y - 0.017, 0.056, 0.051, joint.z + 0.012, joint.x + s * 0.004),
      at(joint.y + 0.044, 0.058, 0.051, joint.z, joint.x),
      at(upper.y - 0.113, 0.061, 0.057, upper.z + 0.003, upper.x + s * 0.015),
      at(upper.y - 0.048, 0.079 * p.build, 0.071, upper.z, upper.x + s * 0.005),
      at(upper.y + 0.006, 0.068 * p.build, 0.070, upper.z, upper.x - s * 0.024),
      at(upper.y + 0.046, 0.032, 0.037, upper.z + 0.004, upper.x - s * 0.041),
      at(upper.y + 0.053, 0.005, 0.011, upper.z + 0.004, upper.x - s * 0.047),
    ].sort((a, b) => a[0] - b[0]);
    const sleeveFold = (y, a) => 0.042 * Math.cos(y * 74 + a * 2 - s * 1.5) * bell(y - joint.y, 0.12)
      + 0.021 * Math.cos(7 * a + y * 17);
    volume(sleeves, rowsBetween(armRows, 27), ink, sleeveFold, 26);
    const cuff = skin.parts(elbow);
    const band = [end, end + 0.008, end + 0.024, end + 0.031].map((y, i) => {
      const row = sample(armRows, y);
      row[1] += i === 1 || i === 2 ? 0.008 : 0.002;
      row[2] += 0.004;
      row[3] += 0.004;
      return row;
    });
    volume(cuff, band, paint(p.dark, p.light, p.dark, p.grain), sleeveFold, 24);
    if (id === 'emre') {
      const forearm = skin.parts(elbow);
      forearm.sweep([[wrist.x, wrist.y - 0.013, wrist.z, 0.024, 0.022],
        [wrist.x, wrist.y + 0.030, wrist.z - 0.002, 0.026, 0.023],
        [wrist.x - s * 0.007, end + 0.012, wrist.z, 0.033, 0.030]], p.skin, 22, 5, [1, 0, 0]);
    }
    for (let i = 0; i < 3; i++) {
      const center = joint.y + 0.038 - i * 0.032;
      const points = [-0.68, -0.36, 0, 0.39, 0.68].map((a, j) => {
        const y = center + (j - 2) ** 2 * 0.004 + s * a * 0.012;
        return contour(sample(armRows, y), a, sleeveFold(y, a) + 0.021);
      });
      stroke(sleeves, points, [0.0006, 0.0014, 0.0014, 0.0012, 0.0005], p.dark);
    }
    hands(skin.parts(hand), wrist, p, s);
  }

  for (const { leg, knee, foot, s } of rig.legs) {
    const upper = rig.position[leg], joint = rig.position[knee], ankle = rig.position[foot];
    const pants = skin.parts((x, y) => y >= 0.78
      ? blend(leg, rig.hips, smoothstep(y, 0.78, 0.91))
      : blend(knee, leg, smoothstep(y, joint.y - 0.098, joint.y + 0.108)));
    const full = id === 'ayse' ? 1.16 : 1;
    const cuff = id === 'ayse' || id === 'hasan' ? 0.176 : 0.213;
    const pant = [
      [cuff, 0.058, 0.059, 0.061, ankle.x, ankle.z], [cuff + 0.008, 0.062, 0.062, 0.064, ankle.x, ankle.z],
      [cuff + 0.045, 0.055 * full, 0.056, 0.062, ankle.x, ankle.z + 0.001], [0.32, 0.062 * full, 0.060, 0.066, joint.x, 0.01],
      [0.43, 0.063 * full, 0.065, 0.065, joint.x, 0.014], [0.51, 0.071 * full, 0.070, 0.066, joint.x, 0.015],
      [0.60, 0.079 * full, 0.079, 0.076, upper.x + s * 0.008, 0.009],
      [0.71, 0.084 * full, 0.091, 0.089, upper.x, 0.002], [0.80, 0.079, 0.094, 0.094, upper.x - s * 0.004, -0.006],
      [0.873, 0.065, 0.072, 0.081, upper.x - s * 0.009, -0.009],
    ];
    const creases = (y, a) => (Math.cos(y * 62 + a * 4) * 0.035 + Math.cos(a * 11 - y * 8) * 0.018)
      * (id === 'ayse' ? 1.33 : 1);
    volume(pants, rowsBetween(pant, 30), (x, y, z) => y < cuff + 0.014
      ? bottom(x, y, z).lerp(pigment('#3f3936'), 0.23) : bottom(x, y, z), creases, 26);
    for (const a of [s * 1.30, s * 1.44]) {
      stroke(pants, pant.slice(1, -1).map((row) => contour(row, a, creases(row[0], a) + 0.018)),
        0.0015, a === s * 1.30 ? '#83766a' : '#49434a');
    }
    for (let i = 0; i < 3; i++) {
      const y = joint.y + 0.035 - i * 0.029;
      const points = [-0.77, -0.435, 0.0, 0.38, 0.76].map((a) => {
        const level = y + a * 0.017 * s + a ** 2 * 0.011;
        return contour(sample(pant, level), a, creases(level, a) + 0.026);
      });
      stroke(pants, points, [0.0006, 0.0016, 0.002, 0.0017, 0.00065], '#49434a');
    }
    boots(skin, p, foot, knee, ankle, id);
  }
}

function hands(parts, wrist, p, side) {
  const at = (x, y, z) => [wrist.x + side * x, wrist.y + y, wrist.z + z];
  const palm = paint(p.skin, '#cfa385', p.warmth, p.grain + 1);
  parts.sweep([
    [...at(0.003, -0.064, 0.001), 0.021, 0.0135],
    [...at(0.003, -0.048, 0.000), 0.037, 0.017],
    [...at(0, -0.024, -0.006), 0.030, 0.019],
    [...at(-0.006, 0.015, -0.002), 0.025, 0.022],
  ], palm, 24, 5, [1, 0, 0]);
  const knuckles = [
    [-0.023, -0.059, 0.043, 0.010], [-0.006, -0.063, 0.050, 0.0101],
    [0.012, -0.062, 0.048, 0.0092], [0.027, -0.056, 0.036, 0.0084],
  ];
  for (const [x, y, length, size] of knuckles) {
    const finger = [at(x, y + 0.009, 0.002), at(x + 0.001, y - length * 0.34, 0.004),
      at(x + 0.001, y - length * 0.73, 0.012), at(x - 0.002, y - length * 0.96, 0.019),
      at(x - 0.002, y - length, 0.022)];
    stroke(parts, finger, [size, size, size * 0.85, size * 0.73, 0.0017], palm, 13);
    parts.oval(at(x - 0.001, y - length * 0.76, 0.006), [size * 0.57, 0.009, 0.0021],
      color(p.skin).lerp(pigment('#e9baa1'), 0.32), [0.27, 0, 0], 10);
  }
  stroke(parts, [at(-0.019, -0.023, 0.008), at(-0.033, -0.030, 0.012), at(-0.041, -0.044, 0.016),
    at(-0.035, -0.061, 0.027), at(-0.031, -0.068, 0.032)], [0.016, 0.015, 0.013, 0.0094, 0.0017], palm, 14);
  for (let i = 0; i < 2; i++) {
    const x = -0.010 + i * 0.021;
    stroke(parts, [at(x, -0.024, 0.014), at(x + 0.002, -0.034, 0.0165), at(x + 0.004, -0.051, 0.016)],
      [0.00045, 0.0010, 0.00045], p.warmth);
  }
}

function boots(skin, p, foot, knee, a, id) {
  const leather = paint(p.boots, '#a07d5b', '#3e3631', p.grain + 0.7);
  const shoe = skin.parts(foot);
  const width = id === 'ayse' ? 0.063 : id === 'emre' ? 0.076 : 0.066;
  const length = id === 'ayse' ? 0.112 : 0.132;
  const rows = [
    [0.009, width * 0.95, length, 0.066, a.x, a.z + 0.027], [0.024, width, length * 1.03, 0.070, a.x, a.z + 0.029],
    [0.038, width * 0.98, length, 0.070, a.x, a.z + 0.029], [0.055, width * 0.98, length * 0.98, 0.066, a.x, a.z + 0.028],
    [0.077, width * 0.86, length * 0.87, 0.064, a.x, a.z + 0.026],
    [0.103, width * 0.74, length * 0.64, 0.058, a.x, a.z + 0.014],
    [0.126, width * 0.68, 0.055, 0.058, a.x, a.z + 0.006], [0.154, width * 0.62, 0.046, 0.051, a.x, a.z],
  ];
  volume(shoe, rowsBetween(rows, 16), (x, y, z) => y < 0.037 ? '#40362e' : leather(x, y, z), () => 0, 36);
  volume(shoe, [rows[0], [0.008, width * 0.35, length * 0.6, 0.035, a.x, a.z + 0.028]]
    .reverse(), '#3e352c', () => 0, 30);
  const ankle = skin.parts((x, y) => blend(foot, knee, smoothstep(y, 0.116, 0.180)));
  const top = id === 'ayse' || id === 'hasan' ? 0.189 : 0.226;
  volume(ankle, [[0.119, width * 0.68, 0.049, 0.052, a.x, a.z], [0.160, width * 0.62, 0.048, 0.057, a.x, a.z],
    [top - 0.008, width * 0.74, 0.057, 0.060, a.x, a.z], [top, width * 0.70, 0.053, 0.057, a.x, a.z]], leather, () => 0, 28);
  const toeSeam = Array.from({ length: 19 }, (_, i) => contour(rows[3], lerp(-1.35, 1.35, i / 18), 0.014));
  stroke(shoe, toeSeam, 0.0018, '#a48264');
  if (id === 'ayse') {
    stroke(shoe, [[a.x - 0.052, 0.069, a.z + 0.061], [a.x, 0.114, a.z + 0.060], [a.x + 0.052, 0.069, a.z + 0.061]],
      [0.007, 0.009, 0.007], '#6f5746');
    shoe.box([a.x + 0.043, 0.089, a.z + 0.063], [0.017, 0.016, 0.007], '#ba9467', [0.15, 0, -0.42]);
  } else {
    for (let i = 0; i < 4; i++) {
      const y = 0.100 + i * 0.013;
      const front = i < 2 ? 0.089 - i * 0.010 : 0.066 - (i - 2) * 0.005;
      stroke(shoe, [[a.x - 0.023, y, a.z + front], [a.x, y + 0.004, a.z + front + 0.007],
        [a.x + 0.022, y + 0.011, a.z + front - 0.004]], [0.0017, 0.0023, 0.0015], '#ad9276', 6);
    }
  }
}

const bell = (v, w) => Math.exp(-((v / w) ** 2));

function headShape(p, id) {
  const [width, height, jaw, nose, eyes, tilt] = p.face;
  const center = 1.608;
  const h = (y) => center + (y - center) * height;
  const rows = [
    [1.484, 0.24, 0.046, 0.041], [1.492, 0.48, 0.067, 0.050],
    [1.509, 0.69, 0.076, 0.054], [1.532, 0.81, 0.081, 0.065], [1.554, 0.88, 0.087, 0.073],
    [1.580, 0.97, 0.087, 0.082], [1.609, 1.00, 0.080, 0.095], [1.631, 0.96, 0.077, 0.099],
    [1.654, 0.94, 0.084, 0.098], [1.676, 0.92, 0.082, 0.095], [1.699, 0.85, 0.079, 0.090],
    [1.718, 0.70, 0.068, 0.076], [1.735, 0.47, 0.042, 0.053], [1.743, 0.16, 0.014, 0.017], [1.744, 0.002, 0.002, 0.002],
  ].map(([y, side, front, back]) => [h(y), side * width * lerp(jaw, 1, smoothstep(y, 1.487, 1.589)), front, back,
    Math.sin((y - 1.55) * 7) * tilt, 0.016 + Math.max(0, 1.55 - y) * 0.1]);
  function relief(x, y) {
    y = center + (y - center) / height;
    const side = Math.abs(x);
    const cheek = (id === 'ayse' ? 0.013 : 0.010) * bell(side - width * 0.60, 0.028) * bell(y - 1.591, 0.021);
    const socket = -0.013 * bell(side - width * 0.44, 0.021) * bell(y - 1.628, 0.014);
    const brow = 0.0082 * bell(side - width * 0.43, 0.043) * bell(y - 1.650, 0.012);
    const tipY = id === 'hasan' ? 1.581 : id === 'zeynep' ? 1.600 : 1.592;
    const centerX = tilt * (1 - bell(y - 1.585, 0.036));
    const bridge = 0.023 * nose * bell(x - centerX, 0.014) * bell(y - 1.617, 0.041);
    const tip = 0.033 * nose * bell(x - centerX, id === 'zeynep' ? 0.018 : 0.020) * bell(y - tipY, 0.015);
    const wings = 0.010 * bell(side - 0.016, 0.008) * bell(y - (tipY - 0.007), 0.008);
    const lip = 0.005 * bell(x, 0.038) * bell(y - 1.551, 0.013);
    return cheek + socket + brow + bridge + tip + wings + lip;
  }
  function front(x, y, lift = 0) {
    const row = sample(rows, y);
    const c = Math.sqrt(1 - clamp((x - row[4]) / row[1], -1, 1) ** 2);
    return [x, y, row[5] + row[2] * c + relief(x, y) * smoothstep(c, 0.15, 0.60) + lift];
  }
  return { h, rows, front, relief, width, eyes, tilt };
}

function facePaint(figure, rig, p, id) {
  const parts = figure.parts(rig.head);
  const face = headShape(p, id);
  const { rows, h, front, relief, width, eyes, tilt } = face;
  const skin = (x, y, z) => {
    const flush = bell(Math.abs(x) - width * 0.57, 0.033) * bell(y - h(1.592), 0.034) * smoothstep(z, 0.040, 0.092);
    const shadow = 0.14 * bell(y - h(1.627), 0.015) + 0.06 * bell(y - h(1.509), 0.021);
    const base = color(p.skin).lerp(pigment(p.warmth), flush * 0.26 + shadow)
      .multiplyScalar(1 + clothGrain(x, y, z) * 0.026 + Math.sin(x * 49 + y * 23) * 0.021);
    if (id === 'hasan' || id === 'emre') {
      const lower = smoothstep(y, h(1.482), h(1.517));
      const edge = h(1.534 + 0.055 * smoothstep(Math.abs(x), 0.023, 0.086));
      const mask = lower * (1 - smoothstep(y, edge - 0.012, edge + 0.006)) * smoothstep(z, 0.025, 0.064);
      const stipple = 0.80 + 0.19 * Math.sin(x * 925 + y * 513) * Math.sin(y * 673 - z * 587);
      base.lerp(pigment(id === 'hasan' ? '#a89d8f' : '#755b51'), mask * stipple * (id === 'hasan' ? 0.72 : 0.36));
    }
    return base;
  };
  surface(parts, rowsBetween(rows, 48), 72, (row, u) => {
    const [x, y, z] = contour(row, u * TAU);
    const c = Math.cos(u * TAU);
    return [x, y, z + relief(x, y) * smoothstep(c, 0.15, 0.60)];
  }, skin, true);
  const line = (points, weight, paint, lift = 0.0014) =>
    stroke(parts, points.map(([x, y]) => front(x, h(y), lift)), weight, paint);

  for (const s of [-1, 1]) {
    const eyeParts = figure.parts(rig.eyes[s < 0 ? 0 : 1]);
    const earX = s * width * 0.92;
    parts.oval([earX, h(1.612), 0.015], [0.020, 0.033, 0.017], skin, [0.05, s * 0.28, s * -0.12], 19);
    parts.oval([earX + s * 0.008, h(1.612), 0.027], [0.008, 0.022, 0.009], p.warmth, [0, s * 0.24, s * -0.17], 14);
    stroke(parts, [[earX + s * 0.008, h(1.591), 0.031], [earX + s * 0.016, h(1.601), 0.034],
      [earX + s * 0.017, h(1.623), 0.028], [earX + s * 0.011, h(1.633), 0.026]],
      [0.002, 0.003, 0.0035, 0.0014], color(p.skin).lerp(pigment('#e3ae91'), 0.24));
    const x = width * 0.439 * s;
    const y = 1.630 + s * tilt * 0.26;
    const wing = id === 'hasan' ? 0.022 : 0.0215;
    const orient = id === 'ayse' ? 0.0019 : id === 'emre' ? -0.0016 : id === 'hasan' ? -0.0027 : 0.0034;
    const eye = (u, lift) => {
      const shape = Math.max(0, 1 - u * u) ** 0.73;
      return [x + wing * u, y + orient * s * u + lift * shape * eyes];
    };
    const sampleEye = (u, v, extra) => {
      const [x1, y1] = eye(u, v);
      return front(x1, h(y1), extra + 0.0039 * Math.max(0, 1 - u * u) * (1 - Math.abs(v) * 55));
    };
    const steps = Array.from({ length: 8 }, (_, i) => lerp(-0.0042, 0.0072, i / 7));
    surface(eyeParts, steps, 27, (v, u) => sampleEye(u * 1.984 - 0.992, v, 0.0018),
      (x, y) => color('#e7d5b4').lerp(pigment(p.warmth), 0.18 * smoothstep(y, h(1.630), h(1.639))));
    // The iris, eyelids and brow follow the sculpted eye socket.
    const irisX = x - s * 0.001;
    const iris = front(irisX, h(y + 0.0013), 0.0055);
    eyeParts.oval(iris, [0.0067 * eyes, 0.0060 * eyes, 0.0027], p.iris, [0, -s * 0.19, 0], 17);
    eyeParts.oval([iris[0] - 0.00034, iris[1] + 0.0003, iris[2] + 0.00235], [0.0037, 0.0041, 0.0011], '#39322b', undefined, 14);
    eyeParts.oval([iris[0] - 0.0023, iris[1] + 0.0028, iris[2] + 0.00275], [0.0012, 0.00115, 0.0008], '#efe0cb', undefined, 9);
    const eyeLine = (high, weight, tone) => {
      const points = Array.from({ length: 11 }, (_, i) => sampleEye(i / 5 - 1, high, high > 0 ? 0.0018 : 0.0020));
      const widths = points.map((_, i) => weight * (0.28 + 0.72 * Math.sin(i * Math.PI / 10)));
      stroke(eyeParts, points, widths, tone);
    };
    eyeLine(0.0080, id === 'hasan' ? 0.0022 : 0.00185, '#554033');
    eyeLine(-0.0047, 0.00135, p.lip);
    const brow = id === 'emre' ? 0.0047 : id === 'hasan' ? 0.0044 : 0.00275;
    const arch = id === 'hasan' ? 0.0054 : id === 'zeynep' ? 0.0091 : 0.0070;
    line([[x - s * 0.023, y + 0.015], [x - s * 0.013, y + 0.018], [x + s * 0.001, y + 0.018 + arch],
      [x + s * 0.015, y + 0.018 + arch * 0.51], [x + s * 0.028, y + 0.015]], [0.001, brow, brow, brow * 0.72, 0.0005],
      id === 'hasan' ? '#77685e' : p.hair, 0.002);
    for (let i = 0; i < (id === 'hasan' ? 3 : id === 'ayse' ? 2 : 1); i++) {
      line([[x - s * 0.012, y - 0.011 - i * 0.004], [x + s * 0.003, y - 0.015 - i * 0.004],
        [x + s * 0.019, y - 0.010 - i * 0.004], [x + s * 0.027, y - 0.005 - i * 0.005]],
        [0.0004, 0.0010, 0.0009, 0.00035], color(p.skin).lerp(pigment(p.line), 0.42 + i * 0.10));
    }
    if (id === 'hasan' || id === 'ayse') {
      line([[s * 0.026, 1.580], [s * 0.033, 1.568], [s * 0.042, 1.554], [s * 0.044, 1.545]],
        [0.0006, 0.0012, 0.0014, 0.0003], color(p.skin).lerp(pigment(p.line), 0.65));
      line([[s * 0.062, 1.629], [s * 0.071, 1.630], [s * 0.082, 1.626]], [0.0003, 0.0013, 0.0003], p.warmth);
    }
    const nose = id === 'hasan' ? 1.573 : id === 'zeynep' ? 1.591 : 1.584;
    line([[s * 0.006, nose], [s * 0.012, nose - 0.002], [s * 0.019, nose + 0.0005]],
      [0.0008, 0.0018, 0.00055], p.line, 0.0022);
  }
  const bridge = id === 'hasan' ? [[0.011, 1.646], [0.015, 1.623], [0.018, 1.601], [0.016, 1.585]]
    : [[-0.011, 1.646], [-0.012, 1.624], [-0.014, 1.609], [-0.018, 1.595]];
  if (id !== 'zeynep') line(bridge, [0.00040, 0.00108, 0.00086, 0.00033], color(p.skin).lerp(pigment(p.line), 0.47));

  const smile = id === 'ayse' ? 0.009 : id === 'zeynep' ? 0.005 : id === 'emre' ? 0.004 : 0.001;
  const mouth = id === 'hasan' ? 1.541 : 1.550;
  const innerMouth = figure.parts(rig.mouth);
  const mouthRows = Array.from({ length: 7 }, (_, i) => (i / 6 - 0.5) * 0.023);
  surface(innerMouth, mouthRows, 24, (y, u) => {
    const side = u * 1.98 - 0.99;
    return front(side * 0.027, h(mouth + y * (1 - side ** 2) + 0.001), 0.0032);
  }, '#633e38');
  const lip = [[-0.031, mouth + smile * 0.6], [-0.017, mouth + 0.001],
    [-0.005, mouth + 0.002], [0.006, mouth + 0.0015], [0.020, mouth + 0.002], [0.034, mouth + smile]];
  line(lip, [0.00065, 0.0020, 0.00245, 0.00225, 0.0019, 0.0006], p.lip, 0.0022);
  line([[-0.020, mouth - 0.0055], [-0.008, mouth - 0.009], [0.009, mouth - 0.0087], [0.023, mouth - 0.004]],
    [0.0005, 0.00185, 0.0019, 0.0004], color(p.skin).lerp(pigment(p.lip), 0.36));
  if (id === 'hasan') {
    const fold = [[-0.061, 1.674], [-0.029, 1.679], [0.001, 1.677], [0.030, 1.679], [0.056, 1.673]];
    for (const off of [0, 0.011, 0.021]) {
      line(fold.map(([x, y]) => [x * (1 - off * 7), y + off]), [0.0004, 0.0011, 0.0012, 0.0010, 0.0003],
        color(p.skin).lerp(pigment(p.line), 0.49));
    }
  }
  if (id === 'hasan' || id === 'emre') {
    const gray = id === 'hasan' ? '#c7b8a6' : '#826450';
    for (let i = 0; i < 34; i++) {
      const y = 1.501 + ((i * 23) % 48) / 1000;
      const x = Math.sin(i * 2.39996) * lerp(0.025, 0.067, smoothstep(y, 1.50, 1.56));
      if (y > 1.527 + Math.abs(x) * 0.26) continue;
      line([[x, y], [x - 0.0015, y - 0.0019], [x - 0.0019, y - 0.0033]],
        [0.00035, 0.00065, 0.00035], gray, 0.0016);
    }
  }
  if (id === 'emre' || id === 'zeynep') {
    for (let i = 0; i < 13; i++) {
      const x = (i % 2 ? -1 : 1) * (0.022 + (i * 0.0093) % 0.047);
      const at = front(x, h(1.599 + ((i * 7) % 19) / 1000), 0.0010);
      parts.oval(at, [0.0018, 0.0015, 0.0007], color(p.skin).lerp(pigment(p.line), 0.58), undefined, 7);
    }
  }
  hairAndWrap(parts, face, p, id);
}

function hairAndWrap(parts, face, p, id) {
  const { rows, h, width } = face;
  if (id === 'ayse' || id === 'zeynep') {
    const tied = id === 'zeynep';
    const textile = paint(p.wrap, p.wrapLight, '#48373f', p.grain + 1);
    const folds = (y, a) => 0.026 * Math.cos(a * 8 - y * 17) + 0.011 * Math.cos(a * 19 + y * 29);
    const openingAt = (t) => lerp(tied ? 0.91 : 0.80, 0, smoothstep(t, tied ? 0.36 : 0.42, tied ? 0.56 : 0.63));
    const wrapAt = (t, u, lift = 0) => {
      const opening = openingAt(t);
      const a = lerp(opening, TAU - opening, u);
      const front = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      const start = tied ? lerp(1.524, 1.600, 1 - smoothstep(front, 0.75, Math.PI))
        : lerp(1.453, 1.547, 1 - smoothstep(front, 0.8, Math.PI));
      const y = lerp(start, 1.781 - (tied ? 0.010 : 0.0), t);
      const base = sample(rows, h(clamp(y - 0.021, 1.521, 1.742)));
      let bulge = 1 + folds(y, a);
      let rx = base[1] + (tied ? 0.010 : 0.017);
      let rz = (Math.cos(a) >= 0 ? base[2] : base[3]) + (tied ? 0.010 : 0.021);
      if (y < 1.564) {
        rz += 0.008 + (1.564 - y) * (tied ? 0.28 : 0.20);
        rx += 0.006 + (1.564 - y) * 0.16;
      }
      const shrink = 1 - 0.90 * smoothstep(t, 0.92, 1);
      bulge *= shrink;
      return [(rx * bulge + lift) * Math.sin(a) - 0.005 * Math.sin(t * Math.PI), h(y),
        0.012 + (rz * bulge + lift) * Math.cos(a)];
    };
    const rings = Array.from({ length: 51 }, (_, i) => i / 50);
    const printed = (x, y, z) => {
      const base = textile(x, y, z);
      if (tied) return base;
      const a = Math.atan2(x, z - 0.012);
      const bands = Math.sin(y * 131 + Math.round(a * 6 / Math.PI) * 1.2);
      const weft = Math.abs(Math.cos(a * 9.2 + y * 4.6));
      const petal = smoothstep(bands, 0.68, 0.94) * smoothstep(weft, 0.76, 0.92);
      return base.lerp(pigment(p.trim), petal * 0.57);
    };
    surface(parts, rings, 67, wrapAt, printed);
    const tValues = rings.slice(0, tied ? 28 : 32).filter((_, i) => i % 2 === 0);
    for (const u of [0, 1]) {
      for (const turn of [0, 0.018, 0.035]) {
        const at = u === 0 ? turn : 1 - turn;
        const edge = tValues.map((t) => wrapAt(t, at, 0.0019));
        stroke(parts, edge, turn === 0 ? 0.0033 : 0.00135, turn === 0.018 ? p.trim : p.wrapLight);
      }
    }
    for (const t of [0.00, 0.029, 0.055]) {
      const edge = Array.from({ length: 36 }, (_, i) => wrapAt(t, i / 35, 0.002));
      stroke(parts, edge, t === 0.0 ? 0.0030 : 0.0012, t === 0.029 ? p.trim : p.wrapLight);
    }
    if (tied) {
      for (const offset of [0, 0.025]) {
        const turn = Array.from({ length: 25 }, (_, i) => {
          const a = lerp(-1.20, 1.16, i / 24);
          const t = 0.61 + a * 0.062 + offset;
          const opening = openingAt(t);
          const u = ((a < 0 ? a + TAU : a) - opening) / (TAU - 2 * opening);
          return wrapAt(t, u, 0.0015);
        });
        stroke(parts, turn, turn.map((_, i) => 0.0003 + 0.00125 * Math.sin(Math.PI * i / 24)),
          offset === 0 ? '#24474b' : '#7c9a86');
      }
    }
    const knot = tied ? [0.016, h(1.565), -0.094] : [-0.068, h(1.49), -0.044];
    parts.oval(knot, tied ? [0.030, 0.019, 0.022] : [0.022, 0.024, 0.024], textile, [0, 0, -0.49], 19);
    if (tied) {
      for (const s of [-1, 1]) {
        const x = knot[0] + s * 0.009;
        stroke(parts, [[x, knot[1], knot[2]], [x + s * 0.024, knot[1] - 0.026, knot[2] - 0.015],
          [x + s * 0.015, knot[1] - 0.072, knot[2] - 0.007]], [0.019, 0.018, 0.005], textile, 12);
      }
    } else {
      stroke(parts, [[-0.069, h(1.498), -0.044], [-0.093, h(1.461), -0.053],
        [-0.106, h(1.406), -0.056]], [0.023, 0.021, 0.004], printed, 16);
    }
    for (const s of [-1, 1]) {
      // A few hairline strokes at each temple sit beneath the turned scarf edge.
      const hair = paint(p.hair, '#785648', '#302a2a', p.grain);
      for (let i = 0; i < 4; i++) {
        stroke(parts, [[s * width * (0.77 - i * 0.014), h(1.657 + i * 0.007), 0.071],
          [s * width * (0.69 - i * 0.016), h(1.674 + i * 0.005), 0.077],
          [s * width * (0.64 - i * 0.020), h(1.678 + i * 0.005), 0.083]],
        [0.0012, 0.0015, 0.0004], hair);
      }
      parts.torus([s * width * 0.91, h(1.590), 0.038], tied ? 0.009 : 0.012, 0.00185,
        '#cc9e64', [0, s * 0.26, s * 0.14], [0.83, 1, 1], TAU, 20);
    }
    return;
  }

  const older = id === 'hasan';
  const tint = paint(older ? '#8a8074' : '#43342f', older ? '#c1b4a4' : '#705243', '#322c2a', p.grain);
  const hairAt = (t, u, lift = 0) => {
    const a = TAU * u;
    const front = smoothstep(Math.cos(a), -0.06, 0.63);
    const start = lerp(1.548, older ? 1.689 : 1.683 + Math.sin(a * 2.3 + 0.5) * 0.012, front);
    const y = lerp(start, older ? 1.704 : 1.774 + front * 0.013, t);
    const row = sample(rows, h(clamp(y - 0.028, 1.512, 1.743)));
    const sweep = !older ? 0.029 * Math.sin(t * Math.PI) : 0;
    const ridge = 1 + (older ? 0.014 : 0.043) * Math.cos(7.3 * a + 16 * t);
    const end = older ? 0.99 : 1 - 0.89 * smoothstep(t, 0.88, 1);
    return [sweep + (row[1] * ridge + 0.012 + lift) * Math.sin(a) * end, h(y),
      row[5] + ((Math.cos(a) > 0 ? row[2] : row[3]) * ridge + 0.009 + lift) * Math.cos(a) * end];
  };
  surface(parts, Array.from({ length: 33 }, (_, i) => i / 32), 64, hairAt, tint, true);
  for (let i = 0; i < 22; i++) {
    const u = i / 22;
    const length = older ? 0.23 : 0.72 + (i % 4) * 0.055;
    const points = Array.from({ length: 12 }, (_, j) => hairAt(j / 11 * length, u + j * 0.0035, 0.0011));
    stroke(parts, points, points.map((_, n) => 0.00055 + Math.sin(n * Math.PI / 11) * 0.00125),
      i % 2 ? (older ? '#ab9b89' : '#604538') : (older ? '#746b62' : '#352d2b'));
  }
  if (older) {
    const cap = [[1.688, width + 0.010, 0.084, 0.106, 0, 0.006], [1.703, width + 0.015, 0.088, 0.111, 0.002, 0.006],
      [1.721, width + 0.013, 0.088, 0.108, 0.005, 0.007], [1.753, width * 0.94, 0.075, 0.094, 0.007, 0.001],
      [1.778, width * 0.68, 0.053, 0.065, 0.009, -0.004], [1.789, 0.021, 0.025, 0.027, 0.010, -0.008],
      [1.793, 0.002, 0.001, 0.001, 0.010, -0.008]].map(([y, ...r]) => [h(y), ...r]);
    const knit = paint(p.wrap, p.wrapLight, p.trim, p.grain);
    const rib = (y, a) => Math.abs(Math.sin(a * 23 + Math.sin(y * 39))) * 0.035 + 0.011 * Math.cos(y * 93);
    volume(parts, rowsBetween(cap, 28), (x, y, z) => knit(x, y, z).lerp(pigment(p.trim),
      0.16 * Math.abs(Math.sin(y * 380 + Math.atan2(x, z) * 29))), rib, 76);
    for (const y of [1.694, 1.706, 1.723]) {
      const row = sample(cap, h(y));
      const points = Array.from({ length: 35 }, (_, i) => contour(row, i / 34 * TAU, rib(row[0], i / 34 * TAU) + 0.017));
      stroke(parts, points, y > 1.710 ? 0.0012 : 0.0023, y < 1.700 ? '#8e7966' : '#d0bb99');
    }
  }
}

export function villagerModel(parent, name, id, seated = false) {
  const p = villagers[id];
  const root = group(null, name);
  const rig = makeRig(root, p, id);
  const figure = skinnedPaint(root, rig);
  const neck = figure.parts((x, y) => blend(rig.chest, rig.head, smoothstep(y, 1.412, 1.505)));
  volume(neck, [[1.380, 0.063, 0.057, 0.055, 0, 0.013], [1.429, 0.062, 0.068, 0.064, 0, 0.015],
    [1.480, 0.052, 0.073, 0.066, 0, 0.016], [1.513, 0.060, 0.067, 0.067, 0, 0.015],
    [1.562, 0.056, 0.062, 0.065, 0, 0.014]], paint(p.skin, '#cfa184', p.warmth, p.grain), () => 0, 35);
  clothing(figure, rig, p, id);
  facePaint(figure, rig, p, id);
  figure.finish();
  rig.joints[rig.mouth].scale.y = 0.04;

  root.scale.setScalar(p.size);
  if (seated) {
    for (const { leg, knee, foot } of rig.legs) {
      rig.joints[leg].rotation.x = -1.43;
      rig.joints[knee].rotation.x = 1.48;
      rig.joints[foot].rotation.x = -0.08;
    }
    for (const { arm, elbow, hand, s } of rig.arms) {
      rig.joints[arm].rotation.set(-0.85, 0, -s * 0.24);
      rig.joints[elbow].rotation.x = -0.74;
      rig.joints[hand].rotation.z = -s * 0.10;
    }
  }
  parent.add(root);
  return root;
}

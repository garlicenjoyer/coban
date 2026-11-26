import { CylinderGeometry, DodecahedronGeometry, Group } from 'three';
import { group, Parts } from './model-parts.mjs';
import { crate } from './village-market.mjs';
import { villagerModel } from './villager-models.mjs';
import { villageVehicles } from './village-vehicles.mjs';
import { villageCatModels } from './village-cat-models.mjs';

const charcoal = '#373632';
const iron = '#62645c';

function tractor(parent, name, paint, lightPaint, driver) {
  const root = group(parent, name);
  const metal = new Parts()
    .box([0, 0.51, 0.1], [0.61, 0.19, 2.41], charcoal)
    .box([0, 0.81, 0.57], [0.61, 0.53, 1.39], paint)
    .oval([0, 1.077, 0.59], [0.314, 0.105, 0.709], lightPaint)
    .oval([0, 0.85, 1.262], [0.28, 0.26, 0.065], iron)
    .box([0, 0.53, 1.36], [0.91, 0.13, 0.18], iron)
    .box([0, 0.65, -0.44], [0.93, 0.09, 0.72], iron)
    .box([0, 0.89, -0.56], [0.48, 0.144, 0.39], '#4e3c32')
    .box([0, 1.06, -0.74], [0.48, 0.26, 0.115], '#503e34', [-0.12, 0, 0])
    .rod([0, 0.79, -0.03], [0, 1.27, -0.10], 0.027, 0.025, iron, 8)
    .rod([0.255, 0.85, 0.55], [0.255, 1.55, 0.55], 0.044, 0.032, charcoal, 10)
    .rod([0.255, 1.55, 0.55], [0.255, 1.59, 0.58], 0.032, 0.033, iron, 10)
    .box([0, 0.43, -1.07], [0.55, 0.12, 0.23], iron)
    .rod([-0.24, 0.48, -0.83], [-0.35, 0.34, -1.16], 0.026, 0.019, iron)
    .rod([0.24, 0.48, -0.83], [0.35, 0.34, -1.16], 0.026, 0.019, iron);
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 0.061;
    metal.box([x, 0.846, 1.322], [0.024, 0.29 - Math.abs(i - 3) * 0.037, 0.018], charcoal);
  }
  for (const s of [-1, 1]) {
    metal.box([s * 0.308, 0.94, 0.66], [0.016, 0.048, 0.82], '#d5af73');
    for (let i = 0; i < 5; i++) metal.box([s * 0.312, 0.78, 0.31 + i * 0.085], [0.015, 0.124, 0.023], charcoal);
    metal.oval([s * 0.39, 0.95, 1.14], [0.098, 0.098, 0.090], charcoal);
    metal.oval([s * 0.39, 0.95, 1.217], [0.079, 0.079, 0.030], '#e1ce93');
    metal.torus([s * 0.63, 0.58, -0.72], 0.59, 0.049, lightPaint, [0, Math.PI / 2, 0], [1.06, 1.10, 2.8], 2.9, 24);
    metal.box([s * 0.62, 1.05, -1.02], [0.17, 0.11, 0.17], paint, [0.27, 0, 0]);
    metal.box([s * 0.61, 1.04, -1.11], [0.095, 0.057, 0.024], '#a65342');
    metal.box([s * 0.46, 0.40, -0.21], [0.22, 0.045, 0.35], '#676153');
  }
  if (driver === 'zeynep') {
    metal.rod([-0.35, 0.69, -0.86], [-0.35, 1.99, -0.92], 0.035, 0.035, iron);
    metal.rod([0.35, 0.69, -0.86], [0.35, 1.99, -0.92], 0.035, 0.035, iron);
    metal.rod([-0.35, 1.99, -0.92], [0.35, 1.99, -0.92], 0.035, 0.035, iron);
  }
  metal.mesh(root, 'Bodywork');

  const steering = group(root, 'Steering Wheel', [0, 1.28, -0.10]);
  steering.rotation.order = 'XYZ';
  steering.rotation.x = 1.25;
  const rim = new Parts().torus([0, 0, 0], 0.152, 0.016, charcoal);
  for (const angle of [0, 2.09, 4.19]) {
    rim.rod([0, 0, 0], [Math.cos(angle) * 0.15, Math.sin(angle) * 0.15, 0], 0.013, 0.011, iron, 8);
  }
  rim.oval([0, 0, 0.012], [0.037, 0.036, 0.017], charcoal).mesh(steering, 'Rim and hub');

  for (const [end, z, radius, spread, width] of [['Rear', -0.72, 0.56, 0.63, 0.285], ['Front', 0.98, 0.355, 0.50, 0.18]]) {
    for (const [side, s] of [['Left', -1], ['Right', 1]]) {
      const steering = group(root, `${end} ${side} Axle`, [s * spread, radius, z]);
      const wheel = group(steering, `${end} ${side} Wheel`);
      const rubber = new Parts()
        .torus([0, 0, 0], radius * 0.81, radius * 0.155, charcoal, [0, Math.PI / 2, 0], [1, 1, width / (radius * 0.31)])
        .rod([-width * 0.44, 0, 0], [width * 0.44, 0, 0], radius * 0.67, radius * 0.67, '#a3987f', 16)
        .oval([s * width * 0.44, 0, 0], [0.035, radius * 0.32, radius * 0.32], lightPaint, undefined, 10);
      for (let i = 0; i < 15; i++) {
        const a = i * Math.PI * 2 / 15;
        for (const h of [-1, 1]) {
          const b = a + h * 0.075;
          rubber.box([h * width * 0.23, Math.cos(b) * radius * 0.947, Math.sin(b) * radius * 0.947],
            [width * 0.62, radius * 0.095, radius * 0.122], '#494539', [b, h * 0.39, 0]);
        }
      }
      rubber.mesh(wheel, 'Tread and hub');
    }
  }
  villagerModel(root, 'Driver', driver, true).position.set(0, driver === 'zeynep' ? 0.118 : 0.061, -0.51);
}

function bird(parent, name, hoopoe) {
  const root = group(parent, name);
  const belly = hoopoe ? '#d3a67a' : '#ece0bf';
  const dark = hoopoe ? '#52443b' : '#344b59';
  const back = hoopoe ? '#bd8558' : '#4d6578';
  const factor = hoopoe ? 1 : 0.75;
  root.scale.setScalar(factor);
  const body = group(root, 'Body', [0, 0.125, 0]);
  new Parts()
    .oval([0, 0, 0], [0.061, 0.067, 0.139], (x, y) => y < -0.006 ? belly : back, [-0.19, 0, 0], 12)
    .oval([0, 0.033, 0.073], [0.055, 0.055, 0.063], hoopoe ? belly : '#a35640')
    .mesh(body, 'Plumage');
  const head = group(body, 'Head', [0, 0.07, 0.103]);
  const face = new Parts().oval([0, 0, 0], [0.049, 0.051, 0.054], hoopoe ? '#cc8c5d' : dark);
  face.rod([0, -0.010, 0.04], [0, -0.026, hoopoe ? 0.15 : 0.086], 0.013, 0.004, charcoal, 7);
  if (hoopoe) face.rod([0, -0.026, 0.15], [0, -0.039, 0.18], 0.004, 0.0006, charcoal, 7);
  for (const s of [-1, 1]) face.oval([s * 0.041, 0.009, 0.021], [0.011, 0.013, 0.013], '#392d26', undefined, 8);
  face.mesh(head, 'Bill and eyes');
  if (hoopoe) {
    const crest = group(head, 'Crest', [0, 0.035, -0.007]);
    const feathers = new Parts();
    for (let i = 0; i < 6; i++) {
      const a = 0.15 + i * 0.30;
      const length = 0.05 + i * 0.011;
      feathers.oval([0, Math.cos(a) * length * 0.5, -Math.sin(a) * length * 0.5], [0.008, length * 0.59, 0.013],
        (x, y, z) => Math.hypot(y, z) > length * 0.8 ? dark : '#d39b5e', [-a, 0, 0], 8);
    }
    feathers.mesh(crest, 'Crest feathers');
  }
  for (const [side, s] of [['Left', -1], ['Right', 1]]) {
    const wing = group(body, `${side} Wing`, [s * 0.035, 0.022, 0.022]);
    const feathers = new Parts().oval([s * 0.085, 0.006, -0.027], [0.12, 0.020, 0.067], back, [0, s * 0.2, 0], 12);
    for (let i = 0; i < 7; i++) {
      feathers.oval([s * (0.07 + i * 0.029), -0.001, -0.070 - i * 0.011],
        [0.022, 0.009, (hoopoe ? 0.059 : 0.055) + i * 0.006], (x, y, z) => hoopoe && Math.sin((z - s * x * 0.2) * 82) > 0.18 ? '#e9d7af' : dark,
        [0, -s * (0.21 + i * (hoopoe ? 0.09 : 0.15)), 0], 10);
    }
    feathers.mesh(wing, 'Flight feathers');
  }
  const tail = group(body, 'Tail', [0, 0.004, -0.099]);
  const tailFeathers = new Parts();
  for (const s of [-1, 1]) {
    tailFeathers.oval([s * 0.025, 0, -0.064], [0.026, 0.008, hoopoe ? 0.076 : 0.127],
      (x, y, z) => hoopoe && z < -0.067 && z > -0.092 ? belly : dark, [0, -s * 0.24, 0], 10);
  }
  tailFeathers.mesh(tail, 'Tail feathers');
  new Parts().rod([-0.024, 0.087, 0], [-0.024, 0.013, 0.041], 0.006, 0.004, '#89654f', 6)
    .rod([0.024, 0.087, 0], [0.024, 0.013, 0.041], 0.006, 0.004, '#89654f', 6)
    .rod([-0.024, 0.012, 0.019], [-0.026, 0.011, 0.068], 0.004, 0.002, '#89654f', 6)
    .rod([0.024, 0.012, 0.019], [0.026, 0.011, 0.068], 0.004, 0.002, '#89654f', 6).mesh(root, 'Feet');
}

function mammal(parent, name, fox) {
  const root = group(parent, name);
  const fur = fox ? '#ad613e' : '#8d7054';
  const light = fox ? '#e4c399' : '#c6a782';
  const dark = fox ? '#50392e' : '#685346';
  const body = group(root, 'Body', [0, fox ? 0.46 : 0.24, 0]);
  new Parts()
    .oval([0, 0, 0], fox ? [0.137, 0.145, 0.32] : [0.13, 0.14, 0.223], (x, y) => y < -0.065 ? light : fur)
    .oval([0, 0.012, -0.18], fox ? [0.129, 0.146, 0.159] : [0.157, 0.166, 0.173], fur)
    .oval([0, 0.032, 0.17], fox ? [0.147, 0.147, 0.161] : [0.11, 0.12, 0.135], (x, y) => y < 0 ? light : fur)
    .mesh(body, 'Fur');
  const head = group(body, 'Head', [0, fox ? 0.108 : 0.092, fox ? 0.247 : 0.162]);
  const face = new Parts()
    .oval([0, 0.066, 0.03], fox ? [0.099, 0.085, 0.116] : [0.078, 0.089, 0.107], fur)
    .oval([0, 0.026, 0.104], fox ? [0.076, 0.047, 0.095] : [0.049, 0.040, 0.056], light)
    .oval([0, 0.046, fox ? 0.186 : 0.151], [0.029, 0.021, 0.023], dark);
  for (const s of [-1, 1]) face.oval([s * (fox ? 0.079 : 0.071), 0.081, 0.074], [0.016, 0.016, 0.019], charcoal, undefined, 9);
  face.mesh(head, 'Face');
  for (const [side, s] of [['Left', -1], ['Right', 1]]) {
    const ear = group(head, `${side} Ear`, [s * 0.053, 0.108, 0.0]);
    new Parts()
      .sweep([[0, 0, 0, 0.038, 0.027], [s * 0.008, fox ? 0.082 : 0.096, -0.013, 0.034, 0.021],
        [s * 0.023, fox ? 0.17 : 0.25, -0.028, 0.003, 0.005]], (x, y, z) => y > (fox ? 0.122 : 0.21) ? dark : z > 0 ? '#c29482' : fur, 10, 3, [1, 0, 0]).mesh(ear, 'Ear fur');
    for (const [end, z] of [['Front', fox ? 0.2 : 0.09], ['Rear', fox ? -0.196 : -0.16]]) {
      const leg = group(body, `${end} ${side} Leg`, [s * (end === 'Rear' ? 0.102 : 0.088), -0.029, z]);
      const reach = fox ? 0.397 : 0.176;
      new Parts().oval([0, -reach * 0.26, 0], [end === 'Rear' ? 0.065 : 0.044, reach * 0.40, end === 'Rear' ? 0.071 : 0.044], fur)
        .sweep([[0, -reach * 0.43, 0, 0.035, 0.045], [0, -reach * 0.74, -0.025, 0.024, 0.028],
          [0, -reach * 0.95, 0.012, 0.026, 0.03]], fox ? dark : fur, 8, 2, [1, 0, 0])
        .oval([0, -reach, 0.041], [0.032, 0.025, end === 'Rear' && !fox ? 0.083 : 0.062], fox ? dark : light).mesh(leg, 'Paw');
    }
  }
  const tail = group(body, 'Tail', [0, 0.005, fox ? -0.264 : -0.292]);
  if (fox) {
    new Parts().sweep([[0, 0.015, 0, 0.044, 0.042], [0.014, -0.034, -0.14, 0.088, 0.082],
      [0.042, -0.087, -0.34, 0.092, 0.084], [0.055, -0.092, -0.49, 0.061, 0.058],
      [0.025, -0.069, -0.63, 0.003, 0.005]], (x, y, z) => z < -0.47 ? '#e5ceaa' : y > 0 ? '#8b5036' : fur, 12, 4).mesh(tail, 'Brush');
  } else new Parts().oval([0, 0.027, -0.025], [0.047, 0.061, 0.057], light, [-0.21, 0, 0], 10).mesh(tail, 'Tail fur');
}

function broom(p, base, end) {
  p.rod(base, end, 0.019, 0.014, '#99714e', 8);
  const [x, y, z] = base;
  for (let i = 0; i < 9; i++) {
    const offset = (i - 4) * 0.037;
    p.rod([x + offset * 0.28, y + 0.013, z], [x + offset, y - 0.022, z + 0.21], 0.016, 0.014,
      i % 2 ? '#bc9156' : '#a27c46', 5);
  }
}

function errandProps(parent) {
  const basket = new Parts()
    .add(new CylinderGeometry(0.242, 0.164, 0.19, 18, 1, true), '#ad8250', [0, 0.104, 0])
    .rod([0, 0.012, 0], [0, 0.025, 0], 0.166, 0.17, '#9c7246', 18)
    .oval([0, 0.08, 0], [0.204, 0.046, 0.204], '#755e3b', undefined, 12);
  for (let i = 0; i < 4; i++) basket.torus([0, 0.046 + i * 0.044, 0], 0.175 + i * 0.021, 0.011,
    i % 2 ? '#bc955a' : '#89663d', [Math.PI / 2, 0, 0], [1, 1, 1], Math.PI * 2, 20);
  for (let i = 0; i < 28; i++) {
    const angle = i * 2.39996;
    const r = 0.183 * Math.sqrt(i / 28);
    basket.oval([Math.sin(angle) * r, 0.12 + (i % 4) * 0.008, Math.cos(angle) * r], [0.032, 0.024, 0.019],
      ['#4d4831', '#737946', '#353c27', '#845e47'][i % 4], [0, angle, 0], 7);
  }
  const oliveBasket = group(parent, 'Olive basket');
  basket.mesh(oliveBasket, 'Basket and olives');
  const sortingStand = group(parent, 'Olive sorting stand');
  const stand = new Parts().box([0, 0.62, 0], [0.72, 0.09, 0.46], '#ac8460');
  for (const x of [-0.28, 0.28]) {
    for (const z of [-0.17, 0.17]) stand.rod([x * 1.09, 0.01, z * 1.07], [x, 0.60, z], 0.035, 0.028, '#72583f', 6);
  }
  stand.mesh(sortingStand, 'Olive stand');
  const sortingBasket = oliveBasket.clone();
  sortingBasket.position.y = 0.668;
  sortingStand.add(sortingBasket);

  for (const stacked of [false, true]) {
    const rocks = new Parts();
    for (let i = 0; i < 7; i++) {
      const x = stacked ? (i % 3 - 1) * 0.27 : Math.cos(i * 2.4) * (0.1 + i * 0.058);
      const y = stacked ? 0.087 + Math.floor(i / 3) * 0.145 : 0.055 + (i % 2) * 0.028;
      const z = stacked ? 0 : Math.sin(i * 2.4) * (0.12 + i * 0.053);
      rocks.add(new DodecahedronGeometry(1), i % 2 ? '#a39a81' : '#8c8471', [x, y, z], [0.165, 0.082, 0.125], [0, i * 0.67, 0.07]);
    }
    rocks.mesh(group(parent, stacked ? 'Restacked stones' : 'Loose stones'), 'Terrace stones');
  }

  const cans = new Parts();
  crate(cans, 0, 0, 0, 0.68, 0.45, 0.24);
  for (const x of [-0.16, 0.16]) {
    cans
      .rod([x, 0.06, 0], [x, 0.32, 0], 0.128, 0.123, '#858e87', 14)
      .rod([x, 0.32, 0], [x, 0.39, 0], 0.123, 0.070, '#9ca39a', 14)
      .rod([x, 0.386, 0], [x, 0.418, 0], 0.077, 0.076, '#b6baaa', 14)
      .torus([x, 0.414, 0], 0.043, 0.009, '#636b66', [0, 0, 0]);
  }
  cans.mesh(group(parent, 'Milk can crate'), 'Crate and cans');

  const leaves = new Parts();
  broom(leaves, [0.09, 0.034, -0.27], [-0.27, 0.056, 0.6]);
  for (let i = 0; i < 16; i++) {
    const angle = i * 2.39996;
    const r = i * 0.026;
    leaves.oval([0.20 + Math.sin(angle) * r, 0.02 + (i % 4) * 0.008, 0.08 + Math.cos(angle) * r],
      [0.055, 0.012, 0.022], ['#9f7346', '#b5844c', '#836947'][i % 3], [0.12, angle, 0.10], 6);
  }
  leaves.mesh(group(parent, 'Broom and leaves'), 'Fountain work');
  const brush = new Parts();
  broom(brush, [0, -0.78, 0], [0, 0.27, 0]);
  brush.mesh(group(parent, 'Hand broom'), 'Wood and straw');
  const tea = new Parts()
    .sweep([[0, -0.045, 0, 0.024, 0.024], [0, -0.012, 0, 0.021, 0.021], [0, 0.035, 0, 0.029, 0.029]], '#ae602c', 14, 3)
    .torus([0, 0.036, 0], 0.029, 0.003, '#eac98d', [Math.PI / 2, 0, 0]);
  tea.mesh(group(parent, 'Tea glass'), 'Tea');
}

export function valleyLifeModels() {
  const catalogue = new Group();
  catalogue.name = 'Valley life';
  bird(catalogue, 'Swallow', false);
  bird(catalogue, 'Hoopoe', true);
  mammal(catalogue, 'Hare', false);
  mammal(catalogue, 'Fox', true);
  villageCatModels(catalogue);
  villagerModel(catalogue, 'Ayse', 'ayse');
  villagerModel(catalogue, 'Hasan', 'hasan');
  villagerModel(catalogue, 'Ismail', 'hasan', false, {
    size: 1.02, build: 1.12, face: [0.104, 1.02, 0.8, 0.99, 0.81, 0.005],
    vest: ['#624c41', '#94725b', '#433834'], wrap: '#626b52', wrapLight: '#819273', trim: '#b8ac86',
    shirt: '#a49b80', pants: '#4c5248', grain: 3.1,
  });
  villagerModel(catalogue, 'Riza', 'hasan', false, {
    size: 0.98, build: 0.91, face: [0.087, 1.11, 1.04, 1.19, 0.84, -0.003],
    vest: ['#706447', '#9b8d62', '#4c4435'], wrap: '#514d4d', wrapLight: '#777372', trim: '#a69a86',
    shirt: '#865748', light: '#ad7762', dark: '#593e38', pants: '#474c55', grain: 1.2,
  });
  villagerModel(catalogue, 'Cemal', 'emre', false, {
    size: 1.00, build: 1.07, face: [0.102, 1.08, 0.86, 1.02, 0.91, 0.001],
    shirt: '#637884', light: '#92a3a7', dark: '#454f5a', pants: '#524e4b', hair: '#73655a', grain: 3.85,
  });
  villagerModel(catalogue, 'Emine', 'ayse', false, {
    size: 0.98, build: 1.17, face: [0.1, 1.06, 0.81, 1.0, 1.02, 0.003],
    wrap: '#3e636a', wrapLight: '#729297', trim: '#d4bc8f',
    shirt: '#ad7851', light: '#d7a372', dark: '#835741', pants: '#5c5f4c', grain: 3.0,
  });
  villagerModel(catalogue, 'Nermin', 'zeynep', false, {
    build: 1.01, face: [0.097, 1.02, 0.76, 0.89, 1.01, 0.004],
    vest: ['#694e61', '#967688', '#503c4f'], wrap: '#cec0a2', wrapLight: '#e5d8bf', trim: '#b18062',
    shirt: '#726351', pants: '#56516a', grain: 5.3,
  });
  villagerModel(catalogue, 'Selma', 'ayse', false, {
    size: 0.95, build: 0.98, face: [0.093, 0.99, 0.87, 1.02, 1.04, -0.002],
    wrap: '#c1a15d', wrapLight: '#dfba78', trim: '#795c5b',
    shirt: '#537343', light: '#829267', dark: '#424f3d', pants: '#4a5454', grain: 1.34,
  });
  tractor(catalogue, 'Rust Tractor', '#9f5340', '#bf7955', 'emre');
  tractor(catalogue, 'Blue Tractor', '#537b87', '#779897', 'zeynep');
  villageVehicles(catalogue);
  errandProps(catalogue);
  return catalogue;
}

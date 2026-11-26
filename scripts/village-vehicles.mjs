import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshStandardMaterial } from 'three';
import { group, Parts } from './model-parts.mjs';
import { villagerModel } from './villager-models.mjs';

const glass = new MeshStandardMaterial({ color: '#b6d1cd', transparent: true, opacity: 0.19,
  roughness: 0.23, side: DoubleSide, depthWrite: false });

function windscreen(root, width, roof, baseZ, topZ) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    -width * 0.97, 0.97, baseZ, width * 0.97, 0.97, baseZ,
    width * 0.88, roof, topZ, -width * 0.88, roof, topZ,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const pane = new Mesh(geometry, glass);
  pane.name = 'Windscreen';
  pane.userData.vehicleGlass = true;
  root.add(pane);
}

// Open side windows keep the driver visible from the road and from the chase camera.
function roadVehicle(parent, name, van, paint, stripe, driver, shirt) {
  const root = group(parent, name);
  const half = van ? 2.12 : 1.90;
  const width = van ? 0.91 : 0.84;
  const roof = van ? 1.98 : 1.77;
  const seatZ = van ? 0.68 : 0;
  const trim = '#383d3c', chrome = '#aaa99b', seat = '#514a41';
  const body = new Parts()
    .box([0, 0.56, 0], [width * 2, 0.42, half * 2], paint)
    .box([0, 0.78, half - 0.38], [width * 1.98, 0.22, 0.78], paint)
    .box([0, 0.69, 0], [1.45, 0.12, 2.4], trim)
    .box([0, 0.90, seatZ + 0.48], [1.5, 0.13, 0.31], trim)
    .box([0, roof, van ? -0.43 : -0.24], [width * 1.82, 0.10, van ? 3.34 : 1.67], van ? '#e4dacc' : paint);
  if (van) {
    body.box([0, 1.32, -0.98], [width * 1.99, 1.26, 2.28], paint);
    for (const s of [-1, 1]) {
      body.box([s * 0.445, 1.35, -half - 0.009], [0.86, 1.04, 0.034], paint)
        .box([s * 0.44, 1.56, -half - 0.035], [0.70, 0.40, 0.022], '#455957')
        .box([s * 0.12, 1.17, -half - 0.038], [0.12, 0.033, 0.04], trim)
        .box([s * width, 1.29, -1.02], [0.025, 0.18, 2.13], stripe);
      for (let i = 0; i < 3; i++) body.box([s * (width + 0.003), 1.68, -1.60 + i * 0.12], [0.026, 0.14, 0.04], chrome);
    }
  } else {
    body.box([0, 0.80, -1.44], [width * 1.98, 0.20, 0.90], paint);
    body.box([0, 0.89, -0.79], [1.41, 0.25, 0.23], seat);
  }
  for (const s of [-1, 1]) {
    const side = s * width;
    body.box([side * 0.96, 0.84, seatZ - 0.04], [0.085, 0.39, van ? 1.47 : 2.40], paint)
      .box([side, 0.71, 0], [0.035, 0.045, half * 1.92], stripe)
      .rod([side * 0.97, 0.97, seatZ + 0.90], [side * 0.88, roof, seatZ + 0.55], 0.055, 0.048, paint, 6)
      .rod([side * 0.97, 0.97, van ? 0.11 : -1.29], [side * 0.88, roof, van ? 0.14 : -1.01], 0.071, 0.055, paint, 6)
      .box([side, 0.95, seatZ - 0.18], [0.045, 0.045, 0.17], chrome)
      .box([s * (width + 0.09), 1.13, seatZ + 0.52], [0.18, 0.11, 0.16], trim)
      .box([s * 0.38, 0.65, seatZ], [0.53, 0.18, 0.50], seat)
      .box([s * 0.38, 0.85, seatZ - 0.22], [0.53, 0.46, 0.12], seat, [-0.12, 0, 0])
      .box([s * width * 0.76, 0.74, half + 0.015], [0.32, 0.155, 0.041], '#efddb0')
      .box([s * width * 0.79, 0.71, -half - 0.025], [0.23, 0.16, 0.06], '#ae4b37');
    if (!van) body.box([side * 0.93, (roof + 0.97) / 2, -0.24], [0.063, roof - 0.97, 0.082], trim);
  }
  for (const s of [-1, 1]) {
    body.box([0, 0.47, s * half], [width * 2.03, 0.13, 0.16], trim)
      .box([0, 0.55, s * (half + 0.085)], [0.39, 0.10, 0.019], '#dfd8bf');
  }
  for (let i = 0; i < 3; i++) body.box([0, 0.68 + i * 0.044, half + 0.026], [0.77, 0.022, 0.018], chrome);
  body.mesh(root, 'Coachwork');
  windscreen(root, width, roof, seatZ + 0.90, seatZ + 0.55);
  if (!van) windscreen(root, width, roof, -1.29, -1.01);
  const steering = group(root, 'Steering Wheel', [0.38, van ? 1.25 : 1.07, seatZ + 0.42]);
  steering.rotation.x = 1.25;
  new Parts().torus([0, 0, 0], 0.152, 0.017, trim).box([0, 0, 0], [0.28, 0.038, 0.024], trim).mesh(steering, 'Rim');
  const radius = van ? 0.36 : 0.31;
  for (const [end, z] of [['Front', half - 0.68], ['Rear', -half + 0.67]]) {
    for (const [side, sign] of [['Left', -1], ['Right', 1]]) {
      const axle = group(root, end + ' ' + side + ' Axle', [sign * (width - 0.046), radius, z]);
      const wheel = group(axle, end + ' ' + side + ' Wheel');
      const hub = new Parts().rod([-0.11, 0, 0], [0.11, 0, 0], radius, radius, trim, 20)
        .rod([sign * 0.11, 0, 0], [sign * 0.125, 0, 0], radius * 0.68, radius * 0.64, chrome, 16);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        hub.oval([sign * 0.13, radius * 0.42 * Math.sin(a), radius * 0.42 * Math.cos(a)], [0.006, 0.029, 0.029], trim);
      }
      hub.mesh(wheel, 'Tyre and hubcap');
    }
  }
  villagerModel(root, 'Driver', driver, true, { shirt }).position.set(0.38, van ? 0.01 : -0.17, seatZ);
}

export function villageVehicles(parent) {
  roadVehicle(parent, 'Terracotta Saloon', false, '#b9684f', '#d5ba94', 'emre', '#677e88');
  roadVehicle(parent, 'Seafoam Saloon', false, '#7eaba0', '#e3cda9', 'zeynep', '#885b66');
  roadVehicle(parent, 'Bakery Van', true, '#ddc69a', '#aa6645', 'hasan', '#78885c');
  roadVehicle(parent, 'Market Van', true, '#7b9da6', '#e1bc79', 'ayse', '#9a7257');
}

import { Color, MathUtils } from 'three';
import { group, Parts } from './model-parts.mjs';

const { smoothstep } = MathUtils;
const soot = '#332c28';
const nose = '#8d5954';
const cream = new Color('#e8d5b4');

function ginger(x, y, z) {
  const lighter = smoothstep(-y, 0.016, 0.082);
  const stripes = (0.5 + 0.5 * Math.cos(z * 54 + Math.abs(x) * 17 - y * 19)) ** 7;
  return new Color('#b76c3e').lerp(cream, lighter * 0.73).lerp(new Color('#855037'), stripes * 0.61 * (1 - lighter));
}

function calico(x, y, z) {
  const patch = Math.sin(x * 24 + z * 17 - y * 11) * 0.64 + Math.cos(z * 22 + y * 26) * 0.38;
  const awayFromBelly = 1 - smoothstep(-y, 0.040, 0.075);
  return cream.clone()
    .lerp(new Color('#ba7848'), smoothstep(patch, 0.15, 0.26) * awayFromBelly)
    .lerp(new Color('#4e423a'), smoothstep(-patch, 0.19, 0.31) * awayFromBelly);
}

function grey(x, y, z) {
  const tabby = (0.5 + 0.5 * Math.cos(z * 62 + x * 14 + y * 21)) ** 8;
  return new Color('#78807d').lerp(new Color('#525855'), tabby * 0.53)
    .lerp(new Color('#ded9c8'), smoothstep(-y + z * 0.16, 0.038, 0.091) * 0.95);
}

function legs(root, fur) {
  for (let i = 0; i < 4; i++) {
    const front = i < 2, sign = i % 2 === 0 ? -1 : 1;
    const z = front ? 0.126 : -0.142;
    const upper = group(root, `Leg ${i}`, [sign * (front ? 0.054 : 0.065), 0.214, z]);
    const elbow = group(upper, `Lower ${i}`, [0, front ? -0.104 : -0.110, front ? -0.019 : 0.034]);
    const paw = group(elbow, `Paw ${i}`, [0, front ? -0.090 : -0.084, front ? 0.025 : -0.024]);
    group(paw, `Sole ${i}`, [0, -0.020, 0.017]);
    const legFur = (x, y, localZ) => fur(x + sign * 0.04, y - 0.031, localZ + z);
    const foot = (x, y, localZ) => fur(x + sign * 0.045, y - 0.071, localZ + z);
    new Parts()
      .oval([0, front ? -0.027 : -0.023, 0], [front ? 0.028 : 0.046, front ? 0.073 : 0.078, front ? 0.036 : 0.053],
        legFur, [front ? 0.08 : -0.30, 0, 0], 14)
      .oval([0, elbow.position.y + 0.014, elbow.position.z], [0.021, 0.028, 0.024], foot, undefined, 12)
      .mesh(upper, 'Shoulder and thigh');
    new Parts()
      .sweep([[0, 0.014, 0, 0.017, 0.019], [0, -0.007, 0, 0.021, 0.022],
        [0, -0.043, front ? 0.006 : -0.015, 0.017, 0.019],
        [0, paw.position.y - 0.005, paw.position.z + 0.007, 0.013, 0.015]], foot, 12, 3, [1, 0, 0])
      .mesh(elbow, 'Ankle');
    new Parts()
      .oval([0, -0.003, 0.015], [front ? 0.023 : 0.025, 0.017, front ? 0.034 : 0.039], foot, undefined, 13)
      .mesh(paw, 'Paw fur');
  }
}

function face(body, fur, eyeColor) {
  const head = group(body, 'Head', [0, 0.045, 0.182]);
  const mask = (x, y, z) => fur(x, y * 1.4 - 0.011, z + 0.18);
  const features = new Parts().oval([0, 0.024, 0.022], [0.073, 0.066, 0.082], mask, [-0.10, 0, 0], 22)
    .oval([0, -0.022, 0.068], [0.044, 0.031, 0.039], (x, y, z) => mask(x, y - 0.047, z), undefined, 17)
    .oval([0, 0.003, 0.108], [0.018, 0.010, 0.009], nose, [-0.24, 0, 0], 12);
  const eyes = group(head, 'Open eyes');
  const eyelids = group(head, 'Closed eyes');
  const eye = new Parts(), shut = new Parts();
  for (const sign of [-1, 1]) {
    features.oval([sign * 0.022, -0.010, 0.095], [0.023, 0.018, 0.021], (x, y, z) => mask(x, y - 0.071, z), undefined, 16);
    for (let whisker = 0; whisker < 3; whisker++) {
      const end = [sign * (0.085 + whisker * 0.006), -0.019 + whisker * 0.013, 0.102 - whisker * 0.013];
      features.rod([sign * 0.025, -0.013, 0.11], end, 0.00135, 0.00045, '#c1ad95', 5);
    }

    const rotation = [0, sign * 0.34, sign * -0.14];
    eye.oval([sign * 0.048, 0.026, 0.085], [0.024, 0.014, 0.010], soot, rotation, 14)
      .oval([sign * 0.049, 0.026, 0.091], [0.017, 0.009, 0.009], eyeColor, rotation, 14)
      .oval([sign * 0.050, 0.026, 0.098], [0.0034, 0.009, 0.0027], soot, rotation, 10);
    shut.rod([sign * 0.030, 0.028, 0.096], [sign * 0.047, 0.019, 0.096], 0.0024, 0.0026, '#534339', 6)
      .rod([sign * 0.047, 0.019, 0.096], [sign * 0.067, 0.026, 0.087], 0.0026, 0.0016, '#534339', 6);

    const ear = group(head, sign < 0 ? 'Ear left' : 'Ear right', [sign * 0.045, 0.062, 0.012]);
    new Parts().sweep([[0, 0, 0, 0.030, 0.022], [sign * 0.006, 0.032, -0.004, 0.018, 0.012],
      [sign * 0.017, 0.065, -0.010, 0.0015, 0.002]], (x, y, z) => z > 0.004 && y > 0.008 && y < 0.053
      ? '#b78272' : mask(sign * 0.052 + x, y + 0.047, z - 0.013), 10, 3, [1, 0, 0]).mesh(ear, 'Ear fur');
  }
  features.mesh(head, 'Face fur and whiskers');
  eye.mesh(eyes, 'Painted eyes');
  shut.mesh(eyelids, 'Sleeping eyelids');
}

function tail(body, fur) {
  const lengths = [0.081, 0.080, 0.075, 0.068, 0.053];
  const widths = [0.028, 0.024, 0.022, 0.018, 0.012, 0.003];
  let parent = body;
  let distance = 0;
  for (const [i, length] of lengths.entries()) {
    const part = group(parent, `Tail ${i}`, [0, i ? 0 : 0.033, i ? -lengths[i - 1] : -0.193]);
    const color = (x, y, z) => fur(x, y + 0.052, z - 0.23 - distance);
    new Parts().sweep([[0, 0, 0.005, widths[i], widths[i]], [0, 0, -length / 2, widths[i] * 0.99, widths[i]],
      [0, 0, -length - 0.003, widths[i + 1], widths[i + 1]]], color, 11, 3, [1, 0, 0]).mesh(part, 'Tail fur');
    parent = part;
    distance += length;
  }
}

export function villageCatModels(catalogue) {
  for (const [name, fur, eyes, size] of [
    ['Ginger', ginger, '#ab9257', 1.09], ['Calico', calico, '#909067', 0.96], ['Grey', grey, '#b5a267', 1.02],
  ]) {
    const root = group(catalogue, `Village Cat ${name}`);
    root.scale.setScalar(size);
    const body = group(root, 'Body', [0, 0.231, 0]);
    new Parts()
      .oval([0, 0.003, -0.014], [0.077, 0.087, 0.212], fur, undefined, 22)
      .oval([0, 0.013, -0.133], [0.092, 0.097, 0.112], fur, [0.15, 0, 0], 19)
      .oval([0, -0.010, 0.104], [0.077, 0.101, 0.124], fur, [-0.15, 0, 0], 19)
      .mesh(body, 'Painted coat');
    legs(root, fur);
    face(body, fur, eyes);
    tail(body, fur);
  }
}

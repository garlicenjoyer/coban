import { MathUtils } from 'three';
import type { ResidentId } from '../world/mapTypes';
import type { ResidentGesture } from './dialogue';
import { workCycle, type WorkPose } from './residentWork';

const { lerp, smoothstep } = MathUtils;

// Additive rotations over the walking or seated base, in radians.
export interface GesturePose {
  bow?: number;
  twist?: number;
  tilt?: number;
  nod?: number;
  look?: number;
  left?: number;
  right?: number;
  leftOut?: number;
  rightOut?: number;
  leftBend?: number;
  rightBend?: number;
  wrist?: number;
  release?: number;
}

type Key = [seconds: number, pose: GesturePose];
type Clip = readonly Key[];

function sample(clip: Clip, time: number, loop = false): GesturePose {
  const end = clip[clip.length - 1][0];
  const t = loop ? time % end : time;
  if (t < 0 || t >= end) return {};
  const i = clip.findIndex(([at]) => at > t);
  const [start, a] = clip[i - 1], [finish, b] = clip[i];
  const ease = smoothstep(t, start, finish);
  const blended: GesturePose = {};
  const channels = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof GesturePose)[]);
  for (const key of channels) blended[key] = lerp(a[key] ?? 0, b[key] ?? 0, ease);
  return blended;
}

const welcome: Record<ResidentId, Clip> = {
  ayse: [
    [0, {}], [0.27, { right: -0.47, rightOut: 0.88, rightBend: -0.91, nod: 0.10, tilt: -0.04 }],
    [0.48, { right: -0.65, rightOut: 1.28, rightBend: -1.24, wrist: 0.40, nod: -0.06 }],
    [0.64, { right: -0.63, rightOut: 1.25, rightBend: -1.16, wrist: -0.22 }],
    [0.81, { right: -0.62, rightOut: 1.13, rightBend: -0.94, wrist: 0.34 }],
    [1.13, { right: -0.31, rightOut: 0.34, rightBend: -0.55, nod: 0.08 }], [1.56, {}],
  ],
  hasan: [
    [0, {}], [0.34, { bow: 0.10, nod: 0.16, right: -0.56, rightOut: 0.14, rightBend: -1.10, wrist: -0.32 }],
    [0.66, { bow: 0.19, nod: 0.24, right: -0.61, rightOut: 0.11, rightBend: -1.19, wrist: -0.40 }],
    [0.94, { bow: 0.04, nod: -0.03, right: -0.36, rightBend: -0.77, left: -0.16 }], [1.55, {}],
  ],
  emre: [
    [0, {}], [0.27, { nod: -0.07, tilt: -0.05, right: -0.41, rightOut: 0.32, rightBend: -0.53, release: 1 }],
    [0.47, { nod: 0.21, rightOut: 0.62, rightBend: -0.72, wrist: -0.14, release: 1 }],
    [0.76, { nod: 0.07, rightOut: 0.31, rightBend: -0.40, release: 0.82 }], [1.18, {}],
  ],
  zeynep: [
    [0, {}], [0.24, { tilt: 0.12, nod: 0.10, rightOut: 0.44, rightBend: -0.49, release: 1 }],
    [0.49, { twist: -0.13, rightOut: 0.75, rightBend: -0.47, right: 0.08, wrist: 0.62, release: 1 }],
    [0.78, { twist: -0.07, rightOut: 0.32, rightBend: -0.27, wrist: -0.12, release: 0.7 }], [1.22, {}],
  ],
};

const explain: Record<ResidentId, Clip> = {
  ayse: [
    [0, {}], [0.28, { bow: 0.08, right: -0.56, rightBend: -0.88, left: -0.38, leftBend: -0.62 }],
    [0.72, { twist: -0.16, right: -0.73, rightOut: 0.52, rightBend: -0.42, left: -0.62, leftOut: 0.42, leftBend: -0.54, nod: 0.12 }],
    [1.08, { right: -0.53, rightOut: 0.44, rightBend: -0.71, left: -0.46, leftOut: 0.26, leftBend: -0.60, wrist: 0.22 }],
    [1.48, { nod: 0.18, right: -0.28, rightBend: -0.41 }], [1.95, {}],
  ],
  hasan: [
    [0, {}], [0.42, { bow: 0.13, nod: 0.21, left: -0.46, leftBend: -0.87, right: -0.33, rightBend: -0.72 }],
    [0.85, { twist: 0.22, look: -0.27, left: -0.82, leftOut: 0.76, leftBend: -0.34, right: -0.38, rightBend: -0.65 }],
    [1.26, { twist: 0.09, nod: -0.05, left: -0.56, leftOut: 0.58, leftBend: -0.63 }],
    [1.70, { bow: 0.09, nod: 0.19 }], [2.15, {}],
  ],
  emre: [
    [0, {}], [0.29, { twist: -0.22, rightOut: 0.41, rightBend: -0.43, release: 1 }],
    [0.64, { twist: -0.31, look: -0.56, right: -0.46, rightOut: 0.69, rightBend: 0.29, release: 1 }],
    [0.96, { twist: -0.18, look: -0.25, right: -0.30, rightOut: 0.66, rightBend: 0.26, wrist: 0.22, release: 1 }],
    [1.36, { nod: 0.15, rightOut: 0.27, rightBend: -0.15, release: 0.62 }], [1.85, {}],
  ],
  zeynep: [
    [0, {}], [0.26, { bow: 0.09, nod: 0.12, rightOut: 0.31, rightBend: -0.67, release: 1 }],
    [0.59, { twist: 0.21, look: 0.19, right: -0.49, rightOut: 0.38, rightBend: -0.28, wrist: 0.54, release: 1 }],
    [0.94, { twist: 0.11, right: -0.31, rightOut: 0.53, rightBend: -0.11, wrist: -0.19, release: 1 }],
    [1.32, { tilt: 0.07, nod: 0.14, rightOut: 0.15, rightBend: -0.37, release: 0.66 }], [1.72, {}],
  ],
};

const sort: Clip = [
  [0, { bow: 0.21, nod: 0.30, left: -0.33, right: -0.39, rightBend: -0.27, leftBend: -0.43 }],
  [0.56, { bow: 0.46, nod: 0.52, right: -0.72, rightBend: -0.21, left: -0.68, leftBend: -0.19, twist: -0.11 }],
  [1.02, { bow: 0.37, nod: 0.54, right: -0.65, rightBend: -0.53, left: -0.58, leftBend: -0.42, wrist: 0.43 }],
  [1.66, { bow: 0.18, nod: 0.40, right: -0.63, rightBend: -1.13, left: -0.54, leftBend: -0.42, wrist: -0.28 }],
  [2.28, { bow: 0.29, twist: 0.24, nod: 0.45, right: -0.58, rightOut: 0.25, rightBend: -0.54, left: -0.38, leftBend: -0.55 }],
  [2.78, { bow: 0.42, nod: 0.53, right: -0.69, rightOut: 0.39, rightBend: -0.17, left: -0.37, leftBend: -0.52, wrist: 0.26 }],
  [3.44, { bow: 0.24, nod: 0.36, right: -0.31, rightBend: -0.30, left: -0.30, leftBend: -0.42 }],
  [workCycle.sort, { bow: 0.21, nod: 0.30, left: -0.33, right: -0.39, rightBend: -0.27, leftBend: -0.43 }],
];

const sweepBase = { bow: 0.17, nod: 0.28, right: -0.27, rightOut: 0.22, rightBend: -0.42, left: -0.39, leftBend: -0.43 };
const sweep: Clip = [
  [0, sweepBase],
  [0.42, { ...sweepBase, bow: 0.22, twist: -0.25, rightOut: 0.39, nod: 0.35, wrist: -0.29 }],
  [1.10, { ...sweepBase, bow: 0.31, twist: 0.25, right: -0.46, rightOut: 0.07, wrist: 0.32 }],
  [1.42, { ...sweepBase, bow: 0.18, twist: 0.19, wrist: 0.20 }],
  [1.78, sweepBase],
  [2.0, { ...sweepBase, bow: 0.235, twist: -0.23, rightOut: 0.39, nod: 0.33, wrist: -0.27 }],
  [2.71, { ...sweepBase, bow: 0.29, twist: 0.26, right: -0.46, rightOut: 0.11, wrist: 0.38 }],
  [3.08, { ...sweepBase, bow: 0.13, nod: 0.1, wrist: 0.12 }],
  [workCycle.sweep, sweepBase],
];

const tea: Clip = [
  [0, { right: -0.22, rightBend: -0.70 }], [1.05, { right: -0.41, rightBend: -0.90, look: 0.20 }],
  [1.72, { right: -0.76, rightBend: -1.64, tilt: -0.085, nod: 0.15, wrist: -0.23 }],
  [2.36, { right: -0.77, rightBend: -1.70, tilt: -0.10, nod: 0.10, wrist: -0.34 }],
  [2.98, { right: -0.35, rightBend: -0.97, nod: 0.17, wrist: -0.11 }],
  [4.01, { right: -0.25, rightBend: -0.76, look: -0.22 }], [workCycle.tea, { right: -0.22, rightBend: -0.70 }],
];

const check: Record<'emre' | 'zeynep', Clip> = {
  emre: [
    [0, {}], [0.65, { bow: 0.19, twist: -0.28, look: -0.48, nod: 0.37, right: 0.44, rightOut: 0.16, release: 1 }],
    [1.81, { bow: 0.26, twist: -0.33, look: -0.59, nod: 0.54, right: 0.56, rightOut: 0.27, release: 1 }],
    [2.62, { twist: -0.17, look: -0.25, nod: 0.21, right: 0.22, release: 0.5 }],
    [3.28, {}], [workCycle.emre, {}],
  ],
  zeynep: [
    [0, {}], [0.88, { twist: -0.37, look: -0.52, tilt: 0.08, right: 0.50, rightOut: 0.26, rightBend: 0.36, release: 1 }],
    [1.64, { twist: -0.58, look: -0.75, nod: 0.21, right: 0.74, rightOut: 0.34, rightBend: 0.38, release: 1 }],
    [2.18, { twist: -0.51, look: -0.63, nod: 0.10, right: 0.56, rightOut: 0.38, release: 1 }],
    [3.26, { twist: 0.19, look: 0.23, nod: 0.21, right: 0.12, release: 0.32 }], [4, {}], [workCycle.zeynep, {}],
  ],
};

export function residentGesture(id: ResidentId, cue: ResidentGesture, age: number): GesturePose {
  if (cue === 'greet') return sample(welcome[id], age);
  if (cue === 'thank') return sample(welcome[id], age * 1.20);
  if (cue === 'farewell') return sample(welcome[id], age * 1.85);
  return sample(explain[id], age * (cue === 'offer' ? 0.84 : 1));
}

export function residentWork(id: ResidentId, work: WorkPose, elapsed: number): GesturePose {
  if (work === 'sort') return sample(sort, elapsed, true);
  if (work === 'sweep') return sample(sweep, elapsed, true);
  if (work === 'tea') return sample(tea, elapsed, true);
  return id === 'emre' || id === 'zeynep' ? sample(check[id], elapsed, true) : {};
}

const blinkPeriod: Record<ResidentId, number> = { ayse: 4.4, hasan: 5.3, emre: 3.9, zeynep: 4.8 };

export function residentFace(id: ResidentId, time: number, lineAge: number, speaking: boolean): { eyes: number; mouth: number } {
  const cycle = ((time + blinkPeriod[id] * 0.57) % blinkPeriod[id]);
  const blink = smoothstep(cycle, 0, 0.058) * (1 - smoothstep(cycle, 0.073, 0.183));
  const rhythm = speaking ? Math.sin(lineAge * 22) * 0.23 + Math.sin(lineAge * 13.2 + 0.3) * 0.35 : 0;
  return { eyes: lerp(1, 0.07, blink), mouth: speaking ? smoothstep(lineAge, 0, 0.16) * Math.max(0.05, 0.35 + rhythm) : 0.04 };
}

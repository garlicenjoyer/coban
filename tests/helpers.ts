import { campaignDay } from './campaignFixture';
import RAPIER from '@dimforge/rapier3d-compat';
import { emptyFrame, type InputFrame } from '../src/core/input';
import { Mode } from '../src/flock/sheep';
import { Sim } from '../src/sim';
import { buildTerrain } from '../src/world/testMap';

export const terrain = buildTerrain();

let ready: Promise<void> | null = null;
export const initRapier = () => (ready ??= RAPIER.init());

export const newSim = () => new Sim(RAPIER, terrain, campaignDay);

/** Camera yaw that makes "forward" point from (x0,z0) toward (x1,z1). */
export const yawToward = (x0: number, z0: number, x1: number, z1: number) => Math.atan2(-(x1 - x0), -(z1 - z0));

export function run(sim: Sim, frames: number, make: (i: number) => InputFrame = () => emptyFrame()) {
  for (let i = 0; i < frames; i++) sim.step(make(i));
}

/** Put the whole flock on a loose grid around (cx, cz), calm and grazing. */
export function placeFlock(sim: Sim, cx: number, cz: number, spacing = 1.8) {
  const cols = 6;
  sim.flock.sheep.forEach((s, i) => {
    const x = cx + ((i % cols) - (cols - 1) / 2) * spacing;
    const z = cz + (Math.floor(i / cols) - 1.5) * spacing;
    s.x = s.px = x;
    s.z = s.pz = z;
    s.y = s.py = sim.terrain.heightAt(x, z);
    s.vx = s.vz = 0;
    s.inPen = false;
    s.mode = Mode.Graze;
    s.stress = 0;
    s.isStray = false;
    s.strayTimer = 0;
  });
}

export function centroid(sim: Sim) {
  let x = 0;
  let z = 0;
  for (const s of sim.flock.sheep) {
    x += s.x;
    z += s.z;
  }
  const n = sim.flock.sheep.length;
  return { x: x / n, z: z / n };
}

export function spread(sim: Sim) {
  const c = centroid(sim);
  return Math.max(...sim.flock.sheep.map((s) => Math.hypot(s.x - c.x, s.z - c.z)));
}

export function minPairDistance(sim: Sim) {
  let min = Infinity;
  const sh = sim.flock.sheep;
  for (let i = 0; i < sh.length; i++)
    for (let j = i + 1; j < sh.length; j++) min = Math.min(min, Math.hypot(sh[i].x - sh[j].x, sh[i].z - sh[j].z));
  return min;
}

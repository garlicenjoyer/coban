// Frame-rate check (GDD feature 4: "frame rate checked on a real screen"). A fixed tour of
// the map's heaviest views: at each spot the shepherd stands still, the camera looks the
// same way, and after a short warm-up (shader compiles, shadow maps) we record frame
// times, CPU time in the sim and in rendering, and draw calls and triangles.
//
// Run it from the debug panel (Performance → Run frame-rate check) on a visible window:
// a hidden tab is throttled by the browser and its numbers mean nothing.

import type * as THREE from 'three';
import type { CameraRig } from '../player/camera';
import type { Sim } from '../sim';
import { layout } from '../world/map';

/** CPU time per frame, written by the main loop; `lap` splits the render callback while profiling. */
export const perf = {
  simMs: 0,
  renderMs: 0,
  profiling: false,
  sections: new Map<string, number>(),
  last: 0,
  /** Start timing a frame's render callback. */
  start(): void {
    if (this.profiling) this.last = performance.now();
  },
  /** Charge the time since the previous lap to `name`. */
  lap(name: string): void {
    if (!this.profiling) return;
    const now = performance.now();
    this.sections.set(name, (this.sections.get(name) ?? 0) + now - this.last);
    this.last = now;
  },
};

export interface BenchSpot {
  name: string;
  /** Where the shepherd stands. */
  x: number;
  z: number;
  /** What the camera looks toward. */
  look: { x: number; z: number };
  /** Camera pitch, degrees (higher looks further down). */
  pitchDeg?: number;
}

export interface BenchResult {
  spot: string;
  fps: number;
  medianMs: number;
  p95Ms: number;
  worstMs: number;
  simMs: number;
  renderMs: number;
  calls: number;
  triangles: number;
  /** The worst frame of the warm-up (first sight of the spot: shader compiles, uploads). */
  warmupWorstMs: number;
  /** The render callback's three biggest costs, ms per frame. */
  top: string;
}

/** The spots worth checking on the active map, from its layout. */
export function benchSpots(): BenchSpot[] {
  const L = layout;
  const pen = L.pen;
  const gate = { x: pen.x + pen.hx, z: pen.z };
  const h = L.house;
  const spots: BenchSpot[] = [
    { name: 'ağıl and flock', x: gate.x + 9, z: gate.z - 4, look: { x: pen.x, z: pen.z } },
    { name: 'cottage yard', x: h.x - 2, z: h.z - h.hz - 7, look: { x: h.x, z: h.z } },
    { name: 'lookout over the valley', x: L.hill.x, z: L.hill.z, look: { x: pen.x, z: pen.z }, pitchDeg: 12 },
    { name: 'pasture A', x: L.pastures[0].x + 8, z: L.pastures[0].z + 8, look: { x: L.pastures[0].x, z: L.pastures[0].z } },
    { name: 'forest edge', x: L.pastures[4]?.x ?? L.wolfDen.x, z: (L.pastures[4]?.z ?? L.wolfDen.z) + 10, look: L.wolfDen },
    { name: 'the ruins', x: L.ruins.x + 10, z: L.ruins.z + 10, look: { x: L.ruins.x, z: L.ruins.z } },
  ];
  if (L.village) spots.push({ name: 'village square', x: L.village.x, z: L.village.z + 10, look: { x: L.village.x, z: L.village.z - 30 } });
  return spots;
}

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export class Bench {
  running = false;
  status = 'not run';
  results: BenchResult[] = [];

  constructor(
    private sim: () => Sim,
    private rig: CameraRig,
    private renderer: THREE.WebGLRenderer,
  ) {}

  async run(warmup = 1.5, measure = 4): Promise<BenchResult[]> {
    if (this.running) return this.results;
    this.running = true;
    this.results = [];
    const sim = this.sim();
    const info = this.renderer.info;
    const tasks = sim.tasks.enabled;
    sim.tasks.enabled = false;
    const hour = sim.hour;
    info.autoReset = false;
    try {
      for (const spot of benchSpots()) {
        this.status = `measuring ${spot.name}…`;
        sim.teleport(spot.x, spot.z);
        const aim = () => {
          sim.hour = 10; // same light everywhere: mid-morning, long shadows off
          const p = sim.player.pos;
          this.rig.yaw = Math.atan2(-(spot.look.x - p.x), -(spot.look.z - p.z));
          this.rig.pitch = ((spot.pitchDeg ?? 18) * Math.PI) / 180;
        };
        let last = await frame();
        let warmupWorst = 0;
        for (let t = 0; t < warmup; ) {
          aim();
          const now = await frame();
          const dt = now - last;
          last = now;
          warmupWorst = Math.max(warmupWorst, dt);
          t += dt / 1000;
          info.reset();
        }
        const dts: number[] = [];
        perf.sections.clear();
        perf.profiling = true;
        let sims = 0;
        let renders = 0;
        let calls = 0;
        let tris = 0;
        for (let t = 0; t < measure; ) {
          aim();
          info.reset();
          const now = await frame();
          const dt = now - last;
          last = now;
          dts.push(dt);
          sims += perf.simMs;
          renders += perf.renderMs;
          calls += info.render.calls;
          tris += info.render.triangles;
          t += dt / 1000;
        }
        perf.profiling = false;
        const n = dts.length;
        const median = quantile(dts, 0.5);
        const top = [...perf.sections]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => `${k} ${(v / n).toFixed(2)}`)
          .join(', ');
        this.results.push({
          spot: spot.name,
          fps: Math.round(1000 / median),
          medianMs: +median.toFixed(1),
          p95Ms: +quantile(dts, 0.95).toFixed(1),
          worstMs: +Math.max(...dts).toFixed(1),
          simMs: +(sims / n).toFixed(2),
          renderMs: +(renders / n).toFixed(2),
          calls: Math.round(calls / n),
          triangles: Math.round(tris / n),
          warmupWorstMs: +warmupWorst.toFixed(0),
          top,
        });
      }
    } finally {
      perf.profiling = false;
      info.autoReset = true;
      sim.hour = hour;
      sim.tasks.enabled = tasks;
      this.running = false;
    }
    const worst = this.results.reduce((a, r) => (r.p95Ms > a.p95Ms ? r : a), this.results[0]);
    this.status = `done · slowest: ${worst.spot}, ${worst.fps} fps median, p95 ${worst.p95Ms} ms`;
    console.table(this.results);
    console.info('[frame-rate check]', JSON.stringify({ size: [this.renderer.domElement.width, this.renderer.domElement.height], pixelRatio: this.renderer.getPixelRatio(), results: this.results }));
    return this.results;
  }
}

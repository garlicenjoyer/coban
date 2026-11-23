// Lap timer for the gravel loop (M4 acceptance: a lap in under 2 minutes without falling).
// Progress is measured as the angle swept around the loop's ellipse; leaving the road by
// more than 12 m cancels the lap. The start/finish line is where the pen's spur track joins.

import { layout } from '../world/map';

/** Approximate distance from p to the loop's ellipse (radial). */
function trackDistance(x: number, z: number): number {
  const tr = layout.track;
  if (!tr) return Infinity;
  const dx = x - tr.cx;
  const dz = z - tr.cz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return Math.min(tr.rx, tr.rz);
  const q = Math.hypot(dx / tr.rx, dz / tr.rz);
  return Math.abs(len - len / q);
}

const START = (150 * Math.PI) / 180;

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class LapTimer {
  running = false;
  t = 0;
  swept = 0;
  falls = 0;
  last = -1;
  lastClean = false;
  best = -1;
  laps = 0;
  message = '';
  private prevTheta: number | null = null;

  private theta(x: number, z: number): number {
    const tr = layout.track;
    if (!tr) return 0;
    return Math.atan2((z - tr.cz) / tr.rz, (x - tr.cx) / tr.rx);
  }

  noteFall(): void {
    if (this.running) this.falls++;
  }

  /** Returns a finished lap time (s) on the tick a lap completes, else -1. */
  update(dt: number, riding: boolean, x: number, z: number): number {
    if (!layout.track) return -1;
    const onRoad = trackDistance(x, z) < 8;
    const th = this.theta(x, z);
    let finished = -1;
    if (!riding) {
      if (this.running) this.message = 'Lap cancelled: got off the bike';
      this.running = false;
      this.prevTheta = null;
      return -1;
    }
    if (this.running) {
      this.t += dt;
      if (trackDistance(x, z) > 12) {
        this.running = false;
        this.message = 'Lap cancelled: left the road';
      } else if (this.prevTheta !== null) {
        this.swept += wrap(th - this.prevTheta);
        if (Math.abs(this.swept) >= Math.PI * 2) {
          finished = this.t;
          this.last = this.t;
          this.lastClean = this.falls === 0;
          if (this.lastClean && (this.best < 0 || this.t < this.best)) this.best = this.t;
          this.laps++;
          this.message = `Lap ${this.t.toFixed(1)} s${this.lastClean ? '' : ' (with a fall)'}`;
          // The next lap starts right away.
          this.swept -= Math.sign(this.swept) * Math.PI * 2;
          this.t = 0;
          this.falls = 0;
        }
      }
    } else if (onRoad && this.prevTheta !== null) {
      // Start when crossing the start/finish line in either direction.
      const a = wrap(this.prevTheta - START);
      const b = wrap(th - START);
      if (Math.sign(a) !== Math.sign(b) && Math.abs(a) < 0.5 && Math.abs(b) < 0.5) {
        this.running = true;
        this.t = 0;
        this.swept = wrap(th - START);
        this.falls = 0;
        this.message = 'Lap started';
      }
    }
    this.prevTheta = onRoad || this.running ? th : null;
    return finished;
  }

  /** Where the start/finish line is (for the task card). */
  static startPoint(): { x: number; z: number } {
    const tr = layout.track;
    if (!tr) return { x: layout.spawn.x, z: layout.spawn.z };
    return { x: tr.cx + tr.rx * Math.cos(START), z: tr.cz + tr.rz * Math.sin(START) };
  }
}

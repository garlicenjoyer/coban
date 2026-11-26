import type { V2 } from '../world/mapTypes';

// Out along the milk road and back to the village square.
const start = { x: 399, z: -353, label: 'Village sprint' };
const gates = [
  { x: 385, z: -330, label: 'Village bend' },
  { x: 350, z: -270, label: 'Milk road turnaround' },
  { ...start, label: 'Finish at the square' },
];
const near = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z) < 7;

export class ValleySprint {
  gate = -1;
  elapsed = 0;
  best = 0;
  get running() { return this.gate >= 0; }
  get marker() { return gates[this.gate] ?? start; }
  atStart(p: V2) { return !this.running && near(p, start); }

  step(dt: number, rider: V2 | null, horn: boolean): string | undefined {
    if (!this.running) {
      if (horn && rider && this.atStart(rider)) {
        this.gate = 0;
        this.elapsed = 0;
        return 'Go! Follow the gold gates.';
      }
      return;
    }
    this.elapsed += dt;
    if (!rider || this.elapsed >= 90) {
      this.gate = -1;
      return 'Run ended. Honk at the start to try again.';
    }
    if (!near(rider, this.marker)) return;
    if (++this.gate < gates.length) return;
    this.gate = -1;
    const record = !this.best || this.elapsed < this.best;
    if (record) this.best = this.elapsed;
    return `${record ? 'Personal best' : 'Finished'} · ${this.elapsed.toFixed(1)} s`;
  }
}

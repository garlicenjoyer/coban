// Record / replay of InputFrames. Recording starts from a reset sim; replay resets
// again, feeds the same frames, and compares the end state (M0 acceptance check).

import type { InputFrame } from '../core/input';
import type { Sim } from '../sim';

export type ReplayMode = 'idle' | 'recording' | 'replaying';

export class Replay {
  mode: ReplayMode = 'idle';
  private frames: InputFrame[] = [];
  private cursor = 0;
  private endKey = '';
  status = 'No recording yet';

  constructor(private sim: Sim) {}

  get frameCount(): number {
    return this.frames.length;
  }

  startRecording(): void {
    this.sim.reset();
    this.frames = [];
    this.mode = 'recording';
    this.status = 'Recording…';
  }

  stopRecording(): void {
    if (this.mode !== 'recording') return;
    this.mode = 'idle';
    this.endKey = this.sim.stateKey();
    this.status = `Recorded ${this.frames.length} ticks (${(this.frames.length / 60).toFixed(1)} s)`;
  }

  startReplay(): void {
    if (this.mode === 'recording') this.stopRecording();
    if (this.frames.length === 0) return;
    this.sim.reset();
    this.cursor = 0;
    this.mode = 'replaying';
    this.status = 'Replaying…';
  }

  /** Called once per tick with the live frame; returns the frame the sim should use. */
  frameFor(live: InputFrame): InputFrame {
    if (this.mode === 'recording') {
      this.frames.push(live);
      return live;
    }
    if (this.mode === 'replaying') {
      const f = this.frames[this.cursor++];
      return f ?? live;
    }
    return live;
  }

  /** Called after each sim step. */
  afterStep(): void {
    if (this.mode === 'replaying' && this.cursor >= this.frames.length) {
      this.mode = 'idle';
      const ok = this.sim.stateKey() === this.endKey;
      this.status = ok ? 'Replay matched the recording exactly' : 'MISMATCH: replay diverged';
      console.info(`[replay] ${this.status}`, { expected: this.endKey, got: this.sim.stateKey() });
    }
  }
}

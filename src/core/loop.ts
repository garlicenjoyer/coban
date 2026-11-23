// Fixed-step loop: the simulation advances in exact SIM_DT steps,
// rendering runs at display rate and interpolates with `alpha`.

import { SIM_DT } from './config';

export interface LoopCallbacks {
  /** Advance the simulation by exactly one fixed step. */
  step(dt: number): void;
  /** Draw; alpha in [0,1) is how far we are between the last two sim steps. */
  render(alpha: number, frameDt: number): void;
}

export class FixedLoop {
  private acc = 0;
  private last = 0;
  private running = false;
  private rafId = 0;
  /** Steps executed in the last frame (debug). */
  stepsLastFrame = 0;
  timeScale = 1;
  /** Hard cap so a long stall (tab switch) does not trigger a spiral of death. */
  maxStepsPerFrame = 8;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const frameDt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      this.acc += frameDt * this.timeScale;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < this.maxStepsPerFrame) {
        this.cb.step(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === this.maxStepsPerFrame) this.acc = 0;
      this.stepsLastFrame = steps;
      this.cb.render(this.acc / SIM_DT, frameDt);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}

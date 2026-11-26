// The M2 "herding fun test" timer for human testers: reset, take the flock from the pen to
// the map's trial pasture (90% of the flock inside it), bring everyone home and close the
// gate. GDD target: under 8 minutes for about 260 m out, at most 2 strays per trip, no
// permanently stuck sheep. The test map uses Pasture B; the valley, Pasture D.

import { SIM_DT } from '../core/config';
import type { Sim } from '../sim';
import { activeMap, layout } from '../world/map';

export type TrialPhase = 'off' | 'out' | 'back' | 'done';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Trial {
  phase: TrialPhase = 'off';
  t = 0;
  outTime = 0;
  maxStrays = 0;
  get targetSeconds(): number {
    return activeMap().scenario.trialSeconds;
  }

  /** The pasture the flock is taken out to. */
  get pasture() {
    const id = activeMap().scenario.trialPasture;
    return layout.pastures.find((p) => p.id === id)!;
  }

  constructor(private sim: Sim) {}

  start(): void {
    this.sim.reset();
    this.sim.teleport(layout.spawn.x, layout.spawn.z);
    this.sim.tasks.enabled = false; // the timed trial replaces the day's tasks
    this.phase = 'out';
    this.t = 0;
    this.outTime = 0;
    this.maxStrays = 0;
  }

  stop(): void {
    this.phase = 'off';
  }

  afterStep(): void {
    if (this.phase === 'off' || this.phase === 'done') return;
    this.t += SIM_DT;
    const f = this.sim.flock;
    this.maxStrays = Math.max(this.maxStrays, f.strays);
    const N = f.sheep.length;
    if (this.phase === 'out') {
      const P = this.pasture;
      const inB = f.sheep.filter((s) => Math.hypot(s.x - P.x, s.z - P.z) < P.r + 5).length;
      if (inB >= Math.ceil(N * 0.9)) {
        this.phase = 'back';
        this.outTime = this.t;
      }
    } else if (this.phase === 'back' && f.inPen >= N - f.strays && !this.sim.gateOpen) {
      this.phase = 'done';
      const result = {
        seconds: Math.round(this.t),
        outSeconds: Math.round(this.outTime),
        strayEvents: f.strayEvents,
        maxStraysAtOnce: this.maxStrays,
        stuckEvents: f.stuckEvents,
        inPen: f.inPen,
        passed: this.t < this.targetSeconds && f.strayEvents <= 2,
      };
      console.info('[herding trial]', result);
    }
  }

  get status(): string {
    const f = this.sim.flock;
    switch (this.phase) {
      case 'off':
        return 'Not running';
      case 'out':
        return `Out to Pasture ${this.pasture.id} · ${fmt(this.t)} · strays ${f.strayEvents}`;
      case 'back':
        return `Home and close the gate · ${fmt(this.t)} (out took ${fmt(this.outTime)}) · strays ${f.strayEvents}`;
      case 'done': {
        const ok = this.t < this.targetSeconds && f.strayEvents <= 2;
        return `${ok ? 'PASS' : 'Over target'} · ${fmt(this.t)} (target ${fmt(this.targetSeconds)}) · strays ${f.strayEvents} · stuck ${f.stuckEvents}`;
      }
    }
  }
}

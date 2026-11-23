// Game tasks (objectives). Part of the simulation: conditions are checked every tick
// from sim state and events, and tasks may change the world when they start (a sheep
// wanders off, a wolf appears), so replays and tests see exactly the same day.

import { SIM_DT } from '../core/config';
import type { Sim } from '../sim';

export interface TaskProgress {
  done: boolean;
  /** Short live progress line, e.g. "18/24 sheep outside". */
  progress?: string;
  /** Where to go, if anywhere: shown as distance and compass direction (no marker). */
  target?: { x: number; z: number; label: string };
  /** Extra hint that appears when the player seems stuck. */
  nudge?: string;
}

export interface TaskDef {
  id: string;
  title: string;
  /** How to do it, in plain words with the controls. */
  how: string;
  start?(sim: Sim, st: TaskState): void;
  update(sim: Sim, st: TaskState): TaskProgress;
}

export interface TaskState {
  /** Seconds since this task started. */
  t: number;
  /** Free per-task numbers (timers, ids). */
  n: Record<string, number>;
}

export interface TaskRecord {
  id: string;
  title: string;
  /** Seconds since the day began when it was finished. */
  doneAt: number;
}

export class TaskSystem {
  enabled = true;
  index = 0;
  t = 0;
  state: TaskState = { t: 0, n: {} };
  current: TaskProgress = { done: false };
  readonly done: TaskRecord[] = [];
  dayDoneAt = -1;
  /** Event counters tasks can read (reset as each task starts). */
  counters: Record<string, number> = {};
  private unsub: (() => void)[] = [];
  private started = false;

  constructor(
    private sim: Sim,
    readonly tasks: TaskDef[],
    /** Which day this is (1, 2, …). */
    readonly day = 1,
  ) {
    const ev = sim.events;
    const count = (k: string) => () => (this.counters[k] = (this.counters[k] ?? 0) + 1);
    this.unsub.push(
      ev.on('dogPetted', count('petted')),
      ev.on('dogTaskDone', (e) => {
        if (e.success) count(`dog:${e.command}`)();
      }),
      ev.on('wolfBite', count('bites')),
    );
  }

  dispose(): void {
    for (const u of this.unsub) u();
  }

  get task(): TaskDef | null {
    return this.tasks[this.index] ?? null;
  }

  get finished(): boolean {
    return this.index >= this.tasks.length;
  }

  private begin(): void {
    const task = this.task;
    this.state = { t: 0, n: {} };
    this.counters = {};
    this.current = { done: false };
    if (!task) return;
    task.start?.(this.sim, this.state);
    this.sim.events.emit('taskStarted', { id: task.id, index: this.index });
  }

  /** Skip the current task (debug). */
  skip(): void {
    if (this.finished) return;
    this.complete();
  }

  private complete(): void {
    const task = this.task!;
    this.done.push({ id: task.id, title: task.title, doneAt: this.t });
    this.sim.events.emit('taskDone', { id: task.id, index: this.index, seconds: this.t });
    this.index++;
    if (this.finished) {
      this.dayDoneAt = this.t;
      this.sim.events.emit('dayDone', { seconds: this.t });
    } else this.begin();
  }

  step(): void {
    if (!this.enabled || this.finished) return;
    if (!this.started) {
      this.started = true;
      this.begin();
    }
    this.t += SIM_DT;
    this.state.t += SIM_DT;
    this.current = this.task!.update(this.sim, this.state);
    if (this.current.done) this.complete();
  }

  stateKey(): number[] {
    return [this.index, this.t];
  }
}

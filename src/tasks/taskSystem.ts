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
  /**
   * Loading a mid-day save inside this task: start again from that task instead (its
   * setup lives there, e.g. the lost ewe is put in the thorns by 'lost', not by 'free').
   */
  resumeFrom?: string;
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
    public day = 1,
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

  /**
   * Pick the day up where a mid-day save left it: tasks before `index` are done (at the
   * times recorded), and `index` starts afresh on the next step.
   */
  resumeAt(index: number, done: TaskRecord[], t: number): void {
    let i = Math.max(0, Math.min(index, this.tasks.length));
    for (let guard = 0; guard < this.tasks.length; guard++) {
      const back = this.tasks[i]?.resumeFrom;
      const j = back ? this.tasks.findIndex((x) => x.id === back) : -1;
      if (j < 0 || j >= i) break;
      i = j;
    }
    this.index = i;
    this.done.splice(0, this.done.length, ...done.filter((d) => this.tasks.findIndex((x) => x.id === d.id) < i));
    this.t = t;
    this.started = false;
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

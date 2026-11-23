import type { ResidentId, V2 } from '../world/mapTypes';

export type ErrandProp = 'olives' | 'stones' | 'cans' | 'broom';

export interface ErrandStop extends V2 {
  place: string;
  action: string;
  note: string;
  prop: ErrandProp;
  seconds?: number;
}

export interface Errand {
  resident: ResidentId;
  title: string;
  offer: string;
  thanks: string;
  completedReply?: string;
  reward: number;
  stops: readonly ErrandStop[];
}

export type ErrandProgress = Partial<Record<ResidentId, number>>;
export interface ErrandTarget {
  errand: Errand;
  stop: ErrandStop;
}

export class Errands {
  private readonly progress: ErrandProgress = {};
  private working?: ErrandStop;
  private worked = 0;

  constructor(readonly definitions: readonly Errand[]) {}

  /** The next stop index, or undefined if the player has yet to accept. */
  status(id: ResidentId): number | undefined {
    return this.progress[id];
  }

  save(): ErrandProgress {
    return { ...this.progress };
  }

  load(data: ErrandProgress | undefined): void {
    for (const { resident, stops } of this.definitions) {
      delete this.progress[resident];
      const index = data?.[resident];
      if (index !== undefined && Number.isInteger(index) && index >= 0 && index <= stops.length) {
        this.progress[resident] = index;
      }
    }
    this.cancelWork();
  }

  /** The villager's errand can be discussed before or after accepting it. */
  forResident(id: ResidentId): Errand | undefined {
    return this.definitions.find((e) => e.resident === id);
  }

  accept(id: ResidentId): Errand | undefined {
    const errand = this.forResident(id);
    if (!errand || this.progress[id] !== undefined) return;
    this.progress[id] = 0;
    return errand;
  }

  *targets(): Iterable<ErrandTarget> {
    for (const errand of this.definitions) {
      const index = this.progress[errand.resident];
      const stop = index === undefined ? undefined : errand.stops[index];
      if (stop) yield { errand, stop };
    }
  }

  near(player: V2): ErrandTarget | undefined {
    let nearest: ErrandTarget | undefined;
    let reach = 2.15;
    for (const target of this.targets()) {
      const d = Math.hypot(player.x - target.stop.x, player.z - target.stop.z);
      if (d < reach) {
        nearest = target;
        reach = d;
      }
    }
    return nearest;
  }

  fraction(stop: ErrandStop): number {
    return this.working === stop && stop.seconds ? this.worked / stop.seconds : 0;
  }

  cancelWork(): void {
    this.working = undefined;
    this.worked = 0;
  }

  work(target: ErrandTarget, dt: number): boolean {
    if (target.stop !== this.working) {
      this.working = target.stop;
      this.worked = 0;
    }
    this.worked += dt;
    return this.worked >= (target.stop.seconds ?? 0);
  }

  advance({ errand, stop }: ErrandTarget): { done: boolean; next?: ErrandStop } | undefined {
    const index = this.progress[errand.resident];
    if (index === undefined || errand.stops[index] !== stop) return;
    this.progress[errand.resident] = index + 1;
    this.cancelWork();
    const next = errand.stops[index + 1];
    return { done: !next, next };
  }
}

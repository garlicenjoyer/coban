// The old motorcycle's care loop (GDD feature 5, Part I "Maintenance and failure states").
// Headless and deterministic; the bike reads its effects and the sim runs the repairs.
//
//   fuel        litres (6 L tank)   distance and idling        sputters, then stalls
//   spark plug  0–100               riding, idling, kicks      misfires, hard starts
//   carburettor 0–100               dust from gravel and dirt  weak pull, stalls at idle
//   tyre        pressure 0–100      thorns and rocks puncture  slow leak, wobble, then flat
//   chain       0–100               distance, much more in mud clanks and skips under load
//
// Every fix is a short hands-on job at the parked bike (hold R), never a menu.

import { config } from '../core/config';
import { rng } from '../world/noise';
import { Surface } from '../world/terrain';

export type BikeJob = 'tyre' | 'pump' | 'fuel' | 'plug' | 'carb' | 'chain' | 'milk';

export interface JobInfo {
  id: BikeJob;
  /** What the shepherd does, for the prompt ("clean the spark plug"). */
  label: string;
  seconds: number;
}

const JOBS: Record<BikeJob, Omit<JobInfo, 'id'>> = {
  tyre: { label: 'find the hole, patch the tyre and pump it up', seconds: 15 },
  pump: { label: 'pump up the soft tyre', seconds: 5 },
  fuel: { label: 'pour from the jerrycan and shake in the two-stroke oil', seconds: 4 },
  plug: { label: 'unscrew the spark plug, wire-brush it, re-gap it', seconds: 6 },
  carb: { label: 'take off the float bowl and blow the jet clean', seconds: 10 },
  chain: { label: 'oil the chain and take up the slack', seconds: 8 },
  milk: { label: 'lift the milk churn onto the rack', seconds: 2 },
};

/** What the shepherd has to work with (patches for the tyre, oil for the chain). */
export interface Supplies {
  patches: number;
  chainOil: number;
}

export class BikeCare {
  fuel = config.bikeCare.start.fuel;
  plug = config.bikeCare.start.plug;
  carb = config.bikeCare.start.carb;
  chain = config.bikeCare.start.chain;
  pressure = 100;
  /** A puncture: the tyre is losing air. */
  leak = false;
  /** Fuel left in Uncle Ahmet's drum at home. */
  drum = config.bikeCare.drumLiters;
  odometerKm = 0;
  /** Set by the sim each step: riding through maquis or thorns, and the hour (golden-hour misfires). */
  inBrush = false;
  hour = 12;
  /** Off-road tyres (an upgrade): fewer punctures, more grip in mud. */
  offroad = false;
  /** Counts faults, so the bike can tell when a new one happened. */
  faults = 0;
  /** The job being done and how far along (seconds). */
  job: BikeJob | null = null;
  jobProgress = 0;
  /** Seconds of a power cut left (misfire, chain skip). */
  private cut = 0;
  /** What cut the power last: for sounds and the dash. */
  lastFault: 'misfire' | 'skip' | 'sputter' | null = null;
  private rand = rng(4040);

  get flat(): boolean {
    return this.pressure <= 0;
  }

  get empty(): boolean {
    return this.fuel <= 0;
  }

  /** How much of the engine's pull reaches the wheel right now (0..1). Call once per step. */
  power(dt: number, throttle: number): number {
    const hour = this.hour;
    const c = config.bikeCare;
    if (this.cut > 0) {
      this.cut -= dt;
      return 0.05;
    }
    // A worn plug misfires (worse in the cool of golden hour); an empty tank sputters.
    const plugBad = Math.max(0, (c.symptom - this.plug) / c.symptom);
    const golden = hour >= 18 && hour < 19.5 ? 2 : 1;
    if (plugBad > 0 && this.rand() < c.misfirePerSec * plugBad * golden * dt) return this.fault('misfire', 0.25);
    if (this.fuel < c.sputterLiters && this.rand() < c.sputterPerSec * dt) return this.fault('sputter', 0.4);
    // A dry chain skips under load.
    const chainBad = Math.max(0, (c.symptom - this.chain) / c.symptom);
    if (chainBad > 0 && throttle > 0.6 && this.rand() < c.skipPerSec * chainBad * dt) return this.fault('skip', 0.15);
    // A dirty carb chokes the pull.
    const carbBad = Math.max(0, (c.symptom - this.carb) / c.symptom);
    return 1 - 0.45 * carbBad;
  }

  private fault(kind: 'misfire' | 'skip' | 'sputter', seconds: number): number {
    this.cut = seconds;
    this.lastFault = kind;
    this.faults++;
    return 0.05;
  }

  /** Does this kick catch? (The needle was in the window.) A worn plug needs a few. */
  kickCatches(): boolean {
    if (this.empty) return false;
    const c = config.bikeCare;
    if (this.plug >= c.symptom) return true;
    // From certain at the symptom line down to one in five with a dead plug.
    return this.rand() < 0.2 + 0.8 * (this.plug / c.symptom);
  }

  /** Idling with a dirty carb: it may die. */
  idleStalls(dt: number): boolean {
    const c = config.bikeCare;
    const carbBad = Math.max(0, (c.symptom - this.carb) / c.symptom);
    return carbBad > 0 && this.rand() < c.idleStallPerSec * carbBad * dt;
  }

  /** Grip multiplier and extra rolling resistance from the tyre. */
  get tyreGrip(): number {
    return this.flat ? 0.55 : this.pressure < config.bikeCare.wobbleBelow ? 0.85 : 1;
  }

  get tyreRoll(): number {
    return this.flat ? 5 : this.pressure < config.bikeCare.wobbleBelow ? 1.6 : 1;
  }

  /** Steering wobble from a soft tyre, at time t. */
  wobble(t: number, speed: number): number {
    const soft = Math.max(0, (config.bikeCare.wobbleBelow - this.pressure) / config.bikeCare.wobbleBelow);
    return soft * Math.min(1, speed / 6) * 0.18 * Math.sin(t * 9.5) * Math.sin(t * 2.3);
  }

  /** Wear for one step: metres covered on this surface, engine running, kicks this step. */
  wear(metres: number, surface: Surface, engineOn: boolean, idling: boolean, hours: number): void {
    const c = config.bikeCare;
    const km = metres / 1000;
    this.odometerKm += km;
    if (engineOn) this.fuel = Math.max(0, this.fuel - c.litresPerKm * km - (idling ? c.idleLitresPerHour * hours : 0));
    this.plug = Math.max(0, this.plug - c.plugPerKm * km - (idling ? c.plugIdlePerHour * hours : 0));
    const dusty = surface === Surface.Gravel || surface === Surface.Dirt;
    this.carb = Math.max(0, this.carb - (dusty ? c.carbDustPerKm : c.carbPerKm) * km);
    this.chain = Math.max(0, this.chain - (surface === Surface.Mud ? c.chainMudPerKm : c.chainPerKm) * km);
    if (!this.leak && metres > 0) {
      const p = (this.inBrush ? c.punctureBrushPerM : surface === Surface.Rock ? c.punctureRockPerM : 0) * metres * (this.offroad ? config.economy.upgrade.tyresPuncture : 1);
      if (p > 0 && this.rand() < p) this.leak = true;
    }
    if (this.leak) this.pressure = Math.max(0, this.pressure - c.leakPerHour * hours);
  }

  /** A kick wears the plug a little. */
  kicked(): void {
    this.plug = Math.max(0, this.plug - config.bikeCare.plugPerKick);
  }

  /** The most urgent job, if any. Fuel only at home, where the drum is. */
  nextJob(atHome: boolean, supplies: Supplies = { patches: 99, chainOil: 99 }): JobInfo | null {
    const c = config.bikeCare;
    const pick = (id: BikeJob): JobInfo => ({ id, ...JOBS[id] });
    if (this.leak && supplies.patches > 0) return pick('tyre');
    if (this.pressure < 100 && !this.leak) return pick('pump');
    if (atHome && this.fuel < c.tank - 0.5 && this.drum > 0) return pick('fuel');
    if (this.plug < c.service) return pick('plug');
    if (this.carb < c.service) return pick('carb');
    if (this.chain < c.service && supplies.chainOil > 0) return pick('chain');
    return null;
  }

  /** A job that isn't the bike's own (the milk churn), with the same hold-R feel. */
  static job(id: BikeJob): JobInfo {
    return { id, ...JOBS[id] };
  }

  /** Work on the job for `seconds`. Returns the job when it is finished. */
  work(job: JobInfo, seconds: number): BikeJob | null {
    if (this.job !== job.id) {
      this.job = job.id;
      this.jobProgress = 0;
    }
    this.jobProgress += seconds;
    if (this.jobProgress < job.seconds) return null;
    this.finish(job.id);
    this.job = null;
    this.jobProgress = 0;
    return job.id;
  }

  stopWork(): void {
    this.job = null;
    this.jobProgress = 0;
  }

  private finish(id: BikeJob): void {
    const c = config.bikeCare;
    switch (id) {
      case 'tyre':
        this.leak = false;
        this.pressure = 100;
        break;
      case 'pump':
        this.pressure = 100;
        break;
      case 'fuel': {
        const add = Math.min(c.tank - this.fuel, this.drum);
        this.fuel += add;
        this.drum -= add;
        break;
      }
      case 'plug':
        this.plug = 100;
        break;
      case 'carb':
        this.carb = 100;
        break;
      case 'chain':
        this.chain = 100;
        break;
      case 'milk':
        break; // the sim moves the churn
    }
  }

  stateKey(): number[] {
    return [this.fuel, this.plug, this.carb, this.chain, this.pressure, this.leak ? 1 : 0, this.drum, this.odometerKm, this.jobProgress, this.cut];
  }
}

// Karabaş's care loop (GDD feature 5, Part I "Care loop and stats"). Headless and
// deterministic; the sim steps it and the Kangal reads its effects.
//
//   satiety    0–100  bowl (kibble from the sack) or bread by hand    −4/h, ×2 running
//   hydration  0–100  troughs, springs, the cistern, a basin           −6/h, ×2 in the heat
//   ticks      0–5    picked off by hand (hold E beside him)           gained in maquis and pines
//
// Effects: hungry (satiety < 30) halves stamina regen; thirsty (hydration < 20) won't run;
// each tick takes 5% off his stamina. Nights cost bond when he went unpetted or hungry, or
// carries ticks. "Tools you care for care for you."

import { config } from '../core/config';
import { rng } from '../world/noise';

export interface Bowl {
  x: number;
  z: number;
  /** Meals in the bowl (0 or 1). */
  meals: number;
}

export interface NightCare {
  bondChange: number;
  /** One line for the notebook. */
  note: string;
}

export class DogCare {
  satiety = config.dogCare.start.satiety;
  hydration = config.dogCare.start.hydration;
  ticks = 0;
  /** Seconds spent picking at the current tick. */
  pickProgress = 0;
  pettedToday = false;
  /** A tick collar cuts the ticks he picks up (set by the sim from the upgrades). */
  tickFactor = 1;
  /** Meals left in Uncle Ahmet's sack by the porch. */
  sack = config.dogCare.sackMeals;
  readonly bowl: Bowl;
  private rand = rng(7171);

  constructor(bowl: { x: number; z: number }) {
    this.bowl = { ...bowl, meals: 0 };
  }

  get hungry(): boolean {
    return this.satiety < config.dogCare.hungry;
  }

  get thirsty(): boolean {
    return this.hydration < config.dogCare.thirsty;
  }

  /** Multiplier on stamina regeneration. */
  get regenScale(): number {
    return this.hungry ? 0.5 : 1;
  }

  /** Thirsty dogs won't sprint. */
  get canRun(): boolean {
    return !this.thirsty;
  }

  /** Maximum stamina with the ticks he carries. */
  get staminaMax(): number {
    return config.dog.stamina.max * (1 - config.dogCare.tickStamina * this.ticks);
  }

  /** 0 (fine) .. 1 (badly in need): drives the tail and ears. */
  get need(): number {
    const c = config.dogCare;
    const hunger = Math.max(0, (c.seekFood - this.satiety) / c.seekFood);
    const thirst = Math.max(0, (c.seekWater - this.hydration) / c.seekWater);
    return Math.min(1, Math.max(hunger, thirst));
  }

  /**
   * Advance by one step. `hours` is in-game time; `running` doubles hunger; `heat` (0..1)
   * doubles thirst at full strength; `brush` is true while he moves through maquis or pines.
   * Returns true if he picked up a tick.
   */
  step(hours: number, running: boolean, heat: number, brush: boolean): boolean {
    const c = config.dogCare;
    this.satiety = Math.max(0, this.satiety - c.satietyPerHour * hours * (running ? c.runFactor : 1));
    this.hydration = Math.max(0, this.hydration - c.hydrationPerHour * hours * (1 + (c.heatFactor - 1) * heat));
    if (brush && this.ticks < c.ticksMax && this.rand() < c.ticksPerBrushHour * this.tickFactor * hours) {
      this.ticks++;
      return true;
    }
    return false;
  }

  /** Fill the bowl from the sack. False if it is already full or the sack is empty. */
  fillBowl(): boolean {
    if (this.bowl.meals > 0 || this.sack <= 0) return false;
    this.sack--;
    this.bowl.meals = 1;
    return true;
  }

  /** He eats what's in the bowl. */
  eatFromBowl(): boolean {
    if (this.bowl.meals <= 0) return false;
    this.bowl.meals--;
    this.satiety = Math.min(100, this.satiety + config.dogCare.mealSatiety);
    return true;
  }

  /** Bread and yoghurt from your hand. */
  feedByHand(): void {
    this.satiety = Math.min(100, this.satiety + config.dogCare.handSatiety);
  }

  drink(seconds: number): void {
    this.hydration = Math.min(100, this.hydration + config.dogCare.drinkPerSec * seconds);
  }

  /** Hold E beside him: returns true when a tick comes off. */
  pick(seconds: number): boolean {
    if (this.ticks <= 0) return false;
    this.pickProgress += seconds;
    if (this.pickProgress < config.dogCare.pickSeconds) return false;
    this.pickProgress = 0;
    this.ticks--;
    return true;
  }

  /** The night: he eats what's in the bowl if he sleeps at home, drinks his fill, and the bond settles. */
  night(atHome: boolean): NightCare {
    const c = config.dogCare;
    if (atHome && this.bowl.meals > 0) this.eatFromBowl();
    const wentHungry = this.hungry;
    let bond = 0;
    const why: string[] = [];
    if (!this.pettedToday) {
      bond += c.bond.notPetted;
      why.push('nobody petted him');
    }
    if (wentHungry) {
      bond += c.bond.hungry;
      why.push('he went to sleep hungry');
    }
    if (this.ticks > 0) {
      bond += c.bond.perTick * this.ticks;
      why.push(`${this.ticks} tick${this.ticks > 1 ? 's' : ''} itched all night`);
    }
    this.satiety = Math.max(0, this.satiety - c.nightSatiety);
    this.hydration = 100;
    this.pettedToday = false;
    this.pickProgress = 0;
    const note = why.length ? `Karabaş is a little cooler with you: ${why.join(', ')}.` : 'Karabaş slept well: fed, petted, no ticks.';
    return { bondChange: bond, note };
  }

  stateKey(): number[] {
    return [this.satiety, this.hydration, this.ticks, this.pickProgress, this.pettedToday ? 1 : 0, this.sack, this.bowl.meals];
  }
}

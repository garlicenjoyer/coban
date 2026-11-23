// Sheep data: one plain object per animal. The flock system owns all behaviour.

import { config } from '../core/config';

export enum Mode {
  Graze = 0,
  Follow = 1,
  Flee = 2,
  Stuck = 3,
  Penned = 4,
  SeekWater = 5,
}
export const MODE_NAMES = ['graze', 'follow', 'flee', 'stuck', 'penned', 'water'] as const;

export enum Personality {
  Bellwether = 0,
  Steady = 1,
  Wanderer = 2,
  Timid = 3,
  Greedy = 4,
}
export const PERSONALITY_NAMES = ['bellwether', 'steady', 'wanderer', 'timid', 'greedy'] as const;

export type StuckKind = 'none' | 'thorn' | 'slope';

/** Steering contributions kept per sheep for the force debug view. */
export const FORCE_KEYS = ['sep', 'ali', 'coh', 'lead', 'flee', 'call', 'wander', 'pen', 'avoid'] as const;
export type ForceKey = (typeof FORCE_KEYS)[number];

export interface PersonalityMods {
  stress: number;
  coh: number;
  lead: number;
  flee: number;
  /** Multiplier on eating time when grass is good. */
  linger: number;
  /** Multiplier on the chance of getting caught in thorns while calm. */
  catchMul: number;
}

export const PERSONALITY_MODS: Record<Personality, PersonalityMods> = {
  [Personality.Bellwether]: { stress: 0.8, coh: 1, lead: 0, flee: 0.9, linger: 1, catchMul: 0.5 },
  [Personality.Steady]: { stress: 1, coh: 1, lead: 1, flee: 1, linger: 1, catchMul: 1 },
  [Personality.Wanderer]: { stress: 1, coh: 0.5, lead: 0.6, flee: 1, linger: 1, catchMul: 3 },
  [Personality.Timid]: { stress: 1.5, coh: 1.3, lead: 1, flee: 1.2, linger: 1, catchMul: 1 },
  [Personality.Greedy]: { stress: 1, coh: 0.9, lead: 0.8, flee: 0.9, linger: 1.5, catchMul: 1 },
};

const HIST = 10; // stuck window samples (every 0.5 s -> 5 s)

export interface Sheep {
  id: number;
  personality: Personality;
  isLeader: boolean;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vz: number;
  /** Facing: forward = (sin heading, cos heading). */
  heading: number;
  prevHeading: number;
  mode: Mode;
  hunger: number;
  thirst: number;
  health: number;
  waterTarget: number;
  drinking: boolean;
  lastDrinkAt: number;
  lastDrinkFrom: number;
  stress: number;
  /** Inside the shepherd's hush: standing still, heads down, quiet. */
  hushed: boolean;
  /** Scattered by wolves in the night; cleared once back with the flock. */
  scattered: boolean;
  /** 0..100: worn down by stress, falls, heat and bites; restored by calm grazing and rest. */
  condition: number;
  /** On the shepherd's halter rope. */
  led: boolean;
  /** Shorn this season (summer): lighter, slimmer, cool. */
  shorn: boolean;
  /** Grazing cycle: standing and eating, or walking to a new spot. */
  eating: boolean;
  actTimer: number;
  wanderX: number;
  wanderZ: number;
  fleeTimer: number;
  fleeX: number;
  fleeZ: number;
  /** Fixed per-scare jitter used when the flock scatters. */
  scatterAngle: number;
  callTimer: number;
  isStray: boolean;
  strayTimer: number;
  stuck: StuckKind;
  freeProgress: number;
  inPen: boolean;
  /** Speed the steering asked for last tick (stuck detection). */
  desiredSpeed: number;
  slopeBlocked: boolean;
  hist: Float32Array;
  histWant: Uint8Array;
  histCount: number;
  histTimer: number;
  /** Weighted steering vectors from the last tick, x/z pairs in FORCE_KEYS order. */
  forces: Float32Array;
  /** Walk-cycle phase for the view. */
  gaitPhase: number;
}

export function createSheep(id: number, personality: Personality, x: number, y: number, z: number, heading: number): Sheep {
  return {
    id,
    personality,
    isLeader: personality === Personality.Bellwether,
    x,
    y,
    z,
    px: x,
    py: y,
    pz: z,
    vx: 0,
    vz: 0,
    heading,
    prevHeading: heading,
    mode: Mode.Penned,
    hunger: config.flock.hunger.start,
    thirst: config.flock.thirst.start,
    health: 100,
    waterTarget: -1,
    drinking: false,
    lastDrinkAt: -1,
    lastDrinkFrom: -1,
    stress: 0,
    hushed: false,
    scattered: false,
    condition: config.condition.start,
    led: false,
    shorn: false,
    eating: true,
    actTimer: 1 + (id % 7),
    wanderX: 0,
    wanderZ: 0,
    fleeTimer: 0,
    fleeX: 0,
    fleeZ: 0,
    scatterAngle: 0,
    callTimer: 0,
    isStray: false,
    strayTimer: 0,
    stuck: 'none',
    freeProgress: 0,
    inPen: true,
    desiredSpeed: 0,
    slopeBlocked: false,
    hist: new Float32Array(HIST * 2),
    histWant: new Uint8Array(HIST),
    histCount: 0,
    histTimer: 0,
    forces: new Float32Array(FORCE_KEYS.length * 2),
    gaitPhase: id * 1.7,
  };
}

export const HIST_LEN = HIST;

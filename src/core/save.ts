// Saving (GDD feature 6, slice 6b): the game saves itself at every dawn, so a week of days
// need not be one sitting. A save holds what outlives a day: the purse and supplies, the
// flock (who is left, how they are, where they slept), Karabaş and his care, the bike and
// its wear, the grass and the paths worn into it, what was built, the cistern, the notes
// read, the signs seen, the satchel, and last night's report. Everything inside a day
// (wolves, stones, the dog's command, timers) starts fresh.

import type { NightReport } from '../sim';
import type { Sim } from '../sim';
import type { Personality } from '../flock/sheep';
import type { ItemId } from '../player/satchel';
import type { HerbId, LedgerLine } from '../economy/economy';
import type { ErrandProgress } from '../life/errands';
import { activeMap } from '../world/map';
import { SUNSET_HOUR } from './config';

export const SAVE_KEY = 'coban.save.v1';
export const SAVE_VERSION = 1;

export interface SaveData {
  v: number;
  map: string;
  savedAt: string;
  day: number;
  sleptAt: 'home' | 'hut';
  gateOpen: boolean;
  player: { x: number; z: number };
  economy: {
    lira: number;
    herbs: Record<HerbId, number>;
    patches: number;
    chainOil: number;
    milkQuality: number;
    rumour: number;
    ledger: LedgerLine[];
    /** 6c state (kept as a bag so later slices can add to it without a version bump). */
    extra: Record<string, unknown>;
  };
  dog: { x: number; z: number; bond: number; wound: number; satiety: number; hydration: number; ticks: number; sack: number; bowl: number };
  bike: {
    x: number;
    z: number;
    heading: number;
    waterCans: number;
    fuel: number;
    plug: number;
    carb: number;
    chain: number;
    pressure: number;
    leak: boolean;
    drum: number;
    odometerKm: number;
  };
  sheep: { id: number; personality: Personality; isLeader: boolean; x: number; z: number; heading: number; hunger: number; thirst: number; condition: number; scattered: boolean }[];
  grass: { value: string; wear: string };
  works: { sites: { id: string; progress: number; built: boolean }[]; cairns: { x: number; z: number }[] };
  water: { kind: string; name: string; x: number; z: number; radius: number; liters: number | null; capacity?: number }[];
  satchel: { id: ItemId; uses: number }[];
  notesRead: string[];
  /** Accepted and completed errands, including delivery cargo in transit. */
  errands?: ErrandProgress;
  signsSeen: number[];
  visited: string[];
  lastNight: NightReport | null;
  scatteredIds: number[];
  /**
   * A checkpoint inside a day (after each task, and on leaving the page): where the day
   * had got to. Absent in a dawn save. Wolves, the lost ewe and timers are not kept: the
   * task they belong to starts again.
   */
  midday?: { hour: number; task: number; t: number; done: { id: string; title: string; doneAt: number }[] };
}

// ---------- byte packing for the grass maps (0..1 floats → one byte each, base64) ----------

function pack(values: Float32Array): string {
  const bytes = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, values[i])) * 255);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function unpack(text: string, into: Float32Array): void {
  const s = atob(text);
  const n = Math.min(s.length, into.length);
  for (let i = 0; i < n; i++) into[i] = s.charCodeAt(i) / 255;
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * What to save of the world as it is now: at dawn, after the day has started, or with
 * `midday` a checkpoint part-way through the day.
 */
export function snapshot(sim: Sim, opts: { midday?: boolean } = {}): SaveData {
  const e = sim.economy;
  const d = sim.dog;
  const b = sim.bike;
  return {
    v: SAVE_VERSION,
    map: activeMap().id,
    savedAt: new Date().toISOString(),
    day: sim.tasks.day,
    sleptAt: sim.sleptAt,
    gateOpen: sim.gateOpen,
    player: { x: round(sim.player.pos.x), z: round(sim.player.pos.z) },
    economy: {
      lira: e.lira,
      herbs: { ...e.herbs },
      patches: e.patches,
      chainOil: e.chainOil,
      milkQuality: e.milkQuality,
      rumour: e.rumour,
      ledger: e.ledger.slice(),
      extra: { ...e.saveExtra(), finds: sim.finds.map(({ kind, value, x, z }) => ({ kind, value, x: round(x), z: round(z) })) },
    },
    dog: {
      x: round(d.x),
      z: round(d.z),
      bond: d.bond,
      wound: d.wound,
      satiety: round(d.care.satiety),
      hydration: round(d.care.hydration),
      ticks: d.care.ticks,
      sack: d.care.sack,
      bowl: d.care.bowl.meals,
    },
    bike: {
      x: round(b.x),
      z: round(b.z),
      heading: round(b.heading, 4),
      waterCans: b.waterCans,
      fuel: round(b.care.fuel),
      plug: round(b.care.plug),
      carb: round(b.care.carb),
      chain: round(b.care.chain),
      pressure: round(b.care.pressure),
      leak: b.care.leak,
      drum: round(b.care.drum),
      odometerKm: round(b.care.odometerKm),
    },
    sheep: sim.flock.sheep.map((s) => ({
      id: s.id,
      personality: s.personality,
      isLeader: s.isLeader,
      x: round(s.x),
      z: round(s.z),
      heading: round(s.heading, 3),
      hunger: round(s.hunger, 2),
      thirst: round(s.thirst, 2),
      condition: round(s.condition, 2),
      scattered: s.scattered,
    })),
    grass: { value: pack(sim.grass.value), wear: pack(sim.grass.wear) },
    works: {
      sites: sim.works.sites.map((s) => ({ id: s.id, progress: s.progress, built: s.built })),
      cairns: sim.works.cairns.map((c) => ({ x: round(c.x), z: round(c.z) })),
    },
    water: sim.water.points
      .filter((p) => p.liters !== null)
      .map((p) => ({ kind: p.kind, name: p.name, x: p.x, z: p.z, radius: p.radius, liters: p.liters, capacity: p.capacity })),
    satchel: sim.satchel.slots.map((s) => ({ id: s.id, uses: Number.isFinite(s.uses) ? s.uses : -1 })),
    notesRead: [...sim.notesRead],
    errands: sim.errands.save(),
    signsSeen: [...sim.signsSeen],
    visited: [...sim.visited],
    lastNight: sim.nightReport(sim.tasks.day - 1) ?? null,
    scatteredIds: sim.scatteredIds,
    ...(opts.midday
      ? { midday: { hour: round(sim.hour, 4), task: sim.tasks.index, t: round(sim.tasks.t, 2), done: sim.tasks.done.map((d) => ({ ...d })) } }
      : {}),
  };
}

/** Is this save for the map that's open, and a version we can read? */
export function usable(data: unknown): data is SaveData {
  const d = data as SaveData | null;
  return !!d && d.v === SAVE_VERSION && d.map === activeMap().id && Array.isArray(d.sheep);
}

/** Keep daytime checkpoints, including errand progress after the main tasks when requested. */
export function canCheckpoint(sim: Sim, options: { afterDayTasks?: boolean } = {}): boolean {
  return sim.tasks.enabled && (options.afterDayTasks || !sim.tasks.finished) && !sim.nightWatchActive && sim.hour < SUNSET_HOUR + 0.5;
}

export { pack as packGrass, unpack as unpackGrass };

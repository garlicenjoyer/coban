// Tiny typed event bus. Systems publish facts; other systems (flock, dog, audio)
// subscribe without importing each other.

import type { DogCommand } from '../dog/commands';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type BarkKind = 'alert' | 'warning' | 'attack' | 'happy' | 'found';

export interface GameEvents {
  /** Crook swung: pushes animals away inside a cone. */
  crookWave: { origin: Vec3Like; dirX: number; dirZ: number; range: number; halfAngle: number; tick: number };
  /** Shepherd's call ("brrr-hey"): attracts sheep inside a radius. */
  call: { origin: Vec3Like; radius: number; tick: number };
  /** Footstep / movement noise used later for sheep stress. */
  playerNoise: { origin: Vec3Like; radius: number; tick: number };
  /** A command was given to the dog, by whistle or by hand gesture. */
  dogCommand: { command: DogCommand; mode: 'whistle' | 'gesture'; origin: Vec3Like; heard: boolean; tick: number };
  /** The dog acknowledged a command (ear flick) and whether he will obey. */
  dogAck: { command: DogCommand; willObey: boolean; delay: number; tick: number };
  /** The dog barked. Direction is where he is facing/barking toward. */
  bark: { kind: BarkKind; x: number; z: number; dirX: number; dirZ: number; tick: number };
  /** The shepherd petted or praised the dog. */
  dogPetted: { praise: boolean; bond: number; tick: number };
  /** A dog command ended (successfully or not). */
  dogTaskDone: { command: DogCommand; success: boolean; result: string; tick: number };
  gateInteract: { tick: number };
  /** A game task (objective) started or was completed. */
  taskStarted: { id: string; index: number };
  taskDone: { id: string; index: number; seconds: number };
  /** The last hour of daylight has begun. */
  goldenHour: { day: number };
  /** Rest at the cottage carried the shepherd into the first night. */
  restedUntilDark: { day: number };
  /** Wolves howl from their den at dusk. */
  howl: { x: number; z: number; day: number };
  /** What happened in the night (resolved when the shepherd sleeps). */
  nightReport: { day: number; taken: number; scattered: number; wounded: number; exposed: number; reason: string };
  /** The shepherd slept at home; a new day begins. */
  slept: { day: number };
  /** All tasks of the day are done. */
  dayDone: { seconds: number };
  /** Motorcycle. */
  bikeFall: { reason: string; tick: number };
  bikeEngine: { on: boolean; reason: 'kick' | 'stall' | 'fall' | 'off' | 'empty'; tick: number };
  /** The engine coughed: a misfire (worn plug), a chain skip, or sputtering on an empty tank. */
  bikeFault: { kind: 'misfire' | 'skip' | 'sputter' };
  /** A thorn or a rock: the tyre is losing air. */
  bikePuncture: { tick: number };
  /** A job at the parked bike is done. */
  bikeRepaired: { job: string };
  bikeKick: { success: boolean; tick: number };
  bikeHorn: { x: number; z: number; tick: number };
  bikeThunk: { strength: number; tick: number };
  bikeMount: { on: boolean; tick: number };
  lap: { seconds: number; clean: boolean; best: number; tick: number };
  /** A wolf reached a sheep. */
  wolfBite: { sheep: number; tick: number };
  /** Sling: a stone thrown, and where it landed. */
  slingThrow: { x: number; y: number; z: number; tick: number };
  slingHit: { x: number; z: number; tick: number };
  /** Something from the satchel was used (text: what happened, for the notebook line). */
  itemUsed: { item: string; ok: boolean; text: string };
  /** The satchel was repacked at home. */
  packed: { items: string[] };
  /** A structure was finished (hut, cistern) or a cairn stacked. */
  built: { id: string; name: string; x: number; z: number; repair?: boolean };
  /** Karabaş ate: from his bowl, or bread from your hand. */
  dogFed: { how: 'bowl' | 'hand'; satiety: number };
  /** You filled his bowl from the sack. */
  bowlFilled: { sackLeft: number };
  /** He picked up a tick in the brush. */
  dogTick: { ticks: number };
  /** You picked a tick off him. */
  tickPicked: { left: number };
  /** A save was restored: the morning of this day. */
  loaded: { day: number; hour?: number };
  /** E at a shop counter: open its card. */
  shopOpen: { shop: string };
  /** A trade went through (or why it didn't). */
  traded: { shop: string; ok: boolean; text: string; lira: number };
  /** A paid glass at the kahvehane. */
  teaServed: { x: number; z: number };
  /** The morning milking is done: litres in the churn by the ağıl. */
  milked: { litres: number; quality: number };
  /** The churn is on the bike's rack. */
  milkLoaded: { litres: number };
  /** Unsold milk turned. */
  milkSoured: { litres: number };
  /** Kemal offered an errand / an errand was done (standing in the village rises). */
  jobOffered: { title: string };
  jobDone: { title: string; reputation: number };
  /** Mehmet's goat is tied up. */
  goatFound: Record<string, never>;
  /** A sheep shorn: fleeces so far, sheep left to shear. */
  sheared: { fleeces: number; left: number };
  /** Something picked up at the ruin. */
  found: { name: string };
  /** Cheese pressed: wheels made, and how many are on the shelf. */
  pressed: { wheels: number; shelf: number };
  /** A bundle of herbs picked. */
  herbPicked: { kind: string; name: string };
  /** The night's effect of his care on the bond. */
  dogNight: { bondChange: number; note: string };
  /** The shepherd came across a sign of the wolves' ground. */
  wolfSign: { index: number; x: number; z: number; kind: string };
  /** The flock has wandered into wolf ground: Karabaş is uneasy. */
  territoryWarn: { day: number };
  /** First time the flock (or the shepherd) reaches a place. */
  arrival: { place: string; label: string };
  /** The shepherd read one of Uncle Ahmet's notes (first time, or again). */
  noteRead: { id: string; first: boolean };
  /** Karabaş was bitten driving off a wolf. */
  dogHurt: { tick: number };
  /** Simulation was reset (replay, debug). */
  simReset: { tick: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) (h as Handler<E[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

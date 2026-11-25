// What every playable map provides: the shared layout fields the game systems read
// (homestead, pastures, works, wolves, spawns), how to build its terrain and props, and
// the few map-specific hooks (roads, paper-map sketch, debug spots). Pure types: no
// three.js, no Rapier.

import type { HerbId, ShopId } from '../economy/economy';
import type { Errand } from '../life/errands';
import type { Terrain } from './terrain';

export type V2 = { x: number; z: number };
export type ResidentId = 'emre' | 'zeynep' | 'ayse' | 'hasan';

export interface ValleyRoute {
  resident: ResidentId;
  /** Closed circuit. Stops appear in travel order, starting with the overnight stop. */
  points: V2[];
  stops: readonly ResidentStop[];
}

export interface ResidentStop {
  hour: number;
  point: number;
  place: string;
  activity: string;
  pose?: 'sort' | 'sweep' | 'tea' | 'check';
}

// ---------- props (colliders + what the views draw) ----------

export type PropRole =
  | 'fence'
  | 'gate'
  | 'trough'
  | 'thorn'
  | 'trunk'
  | 'marker'
  | 'house'
  | 'porch'
  | 'wall'
  | 'olive'
  | 'rock'
  | 'column'
  | 'ruin'
  | 'cypress'
  | 'pine'
  /** Footprint of a village building. */
  | 'building'
  /** The village mosque's minaret. */
  | 'minaret'
  | 'villageTree'
  | 'villageFountain'
  | 'villageFixture'
  /** One of Uncle Ahmet's old cairns on the routes he walked. */
  | 'cairn'
  /** The broken walls of Uncle Ahmet's fallen hut (drawn by the works view). */
  | 'hutRuin'
  /** Homestead dressing, drawn by the homestead view: wooden posts (the ağıl's shelter, the
   *  clothesline), the çeşme's fountain wall, the haystack, the tandır oven, the fig tree. */
  | 'post'
  | 'cesme'
  | 'hay'
  | 'oven'
  | 'fig';

export interface BoxProp {
  kind: 'box';
  role: PropRole;
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  /** If set, the top face is inset by this much on every side: a low platform you can walk up onto. */
  ramp?: number;
}

export interface CylProp {
  kind: 'cyl';
  role: PropRole;
  x: number;
  y: number; // base
  z: number;
  radius: number;
  height: number;
}

export type Prop = BoxProp | CylProp;

export interface Label {
  text: string;
  x: number;
  z: number;
  /** Height above ground. */
  lift: number;
  color?: number;
}

/** Non-colliding decoration (shrubs). */
export interface Decor {
  kind: 'shrub';
  x: number;
  z: number;
  /** Size, metres. */
  s: number;
  rot: number;
  /** 0..1, picks a colour/shape variant. */
  v: number;
}

export interface MapProps {
  props: Prop[];
  labels: Label[];
  decor: Decor[];
  /** Distance from the pen gate to each pasture centre, metres. */
  pastureDistances: Record<string, number>;
}

// ---------- layout ----------

export interface Pasture {
  id: string;
  x: number;
  z: number;
  r: number;
  color: number;
  /** Shown on the in-world label ("dry", "far"). */
  note?: string;
}

export interface Place {
  id: string;
  label: string;
  x: number;
  z: number;
  r: number;
  by: 'flock' | 'player';
}

export type WolfSignKind = 'bones' | 'scat' | 'tuft' | 'prints';

/**
 * The fields game systems read. Pasture order carries roles the scripted days rely on:
 * [0] the near pasture (Day 1), [1] the far pasture with the hut and fold (Day 4),
 * [2] the dry pasture with the cistern (Days 2 and 3). Any further pastures are free.
 */
export interface Layout {
  pen: { x: number; z: number; hx: number; hz: number; gateWidth: number; fenceHeight: number };
  cesme: V2;
  penTrough: V2;
  springs: { name: string; x: number; z: number; radius: number }[];
  pastures: Pasture[];
  /** The hill with the dirt road up it and a muddy flank (Day 2). */
  hill: { x: number; z: number; plateau: number; flank: number; height: number; mudFlank: { angleDeg: number; halfWidthDeg: number } };
  /** The thorn thicket where the lost ewe gets caught (Day 1). */
  thornCluster: { x: number; z: number; r: number; count: number };
  house: { x: number; z: number; hx: number; hz: number; wallHeight: number; porchDepth: number };
  ruins: { x: number; z: number; hx: number; hz: number; clear: number };
  wolfDen: V2;
  wolfSigns: { x: number; z: number; kind: WolfSignKind }[];
  works: {
    /** `ruined`: Uncle Ahmet's fallen hut stands here, and building it means mending his. */
    hut: { x: number; z: number; hx: number; hz: number; wallHeight: number; ruined?: boolean };
    fold: { xMin: number; xMax: number; zMin: number; zMax: number; wall: number };
    cistern: { x: number; z: number; radius: number };
  };
  places: Place[];
  spawn: V2;
  bikeSpawn: { x: number; z: number; headingDeg: number };
  dogSpawn: V2;
  /** Animals keep inside |x|, |z| < walk; they are steered back past edge. */
  bounds: { walk: number; edge: number };
  /** The village at the end of the road, if the map has one. */
  village?: {
    x: number;
    z: number;
    r: number;
    minaret?: { x: number; z: number; h: number };
    /** Shop counters on the square: where you stand to trade. */
    shops?: { id: ShopId; x: number; z: number; facing: number }[];
  };
  /** The test map's gravel loop (the lap timer). Absent on maps without one. */
  track?: { cx: number; cz: number; rx: number; rz: number; halfWidth: number };
}

/** One of Uncle Ahmet's notes, left where the shepherd will need it. */
export interface AhmetNote {
  id: string;
  x: number;
  z: number;
  /** Where it lies, as the shepherd sees it ("under a stone by the spring"). */
  where: string;
  title: string;
  /** His words. Paragraphs separated by blank lines. */
  text: string;
}

/**
 * A mark in Uncle Ahmet's hand on the paper map. Marks without `from` are on the map
 * from the first morning; the rest appear once the note named in `from` has been read.
 */
export type PencilMark = { id: string; from?: string } & (
  | { kind: 'route'; pts: V2[] }
  | { kind: 'text'; x: number; z: number; text: string; rot?: number }
  | { kind: 'circle'; x: number; z: number; r: number; text?: string }
  | { kind: 'rect'; xMin: number; xMax: number; zMin: number; zMax: number; text?: string }
);

/** Pencil marks visible once the given notes have been read. */
export function visibleMarks(marks: readonly PencilMark[], read: ReadonlySet<string>): PencilMark[] {
  return marks.filter((m) => !m.from || read.has(m.from));
}

/** Drawing calls the paper map hands a map so it can sketch its own features. */
export interface Sketcher {
  g: CanvasRenderingContext2D;
  px: (x: number) => number;
  py: (z: number) => number;
  /** Pixels per metre. */
  scale: number;
  label: (text: string, x: number, z: number, size?: number, color?: string) => void;
  ink: string;
  pencil: string;
  rnd: () => number;
}

/**
 * Where the land changes character, for painting the ground and dressing it (visual only).
 * Each zone is 0..1 with soft edges.
 */
export interface GroundZones {
  forest(x: number, z: number): number;
  maquis(x: number, z: number): number;
  /** The olive grove's ploughed terraces. */
  grove(x: number, z: number): number;
  /** Distance to the riverbed's centreline (metres), its stony bed's half-width and bank width. */
  dere(x: number, z: number): number;
  dereHalf: number;
  dereBank: number;
  /** Where the riverbed may be crossed on foot: kept clear of oleanders. */
  fords: V2[];
}

export interface MapDef {
  id: 'test' | 'valley';
  /** The paper map's cartouche. */
  title: string;
  /** Side length, metres (the terrain is centred on the origin). */
  size: number;
  layout: Layout;
  buildTerrain(): Terrain;
  buildProps(t: Terrain): MapProps;
  /** Distance to the nearest road or track, metres (keeps grass and props off them). */
  roadDistance(x: number, z: number): number;
  /** Map-specific features for the paper map (roads, riverbeds, area names). */
  sketch(s: Sketcher): void;
  /** Debug teleport spots. */
  teleports(): Record<string, [number, number]>;
  /** Ground zones for the painted terrain; maps without them paint by surface only. */
  ground?: GroundZones;
  /**
   * Where the debug scenarios set up: open meadow, a lost-sheep spot (and what to call it)
   * with the flock's position, and the herding trial's pasture and target time.
   */
  scenario: { meadow: V2; lost: V2; lostWhere: string; lostFlock: V2; trialPasture: string; trialSeconds: number };
  /** Where a runaway goat may be found (the kahvehane's errand). */
  goatSpots?: V2[];
  /** Wild herb patches to pick (one bundle a day each). */
  herbs?: { id: string; kind: HerbId; x: number; z: number }[];
  /** Uncle Ahmet's notes lying in the world (none on the test map). */
  notes?: AhmetNote[];
  residents?: ValleyRoute[];
  errands?: readonly Errand[];
  /** His pencil marks on the paper map. */
  pencil?: PencilMark[];
  /** Relative grass-tuft density, 0..1 (the valley thins it away from the homestead). */
  tuftDensity?(x: number, z: number): number;
}

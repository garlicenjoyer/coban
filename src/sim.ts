// The simulation: everything that advances in fixed steps. Headless (no DOM, no
// three.js), so tests can run it in Node and replays can re-run it exactly.

import type RAPIERType from '@dimforge/rapier3d-compat';
import { config, DAWN_HOUR, FIRST_NIGHT_HOUR, GOLDEN_HOUR, SIM_DT, SUNSET_HOUR } from './core/config';
import { EventBus } from './core/events';
import type { InputFrame } from './core/input';
import { Bike } from './bike/bike';
import { LapTimer } from './bike/lap';
import type { DogCommand } from './dog/commands';
import { DogCare } from './dog/care';
import { Kangal } from './dog/kangal';
import { Flock } from './flock/flock';
import { Wolves, type Wolf } from './predators/wolf';
import { DAY1 } from './tasks/day1';
import { day2Plan } from './tasks/day2';
import { DAY3 } from './tasks/day3';
import { TaskSystem, type TaskDef } from './tasks/taskSystem';
import type { Sheep } from './flock/sheep';
import { rng } from './world/noise';
import { PlayerController } from './player/controller';
import { GrassMap } from './world/grassMap';
import { Obstacles } from './world/obstacles';
import { createPhysicsWorld, type Rapier } from './world/physics';
import type { Terrain } from './world/terrain';
import { activeMap, buildProps, buildTerrain, inYard, insideFold, insidePen, layout, type MapProps } from './world/map';
import type { AhmetNote } from './world/mapTypes';
import { RACK_CANS, WaterSupply } from './world/water';
import { ITEMS, Satchel } from './player/satchel';
import { Works, type WorkSite } from './world/works';
import { yardLayout } from './world/homestead';
import { unpackGrass, type SaveData } from './core/save';
import { BikeCare } from './bike/care';
import { ARTIFACTS, Economy, GOODS, HERBS, JOBS, MUSEUM_LORE, RUMOURS, UPGRADES, type ArtifactKind, type ShopId, type UpgradeId } from './economy/economy';
import { isThursday, season } from './economy/calendar';
import type { TradeRequest } from './core/input';
import { DAY4, FREE_DAY } from './tasks/day4';
import { Residents, type Resident } from './life/residents';
import { Wildlife, wildlifeNames } from './life/wildlife';
import { Errands, type ErrandTarget } from './life/errands';
import { errandDirection, type DialogueChoice, type DialogueOption, type ResidentDialogue, type ResidentGesture } from './life/dialogue';
import { voiceCues } from './audio/residentVoiceCues';

/** Interact presses within this distance of the gate toggle it. */
export const GATE_REACH = 2.5;
/** Grass regrows in 1 Hz batches. */
const GRASS_EVERY_TICKS = 60;
/** Side of a cell of the brush (tick) map, metres. */
const BRUSH_CELL = 5;

export interface SunsetTally {
  readonly inPen: number;
  readonly safe: number;
  readonly total: number;
  readonly gateClosed: boolean;
}

/** What happened in the night after a given day. */
/** What the shopkeeper says as an upgrade changes hands. */
const UPGRADE_SAY: Record<UpgradeId, string> = {
  tickCollar: 'A tick collar. Buckle it on him at home; the brush will bother him less.',
  press: 'Fatma Hanım’s old press, on the rack. It goes by the cottage: hold E there with milk in the churn.',
  spikedCollar: 'Usta Remzi hammers the last spike flat. A wolf that goes for his throat will regret it.',
  tyres: 'New tyres with deep tread. She’ll go through the maquis and the mud like a goat.',
  pen: 'His boys will be up tomorrow at first light: higher walls, a stout gate. Your flock will sleep safe.',
};

export interface NightReport {
  readonly day: number;
  readonly exposed: number;
  readonly penned: number;
  readonly taken: number;
  readonly scattered: number;
  /** Bitten but not taken: they come home hurt. */
  readonly wounded: number;
  readonly gateClosed: boolean;
  /** Where the shepherd slept: at home by the ağıl, or at the hut with the flock folded. */
  readonly sleptAt: 'home' | 'hut';
  readonly bond: number;
  /** One line for the notebook: why it went the way it did. */
  readonly reason: string;
  /** Paw prints from the den toward where the wolves went. */
  readonly tracks: readonly { x: number; z: number; h: number }[];
  /** How Karabaş's care went (fed, petted, ticks) and what it did to the bond. */
  readonly dog?: { bondChange: number; note: string };
  /** It rained hard: finds may have washed out at the ruin. */
  readonly rain?: boolean;
}

export class Sim {
  readonly terrain: Terrain;
  readonly map: MapProps;
  /** Coarse grid of maquis and pine cover (ticks live there), BRUSH_CELL metres a cell. */
  private brush!: Uint8Array;
  private brushN = 0;
  readonly obstacles: Obstacles;
  readonly events = new EventBus();
  readonly gatePos: { x: number; z: number };
  world!: RAPIERType.World;
  terrainCollider!: RAPIERType.Collider;
  private gateCollider!: RAPIERType.Collider;
  player!: PlayerController;
  flock!: Flock;
  grass!: GrassMap;
  water!: WaterSupply;
  dog!: Kangal;
  wolves!: Wolves;
  residents!: Residents;
  wildlife!: Wildlife;
  errands!: Errands;
  dialogue: ResidentDialogue | null = null;
  private hornTime = 0;
  private observed: { animal: Wildlife['animals'][number]; until: number } | null = null;
  tasks!: TaskSystem;
  bike!: Bike;
  lap!: LapTimer;
  private bikeBody!: RAPIERType.RigidBody;
  private bikeCollider!: RAPIERType.Collider;
  private rand!: () => number;
  private readonly sunsetTallies = new Map<number, SunsetTally>();
  private goldenHourAnnounced = false;
  private nightProbe: Wolf | null = null;
  /** The day whose night has already sent a wolf (live) — one per night. */
  private nightWolfDay = -1;
  private howledDay = -1;
  private readonly nightReports = new Map<number, NightReport>();
  /** Sheep the wolves scattered last night (for the morning task). */
  private scatteredLastNight: Sheep[] = [];
  /** True while the shepherd holds the hush. */
  hushing = false;
  satchel!: Satchel;
  works!: Works;
  /** Sling stones in flight. */
  stones: { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number }[] = [];
  private slingCooldown = 0;
  /** The sheep on the halter rope, if any. */
  ledSheep: Sheep | null = null;
  /** Today's salt lick, once set down. */
  saltLick: { x: number; z: number } | null = null;
  /** Seconds left brewing çay (the shepherd sits). */
  brewing = 0;
  /** In-game time multiplier this tick: building and çay make the hours fly. */
  timeRate = 1;
  /** The site being worked on this tick. */
  building: WorkSite | null = null;
  /** Wolf signs the shepherd has come across (indices into layout.wolfSigns). */
  readonly signsSeen = new Set<number>();
  private territoryTime = 0;
  private territoryWarnedDay = -1;
  private territoryWolfDay = -1;
  /** The purse, what the hills and the flock give, and the repair supplies (feature 6). */
  economy!: Economy;
  /** Herb patches picked, by id: the day they were picked (they grow back overnight). */
  readonly herbsPicked = new Map<string, number>();
  /** Milking right now (hold E at the stand in the ağıl): time runs fast. */
  milkingNow = false;
  /** Shearing right now (hold E beside a penned sheep in summer): time runs fast. */
  shearingNow = false;
  shearProgress = 0;
  private shearTarget: Sheep | null = null;
  /** Pressing cheese right now (hold E at the press): time runs fast. */
  pressingNow = false;
  pressProgress = 0;
  /** Finds washed out at the ruin by heavy rain, waiting to be picked up. */
  finds: { id: number; kind: ArtifactKind; value: number; x: number; z: number }[] = [];
  private findSeq = 0;
  private weatherRand!: () => number;
  /** Uncle Ahmet's notes the shepherd has read (note ids). */
  readonly notesRead = new Set<string>();
  /** Places reached for the first time (layout.places ids). */
  readonly visited = new Set<string>();
  sleptAt: 'home' | 'hut' = 'home';
  private injuryRand!: () => number;
  lanternOn = false;
  gateOpen = false;
  tick = 0;
  /** In-game hour, 0..24. */
  hour = config.time.startHour;

  constructor(private R: Rapier, terrain?: Terrain) {
    this.terrain = terrain ?? buildTerrain();
    this.map = buildProps(this.terrain);
    this.obstacles = new Obstacles(this.map);
    this.buildBrush();
    this.gatePos = { x: layout.pen.x + layout.pen.hx, z: layout.pen.z };
    this.build();
  }

  private build(): void {
    const { world, terrainCollider, gateCollider } = createPhysicsWorld(this.R, this.terrain, this.map);
    this.world = world;
    this.terrainCollider = terrainCollider;
    this.gateCollider = gateCollider;
    const s = layout.spawn;
    this.player = new PlayerController(this.R, world, this.events, {
      x: s.x,
      y: this.terrain.heightAt(s.x, s.z) + 0.05,
      z: s.z,
    });
    this.grass = new GrassMap(this.terrain);
    this.water = new WaterSupply();
    this.flock?.dispose();
    this.flock = new Flock(this.terrain, this.grass, this.obstacles, this.events, config.flock.count);
    this.rand = rng(99);
    this.dog = new Kangal(layout.dogSpawn.x, layout.dogSpawn.z, this.terrain, this.obstacles, this.events);
    this.dog.care = new DogCare(yardLayout(layout).bowl);
    this.wolves?.dispose();
    this.wolves = new Wolves(this.terrain, this.obstacles, this.events);
    // Ambient actors steer around the terrain and stay out of the physics collision world.
    this.residents = new Residents(activeMap().residents ?? [], this.terrain, this.obstacles, this.events);
    this.wildlife = new Wildlife(activeMap(), this.terrain, this.obstacles, this.events);
    this.errands = new Errands(activeMap().errands ?? []);
    this.dialogue = null;
    this.hornTime = 0;
    this.observed = null;
    const bs = layout.bikeSpawn;
    this.bike = new Bike(bs.x, bs.z, (bs.headingDeg * Math.PI) / 180, this.terrain, this.obstacles, this.events);
    this.bikeBody = world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased());
    this.bikeCollider = world.createCollider(this.R.ColliderDesc.cuboid(0.3, 0.5, 0.95), this.bikeBody);
    this.syncBikeBody(true);
    this.lap = new LapTimer();
    this.tasks?.dispose();
    this.tasks = new TaskSystem(this, DAY1);
    this.setGate(false);
    this.tick = 0;
    this.hour = config.time.startHour;
    this.residents.setTime(this.hour);
    this.sunsetTallies.clear();
    this.goldenHourAnnounced = false;
    this.nightProbe = null;
    this.nightWolfDay = -1;
    this.howledDay = -1;
    this.nightReports.clear();
    this.scatteredLastNight = [];
    this.hushing = false;
    this.lanternOn = false;
    this.satchel = new Satchel();
    this.works = new Works();
    this.stones = [];
    this.slingCooldown = 0;
    this.ledSheep = null;
    this.saltLick = null;
    this.brewing = 0;
    this.timeRate = 1;
    this.building = null;
    this.signsSeen.clear();
    this.territoryTime = 0;
    this.territoryWarnedDay = -1;
    this.territoryWolfDay = -1;
    this.visited.clear();
    this.notesRead.clear();
    this.economy = new Economy();
    this.herbsPicked.clear();
    this.milkingNow = false;
    this.pressingNow = false;
    this.pressProgress = 0;
    this.shearingNow = false;
    this.shearProgress = 0;
    this.shearTarget = null;
    this.finds = [];
    this.findSeq = 0;
    this.weatherRand = rng(2468);
    this.sleptAt = 'home';
    this.injuryRand = rng(1234);
  }

  /** Mark the cells with maquis shrubs, thorn thickets or pines in them. */
  private buildBrush(): void {
    const size = activeMap().size;
    const n = Math.ceil(size / BRUSH_CELL);
    this.brushN = n;
    this.brush = new Uint8Array(n * n);
    const mark = (x: number, z: number) => {
      const ix = Math.floor((x + size / 2) / BRUSH_CELL);
      const iz = Math.floor((z + size / 2) / BRUSH_CELL);
      if (ix >= 0 && iz >= 0 && ix < n && iz < n) this.brush[ix * n + iz] = 1;
    };
    for (const d of this.map.decor) mark(d.x, d.z);
    for (const p of this.map.props) if (p.role === 'thorn' || p.role === 'pine' || p.role === 'trunk') mark(p.x, p.z);
  }

  /** Is (x, z) in maquis or among pines? */
  brushAt(x: number, z: number): boolean {
    const size = activeMap().size;
    const ix = Math.floor((x + size / 2) / BRUSH_CELL);
    const iz = Math.floor((z + size / 2) / BRUSH_CELL);
    return ix >= 0 && iz >= 0 && ix < this.brushN && iz < this.brushN && this.brush[ix * this.brushN + iz] === 1;
  }

  /** The shop counter within reach, if any. */
  shopNear(x: number, z: number): { id: ShopId; x: number; z: number } | null {
    const r = config.economy.reach;
    const thursday = isThursday(this.tasks.day);
    return layout.village?.shops?.find((s) => (s.id !== 'vet' || thursday) && Math.hypot(s.x - x, s.z - z) < r) ?? null;
  }

  /** An unpicked herb patch within reach, if any. */
  herbNear(x: number, z: number): { id: string; kind: keyof typeof HERBS; x: number; z: number } | null {
    const r = config.economy.reach;
    const day = this.tasks.day;
    return activeMap().herbs?.find((h) => this.herbsPicked.get(h.id) !== day && Math.hypot(h.x - x, h.z - z) < r) ?? null;
  }

  /** Can the ewes be milked now, standing here? (Morning, most of them penned, churn empty.) */
  canMilk(x: number, z: number): boolean {
    const m = yardLayout(layout).milking;
    const ec = config.economy;
    return (
      Math.hypot(m.x - x, m.z - z) < 1.6 &&
      this.hour >= DAWN_HOUR &&
      this.hour < ec.milkUntilHour &&
      this.economy.milkedDay !== this.tasks.day &&
      this.economy.churn === 0 &&
      this.sheepInPen >= Math.ceil(this.flock.sheep.length * 0.75)
    );
  }

  /** Milk quality from how the flock fared: fed, watered, in good condition. */
  private milkQuality(): number {
    const sh = this.flock.sheep;
    if (!sh.length) return 1;
    const avg = (f: (s: Sheep) => number) => sh.reduce((a, s) => a + f(s), 0) / sh.length;
    const q = 1.15 - avg((s) => s.hunger) / 150 - avg((s) => s.thirst) / 150 + (avg((s) => s.condition) - 80) / 200;
    return Math.round(Math.max(0.5, Math.min(1.2, q)) * 100) / 100;
  }

  /** Kemal's errands: ask for one, or report back on the one in hand. */
  private errand(say: (ok: boolean, text: string) => void): void {
    const e = this.economy;
    const day = this.tasks.day;
    const vc = config.village.jobs;
    if (!e.job) {
      if (day < e.nextJobDay) return say(false, 'Kemal shakes his head. “Nothing today. Come back tomorrow.”');
      const id = e.nextJob();
      const spots = activeMap().goatSpots ?? [];
      e.job = { id, spot: id === 'goat' && spots.length ? spots[e.jobsDone % spots.length] : undefined };
      if (id === 'goat' && !spots.length) e.job.found = true;
      this.events.emit('jobOffered', { title: JOBS[id].title });
      return say(true, `Kemal leans in: “${JOBS[id].ask}” (${e.jobReward(id)} ₺)`);
    }
    const id = e.job.id;
    let ready = false;
    if (id === 'thyme' && e.herbs.thyme >= vc.thymeBundles) {
      e.herbs.thyme -= vc.thymeBundles;
      ready = true;
    } else if (id === 'goat' && e.job.found) ready = true;
    else if (id === 'wedding') {
      const aged = e.cheese.filter((w) => w.age >= config.economy.cheese.ageDays);
      if (aged.length >= vc.weddingWheels) {
        let left = vc.weddingWheels;
        e.cheese = e.cheese.filter((w) => !(w.age >= config.economy.cheese.ageDays && left-- > 0));
        ready = true;
      }
    }
    if (!ready) {
      const hint =
        id === 'thyme'
          ? `${e.herbs.thyme} of ${vc.thymeBundles} bundles of thyme`
          : id === 'goat'
            ? 'the goat is still out in the maquis'
            : `${e.cheese.filter((w) => w.age >= config.economy.cheese.ageDays).length} of ${vc.weddingWheels} aged wheels`;
      return say(false, `“${JOBS[id].title}”: not yet (${hint}).`);
    }
    const reward = e.jobReward(id);
    e.earn(reward, day, JOBS[id].title);
    e.reputation++;
    e.jobsDone++;
    e.job = null;
    e.nextJobDay = day + 1;
    this.events.emit('jobDone', { title: JOBS[id].title, reputation: e.reputation });
    return say(true, `${JOBS[id].done} ${reward} ₺.`);
  }

  /** One or two finds come up out of the ground round the ruin. */
  private washOutFinds(): void {
    const ru = layout.ruins;
    const r = this.weatherRand;
    const [lo, hi] = config.economy.findsPerRain;
    const n = lo + Math.floor(r() * (hi - lo + 1));
    for (let i = 0; i < n && this.finds.length < 4; i++) {
      for (let k = 0; k < 20; k++) {
        const a = r() * Math.PI * 2;
        const d = 4 + r() * (ru.clear - 4);
        const x = ru.x + Math.cos(a) * d;
        const z = ru.z + Math.sin(a) * d;
        if (this.obstacles.blocked(x, z, 0.6) || this.terrain.slopeDegAt(x, z) > 20) continue;
        let roll = r();
        let kind: ArtifactKind = 'coin';
        for (const [kk, info] of Object.entries(ARTIFACTS) as [ArtifactKind, (typeof ARTIFACTS)[ArtifactKind]][]) {
          if (roll < info.weight) {
            kind = kk;
            break;
          }
          roll -= info.weight;
        }
        const [vlo, vhi] = ARTIFACTS[kind].value;
        this.finds.push({ id: this.findSeq++, kind, value: Math.round(vlo + r() * (vhi - vlo)), x, z });
        break;
      }
    }
  }

  /** A penned, unshorn sheep within reach (summer only), if any. */
  sheepToShear(x: number, z: number): Sheep | null {
    if (season(this.tasks.day) !== 'summer') return null;
    const r = config.village.wool.reach;
    let best: Sheep | null = null;
    let bd = r;
    for (const s of this.flock.sheep) {
      if (s.shorn || s.stuck !== 'none' || !insidePen(s.x, s.z, -0.3)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Mehmet's goat, if the errand is on and she isn't tied up yet. */
  get goat(): { x: number; z: number } | null {
    const j = this.economy.job;
    return j?.id === 'goat' && !j.found && j.spot ? j.spot : null;
  }

  /** A find at the ruin within reach, if any. */
  findNear(x: number, z: number): (typeof this.finds)[number] | null {
    return this.finds.find((f) => Math.hypot(f.x - x, f.z - z) < 1.6) ?? null;
  }

  /** Can cheese be pressed now, standing here? (Press bought, milk in the churn, room on the shelf.) */
  canPress(x: number, z: number): boolean {
    const p = yardLayout(layout).press;
    const e = this.economy;
    return e.has('press') && e.churn >= config.economy.cheese.litresPerWheel && e.cheese.length < config.economy.cheese.shelf && Math.hypot(p.x - x, p.z - z) < 1.8;
  }

  /** At a counter: sell what the shop buys, or buy one of its goods. */
  trade(t: TradeRequest): void {
    const p = this.player.pos;
    const shop = this.shopNear(p.x, p.z);
    const e = this.economy;
    const ec = config.economy;
    const day = this.tasks.day;
    const b = this.bike;
    const say = (ok: boolean, text: string) => this.events.emit('traded', { shop: t.shop, ok, text, lira: e.lira });
    if (!shop || shop.id !== t.shop) return;
    const bikeHere = Math.hypot(b.x - shop.x, b.z - shop.z) < ec.bikeReach && !b.rider;
    if (t.kind === 'job') {
      if (t.shop !== 'kahvehane') return;
      return this.errand(say);
    }
    if (t.kind === 'sell') {
      if (t.shop === 'dairy') {
        const ready = e.cheese.filter((w) => w.age >= ec.cheese.ageDays);
        if (ready.length) {
          const lira = ready.reduce((a, w) => a + Economy.cheesePrice(w), 0);
          e.cheese = e.cheese.filter((w) => w.age < ec.cheese.ageDays);
          e.earn(lira, day, `${ready.length} wheels of white cheese`);
          if (e.rackMilk <= 0) return say(true, `Fatma Hanım cuts a wheel, tastes it and nods: ${ready.length} wheel${ready.length > 1 ? 's' : ''}, ${lira} ₺.`);
        }
        if (e.rackMilk <= 0) return say(false, e.churn > 0 ? 'The churn is still at home: load it onto the bike.' : 'No milk on the bike.');
        if (!bikeHere) return say(false, 'Bring the bike with the churn up to the dairy.');
        const lira = Math.round(e.rackMilk * ec.milkPerLitre * e.milkQuality);
        const litres = e.rackMilk;
        e.rackMilk = 0;
        e.earn(lira, day, `${litres} L of milk to the dairy`);
        return say(true, `Fatma Hanım weighs the churn: ${litres} L, ${e.milkQuality >= 1 ? 'good milk' : 'thin milk'}. ${lira} ₺.`);
      }
      if (t.shop === 'bakkal') {
        if (e.herbCount === 0 && e.fleeces === 0) return say(false, 'You have no herbs or wool to sell.');
        let lira = Math.round(e.woolValue);
        const fleeces = e.fleeces;
        e.fleeces = 0;
        e.woolValue = 0;
        for (const k of Object.keys(e.herbs) as (keyof typeof HERBS)[]) {
          lira += e.herbs[k] * HERBS[k].price;
          e.herbs[k] = 0;
        }
        e.earn(lira, day, fleeces ? `${fleeces} fleeces and herbs to the bakkal` : 'herbs to the bakkal');
        return say(true, fleeces ? `Hüseyin Efendi weighs ${fleeces} fleece${fleeces > 1 ? 's' : ''}, feels the wool between his fingers and counts out ${lira} ₺.` : `Hüseyin Efendi sniffs the bundles and counts out ${lira} ₺.`);
      }
      if (t.shop === 'muze' || t.shop === 'dealer') {
        if (!e.artifacts.length) return say(false, t.shop === 'muze' ? 'He would love to see anything you find at the ruin.' : 'Nothing? Come back when you have something.');
        const worth = e.artifacts.reduce((a, f) => a + f.value, 0);
        const n = e.artifacts.length;
        e.artifacts = [];
        if (t.shop === 'dealer') {
          e.earn(worth, day, `${n} find${n > 1 ? 's' : ''} to the dealer`);
          return say(true, `He turns them over under the lamp and counts out ${worth} ₺ without a word.`);
        }
        const lira = Math.round(worth * ec.museumShare);
        const lore: string[] = [];
        for (let i = 0; i < n; i++) {
          e.museumGiven++;
          if (e.museumGiven <= MUSEUM_LORE.length) {
            lore.push(MUSEUM_LORE[e.museumGiven - 1]);
            this.notesRead.add(`museum${e.museumGiven}`);
          }
        }
        e.earn(lira, day, `${n} find${n > 1 ? 's' : ''} to the museum`);
        return say(true, `Selim Bey writes your name in the ledger and pays ${lira} ₺.${lore.length ? ` “${lore.join(' ')}”` : ''}`);
      }
      return say(false, 'They don’t buy anything here.');
    }
    const found = GOODS.find((g) => g.id === t.good && g.shop === t.shop);
    if (!found) return;
    // The village's goodwill: a little off everything once they know you.
    const good = { ...found, price: e.discounted(found.price) };
    if (UPGRADES.has(good.id)) {
      const u = good.id as UpgradeId;
      if (e.has(u)) return say(false, 'You have that already.');
      if (!e.pay(good.price, day, good.name)) return say(false, 'Not enough money.');
      e.upgrades.add(u);
      return say(true, UPGRADE_SAY[u]);
    }
    switch (good.id) {
      case 'kibble':
        if (!e.pay(good.price, day, good.name)) return say(false, 'Not enough money.');
        this.dog.care.sack += config.dogCare.sackMeals;
        return say(true, 'A sack of kibble, tied on the rack. It goes by the porch when you get home.');
      case 'tankFuel': {
        if (!bikeHere) return say(false, 'Bring the bike to the pump.');
        const want = config.bikeCare.tank - b.care.fuel;
        const litres = Math.min(want, Math.floor(e.lira / good.price));
        if (litres < 0.5) return say(false, want < 0.5 ? 'The tank is full.' : 'Not enough money.');
        e.pay(Math.ceil(litres * good.price), day, `${litres.toFixed(1)} L of fuel`);
        b.care.fuel += litres;
        return say(true, `Usta Remzi fills her up: ${litres.toFixed(1)} L.`);
      }
      case 'jerrycan':
        if (!e.pay(good.price, day, good.name)) return say(false, 'Not enough money.');
        b.care.drum += ec.jerrycanLitres;
        return say(true, `A jerrycan of mix for the drum: ${ec.jerrycanLitres} L.`);
      case 'patches':
        if (!e.pay(good.price, day, good.name)) return say(false, 'Not enough money.');
        e.patches += ec.patchesPerKit;
        return say(true, `Patches: you have ${e.patches}.`);
      case 'chainOil':
        if (!e.pay(good.price, day, good.name)) return say(false, 'Not enough money.');
        e.chainOil += ec.chainOilUses;
        return say(true, 'A bottle of chain oil.');
      case 'vetDog': {
        const dog = this.dog;
        if (Math.hypot(dog.x - p.x, dog.z - p.z) > config.village.vet.dogReach) return say(false, 'Bring Karabaş with you: she has to see him.');
        if (!e.pay(good.price, day, good.name)) return say(false, 'Not enough money.');
        const ticks = dog.care.ticks;
        const bitten = dog.wound > 0;
        dog.care.ticks = 0;
        dog.wound = 0;
        dog.bond = Math.min(100, dog.bond + 1);
        return say(true, `Dr. Aylin goes through his coat${ticks ? ` (${ticks} tick${ticks > 1 ? 's' : ''})` : ''}${bitten ? ' and cleans the bite' : ''}. “A fine dog. Keep him fed.”`);
      }
      case 'vetTonic':
        if (e.tonic) return say(false, 'You have tonight’s tonic already.');
        if (!e.pay(good.price, day, good.name)) return say(false, 'Not enough money.');
        e.tonic = true;
        return say(true, 'A brown bottle. “In their water tonight. They’ll thank you in the morning.”');
      case 'cay': {
        if (!e.pay(good.price, day, good.name)) return say(false, 'Not enough money, even for çay.');
        const r = RUMOURS[e.rumour % RUMOURS.length];
        e.rumour++;
        this.hour = Math.min(23.5, this.hour + 0.5);
        this.events.emit('teaServed', { x: shop.x, z: shop.z });
        return say(true, `Over çay: “${r}”`);
      }
    }
  }

  /** Within reach of Karabaş's bowl on the porch. */
  nearBowl(x: number, z: number): boolean {
    const b = this.dog.care.bowl;
    return Math.hypot(x - b.x, z - b.z) < 1.3;
  }

  /** Start a day's tasks from the current world, at the next morning. */
  startDay(day: number): void {
    this.closeDialogue();
    if (this.nightProbe) this.wolves.retire(this.nightProbe);
    this.tasks.dispose();
    const plan = day === 1 ? DAY1 : day === 2 ? day2Plan() : day === 3 ? DAY3 : day === 4 ? DAY4 : FREE_DAY;
    const report = this.nightReports.get(day - 1);
    const lost = report ? this.scatteredLastNight.filter((s) => this.flock.sheep.includes(s) && s.scattered) : [];
    this.tasks = new TaskSystem(this, lost.length ? [this.findScatteredTask(lost), ...plan] : plan, day);
    this.hour = config.time.startHour;
    this.residents.setTime(this.hour);
    this.errands.cancelWork();
    this.goldenHourAnnounced = false;
    // Waking at home: the satchel is refilled from the shelves.
    if (this.sleptAt === 'home') this.satchel.restock();
  }

  get sheepInPen(): number {
    return this.flock.sheep.filter((s) => insidePen(s.x, s.z, -0.3)).length;
  }

  sunsetTally(day = this.tasks.day): SunsetTally | undefined {
    return this.sunsetTallies.get(day);
  }

  get nightWolf(): Wolf | null {
    return this.nightProbe;
  }

  get nightWatchActive(): boolean {
    return this.nightProbe !== null && this.nightProbe.state !== 'flee';
  }

  get firstNightPending(): boolean {
    return this.tasks.day === 1 && this.tasks.enabled && !this.nightProbe;
  }

  private startFirstNight(): void {
    const pen = layout.pen;
    this.nightProbe = this.wolves.spawn(pen.x + 42, pen.z - 12, 'pen');
    this.nightWolfDay = this.tasks.day;
  }

  /** Any later night: a wolf comes out of the forest toward the pen. */
  private startNightWolf(): void {
    const pen = layout.pen;
    const den = layout.wolfDen;
    const ax = den.x - pen.x;
    const az = den.z - pen.z;
    const ad = Math.hypot(ax, az);
    this.nightProbe = this.wolves.spawn(pen.x + (ax / ad) * 60, pen.z + (az / ad) * 60, 'pen');
    this.nightWolfDay = this.tasks.day;
  }

  /** The night after `day`, if it has been resolved. */
  nightReport(day = this.tasks.day - 1): NightReport | undefined {
    return this.nightReports.get(day);
  }

  /**
   * Resolve the night while the shepherd sleeps. Sheep behind a closed gate are safe if
   * Karabaş is bonded; everything else is exposed. Wolves take a few (fewer with a good
   * dog, never more than three); others scatter away from the forest, to be found in the
   * morning. Deterministic (seeded).
   */
  private resolveNight(): NightReport {
    const nc = config.night;
    const day = this.tasks.day;
    const r = this.rand;
    const sheep = this.flock.sheep;
    const gateClosed = !this.gateOpen;
    const atHut = this.sleptAt === 'hut';
    const safe = (s: Sheep) => (atHut ? insideFold(s.x, s.z) : gateClosed && insidePen(s.x, s.z, -0.3));
    const exposed = sheep.filter((s) => !safe(s));
    const bond = Math.max(0, Math.min(100, this.dog.bond));
    // The first night forgives: what was left out scatters (to be found in the morning),
    // and the lesson is told, but nothing is taken while the shepherd is still learning.
    const mercy = day === 1;
    const pTake = mercy ? 0 : nc.exposedTakeChance * (1 - nc.guardStrength * (bond / 100));
    const taken: Sheep[] = [];
    const scattered: Sheep[] = [];
    let wounded = 0;
    for (const s of exposed) {
      // The weak go first.
      if (taken.length < nc.maxTaken && r() < pTake * (0.6 + 0.8 * (1 - s.condition / 100))) {
        taken.push(s);
        continue;
      }
      if (r() < nc.woundChance) {
        s.condition = Math.max(5, s.condition - config.condition.bite);
        wounded++;
      }
      if (r() < nc.scatterChance) scattered.push(s);
    }
    let penLoss = false;
    // A reinforced ağıl holds whatever the bond.
    if (!mercy && !this.economy.has('pen') && gateClosed && bond < nc.penRiskBondBelow && exposed.length < sheep.length && taken.length < nc.maxTaken) {
      if (r() < (nc.penRiskBondBelow - bond) / 100) {
        const victim = sheep.find((s) => safe(s) && !s.isLeader);
        if (victim) {
          taken.push(victim);
          penLoss = true;
        }
      }
    }

    // Scatter: away from the den, somewhere open.
    const den = layout.wolfDen;
    const [dMin, dMax] = nc.scatterDistance;
    for (const s of scattered) {
      const ax = s.x - den.x;
      const az = s.z - den.z;
      const base = Math.atan2(az, ax);
      for (let k = 0; k < 12; k++) {
        const a = base + (r() - 0.5) * 1.6;
        const d = dMin + r() * (dMax - dMin);
        const x = Math.max(-(layout.bounds.walk - 4), Math.min(layout.bounds.walk - 4, s.x + Math.cos(a) * d));
        const z = Math.max(-(layout.bounds.walk - 4), Math.min(layout.bounds.walk - 4, s.z + Math.sin(a) * d));
        if (this.obstacles.blocked(x, z, 0.8) || this.terrain.slopeDegAt(x, z) > 26 || insidePen(x, z, 2)) continue;
        s.x = s.px = x;
        s.z = s.pz = z;
        s.y = s.py = this.terrain.heightAt(x, z);
        break;
      }
      s.vx = s.vz = 0;
      s.isStray = true;
      s.strayTimer = config.flock.stray.seconds;
      s.scattered = true;
      s.stress = 45;
      s.inPen = insidePen(s.x, s.z, -0.3);
    }

    // Tracks: from the den toward the pen, then to where sheep were exposed.
    const target = exposed.length ? exposed.reduce((a, s) => ({ x: a.x + s.x / exposed.length, z: a.z + s.z / exposed.length }), { x: 0, z: 0 }) : { x: layout.pen.x + layout.pen.hx + 4, z: layout.pen.z };
    const tracks: { x: number; z: number; h: number }[] = [];
    const tx = target.x - den.x;
    const tz = target.z - den.z;
    const len = Math.hypot(tx, tz);
    const h = Math.atan2(tx, tz);
    for (let d = len * 0.35; d < len - 2; d += 1.6) {
      const wob = Math.sin(d * 0.08) * 3;
      tracks.push({ x: den.x + (tx / len) * d + Math.cos(h) * wob, z: den.z + (tz / len) * d - Math.sin(h) * wob, h });
    }

    const n = sheep.length;
    const outside = exposed.length;
    const reason =
      !atHut && !gateClosed && outside
        ? `The gate was left open: ${outside} sheep were exposed.`
        : outside
          ? `${outside} sheep spent the night outside the ${atHut ? 'fold' : 'pen'}.`
          : penLoss
            ? `Karabaş didn't hold the ${atHut ? 'fold' : 'pen'} (bond ${Math.round(bond)}). Pet and praise him.`
            : atHut
              ? `All ${n} sheep folded at the hut; you slept beside them and Karabaş kept watch.`
              : `All ${n} sheep penned behind a closed gate; Karabaş kept watch.`;
    const lesson = mercy && outside ? ' Karabaş drove the wolves off this first night. Next time, the ones left out may not come back.' : '';
    this.flock.remove(taken);
    this.scatteredLastNight = scattered;
    // A night's rest mends what the day wore down; the fold or pen mends more.
    const cc = config.condition;
    for (const s of this.flock.sheep) s.condition = Math.min(100, s.condition + (safe(s) ? cc.nightPenned : cc.nightOut));
    const di = config.dogInjury;
    if (this.dog.wound > 0) this.dog.wound = Math.max(0, this.dog.wound - (bond >= 50 ? di.healPerNight : di.healPerNightLowBond));
    // Milk: what wasn't sold has turned; tomorrow's milk is as good as today's grazing.
    this.sourMilk();
    this.economy.milkQuality = this.milkQuality();
    for (const w of this.economy.cheese) w.age++;
    // The vet's tonic, in their water last night.
    if (this.economy.tonic) {
      for (const s of this.flock.sheep) s.condition = Math.min(100, s.condition + config.village.vet.tonicCondition);
      this.economy.tonic = false;
    }
    // Heavy rain some nights washes old things out of the ruin's soil.
    const rained = this.weatherRand() < config.economy.rainChance;
    if (rained) this.washOutFinds();
    // His care: what he ate, whether you petted him, the ticks he carries.
    const dogNight = this.dog.care.night(!atHut);
    this.dog.bond = Math.max(0, Math.min(100, this.dog.bond + dogNight.bondChange));
    this.events.emit('dogNight', dogNight);
    this.water.rain(config.works.cisternRain);
    this.releaseRope();
    this.saltLick = null;
    this.brewing = 0;
    const report: NightReport = {
      day,
      exposed: outside,
      penned: n - outside,
      taken: taken.length,
      scattered: scattered.length,
      wounded,
      gateClosed,
      sleptAt: this.sleptAt,
      bond,
      reason: reason + lesson,
      tracks,
      dog: dogNight,
      rain: rained,
    };
    this.nightReports.set(day, report);
    this.events.emit('nightReport', { day, taken: taken.length, scattered: scattered.length, wounded, exposed: outside, reason });
    return report;
  }

  /** Morning task after a raid: bring back the sheep that scattered. */
  private findScatteredTask(lost: Sheep[]): TaskDef {
    const n = lost.length;
    return {
      id: 'scattered',
      title: `Find the ${n} sheep that scattered in the night`,
      how: 'Wolves came in the night. Follow their tracks from the forest, listen for bleating, or whistle Ara (Search) and follow Karabaş. Call them back to the flock.',
      update: (sim, st) => {
        const left = lost.filter((s) => sim.flock.sheep.includes(s) && s.scattered);
        const nearest = left.reduce<Sheep | null>((a, s) => (!a || Math.hypot(s.x - sim.player.pos.x, s.z - sim.player.pos.z) < Math.hypot(a.x - sim.player.pos.x, a.z - sim.player.pos.z) ? s : a), null);
        return {
          done: left.length === 0,
          progress: `${n - left.length}/${n} back with the flock`,
          nudge: st.t > 90 ? 'They ran away from the forest: look south and east of where they spent the night.' : undefined,
          target: st.t > 180 && nearest ? { x: nearest.x, z: nearest.z, label: 'bleating from' } : undefined,
        };
      },
    };
  }

  private recordSunset(): void {
    const day = this.tasks.day;
    if (this.sunsetTallies.has(day)) return;
    const inPen = this.sheepInPen;
    this.sunsetTallies.set(day, {
      inPen,
      safe: this.gateOpen ? 0 : inPen,
      total: this.flock.sheep.length,
      gateClosed: !this.gateOpen,
    });
  }

  /** Where you stand to use the cottage door. */
  get doorPos(): { x: number; z: number } {
    const h = layout.house;
    return { x: h.x, z: h.z - h.hz - 0.8 };
  }

  /** Uncle Ahmet's note within reach, if any (the nearest). */
  noteNear(x: number, z: number): AhmetNote | null {
    let best: AhmetNote | null = null;
    let bd: number = config.notes.reach;
    for (const n of activeMap().notes ?? []) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** Read a note: it adds his marks to the map the first time. */
  readNote(id: string): void {
    const first = !this.notesRead.has(id);
    this.notesRead.add(id);
    this.events.emit('noteRead', { id, first });
  }

  nearDoor(x: number, z: number): boolean {
    return Math.hypot(x - this.doorPos.x, z - this.doorPos.z) < 1.8;
  }

  /** Rest until the first night watch, or sleep once the day's work is done. */
  sleep(): boolean {
    if (!this.tasks.finished) return false;
    if (this.nightWatchActive) return false;
    // Sleep skips the remaining hours with the world frozen at bedtime.
    if (this.hour < SUNSET_HOUR) this.recordSunset();
    const p = this.player.pos;
    this.sleptAt = this.works.nearHutDoor(p.x, p.z) ? 'hut' : 'home';
    if (this.firstNightPending) {
      if (this.hour >= DAWN_HOUR && this.hour < FIRST_NIGHT_HOUR) this.hour = FIRST_NIGHT_HOUR;
      this.startFirstNight();
      this.events.emit('restedUntilDark', { day: this.tasks.day });
      return false;
    }
    this.resolveNight();
    const next = this.tasks.day + 1;
    this.startDay(next);
    this.events.emit('slept', { day: next });
    return true;
  }

  /** Unsold milk turns by evening. */
  private sourMilk(): void {
    const e = this.economy;
    const litres = e.churn + e.rackMilk;
    if (litres <= 0) return;
    e.churn = e.rackMilk = 0;
    this.events.emit('milkSoured', { litres });
  }

  /** Ids of the sheep that scattered last night (for the morning's search). */
  get scatteredIds(): number[] {
    return this.scatteredLastNight.map((s) => s.id);
  }

  /** Put the world back as a save left it, at dawn of its day (see core/save.ts). */
  restore(d: SaveData): void {
    this.reset();
    const e = this.economy;
    e.lira = d.economy.lira;
    Object.assign(e.herbs, d.economy.herbs);
    e.patches = d.economy.patches;
    e.chainOil = d.economy.chainOil;
    e.milkQuality = d.economy.milkQuality;
    e.rumour = d.economy.rumour;
    e.ledger.splice(0, e.ledger.length, ...d.economy.ledger);
    e.loadExtra(d.economy.extra ?? {});
    this.errands.load(d.errands);
    this.finds = ((d.economy.extra?.finds as typeof this.finds | undefined) ?? []).map((f) => ({ ...f, id: this.findSeq++ }));

    const dog = this.dog;
    dog.x = dog.px = dog.tx = d.dog.x;
    dog.z = dog.pz = dog.tz = d.dog.z;
    dog.y = dog.py = this.terrain.heightAt(d.dog.x, d.dog.z);
    dog.bond = d.dog.bond;
    dog.wound = d.dog.wound;
    Object.assign(dog.care, { satiety: d.dog.satiety, hydration: d.dog.hydration, ticks: d.dog.ticks, sack: d.dog.sack });
    dog.care.bowl.meals = d.dog.bowl;

    const b = this.bike;
    b.x = b.px = d.bike.x;
    b.z = b.pz = d.bike.z;
    b.heading = b.prevHeading = d.bike.heading;
    b.waterCans = d.bike.waterCans;
    Object.assign(b.care, {
      fuel: d.bike.fuel,
      plug: d.bike.plug,
      carb: d.bike.carb,
      chain: d.bike.chain,
      pressure: d.bike.pressure,
      leak: d.bike.leak,
      drum: d.bike.drum,
      odometerKm: d.bike.odometerKm,
    });
    b.y = this.terrain.heightAt(b.x, b.z);
    this.syncBikeBody(true);

    // The flock: who is left, and how they are.
    const saved = new Map(d.sheep.map((s) => [s.id, s]));
    this.flock.remove(this.flock.sheep.filter((s) => !saved.has(s.id)));
    for (const s of this.flock.sheep) {
      const v = saved.get(s.id)!;
      s.x = s.px = v.x;
      s.z = s.pz = v.z;
      s.y = s.py = this.terrain.heightAt(v.x, v.z);
      s.heading = s.prevHeading = v.heading;
      s.personality = v.personality;
      s.isLeader = v.isLeader;
      s.hunger = v.hunger;
      s.thirst = v.thirst;
      s.condition = v.condition;
      s.scattered = v.scattered;
      s.shorn = e.shornIds.has(s.id);
      s.inPen = insidePen(v.x, v.z);
      s.vx = s.vz = 0;
    }
    const leader = this.flock.sheep.find((s) => s.isLeader);
    if (leader) this.flock.leader = leader;

    unpackGrass(d.grass.value, this.grass.value);
    unpackGrass(d.grass.wear, this.grass.wear);
    this.grass.version++;

    for (const w of d.works.sites) {
      const site = this.works.sites.find((s) => s.id === w.id);
      if (!site) continue;
      site.progress = w.progress;
      if (w.built) this.finishWork(site, true);
    }
    this.works.cairns.push(...d.works.cairns);
    for (const w of d.water) this.water.restore(w.kind as never, w.name, w.x, w.z, w.radius, w.liters, w.capacity);

    this.satchel.slots = d.satchel.map((s) => ({ id: s.id, uses: s.uses < 0 ? Infinity : s.uses }));
    for (const n of d.notesRead) this.notesRead.add(n);
    for (const i of d.signsSeen) this.signsSeen.add(i);
    for (const v of d.visited) this.visited.add(v);
    this.sleptAt = d.sleptAt;
    this.setGate(d.gateOpen);
    if (d.lastNight) this.nightReports.set(d.day - 1, d.lastNight);
    this.scatteredLastNight = this.flock.sheep.filter((s) => d.scatteredIds.includes(s.id));
    this.startDay(d.day);
    if (d.midday) {
      // Part-way through the day: the clock, the tasks done, and the satchel as it was
      // (waking at home refills it; coming back at noon doesn't).
      this.hour = Math.min(d.midday.hour, SUNSET_HOUR + 0.5);
      this.goldenHourAnnounced = this.hour >= GOLDEN_HOUR;
      this.tasks.resumeAt(d.midday.task, d.midday.done, d.midday.t);
      this.satchel.slots = d.satchel.map((s) => ({ id: s.id, uses: s.uses < 0 ? Infinity : s.uses }));
    }
    this.residents.setTime(this.hour);
    this.teleport(d.player.x, d.player.z);
    this.events.emit('loaded', { day: d.day, hour: d.midday ? this.hour : undefined });
  }

  /** Throw away the physics world and rebuild everything from the same initial state. */
  reset(): void {
    this.world.free();
    this.build();
    this.events.emit('simReset', { tick: 0 });
  }

  setGate(open: boolean): void {
    this.gateOpen = open;
    this.gateCollider.setEnabled(!open);
    for (const o of this.obstacles.byRole('gate')) o.enabled = !open;
  }

  nearGate(x: number, z: number): boolean {
    return Math.hypot(x - this.gatePos.x, z - this.gatePos.z) < GATE_REACH;
  }

  private encounterNear() {
    const p = this.player.pos;
    const resident = this.residents.near(p);
    if (resident) return { resident } as const;
    const animal = this.wildlife.near(p);
    if (animal && !(this.observed?.animal === animal && this.tick < this.observed.until)) return { animal } as const;
    return null;
  }

  /** Ambient actions share the context prompt and yield to all existing interact targets. */
  get encounterPrompt(): string {
    if (this.bike.rider || this.brewing > 0 || this.hushing) return '';
    if (this.dialogue) return '';
    const near = this.encounterNear();
    if (near?.resident) return `talk to ${near.resident.profile.name}`;
    return near?.animal ? `watch the ${wildlifeNames[near.animal.species].toLowerCase()}` : '';
  }

  private interactWithLife(): boolean {
    const near = this.encounterNear();
    if (near?.resident) {
      const resident = near.resident;
      this.say(resident, resident.greeting(this.residentContext()), 'greet');
    } else if (near?.animal) {
      const animal = near.animal;
      this.observed = { animal, until: this.tick + 6 / SIM_DT };
      this.events.emit('encounter', { name: wildlifeNames[animal.species], text: animal.describe() });
    } else return false;
    return true;
  }

  private residentContext() {
    return { hour: this.hour, gateOpen: this.gateOpen, flockExposed: this.flock.sheep.length - this.sheepInPen >= 5 };
  }

  private say(resident: Resident, text: string, gesture: ResidentGesture, offer?: ResidentDialogue['offer']): void {
    const options: DialogueOption[] = [];
    const errand = this.errands.forResident(resident.id);
    const status = this.errands.status(resident.id);
    if (offer) {
      options.push({ id: 'accept', label: 'I’ll help' });
    } else if (errand) {
      options.push({ id: 'errand', label: status === undefined ? 'Is there anything I can do?' : 'Talk about the errand' });
    }
    options.push(
      { id: 'routine', label: 'What are you up to today?' },
      { id: 'advice', label: 'Any advice for the road?' },
      { id: 'leave', label: offer ? 'Maybe later' : 'See you later' },
    );
    resident.conversation = true;
    const seconds = voiceCues[resident.id][text]?.[1] ?? Math.min(8, Math.max(2.2, text.length / 19));
    resident.perform(gesture, seconds);
    this.dialogue = { resident, text, offer, options };
  }

  private closeDialogue(farewell = false): void {
    if (!this.dialogue) return;
    const { resident } = this.dialogue;
    resident.conversation = false;
    resident.perform('farewell', farewell ? 0.95 : 0);
    this.dialogue = null;
  }

  private reply(choice: DialogueChoice): void {
    const dialogue = this.dialogue;
    if (!dialogue?.options.some((option) => option.id === choice)) return;
    const { resident } = dialogue;
    if (choice === 'leave') {
      this.closeDialogue(true);
    } else if (choice === 'routine') {
      this.say(resident, resident.routine(), 'explain', dialogue.offer);
    } else if (choice === 'advice') {
      this.say(resident, resident.advice(this.residentContext()), 'explain', dialogue.offer);
    } else if (choice === 'accept') {
      const errand = this.errands.accept(resident.id);
      if (!errand) return;
      this.say(resident, errandDirection(errand.stops[0].place, true), 'thank');
      this.events.emit('errandChanged', { title: errand.title });
    } else {
      const errand = this.errands.forResident(resident.id);
      if (!errand) return;
      const status = this.errands.status(resident.id);
      if (status === undefined) this.say(resident, errand.offer, 'offer', errand);
      else {
        const stop = errand.stops[status];
        this.say(resident, stop ? errandDirection(stop.place) : errand.completedReply ?? errand.thanks,
          stop ? 'explain' : 'thank');
      }
    }
  }

  get errandTarget(): ErrandTarget | undefined {
    if (!this.riding && !this.hushing && this.brewing === 0) return this.errands.near(this.player.pos);
  }

  private finishErrandStop(target: ErrandTarget): void {
    const change = this.errands.advance(target);
    if (!change) return;
    const { errand, stop } = target;
    if (change.done) {
      this.economy.earn(errand.reward, this.tasks.day, errand.title);
      this.economy.reputation++;
    }
    const text = change.next ? `${stop.note} Next stop is ${change.next.place}.` : `${errand.thanks} +${errand.reward} ₺`;
    this.events.emit('encounter', { name: errand.title, text });
    this.events.emit('errandChanged', { title: errand.title });
  }

  /** The same action is used for feedback and for input. */
  get waterAction(): { kind: 'fill'; source: string } | { kind: 'pour'; x: number; z: number } | null {
    const b = this.bike;
    const p = this.player.pos;
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const distance = Math.hypot(dx, dz);
    if (b.rider || b.state !== 'parked' || distance > 4.5) return null;
    const inPen = insidePen(p.x, p.z);
    if (!this.gateOpen && insidePen(b.x, b.z) !== inPen) return null;
    const source = this.water.points.find((point) =>
      (point.kind === 'fountain' || point.kind === 'spring') &&
      Math.hypot(b.x - point.x, b.z - point.z) < 5.5 &&
      Math.hypot(p.x - point.x, p.z - point.z) < 6.5,
    );
    if (source) return b.waterCans < RACK_CANS ? { kind: 'fill', source: source.name } : null;
    if (!b.waterCans || distance < 1.1) return null;
    const basin = this.water.basinNear(p.x, p.z);
    if (basin) return { kind: 'pour', x: basin.x, z: basin.z };
    // Set the basin down away from both the bike and the shepherd's feet.
    const x = p.x + dx / distance * 1.65;
    const z = p.z + dz / distance * 1.65;
    if (insidePen(x, z) !== inPen || this.obstacles.blocked(x, z, 1.2) || this.terrain.slopeDegAt(x, z) >= 18) return null;
    return { kind: 'pour', x, z };
  }

  /** Move the shepherd to a ground position (debug teleport, tests). */
  teleport(x: number, z: number): void {
    const y = this.terrain.heightAt(x, z) + 0.05;
    const half = config.player.capsuleHalfHeight + config.player.capsuleRadius;
    const p = this.player;
    p.body.setTranslation({ x, y: y + half, z }, true);
    p.body.setNextKinematicTranslation({ x, y: y + half, z });
    p.vel.x = p.vel.z = 0;
    p.vy = 0;
    this.world.step();
    p.postStep();
    p.prev = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw };
  }

  /** Keep the bike's Rapier collider (so you bump into the parked bike) on its pose. */
  private syncBikeBody(teleport = false): void {
    const b = this.bike;
    const lying = b.state === 'fallen';
    const y = b.y + (lying ? 0.3 : 0.55);
    const h = b.heading / 2;
    const rot = lying
      ? (() => {
          // Yaw, then roll onto its side.
          const cy = Math.cos(h);
          const sy = Math.sin(h);
          const r = (b.fallSide * Math.PI) / 4;
          const cr = Math.cos(r);
          const sr = Math.sin(r);
          return { w: cy * cr, x: sy * sr, y: sy * cr, z: cy * sr };
        })()
      : { w: Math.cos(h), x: 0, y: Math.sin(h), z: 0 };
    if (teleport) {
      this.bikeBody.setTranslation({ x: b.x, y, z: b.z }, true);
      this.bikeBody.setRotation(rot, true);
    }
    this.bikeBody.setNextKinematicTranslation({ x: b.x, y, z: b.z });
    this.bikeBody.setNextKinematicRotation(rot);
    this.bikeCollider.setEnabled(!b.rider);
  }

  get riding(): boolean {
    return this.bike.rider;
  }

  nearBike(x: number, z: number): boolean {
    return Math.hypot(x - this.bike.x, z - this.bike.z) < config.bike.mountReach;
  }

  mount(): void {
    const b = this.bike;
    if (b.state !== 'parked' || b.rider) return;
    b.rider = true;
    b.state = 'riding';
    b.course = b.heading;
    b.footDown = 1;
    this.player.collider.setEnabled(false);
    this.events.emit('bikeMount', { on: true, tick: this.tick });
  }

  /** Get off (or be thrown off): set the shepherd down beside the bike. */
  dismount(): void {
    const b = this.bike;
    if (!b.rider) return;
    b.rider = false;
    if (b.state === 'riding') {
      b.state = 'parked';
      b.u = 0;
      b.stopEngine('off', this.tick);
    }
    const sx = Math.cos(b.heading);
    const sz = -Math.sin(b.heading);
    const side = b.state === 'fallen' ? -b.fallSide : 1;
    let px = b.x + sx * 1.3 * side;
    let pz = b.z + sz * 1.3 * side;
    if (this.obstacles.blocked(px, pz, 0.5) || this.terrain.slopeDegAt(px, pz) > 35) {
      px = b.x - sx * 1.3 * side;
      pz = b.z - sz * 1.3 * side;
    }
    this.player.collider.setEnabled(true);
    this.syncBikeBody(true);
    this.teleport(px, pz);
    this.events.emit('bikeMount', { on: false, tick: this.tick });
  }

  /** At home: in the yard or at the door (where the satchel can be repacked). */
  /** The job holding R at the parked bike would do now (fuel only at home, by the drum). */
  get bikeJob() {
    const b = this.bike;
    const h = layout.house;
    const e = this.economy;
    const churn = yardLayout(layout).churn;
    if (e.churn > 0 && Math.hypot(b.x - churn.x, b.z - churn.z) < 8) return BikeCare.job('milk');
    return b.care.nextJob(Math.hypot(b.x - h.x, b.z - h.z) < 30, { patches: e.patches, chainOil: e.chainOil });
  }

  get atHome(): boolean {
    const p = this.player.pos;
    return inYard(p.x, p.z, 4) || this.nearDoor(p.x, p.z);
  }

  private releaseRope(): void {
    if (this.ledSheep) this.ledSheep.led = false;
    this.ledSheep = null;
  }

  /** Use what's in a satchel slot. */
  useItem(slot: number): void {
    const sc = config.satchel;
    const it = this.satchel.slots[slot];
    const say = (ok: boolean, text: string, target?: { x: number; z: number }) =>
      this.events.emit('itemUsed', { item: it?.id ?? 'none', ok, text, target });
    if (!it) return say(false, 'That pocket of the satchel is empty.');
    if (it.uses <= 0) return say(false, `No ${ITEMS[it.id].name.toLowerCase()} left today. More at home.`);
    const p = this.player.pos;
    const spend = () => {
      if (Number.isFinite(it.uses)) it.uses--;
    };
    switch (it.id) {
      case 'salve': {
        const dog = this.dog;
        if (dog.wound > 0 && Math.hypot(dog.x - p.x, dog.z - p.z) < sc.reach) {
          dog.wound = 0;
          dog.bond = Math.min(100, dog.bond + 2);
          spend();
          return say(true, 'You salve Karabaş’s bite. He licks your hand.', dog);
        }
        let best: Sheep | null = null;
        for (const s of this.flock.sheep) {
          if (s.condition >= 95 || Math.hypot(s.x - p.x, s.z - p.z) > sc.reach) continue;
          if (!best || s.condition < best.condition) best = s;
        }
        if (!best) return say(false, 'Nobody within reach needs the salve.');
        best.condition = Math.min(100, best.condition + sc.salveHeal);
        spend();
        return say(true, 'You salve a ewe’s scrapes and bites.', best);
      }
      case 'rope': {
        if (this.ledSheep) {
          this.releaseRope();
          return say(true, 'You slip the rope off. She stays with the flock.');
        }
        let best: Sheep | null = null;
        let bd = sc.ropeReach;
        for (const s of this.flock.sheep) {
          const d = Math.hypot(s.x - p.x, s.z - p.z);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        if (!best) return say(false, 'No sheep within reach of the rope.');
        this.flock.freeNow(best, p);
        best.led = true;
        this.ledSheep = best;
        return say(true, 'On the rope: she follows at your heel.');
      }
      case 'salt': {
        this.saltLick = { x: p.x, z: p.z };
        spend();
        return say(true, 'You set the salt lick down. The flock will graze around it.');
      }
      case 'cay': {
        if (this.brewing > 0) return;
        this.brewing = sc.caySeconds;
        spend();
        return say(true, 'You sit down and brew çay…');
      }
      case 'bread': {
        const dog = this.dog;
        if (Math.hypot(dog.x - p.x, dog.z - p.z) > sc.reach) return say(false, 'Karabaş is too far away to feed by hand.');
        dog.care.feedByHand();
        dog.bond = Math.min(100, dog.bond + config.dogCare.handBond);
        spend();
        this.events.emit('dogFed', { how: 'hand', satiety: dog.care.satiety });
        return say(true, 'Karabaş takes the bread from your hand, gently, and licks the yoghurt off your fingers.', dog);
      }
    }
  }

  /** Çay is ready: half an hour has passed, everything nearby has settled. */
  private finishTea(): void {
    const sc = config.satchel;
    const p = this.player.pos;
    for (const s of this.flock.sheep) {
      if (Math.hypot(s.x - p.x, s.z - p.z) > sc.cayRadius) continue;
      s.stress = 0;
      s.condition = Math.min(100, s.condition + 5);
    }
    const dog = this.dog;
    dog.stamina = config.dog.stamina.max;
    dog.exhausted = false;
    if (Math.hypot(dog.x - p.x, dog.z - p.z) < sc.cayRadius) dog.bond = Math.min(100, dog.bond + sc.cayBond);
    this.events.emit('itemUsed', { item: 'cay', ok: true, text: 'Çay on the hillside. The flock has settled; Karabaş dozes at your feet.' });
  }

  /** Sling: a stone lobbed where the camera looks. */
  private throwStone(camYaw: number): void {
    const sc = config.sling;
    const p = this.player;
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const el = (sc.elevationDeg * Math.PI) / 180;
    p.yaw = camYaw;
    const st = { x: p.pos.x + fx * 0.5, y: p.pos.y + 1.6, z: p.pos.z + fz * 0.5, vx: fx * sc.speed * Math.cos(el), vy: sc.speed * Math.sin(el), vz: fz * sc.speed * Math.cos(el), t: 0 };
    this.stones.push(st);
    this.slingCooldown = sc.cooldown;
    this.events.emit('slingThrow', { x: st.x, y: st.y, z: st.z, tick: this.tick });
  }

  private updateStones(): void {
    const sc = config.sling;
    for (let i = this.stones.length - 1; i >= 0; i--) {
      const st = this.stones[i];
      st.t += SIM_DT;
      st.vy -= 9.81 * SIM_DT;
      st.x += st.vx * SIM_DT;
      st.y += st.vy * SIM_DT;
      st.z += st.vz * SIM_DT;
      const ground = this.terrain.heightAt(st.x, st.z);
      const hitSomething = st.y < ground + 2.5 && this.obstacles.blocked(st.x, st.z, 0.05);
      if (st.y > ground && !hitSomething && st.t < 5) continue;
      this.stones.splice(i, 1);
      this.events.emit('slingHit', { x: st.x, z: st.z, tick: this.tick });
      this.wolves.scare(st.x, st.z, sc.wolfRadius, sc.wolfMorale);
      this.flock.startleFrom(st.x, st.z, sc.sheepRadius, sc.sheepStress);
    }
  }

  /** A structure is finished: it stays in the world from now on. */
  private finishWork(site: WorkSite, silent = false): void {
    site.built = true;
    site.progress = 1;
    for (const prop of this.works.propsFor(site.id, this.terrain)) {
      this.obstacles.add(prop);
      this.world.createCollider(this.R.ColliderDesc.cuboid(prop.hx, prop.hy, prop.hz).setTranslation(prop.x, prop.y, prop.z));
    }
    if (site.id === 'cistern') {
      const c = layout.works.cistern;
      this.water.addCistern('the stone cistern', c.x, c.z, c.radius, config.works.cisternCapacity);
    }
    if (!silent) this.events.emit('built', { id: site.id, name: site.name, x: site.x, z: site.z, repair: site.repair });
  }

  /** Debug/tests: finish a structure at once. */
  buildNow(id: 'hut' | 'cistern'): void {
    const site = this.works.site(id);
    if (!site.built) this.finishWork(site);
  }

  /** Stack a cairn a step ahead of the shepherd. */
  private stackCairn(): void {
    const p = this.player;
    const x = p.pos.x - Math.sin(p.yaw) * 1.1;
    const z = p.pos.z - Math.cos(p.yaw) * 1.1;
    if (!this.works.canStack(x, z, this.terrain, (a, b, r) => this.obstacles.blocked(a, b, r))) {
      this.events.emit('itemUsed', { item: 'cairn', ok: false, text: this.works.cairns.length >= config.works.maxCairns ? 'You have stacked all the cairns you can.' : 'No good spot for a cairn here.' });
      return;
    }
    this.works.cairns.push({ x, z });
    this.events.emit('built', { id: 'cairn', name: 'a cairn', x, z });
  }

  /** Wolf signs, wolf ground, and first arrivals. */
  private updateLandmarks(): void {
    const p = this.player.pos;
    const tc = config.territory;
    layout.wolfSigns.forEach((sg, i) => {
      if (this.signsSeen.has(i) || Math.hypot(sg.x - p.x, sg.z - p.z) > tc.signSeenRange) return;
      this.signsSeen.add(i);
      this.events.emit('wolfSign', { index: i, x: sg.x, z: sg.z, kind: sg.kind });
    });

    // Lingering on wolf ground in daylight: Karabaş grows uneasy, then a wolf comes.
    const den = layout.wolfDen;
    const c = this.flock.centroid;
    const day = this.tasks.day;
    const daylight = this.hour >= DAWN_HOUR && this.hour < SUNSET_HOUR;
    const onWolfGround = this.flock.sheep.length > 0 && Math.hypot(c.x - den.x, c.z - den.z) < tc.radius;
    this.territoryTime = onWolfGround && daylight ? this.territoryTime + SIM_DT : Math.max(0, this.territoryTime - 2 * SIM_DT);
    if (this.territoryTime >= tc.warnSeconds && this.territoryWarnedDay !== day) {
      this.territoryWarnedDay = day;
      this.dog.bark('alert', this.tick, 0);
      this.events.emit('territoryWarn', { day });
    }
    if (this.territoryTime >= tc.wolfSeconds && this.territoryWolfDay !== day) {
      this.territoryWolfDay = day;
      const ax = den.x - c.x;
      const az = den.z - c.z;
      const ad = Math.max(1e-3, Math.hypot(ax, az));
      const d = Math.min(35, ad);
      this.wolves.spawn(c.x + (ax / ad) * d, c.z + (az / ad) * d);
    }

    for (const pl of layout.places) {
      if (this.visited.has(pl.id)) continue;
      const here = pl.by === 'player'
        ? Math.hypot(p.x - pl.x, p.z - pl.z) < pl.r
        : this.flock.sheep.length > 0 && Math.hypot(c.x - pl.x, c.z - pl.z) < pl.r;
      if (!here) continue;
      this.visited.add(pl.id);
      this.events.emit('arrival', { place: pl.id, label: pl.label });
    }
  }

  step(f: InputFrame): void {
    const p = this.player;
    const b = this.bike;
    // Sitting over çay: no walking off.
    if (this.brewing > 0) f = { ...f, moveX: 0, moveY: 0, sprint: false, crook: false, call: false, sling: false, item: -1, cairn: false };
    if (f.pack && !b.rider && this.atHome) {
      this.satchel.pack(f.pack);
      this.satchel.restock();
      this.events.emit('packed', { items: this.satchel.ids });
    }
    if (f.trade && !b.rider) this.trade(f.trade);
    if (f.water) {
      const action = this.waterAction;
      if (action?.kind === 'fill') b.waterCans = RACK_CANS;
      else if (action?.kind === 'pour') {
        this.water.pourCan(action.x, action.z);
        b.waterCans--;
      }
    }
    if (f.lamp && !b.rider) this.lanternOn = !this.lanternOn;
    // Working on the parked bike: hold R and the most urgent job gets done.
    const job = f.bikeWork && !b.rider && b.state === 'parked' && this.nearBike(p.pos.x, p.pos.z) ? this.bikeJob : null;
    if (job) {
      if (b.engineOn) b.stopEngine('off', this.tick);
      const done = b.care.work(job, SIM_DT);
      if (done === 'milk') {
        const e = this.economy;
        const litres = Math.min(e.churn, config.economy.churnLitres - e.rackMilk);
        e.rackMilk += litres;
        e.churn -= litres;
        this.events.emit('milkLoaded', { litres: e.rackMilk });
      } else if (done) {
        if (done === 'tyre') this.economy.patches--;
        if (done === 'chain') this.economy.chainOil--;
        this.events.emit('bikeRepaired', { job: done });
      }
    } else b.care.stopWork();
    const atGate = !b.rider && this.nearGate(p.pos.x, p.pos.z);
    if (f.interact && atGate) {
      this.setGate(!this.gateOpen);
      this.events.emit('gateInteract', { tick: this.tick });
    }
    const stuckNear = this.flock.sheep.some(
      (s) => s.stuck !== 'none' && Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < config.flock.stuck.freeReach,
    );

    // ---- building: hold E at a site's stakes
    const site = !b.rider && f.interactHeld && !atGate ? this.works.siteNear(p.pos.x, p.pos.z) : null;
    this.building = site;
    // ---- cairns: hold B
    if (f.cairn && !b.rider && !site) {
      this.works.cairnProgress += SIM_DT;
      if (this.works.cairnProgress >= config.works.cairnSeconds) {
        this.works.cairnProgress = 0;
        this.stackCairn();
      }
    } else this.works.cairnProgress = 0;
    if (f.item >= 0 && !b.rider) this.useItem(f.item);
    this.slingCooldown = Math.max(0, this.slingCooldown - SIM_DT);
    if (f.sling && !b.rider && this.slingCooldown === 0) this.throwStone(f.camYaw);
    if (this.ledSheep && !this.flock.sheep.includes(this.ledSheep)) this.ledSheep = null;

    // ---- the motorcycle
    let usedInteract = atGate || site !== null;
    if (b.rider) {
      if (f.interact) {
        this.dismount();
        usedInteract = true;
      } else {
        if (f.kick) b.kick(this.tick);
        if (f.lamp) b.lamp = !b.lamp;
        if (f.horn) this.horn();
      }
    } else if (!atGate && !stuckNear && this.nearBike(p.pos.x, p.pos.z)) {
      if (b.state === 'fallen') {
        // Hold E to heave it back up.
        b.liftProgress = f.interactHeld ? b.liftProgress + SIM_DT : 0;
        if (b.liftProgress >= config.bike.liftSeconds) b.lift();
        usedInteract = f.interactHeld;
      } else if (f.interact) {
        this.mount();
        usedInteract = true;
      }
    } else b.liftProgress = 0;
    const wasRiding = b.state === 'riding';
    b.care.inBrush = this.brushAt(b.x, b.z);
    b.care.hour = this.hour;
    const leaking = b.care.leak;
    b.step(SIM_DT, b.rider ? { throttle: f.throttle, brake: f.brake, steer: f.steer, weightShift: f.weightShift } : { throttle: 0, brake: 0, steer: 0, weightShift: 0 }, this.tick);
    if (b.care.leak && !leaking) this.events.emit('bikePuncture', { tick: this.tick });
    if (wasRiding && b.state === 'fallen') {
      this.lap.noteFall();
      if (b.rider) this.dismount(); // thrown off
    }
    this.syncBikeBody();

    if (b.rider) {
      // The shepherd sits on the bike: his body rides along, his own controller rests.
      const half = config.player.capsuleHalfHeight + config.player.capsuleRadius;
      p.prev = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw };
      p.body.setNextKinematicTranslation({ x: b.x, y: b.y + half, z: b.z });
      p.vel.x = b.vx;
      p.vel.z = b.vz;
      p.gait = 'idle';
      p.yaw = b.heading + Math.PI;
      this.world.step();
      p.postStep();
    } else {
      p.preStep(usedInteract ? { ...f, interact: false } : f, SIM_DT, this.tick);
      this.world.step();
      p.postStep();
    }
    const lapTime = this.lap.update(SIM_DT, b.rider && b.state === 'riding', b.x, b.z);
    if (lapTime >= 0) this.events.emit('lap', { seconds: lapTime, clean: this.lap.lastClean, best: this.lap.best, tick: this.tick });

    if (f.command) this.giveCommand(f.command, f.camYaw);

    // Uncle Ahmet's notes: an unread note comes before the bed (the letter lies on the
    // porch table by the door); one already read is only picked up again if nothing else wants E.
    const note = f.interact && !usedInteract && !b.rider ? this.noteNear(p.pos.x, p.pos.z) : null;
    if (note && !this.notesRead.has(note.id)) {
      this.readNote(note.id);
      usedInteract = true;
    }
    // A shop counter in the village: E opens the counter (the shop card).
    const shop = f.interact && !usedInteract && !b.rider ? this.shopNear(p.pos.x, p.pos.z) : null;
    if (shop) {
      this.events.emit('shopOpen', { shop: shop.id });
      usedInteract = true;
    }
    // Mehmet's goat: E ties her up.
    const goat = this.goat;
    if (f.interact && !usedInteract && !b.rider && goat && Math.hypot(goat.x - p.pos.x, goat.z - p.pos.z) < 2) {
      this.economy.job!.found = true;
      this.events.emit('goatFound', {});
      usedInteract = true;
    }
    // Shearing: hold E beside a penned sheep in summer; a fleece each, time runs fast.
    const toShear = f.interactHeld && !b.rider && !stuckNear ? this.sheepToShear(p.pos.x, p.pos.z) : null;
    this.shearingNow = toShear !== null;
    if (toShear) {
      if (toShear !== this.shearTarget) this.shearProgress = 0;
      this.shearTarget = toShear;
      toShear.vx = toShear.vz = 0;
      this.shearProgress += SIM_DT / config.village.wool.shearSeconds;
      if (this.shearProgress >= 1) {
        const e = this.economy;
        toShear.shorn = true;
        e.shornIds.add(toShear.id);
        e.fleeces++;
        e.woolValue += config.village.wool.price * (0.5 + toShear.condition / 200);
        this.shearProgress = 0;
        this.shearTarget = null;
        this.events.emit('sheared', { fleeces: e.fleeces, left: this.flock.sheep.filter((s) => !s.shorn).length });
      }
    } else {
      this.shearProgress = 0;
      this.shearTarget = null;
    }
    // A find at the ruin: E picks it up.
    const find = f.interact && !usedInteract && !b.rider ? this.findNear(p.pos.x, p.pos.z) : null;
    if (find) {
      this.finds = this.finds.filter((x) => x !== find);
      this.economy.artifacts.push({ kind: find.kind, value: find.value });
      this.events.emit('found', { name: ARTIFACTS[find.kind].name });
      usedInteract = true;
    }
    // The cheese press: hold E with milk in the churn; an hour's work.
    this.pressingNow = f.interactHeld && !b.rider && this.canPress(p.pos.x, p.pos.z);
    if (this.pressingNow) {
      const cc = config.economy.cheese;
      this.pressProgress += SIM_DT / cc.pressSeconds;
      if (this.pressProgress >= 1) {
        const e = this.economy;
        this.pressProgress = 0;
        const wheels = Math.min(Math.floor(e.churn / cc.litresPerWheel), cc.shelf - e.cheese.length);
        for (let i = 0; i < wheels; i++) e.cheese.push({ quality: e.milkQuality, age: 0 });
        e.churn = Math.round((e.churn - wheels * cc.litresPerWheel) * 10) / 10;
        this.pressingNow = false;
        this.events.emit('pressed', { wheels, shelf: e.cheese.length });
      }
    } else this.pressProgress = 0;
    // A herb patch: E picks a bundle (it grows back by tomorrow).
    const herb = f.interact && !usedInteract && !b.rider ? this.herbNear(p.pos.x, p.pos.z) : null;
    if (herb) {
      this.economy.herbs[herb.kind]++;
      this.herbsPicked.set(herb.id, this.tasks.day);
      this.events.emit('herbPicked', { kind: herb.kind, name: HERBS[herb.kind].name });
      usedInteract = true;
    }
    // Milking: hold E at the stand in the ağıl in the morning; time runs fast while you work.
    this.milkingNow = f.interactHeld && !b.rider && this.canMilk(p.pos.x, p.pos.z);
    if (this.milkingNow) {
      const e = this.economy;
      e.milking += SIM_DT / config.economy.milkSeconds;
      if (e.milking >= 1) {
        e.milking = 0;
        e.milkedDay = this.tasks.day;
        e.churn = Math.min(config.economy.churnLitres, Economy.milkYield(this.sheepInPen, e.milkQuality));
        this.milkingNow = false;
        this.events.emit('milked', { litres: e.churn, quality: e.milkQuality });
      }
    } else this.economy.milking = 0;
    // His bowl on the porch: E fills it from the sack.
    if (f.interact && !usedInteract && !b.rider && this.nearBowl(p.pos.x, p.pos.z)) {
      const care = this.dog.care;
      if (care.fillBowl()) this.events.emit('bowlFilled', { sackLeft: care.sack });
      else this.events.emit('itemUsed', { item: 'bowl', ok: false, text: care.bowl.meals > 0 ? 'His bowl is already full.' : 'The sack is empty.' });
      usedInteract = true;
    }
    const atBed = f.interact && !usedInteract && !b.rider && (this.nearDoor(p.pos.x, p.pos.z) || this.works.nearHutDoor(p.pos.x, p.pos.z));
    if (atBed || f.rest) this.sleep();
    usedInteract ||= atBed;
    if (note && !usedInteract) {
      this.readNote(note.id);
      usedInteract = true;
    }

    // Petting: E next to the dog, unless the gate, a stuck sheep or the bike needs the hands.
    const dog = this.dog;
    const dogDist = Math.hypot(dog.x - p.pos.x, dog.z - p.pos.z);
    const resident = this.dialogue?.resident;
    if (resident && (b.rider || this.brewing > 0 || f.hush || f.rest || !resident.withinConversation(p.pos))) this.closeDialogue();
    if (usedInteract && f.interact) this.closeDialogue();
    if (this.dialogue && f.dialogue && (!f.interact || !usedInteract)) {
      this.reply(f.dialogue);
      usedInteract = true;
    }
    let workingErrand = false;
    if ((f.interact || f.interactHeld) && !usedInteract && !b.rider && !stuckNear) {
      const wantsCare = dogDist < 2.5 && (dog.praiseTimer > 0 || dog.care.ticks > 0 || !dog.care.pettedToday);
      const atWork = this.works.siteNear(p.pos.x, p.pos.z) || this.canMilk(p.pos.x, p.pos.z)
        || this.canPress(p.pos.x, p.pos.z) || this.sheepToShear(p.pos.x, p.pos.z)
        || this.milkingNow || this.pressingNow || this.shearingNow;
      const canMeet = !wantsCare && !atWork && !this.nearBike(p.pos.x, p.pos.z)
        && !f.hush && !f.rest && this.brewing === 0;
      const target = canMeet ? this.errands.near(p.pos) : undefined;
      if (target?.stop.seconds && f.interactHeld) {
        this.closeDialogue();
        workingErrand = true;
        if (this.errands.work(target, SIM_DT)) this.finishErrandStop(target);
      } else if (f.interact) {
        if (target && !target.stop.seconds) {
          this.closeDialogue();
          this.finishErrandStop(target);
        } else if (this.dialogue && !target) this.reply('leave');
        else if (!target && (!canMeet || !this.interactWithLife()) && dogDist < 2.5) dog.pet(this.tick);
      }
    }
    if (!workingErrand) this.errands.cancelWork();
    // Hold E beside him: he lies still while you pick the ticks off, one by one.
    if (f.interactHeld && !b.rider && !stuckNear && !this.building && dog.care.ticks > 0 && dogDist < config.dogCare.pickReach) {
      dog.heldStill = 0.3;
      if (dog.care.pick(SIM_DT)) this.events.emit('tickPicked', { left: dog.care.ticks });
    } else dog.care.pickProgress = 0;

    this.flock.gateOpen = this.gateOpen;
    this.hushing = f.hush && !b.rider;
    const hush = this.hushing ? { x: p.pos.x, z: p.pos.z, radius: config.night.hushRadius } : null;
    this.updateStones();
    this.wolves.step(SIM_DT, this.tick, this.flock, { x: dog.x, z: dog.z, barking: dog.barkingRecently, charging: dog.charging }, p.pos, hush);
    dog.step({
      dt: SIM_DT,
      tick: this.tick,
      flock: this.flock,
      wolves: this.wolves,
      player: { x: p.pos.x, z: p.pos.z, yaw: p.yaw },
      rand: this.rand,
      water: this.water.points,
    });
    // Driving a wolf off at close quarters can cost Karabaş a bite.
    const di = config.dogInjury;
    if (dog.wound === 0 && dog.charging) {
      for (const w of this.wolves.active()) {
        const collar = this.economy.has('spikedCollar') ? config.economy.upgrade.spikedCollarBite : 1;
        if (Math.hypot(w.x - dog.x, w.z - dog.z) < di.range && w.morale > 20 && this.injuryRand() < di.biteChancePerSec * collar * SIM_DT) {
          dog.wound = 100;
          w.morale -= 30;
          this.events.emit('dogHurt', { tick: this.tick });
          break;
        }
      }
    }

    // Karabaş's care: hunger, thirst (worse in the midday heat), ticks in the brush.
    {
      dog.care.tickFactor = this.economy.has('tickCollar') ? config.economy.upgrade.tickCollar : 1;
      dog.collar = this.economy.has('spikedCollar') ? 'spiked' : this.economy.has('tickCollar') ? 'tick' : '';
      this.bike.care.offroad = this.economy.has('tyres');
      const h = this.hour;
      const heat = Math.max(0, Math.min(1, (h - 11) / 1.5, (16.5 - h) / 1.5));
      const moving = dog.speed > 0.3;
      if (dog.care.step((SIM_DT / config.time.secondsPerHour) * this.timeRate, dog.running, heat, moving && this.brushAt(dog.x, dog.z)))
        this.events.emit('dogTick', { ticks: dog.care.ticks });
    }

    // Building and çay make the hours fly.
    this.timeRate = this.building
      ? config.works.buildTimeRate
      : this.milkingNow
        ? (config.economy.milkHours * config.time.secondsPerHour) / config.economy.milkSeconds
        : this.shearingNow
          ? (config.village.wool.shearHours * config.time.secondsPerHour) / config.village.wool.shearSeconds
        : this.pressingNow
          ? (config.economy.cheese.pressHours * config.time.secondsPerHour) / config.economy.cheese.pressSeconds
      : this.brewing > 0
        ? (config.satchel.cayHours * config.time.secondsPerHour) / config.satchel.caySeconds
        : 1;
    const hours = (SIM_DT / config.time.secondsPerHour) * this.timeRate;
    if (this.building) {
      this.building.progress += hours / this.building.hours;
      if (this.building.progress >= 1) {
        this.finishWork(this.building);
        this.building = null;
      }
    }
    if (this.brewing > 0) {
      this.brewing -= SIM_DT;
      if (this.brewing <= 0) {
        this.brewing = 0;
        this.finishTea();
      }
    }
    this.flock.step({
      player: { x: p.pos.x, z: p.pos.z, vx: p.vel.x, vz: p.vel.z, gait: p.gait },
      frame: f,
      tick: this.tick,
      dt: SIM_DT,
      hours,
      hot: this.hour >= 11 && this.hour < 16,
      hush,
      salt: this.saltLick ? { ...this.saltLick, radius: config.satchel.saltRadius } : null,
      water: this.water,
      interactUsedByGate: atGate,
      dog: { x: dog.x, z: dog.z, vx: dog.vx, vz: dog.vz, resting: dog.resting, pushX: dog.pushX, pushZ: dog.pushZ, gathering: dog.active === 'command' && dog.command === 'gather' },
      wolves: this.wolves.active(),
      bike: { x: b.x, z: b.z, vx: b.vx, vz: b.vz, heading: b.heading, noise: b.noise },
    });
    this.hornTime = Math.max(0, this.hornTime - SIM_DT);
    const honking = this.hornTime > 0;
    this.residents.step(SIM_DT, {
      player: p.pos, playerSpeed: Math.hypot(p.vel.x, p.vel.z), rider: b.rider,
      dog, bike: b, sheep: this.flock.sheep, hour: this.hour, honking,
    });
    this.wildlife.step(SIM_DT, {
      player: p.pos, gait: p.gait, dog, dogRunning: dog.running || dog.charging,
      bike: b, bikeRunning: b.engineOn, honking, hour: this.hour,
    });
    if (this.tick % GRASS_EVERY_TICKS === GRASS_EVERY_TICKS - 1) this.grass.grow(hours * GRASS_EVERY_TICKS);
    // Scattered sheep count as found once they are back with the flock.
    for (const s of this.flock.sheep) if (s.scattered && !s.isStray) s.scattered = false;
    this.updateLandmarks();
    this.tasks.step();

    this.tick++;
    const previousHour = this.hour;
    const nextHour = previousHour + hours;
    this.hour = nextHour % 24;
    if (!this.goldenHourAnnounced && previousHour < GOLDEN_HOUR && nextHour >= GOLDEN_HOUR) {
      this.goldenHourAnnounced = true;
      this.events.emit('goldenHour', { day: this.tasks.day });
    }
    if (previousHour < SUNSET_HOUR && nextHour >= SUNSET_HOUR) this.recordSunset();
    if (previousHour < config.economy.milkSoursAt && nextHour >= config.economy.milkSoursAt) this.sourMilk();
    if (this.firstNightPending && previousHour < FIRST_NIGHT_HOUR && nextHour >= FIRST_NIGHT_HOUR) {
      this.startFirstNight();
    } else if (
      this.tasks.enabled &&
      this.tasks.day > 1 &&
      this.nightWolfDay !== this.tasks.day &&
      previousHour < FIRST_NIGHT_HOUR &&
      nextHour >= FIRST_NIGHT_HOUR &&
      !this.works.nearHutDoor(p.pos.x, p.pos.z) &&
      !(this.works.built('hut') && Math.hypot(p.pos.x - this.works.hutDoor.x, p.pos.z - this.works.hutDoor.z) < 30)
    ) {
      // Stay up past dark and a wolf comes from the forest, every night (not out at the hut).
      this.startNightWolf();
    }
    if (this.tasks.enabled && this.howledDay !== this.tasks.day && previousHour < config.night.howlHour && nextHour >= config.night.howlHour) {
      this.howledDay = this.tasks.day;
      this.events.emit('howl', { x: layout.wolfDen.x, z: layout.wolfDen.z, day: this.tasks.day });
      this.dog.bark('alert', this.tick, 0);
    }
  }

  /** The bike's horn: sheep jump, wolves lose their nerve. */
  horn(): void {
    const b = this.bike;
    const bc = config.bike;
    this.hornTime = 1.5;
    this.events.emit('bikeHorn', { x: b.x, z: b.z, tick: this.tick });
    this.flock.startle(b.x, b.z, bc.hornRadius, 15);
    this.wolves.scare(b.x, b.z, bc.hornRadius, bc.hornWolfMorale);
  }

  /**
   * Route a command: a silent hand gesture if the dog is close and in sight, a whistle
   * if he is within earshot, otherwise nobody hears it. Whistles startle nearby sheep.
   */
  giveCommand(command: DogCommand, aimYaw: number): void {
    const dc = config.dog;
    const p = this.player.pos;
    const cm = this.commandMode();
    const mode = cm === 'gesture' ? 'gesture' : 'whistle';
    const heard = cm !== 'unheard';
    this.events.emit('dogCommand', { command, mode, origin: { ...p }, heard, tick: this.tick });
    if (mode === 'whistle') this.flock.startle(p.x, p.z, dc.whistleStartleRadius, dc.whistleStress);
    if (heard) this.dog.receive(command, aimYaw, { tick: this.tick, rand: this.rand, player: p });
  }

  /** How a command given right now would reach the dog. */
  commandMode(): 'gesture' | 'whistle' | 'unheard' {
    const dc = config.dog;
    const p = this.player.pos;
    const d = this.dog;
    const dist = Math.hypot(d.x - p.x, d.z - p.z);
    if (dist < dc.gestureRange && this.lineOfSight(p.x, p.y + 1.6, p.z, d.x, d.y + 0.6, d.z)) return 'gesture';
    return dist < dc.whistleRange ? 'whistle' : 'unheard';
  }

  /** Nothing solid (terrain, fences, trees) between two points. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return true;
    const ray = new this.R.Ray({ x: ax, y: ay, z: az }, { x: dx / len, y: dy / len, z: dz / len });
    const hit = this.world.castRay(ray, len, true, undefined, undefined, this.player.collider);
    return !hit || hit.timeOfImpact > len - 0.4;
  }

  /** Debug/test: a wolf comes out of the forest edge, or from (x, z). */
  spawnWolf(x?: number, z?: number) {
    const c = this.flock.centroid;
    if (x === undefined || z === undefined) {
      // 70 m from the flock, toward the wolves' den.
      const ax = layout.wolfDen.x - c.x;
      const az = layout.wolfDen.z - c.z;
      const ad = Math.max(1e-3, Math.hypot(ax, az));
      x = c.x + (ax / ad) * 70;
      z = c.z + (az / ad) * 70;
    }
    return this.wolves.spawn(x, z);
  }

  /** Compact, exact description of the state, for determinism checks. */
  stateKey(): string {
    const p = this.player;
    return JSON.stringify([
      this.tick,
      this.hour,
      this.goldenHourAnnounced,
      this.lanternOn,
      this.bike.waterCans,
      this.water.stateKey(),
      this.nightProbe?.state,
      this.nightWolfDay,
      [...this.nightReports.keys()],
      [...this.sunsetTallies],
      p.pos.x,
      p.pos.y,
      p.pos.z,
      p.yaw,
      p.vel.x,
      p.vel.z,
      p.grounded,
      this.gateOpen,
      this.flock.stateKey(),
      this.dog.stateKey(),
      this.wolves.stateKey(),
      this.tasks.stateKey(),
      this.bike.stateKey(),
      this.satchel.stateKey(),
      this.works.stateKey(),
      this.dog.care.stateKey(),
      this.bike.care.stateKey(),
      this.economy.stateKey(),
      [...this.herbsPicked],
      this.finds.map((f) => [f.kind, f.value, f.x, f.z]),
      this.stones.length,
      this.ledSheep?.id ?? -1,
      this.saltLick,
      this.brewing,
      this.signsSeen.size,
      this.territoryTime,
      this.visited.size,
      [...this.notesRead],
      this.sleptAt,
    ]);
  }
}

// The economy (GDD feature 6, "Economy & village life"): a purse of lira, what the flock and
// the hills give (milk, herbs), and what the village sells back (kibble, fuel, parts, çay).
// Deliberately tight in the first season. Headless; the sim applies purchases to the dog,
// the bike and the shepherd, and the shop card shows the counter.

import { config } from '../core/config';

export type ShopId = 'dairy' | 'bakkal' | 'usta' | 'kahvehane' | 'muze' | 'dealer' | 'vet';
export type HerbId = 'thyme' | 'sage' | 'tea';

export const HERBS: Record<HerbId, { name: string; price: number }> = {
  thyme: { name: 'wild thyme', price: config.economy.herbPrice.thyme },
  sage: { name: 'sage', price: config.economy.herbPrice.sage },
  tea: { name: 'mountain tea', price: config.economy.herbPrice.tea },
};

export type UpgradeId = 'tickCollar' | 'spikedCollar' | 'pen' | 'tyres' | 'press';
export type GoodId = 'kibble' | 'tankFuel' | 'jerrycan' | 'patches' | 'chainOil' | 'cay' | 'vetDog' | 'vetTonic' | UpgradeId;

/** Kahvehane errands, offered one at a time, round and round. */
export type JobId = 'thyme' | 'goat' | 'wedding';
export const JOB_ORDER: JobId[] = ['thyme', 'goat', 'wedding'];
export const JOBS: Record<JobId, { title: string; ask: string; done: string }> = {
  thyme: {
    title: 'Thyme for Kemal’s tea',
    ask: `My tea wants wild thyme, and my knees won’t climb to it. Bring me ${config.village.jobs.thymeBundles} bundles from the dry hills.`,
    done: 'Kemal sniffs the bundles and smiles. “Your uncle used to bring me these.”',
  },
  goat: {
    title: 'Mehmet’s goat',
    ask: 'Mehmet’s goat broke her rope and ran into the maquis. Find her and tie her up; he’ll fetch her. She’s brown, with a bell.',
    done: 'Mehmet is at the next table. He stands, shakes your hand and won’t let you pay for the çay.',
  },
  wedding: {
    title: 'Cheese for the wedding',
    ask: `There’s a wedding on the square and Fatma Hanım’s cheese has run out. Bring ${config.village.jobs.weddingWheels} aged wheels and they’ll pay well.`,
    done: 'The bride’s father counts out the money in front of everyone. The village will remember who saved the wedding.',
  },
};

/** Things that turn up at the ruin after heavy rain. */
export type ArtifactKind = 'coin' | 'lamp' | 'fragment';
export const ARTIFACTS: Record<ArtifactKind, { name: string; value: [number, number]; weight: number }> = {
  coin: { name: 'a bronze coin', value: [20, 60], weight: 0.6 },
  lamp: { name: 'a clay oil lamp', value: [80, 150], weight: 0.3 },
  fragment: { name: 'an inscribed fragment', value: [200, 500], weight: 0.1 },
};
export interface Artifact {
  kind: ArtifactKind;
  value: number;
}

/** What the curator tells you, and adds to your map, for each thing you give the museum. */
export const MUSEUM_LORE = [
  'This coin came from the old market road. It ran past your uncle’s dry pasture, straight to the cistern the Romans built. I will mark it for you.',
  'A lamp like this burned in a shrine. There was a spring in the pines above the ruin, sacred once. It still runs in spring.',
  'Look: a name, and the word for “shepherd”. Someone kept flocks on your hill two thousand years ago. Their fold stood on the lookout’s east shoulder.',
];

export interface Good {
  id: GoodId;
  shop: ShopId;
  name: string;
  price: number;
  /** One line for the counter. */
  what: string;
}

const P = config.economy.prices;
export const GOODS: Good[] = [
  { id: 'kibble', shop: 'bakkal', name: 'A sack of kibble', price: P.kibble, what: `${config.dogCare.sackMeals} meals for Karabaş, into the sack by the porch.` },
  { id: 'tankFuel', shop: 'usta', name: 'Fill the tank', price: P.fuelPerLitre, what: 'Two-stroke mix straight into the bike, per litre.' },
  { id: 'jerrycan', shop: 'usta', name: 'A jerrycan for the drum', price: P.jerrycan, what: `${config.economy.jerrycanLitres} L, tipped into the drum at home.` },
  { id: 'patches', shop: 'usta', name: 'Tyre patches', price: P.patches, what: `${config.economy.patchesPerKit} patches and a tube of glue.` },
  { id: 'chainOil', shop: 'usta', name: 'Chain oil', price: P.chainOil, what: `A bottle: ${config.economy.chainOilUses} oilings.` },
  { id: 'cay', shop: 'kahvehane', name: 'A glass of çay', price: P.cay, what: 'Sit a while. Somebody always has news.' },
  { id: 'vetDog', shop: 'vet', name: 'Look Karabaş over', price: config.village.vet.dog, what: 'She picks off his ticks and sees to any bite. Bring him with you.' },
  { id: 'vetTonic', shop: 'vet', name: 'A tonic for the flock', price: config.village.vet.tonic, what: 'In their water tonight: every sheep wakes stronger.' },
  { id: 'tickCollar', shop: 'bakkal', name: 'A tick collar', price: P.tickCollar, what: 'Karabaş picks up a quarter of the ticks.' },
  { id: 'press', shop: 'dairy', name: 'A cheese press', price: P.press, what: 'Press the morning milk into wheels at home; they fetch more after three days.' },
  { id: 'spikedCollar', shop: 'usta', name: 'A spiked collar (tasma)', price: P.spikedCollar, what: 'Iron spikes round his neck: a wolf can hardly bite him.' },
  { id: 'tyres', shop: 'usta', name: 'Off-road tyres', price: P.tyres, what: 'Thick tread: fewer punctures in the maquis, more grip in mud.' },
  { id: 'pen', shop: 'usta', name: 'A reinforced ağıl', price: P.pen, what: 'Usta Remzi’s boys raise the walls and add a stout gate: a closed pen is safe whatever the bond.' },
];

export const UPGRADES = new Set<GoodId>(['tickCollar', 'spikedCollar', 'pen', 'tyres', 'press']);

export const SHOPS: Record<ShopId, { name: string; keeper: string; greeting: string }> = {
  dairy: { name: 'the dairy', keeper: 'Fatma Hanım', greeting: 'Fresh milk only. What turns by evening, I can’t take.' },
  bakkal: { name: 'the bakkal', keeper: 'Hüseyin Efendi', greeting: 'Kibble, flour, oil. And I buy herbs, if they’re dry and clean.' },
  usta: { name: 'the mechanic', keeper: 'Usta Remzi', greeting: 'Your uncle’s old machine! I know every bolt of her.' },
  kahvehane: { name: 'the kahvehane', keeper: 'Kemal', greeting: 'Sit, sit. Çay is coming.' },
  muze: { name: 'the museum', keeper: 'Selim Bey, the curator', greeting: 'Every piece tells me something about this valley. I pay what the ministry allows.' },
  vet: { name: 'the vet’s table', keeper: 'Dr. Aylin, the vet', greeting: 'Thursdays I’m here till evening. Who’s poorly?' },
  dealer: { name: 'the back room', keeper: 'a man who doesn’t give his name', greeting: 'Old things? I pay well. I don’t ask where.' },
};

/** What the old men at the kahvehane say over çay, in turn. */
export const RUMOURS = [
  'The wolves were seen at the edge of the pines above the forest pasture. Two of them, a grey and a dark one.',
  'After the last big rain, Mehmet’s boy found a coin in the ruins. Bronze, with a horse on it. The museum man was very pleased.',
  'Fatma Hanım pays more for milk from a flock that ate and drank well. She can taste it, she says.',
  'Usta Remzi says a spark plug wants cleaning every few days on gravel roads. Nobody listens.',
  'Thyme grows best on the dry hills by your uncle’s pasture without water. Mountain tea only high up, on the lookout.',
  'Ahmet’s dog was the best on this side of the valley. He won’t eat from a stranger’s hand until he trusts you.',
];

export interface LedgerLine {
  day: number;
  text: string;
  /** Lira in (+) or out (−). */
  amount: number;
}

export class Economy {
  lira = config.economy.startLira;
  readonly herbs: Record<HerbId, number> = { thyme: 0, sage: 0, tea: 0 };
  /** Repair supplies: tyre patches, chain-oil uses. */
  patches = config.economy.startPatches;
  chainOil = config.economy.startChainOil;
  /** Litres waiting in the churn by the ağıl, and in the churn on the bike's rack. */
  churn = 0;
  rackMilk = 0;
  /** 0.5..1.2: how well the flock ate and drank yesterday (Fatma Hanım can taste it). */
  milkQuality = 1;
  /** The day the ewes were last milked, and how far the milking is (0..1). */
  milkedDay = -1;
  milking = 0;
  /** Which rumour the kahvehane tells next. */
  rumour = 0;
  /** Finds from the ruin, carried in the satchel's inner pocket. */
  artifacts: Artifact[] = [];
  /** Pieces given to the museum (each tells a little and adds to the map). */
  museumGiven = 0;
  readonly upgrades = new Set<UpgradeId>();
  /** Cheese wheels on the ageing shelf: quality and days aged. */
  cheese: { quality: number; age: number }[] = [];
  /** Standing in the village: one point per errand done (shops give a little off). */
  reputation = 0;
  /** The errand in hand, if any (`found`: the goat is tied up). */
  job: { id: JobId; spot?: { x: number; z: number }; found?: boolean } | null = null;
  /** Errands done, and the day the next one can be asked for. */
  jobsDone = 0;
  nextJobDay = 0;
  /** Fleeces from this summer's shearing, and what they will fetch. */
  fleeces = 0;
  woolValue = 0;
  readonly shornIds = new Set<number>();
  /** The vet's tonic is in tonight's water. */
  tonic = false;

  /** The price after the village's goodwill. */
  discounted(price: number): number {
    const r = config.village.reputation;
    return Math.round(price * (1 - r.discountPer * Math.min(r.max, this.reputation)));
  }

  /** The errand Kemal offers next (the wedding needs a cheese press). */
  nextJob(): JobId {
    for (let k = 0; k < JOB_ORDER.length; k++) {
      const id = JOB_ORDER[(this.jobsDone + k) % JOB_ORDER.length];
      if (id !== 'wedding' || this.has('press')) return id;
    }
    return 'thyme';
  }

  /** What an errand pays, rising each time round the list. */
  jobReward(id: JobId): number {
    const j = config.village.jobs;
    return Math.round(j[id] * (1 + j.growth * Math.floor(this.jobsDone / JOB_ORDER.length)));
  }

  has(u: UpgradeId): boolean {
    return this.upgrades.has(u);
  }

  /** Price of a wheel today: fresh ones fetch the base, aged ones more, good milk more again. */
  static cheesePrice(w: { quality: number; age: number }): number {
    const c = config.economy.cheese;
    const aged = Math.min(1, w.age / c.ageDays);
    return Math.round((c.fresh + (c.aged - c.fresh) * aged) * w.quality);
  }
  readonly ledger: LedgerLine[] = [];

  /** Spend if there is enough. */
  pay(amount: number, day: number, text: string): boolean {
    if (amount > this.lira + 1e-9) return false;
    this.lira -= amount;
    this.note(day, text, -amount);
    return true;
  }

  earn(amount: number, day: number, text: string): void {
    this.lira += amount;
    this.note(day, text, amount);
  }

  private note(day: number, text: string, amount: number): void {
    this.ledger.push({ day, text, amount: Math.round(amount) });
    if (this.ledger.length > 30) this.ledger.shift();
  }

  get herbCount(): number {
    return this.herbs.thyme + this.herbs.sage + this.herbs.tea;
  }

  /** Milk yield for a flock of `ewes` at this quality, litres. */
  static milkYield(ewes: number, quality: number): number {
    return Math.round(ewes * config.economy.litresPerEwe * quality * 10) / 10;
  }

  /** Later slices' state for the save (artifacts, cheese, upgrades). */
  saveExtra(): Record<string, unknown> {
    return {
      artifacts: this.artifacts,
      museumGiven: this.museumGiven,
      upgrades: [...this.upgrades],
      cheese: this.cheese,
      reputation: this.reputation,
      job: this.job,
      jobsDone: this.jobsDone,
      nextJobDay: this.nextJobDay,
      fleeces: this.fleeces,
      woolValue: this.woolValue,
      shornIds: [...this.shornIds],
      tonic: this.tonic,
    };
  }

  loadExtra(extra: Record<string, unknown>): void {
    this.artifacts = (extra.artifacts as Artifact[] | undefined) ?? [];
    this.museumGiven = (extra.museumGiven as number | undefined) ?? 0;
    this.upgrades.clear();
    for (const u of (extra.upgrades as UpgradeId[] | undefined) ?? []) this.upgrades.add(u);
    this.cheese = (extra.cheese as { quality: number; age: number }[] | undefined) ?? [];
    this.reputation = (extra.reputation as number | undefined) ?? 0;
    this.job = (extra.job as Economy['job'] | undefined) ?? null;
    this.jobsDone = (extra.jobsDone as number | undefined) ?? 0;
    this.nextJobDay = (extra.nextJobDay as number | undefined) ?? 0;
    this.fleeces = (extra.fleeces as number | undefined) ?? 0;
    this.woolValue = (extra.woolValue as number | undefined) ?? 0;
    this.shornIds.clear();
    for (const id of (extra.shornIds as number[] | undefined) ?? []) this.shornIds.add(id);
    this.tonic = (extra.tonic as boolean | undefined) ?? false;
  }

  stateKey(): number[] {
    return [this.lira, this.herbs.thyme, this.herbs.sage, this.herbs.tea, this.patches, this.chainOil, this.churn, this.rackMilk, this.milkQuality, this.milkedDay, this.milking, this.rumour, this.artifacts.length, this.museumGiven, this.upgrades.size, this.cheese.length, this.reputation, this.jobsDone, this.fleeces, this.shornIds.size, this.tonic ? 1 : 0];
  }
}

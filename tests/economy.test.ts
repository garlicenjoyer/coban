// Feature 6, slice 6a: the purse and the village. Milk from the morning milking, carried by
// bike and sold fresh at the dairy; herbs picked in the hills and sold at the bakkal; kibble,
// fuel and parts bought back; repairs that use up what you bought.

import RAPIER from '@dimforge/rapier3d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { emptyFrame, type InputFrame, type TradeRequest } from '../src/core/input';
import { Economy } from '../src/economy/economy';
import { Sim } from '../src/sim';
import { yardLayout } from '../src/world/homestead';
import { useMap } from '../src/world/map';
import { Obstacles } from '../src/world/obstacles';
import { TEST_MAP } from '../src/world/testMap';
import { mainRoadDistance, VALLEY_MAP, valleyLayout as L } from '../src/world/valley';
import { initRapier, run } from './helpers';

const terrain = VALLEY_MAP.buildTerrain();
const obstacles = new Obstacles(VALLEY_MAP.buildProps(terrain));

beforeAll(async () => {
  await initRapier();
  useMap(VALLEY_MAP);
});
afterAll(() => useMap(TEST_MAP));

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...emptyFrame(), ...over });
const newValleySim = () => {
  const sim = new Sim(RAPIER, terrain);
  sim.tasks.enabled = false;
  return sim;
};
const shop = (id: string) => L.village.shops!.find((s) => s.id === id)!;
function trade(sim: Sim, t: TradeRequest) {
  sim.step(frame({ trade: t }));
}
function bikeTo(sim: Sim, x: number, z: number) {
  sim.bike.x = x;
  sim.bike.z = z;
}

describe('the village and the hills', () => {
  it('has seven village counters and nine herb patches, all where you can stand', () => {
    expect(L.village.shops!.map((s) => s.id)).toEqual(['dairy', 'bakkal', 'usta', 'kahvehane', 'muze', 'dealer', 'vet']);
    for (const s of L.village.shops!) {
      expect(obstacles.blocked(s.x, s.z, 0.5), s.id).toBe(false);
      if (s.id === 'kahvehane') {
        expect(s.z - L.village.z).toBeGreaterThan(25);
        expect(s.z - L.village.z).toBeLessThan(40);
        expect(mainRoadDistance(s.x, s.z)).toBeLessThan(12);
      } else expect(Math.hypot(s.x - L.village.x, s.z - L.village.z), s.id).toBeLessThan(30);
    }
    const herbs = VALLEY_MAP.herbs!;
    expect(herbs.length).toBe(9);
    for (const h of herbs) {
      expect(obstacles.blocked(h.x, h.z, 0.6), h.id).toBe(false);
      expect(terrain.slopeDegAt(h.x, h.z), h.id).toBeLessThan(28);
      expect(mainRoadDistance(h.x, h.z), h.id).toBeGreaterThan(4);
    }
  });

  it('E at a herb patch picks one bundle a day; the bakkal buys them', () => {
    const sim = newValleySim();
    const h = VALLEY_MAP.herbs!.find((x) => x.kind === 'tea')!;
    sim.teleport(h.x + 0.8, h.z);
    run(sim, 2, (i) => frame({ interact: i === 0 }));
    run(sim, 2, (i) => frame({ interact: i === 0 }));
    expect(sim.economy.herbs.tea).toBe(1);
    expect(sim.herbNear(h.x + 0.8, h.z)).toBeNull();

    const b = shop('bakkal');
    sim.teleport(b.x, b.z);
    const opened: string[] = [];
    sim.events.on('shopOpen', (e) => opened.push(e.shop));
    run(sim, 2, (i) => frame({ interact: i === 0 }));
    expect(opened).toEqual(['bakkal']);
    const before = sim.economy.lira;
    trade(sim, { shop: 'bakkal', kind: 'sell' });
    expect(sim.economy.lira - before).toBe(config.economy.herbPrice.tea);
    expect(sim.economy.herbCount).toBe(0);
  });

  it('the morning milking fills the churn; the bike carries it to the dairy, and it sells fresh', () => {
    const sim = newValleySim();
    const y = yardLayout(L);
    expect(sim.sheepInPen).toBe(sim.flock.sheep.length);
    sim.teleport(y.milking.x, y.milking.z);
    const h0 = sim.hour;
    let frames = 0;
    while (sim.economy.churn === 0 && frames < 60 * 20) {
      sim.step(frame({ interactHeld: true }));
      frames++;
    }
    const expected = Economy.milkYield(sim.flock.sheep.length, sim.economy.milkQuality);
    expect(sim.economy.churn).toBeCloseTo(expected);
    expect(sim.hour - h0).toBeGreaterThan(0.8); // about an hour of milking
    expect(frames / 60).toBeLessThan(config.economy.milkSeconds + 1);
    // Not twice in one morning.
    expect(sim.canMilk(y.milking.x, y.milking.z)).toBe(false);

    // Load the churn: hold R at the parked bike beside it.
    bikeTo(sim, y.churn.x + 2, y.churn.z);
    sim.teleport(y.churn.x + 2.6, y.churn.z + 0.8);
    expect(sim.bikeJob?.id).toBe('milk');
    run(sim, 60 * 3, () => frame({ bikeWork: true }));
    expect(sim.economy.rackMilk).toBeCloseTo(expected);
    expect(sim.economy.churn).toBe(0);

    // At the dairy, with the bike: sold.
    const d = shop('dairy');
    bikeTo(sim, d.x + 6, d.z);
    sim.teleport(d.x, d.z);
    const before = sim.economy.lira;
    trade(sim, { shop: 'dairy', kind: 'sell' });
    expect(sim.economy.lira - before).toBe(Math.round(expected * config.economy.milkPerLitre * sim.economy.milkQuality));
    expect(sim.economy.rackMilk).toBe(0);
  });

  it('milk not sold by evening turns', () => {
    const sim = newValleySim();
    sim.economy.rackMilk = 10;
    sim.hour = config.economy.milkSoursAt - 0.001;
    const soured: number[] = [];
    sim.events.on('milkSoured', (e) => soured.push(e.litres));
    run(sim, 5);
    expect(soured).toEqual([10]);
    expect(sim.economy.rackMilk).toBe(0);
  });

  it('buys back what the care loops use up, and refuses what you cannot afford', () => {
    const sim = newValleySim();
    const e = sim.economy;
    const b = shop('bakkal');
    sim.teleport(b.x, b.z);
    const sack = sim.dog.care.sack;
    trade(sim, { shop: 'bakkal', kind: 'buy', good: 'kibble' });
    expect(sim.dog.care.sack).toBe(sack + config.dogCare.sackMeals);
    expect(e.lira).toBe(config.economy.startLira - config.economy.prices.kibble);

    const u = shop('usta');
    sim.teleport(u.x, u.z);
    bikeTo(sim, u.x + 5, u.z);
    sim.bike.care.fuel = 2;
    const lira = e.lira;
    trade(sim, { shop: 'usta', kind: 'buy', good: 'tankFuel' });
    expect(sim.bike.care.fuel).toBeCloseTo(config.bikeCare.tank);
    expect(lira - e.lira).toBe(Math.ceil((config.bikeCare.tank - 2) * config.economy.prices.fuelPerLitre));
    trade(sim, { shop: 'usta', kind: 'buy', good: 'patches' });
    expect(e.patches).toBe(config.economy.startPatches + config.economy.patchesPerKit);

    e.lira = 3;
    const failed: string[] = [];
    sim.events.on('traded', (t) => !t.ok && failed.push(t.text));
    trade(sim, { shop: 'usta', kind: 'buy', good: 'jerrycan' });
    expect(failed[0]).toMatch(/Not enough money/);
    expect(e.lira).toBe(3);
  });

  it('a patch is used up by every tyre repair; without one the tyre waits', () => {
    const sim = newValleySim();
    const b = sim.bike;
    b.care.fuel = config.bikeCare.tank;
    b.care.leak = true;
    b.care.pressure = 50;
    sim.economy.patches = 1;
    sim.teleport(b.x + 1, b.z + 0.5);
    run(sim, 60 * 16, () => frame({ bikeWork: true }));
    expect(b.care.leak).toBe(false);
    expect(sim.economy.patches).toBe(0);
    b.care.leak = true;
    expect(sim.bikeJob?.id).not.toBe('tyre');
  });

  it("the kahvehane's çay costs a little time and tells you something useful", () => {
    const sim = newValleySim();
    const k = shop('kahvehane');
    sim.teleport(k.x, k.z);
    const said: string[] = [];
    sim.events.on('traded', (t) => said.push(t.text));
    const h = sim.hour;
    trade(sim, { shop: 'kahvehane', kind: 'buy', good: 'cay' });
    expect(said[0]).toMatch(/Over çay/);
    expect(sim.hour - h).toBeCloseTo(0.5, 1);
  });
});

// ---------- slice 6c: finds, the cheese press, upgrades ----------

describe('finds, cheese and upgrades', () => {
  const rainOnTheRuin = (sim: Sim) => (sim as unknown as { washOutFinds(): void }).washOutFinds();

  it('heavy rain washes finds out at the ruin; the museum pays less but tells you, the dealer pays more', () => {
    const sim = newValleySim();
    rainOnTheRuin(sim);
    expect(sim.finds.length).toBeGreaterThanOrEqual(1);
    for (const f of sim.finds) expect(Math.hypot(f.x - L.ruins.x, f.z - L.ruins.z)).toBeLessThan(L.ruins.clear + 0.1);
    const f = sim.finds[0];
    sim.teleport(f.x + 0.5, f.z);
    run(sim, 2, (i) => frame({ interact: i === 0 }));
    expect(sim.economy.artifacts.length).toBe(1);
    const worth = sim.economy.artifacts[0].value;

    const m = shop('muze');
    sim.teleport(m.x, m.z);
    const before = sim.economy.lira;
    trade(sim, { shop: 'muze', kind: 'sell' });
    expect(sim.economy.lira - before).toBe(Math.round(worth * config.economy.museumShare));
    expect(sim.notesRead.has('museum1')).toBe(true);

    sim.economy.artifacts.push({ kind: 'lamp', value: 120 });
    const dl = shop('dealer');
    sim.teleport(dl.x, dl.z);
    const b2 = sim.economy.lira;
    trade(sim, { shop: 'dealer', kind: 'sell' });
    expect(sim.economy.lira - b2).toBe(120);
  });

  it('it rains on about a third of the nights', () => {
    const sim = newValleySim();
    sim.startDay(5);
    let rain = 0;
    for (let n = 0; n < 30; n++) {
      while (!sim.tasks.finished) sim.tasks.skip();
      sim.sleep();
      if (sim.nightReport()?.rain) rain++;
    }
    expect(rain).toBeGreaterThan(4);
    expect(rain).toBeLessThan(18);
  });

  it('upgrades are bought once and change the game: collar, tyres, reinforced pen', () => {
    const sim = newValleySim();
    const e = sim.economy;
    e.lira = 2000;
    sim.teleport(shop('bakkal').x, shop('bakkal').z);
    trade(sim, { shop: 'bakkal', kind: 'buy', good: 'tickCollar' });
    expect(e.has('tickCollar')).toBe(true);
    const lira = e.lira;
    trade(sim, { shop: 'bakkal', kind: 'buy', good: 'tickCollar' });
    expect(e.lira).toBe(lira);
    run(sim, 1);
    expect(sim.dog.care.tickFactor).toBe(config.economy.upgrade.tickCollar);
    expect(sim.dog.collar).toBe('tick');

    sim.teleport(shop('usta').x, shop('usta').z);
    for (const good of ['tyres', 'pen', 'spikedCollar'] as const) trade(sim, { shop: 'usta', kind: 'buy', good });
    run(sim, 1);
    expect(sim.bike.care.offroad).toBe(true);
    expect(sim.dog.collar).toBe('spiked');

    // A reinforced, closed pen loses nobody, even with a dog that doesn't care for you.
    sim.startDay(5);
    for (let n = 0; n < 8; n++) {
      sim.dog.bond = 0;
      while (!sim.tasks.finished) sim.tasks.skip();
      sim.sleep();
      expect(sim.nightReport()?.taken).toBe(0);
    }
  });

  it('the press turns the morning milk into wheels that fetch more once aged', () => {
    const sim = newValleySim();
    const e = sim.economy;
    e.upgrades.add('press');
    e.churn = 13;
    const y = yardLayout(L);
    sim.teleport(y.press.x + 0.8, y.press.z);
    run(sim, 60 * (config.economy.cheese.pressSeconds + 1), () => frame({ interactHeld: true }));
    expect(e.cheese.length).toBe(2);
    expect(e.churn).toBeCloseTo(1);
    // Fresh wheels wait; aged ones sell, for more than the milk would have.
    const d = shop('dairy');
    sim.teleport(d.x, d.z);
    trade(sim, { shop: 'dairy', kind: 'sell' });
    expect(e.cheese.length).toBe(2);
    for (const w of e.cheese) w.age = config.economy.cheese.ageDays;
    const before = e.lira;
    trade(sim, { shop: 'dairy', kind: 'sell' });
    expect(e.cheese.length).toBe(0);
    expect(e.lira - before).toBeGreaterThan(12 * config.economy.milkPerLitre);
  });
});

describe('the first season is tight (GDD: upkeep or an upgrade, rarely both)', () => {
  it('a week of milk pays the upkeep and buys one big upgrade, not two', () => {
    const ec = config.economy;
    const P = ec.prices;
    const daily = Economy.milkYield(24, 1) * ec.milkPerLitre;
    // Upkeep: a sack of kibble every 14 days, fuel for a village run (~2.3 km), a patch kit and chain oil now and then.
    const upkeep = P.kibble / config.dogCare.sackMeals + 2.3 * config.bikeCare.litresPerKm * P.fuelPerLitre + P.patches / 6 + P.chainOil / 8;
    const week = ec.startLira + 7 * (daily - upkeep);
    console.log(`[economy] milk ${daily.toFixed(0)} ₺/day, upkeep ${upkeep.toFixed(0)} ₺/day, purse after a week ${week.toFixed(0)} ₺`);
    expect(daily).toBeGreaterThan(upkeep * 3); // sustainable
    const big = [P.press, P.spikedCollar, P.tyres, P.pen].sort((a, b) => a - b);
    expect(week).toBeGreaterThan(big[0]); // one is within reach…
    expect(week).toBeLessThan(big[0] + big[1]); // …but not two: choose
  });
});

// ---------- slice 6d: village life ----------

describe('village life', () => {
  it('a week starts on Monday; the vet is on the square only on Thursdays', async () => {
    const { weekday, isThursday, season } = await import('../src/economy/calendar');
    expect(weekday(1)).toBe('Monday');
    expect(weekday(4)).toBe('Thursday');
    expect(weekday(11)).toBe('Thursday');
    expect(isThursday(5)).toBe(false);
    expect(season(28)).toBe('summer');
    expect(season(29)).toBe('autumn');
    const sim = newValleySim();
    const v = shop('vet');
    sim.startDay(3);
    expect(sim.shopNear(v.x, v.z)).toBeNull();
    sim.startDay(4);
    expect(sim.shopNear(v.x, v.z)?.id).toBe('vet');
  });

  it('the vet looks Karabaş over (he has to be there) and her tonic strengthens the flock overnight', () => {
    const sim = newValleySim();
    sim.startDay(4);
    const v = shop('vet');
    sim.teleport(v.x, v.z);
    const d = sim.dog;
    d.care.ticks = 3;
    d.wound = 60;
    const said: string[] = [];
    sim.events.on('traded', (t) => said.push(t.text));
    trade(sim, { shop: 'vet', kind: 'buy', good: 'vetDog' });
    expect(said.at(-1)).toMatch(/Bring Karabaş/);
    d.x = d.px = v.x + 2;
    d.z = d.pz = v.z + 1;
    trade(sim, { shop: 'vet', kind: 'buy', good: 'vetDog' });
    expect(d.care.ticks).toBe(0);
    expect(d.wound).toBe(0);
    trade(sim, { shop: 'vet', kind: 'buy', good: 'vetTonic' });
    expect(sim.economy.tonic).toBe(true);
    for (const s of sim.flock.sheep) s.condition = 50;
    while (!sim.tasks.finished) sim.tasks.skip();
    sim.sleep();
    expect(Math.min(...sim.flock.sheep.map((s) => s.condition))).toBeGreaterThanOrEqual(50 + config.village.vet.tonicCondition);
    expect(sim.economy.tonic).toBe(false);
  });

  it('in summer each penned sheep can be shorn once; the bakkal buys the wool', () => {
    const sim = newValleySim();
    const s = sim.flock.sheep.find((q) => !q.isLeader)!;
    sim.teleport(s.x + 0.6, s.z);
    const h = sim.hour;
    run(sim, 60 * (config.village.wool.shearSeconds + 0.5), () => frame({ interactHeld: true }));
    expect(sim.economy.fleeces).toBeGreaterThanOrEqual(1);
    const shorn = sim.flock.sheep.filter((q) => q.shorn);
    expect(shorn.length).toBe(sim.economy.fleeces);
    expect(sim.hour - h).toBeGreaterThan(0.2); // time runs fast while you shear
    const b = shop('bakkal');
    sim.teleport(b.x, b.z);
    const before = sim.economy.lira;
    trade(sim, { shop: 'bakkal', kind: 'sell' });
    expect(sim.economy.lira - before).toBeGreaterThan(0);
    expect(sim.economy.fleeces).toBe(0);
    // Not in autumn.
    sim.startDay(config.village.summerDays + 1);
    const u = sim.flock.sheep.find((q) => !q.shorn)!;
    expect(sim.sheepToShear(u.x + 0.3, u.z)).toBeNull();
  });

  it("Kemal's errands: thyme, then the goat; each pays and raises your standing, which brings a discount", () => {
    const sim = newValleySim();
    const e = sim.economy;
    const k = shop('kahvehane');
    sim.teleport(k.x, k.z);
    trade(sim, { shop: 'kahvehane', kind: 'job' });
    expect(e.job?.id).toBe('thyme');
    trade(sim, { shop: 'kahvehane', kind: 'job' }); // not yet
    expect(e.job?.id).toBe('thyme');
    e.herbs.thyme = config.village.jobs.thymeBundles;
    const before = e.lira;
    trade(sim, { shop: 'kahvehane', kind: 'job' });
    expect(e.job).toBeNull();
    expect(e.lira - before).toBe(config.village.jobs.thyme);
    expect(e.reputation).toBe(1);
    // Nothing more today; tomorrow, the goat.
    trade(sim, { shop: 'kahvehane', kind: 'job' });
    expect(e.job).toBeNull();
    sim.startDay(2);
    sim.tasks.enabled = false;
    sim.teleport(k.x, k.z);
    trade(sim, { shop: 'kahvehane', kind: 'job' });
    expect(e.job?.id).toBe('goat');
    const g = sim.goat!;
    expect(obstacles.blocked(g.x, g.z, 0.4)).toBe(false);
    sim.teleport(g.x + 1, g.z);
    run(sim, 2, (i) => frame({ interact: i === 0 }));
    expect(sim.goat).toBeNull();
    sim.teleport(k.x, k.z);
    trade(sim, { shop: 'kahvehane', kind: 'job' });
    expect(e.reputation).toBe(2);
    // Standing 2: 10% off.
    expect(e.discounted(100)).toBe(90);
    // No press: the wedding is skipped and the list comes round to thyme again.
    expect(e.nextJob()).toBe('thyme');
    e.upgrades.add('press');
    expect(e.nextJob()).toBe('wedding');
  });

  it('every goat hiding place is where you can walk to', () => {
    for (const s of VALLEY_MAP.goatSpots!) {
      expect(obstacles.blocked(s.x, s.z, 0.6)).toBe(false);
      expect(terrain.slopeDegAt(s.x, s.z)).toBeLessThan(28);
    }
  });
});

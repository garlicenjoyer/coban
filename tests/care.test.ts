// Feature 5, Karabaş's care loop: hunger and thirst over the day, what neglect does
// (slow recovery, no running, ticks weighing on him), the hands-on fixes (bowl, bread by
// hand, water, picking ticks) and what the nights do to the bond.

import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { emptyFrame, type InputFrame } from '../src/core/input';
import { Bike, type BikeInput } from '../src/bike/bike';
import { BikeCare } from '../src/bike/care';
import { SIM_DT } from '../src/core/config';
import { EventBus } from '../src/core/events';
import { DogCare } from '../src/dog/care';
import { Obstacles } from '../src/world/obstacles';
import { Surface, Terrain } from '../src/world/terrain';
import type { Sim } from '../src/sim';
import { layout } from '../src/world/testMap';
import { initRapier, newSim, placeFlock, run } from './helpers';

beforeAll(initRapier);

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...emptyFrame(), ...over });

function putDog(sim: Sim, x: number, z: number) {
  const d = sim.dog;
  d.x = d.px = x;
  d.z = d.pz = z;
  d.y = d.py = sim.terrain.heightAt(x, z);
  d.vx = d.vz = 0;
}

describe("Karabaş's care", () => {
  it('gets hungry and thirsty over the day; running doubles hunger, the midday heat doubles thirst', () => {
    const c = new DogCare({ x: 0, z: 0 });
    c.satiety = c.hydration = 100;
    c.step(1, false, 0, false);
    expect(c.satiety).toBeCloseTo(100 - config.dogCare.satietyPerHour);
    expect(c.hydration).toBeCloseTo(100 - config.dogCare.hydrationPerHour);
    const r = new DogCare({ x: 0, z: 0 });
    r.satiety = r.hydration = 100;
    r.step(1, true, 1, false);
    expect(100 - r.satiety).toBeCloseTo(2 * config.dogCare.satietyPerHour);
    expect(100 - r.hydration).toBeCloseTo(2 * config.dogCare.hydrationPerHour);
  });

  it('neglect shows: hungry he recovers at half speed, thirsty he will not run, ticks lower his stamina', () => {
    const c = new DogCare({ x: 0, z: 0 });
    c.satiety = 20;
    expect(c.regenScale).toBe(0.5);
    c.hydration = 10;
    expect(c.canRun).toBe(false);
    c.ticks = 4;
    expect(c.staminaMax).toBeCloseTo(config.dog.stamina.max * 0.8);

    // In the sim: a thirsty Karabaş sent to gather never goes faster than a trot.
    const sim = newSim();
    sim.tasks.enabled = false;
    placeFlock(sim, -20, 98);
    putDog(sim, -20, 130);
    sim.teleport(-20, 132);
    sim.dog.care.hydration = 5;
    sim.water.points.length = 0; // nothing to drink nearby
    sim.giveCommand('gather', 0);
    let top = 0;
    for (let i = 0; i < 60 * 8; i++) {
      sim.step(frame());
      top = Math.max(top, sim.dog.speed);
    }
    expect(top).toBeLessThanOrEqual(config.dog.speeds.trot + 0.05);
  });

  it('picks up ticks moving through the maquis; holding E beside him picks them off while he lies still', () => {
    const c = new DogCare({ x: 0, z: 0 });
    let got = 0;
    for (let i = 0; i < 600; i++) if (c.step(1 / 60, false, 0, true)) got++;
    expect(got).toBeGreaterThan(0);
    expect(c.ticks).toBeLessThanOrEqual(config.dogCare.ticksMax);
    const none = new DogCare({ x: 0, z: 0 });
    for (let i = 0; i < 600; i++) none.step(1 / 60, false, 0, false);
    expect(none.ticks).toBe(0);

    const sim = newSim();
    sim.tasks.enabled = false;
    const d = sim.dog;
    d.care.ticks = 2;
    sim.teleport(d.x + 1, d.z);
    const picked: number[] = [];
    sim.events.on('tickPicked', (e) => picked.push(e.left));
    run(sim, Math.ceil(60 * config.dogCare.pickSeconds * 2) + 4, () => frame({ interactHeld: true }));
    expect(picked).toEqual([1, 0]);
    expect(d.care.ticks).toBe(0);
    expect(d.state).toBe('being looked over');
    expect(d.care.staminaMax).toBe(config.dog.stamina.max);
  });

  it('E at the porch fills his bowl from the sack, and a hungry Karabaş goes and eats', () => {
    const sim = newSim();
    sim.tasks.enabled = false;
    const care = sim.dog.care;
    const bowl = care.bowl;
    sim.teleport(bowl.x - 0.6, bowl.z - 0.6);
    run(sim, 2, (i) => frame({ interact: i === 0 }));
    expect(bowl.meals).toBe(1);
    expect(care.sack).toBe(config.dogCare.sackMeals - 1);
    // A second press does nothing: it's full.
    run(sim, 2, (i) => frame({ interact: i === 0 }));
    expect(care.sack).toBe(config.dogCare.sackMeals - 1);

    sim.teleport(bowl.x + 15, bowl.z - 15);
    putDog(sim, bowl.x + 20, bowl.z - 10);
    care.satiety = 25;
    run(sim, 60 * 20);
    expect(bowl.meals).toBe(0);
    expect(care.satiety).toBeGreaterThan(70);
  });

  it('a thirsty Karabaş goes to the nearest water and drinks his fill', () => {
    const sim = newSim();
    sim.tasks.enabled = false;
    const care = sim.dog.care;
    const c = layout.cesme;
    putDog(sim, c.x + 18, c.z + 6);
    sim.teleport(c.x + 22, c.z + 10);
    care.hydration = 15;
    run(sim, 60 * 20);
    expect(care.hydration).toBeGreaterThan(90);
  });

  it('bread from the satchel feeds him by hand and warms him to you', () => {
    const sim = newSim();
    sim.tasks.enabled = false;
    sim.satchel.pack(['bread', 'salve', 'rope']);
    const d = sim.dog;
    sim.teleport(d.x + 1.2, d.z);
    d.care.satiety = 20;
    const bond = d.bond;
    run(sim, 2, (i) => frame({ item: i === 0 ? 0 : -1 }));
    expect(d.care.satiety).toBeCloseTo(20 + config.dogCare.handSatiety);
    expect(d.bond).toBeCloseTo(bond + config.dogCare.handBond);
    expect(sim.satchel.has('bread')).toBe(false);
  });

  it('the night: neglect costs bond, care costs nothing, and a full bowl at home is eaten overnight', () => {
    const neglected = new DogCare({ x: 0, z: 0 });
    neglected.satiety = 10;
    neglected.ticks = 2;
    const n = neglected.night(true);
    expect(n.bondChange).toBeCloseTo(config.dogCare.bond.notPetted + config.dogCare.bond.hungry + 2 * config.dogCare.bond.perTick);
    expect(n.note).toMatch(/nobody petted him/);

    const cared = new DogCare({ x: 0, z: 0 });
    cared.satiety = 20;
    cared.pettedToday = true;
    cared.fillBowl();
    const k = cared.night(true);
    expect(k.bondChange).toBe(0);
    expect(cared.bowl.meals).toBe(0);
    expect(cared.hydration).toBe(100);
    expect(cared.pettedToday).toBe(false);

    // In the sim, sleeping applies it to the bond.
    const sim = newSim();
    sim.startDay(2);
    while (!sim.tasks.finished) sim.tasks.skip();
    const bond = sim.dog.bond;
    sim.dog.care.satiety = 10;
    expect(sim.sleep()).toBe(true);
    expect(sim.dog.bond).toBeLessThan(bond);
    expect(sim.nightReport(2)?.dog?.bondChange).toBeLessThan(0);
  });
});

// ---------- the motorcycle ----------

function flat(surface: Surface): Terrain {
  const t = new Terrain(400, 129);
  for (let i = 0; i < t.surfaces.length; i++) t.surfaces[i] = surface;
  return t;
}

function onBike(surface = Surface.Asphalt) {
  const events = new EventBus();
  const bike = new Bike(0, -150, 0, flat(surface), new Obstacles({ props: [], labels: [], decor: [], pastureDistances: {} }), events);
  bike.state = 'riding';
  bike.rider = true;
  bike.engineOn = true;
  bike.rpm = config.bike.engine.idleRpm;
  bike.footDown = 1;
  return { bike, events };
}

const throttle = (p: Partial<BikeInput> = {}): BikeInput => ({ throttle: 0, brake: 0, steer: 0, weightShift: 0, ...p });

function topSpeed(bike: Bike, seconds = 12): number {
  let top = 0;
  for (let t = 0; t < seconds; t += SIM_DT) {
    bike.step(SIM_DT, throttle({ throttle: 1 }), 0);
    top = Math.max(top, bike.kmh);
  }
  return top;
}

describe("the motorcycle's care", () => {
  it('wears with use: dust clogs the carb, mud eats the chain, distance burns fuel and the plug', () => {
    const c = new BikeCare();
    const start = { fuel: c.fuel, plug: c.plug, carb: c.carb, chain: c.chain };
    c.wear(1000, Surface.Gravel, true, false, 0.02);
    expect(start.fuel - c.fuel).toBeCloseTo(config.bikeCare.litresPerKm);
    expect(start.carb - c.carb).toBeCloseTo(config.bikeCare.carbDustPerKm);
    expect(start.plug - c.plug).toBeCloseTo(config.bikeCare.plugPerKm);
    const m = new BikeCare();
    m.wear(1000, Surface.Mud, true, false, 0.02);
    expect(start.chain - m.chain).toBeCloseTo(config.bikeCare.chainMudPerKm);
    // A tank lasts about 15 km.
    expect(config.bikeCare.tank / config.bikeCare.litresPerKm).toBeGreaterThan(12);
  });

  it('thorns in the maquis puncture the tyre; it leaks, goes soft, then flat', () => {
    const c = new BikeCare();
    c.inBrush = true;
    let m = 0;
    while (!c.leak && m < 20000) {
      c.wear(1, Surface.Grass, true, false, 0);
      m++;
    }
    expect(c.leak).toBe(true);
    c.wear(0, Surface.Grass, false, false, 2);
    expect(c.pressure).toBeLessThan(config.bikeCare.wobbleBelow);
    expect(c.tyreGrip).toBeLessThan(1);
    c.wear(0, Surface.Grass, false, false, 4);
    expect(c.flat).toBe(true);
  });

  it('neglect shows on the road: a choked carb pulls weakly and a flat tyre crawls', () => {
    const healthy = topSpeed(onBike().bike);
    const choked = onBike().bike;
    choked.care.carb = 0;
    const flatTyre = onBike().bike;
    flatTyre.care.pressure = 0;
    expect(topSpeed(choked)).toBeLessThan(healthy * 0.97);
    expect(topSpeed(flatTyre)).toBeLessThan(15);
  });

  it('a worn plug misfires and needs several kicks; an empty tank will not start at all', () => {
    const { bike, events } = onBike();
    bike.care.plug = 5;
    const faults: string[] = [];
    events.on('bikeFault', (e) => faults.push(e.kind));
    topSpeed(bike, 20);
    expect(faults).toContain('misfire');

    const worn = new BikeCare();
    worn.plug = 5;
    let caught = 0;
    for (let i = 0; i < 200; i++) if (worn.kickCatches()) caught++;
    expect(caught).toBeGreaterThan(10);
    expect(caught).toBeLessThan(120);
    const fresh = new BikeCare();
    for (let i = 0; i < 20; i++) expect(fresh.kickCatches()).toBe(true);
    const dry = new BikeCare();
    dry.fuel = 0;
    expect(dry.kickCatches()).toBe(false);
  });

  it('holding R at the parked bike does the most urgent job, hands-on and in seconds', () => {
    const sim = newSim();
    sim.tasks.enabled = false;
    const b = sim.bike;
    b.care.leak = true;
    b.care.pressure = 40;
    b.care.plug = 30;
    b.care.fuel = config.bikeCare.tank; // at home a low tank would come first
    sim.teleport(b.x + 1, b.z + 0.5);
    expect(sim.bikeJob?.id).toBe('tyre');
    const done: string[] = [];
    sim.events.on('bikeRepaired', (e) => done.push(e.job));
    run(sim, 60 * 16, () => frame({ bikeWork: true }));
    expect(done[0]).toBe('tyre');
    expect(b.care.leak).toBe(false);
    expect(b.care.pressure).toBe(100);
    // Let go half way and the job waits; hold again and it finishes.
    run(sim, 60 * 3, () => frame({ bikeWork: true }));
    run(sim, 30);
    expect(b.care.jobProgress).toBe(0);
    run(sim, 60 * 7, () => frame({ bikeWork: true }));
    expect(done).toContain('plug');
    expect(b.care.plug).toBe(100);
  });

  it('fuel comes from the drum at home only', () => {
    const c = new BikeCare();
    c.fuel = 1;
    expect(c.nextJob(false)).toBeNull();
    const job = c.nextJob(true)!;
    expect(job.id).toBe('fuel');
    const drum = c.drum;
    for (let t = 0; t < job.seconds + 0.1; t += 0.1) c.work(job, 0.1);
    expect(c.fuel).toBeCloseTo(config.bikeCare.tank);
    expect(drum - c.drum).toBeCloseTo(config.bikeCare.tank - 1);
  });
});

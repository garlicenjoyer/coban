// Feature 6, slice 6b: saving at dawn. A day's changes survive a save and a load in a fresh
// sim: the purse, the flock (and who is missing), Karabaş and the bike, the grass, what
// was built, the notes, the satchel and last night's report.

import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { SAVE_VERSION, snapshot, usable, type SaveData } from '../src/core/save';
import { layout } from '../src/world/testMap';
import { initRapier, newSim } from './helpers';

beforeAll(initRapier);

function playADay() {
  const sim = newSim();
  sim.startDay(2);
  const e = sim.economy;
  e.lira = 333;
  e.herbs.sage = 4;
  e.patches = 7;
  sim.dog.bond = 77;
  sim.dog.care.ticks = 2;
  sim.dog.care.sack = 9;
  sim.bike.care.fuel = 2.25;
  sim.bike.care.leak = true;
  sim.bike.care.pressure = 61;
  sim.bike.care.drum = 12;
  sim.flock.remove(sim.flock.sheep.slice(0, 2));
  sim.flock.sheep[3].condition = 41;
  sim.grass.value[1000] = 0.2;
  sim.grass.wear[2000] = 0.8;
  sim.buildNow('hut');
  sim.works.cairns.push({ x: 10, z: 20 });
  sim.notesRead.add('letter');
  sim.signsSeen.add(3);
  sim.satchel.pack(['bread', 'salve', 'rope']);
  while (!sim.tasks.finished) sim.tasks.skip();
  expect(sim.sleep()).toBe(true);
  return sim;
}

describe('saving at dawn', () => {
  it('a day’s changes survive a save and a load in a fresh sim', () => {
    const a = playADay();
    const data: SaveData = JSON.parse(JSON.stringify(snapshot(a)));
    expect(data.day).toBe(3);
    expect(usable(data)).toBe(true);

    const b = newSim();
    b.restore(data);
    expect(b.tasks.day).toBe(3);
    expect(b.hour).toBeCloseTo(config.time.startHour);
    expect(b.economy.lira).toBe(333);
    expect(b.economy.herbs.sage).toBe(4);
    expect(b.economy.patches).toBe(7);
    expect(b.dog.bond).toBeCloseTo(a.dog.bond);
    expect(b.dog.care.ticks).toBe(2);
    expect(b.dog.care.sack).toBe(9);
    expect(b.bike.care.fuel).toBeCloseTo(2.25);
    expect(b.bike.care.leak).toBe(true);
    expect(b.bike.care.drum).toBeCloseTo(12);
    expect(b.flock.sheep.map((s) => s.id).sort()).toEqual(a.flock.sheep.map((s) => s.id).sort());
    const s3 = a.flock.sheep[3];
    expect(b.flock.sheep.find((s) => s.id === s3.id)!.condition).toBeCloseTo(s3.condition, 1);
    expect(b.grass.value[1000]).toBeCloseTo(a.grass.value[1000], 2);
    expect(b.grass.wear[2000]).toBeCloseTo(a.grass.wear[2000], 2);
    expect(b.works.built('hut')).toBe(true);
    const h = layout.works.hut;
    expect(b.obstacles.blocked(h.x, h.z, 0.3)).toBe(true);
    expect(b.works.cairns).toEqual([{ x: 10, z: 20 }]);
    expect(b.notesRead.has('letter')).toBe(true);
    expect(b.signsSeen.has(3)).toBe(true);
    expect(b.satchel.ids).toEqual(['bread', 'salve', 'rope']);
    expect(b.nightReport(2)?.reason).toBe(a.nightReport(2)?.reason);
  });

  it('is small enough for the browser’s storage', () => {
    const json = JSON.stringify(snapshot(playADay()));
    expect(json.length).toBeLessThan(1_500_000);
  });

  it('refuses a save from another map or version', () => {
    const data = snapshot(newSim());
    expect(usable({ ...data, map: 'valley' })).toBe(false);
    expect(usable({ ...data, v: SAVE_VERSION + 1 })).toBe(false);
    expect(usable(null)).toBe(false);
  });
});

describe('saving what the village sold you', () => {
  it('keeps upgrades, cheese, finds in your pocket and finds still at the ruin', () => {
    const a = newSim();
    a.economy.upgrades.add('press');
    a.economy.upgrades.add('pen');
    a.economy.cheese.push({ quality: 1.1, age: 2 });
    a.economy.artifacts.push({ kind: 'coin', value: 40 });
    a.economy.museumGiven = 1;
    a.finds.push({ id: 0, kind: 'lamp', value: 99, x: 1, z: 2 });
    const data = JSON.parse(JSON.stringify(snapshot(a)));
    const b = newSim();
    b.restore(data);
    expect([...b.economy.upgrades].sort()).toEqual(['pen', 'press']);
    expect(b.economy.cheese).toEqual([{ quality: 1.1, age: 2 }]);
    expect(b.economy.artifacts).toEqual([{ kind: 'coin', value: 40 }]);
    expect(b.economy.museumGiven).toBe(1);
    expect(b.finds.map((f) => [f.kind, f.value])).toEqual([['lamp', 99]]);
  });
});

describe('saving village life', () => {
  it('keeps standing, the errand in hand, wool and who is shorn', () => {
    const a = newSim();
    const e = a.economy;
    e.reputation = 2;
    e.jobsDone = 2;
    e.job = { id: 'goat', spot: { x: 5, z: 6 } };
    e.fleeces = 3;
    e.woolValue = 40;
    const s = a.flock.sheep[2];
    s.shorn = true;
    e.shornIds.add(s.id);
    e.tonic = true;
    const b = newSim();
    b.restore(JSON.parse(JSON.stringify(snapshot(a))));
    expect(b.economy.reputation).toBe(2);
    expect(b.economy.job).toEqual({ id: 'goat', spot: { x: 5, z: 6 } });
    expect(b.economy.fleeces).toBe(3);
    expect(b.economy.tonic).toBe(true);
    expect(b.flock.sheep.find((q) => q.id === s.id)!.shorn).toBe(true);
    expect(b.flock.sheep.filter((q) => q.shorn).length).toBe(1);
  });
});

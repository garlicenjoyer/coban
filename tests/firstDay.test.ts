// A first Day 1 isn't lost or punished: the day is checkpointed after each task and picks
// up where it was left, and the first night scatters what was left out instead of taking it.

import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { canCheckpoint, snapshot, usable, type SaveData } from '../src/core/save';
import { initRapier, newSim, run } from './helpers';

beforeAll(initRapier);

const roundTrip = (d: SaveData): SaveData => JSON.parse(JSON.stringify(d));

describe('Day 1 checkpoints', () => {
  it('a mid-day save resumes at the same task, clock and satchel', () => {
    const a = newSim();
    run(a, 1);
    while (a.tasks.task?.id !== 'pastureA') a.tasks.skip();
    a.hour = 9.25;
    a.satchel.slots[0].uses = 1;
    expect(canCheckpoint(a)).toBe(true);
    const data = roundTrip(snapshot(a, { midday: true }));
    expect(usable(data)).toBe(true);
    expect(data.midday?.task).toBe(a.tasks.index);

    const b = newSim();
    b.restore(data);
    run(b, 1);
    expect(b.tasks.day).toBe(1);
    expect(b.tasks.task?.id).toBe('pastureA');
    expect(b.tasks.done.map((d) => d.id)).toEqual(a.tasks.done.map((d) => d.id));
    expect(b.hour).toBeGreaterThan(9.2);
    expect(b.hour).toBeLessThan(9.3);
    expect(b.satchel.slots[0].uses).toBe(1);
  });

  it('a save inside "free her" goes back to "find her", which puts her in the thorns again', () => {
    const a = newSim();
    run(a, 1);
    while (a.tasks.task?.id !== 'free') a.tasks.skip();
    const b = newSim();
    b.restore(roundTrip(snapshot(a, { midday: true })));
    run(b, 1);
    expect(b.tasks.task?.id).toBe('lost');
    expect(b.flock.sheep.some((s) => s.stuck === 'thorn')).toBe(true);
  });

  it('a dawn save has no mid-day part and still starts the morning', () => {
    const a = newSim();
    const data = roundTrip(snapshot(a));
    expect(data.midday).toBeUndefined();
    const b = newSim();
    b.restore(data);
    expect(b.hour).toBeCloseTo(config.time.startHour);
  });

  it('no checkpoint once the day’s work is done (the night isn’t saved half-way)', () => {
    const a = newSim();
    run(a, 1);
    while (!a.tasks.finished) a.tasks.skip();
    expect(canCheckpoint(a)).toBe(false);
  });
});

describe('the first night forgives', () => {
  it('sheep left out on night one scatter but none are taken, and the report says why', () => {
    const sim = newSim();
    run(sim, 1);
    while (!sim.tasks.finished) sim.tasks.skip();
    sim.setGate(true);
    sim.dog.bond = 10;
    const before = sim.flock.sheep.length;
    expect(sim.sleep()).toBe(false); // rest until dark: the first night's wolf comes
    const wolf = sim.nightWolf!;
    for (let i = 0; i < 60 * 120 && wolf.state !== 'flee'; i++) run(sim, 1);
    expect(sim.sleep()).toBe(true);
    const report = sim.nightReport(1)!;
    expect(report.exposed).toBeGreaterThan(0);
    expect(report.taken).toBe(0);
    expect(sim.flock.sheep.length).toBe(before);
    expect(report.reason).toMatch(/first night/);
  });
});

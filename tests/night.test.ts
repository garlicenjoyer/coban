// Night stakes: sleeping resolves the night. Penned sheep behind a closed gate are safe with
// a bonded dog; exposed sheep risk the wolves (a few taken, the rest scattered and found in
// the morning). Hush freezes the flock and hides it. Every night, a wolf comes if you stay up.

import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { emptyFrame } from '../src/core/input';
import type { Sim } from '../src/sim';
import { insidePen, layout } from '../src/world/testMap';
import { initRapier, newSim, placeFlock, run } from './helpers';

beforeAll(initRapier);

/** Start on Day 2 (no scripted first night), finish its tasks and sleep through the night. */
function day2Night(setup: (sim: Sim) => void) {
  const sim = newSim();
  sim.startDay(2);
  setup(sim);
  while (!sim.tasks.finished) sim.tasks.skip();
  const before = sim.flock.sheep.length;
  const slept = sim.sleep();
  return { sim, before, slept, report: sim.nightReport(2)! };
}

const pennedAndClosed = (sim: Sim) => {
  // The flock starts in the pen; make sure the gate is shut.
  sim.setGate(false);
};

describe('the night', () => {
  it('a closed pen with a bonded dog keeps every sheep safe', () => {
    const { sim, before, slept, report } = day2Night((s) => {
      pennedAndClosed(s);
      s.dog.bond = 60;
    });
    expect(slept).toBe(true);
    expect(sim.tasks.day).toBe(3);
    expect(report.taken).toBe(0);
    expect(report.scattered).toBe(0);
    expect(sim.flock.sheep.length).toBe(before);
    expect(report.reason).toMatch(/kept watch/);
  });

  it('an open gate exposes the flock: a few taken (never more than 3), the rest scatter away from the den', () => {
    const den = layout.wolfDen;
    let distBefore = 0;
    const { sim, before, report } = day2Night((s) => {
      s.setGate(true);
      s.dog.bond = 30;
      distBefore = Math.hypot(layout.pen.x - den.x, layout.pen.z - den.z);
    });
    expect(report.exposed).toBe(before);
    expect(report.taken).toBeGreaterThan(0);
    expect(report.taken).toBeLessThanOrEqual(config.night.maxTaken);
    expect(report.scattered).toBeGreaterThan(0);
    expect(sim.flock.sheep.length).toBe(before - report.taken);
    const scattered = sim.flock.sheep.filter((s) => s.scattered);
    expect(scattered.length).toBe(report.scattered);
    for (const s of scattered) {
      expect(s.isStray).toBe(true);
      expect(insidePen(s.x, s.z)).toBe(false);
      expect(Math.hypot(s.x - den.x, s.z - den.z)).toBeGreaterThan(distBefore);
    }
    expect(report.reason).toMatch(/gate was left open/);
    expect(report.tracks.length).toBeGreaterThan(10);
  });

  it('a neglected dog can lose a sheep even from a closed pen; a devoted one never does', () => {
    let lost = 0;
    const sim = newSim();
    sim.startDay(2);
    sim.setGate(false);
    sim.dog.bond = 0;
    for (let night = 0; night < 6; night++) {
      while (!sim.tasks.finished) sim.tasks.skip();
      sim.sleep();
      lost += sim.nightReport()!.taken;
      sim.dog.bond = 0;
    }
    expect(lost).toBeGreaterThan(0);

    const { report } = day2Night((s) => {
      pennedAndClosed(s);
      s.dog.bond = 100;
    });
    expect(report.taken).toBe(0);
  });

  it('the morning after a raid starts with finding the scattered sheep', () => {
    const { sim, report } = day2Night((s) => {
      s.setGate(true);
      s.dog.bond = 30;
    });
    expect(report.scattered).toBeGreaterThan(0);
    run(sim, 1);
    expect(sim.tasks.task?.id).toBe('scattered');
    // Bring them all back to the flock.
    const c = sim.flock.centroid;
    sim.flock.sheep.filter((s) => s.scattered).forEach((s, i) => {
      s.x = s.px = c.x + (i % 3);
      s.z = s.pz = c.z + Math.floor(i / 3);
    });
    run(sim, 60 * 3);
    expect(sim.tasks.task?.id).not.toBe('scattered');
  });

  it('losing the bellwether promotes another ewe', () => {
    const sim = newSim();
    const old = sim.flock.leader;
    sim.flock.remove([old]);
    expect(sim.flock.leader).not.toBe(old);
    expect(sim.flock.leader.isLeader).toBe(true);
    expect(sim.flock.sheep.every((s, i) => s.id === i)).toBe(true);
  });
});

describe('hush', () => {
  it('freezes the sheep around the shepherd', () => {
    const sim = newSim();
    sim.tasks.enabled = false;
    placeFlock(sim, -20, 98);
    sim.teleport(-20, 106);
    run(sim, 60 * 2, () => ({ ...emptyFrame(), hush: true }));
    const speed = sim.flock.sheep.reduce((a, s) => a + Math.hypot(s.vx, s.vz), 0) / sim.flock.sheep.length;
    expect(sim.flock.sheep.every((s) => s.hushed)).toBe(true);
    expect(speed).toBeLessThan(0.08);
  });

  it('a hushed flock goes unnoticed by a wolf passing 15 m away', () => {
    const hunted = (hush: boolean) => {
      const sim = newSim();
      sim.tasks.enabled = false;
      placeFlock(sim, -20, 98);
      sim.teleport(-20, 102);
      sim.dog.x = sim.dog.px = 150; // keep the dog out of it
      sim.dog.z = sim.dog.pz = -150;
      const w = sim.spawnWolf(-20, 80); // ~15 m north of the flock
      run(sim, 30, () => ({ ...emptyFrame(), hush }));
      return w.state === 'hunt';
    };
    expect(hunted(false)).toBe(true);
    expect(hunted(true)).toBe(false);
  });
});

describe('every night', () => {
  it('wolves howl at 19:30, and a wolf comes at 20:00 if you stay up', () => {
    const sim = newSim();
    sim.startDay(2);
    sim.hour = config.night.howlHour - 0.02;
    const howls: number[] = [];
    sim.events.on('howl', (e) => howls.push(e.day));
    run(sim, 60 * 3);
    expect(howls).toEqual([2]);
    sim.hour = 19.98;
    run(sim, 60 * 3);
    expect(sim.nightWolf).not.toBeNull();
    expect(sim.nightWatchActive).toBe(true);
    // And you can't sleep through it.
    while (!sim.tasks.finished) sim.tasks.skip();
    expect(sim.sleep()).toBe(false);
  });
});

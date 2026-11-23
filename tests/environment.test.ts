// The detailed environment: the cottage, grove walls, ruin and scattered props stay out of
// the way of paths and pastures, are solid where they should be, and the door sleeps.

import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { emptyFrame } from '../src/core/input';
import { buildProps, layout, spurDistance, trackDistance } from '../src/world/testMap';
import { initRapier, newSim, run, terrain, yawToward } from './helpers';

beforeAll(initRapier);

const map = buildProps(terrain);

describe('placement', () => {
  it('has the cottage, an olive grove with terrace walls, a ruin, rocks, trees and shrubs', () => {
    const count = (role: string) => map.props.filter((p) => p.role === role).length;
    expect(count('house')).toBe(1);
    expect(count('olive')).toBeGreaterThan(25);
    expect(count('wall')).toBeGreaterThan(15);
    expect(count('column')).toBe(8);
    expect(count('rock')).toBeGreaterThan(30);
    expect(count('pine')).toBeGreaterThan(10);
    expect(count('cypress')).toBeGreaterThanOrEqual(3);
    expect(map.decor.length).toBeGreaterThan(400);
  });

  it('keeps solid things off the gravel loop, the gate track and the pastures', () => {
    const solid = map.props.filter((p) => ['olive', 'rock', 'pine', 'cypress', 'column', 'ruin', 'wall', 'house', 'porch'].includes(p.role));
    for (const p of solid) {
      const r = p.kind === 'cyl' ? p.radius : Math.max(p.hx, p.hz);
      expect(trackDistance(p.x, p.z) - r).toBeGreaterThan(layout.track.halfWidth + 0.5);
      expect(spurDistance(p.x, p.z) - r).toBeGreaterThan(layout.spur.halfWidth + 0.5);
      for (const pa of layout.pastures) expect(Math.hypot(p.x - pa.x, p.z - pa.z)).toBeGreaterThan(pa.r);
    }
  });
});

describe('solid and walkable', () => {
  it('the cottage is solid', () => {
    const sim = newSim();
    const h = layout.house;
    sim.teleport(h.x - h.hx - 6, h.z);
    run(sim, 60 * 6, () => ({ ...emptyFrame(yawToward(0, 0, 1, 0)), moveY: 1 }));
    expect(sim.player.pos.x).toBeLessThan(h.x - h.hx);
  });

  it('the grove walls stop you, but their gaps let you through', () => {
    const sim = newSim();
    const g = layout.grove;
    const wz = g.walls[0];
    const north = yawToward(0, 0, 0, -1);
    // Solid stretch.
    sim.teleport(-90, wz + 4);
    run(sim, 60 * 6, () => ({ ...emptyFrame(north), moveY: 1 }));
    expect(sim.player.pos.z).toBeGreaterThan(wz);
    // Through a gap.
    sim.teleport(g.gaps[0], wz + 4);
    run(sim, 60 * 6, () => ({ ...emptyFrame(north), moveY: 1 }));
    expect(sim.player.pos.z).toBeLessThan(wz - 1);
  });

  it('you can step up onto the ruin platform', () => {
    const sim = newSim();
    const ru = layout.ruins;
    sim.teleport(ru.x, ru.z + ru.hz + 4);
    const y0 = sim.player.pos.y;
    run(sim, 60 * 4, () => ({ ...emptyFrame(yawToward(0, 0, 0, -1)), moveY: 1 }));
    expect(sim.player.pos.z).toBeLessThan(ru.z + ru.hz);
    expect(sim.player.pos.y).toBeGreaterThan(y0 + 0.1);
  });
});

describe('the cottage door', () => {
  it('resting after Day 1 starts the night watch before sleep advances the day', () => {
    const sim = newSim();
    const d = sim.doorPos;
    sim.teleport(d.x, d.z - 0.5);
    run(sim, 2);
    sim.step({ ...emptyFrame(), interact: true });
    expect(sim.tasks.day).toBe(1);
    while (!sim.tasks.finished) sim.tasks.skip();
    const inPenAtBedtime = sim.sheepInPen;
    sim.step({ ...emptyFrame(), interact: true });
    expect(sim.tasks.day).toBe(1);
    expect(sim.nightWolf?.state).toBe('stalk');
    expect(sim.sunsetTally()?.safe).toBe(inPenAtBedtime);
    sim.step({ ...emptyFrame(), rest: true });
    expect(sim.tasks.day).toBe(1);

    sim.nightWolf!.morale = 0;
    run(sim, 1);
    sim.step({ ...emptyFrame(), rest: true });
    expect(sim.tasks.day).toBe(2);
    expect(sim.wolves.list.some((wolf) => wolf.kind === 'pen')).toBe(false);
    expect(sim.hour).toBeCloseTo(config.time.startHour, 1);
    expect(sim.sunsetTally(1)?.safe).toBe(inPenAtBedtime);
    expect(sim.sunsetTally()).toBeUndefined();
  });

  it('toggles the lantern on foot and the headlamp while mounted', () => {
    const sim = newSim();
    sim.step({ ...emptyFrame(), lamp: true });
    expect(sim.lanternOn).toBe(true);
    sim.mount();
    sim.step({ ...emptyFrame(), lamp: true });
    expect(sim.bike.lamp).toBe(true);
    expect(sim.lanternOn).toBe(true);
    sim.dismount();
    sim.step({ ...emptyFrame(), lamp: true });
    expect(sim.lanternOn).toBe(false);
    expect(sim.bike.lamp).toBe(true);
  });
});

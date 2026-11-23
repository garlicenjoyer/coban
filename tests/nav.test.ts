// Pathfinding: animals find their way round fences and walls instead of pressing into them.

import { beforeAll, describe, expect, it } from 'vitest';
import { emptyFrame } from '../src/core/input';
import { buildProps, insidePen, layout } from '../src/world/map';
import { NavAgent, NavGrid } from '../src/world/nav';
import { Obstacles } from '../src/world/obstacles';
import { initRapier, newSim, terrain } from './helpers';

const pen = layout.pen;
const gateX = pen.x + pen.hx;
/** Behind the pen, on the side away from the gate. */
const behind = { x: pen.x - pen.hx - 6, z: pen.z };
const inside = { x: pen.x - pen.hx + 3, z: pen.z };

describe('NavGrid', () => {
  const obstacles = new Obstacles(buildProps(terrain));
  const nav = new NavGrid(terrain, obstacles);
  const gate = obstacles.byRole('gate');

  it('sees the fence as a wall', () => {
    expect(nav.clear(inside.x, inside.z, behind.x, behind.z)).toBe(false);
    expect(nav.clear(inside.x, inside.z, inside.x + 4, inside.z)).toBe(true);
  });

  it('routes out of the pen through the open gate', () => {
    for (const o of gate) o.enabled = false;
    const r = nav.findPath(inside.x, inside.z, behind.x, behind.z)!;
    expect(r.partial).toBe(false);
    const pts = r.points;
    // Passes the gate opening, then ends at the goal.
    let throughGate = false;
    for (let i = 0; i < pts.length; i += 2) if (Math.abs(pts[i] - gateX) < 3 && Math.abs(pts[i + 1] - pen.z) < 3) throughGate = true;
    expect(throughGate).toBe(true);
    expect(pts[pts.length - 2]).toBeCloseTo(behind.x);
    expect(pts[pts.length - 1]).toBeCloseTo(behind.z);
    // Every leg is clear.
    let x = inside.x;
    let z = inside.z;
    for (let i = 0; i < pts.length; i += 2) {
      expect(nav.clear(x, z, pts[i], pts[i + 1])).toBe(true);
      [x, z] = [pts[i], pts[i + 1]];
    }
  });

  it('a shut gate leaves the goal unreachable (partial path)', () => {
    for (const o of gate) o.enabled = true;
    const r = nav.findPath(inside.x, inside.z, behind.x, behind.z)!;
    expect(r.partial).toBe(true);
    const end = { x: r.points[r.points.length - 2], z: r.points[r.points.length - 1] };
    expect(insidePen(end.x, end.z)).toBe(true);
  });

  it('an agent walks out and round to the goal', () => {
    for (const o of gate) o.enabled = false;
    const agent = new NavAgent(nav, { maxSlope: 35, softSlope: 28 });
    let x = inside.x;
    let z = inside.z;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 40; i++) {
      const w = agent.steer(x, z, behind.x, behind.z, dt);
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < 0.05) break;
      const step = Math.min(d, 1.7 * dt);
      const p = obstacles.pushOut(x + ((w.x - x) / d) * step, z + ((w.z - z) / d) * step, 0.42);
      [x, z] = [p.x, p.z];
    }
    expect(Math.hypot(x - behind.x, z - behind.z)).toBeLessThan(0.5);
  });
});

describe('animals in the sim', () => {
  beforeAll(initRapier);

  it('the flock follows the bellwether out by the gate and round to the back of the pen', () => {
    const sim = newSim();
    sim.setGate(true);
    sim.teleport(gateX + 25, pen.z + 25); // out of the way
    const L = sim.flock.leader;
    const pin = () => {
      L.x = L.px = behind.x;
      L.z = L.pz = behind.z;
      L.vx = L.vz = 0;
    };
    pin();
    for (let i = 0; i < 60 * 60; i++) {
      sim.step(emptyFrame());
      pin();
    }
    const out = sim.flock.sheep.filter((s) => s !== L && !s.inPen && Math.hypot(s.x - behind.x, s.z - behind.z) < 14).length;
    expect(out).toBeGreaterThanOrEqual(Math.ceil((sim.flock.sheep.length - 1) * 0.75));
  });

  it('the dog goes round the pen to reach a point behind it', () => {
    const sim = newSim();
    sim.setGate(false);
    const dog = sim.dog;
    dog.x = dog.px = gateX + 6;
    dog.z = dog.pz = pen.z + 2;
    // Drive his locomotion directly: target behind the pen at a trot.
    const move = (dog as unknown as { move(c: { dt: number }): void }).move.bind(dog);
    for (let i = 0; i < 60 * 30; i++) {
      dog.tx = behind.x;
      dog.tz = behind.z;
      dog.gait = 'trot';
      move({ dt: 1 / 60 });
    }
    expect(Math.hypot(dog.x - behind.x, dog.z - behind.z)).toBeLessThan(1.5);
  });
});

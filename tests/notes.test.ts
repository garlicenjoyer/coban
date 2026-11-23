// Uncle Ahmet's notes and pencil marks (GDD Part V, feature 4): notes lie where the
// shepherd can reach them, E reads one, and each note read adds its marks to his map.

import RAPIER from '@dimforge/rapier3d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { emptyFrame } from '../src/core/input';
import { Sim } from '../src/sim';
import { useMap } from '../src/world/map';
import { visibleMarks } from '../src/world/mapTypes';
import { Obstacles } from '../src/world/obstacles';
import { TEST_MAP } from '../src/world/testMap';
import { VALLEY_MAP } from '../src/world/valley';
import { initRapier } from './helpers';

const terrain = VALLEY_MAP.buildTerrain();
const map = VALLEY_MAP.buildProps(terrain);
const obstacles = new Obstacles(map);
const notes = VALLEY_MAP.notes!;
const pencil = VALLEY_MAP.pencil!;
const note = (id: string) => notes.find((n) => n.id === id)!;

beforeAll(async () => {
  await initRapier();
  useMap(VALLEY_MAP);
});
afterAll(() => useMap(TEST_MAP));

/** An open spot within reach of a note where the shepherd can stand. */
function standingSpot(x: number, z: number): { x: number; z: number } | null {
  for (const r of [0.6, 0.9, 1.2, 1.5])
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (!obstacles.blocked(sx, sz, config.player.capsuleRadius) && terrain.slopeDegAt(sx, sz) < 25) return { x: sx, z: sz };
    }
  return null;
}

describe("Uncle Ahmet's notes", () => {
  it('there are seven, each lying where the shepherd can stand and reach it', () => {
    expect(notes.map((n) => n.id)).toEqual(['letter', 'dere', 'hut', 'wolves', 'ruins', 'lookout', 'cistern']);
    for (const n of notes) {
      expect(standingSpot(n.x, n.z), n.id).not.toBeNull();
      expect(n.text.length).toBeGreaterThan(80);
    }
    // Notes keep their distance from each other and from the works sites.
    for (const a of notes) for (const b of notes) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(20);
  });

  it('his map starts with his routes and pasture notes; each note adds its own marks', () => {
    const ids = new Set(notes.map((n) => n.id));
    // Every mark comes from one of his notes, or from what the museum curator tells you.
    for (const m of pencil) if (m.from) expect(ids.has(m.from) || /^museum\d$/.test(m.from), m.id).toBe(true);
    const start = visibleMarks(pencil, new Set()).map((m) => m.id);
    expect(start).toEqual(expect.arrayContaining(['routeD', 'routeB', 'noteA', 'noteC']));
    expect(start).not.toContain('wolves');
    const afterWolves = visibleMarks(pencil, new Set(['wolves'])).map((m) => m.id);
    expect(afterWolves).toEqual(expect.arrayContaining(['wolves', 'Emorning']));
    expect(afterWolves).not.toContain('fold');
    // Every note but the letter adds something.
    for (const n of notes) if (n.id !== 'letter') expect(pencil.some((m) => m.from === n.id), n.id).toBe(true);
  });

  it('E by a note reads it; the first reading is news, later ones are not', () => {
    const sim = new Sim(RAPIER, terrain);
    sim.tasks.enabled = false;
    const reads: { id: string; first: boolean }[] = [];
    sim.events.on('noteRead', (e) => reads.push(e));
    const n = note('dere');
    const spot = standingSpot(n.x, n.z)!;
    sim.teleport(spot.x, spot.z);
    sim.step({ ...emptyFrame(), interact: true });
    expect(sim.notesRead.has('dere')).toBe(true);
    sim.step(emptyFrame());
    sim.step({ ...emptyFrame(), interact: true });
    expect(reads).toEqual([
      { id: 'dere', first: true },
      { id: 'dere', first: false },
    ]);
    // Out of reach, E does nothing with it.
    sim.teleport(n.x + 10, n.z);
    sim.step({ ...emptyFrame(), interact: true });
    expect(reads.length).toBe(2);
  });

  it('the unread letter on the porch table comes before the bed', () => {
    const sim = new Sim(RAPIER, terrain);
    sim.tasks.enabled = false;
    const door = sim.doorPos;
    const letter = note('letter');
    expect(Math.hypot(door.x - letter.x, door.z - letter.z)).toBeLessThan(config.notes.reach + 0.5);
    const spot = standingSpot(letter.x, letter.z)!;
    sim.teleport(spot.x, spot.z);
    const day = sim.tasks.day;
    sim.step({ ...emptyFrame(), interact: true });
    expect(sim.notesRead.has('letter')).toBe(true);
    expect(sim.tasks.day).toBe(day);
  });

  it('the test map has no notes', () => {
    expect(TEST_MAP.notes ?? []).toEqual([]);
  });
});

// The homestead's art pass added a few solid things (the çeşme's wall, the ağıl shelter's
// posts, the fig, the haystack, the tandır, the clothesline posts). On both maps they must
// stand clear of everything else and of where the shepherd, dog and bike start.

import { describe, expect, it } from 'vitest';
import type { MapDef, Prop } from '../src/world/mapTypes';
import { TEST_MAP } from '../src/world/testMap';
import { VALLEY_MAP } from '../src/world/valley';

const NEW_ROLES = new Set(['post', 'cesme', 'hay', 'oven', 'fig']);
const footprint = (p: Prop) => (p.kind === 'cyl' ? p.radius : Math.hypot(p.hx, p.hz));

/** Clear ground between two props' footprints (circles and axis-aligned boxes). */
function gapBetween(a: Prop, b: Prop): number {
  const half = (p: Prop) => (p.kind === 'box' ? { hx: p.hx, hz: p.hz, r: 0 } : { hx: 0, hz: 0, r: p.radius });
  const A = half(a);
  const B = half(b);
  const dx = Math.max(0, Math.abs(a.x - b.x) - A.hx - B.hx);
  const dz = Math.max(0, Math.abs(a.z - b.z) - A.hz - B.hz);
  return Math.hypot(dx, dz) - A.r - B.r;
}

describe.each([
  ['the valley', VALLEY_MAP],
  ['the test map', TEST_MAP],
] as [string, MapDef][])('the homestead on %s', (_, def) => {
  const t = def.buildTerrain();
  const map = def.buildProps(t);
  const L = def.layout;
  const added = map.props.filter((p) => NEW_ROLES.has(p.role));

  it('has the çeşme wall, three shelter posts, the fig, the haystack, the oven and the clothesline', () => {
    const count = (role: string) => added.filter((p) => p.role === role).length;
    expect(count('cesme')).toBe(1);
    expect(count('post')).toBe(5);
    expect(count('fig') + count('hay') + count('oven')).toBe(3);
  });

  it('keeps them clear of every other solid thing', () => {
    for (const a of added) {
      for (const b of map.props) {
        if (a === b || b.role === 'marker') continue;
        // The çeşme wall stands against its own trough.
        if (a.role === 'cesme' && b.role === 'trough') continue;
        const gap = gapBetween(a, b);
        expect(gap, `${a.role} at ${a.x.toFixed(1)},${a.z.toFixed(1)} vs ${b.role} at ${b.x.toFixed(1)},${b.z.toFixed(1)}`).toBeGreaterThan(0.3);
      }
    }
  });

  it('keeps them away from where the shepherd, the dog and the bike start, and the pen gate', () => {
    const gate = { x: L.pen.x + L.pen.hx, z: L.pen.z };
    for (const a of added)
      for (const s of [L.spawn, L.dogSpawn, L.bikeSpawn, gate]) expect(Math.hypot(a.x - s.x, a.z - s.z) - footprint(a)).toBeGreaterThan(1.5);
  });
});

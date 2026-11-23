// The valley's ambient sound: what plays when. The Web Audio side is checked by ear; these
// pin down the rules it follows.

import { beforeAll, describe, expect, it } from 'vitest';
import { bellPitch, bellRate, cicadaLevel, nightLevel, PRAYER_HOURS, prayerDue, wearsBell } from '../src/audio/ambience';
import { SIM_DT, SUNSET_HOUR } from '../src/core/config';
import { initRapier, newSim } from './helpers';

beforeAll(initRapier);

describe('ambience', () => {
  it('cicadas fill the hot middle of the day; crickets and the owl take the night', () => {
    expect(cicadaLevel(6.5)).toBe(0);
    expect(cicadaLevel(13)).toBe(1);
    expect(cicadaLevel(21)).toBe(0);
    expect(nightLevel(13)).toBe(0);
    expect(nightLevel(22)).toBe(1);
    expect(nightLevel(2)).toBe(1);
    expect(nightLevel(6.5)).toBe(0);
    // They hand over around sunset rather than overlapping at full strength.
    expect(cicadaLevel(SUNSET_HOUR + 0.5) + nightLevel(SUNSET_HOUR + 0.5)).toBeLessThan(1);
  });

  it('the call to prayer sounds as its time passes, but not across a sleep', () => {
    for (const t of PRAYER_HOURS) expect(prayerDue(t - 0.01, t + 0.005)).toBe(t);
    expect(prayerDue(13.0, 13.1)).toBeNull();
    // Sleeping or skipping time jumps past it unheard.
    expect(prayerDue(12, 21)).toBeNull();
    expect(prayerDue(20.7, 6.5)).toBeNull();
    // Afternoon, evening and night prayers fall in the playable day; evening just after sunset.
    expect(PRAYER_HOURS.some((t) => t > SUNSET_HOUR && t < SUNSET_HOUR + 0.5)).toBe(true);
  });

  it('six or seven sheep wear bells, the bellwether the lowest; walking rings them and a hush silences them', () => {
    const sim = newSim();
    const sheep = sim.flock.sheep;
    const belled = sheep.filter(wearsBell);
    expect(belled.length).toBeGreaterThanOrEqual(6);
    expect(belled.length).toBeLessThanOrEqual(7);
    const leader = sheep.find((s) => s.isLeader)!;
    expect(belled).toContain(leader);
    for (const s of belled) if (s !== leader) expect(bellPitch(s)).toBeGreaterThan(bellPitch(leader));

    const s = belled.find((b) => b !== leader)!;
    s.inPen = false;
    s.hushed = false;
    s.px = s.x;
    s.pz = s.z;
    const grazing = bellRate(s);
    s.px = s.x - 1.2 * SIM_DT; // walking at 1.2 m/s
    const walking = bellRate(s);
    expect(walking).toBeGreaterThan(grazing * 5);
    s.hushed = true;
    expect(bellRate(s)).toBe(0);
  });
});

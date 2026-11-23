import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LUNAR_DAYS, moonDirection, moonIllumination, moonPhase } from '../src/render/style';
import { meltem } from '../src/render/wind';
import { config } from '../src/core/config';

describe('the moon', () => {
  it('runs through one full moon and one new moon in the 28 summer days', () => {
    const lit = Array.from({ length: config.village.summerDays }, (_, i) => moonIllumination(moonPhase(i + 1)));
    expect(Math.max(...lit)).toBeGreaterThan(0.97);
    expect(Math.min(...lit)).toBeLessThan(0.03);
    // Day 1 is a waxing crescent-to-quarter: some light for the first night, not much.
    expect(lit[0]).toBeGreaterThan(0.3);
    expect(lit[0]).toBeLessThan(0.6);
    expect(moonPhase(1 + Math.round(LUNAR_DAYS))).toBeCloseTo(moonPhase(1), 1);
  });

  it('rises at sunset when full and is high at dusk at first quarter', () => {
    const v = new THREE.Vector3();
    expect(moonDirection(v, 18, 0.5).y).toBeCloseTo(0, 5);
    expect(moonDirection(v, 24, 0.5).y).toBeGreaterThan(0.9);
    expect(moonDirection(v, 18, 0.25).y).toBeGreaterThan(0.9);
    expect(moonDirection(v, 24, 0.25).y).toBeCloseTo(0, 5);
    // A new moon is down all night.
    for (const h of [20, 22, 24, 26]) expect(moonDirection(v, h % 24, 0).y).toBeLessThan(0);
  });
});

describe('the meltem', () => {
  it('is calm at dawn, strongest in the afternoon and drops at night', () => {
    expect(meltem(6.5)).toBeLessThan(0.5);
    expect(meltem(16)).toBeGreaterThan(1.1);
    expect(meltem(23)).toBeLessThan(0.5);
    expect(meltem(16)).toBeGreaterThan(meltem(11));
  });
});

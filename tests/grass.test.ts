import { describe, expect, it } from 'vitest';
import { keepAt } from '../src/world/grassField';

describe('the grass field', () => {
  it('keeps every blade near the camera and thins out in rings to nothing at ~95 m', () => {
    expect(keepAt(0)).toBe(1);
    expect(keepAt(15)).toBeCloseTo(1, 5);
    expect(keepAt(42)).toBeCloseTo(0.3, 2);
    expect(keepAt(72)).toBeCloseTo(0.11, 2);
    expect(keepAt(96)).toBeCloseTo(0, 5);
    // Never rises again with distance (no popping back in).
    for (let d = 0; d < 100; d += 0.5) expect(keepAt(d + 0.5)).toBeLessThanOrEqual(keepAt(d) + 1e-9);
  });
});

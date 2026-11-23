import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ShepherdFootwork } from '../src/player/shepherdFootwork';

describe.each([
  { name: 'walk', speed: 1.4, crouch: 0, run: 0, lift: 0.07 },
  { name: 'sneak', speed: 0.8, crouch: 1, run: 0, lift: 0.04 },
  { name: 'sprint', speed: 4.5, crouch: 0, run: 1, lift: 0.23 },
])('$name footwork', ({ speed, crouch, run, lift }) => {
  it('holds ground contacts and clears the terrain between steps', () => {
    const footwork = new ShepherdFootwork(new Vector3(0.13, 0.143, -0.02), new Vector3(-0.13, 0.143, -0.02));
    const model = new Matrix4();
    const ground = (x: number, z: number) => 0.06 * x + 0.11 * z;
    const ankle = new Vector3();
    const previous = [new Vector3(), new Vector3()];
    const planted = [false, false];
    const peaks = [0, 0];
    const contacts: number[] = [];
    let flightFrames = 0;

    for (let i = 0; i < 240; i++) {
      const z = i * speed / 60;
      model.makeTranslation(0, ground(0, z), z);
      footwork.advance(model, 1 / 60, speed, crouch, run, true, ground);
      if (i < 40) continue;
      if (footwork.feet.every((foot) => !foot.planted)) flightFrames++;
      for (const [side, foot] of footwork.feet.entries()) {
        ankle.copy(foot.target).applyMatrix4(model);
        if (i > 40 && !planted[side] && foot.planted) contacts.push(side);
        const clearance = ankle.y - foot.rest.y - ground(ankle.x, ankle.z);
        if (foot.planted) {
          expect(clearance).toBeGreaterThan(-0.001);
          if (planted[side]) {
            expect(Math.hypot(ankle.x - previous[side].x, ankle.z - previous[side].z)).toBeLessThan(0.0001);
          }
        } else peaks[side] = Math.max(peaks[side], clearance);
        planted[side] = foot.planted;
        previous[side].copy(ankle);
      }
    }

    expect(Math.min(...peaks)).toBeGreaterThan(lift);
    expect(contacts.length).toBeGreaterThanOrEqual(5);
    expect(contacts.every((side, i) => i === 0 || side !== contacts[i - 1])).toBe(true);
    expect(flightFrames > 0).toBe(run === 1);
  });
});

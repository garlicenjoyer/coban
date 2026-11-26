import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/core/config';
import { boxContact, resolveContact } from '../src/life/chassisContact';
import { RoadVehicle, type VehicleKind } from '../src/life/roadVehicle';
import { Obstacles } from '../src/world/obstacles';
import { Surface, Terrain } from '../src/world/terrain';

const neutral = { steer: 0, throttle: 0, brake: 0 };

function vehicle(kind: VehicleKind, surface = Surface.Asphalt) {
  const terrain = new Terrain(400, 41);
  terrain.surfaces.fill(surface);
  const obstacles = new Obstacles({ props: [], decor: [], labels: [], pastureDistances: {} });
  return new RoadVehicle({ x: 0, z: 0, yaw: 0 }, terrain, obstacles, kind);
}

describe('road vehicle dynamics', () => {
  it('takes distance to stop and brakes further on mud than pavement', () => {
    const stops = [Surface.Asphalt, Surface.Mud].map(surface => {
      const car = vehicle('car', surface);
      car.speed = 12;
      for (let i = 0; i < 600 && car.speed > 0.15; i++) car.step(SIM_DT, { ...neutral, brake: 1 });
      expect(car.speed).toBeLessThanOrEqual(0.15);
      const stop = car.z;
      for (let i = 0; i < 120; i++) car.step(SIM_DT, { ...neutral, brake: 1 });
      expect(car.speed).toBeLessThan(-0.2);
      return stop;
    });
    expect(stops[0]).toBeGreaterThan(4);
    expect(stops[1]).toBeGreaterThan(stops[0] * 1.35);
  });

  it('builds speed, yaw and suspension load over time, with distinct car and van handling', () => {
    const [car, van] = [vehicle('car'), vehicle('van')];
    for (const v of [car, van]) {
      for (let i = 0; i < 180; i++) v.step(SIM_DT, { ...neutral, throttle: 1 });
      expect(v.pitch).toBeLessThan(0);
    }
    expect(car.speed).toBeGreaterThan(van.speed);
    for (const v of [car, van]) {
      v.step(SIM_DT, { ...neutral, steer: 1 });
      expect(Math.abs(v.steerAngle)).toBeLessThan(0.1);
      for (let i = 0; i < 40; i++) v.step(SIM_DT, { ...neutral, steer: 1 });
      expect(v.x).toBeLessThan(-0.2);
      expect(v.spin).toBeLessThan(-0.1);
      expect(v.roll).toBeLessThan(-0.02);
    }
  });

  it.each([0, 0.78])('transfers momentum to a parked van at a lateral offset of %sm', offset => {
    const car = vehicle('car'), van = vehicle('van');
    car.x = offset;
    van.z = car.length + van.length - 0.1;
    car.speed = 13;
    const momentum = car.mass * car.vz;
    const contact = boxContact(car, van)!;
    expect(resolveContact(car, van, contact)).toBeCloseTo(13);
    expect(car.mass * car.vz + van.mass * van.vz).toBeCloseTo(momentum, 7);
    expect(van.vz).toBeGreaterThan(3);
    expect(car.vz).toBeLessThan(10);
    if (offset) {
      expect(Math.abs(car.spin)).toBeGreaterThan(0.2);
      expect(Math.abs(van.spin)).toBeGreaterThan(0.2);
    } else {
      expect(car.spin).toBeCloseTo(0);
      expect(van.spin).toBeCloseTo(0);
    }
    const otherStart = van.z;
    for (let i = 0; i < 180; i++) van.step(SIM_DT);
    expect(van.z).toBeGreaterThan(otherStart + 0.2);
    expect(van.moving).toBe(false);
  });
});

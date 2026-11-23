// Motorcycle physics on purpose-built terrain (flat or a 25° incline, one surface).

import { describe, expect, it } from 'vitest';
import { Bike, type BikeInput } from '../src/bike/bike';
import { config, SIM_DT } from '../src/core/config';
import { EventBus } from '../src/core/events';
import { Obstacles } from '../src/world/obstacles';
import { Surface, Terrain } from '../src/world/terrain';
import type { MapProps } from '../src/world/testMap';

const DEG = Math.PI / 180;
const noProps: MapProps = { props: [], labels: [], decor: [], pastureDistances: {} };

/** 400 m square, rising toward +z at `slopeDeg`, one surface everywhere. */
function ground(surface: Surface, slopeDeg = 0): Terrain {
  const t = new Terrain(400, 257);
  const k = Math.tan(slopeDeg * DEG);
  for (let ix = 0; ix < t.N; ix++)
    for (let iz = 0; iz < t.N; iz++) {
      t.heights[t.idx(ix, iz)] = k * t.zOf(iz);
      t.surfaces[t.idx(ix, iz)] = surface;
    }
  return t;
}

function riding(t: Terrain, x = 0, z = -150, heading = 0, obstacles = new Obstacles(noProps)) {
  const events = new EventBus();
  const bike = new Bike(x, z, heading, t, obstacles, events);
  bike.state = 'riding';
  bike.rider = true;
  bike.engineOn = true;
  bike.rpm = config.bike.engine.idleRpm;
  bike.footDown = 1;
  return { bike, events };
}

const input = (p: Partial<BikeInput> = {}): BikeInput => ({ throttle: 0, brake: 0, steer: 0, weightShift: 0, ...p });

function ride(bike: Bike, seconds: number, f: (t: number) => Partial<BikeInput>) {
  for (let t = 0; t < seconds; t += SIM_DT) bike.step(SIM_DT, input(f(t)), 0);
}

describe('engine and speed', () => {
  it('reaches about 70 km/h on asphalt, and 50 km/h within 10 s', () => {
    const { bike } = riding(ground(Surface.Asphalt), 0, -180);
    let t50 = -1;
    for (let t = 0; t < 40; t += SIM_DT) {
      bike.step(SIM_DT, input({ throttle: 1 }), 0);
      if (t50 < 0 && bike.kmh >= 50) t50 = t;
    }
    console.log(`[bike] asphalt: 0-50 km/h in ${t50.toFixed(1)} s, top ${bike.kmh.toFixed(0)} km/h in gear ${bike.gear}`);
    expect(t50).toBeGreaterThan(0);
    expect(t50).toBeLessThan(10);
    expect(bike.kmh).toBeGreaterThan(62);
    expect(bike.kmh).toBeLessThan(80);
    expect(bike.gear).toBe(3);
  });

  it('is slower on gravel and much slower in mud', () => {
    const speed = (s: Surface) => {
      const { bike } = riding(ground(s), 0, -180);
      ride(bike, 20, () => ({ throttle: 1 }));
      return bike.kmh;
    };
    const asphalt = speed(Surface.Asphalt);
    const gravel = speed(Surface.Gravel);
    const mud = speed(Surface.Mud);
    console.log(`[bike] 20 s full throttle: asphalt ${asphalt.toFixed(0)}, gravel ${gravel.toFixed(0)}, mud ${mud.toFixed(0)} km/h`);
    expect(gravel).toBeGreaterThan(30);
    expect(gravel).toBeLessThan(45);
    expect(gravel).toBeLessThan(asphalt);
    expect(mud).toBeLessThan(gravel * 0.8);
  });

  it('clutch-drop launch (brake + rev, then release) beats a plain start off the line', () => {
    const plain = riding(ground(Surface.Dirt)).bike;
    ride(plain, 0.6, () => ({ throttle: 1 }));
    const drop = riding(ground(Surface.Dirt)).bike;
    ride(drop, 1, () => ({ throttle: 1, brake: 1 }));
    expect(drop.speed).toBeLessThan(0.1);
    ride(drop, 0.6, () => ({ throttle: 1 }));
    expect(drop.speed).toBeGreaterThan(plain.speed);
  });

  it('kick-starts only when the needle is in the window', () => {
    const { bike } = riding(ground(Surface.Dirt));
    bike.engineOn = false;
    const k = config.bike.kick;
    bike.time = k.cycle * 0.2; // outside
    expect(bike.kick(0)).toBe(false);
    expect(bike.engineOn).toBe(false);
    bike.time = k.cycle * ((k.windowStart + k.windowEnd) / 2);
    expect(bike.kick(0)).toBe(true);
    expect(bike.engineOn).toBe(true);
  });
});

describe('the 25° hill (M4 acceptance)', () => {
  const climb = (s: Surface) => {
    const t = ground(s, 25);
    const { bike } = riding(t, 0, -150, 0);
    const y0 = bike.y;
    ride(bike, 15, () => ({ throttle: 1, weightShift: 0.3 }));
    return { gain: bike.y - y0, bike };
  };

  it('climbs on packed dirt', () => {
    const { gain, bike } = climb(Surface.Dirt);
    console.log(`[bike] 25° dirt: climbed ${gain.toFixed(1)} m in 15 s, ${bike.kmh.toFixed(0)} km/h`);
    expect(bike.state).toBe('riding');
    expect(gain).toBeGreaterThan(8);
  });

  it('cannot climb in mud: it bogs down', () => {
    const { gain, bike } = climb(Surface.Mud);
    console.log(`[bike] 25° mud: height change ${gain.toFixed(1)} m, bogged ${bike.bogged.toFixed(1)} s, state ${bike.state}`);
    expect(gain).toBeLessThan(1.5);
  });

  it('brakes hold the bike on a 25° dirt slope; without them it rolls back', () => {
    for (const [brake, holds] of [
      [1, true],
      [0, false],
    ] as const) {
      const { bike } = riding(ground(Surface.Dirt, 25));
      bike.footDown = 1;
      const z0 = bike.z;
      ride(bike, 3, () => ({ brake }));
      expect(Math.abs(bike.z - z0) < 0.2).toBe(holds);
      if (!holds) expect(bike.z).toBeLessThan(z0); // backwards, downhill
    }
  });
});

describe('slides and falls', () => {
  it('steering right turns right (clockwise from above)', () => {
    const { bike } = riding(ground(Surface.Asphalt), 0, -100, 0); // facing +z (south)
    ride(bike, 3, () => ({ throttle: 0.6 }));
    const x0 = bike.x;
    ride(bike, 2, () => ({ throttle: 0.4, steer: 1 }));
    expect(bike.x).toBeLessThan(x0); // facing south, right is west (-x)
  });

  it('steering alone on gravel does not slide', () => {
    const { bike } = riding(ground(Surface.Gravel), 0, -100);
    ride(bike, 6, () => ({ throttle: 1 }));
    ride(bike, 4, () => ({ throttle: 0, steer: 1 }));
    expect(bike.state).toBe('riding');
    expect(Math.abs(bike.beta)).toBeLessThan(5 * DEG);
  });

  it('throttle in a gravel turn steps the rear out; holding it in throws you off', () => {
    const { bike } = riding(ground(Surface.Gravel), 0, -100);
    ride(bike, 6, () => ({ throttle: 1 }));
    let maxBeta = 0;
    for (let t = 0; t < 6 && bike.state === 'riding'; t += SIM_DT) {
      bike.step(SIM_DT, input({ throttle: 1, steer: 1 }), 0);
      maxBeta = Math.max(maxBeta, Math.abs(bike.beta));
    }
    console.log(`[bike] gravel turn on throttle: max slip ${(maxBeta / DEG).toFixed(0)}°, ${bike.state}`);
    expect(maxBeta).toBeGreaterThan(15 * DEG);
    expect(bike.state).toBe('fallen');
  });

  it('a gravel slide is recoverable: counter-steer and ease the throttle', () => {
    const { bike } = riding(ground(Surface.Gravel), 0, -100);
    ride(bike, 6, () => ({ throttle: 1 }));
    // Provoke a slide…
    for (let t = 0; t < 3 && Math.abs(bike.beta) < 15 * DEG; t += SIM_DT) bike.step(SIM_DT, input({ throttle: 1, steer: 1 }), 0);
    expect(Math.abs(bike.beta)).toBeGreaterThan(15 * DEG);
    // …and catch it.
    ride(bike, 2.5, () => ({ throttle: 0.3, steer: Math.sign(bike.beta) }));
    expect(bike.state).toBe('riding');
    expect(Math.abs(bike.beta)).toBeLessThan(6 * DEG);
  });

  it('hitting a fence fast throws you off; nudging it does not', () => {
    const fence: MapProps = {
      props: [{ kind: 'box', role: 'fence', x: 0, y: 0.6, z: -120, hx: 5, hy: 0.6, hz: 0.1 }],
      labels: [],
      decor: [],
      pastureDistances: {},
    };
    for (const [speed, falls] of [
      [10, true],
      [2.5, false],
    ] as const) {
      const { bike } = riding(ground(Surface.Dirt), 0, -128, 0, new Obstacles(fence));
      bike.u = speed;
      ride(bike, 2, () => ({ throttle: speed > 5 ? 1 : 0.15 }));
      expect(bike.state === 'fallen').toBe(falls);
      expect(bike.z).toBeLessThan(-120);
    }
  });

  it('stopping hard on a steep slope before your foot is down tips you over', () => {
    const { bike } = riding(ground(Surface.Dirt, 25));
    bike.u = 3;
    bike.footDown = 0;
    ride(bike, 2, () => ({ brake: 1 }));
    expect(bike.state).toBe('fallen');
    // Foot already down: fine.
    const calm = riding(ground(Surface.Dirt, 25)).bike;
    calm.footDown = 1;
    ride(calm, 2, () => ({ brake: 1 }));
    expect(calm.state).toBe('riding');
  });

  it('a parked bike falls off its stand on steep ground, and can be lifted', () => {
    const { bike } = riding(ground(Surface.Dirt, 30));
    bike.state = 'parked';
    bike.rider = false;
    ride(bike, 0.5, () => ({}));
    expect(bike.state).toBe('fallen');
    bike.lift();
    expect(bike.state).toBe('parked');
  });
});

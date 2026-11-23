// Ideas borrowed from Death Stranding: the land remembers your routes (worn trails), the
// flock is cargo with a condition, the satchel is packed for the route, things you build
// stay, wolf ground announces itself, and light combat is warning stones and injuries.

import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { emptyFrame, type InputFrame } from '../src/core/input';
import { Mode } from '../src/flock/sheep';
import type { Sim } from '../src/sim';
import { GrassMap } from '../src/world/grassMap';
import { insideFold, layout } from '../src/world/testMap';
import { initRapier, newSim, placeFlock, run, terrain, yawToward } from './helpers';

beforeAll(initRapier);

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...emptyFrame(), ...over });

/** Seconds until 80% of the flock is within 9 m of the calling shepherd (or the cap). */
function callIn(sim: Sim, px: number, pz: number, cap = 40): number {
  sim.teleport(px, pz);
  // A long-carrying call, so the whole flock hears it from 30 m.
  const radius = config.player.callRadius;
  config.player.callRadius = 45;
  try {
    for (let i = 0; i < cap * 60; i++) {
      sim.step(frame({ call: true }));
      const near = sim.flock.sheep.filter((s) => Math.hypot(s.x - px, s.z - pz) < 9).length;
      if (near >= sim.flock.sheep.length * 0.8) return i / 60;
    }
    return cap;
  } finally {
    config.player.callRadius = radius;
  }
}

function quietSim(): Sim {
  const sim = newSim();
  sim.tasks.enabled = false;
  sim.dog.x = sim.dog.px = 150; // keep the dog out of it
  sim.dog.z = sim.dog.pz = -150;
  return sim;
}

describe('worn trails', () => {
  it('treading wears a path that grass cannot cover, and unused paths grass over', () => {
    const g = new GrassMap(terrain);
    const x = -20;
    const z = 100;
    for (let i = 0; i < 400; i++) g.tread(x, z, 0.004);
    expect(g.wearAt(x, z)).toBeGreaterThan(0.9);
    expect(g.at(x, z)).toBeLessThan(0.4);
    g.grow(24);
    expect(g.at(x, z)).toBeLessThan(1 - 0.8 * config.trails.grassCap + 0.05);
    const before = g.wearAt(x, z);
    g.grow(100);
    expect(g.wearAt(x, z)).toBeLessThan(before - 0.3);
  });

  it('a walking flock wears the ground it crosses', () => {
    const sim = quietSim();
    placeFlock(sim, -20, 110);
    callIn(sim, -20, 84);
    expect(sim.grass.wearAt(-20, 97)).toBeGreaterThan(0);
  });

  it('the flock comes faster along a worn path', () => {
    const timed = (worn: boolean) => {
      const sim = quietSim();
      if (worn) sim.grass.wear.fill(1);
      placeFlock(sim, -20, 110);
      return callIn(sim, -20, 80);
    };
    const fresh = timed(false);
    const trail = timed(true);
    expect(trail).toBeLessThan(fresh * 0.95);
  });
});

describe('the flock as cargo: condition', () => {
  it('a wolf bite hurts, calm grazing mends, and worn-down sheep limp', () => {
    const sim = quietSim();
    placeFlock(sim, -50, 100);
    const s = sim.flock.sheep[3];
    const before = s.condition;
    sim.flock.bite(3, s.x + 1, s.z);
    expect(s.condition).toBe(before - config.condition.bite);

    // Two calm hours on good pasture.
    const calm = quietSim();
    placeFlock(calm, -50, 100);
    calm.teleport(-50, 130);
    for (const sh of calm.flock.sheep) sh.condition = 60;
    run(calm, 60 * 120);
    const mean = calm.flock.sheep.reduce((a, sh) => a + sh.condition, 0) / calm.flock.sheep.length;
    expect(mean).toBeGreaterThan(61);

    const limping = (c: number) => {
      const sm = quietSim();
      placeFlock(sm, -20, 110);
      for (const sh of sm.flock.sheep) sh.condition = c;
      return callIn(sm, -20, 80);
    };
    expect(limping(30)).toBeGreaterThan(limping(90));
  });

  it('wolves single out the weak', () => {
    const sim = quietSim();
    placeFlock(sim, -20, 110);
    const sheep = sim.flock.sheep;
    // The sheep farthest from the wolf (but still in range) is worn down.
    const w = sim.spawnWolf(-20, 92);
    const far = sheep.reduce((a, s) => (s.z > a.z ? s : a));
    far.condition = 5;
    run(sim, 2);
    expect(w.state).toBe('hunt');
    expect(sheep[w.target]).toBe(far);
  });

  it('a night in the pen mends more than a night outside', () => {
    const sim = newSim();
    sim.startDay(2);
    sim.setGate(false);
    sim.dog.bond = 100;
    for (const s of sim.flock.sheep) s.condition = 50;
    while (!sim.tasks.finished) sim.tasks.skip();
    sim.sleep();
    expect(sim.flock.sheep.every((s) => s.condition === 50 + config.condition.nightPenned)).toBe(true);
  });
});

describe('the satchel', () => {
  it('can only be repacked at home, and is refilled each morning there', () => {
    const sim = quietSim();
    sim.teleport(-20, 100);
    run(sim, 1, () => frame({ pack: ['salt', 'cay', 'rope'] }));
    expect(sim.satchel.ids).toEqual(['salve', 'rope', 'cay']);
    sim.teleport(sim.doorPos.x, sim.doorPos.z);
    run(sim, 1, () => frame({ pack: ['salt', 'cay', 'rope', 'salve'] }));
    expect(sim.satchel.ids).toEqual(['salt', 'cay', 'rope']);
    sim.satchel.slots[0].uses = 0;
    sim.startDay(2);
    expect(sim.satchel.slots[0].uses).toBe(1);
  });

  it('salve heals the worst-hurt sheep within reach, twice a day', () => {
    const sim = quietSim();
    placeFlock(sim, -20, 110);
    const s = sim.flock.sheep[0];
    sim.teleport(s.x + 1, s.z);
    s.condition = 30;
    run(sim, 1, () => frame({ item: 0 }));
    expect(s.condition).toBeGreaterThanOrEqual(30 + config.satchel.salveHeal - 1);
    expect(sim.satchel.slots[0].uses).toBe(1);
  });

  it('the halter rope frees a stuck sheep and leads it home at your heel', () => {
    const sim = quietSim();
    placeFlock(sim, -20, 110);
    const s = sim.flock.sheep[5];
    s.stuck = 'thorn';
    sim.teleport(s.x + 1.2, s.z);
    run(sim, 1, () => frame({ item: 1 }));
    expect(s.stuck).toBe('none');
    expect(s.led).toBe(true);
    // Walk 30 m south; she comes along.
    const yaw = yawToward(0, 0, 0, 1);
    run(sim, 60 * 25, () => frame({ moveY: 1, camYaw: yaw }));
    run(sim, 60 * 3);
    const p = sim.player.pos;
    expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeLessThan(4);
    run(sim, 1, () => frame({ item: 1 }));
    expect(s.led).toBe(false);
  });

  it('a salt lick keeps a grazing flock close while you are away', () => {
    const spreadAfter = (salt: boolean) => {
      const sim = quietSim();
      sim.satchel.pack(['salt']);
      placeFlock(sim, -20, 110);
      sim.teleport(-20, 110);
      if (salt) run(sim, 1, () => frame({ item: 0 }));
      sim.teleport(-20, 160);
      run(sim, 60 * 240);
      return sim.flock.sheep.reduce((a, s) => a + Math.hypot(s.x + 20, s.z - 110), 0) / sim.flock.sheep.length;
    };
    expect(spreadAfter(true)).toBeLessThan(spreadAfter(false) * 0.8);
  });

  it('çay takes half an hour, settles the flock and pleases Karabaş', () => {
    const sim = quietSim();
    placeFlock(sim, -20, 110);
    for (const s of sim.flock.sheep) s.stress = 60;
    sim.teleport(-20, 104);
    sim.dog.x = sim.dog.px = -18;
    sim.dog.z = sim.dog.pz = 104;
    const bond = sim.dog.bond;
    const h0 = sim.hour;
    run(sim, 1, () => frame({ item: 2 }));
    run(sim, 60 * config.satchel.caySeconds + 5, () => frame({ moveY: 1 }));
    expect(sim.hour - h0).toBeGreaterThan(config.satchel.cayHours - 0.05);
    expect(sim.flock.sheep.every((s) => s.stress < 5)).toBe(true);
    expect(sim.dog.bond).toBe(bond + config.satchel.cayBond);
    // Sitting: he didn't walk off.
    expect(Math.hypot(sim.player.pos.x + 20, sim.player.pos.z - 104)).toBeLessThan(0.5);
  });
});

describe('the sling', () => {
  it('warning stones drive off a wolf, and make nearby sheep jump', () => {
    const sim = quietSim();
    placeFlock(sim, -20, 150); // far behind the shepherd
    sim.teleport(-20, 110);
    const yaw = yawToward(-20, 110, -20, 80);
    // Where does a stone land?
    let hit: { x: number; z: number } | null = null;
    sim.events.on('slingHit', (e) => (hit = e));
    run(sim, 1, () => frame({ sling: true, camYaw: yaw }));
    run(sim, 60 * 3);
    expect(hit).not.toBeNull();
    const range = Math.hypot(hit!.x + 20, hit!.z - 110);
    expect(range).toBeGreaterThan(15);
    expect(range).toBeLessThan(28);

    const w = sim.spawnWolf(hit!.x, hit!.z);
    for (let k = 0; k < 3 && w.state !== 'flee'; k++) {
      w.x = w.px = hit!.x;
      w.z = w.pz = hit!.z;
      run(sim, 1, () => frame({ sling: true, camYaw: yaw }));
      run(sim, 110); // about 1.6 s in the air
    }
    expect(w.state).toBe('flee');

    // A stone among the sheep scatters them a little.
    const sh = quietSim();
    placeFlock(sh, -20, 88);
    sh.teleport(-20, 110);
    run(sh, 1, () => frame({ sling: true, camYaw: yaw }));
    run(sh, 120);
    expect(sh.flock.sheep.some((s) => s.mode === Mode.Flee || s.stress > 5)).toBe(true);
  });
});

describe('wolf ground', () => {
  it('signs are noticed, and a flock lingering by the den draws a warning and then a wolf', () => {
    const sim = quietSim();
    sim.hour = 10;
    const signs: number[] = [];
    sim.events.on('wolfSign', (e) => signs.push(e.index));
    const s0 = layout.wolfSigns[0];
    sim.teleport(s0.x + 3, s0.z + 3);
    run(sim, 1);
    expect(signs).toContain(0);

    let warned = 0;
    sim.events.on('territoryWarn', () => warned++);
    const den = layout.wolfDen;
    placeFlock(sim, den.x + 25, den.z + 30);
    sim.teleport(den.x + 25, den.z + 36);
    run(sim, 60 * (config.territory.warnSeconds + 2), () => frame({ hush: true }));
    expect(warned).toBe(1);
    expect(sim.wolves.list.length).toBe(0);
    run(sim, 60 * (config.territory.wolfSeconds - config.territory.warnSeconds), () => frame({ hush: true }));
    expect(sim.wolves.list.length).toBe(1);
  });
});

describe('things you build stay', () => {
  it('building the hut costs three hours of daylight and leaves a solid hut and fold', () => {
    const sim = quietSim();
    const site = sim.works.site('hut');
    sim.teleport(site.x, site.z);
    const h0 = sim.hour;
    const built: string[] = [];
    sim.events.on('built', (e) => built.push(e.id));
    let frames = 0;
    while (!site.built && frames < 60 * 60) {
      sim.step(frame({ interactHeld: true }));
      frames++;
    }
    expect(built).toEqual(['hut']);
    expect(sim.hour - h0).toBeGreaterThan(2.9);
    expect(frames / 60).toBeLessThan(30); // a long minute of work, not three hours
    const h = layout.works.hut;
    expect(sim.obstacles.blocked(h.x, h.z, 0.3)).toBe(true);
    expect(sim.obstacles.blocked(layout.works.fold.xMin, (layout.works.fold.zMin + layout.works.fold.zMax) / 2, 0.3)).toBe(true);
  });

  it('a flock folded at the hut is safe overnight with the shepherd beside them', () => {
    const night = (atHut: boolean) => {
      const sim = newSim();
      sim.startDay(2);
      sim.buildNow('hut');
      sim.dog.bond = 60;
      const f = layout.works.fold;
      placeFlock(sim, (f.xMin + f.xMax) / 2, (f.zMin + f.zMax) / 2, 1.4);
      expect(sim.flock.sheep.every((s) => insideFold(s.x, s.z))).toBe(true);
      const d = sim.works.hutDoor;
      if (atHut) sim.teleport(d.x, d.z);
      else sim.teleport(sim.doorPos.x, sim.doorPos.z);
      while (!sim.tasks.finished) sim.tasks.skip();
      expect(sim.sleep()).toBe(true);
      return sim.nightReport(2)!;
    };
    const hut = night(true);
    expect(hut.sleptAt).toBe('hut');
    expect(hut.exposed).toBe(0);
    expect(hut.taken + hut.scattered).toBe(0);
    expect(hut.reason).toMatch(/folded at the hut/);
    const away = night(false);
    expect(away.exposed).toBe(away.penned + away.exposed);
  });

  it('the cistern at dry Pasture C collects rain each night, and sheep drink from it', () => {
    const sim = newSim();
    sim.startDay(2);
    sim.buildNow('cistern');
    const cistern = sim.water.points.find((p) => p.capacity !== undefined)!;
    expect(cistern.liters).toBe(0);
    while (!sim.tasks.finished) sim.tasks.skip();
    sim.sleep();
    expect(cistern.liters).toBe(config.works.cisternRain);

    sim.tasks.enabled = false;
    placeFlock(sim, cistern.x + 6, cistern.z);
    sim.teleport(cistern.x + 14, cistern.z);
    for (const s of sim.flock.sheep) s.thirst = 70;
    run(sim, 60 * 40);
    expect(sim.flock.sheep.some((s) => s.lastDrinkFrom === cistern.id)).toBe(true);
    expect(cistern.liters!).toBeLessThan(config.works.cisternRain);
  });

  it('cairns are stacked by holding B, never crowded together', () => {
    const sim = quietSim();
    sim.teleport(-20, 100);
    run(sim, 60 * config.works.cairnSeconds + 2, () => frame({ cairn: true }));
    expect(sim.works.cairns.length).toBe(1);
    run(sim, 60 * config.works.cairnSeconds + 2, () => frame({ cairn: true }));
    expect(sim.works.cairns.length).toBe(1);
  });
});

describe('first arrivals', () => {
  it('each place is announced once, the first time you get there', () => {
    const sim = quietSim();
    const got: string[] = [];
    sim.events.on('arrival', (e) => got.push(e.place));
    placeFlock(sim, 90, 20);
    run(sim, 2);
    placeFlock(sim, 90, 22);
    run(sim, 2);
    sim.teleport(layout.hill.x, layout.hill.z);
    run(sim, 2);
    expect(got).toEqual(['B', 'hilltop']);
  });
});

describe('injuries, not game over', () => {
  it('Karabaş can be bitten driving off a wolf; he limps until salved', () => {
    const sim = quietSim();
    sim.dog.x = sim.dog.px = 0;
    sim.dog.z = sim.dog.pz = 100;
    placeFlock(sim, 0, 110);
    let hurt = 0;
    sim.events.on('dogHurt', () => hurt++);
    const w = sim.spawnWolf(0, 96);
    for (let i = 0; i < 60 * 30 && !hurt; i++) {
      // Keep the wolf in his face with its nerve up.
      w.morale = 100;
      w.x = w.px = sim.dog.x + 1;
      w.z = w.pz = sim.dog.z - 0.5;
      sim.step(frame());
    }
    expect(hurt).toBe(1);
    expect(sim.dog.wound).toBe(100);

    sim.teleport(sim.dog.x + 1.5, sim.dog.z);
    sim.dog.x = sim.dog.px = sim.player.pos.x - 1.5;
    run(sim, 1, () => frame({ item: 0 }));
    expect(sim.dog.wound).toBe(0);
  });

  it('exposed sheep may come home bitten rather than be taken', () => {
    const sim = newSim();
    sim.startDay(2);
    sim.setGate(true);
    sim.dog.bond = 100;
    while (!sim.tasks.finished) sim.tasks.skip();
    sim.sleep();
    const r = sim.nightReport(2)!;
    expect(r.wounded).toBeGreaterThan(0);
    expect(sim.flock.sheep.some((s) => s.condition < config.condition.start)).toBe(true);
  });
});

describe('Day 4: the far pasture', () => {
  it('starts with packing the satchel at home', () => {
    const sim = newSim();
    sim.startDay(4);
    run(sim, 2);
    expect(sim.tasks.task?.id).toBe('pack');
    sim.teleport(sim.doorPos.x, sim.doorPos.z);
    run(sim, 1, () => frame({ pack: ['salt', 'cay', 'rope'] }));
    run(sim, 2);
    expect(sim.tasks.task?.id).toBe('toB');
  });

  it('packing asks for exactly the salt lick and the çay kit, and says which is missing', () => {
    const sim = newSim();
    sim.startDay(4);
    sim.teleport(sim.doorPos.x, sim.doorPos.z);
    run(sim, 1, () => frame({ pack: ['salt', 'salve', 'rope'] }));
    run(sim, 2);
    expect(sim.tasks.task?.id).toBe('pack');
    expect(sim.tasks.current.progress).toContain('still to pack: çay kit');
    // Any third pocket will do once both are in.
    run(sim, 1, () => frame({ pack: ['bread', 'cay', 'salt'] }));
    run(sim, 2);
    expect(sim.tasks.task?.id).toBe('toB');
  });
});

describe('a free day: see to Karabaş', () => {
  it('does not wait on water he is not thirsty enough to go and drink', () => {
    const sim = newSim();
    sim.startDay(5);
    const dog = sim.tasks.tasks.findIndex((t) => t.id === 'dog');
    while (sim.tasks.index < dog) sim.tasks.skip();
    const care = sim.dog.care;
    care.satiety = 90;
    care.ticks = 0;
    care.pettedToday = true;
    // Between "goes to drink" (45) and the old 50 threshold he never drinks by himself.
    care.hydration = config.dogCare.seekWater + 2;
    run(sim, 2);
    expect(sim.tasks.task?.id).not.toBe('dog');
  });
});

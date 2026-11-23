// One-click setups for the M3 acceptance checks, so a tester can try exactly what the
// automated tests measure. Each scenario reports a live metric for the overlay.

import { config } from '../core/config';
import { rng } from '../world/noise';
import { activeMap } from '../world/map';
import type { Sim } from '../sim';

export type ScenarioName = 'none' | 'gather' | 'hold' | 'search' | 'wolf';


function place(sim: Sim, x: number, z: number) {
  const d = sim.dog;
  d.x = d.px = x;
  d.z = d.pz = z;
  d.y = d.py = sim.terrain.heightAt(x, z);
  d.vx = d.vz = 0;
  d.command = null;
  d.pending = null;
}

function putSheep(sim: Sim, i: number, x: number, z: number) {
  const s = sim.flock.sheep[i];
  s.x = s.px = x;
  s.z = s.pz = z;
  s.y = s.py = sim.terrain.heightAt(x, z);
  s.vx = s.vz = 0;
  s.inPen = false;
  s.stress = 0;
}

export class Scenarios {
  name: ScenarioName = 'none';
  private t = 0;
  private done = -1;
  private hold = { x: 0, z: 0 };
  private worstHold = 1;
  private shepherd = { x: 0, z: 0 };

  constructor(private sim: Sim) {}

  /** Flock scattered over 25 m of meadow; you stand 28 m south. Whistle Topla (Gather). */
  gather(seed = Math.floor(Math.random() * 1000)): void {
    const sim = this.sim;
    sim.reset();
    const r = rng(seed);
    sim.flock.sheep.forEach((_, i) => {
      for (let k = 0; k < 50; k++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * 25;
        const x = activeMap().scenario.meadow.x + Math.cos(a) * d;
        const z = activeMap().scenario.meadow.z + Math.sin(a) * d;
        if (sim.obstacles.blocked(x, z, 0.6) || sim.terrain.slopeDegAt(x, z) > 20) continue;
        putSheep(sim, i, x, z);
        break;
      }
    });
    this.shepherd = { x: activeMap().scenario.meadow.x, z: activeMap().scenario.meadow.z + 28 };
    sim.teleport(this.shepherd.x, this.shepherd.z);
    place(sim, this.shepherd.x + 2, this.shepherd.z);
    this.start('gather');
  }

  /** Flock grouped on the meadow, dog beside it. Whistle Bekle (Hold), then walk 100 m away. */
  holdTest(): void {
    const sim = this.sim;
    sim.reset();
    sim.flock.sheep.forEach((_, i) => putSheep(sim, i, activeMap().scenario.meadow.x + ((i % 6) - 2.5) * 1.8, activeMap().scenario.meadow.z + (Math.floor(i / 6) - 1.5) * 1.8));
    sim.teleport(activeMap().scenario.meadow.x, activeMap().scenario.meadow.z + 10);
    place(sim, activeMap().scenario.meadow.x + 3, activeMap().scenario.meadow.z + 8);
    this.start('hold');
  }

  /** One sheep lost (the test map's ravine floor, the valley's dere); flock some way off. Whistle Ara (Search). */
  search(): void {
    const sim = this.sim;
    sim.reset();
    const home = activeMap().scenario.lostFlock;
    sim.flock.sheep.forEach((_, i) => putSheep(sim, i, home.x + ((i % 6) - 2.5) * 1.8, home.z + (Math.floor(i / 6) - 1.5) * 1.8));
    const lost = activeMap().scenario.lost;
    const s = sim.flock.sheep.find((x) => !x.isLeader)!;
    putSheep(sim, s.id, lost.x, lost.z);
    s.isStray = true;
    sim.teleport(home.x + 6, home.z + 6);
    place(sim, home.x + 8, home.z + 6);
    this.start('search');
  }

  /** A wolf comes out of the forest toward the flock. Watch the dog, or whistle Saldır. */
  wolf(): void {
    this.sim.spawnWolf();
    this.start('wolf');
  }

  private start(name: ScenarioName): void {
    this.sim.tasks.enabled = false; // a test setup replaces the day's tasks
    this.name = name;
    this.t = 0;
    this.done = -1;
    this.worstHold = 1;
  }

  stop(): void {
    this.name = 'none';
  }

  afterStep(dt: number): void {
    if (this.name === 'none') return;
    this.t += dt;
    const sim = this.sim;
    const n = sim.flock.sheep.length;
    if (this.name === 'gather' && this.done < 0) {
      const p = sim.player.pos;
      const near = sim.flock.sheep.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < config.dog.gather.doneRadius).length;
      if (near >= Math.ceil(n * 0.9)) this.done = this.t;
    }
    if (this.name === 'hold' && sim.dog.command === 'hold') {
      this.hold = { x: sim.dog.holdX, z: sim.dog.holdZ };
      const inside = sim.flock.sheep.filter((s) => Math.hypot(s.x - this.hold.x, s.z - this.hold.z) < config.dog.hold.radius).length;
      this.worstHold = Math.min(this.worstHold, inside / n);
    }
    if (this.name === 'search' && this.done < 0 && sim.dog.searchFoundAt > 0) this.done = this.t;
  }

  get status(): string {
    const t = this.t.toFixed(0);
    const sim = this.sim;
    switch (this.name) {
      case 'none':
        return '';
      case 'gather':
        return this.done > 0
          ? `Gather: 90% with you after ${this.done.toFixed(1)} s (target < 30 s) ${this.done < 30 ? 'PASS' : 'over'}`
          : `Gather: ${t} s — whistle Topla (hold Q, flick up)`;
      case 'hold': {
        const away = Math.hypot(sim.player.pos.x - this.hold.x, sim.player.pos.z - this.hold.z);
        return sim.dog.command === 'hold'
          ? `Hold: worst ${(this.worstHold * 100).toFixed(0)}% within 20 m · you are ${away.toFixed(0)} m away · ${t} s (target 3 min)`
          : `Hold: whistle Bekle (hold Q, flick right), then walk 100 m away`;
      }
      case 'search':
        return this.done > 0
          ? `Search: stray found after ${this.done.toFixed(1)} s (target < 60 s) ${this.done < 60 ? 'PASS' : 'over'}`
          : `Search: ${t} s — whistle Ara (hold Q, flick down-right) toward ${activeMap().scenario.lostWhere}`;
      case 'wolf':
        return `Wolf: ${sim.wolves.list.length ? sim.wolves.list.map((w) => w.state).join(', ') : 'gone'} · bites ${sim.wolves.bites} · dog ${sim.dog.active}/${sim.dog.state}`;
    }
  }
}

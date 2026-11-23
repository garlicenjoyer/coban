import { DAWN_HOUR, SUNSET_HOUR } from '../core/config';
import type { EventBus, LifeSound, Vec3Like } from '../core/events';
import type { MapDef, V2 } from '../world/mapTypes';
import { rng } from '../world/noise';
import type { Obstacles } from '../world/obstacles';
import { Surface, type Terrain } from '../world/terrain';
import type { Gait } from '../player/controller';
import { angleDelta } from './residents';

export type Species = 'swallow' | 'hoopoe' | 'hare' | 'fox';
type State = 'forage' | 'alert' | 'flee' | 'flight' | 'land';

export const wildlifeNames: Record<Species, string> = {
  swallow: 'Barn swallow',
  hoopoe: 'Hoopoe',
  hare: 'Brown hare',
  fox: 'Red fox',
};

interface Context {
  player: Vec3Like;
  gait: Gait;
  dog: V2;
  dogRunning: boolean;
  bike: V2;
  bikeRunning: boolean;
  honking: boolean;
  hour: number;
}

interface Habitat {
  species: Species;
  home: V2;
  radius: number;
  phase?: number;
}

const TAU = Math.PI * 2;
const range = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);

export class Animal {
  readonly species: Species;
  readonly home: V2;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  yaw: number;
  previousYaw: number;
  bank = 0;
  speed = 0;
  age = 0;
  travel = 0;
  state: State;
  visible: boolean;
  private target: V2;
  private change = 0;
  private alarm = 0;
  private air = 0;
  private callIn: number;
  private phase: number;
  private readonly rand: () => number;

  constructor(habitat: Habitat, seed: number, private terrain: Terrain,
    private clear: (x: number, z: number) => boolean, private events: EventBus) {
    this.rand = rng(seed);
    this.species = habitat.species;
    this.home = habitat.home;
    this.phase = habitat.phase ?? this.rand() * TAU;
    this.radius = habitat.radius;
    this.target = this.home;
    this.callIn = 2 + this.rand() * 4;
    this.state = this.species === 'swallow' ? 'flight' : 'forage';
    this.visible = this.species !== 'fox';
    this.x = this.px = this.home.x;
    this.z = this.pz = this.home.z;
    this.yaw = this.previousYaw = this.rand() * TAU;
    if (this.species === 'swallow') this.circle(0);
    this.y = this.py = this.terrain.heightAt(this.x, this.z) + this.air;
    this.px = this.x;
    this.pz = this.z;
    this.previousYaw = this.yaw;
  }

  private readonly radius: number;

  get airborne(): boolean {
    return this.species === 'swallow' || this.state === 'flight' || this.state === 'land';
  }

  observe(player: Vec3Like): boolean {
    const d = range(this, player);
    return this.visible && d < (this.species === 'fox' ? 18 : this.airborne ? 20 : 11)
      && Math.abs(this.y - player.y) < (this.airborne ? 13 : 3.2)
      && (this.airborne || [0.25, 0.5, 0.75].every((t) =>
        this.clear(this.x + (player.x - this.x) * t, this.z + (player.z - this.z) * t)));
  }

  describe(): string {
    if (this.state === 'flee') return this.species === 'hare' ? 'It bounds away in long leaps.' : 'It slips away low through the scrub.';
    if (this.species === 'swallow') return 'It banks after insects, then glides on swept wings.';
    if (this.species === 'hoopoe') {
      if (this.airborne) return 'Black-and-cream bars flash across its wings as it flies.';
      return this.state === 'alert' ? 'Its crest fans open as it listens.' : 'It probes the earth with the tip of its curved bill.';
    }
    if (this.species === 'hare') return 'It holds still with its ears turned toward the slightest sound.';
    return this.state === 'alert' ? 'It freezes, ears pricked and tail low.' : 'Nose down, it threads between the clumps of scrub.';
  }

  private sound(kind: LifeSound, ctx: Context): void {
    if (range(this, ctx.player) < 60) this.events.emit('lifeSound', { kind, x: this.x, y: this.y + 0.25, z: this.z });
  }

  private circle(dt: number): void {
    this.phase += dt * 0.32;
    const a = this.phase, r = this.radius;
    this.x = this.home.x + Math.cos(a) * r;
    this.z = this.home.z + Math.sin(a) * r * 0.73;
    this.yaw = Math.atan2(-Math.sin(a), 0.73 * Math.cos(a));
    this.air = 7 + Math.sin(a * 3) * 2;
    this.bank = -0.32 + Math.sin(a * 2) * 0.14;
    this.speed = r * 0.32;
  }

  private chooseGround(away?: V2): V2 {
    const retreat = away && Math.atan2(this.x - away.x, this.z - away.z);
    for (let i = 0; i < 12; i++) {
      const a = retreat === undefined ? this.rand() * TAU : retreat + (this.rand() - 0.5) * (i < 7 ? 1.8 : TAU);
      const r = away ? 8 + this.rand() * 11 : 4 + this.rand() * this.radius;
      const start = away ? this : this.home;
      const p = { x: start.x + Math.sin(a) * r, z: start.z + Math.cos(a) * r };
      if (range(p, this.home) > this.radius * 2.5 || !this.clear(p.x, p.z)) continue;
      if ([0.25, 0.5, 0.75].every((t) => this.clear(this.x + (p.x - this.x) * t, this.z + (p.z - this.z) * t))) return p;
    }
    return { x: this.x, z: this.z };
  }

  private go(dt: number, pace: number): void {
    const d = range(this, this.target);
    const step = Math.min(d, pace * dt);
    this.speed = 0;
    if (step < 1e-5) return;
    const dx = this.target.x - this.x, dz = this.target.z - this.z;
    const x = this.x + dx * step / d, z = this.z + dz * step / d;
    if (!this.airborne && !this.clear(x, z)) {
      this.change = 0;
      return;
    }
    const turn = angleDelta(this.yaw, Math.atan2(dx, dz));
    this.yaw += turn * Math.min(1, dt * 8);
    this.bank += (Math.max(-0.36, Math.min(0.36, -turn)) - this.bank) * Math.min(1, dt * 5);
    this.x = x;
    this.z = z;
    this.speed = step / dt;
    this.travel += step;
  }

  private bird(dt: number, ctx: Context, danger: V2 | undefined, wary: boolean): void {
    if (this.species === 'swallow') {
      this.circle(dt * (danger ? 1.16 : 1));
      return;
    }
    if (danger && !this.airborne) {
      this.alarm = 4 + this.rand() * 2;
      this.state = 'flight';
      this.sound('wings', ctx);
      const a = Math.atan2(this.x - danger.x, this.z - danger.z) + (this.rand() - 0.5) * 0.9;
      this.target = { x: this.x + Math.sin(a) * 22, z: this.z + Math.cos(a) * 22 };
    }
    if (this.airborne) {
      this.alarm = Math.max(0, this.alarm - dt);
      if (this.state === 'flight' && this.alarm === 0) {
        this.state = 'land';
        this.target = this.chooseGround();
        if (!this.clear(this.target.x, this.target.z)) this.target = this.home;
      }
      if (this.state === 'land' && danger && range(this, danger) < 8) {
        this.state = 'flight';
        this.alarm = 3;
        const a = Math.atan2(this.x - danger.x, this.z - danger.z);
        this.target = { x: this.x + Math.sin(a) * 18, z: this.z + Math.cos(a) * 18 };
      }
      const arriving = this.state === 'land';
      this.go(dt, arriving ? 4.5 : 7.4);
      const lift = arriving ? Math.min(8, range(this, this.target) * 0.65) : 8;
      this.air += Math.max(-3.8 * dt, Math.min(5.4 * dt, lift - this.air));
      if (arriving && this.air < 0.03 && range(this, this.target) < 0.2) {
        this.state = 'forage';
        this.change = 1;
        this.air = 0;
      }
      return;
    }
    this.ground(dt, ctx, undefined, wary);
  }

  private ground(dt: number, ctx: Context, danger: V2 | undefined, wary: boolean): void {
    if (danger) {
      if (this.state !== 'flee') {
        this.sound('rustle', ctx);
        this.target = this.chooseGround(danger);
        this.change = 0.35;
      } else if (this.change <= 0 && range(this, this.target) < 0.6) {
        this.target = this.chooseGround(danger);
        this.change = 0.35;
      }
      this.state = 'flee';
      this.alarm = 1.4;
    } else this.alarm = Math.max(0, this.alarm - dt);
    if (this.alarm > 0) {
      this.change -= dt;
      this.go(dt, this.species === 'hare' ? 6.2 : 5.5);
      return;
    }
    const previous = this.state;
    this.state = wary ? 'alert' : 'forage';
    if (wary) {
      this.yaw += angleDelta(this.yaw, Math.atan2(ctx.player.x - this.x, ctx.player.z - this.z)) * Math.min(1, dt * 4);
      this.speed = 0;
      return;
    }
    if (previous !== 'forage' || this.change <= 0) {
      this.change = 3 + this.rand() * 7;
      this.target = this.chooseGround();
    }
    this.go(dt, this.species === 'hoopoe' ? 0.68 : this.species === 'fox' ? 1.4 : 0.8);
    this.change -= dt;
  }

  step(dt: number, ctx: Context): void {
    this.visible = this.species === 'fox' ? ctx.hour < 7.5 || ctx.hour > 17.5 : ctx.hour >= DAWN_HOUR && ctx.hour < SUNSET_HOUR + 0.6;
    if (!this.visible) return;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.previousYaw = this.yaw;
    this.age += dt;
    this.callIn -= dt;
    const d = range(this, ctx.player);
    const alertDistance = this.species === 'fox' ? 19 : 13;
    const approach = ctx.gait === 'sneak' || ctx.gait === 'idle' ? 1.8 : ctx.gait === 'sprint' ? alertDistance : alertDistance * 0.52;
    const danger = ctx.bikeRunning && range(this, ctx.bike) < (ctx.honking ? 28 : 13) ? ctx.bike
      : ctx.dogRunning && range(this, ctx.dog) < 10 ? ctx.dog
      : d < approach ? ctx.player : undefined;
    if (this.species === 'swallow' || this.species === 'hoopoe') this.bird(dt, ctx, danger, d < alertDistance);
    else this.ground(dt, ctx, danger, d < alertDistance);
    this.y = this.terrain.heightAt(this.x, this.z) + this.air;

    if (this.callIn <= 0) {
      this.callIn = this.species === 'fox' ? 38 + this.rand() * 40 : 8 + this.rand() * 15;
      if (this.species !== 'hare' && this.state !== 'flee' && this.state !== 'alert') this.sound(this.species, ctx);
    }
  }
}

export class Wildlife {
  readonly animals: Animal[];

  constructor(map: MapDef, terrain: Terrain, obstacles: Obstacles, events: EventBus) {
    const { layout } = map;
    const { pen, spawn, village, springs, pastures, house, ruins, hill, bounds } = layout;
    const rand = rng(47391);
    const clear = (x: number, z: number) => {
      if (Math.abs(x) >= bounds.walk || Math.abs(z) >= bounds.walk) return false;
      if (Math.abs(x - pen.x) < pen.hx + 2 && Math.abs(z - pen.z) < pen.hz + 2) return false;
      if (obstacles.blocked(x, z, 0.42) || terrain.slopeDegAt(x, z) > 26) return false;
      const surface = terrain.surfaceAt(x, z);
      return surface !== Surface.Mud;
    };
    const habitats: Habitat[] = [];
    for (const center of [ { x: spawn.x + 4, z: spawn.z - 16 }, springs[0], springs[1], village ?? hill ]) {
      for (let i = 0; i < 4; i++) {
        habitats.push({ species: 'swallow', home: center, radius: 21 + i * 0.75, phase: i * 0.30 + rand() * 0.11 });
      }
    }
    const groundHome = (species: Species, center: V2, radius: number) => {
      for (let i = 0; i < 40; i++) {
        const a = rand() * TAU;
        const r = 4 + rand() * radius;
        const x = center.x + Math.sin(a) * r, z = center.z + Math.cos(a) * r;
        if (!clear(x, z) || map.roadDistance(x, z) < 2.5 || habitats.some((h) => h.species !== 'swallow' && range(h.home, { x, z }) < 7)) continue;
        habitats.push({ species, home: { x, z }, radius });
        return;
      }
    };
    for (const center of [spawn, house, ...pastures, village ?? hill]) groundHome('hoopoe', center, 14);
    for (const center of [spawn, ...pastures, ruins, hill]) groundHome('hare', center, 19);
    for (const center of [house, pastures[1], ruins, hill]) groundHome('fox', center, 21);
    this.animals = habitats.map((h, i) => new Animal(h, 3127 + i * 731, terrain, clear, events));
  }

  step(dt: number, ctx: Context): void {
    for (const animal of this.animals) animal.step(dt, ctx);
  }

  near(player: Vec3Like): Animal | undefined {
    let closest: Animal | undefined;
    let best = Infinity;
    for (const animal of this.animals) {
      const d = Math.hypot(animal.x - player.x, (animal.y - player.y) * 1.45, animal.z - player.z);
      if (d < best && animal.observe(player)) {
        best = d;
        closest = animal;
      }
    }
    return closest;
  }
}

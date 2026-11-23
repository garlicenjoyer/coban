import type { EventBus, Vec3Like } from '../core/events';
import type { ResidentId, ResidentStop, ValleyRoute, V2 } from '../world/mapTypes';
import type { Obstacles } from '../world/obstacles';
import type { Terrain } from '../world/terrain';

const profiles = {
  emre: { name: 'Emre', model: 'Rust Tractor', pace: 4.1 },
  zeynep: { name: 'Zeynep', model: 'Blue Tractor', pace: 3.8 },
  ayse: { name: 'Ayşe', model: 'Ayse', pace: 1.25 },
  hasan: { name: 'Hasan', model: 'Hasan', pace: 1.36 },
} as const;

export type { ResidentId } from '../world/mapTypes';
export const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const between = (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const distance = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);

class Circuit {
  readonly points: V2[];
  readonly length: number;
  private readonly lengths = [0];

  constructor(points: V2[]) {
    // Two rounds of corner cutting give the tractors room to steer through the bends.
    for (let i = 0; i < 2; i++) {
      const loop = points;
      points = loop.flatMap((a, j) => {
        const b = loop[(j + 1) % loop.length];
        return [between(a, b, 0.25), between(a, b, 0.75)];
      });
    }
    this.points = points;
    for (let i = 0; i < points.length; i++) {
      this.lengths.push(this.lengths[i] + distance(points[i], points[(i + 1) % points.length]));
    }
    this.length = this.lengths[points.length];
  }

  at(s: number): V2 {
    s = ((s % this.length) + this.length) % this.length;
    let lo = 0;
    let hi = this.points.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.lengths[mid] <= s) lo = mid;
      else hi = mid;
    }
    return between(this.points[lo], this.points[hi % this.points.length], (s - this.lengths[lo]) / (this.lengths[hi] - this.lengths[lo]));
  }

  headingAt(s: number): number {
    const a = this.at(s - 0.75), b = this.at(s + 0.75);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** The smoothed point just before an authored corner. */
  atStop(point: number): number {
    return this.lengths[Math.max(0, point * 4 - 1)];
  }
}

interface Context {
  player: Vec3Like;
  rider: boolean;
  playerSpeed: number;
  dog: V2;
  bike: V2;
  sheep: readonly V2[];
  hour: number;
  honking: boolean;
}

interface Greeting {
  day: number;
  hour: number;
  flockExposed: boolean;
  gateOpen: boolean;
}

export class Resident {
  readonly profile;
  readonly tractor: boolean;
  readonly id: ResidentId;
  readonly circuit: Circuit;
  readonly clearance: number;
  readonly stops: readonly ResidentStop[];
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  yaw: number;
  previousYaw: number;
  pitch = 0;
  roll = 0;
  speed = 0;
  travel = 0;
  glance = 0;
  wave = 0;
  yielding = false;
  parked = false;
  settled = true;
  destination: ResidentStop;
  private offset = 0;
  private shoulder = 0;
  private progress = 0;
  private talk = 0;
  private waveReady = true;
  private lastDay = -1;
  private greetings = 0;

  constructor(route: ValleyRoute, private terrain: Terrain, private obstacles: Obstacles) {
    this.id = route.resident;
    this.profile = profiles[this.id];
    this.tractor = this.profile.pace > 2;
    this.clearance = this.tractor ? 1.1 : 0.48;
    this.circuit = new Circuit(route.points);
    this.stops = route.stops;
    this.destination = this.stops[0];
    const { x, z } = this.circuit.at(0);
    this.x = this.px = x;
    this.z = this.pz = z;
    this.y = this.py = terrain.heightAt(x, z);
    this.yaw = this.previousYaw = this.circuit.headingAt(0);
    this.parked = this.tractor;
  }

  stopAt(hour: number): ResidentStop {
    for (let i = this.stops.length - 1; i > 0; i--) if (this.stops[i].hour <= hour) return this.stops[i];
    return this.stops[0];
  }

  /** Place residents at their scheduled stop after sleeping or loading a save. */
  setTime(hour: number): void {
    this.destination = this.stopAt(hour);
    this.progress = this.circuit.atStop(this.destination.point);
    const { x, z } = this.circuit.at(this.progress);
    this.x = this.px = x;
    this.z = this.pz = z;
    this.y = this.py = this.terrain.heightAt(x, z);
    this.yaw = this.previousYaw = this.circuit.headingAt(this.progress);
    this.offset = this.shoulder = this.speed = this.wave = this.glance = this.talk = 0;
    this.yielding = false;
    this.waveReady = true;
    this.settled = true;
    this.parked = this.tractor;
  }

  get speaking(): boolean { return this.talk > 0; }

  private clear(x: number, z: number): boolean {
    return !this.obstacles.blocked(x, z, this.clearance);
  }

  private visibleTo(player: Vec3Like): boolean {
    const d = distance(this, player);
    return d < 0.8 || [0.25, 0.5, 0.75].every((t) => {
      const p = between(this, player, t);
      return !this.obstacles.blocked(p.x, p.z, 0.12);
    });
  }

  canTalk(player: Vec3Like): boolean {
    return this.talk <= 0 && this.speed < (this.tractor ? 0.65 : 1.5)
      && distance(this, player) < (this.tractor ? 3.8 : 3)
      && Math.abs(this.y - player.y) < 1.8 && this.visibleTo(player);
  }

  action(day: number): string {
    return this.lastDay === day && this.greetings === 1 ? 'ask for local advice' : `greet ${this.profile.name}`;
  }

  acknowledge(seconds: number): void {
    this.talk = seconds;
    this.wave = 1.5;
    this.waveReady = false;
  }

  greet(ctx: Greeting): string {
    if (this.lastDay !== ctx.day) this.greetings = 0;
    this.lastDay = ctx.day;
    const visit = this.greetings++;
    this.acknowledge(5.5);
    if (visit === 0) {
      if (ctx.hour >= 19 || ctx.hour < 6) return 'İyi akşamlar. I’m heading in soon. Mind yourself on the way home.';
      if (this.yielding && this.tractor) return 'Selam, çoban. I’ll give you and your flock a little room.';
      if (ctx.flockExposed) return 'Selam, çoban. I see you’ve got company today.';
      return `${ctx.hour < 11 ? 'Günaydın' : 'Selam'}, çoban. ${this.settled ? this.destination.activity : `I’m on my way to ${this.destination.place}.`}`;
    }
    if (visit > 1) return 'Good to see you again. Kolay gelsin, çoban.';
    if (ctx.hour >= 18 && ctx.gateOpen) return 'It’ll be dark soon. Remember to latch the ağıl gate once the sheep are inside.';
    return {
      emre: 'The dirt road climbs to the lookout. On the muddy side, I’d leave the bike and walk.',
      zeynep: 'If you’re bringing milk uphill, go to the dairy in the morning while it’s fresh.',
      ayse: 'Try the spring just north of the near pasture. The sheep can drink there.',
      hasan: 'The vet sets up in the square on Thursdays. Look for the parasol.',
    }[this.id];
  }

  step(dt: number, ctx: Context): void {
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.previousYaw = this.yaw;
    this.wave = Math.max(0, this.wave - dt);
    this.talk = Math.max(0, this.talk - dt);
    const stop = this.stopAt(ctx.hour);
    const goal = this.circuit.atStop(stop.point);
    const left = (goal - this.progress + this.circuit.length) % this.circuit.length;
    this.destination = stop;
    this.settled = left < 0.001;
    this.parked = this.tractor && this.settled;
    const playerDist = distance(this, ctx.player);
    if (playerDist > 13) this.waveReady = true;
    if (!this.tractor && this.waveReady && playerDist < 8 && !ctx.rider && ctx.playerSpeed < 3 && this.visibleTo(ctx.player)) {
      this.waveReady = false;
      this.wave = 1.5;
    }

    const heading = this.circuit.headingAt(this.progress);
    const base = this.circuit.at(this.progress);
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const ahead = (p: V2, reach: number, width: number) => {
      const dx = p.x - base.x, dz = p.z - base.z;
      const along = dx * fx + dz * fz;
      return along > -0.7 && along < reach && Math.abs(dx * fz - dz * fx) < width;
    };
    const playerNear = playerDist < 45;
    const wasYielding = this.yielding;
    // Keep a stopped tractor waiting while the same stretch of road is occupied.
    const traffic = this.tractor ? Math.max(wasYielding ? 9 : 5.5, 5.5 + this.speed * 1.5) : 2.1;
    const swept = this.tractor ? 2.65 : 1.05;
    const blocker = playerNear && ahead(ctx.player, ctx.rider ? traffic + 5 : traffic, swept) ? ctx.player
      : ahead(ctx.bike, traffic, swept) ? ctx.bike
      : ahead(ctx.dog, traffic - 1, swept) ? ctx.dog
      : this.tractor ? ctx.sheep.find((s) => ahead(s, traffic + 2, swept + 0.5)) : undefined;
    const horn = this.tractor && ctx.honking && playerDist < 24;
    if (horn && !wasYielding && this.waveReady) {
      this.wave = 1.5;
      this.waveReady = false;
    }
    this.yielding = !this.settled && (!!blocker || horn);

    if (this.yielding && !wasYielding) {
      const toward = blocker ?? ctx.player;
      const right = (toward.x - base.x) * fz - (toward.z - base.z) * fx;
      this.shoulder = (right > 0 ? -1 : 1) * (this.tractor ? 1.8 : 0.85);
      const bankX = base.x + fz * this.shoulder, bankZ = base.z - fx * this.shoulder;
      if (!this.clear(bankX, bankZ) || this.terrain.slopeDegAt(bankX, bankZ) > 20) this.shoulder = 0;
    }

    const corner = Math.abs(angleDelta(heading, this.circuit.headingAt(this.progress + 2.4)));
    const slowed = this.profile.pace / (1 + corner * 1.9);
    const next = this.circuit.at(this.progress + Math.min(left, Math.max(0.5, this.speed * 0.55)));
    const routeOpen = this.clear(next.x, next.z);
    const canGo = !this.settled && this.talk === 0 && routeOpen;
    const targetSpeed = canGo && !this.yielding ? Math.min(slowed, Math.sqrt(left * 4)) : 0;
    const rate = targetSpeed > this.speed ? 1.9 : 5.2;
    this.speed += Math.max(-rate * dt, Math.min(rate * dt, targetSpeed - this.speed));
    const safeAhead = !blocker || !ahead(blocker, this.tractor ? 2.4 : 0.8, swept);
    if (!safeAhead || !routeOpen || this.settled) this.speed = 0;
    const move = this.speed * dt;
    const arrived = move > 0 && left - move < 0.001;
    const newProgress = arrived ? goal : (this.progress + move) % this.circuit.length;
    const path = this.circuit.at(newProgress);
    const yaw = this.circuit.headingAt(newProgress);
    const wantedOffset = this.yielding ? this.shoulder : 0;
    // Pedestrians step aside even when stopped. Tractors ease over while still rolling.
    const sideSpeed = this.tractor ? Math.min(1.15, this.speed * 0.55) : 1.2;
    const sideDelta = Math.max(-sideSpeed * dt, Math.min(sideSpeed * dt, wantedOffset - this.offset));
    const offset = arrived ? 0 : this.offset + sideDelta;
    const x = path.x + Math.cos(yaw) * offset, z = path.z - Math.sin(yaw) * offset;
    if (this.clear(x, z) || Math.hypot(x - this.x, z - this.z) < 0.00001) {
      if (arrived) {
        this.settled = true;
        this.parked = this.tractor;
        this.speed = 0;
      }
      this.progress = newProgress;
      this.offset = offset;
      this.travel += Math.hypot(x - this.x, z - this.z);
      this.x = x;
      this.z = z;
    } else this.speed = 0;

    const towardPlayer = playerDist < 9 && !ctx.rider && (this.talk > 0 || this.wave > 0 || this.yielding);
    const facing = towardPlayer && !this.tractor ? Math.atan2(ctx.player.x - this.x, ctx.player.z - this.z) : yaw;
    this.yaw += angleDelta(this.yaw, facing) * Math.min(1, dt * 6);
    const glance = towardPlayer ? Math.max(-1.15, Math.min(1.15, angleDelta(this.yaw, Math.atan2(ctx.player.x - this.x, ctx.player.z - this.z)))) : 0;
    this.glance += (glance - this.glance) * Math.min(1, dt * 7);
    this.y = this.terrain.heightAt(this.x, this.z);
    if (this.tractor) {
      const sx = Math.sin(this.yaw), sz = Math.cos(this.yaw);
      this.pitch = Math.atan2(this.terrain.heightAt(this.x - sx, this.z - sz) - this.terrain.heightAt(this.x + sx, this.z + sz), 2);
      this.roll = Math.atan2(this.terrain.heightAt(this.x + sz * 0.7, this.z - sx * 0.7) - this.terrain.heightAt(this.x - sz * 0.7, this.z + sx * 0.7), 1.4);
    }
  }
}

export class Residents {
  readonly list: Resident[];

  constructor(routes: readonly ValleyRoute[], terrain: Terrain, obstacles: Obstacles, private events: EventBus) {
    this.list = routes.map((route) => new Resident(route, terrain, obstacles));
  }

  setTime(hour: number): void {
    for (const resident of this.list) resident.setTime(hour);
  }

  near(player: Vec3Like): Resident | undefined {
    let nearest: Resident | undefined;
    for (const resident of this.list) {
      if (resident.canTalk(player) && (!nearest || distance(resident, player) < distance(nearest, player))) nearest = resident;
    }
    return nearest;
  }

  step(dt: number, ctx: Context): void {
    for (const resident of this.list) {
      const foot = Math.floor(resident.travel / 0.57);
      resident.step(dt, ctx);
      if (!resident.tractor && Math.floor(resident.travel / 0.57) !== foot && distance(ctx.player, resident) < 16)
        this.events.emit('lifeSound', { kind: 'step', x: resident.x, y: resident.y, z: resident.z });
    }
  }

  greet(resident: Resident, ctx: Greeting): void {
    this.speak(resident, resident.greet(ctx));
  }

  speak(resident: Resident, text: string): void {
    this.events.emit('encounter', { name: resident.profile.name, text });
    this.events.emit('lifeSound', { kind: 'greet', x: resident.x, y: resident.y + (resident.tractor ? 2 : 1.5), z: resident.z });
  }
}

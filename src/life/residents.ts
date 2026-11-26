import { RoadVehicle, type VehicleKind, type VehicleParking } from './roadVehicle';
import type { EventBus, Vec3Like } from '../core/events';
import { config } from '../core/config';
import type { ResidentId, ResidentStop, ValleyRoute, V2 } from '../world/mapTypes';
import type { Obstacles } from '../world/obstacles';
import type { Terrain } from '../world/terrain';
import type { ResidentGesture } from './dialogue';
import { planResidentSpeech, type ResidentSpeech } from './residentSpeech';
import { workSounds, type WorkPose } from './residentWork';

const profiles = {
  deniz: { kind: 'car', name: 'Deniz', model: 'Terracotta Saloon', pace: 5.8, trade: 'Village mechanic' },
  suna: { kind: 'car', name: 'Suna', model: 'Seafoam Saloon', pace: 5.7, trade: 'School secretary' },
  murat: { kind: 'van', name: 'Murat', model: 'Bakery Van', pace: 5.5, trade: 'Baker' },
  leyla: { kind: 'van', name: 'Leyla', model: 'Market Van', pace: 5.6, trade: 'Greengrocer' },
  emre: { kind: 'tractor', name: 'Emre', model: 'Rust Tractor', pace: 4.1, trade: 'Terrace farmer' },
  zeynep: { kind: 'tractor', name: 'Zeynep', model: 'Blue Tractor', pace: 3.8, trade: 'Dairy driver' },
  ayse: { kind: undefined, name: 'Ayşe', model: 'Ayse', pace: 1.25, trade: 'Olive grower' },
  hasan: { kind: undefined, name: 'Hasan', model: 'Hasan', pace: 1.36, trade: 'Caretaker of the square' },
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

  nearest(p: V2): number {
    let best = Infinity, progress = 0;
    for (const [i, a] of this.points.entries()) {
      const b = this.points[(i + 1) % this.points.length], dx = b.x - a.x, dz = b.z - a.z;
      const span = this.lengths[i + 1] - this.lengths[i];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (span * span || 1)));
      const d = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
      if (d < best) { best = d; progress = this.lengths[i] + span * t; }
    }
    return progress % this.length;
  }

  headingAt(s: number): number {
    const a = this.at(s - 0.75), b = this.at(s + 0.75);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** The smoothed point just before an authored corner. */
  atStop(point: number): number {
    return this.lengths[Math.max(0, point * 4 - 1)];
  }

  forward(from: number, to: number): number {
    const arc = (to - from + this.length) % this.length;
    return arc > this.length - 0.001 ? 0 : arc;
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
  roadUsers?: readonly V2[];
}

interface Greeting {
  hour: number;
  flockExposed: boolean;
  gateOpen: boolean;
}

export class Resident {
  readonly profile;
  vehicle?: RoadVehicle;
  private trafficCar?: RoadVehicle;
  private recovering = false;
  down = false;
  dodging = false;
  readonly circulates: boolean;
  get driving(): boolean { return !!this.profile.kind && !this.vehicle; }
  get vehicleKind(): VehicleKind { return this.profile.kind!; }
  get clearance(): number { return this.driving ? 1.1 : 0.48; }

  /** While following a route the driver supplies the velocity. An impact transfers control to the chassis. */
  trafficChassis(): RoadVehicle {
    if (this.vehicle) return this.vehicle;
    const body = this.trafficCar ??= new RoadVehicle(this, this.terrain, this.obstacles, this.vehicleKind);
    if (!this.recovering) {
      body.x = this.x; body.y = this.y; body.z = this.z; body.yaw = this.yaw;
      body.px = this.px; body.py = this.py; body.pz = this.pz; body.previousYaw = this.previousYaw;
      body.speed = this.speed; body.spin = 0;
      body.pitch = this.pitch; body.roll = this.roll;
    }
    return body;
  }

  afterCollision(): void {
    const body = this.trafficCar!;
    this.recovering = true;
    this.x = body.x; this.z = body.z; this.y = body.y; this.yaw = body.yaw;
    this.pitch = body.pitch; this.roll = body.roll; this.speed = Math.abs(body.speed);
  }

  releaseVehicle(parking: VehicleParking = this): RoadVehicle {
    if (!this.vehicle) {
      this.vehicle = this.recovering && this.trafficCar && parking === this ? this.trafficCar
        : new RoadVehicle(parking, this.terrain, this.obstacles, this.vehicleKind);
      if (parking === this && !this.recovering) this.vehicle.speed = this.speed;
      this.trafficCar = undefined;
      this.recovering = false;
      const side = this.vehicle.beside();
      if (side && distance(this.vehicle, this) < 1.7) {
        this.offset = (side.x - this.x) * Math.cos(this.yaw) - (side.z - this.z) * Math.sin(this.yaw);
        this.x = this.px = side.x;
        this.z = this.pz = side.z;
        this.y = this.py = this.terrain.heightAt(side.x, side.z);
      }
      this.speed = 0;
      this.parked = false;
    }
    return this.vehicle;
  }
  readonly id: ResidentId;
  readonly circuit: Circuit;
  readonly stops: readonly ResidentStop[];
  readonly sortingStands = new Map<ResidentStop, V2 & { yaw: number }>();
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
  private waveReady = true;
  private approachReady = true;
  private approachWait = 0;
  private linger = 0;
  private excursion: 'out' | 'back' | null = null;
  conversation = false;
  lineAge = Infinity;
  speech?: ResidentSpeech;
  workTime = 0;
  gesture: ResidentGesture = 'greet';
  private lineDuration = 0;

  constructor(route: ValleyRoute, private terrain: Terrain, private obstacles: Obstacles) {
    this.id = route.resident;
    this.circulates = !!route.circulates;
    this.profile = profiles[this.id];
    this.circuit = new Circuit(route.points);
    this.stops = route.stops;
    // Keep the sorting tables along the shoulder so leaving a station never means walking through it.
    for (const stop of this.stops) {
      if (stop.pose !== 'sort') continue;
      const point = this.circuit.atStop(stop.point);
      const at = this.circuit.at(point);
      const heading = this.circuit.headingAt(point);
      const side = heading + Math.PI / 2;
      const dx = Math.sin(side) * 0.76, dz = Math.cos(side) * 0.76;
      const reverse = this.obstacles.blocked(at.x + dx, at.z + dz, 0.46);
      this.sortingStands.set(stop, reverse ? { x: at.x - dx, z: at.z - dz, yaw: side - Math.PI }
        : { x: at.x + dx, z: at.z + dz, yaw: side });
    }
    this.destination = this.stops[0];
    const { x, z } = this.circuit.at(0);
    this.x = this.px = x;
    this.z = this.pz = z;
    this.y = this.py = terrain.heightAt(x, z);
    this.yaw = this.previousYaw = this.circuit.headingAt(0);
    if (this.circulates) this.setTime(0);
    else this.parked = this.driving;
  }

  stopAt(hour: number): ResidentStop {
    for (let i = this.stops.length - 1; i > 0; i--) if (this.stops[i].hour <= hour) return this.stops[i];
    return this.stops[0];
  }

  /** Place residents at their scheduled stop after sleeping or loading a save. */
  setTime(hour: number): void {
    this.recovering = false;
    this.destination = this.stopAt(hour);
    this.progress = this.circuit.atStop(this.destination.point);
    const { x, z } = this.circuit.at(this.progress);
    this.x = this.px = x;
    this.z = this.pz = z;
    this.y = this.py = this.terrain.heightAt(x, z);
    this.yaw = this.previousYaw = this.sortingStands.get(this.destination)?.yaw ?? this.circuit.headingAt(this.progress);
    this.offset = this.shoulder = this.speed = this.wave = this.glance = 0;
    this.conversation = false;
    this.lineAge = Infinity;
    this.speech = undefined;
    this.workTime = 0;
    this.yielding = false;
    this.waveReady = true;
    this.approachReady = true;
    this.approachWait = this.linger = 0;
    this.excursion = null;
    this.settled = !(this.driving && this.circulates);
    this.parked = this.driving && this.settled;
  }

  get speaking(): boolean { return this.lineAge < this.lineDuration && this.gesture !== 'farewell'; }
  get gesturing(): boolean { return this.lineAge < this.lineDuration; }
  get workPose(): WorkPose | undefined {
    if (!this.dodging && this.settled && !this.conversation && !this.gesturing && this.wave === 0) return this.destination.pose;
  }

  private clear(x: number, z: number): boolean {
    return (!this.vehicle || Math.hypot(x - this.vehicle.x, z - this.vehicle.z) >= 1.4)
      && !this.obstacles.blocked(x, z, this.clearance);
  }

  private vergeOffset(path: V2, yaw: number): number {
    const side = this.offset < 0 ? -1 : 1;
    for (const offset of [2.65 * side, -2.65 * side]) {
      if (this.clear(path.x + Math.cos(yaw) * offset, path.z - Math.sin(yaw) * offset)) return offset;
    }
    return 0;
  }

  private visibleTo(player: Vec3Like): boolean {
    const d = distance(this, player);
    return d < 0.8 || [0.25, 0.5, 0.75].every((t) => {
      const p = between(this, player, t);
      return !this.obstacles.blocked(p.x, p.z, 0.12);
    });
  }

  canTalk(player: Vec3Like): boolean {
    return !this.down && !this.dodging && this.speed < (this.driving ? 0.65 : 1.5) && this.withinConversation(player, this.driving ? 3.8 : 3);
  }

  withinConversation(player: Vec3Like, reach = 5): boolean {
    return distance(this, player) < reach && Math.abs(this.y - player.y) < 1.8 && this.visibleTo(player);
  }

  perform(gesture: ResidentGesture, seconds: number, speech?: ResidentSpeech): void {
    this.gesture = gesture;
    this.lineDuration = seconds;
    this.speech = speech;
    this.lineAge = 0;
    this.wave = 0;
    this.waveReady = false;
  }

  routine(): string {
    if (this.circulates) return this.driving ? this.destination.activity : 'I’m walking back through the village.';
    if (this.excursion) return `I’m taking a short walk near ${this.destination.place}.`;
    return this.settled ? this.destination.activity : `I’m on my way to ${this.destination.place}.`;
  }

  greeting(ctx: Greeting): string {
    if (ctx.hour >= 19 || ctx.hour < 6) return 'İyi akşamlar, çoban. Mind yourself on the way home.';
    if (this.yielding && this.driving) return 'Selam, çoban. I’ll give you and your flock a little room.';
    if (ctx.flockExposed) return 'Selam, çoban. I see you’ve got company today.';
    return `${ctx.hour < 11 ? 'Günaydın' : 'Selam'}, çoban. ${this.routine()}`;
  }

  advice(ctx: Greeting): string {
    if (ctx.hour >= 18 && ctx.gateOpen) return 'It’ll be dark soon. Remember to latch the ağıl gate once the sheep are inside.';
    const advice: Partial<Record<ResidentId, string>> = {
      emre: 'The dirt road climbs to the lookout. On the muddy side, I’d leave the bike and walk.',
      zeynep: 'If you’re bringing milk uphill, go to the dairy in the morning while it’s fresh.',
      ayse: 'Try the spring just north of the near pasture. The sheep can drink there.',
      hasan: 'The vet sets up in the square on Thursdays. Look for the parasol.',
    };
    return advice[this.id] ?? 'Flag down a passing driver from the side of the lane.';
  }

  step(dt: number, ctx: Context): void {
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.previousYaw = this.yaw;
    if (this.down || this.dodging) return;
    if (this.recovering && this.trafficCar) {
      const body = this.trafficCar;
      body.step(dt);
      this.travel += Math.hypot(body.x - this.x, body.z - this.z);
      this.afterCollision();
      if (!body.moving) {
        this.progress = this.circuit.nearest(body);
        const base = this.circuit.at(this.progress), yaw = this.circuit.headingAt(this.progress);
        this.offset = (body.x - base.x) * Math.cos(yaw) - (body.z - base.z) * Math.sin(yaw);
        this.approachWait = 1.1;
        this.recovering = false;
      }
      return;
    }
    if (this.gesturing && (this.gesture === 'protest' || this.gesture === 'startle')) {
      this.lineAge += dt;
      this.speed = 0;
      const toward = Math.atan2(ctx.player.x - this.x, ctx.player.z - this.z);
      if (this.driving) this.glance = Math.max(-1.1, Math.min(1.1, angleDelta(this.yaw, toward)));
      else this.yaw += angleDelta(this.yaw, toward) * Math.min(1, dt * 6);
      return;
    }
    this.wave = Math.max(0, this.wave - dt);
    this.approachWait = Math.max(0, this.approachWait - dt);
    this.lineAge += dt;
    const stop = this.stopAt(ctx.hour);
    if (stop !== this.destination) {
      this.workTime = this.linger = 0;
      this.excursion = null;
    }
    this.destination = stop;
    const anchor = this.circuit.atStop(stop.point);
    const nextStop = this.stops[this.stops.indexOf(stop) + 1];
    const span = nextStop ? Math.min(13, this.circuit.forward(anchor, this.circuit.atStop(nextStop.point)) * 0.56) : 0;
    const atAnchor = this.circuit.forward(this.progress, anchor) < 0.001;
    if (!this.driving && stop.hour > 0 && nextStop && span > 3 && atAnchor && !this.excursion
      && !this.conversation && !this.gesturing && this.wave === 0) {
      this.linger += dt;
      const beforeDeparture = (nextStop.hour - ctx.hour) * config.time.secondsPerHour;
      if (this.linger > (this.id === 'hasan' ? 14 : 19) && beforeDeparture > span * 2 / this.profile.pace + 10) {
        this.excursion = 'out';
        this.linger = 0;
      }
    }
    const direction = this.excursion === 'back' ? -1 : 1;
    const circulating = this.driving && this.circulates;
    const goal = circulating ? (this.progress + 16) % this.circuit.length : this.excursion === 'out' ? (anchor + span) % this.circuit.length : anchor;
    const left = direction > 0 ? this.circuit.forward(this.progress, goal) : this.circuit.forward(goal, this.progress);
    this.settled = !circulating && atAnchor && !this.excursion;
    this.parked = this.driving && this.settled;
    const playerDist = distance(this, ctx.player);
    if (playerDist > 13) this.waveReady = true;
    if (playerDist > 11) this.approachReady = true;
    // Give a nearby shepherd one chance to flag down a passing driver on foot.
    if (this.driving && !this.settled && this.approachReady && !this.conversation && !ctx.rider && ctx.playerSpeed < 2.5
      && this.withinConversation(ctx.player, 6.3)) {
      this.approachReady = false;
      this.approachWait = 3.8;
    }
    if (!this.driving && this.waveReady && playerDist < 8 && !ctx.rider && ctx.playerSpeed < 3 && this.visibleTo(ctx.player)) {
      this.waveReady = false;
      this.wave = 1.5;
    }

    const turn = direction < 0 ? Math.PI : 0;
    const heading = this.circuit.headingAt(this.progress) + turn;
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
    const traffic = this.driving ? Math.max(wasYielding ? 9 : 5.5, 5.5 + this.speed * 1.5) : 2.1;
    const swept = this.driving ? 2.65 : 1.05;
    const leading = this.driving && ctx.roadUsers?.find(p => p !== this && ahead(p, 4.6 + this.speed * 0.7, 2.0));
    const blocker = leading || (playerNear && ahead(ctx.player, ctx.rider ? traffic + 5 : traffic, swept) ? ctx.player
      : ahead(ctx.bike, traffic, swept) ? ctx.bike
      : ahead(ctx.dog, traffic - 1, swept) ? ctx.dog
      : this.driving ? ctx.sheep.find((s) => ahead(s, traffic + 2, swept + 0.5)) : undefined);
    const horn = this.driving && ctx.honking && playerDist < 24;
    if (horn && !wasYielding && this.waveReady) {
      this.wave = 1.5;
      this.waveReady = false;
    }
    this.yielding = !this.settled && (!!blocker || horn);

    if (this.yielding && !wasYielding) {
      const toward = blocker ?? ctx.player;
      const right = (toward.x - base.x) * fz - (toward.z - base.z) * fx;
      this.shoulder = (right > 0 ? -1 : 1) * (this.driving ? 1.8 : 0.85);
      const bankX = base.x + fz * this.shoulder, bankZ = base.z - fx * this.shoulder;
      if (leading || !this.clear(bankX, bankZ) || this.terrain.slopeDegAt(bankX, bankZ) > 20) this.shoulder = 0;
    }

    const corner = Math.abs(angleDelta(heading, this.circuit.headingAt(this.progress + direction * 2.4) + turn));
    const slowed = (this.vehicle ? 1.35 : this.profile.pace) / (1 + corner * 1.9);
    const next = this.circuit.at(this.progress + direction * Math.min(left, Math.max(0.5, this.speed * 0.55)));
    const routeOpen = this.clear(next.x, next.z);
    const canGo = !this.settled && !this.conversation && routeOpen;
    const targetSpeed = canGo && !this.yielding && this.approachWait === 0 ? Math.min(slowed, Math.sqrt(left * 4)) : 0;
    const rate = targetSpeed > this.speed ? 1.9 : 5.2;
    this.speed += Math.max(-rate * dt, Math.min(rate * dt, targetSpeed - this.speed));
    const stopDistance = leading ? 4.35 : this.driving ? 2.4 : 0.8;
    const safeAhead = !blocker || !ahead(blocker, stopDistance, swept);
    if (!safeAhead || !routeOpen || this.settled) this.speed = 0;
    const move = this.speed * dt;
    const arrived = move > 0 && left - move < 0.001;
    const newProgress = arrived ? goal : move ? (this.progress + direction * move + this.circuit.length) % this.circuit.length : this.progress;
    const path = this.circuit.at(newProgress);
    const yaw = this.circuit.headingAt(newProgress) + turn;
    // Displaced drivers walk along the verge, leaving their former lane open for traffic.
    const onVerge = this.circulates && !!this.vehicle;
    const wantedOffset = onVerge ? this.vergeOffset(path, yaw) : this.yielding ? this.shoulder : 0;
    // Pedestrians step aside even when stopped. Tractors ease over while still rolling.
    const sideSpeed = this.driving ? Math.min(1.15, this.speed * 0.55) : 1.2;
    const sideDelta = Math.max(-sideSpeed * dt, Math.min(sideSpeed * dt, wantedOffset - this.offset));
    const offset = arrived && !onVerge ? 0 : this.offset + sideDelta;
    const x = path.x + Math.cos(yaw) * offset, z = path.z - Math.sin(yaw) * offset;
    if (this.clear(x, z) || Math.hypot(x - this.x, z - this.z) < 0.00001) {
      if (arrived) {
        this.excursion = this.excursion === 'out' ? 'back' : null;
        this.settled = !this.excursion;
        this.parked = this.driving && this.settled;
        this.speed = 0;
      }
      this.progress = newProgress;
      this.offset = offset;
      this.travel += Math.hypot(x - this.x, z - this.z);
      this.x = x;
      this.z = z;
    } else this.speed = 0;

    const towardPlayer = playerDist < 9 && !ctx.rider
      && (this.conversation || this.gesturing || this.wave > 0 || this.yielding || this.approachWait > 0);
    const stationYaw = this.settled ? this.sortingStands.get(stop)?.yaw : undefined;
    const facing = towardPlayer && !this.driving ? Math.atan2(ctx.player.x - this.x, ctx.player.z - this.z) : stationYaw ?? yaw;
    this.yaw += angleDelta(this.yaw, facing) * Math.min(1, dt * 6);
    const glance = towardPlayer ? Math.max(-1.15, Math.min(1.15, angleDelta(this.yaw, Math.atan2(ctx.player.x - this.x, ctx.player.z - this.z)))) : 0;
    this.glance += (glance - this.glance) * Math.min(1, dt * 7);
    this.y = this.terrain.heightAt(this.x, this.z);
    if (this.driving) {
      const sx = Math.sin(this.yaw), sz = Math.cos(this.yaw);
      this.pitch = Math.atan2(this.terrain.heightAt(this.x - sx, this.z - sz) - this.terrain.heightAt(this.x + sx, this.z + sz), 2);
      this.roll = Math.atan2(this.terrain.heightAt(this.x + sz * 0.7, this.z - sx * 0.7) - this.terrain.heightAt(this.x - sz * 0.7, this.z + sx * 0.7), 1.4);
    }
    if (this.workPose) this.workTime += dt;
  }
}

export function witnessesTheft(person: Vec3Like, at: Vec3Like, obstacles: Obstacles): boolean {
  return distance(person, at) <= 17 && Math.abs(person.y - at.y) <= 4 && obstacles.clearBetween(person, at);
}

export class Residents {
  readonly list: Resident[];

  constructor(routes: readonly ValleyRoute[], terrain: Terrain, private obstacles: Obstacles, private events: EventBus) {
    this.list = routes.map((route) => new Resident(route, terrain, obstacles));
  }

  reactToTheft(owner: Resident, vehicle: RoadVehicle): void {
    const text = owner.vehicleKind === 'van' ? 'Hey! Bring my van back!' : owner.vehicleKind === 'car' ? 'Hey! That’s my car!' : 'Get off my tractor!';
    for (const resident of this.list) {
      const isOwner = resident === owner;
      if (resident.down || (!isOwner && !witnessesTheft(resident, vehicle, this.obstacles))) continue;
      const cue = isOwner ? 'protest' : 'startle';
      const speech = planResidentSpeech(resident.id, isOwner ? text : 'Hey! Stop!', cue);
      resident.perform(cue, isOwner ? 4.2 : 2.6, speech);
      if (isOwner) this.events.emit('residentShout', { resident: resident.id, x: resident.x, y: resident.y + 1.5, z: resident.z, speech });
    }
    this.events.emit('vehicleTaken', { x: vehicle.x, y: vehicle.y, z: vehicle.z });
    this.events.emit('encounter', { name: owner.profile.name, text });
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
    const roadUsers: V2[] = [];
    for (const r of this.list) {
      roadUsers.push(r);
      if (r.vehicle) roadUsers.push(r.vehicle);
    }
    ctx = { ...ctx, roadUsers };
    for (const resident of this.list) {
      const foot = Math.floor(resident.travel / 0.57);
      const workTime = resident.workTime;
      resident.step(dt, ctx);
      const range = distance(ctx.player, resident);
      if (!resident.driving && Math.floor(resident.travel / 0.57) !== foot && range < 16)
        this.events.emit('lifeSound', { kind: 'step', x: resident.x, y: resident.y, z: resident.z });
      const pose = resident.workPose;
      if (pose && range < 32) {
        const station = resident.sortingStands.get(resident.destination);
        const forward = pose === 'check' ? 0.42 : 0.36;
        const lift = pose === 'sweep' ? 0.08 : pose === 'sort' ? 0.86 : 1.36;
        for (const kind of workSounds(resident.id, pose, workTime, resident.workTime)) {
          this.events.emit('workSound', { kind, x: station?.x ?? resident.x + Math.sin(resident.yaw) * forward,
            y: resident.y + lift, z: station?.z ?? resident.z + Math.cos(resident.yaw) * forward });
        }
      }
    }
  }
}

import type { GameAudio } from './audio';
import type { LifeSound, Vec3Like } from '../core/events';
import type { ResidentId, Residents } from '../life/residents';
import type { WorkSound } from '../life/residentWork';
import { playResidentFoley } from './residentFoley';

type AudioBus = NonNullable<ReturnType<GameAudio['context']>>;

export function position(pan: PannerNode, point: Vec3Like, lift = 0): void {
  pan.positionX.value = point.x;
  pan.positionY.value = point.y + lift;
  pan.positionZ.value = point.z;
}

export function spatial({ ctx, master }: AudioBus, point: Vec3Like, refDistance: number): PannerNode {
  const pan = ctx.createPanner();
  pan.panningModel = 'HRTF';
  pan.distanceModel = 'inverse';
  pan.refDistance = refDistance;
  position(pan, point);
  pan.connect(master);
  return pan;
}

type Note = [start: number, end: number, delay: number, length: number, volume: number];

const phrases: Partial<Record<LifeSound, readonly Note[]>> = {
  swallow: [[2970, 4140, 0, 0.062, 0.038], [4290, 3220, 0.105, 0.08, 0.04], [3400, 2250, 0.2, 0.12, 0.025]],
  hoopoe: [[525, 484, 0, 0.14, 0.14], [524, 475, 0.22, 0.14, 0.13], [503, 457, 0.44, 0.17, 0.10]],
  fox: [[834, 420, 0, 0.24, 0.09], [745, 295, 0.33, 0.30, 0.07]],
};

export class ValleyLifeAudio {
  private engines = new Map<ResidentId, {
    pan: PannerNode;
    level: GainNode;
    filter: BiquadFilterNode;
    crank: OscillatorNode;
    firing: OscillatorNode;
  }>();

  constructor(private audio: GameAudio) {}

  call(kind: LifeSound, point: Vec3Like, listener: Vec3Like): void {
    const range = Math.hypot(point.x - listener.x, point.y - listener.y, point.z - listener.z);
    if (range > (kind === 'fox' ? 65 : 50)) return;
    const bus = this.audio.context();
    if (!bus || this.audio.volume === 0) return;
    const { ctx, noise } = bus;
    const startAt = ctx.currentTime + 0.012;
    const pan = spatial(bus, point, kind === 'fox' ? 16 : 8);

    const notes = phrases[kind];
    if (notes) {
      const detune = 0.95 + Math.random() * 0.10;
      for (const [i, [start, end, delay, length, volume]] of notes.entries()) {
        const t = startAt + delay;
        const osc = ctx.createOscillator();
        osc.type = kind === 'fox' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(start * detune, t);
        osc.frequency.exponentialRampToValueAtTime(end * detune, t + length);
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.exponentialRampToValueAtTime(volume, t + length * 0.28);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
        osc.connect(amp).connect(pan);
        if (i === notes.length - 1) osc.onended = () => pan.disconnect();
        osc.start(t);
        osc.stop(t + length + 0.01);
      }
      return;
    }

    const bands = ctx.createBiquadFilter();
    bands.type = 'bandpass';
    bands.Q.value = 0.8;
    bands.frequency.value = kind === 'wings' ? 940 : kind === 'step' ? 1040 : 1900;
    bands.connect(pan);
    if (kind === 'step') {
      const thump = ctx.createOscillator();
      const envelope = ctx.createGain();
      thump.frequency.setValueAtTime(112, startAt);
      thump.frequency.exponentialRampToValueAtTime(48, startAt + 0.078);
      envelope.gain.setValueAtTime(0.0001, startAt);
      envelope.gain.exponentialRampToValueAtTime(0.15, startAt + 0.011);
      envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.083);
      thump.connect(envelope).connect(pan);
      thump.start(startAt);
      thump.stop(startAt + 0.089);
    }
    const taps = kind === 'wings' ? 4 : kind === 'step' ? 1 : 3;
    for (let i = 0; i < taps; i++) {
      const t = startAt + i * 0.078;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime((kind === 'step' ? 0.11 : 0.19) / (1 + i * 0.35), t + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.084);
      src.connect(gain).connect(bands);
      if (i === taps - 1) src.onended = () => pan.disconnect();
      src.start(t, Math.random() * 0.36, 0.09);
    }
  }

  work(kind: WorkSound, point: Vec3Like, listener: Vec3Like): void {
    if (this.audio.volume === 0 || Math.hypot(point.x - listener.x, point.z - listener.z) > 24) return;
    const bus = this.audio.context();
    if (!bus) return;
    const refDistance = kind === 'teaSip' ? 2.2 : kind === 'broom' ? 4.4 : 3.6;
    playResidentFoley(bus.ctx, bus.noise, spatial(bus, point, refDistance), kind);
  }

  update(residents: Residents, listener: Vec3Like, paused: boolean): void {
    const bus = this.audio.context();
    if (!bus) return;
    const { ctx } = bus;
    const t = ctx.currentTime;
    for (const resident of residents.list) {
      if (!resident.tractor) continue;
      const near = Math.hypot(resident.x - listener.x, resident.z - listener.z) < 84;
      const running = near && !paused && !resident.parked && this.audio.volume > 0;
      let engine = this.engines.get(resident.id);
      if (!engine && !running) continue;
      if (!engine) {
        const pan = spatial(bus, resident, 6.2);
        const level = ctx.createGain();
        level.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 1.8;
        const crank = ctx.createOscillator();
        crank.type = 'triangle';
        const firing = ctx.createOscillator();
        firing.type = 'sawtooth';
        firing.connect(filter);
        crank.connect(filter);
        filter.connect(level).connect(pan);
        crank.start();
        firing.start();
        engine = { pan, level, filter, crank, firing };
        this.engines.set(resident.id, engine);
      }
      engine.level.gain.setTargetAtTime(running ? 0.08 + resident.speed * 0.013 : 0, t, 0.08);
      if (!running) continue;
      position(engine.pan, resident, 0.95);
      const idle = resident.id === 'emre' ? 21 : 24;
      const chop = idle + resident.speed * 3.9 + Math.sin(t * 12) * 0.37;
      engine.crank.frequency.setTargetAtTime(chop, t, 0.08);
      engine.firing.frequency.setTargetAtTime(chop * 2.016, t, 0.08);
      engine.filter.frequency.setTargetAtTime(125 + resident.speed * 49, t, 0.1);
    }
  }
}

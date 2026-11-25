import type { GameAudio } from './audio';
import type { Vec3Like } from '../core/events';
import type { ResidentDialogue } from '../life/dialogue';
import { residentVoices, type ResidentSpeech, type Vowel } from '../life/residentSpeech';
import type { ResidentId } from '../world/mapTypes';
import { position, spatial } from './valleyLifeAudio';

const formants: Record<Vowel, readonly [number, number]> = {
  a: [810, 1510], e: [530, 2080], i: [380, 2520], o: [580, 1030], u: [355, 890],
};

export function playResidentSpeech(
  ctx: BaseAudioContext, output: AudioNode, id: ResidentId, speech: ResidentSpeech, elapsed = 0, ended?: () => void,
): (() => void) | undefined {
  const syllables = speech.syllables.filter(({ start, length }) => start + length > elapsed + 0.012);
  if (!syllables.length) return;
  const voice = residentVoices[id];
  const now = ctx.currentTime + 0.012;
  const tone = ctx.createOscillator();
  const body = ctx.createOscillator();
  tone.type = 'sawtooth';
  body.type = id === 'hasan' ? 'triangle' : 'sine';
  const envelope = ctx.createGain();
  envelope.gain.value = 0;
  const level = ctx.createGain();
  const low = ctx.createBiquadFilter();
  const high = ctx.createBiquadFilter();
  const color = ctx.createGain();
  low.type = high.type = 'bandpass';
  low.Q.value = 1.45;
  high.Q.value = 2.1;
  color.gain.value = voice.edge * 0.55;
  tone.connect(low).connect(envelope);
  tone.connect(high).connect(color).connect(envelope);
  body.connect(envelope);
  envelope.connect(level).connect(output);

  const first = now + Math.max(0, syllables[0].start - elapsed);
  let end = first;
  for (const syllable of syllables) {
    const start = now + Math.max(0, syllable.start - elapsed);
    end = now + syllable.start + syllable.length - elapsed;
    const length = end - start;
    const [f1, f2] = formants[syllable.vowel];
    low.frequency.setValueAtTime(f1 * voice.brightness, start);
    high.frequency.setValueAtTime(f2 * voice.brightness, start);
    for (const oscillator of [tone, body]) {
      oscillator.frequency.setValueAtTime(syllable.pitch * 0.995, start);
      oscillator.frequency.exponentialRampToValueAtTime(syllable.pitch * 1.025, start + length * 0.38);
      oscillator.frequency.exponentialRampToValueAtTime(syllable.pitch * 2 ** (syllable.bend / 12), end);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(0.145 * syllable.accent, start + length * 0.2);
    envelope.gain.exponentialRampToValueAtTime(0.092 * syllable.accent, start + length * 0.64);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
  }
  const finish = end + 0.012;
  tone.onended = () => {
    tone.disconnect();
    body.disconnect();
    low.disconnect();
    high.disconnect();
    color.disconnect();
    envelope.disconnect();
    level.disconnect();
    ended?.();
  };
  for (const oscillator of [tone, body]) {
    oscillator.start(first);
    oscillator.stop(finish);
  }
  return () => {
    const time = ctx.currentTime;
    if (time >= finish) return;
    level.gain.setTargetAtTime(0, time, 0.007);
    tone.stop(Math.min(finish, time + 0.026));
    body.stop(Math.min(finish, time + 0.026));
  };
}

export class ResidentVoiceAudio {
  private line: ResidentDialogue | null = null;
  private pan?: PannerNode;
  private release?: () => void;

  constructor(private readonly audio: GameAudio) {}

  chatter(point: Vec3Like, listener: Vec3Like, id: ResidentId, speech: ResidentSpeech): void {
    const bus = this.audio.context();
    if (!bus || this.audio.volume === 0 || Math.hypot(point.x - listener.x, point.z - listener.z) > 19) return;
    const pan = spatial(bus, point, 1.9);
    if (!playResidentSpeech(bus.ctx, pan, id, speech, 0, () => pan.disconnect())) pan.disconnect();
  }

  update(dialogue: ResidentDialogue | null, paused: boolean): void {
    const bus = this.audio.context();
    const current = bus && this.audio.volume > 0 && !paused ? dialogue : null;
    if (current !== this.line) {
      this.release?.();
      this.release = undefined;
      this.pan = undefined;
      this.line = current;
      const resident = current?.resident;
      if (bus && resident?.speech && resident.speaking) {
        const pan = spatial(bus, resident, 5.8);
        this.pan = pan;
        const ended = () => {
          pan.disconnect();
          if (this.pan === pan) this.pan = undefined;
        };
        this.release = playResidentSpeech(bus.ctx, pan, resident.id, resident.speech, resident.lineAge, ended);
        if (!this.release) ended();
      }
    }
    if (this.pan && current) {
      const resident = current.resident;
      position(this.pan, resident, resident.tractor ? 2.32 : 1.61);
    }
  }
}

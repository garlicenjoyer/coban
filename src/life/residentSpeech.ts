import { residentVoice, type ResidentId } from '../world/mapTypes';
import type { ResidentGesture } from './dialogue';

export const residentVoices = {
  ayse: { pitch: 335, tempo: 0.103, contour: [0, 3, 1, 5, 2, -2], brightness: 1.07, edge: 0.65, scoop: 1.5 },
  hasan: { pitch: 183, tempo: 0.131, contour: [0, -2, 1, -1, 2], brightness: 0.78, edge: 0.44, scoop: -2.2 },
  emre: { pitch: 250, tempo: 0.091, contour: [0, 5, 2, 4, -2], brightness: 0.96, edge: 0.90, scoop: -1.2 },
  zeynep: { pitch: 413, tempo: 0.081, contour: [0, 2, 7, 3, 5, -1], brightness: 1.18, edge: 0.76, scoop: 2.4 },
} as const;

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';

export interface Syllable {
  start: number;
  length: number;
  pitch: number;
  bend: number;
  vowel: Vowel;
  accent: number;
}

export interface ResidentSpeech {
  syllables: readonly Syllable[];
  duration: number;
}

const vowels: Record<string, Vowel> = { a: 'a', e: 'e', i: 'i', ı: 'u', o: 'o', ö: 'e', u: 'u', ü: 'i' };

export function planResidentSpeech(id: ResidentId, text: string, gesture: ResidentGesture): ResidentSpeech {
  const voice = residentVoices[residentVoice[id]];
  const tokens = text.match(/[\p{L}\p{N}]+(?:[’'][\p{L}]+)*|[,.!?;:…]/gu) ?? [];
  const syllables: Syllable[] = [];
  let time = 0.025;
  let phrase = 0;
  const tempo = voice.tempo * (gesture === 'greet' ? 0.92 : 1);
  const mood = gesture === 'greet' || gesture === 'thank' ? 2 : gesture === 'offer' ? 1 : 0;
  for (const [index, token] of tokens.entries()) {
    if (!/[\p{L}\p{N}]/u.test(token)) {
      time += /[.!?…]/.test(token) ? 0.15 : 0.084;
      phrase = 0;
      continue;
    }
    const word = token.toLocaleLowerCase('tr');
    const nuclei = word.match(/[aeıioöuü]+/g) ?? ['e'];
    const next = tokens[index + 1] ?? '.';
    for (const [i, nucleus] of nuclei.entries()) {
      const ending = i === nuclei.length - 1 && /^[.!?…]$/.test(next);
      const emphasis = word.length >= 4 && i === 0;
      const variation = (word.charCodeAt(i) % 7 - 3) * 0.34;
      const step = voice.contour[phrase++ % voice.contour.length] + mood + variation + Number(emphasis);
      const length = tempo * (ending ? 1.42 : emphasis ? 1.13 : 0.88);
      syllables.push({ start: time, length, pitch: voice.pitch * 2 ** (step / 12),
        bend: ending ? next === '?' ? 4.2 : -3.1 : voice.scoop, vowel: vowels[nucleus[0]], accent: emphasis ? 1 : 0.78 });
      time += length + 0.017;
    }
    time += tempo * (word.length < 4 ? 0.12 : 0.36);
  }
  return { syllables, duration: syllables.length ? time : 0 };
}

export function speechMouth(speech: ResidentSpeech, time: number): number {
  const syllable = speech.syllables.find(({ start, length }) => time >= start && time < start + length);
  if (!syllable) return 0.04;
  const phase = (time - syllable.start) / syllable.length;
  return 0.04 + (syllable.vowel === 'a' ? 0.72 : 0.49) * Math.sin(Math.PI * phase) * syllable.accent;
}

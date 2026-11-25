import type { WorkSound } from '../life/residentWork';

/** Short sounds for the materials the villagers handle. */
export function playResidentFoley(ctx: AudioContext, noise: AudioBuffer, pan: PannerNode, kind: WorkSound): void {
  const start = ctx.currentTime + 0.012;
  const variation = 0.91 + Math.random() * 0.18;
  let remaining = 0;

  function connect(source: AudioScheduledSourceNode, output: AudioNode): void {
    remaining++;
    output.connect(pan);
    source.onended = () => {
      source.disconnect();
      output.disconnect();
      if (--remaining === 0) pan.disconnect();
    };
  }

  function friction(delay: number, length: number, from: number, to: number, level: number, rise = 0.23): void {
    const time = start + delay;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.72;
    band.frequency.setValueAtTime(from * variation, time);
    band.frequency.exponentialRampToValueAtTime(to * variation, time + length);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(level, time + length * rise);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + length);
    source.connect(band).connect(envelope);
    connect(source, envelope);
    source.start(time, Math.random() * Math.max(0, noise.duration - length), length);
  }

  function ring(delay: number, length: number, hz: number, level: number): void {
    const time = start + delay;
    const source = ctx.createOscillator();
    source.frequency.value = hz * variation;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(level, time + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + length);
    source.connect(envelope);
    connect(source, envelope);
    source.start(time);
    source.stop(time + length);
  }

  switch (kind) {
    case 'broom':
      friction(0, 0.34, 1500, 3400, 0.21, 0.34);
      friction(0.041, 0.27, 425, 720, 0.12, 0.34);
      friction(0.19, 0.105, 4900, 2700, 0.05);
      break;
    case 'oliveRustle':
      friction(0, 0.17, 2100, 3800, 0.13);
      friction(0.057, 0.12, 1200, 2050, 0.08);
      break;
    case 'oliveDrop':
      for (const [delay, pitch, strength] of [[0, 340, 0.13], [0.037, 510, 0.09], [0.103, 285, 0.06]]) {
        const offset = delay * variation;
        ring(offset, 0.045, pitch, strength);
        friction(offset, 0.054, 1120, 700, strength);
      }
      friction(0.01, 0.19, 2400, 1480, 0.065);
      break;
    case 'teaSip':
      friction(0, 0.18, 520, 1080, 0.07, 0.28);
      friction(0.027, 0.13, 1300, 1750, 0.055);
      break;
    case 'tavla':
      friction(0, 0.036, 1450, 670, 0.17);
      ring(0.002, 0.057, 895, 0.087);
      break;
    case 'tractorCheck':
      friction(0, 0.07, 700, 350, 0.14);
      ring(0.002, 0.12, 465, 0.12);
      ring(0.002, 0.078, 1365, 0.071);
      ring(0.098, 0.082, 907, 0.072);
      break;
    case 'churn':
      for (const [delay, strength] of [[0, 1], [0.092, 0.57]]) {
        friction(delay, 0.073, 2400, 980, 0.12 * strength);
        ring(delay, 0.23, 795, 0.105 * strength);
        ring(delay, 0.12, 1840, 0.058 * strength);
        ring(delay, 0.15, 2575, 0.030 * strength);
      }
      break;
  }
}

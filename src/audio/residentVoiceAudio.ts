import type { GameAudio } from './audio';
import type { Vec3Like } from '../core/events';
import type { ResidentDialogue } from '../life/dialogue';
import type { Resident, ResidentId } from '../life/residents';
import { voiceCues } from './residentVoiceCues';
import { position, spatial } from './valleyLifeAudio';

export class ResidentVoiceAudio {
  private readonly banks = new Map<ResidentId, Promise<AudioBuffer | null>>();
  private decoder?: OfflineAudioContext;
  private request: { line: ResidentDialogue } | null = null;
  private playing?: { source: AudioBufferSourceNode; pan: PannerNode; level: GainNode };

  constructor(private readonly audio: GameAudio) {}

  update(dialogue: ResidentDialogue | null, residents: readonly Resident[], listener: Vec3Like, paused: boolean): void {
    const bus = this.audio.context();
    if (!bus || this.audio.volume === 0 || paused) {
      this.stop();
      return;
    }
    // Warm each bank in earshot so the first response can start immediately.
    for (const resident of residents) {
      if (Math.hypot(resident.x - listener.x, resident.z - listener.z) < 24) void this.bank(resident.id);
    }
    if (dialogue !== (this.request?.line ?? null)) {
      this.stop();
      if (dialogue) {
        const resident = dialogue.resident;
        const cue = voiceCues[resident.id][dialogue.text];
        const request = { line: dialogue };
        this.request = request;
        if (cue) void this.bank(resident.id).then((buffer) => {
          if (!buffer || this.request !== request || this.audio.volume === 0 || !resident.conversation || !resident.speaking) return;
          const source = bus.ctx.createBufferSource();
          const level = bus.ctx.createGain();
          const pan = spatial(bus, resident, 5.8);
          position(pan, resident, resident.tractor ? 2.32 : 1.61);
          level.gain.value = 1.38;
          source.buffer = buffer;
          source.connect(level).connect(pan);
          const playing = { source, level, pan };
          this.playing = playing;
          source.onended = () => {
            source.disconnect();
            level.disconnect();
            pan.disconnect();
            if (this.playing === playing) this.playing = undefined;
          };
          source.start(bus.ctx.currentTime, ...cue);
        });
      }
    }
    if (this.playing && dialogue) {
      const resident = dialogue.resident;
      position(this.playing.pan, resident, resident.tractor ? 2.32 : 1.61);
    }
  }

  private bank(id: ResidentId): Promise<AudioBuffer | null> {
    const cached = this.banks.get(id);
    if (cached) return cached;
    const reading = fetch(`${import.meta.env.BASE_URL}audio/villagers/${id}.m4a`)
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.arrayBuffer();
        this.decoder ??= new OfflineAudioContext(1, 1, 24000);
        return this.decoder.decodeAudioData(data);
      }).catch(() => null);
    this.banks.set(id, reading);
    return reading;
  }

  private stop(): void {
    this.request = null;
    const playing = this.playing;
    if (!playing) return;
    const now = playing.source.context.currentTime;
    playing.level.gain.setTargetAtTime(0, now, 0.012);
    playing.source.stop(now + 0.045);
    this.playing = undefined;
  }
}

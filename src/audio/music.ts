// Background music, earned (Death Stranding's trick): no endless loop. One track greets
// the first morning; after that the valley is quiet until a moment earns a song: the first
// time the flock reaches a new pasture, or you reach the hilltop or the ruins. Each cue
// plays the next track once, fading in and out (equal-power). `loop` mode keeps the old
// endless crossfading playlist. Browsers block autoplay with sound, so nothing plays before
// the first click or key press.

export class Music {
  private els: HTMLAudioElement[];
  private current = -1;
  private nextTrack = 0;
  private started = false;
  private fadeIn = -1;
  private fadeOut = -1;
  private base: number;
  private pendingCue = false;

  constructor(
    srcs: string[],
    volume = 0.3,
    /** Fade length, seconds. */
    private fade = 6,
    /** 'earned': cued moments only. 'loop': an endless crossfading playlist. */
    private mode: 'earned' | 'loop' = 'earned',
  ) {
    this.base = volume;
    this.els = srcs.map((src) => {
      const el = new Audio(src);
      el.preload = 'auto';
      el.volume = 0;
      el.addEventListener('ended', () => {
        if (this.els[this.current] !== el) return;
        el.volume = 0;
        this.current = -1;
        this.fadeOut = -1;
        if (this.mode === 'loop') this.cue();
      });
      return el;
    });
    const start = () => {
      if (this.started) return;
      this.started = true;
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      // The first morning gets its song.
      this.cue();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    window.setInterval(() => this.tick(), 50);
  }

  get playing(): boolean {
    return this.current >= 0;
  }

  /** The track playing now, or a dash while the valley is quiet. */
  get nowPlaying(): string {
    if (this.current < 0) return '— (quiet until a new place is reached)';
    return decodeURIComponent(this.els[this.current].src.split('/').pop() ?? '');
  }

  get volume(): number {
    return this.base;
  }

  set volume(v: number) {
    this.base = Math.max(0, Math.min(1, v));
  }

  /** A moment worth a song: play the next track once (ignored while one is playing). */
  cue(): void {
    if (!this.started) {
      this.pendingCue = true;
      return;
    }
    if (this.current >= 0) return;
    const i = this.nextTrack;
    this.nextTrack = (i + 1) % this.els.length;
    const el = this.els[i];
    el.currentTime = 0;
    el.volume = 0;
    this.current = i;
    this.fadeIn = performance.now();
    this.fadeOut = -1;
    el.play().catch(() => {
      // Still blocked: forget this one, the next moment will try again.
      this.current = -1;
    });
  }

  private tick(): void {
    if (this.pendingCue && this.started) {
      this.pendingCue = false;
      this.cue();
    }
    if (this.current < 0) return;
    const el = this.els[this.current];
    const now = performance.now();
    let g = 1;
    if (this.fadeIn >= 0) {
      const f = Math.min(1, (now - this.fadeIn) / (this.fade * 1000));
      g = Math.sin((f * Math.PI) / 2);
      if (f >= 1) this.fadeIn = -1;
    }
    if (this.fadeOut < 0 && Number.isFinite(el.duration) && el.duration > this.fade * 2 && el.currentTime >= el.duration - this.fade) this.fadeOut = now;
    if (this.fadeOut >= 0) {
      const f = Math.min(1, (now - this.fadeOut) / (this.fade * 1000));
      g = Math.min(g, Math.cos((f * Math.PI) / 2));
    }
    el.volume = this.base * g;
  }
}

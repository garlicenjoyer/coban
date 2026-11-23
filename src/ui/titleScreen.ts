// The opening: a title over a slow aerial view of the homestead, Uncle Ahmet's letter for a
// new game (why you are here, before how), then the camera glides down to the shepherd.
// The world waits until then. The last click also captures the mouse and wakes the sound,
// so the first click in the valley is never wasted.
//
// A returning player gets "Continue · Day 2, 10:40" instead, and no letter.

import * as THREE from 'three';
import { activeMap, layout } from '../world/map';

type Stage = 'title' | 'letter' | 'glide' | 'done';

export interface TitleHooks {
  canvas: HTMLCanvasElement;
  groundAt(x: number, z: number): number;
  /** A save was loaded: what to say on the Continue button. */
  resumed: { day: number; clock: string } | null;
  /** The letter has been read (by reading it here). */
  readLetter(): void;
  /** Throw the save away and start Day 1 afresh. */
  newGame(): void;
  /** The world starts: forget anything pressed while the title was up. */
  onPlay(): void;
}

const GLIDE_SECONDS = 3.2;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const smooth = (t: number) => t * t * (3 - 2 * t);

export class TitleScreen {
  private el: HTMLDivElement;
  private stage: Stage = 'title';
  private t = 0;
  private orbit = 0;
  private from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private focus: THREE.Vector3;
  private padA = true;

  constructor(private hooks: TitleHooks) {
    const house = layout.house;
    const pen = layout.pen;
    const fx = (house.x + pen.x) / 2;
    const fz = (house.z + pen.z) / 2;
    this.focus = new THREE.Vector3(fx, hooks.groundAt(fx, fz) + 2, fz);

    this.el = document.createElement('div');
    this.el.id = 'title';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Çoban');
    document.body.appendChild(this.el);
    document.body.classList.add('titling');
    this.render();
    requestAnimationFrame(() => this.el.classList.add('up'));

    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act) this.act(act);
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.stage !== 'title' && this.stage !== 'letter') return;
        // The title owns the keyboard until the game begins. Enter and Space go on through
        // (any key press is what lets the browser start the sound); the world is still.
        const press = e.code === 'Enter' || e.code === 'Space';
        if (!press) e.stopImmediatePropagation();
        if (press && !e.repeat) {
          const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('#title [data-act]');
          this.act(focused?.dataset.act ?? 'primary');
          e.preventDefault();
        }
      },
      true,
    );
  }

  /** The world is held still (and the HUD hidden) until the camera has come down. */
  get holding(): boolean {
    return this.stage !== 'done';
  }

  /** The title or letter has the screen (Esc and the pause menu leave it alone). */
  get isOpen(): boolean {
    return this.stage === 'title' || this.stage === 'letter';
  }

  private act(act: string): void {
    if (act === 'new') return this.hooks.newGame();
    if (act === 'primary') act = this.stage === 'title' ? (this.hooks.resumed ? 'continue' : 'begin') : 'go';
    if (act === 'begin') {
      this.stage = 'letter';
      this.render();
      return;
    }
    if (act === 'go' || act === 'continue') {
      if (act === 'go') this.hooks.readLetter();
      this.start();
    }
  }

  private start(): void {
    // Take the mouse now, inside the click: the first click in the valley is then an action.
    try {
      const r = this.hooks.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* drag-to-look fallback; Input hears the pointerlockerror */
    }
    this.stage = 'glide';
    this.t = 0;
    this.el.classList.remove('up');
    window.setTimeout(() => this.el.remove(), 600);
  }

  private render(): void {
    const r = this.hooks.resumed;
    if (this.stage === 'title') {
      this.el.innerHTML = `
        <div class="tt-card">
          <div class="tt-kicker">An Aegean valley · summer</div>
          <h1>Çoban</h1>
          <p class="tt-line">“My knees have given up on the hills, so the flock is yours now.”<span>Ahmet amca</span></p>
          <nav class="tt-acts">
            ${
              r
                ? `<button data-act="continue" class="tt-primary">Continue<small>Day ${r.day} · ${esc(r.clock)}</small></button>
                   <button data-act="new">New game</button>`
                : `<button data-act="begin" class="tt-primary">Begin<small>Day 1 · morning</small></button>`
            }
          </nav>
          <p class="tt-foot">Sound helps: you’ll hear Karabaş, the bells and the wolves before you see them.</p>
        </div>`;
    } else if (this.stage === 'letter') {
      const letter = activeMap().notes?.find((n) => n.id === 'letter');
      const paras = (letter?.text ?? '').split(/\n\n+/).map((p) => `<p>${esc(p)}</p>`).join('');
      this.el.innerHTML = `
        <div class="tt-letter">
          <div class="where">${esc(letter?.where ?? 'a letter')}</div>
          <h3>${esc(letter?.title ?? 'A letter')}</h3>
          ${paras}
          <div class="sig">— Ahmet amca</div>
          <button data-act="go" class="tt-primary">Go out to the flock<small>the mouse will steer the camera · Esc pauses</small></button>
        </div>`;
    }
    this.el.querySelector<HTMLElement>('.tt-primary')?.focus({ preventScroll: true });
  }

  /**
   * After the camera rig has placed the camera for the shepherd: during the title, swap in
   * the aerial view; during the glide, blend from that view down to the rig's.
   */
  applyCamera(cam: THREE.PerspectiveCamera, dt: number): void {
    this.pollPad();
    if (this.stage === 'done') return;
    if (this.stage === 'title' || this.stage === 'letter') {
      this.orbit += dt * 0.035;
      const a = 2.2 + this.orbit;
      cam.position.set(this.focus.x + Math.cos(a) * 62, this.focus.y + 30, this.focus.z + Math.sin(a) * 62);
      cam.lookAt(this.focus);
      this.from.pos.copy(cam.position);
      this.from.quat.copy(cam.quaternion);
      return;
    }
    this.t += dt;
    const k = smooth(Math.min(1, this.t / GLIDE_SECONDS));
    cam.position.lerpVectors(this.from.pos, cam.position, k);
    cam.quaternion.slerpQuaternions(this.from.quat, cam.quaternion, k);
    if (this.t >= GLIDE_SECONDS) {
      this.stage = 'done';
      document.body.classList.remove('titling');
      this.hooks.onPlay();
    }
  }

  /** Gamepad A presses the highlighted button. */
  private pollPad(): void {
    let a = false;
    for (const g of navigator.getGamepads ? navigator.getGamepads() : []) if (g?.connected && g.buttons[0]?.pressed) a = true;
    if (a && !this.padA && this.isOpen) this.act('primary');
    this.padA = a;
  }
}

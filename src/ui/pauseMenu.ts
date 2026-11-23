// The pause menu (Esc / gamepad Start): Resume, Controls, Options.
// The world stops while it is open. Esc steps back one page; from the first page it resumes.
// Releasing the mouse with Esc (pointer lock) also opens it; the game's own releases (map,
// packing card) do not, and Esc on an open card closes the card instead.

import type { Input } from '../core/input';

type Page = 'main' | 'controls' | 'options';
type Device = 'keyboard' | 'gamepad';

/** One line of the controls page: the keys (each a keycap), what they do, and a note. */
type Row = [keys: string[], action: string, note?: string];
interface Group {
  title: string;
  rows: Row[];
}

const KEYBOARD: Group[] = [
  {
    title: 'On foot',
    rows: [
      [['W', 'A', 'S', 'D'], 'Walk', 'or the arrow keys'],
      [['Shift'], 'Sprint'],
      [['Ctrl', 'C'], 'Sneak'],
      [['N'], 'Rest or sleep', 'once the day’s work is done'],
      [['Mouse'], 'Look around', 'click the view to capture the mouse'],
      [['Wheel'], 'Zoom the camera'],
      [['E'], 'Gate · free a sheep · pet the dog', 'hold E for longer jobs'],
    ],
  },
  {
    title: 'Flock & dog',
    rows: [
      [['Left click'], 'Swing the crook'],
      [['Right click'], 'Call the flock'],
      [['Q'], 'Whistle wheel', 'hold and flick toward a command · tap to repeat the last'],
      [['X'], 'Hush the flock', 'hold'],
    ],
  },
  {
    title: 'Motorcycle',
    rows: [
      [['E'], 'Get on · get off'],
      [['Space'], 'Kick-start', 'release in the green'],
      [['W', 'S'], 'Throttle · brake'],
      [['A', 'D'], 'Steer'],
      [['Alt', 'Mouse'], 'Shift your weight'],
      [['H'], 'Horn'],
      [['F'], 'Headlamp'],
    ],
  },
  {
    title: 'Field kit',
    rows: [
      [['T'], 'Look at the watch', 'hold'],
      [['M'], 'Paper map'],
      [['G'], 'Read the land', 'hold'],
      [['J'], 'Journal'],
      [['1', '2', '3'], 'Use a satchel pocket'],
      [['P'], 'Pack the satchel', 'at home'],
      [['V'], 'Sling'],
      [['B'], 'Stack a cairn', 'hold'],
      [['F'], 'Lantern'],
      [['R'], 'Fill or pour the water cans', 'hold R by the parked bike to work on it'],
    ],
  },
  {
    title: 'Menus',
    rows: [
      [['Esc'], 'Pause · back · close a card'],
      [['`'], 'Developer overlay'],
    ],
  },
];

const GAMEPAD: Group[] = [
  {
    title: 'On foot',
    rows: [
      [['Left stick'], 'Walk', 'a light tilt sneaks'],
      [['L3'], 'Sprint'],
      [['Right stick'], 'Camera'],
      [['A'], 'Gate · free a sheep · pet the dog', 'hold A for longer jobs'],
    ],
  },
  {
    title: 'Flock & dog',
    rows: [
      [['RT'], 'Swing the crook'],
      [['LT'], 'Call the flock'],
      [['LB'], 'Whistle wheel', 'hold, pick with the right stick · tap to repeat'],
      [['R3'], 'Hush the flock', 'hold'],
    ],
  },
  {
    title: 'Motorcycle',
    rows: [
      [['A'], 'Kick-start', 'hold A to get off'],
      [['RT', 'LT'], 'Throttle · brake'],
      [['Left stick'], 'Steer'],
      [['Right stick'], 'Shift your weight'],
      [['B'], 'Horn'],
      [['D-pad ↑'], 'Headlamp'],
    ],
  },
  {
    title: 'Field kit',
    rows: [
      [['D-pad ↓'], 'Look at the watch', 'hold'],
      [['View'], 'Paper map'],
      [['D-pad ←'], 'Read the land', 'hold'],
      [['Y'], 'Use the selected pocket'],
      [['D-pad →'], 'Next pocket', 'hold to stack a cairn'],
      [['X'], 'Sling'],
      [['D-pad ↑'], 'Lantern'],
      [['RB'], 'Fill or pour the water cans', 'hold RB by the parked bike to work on it'],
    ],
  },
  {
    title: 'Menus',
    rows: [[['Start'], 'Pause · resume'], [['B'], 'Back (in this menu)']],
  },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface PauseHooks {
  input: Input;
  /** A paper card (map, shop, packing, note) is open: Esc belongs to it. */
  cardOpen(): boolean;
  /** "Day 2 · 14:20" for the menu's header. */
  when(): string;
  getEffects(): number;
  setEffects(v: number): void;
  getMusic(): number;
  setMusic(v: number): void;
  getDevOverlay(): boolean;
  setDevOverlay(on: boolean): void;
}

const SETTINGS_KEY = 'coban.settings';

export class PauseMenu {
  private el: HTMLDivElement;
  private panel: HTMLDivElement;
  private page: Page = 'main';
  private device: Device = 'keyboard';
  private openedAt = 0;
  private selfRelease = false;
  private padStart = false;
  private padBack = false;
  private padNav = 0;
  isOpen = false;

  constructor(private hooks: PauseHooks) {
    this.el = document.createElement('div');
    this.el.id = 'pause';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Paused');
    this.panel = document.createElement('div');
    this.panel.className = 'pz-panel';
    this.el.appendChild(this.panel);
    document.body.appendChild(this.el);
    this.loadSettings();

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) {
        // A click on the dimmed backdrop (outside the panel) resumes.
        if (e.target === this.el) this.close();
        return;
      }
      const act = t.dataset.act!;
      if (act === 'resume') this.close();
      else if (act === 'back') this.go('main');
      else if (act === 'controls' || act === 'options') this.go(act);
      else if (act === 'device') {
        this.device = t.dataset.device as Device;
        this.render();
        this.focusFirst('[data-act=device][aria-selected=true]');
      } else if (act === 'dev') {
        this.hooks.setDevOverlay(!this.hooks.getDevOverlay());
        this.render();
        this.focusFirst('[data-act=dev]');
      }
    });
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const v = Number(t.value) / 100;
      if (t.dataset.vol === 'effects') this.hooks.setEffects(v);
      if (t.dataset.vol === 'music') this.hooks.setMusic(v);
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = `${t.value}%`;
      this.saveSettings();
    });

    // Capture phase: runs before every other keyboard listener in the game.
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.isOpen) {
          // While paused the world hears nothing; Tab / Enter / Space / arrows still work the menu.
          e.stopImmediatePropagation();
          if (e.code === 'Escape' && !e.repeat && performance.now() - this.openedAt > 200) this.back();
          else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
            e.preventDefault();
            this.moveFocus(e.code === 'ArrowDown' ? 1 : -1);
          }
          return;
        }
        if (e.code === 'Escape' && !e.repeat && !this.hooks.cardOpen()) {
          e.stopImmediatePropagation();
          this.open();
        }
      },
      true,
    );

    // Esc while the mouse is captured: the browser releases it without a keydown. Treat any
    // release the game did not ask for (Esc, switching windows) as a pause.
    const exit = document.exitPointerLock.bind(document);
    document.exitPointerLock = () => {
      this.selfRelease = true;
      exit();
    };
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) return;
      if (this.selfRelease) {
        this.selfRelease = false;
        return;
      }
      if (!this.isOpen && !this.hooks.cardOpen()) this.open();
    });
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.openedAt = performance.now();
    this.page = 'main';
    this.device = this.hooks.input.lastDevice;
    this.hooks.input.releaseAll();
    document.body.classList.add('paused');
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
    this.el.classList.add('up');
    this.focusFirst();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.hooks.input.releaseAll();
    document.body.classList.remove('paused');
    this.el.classList.remove('up');
    (document.getElementById('view') as HTMLCanvasElement | null)?.focus();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** One page back; from the first page, resume. */
  back(): void {
    if (this.page === 'main') this.close();
    else this.go('main');
  }

  /** Gamepad: Start toggles, B steps back, the D-pad moves between buttons, A presses. */
  update(): void {
    let pad: Gamepad | null = null;
    for (const g of navigator.getGamepads ? navigator.getGamepads() : []) if (g && g.connected) pad = pad ?? g;
    const start = !!pad?.buttons[9]?.pressed;
    if (start && !this.padStart && !this.hooks.cardOpen()) this.toggle();
    this.padStart = start;
    if (!this.isOpen || !pad) return;
    const b = !!pad.buttons[1]?.pressed;
    if (b && !this.padBack) this.back();
    this.padBack = b;
    const nav = pad.buttons[13]?.pressed ? 1 : pad.buttons[12]?.pressed ? -1 : (pad.axes[1] ?? 0) > 0.6 ? 1 : (pad.axes[1] ?? 0) < -0.6 ? -1 : 0;
    if (nav !== this.padNav && nav !== 0) this.moveFocus(nav);
    this.padNav = nav;
    // A presses the focused button (sliders move with the D-pad's left / right).
    if (pad.buttons[0]?.pressed && !this.padA) (document.activeElement as HTMLElement | null)?.click?.();
    this.padA = !!pad.buttons[0]?.pressed;
    const lr = pad.buttons[15]?.pressed ? 1 : pad.buttons[14]?.pressed ? -1 : 0;
    const a = document.activeElement as HTMLInputElement | null;
    if (lr && a?.type === 'range' && performance.now() - this.lastSlide > 90) {
      this.lastSlide = performance.now();
      a.value = String(Math.max(0, Math.min(100, Number(a.value) + lr * 5)));
      a.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  private padA = false;
  private lastSlide = 0;

  private go(page: Page): void {
    const from = this.page;
    this.page = page;
    this.render();
    this.focusFirst(page === 'main' ? `[data-act=${from}]` : undefined);
  }

  private focusables(): HTMLElement[] {
    return [...this.panel.querySelectorAll<HTMLElement>('button, input')];
  }

  private focusFirst(sel?: string): void {
    const el =
      (sel && this.panel.querySelector<HTMLElement>(sel)) ||
      this.panel.querySelector<HTMLElement>('[aria-selected=true]') ||
      this.focusables().find((f) => !f.classList.contains('pz-back'));
    el?.focus({ preventScroll: true });
  }

  private moveFocus(dir: number): void {
    const list = this.focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = list[(i + dir + list.length) % list.length];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }

  private render(): void {
    this.panel.dataset.page = this.page;
    if (this.page === 'main') this.panel.innerHTML = this.mainHtml();
    else if (this.page === 'controls') this.panel.innerHTML = this.controlsHtml();
    else this.panel.innerHTML = this.optionsHtml();
  }

  private mainHtml(): string {
    return `
      <header class="pz-head">
        <div class="pz-kicker">${esc(this.hooks.when())}</div>
        <h2>Paused</h2>
      </header>
      <nav class="pz-menu">
        <button data-act="resume" class="pz-primary"><span>Resume</span><kbd>Esc</kbd></button>
        <button data-act="controls"><span>Controls</span><i>›</i></button>
        <button data-act="options"><span>Options</span><i>›</i></button>
      </nav>
      <p class="pz-foot">The valley waits while you are here.</p>`;
  }

  private controlsHtml(): string {
    const groups = this.device === 'gamepad' ? GAMEPAD : KEYBOARD;
    const keys = (ks: string[]) => ks.map((k) => `<kbd>${esc(k)}</kbd>`).join('<span class="pz-plus"></span>');
    const body = groups
      .map(
        (g) => `
        <section>
          <h3>${esc(g.title)}</h3>
          <dl>${g.rows
            .map(([ks, action, note]) => `<div class="pz-row"><dt>${keys(ks)}</dt><dd>${esc(action)}${note ? `<small>${esc(note)}</small>` : ''}</dd></div>`)
            .join('')}</dl>
        </section>`,
      )
      .join('');
    const tab = (d: Device, label: string) =>
      `<button role="tab" data-act="device" data-device="${d}" aria-selected="${this.device === d}">${label}</button>`;
    return `
      <header class="pz-head pz-sub">
        <button data-act="back" class="pz-back" aria-label="Back">‹</button>
        <h2>Controls</h2>
        <div class="pz-tabs" role="tablist">${tab('keyboard', 'Keyboard &amp; mouse')}${tab('gamepad', 'Gamepad')}</div>
      </header>
      <div class="pz-scroll pz-controls">${body}</div>`;
  }

  private optionsHtml(): string {
    const slider = (id: 'effects' | 'music', label: string, v: number) => {
      const pct = Math.round(v * 100);
      return `<label class="pz-opt"><span>${label}</span><input type="range" min="0" max="100" step="5" value="${pct}" data-vol="${id}" /><output>${pct}%</output></label>`;
    };
    const dev = this.hooks.getDevOverlay();
    return `
      <header class="pz-head pz-sub">
        <button data-act="back" class="pz-back" aria-label="Back">‹</button>
        <h2>Options</h2>
      </header>
      <div class="pz-scroll">
        <section>
          <h3>Sound</h3>
          ${slider('effects', 'Sounds &amp; ambience', this.hooks.getEffects())}
          ${slider('music', 'Music', this.hooks.getMusic())}
        </section>
        <section>
          <h3>Display</h3>
          <button class="pz-opt pz-toggle" data-act="dev" role="switch" aria-checked="${dev}">
            <span>Developer overlay<small>stats, tuning panel and the text readout · <kbd>\`</kbd></small></span><i></i>
          </button>
        </section>
      </div>`;
  }

  private loadSettings(): void {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as { effects?: number; music?: number } | null;
      if (typeof s?.effects === 'number') this.hooks.setEffects(s.effects);
      if (typeof s?.music === 'number') this.hooks.setMusic(s.music);
    } catch {
      /* defaults */
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ effects: this.hooks.getEffects(), music: this.hooks.getMusic() }));
    } catch {
      /* settings just won't persist */
    }
  }
}

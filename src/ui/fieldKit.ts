// The shepherd's field kit (GDD: Diegetic UI). Information lives on objects he owns:
//   pocket watch  hold T / D-pad ↓: the time, with the evening marked on the dial; it
//                 ticks audibly from golden hour until sunset.
//   compass       appears with a bark or a howl (and with the map or watch): north, plus a
//                 notch pointing where the sound came from, fading over 10 s.
//   tesbih        prayer beads, one per sheep: dark beads are sheep inside the pen. Shown
//                 near the ağıl; each sheep passing the gate is a click.

import { GOLDEN_HOUR, SUNSET_HOUR } from '../core/config';
import type { EventBus } from '../core/events';
import type { Sim } from '../sim';
import { insideFold, insidePen, layout } from '../world/map';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export interface KitSounds {
  tick(): void;
  bead(): void;
}

export class FieldKit {
  private watchEl: SVGSVGElement;
  private hourHand: SVGLineElement;
  private minuteHand: SVGLineElement;
  private compassEl: SVGSVGElement;
  private rose: SVGGElement;
  private notch: SVGPathElement;
  private beadsEl: HTMLDivElement;
  private watchHeld = false;
  private notchWorld = 0;
  private notchUntil = 0;
  private compassUntil = 0;
  private lastSecond = -1;
  private lastInside: boolean[] = [];
  private beadsUntil = 0;
  /** The map is open (shows the compass beside it). */
  mapOpen = false;

  constructor(
    private sim: () => Sim,
    events: EventBus,
    private sounds: KitSounds,
  ) {
    // ---- pocket watch
    this.watchEl = svg('svg', { id: 'watch', viewBox: '-60 -70 120 130' }) as SVGSVGElement;
    this.watchEl.append(
      svg('circle', { cx: 0, cy: -62, r: 6, fill: 'none', stroke: '#b8892f', 'stroke-width': 3 }),
      svg('rect', { x: -5, y: -58, width: 10, height: 8, rx: 2, fill: '#c99a3b' }),
      svg('circle', { r: 52, fill: '#c99a3b', stroke: '#8a6420', 'stroke-width': 3 }),
      svg('circle', { r: 45, fill: '#f6efdd', stroke: '#8a6420', 'stroke-width': 1 }),
    );
    // Evening arc on the dial: golden hour to sunset (12-hour dial).
    const arc = (h0: number, h1: number, r: number) => {
      const p = (h: number) => {
        const a = ((h % 12) / 12) * Math.PI * 2;
        return [Math.sin(a) * r, -Math.cos(a) * r];
      };
      const [x0, y0] = p(h0);
      const [x1, y1] = p(h1);
      return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
    };
    this.watchEl.append(svg('path', { d: arc(GOLDEN_HOUR, SUNSET_HOUR, 38), stroke: '#e0943a', 'stroke-width': 6, fill: 'none', opacity: 0.85 }));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 === 0 ? 33 : 37;
      this.watchEl.append(svg('line', { x1: Math.sin(a) * r0, y1: -Math.cos(a) * r0, x2: Math.sin(a) * 42, y2: -Math.cos(a) * 42, stroke: '#3b2a20', 'stroke-width': i % 3 === 0 ? 2.5 : 1.2 }));
    }
    const sun = svg('text', { x: 0, y: 20, 'text-anchor': 'middle', 'font-size': 9, fill: '#8a6420', 'font-family': 'Georgia, serif' });
    sun.textContent = 'sunset 7';
    this.watchEl.append(sun);
    this.hourHand = svg('line', { x1: 0, y1: 4, x2: 0, y2: -22, stroke: '#2b1f17', 'stroke-width': 3.5, 'stroke-linecap': 'round' }) as SVGLineElement;
    this.minuteHand = svg('line', { x1: 0, y1: 6, x2: 0, y2: -34, stroke: '#2b1f17', 'stroke-width': 2, 'stroke-linecap': 'round' }) as SVGLineElement;
    this.watchEl.append(this.hourHand, this.minuteHand, svg('circle', { r: 3, fill: '#2b1f17' }));
    document.body.appendChild(this.watchEl);

    // ---- compass
    this.compassEl = svg('svg', { id: 'compass', viewBox: '-50 -50 100 100' }) as SVGSVGElement;
    this.compassEl.append(
      svg('circle', { r: 46, fill: '#b98a35', stroke: '#7d5a1c', 'stroke-width': 3 }),
      svg('circle', { r: 39, fill: '#f3ead2' }),
    );
    this.rose = svg('g', {}) as SVGGElement;
    this.rose.append(
      svg('path', { d: 'M0 -34 L6 0 L0 6 L-6 0 Z', fill: '#b5402f' }),
      svg('path', { d: 'M0 34 L6 0 L0 -6 L-6 0 Z', fill: '#3b2a20' }),
    );
    for (const [t, a] of [
      ['N', 0],
      ['E', 90],
      ['S', 180],
      ['W', 270],
    ] as const) {
      const r = (a * Math.PI) / 180;
      const txt = svg('text', { x: Math.sin(r) * 29, y: -Math.cos(r) * 29 + 4, 'text-anchor': 'middle', 'font-size': 10, 'font-family': 'Georgia, serif', fill: t === 'N' ? '#b5402f' : '#3b2a20' });
      txt.textContent = t;
      this.rose.append(txt);
    }
    this.notch = svg('path', { d: 'M0 -44 L5 -36 L-5 -36 Z', fill: '#2f6f8f' }) as SVGPathElement;
    this.compassEl.append(this.rose, this.notch, svg('circle', { r: 2.5, fill: '#7d5a1c' }));
    document.body.appendChild(this.compassEl);

    // ---- tesbih
    this.beadsEl = document.createElement('div');
    this.beadsEl.id = 'tesbih';
    document.body.appendChild(this.beadsEl);

    events.on('bark', (e) => this.point(e.x, e.z, false));
    events.on('howl', (e) => this.point(e.x, e.z, true));

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') this.watchHeld = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyT') this.watchHeld = false;
    });
    window.addEventListener('blur', () => (this.watchHeld = false));
  }

  /** Show the compass with a notch toward a sound (a bark is where the dog is looking). */
  private point(x: number, z: number, howl: boolean): void {
    const p = this.sim().player.pos;
    this.notchWorld = Math.atan2(x - p.x, -(z - p.z));
    this.notchUntil = performance.now() + 10_000;
    this.compassUntil = performance.now() + (howl ? 10_000 : 6000);
  }

  update(camYaw: number): void {
    const sim = this.sim();
    const now = performance.now();
    let pad: Gamepad | null = null;
    for (const g of navigator.getGamepads ? navigator.getGamepads() : []) if (g && g.connected) pad = pad ?? g;
    const watch = this.watchHeld || !!pad?.buttons[13]?.pressed;

    // ---- watch
    this.watchEl.classList.toggle('up', watch);
    const h = sim.hour;
    const hourA = ((h % 12) / 12) * 360;
    const minA = ((h % 1) * 60 * 6) % 360;
    this.hourHand.setAttribute('transform', `rotate(${hourA})`);
    this.minuteHand.setAttribute('transform', `rotate(${minA})`);
    // Audible ticking from golden hour to sunset, a tick per real second.
    const sec = Math.floor(now / 1000);
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      if (sim.tasks.enabled && h >= GOLDEN_HOUR && h < SUNSET_HOUR) this.sounds.tick();
    }

    // ---- compass
    const showCompass = watch || this.mapOpen || now < this.compassUntil;
    this.compassEl.classList.toggle('up', showCompass);
    const deg = (camYaw * 180) / Math.PI;
    this.rose.setAttribute('transform', `rotate(${deg})`);
    const fade = Math.max(0, (this.notchUntil - now) / 10_000);
    this.notch.setAttribute('transform', `rotate(${(this.notchWorld * 180) / Math.PI + deg})`);
    this.notch.setAttribute('opacity', fade.toFixed(2));

    // ---- tesbih: near the pen, or for a few seconds after a sheep crosses the gate
    const sheep = sim.flock.sheep;
    const folded = sim.works.built('hut');
    const inside = sheep.map((s) => insidePen(s.x, s.z, -0.3) || (folded && insideFold(s.x, s.z)));
    if (this.lastInside.length === inside.length) {
      for (let i = 0; i < inside.length; i++) {
        if (inside[i] !== this.lastInside[i]) {
          this.sounds.bead();
          this.beadsUntil = now + 4000;
        }
      }
    }
    this.lastInside = inside;
    const p = sim.player.pos;
    const f = layout.works.fold;
    const nearPen = Math.hypot(p.x - layout.pen.x, p.z - layout.pen.z) < 30 || (folded && Math.hypot(p.x - (f.xMin + f.xMax) / 2, p.z - (f.zMin + f.zMax) / 2) < 30);
    const showBeads = nearPen || now < this.beadsUntil || this.mapOpen || watch;
    this.beadsEl.classList.toggle('up', showBeads);
    if (showBeads) {
      // Beads only: the shepherd counts them himself (no numbers on screen).
      // Hatched beads: worn-down sheep (condition below half).
      const html = inside.map((v, i) => `<i class="${v ? 'in' : ''}${sheep[i].condition < 50 ? ' weak' : ''}"></i>`).join('');
      if (this.beadsEl.innerHTML !== html) this.beadsEl.innerHTML = html;
    }
  }
}

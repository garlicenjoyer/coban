// Whistle wheel overlay (GDD Controls): hold Q / LB, flick toward a command, release.
// The centre shows lips (whistle, carries 150 m, startles nearby sheep) or an open hand
// (silent gesture: dog within 25 m and in sight). Also shows short command toasts.

import { config } from '../core/config';
import type { EventBus } from '../core/events';
import type { WheelState } from '../core/input';
import { commandInfo, COMMANDS } from '../dog/commands';

export class WhistleWheel {
  private el: HTMLDivElement;
  private slots: HTMLDivElement[] = [];
  private center: HTMLDivElement;
  private toast: HTMLDivElement;
  private toastUntil = 0;

  constructor(events: EventBus, private dogName: () => string, private bond: () => number) {
    this.el = document.createElement('div');
    this.el.id = 'wheel';
    const r = 118;
    COMMANDS.forEach((c, i) => {
      const a = (i / COMMANDS.length) * Math.PI * 2;
      const s = document.createElement('div');
      s.className = 'slot';
      s.style.left = `${150 + Math.sin(a) * r}px`;
      s.style.top = `${150 - Math.cos(a) * r}px`;
      s.innerHTML = `<b>${c.turkish}</b><span>${c.english}</span>`;
      this.slots.push(s);
      this.el.appendChild(s);
    });
    this.center = document.createElement('div');
    this.center.className = 'center';
    this.el.appendChild(this.center);
    document.body.appendChild(this.el);

    this.toast = document.createElement('div');
    this.toast.id = 'toast';
    document.body.appendChild(this.toast);

    events.on('dogCommand', (e) => {
      const c = commandInfo(e.command);
      if (!e.heard) this.show(`♪ ${c.turkish} — nobody heard it (${this.dogName()} is beyond ${config.dog.whistleRange} m)`);
      else this.show(e.mode === 'gesture' ? `✋ ${c.turkish} (${c.english}) — ${c.gesture}` : `♪ ${c.turkish} (${c.english}) — ${c.whistle}`);
    });
    events.on('dogAck', (e) => {
      if (!e.willObey) this.show(`${this.dogName()} looks at you… and ignores it (bond ${Math.round(this.bond())})`);
    });
    events.on('dogPetted', (e) => this.show(e.praise ? `Good dog! ${this.dogName()} wags (bond ${Math.round(e.bond)})` : `You pet ${this.dogName()} (bond ${Math.round(e.bond)})`));
  }

  show(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    this.toastUntil = performance.now() + 2600;
  }

  update(w: WheelState, gesture: boolean): void {
    this.el.style.display = w.open ? 'block' : 'none';
    if (performance.now() > this.toastUntil) this.toast.style.opacity = '0';
    if (!w.open) return;
    this.slots.forEach((s, i) => s.classList.toggle('on', i === w.slot));
    const pick = w.slot >= 0 ? COMMANDS[w.slot] : null;
    this.center.innerHTML = gesture
      ? `<div class="icon">✋</div><div>Gesture (silent)</div>${pick ? `<small>${pick.gesture}</small>` : ''}`
      : `<div class="icon">♪</div><div>Whistle</div>${pick ? `<small>${pick.whistle}</small>` : ''}`;
  }
}

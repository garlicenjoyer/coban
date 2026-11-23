// The satchel (heybe), bottom right: three pockets with what's packed and notches for
// what's left. It shows at home, for a moment after you use something, and with the watch.
// P at home opens the packing card: pick three of the four things for today's route.

import type { EventBus } from '../core/events';
import type { Input } from '../core/input';
import { ITEMS, ITEM_ORDER, type ItemId } from '../player/satchel';
import type { Sim } from '../sim';

const GLYPH: Record<ItemId, string> = {
  salve: '<svg viewBox="0 0 40 40"><rect x="11" y="14" width="18" height="18" rx="4" fill="#d9c49a" stroke="#6b4e2e" stroke-width="2"/><rect x="13" y="9" width="14" height="6" rx="2" fill="#8a5a3a"/><path d="M20 18v10M15 23h10" stroke="#a33a2a" stroke-width="2.5"/></svg>',
  rope: '<svg viewBox="0 0 40 40"><ellipse cx="20" cy="20" rx="12" ry="9" fill="none" stroke="#a07a4a" stroke-width="4"/><ellipse cx="20" cy="20" rx="7" ry="5" fill="none" stroke="#8a6438" stroke-width="3"/><path d="M30 24l6 8" stroke="#a07a4a" stroke-width="3"/></svg>',
  salt: '<svg viewBox="0 0 40 40"><path d="M8 26l12-8 12 8-12 7z" fill="#f4efe6" stroke="#8a7a66" stroke-width="1.5"/><path d="M8 26v-6l12-8 12 8v6" fill="#e8e1d4" stroke="#8a7a66" stroke-width="1.5"/></svg>',
  cay: '<svg viewBox="0 0 40 40"><path d="M14 16h12l-2 16h-8z" fill="#b5402f" fill-opacity=".85" stroke="#6b3020" stroke-width="1.5"/><path d="M15 16c0-3 10-3 10 0" fill="none" stroke="#6b3020" stroke-width="1.5"/><path d="M18 11c-1-2 1-3 0-5M22 11c-1-2 1-3 0-5" stroke="#9a8a7a" stroke-width="1.2" fill="none"/></svg>',
  bread: '<svg viewBox="0 0 40 40"><ellipse cx="17" cy="22" rx="11" ry="7" fill="#d9a35a" stroke="#7a5228" stroke-width="1.5"/><path d="M10 20c3-2 5-2 7 0M15 18c3-2 5-2 7 0" stroke="#a8743a" stroke-width="1.3" fill="none"/><path d="M24 25h10l-1 7h-8z" fill="#f4efe6" stroke="#8a7a66" stroke-width="1.5"/></svg>',
};

export class SatchelView {
  private el: HTMLDivElement;
  private card: HTMLDivElement;
  private showUntil = 0;
  private lastHtml = '';
  private picks: ItemId[] = [];
  cardOpen = false;
  /** The watch is up (the satchel shows with it). */
  watchUp = false;

  constructor(
    private sim: () => Sim,
    events: EventBus,
    private input: Input,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'satchel';
    document.body.appendChild(this.el);
    this.card = document.createElement('div');
    this.card.id = 'packcard';
    document.body.appendChild(this.card);

    const peek = () => (this.showUntil = performance.now() + 4000);
    events.on('itemUsed', peek);
    events.on('packed', peek);
    events.on('slept', peek);
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyP') this.toggleCard();
      else if (this.cardOpen && e.code === 'Escape') this.toggleCard(false);
      else if (this.cardOpen && e.code === 'Enter') this.pack();
      else if (this.cardOpen && /^Digit[1-5]$/.test(e.code)) this.togglePick(ITEM_ORDER[Number(e.code.slice(5)) - 1]);
    });
    this.card.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-item],[data-act]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.item) this.togglePick(t.dataset.item as ItemId);
      if (t.dataset.act === 'pack') this.pack();
      if (t.dataset.act === 'close') this.toggleCard(false);
    });
  }

  private toggleCard(force?: boolean): void {
    const open = force ?? !this.cardOpen;
    if (open && !this.sim().atHome) {
      this.showUntil = performance.now() + 3000;
      return;
    }
    this.cardOpen = open;
    this.input.uiCapture = open;
    document.body.classList.toggle('packing', open);
    if (open) {
      this.picks = [...this.sim().satchel.ids];
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.card.classList.toggle('up', open);
    this.renderCard();
  }

  private togglePick(id: ItemId | undefined): void {
    if (!id) return;
    const i = this.picks.indexOf(id);
    if (i >= 0) this.picks.splice(i, 1);
    else if (this.picks.length < 3) this.picks.push(id);
    this.renderCard();
  }

  private pack(): void {
    this.input.requestPack(this.picks);
    this.toggleCard(false);
  }

  private renderCard(): void {
    if (!this.cardOpen) return;
    const rows = ITEM_ORDER.map((id, k) => {
      const on = this.picks.includes(id);
      return `<div class="pk ${on ? 'on' : ''}" data-item="${id}"><span class="g">${GLYPH[id]}</span><span><b>${k + 1}. ${ITEMS[id].name}</b><br><i>${ITEMS[id].what}</i></span></div>`;
    }).join('');
    this.card.innerHTML = `<h3>Pack the satchel</h3><p>Three pockets. Think of today’s route.</p>${rows}<div class="acts"><button data-act="pack">Pack (Enter)</button><button data-act="close">Leave it (Esc)</button></div>`;
  }

  update(): void {
    const sim = this.sim();
    const show = this.cardOpen || sim.atHome || this.watchUp || performance.now() < this.showUntil || sim.brewing > 0;
    this.el.classList.toggle('up', show);
    if (!show) return;
    const pad = this.input.lastDevice === 'gamepad';
    const html = sim.satchel.slots
      .map((s, i) => {
        const left = Number.isFinite(s.uses) ? '<span class="notch"></span>'.repeat(Math.max(0, s.uses)) : '';
        const sel = pad && i === this.input.selectedSlot ? ' sel' : '';
        return `<div class="pocket${s.uses <= 0 ? ' empty' : ''}${sel}" title="${ITEMS[s.id].name}"><span class="key">${pad ? '' : i + 1}</span>${GLYPH[s.id]}<span class="left">${left}</span></div>`;
      })
      .join('') + (sim.atHome ? '<div class="packhint"><kbd>P</kbd> pack</div>' : '');
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.el.innerHTML = html;
    }
  }
}

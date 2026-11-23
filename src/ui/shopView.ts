// A shop counter in the village (GDD feature 6): a paper card with the shopkeeper's line,
// what they buy from you and what they sell, and your purse. Number keys buy, Enter sells,
// Esc (or walking off) leaves. The trade itself happens in the sim, on the next tick.

import { config } from '../core/config';
import type { EventBus } from '../core/events';
import type { Input } from '../core/input';
import { Economy, GOODS, HERBS, JOBS, SHOPS, UPGRADES, type ShopId, type UpgradeId } from '../economy/economy';
import type { Sim } from '../sim';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export class ShopView {
  private el: HTMLDivElement;
  private shop: ShopId | null = null;
  private last = '';

  constructor(
    private sim: () => Sim,
    events: EventBus,
    private input: Input,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'shopcard';
    this.el.setAttribute('role', 'dialog');
    document.body.appendChild(this.el);
    events.on('shopOpen', (e) => (this.shop === e.shop ? this.close() : this.open(e.shop as ShopId)));
    events.on('traded', (e) => {
      if (this.shop === e.shop) {
        this.last = e.text;
        this.render();
      }
    });
    events.on('simReset', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (!this.shop) return;
      if (e.code === 'Escape') this.close();
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.input.requestTrade({ shop: this.shop, kind: 'sell' });
      else if (e.code === 'Digit0' && this.shop === 'kahvehane') this.input.requestTrade({ shop: this.shop, kind: 'job' });
      else if (/^Digit[1-9]$/.test(e.code)) {
        const good = this.goods()[Number(e.code.slice(5)) - 1];
        if (good) this.input.requestTrade({ shop: this.shop, kind: 'buy', good: good.id });
      }
    });
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-buy],[data-sell],[data-close],[data-job]') as HTMLElement | null;
      if (!t || !this.shop) return;
      if (t.dataset.close !== undefined) this.close();
      else if (t.dataset.job !== undefined) this.input.requestTrade({ shop: this.shop, kind: 'job' });
      else if (t.dataset.sell !== undefined) this.input.requestTrade({ shop: this.shop, kind: 'sell' });
      else if (t.dataset.buy) this.input.requestTrade({ shop: this.shop, kind: 'buy', good: t.dataset.buy as never });
    });
  }

  get isOpen(): boolean {
    return this.shop !== null;
  }

  private goods() {
    return GOODS.filter((g) => g.shop === this.shop);
  }

  private open(shop: ShopId): void {
    this.shop = shop;
    this.last = '';
    this.input.uiCapture = true;
    this.el.classList.add('up');
    this.render();
  }

  close(): void {
    this.shop = null;
    this.input.uiCapture = false;
    this.el.classList.remove('up');
  }

  /** What this shop will buy from you right now, in a line (or null if nothing). */
  private sellLine(): string | null {
    const sim = this.sim();
    const e = sim.economy;
    if (this.shop === 'dairy') {
      const ready = e.cheese.filter((w) => w.age >= config.economy.cheese.ageDays);
      const cheese = ready.length ? `${ready.length} aged wheel${ready.length > 1 ? 's' : ''} (${ready.reduce((a, w) => a + Economy.cheesePrice(w), 0)} ₺)` : '';
      if (e.rackMilk > 0) return `Sell ${e.rackMilk} L of milk from the bike · about ${Math.round(e.rackMilk * config.economy.milkPerLitre * e.milkQuality)} ₺${cheese ? ` · and ${cheese}` : ''}`;
      if (cheese) return `Sell ${cheese}`;
      return e.churn > 0 ? 'Your churn is still at home by the ağıl.' : 'She buys fresh milk, brought by bike the same day, and aged cheese.';
    }
    if (this.shop === 'muze' || this.shop === 'dealer') {
      if (!e.artifacts.length) return this.shop === 'muze' ? 'He buys finds from the ruin, for the museum.' : 'He buys old things. No questions.';
      const worth = e.artifacts.reduce((a, f) => a + f.value, 0);
      return this.shop === 'muze'
        ? `Give ${e.artifacts.length} find${e.artifacts.length > 1 ? 's' : ''} to the museum · ${Math.round(worth * config.economy.museumShare)} ₺, and he tells you about them`
        : `Sell ${e.artifacts.length} find${e.artifacts.length > 1 ? 's' : ''} · ${worth} ₺`;
    }
    if (this.shop === 'bakkal') {
      if (!e.herbCount && !e.fleeces) return 'He buys wild herbs (thyme, sage, mountain tea) and, in summer, wool.';
      const parts = (Object.keys(e.herbs) as (keyof typeof HERBS)[]).filter((k) => e.herbs[k] > 0).map((k) => `${e.herbs[k]} ${HERBS[k].name}`);
      if (e.fleeces) parts.push(`${e.fleeces} fleece${e.fleeces > 1 ? 's' : ''}`);
      const lira = (Object.keys(e.herbs) as (keyof typeof HERBS)[]).reduce((a, k) => a + e.herbs[k] * HERBS[k].price, 0) + Math.round(e.woolValue);
      return `Sell ${parts.join(', ')} · ${lira} ₺`;
    }
    return null;
  }

  /** At the kahvehane: ask Kemal about work, or report back. */
  private jobRow(): string {
    if (this.shop !== 'kahvehane') return '';
    const e = this.sim().economy;
    const text = e.job ? `Report back to Kemal: “${JOBS[e.job.id].title}”` : this.sim().tasks.day < e.nextJobDay ? 'Kemal has nothing for you until tomorrow.' : 'Ask Kemal if anyone needs a hand';
    return `<div class="gd" data-job><b>0.</b> ${esc(text)}</div>`;
  }

  private render(): void {
    if (!this.shop) return;
    const sim = this.sim();
    const info = SHOPS[this.shop];
    const sell = this.sellLine();
    const e0 = sim.economy;
    const canSell =
      (this.shop === 'dairy' && (e0.rackMilk > 0 || e0.cheese.some((w) => w.age >= config.economy.cheese.ageDays))) ||
      (this.shop === 'bakkal' && (e0.herbCount > 0 || e0.fleeces > 0)) ||
      ((this.shop === 'muze' || this.shop === 'dealer') && e0.artifacts.length > 0);
    const rows = this.goods()
      .map((g, i) => {
        const cost = sim.economy.discounted(g.price);
        const price = g.id === 'tankFuel' ? `${cost} ₺ a litre` : `${cost} ₺${cost < g.price ? ` <s>${g.price}</s>` : ''}`;
        const owned = UPGRADES.has(g.id) && sim.economy.has(g.id as UpgradeId);
        const off = owned || (g.id !== 'tankFuel' && cost > sim.economy.lira) ? ' off' : '';
        return `<div class="gd${off}" data-buy="${g.id}"><b>${i + 1}. ${esc(g.name)}</b> <span>${owned ? 'yours' : price}</span><br><i>${esc(g.what)}</i></div>`;
      })
      .join('');
    this.el.innerHTML =
      `<h3>${esc(info.keeper)} · ${esc(info.name)}</h3><p class="say">“${esc(info.greeting)}”</p>` +
      (sell ? `<div class="sell${canSell ? '' : ' off'}" data-sell>${canSell ? '<b>Enter.</b> ' : ''}${esc(sell)}</div>` : '') +
      rows +
      this.jobRow() +
      (this.last ? `<p class="last">${esc(this.last)}</p>` : '') +
      `<div class="purse">Purse: <b>${Math.round(sim.economy.lira)} ₺</b> · <span data-close>Esc — leave</span></div>`;
  }

  /** Close when the shepherd walks off; keep the purse and lines fresh. */
  update(): void {
    if (!this.shop) return;
    const sim = this.sim();
    const counter = sim.shopNear(sim.player.pos.x, sim.player.pos.z);
    const s = sim.economy;
    const key = `${s.lira}|${s.rackMilk}|${s.herbCount}|${s.artifacts.length}|${s.cheese.length}|${s.upgrades.size}|${s.job?.id ?? ''}${s.job?.found ? '!' : ''}|${s.fleeces}|${s.reputation}`;
    if (!counter || counter.id !== this.shop || sim.riding) return this.close();
    if (key !== this.el.dataset.key) {
      this.el.dataset.key = key;
      this.render();
    }
  }
}


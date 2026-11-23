// The shepherd's satchel (heybe): three slots, packed at home in the morning. What you
// bring depends on the route you plan; what you leave behind you'll miss out there.
// Headless: the sim owns the effects, this only holds what's packed and what's left.

import { config } from '../core/config';

export type ItemId = 'salve' | 'rope' | 'salt' | 'cay' | 'bread';

export interface ItemInfo {
  id: ItemId;
  name: string;
  /** Uses per day (restocked at home each morning). Infinity: reusable. */
  uses: number;
  /** One line for the packing card. */
  what: string;
}

export const ITEMS: Record<ItemId, ItemInfo> = {
  salve: { id: 'salve', name: 'Wound salve', uses: config.satchel.salveUses, what: 'Heals a hurt sheep or Karabaş. Use it standing next to them.' },
  rope: { id: 'rope', name: 'Halter rope', uses: Infinity, what: 'Lead one sheep on a rope: frees a stuck one, brings a stray home. Use again to let go.' },
  salt: { id: 'salt', name: 'Salt lick', uses: 1, what: 'Set it down: the flock grazes calmly around it while you are busy elsewhere.' },
  cay: { id: 'cay', name: 'Çay kit', uses: 1, what: 'Brew tea for half an hour: the flock settles, Karabaş rests and loves you for it.' },
  bread: { id: 'bread', name: 'Bread and yoghurt', uses: 1, what: 'Feed Karabaş by hand out in the hills: a meal away from his bowl, and he loves you for it.' },
};

export const ITEM_ORDER: ItemId[] = ['salve', 'rope', 'salt', 'cay', 'bread'];

export interface Slot {
  id: ItemId;
  uses: number;
}

export class Satchel {
  slots: Slot[] = [];

  constructor(items: ItemId[] = ['salve', 'rope', 'cay']) {
    this.pack(items);
  }

  /** Repack (at home). Duplicates are dropped; at most `slots` items. */
  pack(items: readonly ItemId[]): void {
    const seen = new Set<ItemId>();
    this.slots = [];
    for (const id of items) {
      if (seen.has(id) || !ITEMS[id] || this.slots.length >= config.satchel.slots) continue;
      seen.add(id);
      this.slots.push({ id, uses: ITEMS[id].uses });
    }
  }

  /** Morning at home: refill everything that's packed. */
  restock(): void {
    for (const s of this.slots) s.uses = ITEMS[s.id].uses;
  }

  has(id: ItemId): boolean {
    return this.slots.some((s) => s.id === id && s.uses > 0);
  }

  get ids(): ItemId[] {
    return this.slots.map((s) => s.id);
  }

  stateKey(): (string | number)[] {
    return this.slots.flatMap((s) => [s.id, Number.isFinite(s.uses) ? s.uses : -1]);
  }
}

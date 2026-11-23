// Uncle Ahmet's notes, read in the hand (GDD: Diegetic UI). E near a note opens it: his
// words on a scrap of paper, and at its foot what his note added to the paper map. The
// world keeps running; walk away, press Esc, or E again to fold it away.

import type { EventBus } from '../core/events';
import type { Sim } from '../sim';
import { activeMap } from '../world/map';
import type { PencilMark } from '../world/mapTypes';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** How far the shepherd can wander from the note before he folds it away, metres. */
const FOLD_AWAY_M = 3.5;

const markWords = (m: PencilMark): string =>
  m.kind === 'text' ? m.text : m.kind === 'route' ? 'a route' : (m.text ?? (m.kind === 'circle' ? 'a circle' : 'a sketch'));

export class NoteView {
  private el: HTMLDivElement;
  private openId: string | null = null;

  constructor(
    private sim: () => Sim,
    events: EventBus,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'ahmetnote';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.el);

    events.on('noteRead', (e) => {
      if (this.openId === e.id && !e.first) return this.close();
      this.show(e.id, e.first);
    });
    events.on('simReset', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.openId) this.close();
    });
  }

  get isOpen(): boolean {
    return this.openId !== null;
  }

  private show(id: string, first: boolean): void {
    const note = activeMap().notes?.find((n) => n.id === id);
    if (!note) return;
    const added = first ? (activeMap().pencil ?? []).filter((m) => m.from === id) : [];
    const paras = note.text
      .split(/\n\n+/)
      .map((p) => `<p>${esc(p)}</p>`)
      .join('');
    const foot = added.length
      ? `<div class="added">On his map now: ${added.map((m) => `<i>${esc(markWords(m))}</i>`).join(', ')}</div>`
      : '';
    this.el.innerHTML = `<div class="where">${esc(note.where)}</div><h3>${esc(note.title)}</h3>${paras}<div class="sig">— Ahmet amca</div>${foot}<div class="hint">E or Esc — fold it away${added.length ? ' · M — the map' : ''}</div>`;
    this.el.classList.add('open');
    this.openId = id;
  }

  close(): void {
    this.el.classList.remove('open');
    this.openId = null;
  }

  /** Fold the note away once the shepherd walks off or gets on the bike. */
  update(): void {
    if (!this.openId) return;
    const sim = this.sim();
    const note = activeMap().notes?.find((n) => n.id === this.openId);
    const p = sim.player.pos;
    if (!note || sim.riding || Math.hypot(note.x - p.x, note.z - p.z) > FOLD_AWAY_M) this.close();
  }
}

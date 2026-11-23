// The coach's card: a glass pill above the context prompt, with a drawn mouse (the button
// to press lit and pulsing) or keycaps beside one line of what and one of why.

import type { CoachCard, Glyph } from '../tutorial/coach';

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function mouseSvg(button: 'left' | 'right'): string {
  // A mouse seen from above: two buttons split down the middle, a wheel between them.
  return `<svg class="cm-mouse" viewBox="0 0 34 48" aria-hidden="true">
    <path class="cm-body" d="M17 2.5c7.7 0 13.5 6 13.5 14v14.5c0 8-6 14.5-13.5 14.5S3.5 39 3.5 31V16.5c0-8 5.8-14 13.5-14z"/>
    <path class="cm-btn ${button === 'left' ? 'on' : ''}" d="M16 3.6C9.4 4.2 4.6 9.6 4.6 16.6V20H16z"/>
    <path class="cm-btn ${button === 'right' ? 'on' : ''}" d="M18 3.6c6.6.6 11.4 6 11.4 13V20H18z"/>
    <rect class="cm-wheel" x="15.4" y="8" width="3.2" height="7" rx="1.6"/>
  </svg>`;
}

function glyphHtml(g: Glyph): string {
  if (g.kind === 'mouse') return `${mouseSvg(g.button)}<span class="cm-cap">${g.button === 'left' ? 'Left click' : 'Right click'}</span>`;
  const keys = g.keys.map((k) => `<kbd${k.length > 2 ? ' class="wide"' : ''}>${esc(k)}</kbd>`).join('');
  return `<span class="cm-keys">${keys}</span>${g.hold ? '<span class="cm-cap hold">Hold</span>' : ''}`;
}

export class CoachView {
  private el: HTMLDivElement;
  private last = '';
  private hideTimer = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'coach';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.el);
  }

  update(card: CoachCard | null, hidden: boolean): void {
    const show = !!card && !hidden;
    if (card) {
      const key = JSON.stringify(card);
      if (key !== this.last) {
        this.last = key;
        const done = card.phase === 'done';
        this.el.className = `${done ? 'ok' : ''} ${card.compact ? 'compact' : ''} ${card.notice ? 'notice' : ''}`;
        this.el.innerHTML =
          `<div class="cm-glyph">${done ? '<span class="cm-check">✓</span>' : glyphHtml(card.glyph)}</div>` +
          `<div class="cm-text"><b>${esc(card.title)}</b>${card.body && !card.compact ? `<span>${esc(card.body)}</span>` : ''}</div>`;
      }
    }
    if (show) {
      window.clearTimeout(this.hideTimer);
      this.el.classList.add('up');
    } else if (this.el.classList.contains('up')) {
      this.el.classList.remove('up');
      // Keep the last words while it fades, then forget them so the next card starts clean.
      this.hideTimer = window.setTimeout(() => (this.last = ''), 400);
    }
  }
}

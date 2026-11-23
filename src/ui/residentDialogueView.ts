import type { Input } from '../core/input';
import type { DialogueChoice, ResidentDialogue } from '../life/dialogue';

export class ResidentDialogueView {
  private readonly root: HTMLElement;
  private readonly portrait = new Image();
  private readonly title = document.createElement('h2');
  private readonly trade = document.createElement('p');
  private readonly line = document.createElement('p');
  private readonly offer = document.createElement('div');
  private readonly choices = document.createElement('div');
  private readonly help = document.createElement('p');
  private shown: ResidentDialogue | null = null;
  private buttons: HTMLButtonElement[] = [];
  private selected = 0;
  private pad = false;

  constructor(private input: Input) {
    this.root = document.createElement('section');
    this.root.id = 'resident-dialogue';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'resident-dialogue-name');
    this.title.id = 'resident-dialogue-name';
    this.portrait.alt = '';
    this.portrait.width = this.portrait.height = 72;
    this.trade.className = 'resident-trade';
    this.line.className = 'resident-line';
    this.line.setAttribute('role', 'status');
    this.offer.className = 'resident-offer';
    this.choices.className = 'resident-choices';
    this.choices.setAttribute('aria-label', 'Conversation choices');
    this.help.className = 'resident-help';

    const heading = document.createElement('header');
    const identity = document.createElement('div');
    identity.append(this.title, this.trade);
    heading.append(this.portrait, identity);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'resident-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'End conversation');
    close.addEventListener('click', () => this.choose('leave'));
    this.root.append(close, heading, this.line, this.offer, this.choices, this.help);
    document.body.append(this.root);

    window.addEventListener('keydown', (event) => {
      if (!this.shown) return;
      const key = /^Digit([1-4])$/.exec(event.code);
      const option = key ? this.shown.options[Number(key[1]) - 1] : undefined;
      if (event.code !== 'Escape' && !option) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (!event.repeat) this.choose(option?.id ?? 'leave');
    }, true);
  }

  private choose(choice: DialogueChoice): void {
    this.input.requestDialogue(choice);
  }

  private readonly gamepad = {
    move: (dir: number) => {
      this.selected = (this.selected + dir + this.buttons.length) % this.buttons.length;
      this.highlightSelection();
    },
    select: () => this.shown?.options[this.selected]?.id,
  };

  private highlightSelection(): void {
    this.buttons.forEach((button, i) => button.classList.toggle('gamepad-selected', this.pad && i === this.selected));
  }

  get isOpen(): boolean { return this.shown !== null; }

  update(dialogue: ResidentDialogue | null, blocked: boolean): void {
    if (blocked && dialogue) {
      this.choose('leave');
      dialogue = null;
    }
    const pad = this.input.lastDevice === 'gamepad';
    if (dialogue === this.shown && pad === this.pad) return;
    const open = this.isOpen;
    const changed = this.shown !== dialogue;
    const hadFocus = this.choices.contains(document.activeElement);
    const previous = this.shown?.options[this.selected]?.id;
    this.shown = dialogue;
    this.pad = pad;
    this.root.hidden = !dialogue;
    document.body.classList.toggle('resident-talking', !!dialogue);
    this.input.dialogueControls = dialogue ? this.gamepad : null;
    if (!dialogue) return;
    if (!open && document.pointerLockElement) document.exitPointerLock();
    if (changed) {
      const { resident, offer, text } = dialogue;
      this.root.dataset.resident = resident.id;
      this.portrait.src = `${import.meta.env.BASE_URL}portraits/${resident.id}.jpg`;
      this.title.textContent = resident.profile.name;
      this.trade.textContent = resident.profile.trade;
      this.line.textContent = text;
      this.offer.hidden = !offer;
      if (offer) {
        const label = document.createElement('strong');
        label.textContent = offer.title;
        const reward = document.createElement('span');
        reward.textContent = `${offer.reward} ₺`;
        this.offer.replaceChildren(label, reward);
      }

      this.selected = !open || offer ? 0 : Math.max(0, dialogue.options.findIndex(({ id }) => id === previous));
      this.buttons = dialogue.options.map(({ id, label }, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.choice = id;
        const key = document.createElement('kbd');
        key.textContent = String(i + 1);
        key.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = label;
        button.append(key, text);
        button.addEventListener('click', () => {
          this.selected = i;
          this.choose(id);
        });
        return button;
      });
      this.choices.replaceChildren(...this.buttons);
      if (hadFocus && !pad) this.buttons[this.selected]?.focus({ preventScroll: true });
    }
    this.help.textContent = pad ? 'D-pad ↑↓ to choose · A to reply · B to leave' : 'Choose a reply with 1–4 · Esc to leave';
    this.highlightSelection();
  }
}

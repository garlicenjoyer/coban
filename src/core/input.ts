// Input mapper: keyboard/mouse + Gamepad API -> device-independent intents.
// The simulation only ever sees an InputFrame (plain, serialisable data), which is
// what makes record/replay and deterministic tests possible.

import type { GoodId, ShopId } from '../economy/economy';
import type { DogCommand } from '../dog/commands';
import { COMMANDS } from '../dog/commands';
import type { ItemId } from '../player/satchel';
import { config } from './config';
import type { DialogueChoice } from '../life/dialogue';

/** At a shop counter: sell what they buy, or buy one of their goods. */
export interface TradeRequest {
  shop: ShopId;
  /** sell what they buy · buy one of their goods · ask about (or report back on) an errand */
  kind: 'sell' | 'buy' | 'job';
  good?: GoodId;
}

export interface InputFrame {
  /** Strafe, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward, -1 (back) .. 1 (forward). */
  moveY: number;
  sprint: boolean;
  sneak: boolean;
  /** Edge-triggered: true for exactly one sim tick per press. */
  crook: boolean;
  call: boolean;
  interact: boolean;
  rest: boolean;
  /** Fill or pour the motorcycle's water cans while on foot. */
  water: boolean;
  /** Level-triggered: interact button is being held (freeing a stuck sheep). */
  interactHeld: boolean;
  /** Level-triggered: R / RB held by the parked bike: work on it (repairs, fuel). */
  bikeWork: boolean;
  /** Level-triggered: hush the flock (hold X / R3). */
  hush: boolean;
  /** Edge-triggered: a dog command chosen on the whistle wheel (or a quick repeat). */
  command: DogCommand | null;
  /** Riding: analog 0..1 (keyboard ramps over 0.25 s). */
  throttle: number;
  brake: number;
  /** Riding: -1 left .. 1 right. */
  steer: number;
  /** Riding: weight fore (+1) / aft (-1). */
  weightShift: number;
  /** Edge-triggered riding actions. */
  takeVehicle: boolean;
  kick: boolean;
  horn: boolean;
  /** Lantern on foot, headlamp while riding. */
  lamp: boolean;
  /** Edge-triggered: throw a sling stone where the camera looks (V / X). */
  sling: boolean;
  /** Edge-triggered: use the satchel item in this slot (0-based), or -1. */
  item: number;
  /** Level-triggered: stack a cairn (hold B / hold D-pad right). */
  cairn: boolean;
  /** Edge-triggered: repack the satchel (only works at home). */
  pack: ItemId[] | null;
  /** Edge-triggered: a trade at a shop counter (from the shop card). */
  trade: TradeRequest | null;
  dialogue: DialogueChoice | null;
  /** Camera yaw at sampling time; movement is camera-relative. */
  camYaw: number;
}

export const emptyFrame = (camYaw = 0): InputFrame => ({
  moveX: 0,
  moveY: 0,
  sprint: false,
  sneak: false,
  crook: false,
  call: false,
  interact: false,
  rest: false,
  water: false,
  interactHeld: false,
  bikeWork: false,
  hush: false,
  command: null,
  throttle: 0,
  brake: 0,
  steer: 0,
  weightShift: 0,
  takeVehicle: false,
  kick: false,
  horn: false,
  lamp: false,
  sling: false,
  item: -1,
  cairn: false,
  pack: null,
  trade: null,
  dialogue: null,
  camYaw,
});

const DEADZONE = 0.15;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

// Standard gamepad mapping indices.
const GP = { A: 0, LB: 4, RB: 5, LT: 6, RT: 7, L3: 10 } as const;

/** Holding the wheel this briefly (and not aiming) repeats the last command. */
const TAP_SECONDS = 0.22;

export interface WheelState {
  open: boolean;
  /** Highlighted slot index into COMMANDS, or -1 for none (centre). */
  slot: number;
  /** Selection vector, screen space (x right, y down), length 0..1. */
  selX: number;
  selY: number;
}

export class Input {
  private keys = new Set<string>();
  private latched = { takeVehicle: false, crook: false, call: false, interact: false, rest: false, water: false, kick: false, horn: false, lamp: false, sling: false };
  private latchedItem = -1;
  private latchedPack: ItemId[] | null = null;
  private latchedTrade: TradeRequest | null = null;
  private latchedDialogue: DialogueChoice | null = null;
  dialogueControls: { move: (direction: number) => void; select: () => DialogueChoice | undefined } | null = null;
  /** Gamepad: the satchel slot Y uses (D-pad right taps cycle it). */
  selectedSlot = 0;
  private padRightTicks = 0;
  /** Held: read the land (G / D-pad left). A view effect only, not simulation input. */
  readLand = false;
  /** A paper card (packing) has the number keys. */
  uiCapture = false;
  /** Keyboard ramps (GDD: keyboard input ramped over 0.25 s to fake analog). */
  private ramp = { throttle: 0, brake: 0, steer: 0 };
  private shiftAlt = 0;
  /** Set by the game each frame: changes what the gamepad's A button does. */
  riding = false;
  private aHeldTicks = 0;
  private lookDX = 0;
  private lookDY = 0;
  private prevPad: boolean[] = [];
  private latchedCommand: DogCommand | null = null;
  lastCommand: DogCommand | null = null;
  readonly wheel: WheelState = { open: false, slot: -1, selX: 0, selY: 0 };
  private wheelOpenedAt = 0;
  private wheelFromPad = false;
  pointerLocked = false;
  /** Set once the camera has been moved by mouse or drag (the "how to look" hint can go). */
  looked = false;
  /** 'keyboard' | 'gamepad' — whichever was used last (for UI hints). */
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      if (e.code === 'KeyY' && !this.uiCapture) this.latched.takeVehicle = true;
      if (e.code === 'KeyE') this.latched.interact = true;
      if (e.code === 'KeyN') this.latched.rest = true;
      if (e.code === 'KeyR') this.latched.water = true;
      if (e.code === 'KeyQ') this.openWheel(false);
      if (e.code === 'Space') this.latched.kick = true;
      if (e.code === 'KeyH') this.latched.horn = true;
      if (e.code === 'KeyF') this.latched.lamp = true;
      if (e.code === 'KeyV') this.latched.sling = true;
      if (!this.uiCapture && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) this.latchedItem = Number(e.code.slice(5)) - 1;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyQ' && this.wheel.open && !this.wheelFromPad) this.closeWheel();
    });
    window.addEventListener('blur', () => this.keys.clear());

    // Pointer lock where the browser allows it. Embedded views (e.g. an app's preview
    // pane) can refuse it; then we fall back to drag-to-look, and a click without a drag
    // is the action.
    const lockFailed = () => {
      this.lockAvailable = false;
      document.body.classList.add('nolock');
    };
    canvas.addEventListener('click', () => {
      if (this.pointerLocked || !this.lockAvailable) return;
      try {
        const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        r?.catch?.(lockFailed);
      } catch {
        lockFailed();
      }
    });
    document.addEventListener('pointerlockerror', lockFailed);
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener('mousedown', (e) => {
      this.lastDevice = 'keyboard';
      if (this.pointerLocked) {
        if (e.button === 0) this.latched.crook = true;
        if (e.button === 2) this.latched.call = true;
        return;
      }
      // Unlocked: the click that captures the mouse is not an action; without lock, wait
      // for mouseup to tell a click from a drag.
      this.drag = { button: e.button, moved: 0 };
    });
    window.addEventListener('mouseup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || this.pointerLocked || this.lockAvailable || d.moved > 6 || d.button !== e.button) return;
      if (e.button === 0) this.latched.crook = true;
      if (e.button === 2) this.latched.call = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.wheel.open && !this.wheelFromPad) {
        this.moveWheel(e.movementX / 120, e.movementY / 120);
        return;
      }
      if (this.keys.has('AltLeft') || this.keys.has('AltRight')) {
        // Alt + mouse Y: shift your weight on the bike (forward = mouse up).
        this.shiftAlt = Math.max(-1, Math.min(1, this.shiftAlt - e.movementY / 150));
        return;
      }
      if (this.pointerLocked) {
        this.looked = true;
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      } else if (this.drag && !this.lockAvailable) {
        this.drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (this.drag.moved > 6) {
          this.looked = true;
          this.lookDX += e.movementX;
          this.lookDY += e.movementY;
        }
      }
    });
  }

  /** False once the browser refused pointer lock (drag-to-look mode). */
  lockAvailable = true;
  private drag: { button: number; moved: number } | null = null;

  private openWheel(fromPad: boolean): void {
    if (this.wheel.open) return;
    Object.assign(this.wheel, { open: true, slot: -1, selX: 0, selY: 0 });
    this.wheelOpenedAt = performance.now();
    this.wheelFromPad = fromPad;
  }

  private moveWheel(dx: number, dy: number, absolute = false): void {
    const w = this.wheel;
    if (absolute) {
      w.selX = dx;
      w.selY = dy;
    } else {
      w.selX += dx;
      w.selY += dy;
    }
    const l = Math.hypot(w.selX, w.selY);
    if (l > 1) {
      w.selX /= l;
      w.selY /= l;
    }
    if (l < 0.35) {
      if (!absolute) return; // keep the last pick while the mouse drifts back
      w.slot = -1;
      return;
    }
    // Slots clockwise from the top.
    const ang = (Math.atan2(w.selX, -w.selY) + Math.PI * 2) % (Math.PI * 2);
    w.slot = Math.round(ang / ((Math.PI * 2) / COMMANDS.length)) % COMMANDS.length;
  }

  private closeWheel(): void {
    const w = this.wheel;
    const quick = (performance.now() - this.wheelOpenedAt) / 1000 < TAP_SECONDS;
    if (w.slot >= 0) this.latchedCommand = COMMANDS[w.slot].id;
    else if (quick && this.lastCommand) this.latchedCommand = this.lastCommand; // tap = repeat
    if (this.latchedCommand) this.lastCommand = this.latchedCommand;
    w.open = false;
  }

  /**
   * Forget everything held or pressed (the pause menu opening or closing): no key stays
   * stuck down, no press made in the menu fires in the world, the wheel closes unpicked.
   */
  releaseAll(): void {
    this.keys.clear();
    const latched: Record<string, boolean> = this.latched;
    for (const k of Object.keys(latched)) latched[k] = false;
    this.latchedItem = -1;
    this.latchedDialogue = null;
    this.latchedCommand = null;
    this.wheel.open = false;
    this.lookDX = this.lookDY = 0;
    this.drag = null;
    const p = this.pad();
    this.prevPad = p ? p.buttons.map((b) => b.pressed) : [];
  }

  /** The shop card asks for a trade (applied on the next sim tick). */
  requestTrade(t: TradeRequest): void {
    this.latchedTrade = t;
  }

  requestDialogue(choice: DialogueChoice): void {
    this.latchedDialogue = choice;
  }

  /** The packing card asks to repack the satchel (applied on the next sim tick). */
  requestPack(items: ItemId[]): void {
    this.latchedPack = [...items];
  }

  /** True while the wheel is open (the game slows to half speed). */
  get wheelOpen(): boolean {
    return this.wheel.open;
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Mouse look accumulated since the last call (pixels), consumed by the camera. */
  consumeMouseLook(): { dx: number; dy: number } {
    const out = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return out;
  }

  /** Right-stick look, -1..1 per axis (deadzoned). */
  stickLook(): { x: number; y: number } {
    const p = this.pad();
    if (!p || (this.wheel.open && this.wheelFromPad)) return { x: 0, y: 0 };
    return { x: dz(p.axes[2] ?? 0), y: dz(p.axes[3] ?? 0) };
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Called once per simulation tick. Clears edge-triggered latches. */
  sampleFrame(camYaw: number): InputFrame {
    const f = emptyFrame(camYaw);

    // Keyboard
    let kx = 0;
    let ky = 0;
    if (this.down('KeyW', 'ArrowUp')) ky += 1;
    if (this.down('KeyS', 'ArrowDown')) ky -= 1;
    if (this.down('KeyD', 'ArrowRight')) kx += 1;
    if (this.down('KeyA', 'ArrowLeft')) kx -= 1;
    const kl = Math.hypot(kx, ky);
    if (kl > 0) {
      f.moveX = kx / kl;
      f.moveY = ky / kl;
    }
    f.sprint = this.down('ShiftLeft', 'ShiftRight');
    // Ctrl is the GDD binding; C is offered because browsers reserve Ctrl+W.
    f.sneak = this.down('ControlLeft', 'ControlRight', 'KeyC');
    f.interactHeld = this.down('KeyE');
    f.bikeWork = this.down('KeyR');
    f.hush = this.down('KeyX');
    f.cairn = this.down('KeyB');
    this.readLand = this.down('KeyG');

    // Riding controls from the keyboard, ramped.
    const k = 1 / 60 / 0.25;
    const toward = (v: number, t: number) => (v < t ? Math.min(t, v + k) : Math.max(t, v - k));
    this.ramp.throttle = toward(this.ramp.throttle, this.down('KeyW', 'ArrowUp') ? 1 : 0);
    this.ramp.brake = toward(this.ramp.brake, this.down('KeyS', 'ArrowDown') ? 1 : 0);
    this.ramp.steer = toward(this.ramp.steer, (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0));
    f.throttle = this.ramp.throttle;
    f.brake = this.ramp.brake;
    f.steer = this.ramp.steer;
    if (!this.keys.has('AltLeft') && !this.keys.has('AltRight')) this.shiftAlt *= 0.9; // eases back when Alt is released
    f.weightShift = this.shiftAlt;

    // Gamepad (overrides keyboard movement when the stick is used)
    const p = this.pad();
    if (p) {
      const sx = dz(p.axes[0] ?? 0);
      const sy = -dz(p.axes[1] ?? 0);
      const mag = Math.min(1, Math.hypot(sx, sy));
      const btn = (i: number) => !!p.buttons[i]?.pressed;
      const edge = (i: number) => btn(i) && !this.prevPad[i];
      if (mag > 0) {
        this.lastDevice = 'gamepad';
        f.moveX = sx;
        f.moveY = sy;
        f.sneak = f.sneak || mag < config.player.sneakStickThreshold;
      }
      if (btn(GP.L3)) f.sprint = true;
      if (btn(11)) f.hush = true; // R3
      // Riding: analog triggers, left stick steers, right stick shifts weight.
      const rt = p.buttons[GP.RT]?.value ?? 0;
      const lt = p.buttons[GP.LT]?.value ?? 0;
      if (rt > 0.02) f.throttle = rt;
      if (lt > 0.02) f.brake = lt;
      if (Math.abs(sx) > 0) f.steer = sx;
      const ry = dz(p.axes[3] ?? 0);
      if (ry !== 0 && !(this.wheel.open && this.wheelFromPad)) f.weightShift = -ry;
      const dialogue = this.dialogueControls;
      if (dialogue) {
        if (edge(12) || edge(13)) {
          this.lastDevice = 'gamepad';
          dialogue.move(edge(12) ? -1 : 1);
        }
        if (edge(1)) this.latchedDialogue = 'leave';
      } else {
        if (edge(1)) {
          if (this.riding) this.latched.horn = true;
          else this.latched.takeVehicle = true;
        } // B / Circle
        if (edge(12)) this.latched.lamp = true; // D-pad up
      }
      if (edge(GP.RB)) this.latched.water = true;
      if (btn(GP.RB)) f.bikeWork = true;
      if (edge(2)) this.latched.sling = true; // X / Square
      if (edge(3)) this.latchedItem = this.selectedSlot; // Y / Triangle
      if (btn(14)) this.readLand = true; // D-pad left
      // D-pad right: tap = next satchel slot, hold = stack a cairn.
      if (btn(15)) {
        this.padRightTicks++;
        if (this.padRightTicks > 15) f.cairn = true;
      } else {
        if (this.padRightTicks > 0 && this.padRightTicks <= 15) this.selectedSlot = (this.selectedSlot + 1) % 3;
        this.padRightTicks = 0;
      }
      if (edge(GP.RT)) this.latched.crook = true;
      if (edge(GP.LT)) this.latched.call = true;
      // A: on foot, interact (hold = free a sheep). Riding: tap = kick-start, hold 0.6 s = get off.
      if (this.riding) {
        if (edge(GP.A)) this.latched.kick = true;
        this.aHeldTicks = btn(GP.A) ? this.aHeldTicks + 1 : 0;
        if (this.aHeldTicks === 36) this.latched.interact = true;
      } else {
        if (edge(GP.A)) {
          this.lastDevice = 'gamepad';
          this.latched.interact = true;
          this.latchedDialogue ??= dialogue?.select() ?? null;
        }
        if (btn(GP.A)) f.interactHeld = true;
      }
      // LB held = whistle wheel, right stick picks.
      if (edge(GP.LB)) this.openWheel(true);
      if (this.wheel.open && this.wheelFromPad) {
        this.moveWheel(p.axes[2] ?? 0, p.axes[3] ?? 0, true);
        if (!btn(GP.LB)) this.closeWheel();
      }
      this.prevPad = p.buttons.map((b) => b.pressed);
    }

    f.command = this.latchedCommand;
    this.latchedCommand = null;
    f.takeVehicle = this.latched.takeVehicle;
    this.latched.takeVehicle = false;
    f.kick = this.latched.kick;
    f.horn = this.latched.horn;
    f.lamp = this.latched.lamp;
    f.sling = this.latched.sling;
    f.item = this.latchedItem;
    f.pack = this.latchedPack;
    f.trade = this.latchedTrade;
    this.latchedTrade = null;
    f.dialogue = this.latchedDialogue;
    this.latchedDialogue = null;
    this.latched.kick = this.latched.horn = this.latched.lamp = this.latched.sling = false;
    this.latchedItem = -1;
    this.latchedPack = null;
    f.crook = this.latched.crook;
    f.call = this.latched.call;
    f.interact = this.latched.interact;
    f.rest = this.latched.rest;
    f.water = this.latched.water;
    this.latched.crook = this.latched.call = this.latched.interact = this.latched.rest = this.latched.water = false;
    return f;
  }
}

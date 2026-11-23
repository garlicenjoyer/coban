// The coach: teaches the controls at the moment they are needed, by doing, one at a time.
//
// It is view-side only: it reads the simulation and the input but never changes them, so
// replays, saves and tests are untouched. The rules it follows:
//   - Just in time. A control is shown when the situation asks for it (the flock is near
//     and not following → call; a straggler won't go in → crook; a task needs Karabaş →
//     the whistle wheel), never as a list up front.
//   - Learn by doing. A card stays until the player does the thing, then confirms it
//     (a check and a short "that's it" line) and gets out of the way.
//   - One thing at a time, with a breath between cards. Nothing while a menu, card or the
//     map is open; side tools (map, notebook, watch) wait for calm moments like grazing.
//   - Scaffold, then fade. Each lesson is "learned" after a few uses; after that it only
//     comes back as a small reminder if the player seems stuck for a while.
//   - Explain mistakes, with the why: the crook drives sheep away (call to lead them); the
//     call carries 15 m; the wheel needs a flick before letting go; a dog who ignores you
//     needs more bond.
//   - Remembered across sessions, and can be turned off or reset (Esc › Options).

import { config, GOLDEN_HOUR, SUNSET_HOUR } from '../core/config';
import type { DogCommand } from '../dog/commands';
import { commandInfo, COMMANDS } from '../dog/commands';
import type { Sim } from '../sim';

export type Device = 'keyboard' | 'gamepad';

/** What to draw beside the words: a mouse with one button lit, or keycaps. */
export type Glyph = { kind: 'mouse'; button: 'left' | 'right' } | { kind: 'keys'; keys: string[]; hold?: boolean };

export interface CoachContext {
  sim: Sim;
  device: Device;
  /** Real seconds since the last update. */
  dt: number;
  /** A menu, card or the map has the screen: the coach waits. */
  blocked: boolean;
  wheelOpen: boolean;
  /** Highlighted wheel slot (index into COMMANDS), -1 for none. */
  wheelSlot: number;
  lastCommand: DogCommand | null;
  mapOpen: boolean;
  watchUp: boolean;
  journalOpen: boolean;
}

export interface CoachCard {
  id: string;
  glyph: Glyph;
  title: string;
  body?: string;
  /** 'show' while waiting for the player; 'done' for the brief confirmation. */
  phase: 'show' | 'done';
  /** A reminder (or a card that has been up a while): glyph and title only. */
  compact: boolean;
  /** A correction after a mistake, not a lesson. */
  notice: boolean;
}

/** Help drawn inside the whistle wheel while it is open. */
export interface WheelGuide {
  command: DogCommand;
  /** First times: pulse the slot and point at it. Later only after a mistake. */
  strong: boolean;
}

/** Where the coach keeps what it has taught (localStorage in the game, a stub in tests). */
export interface CoachStorage {
  load(): string | null;
  save(data: string): void;
}

interface Memory {
  /** Times each lesson has been practised (or each notice shown). */
  n: Record<string, number>;
  off: boolean;
}

interface Lesson {
  id: string;
  /** Higher wins when several are needed at once. */
  priority: number;
  /** Uses until it is learned and only comes back as a reminder. */
  learnAfter: number;
  /** Seconds the need must last before the first showing (a moment to try unaided). */
  delay?: number;
  /** Once learned: seconds of unanswered need before a reminder (Infinity: never). */
  remindAfter?: number;
  needed(c: CoachContext, k: Coach): boolean;
  glyph(d: Device): Glyph;
  title(c: CoachContext, k: Coach): string;
  body?(c: CoachContext, k: Coach): string;
  /** The confirmation line when it's done. */
  done: string;
  /** Polled practice (for things with no event): true while the player is doing it. */
  doing?(c: CoachContext): boolean;
}

const LEAD_TASKS = new Set(['leadOut', 'pastureA', 'home', 'rejoin', 'toB', 'fold', 'night']);
/** Which whistle each guided task asks for. */
const TASK_COMMAND: Record<string, DogCommand> = { gather: 'gather', hold: 'hold', lost: 'search', wolf: 'attack' };
const CALM_TASKS = new Set(['graze']);

const ARROW_WORDS = ['at the top', 'up and to the right', 'down and to the right', 'down and to the left', 'up and to the left'];
/** "at the top" etc. for a command's slot on the wheel. */
export const slotWhere = (cmd: DogCommand) => ARROW_WORDS[COMMANDS.findIndex((c) => c.id === cmd)] ?? '';

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const taskId = (sim: Sim) => (sim.tasks.enabled && !sim.tasks.finished ? (sim.tasks.task?.id ?? null) : null);
const pad = (d: Device) => d === 'gamepad';

/** The whistle the current task needs, while the dog isn't already doing it. */
export function neededCommand(sim: Sim): DogCommand | null {
  const id = taskId(sim);
  const cmd = id ? TASK_COMMAND[id] : undefined;
  if (!cmd || sim.riding) return null;
  const d = sim.dog;
  if (d.command === cmd || d.pending?.command === cmd) return null;
  if (cmd === 'attack' && !sim.wolves.list.some((w) => w.kind === 'flock' && w.state !== 'flee')) return null;
  return cmd;
}

/** Sheep near the shepherd that aren't following: the moment to call. */
function flockNotFollowing(sim: Sim): boolean {
  const id = taskId(sim);
  if (!id || !LEAD_TASKS.has(id) || sim.riding) return false;
  if (id === 'leadOut' && !sim.gateOpen) return false;
  const p = sim.player.pos;
  const r = config.player.callRadius;
  let near = 0;
  let following = 0;
  for (const s of sim.flock.sheep) {
    if (dist(s.x, s.z, p.x, p.z) > r) continue;
    near++;
    if (s.callTimer > 0) following++;
  }
  if (near < 3 || following / near > 0.3) return false;
  // Already where they should be: nothing to lead.
  const tg = sim.tasks.current.target;
  if (tg && id !== 'home' && id !== 'fold' && id !== 'night' && dist(sim.flock.centroid.x, sim.flock.centroid.z, tg.x, tg.z) < 20) return false;
  if ((id === 'home' || id === 'night') && sim.sheepInPen === sim.flock.sheep.length) return false;
  return true;
}

/** A sheep that needs pushing: a straggler at the pen, or one left inside on the way out. */
function stragglerNear(sim: Sim): boolean {
  const id = taskId(sim);
  if (!id || sim.riding) return false;
  const p = sim.player.pos;
  const sheep = sim.flock.sheep;
  const n = sheep.length;
  if (id === 'home' || id === 'night') {
    if (!sim.gateOpen || dist(p.x, p.z, sim.gatePos.x, sim.gatePos.z) > 22) return false;
    const inPen = sim.sheepInPen;
    return inPen >= n / 2 && inPen < n && sheep.some((s) => !s.inPen && dist(s.x, s.z, p.x, p.z) < 10);
  }
  if (id === 'leadOut') {
    const inside = sheep.filter((s) => s.inPen);
    return sim.tasks.state.t > 20 && inside.length > 0 && inside.length <= 4 && inside.some((s) => dist(s.x, s.z, p.x, p.z) < 12);
  }
  return false;
}

function stressedNear(sim: Sim): boolean {
  if (sim.riding || sim.hushing) return false;
  const p = sim.player.pos;
  let jumpy = 0;
  for (const s of sim.flock.sheep) if (s.stress > 45 && !s.inPen && dist(s.x, s.z, p.x, p.z) < config.night.hushRadius) jumpy++;
  return jumpy >= 4;
}

function targetDistance(sim: Sim): number {
  const tg = sim.tasks.current.target;
  if (!tg || !taskId(sim)) return 0;
  return dist(tg.x, tg.z, sim.player.pos.x, sim.player.pos.z);
}

function wolfNear(sim: Sim, r: number): boolean {
  const p = sim.player.pos;
  return sim.wolves.list.some((w) => w.kind === 'flock' && w.state !== 'flee' && dist(w.x, w.z, p.x, p.z) < r);
}

const LESSONS: Lesson[] = [
  {
    id: 'move',
    priority: 100,
    learnAfter: 1,
    delay: 3,
    remindAfter: Infinity,
    needed: (c, k) => !c.sim.riding && k.walked < 4,
    glyph: (d) => (pad(d) ? { kind: 'keys', keys: ['Left stick'] } : { kind: 'keys', keys: ['W', 'A', 'S', 'D'] }),
    title: () => 'Walk',
    body: (c) => (pad(c.device) ? 'Tilt lightly to sneak, push fully to walk.' : 'The arrow keys work too.'),
    done: 'That’s it. The task card (top left) says where to go.',
  },
  {
    // The whistle wheel: hold, flick toward the word, let go. Inside the wheel the slot is lit.
    id: 'wheel',
    priority: 90,
    learnAfter: 2,
    delay: 0.5,
    remindAfter: 12,
    needed: (c, k) => !!neededCommand(c.sim) && !k.repeatWanted(c),
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'LB' : 'Q'], hold: true }),
    title: (c) => {
      const cmd = commandInfo(neededCommand(c.sim) ?? 'gather');
      return `Whistle “${cmd.turkish}” (${cmd.english})`;
    },
    body: (c) => {
      const cmd = neededCommand(c.sim) ?? 'gather';
      return `Hold ${pad(c.device) ? 'LB' : 'Q'}, ${pad(c.device) ? 'push the right stick' : 'move the mouse'} ${slotWhere(cmd)} to ${commandInfo(cmd).turkish}, then let go.`;
    },
    done: 'Karabaş heard you.',
  },
  {
    // The same whistle again: a quick tap repeats it.
    id: 'repeat',
    priority: 91,
    learnAfter: 1,
    delay: 1,
    remindAfter: Infinity,
    needed: (c, k) => k.repeatWanted(c),
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'LB' : 'Q'] }),
    title: (c) => `Tap to whistle “${commandInfo(neededCommand(c.sim) ?? 'gather').turkish}” again`,
    body: () => 'A quick tap repeats the last whistle: no need to pick it from the wheel.',
    done: 'Same whistle, half the time.',
  },
  {
    id: 'praise',
    priority: 85,
    learnAfter: 2,
    delay: 0,
    remindAfter: Infinity,
    needed: (c) => c.sim.dog.praiseTimer > 0 && !c.sim.riding,
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'A' : 'E'] }),
    title: () => 'Praise Karabaş, quick!',
    body: () => 'He’s proud of that one. Praise beside him now: a stronger bond makes him answer faster.',
    done: 'Good dog. The bond grows.',
  },
  {
    id: 'sling',
    priority: 80,
    learnAfter: 1,
    delay: 1,
    remindAfter: 10,
    needed: (c) => !c.sim.riding && wolfNear(c.sim, 40),
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'X' : 'V'] }),
    title: () => 'Throw a sling stone',
    body: () => 'It flies where you’re looking. A hit sends a wolf running.',
    done: 'Keep the flock behind you.',
  },
  {
    id: 'crook',
    priority: 70,
    learnAfter: 2,
    delay: 1.5,
    remindAfter: 20,
    needed: (c) => stragglerNear(c.sim),
    glyph: (d) => (pad(d) ? { kind: 'keys', keys: ['RT'] } : { kind: 'mouse', button: 'left' }),
    title: () => 'Swing the crook',
    body: () => 'It pushes sheep in front of you (6 m) away from you. Step behind a straggler and drive it where it should go.',
    done: 'A nudge, not a shove: too many swings frighten them.',
  },
  {
    id: 'call',
    priority: 65,
    learnAfter: 3,
    delay: 1.5,
    remindAfter: 25,
    needed: (c) => flockNotFollowing(c.sim),
    glyph: (d) => (pad(d) ? { kind: 'keys', keys: ['LT'] } : { kind: 'mouse', button: 'right' }),
    title: () => 'Call the flock: “brrr-hey”',
    body: () => 'Sheep within 15 m follow you for a while. Then walk, slowly, where you want them; call again when they slow.',
    done: 'They heard you. Walk on, and don’t rush them.',
  },
  {
    id: 'hush',
    priority: 60,
    learnAfter: 1,
    delay: 2,
    remindAfter: 15,
    needed: (c) => stressedNear(c.sim),
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'R3' : 'X'], hold: true }),
    title: () => 'Hush the flock',
    body: () => 'They’re jumpy. Hold to stand still and quiet; they settle round you.',
    done: 'Easy now. Calm sheep stay together.',
    doing: (c) => c.sim.hushing,
  },
  {
    id: 'sprint',
    priority: 40,
    learnAfter: 1,
    delay: 6,
    remindAfter: Infinity,
    needed: (c) =>
      !c.sim.riding &&
      c.sim.player.gait === 'walk' &&
      targetDistance(c.sim) > 90 &&
      dist(c.sim.flock.centroid.x, c.sim.flock.centroid.z, c.sim.player.pos.x, c.sim.player.pos.z) > 30,
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'L3' : 'Shift'], hold: !pad(d) }),
    title: () => 'Run',
    body: () => 'Running spooks sheep: walk when you’re near the flock.',
    done: 'Slow down again near the sheep.',
    doing: (c) => c.sim.player.gait === 'sprint',
  },
  {
    id: 'map',
    priority: 30,
    learnAfter: 1,
    delay: 4,
    remindAfter: Infinity,
    needed: (c) => !c.sim.riding && (targetDistance(c.sim) > 140 || (CALM_TASKS.has(taskId(c.sim) ?? '') && c.sim.tasks.state.t > 6)),
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'View' : 'M'] }),
    title: () => 'Unfold Uncle Ahmet’s map',
    body: () => 'Pastures, paths, water, and where you stand.',
    done: 'Press it again to fold it away.',
    doing: (c) => c.mapOpen,
  },
  {
    id: 'journal',
    priority: 25,
    learnAfter: 1,
    delay: 2,
    remindAfter: Infinity,
    needed: (c) => !pad(c.device) && !c.sim.riding && CALM_TASKS.has(taskId(c.sim) ?? '') && c.sim.tasks.state.t > 14,
    glyph: () => ({ kind: 'keys', keys: ['J'] }),
    title: () => 'Open your notebook',
    body: () => 'Today’s tasks, how the flock and Karabaş are doing, and your purse.',
    done: 'J again to close it.',
    doing: (c) => c.journalOpen,
  },
  {
    id: 'watch',
    priority: 20,
    learnAfter: 1,
    delay: 2,
    remindAfter: Infinity,
    needed: (c) =>
      !c.sim.riding &&
      !!taskId(c.sim) &&
      ((c.sim.hour >= GOLDEN_HOUR - 1 && c.sim.hour < SUNSET_HOUR) || (CALM_TASKS.has(taskId(c.sim) ?? '') && c.sim.tasks.state.t > 24)),
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'D-pad ↓' : 'T'], hold: true }),
    title: () => 'Check your pocket watch',
    body: () => 'The orange arc is the last hour before sunset: be home by then.',
    done: 'Let go to put it away.',
    doing: (c) => c.watchUp,
  },
];

/** Corrections, shown on a mistake; each at most `max` times ever. */
interface Notice {
  id: string;
  max: number;
  glyph(d: Device): Glyph;
  title: string;
  body(d: Device): string;
}

const NOTICES: Record<string, Notice> = {
  crookAway: {
    id: 'crookAway',
    max: 2,
    glyph: (d) => (pad(d) ? { kind: 'keys', keys: ['LT'] } : { kind: 'mouse', button: 'right' }),
    title: 'The crook drives sheep away from you',
    body: () => 'To lead them, call instead: they follow the voice.',
  },
  callRange: {
    id: 'callRange',
    max: 2,
    glyph: (d) => (pad(d) ? { kind: 'keys', keys: ['LT'] } : { kind: 'mouse', button: 'right' }),
    title: 'Too far: nobody heard the call',
    body: () => 'The call carries 15 m. Walk back to the flock and call from among them.',
  },
  wheelEmpty: {
    id: 'wheelEmpty',
    max: 3,
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'LB' : 'Q'], hold: true }),
    title: 'Nothing was whistled',
    body: (d) => `Keep holding, ${pad(d) ? 'push the right stick' : 'move the mouse'} toward a word until it lights up, then let go.`,
  },
  wrongCommand: {
    id: 'wrongCommand',
    max: 4,
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'LB' : 'Q'], hold: true }),
    title: '',
    body: () => '',
  },
  ignored: {
    id: 'ignored',
    max: 3,
    glyph: (d) => ({ kind: 'keys', keys: [pad(d) ? 'A' : 'E'] }),
    title: 'He looked, and ignored you',
    body: () => 'The bond is too weak yet. Pet him, praise him after good work, keep him fed; then try again.',
  },
};

const DONE_SECONDS = 1.9;
const NOTICE_SECONDS = 5.5;
const BREATH_SECONDS = 2.5;
const STORE_KEY = 'coban.coach.v1';

export const browserStorage: CoachStorage = {
  load: () => {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  },
  save: (d) => {
    try {
      localStorage.setItem(STORE_KEY, d);
    } catch {
      /* it just won't remember */
    }
  },
};

interface Active {
  lesson: Lesson | null;
  card: CoachCard;
  /** Seconds left (done phase / notices). */
  left: number;
  shownFor: number;
  /** Seconds the need has been gone. */
  gone: number;
  reminder: boolean;
}

export class Coach {
  private mem: Memory = { n: {}, off: false };
  private time = 0;
  private active: Active | null = null;
  private quietUntil = 0;
  private needFor: Record<string, number> = {};
  private lastPractice: Record<string, number> = {};
  private lastShown: Record<string, number> = {};
  private doingFor: Record<string, number> = {};
  /** Metres walked since the coach started (for the first lesson). */
  walked = 0;
  private lastPos: { x: number; z: number } | null = null;
  private ctx: CoachContext | null = null;
  // The wheel, watched from outside the sim: when it opened, and what followed its closing.
  private wheelWasOpen = false;
  private wheelHeld = 0;
  private closeCheckAt = -1;
  private commandSinceOpen = false;
  private guidedWrong: DogCommand | null = null;
  private unsub: (() => void)[] = [];

  constructor(private storage: CoachStorage = browserStorage) {
    try {
      const m = JSON.parse(storage.load() ?? 'null') as Partial<Memory> | null;
      if (m && typeof m === 'object') this.mem = { n: { ...(m.n ?? {}) }, off: !!m.off };
    } catch {
      /* start fresh */
    }
  }

  /** Listen to the game's events (once; the bus outlives sim resets). */
  attach(events: Sim['events'], sim: () => Sim): void {
    const u = this.unsub;
    u.push(
      events.on('call', (e) => {
        this.practised('call');
        const s = sim();
        const heard = s.flock.sheep.some((sh) => dist(sh.x, sh.z, e.origin.x, e.origin.z) < e.radius);
        if (!heard && LEAD_TASKS.has(taskId(s) ?? '') && !s.riding) this.notice('callRange');
      }),
      events.on('crookWave', (e) => {
        this.practised('crook');
        const s = sim();
        const id = taskId(s);
        if ((id === 'leadOut' || id === 'pastureA') && (this.mem.n.call ?? 0) < 5) {
          const reach = e.range + 1;
          if (s.flock.sheep.some((sh) => !sh.inPen && dist(sh.x, sh.z, e.origin.x, e.origin.z) < reach)) this.notice('crookAway');
        }
      }),
      events.on('dogCommand', (e) => {
        this.commandSinceOpen = true;
        const s = sim();
        // A quick tap that repeated the last whistle.
        if (this.wheelHeld > 0 && this.wheelHeld < 0.3) this.practised('repeat');
        const want = TASK_COMMAND[taskId(s) ?? ''];
        if (want && e.command !== want && !(s.dog.command === want)) {
          this.guidedWrong = want;
          this.wrongCommand(e.command, want);
          return;
        }
        this.guidedWrong = null;
        this.practised('wheel');
        this.practised(`cmd:${e.command}`);
      }),
      events.on('dogAck', (e) => {
        if (!e.willObey) this.notice('ignored');
      }),
      events.on('dogPetted', (e) => {
        if (e.praise) this.practised('praise');
      }),
      events.on('slingThrow', () => this.practised('sling')),
    );
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }

  get enabled(): boolean {
    return !this.mem.off;
  }

  set enabled(on: boolean) {
    this.mem.off = !on;
    if (!on) this.active = null;
    this.persist();
  }

  /** Forget everything taught: every lesson shows again from the start. */
  reset(): void {
    this.mem.n = {};
    this.active = null;
    this.needFor = {};
    this.lastPractice = {};
    this.lastShown = {};
    this.walked = 0;
    this.persist();
  }

  /** How many times a lesson has been practised. */
  count(id: string): number {
    return this.mem.n[id] ?? 0;
  }

  learned(id: string): boolean {
    const l = LESSONS.find((x) => x.id === id);
    return this.count(id) >= (l?.learnAfter ?? 1);
  }

  /** The same whistle is needed again and the wheel is known: teach the tap. */
  repeatWanted(c: CoachContext): boolean {
    const cmd = neededCommand(c.sim);
    return !!cmd && c.lastCommand === cmd && this.learned('wheel') && !this.learned('repeat');
  }

  get card(): CoachCard | null {
    return this.mem.off ? null : (this.active?.card ?? null);
  }

  /** What the open wheel should point at, if anything. */
  wheelGuide(): WheelGuide | null {
    const c = this.ctx;
    if (this.mem.off || !c || !c.wheelOpen) return null;
    const cmd = neededCommand(c.sim);
    if (!cmd) return null;
    const firstTimes = this.count(`cmd:${cmd}`) < 1;
    if (firstTimes || this.guidedWrong === cmd) return { command: cmd, strong: true };
    return null;
  }

  update(c: CoachContext): void {
    c = { ...c, dt: Math.max(0, Math.min(c.dt, 0.25)) };
    this.ctx = c;
    if (this.mem.off) return;
    const dt = c.blocked ? 0 : c.dt;
    this.time += dt;
    const sim = c.sim;

    // Walking, measured here (the sim has no odometer for feet).
    const p = sim.player.pos;
    if (this.lastPos && !sim.riding) this.walked += Math.min(2, dist(p.x, p.z, this.lastPos.x, this.lastPos.z));
    this.lastPos = { x: p.x, z: p.z };
    if (this.walked >= 6 && this.count('move') < 1) this.practised('move');

    this.watchWheel(c);

    // Polled practice: holding X, running, the map, the notebook, the watch.
    for (const l of LESSONS) {
      if (!l.doing) continue;
      if (l.doing(c)) {
        this.doingFor[l.id] = (this.doingFor[l.id] ?? 0) + c.dt;
        if (this.doingFor[l.id] >= 0.4 && this.doingFor[l.id] - c.dt < 0.4) this.practised(l.id);
      } else this.doingFor[l.id] = 0;
    }

    for (const l of LESSONS) {
      const need = !c.blocked && l.needed(c, this);
      this.needFor[l.id] = need ? (this.needFor[l.id] ?? 0) + dt : 0;
    }

    const a = this.active;
    if (a) {
      if (a.card.phase === 'done' || a.card.notice) {
        a.left -= c.dt;
        if (a.left <= 0) this.clear();
      } else if (a.lesson) {
        a.shownFor += dt;
        const still = !c.blocked && a.lesson.needed(c, this);
        a.gone = still ? 0 : a.gone + c.dt;
        if (a.gone > 0.8) this.clear(1);
        else {
          // Refresh the words (the target command, the device) and fold it after a while.
          a.card = this.cardFor(a.lesson, c, a.reminder || a.shownFor > 20);
        }
      }
    }

    if (!this.active && this.time >= this.quietUntil && !c.blocked && !c.wheelOpen) {
      const next = this.pick();
      if (next) {
        const reminder = this.learned(next.id);
        this.lastShown[next.id] = this.time;
        this.active = { lesson: next, card: this.cardFor(next, c, reminder), left: 0, shownFor: 0, gone: 0, reminder };
      }
    }
  }

  private pick(): Lesson | null {
    let best: Lesson | null = null;
    for (const l of LESSONS) {
      const need = this.needFor[l.id] ?? 0;
      if (need <= 0) continue;
      if (this.learned(l.id)) {
        const after = l.remindAfter ?? Infinity;
        if (!Number.isFinite(after)) continue;
        if (need < Math.max(after, l.delay ?? 0)) continue;
        if (this.time - (this.lastPractice[l.id] ?? -1e9) < after) continue;
        if (this.time - (this.lastShown[l.id] ?? -1e9) < 60) continue;
      } else if (need < (l.delay ?? 0.8)) continue;
      if (!best || l.priority > best.priority) best = l;
    }
    return best;
  }

  private cardFor(l: Lesson, c: CoachContext, compact: boolean): CoachCard {
    return {
      id: l.id,
      glyph: l.glyph(c.device),
      title: l.title(c, this),
      body: l.body?.(c, this),
      phase: 'show',
      compact,
      notice: false,
    };
  }

  private clear(breath = BREATH_SECONDS): void {
    this.active = null;
    this.quietUntil = this.time + breath;
  }

  private persist(): void {
    this.storage.save(JSON.stringify(this.mem));
  }

  private practised(id: string): void {
    this.mem.n[id] = (this.mem.n[id] ?? 0) + 1;
    this.lastPractice[id] = this.time;
    this.persist();
    const a = this.active;
    if (a && !a.card.notice && a.card.phase === 'show' && a.lesson?.id === id) {
      a.card = { ...a.card, phase: 'done', title: a.lesson.done, body: undefined, compact: true };
      a.left = DONE_SECONDS;
    }
    // A notice about a mistake ends once the right thing is done.
    if (a?.card.notice && ((id === 'call' && a.card.id === 'crookAway') || (id === 'wheel' && (a.card.id === 'wheelEmpty' || a.card.id === 'wrongCommand')))) {
      a.left = Math.min(a.left, 0.6);
    }
  }

  private notice(id: string, title?: string, body?: string): void {
    const n = NOTICES[id];
    if (!n || this.mem.off || this.count(`notice:${id}`) >= n.max) return;
    this.mem.n[`notice:${id}`] = this.count(`notice:${id}`) + 1;
    this.persist();
    const d = this.ctx?.device ?? 'keyboard';
    this.active = {
      lesson: null,
      card: { id, glyph: n.glyph(d), title: title ?? n.title, body: body ?? n.body(d), phase: 'show', compact: false, notice: true },
      left: NOTICE_SECONDS,
      shownFor: 0,
      gone: 0,
      reminder: false,
    };
  }

  private wrongCommand(got: DogCommand, want: DogCommand): void {
    const g = commandInfo(got);
    const w = commandInfo(want);
    const d = this.ctx?.device ?? 'keyboard';
    this.notice('wrongCommand', `That was ${g.turkish} (${g.english})`, `${w.turkish} is ${slotWhere(want)} of the wheel. Hold ${pad(d) ? 'LB' : 'Q'} and try again: it’s lit for you.`);
  }

  /** The wheel closing with nothing picked is the commonest first mistake. */
  private watchWheel(c: CoachContext): void {
    // The whistle reaches the sim (and its event us) before this sees the wheel shut, so
    // "did anything come of it" is counted from the opening, not the closing.
    if (c.wheelOpen && !this.wheelWasOpen) {
      this.wheelHeld = 0;
      this.commandSinceOpen = false;
    }
    if (c.wheelOpen) this.wheelHeld += c.dt;
    if (!c.wheelOpen && this.wheelWasOpen) this.closeCheckAt = this.time + 0.3;
    this.wheelWasOpen = c.wheelOpen;
    if (this.closeCheckAt >= 0 && this.time >= this.closeCheckAt) {
      this.closeCheckAt = -1;
      if (!this.commandSinceOpen && neededCommand(c.sim)) {
        this.guidedWrong = neededCommand(c.sim);
        this.notice('wheelEmpty');
      }
      this.wheelHeld = 0;
    }
  }
}

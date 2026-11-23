// The coach (first-time player teaching): shows a control when the situation needs it,
// confirms it once done, corrects mistakes, fades once learned, and can be turned off.

import { beforeAll, describe, expect, it } from 'vitest';
import { emptyFrame, type InputFrame } from '../src/core/input';
import type { DogCommand } from '../src/dog/commands';
import type { Sim } from '../src/sim';
import { Coach, type CoachContext, type CoachStorage } from '../src/tutorial/coach';
import { initRapier, newSim } from './helpers';

beforeAll(initRapier);

const DT = 1 / 60;

function memStorage(initial: object | null = null): CoachStorage & { data: string | null } {
  const s = {
    data: initial ? JSON.stringify(initial) : null,
    load: () => s.data,
    save: (d: string) => {
      s.data = d;
    },
  };
  return s;
}

interface Rig {
  sim: Sim;
  coach: Coach;
  wheel: { open: boolean; slot: number; last: DogCommand | null };
  /** Step sim and coach together for `secs` seconds. */
  play(secs: number, frame?: (i: number) => Partial<InputFrame>): void;
}

function rig(storage = memStorage()): Rig {
  const sim = newSim();
  const coach = new Coach(storage);
  coach.attach(sim.events, () => sim);
  const wheel = { open: false, slot: -1, last: null as DogCommand | null };
  const ctx = (): CoachContext => ({
    sim,
    device: 'keyboard',
    dt: DT,
    blocked: false,
    wheelOpen: wheel.open,
    wheelSlot: wheel.slot,
    lastCommand: wheel.last,
    mapOpen: false,
    watchUp: false,
    journalOpen: false,
  });
  return {
    sim,
    coach,
    wheel,
    play(secs, frame) {
      const n = Math.round(secs / DT);
      for (let i = 0; i < n; i++) {
        sim.step({ ...emptyFrame(), ...(frame?.(i) ?? {}) });
        coach.update(ctx());
      }
    },
  };
}

/** Advance the day's tasks to the one with this id. */
function skipTo(r: Rig, id: string): void {
  r.play(DT);
  while (r.sim.tasks.task && r.sim.tasks.task.id !== id) r.sim.tasks.skip();
  expect(r.sim.tasks.task?.id).toBe(id);
}

describe('coach', () => {
  it('teaches walking first, and confirms it once the player walks', () => {
    const r = rig();
    r.play(4);
    expect(r.coach.card?.id).toBe('move');
    expect(r.coach.card?.phase).toBe('show');
    r.play(6, () => ({ moveY: 1 }));
    expect(r.coach.count('move')).toBe(1);
  });

  it('shows the call when the flock is near and not following, then confirms it', () => {
    const r = rig(memStorage({ n: { move: 1 } }));
    skipTo(r, 'leadOut');
    r.sim.setGate(true);
    r.sim.teleport(r.sim.gatePos.x + 2, r.sim.gatePos.z);
    r.play(3);
    expect(r.coach.card?.id).toBe('call');
    expect(r.coach.card?.glyph).toEqual({ kind: 'mouse', button: 'right' });
    r.play(DT * 2, (i) => ({ call: i === 0 }));
    expect(r.coach.card?.phase).toBe('done');
    expect(r.coach.count('call')).toBe(1);
  });

  it('corrects using the crook to lead, pointing at the call', () => {
    const r = rig(memStorage({ n: { move: 1 } }));
    skipTo(r, 'leadOut');
    r.sim.setGate(true);
    // Stand among the sheep and swing.
    const s = r.sim.flock.sheep[0];
    s.inPen = false;
    r.sim.teleport(s.x + 1, s.z);
    r.play(DT * 2, (i) => ({ crook: i === 0 }));
    expect(r.coach.card?.notice).toBe(true);
    expect(r.coach.card?.id).toBe('crookAway');
  });

  it('guides the whistle wheel to the task’s command, and corrects a wrong pick', () => {
    const r = rig(memStorage({ n: { move: 1, map: 1, sprint: 1 } }));
    skipTo(r, 'gather');
    r.play(1.5);
    expect(r.coach.card?.id).toBe('wheel');
    expect(r.coach.card?.title).toContain('Topla');

    r.wheel.open = true;
    r.play(0.5);
    expect(r.coach.wheelGuide()).toEqual({ command: 'gather', strong: true });

    // Released on Bekle instead.
    r.wheel.open = false;
    r.play(0.6, (i) => ({ command: i === 0 ? ('hold' as DogCommand) : null }));
    expect(r.coach.card?.id).toBe('wrongCommand');
    expect(r.coach.card?.body).toContain('Topla');

    // And then the right one.
    r.sim.dog.command = null;
    r.play(DT * 2, (i) => ({ command: i === 0 ? ('gather' as DogCommand) : null }));
    expect(r.coach.count('cmd:gather')).toBe(1);
  });

  it('explains a wheel let go with nothing picked', () => {
    const r = rig(memStorage({ n: { move: 1, map: 1, sprint: 1 } }));
    skipTo(r, 'gather');
    r.wheel.open = true;
    r.play(0.6);
    r.wheel.open = false;
    r.play(0.5);
    expect(r.coach.card?.id).toBe('wheelEmpty');
  });

  it('fades once learned: no card at first, a compact reminder only if stuck a while', () => {
    const r = rig(memStorage({ n: { move: 1, call: 3 } }));
    skipTo(r, 'leadOut');
    r.sim.setGate(true);
    r.sim.teleport(r.sim.gatePos.x + 2, r.sim.gatePos.z);
    r.play(5);
    expect(r.coach.card).toBeNull();
    r.play(24);
    expect(r.coach.card?.id).toBe('call');
    expect(r.coach.card?.compact).toBe(true);
  });

  it('remembers across sessions, and stays quiet when turned off', () => {
    const store = memStorage();
    const r = rig(store);
    r.coach.enabled = false;
    r.play(5);
    expect(r.coach.card).toBeNull();
    const again = new Coach(store);
    expect(again.enabled).toBe(false);
    again.enabled = true;
    again.reset();
    expect(again.count('move')).toBe(0);
  });
});

// M2 acceptance, approximated by a scripted shepherd that only uses player inputs:
// open the gate, LEAD the flock to pasture B by calling, lead it home the same way,
// walk the bellwether into the pen, slip out along the fence and close the gate.
// (Driving from behind is covered by tests/flock.test.ts.) The GDD target for a human tester: under 8 minutes,
// at most 2 strays per trip, no permanently stuck sheep.

import { beforeAll, expect, it } from 'vitest';
import { config, SIM_DT } from '../src/core/config';
import { emptyFrame, type InputFrame } from '../src/core/input';
import type { Sim } from '../src/sim';
import { layout } from '../src/world/testMap';
import { initRapier, newSim, yawToward } from './helpers';

beforeAll(initRapier);

/** Set TRACE=1 to print the flock state every 5 s. */
const TRACE = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TRACE;

type Phase = 'open' | 'leadOut' | 'settle' | 'leadHome' | 'pen' | 'exit' | 'close' | 'done';

const B = layout.pastures[1];
const GATE_OUT = { x: layout.pen.x + layout.pen.hx + 1.6, z: layout.pen.z };
const GX = layout.pen.x + layout.pen.hx;
const PEN_BACK = { x: layout.pen.x - layout.pen.hx + 2.5, z: layout.pen.z };
const OUTSIDE = { x: GX + 14, z: layout.pen.z };

class Bot {
  phase: Phase = 'open';
  log: string[] = [];
  private callTimer = 0;
  /** Seconds since the bot last called (called sheep keep following for a while). */
  sinceCall = 99;

  constructor(private sim: Sim) {}

  private go(x: number, z: number, opts: { sprint?: boolean; sneak?: boolean; call?: boolean } = {}): InputFrame {
    const p = this.sim.player.pos;
    const d = Math.hypot(x - p.x, z - p.z);
    const f = emptyFrame(yawToward(p.x, p.z, x, z));
    if (d > 0.4) f.moveY = 1;
    f.sprint = !!opts.sprint;
    f.sneak = !!opts.sneak;
    if (opts.call) {
      this.callTimer -= SIM_DT;
      if (this.callTimer <= 0) {
        f.call = true;
        this.callTimer = 3;
        this.sinceCall = 0;
      }
    }
    return f;
  }

  private flockStats() {
    const sh = this.sim.flock.sheep.filter((s) => !s.isStray);
    const c = this.sim.flock.centroid;
    return { c, n: sh.length };
  }

  frame(t: number): InputFrame {
    this.sinceCall += SIM_DT;
    const sim = this.sim;
    const p = sim.player.pos;
    const N = sim.flock.sheep.length;
    switch (this.phase) {
      case 'open': {
        if (sim.gateOpen) {
          this.phase = 'leadOut';
          this.log.push(`${t.toFixed(0)}s gate open`);
          return emptyFrame();
        }
        if (Math.hypot(p.x - GATE_OUT.x, p.z - GATE_OUT.z) > 1) return this.go(GATE_OUT.x, GATE_OUT.z);
        return { ...emptyFrame(), interact: true };
      }
      case 'leadOut': {
        // Walk toward B calling; wait whenever the flock falls behind.
        const { c } = this.flockStats();
        if (Math.hypot(B.x - p.x, B.z - p.z) < 6) {
          this.phase = 'settle';
          this.log.push(`${t.toFixed(0)}s shepherd at B`);
        }
        const wp = p.x < OUTSIDE.x - 2 ? OUTSIDE : { x: B.x, z: B.z };
        if (Math.hypot(c.x - p.x, c.z - p.z) > 16) return this.go(p.x, p.z, { call: true });
        return this.go(wp.x, wp.z, { call: true });
      }
      case 'settle': {
        const inB = sim.flock.sheep.filter((s) => Math.hypot(s.x - B.x, s.z - B.z) < B.r + 5).length;
        if (inB >= Math.ceil(N * 0.9)) {
          this.phase = 'leadHome';
          this.log.push(`${t.toFixed(0)}s ${inB}/${N} at pasture B`);
          return emptyFrame();
        }
        return this.go(B.x + 6, B.z - 4, { call: true });
      }
      case 'leadHome': {
        const { c } = this.flockStats();
        if (Math.hypot(OUTSIDE.x - p.x, OUTSIDE.z - p.z) < 2) {
          this.phase = 'pen';
          this.log.push(`${t.toFixed(0)}s back at the pen`);
        }
        if (Math.hypot(c.x - p.x, c.z - p.z) > 16) return this.go(p.x, p.z, { call: true });
        return this.go(OUTSIDE.x, OUTSIDE.z, { call: true });
      }
      case 'pen': {
        // Walk in through the gate to the back of the pen, calling; the flock files in.
        // Then stand quietly until the called sheep have stopped following, and only
        // then slip out (or the bellwether follows you back out of the gate).
        const atBackNow = Math.hypot(PEN_BACK.x - p.x, PEN_BACK.z - p.z) < 1.5;
        const settled = this.sinceCall > config.flock.call.leaderFollowSeconds + 1;
        if (sim.flock.inPen >= N - sim.flock.strays && atBackNow && settled) {
          this.phase = 'exit';
          this.log.push(`${t.toFixed(0)}s ${sim.flock.inPen}/${N} in pen`);
          return emptyFrame();
        }
        const inside = p.x < GX - 0.5;
        if (!inside) {
          // Line up with the gate, then go through.
          if (Math.abs(p.z - layout.pen.z) > 0.4 || p.x > GX + 3) return this.go(GX + 1.5, layout.pen.z, { call: true });
          return this.go(GX - 3, layout.pen.z, { call: true });
        }
        const allIn = sim.flock.inPen >= N - sim.flock.strays;
        return this.go(PEN_BACK.x, PEN_BACK.z, { call: !allIn });
      }
      case 'exit': {
        // Slip out along the north fence without calling, then step out of the gate.
        if (p.x > GX + 1.2) {
          this.phase = 'close';
          return emptyFrame();
        }
        const north = layout.pen.z - layout.pen.hz + 0.8;
        if (p.x < GX - 2.5) return this.go(Math.min(p.x + 3, GX - 2), north, { sneak: true });
        if (Math.abs(p.z - layout.pen.z) > 0.4 && p.x < GX - 0.5) return this.go(GX - 1.2, layout.pen.z, { sneak: true });
        return this.go(GX + 1.6, layout.pen.z, { sneak: true });
      }
      case 'close': {
        if (!sim.gateOpen) {
          this.phase = 'done';
          this.log.push(`${t.toFixed(0)}s gate closed`);
          return emptyFrame();
        }
        if (Math.hypot(p.x - GATE_OUT.x, p.z - GATE_OUT.z) > 1) return this.go(GATE_OUT.x + 0.5, GATE_OUT.z, { sneak: true });
        return { ...emptyFrame(), interact: true };
      }
      default:
        return emptyFrame();
    }
  }
}

it('a scripted shepherd takes the flock to pasture B and back within 8 minutes', () => {
  const sim = newSim();
  const bot = new Bot(sim);
  const limit = 8 * 60;
  let t = 0;
  const trace: string[] = [];
  while (bot.phase !== 'done' && t < limit + 120) {
    sim.step(bot.frame(t));
    t += SIM_DT;
    if (TRACE && sim.tick % 300 === 0) {
      const fl = sim.flock;
      const modes = [0, 0, 0, 0, 0];
      for (const s of fl.sheep) modes[s.mode]++;
      const P = sim.player.pos;
      const L = fl.leader;
      trace.push(
        `${t.toFixed(0)}s ${bot.phase} P(${P.x.toFixed(0)},${P.z.toFixed(0)}) C(${fl.centroid.x.toFixed(0)},${fl.centroid.z.toFixed(0)}) L(${L.x.toFixed(0)},${L.z.toFixed(0)} m${L.mode} call${L.callTimer.toFixed(0)}) pen${fl.inPen} stray${fl.strays} stuck${fl.stuck} modes g${modes[0]} f${modes[1]} fl${modes[2]} s${modes[3]} p${modes[4]}`,
      );
    }
  }
  if (TRACE) console.log(trace.join('\n'));
  const f = sim.flock;
  const summary = {
    seconds: Math.round(t),
    phase: bot.phase,
    inPen: f.inPen,
    strayEvents: f.strayEvents,
    stuckNow: f.stuck,
    log: bot.log,
  };
  console.log('[herding trial]', JSON.stringify(summary));
  expect(bot.phase).toBe('done');
  expect(t).toBeLessThan(limit);
  expect(f.inPen).toBeGreaterThanOrEqual(config.flock.count - 2);
  expect(f.strayEvents).toBeLessThanOrEqual(2);
  expect(f.stuck).toBe(0);
}, 60_000);

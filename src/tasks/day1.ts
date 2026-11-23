// "Day 1": a guided first day that walks through everything the greybox can do.
// Conditions are about the world, not about which button was pressed, so any way of
// getting there counts (and doing something early simply ticks the task off).

import { config, GOLDEN_HOUR, SUNSET_HOUR } from '../core/config';
import { Mode } from '../flock/sheep';
import type { Sim } from '../sim';
import { layout } from '../world/map';
import type { TaskDef } from './taskSystem';

/** Read live: the active map is chosen after this module loads. */
const A = () => layout.pastures[0];

const outside = (sim: Sim) => sim.flock.sheep.filter((s) => !s.inPen).length;
const within = (sim: Sim, x: number, z: number, r: number) =>
  sim.flock.sheep.filter((s) => Math.hypot(s.x - x, s.z - z) < r).length;
const n = (sim: Sim) => sim.flock.sheep.length;

export const RETURN_HOME: TaskDef = {
  id: 'home',
  title: 'Bring everyone home before sunset',
  how: `Lead the flock into the ağıl (call and walk in, then slip out along the fence) and close the gate with E. Sunset is at ${SUNSET_HOUR}:00.`,
  update: (sim) => {
    const inPen = sim.sheepInPen;
    return {
      done: inPen === n(sim) && !sim.gateOpen,
      progress: `${inPen}/${n(sim)} in the pen · gate ${sim.gateOpen ? 'open' : 'closed'}`,
      target: { ...sim.gatePos, label: 'the ağıl' },
      nudge: sim.hour >= GOLDEN_HOUR && sim.hour < SUNSET_HOUR ? 'The sun is getting low.' : undefined,
    };
  },
};

/** The thorn bush the lost ewe gets caught in: the one in the cluster farthest from pasture A. */
function lostSpot(sim: Sim): { x: number; z: number; r: number } {
  let best = { x: layout.thornCluster.x, z: layout.thornCluster.z, r: 1 };
  let bestD = -1;
  for (const o of sim.obstacles.byRole('thorn')) {
    if (o.kind !== 'circle') continue;
    if (Math.hypot(o.x - layout.thornCluster.x, o.z - layout.thornCluster.z) > layout.thornCluster.r) continue;
    const d = Math.hypot(o.x - A().x, o.z - A().z);
    if (d > bestD) {
      bestD = d;
      best = { x: o.x, z: o.z, r: o.r };
    }
  }
  return best;
}

export const DAY1: TaskDef[] = [
  {
    id: 'gate',
    title: 'Open the pen gate',
    how: 'Walk to the gate on the east side of the ağıl and press E.',
    update: (sim) => ({
      done: sim.gateOpen,
      target: { ...sim.gatePos, label: 'the gate' },
    }),
  },
  {
    id: 'leadOut',
    title: 'Lead the flock out of the pen',
    how: 'Right-click to call (“brrr-hey”) and walk away from the pen. The flock follows the dark bellwether.',
    update: (sim) => {
      const out = outside(sim);
      return { done: out >= n(sim) - 1, progress: `${out}/${n(sim)} sheep outside` };
    },
  },
  {
    id: 'pastureA',
    title: 'Take the flock to Pasture A',
    how: 'Keep calling and walk to the yellow flag. Stop and wait when they fall behind.',
    update: (sim) => {
      const inA = within(sim, A().x, A().z, A().r + 5);
      return {
        done: inA >= Math.ceil(n(sim) * 0.9),
        progress: `${inA}/${n(sim)} sheep on the pasture`,
        target: { x: A().x, z: A().z, label: 'Pasture A' },
      };
    },
  },
  {
    id: 'graze',
    title: 'Let them graze for an hour',
    how: 'Stay near but calm: walk, don’t run, and don’t call. Watch the grass wear down under them.',
    update: (sim, st) => {
      const grazing = sim.flock.sheep.filter((s) => s.mode === Mode.Graze && Math.hypot(s.x - A().x, s.z - A().z) < A().r + 8).length;
      if (grazing >= n(sim) * 0.75) st.n.hours = (st.n.hours ?? 0) + 1 / 60 / config.time.secondsPerHour;
      const mins = Math.floor((st.n.hours ?? 0) * 60);
      return {
        done: (st.n.hours ?? 0) >= 1,
        progress: `${mins}/60 min grazed${grazing < n(sim) * 0.75 ? ' (paused: the flock is unsettled or off the pasture)' : ''}`,
      };
    },
  },
  {
    id: 'pet',
    title: 'Say hello to Karabaş',
    how: 'Walk up to the Kangal and press E to pet him. A stronger bond makes him answer faster and more reliably.',
    update: (sim) => {
      // Petting him earlier today counts too (any way of getting there counts).
      const done = (sim.tasks.counters.petted ?? 0) > 0 || sim.dog.care.pettedToday;
      return {
        done,
        progress: `bond ${Math.round(sim.dog.bond)}`,
        target: { x: sim.dog.x, z: sim.dog.z, label: 'Karabaş' },
      };
    },
  },
  {
    id: 'gather',
    title: 'Have Karabaş gather the flock',
    how: 'Hold Q, move the mouse up to “Topla” (Gather) and release. He runs round the flock and brings it to you. Praise him after (E).',
    update: (sim, st) => ({
      done: (sim.tasks.counters['dog:gather'] ?? 0) > 0,
      progress:
        sim.dog.command === 'gather' ? `Karabaş is gathering… (${sim.dog.state})` : sim.dog.pending ? 'Karabaş heard you…' : 'Waiting for the whistle',
      nudge: st.t > 45 ? 'Tip: tap Q quickly to repeat the last command. Within 25 m he reads a silent hand signal instead.' : undefined,
    }),
  },
  {
    id: 'hold',
    title: 'Leave the flock with Karabaş',
    how: 'Whistle “Bekle” (Hold: Q, mouse right). Then walk at least 50 m away and stay away for 30 seconds. He keeps them together.',
    update: (sim, st) => {
      const d = sim.dog;
      const holding = d.command === 'hold';
      const away = holding ? Math.hypot(sim.player.pos.x - d.holdX, sim.player.pos.z - d.holdZ) : 0;
      const together = holding ? within(sim, d.holdX, d.holdZ, config.dog.hold.radius) >= n(sim) * 0.9 : false;
      if (holding && away >= 50 && together) st.n.away = (st.n.away ?? 0) + 1 / 60;
      const secs = Math.floor(st.n.away ?? 0);
      return {
        done: secs >= 30,
        progress: !holding
          ? 'Whistle Bekle first'
          : away < 50
            ? `${Math.round(away)}/50 m away`
            : `${secs}/30 s away · ${together ? 'flock together' : 'paused: the flock is drifting apart'}`,
      };
    },
  },
  {
    id: 'lost',
    title: 'A ewe is missing — find her',
    how: 'One of the ewes wandered off while you were away. Whistle “Ara” (Search: Q, mouse down-right) and follow Karabaş’s barking — or look for her yourself.',
    start: (sim, st) => {
      // Pick a calm, non-bellwether ewe and lose her in the thorns south of the pasture.
      const ewe =
        sim.flock.sheep.find((s) => !s.isLeader && s.stuck === 'none' && !s.inPen) ?? sim.flock.sheep.find((s) => !s.isLeader)!;
      const spot = lostSpot(sim);
      const ax = spot.x - A().x;
      const az = spot.z - A().z;
      const ad = Math.max(1e-3, Math.hypot(ax, az));
      const x = spot.x + (ax / ad) * (spot.r + config.flock.radius - 0.05);
      const z = spot.z + (az / ad) * (spot.r + config.flock.radius - 0.05);
      ewe.x = ewe.px = x;
      ewe.z = ewe.pz = z;
      ewe.y = ewe.py = sim.terrain.heightAt(x, z);
      ewe.vx = ewe.vz = 0;
      ewe.stuck = 'thorn';
      ewe.isStray = true;
      ewe.inPen = false;
      st.n.ewe = ewe.id;
    },
    update: (sim, st) => {
      const ewe = sim.flock.sheep[st.n.ewe];
      const p = sim.player.pos;
      const found = Math.hypot(ewe.x - p.x, ewe.z - p.z) < 4 || ewe.stuck === 'none';
      const dogFound = sim.dog.command === 'search' && sim.dog.searchFoundAt > 0;
      return {
        done: found,
        progress: dogFound ? 'Karabaş has found her — follow the barking' : undefined,
        nudge: st.t > 75 ? 'Tip: listen for the barking, or try the thorn thicket near Pasture A.' : undefined,
      };
    },
  },
  {
    id: 'free',
    resumeFrom: 'lost',
    title: 'Free her from the thorns',
    how: 'Stand next to her and hold E for 2 seconds.',
    start: (sim, st) => {
      st.n.ewe = sim.flock.sheep.findIndex((s) => s.stuck === 'thorn');
    },
    update: (sim, st) => {
      const ewe = sim.flock.sheep[st.n.ewe];
      if (!ewe) return { done: true };
      return {
        done: ewe.stuck === 'none',
        progress: ewe.freeProgress > 0 ? `${Math.round((ewe.freeProgress / config.flock.stuck.freeSeconds) * 100)}%` : undefined,
        target: { x: ewe.x, z: ewe.z, label: 'the ewe' },
      };
    },
  },
  {
    id: 'rejoin',
    resumeFrom: 'lost',
    title: 'Bring her back to the flock',
    how: 'Call her (right-click) and walk back to the flock, or whistle “Ara” again and Karabaş will bring her.',
    start: (sim, st) => {
      const strays = sim.flock.sheep.filter((s) => s.isStray);
      st.n.ewe = strays.length ? strays[0].id : -1;
    },
    update: (sim, st) => {
      const ewe = st.n.ewe >= 0 ? sim.flock.sheep[st.n.ewe] : null;
      if (!ewe) return { done: true };
      const c = sim.flock.centroid;
      const d = Math.hypot(ewe.x - c.x, ewe.z - c.z);
      return { done: !ewe.isStray && d < 20, progress: `${Math.round(d)} m from the flock`, target: { x: c.x, z: c.z, label: 'the flock' } };
    },
  },
  {
    id: 'wolf',
    title: 'Wolf! Keep the flock safe',
    how: 'A wolf is coming from the forest side. Keep the flock together; Karabaş will meet it. Whistle “Saldır” (Attack: Q, mouse down-left) to send him at it. It counts once the wolf turns and runs.',
    start: (sim) => {
      sim.spawnWolf();
    },
    update: (sim) => {
      const w = sim.wolves.list.filter((wolf) => wolf.kind === 'flock');
      const bites = sim.tasks.counters.bites ?? 0;
      const gone = w.length === 0 || w.every((x) => x.state === 'flee');
      return {
        done: gone,
        progress: `${w.length ? `wolf: ${w.map((x) => (x.state === 'stalk' ? 'stalking' : x.state === 'hunt' ? 'ATTACKING' : 'running off')).join(', ')}` : 'wolf gone'} · bites ${bites}`,
      };
    },
  },
  RETURN_HOME,
];


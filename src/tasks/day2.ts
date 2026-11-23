// "Day 2": the motorcycle. Learn to start and ride it, lap the gravel loop, find out what
// the dirt road and the mud can and can't do, scout a far pasture, and learn why you
// park away from the sheep.

import { LapTimer } from '../bike/lap';
import { Surface } from '../world/terrain';
import { layout } from '../world/map';
import type { TaskDef } from './taskSystem';

const DEG = Math.PI / 180;
const hill = () => layout.hill;
const C = () => layout.pastures[2];
const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const mudPoint = () => {
  const h = layout.hill;
  return {
    x: h.x + Math.cos(h.mudFlank.angleDeg * DEG) * (h.plateau + h.flank + 8),
    z: h.z + Math.sin(h.mudFlank.angleDeg * DEG) * (h.plateau + h.flank + 8),
  };
};
const penCentre = () => ({ x: layout.pen.x, z: layout.pen.z });

export const DAY2: TaskDef[] = [
  {
    id: 'getOn',
    title: 'Get on the motorcycle',
    how: 'The old bike is parked by the ağıl. Walk up to it and press E.',
    update: (sim) => ({ done: sim.riding, target: { x: sim.bike.x, z: sim.bike.z, label: 'the bike' } }),
  },
  {
    id: 'kick',
    title: 'Kick-start the engine',
    how: 'Press Space (A on a gamepad) when the needle sweeps through the green. A tired old two-stroke: timing matters.',
    update: (sim, st) => ({
      done: sim.bike.engineOn,
      progress: sim.riding ? undefined : 'Get back on first (E)',
      nudge: st.t > 20 ? 'Watch the ring: kick just as the needle enters the green arc.' : undefined,
    }),
  },
  {
    id: 'toLoop',
    title: 'Ride to the gravel loop',
    how: 'W throttle, S brake, A/D steer. Follow the gravel track from the gate out to where it joins the loop. Ease off before turns.',
    update: (sim) => {
      const s = LapTimer.startPoint();
      const d = Math.hypot(sim.bike.x - s.x, sim.bike.z - s.z);
      return { done: sim.riding && d < 12, target: { ...s, label: 'the loop junction' } };
    },
  },
  {
    id: 'lap',
    title: 'Ride one lap of the gravel loop',
    how: 'Cross the line where the gate track joins and ride all the way round, either direction. Stay on the road; the hill section is packed dirt.',
    start: (sim, st) => {
      st.n.laps = sim.lap.laps;
    },
    update: (sim, st) => {
      const L = sim.lap;
      const pct = Math.min(100, Math.round((Math.abs(L.swept) / (Math.PI * 2)) * 100));
      return {
        done: L.laps > st.n.laps,
        progress: L.running ? `lap ${pct}% · ${mmss(L.t)}` : L.message || 'cross the start line to begin',
        target: L.running ? undefined : { ...LapTimer.startPoint(), label: 'start line' },
      };
    },
  },
  {
    id: 'fastLap',
    title: 'Lap the loop in under 2 minutes without falling',
    how: 'Brake before the bends and ease the throttle in them. If the rear slides on the gravel, steer into the slide and back off the throttle.',
    update: (sim) => {
      const L = sim.lap;
      const ok = L.best > 0 && L.best < 120;
      return {
        done: ok,
        progress: `${L.running ? `this lap ${mmss(L.t)}` : 'not on a lap'} · best clean ${L.best > 0 ? mmss(L.best) : '—'} (target 2:00.0)`,
      };
    },
  },
  {
    id: 'hill',
    title: 'Ride up the hill on the dirt road',
    how: 'Where the loop crosses the hill it climbs 25° on packed dirt. Keep the throttle open; shift your weight (Alt + mouse up, right stick) if the front gets light.',
    update: (sim) => {
      const r = Math.hypot(sim.bike.x - hill().x, sim.bike.z - hill().z);
      return { done: sim.riding && r < hill().plateau, target: { x: hill().x, z: hill().z, label: 'the hilltop' } };
    },
  },
  {
    id: 'mud',
    title: 'Try the muddy flank',
    how: 'The south-east side of the hill is mud. Try to ride up it and see what happens.',
    update: (sim) => {
      const b = sim.bike;
      const bogged = b.bogged > 2 || (b.state === 'fallen' && sim.terrain.surfaceAt(b.x, b.z) === Surface.Mud);
      return {
        done: bogged,
        progress: b.bogged > 0 ? 'the rear wheel is spinning…' : undefined,
        target: { ...mudPoint(), label: 'the mud flank' },
      };
    },
  },
  {
    id: 'scout',
    title: 'Scout Pasture C',
    how: 'Far pastures are what the bike is for. Ride out to the purple flag and look at the grass before you walk the flock there.',
    update: (sim) => {
      const d = Math.hypot(sim.player.pos.x - C().x, sim.player.pos.z - C().z);
      const g = Math.round(sim.grass.meanIn(C().x, C().z, C().r) * 100);
      return { done: d < 15, progress: d < 40 ? `grass here: ${g}%` : undefined, target: { x: C().x, z: C().z, label: 'Pasture C' } };
    },
  },
  {
    id: 'park',
    title: 'Park away from the flock and walk in',
    how: 'Engines frighten sheep. Leave the bike at least 25 m from the ağıl (get off with E: the engine stops), then walk to the gate.',
    update: (sim) => {
      const b = sim.bike;
      const bikeDist = Math.hypot(b.x - penCentre().x, b.z - penCentre().z);
      const atGate = Math.hypot(sim.player.pos.x - sim.gatePos.x, sim.player.pos.z - sim.gatePos.z) < 5;
      const calm = sim.flock.sheep.reduce((a, s) => a + s.stress, 0) / sim.flock.sheep.length;
      return {
        done: !sim.riding && b.state !== 'riding' && bikeDist > 25 && atGate && calm < 30,
        progress: sim.riding
          ? `bike ${Math.round(bikeDist)} m from the ağıl${bikeDist > 25 ? ' — far enough, get off here' : ''}`
          : `bike parked ${Math.round(bikeDist)} m away${bikeDist > 25 ? '' : ' (too close!)'} · flock stress ${Math.round(calm)}`,
        target: sim.riding ? undefined : { ...sim.gatePos, label: 'the gate' },
        nudge: calm > 30 && !sim.riding ? `The sheep are rattled (stress ${Math.round(calm)}); give them a moment.` : undefined,
      };
    },
  },
];

const byId = (id: string) => DAY2.find((t) => t.id === id)!;

/**
 * Day 2 in the valley: no gravel loop to lap, so the ride is the real one: up the gravel
 * road to the village, then the dirt road to the lookout, the mud flank, scouting the dry
 * pasture and parking away from the flock.
 */
export const DAY2_VALLEY: TaskDef[] = [
  byId('getOn'),
  byId('kick'),
  {
    id: 'toVillage',
    title: 'Ride the gravel road up to the village',
    how: 'Follow the gravel road from the gate east along the valley and up to the village square, about a kilometre. Brake before the bends; if the rear slides, steer into it and ease off.',
    update: (sim) => {
      const v = layout.village!;
      const d = Math.hypot(sim.bike.x - v.x, sim.bike.z - v.z);
      return {
        done: sim.riding && d < v.r,
        progress: sim.riding ? `${Math.round(d)} m to the village` : undefined,
        target: { x: v.x, z: v.z, label: 'the village' },
      };
    },
  },
  {
    ...byId('hill'),
    title: 'Ride up to the lookout on the dirt road',
    how: 'On the way back, the dirt road leaves the gravel road and climbs about 25° to the lookout. Keep the throttle open; shift your weight (Alt + mouse up, right stick) if the front gets light. From the top you can see the whole valley.',
  },
  byId('mud'),
  byId('scout'),
  byId('park'),
];

/** The Day 2 plan for the active map. */
export const day2Plan = (): TaskDef[] => (layout.track ? DAY2 : DAY2_VALLEY);

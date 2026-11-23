import { layout } from '../world/map';
import { RETURN_HOME } from './day1';
import type { TaskDef } from './taskSystem';

const pasture = () => layout.pastures[2];
const atPasture = (x: number, z: number) => Math.hypot(x - pasture().x, z - pasture().z) < pasture().r;

export const DAY3: TaskDef[] = [
  {
    id: 'waterDryPasture',
    title: 'Water the flock and take them to dry Pasture C',
    how:
      'Pasture C has no water. Two ways:\n' +
      '• Let them drink at any spring on the way (the trough and çeşme at home don’t count), then lead them on to C.\n' +
      '• Or park the bike by the çeşme and press R beside it to fill its two cans; ride to C, park, and press R twice to pour them into a basin there. Thirsty sheep drink from it.\n' +
      'Three in four of the flock must have drunk today and be at C together. Sheep that drank on the way count, even if they’re thirsty again when they reach C.',
    start: (sim, st) => {
      st.n.startTick = sim.tick;
    },
    update: (sim, st) => {
      const sheep = sim.flock.sheep;
      // Drank today at a spring, or at a basin or cistern on Pasture C (not at home).
      const drankToday = (s: (typeof sheep)[number]) => {
        if (s.lastDrinkAt < st.n.startTick) return false;
        const source = sim.water.points[s.lastDrinkFrom];
        return source?.kind === 'spring' || ((source?.kind === 'basin' || source?.capacity !== undefined) && atPasture(source.x, source.z));
      };
      const drank = sheep.filter(drankToday);
      const atC = sheep.filter((s) => atPasture(s.x, s.z));
      const both = drank.filter((s) => atPasture(s.x, s.z)).length;
      const liters = sim.water.points.reduce((total, p) => ((p.kind === 'basin' || p.capacity !== undefined) && atPasture(p.x, p.z) ? total + (p.liters ?? 0) : total), 0);
      const target = Math.ceil(sheep.length * 0.75);
      return {
        done: both >= target,
        progress: `${both}/${target} watered and at Pasture C · ${drank.length} have drunk today · ${atC.length} at C${liters > 0 ? ` · ${Math.ceil(liters)} L in the basin` : ''}`,
        target: { x: pasture().x, z: pasture().z, label: 'dry Pasture C' },
        nudge:
          atC.length >= target && drank.length < target && liters === 0
            ? 'They’re at C but haven’t drunk today. Pour the bike’s cans into a basin here (R by the bike), or take them to a spring and back.'
            : undefined,
      };
    },
  },
  RETURN_HOME,
];

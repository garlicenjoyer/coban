import type { ResidentId, ResidentStop } from '../world/mapTypes';

export type WorkPose = NonNullable<ResidentStop['pose']>;
export type WorkSound = 'broom' | 'oliveRustle' | 'oliveDrop' | 'teaSip' | 'tractorCheck' | 'churn' | 'tavla';

export const workCycle = { sort: 4, sweep: 3.62, tea: 5.5, emre: 5.7, zeynep: 6.4 } as const;

type Beat = readonly [second: number, sound: WorkSound];
const beats: Record<keyof typeof workCycle, readonly Beat[]> = {
  sort: [[0.83, 'oliveRustle'], [2.68, 'oliveDrop']],
  sweep: [[0.53, 'broom'], [2.12, 'broom']],
  tea: [[1.83, 'teaSip']],
  emre: [[1.18, 'tractorCheck']],
  zeynep: [[1.46, 'churn']],
};

export function workSounds(id: ResidentId, pose: WorkPose, from: number, to: number): readonly WorkSound[] {
  const cycle = pose === 'check' ? id : pose;
  if (cycle === 'ayse' || cycle === 'hasan' || to <= from) return [];
  const length = workCycle[cycle];
  return beats[cycle].filter(([second]) => Math.floor((from - second) / length) < Math.floor((to - second) / length))
    .map(([, sound]) => sound);
}

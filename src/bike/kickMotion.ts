import { MathUtils } from 'three';

export const KICK_DURATION = 0.78;
export const KICK_IMPACT = 0.57;
const { smoothstep } = MathUtils;

export function kickStroke(phase: number): number {
  return smoothstep(phase, 0.29, KICK_IMPACT) * (1 - smoothstep(phase, 0.65, 0.96));
}

export function kickFoot(phase: number): number {
  return smoothstep(phase, 0.07, 0.3) * (1 - smoothstep(phase, 0.67, 0.98));
}

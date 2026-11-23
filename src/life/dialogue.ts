import type { Resident } from './residents';
import type { Errand } from './errands';

export type DialogueChoice = 'routine' | 'advice' | 'errand' | 'accept' | 'leave';
export type ResidentGesture = 'greet' | 'explain' | 'offer' | 'thank' | 'farewell';

export function errandDirection(place: string, accepted = false): string {
  return accepted ? `Sağ ol. Start at ${place}. I’ve marked the map.` : `Your next stop is ${place}. I’ve marked it on the map.`;
}

export interface DialogueOption {
  id: DialogueChoice;
  label: string;
}

export interface ResidentDialogue {
  resident: Resident;
  text: string;
  offer: Errand | undefined;
  options: readonly DialogueOption[];
}

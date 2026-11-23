// The Kangal's command vocabulary (GDD: whistles and hand gestures).

export type DogCommand = 'gather' | 'hold' | 'search' | 'attack' | 'heel';

export interface CommandInfo {
  id: DogCommand;
  /** Turkish word the shepherd says / the whistle means. */
  turkish: string;
  english: string;
  whistle: string;
  gesture: string;
  /** Whistle synth: [frequency Hz, duration s] notes, separated by short gaps. */
  notes: [number, number][];
}

/** Wheel order, clockwise from the top. */
export const COMMANDS: CommandInfo[] = [
  {
    id: 'gather',
    turkish: 'Topla',
    english: 'Gather',
    whistle: 'two rising notes',
    gesture: 'arm sweeps in a circle',
    notes: [
      [1500, 0.16],
      [2100, 0.22],
    ],
  },
  {
    id: 'hold',
    turkish: 'Bekle',
    english: 'Hold',
    whistle: 'one long flat note',
    gesture: 'flat palm held out',
    notes: [[1700, 0.7]],
  },
  {
    id: 'search',
    turkish: 'Ara',
    english: 'Search',
    whistle: 'three short notes',
    gesture: 'point and flick',
    notes: [
      [1900, 0.08],
      [1900, 0.08],
      [1900, 0.08],
    ],
  },
  {
    id: 'attack',
    turkish: 'Saldır',
    english: 'Attack',
    whistle: 'sharp descending note',
    gesture: 'point hard at target',
    notes: [[2600, 0.25]],
  },
  {
    id: 'heel',
    turkish: 'Gel',
    english: 'Heel',
    whistle: 'short-short-long',
    gesture: 'pat your leg',
    notes: [
      [1600, 0.08],
      [1600, 0.08],
      [1600, 0.35],
    ],
  },
];

export const commandInfo = (id: DogCommand): CommandInfo => COMMANDS.find((c) => c.id === id)!;

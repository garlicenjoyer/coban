// The calendar (GDD feature 6d): Day 1 is a Monday; the first four weeks are summer, then
// autumn. The vet comes to the village on Thursdays; shearing is a summer job.

import { config } from '../core/config';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export const weekday = (day: number): (typeof WEEKDAYS)[number] => WEEKDAYS[(((day - 1) % 7) + 7) % 7];

export const isThursday = (day: number): boolean => weekday(day) === 'Thursday';

export const season = (day: number): 'summer' | 'autumn' => (day <= config.village.summerDays ? 'summer' : 'autumn');

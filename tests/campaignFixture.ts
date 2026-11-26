// Historical scenarios remain useful fixtures for the herding and night simulations.
import { DAY1 } from '../src/tasks/day1';
import { day2Plan } from '../src/tasks/day2';
import { DAY3 } from '../src/tasks/day3';
import { DAY4, FREE_DAY } from '../src/tasks/day4';

export const campaignDay = (day: number) =>
  day === 1 ? DAY1 : day === 2 ? day2Plan() : day === 3 ? DAY3 : day === 4 ? DAY4 : FREE_DAY;

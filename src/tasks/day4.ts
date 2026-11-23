// Day 4, the far pasture: pack for the route, take the flock out to Pasture B, build the
// shepherd's hut, fold the flock and sleep out there with them. Then free days: graze
// well and keep everyone safe for the night, at home or at the hut.

import { config, SUNSET_HOUR } from '../core/config';
import { ITEMS } from '../player/satchel';
import type { Sim } from '../sim';
import { insideFold, layout } from '../world/map';
import type { TaskDef } from './taskSystem';

const B = () => layout.pastures[1];
const fold = () => layout.works.fold;
const foldCentre = () => ({ x: (fold().xMin + fold().xMax) / 2, z: (fold().zMin + fold().zMax) / 2 });
const inFold = (sim: Sim) => sim.flock.sheep.filter((s) => insideFold(s.x, s.z)).length;

export const DAY4: TaskDef[] = [
  {
    id: 'pack',
    title: 'Pack the salt lick and the çay kit',
    how: 'You will spend the night out at Pasture B. At home, press P and pick the salt lick (it holds the flock while you build) and the çay kit (it settles them after the walk). The satchel has three pockets: the third is your choice. Press Enter to pack.',
    update: (sim) => {
      const missing = (['salt', 'cay'] as const).filter((id) => !sim.satchel.has(id)).map((id) => ITEMS[id].name.toLowerCase());
      const packed = sim.satchel.slots.map((s) => ITEMS[s.id].name.toLowerCase()).join(', ') || 'empty';
      return {
        done: missing.length === 0,
        progress: `satchel: ${packed}${missing.length ? ` · still to pack: ${missing.join(' and ')}` : ''}`,
        target: sim.atHome ? undefined : { x: layout.house.x, z: layout.house.z, label: 'home' },
      };
    },
  },
  {
    id: 'toB',
    title: 'Take the flock to Pasture B',
    how: 'Lead them out of the ağıl to Pasture B (the orange flag). If you went this way before, the path is worn: they walk it faster.',
    update: (sim) => {
      const n = sim.flock.sheep.filter((s) => Math.hypot(s.x - B().x, s.z - B().z) < B().r + 8).length;
      const need = Math.ceil(sim.flock.sheep.length * 0.8);
      return { done: n >= need, progress: `${n}/${sim.flock.sheep.length} at Pasture B (need ${need})`, target: { x: B().x, z: B().z, label: 'Pasture B' } };
    },
  },
  {
    id: 'hut',
    get title() {
      return layout.works.hut.ruined ? "Mend Uncle Ahmet's hut by Pasture B" : "Build the shepherd's hut by Pasture B";
    },
    get how() {
      const salt = 'It takes three hours of daylight: set the salt lick down first (1–3 uses a satchel pocket) so the flock stays put.';
      return layout.works.hut.ruined
        ? `His hut stands roofless west of the pasture, the stones fallen round it and the fold walls tumbled. Hold E at the doorway (its east side) to mend it. ${salt}`
        : `Find the stakes west of the pasture and hold E to build. ${salt}`;
    },
    update: (sim) => {
      const site = sim.works.site('hut');
      const word = site.repair ? 'mended' : 'built';
      return {
        done: site.built,
        progress: site.built ? word : `${Math.round(site.progress * 100)}% ${word}`,
        target: { x: site.x, z: site.z, label: site.repair ? "Uncle Ahmet's hut" : 'the hut stakes' },
      };
    },
  },
  {
    id: 'fold',
    title: 'Fold the flock for the night',
    how: `Bring every sheep into the stone fold by the hut (it is open to the east). Then sleep at the hut door with E: the fold is only safe with you beside it, not if you go home to bed. Sunset is at ${SUNSET_HOUR}:00.`,
    update: (sim) => {
      const n = inFold(sim);
      const total = sim.flock.sheep.length;
      return { done: n === total, progress: `${n}/${total} in the fold`, target: { ...foldCentre(), label: 'the fold' } };
    },
  },
];

/** Any later day: graze well, see to Karabaş, and have everyone safe for the night (pen or fold). */
export const FREE_DAY: TaskDef[] = [
  {
    id: 'graze',
    title: 'Graze the flock where the grass is good',
    how: 'Your choice of pasture. Rested ones grow back over a few days; the map shows what was grazed. Keep them watered.',
    update: (sim) => {
      const sheep = sim.flock.sheep;
      const n = Math.max(1, sheep.length);
      const hunger = sheep.reduce((a, s) => a + s.hunger, 0) / n;
      // The grass within their reach: eaten down, they hardly gain and need fresh pasture.
      const grass = sheep.reduce((a, s) => a + sim.grass.meanAround(s.x, s.z), 0) / n;
      const where = grass < 0.15 ? ' · no grass here' : grass < config.flock.graze.fullBiteAt ? ' · grass here is eaten down, move them on' : '';
      return { done: hunger < 25, progress: `hunger ${Math.round(hunger)} (fed below 25)${where}` };
    },
  },
  {
    id: 'dog',
    title: 'See to Karabaş',
    how: 'Fill his bowl on the porch (E) or feed him bread from the satchel, let him drink (he goes to water within about 60 m by himself), pet him (E), and pick off any ticks he brought back from the maquis (hold E beside him).',
    update: (sim) => {
      const c = sim.dog.care;
      // Nothing to feed him with (sack empty, no bread packed) can't hold up the night.
      const fed = c.satiety >= config.dogCare.seekFood || c.bowl.meals > 0 || (c.sack <= 0 && !sim.satchel.has('bread'));
      // He only goes to drink once below seekWater: asking for more would leave the task waiting on him.
      const watered = c.hydration >= config.dogCare.seekWater;
      const left = [fed ? null : 'feed him', watered ? null : 'water (take him near a spring or trough)', c.pettedToday ? null : 'pet him', c.ticks ? `${c.ticks} tick${c.ticks > 1 ? 's' : ''}` : null].filter(Boolean);
      return { done: left.length === 0, progress: left.length ? `still: ${left.join(', ')}` : 'fed, watered, petted, no ticks' };
    },
  },
  {
    id: 'night',
    title: 'Keep everyone safe for the night',
    how: 'Pen them at home behind a closed gate, or, if you built the hut, fold them there and sleep at the hut door.',
    update: (sim) => {
      const total = sim.flock.sheep.length;
      const pen = sim.gateOpen ? 0 : sim.sheepInPen;
      const fold = sim.works.built('hut') ? inFold(sim) : 0;
      return { done: pen === total || fold === total, progress: sim.works.built('hut') ? `${pen}/${total} penned · ${fold}/${total} folded` : `${pen}/${total} penned, gate ${sim.gateOpen ? 'open' : 'closed'}` };
    },
  },
];

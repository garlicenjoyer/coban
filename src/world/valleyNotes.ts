// Uncle Ahmet's notes and pencil marks for the valley. He walked these hills for forty
// years before his knees gave out and he went to his daughter in İzmir. He left the
// paper map in the drawer with what he knew pencilled on it, and a few notes where you
// would need them. Each note read adds a little more of his hand to the map.
//
// Positions come from the valley's layout (passed in) so this file stays plain content.

import type { AhmetNote, Layout, PencilMark, V2 } from './mapTypes';

export interface NotePlaces {
  layout: Layout;
  /** His two cairn routes: home to D (and on to E), home to B. */
  routes: V2[][];
  /** Where the gravel road fords the dere. */
  ford: V2;
}

export function valleyNotes(p: NotePlaces): { notes: AhmetNote[]; pencil: PencilMark[] } {
  const L = p.layout;
  const pa = (id: string) => L.pastures.find((q) => q.id === id)!;
  const A = pa('A');
  const C = pa('C');
  const D = pa('D');
  const E = pa('E');
  const hs = L.house;
  const f = L.works.fold;
  const h = L.works.hut;
  const cs = L.works.cistern;
  const spring = L.springs.find((s) => s.name === 'the dere spring')!;
  const v = L.village!;

  const notes: AhmetNote[] = [
    {
      id: 'letter',
      x: hs.x + 1.6,
      z: hs.z - hs.hz - 1.5,
      where: 'a letter on the çay table',
      title: 'A letter from İzmir',
      text:
        'My knees have given up on the hills, so the flock is yours now. A neighbour will bring my clothes to İzmir; everything else here is yours.\n\n' +
        'The map is in the drawer. I pencilled in what I know. The cairns are mine too: follow them and the sheep will follow you.\n\n' +
        'Karabaş eats once a day. His sack is by the woodpile, his bowl by the door. After a day in the maquis, go through his coat for ticks; he will lie still for you.\n\n' +
        'I left a few notes where you will need them. Read them before you need them, not after.',
    },
    {
      id: 'dere',
      x: spring.x - 4,
      z: spring.z - 4,
      where: 'a note under a stone by the dere spring',
      title: 'The dere',
      text:
        'This spring runs until August, then the dere is only stones. After that the sheep drink at home or at B.\n\n' +
        'In a wet autumn the dere runs for a few days. Do not cross with the flock then. Wait a day; the water goes as fast as it comes.',
    },
    {
      id: 'hut',
      x: h.x + h.hx + 3,
      z: h.z - 3.5,
      where: 'a note wedged between the hut’s fallen stones',
      title: 'My summer hut',
      text:
        'I slept up here with the flock every summer. The roof came down the winter your aunt died and I never mended it. The stones are all still here.\n\n' +
        'If you build it again, put the fold against its south side and leave it open to the east. The night wind comes off the forest.',
    },
    {
      id: 'wolves',
      x: E.x + 8,
      z: E.z - E.r - 3,
      where: 'a note under a stone at the forest’s edge',
      title: 'The forest pasture',
      text:
        'The best grass in the valley, and the wolves know it. They den in the pines to the north.\n\n' +
        'Graze here in the morning only, keep Karabaş close, and be gone by midday. If you find bones or wool on the thorns, you have gone too far in.',
    },
    {
      id: 'ruins',
      x: L.ruins.x + L.ruins.hx + 1,
      z: L.ruins.z + 8,
      where: 'a note tucked under a fallen column',
      title: 'The old stones',
      text:
        'After heavy rain, coins and lamp pieces come up out of the ground here. The museum man in the village pays fairly and asks no questions.\n\n' +
        'Do not dig. The gendarme knows everyone, and the dead have earned their sleep.',
    },
    {
      id: 'lookout',
      x: L.hill.x - 8,
      z: L.hill.z + 6,
      where: 'a note under a stone on the lookout',
      title: 'From up here',
      text:
        'I came up here every spring to see where the grass was greenest. You can see all five pastures from this stone if the haze lets you.\n\n' +
        'Take the bike up the west side. The south-east side is mud whatever the weather.',
    },
    {
      id: 'cistern',
      x: cs.x + 8,
      z: cs.z - 6,
      where: 'a note under a stone by the dry pasture',
      title: 'Pasture C',
      text:
        'The sweetest summer grass, and not a drop of water. I always meant to build a cistern here to catch the winter rain. I never did.\n\n' +
        'Until someone does, bring water on the bike, or let them drink at a spring on the way.',
    },
  ];

  const [toD, toB] = p.routes;
  const mid = (pts: V2[]) => pts[Math.floor(pts.length / 2)];
  const pencil: PencilMark[] = [
    // On the map from the first morning.
    { id: 'routeD', kind: 'route', pts: toD },
    { id: 'routeB', kind: 'route', pts: toB },
    { id: 'routeBtime', kind: 'text', x: mid(toB).x + 30, z: mid(toB).z - 14, text: 'half a day with the flock', rot: -0.5 },
    { id: 'noteA', kind: 'text', x: A.x - 40, z: A.z - 10, text: 'always good', rot: -0.08 },
    { id: 'noteD', kind: 'text', x: D.x - 6, z: D.z + D.r + 22, text: 'best grass', rot: 0.05 },
    { id: 'noteC', kind: 'text', x: C.x, z: C.z + C.r + 22, text: 'no water!', rot: -0.06 },
    { id: 'noteE', kind: 'circle', x: E.x, z: E.z, r: E.r + 10, text: '?' },
    { id: 'noteB', kind: 'text', x: h.x - 34, z: h.z + 4, text: 'my hut', rot: 0.04 },
    { id: 'noteMud', kind: 'text', x: L.hill.x + 92, z: L.hill.z + 70, text: 'bike sticks', rot: 0.3 },
    { id: 'noteVillage', kind: 'text', x: v.x - 10, z: v.z + 90, text: 'tea · bread · cheese', rot: -0.05 },
    // Added by his notes.
    { id: 'dereDry', from: 'dere', kind: 'text', x: spring.x + 52, z: spring.z + 6, text: 'dry by August', rot: 0.12 },
    { id: 'dereFlood', from: 'dere', kind: 'text', x: p.ford.x + 44, z: p.ford.z + 18, text: 'not in a flood', rot: -0.1 },
    { id: 'fold', from: 'hut', kind: 'rect', xMin: f.xMin, xMax: f.xMax, zMin: f.zMin, zMax: f.zMax, text: 'fold here' },
    { id: 'wolves', from: 'wolves', kind: 'circle', x: L.wolfDen.x, z: L.wolfDen.z, r: 70, text: 'wolves · never linger' },
    { id: 'Emorning', from: 'wolves', kind: 'text', x: E.x + 70, z: E.z + 6, text: 'mornings only', rot: 0.06 },
    { id: 'coins', from: 'ruins', kind: 'text', x: L.ruins.x + 6, z: L.ruins.z + 30, text: 'coins after rain', rot: -0.07 },
    { id: 'westSide', from: 'lookout', kind: 'text', x: L.hill.x - 70, z: L.hill.z + 40, text: 'up the west side', rot: -0.35 },
    { id: 'cisternHere', from: 'cistern', kind: 'circle', x: cs.x, z: cs.z, r: 9, text: 'cistern?' },
    // What the museum curator tells you, one piece at a time.
    { id: 'oldRoad', from: 'museum1', kind: 'route', pts: [{ x: L.ruins.x + 20, z: L.ruins.z + 30 }, { x: -200, z: 60 }, { x: cs.x - 10, z: cs.z - 20 }] },
    { id: 'oldRoadText', from: 'museum1', kind: 'text', x: -170, z: 40, text: 'old Roman road', rot: 0.5 },
    { id: 'sacredSpring', from: 'museum2', kind: 'circle', x: L.ruins.x - 30, z: L.ruins.z - 40, r: 8, text: 'sacred spring (in spring)' },
    { id: 'ancientFold', from: 'museum3', kind: 'text', x: L.hill.x + 30, z: L.hill.z - 10, text: 'ancient fold', rot: 0.1 },
  ];
  return { notes, pencil };
}

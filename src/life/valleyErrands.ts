import type { Errand } from './errands';

export const VALLEY_ERRANDS = [
  {
    resident: 'ayse',
    title: 'Olives in the nets',
    offer: 'There are windfalls in the nets above the grove. Could you gather both baskets and leave them at the head of the path?',
    thanks: 'Ayşe has both baskets for the press.',
    completedReply: 'I’ve got both baskets for the press. Thank you.',
    reward: 22,
    stops: [
      { x: -327, z: 286, place: 'the west olive net', action: 'gather olives from the first net', note: 'One basket filled.', prop: 'olives', seconds: 1.5 },
      { x: -313, z: 285, place: 'the east olive net', action: 'gather olives from the second net', note: 'Both baskets are ready to stack.', prop: 'olives', seconds: 1.5 },
      { x: -341, z: 283, place: 'the head of the grove path', action: 'leave the olive baskets for Ayşe', note: 'The olives are ready for the press.', prop: 'olives' },
    ],
  },
  {
    resident: 'emre',
    title: 'Stones for the terrace',
    offer: 'The sheep have nudged stones off the upper wall. Could you restack the loose stones by the west and east ends? Leave the footpaths open.',
    thanks: 'The terrace wall is ready for the next rain.',
    reward: 26,
    stops: [
      { x: -332, z: 287.3, place: 'the west end of the upper terrace wall', action: 'restack the loose terrace stones', note: 'The west end is braced.', prop: 'stones', seconds: 2.1 },
      { x: -296, z: 287.3, place: 'the east end of the upper terrace wall', action: 'restack the loose terrace stones', note: 'The east end is braced.', prop: 'stones', seconds: 2.1 },
    ],
  },
  {
    resident: 'zeynep',
    title: 'The empty milk cans',
    offer: 'The dairy has two empty cans to send downhill. Pick up the crate west of the village square and leave it at the pullout above the ağıl.',
    thanks: 'The cans are ready for the next morning’s milk.',
    reward: 44,
    stops: [
      { x: 394, z: -364, place: 'the dairy’s pickup, west of the square', action: 'pick up the crate of empty milk cans', note: 'You have the empty cans. Carry them on foot or take the bike.', prop: 'cans' },
      { x: -347, z: 277, place: 'the roadside pullout above the ağıl', action: 'drop off the empty milk cans', note: 'The empty cans are at the pullout.', prop: 'cans' },
    ],
  },
  {
    resident: 'hasan',
    title: 'Leaves at the fountain',
    offer: 'The plane trees have dropped leaves all around the fountain. Would you sweep the west and east edges so the square is tidy before çay?',
    thanks: 'The way to the fountain is swept clean.',
    reward: 18,
    stops: [
      { x: 412.9, z: -370.1, place: 'the west edge of the village fountain', action: 'sweep the leaves from the paving', note: 'The west edge is clear.', prop: 'broom', seconds: 1.5 },
      { x: 418.5, z: -370.7, place: 'the east edge of the village fountain', action: 'sweep the leaves from the paving', note: 'The east edge is clear.', prop: 'broom', seconds: 1.5 },
    ],
  },
] as const satisfies readonly Errand[];

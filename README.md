# Çoban — greybox prototype

Third-person three.js prototype of an Aegean shepherd game. Greybox milestones done:
**M0** foundations and test map, **M1** shepherd movement, camera, crook and call,
**M2** flock herding (24 sheep, bellwether, grazing, strays, stuck sheep, pen gate),
**M3** the Kangal (layered AI, whistle wheel and gestures, bond, stamina, wolf encounters),
**M4** the motorcycle (engine, traction, slides, falls, lap timer).

## Look and sound

Minimal, cozy, cel-shaded: every material shares one four-band light ramp; a warm
south-east morning sun, a sky gradient with a sun glow, warm violet-brown shadows, soft ink
outlines from depth edges. A post pass adds **aerial perspective** (distance fades into a
warm horizon haze and loses saturation, brighter toward the sun) and a little morning mist
in low ground; behind the map, rolling ground and three layers of hill silhouettes recede
into that haze, with the Aegean to the west — so the 400 m valley reads as part of a big
landscape. Grass tufts sway in the wind and shorten where the flock grazes; wildflowers
grow in drifts.

**The painted ground** (`src/world/groundPaint.ts`, `src/world/terrainView.ts`,
`src/world/groundDressing.ts`). High summer: meadows gone to straw, greener in hollows, on
north-facing slopes and along the dere; red terra rossa in streaks where the grass is thin
(the maquis hills, slopes, the ploughed olive grove); pale limestone breaking out on the steep
ground, with strata and cracks; a needle-brown floor in the pine forest; the dere's bed of
rounded stones bedded in sand. Hollows sit a shade darker, ridges a shade lighter. Colours go
on in dabs with fairly hard edges, to suit the cel look, and fine detail is drawn in world
space near the camera. Roads, yards and mud get smooth edges: the shader draws the line where
a blurred mask of the hard surfaces crosses one half, instead of the 2 m steps of the surface
grid. Dressing, visual only (no colliders, no effect on play): limestone outcrops on the steep
slopes, loose stones over the rough country, and oleanders in pink and white flower along the
dere's banks, clear of the ford, in culled cells that fade out by range.

**The grass** (`src/world/grassField.ts`) is built on the GPU: one 8 m patch of ~1,800 blades
drawn in tiles around the camera, everything else worked out in the vertex shader. Blades sit on
the terrain's own triangles, take their colour from the painted ground (golden on straw, green by
the dere, olive on red earth), stand 0.25–0.8 m in drifts, are grazed short by the flock and worn
short on trails (the live grass map), bend in the meltem, and part around the shepherd, the dog,
the bike and every sheep. Every blade is drawn within ~26 m, under a third out to ~52 m and a
ninth to ~95 m, each fading as it drops out; tiles are rotated and mirrored so the patch never
visibly repeats. Kept calm on purpose: no ink outlines on blades (grass writes alpha 0 and the
post pass skips it), blades never thinner than ~0.8 px on screen, shadows taken at each blade's
root, both faces lit alike, neighbouring blades swaying together, and per-blade variety fading
with distance. With the sun behind it the grass glows at the tips, and gusts roll through as a
sheen. The CPU only picks the tiles in view. Debug panel → Look: grass on/off, density,
height. Wildflowers stand at the height of the grass heads.
Shader noise for the ground detail and the cloud shadows comes from one baked tiling texture
(`src/render/noiseTex.ts`), which keeps full-screen retina frame rates up. The 10 m greybox
grid is still under View.

**Wind, clouds and the night sky** (`src/render/wind.ts`, `src/render/post.ts`, `src/render/style.ts`).
One wind, the summer meltem from the north-north-east, moves everything: calm at dawn,
strongest in the afternoon, dropping after sunset. Gusts roll across the pastures as bands of
flattened, brighter grass; olives, cypresses, pines, maquis and the yard's fig bend with them,
and the olive groves flash the silver undersides of their leaves as a gust passes. Fair-weather
clouds drift with the wind, and their shadows (soft-edged, cool) slide across the valley, cast
along the sun's direction. At night the stars wheel about the pole, the summer Milky Way crosses
the sky, and a cel-shaded moon goes through its phases on a 29.5-day cycle tied to the calendar
(day 1 a waxing crescent, full on day 9, new around day 24). Moonlight casts shadows and opens
the night up: a full moon roughly doubles how far you can see, and a moonless night is the
darkest one. Debug panel → Look: cloud shadow, cloud cover, wind strength and direction.

The valley: the shepherd's **cottage** beside the ağıl (lime-washed stone, terracotta roof,
smoking chimney, a vine pergola over a porch set for çay; **E at the door sleeps** once the
day's tasks are done), a terraced **olive grove** behind dry-stone walls, a small **temple
ruin** in a forest clearing, cypresses, scattered pines and boulders, maquis shrubs, a stone
**çeşme** by the pen and slow clouds.

**The homestead's art pass** (`src/world/homesteadView.ts`; the buildings beyond the
homestead are still blockout, but the ground is painted, below): the ağıl is a dry-stone fold in rough courses with
on-edge coping, dry thorn brush along the top against wolves, a plank gate between stout
posts, a tiled lean-to shelter on its north wall and straw bedding on the floor. The çeşme is
an Ottoman village fountain (pointed-arch niche, marble inscription panel, brass spout,
running water, a little tiled roof). The yard has a fig tree behind the cottage, a haystack
by the ağıl, a clay tandır oven, a clothesline with the washing and a kilim out, flagstones
from the porch toward the gate, and five hens that scratch about, scatter from your feet and
huddle under the fig at night. Debug panel → View → **homestead art pass** toggles it (it
costs about 70 draw calls); **Cottage yard** is a teleport. Everything solid has a collider (`src/world/testMap.ts`)
and keeps clear of the gravel loop, the gate track and the pastures.

Music: *Tea at Mid-Morning* and *Terrace at Midday* (`public/audio/`), at 30% volume, are
**earned**: one plays on the first morning (from your first click or key press, since
browsers block autoplay), then the valley stays quiet until a moment earns the next one: the
first time the flock reaches a pasture, or you reach the hilltop or the ruins. Each song
plays once and fades out. The debug panel can play the next song now.

**Ambience** (`src/audio/ambience.ts`, all synthesized): cicadas swell through the hot middle
of the day and fall silent at sunset; crickets and a scops owl take the night. Six or seven
sheep wear copper bells (the bellwether's is the big low one): they clank as the flock
walks, now and then while it grazes, and not at all when hushed. From the village minaret
the **call to prayer** sounds at the afternoon, evening and night prayers (13:12, 16:48,
19:09, 20:36), a far thread of sound from the homestead and full in the square; time slept
through passes unheard. Ambience volume and a play-it-now button are in the debug panel. Every look setting and
the music volume are live in the debug panel under **Look (art style)**; the greybox grid and
place labels are under **View**.

## Maps

The game opens on **the valley** (`src/world/valley.ts`): about 1.2 km square, sized to the
clock (a driven flock covers ~650 m in a 13-minute day). Pastures sit in rings around the
ağıl: A near (118 m), D and dry C in the maquis (282 m), far B with the hut site (414 m) and
E at the pine forest's edge in wolf country (515 m). The lookout hill (dirt road) and a
village shell at the end of ~1.1 km of gravel road are bike country, and a dry riverbed
(the dere) runs down the valley. Uncle Ahmet's cairns mark his old routes to D, E and B.

**Uncle Ahmet's notes.** He left the paper map with his pencil marks on it (his routes,
"no water!" by C, a question mark round E) and seven notes where you will need them: a
letter on the çay table, then under stones by the dere spring, at his fallen hut by B, at the
forest's edge, at the ruin, on the lookout and by dry Pasture C. **E** reads one; each adds a
little more of his hand to the map (`src/world/valleyNotes.ts`). The journal counts them.

The greybox test map is still there for tuning and the automated tests: open
`http://localhost:5173/?map=test`. Both maps implement `MapDef` (`src/world/mapTypes.ts`);
game systems read the active map through `src/world/map.ts`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173 (?map=test for the greybox test map)
npm test         # headless sim tests (terrain, player, determinism)
npm run build    # typecheck + production build
```

## Models

The shepherd, sheep, Karabaş, wolves, and the motorcycle load from GLB files in `public/models`
and use the game's shared toon lighting. The flock assigns coat colors and proportions from
each sheep's ID. The sheep GLB also includes eight ready-colored scenes for use outside the
game. The sheep, dog, wolf, and motorcycle files can be regenerated with
`npm run build:models` after editing the sources in `scripts`.

## Controls

In game, the full list lives in the pause menu: **Esc** (or **Start**) › **Controls**, with
Keyboard & mouse and Gamepad tabs. The menu stops the world while it is open; Esc steps back
a page, and from the first page it resumes. Releasing the captured mouse with Esc opens it
too. Esc on an open card (map, note, shop, packing) closes the card first. **Options** holds
the sound and music volumes (remembered between visits) and the developer overlay switch.
On screen, only the action that fits the moment is prompted, one at a time (fill or pour the
water cans, the bike's next job, a note to read, a sheep to free); the bottom hint about looking
around and Esc fades once it has been used.

| Action | Keyboard & mouse | Gamepad |
| --- | --- | --- |
| Pause menu (controls, options) | Esc | Start |
| Move | WASD / arrows | Left stick |
| Sprint | Shift | L3 |
| Sneak | Ctrl or C | Light stick tilt |
| Camera | Mouse (click the view to capture it; Esc releases it and pauses) | Right stick |
| Crook (push cone, 6 m) | Left click | RT |
| Call (attract, 15 m) | Right click | LT |
| Open / close the pen gate | E (at the gate) | A |
| Free a stuck sheep | Hold E for 2 s next to it | Hold A |
| Pet / praise the dog | E next to him | A |
| Toggle the lantern on foot | F | D-pad up |
| Fill or pour water cans by the parked bike | R | RB |
| Work on the parked bike (the most urgent job) | Hold R | Hold RB |
| Fill Karabaş's bowl (on the porch) | E | A |
| Pick ticks off Karabaş | Hold E beside him | Hold A |
| Milk the ewes (mornings, at the stand in the ağıl) | Hold E | Hold A |
| Pick herbs · open a shop counter | E | A |
| At a counter: buy · sell · ask about work (kahvehane) · leave | 1–9 · Enter · 0 · Esc | — |
| Shear a penned sheep (summer) | Hold E beside her | Hold A |
| Press cheese (with the press, milk in the churn) | Hold E at the press | Hold A |
| Pick up a find at the ruin | E | A |
| Whistle wheel (dog commands) | Hold Q, move the mouse toward a command, release · tap Q = repeat last | Hold LB, right stick, release |
| Hush the flock (freeze, go quiet) | Hold X | Hold R3 |
| Pocket watch | Hold T | Hold D-pad ↓ |
| Paper map (drag: pencil a route, click: a mark, right-click: rub out) | M | View |
| Read the land (hatch steep ground, mud, thorns, water, worn paths) | Hold G | Hold D-pad ← |
| Sling (a warning stone where you look) | V | X |
| Use a satchel pocket | 1 / 2 / 3 | Y (D-pad → picks the pocket) |
| Pack the satchel (at home) | P | — |
| Build at a site (stakes and string) | Hold E | Hold A |
| Stack a cairn | Hold B | Hold D-pad → |
| Developer panel and overlay | ` (backquote) | — |
| Zoom | Wheel | — |

## Nights

Sunset is at 19:00; at 19:30 wolves howl from their den in the north-west forest (the
compass shows where). When you sleep, the night is resolved: sheep behind a **closed gate**
are safe if Karabaş is bonded (below bond 40, a closed pen can still lose one). Sheep left
outside, or the whole flock if the gate is open, are exposed: wolves take a few (fewer with
a well-bonded dog, never more than three) and the rest **scatter** away from the forest. The
next morning starts with finding them: wolf tracks lead in from the forest, the notebook
(J) records what happened, and Karabaş's Search (Ara) finds strays. Stay up past 20:00 and
a wolf comes to the pen, every night. **Hush** (hold X) crouches you and freezes the sheep
around you; hushed sheep are hard for a wolf to notice.

## On the road (ideas from Death Stranding)

The journey, the flock as fragile cargo, and light combat:

- **Worn trails.** Walking the same way day after day wears a path into the grass (sheep
  only, while walking). The flock follows up to 20% faster and calms faster on it, grass
  can't grow back on it, and an unused path slowly grasses over.
- **Read the land** (hold G): near the shepherd, ground too steep for sheep is hatched red,
  mud brown, thorn bushes magenta, water blue, worn paths gold. **Pencil routes** on the
  paper map before you set out (drag).
- **Things you build stay.** Two sites: **the shepherd's hut** west of Pasture B (with a
  dry-stone fold open to the east) and **a rain cistern** at dry Pasture C, marked with stakes
  and string. In the valley the hut is **Uncle Ahmet's**, fallen: knee-to-chest walls, the
  roof beams down inside, his door in the grass and the fold tumbled to heaps. Hold E at its
  doorway to **mend** it; the new walls rise from his and the rubble is used up. Hold E at the stakes to build; in-game time runs eight times faster while you work (the
  hut costs three hours of daylight), and the flock is on its own meanwhile. Sleep at the hut
  door with the flock in the fold and they are as safe as in the pen; the cistern collects 60 L
  of rain every night (and takes the bike's cans). **Cairns** (hold B) mark your way on the land
  and on the map.
- **Each sheep has a condition.** Fear, falls (thorns, slopes), midday heat with a dry throat,
  and bites wear it down; calm grazing, the pen or fold, and a night's rest mend it. Below
  half a sheep limps, and wolves single out the weak. The tesbih hatches worn-down sheep;
  the notebook (J) says how the flock is holding up.
- **The satchel** (bottom right, at home and when used): three pockets from five things,
  packed at home with P and refilled each morning you wake there. **Salve** (two a day) heals a
  hurt sheep or Karabaş; the **halter rope** frees a stuck sheep and leads her at your heel;
  a **salt lick** keeps the grazing flock around it while you work elsewhere; **çay** is half an
  hour sitting down that settles the flock and pleases Karabaş; **bread and yoghurt** feeds
  Karabaş by hand away from his bowl (and he loves you for it).
- **Wolf ground announces itself**: old bones, scat, wool on a thorn, paw prints near the
  den. Once you've seen a sign the map marks the wolves' ground; let the flock linger there
  in daylight and Karabaş grows uneasy, then a wolf comes.
- **Light combat, no game over.** The **sling** lobs a warning stone (about 20 m): wolves near
  the thud lose their nerve (three stones drive one off) and sheep near it jump away, so it
  also turns a flock from afar. Karabaş can be **bitten** charging a wolf and limps until
  salved or rested (a well-bonded dog heals faster). Sheep left out at night may come back
  **bitten** rather than taken.
- **Day 4, the far pasture:** pack for the route, take the flock to Pasture B, build the hut
  (in the valley, mend his), fold them and sleep out there. Later days are free: graze well, keep everyone safe.

## The field kit (no HUD)

Information lives on the shepherd's things: the **pocket watch** (hold T) shows the time,
with the evening marked on the dial, and ticks audibly from golden hour to sunset. The
**compass** appears when Karabaş barks or wolves howl, with a notch toward the sound. The
**tesbih** (prayer beads, one per sheep; dark = inside the pen) shows near the ağıl and
clicks as sheep pass the gate. The **paper map** (M) is a hand-drawn sheet of the valley,
contours from the real terrain, with live pencil notes: pastures hatched as they are grazed
("let it rest"), "wolves" once you have heard them, a circle round the current task's
destination, and your own marks. There is no "you are here" dot (assist toggle under
**View** in the developer panel). The developer panel, stats and text overlay are hidden
by default; backquote shows them.

## Day 1 (tasks)

The paper note at the top left is your task for the day: what to do, how (with the
controls), live progress, and where to go as distance + direction (the arrow is relative to
your camera, the compass word to the map). **J** opens the notebook with the whole day;
**`** (backquote) hides the debug overlay. Tasks are checked from the world, so any way of doing them
counts, and doing something early ticks it off.

1. Open the pen gate · 2. Lead the flock out · 3. Take it to Pasture A · 4. Let it graze an hour ·
5. Pet Karabaş · 6. Have him gather the flock · 7. Leave the flock with him (Hold) and walk 50 m
away · 8. Find the missing ewe · 9. Free her from the thorns · 10. Bring her back ·
11. Keep the flock safe from a wolf · 12. Everyone home and the gate closed before 19:00.

The first night watch starts at **20:00** on Day 1. If you finish early, press **E**
at the cottage door (or **N**) to rest until dark. A wolf probes the pen, and Karabaş
barks and moves to defend the flock on his own. Use **F** (D-pad up) to light the lantern.
Once the wolf retreats, use the same rest control to sleep.
The sky and lighting follow the in-game clock. At 18:00, three descending bell notes
and a message cue golden hour. At 19:00 the notebook records how many sheep are safely
inside the closed pen. If the gate is open, it shows how many were inside but unsecured.
Resting through sunset uses the pen state at bedtime for the sunset tally.

**Day 2 — the motorcycle** (sleep after Day 1, or start it from the debug panel):
get on · kick-start · ride to the loop · one lap · a lap under 2:00 without falling · up the
hill on the dirt road · try the muddy flank · scout Pasture C · park 25 m from the sheep and walk in.

Debug panel → **Day tasks**: restart Day 1, start Day 2, skip a task. The M2 trial and M3 test
setups pause the tasks while they run.

**Day 3 — water.** Sheep get thirsty as time passes, faster around midday. They pant
and seek nearby water when calm. The çeşme and its pen trough provide water at home,
and Pastures A and B have springs. Pasture C is dry. Lead the flock to a spring and
step back while they drink, or park the bike near a spring or the çeşme and press **R**
(**RB**) beside it to fill two 20 L cans. Park at C, stand on clear ground beside the bike,
and press **R** once per can to pour into a folding basin. As sheep drink, its supply runs down.
Both routes count toward Day 3. Use **Day tasks → Start Day 3 (water)** to try it directly.

## The village and the purse (feature 6, first slice)

`src/economy/economy.ts`, `src/ui/shopView.ts`, `src/world/economyView.ts`. You start with 120 ₺.

- **Milk.** Mornings until 11:00, with most of the flock penned, hold E at the milking stand inside
  the ağıl: an hour passes in eight seconds and about 0.55 L per ewe goes into the churn by the
  gate (more when the flock ate and drank well yesterday). Hold R at the bike beside the churn to
  load it, ride to the village and sell it at **Fatma Hanım's dairy** (4 ₺ a litre). Milk not sold
  by 20:00 turns.
- **Herbs.** Nine patches: wild thyme on the dry hills round Pasture C (3 ₺), sage by the ruins
  (5 ₺), mountain tea on the lookout (12 ₺). E picks a bundle; each grows back overnight. **Hüseyin
  Efendi's bakkal** buys them and sells kibble (70 ₺ for 14 meals).
- **Usta Remzi** (the mechanic) fills the tank (5 ₺ a litre, bike beside the pump), sells a 10 L
  jerrycan for the drum (45 ₺), tyre patches (3 for 15 ₺) and chain oil (5 oilings, 12 ₺). Patching
  a tyre uses a patch and oiling the chain uses oil; without them those jobs wait.
- **Kemal's kahvehane**: a glass of çay (2 ₺) and half an hour sitting, and somebody always has news
  (where the wolves were seen, coins in the ruins, what the dairy pays for).
- The notebook (J) shows the purse and today's takings and spending.
- **Finds (6c).** About one night in three it rains hard, and in the morning one or two things
  glint in the mud round the ruin: a bronze coin (20–60 ₺), a clay oil lamp (80–150 ₺) or an
  inscribed fragment (200–500 ₺). E picks them up. **Selim Bey at the museum** pays 40% and tells you
  about each piece, adding to your map (the old Roman road, a sacred spring, an ancient fold); **the
  man round the back of the kahvehane** pays full price and asks nothing.
- **Upgrades (6c)**, one purchase each: a tick collar at the bakkal (120 ₺, a quarter of the ticks);
  at the dairy a cheese press (300 ₺); at Usta Remzi's a spiked collar (250 ₺, a wolf can hardly bite
  Karabaş), off-road tyres (350 ₺, a third of the punctures, more grip in mud) and a reinforced ağıl
  (400 ₺, a closed pen is safe whatever the bond; a palisade goes up on the walls).
- **Cheese.** With the press by the cottage, hold E there with milk in the churn: every 6 L makes a
  wheel of white cheese (an hour's work). Wheels age on the shelf; after three days the dairy pays
  55 ₺ a wheel (30 fresh), times the milk's quality.
- **Balance.** Milk brings about 53 ₺ a day against about 14 ₺ of upkeep: after a week you can afford
  one of the big upgrades, not two (`tests/economy.test.ts` keeps it that way). Herbs and finds are
  the bonus for the diligent.

### Village life (6d)

- **The calendar.** Day 1 is a Monday; the first 28 days are summer, then autumn. The notebook's
  header says which (`src/economy/calendar.ts`).
- **The vet, Dr. Aylin,** sets up a table under a red parasol on the square on Thursdays: she looks
  Karabaş over (25 ₺, bring him: ticks off, bites seen to) and sells a tonic for the flock (45 ₺,
  every sheep wakes 25 points stronger).
- **Shearing (summer).** Hold E beside a sheep in the ağıl: a fleece each (time runs fast, about 20
  minutes a sheep), worth 15 ₺ times how well she is, sold at the bakkal. Each sheep once a season;
  shorn sheep look slimmer and paler.
- **Errands from Kemal** (at the kahvehane counter, 0): thyme for his tea (4 bundles, 45 ₺), Mehmet's
  runaway goat (find her in the maquis and tie her up with E, 70 ₺), cheese for a wedding (2 aged
  wheels, 160 ₺, once you have the press). One at a time, a new one the next day; rewards rise by a
  fifth each time round. Each errand raises your **standing**: 5% off in every shop per point, up to
  15%.
- Not in 1.0: lambs and the weekly market (spring only), the sidecar.

## Saving (6b)

The game saves itself at every dawn (after you sleep) in the browser's storage, and loads it the
next time you open the page: the purse and supplies, upgrades, cheese and finds, the flock (who is
left, how they are, where they slept), Karabaş and his care, the bike and its wear, the grass and
worn paths, what you built, the cistern, the notes read, the signs seen, the satchel and last
night's report (`src/core/save.ts`, about 1 MB in the valley). Open `?new` to start fresh; the debug
panel's **Save** folder can save now or forget the save.

## The motorcycle

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Get on / off | E next to it | A (hold 0.6 s to get off) |
| Kick-start (needle in the green) | Space | A |
| Throttle / brake | W / S (ramped) | RT / LT (analog) |
| Steer | A / D | Left stick |
| Shift weight fore/aft | Alt + mouse up/down | Right stick |
| Clutch-drop launch | hold S + W, release S | hold LT + RT, release LT |
| Horn (sheep jump, wolves lose nerve) | H | B |
| Headlamp | F | D-pad up |
| Lift a fallen bike | hold E | — |

70 km/h on asphalt, about 35 on gravel, 12 in mud. Grip comes from the surface; driving or
braking in a turn uses up cornering grip and the rear steps out: steer into the slide and
ease off. Past 40° of slide you come off; so do hard hits, and stopping on ground steeper
than 20° before your foot is down. Packed dirt climbs the 25° hill; mud does not. The engine
frightens sheep within 25 m. The lap timer starts where the gate track meets the loop.

**Care (feature 5, `src/bike/care.ts`).** The bike wears as you use it, and neglect shows on the
road:

| Part | Wears from | Symptom | Fix: hold R at the parked bike |
| --- | --- | --- | --- |
| Fuel (6 L tank, about 15 km in the valley) | distance, idling | sputters, then dies | at home: pour from the jerrycan and shake in the oil (4 s; Uncle Ahmet's drum holds 30 L) |
| Spark plug | riding, idling, kicks | misfires (worse at golden hour), takes several kicks | unscrew, wire-brush, re-gap (6 s) |
| Carburettor | dust on gravel and dirt | weak pull, stalls at idle | blow the jet clean (10 s) |
| Tyre | thorns in the maquis, rocks | slow leak, wobble, then flat (a 12 km/h crawl) | find the hole, patch, pump (15 s) |
| Chain | distance, much more in mud | clanks and skips under load | oil and tension (8 s) |

Holding R does the most urgent job first; the prompt says which, and you can let go and come
back to it. The dash shows the fuel. Spare parts and fuel to buy come with the village
(feature 6).

## Herding

Sheep follow the dark **bellwether**. Two ways to move them:

- **Lead:** call (right click) and walk away; the bellwether follows you and the flock follows her.
  Lead her into the pen and the rest file in after her.
- **Drive:** walk up behind the flock; sheep in front of you move on ahead. Sprinting widens the
  flight zone (11 m) and stresses them; sneaking lets you get close (3.5 m). Correct the course by
  stepping sideways, as the flock tends to follow the bellwether's line.
- **Crook** (left click) sends sheep in a 6 m cone running along the swing.

A sheep more than 40 m from the bellwether loses contact; after 30 s more than 35 m from the
flock it counts as a **stray**. Fleeing sheep can get **caught in thorns**, and sheep trying to
climb a steep slope get **stuck** ("!" marker): hold E next to them. Grazing eats the grass
overlay down; pastures regrow over in-game days.

## The Kangal (Karabaş)

| Command | Whistle | Gesture (within 25 m, in sight: silent) | What he does |
| --- | --- | --- | --- |
| Topla — Gather | two rising notes | arm sweeps in a circle | Runs wide round the far side of the flock, then presses it toward you |
| Bekle — Hold | one long note | flat palm | Holds the flock where it is: lies by it; if grazing draws the flock 6 m off, goes round and walks into the drifting edge to turn it back; fetches any lone sheep past 20 m (round the flock, never through it) |
| Ara — Search | three short notes | point and flick | Finds strays and stuck sheep (biased where you look), barks, frees slope-stuck ones, brings strays back |
| Saldır — Attack | sharp falling note | point hard | Charges the wolf you point at (or the nearest); bluffs and comes back if there is none |
| Gel — Heel | short-short-long | pat your leg | Walks at your left side |

Whistles carry 150 m and make nearby sheep jump; gestures are silent but need him close and
in sight. He always flicks his ears at once; **bond** (debug slider, petting, praise right after
a finished command) sets how long he takes to act (2 s at 0 → 0.3 s at 100) and whether he
ignores you (30% at 0). Running drains **stamina**; when empty he lies down until it is back to 40.
On his own he patrols the flock or rests on its edge, and he meets wolves by himself:
alert bark → stands between wolf and flock → charges (never more than 60 m from the flock).

**Care (feature 5, `src/dog/care.ts`).** Karabaş gets hungry (−4/h, twice as fast running) and
thirsty (−6/h, twice as fast in the midday heat). Hungry, he gets his wind back at half speed;
thirsty, he won't run. Left to himself he drinks at any trough, spring, cistern or basin within
60 m and goes to his bowl when it has food in it. Fill the bowl on the porch with E (Uncle Ahmet's
sack by the woodpile holds 14 meals) or feed him **bread and yoghurt** from the satchel. Moving
through maquis and pines he picks up **ticks** (up to 5, each −5% stamina); hold E beside him and
he lies still while you pick them off. Each night costs bond if you didn't pet him that day, if
he went to sleep hungry, and for every tick still on him; a full bowl at home is eaten overnight.
His tail and ears show it: low and back when he's in need, and he stops to scratch when the ticks
itch. The notebook (J) says how he is in words; later days have a "See to Karabaş" task.

The **Kangal tests (M3)** folder sets up each acceptance check (scattered flock to gather, flock to
hold, a stray in the ravine on the test map or by the dere in the valley, a wolf from the den's
side) and shows the live result in the overlay. All of them pass on both maps
(`tests/dog.test.ts`, `tests/valleyScenarios.test.ts`).

**Herding trial** (debug panel): resets, then times you taking the flock from the pen to the
trial pasture and back with the gate closed: Pasture B on the test map, Pasture D in the valley
(both about 260–280 m out). GDD target: under 8:00, at most 2 strays.

**Frame-rate check** (debug panel → Performance; `src/debug/bench.ts`): a fixed tour of seven
heavy views (the ağıl with the flock, the cottage yard, the lookout over the valley, a pasture,
the forest edge, the ruins, the village square). At each it records median and p95 frame time,
CPU time in the sim and in rendering (with the three biggest costs), draw calls and
triangles, and logs a table to the console. Keep the window visible: a hidden tab is
throttled. Measured on 2026-11-20 on the developer's Mac (120 Hz, Apple GPU): 141–145 fps
everywhere at both 1× and 2× pixel density, 2.6–3.9 ms of render CPU per frame, 1.4–1.7 M
triangles. Grass tufts are drawn within 180 m of the camera and flowers within 260 m (they
shrink away at the edge), and the terrain is drawn in culled 200 m chunks.

The debug panel (top right) tunes every constant live, teleports to each test-map feature,
toggles the 10 m grid and collider wireframes, and records/replays input to check determinism.

## Layout

```text
src/
  main.ts        bootstrap: renderer, scene, loop, debug
  sim.ts         headless simulation (fixed 60 Hz step), reset, teleport
  core/          config, fixed-step loop, input mapper, event bus
  flock/         sheep data, flock simulation (modes, steering, strays, stuck), view
  dog/           Kangal layered AI, commands, view
  predators/     flock-stalking wolf, night pen probe + view
  bike/          motorcycle model, lap timer, view
  audio/         background music; synthesized whistles, barks, engine (Web Audio);
                 ambience (cicadas, crickets, owl, sheep bells, the ezan)
  render/        toon materials, lights + sky, backdrop landscape, post pass (haze, outlines)
  world/         noise, terrain, test map, Rapier world, obstacles, grass map, spatial hash,
                 vegetation (grass tufts, wildflowers), house + environment views, the
                 homestead art pass (ağıl, çeşme, yard, hens),
                 works (hut, fold, cistern, cairns) + their view, wolf signs, trails
  player/        character controller (sim), satchel, view, camera rig
  debug/         record/replay, herding trial timer, M3 scenarios
  tasks/         task system + Days 1–4 and free days (run inside the sim, deterministic)
  ui/            field kit (watch, compass, tesbih), paper map, satchel + packing card,
                 task card + journal, whistle wheel, bike dash, developer panel + overlay
tests/           Vitest: terrain vs physics, player, flock, grass, determinism, the full M2
                 trip by a scripted shepherd, the M3 dog acceptance checks (dog.test.ts),
                 the Day 1 task chain (tasks.test.ts), bike physics (bike.test.ts) and the
                 M4 acceptance + Day 2 on the real map (bikeMap.test.ts), and the
                 environment: placements, collisions, the door (environment.test.ts),
                 nights (night.test.ts) and the road: trails, condition, satchel, sling,
                 wolf ground, building, arrivals, injuries, Day 4 (journey.test.ts)
```

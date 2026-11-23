// Greybox debug tooling: lil-gui tuning panel, a text overlay with sim state,
// teleports to every test-map feature, collider/flock views, the herding trial
// timer and replay controls. Not the game UI: the diegetic UI comes after the greybox.

import { Economy, HERBS, SHOPS } from '../economy/economy';
import GUI from 'lil-gui';
import { config } from '../core/config';
import type { Music } from '../audio/music';
import type { Ambience } from '../audio/ambience';
import type { Replay } from '../debug/replay';
import { postSettings } from '../render/post';
import { windSettings } from '../render/wind';
import { grassSettings } from '../world/grassField';
import { mapSettings } from './paperMap';
import type { Scenarios } from '../debug/scenarios';
import type { Trial } from '../debug/trial';
import { MODE_NAMES } from '../flock/sheep';
import type { Sim } from '../sim';
import { SURFACE_NAMES } from '../world/terrain';
import { activeMap, layout } from '../world/map';
import { CAN_LITERS, RACK_CANS } from '../world/water';

export interface DebugHooks {
  setGrid(on: boolean): void;
  setColliders(on: boolean): void;
  /** Show or hide the homestead's art pass (to compare with the greybox, or its frame cost). */
  setHomesteadArt(on: boolean): void;
}

const fmtHour = (h: number) => {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export class DebugUI {
  readonly gui = new GUI({ title: 'Greybox debug' });
  private hud: HTMLElement;
  private prompt: HTMLElement;
  private lastPrompt = '';
  private replayCtl: { status: string };
  private trialCtl: { status: string };

  private dogCtl = { bond: 50, stamina: 100 };

  constructor(
    private sim: Sim,
    private replay: Replay,
    private trial: Trial,
    private scenarios: Scenarios,
    music: Music,
    ambience: Ambience,
    hooks: DebugHooks,
  ) {
    this.hud = document.getElementById('hud')!;
    this.prompt = document.getElementById('prompt')!;
    const g = this.gui;

    const tk = g.addFolder('Day tasks');
    tk.add(
      {
        go: () => {
          sim.reset();
          sim.tasks.enabled = true;
          scenarios.stop();
          trial.stop();
        },
      },
      'go',
    ).name('↺ Restart Day 1');
    tk.add(
      {
        go: () => {
          sim.startDay(2);
          scenarios.stop();
          trial.stop();
        },
      },
      'go',
    ).name('▶ Start Day 2 (motorcycle)');
    tk.add({
      go: () => {
        sim.startDay(3);
        scenarios.stop();
        trial.stop();
      },
    }, 'go').name('▶ Start Day 3 (water)');
    tk.add({
      go: () => {
        sim.startDay(4);
        scenarios.stop();
        trial.stop();
      },
    }, 'go').name('▶ Start Day 4 (far pasture)');
    tk.add({ go: () => sim.tasks.skip() }, 'go').name('⏭ Skip current task');

    const sc = g.addFolder('Kangal tests (M3)');
    sc.add({ go: () => scenarios.gather() }, 'go').name('▶ Gather: scattered flock, < 30 s');
    sc.add({ go: () => scenarios.holdTest() }, 'go').name('▶ Hold: walk 100 m away, 3 min');
    sc.add({ go: () => scenarios.search() }, 'go').name(`▶ Search: stray in ${activeMap().scenario.lostWhere}, < 60 s`);
    sc.add({ go: () => scenarios.wolf() }, 'go').name('🐺 Send a wolf from the forest');
    sc.add({ go: () => scenarios.stop() }, 'go').name('■ Stop test');

    const dg = g.addFolder('Kangal');
    dg.add(this.dogCtl, 'bond', 0, 100, 1)
      .name('bond (delay, obedience)')
      .listen()
      .onChange((v: number) => (sim.dog.bond = v));
    dg.add(this.dogCtl, 'stamina', 0, 100, 1)
      .listen()
      .onChange((v: number) => (sim.dog.stamina = v));
    const ds = dg.addFolder('Speeds m/s');
    ds.add(config.dog.speeds, 'walk', 0.5, 3, 0.1);
    ds.add(config.dog.speeds, 'trot', 1.5, 6, 0.1);
    ds.add(config.dog.speeds, 'run', 3, 12, 0.1);
    ds.close();
    const dz = dg.addFolder('Ranges m');
    dz.add(config.dog, 'gestureRange', 5, 60, 1);
    dz.add(config.dog, 'whistleRange', 30, 300, 5);
    dz.add(config.dog, 'leash', 20, 150, 5);
    dz.add(config.dog.sheepFlightZone, 'walk', 0, 15, 0.5).name('sheep zone walking');
    dz.add(config.dog.sheepFlightZone, 'run', 0, 20, 0.5).name('sheep zone running');
    dz.add(config.dog, 'bunchRadius', 0, 40, 1).name('bunch radius (gather)');
    dz.add(config.dog.hold, 'radius', 5, 40, 1).name('hold radius');
    dz.close();
    const sta = dg.addFolder('Stamina');
    sta.add(config.dog.stamina, 'runDrainPerSec', 0, 20, 0.5);
    sta.add(config.dog.stamina, 'trotDrainPerSec', 0, 10, 0.5);
    sta.add(config.dog.stamina, 'regenPerSec', 0, 20, 0.5);
    sta.close();
    dg.close();

    const tr = g.addFolder('Herding trial (M2 test)');
    this.trialCtl = { status: trial.status };
    tr.add({ start: () => trial.start() }, 'start').name(`▶ Start (resets): pen → Pasture ${trial.pasture.id} → pen`);
    tr.add({ stop: () => trial.stop() }, 'stop').name('■ Stop');
    tr.add(this.trialCtl, 'status').listen().disable();

    const fl = g.addFolder('Flock');
    fl.add(config.flock, 'count', 15, 30, 1).name('sheep (on reset)');
    fl.add({ reset: () => sim.reset() }, 'reset').name('Reset flock to pen');
    const sp = fl.addFolder('Speeds m/s');
    sp.add(config.flock.speeds, 'graze', 0.1, 1.5, 0.05);
    sp.add(config.flock.speeds, 'follow', 0.5, 4, 0.05);
    sp.add(config.flock.speeds, 'flee', 1, 6, 0.1);
    sp.add(config.flock.speeds, 'panic', 2, 8, 0.1);
    sp.close();
    const fz = fl.addFolder('Flight zone m');
    for (const k of ['idle', 'sneak', 'walk', 'sprint'] as const) fz.add(config.flock.flightZone, k, 1, 20, 0.5);
    fz.add(config.flock, 'pressureConeDeg', 0, 90, 1).name('pressure cone ½°');
    fz.add(config.flock, 'pressureForwardBlend', 0, 2, 0.05).name('push forward blend');
    fz.close();
    const rd = fl.addFolder('Radii m');
    rd.add(config.flock, 'separationRadius', 0.6, 3, 0.05);
    rd.add(config.flock, 'alignRadius', 1, 15, 0.5);
    rd.add(config.flock, 'cohesionRadius', 2, 20, 0.5);
    rd.add(config.flock, 'followDistance', 3, 30, 1);
    rd.add(config.flock, 'awareness', 15, 80, 1);
    rd.close();
    const st = fl.addFolder('Stress & calls');
    st.add(config.flock.stress, 'zoneGain', 0, 100, 1).name('zone gain /s');
    st.add(config.flock.stress, 'decay', 0, 20, 0.5).name('decay /s');
    st.add(config.flock.stress, 'scatterAt', 0, 100, 1);
    st.add(config.flock.stress, 'panicAt', 0, 100, 1);
    st.add(config.flock.call, 'followSeconds', 1, 30, 1).name('call follow s');
    st.add(config.flock.call, 'leaderFollowSeconds', 1, 40, 1).name('bellwether follow s');
    st.add(config.flock.call, 'stopDistance', 1, 10, 0.5).name('call stop m');
    st.close();
    const wt = fl.addFolder('Steering weights');
    for (const mode of ['graze', 'follow', 'flee', 'penned', 'bunch'] as const) {
      const f = wt.addFolder(mode);
      for (const k of Object.keys(config.flock.weights[mode]) as (keyof typeof config.flock.weights.graze)[])
        f.add(config.flock.weights[mode], k, 0, 4, 0.05);
      f.close();
    }
    wt.add(config.flock, 'avoidWeight', 0, 5, 0.1);
    wt.close();
    fl.close();

    const pl = g.addFolder('Player');
    pl.add(config.player, 'walkSpeed', 0.5, 4, 0.05).name('walk m/s');
    pl.add(config.player, 'sprintSpeed', 2, 9, 0.1).name('sprint m/s');
    pl.add(config.player, 'sneakSpeed', 0.2, 2, 0.05).name('sneak m/s');
    pl.add(config.player, 'acceleration', 2, 30, 0.5);
    pl.add(config.player, 'turnRate', 2, 30, 0.5);
    pl.add(config.player, 'crookRange', 2, 12, 0.5).name('crook range m');
    pl.add(config.player, 'crookHalfAngleDeg', 10, 90, 1).name('crook half-angle°');
    pl.add(config.player, 'callRadius', 5, 40, 1).name('call radius m');
    pl.close();

    const cam = g.addFolder('Camera');
    cam.add(config.camera, 'distance', config.camera.minDistance, config.camera.maxDistance, 0.1).listen();
    cam.add(config.camera, 'height', 0.5, 3, 0.05);
    cam.add(config.camera, 'shoulder', -1.5, 1.5, 0.05);
    cam.add(config.camera, 'fov', 40, 90, 1);
    cam.add(config.camera, 'mouseSensitivity', 0.0005, 0.008, 0.0001);
    cam.add(config.camera, 'stickSensitivity', 0.5, 6, 0.1);
    cam.close();

    const time = g.addFolder('Time');
    time.add(config.time, 'timeScale', 0, 4, 0.05).name('sim speed ×');
    time.add(config.time, 'secondsPerHour', 5, 120, 1).name('real s per game h');
    time.close();

    const tp = g.addFolder('Teleport');
    const spots = activeMap().teleports();
    for (const [name, [x, z]] of Object.entries(spots)) {
      tp.add(
        {
          go: () => {
            if (name !== 'To the flock') return sim.teleport(x, z);
            const c = sim.flock.centroid;
            sim.teleport(c.x + 8, c.z + 8);
          },
        },
        'go',
      ).name(name);
    }
    tp.close();

    const look = g.addFolder('Look (art style)');
    look.add(postSettings, 'enabled').name('post effects');
    look.add(postSettings, 'hazeDistance', 100, 1500, 10).name('haze distance m');
    look.add(postSettings, 'hazeCurve', 0.6, 3, 0.05).name('haze curve');
    look.add(postSettings, 'hazeMax', 0, 1, 0.01).name('haze max');
    look.add(postSettings, 'desaturate', 0, 1, 0.01).name('distance desaturate');
    look.add(postSettings, 'mist', 0, 1, 0.01).name('morning mist');
    look.add(postSettings, 'mistHeight', 0.5, 10, 0.1).name('mist height m');
    look.add(postSettings, 'outline', 0, 1, 0.01).name('outline strength');
    look.add(postSettings, 'outlineThreshold', 0.005, 0.2, 0.001).name('outline threshold');
    look.add(postSettings, 'warmth', -0.2, 0.2, 0.005).name('warmth');
    look.add(postSettings, 'vignette', 0, 1, 0.01);
    look.add(postSettings, 'cloudShadow', 0, 0.8, 0.01).name('cloud shadow');
    look.add(postSettings, 'cloudCover', 0, 1, 0.01).name('cloud cover');
    look.add(windSettings, 'strength', 0, 3, 0.05).name('wind strength');
    look.add(windSettings, 'fromDeg', 0, 360, 5).name('wind from (°)');
    look.add(grassSettings, 'enabled').name('grass');
    look.add(grassSettings, 'density', 0, 1, 0.05).name('grass density');
    look.add(grassSettings, 'height', 0.3, 2, 0.05).name('grass height');
    look.add(postSettings, 'msaa', [0, 2, 4]).name('anti-aliasing (MSAA samples)');
    look.add(postSettings, 'renderScale', 0.5, 1, 0.05).name('render scale');
    look.add(music, 'volume', 0, 1, 0.01).name('music volume');
    look.add({ song: () => music.cue() }, 'song').name('music: play the next song now');
    look.add(ambience, 'volume', 0, 1.5, 0.01).name('ambience volume');
    look.add(
      {
        ezan: () => {
          const mi = layout.village?.minaret;
          if (!mi) return;
          ambience.callToPrayer({ x: mi.x, y: sim.terrain.heightAt(mi.x, mi.z) + mi.h - 2, z: mi.z }, sim.player.pos);
        },
      },
      'ezan',
    ).name('ambience: call to prayer now');
    look.close();

    const dbg = g.addFolder('View');
    dbg.add(config.debug, 'showLabels').name('place labels');
    dbg.add(mapSettings, 'showMyPosition').name('map: show my position (assist)');
    dbg.add(config.debug, 'showSheepModes').name('sheep modes & strays');
    dbg.add(config.debug, 'showSheepForces').name('steering forces');
    dbg.add(config.debug, 'showGrass').name('grass overlay');
    dbg.add(config.debug, 'showGrid').name('10 m grid').onChange((v: boolean) => hooks.setGrid(v));
    dbg.add(config.debug, 'showColliders').name('colliders').onChange((v: boolean) => hooks.setColliders(v));
    dbg.add({ art: true }, 'art').name('homestead art pass').onChange((v: boolean) => hooks.setHomesteadArt(v));

    const rp = g.addFolder('Record / replay');
    this.replayCtl = { status: replay.status };
    rp.add({ rec: () => replay.startRecording() }, 'rec').name('● Record (resets to spawn)');
    rp.add({ stop: () => replay.stopRecording() }, 'stop').name('■ Stop');
    rp.add({ play: () => replay.startReplay() }, 'play').name('▶ Replay and compare');
    rp.add(this.replayCtl, 'status').listen().disable();
    rp.close();
  }

  update(info: { fps: number; steps: number; pointerLocked: boolean; device: string }): void {
    const sim = this.sim;
    const p = sim.player;
    const t = sim.terrain;
    const f = sim.flock;
    this.replayCtl.status = this.replay.status;
    this.trialCtl.status = this.trial.status;
    this.dogCtl.bond = Math.round(sim.dog.bond);
    this.dogCtl.stamina = Math.round(sim.dog.stamina);
    const surf = SURFACE_NAMES[t.surfaceAt(p.pos.x, p.pos.z)];
    const slope = t.slopeDegAt(p.pos.x, p.pos.z);
    const modes = MODE_NAMES.map(() => 0);
    for (const s of f.sheep) modes[s.mode]++;
    const modeText = MODE_NAMES.map((n, i) => (modes[i] ? `${n} ${modes[i]}` : '')).filter(Boolean).join(' · ');
    const grass = layout.pastures.map((pa) => `${pa.id} ${Math.round(sim.grass.meanIn(pa.x, pa.z, pa.r) * 100)}%`).join(' ');
    const thirsty = f.sheep.filter((s) => s.thirst >= config.flock.thirst.seekAt).length;
    const drinking = f.sheep.filter((s) => s.drinking).length;
    const lines = [
      `${fmtHour(sim.hour)}   ${info.fps.toFixed(0)} fps   ${info.steps} steps/frame   tick ${sim.tick}`,
      `pos ${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}   ${surf}   slope ${slope.toFixed(0)}°`,
      `${p.gait}  ${p.speed.toFixed(2)} m/s   ${p.grounded ? 'grounded' : 'airborne'}   input: ${info.device}`,
      `flock ${f.sheep.length}: in pen ${f.inPen} · strays ${f.strays} · stuck ${f.stuck}   gate ${sim.gateOpen ? 'OPEN' : 'closed'}`,
      `  ${modeText}   AI ${f.lastStepMs.toFixed(2)} ms`,
      `  grass A/B/C: ${grass}`,
      `  thirsty ${thirsty} · drinking ${drinking} · rack ${sim.bike.waterCans}/${RACK_CANS} cans`,
    ];
    const d = sim.dog;
    const cmd = d.pending ? `${d.pending.command} (listening)` : d.command ?? '—';
    lines.push(
      `Karabaş: ${d.active} · ${d.state} · command ${cmd} · stamina ${d.stamina.toFixed(0)}/${d.care.staminaMax.toFixed(0)} · bond ${d.bond.toFixed(0)}${d.exhausted ? ' · EXHAUSTED' : ''}`,
      `  fed ${d.care.satiety.toFixed(0)} · water ${d.care.hydration.toFixed(0)} · ticks ${d.care.ticks} · bowl ${d.care.bowl.meals ? 'full' : 'empty'} · sack ${d.care.sack} · petted today ${d.care.pettedToday ? 'yes' : 'no'}`,
    );
    const bk = sim.bike;
    lines.push(
      `upgrades ${[...sim.economy.upgrades].join(', ') || 'none'} · finds carried ${sim.economy.artifacts.length}, at the ruin ${sim.finds.length} · cheese ${sim.economy.cheese.map((w) => w.age).join('/') || 'none'} · museum ${sim.economy.museumGiven}`,
      `purse ${Math.round(sim.economy.lira)} ₺ · milk churn ${sim.economy.churn} L, rack ${sim.economy.rackMilk} L (quality ${sim.economy.milkQuality}) · herbs ${sim.economy.herbCount} · patches ${sim.economy.patches} · chain oil ${sim.economy.chainOil}`,
      `bike care: fuel ${bk.care.fuel.toFixed(1)} L (drum ${bk.care.drum.toFixed(0)}) · plug ${bk.care.plug.toFixed(0)} · carb ${bk.care.carb.toFixed(0)} · chain ${bk.care.chain.toFixed(0)} · tyre ${bk.care.pressure.toFixed(0)}${bk.care.leak ? ' leaking' : ''} · ${bk.care.odometerKm.toFixed(1)} km`,
      `bike: ${bk.state}${bk.rider ? ' (riding)' : ''} · ${bk.engineOn ? `${Math.round(bk.rpm)} rpm g${bk.gear}` : 'engine off'} · ${bk.kmh.toFixed(0)} km/h · slip ${((bk.beta * 180) / Math.PI).toFixed(0)}° · lean ${((bk.lean * 180) / Math.PI).toFixed(0)}° · falls ${bk.falls}`,
    );
    if (sim.wolves.list.length || sim.wolves.bites) lines.push(`  wolves ${sim.wolves.list.length} (${sim.wolves.list.map((w) => w.state).join(', ')}) · bites ${sim.wolves.bites}`);
    if (this.scenarios.name !== 'none') lines.push(`[test] ${this.scenarios.status}`);
    if (this.trial.phase !== 'off') lines.push(`[trial] ${this.trial.status}`);
    if (this.replay.mode !== 'idle') lines.push(`[${this.replay.mode}] ${this.replay.status}`);
    this.hud.textContent = lines.join('\n');
    document.body.classList.toggle('locked', info.pointerLocked);

    // Context prompt (greybox stand-in for diegetic cues).
    let prompt = '';
    // Water cans: filling whenever the parked bike is by a çeşme or spring; pouring only where
    // it helps (an existing basin, or thirsty sheep close by), not every time you pass the bike.
    const water = sim.waterAction;
    const thirstyNear = () =>
      f.sheep.some((s) => s.thirst >= config.flock.thirst.drinkAt && Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < 30);
    const waterPrompt =
      water?.kind === 'fill'
        ? `R — fill the water cans at ${water.source}`
        : water?.kind === 'pour' && (sim.water.basinNear(p.pos.x, p.pos.z) || thirstyNear())
          ? `R — pour a can, ${CAN_LITERS} L (${bk.waterCans} left)`
          : '';
    const site = !bk.rider ? sim.works.siteNear(p.pos.x, p.pos.z) : null;
    const note = !bk.rider ? sim.noteNear(p.pos.x, p.pos.z) : null;
    if (sim.brewing > 0) prompt = 'Brewing çay… the flock settles';
    else if (sim.hushing) prompt = 'Hush… the flock stands still and quiet';
    else if (site)
      prompt = `Hold E — ${site.repair ? 'mend' : 'build'} ${site.name} (${site.hours} hours of work)${site.progress > 0 ? ` · ${Math.round(site.progress * 100)}%` : ''}`;
    else if (sim.works.cairnProgress > 0) prompt = 'Stacking a cairn…';
    else if (sim.works.nearHutDoor(p.pos.x, p.pos.z))
      prompt = sim.tasks.finished ? 'E — sleep at the hut, beside the fold' : 'The hut. Sleep here once the day’s work is done';
    // Riding: only what the moment needs (horn, lamp and weight shift live in Esc › Controls).
    else if (bk.rider) prompt = !bk.engineOn ? 'Space — kick-start (in the green)' : Math.abs(bk.speed) < 0.5 ? 'E — get off' : '';
    else if (sim.nearGate(p.pos.x, p.pos.z)) prompt = `E — ${sim.gateOpen ? 'close' : 'open'} the gate`;
    else if (note && !sim.notesRead.has(note.id)) prompt = `E — read ${note.where}`;
    else if (sim.shopNear(p.pos.x, p.pos.z)) {
      const s = SHOPS[sim.shopNear(p.pos.x, p.pos.z)!.id];
      prompt = `E — ${s.keeper} · ${s.name}`;
    } else if (sim.findNear(p.pos.x, p.pos.z)) prompt = 'E — something glints in the mud: pick it up';
    else if (sim.goat && Math.hypot(sim.goat.x - p.pos.x, sim.goat.z - p.pos.z) < 2) prompt = 'E — tie up Mehmet’s goat';
    else if (sim.shearingNow || sim.sheepToShear(p.pos.x, p.pos.z))
      prompt = `Hold E — shear her (${sim.flock.sheep.filter((s) => !s.shorn).length} left)${sim.shearProgress > 0 ? ` ${Math.round(sim.shearProgress * 100)}%` : ''}`;
    else if (sim.herbNear(p.pos.x, p.pos.z)) prompt = `E — pick ${HERBS[sim.herbNear(p.pos.x, p.pos.z)!.kind].name}`;
    else if (sim.pressingNow || sim.canPress(p.pos.x, p.pos.z))
      prompt = `Hold E — press the milk into cheese (${Math.floor(sim.economy.churn / config.economy.cheese.litresPerWheel)} wheels)${sim.pressProgress > 0 ? ` ${Math.round(sim.pressProgress * 100)}%` : ''}`;
    else if (sim.milkingNow || sim.canMilk(p.pos.x, p.pos.z))
      prompt = `Hold E — milk the ewes (about ${Economy.milkYield(sim.sheepInPen, sim.economy.milkQuality)} L)${sim.economy.milking > 0 ? ` ${Math.round(sim.economy.milking * 100)}%` : ''}`;
    else if (sim.nearDoor(p.pos.x, p.pos.z)) {
      if (!sim.tasks.finished) prompt = 'Home. Rest here when the day’s work is done';
      else if (sim.firstNightPending) prompt = 'E — rest until dark';
      else if (!sim.nightWatchActive) prompt = 'E — sleep until morning';
    } else if (sim.nearBike(p.pos.x, p.pos.z) && bk.state === 'fallen')
      prompt = `Hold E — lift the bike${bk.liftProgress > 0 ? ` ${Math.round((bk.liftProgress / config.bike.liftSeconds) * 100)}%` : ''}`;
    else if (sim.nearBike(p.pos.x, p.pos.z)) {
      // The water cans and bike work win over getting on: they are why you'd stop here.
      const job = bk.state === 'parked' ? sim.bikeJob : null;
      if (waterPrompt) prompt = waterPrompt;
      else if (job) prompt = `Hold R — ${job.label} (${job.seconds} s)${bk.care.jobProgress > 0 ? ` ${Math.round((bk.care.jobProgress / job.seconds) * 100)}%` : ''}`;
      else prompt = 'E — get on the bike';
    }
    else {
      const stuck = f.sheep.find(
        (s) => s.stuck !== 'none' && Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < config.flock.stuck.freeReach,
      );
      if (stuck) {
        const pct = Math.round((stuck.freeProgress / config.flock.stuck.freeSeconds) * 100);
        prompt = `Hold E — free the sheep (${stuck.stuck === 'thorn' ? 'caught in thorns' : 'stuck on the slope'})${pct ? ` ${pct}%` : ''}`;
      } else if (Math.hypot(sim.dog.x - p.pos.x, sim.dog.z - p.pos.z) < 2.5 && (sim.dog.praiseTimer > 0 || sim.dog.care.ticks > 0 || !sim.dog.care.pettedToday)) {
        // He's at your heel half the day: only prompt when there's something to do for him.
        const care = sim.dog.care;
        if (sim.dog.praiseTimer > 0) prompt = 'E — praise Karabaş (good dog!)';
        else if (care.ticks > 0)
          prompt = `Hold E — pick off his ticks (${care.ticks})${care.pickProgress > 0 ? ` ${Math.round((care.pickProgress / config.dogCare.pickSeconds) * 100)}%` : ''}`;
        else prompt = 'E — pet Karabaş';
      } else if (sim.nearBowl(p.pos.x, p.pos.z)) {
        const care = sim.dog.care;
        prompt = care.bowl.meals > 0 ? 'Karabaş’s bowl is full' : care.sack > 0 ? `E — fill Karabaş’s bowl (${care.sack} meals left in the sack)` : 'The sack of kibble is empty';
      } else if (note) prompt = 'E — read Uncle Ahmet’s note again';
    }
    // One prompt at a time. Leading a sheep on the rope is the fallback reminder.
    if (!prompt && waterPrompt) prompt = waterPrompt;
    if (!prompt) {
      const key = info.device === 'gamepad' ? 'A' : 'E';
      const errand = sim.errandTarget;
      if (errand) {
        const { stop } = errand;
        const progress = Math.round(sim.errands.fraction(stop) * 100);
        prompt = `${stop.seconds ? 'Hold ' : ''}${key} — ${stop.action}${progress ? ` (${progress}%)` : ''}`;
      } else if (sim.encounterPrompt) prompt = `${key} — ${sim.encounterPrompt}`;
    }
    if (!prompt && sim.ledSheep) prompt = 'On the rope · use it again to let go';
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.prompt.innerHTML = promptHtml(prompt);
      this.prompt.style.display = prompt ? 'block' : 'none';
    }
  }
}

const escHtml = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
/** "R / RB" → two keycaps with a slash between; "Alt + Mouse" → two keycaps side by side. */
const caps = (keys: string) =>
  keys
    .split(' / ')
    .map((alt) => alt.split(' + ').map((k) => `<kbd>${escHtml(k)}</kbd>`).join(''))
    .join('<span class="or">/</span>');

/**
 * "Hold E — free the sheep · H horn" → keycaps and a separator dot. Each " · " part that
 * starts with a key ("E — …", "hold R — …", "R / RB — …", "H horn", "Alt + mouse: …")
 * gets its key drawn as a keycap; anything else stays plain text.
 */
export function promptHtml(text: string): string {
  return text
    .split(' · ')
    .map((part) => {
      let m = part.match(/^(hold )?((?:[A-Z][A-Za-z]*)(?: \/ [A-Z]+)?) — (.+)$/i);
      if (m && /^(A|E|R|Space|R \/ RB|H|F)$/.test(m[2]))
        return `${m[1] ? '<span class="hold">hold</span>' : ''}${caps(m[2])}${escHtml(m[3])}`;
      m = part.match(/^([A-Z]) ([a-z].*)$/);
      if (m) return `${caps(m[1])}${escHtml(m[2])}`;
      m = part.match(/^Alt \+ mouse: (.+)$/);
      if (m) return `${caps('Alt + Mouse')}${escHtml(m[1])}`;
      return escHtml(part);
    })
    .join('<span class="sep"></span>');
}

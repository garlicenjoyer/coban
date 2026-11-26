import { Ragdolls } from './life/ragdolls';
// Bootstraps the greybox: physics, simulation, renderer, fixed-step loop, debug tools.

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { config, SIM_DT } from './core/config';
import { Input } from './core/input';
import { FixedLoop } from './core/loop';
import { canCheckpoint, SAVE_KEY, snapshot, usable } from './core/save';
import { Bench, perf } from './debug/bench';
import { Replay } from './debug/replay';
import { Scenarios } from './debug/scenarios';
import { Trial } from './debug/trial';
import { GameAudio } from './audio/audio';
import { Ambience } from './audio/ambience';
import { ValleyLifeAudio } from './audio/valleyLifeAudio';
import { ResidentVoiceAudio } from './audio/residentVoiceAudio';
import { commandInfo } from './dog/commands';
import { DogView } from './dog/dogView';
import { BikeView } from './bike/bikeView';
import { BikeDash } from './ui/bikeDash';
import { WolfView } from './predators/wolfView';
import { TaskCard } from './ui/taskCard';
import { FieldKit } from './ui/fieldKit';
import { PaperMap } from './ui/paperMap';
import { WhistleWheel } from './ui/whistleWheel';
import { FlockView } from './flock/flockView';
import { CameraRig } from './player/camera';
import { PlayerView } from './player/playerView';
import { ShepherdRig } from './player/shepherdRig';
import { Sim } from './sim';
import { DebugUI } from './ui/debugGui';
import { createPropsView } from './world/propsView';
import { createTerrainMesh } from './world/terrainView';
import { activeMap, insidePen, layout, MAPS, useMap } from './world/map';
import { Music } from './audio/music';
import { createBackdrop } from './render/backdrop';
import { PostFX, postSettings } from './render/post';
import { Daylight } from './render/style';
import { updateWind } from './render/wind';
import { loadGameModel } from './render/gameModel';
import { grassAllowed, Vegetation } from './world/vegetation';
import { GrassField, grassSettings } from './world/grassField';
import { EnvironmentView } from './world/environmentView';
import { GroundDressing } from './world/groundDressing';
import { HouseView } from './world/houseView';
import { EconomyView } from './world/economyView';
import { HomesteadView } from './world/homesteadView';
import { TracksView } from './world/tracksView';
import { WaterView } from './world/waterView';
import { WorksView } from './world/worksView';
import { ShopView } from './ui/shopView';
import { SatchelView } from './ui/satchelView';
import { PauseMenu } from './ui/pauseMenu';
import { ValleyProps } from './world/valleyProps';
import { VillageView } from './world/villageView';
import { onVillagePaving } from './world/villagePlan';
import { HerdingCues, herdingCueSettings } from './world/herdingCues';
import { Coach } from './tutorial/coach';
import { CoachView } from './ui/coachView';
import { LifeView } from './life/lifeView';
import { ErrandsView } from './life/errandsView';
import { ResidentDialogueView } from './ui/residentDialogueView';
import { VillageLifeView } from './life/villageLifeView';

async function main() {
  const params = new URLSearchParams(location.search);
  const muted = params.has('mute');
  // The valley by default; ?map=test opens the greybox test map.
  const mapId = params.get('map') === 'test' ? 'test' : 'valley';
  const [shepherd, sheepModel, dogModel, bikeModel, wolfModel, propModels, fieldProps, villageModels, lifeModels] = await Promise.all([
    ShepherdRig.load(`${import.meta.env.BASE_URL}models/turkish-shepherd.glb`),
    loadGameModel('aegean-sheep'),
    loadGameModel('karabas'),
    loadGameModel('field-motorcycle'),
    loadGameModel('anatolian-wolf'),
    loadGameModel('valley-props'),
    loadGameModel('field-props'),
    MAPS[mapId].layout.village ? loadGameModel('village') : null,
    loadGameModel('valley-life'),
    RAPIER.init(),
  ]);

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  // The post pass does its own anti-aliasing (multisampled target), so none here.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  useMap(MAPS[mapId]);
  // Bigger maps see farther: push the aerial haze out so the far side still reads.
  postSettings.hazeDistance *= Math.max(1, MAPS[mapId].size / 850);
  const sim = new Sim(RAPIER);
  const input = new Input(canvas);

  // ---------- scene: cel-shaded valley ----------
  const scene = new THREE.Scene();
  const daylight = new Daylight(scene);
  scene.add(createBackdrop(MAPS[mapId].size / 2));
  const post = new PostFX(1, 1);
  // Earned music at 30%: a song for the first morning, then one for each first arrival.
  const music = new Music(
    [`${import.meta.env.BASE_URL}audio/tea-at-mid-morning.mp3`, `${import.meta.env.BASE_URL}audio/terrace-at-midday.mp3`],
    0.3,
  );
  sim.events.on('arrival', () => music.cue());

  const terrainView = createTerrainMesh(sim.terrain, activeMap().ground, activeMap().roadDistance);
  terrainView.setGrid(config.debug.showGrid);
  scene.add(terrainView.mesh);
  const props = createPropsView(sim.terrain, sim.map);
  scene.add(props);
  const labels = props.getObjectByName('labels')!;
  const vegetation = new Vegetation(sim.terrain, sim.obstacles);
  scene.add(vegetation.root);
  const grass = new GrassField({
    terrain: sim.terrain,
    zones: activeMap().ground,
    groundColor: (x, z, out) => terrainView.groundColorAt(x, z, out),
    allowed: grassAllowed(sim.obstacles),
    density: activeMap().tuftDensity,
    grassMap: terrainView.grassMap,
  });
  scene.add(grass.root);
  const pushers = Array.from({ length: 32 }, () => ({ x: 0, z: 0, r: 0 }));
  const environment = new EnvironmentView(sim.terrain, sim.map);
  scene.add(environment.root);
  const village = layout.village;
  const dressing = new GroundDressing({
    terrain: sim.terrain,
    zones: activeMap().ground,
    roadDistance: activeMap().roadDistance,
    blocked: (x, z, r) => sim.obstacles.blocked(x, z, r),
    reserved: (x, z) =>
      insidePen(x, z, 6) ||
      Math.hypot(x - layout.house.x, z - layout.house.z) < 26 ||
      onVillagePaving(village, x, z, 0.48) ||
      (!!village && Math.hypot(x - village.x, z - village.z) < village.r),
  });
  scene.add(dressing.root);
  const waterView = new WaterView(sim.terrain);
  scene.add(waterView.root);
  sim.events.on('simReset', () => waterView.reset());
  const valleyProps = new ValleyProps(propModels);
  const house = new HouseView(sim.terrain, valleyProps);
  scene.add(house.root);
  // The homestead's art pass: the stone ağıl, the çeşme, the yard and its hens.
  const homestead = new HomesteadView(sim.terrain, sim.map);
  scene.add(homestead.root);
  const villageView = village && villageModels ? new VillageView(sim.terrain, village, sim.map, villageModels, valleyProps) : undefined;
  if (villageView) scene.add(villageView.root);
  const villageLife = village ? new VillageLifeView(village, sim.terrain, lifeModels, valleyProps) : undefined;
  if (villageLife) scene.add(villageLife.root);
  // Wild herbs and finds, the milking stand and churn.
  const economyView = new EconomyView(sim.terrain, valleyProps, fieldProps);
  scene.add(economyView.root);
  // Read the land (hold G / D-pad ←): hazards baked once, re-baked when a cistern is built.
  terrainView.bakeHazards(sim.obstacles, sim.water.points);
  sim.events.on('built', (e) => {
    if (e.id === 'cistern') terrainView.bakeHazards(sim.obstacles, sim.water.points);
  });
  let readLand = 0;
  const works = new WorksView(() => sim, fieldProps);
  scene.add(works.root);

  // The pen gate swings on a hinge at its north end; open = swung out to the east.
  const gateMesh = props.getObjectByName('prop-gate')!;
  const pen = layout.pen;
  const gatePivot = new THREE.Group();
  gatePivot.position.set(pen.x + pen.hx, 0, pen.z - pen.gateWidth / 2);
  scene.add(gatePivot);
  gatePivot.attach(gateMesh);
  let gateAngle = 0;

  const groundAt = (x: number, z: number) => sim.terrain.heightAt(x, z);
  const flockView = new FlockView(() => sim.flock, sheepModel, groundAt);
  scene.add(flockView.root);
  const dogView = new DogView(scene, () => sim.dog, sim.events, dogModel, groundAt);
  // What the call and the crook reach, and which sheep are following.
  const herding = new HerdingCues(sim.events, groundAt, () => sim.flock.sheep, config.flock.call.followSeconds);
  scene.add(herding.root);
  const wolfView = new WolfView(() => sim.wolves, wolfModel, groundAt);
  scene.add(wolfView.root);
  const lifeView = new LifeView(lifeModels, groundAt, village);
  scene.add(lifeView.root);
  const errandsView = new ErrandsView(sim.errands, sim.terrain, lifeModels);
  scene.add(errandsView.root);
  const bikeView = new BikeView(() => sim.bike, bikeModel);
  scene.add(bikeView.root);
  const bikeDash = new BikeDash(() => sim, sim.events);

  // Sound: whistles from the shepherd, barks from where the dog is.
  const audio = new GameAudio();
  const ragdolls = new Ragdolls(sim, () => [...lifeView.people, ...(villageLife?.people ?? [])],
    point => audio.thud(point.x, point.y, point.z));
  const sprintGate = new THREE.Group();
  const canvasFlag = document.createElement('canvas');
  canvasFlag.width = 64; canvasFlag.height = 32;
  const ink = canvasFlag.getContext('2d')!;
  for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
    ink.fillStyle = (row + col) % 2 ? '#553e28' : '#ffc960';
    ink.fillRect(col * 16, row * 16, 16, 16);
  }
  const flagTexture = new THREE.CanvasTexture(canvasFlag);
  flagTexture.colorSpace = THREE.SRGBColorSpace;
  flagTexture.magFilter = THREE.NearestFilter;
  const flag = new THREE.MeshBasicMaterial({ map: flagTexture, side: THREE.DoubleSide });
  const pole = new THREE.MeshStandardMaterial({ color: 0xcfa253 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 2.8, 8), pole);
    post.position.set(side * 3.3, 1.4, 0);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.47), flag);
    cloth.position.set(-side * 0.47, 1.05, 0);
    post.add(cloth);
    sprintGate.add(post);
  }
  scene.add(sprintGate);
  const lifeAudio = new ValleyLifeAudio(audio);
  const residentVoice = new ResidentVoiceAudio(audio);
  // The land's own sound: cicadas, crickets, the owl, sheep bells, the ezan from the village.
  const ambience = new Ambience(audio);
  sim.events.on('howl', (e) => audio.howl(e.x, sim.terrain.heightAt(e.x, e.z) + 2, e.z));
  const tracks = new TracksView(() => sim);
  scene.add(tracks.root);
  sim.events.on('goldenHour', () => {
    if (sim.tasks.enabled) audio.goldenHour();
  });
  sim.events.on('dogCommand', (e) => {
    if (e.mode === 'whistle') audio.whistle(commandInfo(e.command).notes);
  });
  sim.events.on('bark', (e) => {
    const nightAlarm = e.kind === 'alert' && sim.nightWatchActive && sim.dog.perceived === sim.nightWolf;
    audio.bark(e.kind, e.x, sim.terrain.heightAt(e.x, e.z), e.z, nightAlarm);
  });
  const atBike = (kind: 'kick' | 'kickFail' | 'thunk' | 'horn', strength = 1) => audio.bikeSound(kind, strength, sim.bike.x, sim.bike.y + 0.6, sim.bike.z);
  sim.events.on('vehicleCrash', e => audio.bikeSound('thunk', Math.min(1, e.speed / 9), e.x, e.y, e.z));
  sim.events.on('bikeThunk', (e) => atBike('thunk', e.strength));
  sim.events.on('bikeHorn', ({ x, z }) => audio.bikeSound('horn', 1, x, groundAt(x, z) + 0.6, z));
  // A misfire pops, a skipping chain clanks.
  sim.events.on('bikeFault', (e) => atBike(e.kind === 'skip' ? 'thunk' : 'kickFail', e.kind === 'skip' ? 0.4 : 0.6));
  const wheel = new WhistleWheel(sim.events, () => 'Karabaş', () => sim.dog.bond);
  const dialogueView = new ResidentDialogueView(input);
  const taskCard = new TaskCard(() => sim, sim.events, () => audio.chime());
  // The field kit: watch (T), compass (with barks and howls), tesbih at the ağıl, paper map (M).
  const fieldKit = new FieldKit(() => sim, sim.events, { tick: () => audio.tick(), bead: () => audio.bead() });
  const paperMap = new PaperMap(() => sim, sim.events);
  const satchel = new SatchelView(() => sim, sim.events, input);
  const shopView = new ShopView(() => sim, sim.events, input);
  // The coach: each control taught when it's first needed, by doing it (Esc › Options).
  const coach = new Coach();
  coach.attach(sim.events, () => sim);
  const coachView = new CoachView();
  sim.events.on('slingThrow', () => audio.sling());
  sim.events.on('slingHit', (e) => audio.thud(e.x, sim.terrain.heightAt(e.x, e.z) + 0.2, e.z));
  sim.events.on('dogHurt', () => audio.yelp(sim.dog.x, sim.dog.y + 0.6, sim.dog.z));
  sim.events.on('built', () => audio.chime());
  let lastKnock = 0;
  paperMap.onToggle = (open) => {
    fieldKit.mapOpen = open;
    document.body.classList.toggle('mapopen', open);
  };
  // ` (backquote) toggles the debug overlay (the task card stays). H is the horn.
  try {
    // The debug overlay is for developers: off unless it was explicitly turned on.
    if (localStorage.getItem('coban.hudoff') !== '0') document.body.classList.add('hudoff');
  } catch {
    /* storage unavailable: default on */
  }
  const setDevOverlay = (on: boolean) => {
    document.body.classList.toggle('hudoff', !on);
    syncDebugPanel();
    try {
      localStorage.setItem('coban.hudoff', on ? '0' : '1');
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote' || e.repeat) return;
    setDevOverlay(document.body.classList.contains('hudoff'));
  });
  // Esc / Start: the pause menu, with the controls and options.
  const pause = new PauseMenu({
    input,
    cardOpen: () => paperMap.isOpen || shopView.isOpen || satchel.cardOpen
      || taskCard.isJournalOpen || dialogueView.isOpen,
    when: () => {
      const h = sim.hour;
      const clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
      return `Day ${sim.tasks.day} · ${clock}`;
    },
    getEffects: () => audio.volume,
    setEffects: (v) => audio.setVolume(v),
    getMusic: () => music.volume,
    setMusic: (v) => (music.volume = v),
    getDevOverlay: () => !document.body.classList.contains('hudoff'),
    setDevOverlay,
    getHints: () => coach.enabled,
    setHints: (on) => (coach.enabled = on),
    resetHints: () => coach.reset(),
  });
  if (muted) {
    audio.setVolume(0);
    music.volume = 0;
  }

  // Views read the *current* sim objects through getters: reset rebuilds the world and player.
  const stations = { teaTable: house.teaTable, milkingStation: economyView.milkingStation, press: economyView.press };
  const playerView = new PlayerView(scene, sim, shepherd, bikeView, stations, fieldProps,
    (success) => atBike(success ? 'kick' : 'kickFail'));
  const rig = new CameraRig(RAPIER, () => sim.world, () => sim.cameraCollider, groundAt, canvas);
  sim.events.on('vehicleTaken', at => villageLife?.witnessTheft(at, sim.tick * SIM_DT, sim.obstacles));
  sim.events.on('residentShout', e => residentVoice.chatter(e, rig.camera.position, e.resident, e.speech));
  sim.events.on('lifeSound', (e) => lifeAudio.call(e.kind, e, rig.camera.position));
  sim.events.on('workSound', (e) => lifeAudio.work(e.kind, e, rig.camera.position));
  const villageSounds: Parameters<VillageLifeView['update']>[5] = {
    voice: (point, id, speech) => residentVoice.chatter(point, rig.camera.position, id, speech),
    work: (kind, point) => lifeAudio.work(kind, point, rig.camera.position),
  };

  // ---------- debug ----------
  const colliderLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true, depthTest: true }),
  );
  colliderLines.visible = false;
  colliderLines.frustumCulled = false;
  scene.add(colliderLines);

  const replay = new Replay(sim);
  const trial = new Trial(sim);
  const scenarios = new Scenarios(sim);
  const debug = new DebugUI(sim, replay, trial, scenarios, music, ambience, {
    setGrid: (on) => terrainView.setGrid(on),
    setColliders: (on) => (colliderLines.visible = on),
    setHomesteadArt: (on) => (homestead.root.visible = on),
  });
  const stats = new Stats();
  stats.dom.style.cssText = 'position:fixed;top:10px;right:260px;';
  document.body.appendChild(stats.dom);
  // Developer tools (panel, stats, text overlay) share one switch: the backquote key.
  function syncDebugPanel() {
    const off = document.body.classList.contains('hudoff');
    if (off) debug.gui.hide();
    else debug.gui.show();
    stats.dom.style.display = off ? 'none' : '';
  }
  syncDebugPanel();

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    post.setSize(Math.floor(w * pr), Math.floor(h * pr));
    grass.bufferHeight = Math.floor(h * pr);
    rig.resize(w, h);
  };
  window.addEventListener('resize', resize);
  resize();

  // Gamepad rumble from slip and surface (rate-limited).
  let lastRumble = 0;
  const rumble = (strong: number, weak: number) => {
    const now = performance.now();
    if (now - lastRumble < 100 || strong + weak < 0.05) return;
    lastRumble = now;
    for (const p of navigator.getGamepads ? navigator.getGamepads() : []) {
      const act = (p as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null)?.vibrationActuator;
      act?.playEffect?.('dual-rumble', { duration: 110, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => {});
    }
  };

  let fps = 60;
  const hintUntil = performance.now() + 10000;
  let weightShift = 0;
  let simMs = 0;
  const loop = new FixedLoop({
    step: () => {
      const t0 = performance.now();
      const live = input.sampleFrame(rig.yaw);
      const frame = replay.frameFor(live);
      weightShift = frame.weightShift;
      sim.step(frame);
      replay.afterStep();
      trial.afterStep();
      scenarios.afterStep(1 / 60);
      simMs += performance.now() - t0;
    },
    render: (alpha, dt) => {
      const r0 = performance.now();
      perf.simMs = simMs;
      simMs = 0;
      perf.start();
      // The whistle wheel slows the world to half speed while it is open.
      // The pause menu stops it altogether.
      pause.update();
      loop.timeScale = pause.isOpen ? 0 : config.time.timeScale * (input.wheelOpen ? 0.5 : 1);
      document.body.classList.toggle('pad', input.lastDevice === 'gamepad');
      // The bottom hint shows only while it's needed: the first seconds, while the mouse
      // has to be clicked to take the camera, or until drag-to-look has been tried once.
      const pad = input.lastDevice === 'gamepad';
      const needHint =
        performance.now() < hintUntil ||
        (!pad && !input.pointerLocked && (input.lockAvailable || !input.looked));
      document.body.classList.toggle('hint-off', !needHint);
      ragdolls.restoreAnimation();
      sprintGate.visible = !!sim.sprint;
      if (sim.sprint) {
        const marker = sim.sprint.marker;
        sprintGate.position.set(marker.x, groundAt(marker.x, marker.z), marker.z);
        sprintGate.rotation.y = -0.5;
      }
      bikeView.update(alpha, dt * loop.timeScale, playerView.kickstandFold);
      const riding = sim.riding;
      input.riding = riding;
      document.body.classList.toggle('mounted', riding);
      playerView.update(alpha, dt * loop.timeScale, weightShift);
      bikeDash.update();
      const bk = sim.bike;
      audio.engine(bk.engineOn && !playerView.cranking, bk.rpm, bk.throttle, Math.abs(bk.beta) * 3 + bk.wheelspin + (bk.state === 'fallen' ? 0.3 : 0), bk.x, bk.y + 0.5, bk.z);
      if (bk.rider) rumble(Math.min(1, Math.abs(bk.beta) * 2 + bk.wheelspin), Math.min(1, bk.speed / 25) * 0.3);
      perf.lap('shepherd and bike');
      flockView.update(alpha, dt, performance.now() / 1000, dt * loop.timeScale, playerView.milkingSubject);
      herding.update(dt * loop.timeScale, alpha);
      perf.lap('flock');
      dogView.update(alpha, dt, dt * loop.timeScale);
      wolfView.update(alpha, dt * loop.timeScale);
      perf.lap('dog and wolves');
      {
        const otherCard = shopView.isOpen || satchel.cardOpen || dialogueView.isOpen;
        const cardOpen = paperMap.isOpen || otherCard;
        coach.update({
          sim,
          device: input.lastDevice,
          dt,
          blocked: pause.isOpen || cardOpen || taskCard.isJournalOpen,
          wheelOpen: input.wheelOpen,
          wheelSlot: input.wheel.slot,
          lastCommand: input.lastCommand,
          mapOpen: paperMap.isOpen,
          watchUp: document.getElementById('watch')?.classList.contains('up') ?? false,
          journalOpen: taskCard.isJournalOpen,
        });
        // Over the map only the confirmation shows ("press it again to fold it away").
        const card = coach.card;
        coachView.update(card, pause.isOpen || otherCard || input.wheelOpen || (paperMap.isOpen && card?.phase !== 'done'));
      }
      wheel.update(input.wheel, input.wheelOpen && sim.commandMode() === 'gesture', coach.wheelGuide(), input.lastDevice === 'gamepad');
      taskCard.update(rig.yaw);
      fieldKit.update(rig.yaw);
      paperMap.update();
      shopView.update();
      economyView.update(sim);
      satchel.watchUp = document.getElementById('watch')?.classList.contains('up') ?? false;
      satchel.update();
      dialogueView.update(sim.dialogue, pause.isOpen || paperMap.isOpen
        || shopView.isOpen || satchel.cardOpen || taskCard.isJournalOpen || input.wheelOpen);
      perf.lap('field kit and cards');
      tracks.update();
      works.update(playerView.leftHand, flockView.halterPoint);
      readLand += ((input.readLand && !sim.riding ? 1 : 0) - readLand) * Math.min(1, dt * 6);
      terrainView.setReadLand(readLand, sim.player.pos.x, sim.player.pos.z);
      if (sim.building && performance.now() - lastKnock > 420) {
        lastKnock = performance.now();
        audio.knock();
      }
      terrainView.updateGrass(sim.grass, config.debug.showGrass);
      perf.lap('trails, works, terrain');
      gateAngle += ((sim.gateOpen ? Math.PI / 2 : 0) - gateAngle) * Math.min(1, dt * 8);
      gatePivot.rotation.y = gateAngle;
      const speaker = dialogueView.isOpen && Math.hypot(sim.player.vel.x, sim.player.vel.z) < 0.25 ? sim.dialogue?.resident : undefined;
      const vehicleCamera = sim.drivenVehicle ? { heading: sim.drivenVehicle.yaw, speed: Math.abs(sim.drivenVehicle.speed), lean: 0,
        clearance: sim.drivenVehicle.kind === 'van' ? 1.0 : 0.55 } :
        sim.bike.rider ? { heading: sim.bike.heading, speed: sim.bike.speed, lean: sim.bike.lean } : null;
      rig.update(playerView.renderPos, input, dt, vehicleCamera,
        speaker && { x: speaker.x, y: speaker.y + (speaker.driving ? 0.24 : 0), z: speaker.z });
      perf.lap('camera');

      if (colliderLines.visible) {
        const terrainHandle = sim.terrainCollider.handle;
        const buf = sim.world.debugRender(undefined, (c) => c.handle !== terrainHandle);
        const g = colliderLines.geometry;
        g.setAttribute('position', new THREE.BufferAttribute(buf.vertices, 3));
        g.setAttribute('color', new THREE.BufferAttribute(buf.colors, 4));
      }

      const cam = rig.camera;
      lifeView.update(sim.residents, sim.wildlife, alpha, dt * loop.timeScale, cam.position, (sim.tick + alpha) * SIM_DT);
      errandsView.update(sim.errands);
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      audio.setListener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);
      lifeAudio.update(sim.residents, cam.position, loop.timeScale === 0);
      residentVoice.update(dialogueView.isOpen ? sim.dialogue : null, loop.timeScale === 0);
      const mi = layout.village?.minaret;
      ambience.update(dt, {
        hour: sim.hour,
        listener: cam.position,
        sheep: sim.flock.sheep,
        minaret: mi ? { x: mi.x, y: sim.terrain.heightAt(mi.x, mi.z) + mi.h - 2, z: mi.z } : null,
      });
      perf.lap('audio');
      daylight.update(sim.hour, sim.tasks.day, playerView.renderPos, cam.position);
      villageView?.update(sim.hour, sim.tasks.day, cam.position);
      villageLife?.update(sim.hour, (sim.tick + alpha) * SIM_DT, dt * loop.timeScale, sim.player.pos, cam.position, villageSounds);
      ragdolls.pose();
      updateWind(performance.now() / 1000, dt, sim.hour);
      labels.visible = config.debug.showLabels;
      perf.lap('daylight');
      vegetation.update(cam.position);
      {
        // Nearby bodies part the long grass as they pass.
        let n = 0;
        const add = (x: number, z: number, r: number) => {
          if (n < pushers.length) Object.assign(pushers[n++], { x, z, r });
        };
        add(sim.player.pos.x, sim.player.pos.z, 0.75);
        add(sim.dog.x, sim.dog.z, 0.65);
        add(sim.bike.x, sim.bike.z, 1.1);
        for (const resident of sim.residents.list) {
          if (Math.hypot(resident.x - cam.position.x, resident.z - cam.position.z) < 48)
            add(resident.x, resident.z, resident.driving ? 1.2 : 0.52);
        }
        for (const sh of sim.flock.sheep) add(sh.x, sh.z, 0.6);
        grass.update(cam, pushers.slice(0, n), terrainView.grassMap.value !== null);
      }
      perf.lap('vegetation');
      environment.update();
      dressing.update(cam.position);
      waterView.update(sim.water);
      house.update(performance.now() / 1000);
      homestead.update(dt, {
        time: performance.now() / 1000,
        hour: sim.hour,
        bowlMeals: sim.dog.care.bowl.meals,
        penReinforced: sim.economy.has('pen'),
        sackMeals: sim.dog.care.sack,
        player: playerView.renderPos,
        blocked: (x, z, r) => sim.obstacles.blocked(x, z, r) || insidePen(x, z, 0.5),
      });
      perf.lap('environment, water, homestead');
      post.render(renderer, scene, cam, daylight);
      perf.lap('three.js render');
      stats.update();
      if (dt > 0) fps += (1 / dt - fps) * 0.05;
      debug.update({ fps, steps: loop.stepsLastFrame, pointerLocked: input.pointerLocked, device: input.lastDevice });
      perf.lap('debug panel');
      perf.renderMs = performance.now() - r0;
    },
  });

  document.getElementById('loading')?.remove();
  loop.start();

  // The frame-rate check: a fixed tour of the heaviest views (Performance in the debug panel).
  const bench = new Bench(() => sim, rig, renderer);
  const perfFolder = debug.gui.addFolder('Performance');
  const benchCtl = { status: bench.status };
  perfFolder.add({ run: () => void bench.run().then(() => (benchCtl.status = bench.status)) }, 'run').name('▶ Run frame-rate check (keep the window visible)');
  perfFolder.add(benchCtl, 'status').name('result').listen().disable();
  perfFolder.close();

  // Import the existing world once. Free roam checkpoints use a separate slot per map.
  const roamSaveKey = `coban.roam.v1.${mapId}`;
  const writeSave = (why: string, midday = false) => {
    try {
      const data = snapshot(sim, { midday });
      localStorage.setItem(roamSaveKey, JSON.stringify(data));
      saveCtl.status = `saved day ${data.day} (${why}) · ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      saveCtl.status = `could not save: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
  const saveCtl = { status: 'no save yet' };
  sim.events.on('slept', () => writeSave('morning', true));
  sim.events.on('sprintUpdate', () => {
    if (!sim.sprint?.running) queueMicrotask(() => writeSave('after a sprint', true));
  });
  sim.events.on('errandChanged', ({ title }) => {
    queueMicrotask(() => {
      if (canCheckpoint(sim, { afterDayTasks: true })) writeSave(title, true);
    });
  });
  const leaving = () => {
    if (trial.phase === 'off' && scenarios.name === 'none' && canCheckpoint(sim) && sim.tick > 0) writeSave('on leaving', true);
  };
  window.addEventListener('pagehide', leaving);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leaving();
  });
  const saveFolder = debug.gui.addFolder('Save');
  saveFolder.add({ save: () => writeSave('by hand', true) }, 'save').name('Save now');
  saveFolder.add({ fresh: () => { try { localStorage.removeItem(roamSaveKey); } catch { /* ignore */ } params.set('new', ''); location.search = params.toString(); } }, 'fresh').name('New game (forget the save)');
  saveFolder.add(saveCtl, 'status').name('save').listen().disable();
  saveFolder.close();
  if (!params.has('new')) {
    try {
      const raw = localStorage.getItem(roamSaveKey) ?? localStorage.getItem(SAVE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (usable(data)) {
        sim.restore(data);
        saveCtl.status = `loaded day ${data.day} (saved ${new Date(data.savedAt).toLocaleString()})`;
      }
    } catch (err) {
      saveCtl.status = `save unreadable: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (params.has('new')) {
    writeSave('new valley', true);
    const url = new URL(location.href);
    url.searchParams.delete('new');
    history.replaceState(null, '', url);
  }

  // Handy in the browser console while tuning.
  Object.assign(window, { coach, herdingCueSettings, sim, config, rig, replay, trial, scenarios, input, postSettings, grassSettings, music, terrainView, renderer, bench, scene, post, daylight, grass });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});

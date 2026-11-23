// All tunable constants live here so the debug panel can edit them live.
// Values come from the GDD (M1 section) unless noted.

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const DAWN_HOUR = 6;
export const SUNSET_HOUR = 19;
export const GOLDEN_HOUR = SUNSET_HOUR - 1;
export const FIRST_NIGHT_HOUR = SUNSET_HOUR + 1;

export const config = {
  time: {
    /** Real seconds per in-game hour during daylight (GDD: 1 hour = 1 real minute). */
    secondsPerHour: 60,
    startHour: 6.5,
    /** Debug multiplier on simulation speed. 1 = normal. */
    timeScale: 1,
  },
  player: {
    walkSpeed: 1.4,
    sprintSpeed: 4.5,
    sneakSpeed: 0.8,
    /** Below this stick tilt the gamepad counts as sneaking. */
    sneakStickThreshold: 0.5,
    acceleration: 10,
    turnRate: 10,
    gravity: 20,
    capsuleRadius: 0.35,
    capsuleHalfHeight: 0.55,
    maxSlopeDeg: 40,
    /** Rapier auto-step (note: it doesn't trigger for our capsule; low platforms use sloped edges). */
    stepHeight: 0.3,
    snapToGround: 0.5,
    crookRange: 6,
    crookHalfAngleDeg: 30,
    crookCooldown: 0.6,
    callRadius: 15,
    callCooldown: 1.5,
    sprintNoiseRadius: 8,
  },
  camera: {
    distance: 6,
    minDistance: 1.2,
    maxDistance: 14,
    height: 1.6,
    shoulder: 0.55,
    pitchMinDeg: -35,
    pitchMaxDeg: 70,
    mouseSensitivity: 0.0025,
    stickSensitivity: 2.6,
    followLerp: 12,
    fov: 60,
  },
  flock: {
    /** Applied on reset (debug panel), 15-30 per the GDD. */
    count: 24,
    radius: 0.42,
    separationRadius: 1.2,
    alignRadius: 6,
    cohesionRadius: 8,
    /** Followers seek a point this far behind the bellwether. */
    leaderOffset: 2,
    /** Followers switch to Follow when the bellwether is farther than this or moving. */
    followDistance: 12,
    /** Beyond this a sheep has lost contact with the flock (can't hear the bells) and stops following. */
    awareness: 40,
    speeds: { graze: 0.45, follow: 1.7, flee: 3.2, panic: 4.6, penned: 0.35 },
    maxAccel: 4,
    turnRate: 6,
    /** Flight-zone radius around the shepherd by gait, metres. */
    flightZone: { idle: 3, sneak: 3.5, walk: 6, sprint: 11 },
    /** Sheep inside this half-angle in front of a moving shepherd flee forward (GDD: 120° cone). */
    pressureConeDeg: 60,
    pressureForwardBlend: 0.9,
    stress: { zoneGain: 30, crook: 14, crookNear: 4, sprintNoise: 10, decay: 5, scatterAt: 70, panicAt: 90 },
    call: { followSeconds: 7, leaderFollowSeconds: 14, stopDistance: 4, calm: 8, flightZoneScale: 0.5 },
    crook: { fleeSeconds: 2.2 },
    stray: { distance: 35, seconds: 30, rejoin: 20 },
    stuck: {
      windowSeconds: 5,
      minDisplacement: 0.5,
      slopeDeg: 26,
      /** Chance per second of getting caught while touching thorns. */
      thornCatchFleeing: 0.6,
      thornCatchCalm: 0.04,
      freeSeconds: 2,
      freeReach: 2,
    },
    /**
     * consumePerHour: grass (in 2 m texels' worth, 0..1 each) one sheep crops per in-game hour
     * of eating, a full bite, taken from the 5×5 texels round her. Grass thinner than
     * fullBiteAt there gives a proportionally smaller bite.
     */
    graze: { eatMin: 4, eatMax: 12, walkMin: 2, walkMax: 5, consumePerHour: 1.0, fullBiteAt: 0.5 },
    /**
     * feedPerGrass: hunger worked off per unit of grass eaten. Full bites take off ~50/h while
     * eating (net ~25/h after the 6/h hunger and the walking between bites), so a starving
     * flock (~99) is fed (< 25) in 3–5 hours on fresh grass; on grass eaten down below
     * fullBiteAt the bites shrink and they hardly gain (tests/grazing.test.ts).
     */
    hunger: { start: 55, perHour: 6, feedPerGrass: 50 },
    thirst: {
      start: 20, perHour: 8, middayMultiplier: 1.5,
      seekAt: 45, drinkAt: 27, satisfied: 16, searchRadius: 18,
      drinkPerSecond: 9, litersPerPoint: 0.025,
      damageAt: 90, damagePerHour: 12, recoveryPerHour: 8,
    },
    slope: { avoidDeg: 28, maxClimbDeg: 35 },
    /** Steering weights per mode (GDD flock AI table). */
    weights: {
      graze: { sep: 1.5, ali: 0.3, coh: 0.4, lead: 0.2, flee: 0.6, call: 0, wander: 1.0, pen: 0 },
      follow: { sep: 1.5, ali: 0.8, coh: 1.0, lead: 1.4, flee: 1.0, call: 1.2, wander: 0.1, pen: 0 },
      flee: { sep: 1.0, ali: 1.2, coh: 0.6, lead: 0.5, flee: 3.0, call: 0, wander: 0, pen: 0 },
      penned: { sep: 1.5, ali: 0.2, coh: 0.3, lead: 0, flee: 1.0, call: 0, wander: 0.4, pen: 0.8 },
      water: { sep: 1.15, ali: 0.1, coh: 0.12, lead: 0, flee: 1.3, call: 0, wander: 1.75, pen: 0 },
      /**
       * Bunching while a dog gathers: close ranks with neighbours, don't chase the bellwether,
       * and drift toward the shepherd ("draw": pressured sheep make for the handler).
       */
      bunch: { sep: 1.5, ali: 0.6, coh: 1.2, lead: 0.15, flee: 1.0, call: 0.7, wander: 0, pen: 0 },
    },
    avoidWeight: 2,
    boundsWeight: 3,
  },
  dog: {
    radius: 0.45,
    /** 0-100. Debug slider for now; care and praise move it in the full game. */
    startBond: 50,
    speeds: { walk: 1.6, trot: 3.6, run: 7.5 },
    maxAccel: 14,
    turnRate: 8,
    maxClimbDeg: 40,
    stamina: { max: 100, runDrainPerSec: 7, trotDrainPerSec: 1.5, regenPerSec: 6, recoverTo: 40 },
    /** Response delay and ignore chance at bond 0 -> bond 100 (GDD). */
    delay: { atZero: 2.0, atFull: 0.3 },
    ignore: { atZero: 0.3, atFull: 0 },
    ackSeconds: 0.3,
    praiseWindow: 3,
    gestureRange: 25,
    whistleRange: 150,
    /** Sheep within this of the shepherd get a little stress from a whistle. */
    whistleStartleRadius: 10,
    whistleStress: 5,
    perception: { hearing: 40, hearingHighBond: 60, sight: 25, sightHalfAngleDeg: 110, everySeconds: 0.25 },
    /** Never leaves the flock farther than this on his own initiative. */
    leash: 60,
    patrol: { margin: 6, seconds: 30 },
    rest: { seconds: 25 },
    gather: { margin: 6, doneRadius: 12, doneShare: 0.9, timeout: 30, sweep: 0.55 },
    /** Hold: keep the flock within `radius` of the point. Past `wearFrom` m of drift he wears
     *  the whole flock back (walking into its drifting edge) until it is within `wearUntil`. */
    hold: { radius: 20, pushOutside: 3, checkEvery: 0.5, wearFrom: 6, wearUntil: 3 },
    search: { timeout: 90, findDistance: 3, freeSlopeSeconds: 3, barkEvery: 5, rejoinDistance: 10 },
    heel: { offset: 2 },
    /** Flight zone the dog creates for sheep, by speed. Resting dog calms instead. */
    sheepFlightZone: { walk: 4, run: 8 },
    calmRadius: 15,
    calmFactor: 1.5,
    /** Sheep this close to a gathering dog stop grazing and bunch up (flocking instinct). */
    bunchRadius: 22,
  },
  bike: {
    /** Bike + rider, kg. */
    mass: 140,
    wheelbase: 1.35,
    /** Centre of mass ahead of the rear axle, m (front share = cgFromRear / wheelbase). */
    cgFromRear: 0.62,
    cgHeight: 0.6,
    /** Weight shift moves the centre of mass this far fore/aft, m (GDD: ±20 cm). */
    weightShift: 0.2,
    wheelRadius: 0.3,
    engine: {
      idleRpm: 1300,
      redline: 7200,
      stallRpm: 900,
      /** Torque curve [rpm, Nm], linearly interpolated. */
      torque: [
        [1000, 6],
        [2500, 9.5],
        [4500, 11.5],
        [5600, 12],
        [6600, 10.5],
        [7200, 8],
      ] as [number, number][],
      /** Overall ratios (gearbox × final drive), three automatic ranges. */
      gears: [22, 13.5, 8.2],
      upshiftRpm: 6300,
      downshiftRpm: 2900,
      efficiency: 0.9,
      /** Clutch-drop launch: torque multiplier and how long it lasts, s. */
      launchBoost: 1.45,
      launchSeconds: 0.7,
    },
    /** Total brake force at full lever, as a multiple of weight (grip-limited). */
    brakeG: 1.1,
    brakeFrontShare: 0.65,
    /** Upright rider on a boxy old bike. */
    cdA: 1.15,
    /** Steering lock at a standstill, shrinking with speed. */
    maxSteerDeg: 30,
    steerSpeedFalloff: 5,
    maxLeanDeg: 40,
    lean: { kp: 40, kd: 11 },
    /** How fast the rear steps out per unit of excess lateral demand, and how hard counter-steer catches it. */
    slide: { gain: 3.2, recover: 3, counter: 4.5, crashDeg: 40, crashMinSpeed: 3 },
    /** Hitting something faster than this (into its surface) throws you off. */
    impactCrashSpeed: 6,
    /** Stopping on ground steeper than this before your foot is down tips the bike over. */
    tipSlopeDeg: 20,
    footDownSeconds: 1,
    footDownSpeed: 0.83,
    /** Kick-start timing ring: one sweep per cycle; press inside the window. */
    kick: { cycle: 1.2, windowStart: 0.62, windowEnd: 0.84 },
    liftSeconds: 1.5,
    mountReach: 2.2,
    /** Engine noise scares sheep (GDD: within 25 m above idle). */
    noise: { radius: 25, stressPerSec: 14, zoneBase: 4, zonePerMps: 0.6, zoneMax: 16 },
    hornWolfMorale: 45,
    hornRadius: 30,
  },
  wolf: {
    radius: 0.4,
    speeds: { stalk: 2, hunt: 6.5, flee: 8 },
    huntRange: 25,
    biteRange: 1.2,
    morale: { start: 100, dogBarkPerSec: 10, dogChargePerSec: 60, playerNearPerSec: 25, crookHit: 50 },
    /** Sheep flight zone around a wolf. */
    sheepFlightZone: 15,
    sheepStressGain: 80,
    despawnDistance: 120,
    probeSeconds: 45,
    /** Hushed sheep are hard to notice: a wolf only finds them this close. */
    hushHuntRange: 8,
  },
  night: {
    /** Hush: hold X / R3. Sheep within this radius of the shepherd freeze and go quiet. */
    hushRadius: 25,
    /** Wolves howl from their den at this hour, every evening. */
    howlHour: 19.5,
    /** Chance a sheep left exposed overnight is taken, before the dog's guard. */
    exposedTakeChance: 0.4,
    /** How much a fully bonded dog cuts that chance (0..1). */
    guardStrength: 0.75,
    /** Of the exposed sheep not taken, this share scatter into the countryside. */
    scatterChance: 0.65,
    /** Below this bond, even a closed pen can lose one sheep in the night. */
    penRiskBondBelow: 40,
    /** Wolves take at most this many sheep a night: a loss, never a massacre. */
    maxTaken: 3,
    /** Scattered sheep end up this far (m) from where they were, away from the den. */
    scatterDistance: [35, 85] as [number, number],
    /** Exposed sheep the wolves don't take may still be bitten (condition loss). */
    woundChance: 0.3,
  },
  /** Worn trails: routes the flock walks again and again wear into paths it walks faster and calmer on. */
  trails: {
    /** Wear added per sheep-second walking (0..1 per grass texel). */
    wearPerSheepSecond: 0.004,
    /** Only walking sheep wear the ground, not grazing ones. */
    minSpeed: 0.8,
    decayPerHour: 0.004,
    /** Follow speed bonus on a fully worn trail. */
    speedBonus: 0.2,
    /** Stress decays this much faster on a familiar path. */
    calmBonus: 1.5,
    /** Grass on a worn trail can't grow back above 1 - wear × this. */
    grassCap: 0.9,
  },
  /** Each sheep's condition (0..100): the flock as fragile cargo. */
  condition: {
    start: 90,
    /** Sustained stress above this wears a sheep down. */
    stressAbove: 70,
    stressLossPerHour: 10,
    bite: 35,
    thornCatch: 6,
    slopeStuck: 8,
    /** Midday heat with a dry throat. */
    heatLossPerHour: 3,
    heatThirst: 60,
    recoverPerHour: 2,
    limpBelow: 50,
    limpSpeed: 0.85,
    nightPenned: 15,
    nightOut: 5,
  },
  /** The morning satchel: three slots, packed at home. */
  satchel: {
    slots: 3,
    reach: 2.5,
    salveUses: 2,
    salveHeal: 40,
    /** Sheep within this of a salt lick stay calm and graze near it. */
    saltRadius: 18,
    /** Çay: half an in-game hour, sitting; calms everything within this radius. */
    cayRadius: 25,
    cayHours: 0.5,
    caySeconds: 4,
    cayBond: 3,
    /** A sheep on the halter rope walks this close behind. */
    ropeStop: 1.6,
    ropeReach: 3,
  },
  /** Sling (sapan): warning stones, never to kill. */
  sling: {
    speed: 16,
    elevationDeg: 25,
    cooldown: 1.2,
    wolfRadius: 6,
    wolfMorale: 40,
    sheepRadius: 6,
    sheepStress: 12,
  },
  /** Wolf ground around the den: it announces itself with signs, and lingering there draws a wolf. */
  /** Uncle Ahmet's notes: E within this distance (m) reads one. */
  notes: { reach: 1.8 },
  territory: {
    radius: 50,
    /** Flock inside this long (s, daylight): Karabaş barks a warning. */
    warnSeconds: 20,
    /** …and this long: a wolf comes out of the forest. */
    wolfSeconds: 45,
    signSeenRange: 12,
  },
  /** The economy (GDD feature 6): lira, tight in the first season. */
  economy: {
    startLira: 120,
    /** Fresh milk at the dairy, lira per litre (× how well the flock ate and drank). */
    milkPerLitre: 4,
    litresPerEwe: 0.55,
    /** Milking: from dawn until this hour, with most of the flock penned; time runs fast. */
    milkUntilHour: 11,
    milkSeconds: 8,
    milkHours: 1,
    /** Milk not sold by this hour turns. */
    milkSoursAt: 20,
    churnLitres: 20,
    herbPrice: { thyme: 3, sage: 5, tea: 12 },
    prices: { kibble: 70, fuelPerLitre: 5, jerrycan: 45, patches: 15, chainOil: 12, cay: 2, tickCollar: 120, press: 300, spikedCollar: 250, tyres: 350, pen: 400 },
    /** Heavy rain some nights washes finds out of the ruin's soil. */
    rainChance: 0.35,
    findsPerRain: [1, 2],
    /** The museum pays this share of a find's worth (and tells you about it). */
    museumShare: 0.4,
    /** Cheese: litres per wheel, wheels the shelf holds, and prices fresh → aged. */
    cheese: { litresPerWheel: 6, shelf: 8, ageDays: 3, fresh: 30, aged: 55, pressSeconds: 6, pressHours: 1 },
    /** What the upgrades change. */
    upgrade: { tickCollar: 0.25, spikedCollarBite: 0.3, tyresPuncture: 0.3, tyresMudGrip: 1.35 },
    jerrycanLitres: 10,
    patchesPerKit: 3,
    chainOilUses: 5,
    startPatches: 2,
    startChainOil: 3,
    /** A shop counter or herb patch within this, metres. */
    reach: 2,
    /** The bike counts as "here" (for milk on the rack, fuel) within this of a counter. */
    bikeReach: 30,
  },
  /** Village life (GDD feature 6d): the calendar, the vet, shearing, errands and standing. */
  village: {
    summerDays: 28,
    vet: { dog: 25, tonic: 45, tonicCondition: 25, dogReach: 15 },
    wool: { price: 15, shearSeconds: 3, shearHours: 0.3, reach: 1.6 },
    /** Each errand done raises your standing; shops knock this much off per point, up to `max` points. */
    reputation: { discountPer: 0.05, max: 3 },
    /** Errand rewards (lira), raised by `growth` each time round the list. */
    jobs: { thyme: 45, goat: 70, wedding: 160, thymeBundles: 4, weddingWheels: 2, growth: 0.2 },
  },
  /** The motorcycle's care loop (GDD feature 5). Scaled to the valley: a tank is ~15 km, a few days. */
  bikeCare: {
    start: { fuel: 4.5, plug: 85, carb: 85, chain: 85 },
    tank: 6,
    /** Uncle Ahmet's drum at home (the village sells more in feature 6). */
    drumLiters: 30,
    litresPerKm: 0.4,
    idleLitresPerHour: 0.15,
    /** Below this a part shows symptoms; below `service` the job is offered. */
    symptom: 40,
    service: 60,
    misfirePerSec: 0.6,
    sputterLiters: 0.3,
    sputterPerSec: 0.8,
    skipPerSec: 0.8,
    idleStallPerSec: 0.08,
    wobbleBelow: 60,
    /** On a flat tyre the engine won't push past this, m/s (about 12 km/h). */
    flatMaxSpeed: 3.4,
    plugPerKm: 4,
    plugIdlePerHour: 3,
    plugPerKick: 0.5,
    carbPerKm: 1,
    carbDustPerKm: 5,
    chainPerKm: 3,
    chainMudPerKm: 25,
    /** Puncture chance per metre ridden through maquis and thorns, or over rock. */
    punctureBrushPerM: 0.0015,
    punctureRockPerM: 0.0008,
    /** A punctured tyre loses this much pressure per in-game hour. */
    leakPerHour: 25,
  },
  /** Karabaş's care loop (GDD feature 5): food, water, ticks, and the bond over days. */
  dogCare: {
    start: { satiety: 70, hydration: 90 },
    satietyPerHour: 4,
    hydrationPerHour: 6,
    /** Running doubles hunger; the midday heat doubles thirst. */
    runFactor: 2,
    heatFactor: 2,
    /** Below these: stamina regen halves (hungry), no running (thirsty). */
    hungry: 30,
    thirsty: 20,
    /** Left to himself he goes to drink / to the bowl below these. */
    seekWater: 45,
    seekFood: 60,
    /** How far he will go for water or the bowl, metres. */
    waterReach: 60,
    bowlReach: 90,
    mealSatiety: 60,
    handSatiety: 45,
    handBond: 2,
    drinkPerSec: 25,
    ticksMax: 5,
    /** Chance per in-game hour of moving through maquis or pines. */
    ticksPerBrushHour: 3,
    /** Each tick takes this share off his maximum stamina. */
    tickStamina: 0.05,
    /** Seconds of holding E to pick off one tick. */
    pickSeconds: 1.5,
    pickReach: 2,
    sackMeals: 14,
    /** Overnight hunger (he sleeps, so less than a day's worth). */
    nightSatiety: 20,
    bond: { notPetted: -3, hungry: -2, perTick: -0.5 },
  },
  dogInjury: {
    /** Chance per second of being bitten while charging a wolf at close quarters. */
    biteChancePerSec: 0.35,
    range: 1.6,
    /** Speed multiplier while wounded. */
    limp: 0.6,
    healPerNight: 50,
    healPerNightLowBond: 25,
  },
  works: {
    /** In-game time runs this much faster while building (a day's labour in a minute). */
    buildTimeRate: 8,
    cairnSeconds: 1.5,
    maxCairns: 12,
    /** Rain the cistern collects each night, litres. */
    cisternRain: 60,
    cisternCapacity: 160,
  },
  debug: {
    showColliders: false,
    showGrid: false,
    showLabels: false,
    showSheepModes: false,
    showSheepForces: false,
    showGrass: true,
  },
};

export type Config = typeof config;

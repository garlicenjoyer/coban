// Shared lighting and sky palette for the cel-shaded valley.
//
// Night sky: stars that wheel slowly about the pole (Selçuk is at 38° N), the summer Milky
// Way, and a moon on a 29.5-day cycle tied to the calendar, so the 28 summer days run through
// one full moon and one new moon. The moon rises later each night, lights the valley with
// cool light that casts shadows, and washes out the faint stars. A moonless night is the
// darkest one: the haze closes in to ~25 m.

import * as THREE from 'three';
import { DAWN_HOUR, GOLDEN_HOUR, SUNSET_HOUR } from '../core/config';

export const PALETTE = {
  sun: 0xffe6bf,
  skyZenith: new THREE.Color(0x86bfe8),
  skyHorizon: new THREE.Color(0xfbe7cb),
  /** Haze colour the distance fades into (matches the horizon). */
  haze: new THREE.Color(0xf3e2c8),
  sunHaze: new THREE.Color(0xffe4b0),
  outline: new THREE.Color(0x3b2a20),
};

const DAY_FILL = new THREE.Color(0xd6ecff);
const DAY_GROUND = new THREE.Color(0xd3a273);
const GOLD_SUN = new THREE.Color(0xffac65);
const GOLD_HORIZON = new THREE.Color(0xf2ad79);
const GOLD_ZENITH = new THREE.Color(0x7187c5);
const GOLD_HAZE = new THREE.Color(0xe7ad8e);
const NIGHT_SKY = new THREE.Color(0x10172e);
const NIGHT_HORIZON = new THREE.Color(0x2c3756);
const NIGHT_GROUND = new THREE.Color(0x36334c);
const NIGHT_FILL = new THREE.Color(0x839dcf);
const MOON_LIGHT = new THREE.Color(0xa9bde6);

/** Synodic month, days. */
export const LUNAR_DAYS = 29.53;
/** Moon phase on day 1 (0 new, 0.25 first quarter, 0.5 full): a waxing crescent, full on day 9. */
const PHASE_DAY1 = 0.24;

/** Moon phase 0..1 (0 new, 0.5 full) on the evening of a calendar day. */
export function moonPhase(day: number): number {
  const p = PHASE_DAY1 + (day - 1) / LUNAR_DAYS;
  return p - Math.floor(p);
}

/** Share of the moon's disc that is lit, 0..1. */
export const moonIllumination = (phase: number): number => 0.5 * (1 - Math.cos(phase * Math.PI * 2));

/** Sun/moon direction for an hour angle (0 = rising in the east, π/2 = high in the south). */
function arcDir(out: THREE.Vector3, theta: number): THREE.Vector3 {
  return out.set(Math.cos(theta), 1.65 * Math.sin(theta), 0.7 * Math.sin(theta)).normalize();
}

/**
 * Where the moon is: it trails the sun by `phase` of a day, so a full moon rises at sunset
 * and a first-quarter moon is high at dusk and sets around midnight.
 */
export function moonDirection(out: THREE.Vector3, hour: number, phase: number): THREE.Vector3 {
  return arcDir(out, ((hour - 6 - phase * 24) / 24) * Math.PI * 2);
}

function createSun(scene: THREE.Scene): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -50;
  sc.right = sc.top = 50;
  sc.near = 1;
  sc.far = 260;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  return sun;
}

/** Gradient sky with a soft sun glow. Follows the camera; writes no depth (post skips it). */
function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uZenith: { value: PALETTE.skyZenith.clone() },
      uHorizon: { value: PALETTE.skyHorizon.clone() },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunGlow: { value: 1 },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uStarRot: { value: new THREE.Matrix3() },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonSun: { value: new THREE.Vector3(1, 0, 0) },
      uMoonLit: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform float uSunGlow;
      uniform float uNight;
      uniform float uTime;
      uniform mat3 uStarRot;
      uniform vec3 uMoonDir;
      uniform vec3 uMoonSun;
      uniform float uMoonLit;
      varying vec3 vDir;

      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }
      vec3 hash33(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.xxy + p.yxx) * p.zyx);
      }
      float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
          f.z);
      }
      // One layer of stars: a jittered point in some cells of a 3D grid over the sphere.
      float stars(vec3 d, float scale, float density, float size) {
        vec3 p = d * scale;
        vec3 c = floor(p);
        if (hash13(c) > density) return 0.0;
        vec3 j = hash33(c + 7.0) * 0.6 + 0.2;
        float r = length(p - c - j);
        float b = hash13(c + 3.1);
        float tw = 0.75 + 0.25 * sin(uTime * (1.5 + 3.0 * b) + b * 40.0);
        return smoothstep(size, size * 0.2, r) * (0.3 + 0.7 * b * b) * tw;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.75, h), 0.7));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += vec3(1.0, 0.86, 0.6) * uSunGlow * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.18);

        if (uNight > 0.01 && h > 0.0) {
          vec3 sd = uStarRot * d;
          float up = smoothstep(0.0, 0.28, h);
          // The summer Milky Way: a soft, lumpy band with a dark rift down its middle.
          float band = dot(sd, normalize(vec3(0.18, 0.6, 0.78)));
          float mwBand = exp(-band * band / 0.018);
          float lumps = noise3(sd * 5.0) * 0.6 + noise3(sd * 13.0) * 0.4;
          float rift = 1.0 - 0.65 * exp(-pow((band - 0.015) / 0.028, 2.0)) * smoothstep(0.35, 0.7, noise3(sd * 3.0 + 9.0));
          float mw = mwBand * lumps * rift;
          float wash = 1.0 - 0.75 * uMoonLit;
          col += vec3(0.42, 0.47, 0.66) * mw * 0.16 * uNight * up * (1.0 - 0.9 * uMoonLit);
          float st = stars(sd, 230.0, 0.10 + 0.3 * mwBand, 0.24) * 0.7 + stars(sd, 85.0, 0.05, 0.12) * 1.6;
          col += vec3(0.95, 0.95, 1.0) * st * uNight * up * wash;
        }

        // The moon: a cel-shaded disc lit from the sun's side, with a soft halo.
        float cm = dot(d, uMoonDir);
        float R = 0.026;
        float sinR = sin(R);
        if (cm > cos(R * 1.2) && uMoonDir.y > -0.05) {
          vec3 o = (d - uMoonDir * cm) / sinR;
          float u = length(o);
          vec3 n = o - uMoonDir * sqrt(max(1.0 - u * u, 0.0));
          float lit = smoothstep(-0.04, 0.04, dot(n, uMoonSun));
          float maria = smoothstep(0.45, 0.7, noise3(n * 3.2 + 4.0));
          vec3 face = mix(col * 0.9 + vec3(0.02, 0.025, 0.04), vec3(1.0, 0.96, 0.86) * (1.0 - 0.18 * maria), lit);
          float disc = 1.0 - smoothstep(0.95, 1.0, u);
          float vis = mix(0.35, 1.0, uNight) * smoothstep(-0.05, 0.02, d.y);
          col = mix(col, face, disc * vis);
        }
        col += vec3(0.55, 0.62, 0.85) * uMoonLit * uNight * (pow(max(cm, 0.0), 3000.0) * 0.35 + pow(max(cm, 0.0), 120.0) * 0.07);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  sky.scale.setScalar(4000);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.name = 'sky';
  return sky;
}

export class Daylight {
  readonly sunDirection = new THREE.Vector3();
  readonly haze = new THREE.Color();
  readonly sunHaze = new THREE.Color();
  night = 0;
  sunGlow = 0;
  /** Direct sunlight, 0..1 (0 at night, low at golden hour): cloud shadows scale with it. */
  direct = 0;
  /** Moonlight on the valley, 0..1 (full moon high in the sky = 1). */
  moonlight = 0;
  readonly moonDir = new THREE.Vector3();
  private readonly moonSun = new THREE.Vector3();
  private readonly starRot = new THREE.Matrix4();
  private static readonly POLE = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(38)), -Math.cos(THREE.MathUtils.degToRad(38)));
  private readonly sky = createSky();
  private readonly hemi = new THREE.HemisphereLight();
  private readonly sun: THREE.DirectionalLight;

  constructor(scene: THREE.Scene) {
    this.sun = createSun(scene);
    scene.add(this.sky, this.hemi);
  }

  update(hour: number, day: number, shadowFocus: THREE.Vector3, eye: THREE.Vector3): void {
    const { clamp, lerp, smoothstep } = THREE.MathUtils;
    const progress = clamp((hour - DAWN_HOUR) / (SUNSET_HOUR - DAWN_HOUR), 0, 1);
    const arc = progress * Math.PI;
    const rise = Math.sin(arc);
    this.sunDirection.set(Math.cos(arc), 1.65 * rise, 0.7 * rise).normalize();

    const gold = smoothstep(hour, GOLDEN_HOUR - 0.75, GOLDEN_HOUR + 0.15);
    this.night = 1 - smoothstep(hour, DAWN_HOUR - 0.6, DAWN_HOUR + 0.75)
      + smoothstep(hour, SUNSET_HOUR - 0.25, SUNSET_HOUR + 0.75);
    const direct = smoothstep(hour, DAWN_HOUR, DAWN_HOUR + 1.1)
      * (1 - smoothstep(hour, GOLDEN_HOUR + 0.25, SUNSET_HOUR));
    this.sunGlow = (1 - this.night) * smoothstep(rise, 0, 0.1);

    this.direct = direct;

    // The moon. Its terminator faces where the sun really is (below the horizon at night).
    const phase = moonPhase(day);
    moonDirection(this.moonDir, hour, phase);
    arcDir(this.moonSun, ((hour - 6) / 24) * Math.PI * 2);
    this.moonlight = moonIllumination(phase) * smoothstep(this.moonDir.y, 0.0, 0.3);
    const moonI = 0.55 * this.moonlight * this.night;
    const sunI = lerp(2.9, 2.15, gold) * direct;

    // One shadow-casting light: the sun by day, the moon by night.
    const byMoon = moonI > sunI;
    this.sun.target.position.copy(shadowFocus);
    this.sun.position.copy(shadowFocus).addScaledVector(byMoon ? this.moonDir : this.sunDirection, 120);
    if (byMoon) this.sun.color.copy(MOON_LIGHT);
    else this.sun.color.setHex(PALETTE.sun).lerp(GOLD_SUN, gold);
    this.sun.intensity = byMoon ? moonI : sunI;
    this.sun.castShadow = this.sun.intensity > 0;
    this.hemi.intensity = lerp(1.05, 0.18 + 0.12 * this.moonlight, this.night);
    this.hemi.color.copy(DAY_FILL).lerp(NIGHT_FILL, this.night);
    this.hemi.groundColor.copy(DAY_GROUND).lerp(NIGHT_GROUND, this.night);

    this.sky.position.copy(eye);
    const u = this.sky.material.uniforms;
    u.uZenith.value.copy(PALETTE.skyZenith).lerp(GOLD_ZENITH, gold).lerp(NIGHT_SKY, this.night);
    u.uHorizon.value.copy(PALETTE.skyHorizon).lerp(GOLD_HORIZON, gold).lerp(NIGHT_HORIZON, this.night);
    u.uSunDir.value.copy(this.sunDirection);
    u.uSunGlow.value = this.sunGlow;
    u.uNight.value = this.night;
    u.uTime.value = performance.now() / 1000;
    u.uMoonDir.value.copy(this.moonDir);
    u.uMoonSun.value.copy(this.moonSun);
    u.uMoonLit.value = this.moonlight;
    // The sky turns once a day about the celestial pole (hour angle, plus a little each day).
    this.starRot.makeRotationAxis(Daylight.POLE, -((hour + day * 0.0657) / 24) * Math.PI * 2);
    u.uStarRot.value.setFromMatrix4(this.starRot);
    this.haze.copy(PALETTE.haze).lerp(GOLD_HAZE, gold).lerp(NIGHT_HORIZON, this.night);
    this.sunHaze.copy(PALETTE.sunHaze).lerp(GOLD_HORIZON, gold);
  }
}

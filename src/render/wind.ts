// One wind for the whole valley: the summer meltem from the north-north-east.
//
// Grass, flowers, trees and shrubs all bend to the same field, so a gust is something you
// can watch roll across a pasture: a band of brighter, flattened grass travelling downwind,
// the olives flashing the silver undersides of their leaves as it reaches them. The clouds
// and their shadows drift with it too.
//
// The meltem is a daytime wind: calm at dawn, building through the morning, strongest in
// the afternoon, dropping after sunset.

import * as THREE from 'three';

export const windSettings = {
  /** Overall strength (1 = a normal summer afternoon). */
  strength: 1,
  /** Compass bearing the wind blows FROM, degrees (0 = north, 20 = north-north-east). */
  fromDeg: 20,
  /** Cloud drift, metres per second at strength 1. */
  cloudSpeed: 6,
};

/** Shared uniforms: every swaying material points at these same objects. */
export const windUniforms = {
  uWindTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0, 1) },
  uWindStrength: { value: 1 },
};

/** Where the cloud field has drifted to (metres), for the clouds and their shadows. */
export const cloudOffset = new THREE.Vector2();

/** How strong the meltem is at a given hour (0..24), before `windSettings.strength`. */
export function meltem(hour: number): number {
  const { smoothstep } = THREE.MathUtils;
  const build = smoothstep(hour, 8, 15);
  const drop = smoothstep(hour, 19, 22.5);
  return 0.45 + 0.75 * build * (1 - drop);
}

/** Advance the wind: `time` in real seconds (drives the motion), `hour` in-game. */
export function updateWind(time: number, dt: number, hour: number): void {
  // Map axes: +x is east, +z is south. Wind blowing from bearing b travels toward b + 180°.
  const b = THREE.MathUtils.degToRad(windSettings.fromDeg);
  windUniforms.uWindDir.value.set(-Math.sin(b), Math.cos(b));
  windUniforms.uWindStrength.value = windSettings.strength * meltem(hour);
  windUniforms.uWindTime.value = time;
  cloudOffset.addScaledVector(windUniforms.uWindDir.value, windSettings.cloudSpeed * (0.5 + 0.5 * windUniforms.uWindStrength.value) * dt);
}

/** GLSL: the gust field, 0 (lull) .. 1 (gust front), at a world xz position. */
export const GUST_GLSL = /* glsl */ `
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
varying float vShimmer;
float windGust(vec2 p) {
  vec2 perp = vec2(-uWindDir.y, uWindDir.x);
  float along = dot(p, uWindDir);
  float side = dot(p, perp);
  // Bands about 150 m apart rolling downwind at ~8 m/s, bent and broken up sideways.
  float w = along * 0.042 - uWindTime * 0.34
    + sin(side * 0.019 + uWindTime * 0.05) * 1.9
    + sin(side * 0.0061 - along * 0.0043) * 2.6;
  float band = smoothstep(0.35, 1.0, 0.5 + 0.5 * sin(w));
  float slow = 0.6 + 0.4 * sin(uWindTime * 0.07 + along * 0.0021);
  return band * slow;
}
`;

export interface SwayOptions {
  /** Unique name, so three.js compiles a separate program per configuration. */
  key: string;
  /** How far (m) the top bends in a gust at `refHeight` above the base. */
  bend: number;
  /** Height (m) the bend is measured at; the bend grows with the square of height. */
  refHeight: number;
  /** Small fast leaf flutter (m) in gusts. */
  flutter?: number;
  /** Colour shown in gusts (silver olive leaf undersides, light grass). */
  shimmerColor?: THREE.ColorRepresentation;
  /** 0..1: how much of that colour shows at the height of a gust. */
  shimmer?: number;
  /**
   * How the bend grows: 'height' (trees: with the square of world height above the base),
   * 'local' (grass tufts: with the square of local y, 0..1, times the tuft's height),
   * 'rigid' (flower heads: the whole instance moves by `bend`).
   */
  mode?: 'height' | 'local' | 'rigid';
  /** Extra vertex code run first (inside begin_vertex), e.g. range fading. */
  prelude?: string;
}

const f = (n: number) => n.toFixed(4);

function swayK(o: SwayOptions): string {
  if (o.mode === 'rigid') return 'float swayK = 1.0;';
  if (o.mode === 'local') {
    // transformed.y already carries any range fade; the instance's y scale is the tuft height.
    return `float swayH = max(transformed.y, 0.0);
        #ifdef USE_INSTANCING
          float swayK = swayH * swayH * length(instanceMatrix[1].xyz) / ${f(o.refHeight)};
        #else
          float swayK = swayH * swayH;
        #endif`;
  }
  return `float swayH = max(swayWorld.y - swayBase.y, 0.0) / ${f(o.refHeight)};
        float swayK = swayH * swayH;`;
}

/**
 * Make a material sway in the shared wind. Works for instanced meshes (each instance bends
 * from its own base) and plain meshes (bending from the mesh origin). The offset is applied in
 * world space after instancing, so meshes using it must sit unrotated under the scene root.
 */
export function sway(mat: THREE.Material, o: SwayOptions): void {
  const shimmer = new THREE.Color(o.shimmerColor ?? 0xffffff);
  const shimmerAmt = o.shimmer ?? 0;
  mat.customProgramCacheKey = () => `sway:${o.key}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GUST_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${o.prelude ?? ''}
        #ifdef USE_INSTANCING
          vec3 swayBase = instanceMatrix[3].xyz;
          vec3 swayWorld = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vec3 swayBase = modelMatrix[3].xyz;
          vec3 swayWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        ${swayK(o)}
        float gust = windGust(swayBase.xz);
        float phase = fract(sin(dot(swayBase.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
        vec2 swayPerp = vec2(-uWindDir.y, uWindDir.x);
        float s = uWindStrength;
        vec2 swayOff = uWindDir * (0.25 + 1.1 * gust) * s
          + swayPerp * sin(uWindTime * 1.3 + phase) * (0.12 + 0.25 * gust) * s
          + uWindDir * sin(uWindTime * 2.1 + phase) * 0.15 * s;
        vec3 windOffset = vec3(swayOff.x, 0.0, swayOff.y) * ${f(o.bend)} * swayK;
        ${o.flutter ? `windOffset += sin(uWindTime * 8.0 + dot(swayWorld, vec3(3.1, 1.7, 2.3))) * ${f(o.flutter)} * (0.3 + gust) * s * min(swayK, 1.0) * vec3(1.0, 0.6, 1.0);` : ''}
        vShimmer = ${shimmerAmt > 0 ? `clamp(gust * s * (0.55 + 0.45 * sin(uWindTime * 5.0 + dot(swayWorld, vec3(2.3, 1.9, 3.7)))), 0.0, 1.0) * min(swayK * 4.0, 1.0)` : '0.0'};`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelMatrix * mvPosition;
        mvPosition.xyz += windOffset;
        mvPosition = viewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    if (shimmerAmt > 0) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vShimmer;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${f(shimmer.r)}, ${f(shimmer.g)}, ${f(shimmer.b)}), vShimmer * ${f(shimmerAmt)});`,
        );
    }
  };
  mat.needsUpdate = true;
}

// Post pass: the "bigger world" shader plus the cel look's finishing touches.
//
//  - Aerial perspective: with distance, colour fades toward a warm horizon haze and loses
//    saturation and contrast, the haze glowing a little toward the sun. Painters use this to
//    make a valley read as miles deep; here it turns a 400 m map into a landscape.
//  - Morning mist pooling in low ground (height fog).
//  - Cloud shadows: soft-edged patches of cool shade drifting across the valley with the
//    wind, cast along the sun's direction from a cloud field ~350 m up.
//  - Soft ink outlines from depth discontinuities, fading into the haze.
//  - Warm grade and a gentle vignette.
//
// The scene renders into a multisampled half-float target with a depth texture; one
// full-screen triangle composes the result, then tone maps and outputs sRGB.

import * as THREE from 'three';
import { PALETTE, type Daylight } from './style';
import { cloudOffset } from './wind';
import { cloudThreshold, noiseTexture } from './noiseTex';

export const postSettings = {
  enabled: true,
  /** Distance (m) at which haze reaches ~63%. */
  hazeDistance: 950,
  hazeCurve: 1.7,
  hazeMax: 0.92,
  desaturate: 0.55,
  mist: 0.16,
  mistHeight: 2.5,
  outline: 0.75,
  outlineThreshold: 0.035,
  warmth: 0.05,
  vignette: 0.22,
  /** How dark a cloud shadow is (0 = off). */
  cloudShadow: 0.36,
  /** Share of the ground under cloud, roughly (fair-weather summer cumulus). */
  cloudCover: 0.3,
  /**
   * Multisampling of the scene target (0, 2 or 4). The biggest single GPU cost after the
   * scene itself: on a high-DPI screen the pixels are already small, so 2 samples look the
   * same as 4 and save ~1.5 ms a frame at retina size.
   */
  msaa: typeof window !== 'undefined' && window.devicePixelRatio >= 1.5 ? 2 : 4,
  /** Share of the canvas resolution the scene renders at (0.5..1); the post pass upscales. */
  renderScale: 1,
};

export class PostFX {
  readonly target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private lastCover = -1;
  /** Full output size in pixels; the target is this times `renderScale`. */
  private fullW = 1;
  private fullH = 1;
  private scale = 1;

  constructor(w: number, h: number) {
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: postSettings.msaa,
      depthTexture: new THREE.DepthTexture(w, h),
    });
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
        uHaze: { value: PALETTE.haze.clone() },
        uSunHaze: { value: PALETTE.sunHaze.clone() },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunGlow: { value: 1 },
        uOutlineColor: { value: PALETTE.outline.clone() },
        uHazeDistance: { value: postSettings.hazeDistance },
        uHazeCurve: { value: postSettings.hazeCurve },
        uHazeMax: { value: postSettings.hazeMax },
        uDesat: { value: postSettings.desaturate },
        uMist: { value: postSettings.mist },
        uMistHeight: { value: postSettings.mistHeight },
        uOutline: { value: postSettings.outline },
        uOutlineThreshold: { value: postSettings.outlineThreshold },
        uWarmth: { value: postSettings.warmth },
        uVignette: { value: postSettings.vignette },
        uCloudShadow: { value: 0 },
        uCloudThreshold: { value: 0.6 },
        tNoise: { value: noiseTexture() },
        uCloudOffset: { value: new THREE.Vector2() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <packing>
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform mat4 uProjInv;
        uniform mat4 uCamWorld;
        uniform vec3 uCamPos;
        uniform float uNear;
        uniform float uFar;
        uniform vec2 uTexel;
        uniform vec3 uHaze;
        uniform vec3 uSunHaze;
        uniform vec3 uSunDir;
        uniform float uSunGlow;
        uniform vec3 uOutlineColor;
        uniform float uHazeDistance;
        uniform float uHazeCurve;
        uniform float uHazeMax;
        uniform float uDesat;
        uniform float uMist;
        uniform float uMistHeight;
        uniform float uOutline;
        uniform float uOutlineThreshold;
        uniform float uWarmth;
        uniform float uVignette;
        uniform float uCloudShadow;
        uniform float uCloudThreshold;
        uniform sampler2D tNoise;
        uniform vec2 uCloudOffset;
        varying vec2 vUv;

        // 0 (sunlit) .. 1 (under a cloud) for a world position.
        float cloudShade(vec3 wp) {
          vec3 sd = normalize(uSunDir);
          // Follow the sun ray up to the cloud layer.
          vec2 q = wp.xz + sd.xz / max(sd.y, 0.2) * (350.0 - wp.y) - uCloudOffset;
          // The baked fBm tile spans 8 cells: one cell = 150 m, so it repeats every 1.2 km.
          float n = texture2D(tNoise, q / (150.0 * 8.0)).g;
          // A narrow soft edge, so the shadow reads as a cel band rather than a blur.
          return smoothstep(uCloudThreshold, uCloudThreshold + 0.03, n);
        }

        float viewZ(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          return -perspectiveDepthToViewZ(d, uNear, uFar);
        }

        void main() {
          vec4 c4 = texture2D(tColor, vUv);
          vec3 col = c4.rgb;
          float depth = texture2D(tDepth, vUv).x;
          if (depth < 1.0) {
            // World position of this pixel.
            vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
            vec4 vp = uProjInv * ndc;
            vp /= vp.w;
            vec3 wp = (uCamWorld * vp).xyz;
            vec3 ray = wp - uCamPos;
            float dist = length(ray);
            vec3 dir = ray / max(dist, 1e-3);

            // Cloud shadow: cool shade, a little stronger on red so it reads as sky-lit.
            if (uCloudShadow > 0.0) col *= 1.0 - cloudShade(wp) * uCloudShadow * vec3(1.0, 0.88, 0.6);

            // Ink outlines where depth jumps (relative, so it works near and far).
            float z = -vp.z;
            float zl = viewZ(vUv - vec2(uTexel.x, 0.0));
            float zr = viewZ(vUv + vec2(uTexel.x, 0.0));
            float zd = viewZ(vUv - vec2(0.0, uTexel.y));
            float zu = viewZ(vUv + vec2(0.0, uTexel.y));
            float jump = max(max(zl, zr), max(zd, zu)) - z;
            float edge = smoothstep(uOutlineThreshold, uOutlineThreshold * 2.5, jump / z);
            // Grass writes alpha 0: no ink lines on or around blades (they would fizz).
            float solid = min(min(c4.a, texture2D(tColor, vUv + vec2(uTexel.x, 0.0)).a), min(texture2D(tColor, vUv - vec2(uTexel.x, 0.0)).a, min(texture2D(tColor, vUv + vec2(0.0, uTexel.y)).a, texture2D(tColor, vUv - vec2(0.0, uTexel.y)).a)));
            edge *= smoothstep(0.3, 0.95, solid);

            // Aerial perspective.
            float haze = 1.0 - exp(-pow(dist / uHazeDistance, uHazeCurve));
            // Morning mist in low ground, thinning with height, building with distance.
            float mist = uMist * exp(-max(wp.y, 0.0) / uMistHeight) * smoothstep(40.0, 260.0, dist);
            float f = clamp(max(haze, mist) * uHazeMax, 0.0, 1.0);

            col = mix(col, uOutlineColor * 0.6 + col * 0.25, edge * uOutline * (1.0 - f));
            float sunward = pow(max(dot(dir, normalize(uSunDir)), 0.0), 6.0);
            vec3 hazeCol = mix(uHaze, uSunHaze, sunward * uSunGlow * 0.7);
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(col, vec3(l), f * uDesat);
            col = mix(col, hazeCol, f);
          }
          // Warm grade and vignette.
          col *= vec3(1.0 + uWarmth, 1.0, 1.0 - uWarmth);
          vec2 q = vUv - 0.5;
          col *= 1.0 - uVignette * dot(q, q) * 2.0;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w: number, h: number): void {
    this.fullW = w;
    this.fullH = h;
    this.scale = THREE.MathUtils.clamp(postSettings.renderScale, 0.5, 1);
    const tw = Math.max(1, Math.floor(w * this.scale));
    const th = Math.max(1, Math.floor(h * this.scale));
    this.target.setSize(tw, th);
    (this.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / tw, 1 / th);
  }

  /** Apply changed quality settings (MSAA, render scale) before drawing. */
  private syncQuality(): void {
    const samples = postSettings.msaa;
    if (this.target.samples !== samples) {
      this.target.samples = samples;
      this.target.dispose(); // reallocated with the new sample count on next use
    }
    if (THREE.MathUtils.clamp(postSettings.renderScale, 0.5, 1) !== this.scale) this.setSize(this.fullW, this.fullH);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, daylight: Daylight): void {
    if (!postSettings.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    this.syncQuality();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const u = this.mat.uniforms;
    camera.updateMatrixWorld();
    (u.uProjInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    (u.uCamPos.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uHaze.value.copy(daylight.haze);
    u.uSunHaze.value.copy(daylight.sunHaze);
    u.uSunDir.value.copy(daylight.sunDirection);
    u.uSunGlow.value = daylight.sunGlow;
    // Nights close in; moonlight opens them up again (a full moon roughly doubles the view).
    u.uHazeDistance.value = THREE.MathUtils.lerp(postSettings.hazeDistance, 25 + 40 * daylight.moonlight, daylight.night);
    u.uCloudShadow.value = postSettings.cloudShadow * daylight.direct;
    if (postSettings.cloudCover !== this.lastCover) {
      this.lastCover = postSettings.cloudCover;
      u.uCloudThreshold.value = cloudThreshold(postSettings.cloudCover);
    }
    u.uCloudOffset.value.copy(cloudOffset);
    u.uHazeCurve.value = postSettings.hazeCurve;
    u.uHazeMax.value = THREE.MathUtils.lerp(postSettings.hazeMax, 1, daylight.night);
    u.uDesat.value = postSettings.desaturate;
    u.uMist.value = postSettings.mist * (1 - daylight.night);
    u.uMistHeight.value = postSettings.mistHeight;
    u.uOutline.value = postSettings.outline;
    u.uOutlineThreshold.value = postSettings.outlineThreshold;
    u.uWarmth.value = THREE.MathUtils.lerp(postSettings.warmth, -0.04, daylight.night);
    u.uVignette.value = postSettings.vignette;
    renderer.render(this.scene, this.cam);
  }
}

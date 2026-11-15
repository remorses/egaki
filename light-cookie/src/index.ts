/**
 * Light cookie: an image lit like a real object on a wall. A three.js scene
 * with the image as a tilted, skewed plane, a warm spot light projecting a
 * cookie texture (window, blinds, beam) with moving shadows (leaves, bars),
 * a soft spill light and a dim ambient fill. Post: bloom, ACES tone mapping,
 * chromatic aberration, grade, vignette and film grain.
 *
 *   window light ──▶ cookie canvas (light shape × shadow shape, blurred)
 *        │                           │ spotLight.map (projected texture)
 *        ▼                           ▼
 *   image plane (MeshStandardMaterial, bump from the image) ──▶ camera
 *        ──▶ RenderPass ──▶ UnrealBloom ──▶ OutputPass ──▶ FinishPass ──▶ canvas
 *
 * Browser only. World units are css px: the z=0 plane maps 1:1 to the frame.
 * Every animated value is a pure function of time / duration and loops over
 * the duration (except `push`), so frame N of a video always looks the same.
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

export const LIGHT_PRESETS = ['window', 'church', 'blinds', 'beam', 'none'] as const
export const SHADOW_PRESETS = ['leaves', 'birds', 'bars', 'none'] as const
export type LightPreset = (typeof LIGHT_PRESETS)[number]
export type ShadowPreset = (typeof SHADOW_PRESETS)[number]

export interface LightCookieParams {
  // --- image plane ---
  /** Plane size relative to covering the frame. Above 1 hides the edges when tilted. */
  zoom: number
  /** Degrees. Positive tips the top edge away. */
  rotateX: number
  /** Degrees. Positive pushes the right edge away. */
  rotateY: number
  /** Degrees, counterclockwise. */
  rotateZ: number
  /** Degrees of horizontal shear. */
  skewX: number
  /** Degrees of vertical shear. */
  skewY: number
  /** Shift the plane in px. */
  translateX: number
  translateY: number
  /** Vertical camera field of view in degrees. Smaller is flatter. */
  fov: number

  // --- light ---
  /** Light shape preset. Ignored when a custom light cookie image is passed. */
  lightCookie: LightPreset
  /** Shadow shape preset. Ignored when a custom shadow cookie image is passed. */
  shadowCookie: ShadowPreset
  /** Direction the light comes from in the frame, degrees. 0 right, 90 top, 135 top left. */
  lightAzimuth: number
  /** Light height above the plane, degrees. Low values stretch the patch. */
  lightElevation: number
  /** Where the light patch center lands, as a fraction of frame width / height from the center. */
  lightX: number
  lightY: number
  /** Light patch size as a fraction of the larger frame side (before elevation stretch). */
  lightSize: number
  /** Spot light intensity. About 3 is neutral at 45 degrees elevation. */
  lightIntensity: number
  lightColor: string
  /** Soft wide light around the patch, fraction of lightIntensity. */
  spill: number
  /** Window edge blur as a fraction of the cookie size. */
  softness: number
  /** Shadow cookie blur as a fraction of the cookie size. Shadows sit further from the wall, so softer. */
  shadowSoftness: number
  /** How dark the shadow cookie is inside the light, 0-1. */
  shadowOpacity: number
  /** Shadow media only: luminance below this casts shadow (soft levels). 0 uses the raw grayscale. */
  shadowThreshold: number
  /** Shadow media only: bright pixels cast shadow instead of dark ones. */
  shadowInvert: boolean
  /** Shadow size relative to the window. */
  shadowScale: number
  /** Shadow offset as a fraction of the window size. Positive moves right / up. */
  shadowX: number
  shadowY: number
  /** Ambient fill intensity, lights the parts outside the patch. */
  ambient: number
  ambientColor: string
  /** Surface relief from the image luminance (bump map). 0 is flat. */
  relief: number
  /** Surface sheen, 0 matte to 1 glossy. */
  gloss: number
  /** Random seed for leaves. */
  seed: number

  // --- motion (all loop over the duration except push) ---
  /** How far the light patch drifts, fraction of the frame width. */
  lightDrift: number
  /** Leaf sway in degrees. */
  sway: number
  /** Camera dolly-in over the duration, fraction of the camera distance. */
  push: number
  /** Slow plane rotation amplitude in degrees. */
  orbit: number
  /** Light intensity breathing, fraction. */
  flicker: number

  // --- post ---
  exposure: number
  bloom: number
  grain: number
  /** Grain size in output px. */
  grainSize: number
  vignette: number
  chromaticAberration: number
  /** Warm tint, -1 cool to 1 warm. */
  warmth: number
  contrast: number
  saturation: number
  /** Lift the blacks, 0-0.2. */
  lift: number
  backgroundColor: string
}

export const LIGHT_COOKIE_DEFAULTS: LightCookieParams = {
  zoom: 1.12,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  skewX: 0,
  skewY: 0,
  translateX: 0,
  translateY: 0,
  fov: 30,

  lightCookie: 'window',
  shadowCookie: 'leaves',
  lightAzimuth: 140,
  lightElevation: 38,
  lightX: -0.08,
  lightY: 0.04,
  lightSize: 0.55,
  lightIntensity: 6,
  lightColor: '#ffd2a0',
  spill: 0.08,
  softness: 0.009,
  shadowSoftness: 0.016,
  shadowOpacity: 0.6,
  shadowThreshold: 0.5,
  shadowInvert: false,
  shadowScale: 1,
  shadowX: 0,
  shadowY: 0,
  ambient: 0.32,
  ambientColor: '#9c8070',
  relief: 0.35,
  gloss: 0.15,
  seed: 7,

  lightDrift: 0.03,
  sway: 3,
  push: 0.05,
  orbit: 0.8,
  flicker: 0.02,

  exposure: 1,
  bloom: 0.35,
  grain: 0.07,
  grainSize: 1.5,
  vignette: 0.55,
  chromaticAberration: 0.4,
  warmth: 0.25,
  contrast: 1.08,
  saturation: 1.05,
  lift: 0.02,
  backgroundColor: '#000000',
}

// ---------------------------------------------------------------------------
// Cookie texture: light shape × shadow shape, drawn on a 2D canvas per frame
// ---------------------------------------------------------------------------

const COOKIE_SIZE = 1024
// The spot cone is the circle inscribed in the map square, so content must stay
// inside the inner square of side 1/sqrt(2). 0.68 keeps a margin for the blur.
const COOKIE_CONTENT = 0.68

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Leaf {
  /** Distance along the branch, 0-1. */
  at: number
  side: number
  length: number
  width: number
  angle: number
  phase: number
}

interface Branch {
  x: number
  y: number
  angle: number
  length: number
  bend: number
  thickness: number
  phase: number
  speed: number
  leaves: Leaf[]
}

/** Branches entering the cookie from its edges, in cookie px. */
function createBranches(seed: number): Branch[] {
  const rand = mulberry32(seed)
  const size = COOKIE_SIZE
  const half = (size * COOKIE_CONTENT) / 2
  const center = size / 2
  const branches: Branch[] = []
  const count = 6
  for (let i = 0; i < count; i++) {
    // spread the bases around the content square edge
    const edgeAngle = (i / count) * Math.PI * 2 + rand() * 0.8
    const x = center + Math.cos(edgeAngle) * half * 1.15
    const y = center + Math.sin(edgeAngle) * half * 1.15
    const inward = edgeAngle + Math.PI + (rand() - 0.5) * 0.9
    const leaves: Leaf[] = []
    const leafCount = 10 + Math.floor(rand() * 8)
    for (let j = 0; j < leafCount; j++) {
      leaves.push({
        at: 0.1 + (j / leafCount) * 0.9 + rand() * 0.05,
        side: j % 2 === 0 ? 1 : -1,
        length: size * (0.07 + rand() * 0.05),
        width: size * (0.022 + rand() * 0.016),
        angle: 0.4 + rand() * 0.7,
        phase: rand() * Math.PI * 2,
      })
    }
    branches.push({
      x,
      y,
      angle: inward,
      length: half * (0.6 + rand() * 0.5),
      bend: (rand() - 0.5) * 0.6,
      thickness: size * (0.004 + rand() * 0.004),
      phase: rand() * Math.PI * 2,
      // integer cycles per duration so the video loops
      speed: 1 + Math.floor(rand() * 3),
      leaves,
    })
  }
  return branches
}

function drawLightShape(ctx: CanvasRenderingContext2D, preset: LightPreset) {
  const size = COOKIE_SIZE
  const c = size / 2
  const full = size * COOKIE_CONTENT
  ctx.fillStyle = '#fff'
  if (preset === 'none') {
    const g = ctx.createRadialGradient(c, c, 0, c, c, full / 2)
    g.addColorStop(0, '#fff')
    g.addColorStop(0.7, '#fff')
    g.addColorStop(1, '#000')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    return
  }
  if (preset === 'beam') {
    ctx.fillRect(c - full * 0.14, c - full / 2, full * 0.28, full)
    return
  }
  if (preset === 'church') {
    // tall round-arched window: two lancets under a round oculus, lead bars between
    const w = full * 0.52
    const r = w / 2
    const top = c - full / 2 + r
    const bottom = c + full / 2
    ctx.beginPath()
    ctx.arc(c, top, r, Math.PI, 0)
    ctx.lineTo(c + r, bottom)
    ctx.lineTo(c - r, bottom)
    ctx.closePath()
    ctx.fill()
    const bar = full * 0.022
    ctx.fillStyle = '#000'
    ctx.fillRect(c - bar / 2, top + r * 0.55, bar, bottom - top)
    ctx.fillRect(c - r, top + r * 0.55, w, bar)
    ctx.fillRect(c - r, c + full * 0.12, w, bar * 0.7)
    ctx.lineWidth = bar
    ctx.strokeStyle = '#000'
    ctx.beginPath()
    ctx.arc(c, top, r * 0.4, 0, Math.PI * 2)
    ctx.stroke()
    return
  }
  // window: tall frame with panes, blinds: same frame with slats
  const w = full * 0.8
  const h = full
  const x0 = c - w / 2
  const y0 = c - h / 2
  ctx.fillRect(x0, y0, w, h)
  ctx.fillStyle = '#000'
  if (preset === 'window') {
    const bar = full * 0.028
    ctx.fillRect(c - bar / 2, y0, bar, h)
    for (const f of [1 / 3, 2 / 3]) {
      ctx.fillRect(x0, y0 + h * f - bar / 2, w, bar)
    }
    return
  }
  const slats = 11
  const pitch = h / slats
  for (let i = 0; i < slats; i++) {
    ctx.fillRect(x0, y0 + i * pitch + pitch * 0.55, w, pitch * 0.45)
  }
}

/** Birds crossing the window left to right. Integer laps per loop keep videos seamless. */
function drawBirds(ctx: CanvasRenderingContext2D, { phase, seed }: { phase: number; seed: number }) {
  const rand = mulberry32(seed)
  const size = COOKIE_SIZE
  const full = size * COOKIE_CONTENT
  const progress = phase / (Math.PI * 2)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const count = 4
  for (let i = 0; i < count; i++) {
    const start = rand()
    const laps = 1 + Math.floor(rand() * 2)
    const baseY = size / 2 - full * 0.35 + rand() * full * 0.6
    const span = full * (0.09 + rand() * 0.06)
    const flaps = 10 + Math.floor(rand() * 8)
    const flapPhase = rand() * Math.PI * 2
    // fly from just outside the left edge to just outside the right edge
    const t = (start + progress * laps) % 1
    const x = size / 2 - full * 0.65 + t * full * 1.3
    const y = baseY - t * full * 0.12 + Math.sin(phase * 2 + i) * full * 0.015
    const flap = Math.sin(phase * flaps + flapPhase)
    const tipY = -flap * span * 0.35
    ctx.lineWidth = span * 0.11
    ctx.beginPath()
    ctx.moveTo(x - span / 2, y + tipY)
    ctx.quadraticCurveTo(x - span * 0.22, y - span * 0.18 + tipY * 0.3, x, y)
    ctx.quadraticCurveTo(x + span * 0.22, y - span * 0.18 + tipY * 0.3, x + span / 2, y + tipY)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(x, y + span * 0.02, span * 0.09, span * 0.05, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawShadowShape(
  ctx: CanvasRenderingContext2D,
  { preset, branches, phase, sway, seed }: { preset: ShadowPreset; branches: Branch[]; phase: number; sway: number; seed: number },
) {
  const size = COOKIE_SIZE
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  if (preset === 'birds') {
    drawBirds(ctx, { phase, seed })
    return
  }
  if (preset === 'bars') {
    const full = size * COOKIE_CONTENT
    const offset = Math.sin(phase) * full * 0.01 * sway
    for (let i = 1; i < 5; i++) {
      const x = size / 2 - full / 2 + (full * i) / 5 + offset
      ctx.fillRect(x - full * 0.012, 0, full * 0.024, size)
    }
    return
  }
  if (preset !== 'leaves') return
  const swayRad = (sway * Math.PI) / 180
  for (const b of branches) {
    const angle = b.angle + swayRad * Math.sin(phase * b.speed + b.phase)
    // quadratic curve from the base, bent sideways
    const ex = b.x + Math.cos(angle) * b.length
    const ey = b.y + Math.sin(angle) * b.length
    const mx = (b.x + ex) / 2 + Math.cos(angle + Math.PI / 2) * b.length * b.bend
    const my = (b.y + ey) / 2 + Math.sin(angle + Math.PI / 2) * b.length * b.bend
    ctx.lineWidth = b.thickness
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.quadraticCurveTo(mx, my, ex, ey)
    ctx.stroke()
    for (const leaf of b.leaves) {
      const t = leaf.at
      const px = (1 - t) * (1 - t) * b.x + 2 * (1 - t) * t * mx + t * t * ex
      const py = (1 - t) * (1 - t) * b.y + 2 * (1 - t) * t * my + t * t * ey
      // tangent of the curve
      const tx = 2 * (1 - t) * (mx - b.x) + 2 * t * (ex - mx)
      const ty = 2 * (1 - t) * (my - b.y) + 2 * t * (ey - my)
      const flutter = swayRad * 2 * Math.sin(phase * (b.speed + 1) + leaf.phase)
      const a = Math.atan2(ty, tx) + leaf.side * leaf.angle + flutter
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(a)
      ctx.beginPath()
      // leaf: pointed ellipse from the stem outward
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(leaf.length * 0.5, -leaf.width, leaf.length, 0)
      ctx.quadraticCurveTo(leaf.length * 0.5, leaf.width, 0, 0)
      ctx.fill()
      ctx.restore()
    }
  }
}

function canvas2d(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[light-cookie] 2D canvas unavailable')
  return { canvas, ctx }
}

/** Images and videos work everywhere an image does. Videos are seeked, never played. */
export type Media = HTMLImageElement | HTMLVideoElement

export function mediaSize(media: Media) {
  if (media instanceof HTMLVideoElement) return { width: media.videoWidth, height: media.videoHeight }
  return { width: media.naturalWidth, height: media.naturalHeight }
}

/** Show the video frame at `time` seconds, looping. Images return right away. */
export async function seekMedia({ media, time }: { media: Media; time: number }) {
  if (!(media instanceof HTMLVideoElement)) return
  const target = media.duration > 0 ? time % media.duration : 0
  if (Math.abs(media.currentTime - target) < 1e-4 && media.readyState >= 2) return
  const seeked = new Promise((resolve) => media.addEventListener('seeked', resolve, { once: true }))
  media.currentTime = target
  await seeked
}

/** Draw media cover-fit into the cookie content square, around the current transform. */
function drawMedia({ ctx, media }: { ctx: CanvasRenderingContext2D; media: Media }) {
  const full = COOKIE_SIZE * COOKIE_CONTENT
  const { width, height } = mediaSize(media)
  const scale = Math.max(full / width, full / height)
  const c = COOKIE_SIZE / 2
  ctx.drawImage(media, c - (width * scale) / 2, c - (height * scale) / 2, width * scale, height * scale)
}

/**
 * Light pass for shadow media: grayscale, then soft levels around the threshold, so a photo
 * becomes a silhouette (dark = shadow). brightness() moves the threshold to 0.5, where
 * contrast() pivots.
 */
function lightPassFilter(p: LightCookieParams) {
  const parts = ['grayscale(1)']
  if (p.shadowInvert) parts.push('invert(1)')
  if (p.shadowThreshold > 0) parts.push(`brightness(${0.5 / p.shadowThreshold})`, 'contrast(4)')
  return parts.join(' ')
}

function createCookie({ lightMedia, shadowMedia }: { lightMedia?: Media; shadowMedia?: Media }) {
  const out = canvas2d(COOKIE_SIZE)
  const light = canvas2d(COOKIE_SIZE)
  const mask = canvas2d(COOKIE_SIZE)
  const shadow = canvas2d(COOKIE_SIZE)
  const texture = new THREE.CanvasTexture(out.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  let branches: Branch[] = []
  let branchSeed = NaN

  const draw = ({ p, phase }: { p: LightCookieParams; phase: number }) => {
    if (p.seed !== branchSeed) {
      branches = createBranches(p.seed)
      branchSeed = p.seed
    }
    const size = COOKIE_SIZE
    const c = size / 2

    light.ctx.fillStyle = '#000'
    light.ctx.fillRect(0, 0, size, size)
    if (lightMedia) {
      const full = size * COOKIE_CONTENT
      light.ctx.save()
      light.ctx.beginPath()
      light.ctx.rect(c - full / 2, c - full / 2, full, full)
      light.ctx.clip()
      drawMedia({ ctx: light.ctx, media: lightMedia })
      light.ctx.restore()
    } else {
      drawLightShape(light.ctx, p.lightCookie)
    }

    // mask: white is lit, black casts shadow. Placement applies to every shadow
    mask.ctx.filter = 'none'
    mask.ctx.fillStyle = '#fff'
    mask.ctx.fillRect(0, 0, size, size)
    mask.ctx.save()
    const full = size * COOKIE_CONTENT
    mask.ctx.translate(c + p.shadowX * full, c - p.shadowY * full)
    if (shadowMedia) mask.ctx.rotate(((p.sway * Math.PI) / 180) * 0.3 * Math.sin(phase))
    mask.ctx.scale(p.shadowScale, p.shadowScale)
    mask.ctx.translate(-c, -c)
    if (shadowMedia) {
      mask.ctx.filter = lightPassFilter(p)
      drawMedia({ ctx: mask.ctx, media: shadowMedia })
    } else {
      drawShadowShape(mask.ctx, { preset: p.shadowCookie, branches, phase, sway: p.sway, seed: p.seed })
    }
    mask.ctx.restore()

    // shadow layer: white, darkened by the blurred mask at shadowOpacity
    shadow.ctx.filter = 'none'
    shadow.ctx.globalAlpha = 1
    shadow.ctx.globalCompositeOperation = 'source-over'
    shadow.ctx.fillStyle = '#fff'
    shadow.ctx.fillRect(0, 0, size, size)
    shadow.ctx.filter = `blur(${p.shadowSoftness * size}px)`
    shadow.ctx.globalAlpha = p.shadowOpacity
    shadow.ctx.globalCompositeOperation = 'multiply'
    shadow.ctx.drawImage(mask.canvas, 0, 0)

    out.ctx.globalCompositeOperation = 'source-over'
    out.ctx.filter = 'none'
    out.ctx.fillStyle = '#000'
    out.ctx.fillRect(0, 0, size, size)
    out.ctx.filter = `blur(${p.softness * size}px)`
    out.ctx.drawImage(light.canvas, 0, 0)
    out.ctx.filter = 'none'
    out.ctx.globalCompositeOperation = 'multiply'
    out.ctx.drawImage(shadow.canvas, 0, 0)
    texture.needsUpdate = true
  }

  return { texture, draw, canvas: out.canvas }
}

// ---------------------------------------------------------------------------
// Finish pass: chromatic aberration, grade, vignette, grain (display space)
// ---------------------------------------------------------------------------

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSeed: { value: 0 },
    uGrain: { value: 0 },
    uGrainSize: { value: 1 },
    uVignette: { value: 0 },
    uCa: { value: 0 },
    uWarmth: { value: 0 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uLift: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uSeed;
    uniform float uGrain;
    uniform float uGrainSize;
    uniform float uVignette;
    uniform float uCa;
    uniform float uWarmth;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uLift;
    varying vec2 vUv;

    float hash(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    void main() {
      vec2 d = vUv - 0.5;
      float aspect = uResolution.x / uResolution.y;
      float r = length(d * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);

      // lens CA: red out, blue in, growing toward the corners
      vec2 off = d * uCa * 0.006 * r * r;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      // warm highlights, slightly cooler-neutral shadows
      vec3 warm = vec3(1.0 + 0.08 * uWarmth, 1.0, 1.0 - 0.12 * uWarmth);
      col *= mix(vec3(1.0), warm, smoothstep(0.0, 0.8, luma));
      col = col * (1.0 - uLift) + uLift * vec3(1.0, 0.92, 0.85);

      // vignette: natural cos^4-like falloff
      col *= mix(1.0, smoothstep(1.25, 0.25, r), uVignette);

      // film grain: two hashes ~ triangular noise, strongest in the mids and shadows
      vec2 cell = floor(gl_FragCoord.xy / uGrainSize);
      float n = hash(vec3(cell, uSeed)) + hash(vec3(cell + 19.19, uSeed + 7.0)) - 1.0;
      float l = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
      float weight = 0.5 + 0.5 * (1.0 - l * l);
      col += n * uGrain * weight;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface LightCookieSceneOptions {
  canvas: HTMLCanvasElement
  /** The image or video to light. */
  media: Media
  /** Custom light cookie: white lets light through. */
  lightCookie?: Media
  /** Custom shadow cookie, filtered by a light pass into a silhouette: dark casts shadow. */
  shadowCookie?: Media
  /** Frame size in css px. */
  width: number
  height: number
  /** Device pixel ratio of the output. */
  scale: number
  params?: Partial<LightCookieParams>
}

export interface LightCookieScene {
  /** Render one frame at `time` seconds of a `duration` seconds loop. */
  render(options: { time: number; duration: number; frame?: number }): Promise<void>
  /** The cookie texture of the last rendered frame, white is light. */
  cookieCanvas: HTMLCanvasElement
  dispose(): void
}

const deg = (v: number) => (v * Math.PI) / 180

export function createLightCookieScene({
  canvas,
  media,
  lightCookie,
  shadowCookie,
  width,
  height,
  scale,
  params,
}: LightCookieSceneOptions): LightCookieScene {
  const p: LightCookieParams = { ...LIGHT_COOKIE_DEFAULTS, ...params }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(scale)
  renderer.setSize(width, height, false)
  renderer.shadowMap.enabled = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = p.exposure
  renderer.setClearColor(p.backgroundColor)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(p.backgroundColor)

  const distance = height / 2 / Math.tan(deg(p.fov) / 2)
  const camera = new THREE.PerspectiveCamera(p.fov, width / height, distance * 0.05, distance * 20)

  // image plane, cover-fit to the frame times zoom
  const map = new THREE.Texture(media)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = renderer.capabilities.getMaxAnisotropy()
  map.needsUpdate = true
  const { width: mediaWidth, height: mediaHeight } = mediaSize(media)
  const imageAspect = mediaWidth / mediaHeight
  const cover = Math.max(width / imageAspect, height) * p.zoom
  const planeW = cover * imageAspect
  const planeH = cover
  const material = new THREE.MeshStandardMaterial({
    map,
    bumpMap: map,
    bumpScale: p.relief,
    roughness: 1 - p.gloss * 0.6,
    metalness: 0,
  })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), material)
  plane.receiveShadow = true
  plane.matrixAutoUpdate = false
  scene.add(plane)
  const shear = new THREE.Matrix4().makeShear(Math.tan(deg(p.skewX)), 0, Math.tan(deg(p.skewY)), 0, 0, 0)

  const cookie = createCookie({ lightMedia: lightCookie, shadowMedia: shadowCookie })

  // key light: far away so the projection is almost parallel, like sun through a window
  const lightDistance = 2.5 * Math.max(width, height)
  const spot = new THREE.SpotLight(p.lightColor, p.lightIntensity, 0, 0, 0, 0)
  const halfAngle = Math.atan((p.lightSize * Math.max(width, height)) / (2 * COOKIE_CONTENT * lightDistance))
  spot.angle = halfAngle
  spot.map = cookie.texture
  // spot.map is projected through the shadow camera, so shadows must be on
  spot.castShadow = true
  spot.shadow.mapSize.set(512, 512)
  spot.shadow.camera.near = lightDistance * 0.1
  spot.shadow.camera.far = lightDistance * 4
  scene.add(spot, spot.target)

  // spill: the same window, unshaped and soft, so the patch glows into the room
  const spill = new THREE.SpotLight(p.lightColor, p.lightIntensity * p.spill, 0, halfAngle * 2.2, 1, 0)
  scene.add(spill, spill.target)

  const ambient = new THREE.AmbientLight(p.ambientColor, p.ambient)
  scene.add(ambient)

  const composer = new EffectComposer(renderer)
  composer.setPixelRatio(scale)
  composer.setSize(width, height)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), p.bloom, 0.6, 0.85)
  if (p.bloom > 0) composer.addPass(bloom)
  composer.addPass(new OutputPass())
  const finish = new ShaderPass(FinishShader)
  finish.uniforms.uResolution!.value.set(width * scale, height * scale)
  finish.uniforms.uGrain!.value = p.grain
  finish.uniforms.uGrainSize!.value = p.grainSize * scale
  finish.uniforms.uVignette!.value = p.vignette
  finish.uniforms.uCa!.value = p.chromaticAberration
  finish.uniforms.uWarmth!.value = p.warmth
  finish.uniforms.uContrast!.value = p.contrast
  finish.uniforms.uSaturation!.value = p.saturation
  finish.uniforms.uLift!.value = p.lift
  composer.addPass(finish)

  const quat = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const pos = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const el = deg(p.lightElevation)
  const az = deg(p.lightAzimuth)
  const lightDir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el))

  return {
    async render({ time, duration, frame = 0 }) {
      await Promise.all([media, lightCookie, shadowCookie].map((m) => m && seekMedia({ media: m, time })))
      if (media instanceof HTMLVideoElement) map.needsUpdate = true

      const progress = duration > 0 ? time / duration : 0
      const phase = progress * Math.PI * 2
      const ease = progress * progress * (3 - 2 * progress)

      // plane: base transform + slow orbit
      euler.set(
        deg(p.rotateX + p.orbit * 0.5 * Math.sin(phase + 1.3)),
        deg(p.rotateY + p.orbit * Math.sin(phase)),
        deg(p.rotateZ),
      )
      quat.setFromEuler(euler)
      pos.set(p.translateX, p.translateY, 0)
      plane.matrix.compose(pos, quat, one).multiply(shear)
      plane.matrixWorldNeedsUpdate = true

      camera.position.set(0, 0, distance * (1 - p.push * ease))
      camera.lookAt(0, 0, 0)

      // light patch target drifts on a small ellipse; the light moves with it
      const tx = p.lightX * width + p.lightDrift * width * Math.sin(phase)
      const ty = p.lightY * height + p.lightDrift * 0.6 * height * (Math.cos(phase) - 1)
      spot.target.position.set(tx, ty, 0)
      spot.position.set(tx, ty, 0).addScaledVector(lightDir, lightDistance)
      spill.target.position.copy(spot.target.position)
      spill.position.copy(spot.position)
      const breathe = 1 + p.flicker * Math.sin(phase * 3 + 0.7) * Math.sin(phase * 5)
      spot.intensity = p.lightIntensity * breathe
      spill.intensity = p.lightIntensity * p.spill * breathe

      cookie.draw({ p, phase })
      finish.uniforms.uSeed!.value = (frame % 997) + 1
      composer.render()
    },
    cookieCanvas: cookie.canvas,
    dispose() {
      composer.dispose()
      map.dispose()
      cookie.texture.dispose()
      material.dispose()
      plane.geometry.dispose()
      renderer.dispose()
    },
  }
}

export function loadMedia({ src, video }: { src: string; video: boolean }): Promise<Media> {
  return new Promise((resolve, reject) => {
    const onError = () => reject(new Error(`[light-cookie] Failed to load ${src}`))
    if (!video) {
      const image = new Image()
      image.addEventListener('load', () => resolve(image), { once: true })
      image.addEventListener('error', onError, { once: true })
      image.src = src
      return
    }
    const element = document.createElement('video')
    element.muted = true
    element.playsInline = true
    element.preload = 'auto'
    element.addEventListener('loadeddata', () => resolve(element), { once: true })
    element.addEventListener('error', onError, { once: true })
    element.src = src
  })
}

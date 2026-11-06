/**
 * Angled screen: a flat image (or DOM snapshot) shown as a 3D-tilted screen
 * with true per-pixel depth of field, rendered by a WebGL2 fragment shader.
 *
 *   screen pixel → ray from CSS-style perspective camera → ray/plane
 *   intersection → plane-local UV → sample the plane texture
 *
 * The intersection distance gives true per-pixel depth, which drives:
 *   - bokeh blur (sparse 6-blade hex iris, radius grows with distance from
 *     focus, so the aperture shape reads as hard disks instead of a gaussian)
 *   - chromatic aberration (radial R/B split, stronger in the bokeh)
 *   - fog toward backgroundColor (like the original Three.js plugin's scene
 *     fog, unframer-private/plugin-angled-screen BokehPass setup)
 *   - film grain (from the plugin's filmGrainShader, time-seeded)
 *
 * Browser only, no framework. egaki's `AngledScreen` feeds it HTML-in-canvas
 * element images; the `angled-screen` CLI feeds it an image via `renderImage`.
 *
 * Coordinate mapping notes (hard-won, don't re-derive):
 *   - GL space is y-up, z toward viewer, camera at (0, 0, perspective).
 *   - CSS rotateX(+)/rotateY(+) match standard GL Rx/Ry; CSS rotateZ is
 *     visually clockwise (y-down), so we negate it for GL.
 *   - UNPACK_FLIP_Y_WEBGL=true puts the source top at v=1, matching y-up
 *     plane UVs.
 */

export interface AngledScreenParams {
  // --- 3D transform (same semantics as a CSS perspective + rotate transform) ---
  /** CSS perspective distance in px. Smaller = more dramatic. Default 1200. */
  perspective: number
  /** X-axis rotation in degrees (tilts top/bottom). Default 8. */
  rotateX: number
  /** Y-axis rotation in degrees (angles left/right). Default -12. */
  rotateY: number
  /** Z-axis rotation in degrees. Default 0. */
  rotateZ: number
  /** Shift the plane horizontally in px. Positive = right. Default 0. */
  translateX: number
  /** Push the plane forward/back in px. Positive = closer/larger. Default 0. */
  translateZ: number

  // --- Depth of field (Three.js BokehShader model, same as the Framer plugin) ---
  /** Enable depth-based bokeh blur. Default true. */
  bokeh: boolean
  /** Aperture. Bigger values for shallower depth of field. With focus 0 (auto)
   *  it is a multiplier relative to 0.5: higher saturates the blur earlier. */
  aperture: number
  /** Max blur in screen-UV units (fraction of frame size), the saturation
   *  cap of the blur. Same as Three's `maxblur`. Default 0.12. */
  maxBlur: number
  /** Focus distance as a fraction of `perspective`. Default 0 = auto: the
   *  near part of the plane stays sharp and blur ramps toward the far edge. */
  focus: number

  // --- Atmosphere (from the original Three.js plugin) ---
  /** Fog toward backgroundColor at the far depth (0-1). Default 0.35. */
  fog: number
  /** Film grain intensity. Default 0.02. */
  grainIntensity: number
  /** Chromatic aberration strength. RGB channels separate along the radial
   *  axis from frame center, scaled up by local blur. 0 = off. Default 0.45. */
  chromaticAberration: number

  /** Background color behind the tilted screen, hex. Default '#000000'. */
  backgroundColor: string

  /** Render normalized depth as grayscale for debugging the DOF ramp. */
  debug: boolean
}

export const ANGLED_SCREEN_DEFAULTS: AngledScreenParams = {
  perspective: 1200,
  rotateX: 8,
  rotateY: -12,
  rotateZ: 0,
  translateX: 0,
  translateZ: 0,
  bokeh: true,
  aperture: 0.5,
  maxBlur: 0.12,
  focus: 0,
  fog: 0.35,
  grainIntensity: 0.02,
  chromaticAberration: 0.45,
  backgroundColor: '#000000',
  debug: false,
}

// ---------------------------------------------------------------------------
// WebGL helpers (also used by egaki's defineShader renderer)
// ---------------------------------------------------------------------------

/** Fullscreen quad vertex shader: a_position (clip space) + a_texCoord → v_uv. */
export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_uv;
void main() {
  v_uv = a_texCoord;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

/** Parse a hex color string (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) to [r, g, b, a] in 0-1 range. */
export function parseHexColor(hex: string): [number, number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return [r, g, b, a]
}

export function compileGlShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile error:\n${log}`)
  }
  return shader
}

export function linkGlProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('Failed to create program')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link error:\n${log}`)
  }
  return program
}

// ---------------------------------------------------------------------------
// Angled screen shader
// ---------------------------------------------------------------------------

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_tex;
uniform mat3 u_rot;          // plane local -> world rotation
uniform vec2 u_frameSize;    // logical output frame px
uniform vec2 u_planeSize;    // logical plane px, centered in the frame
uniform float u_perspective; // camera z in px
uniform float u_translateX;  // plane center x in px
uniform float u_translateZ;  // plane center z in px
uniform float u_depthMin;    // nearest corner distance to camera
uniform float u_depthMax;    // farthest corner distance to camera
uniform float u_bokehEnabled;
uniform float u_aperture;   // Three BokehShader aperture (plugin: 0.5)
uniform float u_maxblur;    // Three BokehShader maxblur, screen-UV units (plugin: 0.12)
uniform float u_focusDist;  // focus distance in px along the ray
uniform float u_aspect;     // width / height, for circular bokeh
uniform float u_fog;
uniform float u_grain;
uniform float u_ca;         // chromatic aberration strength
uniform vec4 u_background;
uniform float u_debug;
uniform float u_time;

in vec2 v_uv;
out vec4 fragColor;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

// Sparse 6-blade hexagonal iris. Far fewer taps than the 41-sample Martins
// Upitis kernel so the aperture SHAPE reads as discrete hex disks instead of
// smoothing into a gaussian. Outer ring is weighted heavier so bright points
// form hard-edged bokeh blobs (the look of real lens DOF on the refs).
// Unit circle coords at radius 1.0 / 0.55.
const vec2 HEX_OUTER[6] = vec2[](
  vec2( 1.0000,  0.0000),
  vec2( 0.5000,  0.8660),
  vec2(-0.5000,  0.8660),
  vec2(-1.0000,  0.0000),
  vec2(-0.5000, -0.8660),
  vec2( 0.5000, -0.8660)
);
const vec2 HEX_MID[6] = vec2[](
  vec2( 0.5500,  0.0000),
  vec2( 0.2750,  0.4763),
  vec2(-0.2750,  0.4763),
  vec2(-0.5500,  0.0000),
  vec2(-0.2750, -0.4763),
  vec2( 0.2750, -0.4763)
);

// Intersect the camera ray through screen uv suv with the tilted plane.
// Returns ray distance t, or -1.0 on miss. Outputs plane uv + edge coverage.
float intersectPlane(vec2 suv, out vec2 uv, out float coverage) {
  vec2 screen = (suv - 0.5) * u_frameSize;
  vec3 C = vec3(0.0, 0.0, u_perspective);
  vec3 dir = normalize(vec3(screen, 0.0) - C);
  vec3 n = u_rot * vec3(0.0, 0.0, 1.0);
  vec3 q0 = vec3(u_translateX, 0.0, u_translateZ);
  float denom = dot(n, dir);
  if (abs(denom) < 1e-6) return -1.0;
  float t = dot(n, q0 - C) / denom;
  if (t <= 0.0) return -1.0;
  vec3 local = transpose(u_rot) * (C + t * dir - q0);
  uv = local.xy / u_planeSize + 0.5;
  vec2 edgePx = (0.5 - abs(uv - 0.5)) * u_planeSize;
  coverage = clamp(min(edgePx.x, edgePx.y) + 0.5, 0.0, 1.0);
  return t;
}

// Full scene color at a screen position: plane composited over background.
// Screen-space sampling like Three's BokehPass (which blurs the rendered
// frame), so blur also softens the plane edges into the background.
vec4 sampleScene(vec2 suv) {
  vec2 uv;
  float coverage;
  float t = intersectPlane(suv, uv, coverage);
  if (t < 0.0 || coverage <= 0.0) return u_background;
  vec4 c = texture(u_tex, uv);
  c = vec4(mix(u_background.rgb, c.rgb, c.a), 1.0);
  return mix(u_background, c, coverage);
}

// Per-channel sample with chromatic aberration: R and B pull apart along
// the radial axis from frame center (classic lens CA purple/cyan fringing).
vec4 sampleSceneCA(vec2 suv, vec2 caOffset) {
  float r = sampleScene(suv + caOffset).r;
  float g = sampleScene(suv).g;
  float b = sampleScene(suv - caOffset).b;
  // Coverage/alpha from the green (unshifted) sample keeps silhouette stable.
  vec4 mid = sampleScene(suv);
  return vec4(r, g, b, mid.a);
}

void main() {
  vec4 bg = u_background;

  vec2 uv;
  float coverage;
  float t = intersectPlane(v_uv, uv, coverage);
  bool hit = t > 0.0 && coverage > 0.0;

  // Normalized depth across the visible plane (0 = near, 1 = far), used
  // for fog and the debug view.
  float depth01 = hit
    ? clamp((t - u_depthMin) / max(u_depthMax - u_depthMin, 1e-3), 0.0, 1.0)
    : 1.0;

  if (u_debug > 0.5) {
    fragColor = hit ? mix(bg, vec4(vec3(depth01), 1.0), coverage) : bg;
    return;
  }

  // Three.js BokehShader blur factor, made one-sided: only content BEYOND
  // the focus plane blurs (the far side of the tilted screen). The near side
  // stays tack sharp. Background pixels (no hit) count as far away, so the
  // plane silhouette melts softly where it is out of focus.
  float factor = hit ? max(t - u_focusDist, 0.0) / u_perspective : 1.0;
  float blurAmt = clamp(factor * u_aperture, 0.0, u_maxblur) * u_bokehEnabled;
  vec2 dofblur = vec2(blurAmt);

  vec2 aspectcorrect = vec2(1.0, u_aspect);

  // Radial CA direction from frame center. Strength grows with local blur so
  // sharp regions stay clean and only the bokeh fringes with purple/cyan.
  vec2 fromCenter = v_uv - 0.5;
  float radial = length(fromCenter);
  vec2 caDir = radial > 1e-5 ? fromCenter / radial : vec2(1.0, 0.0);
  // Base fringe + blur-scaled fringe. u_ca ~0.45 reads like a real lens on
  // the reference photos without turning the whole frame into a prism.
  float caAmt = u_ca * (0.0015 + blurAmt * 0.55);
  vec2 caOffset = caDir * caAmt * aspectcorrect;

  // Sparse hex gather. Outer ring weight 2.0 so the 6-blade iris is visible
  // as hard bokeh disks; mid ring 1.0 fills the disk; center 1.0 anchors.
  // Total weight = 6*2 + 6*1 + 1 = 19.
  const float W_OUTER = 2.0;
  const float W_MID = 1.0;
  const float W_CENTER = 1.0;
  vec4 col = sampleSceneCA(v_uv, caOffset) * W_CENTER;
  for (int i = 0; i < 6; i++) {
    col += sampleSceneCA(v_uv + HEX_OUTER[i] * aspectcorrect * dofblur, caOffset) * W_OUTER;
  }
  for (int i = 0; i < 6; i++) {
    col += sampleSceneCA(v_uv + HEX_MID[i] * aspectcorrect * dofblur, caOffset) * W_MID;
  }
  col /= (6.0 * W_OUTER + 6.0 * W_MID + W_CENTER);

  // Mild highlight bias: bright samples punch through more (classic optical
  // bokeh where speculars form bright disks instead of averaging down).
  // Applied as a soft lift so it doesn't blow whites on already-bright UI.
  float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  col.rgb += col.rgb * blurAmt * 1.8 * smoothstep(0.55, 0.95, luma);

  // Fog toward background with depth (plugin's THREE.Fog equivalent)
  col.rgb = mix(col.rgb, bg.rgb, u_fog * depth01 * (hit ? 1.0 : 0.0));

  // Film grain (plugin's filmGrainShader)
  col.rgb += (rand(v_uv + fract(u_time)) - 0.5) * u_grain;
  col.a = 1.0;

  fragColor = col;
}
`

const UNIFORM_NAMES = [
  'u_tex',
  'u_rot',
  'u_frameSize',
  'u_planeSize',
  'u_perspective',
  'u_translateX',
  'u_translateZ',
  'u_depthMin',
  'u_depthMax',
  'u_bokehEnabled',
  'u_aperture',
  'u_maxblur',
  'u_focusDist',
  'u_aspect',
  'u_fog',
  'u_grain',
  'u_ca',
  'u_background',
  'u_debug',
  'u_time',
] as const

/**
 * Build the CSS-order rotation matrix M = Rx * Ry * Rz(-z) in GL coords
 * (y up, z toward viewer). Returns row-major 3x3 as number[][].
 */
function rotationMatrix(rxDeg: number, ryDeg: number, rzDeg: number): number[][] {
  const rx = (rxDeg * Math.PI) / 180
  const ry = (ryDeg * Math.PI) / 180
  const rz = (-rzDeg * Math.PI) / 180
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const Rx = [
    [1, 0, 0],
    [0, cx, -sx],
    [0, sx, cx],
  ]
  const Ry = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy],
  ]
  const Rz = [
    [cz, -sz, 0],
    [sz, cz, 0],
    [0, 0, 1],
  ]
  const mul = (a: number[][], b: number[][]) =>
    a.map((row, i) => row.map((_, j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!))
  return mul(mul(Rx, Ry), Rz)
}

/** Chromium HTML-in-canvas upload (behind chrome://flags/#canvas-draw-element). */
type HtmlInCanvasGl = WebGL2RenderingContext & {
  texElementImage2D: (...args: unknown[]) => void
}

export interface AngledScreenDrawOptions {
  /** Logical frame width in px. */
  width: number
  /** Logical frame height in px. */
  height: number
  /** Logical width of the textured plane in px, centered in the frame. Default `width`. */
  planeWidth?: number
  /** Logical height of the textured plane in px. Default `height`. */
  planeHeight?: number
  /** Seconds, seeds the film grain. Default 0. */
  time?: number
  params?: Partial<AngledScreenParams>
}

export interface AngledScreenRenderer {
  /** Upload the plane texture from an image, canvas or video frame. */
  uploadImage(source: TexImageSource): void
  /** Upload the plane texture from an HTML-in-canvas element image. */
  uploadElementImage(elementImage: unknown): void
  /** Draw one frame into the canvas drawing buffer. */
  draw(options: AngledScreenDrawOptions): void
  dispose(): void
}

/**
 * Create the WebGL2 angled screen renderer on a canvas. The texture you
 * upload is the flat plane before tilting (frame size unless you pass
 * planeWidth/planeHeight): put the content where it should sit on the plane
 * and leave the rest transparent.
 */
export function createAngledScreenRenderer({
  canvas,
}: {
  canvas: HTMLCanvasElement | OffscreenCanvas
}): AngledScreenRenderer {
  const gl = (canvas as HTMLCanvasElement).getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    // Callers read the buffer after the draw call (mirror blit, convertToBlob),
    // so it must not be cleared on composite.
    preserveDrawingBuffer: true,
  })
  if (!gl) {
    throw new Error('[angled-screen] WebGL2 unavailable')
  }

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

  const vs = compileGlShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX_SHADER)
  const fs = compileGlShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = linkGlProgram(gl, vs, fs)
  gl.deleteShader(vs)
  gl.deleteShader(fs)

  const texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  // Fullscreen quad: interleaved position + uv, 6 vertices
  const buffer = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  // prettier-ignore
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0,   1, -1, 1, 0,   -1, 1, 0, 1,
    -1,  1, 0, 1,   1, -1, 1, 0,    1, 1, 1, 1,
  ]), gl.STATIC_DRAW)

  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  const posLoc = gl.getAttribLocation(program, 'a_position')
  const uvLoc = gl.getAttribLocation(program, 'a_texCoord')
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(uvLoc)
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8)

  const locs: Record<string, WebGLUniformLocation | null> = {}
  for (const name of UNIFORM_NAMES) {
    locs[name] = gl.getUniformLocation(program, name)
  }

  gl.useProgram(program)
  gl.bindVertexArray(vao)

  const bindTexture = () => {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
  }

  return {
    uploadImage(source) {
      // WebGL ignores UNPACK_FLIP_Y_WEBGL for ImageBitmap, so draw it on a canvas first
      if (source instanceof ImageBitmap) {
        const bitmapCanvas = new OffscreenCanvas(source.width, source.height)
        bitmapCanvas.getContext('2d')!.drawImage(source, 0, 0)
        source = bitmapCanvas
      }
      bindTexture()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    },

    uploadElementImage(elementImage) {
      bindTexture()
      const htmlGl = gl as HtmlInCanvasGl
      // The HTML-in-canvas API changed shape between Chromium builds:
      //   Chrome 149-151: texElementImage2D(target, level, internalformat, format, type, element)
      //   Chrome 152+:    texElementImage2D(target, internalformat, element)
      //     where internalformat must be sized (RGBA8, SRGB8_ALPHA8, RGBA16F, RGBA32F)
      // Detect via Function.length (3 = new signature).
      if (htmlGl.texElementImage2D.length <= 3) {
        htmlGl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, elementImage)
      } else {
        htmlGl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, elementImage)
      }
    },

    draw({ width, height, planeWidth = width, planeHeight = height, time = 0, params }) {
      const p = { ...ANGLED_SCREEN_DEFAULTS, ...params }
      const { perspective, translateX, translateZ, focus, aperture, maxBlur } = p

      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      bindTexture()

      // CPU-side scene setup: rotation matrix + VISIBLE depth statistics.
      // Depth is sampled on a 7x7 grid of rays across the screen and
      // summarized with percentiles. Percentiles are area-weighted, which
      // matters: rays toward the plane's vanishing direction produce huge t
      // values, and using the raw corner min/max would compress the blur
      // ramp so much that most of the image reads sharp. Quantiles keep the
      // ramp perceptually spread across the screen.
      const M = rotationMatrix(p.rotateX, p.rotateY, p.rotateZ)
      const hw = width / 2
      const hh = height / 2
      // Plane normal (third column of M)
      const nx = M[0]![2]!
      const ny = M[1]![2]!
      const nz = M[2]![2]!
      const depths: number[] = []
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 7; gx++) {
          // Ray from camera C=(0,0,perspective) through screen point (sx,sy,0)
          const sx = ((gx / 6) * 2 - 1) * hw
          const sy = ((gy / 6) * 2 - 1) * hh
          const len = Math.hypot(sx, sy, perspective)
          const denom = (nx * sx + ny * sy - nz * perspective) / len
          if (Math.abs(denom) < 1e-6) continue
          // t = dot(n, q0 - C) / dot(n, dir), q0 = (translateX,0,translateZ)
          const t = (nx * translateX + nz * (translateZ - perspective)) / denom
          if (t > 0 && Number.isFinite(t)) depths.push(t)
        }
      }
      depths.sort((a, b) => a - b)
      const quantile = (q: number) =>
        depths[Math.min(depths.length - 1, Math.round(q * (depths.length - 1)))] ?? perspective
      const depthMin = depths.length > 0 ? depths[0]! : perspective
      const depthMax = depths.length > 0 ? quantile(0.95) : perspective + 1

      // focus=0 (auto): the focus plane sits at the 40th depth percentile,
      // so roughly the near half of the image reads sharp and blur ramps
      // progressively from there toward the far edge. The effective aperture
      // is auto-scaled so blur reaches maxBlur at the 95th percentile
      // regardless of scene scale (aperture acts as a multiplier relative to
      // its 0.5 default: higher = saturates earlier).
      const focusDist = focus > 0 ? focus * perspective : quantile(0.4)
      const apertureEff =
        focus > 0 ? aperture : (aperture / 0.5) * ((maxBlur * perspective) / Math.max(depthMax - focusDist, 1))

      gl.uniform1i(locs.u_tex!, 0)
      // GLSL mat3 is column-major; M is row-major → transpose on flatten
      // prettier-ignore
      gl.uniformMatrix3fv(locs.u_rot!, false, [
        M[0]![0]!, M[1]![0]!, M[2]![0]!,
        M[0]![1]!, M[1]![1]!, M[2]![1]!,
        M[0]![2]!, M[1]![2]!, M[2]![2]!,
      ])
      gl.uniform2f(locs.u_frameSize!, width, height)
      gl.uniform2f(locs.u_planeSize!, planeWidth, planeHeight)
      gl.uniform1f(locs.u_perspective!, perspective)
      gl.uniform1f(locs.u_translateX!, translateX)
      gl.uniform1f(locs.u_translateZ!, translateZ)
      gl.uniform1f(locs.u_depthMin!, depthMin)
      gl.uniform1f(locs.u_depthMax!, depthMax)
      gl.uniform1f(locs.u_bokehEnabled!, p.bokeh ? 1 : 0)
      gl.uniform1f(locs.u_aperture!, apertureEff)
      gl.uniform1f(locs.u_maxblur!, maxBlur)
      gl.uniform1f(locs.u_focusDist!, focusDist)
      gl.uniform1f(locs.u_aspect!, width / height)
      gl.uniform1f(locs.u_fog!, p.fog)
      gl.uniform1f(locs.u_grain!, p.grainIntensity)
      gl.uniform1f(locs.u_ca!, p.chromaticAberration)
      gl.uniform4fv(locs.u_background!, parseHexColor(p.backgroundColor))
      gl.uniform1f(locs.u_debug!, p.debug ? 1 : 0)
      gl.uniform1f(locs.u_time!, time)

      gl.drawArrays(gl.TRIANGLES, 0, 6)
    },

    dispose() {
      gl.deleteProgram(program)
      gl.deleteTexture(texture)
      gl.deleteVertexArray(vao)
      gl.deleteBuffer(buffer)
    },
  }
}

// ---------------------------------------------------------------------------
// Image → angled screen image
// ---------------------------------------------------------------------------

export interface RenderImageOptions {
  /** One or more screens, laid out left to right on the same tilted plane. */
  images: Array<ImageBitmap | HTMLImageElement>
  /** Output frame width in css px. Default 1920. */
  width?: number
  /** Output frame height in css px. Default 1080. */
  height?: number
  /** Device pixel ratio of the output. Default 2. */
  scale?: number
  /** Width of the screens row as a fraction of the frame width. Heights follow the image aspects.
   *  Above 1 the plane grows past the frame, useful with several screens and a far camera. Default 0.8. */
  contentWidth?: number
  /** Space between screens in css px. Default 48. */
  gap?: number
  /** Screen corner radius in css px. Default 12. */
  radius?: number
  /** Seconds, seeds the film grain. Default 0. */
  time?: number
  params?: Partial<AngledScreenParams>
  /** Output mime type. Default 'image/png'. */
  type?: 'image/png' | 'image/jpeg' | 'image/webp'
  /** Encoder quality for jpeg and webp, 0-1. */
  quality?: number
}

/** Render images as screens on one angled plane and encode the frame. Browser only. */
export async function renderImage({
  images,
  width = 1920,
  height = 1080,
  scale = 2,
  contentWidth = 0.8,
  gap = 48,
  radius = 12,
  time = 0,
  params,
  type = 'image/png',
  quality,
}: RenderImageOptions): Promise<Blob> {
  if (images.length === 0) throw new Error('[angled-screen] renderImage needs at least one image')
  const pixelWidth = Math.round(width * scale)
  const pixelHeight = Math.round(height * scale)

  // Flat screen texture: the images in a centered row on a transparent plane,
  // like the DOM layout egaki captures with HTML-in-canvas. All screens share
  // one height, so the row fills contentWidth exactly. The plane is at least
  // the frame and grows to fit a row wider or taller than it.
  const rowWidth = width * contentWidth
  const aspectSum = images.reduce((sum, image) => sum + image.width / image.height, 0)
  const h = (rowWidth - gap * (images.length - 1)) / aspectSum
  const planeWidth = Math.max(width, rowWidth)
  const planeHeight = Math.max(height, h)
  const plane = new OffscreenCanvas(Math.round(planeWidth * scale), Math.round(planeHeight * scale))
  const ctx = plane.getContext('2d')
  if (!ctx) throw new Error('[angled-screen] 2D canvas unavailable')
  ctx.scale(scale, scale)
  ctx.imageSmoothingQuality = 'high'
  let x = (planeWidth - rowWidth) / 2
  const y = (planeHeight - h) / 2
  for (const image of images) {
    const w = (h * image.width) / image.height
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, radius)
    ctx.clip()
    ctx.drawImage(image, x, y, w, h)
    ctx.restore()
    x += w + gap
  }

  const canvas = new OffscreenCanvas(pixelWidth, pixelHeight)
  const renderer = createAngledScreenRenderer({ canvas })
  try {
    renderer.uploadImage(plane)
    renderer.draw({ width, height, planeWidth, planeHeight, time, params })
    return await canvas.convertToBlob({ type, quality })
  } finally {
    renderer.dispose()
  }
}

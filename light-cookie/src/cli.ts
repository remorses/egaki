#!/usr/bin/env node
// Light an image with window light cookies and moving shadows through the user's Chrome
// (playwriter extension). Serves the three.js renderer on a random localhost port, opens a
// tab, the page renders and POSTs the image (or each video frame, piped into ffmpeg) back.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import url from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { goke } from 'goke'
import { z } from 'zod'
import dedent from 'string-dedent'
import { connectViaExtension } from 'playwriter'
import { LIGHT_COOKIE_DEFAULTS, LIGHT_PRESETS, SHADOW_PRESETS, type LightCookieParams } from './index.ts'

// dist/ holds index.js, the browser renderer the page imports
const MODULE_DIR = path.dirname(url.fileURLToPath(import.meta.url))
// three/build/three.module.js -> package root, served under /three/
const THREE_DIR = path.resolve(path.dirname(url.fileURLToPath(import.meta.resolve('three'))), '..')

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

const VIDEO_CODECS: Record<string, (crf: number) => string[]> = {
  '.mp4': (crf) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
  '.mov': (crf) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
  '.webm': (crf) => ['-c:v', 'libvpx-vp9', '-crf', String(crf + 10), '-b:v', '0', '-pix_fmt', 'yuv420p'],
}

const VIDEO_INPUTS = new Set(['.mp4', '.mov', '.webm', '.m4v'])
const isVideo = (file: string) => VIDEO_INPUTS.has(path.extname(file).toLowerCase())
// used when no input is a video and --duration is not set
const DEFAULT_DURATION = 6
// a silhouette needs crisper edges than leaves to stay recognizable
const MEDIA_SHADOW_SOFTNESS = 0.005

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
}

const PAGE_HTML = dedent`
  <!doctype html>
  <meta charset="utf-8" />
  <script type="importmap">
    { "imports": { "three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" } }
  </script>
  <script type="module">
    import { createLightCookieScene, loadMedia } from '/index.js'
    const post = async (route, blob) => {
      const res = await fetch(route, { method: 'POST', body: blob })
      if (!res.ok) throw new Error('Upload failed: ' + res.status)
    }
    window.renderLightCookie = async (o) => {
      const load = (name) => o.inputs[name] && loadMedia({ src: '/input/' + name, video: o.inputs[name] === 'video' })
      const [media, lightCookie, shadowCookie] = await Promise.all(['media', 'light-cookie', 'shadow-cookie'].map(load))
      // default video length: the longest input video, so it plays once
      const videoDurations = [media, lightCookie, shadowCookie].filter((m) => m instanceof HTMLVideoElement).map((m) => m.duration)
      const duration = o.duration ?? (videoDurations.length > 0 ? Math.max(...videoDurations) : o.defaultDuration)
      const canvas = document.createElement('canvas')
      document.body.append(canvas)
      const scene = createLightCookieScene({
        canvas, media, lightCookie, shadowCookie,
        width: o.width, height: o.height, scale: o.scale, params: o.params,
      })
      const encode = (type, quality, target = canvas) => new Promise((resolve, reject) =>
        target.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), type, quality))
      try {
        if (!o.video) {
          await scene.render({ time: o.time, duration, frame: 0 })
          await post('/output', await encode(o.type, o.quality, o.debugCookie ? scene.cookieCanvas : canvas))
          return
        }
        const frames = Math.max(1, Math.round(duration * o.fps))
        for (let i = 0; i < frames; i++) {
          await scene.render({ time: i / o.fps, duration, frame: i })
          await post('/frame', await encode('image/jpeg', 0.95))
        }
      } finally {
        scene.dispose()
      }
    }
  </script>
`

interface RenderPageOptions {
  width: number
  height: number
  scale: number
  params: Partial<LightCookieParams>
  /** false renders one still image at `time`. */
  video: boolean
  fps: number
  time: number
  /** Unset: the longest input video, else defaultDuration. */
  duration?: number
  defaultDuration: number
  type: string
  quality?: number
  /** Served under /input/<name>. */
  inputs: Record<'media' | 'light-cookie' | 'shadow-cookie', 'image' | 'video' | undefined>
  debugCookie: boolean
}

declare global {
  interface Window {
    renderLightCookie?: (options: RenderPageOptions) => Promise<void>
  }
}

function readStatic(root: string, rel: string): Buffer | undefined {
  const file = path.resolve(root, rel)
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined
  return fs.readFileSync(file)
}

// Routes: / page, /index.js renderer, /three/* three.js, /input/<name> files,
// POST /output still image, POST /frame one video frame.
function startServer({
  inputs,
  onOutput,
  onFrame,
}: {
  inputs: Record<string, string | undefined>
  onOutput: (bytes: Buffer) => void
  onFrame: (bytes: Buffer) => Promise<void>
}) {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', async () => {
        const bytes = Buffer.concat(chunks)
        if (pathname === '/output') onOutput(bytes)
        else if (pathname === '/frame') await onFrame(bytes)
        else res.statusCode = 404
        res.end()
      })
      return
    }
    res.setHeader('cache-control', 'no-store')
    if (pathname === '/') {
      res.setHeader('content-type', MIME['.html']!)
      res.end(PAGE_HTML)
      return
    }
    let body: Buffer | undefined
    if (pathname === '/index.js') body = readStatic(MODULE_DIR, 'index.js')
    else if (pathname.startsWith('/three/')) body = readStatic(THREE_DIR, pathname.slice('/three/'.length))
    else if (pathname.startsWith('/input/')) {
      const file = inputs[pathname.slice('/input/'.length)]
      if (file) body = fs.readFileSync(file)
    }
    if (!body) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    const type = MIME[path.extname(pathname)]
    if (type) res.setHeader('content-type', type)
    res.end(body)
  })
  return new Promise<{ server: http.Server; origin: string }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Server has no port'))
      resolve({ server, origin: `http://127.0.0.1:${address.port}` })
    })
  })
}

function startFfmpeg({ outPath, fps, codec }: { outPath: string; fps: number; codec: string[] }) {
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      ...codec,
      outPath,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  )
  const exited = new Promise<void>((resolve, reject) => {
    ffmpeg.once('error', (error) => reject(new Error(`Could not start ffmpeg. Install it with: brew install ffmpeg\n${error.message}`)))
    ffmpeg.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))))
  })
  return {
    async write(bytes: Buffer) {
      if (!ffmpeg.stdin.write(bytes)) await once(ffmpeg.stdin, 'drain')
    },
    async finish() {
      ffmpeg.stdin.end()
      await exited
    },
    kill() {
      ffmpeg.kill('SIGKILL')
    },
  }
}

const cli = goke('light-cookie')

const d = LIGHT_COOKIE_DEFAULTS
const hex = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)

cli
  .command(
    '<media>',
    dedent`
      Light an image or video like a real object on a wall: a warm window light
      cookie, moving leaf or bar shadows, a soft spill and a dim fill, on a
      plane you can tilt, skew and push into. Post: bloom, ACES tone mapping,
      lens chromatic aberration, warm grade, vignette and film grain.

      The output type comes from the \`--out\` extension. png, jpg or webp
      render one still at \`--time\`. mp4, mov or webm render \`--duration\`
      seconds at \`--fps\` and encode with ffmpeg. All motion (light drift,
      sway, orbit, flicker) loops over the duration; only \`--push\`
      does not, so set \`--push 0\` for a seamless loop.

      \`--light-cookie\` and \`--shadow-cookie\` take a preset name or an image
      or video path. Light cookies: white lets light through. Shadow cookies
      go through a light pass first: grayscale, then pixels darker than
      \`--shadow-threshold\` cast shadow, so a photo of a cross on a hill or a
      tree against the sky becomes its silhouette. Place it with
      \`--shadow-scale\`, \`--shadow-x\` and \`--shadow-y\`.

      Input videos loop and are seeked frame by frame, so renders are exact.
      Without \`--duration\`, a video output lasts as long as the longest input
      video, or ${DEFAULT_DURATION}s when all inputs are images.

      Renders in a tab of the playwriter-connected Chrome with three.js, then
      closes the tab.
    `,
  )
  .option('-o, --out [path]', z.string().optional().describe('Output path. png/jpg/webp for an image, mp4/mov/webm for a video (default: <image>-lit.png)'))
  .option('--width [px]', z.number().default(1920).describe('Frame width in css px'))
  .option('--height [px]', z.number().default(1080).describe('Frame height in css px'))
  .option('--scale [ratio]', z.number().optional().describe('Device pixel ratio. Default 2 for images, 1 for videos'))
  .option('--quality [value]', z.number().optional().describe('Encoder quality for jpg and webp images, 0-1'))
  .option('--duration [s]', z.number().optional().describe(`Loop length in seconds (default: longest input video, else ${DEFAULT_DURATION})`))
  .option('--fps [n]', z.number().default(30).describe('Video frame rate'))
  .option('--crf [n]', z.number().default(22).describe('Video quality, lower is better and bigger. Grain is costly: every frame has new noise'))
  .option('--time [s]', z.number().default(0).describe('Moment of the loop a still image shows'))
  // plane
  .option('--zoom [ratio]', z.number().default(d.zoom).describe('Plane size relative to covering the frame. Raise it when tilt shows the edges'))
  .option('--rotate-x [deg]', z.number().default(d.rotateX).describe('Positive tips the top edge away'))
  .option('--rotate-y [deg]', z.number().default(d.rotateY).describe('Positive pushes the right edge away'))
  .option('--rotate-z [deg]', z.number().default(d.rotateZ).describe('Roll, counterclockwise'))
  .option('--skew-x [deg]', z.number().default(d.skewX).describe('Horizontal shear'))
  .option('--skew-y [deg]', z.number().default(d.skewY).describe('Vertical shear'))
  .option('--translate-x [px]', z.number().default(d.translateX).describe('Shift the plane right'))
  .option('--translate-y [px]', z.number().default(d.translateY).describe('Shift the plane up'))
  .option('--fov [deg]', z.number().default(d.fov).describe('Camera field of view. Smaller is flatter'))
  // light
  .option('--light-cookie [preset|path]', z.string().default(d.lightCookie).describe(`Light shape: ${LIGHT_PRESETS.join(', ')}, or an image or video (white = light)`))
  .option('--shadow-cookie [preset|path]', z.string().default(d.shadowCookie).describe(`Shadow shape: ${SHADOW_PRESETS.join(', ')}, or an image or video (dark = shadow)`))
  .option('--light-azimuth [deg]', z.number().default(d.lightAzimuth).describe('Where the light comes from: 0 right, 90 top, 135 top left'))
  .option('--light-elevation [deg]', z.number().default(d.lightElevation).describe('Light height above the plane. Low values stretch the patch'))
  .option('--light-x [fraction]', z.number().default(d.lightX).describe('Light patch center, fraction of the frame width from the center'))
  .option('--light-y [fraction]', z.number().default(d.lightY).describe('Light patch center, fraction of the frame height from the center'))
  .option('--light-size [fraction]', z.number().default(d.lightSize).describe('Light patch size, fraction of the larger frame side'))
  .option('--light-intensity [value]', z.number().default(d.lightIntensity).describe('Key light strength'))
  .option('--light-color [hex]', hex.default(d.lightColor).describe('Key light color'))
  .option('--spill [fraction]', z.number().default(d.spill).describe('Soft glow around the patch, fraction of the key light'))
  .option('--softness [fraction]', z.number().default(d.softness).describe('Window edge blur, fraction of the cookie size'))
  .option('--shadow-softness [fraction]', z.number().optional().describe(`Shadow blur, fraction of the cookie size. Higher is softer (default: ${d.shadowSoftness}, ${MEDIA_SHADOW_SOFTNESS} for shadow media so the silhouette reads)`))
  .option('--shadow-opacity [value]', z.number().default(d.shadowOpacity).describe('How dark the shadows are inside the light, 0-1'))
  .option('--shadow-threshold [value]', z.number().default(d.shadowThreshold).describe('Shadow media: luminance below this casts shadow. 0 keeps the grays'))
  .option('--shadow-invert', z.boolean().default(false).describe('Shadow media: bright pixels cast shadow instead of dark ones'))
  .option('--shadow-scale [ratio]', z.number().default(d.shadowScale).describe('Shadow size relative to the window'))
  .option('--shadow-x [fraction]', z.number().default(d.shadowX).describe('Move the shadow right, fraction of the window'))
  .option('--shadow-y [fraction]', z.number().default(d.shadowY).describe('Move the shadow up, fraction of the window'))
  .option('--ambient [value]', z.number().default(d.ambient).describe('Fill light outside the patch'))
  .option('--ambient-color [hex]', hex.default(d.ambientColor).describe('Fill light color'))
  .option('--relief [value]', z.number().default(d.relief).describe('Surface relief from the image (bump). 0 is flat'))
  .option('--gloss [value]', z.number().default(d.gloss).describe('Surface sheen, 0-1'))
  .option('--seed [n]', z.number().default(d.seed).describe('Leaf layout seed'))
  // motion
  .option('--light-drift [fraction]', z.number().default(d.lightDrift).describe('How far the light patch drifts, fraction of the frame width'))
  .option('--sway [deg]', z.number().default(d.sway).describe('Leaf sway; shadow media rock by a third of this'))
  .option('--push [fraction]', z.number().default(d.push).describe('Camera dolly-in over the duration. 0 for seamless loops'))
  .option('--orbit [deg]', z.number().default(d.orbit).describe('Slow plane rotation amplitude'))
  .option('--flicker [fraction]', z.number().default(d.flicker).describe('Light intensity breathing'))
  // post
  .option('--exposure [value]', z.number().default(d.exposure).describe('Tone mapping exposure'))
  .option('--bloom [value]', z.number().default(d.bloom).describe('Glow around bright light, 0 is off'))
  .option('--grain [value]', z.number().default(d.grain).describe('Film grain intensity'))
  .option('--grain-size [px]', z.number().default(d.grainSize).describe('Grain size in css px'))
  .option('--vignette [value]', z.number().default(d.vignette).describe('Corner darkening, 0-1'))
  .option('--chromatic-aberration [value]', z.number().default(d.chromaticAberration).describe('Lens color fringe toward the corners'))
  .option('--warmth [value]', z.number().default(d.warmth).describe('Warm highlights, -1 cool to 1 warm'))
  .option('--contrast [value]', z.number().default(d.contrast).describe('Contrast'))
  .option('--saturation [value]', z.number().default(d.saturation).describe('Saturation'))
  .option('--lift [value]', z.number().default(d.lift).describe('Lift the blacks, 0-0.2'))
  .option('--background [hex]', hex.default(d.backgroundColor).describe('Color behind the plane'))
  .option('--debug-cookie', z.boolean().default(false).describe('Write the cookie texture (white = light) instead of the render. Images only'))
  .example('# Still with the default window light and leaf shadows')
  .example('light-cookie icon.jpg -o icon-lit.jpg')
  .example('# 6 second vertical video, light from the top right through blinds')
  .example('light-cookie icon.jpg -o icon.mp4 --width 1080 --height 1920 --light-cookie blinds --light-azimuth 45')
  .example('# Second image as a shadow: a cross on a hill, in a soft round light')
  .example('light-cookie icon.jpg -o icon.jpg --light-cookie none --shadow-cookie cross-hill.png --shadow-opacity 0.8')
  .example('# Video shadow, seamless loop')
  .example('light-cookie art.png -o art.mp4 --shadow-cookie ./tree-sway.mp4 --push 0')
  .action(async (mediaArg, options, { console }) => {
    const mediaPath = path.resolve(mediaArg)
    if (!fs.existsSync(mediaPath)) throw new Error(`File not found: ${mediaPath}`)
    const outPath = path.resolve(options.out || mediaPath.replace(/\.[^./]+$/, '') + '-lit.png')
    const ext = path.extname(outPath).toLowerCase()
    const imageType = IMAGE_TYPES[ext]
    const codec = VIDEO_CODECS[ext]
    if (!imageType && !codec) {
      throw new Error(`Unsupported output type "${ext}". Use .png, .jpg, .webp, .mp4, .mov or .webm: light-cookie ${mediaArg} -o out.mp4`)
    }

    const cookieInput = <T extends string>({ value, presets, flag }: { value: string; presets: readonly T[]; flag: string }) => {
      const preset = presets.find((p) => p === value)
      if (preset) return { preset, file: undefined }
      const file = path.resolve(value)
      if (!fs.existsSync(file)) throw new Error(`${flag} must be one of ${presets.join(', ')} or an image or video path. Not found: ${file}`)
      return { preset: presets[0]!, file }
    }
    const light = cookieInput({ value: options.lightCookie, presets: LIGHT_PRESETS, flag: '--light-cookie' })
    const shadow = cookieInput({ value: options.shadowCookie, presets: SHADOW_PRESETS, flag: '--shadow-cookie' })

    const scale = options.scale ?? (codec ? 1 : 2)
    const kind = (file: string | undefined) => (file ? (isVideo(file) ? 'video' : 'image') : undefined)
    const renderOptions: RenderPageOptions = {
      width: options.width,
      height: options.height,
      scale,
      video: Boolean(codec),
      fps: options.fps,
      time: options.time,
      duration: options.duration,
      defaultDuration: DEFAULT_DURATION,
      type: imageType ?? 'image/png',
      quality: options.quality,
      inputs: { media: kind(mediaPath), 'light-cookie': kind(light.file), 'shadow-cookie': kind(shadow.file) },
      debugCookie: options.debugCookie,
      params: {
        zoom: options.zoom,
        rotateX: options.rotateX,
        rotateY: options.rotateY,
        rotateZ: options.rotateZ,
        skewX: options.skewX,
        skewY: options.skewY,
        translateX: options.translateX,
        translateY: options.translateY,
        fov: options.fov,
        lightCookie: light.preset,
        shadowCookie: shadow.preset,
        lightAzimuth: options.lightAzimuth,
        lightElevation: options.lightElevation,
        lightX: options.lightX,
        lightY: options.lightY,
        lightSize: options.lightSize,
        lightIntensity: options.lightIntensity,
        lightColor: options.lightColor,
        spill: options.spill,
        softness: options.softness,
        shadowSoftness: options.shadowSoftness ?? (shadow.file ? MEDIA_SHADOW_SOFTNESS : d.shadowSoftness),
        shadowOpacity: options.shadowOpacity,
        shadowThreshold: options.shadowThreshold,
        shadowInvert: options.shadowInvert,
        shadowScale: options.shadowScale,
        shadowX: options.shadowX,
        shadowY: options.shadowY,
        ambient: options.ambient,
        ambientColor: options.ambientColor,
        relief: options.relief,
        gloss: options.gloss,
        seed: options.seed,
        lightDrift: options.lightDrift,
        sway: options.sway,
        push: options.push,
        orbit: options.orbit,
        flicker: options.flicker,
        exposure: options.exposure,
        bloom: options.bloom,
        grain: options.grain,
        grainSize: options.grainSize,
        vignette: options.vignette,
        chromaticAberration: options.chromaticAberration,
        warmth: options.warmth,
        contrast: options.contrast,
        saturation: options.saturation,
        lift: options.lift,
        backgroundColor: options.background,
      },
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    const ffmpeg = codec ? startFfmpeg({ outPath, fps: options.fps, codec: codec(options.crf) }) : undefined
    let output: Buffer | undefined
    let frameCount = 0
    const { server, origin } = await startServer({
      inputs: { media: mediaPath, 'light-cookie': light.file, 'shadow-cookie': shadow.file },
      onOutput: (bytes) => {
        output = bytes
      },
      onFrame: async (bytes) => {
        await ffmpeg?.write(bytes)
        frameCount++
        if (frameCount % options.fps === 0) console.error(`frame ${frameCount}`)
      },
    })
    console.error(`serving ${origin}`)
    const connection = await connectViaExtension({ tabGroup: 'light-cookie', tabGroupColor: 'yellow' })
    try {
      const context = connection.browser.contexts()[0]
      if (!context) throw new Error('No browser context from playwriter')
      const page = await context.newPage()
      try {
        const pageErrors: Error[] = []
        page.on('pageerror', (error) => pageErrors.push(error))
        await page.goto(`${origin}/`, { waitUntil: 'load', timeout: 30_000 })
        await page.waitForFunction(() => window.renderLightCookie !== undefined, undefined, { timeout: 10_000 })
        console.error('rendering')
        await page.evaluate((o) => window.renderLightCookie?.(o), renderOptions)
        if (pageErrors.length > 0) {
          throw new Error(`Page errors:\n${pageErrors.map((e) => e.message).join('\n')}`)
        }
      } finally {
        await page.close()
      }
    } catch (error) {
      ffmpeg?.kill()
      throw error
    } finally {
      await connection.close()
      server.close()
    }

    if (ffmpeg) {
      console.error('encoding')
      await ffmpeg.finish()
    } else {
      if (!output) throw new Error('The page finished without uploading an image')
      fs.writeFileSync(outPath, output)
    }
    console.error(`saved ${outPath}`)
    console.log(outPath)
  })

cli.help()
cli.completions()

await cli.parse()
// playwright keeps sockets alive after close; the command is done here
process.exit(0)

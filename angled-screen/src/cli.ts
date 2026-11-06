#!/usr/bin/env node
// Render images as angled 3D screens through the user's Chrome (playwriter extension).
// Serves the browser renderer on a random localhost port, opens a tab, the page renders with
// WebGL2 and POSTs the encoded image back, then the tab closes.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import url from 'node:url'
import { goke } from 'goke'
import { z } from 'zod'
import dedent from 'string-dedent'
import { connectViaExtension } from 'playwriter'
import { ANGLED_SCREEN_DEFAULTS, type RenderImageOptions } from './index.ts'

// dist/ holds index.js, the browser renderer the page imports
const MODULE_DIR = path.dirname(url.fileURLToPath(import.meta.url))

const OUTPUT_TYPES: Record<string, RenderImageOptions['type']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

const PAGE_HTML = dedent`
  <!doctype html>
  <meta charset="utf-8" />
  <script type="module">
    import { renderImage } from '/index.js'
    window.renderAngledScreen = async (options) => {
      const images = await Promise.all(
        Array.from({ length: options.imageCount }, async (_, i) =>
          createImageBitmap(await (await fetch('/input/' + i)).blob()),
        ),
      )
      const blob = await renderImage({ ...options, images })
      const res = await fetch('/output', { method: 'POST', body: blob })
      if (!res.ok) throw new Error('Upload failed: ' + res.status)
    }
  </script>
`

type RenderPageOptions = Omit<RenderImageOptions, 'images'> & { imageCount: number }

declare global {
  interface Window {
    renderAngledScreen?: (options: RenderPageOptions) => Promise<void>
  }
}

// Routes: / page, /index.js renderer, /input/<i> images, POST /output result.
function startServer({ inputPaths, onOutput }: { inputPaths: string[]; onOutput: (bytes: Buffer) => void }) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (req.method === 'POST' && pathname === '/output') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        onOutput(Buffer.concat(chunks))
        res.end('ok')
      })
      return
    }
    res.setHeader('cache-control', 'no-store')
    if (pathname === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(PAGE_HTML)
      return
    }
    if (pathname === '/index.js') {
      res.setHeader('content-type', 'text/javascript; charset=utf-8')
      res.end(fs.readFileSync(path.join(MODULE_DIR, 'index.js')))
      return
    }
    const inputPath = pathname.startsWith('/input/') ? inputPaths[Number(pathname.slice('/input/'.length))] : undefined
    if (inputPath) {
      res.end(fs.readFileSync(inputPath))
      return
    }
    res.statusCode = 404
    res.end('not found')
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

const cli = goke('angled-screen')

const d = ANGLED_SCREEN_DEFAULTS

cli
  .command(
    '<...images>',
    dedent`
      Render images as tilted 3D screens with depth of field, fog,
      chromatic aberration and film grain. Several images become a row of
      screens on the same plane, so the camera can sit further back.

      Opens a tab in the playwriter-connected Chrome, renders the frame with
      WebGL2, writes the image, then closes the tab. The image type comes
      from the \`--out\` extension: png, jpg or webp.

      The screens row is \`--content-width\` of the frame wide and keeps the
      image aspect ratios. Tune the angle with \`--rotate-x\`, \`--rotate-y\` and
      \`--perspective\`; use \`--debug\` to see the depth ramp that drives the blur.
    `,
  )
  .option('-o, --out [path]', z.string().optional().describe('Output image path (default: <first image name>-angled.png next to it)'))
  .option('--width [px]', z.number().default(1920).describe('Frame width in css px'))
  .option('--height [px]', z.number().default(1080).describe('Frame height in css px'))
  .option('--scale [ratio]', z.number().default(2).describe('Device pixel ratio of the output image'))
  .option('--content-width [fraction]', z.number().default(0.8).describe('Screens row width as a fraction of the frame width. Above 1 the plane grows past the frame'))
  .option('--gap [px]', z.number().default(48).describe('Space between screens in css px'))
  .option('--radius [px]', z.number().default(12).describe('Screen corner radius in css px'))
  .option('--perspective [px]', z.number().default(d.perspective).describe('Camera distance in px. Smaller is more dramatic'))
  .option('--rotate-x [deg]', z.number().default(d.rotateX).describe('Tilt top/bottom in degrees. Positive brings the top closer'))
  .option('--rotate-y [deg]', z.number().default(d.rotateY).describe('Angle left/right in degrees. Negative brings the right side closer'))
  .option('--rotate-z [deg]', z.number().default(d.rotateZ).describe('Roll in degrees, clockwise'))
  .option('--translate-x [px]', z.number().default(d.translateX).describe('Shift the screen right in px'))
  .option('--translate-z [px]', z.number().default(d.translateZ).describe('Move the screen closer (positive) or further in px'))
  .option('--no-bokeh', 'Disable the depth of field blur')
  .option('--aperture [value]', z.number().default(d.aperture).describe('Blur strength. Higher reaches max blur sooner'))
  .option('--max-blur [value]', z.number().default(d.maxBlur).describe('Blur cap as a fraction of the frame size'))
  .option('--focus [fraction]', z.number().default(d.focus).describe('Focus distance as a fraction of perspective. 0 keeps the near side sharp'))
  .option('--fog [value]', z.number().default(d.fog).describe('Fade toward the background at the far side, 0-1'))
  .option('--grain [value]', z.number().default(d.grainIntensity).describe('Film grain intensity'))
  .option('--chromatic-aberration [value]', z.number().default(d.chromaticAberration).describe('Purple/cyan fringe strength. 0 is off'))
  .option('--background [hex]', z.string().regex(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i).default(d.backgroundColor).describe('Background color, hex'))
  .option('--quality [value]', z.number().optional().describe('Encoder quality for jpg and webp, 0-1'))
  .option('--debug', z.boolean().default(false).describe('Render the depth ramp as grayscale instead of the image'))
  .example('# Default angle, 3840x2160 png next to the input')
  .example('angled-screen screenshot.png')
  .example('# Steeper angle, white background, jpg')
  .example('angled-screen screenshot.png -o hero.jpg --rotate-y=-24 --rotate-x 11 --perspective 720 --background "#ffffff"')
  .example('# Two pages side by side on one plane')
  .example('angled-screen home.png download.png -o hero.png --content-width 1.7 --rotate-y 16 --translate-z 150 --translate-x 580')
  .action(async (imageArgs, options, { console }) => {
    const inputPaths = imageArgs.map((arg) => path.resolve(arg))
    const missing = inputPaths.find((p) => !fs.existsSync(p))
    if (missing) {
      throw new Error(`File not found: ${missing}`)
    }
    const outPath = path.resolve(options.out || inputPaths[0]!.replace(/\.[^./]+$/, '') + '-angled.png')
    const ext = path.extname(outPath).toLowerCase()
    const type = OUTPUT_TYPES[ext]
    if (!type) {
      throw new Error(`Unsupported output type "${ext}". Use .png, .jpg or .webp: angled-screen ${imageArgs.join(' ')} -o out.png`)
    }

    const renderOptions: RenderPageOptions = {
      width: options.width,
      height: options.height,
      scale: options.scale,
      contentWidth: options.contentWidth,
      gap: options.gap,
      imageCount: inputPaths.length,
      radius: options.radius,
      type,
      quality: options.quality,
      params: {
        perspective: options.perspective,
        rotateX: options.rotateX,
        rotateY: options.rotateY,
        rotateZ: options.rotateZ,
        translateX: options.translateX,
        translateZ: options.translateZ,
        bokeh: !options.noBokeh,
        aperture: options.aperture,
        maxBlur: options.maxBlur,
        focus: options.focus,
        fog: options.fog,
        grainIntensity: options.grain,
        chromaticAberration: options.chromaticAberration,
        backgroundColor: options.background,
        debug: options.debug,
      },
    }

    let output: Buffer | undefined
    const { server, origin } = await startServer({
      inputPaths,
      onOutput: (bytes) => {
        output = bytes
      },
    })
    console.error(`serving ${origin}`)
    const connection = await connectViaExtension({ tabGroup: 'angled-screen', tabGroupColor: 'purple' })
    try {
      const context = connection.browser.contexts()[0]
      if (!context) throw new Error('No browser context from playwriter')
      const page = await context.newPage()
      try {
        const pageErrors: Error[] = []
        page.on('pageerror', (error) => pageErrors.push(error))
        await page.goto(`${origin}/`, { waitUntil: 'load', timeout: 30_000 })
        await page.waitForFunction(() => window.renderAngledScreen !== undefined, undefined, { timeout: 10_000 })
        console.error('rendering')
        await page.evaluate((o) => window.renderAngledScreen?.(o), renderOptions)
        if (pageErrors.length > 0) {
          throw new Error(`Page errors:\n${pageErrors.map((e) => e.message).join('\n')}`)
        }
      } finally {
        await page.close()
      }
    } finally {
      await connection.close()
      server.close()
    }
    if (!output) throw new Error('The page finished without uploading an image')
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, output)
    console.error(`saved ${outPath}`)
    console.log(outPath)
  })

cli.help()
cli.completions()

await cli.parse()
// playwright keeps sockets alive after close; the command is done here
process.exit(0)

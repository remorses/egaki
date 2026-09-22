// Offline ribbon measurement; .server.ts keeps Node-only tooling outside Egaki's client glob.
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import sharp from 'sharp'

type Point = [number, number]
type Component = {
  pixels: number[]
  left: number
  right: number
  top: number
  bottom: number
}
type Stop = { offset: number; color: string; opacity: number }
type Silhouette = { path: string; top: number; bottom: number; stops: Stop[] }
type Frame = { frame: number; caps: Point[][]; silhouettes: Silhouette[] }
type Seed = { x: number; top: number; slope: number }

const width = 1920
const height = 1080

function components(mask: Uint8Array, w: number, h: number, minimum: number) {
  const found: Component[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue
    const pixels = [start]
    mask[start] = 0
    let left = w,
      right = 0,
      top = h,
      bottom = 0
    for (let cursor = 0; cursor < pixels.length; cursor++) {
      const p = pixels[cursor]
      const x = p % w,
        y = Math.floor(p / w)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= mask.length || !mask[q]) continue
        mask[q] = 0
        pixels.push(q)
      }
    }
    if (pixels.length >= minimum) found.push({ pixels, left, right, top, bottom })
  }
  return found
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points
  const [ax, ay] = points[0],
    [bx, by] = points[points.length - 1]
  const dx = bx - ax,
    dy = by - ay
  let distance = tolerance * tolerance,
    split = 0
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
    const d = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
    if (d > distance) {
      distance = d
      split = i
    }
  }
  return split
    ? [
        ...simplify(points.slice(0, split + 1), tolerance).slice(0, -1),
        ...simplify(points.slice(split), tolerance),
      ]
    : [points[0], points[points.length - 1]]
}

function hull(points: Point[]) {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (list: Point[]) => {
    const result: Point[] = []
    for (const p of list) {
      while (
        result.length >= 2 &&
        cross(result[result.length - 2], result[result.length - 1], p) <= 0
      )
        result.pop()
      result.push(p)
    }
    return result.slice(0, -1)
  }
  const outline = [...half(sorted), ...half([...sorted].reverse())]
  return simplify([...outline, outline[0]], 1).slice(0, -1)
}

function contour(component: Component, w: number, fadeEnd: number, frame: number) {
  const pixels = new Set(component.pixels)
  const edges = new Map<number, number[]>()
  const stride = w + 1
  const add = (a: number, b: number) => edges.set(a, [...(edges.get(a) ?? []), b])
  for (const p of pixels) {
    const x = p % w,
      y = Math.floor(p / w),
      v = y * stride + x
    if (!pixels.has(p - w)) add(v, v + 1)
    if (x === w - 1 || !pixels.has(p + 1)) add(v + 1, v + stride + 1)
    if (!pixels.has(p + w)) add(v + stride + 1, v + stride)
    if (x === 0 || !pixels.has(p - 1)) add(v + stride, v)
  }
  const paths: string[] = []
  while (edges.size) {
    const first = edges.keys().next().value!
    let vertex = first
    const loop: Point[] = []
    do {
      const y = Math.floor(vertex / stride) * 2
      const end = (component.bottom + 1) * 2
      const fadeStart = end - (frame < 46 ? 80 : 32)
      // The saturation mask loses faint tails before alpha reaches zero.
      loop.push([
        (vertex % stride) * 2,
        Math.round(
          y > fadeStart && end < height
            ? fadeStart + ((y - fadeStart) * (fadeEnd - fadeStart)) / (end - fadeStart)
            : y,
        ),
      ])
      const next = edges.get(vertex)
      if (!next?.length) break
      const previous = vertex
      vertex = next.pop()!
      if (!next.length) edges.delete(previous)
    } while (vertex !== first)
    const area =
      loop.reduce((sum, p, i) => {
        const q = loop[(i + 1) % loop.length]
        return sum + p[0] * q[1] - q[0] * p[1]
      }, 0) / 2
    // Ignore grain holes; caps are separate foreground polygons.
    if (area < 48) continue
    const middle = Math.floor(loop.length / 2)
    const outline = [
      ...simplify(loop.slice(0, middle + 1), 2.5).slice(0, -1),
      ...simplify([...loop.slice(middle), loop[0]], 2.5).slice(0, -1),
    ]
    paths.push(`M${outline.map((p) => p.join(',')).join('L')}Z`)
  }
  return paths.join('')
}

function gradient(
  component: Component,
  rgb: Buffer,
  w: number,
  top: number,
  bottom: number,
): Stop[] {
  const rows = new Map<number, number[]>()
  for (const p of component.pixels) {
    const y = Math.floor(p / w)
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y)!.push(p)
  }
  return [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((offset) => {
    const target = Math.max(
      component.top,
      Math.min(component.bottom, Math.round((top + offset * (bottom - top)) / 2)),
    )
    const samples: number[][] = [[], [], []]
    for (
      let y = Math.max(component.top, target - 3);
      y <= Math.min(component.bottom, target + 3);
      y++
    ) {
      const row = rows.get(y) ?? []
      for (const p of row) {
        // Keep gradient statistics away from antialiased edges and black cap borders.
        if (rgb[p * 3 + 1] < 180) continue
        for (let channel = 0; channel < 3; channel++) samples[channel].push(rgb[p * 3 + channel])
      }
    }
    const color = samples.map((values) => {
      values.sort((a, b) => a - b)
      return values[Math.floor(values.length / 2)] ?? 247
    })
    if (offset === 1) return { offset, color: '#f6ffb2', opacity: 0 }
    const opacity = Math.min(
      1,
      Math.max(0.02, ...color.map((v) => (v < 247 ? (247 - v) / 150 : (v - 247) / 8))),
    )
    return {
      offset,
      color: `#${color
        .map((v) =>
          Math.round(Math.max(0, Math.min(255, 247 + (v - 247) / opacity)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`,
      opacity: Math.round(opacity * 1000) / 1000,
    }
  })
}

function seeds(frames: Frame[], frame: number): Seed[] {
  const measure = (index: number) =>
    frames[index].caps
      .map((points) => {
        const top = Math.min(...points.map((p) => p[1])),
          bottom = Math.max(...points.map((p) => p[1]))
        const left = Math.min(...points.map((p) => p[0])),
          right = Math.max(...points.map((p) => p[0]))
        const upper = points.filter((p) => p[1] <= top + 2),
          lower = points.filter((p) => p[1] >= bottom - 2)
        return {
          x: (left + right) / 2,
          top: (top + bottom) / 2 - (frame < 46 ? 6 : 2),
          slope:
            (lower.reduce((sum, p) => sum + p[0], 0) / lower.length -
              upper.reduce((sum, p) => sum + p[0], 0) / upper.length) /
            Math.max(1, bottom - top),
          complete:
            right - left >= (frame < 46 ? 110 : 26) &&
            bottom - top >= (frame < 46 ? 110 : 26) &&
            (frame < 46 || right - left < 54),
        }
      })
      .sort((a, b) => a.top - b.top)
  const current = measure(frame)
  if (current.length === 3 && current.every((s) => s.complete)) return current
  let before = frame - 1,
    after = frame + 1
  const complete = (index: number) =>
    measure(index).length === 3 && measure(index).every((s) => s.complete)
  while (before >= (frame < 46 ? 0 : 46) && !complete(before)) before--
  while (after < (frame < 46 ? 46 : 156) && !complete(after)) after++
  if (before < (frame < 46 ? 0 : 46) || after >= (frame < 46 ? 46 : 156)) return current
  const prior = measure(before),
    next = measure(after),
    t = (frame - before) / (after - before)
  // Only hidden geometry is interpolated; visible cap polygons always come from this frame.
  return prior.map((s, i) => {
    const estimate = {
      x: s.x + (next[i].x - s.x) * t,
      top: s.top + (next[i].top - s.top) * t,
      slope: s.slope + (next[i].slope - s.slope) * t,
    }
    return (
      current.find(
        (cap) =>
          cap.complete &&
          Math.abs(cap.top - estimate.top) < 12 &&
          Math.abs(cap.x - estimate.x) < 30,
      ) ?? estimate
    )
  })
}

async function ribbons(rgb: Buffer, anchors: Seed[], frame: number): Promise<Silhouette[]> {
  const w = width / 2,
    h = height / 2
  const mask = new Uint8Array(w * h)
  for (let y = frame < 46 ? 0 : 240; y < h; y++) {
    for (let x = frame < 46 ? 0 : 300; x < (frame < 46 ? w : 675); x++) {
      const p = y * w + x,
        i = p * 3
      if (rgb[i + 1] - rgb[i + 2] > 12 && rgb[i + 1] - rgb[i] > -4 && rgb[i + 1] > 130)
        mask[p] = 255
    }
  }
  const clean = await sharp(mask, { raw: { width: w, height: h, channels: 1 } })
    .median(3)
    .toColourspace('b-w')
    .raw()
    .toBuffer()
  assert.equal(clean.length, w * h, 'The mask must have exactly one channel')
  const length = frame < 46 ? 500 : 250,
    bodyWidth = frame < 46 ? 400 : 80
  const curves = anchors.map((seed) => {
    const curvature: number[] = []
    for (
      let y = Math.ceil((seed.top + 40) / 2);
      y < Math.min(h, (seed.top + length * 0.8) / 2);
      y += 3
    ) {
      const d = y * 2 - seed.top
      const expected = seed.x + seed.slope * d * (1 - d / (2 * length))
      let x = Math.max(0, Math.min(w - 1, Math.round(expected / 2)))
      if (!clean[y * w + x]) continue
      let left = x,
        right = x
      while (left > 0 && clean[y * w + left - 1]) left--
      while (right < w - 1 && clean[y * w + right + 1]) right++
      if (Math.abs((right - left) * 2 - bodyWidth) > bodyWidth * 0.16) continue
      curvature.push((left + right - seed.x - seed.slope * d) / (d * d))
    }
    curvature.sort((a, b) => a - b)
    return {
      ...seed,
      curvature: curvature[Math.floor(curvature.length / 2)] ?? -seed.slope / (2 * length),
    }
  })
  const groups = curves.map((): Component => ({ pixels: [], left: w, right: 0, top: h, bottom: 0 }))
  for (const connected of components(clean.slice(), w, h, 60)) {
    if (!curves.length) continue
    const nearby = curves
      .map((seed, index) => ({ seed, index }))
      .filter(({ seed }) =>
        connected.pixels.some((p) => {
          const d = Math.floor(p / w) * 2 - seed.top
          return d >= 0 && d < 30 && Math.abs((p % w) * 2 - seed.x) < bodyWidth * 0.65
        }),
      )
    const eligible = nearby.length ? nearby : curves.map((seed, index) => ({ seed, index }))
    for (const p of connected.pixels) {
      const x = p % w,
        y = Math.floor(p / w)
      const candidates = eligible.map(({ seed, index }) => {
        const d = y * 2 - seed.top
        const center = seed.x + seed.slope * d + seed.curvature * d * d
        const distance = Math.abs(x * 2 - center) / (bodyWidth / 2)
        return {
          index,
          inside: d >= 0 && d <= length && distance <= 1,
          distance: distance + Math.max(0, -d, d - length) / 10,
        }
      })
      // The central ribbon covers crossings; the lower cap's ribbon covers the rear ribbon.
      const owner =
        candidates.find((c) => c.index === 0 && c.inside) ??
        candidates.find((c) => c.index === 2 && c.inside) ??
        candidates.find((c) => c.inside) ??
        candidates.sort((a, b) => a.distance - b.distance)[0]
      const group = groups[owner.index]
      group.pixels.push(p)
      group.left = Math.min(group.left, x)
      group.right = Math.max(group.right, x)
      group.top = Math.min(group.top, y)
      group.bottom = Math.max(group.bottom, y)
    }
  }
  return groups
    .flatMap((group, index) => {
      if (group.pixels.length < 60) return []
      const top = Math.round(curves[index].top)
      const bottom =
        group.bottom === h - 1
          ? Math.max(height, top + length)
          : (group.bottom + 1) * 2 + (frame < 46 ? 40 : 16)
      return [
        {
          path: contour(group, w, bottom, frame),
          top,
          bottom,
          stops: gradient(group, rgb, w, top, bottom),
        },
      ]
    })
    .filter((shape) => shape.path)
}

async function main() {
  console.log('Decoding source frames 0-155 at 1920x1080, 24 fps')
  const decoder = spawn(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      new URL('./source.mp4', import.meta.url).pathname,
      '-frames:v',
      '156',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const exited = new Promise<number | null>((resolve) => {
    decoder.on('close', resolve)
    decoder.on('error', (error) => {
      console.error('Cannot decode source:', error.message)
      resolve(null)
    })
  })
  const frames: Frame[] = []
  const images: Buffer[] = []
  let pending = Buffer.alloc(0)
  for await (const chunk of decoder.stdout) {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= width * height * 3) {
      const rgb = pending.subarray(0, width * height * 3)
      pending = pending.subarray(width * height * 3)
      const frame = frames.length
      const black = new Uint8Array(width * height)
      for (let y = frame < 46 ? 0 : 480; y < height; y++) {
        for (let x = frame < 46 ? 0 : 650; x < (frame < 46 ? width : 1300); x++) {
          const p = y * width + x,
            i = p * 3
          if (Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) < 90) black[p] = 1
        }
      }
      const caps = components(black, width, height, 25).sort((a, b) => a.left - b.left)
      const half = await sharp(rgb, { raw: { width, height, channels: 3 } })
        .resize(width / 2, height / 2)
        .median(3)
        .raw()
        .toBuffer()
      images.push(half)
      frames.push({
        frame,
        caps: caps.map((c) => hull(c.pixels.map((p): Point => [p % width, Math.floor(p / width)]))),
        silhouettes: [],
      })
      if (frame % 12 === 0 || caps.length !== 3)
        console.log(
          `Frame ${frame}: ${caps.length} caps`,
          caps.map((c) => [c.left, c.top, c.right - c.left + 1, c.bottom - c.top + 1]),
        )
      if (
        process.argv.includes('--preview') &&
        [0, 3, 12, 45, 46, 48, 52, 68, 100, 140, 155].includes(frame)
      ) {
        await sharp(rgb, { raw: { width, height, channels: 3 } })
          .resize(960)
          .png()
          .toFile(new URL(`./ribbon-source-${frame}.png`, import.meta.url).pathname)
      }
    }
  }
  if ((await exited) !== 0 || frames.length !== 156 || pending.length) {
    console.error('Incomplete source decode; output not written')
    process.exitCode = 1
    return
  }
  for (const record of frames) {
    record.silhouettes = await ribbons(
      images[record.frame],
      seeds(frames, record.frame),
      record.frame,
    )
    if (record.frame % 12 === 0)
      console.log(`Tracing frame ${record.frame}: ${record.silhouettes.length} ribbon regions`)
  }
  await writeFile(
    new URL('../ribbon-motion.json', import.meta.url),
    JSON.stringify(
      {
        description:
          'Vector measurements, source frames 0-155. Caps: full-resolution dark connected-component hulls. Silhouettes: half-resolution green/yellow contours simplified to 2.5px. Crossings partitioned by cap-guided quadratic centerlines fitted to isolated scanlines. Hidden cap seeds interpolate adjacent complete measurements; only measured visible cap polygons are drawn. Gradient colors are row medians, unpremultiplied against #f7f7f7. Low-saturation tails extrapolate 40px/16px to transparent ends. Crossing depth, tail extrapolation, blur and procedural grain approximate the source.',
        width,
        height,
        fps: 24,
        cutFrame: 46,
        frames,
      },
      null,
      2,
    ) + '\n',
  )
  console.log('Wrote 156 frame records')
  for (const record of frames) {
    assert.ok(record.caps.length <= 3, `Unexpected cap component at ${record.frame}`)
    assert.ok(record.silhouettes.every((s) => s.top < s.bottom && s.path.startsWith('M')))
    assert.ok(record.caps.flat().every(([x, y]) => x >= 0 && x < width && y >= 0 && y < height))
  }
  console.log('Verified frame count, cap bounds, and silhouette records')
  if (!process.argv.includes('--preview') && !process.argv.includes('--verify')) return
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { Ribbons } = await import('../ribbon-motion.tsx')
  const render = (frame: number) => renderToStaticMarkup(createElement(Ribbons, { frame }))
  for (const frame of [-1, 156, Infinity, NaN]) assert.equal(render(frame), '')
  for (const record of frames) {
    const svg = render(record.frame)
    assert.equal(
      svg,
      render(record.frame + 0.5),
      'Fractional frames hold the preceding source frame',
    )
    assert.ok(!/<image|<video|data:image|base64/.test(svg), 'Only vector primitives are allowed')
  }
  assert.notEqual(render(45), render(46))
  const beforeSeek = render(96)
  render(12)
  assert.equal(render(96), beforeSeek, 'Seeking is independent of previous renders')
  console.log('Verified all frame records, range limits, held frames, SVG-only output, and cut')
  if (process.argv.includes('--preview')) {
    const comparisons: sharp.OverlayOptions[] = []
    for (const frame of [0, 3, 12, 45, 46, 48, 52, 68, 100, 140, 155]) {
      const svg = render(frame)
      const vector = await sharp(Buffer.from(svg))
        .flatten({ background: '#f7f7f7' })
        .resize(960)
        .removeAlpha()
        .raw()
        .toBuffer()
      const source = await sharp(new URL(`./ribbon-source-${frame}.png`, import.meta.url).pathname)
        .removeAlpha()
        .raw()
        .toBuffer()
      let intersection = 0,
        union = 0
      for (let i = 0; i < source.length; i += 3) {
        const a = source[i + 1] - source[i + 2] > 20 && source[i + 1] - source[i] > -4
        const b = vector[i + 1] - vector[i + 2] > 20 && vector[i + 1] - vector[i] > -4
        if (a || b) union++
        if (a && b) intersection++
      }
      console.log(
        `Frame ${frame}: green-mask intersection/union ${(union ? (100 * intersection) / union : 100).toFixed(1)}%`,
      )
      await sharp(vector, { raw: { width: 960, height: 540, channels: 3 } })
        .png()
        .toFile(new URL(`./ribbon-vector-${frame}.png`, import.meta.url).pathname)
      const top = (comparisons.length / 2) * 270
      comparisons.push({
        input: await sharp(source, {
          raw: { width: 960, height: 540, channels: 3 },
        })
          .resize(480)
          .png()
          .toBuffer(),
        top,
        left: 0,
      })
      comparisons.push({
        input: await sharp(vector, {
          raw: { width: 960, height: 540, channels: 3 },
        })
          .resize(480)
          .png()
          .toBuffer(),
        top,
        left: 480,
      })
    }
    await sharp({
      create: {
        width: 960,
        height: (comparisons.length / 2) * 270,
        channels: 3,
        background: '#f7f7f7',
      },
    })
      .composite(comparisons)
      .jpeg({ quality: 90 })
      .toFile(new URL('./ribbon-comparison.jpg', import.meta.url).pathname)
    console.log('Wrote reference/ribbon-comparison.jpg: source left, vector right')
  }
}

await main()

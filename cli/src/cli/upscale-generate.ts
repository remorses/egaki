// Image upscaling for `egaki upscale`. Two kinds of upscalers:
//
//   gpt-image-2*   re-renders the input at a larger custom size with a strict
//                  "same image, more pixels" prompt, then color-matches it to
//                  the input. OpenAI key: one call. ChatGPT login: overlapping
//                  tiles, because that backend returns ~1.6 MP per call
//   midjourney*    registers the image as a midjourney.com editor upload, then
//                  runs Midjourney's 2x subtle or creative upscaler through the
//                  user's Chrome (@egaki/midjourney + Playwriter)
//
// Research on other upscale APIs (fal, Replicate, Topaz, ...): docs/upscale-apis.md

import sharp from 'sharp'
import dedent from 'string-dedent'
import { generateImageUncached, ValidationError, type GeneratedFile } from './generate.js'
import { CATALOG } from './model-catalog.js'
import { shouldUseChatGptBackend } from './credentials.js'

export const MIDJOURNEY_UPSCALE_MODELS = ['midjourney', 'midjourney-creative'] as const
export const DEFAULT_UPSCALE_MODEL = 'gpt-image-2.6-sunburst'

/** GPT Image models that accept custom WIDTHxHEIGHT sizes. */
export const GPT_UPSCALE_MODELS = CATALOG
  .map((m) => m.id)
  .filter((id) => id.startsWith('gpt-image-2'))

export const UPSCALE_MODELS = [...GPT_UPSCALE_MODELS, ...MIDJOURNEY_UPSCALE_MODELS]

export interface UpscaleImageOptions {
  image: Uint8Array
  model?: string
  /** Target scale factor. GPT Image: default is the largest size it supports. Midjourney: always 2. */
  scale?: number
  /** Extra instructions appended to the upscale prompt (GPT), or the job prompt (Midjourney). */
  prompt?: string
}

export interface UpscaleImageResult {
  image: GeneratedFile
  model: string
  input: { width: number; height: number }
  output: { width: number; height: number }
  /** Exact prompt sent to the model. */
  prompt?: string
  /** Number of GPT Image calls (tiles) blended into the output. */
  tiles?: number
  /** Midjourney upscale job ID. */
  jobId?: string
  /** Set when the provider returned a smaller image than requested. */
  warning?: string
  cost: number | null
}

// https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options
const GPT_SIZE_MULTIPLE = 16
const GPT_MAX_EDGE = 3840
const GPT_MIN_PIXELS = 655_360
const GPT_MAX_PIXELS = 8_294_400
const GPT_MAX_RATIO = 3

/**
 * Pick the GPT Image output size for an upscale: the input scaled by `scale`
 * (or as large as allowed), snapped to multiples of 16, inside the model limits,
 * keeping the aspect ratio as close as the 16px grid allows.
 */
export function gptUpscaleSize({
  width,
  height,
  scale,
}: {
  width: number
  height: number
  scale?: number
}): ValidationError | { width: number; height: number } {
  const ratio = width / height
  if (Math.max(ratio, 1 / ratio) > GPT_MAX_RATIO) {
    return new ValidationError(
      `GPT Image supports aspect ratios up to ${GPT_MAX_RATIO}:1. The input is ${width}x${height}.`,
    )
  }
  if (scale !== undefined && !(scale > 1)) {
    return new ValidationError(`Scale must be greater than 1, got ${scale}.`)
  }

  const area = width * height
  const targetArea = scale === undefined ? GPT_MAX_PIXELS : area * scale * scale

  // Try every long edge on the 16px grid, keep the valid size closest in area to the target.
  const landscape = width >= height
  const longRatio = landscape ? ratio : 1 / ratio
  let best: { width: number; height: number } | undefined
  for (let long = GPT_SIZE_MULTIPLE; long <= GPT_MAX_EDGE; long += GPT_SIZE_MULTIPLE) {
    const short = Math.max(GPT_SIZE_MULTIPLE, Math.round(long / longRatio / GPT_SIZE_MULTIPLE) * GPT_SIZE_MULTIPLE)
    const pixels = long * short
    if (pixels < GPT_MIN_PIXELS || pixels > GPT_MAX_PIXELS || long / short > GPT_MAX_RATIO) continue
    if (!best || Math.abs(pixels - targetArea) < Math.abs(best.width * best.height - targetArea)) {
      best = landscape ? { width: long, height: short } : { width: short, height: long }
    }
  }
  if (!best || best.width * best.height <= area) {
    return new ValidationError(
      `GPT Image cannot upscale a ${width}x${height} image: its output is limited to ${GPT_MAX_EDGE}px per edge and ${(GPT_MAX_PIXELS / 1e6).toFixed(1)} MP.`,
    )
  }
  return best
}

/**
 * Prompt for GPT Image upscales. Structure from the common ChatGPT upscale
 * templates: action, keep list, allowed improvements, forbidden changes.
 * See docs/upscale-apis.md for sources.
 */
export function gptUpscalePrompt({
  width,
  height,
  extra,
}: {
  width: number
  height: number
  extra?: string
}): string {
  const prompt = dedent`
    Upscale this image to ${width}x${height} pixels. This is a resolution upscale, not an edit: return the exact same image with more pixels and finer detail.

    Keep everything identical to the input: composition, framing, crop and aspect ratio; the position, size, shape and proportions of every element; perspective and horizon line; colors, white balance, contrast and lighting; shadows and highlights; medium and style (brushwork, film grain, line art, paper or canvas texture); all text, letters and logos character for character; faces, identity and expressions.

    Improve only resolution and definition: render crisp edges, fine textures and small details that are consistent with what is already visible, as if the same image had been captured or painted at a higher resolution. Remove blur, noise, JPEG compression artifacts and color banding.

    Do not add, remove, move, restyle or reinterpret anything. No new objects, no recoloring, no relighting, no reframing, no cropping, no borders, no oversharpening halos, no plastic smoothing, no stylization.
  `
  return extra?.trim() ? `${prompt}\n\nAdditional instructions: ${extra.trim()}` : prompt
}

// The ChatGPT subscription backend ignores `size` and `quality` and returns about
// 1536x1024 worth of pixels in the input aspect ratio (verified Nov 2026, see
// docs/chatgpt-codex-image-backend.md). To reach the target size there, the
// input is split into overlapping tiles, each tile is upscaled, then blended.
const CHATGPT_MAX_PIXELS = 1536 * 1024
const MAX_GRID = 4
const TILE_OVERLAP = 0.2
const MIN_TILE_SIDE = 192

export type Tile = { x: number; y: number; width: number; height: number }

/** Split an image into grid x grid tiles that overlap by TILE_OVERLAP of a tile. */
export function planTiles({ width, height, grid }: { width: number; height: number; grid: number }): Tile[] {
  const tileWidth = Math.round(width / (grid - (grid - 1) * TILE_OVERLAP))
  const tileHeight = Math.round(height / (grid - (grid - 1) * TILE_OVERLAP))
  const offsets = (size: number, tile: number) =>
    Array.from({ length: grid }, (_, i) => (grid === 1 ? 0 : Math.round((i * (size - tile)) / (grid - 1))))
  return offsets(height, tileHeight).flatMap((y) =>
    offsets(width, tileWidth).map((x) => ({ x, y, width: tileWidth, height: tileHeight })),
  )
}

/**
 * Smallest grid whose tiles, each returned at `pixelsPerCall`, reach the target
 * width. Stops before tiles get under MIN_TILE_SIDE, where the model sees too
 * little context and invents detail.
 */
export function chooseGrid({
  width,
  height,
  targetWidth,
  pixelsPerCall,
}: {
  width: number
  height: number
  targetWidth: number
  pixelsPerCall: number
}): number {
  let grid = 1
  while (grid < MAX_GRID) {
    const tile = planTiles({ width, height, grid })[0]!
    if (width * Math.sqrt(pixelsPerCall / (tile.width * tile.height)) >= targetWidth) return grid
    const next = planTiles({ width, height, grid: grid + 1 })[0]!
    if (Math.min(next.width, next.height) < MIN_TILE_SIDE) return grid
    grid++
  }
  return grid
}

/**
 * Blend upscaled RGB tiles (output coordinates) into one image. Each tile is
 * matched to the reference (the input resized to the output size) by
 * per-channel mean and standard deviation, which removes the color drift
 * generative models add, then feathered across the overlaps.
 */
export function blendTiles({
  width,
  height,
  reference,
  tiles,
}: {
  width: number
  height: number
  reference: Uint8Array
  tiles: Array<Tile & { pixels: Uint8Array }>
}): Uint8Array {
  const sum = new Float32Array(width * height * 3)
  const weight = new Float32Array(width * height)
  for (const tile of tiles) {
    const count = tile.width * tile.height
    const channelStats = (read: (p: number, c: number) => number) =>
      [0, 1, 2].map((c) => {
        let total = 0
        let squares = 0
        for (let p = 0; p < count; p++) {
          const v = read(p, c)
          total += v
          squares += v * v
        }
        const mean = total / count
        return { mean, std: Math.sqrt(Math.max(1, squares / count - mean * mean)) }
      })
    const target = channelStats((p, c) =>
      reference[((tile.y + Math.floor(p / tile.width)) * width + tile.x + (p % tile.width)) * 3 + c]!,
    )
    const actual = channelStats((p, c) => tile.pixels[p * 3 + c]!)

    // weights ramp to 0 only on sides that overlap a neighbor tile
    const rampX = tile.width * TILE_OVERLAP
    const rampY = tile.height * TILE_OVERLAP
    for (let py = 0; py < tile.height; py++) {
      const top = tile.y > 0 ? py / rampY : 1
      const bottom = tile.y + tile.height < height ? (tile.height - 1 - py) / rampY : 1
      for (let px = 0; px < tile.width; px++) {
        const left = tile.x > 0 ? px / rampX : 1
        const right = tile.x + tile.width < width ? (tile.width - 1 - px) / rampX : 1
        const w = Math.max(1e-4, Math.min(1, top, bottom, left, right))
        const o = (tile.y + py) * width + tile.x + px
        for (let c = 0; c < 3; c++) {
          const v = tile.pixels[(py * tile.width + px) * 3 + c]!
          sum[o * 3 + c]! += (((v - actual[c]!.mean) / actual[c]!.std) * target[c]!.std + target[c]!.mean) * w
        }
        weight[o]! += w
      }
    }
  }
  const out = new Uint8Array(width * height * 3)
  for (let o = 0; o < width * height; o++) {
    for (let c = 0; c < 3; c++) out[o * 3 + c] = Math.max(0, Math.min(255, Math.round(sum[o * 3 + c]! / weight[o]!)))
  }
  return out
}

// sharp and @egaki/midjourney reject with Error instances
const toError = (err: Error) => err

async function readImageSize(bytes: Uint8Array): Promise<ValidationError | { width: number; height: number }> {
  const meta = await sharp(bytes).metadata().catch(toError)
  if (meta instanceof Error) return new ValidationError(`Could not read the image: ${meta.message}`)
  return meta.autoOrient
}

export async function upscaleImageUncached(opts: UpscaleImageOptions): Promise<Error | UpscaleImageResult> {
  const model = opts.model ?? DEFAULT_UPSCALE_MODEL

  if (model === 'midjourney' || model === 'midjourney-creative') {
    if (opts.scale !== undefined && opts.scale !== 2) {
      return new ValidationError('Midjourney only upscales 2x. Remove --scale or pass --scale 2.')
    }
    const input = await readImageSize(opts.image)
    if (input instanceof Error) return input
    return upscaleWithMidjourney({ image: opts.image, model, input, prompt: opts.prompt })
  }

  if (!GPT_UPSCALE_MODELS.includes(model)) {
    return new ValidationError(`Model ${model} cannot upscale. Use one of: ${UPSCALE_MODELS.join(', ')}`)
  }
  return upscaleWithGpt({ image: opts.image, model, scale: opts.scale, extra: opts.prompt })
}

async function upscaleWithGpt(opts: {
  image: Uint8Array
  model: string
  scale?: number
  extra?: string
}): Promise<Error | UpscaleImageResult> {
  const decoded = await sharp(opts.image)
    .autoOrient()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch(toError)
  if (decoded instanceof Error) return new ValidationError(`Could not read the image: ${decoded.message}`)
  const input = { width: decoded.info.width, height: decoded.info.height }
  const raw = { raw: { width: input.width, height: input.height, channels: 3 as const } }

  const size = gptUpscaleSize({ ...input, scale: opts.scale })
  if (size instanceof Error) return size
  // with an API key one call returns the full size; ChatGPT login needs tiles
  const grid = shouldUseChatGptBackend()
    ? chooseGrid({ ...input, targetWidth: size.width, pixelsPerCall: CHATGPT_MAX_PIXELS })
    : 1
  const tiles = planTiles({ ...input, grid })
  const sx = size.width / input.width
  const sy = size.height / input.height
  const extra = grid > 1
    ? ['This image is a crop of a larger image: content continues past every edge, so add no borders or vignettes.', opts.extra].filter(Boolean).join(' ')
    : opts.extra

  const reference = await sharp(decoded.data, raw)
    .resize(size.width, size.height, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer()
  const prompts: string[] = []

  const upscaled = await Promise.all(tiles.map(async (tile) => {
    const x = Math.round(tile.x * sx)
    const y = Math.round(tile.y * sy)
    const box = { x, y, width: Math.round((tile.x + tile.width) * sx) - x, height: Math.round((tile.y + tile.height) * sy) - y }
    const crop = await sharp(decoded.data, raw)
      .extract({ left: tile.x, top: tile.y, width: tile.width, height: tile.height })
      .png()
      .toBuffer()
    const prompt = gptUpscalePrompt({ width: box.width, height: box.height, extra })
    prompts.push(prompt)
    const request = () => generateImageUncached({
      prompt,
      model: opts.model,
      inputImages: [new Uint8Array(crop)],
      // the ChatGPT backend ignores size; only send it when it is a valid API size
      size: grid === 1 ? `${box.width}x${box.height}` : undefined,
      quality: 'high',
    })
    // one retry: with many parallel tiles a single transient failure is likely
    let result = await request()
    if (result instanceof Error && !(result instanceof ValidationError)) result = await request()
    if (result instanceof Error) return result
    const file = result.images[0]
    if (!file) return new Error('GPT Image returned no image.')
    const returned = await sharp(file.uint8Array).metadata().catch(toError)
    if (returned instanceof Error) return returned
    const pixels = await sharp(file.uint8Array)
      .removeAlpha()
      .resize(box.width, box.height, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer()
      .catch(toError)
    if (pixels instanceof Error) return pixels
    return { ...box, pixels, returned: { width: returned.width, height: returned.height }, cost: result.cost }
  }))
  const done: Array<Exclude<(typeof upscaled)[number], Error>> = []
  for (const tile of upscaled) {
    if (tile instanceof Error) return tile
    done.push(tile)
  }

  const pixels = blendTiles({ ...size, reference, tiles: done })
  const png = await sharp(pixels, { raw: { ...size, channels: 3 } }).png().toBuffer()

  const small = done.find((tile) => tile.returned.width * tile.returned.height < tile.width * tile.height * 0.9)
  const costs = done.map((tile) => tile.cost)
  return {
    image: { uint8Array: new Uint8Array(png), mediaType: 'image/png' },
    model: opts.model,
    input,
    output: size,
    tiles: tiles.length,
    prompt: prompts[0],
    warning: small
      ? `GPT Image returned ${small.returned.width}x${small.returned.height} for a ${small.width}x${small.height} tile, so tiles were resized up and look softer.`
      : undefined,
    cost: costs.every((cost) => cost !== null) ? costs.reduce((a, b) => a + b, 0) : null,
  }
}

async function upscaleWithMidjourney(opts: {
  image: Uint8Array
  model: string
  input: { width: number; height: number }
  prompt?: string
}): Promise<Error | UpscaleImageResult> {
  const { Midjourney } = await import('@egaki/midjourney')
  const mj = new Midjourney()
  const result = await mj
    .upscaleImage(Buffer.from(opts.image), {
      type: opts.model === 'midjourney-creative' ? 'v7_2x_creative' : 'v7_2x_subtle',
      prompt: opts.prompt,
    })
    .catch(toError)
  await mj.close().catch(() => {})
  if (result instanceof Error) return result

  return {
    image: { uint8Array: new Uint8Array(result.image), mediaType: 'image/jpeg' },
    model: opts.model,
    input: opts.input,
    output: { width: result.width, height: result.height },
    jobId: result.upscaleJobId,
    cost: null,
  }
}

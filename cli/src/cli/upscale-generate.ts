// Image upscaling for `egaki upscale`. Two kinds of upscalers:
//
//   gpt-image-2*   re-renders the input at a larger custom size with a strict
//                  "same image, more pixels" prompt (ChatGPT OAuth or OpenAI key)
//   midjourney*    registers the image as a midjourney.com editor upload, then
//                  runs Midjourney's 2x subtle or creative upscaler through the
//                  user's Chrome (@egaki/midjourney + Playwriter)
//
// Research on other upscale APIs (fal, Replicate, Topaz, ...): docs/upscale-apis.md

import { imageSize } from 'image-size'
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

function readImageSize(bytes: Uint8Array): ValidationError | { width: number; height: number } {
  const info = (() => {
    try {
      return imageSize(bytes)
    } catch (err) {
      return new ValidationError(`Could not read the image size: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
  if (info instanceof Error) return info
  // EXIF orientations 5-8 rotate the image by 90 degrees
  return (info.orientation ?? 1) >= 5
    ? { width: info.height, height: info.width }
    : { width: info.width, height: info.height }
}

export async function upscaleImageUncached(opts: UpscaleImageOptions): Promise<Error | UpscaleImageResult> {
  const model = opts.model ?? DEFAULT_UPSCALE_MODEL
  const input = readImageSize(opts.image)
  if (input instanceof Error) return input

  if ((MIDJOURNEY_UPSCALE_MODELS as readonly string[]).includes(model)) {
    if (opts.scale !== undefined && opts.scale !== 2) {
      return new ValidationError('Midjourney only upscales 2x. Remove --scale or pass --scale 2.')
    }
    return upscaleWithMidjourney({ image: opts.image, model, input, prompt: opts.prompt })
  }

  if (!GPT_UPSCALE_MODELS.includes(model)) {
    return new ValidationError(`Model ${model} cannot upscale. Use one of: ${UPSCALE_MODELS.join(', ')}`)
  }

  const size = gptUpscaleSize({ width: input.width, height: input.height, scale: opts.scale })
  if (size instanceof Error) return size
  const prompt = gptUpscalePrompt({ ...size, extra: opts.prompt })

  const result = await generateImageUncached({
    prompt,
    model,
    inputImages: [opts.image],
    size: `${size.width}x${size.height}`,
    quality: 'high',
  })
  if (result instanceof Error) return result
  const image = result.images[0]
  if (!image) return new Error('GPT Image returned no image.')

  const output = readImageSize(image.uint8Array)
  if (output instanceof Error) return output
  // The ChatGPT subscription backend ignores `size` and `quality` and returns
  // about 1.6 MP in the input aspect ratio (verified Nov 2026). Say so instead of failing.
  const warning = output.width * output.height < size.width * size.height * 0.9
    ? `Requested ${size.width}x${size.height} but got ${output.width}x${output.height}. ` +
      (shouldUseChatGptBackend()
        ? 'ChatGPT login caps GPT Image output at about 1.6 MP. Set OPENAI_API_KEY for up to 3840px.'
        : 'The provider returned a smaller image.')
    : undefined
  return {
    image,
    model,
    input: { width: input.width, height: input.height },
    output: { width: output.width, height: output.height },
    prompt,
    warning,
    cost: result.cost,
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
    .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
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

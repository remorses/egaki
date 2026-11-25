/**
 * Type definitions for Midjourney API responses.
 * Reverse-engineered from midjourney.com network traffic.
 */

export interface MidjourneyPrompt {
  /** Negative prompt terms */
  no: string[]
  /** Reference image URLs */
  images: string[]
  stop: number | null
  chaos: number | null
  /** Aspect ratio */
  ar: { w: number; h: number } | null
  seed: number | null
  speed: string | null
  visibility: string | null
  batchSize: number | null
  exp: string | null
  /** Standard definition mode */
  sd: boolean
  /** Decoded prompt segments with weights */
  decodedPrompt: { content: string; weight: number }[]
  params: unknown | null
  /** Model version (e.g. "8.1", "7", "6.1") */
  version: string
  quality: number | null
  tile: boolean
  styleRaw: boolean
  styleRef: { content: string; weight: number }[]
  personalize: { content: string; weight: number }[]
  /** Personalization version */
  pv: string | null
  /** Style version */
  sv: string | null
  /** Style weight */
  sw: number | null
  depthRef: { content: string; weight: number }[]
  /** Depth weight */
  dw: number | null
  stylize: number | null
  weird: number | null
  imageWeight: number | null
  video: boolean
  draft: boolean
  /** HD generation */
  hd: boolean
  preview: boolean
  /** Aspect version */
  av: string | null
}

export interface MidjourneyJobItem {
  filtered: boolean
  liked_by_user: boolean
  actions: Record<string, unknown>
  server_filtered: boolean
}

export interface MidjourneyJob {
  isFeedJob: boolean
  /** UUID of the generation job */
  id: string
  /** e.g. "v8-1_hd_diffusion", "v7_diffusion" */
  job_type: string
  event_type: string
  /** Unix millisecond timestamp */
  enqueue_time: number
  parent_grid: string | null
  parent_id: string | null
  width: number
  height: number
  username_v2: string
  display_name: string
  /** UUID of the creator */
  user_id: string
  prompt: MidjourneyPrompt
  published: boolean
  /** Grid items (typically 4 per generation) */
  items: MidjourneyJobItem[]
  owner_profile: unknown | null
  type: 'image' | 'video'
  video_segments: unknown | null
}

export interface MidjourneySearchOptions {
  /** Page number, 1-indexed. Default: 1 */
  page?: number
  /**
   * Filter results by aspect ratio tolerance. Only jobs whose width/height
   * ratio is within this tolerance of the target ratio are returned.
   * Format: "16:9", "1:1", "2:3", etc.
   */
  aspectRatio?: string
  /**
   * How close a job's aspect ratio must be to the target to pass the filter.
   * Default: 0.1 (10% tolerance). Lower values are stricter.
   */
  aspectRatioTolerance?: number
}

// ---------------------------------------------------------------------------
// Submit-jobs request/response types (reverse-engineered from /api/submit-jobs)
// ---------------------------------------------------------------------------

/** Response item from /api/submit-jobs for a successfully submitted job. */
export interface SubmitJobResult {
  job_id: string
  prompt: string
  is_queued: boolean
  softban: boolean
  event_type: string
  job_type: string
  flags: { mode: string; visibility: string }
  meta: {
    height: number
    width: number
    batch_size: number
    parent_id: string | null
    parent_grid: number | null
  }
  optimisticJobIndex: number
  personalization_codes: { code: string; type: string; user_id: string }[] | null
}

/** Full response from /api/submit-jobs. */
export interface SubmitJobsResponse {
  success: SubmitJobResult[]
  failure: unknown[]
}

/** Job status returned by POST /api/job-status. */
export interface JobStatus {
  id: string
  job_type: string
  event_type: string
  full_command: string
  enqueue_time: string
  width: number
  height: number
  batch_size: number
  published: boolean
  liked_by_user: boolean
  user_id: string
  current_status: 'completed' | 'running' | 'queued' | 'failed' | 'cancelled' | string
  /** Frame counts for video jobs, null for images. */
  video_segments: number[] | null
  display_name: string
  username_v2: string
  parent_grid: number | null
  parent_id: string | null
}

/** Response from POST /api/storage-upload-file. */
export interface UploadFileResponse {
  shortUrl: string
  bucketPathname: string
}

/** An uploaded file from GET /api/storage. */
export interface StorageFile {
  state: string
  bucketPathname: string
  shortUrl: string | null
  timeCreated: number
  hidden: boolean
  cleanedContentType: string
  optimisticId?: string
}

// ---------------------------------------------------------------------------
// Generation option types
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /**
   * Generation speed mode. `"fast"` uses GPU-hours from your plan,
   * `"relax"` is unlimited but queued (Standard+ plans), `"turbo"`
   * is fastest but costs 2x fast hours. Default: `"fast"`.
   */
  mode?: 'fast' | 'relax' | 'turbo'
  /** If true, the generation is only visible to you. Requires Pro plan. */
  private?: boolean
  /**
   * Model version. `"7"` is the latest diffusion model. `"8.1"` is
   * the HD model. Older versions: `"6.1"`, `"6"`, `"5.2"`.
   * Omit to use the account's default version.
   */
  version?: string
  /**
   * Aspect ratio as `"W:H"`. Common values: `"1:1"` (square),
   * `"16:9"` (widescreen), `"9:16"` (portrait/vertical),
   * `"4:3"`, `"3:2"`, `"2:3"`, `"4:5"`, `"5:4"`, `"21:9"` (ultrawide).
   * Midjourney accepts any integer ratio.
   */
  aspectRatio?: string
  /**
   * Image prompt URL. The image influences the composition and content of
   * the generation. Can be any publicly accessible URL; does not need to be
   * on Midjourney's CDN. Midjourney's server fetches the URL, so it must
   * not block non-browser user agents (e.g. Wikipedia returns 403).
   * For guaranteed reliability, upload first with `uploadFile()`.
   */
  imagePrompt?: string
  /**
   * Style reference URLs (`--sref`). Midjourney copies the visual style
   * (colors, texture, mood) from these images. Any public URL works.
   * Multiple URLs can be provided; they blend together.
   */
  styleRef?: string[]
  /**
   * Character reference URLs (`--oref`). Maintains consistent character
   * appearance across generations. Provide an image of the character you
   * want to keep consistent. Any public URL works.
   */
  characterRef?: string[]
  /**
   * Stylization amount (`--s`). Controls how strongly MJ applies its own
   * artistic style. Range: 0-1000. Default: 100. Lower values are more
   * literal to the prompt, higher values are more artistic.
   */
  stylize?: number
  /**
   * Weirdness (`--w`). Introduces unexpected, experimental qualities.
   * Range: 0-3000. Default: 0. Higher values produce stranger results.
   */
  weird?: number
  /** Seed for reproducible results. Same seed + same prompt = similar output. */
  seed?: number
  /**
   * Chaos (`--chaos`). Controls variation between the 4 grid images.
   * Range: 0-100. Default: 0. Higher values produce more diverse grids.
   */
  chaos?: number
}

export interface GenerateVideoOptions {
  /** Generation speed mode. Default: `"fast"`. See {@link GenerateOptions.mode}. */
  mode?: 'fast' | 'relax' | 'turbo'
  /** If true, the generation is only visible to you. Requires Pro plan. */
  private?: boolean
  /**
   * Image URL for the starting frame. This is the first frame of the video;
   * Midjourney animates from this image. Any public URL works, or upload
   * first with `uploadFile()` for guaranteed reliability.
   */
  startingFrame?: string
  /**
   * Image URL for the ending frame. Combined with `startingFrame`, MJ
   * creates a video that transitions from start to end. Any public URL
   * works. Mutually exclusive with `loop` (loop takes priority).
   */
  endingFrame?: string
  /**
   * `"manual"` = you provide starting/ending frames and MJ animates between
   * them. `"auto"` = MJ decides the motion from just the prompt text.
   * Default: `"manual"` when `startingFrame` or `endingFrame` is set,
   * `"auto"` when neither is provided.
   */
  animateMode?: 'manual' | 'auto'
  /**
   * If true, appends `--end loop` so the video loops seamlessly
   * (last frame connects back to first frame). Takes priority over
   * `endingFrame` if both are set.
   */
  loop?: boolean
  /** Aspect ratio as `"W:H"`. See {@link GenerateOptions.aspectRatio}. */
  aspectRatio?: string
}

export interface UpscaleOptions {
  /** Generation speed mode. Default: `"fast"`. */
  mode?: 'fast' | 'relax' | 'turbo'
  /** If true, the generation is only visible to you. Requires Pro plan. */
  private?: boolean
  /**
   * Upscale algorithm. `"v7_2x_subtle"` preserves the original closely.
   * `"v7_2x_creative"` adds new detail and may reinterpret parts of the
   * image. Default: `"v7_2x_subtle"`.
   */
  type?: 'v7_2x_subtle' | 'v7_2x_creative' | 'v8r2_2x_subtle' | 'v8r2_2x_creative'
}

export interface UpscaleImageOptions extends UpscaleOptions {
  /**
   * Prompt stored with the uploaded image job. Midjourney rejects empty
   * prompts. Creative upscales follow it, subtle upscales mostly ignore it.
   */
  prompt?: string
  /** Max milliseconds to wait for each job. Default: 600000 (10 min). */
  timeout?: number
}

export interface UpscaleImageResult {
  image: Buffer
  width: number
  height: number
  /** Job that registered the uploaded image. */
  uploadJobId: string
  /** Upscale job. Its CDN URL is `getImageUrl(upscaleJobId, 0)`. */
  upscaleJobId: string
}

export interface PanOptions {
  /** Generation speed mode. Default: `"fast"`. */
  mode?: 'fast' | 'relax' | 'turbo'
  /** If true, the generation is only visible to you. Requires Pro plan. */
  private?: boolean
  /**
   * How far to extend the image in the pan direction. Range: 0-1.
   * Default: 0.5 (extends by half the image dimension).
   */
  fraction?: number
  /**
   * Whether to smoothly blend the new content with the original edge.
   * Default: true. Set false for a hard transition.
   */
  stitch?: boolean
  /**
   * Override the prompt for the outpainted region. If omitted, the
   * original job's prompt is used.
   */
  newPrompt?: string
}

/** Simplified search result stored in the JSON cache. */
export interface CachedSearchResult {
  /** CDN URL for the image */
  url: string
  /** The original prompt text */
  prompt: string
  width: number
  height: number
  /** Creator's display name */
  username: string
  /** Model version (e.g. "8.1") */
  version: string
  /** Original job ID */
  jobId: string
}

/** Convert a full MidjourneyJob to a simplified CachedSearchResult. */
export function simplifyJob(job: MidjourneyJob, gridIndex = 0): CachedSearchResult {
  return {
    url: getImageUrl(job, gridIndex),
    prompt: getPromptText(job),
    width: job.width,
    height: job.height,
    username: job.display_name,
    version: job.prompt.version,
    jobId: job.id,
  }
}

/** Parse an aspect ratio string like "16:9" into a numeric ratio. */
export function parseAspectRatio(ar: string): number | null {
  const parts = ar.split(':')
  if (parts.length !== 2) return null
  const w = Number(parts[0])
  const h = Number(parts[1])
  if (!w || !h) return null
  return w / h
}

/** Filter jobs by aspect ratio tolerance. */
export function filterByAspectRatio(options: {
  jobs: MidjourneyJob[]
  aspectRatio: string
  tolerance?: number
}): MidjourneyJob[] {
  const { jobs, aspectRatio, tolerance = 0.1 } = options
  const target = parseAspectRatio(aspectRatio)
  if (!target) return jobs
  return jobs.filter((job) => {
    const ratio = job.width / job.height
    return Math.abs(ratio - target) / target <= tolerance
  })
}

/**
 * Constructs the full-res CDN URL for a Midjourney job image.
 *
 * Accepts either a `MidjourneyJob` object or a plain job ID string.
 *
 * Midjourney CDN URL patterns (reverse-engineered from their website):
 *   Full-res:   `https://cdn.midjourney.com/<id>/0_N.jpeg`  (job detail page)
 *   Thumbnail:  `https://cdn.midjourney.com/<id>/0_N_384_N.webp` (~17KB, 384px wide)
 *   Full webp:  `https://cdn.midjourney.com/<id>/0_N.webp`  (full-res as webp)
 *
 * N is the grid index (0-3 for a 4-image grid).
 */
export function getImageUrl(jobOrId: MidjourneyJob | string, gridIndex = 0): string {
  const id = typeof jobOrId === 'string' ? jobOrId : jobOrId.id
  return `https://cdn.midjourney.com/${id}/0_${gridIndex}.jpeg`
}

/**
 * Constructs a smaller webp preview URL.
 *
 * Accepts either a `MidjourneyJob` object or a plain job ID string.
 *
 * Midjourney CDN supports these widths: 384, 640, 1024, 2048.
 * Default is 1024 (~76KB vs ~5MB for the original).
 */
export function getPreviewUrl(jobOrId: MidjourneyJob | string, gridIndex = 0, width = 1024): string {
  const id = typeof jobOrId === 'string' ? jobOrId : jobOrId.id
  return `https://cdn.midjourney.com/${id}/0_${gridIndex}_${width}_N.webp`
}

/**
 * Derives a smaller preview URL from a full-res CDN URL.
 * `/0_0.jpeg` or `/0_0.png` -> `/0_0_1024_N.webp`
 *
 * Supported widths: 384, 640, 1024, 2048.
 */
export function toPreviewUrl(fullUrl: string, width = 1024): string {
  return fullUrl.replace(/\/0_(\d+)\.(jpeg|png|webp)$/, `/0_$1_${width}_N.webp`)
}

/**
 * Extracts the full decoded prompt text from a job.
 */
export function getPromptText(job: MidjourneyJob): string {
  return job.prompt.decodedPrompt.map((s) => s.content).join(' ')
}

// ---------------------------------------------------------------------------
// Video CDN URL helpers
// ---------------------------------------------------------------------------

/**
 * Constructs the video CDN URL for a completed video job.
 *
 * Video URLs use a different path from images:
 *   `https://cdn.midjourney.com/video/{jobId}/{gridIndex}.mp4`
 */
export function getVideoUrl(jobId: string, gridIndex = 0): string {
  return `https://cdn.midjourney.com/video/${jobId}/${gridIndex}.mp4`
}

/**
 * Constructs a video thumbnail (last frame) URL.
 *
 * Pattern: `https://cdn.midjourney.com/video/{jobId}/{gridIndex}_640_N.webp?frame=last`
 */
export function getVideoThumbnailUrl(jobId: string, gridIndex = 0, width = 640): string {
  return `https://cdn.midjourney.com/video/${jobId}/${gridIndex}_${width}_N.webp?frame=last`
}

// ---------------------------------------------------------------------------
// Editor frame size
// ---------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b]
  return a
}

/**
 * Frame size Midjourney v7 requires for an uploaded image with this aspect
 * ratio. Port of the website's editor function (T8 + U5 + R6 in the bundle):
 * scale the short side to 1024, then pick the 16px grid size under 1.22 MP
 * closest in area and ratio. `/api/submit-jobs` rejects any other frame with
 * "Invalid frame dimensions given for aspect ratio. Should be WxH".
 */
export function midjourneyFrameSize(width: number, height: number): { width: number; height: number } {
  const divisor = gcd(width, height)
  const w = width / divisor
  const h = height / divisor
  const ratio = Math.max(w, h) / Math.min(w, h)
  const long = (Math.floor(1024 * ratio) + 8) & ~15
  const target = w > h ? { width: long, height: 1024 } : { width: 1024, height: long }

  const shape = target.height > target.width ? (a: number, b: number) => a / b : (a: number, b: number) => b / a
  const targetArea = target.width * target.height
  const targetShape = shape(target.width, target.height)
  let best = { width: 1024, height: 1024 }
  let bestScore = Infinity
  for (let m = 1; m <= 256; m++) {
    for (let f = 1; f <= 256; f++) {
      const cw = m * 16
      const ch = f * 16
      const area = cw * ch
      if (area > 1.22e6) continue
      const score = Math.abs(area - targetArea) / 1e6 + Math.abs(shape(cw, ch) - targetShape) * 16
      if (score < bestScore) {
        bestScore = score
        best = { width: cw, height: ch }
      }
    }
  }
  // the site maps these three near-4:3 results to one size
  const key = `${best.width}x${best.height}`
  if (key === '1328x912' || key === '1312x896' || key === '1328x896') return { width: 1312, height: 912 }
  return best
}

/** Reduce a frame size to the `--ar W:H` value Midjourney expects for it. */
export function frameAspectRatio(frame: { width: number; height: number }): string {
  const divisor = gcd(frame.width, frame.height)
  return `${frame.width / divisor}:${frame.height / divisor}`
}

/** Maps direction names to the numeric codes used by /api/submit-jobs. */
export const PAN_DIRECTION_MAP = {
  up: 0,
  right: 1,
  down: 2,
  left: 3,
} as const

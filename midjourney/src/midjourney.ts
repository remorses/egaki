/**
 * Midjourney SDK — controls midjourney.com through the user's browser via Playwriter.
 *
 * Requires:
 * 1. Chrome with the Playwriter extension installed and enabled
 * 2. The Playwriter relay server running (starts automatically or via `playwriter serve`)
 * 3. The user logged into midjourney.com in Chrome
 *
 * All API calls happen inside page.evaluate() so the browser's session cookies
 * are used automatically. No tokens or API keys needed.
 */

import { chromium, type Browser, type Page } from '@xmorse/playwright-core'
import type {
  MidjourneyJob,
  MidjourneySearchOptions,
  SubmitJobResult,
  SubmitJobsResponse,
  JobStatus,
  UploadFileResponse,
  StorageFile,
  GenerateOptions,
  GenerateVideoOptions,
  UpscaleOptions,
  PanOptions,
} from './types.ts'
import { filterByAspectRatio, PAN_DIRECTION_MAP } from './types.ts'

export class MidjourneySoftbanError extends Error {
  constructor(public jobId: string) {
    super(`Midjourney softbanned the prompt (job ${jobId}). The prompt may violate content policy.`)
    this.name = 'MidjourneySoftbanError'
  }
}

export class MidjourneyNotLoggedInError extends Error {
  constructor(
    public status?: number,
    public responseBody?: string,
  ) {
    const detail = responseBody ? `: ${responseBody}` : ''
    super(
      `Not logged in to Midjourney (${status ?? 'unknown'}${detail}). Open https://www.midjourney.com in Chrome and log in, then enable the Playwriter extension on that tab.`,
    )
    this.name = 'MidjourneyNotLoggedInError'
  }
}

export class MidjourneyConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MidjourneyConnectionError'
  }
}

const MIDJOURNEY_ORIGIN = 'https://www.midjourney.com'

/** Extract the first successful job from a submit response, checking for failures and softbans. */
function firstSubmittedJob(response: SubmitJobsResponse, label: string): SubmitJobResult {
  if (response.failure.length) {
    throw new Error(`Midjourney ${label} failed: ${JSON.stringify(response.failure)}`)
  }
  const job = response.success[0]
  if (!job) {
    throw new Error(`Midjourney ${label} returned no jobs`)
  }
  if (job.softban) {
    throw new MidjourneySoftbanError(job.job_id)
  }
  return job
}

type ApiResult =
  | { ok: false; error: 'not_logged_in'; status: number; body?: string }
  | { ok: false; error: 'request_failed'; status: number; statusText: string; body?: string }
  | { ok: true; data: unknown }

export interface MidjourneyOptions {
  /**
   * Playwriter relay server port. Default: 19988
   */
  port?: number
  /**
   * Playwriter relay server host. Default: '127.0.0.1'
   */
  host?: string
}

export class Midjourney {
  private browser: Browser | null = null
  private page: Page | null = null
  private userId: string | null = null
  private port: number
  private host: string

  constructor(options: MidjourneyOptions = {}) {
    this.port = options.port ?? 19988
    this.host = options.host ?? '127.0.0.1'
  }

  /**
   * Connects to Chrome via Playwriter's CDP relay, finds or creates a
   * midjourney.com tab, and returns the Page handle.
   *
   * Idempotent: subsequent calls reuse the existing connection if still alive.
   */
  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page
    }

    // Connect to the Playwriter relay. If not running, this will throw with a
    // clear connection-refused error. The user should start it with `playwriter serve`
    // or the CLI will auto-start it.
    try {
      const id = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
      const cdpUrl = `ws://${this.host}:${this.port}/cdp/${id}`
      this.browser = await chromium.connectOverCDP(cdpUrl)
    } catch (err) {
      throw new MidjourneyConnectionError(
        `Could not connect to Playwriter relay at ${this.host}:${this.port}. ` +
          'Make sure Chrome is open with the Playwriter extension enabled. ' +
          'Run `playwriter serve` or `playwriter session new` to start the relay.',
        { cause: err },
      )
    }

    const context = this.browser.contexts()[0]
    if (!context) {
      throw new MidjourneyConnectionError(
        'No browser context found. Make sure the Playwriter extension is enabled on at least one tab.',
      )
    }

    // Look for an existing midjourney.com tab
    const pages = context.pages()
    let mjPage = pages.find((p) => p.url().startsWith(MIDJOURNEY_ORIGIN))

    if (!mjPage) {
      // Create a new tab and navigate to Midjourney
      mjPage = await context.newPage()
      await mjPage.goto(MIDJOURNEY_ORIGIN, { waitUntil: 'domcontentloaded' })
    }

    this.page = mjPage
    return mjPage
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Execute a GET or POST fetch inside the browser and handle auth errors.
   * All Midjourney API calls go through this so error handling is consistent.
   */
  private async apiFetch(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<unknown> {
    const page = await this.ensurePage()
    const method = options.method ?? 'GET'
    const bodyStr = options.body != null ? JSON.stringify(options.body) : undefined

    const result: ApiResult = await page.evaluate(
      async ({ path, method, bodyStr }) => {
        const fetchOpts: RequestInit = {
          method,
          credentials: 'include',
          headers: {
            'x-csrf-protection': '1',
            ...(bodyStr ? { 'content-type': 'application/json' } : {}),
          },
        }
        if (bodyStr) fetchOpts.body = bodyStr

        const res = await fetch(path, fetchOpts)

        const body = !res.ok ? await res.text().catch(() => '') : undefined

        if (res.status === 401 || res.status === 403) {
          return { ok: false as const, error: 'not_logged_in' as const, status: res.status, body }
        }

        if (!res.ok) {
          return {
            ok: false as const,
            error: 'request_failed' as const,
            status: res.status,
            statusText: res.statusText,
            body,
          }
        }

        const data = await res.json()
        return { ok: true as const, data }
      },
      { path, method, bodyStr },
    )

    if (!result.ok) {
      if (result.error === 'not_logged_in') {
        throw new MidjourneyNotLoggedInError(result.status, result.body)
      }
      const detail = result.body ? `: ${result.body}` : ''
      throw new Error(`Midjourney API error ${result.status} ${result.statusText}${detail}`)
    }

    return result.data
  }

  /**
   * Resolves the logged-in user's ID from the page cookies / local storage.
   * The user ID is needed for the singleplayer channel prefix.
   */
  async getUserId(): Promise<string> {
    if (this.userId) return this.userId

    const page = await this.ensurePage()
    const uid: string | null = await page.evaluate(() => {
      // Midjourney stores user_id in a cookie or in the app's JS state.
      // The channelId format is "singleplayer_{userId}".
      // We can extract it from the __user cookie or from the page's fetch interceptor.
      const match = document.cookie.match(/__user=([^;]+)/)
      if (match) return match[1]
      // Fallback: check local storage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!
        if (key.includes('user')) {
          try {
            const val = JSON.parse(localStorage.getItem(key)!)
            if (val?.user_id) return val.user_id
          } catch {}
        }
      }
      return null
    })

    if (!uid) {
      // Last resort: call the user-account endpoint
      const account = (await this.apiFetch('/api/user-account')) as {
        user?: { mjId?: string; user_id?: string; id?: string }
        user_id?: string
        id?: string
      }
      const resolvedId = account.user?.mjId || account.user?.user_id || account.user?.id || account.user_id || account.id
      if (!resolvedId) {
        throw new MidjourneyNotLoggedInError()
      }
      this.userId = resolvedId
      return resolvedId
    }

    this.userId = uid
    return uid
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /**
   * Search the Midjourney explore feed with a text prompt.
   * Uses the same vector search endpoint as the website's explore page.
   *
   * Returns an array of jobs (typically 49 per page).
   */
  async search(prompt: string, options: MidjourneySearchOptions = {}): Promise<MidjourneyJob[]> {
    const pageNum = options.page ?? 1
    const data = await this.apiFetch(
      `/api/explore-vector-search?prompt=${encodeURIComponent(prompt)}&page=${pageNum}&_ql=explore`,
    )
    let jobs = data as MidjourneyJob[]

    if (options.aspectRatio) {
      jobs = filterByAspectRatio({ jobs, aspectRatio: options.aspectRatio, tolerance: options.aspectRatioTolerance })
    }

    return jobs
  }

  /**
   * Generate images from a text prompt.
   *
   * Submits a generation job that produces a 4-image grid. The returned
   * `SubmitJobResult` contains `job_id` for tracking and `meta` with the
   * output dimensions. Use `waitForJob(result.job_id)` to poll until
   * completion, then `getImageUrl({ id: result.job_id }, gridIndex)` to
   * get individual image CDN URLs (gridIndex 0-3).
   *
   * Image prompt URLs, style refs, and character refs accept any publicly
   * accessible URL. Midjourney's server fetches them, so the URL must not
   * block non-browser user agents. For guaranteed reliability, upload first
   * with `uploadFile()` and use the returned `shortUrl`.
   *
   * @example
   * ```ts
   * const result = await mj.generate('a sunset over mountains', {
   *   aspectRatio: '16:9',
   *   version: '7',
   *   styleRef: ['https://example.com/style.jpg'],
   * })
   * const completed = await mj.waitForJob(result.job_id)
   * const url = getImageUrl(result.job_id, 0)
   * ```
   */
  async generate(prompt: string, options: GenerateOptions = {}): Promise<SubmitJobResult> {
    const userId = await this.getUserId()

    // Build the prompt string with flags
    let fullPrompt = prompt
    if (options.aspectRatio) fullPrompt += ` --ar ${options.aspectRatio}`
    if (options.version) fullPrompt += ` --v ${options.version}`
    if (options.stylize != null) fullPrompt += ` --s ${options.stylize}`
    if (options.weird != null) fullPrompt += ` --w ${options.weird}`
    if (options.seed != null) fullPrompt += ` --seed ${options.seed}`
    if (options.chaos != null) fullPrompt += ` --chaos ${options.chaos}`
    if (options.styleRef?.length) {
      fullPrompt += ` --sref ${options.styleRef.join(' ')}`
    }
    if (options.characterRef?.length) {
      fullPrompt += ` --oref ${options.characterRef.join(' ')}`
    }

    // Prepend image prompt URL if provided
    if (options.imagePrompt) {
      fullPrompt = `${options.imagePrompt} ${fullPrompt}`
    }

    const body = {
      f: { mode: options.mode ?? 'fast', private: options.private ?? false },
      channelId: `singleplayer_${userId}`,
      metadata: {
        isMobile: null,
        imagePrompts: options.imagePrompt ? 1 : 0,
        imageReferences: options.styleRef?.length ?? 0,
        characterReferences: options.characterRef?.length ?? 0,
        depthReferences: 0,
        lightboxOpen: null,
      },
      t: 'imagine',
      prompt: fullPrompt,
    }

    const response = (await this.apiFetch('/api/submit-jobs', {
      method: 'POST',
      body,
    })) as SubmitJobsResponse

    return firstSubmittedJob(response, 'generation')
  }

  /**
   * Generate a video from a text prompt.
   *
   * Produces a 4-video grid. For image-to-video, provide `startingFrame`
   * with a public image URL (or upload first with `uploadFile()`). Use
   * `waitForJob()` to poll until completion, then `getVideoUrl(job_id, gridIndex)`
   * to get the MP4 CDN URL.
   *
   * Video generation takes significantly longer than images (2-5 minutes).
   * Set a higher timeout in `waitForJob()` if needed.
   *
   * @example
   * ```ts
   * const upload = await mj.uploadFile(imageBuffer, 'frame.png')
   * const result = await mj.generateVideo('gentle camera pan', {
   *   startingFrame: upload.shortUrl,
   *   loop: true,
   * })
   * const completed = await mj.waitForJob(result.job_id, { timeout: 600_000 })
   * const videoUrl = getVideoUrl(result.job_id, 0)
   * ```
   */
  async generateVideo(prompt: string, options: GenerateVideoOptions = {}): Promise<SubmitJobResult> {
    const userId = await this.getUserId()

    // Build the prompt
    let fullPrompt = prompt
    if (options.aspectRatio) fullPrompt += ` --ar ${options.aspectRatio}`
    fullPrompt += ' --video 1'

    // Ending frame: either "loop" for seamless looping, or a URL for a specific end frame.
    // --end is appended to the prompt string (discovered from MJ source: v5(Q, "end", w.endingFrame)).
    if (options.loop) {
      fullPrompt += ' --end loop'
    } else if (options.endingFrame) {
      fullPrompt += ` --end ${options.endingFrame}`
    }

    // Prepend starting frame URL if provided
    if (options.startingFrame) {
      fullPrompt = `${options.startingFrame} ${fullPrompt}`
    }

    // Default animateMode: "manual" when frames are provided, "auto" for prompt-only video
    const hasFrames = Boolean(options.startingFrame || options.endingFrame)
    const animateMode = options.animateMode ?? (hasFrames ? 'manual' : 'auto')

    const body: Record<string, unknown> = {
      f: { mode: options.mode ?? 'fast', private: options.private ?? false },
      channelId: `singleplayer_${userId}`,
      metadata: {
        isMobile: null,
        imagePrompts: null,
        imageReferences: null,
        characterReferences: null,
        depthReferences: null,
        lightboxOpen: null,
      },
      t: 'video',
      videoType: 'vid_1.1_i2v_start_end_480',
      newPrompt: fullPrompt,
      parentJob: null,
      animateMode,
    }

    const response = (await this.apiFetch('/api/submit-jobs', {
      method: 'POST',
      body,
    })) as SubmitJobsResponse

    return firstSubmittedJob(response, 'video generation')
  }

  /**
   * Upscale a specific grid image from a completed job.
   *
   * @param jobId - The parent job's ID.
   * @param gridIndex - Which image in the grid to upscale (0-3).
   * @param options - Upscale type and mode.
   */
  async upscale(jobId: string, gridIndex: number, options: UpscaleOptions = {}): Promise<SubmitJobResult> {
    const userId = await this.getUserId()

    const body = {
      f: { mode: options.mode ?? 'fast', private: options.private ?? false },
      channelId: `singleplayer_${userId}`,
      metadata: {
        isMobile: null,
        imagePrompts: null,
        imageReferences: null,
        characterReferences: null,
        depthReferences: null,
        lightboxOpen: null,
      },
      t: 'upscale',
      type: options.type ?? 'v7_2x_subtle',
      id: jobId,
      index: gridIndex,
    }

    const response = (await this.apiFetch('/api/submit-jobs', {
      method: 'POST',
      body,
    })) as SubmitJobsResponse

    return firstSubmittedJob(response, 'upscale')
  }

  /**
   * Pan (outpaint) a specific grid image in a direction.
   *
   * @param jobId - The parent job's ID.
   * @param gridIndex - Which image in the grid to pan (0-3).
   * @param direction - Direction to pan: 'up', 'down', 'left', 'right'.
   * @param options - Pan fraction, stitch, and prompt override.
   */
  async pan(
    jobId: string,
    gridIndex: number,
    direction: 'up' | 'down' | 'left' | 'right',
    options: PanOptions = {},
  ): Promise<SubmitJobResult> {
    const userId = await this.getUserId()

    const body: Record<string, unknown> = {
      f: { mode: options.mode ?? 'fast', private: options.private ?? false },
      channelId: `singleplayer_${userId}`,
      metadata: {
        isMobile: null,
        imagePrompts: null,
        imageReferences: null,
        characterReferences: null,
        depthReferences: null,
        lightboxOpen: null,
      },
      t: 'pan',
      direction: PAN_DIRECTION_MAP[direction],
      fraction: options.fraction ?? 0.5,
      stitch: options.stitch ?? true,
      id: jobId,
      index: gridIndex,
    }

    if (options.newPrompt) {
      body.newPrompt = options.newPrompt
    }

    const response = (await this.apiFetch('/api/submit-jobs', {
      method: 'POST',
      body,
    })) as SubmitJobsResponse

    return firstSubmittedJob(response, 'pan')
  }

  /**
   * Upload an image file to Midjourney's storage.
   *
   * Returns `{ shortUrl, bucketPathname }`. The `shortUrl` (e.g. `https://s.mj.run/xxx`)
   * can be used as `imagePrompt`, `startingFrame`, `styleRef`, or `characterRef`
   * in generation calls. The full CDN URL is
   * `https://cdn.midjourney.com/u/{bucketPathname}`.
   *
   * Note: uploading is only necessary when you want to guarantee the image
   * is accessible. Any publicly accessible URL works directly in prompts;
   * Midjourney's server fetches the URL. Upload is required for local files
   * or URLs behind authentication.
   *
   * @param fileBuffer - Image file contents as a Buffer.
   * @param filename - Filename with extension. Extension determines MIME type:
   *   `.png` = `image/png`, `.webp` = `image/webp`, anything else = `image/jpeg`.
   */
  async uploadFile(fileBuffer: Buffer, filename: string): Promise<UploadFileResponse> {
    const page = await this.ensurePage()

    // Convert Buffer to base64 so we can pass it into page.evaluate
    const base64 = fileBuffer.toString('base64')
    const contentType = filename.endsWith('.png')
      ? 'image/png'
      : filename.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg'

    const result: ApiResult = await page.evaluate(
      async ({ base64, filename, contentType }) => {
        // Convert base64 back to binary
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: contentType })

        const formData = new FormData()
        formData.append('file', blob, filename)

        const res = await fetch('/api/storage-upload-file', {
          method: 'POST',
          credentials: 'include',
          headers: { 'x-csrf-protection': '1' },
          body: formData,
        })

        const body = !res.ok ? await res.text().catch(() => '') : undefined

        if (res.status === 401 || res.status === 403) {
          return { ok: false as const, error: 'not_logged_in' as const, status: res.status, body }
        }

        if (!res.ok) {
          return {
            ok: false as const,
            error: 'request_failed' as const,
            status: res.status,
            statusText: res.statusText,
            body,
          }
        }

        return { ok: true as const, data: await res.json() }
      },
      { base64, filename, contentType },
    )

    if (!result.ok) {
      if (result.error === 'not_logged_in') throw new MidjourneyNotLoggedInError(result.status, result.body)
      const detail = result.body ? `: ${result.body}` : ''
      throw new Error(`Upload failed ${result.status} ${result.statusText}${detail}`)
    }

    return result.data as UploadFileResponse
  }

  /**
   * Get the status of one or more jobs.
   *
   * POST /api/job-status with `{ jobIds: [...] }`.
   */
  async getJobStatus(jobIds: string[]): Promise<JobStatus[]> {
    return (await this.apiFetch('/api/job-status', {
      method: 'POST',
      // the site rejects job-status requests without _frontend_source (400 Invalid request)
      body: { jobIds, _frontend_source: 'useJobSubmitter_fetchJobStatus' },
    })) as JobStatus[]
  }

  /**
   * Poll for a job until it reaches a terminal status (completed/failed/cancelled).
   *
   * @param jobId - The job to wait for.
   * @param options.pollInterval - Milliseconds between polls. Default: 3000 (3s).
   * @param options.timeout - Max milliseconds to wait. Default: 300000 (5min).
   */
  async waitForJob(
    jobId: string,
    options: { pollInterval?: number; timeout?: number } = {},
  ): Promise<JobStatus> {
    const pollInterval = options.pollInterval ?? 3000
    const timeout = options.timeout ?? 300_000
    const start = Date.now()

    while (true) {
      const [status] = await this.getJobStatus([jobId])
      if (!status) {
        throw new Error(`Job ${jobId} not found`)
      }

      if (status.current_status === 'completed' || status.current_status === 'failed' || status.current_status === 'cancelled') {
        return status
      }

      if (Date.now() - start > timeout) {
        throw new Error(`Timed out waiting for job ${jobId} after ${timeout}ms (last status: ${status.current_status})`)
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }
  }

  /**
   * List the user's uploaded storage files.
   *
   * GET /api/storage — returns all uploaded images.
   */
  async getStorage(): Promise<StorageFile[]> {
    return (await this.apiFetch('/api/storage')) as StorageFile[]
  }

  /**
   * Disconnect from Chrome. Does NOT close the browser or any tabs,
   * only drops the CDP connection.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.page = null
    }
  }
}

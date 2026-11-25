/**
 * @egaki/midjourney — Midjourney SDK using Playwriter browser automation.
 *
 * Controls midjourney.com through the user's authenticated Chrome session.
 * All API calls run inside page.evaluate() so cookies are sent automatically.
 *
 * Requirements:
 * - Chrome with the Playwriter extension installed and enabled
 * - Playwriter relay server running (`playwriter serve`)
 * - User logged into midjourney.com
 */

export { Midjourney, MidjourneyNotLoggedInError, MidjourneyConnectionError, MidjourneySoftbanError } from './midjourney.ts'
export type { MidjourneyOptions } from './midjourney.ts'

export {
  getImageUrl,
  getPreviewUrl,
  toPreviewUrl,
  getPromptText,
  simplifyJob,
  parseAspectRatio,
  filterByAspectRatio,
  getVideoUrl,
  getVideoThumbnailUrl,
  midjourneyFrameSize,
  frameAspectRatio,
  PAN_DIRECTION_MAP,
} from './types.ts'
export type {
  MidjourneyJob,
  MidjourneyJobItem,
  MidjourneyPrompt,
  MidjourneySearchOptions,
  CachedSearchResult,
  SubmitJobResult,
  SubmitJobsResponse,
  JobStatus,
  UploadFileResponse,
  StorageFile,
  GenerateOptions,
  GenerateVideoOptions,
  UpscaleOptions,
  UpscaleImageOptions,
  UpscaleImageResult,
  PanOptions,
} from './types.ts'

// Single source of truth for video generation models.
// Stores provider, strategy, capabilities, and duration-based pricing metadata.
// Gateway billing uses this catalog to estimate per-request video cost.

export type VideoDurationPricingTier = {
  /** USD per second for this variant */
  costPerSecond: number
  /** Optional resolution discriminator (e.g. 720p, 1080p, 4k) */
  resolution?: string
  /** Optional mode discriminator (e.g. std, pro) */
  mode?: string
  /** Optional audio discriminator */
  audio?: boolean
}

export type PerVideoSecondCost = {
  type: 'per-video-second'
  /** Fallback duration when request does not specify one (seconds) */
  defaultDurationSec: number
  tiers: VideoDurationPricingTier[]
}

export type UnknownVideoCost = {
  type: 'unknown'
}

export type VideoModelCost = PerVideoSecondCost | UnknownVideoCost

export type VideoModelFeatures = {
  /** Supports text prompt to video generation */
  textToVideo: boolean
  /** Supports image-to-video prompt object ({ image, text }) */
  imageToVideo: boolean
  /** Optional capabilities exposed by provider */
  capabilities: Array<'t2v' | 'i2v' | 'r2v' | 'motion-control' | 'editing'>
  /** Optional supported aspect ratios */
  aspectRatios?: string[]
  /** Optional supported resolutions */
  resolutions?: string[]
  /** Optional duration range in seconds */
  durationRangeSec?: { min: number; max: number }
  seed: boolean
  multipleVideos: boolean
}

export type VideoModelEntry = {
  id: string
  name: string
  description?: string
  provider: string
  strategy: 'video'
  released: string
  cost: VideoModelCost
  features: VideoModelFeatures
}

const commonRatios = ['16:9', '9:16', '1:1', '4:3', '3:4']

export const VIDEO_CATALOG: VideoModelEntry[] = [
  {
    id: 'veo-3.1-generate-001',
    name: 'Veo 3.1',
    provider: 'google',
    strategy: 'video',
    released: '2026-01',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.2 },
        { resolution: '720p', audio: true, costPerSecond: 0.4 },
        { resolution: '1080p', audio: false, costPerSecond: 0.2 },
        { resolution: '1080p', audio: true, costPerSecond: 0.4 },
        { resolution: '4k', audio: false, costPerSecond: 0.4 },
        { resolution: '4k', audio: true, costPerSecond: 0.6 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p', '4k'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  {
    id: 'veo-3.1-fast-generate-001',
    name: 'Veo 3.1 Fast',
    provider: 'google',
    strategy: 'video',
    released: '2026-01',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.1 },
        { resolution: '720p', audio: true, costPerSecond: 0.15 },
        { resolution: '1080p', audio: false, costPerSecond: 0.1 },
        { resolution: '1080p', audio: true, costPerSecond: 0.15 },
        { resolution: '4k', audio: false, costPerSecond: 0.3 },
        { resolution: '4k', audio: true, costPerSecond: 0.35 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p', '4k'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  {
    id: 'veo-3.0-generate-001',
    name: 'Veo 3.0',
    provider: 'google',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.2 },
        { resolution: '720p', audio: true, costPerSecond: 0.4 },
        { resolution: '1080p', audio: false, costPerSecond: 0.2 },
        { resolution: '1080p', audio: true, costPerSecond: 0.4 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  {
    id: 'veo-3.0-fast-generate-001',
    name: 'Veo 3.0 Fast',
    provider: 'google',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 8,
      tiers: [
        { resolution: '720p', audio: false, costPerSecond: 0.1 },
        { resolution: '720p', audio: true, costPerSecond: 0.15 },
        { resolution: '1080p', audio: false, costPerSecond: 0.1 },
        { resolution: '1080p', audio: true, costPerSecond: 0.15 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 4, max: 8 },
      seed: true,
      multipleVideos: true,
    },
  },
  {
    id: 'grok-imagine-video',
    name: 'Grok Imagine Video',
    provider: 'xai',
    strategy: 'video',
    released: '2026-03',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '480p', costPerSecond: 0.05 },
        { resolution: '720p', costPerSecond: 0.07 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v', 'editing'],
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
      resolutions: ['480p', '720p'],
      durationRangeSec: { min: 1, max: 15 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'kling-v2.6-t2v',
    name: 'Kling v2.6 T2V',
    provider: 'klingai',
    strategy: 'video',
    released: '2025-12',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { mode: 'std', costPerSecond: 0.042 },
        { mode: 'pro', audio: false, costPerSecond: 0.07 },
        { mode: 'pro', audio: true, costPerSecond: 0.14 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: commonRatios,
      durationRangeSec: { min: 5, max: 10 },
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'wan-v2.6-t2v',
    name: 'Wan v2.6 T2V',
    provider: 'alibaba',
    strategy: 'video',
    released: '2026-01',
    cost: {
      type: 'per-video-second',
      defaultDurationSec: 5,
      tiers: [
        { resolution: '720p', costPerSecond: 0.1 },
        { resolution: '1080p', costPerSecond: 0.15 },
      ],
    },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      resolutions: ['720p', '1080p'],
      durationRangeSec: { min: 2, max: 15 },
      seed: false,
      multipleVideos: false,
    },
  },

  // Fal direct BYOK models — duration pricing depends on Fal endpoint/config.
  {
    id: 'luma-ray-2',
    name: 'Luma Ray 2 (Fal)',
    provider: 'fal',
    strategy: 'video',
    released: '2025-11',
    cost: { type: 'unknown' },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v'],
      aspectRatios: commonRatios,
      seed: true,
      multipleVideos: false,
    },
  },
  {
    id: 'minimax-video',
    name: 'MiniMax Video (Fal)',
    provider: 'fal',
    strategy: 'video',
    released: '2025-10',
    cost: { type: 'unknown' },
    features: {
      textToVideo: true,
      imageToVideo: false,
      capabilities: ['t2v'],
      aspectRatios: commonRatios,
      seed: false,
      multipleVideos: false,
    },
  },
  {
    id: 'hunyuan-video',
    name: 'Hunyuan Video (Fal)',
    provider: 'fal',
    strategy: 'video',
    released: '2025-09',
    cost: { type: 'unknown' },
    features: {
      textToVideo: true,
      imageToVideo: true,
      capabilities: ['t2v', 'i2v'],
      aspectRatios: commonRatios,
      seed: true,
      multipleVideos: false,
    },
  },
]

const videoCatalogIndex = new Map(VIDEO_CATALOG.map((m) => [m.id, m]))

export function findVideoModel(id: string): VideoModelEntry | undefined {
  return videoCatalogIndex.get(id)
}

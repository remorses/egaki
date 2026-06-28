// Voice cloning via Cartesia and ElevenLabs APIs.
// Both are simple multipart/form-data HTTP calls, no SDK needed.
// Returns Error | Result (errore style) instead of throwing.
//
// Cartesia: POST https://api.cartesia.ai/voices/clone
//   Instant clone, up to 10s of audio, free.
//   Docs: https://docs.cartesia.ai/api-reference/voices/clone
//   Best practices: https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices
//
// ElevenLabs: POST https://api.elevenlabs.io/v1/voices/add
//   Instant voice clone (IVC), 1-3 min recommended.
//   Docs: https://elevenlabs.io/docs/api-reference/voices/ivc/create
import { injectCredentialsToEnv } from './credentials.js'

// ─── types ──────────────────────────────────────────────────────────────────

export type CloneProvider = 'cartesia' | 'elevenlabs'

export interface CloneVoiceOptions {
  /** Raw audio bytes of the clip to clone from. */
  audio: Uint8Array
  /** Name for the cloned voice. */
  name: string
  /** Which provider to use. */
  provider: CloneProvider
  /** Cartesia only: ISO 639-1 language code. Default: 'en'. Ignored by ElevenLabs. */
  language?: string
  /** Optional description for the voice. */
  description?: string
  /** Original filename for MIME type inference. */
  filename?: string
  /** Cartesia: optional base voice ID to derive from. */
  baseVoiceId?: string
  /** ElevenLabs: apply AI noise removal to the clip. */
  removeBackgroundNoise?: boolean
}

export interface CloneVoiceResult {
  voiceId: string
  name: string
  provider: CloneProvider
}

// ─── validation ─────────────────────────────────────────────────────────────

const CARTESIA_LANGUAGES = new Set([
  'en', 'fr', 'de', 'es', 'pt', 'zh', 'ja', 'hi', 'it', 'ko', 'nl', 'pl',
  'ru', 'sv', 'tr', 'tl', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms',
  'sk', 'da', 'ta', 'uk', 'hu', 'no', 'vi', 'bn', 'th', 'he', 'ka', 'id',
  'te', 'gu', 'kn', 'ml', 'mr', 'pa',
])

function validateOptions(opts: CloneVoiceOptions): Error | void {
  if (opts.audio.length === 0) {
    return new Error('No audio data provided. Pass an audio file or use --stdin.')
  }
  if (!opts.name || opts.name.trim().length === 0) {
    return new Error('Voice name is required. Use --name "My Voice".')
  }
  if (opts.provider === 'cartesia' && opts.language && !CARTESIA_LANGUAGES.has(opts.language)) {
    return new Error(
      `Unsupported language "${opts.language}" for Cartesia. ` +
      `Supported: ${[...CARTESIA_LANGUAGES].join(', ')}`,
    )
  }
}

// ─── MIME type helper ───────────────────────────────────────────────────────

function mimeTypeFromFilename(filename?: string): string {
  if (!filename) return 'audio/mpeg'
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    webm: 'audio/webm',
    mpga: 'audio/mpeg',
    m4a: 'audio/mp4',
  }
  return map[ext ?? ''] ?? 'audio/mpeg'
}

// ─── Cartesia clone ─────────────────────────────────────────────────────────

const CARTESIA_API_BASE = 'https://api.cartesia.ai'
const CARTESIA_API_VERSION = '2026-03-01'

async function cloneVoiceCartesia(opts: CloneVoiceOptions): Promise<Error | CloneVoiceResult> {
  const apiKey = process.env['CARTESIA_API_KEY']
  if (!apiKey) {
    return new Error(
      'CARTESIA_API_KEY not found. Run: egaki login --provider cartesia\n' +
      'Get your key at https://play.cartesia.ai/keys',
    )
  }

  const language = opts.language ?? 'en'
  const mime = mimeTypeFromFilename(opts.filename)
  const ext = opts.filename?.split('.').pop() ?? 'mp3'

  const formData = new FormData()
  const blob = new Blob([Buffer.from(opts.audio)], { type: mime })
  formData.append('clip', new File([blob], `clip.${ext}`, { type: mime }))
  formData.append('name', opts.name.trim())
  formData.append('language', language)
  if (opts.description) formData.append('description', opts.description)
  if (opts.baseVoiceId) formData.append('base_voice_id', opts.baseVoiceId)

  const response = await fetch(`${CARTESIA_API_BASE}/voices/clone`, {
    method: 'POST',
    headers: {
      'Cartesia-Version': CARTESIA_API_VERSION,
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  }).catch((cause) => new Error('Cartesia clone request failed', { cause }))
  if (response instanceof Error) return response

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    return new Error(`Cartesia clone API error ${response.status}: ${errorText || response.statusText}`)
  }

  const json = await response.json().catch(
    (cause) => new Error('Cartesia clone API returned invalid JSON', { cause }),
  ) as { id?: string; name?: string } | Error
  if (json instanceof Error) return json
  if (!json.id) return new Error('Cartesia clone API response did not include a voice id')
  return {
    voiceId: json.id,
    name: json.name ?? opts.name.trim(),
    provider: 'cartesia',
  }
}

// ─── ElevenLabs clone ───────────────────────────────────────────────────────

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io'

async function cloneVoiceElevenLabs(opts: CloneVoiceOptions): Promise<Error | CloneVoiceResult> {
  const apiKey = process.env['ELEVENLABS_API_KEY']
  if (!apiKey) {
    return new Error(
      'ELEVENLABS_API_KEY not found. Run: egaki login --provider elevenlabs\n' +
      'Get your key at https://elevenlabs.io/app/settings/api-keys',
    )
  }

  const mime = mimeTypeFromFilename(opts.filename)
  const ext = opts.filename?.split('.').pop() ?? 'mp3'

  const formData = new FormData()
  formData.append('name', opts.name.trim())
  const blob = new Blob([Buffer.from(opts.audio)], { type: mime })
  formData.append('files', new File([blob], `clip.${ext}`, { type: mime }))
  if (opts.description) formData.append('description', opts.description)
  if (opts.removeBackgroundNoise) formData.append('remove_background_noise', 'true')

  const response = await fetch(`${ELEVENLABS_API_BASE}/v1/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: formData,
  }).catch((cause) => new Error('ElevenLabs clone request failed', { cause }))
  if (response instanceof Error) return response

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    return new Error(`ElevenLabs clone API error ${response.status}: ${errorText || response.statusText}`)
  }

  const json = await response.json().catch(
    (cause) => new Error('ElevenLabs clone API returned invalid JSON', { cause }),
  ) as { voice_id?: string; requires_verification?: boolean } | Error
  if (json instanceof Error) return json
  if (!json.voice_id) return new Error('ElevenLabs clone API response did not include a voice_id')
  return {
    voiceId: json.voice_id,
    name: opts.name.trim(),
    provider: 'elevenlabs',
  }
}

// ─── main entry point ───────────────────────────────────────────────────────

export async function cloneVoiceUncached(
  opts: CloneVoiceOptions,
): Promise<Error | CloneVoiceResult> {
  injectCredentialsToEnv()

  const validationError = validateOptions(opts)
  if (validationError) return validationError

  if (opts.provider === 'elevenlabs') {
    return cloneVoiceElevenLabs(opts)
  }
  return cloneVoiceCartesia(opts)
}

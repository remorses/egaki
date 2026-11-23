// Voice change (speech-to-speech): re-speak a recording with another voice,
// keeping its timing, emotion and delivery. Plain multipart HTTP calls, no SDK.
// Returns Error | Result (errore style) instead of throwing.
//
// Each provider is one entry in VOICE_CHANGE_PROVIDERS. To add a provider,
// add an entry with its models and a change() function.
//
// ElevenLabs: POST https://api.elevenlabs.io/v1/voice-changer/{voice_id}
//   Docs: https://elevenlabs.io/docs/api-reference/speech-to-speech/convert
//
// Cartesia: POST https://api.cartesia.ai/voice-changer/bytes
//   Docs: https://docs.cartesia.ai/api-reference/voice-changer/bytes
import { injectCredentialsToEnv } from './credentials.js'
import { mimeTypeFromFilename } from './clone-generate.js'
import { ValidationError } from './models.js'

// ─── types ──────────────────────────────────────────────────────────────────

export interface VoiceChangeOptions {
  /** Raw audio bytes of the recording to re-speak. */
  audio: Uint8Array
  /** Target voice ID from the provider's voice library (or a cloned voice). */
  voice: string
  provider: VoiceChangeProvider
  /** Provider model ID. Defaults to the provider's default model. */
  model?: string
  /** Original filename for MIME type inference. */
  filename?: string
  /** ElevenLabs: remove background noise from the input before conversion. */
  removeBackgroundNoise?: boolean
}

export interface VoiceChangeResult {
  audio: Uint8Array
  mediaType: string
  provider: VoiceChangeProvider
  model?: string
}

interface ProviderEntry {
  /** Empty when the provider has no model choice. */
  models: string[]
  defaultModel?: string
  supportsRemoveBackgroundNoise: boolean
  change(opts: VoiceChangeOptions): Promise<Error | VoiceChangeResult>
}

// ─── shared helpers ─────────────────────────────────────────────────────────

function audioFile(opts: VoiceChangeOptions): File {
  const mime = mimeTypeFromFilename(opts.filename)
  const ext = opts.filename?.split('.').pop() ?? 'mp3'
  return new File([Buffer.from(opts.audio)], `input.${ext}`, { type: mime })
}

async function readAudioResponse(
  label: string,
  response: Response | Error,
): Promise<Error | { audio: Uint8Array; mediaType: string }> {
  if (response instanceof Error) return response
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    return new Error(`${label} voice change API error ${response.status}: ${errorText || response.statusText}`)
  }
  const bytes = await response.arrayBuffer().catch(
    (cause) => new Error(`${label} voice change response could not be read`, { cause }),
  )
  if (bytes instanceof Error) return bytes
  if (bytes.byteLength === 0) return new Error(`${label} voice change API returned empty audio`)
  return {
    audio: new Uint8Array(bytes),
    mediaType: response.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg',
  }
}

// ─── ElevenLabs ─────────────────────────────────────────────────────────────

async function changeVoiceElevenLabs(
  opts: VoiceChangeOptions,
): Promise<Error | VoiceChangeResult> {
  const apiKey = process.env['ELEVENLABS_API_KEY']
  if (!apiKey) {
    return new Error(
      'ELEVENLABS_API_KEY not found. Run: egaki login --provider elevenlabs\n' +
      'Get your key at https://elevenlabs.io/app/settings/api-keys',
    )
  }

  const formData = new FormData()
  formData.append('audio', audioFile(opts))
  if (opts.model) formData.append('model_id', opts.model)
  if (opts.removeBackgroundNoise) formData.append('remove_background_noise', 'true')

  const url = `https://api.elevenlabs.io/v1/voice-changer/${encodeURIComponent(opts.voice)}?output_format=mp3_44100_128`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: formData,
  }).catch((cause) => new Error('ElevenLabs voice change request failed', { cause }))

  const result = await readAudioResponse('ElevenLabs', response)
  if (result instanceof Error) return result
  return { ...result, provider: 'elevenlabs', model: opts.model }
}

// ─── Cartesia ───────────────────────────────────────────────────────────────

async function changeVoiceCartesia(opts: VoiceChangeOptions): Promise<Error | VoiceChangeResult> {
  const apiKey = process.env['CARTESIA_API_KEY']
  if (!apiKey) {
    return new Error(
      'CARTESIA_API_KEY not found. Run: egaki login --provider cartesia\n' +
      'Get your key at https://play.cartesia.ai/keys',
    )
  }

  const formData = new FormData()
  formData.append('clip', audioFile(opts))
  formData.append('voice[id]', opts.voice)
  formData.append('output_format[container]', 'mp3')
  formData.append('output_format[sample_rate]', '44100')
  formData.append('output_format[bit_rate]', '128000')

  const response = await fetch('https://api.cartesia.ai/voice-changer/bytes', {
    method: 'POST',
    headers: {
      'Cartesia-Version': '2026-03-01',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  }).catch((cause) => new Error('Cartesia voice change request failed', { cause }))

  const result = await readAudioResponse('Cartesia', response)
  if (result instanceof Error) return result
  return { ...result, provider: 'cartesia' }
}

// ─── provider registry ──────────────────────────────────────────────────────

export const VOICE_CHANGE_PROVIDERS = {
  elevenlabs: {
    models: ['eleven_multilingual_sts_v2', 'eleven_english_sts_v2'],
    defaultModel: 'eleven_multilingual_sts_v2',
    supportsRemoveBackgroundNoise: true,
    change: changeVoiceElevenLabs,
  },
  cartesia: {
    models: [],
    supportsRemoveBackgroundNoise: false,
    change: changeVoiceCartesia,
  },
} satisfies Record<string, ProviderEntry>

export type VoiceChangeProvider = keyof typeof VOICE_CHANGE_PROVIDERS

export const VOICE_CHANGE_PROVIDER_IDS = Object.keys(VOICE_CHANGE_PROVIDERS) as [
  VoiceChangeProvider,
  ...VoiceChangeProvider[],
]

// ─── main entry point ───────────────────────────────────────────────────────

export async function changeVoiceUncached(
  opts: VoiceChangeOptions,
): Promise<Error | VoiceChangeResult> {
  injectCredentialsToEnv()

  const entry: ProviderEntry = VOICE_CHANGE_PROVIDERS[opts.provider]
  if (opts.audio.length === 0) {
    return new ValidationError('No audio data provided. Pass an audio file or use --stdin.')
  }
  if (!opts.voice || opts.voice.trim().length === 0) {
    return new ValidationError('Target voice is required. Use --voice <voice-id>.')
  }
  if (opts.model && !entry.models.includes(opts.model)) {
    return new ValidationError(
      entry.models.length === 0
        ? `${opts.provider} voice change has no model option. Remove -m.`
        : `Unknown ${opts.provider} voice change model "${opts.model}". Supported: ${entry.models.join(', ')}`,
    )
  }
  if (opts.removeBackgroundNoise && !entry.supportsRemoveBackgroundNoise) {
    return new ValidationError(`--remove-background-noise is not supported by ${opts.provider}.`)
  }

  return entry.change({ ...opts, voice: opts.voice.trim(), model: opts.model ?? entry.defaultModel })
}

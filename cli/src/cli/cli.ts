#!/usr/bin/env node
// Main CLI entrypoint for egaki - AI image and video generation.
// Uses the Vercel AI SDK for image generation across multiple providers.
// Designed to be called by agents and humans alike.
//
// Two generation paths depending on model:
//   - imagen-* models → generateImage() with google.image()
//   - all other models → generateText() with responseModalities: ['IMAGE']
// The CLI auto-detects which path to use based on model ID prefix.
import { goke } from 'goke'
import { z } from 'zod'
import dedent from 'string-dedent'
import {
  APICallError,
  NoImageGeneratedError,
  NoVideoGeneratedError,
  RetryError,
} from 'ai'
import { select, isCancel, cancel } from '@clack/prompts'
import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import pkg from '../../package.json' with { type: 'json' }
import {
  injectCredentialsToEnv,
  PROVIDERS,
  getKeyStatus,
} from './credentials.js'
import {
  DEFAULT_MODEL,
  DEFAULT_VIDEO_MODEL,
  getModelConfig,
} from './models.js'
import {
  CATALOG,
  VIDEO_CATALOG,
  describeProviderValues,
} from './model-catalog.js'
import {
  loginInteractive,
  loginNonInteractive,
  showLoginStatus,
  removeLogin,
  readKeyFromStdin,
} from './login.js'
import {
  subscribeInteractive,
  subscribeNonInteractive,
  unsubscribe,
  showUsage,
} from './subscription.js'
import {
  generateImageUncached as generateImage,
  generateVideoUncached as generateVideo,
  calculateCost,
  ValidationError,
  type GeneratedFile,
} from './generate.js'
import {
  generateSpeechUncached as generateSpeech,
} from './speech-generate.js'
import {
  transcribeAudioUncached as transcribeAudio,
  segmentsToWordTimestamps,
} from './transcription-generate.js'
import {
  SPEECH_CATALOG,
  type SpeechModelEntry,
} from './speech-catalog.js'
import {
  TRANSCRIPTION_CATALOG,
  type TranscriptionModelEntry,
} from './transcription-catalog.js'
import {
  DEFAULT_SPEECH_MODEL,
} from './speech-models.js'
import {
  DEFAULT_TRANSCRIPTION_MODEL,
} from './transcription-models.js'
import {
  separateAudioUncached as separateAudio,
  downloadStem,
  type StemName,
  type DemucsModel,
} from './separation-generate.js'
import {
  cloneVoiceUncached as cloneVoice,
  type CloneProvider,
} from './clone-generate.js'

const cli = goke('egaki')

process.title = 'egaki'

process.on('uncaughtException', (err) => {
  printErrorDetails(err)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  printErrorDetails(reason)
  process.exit(1)
})

// ─── login command ───────────────────────────────────────────────────────────

cli
  .command(
    'login',
    dedent`
      Configure API keys for image generation providers.
      Interactive mode: shows a provider picker and secure key input.
      Non-interactive mode: pass --provider and --key flags, or pipe key via stdin.
      Keys are saved to ~/.config/egaki/credentials.json (mode 0600).
    `,
  )
  .option(
    '-p, --provider [name]',
    z
      .string()
      .describe(
        `Provider name for non-interactive login (${Object.keys(PROVIDERS).join(', ')})`,
      ),
  )
  .option(
    '-k, --key [key]',
    z.string().describe('API key value for non-interactive login'),
  )
  .option('--show', 'Show which providers are configured and their status')
  .option(
    '--remove [provider]',
    z.string().describe('Remove the stored key for a provider'),
  )
  .example('# Interactive login (pick provider, paste key)')
  .example('egaki login')
  .example('# Non-interactive login with flags')
  .example('egaki login --provider google --key AIza...')
  .example('egaki login --provider vertex --key AIza...')
  .example('# Pipe key from stdin (useful in CI/scripts)')
  .example('echo "AIza..." | egaki login --provider google')
  .example('# Show configured providers')
  .example('egaki login --show')
  .example('# Remove a stored key')
  .example('egaki login --remove google')
  .action(async (options) => {
    if (options.show) {
      showLoginStatus()
      return
    }

    if (options.remove) {
      removeLogin(options.remove)
      return
    }

    // Non-interactive: --provider + --key or stdin
    if (options.provider) {
      // OAuth providers use browser flow — skip key reading
      if (options.provider === 'chatgpt' || options.provider === 'xai-oauth') {
        await loginNonInteractive({ provider: options.provider, key: '' })
        return
      }
      const key = options.key || (await readKeyFromStdin())
      await loginNonInteractive({ provider: options.provider, key })
      return
    }

    // Interactive mode
    await loginInteractive()
  })

// ─── subscribe command ───────────────────────────────────────────────────────

cli
  .command(
    'subscribe',
    dedent`
      Subscribe to Egaki for access to all image models with a single API key.
      You can also use your own provider keys (Google/OpenAI/Replicate/Fal)
      via 'egaki login --provider <name> --key <key>' if you prefer BYOK.
      Egaki subscription avoids managing one key per provider.
      Three plans: Starter ($9/mo, 100 credits), Pro ($29/mo, 500 credits),
      Unlimited ($99/mo, 2000 credits). One credit ≈ one standard image.
      Interactive mode: pick a plan and get a checkout URL (email prefill optional).
      Non-interactive: --email is optional and only pre-fills checkout.
    `,
  )
  .option(
    '-e, --email [email]',
    z.string().describe('Optional email prefill for checkout (skips interactive prompt)'),
  )
  .option(
    '--plan [plan]',
    z.string().describe('Plan ID: starter, pro, or unlimited (default: pro)'),
  )
  .example('# Interactive subscribe')
  .example('egaki subscribe')
  .example('# Non-interactive (for agents)')
  .example('egaki subscribe --email user@example.com --plan pro')
  .example('# Non-interactive without email prefill')
  .example('egaki subscribe --plan pro')
  .action(async (options) => {
    const isTTY = process.stdout.isTTY && process.stdin.isTTY
    if (!isTTY || options.email || options.plan) {
      subscribeNonInteractive(options.email, options.plan)
      return
    }
    await subscribeInteractive()
  })

// ─── unsubscribe command ─────────────────────────────────────────────────────

cli
  .command(
    'unsubscribe',
    dedent`
      Cancel your Egaki subscription. Uses the stored API key to identify
      the subscription. You can resubscribe anytime with 'egaki subscribe'.
    `,
  )
  .example('egaki unsubscribe')
  .action(async () => {
    await unsubscribe()
  })

// ─── usage command ───────────────────────────────────────────────────────────

cli
  .command(
    'usage',
    dedent`
      Show your current Egaki credit usage for this billing period.
      Displays plan, credits used, credits remaining, and period info.
    `,
  )
  .example('egaki usage')
  .action(async () => {
    await showUsage()
  })

// ─── image command ───────────────────────────────────────────────────────────

cli
  .command(
    'image <prompt>',
    dedent`
      Generate images from a text prompt using AI models.
      Supports Imagen models (dedicated image generation) and Gemini
      multimodal models (text+image output). The model type is auto-detected
      from the model ID: imagen-* uses the image API, everything else uses
      the text API with image output enabled.
    `,
  )
  .option(
    '-m, --model [model]',
    z.string().describe('Model ID for generation. If omitted, shows an interactive picker (or uses default in non-TTY mode)'),
  )
  .option(
    '-o, --output [path]',
    z
      .string()
      .default('egaki-output.png')
      .describe('Output file path (index suffix added when generating multiple)'),
  )
  .option(
    '-n, --count [n]',
    z.number().default(1).describe('Number of images to generate'),
  )
  .option(
    '--aspect-ratio [ratio]',
    z
      .string()
      .describe(
        'Aspect ratio for the generated image. Imagen supports: 1:1, 3:4, 4:3, 9:16, 16:9. Gemini supports additional ratios: 2:3, 3:2, 4:5, 5:4, 21:9',
      ),
  )
  .option(
    '--seed [seed]',
    z.number().describe('Seed for reproducible generation. Same seed + same prompt = same image'),
  )
  .option(
    '--image-size [size]',
    z
      .enum(['1K', '2K', '4K'])
      .describe(
        'Output resolution for Gemini text-model image generation. Only applies to gemini-*-image* models',
      ),
  )
  .option(
    '-i, --input [file]',
    z
      .array(z.string())
      .describe(
        'Reference image for editing or variations (repeatable). Accepts local file paths or URLs (http/https). Pass one or more images along with a text prompt to edit them',
      ),
  )
  .option(
    '--mask [file]',
    z
      .string()
      .describe(
        'Mask image for inpainting. Accepts a local file path or URL (http/https). White areas in the mask are replaced with generated content. Used together with --input',
      ),
  )
  .option(
    '--quality [level]',
    z
      .string()
      .describe(
        `Image quality level. ${describeProviderValues('quality', [CATALOG])}`,
      ),
  )
  .option(
    '--resolution [res]',
    z
      .string()
      .describe(
        `Output resolution. ${describeProviderValues('resolution', [CATALOG])}`,
      ),
  )
  .option(
    '--output-format [format]',
    z
      .string()
      .describe(
        `Output image format. ${describeProviderValues('output-format', [CATALOG])}`,
      ),
  )
  .option(
    '--negative-prompt [text]',
    z
      .string()
      .describe(
        'Describe what to avoid in the generated image (Fal models)',
      ),
  )
  .option(
    '--allow-people',
    'Allow generating images of people (Imagen blocks people by default)',
  )
  .option(
    '--json',
    'Output result metadata as JSON to stdout (model, usage, warnings, file paths)',
  )
  .option(
    '--stdout',
    'Write raw image bytes to stdout instead of saving to a file. Useful for piping to other tools',
  )
  .example('# Generate a simple image')
  .example('egaki image "a sunset over mars"')
  .example('# Use a specific model with aspect ratio')
  .example('egaki image "cyberpunk city at night" -m imagen-4.0-ultra-generate-001 --aspect-ratio 16:9')
  .example('# Edit an existing image')
  .example('egaki image "add a wizard hat to the cat" --input cat.jpg -o cat-wizard.png')
  .example('# Edit an image from a URL')
  .example('egaki image "make it pop art" --input https://example.com/photo.jpg')
  .example('# Inpainting with a mask')
  .example('egaki image "fill with flowers" --input photo.jpg --mask mask.png')
  .example('# Generate with Gemini multimodal at 4K')
  .example('egaki image "dreamy landscape" -m gemini-2.5-flash-image --image-size 4K')
  .example('# Route through Vertex AI (Google Cloud billing)')
  .example('egaki image "product photo on marble" -m vertex/imagen-4.0-generate-001')
  .example('# Generate multiple images')
  .example('egaki image "abstract art" -n 4 -o art.png')
  .example('# Pipe to another tool')
  .example('egaki image "logo design" --stdout | convert - -resize 512x512 logo.png')
  .action(async (prompt, options) => {
    const model = options.model ?? await resolveImageModel()
    const outputPath = options.output ?? 'egaki-output.png'

    if (!options.stdout) {
      console.error(pc.dim(`Model: ${model}`))
      console.error(pc.dim(`Prompt: ${prompt}`))
      console.error(pc.cyan('Generating...'))
    }

    const inputImages = await readInputImages(options.input)
    const maskImage = options.mask
      ? await readInputSource(options.mask)
      : undefined

    const result = await runProviderCall('Image generation', () => generateImage({
      prompt,
      model,
      count: options.count ?? 1,
      aspectRatio: options.aspectRatio,
      seed: options.seed,
      inputImages,
      maskImage,
      allowPeople: options.allowPeople || false,
      quality: options.quality,
      resolution: options.resolution,
      outputFormat: options.outputFormat,
      negativePrompt: options.negativePrompt,
      imageSize: options.imageSize,
    }))

    if (options.stdout) {
      writeFirstToStdout(result.images)
      return
    }

    const savedFiles = saveGeneratedFiles(result.images, outputPath)
    printCost(result.cost)

    if (result.revisedPrompt && !options.json) {
      console.error(pc.dim(`Revised prompt: ${result.revisedPrompt}`))
    }

    if (result.text && !options.json) {
      console.error(pc.dim(result.text))
    }

    if (options.json) {
      console.log(JSON.stringify({
        model,
        files: savedFiles,
        count: result.images.length,
        cost: result.cost,
        usage: result.usage,
        warnings: result.warnings,
        ...(result.text ? { text: result.text } : {}),
        ...(result.revisedPrompt !== undefined ? { revisedPrompt: result.revisedPrompt } : {}),
      }, null, 2))
    }
  })

// ─── video command ───────────────────────────────────────────────────────────

cli
  .command(
    'video <prompt>',
    dedent`
      Generate videos from a text prompt (or image+text prompt for models that
      support image-to-video). Uses AI SDK experimental_generateVideo under the hood.

      Agent note: video generation can be slow. When invoking this command from
      automation, use a command timeout of at least 5 minutes.
    `,
  )
  .option(
    '-m, --model [model]',
    z.string().describe('Video model ID for generation. If omitted, shows an interactive picker (or uses default in non-TTY mode)'),
  )
  .option(
    '-o, --output [path]',
    z
      .string()
      .default('egaki-output.mp4')
      .describe('Output file path (index suffix added when generating multiple)'),
  )
  .option(
    '-n, --count [n]',
    z.number().default(1).describe('Number of videos to generate'),
  )
  .option(
    '--aspect-ratio [ratio]',
    z.string().describe('Video aspect ratio in WIDTH:HEIGHT format (e.g. 16:9, 9:16)'),
  )
  .option(
    '--resolution [resolution]',
    z
      .string()
      .describe(`Video resolution. ${describeProviderValues('resolution', [VIDEO_CATALOG])}. Google: 720p, 1080p, 4k`),
  )
  .option(
    '--duration [seconds]',
    z.number().describe('Video duration in seconds. Veo: 4-8s. xAI Grok: 1-15s. Kling: 5-10s. Wan: 2-15s'),
  )
  .option(
    '--fps [fps]',
    z.number().describe('Frames per second for video models that support fps override'),
  )
  .option(
    '--seed [seed]',
    z.number().describe('Seed for reproducible video generation (model support varies)'),
  )
  .option(
    '-i, --input [file]',
    z
      .string()
      .describe(
        'Input file for video generation. For i2v: a reference image. For edit-video/extend-video: a source video. Accepts local file paths or URLs',
      ),
  )
  .option(
    '--mode [mode]',
    z
      .enum(['edit-video', 'extend-video', 'reference-to-video'])
      .describe(
        `Video operation mode. ${describeProviderValues('mode', [VIDEO_CATALOG])}`,
      ),
  )
  .option(
    '--reference-images [path]',
    z
      .array(z.string())
      .describe(
        'Reference images for R2V generation, repeatable. xAI: 1-7 images. Seedance: 1-9 images (use @Image1 etc. in prompt)',
      ),
  )
  .option(
    '--negative-prompt [text]',
    z
      .string()
      .describe(
        'Describe what to avoid in the generated video (Fal models)',
      ),
  )
  .option(
    '--json',
    'Output result metadata as JSON to stdout (model, usage, warnings, file paths)',
  )
  .option(
    '--stdout',
    'Write raw video bytes to stdout instead of saving to a file. Useful for piping to other tools',
  )
  .example('# Generate a video')
  .example('egaki video "A paper airplane gliding through clouds" -o airplane.mp4')
  .example('# Generate with Veo model + duration')
  .example('egaki video "cinematic rainy street at night" -m veo-3.1-fast-generate-001 --duration 6')
  .example('# Route through Vertex AI (Google Cloud billing)')
  .example('egaki video "storm over mountains" -m vertex/veo-3.1-fast-generate-001 --duration 6')
  .example('# Image-to-video (model support required)')
  .example('egaki video "animate subtle camera pan" --model luma-ray-2 --input frame.png -o animated.mp4')
  .example('# Generate multiple videos')
  .example('egaki video "waves crashing on cliffs" -n 2 -o waves.mp4')
  .action(async (prompt, options) => {
    injectCredentialsToEnv()

    const model = options.model ?? await resolveVideoModel()
    const outputPath = options.output ?? 'egaki-output.mp4'
    const config = getModelConfig(model)

    if (config instanceof Error) {
      console.error(pc.red(config.message))
      process.exit(1)
    }

    if (!options.stdout) {
      console.error(pc.dim(`Model: ${model}`))
      console.error(pc.dim(`Prompt: ${prompt}`))
      console.error(pc.cyan('Generating...'))
    }

    // Determine how --input is used based on --mode:
    // - edit-video / extend-video: input is a source video, passed as videoUrl (needs URL)
    // - everything else (i2v, t2v): input is a reference image, passed as bytes
    const isVideoInputMode = options.mode === 'edit-video' || options.mode === 'extend-video'

    // Auto-set --mode reference-to-video for providers that require it (xAI) when
    // --reference-images is provided without an explicit --mode.
    if (options.referenceImages?.length && !options.mode && config.provider === 'xai') {
      options.mode = 'reference-to-video'
    }

    let inputImage: Uint8Array | undefined
    let videoUrl: string | undefined

    if (options.input && isVideoInputMode) {
      videoUrl = await resolveToUrl(options.input)
    } else if (options.input) {
      inputImage = await readInputSource(options.input)
    }

    let resolvedReferenceImages = options.referenceImages
    if (resolvedReferenceImages) {
      resolvedReferenceImages = await Promise.all(
        resolvedReferenceImages.map((ref: string) => resolveToUrl(ref)),
      )
    }

    const result = await runProviderCall('Video generation', () => generateVideo({
      prompt,
      model,
      count: options.count ?? 1,
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      duration: options.duration,
      fps: options.fps,
      seed: options.seed,
      inputImage,
      mode: options.mode,
      videoUrl,
      referenceImages: resolvedReferenceImages,
      negativePrompt: options.negativePrompt,
    }))

    if (options.stdout) {
      writeFirstToStdout(result.videos)
      return
    }

    const savedFiles = saveGeneratedFiles(result.videos, outputPath)
    printCost(result.cost)

    if (options.json) {
      console.log(JSON.stringify({
        model,
        files: savedFiles,
        count: result.videos.length,
        cost: result.cost,
        warnings: result.warnings,
        responses: result.responses,
      }, null, 2))
    }
  })

// ─── speech command ──────────────────────────────────────────────────────────

cli
  .command(
    'speech [text]',
    dedent`
      Generate speech audio from text using AI text-to-speech models.
      Supports OpenAI (tts-1, tts-1-hd, gpt-4o-mini-tts), ElevenLabs
      (eleven_v3, eleven_multilingual_v2, eleven_flash_v2_5), and Cartesia
      (sonic-3.5, sonic-3). Uses your provider API key directly (egaki
      subscription does not cover speech yet).
    `,
  )
  .option(
    '-m, --model [model]',
    z.string().describe('Speech model ID. If omitted, shows an interactive picker (or uses default in non-TTY mode)'),
  )
  .option(
    '-o, --output [path]',
    z
      .string()
      .default('egaki-output')
      .describe('Output file path (extension added from audio format if omitted)'),
  )
  .option(
    '--voice [voice]',
    z
      .string()
      .describe('Voice ID or name (provider-specific). OpenAI: alloy, echo, nova, etc. ElevenLabs/Cartesia: voice ID from their library'),
  )
  .option(
    '--output-format [format]',
    z
      .string()
      .describe('Audio output format: mp3, wav, pcm, opus, aac, flac (provider support varies)'),
  )
  .option(
    '--speed [speed]',
    z
      .number()
      .describe('Playback speed multiplier (OpenAI: 0.25-4.0, Cartesia: 0.6-1.5)'),
  )
  .option(
    '--instructions [text]',
    z
      .string()
      .describe('Style instructions for speech (only gpt-4o-mini-tts and ElevenLabs). E.g. "Speak in a calm, soothing tone"'),
  )
  .option(
    '--language [lang]',
    z
      .string()
      .describe('ISO 639-1 language code (e.g. en, es, fr). ElevenLabs and Cartesia'),
  )
  .option(
    '--stdin',
    'Read text from stdin instead of the positional argument',
  )
  .option(
    '--json',
    'Output result metadata as JSON to stdout (model, file path, cost)',
  )
  .option(
    '--stdout',
    'Write raw audio bytes to stdout instead of saving to a file. Useful for piping',
  )
  .example('# Generate speech with default model')
  .example('egaki speech "Hello, welcome to egaki!"')
  .example('# Use a specific model and voice')
  .example('egaki speech "Good morning" -m tts-1-hd --voice nova')
  .example('# Use GPT-4o Mini TTS with style instructions')
  .example('egaki speech "Breaking news today" -m gpt-4o-mini-tts --instructions "Speak like a news anchor"')
  .example('# ElevenLabs with a voice ID')
  .example('egaki speech "Hello world" -m eleven_v3 --voice 21m00Tcm4TlvDq8ikWAM')
  .example('# Read text from stdin')
  .example('cat script.txt | egaki speech --stdin -o narration.mp3')
  .example('# Cartesia Sonic 3.5 with a voice ID')
  .example('egaki speech "Hello world" -m sonic-3.5 --voice f786b574-daa5-4673-aa0c-cbe3e8534c02')
  .example('# Pipe audio to another tool')
  .example('egaki speech "test" --stdout | ffplay -nodisp -autoexit -')
  .action(async (text = '', options) => {
    let inputText = text
    if (options.stdin) {
      inputText = await readTextFromStdin()
    }

    if (!inputText || inputText.trim().length === 0) {
      console.error(pc.red('No text provided. Pass text as an argument or use --stdin.'))
      process.exit(1)
    }

    const model = options.model ?? await resolveSpeechModel()
    const outputPath = options.output ?? 'egaki-output'

    if (!options.stdout) {
      console.error(pc.dim(`Model: ${model}`))
      console.error(pc.dim(`Text: ${inputText.length > 80 ? inputText.slice(0, 80) + '...' : inputText}`))
      console.error(pc.cyan('Generating speech...'))
    }

    const result = await runProviderCall('Speech generation', () => generateSpeech({
      text: inputText,
      model,
      voice: options.voice,
      outputFormat: options.outputFormat,
      instructions: options.instructions,
      speed: options.speed,
      language: options.language,
    }))

    if (options.stdout) {
      process.stdout.write(Buffer.from(result.audio.uint8Array))
      return
    }

    const ext = extensionFromMediaType(result.audio.mediaType)
    const finalPath = ensureExtension(outputPath, ext)
    fs.writeFileSync(finalPath, result.audio.uint8Array)
    console.error(pc.green(`Saved: ${finalPath}`))
    printCost(result.cost)

    if (options.json) {
      console.log(JSON.stringify({
        model,
        file: finalPath,
        cost: result.cost,
        textLength: inputText.length,
        timestamps: result.timestamps ? result.timestamps.length : 0,
      }, null, 2))
    }
  })

// ─── transcribe command ──────────────────────────────────────────────────────

cli
  .command(
    'transcribe [audio]',
    dedent`
      Transcribe audio to text using AI speech-to-text models.
      Supports OpenAI (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe),
      ElevenLabs (scribe_v1), Deepgram (nova-3), Groq (whisper-large-v3,
      whisper-large-v3-turbo, distil-whisper-large-v3-en), and Cartesia
      (ink-whisper). Outputs JSON with text, timestamps, language, and duration.
    `,
  )
  .option(
    '-m, --model [model]',
    z.string().describe('Transcription model ID. If omitted, shows an interactive picker (or uses default in non-TTY mode)'),
  )
  .option(
    '-o, --output [path]',
    z
      .string()
      .describe('Output file path for the JSON result'),
  )
  .option(
    '--language [lang]',
    z
      .string()
      .describe('ISO 639-1 language hint (e.g. en, es, fr). Helps accuracy for known languages'),
  )
  .option(
    '--stdin',
    'Read audio from stdin instead of a file path',
  )
  .option(
    '--stdout',
    'Write only the plain text transcript to stdout (no JSON metadata)',
  )
  .example('# Transcribe an audio file with default model')
  .example('egaki transcribe recording.mp3')
  .example('# Use a specific model')
  .example('egaki transcribe interview.wav -m gpt-4o-transcribe')
  .example('# Groq for fast, cheap transcription')
  .example('egaki transcribe podcast.mp3 -m whisper-large-v3')
  .example('# Get plain text only')
  .example('egaki transcribe recording.mp3 --stdout')
  .example('# Save JSON result to file')
  .example('egaki transcribe recording.mp3 -o transcript.json')
  .example('# Pipe audio from another command')
  .example('ffmpeg -i video.mp4 -f mp3 - | egaki transcribe --stdin -m whisper-1')
  .action(async (audioPath = '', options) => {
    if (!options.stdin && !audioPath) {
      console.error(pc.red('No audio provided. Pass an audio file path or use --stdin.'))
      process.exit(1)
    }

    let audioData: Uint8Array

    if (options.stdin) {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk)
      }
      audioData = new Uint8Array(Buffer.concat(chunks))
    } else {
      const resolved = path.resolve(audioPath)
      if (!fs.existsSync(resolved)) {
        console.error(pc.red(`File not found: ${resolved}`))
        process.exit(1)
      }
      audioData = new Uint8Array(fs.readFileSync(resolved))
    }

    if (audioData.length === 0) {
      console.error(pc.red('No audio data provided. Pass an audio file path or use --stdin.'))
      process.exit(1)
    }

    const model = options.model ?? await resolveTranscriptionModel()

    if (!options.stdout) {
      console.error(pc.dim(`Model: ${model}`))
      console.error(pc.dim(`Audio: ${options.stdin ? 'stdin' : audioPath} (${(audioData.length / 1024).toFixed(1)} KB)`))
      console.error(pc.cyan('Transcribing...'))
    }

    const result = await runProviderCall('Transcription', () => transcribeAudio({
      audio: audioData,
      model,
      language: options.language,
    }))

    if (options.stdout) {
      process.stdout.write(result.text)
      return
    }

    const output = {
      text: result.text,
      segments: result.segments,
      wordTimestamps: segmentsToWordTimestamps(result.segments),
      language: result.language,
      durationInSeconds: result.durationInSeconds,
      model: result.model,
      cost: result.cost,
      warnings: result.warnings,
    }

    if (options.output) {
      const outputPath = path.resolve(options.output)
      fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
      console.error(pc.green(`Saved: ${outputPath}`))
    } else {
      console.log(JSON.stringify(output, null, 2))
    }

    printCost(result.cost)
  })

// ─── demucs command ──────────────────────────────────────────────────────────

cli
  .command(
    'demucs [audio]',
    dedent`
      Separate audio into stems (vocals, background, drums, bass, etc.)
      using fal.ai's Demucs model. Requires a fal.ai API key.
      By default extracts vocals and background (other) stems.
    `,
  )
  .option(
    '--stems [list]',
    z
      .string()
      .describe('Comma-separated stems to extract: vocals, drums, bass, other, guitar, piano. Default: vocals,other'),
  )
  .option(
    '--model [model]',
    z
      .string()
      .describe('Demucs model variant. Default: htdemucs_6s. Options: htdemucs, htdemucs_ft, htdemucs_6s, hdemucs_mmi, mdx, mdx_extra, mdx_q, mdx_extra_q'),
  )
  .option(
    '--output-format [format]',
    z
      .enum(['mp3', 'wav'])
      .default('mp3')
      .describe('Output audio format: mp3 or wav'),
  )
  .option(
    '-o, --output [dir]',
    z
      .string()
      .describe('Output directory for separated stems. Default: current directory'),
  )
  .option(
    '--shifts [n]',
    z
      .number()
      .describe('Number of random shifts for quality (higher = better but slower). Default: 1'),
  )
  .option(
    '--overlap [n]',
    z
      .number()
      .describe('Segment overlap 0.0-1.0 (higher = better quality). Default: 0.25'),
  )
  .option(
    '--stdin',
    'Read audio from stdin instead of a file path',
  )
  .option(
    '--json',
    'Output result metadata as JSON to stdout',
  )
  .example('# Separate vocals and background from an audio file')
  .example('egaki demucs song.mp3')
  .example('# Extract all stems (vocals, drums, bass, guitar, piano, other)')
  .example('egaki demucs song.mp3 --stems vocals,drums,bass,other,guitar,piano')
  .example('# Extract only vocals as WAV')
  .example('egaki demucs song.mp3 --stems vocals --output-format wav')
  .example('# Save to a specific directory')
  .example('egaki demucs song.mp3 -o stems/')
  .example('# Higher quality (slower)')
  .example('egaki demucs song.mp3 --shifts 5')
  .action(async (audioPath = '', options) => {
    if (!options.stdin && !audioPath) {
      console.error(pc.red('No audio provided. Pass an audio file path or use --stdin.'))
      process.exit(1)
    }

    let audioData: Uint8Array
    let filename: string | undefined

    if (options.stdin) {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk)
      }
      audioData = new Uint8Array(Buffer.concat(chunks))
    } else {
      const resolved = path.resolve(audioPath)
      if (!fs.existsSync(resolved)) {
        console.error(pc.red(`File not found: ${resolved}`))
        process.exit(1)
      }
      audioData = new Uint8Array(fs.readFileSync(resolved))
      filename = path.basename(resolved)
    }

    if (audioData.length === 0) {
      console.error(pc.red('No audio data provided.'))
      process.exit(1)
    }

    const stems: StemName[] = options.stems
      ? (options.stems as string).split(',').map((s: string) => s.trim() as StemName)
      : ['vocals', 'other']
    const model = (options.model ?? 'htdemucs_6s') as DemucsModel
    const outputFormat = options.outputFormat ?? 'mp3'
    const outputDir = options.output ? path.resolve(options.output) : process.cwd()

    console.error(pc.dim(`Model: ${model}`))
    console.error(pc.dim(`Stems: ${stems.join(', ')}`))
    console.error(pc.dim(`Audio: ${options.stdin ? 'stdin' : audioPath} (${(audioData.length / 1024 / 1024).toFixed(1)} MB)`))
    console.error(pc.cyan('Separating audio...'))

    const result = await runProviderCall('Audio separation', () => separateAudio({
      audio: audioData,
      stems,
      model,
      outputFormat,
      shifts: options.shifts,
      overlap: options.overlap,
      filename,
      onProgress: (msg) => console.error(pc.dim(msg)),
    }))

    // Create output directory if needed
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Download and save each stem
    const baseName = filename
      ? path.basename(filename, path.extname(filename))
      : 'audio'
    const savedFiles: Array<{ stem: string; path: string; size: number }> = []

    for (const stem of result.stems) {
      console.error(pc.dim(`Downloading ${stem.name}...`))
      const bytes = await downloadStem(stem.url)
      if (bytes instanceof Error) {
        console.error(pc.red(`Failed to download ${stem.name}: ${bytes.message}`))
        continue
      }
      const stemPath = path.join(outputDir, `${baseName}-${stem.name}.${outputFormat}`)
      fs.writeFileSync(stemPath, bytes)
      savedFiles.push({ stem: stem.name, path: stemPath, size: bytes.length })
      console.error(pc.green(`Saved: ${stemPath} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`))
    }

    if (options.json) {
      console.log(JSON.stringify({
        model: result.model,
        stems: savedFiles,
      }, null, 2))
    }
  })

// ─── voice clone command ─────────────────────────────────────────────────────

cli
  .command(
    'voice clone [audio]',
    dedent`
      Clone a voice from an audio clip. Returns a voice ID for use with
      'egaki speech --voice <id>'. Supports Cartesia (default) and ElevenLabs.

      Best practices for high-quality clones:

      1. Isolate vocals first: 'egaki demucs recording.mp3 --stems vocals'
         removes background music, noise, and other speakers.
      2. Find a clean snippet: 'egaki transcribe recording-vocals.mp3' to get
         word timestamps. Pick a 5-10s segment with a complete phrase, clear
         speech, no hesitations or crosstalk.
      3. Trim to speech boundaries:
         ffmpeg -i recording-vocals.mp3 -ss 12.5 -to 22.0 -c copy clip.mp3
         No silence padding at start or end.
      4. Match energy to intent: the clone mimics the tone and pacing of the
         source clip. Use an energetic clip for energetic output.
       5. Speak in the target language. Use --language for Cartesia clones.

      Cartesia: up to 10s of audio, instant, free. Good for short clean clips.
      ElevenLabs: 1-3 min recommended, has --remove-background-noise option.
    `,
  )
  .option(
    '--name [name]',
    z
      .string()
      .describe('Name for the cloned voice (required)'),
  )
  .option(
    '-p, --provider [provider]',
    z
      .enum(['cartesia', 'elevenlabs'])
      .default('cartesia')
      .describe('Voice cloning provider: cartesia or elevenlabs'),
  )
  .option(
    '--language [lang]',
    z
      .string()
      .describe('Cartesia only: ISO 639-1 language code (default: en). E.g. en, es, fr, de, ja'),
  )
  .option(
    '--description [text]',
    z
      .string()
      .describe('Optional description for the voice'),
  )
  .option(
    '--base-voice-id [id]',
    z
      .string()
      .describe('Cartesia: optional base voice ID to derive from'),
  )
  .option(
    '--remove-background-noise',
    'ElevenLabs: apply AI noise removal to the clip before cloning',
  )
  .option(
    '--stdin',
    'Read audio from stdin instead of a file path',
  )
  .option(
    '--json',
    'Output result as JSON to stdout',
  )
  .example('# Clone a voice from a recording')
  .example('egaki voice clone recording.wav --name "My Voice"')
  .example('# Clone with ElevenLabs and noise removal')
  .example('egaki voice clone vocals.mp3 --name "Narrator" --provider elevenlabs --remove-background-noise')
  .example('# Full pipeline: separate → trim → clone')
  .example('egaki demucs interview.mp3 --stems vocals')
  .example('ffmpeg -i interview-vocals.mp3 -ss 5.0 -to 15.0 -c copy clip.mp3')
  .example('egaki voice clone clip.mp3 --name "Speaker"')
  .example('# Use the cloned voice')
  .example('egaki speech "Hello world" --voice <voice-id>')
  .action(async (audioPath = '', options) => {
    if (!options.stdin && !audioPath) {
      console.error(pc.red('No audio provided. Pass an audio file path or use --stdin.'))
      process.exit(1)
    }

    const name = options.name
    if (!name) {
      console.error(pc.red('Voice name is required. Use --name "My Voice".'))
      process.exit(1)
    }

    let audioData: Uint8Array
    let filename: string | undefined

    if (options.stdin) {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk)
      }
      audioData = new Uint8Array(Buffer.concat(chunks))
    } else {
      const resolved = path.resolve(audioPath)
      if (!fs.existsSync(resolved)) {
        console.error(pc.red(`File not found: ${resolved}`))
        process.exit(1)
      }
      audioData = new Uint8Array(fs.readFileSync(resolved))
      filename = path.basename(resolved)
    }

    if (audioData.length === 0) {
      console.error(pc.red('No audio data provided.'))
      process.exit(1)
    }

    const provider = (options.provider ?? 'cartesia') as CloneProvider

    console.error(pc.dim(`Provider: ${provider}`))
    console.error(pc.dim(`Name: ${name}`))
    console.error(pc.dim(`Audio: ${options.stdin ? 'stdin' : audioPath} (${(audioData.length / 1024).toFixed(1)} KB)`))
    console.error(pc.cyan('Cloning voice...'))

    const result = await runProviderCall('Voice cloning', () => cloneVoice({
      audio: audioData,
      name,
      provider,
      language: options.language,
      description: options.description,
      baseVoiceId: options.baseVoiceId,
      removeBackgroundNoise: options.removeBackgroundNoise || false,
      filename,
    }))

    console.error(pc.green(`Voice cloned successfully!`))
    console.error(pc.bold(`Voice ID: ${result.voiceId}`))
    console.error(pc.dim(`Use it: egaki speech "Hello" --voice ${result.voiceId}`))

    if (options.json) {
      console.log(JSON.stringify({
        voiceId: result.voiceId,
        name: result.name,
        provider: result.provider,
      }, null, 2))
    }
  })

// ─── models command ──────────────────────────────────────────────────────────

cli
  .command(
    'models',
    dedent`
      List all supported image generation models with pricing, features,
      and provider info. Output is YAML for easy reading and piping.
    `,
  )
  .option(
    '-p, --provider [provider]',
    z.string().describe('Filter models by provider name (e.g. google, openai, replicate, fal)'),
  )
  .option(
    '--type [type]',
    z
      .enum(['all', 'image', 'video', 'speech', 'transcription'])
      .default('all')
      .describe('Filter by model type: image, video, speech, transcription, or all'),
  )
  .option('--json', 'Output as JSON instead of YAML')
  .action(async (options) => {
    const yaml = await import('js-yaml')
    const providerStatuses = Object.fromEntries(
      Object.keys(PROVIDERS).map((provider) => [provider, getKeyStatus(provider)]),
    )

    let models: Array<typeof CATALOG[number] | typeof VIDEO_CATALOG[number] | SpeechModelEntry | TranscriptionModelEntry> =
      options.type === 'video'
        ? [...VIDEO_CATALOG]
        : options.type === 'image'
          ? [...CATALOG]
          : options.type === 'speech'
            ? [...SPEECH_CATALOG]
            : options.type === 'transcription'
              ? [...TRANSCRIPTION_CATALOG]
              : [...CATALOG, ...VIDEO_CATALOG, ...SPEECH_CATALOG, ...TRANSCRIPTION_CATALOG]

    if (options.provider) {
      models = models.filter((m) => m.provider === options.provider)
      if (models.length === 0) {
        console.error(pc.red(`No models found for provider: ${options.provider}`))
        process.exit(1)
      }
    }

    const output = models.map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
      provider: m.provider,
      auth: providerStatuses[m.provider] ?? { available: false, source: 'none' },
      strategy: m.strategy,
      released: m.released,
      cost: formatCatalogCost(m.cost),
      features:
        m.strategy === 'video'
          ? {
              textToVideo: m.features.textToVideo,
              imageToVideo: m.features.imageToVideo,
              capabilities: m.features.capabilities.join(', ') || 'none',
              seed: m.features.seed,
              multipleVideos: m.features.multipleVideos,
              aspectRatios: m.features.aspectRatios?.join(', ') || 'none',
              resolutions: m.features.resolutions?.join(', ') || 'unknown',
              durationRangeSec: m.features.durationRangeSec
                ? `${m.features.durationRangeSec.min}-${m.features.durationRangeSec.max}`
                : 'unknown',
            }
          : m.strategy === 'speech'
            ? {
                outputFormats: m.features.outputFormats.join(', '),
                instructions: m.features.instructions,
                speed: m.features.speed,
                language: m.features.language,
                maxChars: m.features.maxChars || 'unlimited',
                voices: m.features.defaultVoices.length > 0
                  ? m.features.defaultVoices.join(', ')
                  : 'use provider voice library',
              }
            : m.strategy === 'transcription'
              ? {
                  wordTimestamps: m.features.wordTimestamps,
                  diarization: m.features.diarization,
                  languageDetection: m.features.languageDetection,
                  languageHint: m.features.languageHint,
                  inputFormats: m.features.inputFormats.join(', '),
                  maxDurationSec: m.features.maxDurationSec || 'unlimited',
                }
              : {
                editing: m.features.editing,
                inpainting: m.features.inpainting,
                seed: m.features.seed,
                multipleImages: m.features.multipleImages,
                aspectRatios: m.features.aspectRatios.join(', ') || 'none',
                ...(m.features.sizes ? { sizes: m.features.sizes.join(', ') } : {}),
              },
    }))

    if (options.json) {
      console.log(JSON.stringify(output, null, 2))
    } else {
      console.log(yaml.dump(output, { lineWidth: 120, noRefs: true }))
    }
  })

/** Upload gateway base URL for temporary file uploads. */
const UPLOAD_GATEWAY_BASE = 'https://egaki.org'
/** Max upload size in bytes (must match gateway limit). */
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024

cli.help()
cli.version(pkg.version)
await cli.parse()

// ─── error output helpers ────────────────────────────────────────────────────

type PrintableValue = unknown
type ErrorDetailsInput = Parameters<typeof APICallError.isInstance>[0]

async function runProviderCall<T>(operation: string, call: () => Promise<Error | T>): Promise<T> {
  const result = await call().catch((error) => {
    printErrorDetails(error, operation)
    process.exit(1)
  })
  if (result instanceof Error) {
    // Validation errors get a clean one-line message; provider/runtime errors
    // get full details (status code, response body, stack trace, etc.).
    if (result instanceof ValidationError) {
      console.error(pc.red(result.message))
      process.exit(1)
    }
    printErrorDetails(result, operation)
    process.exit(1)
  }
  return result
}

function printErrorDetails(error: ErrorDetailsInput, operation?: string): void {
  const prefix = operation ? `${operation} failed` : 'Command failed'
  console.error(pc.red(pc.bold(prefix)))

  if (APICallError.isInstance(error)) {
    printKeyValue('name', error.name)
    printKeyValue('message', error.message)
    printKeyValue('statusCode', error.statusCode)
    printKeyValue('url', error.url)
    printKeyValue('isRetryable', error.isRetryable)
    printJsonBlock('responseBody', parseJsonLike(error.responseBody))
    printJsonBlock('responseHeaders', error.responseHeaders)
    printJsonBlock('requestBodyValues', error.requestBodyValues)
    printJsonBlock('data', error.data)
    printCause(error.cause)
    printStack(error)
    return
  }

  if (NoImageGeneratedError.isInstance(error) || NoVideoGeneratedError.isInstance(error)) {
    printKeyValue('name', error.name)
    printKeyValue('message', error.message)
    printJsonBlock('responses', error.responses)
    printCause(error.cause)
    printStack(error)
    return
  }

  if (RetryError.isInstance(error)) {
    printKeyValue('name', error.name)
    printKeyValue('message', error.message)
    printKeyValue('reason', error.reason)
    printJsonBlock('errors', error.errors.map((e) => serializeUnknown(e)))
    printCause(error.cause)
    printStack(error)
    return
  }

  if (error instanceof Error) {
    printKeyValue('name', error.name)
    printKeyValue('message', error.message)
    // @ai-sdk/xai discards statusResponse.error when status==='failed',
    // so XAI_VIDEO_GENERATION_FAILED carries no useful info. Add a hint.
    if (error.name === 'XAI_VIDEO_GENERATION_FAILED') {
      console.error(
        pc.dim(
          'hint: xAI returned status "failed" but @ai-sdk/xai discards the error details.\n' +
            'Common causes: invalid/corrupt input image, content policy violation, or transient backend error.\n' +
            'To see the real error, poll the video status endpoint manually:\n' +
            '  curl https://api.x.ai/v1/videos/<request_id> -H "Authorization: Bearer $TOKEN"',
        ),
      )
    }
    printJsonBlock('details', serializeOwnProperties(error))
    printCause(error.cause)
    printStack(error)
    return
  }

  printJsonBlock('error', serializeUnknown(error))
}

function printKeyValue(key: string, value: PrintableValue): void {
  if (value === undefined) return
  console.error(`${pc.dim(`${key}:`)} ${String(value)}`)
}

function printJsonBlock(label: string, value: PrintableValue): void {
  if (value === undefined) return
  const serialized = stableStringify(value)
  if (!serialized || serialized === '{}') return
  console.error(pc.dim(`${label}:`))
  console.error(serialized)
}

function printCause(cause: Error['cause']): void {
  if (cause === undefined) return
  console.error(pc.dim('cause:'))
  console.error(stableStringify(serializeUnknown(cause)))
}

function printStack(error: Error): void {
  if (!error.stack) return
  console.error(pc.dim('stack:'))
  console.error(pc.dim(error.stack))
}

function parseJsonLike(value?: string): PrintableValue {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function serializeUnknown(value: ErrorDetailsInput): PrintableValue {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...serializeOwnProperties(value),
      ...(value.cause === undefined ? {} : { cause: serializeUnknown(value.cause) }),
      ...(value.stack ? { stack: value.stack } : {}),
    }
  }
  return value
}

function serializeOwnProperties(error: Error): Record<string, PrintableValue> {
  return Object.fromEntries(
    Object.entries(error).map(([key, value]) => [key, serializeUnknown(value)]),
  )
}

function stableStringify(value: PrintableValue): string | undefined {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString()
    if (item instanceof Date) return item.toISOString()
    if (typeof item !== 'object' || item === null) return item
    if (seen.has(item)) return '[Circular]'
    seen.add(item)
    return item
  }, 2)
}

// ─── interactive model pickers ──────────────────────────────────────────────

/** Curated image models shown in the interactive picker, ordered by recommendation. */
const FEATURED_IMAGE_MODELS = [
  'imagen-4.0-generate-001',
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-fast-generate-001',
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'nano-banana-pro-preview',
  'gpt-image-2',
  'gpt-image-1.5',
  'chatgpt-image-latest',
  'flux-kontext-pro',
  'flux-kontext-max',
  'flux-pro-1.1-ultra',
  'recraft-v4',
  'dall-e-3',
  'grok-imagine-image-quality',
]

/**
 * Resolve the image model: show interactive picker in TTY, use default otherwise.
 */
async function resolveImageModel(): Promise<string> {
  const isTTY = process.stdin.isTTY && process.stderr.isTTY
  if (!isTTY) return DEFAULT_MODEL

  const options = FEATURED_IMAGE_MODELS
    .map((id) => CATALOG.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => {
      const cost = m!.cost.type === 'per-image'
        ? pc.dim(`$${m!.cost.perImage}/img`)
        : m!.cost.type === 'per-token'
          ? pc.dim(`$${m!.cost.outputPerM}/M out`)
          : ''
      return {
        value: m!.id,
        label: `${m!.name} ${cost}`,
        hint: m!.id,
      }
    })

  const selected = await select({
    message: 'Select an image model',
    options,
  })

  if (isCancel(selected)) {
    cancel('Cancelled.')
    process.exit(0)
  }

  return selected
}

/**
 * Resolve the video model: show interactive picker in TTY, use default otherwise.
 */
async function resolveVideoModel(): Promise<string> {
  const isTTY = process.stdin.isTTY && process.stderr.isTTY
  if (!isTTY) return DEFAULT_VIDEO_MODEL

  const options = VIDEO_CATALOG.map((m) => {
    const dur = m.features.durationRangeSec
      ? pc.dim(`${m.features.durationRangeSec.min}-${m.features.durationRangeSec.max}s`)
      : ''
    return {
      value: m.id,
      label: `${m.name} ${dur}`,
      hint: m.id,
    }
  })

  const selected = await select({
    message: 'Select a video model',
    options,
  })

  if (isCancel(selected)) {
    cancel('Cancelled.')
    process.exit(0)
  }

  return selected
}

/**
 * Resolve the speech model: show interactive picker in TTY, use default otherwise.
 */
async function resolveSpeechModel(): Promise<string> {
  const isTTY = process.stdin.isTTY && process.stderr.isTTY
  if (!isTTY) return DEFAULT_SPEECH_MODEL

  const options = SPEECH_CATALOG.map((m) => {
    const cost = pc.dim(`$${m.cost.perMillionChars}/M chars`)
    return {
      value: m.id,
      label: `${m.name} ${cost}`,
      hint: m.id,
    }
  })

  const selected = await select({
    message: 'Select a speech model',
    options,
  })

  if (isCancel(selected)) {
    cancel('Cancelled.')
    process.exit(0)
  }

  return selected
}

/**
 * Resolve the transcription model: show interactive picker in TTY, use default otherwise.
 */
async function resolveTranscriptionModel(): Promise<string> {
  const isTTY = process.stdin.isTTY && process.stderr.isTTY
  if (!isTTY) return DEFAULT_TRANSCRIPTION_MODEL

  const options = TRANSCRIPTION_CATALOG.map((m) => {
    const cost = pc.dim(`${formatCost(m.cost.perSecond * 60)}/min`)
    return {
      value: m.id,
      label: `${m.name} ${cost}`,
      hint: m.id,
    }
  })

  const selected = await select({
    message: 'Select a transcription model',
    options,
  })

  if (isCancel(selected)) {
    cancel('Cancelled.')
    process.exit(0)
  }

  return selected
}

/**
 * Read text from stdin (for piping: cat file.txt | egaki speech --stdin).
 */
async function readTextFromStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8').trim()
}

function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input)
}

function mimeTypeFromExtension(ext: string): string {
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pcm': 'audio/pcm',
    '.opus': 'audio/opus',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
  }
  return map[ext.toLowerCase()] || 'application/octet-stream'
}

/**
 * Upload a local file to the egaki gateway and return the public URL.
 * Used when a flag that expects a URL receives a local file path instead.
 */
async function uploadFileToGateway(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    console.error(pc.red(`File not found: ${resolved}`))
    process.exit(1)
  }

  const stat = fs.statSync(resolved)
  if (stat.size > MAX_UPLOAD_SIZE) {
    console.error(pc.red(`File too large: ${resolved} (${Math.round(stat.size / 1024 / 1024)}MB). Maximum is ${MAX_UPLOAD_SIZE / 1024 / 1024}MB`))
    process.exit(1)
  }

  const ext = path.extname(resolved)
  const contentType = mimeTypeFromExtension(ext)
  const fileBytes = fs.readFileSync(resolved)

  console.error(pc.dim(`Uploading ${filePath}...`))

  const response = await fetch(`${UPLOAD_GATEWAY_BASE}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: fileBytes,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error(pc.red(`Upload failed: ${response.status} ${response.statusText}`))
    if (body) console.error(pc.dim(body))
    process.exit(1)
  }

  const result = await response.json() as { url: string }
  console.error(pc.dim(`Uploaded: ${result.url}`))
  return result.url
}

/**
 * Resolve a value that should be a URL: if it's already a URL, return as-is.
 * If it's a local file path, upload it to the gateway and return the public URL.
 */
async function resolveToUrl(input: string): Promise<string> {
  if (isUrl(input)) return input
  return uploadFileToGateway(input)
}

async function readInputSource(input: string): Promise<Uint8Array> {
  if (isUrl(input)) {
    console.error(pc.dim(`Fetching ${input}...`))
    const res = await fetch(input)
    if (!res.ok) {
      console.error(pc.red(`Failed to fetch ${input}: ${res.status} ${res.statusText}`))
      process.exit(1)
    }
    return new Uint8Array(await res.arrayBuffer())
  }
  const resolved = path.resolve(input)
  if (!fs.existsSync(resolved)) {
    console.error(pc.red(`File not found: ${resolved}`))
    process.exit(1)
  }
  return new Uint8Array(fs.readFileSync(resolved))
}

async function readInputImages(
  inputs: string[] | undefined,
): Promise<Uint8Array[]> {
  if (!inputs || inputs.length === 0) {
    return []
  }
  return Promise.all(inputs.map((f) => readInputSource(f)))
}

// ─── shared output helpers ───────────────────────────────────────────────────

function saveGeneratedFiles(
  files: GeneratedFile[],
  outputPath: string,
): string[] {
  const savedFiles: string[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!
    const ext = extensionFromMediaType(file.mediaType)
    const filePath =
      files.length === 1
        ? ensureExtension(outputPath, ext)
        : insertIndex(outputPath, i, ext)

    fs.writeFileSync(filePath, file.uint8Array)
    console.error(pc.green(`Saved: ${filePath}`))
    savedFiles.push(filePath)
  }
  return savedFiles
}

function printCost(cost: number | null): void {
  if (cost != null) {
    console.error(pc.dim(`Cost: ${formatCost(cost)}`))
  }
}

function writeFirstToStdout(files: GeneratedFile[]): void {
  const file = files[0]
  if (file) {
    process.stdout.write(Buffer.from(file.uint8Array))
  }
}

// ─── display helpers ─────────────────────────────────────────────────────────

function formatCatalogCost(
  cost: {
    type: 'per-image'
    perImage: number
  } | {
    type: 'per-token'
    inputPerM: number
    outputPerM: number
  } | {
    type: 'per-video-second'
    defaultDurationSec: number
    tiers: Array<{ resolution?: string; mode?: string; audio?: boolean; costPerSecond: number }>
  } | {
    type: 'per-character'
    perMillionChars: number
  } | {
    type: 'per-second'
    perSecond: number
  } | {
    type: 'unknown'
  },
): string {
  if (cost.type === 'per-image') {
    return `$${cost.perImage}/image`
  }
  if (cost.type === 'per-token') {
    return `$${cost.inputPerM}/M input, $${cost.outputPerM}/M output`
  }
  if (cost.type === 'per-character') {
    return `$${cost.perMillionChars}/M chars`
  }
  if (cost.type === 'per-second') {
    return `${formatCost(cost.perSecond * 60)}/min`
  }
  if (cost.type === 'per-video-second') {
    const tierText = cost.tiers
      .map((t) => {
        const parts = [
          t.resolution,
          t.mode ? `mode=${t.mode}` : undefined,
          t.audio != null ? `audio=${t.audio}` : undefined,
        ].filter(Boolean)
        return parts.length > 0
          ? `$${t.costPerSecond}/s (${parts.join(', ')})`
          : `$${t.costPerSecond}/s`
      })
      .join('; ')
    return `${tierText} (default duration ${cost.defaultDurationSec}s)`
  }
  return 'unknown'
}

function formatCost(dollars: number): string {
  if (dollars < 0.0001) {
    return `$${dollars.toFixed(6)}`
  }
  if (dollars < 0.01) {
    return `$${dollars.toFixed(4)}`
  }
  return `$${dollars.toFixed(2)}`
}

function extensionFromMediaType(mediaType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/pcm': '.pcm',
    'audio/opus': '.opus',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    'audio/ogg': '.ogg',
  }
  if (map[mediaType]) return map[mediaType]!
  if (mediaType.startsWith('audio/')) return '.mp3'
  if (mediaType.startsWith('video/')) return '.mp4'
  return '.png'
}

function ensureExtension(filePath: string, ext: string): string {
  const parsed = path.parse(filePath)
  if (parsed.ext) {
    return filePath
  }
  return filePath + ext
}

function insertIndex(filePath: string, index: number, ext: string): string {
  const parsed = path.parse(filePath)
  const finalExt = parsed.ext || ext
  return path.join(parsed.dir, `${parsed.name}-${index}${finalExt}`)
}

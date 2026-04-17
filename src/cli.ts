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
  generateImage as aiGenerateImage,
  generateText,
  experimental_generateVideo as aiGenerateVideo,
} from 'ai'
import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import { createParser, type EventSourceMessage } from 'eventsource-parser'
import pkg from '../package.json' with { type: 'json' }
import {
  injectCredentialsToEnv,
  PROVIDERS,
  getChatGptAuth,
  saveChatGptAuth,
} from './credentials.js'
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  DEFAULT_MODEL,
  DEFAULT_VIDEO_MODEL,
  getModelConfig,
  createImageModel,
  createTextModel,
  createVideoModel,
  shouldUseResponsesApi,
} from './models.js'
import { VIDEO_CATALOG } from './video-model-catalog.js'
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
import { getValidChatGptAuth } from './chatgpt-auth.js'

const cli = goke('egaki')

process.title = 'egaki'

// Print clean error output for unhandled rejections (e.g. AI SDK APICallError).
// The AI SDK errors include request bodies, response headers, and other noisy
// properties that get dumped by Node's default handler. We strip those and just
// print the message + stack trace.
process.on('uncaughtException', (err) => {
  console.error(pc.red(err.message))
  if (err.stack) {
    const lines = err.stack.split('\n')
    const stackOnly = lines.filter((l) => l.trimStart().startsWith('at '))
    if (stackOnly.length > 0) {
      console.error(pc.dim(stackOnly.join('\n')))
    }
  }
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
      // ChatGPT uses browser OAuth — skip key reading
      if (options.provider === 'chatgpt') {
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
    z.enum(IMAGE_MODELS).default(DEFAULT_MODEL).describe('Model ID for generation'),
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
    // Inject stored API keys as env vars before calling the AI SDK.
    injectCredentialsToEnv()

    // goke infers schema .default() values via Zod's input type, which leaves
    // options.model / options.output / options.count as `T | undefined` even
    // though the runtime always resolves them. Apply the same defaults here.
    const model = options.model ?? DEFAULT_MODEL
    const outputPath = options.output ?? 'egaki-output.png'
    const count = options.count ?? 1
    const config = getModelConfig(model)

    if (!options.stdout) {
      console.error(pc.dim(`Model: ${model}`))
      console.error(pc.dim(`Prompt: ${prompt}`))
    }

    const inputImages = await readInputImages(options.input)
    const maskImage = options.mask
      ? await readInputSource(options.mask)
      : undefined

    // When using ChatGPT OAuth with OpenAI image models, route through the
    // Responses API + imageGeneration tool instead of the Image API.
    // The Codex OAuth client lacks the `api.model.images.request` scope.
    const useResponsesApi = config.strategy === 'image' && shouldUseResponsesApi(model)

    if (useResponsesApi) {
      if (!options.stdout) {
        console.error(pc.dim('Mode: Responses API (ChatGPT OAuth)'))
      }
      await generateWithResponsesApi({
        prompt,
        model,
        outputPath,
        inputImages,
        json: options.json || false,
        stdout: options.stdout || false,
      })
    } else if (config.strategy === 'image') {
      await generateWithImageModel({
        prompt,
        model,
        outputPath,
        count,
        aspectRatio: options.aspectRatio as `${number}:${number}` | undefined,
        seed: options.seed,
        inputImages,
        maskImage,
        allowPeople: options.allowPeople || false,
        json: options.json || false,
        stdout: options.stdout || false,
      })
    } else {
      await generateWithTextModel({
        prompt,
        model,
        outputPath,
        inputImages,
        imageSize: options.imageSize,
        aspectRatio: options.aspectRatio,
        json: options.json || false,
        stdout: options.stdout || false,
      })
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
    z.enum(VIDEO_MODELS).default(DEFAULT_VIDEO_MODEL).describe('Video model ID for generation'),
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
      .describe('Video resolution in WIDTHxHEIGHT or provider format (e.g. 1280x720, 720p)'),
  )
  .option(
    '--duration [seconds]',
    z.number().describe('Video duration in seconds (provider/model-specific limits apply)'),
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
        'Optional reference image for image-to-video. Accepts local file path or URL (http/https)',
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

    // Apply the same .default(...) values goke's input-type inference drops.
    const model = options.model ?? DEFAULT_VIDEO_MODEL
    const outputPath = options.output ?? 'egaki-output.mp4'
    const count = options.count ?? 1
    const config = getModelConfig(model)

    if (config.strategy !== 'video') {
      console.error(pc.red(`Model ${model} is not a video model`))
      process.exit(1)
    }

    if (!options.stdout) {
      console.error(pc.dim(`Model: ${model}`))
      console.error(pc.dim(`Prompt: ${prompt}`))
      console.error(pc.dim('Mode: Video API (experimental_generateVideo)'))
    }

    const inputImage = options.input
      ? await readInputSource(options.input)
      : undefined

    await generateWithVideoModel({
      prompt,
      model,
      outputPath,
      count,
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      duration: options.duration,
      fps: options.fps,
      seed: options.seed,
      inputImage,
      json: options.json || false,
      stdout: options.stdout || false,
    })
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
      .enum(['all', 'image', 'video'])
      .default('all')
      .describe('Filter by model type: image (image+text-image), video, or all'),
  )
  .option('--json', 'Output as JSON instead of YAML')
  .action(async (options) => {
    const { CATALOG } = await import('./model-catalog.js')
    const yaml = await import('js-yaml')

    let models = options.type === 'video'
      ? VIDEO_CATALOG
      : options.type === 'image'
        ? CATALOG
        : [...CATALOG, ...VIDEO_CATALOG]

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

cli.help()
cli.version(pkg.version)
cli.parse()

function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input)
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

// Generate using the dedicated generateImage API (Imagen models)
async function generateWithImageModel({
  prompt,
  model,
  outputPath,
  count,
  aspectRatio,
  seed,
  inputImages,
  maskImage,
  allowPeople,
  json,
  stdout,
}: {
  prompt: string
  model: string
  outputPath: string
  count: number
  aspectRatio?: `${number}:${number}`
  seed?: number
  inputImages: Uint8Array[]
  maskImage?: Uint8Array
  allowPeople: boolean
  json: boolean
  stdout: boolean
}) {
  // Build the prompt: plain string or multimodal with reference images
  const imagePrompt = inputImages.length > 0
    ? { text: prompt, images: inputImages, ...(maskImage ? { mask: maskImage } : {}) }
    : prompt

  const config = getModelConfig(model)
  const imageModel = await createImageModel(model)

  // Use the correct providerOptions key based on provider (google vs vertex)
  const providerOptionsKey = config.provider === 'vertex' ? 'vertex' : 'google'

  if (!stdout) {
    console.error(pc.cyan('Generating...'))
  }

  const result = await aiGenerateImage({
    model: imageModel,
    prompt: imagePrompt,
    n: count,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(seed !== undefined ? { seed } : {}),
    providerOptions: {
      [providerOptionsKey]: {
        ...(allowPeople ? { personGeneration: 'allow_all' } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
      },
    },
  })

  if (stdout) {
    // Write first image to stdout for piping
    const image = result.images[0]
    if (image) {
      process.stdout.write(Buffer.from(image.uint8Array))
    }
    return
  }

  const savedFiles: string[] = []
  for (let i = 0; i < result.images.length; i++) {
    const image = result.images[i]!
    const ext = extensionFromMediaType(image.mediaType)
    const filePath =
      result.images.length === 1
        ? ensureExtension(outputPath, ext)
        : insertIndex(outputPath, i, ext)

    fs.writeFileSync(filePath, image.uint8Array)
    console.error(pc.green(`Saved: ${filePath}`))
    savedFiles.push(filePath)
  }

  const cost = calculateCost(config.cost, result.usage, result.images.length)
  if (cost != null) {
    console.error(pc.dim(`Cost: ${formatCost(cost)}`))
  }

  if (json) {
    const output = {
      model,
      files: savedFiles,
      count: result.images.length,
      cost,
      usage: result.usage,
      warnings: result.warnings,
    }
    console.log(JSON.stringify(output, null, 2))
  }
}

// Generate using generateText with responseModalities (Gemini multimodal models)
async function generateWithTextModel({
  prompt,
  model,
  outputPath,
  inputImages,
  imageSize,
  aspectRatio,
  json,
  stdout,
}: {
  prompt: string
  model: string
  outputPath: string
  inputImages: Uint8Array[]
  imageSize?: '1K' | '2K' | '4K'
  aspectRatio?: string
  json: boolean
  stdout: boolean
}) {
  const textModel = await createTextModel(model)
  const config = getModelConfig(model)
  const providerOptionsKey = config.provider === 'vertex' ? 'vertex' : 'google'

  if (!stdout) {
    console.error(pc.cyan('Generating...'))
  }

  // Build messages: if we have input images, create a multimodal prompt
  const messages = inputImages.length > 0
    ? [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: prompt },
            ...inputImages.map((img) => ({
              type: 'image' as const,
              image: img,
            })),
          ],
        },
      ]
    : undefined

  const result = await generateText({
    model: textModel,
    ...(messages ? { messages } : { prompt }),
    providerOptions: {
      [providerOptionsKey]: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(imageSize || aspectRatio
          ? {
              imageConfig: {
                ...(imageSize ? { imageSize } : {}),
                ...(aspectRatio ? { aspectRatio } : {}),
              },
            }
          : {}),
      },
    },
  })

  const imageFiles = result.files.filter((f) => {
    return f.mediaType.startsWith('image/')
  })

  if (imageFiles.length === 0) {
    console.error(pc.red('No images generated.'))
    process.exit(1)
  }

  if (stdout) {
    const file = imageFiles[0]
    if (file) {
      process.stdout.write(Buffer.from(file.uint8Array))
    }
    return
  }

  const savedFiles: string[] = []
  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i]!
    const ext = extensionFromMediaType(file.mediaType)
    const filePath =
      imageFiles.length === 1
        ? ensureExtension(outputPath, ext)
        : insertIndex(outputPath, i, ext)

    fs.writeFileSync(filePath, file.uint8Array)
    console.error(pc.green(`Saved: ${filePath}`))
    savedFiles.push(filePath)
  }

  const cost = calculateCost(config.cost, result.usage, imageFiles.length)
  if (cost != null) {
    console.error(pc.dim(`Cost: ${formatCost(cost)}`))
  }

  if (result.text && !json) {
    console.error(pc.dim(result.text))
  }

  if (json) {
    const output = {
      model,
      files: savedFiles,
      count: imageFiles.length,
      text: result.text || null,
      cost,
      usage: result.usage,
    }
    console.log(JSON.stringify(output, null, 2))
  }
}

// Generate using the OpenAI Responses API with imageGeneration tool.
// Used when auth comes from ChatGPT OAuth (no Image API scope).
async function generateWithResponsesApi({
  prompt,
  model,
  outputPath,
  inputImages,
  json,
  stdout,
}: {
  prompt: string
  model: string
  outputPath: string
  inputImages: Uint8Array[]
  json: boolean
  stdout: boolean
}) {
  if (inputImages.length > 0) {
    console.error(pc.red('ChatGPT image generation with input images is not supported yet.'))
    process.exit(1)
  }

  const storedAuth = getChatGptAuth()
  if (!storedAuth?.accountId) {
    console.error(pc.red('Missing ChatGPT account metadata. Please run `egaki login --provider chatgpt` again.'))
    process.exit(1)
  }

  const auth = await getValidChatGptAuth(storedAuth, saveChatGptAuth)
  if (auth instanceof Error) {
    console.error(pc.red(auth.message))
    process.exit(1)
  }

  if (!stdout) {
    console.error(pc.cyan('Generating...'))
  }

  const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.access}`,
      'ChatGPT-Account-ID': auth.accountId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5.4',
      instructions: 'You are Codex.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      ],
      tools: [
        {
          type: 'image_generation',
          model,
          size: 'auto',
          quality: 'auto',
          output_format: 'png',
          output_compression: 100,
          moderation: 'auto',
        },
      ],
      tool_choice: 'auto',
      parallel_tool_calls: true,
      stream: true,
      store: false,
      include: [],
    }),
  })

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '')
    console.error(pc.red(`ChatGPT image generation failed: ${response.status}`))
    if (body) console.error(pc.dim(body))
    process.exit(1)
  }

  let imageBase64: string | undefined
  let revisedPrompt: string | null = null

  const processSseMessage = (message: EventSourceMessage) => {
    if (!message.data) return
    try {
      const event = JSON.parse(message.data) as {
        type?: string
        partial_image_b64?: string
        item?: { type?: string; result?: string; revised_prompt?: string | null }
      }
      if (
        event.type === 'response.image_generation_call.partial_image' &&
        event.partial_image_b64 &&
        !imageBase64
      ) {
        imageBase64 = event.partial_image_b64
      }
      if (
        event.type === 'response.output_item.done' &&
        event.item?.type === 'image_generation_call'
      ) {
        if (event.item.result) imageBase64 = event.item.result
        revisedPrompt = event.item.revised_prompt ?? revisedPrompt
      }
    } catch {
      // Ignore keepalive and partial parse noise.
    }
  }

  const parser = createParser({
    onEvent: processSseMessage,
  })

  const decoder = new TextDecoder()

  for await (const chunk of response.body) {
    parser.feed(decoder.decode(chunk, { stream: true }))
  }
  parser.feed(decoder.decode())

  if (!imageBase64) {
    console.error(pc.red('No images generated.'))
    process.exit(1)
  }

  const imageBytes = Buffer.from(imageBase64, 'base64')
  const mediaType = 'image/png'

  if (stdout) {
    process.stdout.write(imageBytes)
    return
  }

  const savedFiles: string[] = []
  const filePath = ensureExtension(outputPath, extensionFromMediaType(mediaType))
  fs.writeFileSync(filePath, imageBytes)
  console.error(pc.green(`Saved: ${filePath}`))
  savedFiles.push(filePath)

  if (revisedPrompt && !json) {
    console.error(pc.dim(`Revised prompt: ${revisedPrompt}`))
  }

  if (json) {
    const output = {
      model,
      files: savedFiles,
      count: 1,
      revisedPrompt,
    }
    console.log(JSON.stringify(output, null, 2))
  }
}

// Generate using experimental_generateVideo (video models)
async function generateWithVideoModel({
  prompt,
  model,
  outputPath,
  count,
  aspectRatio,
  resolution,
  duration,
  fps,
  seed,
  inputImage,
  json,
  stdout,
}: {
  prompt: string
  model: string
  outputPath: string
  count: number
  aspectRatio?: string
  resolution?: string
  duration?: number
  fps?: number
  seed?: number
  inputImage?: Uint8Array
  json: boolean
  stdout: boolean
}) {
  const videoModel = await createVideoModel(model)

  if (!stdout) {
    console.error(pc.cyan('Generating...'))
  }

  const result = await aiGenerateVideo({
    model: videoModel,
    prompt: inputImage
      ? { image: inputImage, text: prompt }
      : prompt,
    n: count,
    ...(aspectRatio ? { aspectRatio: aspectRatio as `${number}:${number}` } : {}),
    ...(resolution ? { resolution: resolution as `${number}x${number}` } : {}),
    ...(duration != null ? { duration } : {}),
    ...(fps != null ? { fps } : {}),
    ...(seed != null ? { seed } : {}),
  })

  if (stdout) {
    const video = result.videos[0]
    if (video) {
      process.stdout.write(Buffer.from(video.uint8Array))
    }
    return
  }

  const savedFiles: string[] = []
  for (let i = 0; i < result.videos.length; i++) {
    const video = result.videos[i]!
    const ext = extensionFromMediaType(video.mediaType)
    const filePath =
      result.videos.length === 1
        ? ensureExtension(outputPath, ext)
        : insertIndex(outputPath, i, ext)

    fs.writeFileSync(filePath, video.uint8Array)
    console.error(pc.green(`Saved: ${filePath}`))
    savedFiles.push(filePath)
  }

  const config = getModelConfig(model)
  const cost = calculateCost(config.cost, {
    videosGenerated: result.videos.length,
    durationSeconds: duration,
    resolution,
  }, result.videos.length)
  if (cost != null) {
    console.error(pc.dim(`Cost: ${formatCost(cost)}`))
  }

  if (json) {
    const output = {
      model,
      files: savedFiles,
      count: result.videos.length,
      cost,
      warnings: result.warnings,
      responses: result.responses,
    }
    console.log(JSON.stringify(output, null, 2))
  }
}

// ─── cost helpers ────────────────────────────────────────────────────────────

function calculateCost(
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
    tiers: Array<{ resolution?: string; costPerSecond: number }>
  } | {
    type: 'unknown'
  },
  usage: {
    inputTokens?: number
    outputTokens?: number
    imagesGenerated?: number
    videosGenerated?: number
    durationSeconds?: number
    resolution?: string
  },
  count: number = 1,
): number | null {
  if (cost.type === 'per-image') {
    return cost.perImage * count
  }
  if (cost.type === 'per-token' && usage.inputTokens != null && usage.outputTokens != null) {
    return (
      (usage.inputTokens * cost.inputPerM + usage.outputTokens * cost.outputPerM) / 1_000_000
    )
  }
  if (cost.type === 'per-video-second') {
    const durationSec = usage.durationSeconds ?? cost.defaultDurationSec
    const resolution = normalizeResolutionKey(usage.resolution)
    const tier =
      cost.tiers.find((t) => normalizeResolutionKey(t.resolution) === resolution) ??
      cost.tiers[0]
    if (!tier) {
      return null
    }
    return tier.costPerSecond * durationSec * count
  }
  return null
}

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
    type: 'unknown'
  },
): string {
  if (cost.type === 'per-image') {
    return `$${cost.perImage}/image`
  }
  if (cost.type === 'per-token') {
    return `$${cost.inputPerM}/M input, $${cost.outputPerM}/M output`
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
  }
  return map[mediaType] || (mediaType.startsWith('video/') ? '.mp4' : '.png')
}

function normalizeResolutionKey(input?: string): string | undefined {
  if (!input) return undefined
  const normalized = input.trim().toLowerCase()
  if (normalized === '1920x1080') return '1080p'
  if (normalized === '1280x720') return '720p'
  if (normalized === '854x480' || normalized === '848x480') return '480p'
  return normalized
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

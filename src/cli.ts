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
import { generateImage as aiGenerateImage, generateText } from 'ai'
import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import pkg from '../package.json' with { type: 'json' }
import { injectCredentialsToEnv, PROVIDERS } from './credentials.js'
import {
  IMAGE_MODELS,
  DEFAULT_MODEL,
  getModelConfig,
  createImageModel,
  createTextModel,
} from './models.js'
import {
  loginInteractive,
  loginNonInteractive,
  showLoginStatus,
  removeLogin,
  readKeyFromStdin,
} from './login.js'

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
      const key = options.key || (await readKeyFromStdin())
      loginNonInteractive({ provider: options.provider, key })
      return
    }

    // Interactive mode
    await loginInteractive()
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
  .example('# Generate multiple images')
  .example('egaki image "abstract art" -n 4 -o art.png')
  .example('# Pipe to another tool')
  .example('egaki image "logo design" --stdout | convert - -resize 512x512 logo.png')
  .action(async (prompt, options) => {
    // Inject stored API keys as env vars before calling the AI SDK
    injectCredentialsToEnv()

    const model = options.model
    const outputPath = options.output
    const config = getModelConfig(model)

    if (!options.stdout) {
      console.error(pc.dim(`Model: ${model}`))
      console.error(pc.dim(`Prompt: ${prompt}`))
      console.error(
        pc.dim(
          config.strategy === 'image'
            ? 'Mode: Image API (generateImage)'
            : 'Mode: Text+Image (generateText)',
        ),
      )
    }

    const inputImages = await readInputImages(options.input)
    const maskImage = options.mask
      ? await readInputSource(options.mask)
      : undefined

    if (config.strategy === 'image') {
      await generateWithImageModel({
        prompt,
        model,
        outputPath,
        count: options.count,
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

  const imageModel = await createImageModel(model)

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
      google: {
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

  if (json) {
    const output = {
      model,
      files: savedFiles,
      count: result.images.length,
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
      google: {
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

  if (result.text && !json) {
    console.error(pc.dim(result.text))
  }

  if (json) {
    const output = {
      model,
      files: savedFiles,
      count: imageFiles.length,
      text: result.text || null,
      usage: result.usage,
    }
    console.log(JSON.stringify(output, null, 2))
  }
}

function extensionFromMediaType(mediaType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return map[mediaType] || '.png'
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

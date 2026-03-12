// Antigravity image generation bridge for egaki.
// Handles direct Antigravity OAuth requests without provider fallback.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import pc from 'picocolors'
import { getAntigravityAuth, saveAntigravityAuth } from './credentials.js'
import { getValidAntigravityAccessToken } from './antigravity-auth.js'

type AntigravityErrorPayload = {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: Array<{
      metadata?: Record<string, string>
      links?: Array<{ description?: string; url?: string }>
    }>
  }
}

export async function generateWithAntigravityModel({
  prompt,
  model,
  outputPath,
  inputImages,
  aspectRatio,
  count,
  json,
  stdout,
}: {
  prompt: string
  model: string
  outputPath: string
  inputImages: Uint8Array[]
  aspectRatio?: string
  count: number
  json: boolean
  stdout: boolean
}) {
  const auth = getAntigravityAuth()
  if (!auth) {
    console.error(pc.red('Missing Antigravity OAuth login. Run: egaki login --provider antigravity'))
    process.exit(1)
  }

  const token = await getValidAntigravityAccessToken(auth, (updated) => {
    saveAntigravityAuth(updated)
  })
  if (token instanceof Error) {
    console.error(pc.red(token.message))
    process.exit(1)
  }

  if (!stdout) {
    console.error(pc.cyan('Generating...'))
  }

  const actualModel = resolveAntigravityModel(model)
  const projectCandidates = [
    process.env['ANTIGRAVITY_PROJECT_ID'],
    token.projectId,
    ...getGcloudProjectIds(),
  ].filter((value, index, array): value is string => {
    return Boolean(value) && array.indexOf(value) === index
  })

  const userParts: Array<Record<string, unknown>> = [{ text: prompt }]
  for (const image of inputImages) {
    userParts.push({
      inlineData: {
        mimeType: detectImageMimeType(image),
        data: Buffer.from(image).toString('base64'),
      },
    })
  }

  const baseRequest = {
    sessionId: `egaki-${crypto.randomUUID()}`,
    systemInstruction: {
      role: 'user',
      parts: [{ text: 'You are an AI image generator. Generate images based on user descriptions.' }],
    },
    contents: [
      {
        role: 'user',
        parts: userParts,
      },
    ],
    generationConfig: {
      candidateCount: count,
      imageConfig: {
        aspectRatio: aspectRatio || '1:1',
      },
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  }

  const antigravityAttempts = projectCandidates.map((projectId) => {
    return {
      mode: `antigravity:${projectId}`,
      endpoints: [
        'https://daily-cloudcode-pa.sandbox.googleapis.com',
        'https://autopush-cloudcode-pa.sandbox.googleapis.com',
        'https://cloudcode-pa.googleapis.com',
      ],
      payload: {
        project: projectId,
        model: actualModel,
        requestType: 'agent',
        userAgent: 'antigravity',
        requestId: `agent-${crypto.randomUUID()}`,
        request: baseRequest,
      },
    }
  })

  const attemptConfigs = antigravityAttempts

  let lastError = 'Unknown Antigravity API error'
  let responseBody: unknown
  let successfulProjectId: string | undefined

  for (const attempt of attemptConfigs) {
    for (const endpoint of attempt.endpoints) {
      const response = await fetch(`${endpoint}/v1internal:generateContent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'google-api-nodejs-client/9.15.1',
          'X-Goog-Api-Client': 'gl-node/22.17.0',
          'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
        },
        body: JSON.stringify(attempt.payload),
      })

      const text = await response.text()
      if (!response.ok) {
        lastError = formatAntigravityError({
          mode: attempt.mode,
          status: response.status,
          bodyText: text,
        })
        continue
      }

      responseBody = JSON.parse(text) as unknown
      if (typeof attempt.payload.project === 'string' && attempt.payload.project.length > 0) {
        successfulProjectId = attempt.payload.project
      }
      break
    }

    if (responseBody) {
      break
    }
  }

  if (!responseBody) {
    console.error(pc.red(lastError))
    process.exit(1)
  }

  if (successfulProjectId && successfulProjectId !== auth.projectId) {
    saveAntigravityAuth({ ...auth, projectId: successfulProjectId })
  }

  const generatedImages = extractAntigravityImages(responseBody)
  if (generatedImages.length === 0) {
    console.error(pc.red('No images generated by Antigravity response'))
    process.exit(1)
  }

  if (stdout) {
    process.stdout.write(generatedImages[0]!.bytes)
    return
  }

  const savedFiles: string[] = []
  for (let i = 0; i < generatedImages.length; i++) {
    const generated = generatedImages[i]!
    const filePath = generatedImages.length === 1
      ? ensureExtension(outputPath, extensionFromMediaType(generated.mediaType))
      : insertIndex(outputPath, i, extensionFromMediaType(generated.mediaType))
    fs.writeFileSync(filePath, generated.bytes)
    console.error(pc.green(`Saved: ${filePath}`))
    savedFiles.push(filePath)
  }

  if (json) {
    console.log(JSON.stringify({
      model,
      files: savedFiles,
      count: savedFiles.length,
      provider: 'antigravity',
      projectId: token.projectId,
    }, null, 2))
  }
}

function resolveAntigravityModel(modelId: string): string {
  if (modelId.startsWith('antigravity-')) {
    return modelId.slice('antigravity-'.length)
  }
  return modelId
}

function getGcloudProjectIds(): string[] {
  try {
    const output = execFileSync('gcloud', ['projects', 'list', '--format=value(projectId)', '--limit=50'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

function detectImageMimeType(bytes: Uint8Array): string {
  if (
    bytes.length > 3 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'image/jpeg'
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return 'image/png'
}

function extractAntigravityImages(payload: unknown): Array<{ bytes: Uint8Array; mediaType: string }> {
  const root = payload && typeof payload === 'object' && 'response' in (payload as Record<string, unknown>)
    ? (payload as { response?: unknown }).response
    : payload

  if (!root || typeof root !== 'object') {
    return []
  }

  const candidates = (root as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> }).candidates
  if (!candidates || candidates.length === 0) {
    return []
  }

  const images: Array<{ bytes: Uint8Array; mediaType: string }> = []

  for (const candidate of candidates) {
    for (const part of candidate.content?.parts || []) {
      const data = part.inlineData?.data
      if (!data) continue
      const mediaType = part.inlineData?.mimeType || 'image/png'
      images.push({
        bytes: new Uint8Array(Buffer.from(data, 'base64')),
        mediaType,
      })
    }
  }

  return images
}

function formatAntigravityError({
  mode,
  status,
  bodyText,
}: {
  mode: string
  status: number
  bodyText: string
}): string {
  const payload = parseAntigravityErrorPayload(bodyText)
  const message = payload?.error?.message || bodyText
  const metadata = payload?.error?.details?.find((detail) => detail.metadata)?.metadata
  const links = payload?.error?.details
    ?.flatMap((detail) => detail.links || [])
    .filter((link): link is { description?: string; url: string } => Boolean(link?.url))

  const verificationUrl = metadata?.['validation_url']
    || links?.find((link) => /verify/i.test(link.description || ''))?.url
  if (verificationUrl) {
    return [
      `${mode} API error ${status}: account verification required`,
      `Verify your Google account here: ${verificationUrl}`,
      `Backend message: ${message}`,
    ].join('\n')
  }

  const activationUrl = metadata?.['activationUrl']
    || metadata?.['activation_url']
    || links?.find((link) => /activation|console|api/i.test(link.description || ''))?.url
  if (activationUrl) {
    return [
      `${mode} API error ${status}: API access not configured`,
      `Enable required API here: ${activationUrl}`,
      `Backend message: ${message}`,
    ].join('\n')
  }

  return `${mode} API error ${status}: ${message}`
}

function parseAntigravityErrorPayload(bodyText: string): AntigravityErrorPayload | null {
  try {
    return JSON.parse(bodyText) as AntigravityErrorPayload
  } catch {
    return null
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

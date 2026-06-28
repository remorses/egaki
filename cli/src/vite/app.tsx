/**
 * Spiceflow entry for the video framework.
 *
 * The server has two jobs:
 *
 * 1. Deliver the MDX source string to the client through the RSC flight
 *    payload. All regular MDX processing (parsing, section splitting,
 *    expression evaluation, safe-mdx rendering) happens in the browser
 *    inside MdxClientApp (mdx-client.tsx, 'use client'), so MDX expression
 *    props can be functions and user components don't need 'use client'.
 *
 * 2. Render <Server> slots. <Server> is a reserved MDX element marking a
 *    subtree as server components: its children are rendered HERE in the
 *    RSC environment (async allowed, promises stream through flight) and
 *    passed to the client as serverSlots keyed by the node's start
 *    position. The MDX string sent to the client has each <Server> block
 *    blanked to a self-closing marker with newline padding, so every
 *    position (slot keys, data-markdown-line, sourcemaps) stays aligned
 *    with the original file and the client never parses server-only
 *    content.
 *
 * NOTE: Relative imports MUST include file extensions (.tsx, .ts) for the
 * RSC module runner to resolve them correctly within noExternal packages.
 */

import path from 'node:path'
import { createRequire } from 'node:module'
import type { ReactNode } from 'react'
import { Spiceflow } from 'spiceflow'
import { SafeMdxRenderer } from 'safe-mdx'
import { mdxParse } from 'safe-mdx/parse'
import type { EagerModules } from 'safe-mdx/parse'
import { entries, entryPaths, defaultRoute, projectRoot, folderName } from 'virtual:egaki-mdx'
import { Head } from 'spiceflow/react'
import {
  findServerNodes,
  blankServerContents,
  collectServerImportSources,
  filterImportNodesToModules,
  wrapGenerateNodes,
} from './server-mdx.ts'
import { parseFrontmatter, buildMdxScope } from './mdx-parse.ts'
import { MdxClientApp } from './mdx-client.tsx'
import * as mdxVideoExports from './mdx-video.tsx'
import {
  GeneratedImage,
  GeneratedVideo,
  GeneratedSpeech,
} from './server-components.tsx'
import {
  getGenerationProgress,
  onProgressChange,
  type GenerationProgressEvent,
} from '../cli/cached-generate.js'

/** Dynamically import the modules referenced inside <Server> blocks. */
async function importServerModules(ast: any): Promise<EagerModules> {
  const requireFromRoot = createRequire(path.join(projectRoot, 'package.json'))

  const modules: EagerModules = {}
  for (const source of collectServerImportSources(ast)) {
    if (/\.mdx?$/.test(source)) {
      console.warn(`[egaki] imported .mdx files inside <Server> are not supported yet: ${source}`)
      continue
    }
    try {
      const isPathLike = source.startsWith('.') || source.startsWith('/')
      const id = isPathLike
        ? path.resolve(projectRoot, source)
        : requireFromRoot.resolve(source)
      modules[source] = await import(/* @vite-ignore */ id)
    } catch (e) {
      console.warn(`[egaki] failed to import <Server> module ${source}:`, (e as Error).message)
    }
  }
  return modules
}

/** Build the server components map from the mdx-video namespace import.
 *  mdx-video.tsx has 'use client', so each named export in the namespace
 *  is an individual client reference. */
const serverComponents: Record<string, any> = {
  ...(mdxVideoExports as any),
  GeneratedImage,
  GeneratedVideo,
  GeneratedSpeech,
}

/** All route paths available for navigation, sorted. */
const availableEntries = Object.keys(entries).sort()

/** Render a single MDX entry as a page. Shared by all route handlers. */
async function renderMdxPage(routePath: string) {
  const mdxSource = (entries as Record<string, string>)[routePath]
  const currentEntryPath = (entryPaths as Record<string, string>)[routePath]
  if (mdxSource == null || currentEntryPath == null) return null

  const title = routePath
    ? `${routePath} · ${folderName} · egaki`
    : `${folderName} · egaki`

  let ast: ReturnType<typeof mdxParse>
  try {
    ast = mdxParse(mdxSource)
  } catch (e) {
    console.error('[egaki] MDX parse error (server):', e)
    return <>
      <Head><Head.Title>{title}</Head.Title></Head>
      <MdxClientApp mdx={mdxSource} serverSlots={{}} entryPath={currentEntryPath} availableEntries={availableEntries} currentRoute={routePath} />
    </>
  }

  wrapGenerateNodes(ast)
  const serverNodes = findServerNodes(ast)

  if (serverNodes.length === 0) {
    return <>
      <Head><Head.Title>{title}</Head.Title></Head>
      <MdxClientApp mdx={mdxSource} serverSlots={{}} entryPath={currentEntryPath} availableEntries={availableEntries} currentRoute={routePath} />
    </>
  }

  const eagerModules = await importServerModules(ast)
  const importNodes = filterImportNodesToModules(
    ast.children.filter((node: any) => node.type === 'mdxjsEsm'),
    Object.keys(eagerModules),
  )

  const { fps, bpm } = parseFrontmatter(ast)
  const serverScope = buildMdxScope(fps, bpm)
  const serverEvaluateOptions = { functions: true }

  const serverSlots: Record<string, ReactNode> = {}
  for (const { key, node } of serverNodes) {
    if (key in serverSlots) {
      console.warn(
        `[egaki] multiple <Server> elements start on line ${key}; ` +
        `only the first one renders. Put each <Server> on its own line.`,
      )
      continue
    }
    serverSlots[key] = (
      <SafeMdxRenderer
        markdown={mdxSource}
        mdast={{ type: 'root', children: [...importNodes, ...node.children] } as any}
        components={serverComponents}
        modules={eagerModules}
        baseUrl="./"
        scope={serverScope}
        evaluateOptions={serverEvaluateOptions}
        onError={(e) => console.warn('[egaki] <Server> slot:', e.message)}
      />
    )
  }

  const clientMdx = blankServerContents(mdxSource, serverNodes)
  return <>
    <Head><Head.Title>{title}</Head.Title></Head>
    <MdxClientApp mdx={clientMdx} serverSlots={serverSlots} entryPath={currentEntryPath} availableEntries={availableEntries} currentRoute={routePath} />
  </>
}

// Build the Spiceflow app with explicit routes for each discovered entry.
// Using explicit routes instead of a wildcard (/*) avoids intercepting
// the /api/generation-progress GET endpoint. Spiceflow's .page() registers
// both GET and POST, so a wildcard would shadow the API route.
function buildApp() {
  let app = new Spiceflow()
    .get('/api/generation-progress', async function* (): AsyncGenerator<GenerationProgressEvent> {
      let resolve: (() => void) | null = null
      const unsubscribe = onProgressChange(() => resolve?.())

      try {
        while (true) {
          const progress = getGenerationProgress()
          yield progress
          if (progress.summary.total === 0) return

          await new Promise<void>((r) => { resolve = r })
          resolve = null
        }
      } finally {
        unsubscribe()
      }
    })
    .page('/', () => renderMdxPage(defaultRoute))

  // Register each entry at its route path. The default also gets its
  // own /<name> route so the dropdown can navigate to it from other pages.
  for (const route of availableEntries) {
    app = app.page(`/${route}`, () => renderMdxPage(route)) as any
  }

  return app
}

export const app = buildApp()

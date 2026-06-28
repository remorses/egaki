'use client'

/**
 * Client-side MDX application.
 *
 * All MDX processing happens in the browser: parsing, section splitting,
 * user module resolution, and safe-mdx rendering. Because rendering runs on
 * the client there is no RSC serialization boundary between MDX content and
 * the components — expression props can be functions (easing={x => x}),
 * imported values can be anything, and user components don't need a
 * 'use client' directive.
 *
 * The server (app.tsx) only passes the raw MDX source string through the
 * RSC flight payload. Entry MDX edits flow server → client via rsc:update;
 * user .tsx/.ts/.mdx edits flow through the client module graph: this
 * module accepts HMR updates of virtual:egaki-modules directly via
 * import.meta.hot.accept(dep, cb) and pushes the fresh map into React
 * through useSyncExternalStore.
 */

import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { SafeMdxRenderer } from 'safe-mdx'
import { mdxParse, extractImports, resolveModulePath } from 'safe-mdx/parse'
import type { EagerModules } from 'safe-mdx/parse'
import { eagerModules as initialModules } from 'virtual:egaki-modules'
import { splitIntoSections, calculateTotalDuration, resolveAutoDurations, parseFrontmatter, buildMdxScope } from './mdx-parse.ts'
import { filterImportNodesToModules } from './server-mdx.ts'
import { PlayerPage } from './player-page.tsx'
import { MDX_BUILTIN_COMPONENTS, Img, ServerSlotsContext, type ServerSlots } from './mdx-video.tsx'
import { MdxCodeBlockWrapper } from './code-block.tsx'
import { egakiStore } from './store.ts'
import { useModules, useMediaDurations } from './store-hooks.ts'
import { resetSectionDurations } from './media-duration-store.ts'

// ---------------------------------------------------------------------------
// MDX components map
// ---------------------------------------------------------------------------

const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif'
const FONT_MONO =
  '"SF Mono", ui-monospace, SFMono-Regular, "Cascadia Code", monospace'

function buildVideoMdxComponents(): Record<string, any> {
  return {
    ...MDX_BUILTIN_COMPONENTS,

    // Reserved: server component slot marker. The server renders the
    // original children; this client component splices the slot in by
    // matching its data-markdown-line against the slot keys.
    Server,

    // Standard element overrides
    p: ({ children }: { children: ReactNode }) => (
      <div style={{
        fontSize: 'clamp(1.5rem, 2.5vw, 3rem)', fontWeight: 400,
        color: '#a1a1aa', fontFamily: FONT_SANS, textAlign: 'center',
        letterSpacing: '-0.02em', lineHeight: 1.4, maxWidth: '80%',
      }}>{children}</div>
    ),
    strong: ({ children }: { children: ReactNode }) => (
      <span style={{ color: '#fafafa', fontWeight: 600 }}>{children}</span>
    ),
    em: ({ children }: { children: ReactNode }) => (
      <span style={{ fontStyle: 'italic' }}>{children}</span>
    ),
    a: ({ children }: { children: ReactNode; href?: string }) => (
      <span style={{ color: '#818cf8', textDecoration: 'underline' }}>{children}</span>
    ),
    h1: () => null, h2: () => null, h3: () => null,
    h4: () => null, h5: () => null, h6: () => null,
    blockquote: () => null,
    pre: MdxCodeBlockWrapper,
    inlineCode: ({ children }: { children: ReactNode }) => (
      <span style={{
        fontFamily: FONT_MONO, fontSize: '0.875em', color: '#e4e4e7',
        background: 'rgba(255, 255, 255, 0.06)', borderRadius: '0.25em',
        padding: '0.1em 0.4em',
      }}>{children}</span>
    ),
    ul: ({ children }: { children: ReactNode }) => (
      <div style={{
        fontSize: 'clamp(1.25rem, 2vw, 2rem)', color: '#a1a1aa',
        fontFamily: FONT_SANS, textAlign: 'left', display: 'flex',
        flexDirection: 'column', gap: '0.4em',
      }}>{children}</div>
    ),
    ol: ({ children }: { children: ReactNode }) => (
      <div style={{
        fontSize: 'clamp(1.25rem, 2vw, 2rem)', color: '#a1a1aa',
        fontFamily: FONT_SANS, textAlign: 'left', display: 'flex',
        flexDirection: 'column', gap: '0.4em',
      }}>{children}</div>
    ),
    li: ({ children }: { children: ReactNode }) => (
      <div style={{ display: 'flex', gap: '0.5em' }}>
        <span style={{ color: '#52525b' }}>•</span>
        <span>{children}</span>
      </div>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <Img src={src} alt={alt || ''} style={{
        maxWidth: '80%', maxHeight: '70%', objectFit: 'contain', borderRadius: '0.5em',
      }} />
    ),
    hr: () => (
      <div style={{ width: '40%', height: 1, background: 'rgba(255, 255, 255, 0.1)' }} />
    ),
    table: ({ children }: { children: ReactNode }) => (
      <div style={{ fontSize: 'clamp(0.875rem, 1.2vw, 1.125rem)', fontFamily: FONT_SANS, color: '#a1a1aa' }}>
        {children}
      </div>
    ),
    thead: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    tbody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    tr: ({ children }: { children: ReactNode }) => (
      <div style={{ display: 'flex', gap: '1em', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0.5em 0' }}>
        {children}
      </div>
    ),
    td: ({ children }: { children: ReactNode }) => <div style={{ flex: 1 }}>{children}</div>,
    th: ({ children }: { children: ReactNode }) => (
      <div style={{ flex: 1, fontWeight: 600, color: '#e4e4e7' }}>{children}</div>
    ),
  }
}

// Built once — the map is static.
const mdxComponents = buildVideoMdxComponents()

// Enable function expressions in MDX attribute props. safe-mdx evaluates
// them with a safe AST interpreter (no eval), so `easing={x => x}` works.
const evaluateOptions = { functions: true }

// ---------------------------------------------------------------------------
// User modules — initial value from static import, HMR updates via store
// ---------------------------------------------------------------------------

egakiStore.setState({ modules: initialModules as EagerModules })

if (import.meta.hot) {
  import.meta.hot.accept('virtual:egaki-modules', (next) => {
    if (next?.eagerModules) {
      egakiStore.setState({ modules: next.eagerModules as EagerModules })
    }
  })
}

// ---------------------------------------------------------------------------
// Composition building (parse → sections → JSX)
// ---------------------------------------------------------------------------

// Slots travel via React context (provided by MdxClientApp around
// PlayerPage) rather than a safe-mdx renderNode hook: safe-mdx only calls
// renderNode in its top-level mdast traversal, while JSX elements nested
// inside other JSX elements go through jsxTransformer which resolves the
// components map directly. A real `Server` component in the map works at
// any nesting depth; it matches its slot via the data-markdown-line prop
// that safe-mdx injects (line numbers are identical on server and client
// because blankServerContents preserves line positions).

function Server(props: { 'data-markdown-line'?: number }) {
  const slots = useContext(ServerSlotsContext)
  const key = String(props['data-markdown-line'])
  if (key in slots) return slots[key]
  // No slot: <Server> inside an imported .mdx file (not scanned, v1
  // limitation) or a stale flight payload.
  console.warn(`[egaki] <Server> at line ${key} has no server-rendered slot; rendering nothing`)
  return null
}

// ---------------------------------------------------------------------------
// Parse error recovery
//
// On MDX syntax errors, buildComposition returns the last successful result
// instead of crashing React. An error overlay section replaces the content
// so the user sees what went wrong. When the syntax is fixed, the next HMR
// cycle parses successfully and the real content reappears seamlessly.
// ---------------------------------------------------------------------------

type CompositionResult = {
  sections: { heading: string | null; durationInFrames: number | null; jsx: ReactNode }[]
  preamble: ReactNode | undefined
  frontmatter: ReturnType<typeof parseFrontmatter>
  parseError?: string
}

let lastGoodComposition: CompositionResult | null = null

function makeErrorComposition(error: Error): CompositionResult {
  // If we have a cached good result, reuse its frontmatter and show the
  // error as a single-section overlay so the player stays alive.
  const frontmatter = lastGoodComposition?.frontmatter ?? { fps: 30, bpm: 120, width: 1920, height: 1080, scale: 1 }
  return {
    sections: [{
      heading: 'Parse Error',
      durationInFrames: frontmatter.fps * 5,
      jsx: (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', width: '100%', height: '100%',
          padding: '2rem', fontFamily: 'ui-monospace, SFMono-Regular, "Cascadia Code", monospace',
        }}>
          <div style={{ color: '#ef4444', fontSize: 'clamp(1rem, 2vw, 1.5rem)', fontWeight: 600, marginBottom: '1rem' }}>
            MDX Parse Error
          </div>
          <div style={{
            color: '#fca5a5', fontSize: 'clamp(0.75rem, 1.5vw, 1rem)',
            background: 'rgba(239, 68, 68, 0.1)', borderRadius: '0.5rem',
            padding: '1rem 1.5rem', maxWidth: '80%', whiteSpace: 'pre-wrap',
            lineHeight: 1.6, border: '1px solid rgba(239, 68, 68, 0.2)',
          }}>
            {error.message}
          </div>
          <div style={{ color: '#71717a', fontSize: 'clamp(0.625rem, 1vw, 0.875rem)', marginTop: '1rem' }}>
            Fix the syntax error and save. The video will recover automatically.
          </div>
        </div>
      ),
    }],
    preamble: lastGoodComposition?.preamble,
    frontmatter,
    parseError: error.message,
  }
}

function buildComposition(mdxSource: string, modules: EagerModules): CompositionResult {
  let ast: ReturnType<typeof mdxParse>
  try {
    ast = mdxParse(mdxSource)
  } catch (e) {
    console.warn('[egaki] MDX parse error:', (e as Error).message)
    return makeErrorComposition(e as Error)
  }

  // Compute FPS and BEAT from frontmatter early so they're available as
  // scope variables for all SafeMdxRenderer calls (including imported MDX).
  const { fps, bpm } = parseFrontmatter(ast)
  const mdxScope = buildMdxScope(fps, bpm)

  // Render imported .mdx/.md files into React components so safe-mdx can
  // resolve `import Intro from './intro.mdx'` and render `<Intro />` via
  // React composition. Each imported MDX gets its own SafeMdxRenderer pass
  // with the same components map.
  const moduleKeys = Object.keys(modules)
  const mergedModules: EagerModules = { ...modules }
  const imports = extractImports(ast)
  for (const imp of imports) {
    if (!/\.mdx?$/.test(imp.source)) continue
    const key = resolveModulePath(imp.source, './', moduleKeys)
    if (!key || !mergedModules[key]) continue
    const rawContent = mergedModules[key].default
    if (typeof rawContent !== 'string') continue
    let importedAst
    try {
      importedAst = mdxParse(rawContent)
    } catch (e) {
      // Imported MDX has a syntax error. Skip it instead of crashing the
      // whole composition; the main file's content still renders.
      console.warn(`[egaki] parse error in imported MDX (${imp.source}):`, (e as Error).message)
      continue
    }
    const renderedJsx = (
      <SafeMdxRenderer
        markdown={rawContent}
        mdast={importedAst}
        components={mdxComponents}
        modules={mergedModules}
        baseUrl="./"
        scope={mdxScope}
        evaluateOptions={evaluateOptions}
        onError={(e) => console.warn('[egaki] imported MDX:', e.message)}
      />
    )
    // Replace the raw string module with a component that returns the
    // pre-rendered JSX. safe-mdx reads mod.default for default imports.
    mergedModules[key] = { default: () => renderedJsx }
  }

  const result = splitIntoSections(ast)

  // Extract import nodes (mdxjsEsm) from the full mdast. Section splitting
  // drops them, but SafeMdxRenderer needs them to resolve imported components
  // from the modules map. Prepend to every section's nodes.
  //
  // Imports not resolvable in the client modules map are stripped: those
  // are server-only files (used exclusively inside <Server> blocks, which
  // the server already rendered into slots) excluded from the client map
  // by the vite plugin's inference.
  const importNodes = filterImportNodesToModules(
    ast.children.filter((node: any) => node.type === 'mdxjsEsm'),
    Object.keys(mergedModules),
  )

  const renderNodes = (nodes: any[]) => (
    <SafeMdxRenderer
      markdown={mdxSource}
      mdast={{ type: 'root', children: [...importNodes, ...nodes] } as any}
      components={mdxComponents}
      modules={mergedModules}
      baseUrl="./"
      scope={mdxScope}
      addMarkdownLineNumbers
      evaluateOptions={evaluateOptions}
      onError={(e) => console.warn('[egaki] MDX:', e.message)}
    />
  )

  const sections = result.sections.map((section) => ({
    heading: section.heading,
    durationInFrames: section.durationInFrames,
    jsx: renderNodes(section.nodes),
  }))

  // Preamble: content before the first heading, rendered at composition
  // level (outside Series) so it spans the full video duration.
  const preamble = result.preamble.length > 0
    ? renderNodes(result.preamble)
    : undefined

  const composition: CompositionResult = { sections, preamble, frontmatter: result.frontmatter }

  // Cache successful result for parse error recovery
  lastGoodComposition = composition

  return composition
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

const EMPTY_SLOTS: ServerSlots = {}

export function MdxClientApp({
  mdx,
  serverSlots = EMPTY_SLOTS,
  entryPath,
  availableEntries = [],
  currentRoute = '',
}: {
  mdx: string
  /** Server-rendered <Server> subtrees keyed by node start line, produced
   *  in app.tsx and delivered via RSC flight. Consumed by the Server
   *  component through ServerSlotsContext. */
  serverSlots?: ServerSlots
  /** Absolute path of the MDX entry file, for copy prompts. */
  entryPath: string
  /** All available MDX entry route paths for navigation. */
  availableEntries?: string[]
  /** Current route path ('' for default entry). */
  currentRoute?: string
}) {
  const modules = useModules()

  // Subscribe to media duration reports. When Audio/Video components report
  // their durations (via mediabunny metadata fetch), this re-renders and
  // sections without explicit duration= get auto-sized to their media content.
  // The map is keyed by section index (as string) → max media duration in
  // seconds, derived from the src-keyed persistent cache.
  const sectionDurations = useMediaDurations()

  // Split into two memos to avoid an infinite loop:
  // 1. buildComposition creates JSX (depends on mdx + modules only).
  //    If this re-ran on sectionDurations changes, it would create new JSX
  //    identity → React unmounts Audio/Video → clearSectionDuration fires →
  //    snapshot changes → sectionDurations changes → infinite loop.
  // 2. resolveAutoDurations fills in null durations from the section store.
  //    This memo is cheap and can re-run on every sectionDurations change
  //    without touching JSX identity.
  const composed = useMemo(() => buildComposition(mdx, modules), [mdx, modules])

  // Reset section duration reports when the composition changes (HMR,
  // MDX edit, module update). Media components will re-report on mount.
  // Does NOT clear the raw src cache so cached durations resolve instantly.
  useEffect(() => {
    resetSectionDurations()
  }, [composed])

  const { sections, totalDuration, preamble, hasUnresolvedDurations } = useMemo(() => {
    const { fps, bpm } = composed.frontmatter

    // MDX files without headings (e.g. imported partials rendered standalone)
    // have 0 sections. Synthesize one from the preamble with null duration
    // BEFORE resolving auto-durations, so media auto-sizing still works.
    let sourceSections = composed.sections
    let finalPreamble = composed.preamble
    if (sourceSections.length === 0 && finalPreamble) {
      sourceSections = [{ heading: null, durationInFrames: null, jsx: finalPreamble }]
      finalPreamble = undefined
    }

    const resolved = resolveAutoDurations(sourceSections, fps, bpm, sectionDurations)
    const hasUnresolved = sourceSections.some((s, i) =>
      s.durationInFrames === null && sectionDurations[String(i)] === undefined,
    )
    return {
      sections: resolved,
      totalDuration: Math.max(1, calculateTotalDuration(resolved)),
      preamble: finalPreamble,
      hasUnresolvedDurations: hasUnresolved,
    }
  }, [composed, sectionDurations])

  return (
    <ServerSlotsContext.Provider value={serverSlots}>
      <PlayerPage
        sections={sections}
        totalDuration={totalDuration}
        preamble={preamble}
        entryPath={entryPath}
        hasUnresolvedDurations={hasUnresolvedDurations}
        frontmatter={composed.frontmatter}
        availableEntries={availableEntries}
        currentRoute={currentRoute}
      />
    </ServerSlotsContext.Provider>
  )
}

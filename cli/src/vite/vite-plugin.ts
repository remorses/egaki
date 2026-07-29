/**
 * Vite plugin for the video framework.
 *
 * Discovers MDX files in the project root and serves each as a page route.
 * The default entry (video.mdx or index.mdx) is served at /; others at
 * /<relative-path-without-extension>. Auto-injects spiceflow + react plugins.
 *
 * Usage in vite.config.ts:
 *   import { video } from 'egaki/vite'
 *   export default defineConfig({ plugins: [video()] })
 *   // or with explicit default entry:
 *   export default defineConfig({ plugins: [video({ entry: './video.mdx' })] })
 */

import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Plugin, PluginOption } from 'vite'
import { spiceflowPlugin } from 'spiceflow/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pc from 'picocolors'
import { mdxParse } from 'safe-mdx/parse'
import { collectServerImportSources } from './server-mdx.ts'
import { parseFrontmatter } from './mdx-parse.ts'

// Resolve the package src/vite/ directory from this file's location.
// This file may run from src/vite/ (dev) or dist/vite/ (published).
// Either way, going up 2 levels reaches the package root, then into src/vite/.
const __pkgRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const __srcDir = path.join(__pkgRoot, 'src', 'vite')
const APP_SRC_PATH = path.join(__srcDir, 'app.tsx')

const VIRTUAL_APP = 'virtual:egaki-app'
const RESOLVED_APP = '\0' + VIRTUAL_APP

const VIRTUAL_MDX = 'virtual:egaki-mdx'
const RESOLVED_MDX = '\0' + VIRTUAL_MDX

const VIRTUAL_MODULES = 'virtual:egaki-modules'
const RESOLVED_MODULES = '\0' + VIRTUAL_MODULES



const PKG_NAME = 'egaki'

// Packages that must resolve to a single physical copy (same pattern as
// spiceflow:dedupe-singleton). Remotion Player + useVideoConfig share React
// context; two copies → "No video config found". Motion patches need one
// JSAnimation class. resolve.dedupe alone fails under pnpm when the package
// is only a transitive dep of egaki (not hoisted to the consumer root).
const dedupePackages = new Set([
  'remotion',
  '@remotion/player',
  '@remotion/media',
  '@remotion/web-renderer',
  'motion',
  'motion-dom',
  'motion-utils',
])

// Fake importer anchored inside egaki's package so this.resolve() finds the
// same remotion/motion copy egaki itself depends on.
const dedupeImporter = path.join(__pkgRoot, '_dedupe_importer_.js')

export interface VideoPluginOptions {
  /** Path to the default MDX entry file (relative to vite root or absolute).
   *  When omitted, auto-discovers: video.mdx > index.mdx > first .mdx found.
   *  All other .mdx files in the project become additional routes. */
  entry?: string
}

/** Resolve a relative MDX import source against the project root,
 *  probing common extensions. Returns the absolute path or undefined. */
function resolveSourceToFile(root: string, source: string): string | undefined {
  const base = path.resolve(root, source)
  for (const ext of ['', '.tsx', '.ts', '.jsx', '.js', '.mdx', '.md']) {
    const candidate = base + ext
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate.replace(/\\/g, '/')
    }
  }
  return undefined
}

/** Discover .mdx files in the project root directory (non-recursive).
 *  Only root-level files become entries to avoid import resolution issues
 *  with nested paths. Returns a map of routePath → absolutePath. */
function discoverMdxEntries(root: string): Map<string, string> {
  const entries = new Map<string, string>()
  if (!fs.existsSync(root)) return entries
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) continue
    if (!/\.mdx$/.test(entry.name)) continue
    const fullPath = path.join(root, entry.name)
    const routePath = entry.name.replace(/\.mdx$/, '')
    entries.set(routePath, fullPath.replace(/\\/g, '/'))
  }
  return entries
}

/** Pick the default entry route from discovered entries.
 *  Priority: explicit option > video.mdx > index.mdx > first alphabetically. */
function resolveDefaultRoute(entries: Map<string, string>, explicitEntry?: string, root?: string): string {
  if (explicitEntry && root) {
    const absEntry = path.isAbsolute(explicitEntry)
      ? explicitEntry.replace(/\\/g, '/')
      : path.resolve(root, explicitEntry).replace(/\\/g, '/')
    for (const [route, absPath] of entries) {
      if (absPath === absEntry) return route
    }
  }
  if (entries.has('video')) return 'video'
  if (entries.has('index')) return 'index'
  // First alphabetically
  const sorted = [...entries.keys()].sort()
  return sorted[0] ?? 'video'
}

export function video(options?: VideoPluginOptions): PluginOption[] {
  let root: string
  /** All discovered MDX entry files: routePath → absolutePath */
  let mdxEntries: Map<string, string> = new Map()
  /** Route path of the default entry (served at /) */
  let defaultRoute: string = ''
  /** Whether the user's project has `motion` (framer-motion) installed. */
  let hasMotion = false
  /** Set of absolute paths of all entry MDX files for quick lookup. */
  let entryPathSet: Set<string> = new Set()

  /** Is this file referenced inside a <Server> block of any entry MDX?
   *  Parsed on demand (no cache — file changes are rare and parsing is
   *  milliseconds). Used to decide which edits need an rsc:update. */
  const isServerImportedFile = (file: string): boolean => {
    try {
      for (const absPath of entryPathSet) {
        const sources = collectServerImportSources(mdxParse(fs.readFileSync(absPath, 'utf-8')))
        if (sources.some((source) => resolveSourceToFile(root, source) === file)) return true
      }
      return false
    } catch {
      return false
    }
  }

  const videoPlugin: Plugin = {
    name: 'egaki:core',

    configResolved(config) {
      root = config.root

      // Discover all MDX entries in the project root.
      mdxEntries = discoverMdxEntries(root)

      // If explicit entry is provided but not found, create a minimal entry
      // in the map (will error below if file doesn't exist).
      if (options?.entry) {
        const absEntry = (path.isAbsolute(options.entry)
          ? options.entry
          : path.resolve(root, options.entry)).replace(/\\/g, '/')
        if (!fs.existsSync(absEntry)) {
          throw new Error(
            `[egaki] entry file not found: ${absEntry}\n` +
            `Set entry to a path relative to the vite root.`,
          )
        }
        // Ensure explicit entry is in the map
        const relPath = path.relative(root, absEntry).replace(/\\/g, '/')
        const routePath = relPath.replace(/\.mdx$/, '')
        mdxEntries.set(routePath, absEntry)
      }

      if (mdxEntries.size === 0) {
        throw new Error(
          `[egaki] no .mdx files found in ${root}\n` +
          `Create a video.mdx file or set entry explicitly.`,
        )
      }

      defaultRoute = resolveDefaultRoute(mdxEntries, options?.entry, root)
      entryPathSet = new Set(mdxEntries.values())

      // Auto-generate egaki-env.d.ts so MDX LSP knows about built-in
      // components via the global MDXProvidedComponents type. Same
      // pattern Vite uses for vite-env.d.ts.
      const envDtsPath = path.join(root, 'egaki-env.d.ts')
      const envDtsContent = 'import \'egaki/mdx-components\'\n'
      try {
        const existing = fs.existsSync(envDtsPath) ? fs.readFileSync(envDtsPath, 'utf-8') : ''
        if (existing !== envDtsContent) {
          fs.writeFileSync(envDtsPath, envDtsContent)
        }
      } catch {
        // Non-fatal: LSP autocomplete just won't work
      }

      // Detect if the user has `motion` (framer-motion) installed.
      // When present, we inject timing patches so motion.div animations
      // sync with Remotion's frame-based rendering.
      try {
        createRequire(root + '/').resolve('motion-dom')
        hasMotion = true
      } catch {
        hasMotion = false
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_APP) return RESOLVED_APP
      if (id === VIRTUAL_MDX) return RESOLVED_MDX
      if (id === VIRTUAL_MODULES) return RESOLVED_MODULES
    },

    load(id) {
      if (id === RESOLVED_MDX) {
        // Import all entry MDX files as raw strings (?raw for HMR tracking).
        // Export an entries map so app.tsx can serve each at its route.
        const defaultAbsPath = mdxEntries.get(defaultRoute)!
        // Parse frontmatter from the default entry for composition dimensions.
        let fm: ReturnType<typeof parseFrontmatter>
        try {
          const mdxContent = fs.readFileSync(defaultAbsPath, 'utf-8')
          fm = parseFrontmatter(mdxParse(mdxContent))
        } catch (e) {
          console.error('[egaki] frontmatter parse error:', e)
          fm = { fps: 30, bpm: 120, width: 1920, height: 1080, scale: 1 }
        }
        const folderName = path.basename(root)

        const imports: string[] = []
        const entriesObj: string[] = []
        const pathsObj: string[] = []
        let i = 0
        for (const [routePath, absPath] of mdxEntries) {
          const varName = `__entry${i++}`
          imports.push(`import ${varName} from ${JSON.stringify(absPath + '?raw')}`)
          entriesObj.push(`  ${JSON.stringify(routePath)}: ${varName}`)
          pathsObj.push(`  ${JSON.stringify(routePath)}: ${JSON.stringify(absPath)}`)
        }

        return [
          ...imports,
          `export const entries = {`,
          entriesObj.join(',\n'),
          `}`,
          `export const entryPaths = {`,
          pathsObj.join(',\n'),
          `}`,
          `export const defaultRoute = ${JSON.stringify(defaultRoute)}`,
          `export const projectRoot = ${JSON.stringify(root.replace(/\\/g, '/'))}`,
          `export const compositionWidth = ${fm.width}`,
          `export const compositionHeight = ${fm.height}`,
          `export const folderName = ${JSON.stringify(folderName)}`,
          // Backward compat: default export is the default entry source
          `export default entries[${JSON.stringify(defaultRoute)}]`,
          `export const entryPath = entryPaths[${JSON.stringify(defaultRoute)}]`,
        ].join('\n')
      }

      if (id === RESOLVED_MODULES) {
        // Build an eager module map for all user files in the project
        // root. Each file is imported statically so modules are available
        // synchronously — no async resolution, no loading state.
        //
        // This map is only imported by the client (and ssr) — the rsc env
        // resolves <Server> slot modules via dynamic imports in app.tsx.
        // *.server.{ts,tsx} files are excluded: that postfix is the hard
        // "never bundle to the browser" guarantee for files with API keys
        // or node-only imports.
        const imports: string[] = []
        const entries: string[] = []
        let i = 0
        const walkDir = (dir: string) => {
          if (!fs.existsSync(dir)) return
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'e2e' || entry.name === 'test-results' || entry.name.startsWith('.')) continue
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              walkDir(fullPath)
            } else if (/\.(tsx?|jsx?|mdx?)$/.test(entry.name) && !/\.(test|spec|config)\./.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
              // Entry MDX files are NOT skipped: they may be imported as
              // partials by other MDX files (e.g. `import Intro from './intro.mdx'`).
              // Self-import is a user error and harmless (safe-mdx handles it).
              if (/\.server\.[jt]sx?$/.test(entry.name)) continue
              const isMdx = /\.mdx?$/.test(entry.name)
              const relPath = './' + path.relative(root, fullPath).replace(/\\/g, '/')
              const absPath = fullPath.replace(/\\/g, '/')
              const varName = `__mod${i++}`
              if (isMdx) {
                // MDX/MD files loaded as raw strings for client rendering
                imports.push(`import ${varName} from ${JSON.stringify(absPath + '?raw')}`)
                entries.push(`  ${JSON.stringify(relPath)}: { default: ${varName} }`)
              } else {
                imports.push(`import * as ${varName} from ${JSON.stringify(absPath)}`)
                entries.push(`  ${JSON.stringify(relPath)}: ${varName}`)
              }
            }
          }
        }
        walkDir(root)

        // No self-accept here: mdx-client.tsx accepts updates of this
        // module via import.meta.hot.accept('virtual:egaki-modules', cb).
        // When a user file changes, HMR propagates through this module to
        // that boundary, re-executing this module with fresh imports and
        // handing the new map to the callback. Self-accepting here would
        // make THIS module the boundary and the importer callback would
        // never fire.
        // When motion is installed, import motion-timing.ts as a
        // side-effect so JSAnimation patches run before any user component.
        // resolve.dedupe (set in configEnvironment) ensures motion-dom
        // resolves to the same instance that motion/react uses.
        const motionTimingPath = path.join(__srcDir, 'motion-timing.ts').replace(/\\/g, '/')
        const motionImport = hasMotion ? [`import ${JSON.stringify(motionTimingPath)}`] : []

        return [
          ...motionImport,
          ...imports,
          `export const eagerModules = {`,
          entries.join(',\n'),
          `}`,
        ].join('\n')
      }

      if (id === RESOLVED_APP) {
        // Spiceflow entry: import the framework's app from its absolute
        // source path so the RSC module runner resolves relative imports
        // (./mdx-parse.ts etc.) from the correct filesystem directory.
        return [
          `import { app } from ${JSON.stringify(APP_SRC_PATH)}`,
          `export { app }`,
        ].join('\n')
      }
    },

    // Print SDK usage instructions after Vite's startup banner.
    // Agents read terminal output to learn how to interact with the
    // running dev server via Playwriter + window.egakiSDK.
    configureServer(server) {
      server.httpServer?.on('listening', () => {
        const log = server.config.logger
        const p = (s: string) => log.info(s)
        // Small delay so our block prints after Vite's "ready in" + URL lines
        setTimeout(() => {
          const title = `  ${pc.cyan(pc.bold('egaki SDK'))} ${pc.dim('—')} ${pc.white('programmatic control via')} ${pc.yellow('window.egakiSDK')}`
          const sep = pc.dim('  ─'.padEnd(72, '─'))

          p('')
          p(title)
          p(sep)
          p('')
          p(`  ${pc.green('●')} ${pc.bold('Get info')}        ${pc.dim('composition metadata, sections, fps')}`)
          p(`    ${pc.cyan(`playwriter -s 1 -e 'console.log(await state.page.evaluate(() => window.egakiSDK.getInfo()))'`)}`)
          p('')
          p(`  ${pc.green('●')} ${pc.bold('Screenshot')}      ${pc.dim('capture a single frame as PNG')}`)
          p(`    ${pc.cyan("playwriter -s 1 -e \"$(cat <<'JS'")}`)
          p(`    ${pc.cyan('const dataUrl = await state.page.evaluate(() => window.egakiSDK.screenshot({ frame: 60 }))')}`)
          p(`    ${pc.cyan('const buf = Buffer.from(await (await fetch(dataUrl)).arrayBuffer())')}`)
          p(`    ${pc.cyan('require("node:fs").writeFileSync("/tmp/frame-60.png", buf)')}`)
          p(`    ${pc.cyan('JS')}`)
          p(`    ${pc.cyan(')"')}`)
          p('')
          p(`  ${pc.green('●')} ${pc.bold('Filmstrip')}       ${pc.dim('grid of frames across scenes')}`)
          p(`    ${pc.cyan("playwriter -s 1 -e \"$(cat <<'JS'")}`)
          p(`    ${pc.cyan('const dataUrl = await state.page.evaluate(() =>')}`)
          p(`    ${pc.cyan('  window.egakiSDK.filmstrip({ scenes: [0, 1, 2], framesPerScene: 3 }))')}`)
          p(`    ${pc.cyan('const buf = Buffer.from(await (await fetch(dataUrl)).arrayBuffer())')}`)
          p(`    ${pc.cyan('require("node:fs").writeFileSync("/tmp/filmstrip.png", buf)')}`)
          p(`    ${pc.cyan('JS')}`)
          p(`    ${pc.cyan(')"')}`)
          p('')
          p(`  ${pc.green('●')} ${pc.bold('Export video')}     ${pc.dim('render MP4 via WebCodecs')}`)
          p(`    ${pc.cyan(`playwriter -s 1 -e 'await state.page.evaluate(() => window.egakiSDK.export({ path: "output.mp4" }))'`)}`)
          p('')
          p(`  ${pc.green('●')} ${pc.bold('Seek')}            ${pc.dim('jump to a specific frame')}`)
          p(`    ${pc.cyan(`playwriter -s 1 -e 'await state.page.evaluate(() => window.egakiSDK.seekTo(120))'`)}`)
          p('')
        }, 50)
      })
    },

    // HMR for file changes in the project.
    //
    // Entry MDX: the source string flows server → client through the RSC
    // flight payload, so invalidate the virtual modules in all envs and
    // send rsc:update to re-fetch the flight.
    //
    // User .tsx/.ts/.mdx/.css files: handled in the client module graph
    // (Fast Refresh for components, dep-accept in mdx-client.tsx for the
    // rest) AND via rsc:update, because <Server> slots are rendered in the
    // rsc env from the same files — the flight refetch delivers fresh
    // slots. On rsc/ssr envs we invalidate the changed modules manually
    // and return [] to suppress default HMR, which would trigger an SSR
    // "program reload" → full page reload.
    //
    // File create/delete: the generated module list changed and no accept
    // chain exists for new files, so invalidate everything + full reload.
    hotUpdate(ctx) {
      const normalizedFile = ctx.file.replace(/\\/g, '/')
      const isEntryMdx = entryPathSet.has(normalizedFile)
      const isImportedMdx = /\.mdx?$/.test(ctx.file)
        && !isEntryMdx
        && !ctx.file.includes('node_modules')
        && ctx.file.startsWith(root)
      const isUserFile = /\.[jt]sx?$/.test(ctx.file)
        && !ctx.file.includes('node_modules')
        && ctx.file.startsWith(root)
      const isCss = /\.css$/.test(ctx.file)
        && !ctx.file.includes('node_modules')
        && ctx.file.startsWith(root)

      if (!isEntryMdx && !isImportedMdx && !isUserFile && !isCss) return

      const invalidateVirtual = (ids: string[]) => {
        for (const env of Object.values(ctx.server.environments)) {
          for (const resolvedId of ids) {
            const mod = env.moduleGraph.getModuleById(resolvedId)
            if (mod) {
              env.moduleGraph.invalidateModule(mod)
            }
          }
        }
      }

      // Create/delete: regenerate module list and entry map, full reload.
      if (ctx.type !== 'update') {
        // Re-discover entries in case a new MDX file was added or removed.
        mdxEntries = discoverMdxEntries(root)
        if (options?.entry) {
          const absEntry = (path.isAbsolute(options.entry)
            ? options.entry
            : path.resolve(root, options.entry)).replace(/\\/g, '/')
          const relPath = path.relative(root, absEntry).replace(/\\/g, '/')
          mdxEntries.set(relPath.replace(/\.mdx$/, ''), absEntry)
        }
        defaultRoute = resolveDefaultRoute(mdxEntries, options?.entry, root)
        entryPathSet = new Set(mdxEntries.values())

        invalidateVirtual([RESOLVED_APP, RESOLVED_MDX, RESOLVED_MODULES])
        if (this.environment.name === 'client') {
          ctx.server.environments.client?.hot.send({ type: 'full-reload' })
        }
        return []
      }

      if (isEntryMdx) {
        // Every root .mdx is both a route entry (virtual:egaki-mdx / RSC
        // flight) and a ?raw partial in virtual:egaki-modules (importable
        // via `import X from './foo.mdx'`). Must refresh both paths:
        // rsc:update for the entry source, and modules dep-accept for
        // partials. Invalidating only RESOLVED_MODULES is not enough —
        // Vite keeps the cached ?raw binding, so also invalidate every
        // module graph node for this file (including `?raw`).
        invalidateVirtual([RESOLVED_APP, RESOLVED_MDX, RESOLVED_MODULES])

        if (this.environment.name === 'client') {
          const fileMods = this.environment.moduleGraph.getModulesByFile(ctx.file)
          if (fileMods) {
            for (const mod of fileMods) {
              this.environment.moduleGraph.invalidateModule(mod)
            }
          }
          ctx.server.environments.client?.hot.send({
            type: 'custom',
            event: 'rsc:update',
            data: { file: ctx.file },
          })
          const modulesMod = this.environment.moduleGraph.getModuleById(RESOLVED_MODULES)
          const updates = [
            ...(fileMods ? [...fileMods] : []),
            ...(modulesMod ? [modulesMod] : []),
          ]
          return updates
        }
        return []
      }

      // User file / imported MDX / CSS updates.
      // Client env: let default HMR run (Fast Refresh for components,
      // dep-accept propagation through virtual:egaki-modules for the rest).
      if (this.environment.name === 'client') {
        return
      }

      // rsc/ssr envs: keep graphs fresh for the next render, but suppress
      // default HMR (would cause a full program reload).
      invalidateVirtual([RESOLVED_APP, RESOLVED_MODULES])
      for (const mod of ctx.modules) {
        this.environment.moduleGraph.invalidateModule(mod)
      }

      // Edits to files referenced inside <Server> (or *.server.* postfix)
      // send rsc:update: <Server> slots render in the rsc env, so the
      // flight must be refetched for fresh slot content. Sent from the
      // rsc branch AFTER invalidation so the browser's refetch cannot
      // race a stale rsc module graph. The refetch remounts the client
      // tree (spiceflow payload swap resets the Player to frame 0), so it
      // must NOT fire for regular files — those are covered by
      // client-graph HMR which preserves player state.
      if (this.environment.name === 'rsc') {
        const file = ctx.file.replace(/\\/g, '/')
        if (/\.server\.[jt]sx?$/.test(file) || isServerImportedFile(file)) {
          ctx.server.environments.client?.hot.send({
            type: 'custom',
            event: 'rsc:update',
            data: { file: ctx.file },
          })
        }
      }
      return []
    },
  }

  // Keep the video package inside the RSC/SSR transform pipeline
  const rscPackagePlugin: Plugin = {
    name: 'egaki:rsc-package',
    configEnvironment(name, config) {
      // noExternal: keep package in transform pipeline for all environments
      config.resolve ??= {}
      const existing = config.resolve.noExternal
      if (existing === true) return
      const arr = Array.isArray(existing) ? existing : existing ? [existing] : []
      arr.push(new RegExp(`^${PKG_NAME}`))
      arr.push(/^tweakpane/)
      config.resolve.noExternal = arr

      // Baseline hint for Vite's built-in resolver (same list as the
      // resolveId singleton plugin below). Real enforcement is the
      // egaki:dedupe-singleton plugin — resolve.dedupe alone is not enough
      // under pnpm when remotion is only a transitive dep of egaki.
      config.resolve.dedupe = mergeUnique(
        config.resolve.dedupe as string[] | undefined,
        [...dedupePackages],
      )

      if (name === 'client') {
        config.optimizeDeps ??= {}
        config.optimizeDeps.exclude = mergeUnique(
          config.optimizeDeps.exclude,
          [PKG_NAME],
        )
        // Prebundle safe-mdx as a single entry so its pure-CJS leaves
        // (format via fault/micromark) stay internalized with CJS interop.
        // Do NOT list format/fault as separate optimizeDeps entries — that
        // splits them into named-only ESM chunks and the browser crashes with
        // "does not provide an export named 'default'" (same bug Holocron hit
        // when safe-mdx leaked to the client; see holocron vite CHANGELOG).
        // Holocron's clean fix is keep safe-mdx server-only; egaki needs it on
        // the client for MDX-in-browser, so correct prebundling is the fix.
        config.optimizeDeps.include = mergeUnique(
          config.optimizeDeps.include,
          [
            `${PKG_NAME} > spiceflow > @vitejs/plugin-rsc/vendor/react-server-dom/client.browser`,
            `${PKG_NAME} > remotion`,
            `${PKG_NAME} > @remotion/player`,
            `${PKG_NAME} > safe-mdx`,
            'safe-mdx',
            'safe-mdx/parse',
          ],
        )
      }

      if (name === 'rsc' || name === 'ssr') {
        config.optimizeDeps ??= {}
        config.optimizeDeps.exclude = mergeUnique(
          config.optimizeDeps.exclude,
          ['spiceflow'],
        )
      }
    },
  }

  // Force remotion / motion to a single copy across all importers, even when
  // egaki is a transitive or file:-linked dep under pnpm. Mirrors
  // spiceflow:dedupe-singleton (spiceflow/src/vite.tsx).
  //
  // Vite's resolve.dedupe sets basedir=root then walks node_modules/, but
  // pnpm only symlinks direct deps at the root. Transitive deps stay buried
  // in .pnpm/, so dedupe silently falls back to importer-based resolution
  // and Player vs useVideoConfig load different remotion instances.
  const dedupeSingletonPlugin: Plugin = {
    name: 'egaki:dedupe-singleton',
    enforce: 'pre',
    async resolveId(id, _importer, options) {
      if (
        id.startsWith('.') ||
        id.startsWith('/') ||
        id.startsWith('\0') ||
        id.includes('?')
      ) {
        return null
      }

      const pkgName = id.startsWith('@')
        ? id.split('/').slice(0, 2).join('/')
        : (id.split('/')[0] ?? id)

      if (!dedupePackages.has(pkgName)) return null

      return this.resolve(id, dedupeImporter, {
        ...options,
        skipSelf: true,
      })
    },
  }

  return [
    videoPlugin,
    rscPackagePlugin,
    dedupeSingletonPlugin,
    tailwindcss(),
    spiceflowPlugin({ entry: VIRTUAL_APP }),
    react(),
  ]
}

function mergeUnique(existing: string[] | undefined, items: string[]): string[] {
  const set = new Set(existing ?? [])
  for (const item of items) set.add(item)
  return [...set]
}

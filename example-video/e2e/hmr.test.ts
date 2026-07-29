/**
 * HMR tests: verify that editing MDX and user .tsx files updates the
 * Remotion Player content without a full page reload.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const componentsPath = path.join(root, 'components.tsx')
const mdxPath = path.join(root, 'video.mdx')
const dataPath = path.join(root, 'data.ts')
const taglinePath = path.join(root, 'tagline.mdx')
const serverStatsPath = path.join(root, 'async-stats.tsx')

test.describe.serial('video HMR @dev', () => {
  let originalComponents: string
  let originalMdx: string
  let originalData: string
  let originalTagline: string
  let originalServerStats: string

  test.beforeAll(() => {
    originalComponents = fs.readFileSync(componentsPath, 'utf-8')
    originalMdx = fs.readFileSync(mdxPath, 'utf-8')
    originalData = fs.readFileSync(dataPath, 'utf-8')
    originalTagline = fs.readFileSync(taglinePath, 'utf-8')
    originalServerStats = fs.readFileSync(serverStatsPath, 'utf-8')
  })

  test.afterAll(() => {
    fs.writeFileSync(componentsPath, originalComponents)
    fs.writeFileSync(mdxPath, originalMdx)
    fs.writeFileSync(dataPath, originalData)
    fs.writeFileSync(taglinePath, originalTagline)
    fs.writeFileSync(serverStatsPath, originalServerStats)
  })

  test('editing MDX text updates the Player content', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // At frame 0 the Player shows the Layout A section with the "egaki"
    // hero text. Only the current frame's section is mounted, so assert
    // on frame-0 content.
    const playerContainer = page.locator('[style*="aspect-ratio"]').first()
    await expect(playerContainer).toBeVisible()
    await expect(playerContainer.locator('text=egaki').first()).toBeVisible({ timeout: 5000 })

    // Set HMR marker
    await page.evaluate(() => { (window as any).__hmr_marker = true })

    // Edit MDX: change the Layout A hero text (first occurrence)
    const updatedMdx = originalMdx.replace('>egaki</span>', '>HMRTITLE</span>')

    await expect.poll(async () => {
      fs.writeFileSync(mdxPath, updatedMdx + `\n{/* hmr ${Date.now()} */}`)
      const markerAlive = await page.evaluate(() => (window as any).__hmr_marker === true)
      if (!markerAlive) return 'full-reload'
      // .first(): LayoutTransition keeps a ghost copy of the previous section,
      // so the same text can match two nodes (one visible, one visibility:hidden).
      // isVisible() without .first() throws strict-mode and the catch returns false.
      const visible = await playerContainer.locator('text=HMRTITLE').first().isVisible().catch(() => false)
      return visible ? 'updated' : 'waiting'
    }, { timeout: 15_000, message: 'MDX HMR: new text did not appear in Player' }).toBe('updated')
  })

  test('editing component file does not cause full page reload', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Set HMR marker
    await page.evaluate(() => { (window as any).__hmr_marker = true })

    // Edit components.tsx: change the grid gap
    const updatedComponents = originalComponents.replace(
      'gap: 16,',
      'gap: 32,',
    )

    await expect.poll(async () => {
      fs.writeFileSync(componentsPath, updatedComponents + `\n// hmr ${Date.now()}`)
      const markerAlive = await page.evaluate(() => (window as any).__hmr_marker === true)
      if (!markerAlive) return 'full-reload'
      return 'ok'
    }, { timeout: 10_000, message: 'Component edit caused a full page reload' }).toBe('ok')
  })

  test('function props in MDX work (client-side rendering)', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const playerContainer = page.locator('[style*="aspect-ratio"]').first()
    await expect(playerContainer).toBeVisible()
    await page.evaluate(() => { (window as any).__hmr_marker = true })

    // Inject a component that receives an arrow function as a prop into the
    // frame-0 section. This only renders if MDX is evaluated on the client —
    // functions cannot cross an RSC flight boundary.
    const updatedMdx = originalMdx
      .replace(
        "import { Dot, ListItem, FeatureGrid } from './components'",
        "import { Dot, ListItem, FeatureGrid, FnPropDemo } from './components'",
      )
      .replace(
        '# Layout A duration=0.7s',
        '# Layout A duration=0.7s\n\n<FnPropDemo format={(s) => s.toUpperCase()} />',
      )

    await expect.poll(async () => {
      fs.writeFileSync(mdxPath, updatedMdx + `\n{/* hmr ${Date.now()} */}`)
      const markerAlive = await page.evaluate(() => (window as any).__hmr_marker === true)
      if (!markerAlive) return 'full-reload'
      const visible = await playerContainer.locator('text=FN-PROPS-WORK').first().isVisible().catch(() => false)
      return visible ? 'updated' : 'waiting'
    }, { timeout: 15_000, message: 'function prop did not render' }).toBe('updated')
  })

  test('editing data.ts updates content via modules dep-accept, no reload', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Seek to the Features section (starts at frame 990, see video.mdx
    // durations) where <FeatureGrid features={FEATURES} /> renders labels
    // from data.ts.
    const playerContainer = page.locator('[style*="aspect-ratio"]').first()
    await expect(playerContainer).toBeVisible()
    await page.waitForFunction(() => window.egakiSDK?.seekTo)
    await page.evaluate(() => window.egakiSDK.seekTo(1050))
    await expect(playerContainer.locator('text=MDX Components').first()).toBeVisible({ timeout: 5000 })

    await page.evaluate(() => { (window as any).__hmr_marker = true })

    // data.ts is not a component file, so this update propagates through
    // virtual:egaki-modules to mdx-client.tsx's import.meta.hot.accept
    // dep handler — the path that would full-reload without it.
    const updatedData = originalData.replace(
      "label: 'MDX Components'",
      "label: 'HMR DATA EDIT'",
    )

    await expect.poll(async () => {
      fs.writeFileSync(dataPath, updatedData + `\n// hmr ${Date.now()}`)
      const markerAlive = await page.evaluate(() => (window as any).__hmr_marker === true)
      if (!markerAlive) return 'full-reload'
      const visible = await playerContainer.locator('text=HMR DATA EDIT').first().isVisible().catch(() => false)
      return visible ? 'updated' : 'waiting'
    }, { timeout: 15_000, message: 'data.ts HMR: new label did not appear in Player' }).toBe('updated')
  })

  test('editing an imported .mdx updates content via modules dep-accept, no reload', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Seek into the "another" section (frames 444-504) where <Tagline />
    // (imported from tagline.mdx) renders "Beautiful docs from MDX."
    const playerContainer = page.locator('[style*="aspect-ratio"]').first()
    await expect(playerContainer).toBeVisible()
    await page.waitForFunction(() => window.egakiSDK?.seekTo)
    await page.evaluate(() => window.egakiSDK.seekTo(470))
    await expect(playerContainer.locator('text=Beautiful').first()).toBeVisible({ timeout: 5000 })

    await page.evaluate(() => { (window as any).__hmr_marker = true })

    // Imported .mdx files live in virtual:egaki-modules as ?raw strings,
    // so edits take the same dep-accept path as data.ts.
    // NOTE: MaskedSlideReveal splits text into one span per word, so the
    // locator token must be a single word without spaces.
    const updatedTagline = originalTagline.replace(
      'Beautiful docs from MDX.',
      'TAGLINEHMR edit works.',
    )

    await expect.poll(async () => {
      fs.writeFileSync(taglinePath, updatedTagline)
      const markerAlive = await page.evaluate(() => (window as any).__hmr_marker === true)
      if (!markerAlive) return 'full-reload'
      const visible = await playerContainer.locator('text=TAGLINEHMR').first().isVisible().catch(() => false)
      return visible ? 'updated' : 'waiting'
    }, { timeout: 15_000, message: 'imported mdx HMR: new text did not appear in Player' }).toBe('updated')
  })

  test('<Server> slot renders async server component content', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Analytics section (frames 1149-1329) contains <Server><AsyncStats /></Server>.
    // AsyncStats is an async RSC from async-stats.tsx — rendered on
    // the server, streamed through flight, spliced in by line number.
    const playerContainer = page.locator('[style*="aspect-ratio"]').first()
    await expect(playerContainer).toBeVisible()
    await page.waitForFunction(() => window.egakiSDK?.seekTo)
    await page.evaluate(() => window.egakiSDK.seekTo(1200))
    await expect(playerContainer.locator('text=Pages Built').first()).toBeVisible({ timeout: 10_000 })
    await expect(playerContainer.locator('text=100,847').first()).toBeVisible()

    // Built-in server component imported via BARE specifier
    // ('egaki/text-to-speech') — resolved through vite at request time.
    // Renders a hidden marker span, so assert attachment not visibility.
    await expect(playerContainer.locator('[data-egaki-tts]').first()).toBeAttached()
  })

  test('editing an inferred server file refreshes the slot via rsc:update, no reload', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const playerContainer = page.locator('[style*="aspect-ratio"]').first()
    await expect(playerContainer).toBeVisible()
    await page.waitForFunction(() => window.egakiSDK?.seekTo)
    await page.evaluate(() => window.egakiSDK.seekTo(1200))
    await expect(playerContainer.locator('text=100,847').first()).toBeVisible({ timeout: 10_000 })

    await page.evaluate(() => { (window as any).__hmr_marker = true })

    // async-stats.tsx has no .server postfix — the plugin INFERS it's a
    // server file because AsyncStats is only used inside <Server>. It's
    // excluded from the client bundle; edits reach the browser through
    // rsc:update → flight refetch → new serverSlots.
    // The flight refetch remounts the Player (frame resets to 0), so the
    // poll re-seeks to the Analytics section before checking visibility.
    const updatedStats = originalServerStats.replace("'100,847'", "'55,555'")

    await expect.poll(async () => {
      fs.writeFileSync(serverStatsPath, updatedStats + `\n// hmr ${Date.now()}`)
      const markerAlive = await page.evaluate(() => (window as any).__hmr_marker === true)
      if (!markerAlive) return 'full-reload'
      await page.evaluate(() => window.egakiSDK.seekTo(1200))
      const visible = await playerContainer.locator('text=55,555').first().isVisible().catch(() => false)
      return visible ? 'updated' : 'waiting'
    }, { timeout: 20_000, message: 'server component HMR: new value did not appear' }).toBe('updated')
  })

  test('editing frontmatter width/height updates player dimensions via HMR', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const playerContainer = page.locator('[style*="aspect-ratio"]').first()
    await expect(playerContainer).toBeVisible()
    await page.waitForFunction(() => window.egakiSDK?.getInfo)

    // Default composition is 1920×1080
    const before = await page.evaluate(() => window.egakiSDK.getInfo())
    expect(before.width).toBe(1920)
    expect(before.height).toBe(1080)

    await page.evaluate(() => { (window as any).__hmr_marker = true })

    // Change frontmatter to vertical 1080×1920
    const updatedMdx = originalMdx.replace(
      '---\nfps: 30\nbpm: 120\n---',
      '---\nfps: 30\nbpm: 120\nwidth: 1080\nheight: 1920\n---',
    )
    expect(updatedMdx).not.toBe(originalMdx)

    await expect.poll(async () => {
      fs.writeFileSync(mdxPath, updatedMdx + `\n{/* hmr ${Date.now()} */}`)
      const markerAlive = await page.evaluate(() => (window as any).__hmr_marker === true).catch(() => false)
      if (!markerAlive) return 'full-reload'
      const info = await page.evaluate(() => window.egakiSDK.getInfo())
      if (info.width === 1080 && info.height === 1920) return 'updated'
      return 'waiting'
    }, { timeout: 15_000, message: 'frontmatter width/height HMR: dimensions did not update' }).toBe('updated')
  })

  test('moving a component into <Server> works without a page reload', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const playerContainer = page.locator('[style*="aspect-ratio"]').first()
    await expect(playerContainer).toBeVisible()
    await page.waitForFunction(() => window.egakiSDK?.seekTo)
    await page.evaluate(() => { (window as any).__hmr_marker = true })

    // Wrapping FeatureGrid in <Server> means app.tsx now dynamically
    // imports components.tsx server-side on the next flight refetch —
    // no module map regeneration, no full reload, just rsc:update.
    const updatedMdx = originalMdx.replace(
      '    <FeatureGrid features={FEATURES} />',
      '    <Server><FeatureGrid features={FEATURES} /></Server>',
    )
    expect(updatedMdx).not.toBe(originalMdx)
    fs.writeFileSync(mdxPath, updatedMdx)

    await expect.poll(async () => {
      const markerAlive = await page.evaluate(() => (window as any).__hmr_marker === true).catch(() => false)
      if (!markerAlive) return 'full-reload'
      // The flight refetch remounts the Player (frame resets), re-seek.
      // NOTE: assert on a FEATURES label that the data.ts test does NOT
      // rename ('MDX Components' becomes 'HMR DATA EDIT' in that test and
      // data.ts is only restored in afterAll).
      await page.evaluate(() => window.egakiSDK.seekTo(1050))
      const visible = await playerContainer.locator('text=OpenAPI Reference').first().isVisible().catch(() => false)
      return visible ? 'updated' : 'waiting'
    }, { timeout: 15_000, message: 'server-rendered FeatureGrid did not appear' }).toBe('updated')
  })
})

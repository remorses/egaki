/**
 * Tests for mdx-video: section splitting, frontmatter parsing,
 * background extraction, and JSX output via createMdxComposition.
 *
 * Uses inline snapshots so the rendered Remotion JSX structure
 * is visible directly in the test file for easy debugging.
 */

import React from 'react'
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SafeMdxRenderer } from 'safe-mdx'
import { mdxParse, extractImports, resolveModulePath } from 'safe-mdx/parse'
import type { EagerModules } from 'safe-mdx/parse'
import { MdastToJsx } from 'safe-mdx'
import { splitIntoSections, calculateTotalDuration, resolveAutoDurations, parseFrontmatter, aspectRatioFromDimensions } from './mdx-parse.ts'
import { findChangedSectionIndex } from './vite-plugin.ts'
import { computeEffectiveDuration, computeRetimeRate } from './media-duration-store.ts'
import { findServerNodes, blankServerContents, collectServerImportSources, wrapGenerateNodes, collectServerFileImportNames } from './server-mdx.ts'
import { stableJsonKey, hashKey, promptPrefix } from './server-components.tsx'
import { MDX_BUILTIN_COMPONENTS, springFromDuration, findSpringConfig } from './mdx-video.tsx'

describe('MDX_BUILTIN_COMPONENTS', () => {
  test('registry keys match client and server slot maps', () => {
    expect(Object.keys(MDX_BUILTIN_COMPONENTS).sort()).toMatchInlineSnapshot(`
      [
        "AngledScreen",
        "Animate",
        "AnimatedChart",
        "Audio",
        "Background",
        "BlurIn",
        "BlurOut",
        "BlurReveal",
        "CodeBlock",
        "FadeIn",
        "FadeOut",
        "FeaturePill",
        "Fill",
        "GeneratedImage",
        "GeneratedSpeech",
        "GeneratedVideo",
        "GlassCodeBlock",
        "Img",
        "LayoutTransition",
        "MaskedSlideReveal",
        "MeshGradientBg",
        "ShimmerSweep",
        "SlideIn",
        "SlideOut",
        "SlotText",
        "SpringPopIn",
        "StaggeredFadeUp",
        "TerminalSimulator",
        "Video",
        "ZoomIn",
        "ZoomOut",
      ]
    `)
  })
})

// Helper: parse MDX and split into sections in one call
function split(mdx: string) {
  const ast = mdxParse(mdx)
  return splitIntoSections(ast)
}

// Helper: summarize sections for readable snapshots
function summarize(mdx: string) {
  const { sections, frontmatter } = split(mdx)
  return {
    frontmatter,
    sections: sections.map((s) => ({
      heading: s.heading,
      durationInFrames: s.durationInFrames,

      nodes: s.nodes.length,
    })),
  }
}

describe('splitIntoSections', () => {
  test('basic sections with headings', () => {
    const result = summarize(`
# Intro

Hello world

# Middle

Some content

# End

Goodbye
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "frontmatter": {
          "bpm": 120,
          "fps": 30,
          "height": 1080,
          "scale": 1,
          "width": 1920,
        },
        "sections": [
          {
            "durationInFrames": null,
            "heading": "Intro",
            "nodes": 1,
          },
          {
            "durationInFrames": null,
            "heading": "Middle",
            "nodes": 1,
          },
          {
            "durationInFrames": null,
            "heading": "End",
            "nodes": 1,
          },
        ],
      }
    `)
  })

  test('frontmatter parsing with yaml', () => {
    const result = summarize(`---
fps: 60
bpm: 140
---

# Scene
`)
    expect(result.frontmatter).toMatchInlineSnapshot(`
      {
        "bpm": 140,
        "fps": 60,
        "height": 1080,
        "scale": 1,
        "width": 1920,
      }
    `)
  })

  test('duration in heading (seconds)', () => {
    const result = summarize(`
# Opening duration=3.3s

Content
    `)
    expect(result.sections[0]!.heading).toBe('Opening')
    expect(result.sections[0]!.durationInFrames).toBe(99) // 3.3 * 30fps
  })

  test('duration in heading (frames)', () => {
    const result = summarize(`
# Scene duration=200

Content
    `)
    expect(result.sections[0]!.durationInFrames).toBe(200)
  })

  test('duration in heading (beats)', () => {
    const result = summarize(`---
fps: 30
bpm: 120
---

# Scene duration=4beats

Content
    `)
    // 120bpm = 2 beats/sec, 1 beat = 15 frames, 4 beats = 60 frames
    expect(result.sections[0]!.durationInFrames).toBe(60)
  })

  test('duration with frames/f unit aliases', () => {
    const result = summarize(`
# A duration=90frames

x

# B duration=90frame

y

# C duration=90f

z

# D duration=90fps

w
    `)
    expect(result.sections[0]!.durationInFrames).toBe(90)
    expect(result.sections[1]!.durationInFrames).toBe(90)
    expect(result.sections[2]!.durationInFrames).toBe(90)
    expect(result.sections[3]!.durationInFrames).toBe(90)
  })

  test('background before first heading goes to preamble, not a section', () => {
    const result = split(`
<Background>
<MeshGradientBg colors={['#6366f1']} />
</Background>

# Scene

Content
    `)
    // Content before the first heading goes to preamble, not an implicit section
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]!.heading).toBe('Scene')
    expect(result.preamble.length).toBeGreaterThan(0)
  })

  test('background after heading is a regular content node', () => {
    const result = summarize(`
# Scene

<Background>
<MeshGradientBg colors={['#6366f1']} />
</Background>

Content
    `)
    // Background is included in section.nodes alongside content
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]!.nodes).toBe(2) // Background + Content paragraph
  })

  test('each section keeps its own background nodes', () => {
    const result = summarize(`
# Scene 1

<Background>
<Bg1 />
</Background>

Content 1

# Scene 2

<Background>
<Bg2 />
</Background>

Content 2
    `)
    expect(result.sections[0]!.nodes).toBe(2) // Background + Content
    expect(result.sections[1]!.nodes).toBe(2) // Background + Content
  })

  test('import statements are skipped (not treated as content)', () => {
    const result = summarize(`
import { Foo } from './foo'

# Scene

Content
    `)
    // Import should not create an implicit section before the heading
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]!.heading).toBe('Scene')
  })

  test('content before first heading goes to preamble', () => {
    const result = split(`
Some orphan content

# Scene

More content
    `)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]!.heading).toBe('Scene')
    expect(result.preamble.length).toBeGreaterThan(0)
  })
})

describe('parseFrontmatter and MDX scope (FPS, BEAT)', () => {
  test('default values: 30fps, 120bpm', () => {
    const ast = mdxParse('# Hello')
    const fm = parseFrontmatter(ast)
    expect(fm).toEqual({ fps: 30, bpm: 120, width: 1920, height: 1080, scale: 1 })
  })

  test('custom frontmatter', () => {
    const ast = mdxParse(`---\nfps: 60\nbpm: 140\n---\n\n# Hello`)
    const fm = parseFrontmatter(ast)
    expect(fm).toEqual({ fps: 60, bpm: 140, width: 1920, height: 1080, scale: 1 })
  })

  test('custom width and height', () => {
    const ast = mdxParse(`---\nwidth: 1080\nheight: 1920\n---\n\n# Vertical`)
    const fm = parseFrontmatter(ast)
    expect(fm).toEqual({ fps: 30, bpm: 120, width: 1080, height: 1920, scale: 1 })
  })

  test('custom scale', () => {
    const ast = mdxParse(`---\nscale: 2\n---\n\n# Hello`)
    expect(parseFrontmatter(ast)).toEqual({ fps: 30, bpm: 120, width: 1920, height: 1080, scale: 2 })
  })

  test('invalid scale falls back to default', () => {
    expect(parseFrontmatter(mdxParse(`---\nscale: 0\n---\n\n# Hello`)).scale).toBe(1)
    expect(parseFrontmatter(mdxParse(`---\nscale: -1\n---\n\n# Hello`)).scale).toBe(1)
    expect(parseFrontmatter(mdxParse(`---\nscale: "foo"\n---\n\n# Hello`)).scale).toBe(1)
  })

  test('aspectRatioFromDimensions: exact standard ratios', () => {
    expect(aspectRatioFromDimensions(1920, 1080)).toBe('16:9')
    expect(aspectRatioFromDimensions(1080, 1920)).toBe('9:16')
    expect(aspectRatioFromDimensions(1080, 1080)).toBe('1:1')
    expect(aspectRatioFromDimensions(1440, 1080)).toBe('4:3')
    expect(aspectRatioFromDimensions(1080, 1440)).toBe('3:4')
    expect(aspectRatioFromDimensions(1080, 1350)).toBe('4:5')
    expect(aspectRatioFromDimensions(1350, 1080)).toBe('5:4')
    expect(aspectRatioFromDimensions(1080, 1620)).toBe('2:3')
    expect(aspectRatioFromDimensions(1620, 1080)).toBe('3:2')
  })

  test('aspectRatioFromDimensions: non-standard picks closest', () => {
    // 1920×1200 = 8:5 (1.6) — closest standard is 16:9 (1.778) vs 3:2 (1.5)
    // 3:2 is closer (diff 0.1 vs 0.178)
    expect(aspectRatioFromDimensions(1920, 1200)).toBe('3:2')
    // 2560×1440 = 16:9 exact
    expect(aspectRatioFromDimensions(2560, 1440)).toBe('16:9')
    // 3840×2160 = 16:9 exact
    expect(aspectRatioFromDimensions(3840, 2160)).toBe('16:9')
  })

  test('aspectRatioFromDimensions: constrained to allowed ratios', () => {
    // Veo only supports 16:9 and 9:16
    expect(aspectRatioFromDimensions(1920, 1080, ['16:9', '9:16'])).toBe('16:9')
    expect(aspectRatioFromDimensions(1080, 1920, ['16:9', '9:16'])).toBe('9:16')
    // Square composition (1.0) is closer to 9:16 (0.5625) than 16:9 (1.778)
    expect(aspectRatioFromDimensions(1080, 1080, ['16:9', '9:16'])).toBe('9:16')
    // When allowed list includes 1:1, square matches exactly
    expect(aspectRatioFromDimensions(1080, 1080, ['16:9', '9:16', '1:1'])).toBe('1:1')
    // Non-standard dimensions pick closest from allowed
    expect(aspectRatioFromDimensions(1920, 1200, ['16:9', '9:16', '1:1'])).toBe('16:9')
  })

  test('FPS and BEAT available in safe-mdx scope for expressions', () => {
    const fps = 30
    const bpm = 120
    const mdxScope = { FPS: fps, BEAT: fps / (bpm / 60) }

    // BEAT at 120bpm, 30fps = 30 / (120/60) = 15 frames per beat
    expect(mdxScope.BEAT).toBe(15)

    // Verify scope works in safe-mdx expressions
    function Box({ delay }: { delay: number }) {
      return <div data-delay={delay} />
    }
    const code = `<Box delay={0.5 * FPS} />`
    const ast = mdxParse(code)
    const visitor = new MdastToJsx({
      markdown: code,
      mdast: ast,
      components: { Box },
      scope: mdxScope,
      baseUrl: './',
      evaluateOptions: { functions: true },
    })
    const result = visitor.run()
    const html = renderToStaticMarkup(result)
    // 0.5 * 30 = 15
    expect(html).toMatchInlineSnapshot(`"<div data-delay="15"></div>"`)
    expect(visitor.errors).toMatchInlineSnapshot(`[]`)
  })

  test('BEAT expression in safe-mdx scope', () => {
    const fps = 30
    const bpm = 120
    const mdxScope = { FPS: fps, BEAT: fps / (bpm / 60) }

    function Box({ duration }: { duration: number }) {
      return <div data-duration={duration} />
    }
    const code = `<Box duration={2 * BEAT} />`
    const ast = mdxParse(code)
    const visitor = new MdastToJsx({
      markdown: code,
      mdast: ast,
      components: { Box },
      scope: mdxScope,
      baseUrl: './',
      evaluateOptions: { functions: true },
    })
    const result = visitor.run()
    const html = renderToStaticMarkup(result)
    // 2 * 15 = 30
    expect(html).toMatchInlineSnapshot(`"<div data-duration="30"></div>"`)
    expect(visitor.errors).toMatchInlineSnapshot(`[]`)
  })
})

describe('calculateTotalDuration', () => {
  test('sums all section durations', () => {
    const { sections, frontmatter } = split(`
# A duration=100

x

# B duration=200

y

# C duration=50

z
    `)
    const resolved = resolveAutoDurations(sections, frontmatter.fps, frontmatter.bpm)
    expect(calculateTotalDuration(resolved)).toBe(350)
  })
})

describe('resolveAutoDurations', () => {
  test('resolves null duration from section durations map', () => {
    const { sections, frontmatter } = split(`
# Scene

Content
    `)
    expect(sections[0]!.durationInFrames).toBe(null)

    // sectionDurations keyed by section index as string
    const resolved = resolveAutoDurations(
      sections, frontmatter.fps, frontmatter.bpm,
      { '0': 10 },
    )
    // 10 seconds * 30 fps = 300 frames
    expect(resolved[0]!.durationInFrames).toBe(300)
  })

  test('falls back to default when no section duration available', () => {
    const { sections, frontmatter } = split(`
# Scene

Just text
    `)
    const resolved = resolveAutoDurations(sections, frontmatter.fps, frontmatter.bpm)
    // Default: 10 beats at 120bpm/30fps = 150 frames
    expect(resolved[0]!.durationInFrames).toBe(150)
  })

  test('preserves explicit duration unchanged', () => {
    const { sections, frontmatter } = split(`
# Scene duration=3s

Content
    `)
    expect(sections[0]!.durationInFrames).toBe(90) // 3s * 30fps
    // Even if the store has a duration for this section, explicit wins
    const resolved = resolveAutoDurations(
      sections, frontmatter.fps, frontmatter.bpm,
      { '0': 100 },
    )
    expect(resolved[0]!.durationInFrames).toBe(90)
  })

  test('mixed sections: explicit and auto', () => {
    const { sections, frontmatter } = split(`
# Explicit duration=2s

Text

# Auto

More text
    `)
    const resolved = resolveAutoDurations(
      sections, frontmatter.fps, frontmatter.bpm,
      { '1': 45.2 },
    )
    expect(resolved[0]!.durationInFrames).toBe(60) // 2s * 30fps (explicit)
    expect(resolved[1]!.durationInFrames).toBe(1356) // round(45.2 * 30) (auto)
  })
})

describe('Background rendering', () => {
  test('background node preserved in section nodes with children', () => {
    const mdx = `
# Scene

<Background>
<div style={{ background: 'red' }}>gradient</div>
</Background>

Content
`
    const ast = mdxParse(mdx)
    const result = splitIntoSections(ast)

    // Background is a regular node in section.nodes
    const bgNode = result.sections[0]!.nodes.find((n: any) => n.name === 'Background')
    expect(bgNode).toBeDefined()
    expect(bgNode.children.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Module resolution via safe-mdx MdastToJsx
// ---------------------------------------------------------------------------

describe('safe-mdx module resolution', () => {
  // Base components map (element overrides safe-mdx needs)
  const baseComponents = {
    p: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
    h1: ({ children }: { children?: React.ReactNode }) => <h1>{children}</h1>,
  }

  test('named import: component renders from modules', () => {
    function MyBadge({ label }: { label: string }) {
      return <span className="badge">{label}</span>
    }

    const code = `
import { MyBadge } from './components'

<MyBadge label="Hello" />
`
    const mdast = mdxParse(code)
    const visitor = new MdastToJsx({
      markdown: code,
      mdast,
      components: baseComponents,
      modules: {
        './components.tsx': { MyBadge },
      },
      baseUrl: './',
    })
    const result = visitor.run()
    const html = renderToStaticMarkup(result)
    expect(html).toMatchInlineSnapshot(`"<span class="badge">Hello</span>"`)
    expect(visitor.errors).toMatchInlineSnapshot(`[]`)
  })

  test('named import: data values available in expressions', () => {
    const ITEMS = ['apple', 'banana', 'cherry']

    const code = `
import { ITEMS } from './data'

There are {ITEMS.length} items.
`
    const mdast = mdxParse(code)
    const visitor = new MdastToJsx({
      markdown: code,
      mdast,
      components: baseComponents,
      modules: {
        './data.tsx': { ITEMS },
      },
      baseUrl: './',
      evaluateOptions: { functions: true },
    })
    const result = visitor.run()
    const html = renderToStaticMarkup(result)
    expect(html).toMatchInlineSnapshot(`"<p>There are 3 items.</p>"`)
    expect(visitor.errors).toMatchInlineSnapshot(`[]`)
  })

  test('named import: data passed as prop to component', () => {
    function ItemList({ items }: { items: string[] }) {
      return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    }
    const MY_DATA = ['one', 'two']

    const code = `
import { ItemList, MY_DATA } from './components'

<ItemList items={MY_DATA} />
`
    const mdast = mdxParse(code)
    const visitor = new MdastToJsx({
      markdown: code,
      mdast,
      components: baseComponents,
      modules: {
        './components.tsx': { ItemList, MY_DATA },
      },
      baseUrl: './',
    })
    const result = visitor.run()
    const html = renderToStaticMarkup(result)
    expect(html).toMatchInlineSnapshot(`"<ul><li>one</li><li>two</li></ul>"`)
    expect(visitor.errors).toMatchInlineSnapshot(`[]`)
  })

  test('unresolved import: produces error, does not crash', () => {
    const code = `
import { Missing } from './nonexistent'

<Missing />
`
    const mdast = mdxParse(code)
    const visitor = new MdastToJsx({
      markdown: code,
      mdast,
      components: baseComponents,
      modules: {},
      baseUrl: './',
    })
    const result = visitor.run()
    renderToStaticMarkup(result)
    expect(visitor.errors.length).toBeGreaterThan(0)
    expect(visitor.errors[0]!.message).toContain('Unresolved import')
  })

  test('multiple imports from different files', () => {
    function Card({ title }: { title: string }) {
      return <div className="card">{title}</div>
    }
    const CONFIG = { theme: 'dark' }

    const code = `
import { Card } from './ui'
import { CONFIG } from './config'

<Card title={CONFIG.theme} />
`
    const mdast = mdxParse(code)
    const visitor = new MdastToJsx({
      markdown: code,
      mdast,
      components: baseComponents,
      modules: {
        './ui.tsx': { Card },
        './config.tsx': { CONFIG },
      },
      baseUrl: './',
    })
    const result = visitor.run()
    const html = renderToStaticMarkup(result)
    expect(html).toMatchInlineSnapshot(`"<div class="card">dark</div>"`)
    expect(visitor.errors).toMatchInlineSnapshot(`[]`)
  })
})

// ---------------------------------------------------------------------------
// keyframes() — animation interpolation
// ---------------------------------------------------------------------------

import { keyframes, fromLottieProperty, extractLottieDimensionEasing } from './mdx-video.tsx'

describe('keyframes', () => {
  test('single keyframe returns its value', () => {
    expect(keyframes(0, [{ time: 0, value: 42 }])).toBe(42)
    expect(keyframes(100, [{ time: 0, value: 42 }])).toBe(42)
  })

  test('linear interpolation between two keyframes', () => {
    const kfs = [
      { time: 0, value: 0 },
      { time: 100, value: 100 },
    ] as const
    expect(keyframes(0, [...kfs])).toBe(0)
    expect(keyframes(50, [...kfs])).toBe(50)
    expect(keyframes(100, [...kfs])).toBe(100)
  })

  test('clamps outside keyframe range', () => {
    const kfs = [
      { time: 10, value: 0 },
      { time: 20, value: 100 },
    ]
    expect(keyframes(0, kfs)).toBe(0)
    expect(keyframes(30, kfs)).toBe(100)
  })

  test('bezier easing changes interpolation curve', () => {
    const linear = [
      { time: 0, value: 0 },
      { time: 100, value: 100 },
    ]
    const eased = [
      { time: 0, value: 0, easing: [0.8, 0, 1, 1] as [number, number, number, number] },
      { time: 100, value: 100 },
    ]
    const linearMid = keyframes(50, linear)
    const easedMid = keyframes(50, eased)
    // Strong ease-in at midpoint should be well below linear
    expect(linearMid).toBe(50)
    expect(easedMid).toBeLessThan(40)
    // But endpoints should be the same
    expect(keyframes(0, eased)).toBe(0)
    expect(keyframes(100, eased)).toBe(100)
  })

  test('overshoot with y > 1', () => {
    const kfs = [
      { time: 0, value: 0, easing: [0.34, 1.56, 0.64, 1] as [number, number, number, number] },
      { time: 100, value: 100 },
    ]
    // With overshoot easing, some intermediate frame should exceed 100
    const values = Array.from({ length: 101 }, (_, i) => keyframes(i, kfs))
    const max = Math.max(...values)
    expect(max).toBeGreaterThan(100)
    // Endpoints should still be correct
    expect(values[0]).toBe(0)
    expect(values[100]).toBe(100)
  })

  test('hold keyframe (step function)', () => {
    const kfs = [
      { time: 0, value: 0, hold: true },
      { time: 30, value: 100 },
      { time: 60, value: 200 },
    ]
    expect(keyframes(0, kfs)).toBe(0)
    expect(keyframes(15, kfs)).toBe(0)
    expect(keyframes(29, kfs)).toBe(0)
    expect(keyframes(30, kfs)).toBe(100)
    expect(keyframes(45, kfs)).toBe(150)
  })

  test('multi-keyframe sequence', () => {
    const kfs = [
      { time: 0, value: 0 },
      { time: 50, value: 100 },
      { time: 100, value: 0 },
    ]
    expect(keyframes(0, kfs)).toBe(0)
    expect(keyframes(25, kfs)).toBe(50)
    expect(keyframes(50, kfs)).toBe(100)
    expect(keyframes(75, kfs)).toBe(50)
    expect(keyframes(100, kfs)).toBe(0)
  })

  test('per-segment easing in multi-keyframe', () => {
    const linear = [
      { time: 0, value: 0 },
      { time: 50, value: 100 },
      { time: 100, value: 0 },
    ]
    const eased = [
      { time: 0, value: 0, easing: [0.8, 0, 1, 1] as [number, number, number, number] },
      { time: 50, value: 100, easing: [0.8, 0, 1, 1] as [number, number, number, number] },
      { time: 100, value: 0 },
    ]
    // Midpoints of each segment: linear gives 50, strong ease-in gives much less
    expect(keyframes(25, linear)).toBe(50)
    expect(keyframes(25, eased)).toBeLessThan(40)
  })

  test('vector keyframes return arrays', () => {
    const kfs = [
      { time: 0, value: [0, 0] },
      { time: 100, value: [200, 400] },
    ]
    const result = keyframes(50, kfs)
    expect(result).toEqual([100, 200])
  })

  test('vector keyframes clamp at boundaries', () => {
    const kfs = [
      { time: 10, value: [0, 100] },
      { time: 20, value: [50, 200] },
    ]
    expect(keyframes(0, kfs)).toEqual([0, 100])
    expect(keyframes(30, kfs)).toEqual([50, 200])
  })

  test('vector hold keyframe', () => {
    const kfs = [
      { time: 0, value: [10, 20], hold: true },
      { time: 30, value: [100, 200] },
    ]
    expect(keyframes(0, kfs)).toEqual([10, 20])
    expect(keyframes(15, kfs)).toEqual([10, 20])
    expect(keyframes(30, kfs)).toEqual([100, 200])
  })

  test('dimensionEasing overrides per-dimension', () => {
    const kfs = [
      { time: 0, value: [0, 0], easing: [0, 0, 1, 1] as [number, number, number, number] },
      { time: 100, value: [100, 100] },
    ]
    // Without dimension easing, both dimensions are linear
    const linear = keyframes(50, kfs) as number[]
    expect(linear[0]).toBeCloseTo(50, 0)
    expect(linear[1]).toBeCloseTo(50, 0)

    // With dimension easing overriding dim 1 with strong ease-in
    const withDimEasing = keyframes(50, kfs, {
      dimensionEasing: [undefined, [0.8, 0, 1, 1]],
    }) as number[]
    // Dim 0 stays linear (uses keyframe easing which is linear)
    expect(withDimEasing[0]).toBeCloseTo(50, 0)
    // Dim 1 uses strong ease-in, should be well below 50
    expect(withDimEasing[1]).toBeLessThan(40)
  })

  test('empty keyframes throws', () => {
    expect(() => keyframes(0, [])).toThrow('at least one keyframe')
  })
})

describe('fromLottieProperty', () => {
  test('static scalar property', () => {
    const result = fromLottieProperty({ a: 0, k: 50 })
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "time": 0,
          "value": 50,
        },
      ]
    `)
  })

  test('static vector property', () => {
    const result = fromLottieProperty({ a: 0, k: [100, 200] })
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "time": 0,
          "value": [
            100,
            200,
          ],
        },
      ]
    `)
  })

  test('animated scalar property', () => {
    const result = fromLottieProperty({
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0.333], y: [0] }, i: { x: [0.667], y: [1] } },
        { t: 30, s: [100] },
      ],
    })
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "easing": [
            0.333,
            0,
            0.667,
            1,
          ],
          "time": 0,
          "value": 0,
        },
        {
          "time": 30,
          "value": 100,
        },
      ]
    `)
  })

  test('animated scalar with hold', () => {
    const result = fromLottieProperty({
      a: 1,
      k: [
        { t: 0, s: [50], h: 1 },
        { t: 30, s: [100] },
      ],
    })
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "hold": true,
          "time": 0,
          "value": 50,
        },
        {
          "time": 30,
          "value": 100,
        },
      ]
    `)
  })

  test('animated vector property', () => {
    const result = fromLottieProperty({
      a: 1,
      k: [
        { t: 0, s: [100, 200], o: { x: [0.5, 0.3], y: [0, 0.2] }, i: { x: [0.5, 0.7], y: [1, 0.8] } },
        { t: 60, s: [500, 400] },
      ],
    })
    expect(result).toMatchInlineSnapshot(`
      [
        {
          "easing": [
            0.5,
            0,
            0.5,
            1,
          ],
          "time": 0,
          "value": [
            100,
            200,
          ],
        },
        {
          "time": 60,
          "value": [
            500,
            400,
          ],
        },
      ]
    `)
  })

  test('roundtrip: fromLottieProperty -> keyframes produces correct values', () => {
    const kfs = fromLottieProperty({
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } },
        { t: 100, s: [200] },
      ],
    }) as any
    // Linear easing (o={0,0} i={1,1}), so midpoint should be 100
    expect(keyframes(50, kfs)).toBe(100)
    expect(keyframes(0, kfs)).toBe(0)
    expect(keyframes(100, kfs)).toBe(200)
  })
})

describe('extractLottieDimensionEasing', () => {
  test('returns undefined for scalar properties', () => {
    const result = extractLottieDimensionEasing(
      { a: 1, k: [{ t: 0, s: [0], o: { x: [0.5], y: [0] }, i: { x: [0.5], y: [1] } }, { t: 30, s: [100] }] },
      0,
    )
    expect(result).toBeUndefined()
  })

  test('returns per-dimension curves for vector properties', () => {
    const result = extractLottieDimensionEasing(
      {
        a: 1,
        k: [
          { t: 0, s: [0, 0], o: { x: [0.3, 0.5], y: [0, 0.2] }, i: { x: [0.7, 0.8], y: [1, 0.9] } },
          { t: 30, s: [100, 200] },
        ],
      },
      0,
    )
    expect(result).toMatchInlineSnapshot(`
      [
        [
          0.3,
          0,
          0.7,
          1,
        ],
        [
          0.5,
          0.2,
          0.8,
          0.9,
        ],
      ]
    `)
  })

  test('returns undefined for static properties', () => {
    expect(extractLottieDimensionEasing({ a: 0, k: [100, 200] }, 0)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// MDX file imports — React composition approach
// ---------------------------------------------------------------------------

describe('MDX file imports', () => {
  const baseComponents: Record<string, any> = {
    p: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
    h1: ({ children }: { children?: React.ReactNode }) => <h1>{children}</h1>,
    strong: ({ children }: { children?: React.ReactNode }) => <strong>{children}</strong>,
  }

  /** Simulates the rendering pipeline from mdx-client.tsx: detect .mdx imports in the
   *  main MDX, render each one into a component, then merge into the modules map. */
  function renderWithMdxImports(mainCode: string, modules: EagerModules) {
    const ast = mdxParse(mainCode)
    const moduleKeys = Object.keys(modules)
    const merged: EagerModules = { ...modules }

    const imports = extractImports(ast)
    for (const imp of imports) {
      if (!/\.mdx?$/.test(imp.source)) continue
      const key = resolveModulePath(imp.source, './', moduleKeys)
      if (!key || !merged[key]) continue
      const rawContent = merged[key].default
      if (typeof rawContent !== 'string') continue
      const importedAst = mdxParse(rawContent)
      const renderedJsx = (
        <SafeMdxRenderer
          markdown={rawContent}
          mdast={importedAst}
          components={baseComponents}
          modules={merged}

          baseUrl="./"
        />
      )
      merged[key] = { default: () => renderedJsx }
    }

    const visitor = new MdastToJsx({
      markdown: mainCode,
      mdast: ast,
      components: baseComponents,
      modules: merged,
      baseUrl: './',
    })
    return { jsx: visitor.run(), errors: visitor.errors }
  }

  test('imported .mdx renders as React component', () => {
    const mainCode = `
import Intro from './intro.mdx'

<Intro />
`
    const modules: EagerModules = {
      './intro.mdx': { default: 'Hello from **imported** MDX' },
    }

    const { jsx, errors } = renderWithMdxImports(mainCode, modules)
    const html = renderToStaticMarkup(jsx)
    expect(html).toMatchInlineSnapshot(
      `"<p>Hello from <strong>imported</strong> MDX</p>"`,
    )
    expect(errors).toMatchInlineSnapshot(`[]`)
  })

  test('imported .mdx can use .tsx components from the same modules map', () => {
    function Badge({ label }: { label: string }) {
      return <span className="badge">{label}</span>
    }

    const mainCode = `
import Snippet from './snippet.mdx'

<Snippet />
`
    const snippetContent = `
import { Badge } from './ui'

<Badge label="new" />
`
    const modules: EagerModules = {
      './snippet.mdx': { default: snippetContent },
      './ui.tsx': { Badge },
    }

    const { jsx, errors } = renderWithMdxImports(mainCode, modules)
    const html = renderToStaticMarkup(jsx)
    expect(html).toMatchInlineSnapshot(
      `"<span class="badge">new</span>"`,
    )
    expect(errors).toMatchInlineSnapshot(`[]`)
  })

  test('unresolved .mdx import produces error gracefully', () => {
    const mainCode = `
import Missing from './missing.mdx'

<Missing />
`
    const { jsx, errors } = renderWithMdxImports(mainCode, {})
    renderToStaticMarkup(jsx)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]!.message).toContain('Unresolved import')
  })

  test('imported .mdx with multiple elements', () => {
    const mainCode = `
import Content from './content.mdx'

<Content />
`
    const modules: EagerModules = {
      './content.mdx': {
        default: `First paragraph

Second paragraph with **bold**`,
      },
    }

    const { jsx, errors } = renderWithMdxImports(mainCode, modules)
    const html = renderToStaticMarkup(jsx)
    expect(html).toMatchInlineSnapshot(
      `"<p>First paragraph</p><p>Second paragraph with <strong>bold</strong></p>"`,
    )
    expect(errors).toMatchInlineSnapshot(`[]`)
  })

  test('main MDX can mix .mdx imports with .tsx imports', () => {
    function Card({ title, children }: { title: string; children?: React.ReactNode }) {
      return <div className="card"><h2>{title}</h2>{children}</div>
    }

    const mainCode = `
import { Card } from './ui'
import Snippet from './snippet.mdx'

<Card title="Welcome">
  <Snippet />
</Card>
`
    const modules: EagerModules = {
      './ui.tsx': { Card },
      './snippet.mdx': { default: 'Snippet **content**' },
    }

    const { jsx, errors } = renderWithMdxImports(mainCode, modules)
    const html = renderToStaticMarkup(jsx)
    expect(html).toMatchInlineSnapshot(
      `"<div class="card"><h2>Welcome</h2><p>Snippet <strong>content</strong></p></div>"`,
    )
    expect(errors).toMatchInlineSnapshot(`[]`)
  })
})

describe('LayoutTransition', () => {
  test('renders wrapper div with data-layout-id and children', async () => {
    const { LayoutTransition, LayoutTransitionProvider, LayoutGhost } =
      await import('./mdx-video.tsx')
    const html = renderToStaticMarkup(
      <LayoutTransitionProvider>
        <LayoutGhost>
          <LayoutTransition id="title">
            <span>Hello</span>
          </LayoutTransition>
        </LayoutGhost>
        <LayoutTransition id="title" duration={25} bounce={0.2}>
          <span>Hello</span>
        </LayoutTransition>
      </LayoutTransitionProvider>,
    )
    expect(html).toMatchInlineSnapshot(
      `"<div data-layout-id="title" style="transform-origin:0 0"><span>Hello</span></div><div data-layout-id="title" style="transform-origin:0 0"><span>Hello</span></div>"`,
    )
  })

  test('renders children without provider (used outside sections)', async () => {
    const { LayoutTransition } = await import('./mdx-video.tsx')
    const html = renderToStaticMarkup(
      <LayoutTransition id="solo">
        <span>Alone</span>
      </LayoutTransition>,
    )
    expect(html).toMatchInlineSnapshot(
      `"<div data-layout-id="solo" style="transform-origin:0 0"><span>Alone</span></div>"`,
    )
  })

  test('intra-scene: renders multiple instances with showFrom/showUpTo', async () => {
    const { LayoutTransition, LayoutTransitionProvider } =
      await import('./mdx-video.tsx')
    // Outside Remotion context, useSafeCurrentFrame returns 0, so only the
    // first instance (showFrom=0) should be visible. Others get visibility:hidden.
    const html = renderToStaticMarkup(
      <LayoutTransitionProvider>
        <LayoutTransition id="dot" showFrom={0} showUpTo={30}>
          <span>Dot 1</span>
        </LayoutTransition>
        <LayoutTransition id="dot" showFrom={30} showUpTo={60}>
          <span>Dot 2</span>
        </LayoutTransition>
        <LayoutTransition id="dot" showFrom={60} showUpTo={90}>
          <span>Dot 3</span>
        </LayoutTransition>
      </LayoutTransitionProvider>,
    )
    // First is active (frame 0 is in [0, 30)), second and third are hidden
    expect(html).toContain('data-layout-id="dot"')
    expect(html).toContain('<span>Dot 1</span>')
    expect(html).toContain('visibility:hidden')
    expect(html).toContain('<span>Dot 2</span>')
    expect(html).toContain('<span>Dot 3</span>')
  })

  test('intra-scene: without time range props, no visibility style applied', async () => {
    const { LayoutTransition, LayoutTransitionProvider } =
      await import('./mdx-video.tsx')
    const html = renderToStaticMarkup(
      <LayoutTransitionProvider>
        <LayoutTransition id="title">
          <span>Always visible</span>
        </LayoutTransition>
      </LayoutTransitionProvider>,
    )
    expect(html).not.toContain('visibility')
    expect(html).toContain('<span>Always visible</span>')
  })

  test('accepts mode prop without changing rendered output', async () => {
    const { LayoutTransition } = await import('./mdx-video.tsx')
    const html = renderToStaticMarkup(
      <LayoutTransition id="card" mode="position">
        <div>Card</div>
      </LayoutTransition>,
    )
    // mode is an internal prop consumed by LayoutAnimationLayer, not rendered
    expect(html).toContain('data-layout-id="card"')
    expect(html).toContain('<div>Card</div>')
    expect(html).not.toContain('mode')
  })

  test('mode="size" with ghost and visible', async () => {
    const { LayoutTransition, LayoutTransitionProvider, LayoutGhost } =
      await import('./mdx-video.tsx')
    const html = renderToStaticMarkup(
      <LayoutTransitionProvider>
        <LayoutGhost>
          <LayoutTransition id="box" mode="size">
            <div style={{ width: 100, height: 100 }}>Small</div>
          </LayoutTransition>
        </LayoutGhost>
        <LayoutTransition id="box" mode="size">
          <div style={{ width: 200, height: 200 }}>Big</div>
        </LayoutTransition>
      </LayoutTransitionProvider>,
    )
    expect(html).toContain('data-layout-id="box"')
    expect(html).toContain('Small')
    expect(html).toContain('Big')
  })
})

describe('findServerNodes', () => {
  test('flow-level Server elements with position keys', () => {
    const mdx = `# Section duration=2s

<Server>
  <AsyncStats delay={500} />
</Server>

Some text

<Server>
  <TextToSpeech text="hello" />
</Server>
`
    const nodes = findServerNodes(mdxParse(mdx))
    expect(nodes.map((n) => ({ key: n.key, type: n.node.type, children: n.node.children.length }))).toMatchInlineSnapshot(`
      [
        {
          "children": 1,
          "key": "3",
          "type": "mdxJsxFlowElement",
        },
        {
          "children": 1,
          "key": "9",
          "type": "mdxJsxFlowElement",
        },
      ]
    `)
  })

  test('inline Server inside a paragraph', () => {
    const mdx = `# Section

before <Server><Stat /></Server> after
`
    const nodes = findServerNodes(mdxParse(mdx))
    expect(nodes.map((n) => ({ key: n.key, type: n.node.type }))).toMatchInlineSnapshot(`
      [
        {
          "key": "3",
          "type": "mdxJsxTextElement",
        },
      ]
    `)
  })

  test('nested Server is skipped (outer slot covers it)', () => {
    const mdx = `<Server>
  <Server>
    <Inner />
  </Server>
</Server>
`
    const nodes = findServerNodes(mdxParse(mdx))
    expect(nodes.map((n) => n.key)).toMatchInlineSnapshot(`
      [
        "1",
      ]
    `)
  })

  test('Server inside other wrapper elements is found', () => {
    const mdx = `<FadeIn duration={15}>
  <Server>
    <AsyncStats />
  </Server>
</FadeIn>
`
    const nodes = findServerNodes(mdxParse(mdx))
    expect(nodes.map((n) => n.key)).toMatchInlineSnapshot(`
      [
        "2",
      ]
    `)
  })
})

describe('blankServerContents', () => {
  function blank(mdx: string) {
    const nodes = findServerNodes(mdxParse(mdx))
    return blankServerContents(mdx, nodes)
  }

  test('multi-line flow block preserves line count', () => {
    const mdx = `# Section duration=2s

<Server>
  <AsyncStats
    delay={500}
  />
</Server>

after content
`
    const result = blank(mdx)
    expect(result.split('\n').length).toBe(mdx.split('\n').length)
    expect(result).toMatchInlineSnapshot(`
      "# Section duration=2s

      <Server />





      after content
      "
    `)
  })

  test('multiple Server blocks, back-to-front splicing', () => {
    const mdx = `<Server>
  <One />
</Server>

middle

<Server>
  <Two />
</Server>
`
    const result = blank(mdx)
    expect(result.split('\n').length).toBe(mdx.split('\n').length)
    expect(result).toMatchInlineSnapshot(`
      "<Server />



      middle

      <Server />


      "
    `)
  })

  test('inline Server keeps surrounding text on the same line', () => {
    const mdx = `before <Server><Stat /></Server> after
`
    const result = blank(mdx)
    expect(result.split('\n').length).toBe(mdx.split('\n').length)
    expect(result).toMatchInlineSnapshot(`
      "before <Server /> after
      "
    `)
  })

  test('nested Server: only outer block replaced', () => {
    const mdx = `<Server>
  <Server>
    <Inner />
  </Server>
</Server>
`
    const result = blank(mdx)
    expect(result.split('\n').length).toBe(mdx.split('\n').length)
    expect(result).toMatchInlineSnapshot(`
      "<Server />




      "
    `)
  })

  test('roundtrip: blanked Server node keeps the original position key', () => {
    const mdx = `# A duration=1s

text before

<Server>
  <AsyncStats />
</Server>

# B duration=1s

<FadeIn>
  <Server><Inline /></Server>
</FadeIn>
`
    const originalNodes = findServerNodes(mdxParse(mdx))
    const blanked = blankServerContents(mdx, originalNodes)
    const reparsedNodes = findServerNodes(mdxParse(blanked))
    expect(reparsedNodes.map((n) => n.key)).toEqual(originalNodes.map((n) => n.key))
    expect(originalNodes.map((n) => n.key)).toMatchInlineSnapshot(`
      [
        "5",
        "12",
      ]
    `)
  })
})

describe('collectServerImportSources', () => {
  function classify(mdx: string) {
    return collectServerImportSources(mdxParse(mdx))
  }

  test('import used inside Server is collected', () => {
    const mdx = `import { AsyncStats } from './async-stats'
import { FeatureGrid } from './components'

# A duration=1s

<FeatureGrid />

<Server>
  <AsyncStats />
</Server>
`
    expect(classify(mdx)).toMatchInlineSnapshot(`
      [
        "./async-stats",
      ]
    `)
  })

  test('component used inside AND outside Server is still collected', () => {
    const mdx = `import { Stats } from './stats'

<Server>
  <Stats />
</Server>

<Stats />
`
    expect(classify(mdx)).toMatchInlineSnapshot(`
      [
        "./stats",
      ]
    `)
  })

  test('attribute expression identifiers inside Server pull in data imports', () => {
    const mdx = `import { Chart } from './chart'
import { STATS } from './stats-data'

<Server>
  <Chart data={STATS} />
</Server>
`
    expect(classify(mdx)).toMatchInlineSnapshot(`
      [
        "./chart",
        "./stats-data",
      ]
    `)
  })

  test('flow expression identifiers inside Server are collected', () => {
    const mdx = `import { format } from './utils'

<Server>
  {format('hello')}
</Server>
`
    expect(classify(mdx)).toMatchInlineSnapshot(`
      [
        "./utils",
      ]
    `)
  })

  test('namespace member JSX uses the root identifier', () => {
    const mdx = `import * as widgets from './widgets'

<Server>
  <widgets.Stats />
</Server>
`
    expect(classify(mdx)).toMatchInlineSnapshot(`
      [
        "./widgets",
      ]
    `)
  })

  test('bare specifiers are collected (resolved by vite at import time)', () => {
    const mdx = `import { TextToSpeech } from 'egaki/video'

<Server>
  <TextToSpeech text="hi" />
</Server>
`
    expect(classify(mdx)).toMatchInlineSnapshot(`
      [
        "egaki/video",
      ]
    `)
  })

  test('no Server blocks means no sources', () => {
    const mdx = `import { FeatureGrid } from './components'

<FeatureGrid />
`
    expect(classify(mdx)).toMatchInlineSnapshot(`[]`)
  })

  test('default import used inside Server', () => {
    const mdx = `import Tts from './tts'

<Server>
  <Tts voice="echo" />
</Server>
`
    expect(classify(mdx)).toMatchInlineSnapshot(`
      [
        "./tts",
      ]
    `)
  })
})

// ---------------------------------------------------------------------------
// wrapGenerateNodes
// ---------------------------------------------------------------------------

describe('wrapGenerateNodes', () => {
  test('wraps bare GeneratedImage in Server', () => {
    const mdx = `# Section duration=2s

<GeneratedImage prompt="a cat" seed={1} />
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes.map((n) => ({
      key: n.key,
      childName: n.node.children[0]?.name,
    }))).toMatchInlineSnapshot(`
      [
        {
          "childName": "GeneratedImage",
          "key": "3",
        },
      ]
    `)
  })

  test('wraps all three generated component types', () => {
    const mdx = `# Section duration=5s

<GeneratedImage prompt="a cat" seed={1} />

<GeneratedVideo prompt="a dog running" seed={2} />

<GeneratedSpeech text="hello world" seed={3} />
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes.map((n) => ({
      key: n.key,
      childName: n.node.children[0]?.name,
    }))).toMatchInlineSnapshot(`
      [
        {
          "childName": "GeneratedImage",
          "key": "3",
        },
        {
          "childName": "GeneratedVideo",
          "key": "5",
        },
        {
          "childName": "GeneratedSpeech",
          "key": "7",
        },
      ]
    `)
  })

  test('skips when already inside Server', () => {
    const mdx = `# Section duration=2s

<Server>
  <GeneratedImage prompt="a cat" seed={1} />
</Server>
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    // Only one Server node (the original), not double-wrapped
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.node.children[0]?.name).not.toBe('Server')
  })

  test('preserves line positions for slot keying', () => {
    const mdx = `# A duration=1s

<GeneratedImage prompt="test" seed={1} />

# B duration=1s

<GeneratedVideo prompt="test" seed={2} />
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes.map((n) => n.key)).toMatchInlineSnapshot(`
      [
        "3",
        "7",
      ]
    `)
  })

  test('wraps inside other wrapper elements', () => {
    const mdx = `<FadeIn duration={15}>
  <GeneratedImage prompt="nested" seed={1} />
</FadeIn>
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.node.children[0]?.name).toBe('GeneratedImage')
  })

  test('blankServerContents roundtrip preserves line count', () => {
    const mdx = `# Section duration=2s

<GeneratedImage prompt="a cat" seed={1} />

some text after
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    const blanked = blankServerContents(mdx, nodes)
    expect(blanked.split('\n').length).toBe(mdx.split('\n').length)
  })
})

// ---------------------------------------------------------------------------
// collectServerFileImportNames + auto-wrap .server imports
// ---------------------------------------------------------------------------

describe('collectServerFileImportNames', () => {
  test('collects names from .server import source', () => {
    const mdx = `import { HeroScene } from './hero-scene.server'

# Scene
<HeroScene />
`
    const ast = mdxParse(mdx)
    expect([...collectServerFileImportNames(ast)]).toMatchInlineSnapshot(`
      [
        "HeroScene",
      ]
    `)
  })

  test('collects names from .server.tsx import source', () => {
    const mdx = `import { HeroScene, Sidebar } from './hero-scene.server.tsx'

# Scene
<HeroScene />
`
    const ast = mdxParse(mdx)
    expect([...collectServerFileImportNames(ast)].sort()).toMatchInlineSnapshot(`
      [
        "HeroScene",
        "Sidebar",
      ]
    `)
  })

  test('collects default imports from .server files', () => {
    const mdx = `import MyScene from './my-scene.server'

# Scene
<MyScene />
`
    const ast = mdxParse(mdx)
    expect([...collectServerFileImportNames(ast)]).toMatchInlineSnapshot(`
      [
        "MyScene",
      ]
    `)
  })

  test('ignores non-server imports', () => {
    const mdx = `import { Widget } from './widget'
import { ServerThing } from './thing.server'

# Scene
<Widget />
<ServerThing />
`
    const ast = mdxParse(mdx)
    expect([...collectServerFileImportNames(ast)]).toMatchInlineSnapshot(`
      [
        "ServerThing",
      ]
    `)
  })
})

describe('wrapGenerateNodes with .server imports', () => {
  test('auto-wraps components from .server import', () => {
    const mdx = `import { HeroScene } from './hero-scene.server'

# Scene duration=5s

<HeroScene />
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes.map((n) => ({
      key: n.key,
      childName: n.node.children[0]?.name,
    }))).toMatchInlineSnapshot(`
      [
        {
          "childName": "HeroScene",
          "key": "5",
        },
      ]
    `)
  })

  test('does not wrap non-server imports', () => {
    const mdx = `import { Widget } from './widget'

# Scene duration=5s

<Widget />
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes).toMatchInlineSnapshot(`[]`)
  })

  test('mixed: wraps server imports, leaves regular imports alone', () => {
    const mdx = `import { HeroScene } from './hero-scene.server'
import { Widget } from './widget'

# Scene duration=5s

<HeroScene />
<Widget />
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes.map((n) => ({
      key: n.key,
      childName: n.node.children[0]?.name,
    }))).toMatchInlineSnapshot(`
      [
        {
          "childName": "HeroScene",
          "key": "6",
        },
      ]
    `)
  })

  test('skips when .server component is already inside Server', () => {
    const mdx = `import { HeroScene } from './hero-scene.server'

# Scene duration=5s

<Server>
  <HeroScene />
</Server>
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.node.children[0]?.name).not.toBe('Server')
  })

  test('blankServerContents preserves line count for .server wrapping', () => {
    const mdx = `import { HeroScene } from './hero-scene.server'

# Scene duration=5s

<HeroScene />

some text after
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    const blanked = blankServerContents(mdx, nodes)
    expect(blanked.split('\n').length).toBe(mdx.split('\n').length)
  })

  test('auto-wraps namespace imports from .server files', () => {
    const mdx = `import * as Scenes from './scenes.server'

# Scene
<Scenes.Hero />
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.node.children[0]?.name).toBe('Scenes.Hero')
  })

  test('.server.ts extension is recognized', () => {
    const mdx = `import { DataScene } from './data.server.ts'

# Scene
<DataScene />
`
    const ast = mdxParse(mdx)
    wrapGenerateNodes(ast)
    const nodes = findServerNodes(ast)
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.node.children[0]?.name).toBe('DataScene')
  })
})

// ---------------------------------------------------------------------------
// Caching utilities (server-components.tsx)
// ---------------------------------------------------------------------------

describe('stableJsonKey', () => {
  test('produces identical output regardless of key order', () => {
    const a = stableJsonKey({ prompt: 'cat', seed: 1, model: 'imagen-4' })
    const b = stableJsonKey({ model: 'imagen-4', prompt: 'cat', seed: 1 })
    expect(a).toBe(b)
  })

  test('different values produce different keys', () => {
    const a = stableJsonKey({ prompt: 'cat', seed: 1 })
    const b = stableJsonKey({ prompt: 'dog', seed: 1 })
    expect(a).not.toBe(b)
  })

  test('undefined values are included', () => {
    const a = stableJsonKey({ prompt: 'cat', seed: 1, model: undefined })
    const b = stableJsonKey({ prompt: 'cat', seed: 1 })
    // JSON.stringify drops undefined values, so these should be equal
    expect(a).toBe(b)
  })
})

describe('hashKey', () => {
  test('produces 8-char hex string', () => {
    const h = hashKey('test input')
    expect(h).toMatch(/^[0-9a-f]{8}$/)
  })

  test('is deterministic', () => {
    expect(hashKey('same')).toBe(hashKey('same'))
  })
})

describe('promptPrefix', () => {
  test('converts to kebab case', () => {
    expect(promptPrefix('A beautiful sunset over the ocean')).toMatchInlineSnapshot(
      `"a-beautiful-sunset-over-the-ocean"`,
    )
  })

  test('truncates long prompts to 40 chars', () => {
    const long = 'a very long prompt that exceeds forty characters and should be truncated'
    const result = promptPrefix(long)
    expect(result.length).toBeLessThanOrEqual(40)
  })

  test('removes special characters', () => {
    expect(promptPrefix('Hello! @world #test (foo) [bar]')).toMatchInlineSnapshot(
      `"hello-world-test-foo-bar"`,
    )
  })

  test('handles empty string', () => {
    expect(promptPrefix('')).toBe('generated')
  })

  test('handles non-ascii-only string', () => {
    expect(promptPrefix('🎨🖼️')).toBe('generated')
  })

  test('does not end with a dash', () => {
    const result = promptPrefix('a b c d e f g h i j k l m n o p q r s t u v')
    expect(result.endsWith('-')).toBe(false)
  })
})

describe('computeEffectiveDuration with gap props', () => {

  test('no gaps returns media-only duration', () => {
    expect(computeEffectiveDuration({ rawSeconds: 3, fps: 30 })).toBe(3)
  })

  test('gapBefore adds frames to total duration', () => {
    // 3s media + 30 frames (1s) gapBefore = 4s
    expect(computeEffectiveDuration({ rawSeconds: 3, fps: 30, gapBefore: 30 })).toBe(4)
  })

  test('gapAfter adds frames to total duration', () => {
    // 3s media + 60 frames (2s) gapAfter = 5s
    expect(computeEffectiveDuration({ rawSeconds: 3, fps: 30, gapAfter: 60 })).toBe(5)
  })

  test('both gaps add to total duration', () => {
    // 3s media + 30 frames (1s) before + 60 frames (2s) after = 6s
    expect(computeEffectiveDuration({ rawSeconds: 3, fps: 30, gapBefore: 30, gapAfter: 60 })).toBe(6)
  })

  test('gaps work with trim props', () => {
    // trim: frames 0-90 = 3s, + 30 frames gap = 4s
    expect(computeEffectiveDuration({ fps: 30, trimBefore: 0, trimAfter: 90, gapBefore: 30 })).toBe(4)
  })

  test('gaps work with playbackRate', () => {
    // 3s media at 2x = 1.5s, + 30 gap frames → (90 media + 30 gap) / 30fps / 2 = 2s
    expect(computeEffectiveDuration({ rawSeconds: 3, fps: 30, playbackRate: 2, gapBefore: 30 })).toBe(2)
  })

  test('returns null when duration cannot be determined', () => {
    expect(computeEffectiveDuration({ fps: 30, gapBefore: 30 })).toBeNull()
  })
})

describe('computeRetimeRate', () => {

  test('10s media in 5s section → rate 2 (2x speed)', () => {
    // 10s raw = 300 frames at 30fps, target = 150 frames (5s)
    expect(computeRetimeRate({ rawSeconds: 10, fps: 30, targetFrames: 150 })).toBe(2)
  })

  test('3s media in 6s section → rate 0.5 (half speed)', () => {
    // 3s raw = 90 frames, target = 180 frames (6s)
    expect(computeRetimeRate({ rawSeconds: 3, fps: 30, targetFrames: 180 })).toBe(0.5)
  })

  test('media already fits → rate 1', () => {
    expect(computeRetimeRate({ rawSeconds: 5, fps: 30, targetFrames: 150 })).toBe(1)
  })

  test('trimmed media retimes the trimmed portion', () => {
    // trimBefore=30, trimAfter=120 → 90 media frames, target=45 → rate 2
    expect(computeRetimeRate({ fps: 30, trimBefore: 30, trimAfter: 120, targetFrames: 45 })).toBe(2)
  })

  test('gaps are subtracted from target', () => {
    // 3s raw = 90 frames, gapBefore=30 → available = 150-30 = 120 → rate = 90/120 = 0.75
    expect(computeRetimeRate({ rawSeconds: 3, fps: 30, gapBefore: 30, targetFrames: 150 })).toBe(0.75)
  })

  test('both gaps subtracted', () => {
    // 3s raw = 90 frames, gapBefore=15 + gapAfter=15 → available = 150-30 = 120 → 90/120 = 0.75
    expect(computeRetimeRate({ rawSeconds: 3, fps: 30, gapBefore: 15, gapAfter: 15, targetFrames: 150 })).toBe(0.75)
  })

  test('returns null when raw duration unknown and no trim bounds', () => {
    expect(computeRetimeRate({ fps: 30, targetFrames: 150 })).toBeNull()
  })

  test('returns null when gaps consume all available frames', () => {
    expect(computeRetimeRate({ rawSeconds: 3, fps: 30, gapBefore: 150, targetFrames: 150 })).toBeNull()
  })

  test('returns null when media frames are zero', () => {
    expect(computeRetimeRate({ fps: 30, trimBefore: 90, trimAfter: 90, targetFrames: 150 })).toBeNull()
  })

  test('works with explicit number targetFrames (retimeToFit as number)', () => {
    // 5s raw = 150 frames, target = 300 frames → rate 0.5
    expect(computeRetimeRate({ rawSeconds: 5, fps: 30, targetFrames: 300 })).toBe(0.5)
  })
})

describe('findChangedSectionIndex', () => {
  const base = [
    '---',
    'fps: 30',
    'bpm: 120',
    '---',
    '',
    '# Intro duration=3s',
    '',
    'Hello world',
    '',
    '# Middle duration=2s',
    '',
    'Some content here',
    '',
    '# Outro duration=1s',
    '',
    'Goodbye',
  ].join('\n')

  test('identical content returns null', () => {
    expect(findChangedSectionIndex(base, base)).toBe(null)
  })

  test('editing first section returns 0', () => {
    const edited = base.replace('Hello world', 'Hello EDITED')
    expect(findChangedSectionIndex(base, edited)).toBe(0)
  })

  test('editing second section returns 1', () => {
    const edited = base.replace('Some content here', 'New content')
    expect(findChangedSectionIndex(base, edited)).toBe(1)
  })

  test('editing last section returns 2', () => {
    const edited = base.replace('Goodbye', 'See ya')
    expect(findChangedSectionIndex(base, edited)).toBe(2)
  })

  test('adding a new section returns its index', () => {
    const added = base + '\n\n# Bonus duration=1s\n\nExtra stuff'
    expect(findChangedSectionIndex(base, added)).toBe(3)
  })

  test('deleting last section returns null (skip deletions)', () => {
    const deleted = base.replace('\n# Outro duration=1s\n\nGoodbye', '')
    expect(findChangedSectionIndex(base, deleted)).toBe(null)
  })

  test('deleting middle section returns null (skip deletions)', () => {
    const deleted = base.replace('\n# Middle duration=2s\n\nSome content here\n', '\n')
    expect(findChangedSectionIndex(base, deleted)).toBe(null)
  })

  test('editing heading text returns that section index', () => {
    const edited = base.replace('# Middle duration=2s', '# Middle Renamed duration=2s')
    expect(findChangedSectionIndex(base, edited)).toBe(1)
  })

  test('preamble-only change returns null', () => {
    const withPreamble = '<Audio src="/bg.mp3" />\n\n' + base.split('\n').slice(4).join('\n')
    const oldPreamble = '---\nfps: 30\nbpm: 120\n---\n\n' + withPreamble
    const newPreamble = oldPreamble.replace('/bg.mp3', '/new-bg.mp3')
    expect(findChangedSectionIndex(oldPreamble, newPreamble)).toBe(null)
  })

  test('frontmatter-only change returns null', () => {
    const edited = base.replace('fps: 30', 'fps: 60')
    expect(findChangedSectionIndex(base, edited)).toBe(null)
  })

  test('editing heading duration returns that section index', () => {
    const edited = base.replace('duration=3s', 'duration=4s')
    expect(findChangedSectionIndex(base, edited)).toBe(0)
  })

  test('editing heading transition returns that section index', () => {
    const old = '# Intro duration=3s transition=10\n\nHello'
    const edited = '# Intro duration=3s transition=20\n\nHello'
    expect(findChangedSectionIndex(old, edited)).toBe(0)
  })

  test('broken MDX returns null (does not throw)', () => {
    const valid = '# Intro duration=3s\n\nHello world'
    const broken = '# Intro duration=3s\n\n<Component'
    expect(findChangedSectionIndex(valid, broken)).toBe(null)
  })

  test('both sources broken returns null', () => {
    expect(findChangedSectionIndex('<Foo', '<Bar')).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// Parse error recovery
// ---------------------------------------------------------------------------

describe('mdxParse error recovery', () => {
  test('mdxParse throws on unclosed JSX tag', () => {
    expect(() => mdxParse('<Component')).toThrow()
  })

  test('mdxParse throws on broken expression', () => {
    expect(() => mdxParse('# Hello\n\n{broken expression')).toThrow()
  })

  test('splitIntoSections works on valid mdast from valid MDX', () => {
    const ast = mdxParse('# Scene duration=3s\n\nHello')
    const result = splitIntoSections(ast)
    expect(result.sections.length).toBe(1)
    expect(result.sections[0]!.heading).toBe('Scene')
  })

  test('parseFrontmatter returns defaults on minimal mdast', () => {
    // Simulate what happens when parse fails and we use a fallback
    const fm = parseFrontmatter({ type: 'root', children: [] } as any)
    expect(fm).toMatchInlineSnapshot(`
      {
        "bpm": 120,
        "fps": 30,
        "height": 1080,
        "scale": 1,
        "width": 1920,
      }
    `)
  })
})

// ---------------------------------------------------------------------------
// Spring physics: springFromDuration and findSpringConfig
// ---------------------------------------------------------------------------

describe('springFromDuration', () => {
  const round = (n: number) => Math.round(n * 1000) / 1000

  test('matches Motion visualDuration formula', () => {
    // Motion: root = 2π / (vd * 1.2), stiffness = root², damping = 2 * zeta * sqrt(stiffness)
    const check = (duration: number, bounce: number) => {
      const result = springFromDuration(duration, bounce)
      const omega = (2 * Math.PI) / (duration * 1.2)
      const stiffness = omega * omega
      // Motion clamps dampingRatio to [0.05, 1], not bounce
      const dampingRatio = Math.max(0.05, Math.min(1, 1 - bounce))
      const damping = 2 * dampingRatio * Math.sqrt(stiffness)
      expect(round(result.stiffness)).toBe(round(stiffness))
      expect(round(result.damping)).toBe(round(damping))
      expect(result.mass).toBe(1)
    }
    check(0.3, 0.3)
    check(0.5, 0)
    check(0.5, 0.5)
    check(0.67, 0.85)
    check(1.0, 1.0)
  })

  test('bounce=0 produces critically damped spring (no overshoot)', () => {
    const config = springFromDuration(0.5, 0)
    // dampingRatio = max(0.05, 1 - 0) = 1 → critically damped
    expect(round(config.damping)).toBe(round(2 * 1 * Math.sqrt(config.stiffness)))
  })

  test('bounce=1 produces minimum damping (max overshoot)', () => {
    const config = springFromDuration(0.5, 1)
    // dampingRatio = max(0.05, 1 - 1) = 0.05 → nearly undamped
    expect(round(config.damping)).toBe(round(2 * 0.05 * Math.sqrt(config.stiffness)))
  })

  test('snapshot key configs', () => {
    expect(springFromDuration(0.3, 0.3)).toMatchInlineSnapshot(`
      {
        "damping": 24.434609527920614,
        "mass": 1,
        "stiffness": 304.61741978670864,
      }
    `)
    expect(springFromDuration(0.5, 0.5)).toMatchInlineSnapshot(`
      {
        "damping": 10.471975511965978,
        "mass": 1,
        "stiffness": 109.6622711232151,
      }
    `)
    expect(springFromDuration(0.67, 0.85)).toMatchInlineSnapshot(`
      {
        "damping": 2.344472129544622,
        "mass": 1,
        "stiffness": 61.07277295790548,
      }
    `)
  })
})

describe('findSpringConfig', () => {
  const round = (n: number) => Math.round(n * 1000) / 1000

  test('produces valid spring config', () => {
    const config = findSpringConfig(0.8, 0.3)
    expect(config.stiffness).toBeGreaterThan(0)
    expect(config.damping).toBeGreaterThan(0)
    expect(config.mass).toBe(1)
  })

  test('higher bounce = lower damping ratio', () => {
    const low = findSpringConfig(0.8, 0.2)
    const high = findSpringConfig(0.8, 0.8)
    // Higher bounce → lower damping ratio → lower absolute damping
    expect(high.damping).toBeLessThan(low.damping)
  })

  test('bounce=0 produces critically damped spring', () => {
    const config = findSpringConfig(0.8, 0)
    // zeta = 1 → damping = 2 * 1 * sqrt(mass * stiffness)
    expect(round(config.damping)).toBe(round(2 * Math.sqrt(config.mass * config.stiffness)))
  })

  test('snapshot key configs', () => {
    expect(findSpringConfig(0.5, 0.3)).toMatchInlineSnapshot(`
      {
        "damping": 27.55101044670115,
        "mass": 1,
        "stiffness": 387.2745799154265,
      }
    `)
    expect(findSpringConfig(0.8, 0.5)).toMatchInlineSnapshot(`
      {
        "damping": 15.896122836620204,
        "mass": 1,
        "stiffness": 252.68672123691837,
      }
    `)
    expect(findSpringConfig(1.0, 0.85)).toMatchInlineSnapshot(`
      {
        "damping": 10.044027575315129,
        "mass": 1,
        "stiffness": 1120.9165548187852,
      }
    `)
  })
})

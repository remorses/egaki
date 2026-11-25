import { describe, expect, test } from 'vitest'
import { blendTiles, chooseGrid, gptUpscaleSize, planTiles } from './upscale-generate.js'

describe('gptUpscaleSize', () => {
  test('picks a size inside every GPT Image limit, close to the requested scale', () => {
    const cases = [
      { width: 992, height: 570 },
      { width: 992, height: 570, scale: 2 },
      { width: 1024, height: 1024 },
      { width: 1080, height: 1920 },
      { width: 3000, height: 1000 },
      { width: 400, height: 300, scale: 1.5 },
      { width: 600, height: 200, scale: 2 },
      { width: 4000, height: 3000, scale: 2 },
      { width: 3100, height: 1000 },
      { width: 800, height: 600, scale: 0.5 },
    ]
    const results = cases.map((input) => {
      const label = `${input.width}x${input.height} x${input.scale ?? 'max'}`
      const size = gptUpscaleSize(input)
      if (size instanceof Error) return `${label}: ${size.message}`
      const pixels = size.width * size.height
      const valid =
        size.width % 16 === 0 &&
        size.height % 16 === 0 &&
        Math.max(size.width, size.height) <= 3840 &&
        pixels >= 655_360 &&
        pixels <= 8_294_400 &&
        Math.max(size.width / size.height, size.height / size.width) <= 3
      const ratioDrift = Math.abs(size.width / size.height / (input.width / input.height) - 1)
      return `${label} -> ${size.width}x${size.height} (${(pixels / 1e6).toFixed(2)} MP, ratio drift ${(ratioDrift * 100).toFixed(2)}%${valid ? '' : ', INVALID'})`
    })
    expect('\n' + results.join('\n')).toMatchInlineSnapshot(`
      "
      992x570 xmax -> 3792x2176 (8.25 MP, ratio drift 0.13%)
      992x570 x2 -> 1984x1136 (2.25 MP, ratio drift 0.35%)
      1024x1024 xmax -> 2880x2880 (8.29 MP, ratio drift 0.00%)
      1080x1920 xmax -> 2160x3840 (8.29 MP, ratio drift 0.00%)
      3000x1000 xmax -> 3840x1280 (4.92 MP, ratio drift 0.00%)
      400x300 x1.5 -> 944x704 (0.66 MP, ratio drift 0.57%)
      600x200 x2 -> 1424x480 (0.68 MP, ratio drift 1.11%)
      4000x3000 x2: GPT Image cannot upscale a 4000x3000 image: its output is limited to 3840px per edge and 8.3 MP.
      3100x1000 xmax: GPT Image supports aspect ratios up to 3:1. The input is 3100x1000.
      800x600 x0.5: Scale must be greater than 1, got 0.5."
    `)
  })

  test('ChatGPT login tiles the image until ~1.6 MP per tile reaches the target', () => {
    const cases = [
      { width: 992, height: 570, targetWidth: 3792 },
      { width: 992, height: 570, targetWidth: 1984 },
      { width: 1024, height: 1024, targetWidth: 2880 },
      { width: 300, height: 200, targetWidth: 3456 },
    ]
    const lines = cases.map((c) => {
      const grid = chooseGrid({ ...c, pixelsPerCall: 1536 * 1024 })
      const tiles = planTiles({ width: c.width, height: c.height, grid })
      const last = tiles[tiles.length - 1]!
      const covers = last.x + last.width === c.width && last.y + last.height === c.height
      return `${c.width}x${c.height} -> ${c.targetWidth}w: grid ${grid}, tile ${tiles[0]!.width}x${tiles[0]!.height}, covers ${covers}`
    })
    expect('\n' + lines.join('\n')).toMatchInlineSnapshot(`
      "
      992x570 -> 3792w: grid 3, tile 382x219, covers true
      992x570 -> 1984w: grid 2, tile 551x317, covers true
      1024x1024 -> 2880w: grid 3, tile 394x394, covers true
      300x200 -> 3456w: grid 1, tile 300x200, covers true"
    `)
  })

  test('blendTiles maps each tile to the reference colors and keeps overlaps seamless', () => {
    const width = 8
    const height = 4
    const reference = new Uint8Array(width * height * 3).map((_, i) => 100 + (i % 3) * 20)
    // two overlapping tiles with a different global color cast each
    const tile = (x: number, cast: number) => ({
      x,
      y: 0,
      width: 5,
      height,
      pixels: new Uint8Array(5 * height * 3).map((_, i) => 100 + (i % 3) * 20 + cast + (i % 7)),
    })
    const out = blendTiles({ width, height, reference, tiles: [tile(0, 40), tile(3, -30)] })
    const maxDiff = Math.max(...out.map((v, i) => Math.abs(v - reference[i]!)))
    expect(maxDiff).toBeLessThanOrEqual(4)

    // near-white areas push matched values past 255; they must clamp, not wrap to dark pixels
    const bright = blendTiles({
      width: 4,
      height: 1,
      reference: new Uint8Array([250, 250, 250, 255, 255, 255, 240, 240, 240, 255, 255, 255]),
      tiles: [{ x: 0, y: 0, width: 4, height: 1, pixels: new Uint8Array([10, 10, 10, 200, 200, 200, 0, 0, 0, 255, 255, 255]) }],
    })
    expect(Math.min(...bright)).toBeGreaterThan(200)
  })
})

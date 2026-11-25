import { describe, expect, test } from 'vitest'
import { gptUpscaleSize } from './upscale-generate.js'

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
})

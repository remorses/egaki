---
name: angled-screen
description: |
  angled-screen turns website or app screenshots into a tilted 3D screen hero image with real
  depth of field, chromatic aberration, fog and film grain. The `@egaki/angled-screen` CLI renders
  one or more images on the same angled plane through the user's Chrome (playwriter) and writes
  png, jpg or webp. Ships Tommy's taste for these images: frame filled, moderate side angle,
  blur on the left or right, OpenSession effect strength, trimmed screenshots, and a hero
  screen with a second page as filler.
  ALWAYS load this skill when the user asks for an angled screen, tilted screenshot, 3D
  screenshot, perspective mockup, hero image or social image from a screenshot, or runs
  `angled-screen`. Also load it before tuning egaki `<AngledScreen>` props.
---

# angled-screen

Read the help first, in full, every session:

```bash
npx @egaki/angled-screen --help
```

Inside the egaki repo run the local build: `node angled-screen/dist/cli.js` (run `pnpm build` in
`angled-screen/` first). It needs Chrome with the playwriter extension.

## Get the screenshot

Take it with playwriter at a fixed 1600x1000 viewport, then crop nothing:

```bash
playwriter session new --tab-group screenshot
playwriter -s <id> -e 'const page = await context.newPage(); await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto("https://ghosthand.dev", { waitUntil: "networkidle" }); await page.screenshot({ path: "/tmp/home.png" }); await page.close()'
```

## Trim first

Screenshots must have **no empty padding**. The CLI crops empty margins (rows and columns in the
top-left corner color) off every image by default and keeps 40 image px around the content.
Raise `--trim-padding` for more breathing room. Only pass `--no-trim` when the margins are part
of the design.

## Preferred settings

Effect strength is the **OpenSession preset**. Use it on every render unless the user asks for
something else:

```bash
--aperture 0.35 --chromatic-aberration 0.5 --fog 0.3 --grain 0.03
```

### Hero screen with a filler page (default)

**Focus on one hero screen.** Pass the hero page plus a second page of the same site. Zoom in so
the hero fills most of the frame; the second page is only filler that shows as a soft, blurred
edge on the far side. Never try to fit both screens in the frame:

```bash
# hero on the left, filler on the right
angled-screen home.png download.png -o hero.jpg --scale 1 --quality 0.9 --background '#000000' \
  --content-width 1.5 --gap 80 --rotate-x 6 --rotate-y 16 --translate-z 0 --translate-x 400 \
  --aperture 0.35 --max-blur 0.06 --chromatic-aberration 0.5 --fog 0.3 --grain 0.03

# hero on the right, filler on the left: swap the order and flip the signs
angled-screen download.png home.png -o hero.jpg ... --rotate-y=-16 --translate-x=-400
```

- Images go left to right. With positive `--rotate-y` the **first** image is near; with negative
  `--rotate-y` the last one is near. The near one is the hero.
- `--translate-x` centers the hero (positive for positive `--rotate-y`). About 400 for two
  trimmed 1600x1000 screenshots at `--content-width 1.5`. Lower it if hero text is cut at the
  frame edge, raise it if the filler takes more than a third of the frame.
- Use `--max-blur 0.06`: the filler is deep, so 0.1 smears it into ghosted copies.
- Use `--background '#000000'` on dark sites, so screen edges stay visible against the slightly
  lighter page background.

### One screen

A single trimmed screenshot is close to square, so its center (often the hero headline) sits
where the blur starts. Prefer the filler layout. If only one page exists, keep the frame filled
with `--content-width 0.62 --translate-z 260` and check that the headline is still sharp.

## Avoid

- **Padding in the screenshot.** Keep trimming on. Empty margins make the screen look small and
  the image empty.
- **Empty borders around the screens.** If the background shows on any side, raise
  `--translate-z` or `--content-width`.
- **Drastic angles.** `--rotate-y` beyond about 20 with one screen, `--perspective` below 900, or
  `--rotate-z` beyond 4 look like a gimmick.
- **Blur only at the bottom.** Pure `--rotate-x` with `--rotate-y 0` puts all blur at the
  bottom edge. Keep `--rotate-y` the larger angle.
- **Copying `--focus` between scenes.** A fixed focus only fits one distance. At another
  `--translate-z` everything goes out of focus and the text turns into colored copies. Leave
  `--focus` at 0 (auto).
- **Heavy blur on the far side.** Large `--max-blur` with steep angles shows ghosted copies of
  the text instead of a smooth blur. Lower `--max-blur` before raising the angle.
- Negative values without `=`: write `--rotate-y=-16`, not `--rotate-y -16`.

## Always check the output

Read every rendered image before showing it. Check that the frame is filled, the hero text is
sharp, the blur is on the left or right, and nothing looks like ghosted copies. Fix the flags and
render again if not. Use `--scale 1` while tuning; use `--scale 2` only for the final export.

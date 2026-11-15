---
name: light-cookie
description: |
  light-cookie lights a flat image like a real object on a wall: a warm window light cookie
  (window, blinds, beam or a custom image), moving leaf or bar shadow cookies, soft spill, dim
  fill, surface relief, 3D tilt and skew, slow camera push, bloom, film grain, vignette and lens
  fringe. The `@egaki/light-cookie` CLI renders through the user's Chrome (playwriter) with
  three.js and writes png, jpg, webp stills or mp4, mov, webm videos (ffmpeg).
  ALWAYS load this skill when the user asks for light cookies, gobo light, window light or leaf
  shadows on an image, "sunlight through a window" or moody cinematic light on art, icons,
  paintings, product shots or posters, or runs `light-cookie`.
---

# light-cookie

Read the help first, in full, every session:

```bash
npx @egaki/light-cookie --help
```

Inside the egaki repo run the local build: `node light-cookie/dist/cli.js` (run `pnpm build` in
`light-cookie/` first). It needs Chrome with the playwriter extension, and ffmpeg for videos.

```bash
# still, 3840x2160 jpg
light-cookie art.jpg -o art-lit.jpg

# 6 second vertical video for TikTok / Reels
light-cookie art.jpg -o art.mp4 --width 1080 --height 1920 --light-size 0.42 --light-drift 0.05 --sway 5
```

## How the scene works

```
spot light ──▶ cookie canvas (light shape × blurred shadow shape) ──▶ projected on the plane
image plane (bump from luminance, tilt, skew) + spill light + ambient fill
  ──▶ bloom ──▶ ACES tone map ──▶ lens fringe, warm grade, vignette, grain
```

- The **light cookie** is the window shape: `window`, `blinds`, `beam`, `none`, or an image
  path (white lets light through).
- The **shadow cookie** is what sits between the window and the wall: `leaves`, `bars`, `none`,
  or an image or video path (dark casts shadow). Shadows only show inside the light, like real ones.
- The light comes from `--light-azimuth` (0 right, 90 top, 135 top left) at
  `--light-elevation`. Low elevation stretches the patch into a long diagonal.

## A second image as the shadow

Pass a photo or video as `--shadow-cookie` to show two images at once: the main image, and
the silhouette of the second one cast over it. A light pass turns it into a silhouette first:
grayscale, then pixels darker than `--shadow-threshold` (0.5) cast shadow. Pick high contrast
shadow media, a dark subject against a bright sky (cross on a hill, a bare tree, a figure).

```bash
light-cookie icon.jpg -o icon.mp4 --width 1080 --height 1350 \
  --light-cookie none --light-size 0.6 --light-azimuth 90 --light-elevation 70 --light-x 0 --light-y 0 \
  --shadow-cookie cross-hill.png --shadow-opacity 0.9 --sway 6
```

- **Keep it upright:** light from the top (`--light-azimuth 90`) and high (`--light-elevation`
  60 to 70). Side or low light rotates and stretches the silhouette.
- **Round soft light** (`--light-cookie none`) shows the whole silhouette; a window cuts it with
  mullions, which also looks real.
- **Place it** with `--shadow-scale`, `--shadow-x`, `--shadow-y` (fractions of the window).
- **Light subject on dark?** Add `--shadow-invert`. `--shadow-threshold 0` keeps the grays.
- Shadow media default to `--shadow-softness 0.005`, crisp enough to read.
- **Videos** work for the main image, `--light-cookie` and `--shadow-cookie`. They loop and are
  seeked per frame. Without `--duration`, the output lasts as long as the longest input video.

## Preferred settings

The defaults reproduce the "icons are windows into heaven" TikTok look: dark warm room, one
crisp window patch with leaf shadows, the light drifting slightly. Start from the defaults and
change one thing at a time.

- **Place the patch on the subject.** Move it with `--light-x` / `--light-y` so the face,
  hands or product sit in the light. The rest stays in soft shadow.
- **Vertical frames need a smaller patch.** The patch scales with the larger frame side, so use
  `--light-size 0.4` to `0.45` at 1080x1920.
- **Tilt gently.** `--rotate-y` 10 to 16 with `--zoom 1.3` to hide the plane edges. Add
  `--skew-x` of 2 to 4 for a hand-held, slightly off feel.
- **Motion stays subtle.** Defaults loop over `--duration`. Raise `--light-drift` to 0.05 and
  `--sway` to 5 for more visible movement; more looks like a moving lamp, not the sun.
- **Seamless loops** need `--push 0`; push is the only motion that does not loop.
- **Relative values:** cookies are not flat black. Leaves and birds sit at three depths: near
  ones are dark and crisp, far ones faint and soft, and single leaves are lighter than
  overlapping clusters. Thin glazing and lead bars block less light than the main mullion.
- **Shadow strength:** `--shadow-opacity` (default 0.7) sets how dark the strongest part is and
  `--shadow-softness` (default 0.016, 0.005 for shadow media) how blurred. Raise `--ambient` to lift the whole room.
- Use `--scale 0.5` while tuning stills, the default 2 only for the final export.
- `--debug-cookie` writes the cookie texture itself, to check the leaves and window shape.

## Avoid

- **Flat lighting.** `--ambient` above about 0.4 kills the contrast; the look comes from the
  dark room around the patch.
- **Patch covering everything.** If the light fills the frame, lower `--light-size` or raise
  `--light-elevation`.
- **Visible plane edges** after tilt or skew. Raise `--zoom`.
- **Huge videos.** Grain makes every frame unique, so files are large. Raise `--crf` (26 to 28)
  for previews and Discord uploads.
- Negative values without `=`: write `--skew-x=-4`, not `--skew-x -4`.

## Always check the output

Read every rendered still before showing it. For videos, make a contact sheet and check that the
light moves and the frame stays filled:

```bash
ffmpeg -loglevel error -i art.mp4 -vf "fps=1,scale=320:-1,tile=6x1" -frames:v 1 sheet.jpg
```

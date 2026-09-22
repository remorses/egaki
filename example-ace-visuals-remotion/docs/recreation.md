---
title: Float in plain Remotion
description: Independent Remotion Studio copy of the Float recreation, without the Egaki runtime.
---

# Float in plain Remotion

**Target:** the first, 43.375-second Float film attached to Ace's post. The composition uses the source's 1920 × 1080 dimensions, 24 fps, and 1041 frames.

**Approach:** copied from `example-ace-visuals`, retaining the editable React/SVG design, measured motion, local assets, and original soundtrack. Remotion 4.0.521 provides Studio and rendering. There is no Egaki, Spiceflow, Vite, or MDX runtime dependency. The source video is a reference only, never a rendered visual layer.

## Timeline

| Frames | Content |
|---|---|
| 0–45 | Large gradient columns |
| 46–155 | Small ribbons and navigation copy |
| 156–214 | Expanding circle, star, and “You just go.” |
| 215–257 | “Money should feel that natural.” |
| 258–329 | Five shaded balls, orbit, and merged orb |
| 330–379 | Green face and independent eye movement |
| 380–537 | Input field, typing, and submit |
| 538–645 | Budget response |
| 646–693 | Reminder input |
| 694–759 | Reminder confirmation |
| 760–823 | “One less thing to remember.” |
| 824–935 | Dashboard and payout notification |
| 936–1004 | “Then most things, taken care of.” |
| 1005–1040 | Float logo |

## Verification

Compare browser captures against decoded reference frames at the same frame index. Check text width, baseline, camera crop, eye movement, and transitions separately. These are visual checks, not mocked unit tests.

**Limits:** compressed footage does not expose the original font file or easing curves. Font choice, blur, orb shading, and the generated meadow need visual comparison. Do not describe this as pixel-identical without evidence.

## Preview and output

Run from this folder:

```sh
pnpm run dev
pnpm run build
pnpm run render
```

**Studio:** port 5209, composition `Float`. Named sequences expose the scenes in the timeline. The render command writes `out/float.mp4` using the native Remotion renderer. The composition remains 1920 × 1080, 24 fps, and 1041 frames.

**Checks:** TypeScript compilation and lint pass. A native Remotion still render was checked at frame 612. All 266 chat character positions match the Egaki preview within 0.001 composition pixels. All three replacement easing curves produce identical values at 1001 sampled points. The earlier full-film export belongs to the original Egaki project; a new full-length Remotion export has not been validated.

**Assets:** the local Inter fonts, GPT Image 2 meadow, soundtrack, ribbon vectors, and reference captures were copied unchanged. Font, image, and audio URLs use Remotion's `staticFile()`. The original measurement script remains under `reference/`; it is not part of the composition bundle.

**Conversion details:** the two easing presets retain their control points through `bezier-easing`. The root sets the 60px font size and 1.5 line height previously inherited from Egaki. `index.ts` registers the root separately from the components so Fast Refresh cannot register it a second time.

**Workspace warning:** Remotion's version scan also finds an unused `@remotion/google-fonts` 4.0.494 from the surrounding Egaki workspace. The new project's declared Remotion packages and renderer use 4.0.521; the composition does not import Google Fonts.

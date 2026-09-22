---
title: Float recreation
description: Reference measurements and editable animation structure.
---

# Float recreation

**Target:** the first, 43.375-second Float film attached to Ace's post. The composition uses the source's 1920 × 1080 dimensions, 24 fps, and 1041 frames.

**Approach:** rebuild the text, ribbons, mascot, chat, and dashboard as editable SVG and React elements. Use the source soundtrack. Generate a clean meadow background from the dashboard reference with GPT Image. The source video is a reference only, never a rendered visual layer.

## Timeline

| Frames | Content |
|---|---|
| 0–45 | Large gradient columns |
| 46–155 | Small ribbons and navigation copy |
| 156–214 | Expanding circle, star, and “You just go.” |
| 215–257 | “Money should feel that natural.” |
| 258–329 | Five shaded balls, orbit, and merged orb |
| 330–379 | Green face and independent eye movement |
| 380–522 | Input field, typing, and submit |
| 523–642 | Budget response |
| 643–693 | Reminder input |
| 694–759 | Reminder confirmation |
| 760–823 | “One less thing to remember.” |
| 824–935 | Dashboard and payout notification |
| 936–999 | “Then most things, taken care of.” |
| 1000–1040 | Float logo |

## Verification

Compare browser captures against decoded reference frames at the same frame index. Check text width, baseline, camera crop, eye movement, and transitions separately. These are visual checks, not mocked unit tests.

**Limits:** compressed footage does not expose the original font file or easing curves. Font choice, blur, orb shading, and the generated meadow need visual comparison. Do not describe this as pixel-identical without evidence.

## Preview and output

Run from this folder:

```sh
pnpm run dev
```

**Output:** `float-recreation.mp4`, H.264 with AAC audio, 1920 × 1080, 24 fps, 1041 video frames. The video timeline is 43.375 seconds; AAC padding extends the container to 43.456 seconds.

**Checks:** captured 13 representative composition frames and inspected the full exported filmstrip and video. Lint reports zero errors. A direct TypeScript compilation reaches pre-existing errors in Egaki's `media-components.tsx` and virtual-module declarations; no errors were reported in the recreation components.

**Assets:** local Inter Light and Regular fonts; GPT Image 2 meadow reconstruction; original soundtrack; measured editable ribbon vectors in `ribbon-motion.json`. `reference/trace-ribbons.server.ts` regenerates the ribbon measurements. Its server suffix prevents Node-only measurement code from entering Egaki's client module glob.

**Dependency setup:** `pnpm dedupe spiceflow` was needed to remove incompatible peer-dependency instances that prevented the preview from starting. This updates the workspace lockfile.

---
'egaki': minor
'@egaki/midjourney': minor
---

Add `egaki upscale <image>`. It makes the same image larger with more detail.

- **GPT Image** (default `gpt-image-2.6-sunburst`, any `gpt-image-2*` model) re-renders the input at a larger size with a strict "keep everything identical" prompt. The default size is the largest for the aspect ratio, up to 3840px per edge and 8.3 MP; `--scale 2` asks for 2x. Colors are matched back to the input. With `OPENAI_API_KEY` this is one call. With ChatGPT login each call returns only about 1.6 MP, so the image is split into overlapping tiles (9 calls for a 4K landscape) that are upscaled in parallel and blended.
- **Midjourney** (`-m midjourney` for subtle, `-m midjourney-creative`) upscales 2x through your logged-in midjourney.com tab in Chrome, using the Playwriter extension. `--prompt` sets the job prompt, which guides creative upscales.

```bash
egaki upscale photo.jpg
egaki upscale painting.jpg -m midjourney -o painting-2x.jpg
```

`@egaki/midjourney` adds `upscaleImage()`, which upscales any image, not only Midjourney generations. It registers the image as an editor upload job, then runs the upscaler. It also adds `downloadImage()` to download CDN files through the browser, the `midjourneyFrameSize()` helper, and the v8 upscale types.

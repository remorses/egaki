## @egaki/midjourney

Reverse-engineered Midjourney SDK using Playwriter browser automation.
Controls midjourney.com through the user's authenticated Chrome session.
No API keys needed; all requests run inside `page.evaluate()` with session cookies.

### Requirements

- Chrome with the **Playwriter extension** installed and enabled
- Playwriter relay server running (`playwriter serve` or auto-started)
- User **logged into midjourney.com** in Chrome

### API endpoints (reverse-engineered)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/submit-jobs` | POST | Submit any generation (image, video, upscale, pan) |
| `/api/job-status` | POST | Get status of jobs by ID array |
| `/api/storage-upload-file` | POST | Upload images (multipart form) |
| `/api/storage` | GET | List user's uploaded files |
| `/api/explore-vector-search` | GET | Search the explore feed |
| `/api/user-account` | GET | Get logged-in user info (used to resolve user ID) |
| `/api/websocket-token` | GET | JWT for `wss://ws.midjourney.com/ws` live updates |

All endpoints require `credentials: 'include'` and `x-csrf-protection: '1'` header.

### CDN URL patterns

```
Images (full-res):  https://cdn.midjourney.com/{jobId}/0_{gridIndex}.jpeg
Images (preview):   https://cdn.midjourney.com/{jobId}/0_{gridIndex}_{width}_N.webp
                    Widths: 384 (~17KB), 640, 1024 (~76KB), 2048 (~500KB)

Videos:             https://cdn.midjourney.com/video/{jobId}/{gridIndex}.mp4
Video thumbnails:   https://cdn.midjourney.com/video/{jobId}/{gridIndex}_{width}_N.webp?frame=last

Uploaded files:     https://cdn.midjourney.com/u/{userId}/{hash}.{ext}
Short URLs:         https://s.mj.run/{shortId}  (redirect to CDN)
```

The CDN (`cdn.midjourney.com`) is behind **Cloudflare bot protection**. Direct
`fetch()` or `curl` from Node.js gets a 403. Use URLs in `<img>`/`<Video>` tags
(the browser solves the challenge), or download via `page.evaluate()` inside the
browser context.

### Image URLs in prompts

Image prompt, style ref, and character ref URLs do **not** need to be on
Midjourney's CDN. **Any publicly accessible URL works.** Midjourney's server
fetches the URL server-side. Tested working sources:

- Google CDN (`lh3.googleusercontent.com`)
- Picsum (`picsum.photos`)
- S3, Cloudflare R2, any public bucket
- `uploadFile()` short URLs (`https://s.mj.run/...`)

URLs that **do not work**: anything behind bot protection or auth that returns
403/401 to a server-side fetch (e.g. Wikipedia `upload.wikimedia.org`).
The API returns a clear error: `{"type":"invalid_link","message":"Could not fetch image. Received status code 403"}`.

### Prompt flags reference

These flags are appended to the prompt string by the SDK methods:

| Flag | What it does | Example |
|---|---|---|
| `--ar W:H` | Aspect ratio | `--ar 16:9` |
| `--v N` | Model version | `--v 7` |
| `--s N` | Stylization (0-1000, default 100) | `--s 250` |
| `--w N` | Weirdness (0-3000, default 0) | `--w 500` |
| `--seed N` | Reproducible seed | `--seed 42` |
| `--chaos N` | Grid variation (0-100) | `--chaos 50` |
| `--sref URL` | Style reference image | `--sref https://...` |
| `--oref URL` | Character reference image | `--oref https://...` |
| `--video 1` | Enable video generation | (auto-added by `generateVideo`) |
| `--end loop` | Seamless video loop | (added when `loop: true`) |

**`--sref` (style reference):** Copies the visual style (colors, texture,
lighting, mood) from the provided image. Multiple URLs blend together.

**`--oref` (character reference):** Maintains consistent character appearance
across different generations. Provide an image of the character. The "o"
historically stood for "object reference" but it's used for character
consistency. In the web UI, users pick character refs from their image library
sidebar.

### Aspect ratio values

Midjourney accepts any integer ratio. Common values:

| Ratio | Use case |
|---|---|
| `1:1` | Square, Instagram posts |
| `16:9` | Widescreen, YouTube thumbnails |
| `9:16` | Vertical, phone wallpapers, TikTok |
| `4:3` | Classic photo, presentations |
| `3:2` | Standard photo print |
| `2:3` | Portrait photo |
| `4:5` | Instagram portrait |
| `5:4` | Landscape photo |
| `21:9` | Ultrawide, cinematic |

### Submit-jobs request shapes

The `/api/submit-jobs` endpoint uses a `t` field to dispatch to different
generation types. All requests share the same base shape:

```ts
{
  f: { mode: 'fast' | 'relax' | 'turbo', private: boolean },
  channelId: 'singleplayer_{userId}',
  metadata: { ... },
  t: 'imagine' | 'video' | 'upscale' | 'pan',
  // ... type-specific fields
}
```

**`t: "imagine"`** (image generation):
- `prompt` contains the full prompt string with all flags.
- Image prompt URLs are prepended to the prompt text.
- `metadata.imagePrompts`, `metadata.imageReferences`, `metadata.characterReferences`
  are counts (informational, not sure if enforced).

**`t: "video"`** (video generation):
- `videoType`: `"vid_1.1_i2v_start_end_480"` (current default).
- `newPrompt`: the prompt with starting frame URL prepended.
- `animateMode`: `"manual"` (user-provided frames) or `"auto"` (MJ decides).
- `parentJob`: null for fresh generations.

**`t: "upscale"`**:
- `type`: `"v7_2x_subtle"` or `"v7_2x_creative"`.
- `id`: parent job ID, `index`: grid index (0-3).

Upscale only accepts Midjourney jobs. To upscale any image, `upscaleImage()`
first registers it as an editor upload job (below), then upscales grid index 0.

**`t: "uploaded"`** (editor upload, used by `upscaleImage()`):
- `imageUrl`: short URL of the image already drawn at `frame` size (the site
  renders the editor canvas, then uploads it).
- `frame`: `{ width, height }` from `midjourneyFrameSize()`. Any other size
  fails with "Invalid frame dimensions given for aspect ratio. Should be WxH".
- `image`: `{ x: 0, y: 0, width, height }` of the frame.
- `prompt`: must not be empty, and must carry `--ar` matching the frame
  (`frameAspectRatio()`) plus `--v 7`.
- With nothing erased, the job (`job_type: v7_1024_outpaint`) completes in
  seconds and all 4 grid images are the input unchanged.

**`t: "pan"`** (outpaint):
- `direction`: 0=up, 1=right, 2=down, 3=left.
- `fraction`: how far to extend (0-1, default 0.5).
- `stitch`: smooth blending (default true).
- `id`: parent job ID, `index`: grid index (0-3).

### Job status lifecycle

Jobs go through these statuses (from `current_status` field):

`queued` -> `starting` -> `running` -> `completed`

Failed jobs show `failed`. User-cancelled jobs show `cancelled`.

The `waitForJob()` method polls `getJobStatus()` every 3 seconds and resolves
when the status reaches `completed`, `failed`, or `cancelled`.

### Grid system

Every generation produces a **4-image grid** (`batch_size: 4`). Each image
in the grid is accessed by `gridIndex` (0-3). The grid index is the second
number in CDN URLs: `0_0.jpeg`, `0_1.jpeg`, `0_2.jpeg`, `0_3.jpeg`.

Upscale produces a single image (`batch_size: 1`), always at grid index 0.

Video generation also produces 4 variants, each a separate MP4.

### User ID resolution

The SDK needs the user's UUID for the `channelId` field (`singleplayer_{userId}`).
It resolves this by:

1. Checking the `__user` cookie on midjourney.com
2. Scanning localStorage for user data
3. Calling `GET /api/user-account` and reading `user.mjId`

The resolved ID is cached for the session lifetime.

### Real-time updates (not yet implemented)

Midjourney uses WebSocket at `wss://ws.midjourney.com/ws` for live job progress.
The token is obtained from `GET /api/websocket-token` (returns a JWT). The
current SDK uses HTTP polling via `getJobStatus()` instead. WebSocket support
could be added for real-time progress callbacks without polling overhead.

### Key files

| File | Purpose |
|---|---|
| `src/midjourney.ts` | `Midjourney` class with all SDK methods |
| `src/types.ts` | Type definitions, CDN URL helpers, option interfaces |
| `src/index.ts` | Public exports |
| `src/cache.ts` | Filesystem cache for search results |
| `src/explore-image.server.tsx` | RSC server component for egaki video use |
| `src/explore-image-client.tsx` | Client component for rendering search results |
| `src/test-all-methods.ts` | Integration test script for all methods |

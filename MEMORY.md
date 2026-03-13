# Session Memory

## 2026-03-12

- Public Egaki gateway base should be `/v3/ai` for transparent proxying with
  current `@ai-sdk/gateway` behavior.
- For gateway image/video model requests, model ID is sent in `ai-model-id`
  (not only `ai-image-model-id` / `ai-video-model-id`). Keep legacy headers as fallback.
- Video requests can be classified reliably by endpoint path (`/video-model`) in addition
  to legacy headers.
- AI Gateway may reject video generation with `402 insufficient_funds` and a minimum
  balance requirement (observed: minimum $10) even when auth and routing are correct.
- For gateway request parsing, the source of truth is
  `opensrc/repos/github.com/vercel/ai/packages/gateway/src/gateway-*-model.ts`.
  Video body currently sends only: `prompt`, `n`, `aspectRatio`, `resolution`,
  `duration`, `fps`, `seed`, `providerOptions`, `image`.

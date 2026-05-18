---
title: ChatGPT Codex Image Backend
description: Exact Codex source URLs and request shape used to mirror ChatGPT image generation in egaki.
---

# ChatGPT Codex image backend

When ChatGPT OAuth image generation stops matching Codex behavior, re-read the
Codex source instead of guessing the payload.

## Source URLs

- Tool spec: https://github.com/openai/codex/blob/main/codex-rs/tools/src/tool_spec.rs
- Response/content item types: https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs
- Response test helpers: https://github.com/openai/codex/blob/main/codex-rs/core/tests/common/responses.rs

## What egaki mirrors

- OAuth uses the Codex client flow and stores ChatGPT `access` + `refresh` + `accountId`.
- ChatGPT image requests do **not** go to `api.openai.com/v1/images`.
- Direct ChatGPT OAuth goes to `https://chatgpt.com/backend-api/codex/responses` with:
  - `Authorization: Bearer <chatgpt access token>`
  - `ChatGPT-Account-ID: <workspace/account id>`
- OpenAI-compatible proxies such as CLIProxyAPI can be used instead by routing to
  their `/v1/responses` endpoint with a standard Bearer API key.
- The built-in tool is still just:

```json
{ "type": "image_generation", "output_format": "png" }
```

- Image-to-image works by including user message content items like:

```json
{ "type": "input_image", "image_url": "data:image/png;base64,..." }
```

## Backend behavior verified in egaki

- Works: text-to-image, image-to-image, multiple input images, `size`
- Does not work: `seed`, `n`, `aspect_ratio`, explicit `mask` tool args
- Final image comes from `response.output_item.done.item.result`
- Progressive previews come from `response.image_generation_call.partial_image`

## Practical rule

If Codex changes, first compare these things:

1. target host/path
2. auth headers
3. user `input` content shape
4. `tools` payload
5. SSE event types for the final image

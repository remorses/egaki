---
title: Gateway Model Pricing Sources
description: Source links and notes for image model prices not exposed by Vercel AI Gateway /v1/models.
---

# Gateway model pricing sources

Vercel AI Gateway `GET /v1/models` currently returns incomplete pricing for many
image models (often empty or zero values), so Egaki keeps manual per-image prices
in `src/model-catalog.ts` for billing and usage cap tracking.

## API endpoint used for discovery

- https://ai-gateway.vercel.sh/v1/models

## Vercel AI Gateway docs

- https://vercel.com/ai-gateway/models
- https://vercel.com/docs/ai-gateway

## Provider references used for manual pricing

- Black Forest Labs pricing: https://www.blackforestlabs.ai/pricing
- Recraft pricing: https://www.recraft.ai/pricing
- xAI pricing: https://x.ai/pricing

## Notes

- Check `https://ai-gateway.vercel.sh/v1/models` periodically for new model IDs.
- Add missing image-capable models to `src/model-catalog.ts`.
- Price values for image models should be verified against provider pricing pages
  and then updated manually in `src/model-catalog.ts`.

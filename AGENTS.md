## Conventions

**CLI framework:** Built with [goke](https://github.com/remorses/goke), a type-safe CLI
framework for TypeScript. Commands, options, and help text are defined in `src/cli.ts`
using goke's API. Run `egaki --help` to see everything.

**Error handling:** This project uses [errore](https://errore.org) — Go-style error
handling for TypeScript. Functions return `Error | T` unions instead of throwing.
Check errors with `instanceof Error` and early-return them.

**Do NOT wrap goke command action handlers in try/catch.** Goke already catches
errors thrown inside `.action()` callbacks and prints them. Wrapping in try/catch
is redundant and breaks goke's built-in error formatting. Use errore's return-based
error handling inside handlers instead:

```ts
cli.command("example", "Do something").action(async (options) => {
  // errore style: return errors as values, handle with instanceof
  const result = await doThing();
  if (result instanceof Error) {
    console.error(result.message);
    process.exit(1);
  }
  // happy path continues at root level
});
```

## Vercel AI SDK image generation docs

Before making changes to image generation logic, read the relevant AI SDK docs.
Append `.md` to any URL below to get clean markdown as plain text.

- https://ai-sdk.dev/docs/ai-sdk-core/image-generation
- https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-image
- https://ai-sdk.dev/docs/reference/ai-sdk-core/wrap-image-model
- https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-no-image-generated-error
- https://ai-sdk.dev/docs/troubleshooting/high-memory-usage-with-images
- https://ai-sdk.dev/cookbook/guides/google-gemini-image-generation

For example: `curl https://ai-sdk.dev/docs/ai-sdk-core/image-generation.md`

To find more relevant docs, fetch the sitemap and grep for keywords:

```bash
curl -s https://ai-sdk.dev/sitemap.xml | grep -oP '(?<=<loc>)[^<]+' | grep image
```

## Egaki Gateway (Cloudflare Worker)

The `gateway/` directory contains a Cloudflare Worker that proxies AI requests
through the Vercel AI Gateway. It handles Stripe subscriptions, API key validation,
and dollar-based usage tracking.

**Model costs are derived from the catalog.** `gateway/src/plans.ts` imports
`CATALOG` from `src/model-catalog.ts` directly. Wrangler's bundler resolves the
cross-directory import at build time, so there's no duplication. When you add or
update models in the catalog, the gateway picks up the costs automatically.

**Deploy:** `cd gateway && pnpm run deploy`

**Secrets (managed via Doppler):** `AI_GATEWAY_API_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`

## Vercel AI Gateway models endpoint

The AI Gateway exposes a public models catalog at:

```
GET https://ai-gateway.vercel.sh/v1/models
```

No auth required. Returns JSON with all available models, capabilities, and pricing.
Use this to discover new models and update `src/model-catalog.ts`.

When updating model support in the CLI, always:

1. Check `https://ai-gateway.vercel.sh/v1/models` for new model IDs.
2. Add missing image-capable models to `src/model-catalog.ts`.
3. If `/v1/models` lacks per-image pricing, source price from provider docs and
   record it manually in the catalog.

**Current limitation (as of Feb 2026):** Pure image models (`type: "image"`) return
`"input": "0", "output": "0"` — the actual per-image cost is NOT in the API response.
Only per-token pricing for language models is accurate. Per-image costs must be sourced
manually from provider pricing pages for now. Hopefully this will be fixed eventually.

```bash
# Fetch all models (no truncation)
curl -s https://ai-gateway.vercel.sh/v1/models | jq '.'

# List all image-capable model IDs with their types
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '.data[] | select(.tags | index("image-generation")) | "\(.id) (\(.type))"'

# List all video-capable model IDs with their type and duration pricing tiers count
curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '.data[] | select(.type == "video") | "\(.id) (\(.type)) tiers=\((.pricing.video_duration_pricing // []) | length)"'

# Inspect endpoint-level provider details for one model (pricing, params, capabilities)
curl -s https://ai-gateway.vercel.sh/v1/models/google/veo-3.1-generate-001/endpoints | jq '.'
```

## AI Gateway wire format source of truth

When parsing AI Gateway request payloads in `gateway/src/worker.ts`, do not guess
provider-specific fields. Use the `@ai-sdk/gateway` source code as the source of truth
for what gets sent over the wire.

Fetch source once if missing:

```bash
npx opensrc @ai-sdk/gateway
```

Then read these files in `opensrc/repos/github.com/vercel/ai/packages/gateway/src/`:

- `gateway-video-model.ts` — exact request body for `/video-model`
- `gateway-image-model.ts` — exact request body for `/image-model`
- `gateway-language-model.ts` — exact request body/headers for `/language-model`
- `gateway-video-model.test.ts` — request/response examples, including optional fields

For video specifically, the current body fields are:
`prompt`, `n`, `aspectRatio`, `resolution`, `duration`, `fps`, `seed`, `providerOptions`, `image`.
`providerOptions` is passed through as-is (opaque), so billing logic must not depend on
assumed provider-specific keys unless those keys are explicitly guaranteed by upstream docs.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

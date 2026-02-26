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

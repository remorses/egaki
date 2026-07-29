// Custom Spiceflow entry for egaki docs.
// Mounts holocron and initializes server-side Strada observability before
// Spiceflow creates its first request span.
import './globals.css'
import { env } from 'cloudflare:workers'
import { Spiceflow } from 'spiceflow'
import { app as holocronApp } from '@holocron.so/vite/app'
import { SpanStatusCode, captureException, getLogger, initStrada, trace } from '@strada.sh/sdk'

initStrada({
  projectId: env.STRADA_PROJECT_ID,
  token: env.STRADA_TOKEN,
  service: 'egaki-docs',
  environment: env.ENVIRONMENT,
  // In the Vite RSC dev server import.meta.hot is truthy, which keeps the OTel
  // APIs working locally without shipping dev noise to ingest.
  enabled: !import.meta.hot,
})

const logger = getLogger('docs')

export const app = new Spiceflow({ tracer: trace.getTracer('egaki-docs') })
  .use(holocronApp)
  .onError(({ error, path, span }) => {
    captureException(error, { tags: { path } })
    span.recordException(error instanceof Error ? error : new Error(String(error)))
    span.setStatus({ code: SpanStatusCode.ERROR })
    logger.error({
      message: 'request failed',
      path,
      error: error instanceof Error ? error.message : String(error),
    })
  })

export default {
  async fetch(request: Request): Promise<Response> {
    return app.handle(request)
  },
}

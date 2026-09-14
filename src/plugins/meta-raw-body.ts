import type { FastifyInstance } from 'fastify'

export const META_WEBHOOK_BODY_LIMIT = 5 * 1024 * 1024

declare module 'fastify' {
  interface FastifyRequest {
    instagramRawBody: Buffer | null
  }
}

/** Shared byte-preserving JSON parser for signed Meta webhook products. */
export function installMetaRawBodyParser(
  app: FastifyInstance,
  capture: (request: Parameters<Parameters<FastifyInstance['addContentTypeParser']>[2]>[0], rawBody: Buffer) => void
) {
  const parseJson = app.getDefaultJsonParser('error', 'error')
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: META_WEBHOOK_BODY_LIMIT },
    (request, body, done) => {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body)
      capture(request, rawBody)
      parseJson(request, rawBody.toString('utf8'), done)
    }
  )
}

/** Installs raw JSON capture inside the current Instagram route scope. */
export function installInstagramRawBodyParser(app: FastifyInstance) {
  app.decorateRequest('instagramRawBody', null)
  installMetaRawBodyParser(app, (request, rawBody) => {
    request.instagramRawBody = rawBody
  })
}

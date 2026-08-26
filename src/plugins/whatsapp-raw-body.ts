import type { FastifyInstance } from 'fastify'

export const WHATSAPP_BODY_LIMIT = 5 * 1024 * 1024

declare module 'fastify' {
  interface FastifyRequest {
    whatsappRawBody: Buffer | null
  }
}

export function installWhatsAppRawBodyParser(app: FastifyInstance) {
  const parseJson = app.getDefaultJsonParser('error', 'error')

  app.decorateRequest('whatsappRawBody', null)
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: WHATSAPP_BODY_LIMIT },
    (request, body, done) => {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body)
      request.whatsappRawBody = rawBody
      parseJson(request, rawBody.toString('utf8'), done)
    }
  )
}

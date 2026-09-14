import type { FastifyInstance } from 'fastify'
import { installMetaRawBodyParser, META_WEBHOOK_BODY_LIMIT } from './meta-raw-body.js'

export const WHATSAPP_BODY_LIMIT = META_WEBHOOK_BODY_LIMIT

declare module 'fastify' {
  interface FastifyRequest {
    whatsappRawBody: Buffer | null
  }
}

export function installWhatsAppRawBodyParser(app: FastifyInstance) {
  app.decorateRequest('whatsappRawBody', null)
  installMetaRawBodyParser(app, (request, rawBody) => {
    request.whatsappRawBody = rawBody
  })
}

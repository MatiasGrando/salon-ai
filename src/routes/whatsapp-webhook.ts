import type { FastifyInstance } from 'fastify'
import { WhatsAppWebhookService } from '../services/whatsapp-webhook-service.js'

const service = new WhatsAppWebhookService()

export async function whatsappWebhookRoutes(app: FastifyInstance) {
  app.get('/webhooks/whatsapp', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>

    const result = service.verifyWebhook({
      mode: query['hub.mode'],
      token: query['hub.verify_token'],
      challenge: query['hub.challenge']
    })

    if (!result.verified) {
      return reply.status(403).send({
        message: 'Token de verificacion invalido'
      })
    }

    return reply.status(200).send(result.challenge)
  })

  app.post('/webhooks/whatsapp', async (request) => {
    return service.handleWebhook(request.body as Parameters<WhatsAppWebhookService['handleWebhook']>[0])
  })
}

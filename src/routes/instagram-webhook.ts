import type { FastifyInstance } from 'fastify'
import { InstagramWebhookService } from '../services/instagram-webhook-service.js'

const service = new InstagramWebhookService()

export async function instagramWebhookRoutes(app: FastifyInstance) {
  app.get('/webhooks/instagram', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>
    const result = service.verifyWebhook({
      mode: query['hub.mode'],
      token: query['hub.verify_token'],
      challenge: query['hub.challenge']
    })
    if (!result.verified) return reply.status(403).send({ message: 'Token de verificacion invalido' })
    return reply.status(200).send(result.challenge)
  })

  app.post('/webhooks/instagram', async (request) => {
    return service.handleWebhook(request.body as Parameters<InstagramWebhookService['handleWebhook']>[0])
  })
}

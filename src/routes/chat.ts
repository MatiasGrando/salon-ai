import type { FastifyInstance } from 'fastify'
import { ConversationService } from '../services/conversation-service.js'

const service = new ConversationService()

export async function chatRoutes(app: FastifyInstance) {

  app.post('/chat', async (request) => {

    const body = request.body as {
      phone: string
      message: string
      businessId?: string
    }

    return service.handleMessage({
      phone: body.phone,
      message: body.message,
      ...(body.businessId ? { businessId: body.businessId } : {})
    })
  })

}

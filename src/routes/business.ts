import type { FastifyInstance } from 'fastify'
import { BusinessService } from '../services/business-service.js'

const service = new BusinessService()

export async function businessRoutes(app: FastifyInstance) {

  app.post('/businesses', async (request) => {

    const body = request.body as {
      name: string
    }

    return service.create(body.name)
  })

  app.get('/businesses', async () => {
    return service.findAll()
  })

}

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

  app.patch('/businesses/:id', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      name?: string
      logoUrl?: string | null
    }
    const name = body.name?.trim()
    const logoUrl = normalizeLogoUrl(body.logoUrl)

    if (body.name !== undefined && !name) {
      return reply.status(400).send({
        message: 'El nombre del local es requerido'
      })
    }

    if (body.logoUrl !== undefined && logoUrl === undefined) {
      return reply.status(400).send({
        message: 'El logo debe ser una imagen valida de hasta 2 MB'
      })
    }

    if (name === undefined && logoUrl === undefined) {
      return reply.status(400).send({
        message: 'No hay cambios para guardar'
      })
    }

    const business = await service.update(params.id, {
      ...(name !== undefined ? { name } : {}),
      ...(logoUrl !== undefined ? { logoUrl } : {})
    })

    if (!business) {
      return reply.status(404).send({
        message: 'No encontre ese local'
      })
    }

    return business
  })

}

function normalizeLogoUrl(logoUrl?: string | null) {
  if (logoUrl === undefined) {
    return undefined
  }

  if (logoUrl === null || logoUrl.trim() === '') {
    return null
  }

  const normalized = logoUrl.trim()
  const isImageDataUrl = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(normalized)

  return isImageDataUrl && normalized.length <= 2_800_000 ? normalized : undefined
}

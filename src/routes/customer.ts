import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'

export async function customerRoutes(app: FastifyInstance) {

  app.post('/customers', async (request) => {

    const body = request.body as {
      name: string
      phone: string
    }

    return prisma.customer.create({
      data: {
        name: body.name,
        phone: body.phone
      }
    })
  })

  app.get('/customers', async () => {
    return prisma.customer.findMany()
  })

  app.patch('/customers/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { name?: string }
    const name = body.name?.trim()

    if (!name) {
      return reply.status(400).send({ message: 'El nombre del cliente es requerido' })
    }

    const customer = await prisma.customer.findUnique({ where: { id: params.id } })
    if (!customer) {
      return reply.status(404).send({ message: 'No encontre ese cliente' })
    }

    return prisma.customer.update({
      where: { id: params.id },
      data: { name }
    })
  })

  app.get('/customers/:id/notes', async (request) => {
    const params = request.params as { id: string }
    return prisma.customerNote.findMany({
      where: { customerId: params.id },
      orderBy: { createdAt: 'desc' }
    })
  })

  app.post('/customers/:id/notes', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { body?: string }
    const noteBody = body.body?.trim()

    if (!noteBody || noteBody.length > 1000) {
      return reply.status(400).send({ message: 'La nota debe tener entre 1 y 1000 caracteres' })
    }

    const customer = await prisma.customer.findUnique({ where: { id: params.id } })
    if (!customer) {
      return reply.status(404).send({ message: 'No encontre ese cliente' })
    }

    return prisma.customerNote.create({
      data: {
        customerId: params.id,
        body: noteBody
      }
    })
  })

}

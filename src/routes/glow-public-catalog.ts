import type { FastifyInstance } from 'fastify'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { formatCustomerDuration } from '../services/service-duration.js'
import { isBusinessAccountOperational } from '../services/business-account-access.js'

// This is a public brand facade, not a cross-account booking or authorization model.
const branches = new Map([
  ['urquiza', { name: 'Villa Urquiza', customerCode: 'WX-QG5FQA' }],
  ['canitas', { name: 'Las Cañitas', customerCode: 'WX-NPP7HE' }]
])

const catalogSelect = {
  name: true,
  slug: true,
  publicAddress: true,
  publicAddressArea: true,
  accountStatus: true,
  landingEnabled: true,
  services: {
    where: { isActive: true, isBookable: true },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: {
      id: true, name: true, description: true, imageUrl: true,
      duration: true, customerDurationMin: true, customerDurationMax: true,
      price: true, priceMode: true, category: true
    }
  },
  professionals: {
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, description: true, avatarUrl: true }
  }
} satisfies Prisma.BusinessSelect

type Options = { database?: Pick<PrismaClient, 'business'> }

export async function glowPublicCatalogRoutes(app: FastifyInstance, options: Options = {}) {
  // Lazy default keeps focused contract tests independent of environment/DB startup.
  const database = options.database ?? (await import('../config/prisma.js')).prisma
  app.get<{ Params: { branch: string }; Querystring: Record<string, unknown> }>(
    '/public/glow/branches/:branch/catalog',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const branch = branches.get(request.params.branch)
      if (!branch) return reply.status(404).send({ message: 'Sede no disponible' })
      // No caller-supplied business ids, codes, or alternate tenant selectors.
      if (Object.keys(request.query).length > 0) {
        return reply.status(400).send({ message: 'Consulta no valida' })
      }
      try {
        const business = await database.business.findUnique({
          where: { customerCode: branch.customerCode },
          select: catalogSelect
        })
        if (!business || !business.landingEnabled || !isBusinessAccountOperational(business.accountStatus)) {
          return reply.status(404).send({ message: 'Sede no disponible' })
        }
        return {
          branch: {
            id: request.params.branch, name: branch.name, businessName: business.name,
            address: [business.publicAddress, business.publicAddressArea].filter(Boolean).join(', ') || null,
            bookingUrl: business.slug && /^[a-z0-9-]+$/.test(business.slug)
              ? `https://weex.com.ar/${business.slug}/reservar?template=salon-white` : null
          },
          services: business.services.map(service => ({
            id: service.id, name: service.name, description: service.description, imageUrl: service.imageUrl,
            duration: service.duration, displayDuration: formatCustomerDuration(service),
            price: service.price, priceMode: service.priceMode, category: service.category
          })),
          professionals: business.professionals.map(professional => ({
            id: professional.id, name: professional.name,
            description: professional.description, avatarUrl: professional.avatarUrl
          }))
        }
      } catch (error) {
        request.log.error({ err: error }, 'Glow catalog lookup failed')
        return reply.status(503).send({ message: 'No pudimos cargar esta sede. Intenta nuevamente.' })
      }
    }
  )
}

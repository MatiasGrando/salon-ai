import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../config/prisma.js'
import { buildPublicWorkshopVehicle } from '../services/public-workshop-history.js'
import { normalizeWorkshopPlate, WorkshopVehicleValidationError } from '../services/workshop-vehicle-domain.js'

const WINDOW_MS = 60_000
const REQUESTS_PER_WINDOW = 60
const requestWindows = new Map<string, { count: number; expiresAt: number }>()

function requestIp(request: FastifyRequest) {
  const forwarded = request.headers['x-forwarded-for']
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || request.ip
}

function allowPublicLookup(request: FastifyRequest) {
  const now = Date.now()
  const key = requestIp(request)
  const current = requestWindows.get(key)
  if (!current || current.expiresAt <= now) {
    requestWindows.set(key, { count: 1, expiresAt: now + WINDOW_MS })
    return true
  }
  current.count += 1
  if (requestWindows.size > 5_000) {
    for (const [ip, window] of requestWindows) if (window.expiresAt <= now) requestWindows.delete(ip)
  }
  return current.count <= REQUESTS_PER_WINDOW
}

export async function publicWorkshopRoutes(app: FastifyInstance) {
  app.get('/public/workshops/:customerCode/vehicles/:plate', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Cache-Control', 'private, no-store, max-age=0')
    if (!allowPublicLookup(request)) {
      return reply.status(429).send({ message: 'Demasiadas consultas. Esperá un momento y volvé a intentar.' })
    }

    const params = request.params as { customerCode?: string; plate?: string }
    const query = request.query as { limit?: string; offset?: string }
    const customerCode = String(params.customerCode || '').trim().toUpperCase()
    let plate: string
    try {
      plate = normalizeWorkshopPlate(params.plate)
    } catch (error) {
      if (error instanceof WorkshopVehicleValidationError) {
        return reply.status(400).send({ message: 'Ingresá una patente argentina completa.' })
      }
      throw error
    }
    const limit = Math.min(10, Math.max(1, Number(query.limit) || 10))
    const offset = Math.max(0, Number(query.offset) || 0)

    const business = await prisma.business.findFirst({
      where: { customerCode, businessType: 'WORKSHOP' },
      select: { id: true }
    })
    if (!business) return reply.status(404).send({ message: 'No encontramos registros para esa patente.' })

    const vehicle = await prisma.workshopVehicle.findFirst({
      where: { businessId: business.id, plate },
      select: {
        id: true,
        plate: true,
        model: true,
        year: true,
        engine: true,
        currentMileage: true,
        usage: true,
        brand: { select: { name: true } }
      }
    })
    if (!vehicle) return reply.status(404).send({ message: 'No encontramos registros para esa patente.' })

    const [latestJob, page] = await Promise.all([
      prisma.workshopJob.findFirst({
        where: { businessId: business.id, vehicleId: vehicle.id },
        select: { id: true, date: true, mileage: true, lines: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
      }),
      prisma.workshopJob.findMany({
        where: { businessId: business.id, vehicleId: vehicle.id },
        select: { id: true, date: true, mileage: true, lines: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        skip: offset
      })
    ])
    const hasMore = page.length > limit
    return buildPublicWorkshopVehicle({
      vehicle,
      jobs: page.slice(0, limit),
      latestJob,
      hasMore,
      nextOffset: hasMore ? offset + limit : null
    })
  })
}

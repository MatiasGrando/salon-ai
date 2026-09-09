import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../config/prisma.js'
import { registerWorkshopJobs } from './workshop-jobs.js'
import { workshopJobsStore } from '../services/workshop-jobs-store.js'
import { loadAuthorizedBusiness } from '../services/tenant-resource-authorization.js'
import { sendAuthorizationFailure } from '../services/authorization-response.js'
import {
  normalizeWorkshopBrand,
  normalizeWorkshopContactPhone,
  normalizeWorkshopPlatePrefix,
  parseWorkshopVehicleInput,
  WorkshopVehicleValidationError
} from '../services/workshop-vehicle-domain.js'

export async function workshopRoutes(app: FastifyInstance) {
  app.patch('/workshop/vehicles/:id', async (request, reply) => {
    const body = request.body as Record<string, unknown> & { businessId?: string }
    const businessId = body.businessId?.trim()
    if (!await requireWorkshop(request, reply, businessId)) return
    const id = (request.params as { id: string }).id
    try {
      const input = parseWorkshopVehicleInput(body)
      const phone = normalizeWorkshopContactPhone(input.contactPhone)
      const vehicle = await prisma.$transaction(async tx => {
        const current = await tx.workshopVehicle.findFirst({where:{id,businessId}})
        if (!current) return null
        const brand = await tx.workshopBrand.findFirst({where:{id:input.brandId,businessId}})
        if (!brand) throw new WorkshopVehicleValidationError('La marca no pertenece a este taller')
        await tx.customer.update({where:{id:current.customerId},data:{name:input.contactName,phone:phone.storedPhone,normalizedPhone:phone.normalizedPhone,email:input.contactEmail}})
        return tx.workshopVehicle.update({where:{id},data:{plate:input.plate,brandId:brand.id,model:input.model,year:input.year,engine:input.engine,currentMileage:input.currentMileage,usage:input.usage,customerId:current.customerId},include:{brand:true,customer:{select:{id:true,name:true,phone:true,email:true}}}})
      })
      if (!vehicle) return sendAuthorizationFailure(reply,'notFound')
      return serializeVehicle(vehicle)
    } catch(error) {
      if(error instanceof WorkshopVehicleValidationError)return reply.status(400).send({message:error.message})
      if(isUniqueConstraint(error))return reply.status(409).send({message:'La patente o el telefono ya esta registrado. Revisa los datos.'})
      throw error
    }
  })
  await registerWorkshopJobs(app, workshopJobsStore, requireWorkshop)
  app.get('/workshop/brands', async (request, reply) => {
    const query = request.query as { businessId?: string; q?: string }
    const businessId = query.businessId?.trim()
    if (!await requireWorkshop(request, reply, businessId)) return
    const q = query.q?.trim()
    return prisma.workshopBrand.findMany({
      where: { businessId: businessId!, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      take: 100
    })
  })

  app.post('/workshop/brands', async (request, reply) => {
    const body = request.body as { businessId?: string; name?: unknown }
    const businessId = body.businessId?.trim()
    if (!await requireWorkshop(request, reply, businessId)) return
    try {
      const brand = normalizeWorkshopBrand(body.name)
      return await prisma.workshopBrand.upsert({
        where: { businessId_normalizedName: { businessId: businessId!, normalizedName: brand.normalizedName } },
        create: { businessId: businessId!, ...brand },
        update: {},
      })
    } catch (error) {
      if (error instanceof WorkshopVehicleValidationError) return reply.status(400).send({ message: error.message })
      throw error
    }
  })

  app.get('/workshop/vehicles', async (request, reply) => {
    const query = request.query as { businessId?: string; q?: string }
    const businessId = query.businessId?.trim()
    if (!await requireWorkshop(request, reply, businessId)) return
    const platePrefix = normalizeWorkshopPlatePrefix(query.q)
    if (!platePrefix) return []
    const vehicles = await prisma.workshopVehicle.findMany({
      where: { businessId: businessId!, plate: { startsWith: platePrefix } },
      include: { brand: true, customer: { select: { id: true, name: true, phone: true, email: true } } },
      orderBy: [{ plate: 'asc' }],
      take: 10
    })
    return vehicles.map(serializeVehicle)
  })

  app.get('/workshop/vehicles/:id', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const params = request.params as { id: string }
    const businessId = query.businessId?.trim()
    if (!await requireWorkshop(request, reply, businessId)) return
    const vehicle = await prisma.workshopVehicle.findFirst({
      where: { id: params.id, businessId: businessId! },
      include: { brand: true, customer: { select: { id: true, name: true, phone: true, email: true } } }
    })
    if (!vehicle) return sendAuthorizationFailure(reply, 'notFound')
    return serializeVehicle(vehicle)
  })

  app.post('/workshop/vehicles', async (request, reply) => {
    const body = request.body as Record<string, unknown> & { businessId?: string }
    const businessId = body.businessId?.trim()
    if (!await requireWorkshop(request, reply, businessId)) return
    try {
      const input = parseWorkshopVehicleInput(body)
      const normalizedPhone = normalizeWorkshopContactPhone(input.contactPhone)
      const vehicle = await prisma.$transaction(async (transaction) => {
        const brand = await transaction.workshopBrand.findFirst({
          where: { id: input.brandId, businessId: businessId! }
        })
        if (!brand) throw new WorkshopVehicleValidationError('La marca seleccionada no pertenece a este taller')
        const customer = await transaction.customer.upsert({
          where: { businessId_normalizedPhone: { businessId: businessId!, normalizedPhone: normalizedPhone.normalizedPhone } },
          create: {
            businessId: businessId!,
            name: input.contactName,
            phone: normalizedPhone.storedPhone,
            normalizedPhone: normalizedPhone.normalizedPhone,
            email: input.contactEmail
          },
          update: {
            name: input.contactName,
            phone: normalizedPhone.storedPhone,
            ...(input.contactEmail ? { email: input.contactEmail } : {})
          }
        })
        return transaction.workshopVehicle.create({
          data: {
            businessId: businessId!,
            brandId: brand.id,
            customerId: customer.id,
            plate: input.plate,
            model: input.model,
            year: input.year,
            engine: input.engine,
            currentMileage: input.currentMileage,
            usage: input.usage
          },
          include: { brand: true, customer: { select: { id: true, name: true, phone: true, email: true } } }
        })
      })
      return reply.status(201).send(serializeVehicle(vehicle))
    } catch (error) {
      if (error instanceof WorkshopVehicleValidationError) return reply.status(400).send({ message: error.message })
      if (isUniqueConstraint(error)) return reply.status(409).send({ message: 'Ya existe un auto con esa patente' })
      throw error
    }
  })
}

async function requireWorkshop(request: FastifyRequest, reply: FastifyReply, businessId?: string) {
  if (!businessId) {
    reply.status(400).send({ message: 'businessId es requerido' })
    return null
  }
  const user = request.auth?.user
  if (!user) {
    sendAuthorizationFailure(reply, 'unauthenticated')
    return null
  }
  const business = await loadAuthorizedBusiness(prisma, user, businessId)
  if (!business) {
    sendAuthorizationFailure(reply, 'notFound')
    return null
  }
  if (business.businessType !== 'WORKSHOP') {
    reply.status(403).send({ message: 'Esta funcion esta disponible solamente para talleres' })
    return null
  }
  return business
}

function serializeVehicle(vehicle: any) {
  return {
    id: vehicle.id,
    plate: vehicle.plate,
    brand: { id: vehicle.brand.id, name: vehicle.brand.name },
    model: vehicle.model,
    year: vehicle.year,
    engine: vehicle.engine,
    currentMileage: vehicle.currentMileage,
    usage: vehicle.usage,
    contact: vehicle.customer,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt
  }
}

function isUniqueConstraint(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

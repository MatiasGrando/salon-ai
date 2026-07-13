import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { AppointmentService } from '../services/appointment-service.js'
import { BusinessService } from '../services/business-service.js'
import { inferDefaultAreaCodeFromPhone, normalizePhone, phoneSearchVariants } from '../services/phone-normalization-service.js'
import { getWeexAuthFromRequest, linkExistingCustomersByPhone } from '../services/weex-account-service.js'

const businessService = new BusinessService()
const appointmentService = new AppointmentService()

export async function publicBookingRoutes(app: FastifyInstance) {
  app.get('/public/booking/:slug/catalog', async (request, reply) => {
    const params = request.params as { slug: string }
    const business = await businessService.findPublicBySlug(params.slug)
    if (!business || !business.landingEnabled) return reply.status(404).send({ message: 'No encontre esta landing' })

    const serviceLinks = await prisma.professionalService.findMany({
      where: {
        service: {
          businessId: business.id
        },
        professional: {
          businessId: business.id,
          isActive: true
        }
      },
      select: {
        serviceId: true,
        professionalId: true
      }
    })

    return {
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug
      },
      services: business.services.map((service) => ({
        id: service.id,
        name: service.name,
        duration: service.duration,
        category: service.category,
        price: service.price,
        professionalIds: serviceLinks
          .filter((link) => link.serviceId === service.id)
          .map((link) => link.professionalId)
      })),
      professionals: business.professionals.map((professional) => ({
        id: professional.id,
        name: professional.name,
        avatarUrl: professional.avatarUrl
      }))
    }
  })

  app.get('/public/booking/:slug/availability', async (request, reply) => {
    const params = request.params as { slug: string }
    const query = request.query as {
      serviceId?: string
      professionalId?: string
      date?: string
    }
    const business = await businessService.findPublicBySlug(params.slug)
    if (!business || !business.landingEnabled) return reply.status(404).send({ message: 'No encontre esta landing' })
    if (!query.serviceId || !query.professionalId || !query.date) return reply.status(400).send({ message: 'Servicio, profesional y fecha son requeridos' })

    const professionals = await professionalsForService(business.id, query.serviceId, query.professionalId)
    if (professionals.length === 0) return reply.status(404).send({ message: 'No hay profesionales para ese servicio' })

    const slots: Array<{ time: string; professionalId: string; professionalName: string }> = []
    const errors: string[] = []

    for (const professional of professionals) {
      const result = await appointmentService.findAvailability({
        professionalId: professional.id,
        serviceId: query.serviceId,
        date: query.date
      })

      if (result.ok) {
        for (const time of result.slots) {
          slots.push({
            time,
            professionalId: professional.id,
            professionalName: professional.name
          })
        }
      } else {
        errors.push(result.message)
      }
    }

    slots.sort((left, right) => left.time.localeCompare(right.time) || left.professionalName.localeCompare(right.professionalName))

    return {
      slots,
      message: slots.length ? null : errors[0] || 'No hay horarios disponibles para esa fecha'
    }
  })

  app.post('/public/booking/:slug/book', async (request, reply) => {
    const params = request.params as { slug: string }
    const body = request.body as {
      serviceId?: string
      professionalId?: string
      date?: string
      time?: string
      customerName?: string
      customerPhone?: string
    }
    const business = await businessService.findPublicBySlug(params.slug)
    if (!business || !business.landingEnabled) return reply.status(404).send({ message: 'No encontre esta landing' })

    const serviceId = body.serviceId?.trim()
    const professionalId = body.professionalId?.trim()
    const date = body.date?.trim()
    const time = body.time?.trim()
    const weexAuth = await getWeexAuthFromRequest(request)
    const customerName = weexAuth?.account.name || body.customerName?.trim()
    const defaultAreaCode = inferDefaultAreaCodeFromPhone(business.publicWhatsapp)
    const customerPhone = normalizePhone(weexAuth?.account.phone || body.customerPhone, { defaultAreaCode })

    if (!serviceId || !professionalId || !date || !time || !customerName || !customerPhone) {
      return reply.status(400).send({ message: 'Completa servicio, profesional, fecha, horario y tus datos de contacto' })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return reply.status(400).send({ message: 'La fecha u horario no parecen validos' })
    }
    if (customerPhone.length < 8) {
      return reply.status(400).send({ message: 'Ingresa un telefono valido para confirmar el turno' })
    }

    const professionals = await professionalsForService(business.id, serviceId, professionalId)
    if (!professionals.some((professional) => professional.id === professionalId)) {
      return reply.status(400).send({ message: 'Ese profesional no corresponde al servicio elegido' })
    }

    const customer = await findOrCreatePublicCustomer({
      businessId: business.id,
      name: customerName,
      phone: customerPhone
    })
    const result = await appointmentService.create({
      customerId: customer.id,
      professionalId,
      serviceId,
      startAt: `${date}T${time}:00`
    })

    if (!result.ok) {
      return reply.status(result.statusCode).send({ message: result.message })
    }

    if (weexAuth?.account.phone) {
      await linkExistingCustomersByPhone(weexAuth.account.id, customerPhone, defaultAreaCode)
    }

    const appointment = await prisma.appointment.findUnique({
      where: {
        id: result.appointment.id
      },
      include: {
        service: true,
        professional: true,
        customer: true
      }
    })

    return {
      appointment
    }
  })

  app.get('/public/booking/:slug/history', async (request, reply) => {
    const params = request.params as { slug: string }
    const query = request.query as { phone?: string }
    const business = await businessService.findPublicBySlug(params.slug)
    if (!business || !business.landingEnabled) return reply.status(404).send({ message: 'No encontre esta landing' })

    const defaultAreaCode = inferDefaultAreaCodeFromPhone(business.publicWhatsapp)
    const phone = normalizePhone(query.phone, { defaultAreaCode })
    if (phone.length < 8) return reply.status(400).send({ message: 'Ingresa un telefono valido para ver tus turnos' })
    const phoneVariants = phoneSearchVariants(phone, { defaultAreaCode })

    const appointments = await prisma.appointment.findMany({
      where: {
        customer: {
          phone: {
            in: phoneVariants
          }
        },
        professional: {
          businessId: business.id
        }
      },
      include: {
        service: true,
        professional: true,
        customer: true
      },
      orderBy: {
        startAt: 'desc'
      },
      take: 40
    })

    return {
      appointments: appointments.map((appointment) => ({
        id: appointment.id,
        startAt: appointment.startAt,
        status: appointment.status,
        service: {
          id: appointment.service.id,
          name: appointment.service.name,
          duration: appointment.service.duration,
          price: appointment.service.price
        },
        professional: {
          id: appointment.professional.id,
          name: appointment.professional.name
        },
        customer: {
          name: appointment.customer.name,
          phone: appointment.customer.phone
        }
      }))
    }
  })
}

async function professionalsForService(businessId: string, serviceId: string, professionalId?: string) {
  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      businessId
    },
    select: {
      id: true
    }
  })
  if (!service) return []

  const links = await prisma.professionalService.findMany({
    where: {
      serviceId,
      professional: {
        businessId,
        isActive: true,
        ...(professionalId ? { id: professionalId } : {})
      }
    },
    select: {
      professional: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      professional: {
        name: 'asc'
      }
    }
  })

  return links.map((link) => link.professional)
}

async function findOrCreatePublicCustomer(input: { businessId: string; name: string; phone: string }) {
  const phoneVariants = phoneSearchVariants(input.phone)
  const existingAppointments = await prisma.appointment.findMany({
    where: {
      professional: {
        businessId: input.businessId
      },
      customer: {
        phone: {
          in: phoneVariants
        }
      }
    },
    select: {
      customer: true
    },
    take: 1
  })
  const existing = existingAppointments[0]?.customer

  if (existing) {
    return prisma.customer.update({
      where: {
        id: existing.id
      },
      data: {
        name: input.name
      }
    })
  }

  const customer = await prisma.customer.findFirst({
    where: {
      phone: {
        in: phoneVariants
      }
    }
  })

  if (customer) {
    return prisma.customer.update({
      where: {
        id: customer.id
      },
      data: {
        name: input.name
      }
    })
  }

  return prisma.customer.create({
    data: {
      name: input.name,
      phone: input.phone
    }
  })
}

import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import {
  createProvisionalCustomer,
  customerHasContactIdentity,
  CustomerBusinessScopeError,
  CustomerEmailValidationError,
  CustomerPhoneConflictError,
  CustomerPhoneValidationError,
  findOrCreateCustomerByPhone,
  normalizeCustomerEmail,
  updateCustomerIdentity
} from '../services/customer-identity-service.js'
import { normalizePhone } from '../services/phone-normalization-service.js'
import {
  authorizedCustomerWhere,
  loadAuthorizedBusiness,
  loadAuthorizedCustomer
} from '../services/tenant-resource-authorization.js'
import { sendAuthorizationFailure } from '../services/authorization-response.js'

class CustomerAuthorizationStateConflictError extends Error {}

type CustomerOverviewAppointment = {
  customerId: string
  status: string
  startAt: Date
  quotedPrice: number | null
  professional: {
    name: string
  }
  service: {
    name: string
    price: number | null
  }
}

type CustomerOverviewSummary = {
  id: string
  name: string
  phone: string
  email: string | null
  marketingStatus: string
  marketingSource: string
  createdAt: Date
  status: 'active' | 'inactive'
  isNew: boolean
  isProvisional: boolean
  visitCount: number
  lastVisit: Date | null
  nextAppointment: CustomerOverviewAppointment | null
  averageFrequencyDays: number | null
  estimatedSpend: number
  frequentProfessional: string | null
  frequentService: string | null
  recentAppointments: CustomerOverviewAppointment[]
  notes: Array<{ id: string; body: string; createdAt: Date }>
  conversation: CustomerOverviewConversation | null
  openConversation: CustomerOverviewConversation | null
}

type CustomerOverviewConversation = {
  id: string
  phone: string
  businessId: string | null
  currentStep: string
  aiEnabled: boolean
  lastMessage: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export async function customerRoutes(app: FastifyInstance) {

  app.get('/customers/search', async (request, reply) => {
    const query = request.query as { businessId?: string; q?: string; take?: string }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    if (!await loadAuthorizedBusiness(prisma, authUser, businessId)) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    const search = query.q?.trim() || ''
    const digits = search.replace(/\D/g, '')
    const take = Math.min(20, Math.max(1, Number(query.take) || 12))
    return prisma.customer.findMany({
      where: {
        businessId,
        ...(search
          ? {
              AND: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { phone: { contains: digits || search } },
                  ...(digits ? [{ normalizedPhone: { contains: digits } }] : [])
                ]
              }
            }
          : {})
      },
      select: { id: true, name: true, phone: true, email: true },
      orderBy: { createdAt: 'desc' },
      take
    })
  })

  app.get('/customers/overview', async (request, reply) => {
    const query = request.query as {
      q?: string
      status?: 'all' | 'active' | 'inactive' | 'new'
      inactiveDays?: string
      page?: string
      take?: string
      businessId?: string
    }
    const now = new Date()
    const inactiveDays = [30, 45, 60, 90].includes(Number(query.inactiveDays))
      ? Number(query.inactiveDays)
      : 60
    const page = Math.max(1, Number(query.page) || 1)
    const take = Math.min(100, Math.max(10, Number(query.take) || 25))
    const status = ['active', 'inactive', 'new'].includes(query.status || '') ? query.status : 'all'
    const search = query.q?.trim().toLocaleLowerCase('es') || ''
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - inactiveDays)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    if (!await loadAuthorizedBusiness(prisma, authUser, businessId)) {
      return sendAuthorizationFailure(reply, 'notFound')
    }

    const customers = await prisma.customer.findMany({
      where: { businessId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        createdAt: true
      }
    })

    const appointments = await prisma.appointment.findMany({
      where: {
        professional: { businessId },
        customerId: { in: customers.map((customer) => customer.id) }
      },
      select: {
        customerId: true,
        status: true,
        startAt: true,
        quotedPrice: true,
        professional: {
          select: {
            name: true
          }
        },
        service: {
          select: {
            name: true,
            price: true
          }
        }
      },
      orderBy: {
        startAt: 'desc'
      }
    })
    const appointmentsByCustomerId = new Map<string, CustomerOverviewAppointment[]>()
    for (const appointment of appointments) {
      const items = appointmentsByCustomerId.get(appointment.customerId) ?? []
      items.push(appointment)
      appointmentsByCustomerId.set(appointment.customerId, items)
    }

    const conversations = await prisma.conversation.findMany({
      where: { businessId },
      select: {
        id: true,
        phone: true,
        businessId: true,
        currentStep: true,
        aiEnabled: true,
        lastMessage: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: {
        updatedAt: 'desc'
      }
    })
    const conversationsByPhone = new Map<string, (typeof conversations)[number]>()
    for (const conversation of conversations) {
      const phone = normalizePhone(conversation.phone)
      if (!conversationsByPhone.has(phone)) conversationsByPhone.set(phone, conversation)
    }

    const summaries: CustomerOverviewSummary[] = customers.map((customer) => {
      const customerAppointments = appointmentsByCustomerId.get(customer.id) ?? []
      const attended = customerAppointments
        .filter((appointment) => isAttendedVisit(appointment, now))
        .sort((left, right) => right.startAt.getTime() - left.startAt.getTime())
      const future = customerAppointments
        .filter((appointment) => isActiveAppointment(appointment) && appointment.startAt >= now)
        .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
      const recentVisits = attended.slice(0, 8)
      const lastVisit = attended[0]?.startAt ?? null
      const nextAppointment = future[0] ?? null
      const isProvisional = !customerHasContactIdentity(customer.phone)
      const isNew = !isProvisional && customer.createdAt >= monthStart && customer.createdAt < nextMonthStart
      const isActive = Boolean(
        nextAppointment ||
        (lastVisit && lastVisit >= cutoff) ||
        (!lastVisit && customer.createdAt >= cutoff && customer.createdAt <= now)
      )
      const estimatedSpend = attended.reduce((total, appointment) => {
        return total + (appointment.quotedPrice ?? appointment.service.price ?? 0)
      }, 0)

      const conversation = isProvisional
        ? null
        : conversationsByPhone.get(normalizePhone(customer.phone)) ?? null

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        marketingStatus: 'NOT_AUTHORIZED',
        marketingSource: 'DEFAULT',
        createdAt: customer.createdAt,
        status: isActive ? 'active' : 'inactive',
        isNew,
        isProvisional,
        visitCount: attended.length,
        lastVisit,
        nextAppointment,
        averageFrequencyDays: isProvisional ? null : averageVisitGap(recentVisits),
        estimatedSpend,
        frequentProfessional: mostFrequent(recentVisits, (appointment) => appointment.professional.name),
        frequentService: mostFrequent(recentVisits, (appointment) => appointment.service.name),
        recentAppointments: attended.slice(0, 8),
        notes: [],
        conversation,
        openConversation: conversation && !conversation.archivedAt && conversation.currentStep !== 'COMPLETED'
          ? conversation
          : null
      }
    })

    const counts = {
      total: summaries.length,
      active: summaries.filter((customer) => customer.status === 'active').length,
      inactive: summaries.filter((customer) => customer.status === 'inactive').length,
      new: summaries.filter((customer) => customer.isNew).length
    }
    const filtered = summaries
      .filter((customer) => {
        if (!search) return true
        const searchPhone = normalizePhone(search)
        return customer.name.toLocaleLowerCase('es').includes(search) ||
          Boolean(searchPhone && normalizePhone(customer.phone).includes(searchPhone)) ||
          customer.email?.toLocaleLowerCase('es').includes(search)
      })
      .filter((customer) => {
        if (status === 'new') return customer.isNew
        if (status === 'active' || status === 'inactive') return customer.status === status
        return true
      })
      .sort((left, right) => {
        const leftActivity = left.lastVisit?.getTime() ?? left.createdAt.getTime()
        const rightActivity = right.lastVisit?.getTime() ?? right.createdAt.getTime()
        return rightActivity - leftActivity || left.name.localeCompare(right.name, 'es')
      })
    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / take))
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * take
    const pageItems = filtered.slice(start, start + take)
    const pageCustomerIds = pageItems.map((customer) => customer.id)
    const [pageNotes, pageMarketingPreferences] = pageCustomerIds.length
      ? await Promise.all([
          prisma.customerNote.findMany({
            where: {
              customerId: {
                in: pageCustomerIds
              }
            },
            select: {
              id: true,
              customerId: true,
              body: true,
              createdAt: true
            },
            orderBy: {
              createdAt: 'desc'
            }
          }),
          prisma.customerMarketingPreference.findMany({
            where: {
              customerId: {
                in: pageCustomerIds
              },
              businessId
            },
            select: {
              customerId: true,
              status: true,
              source: true
            },
            orderBy: {
              updatedAt: 'desc'
            }
          })
        ])
      : [[], []]
    const notesByCustomerId = new Map<string, Array<{ id: string; body: string; createdAt: Date }>>()
    for (const note of pageNotes) {
      const items = notesByCustomerId.get(note.customerId) ?? []
      if (items.length < 2) {
        items.push({
          id: note.id,
          body: note.body,
          createdAt: note.createdAt
        })
        notesByCustomerId.set(note.customerId, items)
      }
    }
    const marketingByCustomerId = new Map<string, { status: string; source: string }>()
    for (const preference of pageMarketingPreferences) {
      if (!marketingByCustomerId.has(preference.customerId)) {
        marketingByCustomerId.set(preference.customerId, {
          status: preference.status,
          source: preference.source
        })
      }
    }
    const canViewFinancialAmounts = request.auth?.user.role !== 'STAFF' || request.auth.user.canViewFinancialAmounts
    const items = pageItems.map((customer) => {
      const marketing = marketingByCustomerId.get(customer.id)
      return {
        ...customer,
        estimatedSpend: canViewFinancialAmounts ? customer.estimatedSpend : null,
        marketingStatus: marketing?.status ?? customer.marketingStatus,
        marketingSource: marketing?.source ?? customer.marketingSource,
        notes: notesByCustomerId.get(customer.id) ?? []
      }
    })

    return {
      items,
      counts,
      pagination: {
        page: safePage,
        take,
        total,
        totalPages
      },
      inactiveDays
    }
  })

  app.post('/customers', async (request, reply) => {

    const body = request.body as {
      name: string
      phone?: string
      email?: string | null
      businessId?: string
    }
    const businessId = body.businessId?.trim() || request.auth?.user.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    if (!await loadAuthorizedBusiness(prisma, authUser, businessId)) {
      return sendAuthorizationFailure(reply, 'notFound')
    }

    try {
      if (!body.phone?.trim()) {
        const customer = await createProvisionalCustomer({
          businessId,
          name: body.name || '',
          email: body.email
        })
        return {
          ...customer,
          isProvisional: true,
          wasExisting: false,
          nameConflict: null
        }
      }
      const result = await findOrCreateCustomerByPhone({
        name: body.name || '',
        phone: body.phone || '',
        email: body.email,
        businessId
      })
      return { ...result.customer, wasExisting: result.wasExisting, nameConflict: result.nameConflict }
    } catch (error) {
      if (error instanceof CustomerBusinessScopeError) return reply.status(403).send({ message: error.message })
      if (error instanceof CustomerPhoneValidationError || error instanceof CustomerEmailValidationError) {
        return reply.status(400).send({ message: error.message })
      }
      throw error
    }
  })

  app.get('/customers', async (request, reply) => {
    const query = request.query as {
      businessId?: string
    }
    const businessId = query.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    if (!await loadAuthorizedBusiness(prisma, authUser, businessId)) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    const customers = await prisma.customer.findMany({ where: { businessId } })
    return customers.map((customer) => ({
      ...customer,
      isProvisional: !customerHasContactIdentity(customer.phone)
    }))
  })

  app.patch('/customers/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { name?: string; phone?: string; email?: string | null; businessId?: string }
    const name = body.name?.trim()
    const businessId = body.businessId?.trim() || request.auth?.user.businessId?.trim()
    if (!businessId) return reply.status(400).send({ message: 'businessId es requerido' })

    if (!name) {
      return reply.status(400).send({ message: 'El nombre del cliente es requerido' })
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const customer = await loadAuthorizedCustomer(prisma, authUser, params.id)
    if (!customer || customer.businessId !== businessId) return sendAuthorizationFailure(reply, 'notFound')

    if (!body.phone?.trim()) {
      try {
        const email = normalizeCustomerEmail(body.email)
        const updated = await prisma.$transaction(async (transaction) => {
          const scopedCustomer = await loadAuthorizedCustomer(transaction, authUser, params.id)
          if (!scopedCustomer || scopedCustomer.businessId !== businessId) return null
          const claimed = await transaction.customer.updateMany({
            where: {
              ...authorizedCustomerWhere(authUser, params.id),
              businessId
            },
            data: { name, ...(email !== undefined ? { email } : {}) }
          })
          if (claimed.count !== 1) return null
          return loadAuthorizedCustomer(transaction, authUser, params.id)
        })
        if (!updated) return sendAuthorizationFailure(reply, 'conflict')
        return updated
      } catch (error) {
        if (error instanceof CustomerEmailValidationError) return reply.status(400).send({ message: error.message })
        throw error
      }
    }
    try {
      return await updateCustomerIdentity({
        customerId: params.id,
        name,
        phone: body.phone,
        email: body.email,
        businessId,
        authorizationUser: authUser
      })
    } catch (error) {
      if (error instanceof CustomerBusinessScopeError) return sendAuthorizationFailure(reply, 'conflict')
      if (error instanceof CustomerPhoneConflictError) return reply.status(409).send({ message: error.message })
      if (error instanceof CustomerPhoneValidationError || error instanceof CustomerEmailValidationError) {
        return reply.status(400).send({ message: error.message })
      }
      throw error
    }
  })

  app.delete('/customers/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const customer = await loadAuthorizedCustomer(prisma, authUser, params.id)
    if (!customer) return sendAuthorizationFailure(reply, 'notFound')

    const deleted = await prisma.$transaction(async (transaction) => {
      const scopedCustomer = await loadAuthorizedCustomer(transaction, authUser, params.id)
      if (!scopedCustomer) throw new CustomerAuthorizationStateConflictError()
      const appointments = await transaction.appointment.deleteMany({ where: { customerId: scopedCustomer.id } })
      const notes = await transaction.customerNote.deleteMany({ where: { customerId: scopedCustomer.id } })
      const customers = await transaction.customer.deleteMany({
        where: authorizedCustomerWhere(authUser, scopedCustomer.id)
      })
      if (customers.count !== 1) throw new CustomerAuthorizationStateConflictError()
      return { appointments: appointments.count, notes: notes.count, customers: customers.count }
    }).catch((error: unknown) => {
      if (error instanceof CustomerAuthorizationStateConflictError) return null
      throw error
    })
    if (!deleted) return sendAuthorizationFailure(reply, 'conflict')

    return {
      deleted,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email
      },
      conversationPreserved: true
    }
  })

  app.get('/customers/:id/notes', async (request, reply) => {
    const params = request.params as { id: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    if (!await loadAuthorizedCustomer(prisma, authUser, params.id)) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    return prisma.customerNote.findMany({
      where: {
        customerId: params.id,
        customer: authorizedCustomerWhere(authUser, params.id)
      },
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

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    if (!await loadAuthorizedCustomer(prisma, authUser, params.id)) {
      return sendAuthorizationFailure(reply, 'notFound')
    }

    const note = await prisma.$transaction(async (transaction) => {
      const customer = await loadAuthorizedCustomer(transaction, authUser, params.id)
      if (!customer) return null
      return transaction.customerNote.create({
        data: { customerId: customer.id, body: noteBody }
      })
    })
    if (!note) return sendAuthorizationFailure(reply, 'conflict')
    return note
  })

}

function isActiveAppointment(appointment: { status: string }) {
  return appointment.status !== 'CANCELLED' && appointment.status !== 'NO_SHOW'
}

function isAttendedVisit(appointment: { status: string; startAt: Date }, now: Date) {
  return isActiveAppointment(appointment) && (appointment.status === 'COMPLETED' || appointment.startAt < now)
}

function averageVisitGap(visits: Array<{ startAt: Date }>) {
  if (visits.length < 2) return null
  const chronological = [...visits].sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
  const gaps: number[] = []
  for (let index = 1; index < chronological.length; index += 1) {
    const current = chronological[index]
    const previous = chronological[index - 1]
    if (!current || !previous) continue
    gaps.push(Math.round((current.startAt.getTime() - previous.startAt.getTime()) / 86_400_000))
  }
  return Math.round(gaps.reduce((total, gap) => total + gap, 0) / gaps.length)
}

function mostFrequent<T>(items: T[], getLabel: (item: T) => string) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const label = getLabel(item)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'es'))[0]?.[0] ?? null
}

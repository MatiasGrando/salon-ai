import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { hashPassword } from '../services/auth-service.js'
import { BusinessService } from '../services/business-service.js'
import { refreshBusinessOnboarding, serializeBusinessOnboarding } from '../services/business-onboarding-service.js'
import {
  ensureAccountCharges,
  initializeAccountBilling,
  nextAccountBillingDate,
  parseBillingMonth,
  serializeAccountCharge
} from '../services/account-billing-service.js'

const businessService = new BusinessService()
const ACCOUNT_ROLES = new Set(['SUPER_ADMIN', 'ACCOUNT_ADMIN'])

export async function accountManagementRoutes(app: FastifyInstance) {
  app.get('/admin/account-plans', async (request, reply) => {
    if (!canManageAccounts(request.auth)) return reply.status(403).send({ message: 'No tenes permiso para gestionar cuentas' })
    const plans = await prisma.businessPlan.findMany({ orderBy: { name: 'asc' } })
    return plans.map(serializePlan)
  })

  app.patch('/admin/account-plans/:id', async (request, reply) => {
    if (request.auth?.user.role !== 'SUPER_ADMIN') return reply.status(403).send({ message: 'Solo el Super Admin puede modificar planes' })
    const params = request.params as { id: string }
    const body = request.body as { name?: string; description?: string | null; features?: string[]; price?: number; isActive?: boolean }
    const name = body.name?.trim()
    const price = Number(body.price)
    if (!name || !Number.isFinite(price) || price < 0) {
      return reply.status(400).send({ message: 'Completa un nombre y un precio valido' })
    }
    const plan = await prisma.businessPlan.update({
      where: { id: params.id },
      data: {
        name,
        description: body.description?.trim() || null,
        features: Array.isArray(body.features) ? body.features.map((item) => item.trim()).filter(Boolean).slice(0, 30) : [],
        price,
        isActive: body.isActive !== false
      }
    }).catch(() => null)
    if (!plan) return reply.status(404).send({ message: 'No encontre ese plan' })
    return serializePlan(plan)
  })

  app.get('/admin/accounts', async (request, reply) => {
    if (!canManageAccounts(request.auth)) return reply.status(403).send({ message: 'No tenes permiso para gestionar cuentas' })
    await ensureAccountCharges()
    const query = request.query as { search?: string; status?: string; billingMonth?: string; page?: string; take?: string }
    const page = positiveInteger(query.page, 1)
    const take = Math.min(100, positiveInteger(query.take, 25))
    const search = query.search?.trim()
    const accountStatus = normalizeAccountStatus(query.status)
    const billingMonth = parseBillingMonth(query.billingMonth)
    const where = {
      isDemo: false,
      ...(request.auth!.user.role === 'ACCOUNT_ADMIN' ? { accountAdminId: request.auth!.user.id } : {}),
      ...(accountStatus ? { accountStatus } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { customerCode: { contains: search.toUpperCase(), mode: 'insensitive' as const } },
              { contactPhone: { contains: search, mode: 'insensitive' as const } },
              { contactEmail: { contains: search.toLowerCase(), mode: 'insensitive' as const } }
            ]
          }
        : {})
    }
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const chargeScope = { business: { is: where }, dueAt: { gte: billingMonth.start, lt: billingMonth.end } }
    const now = new Date()
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const [accounts, total, active, onboarding, newThisMonth, administrators, billed, collected, pending, overdue] = await Promise.all([
      prisma.business.findMany({
        where,
        include: {
          plan: true,
          accountAdmin: { select: { id: true, name: true, email: true, role: true } },
          onboardingStatus: true,
          billingSettings: true,
          users: {
            where: { role: 'BUSINESS_ADMIN' },
            select: { id: true, name: true, email: true, firstLoginAt: true },
            orderBy: { createdAt: 'asc' },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take
      }),
      prisma.business.count({ where }),
      prisma.business.count({ where: { ...where, accountStatus: 'ACTIVE' } }),
      prisma.business.count({
        where: {
          AND: [
            where,
            {
              OR: [
                { accountStatus: 'ONBOARDING' },
                { onboardingStatus: null },
                { onboardingStatus: { is: { progress: { lt: 100 } } } }
              ]
            }
          ]
        }
      }),
      prisma.business.count({ where: { ...where, createdAt: { gte: startOfMonth } } }),
      prisma.user.findMany({
        where: {
          role: { in: ['SUPER_ADMIN', 'ACCOUNT_ADMIN'] },
          isActive: true,
          ...(request.auth!.user.role === 'ACCOUNT_ADMIN' ? { id: request.auth!.user.id } : {})
        },
        select: { id: true, name: true, _count: { select: { managedBusinesses: true } } },
        orderBy: { name: 'asc' }
      }),
      prisma.businessAccountCharge.aggregate({
        where: { ...chargeScope, status: { not: 'BONIFIED' } },
        _sum: { netAmount: true }
      }),
      prisma.businessAccountCharge.aggregate({
        where: { ...chargeScope, status: 'PAID' },
        _sum: { netAmount: true }
      }),
      prisma.businessAccountCharge.aggregate({
        where: { ...chargeScope, status: 'PENDING', dueAt: { gte: today, lt: billingMonth.end } },
        _sum: { netAmount: true }
      }),
      prisma.businessAccountCharge.aggregate({
        where: { ...chargeScope, status: 'PENDING', dueAt: { gte: billingMonth.start, lt: today } },
        _sum: { netAmount: true }
      })
    ])

    return {
      accounts: accounts.map(serializeAccountListItem),
      summary: {
        total,
        active,
        onboarding,
        newThisMonth,
        administrators,
        billing: {
          month: billingMonth.value,
          billed: Number(billed._sum.netAmount || 0),
          collected: Number(collected._sum.netAmount || 0),
          pending: Number(pending._sum.netAmount || 0),
          overdue: Number(overdue._sum.netAmount || 0)
        }
      },
      pagination: { page, take, total, totalPages: Math.max(1, Math.ceil(total / take)) }
    }
  })

  app.get('/admin/accounts/:id', async (request, reply) => {
    if (!canManageAccounts(request.auth)) return reply.status(403).send({ message: 'No tenes permiso para gestionar cuentas' })
    const params = request.params as { id: string }
    if (!await canAccessManagedAccount(request.auth!, params.id)) {
      return reply.status(404).send({ message: 'No encontre esa cuenta' })
    }
    await refreshBusinessOnboarding(params.id)
    const account = await prisma.business.findUnique({
      where: { id: params.id },
      include: {
        plan: true,
        accountAdmin: { select: { id: true, name: true, email: true, role: true } },
        createdByUser: { select: { id: true, name: true, email: true, role: true } },
        onboardingStatus: true,
        billingSettings: true,
        accountCharges: { orderBy: { dueAt: 'desc' }, take: 24 },
        users: {
          where: { role: 'BUSINESS_ADMIN' },
          select: { id: true, name: true, email: true, firstLoginAt: true, createdAt: true },
          orderBy: { createdAt: 'asc' }
        },
        _count: { select: { services: true, professionals: true, businessHours: true, conversations: true } }
      }
    })
    if (!account) return reply.status(404).send({ message: 'No encontre esa cuenta' })
    const workspaceBusiness = Object.fromEntries(
      Object.entries(account).filter(([key]) => !['plan', 'accountAdmin', 'createdByUser', 'onboardingStatus', 'billingSettings', 'accountCharges', 'users', '_count'].includes(key))
    )
    return {
      ...serializeAccountListItem(account),
      createdByUser: account.createdByUser,
      users: account.users,
      counts: account._count,
      workspaceBusiness,
      billing: {
        settings: account.billingSettings ? serializeBillingSettings(account.billingSettings) : null,
        charges: account.accountCharges.map(serializeAccountCharge)
      }
    }
  })

  app.patch('/admin/accounts/:id', async (request, reply) => {
    if (!canManageAccounts(request.auth)) return reply.status(403).send({ message: 'No tenes permiso para gestionar cuentas' })
    const params = request.params as { id: string }
    if (!await canAccessManagedAccount(request.auth!, params.id)) {
      return reply.status(404).send({ message: 'No encontre esa cuenta' })
    }
    const body = request.body as {
      businessName?: string
      contactName?: string
      contactEmail?: string
      contactPhone?: string
      planId?: string | null
      accountStatus?: string
      accountAdminId?: string | null
      billingDay?: number
      discountType?: string | null
      discountValue?: number | null
      discountUntil?: string | null
      discountReason?: string | null
    }
    const businessName = body.businessName?.trim()
    const contactName = body.contactName?.trim()
    const contactEmail = body.contactEmail?.trim().toLowerCase()
    const contactPhone = normalizeContactPhone(body.contactPhone)
    const planId = body.planId?.trim() || null
    const accountStatus = normalizeAccountStatus(body.accountStatus)
    const billingDay = normalizeBillingDay(body.billingDay)
    const discount = normalizeDiscount(body)
    if (!businessName || !contactName || !contactEmail || !contactPhone || !accountStatus || !billingDay || discount === undefined) {
      return reply.status(400).send({ message: 'Completa comercio, contacto, email, telefono y estado' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return reply.status(400).send({ message: 'El email de contacto no es valido' })
    }
    const selectedPlan = planId ? await prisma.businessPlan.findUnique({ where: { id: planId }, select: { id: true, price: true } }) : null
    if (planId && !selectedPlan) {
      return reply.status(400).send({ message: 'El plan seleccionado no es valido' })
    }

    const account = await prisma.business.findUnique({
      where: { id: params.id },
      include: {
        billingSettings: true,
        users: {
          where: { role: 'BUSINESS_ADMIN' },
          orderBy: { createdAt: 'asc' },
          take: 1
        }
      }
    })
    if (!account) return reply.status(404).send({ message: 'No encontre esa cuenta' })
    if (account.accountStatus === 'CANCELLED' && accountStatus === 'ACTIVE' && request.auth!.user.role !== 'SUPER_ADMIN') {
      return reply.status(403).send({ message: 'Solo el Super Admin puede reactivar una cuenta cancelada' })
    }
    if (accountStatus === 'ACTIVE' && account.accountStatus !== 'ACTIVE' && (!selectedPlan || Number(selectedPlan.price) <= 0)) {
      return reply.status(400).send({ message: 'Configura un plan con precio antes de activar la cuenta' })
    }
    const primaryUser = account.users[0]
    if (primaryUser) {
      const emailOwner = await prisma.user.findUnique({ where: { email: contactEmail }, select: { id: true } })
      if (emailOwner && emailOwner.id !== primaryUser.id) {
        return reply.status(409).send({ message: 'Ese email ya pertenece a otro usuario' })
      }
    }

    let accountAdminId = account.accountAdminId
    if (request.auth!.user.role === 'SUPER_ADMIN') {
      accountAdminId = body.accountAdminId?.trim() || null
      if (accountAdminId) {
        const administrator = await prisma.user.findFirst({
          where: { id: accountAdminId, role: { in: ['SUPER_ADMIN', 'ACCOUNT_ADMIN'] }, isActive: true },
          select: { id: true }
        })
        if (!administrator) return reply.status(400).send({ message: 'El responsable seleccionado no es valido' })
      }
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.business.update({
        where: { id: params.id },
        data: {
          name: businessName,
          contactName,
          contactEmail,
          contactPhone,
          planId,
          accountStatus,
          accountAdminId
        }
      })
      if (primaryUser) {
        await transaction.user.update({
          where: { id: primaryUser.id },
          data: { name: contactName, email: contactEmail }
        })
      }
      await transaction.businessBillingSettings.upsert({
        where: { businessId: params.id },
        create: {
          businessId: params.id,
          billingDay,
          discountType: discount?.type || null,
          discountValue: discount?.value ?? null,
          discountUntil: discount?.until || null,
          discountReason: discount?.reason || null
        },
        update: {
          billingDay,
          discountType: discount?.type || null,
          discountValue: discount?.value ?? null,
          discountUntil: discount?.until || null,
          discountReason: discount?.reason || null,
          ...(account.accountStatus === 'ACTIVE' && account.billingSettings?.billingDay !== billingDay
            ? { nextBillingAt: nextAccountBillingDate(new Date(), billingDay) }
            : {})
        }
      })
    })
    if (accountStatus === 'ACTIVE' && (account.accountStatus !== 'ACTIVE' || !account.billingSettings?.activatedAt) && selectedPlan && Number(selectedPlan.price) > 0) {
      await initializeAccountBilling(params.id, billingDay)
    }
    await refreshBusinessOnboarding(params.id)
    return { id: params.id, updated: true }
  })

  app.post('/admin/accounts', async (request, reply) => {
    if (!canManageAccounts(request.auth)) return reply.status(403).send({ message: 'No tenes permiso para gestionar cuentas' })
    const body = request.body as {
      businessName?: string
      adminName?: string
      adminEmail?: string
      adminPassword?: string
      contactPhone?: string
      planId?: string
      billingDay?: number
    }
    const businessName = body.businessName?.trim()
    const adminName = body.adminName?.trim()
    const adminEmail = body.adminEmail?.trim().toLowerCase()
    const adminPassword = body.adminPassword?.trim()
    const contactPhone = normalizeContactPhone(body.contactPhone)
    const planId = body.planId?.trim()
    const billingDay = normalizeBillingDay(body.billingDay)
    if (!businessName || !adminName || !adminEmail || !adminPassword || !contactPhone || !planId || !billingDay) {
      return reply.status(400).send({ message: 'Completa comercio, responsable, email, telefono, contrasena y plan' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return reply.status(400).send({ message: 'El email de acceso no es valido' })
    }
    if (adminPassword.length < 8) {
      return reply.status(400).send({ message: 'La contrasena debe tener al menos 8 caracteres' })
    }
    if (await prisma.user.findUnique({ where: { email: adminEmail } })) {
      return reply.status(409).send({ message: 'Ya existe un usuario con ese email' })
    }
    if (!await prisma.businessPlan.findUnique({ where: { id: planId }, select: { id: true } })) {
      return reply.status(400).send({ message: 'El plan seleccionado no es valido' })
    }

    let business
    let createdUserId: string | undefined
    try {
      business = await businessService.create(businessName, undefined, {
        accountAdminId: request.auth!.user.id,
        createdByUserId: request.auth!.user.id,
        contactName: adminName,
        contactPhone,
        contactEmail: adminEmail,
        planId
      })
      const createdUser = await prisma.user.create({
        data: {
          email: adminEmail,
          name: adminName,
          passwordHash: await hashPassword(adminPassword),
          role: 'BUSINESS_ADMIN',
          businessId: business.id
        }
      })
      createdUserId = createdUser.id
      await prisma.businessBillingSettings.create({ data: { businessId: business.id, billingDay } })
      await refreshBusinessOnboarding(business.id)
    } catch (error) {
      if (createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => null)
      if (business?.id) await prisma.business.delete({ where: { id: business.id } }).catch(() => null)
      return reply.status(400).send({ message: 'No pude crear la cuenta del comercio' })
    }
    return reply.status(201).send({ id: business.id, customerCode: business.customerCode, name: business.name })
  })

  app.post('/admin/accounts/:id/charges/:chargeId/payment', async (request, reply) => {
    const context = await chargeActionContext(request, reply)
    if (!context) return
    const body = request.body as { paymentDate?: string | null; reference?: string | null; note?: string | null }
    const paidAt = body.paymentDate ? parseInclusiveDate(body.paymentDate) : new Date()
    if (!paidAt) return reply.status(400).send({ message: 'La fecha de transferencia no es valida' })
    const tomorrow = new Date()
    tomorrow.setUTCHours(24, 0, 0, 0)
    if (paidAt.getTime() >= tomorrow.getTime()) return reply.status(400).send({ message: 'La transferencia no puede tener una fecha futura' })
    if (context.charge.status !== 'PENDING') return reply.status(409).send({ message: 'Este cargo ya esta cerrado' })
    const charge = await prisma.businessAccountCharge.update({
      where: { id: context.charge.id },
      data: {
        status: 'PAID',
        paidAt,
        paymentMethod: 'TRANSFER',
        paymentReference: body.reference?.trim() || null,
        paymentNote: body.note?.trim() || null,
        paymentRecordedBy: request.auth!.user.name
      }
    })
    return serializeAccountCharge(charge)
  })

  app.post('/admin/accounts/:id/charges/:chargeId/bonification', async (request, reply) => {
    if (request.auth?.user.role !== 'SUPER_ADMIN') return reply.status(403).send({ message: 'Solo el Super Admin puede bonificar cargos' })
    const context = await chargeActionContext(request, reply)
    if (!context) return
    const body = request.body as { reason?: string }
    const reason = body.reason?.trim()
    if (!reason) return reply.status(400).send({ message: 'Indica el motivo de la bonificacion' })
    if (context.charge.status !== 'PENDING') return reply.status(409).send({ message: 'Este cargo ya esta cerrado' })
    const charge = await prisma.businessAccountCharge.update({
      where: { id: context.charge.id },
      data: { status: 'BONIFIED', bonifiedAt: new Date(), bonificationReason: reason, bonifiedBy: request.auth!.user.name }
    })
    return serializeAccountCharge(charge)
  })

  app.patch('/admin/accounts/:id/charges/:chargeId/due-date', async (request, reply) => {
    const context = await chargeActionContext(request, reply)
    if (!context) return
    const body = request.body as { dueDate?: string; reason?: string }
    const dueAt = parseInclusiveDate(body.dueDate)
    const reason = body.reason?.trim()
    if (!dueAt || !reason) return reply.status(400).send({ message: 'Completa la nueva fecha y el motivo' })
    if (context.charge.status !== 'PENDING') return reply.status(409).send({ message: 'Solo se modifica un cargo pendiente' })
    const charge = await prisma.businessAccountCharge.update({
      where: { id: context.charge.id },
      data: { dueAt, dueDateChangedBy: request.auth!.user.name, dueDateChangeReason: reason }
    })
    return serializeAccountCharge(charge)
  })
}

function canManageAccounts(auth: { user: { role: string } } | undefined) {
  return Boolean(auth && ACCOUNT_ROLES.has(auth.user.role))
}

async function canAccessManagedAccount(auth: { user: { id: string; role: string } }, businessId: string) {
  if (auth.user.role === 'SUPER_ADMIN') return Boolean(await prisma.business.findFirst({ where: { id: businessId, isDemo: false }, select: { id: true } }))
  return Boolean(await prisma.business.findFirst({ where: { id: businessId, isDemo: false, accountAdminId: auth.user.id }, select: { id: true } }))
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeAccountStatus(value?: string) {
  return ['ONBOARDING', 'ACTIVE', 'PAUSED', 'CANCELLED'].includes(value || '')
    ? value as 'ONBOARDING' | 'ACTIVE' | 'PAUSED' | 'CANCELLED'
    : undefined
}

function normalizeContactPhone(value?: string) {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length < 6 || normalized.length > 40 || !/[0-9]/.test(normalized)) return undefined
  return normalized
}

function normalizeBillingDay(value?: number) {
  const day = Number(value)
  return day === 1 || day === 15 ? day as 1 | 15 : undefined
}

function normalizeDiscount(body: {
  discountType?: string | null
  discountValue?: number | null
  discountUntil?: string | null
  discountReason?: string | null
}): {
  type: 'PERCENTAGE' | 'FIXED'
  value: number
  until: Date
  reason: string | null
} | null | undefined {
  if (!body.discountType) return null
  if (!['PERCENTAGE', 'FIXED'].includes(body.discountType)) return undefined
  const value = Number(body.discountValue)
  const until = parseInclusiveDate(body.discountUntil)
  if (!Number.isFinite(value) || value <= 0 || !until) return undefined
  if (body.discountType === 'PERCENTAGE' && value > 100) return undefined
  return {
    type: body.discountType as 'PERCENTAGE' | 'FIXED',
    value,
    until,
    reason: body.discountReason?.trim() || null
  }
}

function parseInclusiveDate(value?: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return undefined
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function serializePlan(plan: {
  id: string
  name: string
  description: string | null
  features: string[]
  price: unknown
  isActive: boolean
}) {
  return { ...plan, price: Number(plan.price) }
}

function serializeBillingSettings(settings: {
  billingDay: number
  activatedAt: Date | null
  nextBillingAt: Date | null
  discountType: string | null
  discountValue: unknown
  discountUntil: Date | null
  discountReason: string | null
}) {
  return {
    ...settings,
    discountValue: settings.discountValue == null ? null : Number(settings.discountValue)
  }
}

async function chargeActionContext(request: {
  auth?: { user: { id: string; name: string; role: string } }
  params: unknown
}, reply: { status: (code: number) => { send: (payload: unknown) => unknown } }) {
  if (!canManageAccounts(request.auth)) {
    reply.status(403).send({ message: 'No tenes permiso para gestionar cobros' })
    return null
  }
  const params = request.params as { id: string; chargeId: string }
  if (!await canAccessManagedAccount(request.auth!, params.id)) {
    reply.status(404).send({ message: 'No encontre esa cuenta' })
    return null
  }
  const charge = await prisma.businessAccountCharge.findFirst({ where: { id: params.chargeId, businessId: params.id } })
  if (!charge) {
    reply.status(404).send({ message: 'No encontre ese cargo' })
    return null
  }
  return { charge }
}

function serializeAccountListItem(account: {
  id: string
  customerCode: string
  name: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  accountStatus: string
  createdAt: Date
  plan: { id: string; name: string; description: string | null; features: string[]; price: unknown; isActive: boolean } | null
  accountAdmin: { id: string; name: string; email: string; role: string } | null
  onboardingStatus: {
    businessId: string
    accountCreated: boolean
    ownerLoggedIn: boolean
    profileComplete: boolean
    hasServices: boolean
    hasProfessionals: boolean
    hasBusinessHours: boolean
    whatsappConnected: boolean
    landingConfigured: boolean
    completedSteps: number
    totalSteps: number
    progress: number
    updatedAt: Date
  } | null
  users: Array<{ id: string; name: string; email: string; firstLoginAt: Date | null }>
}) {
  return {
    id: account.id,
    customerCode: account.customerCode,
    name: account.name,
    contactName: account.contactName,
    contactPhone: account.contactPhone,
    contactEmail: account.contactEmail,
    accountStatus: account.accountStatus,
    createdAt: account.createdAt,
    plan: account.plan ? serializePlan(account.plan) : null,
    accountAdmin: account.accountAdmin,
    primaryUser: account.users[0] || null,
    onboarding: account.onboardingStatus ? serializeBusinessOnboarding(account.onboardingStatus) : null
  }
}

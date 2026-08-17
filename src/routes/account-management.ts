import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { hashPassword } from '../services/auth-service.js'
import { BusinessService } from '../services/business-service.js'
import { refreshBusinessOnboarding, serializeBusinessOnboarding } from '../services/business-onboarding-service.js'

const businessService = new BusinessService()
const ACCOUNT_ROLES = new Set(['SUPER_ADMIN', 'ACCOUNT_ADMIN'])

export async function accountManagementRoutes(app: FastifyInstance) {
  app.get('/admin/account-plans', async (request, reply) => {
    if (!canManageAccounts(request.auth)) return reply.status(403).send({ message: 'No tenes permiso para gestionar cuentas' })
    return prisma.businessPlan.findMany({ orderBy: { name: 'asc' } })
  })

  app.get('/admin/accounts', async (request, reply) => {
    if (!canManageAccounts(request.auth)) return reply.status(403).send({ message: 'No tenes permiso para gestionar cuentas' })
    const query = request.query as { search?: string; status?: string; page?: string; take?: string }
    const page = positiveInteger(query.page, 1)
    const take = Math.min(100, positiveInteger(query.take, 25))
    const search = query.search?.trim()
    const accountStatus = normalizeAccountStatus(query.status)
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

    const [accounts, total, active, onboarding, newThisMonth, administrators] = await prisma.$transaction([
      prisma.business.findMany({
        where,
        include: {
          plan: true,
          accountAdmin: { select: { id: true, name: true, email: true, role: true } },
          onboardingStatus: true,
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
      })
    ])

    return {
      accounts: accounts.map(serializeAccountListItem),
      summary: { total, active, onboarding, newThisMonth, administrators },
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
      Object.entries(account).filter(([key]) => !['plan', 'accountAdmin', 'createdByUser', 'onboardingStatus', 'users', '_count'].includes(key))
    )
    return {
      ...serializeAccountListItem(account),
      createdByUser: account.createdByUser,
      users: account.users,
      counts: account._count,
      workspaceBusiness
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
    }
    const businessName = body.businessName?.trim()
    const contactName = body.contactName?.trim()
    const contactEmail = body.contactEmail?.trim().toLowerCase()
    const contactPhone = normalizeContactPhone(body.contactPhone)
    const planId = body.planId?.trim() || null
    const accountStatus = normalizeAccountStatus(body.accountStatus)
    if (!businessName || !contactName || !contactEmail || !contactPhone || !accountStatus) {
      return reply.status(400).send({ message: 'Completa comercio, contacto, email, telefono y estado' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return reply.status(400).send({ message: 'El email de contacto no es valido' })
    }
    if (planId && !await prisma.businessPlan.findUnique({ where: { id: planId }, select: { id: true } })) {
      return reply.status(400).send({ message: 'El plan seleccionado no es valido' })
    }

    const account = await prisma.business.findUnique({
      where: { id: params.id },
      include: {
        users: {
          where: { role: 'BUSINESS_ADMIN' },
          orderBy: { createdAt: 'asc' },
          take: 1
        }
      }
    })
    if (!account) return reply.status(404).send({ message: 'No encontre esa cuenta' })
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
    })
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
    }
    const businessName = body.businessName?.trim()
    const adminName = body.adminName?.trim()
    const adminEmail = body.adminEmail?.trim().toLowerCase()
    const adminPassword = body.adminPassword?.trim()
    const contactPhone = normalizeContactPhone(body.contactPhone)
    const planId = body.planId?.trim()
    if (!businessName || !adminName || !adminEmail || !adminPassword || !contactPhone || !planId) {
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
      await refreshBusinessOnboarding(business.id)
    } catch (error) {
      if (createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => null)
      if (business?.id) await prisma.business.delete({ where: { id: business.id } }).catch(() => null)
      return reply.status(400).send({ message: 'No pude crear la cuenta del comercio' })
    }
    return reply.status(201).send({ id: business.id, customerCode: business.customerCode, name: business.name })
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

function serializeAccountListItem(account: {
  id: string
  customerCode: string
  name: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  accountStatus: string
  createdAt: Date
  plan: { id: string; name: string } | null
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
    plan: account.plan,
    accountAdmin: account.accountAdmin,
    primaryUser: account.users[0] || null,
    onboarding: account.onboardingStatus ? serializeBusinessOnboarding(account.onboardingStatus) : null
  }
}

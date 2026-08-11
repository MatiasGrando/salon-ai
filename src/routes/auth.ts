import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  createSession,
  destroySessionFromRequest,
  getAuthFromRequest,
  hashPassword,
  verifyPassword
} from '../services/auth-service.js'
import { BusinessService } from '../services/business-service.js'

const businessService = new BusinessService()

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const body = request.body as { email?: string; password?: string }
    const email = body.email?.trim().toLowerCase()
    const password = body.password || ''

    if (!email || !password) {
      return reply.status(400).send({ message: 'Email y contrasena son requeridos' })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { business: true, professional: true }
    })

    if (!user || !user.isActive || !await verifyPassword(password, user.passwordHash)) {
      return reply.status(401).send({ message: 'Email o contrasena incorrectos' })
    }

    const session = await createSession(user.id)
    reply.header('Set-Cookie', buildSessionCookie(session.token, session.expiresAt))

    return {
      user: publicUser(user),
      business: user.business
    }
  })

  app.post('/auth/logout', async (request, reply) => {
    await destroySessionFromRequest(request)
    reply.header('Set-Cookie', buildExpiredSessionCookie())
    return { ok: true }
  })

  app.get('/auth/me', async (request, reply) => {
    const auth = await getAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion' })
    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      include: { business: true, professional: true }
    })
    if (!user || !user.isActive) return reply.status(401).send({ message: 'Necesitas iniciar sesion' })
    return {
      user: publicUser(user),
      business: user.business
    }
  })

  app.post('/admin/businesses', async (request, reply) => {
    const auth = await getAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion' })
    const canCreateBusiness = auth.user.role === 'SUPER_ADMIN' || auth.user.role === 'ACCOUNT_ADMIN' && auth.user.canCreateBusinesses
    if (!canCreateBusiness) return reply.status(403).send({ message: 'No tenes permiso para crear comercios' })

    const body = request.body as {
      businessName?: string
      adminName?: string
      adminEmail?: string
      adminPassword?: string
      accountAdminId?: string | null
    }
    const businessName = body.businessName?.trim()
    const adminName = body.adminName?.trim()
    const adminEmail = body.adminEmail?.trim().toLowerCase()
    const adminPassword = body.adminPassword?.trim()

    if (!businessName || !adminName || !adminEmail || !adminPassword) {
      return reply.status(400).send({ message: 'Completa comercio, nombre, email y contrasena del administrador' })
    }
    if (adminPassword.length < 8) {
      return reply.status(400).send({ message: 'La contrasena debe tener al menos 8 caracteres' })
    }

    const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (existing) return reply.status(409).send({ message: 'Ya existe un usuario con ese email' })

    let business
    try {
      const requestedAccountAdminId = auth.user.role === 'ACCOUNT_ADMIN'
        ? auth.user.id
        : body.accountAdminId?.trim() || null
      if (requestedAccountAdminId) {
        const accountAdmin = await prisma.user.findFirst({
          where: { id: requestedAccountAdminId, role: 'ACCOUNT_ADMIN', isActive: true },
          select: { id: true }
        })
        if (!accountAdmin) return reply.status(400).send({ message: 'El administrador de cuentas no es valido' })
      }
      business = await businessService.create(businessName, undefined, {
        accountAdminId: requestedAccountAdminId,
        createdByUserId: auth.user.id
      })
    } catch {
      return reply.status(400).send({ message: 'No pude generar el subdominio para ese comercio' })
    }
    const user = await prisma.user.create({
      data: {
        email: adminEmail,
        name: adminName,
        passwordHash: await hashPassword(adminPassword),
        role: 'BUSINESS_ADMIN',
        businessId: business.id
      }
    })

    return {
      business,
      user: publicUser(user)
    }
  })

  app.get('/admin/account-admins', async (request, reply) => {
    const auth = await getAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion' })
    if (auth.user.role !== 'SUPER_ADMIN') return reply.status(403).send({ message: 'Solo el super admin puede administrar este rol' })

    return prisma.user.findMany({
      where: { role: 'ACCOUNT_ADMIN' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        canCreateBusinesses: true,
        _count: { select: { managedBusinesses: true } }
      },
      orderBy: { name: 'asc' }
    })
  })

  app.get('/admin/account-admin-candidates', async (request, reply) => {
    const auth = await getAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion' })
    if (auth.user.role !== 'SUPER_ADMIN') return reply.status(403).send({ message: 'Solo el super admin puede administrar este rol' })

    return prisma.user.findMany({
      where: { role: 'BUSINESS_ADMIN', isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        businessId: true,
        business: { select: { id: true, name: true } }
      },
      orderBy: { name: 'asc' }
    })
  })

  app.post('/admin/account-admins/assign', async (request, reply) => {
    const auth = await getAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion' })
    if (auth.user.role !== 'SUPER_ADMIN') return reply.status(403).send({ message: 'Solo el super admin puede administrar este rol' })
    const body = request.body as { userId?: string }
    const userId = body.userId?.trim()
    if (!userId) return reply.status(400).send({ message: 'Selecciona una cuenta existente' })
    const current = await prisma.user.findFirst({ where: { id: userId, role: 'BUSINESS_ADMIN', isActive: true } })
    if (!current) return reply.status(404).send({ message: 'La cuenta elegida no esta disponible para este rol' })

    const user = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id: current.id },
        data: { role: 'ACCOUNT_ADMIN', canCreateBusinesses: true }
      })
      if (current.businessId) {
        await transaction.business.update({
          where: { id: current.businessId },
          data: { accountAdminId: current.id }
        })
      }
      return updated
    })
    return publicUser(user)
  })

  app.patch('/admin/account-admins/:id', async (request, reply) => {
    const auth = await getAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion' })
    if (auth.user.role !== 'SUPER_ADMIN') return reply.status(403).send({ message: 'Solo el super admin puede administrar este rol' })
    const params = request.params as { id: string }
    const body = request.body as {
      name?: string
      email?: string
      password?: string
      isActive?: boolean
      canCreateBusinesses?: boolean
    }
    const current = await prisma.user.findFirst({ where: { id: params.id, role: 'ACCOUNT_ADMIN' } })
    if (!current) return reply.status(404).send({ message: 'No encontre ese administrador de cuentas' })
    const name = body.name === undefined ? undefined : body.name.trim()
    const email = body.email === undefined ? undefined : body.email.trim().toLowerCase()
    const password = body.password?.trim()
    if (name === '' || email === '') return reply.status(400).send({ message: 'Nombre y email no pueden quedar vacios' })
    if (password !== undefined && password.length < 8) return reply.status(400).send({ message: 'La contrasena debe tener al menos 8 caracteres' })
    if (email && email !== current.email && await prisma.user.findUnique({ where: { email } })) {
      return reply.status(409).send({ message: 'Ya existe un usuario con ese email' })
    }

    const user = await prisma.user.update({
      where: { id: current.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(password !== undefined ? { passwordHash: await hashPassword(password) } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.canCreateBusinesses !== undefined ? { canCreateBusinesses: body.canCreateBusinesses } : {})
      }
    })
    return publicUser(user)
  })
}

function publicUser(user: {
  id: string
  email: string
  name: string
  role: 'SUPER_ADMIN' | 'ACCOUNT_ADMIN' | 'BUSINESS_ADMIN' | 'STAFF'
  businessId: string | null
  professionalId?: string | null
  professional?: { id: string; name: string } | null
  canCreateAppointments?: boolean
  canEditAppointments?: boolean
  canCancelAppointments?: boolean
  canManageScheduleBlocks?: boolean
  staffProfile?: string
  permissionPreset?: string
  agendaScope?: string
  canForceAppointments?: boolean
  canViewCustomers?: boolean
  canCreateCustomers?: boolean
  canEditCustomers?: boolean
  canManageCustomerNotes?: boolean
  canManageCustomerMarketing?: boolean
  canViewConversations?: boolean
  canReplyConversations?: boolean
  canManageDeposits?: boolean
  canViewOperationalReports?: boolean
  canViewFinancialAmounts?: boolean
  canCreateBusinesses?: boolean
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    businessId: user.businessId,
    professionalId: user.professionalId ?? null,
    professional: user.professional ?? null,
    staffProfile: user.role === 'STAFF' ? user.staffProfile || 'PROFESSIONAL' : null,
    permissionPreset: user.role === 'STAFF' ? user.permissionPreset || 'PROFESSIONAL_DEFAULT' : null,
    agendaScope: user.role === 'STAFF' && user.agendaScope === 'ALL' ? 'ALL' : 'OWN',
    canCreateAppointments: user.role === 'STAFF' ? user.canCreateAppointments !== false : true,
    canEditAppointments: user.role === 'STAFF' ? user.canEditAppointments !== false : true,
    canCancelAppointments: user.role === 'STAFF' ? user.canCancelAppointments !== false : true,
    canManageScheduleBlocks: user.role === 'STAFF' ? user.canManageScheduleBlocks !== false : true,
    canForceAppointments: user.role === 'STAFF' ? user.canForceAppointments === true : true,
    canViewCustomers: user.role === 'STAFF' ? user.canViewCustomers === true : true,
    canCreateCustomers: user.role === 'STAFF' ? user.canCreateCustomers === true : true,
    canEditCustomers: user.role === 'STAFF' ? user.canEditCustomers === true : true,
    canManageCustomerNotes: user.role === 'STAFF' ? user.canManageCustomerNotes === true : true,
    canManageCustomerMarketing: user.role === 'STAFF' ? user.canManageCustomerMarketing === true : true,
    canViewConversations: user.role === 'STAFF' ? user.canViewConversations === true : true,
    canReplyConversations: user.role === 'STAFF' ? user.canReplyConversations === true : true,
    canManageDeposits: user.role === 'STAFF' ? user.canManageDeposits === true : true,
    canViewOperationalReports: user.role === 'STAFF' ? user.canViewOperationalReports === true : true,
    canViewFinancialAmounts: user.role === 'STAFF' ? user.canViewFinancialAmounts === true : true,
    canCreateBusinesses: user.role === 'SUPER_ADMIN' || user.role === 'ACCOUNT_ADMIN' && user.canCreateBusinesses === true
  }
}

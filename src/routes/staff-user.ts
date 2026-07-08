import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { hashPassword } from '../services/auth-service.js'

export async function staffUserRoutes(app: FastifyInstance) {
  app.get('/staff-users', async (request, reply) => {
    if (!canManageStaffUsers(request.auth)) {
      return reply.status(403).send({ message: 'No tenes permiso para administrar usuarios staff' })
    }

    const businessId = resolveBusinessId(request)
    if (!businessId) return reply.status(400).send({ message: 'Selecciona un comercio' })

    return listStaffUsers(businessId)
  })

  app.post('/staff-users', async (request, reply) => {
    if (!canManageStaffUsers(request.auth)) {
      return reply.status(403).send({ message: 'No tenes permiso para administrar usuarios staff' })
    }

    const body = request.body as {
      businessId?: string
      name?: string
      email?: string
      password?: string
      professionalId?: string
      isActive?: boolean
      canCreateAppointments?: boolean
      canEditAppointments?: boolean
      canCancelAppointments?: boolean
      canManageScheduleBlocks?: boolean
    }
    const businessId = resolveBusinessId(request, body.businessId)
    if (!businessId) return reply.status(400).send({ message: 'Selecciona un comercio' })

    const validation = await validateStaffPayload({
      businessId,
      name: body.name,
      email: body.email,
      password: body.password,
      professionalId: body.professionalId,
      requirePassword: true
    })
    if (!validation.ok) return reply.status(validation.statusCode).send({ message: validation.message })

    const existing = await prisma.user.findUnique({ where: { email: validation.email } })
    if (existing) return reply.status(409).send({ message: 'Ya existe un usuario con ese email' })

    await prisma.user.create({
      data: {
        name: validation.name,
        email: validation.email,
        passwordHash: await hashPassword(validation.password),
        role: 'STAFF',
        businessId,
        professionalId: validation.professionalId,
        isActive: body.isActive === false ? false : true,
        canCreateAppointments: body.canCreateAppointments !== false,
        canEditAppointments: body.canEditAppointments !== false,
        canCancelAppointments: body.canCancelAppointments !== false,
        canManageScheduleBlocks: body.canManageScheduleBlocks !== false
      }
    })

    return listStaffUsers(businessId)
  })

  app.patch('/staff-users/:id', async (request, reply) => {
    if (!canManageStaffUsers(request.auth)) {
      return reply.status(403).send({ message: 'No tenes permiso para administrar usuarios staff' })
    }

    const params = request.params as { id: string }
    const body = request.body as {
      name?: string
      email?: string
      password?: string
      professionalId?: string
      isActive?: boolean
      canCreateAppointments?: boolean
      canEditAppointments?: boolean
      canCancelAppointments?: boolean
      canManageScheduleBlocks?: boolean
    }

    const existing = await prisma.user.findFirst({
      where: {
        id: params.id,
        role: 'STAFF'
      }
    })
    if (!existing) return reply.status(404).send({ message: 'No encontre esa cuenta staff' })
    if (!canAccessBusiness(request.auth, existing.businessId)) {
      return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    }
    if (!existing.businessId) return reply.status(400).send({ message: 'La cuenta staff no tiene comercio asignado' })

    const validation = await validateStaffPayload({
      businessId: existing.businessId,
      name: body.name ?? existing.name,
      email: body.email ?? existing.email,
      password: body.password,
      professionalId: body.professionalId ?? existing.professionalId ?? undefined,
      requirePassword: false
    })
    if (!validation.ok) return reply.status(validation.statusCode).send({ message: validation.message })

    const duplicate = await prisma.user.findFirst({
      where: {
        email: validation.email,
        id: { not: existing.id }
      }
    })
    if (duplicate) return reply.status(409).send({ message: 'Ya existe un usuario con ese email' })

    const passwordChanged = Boolean(validation.password)
    const isActiveChanged = typeof body.isActive === 'boolean' && body.isActive !== existing.isActive

    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: validation.name,
        email: validation.email,
        professionalId: validation.professionalId,
        ...(typeof body.canCreateAppointments === 'boolean' ? { canCreateAppointments: body.canCreateAppointments } : {}),
        ...(typeof body.canEditAppointments === 'boolean' ? { canEditAppointments: body.canEditAppointments } : {}),
        ...(typeof body.canCancelAppointments === 'boolean' ? { canCancelAppointments: body.canCancelAppointments } : {}),
        ...(typeof body.canManageScheduleBlocks === 'boolean' ? { canManageScheduleBlocks: body.canManageScheduleBlocks } : {}),
        ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
        ...(passwordChanged ? { passwordHash: await hashPassword(validation.password) } : {})
      }
    })

    if (passwordChanged || isActiveChanged) {
      await prisma.userSession.deleteMany({ where: { userId: existing.id } })
    }

    return listStaffUsers(existing.businessId)
  })

  app.delete('/staff-users/:id', async (request, reply) => {
    if (!canManageStaffUsers(request.auth)) {
      return reply.status(403).send({ message: 'No tenes permiso para administrar usuarios staff' })
    }

    const params = request.params as { id: string }
    const existing = await prisma.user.findFirst({
      where: {
        id: params.id,
        role: 'STAFF'
      }
    })
    if (!existing) return reply.status(404).send({ message: 'No encontre esa cuenta staff' })
    if (!canAccessBusiness(request.auth, existing.businessId)) {
      return reply.status(403).send({ message: 'No tenes acceso a ese comercio' })
    }
    if (!existing.businessId) return reply.status(400).send({ message: 'La cuenta staff no tiene comercio asignado' })

    await prisma.user.delete({ where: { id: existing.id } })
    return listStaffUsers(existing.businessId)
  })
}

async function listStaffUsers(businessId: string) {
  const users = await prisma.user.findMany({
    where: {
      businessId,
      role: 'STAFF'
    },
    include: {
      professional: {
        select: {
          id: true,
          name: true,
          isActive: true
        }
      }
    },
    orderBy: {
      createdAt: 'asc'
    }
  })

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    businessId: user.businessId,
    professionalId: user.professionalId,
    professional: user.professional,
    canCreateAppointments: user.canCreateAppointments,
    canEditAppointments: user.canEditAppointments,
    canCancelAppointments: user.canCancelAppointments,
    canManageScheduleBlocks: user.canManageScheduleBlocks,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  }))
}

async function validateStaffPayload(input: {
  businessId: string
  name?: string | undefined
  email?: string | undefined
  password?: string | undefined
  professionalId?: string | null | undefined
  requirePassword: boolean
}) {
  const name = input.name?.trim()
  const email = input.email?.trim().toLowerCase()
  const password = input.password?.trim() || ''
  const professionalId = input.professionalId?.trim()

  if (!name) return { ok: false as const, statusCode: 400, message: 'Completa el nombre del staff' }
  if (!email) return { ok: false as const, statusCode: 400, message: 'Completa el email de acceso' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, statusCode: 400, message: 'El email de acceso no es valido' }
  }
  if (input.requirePassword && !password) {
    return { ok: false as const, statusCode: 400, message: 'Completa la contrasena inicial' }
  }
  if (password && password.length < 8) {
    return { ok: false as const, statusCode: 400, message: 'La contrasena debe tener al menos 8 caracteres' }
  }
  if (!professionalId) {
    return { ok: false as const, statusCode: 400, message: 'Asignale un profesional a la cuenta' }
  }

  const professional = await prisma.professional.findFirst({
    where: {
      id: professionalId,
      businessId: input.businessId
    },
    select: {
      id: true
    }
  })
  if (!professional) return { ok: false as const, statusCode: 400, message: 'Ese profesional no pertenece al comercio' }

  return {
    ok: true as const,
    name,
    email,
    password,
    professionalId
  }
}

function resolveBusinessId(request: { auth?: { user: { role: string; businessId: string | null } }, query?: unknown }, explicitBusinessId?: string) {
  if (request.auth?.user.role !== 'SUPER_ADMIN') return request.auth?.user.businessId || null
  const query = request.query as { businessId?: string } | undefined
  return explicitBusinessId?.trim() || query?.businessId?.trim() || null
}

function canManageStaffUsers(auth: { user: { role: string; businessId: string | null } } | undefined) {
  return auth?.user.role === 'SUPER_ADMIN' || auth?.user.role === 'BUSINESS_ADMIN'
}

function canAccessBusiness(auth: { user: { role: string; businessId: string | null } } | undefined, businessId?: string | null) {
  if (!auth || !businessId) return false
  if (auth.user.role === 'SUPER_ADMIN') return true
  return auth.user.businessId === businessId
}

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
      include: { business: true }
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
      include: { business: true }
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
    if (auth.user.role !== 'SUPER_ADMIN') return reply.status(403).send({ message: 'Solo el super admin puede crear comercios' })

    const body = request.body as {
      businessName?: string
      adminName?: string
      adminEmail?: string
      adminPassword?: string
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

    const business = await businessService.create(businessName)
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
}

function publicUser(user: {
  id: string
  email: string
  name: string
  role: 'SUPER_ADMIN' | 'BUSINESS_ADMIN' | 'STAFF'
  businessId: string | null
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    businessId: user.businessId
  }
}

import type { FastifyInstance } from 'fastify'
import { prisma } from '../config/prisma.js'
import { inferDefaultAreaCodeFromPhone } from '../services/phone-normalization-service.js'
import {
  buildExpiredWeexSessionCookie,
  buildWeexSessionCookie,
  destroyWeexSessionFromRequest,
  getWeexAppointmentsForBusiness,
  getWeexAuthFromRequest,
  signInWithGoogleCredential,
  updateWeexPhone,
  weexGoogleClientId
} from '../services/weex-account-service.js'

export async function weexAccountRoutes(app: FastifyInstance) {
  app.get('/public/weex/config', async () => ({
    googleClientId: weexGoogleClientId()
  }))

  app.post('/public/weex/auth/google', async (request, reply) => {
    const body = request.body as { credential?: string }
    const credential = body.credential?.trim()
    if (!credential) return reply.status(400).send({ message: 'Falta la credencial de Google' })

    try {
      const result = await signInWithGoogleCredential(credential)
      reply.header('Set-Cookie', buildWeexSessionCookie(result.session.token, result.session.expiresAt))
      return {
        account: result.account
      }
    } catch (error) {
      return reply.status(401).send({
        message: error instanceof Error ? error.message : 'No pudimos validar la cuenta de Google'
      })
    }
  })

  app.get('/public/weex/me', async (request, reply) => {
    const auth = await getWeexAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion con Google' })

    return {
      account: auth.account
    }
  })

  app.post('/public/weex/profile/phone', async (request, reply) => {
    const auth = await getWeexAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion con Google' })

    const body = request.body as { phone?: string; businessSlug?: string }
    const business = body.businessSlug
      ? await prisma.business.findUnique({
          where: {
            slug: body.businessSlug.trim()
          },
          select: {
            publicWhatsapp: true
          }
        })
      : null
    const result = await updateWeexPhone(auth.account.id, body.phone || '', inferDefaultAreaCodeFromPhone(business?.publicWhatsapp))
    if (!result.ok) return reply.status(400).send({ message: result.message })

    return {
      account: result.account,
      linkedCount: result.linkedCount
    }
  })

  app.get('/public/weex/appointments', async (request, reply) => {
    const auth = await getWeexAuthFromRequest(request)
    if (!auth) return reply.status(401).send({ message: 'Necesitas iniciar sesion con Google' })

    const query = request.query as { businessSlug?: string; limit?: string }
    const result = await getWeexAppointmentsForBusiness(auth.account.id, query.businessSlug?.trim(), Number(query.limit || 5))

    return result
  })

  app.post('/public/weex/logout', async (request, reply) => {
    await destroyWeexSessionFromRequest(request)
    reply.header('Set-Cookie', buildExpiredWeexSessionCookie())
    return { ok: true }
  })
}

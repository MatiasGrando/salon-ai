import { timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { createAuthoritativeWebhookAdmission } from '../bot-options/application/admit-provider-events.js'
import type { AuthoritativeAdmissionRepository } from '../bot-options/infrastructure/prisma-admission.js'
import type { BotOptionsConfig } from '../config/bot-options.js'
import { META_WEBHOOK_BODY_LIMIT } from '../plugins/meta-raw-body.js'
import { whatsappWebhookRoutes } from '../routes/whatsapp-webhook.js'

export const BARBER_DEMO_BUSINESS_ID = 'cmpvr0oqo0000o0vcnhgyv054'

/** The local process must never admit another WABA or fall back to the legacy handler. */
export function barberOnlyRepository(repository: AuthoritativeAdmissionRepository, onCommitted?: () => void): AuthoritativeAdmissionRepository {
  return {
    async resolveRoute(phoneNumberId) {
      const route = await repository.resolveRoute(phoneNumberId)
      return route.kind === 'new' && route.businessId === BARBER_DEMO_BUSINESS_ID
        ? route
        : { kind: 'ambiguous' }
    },
    async admitAuthoritative(input) {
      if (input.route.businessId !== BARBER_DEMO_BUSINESS_ID
        || input.events.some((event) => event.kind !== 'unsupported_change' && event.phoneNumberId !== input.phoneNumberId)) {
        throw new Error('non-Barber local admission denied')
      }
      const result = await repository.admitAuthoritative(input)
      if (result.insertedCount > 0) {
        try { onCommitted?.() } catch { /* durable polling recovers a lost hint */ }
      }
      return result
    }
  }
}

function tokenMatches(expected: string, received: string | undefined): boolean {
  if (!received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

const ingressConfig: BotOptionsConfig = {
  shadowAdmissionEnabled: false,
  authoritativeProcessingEnabled: true,
  workersEnabled: false,
  senderEnabled: false,
  bookingCapabilityEnabled: false,
  depositsCapabilityEnabled: false,
  appointmentManagementCapabilityEnabled: false,
  handoffCapabilityEnabled: false,
  legacyDispatchCoverageComplete: true
}

export async function createBarberWebhookApps(input: {
  repository: AuthoritativeAdmissionRepository
  verifyToken: string
  onAdmissionCommitted?: () => void
}): Promise<{ internal: FastifyInstance; gateway: FastifyInstance }> {
  if (!input.verifyToken.trim()) throw new Error('Barber webhook verify token required')
  const internal = Fastify({ bodyLimit: META_WEBHOOK_BODY_LIMIT })
  await internal.register(whatsappWebhookRoutes, {
    botOptionsConfig: ingressConfig,
    authoritativeAdmission: createAuthoritativeWebhookAdmission(barberOnlyRepository(input.repository, input.onAdmissionCommitted)),
    legacyWebhookService: {
      verifyWebhook: ({ mode, token, challenge }: { mode: string | undefined; token: string | undefined; challenge: string | undefined }) => ({
        verified: mode === 'subscribe' && Boolean(challenge) && tokenMatches(input.verifyToken, token),
        ...(challenge ? { challenge } : {})
      }),
      async handleWebhook() { throw new Error('legacy local webhook is disabled') }
    }
  })
  const gateway = Fastify({ bodyLimit: META_WEBHOOK_BODY_LIMIT })
  gateway.removeContentTypeParser('application/json')
  gateway.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: META_WEBHOOK_BODY_LIMIT },
    (_request, body, done) => done(null, body))
  gateway.addHook('onRequest', async (request, reply) => {
    const path = (request.raw.url ?? '').split('?', 1)[0]
    if (path !== '/webhooks/whatsapp') return reply.code(404).send({ message: 'Not found' })
    if (request.method !== 'GET' && request.method !== 'POST') return reply.code(405).send({ message: 'Method not allowed' })
  })
  gateway.all('/webhooks/whatsapp', async (request, reply) => {
    const method = request.method as 'GET' | 'POST'
    const response = await internal.inject({
      method,
      url: request.raw.url ?? '/webhooks/whatsapp',
      headers: request.headers,
      ...(method === 'POST' ? { payload: request.body as Buffer } : {})
    })
    const contentType = response.headers['content-type']
    if (typeof contentType === 'string') reply.header('content-type', contentType)
    return reply.code(response.statusCode).send(response.rawPayload)
  })
  return { internal, gateway }
}

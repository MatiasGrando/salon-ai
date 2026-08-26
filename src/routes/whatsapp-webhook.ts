import type { FastifyInstance } from 'fastify'
import type { BotOptionsConfig } from '../config/bot-options.js'
import type { ProviderEventAdmission } from '../bot-options/application/admit-provider-events.js'
import { installWhatsAppRawBodyParser } from '../plugins/whatsapp-raw-body.js'

export type WhatsAppWebhookServiceContract = {
  verifyWebhook(input: {
    mode: string | undefined
    token: string | undefined
    challenge: string | undefined
  }): { verified: boolean; challenge?: string }
  handleWebhook(payload: unknown): Promise<unknown>
}

export type WhatsAppWebhookRouteOptions = {
  botOptionsConfig?: BotOptionsConfig
  shadowAdmission?: ProviderEventAdmission
  legacyWebhookService?: WhatsAppWebhookServiceContract
}

const MAX_SHADOW_ADMISSIONS_IN_FLIGHT = 8

async function productionLegacyService(): Promise<WhatsAppWebhookServiceContract> {
  // Keep injected route contracts from loading the legacy database dependency graph.
  const legacyServiceModule: string = '../services/whatsapp-webhook-service.js'
  const { WhatsAppWebhookService } = await import(legacyServiceModule) as {
    WhatsAppWebhookService: new () => WhatsAppWebhookServiceContract
  }
  return new WhatsAppWebhookService()
}

export async function whatsappWebhookRoutes(
  app: FastifyInstance,
  options: WhatsAppWebhookRouteOptions = {}
) {
  const shadowEnabled = options.botOptionsConfig?.shadowAdmissionEnabled === true
  if (shadowEnabled) installWhatsAppRawBodyParser(app)
  const service = options.legacyWebhookService ?? await productionLegacyService()
  let shadowAdmissionsInFlight = 0

  function startShadowAdmission(request: {
    whatsappRawBody: Buffer | null
    headers: Record<string, string | string[] | undefined>
    id: string
    log: { warn(bindings: object, message: string): void }
  }) {
    if (!options.shadowAdmission || !request.whatsappRawBody) return
    if (shadowAdmissionsInFlight >= MAX_SHADOW_ADMISSIONS_IN_FLIGHT) {
      request.log.warn(
        { traceId: request.id, inFlight: shadowAdmissionsInFlight },
        'Shadow admission skipped because the bounded queue is full'
      )
      return
    }

    shadowAdmissionsInFlight += 1
    void options.shadowAdmission.admit({
      rawBody: request.whatsappRawBody,
      signatureHeader: request.headers['x-hub-signature-256'],
      traceId: request.id
    }).catch((error: unknown) => {
      request.log.warn({ err: error, traceId: request.id }, 'Shadow admission failed open')
    }).finally(() => {
      shadowAdmissionsInFlight -= 1
    })
  }

  app.get('/webhooks/whatsapp', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>

    const result = service.verifyWebhook({
      mode: query['hub.mode'],
      token: query['hub.verify_token'],
      challenge: query['hub.challenge']
    })

    if (!result.verified) {
      return reply.status(403).send({
        message: 'Token de verificacion invalido'
      })
    }

    return reply.status(200).send(result.challenge)
  })

  app.post('/webhooks/whatsapp', async (request) => {
    if (shadowEnabled) startShadowAdmission(request)

    return service.handleWebhook(request.body)
  })
}

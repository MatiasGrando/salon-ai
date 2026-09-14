import type { FastifyInstance } from 'fastify'
import { verifyMetaSignature } from '../bot-options/infrastructure/meta-webhook-adapter.js'
import { instagramConfig } from '../config/instagram.js'
import { installInstagramRawBodyParser } from '../plugins/meta-raw-body.js'
import { parseInstagramWebhookPayload } from '../services/instagram-webhook-parser.js'

export type InstagramWebhookServiceContract = {
  verifyWebhook(input: {
    mode: string | undefined
    token: string | undefined
    challenge: string | undefined
  }): { verified: boolean; challenge?: string }
  handleWebhook(payload: unknown): Promise<unknown>
}

export type InstagramCommentIngressContract = {
  ingest(payload: unknown): Promise<unknown>
}

export type InstagramWebhookRouteOptions = {
  appSecret?: string | null
  appSecretResolver?: InstagramAppSecretResolver
  commentsRuntimeReady?: boolean
  commentIngress?: InstagramCommentIngressContract
  legacyWebhookService?: InstagramWebhookServiceContract
  allowedBusinessIds?: readonly string[]
}

export type InstagramAppSecretResolution =
  | { status: 'resolved'; appSecret: string }
  | { status: 'not_found' | 'missing_secret' | 'ambiguous' }

export type InstagramAppSecretResolver = {
  resolve(input: { instagramAccountIds: string[] }): Promise<InstagramAppSecretResolution>
}

async function productionDependencies(allowedBusinessIds?: readonly string[]) {
  const [{ InstagramWebhookService }, { InstagramCommentIngressService, PrismaInstagramCommentIngressStore }, { prisma }] = await Promise.all([
    import('../services/instagram-webhook-service.js'),
    import('../services/instagram-comment-ingress-service.js'),
    import('../config/prisma.js')
  ])
  return {
    legacyWebhookService: new InstagramWebhookService() as InstagramWebhookServiceContract,
    commentIngress: new InstagramCommentIngressService(
      new PrismaInstagramCommentIngressStore(
        prisma as unknown as ConstructorParameters<typeof PrismaInstagramCommentIngressStore>[0],
        allowedBusinessIds
      )
    ) as InstagramCommentIngressContract,
    appSecretResolver: new PrismaInstagramAppSecretResolver(prisma as unknown as InstagramSecretPrisma)
  }
}

type InstagramSecretPrisma = {
  businessInstagramConfig: {
    findMany(input: unknown): Promise<Array<{ appSecret: string | null }>>
  }
}

export class PrismaInstagramAppSecretResolver implements InstagramAppSecretResolver {
  constructor(private readonly database: InstagramSecretPrisma) {}

  async resolve(input: { instagramAccountIds: string[] }): Promise<InstagramAppSecretResolution> {
    const accountIds = [...new Set(input.instagramAccountIds.map((value) => value.trim()).filter(Boolean))]
    if (!accountIds.length) return { status: 'not_found' }
    const configurations = await this.database.businessInstagramConfig.findMany({
      where: {
        OR: [
          { instagramAccountId: { in: accountIds } },
          { apiAccountId: { in: accountIds } }
        ]
      },
      select: { appSecret: true }
    })
    if (!configurations.length) return { status: 'not_found' }
    const secrets = [...new Set(configurations.map((row) => row.appSecret?.trim()).filter((value): value is string => Boolean(value)))]
    if (!secrets.length) return { status: 'missing_secret' }
    if (secrets.length !== 1) return { status: 'ambiguous' }
    return { status: 'resolved', appSecret: secrets[0]! }
  }
}

export async function instagramWebhookRoutes(
  app: FastifyInstance,
  options: InstagramWebhookRouteOptions = {}
) {
  installInstagramRawBodyParser(app)
  const production = options.legacyWebhookService && options.commentIngress
    ? null
    : await productionDependencies(options.allowedBusinessIds)
  const service = options.legacyWebhookService ?? production!.legacyWebhookService
  const commentIngress = options.commentIngress ?? production!.commentIngress
  const appSecretResolver = options.appSecretResolver ?? production?.appSecretResolver

  app.get('/webhooks/instagram', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>
    const result = service.verifyWebhook({
      mode: query['hub.mode'],
      token: query['hub.verify_token'],
      challenge: query['hub.challenge']
    })
    if (!result.verified) return reply.status(403).send({ message: 'Token de verificacion invalido' })
    return reply.status(200).send(result.challenge)
  })

  app.post('/webhooks/instagram', async (request, reply) => {
    const rawBody = request.instagramRawBody
    if (!rawBody) return reply.status(400).send({ message: 'Cuerpo del webhook invalido' })

    const parsed = parseInstagramWebhookPayload(request.body)
    if (parsed.comments.length > 0 && options.commentsRuntimeReady !== true) {
      return reply.status(503).send({ message: 'Automatizaciones de comentarios de Instagram no disponibles' })
    }
    const accountIds = [...new Set([
      ...parsed.comments.flatMap((event) => event.instagramAccountIds),
      ...parsed.messaging.flatMap((event) => event.instagramAccountIds)
    ])]
    let appSecret = options.appSecret === undefined ? null : options.appSecret?.trim() || null
    if (options.appSecret === undefined && appSecretResolver) {
      const resolution = await appSecretResolver.resolve({ instagramAccountIds: accountIds })
      if (resolution.status === 'resolved') appSecret = resolution.appSecret
      else if (
        resolution.status === 'missing_secret'
        && options.appSecretResolver === undefined
        && instagramConfig.appSecret
      ) appSecret = instagramConfig.appSecret
      else return reply.status(503).send({ message: 'No se pudo resolver una clave privada unica para Instagram' })
    } else if (options.appSecret === undefined) {
      appSecret = instagramConfig.appSecret
    }
    if (appSecret) {
      const signature = verifyMetaSignature({
        rawBody,
        signatureHeader: request.headers['x-hub-signature-256'],
        appSecret
      })
      if (!signature.ok) return reply.status(403).send({ message: 'Firma de Meta invalida' })
    } else if (parsed.comments.length > 0) {
      // Comment automation must never admit unauthenticated public events.
      return reply.status(503).send({ message: 'Firma de Instagram no configurada' })
    }

    try {
      // Durable comment ingress comes first. A 200 response is only emitted
      // after every matching comment has either been inserted or deduplicated.
      await commentIngress.ingest(request.body)
      const legacyResult = await service.handleWebhook(request.body)
      return reply.status(200).send(legacyResult)
    } catch (error) {
      request.log.error(error, 'Instagram webhook fallo antes del resultado durable')
      return reply.status(503).send({ message: 'Procesamiento de Instagram no disponible; reintentar' })
    }
  })
}

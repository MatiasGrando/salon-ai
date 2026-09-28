import type { FastifyPluginAsync } from 'fastify'
import { parseWhatsAppWebhookPayload, verifyMetaSignature } from '../../bot-options/infrastructure/meta-webhook-adapter.js'
import { ingestNewBotEvent, type NewBotIngressStore, type TrustedIngressContext } from '../application/ingress.js'

export interface TrustedWhatsAppWebhookConfiguration extends TrustedIngressContext {
  readonly phoneNumberId: string
  readonly appSecret: string
  readonly enabled: boolean
}

export interface NewBotWhatsAppWebhookOptions {
  readonly path?: string
  readonly maxBodyBytes?: number
  readonly resolveConfiguration: (untrustedPhoneNumberId: string) => Promise<TrustedWhatsAppWebhookConfiguration | null>
  readonly store: NewBotIngressStore
}

type UnknownRecord = Record<string, unknown>

const MAX_WEBHOOK_ENTRIES = 10
const MAX_WEBHOOK_CHANGES = 100
const MAX_WEBHOOK_PHONE_NUMBERS = 10
const MAX_WEBHOOK_MESSAGES = 100

type RoutingCandidates =
  | { readonly ok: true; readonly payload: unknown; readonly phoneNumberIds: readonly string[] }
  | { readonly ok: false; readonly reason: 'malformed' | 'limit' }

type EnvelopeValidation =
  | { readonly ok: true; readonly messageCount: number }
  | { readonly ok: false; readonly kind: 'malformed' | 'unsupported' }

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeJson(rawBody: Buffer): unknown | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Read bounded untrusted routing/count candidates only; never truncate or normalize a batch. */
function extractRoutingCandidates(payload: unknown): RoutingCandidates {
  if (!isRecord(payload) || !Array.isArray(payload['entry']) || payload['entry'].length === 0) return { ok: false, reason: 'malformed' }
  const entries = payload['entry']
  if (entries.length > MAX_WEBHOOK_ENTRIES) return { ok: false, reason: 'limit' }

  const phoneNumberIds = new Set<string>()
  let changeCount = 0
  let messageCount = 0
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry['changes']) || entry['changes'].length === 0) return { ok: false, reason: 'malformed' }
    const changes = entry['changes']
    if (changes.length > MAX_WEBHOOK_CHANGES - changeCount) return { ok: false, reason: 'limit' }
    changeCount += changes.length
    for (const change of changes) {
      if (!isRecord(change) || !isRecord(change['value'])) return { ok: false, reason: 'malformed' }
      const value = change['value']
      const metadata = value['metadata']
      if (!isRecord(metadata)) return { ok: false, reason: 'malformed' }
      const phoneNumberId = metadata['phone_number_id']
      if (typeof phoneNumberId !== 'string' || phoneNumberId.trim().length === 0 || phoneNumberId.length > 256) return { ok: false, reason: 'malformed' }
      phoneNumberIds.add(phoneNumberId)
      if (phoneNumberIds.size > MAX_WEBHOOK_PHONE_NUMBERS) return { ok: false, reason: 'limit' }
      const messages = value['messages']
      if (Array.isArray(messages)) {
        if (messages.length > MAX_WEBHOOK_MESSAGES - messageCount) return { ok: false, reason: 'limit' }
        messageCount += messages.length
      }
    }
  }
  return { ok: true, payload, phoneNumberIds: [...phoneNumberIds] }
}
/** Validate delivery structure only after every target has independently authenticated. */
function validateMessageEnvelope(payload: unknown): EnvelopeValidation {
  if (!isRecord(payload) || payload['object'] !== 'whatsapp_business_account' || !Array.isArray(payload['entry']) || payload['entry'].length === 0) {
    return { ok: false, kind: 'malformed' }
  }
  let messageCount = 0
  for (const entry of payload['entry']) {
    if (!isRecord(entry) || !Array.isArray(entry['changes']) || entry['changes'].length === 0) return { ok: false, kind: 'malformed' }
    for (const change of entry['changes']) {
      if (!isRecord(change)) return { ok: false, kind: 'malformed' }
      if (change['field'] !== 'messages') return { ok: false, kind: 'unsupported' }
      const value = change['value']
      if (!isRecord(value)) return { ok: false, kind: 'malformed' }
      if (value['messaging_product'] !== 'whatsapp') return { ok: false, kind: 'unsupported' }
      const metadata = value['metadata']
      if (!isRecord(metadata)) return { ok: false, kind: 'malformed' }
      if (Object.hasOwn(value, 'statuses')) {
        if (!Array.isArray(value['statuses'])) return { ok: false, kind: 'malformed' }
        if (value['statuses'].length > 0) return { ok: false, kind: 'unsupported' }
      }
      const messages = value['messages']
      if (!Array.isArray(messages) || messages.length === 0) return { ok: false, kind: 'unsupported' }
      for (const message of messages) {
        if (!isRecord(message) || typeof message['id'] !== 'string' || message['id'].trim().length === 0 || message['id'].length > 256 ||
            typeof message['from'] !== 'string' || message['from'].trim().length === 0 || message['from'].length > 256 ||
            typeof message['type'] !== 'string') {
          return { ok: false, kind: 'malformed' }
        }
        if (message['type'] === 'text') {
          const text = message['text']
          if (!isRecord(text) || typeof text['body'] !== 'string' || text['body'].trim().length === 0 || text['body'].length > 4096) {
            return { ok: false, kind: 'malformed' }
          }
        }
        messageCount += 1
      }
    }
  }
  return { ok: true, messageCount }
}
function normalizeMessage(message: {
  readonly messageType: string
  readonly textBody: string | null
  readonly interactiveReplyId: string | null
}): { readonly kind: 'text'; readonly text: string } | { readonly kind: 'selection'; readonly selectionId: string } | { readonly kind: 'unsupported' } {
  if (message.messageType === 'text' && message.textBody !== null && message.textBody.length <= 4096) {
    return { kind: 'text', text: message.textBody }
  }
  if (message.messageType === 'interactive' && message.interactiveReplyId !== null && message.interactiveReplyId.length <= 256) {
    return { kind: 'selection', selectionId: message.interactiveReplyId }
  }
  return { kind: 'unsupported' }
}

function validConfiguration(
  value: TrustedWhatsAppWebhookConfiguration | null,
  requestedPhoneNumberId: string,
): value is TrustedWhatsAppWebhookConfiguration {
  return value !== null &&
    value.enabled === true &&
    value.phoneNumberId === requestedPhoneNumberId &&
    typeof value.businessId === 'string' && value.businessId.trim().length > 0 && value.businessId.length <= 128 &&
    typeof value.vertical === 'string' && value.vertical.trim().length > 0 && value.vertical.length <= 80 &&
    typeof value.appSecret === 'string' && value.appSecret.trim().length > 0
}

export const newBotWhatsAppWebhookRoutes: FastifyPluginAsync<NewBotWhatsAppWebhookOptions> = async (app, options) => {
  const path = options.path ?? '/webhooks/new-bot/whatsapp'
  const maxBodyBytes = options.maxBodyBytes ?? 256 * 1024
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 1024 * 1024) {
    throw new Error('Invalid new-bot webhook body limit')
  }

  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: maxBodyBytes }, (_request, body, done) => {
    done(null, body)
  })

  app.post<{ Body: Buffer }>(path, async (request, reply) => {
    const rawBody = request.body
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return reply.code(400).send({ error: 'malformed_payload' })
    if (rawBody.length > maxBodyBytes) return reply.code(413).send({ error: 'payload_too_large' })

    const decoded = decodeJson(rawBody)
    if (decoded === null) return reply.code(400).send({ error: 'malformed_payload' })
    const candidates = extractRoutingCandidates(decoded)
    if (!candidates.ok) {
      return candidates.reason === 'limit'
        ? reply.code(413).send({ error: 'payload_batch_too_large' })
        : reply.code(400).send({ error: 'malformed_payload' })
    }

    const signatureHeader = request.headers['x-hub-signature-256']
    if (signatureHeader === undefined) return reply.code(401).send({ error: 'missing_signature' })

    const configurations = new Map<string, TrustedWhatsAppWebhookConfiguration>()
    try {
      for (const phoneNumberId of candidates.phoneNumberIds) {
        const configuration = await options.resolveConfiguration(phoneNumberId)
        if (configuration === null) return reply.code(404).send({ error: 'unknown_phone_number' })
        if (!validConfiguration(configuration, phoneNumberId)) return reply.code(409).send({ error: 'inactive_or_mismatched_phone_number' })
        configurations.set(phoneNumberId, configuration)
      }
    } catch {
      return reply.code(503).send({ error: 'configuration_unavailable' })
    }

    for (const configuration of configurations.values()) {
      const signature = verifyMetaSignature({
        rawBody,
        signatureHeader,
        appSecret: configuration.appSecret,
      })
      if (!signature.ok) return reply.code(403).send({ error: 'invalid_signature' })
    }
    if (new Set([...configurations.values()].map((configuration) => configuration.businessId)).size > 1) {
      return reply.code(422).send({ error: 'cross_tenant_batch_unsupported' })
    }

    const envelope = validateMessageEnvelope(candidates.payload)
    if (!envelope.ok) {
      return reply.code(envelope.kind === 'unsupported' ? 422 : 400).send({ error: envelope.kind === 'unsupported' ? 'unsupported_delivery' : 'malformed_payload' })
    }
    const parsed = parseWhatsAppWebhookPayload(candidates.payload)
    if (parsed.events.length !== envelope.messageCount || parsed.events.some((event) => event.kind !== 'message')) {
      return reply.code(400).send({ error: 'malformed_payload' })
    }

    let accepted = 0
    let duplicate = 0
    try {
      for (const event of parsed.events) {
        if (event.kind !== 'message') return reply.code(400).send({ error: 'malformed_payload' })
        const configuration = configurations.get(event.phoneNumberId ?? '')
        if (!configuration) return reply.code(400).send({ error: 'malformed_payload' })
        const result = await ingestNewBotEvent(
          { businessId: configuration.businessId, vertical: configuration.vertical },
          {
            provider: 'whatsapp',
            providerEventId: event.providerMessageId,
            conversationId: event.fromPhone,
            message: normalizeMessage(event),
          },
          options.store,
        )
        if (result.status === 'rejected') return reply.code(400).send({ error: 'invalid_message' })
        if (result.status === 'accepted') accepted += 1
        if (result.status === 'duplicate') duplicate += 1
      }
    } catch {
      return reply.code(503).send({ error: 'ingress_persistence_unavailable' })
    }

    return reply.code(200).send({ status: 'accepted', accepted, duplicate })
  })
}
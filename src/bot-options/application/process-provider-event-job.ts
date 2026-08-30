import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import {
  collectInboundConversationMessage,
  collectOutboundConversationMessage,
  flushInboundConversationMessages,
  flushOutboundConversationMessages,
  type InboundConversationMessageProjection,
  type OutboundConversationMessageProjection
} from '../../services/crm-realtime-events.js'
import type { ParsedWebhookEvent } from '../infrastructure/meta-webhook-adapter.js'
import {
  PrismaAuthoritativeAdmissionRepository,
  type AuthoritativeRoute
} from '../infrastructure/prisma-admission.js'
import {
  assertClaimedBotJobTx,
  completeClaimedBotJobTx,
  retargetClaimedBotJobTx,
  type ClaimedBotJob
} from '../infrastructure/postgres-worker.js'

type ProviderEventClient = Pick<PrismaClient, '$transaction'>

type ProviderEventRow = {
  id: string
  eventKey: string
  eventType: 'MESSAGE' | 'STATUS' | 'UNSUPPORTED'
  businessId: string
  phoneNumberId: string | null
  providerMessageId: string | null
  payload: Prisma.JsonValue | null
  status: 'ADMITTED' | 'DUPLICATE' | 'UNMATCHED' | 'PROCESSED' | 'REJECTED'
}

type CurrentDeployment = { id: string; generation: number }

const PROCESS_PROVIDER_EVENT_TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 10_000 } as const

function record(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('provider event payload is not an object')
  }
  return value as Record<string, Prisma.JsonValue>
}

function nullableString(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function requiredString(value: Prisma.JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`provider event has invalid ${field}`)
  return value
}

function hydrateProviderEvent(row: ProviderEventRow): ParsedWebhookEvent {
  const payload = record(row.payload)
  if (row.eventType === 'MESSAGE') {
    const messageType = payload['messageType']
    if (
      messageType !== 'text' && messageType !== 'image' && messageType !== 'document'
      && messageType !== 'interactive' && messageType !== 'unsupported'
    ) throw new Error('provider event has invalid messageType')
    if (!row.providerMessageId) throw new Error('message provider event has no providerMessageId')
    const mediaType = payload['mediaType']
    if (mediaType !== null && mediaType !== undefined && mediaType !== 'image' && mediaType !== 'document') {
      throw new Error('provider event has invalid mediaType')
    }
    return {
      kind: 'message',
      eventKey: row.eventKey,
      providerMessageId: row.providerMessageId,
      phoneNumberId: row.phoneNumberId,
      displayPhoneNumber: null,
      fromPhone: requiredString(payload['fromPhone'], 'fromPhone'),
      textBody: nullableString(payload['textBody']),
      messageType,
      interactiveReplyId: nullableString(payload['interactiveReplyId']),
      mediaType: mediaType === 'image' || mediaType === 'document' ? mediaType : null,
      mediaMimeType: nullableString(payload['mediaMimeType']),
      mediaId: nullableString(payload['mediaId']),
      filename: nullableString(payload['filename']),
      providerOccurredAtIso: null
    }
  }
  if (row.eventType === 'STATUS') {
    const status = payload['status']
    if (status !== 'sent' && status !== 'delivered' && status !== 'read' && status !== 'failed' && status !== 'unknown') {
      throw new Error('provider event has invalid status')
    }
    if (!row.providerMessageId) throw new Error('status provider event has no providerMessageId')
    return {
      kind: 'status',
      eventKey: row.eventKey,
      providerMessageId: row.providerMessageId,
      phoneNumberId: row.phoneNumberId,
      status,
      recipientPhone: null,
      providerOccurredAtIso: null,
      errorMessage: nullableString(payload['errorMessage'])
    }
  }
  return { kind: 'unsupported_change', eventKey: row.eventKey }
}

function inboundBody(payload: Record<string, Prisma.JsonValue>): string {
  const text = nullableString(payload['textBody'])?.trim()
  if (text) return text
  return `[${nullableString(payload['messageType']) ?? 'message'}]`
}

export function providerEventInboundMessageMetadata(
  payload: Record<string, Prisma.JsonValue>
): Record<string, unknown> {
  const mediaType = payload['mediaType']
  const mediaId = nullableString(payload['mediaId'])
  const media = (mediaType === 'image' || mediaType === 'document') && mediaId
    ? {
        type: mediaType,
        id: mediaId,
        ...(nullableString(payload['mediaMimeType']) ? { mimeType: nullableString(payload['mediaMimeType']) } : {}),
        ...(mediaType === 'document' && nullableString(payload['filename'])
          ? { filename: nullableString(payload['filename']) }
          : {})
      }
    : null
  return {
    provider: 'whatsapp',
    source: 'bot-options-journal',
    messageType: payload['messageType'] ?? null,
    ...(media ? { media } : {})
  }
}

async function loadProviderEventTx(
  tx: Prisma.TransactionClient,
  job: ClaimedBotJob,
  lock: boolean
): Promise<ProviderEventRow> {
  const lockSql = lock ? Prisma.sql`FOR UPDATE OF e` : Prisma.empty
  const rows = await tx.$queryRaw<ProviderEventRow[]>(Prisma.sql`
    SELECT e."id", e."eventKey", e."eventType"::text AS "eventType", e."businessId", e."phoneNumberId",
      e."providerMessageId", e."payload", e."status"::text AS "status"
    FROM "BotProviderEvent" e
    WHERE e."id" = ${job.aggregateId} AND e."businessId" = ${job.businessId}
    ${lockSql}
  `)
  if (rows.length !== 1) throw new Error('provider event job target not found')
  return rows[0]!
}

async function currentDeploymentTx(
  tx: Prisma.TransactionClient,
  job: ClaimedBotJob
): Promise<CurrentDeployment> {
  const rows = await tx.$queryRaw<CurrentDeployment[]>(Prisma.sql`
    SELECT d."id", d."generation"
    FROM "BotChannelDeployment" d
    WHERE d."businessId" = ${job.businessId} AND d."channel" = 'WHATSAPP'::"BotChannel"
      AND d."engineKey" = 'deterministic-options' AND d."activeConfigurationId" IS NOT NULL
      AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
    FOR UPDATE
  `)
  if (rows.length !== 1) throw new Error('current provider-event deployment unavailable')
  if (rows[0]!.generation < job.deploymentGeneration) {
    throw new Error('provider-event job is ahead of the current deployment')
  }
  return rows[0]!
}

async function projectInboundBeforeClassification(
  client: ProviderEventClient,
  job: ClaimedBotJob
): Promise<InboundConversationMessageProjection[]> {
  return client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, job, { requireCurrentDeployment: false })
    const row = await loadProviderEventTx(tx, job, false)
    if (row.eventType !== 'MESSAGE') return []
    const payload = record(row.payload)
    const phone = requiredString(payload['fromPhone'], 'fromPhone')
    const conversationId = `provider-conversation:${row.id}`
    const conversations = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
      VALUES (${conversationId}, ${phone}, ${row.businessId}, clock_timestamp())
      ON CONFLICT ("businessId", "phone") DO UPDATE SET "updatedAt" = "Conversation"."updatedAt"
      RETURNING "id"
    `)
    if (conversations.length !== 1) throw new Error('provider event conversation projection failed')
    const body = inboundBody(payload)
    const metadata = providerEventInboundMessageMetadata(payload)
    const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "Message" ("id", "conversationId", "phone", "direction", "body", "providerMessageId", "status", "metadata")
      VALUES (${row.id}, ${conversations[0]!.id}, ${phone}, 'INBOUND'::"MessageDirection", ${body},
        ${row.providerMessageId}, 'received',
        ${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"
    `)
    if (inserted.length === 0) return []
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Conversation" SET "lastMessage" = ${body}, "archivedAt" = NULL, "updatedAt" = clock_timestamp()
      WHERE "id" = ${conversations[0]!.id} AND "businessId" = ${row.businessId}
    `)
    return [{ businessId: row.businessId, conversationId: conversations[0]!.id, messageId: inserted[0]!.id }]
  }, PROCESS_PROVIDER_EVENT_TRANSACTION_OPTIONS)
}

export async function processProviderEventJob(input: {
  client: ProviderEventClient
  job: ClaimedBotJob
  depositProofIngressEnabled?: boolean
}): Promise<'PROCESSED' | 'STALE'> {
  if (input.job.kind !== 'PROCESS_PROVIDER_EVENT') {
    throw new Error(`unsupported provider event job ${input.job.kind}`)
  }

  const pendingCrmEvents = await projectInboundBeforeClassification(input.client, input.job)
  flushInboundConversationMessages(pendingCrmEvents)

  const result = await input.client.$transaction(async (tx) => {
    await assertClaimedBotJobTx(tx, input.job, { requireCurrentDeployment: false })
    const deployment = await currentDeploymentTx(tx, input.job)
    const activeJob = deployment.id === input.job.deploymentId
      && deployment.generation === input.job.deploymentGeneration
      ? input.job
      : await retargetClaimedBotJobTx(tx, input.job, {
          deploymentId: deployment.id,
          generation: deployment.generation
        })
    await assertClaimedBotJobTx(tx, activeJob)
    const row = await loadProviderEventTx(tx, activeJob, true)
    if (row.status !== 'ADMITTED') {
      await completeClaimedBotJobTx(tx, activeJob)
      return { outcome: 'PROCESSED' as const, outboundMessage: null }
    }
    const event = hydrateProviderEvent(row)
    const route: Extract<AuthoritativeRoute, { kind: 'new' }> = {
      kind: 'new',
      businessId: activeJob.businessId,
      deploymentId: activeJob.deploymentId,
      generation: activeJob.deploymentGeneration,
      appSecret: null,
      appSecretPrevious: null,
      appSecretPreviousValidUntil: null
    }
    const classifier = new PrismaAuthoritativeAdmissionRepository(input.client as never, {
      depositProofIngressEnabled: input.depositProofIngressEnabled ?? false
    })
    const classification = await classifier.classifyProviderEventTx(tx, {
      route,
      event,
      providerEventId: row.id
    })
    await completeClaimedBotJobTx(tx, activeJob)
    return { outcome: 'PROCESSED' as const, outboundMessage: classification.outboundMessage }
  }, PROCESS_PROVIDER_EVENT_TRANSACTION_OPTIONS)
  if (result.outboundMessage) {
    const outbound: OutboundConversationMessageProjection[] = []
    collectOutboundConversationMessage(outbound, result.outboundMessage)
    flushOutboundConversationMessages(outbound)
  }
  return result.outcome
}

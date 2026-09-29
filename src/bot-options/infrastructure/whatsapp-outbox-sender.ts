import { randomUUID } from 'node:crypto'
import { isWhatsAppLatencyDiagnosticsEnabledForBusiness, whatsappConfig } from '../../config/whatsapp.js'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { acquireDispatchClaim, releaseDispatchClaim } from './dispatch-claims.js'
import { botOptionsMetrics } from '../observability/metrics.js'
import { createMaintenanceCadence } from './maintenance-cadence.js'
import {
  collectOutboundConversationMessage,
  flushOutboundConversationMessages,
  type OutboundConversationMessageProjection
} from '../../services/crm-realtime-events.js'

export const META_SEND_TIMEOUT_MS = 10_000
export const OUTBOX_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 240_000, 480_000] as const
export type Jitter = (baseMs: number, attempt: number, outboxId: string) => number
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n

export function parseOutboxTransitionId(transitionId: string, expectedSessionId: string): {
  kind: 'transition' | 'initial' | 'cutover-recovery'
  revision: bigint
} | null {
  const parts = transitionId.split(':')
  if (parts.length !== 3 || !expectedSessionId || parts[1] !== expectedSessionId) return null
  if (parts[0] !== 'transition' && parts[0] !== 'initial' && parts[0] !== 'cutover-recovery') return null
  if (!/^(0|[1-9][0-9]*)$/.test(parts[2])) return null
  const revision = BigInt(parts[2])
  if (revision > MAX_POSTGRES_BIGINT) return null
  return { kind: parts[0], revision }
}

export function admissionToAcceptanceDurationMs(admittedAt: Date | null | undefined, acceptedAt: Date | null | undefined): number | null {
  if (!(admittedAt instanceof Date) || !(acceptedAt instanceof Date)) return null
  const start = admittedAt.getTime()
  const end = acceptedAt.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return end - start
}
export type ClaimedOutbox = {
  id: string; businessId: string; sessionId: string; payload: Prisma.JsonValue
  attempts: number; maxAttempts: number; claimToken: string; generation: number; fenceEpoch: number
  queueWaitMs: number
  diagnosticCustomerCode?: string | null
  sourceProviderEventId?: string | null
  sourceProviderEventAdmittedAt?: Date | null
}

export type OutboxLatencyDiagnostic = {
  resource: 'outbox'
  resourceId: string
  phase: 'claim' | 'queue' | 'preflight' | 'meta_request' | 'provider_credentials' | 'meta_http' | 'meta_response_parse' | 'finalize' | 'admission_to_meta_acceptance'
  durationMs: number | null
  outcome: 'ok' | 'error' | 'retry' | 'poison' | 'unknown' | 'stale' | 'accepted' | 'unavailable'
  cohort: 'outbox_only'
  correlation: 'linked' | 'unavailable'
  sourceProviderEventId: string | null
}

type OutboxClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>
export const OUTBOX_MAINTENANCE_INTERVAL_MS = 30_000

export async function claimOutbox(
  client: OutboxClient,
  leaseMs = 30_000,
  token = randomUUID(),
  scope?: { businessId: string }
): Promise<ClaimedOutbox | null> {
  const candidateScope = scope ? Prisma.sql`AND o."businessId" = ${scope.businessId}` : Prisma.empty
  const claimed = await client.$transaction(async (tx) => {
    const diagnosticsConfigured = whatsappConfig.latencyDiagnosticBusinessCodes.size > 0
    const candidateBusinessCode = diagnosticsConfigured ? Prisma.sql`, b."customerCode"` : Prisma.sql`, NULL::text AS "customerCode"`
    const businessJoin = diagnosticsConfigured ? Prisma.sql`JOIN "Business" b ON b."id" = o."businessId"` : Prisma.empty
    const candidates = await tx.$queryRaw<Array<{ id: string; businessId: string; sessionId: string; transitionId: string; customerCode: string | null }>>(Prisma.sql`
      SELECT o."id", o."businessId", o."sessionId", o."transitionId" ${candidateBusinessCode} FROM "BotOutbox" o
      ${businessJoin}
      JOIN "BotSession" s ON s."id" = o."sessionId"
      JOIN "BotChannelDeployment" d ON d."id" = s."deploymentId" AND d."businessId" = o."businessId"
      WHERE (o."status" IN ('PENDING'::"BotOutboxStatus", 'RETRY'::"BotOutboxStatus")
          OR (o."status" = 'CLAIMED'::"BotOutboxStatus" AND o."leasedUntil" < clock_timestamp()))
        AND o."availableAt" <= clock_timestamp() AND o."attempts" < o."maxAttempts"
        ${candidateScope}
        AND d."generation" = s."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
        AND d."engineKey" = 'deterministic-options' AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
        AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus" AND s."handoffClaimsPausedAt" IS NULL
        AND (o."dependsOnSequence" IS NULL OR EXISTS (
          SELECT 1 FROM "BotOutbox" predecessor
          WHERE predecessor."sessionId" = o."sessionId" AND predecessor."deliveryGroupId" = o."deliveryGroupId"
            AND predecessor."sequence" = o."dependsOnSequence"
            AND predecessor."status" IN ('ACCEPTED'::"BotOutboxStatus", 'DELIVERED'::"BotOutboxStatus", 'READ'::"BotOutboxStatus", 'SKIPPED'::"BotOutboxStatus")
        ))
      ORDER BY o."availableAt", o."createdAt", o."id" FOR UPDATE OF o SKIP LOCKED LIMIT 1
    `)
    const candidate = candidates[0]
    if (!candidate) return null
    const parsedTransition = parseOutboxTransitionId(candidate.transitionId, candidate.sessionId)
    const telemetry = isWhatsAppLatencyDiagnosticsEnabledForBusiness(candidate.customerCode)
      ? parsedTransition
        ? Prisma.sql`
          SELECT ${candidate.customerCode}::text AS "customerCode", event."id" AS "providerEventId", event."admittedAt"
          FROM "BotOutbox" source
          LEFT JOIN "BotTransitionLog" transition ON transition."businessId" = source."businessId"
            AND transition."sessionId" = source."sessionId"
            AND transition."revisionTo" = ${parsedTransition.revision}
            AND source."transitionId" = ${candidate.transitionId}
          LEFT JOIN "BotProviderEvent" event ON event."id" = transition."providerEventId"
            AND event."businessId" = transition."businessId"
          WHERE source."id" = ${candidate.id} AND source."businessId" = ${candidate.businessId}
            AND source."sessionId" = ${candidate.sessionId} AND source."transitionId" = ${candidate.transitionId}
        `
        : Prisma.sql`SELECT ${candidate.customerCode}::text AS "customerCode", NULL::text AS "providerEventId", NULL::timestamptz AS "admittedAt"`
      : Prisma.sql`SELECT NULL::text AS "customerCode", NULL::text AS "providerEventId", NULL::timestamptz AS "admittedAt"`
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${candidate.businessId}:WHATSAPP`}, 0))
    `)
    const rows = await tx.$queryRaw<ClaimedOutbox[]>(Prisma.sql`
      WITH telemetry AS (${telemetry})
      UPDATE "BotOutbox" o SET "status" = 'CLAIMED'::"BotOutboxStatus", "attempts" = o."attempts" + 1,
        "leaseToken" = ${token}, "leasedUntil" = clock_timestamp() + (${leaseMs} * interval '1 millisecond'), "updatedAt" = clock_timestamp()
      FROM "BotSession" s, "BotChannelDeployment" d, telemetry
      WHERE o."id" = ${candidate.id} AND s."id" = o."sessionId" AND s."businessId" = o."businessId"
        AND d."id" = s."deploymentId" AND d."businessId" = o."businessId"
        AND d."generation" = s."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
        AND d."engineKey" = 'deterministic-options' AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
        AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus" AND s."handoffClaimsPausedAt" IS NULL
      RETURNING o."id", o."businessId", o."sessionId", o."payload", o."attempts", o."maxAttempts",
        o."leaseToken" AS "claimToken", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch",
        (EXTRACT(EPOCH FROM (clock_timestamp() - o."createdAt")) * 1000)::double precision AS "queueWaitMs",
        telemetry."customerCode" AS "diagnosticCustomerCode",
        telemetry."providerEventId" AS "sourceProviderEventId",
        telemetry."admittedAt" AS "sourceProviderEventAdmittedAt"
    `)
    return rows[0] ?? null
  })
  if (claimed) botOptionsMetrics.observe('outbox_wait', claimed.queueWaitMs)
  return claimed
}

export async function maintainOutbox(client: OutboxClient, scope?: { businessId: string }): Promise<{
  staleSending: number
  exhausted: number
}> {
  const maintenanceScope = scope ? Prisma.sql`AND "businessId" = ${scope.businessId}` : Prisma.empty
  const rows = await client.$queryRaw<Array<{ staleSending: bigint; exhausted: bigint }>>(Prisma.sql`
    WITH stale AS (
      UPDATE "BotOutbox" SET "status" = 'UNKNOWN'::"BotOutboxStatus", "leaseToken" = NULL,
        "leasedUntil" = NULL, "errorCode" = COALESCE("errorCode", 'stale_sending'), "updatedAt" = clock_timestamp()
      WHERE "status" = 'SENDING'::"BotOutboxStatus" AND "leasedUntil" < clock_timestamp()
        ${maintenanceScope}
      RETURNING "id"
    ), stale_dispatch AS (
      UPDATE "BotDispatchClaim" c SET "status" = 'UNKNOWN'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
      FROM stale WHERE c."kind" = 'SEND'::"BotDispatchKind" AND c."resourceId" = stale."id"
        AND c."status" = 'SENDING'::"BotDispatchStatus"
      RETURNING c."id"
    ), exhausted AS (
      UPDATE "BotOutbox" SET "status" = 'POISON'::"BotOutboxStatus",
        "errorCode" = COALESCE("errorCode", 'attempts_exhausted'), "updatedAt" = clock_timestamp()
      WHERE "status" IN ('PENDING'::"BotOutboxStatus", 'RETRY'::"BotOutboxStatus") AND "attempts" >= "maxAttempts"
        ${maintenanceScope}
      RETURNING "id"
    )
    SELECT (SELECT count(*) FROM stale)::bigint AS "staleSending",
      (SELECT count(*) FROM exhausted)::bigint AS "exhausted"
  `)
  return { staleSending: Number(rows[0]?.staleSending ?? 0n), exhausted: Number(rows[0]?.exhausted ?? 0n) }
}

export type OutboxProviderDiagnostic = {
  phase: 'provider_credentials' | 'meta_http' | 'meta_response_parse'
  durationMs: number
  outcome: 'ok' | 'error'
}

export type OutboxProvider = {
  send(input: { businessId: string; payload: Prisma.JsonValue }, signal: AbortSignal, onDiagnostic?: (diagnostic: OutboxProviderDiagnostic) => void): Promise<
    | { kind: 'accepted'; providerMessageId: string }
    | { kind: 'clear_failure'; code: string; retryable: boolean; retryAfterMs?: number }
  >
}

type OutboundPayload = {
  to?: unknown
  item?: {
    type?: unknown
    body?: unknown
    mode?: unknown
    buttons?: unknown
    rows?: unknown
    buttonText?: unknown
    sectionTitle?: unknown
  }
}

/**
 * Whitelist only text that was visible in the accepted WhatsApp interactive
 * message. In particular, this intentionally excludes action IDs, prompt
 * tokens, and internal choice IDs from the durable CRM Message metadata.
 */
export function outboundMessageMetadata(payload: OutboundPayload): Record<string, unknown> {
  const item = payload.item
  const metadata: Record<string, unknown> = {
    provider: 'whatsapp',
    source: 'bot-options',
    kind: typeof item?.type === 'string' ? item.type : null
  }
  if (item?.type !== 'interactive' || (item.mode !== 'buttons' && item.mode !== 'list')) return metadata

  const interactive: Record<string, unknown> = { mode: item.mode }
  if (item.mode === 'buttons' && Array.isArray(item.buttons)) {
    interactive.buttons = item.buttons.flatMap((button) => {
      if (typeof button !== 'object' || button === null || !('title' in button) || typeof button.title !== 'string') return []
      return [{ title: button.title }]
    })
  }
  if (item.mode === 'list') {
    if (Array.isArray(item.rows)) {
      interactive.rows = item.rows.flatMap((row) => {
        if (typeof row !== 'object' || row === null || !('title' in row) || typeof row.title !== 'string') return []
        return [{
          title: row.title,
          ...(typeof row.description === 'string' ? { description: row.description } : {})
        }]
      })
    }
    if (typeof item.buttonText === 'string') interactive.buttonText = item.buttonText
    if (typeof item.sectionTitle === 'string') interactive.sectionTitle = item.sectionTitle
  }
  metadata.interactive = interactive
  return metadata
}

async function projectOutboundMessageTx(
  tx: Prisma.TransactionClient,
  input: {
    item: ClaimedOutbox
    status: 'sent' | 'failed'
    providerMessageId: string | null
    errorCode: string | null
  }
): Promise<OutboundConversationMessageProjection | null> {
  const payload = input.item.payload as OutboundPayload
  const body = typeof payload.item?.body === 'string' && payload.item.body.trim()
    ? payload.item.body.trim()
    : `[${typeof payload.item?.type === 'string' ? payload.item.type : 'message'}]`
  if (typeof payload.to !== 'string' || !payload.to) return null
  const metadata = {
    ...outboundMessageMetadata(payload),
    delivery: {
      sent: input.status === 'sent',
      status: input.status,
      ...(input.errorCode ? { errorCode: input.errorCode } : {})
    }
  }
  const rows = await tx.$queryRaw<Array<{ id: string; conversationId: string }>>(Prisma.sql`
    INSERT INTO "Message" ("id", "conversationId", "phone", "direction", "body", "providerMessageId", "status",
      "providerErrorCode", "metadata")
    SELECT ${input.item.id}, s."conversationId", ${payload.to}, 'OUTBOUND'::"MessageDirection", ${body},
      ${input.providerMessageId}, ${input.status}, ${input.errorCode}, ${JSON.stringify(metadata)}::jsonb
    FROM "BotSession" s
    JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
    WHERE s."id" = ${input.item.sessionId} AND s."businessId" = ${input.item.businessId}
    ON CONFLICT ("id") DO UPDATE SET
      "providerMessageId" = EXCLUDED."providerMessageId",
      "status" = EXCLUDED."status",
      "providerErrorCode" = EXCLUDED."providerErrorCode",
      "metadata" = EXCLUDED."metadata"
    RETURNING "id", "conversationId"
  `)
  if (rows.length !== 1) return null
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Conversation" SET "lastMessage" = ${body}, "archivedAt" = NULL, "updatedAt" = clock_timestamp()
    WHERE "id" = ${rows[0]!.conversationId} AND "businessId" = ${input.item.businessId}
  `)
  return {
    businessId: input.item.businessId,
    conversationId: rows[0]!.conversationId,
    messageId: rows[0]!.id
  }
}

export async function sendClaimedOutbox(input: {
  client: OutboxClient
  item: ClaimedOutbox
  provider: OutboxProvider
  timeoutMs?: number
  jitter?: Jitter
  onDiagnostic?: (diagnostic: OutboxLatencyDiagnostic) => void
}): Promise<'ACCEPTED' | 'RETRY' | 'POISON' | 'UNKNOWN' | 'STALE'> {
  const emit = (diagnostic: Omit<OutboxLatencyDiagnostic, 'cohort' | 'correlation' | 'sourceProviderEventId'>) => {
    if (!isWhatsAppLatencyDiagnosticsEnabledForBusiness(input.item.diagnosticCustomerCode)) return
    try {
      input.onDiagnostic?.({
        ...diagnostic,
        cohort: 'outbox_only',
        correlation: input.item.sourceProviderEventId ? 'linked' : 'unavailable',
        sourceProviderEventId: input.item.sourceProviderEventId ?? null
      })
    } catch { /* diagnostics never affect delivery */ }
  }
  const preflightStartedAt = performance.now()
  const dispatchToken = await acquireDispatchClaim({
    client: input.client, businessId: input.item.businessId, sessionId: input.item.sessionId,
    resourceId: input.item.id, generation: input.item.generation, fenceEpoch: input.item.fenceEpoch, kind: 'SEND'
  })
  if (!dispatchToken) {
    const durationMs = performance.now() - preflightStartedAt
    botOptionsMetrics.observe('outbox_preflight', durationMs, 'error')
    emit({ resource: 'outbox', resourceId: input.item.id, phase: 'preflight', durationMs, outcome: 'stale' })
    return 'STALE'
  }
  try {
    await input.client.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${input.item.businessId}:WHATSAPP`}, 0))
      `)
      const counts = await tx.$queryRaw<Array<{ outboxCount: bigint; dispatchCount: bigint }>>(Prisma.sql`
        WITH outbox AS (
          UPDATE "BotOutbox" SET "status" = 'SENDING'::"BotOutboxStatus", "updatedAt" = clock_timestamp()
          WHERE "id" = ${input.item.id} AND "businessId" = ${input.item.businessId}
            AND "status" = 'CLAIMED'::"BotOutboxStatus" AND "leaseToken" = ${input.item.claimToken}
          RETURNING "id"
        ), dispatch AS (
          UPDATE "BotDispatchClaim" c SET "status" = 'SENDING'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
          WHERE c."claimToken" = ${dispatchToken} AND c."businessId" = ${input.item.businessId}
            AND c."status" = 'CLAIMED'::"BotDispatchStatus" AND c."claimedUntil" > clock_timestamp()
            AND EXISTS (
              SELECT 1 FROM "BotChannelDeployment" d
              WHERE d."businessId" = c."businessId" AND d."channel" = c."channel"
                AND d."generation" = c."generation" AND d."dispatchFenceEpoch" = c."fenceEpoch"
                AND d."claimsPausedAt" IS NULL AND d."activeConfigurationId" IS NOT NULL
                AND d."legacyDispatchCoverageVersion" >= 1
                AND (c."sessionId" IS NULL OR EXISTS (
                  SELECT 1 FROM "BotSession" s WHERE s."id" = c."sessionId" AND s."businessId" = c."businessId"
                    AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus" AND s."handoffClaimsPausedAt" IS NULL
                    AND s."handoffFenceEpoch" = c."handoffFenceEpoch"
                ))
            )
          RETURNING c."id"
        ) SELECT (SELECT count(*) FROM outbox)::bigint AS "outboxCount",
          (SELECT count(*) FROM dispatch)::bigint AS "dispatchCount"
      `)
      if (counts[0]?.outboxCount !== 1n || counts[0]?.dispatchCount !== 1n) throw new Error('sender preflight lost fence')
    })
    const durationMs = performance.now() - preflightStartedAt
    botOptionsMetrics.observe('outbox_preflight', durationMs)
    emit({ resource: 'outbox', resourceId: input.item.id, phase: 'preflight', durationMs, outcome: 'ok' })
  } catch {
    const durationMs = performance.now() - preflightStartedAt
    botOptionsMetrics.observe('outbox_preflight', durationMs, 'error')
    emit({ resource: 'outbox', resourceId: input.item.id, phase: 'preflight', durationMs, outcome: 'error' })
    await releaseDispatchClaim(input.client, dispatchToken)
    return 'STALE'
  }

  const controller = new AbortController()
  const timeoutMs = input.timeoutMs ?? META_SEND_TIMEOUT_MS
  let timer: NodeJS.Timeout | undefined
  const providerStartedAt = performance.now()
  let providerObserved = false
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('meta_timeout_unknown')) }, timeoutMs)
    })
    const result = await Promise.race([input.provider.send({ businessId: input.item.businessId, payload: input.item.payload }, controller.signal,
      isWhatsAppLatencyDiagnosticsEnabledForBusiness(input.item.diagnosticCustomerCode) && input.onDiagnostic
        ? (diagnostic) => emit({ resource: 'outbox', resourceId: input.item.id, ...diagnostic })
        : undefined), timeout])
    const providerMs = performance.now() - providerStartedAt
    providerObserved = true
    botOptionsMetrics.observe('meta_request', providerMs)
    emit({ resource: 'outbox', resourceId: input.item.id, phase: 'meta_request', durationMs: providerMs, outcome: 'ok' })
    if (result.kind === 'accepted') {
      const finalizeStartedAt = performance.now()
      const pendingCrmEvents: OutboundConversationMessageProjection[] = []
      const acceptedAt = await input.client.$transaction(async (tx) => {
        const counts = await tx.$queryRaw<Array<{ outboxCount: bigint; dispatchCount: bigint; sentAt: Date | null }>>(Prisma.sql`
          WITH outbox AS (
            UPDATE "BotOutbox" SET "status" = 'ACCEPTED'::"BotOutboxStatus", "providerMessageId" = ${result.providerMessageId},
              "sentAt" = clock_timestamp(), "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
            WHERE "id" = ${input.item.id} AND "status" = 'SENDING'::"BotOutboxStatus" AND "leaseToken" = ${input.item.claimToken}
            RETURNING "id", "sentAt"
          ), dispatch AS (
            UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "providerMessageId" = ${result.providerMessageId},
              "updatedAt" = clock_timestamp()
            WHERE "claimToken" = ${dispatchToken} AND "status" = 'SENDING'::"BotDispatchStatus"
            RETURNING "id"
          ) SELECT (SELECT count(*) FROM outbox)::bigint AS "outboxCount",
            (SELECT count(*) FROM dispatch)::bigint AS "dispatchCount",
            (SELECT "sentAt" FROM outbox LIMIT 1) AS "sentAt"
        `)
        if (counts[0]?.outboxCount !== 1n || counts[0]?.dispatchCount !== 1n) throw new Error('accepted result lost sender fence')
        const projection = await projectOutboundMessageTx(tx, {
          item: input.item,
          status: 'sent',
          providerMessageId: result.providerMessageId,
          errorCode: null
        })
        if (projection) collectOutboundConversationMessage(pendingCrmEvents, projection)
        return counts[0]?.sentAt ?? null
      })
      flushOutboundConversationMessages(pendingCrmEvents)
      const finalizeMs = performance.now() - finalizeStartedAt
      botOptionsMetrics.observe('outbox_finalize', finalizeMs)
      emit({ resource: 'outbox', resourceId: input.item.id, phase: 'finalize', durationMs: finalizeMs, outcome: 'ok' })
      const admissionToAcceptanceMs = admissionToAcceptanceDurationMs(input.item.sourceProviderEventAdmittedAt, acceptedAt)
      emit({
        resource: 'outbox', resourceId: input.item.id, phase: 'admission_to_meta_acceptance',
        durationMs: admissionToAcceptanceMs, outcome: admissionToAcceptanceMs === null ? 'unavailable' : 'accepted'
      })
      return 'ACCEPTED'
    }
    const poison = !result.retryable || input.item.attempts >= input.item.maxAttempts
    const base = result.retryAfterMs ?? OUTBOX_RETRY_DELAYS_MS[Math.min(input.item.attempts - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)]!
    const delay = Math.max(0, input.jitter?.(base, input.item.attempts, input.item.id) ?? base)
    const status = poison ? 'POISON' : 'RETRY'
    const finalizeStartedAt = performance.now()
    const pendingCrmEvents: OutboundConversationMessageProjection[] = []
    await input.client.$transaction(async (tx) => {
      const counts = await tx.$queryRaw<Array<{ outboxCount: bigint; dispatchCount: bigint }>>(Prisma.sql`
        WITH outbox AS (
          UPDATE "BotOutbox" SET "status" = ${status}::"BotOutboxStatus", "errorCode" = ${result.code},
            "availableAt" = clock_timestamp() + (${delay} * interval '1 millisecond'),
            "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
          WHERE "id" = ${input.item.id} AND "status" = 'SENDING'::"BotOutboxStatus" AND "leaseToken" = ${input.item.claimToken}
          RETURNING "id"
        ), dispatch AS (
          UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
          WHERE "claimToken" = ${dispatchToken} AND "status" = 'SENDING'::"BotDispatchStatus"
          RETURNING "id"
        ) SELECT (SELECT count(*) FROM outbox)::bigint AS "outboxCount",
          (SELECT count(*) FROM dispatch)::bigint AS "dispatchCount"
      `)
      if (counts[0]?.outboxCount !== 1n || counts[0]?.dispatchCount !== 1n) throw new Error('clear failure lost sender fence')
      const projection = await projectOutboundMessageTx(tx, {
        item: input.item,
        status: 'failed',
        providerMessageId: null,
        errorCode: result.code
      })
      if (projection) collectOutboundConversationMessage(pendingCrmEvents, projection)
    })
    flushOutboundConversationMessages(pendingCrmEvents)
    const finalizeMs = performance.now() - finalizeStartedAt
    botOptionsMetrics.observe('outbox_finalize', finalizeMs)
    emit({ resource: 'outbox', resourceId: input.item.id, phase: 'finalize', durationMs: finalizeMs, outcome: poison ? 'poison' : 'retry' })
    return status
  } catch {
    if (!providerObserved) {
      const providerMs = performance.now() - providerStartedAt
      botOptionsMetrics.observe('meta_request', providerMs, 'error')
      emit({ resource: 'outbox', resourceId: input.item.id, phase: 'meta_request', durationMs: providerMs, outcome: 'error' })
    }
    const finalizeStartedAt = performance.now()
    await input.client.$transaction(async (tx) => {
      const counts = await tx.$queryRaw<Array<{ outboxCount: bigint; dispatchCount: bigint }>>(Prisma.sql`
        WITH outbox AS (
          UPDATE "BotOutbox" SET "status" = 'UNKNOWN'::"BotOutboxStatus", "errorCode" = 'meta_timeout_unknown',
            "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
          WHERE "id" = ${input.item.id} AND "status" = 'SENDING'::"BotOutboxStatus" AND "leaseToken" = ${input.item.claimToken}
          RETURNING "id"
        ), dispatch AS (
          UPDATE "BotDispatchClaim" SET "status" = 'UNKNOWN'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
          WHERE "claimToken" = ${dispatchToken} AND "status" = 'SENDING'::"BotDispatchStatus"
          RETURNING "id"
        ) SELECT (SELECT count(*) FROM outbox)::bigint AS "outboxCount",
          (SELECT count(*) FROM dispatch)::bigint AS "dispatchCount"
      `)
      if (counts[0]?.outboxCount !== 1n || counts[0]?.dispatchCount !== 1n) throw new Error('ambiguous result lost sender fence')
    })
    const finalizeMs = performance.now() - finalizeStartedAt
    botOptionsMetrics.observe('outbox_finalize', finalizeMs)
    emit({ resource: 'outbox', resourceId: input.item.id, phase: 'finalize', durationMs: finalizeMs, outcome: 'unknown' })
    return 'UNKNOWN'
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type UnknownResolution = 'ASSUME_SENT' | 'SKIP' | 'RESEND_ACCEPT_DUPLICATE_RISK'

export async function resolveUnknownOutbox(input: {
  client: OutboxClient; outboxId: string; type: UnknownResolution; actorId: string; reason: string
}): Promise<string | null> {
  if (!input.actorId.trim() || !input.reason.trim()) throw new Error('UNKNOWN resolution requires actor and reason')
  return input.client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string; idempotencyKey: string }>>(Prisma.sql`
      SELECT "id", "status"::text AS "status", "idempotencyKey" FROM "BotOutbox" WHERE "id" = ${input.outboxId} FOR UPDATE
    `)
    if (rows[0]?.status !== 'UNKNOWN') return null
    const newId = input.type === 'RESEND_ACCEPT_DUPLICATE_RISK' ? randomUUID() : null
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotOutboxResolution" ("id", "outboxId", "type", "actorId", "reason")
      VALUES (${randomUUID()}, ${input.outboxId}, ${input.type}, ${input.actorId}, ${input.reason})
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotOutbox" SET "status" = ${input.type === 'ASSUME_SENT' ? 'ACCEPTED' : 'SKIPPED'}::"BotOutboxStatus", "updatedAt" = clock_timestamp()
      WHERE "id" = ${input.outboxId} AND "status" = 'UNKNOWN'::"BotOutboxStatus"
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
      WHERE "kind" = 'SEND'::"BotDispatchKind" AND "resourceId" = ${input.outboxId}
        AND "status" <> 'DONE'::"BotDispatchStatus"
    `)
    if (newId) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload",
          "idempotencyKey", "status", "dependsOnSequence", "maxAttempts", "availableAt", "updatedAt")
        SELECT ${newId}, "businessId", "sessionId", "transitionId", ${randomUUID()}, 0, "kind", "payload",
          ${`${rows[0]!.idempotencyKey}:manual:${newId}`}, 'PENDING'::"BotOutboxStatus", NULL, "maxAttempts", clock_timestamp(), clock_timestamp()
        FROM "BotOutbox" WHERE "id" = ${input.outboxId}
      `)
    }
    return newId ?? input.outboxId
  })
}

export function startOutboxSenderLoop(input: {
  client: OutboxClient
  provider: OutboxProvider
  pollMs?: number
  maintenanceIntervalMs?: number
  now?: () => number
  onError?: (error: unknown) => void
  onDiagnostic?: (diagnostic: OutboxLatencyDiagnostic) => void
}): { stop(): Promise<void> } {
  let stopped = false
  const emit = (item: ClaimedOutbox, diagnostic: Omit<OutboxLatencyDiagnostic, 'cohort' | 'correlation' | 'sourceProviderEventId'>) => {
    if (!isWhatsAppLatencyDiagnosticsEnabledForBusiness(item.diagnosticCustomerCode)) return
    try {
      input.onDiagnostic?.({
        ...diagnostic,
        cohort: 'outbox_only',
        correlation: item.sourceProviderEventId ? 'linked' : 'unavailable',
        sourceProviderEventId: item.sourceProviderEventId ?? null
      })
    } catch { /* diagnostics never affect delivery */ }
  }
  const maintenance = createMaintenanceCadence({
    intervalMs: input.maintenanceIntervalMs ?? OUTBOX_MAINTENANCE_INTERVAL_MS,
    now: input.now,
    run: async () => { await maintainOutbox(input.client) }
  })
  const running = (async () => {
    while (!stopped) {
      try {
        await maintenance.runIfDue()
        const claimStartedAt = performance.now()
        const item = await claimOutbox(input.client)
        if (item) {
          const claimMs = performance.now() - claimStartedAt
          botOptionsMetrics.observe('outbox_claim', claimMs)
          emit(item, { resource: 'outbox', resourceId: item.id, phase: 'claim', durationMs: claimMs, outcome: 'ok' })
          emit(item, { resource: 'outbox', resourceId: item.id, phase: 'queue', durationMs: item.queueWaitMs, outcome: 'ok' })
          await sendClaimedOutbox({ client: input.client, item, provider: input.provider, onDiagnostic: input.onDiagnostic })
          continue
        }
      } catch (error) {
        input.onError?.(error)
      }
      await new Promise<void>((resolve) => setTimeout(resolve, input.pollMs ?? 250))
    }
  })()
  return { async stop() { stopped = true; await running } }
}

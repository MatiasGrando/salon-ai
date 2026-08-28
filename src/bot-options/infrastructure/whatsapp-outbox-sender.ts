import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { acquireDispatchClaim, assertDispatchClaimTx, releaseDispatchClaim } from './dispatch-claims.js'
import { botOptionsMetrics } from '../observability/metrics.js'

export const META_SEND_TIMEOUT_MS = 10_000
export const OUTBOX_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 240_000, 480_000] as const
export type Jitter = (baseMs: number, attempt: number, outboxId: string) => number

export type ClaimedOutbox = {
  id: string; businessId: string; sessionId: string; payload: Prisma.JsonValue
  attempts: number; maxAttempts: number; claimToken: string; generation: number; fenceEpoch: number
  queueWaitMs: number
}

type OutboxClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>

export async function claimOutbox(
  client: OutboxClient,
  leaseMs = 30_000,
  token = randomUUID(),
  scope?: { businessId: string }
): Promise<ClaimedOutbox | null> {
  const maintenanceScope = scope ? Prisma.sql`AND "businessId" = ${scope.businessId}` : Prisma.empty
  const candidateScope = scope ? Prisma.sql`AND o."businessId" = ${scope.businessId}` : Prisma.empty
  const claimed = await client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
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
    ) SELECT count(*) FROM stale_dispatch
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotOutbox" SET "status" = 'POISON'::"BotOutboxStatus",
        "errorCode" = COALESCE("errorCode", 'attempts_exhausted'), "updatedAt" = clock_timestamp()
      WHERE "status" IN ('PENDING'::"BotOutboxStatus", 'RETRY'::"BotOutboxStatus") AND "attempts" >= "maxAttempts"
        ${maintenanceScope}
    `)
    const candidates = await tx.$queryRaw<Array<{ id: string; businessId: string }>>(Prisma.sql`
      SELECT o."id", o."businessId" FROM "BotOutbox" o
      JOIN "BotSession" s ON s."id" = o."sessionId"
      JOIN "BotChannelDeployment" d ON d."id" = s."deploymentId" AND d."businessId" = o."businessId"
      WHERE (o."status" IN ('PENDING'::"BotOutboxStatus", 'RETRY'::"BotOutboxStatus")
          OR (o."status" = 'CLAIMED'::"BotOutboxStatus" AND o."leasedUntil" < clock_timestamp()))
        AND o."availableAt" <= clock_timestamp() AND o."attempts" < o."maxAttempts"
        ${candidateScope}
        AND d."generation" = s."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
        AND d."engineKey" = 'deterministic-options' AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
        AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus"
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
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${candidate.businessId}:WHATSAPP`}, 0))
    `)
    const rows = await tx.$queryRaw<ClaimedOutbox[]>(Prisma.sql`
      UPDATE "BotOutbox" o SET "status" = 'CLAIMED'::"BotOutboxStatus", "attempts" = o."attempts" + 1,
        "leaseToken" = ${token}, "leasedUntil" = clock_timestamp() + (${leaseMs} * interval '1 millisecond'), "updatedAt" = clock_timestamp()
      FROM "BotSession" s, "BotChannelDeployment" d
      WHERE o."id" = ${candidate.id} AND s."id" = o."sessionId" AND s."businessId" = o."businessId"
        AND d."id" = s."deploymentId" AND d."businessId" = o."businessId"
        AND d."generation" = s."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
        AND d."engineKey" = 'deterministic-options' AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
      RETURNING o."id", o."businessId", o."sessionId", o."payload", o."attempts", o."maxAttempts",
        o."leaseToken" AS "claimToken", d."generation", d."dispatchFenceEpoch" AS "fenceEpoch",
        (EXTRACT(EPOCH FROM (clock_timestamp() - o."createdAt")) * 1000)::double precision AS "queueWaitMs"
    `)
    return rows[0] ?? null
  })
  if (claimed) botOptionsMetrics.observe('outbox_wait', claimed.queueWaitMs)
  return claimed
}

export type OutboxProvider = {
  send(input: { businessId: string; payload: Prisma.JsonValue }, signal: AbortSignal): Promise<
    | { kind: 'accepted'; providerMessageId: string }
    | { kind: 'clear_failure'; code: string; retryable: boolean; retryAfterMs?: number }
  >
}

export async function sendClaimedOutbox(input: {
  client: OutboxClient
  item: ClaimedOutbox
  provider: OutboxProvider
  timeoutMs?: number
  jitter?: Jitter
}): Promise<'ACCEPTED' | 'RETRY' | 'POISON' | 'UNKNOWN' | 'STALE'> {
  const dispatchToken = await acquireDispatchClaim({
    client: input.client, businessId: input.item.businessId, sessionId: input.item.sessionId,
    resourceId: input.item.id, generation: input.item.generation, fenceEpoch: input.item.fenceEpoch, kind: 'SEND'
  })
  if (!dispatchToken) return 'STALE'
  try {
    await input.client.$transaction(async (tx) => {
      await assertDispatchClaimTx({ tx, businessId: input.item.businessId, claimToken: dispatchToken })
      const outboxCount = await tx.$executeRaw(Prisma.sql`
        UPDATE "BotOutbox" SET "status" = 'SENDING'::"BotOutboxStatus", "updatedAt" = clock_timestamp()
        WHERE "id" = ${input.item.id} AND "businessId" = ${input.item.businessId}
          AND "status" = 'CLAIMED'::"BotOutboxStatus" AND "leaseToken" = ${input.item.claimToken}
      `)
      const dispatchCount = await tx.$executeRaw(Prisma.sql`
        UPDATE "BotDispatchClaim" SET "status" = 'SENDING'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
        WHERE "claimToken" = ${dispatchToken} AND "status" = 'CLAIMED'::"BotDispatchStatus"
      `)
      if (outboxCount !== 1 || dispatchCount !== 1) throw new Error('sender preflight lost fence')
    })
  } catch {
    await releaseDispatchClaim(input.client, dispatchToken)
    return 'STALE'
  }

  const controller = new AbortController()
  const timeoutMs = input.timeoutMs ?? META_SEND_TIMEOUT_MS
  let timer: NodeJS.Timeout | undefined
  const providerStartedAt = performance.now()
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('meta_timeout_unknown')) }, timeoutMs)
    })
    const result = await Promise.race([input.provider.send({ businessId: input.item.businessId, payload: input.item.payload }, controller.signal), timeout])
    botOptionsMetrics.observe('meta_request', performance.now() - providerStartedAt)
    if (result.kind === 'accepted') {
      await input.client.$transaction(async (tx) => {
        const count = await tx.$executeRaw(Prisma.sql`
          UPDATE "BotOutbox" SET "status" = 'ACCEPTED'::"BotOutboxStatus", "providerMessageId" = ${result.providerMessageId},
            "sentAt" = clock_timestamp(), "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
          WHERE "id" = ${input.item.id} AND "status" = 'SENDING'::"BotOutboxStatus" AND "leaseToken" = ${input.item.claimToken}
        `)
        const claimCount = await tx.$executeRaw(Prisma.sql`
          UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "providerMessageId" = ${result.providerMessageId},
            "updatedAt" = clock_timestamp()
          WHERE "claimToken" = ${dispatchToken} AND "status" = 'SENDING'::"BotDispatchStatus"
        `)
        if (count !== 1 || claimCount !== 1) throw new Error('accepted result lost sender fence')
      })
      return 'ACCEPTED'
    }
    const poison = !result.retryable || input.item.attempts >= input.item.maxAttempts
    const base = result.retryAfterMs ?? OUTBOX_RETRY_DELAYS_MS[Math.min(input.item.attempts - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)]!
    const delay = Math.max(0, input.jitter?.(base, input.item.attempts, input.item.id) ?? base)
    const status = poison ? 'POISON' : 'RETRY'
    await input.client.$transaction(async (tx) => {
      const count = await tx.$executeRaw(Prisma.sql`
        UPDATE "BotOutbox" SET "status" = ${status}::"BotOutboxStatus", "errorCode" = ${result.code},
          "availableAt" = clock_timestamp() + (${delay} * interval '1 millisecond'),
          "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
        WHERE "id" = ${input.item.id} AND "status" = 'SENDING'::"BotOutboxStatus" AND "leaseToken" = ${input.item.claimToken}
      `)
      const claimCount = await tx.$executeRaw(Prisma.sql`
        UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
        WHERE "claimToken" = ${dispatchToken} AND "status" = 'SENDING'::"BotDispatchStatus"
      `)
      if (count !== 1 || claimCount !== 1) throw new Error('clear failure lost sender fence')
    })
    return status
  } catch {
    botOptionsMetrics.observe('meta_request', performance.now() - providerStartedAt, 'error')
    await input.client.$transaction(async (tx) => {
      const count = await tx.$executeRaw(Prisma.sql`
        UPDATE "BotOutbox" SET "status" = 'UNKNOWN'::"BotOutboxStatus", "errorCode" = 'meta_timeout_unknown',
          "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
        WHERE "id" = ${input.item.id} AND "status" = 'SENDING'::"BotOutboxStatus" AND "leaseToken" = ${input.item.claimToken}
      `)
      const claimCount = await tx.$executeRaw(Prisma.sql`
        UPDATE "BotDispatchClaim" SET "status" = 'UNKNOWN'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
        WHERE "claimToken" = ${dispatchToken} AND "status" = 'SENDING'::"BotDispatchStatus"
      `)
      if (count !== 1 || claimCount !== 1) throw new Error('ambiguous result lost sender fence')
    })
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
  onError?: (error: unknown) => void
}): { stop(): Promise<void> } {
  let stopped = false
  const running = (async () => {
    while (!stopped) {
      try {
        const item = await claimOutbox(input.client)
        if (item) {
          await sendClaimedOutbox({ client: input.client, item, provider: input.provider })
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

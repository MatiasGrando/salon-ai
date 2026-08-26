import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { botOptionsMetrics } from '../observability/metrics.js'

type ActivationClient = Pick<PrismaClient, '$transaction'>

export type DispatchPauseHandle = {
  businessId: string
  deploymentId: string
  generation: number
  fenceEpoch: number
  pausedAt: Date
}

export type DispatchBlockers = {
  claimed: bigint
  sending: bigint
  unknown: bigint
}

export type QuiescenceResult =
  | { kind: 'QUIESCENT'; blockers: DispatchBlockers }
  | { kind: 'BLOCKED_UNKNOWN'; blockers: DispatchBlockers }
  | { kind: 'TIMEOUT'; blockers: DispatchBlockers }

function lockKey(businessId: string): string {
  return `bot-cutover:${businessId}:WHATSAPP`
}

export async function attestLegacyDispatchCoverage(input: {
  client: ActivationClient
  businessId: string
  actorId: string
  protocolVersion: number
}): Promise<void> {
  if (!Number.isInteger(input.protocolVersion) || input.protocolVersion < 1) throw new Error('legacy dispatch coverage version must be positive')
  if (!input.actorId.trim()) throw new Error('legacy dispatch coverage attestation requires actor')
  await input.client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.businessId)}, 0))
    `)
    const rows = await tx.$queryRaw<Array<{ generation: number }>>(Prisma.sql`
      UPDATE "BotChannelDeployment" SET "legacyDispatchCoverageVersion" = ${input.protocolVersion}, "updatedAt" = clock_timestamp()
      WHERE "businessId" = ${input.businessId} AND "channel" = 'WHATSAPP'::"BotChannel"
        AND "claimsPausedAt" IS NULL
      RETURNING "generation"
    `)
    if (rows.length !== 1) throw new Error('legacy dispatch coverage attestation requires one unpaused pointer')
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotDeploymentAudit" ("id", "businessId", "action", "generation", "actorUserId", "detail")
      VALUES (${randomUUID()}, ${input.businessId}, 'LEGACY_DISPATCH_COVERAGE_ATTESTED', ${rows[0]!.generation}, ${input.actorId},
        ${JSON.stringify({ protocolVersion: input.protocolVersion })}::jsonb)
    `)
  })
}

export async function pauseDispatchScope(input: {
  client: ActivationClient
  businessId: string
  expectedGeneration: number
  actorId: string
  legacyCoverageComplete: boolean
}): Promise<DispatchPauseHandle> {
  if (!input.legacyCoverageComplete) throw new Error('dispatch pause blocked: legacy dispatch coverage incomplete')
  if (!input.actorId.trim()) throw new Error('dispatch pause requires actor')
  return input.client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.businessId)}, 0))
    `)
    const rows = await tx.$queryRaw<Array<{
      id: string; generation: number; fenceEpoch: number; pausedAt: Date
    }>>(Prisma.sql`
      UPDATE "BotChannelDeployment" SET "claimsPausedAt" = clock_timestamp(),
        "dispatchFenceEpoch" = "dispatchFenceEpoch" + 1, "updatedAt" = clock_timestamp()
      WHERE "businessId" = ${input.businessId} AND "channel" = 'WHATSAPP'::"BotChannel"
        AND "generation" = ${input.expectedGeneration} AND "legacyDispatchCoverageVersion" >= 1 AND "claimsPausedAt" IS NULL
      RETURNING "id", "generation", "dispatchFenceEpoch" AS "fenceEpoch", "claimsPausedAt" AS "pausedAt"
    `)
    if (rows.length !== 1) throw new Error('dispatch pause lost generation or scope is already paused')
    const row = rows[0]!
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotDeploymentAudit" ("id", "businessId", "action", "generation", "actorUserId", "detail")
      VALUES (${randomUUID()}, ${input.businessId}, 'DISPATCH_PAUSED', ${row.generation}, ${input.actorId},
        ${JSON.stringify({ fenceEpoch: row.fenceEpoch, pausedAt: row.pausedAt.toISOString() })}::jsonb)
    `)
    return {
      businessId: input.businessId,
      deploymentId: row.id,
      generation: row.generation,
      fenceEpoch: row.fenceEpoch,
      pausedAt: row.pausedAt
    }
  })
}

async function reconcilePausedScope(client: ActivationClient, handle: DispatchPauseHandle): Promise<DispatchBlockers> {
  return client.$transaction(async (tx) => {
    const scopes = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "BotChannelDeployment"
      WHERE "id" = ${handle.deploymentId} AND "businessId" = ${handle.businessId}
        AND "generation" = ${handle.generation} AND "dispatchFenceEpoch" = ${handle.fenceEpoch}
        AND "claimsPausedAt" = ${handle.pausedAt}
      FOR UPDATE
    `)
    if (scopes.length !== 1) throw new Error('stale dispatch pause handle')

    await tx.$executeRaw(Prisma.sql`
      WITH stale_outbox AS (
        UPDATE "BotOutbox" SET "status" = 'UNKNOWN'::"BotOutboxStatus", "leaseToken" = NULL,
          "leasedUntil" = NULL, "errorCode" = COALESCE("errorCode", 'stale_sending'), "updatedAt" = clock_timestamp()
        WHERE "businessId" = ${handle.businessId} AND "status" = 'SENDING'::"BotOutboxStatus"
          AND "leasedUntil" < clock_timestamp() RETURNING "id"
      )
      UPDATE "BotDispatchClaim" c SET "status" = 'UNKNOWN'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
      FROM stale_outbox o WHERE c."kind" = 'SEND'::"BotDispatchKind" AND c."resourceId" = o."id"
        AND c."status" = 'SENDING'::"BotDispatchStatus"
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotDispatchClaim" c SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
      FROM "BotOutbox" o WHERE c."businessId" = ${handle.businessId} AND c."kind" = 'SEND'::"BotDispatchKind"
        AND c."resourceId" = o."id" AND c."status" IN ('CLAIMED'::"BotDispatchStatus", 'SENDING'::"BotDispatchStatus")
        AND o."status" IN ('ACCEPTED'::"BotOutboxStatus", 'DELIVERED'::"BotOutboxStatus", 'READ'::"BotOutboxStatus",
          'RETRY'::"BotOutboxStatus", 'FAILED'::"BotOutboxStatus", 'POISON'::"BotOutboxStatus", 'SKIPPED'::"BotOutboxStatus")
    `)
    await tx.$executeRaw(Prisma.sql`
      WITH stale_claims AS (
        UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
        WHERE "businessId" = ${handle.businessId} AND "status" = 'CLAIMED'::"BotDispatchStatus"
          AND "claimedUntil" < clock_timestamp() RETURNING "kind", "resourceId"
      )
      UPDATE "BotOutbox" o SET "status" = 'PENDING'::"BotOutboxStatus", "leaseToken" = NULL,
        "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
      FROM stale_claims c WHERE c."kind" = 'SEND'::"BotDispatchKind" AND c."resourceId" = o."id"
        AND o."status" = 'CLAIMED'::"BotOutboxStatus"
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotDispatchClaim" SET "status" = 'UNKNOWN'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
      WHERE "businessId" = ${handle.businessId} AND "status" = 'SENDING'::"BotDispatchStatus"
        AND "claimedUntil" < clock_timestamp()
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotJob" SET "status" = 'RETRY'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
        "availableAt" = clock_timestamp(), "lastError" = COALESCE("lastError", 'lease expired during dispatch pause'),
        "updatedAt" = clock_timestamp()
      WHERE "businessId" = ${handle.businessId} AND "status" = 'LEASED'::"BotJobStatus"
        AND "leasedUntil" < clock_timestamp()
    `)

    const rows = await tx.$queryRaw<DispatchBlockers[]>(Prisma.sql`
      SELECT
        (SELECT count(*) FROM "BotDispatchClaim" WHERE "businessId" = ${handle.businessId} AND "status" = 'CLAIMED'::"BotDispatchStatus")
          + (SELECT count(*) FROM "BotOutbox" WHERE "businessId" = ${handle.businessId} AND "status" = 'CLAIMED'::"BotOutboxStatus")
          + (SELECT count(*) FROM "BotJob" WHERE "businessId" = ${handle.businessId} AND "status" = 'LEASED'::"BotJobStatus") AS "claimed",
        (SELECT count(*) FROM "BotDispatchClaim" WHERE "businessId" = ${handle.businessId} AND "status" = 'SENDING'::"BotDispatchStatus")
          + (SELECT count(*) FROM "BotOutbox" WHERE "businessId" = ${handle.businessId} AND "status" = 'SENDING'::"BotOutboxStatus") AS "sending",
        (SELECT count(*) FROM "BotDispatchClaim" WHERE "businessId" = ${handle.businessId} AND "status" = 'UNKNOWN'::"BotDispatchStatus")
          + (SELECT count(*) FROM "BotOutbox" WHERE "businessId" = ${handle.businessId} AND "status" = 'UNKNOWN'::"BotOutboxStatus") AS "unknown"
    `)
    return rows[0] ?? { claimed: 0n, sending: 0n, unknown: 0n }
  })
}

export async function waitForDispatchQuiescence(input: {
  client: ActivationClient
  handle: DispatchPauseHandle
  timeoutMs?: number
  pollMs?: number
}): Promise<QuiescenceResult> {
  const startedAt = performance.now()
  const deadline = Date.now() + (input.timeoutMs ?? 30_000)
  for (;;) {
    const blockers = await reconcilePausedScope(input.client, input.handle)
    if (blockers.unknown > 0n) {
      botOptionsMetrics.observe('dispatch_quiescence', performance.now() - startedAt, 'error')
      return { kind: 'BLOCKED_UNKNOWN', blockers }
    }
    if (blockers.claimed === 0n && blockers.sending === 0n) {
      botOptionsMetrics.observe('dispatch_quiescence', performance.now() - startedAt)
      return { kind: 'QUIESCENT', blockers }
    }
    if (Date.now() >= deadline) {
      botOptionsMetrics.observe('dispatch_quiescence', performance.now() - startedAt, 'error')
      return { kind: 'TIMEOUT', blockers }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, input.pollMs ?? 50))
  }
}

export async function resumeDispatchScope(input: {
  client: ActivationClient
  handle: DispatchPauseHandle
  actorId: string
}): Promise<void> {
  const result = await waitForDispatchQuiescence({ client: input.client, handle: input.handle, timeoutMs: 0 })
  if (result.kind !== 'QUIESCENT') throw new Error(`dispatch resume blocked: ${result.kind}`)
  await input.client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.handle.businessId)}, 0))
    `)
    const count = await tx.$executeRaw(Prisma.sql`
      UPDATE "BotChannelDeployment" SET "claimsPausedAt" = NULL, "updatedAt" = clock_timestamp()
      WHERE "id" = ${input.handle.deploymentId} AND "businessId" = ${input.handle.businessId}
        AND "generation" = ${input.handle.generation} AND "dispatchFenceEpoch" = ${input.handle.fenceEpoch}
        AND "claimsPausedAt" = ${input.handle.pausedAt}
    `)
    if (count !== 1) throw new Error('stale dispatch pause handle')
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotDeploymentAudit" ("id", "businessId", "action", "generation", "actorUserId", "detail")
      VALUES (${randomUUID()}, ${input.handle.businessId}, 'DISPATCH_RESUMED', ${input.handle.generation}, ${input.actorId},
        ${JSON.stringify({ fenceEpoch: input.handle.fenceEpoch })}::jsonb)
    `)
  })
}

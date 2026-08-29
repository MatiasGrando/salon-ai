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

export type ActivationPreflightEntry = {
  id: string
  status: string
}

/**
 * PII-free, bounded snapshot. IDs are for the authenticated CRM/operator only;
 * callers must not put this structure into metrics or unredacted logs.
 */
export type ActivationPreflightSnapshot = {
  counts: Record<'drafts' | 'legacyDrafts' | 'legacyProtected' | 'inbox' | 'jobs' | 'outbox' | 'holds' | 'deposits' | 'handoffs' | 'unknown', bigint>
  drafts: ActivationPreflightEntry[]
  legacyDrafts: ActivationPreflightEntry[]
  legacyProtected: ActivationPreflightEntry[]
  inbox: ActivationPreflightEntry[]
  jobs: ActivationPreflightEntry[]
  outbox: ActivationPreflightEntry[]
  holds: ActivationPreflightEntry[]
  deposits: ActivationPreflightEntry[]
  handoffs: ActivationPreflightEntry[]
  unknown: ActivationPreflightEntry[]
}

export type ActivationPreflightResult =
  | { kind: 'CLEAN'; handle: DispatchPauseHandle; snapshot: ActivationPreflightSnapshot }
  | { kind: 'BLOCKED'; handle: DispatchPauseHandle; snapshot: ActivationPreflightSnapshot; reason: 'UNKNOWN' | 'PROTECTED_STATE' | 'QUIESCENCE_TIMEOUT' }

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
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotChannelDeployment" ("id","businessId","engineKey","generation","updatedAt")
      VALUES (${randomUUID()},${input.businessId},'legacy-whatsapp',0,clock_timestamp())
      ON CONFLICT ("businessId","channel") DO NOTHING
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
    // Businesses still on the legacy webhook can have no deterministic pointer.
    // Create only an inactive dispatch scope at generation zero; never create a
    // configuration or set activeConfigurationId in this F11.1 operation.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "generation", "legacyDispatchCoverageVersion", "updatedAt")
      SELECT ${randomUUID()}, ${input.businessId}, 'legacy-whatsapp', 0, 1, clock_timestamp()
      WHERE ${input.expectedGeneration} = 0
        AND NOT EXISTS (SELECT 1 FROM "BotChannelDeployment" WHERE "businessId"=${input.businessId} AND "channel"='WHATSAPP'::"BotChannel")
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

/**
 * Crash-recovery seam for an interrupted preflight. The durable deployment row
 * is the source of truth; callers never reconstruct a fence epoch or timestamp
 * from audit JSON. It returns only a currently paused scope at the requested
 * generation, so it cannot resume a newer cutover accidentally.
 */
export async function recoverPausedDispatchScope(input: {
  client: ActivationClient
  businessId: string
  expectedGeneration: number
}): Promise<DispatchPauseHandle | null> {
  return input.client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.businessId)}, 0))
    `)
    const rows = await tx.$queryRaw<Array<{ id: string; generation: number; fenceEpoch: number; pausedAt: Date }>>(Prisma.sql`
      SELECT "id", "generation", "dispatchFenceEpoch" AS "fenceEpoch", "claimsPausedAt" AS "pausedAt"
      FROM "BotChannelDeployment" WHERE "businessId"=${input.businessId} AND "channel"='WHATSAPP'::"BotChannel"
        AND "generation"=${input.expectedGeneration} AND "claimsPausedAt" IS NOT NULL FOR UPDATE
    `)
    if (rows.length === 0) return null
    if (rows.length !== 1) throw new Error('expected exactly one paused dispatch scope')
    const row = rows[0]!
    return { businessId: input.businessId, deploymentId: row.id, generation: row.generation, fenceEpoch: row.fenceEpoch, pausedAt: row.pausedAt }
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
      WHERE "businessId" = ${handle.businessId} AND "kind" <> 'LEGACY_PROCESS'::"BotDispatchKind" AND "status" = 'SENDING'::"BotDispatchStatus"
        AND "claimedUntil" < clock_timestamp()
    `)
    await tx.$executeRaw(Prisma.sql`
      WITH expired AS (
        UPDATE "BotDispatchClaim" SET "status" = 'UNKNOWN'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
        WHERE "businessId" = ${handle.businessId} AND "kind"='LEGACY_PROCESS'::"BotDispatchKind"
          AND "status"='SENDING'::"BotDispatchStatus" AND "claimedUntil" < clock_timestamp()
        RETURNING "claimToken"
      )
      UPDATE "LegacyWhatsAppCutoverInbound" j SET "status"='NORMAL_UNKNOWN'::"LegacyWhatsAppCutoverInboundStatus", "updatedAt"=clock_timestamp()
      FROM expired WHERE j."claimToken"=expired."claimToken" AND j."status"='NORMAL_SENDING'::"LegacyWhatsAppCutoverInboundStatus"
    `)
    await tx.$executeRaw(Prisma.sql`
      WITH expired AS (
        UPDATE "BotDispatchClaim" SET "status" = 'UNKNOWN'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
        WHERE "businessId" = ${handle.businessId} AND "kind" = 'LEGACY_PROCESS'::"BotDispatchKind"
          AND "status" = 'CLAIMED'::"BotDispatchStatus" AND "claimedUntil" < clock_timestamp()
        RETURNING "claimToken"
      )
      UPDATE "LegacyWhatsAppCutoverInbound" j SET "status"='NORMAL_UNKNOWN'::"LegacyWhatsAppCutoverInboundStatus", "updatedAt"=clock_timestamp()
      FROM expired WHERE j."claimToken"=expired."claimToken" AND j."status"='NORMAL_CLAIMED'::"LegacyWhatsAppCutoverInboundStatus"
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

function hasProtectedPreflightState(snapshot: ActivationPreflightSnapshot): boolean {
  return snapshot.counts.inbox > 0n || snapshot.counts.jobs > 0n || snapshot.counts.outbox > 0n
    || snapshot.counts.holds > 0n || snapshot.counts.deposits > 0n || snapshot.counts.handoffs > 0n || snapshot.counts.legacyProtected > 0n
}

/**
 * Reads the F11.1 state only after proving that the exact paused deployment
 * fence is still current. CONFIRMED visits and APPROVED deposits are
 * deliberately absent: without an active process they are not cutover state.
 */
export async function collectActivationPreflight(input: {
  client: ActivationClient
  handle: DispatchPauseHandle
  limit?: number
}): Promise<ActivationPreflightSnapshot> {
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('preflight limit must be an integer between 1 and 200')
  return input.client.$transaction(async (tx) => {
    const scope = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "BotChannelDeployment"
      WHERE "id" = ${input.handle.deploymentId} AND "businessId" = ${input.handle.businessId}
        AND "generation" = ${input.handle.generation} AND "dispatchFenceEpoch" = ${input.handle.fenceEpoch}
        AND "claimsPausedAt" = ${input.handle.pausedAt}
      FOR UPDATE
    `)
    if (scope.length !== 1) throw new Error('stale dispatch pause handle')
    const entries = async (query: Prisma.Sql): Promise<ActivationPreflightEntry[]> => tx.$queryRaw<ActivationPreflightEntry[]>(query)
    const [drafts, legacyDrafts, legacyProtected, inbox, jobs, outbox, holds, deposits, handoffs, unknown, countRows] = await Promise.all([
      entries(Prisma.sql`SELECT "id", COALESCE("state"->>'booking', 'UNKNOWN_STATE') AS "status" FROM "BotSession"
        WHERE "businessId" = ${input.handle.businessId} AND "status" = 'ACTIVE'::"BotSessionStatus"
          AND "state"->>'booking' = 'DRAFT' ORDER BY "updatedAt", "id" LIMIT ${limit}`),
      entries(Prisma.sql`SELECT "id", "currentStep"::text AS "status" FROM "Conversation"
        WHERE "businessId"=${input.handle.businessId} AND "archivedAt" IS NULL
          AND "currentStep" NOT IN ('START'::"ConversationStep", 'COMPLETED'::"ConversationStep", 'AWAITING_DEPOSIT'::"ConversationStep", 'HUMAN_HANDOFF'::"ConversationStep")
        ORDER BY "updatedAt", "id" LIMIT ${limit}`),
      entries(Prisma.sql`SELECT "id", "currentStep"::text AS "status" FROM "Conversation"
        WHERE "businessId"=${input.handle.businessId} AND "archivedAt" IS NULL
          AND "currentStep" IN ('AWAITING_DEPOSIT'::"ConversationStep", 'HUMAN_HANDOFF'::"ConversationStep")
        UNION ALL
        SELECT "id", 'PAUSED_ADMITTED'::text AS "status" FROM "LegacyWhatsAppCutoverInbound"
        WHERE "businessId"=${input.handle.businessId} AND "status"='PAUSED_ADMITTED'::"LegacyWhatsAppCutoverInboundStatus"
        ORDER BY "id" LIMIT ${limit}`),
      entries(Prisma.sql`SELECT "id", "status"::text AS "status" FROM "BotActionInbox"
        WHERE "businessId" = ${input.handle.businessId} AND "status" IN ('ADMITTED'::"BotInboxStatus", 'CLAIMED'::"BotInboxStatus", 'SELECTED'::"BotInboxStatus")
        ORDER BY "receivedAt", "id" LIMIT ${limit}`),
      entries(Prisma.sql`SELECT "id", "status"::text AS "status" FROM "BotJob"
        WHERE "businessId" = ${input.handle.businessId} AND "status" IN ('READY'::"BotJobStatus", 'LEASED'::"BotJobStatus", 'RETRY'::"BotJobStatus", 'POISON'::"BotJobStatus")
        ORDER BY "createdAt", "id" LIMIT ${limit}`),
      entries(Prisma.sql`SELECT "id", "status"::text AS "status" FROM "BotOutbox"
        WHERE "businessId" = ${input.handle.businessId} AND "status" IN ('PENDING'::"BotOutboxStatus", 'CLAIMED'::"BotOutboxStatus", 'SENDING'::"BotOutboxStatus", 'RETRY'::"BotOutboxStatus", 'POISON'::"BotOutboxStatus")
        ORDER BY "createdAt", "id" LIMIT ${limit}`),
      entries(Prisma.sql`SELECT "id", "status"::text AS "status" FROM "BookingVisit"
        WHERE "businessId" = ${input.handle.businessId} AND "status" IN ('HELD'::"BookingVisitStatus", 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus")
        ORDER BY "updatedAt", "id" LIMIT ${limit}`),
      entries(Prisma.sql`SELECT "id", "status"::text AS "status" FROM "BookingDeposit"
        WHERE "businessId" = ${input.handle.businessId} AND "status" IN ('PENDING_PROOF'::"BookingDepositStatus", 'PENDING_RESUBMISSION'::"BookingDepositStatus", 'PROOF_RECEIVED'::"BookingDepositStatus")
        ORDER BY "updatedAt", "id" LIMIT ${limit}`),
      entries(Prisma.sql`SELECT "id", "status"::text AS "status" FROM "BotHandoff"
        WHERE "businessId" = ${input.handle.businessId} AND "status" IN ('QUEUED'::"BotHandoffStatus", 'TAKEN'::"BotHandoffStatus")
        ORDER BY "queuedAt", "id" LIMIT ${limit}`),
      entries(Prisma.sql`SELECT "id", 'OUTBOX_UNKNOWN'::text AS "status" FROM "BotOutbox"
        WHERE "businessId" = ${input.handle.businessId} AND "status" = 'UNKNOWN'::"BotOutboxStatus"
        UNION ALL
         SELECT "id", 'DISPATCH_UNKNOWN'::text AS "status" FROM "BotDispatchClaim"
         WHERE "businessId" = ${input.handle.businessId} AND "kind" <> 'LEGACY_PROCESS'::"BotDispatchKind" AND "status" = 'UNKNOWN'::"BotDispatchStatus"
         UNION ALL
         SELECT "id", 'LEGACY_PROCESS_UNKNOWN'::text AS "status" FROM "BotDispatchClaim"
         WHERE "businessId" = ${input.handle.businessId} AND "kind" = 'LEGACY_PROCESS'::"BotDispatchKind" AND "status" = 'UNKNOWN'::"BotDispatchStatus"
         LIMIT ${limit}`),
      tx.$queryRaw<Array<Record<keyof ActivationPreflightSnapshot['counts'], bigint>>>(Prisma.sql`
        SELECT
          (SELECT count(*) FROM "BotSession" WHERE "businessId"=${input.handle.businessId} AND "status"='ACTIVE'::"BotSessionStatus" AND "state"->>'booking'='DRAFT') AS "drafts",
          (SELECT count(*) FROM "Conversation" WHERE "businessId"=${input.handle.businessId} AND "archivedAt" IS NULL AND "currentStep" NOT IN ('START'::"ConversationStep",'COMPLETED'::"ConversationStep",'AWAITING_DEPOSIT'::"ConversationStep",'HUMAN_HANDOFF'::"ConversationStep")) AS "legacyDrafts",
           ((SELECT count(*) FROM "Conversation" WHERE "businessId"=${input.handle.businessId} AND "archivedAt" IS NULL AND "currentStep" IN ('AWAITING_DEPOSIT'::"ConversationStep",'HUMAN_HANDOFF'::"ConversationStep")) + (SELECT count(*) FROM "LegacyWhatsAppCutoverInbound" WHERE "businessId"=${input.handle.businessId} AND "status"='PAUSED_ADMITTED'::"LegacyWhatsAppCutoverInboundStatus")) AS "legacyProtected",
          (SELECT count(*) FROM "BotActionInbox" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('ADMITTED'::"BotInboxStatus",'CLAIMED'::"BotInboxStatus",'SELECTED'::"BotInboxStatus")) AS "inbox",
          (SELECT count(*) FROM "BotJob" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('READY'::"BotJobStatus",'LEASED'::"BotJobStatus",'RETRY'::"BotJobStatus",'POISON'::"BotJobStatus")) AS "jobs",
          (SELECT count(*) FROM "BotOutbox" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('PENDING'::"BotOutboxStatus",'CLAIMED'::"BotOutboxStatus",'SENDING'::"BotOutboxStatus",'RETRY'::"BotOutboxStatus",'POISON'::"BotOutboxStatus")) AS "outbox",
          (SELECT count(*) FROM "BookingVisit" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('HELD'::"BookingVisitStatus",'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus")) AS "holds",
          (SELECT count(*) FROM "BookingDeposit" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('PENDING_PROOF'::"BookingDepositStatus",'PENDING_RESUBMISSION'::"BookingDepositStatus",'PROOF_RECEIVED'::"BookingDepositStatus")) AS "deposits",
          (SELECT count(*) FROM "BotHandoff" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('QUEUED'::"BotHandoffStatus",'TAKEN'::"BotHandoffStatus")) AS "handoffs",
           ((SELECT count(*) FROM "BotOutbox" WHERE "businessId"=${input.handle.businessId} AND "status"='UNKNOWN'::"BotOutboxStatus") + (SELECT count(*) FROM "BotDispatchClaim" WHERE "businessId"=${input.handle.businessId} AND "status"='UNKNOWN'::"BotDispatchStatus")) AS "unknown"
      `)
    ])
    const counts = countRows[0]
    if (!counts) throw new Error('activation preflight count query returned no row')
    return { counts, drafts, legacyDrafts, legacyProtected, inbox, jobs, outbox, holds, deposits, handoffs, unknown }
  })
}

async function auditActivationPreflight(client: ActivationClient, handle: DispatchPauseHandle, actorId: string, snapshot: ActivationPreflightSnapshot, outcome: string): Promise<void> {
  const counts = Object.fromEntries(Object.entries(snapshot.counts).map(([name, count]) => [name, count.toString()]))
  await client.$transaction(async (tx) => {
    const scope = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "BotChannelDeployment" WHERE "id"=${handle.deploymentId} AND "businessId"=${handle.businessId}
        AND "generation"=${handle.generation} AND "dispatchFenceEpoch"=${handle.fenceEpoch} AND "claimsPausedAt"=${handle.pausedAt} FOR UPDATE
    `)
    if (scope.length !== 1) throw new Error('stale dispatch pause handle')
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotDeploymentAudit" ("id","businessId","action","generation","actorUserId","detail")
      VALUES (${randomUUID()},${handle.businessId},'ACTIVATION_PREFLIGHT',${handle.generation},${actorId},${JSON.stringify({ outcome, counts, fenceEpoch: handle.fenceEpoch })}::jsonb)
    `)
  })
}

/**
 * F11.1 owns only pause/drain/snapshot. It intentionally keeps a clean scope
 * paused for F11.2's atomic pointer change; callers may resume only through
 * resumeDispatchScope after an aborted operation or audited resolution.
 */
export async function startActivationPreflight(input: {
  client: ActivationClient
  businessId: string
  expectedGeneration: number
  actorId: string
  legacyCoverageComplete: boolean
  timeoutMs?: number
  pollMs?: number
  limit?: number
}): Promise<ActivationPreflightResult> {
  const handle = await pauseDispatchScope(input)
  const quiescence = await waitForDispatchQuiescence({
    client: input.client,
    handle,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.pollMs === undefined ? {} : { pollMs: input.pollMs })
  })
  const snapshot = await collectActivationPreflight({
    client: input.client,
    handle,
    ...(input.limit === undefined ? {} : { limit: input.limit })
  })
  if (quiescence.kind === 'BLOCKED_UNKNOWN' || snapshot.unknown.length > 0) {
    await auditActivationPreflight(input.client, handle, input.actorId, snapshot, 'BLOCKED_UNKNOWN')
    return { kind: 'BLOCKED', handle, snapshot, reason: 'UNKNOWN' }
  }
  if (quiescence.kind === 'TIMEOUT') {
    await auditActivationPreflight(input.client, handle, input.actorId, snapshot, 'BLOCKED_QUIESCENCE_TIMEOUT')
    return { kind: 'BLOCKED', handle, snapshot, reason: 'QUIESCENCE_TIMEOUT' }
  }
  if (hasProtectedPreflightState(snapshot)) {
    await auditActivationPreflight(input.client, handle, input.actorId, snapshot, 'BLOCKED_PROTECTED_STATE')
    return { kind: 'BLOCKED', handle, snapshot, reason: 'PROTECTED_STATE' }
  }
  await auditActivationPreflight(input.client, handle, input.actorId, snapshot, 'CLEAN')
  return { kind: 'CLEAN', handle, snapshot }
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

export type RoutingSwitchResult = {
  kind: 'SWITCHED'
  deploymentId: string
  generation: number
  engineKey: 'deterministic-options' | 'legacy-whatsapp'
  activeConfigurationId: string | null
  previousConfigurationId: string | null
}

export async function assertActivatableConfiguration(input: {
  client: ActivationClient
  businessId: string
  configurationId: string
}): Promise<void> {
  await input.client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "BusinessBotConfiguration"
      WHERE "id"=${input.configurationId} AND "businessId"=${input.businessId}
        AND "status"='ACTIVE' AND "routingMode"='EXCLUSIVE'
      FOR SHARE
    `)
    if (rows.length !== 1) throw new Error('activation target must be one ACTIVE EXCLUSIVE configuration in the same business')
  })
}

/**
 * F11.2/F11.3 final commit. The paused fence, protected-state recheck,
 * disposable-runtime invalidation, pointer mutation and audit are one atomic
 * unit. A failed recheck deliberately leaves the already committed pause in
 * place for operator inspection; it never resumes an unsafe scope.
 */
export async function switchPausedRouting(input: {
  client: ActivationClient
  handle: DispatchPauseHandle
  actorId: string
  action: 'ACTIVATE' | 'ROLLBACK'
  targetConfigurationId: string | null
}): Promise<RoutingSwitchResult> {
  if (!input.actorId.trim()) throw new Error('routing switch requires actor')
  return input.client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.handle.businessId)}, 0))
    `)
    const scopes = await tx.$queryRaw<Array<{ id: string; engineKey: string; activeConfigurationId: string | null }>>(Prisma.sql`
      SELECT "id", "engineKey", "activeConfigurationId"
      FROM "BotChannelDeployment"
      WHERE "id"=${input.handle.deploymentId} AND "businessId"=${input.handle.businessId}
        AND "channel"='WHATSAPP'::"BotChannel" AND "generation"=${input.handle.generation}
        AND "dispatchFenceEpoch"=${input.handle.fenceEpoch} AND "claimsPausedAt"=${input.handle.pausedAt}
        AND "legacyDispatchCoverageVersion">=1
      FOR UPDATE
    `)
    if (scopes.length !== 1) throw new Error('stale dispatch pause handle')

    if (input.targetConfigurationId !== null) {
      const targets = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "BusinessBotConfiguration"
        WHERE "id"=${input.targetConfigurationId} AND "businessId"=${input.handle.businessId}
          AND "status"='ACTIVE' AND "routingMode"='EXCLUSIVE'
        FOR SHARE
      `)
      if (targets.length !== 1) throw new Error('activation target must be one ACTIVE EXCLUSIVE configuration in the same business')
    }

    const protectedRows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT (
        (SELECT count(*) FROM "LegacyWhatsAppCutoverInbound" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('PAUSED_ADMITTED'::"LegacyWhatsAppCutoverInboundStatus",'NORMAL_CLAIMED'::"LegacyWhatsAppCutoverInboundStatus",'NORMAL_SENDING'::"LegacyWhatsAppCutoverInboundStatus",'NORMAL_UNKNOWN'::"LegacyWhatsAppCutoverInboundStatus"))
        + (SELECT count(*) FROM "BotActionInbox" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('ADMITTED'::"BotInboxStatus",'CLAIMED'::"BotInboxStatus",'SELECTED'::"BotInboxStatus"))
        + (SELECT count(*) FROM "BotJob" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('READY'::"BotJobStatus",'LEASED'::"BotJobStatus",'RETRY'::"BotJobStatus",'POISON'::"BotJobStatus"))
        + (SELECT count(*) FROM "BotOutbox" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('PENDING'::"BotOutboxStatus",'CLAIMED'::"BotOutboxStatus",'SENDING'::"BotOutboxStatus",'UNKNOWN'::"BotOutboxStatus",'RETRY'::"BotOutboxStatus",'POISON'::"BotOutboxStatus"))
        + (SELECT count(*) FROM "BotDispatchClaim" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('CLAIMED'::"BotDispatchStatus",'SENDING'::"BotDispatchStatus",'UNKNOWN'::"BotDispatchStatus"))
        + (SELECT count(*) FROM "BookingVisit" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('HELD'::"BookingVisitStatus",'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus"))
        + (SELECT count(*) FROM "BookingDeposit" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('PENDING_PROOF'::"BookingDepositStatus",'PENDING_RESUBMISSION'::"BookingDepositStatus",'PROOF_RECEIVED'::"BookingDepositStatus"))
        + (SELECT count(*) FROM "BotHandoff" WHERE "businessId"=${input.handle.businessId} AND "status" IN ('QUEUED'::"BotHandoffStatus",'TAKEN'::"BotHandoffStatus"))
        + (SELECT count(*) FROM "Conversation" WHERE "businessId"=${input.handle.businessId} AND "archivedAt" IS NULL AND "currentStep" IN ('AWAITING_DEPOSIT'::"ConversationStep",'HUMAN_HANDOFF'::"ConversationStep"))
      ) AS "count"
    `)
    if ((protectedRows[0]?.count ?? 0n) > 0n) throw new Error('routing switch blocked: protected state changed after preflight')

    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotPrompt" p SET "status"='INVALIDATED'::"BotPromptStatus", "resolvedAt"=clock_timestamp()
      FROM "BotSession" s
      WHERE p."sessionId"=s."id" AND s."businessId"=${input.handle.businessId}
        AND p."status" IN ('OPEN'::"BotPromptStatus",'STABILIZING'::"BotPromptStatus")
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotSession" SET "status"='CLOSED'::"BotSessionStatus", "updatedAt"=clock_timestamp()
      WHERE "businessId"=${input.handle.businessId} AND "status"='ACTIVE'::"BotSessionStatus"
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Conversation" SET "currentStep"='START'::"ConversationStep",
        "selectedServiceId"=NULL,"selectedProfessionalId"=NULL,"selectedDate"=NULL,"selectedTime"=NULL,
        "selectedCustomerName"=NULL,"lastAvailability"=NULL,"bookingV2State"=NULL,
        "botProcessingToken"=NULL,"botProcessingUntil"=NULL,"activeInteractivePromptToken"=NULL,
        "updatedAt"=clock_timestamp()
      WHERE "businessId"=${input.handle.businessId} AND "archivedAt" IS NULL
        AND "currentStep" NOT IN ('START'::"ConversationStep",'COMPLETED'::"ConversationStep",'AWAITING_DEPOSIT'::"ConversationStep",'HUMAN_HANDOFF'::"ConversationStep")
    `)

    const previousConfigurationId = scopes[0]!.activeConfigurationId
    const engineKey = input.targetConfigurationId === null ? 'legacy-whatsapp' : 'deterministic-options'
    const switched = await tx.$queryRaw<Array<{ generation: number }>>(Prisma.sql`
      UPDATE "BotChannelDeployment" SET
        "engineKey"=${engineKey},
        "previousConfigurationId"=${previousConfigurationId},
        "activeConfigurationId"=${input.targetConfigurationId},
        "generation"="generation"+1,
        "activatedAt"=clock_timestamp(),
        "activatedByUserId"=${input.actorId},
        "claimsPausedAt"=NULL,
        "updatedAt"=clock_timestamp()
      WHERE "id"=${input.handle.deploymentId} AND "generation"=${input.handle.generation}
        AND "dispatchFenceEpoch"=${input.handle.fenceEpoch} AND "claimsPausedAt"=${input.handle.pausedAt}
      RETURNING "generation"
    `)
    if (switched.length !== 1) throw new Error('routing switch lost paused fence')
    const generation = switched[0]!.generation
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotDeploymentAudit" ("id","businessId","action","previousConfigId","newConfigId","generation","actorUserId","detail")
      VALUES (${randomUUID()},${input.handle.businessId},${input.action},${previousConfigurationId},${input.targetConfigurationId},${generation},${input.actorId},
        ${JSON.stringify({ previousEngineKey: scopes[0]!.engineKey, newEngineKey: engineKey, fenceEpoch: input.handle.fenceEpoch })}::jsonb)
    `)
    return {
      kind: 'SWITCHED', deploymentId: input.handle.deploymentId, generation, engineKey,
      activeConfigurationId: input.targetConfigurationId, previousConfigurationId
    }
  })
}

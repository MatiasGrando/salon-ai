import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { botOptionsMetrics } from '../observability/metrics.js'
import { createMaintenanceCadence } from './maintenance-cadence.js'

export type ClaimedBotJob = {
  id: string
  kind: string
  aggregateId: string
  businessId: string
  deploymentId: string
  deploymentGeneration: number
  expectedRevision: bigint | null
  attempts: number
  maxAttempts: number
  claimToken: string
  claimedUntil: Date
  queueWaitMs: number
}

export type BotJobLatencyDiagnostic = {
  resource: 'job'
  resourceId: string
  kind: string
  phase: 'claim' | 'queue' | 'processing' | 'finalize'
  durationMs: number
  outcome: 'ok' | 'error' | 'retry' | 'poison' | 'stale' | 'handler_settled'
}

type WorkerClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>

const SYSTEM_RECOVERY_JOB_KINDS = ['EXPIRE_DEPOSIT', 'BRIDGE_DEPOSIT_NOTIFICATION'] as const
const CUTOVER_RETARGETABLE_JOB_KINDS = ['RECEIVE_DEPOSIT_PROOF', 'PROCESS_PROVIDER_EVENT'] as const

/** Explicit timeout prevents the default 5s Prisma budget from killing claim polling under contention. */
const CLAIM_JOB_TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 8_000 } as const
export const WORKER_MAINTENANCE_INTERVAL_MS = 30_000

function systemRecoveryJobSql(column: string) {
  return Prisma.raw(`"${column}"."kind" IN (${SYSTEM_RECOVERY_JOB_KINDS.map((kind) => `'${kind}'`).join(', ')})`)
}

function cutoverRetargetableJobSql(column: string) {
  return Prisma.raw(`"${column}"."kind" IN (${CUTOVER_RETARGETABLE_JOB_KINDS.map((kind) => `'${kind}'`).join(', ')})`)
}

/**
 * Session-bound automation must never acquire work after human ownership, nor
 * while TAKE's per-session fence is closed.  The latter closes the
 * drain-to-finalize race: a worker which selected a READY row before TAKE
 * must recheck this predicate before leasing it.
 */
function humanTakenSessionJobSql(column: string) {
  return Prisma.raw(`EXISTS (
    SELECT 1 FROM "BotSession" s
    JOIN "BotHandoff" h ON h."businessId" = s."businessId" AND h."sessionId" = s."id"
    JOIN "Conversation" c ON c."id" = s."conversationId" AND c."businessId" = s."businessId"
    WHERE s."businessId" = "${column}"."businessId"
       AND (
         (s."status" = 'HUMAN_TAKEN'::"BotSessionStatus" AND h."status" = 'TAKEN'::"BotHandoffStatus")
         OR s."handoffClaimsPausedAt" IS NOT NULL
       )
      AND (
        EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."id" = "${column}"."aggregateId" AND i."sessionId" = s."id")
        OR EXISTS (SELECT 1 FROM "BotPrompt" p WHERE p."id" = "${column}"."aggregateId" AND p."sessionId" = s."id")
        OR EXISTS (
          SELECT 1 FROM "BotProviderEvent" e
          WHERE e."businessId" = s."businessId" AND e."eventType" = 'MESSAGE'::"BotProviderEventType"
            AND e."payload" ->> 'fromPhone' = c."phone"
            AND (
              e."id" = "${column}"."aggregateId"
              OR EXISTS (SELECT 1 FROM "BotActionInbox" i WHERE i."id" = "${column}"."aggregateId" AND i."providerEventId" = e."id")
            )
        )
      )
  )`)
}

export async function claimBotJob(
  client: WorkerClient,
  leaseMs = 30_000,
  token = randomUUID(),
  scope?: { businessId: string }
): Promise<ClaimedBotJob | null> {
  const candidateScope = scope ? Prisma.sql`AND j."businessId" = ${scope.businessId}` : Prisma.empty
  const claimed = await client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedBotJob[]>(Prisma.sql`
      WITH candidate AS MATERIALIZED (
        SELECT j."id", j."businessId" FROM "BotJob" j
        JOIN "BotChannelDeployment" d ON d."id" = j."deploymentId" AND d."businessId" = j."businessId"
        WHERE ((j."status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus") AND j."availableAt" <= clock_timestamp())
            OR (j."status" = 'LEASED'::"BotJobStatus" AND j."leasedUntil" < clock_timestamp()))
          AND j."attempts" < j."maxAttempts"
          ${candidateScope}
          AND (${systemRecoveryJobSql('j')} OR (${cutoverRetargetableJobSql('j')}
            AND j."deploymentGeneration" <= d."generation"
            AND d."channel" = 'WHATSAPP'::"BotChannel"
            AND d."engineKey" = 'deterministic-options'
            AND d."activeConfigurationId" IS NOT NULL
            AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
          ) OR (
            d."generation" = j."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
            AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
          )) AND (j."kind" = 'PROCESS_PROVIDER_EVENT' OR NOT (${humanTakenSessionJobSql('j')}))
        ORDER BY j."availableAt", j."createdAt", j."id" FOR UPDATE OF j SKIP LOCKED LIMIT 1
      ), cutover_lock AS MATERIALIZED (
        SELECT c."id", c."businessId",
          pg_advisory_xact_lock_shared(hashtextextended('bot-cutover:' || c."businessId" || ':WHATSAPP', 0)) AS locked
        FROM candidate c
      )
      UPDATE "BotJob" j SET "status" = 'LEASED'::"BotJobStatus", "attempts" = j."attempts" + 1,
        "leaseToken" = ${token}, "leasedUntil" = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
        "updatedAt" = clock_timestamp()
      FROM cutover_lock c
      WHERE j."id" = c."id" AND EXISTS (
        SELECT 1 FROM "BotChannelDeployment" d WHERE d."id" = j."deploymentId" AND d."businessId" = j."businessId"
          AND (${systemRecoveryJobSql('j')} OR (${cutoverRetargetableJobSql('j')}
            AND j."deploymentGeneration" <= d."generation"
            AND d."channel" = 'WHATSAPP'::"BotChannel"
            AND d."engineKey" = 'deterministic-options'
            AND d."activeConfigurationId" IS NOT NULL
            AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
          ) OR (
            d."generation" = j."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
            AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
          )) AND (j."kind" = 'PROCESS_PROVIDER_EVENT' OR NOT (${humanTakenSessionJobSql('j')}))
      )
      RETURNING j."id", j."kind", j."aggregateId", j."businessId", j."deploymentId",
        j."deploymentGeneration", j."expectedRevision", j."attempts", j."maxAttempts",
        j."leaseToken" AS "claimToken", j."leasedUntil" AS "claimedUntil",
        (EXTRACT(EPOCH FROM (clock_timestamp() - j."createdAt")) * 1000)::double precision AS "queueWaitMs"
    `)
    return rows[0] ?? null
  }, CLAIM_JOB_TRANSACTION_OPTIONS)
  if (claimed) botOptionsMetrics.observe('admitted_to_claim', claimed.queueWaitMs)
  return claimed
}

export async function maintainBotJobs(client: WorkerClient, scope?: { businessId: string }): Promise<number> {
  const maintenanceScope = scope ? Prisma.sql`AND "businessId" = ${scope.businessId}` : Prisma.empty
  return client.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET
      "status" = CASE WHEN "kind" IN ('EXPIRE_DEPOSIT', 'BRIDGE_DEPOSIT_NOTIFICATION') THEN 'RETRY'::"BotJobStatus" ELSE 'POISON'::"BotJobStatus" END,
      "attempts" = CASE WHEN "kind" IN ('EXPIRE_DEPOSIT', 'BRIDGE_DEPOSIT_NOTIFICATION') THEN 0 ELSE "attempts" END,
      "availableAt" = CASE WHEN "kind" IN ('EXPIRE_DEPOSIT', 'BRIDGE_DEPOSIT_NOTIFICATION') THEN clock_timestamp() + interval '5 minutes' ELSE "availableAt" END,
      "leaseToken" = NULL, "leasedUntil" = NULL,
      "lastError" = CASE WHEN "kind" IN ('EXPIRE_DEPOSIT', 'BRIDGE_DEPOSIT_NOTIFICATION')
        THEN "kind" || ' recovery after exhausted stale lease: ' || COALESCE("lastError", 'claim expired after max attempts')
        ELSE COALESCE("lastError", 'claim expired after max attempts') END,
      "updatedAt" = clock_timestamp()
    WHERE "status" = 'LEASED'::"BotJobStatus" AND "leasedUntil" < clock_timestamp() AND "attempts" >= "maxAttempts"
      ${maintenanceScope}
  `)
}

export async function assertClaimedBotJobTx(
  tx: Prisma.TransactionClient,
  job: ClaimedBotJob,
  options: { requireCurrentDeployment?: boolean } = {}
): Promise<void> {
  const requireCurrentDeployment = options.requireCurrentDeployment ?? true
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${job.businessId}:WHATSAPP`}, 0))
  `)
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT j."id" FROM "BotJob" j
    JOIN "BotChannelDeployment" d ON d."id" = j."deploymentId" AND d."businessId" = j."businessId"
    WHERE j."id" = ${job.id} AND j."status" = 'LEASED'::"BotJobStatus" AND j."leaseToken" = ${job.claimToken}
      AND j."leasedUntil" > clock_timestamp() AND j."businessId" = ${job.businessId}
      AND j."deploymentId" = ${job.deploymentId} AND j."deploymentGeneration" = ${job.deploymentGeneration}
      AND (${requireCurrentDeployment} = false OR (
        d."generation" = j."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
        AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
      ))
    FOR UPDATE OF j
  `)
  if (rows.length !== 1) throw new Error('stale or fenced bot job claim')
}

export async function rescheduleClaimedBotJobTx(
  tx: Prisma.TransactionClient,
  job: ClaimedBotJob,
  availableAt: Date,
  options: { refundClaimAttempt?: boolean } = {}
): Promise<void> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "status" = 'READY'::"BotJobStatus", "availableAt" = ${availableAt},
      "attempts" = CASE WHEN ${options.refundClaimAttempt === true} THEN GREATEST("attempts" - 1, 0) ELSE "attempts" END,
      "leaseToken" = NULL, "leasedUntil" = NULL, "updatedAt" = clock_timestamp()
    WHERE "id" = ${job.id} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${job.claimToken}
  `)
  if (count !== 1) throw new Error('cannot reschedule stale bot job claim')
}

export async function completeClaimedBotJobTx(
  tx: Prisma.TransactionClient,
  job: ClaimedBotJob
): Promise<void> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "status" = 'DONE'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
      "lastError" = NULL, "updatedAt" = clock_timestamp()
    WHERE "id" = ${job.id} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${job.claimToken}
  `)
  if (count !== 1) throw new Error('cannot complete stale bot job claim')
}

export async function poisonClaimedBotJobTx(
  tx: Prisma.TransactionClient,
  job: ClaimedBotJob,
  error: string
): Promise<void> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "status" = 'POISON'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
      "lastError" = ${error.slice(0, 2000)}, "updatedAt" = clock_timestamp()
    WHERE "id" = ${job.id} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${job.claimToken}
  `)
  if (count !== 1) throw new Error('cannot poison stale bot job claim')
}

export async function retargetClaimedBotJobTx(
  tx: Prisma.TransactionClient,
  job: ClaimedBotJob,
  target: { deploymentId: string; generation: number }
): Promise<ClaimedBotJob> {
  await assertClaimedBotJobTx(tx, job, { requireCurrentDeployment: false })
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "deploymentId" = ${target.deploymentId}, "deploymentGeneration" = ${target.generation},
      "updatedAt" = clock_timestamp()
    WHERE "id" = ${job.id} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${job.claimToken}
  `)
  if (count !== 1) throw new Error('cannot retarget stale bot job claim')
  return { ...job, deploymentId: target.deploymentId, deploymentGeneration: target.generation }
}

export async function completeBotJob(client: WorkerClient, id: string, claimToken: string): Promise<boolean> {
  const count = await client.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "status" = 'DONE'::"BotJobStatus", "leaseToken" = NULL,
      "leasedUntil" = NULL, "lastError" = NULL, "updatedAt" = clock_timestamp()
    WHERE "id" = ${id} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${claimToken}
  `)
  return count === 1
}

export async function retryBotJob(
  client: WorkerClient,
  id: string,
  claimToken: string,
  error: string,
  delayMs: number
): Promise<'RETRY' | 'POISON' | 'STALE'> {
  const rows = await client.$queryRaw<Array<{ status: 'RETRY' | 'POISON' }>>(Prisma.sql`
    UPDATE "BotJob" SET
      "status" = CASE
        WHEN "kind" IN ('EXPIRE_DEPOSIT', 'BRIDGE_DEPOSIT_NOTIFICATION') THEN 'RETRY'::"BotJobStatus"
        WHEN "attempts" >= "maxAttempts" THEN 'POISON'::"BotJobStatus"
        ELSE 'RETRY'::"BotJobStatus"
      END,
      "attempts" = CASE WHEN "kind" IN ('EXPIRE_DEPOSIT', 'BRIDGE_DEPOSIT_NOTIFICATION') AND "attempts" >= "maxAttempts" THEN 0 ELSE "attempts" END,
      "availableAt" = clock_timestamp() + (
        CASE WHEN "kind" IN ('EXPIRE_DEPOSIT', 'BRIDGE_DEPOSIT_NOTIFICATION') AND "attempts" >= "maxAttempts" THEN 300000 ELSE ${delayMs} END
        * interval '1 millisecond'
      ),
      "leaseToken" = NULL, "leasedUntil" = NULL, "lastError" = ${error.slice(0, 2000)},
      "updatedAt" = clock_timestamp()
    WHERE "id" = ${id} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${claimToken}
    RETURNING "status"::text AS "status"
  `)
  return rows[0]?.status ?? 'STALE'
}

export type WorkerLoop = { stop(): Promise<void> }

export async function runClaimedBotJob(input: {
  client: WorkerClient
  job: ClaimedBotJob
  handle(job: ClaimedBotJob): Promise<void>
  handlerSettlesJob?: boolean
  onError?: (error: unknown) => void
  onDiagnostic?: (diagnostic: BotJobLatencyDiagnostic) => void
}): Promise<void> {
  const emit = (diagnostic: BotJobLatencyDiagnostic) => {
    try { input.onDiagnostic?.(diagnostic) } catch { /* diagnostics never affect delivery */ }
  }
  const processingStartedAt = performance.now()
  try {
    await input.handle(input.job)
  } catch (error) {
    const processingMs = performance.now() - processingStartedAt
    botOptionsMetrics.observe('worker_processing', processingMs, 'error')
    emit({ resource: 'job', resourceId: input.job.id, kind: input.job.kind, phase: 'processing', durationMs: processingMs, outcome: 'error' })
    const message = error instanceof Error ? error.message : String(error)
    const finalizeStartedAt = performance.now()
    const retry = await retryBotJob(input.client, input.job.id, input.job.claimToken, message, 1000)
    const finalizeMs = performance.now() - finalizeStartedAt
    botOptionsMetrics.observe('worker_finalize', finalizeMs, retry === 'STALE' ? 'error' : 'ok')
    const outcome = retry === 'STALE' ? 'stale' : retry === 'POISON' ? 'poison' : 'retry'
    emit({ resource: 'job', resourceId: input.job.id, kind: input.job.kind, phase: 'finalize', durationMs: finalizeMs, outcome })
    input.onError?.(error)
    return
  }

  const processingMs = performance.now() - processingStartedAt
  botOptionsMetrics.observe('worker_processing', processingMs)
  emit({ resource: 'job', resourceId: input.job.id, kind: input.job.kind, phase: 'processing', durationMs: processingMs, outcome: 'ok' })
  if (input.handlerSettlesJob) {
    // Successful return guarantees that this handler already completed,
    // rescheduled, or poisoned the leased job transactionally.
    botOptionsMetrics.observe('worker_finalize', 0)
    emit({ resource: 'job', resourceId: input.job.id, kind: input.job.kind, phase: 'finalize', durationMs: 0, outcome: 'handler_settled' })
    return
  }

  const finalizeStartedAt = performance.now()
  const completed = await completeBotJob(input.client, input.job.id, input.job.claimToken)
  const finalizeMs = performance.now() - finalizeStartedAt
  botOptionsMetrics.observe('worker_finalize', finalizeMs, completed ? 'ok' : 'error')
  emit({ resource: 'job', resourceId: input.job.id, kind: input.job.kind, phase: 'finalize', durationMs: finalizeMs, outcome: completed ? 'ok' : 'stale' })
}

export function startPostgresWorkerLoop(input: {
  client: WorkerClient
  handle(job: ClaimedBotJob): Promise<void>
  pollMs?: number
  leaseMs?: number
  maintenanceIntervalMs?: number
  maintenanceEnabled?: boolean
  now?: () => number
  handlerSettlesJob?: boolean
  onError?: (error: unknown) => void
  onDiagnostic?: (diagnostic: BotJobLatencyDiagnostic) => void
}): WorkerLoop {
  let stopped = false
  let running: Promise<void> | null = null
  const pollMs = input.pollMs ?? 250
  const emit = (diagnostic: BotJobLatencyDiagnostic) => {
    try { input.onDiagnostic?.(diagnostic) } catch { /* diagnostics never affect delivery */ }
  }
  const maintenance = input.maintenanceEnabled === false ? null : createMaintenanceCadence({
    intervalMs: input.maintenanceIntervalMs ?? WORKER_MAINTENANCE_INTERVAL_MS,
    now: input.now,
    run: async () => { await maintainBotJobs(input.client) }
  })

  const run = async () => {
    while (!stopped) {
      try {
        await maintenance?.runIfDue()
        const claimStartedAt = performance.now()
        const job = await claimBotJob(input.client, input.leaseMs)
        if (!job) {
          await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
          continue
        }
        const claimMs = performance.now() - claimStartedAt
        botOptionsMetrics.observe('worker_claim', claimMs)
        emit({ resource: 'job', resourceId: job.id, kind: job.kind, phase: 'claim', durationMs: claimMs, outcome: 'ok' })
        emit({ resource: 'job', resourceId: job.id, kind: job.kind, phase: 'queue', durationMs: job.queueWaitMs, outcome: 'ok' })
        await runClaimedBotJob({
          client: input.client, job, handle: input.handle,
          handlerSettlesJob: input.handlerSettlesJob,
          onError: input.onError,
          onDiagnostic: input.onDiagnostic
        })
      } catch (error) {
        input.onError?.(error)
        await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
      }
    }
  }
  running = run()
  return {
    async stop() {
      stopped = true
      await running
    }
  }
}

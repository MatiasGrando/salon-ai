import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { botOptionsMetrics } from '../observability/metrics.js'

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

type WorkerClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>

export async function claimBotJob(
  client: WorkerClient,
  leaseMs = 30_000,
  token = randomUUID()
): Promise<ClaimedBotJob | null> {
  const claimed = await client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BotJob" SET "status" = 'POISON'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
        "lastError" = COALESCE("lastError", 'claim expired after max attempts'), "updatedAt" = clock_timestamp()
      WHERE "status" = 'LEASED'::"BotJobStatus" AND "leasedUntil" < clock_timestamp() AND "attempts" >= "maxAttempts"
    `)
    const candidates = await tx.$queryRaw<Array<{ id: string; businessId: string }>>(Prisma.sql`
      SELECT j."id", j."businessId" FROM "BotJob" j
      JOIN "BotChannelDeployment" d ON d."id" = j."deploymentId" AND d."businessId" = j."businessId"
      WHERE ((j."status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus") AND j."availableAt" <= clock_timestamp())
          OR (j."status" = 'LEASED'::"BotJobStatus" AND j."leasedUntil" < clock_timestamp()))
        AND j."attempts" < j."maxAttempts" AND d."generation" = j."deploymentGeneration"
        AND d."activeConfigurationId" IS NOT NULL AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
      ORDER BY j."availableAt", j."createdAt", j."id" FOR UPDATE OF j SKIP LOCKED LIMIT 1
    `)
    const candidate = candidates[0]
    if (!candidate) return null
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${candidate.businessId}:WHATSAPP`}, 0))
    `)
    const rows = await tx.$queryRaw<ClaimedBotJob[]>(Prisma.sql`
      UPDATE "BotJob" j SET "status" = 'LEASED'::"BotJobStatus", "attempts" = j."attempts" + 1,
        "leaseToken" = ${token}, "leasedUntil" = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
        "updatedAt" = clock_timestamp()
      WHERE j."id" = ${candidate.id} AND EXISTS (
        SELECT 1 FROM "BotChannelDeployment" d WHERE d."id" = j."deploymentId" AND d."businessId" = j."businessId"
          AND d."generation" = j."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
          AND d."legacyDispatchCoverageVersion" >= 1 AND d."claimsPausedAt" IS NULL
      )
      RETURNING j."id", j."kind", j."aggregateId", j."businessId", j."deploymentId",
        j."deploymentGeneration", j."expectedRevision", j."attempts", j."maxAttempts",
        j."leaseToken" AS "claimToken", j."leasedUntil" AS "claimedUntil",
        (EXTRACT(EPOCH FROM (clock_timestamp() - j."createdAt")) * 1000)::double precision AS "queueWaitMs"
    `)
    return rows[0] ?? null
  })
  if (claimed) botOptionsMetrics.observe('admitted_to_claim', claimed.queueWaitMs)
  return claimed
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
  availableAt: Date
): Promise<void> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "status" = 'READY'::"BotJobStatus", "availableAt" = ${availableAt},
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
      "status" = CASE WHEN "attempts" >= "maxAttempts" THEN 'POISON'::"BotJobStatus" ELSE 'RETRY'::"BotJobStatus" END,
      "availableAt" = clock_timestamp() + (${delayMs} * interval '1 millisecond'),
      "leaseToken" = NULL, "leasedUntil" = NULL, "lastError" = ${error.slice(0, 2000)},
      "updatedAt" = clock_timestamp()
    WHERE "id" = ${id} AND "status" = 'LEASED'::"BotJobStatus" AND "leaseToken" = ${claimToken}
    RETURNING "status"::text AS "status"
  `)
  return rows[0]?.status ?? 'STALE'
}

export type WorkerLoop = { stop(): Promise<void> }

export function startPostgresWorkerLoop(input: {
  client: WorkerClient
  handle(job: ClaimedBotJob): Promise<void>
  pollMs?: number
  leaseMs?: number
  onError?: (error: unknown) => void
}): WorkerLoop {
  let stopped = false
  let running: Promise<void> | null = null
  const pollMs = input.pollMs ?? 250

  const run = async () => {
    while (!stopped) {
      try {
        const job = await claimBotJob(input.client, input.leaseMs)
        if (!job) {
          await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
          continue
        }
        try {
          await input.handle(job)
          await completeBotJob(input.client, job.id, job.claimToken)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await retryBotJob(input.client, job.id, job.claimToken, message, 1000)
          input.onError?.(error)
        }
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

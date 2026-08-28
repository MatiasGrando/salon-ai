import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'

type DispatchClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>
export type DispatchKind = 'PROCESS' | 'SEND'

export async function acquireDispatchClaim(input: {
  client: DispatchClient
  businessId: string
  sessionId: string | null
  resourceId?: string | null
  generation: number
  fenceEpoch: number
  kind: DispatchKind
  leaseMs?: number
  claimToken?: string
}): Promise<string | null> {
  const token = input.claimToken ?? randomUUID()
  return input.client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${input.businessId}:WHATSAPP`}, 0))
    `)
    if (input.resourceId) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "BotDispatchClaim" SET "status" = CASE
            WHEN "status" = 'SENDING'::"BotDispatchStatus" THEN 'UNKNOWN'::"BotDispatchStatus"
            ELSE 'DONE'::"BotDispatchStatus" END,
          "updatedAt" = clock_timestamp()
        WHERE "businessId" = ${input.businessId} AND "kind" = ${input.kind}::"BotDispatchKind"
          AND "resourceId" = ${input.resourceId} AND "status" IN ('CLAIMED'::"BotDispatchStatus", 'SENDING'::"BotDispatchStatus")
          AND "claimedUntil" < clock_timestamp()
      `)
    }
    const rows = await tx.$queryRaw<Array<{ claimToken: string }>>(Prisma.sql`
      INSERT INTO "BotDispatchClaim" (
        "id", "businessId", "channel", "sessionId", "resourceId", "engineKey", "generation", "fenceEpoch",
        "kind", "status", "claimToken", "claimedUntil", "updatedAt"
      )
      SELECT ${randomUUID()}, d."businessId", d."channel", ${input.sessionId}, ${input.resourceId ?? null}, d."engineKey", d."generation",
        d."dispatchFenceEpoch", ${input.kind}::"BotDispatchKind", 'CLAIMED'::"BotDispatchStatus", ${token},
        clock_timestamp() + (${input.leaseMs ?? 30_000} * interval '1 millisecond'), clock_timestamp()
      FROM "BotChannelDeployment" d
      WHERE d."businessId" = ${input.businessId} AND d."channel" = 'WHATSAPP'::"BotChannel"
        AND d."engineKey" = 'deterministic-options' AND d."activeConfigurationId" IS NOT NULL
        AND d."legacyDispatchCoverageVersion" >= 1
        AND d."claimsPausedAt" IS NULL AND d."generation" = ${input.generation}
        AND d."dispatchFenceEpoch" = ${input.fenceEpoch}
        AND (${input.sessionId}::text IS NULL OR EXISTS (
          SELECT 1 FROM "BotSession" s WHERE s."id" = ${input.sessionId}
            AND s."businessId" = d."businessId" AND s."deploymentId" = d."id"
            AND s."deploymentGeneration" = d."generation" AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus"
        ))
      ON CONFLICT DO NOTHING
      RETURNING "claimToken"
    `)
    return rows[0]?.claimToken ?? null
  })
}

export async function assertDispatchClaimTx(input: {
  tx: Prisma.TransactionClient
  businessId: string
  claimToken: string
  expectedStatus?: 'CLAIMED' | 'SENDING'
}): Promise<void> {
  await input.tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock_shared(hashtextextended(${`bot-cutover:${input.businessId}:WHATSAPP`}, 0))
  `)
  const rows = await input.tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT c."id" FROM "BotDispatchClaim" c
    JOIN "BotChannelDeployment" d ON d."businessId" = c."businessId" AND d."channel" = c."channel"
    WHERE c."claimToken" = ${input.claimToken} AND c."businessId" = ${input.businessId}
      AND c."status" = ${input.expectedStatus ?? 'CLAIMED'}::"BotDispatchStatus"
      AND c."claimedUntil" > clock_timestamp() AND d."generation" = c."generation"
      AND d."dispatchFenceEpoch" = c."fenceEpoch" AND d."claimsPausedAt" IS NULL
      AND d."activeConfigurationId" IS NOT NULL
      AND d."legacyDispatchCoverageVersion" >= 1
    FOR UPDATE OF c
  `)
  if (rows.length !== 1) throw new Error('stale or fenced dispatch claim')
}

export async function completeDispatchClaimTx(
  tx: Prisma.TransactionClient,
  claimToken: string,
  from: 'CLAIMED' | 'SENDING' = 'CLAIMED'
): Promise<void> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
    WHERE "claimToken" = ${claimToken} AND "status" = ${from}::"BotDispatchStatus"
  `)
  if (count !== 1) throw new Error('cannot complete stale dispatch claim')
}

export async function advanceDispatchClaim(
  client: DispatchClient,
  claimToken: string,
  status: 'SENDING' | 'UNKNOWN',
  providerMessageId: string | null = null
): Promise<boolean> {
  const count = await client.$executeRaw(Prisma.sql`
    UPDATE "BotDispatchClaim" c SET "status" = ${status}::"BotDispatchStatus",
      "providerMessageId" = COALESCE(${providerMessageId}, c."providerMessageId"), "updatedAt" = clock_timestamp()
    WHERE c."claimToken" = ${claimToken} AND c."status" IN ('CLAIMED'::"BotDispatchStatus", 'SENDING'::"BotDispatchStatus")
      AND EXISTS (
        SELECT 1 FROM "BotChannelDeployment" d
        WHERE d."businessId" = c."businessId" AND d."channel" = c."channel"
          AND d."generation" = c."generation" AND d."dispatchFenceEpoch" = c."fenceEpoch"
      )
  `)
  return count === 1
}

export async function releaseDispatchClaim(client: DispatchClient, claimToken: string): Promise<boolean> {
  const count = await client.$executeRaw(Prisma.sql`
    UPDATE "BotDispatchClaim" SET "status" = 'DONE'::"BotDispatchStatus", "updatedAt" = clock_timestamp()
    WHERE "claimToken" = ${claimToken} AND "status" IN ('CLAIMED'::"BotDispatchStatus", 'SENDING'::"BotDispatchStatus")
  `)
  return count === 1
}

export async function assertActivationGate(input: {
  client: DispatchClient
  businessId: string
  legacyCoverageComplete: boolean
}): Promise<void> {
  if (!input.legacyCoverageComplete) throw new Error('activation blocked: legacy dispatch coverage incomplete')
  const rows = await input.client.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS "count" FROM (
      SELECT 1 FROM "BotOutbox" WHERE "businessId" = ${input.businessId} AND "status" = 'UNKNOWN'::"BotOutboxStatus"
      UNION ALL
      SELECT 1 FROM "BotDispatchClaim" WHERE "businessId" = ${input.businessId} AND "status" = 'UNKNOWN'::"BotDispatchStatus"
    ) blocked
  `)
  if ((rows[0]?.count ?? 0n) > 0n) throw new Error('activation blocked: unresolved UNKNOWN dispatch')
}

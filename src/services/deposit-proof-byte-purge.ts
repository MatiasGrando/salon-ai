import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

type PurgeClient = Pick<PrismaClient, '$transaction'>
type PurgeTx = Prisma.TransactionClient

const PURGE_REASON = 'RETENTION_12_MONTHS'
const MAX_BATCH_SIZE = 1_000

export type DepositProofBytePurgeInput = {
  mode: 'DRY_RUN' | 'EXECUTE'
  batchSize: number
  businessId?: string
  /** Required only for EXECUTE; it is a durable idempotency key, never PII. */
  operationKey?: string
}

export type DepositProofBytePurgeResult = {
  mode: 'DRY_RUN' | 'EXECUTE'
  scope: 'GLOBAL' | 'BUSINESS'
  candidateCount: number
  purgedCount: number
  replayed: boolean
  operationKey?: string
}

type NormalizedPurgeInput = {
  mode: 'DRY_RUN' | 'EXECUTE'
  batchSize: number
  businessId: string | undefined
  operationKey: string | undefined
}

export class DepositProofBytePurgeError extends Error {}

/**
 * Internal maintenance primitive. It deliberately has no user/request path:
 * tenant scope is optional only for controlled maintenance, while global runs
 * are bounded and use SKIP LOCKED so independent workers cannot overlap rows.
 */
export async function purgeDueDepositProofBytes(
  client: PurgeClient,
  input: DepositProofBytePurgeInput
): Promise<DepositProofBytePurgeResult> {
  return client.$transaction((tx) => purgeDueDepositProofBytesInTransaction(tx, input))
}

export async function purgeDueDepositProofBytesInTransaction(
  tx: PurgeTx,
  input: DepositProofBytePurgeInput
): Promise<DepositProofBytePurgeResult> {
  const normalized = validateDepositProofBytePurgeInput(input)
  const scope: 'GLOBAL' | 'BUSINESS' = normalized.businessId ? 'BUSINESS' : 'GLOBAL'
  if (normalized.mode === 'DRY_RUN') {
    const candidates = await dueCandidates(tx, normalized.businessId, normalized.batchSize, false)
    return { mode: 'DRY_RUN', scope, candidateCount: candidates.length, purgedCount: 0, replayed: false }
  }

  const operationKey = normalized.operationKey!
  const requestHash = purgeRequestHash(scope, normalized.businessId, normalized.batchSize)
  const existing = await tx.$queryRaw<Array<{ requestHash: string; selectedCount: number; purgedCount: number }>>(Prisma.sql`
    SELECT "requestHash", "selectedCount", "purgedCount"
    FROM "BookingDepositProofPurgeOperation" WHERE "operationKey" = ${operationKey} FOR UPDATE
  `)
  if (existing[0]) return replayOperation(existing[0], operationKey, requestHash, scope)

  const operationId = randomUUID()
  const reserved = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BookingDepositProofPurgeOperation" (
      "id", "operationKey", "scope", "businessId", "reason", "requestHash", "status"
    ) VALUES (${operationId}, ${operationKey}, ${scope}, ${normalized.businessId ?? null}, ${PURGE_REASON}, ${requestHash}, 'COMPLETED')
    ON CONFLICT ("operationKey") DO NOTHING
  `)
  if (reserved !== 1) {
    const raced = await tx.$queryRaw<Array<{ requestHash: string; selectedCount: number; purgedCount: number }>>(Prisma.sql`
      SELECT "requestHash", "selectedCount", "purgedCount"
      FROM "BookingDepositProofPurgeOperation" WHERE "operationKey" = ${operationKey} FOR UPDATE
    `)
    if (!raced[0]) throw new DepositProofBytePurgeError('purge operation reservation was lost')
    return replayOperation(raced[0], operationKey, requestHash, scope)
  }

  const purged = await dueCandidates(tx, normalized.businessId, normalized.batchSize, true)
  for (const proof of purged) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BookingDepositProofPurgeAudit" (
        "id", "operationId", "businessId", "depositId", "proofId", "reason", "purgedAt"
      ) VALUES (${randomUUID()}, ${operationId}, ${proof.businessId}, ${proof.depositId}, ${proof.id}, ${PURGE_REASON}, ${proof.purgedAt})
    `)
  }
  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BookingDepositProofPurgeOperation"
    SET "selectedCount" = ${purged.length}, "purgedCount" = ${purged.length}, "completedAt" = clock_timestamp()
    WHERE "id" = ${operationId} AND "status" = 'COMPLETED'
  `)
  if (completed !== 1) throw new DepositProofBytePurgeError('purge operation completion fence failed')
  return { mode: 'EXECUTE', scope, candidateCount: purged.length, purgedCount: purged.length, replayed: false, operationKey }
}

async function dueCandidates(tx: PurgeTx, businessId: string | undefined, batchSize: number, lock: boolean) {
  // The predicate and timestamp live in PostgreSQL. `clock_timestamp()` is
  // intentionally volatile: due eligibility cannot be advanced by host time.
  if (!lock) {
    return tx.$queryRaw<Array<{ id: string; businessId: string; depositId: string; purgedAt: Date }>>(Prisma.sql`
      SELECT "id", "businessId", "depositId", NULL::timestamp AS "purgedAt"
      FROM "BookingDepositProof"
      WHERE "purgedAt" IS NULL
        AND "sourceData" IS NOT NULL AND "derivedData" IS NOT NULL
        AND "retentionEligibleAt" <= clock_timestamp()
        AND (${businessId ?? null}::text IS NULL OR "businessId" = ${businessId ?? null})
      ORDER BY "retentionEligibleAt" ASC, "id" ASC
      LIMIT ${batchSize}
    `)
  }
  return tx.$queryRaw<Array<{ id: string; businessId: string; depositId: string; purgedAt: Date }>>(Prisma.sql`
    WITH candidates AS (
      SELECT "id"
      FROM "BookingDepositProof"
      WHERE "purgedAt" IS NULL
        AND "sourceData" IS NOT NULL AND "derivedData" IS NOT NULL
        AND "retentionEligibleAt" <= clock_timestamp()
        AND (${businessId ?? null}::text IS NULL OR "businessId" = ${businessId ?? null})
      ORDER BY "retentionEligibleAt" ASC, "id" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "BookingDepositProof" p
    SET "sourceData" = NULL, "derivedData" = NULL, "purgeReason" = ${PURGE_REASON}
    FROM candidates c
    WHERE p."id" = c."id"
    RETURNING p."id", p."businessId", p."depositId", p."purgedAt"
  `)
}

export function validateDepositProofBytePurgeInput(input: DepositProofBytePurgeInput): NormalizedPurgeInput {
  if (input.mode !== 'DRY_RUN' && input.mode !== 'EXECUTE') throw new DepositProofBytePurgeError('purge mode must be DRY_RUN or EXECUTE')
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > MAX_BATCH_SIZE) throw new DepositProofBytePurgeError(`batchSize must be an integer from 1 to ${MAX_BATCH_SIZE}`)
  const businessId = input.businessId?.trim() || undefined
  const operationKey = input.operationKey?.trim() || undefined
  if (input.mode === 'EXECUTE' && !operationKey) throw new DepositProofBytePurgeError('execute purge requires operationKey')
  if (operationKey && operationKey.length > 200) throw new DepositProofBytePurgeError('operationKey exceeds limit')
  return { mode: input.mode, batchSize: input.batchSize, businessId, operationKey }
}

function replayOperation(existing: { requestHash: string; selectedCount: number; purgedCount: number }, operationKey: string, requestHash: string, scope: 'GLOBAL' | 'BUSINESS'): DepositProofBytePurgeResult {
  if (existing.requestHash !== requestHash) throw new DepositProofBytePurgeError('purge operation key was reused with a different scope or batch')
  return { mode: 'EXECUTE', scope, candidateCount: existing.selectedCount, purgedCount: existing.purgedCount, replayed: true, operationKey }
}

function purgeRequestHash(scope: 'GLOBAL' | 'BUSINESS', businessId: string | undefined, batchSize: number) {
  return createHash('sha256').update(JSON.stringify({ scope, businessId: businessId ?? null, batchSize, reason: PURGE_REASON })).digest('hex')
}

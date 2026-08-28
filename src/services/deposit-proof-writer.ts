import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy } from './agenda-locks.js'
import type { DepositProofImageValidationResult } from './deposit-proof-image-validation.js'
import { enqueueDepositNotificationWithRecoveryTx } from './deposit-notification-outbox.js'

type ProofWriterClient = Pick<PrismaClient, '$transaction'>
type ProofWriterTx = Prisma.TransactionClient

export type DepositProofWriteResult = {
  outcome: 'APPLIED' | 'REPLAYED'
  proofId: string
  kind: 'INITIAL' | 'RESUBMISSION' | 'LATE'
}

export class DepositProofWriteError extends Error {}

/**
 * The ingress adapter owns provider identifiers and byte validation. This
 * writer owns the atomic aggregate transition and durable notification intent;
 * it never invokes Meta, CRM or a worker directly.
 */
export async function writeValidatedDepositProof(
  client: ProofWriterClient,
  input: {
    businessId: string
    depositId: string
    operationKey: string
    providerEventId?: string | null
    providerMessageId?: string | null
    providerMediaId?: string | null
    expectedProviderPhoneNumberId?: string
    evidence: DepositProofImageValidationResult
  }
): Promise<DepositProofWriteResult> {
  return client.$transaction((tx) => writeValidatedDepositProofInTransaction(tx, input))
}

/** Exported for transaction/rollback contracts; callers normally use the wrapper above. */
export async function writeValidatedDepositProofInTransaction(
  tx: ProofWriterTx,
  input: {
    businessId: string
    depositId: string
    operationKey: string
    providerEventId?: string | null
    providerMessageId?: string | null
    providerMediaId?: string | null
    expectedProviderPhoneNumberId?: string
    evidence: DepositProofImageValidationResult
  }
): Promise<DepositProofWriteResult> {
  assertRequired(input.businessId, 'businessId')
  assertRequired(input.depositId, 'depositId')
  assertRequired(input.operationKey, 'operationKey')
  const providerEventId = nullableIdentifier(input.providerEventId)
  const providerMessageId = nullableIdentifier(input.providerMessageId)
  const providerMediaId = nullableIdentifier(input.providerMediaId)
  const requestHash = proofRequestHash({ ...input, providerEventId, providerMessageId, providerMediaId })

  // Discover the professional under the tenant scope, then use precisely the
  // same business -> professional hierarchy as F7 and EXPIRE_DEPOSIT.
  const target = await tx.$queryRaw<Array<{ professionalId: string }>>(Prisma.sql`
    SELECT v."professionalId"
    FROM "BookingDeposit" d
    JOIN "BookingVisit" v ON v."id" = d."visitId" AND v."businessId" = d."businessId"
    JOIN "Appointment" a ON a."id" = d."appointmentId" AND a."visitId" = v."id"
    WHERE d."id" = ${input.depositId} AND d."businessId" = ${input.businessId}
    LIMIT 1
  `)
  if (target.length !== 1) throw new DepositProofWriteError('F8 deposit aggregate was not found in tenant')
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds: [target[0]!.professionalId] })

  const rows = await tx.$queryRaw<Array<{
    depositId: string; visitId: string; appointmentId: string; sessionId: string; scheduledStartAt: Date; dbNow: Date
    expiresAt: Date; holdExpiresAt: Date | null; depositStatus: string; visitStatus: string
    appointmentStatus: string; snapshotSealedAt: Date | null; proofCount: bigint
  }>>(Prisma.sql`
    SELECT d."id" AS "depositId", v."id" AS "visitId", a."id" AS "appointmentId", v."sessionId", v."scheduledStartAt",
      clock_timestamp() AS "dbNow", d."expiresAt", v."holdExpiresAt",
      d."status"::text AS "depositStatus", v."status"::text AS "visitStatus",
      a."status"::text AS "appointmentStatus", d."snapshotSealedAt",
      (SELECT count(*) FROM "BookingDepositProof" p
        WHERE p."businessId" = d."businessId" AND p."depositId" = d."id")::bigint AS "proofCount"
    FROM "BookingDeposit" d
    JOIN "BookingVisit" v ON v."id" = d."visitId" AND v."businessId" = d."businessId"
    JOIN "Appointment" a ON a."id" = d."appointmentId" AND a."visitId" = v."id"
    WHERE d."id" = ${input.depositId} AND d."businessId" = ${input.businessId}
    FOR UPDATE OF d, v, a
  `)
  const row = rows[0]
  if (!row || !row.snapshotSealedAt) throw new DepositProofWriteError('deposit is not an eligible sealed F8 aggregate')

  const duplicate = await findDuplicateProof(tx, input.businessId, input.depositId, {
    providerEventId, providerMessageId, providerMediaId,
    sourceSha256: input.evidence.sourceSha256
  })
  if (duplicate) {
    // The source hash is the durable idempotency identity. A validator/library
    // upgrade can legitimately change the deterministic derivative; it must
    // not turn an already received source image into a second proof.
    if (duplicate.sourceSha256 !== input.evidence.sourceSha256) {
      throw new DepositProofWriteError('provider proof identifier was reused with different evidence')
    }
    return { outcome: 'REPLAYED', proofId: duplicate.id, kind: duplicate.kind as DepositProofWriteResult['kind'] }
  }

  const priorOperation = await tx.$queryRaw<Array<{ requestHash: string; status: string; resultRef: string | null }>>(Prisma.sql`
    SELECT "requestHash", "status", "resultRef" FROM "BotOperation"
    WHERE "operationKey" = ${input.operationKey} FOR UPDATE
  `)
  if (priorOperation[0]) {
    if (priorOperation[0].requestHash !== requestHash) throw new DepositProofWriteError('proof operation key was reused with a different request')
    if (priorOperation[0].status !== 'COMPLETED' || !priorOperation[0].resultRef) {
      throw new DepositProofWriteError('proof operation is not safely replayable')
    }
    const replay = await proofById(tx, input.businessId, input.depositId, priorOperation[0].resultRef)
    if (!replay) throw new DepositProofWriteError('completed proof operation has no retained evidence')
    return { outcome: 'REPLAYED', proofId: replay.id, kind: replay.kind as DepositProofWriteResult['kind'] }
  }

  const classification = classifyDepositProofWrite({
    depositStatus: row.depositStatus, visitStatus: row.visitStatus, appointmentStatus: row.appointmentStatus,
    expiresAt: row.expiresAt, holdExpiresAt: row.holdExpiresAt, dbNow: row.dbNow, proofCount: Number(row.proofCount)
  })
  if (!classification) throw new DepositProofWriteError('deposit aggregate cannot accept proof evidence in its current state')

  const insertedOperation = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "updatedAt")
    VALUES (${randomUUID()}, ${input.operationKey}, 'RECEIVE_DEPOSIT_PROOF', ${input.businessId}, ${row.sessionId}, 'STARTED', ${requestHash}, clock_timestamp())
  `)
  if (insertedOperation !== 1) throw new DepositProofWriteError('proof operation could not be reserved')

  const proofId = randomUUID()
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BookingDepositProof" (
      "id", "businessId", "depositId", "sequence", "kind", "validatorVersion", "validatedAt", "receivedAt",
      "providerEventId", "providerMessageId", "providerMediaId",
      "sourceData", "sourceMimeType", "sourceFilename", "sourceByteSize", "sourceSha256",
      "derivedData", "derivedMimeType", "derivedByteSize", "derivedSha256", "retentionEligibleAt"
    ) VALUES (
      ${proofId}, ${input.businessId}, ${input.depositId}, ${Number(row.proofCount) + 1}, ${classification.kind}::"BookingDepositProofKind",
      ${input.evidence.validatorVersion}, ${row.dbNow}, ${row.dbNow}, ${providerEventId}, ${providerMessageId}, ${providerMediaId},
      ${input.evidence.sourceData}, ${input.evidence.sourceMimeType}, ${input.evidence.sourceFilename}, ${input.evidence.sourceByteSize}, ${input.evidence.sourceSha256},
      ${input.evidence.derivedData}, ${input.evidence.derivedMimeType}, ${input.evidence.derivedByteSize}, ${input.evidence.derivedSha256},
      (${classification.kind === 'LATE' ? row.dbNow : row.scheduledStartAt}::timestamp + interval '12 months')
    )
  `)

  if (classification.kind !== 'LATE') {
    const depositCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingDeposit" SET "status" = 'PROOF_RECEIVED'::"BookingDepositStatus", "updatedAt" = ${row.dbNow}
      WHERE "id" = ${row.depositId} AND "businessId" = ${input.businessId}
        AND "status" IN ('PENDING_PROOF'::"BookingDepositStatus", 'PENDING_RESUBMISSION'::"BookingDepositStatus") AND "expiresAt" > ${row.dbNow}
    `)
    const visitCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingVisit" SET "status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus", "updatedAt" = ${row.dbNow}, "version" = "version" + 1
      WHERE "id" = ${row.visitId} AND "businessId" = ${input.businessId}
        AND "status" = 'HELD'::"BookingVisitStatus" AND "holdExpiresAt" > ${row.dbNow}
    `)
    if (depositCount !== 1 || visitCount !== 1) throw new DepositProofWriteError('proof lost its conditional aggregate state fence')
    await neutralizeUnclaimedExpiryJob(tx, input.businessId, input.depositId)
  } else {
    // Evidence is retained, but terminal aggregates never reopen implicitly.
    // The unique proofId makes the handoff/audit durable and replay-safe.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BookingDepositLateProofHandoff" ("id", "businessId", "depositId", "proofId", "action", "createdAt")
      VALUES (${randomUUID()}, ${input.businessId}, ${input.depositId}, ${proofId}, 'LATE_PROOF_REQUIRES_HANDOFF', ${row.dbNow})
      ON CONFLICT ("proofId") DO NOTHING
    `)
  }
  await enqueueDepositNotificationWithRecoveryTx(tx, {
    businessId: input.businessId,
    depositId: input.depositId,
    sourceId: proofId,
    kind: classification.kind === 'LATE' ? 'LATE_PROOF' : 'PROOF_RECEIVED',
    dbNow: row.dbNow,
    ...(input.expectedProviderPhoneNumberId ? { expectedProviderPhoneNumberId: input.expectedProviderPhoneNumberId } : {})
  })
  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${proofId}, "updatedAt" = ${row.dbNow}
    WHERE "operationKey" = ${input.operationKey} AND "status" = 'STARTED' AND "requestHash" = ${requestHash}
  `)
  if (completed !== 1) throw new DepositProofWriteError('proof operation completion fence failed')
  return { outcome: 'APPLIED', proofId, kind: classification.kind }
}

export function classifyDepositProofWrite(input: {
  depositStatus: string; visitStatus: string; appointmentStatus: string; expiresAt: Date; holdExpiresAt: Date | null; dbNow: Date; proofCount: number
}): { kind: 'INITIAL' | 'RESUBMISSION' | 'LATE' } | null {
  if ((input.depositStatus === 'PENDING_PROOF' || input.depositStatus === 'PENDING_RESUBMISSION') && input.visitStatus === 'HELD' && input.appointmentStatus === 'PENDING') {
    if (input.expiresAt > input.dbNow && input.holdExpiresAt !== null && input.holdExpiresAt > input.dbNow) {
      return { kind: input.proofCount === 0 ? 'INITIAL' : 'RESUBMISSION' }
    }
    return { kind: 'LATE' }
  }
  if (input.depositStatus === 'EXPIRED' && input.visitStatus === 'EXPIRED' && input.appointmentStatus === 'CANCELLED') return { kind: 'LATE' }
  return null
}

async function findDuplicateProof(tx: ProofWriterTx, businessId: string, depositId: string, input: { providerEventId: string | null; providerMessageId: string | null; providerMediaId: string | null; sourceSha256: string }) {
  return (await tx.$queryRaw<Array<{ id: string; kind: string; sourceSha256: string }>>(Prisma.sql`
    SELECT "id", "kind"::text AS "kind", "sourceSha256" FROM "BookingDepositProof"
    WHERE "businessId" = ${businessId} AND "depositId" = ${depositId} AND (
      "sourceSha256" = ${input.sourceSha256}
      OR (${input.providerEventId}::text IS NOT NULL AND "providerEventId" = ${input.providerEventId})
      OR (${input.providerMessageId}::text IS NOT NULL AND "providerMessageId" = ${input.providerMessageId})
      OR (${input.providerMediaId}::text IS NOT NULL AND "providerMediaId" = ${input.providerMediaId})
    ) ORDER BY "sequence" ASC LIMIT 1
  `))[0] ?? null
}

async function proofById(tx: ProofWriterTx, businessId: string, depositId: string, id: string) {
  return (await tx.$queryRaw<Array<{ id: string; kind: string }>>(Prisma.sql`
    SELECT "id", "kind"::text AS "kind" FROM "BookingDepositProof"
    WHERE "id" = ${id} AND "businessId" = ${businessId} AND "depositId" = ${depositId}
  `))[0] ?? null
}

async function neutralizeUnclaimedExpiryJob(tx: ProofWriterTx, businessId: string, depositId: string) {
  // SKIP LOCKED is essential: a leased expiry holds its job row before it
  // waits for the agenda hierarchy. Waiting here would invert that order and
  // deadlock. A leased job is instead neutralized by the guarded aggregate
  // state and will become INELIGIBLE/stale when it resumes.
  const jobs = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "BotJob"
    WHERE "kind" = 'EXPIRE_DEPOSIT' AND "aggregateId" = ${depositId} AND "businessId" = ${businessId}
      AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")
    FOR UPDATE SKIP LOCKED
  `)
  for (const job of jobs) {
    const count = await tx.$executeRaw(Prisma.sql`
      UPDATE "BotJob" SET "status" = 'DONE'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
        "lastError" = 'neutralized by deposit proof', "updatedAt" = clock_timestamp()
      WHERE "id" = ${job.id} AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")
    `)
    if (count !== 1) throw new DepositProofWriteError('expiry neutralization fence failed')
  }
}

function proofRequestHash(input: { businessId: string; depositId: string; providerEventId: string | null; providerMessageId: string | null; providerMediaId: string | null; evidence: DepositProofImageValidationResult }) {
  return createHash('sha256').update(JSON.stringify({
    businessId: input.businessId, depositId: input.depositId, providerEventId: input.providerEventId,
    providerMessageId: input.providerMessageId, providerMediaId: input.providerMediaId,
    sourceSha256: input.evidence.sourceSha256, derivedSha256: input.evidence.derivedSha256,
    validatorVersion: input.evidence.validatorVersion
  })).digest('hex')
}

function nullableIdentifier(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  if (!normalized) return null
  if (normalized.length > 512) throw new DepositProofWriteError('provider identifier exceeds limit')
  return normalized
}

function assertRequired(value: string, name: string) {
  if (!value.trim()) throw new DepositProofWriteError(`${name} is required`)
}

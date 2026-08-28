import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { acquireAgendaHierarchy } from './agenda-locks.js'
import { bridgeDepositReviewOutboxTx, enqueueDepositReviewBridgeJobTx } from './deposit-notification-outbox.js'

type ReviewClient = Pick<PrismaClient, '$transaction'>
type ReviewTx = Prisma.TransactionClient

export const DEPOSIT_REJECTION_MODES = ['RESUBMISSION_ALLOWED', 'FINAL'] as const
export type DepositRejectionMode = typeof DEPOSIT_REJECTION_MODES[number]

export class DepositReviewError extends Error {}
export class DepositReviewStateError extends DepositReviewError {}

/** This is deliberately pure so F8.8 can share the input contract. */
export function normalizeDepositRejection(input: { reason?: unknown; mode?: unknown }): { reason: string; mode: DepositRejectionMode } {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason || reason.length > 300) throw new DepositReviewError('rejection reason must contain between 1 and 300 characters')
  if (!DEPOSIT_REJECTION_MODES.includes(input.mode as DepositRejectionMode)) {
    throw new DepositReviewError('rejection mode is invalid')
  }
  return { reason, mode: input.mode as DepositRejectionMode }
}

/** State gate reserved for F8.8's transactional rejection writer. */
export function isDepositRejectionEligible(input: { depositStatus: string; visitStatus: string; appointmentStatus: string; hasCurrentValidProof: boolean }) {
  return input.depositStatus === 'PROOF_RECEIVED'
    && input.visitStatus === 'PENDING_PAYMENT_REVIEW'
    && input.appointmentStatus === 'PENDING'
    && input.hasCurrentValidProof
}

export function depositReviewRequestHash(input: { action: 'APPROVE' | 'REJECT'; depositId: string; actorUserId: string; rejection?: { reason: string; mode: DepositRejectionMode } }) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export async function rejectCurrentDepositProof(client: ReviewClient, input: {
  businessId: string; depositId: string; actorUserId: string; operationKey: string; method: string; path: string; rejection: { reason: string; mode: DepositRejectionMode }
}): Promise<{ outcome: 'APPLIED' | 'REPLAYED'; auditId: string }> {
  return client.$transaction((tx) => rejectCurrentDepositProofInTransaction(tx, input))
}

/**
 * F8.8 rejection decision. All aggregate rows are locked after the F7
 * hierarchy, and every state change is conditionally fenced. A leased expiry
 * can resume but only observes the new state and completes as ineligible.
 */
export async function rejectCurrentDepositProofInTransaction(tx: ReviewTx, input: {
  businessId: string; depositId: string; actorUserId: string; operationKey: string; method: string; path: string; rejection: { reason: string; mode: DepositRejectionMode }
}): Promise<{ outcome: 'APPLIED' | 'REPLAYED'; auditId: string }> {
  assertIdentifier(input.businessId, 'businessId'); assertIdentifier(input.depositId, 'depositId'); assertIdentifier(input.actorUserId, 'actorUserId'); assertIdentifier(input.operationKey, 'operationKey')
  const rejection = normalizeDepositRejection(input.rejection)
  const requestHash = depositReviewRequestHash({ action: 'REJECT', depositId: input.depositId, actorUserId: input.actorUserId, rejection })
  const target = await tx.$queryRaw<Array<{ professionalId: string }>>(Prisma.sql`
    SELECT v."professionalId" FROM "BookingDeposit" d JOIN "BookingVisit" v ON v."id" = d."visitId" AND v."businessId" = d."businessId"
    WHERE d."id" = ${input.depositId} AND d."businessId" = ${input.businessId} LIMIT 1`)
  if (target.length !== 1) throw new DepositReviewStateError('deposit aggregate is unavailable')
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds: [target[0]!.professionalId] })
  const rows = await tx.$queryRaw<Array<{ depositId: string; visitId: string; appointmentId: string; sessionId: string; dbNow: Date; depositStatus: string; visitStatus: string; appointmentStatus: string; expiresAt: Date; proofId: string | null; ttlMinutes: number | null; ttlProvenance: string | null }>>(Prisma.sql`
    SELECT d."id" AS "depositId", v."id" AS "visitId", a."id" AS "appointmentId", v."sessionId", clock_timestamp() AS "dbNow",
      d."status"::text AS "depositStatus", v."status"::text AS "visitStatus", a."status"::text AS "appointmentStatus", d."expiresAt",
      d."holdTtlMinutes" AS "ttlMinutes", d."holdTtlProvenance"::text AS "ttlProvenance",
      (SELECT p."id" FROM "BookingDepositProof" p WHERE p."businessId" = d."businessId" AND p."depositId" = d."id" AND p."validationStatus" = 'VALID'::"BookingDepositProofValidationStatus" ORDER BY p."sequence" DESC LIMIT 1) AS "proofId"
    FROM "BookingDeposit" d JOIN "BookingVisit" v ON v."id" = d."visitId" AND v."businessId" = d."businessId" JOIN "Appointment" a ON a."id" = d."appointmentId" AND a."visitId" = v."id"
    WHERE d."id" = ${input.depositId} AND d."businessId" = ${input.businessId} FOR UPDATE OF d, v, a`)
  const row = rows[0]
  if (!row) throw new DepositReviewStateError('deposit aggregate is unavailable')
  const prior = await tx.$queryRaw<Array<{ requestHash: string; status: string; resultRef: string | null }>>(Prisma.sql`SELECT "requestHash", "status", "resultRef" FROM "BotOperation" WHERE "operationKey" = ${input.operationKey} FOR UPDATE`)
  if (prior[0]) {
    if (prior[0].requestHash !== requestHash || prior[0].status !== 'COMPLETED' || !prior[0].resultRef) throw new DepositReviewStateError('review operation cannot be replayed safely')
    return { outcome: 'REPLAYED', auditId: prior[0].resultRef }
  }
  if (!isDepositRejectionEligible({ ...row, hasCurrentValidProof: Boolean(row.proofId) })) throw new DepositReviewStateError('deposit proof is no longer eligible for rejection')
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "updatedAt") VALUES (${randomUUID()}, ${input.operationKey}, 'REJECT_DEPOSIT_PROOF', ${input.businessId}, ${row.sessionId}, 'STARTED', ${requestHash}, ${row.dbNow})`)
  const resubmission = rejection.mode === 'RESUBMISSION_ALLOWED'
  const ttlMinutes = row.ttlMinutes && row.ttlMinutes > 0 ? row.ttlMinutes : 120
  const newExpiry = new Date(row.dbNow.getTime() + ttlMinutes * 60_000)
  const depositCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "BookingDeposit" SET "status" = ${resubmission ? 'PENDING_RESUBMISSION' : 'REJECTED'}::"BookingDepositStatus", "reviewedAt" = ${row.dbNow}, "reviewedByUserId" = ${input.actorUserId}, "rejectionReason" = ${rejection.reason},
      "expiresAt" = ${resubmission ? newExpiry : row.expiresAt}, "updatedAt" = ${row.dbNow}
    WHERE "id" = ${row.depositId} AND "businessId" = ${input.businessId} AND "status" = 'PROOF_RECEIVED'::"BookingDepositStatus"`)
  const visitCount = await tx.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = ${resubmission ? 'HELD' : 'CANCELLED'}::"BookingVisitStatus", "holdExpiresAt" = ${resubmission ? newExpiry : row.dbNow}, "version" = "version" + 1, "updatedAt" = ${row.dbNow} WHERE "id" = ${row.visitId} AND "businessId" = ${input.businessId} AND "status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus"`)
  const appointmentCount = await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "status" = ${resubmission ? 'PENDING' : 'CANCELLED'}::"AppointmentStatus", "version" = "version" + 1 WHERE "id" = ${row.appointmentId} AND "visitId" = ${row.visitId} AND "status" = 'PENDING'::"AppointmentStatus"`)
  if (depositCount !== 1 || visitCount !== 1 || appointmentCount !== 1) throw new DepositReviewStateError('rejection transition lost its state fence')
  await neutralizeExpiryJobs(tx, input.businessId, row.depositId, resubmission ? 'replaced by resubmission deadline' : 'neutralized by final rejection')
  if (resubmission) {
    const job = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "status", "updatedAt")
      SELECT ${randomUUID()}, 'EXPIRE_DEPOSIT', ${row.depositId}, s."businessId", s."deploymentId", s."deploymentGeneration", ${newExpiry}, 'READY'::"BotJobStatus", ${row.dbNow}
      FROM "BotSession" s WHERE s."id" = ${row.sessionId} AND s."businessId" = ${input.businessId}
      ON CONFLICT ("kind", "aggregateId") DO UPDATE SET "availableAt" = EXCLUDED."availableAt", "status" = 'READY'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL, "lastError" = 'retargeted by deposit resubmission', "updatedAt" = EXCLUDED."updatedAt"
      WHERE "BotJob"."status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus", 'DONE'::"BotJobStatus")`)
    if (job !== 1) throw new DepositReviewStateError('resubmission expiry job could not be scheduled')
  }
  const auditId = randomUUID(); const action = resubmission ? 'RESUBMISSION_ALLOWED' : 'FINAL_REJECTED'
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositReviewAudit" ("id", "businessId", "depositId", "proofId", "actorUserId", "action", "operationKey", "createdAt") VALUES (${auditId}, ${input.businessId}, ${row.depositId}, ${row.proofId!}, ${input.actorUserId}, ${action}, ${input.operationKey}, ${row.dbNow})`)
  const reviewOutboxId = randomUUID()
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositReviewOutbox" ("id", "businessId", "depositId", "auditId", "kind", "status", "createdAt") VALUES (${reviewOutboxId}, ${input.businessId}, ${row.depositId}, ${auditId}, ${resubmission ? 'DEPOSIT_RESUBMISSION_REQUESTED' : 'DEPOSIT_REJECTED_FINAL'}, 'PENDING_CONTENT', ${row.dbNow})`)
  await enqueueDepositReviewBridgeJobTx(tx, { businessId: input.businessId, reviewOutboxId, sessionId: row.sessionId, dbNow: row.dbNow })
  await bridgeDepositReviewOutboxTx(tx, { businessId: input.businessId, reviewOutboxId })
  await tx.$executeRaw(Prisma.sql`INSERT INTO "StaffAuditLog" ("id", "businessId", "userId", "action", "entityType", "entityId", "method", "path", "createdAt") VALUES (${randomUUID()}, ${input.businessId}, ${input.actorUserId}, ${action}, 'BookingDeposit', ${row.depositId}, ${input.method}, ${input.path}, ${row.dbNow})`)
  const completed = await tx.$executeRaw(Prisma.sql`UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${auditId}, "updatedAt" = ${row.dbNow} WHERE "operationKey" = ${input.operationKey} AND "status" = 'STARTED' AND "requestHash" = ${requestHash}`)
  if (completed !== 1) throw new DepositReviewStateError('review operation completion fence failed')
  return { outcome: 'APPLIED', auditId }
}

async function neutralizeExpiryJobs(tx: ReviewTx, businessId: string, depositId: string, reason: string) {
  await tx.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "status" = 'DONE'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL, "lastError" = ${reason}, "updatedAt" = clock_timestamp() WHERE "kind" = 'EXPIRE_DEPOSIT' AND "aggregateId" = ${depositId} AND "businessId" = ${businessId} AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")`)
}

export async function approveCurrentDepositProof(client: ReviewClient, input: {
  businessId: string
  depositId: string
  actorUserId: string
  operationKey: string
  method: string
  path: string
}): Promise<{ outcome: 'APPLIED' | 'REPLAYED'; auditId: string }> {
  return client.$transaction((tx) => approveCurrentDepositProofInTransaction(tx, input))
}

/** Exported for PG rollback and approval-vs-expiry contracts. */
export async function approveCurrentDepositProofInTransaction(tx: ReviewTx, input: {
  businessId: string
  depositId: string
  actorUserId: string
  operationKey: string
  method: string
  path: string
}): Promise<{ outcome: 'APPLIED' | 'REPLAYED'; auditId: string }> {
  assertIdentifier(input.businessId, 'businessId')
  assertIdentifier(input.depositId, 'depositId')
  assertIdentifier(input.actorUserId, 'actorUserId')
  assertIdentifier(input.operationKey, 'operationKey')
  const requestHash = depositReviewRequestHash({ action: 'APPROVE', depositId: input.depositId, actorUserId: input.actorUserId })

  // Lock ordering is shared with F8 receive/expire: business, professional,
  // then the aggregate rows. It prevents a reviewer from confirming a hold an
  // expiry worker has just released.
  const target = await tx.$queryRaw<Array<{ professionalId: string }>>(Prisma.sql`
    SELECT v."professionalId" FROM "BookingDeposit" d
    JOIN "BookingVisit" v ON v."id" = d."visitId" AND v."businessId" = d."businessId"
    WHERE d."id" = ${input.depositId} AND d."businessId" = ${input.businessId} LIMIT 1
  `)
  if (target.length !== 1) throw new DepositReviewStateError('deposit aggregate is unavailable')
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds: [target[0]!.professionalId] })

  const rows = await tx.$queryRaw<Array<{
    depositId: string; visitId: string; appointmentId: string; sessionId: string; dbNow: Date
    depositStatus: string; visitStatus: string; appointmentStatus: string; expiresAt: Date; holdExpiresAt: Date | null
    proofId: string | null
  }>>(Prisma.sql`
    SELECT d."id" AS "depositId", v."id" AS "visitId", a."id" AS "appointmentId", v."sessionId",
      clock_timestamp() AS "dbNow", d."status"::text AS "depositStatus", v."status"::text AS "visitStatus",
      a."status"::text AS "appointmentStatus", d."expiresAt", v."holdExpiresAt",
      (SELECT p."id" FROM "BookingDepositProof" p
        WHERE p."businessId" = d."businessId" AND p."depositId" = d."id"
          AND p."validationStatus" = 'VALID'::"BookingDepositProofValidationStatus"
        ORDER BY p."sequence" DESC LIMIT 1) AS "proofId"
    FROM "BookingDeposit" d
    JOIN "BookingVisit" v ON v."id" = d."visitId" AND v."businessId" = d."businessId"
    JOIN "Appointment" a ON a."id" = d."appointmentId" AND a."visitId" = v."id"
    WHERE d."id" = ${input.depositId} AND d."businessId" = ${input.businessId}
    FOR UPDATE OF d, v, a
  `)
  const row = rows[0]
  if (!row) throw new DepositReviewStateError('deposit aggregate is unavailable')

  const operation = await tx.$queryRaw<Array<{ requestHash: string; status: string; resultRef: string | null }>>(Prisma.sql`
    SELECT "requestHash", "status", "resultRef" FROM "BotOperation" WHERE "operationKey" = ${input.operationKey} FOR UPDATE
  `)
  if (operation[0]) {
    if (operation[0].requestHash !== requestHash || operation[0].status !== 'COMPLETED' || !operation[0].resultRef) {
      throw new DepositReviewStateError('review operation cannot be replayed safely')
    }
    return { outcome: 'REPLAYED', auditId: operation[0].resultRef }
  }
  if (row.depositStatus !== 'PROOF_RECEIVED' || row.visitStatus !== 'PENDING_PAYMENT_REVIEW' || row.appointmentStatus !== 'PENDING' || !row.proofId) {
    throw new DepositReviewStateError('deposit proof is no longer eligible for approval')
  }

  const reserved = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "updatedAt")
    VALUES (${randomUUID()}, ${input.operationKey}, 'APPROVE_DEPOSIT_PROOF', ${input.businessId}, ${row.sessionId}, 'STARTED', ${requestHash}, ${row.dbNow})
  `)
  if (reserved !== 1) throw new DepositReviewStateError('review operation could not be reserved')
  const depositCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "BookingDeposit" SET "status" = 'APPROVED'::"BookingDepositStatus", "reviewedAt" = ${row.dbNow}, "reviewedByUserId" = ${input.actorUserId}, "updatedAt" = ${row.dbNow}
    WHERE "id" = ${row.depositId} AND "businessId" = ${input.businessId} AND "status" = 'PROOF_RECEIVED'::"BookingDepositStatus"
  `)
  const visitCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "BookingVisit" SET "status" = 'CONFIRMED'::"BookingVisitStatus", "version" = "version" + 1, "updatedAt" = ${row.dbNow}
    WHERE "id" = ${row.visitId} AND "businessId" = ${input.businessId} AND "status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus"
  `)
  const appointmentCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "Appointment" SET "status" = 'CONFIRMED'::"AppointmentStatus", "version" = "version" + 1
    WHERE "id" = ${row.appointmentId} AND "visitId" = ${row.visitId} AND "status" = 'PENDING'::"AppointmentStatus"
  `)
  if (depositCount !== 1 || visitCount !== 1 || appointmentCount !== 1) throw new DepositReviewStateError('review transition lost its state fence')

  const auditId = randomUUID()
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BookingDepositReviewAudit" ("id", "businessId", "depositId", "proofId", "actorUserId", "action", "operationKey", "createdAt")
    VALUES (${auditId}, ${input.businessId}, ${row.depositId}, ${row.proofId}, ${input.actorUserId}, 'APPROVED', ${input.operationKey}, ${row.dbNow})
  `)
  // Persist the domain intent first, then bridge approved static content into
  // BotOutbox in the same transaction. No provider call occurs here.
  const reviewOutboxId = randomUUID()
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BookingDepositReviewOutbox" ("id", "businessId", "depositId", "auditId", "kind", "status", "createdAt")
    VALUES (${reviewOutboxId}, ${input.businessId}, ${row.depositId}, ${auditId}, 'DEPOSIT_APPROVED', 'PENDING_CONTENT', ${row.dbNow})
  `)
  await enqueueDepositReviewBridgeJobTx(tx, { businessId: input.businessId, reviewOutboxId, sessionId: row.sessionId, dbNow: row.dbNow })
  await bridgeDepositReviewOutboxTx(tx, { businessId: input.businessId, reviewOutboxId })
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "StaffAuditLog" ("id", "businessId", "userId", "action", "entityType", "entityId", "method", "path", "createdAt")
    VALUES (${randomUUID()}, ${input.businessId}, ${input.actorUserId}, 'APPROVE_DEPOSIT_PROOF', 'BookingDeposit', ${row.depositId}, ${input.method}, ${input.path}, ${row.dbNow})
  `)
  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${auditId}, "updatedAt" = ${row.dbNow}
    WHERE "operationKey" = ${input.operationKey} AND "status" = 'STARTED' AND "requestHash" = ${requestHash}
  `)
  if (completed !== 1) throw new DepositReviewStateError('review operation completion fence failed')
  return { outcome: 'APPLIED', auditId }
}

function assertIdentifier(value: string, name: string) {
  if (!value.trim() || value.length > 512) throw new DepositReviewError(`${name} is invalid`)
}

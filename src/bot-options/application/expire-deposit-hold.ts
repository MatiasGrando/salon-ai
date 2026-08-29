import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { acquireAgendaHierarchy } from '../../services/agenda-locks.js'
import { assertClaimedBotJobTx, completeClaimedBotJobTx, type ClaimedBotJob } from '../infrastructure/postgres-worker.js'
import { enqueueDepositNotificationWithRecoveryTx } from '../../services/deposit-notification-outbox.js'

type ExpiryClient = Pick<PrismaClient, '$transaction'>

export type DepositExpiryResult = 'EXPIRED' | 'INELIGIBLE'

export function isDepositHoldExpiryEligible(input: {
  depositStatus: string
  visitStatus: string
  appointmentStatus: string
  dueAt: Date
  visitDueAt: Date | null
  dbNow: Date
}) {
  return (input.depositStatus === 'PENDING_PROOF' || input.depositStatus === 'PENDING_RESUBMISSION') && input.visitStatus === 'HELD' && input.appointmentStatus === 'PENDING' &&
    input.dueAt <= input.dbNow && input.visitDueAt !== null && input.visitDueAt <= input.dbNow
}

/**
 * F8.6: release exactly the three rows that constitute a F8 held visit.
 *
 * The DB clock is sampled only after the F7 business/professional hierarchy is
 * held. A future proof writer must take that same hierarchy; whichever writer
 * commits first changes a guarded state and the other one becomes INELIGIBLE.
 * Notification is only a durable BotOutbox insert in this transaction; the
 * existing sender applies its independent deployment and dispatch fences.
 */
export async function expireDepositHold(client: ExpiryClient, job: ClaimedBotJob): Promise<DepositExpiryResult> {
  if (job.kind !== 'EXPIRE_DEPOSIT') throw new Error(`unsupported deposit expiry job kind: ${job.kind}`)

  return client.$transaction(async (tx) => {
    // An expiry is safe and required after a cutover: the lease token remains
    // the fence, while deployment-currentness must not strand an old hold.
    await assertClaimedBotJobTx(tx, job, { requireCurrentDeployment: false })

    const target = await tx.$queryRaw<Array<{ professionalId: string }>>(Prisma.sql`
      SELECT v."professionalId"
      FROM "BookingDeposit" d
      JOIN "BookingVisit" v ON v."id" = d."visitId" AND v."businessId" = d."businessId"
      JOIN "Appointment" a ON a."id" = d."appointmentId" AND a."visitId" = v."id"
      WHERE d."id" = ${job.aggregateId} AND d."businessId" = ${job.businessId}
      LIMIT 1
    `)
    if (target.length !== 1) {
      await completeClaimedBotJobTx(tx, job)
      return 'INELIGIBLE'
    }

    await acquireAgendaHierarchy(tx, { businessId: job.businessId, professionalIds: [target[0]!.professionalId] })
    const rows = await tx.$queryRaw<Array<{
      depositId: string; visitId: string; appointmentId: string; dbNow: Date; dueAt: Date
      depositStatus: string; visitStatus: string; appointmentStatus: string; visitDueAt: Date | null
    }>>(Prisma.sql`
      SELECT d."id" AS "depositId", v."id" AS "visitId", a."id" AS "appointmentId",
        clock_timestamp() AS "dbNow", d."expiresAt" AS "dueAt",
        d."status"::text AS "depositStatus", v."status"::text AS "visitStatus",
        a."status"::text AS "appointmentStatus", v."holdExpiresAt" AS "visitDueAt"
      FROM "BookingDeposit" d
      JOIN "BookingVisit" v ON v."id" = d."visitId" AND v."businessId" = d."businessId"
      JOIN "Appointment" a ON a."id" = d."appointmentId" AND a."visitId" = v."id"
      WHERE d."id" = ${job.aggregateId} AND d."businessId" = ${job.businessId}
      FOR UPDATE OF d, v, a
    `)
    const row = rows[0]
    if (!row || !isDepositHoldExpiryEligible(row)) {
      await completeClaimedBotJobTx(tx, job)
      return 'INELIGIBLE'
    }

    const depositCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingDeposit"
      SET "status" = 'EXPIRED'::"BookingDepositStatus", "expiredAt" = ${row.dbNow},
        "expirationReason" = 'HOLD_TTL_EXPIRED', "updatedAt" = ${row.dbNow}
      WHERE "id" = ${row.depositId} AND "businessId" = ${job.businessId}
        AND "status" IN ('PENDING_PROOF'::"BookingDepositStatus", 'PENDING_RESUBMISSION'::"BookingDepositStatus") AND "expiresAt" <= ${row.dbNow}
    `)
    const visitCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingVisit"
      SET "status" = 'EXPIRED'::"BookingVisitStatus", "updatedAt" = ${row.dbNow}, "version" = "version" + 1
      WHERE "id" = ${row.visitId} AND "businessId" = ${job.businessId}
        AND "status" = 'HELD'::"BookingVisitStatus" AND "holdExpiresAt" <= ${row.dbNow}
    `)
    const appointmentCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "Appointment"
      SET "status" = 'CANCELLED'::"AppointmentStatus", "version" = "version" + 1
      WHERE "id" = ${row.appointmentId} AND "visitId" = ${row.visitId}
        AND "status" = 'PENDING'::"AppointmentStatus"
    `)
    if (depositCount !== 1 || visitCount !== 1 || appointmentCount !== 1) {
      throw new Error('deposit expiry lost its conditional state fence')
    }
    const auditId = randomUUID()
    const auditCount = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BookingDepositExpiryAudit" (
        "id", "businessId", "depositId", "visitId", "appointmentId", "jobId", "reason", "dueAt", "expiredAt"
      ) VALUES (
        ${auditId}, ${job.businessId}, ${row.depositId}, ${row.visitId}, ${row.appointmentId}, ${job.id},
        'HOLD_TTL_EXPIRED', ${row.dueAt}, ${row.dbNow}
      ) ON CONFLICT ("depositId") DO NOTHING
    `)
    if (auditCount !== 1) throw new Error('deposit expiry audit invariant failed')
    await enqueueDepositNotificationWithRecoveryTx(tx, {
      businessId: job.businessId,
      depositId: row.depositId,
      sourceId: auditId,
      kind: 'EXPIRED',
      dbNow: row.dbNow
    })
    await completeClaimedBotJobTx(tx, job)
    return 'EXPIRED'
  })
}

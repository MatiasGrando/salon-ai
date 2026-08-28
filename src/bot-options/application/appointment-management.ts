import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { createHash, randomUUID } from 'node:crypto'
import { acquireAgendaHierarchy } from '../../services/agenda-locks.js'
import { normalizePhone } from '../../services/phone-normalization-service.js'

export {
  AppointmentReschedulingError,
  classifyRescheduleAggregate,
  depositSnapshotMatchesCurrentPolicy,
  rescheduleManageableAppointment,
  rescheduleManageableAppointmentInTransaction,
  validateRescheduleInput
} from './appointment-rescheduling.js'
export type { RescheduleManageableAppointmentInput, RescheduleManageableAppointmentResult } from './appointment-rescheduling.js'

/** Deliberately small to keep bot list interactions bounded and predictable. */
export const APPOINTMENT_MANAGEMENT_PAGE_SIZE = 10

export type AppointmentManagementCategory = 'CONFIRMED' | 'WAITING_PROOF' | 'UNDER_REVIEW' | 'RESUBMISSION_PENDING'
export type AppointmentManagementFinancialState = 'LEGACY_CONFIRMED' | 'APPROVED' | 'WAITING_PROOF' | 'UNDER_REVIEW' | 'RESUBMISSION_PENDING'
export type AppointmentManagementAction = 'AUTOMATIC' | 'HANDOFF' | 'REQUIRES_DEPOSIT_MATCH'

export type AppointmentManagementPolicy = {
  cancel: AppointmentManagementAction
  reschedule: AppointmentManagementAction
}

export type AppointmentManagementCursor = {
  startAt: Date
  appointmentId: string
}

export type ManagedAppointment = {
  appointmentId: string
  startAt: Date
  category: AppointmentManagementCategory
  financialState: AppointmentManagementFinancialState
}

export type AppointmentManagementPage = {
  dbNow: Date
  timezone: string
  cancellationLeadMinutes: number
  rescheduleLeadMinutes: number
  items: ManagedAppointment[]
  nextCursor: AppointmentManagementCursor | null
}

type RawClient = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>
}

type CancellationClient = Pick<PrismaClient, '$transaction'>
type CancellationTx = Prisma.TransactionClient

export type CancelManageableAppointmentInput = {
  businessId: string
  normalizedPhone: string
  sessionId: string
  appointmentId: string
  operationKey: string
  confirmed: true
}

export type CancelManageableAppointmentResult = {
  outcome: 'CANCELLED' | 'HANDOFF' | 'INELIGIBLE'
  replayed: boolean
}

export class AppointmentCancellationError extends Error {}

type SettingsRow = {
  timezone: string
  cancellationLeadMinutes: number
  rescheduleLeadMinutes: number
  dbNow: Date
}

type AppointmentRow = {
  appointmentId: string
  startAt: Date
  category: AppointmentManagementCategory
  financialState: AppointmentManagementFinancialState
}

/** Independent instant-based lead window. Equality at the boundary is allowed. */
export function isWithinAppointmentManagementLeadWindow(startAt: Date, dbNow: Date, leadMinutes: number): boolean {
  assertValidInstant(startAt, 'startAt')
  assertValidInstant(dbNow, 'dbNow')
  if (!Number.isInteger(leadMinutes) || leadMinutes < 0) throw new Error('leadMinutes must be a non-negative integer')
  return startAt.getTime() - dbNow.getTime() >= leadMinutes * 60_000
}

/** F9.2 has no writer yet; this is the complete financial decision boundary. */
export function classifyAppointmentManagementPolicy(state: AppointmentManagementFinancialState): AppointmentManagementPolicy {
  switch (state) {
    case 'LEGACY_CONFIRMED':
    case 'WAITING_PROOF':
    case 'RESUBMISSION_PENDING':
      return { cancel: 'AUTOMATIC', reschedule: 'AUTOMATIC' }
    case 'UNDER_REVIEW':
      return { cancel: 'HANDOFF', reschedule: 'HANDOFF' }
    case 'APPROVED':
      return { cancel: 'HANDOFF', reschedule: 'REQUIRES_DEPOSIT_MATCH' }
    default:
      throw new Error('appointment management financial state is invalid')
  }
}

/** Small, pure F9.3 gate; database locks remain the authority for the writer. */
export function classifyCancellationAggregate(input: {
  appointmentStatus: string
  visitStatus: string | null
  depositStatus: string | null
  hasVisit: boolean
  depositVisitId: string | null
  snapshotSealedAt: Date | null
  startAt: Date
  dbNow: Date
  cancellationLeadMinutes: number
  depositExpiresAt: Date | null
  holdExpiresAt: Date | null
}): 'CANCEL' | 'HANDOFF' | 'INELIGIBLE' {
  if (input.appointmentStatus === 'CANCELLED' || input.appointmentStatus === 'COMPLETED' || input.appointmentStatus === 'NO_SHOW') return 'INELIGIBLE'
  if (input.startAt <= input.dbNow) return 'INELIGIBLE'
  if ((input.depositStatus === 'PENDING_PROOF' || input.depositStatus === 'PENDING_RESUBMISSION')
    && (input.depositExpiresAt === null || input.depositExpiresAt <= input.dbNow)) return 'INELIGIBLE'
  if (!isWithinAppointmentManagementLeadWindow(input.startAt, input.dbNow, input.cancellationLeadMinutes)) return 'HANDOFF'
  if (!input.depositStatus) {
    if (input.appointmentStatus !== 'CONFIRMED') return 'INELIGIBLE'
    return !input.hasVisit || input.visitStatus === 'CONFIRMED' ? 'CANCEL' : 'HANDOFF'
  }
  if (!input.hasVisit || !input.depositVisitId || !input.snapshotSealedAt) return 'HANDOFF'
  if ((input.depositStatus === 'PENDING_PROOF' || input.depositStatus === 'PENDING_RESUBMISSION')
    && (input.holdExpiresAt === null || input.holdExpiresAt <= input.dbNow)) return 'INELIGIBLE'
  if (input.depositStatus === 'PROOF_RECEIVED' || input.depositStatus === 'APPROVED') return 'HANDOFF'
  if (input.depositStatus === 'PENDING_PROOF' || input.depositStatus === 'PENDING_RESUBMISSION') {
    return input.appointmentStatus === 'PENDING' && input.visitStatus === 'HELD' ? 'CANCEL' : 'HANDOFF'
  }
  return 'INELIGIBLE'
}

/**
 * F9.3's sole cancellation writer. It deliberately neither creates a handoff
 * nor sends a message: F10 owns both effects. All state is reread under F8's
 * business -> professional -> aggregate hierarchy before it is changed.
 */
export async function cancelManageableAppointment(client: CancellationClient, input: CancelManageableAppointmentInput): Promise<CancelManageableAppointmentResult> {
  validateCancellationInput(input)
  return client.$transaction((tx) => cancelManageableAppointmentInTransaction(tx, input))
}

/**
 * Composition boundary for callers that already own a transaction. It is not a
 * test seam: rollback of the cancellation aggregate must remain atomic when a
 * future managed workflow composes it with other durable work.
 */
export async function cancelManageableAppointmentInTransaction(tx: CancellationTx, input: CancelManageableAppointmentInput): Promise<CancelManageableAppointmentResult> {
  validateCancellationInput(input)
  const requestHash = cancellationRequestHash(input)
  // This preliminary tenant/session-scoped lookup supplies only the professional
  // lock key and the raw conversation phone. Canonical phone comparison happens
  // in TypeScript so formatted provider input cannot diverge from Customer's
  // normalizedPhone. It authorizes no write.
  const target = await tx.$queryRaw<Array<{ professionalId: string; conversationPhone: string }>>(Prisma.sql`
    SELECT a."professionalId", co."phone" AS "conversationPhone"
    FROM "Appointment" a
    JOIN "Customer" c ON c."id" = a."customerId" AND c."businessId" = ${input.businessId} AND c."normalizedPhone" = ${input.normalizedPhone}
    JOIN "Professional" p ON p."id" = a."professionalId" AND p."businessId" = ${input.businessId}
    JOIN "Service" s ON s."id" = a."serviceId" AND s."businessId" = ${input.businessId}
    JOIN "BotSession" bs ON bs."id" = ${input.sessionId} AND bs."businessId" = ${input.businessId}
    JOIN "Conversation" co ON co."id" = bs."conversationId" AND co."businessId" = ${input.businessId}
    WHERE a."id" = ${input.appointmentId}
    LIMIT 1
  `)
  if (target.length !== 1 || normalizePhone(target[0]!.conversationPhone) !== input.normalizedPhone) return { outcome: 'INELIGIBLE', replayed: false }
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds: [target[0]!.professionalId] })

  const rows = await tx.$queryRaw<Array<{
    appointmentId: string; visitId: string | null; depositId: string | null; depositVisitId: string | null
    sessionId: string | null; startAt: Date; dbNow: Date; timezone: string | null; cancellationLeadMinutes: number | null
    appointmentStatus: string; visitStatus: string | null; depositStatus: string | null
    snapshotSealedAt: Date | null; depositExpiresAt: Date | null; holdExpiresAt: Date | null
  }>>(Prisma.sql`
    SELECT a."id" AS "appointmentId", a."visitId", d."id" AS "depositId", d."visitId" AS "depositVisitId",
      v."sessionId", a."startAt", clock_timestamp() AS "dbNow", settings."timezone", settings."cancellationLeadMinutes",
      a."status"::text AS "appointmentStatus", v."status"::text AS "visitStatus", d."status"::text AS "depositStatus",
      d."snapshotSealedAt", d."expiresAt" AS "depositExpiresAt", v."holdExpiresAt"
    FROM "Appointment" a
    JOIN "Customer" c ON c."id" = a."customerId" AND c."businessId" = ${input.businessId} AND c."normalizedPhone" = ${input.normalizedPhone}
    JOIN "Professional" p ON p."id" = a."professionalId" AND p."businessId" = ${input.businessId}
    JOIN "Service" s ON s."id" = a."serviceId" AND s."businessId" = ${input.businessId}
    LEFT JOIN "BusinessBotOptionsSettings" settings ON settings."businessId" = ${input.businessId}
    JOIN "BotSession" bs ON bs."id" = ${input.sessionId} AND bs."businessId" = ${input.businessId}
    JOIN "Conversation" co ON co."id" = bs."conversationId" AND co."businessId" = ${input.businessId}
    LEFT JOIN LATERAL (
      SELECT * FROM "BookingVisit" WHERE "id" = a."visitId" AND "businessId" = ${input.businessId} FOR UPDATE
    ) v ON true
    LEFT JOIN LATERAL (
      SELECT * FROM "BookingDeposit" WHERE "appointmentId" = a."id" FOR UPDATE
    ) d ON true
    WHERE a."id" = ${input.appointmentId}
    FOR UPDATE OF a
  `)
  const row = rows[0]
  if (!row) return { outcome: 'INELIGIBLE', replayed: false }
  // Match the read boundary's fail-closed settings contract. The writer cannot
  // rely on a prior list request: settings can be removed or corrupted between
  // reads, and this transaction is the only authority for mutation eligibility.
  if (!isUsableTimezone(row.timezone)) {
    throw new AppointmentCancellationError('appointment management settings/timezone are unavailable')
  }
  if (typeof row.cancellationLeadMinutes !== 'number' || !Number.isInteger(row.cancellationLeadMinutes) || row.cancellationLeadMinutes < 0) {
    throw new AppointmentCancellationError('appointment management lead settings are invalid')
  }

  const prior = await tx.$queryRaw<Array<{ requestHash: string; status: string; resultRef: string | null }>>(Prisma.sql`
    SELECT "requestHash", "status", "resultRef" FROM "BotOperation" WHERE "operationKey" = ${input.operationKey} FOR UPDATE
  `)
  if (prior[0]) {
    if (prior[0].requestHash !== requestHash || prior[0].status !== 'COMPLETED' || prior[0].resultRef !== input.appointmentId) {
      throw new AppointmentCancellationError('cancellation operation cannot be replayed safely')
    }
    return { outcome: 'CANCELLED', replayed: true }
  }

  const decision = classifyCancellationAggregate({
    appointmentStatus: row.appointmentStatus, visitStatus: row.visitStatus, depositStatus: row.depositStatus,
    hasVisit: row.depositId ? row.visitId !== null && row.visitId === row.depositVisitId : row.visitId !== null,
    depositVisitId: row.depositVisitId, snapshotSealedAt: row.snapshotSealedAt, startAt: row.startAt, dbNow: row.dbNow,
    cancellationLeadMinutes: row.cancellationLeadMinutes, depositExpiresAt: row.depositExpiresAt, holdExpiresAt: row.holdExpiresAt
  })
  if (decision === 'HANDOFF') return { outcome: 'HANDOFF', replayed: false }
  if (decision === 'INELIGIBLE') return { outcome: 'INELIGIBLE', replayed: false }

  const reserved = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "updatedAt")
    VALUES (${randomUUID()}, ${input.operationKey}, 'CANCEL_APPOINTMENT', ${input.businessId}, ${input.sessionId}, 'STARTED', ${requestHash}, ${row.dbNow})
  `)
  if (reserved !== 1) throw new AppointmentCancellationError('cancellation operation reservation fence failed')

  if (row.depositId) {
    const depositCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingDeposit" SET "status" = 'REJECTED'::"BookingDepositStatus", "reviewedAt" = ${row.dbNow},
        "rejectionReason" = 'CANCELLED_BY_CUSTOMER', "updatedAt" = ${row.dbNow}
      WHERE "id" = ${row.depositId} AND "businessId" = ${input.businessId}
        AND "status" IN ('PENDING_PROOF'::"BookingDepositStatus", 'PENDING_RESUBMISSION'::"BookingDepositStatus")
    `)
    if (depositCount !== 1) throw new AppointmentCancellationError('cancellation lost its deposit state fence')
  }
  if (row.visitId) {
    const visitCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingVisit" SET "status" = 'CANCELLED'::"BookingVisitStatus", "version" = "version" + 1, "updatedAt" = ${row.dbNow}
      WHERE "id" = ${row.visitId} AND "businessId" = ${input.businessId}
        AND "status" IN ('CONFIRMED'::"BookingVisitStatus", 'HELD'::"BookingVisitStatus")
    `)
    if (visitCount !== 1) throw new AppointmentCancellationError('cancellation lost its visit state fence')
  }
  const appointmentCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "Appointment" SET "status" = 'CANCELLED'::"AppointmentStatus", "version" = "version" + 1
    WHERE "id" = ${row.appointmentId} AND "status" IN ('CONFIRMED'::"AppointmentStatus", 'PENDING'::"AppointmentStatus")
  `)
  if (appointmentCount !== 1) throw new AppointmentCancellationError('cancellation lost its appointment state fence')
  if (row.depositId) await neutralizeCancellationExpiryJobs(tx, input.businessId, row.depositId)
  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${row.appointmentId}, "updatedAt" = ${row.dbNow}
    WHERE "operationKey" = ${input.operationKey} AND "status" = 'STARTED' AND "requestHash" = ${requestHash}
  `)
  if (completed !== 1) throw new AppointmentCancellationError('cancellation operation completion fence failed')
  return { outcome: 'CANCELLED', replayed: false }
}

async function neutralizeCancellationExpiryJobs(tx: CancellationTx, businessId: string, depositId: string) {
  const jobs = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "BotJob" WHERE "kind" = 'EXPIRE_DEPOSIT' AND "aggregateId" = ${depositId} AND "businessId" = ${businessId}
      AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus") FOR UPDATE SKIP LOCKED
  `)
  for (const job of jobs) {
    const count = await tx.$executeRaw(Prisma.sql`
      UPDATE "BotJob" SET "status" = 'DONE'::"BotJobStatus", "leaseToken" = NULL, "leasedUntil" = NULL,
        "lastError" = 'neutralized by customer cancellation', "updatedAt" = clock_timestamp()
      WHERE "id" = ${job.id} AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")
    `)
    if (count !== 1) throw new AppointmentCancellationError('cancellation expiry neutralization fence failed')
  }
}

function cancellationRequestHash(input: CancelManageableAppointmentInput) {
  return createHash('sha256').update(JSON.stringify({ action: 'CANCEL_APPOINTMENT', businessId: input.businessId, normalizedPhone: input.normalizedPhone, sessionId: input.sessionId, appointmentId: input.appointmentId, confirmed: input.confirmed })).digest('hex')
}

export function validateCancellationInput(input: CancelManageableAppointmentInput): void {
  for (const [label, value] of Object.entries({ businessId: input.businessId, normalizedPhone: input.normalizedPhone, sessionId: input.sessionId, appointmentId: input.appointmentId, operationKey: input.operationKey })) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.length > 512) throw new AppointmentCancellationError(`${label} must be a nonblank normalized identifier`)
  }
  if (input.confirmed !== true) throw new AppointmentCancellationError('cancellation confirmation is required')
}

/**
 * F9.1 read boundary. It obtains the authoritative clock exactly once together
 * with required settings, then uses that returned instant for the candidate SQL.
 * No mutation, transition, runtime effect, or availability check is performed.
 */
export async function listManageableAppointments(
  prisma: RawClient,
  input: { businessId: string; normalizedPhone: string; cursor?: AppointmentManagementCursor; pageSize?: number }
): Promise<AppointmentManagementPage> {
  assertNonBlankNormalized(input.businessId, 'businessId')
  assertNonBlankNormalized(input.normalizedPhone, 'normalizedPhone')
  if (input.cursor) {
    assertValidInstant(input.cursor.startAt, 'cursor.startAt')
    assertNonBlankNormalized(input.cursor.appointmentId, 'cursor.appointmentId')
  }
  const pageSize = input.pageSize ?? APPOINTMENT_MANAGEMENT_PAGE_SIZE
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > APPOINTMENT_MANAGEMENT_PAGE_SIZE) {
    throw new Error(`pageSize must be an integer between 1 and ${APPOINTMENT_MANAGEMENT_PAGE_SIZE}`)
  }

  const settings = await prisma.$queryRaw<SettingsRow[]>(Prisma.sql`
    SELECT "timezone", "cancellationLeadMinutes", "rescheduleLeadMinutes", clock_timestamp() AS "dbNow"
    FROM "BusinessBotOptionsSettings"
    WHERE "businessId" = ${input.businessId}
  `)
  const setting = settings[0]
  if (!setting || !isUsableTimezone(setting.timezone)) throw new Error('appointment management settings/timezone are unavailable')
  if (!Number.isInteger(setting.cancellationLeadMinutes) || setting.cancellationLeadMinutes < 0
    || !Number.isInteger(setting.rescheduleLeadMinutes) || setting.rescheduleLeadMinutes < 0) {
    throw new Error('appointment management lead settings are invalid')
  }

  const cursorClause = input.cursor
    ? Prisma.sql`AND (a."startAt", a."id") > (${input.cursor.startAt}, ${input.cursor.appointmentId})`
    : Prisma.empty
  const rows = await prisma.$queryRaw<AppointmentRow[]>(Prisma.sql`
    SELECT a."id" AS "appointmentId", a."startAt",
      CASE
        WHEN a."status" = 'CONFIRMED'::"AppointmentStatus" THEN 'CONFIRMED'
        WHEN d."status" = 'PENDING_RESUBMISSION'::"BookingDepositStatus" THEN 'RESUBMISSION_PENDING'
        WHEN d."status" = 'PROOF_RECEIVED'::"BookingDepositStatus" THEN 'UNDER_REVIEW'
        ELSE 'WAITING_PROOF'
      END AS "category",
      CASE
        WHEN d."id" IS NULL THEN 'LEGACY_CONFIRMED'
        WHEN d."status" = 'APPROVED'::"BookingDepositStatus" THEN 'APPROVED'
        WHEN d."status" = 'PENDING_RESUBMISSION'::"BookingDepositStatus" THEN 'RESUBMISSION_PENDING'
        WHEN d."status" = 'PROOF_RECEIVED'::"BookingDepositStatus" THEN 'UNDER_REVIEW'
        ELSE 'WAITING_PROOF'
      END AS "financialState"
    FROM "Appointment" a
    JOIN "Customer" c ON c."id" = a."customerId"
      AND c."businessId" = ${input.businessId}
      AND c."normalizedPhone" = ${input.normalizedPhone}
    JOIN "Professional" p ON p."id" = a."professionalId" AND p."businessId" = ${input.businessId}
    JOIN "Service" s ON s."id" = a."serviceId" AND s."businessId" = ${input.businessId}
    LEFT JOIN "BookingVisit" v ON v."id" = a."visitId"
    LEFT JOIN "BookingDeposit" d ON d."appointmentId" = a."id"
    WHERE a."startAt" > ${setting.dbNow}
      ${cursorClause}
      AND (
        (a."status" = 'CONFIRMED'::"AppointmentStatus" AND d."id" IS NULL AND (
          v."id" IS NULL OR (
            v."businessId" = ${input.businessId} AND v."customerId" = a."customerId"
            AND v."professionalId" = a."professionalId" AND v."scheduledStartAt" = a."startAt"
            AND v."status" = 'CONFIRMED'::"BookingVisitStatus"
          )
        ))
        OR
        (a."status" = 'CONFIRMED'::"AppointmentStatus" AND v."businessId" = ${input.businessId}
          AND v."customerId" = a."customerId" AND v."professionalId" = a."professionalId"
          AND v."scheduledStartAt" = a."startAt" AND v."status" = 'CONFIRMED'::"BookingVisitStatus"
          AND d."businessId" = ${input.businessId} AND d."visitId" = v."id"
          AND d."status" = 'APPROVED'::"BookingDepositStatus" AND d."snapshotSealedAt" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "BookingDepositLine" l WHERE l."businessId" = d."businessId" AND l."depositId" = d."id")
        )
        OR
        (a."status" = 'PENDING'::"AppointmentStatus" AND v."businessId" = ${input.businessId}
          AND v."customerId" = a."customerId" AND v."professionalId" = a."professionalId"
          AND v."scheduledStartAt" = a."startAt" AND v."status" = 'HELD'::"BookingVisitStatus"
          AND v."holdExpiresAt" > ${setting.dbNow} AND d."businessId" = ${input.businessId} AND d."visitId" = v."id"
          AND d."status" IN ('PENDING_PROOF'::"BookingDepositStatus", 'PENDING_RESUBMISSION'::"BookingDepositStatus")
          AND d."snapshotSealedAt" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "BookingDepositLine" l WHERE l."businessId" = d."businessId" AND l."depositId" = d."id")
        )
        OR
        (a."status" = 'PENDING'::"AppointmentStatus" AND v."businessId" = ${input.businessId}
          AND v."customerId" = a."customerId" AND v."professionalId" = a."professionalId"
          AND v."scheduledStartAt" = a."startAt" AND v."status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus"
          AND d."businessId" = ${input.businessId} AND d."visitId" = v."id"
          AND d."status" = 'PROOF_RECEIVED'::"BookingDepositStatus" AND d."snapshotSealedAt" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "BookingDepositLine" l WHERE l."businessId" = d."businessId" AND l."depositId" = d."id")
        )
      )
    ORDER BY a."startAt" ASC, a."id" ASC
    LIMIT ${pageSize + 1}
  `)

  const hasNext = rows.length > pageSize
  const items = rows.slice(0, pageSize)
  const last = items.at(-1)
  return {
    dbNow: setting.dbNow,
    timezone: setting.timezone,
    cancellationLeadMinutes: setting.cancellationLeadMinutes,
    rescheduleLeadMinutes: setting.rescheduleLeadMinutes,
    items,
    nextCursor: hasNext && last ? { startAt: last.startAt, appointmentId: last.appointmentId } : null
  }
}

function assertNonBlankNormalized(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new Error(`${label} must be a nonblank normalized value`)
}

function assertValidInstant(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} must be a valid instant`)
}

function isUsableTimezone(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

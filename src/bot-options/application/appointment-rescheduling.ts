import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js'
import { acquireAgendaHierarchy, lockAppointmentRows } from '../../services/agenda-locks.js'
import { revalidateBookingWrite } from '../../services/booking-operations.js'
import { calculateBookingDepositTerms, hasCompleteDepositPaymentConfiguration } from '../../services/deposit-operations.js'
import { normalizePhone } from '../../services/phone-normalization-service.js'

type RescheduleClient = Pick<PrismaClient, '$transaction'>
type RescheduleTx = Prisma.TransactionClient

export type RescheduleManageableAppointmentInput = {
  businessId: string
  normalizedPhone: string
  sessionId: string
  appointmentId: string
  operationKey: string
  actor: string
  confirmed: true
  newStartAt: string
}

export type RescheduleManageableAppointmentResult =
  | { outcome: 'RESCHEDULED'; replayed: boolean; appointmentId: string; newStartAt: string; depositPreserved: boolean }
  | { outcome: 'SLOT_CONFLICT' | 'HANDOFF' | 'INELIGIBLE'; replayed: false }

export class AppointmentReschedulingError extends Error {}

export type RescheduleAggregateDecisionInput = {
  appointmentStatus: string
  visitStatus: string | null
  depositStatus: string | null
  hasVisit: boolean
  visitBelongsToSession: boolean
  visitCoherent: boolean
  depositCoherent: boolean
  depositSnapshotMatches: boolean
  originalStartAt: Date
  newStartAt: Date
  dbNow: Date
  rescheduleLeadMinutes: number
  depositExpiresAt: Date | null
  holdExpiresAt: Date | null
}

/** Pure state gate. Locks and the final conditional updates remain authoritative. */
export function classifyRescheduleAggregate(input: RescheduleAggregateDecisionInput): 'RESCHEDULE' | 'HANDOFF' | 'INELIGIBLE' {
  if (!Number.isInteger(input.rescheduleLeadMinutes) || input.rescheduleLeadMinutes < 0) throw new Error('rescheduleLeadMinutes must be a non-negative integer')
  if (input.originalStartAt <= input.dbNow || input.newStartAt <= input.dbNow || input.originalStartAt.getTime() === input.newStartAt.getTime()) return 'INELIGIBLE'
  if (input.appointmentStatus === 'CANCELLED' || input.appointmentStatus === 'COMPLETED' || input.appointmentStatus === 'NO_SHOW') return 'INELIGIBLE'
  if (!input.depositStatus && input.appointmentStatus !== 'CONFIRMED') return 'INELIGIBLE'
  if ((input.depositStatus === 'PENDING_PROOF' || input.depositStatus === 'PENDING_RESUBMISSION') &&
    (input.depositExpiresAt === null || input.holdExpiresAt === null || input.depositExpiresAt <= input.dbNow || input.holdExpiresAt <= input.dbNow)) return 'INELIGIBLE'
  if (input.originalStartAt.getTime() - input.dbNow.getTime() < input.rescheduleLeadMinutes * 60_000) return 'HANDOFF'

  if (!input.depositStatus) {
    if (!input.hasVisit) return 'RESCHEDULE'
    return input.visitBelongsToSession && input.visitCoherent && input.visitStatus === 'CONFIRMED' ? 'RESCHEDULE' : 'HANDOFF'
  }
  if (!input.hasVisit || !input.visitBelongsToSession || !input.visitCoherent || !input.depositCoherent) return 'HANDOFF'
  if (input.depositStatus === 'PROOF_RECEIVED') return 'HANDOFF'
  if (input.depositStatus === 'PENDING_PROOF' || input.depositStatus === 'PENDING_RESUBMISSION') {
    return input.appointmentStatus === 'PENDING' && input.visitStatus === 'HELD' && input.depositSnapshotMatches ? 'RESCHEDULE' : 'HANDOFF'
  }
  if (input.depositStatus === 'APPROVED') {
    return input.appointmentStatus === 'CONFIRMED' && input.visitStatus === 'CONFIRMED' && input.depositSnapshotMatches ? 'RESCHEDULE' : 'HANDOFF'
  }
  return 'HANDOFF'
}

type FinancialService = {
  id: string
  name: string
  price: number | null
  priceMode: 'FIXED' | 'STARTING_AT'
  depositMode: 'NONE' | 'FIXED' | 'PERCENTAGE'
  depositValue: number | null
}
type FinancialAppointmentItem = { serviceId: string; sortOrder: number; price: number | null }
type AppointmentItem = FinancialAppointmentItem & { durationMinutes: number }
type DepositLine = { serviceId: string; sortOrder: number; mode: string; configuredValue: number; baseAmount: number | null; amount: number }

/**
 * Exact preservation guard. Display names are intentionally ignored; IDs/order,
 * fixed effective prices, per-line rules/money, aggregate money and TTL policy
 * are durable financial facts. Unknown/STARTING_AT pricing fails closed.
 */
export function depositSnapshotMatchesCurrentPolicy(input: {
  services: readonly FinancialService[]
  appointmentItems: readonly FinancialAppointmentItem[]
  lines: readonly DepositLine[]
  appointmentQuotedPrice: number | null
  visitTotalPrice: number | null
  depositMode: string
  depositConfiguredValue: number
  depositBaseAmount: number | null
  depositAmount: number
  depositHoldTtlMinutes: number | null
  depositHoldTtlProvenance: string | null
  businessDepositHoldMinutes: number | null
}): boolean {
  if (!input.services.length || input.services.length !== input.appointmentItems.length) return false
  if (input.services.some((service, index) => {
    const item = input.appointmentItems[index]
    return !item || item.serviceId !== service.id || item.sortOrder !== index || service.priceMode !== 'FIXED' ||
      !Number.isSafeInteger(service.price) || service.price === null || service.price <= 0 || item.price !== service.price
  })) return false
  const totalPrice = input.services.reduce((sum, service) => sum + service.price!, 0)
  if (!Number.isSafeInteger(totalPrice) || input.appointmentQuotedPrice !== totalPrice || input.visitTotalPrice !== totalPrice) return false

  let terms: ReturnType<typeof calculateBookingDepositTerms>
  try {
    terms = calculateBookingDepositTerms({ services: input.services, businessDepositHoldMinutes: input.businessDepositHoldMinutes })
  } catch {
    return false
  }
  if (terms.lines.length !== input.lines.length) return false
  if (terms.lines.some((expected, index) => {
    const actual = input.lines[index]
    return !actual || actual.serviceId !== expected.serviceId || actual.sortOrder !== expected.sortOrder ||
      actual.mode !== expected.mode || actual.configuredValue !== expected.configuredValue ||
      actual.baseAmount !== expected.baseAmount || actual.amount !== expected.amount
  })) return false
  return input.depositMode === 'FIXED' && input.depositConfiguredValue === terms.amount && input.depositBaseAmount === null &&
    input.depositAmount === terms.amount && input.depositHoldTtlMinutes === terms.ttlMinutes &&
    input.depositHoldTtlProvenance === terms.ttlProvenance
}

export async function rescheduleManageableAppointment(client: RescheduleClient, input: RescheduleManageableAppointmentInput): Promise<RescheduleManageableAppointmentResult> {
  validateRescheduleInput(input)
  return client.$transaction((tx) => rescheduleManageableAppointmentInTransaction(tx, input))
}

export async function rescheduleManageableAppointmentInTransaction(tx: RescheduleTx, input: RescheduleManageableAppointmentInput): Promise<RescheduleManageableAppointmentResult> {
  const newStartAt = validateRescheduleInput(input)
  const requestHash = rescheduleRequestHash(input)

  // Scope-only lookup: it supplies the professional lock key and raw provider
  // identity. Canonical comparison is intentionally outside SQL so formatted
  // Conversation.phone values authorize the same Customer.normalizedPhone.
  const targets = await tx.$queryRaw<Array<{ professionalId: string; conversationPhone: string }>>(Prisma.sql`
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
  if (targets.length !== 1 || normalizePhone(targets[0]!.conversationPhone) !== input.normalizedPhone) return { outcome: 'INELIGIBLE', replayed: false }
  const professionalId = targets[0]!.professionalId
  await acquireAgendaHierarchy(tx, { businessId: input.businessId, professionalIds: [professionalId] })
  await lockAppointmentRows(tx, { businessId: input.businessId, appointmentIds: [input.appointmentId] })

  const rows = await tx.$queryRaw<Array<{
    appointmentId: string; appointmentVersion: number; customerId: string; professionalId: string; primaryServiceId: string
    appointmentStatus: string; appointmentQuotedPrice: number | null; manualDepositPaid: boolean; manualDepositAmount: number | null
    startAt: Date; totalDurationMinutes: number
    visitId: string | null; visitBusinessId: string | null; visitVersion: number | null; visitSessionId: string | null; visitStatus: string | null
    visitCustomerId: string | null; visitProfessionalId: string | null; visitStartAt: Date | null; visitDuration: number | null
    visitTotalPrice: number | null; holdExpiresAt: Date | null
    depositId: string | null; depositBusinessId: string | null; depositVisitId: string | null; depositStatus: string | null; snapshotSealedAt: Date | null
    depositMode: string | null; depositConfiguredValue: number | null; depositBaseAmount: number | null; depositAmount: number | null
    depositExpiresAt: Date | null; holdTtlMinutes: number | null; holdTtlProvenance: string | null
    reviewedAt: Date | null; reviewedByUserId: string | null; rejectionReason: string | null; proofCount: bigint
  }>>(Prisma.sql`
    SELECT a."id" AS "appointmentId", a."version" AS "appointmentVersion", a."customerId", a."professionalId",
      a."serviceId" AS "primaryServiceId", a."status"::text AS "appointmentStatus", a."quotedPrice" AS "appointmentQuotedPrice",
      a."manualDepositPaid", a."manualDepositAmount", a."startAt", a."totalDurationMinutes",
      v."id" AS "visitId", v."businessId" AS "visitBusinessId", v."version" AS "visitVersion", v."sessionId" AS "visitSessionId",
      v."status"::text AS "visitStatus", v."customerId" AS "visitCustomerId", v."professionalId" AS "visitProfessionalId",
      v."scheduledStartAt" AS "visitStartAt", v."totalDurationMinutes" AS "visitDuration", v."totalPrice" AS "visitTotalPrice",
      v."holdExpiresAt", d."id" AS "depositId", d."businessId" AS "depositBusinessId", d."visitId" AS "depositVisitId", d."status"::text AS "depositStatus",
      d."snapshotSealedAt", d."mode"::text AS "depositMode", d."configuredValue" AS "depositConfiguredValue",
      d."baseAmount" AS "depositBaseAmount", d."amount" AS "depositAmount", d."expiresAt" AS "depositExpiresAt",
       d."holdTtlMinutes", d."holdTtlProvenance"::text AS "holdTtlProvenance", d."reviewedAt", d."reviewedByUserId", d."rejectionReason",
      (SELECT count(*) FROM "BookingDepositProof" proof WHERE proof."businessId" = d."businessId" AND proof."depositId" = d."id")::bigint AS "proofCount"
    FROM "Appointment" a
    JOIN "Customer" c ON c."id" = a."customerId" AND c."businessId" = ${input.businessId} AND c."normalizedPhone" = ${input.normalizedPhone}
    JOIN "Professional" p ON p."id" = a."professionalId" AND p."businessId" = ${input.businessId}
     JOIN "Service" s ON s."id" = a."serviceId" AND s."businessId" = ${input.businessId}
    LEFT JOIN LATERAL (SELECT * FROM "BookingVisit" WHERE "id" = a."visitId" FOR UPDATE) v ON true
    LEFT JOIN LATERAL (SELECT * FROM "BookingDeposit" WHERE "appointmentId" = a."id" FOR UPDATE) d ON true
    WHERE a."id" = ${input.appointmentId}
  `)
  const row = rows[0]
  if (!row) return { outcome: 'INELIGIBLE', replayed: false }

  const replay = await loadRescheduleReplay(tx, input, requestHash)
  if (replay) return replay

  const settings = await tx.$queryRaw<Array<{
    timezone: string | null; bookingLeadTimeHours: number | null; bookingHorizonDays: number | null
    rescheduleLeadMinutes: number | null; depositHoldMinutes: number | null; dbNow: Date
  }>>(Prisma.sql`
    SELECT s."timezone", s."bookingLeadTimeHours", s."bookingHorizonDays", s."rescheduleLeadMinutes",
      s."depositHoldMinutes", clock_timestamp() AS "dbNow"
    FROM "BusinessBotOptionsSettings" s WHERE s."businessId" = ${input.businessId}
    FOR SHARE
  `)
  const setting = settings[0]
  if (!setting || !isUsableTimezone(setting.timezone)) throw new AppointmentReschedulingError('appointment management settings/timezone are unavailable')
  if (setting.rescheduleLeadMinutes === null || !Number.isInteger(setting.rescheduleLeadMinutes) || setting.rescheduleLeadMinutes < 0) {
    throw new AppointmentReschedulingError('appointment management reschedule lead setting is invalid')
  }
  if (setting.bookingHorizonDays === null || !Number.isInteger(setting.bookingHorizonDays) || setting.bookingHorizonDays < 1 || setting.bookingHorizonDays > 90 ||
    setting.bookingLeadTimeHours === null || !Number.isInteger(setting.bookingLeadTimeHours) || setting.bookingLeadTimeHours < 0 ||
    setting.bookingLeadTimeHours >= setting.bookingHorizonDays * 24) {
    throw new AppointmentReschedulingError('appointment booking window settings are invalid')
  }
  if (setting.depositHoldMinutes !== null && (!Number.isInteger(setting.depositHoldMinutes) || setting.depositHoldMinutes <= 0)) {
    throw new AppointmentReschedulingError('appointment deposit hold setting is invalid')
  }

  if (row.manualDepositPaid || row.manualDepositAmount !== null) return { outcome: 'HANDOFF', replayed: false }

  // Keep F7 confirmation's DB-time/local-time semantics verbatim. The settings
  // row is already locked and validated, so malformed timezone/numbers cannot
  // turn these predicates into an uncaught PostgreSQL conversion error.
  const slotPolicies = await tx.$queryRaw<Array<{ insideWindow: boolean; onGrid: boolean }>>(Prisma.sql`
    SELECT
      (
        CAST(${newStartAt} AS timestamptz) >= CAST(${setting.dbNow} AS timestamptz) + make_interval(hours => CAST(${setting.bookingLeadTimeHours} AS integer))
        AND (CAST(${newStartAt} AS timestamptz) AT TIME ZONE CAST(${setting.timezone} AS text))::date >= (CAST(${setting.dbNow} AS timestamptz) AT TIME ZONE CAST(${setting.timezone} AS text))::date
        AND (CAST(${newStartAt} AS timestamptz) AT TIME ZONE CAST(${setting.timezone} AS text))::date < (CAST(${setting.dbNow} AS timestamptz) AT TIME ZONE CAST(${setting.timezone} AS text))::date + CAST(${setting.bookingHorizonDays} AS integer)
      ) AS "insideWindow",
      (
        extract(minute FROM (CAST(${newStartAt} AS timestamptz) AT TIME ZONE CAST(${setting.timezone} AS text)))::int % 30 = 0
        AND extract(second FROM (CAST(${newStartAt} AS timestamptz) AT TIME ZONE CAST(${setting.timezone} AS text))) = 0
      ) AS "onGrid"
  `)
  const slotPolicy = slotPolicies[0]
  if (!slotPolicy) throw new AppointmentReschedulingError('appointment booking window could not be evaluated')

  // Canonical row-lock order under the business agenda root: settings,
  // payment policy, appointment snapshot, catalog services, deposit lines.
  const payment = row.depositId ? await tx.$queryRaw<Array<{
    transferEnabled: boolean; alias: string | null; cbu: string | null; cvu: string | null
    paymentLinkEnabled: boolean; paymentLink: string | null
  }>>(Prisma.sql`
    SELECT "transferEnabled", "alias", "cbu", "cvu", "paymentLinkEnabled", "paymentLink"
    FROM "BusinessPaymentSettings" WHERE "businessId" = ${input.businessId} FOR SHARE
  `) : []

  const appointmentItems = await tx.$queryRaw<AppointmentItem[]>(Prisma.sql`
    SELECT "serviceId", "sortOrder", "durationMinutes", "price" FROM "AppointmentServiceItem"
    WHERE "appointmentId" = ${row.appointmentId} ORDER BY "sortOrder", "serviceId"
    FOR SHARE
  `)
  // Only a true legacy appointment may fall back to its primary service. F7/F8
  // aggregates are expected to carry their ordered service-item snapshot.
  if (!appointmentItems.length && (row.visitId !== null || row.depositId !== null)) return { outcome: 'HANDOFF', replayed: false }
  const serviceIds = appointmentItems.length ? appointmentItems.map((item) => item.serviceId) : [row.primaryServiceId]
  if (!serviceIds.length || new Set(serviceIds).size !== serviceIds.length) return { outcome: 'HANDOFF', replayed: false }
  const lockedServices = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "Service"
    WHERE "businessId" = ${input.businessId} AND "id" IN (${Prisma.join([...serviceIds].sort())})
    ORDER BY "id" FOR SHARE
  `)
  if (lockedServices.length !== serviceIds.length) return { outcome: 'HANDOFF', replayed: false }
  const validation = await revalidateBookingWrite(tx, {
    businessId: input.businessId, professionalId: row.professionalId, serviceIds, startAt: newStartAt,
    excludeAppointmentId: row.appointmentId, timezone: setting.timezone!, dbNow: setting.dbNow
  })
  const retainedItemDuration = appointmentItems.reduce((total, item) => total + item.durationMinutes, 0)
  const durationSnapshotMatches = validation.professionalDuration === row.totalDurationMinutes &&
    (appointmentItems.length === 0 || (
      Number.isSafeInteger(retainedItemDuration) && retainedItemDuration === row.totalDurationMinutes &&
      appointmentItems.every((item, index) => item.durationMinutes === validation.orderedServices[index]?.duration)
    )) &&
    (row.visitId === null || row.visitDuration === row.totalDurationMinutes)
  if (!durationSnapshotMatches) return { outcome: 'HANDOFF', replayed: false }

  let depositSnapshotMatches = false
  if (row.depositId) {
    const lines = await tx.$queryRaw<DepositLine[]>(Prisma.sql`
      SELECT "serviceId", "sortOrder", "mode"::text AS mode, "configuredValue", "baseAmount", "amount"
      FROM "BookingDepositLine" WHERE "businessId" = ${input.businessId} AND "depositId" = ${row.depositId}
      ORDER BY "sortOrder", "serviceId"
      FOR SHARE
    `)
    depositSnapshotMatches = row.snapshotSealedAt !== null && row.depositMode !== null && row.depositConfiguredValue !== null &&
      row.depositAmount !== null && payment.length === 1 && hasCompleteDepositPaymentConfiguration(payment[0]!) &&
      depositSnapshotMatchesCurrentPolicy({
        services: validation.orderedServices, appointmentItems, lines,
        appointmentQuotedPrice: row.appointmentQuotedPrice, visitTotalPrice: row.visitTotalPrice,
        depositMode: row.depositMode, depositConfiguredValue: row.depositConfiguredValue,
        depositBaseAmount: row.depositBaseAmount, depositAmount: row.depositAmount,
        depositHoldTtlMinutes: row.holdTtlMinutes, depositHoldTtlProvenance: row.holdTtlProvenance,
        businessDepositHoldMinutes: setting.depositHoldMinutes
      })
  }

  const visitCoherent = row.visitId !== null && row.visitBusinessId === input.businessId && row.visitCustomerId === row.customerId && row.visitProfessionalId === row.professionalId &&
    row.visitStartAt?.getTime() === row.startAt.getTime() && row.visitDuration === row.totalDurationMinutes
  const depositCoherent = row.depositId !== null && row.depositBusinessId === input.businessId && row.depositVisitId === row.visitId && row.snapshotSealedAt !== null &&
    (row.depositStatus === 'PENDING_PROOF'
      ? row.proofCount === 0n && row.depositExpiresAt?.getTime() === row.holdExpiresAt?.getTime()
      : row.depositStatus === 'PENDING_RESUBMISSION'
        ? row.proofCount > 0n && row.reviewedAt !== null && isNonblank(row.reviewedByUserId) && isNonblank(row.rejectionReason) &&
          row.depositExpiresAt?.getTime() === row.holdExpiresAt?.getTime()
        : row.depositStatus === 'APPROVED'
          ? row.proofCount > 0n && row.reviewedAt !== null && isNonblank(row.reviewedByUserId)
          : false)
  const decision = classifyRescheduleAggregate({
    appointmentStatus: row.appointmentStatus, visitStatus: row.visitStatus, depositStatus: row.depositStatus,
    // F9.7 authorizes the customer by current tenant-scoped canonical conversation
    // identity, not by the BotSession that originally created the visit.
    hasVisit: row.visitId !== null, visitBelongsToSession: row.visitSessionId !== null, visitCoherent, depositCoherent,
    depositSnapshotMatches, originalStartAt: row.startAt, newStartAt, dbNow: setting.dbNow,
    rescheduleLeadMinutes: setting.rescheduleLeadMinutes, depositExpiresAt: row.depositExpiresAt, holdExpiresAt: row.holdExpiresAt
  })
  if (decision === 'HANDOFF') return { outcome: 'HANDOFF', replayed: false }
  if (decision === 'INELIGIBLE') return { outcome: 'INELIGIBLE', replayed: false }
  if (!slotPolicy.insideWindow || !slotPolicy.onGrid || validation.conflicts.length) return { outcome: 'SLOT_CONFLICT', replayed: false }

  const reserved = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "updatedAt")
    VALUES (${randomUUID()}, ${input.operationKey}, 'RESCHEDULE_APPOINTMENT', ${input.businessId}, ${input.sessionId}, 'STARTED', ${requestHash}, ${setting.dbNow})
  `)
  if (reserved !== 1) throw new AppointmentReschedulingError('reschedule operation reservation fence failed')

  const appointmentCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "Appointment" SET "startAt" = ${newStartAt}, "version" = "version" + 1
    WHERE "id" = ${row.appointmentId} AND "version" = ${row.appointmentVersion} AND "startAt" = ${row.startAt}
      AND "professionalId" = ${row.professionalId} AND "status" = ${row.appointmentStatus}::"AppointmentStatus"
  `)
  if (appointmentCount !== 1) throw new AppointmentReschedulingError('reschedule lost its appointment state fence')
  if (row.visitId) {
    const visitCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingVisit" SET "scheduledStartAt" = ${newStartAt}, "version" = "version" + 1, "updatedAt" = ${setting.dbNow}
      WHERE "id" = ${row.visitId} AND "businessId" = ${input.businessId} AND "version" = ${row.visitVersion}
        AND "scheduledStartAt" = ${row.startAt} AND "status" = ${row.visitStatus}::"BookingVisitStatus"
    `)
    if (visitCount !== 1) throw new AppointmentReschedulingError('reschedule lost its visit state fence')
  }
  const depositPreserved = row.depositId !== null
  const historyCount = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "AppointmentChangeHistory" ("id", "appointmentId", "operationKey", "actor", "fromStartAt", "toStartAt", "bookingDepositId", "depositPreserved")
    VALUES (${randomUUID()}, ${row.appointmentId}, ${input.operationKey}, ${input.actor}, ${row.startAt}, ${newStartAt}, ${depositPreserved ? row.depositId : null}, ${depositPreserved})
  `)
  if (historyCount !== 1) throw new AppointmentReschedulingError('reschedule history append failed')
  const completed = await tx.$executeRaw(Prisma.sql`
    UPDATE "BotOperation" SET "status" = 'COMPLETED', "resultRef" = ${row.appointmentId}, "updatedAt" = ${setting.dbNow}
    WHERE "operationKey" = ${input.operationKey} AND "type" = 'RESCHEDULE_APPOINTMENT' AND "status" = 'STARTED' AND "requestHash" = ${requestHash}
  `)
  if (completed !== 1) throw new AppointmentReschedulingError('reschedule operation completion fence failed')
  return { outcome: 'RESCHEDULED', replayed: false, appointmentId: row.appointmentId, newStartAt: newStartAt.toISOString(), depositPreserved }
}

async function loadRescheduleReplay(tx: RescheduleTx, input: RescheduleManageableAppointmentInput, requestHash: string): Promise<RescheduleManageableAppointmentResult | null> {
  const rows = await tx.$queryRaw<Array<{
    businessId: string; sessionId: string; type: string; status: string; requestHash: string; resultRef: string | null
    appointmentId: string | null; toStartAt: Date | null; depositPreserved: boolean | null
  }>>(Prisma.sql`
    SELECT o."businessId", o."sessionId", o."type", o."status", o."requestHash", o."resultRef",
      h."appointmentId", h."toStartAt", h."depositPreserved"
    FROM "BotOperation" o
    LEFT JOIN "AppointmentChangeHistory" h ON h."operationKey" = o."operationKey"
    WHERE o."operationKey" = ${input.operationKey}
    FOR UPDATE OF o
  `)
  const row = rows[0]
  if (!row) return null
  if (row.businessId !== input.businessId || row.sessionId !== input.sessionId || row.type !== 'RESCHEDULE_APPOINTMENT' ||
    row.requestHash !== requestHash || row.status !== 'COMPLETED' || row.resultRef !== input.appointmentId ||
    row.appointmentId !== input.appointmentId || !row.toStartAt || row.depositPreserved === null) {
    throw new AppointmentReschedulingError('reschedule operation cannot be replayed safely')
  }
  return { outcome: 'RESCHEDULED', replayed: true, appointmentId: row.appointmentId, newStartAt: row.toStartAt.toISOString(), depositPreserved: row.depositPreserved }
}

export function validateRescheduleInput(input: RescheduleManageableAppointmentInput): Date {
  for (const [label, value] of Object.entries({ businessId: input.businessId, normalizedPhone: input.normalizedPhone, sessionId: input.sessionId, appointmentId: input.appointmentId, operationKey: input.operationKey })) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.length > 512) throw new AppointmentReschedulingError(`${label} must be a nonblank normalized identifier`)
  }
  if (typeof input.actor !== 'string' || input.actor.trim().length === 0 || input.actor.trim() !== input.actor || input.actor.length > 512) {
    throw new AppointmentReschedulingError('actor must be a nonblank textual principal')
  }
  if (input.confirmed !== true) throw new AppointmentReschedulingError('reschedule confirmation is required')
  if (typeof input.newStartAt !== 'string') throw new AppointmentReschedulingError('newStartAt must be a canonical ISO instant')
  const parsed = new Date(input.newStartAt)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== input.newStartAt) throw new AppointmentReschedulingError('newStartAt must be a canonical ISO instant')
  return parsed
}

function rescheduleRequestHash(input: RescheduleManageableAppointmentInput) {
  return createHash('sha256').update(JSON.stringify({
    action: 'RESCHEDULE_APPOINTMENT', businessId: input.businessId, normalizedPhone: input.normalizedPhone,
    sessionId: input.sessionId, appointmentId: input.appointmentId, operationKey: input.operationKey,
    actor: input.actor, confirmed: input.confirmed, newStartAt: input.newStartAt
  }), 'utf8').digest('hex')
}

function isUsableTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

function isNonblank(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

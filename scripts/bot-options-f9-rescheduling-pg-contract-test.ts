import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import type { Prisma as PrismaTypes } from '../src/generated/prisma/client.js'
import { resolveF9PgContractDatabase } from './f9-pg-contract-database.js'

// Explicit, pre-migrated F9 scratch only. This contract never creates, migrates or drops a database.
const connectionString = resolveF9PgContractDatabase('F9.4/F9.5 rescheduling contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }
const [{ createPrismaClient }, { Prisma }, management, agendaLocks, worker, expiry] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/appointment-management.js'),
  import('../src/services/agenda-locks.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/application/expire-deposit-hold.js')
])
const { rescheduleManageableAppointment, rescheduleManageableAppointmentInTransaction } = management
const prisma = createPrismaClient({ connectionString, max: 8, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f9_reschedule_b_${suffix}`, phone = `54911${suffix.replace(/\D/g, '').slice(0, 8)}`
const x = {
  customer: `f9_reschedule_c_${suffix}`, professional: `f9_reschedule_p_${suffix}`, otherProfessional: `f9_reschedule_p2_${suffix}`,
  service: `f9_reschedule_s_${suffix}`, config: `f9_reschedule_cfg_${suffix}`, deployment: `f9_reschedule_dep_${suffix}`,
  conversation: `f9_reschedule_conv_${suffix}`, session: `f9_reschedule_session_${suffix}`, priorSession: `f9_reschedule_prior_session_${suffix}`,
  foreignBusiness: `f9_reschedule_foreign_b_${suffix}`, foreignService: `f9_reschedule_foreign_s_${suffix}`
}
const at = (day: number, hour: number, minute = 0) => {
  const value = new Date(); value.setUTCDate(value.getUTCDate() + day); value.setUTCHours(hour, minute, 0, 0); return value
}
const input = (appointmentId: string, newStartAt: Date, operationKey = `f9-reschedule:${appointmentId}`) => ({
  businessId, normalizedPhone: phone, sessionId: x.session, appointmentId, operationKey,
  actor: `customer:${phone}`, confirmed: true as const, newStartAt: newStartAt.toISOString()
})

try {
  await seed()
  await prisma.$executeRaw(Prisma.sql`UPDATE "Conversation" SET "phone" = ${`+54 9 11 ${phone.slice(5)}`} WHERE "id" = ${x.conversation}`)

  const legacy = await seedLegacy('legacy', at(1, 9))
  await assertApplied(legacy, at(1, 10), false, false)
  const f7 = await seedVisit('f7', at(1, 11), 'CONFIRMED', null)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "sessionId" = ${x.priorSession} WHERE "id" = (SELECT "visitId" FROM "Appointment" WHERE "id" = ${f7})`)
  await assertApplied(f7, at(1, 12), false, true)

  const pending = await seedVisit('pending', at(2, 9), 'HELD', 'PENDING_PROOF')
  const pendingBefore = await financialSnapshot(pending)
  await assertApplied(pending, at(2, 10), true, true)
  assert.deepEqual(await financialSnapshot(pending), pendingBefore, 'pending proof keeps deposit ID/status/deadlines/TTL/lines byte-for-byte')

  const resubmission = await seedVisit('resubmission', at(3, 9), 'HELD', 'PENDING_RESUBMISSION')
  const resubmissionBefore = await financialSnapshot(resubmission)
  await assertApplied(resubmission, at(3, 10), true, true)
  assert.deepEqual(await financialSnapshot(resubmission), resubmissionBefore, 'resubmission keeps the original TTL and sealed terms')

  const approved = await seedVisit('approved', at(4, 9), 'CONFIRMED', 'APPROVED')
  const approvedBefore = await financialSnapshot(approved)
  await assertApplied(approved, at(4, 10), true, true)
  assert.deepEqual(await financialSnapshot(approved), approvedBefore, 'approved equality preserves the existing deposit without mutation')

  const mixed = await seedMixedVisit('mixed', at(27, 9))
  const mixedBefore = await financialSnapshot(mixed)
  await assertApplied(mixed, at(27, 10), true, true)
  assert.deepEqual(await financialSnapshot(mixed), mixedBefore, 'mixed NONE/deposit services preserve the exact deposit snapshot without inventing lines')

  for (const [tag, visitStatus, depositStatus] of [
    ['review', 'PENDING_PAYMENT_REVIEW', 'PROOF_RECEIVED'],
    ['legacy-deposit', 'CONFIRMED', 'LEGACY'],
    ['incoherent', 'HELD', 'INCOHERENT']
  ] as const) {
    const appointmentId = await seedVisit(tag, at(5, 9), visitStatus, depositStatus)
    await assertNoWrite(appointmentId, input(appointmentId, at(5, 10)), 'HANDOFF', `${tag} must hand off`)
  }

  for (const [index, [tag, mutation]] of ([
    ['service-price', Prisma.sql`UPDATE "Service" SET "price" = 1100 WHERE "id" = ${x.service}`],
    ['deposit-policy', Prisma.sql`UPDATE "Service" SET "depositValue" = 201 WHERE "id" = ${x.service}`],
    ['ttl-policy', Prisma.sql`UPDATE "BusinessBotOptionsSettings" SET "depositHoldMinutes" = 121 WHERE "businessId" = ${businessId}`]
  ] as const).entries()) {
    const appointmentId = await seedVisit(`guard-${tag}`, at(6, 9), 'CONFIRMED', 'APPROVED')
    const target = at(6, 10 + index)
    const marker = `F9_GUARD_ROLLBACK_${tag}`
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.$executeRaw(mutation)
      assert.equal((await rescheduleManageableAppointmentInTransaction(tx, input(appointmentId, target, `${marker}:${suffix}`))).outcome, 'HANDOFF')
      throw new Error(marker)
    }), new RegExp(marker))
    await assertNoWrite(appointmentId, input(appointmentId, target, `guard-check:${tag}:${suffix}`), 'RESCHEDULED', `${tag} rollback restores equality`)
  }

  const serviceSnapshot = await seedVisit('guard-service-id', at(17, 9), 'CONFIRMED', 'APPROVED')
  const professionalSnapshot = await seedVisit('guard-professional', at(18, 9), 'CONFIRMED', 'APPROVED')
  const crossTenantSnapshot = await seedVisit('guard-cross-tenant-service', at(25, 9), 'CONFIRMED', 'APPROVED')
  for (const [tag, appointmentId, target, mutation] of [
    ['service-id', serviceSnapshot, at(17, 10), Prisma.sql`UPDATE "AppointmentServiceItem" SET "serviceId" = ${`${x.service}_other`} WHERE "appointmentId" = ${serviceSnapshot}`],
    ['professional', professionalSnapshot, at(18, 10), Prisma.sql`UPDATE "BookingVisit" SET "professionalId" = ${x.otherProfessional} WHERE "id" = (SELECT "visitId" FROM "Appointment" WHERE "id" = ${professionalSnapshot})`],
    ['cross-tenant-service', crossTenantSnapshot, at(25, 10), Prisma.sql`UPDATE "AppointmentServiceItem" SET "serviceId" = ${x.foreignService} WHERE "appointmentId" = ${crossTenantSnapshot}`]
  ] as const) {
    const marker = `F9_SNAPSHOT_ROLLBACK_${tag}`
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.$executeRaw(mutation)
      assert.equal((await rescheduleManageableAppointmentInTransaction(tx, input(appointmentId, target, `${marker}:${suffix}`))).outcome, 'HANDOFF')
      throw new Error(marker)
    }), new RegExp(marker), `${tag} mismatch must hand off before any writer effect`)
  }

  const insideLead = await seedLegacy('inside-lead', new Date(Date.now() + 30 * 60_000))
  await assertNoWrite(insideLead, input(insideLead, at(7, 10)), 'HANDOFF', 'inside independent reschedule lead hands off')
  const past = await seedLegacy('past', new Date(Date.now() - 60_000))
  await assertNoWrite(past, input(past, at(7, 11)), 'INELIGIBLE', 'past original is ineligible')
  const cancelled = await seedLegacy('cancelled', at(7, 9), 'CANCELLED')
  await assertNoWrite(cancelled, input(cancelled, at(7, 12)), 'INELIGIBLE', 'cancelled original is ineligible')

  const manuallyPaid = await seedLegacy('manual-paid', at(26, 9))
  await prisma.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "manualDepositPaid" = true WHERE "id" = ${manuallyPaid}`)
  await assertNoWrite(manuallyPaid, input(manuallyPaid, at(26, 10)), 'HANDOFF', 'legacy manual paid state must hand off')
  const manualAmount = await seedLegacy('manual-amount', at(26, 11))
  await prisma.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "manualDepositAmount" = 200 WHERE "id" = ${manualAmount}`)
  await assertNoWrite(manualAmount, input(manualAmount, at(26, 12)), 'HANDOFF', 'legacy manual amount state must hand off even when paid is false')

  await assertDurationDriftFailsClosed()

  const occupiedTarget = at(8, 10)
  await seedLegacy('occupant', occupiedTarget)
  const occupied = await seedLegacy('occupied-loser', at(8, 9))
  await assertNoWrite(occupied, input(occupied, occupiedTarget), 'SLOT_CONFLICT', 'occupied target keeps original intact')
  const blocked = await seedLegacy('schedule-block', at(9, 9))
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "startAt", "endAt") VALUES (${`f9_reschedule_block_${suffix}`}, ${businessId}, ${x.professional}, 'OTHER'::"ScheduleBlockReason", ${at(9, 10)}, ${at(9, 11)})`)
  await assertNoWrite(blocked, input(blocked, at(9, 10)), 'SLOT_CONFLICT', 'ScheduleBlock is authoritative')
  const outside = await seedLegacy('outside-hours', at(10, 9))
  await assertNoWrite(outside, input(outside, at(10, 23, 45)), 'SLOT_CONFLICT', 'interval outside configured hours is rejected')

  const outsideHorizon = await seedLegacy('outside-horizon', at(19, 9))
  await assertNoWrite(outsideHorizon, input(outsideHorizon, at(31, 10)), 'SLOT_CONFLICT', 'new slot outside the booking horizon is rejected')
  const offGrid = await seedLegacy('off-grid', at(20, 9))
  await assertNoWrite(offGrid, input(offGrid, at(20, 10, 15)), 'SLOT_CONFLICT', 'new slot outside the 30-minute local grid is rejected')
  const insideBookingLead = await seedLegacy('inside-booking-lead', at(21, 9))
  const leadBefore = await aggregateSnapshot(insideBookingLead), leadMarker = `F9_BOOKING_LEAD_ROLLBACK_${suffix}`
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`UPDATE "BusinessBotOptionsSettings" SET "bookingLeadTimeHours" = 2 WHERE "businessId" = ${businessId}`)
    assert.equal((await rescheduleManageableAppointmentInTransaction(tx, input(insideBookingLead, nextUtcHalfHour(), `lead:${suffix}`))).outcome, 'SLOT_CONFLICT')
    throw new Error(leadMarker)
  }), new RegExp(leadMarker))
  assert.deepEqual(await aggregateSnapshot(insideBookingLead), leadBefore, 'booking-lead rejection has no aggregate/history/operation write')

  await assertPolicyMutationRace()

  const replay = await seedLegacy('replay', at(11, 9)), replayTarget = at(11, 10)
  const replayInput = input(replay, replayTarget)
  const first = await rescheduleManageableAppointment(prisma, replayInput)
  assert.equal(first.outcome, 'RESCHEDULED')
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "manualDepositPaid" = true, "manualDepositAmount" = 200 WHERE "id" = ${replay}`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BusinessBotOptionsSettings" SET "timezone" = 'Invalid/F9Replay' WHERE "businessId" = ${businessId}`)
  })
  const replayChangedState = await aggregateSnapshot(replay), replayOperationCount = await businessOperationCount()
  try {
    assert.deepEqual(await rescheduleManageableAppointment(prisma, replayInput), { ...first, replayed: true }, 'replay is reconstructed from committed history despite changed current state')
    assert.deepEqual(await aggregateSnapshot(replay), replayChangedState, 'replay adds no aggregate or history write')
    assert.equal(await businessOperationCount(), replayOperationCount, 'replay adds no BotOperation write')
    await assert.rejects(() => rescheduleManageableAppointment(prisma, { ...replayInput, actor: 'customer:other' }), /cannot be replayed safely/)
    assert.deepEqual(await aggregateSnapshot(replay), replayChangedState, 'hash mismatch adds no aggregate or history write under changed current state')
    assert.equal(await businessOperationCount(), replayOperationCount, 'hash mismatch adds no BotOperation write under changed current state')
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "manualDepositPaid" = false, "manualDepositAmount" = NULL WHERE "id" = ${replay}`)
      await tx.$executeRaw(Prisma.sql`UPDATE "BusinessBotOptionsSettings" SET "timezone" = 'UTC' WHERE "businessId" = ${businessId}`)
    })
  }

  const rollback = await seedVisit('rollback', at(12, 9), 'HELD', 'PENDING_PROOF'), rollbackBefore = await aggregateSnapshot(rollback)
  await assert.rejects(prisma.$transaction(async (tx) => {
    assert.equal((await rescheduleManageableAppointmentInTransaction(tx, input(rollback, at(12, 10)))).outcome, 'RESCHEDULED')
    throw new Error('F9_RESCHEDULE_FORCED_ROLLBACK')
  }), /F9_RESCHEDULE_FORCED_ROLLBACK/)
  assert.deepEqual(await aggregateSnapshot(rollback), rollbackBefore, 'post-writer rollback removes start/history/operation atomically')

  const same = await seedLegacy('same-race', at(13, 9)), sameTarget = at(13, 10)
  const sameRace = await concurrentlyBehindAgendaLock([
    () => rescheduleManageableAppointment(prisma, input(same, sameTarget, `same-a:${suffix}`)),
    () => rescheduleManageableAppointment(prisma, input(same, sameTarget, `same-b:${suffix}`))
  ])
  assert.equal(sameRace.filter((result) => result.outcome === 'RESCHEDULED').length, 1)
  assert.equal(sameRace.filter((result) => result.outcome === 'INELIGIBLE').length, 1)
  assert.equal((await aggregateSnapshot(same)).histories, 1n, 'same-target race has one truthful from-state history')

  const competitorA = await seedLegacy('competitor-a', at(14, 9)), competitorB = await seedLegacy('competitor-b', at(14, 11)), contested = at(14, 10)
  const competition = await concurrentlyBehindAgendaLock([
    () => rescheduleManageableAppointment(prisma, input(competitorA, contested, `compete-a:${suffix}`)),
    () => rescheduleManageableAppointment(prisma, input(competitorB, contested, `compete-b:${suffix}`))
  ])
  assert.equal(competition.filter((result) => result.outcome === 'RESCHEDULED').length, 1)
  assert.equal(competition.filter((result) => result.outcome === 'SLOT_CONFLICT').length, 1)
  const loser = competition[0].outcome === 'SLOT_CONFLICT' ? competitorA : competitorB
  assert.equal((await aggregateSnapshot(loser)).histories, 0n, 'contended loser remains at its original slot with no audit/op')

  const duePending = await seedVisit('due-pending', at(15, 9), 'HELD', 'PENDING_PROOF', { overdue: true })
  await assertNoWrite(duePending, input(duePending, at(15, 10)), 'INELIGIBLE', 'already-due pending TTL is never extended')
  const dueResubmission = await seedVisit('due-resubmission', at(16, 9), 'HELD', 'PENDING_RESUBMISSION', { overdue: true })
  await assertNoWrite(dueResubmission, input(dueResubmission, at(16, 10)), 'INELIGIBLE', 'already-due resubmission TTL is never extended')

  await assertRescheduleVsExpiryRace('PENDING_PROOF', 22)
  await assertRescheduleVsExpiryRace('PENDING_RESUBMISSION', 23)

  console.log('OK F9.4/F9.5 PG: in-place reschedule, booking-window and sealed-policy guards, replay/rollback and observed policy/expiry contention.')
} finally {
  await cleanup(); await prisma.$disconnect()
}

async function seed() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessId}, ${`F9R-${suffix}`}, 'F9 reschedule')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${x.foreignBusiness}, ${`F9R-FOREIGN-${suffix}`}, 'F9 foreign scope')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${x.config}, ${businessId}, 'deterministic-options', 'F9R', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "updatedAt") VALUES (${x.deployment}, ${businessId}, 'deterministic-options', ${x.config}, 1, 1, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${x.conversation}, ${phone}, ${businessId}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt") VALUES (${x.session}, ${businessId}, ${x.conversation}, ${x.deployment}, 1, 'UTC', '{}'::jsonb, 0, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "status", "updatedAt") VALUES (${x.priorSession}, ${businessId}, ${x.conversation}, ${x.deployment}, 1, 'UTC', '{}'::jsonb, 0, 'CLOSED'::"BotSessionStatus", clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId", "timezone", "depositHoldMinutes", "updatedAt") VALUES (${businessId}, 'UTC', 120, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessPaymentSettings" ("id", "businessId", "transferEnabled", "alias", "paymentLinkEnabled", "createdAt", "updatedAt") VALUES (${`f9_reschedule_payment_${suffix}`}, ${businessId}, true, 'f9.reschedule', false, clock_timestamp(), clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${x.customer}, ${businessId}, 'F9 customer', ${phone}, ${phone})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${x.professional}, ${businessId}, 'F9 professional'), (${x.otherProfessional}, ${businessId}, 'F9 other professional')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration", "price", "priceMode", "depositMode", "depositValue") VALUES (${x.service}, ${businessId}, 'F9 service', 30, 1000, 'FIXED'::"ServicePriceMode", 'FIXED'::"ServiceDepositMode", 200), (${`${x.service}_other`}, ${businessId}, 'F9 other service', 30, 1000, 'FIXED'::"ServicePriceMode", 'NONE'::"ServiceDepositMode", NULL)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration", "price", "priceMode", "depositMode", "depositValue") VALUES (${x.foreignService}, ${x.foreignBusiness}, 'F9 foreign service', 30, 1000, 'FIXED'::"ServicePriceMode", 'FIXED'::"ServiceDepositMode", 200)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalService" ("id", "professionalId", "serviceId") VALUES (${`f9_reschedule_link_${suffix}`}, ${x.professional}, ${x.service}), (${`f9_reschedule_link2_${suffix}`}, ${x.otherProfessional}, ${x.service}), (${`f9_reschedule_link3_${suffix}`}, ${x.professional}, ${`${x.service}_other`})`)
    for (let day = 0; day < 7; day++) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime") VALUES (${`f9_reschedule_bh_${day}_${suffix}`}, ${businessId}, ${day}, '08:00', '20:00')`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime") VALUES (${`f9_reschedule_ph_${day}_${suffix}`}, ${x.professional}, ${day}, '08:00', '20:00')`)
    }
  })
}

async function seedLegacy(tag: string, startAt: Date, status = 'CONFIRMED') {
  const appointmentId = `f9_reschedule_a_${tag}_${suffix}`
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "quotedPrice", "totalDurationMinutes", "status") VALUES (${appointmentId}, ${x.customer}, ${x.professional}, ${x.service}, ${startAt}, 1000, 30, ${status}::"AppointmentStatus")`)
  return appointmentId
}

async function seedVisit(tag: string, startAt: Date, visitStatus: string, depositStatus: string | null, options: { overdue?: boolean; withExpiryJob?: boolean } = {}) {
  const appointmentId = `f9_reschedule_a_${tag}_${suffix}`, visitId = `f9_reschedule_v_${tag}_${suffix}`, depositId = `f9_reschedule_d_${tag}_${suffix}`
  const appointmentStatus = visitStatus === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING'
  const deadline = options.overdue ? new Date(Date.now() - 1000) : new Date(Date.now() + 120 * 60_000)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "totalPrice", "holdExpiresAt", "updatedAt") VALUES (${visitId}, ${businessId}, ${x.customer}, ${x.professional}, ${x.session}, ${visitStatus}::"BookingVisitStatus", ${startAt}, 30, 1000, ${depositStatus ? deadline : null}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "quotedPrice", "totalDurationMinutes", "status", "visitId") VALUES (${appointmentId}, ${x.customer}, ${x.professional}, ${x.service}, ${startAt}, 1000, 30, ${appointmentStatus}::"AppointmentStatus", ${visitId})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointmentId}, ${x.service}, 0, 30, 1000)`)
    if (!depositStatus) return
    if (depositStatus === 'LEGACY') {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "mode", "configuredValue", "amount", "status", "expiresAt", "updatedAt") VALUES (${depositId}, ${businessId}, ${appointmentId}, 'FIXED'::"ServiceDepositMode", 200, 200, 'APPROVED'::"BookingDepositStatus", ${deadline}, clock_timestamp())`)
      return
    }
    const effectiveStatus = depositStatus === 'INCOHERENT' ? 'PENDING_PROOF' : depositStatus
    const reviewed = depositStatus === 'APPROVED' || depositStatus === 'PENDING_RESUBMISSION'
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "visitId", "mode", "configuredValue", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "reviewedAt", "reviewedByUserId", "rejectionReason", "updatedAt") VALUES (${depositId}, ${businessId}, ${appointmentId}, ${depositStatus === 'INCOHERENT' ? null : visitId}, 'FIXED'::"ServiceDepositMode", 200, 200, ${effectiveStatus}::"BookingDepositStatus", ${deadline}, 120, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", ${reviewed ? new Date() : null}, ${reviewed ? 'f9-reviewer' : null}, ${depositStatus === 'PENDING_RESUBMISSION' ? 'PROOF_REJECTED_FOR_RESUBMISSION' : null}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "amount") VALUES (${`f9_reschedule_line_${tag}_${suffix}`}, ${businessId}, ${depositId}, ${x.service}, 0, 'Historical display name', 'FIXED'::"ServiceDepositMode", 200, 200)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp(), "updatedAt" = clock_timestamp() WHERE "id" = ${depositId}`)
    if (depositStatus === 'PENDING_RESUBMISSION' || depositStatus === 'PROOF_RECEIVED' || depositStatus === 'APPROVED') await insertProof(tx, depositId, tag)
    if (options.withExpiryJob) await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "status", "availableAt", "updatedAt") VALUES (${`f9_reschedule_job_${tag}_${suffix}`}, 'EXPIRE_DEPOSIT', ${depositId}, ${businessId}, ${x.deployment}, 1, 'READY'::"BotJobStatus", ${deadline}, clock_timestamp())`)
  })
  return appointmentId
}

async function seedMixedVisit(tag: string, startAt: Date) {
  const appointmentId = `f9_reschedule_a_${tag}_${suffix}`, visitId = `f9_reschedule_v_${tag}_${suffix}`, depositId = `f9_reschedule_d_${tag}_${suffix}`
  const deadline = new Date(Date.now() + 120 * 60_000)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "totalPrice", "holdExpiresAt", "updatedAt") VALUES (${visitId}, ${businessId}, ${x.customer}, ${x.professional}, ${x.session}, 'CONFIRMED'::"BookingVisitStatus", ${startAt}, 60, 2000, ${deadline}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "quotedPrice", "totalDurationMinutes", "status", "visitId") VALUES (${appointmentId}, ${x.customer}, ${x.professional}, ${x.service}, ${startAt}, 2000, 60, 'CONFIRMED'::"AppointmentStatus", ${visitId})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointmentId}, ${x.service}, 0, 30, 1000), (${appointmentId}, ${`${x.service}_other`}, 1, 30, 1000)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "visitId", "mode", "configuredValue", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "reviewedAt", "reviewedByUserId", "updatedAt") VALUES (${depositId}, ${businessId}, ${appointmentId}, ${visitId}, 'FIXED'::"ServiceDepositMode", 200, 200, 'APPROVED'::"BookingDepositStatus", ${deadline}, 120, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", clock_timestamp(), 'f9-reviewer', clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "amount") VALUES (${`f9_reschedule_line_${tag}_${suffix}`}, ${businessId}, ${depositId}, ${x.service}, 0, 'Historical deposit service', 'FIXED'::"ServiceDepositMode", 200, 200)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp(), "updatedAt" = clock_timestamp() WHERE "id" = ${depositId}`)
    await insertProof(tx, depositId, tag)
  })
  return appointmentId
}

async function insertProof(tx: PrismaTypes.TransactionClient, depositId: string, tag: string) {
  const bytes = Buffer.from(`f9-reschedule-proof-${tag}-${suffix}`), hash = createHash('sha256').update(bytes).digest('hex')
  await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositProof" ("id", "businessId", "depositId", "sequence", "kind", "validatorVersion", "validatedAt", "receivedAt", "sourceData", "sourceMimeType", "sourceFilename", "sourceByteSize", "sourceSha256", "derivedData", "derivedMimeType", "derivedByteSize", "derivedSha256", "retentionEligibleAt") VALUES (${`f9_reschedule_proof_${tag}_${suffix}`}, ${businessId}, ${depositId}, 1, 'INITIAL'::"BookingDepositProofKind", 'f9-reschedule-contract', clock_timestamp(), clock_timestamp(), ${bytes}, 'image/png', 'proof.png', ${bytes.length}, ${hash}, ${bytes}, 'image/png', ${bytes.length}, ${hash}, clock_timestamp() + interval '365 days')`)
}

async function assertApplied(appointmentId: string, target: Date, depositPreserved: boolean, hasVisit: boolean) {
  const before = await aggregateSnapshot(appointmentId), result = await rescheduleManageableAppointment(prisma, input(appointmentId, target))
  assert.deepEqual(result, { outcome: 'RESCHEDULED', replayed: false, appointmentId, newStartAt: target.toISOString(), depositPreserved })
  const after = await aggregateSnapshot(appointmentId)
  assert.equal(after.appointments, 1n); assert.equal(after.visits, hasVisit ? 1n : 0n)
  assert.equal(after.startAt.toISOString(), target.toISOString()); assert.equal(after.visitStartAt?.toISOString() ?? null, hasVisit ? target.toISOString() : null)
  assert.equal(after.histories, before.histories + 1n); assert.equal(after.operations, before.operations + 1n)
  assert.equal(after.operationStatus, 'COMPLETED')
}

async function assertNoWrite(appointmentId: string, writerInput: ReturnType<typeof input>, expected: string, label: string) {
  const before = await aggregateSnapshot(appointmentId), operationCountBefore = await businessOperationCount()
  const result = await rescheduleManageableAppointment(prisma, writerInput)
  assert.equal(result.outcome, expected, label)
  if (expected !== 'RESCHEDULED') {
    assert.deepEqual(await aggregateSnapshot(appointmentId), before, `${label}: no aggregate/history write`)
    assert.equal(await businessOperationCount(), operationCountBefore, `${label}: no started/completed operation write`)
  }
}

async function businessOperationCount() {
  return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS count FROM "BotOperation" WHERE "businessId" = ${businessId}
  `))[0]!.count
}

async function aggregateSnapshot(appointmentId: string) {
  return (await prisma.$queryRaw<Array<{ startAt: Date; visitStartAt: Date | null; appointments: bigint; visits: bigint; histories: bigint; operations: bigint; operationStatus: string | null }>>(Prisma.sql`
    SELECT a."startAt", v."scheduledStartAt" AS "visitStartAt",
      (SELECT count(*) FROM "Appointment" x WHERE x."id" = a."id")::bigint AS appointments,
      (SELECT count(*) FROM "BookingVisit" x WHERE x."id" = a."visitId")::bigint AS visits,
      (SELECT count(*) FROM "AppointmentChangeHistory" h WHERE h."appointmentId" = a."id")::bigint AS histories,
      (SELECT count(*) FROM "BotOperation" o WHERE o."businessId" = ${businessId} AND o."resultRef" = a."id")::bigint AS operations,
      (SELECT o."status" FROM "BotOperation" o WHERE o."businessId" = ${businessId} AND o."resultRef" = a."id" ORDER BY o."createdAt" DESC LIMIT 1) AS "operationStatus"
    FROM "Appointment" a LEFT JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE a."id" = ${appointmentId}
  `))[0]!
}

async function financialSnapshot(appointmentId: string) {
  return (await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT d."id", d."status"::text AS status, d."expiresAt", d."holdTtlMinutes", d."holdTtlProvenance"::text AS provenance,
      v."holdExpiresAt", jsonb_agg(jsonb_build_object('serviceId', l."serviceId", 'sortOrder', l."sortOrder", 'mode', l."mode"::text, 'configuredValue', l."configuredValue", 'baseAmount', l."baseAmount", 'amount', l."amount") ORDER BY l."sortOrder") AS lines
    FROM "BookingDeposit" d JOIN "BookingVisit" v ON v."id" = d."visitId" JOIN "BookingDepositLine" l ON l."depositId" = d."id"
    WHERE d."appointmentId" = ${appointmentId} GROUP BY d."id", v."id"
  `))[0]!
}

async function assertPolicyMutationRace() {
  const appointmentId = await seedVisit('policy-race', at(24, 9), 'CONFIRMED', 'APPROVED')
  const target = at(24, 10), before = await aggregateSnapshot(appointmentId), operationCountBefore = await businessOperationCount()
  const [writerResult] = await concurrentlyBehindAgendaLock([
    () => rescheduleManageableAppointment(prisma, input(appointmentId, target, `policy-race:${suffix}`)),
    () => prisma.$transaction(async (tx) => {
      await agendaLocks.acquireAgendaHierarchy(tx, { businessId, professionalIds: [] })
      await tx.$executeRaw(Prisma.sql`UPDATE "Service" SET "depositValue" = 201 WHERE "id" = ${x.service} AND "businessId" = ${businessId}`)
      return 'POLICY_MUTATED' as const
    })
  ])
  assert.ok(writerResult.outcome === 'RESCHEDULED' || writerResult.outcome === 'HANDOFF')
  const after = await aggregateSnapshot(appointmentId)
  if (writerResult.outcome === 'RESCHEDULED') {
    assert.equal(after.startAt.toISOString(), target.toISOString())
    assert.equal(after.histories, before.histories + 1n)
    assert.equal(await businessOperationCount(), operationCountBefore + 1n)
  } else {
    assert.deepEqual(after, before, 'policy-first race must hand off without aggregate/history write')
    assert.equal(await businessOperationCount(), operationCountBefore, 'policy-first race must not reserve an operation')
  }
  await prisma.$transaction(async (tx) => {
    await agendaLocks.acquireAgendaHierarchy(tx, { businessId, professionalIds: [] })
    await tx.$executeRaw(Prisma.sql`UPDATE "Service" SET "depositValue" = 200 WHERE "id" = ${x.service} AND "businessId" = ${businessId}`)
  })
}

async function assertDurationDriftFailsClosed() {
  const appointmentId = await seedVisit('duration-drift', at(28, 9), 'CONFIRMED', 'APPROVED')
  const target = at(28, 10), operationKey = `duration-drift:${suffix}`, marker = `F9_DURATION_DRIFT_ROLLBACK_${suffix}`
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`UPDATE "AppointmentServiceItem" SET "durationMinutes" = 60 WHERE "appointmentId" = ${appointmentId}`)
    await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "totalDurationMinutes" = 60 WHERE "id" = ${appointmentId}`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "totalDurationMinutes" = 60 WHERE "id" = (SELECT "visitId" FROM "Appointment" WHERE "id" = ${appointmentId})`)
    assert.equal((await rescheduleManageableAppointmentInTransaction(tx, input(appointmentId, target, operationKey))).outcome, 'HANDOFF')
    const state = (await tx.$queryRaw<Array<{ startAt: Date; visitStartAt: Date; histories: bigint; operations: bigint }>>(Prisma.sql`
      SELECT a."startAt", v."scheduledStartAt" AS "visitStartAt",
        (SELECT count(*) FROM "AppointmentChangeHistory" h WHERE h."appointmentId" = a."id")::bigint AS histories,
        (SELECT count(*) FROM "BotOperation" o WHERE o."operationKey" = ${operationKey})::bigint AS operations
      FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE a."id" = ${appointmentId}
    `))[0]!
    assert.equal(state.startAt.toISOString(), at(28, 9).toISOString())
    assert.equal(state.visitStartAt.toISOString(), at(28, 9).toISOString())
    assert.equal(state.histories, 0n)
    assert.equal(state.operations, 0n)
    throw new Error(marker)
  }), new RegExp(marker), 'shorter current duration must not move a longer retained appointment')
}

async function assertRescheduleVsExpiryRace(status: 'PENDING_PROOF' | 'PENDING_RESUBMISSION', day: number) {
  const tag = `expiry-race-${status.toLowerCase()}`
  const operationKey = `expiry-race:${status}:${suffix}`
  const appointmentId = await seedVisit(tag, at(day, 9), 'HELD', status, { overdue: true, withExpiryJob: true })
  const details = (await prisma.$queryRaw<Array<{ depositId: string; jobId: string; expiresAt: Date; holdExpiresAt: Date }>>(Prisma.sql`
    SELECT d."id" AS "depositId", j."id" AS "jobId", d."expiresAt", v."holdExpiresAt"
    FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId"
    JOIN "BookingDeposit" d ON d."appointmentId" = a."id"
    JOIN "BotJob" j ON j."aggregateId" = d."id" AND j."kind" = 'EXPIRE_DEPOSIT'
    WHERE a."id" = ${appointmentId}
  `))[0]!
  const claimed = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId })
  assert.ok(claimed && claimed.id === details.jobId, 'expiry race must use the real due EXPIRE_DEPOSIT job')
  const [writerResult, expiryResult] = await concurrentlyBehindAgendaLock([
    () => rescheduleManageableAppointment(prisma, input(appointmentId, at(day, 10), operationKey)),
    () => expiry.expireDepositHold(prisma, claimed!)
  ])
  assert.equal(writerResult.outcome, 'INELIGIBLE')
  assert.equal(expiryResult, 'EXPIRED')
  const state = (await prisma.$queryRaw<Array<{ startAt: Date; visitStartAt: Date; expiresAt: Date; holdExpiresAt: Date; appointmentStatus: string; visitStatus: string; depositStatus: string; histories: bigint; operations: bigint }>>(Prisma.sql`
    SELECT a."startAt", v."scheduledStartAt" AS "visitStartAt", d."expiresAt", v."holdExpiresAt",
      a."status"::text AS "appointmentStatus", v."status"::text AS "visitStatus", d."status"::text AS "depositStatus",
      (SELECT count(*) FROM "AppointmentChangeHistory" h WHERE h."appointmentId" = a."id")::bigint AS histories,
      (SELECT count(*) FROM "BotOperation" o WHERE o."businessId" = ${businessId} AND o."operationKey" = ${operationKey})::bigint AS operations
    FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" JOIN "BookingDeposit" d ON d."appointmentId" = a."id"
    WHERE a."id" = ${appointmentId}
  `))[0]!
  assert.deepEqual(
    { appointment: state.appointmentStatus, visit: state.visitStatus, deposit: state.depositStatus, histories: state.histories, operations: state.operations },
    { appointment: 'CANCELLED', visit: 'EXPIRED', deposit: 'EXPIRED', histories: 0n, operations: 0n },
    `${status} expiry winner leaves no mixed reschedule state`
  )
  assert.equal(state.startAt.toISOString(), state.visitStartAt.toISOString())
  assert.equal(state.expiresAt.toISOString(), details.expiresAt.toISOString(), 'rescheduling never extends deposit expiry')
  assert.equal(state.holdExpiresAt.toISOString(), details.holdExpiresAt.toISOString(), 'rescheduling never extends visit hold expiry')
}

async function concurrentlyBehindAgendaLock<T extends readonly (() => Promise<any>)[]>(contenders: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  let release!: () => void, locked!: (pid: number) => void
  const released = new Promise<void>((resolve) => { release = resolve }), lockHeld = new Promise<number>((resolve) => { locked = resolve })
  const gate = prisma.$transaction(async (tx) => {
    const row = (await tx.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pg_backend_pid() AS pid`))[0]!
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`salon-ai:agenda:v1:business:${businessId}`}, 0))`)
    locked(row.pid); await released
  })
  const blockerPid = await lockHeld, pending = contenders.map((contender) => contender())
  try { await waitForBlockedContenders(blockerPid, contenders.length) } catch (error) { release(); await gate; await Promise.allSettled(pending); throw error }
  release(); await gate
  return Promise.all(pending) as Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>
}

function nextUtcHalfHour() {
  const value = new Date()
  value.setUTCSeconds(0, 0)
  value.setUTCMinutes(value.getUTCMinutes() < 30 ? 30 : 60)
  return value
}

async function waitForBlockedContenders(blockerPid: number, expected: number) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const row = (await prisma.$queryRaw<Array<{ waiting: number }>>(Prisma.sql`SELECT count(*)::int AS waiting FROM pg_stat_activity a WHERE ${blockerPid} = ANY(pg_blocking_pids(a.pid))`))[0]
    if ((row?.waiting ?? 0) >= expected) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`expected ${expected} contenders blocked by the observed agenda lock`)
}

async function cleanup() {
  const retained = (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS count FROM "AppointmentChangeHistory" h
    JOIN "Appointment" a ON a."id" = h."appointmentId"
    JOIN "Customer" c ON c."id" = a."customerId"
    WHERE c."businessId" = ${businessId}
  `))[0]?.count ?? 0n
  // Successful audit rows are deliberately undeletable and RESTRICT parent
  // deletion. Unique IDs prevent collisions; the explicit disposable F9 scratch
  // must be reset externally after a successful/partially committed run.
  if (retained > 0n) return
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ScheduleBlock" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "customerId" = ${x.customer}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ProfessionalHours" WHERE "professionalId" IN (${x.professional}, ${x.otherProfessional})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessHours" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ProfessionalService" WHERE "professionalId" IN (${x.professional}, ${x.otherProfessional})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessPaymentSettings" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "id" = ${x.foreignService} AND "businessId" = ${x.foreignBusiness}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${x.foreignBusiness}`)
  })
}

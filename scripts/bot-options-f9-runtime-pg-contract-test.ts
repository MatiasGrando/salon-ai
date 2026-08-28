import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF9PgContractDatabase } from './f9-pg-contract-database.js'

const connectionString = resolveF9PgContractDatabase('F9.7 runtime contract')
const [{ createPrismaClient }, { Prisma }, processor, stateModule, effectExecutor] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/process-session-job.js'),
  import('../src/bot-options/domain/state.js'),
  import('../src/bot-options/infrastructure/prisma-bot-options-effect-executor.js')
])
const prisma = createPrismaClient({
  connectionString, max: 6, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000,
  transactionOptions: { maxWait: 10_000, timeout: 60_000 }
})
const suffix = randomUUID().replaceAll('-', '')
const ids = {
  business: `f9_runtime_b_${suffix}`, config: `f9_runtime_cfg_${suffix}`, deployment: `f9_runtime_dep_${suffix}`,
  category: `f9_runtime_cat_${suffix}`, service: `f9_runtime_svc_${suffix}`, professional: `f9_runtime_pro_${suffix}`
}

try {
  await seedBusiness()
  await assertRuntimePersistViewRollback()
  await assertRuntimeCancellationFromNewSession()
  await assertRuntimeRescheduleAndHistoryActor()
  console.log('OK F9.7 runtime PG: canonical cross-session cancellation, in-transaction reschedule and historical actor.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function seedBusiness() {
  const weekday = futureAt(3, 10).getUTCDay()
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${ids.business}, ${`F9R-${suffix}`}, 'F9 runtime')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${ids.config}, ${ids.business}, 'deterministic-options', 'F9 runtime', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "updatedAt") VALUES (${ids.deployment}, ${ids.business}, 'deterministic-options', ${ids.config}, 1, 1, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId", "timezone", "bookingHorizonDays", "bookingLeadTimeHours", "morningCutTime", "eveningCutTime", "cancellationLeadMinutes", "rescheduleLeadMinutes", "updatedAt") VALUES (${ids.business}, 'UTC', 30, 0, '09:00', '18:00', 0, 0, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ServiceCategory" ("id", "businessId", "name", "isActive", "updatedAt") VALUES (${ids.category}, ${ids.business}, 'F9 runtime', true, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "catalogCategoryId", "name", "duration", "price", "priceMode", "isBookable", "attentionMode", "estimateAllowsBooking", "depositMode") VALUES (${ids.service}, ${ids.business}, ${ids.category}, 'Corte runtime', 30, 1000, 'FIXED'::"ServicePriceMode", true, 'DIRECT_BOOKING'::"ServiceAttentionMode", true, 'NONE'::"ServiceDepositMode")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name", "isActive", "acceptsBotBookings", "botBookingPriority") VALUES (${ids.professional}, ${ids.business}, 'Profesional runtime', true, true, 1)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalService" ("id", "professionalId", "serviceId") VALUES (${`f9_runtime_link_${suffix}`}, ${ids.professional}, ${ids.service})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime") VALUES (${`f9_runtime_bh_${suffix}`}, ${ids.business}, ${weekday}, '09:00', '18:00')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime") VALUES (${`f9_runtime_ph_${suffix}`}, ${ids.professional}, ${weekday}, '09:00', '18:00')`)
  })
}

async function assertRuntimeCancellationFromNewSession() {
  const fixture = await seedAppointmentFixture('cancel', futureAt(3, 10))
  const state = stateModule.createInitialBotOptionsState()
  state.flow = 'APPOINTMENT_CANCEL_CONFIRM'
  state.selections.appointmentId = fixture.appointmentId
  await setSessionState(fixture.currentSessionId, state)
  await processAction(fixture.currentSessionId, 'appointment.cancel_confirm', fixture.appointmentId, 0n)
  const row = (await prisma.$queryRaw<Array<{ appointment: string; visit: string; flow: string; operation: bigint }>>(Prisma.sql`
    SELECT a."status"::text AS appointment, v."status"::text AS visit,
      (SELECT "state"->>'flow' FROM "BotSession" WHERE "id" = ${fixture.currentSessionId}) AS flow,
      (SELECT count(*) FROM "BotOperation" WHERE "operationKey" = ${`transition:${fixture.currentSessionId}:1`})::bigint AS operation
    FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE a."id" = ${fixture.appointmentId}
  `))[0]
  assert.deepEqual(row, { appointment: 'CANCELLED', visit: 'CANCELLED', flow: 'APPOINTMENT_LIST', operation: 1n })
}

/** The outer runtime transaction, including session/log/prompt/outbox persistence, is atomic. */
async function assertRuntimePersistViewRollback() {
  const original = futureAt(3, 10)
  const target = futureAt(3, 11)
  const fixture = await seedAppointmentFixture('rollback', original)
  const state = stateModule.createInitialBotOptionsState()
  state.flow = 'APPOINTMENT_RESCHEDULE_SUMMARY'
  state.selections.appointmentId = fixture.appointmentId
  state.selections.date = target.toISOString().slice(0, 10)
  state.selections.slotStartAt = target.toISOString()
  await setSessionState(fixture.currentSessionId, state)
  await assert.rejects(
    processAction(fixture.currentSessionId, 'appointment.reschedule_confirm', fixture.appointmentId, 0n, false, true),
    /unique constraint|unique/i
  )
  const row = (await prisma.$queryRaw<Array<{
    appointment: string; visit: string; startAt: Date; visitStartAt: Date; revision: bigint; flow: string; operations: bigint; histories: bigint
    transitions: bigint; outbox: bigint; prompts: bigint; inbox: string; job: string; claim: string
  }>>(Prisma.sql`
    SELECT a."status"::text AS appointment, v."status"::text AS visit, a."startAt", v."scheduledStartAt" AS "visitStartAt",
      (SELECT "revision" FROM "BotSession" WHERE "id" = ${fixture.currentSessionId}) AS revision,
      (SELECT "state"->>'flow' FROM "BotSession" WHERE "id" = ${fixture.currentSessionId}) AS flow,
      (SELECT count(*) FROM "BotOperation" WHERE "businessId" = ${ids.business} AND "sessionId" = ${fixture.currentSessionId})::bigint AS operations,
      (SELECT count(*) FROM "AppointmentChangeHistory" WHERE "appointmentId" = a."id")::bigint AS histories,
      (SELECT count(*) FROM "BotTransitionLog" WHERE "sessionId" = ${fixture.currentSessionId})::bigint AS transitions,
      (SELECT count(*) FROM "BotOutbox" WHERE "sessionId" = ${fixture.currentSessionId})::bigint AS outbox,
      (SELECT count(*) FROM "BotPrompt" WHERE "sessionId" = ${fixture.currentSessionId})::bigint AS prompts,
      (SELECT "status"::text FROM "BotActionInbox" WHERE "sessionId" = ${fixture.currentSessionId}) AS inbox,
      (SELECT "status"::text FROM "BotJob" WHERE "aggregateId" = (SELECT "id" FROM "BotActionInbox" WHERE "sessionId" = ${fixture.currentSessionId})) AS job,
      (SELECT "status"::text FROM "BotDispatchClaim" WHERE "sessionId" = ${fixture.currentSessionId} ORDER BY "updatedAt" DESC LIMIT 1) AS claim
    FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE a."id" = ${fixture.appointmentId}
  `))[0]
  assert.deepEqual(row, {
    appointment: 'CONFIRMED', visit: 'CONFIRMED', startAt: original, visitStartAt: original, revision: 0n, flow: 'APPOINTMENT_RESCHEDULE_SUMMARY',
    operations: 0n, histories: 0n, transitions: 0n, outbox: 1n, prompts: 0n, inbox: 'SELECTED', job: 'LEASED', claim: 'DONE'
  }, 'a persistView outbox conflict rolls back F9 writer, session, log and newly-created prompt/outbox effects')
}

async function assertRuntimeRescheduleAndHistoryActor() {
  const original = futureAt(3, 10)
  const target = futureAt(3, 11)
  const fixture = await seedAppointmentFixture('reschedule', original)
  const state = stateModule.createInitialBotOptionsState()
  state.flow = 'APPOINTMENT_RESCHEDULE_SUMMARY'
  state.selections.appointmentId = fixture.appointmentId
  state.selections.date = target.toISOString().slice(0, 10)
  state.selections.slotStartAt = target.toISOString()
  await setSessionState(fixture.currentSessionId, state)
  await processAction(fixture.currentSessionId, 'appointment.reschedule_confirm', fixture.appointmentId, 0n)
  const row = (await prisma.$queryRaw<Array<{ startAt: Date; visitStartAt: Date; flow: string; actor: string | null }>>(Prisma.sql`
    SELECT a."startAt", v."scheduledStartAt" AS "visitStartAt",
      (SELECT "state"->>'flow' FROM "BotSession" WHERE "id" = ${fixture.currentSessionId}) AS flow,
      (SELECT "actor" FROM "AppointmentChangeHistory" WHERE "appointmentId" = a."id") AS actor
    FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE a."id" = ${fixture.appointmentId}
  `))[0]
  assert.ok(row)
  assert.equal(row!.startAt.toISOString(), target.toISOString())
  assert.equal(row!.visitStartAt.toISOString(), target.toISOString())
  assert.equal(row!.flow, 'APPOINTMENT_DETAIL')
  assert.equal(row!.actor, `bot-session:${fixture.currentSessionId}`)
}

async function seedAppointmentFixture(tag: string, startAt: Date) {
  const digits = `${Date.now()}${Math.floor(Math.random() * 1_000_000_000)}`.slice(-10)
  const phone = `54911${digits.slice(-8)}`
  const conversationId = `f9_runtime_conv_${tag}_${suffix}`
  const currentSessionId = `f9_runtime_current_${tag}_${suffix}`
  const priorSessionId = `f9_runtime_prior_${tag}_${suffix}`
  const customerId = `f9_runtime_customer_${tag}_${suffix}`
  const visitId = `f9_runtime_visit_${tag}_${suffix}`
  const appointmentId = `f9_runtime_appointment_${tag}_${suffix}`
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${conversationId}, ${`+54 9 11 ${phone.slice(5)}`}, ${ids.business}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${customerId}, ${ids.business}, 'Cliente runtime', ${phone}, ${phone})`)
    const blank = JSON.stringify(stateModule.createInitialBotOptionsState())
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt") VALUES (${currentSessionId}, ${ids.business}, ${conversationId}, ${ids.deployment}, 1, 'UTC', ${blank}::jsonb, 0, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "status", "updatedAt") VALUES (${priorSessionId}, ${ids.business}, ${conversationId}, ${ids.deployment}, 1, 'UTC', ${blank}::jsonb, 0, 'CLOSED'::"BotSessionStatus", clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "updatedAt") VALUES (${visitId}, ${ids.business}, ${customerId}, ${ids.professional}, ${priorSessionId}, 'CONFIRMED'::"BookingVisitStatus", ${startAt}, 30, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${appointmentId}, ${customerId}, ${ids.professional}, ${ids.service}, ${startAt}, 30, 'CONFIRMED'::"AppointmentStatus", ${visitId})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointmentId}, ${ids.service}, 0, 30, 1000)`)
  })
  return { currentSessionId, appointmentId }
}

async function setSessionState(sessionId: string, state: object) {
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "state" = ${JSON.stringify(state)}::jsonb WHERE "id" = ${sessionId}`)
}

async function processAction(sessionId: string, actionType: string, appointmentId: string, revision: bigint, failAfterEffect = false, failDuringPersistView = false) {
  const eventId = `f9_runtime_event_${randomUUID()}`, inboxId = `f9_runtime_inbox_${randomUUID()}`, jobId = `f9_runtime_job_${randomUUID()}`, claimToken = randomUUID()
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id", "eventKey", "eventType", "businessId", "providerMessageId", "payload") VALUES (${eventId}, ${eventId}, 'MESSAGE'::"BotProviderEventType", ${ids.business}, ${`wamid.${eventId}`}, '{}'::jsonb)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "sessionId", "providerMessageId", "actionType", "entityRef", "deploymentId", "deploymentGeneration", "expectedRevision", "status") VALUES (${inboxId}, ${ids.business}, ${eventId}, ${sessionId}, ${`wamid.${eventId}`}, ${actionType}, ${JSON.stringify({ type: 'APPOINTMENT', id: appointmentId })}::jsonb, ${ids.deployment}, 1, ${revision}, 'SELECTED'::"BotInboxStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision", "status", "attempts", "leaseToken", "leasedUntil", "updatedAt") VALUES (${jobId}, 'PROCESS_SESSION', ${inboxId}, ${ids.business}, ${ids.deployment}, 1, ${revision}, 'LEASED'::"BotJobStatus", 1, ${claimToken}, clock_timestamp() + interval '30 seconds', clock_timestamp())`)
  })
  if (failDuringPersistView) {
    const transitionId = `transition:${sessionId}:${revision + 1n}`
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload", "idempotencyKey", "status", "availableAt", "updatedAt")
      VALUES (${`f9_runtime_conflict_${randomUUID()}`}, ${ids.business}, ${sessionId}, ${`preexisting:${transitionId}`}, ${randomUUID()}, 0, 'text', '{}'::jsonb, ${`${transitionId}:0`}, 'PENDING'::"BotOutboxStatus", clock_timestamp(), clock_timestamp())
    `)
  }
  const request = { client: prisma, job: {
    id: jobId, kind: 'PROCESS_SESSION', aggregateId: inboxId, businessId: ids.business, deploymentId: ids.deployment,
    deploymentGeneration: 1, expectedRevision: revision, attempts: 1, maxAttempts: 8, claimToken,
    claimedUntil: new Date(Date.now() + 30_000), queueWaitMs: 0
  } }
  if (failAfterEffect) {
    return processor.processSessionJob({
      ...request,
      effectExecutor: async (tx, input) => {
        await effectExecutor.prismaBotOptionsEffectExecutor(tx, input)
        throw new Error('F9_RUNTIME_POST_WRITER_ROLLBACK')
      }
    })
  }
  const result = await processor.processSessionJob(request)
  assert.equal(result, 'PROCESSED')
}

async function cleanup() {
  const retained = (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS count FROM "AppointmentChangeHistory" h
    JOIN "Appointment" a ON a."id" = h."appointmentId"
    JOIN "Professional" p ON p."id" = a."professionalId"
    WHERE p."businessId" = ${ids.business}
  `))[0]?.count ?? 0n
  // F9's history is intentionally append-only and RESTRICTs deleting its
  // parent. Fixture IDs are unique; a successful run is retained until the
  // explicitly permitted F9 scratch reset instead of bypassing that invariant.
  if (retained > 0n) return
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotTransitionLog" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotDispatchClaim" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotActionInbox" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotProviderEvent" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "AppointmentServiceItem" WHERE "appointmentId" IN (SELECT a."id" FROM "Appointment" a JOIN "Professional" p ON p."id" = a."professionalId" WHERE p."businessId" = ${ids.business})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "visitId" IN (SELECT "id" FROM "BookingVisit" WHERE "businessId" = ${ids.business})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ProfessionalService" WHERE "professionalId" = ${ids.professional}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ProfessionalHours" WHERE "professionalId" = ${ids.professional}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessHours" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ServiceCategory" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${ids.business}`)
  })
}

function futureAt(days: number, hour: number) {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + days)
  value.setUTCHours(hour, 0, 0, 0)
  return value
}

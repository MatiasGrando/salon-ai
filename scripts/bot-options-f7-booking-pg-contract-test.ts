import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { resolveF8PgContractDatabase } from './f8-pg-contract-database.js'

const SAFE_DATABASE_URL = resolveF8PgContractDatabase('F7 booking contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }

const [{ createPrismaClient }, { Prisma }, booking, processor, stateModule] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/services/booking-operations.js'),
  import('../src/bot-options/application/process-session-job.js'),
  import('../src/bot-options/domain/state.js')
])

const prisma = createPrismaClient({
  connectionString: SAFE_DATABASE_URL,
  max: 6,
  idleTimeoutMillis: 1_000,
  connectionTimeoutMillis: 3_000,
  transactionOptions
})
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f7book_b_${suffix}`
const configurationId = `f7book_cfg_${suffix}`
const deploymentId = `f7book_dep_${suffix}`
const conversationId = `f7book_conv_${suffix}`
const sessionId = `f7book_session_${suffix}`
const customerId = `f7book_customer_${suffix}`
const categoryId = `f7book_category_${suffix}`
const serviceId = `f7book_service_${suffix}`
const professionalAId = `f7book_pro_a_${suffix}`
const professionalBId = `f7book_pro_b_${suffix}`
const startAt = tomorrowAtNoonUtc()
const date = startAt.toISOString().slice(0, 10)
const weekday = startAt.getUTCDay()

const bookingInput = (operationKey: string, enabled = true) => ({
  businessId,
  sessionId,
  operationKey,
  newBookingAllowed: enabled,
  services: [{ serviceId, name: 'Corte F7', durationMinutes: 30, priceMinor: 1_500, priceMode: 'FIXED' as const }],
  professional: { professionalId: professionalAId, name: 'Alba', assignedByBalancer: true },
  date,
  slotStartAt: startAt.toISOString(),
  totalDurationMinutes: 30,
  totalPriceMinor: 1_500
})

try {
  await seed()

  const confirmed = await prisma.$transaction((tx) => booking.confirmBookingWithoutDeposit(tx, bookingInput(`f7-confirm-${suffix}`)))
  assert.equal(confirmed.kind, 'CONFIRMED')
  assert.equal(confirmed.professional.professionalId, professionalBId, 'any-professional must rebalance using priority after locks')

  const created = await prisma.$queryRaw<Array<{
    visits: bigint; appointments: bigint; items: bigint; completed: bigint; assignedProfessionalId: string | null
  }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BookingVisit" WHERE "businessId" = ${businessId})::bigint AS "visits",
      (SELECT count(*) FROM "Appointment" WHERE "visitId" = ${confirmed.visitId})::bigint AS "appointments",
      (SELECT count(*) FROM "AppointmentServiceItem" WHERE "appointmentId" = ${confirmed.appointmentId})::bigint AS "items",
      (SELECT count(*) FROM "BotOperation" WHERE "operationKey" = ${`f7-confirm-${suffix}:CONFIRM_VISIT`} AND "status" = 'COMPLETED')::bigint AS "completed",
      (SELECT "professionalId" FROM "BookingVisit" WHERE "id" = ${confirmed.visitId}) AS "assignedProfessionalId"
  `)
  assert.deepEqual(created[0], {
    visits: 1n, appointments: 1n, items: 1n, completed: 1n, assignedProfessionalId: professionalBId
  })

  const replay = await prisma.$transaction((tx) => booking.confirmBookingWithoutDeposit(tx, bookingInput(`f7-confirm-${suffix}`)))
  assert.deepEqual(replay, confirmed, 'same operation and payload must replay the committed result')

  // A completed F7 operation created before F8 used this exact hash payload,
  // with no deposit discriminator. A post-deploy retry must still replay it.
  const legacyOperationKey = `f7-pre-f8-${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOperation" ("id", "operationKey", "type", "businessId", "sessionId", "status", "requestHash", "resultRef", "updatedAt")
    VALUES (
      ${randomUUID()}, ${`${legacyOperationKey}:CONFIRM_VISIT`}, 'CONFIRM_VISIT', ${businessId}, ${sessionId},
      'COMPLETED', ${legacyF7BookingHash(bookingInput(legacyOperationKey))}, ${confirmed.visitId}, clock_timestamp()
    )
  `)
  const preF8Replay = await prisma.$transaction((tx) => booking.confirmBookingWithoutDeposit(tx, bookingInput(legacyOperationKey)))
  assert.deepEqual(preF8Replay, confirmed, 'post-F8 code must replay a pre-F8 BotOperation without creating another visit')

  await assert.rejects(
    prisma.$transaction((tx) => booking.confirmBookingWithoutDeposit(tx, {
      ...bookingInput(`f7-confirm-${suffix}`), totalPriceMinor: 1_999
    })),
    /idempotency conflict/i
  )

  await assert.rejects(
    prisma.$transaction((tx) => booking.confirmBookingWithoutDeposit(tx, bookingInput(`f7-capability-${suffix}`, false))),
    /capability is disabled/i
  )

  const occupiedStart = new Date(startAt.getTime() + 60 * 60 * 1000)
  const occupiedDate = occupiedStart.toISOString().slice(0, 10)
  const concurrentInput = (operationKey: string) => ({
    ...bookingInput(operationKey),
    professional: { professionalId: professionalAId, name: 'Alba', assignedByBalancer: false },
    date: occupiedDate,
    slotStartAt: occupiedStart.toISOString()
  })
  const concurrent = await Promise.all([
    prisma.$transaction((tx) => booking.confirmBookingWithoutDeposit(tx, concurrentInput(`f7-race-a-${suffix}`))),
    prisma.$transaction((tx) => booking.confirmBookingWithoutDeposit(tx, concurrentInput(`f7-race-b-${suffix}`)))
  ])
  assert.equal(concurrent.filter((result) => result.kind === 'CONFIRMED').length, 1, 'same slot may commit once only')
  assert.equal(concurrent.filter((result) => result.kind === 'SLOT_CONFLICT').length, 1, 'loser must recover without choosing another slot')

  const beforeRollback = await countBookingRows()
  const rollbackMarker = 'F7_EXPECTED_ROLLBACK'
  await assert.rejects(prisma.$transaction(async (tx) => {
    const result = await booking.confirmBookingWithoutDeposit(tx, {
      ...bookingInput(`f7-rollback-${suffix}`),
      professional: { professionalId: professionalAId, name: 'Alba', assignedByBalancer: false },
      slotStartAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      date
    })
    assert.equal(result.kind, 'CONFIRMED')
    throw new Error(rollbackMarker)
  }), new RegExp(rollbackMarker))
  assert.deepEqual(await countBookingRows(), beforeRollback, 'post-write failure must roll back visit, appointment and operation together')

  await assertProcessJobConfirmation()

  console.log('OK F7.3–F7.6 PG: atomic visit/appointment/items, idempotency, capability, deterministic any-professional, race, rollback and worker/outbox vertical.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function seed() {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessId}, ${`F7-${suffix}`}, 'F7 booking contract')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${configurationId}, ${businessId}, 'deterministic-options', 'F7 contract', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "activatedAt", "updatedAt") VALUES (${deploymentId}, ${businessId}, 'deterministic-options', ${configurationId}, 1, 1, clock_timestamp(), clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${conversationId}, ${`54911${suffix.slice(0, 8)}`}, ${businessId}, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt") VALUES (${sessionId}, ${businessId}, ${conversationId}, ${deploymentId}, 1, 'UTC', '{}'::jsonb, 0, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${customerId}, ${businessId}, 'Cliente F7', ${`54911${suffix.slice(0, 8)}`}, ${`54911${suffix.slice(0, 8)}`})`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId", "timezone", "bookingHorizonDays", "bookingLeadTimeHours", "morningCutTime", "eveningCutTime", "updatedAt") VALUES (${businessId}, 'UTC', 30, 0, '12:30', '16:30', clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ServiceCategory" ("id", "businessId", "name", "isActive", "updatedAt") VALUES (${categoryId}, ${businessId}, 'F7', true, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "catalogCategoryId", "name", "duration", "price", "priceMode", "isBookable", "attentionMode", "estimateAllowsBooking", "depositMode") VALUES (${serviceId}, ${businessId}, ${categoryId}, 'Corte F7', 30, 1500, 'FIXED'::"ServicePriceMode", true, 'DIRECT_BOOKING'::"ServiceAttentionMode", true, 'NONE'::"ServiceDepositMode")`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name", "isActive", "acceptsBotBookings", "botBookingPriority") VALUES (${professionalAId}, ${businessId}, 'Alba', true, true, 10), (${professionalBId}, ${businessId}, 'Bruno', true, true, 1)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalService" ("id", "professionalId", "serviceId") VALUES (${`f7linka_${suffix}`}, ${professionalAId}, ${serviceId}), (${`f7linkb_${suffix}`}, ${professionalBId}, ${serviceId})`)
  for (const professionalId of [professionalAId, professionalBId]) {
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime") VALUES (${`f7ph_${professionalId}`}, ${professionalId}, ${weekday}, '09:00', '18:00')`)
  }
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime") VALUES (${`f7bh_${suffix}`}, ${businessId}, ${weekday}, '09:00', '18:00')`)
}

async function countBookingRows() {
  const rows = await prisma.$queryRaw<Array<{ visits: bigint; appointments: bigint; operations: bigint }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BookingVisit" WHERE "businessId" = ${businessId})::bigint AS "visits",
      (SELECT count(*) FROM "Appointment" a JOIN "Professional" p ON p."id" = a."professionalId" WHERE p."businessId" = ${businessId})::bigint AS "appointments",
      (SELECT count(*) FROM "BotOperation" WHERE "businessId" = ${businessId})::bigint AS "operations"
  `)
  return rows[0]!
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotTransitionLog" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotDispatchClaim" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotActionInbox" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotProviderEvent" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "AppointmentServiceItem" WHERE "appointmentId" IN (SELECT a."id" FROM "Appointment" a JOIN "Professional" p ON p."id" = a."professionalId" WHERE p."businessId" = ${businessId})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "visitId" IN (SELECT "id" FROM "BookingVisit" WHERE "businessId" = ${businessId})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ProfessionalService" WHERE "professionalId" IN (${professionalAId}, ${professionalBId})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ProfessionalHours" WHERE "professionalId" IN (${professionalAId}, ${professionalBId})`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "ServiceCategory" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessHours" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`)
  })
}

async function assertProcessJobConfirmation() {
  const e2eConversationId = `f7book_e2e_conv_${suffix}`
  const e2eSessionId = `f7book_e2e_session_${suffix}`
  const e2eCustomerId = `f7book_e2e_customer_${suffix}`
  const e2ePhone = `54912${suffix.slice(0, 8)}`
  const e2eStart = new Date(startAt.getTime() + 3 * 60 * 60 * 1000)
  const e2eDate = e2eStart.toISOString().slice(0, 10)
  const eventId = `f7book_e2e_event_${suffix}`
  const inboxId = `f7book_e2e_inbox_${suffix}`
  const jobId = `f7book_e2e_job_${suffix}`
  const claimToken = randomUUID()
  const state = stateModule.createInitialBotOptionsState()
  state.flow = 'BOOKING_SUMMARY'
  state.booking = 'DRAFT'
  state.cart = [{ serviceId }]
  state.selections = {
    ...state.selections,
    professionalId: null,
    anyProfessional: true,
    date: e2eDate,
    slotStartAt: e2eStart.toISOString(),
    provisionalProfessionalId: professionalAId
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${e2eConversationId}, ${e2ePhone}, ${businessId}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${e2eCustomerId}, ${businessId}, 'Cliente E2E F7', ${e2ePhone}, ${e2ePhone})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt") VALUES (${e2eSessionId}, ${businessId}, ${e2eConversationId}, ${deploymentId}, 1, 'UTC', ${JSON.stringify(state)}::jsonb, 0, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id", "eventKey", "eventType", "businessId", "providerMessageId", "payload") VALUES (${eventId}, ${`f7book-e2e-${suffix}`}, 'MESSAGE'::"BotProviderEventType", ${businessId}, ${`wamid.f7book.${suffix}`}, '{}'::jsonb)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "sessionId", "providerMessageId", "actionType", "deploymentId", "deploymentGeneration", "expectedRevision", "status") VALUES (${inboxId}, ${businessId}, ${eventId}, ${e2eSessionId}, ${`wamid.f7book.${suffix}`}, 'booking.confirm', ${deploymentId}, 1, 0, 'SELECTED'::"BotInboxStatus")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision", "status", "attempts", "leaseToken", "leasedUntil", "updatedAt") VALUES (${jobId}, 'PROCESS_SESSION', ${inboxId}, ${businessId}, ${deploymentId}, 1, 0, 'LEASED'::"BotJobStatus", 1, ${claimToken}, clock_timestamp() + interval '30 seconds', clock_timestamp())`)
  })
  process.env.BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED = 'true'
  process.env.BOT_OPTIONS_CAPABILITY_BOOKING_ENABLED = 'true'
  const result = await processor.processSessionJob({
    client: prisma,
    job: {
      id: jobId,
      kind: 'PROCESS_SESSION',
      aggregateId: inboxId,
      businessId,
      deploymentId,
      deploymentGeneration: 1,
      expectedRevision: 0n,
      attempts: 1,
      maxAttempts: 8,
      claimToken,
      claimedUntil: new Date(Date.now() + 30_000),
      queueWaitMs: 0
    }
  })
  assert.equal(result, 'PROCESSED')
  const rows = await prisma.$queryRaw<Array<{ flow: string; booking: string; visits: bigint; outbox: bigint; processed: bigint }>>(Prisma.sql`
    SELECT
      (SELECT "state"->>'flow' FROM "BotSession" WHERE "id" = ${e2eSessionId}) AS "flow",
      (SELECT "state"->>'booking' FROM "BotSession" WHERE "id" = ${e2eSessionId}) AS "booking",
      (SELECT count(*) FROM "BookingVisit" WHERE "sessionId" = ${e2eSessionId})::bigint AS "visits",
      (SELECT count(*) FROM "BotOutbox" WHERE "sessionId" = ${e2eSessionId})::bigint AS "outbox",
      (SELECT count(*) FROM "BotActionInbox" WHERE "id" = ${inboxId} AND "status" = 'PROCESSED'::"BotInboxStatus")::bigint AS "processed"
  `)
  assert.deepEqual(rows[0], { flow: 'BOOKING_CONFIRMED', booking: 'CONFIRMED', visits: 1n, outbox: 1n, processed: 1n })
}

function tomorrowAtNoonUtc() {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + 1)
  value.setUTCHours(12, 0, 0, 0)
  return value
}

function legacyF7BookingHash(input: ReturnType<typeof bookingInput>) {
  return createHash('sha256').update(JSON.stringify({
    services: input.services,
    professional: input.professional,
    date: input.date,
    slotStartAt: input.slotStartAt,
    totalDurationMinutes: input.totalDurationMinutes,
    totalPriceMinor: input.totalPriceMinor
  }), 'utf8').digest('hex')
}

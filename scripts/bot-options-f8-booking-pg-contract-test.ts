import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF8PgContractDatabase } from './f8-pg-contract-database.js'

const SAFE_DATABASE_URL = resolveF8PgContractDatabase('F8 booking contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }

const [{ createPrismaClient }, { Prisma }, booking] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/services/booking-operations.js')
])

const prisma = createPrismaClient({
  connectionString: SAFE_DATABASE_URL,
  max: 6,
  idleTimeoutMillis: 1_000,
  connectionTimeoutMillis: 3_000,
  transactionOptions
})
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f8book_b_${suffix}`
const configurationId = `f8book_cfg_${suffix}`
const deploymentId = `f8book_dep_${suffix}`
const conversationId = `f8book_conv_${suffix}`
const sessionId = `f8book_session_${suffix}`
const customerId = `f8book_customer_${suffix}`
const categoryId = `f8book_category_${suffix}`
const serviceId = `f8book_service_${suffix}`
const unselectedServiceId = `f8book_service_unselected_${suffix}`
const paymentId = `f8book_pay_${suffix}`
const professionalAId = `f8book_pro_a_${suffix}`
const professionalBId = `f8book_pro_b_${suffix}`
const startAt = tomorrowAtNoonUtc()
const date = startAt.toISOString().slice(0, 10)
const weekday = startAt.getUTCDay()
// The contract deliberately holds a PostgreSQL row lock for the seal-vs-append
// race. This applies only to its isolated harness, not production defaults.

const depositInput = (operationKey: string, enabled = true) => ({
  businessId,
  sessionId,
  operationKey,
  newBookingAllowed: enabled,
  services: [{ serviceId, name: 'Corte F8', durationMinutes: 30, priceMinor: 1_500, priceMode: 'FIXED' as const }],
  professional: { professionalId: professionalAId, name: 'Alba', assignedByBalancer: false },
  date,
  slotStartAt: startAt.toISOString(),
  totalDurationMinutes: 30,
  totalPriceMinor: 1_500
})

try {
  await seed()

  // F8.3 atomic creation of every financial + agenda row inside the caller transaction.
  const held = await prisma.$transaction((tx) => booking.holdBookingWithDeposit(tx, depositInput(`f8-hold-${suffix}`)), transactionOptions)
  assert.equal(held.kind, 'HELD')
  assert.equal(held.professional.professionalId, professionalAId, 'deposit hold must pin to the locked professional')
  assert.equal(held.amount, 500, 'FIXED deposit of 500 over a 1500 service')
  assert.ok(held.expiresAt instanceof Date && held.expiresAt.getTime() > Date.now())

  const created = await prisma.$queryRaw<Array<{
    heldVisits: bigint; pendingAppointments: bigint; pendingDeposits: bigint
    depositLines: bigint; expireJobs: bigint; completedOps: bigint
  }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BookingVisit" WHERE "businessId" = ${businessId} AND "status" = 'HELD'::"BookingVisitStatus")::bigint AS "heldVisits",
      (SELECT count(*) FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE v."businessId" = ${businessId} AND a."status" = 'PENDING'::"AppointmentStatus")::bigint AS "pendingAppointments",
      (SELECT count(*) FROM "BookingDeposit" WHERE "businessId" = ${businessId} AND "status" = 'PENDING_PROOF'::"BookingDepositStatus")::bigint AS "pendingDeposits",
      (SELECT count(*) FROM "BookingDepositLine" WHERE "businessId" = ${businessId})::bigint AS "depositLines",
      (SELECT count(*) FROM "BotJob" WHERE "businessId" = ${businessId} AND "kind" = 'EXPIRE_DEPOSIT')::bigint AS "expireJobs",
      (SELECT count(*) FROM "BotOperation" WHERE "businessId" = ${businessId} AND "type" = 'HOLD_VISIT_WITH_DEPOSIT' AND "status" = 'COMPLETED')::bigint AS "completedOps"
  `)
  assert.deepEqual(created[0], {
    heldVisits: 1n, pendingAppointments: 1n, pendingDeposits: 1n, depositLines: 1n, expireJobs: 1n, completedOps: 1n
  }, 'every deposit hold row must be written atomically')

  // Snapshot + job scheduling details match the held result.
  const snapshot = await prisma.$queryRaw<Array<{
    depositId: string; lineId: string; amount: number; expiresAt: Date; snapshotSealedAt: Date | null; jobAvailableAt: Date
    lineServiceId: string; lineServiceName: string; lineMode: string
    lineConfigured: number; lineAmount: number; lineSort: number
  }>>(Prisma.sql`
    SELECT d."id" AS "depositId", l."id" AS "lineId", d."amount", d."expiresAt", d."snapshotSealedAt", j."availableAt" AS "jobAvailableAt",
      l."serviceId" AS "lineServiceId", l."serviceName" AS "lineServiceName", l."mode"::text AS "lineMode",
      l."configuredValue" AS "lineConfigured", l."amount" AS "lineAmount", l."sortOrder" AS "lineSort"
    FROM "BookingDeposit" d
    JOIN "BotJob" j ON j."aggregateId" = d."id" AND j."businessId" = ${businessId}
    JOIN "BookingDepositLine" l ON l."depositId" = d."id"
    WHERE d."businessId" = ${businessId} AND d."status" = 'PENDING_PROOF'::"BookingDepositStatus"
  `)
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0]!.amount, 500)
  assert.ok(snapshot[0]!.snapshotSealedAt instanceof Date, 'the financial snapshot must be sealed in the hold transaction')
  assert.equal(snapshot[0]!.expiresAt.getTime(), held.expiresAt.getTime(), 'deposit expiresAt must match the held result')
  assert.equal(snapshot[0]!.jobAvailableAt.getTime(), held.expiresAt.getTime(), 'EXPIRE_DEPOSIT job must fire at deposit expiry')
  assert.deepEqual(
    { serviceId: snapshot[0]!.lineServiceId, serviceName: snapshot[0]!.lineServiceName, mode: snapshot[0]!.lineMode, configured: snapshot[0]!.lineConfigured, amount: snapshot[0]!.lineAmount, sort: snapshot[0]!.lineSort },
    { serviceId, serviceName: 'Corte F8', mode: 'FIXED', configured: 500, amount: 500, sort: 0 },
    'deposit line must snapshot the canonical service terms'
  )
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`UPDATE "BookingDepositLine" SET "serviceName" = 'Alterado' WHERE "id" = ${snapshot[0]!.lineId}`),
    /immutable/i,
    'a captured deposit line must not be editable'
  )
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "id" = ${snapshot[0]!.lineId}`),
    /immutable/i,
    'a captured line cannot be removed while its deposit exists'
  )
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "id" = ${snapshot[0]!.lineId}`)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "BookingDepositLine" (
          "id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "baseAmount", "amount"
        ) VALUES (
          ${randomUUID()}, ${businessId}, ${snapshot[0]!.depositId}, ${serviceId}, 0, 'Snapshot reemplazado',
          'FIXED'::"ServiceDepositMode", 500, NULL, 500
        )
      `)
    }),
    /snapshot is sealed/i,
    'a delete-and-replace transaction cannot rewrite a captured financial snapshot'
  )
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`
      INSERT INTO "BookingDepositLine" (
        "id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "baseAmount", "amount"
      ) VALUES (
        ${randomUUID()}, ${businessId}, ${snapshot[0]!.depositId}, ${unselectedServiceId}, 1, 'Servicio no elegido',
        'FIXED'::"ServiceDepositMode", 1, NULL, 1
      )
    `),
    /snapshot is sealed|must be selected/i,
    'a line cannot reference a service absent from the held appointment after bypassing neither seal nor membership'
  )
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`
      INSERT INTO "BookingDepositLine" (
        "id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "baseAmount", "amount"
      ) VALUES (
        ${randomUUID()}, ${businessId}, ${snapshot[0]!.depositId}, ${serviceId}, 1, 'Append de monto cero',
        'FIXED'::"ServiceDepositMode", 1, NULL, 0
      )
    `),
    /snapshot is sealed/i,
    'no line, even a zero-amount line, may be appended after capture'
  )
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "amount" = 499 WHERE "id" = ${snapshot[0]!.depositId}`),
    /terms are immutable/i,
    'the root amount must remain equal to its snapshot lines'
  )
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "holdTtlMinutes" = 1 WHERE "id" = ${snapshot[0]!.depositId}`),
    /terms are immutable/i,
    'post-seal TTL policy cannot be tampered with'
  )
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() WHERE "id" = ${snapshot[0]!.depositId}`),
    /terms are immutable/i,
    'the original snapshot seal timestamp is immutable'
  )

  // F8.3 idempotent replay returns the committed result for the same operation + payload.
  const replay = await prisma.$transaction((tx) => booking.holdBookingWithDeposit(tx, depositInput(`f8-hold-${suffix}`)))
  assert.deepEqual(replay, held, 'same operation and payload must replay the committed HELD result')
  const afterReplay = await prisma.$queryRaw<Array<{
    heldVisits: bigint; pendingAppointments: bigint; pendingDeposits: bigint
    depositLines: bigint; expireJobs: bigint; completedOps: bigint
  }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BookingVisit" WHERE "businessId" = ${businessId} AND "status" = 'HELD'::"BookingVisitStatus")::bigint AS "heldVisits",
      (SELECT count(*) FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE v."businessId" = ${businessId} AND a."status" = 'PENDING'::"AppointmentStatus")::bigint AS "pendingAppointments",
      (SELECT count(*) FROM "BookingDeposit" WHERE "businessId" = ${businessId} AND "status" = 'PENDING_PROOF'::"BookingDepositStatus")::bigint AS "pendingDeposits",
      (SELECT count(*) FROM "BookingDepositLine" WHERE "businessId" = ${businessId})::bigint AS "depositLines",
      (SELECT count(*) FROM "BotJob" WHERE "businessId" = ${businessId} AND "kind" = 'EXPIRE_DEPOSIT')::bigint AS "expireJobs",
      (SELECT count(*) FROM "BotOperation" WHERE "businessId" = ${businessId} AND "type" = 'HOLD_VISIT_WITH_DEPOSIT' AND "status" = 'COMPLETED')::bigint AS "completedOps"
  `)
  assert.deepEqual(afterReplay[0], {
    heldVisits: 1n, pendingAppointments: 1n, pendingDeposits: 1n, depositLines: 1n, expireJobs: 1n, completedOps: 1n
  }, 'replay must not duplicate any row')

  // F8.3 mismatched replay (same operationKey, different payload) is rejected.
  await assert.rejects(
    prisma.$transaction((tx) => booking.holdBookingWithDeposit(tx, {
      ...depositInput(`f8-hold-${suffix}`), totalPriceMinor: 1_999
    })),
    /idempotency conflict/i
  )

  // F8.3 same-slot concurrency: exactly one HELD and one SLOT_CONFLICT.
  const raceStart = new Date(startAt.getTime() + 3 * 60 * 60 * 1000)
  const raceDate = raceStart.toISOString().slice(0, 10)
  const concurrentInput = (operationKey: string) => ({
    ...depositInput(operationKey),
    professional: { professionalId: professionalAId, name: 'Alba', assignedByBalancer: false },
    date: raceDate,
    slotStartAt: raceStart.toISOString()
  })
  const concurrent = await Promise.all([
    prisma.$transaction((tx) => booking.holdBookingWithDeposit(tx, concurrentInput(`f8-race-a-${suffix}`))),
    prisma.$transaction((tx) => booking.holdBookingWithDeposit(tx, concurrentInput(`f8-race-b-${suffix}`)))
  ])
  assert.equal(concurrent.filter((result) => result.kind === 'HELD').length, 1, 'same slot may commit one deposit hold only')
  assert.equal(concurrent.filter((result) => result.kind === 'SLOT_CONFLICT').length, 1, 'loser must recover without choosing another slot')

  // F8.3 transaction rollback removes every booking/deposit/job/operation row.
  const beforeRollback = await countHoldRows()
  const rollbackMarker = 'F8_EXPECTED_ROLLBACK'
  await assert.rejects(prisma.$transaction(async (tx) => {
    const result = await booking.holdBookingWithDeposit(tx, {
      ...depositInput(`f8-rollback-${suffix}`),
      professional: { professionalId: professionalAId, name: 'Alba', assignedByBalancer: false },
      slotStartAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      date: new Date(startAt.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10)
    })
    assert.equal(result.kind, 'HELD')
    throw new Error(rollbackMarker)
  }), new RegExp(rollbackMarker))
  assert.deepEqual(await countHoldRows(), beforeRollback, 'post-write failure must roll back visit, appointment, deposit, line, job and operation together')

  // F8.3 missing payment config fails before any row persists.
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessPaymentSettings" WHERE "businessId" = ${businessId}`)
  const beforeMissingConfig = await countHoldRows()
  const paymentGuardStart = new Date(startAt.getTime() + 4 * 60 * 60 * 1000)
  await assert.rejects(
    prisma.$transaction((tx) => booking.holdBookingWithDeposit(tx, {
      ...depositInput(`f8-nopay-${suffix}`),
      slotStartAt: paymentGuardStart.toISOString(),
      date: paymentGuardStart.toISOString().slice(0, 10)
    })),
    /deposit payment configuration unavailable/i
  )
  assert.deepEqual(await countHoldRows(), beforeMissingConfig, 'missing payment config must reject before writing rows')

  // F8 seal-vs-append race: a deferred, serialized append cannot land after seal.
  // The BEFORE INSERT trigger on BookingDepositLine locks the deposit root FOR
  // UPDATE, so transaction B must wait until transaction A commits; once A has
  // sealed the snapshot, B observes the seal and is rejected.
  const raceVisitId = `f8race_visit_${suffix}`
  const raceAppointmentId = `f8race_appt_${suffix}`
  const raceDepositId = `f8race_dep_${suffix}`
  const raceLineAId = `f8race_line_a_${suffix}`
  const raceLineBId = `f8race_line_b_${suffix}`
  const raceSecondServiceId = `f8race_service_b_${suffix}`
  const raceStartAt = new Date(startAt.getTime() + 5 * 60 * 60 * 1000)

  // A committed legacy deposit is visible to B. A then locks and converts it
  // to F8; this lets the test observe B blocked on a real PostgreSQL row lock
  // before A seals the new snapshot.
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "catalogCategoryId", "name", "duration", "price", "priceMode", "isBookable", "attentionMode", "estimateAllowsBooking", "depositMode", "depositValue") VALUES (${raceSecondServiceId}, ${businessId}, ${categoryId}, 'Servicio F8 carrera', 30, 1000, 'FIXED'::"ServicePriceMode", true, 'DIRECT_BOOKING'::"ServiceAttentionMode", true, 'FIXED'::"ServiceDepositMode", 100)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "origin", "updatedAt") VALUES (${raceVisitId}, ${businessId}, ${customerId}, ${professionalAId}, ${sessionId}, 'HELD'::"BookingVisitStatus", ${raceStartAt.toISOString()}, 30, 'BOT'::"AppointmentOrigin", clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "origin", "totalDurationMinutes", "status", "visitId", "version") VALUES (${raceAppointmentId}, ${customerId}, ${professionalAId}, ${serviceId}, ${raceStartAt.toISOString()}, 'BOT'::"AppointmentOrigin", 30, 'PENDING'::"AppointmentStatus", ${raceVisitId}, 0)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${raceAppointmentId}, ${serviceId}, 0, 30, 1500), (${raceAppointmentId}, ${raceSecondServiceId}, 1, 30, 1000)`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BookingDeposit" (
      "id", "businessId", "appointmentId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "updatedAt"
    ) VALUES (
      ${raceDepositId}, ${businessId}, ${raceAppointmentId}, 'WHATSAPP'::"BookingDepositSource",
      'FIXED'::"ServiceDepositMode", 100, 100, 'PENDING_PROOF'::"BookingDepositStatus",
      ${new Date(raceStartAt.getTime() + 90 * 60 * 1000).toISOString()}, clock_timestamp()
    )
  `)

  // Two independent transactions race on the visible deposit root. A locks and
  // converts it to an UNSEALED F8 root, then pauses before adding its initial
  // line and seal; B must block on that same root lock until A commits.
  let resolveRootInserted!: () => void
  let resolveReleaseA!: () => void
  let resolveBReady!: () => void
  let resolveStartAppend!: () => void
  const rootInserted = new Promise<void>((r) => { resolveRootInserted = r })
  const releaseA = new Promise<void>((r) => { resolveReleaseA = r })
  const bReady = new Promise<void>((r) => { resolveBReady = r })
  const startAppend = new Promise<void>((r) => { resolveStartAppend = r })
  let bBackendPid: number | null = null

  const txA = prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT 1 FROM "BookingDeposit" WHERE "id" = ${raceDepositId} AND "businessId" = ${businessId} FOR UPDATE`)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "BookingDeposit"
      SET "visitId" = ${raceVisitId}, "holdTtlMinutes" = 90,
        "holdTtlProvenance" = 'BUSINESS_POLICY'::"BookingDepositTtlProvenance"
      WHERE "id" = ${raceDepositId} AND "businessId" = ${businessId}
    `)
    resolveRootInserted()
    await releaseA
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "baseAmount", "amount") VALUES (${raceLineAId}, ${businessId}, ${raceDepositId}, ${serviceId}, 0, 'Corte F8', 'FIXED'::"ServiceDepositMode", 100, NULL, 100)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() WHERE "id" = ${raceDepositId}`)
  })

  const txB = (async () => {
    await rootInserted
    return prisma.$transaction(async (tx) => {
      const backend = await tx.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`)
      bBackendPid = backend[0]?.pid ?? null
      resolveBReady()
      await startAppend
      // B attempts a zero-amount append. It blocks on the root FOR UPDATE held
      // by A, then observes the seal and must be rejected.
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "baseAmount", "amount") VALUES (${raceLineBId}, ${businessId}, ${raceDepositId}, ${raceSecondServiceId}, 1, 'Append monto cero', 'FIXED'::"ServiceDepositMode", 100, NULL, 0)`)
    })
  })()

  await bReady
  assert.ok(bBackendPid, 'transaction B must expose its PostgreSQL backend')
  resolveStartAppend()
  await waitForDatabaseLock(bBackendPid)
  resolveReleaseA()
  const [aOutcome, bOutcome] = await Promise.allSettled([txA, txB])
  assert.equal(aOutcome.status, 'fulfilled', 'transaction A must seal and commit its snapshot')
  assert.equal(bOutcome.status, 'rejected', 'transaction B append must be rejected')
  const bMessage = bOutcome.status === 'rejected' ? String((bOutcome as { reason: unknown }).reason) : ''
  assert.match(bMessage, /snapshot is sealed/i, 'B must be rejected because the snapshot is already sealed')

  const finalSnapshot = await prisma.$queryRaw<Array<{ lineCount: bigint; lineTotal: bigint; sealedAt: Date | null }>>(Prisma.sql`
    SELECT count(l."id")::bigint AS "lineCount", COALESCE(sum(l."amount"), 0)::bigint AS "lineTotal", d."snapshotSealedAt" AS "sealedAt"
    FROM "BookingDeposit" d
    LEFT JOIN "BookingDepositLine" l ON l."depositId" = d."id" AND l."businessId" = ${businessId}
    WHERE d."id" = ${raceDepositId}
    GROUP BY d."snapshotSealedAt"
  `)
  assert.ok(finalSnapshot[0], 'the race deposit must still exist after the transactions settle')
  assert.equal(finalSnapshot[0]!.lineCount, 1n, 'only the legitimate line may survive the race')
  assert.equal(finalSnapshot[0]!.lineTotal, 100n, 'the sealed snapshot total must be 100')
  assert.ok(finalSnapshot[0]!.sealedAt instanceof Date, 'the snapshot seal timestamp must be non-null')

  console.log('OK F8 seal-vs-append race: serialized zero-amount append rejected after seal; exactly one line, total 100, sealed.')

  console.log('OK F8.3 PG: atomic HELD visit/appointment/deposit/line/EXPIRE_DEPOSIT job/operation, idempotent replay, mismatched rejection, same-slot race, rollback and missing payment config guard.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function seed() {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessId}, ${`F8-${suffix}`}, 'F8 booking contract')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${configurationId}, ${businessId}, 'deterministic-options', 'F8 contract', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "activatedAt", "updatedAt") VALUES (${deploymentId}, ${businessId}, 'deterministic-options', ${configurationId}, 1, 1, clock_timestamp(), clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${conversationId}, ${`54911${suffix.slice(0, 8)}`}, ${businessId}, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt") VALUES (${sessionId}, ${businessId}, ${conversationId}, ${deploymentId}, 1, 'UTC', '{}'::jsonb, 0, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${customerId}, ${businessId}, 'Cliente F8', ${`54911${suffix.slice(0, 8)}`}, ${`54911${suffix.slice(0, 8)}`})`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId", "timezone", "bookingHorizonDays", "bookingLeadTimeHours", "morningCutTime", "eveningCutTime", "depositHoldMinutes", "updatedAt") VALUES (${businessId}, 'UTC', 30, 0, '12:30', '16:30', 90, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ServiceCategory" ("id", "businessId", "name", "isActive", "updatedAt") VALUES (${categoryId}, ${businessId}, 'F8', true, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "catalogCategoryId", "name", "duration", "price", "priceMode", "isBookable", "attentionMode", "estimateAllowsBooking", "depositMode", "depositValue") VALUES (${serviceId}, ${businessId}, ${categoryId}, 'Corte F8', 30, 1500, 'FIXED'::"ServicePriceMode", true, 'DIRECT_BOOKING'::"ServiceAttentionMode", true, 'FIXED'::"ServiceDepositMode", 500)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "catalogCategoryId", "name", "duration", "price", "priceMode", "isBookable", "attentionMode", "estimateAllowsBooking", "depositMode") VALUES (${unselectedServiceId}, ${businessId}, ${categoryId}, 'Servicio no elegido F8', 30, 1000, 'FIXED'::"ServicePriceMode", true, 'DIRECT_BOOKING'::"ServiceAttentionMode", true, 'NONE'::"ServiceDepositMode")`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name", "isActive", "acceptsBotBookings", "botBookingPriority") VALUES (${professionalAId}, ${businessId}, 'Alba', true, true, 10), (${professionalBId}, ${businessId}, 'Bruno', true, true, 1)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalService" ("id", "professionalId", "serviceId") VALUES (${`f8linka_${suffix}`}, ${professionalAId}, ${serviceId}), (${`f8linkb_${suffix}`}, ${professionalBId}, ${serviceId})`)
  for (const professionalId of [professionalAId, professionalBId]) {
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime") VALUES (${`f8ph_${professionalId}`}, ${professionalId}, ${weekday}, '09:00', '18:00')`)
  }
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime") VALUES (${`f8bh_${suffix}`}, ${businessId}, ${weekday}, '09:00', '18:00')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessPaymentSettings" ("id", "businessId", "transferEnabled", "alias", "cbu", "cvu", "accountHolder", "paymentLinkEnabled", "paymentLink", "instructions", "createdAt", "updatedAt") VALUES (${paymentId}, ${businessId}, true, 'f8.alias', null, null, null, false, null, null, clock_timestamp(), clock_timestamp())`)
}

async function countHoldRows() {
  const rows = await prisma.$queryRaw<Array<{
    heldVisits: bigint; pendingAppointments: bigint; pendingDeposits: bigint
    depositLines: bigint; expireJobs: bigint; completedOps: bigint
  }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BookingVisit" WHERE "businessId" = ${businessId} AND "status" = 'HELD'::"BookingVisitStatus")::bigint AS "heldVisits",
      (SELECT count(*) FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE v."businessId" = ${businessId} AND a."status" = 'PENDING'::"AppointmentStatus")::bigint AS "pendingAppointments",
      (SELECT count(*) FROM "BookingDeposit" WHERE "businessId" = ${businessId})::bigint AS "pendingDeposits",
      (SELECT count(*) FROM "BookingDepositLine" WHERE "businessId" = ${businessId})::bigint AS "depositLines",
      (SELECT count(*) FROM "BotJob" WHERE "businessId" = ${businessId} AND "kind" = 'EXPIRE_DEPOSIT')::bigint AS "expireJobs",
      (SELECT count(*) FROM "BotOperation" WHERE "businessId" = ${businessId} AND "type" = 'HOLD_VISIT_WITH_DEPOSIT')::bigint AS "completedOps"
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
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "AppointmentServiceItem" WHERE "appointmentId" IN (SELECT a."id" FROM "Appointment" a JOIN "BookingVisit" v ON v."id" = a."visitId" WHERE v."businessId" = ${businessId})`)
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
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessPaymentSettings" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${businessId}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`)
  }, transactionOptions)
}

function tomorrowAtNoonUtc() {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + 1)
  value.setUTCHours(12, 0, 0, 0)
  return value
}

async function waitForDatabaseLock(pid: number) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ waitEventType: string | null }>>(Prisma.sql`
      SELECT "wait_event_type" AS "waitEventType" FROM pg_stat_activity WHERE "pid" = ${pid}
    `)
    if (rows[0]?.waitEventType === 'Lock') return
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('transaction B did not block on the BookingDeposit row lock')
}

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { resolveF9PgContractDatabase } from './f9-pg-contract-database.js'

const connectionString = resolveF9PgContractDatabase('F9 appointment-management query contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }
const [{ createPrismaClient }, { Prisma }, { listManageableAppointments }] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/appointment-management.js')
])
const prisma = createPrismaClient({ connectionString, max: 3, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const suffix = randomUUID().replaceAll('-', '')
const b1 = `f9_b1_${suffix}`, b2 = `f9_b2_${suffix}`
const phone = `54911${suffix.slice(0, 8)}`
const ids = (businessId: string) => ({
  customer: `f9_customer_${businessId}`, professional: `f9_professional_${businessId}`, service: `f9_service_${businessId}`,
  config: `f9_config_${businessId}`, deployment: `f9_deployment_${businessId}`, conversation: `f9_conversation_${businessId}`, session: `f9_session_${businessId}`
})

try {
  await seedBusiness(b1); await seedBusiness(b2)
  const now = new Date()
  const future = (minutes: number) => new Date(now.getTime() + minutes * 60_000)
  const expected: string[] = []
  for (let n = 0; n < 11; n++) expected.push(await insertLegacy(b1, `page_${String(n).padStart(2, '0')}`, future(100 + n)))
  const waiting = await insertAggregate(b1, 'waiting', future(200), 'HELD', 'PENDING_PROOF', future(30))
  const resubmission = await insertAggregate(b1, 'resubmission', future(201), 'HELD', 'PENDING_RESUBMISSION', future(30))
  const review = await insertAggregate(b1, 'review', future(202), 'PENDING_PAYMENT_REVIEW', 'PROOF_RECEIVED', null, future(-1))
  const approved = await insertAggregate(b1, 'approved', future(203), 'CONFIRMED', 'APPROVED', null)
  const b2OnlyAppointment = await insertLegacy(b2, 'other_tenant_same_phone', future(50))
  await insertLegacy(b1, 'past', future(-10))
  await insertLegacyAtDatabaseNow(b1, 'equal_now')
  await insertLegacy(b1, 'cancelled', future(210), 'CANCELLED')
  await insertAggregate(b1, 'expired_hold', future(211), 'HELD', 'PENDING_PROOF', future(-1))
  await insertAggregate(b1, 'rejected', future(212), 'HELD', 'REJECTED', future(30))
  const approvedLegacyDeposit = await insertIncoherentLegacyDeposit(b1, 'approved_legacy_deposit', future(213), 'APPROVED')
  const pendingLegacyDeposit = await insertIncoherentLegacyDeposit(b1, 'pending_legacy_deposit', future(214), 'PENDING_PROOF')

  const first = await listManageableAppointments(prisma, { businessId: b1, normalizedPhone: phone })
  assert.equal(first.items.length, 10, 'bounded first page')
  assert.deepEqual(first.items.map((row: { appointmentId: string }) => row.appointmentId), expected.slice(0, 10), 'stable startAt/id ordering')
  assert.ok(first.nextCursor, 'first page has a keyset cursor')
  const second = await listManageableAppointments(prisma, { businessId: b1, normalizedPhone: phone, cursor: first.nextCursor! })
  assert.deepEqual(second.items.map((row: { appointmentId: string }) => row.appointmentId), [expected[10]!, waiting, resubmission, review, approved])
  assert.deepEqual(second.items.map((row: { category: string }) => row.category), ['CONFIRMED', 'WAITING_PROOF', 'RESUBMISSION_PENDING', 'UNDER_REVIEW', 'CONFIRMED'])
  assert.equal(second.nextCursor, null)
  const runtimeFirst = await listManageableAppointments(prisma, { businessId: b1, normalizedPhone: phone, pageSize: 7 })
  assert.equal(runtimeFirst.items.length, 7, 'runtime page size reserves interactive navigation capacity')
  assert.deepEqual(runtimeFirst.items.map((row: { appointmentId: string }) => row.appointmentId), expected.slice(0, 7), 'smaller page keeps the same keyset ordering')
  assert.ok(runtimeFirst.nextCursor, 'smaller page still yields a durable keyset cursor')
  const runtimeSecond = await listManageableAppointments(prisma, { businessId: b1, normalizedPhone: phone, cursor: runtimeFirst.nextCursor!, pageSize: 7 })
  assert.deepEqual(runtimeSecond.items.map((row: { appointmentId: string }) => row.appointmentId), expected.slice(7).concat([waiting, resubmission, review, approved]).slice(0, 7), 'runtime next page follows its own cursor without gaps')
  await assert.rejects(() => listManageableAppointments(prisma, { businessId: b1, normalizedPhone: phone, pageSize: 0 }), /pageSize must be an integer/)
  await assert.rejects(() => listManageableAppointments(prisma, { businessId: b1, normalizedPhone: phone, pageSize: 11 }), /pageSize must be an integer/)
  assert.equal(first.timezone, 'UTC')
  assert.equal(first.cancellationLeadMinutes, 60)
  assert.equal(first.rescheduleLeadMinutes, 60)
  assert.ok(!first.items.some((row: { appointmentId: string }) => row.appointmentId === b2OnlyAppointment), 'b1 must not receive b2 same-phone appointments')
  assert.ok(![...first.items, ...second.items].some((row: { appointmentId: string }) => row.appointmentId === approvedLegacyDeposit || row.appointmentId === pendingLegacyDeposit), 'legacy deposits without a visit are never listed for automatic F9.1 management')
  const b2Page = await listManageableAppointments(prisma, { businessId: b2, normalizedPhone: phone })
  assert.deepEqual(b2Page.items.map((row: { appointmentId: string }) => row.appointmentId), [b2OnlyAppointment], 'b2 same-phone query sees only b2')
  await assert.rejects(() => listManageableAppointments(prisma, { businessId: ' ', normalizedPhone: phone }), /nonblank normalized/)
  await assertSettingsFailClosed()
  await assertHistoryIntegrity(waiting, `f9_deposit_waiting_${suffix}`, `f9_deposit_approved_${suffix}`)
  console.log('OK F9.1 PG: tenant scope, fail-closed settings, aggregate filtering, stable keyset, F8 proof retention and rollback-clean history integrity.')
} finally {
  await cleanup()
  await prisma.$disconnect()
}

async function seedBusiness(businessId: string) {
  const x = ids(businessId)
  await prisma.$transaction(async (tx: typeof prisma) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessId}, ${`F9-${businessId}`}, 'F9 query contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${x.config}, ${businessId}, 'deterministic-options', 'F9', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "updatedAt") VALUES (${x.deployment}, ${businessId}, 'deterministic-options', ${x.config}, 1, 1, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${x.conversation}, ${phone}, ${businessId}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt") VALUES (${x.session}, ${businessId}, ${x.conversation}, ${x.deployment}, 1, 'UTC', '{}'::jsonb, 0, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId", "timezone", "updatedAt") VALUES (${businessId}, 'UTC', clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${x.customer}, ${businessId}, 'F9 customer', ${phone}, ${phone})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${x.professional}, ${businessId}, 'F9 professional')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration") VALUES (${x.service}, ${businessId}, 'F9 service', 30)`)
  })
}

async function insertLegacy(businessId: string, tag: string, startAt: Date, status = 'CONFIRMED') {
  const id = `f9_appt_${tag}_${suffix}`, x = ids(businessId)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status") VALUES (${id}, ${x.customer}, ${x.professional}, ${x.service}, ${startAt}, 30, ${status}::"AppointmentStatus")`)
  return id
}

async function insertLegacyAtDatabaseNow(businessId: string, tag: string) {
  const id = `f9_appt_${tag}_${suffix}`, x = ids(businessId)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status") VALUES (${id}, ${x.customer}, ${x.professional}, ${x.service}, clock_timestamp(), 30, 'CONFIRMED'::"AppointmentStatus")`)
}

async function insertAggregate(businessId: string, tag: string, startAt: Date, visitStatus: string, depositStatus: string, holdExpiresAt: Date | null, depositExpiresAt = new Date(startAt.getTime() + 3_600_000)) {
  const x = ids(businessId), appointmentId = `f9_appt_${tag}_${suffix}`, visitId = `f9_visit_${tag}_${suffix}`, depositId = `f9_deposit_${tag}_${suffix}`
  await prisma.$transaction(async (tx: typeof prisma) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${visitId}, ${businessId}, ${x.customer}, ${x.professional}, ${x.session}, ${visitStatus}::"BookingVisitStatus", ${startAt}, 30, ${holdExpiresAt}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${appointmentId}, ${x.customer}, ${x.professional}, ${x.service}, ${startAt}, 30, ${visitStatus === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING'}::"AppointmentStatus", ${visitId})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointmentId}, ${x.service}, 0, 30, 1)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "visitId", "mode", "configuredValue", "amount", "status", "expiresAt", "updatedAt") VALUES (${depositId}, ${businessId}, ${appointmentId}, ${visitId}, 'FIXED'::"ServiceDepositMode", 1, 1, ${depositStatus}::"BookingDepositStatus", ${depositExpiresAt}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "amount") VALUES (${`f9_line_${tag}_${suffix}`}, ${businessId}, ${depositId}, ${x.service}, 0, 'F9 service', 'FIXED'::"ServiceDepositMode", 1, 1)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp(), "updatedAt" = clock_timestamp() WHERE "id" = ${depositId}`)
    if (depositStatus === 'PROOF_RECEIVED' || depositStatus === 'APPROVED') {
      const proofBytes = Buffer.from(`f9-proof-${tag}-${suffix}`)
      const proofHash = createHash('sha256').update(proofBytes).digest('hex')
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositProof" ("id", "businessId", "depositId", "sequence", "kind", "validatorVersion", "validatedAt", "receivedAt", "sourceData", "sourceMimeType", "sourceFilename", "sourceByteSize", "sourceSha256", "derivedData", "derivedMimeType", "derivedByteSize", "derivedSha256", "retentionEligibleAt") VALUES (${`f9_proof_${tag}_${suffix}`}, ${businessId}, ${depositId}, 1, 'INITIAL'::"BookingDepositProofKind", 'f9-test', clock_timestamp(), clock_timestamp(), ${proofBytes}, 'image/png', 'proof.png', ${proofBytes.length}, ${proofHash}, ${proofBytes}, 'image/png', ${proofBytes.length}, ${proofHash}, clock_timestamp() + interval '365 days')`)
    }
  })
  return appointmentId
}

async function insertIncoherentLegacyDeposit(businessId: string, tag: string, startAt: Date, depositStatus: 'APPROVED' | 'PENDING_PROOF') {
  const appointmentId = await insertLegacy(businessId, tag, startAt)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "mode", "configuredValue", "amount", "status", "expiresAt", "updatedAt") VALUES (${`f9_legacy_deposit_${depositStatus}_${suffix}`}, ${businessId}, ${appointmentId}, 'FIXED'::"ServiceDepositMode", 1, 1, ${depositStatus}::"BookingDepositStatus", ${new Date(startAt.getTime() + 3_600_000)}, clock_timestamp())`)
  return appointmentId
}

async function cleanup() {
  for (const businessId of [b1, b2]) {
    await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "customerId" = ${ids(businessId).customer}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${businessId}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`)
    })
  }
}

async function assertSettingsFailClosed() {
  for (const [businessId, change] of [
    [b1, Prisma.sql`DELETE FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${b1}`],
    [b2, Prisma.sql`UPDATE "BusinessBotOptionsSettings" SET "timezone" = ' ' WHERE "businessId" = ${b2}`]
  ] as const) {
    const marker = `F9_SETTINGS_ROLLBACK_${businessId}`
    await assert.rejects(prisma.$transaction(async (tx: typeof prisma) => {
      await tx.$executeRaw(change)
      await assert.rejects(() => listManageableAppointments(tx, { businessId, normalizedPhone: phone }), /settings\/timezone are unavailable/)
      throw new Error(marker)
    }), new RegExp(marker))
  }
  await assert.rejects(prisma.$transaction(async (tx: typeof prisma) => {
    await tx.$executeRaw(Prisma.sql`UPDATE "BusinessBotOptionsSettings" SET "cancellationLeadMinutes" = -1 WHERE "businessId" = ${b1}`)
  }), /cancellationLeadMinutes_nonnegative/i)
  await assert.rejects(prisma.$transaction(async (tx: typeof prisma) => {
    await tx.$executeRaw(Prisma.sql`UPDATE "BusinessBotOptionsSettings" SET "rescheduleLeadMinutes" = -1 WHERE "businessId" = ${b1}`)
  }), /rescheduleLeadMinutes_nonnegative/i)
}

async function assertHistoryIntegrity(appointmentId: string, bookingDepositId: string, otherBookingDepositId: string) {
  const validKey = `f9-history-valid-${suffix}`
  await assertRollback(validKey, async (tx) => insertHistory(tx, { appointmentId, bookingDepositId, operationKey: validKey }))
  const persisted = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "AppointmentChangeHistory" WHERE "operationKey" = ${validKey}`)
  assert.equal(persisted[0]!.count, 0n, 'valid history assertion must roll back')

  await assertHistoryRejects('duplicate operationKey', async (tx) => {
    await insertHistory(tx, { appointmentId, bookingDepositId, operationKey: `f9-history-duplicate-${suffix}` })
    await insertHistory(tx, { appointmentId, bookingDepositId, operationKey: `f9-history-duplicate-${suffix}` })
  }, /unique/i)
  await assertHistoryRejects('no-op from/to', (tx) => insertHistory(tx, { appointmentId, bookingDepositId, operationKey: `f9-history-noop-${suffix}`, fromStartAt: new Date(0), toStartAt: new Date(0) }), /start_changed/i)
  await assertHistoryRejects('empty actor', (tx) => insertHistory(tx, { appointmentId, bookingDepositId, operationKey: `f9-history-empty-actor-${suffix}`, actor: '  ' }), /actor_nonblank/i)
  await assertHistoryRejects('empty operationKey', (tx) => insertHistory(tx, { appointmentId, bookingDepositId, operationKey: ' ', actor: 'f9-test' }), /operationKey_nonblank/i)
  await assertHistoryRejects('preserved deposit missing', (tx) => insertHistory(tx, { appointmentId, bookingDepositId: null, operationKey: `f9-history-missing-deposit-${suffix}`, depositPreserved: true }), /preserved_deposit_required/i)
  await assertHistoryRejects('cross-appointment deposit', (tx) => insertHistory(tx, { appointmentId, bookingDepositId: otherBookingDepositId, operationKey: `f9-history-cross-deposit-${suffix}` }), /appointmentId_bookingDepositId_fkey/i)
  await assertHistoryRejects('update append-only', async (tx) => {
    const id = `f9_history_update_${suffix}`
    await insertHistory(tx, { id, appointmentId, bookingDepositId, operationKey: `f9-history-update-${suffix}` })
    await tx.$executeRaw(Prisma.sql`UPDATE "AppointmentChangeHistory" SET "actor" = 'other' WHERE "id" = ${id}`)
  }, /append-only/i)
  await assertHistoryRejects('delete append-only', async (tx) => {
    const id = `f9_history_delete_${suffix}`
    await insertHistory(tx, { id, appointmentId, bookingDepositId, operationKey: `f9-history-delete-${suffix}` })
    await tx.$executeRaw(Prisma.sql`DELETE FROM "AppointmentChangeHistory" WHERE "id" = ${id}`)
  }, /append-only/i)
}

type HistoryInput = { id?: string; appointmentId: string; bookingDepositId: string | null; operationKey: string; actor?: string; fromStartAt?: Date; toStartAt?: Date; depositPreserved?: boolean }
type TransactionClient = { $executeRaw(query: Prisma.Sql): Promise<unknown> }

async function insertHistory(tx: TransactionClient, input: HistoryInput) {
  const fromStartAt = input.fromStartAt ?? new Date('2030-01-01T10:00:00.000Z')
  const toStartAt = input.toStartAt ?? new Date('2030-01-01T10:30:00.000Z')
  await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentChangeHistory" ("id", "appointmentId", "operationKey", "actor", "fromStartAt", "toStartAt", "bookingDepositId", "depositPreserved") VALUES (${input.id ?? `f9_history_${randomUUID()}`}, ${input.appointmentId}, ${input.operationKey}, ${input.actor ?? 'f9-test'}, ${fromStartAt}, ${toStartAt}, ${input.bookingDepositId}, ${input.depositPreserved ?? false})`)
}

async function assertRollback(operationKey: string, operation: (tx: TransactionClient) => Promise<void>) {
  const marker = `F9_HISTORY_ROLLBACK_${operationKey}`
  await assert.rejects(prisma.$transaction(async (tx: typeof prisma) => {
    await operation(tx)
    throw new Error(marker)
  }), new RegExp(marker))
}

async function assertHistoryRejects(label: string, operation: (tx: TransactionClient) => Promise<void>, expected: RegExp) {
  await assert.rejects(prisma.$transaction(async (tx: typeof prisma) => operation(tx)), expected, label)
}

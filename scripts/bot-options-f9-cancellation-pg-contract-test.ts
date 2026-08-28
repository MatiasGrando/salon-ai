import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { resolveF9PgContractDatabase } from './f9-pg-contract-database.js'

// This contract intentionally requires a pre-migrated explicit F9 scratch DB.
// It never creates, migrates, or drops a database itself.
const connectionString = resolveF9PgContractDatabase('F9.3 cancellation contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }
const [{ createPrismaClient }, { Prisma }, management, proofWriter, proofValidator, worker, expiry] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/appointment-management.js'),
  import('../src/services/deposit-proof-writer.js'),
  import('../src/services/deposit-proof-image-validation.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/application/expire-deposit-hold.js')
])
const { cancelManageableAppointment, cancelManageableAppointmentInTransaction } = management
const prisma = createPrismaClient({ connectionString, max: 8, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f9_cancel_b_${suffix}`, otherBusinessId = `f9_cancel_other_${suffix}`, phone = `54911${suffix.replace(/\D/g, '').slice(0, 8)}`
const x = { customer: `f9_cancel_c_${suffix}`, professional: `f9_cancel_p_${suffix}`, service: `f9_cancel_s_${suffix}`, config: `f9_cancel_cfg_${suffix}`, deployment: `f9_cancel_dep_${suffix}`, conversation: `f9_cancel_conv_${suffix}`, session: `f9_cancel_session_${suffix}`, priorSession: `f9_cancel_prior_session_${suffix}` }
const input = (appointmentId: string, operationKey = `f9-cancel-${appointmentId}`) => ({ businessId, normalizedPhone: phone, sessionId: x.session, appointmentId, operationKey, confirmed: true as const })

try {
  await seed(businessId, x, phone); await seed(otherBusinessId, { ...x, customer: `${x.customer}_other`, professional: `${x.professional}_other`, service: `${x.service}_other`, config: `${x.config}_other`, deployment: `${x.deployment}_other`, conversation: `${x.conversation}_other`, session: `${x.session}_other`, priorSession: `${x.priorSession}_other` }, phone)
  await prisma.$executeRaw(Prisma.sql`UPDATE "Conversation" SET "phone" = ${`+54 9 11 ${phone.slice(5)}`} WHERE "id" = ${x.conversation}`)
  const legacy = await appointment('legacy')
  assert.deepEqual(await cancelManageableAppointment(prisma, input(legacy)), { outcome: 'CANCELLED', replayed: false })
  assert.equal(await status(legacy), 'CANCELLED', 'legacy confirmed cancellation is fenced')
  assert.deepEqual(await cancelManageableAppointment(prisma, input(legacy)), { outcome: 'CANCELLED', replayed: true }, 'completed operation replays')

  const f7 = await aggregate('f7', 'CONFIRMED', null, null)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "sessionId" = ${x.priorSession} WHERE "id" = (SELECT "visitId" FROM "Appointment" WHERE "id" = ${f7})`)
  await assert.rejects(() => cancelManageableAppointment(prisma, input(f7, `f9-cancel-${legacy}`)), /cannot be replayed safely/, 'an operation key cannot name a different appointment')
  assert.equal((await cancelManageableAppointment(prisma, input(f7))).outcome, 'CANCELLED')
  assert.deepEqual(await aggregateStatus(f7), { appointment: 'CANCELLED', visit: 'CANCELLED', deposit: null }, 'formatted current conversation may cancel a visit from a prior session atomically')

  const pending = await aggregate('pending', 'HELD', 'PENDING_PROOF', 'READY')
  assert.equal((await cancelManageableAppointment(prisma, input(pending))).outcome, 'CANCELLED')
  assert.deepEqual(await aggregateStatus(pending), { appointment: 'CANCELLED', visit: 'CANCELLED', deposit: 'REJECTED' })
  assert.equal(await expiryJobStatus(pending), 'DONE', 'READY expiry is neutralized')
  assert.equal(await rejectionReason(pending), 'CANCELLED_BY_CUSTOMER')

  await assertCancellationSettingsFailClosed()
  await assertCancellationRollback()
  await assertSealedCancellationTransitionIsNarrow()

  const resubmission = await aggregate('resubmission', 'HELD', 'PENDING_RESUBMISSION', 'RETRY')
  assert.equal((await cancelManageableAppointment(prisma, input(resubmission))).outcome, 'CANCELLED')
  assert.equal(await expiryJobStatus(resubmission), 'DONE', 'RETRY expiry is neutralized')
  const leased = await aggregate('leased', 'HELD', 'PENDING_PROOF', 'LEASED')
  assert.equal((await cancelManageableAppointment(prisma, input(leased))).outcome, 'CANCELLED')
  assert.equal(await expiryJobStatus(leased), 'LEASED', 'a claimed expiry is never stolen')

  const inside = await appointment('inside', 30)
  assert.deepEqual(await cancelManageableAppointment(prisma, input(inside)), { outcome: 'HANDOFF', replayed: false })
  const review = await aggregate('review', 'PENDING_PAYMENT_REVIEW', 'PROOF_RECEIVED', null)
  const approved = await aggregate('approved', 'CONFIRMED', 'APPROVED', null)
  const incoherent = await aggregate('incoherent', 'HELD', 'PENDING_PROOF', null, { depositVisitId: null })
  const legacyDeposit = await legacyDepositAppointment()
  for (const [label, id] of [['review', review], ['approved', approved], ['incoherent', incoherent], ['legacyDeposit', legacyDeposit]] as const) {
    const before = await cancellationSnapshot(id)
    assert.equal((await cancelManageableAppointment(prisma, input(id))).outcome, 'HANDOFF', `${label}: documented cancellation policy must hand off`)
    assert.deepEqual(await cancellationSnapshot(id), before, `${label}: handoff must not mutate the aggregate, operation, or expiry job`)
  }
  assert.equal((await cancelManageableAppointment(prisma, { ...input(inside), normalizedPhone: `${phone}9` })).outcome, 'INELIGIBLE', 'phone scope is enforced')
  assert.equal((await cancelManageableAppointment(prisma, { ...input(inside), sessionId: `${x.session}_other` })).outcome, 'INELIGIBLE', 'session scope is enforced')
  assert.equal((await cancelManageableAppointment(prisma, { ...input(inside), businessId: otherBusinessId })).outcome, 'INELIGIBLE', 'tenant scope is enforced')
  const crossTenantService = await appointment('cross-tenant-service', 180, `${x.service}_other`)
  assert.equal((await cancelManageableAppointment(prisma, input(crossTenantService))).outcome, 'INELIGIBLE', 'mixed-tenant service membership fails closed')
  assert.equal(await status(crossTenantService), 'CONFIRMED', 'mixed-tenant service membership cannot be mutated')
  await assertCancellationVsProofRace()
  await assertCancellationVsExpiryRace()
  console.log('OK F9.3 PG: scoped cancellation, settings fail-closed, replay/hash fencing, rollback, sealed transition immutability, expiry neutralization and proof/expiry races.')
} finally {
  await cleanup(); await prisma.$disconnect()
}

async function seed(id: string, ids: typeof x, customerPhone: string) {
  await prisma.$transaction(async (tx: typeof prisma) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${id}, ${`F9C-${id}`}, 'F9 cancellation')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${ids.config}, ${id}, 'deterministic-options', 'F9C', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "updatedAt") VALUES (${ids.deployment}, ${id}, 'deterministic-options', ${ids.config}, 1, 1, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${ids.conversation}, ${customerPhone}, ${id}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt") VALUES (${ids.session}, ${id}, ${ids.conversation}, ${ids.deployment}, 1, 'UTC', '{}'::jsonb, 0, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "status", "updatedAt") VALUES (${ids.priorSession}, ${id}, ${ids.conversation}, ${ids.deployment}, 1, 'UTC', '{}'::jsonb, 0, 'CLOSED'::"BotSessionStatus", clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotOptionsSettings" ("businessId", "timezone", "updatedAt") VALUES (${id}, 'UTC', clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${ids.customer}, ${id}, 'F9 customer', ${customerPhone}, ${customerPhone})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${ids.professional}, ${id}, 'F9 professional')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration") VALUES (${ids.service}, ${id}, 'F9 service', 30)`)
  })
}

async function appointment(tag: string, minutes = 180, serviceId = x.service) {
  const id = `f9_cancel_a_${tag}_${suffix}`
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status") VALUES (${id}, ${x.customer}, ${x.professional}, ${serviceId}, clock_timestamp() + (${minutes} * interval '1 minute'), 30, 'CONFIRMED'::"AppointmentStatus")`)
  return id
}

async function aggregate(tag: string, visitStatus: string, depositStatus: string | null, jobStatus: string | null, options: { depositVisitId?: string | null; overdue?: boolean } = {}) {
  const appointmentId = `f9_cancel_a_${tag}_${suffix}`, visitId = `f9_cancel_v_${tag}_${suffix}`, depositId = `f9_cancel_d_${tag}_${suffix}`
  await prisma.$transaction(async (tx: typeof prisma) => {
    const holdDue = options.overdue ? Prisma.sql`clock_timestamp() - interval '1 second'` : Prisma.sql`clock_timestamp() + interval '2 hours'`
    const initialVisitStatus = depositStatus === 'APPROVED' ? 'PENDING_PAYMENT_REVIEW' : visitStatus
    const initialAppointmentStatus = initialVisitStatus === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING'
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${visitId}, ${businessId}, ${x.customer}, ${x.professional}, ${x.session}, ${initialVisitStatus}::"BookingVisitStatus", clock_timestamp() + interval '3 hours', 30, ${holdDue}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${appointmentId}, ${x.customer}, ${x.professional}, ${x.service}, clock_timestamp() + interval '3 hours', 30, ${initialAppointmentStatus}::"AppointmentStatus", ${visitId})`)
    if (depositStatus) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointmentId}, ${x.service}, 0, 30, 1)`)
      const depositDue = options.overdue ? Prisma.sql`clock_timestamp() - interval '1 second'` : Prisma.sql`clock_timestamp() + interval '2 hours'`
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "visitId", "mode", "configuredValue", "amount", "status", "expiresAt", "updatedAt") VALUES (${depositId}, ${businessId}, ${appointmentId}, ${options.depositVisitId === null ? null : visitId}, 'FIXED'::"ServiceDepositMode", 1, 1, 'PENDING_PROOF'::"BookingDepositStatus", ${depositDue}, clock_timestamp())`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "amount") VALUES (${`f9_cancel_l_${tag}_${suffix}`}, ${businessId}, ${depositId}, ${x.service}, 0, 'F9', 'FIXED'::"ServiceDepositMode", 1, 1)`)
      await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp(), "updatedAt" = clock_timestamp() WHERE "id" = ${depositId}`)
      if (depositStatus === 'PROOF_RECEIVED' || depositStatus === 'APPROVED') {
        const proofBytes = Buffer.from(`f9-cancellation-proof-${tag}-${suffix}`)
        const proofHash = createHash('sha256').update(proofBytes).digest('hex')
        await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositProof" ("id", "businessId", "depositId", "sequence", "kind", "validatorVersion", "validatedAt", "receivedAt", "sourceData", "sourceMimeType", "sourceFilename", "sourceByteSize", "sourceSha256", "derivedData", "derivedMimeType", "derivedByteSize", "derivedSha256", "retentionEligibleAt") VALUES (${`f9_cancel_proof_${tag}_${suffix}`}, ${businessId}, ${depositId}, 1, 'INITIAL'::"BookingDepositProofKind", 'f9-cancellation-contract', clock_timestamp(), clock_timestamp(), ${proofBytes}, 'image/png', 'proof.png', ${proofBytes.length}, ${proofHash}, ${proofBytes}, 'image/png', ${proofBytes.length}, ${proofHash}, clock_timestamp() + interval '365 days')`)
        await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "status" = 'PROOF_RECEIVED'::"BookingDepositStatus", "updatedAt" = clock_timestamp() WHERE "id" = ${depositId}`)
      }
      if (depositStatus === 'APPROVED') {
        await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "status" = 'APPROVED'::"BookingDepositStatus", "reviewedAt" = clock_timestamp(), "reviewedByUserId" = 'f9-cancellation-reviewer', "updatedAt" = clock_timestamp() WHERE "id" = ${depositId}`)
        await tx.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = 'CONFIRMED'::"BookingVisitStatus", "updatedAt" = clock_timestamp() WHERE "id" = ${visitId}`)
        await tx.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "status" = 'CONFIRMED'::"AppointmentStatus" WHERE "id" = ${appointmentId}`)
      }
      if (jobStatus) await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "status", "updatedAt") VALUES (${`f9_cancel_j_${tag}_${suffix}`}, 'EXPIRE_DEPOSIT', ${depositId}, ${businessId}, ${x.deployment}, 1, ${jobStatus}::"BotJobStatus", clock_timestamp())`)
    }
  })
  return appointmentId
}

async function aggregateDetails(appointmentId: string) {
  const row = (await prisma.$queryRaw<Array<{ appointmentId: string; visitId: string; depositId: string; jobId: string | null }>>(Prisma.sql`
    SELECT a."id" AS "appointmentId", a."visitId", d."id" AS "depositId", j."id" AS "jobId"
    FROM "Appointment" a JOIN "BookingDeposit" d ON d."appointmentId" = a."id"
    LEFT JOIN "BotJob" j ON j."aggregateId" = d."id" AND j."kind" = 'EXPIRE_DEPOSIT'
    WHERE a."id" = ${appointmentId}
  `))[0]
  assert.ok(row, 'aggregate fixture must be complete')
  return row
}

async function assertCancellationSettingsFailClosed() {
  for (const [tag, change, expected] of [
    ['missing-settings', Prisma.sql`DELETE FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${businessId}`, /settings\/timezone are unavailable/],
    ['blank-timezone', Prisma.sql`UPDATE "BusinessBotOptionsSettings" SET "timezone" = ' ' WHERE "businessId" = ${businessId}`, /settings\/timezone are unavailable/]
  ] as const) {
    const appointmentId = await aggregate(`settings-${tag}`, 'HELD', 'PENDING_PROOF', 'READY')
    const before = await cancellationSnapshot(appointmentId)
    const marker = `F9_SETTINGS_ROLLBACK_${tag}`
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.$executeRaw(change)
      await assert.rejects(() => cancelManageableAppointmentInTransaction(tx, input(appointmentId)), expected)
      throw new Error(marker)
    }), new RegExp(marker))
    assert.deepEqual(await cancellationSnapshot(appointmentId), before, `${tag} must reject before any aggregate, operation, or job mutation`)
  }
}

async function assertCancellationRollback() {
  const appointmentId = await aggregate('forced-rollback', 'HELD', 'PENDING_PROOF', 'READY')
  const before = await cancellationSnapshot(appointmentId)
  await assert.rejects(prisma.$transaction(async (tx) => {
    assert.deepEqual(await cancelManageableAppointmentInTransaction(tx, input(appointmentId)), { outcome: 'CANCELLED', replayed: false })
    throw new Error('F9_CANCEL_FORCED_ROLLBACK')
  }), /F9_CANCEL_FORCED_ROLLBACK/)
  assert.deepEqual(await cancellationSnapshot(appointmentId), before,
    'deliberate post-transition rollback must retain the original appointment, visit, deposit, operation and expiry job')
}

async function assertSealedCancellationTransitionIsNarrow() {
  const appointmentId = await aggregate('sealed-narrow', 'HELD', 'PENDING_PROOF', 'READY')
  const details = await aggregateDetails(appointmentId)
  const forbiddenMutations = [
    [Prisma.sql`UPDATE "BookingDeposit" SET "configuredValue" = "configuredValue" + 1 WHERE "id" = ${details.depositId}`, /sealed F8 BookingDeposit terms are immutable/],
    [Prisma.sql`UPDATE "BookingDeposit" SET "holdTtlMinutes" = "holdTtlMinutes" + 1 WHERE "id" = ${details.depositId}`, /sealed F8 BookingDeposit terms are immutable/],
    [Prisma.sql`UPDATE "BookingDeposit" SET "expiresAt" = "expiresAt" + interval '1 minute' WHERE "id" = ${details.depositId}`, /sealed F8 BookingDeposit terms are immutable/],
    // The aggregate-membership trigger may reject this before the terms
    // trigger; both are required F8 fences and the transaction must roll back.
    [Prisma.sql`UPDATE "BookingDeposit" SET "visitId" = NULL WHERE "id" = ${details.depositId}`, /sealed F8 BookingDeposit terms are immutable|F8 deposit aggregate/i],
    [Prisma.sql`UPDATE "BookingDeposit" SET "reviewedByUserId" = 'f9-intruder' WHERE "id" = ${details.depositId}`, /sealed F8 BookingDeposit terms are immutable/]
  ]
  for (const [index, [mutation, expected]] of forbiddenMutations.entries()) {
    const before = await cancellationSnapshot(appointmentId)
    await assert.rejects(prisma.$transaction(async (tx) => {
      assert.equal((await cancelManageableAppointmentInTransaction(tx, input(appointmentId, `f9-narrow-${index}-${suffix}`))).outcome, 'CANCELLED')
      await tx.$executeRaw(mutation)
    }), expected)
    assert.deepEqual(await cancellationSnapshot(appointmentId), before, 'a forbidden sealed-field mutation must roll back the cancellation too')
  }
}

async function assertCancellationVsProofRace() {
  const appointmentId = await aggregate('proof-race', 'HELD', 'PENDING_PROOF', 'READY')
  const details = await aggregateDetails(appointmentId)
  const evidence = await validatedEvidence('#135')
  const [cancelResult, proofResult] = await concurrentlyBehindAgendaLock([
    () => cancelManageableAppointment(prisma, input(appointmentId, `f9-proof-race-cancel-${suffix}`)),
    async () => {
      try {
        return { applied: true as const, result: await proofWriter.writeValidatedDepositProof(prisma, proofInput(details.depositId, `f9-proof-race-proof-${suffix}`, evidence)) }
      } catch (error) {
        assert.match(String(error), /deposit aggregate cannot accept proof evidence in its current state/)
        return { applied: false as const, result: null }
      }
    }
  ])
  const state = await cancellationSnapshot(appointmentId)
  if (cancelResult.outcome === 'CANCELLED') {
    assert.deepEqual(proofResult, { applied: false, result: null }, 'a cancellation winner fences the actual F8 proof writer')
    assert.deepEqual(state, { appointment: 'CANCELLED', visit: 'CANCELLED', deposit: 'REJECTED', proofs: 0n, operations: 1n, job: 'DONE', expiryAudits: 0n })
  } else {
    assert.equal(cancelResult.outcome, 'HANDOFF', 'only a real proof/review winner may block cancellation')
    assert.ok(proofResult.applied && proofResult.result?.outcome === 'APPLIED', 'proof winner must retain actual validated evidence')
    assert.deepEqual(state, { appointment: 'PENDING', visit: 'PENDING_PAYMENT_REVIEW', deposit: 'PROOF_RECEIVED', proofs: 1n, operations: 1n, job: 'DONE', expiryAudits: 0n })
  }
}

async function assertCancellationVsExpiryRace() {
  const appointmentId = await aggregate('expiry-race', 'HELD', 'PENDING_PROOF', 'READY', { overdue: true })
  const details = await aggregateDetails(appointmentId)
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "availableAt" = clock_timestamp() + interval '1 hour'
    WHERE "businessId" = ${businessId} AND "id" <> ${details.jobId}
      AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")
  `)
  const claimed = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId })
  assert.ok(claimed && claimed.id === details.jobId && claimed.kind === 'EXPIRE_DEPOSIT', 'race must use a real claimed EXPIRE_DEPOSIT job')
  const [cancelResult, expiryResult] = await concurrentlyBehindAgendaLock([
    () => cancelManageableAppointment(prisma, input(appointmentId, `f9-expiry-race-cancel-${suffix}`)),
    () => expiry.expireDepositHold(prisma, claimed!)
  ])
  const state = await cancellationSnapshot(appointmentId)
  if (cancelResult.outcome === 'CANCELLED') {
    assert.equal(expiryResult, 'INELIGIBLE', 'cancelled aggregate fences the already claimed expiry worker')
    assert.deepEqual(state, { appointment: 'CANCELLED', visit: 'CANCELLED', deposit: 'REJECTED', proofs: 0n, operations: 1n, job: 'DONE', expiryAudits: 0n })
  } else {
    assert.equal(cancelResult.outcome, 'INELIGIBLE', 'an overdue aggregate is fail-closed if expiry wins')
    assert.equal(expiryResult, 'EXPIRED')
    assert.deepEqual(state, { appointment: 'CANCELLED', visit: 'EXPIRED', deposit: 'EXPIRED', proofs: 0n, operations: 0n, job: 'DONE', expiryAudits: 1n })
  }
}

async function validatedEvidence(color: string) {
  const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toBuffer()
  return proofValidator.validateDepositProofImage({ data, declaredMimeType: 'image/png', filename: 'proof.png' })
}

function proofInput(depositId: string, operationKey: string, evidence: Awaited<ReturnType<typeof validatedEvidence>>) {
  return { businessId, depositId, operationKey, providerEventId: `${operationKey}-event`, providerMessageId: `${operationKey}-message`, providerMediaId: `${operationKey}-media`, evidence }
}

async function cancellationSnapshot(appointmentId: string) {
  return (await prisma.$queryRaw<Array<{ appointment: string; visit: string | null; deposit: string | null; proofs: bigint; operations: bigint; job: string | null; expiryAudits: bigint }>>(Prisma.sql`
    SELECT a."status"::text AS appointment, v."status"::text AS visit, d."status"::text AS deposit,
      (SELECT count(*) FROM "BookingDepositProof" p WHERE p."depositId" = d."id")::bigint AS proofs,
      (SELECT count(*) FROM "BotOperation" o WHERE o."businessId" = ${businessId} AND (
        o."resultRef" = a."id" OR o."resultRef" IN (SELECT p."id" FROM "BookingDepositProof" p WHERE p."depositId" = d."id")
      ))::bigint AS operations,
      (SELECT j."status"::text FROM "BotJob" j WHERE j."aggregateId" = d."id" AND j."kind" = 'EXPIRE_DEPOSIT' LIMIT 1) AS job,
      (SELECT count(*) FROM "BookingDepositExpiryAudit" e WHERE e."depositId" = d."id")::bigint AS "expiryAudits"
    FROM "Appointment" a LEFT JOIN "BookingVisit" v ON v."id" = a."visitId" LEFT JOIN "BookingDeposit" d ON d."appointmentId" = a."id"
    WHERE a."id" = ${appointmentId}
  `))[0]!
}

async function concurrentlyBehindAgendaLock<T extends readonly (() => Promise<unknown>)[]>(contenders: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  let release!: () => void
  let locked!: (pid: number) => void
  const released = new Promise<void>((resolve) => { release = resolve })
  const lockHeld = new Promise<number>((resolve) => { locked = resolve })
  const gate = prisma.$transaction(async (tx) => {
    const gateRow = (await tx.$queryRaw<Array<{ pid: number }>>(Prisma.sql`
      SELECT pg_backend_pid() AS pid
      FROM pg_advisory_xact_lock(hashtextextended(${`salon-ai:agenda:v1:business:${businessId}`}, 0))
    `))[0]!
    locked(gateRow.pid)
    await released
  })
  const blockerPid = await lockHeld
  const pending = contenders.map((contender) => contender())
  try {
    // Submission alone is not race evidence. Observe every real writer blocked
    // behind this exact backend before releasing the hierarchy lock.
    await waitForBlockedContenders(blockerPid, contenders.length)
  } catch (error) {
    release()
    await gate
    await Promise.allSettled(pending)
    throw error
  }
  release(); await gate
  return Promise.all(pending) as Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>
}

async function waitForBlockedContenders(blockerPid: number, expected: number) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const row = (await prisma.$queryRaw<Array<{ waiting: number }>>(Prisma.sql`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity activity
      WHERE ${blockerPid} = ANY(pg_blocking_pids(activity.pid))
    `))[0]
    if ((row?.waiting ?? 0) >= expected) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`expected ${expected} writers to contend on the held agenda lock`)
}

async function legacyDepositAppointment() { const id = await appointment('legacy-deposit'); await prisma.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "mode", "configuredValue", "amount", "status", "expiresAt", "updatedAt") VALUES (${`f9_cancel_legacy_d_${suffix}`}, ${businessId}, ${id}, 'FIXED'::"ServiceDepositMode", 1, 1, 'PENDING_PROOF'::"BookingDepositStatus", clock_timestamp() + interval '2 hours', clock_timestamp())`); return id }
async function status(id: string) { return (await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "Appointment" WHERE "id" = ${id}`))[0]!.status }
async function aggregateStatus(id: string) { const row = (await prisma.$queryRaw<Array<{ appointment: string; visit: string | null; deposit: string | null }>>(Prisma.sql`SELECT a."status"::text AS appointment, v."status"::text AS visit, d."status"::text AS deposit FROM "Appointment" a LEFT JOIN "BookingVisit" v ON v."id" = a."visitId" LEFT JOIN "BookingDeposit" d ON d."appointmentId" = a."id" WHERE a."id" = ${id}`))[0]!; return row }
async function expiryJobStatus(id: string) { return (await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT j."status"::text AS status FROM "BotJob" j JOIN "BookingDeposit" d ON d."id" = j."aggregateId" WHERE d."appointmentId" = ${id}`))[0]!.status }
async function rejectionReason(id: string) { return (await prisma.$queryRaw<Array<{ rejectionReason: string }>>(Prisma.sql`SELECT d."rejectionReason" FROM "BookingDeposit" d WHERE d."appointmentId" = ${id}`))[0]!.rejectionReason }
async function cleanup() {
  for (const id of [businessId, otherBusinessId]) {
    await prisma.$transaction(async (tx: typeof prisma) => {
      // Proof and expiry evidence are immutable only while the parent deposit
      // exists. Delete the complete disposable fixture graph in one deferred
      // transaction so F8's retention trigger remains meaningful.
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositExpiryAudit" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "customerId" IN (SELECT "id" FROM "Customer" WHERE "businessId" = ${id})`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotOptionsSettings" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${id}`)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${id}`)
    })
  }
}

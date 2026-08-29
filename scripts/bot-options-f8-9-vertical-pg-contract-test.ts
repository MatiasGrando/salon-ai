import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { resolveF8PgContractDatabase } from './f8-pg-contract-database.js'

const SAFE_DATABASE_URL = resolveF8PgContractDatabase('F8.9 vertical contract')
const transactionOptions = { maxWait: 10_000, timeout: 60_000 }

const [{ createPrismaClient }, { Prisma }, admission, admissionRepo, worker, processor, notifications, review, bridgeWorker, sender] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/admit-provider-events.js'),
  import('../src/bot-options/infrastructure/prisma-admission.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/application/process-deposit-proof-job.js'),
  import('../src/services/deposit-notification-outbox.js'),
  import('../src/services/deposit-review-operation.js'),
  import('../src/bot-options/application/bridge-deposit-notification-job.js'),
  import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 8, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const cutoverPrisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 2, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 3_000, transactionOptions })
const suffix = randomUUID().replaceAll('-', '')
const secret = `secret-${suffix}`
const phoneNumberId = `pn-${suffix}`
const fromPhone = `54911${suffix.slice(0, 8)}`
const ids = {
  business: `f89_b_${suffix}`, config: `f89_cfg_${suffix}`, deployment: `f89_dep_${suffix}`,
  whatsapp: `f89_wa_${suffix}`, conversation: `f89_conv_${suffix}`, session: `f89_session_${suffix}`,
  customer: `f89_customer_${suffix}`, professional: `f89_prof_${suffix}`, service: `f89_service_${suffix}`,
  visit: `f89_visit_${suffix}`, appointment: `f89_appointment_${suffix}`, deposit: `f89_deposit_${suffix}`,
  expiryJob: `f89_expiry_${suffix}`, oldSession: `f89_old_session_${suffix}`,
  oldVisit: `f89_old_visit_${suffix}`, oldAppointment: `f89_old_appointment_${suffix}`, oldDeposit: `f89_old_deposit_${suffix}`
}

try {
  await seed()
  const enabled = admission.createAuthoritativeWebhookAdmission(
    new admissionRepo.PrismaAuthoritativeAdmissionRepository(prisma, {
      depositProofIngressEnabled: true,
      authoritativeTransactionTimeoutMs: 5_000
    })
  )

  const validBody = webhook('valid-image', 'image', { id: 'media-valid', mime_type: 'image/png', caption: ids.deposit })
  const validAdmission = await enabled.routeAndAdmit(signed(validBody))
  assert.deepEqual(validAdmission, { route: 'new', outcome: { status: 'admitted', eventCount: 1 } })
  assert.equal(await countJob('RECEIVE_DEPOSIT_PROOF', 'valid-image'), 1n, 'authenticated image must become durable proof work')
  assert.equal(await countInbox('valid-image'), 0n, 'proof bytes/network work must not run in webhook or ordinary inbox')
  assert.deepEqual(await enabled.routeAndAdmit(signed(validBody)), { route: 'new', outcome: { status: 'duplicate', eventCount: 1 } })
  assert.equal(await countJob('RECEIVE_DEPOSIT_PROOF', 'valid-image'), 1n, 'provider retries must not duplicate jobs')
  assert.deepEqual((await enabled.routeAndAdmit({ ...signed(webhook('bad-signature', 'image', { id: 'media-bad', mime_type: 'image/png' })), signatureHeader: 'sha256='.padEnd(71, '0') })), { route: 'new', outcome: { status: 'invalid_signature' } })
  assert.equal(await countEvent('bad-signature'), 0n, 'unauthenticated media must not be persisted')

  // The proof was durably admitted at generation 1 but remained READY across
  // cutover. RECEIVE alone is claimable and must retarget before credentials or
  // network; it does not inherit perpetual retry semantics.
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotChannelDeployment" SET "generation" = 2, "updatedAt" = clock_timestamp() WHERE "id" = ${ids.deployment}`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "deploymentGeneration" = 2, "updatedAt" = clock_timestamp() WHERE "id" = ${ids.session} AND "status" = 'ACTIVE'::"BotSessionStatus"`)
  const futureReadyJobId = `f89_future_ready_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "status", "updatedAt")
    VALUES (${futureReadyJobId}, 'RECEIVE_DEPOSIT_PROOF', ${`future-ready-event-${suffix}`}, ${ids.business}, ${ids.deployment}, 99,
      clock_timestamp() - interval '1 second', 'READY'::"BotJobStatus", clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotJob" SET "availableAt" = clock_timestamp() + interval '1 hour'
    WHERE "businessId" = ${ids.business} AND "id" <> ${futureReadyJobId}
      AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")
  `)
  assert.equal(await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId: ids.business }), null,
    'future-generation READY RECEIVE must fail closed in claim candidate and atomic recheck')
  assert.deepEqual(await rawJobState(futureReadyJobId), { status: 'READY', attempts: 0, generation: 99, leaseToken: null },
    'failed future claim must not consume budget or rewrite generation')

  const futureLeasedJobId = `f89_future_leased_${suffix}`
  const futureLeaseToken = `f89_future_token_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "status", "attempts", "leaseToken", "leasedUntil", "updatedAt")
    VALUES (${futureLeasedJobId}, 'RECEIVE_DEPOSIT_PROOF', ${`future-leased-event-${suffix}`}, ${ids.business}, ${ids.deployment}, 99,
      clock_timestamp() - interval '1 second', 'LEASED'::"BotJobStatus", 1, ${futureLeaseToken}, clock_timestamp() + interval '5 minutes', clock_timestamp())
  `)
  const futureClaim = {
    id: futureLeasedJobId, kind: 'RECEIVE_DEPOSIT_PROOF', aggregateId: `future-leased-event-${suffix}`,
    businessId: ids.business, deploymentId: ids.deployment, deploymentGeneration: 99,
    expectedRevision: null, attempts: 1, maxAttempts: 5, claimToken: futureLeaseToken,
    claimedUntil: new Date(Date.now() + 5 * 60_000), queueWaitMs: 0
  }
  let futureSensitiveCalls = 0
  const proofsBeforeFutureClaim = await countProofs(ids.deposit)
  await assert.rejects(processor.processDepositProofJob({
    client: prisma, job: futureClaim, capabilityEnabled: true,
    fetch: async () => { futureSensitiveCalls += 1; throw new Error('future claim must not fetch') },
    resolveAccessToken: async () => { futureSensitiveCalls += 1; return 'future-claim-must-not-resolve' }
  }), /generation is ahead of current deployment/)
  assert.equal(futureSensitiveCalls, 0, 'forged leased future claim must fail before credentials or provider network')
  assert.equal(await countProofs(ids.deposit), proofsBeforeFutureClaim, 'forged leased future claim must not write proof evidence')
  assert.deepEqual(await rawJobState(futureLeasedJobId), { status: 'LEASED', attempts: 1, generation: 99, leaseToken: futureLeaseToken },
    'rejected forged claim remains fenced and unmodified for ordinary lease-expiry handling')

  const validJob = await claimEventJob('valid-image')
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#246' } }).png().toBuffer()
  const fetchOk = mediaFetch(png, 'image/png')
  let cutoverCredentialCalls = 0
  assert.equal(await processor.processDepositProofJob({
    client: prisma, job: validJob, capabilityEnabled: true, fetch: fetchOk,
    resolveAccessToken: async () => {
      cutoverCredentialCalls += 1
      const row = (await prisma.$queryRaw<Array<{ generation: number; status: string }>>(Prisma.sql`SELECT "deploymentGeneration" AS "generation", "status"::text AS "status" FROM "BotJob" WHERE "id" = ${validJob.id}`))[0]!
      assert.deepEqual(row, { generation: 2, status: 'LEASED' }, 'retarget must commit before credential or network access')
      return 'token'
    }
  }), 'APPLIED')
  assert.equal(cutoverCredentialCalls, 1)
  const afterValid = await aggregate()
  assert.deepEqual({ deposit: afterValid.deposit, visit: afterValid.visit, appointment: afterValid.appointment, proofs: afterValid.proofs }, { deposit: 'PROOF_RECEIVED', visit: 'PENDING_PAYMENT_REVIEW', appointment: 'PENDING', proofs: 1n })
  assert.equal(afterValid.outbox, 1n)
  assert.doesNotMatch(afterValid.payload, /media-valid|caption|sha256|filename|proof/i, 'provider outbox must contain only approved static content')
  assert.equal(await countProofs(ids.oldDeposit), 0n, 'a historical deposit from another session must never receive the proof')
  const providerIdentity = await prisma.$queryRaw<Array<{ providerMessageId: string | null }>>(Prisma.sql`SELECT "providerMessageId" FROM "BookingDepositProof" WHERE "depositId" = ${ids.deposit}`)
  assert.equal(providerIdentity[0]?.providerMessageId, 'valid-image', 'proof must retain the authoritative provider message identity')
  assert.equal(providerIdentity.length, 1, 'provider replay must remain one proof')

  // Deterministic target-swap race: A is pinned before I/O; while credentials
  // are resolved A becomes ineligible and B becomes the sole eligible target.
  // The final transaction must hand off safely, never write or notify B.
  const swapA = await seedPendingProof('swap-a', 8)
  const seededSwapB = await seedPendingProof('swap-b', 9)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus" WHERE "id" = ${seededSwapB.visit}`)
  const swapBody = webhook('target-swap', 'image', { id: 'media-target-swap', mime_type: 'image/png' })
  await enabled.routeAndAdmit(signed(swapBody))
  const swapJob = await claimEventJob('target-swap')
  const notificationsBeforeSwap = await countAllDepositNotifications()
  assert.equal(await processor.processDepositProofJob({
    client: prisma, job: swapJob, capabilityEnabled: true, fetch: fetchOk,
    resolveAccessToken: async () => {
      await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus" WHERE "id" = ${swapA.visit}`)
      await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = 'HELD'::"BookingVisitStatus" WHERE "id" = ${seededSwapB.visit}`)
      return 'token'
    }
  }), 'FALLBACK')
  assert.equal(await countProofs(swapA.deposit), 0n)
  assert.equal(await countProofs(seededSwapB.deposit), 0n, 'target B must receive zero proof writes')
  assert.equal(await countAllDepositNotifications(), notificationsBeforeSwap, 'target B must receive zero notifications')
  assert.equal(await countInbox('target-swap'), 1n, 'the original event must take the durable safe handoff')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus" WHERE "id" = ${seededSwapB.visit}`)

  // The same identity fence applies to terminal transport handling. A target
  // swap during provider I/O must not redirect PROOF_UNAVAILABLE to B.
  const terminalA = await seedPendingProof('terminal-swap-a', 10)
  const seededTerminalB = await seedPendingProof('terminal-swap-b', 11)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus" WHERE "id" = ${seededTerminalB.visit}`)
  const terminalBody = webhook('terminal-target-swap', 'image', { id: 'media-terminal-target-swap', mime_type: 'image/png' })
  await enabled.routeAndAdmit(signed(terminalBody))
  const terminalJob = await claimEventJob('terminal-target-swap')
  const notificationsBeforeTerminalSwap = await countAllDepositNotifications()
  let terminalSwapPerformed = false
  assert.equal(await processor.processDepositProofJob({
    client: prisma, job: { ...terminalJob, attempts: terminalJob.maxAttempts }, capabilityEnabled: true,
    resolveAccessToken: async () => 'token',
    fetch: async () => {
      if (!terminalSwapPerformed) {
        await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus" WHERE "id" = ${terminalA.visit}`)
        await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = 'HELD'::"BookingVisitStatus" WHERE "id" = ${seededTerminalB.visit}`)
        terminalSwapPerformed = true
      }
      throw new Error('deterministic provider failure after target selection')
    }
  }), 'TERMINAL_TRANSPORT')
  assert.equal(terminalSwapPerformed, true)
  assert.equal(await countProofs(seededTerminalB.deposit), 0n)
  assert.equal(await countAllDepositNotifications(), notificationsBeforeTerminalSwap, 'terminal notification must remain pinned to A and therefore fall back')
  assert.equal(await countInbox('terminal-target-swap'), 1n)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "status" = 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus" WHERE "id" = ${seededTerminalB.visit}`)

  await resetForResubmission()
  assert.equal((await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status" FROM "BookingDepositReviewOutbox" WHERE "businessId" = ${ids.business} ORDER BY "createdAt" DESC LIMIT 1`))[0]?.status, 'ENQUEUED', 'review intent must bridge durably into BotOutbox in the same transaction')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "deploymentGeneration" = 1, "updatedAt" = clock_timestamp() WHERE "id" = ${ids.session}`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotChannelDeployment" SET "generation" = 2 WHERE "id" = ${ids.deployment}`)
  const pdfBody = webhook('pdf-document', 'document', { id: 'media-pdf', mime_type: 'application/pdf', filename: 'receipt.pdf' })
  assert.equal((await enabled.routeAndAdmit(signed(pdfBody))).route, 'new')
  const pdfJob = await claimEventJob('pdf-document')
  assert.equal(await processor.processDepositProofJob({ client: prisma, job: pdfJob, capabilityEnabled: true, fetch: async () => { throw new Error('must not fetch PDF') }, resolveAccessToken: async () => 'token' }), 'TERMINAL_INVALID')
  assert.equal((await aggregate()).proofs, 1n, 'terminal invalid media must not append evidence')
  const pdfEvent = await eventByKey('pdf-document')
  assert.equal(await countRecoveryAggregate(notifications.encodeDirectNotificationRecovery({ kind: 'INVALID_PROOF', depositId: ids.deposit, sourceId: pdfEvent.id })), 1n,
    'INVALID_PROOF survives stale-session cutover as its exact durable recovery kind')

  const networkBody = webhook('network-failure', 'image', { id: 'media-network', mime_type: 'image/png' })
  await enabled.routeAndAdmit(signed(networkBody))
  const networkJob = await claimEventJob('network-failure')
  await assert.rejects(
    processor.processDepositProofJob({ client: prisma, job: networkJob, capabilityEnabled: true, fetch: async () => { throw new Error('network') }, resolveAccessToken: async () => 'token' }),
    /transport_retryable/
  )
  assert.equal(await worker.retryBotJob(prisma, networkJob.id, networkJob.claimToken, 'safe_transport_failure', 0), 'RETRY')
  const exhausted = await claimEventJob('network-failure')
  assert.equal(await processor.processDepositProofJob({ client: prisma, job: { ...exhausted, attempts: exhausted.maxAttempts }, capabilityEnabled: true, fetch: async () => { throw new Error('network') }, resolveAccessToken: async () => 'token' }), 'TERMINAL_TRANSPORT')
  const networkEvent = await eventByKey('network-failure')
  assert.equal(await countRecoveryAggregate(notifications.encodeDirectNotificationRecovery({ kind: 'PROOF_UNAVAILABLE', depositId: ids.deposit, sourceId: networkEvent.id })), 1n,
    'PROOF_UNAVAILABLE remains distinct from invalid proof in durable recovery')

  const staleBody = webhook('stale-preflight', 'image', { id: 'media-stale', mime_type: 'image/png' })
  await enabled.routeAndAdmit(signed(staleBody))
  const staleClaim = await claimEventJob('stale-preflight')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "leasedUntil" = clock_timestamp() - interval '1 second' WHERE "id" = ${staleClaim.id}`)
  const recoveredClaim = await claimSpecificJob(staleClaim.id)
  let staleNetworkCalls = 0
  await assert.rejects(processor.processDepositProofJob({
    client: prisma, job: staleClaim, capabilityEnabled: true,
    fetch: async () => { staleNetworkCalls += 1; throw new Error('must not fetch') },
    resolveAccessToken: async () => { staleNetworkCalls += 1; return 'must-not-resolve' }
  }), /stale or fenced/i)
  assert.equal(staleNetworkCalls, 0, 'stale claim must be rejected before credentials or network I/O')
  assert.equal(await worker.completeBotJob(prisma, recoveredClaim.id, recoveredClaim.claimToken), true)

  const pausedBody = webhook('capability-paused', 'image', { id: 'media-paused', mime_type: 'image/png' })
  await enabled.routeAndAdmit(signed(pausedBody))
  let pausedJob = await claimEventJob('capability-paused')
  for (let cycle = 0; cycle < pausedJob.maxAttempts + 2; cycle += 1) {
    assert.equal(await processor.processDepositProofJob({ client: prisma, job: pausedJob, capabilityEnabled: false, fetch: async () => { throw new Error('must not fetch while off') } }), 'CAPABILITY_OFF')
    assert.deepEqual(await jobBudget('capability-paused'), { status: 'READY', attempts: 0 }, 'intentional OFF cycle must refund the claim attempt')
    await makeEventJobAvailable('capability-paused')
    pausedJob = await claimEventJob('capability-paused')
  }
  const pngResubmission = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#842' } }).png().toBuffer()
  assert.equal(await processor.processDepositProofJob({ client: prisma, job: pausedJob, capabilityEnabled: true, fetch: mediaFetch(pngResubmission, 'image/png'), resolveAccessToken: async () => 'token' }), 'APPLIED')
  assert.equal((await aggregate()).proofs, 2n, 'the same durable job must apply after capability re-enable')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "deploymentGeneration" = 2, "updatedAt" = clock_timestamp() WHERE "id" = ${ids.session}`)

  const disabled = admission.createAuthoritativeWebhookAdmission(
    new admissionRepo.PrismaAuthoritativeAdmissionRepository(prisma, {
      depositProofIngressEnabled: false,
      authoritativeTransactionTimeoutMs: 5_000
    })
  )
  const disabledBody = webhook('capability-off-admission', 'image', { id: 'media-off', mime_type: 'image/png' })
  await disabled.routeAndAdmit(signed(disabledBody))
  assert.equal(await countJob('RECEIVE_DEPOSIT_PROOF', 'capability-off-admission'), 0n)
  assert.equal(await countInbox('capability-off-admission'), 1n, 'OFF preserves the pre-F8.9 admission path')

  await prisma.$transaction(async (tx) => {
    const first = await notifications.enqueueDepositNotificationTx(tx, { businessId: ids.business, depositId: ids.deposit, sourceId: 'idempotent-source', kind: 'PROOF_RECEIVED' })
    const replay = await notifications.enqueueDepositNotificationTx(tx, { businessId: ids.business, depositId: ids.deposit, sourceId: 'idempotent-source', kind: 'PROOF_RECEIVED' })
    assert.equal(first, 'ENQUEUED'); assert.equal(replay, 'REPLAYED')
  })
  assert.equal(await countOutboxKey('deposit-notification:PROOF_RECEIVED:idempotent-source'), 1n)
  await assert.rejects(prisma.$transaction(async (tx) => {
    await notifications.enqueueDepositNotificationTx(tx, { businessId: ids.business, depositId: ids.deposit, sourceId: 'rollback-source', kind: 'PROOF_RECEIVED' })
    throw new Error('F89_NOTIFICATION_ROLLBACK')
  }), /F89_NOTIFICATION_ROLLBACK/)
  assert.equal(await countOutboxKey('deposit-notification:PROOF_RECEIVED:rollback-source'), 0n, 'notification insert must obey caller rollback')

  // PROOF_RECEIVED owns an indefinite hold. Review after the original deadline
  // must remain possible, and notification recovery must survive a cutover.
  const delayedTarget = await seedDelayedReviewable()
  const cutoverProofTarget = await seedPendingProof('first-after-cutover')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotChannelDeployment" SET "generation" = 3 WHERE "id" = ${ids.deployment}`)

  const cutoverProofBody = webhook('first-proof-after-cutover', 'image', { id: 'media-first-after-cutover', mime_type: 'image/png' })
  await enabled.routeAndAdmit(signed(cutoverProofBody))
  const cutoverProofJob = await claimEventJob('first-proof-after-cutover')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BusinessWhatsAppConfig" SET "accessToken" = 'rotated-same-phone-token', "updatedAt" = clock_timestamp() WHERE "businessId" = ${ids.business}`)
  assert.equal(await processor.processDepositProofJob({
    client: prisma, job: cutoverProofJob, capabilityEnabled: true,
    fetch: mediaFetch(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#173' } }).png().toBuffer(), 'image/png')
  }), 'APPLIED', 'the authoritative current-generation event may write through its uniquely bound pre-refresh active session')
  assert.equal(await countProofs(cutoverProofTarget.deposit), 1n, 'first proof after cutover is retained exactly once')
  const cutoverRecoveryAggregate = notifications.encodeDirectNotificationRecovery({
    kind: 'PROOF_RECEIVED', depositId: cutoverProofTarget.deposit,
    sourceId: (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "BookingDepositProof" WHERE "depositId" = ${cutoverProofTarget.deposit}`))[0]!.id
  })
  const cutoverRecoveryJobId = (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "BotJob" WHERE "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "aggregateId" = ${cutoverRecoveryAggregate}
  `))[0]!.id
  assert.equal(await countOutboxKey(`deposit-notification:PROOF_RECEIVED:${(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "BookingDepositProof" WHERE "depositId" = ${cutoverProofTarget.deposit}`))[0]!.id}`), 0n,
    'stale session generation must leave durable recovery rather than an unclaimable outbox')
  const delayedReview = await review.rejectCurrentDepositProof(prisma, {
    businessId: ids.business, depositId: delayedTarget.deposit, actorUserId: `f89-reviewer-delayed-${suffix}`,
    operationKey: `f89-delayed-resubmission-${suffix}`, method: 'POST', path: '/contract/f89/delayed-review',
    rejection: { mode: 'RESUBMISSION_ALLOWED', reason: 'Delayed review remains authorized' }
  })
  assert.equal(delayedReview.outcome, 'APPLIED')
  const pendingReviewOutbox = (await prisma.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
    SELECT "id", "status" FROM "BookingDepositReviewOutbox" WHERE "auditId" = ${delayedReview.auditId}
  `))[0]!
  assert.equal(pendingReviewOutbox.status, 'PENDING_CONTENT', 'no stale session may receive an unclaimable BotOutbox row')
  const bridgeJobId = (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "BotJob" WHERE "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "aggregateId" = ${pendingReviewOutbox.id}
  `))[0]!.id
  let bridgeClaim = await claimSpecificJob(bridgeJobId)
  assert.equal(await bridgeWorker.bridgeDepositNotificationJob(prisma, bridgeClaim), 'ROUTE_UNAVAILABLE')
  assert.deepEqual(await rawJobBudget(bridgeJobId), { status: 'READY', attempts: 0 })
  const currentSession = ids.session
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotSession" SET "deploymentGeneration" = 3, "updatedAt" = clock_timestamp()
    WHERE "id" = ${currentSession} AND "status" = 'ACTIVE'::"BotSessionStatus"
  `)
  let cutoverRecoveryClaim = await claimSpecificJob(cutoverRecoveryJobId)
  assert.equal(await bridgeWorker.bridgeDepositNotificationJob(prisma, cutoverRecoveryClaim), 'COMPLETED')
  assert.equal(await countOutboxKey(`deposit-notification:PROOF_RECEIVED:${(await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "BookingDepositProof" WHERE "depositId" = ${cutoverProofTarget.deposit}`))[0]!.id}`), 1n,
    'session refresh bridges the first post-cutover proof notification exactly once')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() - interval '1 second' WHERE "id" = ${bridgeJobId}`)
  bridgeClaim = await claimSpecificJob(bridgeJobId)
  assert.equal(await bridgeWorker.bridgeDepositNotificationJob(prisma, bridgeClaim), 'COMPLETED')
  assert.equal(await countOutboxKey(`deposit-notification:RESUBMISSION:${pendingReviewOutbox.id}`), 1n)
  await prisma.$transaction(async (tx) => {
    assert.equal(await notifications.bridgeDepositReviewOutboxTx(tx, { businessId: ids.business, reviewOutboxId: pendingReviewOutbox.id }), 'REPLAYED')
  })
  assert.equal(await countOutboxKey(`deposit-notification:RESUBMISSION:${pendingReviewOutbox.id}`), 1n, 'bridge replay must not duplicate delivery')
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotOutbox" SET "status" = 'ACCEPTED'::"BotOutboxStatus"
    WHERE "businessId" = ${ids.business} AND "idempotencyKey" <> ${`deposit-notification:RESUBMISSION:${pendingReviewOutbox.id}`}
      AND "status" IN ('PENDING'::"BotOutboxStatus", 'RETRY'::"BotOutboxStatus")
  `)
  const claimableNotification = await sender.claimOutbox(prisma, 30_000, randomUUID(), { businessId: ids.business })
  assert.ok(claimableNotification, 'recovered notification must be claimable by the existing sender')
  assert.equal(claimableNotification.sessionId, currentSession, 'recovered notification must route through the current deployment generation')

  const changedIdentityTarget = delayedTarget
  const changedIdentityBody = webhook('changed-provider-identity', 'image', { id: 'media-changed-provider', mime_type: 'image/png' })
  await enabled.routeAndAdmit(signed(changedIdentityBody))
  const changedIdentityJob = await claimEventJob('changed-provider-identity')
  await prisma.$executeRaw(Prisma.sql`UPDATE "BusinessWhatsAppConfig" SET "phoneNumberId" = 'replacement-provider-phone', "updatedAt" = clock_timestamp() WHERE "businessId" = ${ids.business}`)
  let changedIdentityNetworkCalls = 0
  assert.equal(await processor.processDepositProofJob({
    client: prisma, job: { ...changedIdentityJob, attempts: changedIdentityJob.maxAttempts }, capabilityEnabled: true,
    fetch: async () => { changedIdentityNetworkCalls += 1; throw new Error('must not download across provider identities') }
  }), 'TERMINAL_TRANSPORT')
  assert.equal(changedIdentityNetworkCalls, 0, 'credential identity mismatch must stop before media metadata/download calls')
  assert.equal(await countProofs(changedIdentityTarget.deposit), 1n, 'identity mismatch must not append new evidence')
  const changedIdentityEvent = await eventByKey('changed-provider-identity')
  const changedRecoveryAggregate = notifications.encodeDirectNotificationRecovery({ kind: 'PROOF_UNAVAILABLE', depositId: changedIdentityTarget.deposit, sourceId: changedIdentityEvent.id })
  const changedRecoveryJobId = (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "BotJob" WHERE "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "aggregateId" = ${changedRecoveryAggregate}`))[0]!.id
  await prisma.$executeRaw(Prisma.sql`UPDATE "BusinessWhatsAppConfig" SET "phoneNumberId" = ${phoneNumberId}, "accessToken" = 'restored-token', "updatedAt" = clock_timestamp() WHERE "businessId" = ${ids.business}`)
  const changedRecoveryClaim = await claimSpecificJob(changedRecoveryJobId)
  assert.equal(await bridgeWorker.bridgeDepositNotificationJob(prisma, changedRecoveryClaim), 'COMPLETED')
  assert.equal(await countOutboxKey(`deposit-notification:PROOF_UNAVAILABLE:${changedIdentityEvent.id}`), 1n, 'restored provider identity recovers exactly once without crossing identities')

  const raceKey = 'deposit-notification:EXPIRED:cutover-race-source'
  let routeInserted!: () => void
  let releaseRouteTx!: () => void
  const routeInsertedPromise = new Promise<void>((resolve) => { routeInserted = resolve })
  const releaseRouteTxPromise = new Promise<void>((resolve) => { releaseRouteTx = resolve })
  const routeTransaction = prisma.$transaction(async (tx) => {
    assert.equal(await notifications.enqueueDepositNotificationTx(tx, {
      businessId: ids.business, depositId: ids.deposit, sourceId: 'cutover-race-source', kind: 'EXPIRED'
    }), 'ENQUEUED')
    routeInserted()
    await releaseRouteTxPromise
  })
  await routeInsertedPromise
  let cutoverCommitted = false
  const concurrentCutover = cutoverPrisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bot-cutover:${ids.business}:WHATSAPP`}, 0))`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BotChannelDeployment" SET "generation" = 4, "updatedAt" = clock_timestamp() WHERE "id" = ${ids.deployment}`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BotSession" SET "deploymentGeneration" = 4, "updatedAt" = clock_timestamp() WHERE "id" = ${ids.session}`)
  }).then(() => { cutoverCommitted = true })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(cutoverCommitted, false, 'exclusive cutover cannot commit between notification route selection and caller commit')
  releaseRouteTx()
  await routeTransaction
  await concurrentCutover
  const racedRoute = (await prisma.$queryRaw<Array<{ sessionId: string; sessionGeneration: number; deploymentGeneration: number }>>(Prisma.sql`
    SELECT o."sessionId", s."deploymentGeneration" AS "sessionGeneration", d."generation" AS "deploymentGeneration"
    FROM "BotOutbox" o JOIN "BotSession" s ON s."id" = o."sessionId"
    JOIN "BotChannelDeployment" d ON d."id" = s."deploymentId"
    WHERE o."idempotencyKey" = ${raceKey}
  `))[0]!
  assert.deepEqual(racedRoute, { sessionId: ids.session, sessionGeneration: 4, deploymentGeneration: 4 }, 'runtime-style session refresh leaves the committed route sender-current')
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotOutbox" SET "status" = 'ACCEPTED'::"BotOutboxStatus"
    WHERE "businessId" = ${ids.business} AND "idempotencyKey" <> ${raceKey}
      AND "status" IN ('PENDING'::"BotOutboxStatus", 'RETRY'::"BotOutboxStatus")
  `)
  const racedClaim = await sender.claimOutbox(prisma, 30_000, randomUUID(), { businessId: ids.business })
  assert.ok(racedClaim)
  assert.equal(racedClaim.id, (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "BotOutbox" WHERE "idempotencyKey" = ${raceKey}`))[0]!.id,
    'route committed before cutover remains sender-claimable after atomic runtime refresh')

  const ambiguous = await seedAmbiguousCurrentDeposits(currentSession)
  const ambiguousBody = webhook('ambiguous-proof', 'image', { id: 'media-ambiguous', mime_type: 'image/png' })
  await enabled.routeAndAdmit(signed(ambiguousBody))
  const ambiguousJob = await claimEventJob('ambiguous-proof')
  let ambiguousNetworkCalls = 0
  assert.equal(await processor.processDepositProofJob({
    client: prisma, job: ambiguousJob, capabilityEnabled: true,
    fetch: async () => { ambiguousNetworkCalls += 1; throw new Error('must not fetch ambiguous proof') },
    resolveAccessToken: async () => { ambiguousNetworkCalls += 1; return 'must-not-resolve' }
  }), 'FALLBACK')
  assert.equal(ambiguousNetworkCalls, 0)
  assert.equal(await countInbox('ambiguous-proof'), 1n, 'ambiguous target must take the durable safe fallback')
  const fallbackPayload = (await prisma.$queryRaw<Array<{ payload: string }>>(Prisma.sql`
    SELECT i."payload"::text AS "payload" FROM "BotActionInbox" i
    JOIN "BotProviderEvent" e ON e."id" = i."providerEventId" WHERE e."eventKey" = 'ambiguous-proof'
  `))[0]!.payload
  assert.doesNotMatch(fallbackPayload, /media-ambiguous|f89_amb_deposit|lookaside|sha256/i, 'safe fallback must not propagate proof or deposit identifiers')
  assert.equal(await countProofs(ambiguous.firstDeposit), 0n)
  assert.equal(await countProofs(ambiguous.secondDeposit), 0n)

  const malformedDirectAggregates = [
    'direct:',
    'direct:v2:anything',
    'direct:v1:not+base64url',
    `direct:v1:${Buffer.from(JSON.stringify({ kind: 'EXPIRED', v: 1, sourceId: 'source', depositId: 'deposit' })).toString('base64url')}`
  ]
  const outboxBeforeMalformed = await countAllOutbox()
  for (const [index, aggregateId] of malformedDirectAggregates.entries()) {
    const malformedJobId = `f89_malformed_direct_${index}_${suffix}`
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "status", "updatedAt")
      VALUES (${malformedJobId}, 'BRIDGE_DEPOSIT_NOTIFICATION', ${aggregateId}, ${ids.business}, ${ids.deployment}, 4,
        clock_timestamp() - interval '1 second', 'READY'::"BotJobStatus", clock_timestamp())
    `)
    const malformedClaim = await claimSpecificJob(malformedJobId)
    assert.equal(await bridgeWorker.bridgeDepositNotificationJob(prisma, malformedClaim), 'TERMINAL_MALFORMED')
    assert.deepEqual(await rawTerminalJob(malformedJobId), {
      status: 'POISON', attempts: 1, lastError: 'malformed reserved direct notification recovery aggregate'
    })
    assert.equal(await countAllOutbox(), outboxBeforeMalformed, 'malformed reserved direct aggregate must insert zero outbox work')
    await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() - interval '1 second' WHERE "id" = ${malformedJobId}`)
    assert.equal(await claimOnlyJob(malformedJobId), null, 'terminal malformed job must not be reclaimed by repeated polling')
  }

  console.log('OK F8.9 PG: exact session/deposit authorization and ambiguity fallback, future-generation fail-closed fencing, provider identity/replay, stale preflight, refundable OFF cycles, delayed review, cutover-safe notification recovery/sender routing, terminal malformed recovery/media outcomes and redacted idempotent outbox.')
} finally {
  await cleanup()
  await cutoverPrisma.$disconnect()
  await prisma.$disconnect()
}

function webhook(messageId: string, type: 'image' | 'document', media: Record<string, unknown>) {
  return Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: messageId, from: fromPhone, timestamp: '1787846400', type, [type]: media }] } }] }] }), 'utf8')
}
function signed(rawBody: Buffer) { return { rawBody, signatureHeader: `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}` } }
function headers(values: Record<string, string> = {}) { return { get: (name: string) => values[name.toLowerCase()] ?? null } }
function mediaFetch(data: Buffer, mime: string) {
  return async (url: string) => url.includes('graph.facebook.com')
    ? { ok: true, headers: headers(), body: null, json: async () => ({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/proof', mime_type: mime, file_size: data.length }) }
    : { ok: true, headers: headers({ 'content-type': mime, 'content-length': String(data.length) }), body: (async function* () { yield data })() }
}

async function seed() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${ids.business}, ${`F89-${suffix}`}, 'F8.9 vertical')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessWhatsAppConfig" ("id", "businessId", "connectionStatus", "phoneNumberId", "accessToken", "appSecret", "updatedAt") VALUES (${ids.whatsapp}, ${ids.business}, 'CONNECTED'::"WhatsAppConnectionStatus", ${phoneNumberId}, 'test-token', ${secret}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt") VALUES (${ids.config}, ${ids.business}, 'deterministic-options', 'F8.9', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "updatedAt") VALUES (${ids.deployment}, ${ids.business}, ${ids.config}, 1, 1, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${ids.conversation}, ${fromPhone}, ${ids.business}, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "updatedAt") VALUES (${ids.session}, ${ids.business}, ${ids.conversation}, ${ids.deployment}, 1, 'UTC', '{}'::jsonb, clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "status", "updatedAt") VALUES (${ids.oldSession}, ${ids.business}, ${ids.conversation}, ${ids.deployment}, 1, 'UTC', '{}'::jsonb, 'CLOSED'::"BotSessionStatus", clock_timestamp() - interval '2 days')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone") VALUES (${ids.customer}, ${ids.business}, 'Cliente F8.9', ${fromPhone}, ${fromPhone})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id", "businessId", "name") VALUES (${ids.professional}, ${ids.business}, 'Profesional F8.9')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id", "businessId", "name", "duration", "depositMode") VALUES (${ids.service}, ${ids.business}, 'Servicio F8.9', 30, 'FIXED'::"ServiceDepositMode")`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${ids.visit}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.session}, 'HELD'::"BookingVisitStatus", clock_timestamp() + interval '1 day', 30, clock_timestamp() + interval '1 hour', clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${ids.appointment}, ${ids.customer}, ${ids.professional}, ${ids.service}, clock_timestamp() + interval '1 day', 30, 'PENDING'::"AppointmentStatus", ${ids.visit})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${ids.appointment}, ${ids.service}, 0, 30, 100)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "conversationId", "visitId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "updatedAt") VALUES (${ids.deposit}, ${ids.business}, ${ids.appointment}, ${ids.conversation}, ${ids.visit}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 100, 100, 'PENDING_PROOF'::"BookingDepositStatus", clock_timestamp() + interval '1 hour', 60, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "amount") VALUES (${randomUUID()}, ${ids.business}, ${ids.deposit}, ${ids.service}, 0, 'Servicio F8.9', 'FIXED'::"ServiceDepositMode", 100, 100)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() WHERE "id" = ${ids.deposit}`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "updatedAt") VALUES (${ids.expiryJob}, 'EXPIRE_DEPOSIT', ${ids.deposit}, ${ids.business}, ${ids.deployment}, 1, clock_timestamp() + interval '1 hour', clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${ids.oldVisit}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.oldSession}, 'EXPIRED'::"BookingVisitStatus", clock_timestamp() + interval '2 days', 30, clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 day')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${ids.oldAppointment}, ${ids.customer}, ${ids.professional}, ${ids.service}, clock_timestamp() + interval '2 days', 30, 'CANCELLED'::"AppointmentStatus", ${ids.oldVisit})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${ids.oldAppointment}, ${ids.service}, 0, 30, 100)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "conversationId", "visitId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "expiredAt", "expirationReason", "holdTtlMinutes", "holdTtlProvenance", "updatedAt") VALUES (${ids.oldDeposit}, ${ids.business}, ${ids.oldAppointment}, ${ids.conversation}, ${ids.oldVisit}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 100, 100, 'EXPIRED'::"BookingDepositStatus", clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 day', 'HISTORICAL_CONTRACT', 60, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", clock_timestamp() - interval '1 day')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "amount") VALUES (${randomUUID()}, ${ids.business}, ${ids.oldDeposit}, ${ids.service}, 0, 'Servicio histórico', 'FIXED'::"ServiceDepositMode", 100, 100)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() - interval '1 day' WHERE "id" = ${ids.oldDeposit}`)
  })
}

async function resetForResubmission() {
  await review.rejectCurrentDepositProof(prisma, {
    businessId: ids.business,
    depositId: ids.deposit,
    actorUserId: `f89-reviewer-${suffix}`,
    operationKey: `f89-resubmission-${suffix}`,
    method: 'POST',
    path: `/contract/deposits/${ids.deposit}/reject`,
    rejection: { mode: 'RESUBMISSION_ALLOWED', reason: 'Contract resubmission' }
  })
}
async function claimEventJob(eventKey: string) {
  const row = (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT j."id" FROM "BotJob" j JOIN "BotProviderEvent" e ON e."id" = j."aggregateId" WHERE e."eventKey" = ${eventKey}`))[0]
  assert.ok(row)
  return claimSpecificJob(row.id)
}
async function claimSpecificJob(jobId: string) {
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() + interval '1 hour' WHERE "businessId" = ${ids.business} AND "id" <> ${jobId} AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")`)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() - interval '1 second' WHERE "id" = ${jobId}`)
  const claimed = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId: ids.business })
  assert.equal(claimed?.id, jobId)
  return claimed!
}
async function claimOnlyJob(jobId: string) {
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() + interval '1 hour' WHERE "businessId" = ${ids.business} AND "id" <> ${jobId} AND "status" IN ('READY'::"BotJobStatus", 'RETRY'::"BotJobStatus")`)
  return worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId: ids.business })
}
async function makeEventJobAvailable(eventKey: string) { await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" j SET "availableAt" = clock_timestamp() - interval '1 second' FROM "BotProviderEvent" e WHERE e."id" = j."aggregateId" AND e."eventKey" = ${eventKey}`) }
async function countJob(kind: string, eventKey: string) { return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotJob" j JOIN "BotProviderEvent" e ON e."id" = j."aggregateId" WHERE j."kind" = ${kind} AND e."eventKey" = ${eventKey}`))[0]!.count }
async function countInbox(eventKey: string) { return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotActionInbox" i JOIN "BotProviderEvent" e ON e."id" = i."providerEventId" WHERE e."eventKey" = ${eventKey}`))[0]!.count }
async function countEvent(eventKey: string) { return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotProviderEvent" WHERE "eventKey" = ${eventKey}`))[0]!.count }
async function eventByKey(eventKey: string) { return (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "BotProviderEvent" WHERE "eventKey" = ${eventKey}`))[0]! }
async function countOutboxKey(key: string) { return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotOutbox" WHERE "idempotencyKey" = ${key}`))[0]!.count }
async function countRecoveryAggregate(aggregateId: string) { return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotJob" WHERE "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "aggregateId" = ${aggregateId}`))[0]!.count }
async function jobStatus(eventKey: string) { return (await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT j."status"::text AS "status" FROM "BotJob" j JOIN "BotProviderEvent" e ON e."id" = j."aggregateId" WHERE e."eventKey" = ${eventKey}`))[0]!.status }
async function jobBudget(eventKey: string) { return (await prisma.$queryRaw<Array<{ status: string; attempts: number }>>(Prisma.sql`SELECT j."status"::text AS "status", j."attempts" FROM "BotJob" j JOIN "BotProviderEvent" e ON e."id" = j."aggregateId" WHERE e."eventKey" = ${eventKey}`))[0]! }
async function rawJobBudget(jobId: string) { return (await prisma.$queryRaw<Array<{ status: string; attempts: number }>>(Prisma.sql`SELECT "status"::text AS "status", "attempts" FROM "BotJob" WHERE "id" = ${jobId}`))[0]! }
async function rawJobState(jobId: string) { return (await prisma.$queryRaw<Array<{ status: string; attempts: number; generation: number; leaseToken: string | null }>>(Prisma.sql`SELECT "status"::text AS "status", "attempts", "deploymentGeneration" AS "generation", "leaseToken" FROM "BotJob" WHERE "id" = ${jobId}`))[0]! }
async function rawTerminalJob(jobId: string) { return (await prisma.$queryRaw<Array<{ status: string; attempts: number; lastError: string | null }>>(Prisma.sql`SELECT "status"::text AS "status", "attempts", "lastError" FROM "BotJob" WHERE "id" = ${jobId}`))[0]! }
async function countProofs(depositId: string) { return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BookingDepositProof" WHERE "depositId" = ${depositId}`))[0]!.count }
async function countAllOutbox() { return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS "count" FROM "BotOutbox" WHERE "businessId" = ${ids.business}`))[0]!.count }
async function countAllDepositNotifications() { return (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
  SELECT (
    (SELECT count(*) FROM "BotOutbox" WHERE "businessId" = ${ids.business} AND "idempotencyKey" LIKE 'deposit-notification:%')
    + (SELECT count(*) FROM "BotJob" WHERE "businessId" = ${ids.business} AND "kind" = 'BRIDGE_DEPOSIT_NOTIFICATION' AND "aggregateId" LIKE 'direct:v1:%')
  )::bigint AS "count"
`))[0]!.count }
async function aggregate() { return (await prisma.$queryRaw<Array<{ deposit: string; visit: string; appointment: string; proofs: bigint; outbox: bigint; payload: string }>>(Prisma.sql`SELECT (SELECT "status"::text FROM "BookingDeposit" WHERE "id" = ${ids.deposit}) AS "deposit", (SELECT "status"::text FROM "BookingVisit" WHERE "id" = ${ids.visit}) AS "visit", (SELECT "status"::text FROM "Appointment" WHERE "id" = ${ids.appointment}) AS "appointment", (SELECT count(*)::bigint FROM "BookingDepositProof" WHERE "depositId" = ${ids.deposit}) AS "proofs", (SELECT count(*)::bigint FROM "BotOutbox" WHERE "businessId" = ${ids.business}) AS "outbox", COALESCE((SELECT "payload"::text FROM "BotOutbox" WHERE "businessId" = ${ids.business} ORDER BY "createdAt" LIMIT 1), '') AS "payload"`))[0]! }

async function seedAmbiguousCurrentDeposits(sessionId: string) {
  const refs = [0, 1].map((index) => ({
    visit: `f89_amb_visit_${index}_${suffix}`, appointment: `f89_amb_appointment_${index}_${suffix}`,
    deposit: `f89_amb_deposit_${index}_${suffix}`
  }))
  await prisma.$transaction(async (tx) => {
    for (const [index, ref] of refs.entries()) {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${ref.visit}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${sessionId}, 'HELD'::"BookingVisitStatus", clock_timestamp() + (${index + 3} * interval '1 day'), 30, clock_timestamp() + interval '1 hour', clock_timestamp())`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${ref.appointment}, ${ids.customer}, ${ids.professional}, ${ids.service}, clock_timestamp() + (${index + 3} * interval '1 day'), 30, 'PENDING'::"AppointmentStatus", ${ref.visit})`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${ref.appointment}, ${ids.service}, 0, 30, 100)`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "conversationId", "visitId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "updatedAt") VALUES (${ref.deposit}, ${ids.business}, ${ref.appointment}, ${ids.conversation}, ${ref.visit}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 100, 100, 'PENDING_PROOF'::"BookingDepositStatus", clock_timestamp() + interval '1 hour', 60, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", clock_timestamp())`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "amount") VALUES (${randomUUID()}, ${ids.business}, ${ref.deposit}, ${ids.service}, 0, 'Servicio ambiguo', 'FIXED'::"ServiceDepositMode", 100, 100)`)
      await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() WHERE "id" = ${ref.deposit}`)
    }
  })
  return { firstDeposit: refs[0]!.deposit, secondDeposit: refs[1]!.deposit }
}

async function seedDelayedReviewable() {
  const visit = `f89_delayed_visit_${suffix}`, appointment = `f89_delayed_appointment_${suffix}`
  const deposit = `f89_delayed_deposit_${suffix}`, proof = `f89_delayed_proof_${suffix}`
  const bytes = Buffer.from(`f89-delayed-proof-${suffix}`)
  const hash = createHash('sha256').update(bytes).digest('hex')
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${visit}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.session}, 'PENDING_PAYMENT_REVIEW'::"BookingVisitStatus", clock_timestamp() + interval '6 days', 30, clock_timestamp() - interval '1 minute', clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${appointment}, ${ids.customer}, ${ids.professional}, ${ids.service}, clock_timestamp() + interval '6 days', 30, 'PENDING'::"AppointmentStatus", ${visit})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointment}, ${ids.service}, 0, 30, 100)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "conversationId", "visitId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "updatedAt") VALUES (${deposit}, ${ids.business}, ${appointment}, ${ids.conversation}, ${visit}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 100, 100, 'PROOF_RECEIVED'::"BookingDepositStatus", clock_timestamp() - interval '1 minute', 60, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "amount") VALUES (${randomUUID()}, ${ids.business}, ${deposit}, ${ids.service}, 0, 'Servicio demorado', 'FIXED'::"ServiceDepositMode", 100, 100)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() WHERE "id" = ${deposit}`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositProof" ("id", "businessId", "depositId", "sequence", "kind", "validatorVersion", "validatedAt", "receivedAt", "sourceData", "sourceMimeType", "sourceFilename", "sourceByteSize", "sourceSha256", "derivedData", "derivedMimeType", "derivedByteSize", "derivedSha256", "retentionEligibleAt") VALUES (${proof}, ${ids.business}, ${deposit}, 1, 'INITIAL'::"BookingDepositProofKind", 'f89-delayed', clock_timestamp(), clock_timestamp(), ${bytes}, 'image/png', 'proof.png', ${bytes.length}, ${hash}, ${bytes}, 'image/webp', ${bytes.length}, ${hash}, clock_timestamp() + interval '12 months')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "availableAt", "status", "updatedAt") VALUES (${randomUUID()}, 'EXPIRE_DEPOSIT', ${deposit}, ${ids.business}, ${ids.deployment}, 1, clock_timestamp() - interval '1 minute', 'DONE'::"BotJobStatus", clock_timestamp())`)
  })
  return { visit, appointment, deposit, proof }
}

async function seedPendingProof(name: string, dayOffset = 7) {
  const visit = `f89_${name}_visit_${suffix}`, appointment = `f89_${name}_appointment_${suffix}`
  const deposit = `f89_${name}_deposit_${suffix}`
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id", "businessId", "customerId", "professionalId", "sessionId", "status", "scheduledStartAt", "totalDurationMinutes", "holdExpiresAt", "updatedAt") VALUES (${visit}, ${ids.business}, ${ids.customer}, ${ids.professional}, ${ids.session}, 'HELD'::"BookingVisitStatus", clock_timestamp() + (${dayOffset} * interval '1 day'), 30, clock_timestamp() + interval '1 hour', clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id", "customerId", "professionalId", "serviceId", "startAt", "totalDurationMinutes", "status", "visitId") VALUES (${appointment}, ${ids.customer}, ${ids.professional}, ${ids.service}, clock_timestamp() + (${dayOffset} * interval '1 day'), 30, 'PENDING'::"AppointmentStatus", ${visit})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId", "serviceId", "sortOrder", "durationMinutes", "price") VALUES (${appointment}, ${ids.service}, 0, 30, 100)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id", "businessId", "appointmentId", "conversationId", "visitId", "source", "mode", "configuredValue", "amount", "status", "expiresAt", "holdTtlMinutes", "holdTtlProvenance", "updatedAt") VALUES (${deposit}, ${ids.business}, ${appointment}, ${ids.conversation}, ${visit}, 'WHATSAPP'::"BookingDepositSource", 'FIXED'::"ServiceDepositMode", 100, 100, 'PENDING_PROOF'::"BookingDepositStatus", clock_timestamp() + interval '1 hour', 60, 'BUSINESS_POLICY'::"BookingDepositTtlProvenance", clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id", "businessId", "depositId", "serviceId", "sortOrder", "serviceName", "mode", "configuredValue", "amount") VALUES (${randomUUID()}, ${ids.business}, ${deposit}, ${ids.service}, 0, 'Servicio post-cutover', 'FIXED'::"ServiceDepositMode", 100, 100)`)
    await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt" = clock_timestamp() WHERE "id" = ${deposit}`)
  })
  return { visit, appointment, deposit }
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotActionInbox" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositReviewOutbox" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositReviewAudit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "StaffAuditLog" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotProviderEvent" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLateProofHandoff" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositProof" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDepositLine" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "AppointmentServiceItem" item USING "Appointment" appointment, "Professional" professional WHERE item."appointmentId" = appointment."id" AND appointment."professionalId" = professional."id" AND professional."businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Appointment" appointment USING "Professional" professional WHERE appointment."professionalId" = professional."id" AND professional."businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BookingVisit" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "id" = ${ids.professional}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "id" = ${ids.service}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Customer" WHERE "id" = ${ids.customer}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id" = ${ids.conversation}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "id" = ${ids.deployment}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessWhatsAppConfig" WHERE "businessId" = ${ids.business}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "id" = ${ids.config}`)
    await tx.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${ids.business}`)
  }).catch(() => undefined)
}

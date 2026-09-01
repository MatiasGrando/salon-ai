import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { resolveF10PgContractDatabase } from './f10-pg-contract-database.js'

const connectionString = resolveF10PgContractDatabase('F10.4 handoff resume contract')
const [{ createPrismaClient }, { Prisma }, handoff, worker, state] = await Promise.all([
  import('../src/config/prisma-client.js'), import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/handoff-operations.js'), import('../src/bot-options/infrastructure/postgres-worker.js'), import('../src/bot-options/domain/state.js')
])
const prisma = createPrismaClient({ connectionString, max: 6, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
const suffix = randomUUID().replaceAll('-', '')
const ids = { business: `f104_b_${suffix}`, other: `f104_o_${suffix}`, config: `f104_c_${suffix}`, deployment: `f104_d_${suffix}` }
const key = (x: string) => `f104_${x}_${suffix}`
const owner = key('owner')

try {
  await assertSchema()
  await seedBusiness(ids.business); await seedBusiness(ids.other)
  await preTakeProofIsTerminalAfterResolution()
  await queuedTakeWithoutSnapshotFails()
  await validResumeAndReplay()
  await staleTakeRecoveryCompletesOwnership()
  await blockedResolveReloadAdoptsCanonicalOperation()
  await legacyTakenSnapshotInjectionHomes()
  await manualConversationWins()
  await invalidStateReferenceHomes()
  await aggregateInvalidationsHome()
  await crossTenantReferenceHomes()
  await samePhoneAppointmentCanResume()
  await reassignedAppointmentHomes()
  await concurrentManualWins()
  console.log('OK F10.4 PG: pre-TAKE proof work is terminal and CRM-visible across TAKE/resolution; immutable QUEUED-to-TAKEN snapshot permits only stable RESUME; legacy snapshot injection, manual mutations, invalid state references, invalid booking/deposit/appointment, cross-tenant/customer references and the conversation-lock race resolve HOME; replay preserves the applied result.')
} finally { await prisma.$disconnect() }

async function assertSchema() {
  const row = (await prisma.$queryRaw<Array<{ snapshot: boolean; immutable: boolean }>>(Prisma.sql`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='BotHandoff' AND column_name='resumeSnapshot') AS snapshot, EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='BotHandoff_resumeSnapshot_immutable') AS immutable`))[0]
  assert.deepEqual(row, { snapshot: true, immutable: true })
}
async function seedBusiness(businessId: string) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id","customerCode","name") VALUES (${businessId},${key(`customer-${businessId}`)},'F10.4 contract')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id","businessId","botKey","name","version","status","definition","updatedAt") VALUES (${businessId === ids.business ? ids.config : key('other-config')},${businessId},'deterministic-options','F10.4','v1','ACTIVE','{}'::jsonb,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id","businessId","engineKey","activeConfigurationId","legacyDispatchCoverageVersion","updatedAt") VALUES (${businessId === ids.business ? ids.deployment : key('other-deployment')},${businessId},'deterministic-options',${businessId === ids.business ? ids.config : key('other-config')},1,clock_timestamp())`)
  })
}
async function scenario(tag: string, current = state.createInitialBotOptionsState(), beforeTake?: (ids: { conversationId: string; sessionId: string }) => Promise<void>) {
  const conversationId = key(`v-${tag}`), sessionId = key(`s-${tag}`), handoffId = key(`h-${tag}`)
  const queued = { ...current, flow: 'HANDOFF_QUEUED', handoff: 'QUEUED', handoffReturnFlow: current.flow }
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","updatedAt") VALUES (${conversationId},${ids.business},${key(`phone-${tag}`)},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","updatedAt") VALUES (${sessionId},${ids.business},${conversationId},${ids.deployment},0,'UTC',${JSON.stringify(queued)}::jsonb,0,'HUMAN_QUEUED'::"BotSessionStatus",clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","reason","updatedAt") VALUES (${handoffId},${ids.business},${sessionId},'contract',clock_timestamp())`)
  })
  if (beforeTake) await beforeTake({ conversationId, sessionId })
  await handoff.takeBotHandoff({ client: prisma, businessId: ids.business, conversationId, actorUserId: owner, operationKey: key(`take-${tag}`) })
  return { conversationId, sessionId, handoffId }
}
async function resolve(x: { conversationId: string }, tag: string) { return handoff.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: owner, operationKey: key(`resolve-${tag}`), resolution: 'RESUME' }) }
async function preTakeProofIsTerminalAfterResolution() {
  const tag = 'pre-take-proof', held = await heldStateWithAggregate(tag)
  const eventId = key(`${tag}-event`), jobId = key(`${tag}-job`), messageId = key(`${tag}-message`)
  const x = await scenario(tag, held.current, async ({ conversationId, sessionId }) => {
    await held.seed({ conversationId, sessionId })
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id","provider","eventKey","eventType","businessId","providerMessageId","payload","status") VALUES (${eventId},'WHATSAPP',${key(`${tag}-event-key`)},'MESSAGE'::"BotProviderEventType",${ids.business},${messageId},${JSON.stringify({ kind: 'message', fromPhone: key(`phone-${tag}`), messageType: 'image', mediaId: 'pre-take-proof-media' })}::jsonb,'ADMITTED'::"BotProviderEventStatus")`)
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id","kind","aggregateId","businessId","deploymentId","deploymentGeneration","status","updatedAt") VALUES (${jobId},'RECEIVE_DEPOSIT_PROOF',${eventId},${ids.business},${ids.deployment},0,'READY'::"BotJobStatus",clock_timestamp())`)
  })
  // The proof is an inbound material change while the advisor owns the
  // conversation, so deterministic revalidation correctly falls back HOME.
  // HOME still reactivates the session; the terminal proof must not revive.
  assert.equal((await resolve(x, tag)).resolution, 'HOME')
  const rows = await prisma.$queryRaw<Array<{ job: string; reason: string | null; event: string; messages: bigint; deposit: string }>>(Prisma.sql`
    SELECT (SELECT "status"::text FROM "BotJob" WHERE "id"=${jobId}) AS job,
      (SELECT "lastError" FROM "BotJob" WHERE "id"=${jobId}) AS reason,
      (SELECT "status"::text FROM "BotProviderEvent" WHERE "id"=${eventId}) AS event,
      (SELECT count(*)::bigint FROM "Message" WHERE "conversationId"=${x.conversationId} AND "providerMessageId"=${messageId}) AS messages,
      (SELECT "status"::text FROM "BookingDeposit" WHERE "conversationId"=${x.conversationId}) AS deposit
  `)
  assert.deepEqual(rows[0], { job: 'DONE', reason: 'HUMAN_TAKEN_SUPPRESSED', event: 'PROCESSED', messages: 1n, deposit: 'PENDING_PROOF' })
  assert.equal(await worker.claimBotJob(prisma, 30_000, key(`${tag}-claim`), { businessId: ids.business }), null, 'a pre-TAKE proof job cannot revive after handoff resolution reactivates the bot')
}
async function validResumeAndReplay() {
  const x = await scenario('valid'); const result = await resolve(x, 'valid')
  assert.equal(result.resolution, 'HOME')
  assert.equal((await resolve(x, 'valid')).resolution, 'HOME', 'completed replay returns the durable applied result')
}
async function staleTakeRecoveryCompletesOwnership() {
  const tag = 'stale-take-recovery'
  const conversationId = key(`v-${tag}`), sessionId = key(`s-${tag}`), handoffId = key(`h-${tag}`)
  const operationKey = key(`take-${tag}`)
  const queued = { ...state.createInitialBotOptionsState(), flow: 'HANDOFF_QUEUED', handoff: 'QUEUED', handoffReturnFlow: 'MAIN_MENU' }
  const requestHash = createHash('sha256').update(JSON.stringify({ action: 'TAKE', actorUserId: owner, conversationId }), 'utf8').digest('hex')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","currentStep","aiEnabled","humanHandoffAt","updatedAt") VALUES (${conversationId},${ids.business},${key(`phone-${tag}`)},'HUMAN_HANDOFF'::"ConversationStep",true,clock_timestamp(),clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","handoffClaimsPausedAt","handoffFenceEpoch","updatedAt") VALUES (${sessionId},${ids.business},${conversationId},${ids.deployment},0,'UTC',${JSON.stringify(queued)}::jsonb,0,'HUMAN_QUEUED'::"BotSessionStatus",clock_timestamp(),1,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","reason","updatedAt") VALUES (${handoffId},${ids.business},${sessionId},'stale take recovery contract',clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" ("id","operationKey","type","businessId","sessionId","status","requestHash","resultRef","updatedAt") VALUES (${key(`op-${tag}`)},${operationKey},'HANDOFF_TAKE',${ids.business},${sessionId},'STARTED',${requestHash},${handoffId},clock_timestamp()-interval '2 minutes')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","actorUserId","operationKey","detail") VALUES (${key(`audit-${tag}`)},${ids.business},${sessionId},${handoffId},'TAKE_STARTED',${owner},${operationKey},'{"epoch":1}'::jsonb)`)
  })
  assert.deepEqual(await handoff.recoverStaleTakeOperations({ client: prisma }), { completed: 1, waiting: 0, blockedUnknown: 0, aborted: 0 })
  const rows = await prisma.$queryRaw<Array<{ handoff: string; session: string; aiEnabled: boolean; operation: string }>>(Prisma.sql`
    SELECT h."status"::text AS handoff,s."status"::text AS session,c."aiEnabled",op."status" AS operation
    FROM "BotHandoff" h JOIN "BotSession" s ON s."id"=h."sessionId" JOIN "Conversation" c ON c."id"=s."conversationId"
    JOIN "BotOperation" op ON op."operationKey"=${operationKey} WHERE h."id"=${handoffId}`)
  assert.deepEqual(rows[0], { handoff: 'TAKEN', session: 'HUMAN_TAKEN', aiEnabled: false, operation: 'COMPLETED' })
}
async function blockedResolveReloadAdoptsCanonicalOperation() {
  const tag = 'resolve-reload'
  const x = await scenario(tag)
  const canonicalKey = key(`resolve-canonical-${tag}`), retryKey = key(`resolve-retry-${tag}`)
  const requestHash = createHash('sha256').update(JSON.stringify({ action: 'RESOLVE', actorUserId: owner, conversationId: x.conversationId, resolution: 'RESUME' }), 'utf8').digest('hex')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotOperation" ("id","operationKey","type","businessId","sessionId","status","requestHash","resultRef","updatedAt") VALUES (${key(`op-${tag}`)},${canonicalKey},'HANDOFF_RESOLVE',${ids.business},${x.sessionId},'BLOCKED_UNKNOWN',${requestHash},${x.handoffId},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoffAudit" ("id","businessId","sessionId","handoffId","action","actorUserId","operationKey","detail") VALUES (${key(`audit-${tag}`)},${ids.business},${x.sessionId},${x.handoffId},'RESOLVE_BLOCKED_UNKNOWN',${owner},${canonicalKey},'{"epoch":1}'::jsonb)`)
  })
  const result = await handoff.resolveBotHandoff({ client: prisma, businessId: ids.business, conversationId: x.conversationId, actorUserId: owner, operationKey: retryKey, resolution: 'RESUME' })
  assert.equal(result.status, 'RESOLVED')
  const operations = await prisma.$queryRaw<Array<{ operationKey: string; status: string }>>(Prisma.sql`
    SELECT "operationKey","status" FROM "BotOperation" WHERE "operationKey" IN (${canonicalKey},${retryKey}) ORDER BY "operationKey"`)
  assert.deepEqual(operations, [{ operationKey: canonicalKey, status: 'COMPLETED' }], 'reload retry completes the canonical resolve without creating an alias')
}
async function queuedTakeWithoutSnapshotFails() {
  const conversationId = key('v-queued-null'), sessionId = key('s-queued-null'), handoffId = key('h-queued-null')
  const initial = state.createInitialBotOptionsState()
  const queued = { ...initial, flow: 'HANDOFF_QUEUED', handoff: 'QUEUED', handoffReturnFlow: initial.flow }
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","updatedAt") VALUES (${conversationId},${ids.business},${key('phone-queued-null')},clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","updatedAt") VALUES (${sessionId},${ids.business},${conversationId},${ids.deployment},0,'UTC',${JSON.stringify(queued)}::jsonb,0,'HUMAN_QUEUED'::"BotSessionStatus",clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","reason","updatedAt") VALUES (${handoffId},${ids.business},${sessionId},'missing snapshot contract',clock_timestamp())`)
  })
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`UPDATE "BotHandoff" SET "status"='TAKEN'::"BotHandoffStatus","ownerUserId"=${owner},"takenAt"=clock_timestamp(),"updatedAt"=clock_timestamp() WHERE "id"=${handoffId} AND "businessId"=${ids.business}`),
    /BotHandoff TAKEN requires resumeSnapshot/
  )
  const row = await prisma.$queryRaw<Array<{ status: string; resumeSnapshot: unknown | null }>>(Prisma.sql`SELECT "status"::text AS "status","resumeSnapshot" FROM "BotHandoff" WHERE "id"=${handoffId} AND "businessId"=${ids.business}`)
  assert.deepEqual(row[0], { status: 'QUEUED', resumeSnapshot: null }, 'failed TAKE leaves the queued handoff without a snapshot')
}
async function legacyTakenSnapshotInjectionHomes() {
  const conversationId = key('v-legacy-null'), sessionId = key('s-legacy-null'), handoffId = key('h-legacy-null')
  const initial = state.createInitialBotOptionsState()
  const taken = { ...initial, flow: 'HANDOFF_TAKEN', handoff: 'TAKEN', handoffReturnFlow: initial.flow }
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id","businessId","phone","currentStep","aiEnabled","updatedAt") VALUES (${conversationId},${ids.business},'5491123456789','HUMAN_HANDOFF'::"ConversationStep",false,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id","businessId","conversationId","deploymentId","deploymentGeneration","businessTimezone","state","revision","status","handoffClaimsPausedAt","handoffFenceEpoch","updatedAt") VALUES (${sessionId},${ids.business},${conversationId},${ids.deployment},0,'UTC',${JSON.stringify(taken)}::jsonb,0,'HUMAN_TAKEN'::"BotSessionStatus",clock_timestamp(),1,clock_timestamp())`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "BotHandoff" ("id","businessId","sessionId","status","reason","ownerUserId","takenAt","updatedAt") VALUES (${handoffId},${ids.business},${sessionId},'TAKEN'::"BotHandoffStatus",'legacy contract',${owner},clock_timestamp(),clock_timestamp())`)
  })
  await assert.rejects(
    prisma.$executeRaw(Prisma.sql`UPDATE "BotHandoff" SET "resumeSnapshot"='{}'::jsonb WHERE "id"=${handoffId} AND "businessId"=${ids.business}`),
    /BotHandoff resumeSnapshot is immutable/
  )
  const snapshot = await prisma.$queryRaw<Array<{ resumeSnapshot: unknown | null }>>(Prisma.sql`SELECT "resumeSnapshot" FROM "BotHandoff" WHERE "id"=${handoffId} AND "businessId"=${ids.business}`)
  assert.equal(snapshot[0]!.resumeSnapshot, null, 'failed legacy injection leaves the snapshot absent')
  assert.equal((await resolve({ conversationId }, 'legacy-null')).resolution, 'HOME', 'legacy TAKEN without a TAKE baseline must fail closed')
}
async function manualConversationWins() {
  const x = await scenario('manual')
  await prisma.$executeRaw(Prisma.sql`UPDATE "Conversation" SET "lastMessage"='manual CRM edit',"updatedAt"=clock_timestamp() WHERE "id"=${x.conversationId}`)
  assert.equal((await resolve(x, 'manual')).resolution, 'HOME')
}
async function invalidStateReferenceHomes() {
  const serviceId = key('inactive-service')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id","businessId","name","duration","isBookable") VALUES (${serviceId},${ids.business},'F10.4 service',30,true)`)
  const initial = { ...state.createInitialBotOptionsState(), cart: [{ serviceId }] }
  const x = await scenario('inactive-ref', initial)
  await prisma.$executeRaw(Prisma.sql`UPDATE "Service" SET "isBookable"=false WHERE "id"=${serviceId} AND "businessId"=${ids.business}`)
  assert.equal((await resolve(x, 'inactive-ref')).resolution, 'HOME')
}
async function aggregateInvalidationsHome() {
  for (const [tag, invalidate] of [
    ['visit', async () => prisma.$executeRaw(Prisma.sql`UPDATE "BookingVisit" SET "holdExpiresAt"=clock_timestamp()-interval '1 second' WHERE "sessionId"=${key('s-visit')}`)],
    ['deposit', async () => {
      const bytes = Buffer.from('f10.4 deposit proof'), hash = 'a'.repeat(64)
      await prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositProof" ("id","businessId","depositId","sequence","kind","validatorVersion","validatedAt","receivedAt","sourceData","sourceMimeType","sourceFilename","sourceByteSize","sourceSha256","derivedData","derivedMimeType","derivedByteSize","derivedSha256","retentionEligibleAt") SELECT ${key('proof-deposit')},"businessId","id",1,'INITIAL'::"BookingDepositProofKind",'f10.4-contract',clock_timestamp(),clock_timestamp(),${bytes},'image/png','proof.png',${bytes.length},${hash},${bytes},'image/png',${bytes.length},${hash},clock_timestamp()+interval '12 months' FROM "BookingDeposit" WHERE "conversationId"=${key('v-deposit')}`)
        await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "status"='PROOF_RECEIVED'::"BookingDepositStatus" WHERE "conversationId"=${key('v-deposit')}`)
      })
    }],
    ['appointment', async () => prisma.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "status"='CANCELLED'::"AppointmentStatus" WHERE "visitId"=(SELECT "id" FROM "BookingVisit" WHERE "sessionId"=${key('s-appointment')})`)]
  ] as const) {
    const held = await heldStateWithAggregate(tag); const x = await scenario(tag, held.current, held.seed); await invalidate()
    assert.equal((await resolve(x, tag)).resolution, 'HOME', `${tag} invalidation cannot revive the paused flow`)
  }
}
async function heldStateWithAggregate(tag: string) {
  const serviceId = key(`service-${tag}`), professionalId = key(`professional-${tag}`), customerId = key(`customer-${tag}`), visitId = key(`visit-${tag}`), appointmentId = key(`appointment-${tag}`), depositId = key(`deposit-${tag}`), sessionId = key(`s-${tag}`), conversationId = key(`v-${tag}`)
  const base = state.createInitialBotOptionsState()
  const current = {
    ...base,
    flow: 'DEPOSIT_INSTRUCTIONS' as const,
    booking: 'HELD' as const,
    deposit: 'PENDING_PROOF' as const,
    cart: [{ serviceId }],
    selections: {
      ...base.selections,
      professionalId,
      date: '2030-01-01',
      slotStartAt: '2030-01-01T10:00:00.000Z'
    }
  }
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id","businessId","name","duration","isBookable") VALUES (${serviceId},${ids.business},${key(`service-name-${tag}`)},30,true)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id","businessId","name","isActive","acceptsBotBookings") VALUES (${professionalId},${ids.business},${key(`professional-name-${tag}`)},true,true)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id","businessId","name","phone") VALUES (${customerId},${ids.business},'F10.4 customer',${key(`customer-phone-${tag}`)})`)
  })
  return { current, seed: async ({ conversationId: actualConversationId, sessionId: actualSessionId }: { conversationId: string; sessionId: string }) => {
    assert.equal(actualConversationId, conversationId); assert.equal(actualSessionId, sessionId)
    await prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingVisit" ("id","businessId","customerId","professionalId","sessionId","status","scheduledStartAt","totalDurationMinutes","holdExpiresAt","updatedAt") VALUES (${visitId},${ids.business},${customerId},${professionalId},${sessionId},'HELD'::"BookingVisitStatus",clock_timestamp()+interval '2 days',30,clock_timestamp()+interval '1 day',clock_timestamp())`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id","customerId","professionalId","serviceId","startAt","totalDurationMinutes","status","visitId") VALUES (${appointmentId},${customerId},${professionalId},${serviceId},clock_timestamp()+interval '2 days',30,'PENDING'::"AppointmentStatus",${visitId})`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "AppointmentServiceItem" ("appointmentId","serviceId","sortOrder","durationMinutes","price") VALUES (${appointmentId},${serviceId},0,30,1)`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDeposit" ("id","businessId","appointmentId","conversationId","visitId","mode","configuredValue","amount","status","expiresAt","updatedAt") VALUES (${depositId},${ids.business},${appointmentId},${conversationId},${visitId},'FIXED'::"ServiceDepositMode",1,1,'PENDING_PROOF'::"BookingDepositStatus",clock_timestamp()+interval '1 day',clock_timestamp())`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO "BookingDepositLine" ("id","businessId","depositId","serviceId","sortOrder","serviceName","mode","configuredValue","baseAmount","amount") VALUES (${key(`deposit-line-${tag}`)},${ids.business},${depositId},${serviceId},0,${key(`service-name-${tag}`)},'FIXED'::"ServiceDepositMode",1,NULL,1)`)
      await tx.$executeRaw(Prisma.sql`UPDATE "BookingDeposit" SET "snapshotSealedAt"=clock_timestamp(),"updatedAt"=clock_timestamp() WHERE "id"=${depositId} AND "businessId"=${ids.business}`)
    })
  } }
}
async function crossTenantReferenceHomes() {
  const otherCustomer = key('other-customer'), otherProfessional = key('other-professional'), otherService = key('other-service'), appointmentId = key('other-appointment')
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id","businessId","name","phone") VALUES (${otherCustomer},${ids.other},'other',${key('other-phone')})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id","businessId","name") VALUES (${otherProfessional},${ids.other},'other')`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id","businessId","name","duration") VALUES (${otherService},${ids.other},'other',30)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id","customerId","professionalId","serviceId","startAt","totalDurationMinutes") VALUES (${appointmentId},${otherCustomer},${otherProfessional},${otherService},clock_timestamp()+interval '1 day',30)`)
  })
  const initial = { ...state.createInitialBotOptionsState(), selections: { ...state.createInitialBotOptionsState().selections, appointmentId } }
  const x = await scenario('cross-tenant', initial); assert.equal((await resolve(x, 'cross-tenant')).resolution, 'HOME')
}
async function samePhoneAppointmentCanResume() {
  const phone = '+54 9 11 2345-6789', normalizedPhone = '5491123456789'
  const appointmentId = await seedSelectedAppointment('same-phone', phone, normalizedPhone)
  const initial = { ...state.createInitialBotOptionsState(), selections: { ...state.createInitialBotOptionsState().selections, appointmentId } }
  const x = await scenario('same-phone', initial, async ({ conversationId }) => {
    await prisma.$executeRaw(Prisma.sql`UPDATE "Conversation" SET "phone"=${phone},"updatedAt"=clock_timestamp() WHERE "id"=${conversationId} AND "businessId"=${ids.business}`)
  })
  assert.equal((await resolve(x, 'same-phone')).resolution, 'HOME', 'manual attention always returns to the initial session')
}
async function reassignedAppointmentHomes() {
  const phone = '+54 9 11 3456-7890', normalizedPhone = '5491134567890'
  const appointmentId = await seedSelectedAppointment('reassigned', phone, normalizedPhone)
  const otherCustomer = key('reassigned-other-customer')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id","businessId","name","phone","normalizedPhone") VALUES (${otherCustomer},${ids.business},'F10.4 other customer','5491198765432','5491198765432')`)
  const initial = { ...state.createInitialBotOptionsState(), selections: { ...state.createInitialBotOptionsState().selections, appointmentId } }
  const x = await scenario('reassigned', initial, async ({ conversationId }) => {
    await prisma.$executeRaw(Prisma.sql`UPDATE "Conversation" SET "phone"=${phone},"updatedAt"=clock_timestamp() WHERE "id"=${conversationId} AND "businessId"=${ids.business}`)
  })
  await prisma.$executeRaw(Prisma.sql`UPDATE "Appointment" SET "customerId"=${otherCustomer} WHERE "id"=${appointmentId}`)
  assert.equal((await resolve(x, 'reassigned')).resolution, 'HOME', 'a same-tenant appointment reassigned to another customer cannot resume this conversation')
}
async function seedSelectedAppointment(tag: string, phone: string, normalizedPhone: string) {
  const customerId = key(`selected-customer-${tag}`), professionalId = key(`selected-professional-${tag}`), serviceId = key(`selected-service-${tag}`), appointmentId = key(`selected-appointment-${tag}`)
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id","businessId","name","phone","normalizedPhone") VALUES (${customerId},${ids.business},'F10.4 selected customer',${phone},${normalizedPhone})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Professional" ("id","businessId","name") VALUES (${professionalId},${ids.business},${key(`selected-professional-name-${tag}`)})`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Service" ("id","businessId","name","duration") VALUES (${serviceId},${ids.business},${key(`selected-service-name-${tag}`)},30)`)
    await tx.$executeRaw(Prisma.sql`INSERT INTO "Appointment" ("id","customerId","professionalId","serviceId","startAt","totalDurationMinutes","status") VALUES (${appointmentId},${customerId},${professionalId},${serviceId},clock_timestamp()+interval '2 days',30,'CONFIRMED'::"AppointmentStatus")`)
  })
  return appointmentId
}
async function concurrentManualWins() {
  const x = await scenario('race')
  let locked!: () => void; const lockHeld = new Promise<void>(r => { locked = r })
  let release!: () => void; const releaseLock = new Promise<void>(r => { release = r })
  const manual = prisma.$transaction(async tx => { await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id"=${x.conversationId} FOR UPDATE`); locked(); await releaseLock; await tx.$executeRaw(Prisma.sql`UPDATE "Conversation" SET "lastMessage"='manual race',"updatedAt"=clock_timestamp() WHERE "id"=${x.conversationId}`) })
  await lockHeld; const pending = resolve(x, 'race'); release(); await manual
  assert.equal((await pending).resolution, 'HOME', 'resolve reads the committed manual write after waiting for its conversation lock')
}

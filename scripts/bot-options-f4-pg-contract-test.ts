import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const parsedSafetyUrl = new URL(SAFE_DATABASE_URL)
if (
  parsedSafetyUrl.protocol !== 'postgresql:' || parsedSafetyUrl.hostname !== '127.0.0.1' ||
  parsedSafetyUrl.port !== '54322' || parsedSafetyUrl.pathname !== '/salon_ai_test' ||
  parsedSafetyUrl.username !== 'postgres' || parsedSafetyUrl.password !== 'postgres'
) throw new Error('Refusing unsafe F4 PostgreSQL contract URL')
delete process.env.DATABASE_URL
process.env.DATABASE_URL = SAFE_DATABASE_URL
if (process.env.DATABASE_URL !== SAFE_DATABASE_URL) throw new Error('F4 PostgreSQL URL safety assignment failed')

const [{ createPrismaClient }, { Prisma }, worker, admissionModule, admissionRepository, outbox, dispatch, processor, promptTokens, reconciler, activation, metrics] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/application/admit-provider-events.js'),
  import('../src/bot-options/infrastructure/prisma-admission.js'),
  import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js'),
  import('../src/bot-options/infrastructure/dispatch-claims.js'),
  import('../src/bot-options/application/process-session-job.js'),
  import('../src/bot-options/domain/prompt-tokens.js'),
  import('../src/bot-options/application/reconcile-actions.js'),
  import('../src/bot-options/infrastructure/prisma-activation.js'),
  import('../src/bot-options/observability/metrics.js')
])

const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 6, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f4_b_${suffix}`
const configId = `f4_c_${suffix}`
const deploymentId = `f4_d_${suffix}`
const sessionId = `f4_s_${suffix}`
const conversationId = `f4_v_${suffix}`
const phoneNumberId = `f4_phone_${suffix}`
const secret = `f4_secret_${suffix}`
const otherBusinessId = `f4_other_b_${suffix}`
const otherConfigId = `f4_other_c_${suffix}`
const otherDeploymentId = `f4_other_d_${suffix}`
const otherSessionId = `f4_other_s_${suffix}`
const claimTestJob = () => worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId })
const claimTestOutbox = () => outbox.claimOutbox(prisma, 30_000, randomUUID(), { businessId })

try {
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BotSession_active_deployment_conversation_key"
    ON "BotSession"("deploymentId", "conversationId") WHERE "status" = 'ACTIVE' AND "conversationId" IS NOT NULL`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BotPrompt_open_functional_per_session_key"
    ON "BotPrompt"("sessionId") WHERE "status" IN ('OPEN', 'STABILIZING') AND "mode" = 'FUNCTIONAL'`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BotActionInbox_promptId_providerMessageId_key"
    ON "BotActionInbox"("promptId", "providerMessageId") WHERE "promptId" IS NOT NULL AND "providerMessageId" IS NOT NULL`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BotOutbox_providerMessageId_key"
    ON "BotOutbox"("providerMessageId") WHERE "providerMessageId" IS NOT NULL`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BotDispatchClaim_active_resource_key"
    ON "BotDispatchClaim"("kind", "engineKey", "resourceId")
    WHERE "resourceId" IS NOT NULL AND "status" IN ('CLAIMED', 'SENDING', 'UNKNOWN')`)
  const rollingShape = await prisma.$queryRaw<Array<{ leasedEnum: boolean; claimedEnum: boolean; jobLeaseColumns: bigint; renamedJobColumns: bigint }>>(Prisma.sql`
    SELECT
      EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'BotJobStatus' AND e.enumlabel = 'LEASED') AS "leasedEnum",
      EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'BotJobStatus' AND e.enumlabel = 'CLAIMED') AS "claimedEnum",
      (SELECT count(*)::bigint FROM information_schema.columns WHERE table_name = 'BotJob' AND column_name IN ('leaseToken', 'leasedUntil')) AS "jobLeaseColumns",
      (SELECT count(*)::bigint FROM information_schema.columns WHERE table_name = 'BotJob' AND column_name IN ('claimToken', 'claimedUntil')) AS "renamedJobColumns"
  `)
  assert.deepEqual(rollingShape[0], { leasedEnum: true, claimedEnum: false, jobLeaseColumns: 2n, renamedJobColumns: 0n },
    'new code must preserve old physical lease names during rolling deploy')
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${businessId}, ${`F4-${suffix}`}, 'F4 contract')`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotOptionsSettings" ("businessId", "timezone", "bookingHorizonDays", "bookingLeadTimeHours", "morningCutTime", "eveningCutTime")
    VALUES (${businessId}, 'UTC', 30, 0, '12:30', '16:30')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES (${configId}, ${businessId}, 'f4', 'F4', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessWhatsAppConfig" ("id", "businessId", "connectionStatus", "phoneNumberId", "appSecret", "updatedAt")
    VALUES (${`wa_${suffix}`}, ${businessId}, 'CONNECTED'::"WhatsAppConnectionStatus", ${phoneNumberId}, ${secret}, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "activeConfigurationId", "generation", "activatedAt", "updatedAt")
    VALUES (${deploymentId}, ${businessId}, ${configId}, 4, clock_timestamp(), clock_timestamp())
  `)

  const repository = new admissionRepository.PrismaAuthoritativeAdmissionRepository(prisma)
  assert.equal((await repository.resolveRoute(phoneNumberId)).kind, 'ambiguous', 'new routing is fail-closed until durable legacy coverage attestation')
  await activation.attestLegacyDispatchCoverage({ client: prisma, businessId, actorId: 'contract-test', protocolVersion: 1 })
  assert.equal((await repository.resolveRoute(phoneNumberId)).kind, 'new')
  await prisma.$executeRaw`UPDATE "BotChannelDeployment" SET "activeConfigurationId" = NULL WHERE "id" = ${deploymentId}`
  assert.equal((await repository.resolveRoute(phoneNumberId)).kind, 'legacy')
  await prisma.$executeRaw`UPDATE "BotChannelDeployment" SET "activeConfigurationId" = ${configId} WHERE "id" = ${deploymentId}`

  const webhook = admissionModule.createAuthoritativeWebhookAdmission(repository)
  const body = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: phoneNumberId },
    messages: [{ id: `wamid.${suffix}`, from: '5491100000000', timestamp: '1787700000', type: 'text', text: { body: 'hola' } }]
  } }] }] }), 'utf8')
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  assert.equal((await webhook.routeAndAdmit({ rawBody: body, signatureHeader: signature })).route, 'new')
  const retry = await webhook.routeAndAdmit({ rawBody: body, signatureHeader: signature })
  assert.deepEqual(retry, { route: 'new', outcome: { status: 'duplicate', eventCount: 1 } })
  const admittedCounts = await prisma.$queryRaw<Array<{ events: bigint; inbox: bigint; jobs: bigint }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BotProviderEvent" WHERE "eventKey" = ${`wamid.${suffix}`})::bigint AS events,
      (SELECT count(*) FROM "BotActionInbox" i JOIN "BotProviderEvent" e ON e."id" = i."providerEventId" WHERE e."eventKey" = ${`wamid.${suffix}`})::bigint AS inbox,
      (SELECT count(*) FROM "BotJob" j JOIN "BotActionInbox" i ON i."id" = j."aggregateId" JOIN "BotProviderEvent" e ON e."id" = i."providerEventId" WHERE e."eventKey" = ${`wamid.${suffix}`})::bigint AS jobs
  `)
  assert.deepEqual(admittedCounts[0], { events: 1n, inbox: 1n, jobs: 1n })

  const secondInitialBody = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: phoneNumberId },
    messages: [{ id: `wamid.initial2.${suffix}`, from: '5491100000000', timestamp: '1787700001', type: 'text', text: { body: 'hola otra vez' } }]
  } }] }] }), 'utf8')
  const secondInitialSignature = `sha256=${createHmac('sha256', secret).update(secondInitialBody).digest('hex')}`
  assert.equal((await webhook.routeAndAdmit({ rawBody: secondInitialBody, signatureHeader: secondInitialSignature })).route, 'new')
  const [initialJobA, initialJobB] = await Promise.all([claimTestJob(), claimTestJob()])
  assert.ok(initialJobA && initialJobB)
  assert.equal(initialJobA.kind, 'PROCESS_INBOX')
  assert.equal(initialJobB.kind, 'PROCESS_INBOX')
  await Promise.all([
    processor.processSessionJob({ client: prisma, job: initialJobA }),
    processor.processSessionJob({ client: prisma, job: initialJobB })
  ])
  assert.equal(await worker.completeBotJob(prisma, initialJobA.id, initialJobA.claimToken), false, 'handler commits job atomically')
  assert.equal(await worker.completeBotJob(prisma, initialJobB.id, initialJobB.claimToken), false, 'handler commits job atomically')
  const initialRace = await prisma.$queryRaw<Array<{ sessions: bigint; transitions: bigint }>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "BotSession" s JOIN "Conversation" c ON c."id" = s."conversationId"
        WHERE s."businessId" = ${businessId} AND c."phone" = '5491100000000')::bigint AS sessions,
      (SELECT count(*) FROM "BotTransitionLog" WHERE "businessId" = ${businessId} AND "actionType" = 'system.initial_view')::bigint AS transitions
  `)
  assert.deepEqual(initialRace[0], { sessions: 1n, transitions: 1n }, 'concurrent initial events must create one session/view')
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotTransitionLog" WHERE "businessId" = ${businessId} AND "actionType" = 'system.initial_view'`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${businessId} AND "conversationId" IN (SELECT "id" FROM "Conversation" WHERE "businessId" = ${businessId} AND "phone" = '5491100000000')`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "businessId" = ${businessId} AND "phone" = '5491100000000'`)

  const oldConversationId = `f4_old_v_${suffix}`
  const oldSessionId = `f4_old_s_${suffix}`
  const oldPromptId = `f4_old_p_${suffix}`
  const oldPromptToken = promptTokens.generatePromptToken()
  const oldChoiceToken = promptTokens.generateChoiceToken()
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
    VALUES (${oldConversationId}, '5491188888888', ${businessId}, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt")
    VALUES (${oldSessionId}, ${businessId}, ${oldConversationId}, ${deploymentId}, 3, 'America/Argentina/Buenos_Aires',
      ${JSON.stringify({ schemaVersion: 1, flow: 'MAIN_MENU', booking: 'NONE', deposit: 'NONE', handoff: 'NONE', cart: [], selections: { categoryId: null, professionalId: null, anyProfessional: false, date: null, slotStartAt: null, appointmentId: null }, invalidStreak: 0, presentation: { kind: 'plain' }, discardReturnFlow: null, handoffReturnFlow: null, catalogMode: 'BOOKING', nameCandidate: null, pendingEntityRef: null, rejectedRecommendationIds: [] })}::jsonb,
      7, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotPrompt" ("id", "sessionId", "promptToken", "stateRevision", "openedAt")
    VALUES (${oldPromptId}, ${oldSessionId}, ${oldPromptToken}, 7, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotPromptChoice" ("id", "promptId", "choiceToken", "actionType", "labelSnapshot")
    VALUES (${randomUUID()}, ${oldPromptId}, ${oldChoiceToken}, 'menu.booking.start', 'Reservar')
  `)
  const staleBody = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: phoneNumberId },
    messages: [{ id: `wamid.stale.${suffix}`, from: '5491188888888', timestamp: '1787700002', type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: promptTokens.buildInteractiveActionId(oldPromptToken, oldChoiceToken), title: 'Reservar' } } }]
  } }] }] }), 'utf8')
  const staleSignature = `sha256=${createHmac('sha256', secret).update(staleBody).digest('hex')}`
  assert.equal((await webhook.routeAndAdmit({ rawBody: staleBody, signatureHeader: staleSignature })).route, 'new')
  const recoveryJob = await claimTestJob()
  assert.ok(recoveryJob)
  assert.equal(recoveryJob.kind, 'RECOVER_CUTOVER')
  assert.equal(await processor.processSessionJob({ client: prisma, job: recoveryJob }), 'PROCESSED')
  assert.equal(await worker.completeBotJob(prisma, recoveryJob.id, recoveryJob.claimToken), false, 'recovery commits job atomically')
  const recoveredCutover = await prisma.$queryRaw<Array<{ generation: number; revision: bigint; stale: bigint; recovered: bigint; transitions: bigint }>>(Prisma.sql`
    SELECT s."deploymentGeneration" AS generation, s."revision",
      (SELECT count(*) FROM "BotActionInbox" WHERE "providerEventId" = ${recoveryJob.aggregateId} AND "status" = 'STALE_CUTOVER'::"BotInboxStatus")::bigint AS stale,
      (SELECT count(*) FROM "BotActionInbox" WHERE "providerEventId" = ${recoveryJob.aggregateId} AND "status" = 'PROCESSED'::"BotInboxStatus")::bigint AS recovered,
      (SELECT count(*) FROM "BotTransitionLog" WHERE "sessionId" = ${oldSessionId} AND "actionType" = 'system.cutover_recovery')::bigint AS transitions
    FROM "BotSession" s WHERE s."id" = ${oldSessionId}
  `)
  assert.deepEqual(recoveredCutover[0], { generation: 4, revision: 8n, stale: 1n, recovered: 1n, transitions: 1n })
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotTransitionLog" WHERE "sessionId" = ${oldSessionId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "id" = ${oldSessionId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id" = ${oldConversationId}`)

  const rollbackKey = `rollback_${suffix}`
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "BotProviderEvent" ("id", "eventKey", "eventType", "businessId")
      VALUES (${randomUUID()}, ${rollbackKey}, 'MESSAGE'::"BotProviderEventType", ${businessId})
    `)
    throw new Error('forced rollback')
  }))
  const rollbackRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "BotProviderEvent" WHERE "eventKey" = ${rollbackKey}`)
  assert.equal(rollbackRows[0]!.count, 0n)

  const jobA = `job_a_${suffix}`
  const jobB = `job_b_${suffix}`
  for (const id of [jobA, jobB]) {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "updatedAt")
      VALUES (${id}, 'PG_TEST', ${id}, ${businessId}, ${deploymentId}, 4, clock_timestamp())
    `)
  }
  const [claimA, claimB] = await Promise.all([claimTestJob(), claimTestJob()])
  assert.ok(claimA && claimB)
  assert.notEqual(claimA.id, claimB.id, 'SKIP LOCKED must give workers distinct jobs')
  assert.equal(await worker.completeBotJob(prisma, claimA.id, 'stale-token'), false)
  assert.equal(await worker.completeBotJob(prisma, claimA.id, claimA.claimToken), true)
  await prisma.$executeRaw`UPDATE "BotJob" SET "leasedUntil" = clock_timestamp() - interval '1 second' WHERE "id" = ${claimB.id}`
  const recovered = await claimTestJob()
  assert.equal(recovered?.id, claimB.id)
  assert.notEqual(recovered?.claimToken, claimB.claimToken)
  assert.ok(recovered)
  assert.equal(await worker.completeBotJob(prisma, recovered.id, recovered.claimToken), true)

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt") VALUES (${conversationId}, '5491199999999', ${businessId}, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "updatedAt")
    VALUES (${sessionId}, ${businessId}, ${conversationId}, ${deploymentId}, 4, 'America/Argentina/Buenos_Aires',
      ${JSON.stringify({ schemaVersion: 1, flow: 'MAIN_MENU', booking: 'NONE', deposit: 'NONE', handoff: 'NONE', cart: [], selections: { categoryId: null, professionalId: null, anyProfessional: false, date: null, slotStartAt: null, appointmentId: null }, invalidStreak: 0, presentation: { kind: 'plain' }, discardReturnFlow: null, handoffReturnFlow: null, catalogMode: 'BOOKING', nameCandidate: null, pendingEntityRef: null, rejectedRecommendationIds: [] })}::jsonb,
      clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES (${otherBusinessId}, ${`F4-OTHER-${suffix}`}, 'F4 other tenant')`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES (${otherConfigId}, ${otherBusinessId}, 'f4-other', 'F4 other', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "activeConfigurationId", "generation", "activatedAt", "updatedAt")
    VALUES (${otherDeploymentId}, ${otherBusinessId}, ${otherConfigId}, 4, clock_timestamp(), clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "updatedAt")
    VALUES (${otherSessionId}, ${otherBusinessId}, ${otherDeploymentId}, 4, 'America/Argentina/Buenos_Aires', '{}'::jsonb, clock_timestamp())
  `)
  const admittedEvent = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "BotProviderEvent" WHERE "businessId" = ${businessId} ORDER BY "admittedAt" LIMIT 1
  `)
  assert.ok(admittedEvent[0])
  await assert.rejects(prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "updatedAt")
    VALUES (${`cross_session_${suffix}`}, ${businessId}, ${otherDeploymentId}, 4, 'America/Argentina/Buenos_Aires', '{}'::jsonb, clock_timestamp())
  `), /foreign key|Foreign key/i)
  await assert.rejects(prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "sessionId", "deploymentId", "deploymentGeneration", "status")
    VALUES (${`cross_inbox_${suffix}`}, ${businessId}, ${admittedEvent[0]!.id}, ${otherSessionId}, ${deploymentId}, 4, 'ADMITTED'::"BotInboxStatus")
  `), /foreign key|Foreign key/i)
  await assert.rejects(prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload", "idempotencyKey", "updatedAt")
    VALUES (${`cross_outbox_${suffix}`}, ${otherBusinessId}, ${sessionId}, 'cross', 'cross', 0, 'text', '{}'::jsonb, ${`cross_idem_${suffix}`}, clock_timestamp())
  `), /foreign key|Foreign key/i)
  await assert.rejects(prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "updatedAt")
    VALUES (${`cross_job_${suffix}`}, 'PG_TEST', 'cross', ${businessId}, ${otherDeploymentId}, 4, clock_timestamp())
  `), /foreign key|Foreign key/i)
  const reconcilePromptId = `reconcile_p_${suffix}`
  const reconcileChoiceToken = promptTokens.generateChoiceToken()
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotPrompt" ("id", "sessionId", "promptToken", "stateRevision", "status", "openedAt", "firstActionAt", "lastActionAt", "settleAt", "absoluteAt")
    VALUES (${reconcilePromptId}, ${sessionId}, ${promptTokens.generatePromptToken()}, 0, 'STABILIZING'::"BotPromptStatus",
      clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '30 seconds', clock_timestamp() + interval '60 seconds')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotPromptChoice" ("id", "promptId", "choiceToken", "actionType", "labelSnapshot")
    VALUES (${randomUUID()}, ${reconcilePromptId}, ${reconcileChoiceToken}, 'menu.booking.start', 'Reservar')
  `)
  for (const ordinal of [1, 2]) {
    const eventId = `reconcile_e${ordinal}_${suffix}`
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "BotProviderEvent" ("id", "eventKey", "eventType", "businessId", "providerMessageId", "payload")
      VALUES (${eventId}, ${`reconcile_event_${ordinal}_${suffix}`}, 'MESSAGE'::"BotProviderEventType", ${businessId}, ${`reconcile_wamid_${ordinal}_${suffix}`}, '{}'::jsonb)
    `)
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "sessionId", "promptId", "providerMessageId", "choiceToken", "actionType",
        "deploymentId", "deploymentGeneration", "expectedRevision", "status")
      VALUES (${`reconcile_i${ordinal}_${suffix}`}, ${businessId}, ${eventId}, ${sessionId}, ${reconcilePromptId}, ${`reconcile_wamid_${ordinal}_${suffix}`},
        ${reconcileChoiceToken}, 'menu.booking.start', ${deploymentId}, 4, 0, 'ADMITTED'::"BotInboxStatus")
    `)
  }
  const reconcileJobId = `reconcile_j_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision", "updatedAt")
    VALUES (${reconcileJobId}, 'RECONCILE_PROMPT', ${reconcilePromptId}, ${businessId}, ${deploymentId}, 4, 0, clock_timestamp())
  `)
  const earlyReconcileJob = await claimTestJob()
  assert.equal(earlyReconcileJob?.id, reconcileJobId)
  assert.ok(earlyReconcileJob)
  assert.equal(await reconciler.reconcileActions(prisma, earlyReconcileJob), 'NOT_READY')
  const rescheduled = await prisma.$queryRaw<Array<{ status: string; claimToken: string | null }>>(Prisma.sql`
    SELECT "status"::text AS status, "leaseToken" AS "claimToken" FROM "BotJob" WHERE "id" = ${reconcileJobId}
  `)
  assert.deepEqual(rescheduled[0], { status: 'READY', claimToken: null })
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotPrompt" SET "settleAt" = clock_timestamp() - interval '1 millisecond', "absoluteAt" = clock_timestamp() + interval '30 seconds'
    WHERE "id" = ${reconcilePromptId}
  `)
  await prisma.$executeRaw(Prisma.sql`UPDATE "BotJob" SET "availableAt" = clock_timestamp() WHERE "id" = ${reconcileJobId}`)
  const dueReconcileJob = await claimTestJob()
  assert.equal(dueReconcileJob?.id, reconcileJobId)
  assert.ok(dueReconcileJob)
  assert.equal(await reconciler.reconcileActions(prisma, dueReconcileJob), 'SELECT')
  assert.equal(await worker.completeBotJob(prisma, dueReconcileJob.id, dueReconcileJob.claimToken), false, 'reconcile commits job atomically')
  const reconciledStatuses = await prisma.$queryRaw<Array<{ status: string; count: bigint }>>(Prisma.sql`
    SELECT "status"::text AS status, count(*)::bigint AS count FROM "BotActionInbox"
    WHERE "promptId" = ${reconcilePromptId} GROUP BY "status" ORDER BY "status"
  `)
  assert.deepEqual(reconciledStatuses, [{ status: 'DUPLICATE', count: 1n }, { status: 'SELECTED', count: 1n }])
  const processJob = await claimTestJob()
  assert.equal(processJob?.kind, 'PROCESS_SESSION')
  assert.ok(processJob)
  assert.equal(await processor.processSessionJob({ client: prisma, job: processJob }), 'PROCESSED')
  assert.equal(await worker.completeBotJob(prisma, processJob.id, processJob.claimToken), false, 'transition commits job atomically')
  const processedTransition = await prisma.$queryRaw<Array<{ revision: bigint; processed: bigint }>>(Prisma.sql`
    SELECT s."revision", (SELECT count(*) FROM "BotActionInbox" WHERE "promptId" = ${reconcilePromptId} AND "status" = 'PROCESSED'::"BotInboxStatus")::bigint AS processed
    FROM "BotSession" s WHERE s."id" = ${sessionId}
  `)
  assert.deepEqual(processedTransition[0], { revision: 1n, processed: 1n })
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "sessionId" = ${sessionId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotPrompt" WHERE "sessionId" = ${sessionId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotTransitionLog" WHERE "sessionId" = ${sessionId}`)
  const group = `group_${suffix}`
  const firstOutbox = `out_a_${suffix}`
  const secondOutbox = `out_b_${suffix}`
  for (const [id, sequence, dependency] of [[firstOutbox, 0, null], [secondOutbox, 1, 0]] as const) {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload", "idempotencyKey", "dependsOnSequence", "updatedAt")
      VALUES (${id}, ${businessId}, ${sessionId}, ${`transition_${suffix}`}, ${group}, ${sequence}, 'informative_text', ${JSON.stringify({ to: '5491199999999', item: { type: 'informative_text', body: String(sequence) } })}::jsonb,
        ${`idem_${id}`}, ${dependency}, clock_timestamp())
    `)
  }
  const firstClaim = await claimTestOutbox()
  assert.equal(firstClaim?.id, firstOutbox)
  const noneWhileBlocked = await claimTestOutbox()
  assert.equal(noneWhileBlocked, null)
  assert.ok(firstClaim)
  const accepted = await outbox.sendClaimedOutbox({
    client: prisma, item: firstClaim,
    provider: { async send() { return { kind: 'accepted', providerMessageId: `provider_${suffix}` } } }
  })
  assert.equal(accepted, 'ACCEPTED')
  const dependencyClaim = await claimTestOutbox()
  assert.equal(dependencyClaim?.id, secondOutbox)
  assert.ok(dependencyClaim)
  await prisma.$executeRaw`UPDATE "BotOutbox" SET "leasedUntil" = clock_timestamp() - interval '1 second' WHERE "id" = ${secondOutbox}`
  const reclaimedDependency = await claimTestOutbox()
  assert.equal(reclaimedDependency?.id, secondOutbox)
  assert.notEqual(reclaimedDependency?.claimToken, dependencyClaim.claimToken, 'expired CLAIMED outbox must be reclaimable')

  await prisma.$executeRaw`UPDATE "BotOutbox" SET "status" = 'PENDING'::"BotOutboxStatus", "leaseToken" = NULL, "leasedUntil" = NULL, "dependsOnSequence" = NULL WHERE "id" = ${secondOutbox}`
  const timeoutClaim = await claimTestOutbox()
  assert.equal(timeoutClaim?.id, secondOutbox)
  assert.ok(timeoutClaim)
  assert.equal(await outbox.sendClaimedOutbox({
    client: prisma, item: timeoutClaim, timeoutMs: 5,
    provider: { async send() { return new Promise(() => {}) } }
  }), 'UNKNOWN')
  assert.equal(await claimTestOutbox(), null, 'UNKNOWN must never auto-retry')
  await assert.rejects(dispatch.assertActivationGate({ client: prisma, businessId, legacyCoverageComplete: false }), /coverage incomplete/)
  await assert.rejects(dispatch.assertActivationGate({ client: prisma, businessId, legacyCoverageComplete: true }), /UNKNOWN/)

  await prisma.$transaction(async (tx) => {
    await admissionRepository.applyStatusCallbackTx(tx, businessId, `provider_${suffix}`, 'read', null)
    await admissionRepository.applyStatusCallbackTx(tx, businessId, `provider_${suffix}`, 'sent', null)
  })
  const monotonic = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "BotOutbox" WHERE "id" = ${firstOutbox}`)
  assert.equal(monotonic[0]!.status, 'READ')
  const resolution = await outbox.resolveUnknownOutbox({ client: prisma, outboxId: secondOutbox, type: 'SKIP', actorId: 'contract-test', reason: 'known test timeout' })
  assert.equal(resolution, secondOutbox)
  await dispatch.assertActivationGate({ client: prisma, businessId, legacyCoverageComplete: true })
  const audit = await prisma.$queryRaw<Array<{ type: string }>>(Prisma.sql`SELECT "type" FROM "BotOutboxResolution" WHERE "outboxId" = ${secondOutbox}`)
  assert.deepEqual(audit.map((row) => row.type), ['SKIP'])

  const staleSendingId = `out_stale_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload", "idempotencyKey", "updatedAt")
    VALUES (${staleSendingId}, ${businessId}, ${sessionId}, ${`stale_transition_${suffix}`}, ${`stale_group_${suffix}`}, 0,
      'informative_text', '{}'::jsonb, ${`idem_${staleSendingId}`}, clock_timestamp())
  `)
  const staleSendingClaim = await claimTestOutbox()
  assert.equal(staleSendingClaim?.id, staleSendingId)
  assert.ok(staleSendingClaim)
  const staleDispatchToken = await dispatch.acquireDispatchClaim({
    client: prisma, businessId, sessionId, resourceId: staleSendingId, generation: 4, fenceEpoch: 0, kind: 'SEND'
  })
  assert.ok(staleDispatchToken)
  assert.equal(await dispatch.advanceDispatchClaim(prisma, staleDispatchToken, 'SENDING'), true)
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "BotOutbox" SET "status" = 'SENDING'::"BotOutboxStatus", "leasedUntil" = clock_timestamp() - interval '1 second'
    WHERE "id" = ${staleSendingId}
  `)
  assert.equal(await claimTestOutbox(), null)
  const staleStates = await prisma.$queryRaw<Array<{ outbox: string; dispatch: string }>>(Prisma.sql`
    SELECT o."status"::text AS outbox, c."status"::text AS dispatch
    FROM "BotOutbox" o JOIN "BotDispatchClaim" c ON c."resourceId" = o."id" AND c."claimToken" = ${staleDispatchToken}
    WHERE o."id" = ${staleSendingId}
  `)
  assert.deepEqual(staleStates[0], { outbox: 'UNKNOWN', dispatch: 'UNKNOWN' })
  await outbox.resolveUnknownOutbox({ client: prisma, outboxId: staleSendingId, type: 'SKIP', actorId: 'contract-test', reason: 'stale sender lease' })

  const exhaustedId = `out_exhausted_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload", "idempotencyKey", "attempts", "maxAttempts", "updatedAt")
    VALUES (${exhaustedId}, ${businessId}, ${sessionId}, ${`exhausted_transition_${suffix}`}, ${`exhausted_group_${suffix}`}, 0,
      'informative_text', '{}'::jsonb, ${`idem_${exhaustedId}`}, 5, 5, clock_timestamp())
  `)
  assert.equal(await claimTestOutbox(), null)
  const exhausted = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT "status"::text AS status FROM "BotOutbox" WHERE "id" = ${exhaustedId}`)
  assert.equal(exhausted[0]!.status, 'POISON')

  const inFlightId = `out_inflight_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload", "idempotencyKey", "updatedAt")
    VALUES (${inFlightId}, ${businessId}, ${sessionId}, ${`inflight_transition_${suffix}`}, ${`inflight_group_${suffix}`}, 0,
      'informative_text', '{}'::jsonb, ${`idem_${inFlightId}`}, clock_timestamp())
  `)
  const inFlightClaim = await claimTestOutbox()
  assert.equal(inFlightClaim?.id, inFlightId)
  assert.ok(inFlightClaim)
  let signalProviderStarted!: () => void
  const providerStarted = new Promise<void>((resolve) => { signalProviderStarted = resolve })
  const inFlightSend = outbox.sendClaimedOutbox({
    client: prisma, item: inFlightClaim, timeoutMs: 25,
    provider: { async send() { signalProviderStarted(); return new Promise(() => {}) } }
  })
  await providerStarted
  const pauseHandle = await activation.pauseDispatchScope({
    client: prisma, businessId, expectedGeneration: 4, actorId: 'contract-test', legacyCoverageComplete: true
  })
  const liveDrain = await activation.waitForDispatchQuiescence({ client: prisma, handle: pauseHandle, timeoutMs: 0 })
  assert.equal(liveDrain.kind, 'TIMEOUT', 'live SENDING must block quiescence')
  assert.equal(await inFlightSend, 'UNKNOWN')
  const unknownDrain = await activation.waitForDispatchQuiescence({ client: prisma, handle: pauseHandle, timeoutMs: 0 })
  assert.equal(unknownDrain.kind, 'BLOCKED_UNKNOWN', 'ambiguous Meta send must block quiescence')
  await outbox.resolveUnknownOutbox({ client: prisma, outboxId: inFlightId, type: 'SKIP', actorId: 'contract-test', reason: 'quiescence contract' })

  const pausedPendingId = `out_paused_${suffix}`
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotOutbox" ("id", "businessId", "sessionId", "transitionId", "deliveryGroupId", "sequence", "kind", "payload", "idempotencyKey", "updatedAt")
    VALUES (${pausedPendingId}, ${businessId}, ${sessionId}, ${`paused_transition_${suffix}`}, ${`paused_group_${suffix}`}, 0,
      'informative_text', '{}'::jsonb, ${`idem_${pausedPendingId}`}, clock_timestamp())
  `)
  assert.equal(await claimTestOutbox(), null, 'paused scope must suppress new sender claims')
  const drained = await activation.waitForDispatchQuiescence({ client: prisma, handle: pauseHandle, timeoutMs: 0 })
  assert.equal(drained.kind, 'QUIESCENT')
  await activation.resumeDispatchScope({ client: prisma, handle: pauseHandle, actorId: 'contract-test' })
  assert.equal((await claimTestOutbox())?.id, pausedPendingId, 'resume under same generation/fence permits fresh claims')

  const metricsSnapshot = await metrics.collectBotOptionsOperationalMetrics(prisma)
  assert.ok(metricsSnapshot.durations.webhook_ack.count >= 1)
  assert.ok(metricsSnapshot.durations.admitted_to_claim.count >= 1)
  assert.ok(metricsSnapshot.durations.transition_execution.count >= 1)
  assert.ok(metricsSnapshot.durations.outbox_wait.count >= 1)
  assert.ok(metricsSnapshot.durations.meta_request.count >= 1)
  assert.ok(metricsSnapshot.durations.dispatch_quiescence.count >= 1)
  assert.ok(metricsSnapshot.gauges.poisonOutbox >= 1)
  assert.ok(metricsSnapshot.alerts.includes('bot_outbox_poison'))

  console.log('OK F4 PG: admission/races/cutover recovery, atomic leases/fencing, quiescence, ordered outbox, UNKNOWN and callbacks.')
} finally {
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutboxResolution" WHERE "outboxId" IN (SELECT "id" FROM "BotOutbox" WHERE "businessId" = ${businessId})`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotDispatchClaim" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotActionInbox" WHERE "providerEventId" IN (SELECT "id" FROM "BotProviderEvent" WHERE "businessId" = ${businessId})`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotProviderEvent" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotTransitionLog" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotDeploymentAudit" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessWhatsAppConfig" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "id" = ${otherSessionId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "id" = ${otherDeploymentId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "id" = ${otherConfigId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${otherBusinessId}`)
  await prisma.$disconnect()
}

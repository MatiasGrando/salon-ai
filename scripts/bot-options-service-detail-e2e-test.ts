import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolveF10PgContractDatabase } from './f10-pg-contract-database.js'

const SAFE_DATABASE_URL = resolveF10PgContractDatabase('F5.5/F10 handoff E2E')

const [{ createPrismaClient }, { Prisma }, processor, promptTokens, activation, handoffExecutor] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/process-session-job.js'),
  import('../src/bot-options/domain/prompt-tokens.js'),
  import('../src/bot-options/infrastructure/prisma-activation.js'),
  import('../src/bot-options/infrastructure/prisma-handoff-effect-executor.js')
])

const prisma = createPrismaClient({
  connectionString: SAFE_DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 3000
})
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f55_b_${suffix}`
const otherBusinessId = `f55_ob_${suffix}`
const configurationId = `f55_cfg_${suffix}`
const deploymentId = `f55_dep_${suffix}`
const categoryId = `f55_cat_${suffix}`
const otherCategoryId = `f55_ocat_${suffix}`
const reservableServiceId = `f55_res_${suffix}`
const deactivatedServiceId = `f55_off_${suffix}`
const consultServiceId = `f55_consult_${suffix}`
const crossTenantServiceId = `f55_cross_${suffix}`

const sessionIds: string[] = []
const conversationIds: string[] = []

function serviceDetailState(serviceId: string) {
  return {
    schemaVersion: 1,
    flow: 'SERVICE_DETAIL',
    booking: 'NONE',
    deposit: 'NONE',
    handoff: 'NONE',
    cart: [],
    selections: {
      categoryId: null,
      professionalId: null,
      anyProfessional: false,
      date: null,
      slotStartAt: null,
      appointmentId: null
    },
    invalidStreak: 0,
    presentation: { kind: 'plain' },
    discardReturnFlow: null,
    handoffReturnFlow: null,
    catalogMode: 'BOOKING',
    nameCandidate: null,
    pendingEntityRef: { type: 'SERVICE', id: serviceId },
    rejectedRecommendationIds: []
  }
}

async function processDetailClick(input: {
  label: string
  serviceId: string
  actionType: 'service.book' | 'service.consult'
  beforeProcess?: () => Promise<void>
}) {
  const sessionId = `f55_session_${input.label}_${suffix}`
  const conversationId = `f55_conversation_${input.label}_${suffix}`
  const promptId = `f55_prompt_${input.label}_${suffix}`
  const eventId = `f55_event_${input.label}_${suffix}`
  const inboxId = `f55_inbox_${input.label}_${suffix}`
  const jobId = `f55_job_${input.label}_${suffix}`
  const choiceToken = promptTokens.generateChoiceToken()
  sessionIds.push(sessionId)
  conversationIds.push(conversationId)

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
    VALUES (${conversationId}, ${`54911${sessionIds.length.toString().padStart(8, '0')}`}, ${businessId}, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration",
      "businessTimezone", "state", "revision", "updatedAt")
    VALUES (${sessionId}, ${businessId}, ${conversationId}, ${deploymentId}, 1,
      'America/Argentina/Buenos_Aires', ${JSON.stringify(serviceDetailState(input.serviceId))}::jsonb, 0, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotPrompt" ("id", "sessionId", "promptToken", "stateRevision", "status", "openedAt")
    VALUES (${promptId}, ${sessionId}, ${promptTokens.generatePromptToken()}, 0, 'OPEN'::"BotPromptStatus", clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotPromptChoice" ("id", "promptId", "choiceToken", "actionType", "entityType", "entityId", "labelSnapshot")
    VALUES (${randomUUID()}, ${promptId}, ${choiceToken}, ${input.actionType}, 'SERVICE', ${input.serviceId}, ${input.actionType})
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotProviderEvent" ("id", "eventKey", "eventType", "businessId", "providerMessageId", "payload")
    VALUES (${eventId}, ${`f55_event_key_${input.label}_${suffix}`}, 'MESSAGE'::"BotProviderEventType", ${businessId},
      ${`wamid.f55.${input.label}.${suffix}`}, '{}'::jsonb)
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "sessionId", "promptId", "providerMessageId",
      "choiceToken", "actionType", "entityRef", "deploymentId", "deploymentGeneration", "expectedRevision", "status")
    VALUES (${inboxId}, ${businessId}, ${eventId}, ${sessionId}, ${promptId}, ${`wamid.f55.${input.label}.${suffix}`},
      ${choiceToken}, ${input.actionType}, ${JSON.stringify({ type: 'SERVICE', id: input.serviceId })}::jsonb,
      ${deploymentId}, 1, 0, 'SELECTED'::"BotInboxStatus")
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision", "updatedAt")
    VALUES (${jobId}, 'PROCESS_SESSION', ${inboxId}, ${businessId}, ${deploymentId}, 1, 0, clock_timestamp())
  `)

  if (input.beforeProcess) await input.beforeProcess()
  const claimToken = randomUUID()
  const claimedRows = await prisma.$queryRaw<Array<{
    id: string
    kind: string
    aggregateId: string
    businessId: string
    deploymentId: string
    deploymentGeneration: number
    expectedRevision: bigint | null
    attempts: number
    maxAttempts: number
    claimToken: string
    claimedUntil: Date
    queueWaitMs: number
  }>>(Prisma.sql`
    UPDATE "BotJob" SET "status" = 'LEASED'::"BotJobStatus", "attempts" = "attempts" + 1,
      "leaseToken" = ${claimToken}, "leasedUntil" = clock_timestamp() + interval '30 seconds', "updatedAt" = clock_timestamp()
    WHERE "id" = ${jobId} AND "status" = 'READY'::"BotJobStatus"
    RETURNING "id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision",
      "attempts", "maxAttempts", "leaseToken" AS "claimToken", "leasedUntil" AS "claimedUntil", 0::double precision AS "queueWaitMs"
  `)
  const claimed = claimedRows[0]
  assert.ok(claimed, `${input.label}: exact PROCESS_SESSION job must be claimable`)
  assert.equal(await processor.processSessionJob({ client: prisma, job: claimed }), 'PROCESSED')
  return { sessionId, inboxId, jobId, operationKey: `transition:${sessionId}:1` }
}

try {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Business" ("id", "customerCode", "name")
    VALUES (${businessId}, ${`F55-${suffix}`}, 'F5.5 E2E')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Business" ("id", "customerCode", "name")
    VALUES (${otherBusinessId}, ${`F55-OTHER-${suffix}`}, 'F5.5 other tenant')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES (${configurationId}, ${businessId}, 'deterministic-options', 'Deterministic options', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation",
      "legacyDispatchCoverageVersion", "activatedAt", "updatedAt")
    VALUES (${deploymentId}, ${businessId}, 'deterministic-options', ${configurationId}, 1, 1, clock_timestamp(), clock_timestamp())
  `)
  await activation.attestLegacyDispatchCoverage({ client: prisma, businessId, actorId: 'f55-e2e', protocolVersion: 1 })

  await prisma.serviceCategory.createMany({ data: [
    { id: categoryId, businessId, name: `F55 ${suffix}`, sortOrder: 0, isActive: true },
    { id: otherCategoryId, businessId: otherBusinessId, name: `F55 other ${suffix}`, sortOrder: 0, isActive: true }
  ] })
  await prisma.service.createMany({ data: [
    {
      id: reservableServiceId, businessId, catalogCategoryId: categoryId, name: `Corte ${suffix}`,
      duration: 30, price: 1500, isBookable: true, attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: true, sortOrder: 0
    },
    {
      id: deactivatedServiceId, businessId, catalogCategoryId: categoryId, name: `Peinado ${suffix}`,
      duration: 45, price: 2000, isBookable: true, attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: true, sortOrder: 1
    },
    {
      id: consultServiceId, businessId, catalogCategoryId: categoryId, name: `Coloración ${suffix}`,
      duration: 60, price: null, isBookable: true, attentionMode: 'GUIDED_ESTIMATE', estimateAllowsBooking: false, sortOrder: 2
    },
    {
      id: crossTenantServiceId, businessId: otherBusinessId, catalogCategoryId: otherCategoryId, name: `Ajeno ${suffix}`,
      duration: 30, price: 999, isBookable: true, attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: true, sortOrder: 0
    }
  ] })

  const reservable = await processDetailClick({ label: 'reservable', serviceId: reservableServiceId, actionType: 'service.book' })
  const reservableRows = await prisma.$queryRaw<Array<{ flow: string; pending: unknown }>>(Prisma.sql`
    SELECT "state"->>'flow' AS "flow", "state"->'pendingEntityRef' AS "pending"
    FROM "BotSession" WHERE "id" = ${reservable.sessionId}
  `)
  assert.equal(reservableRows[0]!.flow, 'NAME_INPUT')
  assert.deepEqual(reservableRows[0]!.pending, { type: 'SERVICE', id: reservableServiceId })

  const deactivated = await processDetailClick({
    label: 'deactivated',
    serviceId: deactivatedServiceId,
    actionType: 'service.book',
    beforeProcess: async () => {
      await prisma.service.update({ where: { id: deactivatedServiceId }, data: { isBookable: false } })
    }
  })
  const deactivatedRows = await prisma.$queryRaw<Array<{ flow: string; cart: unknown }>>(Prisma.sql`
    SELECT "state"->>'flow' AS "flow", "state"->'cart' AS "cart"
    FROM "BotSession" WHERE "id" = ${deactivated.sessionId}
  `)
  assert.equal(deactivatedRows[0]!.flow, 'SERVICE_DETAIL')
  assert.deepEqual(deactivatedRows[0]!.cart, [])
  const deactivatedLog = await prisma.$queryRaw<Array<{ outcome: string }>>(Prisma.sql`
    SELECT "outcome" FROM "BotTransitionLog" WHERE "sessionId" = ${deactivated.sessionId}
  `)
  assert.equal(deactivatedLog[0]!.outcome, 'RECOVERED')

  const crossTenant = await processDetailClick({ label: 'cross', serviceId: crossTenantServiceId, actionType: 'service.book' })
  const crossRows = await prisma.$queryRaw<Array<{ flow: string; cart: unknown }>>(Prisma.sql`
    SELECT "state"->>'flow' AS "flow", "state"->'cart' AS "cart"
    FROM "BotSession" WHERE "id" = ${crossTenant.sessionId}
  `)
  assert.equal(crossRows[0]!.flow, 'SERVICE_DETAIL')
  assert.deepEqual(crossRows[0]!.cart, [])

  const consult = await processDetailClick({ label: 'consult', serviceId: consultServiceId, actionType: 'service.consult' })
  const consultRows = await prisma.$queryRaw<Array<{ status: string; flow: string; handoff: string }>>(Prisma.sql`
    SELECT "status"::text AS "status", "state"->>'flow' AS "flow", "state"->>'handoff' AS "handoff"
    FROM "BotSession" WHERE "id" = ${consult.sessionId}
  `)
  assert.deepEqual(consultRows[0], { status: 'HUMAN_QUEUED', flow: 'HANDOFF_QUEUED', handoff: 'QUEUED' })
  const consultAudit = await prisma.$queryRaw<Array<{ outcome: string; detail: unknown }>>(Prisma.sql`
    SELECT "outcome", "detail" FROM "BotTransitionLog" WHERE "sessionId" = ${consult.sessionId}
  `)
  assert.equal(consultAudit[0]!.outcome, 'HANDOFF')
  assert.deepEqual(consultAudit[0]!.detail, {
    handoff: {
      kind: 'REQUEST_HUMAN_HANDOFF',
      reason: 'servicio_requiere_consulta_previa',
      detail: `Coloración ${suffix}`,
      context: { serviceId: consultServiceId }
    }
  })
  const operationRows = await prisma.$queryRaw<Array<{ status: string; type: string; requestHash: string; resultRef: string | null }>>(Prisma.sql`
    SELECT "status", "type", "requestHash", "resultRef" FROM "BotOperation"
    WHERE "operationKey" = ${`${consult.operationKey}:REQUEST_HUMAN_HANDOFF`}
  `)
  assert.equal(operationRows.length, 1)
  assert.equal(operationRows[0]!.status, 'COMPLETED')
  assert.equal(operationRows[0]!.type, 'REQUEST_HUMAN_HANDOFF')
  assert.match(operationRows[0]!.requestHash, /^[a-f0-9]{64}$/)
  assert.ok(operationRows[0]!.resultRef, 'handoff operation must reference its durable queue row')
  const durableHandoff = await prisma.$queryRaw<Array<{ id: string; status: string; reason: string; detail: string | null; context: unknown }>>(Prisma.sql`
    SELECT "id", "status"::text AS "status", "reason", "detail", "context"
    FROM "BotHandoff"
    WHERE "id" = ${operationRows[0]!.resultRef} AND "businessId" = ${businessId} AND "sessionId" = ${consult.sessionId}
  `)
  assert.deepEqual(durableHandoff, [{
    id: operationRows[0]!.resultRef,
    status: 'QUEUED',
    reason: 'servicio_requiere_consulta_previa',
    detail: `Coloración ${suffix}`,
    context: { serviceId: consultServiceId }
  }])

  const handoffEffect = {
    kind: 'REQUEST_HUMAN_HANDOFF' as const,
    reason: 'servicio_requiere_consulta_previa',
    detail: `Coloración ${suffix}`,
    context: { serviceId: consultServiceId }
  }
  await prisma.$transaction((tx) => handoffExecutor.prismaHandoffEffectExecutor(tx, {
    businessId,
    sessionId: consult.sessionId,
    operationKey: consult.operationKey,
    effects: [handoffEffect]
  }))
  const replayCount = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS "count" FROM "BotOperation"
    WHERE "sessionId" = ${consult.sessionId} AND "type" = 'REQUEST_HUMAN_HANDOFF'
  `)
  assert.equal(replayCount[0]!.count, 1n, 'idempotent replay must not duplicate handoff operations')
  const replayHandoffCount = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS "count" FROM "BotHandoff"
    WHERE "businessId" = ${businessId} AND "sessionId" = ${consult.sessionId}
  `)
  assert.equal(replayHandoffCount[0]!.count, 1n, 'idempotent replay must not duplicate durable handoff rows')
  const conflictingOperationKey = `${consult.operationKey}:conflict`
  await assert.rejects(
    prisma.$transaction((tx) => handoffExecutor.prismaHandoffEffectExecutor(tx, {
      businessId,
      sessionId: consult.sessionId,
      operationKey: conflictingOperationKey,
      effects: [handoffEffect]
    })),
    /cannot queue handoff from session status HUMAN_QUEUED/,
    'a distinct request must not create a second active handoff'
  )
  const rolledBackConflict = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS "count" FROM "BotOperation"
    WHERE "operationKey" = ${`${conflictingOperationKey}:REQUEST_HUMAN_HANDOFF`}
  `)
  assert.equal(rolledBackConflict[0]!.count, 0n, 'rejected duplicate request must roll back its STARTED operation')
  const consultInbox = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status"::text AS "status" FROM "BotActionInbox" WHERE "id" = ${consult.inboxId}
  `)
  assert.equal(consultInbox[0]!.status, 'PROCESSED', 'handoff transaction must not roll back')

  console.log('OK F5.5 E2E: reservable serviceId, stale recovery, cross-tenant isolation and idempotent audited handoff passed.')
} finally {
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotDispatchClaim" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotHandoff" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotTransitionLog" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotActionInbox" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${businessId}`)
  if (conversationIds.length > 0) {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id" IN (${Prisma.join(conversationIds)})`)
  }
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotProviderEvent" WHERE "businessId" = ${businessId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "id" = ${deploymentId}`)
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "id" = ${configurationId}`)
  await prisma.service.deleteMany({ where: { id: { in: [reservableServiceId, deactivatedServiceId, consultServiceId, crossTenantServiceId] } } })
  await prisma.serviceCategory.deleteMany({ where: { id: { in: [categoryId, otherCategoryId] } } })
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } })
  await prisma.$disconnect()
}

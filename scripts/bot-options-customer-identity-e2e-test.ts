import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { ClaimedBotJob } from '../src/bot-options/infrastructure/postgres-worker.js'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const safety = new URL(SAFE_DATABASE_URL)
if (
  safety.protocol !== 'postgresql:' || safety.hostname !== '127.0.0.1' || safety.port !== '54322' ||
  safety.pathname !== '/salon_ai_test' || safety.username !== 'postgres' || safety.password !== 'postgres'
) throw new Error('Refusing unsafe F6 identity E2E PostgreSQL URL')
delete process.env.DATABASE_URL
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, { Prisma }, processor, stateModule, worker, effectExecutor] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/process-session-job.js'),
  import('../src/bot-options/domain/state.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/infrastructure/prisma-handoff-effect-executor.js')
])
const prisma = createPrismaClient({ connectionString: SAFE_DATABASE_URL, max: 4, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 })
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f6_e2e_b_${suffix}`
const otherBusinessId = `f6_e2e_other_${suffix}`
const configurationId = `f6_e2e_cfg_${suffix}`
const deploymentId = `f6_e2e_dep_${suffix}`

type ActionInput = {
  label: string
  phone: string
  actionType: 'menu.start_booking' | 'name.submit' | 'name.confirm'
  payload?: { name: string }
  conversationBusinessId?: string
  customerName?: string
  nameCandidate?: string
}

async function createAndClaim(input: ActionInput) {
  const conversationId = `f6_e2e_conv_${input.label}_${suffix}`
  const sessionId = `f6_e2e_session_${input.label}_${suffix}`
  const eventId = `f6_e2e_event_${input.label}_${suffix}`
  const inboxId = `f6_e2e_inbox_${input.label}_${suffix}`
  const jobId = `f6_e2e_job_${input.label}_${suffix}`
  const initial = stateModule.createInitialBotOptionsState()
  if (input.actionType === 'name.submit') initial.flow = 'NAME_INPUT'
  if (input.actionType === 'name.confirm') {
    initial.flow = 'NAME_CONFIRM'
    initial.nameCandidate = input.nameCandidate ?? null
  }

  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
    VALUES (${conversationId}, ${input.phone}, ${input.conversationBusinessId ?? businessId}, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration", "businessTimezone", "state", "revision", "updatedAt")
    VALUES (${sessionId}, ${businessId}, ${conversationId}, ${deploymentId}, 1, 'America/Argentina/Buenos_Aires', ${JSON.stringify(initial)}::jsonb, 0, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotProviderEvent" ("id", "eventKey", "eventType", "businessId", "providerMessageId", "payload")
    VALUES (${eventId}, ${`f6-e2e-${input.label}-${suffix}`}, 'MESSAGE'::"BotProviderEventType", ${businessId}, ${`wamid.f6.${input.label}.${suffix}`}, '{}'::jsonb)`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "sessionId", "providerMessageId", "actionType", "payload", "deploymentId", "deploymentGeneration", "expectedRevision", "status")
    VALUES (${inboxId}, ${businessId}, ${eventId}, ${sessionId}, ${`wamid.f6.${input.label}.${suffix}`}, ${input.actionType},
      ${input.payload ? JSON.stringify(input.payload) : null}::jsonb, ${deploymentId}, 1, 0, 'SELECTED'::"BotInboxStatus")`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision", "updatedAt")
    VALUES (${jobId}, 'PROCESS_SESSION', ${inboxId}, ${businessId}, ${deploymentId}, 1, 0, clock_timestamp())`)
  if (input.customerName !== undefined) {
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "Customer" ("id", "businessId", "name", "phone", "normalizedPhone")
      VALUES (${`f6_e2e_customer_${input.label}_${suffix}`}, ${businessId}, ${input.customerName}, ${input.phone}, ${input.phone})`)
  }

  const claimToken = randomUUID()
  const claimed = await prisma.$queryRaw<ClaimedBotJob[]>(Prisma.sql`
    UPDATE "BotJob" SET "status" = 'LEASED'::"BotJobStatus", "attempts" = "attempts" + 1,
      "leaseToken" = ${claimToken}, "leasedUntil" = clock_timestamp() + interval '30 seconds', "updatedAt" = clock_timestamp()
    WHERE "id" = ${jobId}
    RETURNING "id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision",
      "attempts", "maxAttempts", "leaseToken" AS "claimToken", "leasedUntil" AS "claimedUntil", 0::double precision AS "queueWaitMs"
  `)
  assert.ok(claimed[0])
  return { sessionId, jobId, job: claimed[0] }
}

async function readState(sessionId: string) {
  const rows = await prisma.$queryRaw<Array<{ revision: bigint; flow: string; nameCandidate: string | null }>>(Prisma.sql`
    SELECT "revision", "state"->>'flow' AS "flow", "state"->>'nameCandidate' AS "nameCandidate"
    FROM "BotSession" WHERE "id" = ${sessionId} AND "businessId" = ${businessId}
  `)
  return rows[0]!
}

try {
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name") VALUES
    (${businessId}, ${`F6E2E-${suffix}`}, 'F6 E2E'), (${otherBusinessId}, ${`F6E2EO-${suffix}`}, 'F6 E2E other')`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES (${configurationId}, ${businessId}, 'deterministic-options', 'F6 E2E', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation", "legacyDispatchCoverageVersion", "activatedAt", "updatedAt")
    VALUES (${deploymentId}, ${businessId}, 'deterministic-options', ${configurationId}, 1, 1, clock_timestamp(), clock_timestamp())`)

  const known = await createAndClaim({ label: 'known', phone: '5491123456701', actionType: 'menu.start_booking', customerName: 'Ana-María O\'Connor' })
  assert.equal(await processor.processSessionJob({ client: prisma, job: known.job }), 'PROCESSED')
  assert.deepEqual(await readState(known.sessionId), { revision: 1n, flow: 'CATEGORY_SELECT', nameCandidate: null })

  const unknown = await createAndClaim({ label: 'unknown', phone: '5491123456702', actionType: 'menu.start_booking' })
  assert.equal(await processor.processSessionJob({ client: prisma, job: unknown.job }), 'PROCESSED')
  assert.deepEqual(await readState(unknown.sessionId), { revision: 1n, flow: 'NAME_INPUT', nameCandidate: null })

  const invalidStored = await createAndClaim({ label: 'invalid_stored', phone: '5491123456703', actionType: 'menu.start_booking', customerName: 'Cliente 123' })
  assert.equal(await processor.processSessionJob({ client: prisma, job: invalidStored.job }), 'PROCESSED')
  assert.equal((await readState(invalidStored.sessionId)).flow, 'NAME_INPUT', 'nombre persistido inválido no se reutiliza')

  const customerCountBeforeName = await prisma.customer.count({ where: { businessId } })
  const invalidName = await createAndClaim({ label: 'invalid_name', phone: '5491123456704', actionType: 'name.submit', payload: { name: 'Ana\tMaría' } })
  assert.equal(await processor.processSessionJob({ client: prisma, job: invalidName.job }), 'PROCESSED')
  const invalidNameState = await readState(invalidName.sessionId)
  assert.equal(invalidNameState.flow, 'NAME_INPUT')
  assert.equal(invalidNameState.nameCandidate, null)

  const validName = await createAndClaim({ label: 'valid_name', phone: '5491123456705', actionType: 'name.submit', payload: { name: '  ana-mari\u0301a O\u2019Connor  ' } })
  assert.equal(await processor.processSessionJob({ client: prisma, job: validName.job }), 'PROCESSED')
  const validNameState = await readState(validName.sessionId)
  assert.equal(validNameState.flow, 'NAME_CONFIRM')
  assert.equal(validNameState.nameCandidate, 'ana-maría O’Connor')
  assert.equal(await prisma.customer.count({ where: { businessId } }), customerCountBeforeName, 'cero Customer writes antes de name.confirm')

  const confirmedName = await createAndClaim({ label: 'confirmed_name', phone: '5491123456707', actionType: 'name.confirm', nameCandidate: 'Zoë Smith' })
  assert.equal(await processor.processSessionJob({ client: prisma, job: confirmedName.job }), 'PROCESSED')
  const persisted = await prisma.customer.findFirst({ where: { businessId, normalizedPhone: '5491123456707' }, select: { name: true, phone: true } })
  assert.deepEqual(persisted, { name: 'Zoë Smith', phone: '5491123456707' }, 'name.confirm debe persistir identidad canónica dentro de la transición')
  const nameOperation = await prisma.botOperation.findFirst({ where: { businessId, sessionId: confirmedName.sessionId, type: 'PERSIST_CUSTOMER_NAME' }, select: { status: true, resultRef: true } })
  assert.equal(nameOperation?.status, 'COMPLETED')
  assert.ok(nameOperation?.resultRef)
  await prisma.$transaction((tx) => effectExecutor.prismaHandoffEffectExecutor(tx, {
    businessId, sessionId: confirmedName.sessionId, operationKey: `transition:${confirmedName.sessionId}:1`,
    effects: [{ kind: 'PERSIST_CUSTOMER_NAME', name: 'Zoë Smith' }]
  }))
  assert.equal(await prisma.customer.count({ where: { businessId, normalizedPhone: '5491123456707' } }), 1, 'replay idempotente no duplica Customer')
  await assert.rejects(prisma.$transaction((tx) => effectExecutor.prismaHandoffEffectExecutor(tx, {
    businessId, sessionId: confirmedName.sessionId, operationKey: `forced-rollback:${confirmedName.sessionId}`,
    effects: [
      { kind: 'PERSIST_CUSTOMER_NAME', name: 'Nombre que debe volver atrás' },
      { kind: 'CONFIRM_VISIT', services: [], professional: { professionalId: 'none', name: 'none', assignedByBalancer: false }, date: '2026-08-30', slotStartAt: '2026-08-30T12:00:00Z', totalDurationMinutes: 30, totalPriceMinor: null }
    ]
  })), /effect executor unavailable: CONFIRM_VISIT/)
  assert.equal((await prisma.customer.findFirstOrThrow({ where: { businessId, normalizedPhone: '5491123456707' } })).name, 'Zoë Smith', 'fallo posterior debe revertir nombre y operación')
  assert.equal(await prisma.botOperation.count({ where: { operationKey: `forced-rollback:${confirmedName.sessionId}:PERSIST_CUSTOMER_NAME` } }), 0)

  await Promise.all(['Nombre A', 'Nombre B'].map((name, index) => prisma.$transaction((tx) => effectExecutor.prismaHandoffEffectExecutor(tx, {
    businessId, sessionId: confirmedName.sessionId, operationKey: `race-${index}:${confirmedName.sessionId}`,
    effects: [{ kind: 'PERSIST_CUSTOMER_NAME', name }]
  }))))
  const racedCustomers = await prisma.customer.findMany({ where: { businessId, normalizedPhone: '5491123456707' }, select: { name: true } })
  assert.equal(racedCustomers.length, 1, 'dos confirms concurrentes para la misma identidad no pueden duplicar Customer')
  assert.ok(['Nombre A', 'Nombre B'].includes(racedCustomers[0]!.name), 'la serialización conserva un nombre confirmado completo')
  assert.equal(await prisma.botOperation.count({
    where: { businessId, sessionId: confirmedName.sessionId, operationKey: { startsWith: 'race-' }, type: 'PERSIST_CUSTOMER_NAME', status: 'COMPLETED' }
  }), 2, 'cada transición concurrente conserva su comprobante idempotente')

  const alertOperationKey = `alert-replay:${confirmedName.sessionId}`
  const alertEffect = { kind: 'EMIT_OPERATIONAL_ALERT' as const, alertKind: 'NO_AVAILABILITY_IN_HORIZON' as const, detail: 'horizon=30' }
  await prisma.$transaction((tx) => effectExecutor.prismaHandoffEffectExecutor(tx, {
    businessId, sessionId: confirmedName.sessionId, operationKey: alertOperationKey, effects: [alertEffect]
  }))
  await prisma.$transaction((tx) => effectExecutor.prismaHandoffEffectExecutor(tx, {
    businessId, sessionId: confirmedName.sessionId, operationKey: alertOperationKey, effects: [alertEffect]
  }))
  await assert.rejects(prisma.$transaction((tx) => effectExecutor.prismaHandoffEffectExecutor(tx, {
    businessId, sessionId: confirmedName.sessionId, operationKey: alertOperationKey,
    effects: [{ ...alertEffect, detail: 'payload-mutado' }]
  })), /operational alert is not safely replayable/)
  assert.equal(await prisma.botOperation.count({ where: { operationKey: `${alertOperationKey}:EMIT_OPERATIONAL_ALERT:NO_AVAILABILITY_IN_HORIZON` } }), 1)

  const tenantMismatch = await createAndClaim({
    label: 'tenant_mismatch', phone: '5491123456706', actionType: 'menu.start_booking', conversationBusinessId: otherBusinessId
  })
  await assert.rejects(
    processor.processSessionJob({ client: prisma, job: tenantMismatch.job }),
    /customer identity conversation unavailable in tenant/
  )
  assert.deepEqual(await readState(tenantMismatch.sessionId), { revision: 0n, flow: 'MAIN_MENU', nameCandidate: null }, 'fallo de identidad debe hacer rollback')
  assert.equal(await worker.retryBotJob(prisma, tenantMismatch.job.id, tenantMismatch.job.claimToken, 'identity lookup failed', 1000), 'RETRY')
  const retried = await prisma.botJob.findUniqueOrThrow({ where: { id: tenantMismatch.jobId }, select: { status: true, lastError: true } })
  assert.deepEqual(retried, { status: 'RETRY', lastError: 'identity lookup failed' })

  console.log('OK F6 E2E: identidad tenant-safe, cero writes pre-confirmación, carrera serializada, replay idempotente, rollback y retry.')
} finally {
  await prisma.$transaction(async (tx) => {
    await tx.botJob.deleteMany({ where: { businessId } })
    await tx.botSession.deleteMany({ where: { businessId } })
    await tx.botProviderEvent.deleteMany({ where: { businessId } })
    await tx.customer.deleteMany({ where: { businessId } })
    await tx.conversation.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } })
    await tx.botChannelDeployment.deleteMany({ where: { businessId } })
    await tx.businessBotConfiguration.deleteMany({ where: { businessId } })
    await tx.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } })
  })
  await prisma.$disconnect()
}

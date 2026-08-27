/**
 * F5.8 — Recorrido controlado de catálogo y horarios por el pipeline Meta.
 *
 * No usa red ni secretos reales. Los webhooks atraviesan firma + admisión
 * autoritativa; los envíos atraviesan claimOutbox + sendClaimedOutbox con un
 * proveedor determinístico en memoria. PostgreSQL es real y está limitado a
 * salon_ai_test en 127.0.0.1:54322.
 *
 * El catálogo se recorre exclusivamente por prompts públicos y webhooks
 * firmados. No hay INSERT manual de outbox ni render alternativo del catálogo.
 */

import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import type { Prisma as PrismaTypes } from '../src/generated/prisma/client.js'
import type { WhatsAppScreenItem } from '../src/bot-options/infrastructure/whatsapp-renderer.js'
import type { OutboxProvider } from '../src/bot-options/infrastructure/whatsapp-outbox-sender.js'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const safety = new URL(SAFE_DATABASE_URL)
if (
  safety.protocol !== 'postgresql:' || safety.hostname !== '127.0.0.1' || safety.port !== '54322' ||
  safety.pathname !== '/salon_ai_test' || safety.username !== 'postgres' || safety.password !== 'postgres'
) throw new Error('Refusing unsafe F5.8 PostgreSQL URL')
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [
  { createPrismaClient },
  { Prisma },
  admissionApplication,
  admissionInfrastructure,
  worker,
  reconciler,
  processor,
  outbox,
  activation,
  metrics,
  config,
  renderer,
  promptTokens
] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/admit-provider-events.js'),
  import('../src/bot-options/infrastructure/prisma-admission.js'),
  import('../src/bot-options/infrastructure/postgres-worker.js'),
  import('../src/bot-options/application/reconcile-actions.js'),
  import('../src/bot-options/application/process-session-job.js'),
  import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js'),
  import('../src/bot-options/infrastructure/prisma-activation.js'),
  import('../src/bot-options/observability/metrics.js'),
  import('../src/config/bot-options.js'),
  import('../src/bot-options/infrastructure/whatsapp-renderer.js'),
  import('../src/bot-options/domain/prompt-tokens.js')
])

const prisma = createPrismaClient({
  connectionString: SAFE_DATABASE_URL,
  max: 6,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 3000
})

const suffix = randomUUID().replaceAll('-', '')
const businessId = `f58_b_${suffix}`
const activeConfigurationId = `f58_cfg_active_${suffix}`
const previousConfigurationId = `f58_cfg_previous_${suffix}`
const deploymentId = `f58_dep_${suffix}`
const whatsAppConfigId = `f58_wa_${suffix}`
const phoneNumberId = `f58_phone_${suffix}`
const customerPhone = `54911${suffix.slice(0, 8)}`
const appSecret = `f58_controlled_secret_${suffix}`
const professionalId = `f58_prof_${suffix}`
const nonBookableProfessionalId = `f58_prof_no_book_${suffix}`
const categoryIds = Array.from({ length: 8 }, (_, index) => `f58_cat_${index}_${suffix}`)
const rootServiceIds = Array.from({ length: 8 }, (_, index) => `f58_root_service_${index}_${suffix}`)
const subcategoryId = `f58_subcategory_${suffix}`
const detailedServiceId = `f58_detail_service_${suffix}`

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function signature(rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
}

function webhookBody(value: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '5491100000000', phone_number_id: phoneNumberId },
      ...value
    } }] }]
  }), 'utf8')
}

function inboundTextBody(messageId: string, text: string): Buffer {
  return webhookBody({
    messages: [{ id: messageId, from: customerPhone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }]
  })
}

function interactiveBody(messageId: string, actionId: string, title: string): Buffer {
  return webhookBody({
    messages: [{
      id: messageId,
      from: customerPhone,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: actionId, title } }
    }]
  })
}

function statusBody(providerMessageId: string, status: 'delivered' | 'read' | 'failed', ordinal: number): Buffer {
  return webhookBody({
    statuses: [{
      id: providerMessageId,
      status,
      timestamp: String(Math.floor(Date.now() / 1000) + ordinal),
      recipient_id: customerPhone,
      ...(status === 'failed' ? { errors: [{ message: 'controlled provider failure' }] } : {})
    }]
  })
}

function codePoints(value: string): number {
  return Array.from(value).length
}

function assertWhatsAppItemLimits(item: WhatsAppScreenItem): void {
  if (item.type === 'none') return
  assert.ok(codePoints(item.body) <= renderer.WHATSAPP_INTERACTIVE_BODY_MAX_CODE_POINTS, 'body exceeds WhatsApp 1024 code-point limit')
  if (item.type !== 'interactive') return
  assert.ok(item.actionIds.every((id) => /^[\x00-\x7f]+$/.test(id) && Buffer.byteLength(id, 'ascii') <= 64), 'action IDs must be ASCII and <=64 bytes')
  if (item.mode === 'buttons') {
    assert.ok((item.buttons?.length ?? 0) <= renderer.WHATSAPP_BUTTONS_MAX)
    for (const button of item.buttons ?? []) assert.ok(codePoints(button.title) <= renderer.WHATSAPP_BUTTON_TITLE_MAX)
  } else {
    assert.ok((item.rows?.length ?? 0) <= renderer.WHATSAPP_LIST_ROWS_MAX)
    for (const row of item.rows ?? []) {
      assert.ok(codePoints(row.title) <= renderer.WHATSAPP_ROW_TITLE_MAX)
      if (row.description) assert.ok(codePoints(row.description) <= renderer.WHATSAPP_ROW_DESCRIPTION_MAX)
    }
    if (item.buttonText) assert.ok(codePoints(item.buttonText) <= renderer.WHATSAPP_BUTTON_TITLE_MAX)
    if (item.sectionTitle) assert.ok(codePoints(item.sectionTitle) <= renderer.WHATSAPP_BUTTON_TITLE_MAX)
  }
}

type ReservationSnapshot = {
  appointments: bigint
  deposits: bigint
  bookingOperations: bigint
}

async function reservationSnapshot(): Promise<ReservationSnapshot> {
  const rows = await prisma.$queryRaw<ReservationSnapshot[]>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "Appointment" a JOIN "Professional" p ON p."id" = a."professionalId"
        WHERE p."businessId" = ${businessId})::bigint AS "appointments",
      (SELECT count(*) FROM "BookingDeposit" WHERE "businessId" = ${businessId})::bigint AS "deposits",
      (SELECT count(*) FROM "BotOperation" WHERE "businessId" = ${businessId}
        AND "type" IN ('CONFIRM_VISIT', 'HOLD_VISIT_WITH_DEPOSIT', 'APPROVE_DEPOSIT'))::bigint AS "bookingOperations"
  `)
  return rows[0] ?? { appointments: 0n, deposits: 0n, bookingOperations: 0n }
}

const repository = new admissionInfrastructure.PrismaAuthoritativeAdmissionRepository(prisma)
const webhook = admissionApplication.createAuthoritativeWebhookAdmission(repository)

async function admitSigned(rawBody: Buffer, traceId: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await webhook.routeAndAdmit({ rawBody, signatureHeader: signature(rawBody), traceId })
      assert.deepEqual(result, { route: 'new', outcome: { status: 'admitted', eventCount: 1 } })
      return
    } catch (error) {
      const isExpiredTransaction = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2028'
      if (!isExpiredTransaction || attempt === 3) throw error
      await sleep(25 * attempt)
    }
  }
}

async function claimFixtureJob(expectedKind: string) {
  const deadline = Date.now() + 4_000
  for (;;) {
    const job = await worker.claimBotJob(prisma, 30_000, randomUUID(), { businessId })
    if (job) {
      assert.equal(job.businessId, businessId, 'scoped worker must never claim another tenant job')
      assert.equal(job.kind, expectedKind)
      return job
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${expectedKind} job`)
    await sleep(25)
  }
}

async function processInitialInbound(): Promise<string> {
  const job = await claimFixtureJob('PROCESS_INBOX')
  assert.equal(await processor.processSessionJob({ client: prisma, job }), 'PROCESSED')
  const sessions = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "BotSession" WHERE "businessId" = ${businessId}
  `)
  assert.equal(sessions.length, 1)
  return sessions[0]!.id
}

async function settleChoiceAndProcess(): Promise<void> {
  await sleep(550)
  for (;;) {
    const reconcileJob = await claimFixtureJob('RECONCILE_PROMPT')
    const result = await reconciler.reconcileActions(prisma, reconcileJob)
    if (result === 'NOT_READY') {
      await sleep(100)
      continue
    }
    assert.equal(result, 'SELECT')
    break
  }
  const processJob = await claimFixtureJob('PROCESS_SESSION')
  assert.equal(await processor.processSessionJob({ client: prisma, job: processJob }), 'PROCESSED')
}

async function clickPublicChoice(sessionId: string, actionType: string, entityId?: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{
    promptToken: string
    choiceToken: string
    labelSnapshot: string
  }>>(Prisma.sql`
    SELECT p."promptToken", c."choiceToken", c."labelSnapshot"
    FROM "BotPrompt" p
    JOIN "BotPromptChoice" c ON c."promptId" = p."id"
    WHERE p."sessionId" = ${sessionId} AND p."status" = 'OPEN'::"BotPromptStatus"
      AND c."actionType" = ${actionType}
      AND (${entityId ?? null}::text IS NULL OR c."entityId" = ${entityId ?? null})
    ORDER BY p."openedAt" DESC, c."sortOrder" ASC
    LIMIT 2
  `)
  assert.equal(rows.length, 1, `expected exactly one open ${actionType} choice`)
  const actionId = promptTokens.buildInteractiveActionId(rows[0]!.promptToken, rows[0]!.choiceToken)
  const rawBody = interactiveBody(`wamid.f58.in.${suffix}.${randomUUID()}`, actionId, rows[0]!.labelSnapshot)
  await admitSigned(rawBody, `f58-choice-${actionType}-${suffix}`)
  await settleChoiceAndProcess()
}

type OpenChoice = {
  actionType: string
  entityType: string | null
  entityId: string | null
  labelSnapshot: string
  sortOrder: number
}

async function loadOpenChoices(sessionId: string): Promise<OpenChoice[]> {
  return prisma.$queryRaw<OpenChoice[]>(Prisma.sql`
    SELECT c."actionType", c."entityType", c."entityId", c."labelSnapshot", c."sortOrder"
    FROM "BotPromptChoice" c
    JOIN "BotPrompt" p ON p."id" = c."promptId"
    WHERE p."sessionId" = ${sessionId} AND p."status" = 'OPEN'::"BotPromptStatus"
    ORDER BY c."sortOrder"
  `)
}

async function assertOpenChoiceLimit(sessionId: string): Promise<OpenChoice[]> {
  const choices = await loadOpenChoices(sessionId)
  assert.ok(choices.length > 0 && choices.length <= 10, 'every public prompt must expose 1..10 choices')
  return choices
}

type SentRecord = {
  outboxId: string
  providerMessageId: string
  deliveryGroupId: string
  sequence: number
  dependsOnSequence: number | null
  kind: string
  item: WhatsAppScreenItem
}

let providerCallCount = 0
const controlledProvider: OutboxProvider = {
  async send(input, signal) {
    assert.equal(signal.aborted, false)
    assert.equal(input.businessId, businessId)
    const payload = input.payload as { to?: unknown; item?: WhatsAppScreenItem }
    assert.equal(payload.to, customerPhone)
    assert.ok(payload.item)
    assertWhatsAppItemLimits(payload.item!)
    providerCallCount += 1
    return { kind: 'accepted', providerMessageId: `wamid.f58.out.${suffix}.${providerCallCount}` }
  }
}

async function drainFixtureOutbox(): Promise<SentRecord[]> {
  const sent: SentRecord[] = []
  for (;;) {
    const item = await outbox.claimOutbox(prisma, 30_000, randomUUID(), { businessId })
    if (!item) break
    assert.equal(item.businessId, businessId, 'scoped sender must not claim another tenant')
    const payload = item.payload as { item?: WhatsAppScreenItem }
    assert.ok(payload.item)
    const rows = await prisma.$queryRaw<Array<{
      deliveryGroupId: string
      sequence: number
      dependsOnSequence: number | null
      kind: string
    }>>(Prisma.sql`
      SELECT "deliveryGroupId", "sequence", "dependsOnSequence", "kind"
      FROM "BotOutbox" WHERE "id" = ${item.id}
    `)
    const row = rows[0]!
    if (row.dependsOnSequence !== null) {
      const predecessor = await prisma.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        SELECT "status"::text AS "status" FROM "BotOutbox"
        WHERE "businessId" = ${businessId} AND "sessionId" = ${item.sessionId}
          AND "deliveryGroupId" = ${row.deliveryGroupId} AND "sequence" = ${row.dependsOnSequence}
      `)
      assert.ok(['ACCEPTED', 'DELIVERED', 'READ', 'SKIPPED'].includes(predecessor[0]?.status ?? ''), 'dependent claimed before predecessor terminal acceptance')
    }
    assert.equal(await outbox.sendClaimedOutbox({ client: prisma, item, provider: controlledProvider }), 'ACCEPTED')
    const accepted = await prisma.$queryRaw<Array<{ providerMessageId: string | null }>>(Prisma.sql`
      SELECT "providerMessageId" FROM "BotOutbox" WHERE "id" = ${item.id}
    `)
    assert.ok(accepted[0]?.providerMessageId)
    sent.push({ outboxId: item.id, providerMessageId: accepted[0]!.providerMessageId!, item: payload.item!, ...row })
  }
  return sent
}

function assertOrderedGroups(rows: readonly SentRecord[]): void {
  const groups = new Map<string, SentRecord[]>()
  for (const row of rows) groups.set(row.deliveryGroupId, [...(groups.get(row.deliveryGroupId) ?? []), row])
  for (const groupRows of groups.values()) {
    const ordered = [...groupRows].sort((a, b) => a.sequence - b.sequence)
    for (const [index, row] of ordered.entries()) {
      assert.equal(row.sequence, index)
      assert.equal(row.dependsOnSequence, index === 0 ? null : index - 1)
    }
  }
}

async function admitStatus(providerMessageId: string, status: 'delivered' | 'read' | 'failed', ordinal: number): Promise<void> {
  const rawBody = statusBody(providerMessageId, status, ordinal)
  await admitSigned(rawBody, `f58-status-${status}-${suffix}-${ordinal}`)
}

async function cleanup(): Promise<void> {
  const cleanupErrors: string[] = []
  const safe = async (label: string, action: () => Promise<unknown>) => {
    try { await action() } catch (error) { cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  await safe('BotOutboxResolution', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutboxResolution" WHERE "outboxId" IN (SELECT "id" FROM "BotOutbox" WHERE "businessId" = ${businessId})`))
  await safe('BotDispatchClaim', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotDispatchClaim" WHERE "businessId" = ${businessId}`))
  await safe('BotOutbox', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "businessId" = ${businessId}`))
  await safe('BotJob', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${businessId}`))
  await safe('BotActionInbox', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotActionInbox" WHERE "businessId" = ${businessId}`))
  await safe('BotPromptChoice', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotPromptChoice" WHERE "promptId" IN (SELECT p."id" FROM "BotPrompt" p JOIN "BotSession" s ON s."id" = p."sessionId" WHERE s."businessId" = ${businessId})`))
  await safe('BotPrompt', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotPrompt" WHERE "sessionId" IN (SELECT "id" FROM "BotSession" WHERE "businessId" = ${businessId})`))
  await safe('BotTransitionLog', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotTransitionLog" WHERE "businessId" = ${businessId}`))
  await safe('BotOperation', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOperation" WHERE "businessId" = ${businessId}`))
  await safe('BotSession', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "businessId" = ${businessId}`))
  await safe('BotProviderEvent', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotProviderEvent" WHERE "businessId" = ${businessId}`))
  await safe('Conversation', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "businessId" = ${businessId}`))
  await safe('BookingDeposit', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BookingDeposit" WHERE "businessId" = ${businessId}`))
  await safe('AppointmentServiceItem', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "AppointmentServiceItem" WHERE "appointmentId" IN (SELECT a."id" FROM "Appointment" a JOIN "Professional" p ON p."id" = a."professionalId" WHERE p."businessId" = ${businessId})`))
  await safe('Appointment', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "Appointment" WHERE "professionalId" IN (SELECT "id" FROM "Professional" WHERE "businessId" = ${businessId})`))
  await safe('ScheduleBlock', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "ScheduleBlock" WHERE "businessId" = ${businessId}`))
  await safe('ProfessionalHours', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "ProfessionalHours" WHERE "professionalId" IN (${professionalId}, ${nonBookableProfessionalId})`))
  await safe('BusinessHours', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessHours" WHERE "businessId" = ${businessId}`))
  await safe('ProfessionalService', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "ProfessionalService" WHERE "professionalId" IN (${professionalId}, ${nonBookableProfessionalId})`))
  await safe('Service', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "Service" WHERE "businessId" = ${businessId}`))
  await safe('ServiceCategory', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "ServiceCategory" WHERE "businessId" = ${businessId}`))
  await safe('Professional', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "Professional" WHERE "businessId" = ${businessId}`))
  await safe('BotChannelDeployment', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${businessId}`))
  await safe('BotDeploymentAudit', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotDeploymentAudit" WHERE "businessId" = ${businessId}`))
  await safe('BusinessWhatsAppConfig', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessWhatsAppConfig" WHERE "businessId" = ${businessId}`))
  await safe('BusinessBotConfiguration', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${businessId}`))
  await safe('Business', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`))
  if (cleanupErrors.length > 0) throw new Error(`F5.8 cleanup failed: ${cleanupErrors.join('; ')}`)
}

try {
  // Fixtures tenant-scoped, sin clientes ni reservas.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "Business" ("id", "customerCode", "name")
    VALUES (${businessId}, ${`F58-${suffix}`}, 'F5.8 controlled Meta sandbox')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotOptionsSettings" ("businessId", "timezone", "bookingHorizonDays", "bookingLeadTimeHours", "morningCutTime", "eveningCutTime")
    VALUES (${businessId}, 'UTC', 30, 0, '12:30', '16:30')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES
      (${activeConfigurationId}, ${businessId}, 'deterministic-options', 'F5.8 active', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp()),
      (${previousConfigurationId}, ${businessId}, 'deterministic-options-previous', 'F5.8 previous', 'v0', 'ACTIVE', '{}'::jsonb, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessWhatsAppConfig" ("id", "businessId", "connectionStatus", "phoneNumberId", "appSecret", "updatedAt")
    VALUES (${whatsAppConfigId}, ${businessId}, 'CONNECTED'::"WhatsAppConnectionStatus", ${phoneNumberId}, ${appSecret}, clock_timestamp())
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" (
      "id", "businessId", "engineKey", "activeConfigurationId", "previousConfigurationId", "generation",
      "legacyDispatchCoverageVersion", "activatedAt", "updatedAt"
    ) VALUES (
      ${deploymentId}, ${businessId}, 'deterministic-options', ${activeConfigurationId}, ${previousConfigurationId}, 1,
      1, clock_timestamp(), clock_timestamp()
    )
  `)
  await prisma.serviceCategory.createMany({ data: categoryIds.map((id, index) => ({
    id, businessId, name: `Categoría ${String(index + 1).padStart(2, '0')}`, sortOrder: index
  })) })
  const longDescription = 'Descripción controlada con información real del servicio. '.repeat(40)
  await prisma.service.createMany({ data: [
    {
      id: subcategoryId,
      businessId,
      catalogCategoryId: categoryIds[0]!,
      name: 'Coloración',
      duration: 0,
      isBookable: false,
      sortOrder: -1
    },
    ...rootServiceIds.map((id, index) => ({
      id,
      businessId,
      catalogCategoryId: categoryIds[0]!,
      name: `Servicio raíz ${String(index + 1).padStart(2, '0')}`,
      description: `Detalle raíz ${index + 1}`,
      duration: 30 + index,
      price: 10_000 + index * 1000,
      priceMode: 'FIXED' as const,
      sortOrder: index
    })),
    {
      id: detailedServiceId,
      businessId,
      catalogCategoryId: categoryIds[0]!,
      parentServiceId: subcategoryId,
      name: 'Servicio premium',
      description: longDescription,
      duration: 45,
      customerDurationMin: 40,
      customerDurationMax: 50,
      price: 25_000,
      priceMode: 'STARTING_AT',
      sortOrder: 0
    },
    ...categoryIds.slice(1).map((categoryId, index) => ({
      id: `f58_category_service_${index}_${suffix}`,
      businessId,
      catalogCategoryId: categoryId,
      name: `Servicio categoría ${index + 2}`,
      description: `Detalle categoría ${index + 2}`,
      duration: 30,
      price: 12_000,
      priceMode: 'FIXED' as const,
      sortOrder: 0
    }))
  ] })
  await prisma.professional.createMany({ data: [
    { id: professionalId, businessId, name: 'Ana Controlada', isActive: true, acceptsBotBookings: true },
    { id: nonBookableProfessionalId, businessId, name: 'Bruno Informativo', isActive: true, acceptsBotBookings: false }
  ] })
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime") VALUES
      (${randomUUID()}, ${businessId}, 1, '09:00', '18:00'),
      (${randomUUID()}, ${businessId}, 2, '09:00', '18:00'),
      (${randomUUID()}, ${businessId}, 3, '09:00', '18:00'),
      (${randomUUID()}, ${businessId}, 4, '09:00', '18:00'),
      (${randomUUID()}, ${businessId}, 5, '09:00', '18:00')
  `)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "ProfessionalHours" ("id", "professionalId", "dayOfWeek", "startTime", "endTime") VALUES
      (${randomUUID()}, ${professionalId}, 1, '10:00', '17:00'),
      (${randomUUID()}, ${professionalId}, 3, '10:00', '17:00'),
      (${randomUUID()}, ${nonBookableProfessionalId}, 2, '12:00', '16:00')
  `)

  const reservationsBefore = await reservationSnapshot()
  assert.deepEqual(reservationsBefore, { appointments: 0n, deposits: 0n, bookingOperations: 0n })

  // Inbound firmado -> sesión/prompt/outbox -> proveedor controlado.
  await admitSigned(inboundTextBody(`wamid.f58.initial.${suffix}`, 'hola'), `f58-initial-${suffix}`)
  const sessionId = await processInitialInbound()
  const mainMenuSent = await drainFixtureOutbox()
  assert.equal(mainMenuSent.length, 1)
  assertOrderedGroups(mainMenuSent)

  // Callback público signed delivered/read y métrica webhook_ack observable.
  const metricsBeforeCallbacks = metrics.botOptionsMetrics.snapshot()
  await admitStatus(mainMenuSent[0]!.providerMessageId, 'delivered', 1)
  await admitStatus(mainMenuSent[0]!.providerMessageId, 'read', 2)
  const metricsAfterCallbacks = metrics.botOptionsMetrics.snapshot()
  assert.ok(
    metricsAfterCallbacks.durations.webhook_ack.count >= metricsBeforeCallbacks.durations.webhook_ack.count + 2,
    'signed status callbacks must increment real webhook_ack metrics'
  )
  const callbackState = await prisma.$queryRaw<Array<{
    status: string
    deliveredAt: Date | null
    readAt: Date | null
    processedCallbacks: bigint
  }>>(Prisma.sql`
    SELECT o."status"::text AS "status", o."deliveredAt", o."readAt",
      (SELECT count(*) FROM "BotProviderEvent" e WHERE e."businessId" = ${businessId}
        AND e."eventType" = 'STATUS'::"BotProviderEventType"
        AND e."status" = 'PROCESSED'::"BotProviderEventStatus")::bigint AS "processedCallbacks"
    FROM "BotOutbox" o WHERE o."id" = ${mainMenuSent[0]!.outboxId}
  `)
  assert.equal(callbackState[0]!.status, 'READ')
  assert.ok(callbackState[0]!.deliveredAt)
  assert.ok(callbackState[0]!.readAt)
  assert.equal(callbackState[0]!.processedCallbacks, 2n)

  // Menú -> horario del negocio, con delivery group real texto -> interactivo.
  await clickPublicChoice(sessionId, 'menu.business_hours')
  const businessHoursSent = await drainFixtureOutbox()
  assert.ok(businessHoursSent.length >= 2)
  assertOrderedGroups(businessHoursSent)
  assert.equal(businessHoursSent[0]!.kind, 'informative_text')
  assert.equal(businessHoursSent.at(-1)!.kind, 'interactive')

  // Horarios -> listado profesional -> detalle; jornada, no disponibilidad.
  await clickPublicChoice(sessionId, 'hours.professional')
  const professionalListSent = await drainFixtureOutbox()
  assert.ok(professionalListSent.some((row) => row.kind === 'interactive'))
  assertOrderedGroups(professionalListSent)
  await clickPublicChoice(sessionId, 'hours.professional_select', professionalId)
  const professionalDetailSent = await drainFixtureOutbox()
  assert.ok(professionalDetailSent.length >= 2)
  assertOrderedGroups(professionalDetailSent)
  const professionalState = await prisma.$queryRaw<Array<{ state: PrismaTypes.JsonValue }>>(Prisma.sql`
    SELECT "state" FROM "BotSession" WHERE "id" = ${sessionId}
  `)
  const stateAfterProfessional = professionalState[0]!.state as { flow?: unknown; booking?: unknown; cart?: unknown[] }
  assert.equal(stateAfterProfessional.flow, 'PROFESSIONAL_HOURS_DETAIL')
  assert.equal(stateAfterProfessional.booking, 'NONE')
  assert.deepEqual(stateAfterProfessional.cart, [])

  // Volver a menú y recorrer catálogo completo por admisión/runtime público.
  await clickPublicChoice(sessionId, 'navigation.home')
  await drainFixtureOutbox()
  await clickPublicChoice(sessionId, 'menu.browse_services')
  const categoriesPage0Sent = await drainFixtureOutbox()
  assert.ok(categoriesPage0Sent.some((row) => row.kind === 'interactive'))
  const categoryPage0 = await assertOpenChoiceLimit(sessionId)
  const categoryPage0Refs = categoryPage0.filter((choice) => choice.actionType === 'category.select')
  assert.equal(categoryPage0Refs.length, 7)
  assert.deepEqual(categoryPage0Refs.map((choice) => choice.entityType), Array(7).fill('CATEGORY'))
  assert.deepEqual(categoryPage0Refs.map((choice) => choice.entityId), categoryIds.slice(0, 7))
  assert.equal(categoryPage0.filter((choice) => choice.actionType === 'catalog.next_page').length, 1)

  await clickPublicChoice(sessionId, 'catalog.next_page')
  await drainFixtureOutbox()
  const categoryPage1 = await assertOpenChoiceLimit(sessionId)
  assert.deepEqual(categoryPage1.filter((choice) => choice.actionType === 'category.select').map((choice) => choice.entityId), [categoryIds[7]])
  assert.equal(categoryPage1.filter((choice) => choice.actionType === 'catalog.previous_page').length, 1)
  assert.equal(categoryPage1.filter((choice) => choice.actionType === 'catalog.next_page').length, 0)

  await clickPublicChoice(sessionId, 'catalog.previous_page')
  await drainFixtureOutbox()
  assert.deepEqual(
    (await assertOpenChoiceLimit(sessionId)).filter((choice) => choice.actionType === 'category.select').map((choice) => choice.entityId),
    categoryIds.slice(0, 7),
    'pageShift must render the target category page, not stale source context'
  )

  await clickPublicChoice(sessionId, 'category.select', categoryIds[0])
  await drainFixtureOutbox()
  const rootPage0 = await assertOpenChoiceLimit(sessionId)
  const subcategoryChoices = rootPage0.filter((choice) => choice.entityId === subcategoryId)
  assert.deepEqual(subcategoryChoices, [{
    actionType: 'subcategory.select',
    entityType: 'SUBCATEGORY',
    entityId: subcategoryId,
    labelSnapshot: 'Coloración — Ver subcategoría',
    sortOrder: 0
  }])
  assert.equal(rootPage0.some((choice) => choice.actionType === 'service.view' && choice.entityId === subcategoryId), false,
    'subcategory must never be exposed as a reservable service')
  assert.equal(rootPage0.filter((choice) => choice.actionType === 'service.view').length, 6)
  assert.equal(rootPage0.filter((choice) => choice.actionType === 'catalog.next_page').length, 1)

  await clickPublicChoice(sessionId, 'catalog.next_page')
  await drainFixtureOutbox()
  const rootPage1 = await assertOpenChoiceLimit(sessionId)
  assert.deepEqual(
    rootPage1.filter((choice) => choice.actionType === 'service.view').map((choice) => choice.entityId),
    rootServiceIds.slice(6),
    'service page 1 must contain the next stable runtime entities'
  )
  assert.equal(rootPage1.filter((choice) => choice.actionType === 'catalog.previous_page').length, 1)

  await clickPublicChoice(sessionId, 'catalog.previous_page')
  await drainFixtureOutbox()
  assert.equal((await assertOpenChoiceLimit(sessionId))[0]!.entityId, subcategoryId,
    'previous page must restore root page with real context')

  await clickPublicChoice(sessionId, 'subcategory.select', subcategoryId)
  await drainFixtureOutbox()
  const nestedServices = await assertOpenChoiceLimit(sessionId)
  assert.equal(nestedServices.filter((choice) => choice.actionType === 'subcategory.select').length, 0)
  assert.deepEqual(nestedServices.filter((choice) => choice.actionType === 'service.view').map((choice) => choice.entityId), [detailedServiceId])
  assert.deepEqual(nestedServices.find((choice) => choice.entityId === detailedServiceId)?.entityType, 'SERVICE')

  await clickPublicChoice(sessionId, 'service.view', detailedServiceId)
  const detailSent = await drainFixtureOutbox()
  assert.ok(detailSent.length >= 3, 'long detail must be split into informative fragments plus one interactive')
  assertOrderedGroups(detailSent)
  assert.ok(detailSent.slice(0, -1).every((row) => row.kind === 'informative_text'))
  const finalDetail = detailSent.at(-1)!
  assert.equal(finalDetail.kind, 'interactive')
  assert.ok(finalDetail.item.type === 'interactive' && finalDetail.item.body.includes('Servicio premium'))
  const detailChoices = await assertOpenChoiceLimit(sessionId)
  assert.equal(detailChoices.filter((choice) => choice.actionType === 'service.book' && choice.entityId === detailedServiceId).length, 1)

  // Capability OFF: no sender loop nuevo, outbox queda pendiente y pointer intacto.
  await clickPublicChoice(sessionId, 'service.more_same_category')
  const pointerBeforeKillSwitch = await prisma.botChannelDeployment.findUniqueOrThrow({
    where: { businessId_channel: { businessId, channel: 'WHATSAPP' } },
    select: { id: true, activeConfigurationId: true, previousConfigurationId: true, generation: true, dispatchFenceEpoch: true }
  })
  const runtimeOff = config.resolveBotOptionsConfig({
    BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED: 'true',
    BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE: 'true',
    BOT_OPTIONS_SENDER_ENABLED: 'false'
  })
  assert.equal(runtimeOff.senderEnabled, false)
  const callsBeforeKillSwitch = providerCallCount
  let disabledLoop: ReturnType<typeof outbox.startOutboxSenderLoop> | null = null
  if (runtimeOff.senderEnabled) disabledLoop = outbox.startOutboxSenderLoop({ client: prisma, provider: controlledProvider, pollMs: 10 })
  await sleep(50)
  if (disabledLoop) await disabledLoop.stop()
  assert.equal(providerCallCount, callsBeforeKillSwitch, 'sender capability OFF must make zero provider calls')
  const pendingWhileOff = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS "count" FROM "BotOutbox"
    WHERE "businessId" = ${businessId} AND "status" = 'PENDING'::"BotOutboxStatus"
  `)
  assert.equal(pendingWhileOff[0]!.count, 1n)
  const pointerAfterKillSwitch = await prisma.botChannelDeployment.findUniqueOrThrow({
    where: { businessId_channel: { businessId, channel: 'WHATSAPP' } },
    select: { id: true, activeConfigurationId: true, previousConfigurationId: true, generation: true, dispatchFenceEpoch: true }
  })
  assert.deepEqual(pointerAfterKillSwitch, pointerBeforeKillSwitch, 'capability switch must not move routing pointer or fence')
  assert.equal((await repository.resolveRoute(phoneNumberId)).kind, 'new', 'routing stays authoritative while sender capability is off')

  // Quiescence/fence es un mecanismo DB distinto del capability process-level.
  const pauseHandle = await activation.pauseDispatchScope({
    client: prisma,
    businessId,
    expectedGeneration: pointerBeforeKillSwitch.generation,
    actorId: 'f58-controlled-test',
    legacyCoverageComplete: true
  })
  const fixtureClaimsWhilePaused = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS "count" FROM "BotOutbox" o
    JOIN "BotSession" s ON s."id" = o."sessionId" AND s."businessId" = o."businessId"
    JOIN "BotChannelDeployment" d ON d."id" = s."deploymentId" AND d."businessId" = o."businessId"
    WHERE o."businessId" = ${businessId}
      AND o."status" IN ('PENDING'::"BotOutboxStatus", 'RETRY'::"BotOutboxStatus")
      AND o."availableAt" <= clock_timestamp() AND o."attempts" < o."maxAttempts"
      AND d."generation" = s."deploymentGeneration" AND d."activeConfigurationId" IS NOT NULL
      AND d."engineKey" = 'deterministic-options' AND d."legacyDispatchCoverageVersion" >= 1
      AND d."claimsPausedAt" IS NULL AND s."status" <> 'HUMAN_TAKEN'::"BotSessionStatus"
  `)
  assert.equal(fixtureClaimsWhilePaused[0]!.count, 0n, 'paused dispatch scope must exclude fixture rows from claim eligibility')
  assert.equal((await activation.waitForDispatchQuiescence({ client: prisma, handle: pauseHandle, timeoutMs: 0 })).kind, 'QUIESCENT')
  const pointerWhilePaused = await prisma.botChannelDeployment.findUniqueOrThrow({
    where: { businessId_channel: { businessId, channel: 'WHATSAPP' } },
    select: { activeConfigurationId: true, previousConfigurationId: true, generation: true, dispatchFenceEpoch: true, claimsPausedAt: true }
  })
  assert.equal(pointerWhilePaused.activeConfigurationId, pointerBeforeKillSwitch.activeConfigurationId)
  assert.equal(pointerWhilePaused.previousConfigurationId, pointerBeforeKillSwitch.previousConfigurationId)
  assert.equal(pointerWhilePaused.generation, pointerBeforeKillSwitch.generation)
  assert.equal(pointerWhilePaused.dispatchFenceEpoch, pointerBeforeKillSwitch.dispatchFenceEpoch + 1)
  assert.ok(pointerWhilePaused.claimsPausedAt)
  await activation.resumeDispatchScope({ client: prisma, handle: pauseHandle, actorId: 'f58-controlled-test' })

  const postResumeSent = await drainFixtureOutbox()
  assert.equal(postResumeSent.length, 1)
  await admitStatus(postResumeSent[0]!.providerMessageId, 'failed', 3)
  const failedState = await prisma.$queryRaw<Array<{ status: string; errorCode: string | null }>>(Prisma.sql`
    SELECT "status"::text AS "status", "errorCode" FROM "BotOutbox" WHERE "id" = ${postResumeSent[0]!.outboxId}
  `)
  assert.deepEqual(failedState[0], { status: 'FAILED', errorCode: 'controlled provider failure' })

  // Sin reservas/holds/señas incidentales durante navegación informativa.
  const reservationsAfter = await reservationSnapshot()
  assert.deepEqual(reservationsAfter, reservationsBefore)
  const finalSession = await prisma.$queryRaw<Array<{ state: PrismaTypes.JsonValue }>>(Prisma.sql`
    SELECT "state" FROM "BotSession" WHERE "id" = ${sessionId}
  `)
  const finalState = finalSession[0]!.state as { booking?: unknown; deposit?: unknown; cart?: unknown[] }
  assert.equal(finalState.booking, 'NONE')
  assert.equal(finalState.deposit, 'NONE')
  assert.deepEqual(finalState.cart, [])

  const metricSnapshot = await metrics.collectBotOptionsOperationalMetrics(prisma)
  assert.ok(metricSnapshot.durations.webhook_ack.count >= metricsAfterCallbacks.durations.webhook_ack.count)
  assert.ok(metricSnapshot.durations.outbox_wait.count >= 1)
  assert.ok(metricSnapshot.durations.meta_request.count >= 1)
  assert.ok(metricSnapshot.durations.dispatch_quiescence.count >= 1)

  console.log('OK F5.8: signed public traversal covered menu, paginated tenant catalog, explicit subcategory, long service detail, ordered outbox/sender, business/professional hours, callbacks, metrics, zero bookings and capability/pause pointer preservation.')
} finally {
  try {
    await cleanup()
  } finally {
    await prisma.$disconnect()
  }
}

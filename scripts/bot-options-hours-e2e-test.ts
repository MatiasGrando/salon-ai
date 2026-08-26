/**
 * F5.6 — E2E: processSessionJob con menu.business_hours.
 *
 * Cubre:
 * - Click "Consultar horarios" produce outbox con lunes-domingo + excepción
 * - No muta cart/booking/selections/draft
 * - Vista informativa tiene texto + interactivo
 * - TODOS los items outbox validados: codePointLength≤1024, deliveryGroupId
 *   consistente, secuencias ordenadas, dependsOnSequence al último fragmento previo
 * - Excepción relativa al reloj DB (no depende de fecha de ejecución)
 * - Concatenación de informativos verifica que lunes-domingo/excepción no se pierden tras split
 *
 * Ejecución: npx tsx scripts/bot-options-hours-e2e-test.ts
 * Base de datos: salon_ai_test (127.0.0.1:54322)
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SAFE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_test'
const safety = new URL(SAFE_DATABASE_URL)
if (
  safety.protocol !== 'postgresql:' || safety.hostname !== '127.0.0.1' || safety.port !== '54322' ||
  safety.pathname !== '/salon_ai_test' || safety.username !== 'postgres' || safety.password !== 'postgres'
) throw new Error('Refusing unsafe F5.6 E2E PostgreSQL URL')
process.env.DATABASE_URL = SAFE_DATABASE_URL

const [{ createPrismaClient }, { Prisma }, processor, promptTokens] = await Promise.all([
  import('../src/config/prisma-client.js'),
  import('../src/generated/prisma/client.js'),
  import('../src/bot-options/application/process-session-job.js'),
  import('../src/bot-options/domain/prompt-tokens.js')
])

const prisma = createPrismaClient({
  connectionString: SAFE_DATABASE_URL, max: 4, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000
})
const suffix = randomUUID().replaceAll('-', '')
const businessId = `f56_e2e_b_${suffix}`
const configurationId = `f56_e2e_c_${suffix}`
const deploymentId = `f56_e2e_d_${suffix}`
const sessionId = `f56_e2e_s_${suffix}`
const conversationId = `f56_e2e_v_${suffix}`

try {
  // ─── Setup ────────────────────────────────────────────────────────────────
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Business" ("id", "customerCode", "name")
    VALUES (${businessId}, ${`F56-${suffix}`}, 'F56 E2E hours')`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BusinessBotConfiguration" ("id", "businessId", "botKey", "name", "version", "status", "definition", "updatedAt")
    VALUES (${configurationId}, ${businessId}, 'deterministic-options', 'Deterministic options', 'v1', 'ACTIVE', '{}'::jsonb, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotChannelDeployment" ("id", "businessId", "engineKey", "activeConfigurationId", "generation",
      "legacyDispatchCoverageVersion", "activatedAt", "updatedAt")
    VALUES (${deploymentId}, ${businessId}, 'deterministic-options', ${configurationId}, 1, 1, clock_timestamp(), clock_timestamp())`)

  // ─── Horarios: L-V 9-18, Sáb 10-14, Dom cerrado ──────────────────────────
  for (const dow of [1, 2, 3, 4, 5]) {
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime")
      VALUES (${randomUUID()}, ${businessId}, ${dow}, '09:00', '18:00')`)
  }
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "BusinessHours" ("id", "businessId", "dayOfWeek", "startTime", "endTime")
    VALUES (${randomUUID()}, ${businessId}, 6, '10:00', '14:00')`)

  // ─── Excepción relativa al reloj DB: +7 días desde ahora ──────────────────
  // Usamos SQL para calcular la fecha relativa, no dependemos de la fecha de ejecución
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "ScheduleBlock" ("id", "businessId", "professionalId", "reason", "title", "note", "startAt", "endAt")
    VALUES (${randomUUID()}, ${businessId}, NULL, 'HOLIDAY', 'Feriado Relativo', 'Detalles internos',
      (clock_timestamp() + interval '7 days')::timestamptz,
      (clock_timestamp() + interval '8 days')::timestamptz)`)

  // ─── Sesión en MAIN_MENU (ya procesó el inbound) ──────────────────────────
  const mainMenuState = {
    schemaVersion: 1, flow: 'MAIN_MENU', booking: 'NONE', deposit: 'NONE', handoff: 'NONE',
    cart: [], selections: { categoryId: null, professionalId: null, anyProfessional: false, date: null, slotStartAt: null, appointmentId: null },
    invalidStreak: 0, presentation: { kind: 'plain' }, discardReturnFlow: null, handoffReturnFlow: null,
    catalogMode: 'BOOKING', nameCandidate: null, pendingEntityRef: null, rejectedRecommendationIds: []
  }

  await prisma.$executeRaw(Prisma.sql`INSERT INTO "Conversation" ("id", "phone", "businessId", "updatedAt")
    VALUES (${conversationId}, '5491100000001', ${businessId}, clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotSession" ("id", "businessId", "conversationId", "deploymentId", "deploymentGeneration",
      "businessTimezone", "state", "revision", "updatedAt")
    VALUES (${sessionId}, ${businessId}, ${conversationId}, ${deploymentId}, 1,
      'America/Argentina/Buenos_Aires', ${JSON.stringify(mainMenuState)}::jsonb, 1, clock_timestamp())`)

  // ─── Insertar prompt del menú principal con la opción "Consultar horarios" ─
  const mainMenuPromptId = randomUUID()
  const hoursChoiceToken = promptTokens.generateChoiceToken()
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotPrompt" ("id", "sessionId", "promptToken", "stateRevision", "mode", "status", "openedAt")
    VALUES (${mainMenuPromptId}, ${sessionId}, ${promptTokens.generatePromptToken()}, 1, 'FUNCTIONAL'::"BotPromptMode", 'OPEN'::"BotPromptStatus", clock_timestamp())`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotPromptChoice" ("id", "promptId", "choiceToken", "actionType", "labelSnapshot", "sortOrder")
    VALUES (${randomUUID()}, ${mainMenuPromptId}, ${hoursChoiceToken}, 'menu.business_hours', 'Consultar horarios', 2)`)

  // ─── Simular click: crear BotActionInbox + BotJob ─────────────────────────
  const providerEventId = randomUUID()
  const inboxId = `f56_inbox_${suffix}`
  const jobId = `f56_job_${suffix}`

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotProviderEvent" ("id", "eventKey", "eventType", "businessId", "providerMessageId", "payload")
    VALUES (${providerEventId}, ${`f56_event_${suffix}`}, 'MESSAGE'::"BotProviderEventType", ${businessId},
      ${`wamid.f56.click.${suffix}`}, ${JSON.stringify({ fromPhone: '5491100000001' })}::jsonb)`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotActionInbox" ("id", "businessId", "providerEventId", "sessionId", "promptId", "providerMessageId",
      "choiceToken", "actionType", "deploymentId", "deploymentGeneration", "expectedRevision", "status")
    VALUES (${inboxId}, ${businessId}, ${providerEventId}, ${sessionId}, ${mainMenuPromptId}, ${`wamid.f56.click.${suffix}`},
      ${hoursChoiceToken}, 'menu.business_hours', ${deploymentId}, 1, 1, 'SELECTED'::"BotInboxStatus")`)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "BotJob" ("id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision", "updatedAt")
    VALUES (${jobId}, 'PROCESS_SESSION', ${inboxId}, ${businessId}, ${deploymentId}, 1, 1, clock_timestamp())`)

  // ─── Claim + Process ──────────────────────────────────────────────────────
  const claimToken = randomUUID()
  const claimedRows = await prisma.$queryRaw<Array<{
    id: string; kind: string; aggregateId: string; businessId: string; deploymentId: string
    deploymentGeneration: number; expectedRevision: bigint | null; attempts: number; maxAttempts: number
    claimToken: string; claimedUntil: Date; queueWaitMs: number
  }>>(Prisma.sql`
    UPDATE "BotJob" SET "status" = 'LEASED'::"BotJobStatus", "attempts" = "attempts" + 1,
      "leaseToken" = ${claimToken}, "leasedUntil" = clock_timestamp() + interval '30 seconds', "updatedAt" = clock_timestamp()
    WHERE "id" = ${jobId} AND "status" = 'READY'::"BotJobStatus"
    RETURNING "id", "kind", "aggregateId", "businessId", "deploymentId", "deploymentGeneration", "expectedRevision",
      "attempts", "maxAttempts", "leaseToken" AS "claimToken", "leasedUntil" AS "claimedUntil", 0::double precision AS "queueWaitMs"
  `)
  assert.ok(claimedRows[0], 'job claimable')
  const job = claimedRows[0]!

  const result = await processor.processSessionJob({ client: prisma, job })
  assert.equal(result, 'PROCESSED', 'business_hours processed')

  // ─── Verificar outbox: TODOS los items ────────────────────────────────────
  const outboxRows = await prisma.$queryRaw<Array<{
    id: string; kind: string; payload: unknown; sequence: number
    deliveryGroupId: string; dependsOnSequence: number | null
  }>>(Prisma.sql`
    SELECT "id", "kind", "payload", "sequence", "deliveryGroupId", "dependsOnSequence"
    FROM "BotOutbox" WHERE "businessId" = ${businessId}
    ORDER BY "sequence"
  `)
  assert.ok(outboxRows.length >= 2, `outbox tiene >=2 items: ${outboxRows.length}`)

  // Verificar que TODOS los items comparten el mismo deliveryGroupId
  const deliveryGroupIds = new Set(outboxRows.map((r) => r.deliveryGroupId))
  assert.equal(deliveryGroupIds.size, 1, `todos los items comparten deliveryGroupId: ${[...deliveryGroupIds]}`)

  // Verificar secuencias ordenadas 0,1,2,...
  for (let i = 0; i < outboxRows.length; i++) {
    assert.equal(outboxRows[i]!.sequence, i, `secuencia ${i} correcta`)
  }

  // Verificar dependsOnSequence: interactivo depende del último fragmento previo
  const lastInformativeIdx = outboxRows.findLastIndex((r) => r.kind === 'informative_text')
  const interactiveIdx = outboxRows.findIndex((r) => r.kind === 'interactive')
  if (interactiveIdx >= 0 && lastInformativeIdx >= 0) {
    assert.equal(
      outboxRows[interactiveIdx]!.dependsOnSequence,
      outboxRows[lastInformativeIdx]!.sequence,
      `interactive dependsOnSequence = último informative (${outboxRows[lastInformativeIdx]!.sequence})`
    )
  }

  // Verificar codePointLength≤1024 para TODOS los items
  for (const row of outboxRows) {
    const payload = row.payload as { item?: { body?: string } }
    const body = payload?.item?.body ?? ''
    // countGraphemes: codePoint count (more accurate than .length for emoji/surrogates)
    const codePoints = [...body].length
    assert.ok(codePoints <= 1024, `item ${row.sequence} (${row.kind}) codePoints ${codePoints} ≤ 1024`)
  }

  // ─── Concatenar informativos y verificar contenido completo ────────────────
  const informativeTexts = outboxRows
    .filter((r) => r.kind === 'informative_text')
    .map((r) => {
      const p = r.payload as { item: { body: string } }
      return p.item.body
    })
  const concatenated = informativeTexts.join('\n')
  assert.ok(concatenated.includes('*Lunes*'), 'concatenado contiene Lunes')
  assert.ok(concatenated.includes('*Martes*'), 'concatenado contiene Martes')
  assert.ok(concatenated.includes('*Miércoles*'), 'concatenado contiene Miércoles')
  assert.ok(concatenated.includes('*Jueves*'), 'concatenado contiene Jueves')
  assert.ok(concatenated.includes('*Viernes*'), 'concatenado contiene Viernes')
  assert.ok(concatenated.includes('*Sábado*'), 'concatenado contiene Sábado')
  assert.ok(concatenated.includes('*Domingo*'), 'concatenado contiene Domingo')
  assert.ok(concatenated.includes('09:00 a 18:00'), 'concatenado contiene horario L-V')
  assert.ok(concatenated.includes('10:00 a 14:00'), 'concatenado contiene horario Sáb')
  assert.ok(concatenated.includes('*Domingo*: Cerrado'), 'concatenado contiene domingo cerrado')

  // Excepción (relativa, no hardcodeada)
  assert.ok(concatenated.includes('Excepciones próximas:'), 'concatenado contiene sección excepciones')
  assert.ok(concatenated.includes('Feriado'), 'concatenado contiene excepción HOLIDAY')
  assert.ok(concatenated.includes('Feriado Relativo'), 'concatenado contiene título excepción relativa')
  assert.ok(!concatenated.includes('Detalles internos'), 'concatenado NO contiene note')

  // El interactive body también debe estar dentro de 1024
  const interactiveItem = outboxRows.find((r) => r.kind === 'interactive')
  assert.ok(interactiveItem, 'outbox tiene item interactivo')
  const interactivePayload = interactiveItem!.payload as { item: Record<string, unknown> }
  const body = interactivePayload.item.body as string
  assert.ok(body.includes('¿Qué querés ver?'), 'body interactivo correcto')
  const bodyCodePoints = [...body].length
  assert.ok(bodyCodePoints <= 1024, `interactive body codePoints ${bodyCodePoints} ≤ 1024`)

  // Renderer may produce buttons OR rows; extract all labels
  const rows = interactivePayload.item.rows as Array<{ title: string }> | undefined
  const buttons = interactivePayload.item.buttons as Array<{ title: string }> | undefined
  const allLabels = [
    ...(rows?.map((r) => r.title) ?? []),
    ...(buttons?.map((b) => b.title) ?? [])
  ]
  const hasProfessional = allLabels.some((t) => t.includes('rofesional') || t.includes('orario de un'))
  const hasSearch = allLabels.some((t) => t.includes('uscar') || t.includes('urno disponible'))
  assert.ok(hasProfessional, `opción professional: ${JSON.stringify(allLabels)}`)
  assert.ok(hasSearch, `opción search: ${JSON.stringify(allLabels)}`)

  console.log(`OK F5.6 E2E: outbox ${outboxRows.length} items, ` +
    `${informativeTexts.length} informativos concatenados (${concatenated.length} chars), ` +
    `interactivo OK, deliveryGroupId único, secuencias ordenadas`)

  // ─── Verificar estado no mutó ─────────────────────────────────────────────
  const sessionRows = await prisma.$queryRaw<Array<{ state: unknown; revision: bigint }>>(Prisma.sql`
    SELECT "state", "revision" FROM "BotSession" WHERE "id" = ${sessionId}
  `)
  const state = sessionRows[0]!.state as {
    flow: string; cart: unknown[]; booking: string
    selections: { date: null; slotStartAt: null; professionalId: null; appointmentId: null }
  }
  assert.equal(state.flow, 'BUSINESS_HOURS', 'flow = BUSINESS_HOURS')
  assert.deepEqual(state.cart, [], 'cart vacío (no mutado)')
  assert.equal(state.booking, 'NONE', 'booking NONE (no mutado)')
  assert.equal(state.selections.date, null, 'date null')
  assert.equal(state.selections.slotStartAt, null, 'slotStartAt null')
  assert.equal(state.selections.professionalId, null, 'professionalId null')
  assert.equal(state.selections.appointmentId, null, 'appointmentId null')
  console.log('OK F5.6 E2E: estado no mutó cart/booking/selections/draft')

  // ─── Verificar prompt con opciones correctas ──────────────────────────────
  const promptChoices = await prisma.$queryRaw<Array<{ actionType: string; labelSnapshot: string }>>(Prisma.sql`
    SELECT c."actionType", c."labelSnapshot" FROM "BotPromptChoice" c
    WHERE c."promptId" IN (
      SELECT "id" FROM "BotPrompt" WHERE "sessionId" = ${sessionId} AND "status" = 'OPEN'::"BotPromptStatus"
    ) ORDER BY c."sortOrder"
  `)
  const actionTypes = promptChoices.map((c) => c.actionType)
  assert.ok(actionTypes.includes('hours.professional'), 'prompt hours.professional')
  assert.ok(actionTypes.includes('hours.search_availability'), 'prompt hours.search_availability')
  console.log('OK F5.6 E2E: prompt opciones correctas')

  // ─── Verificar BotTransitionLog ───────────────────────────────────────────
  const transitions = await prisma.$queryRaw<Array<{ actionType: string; outcome: string }>>(Prisma.sql`
    SELECT "actionType", "outcome" FROM "BotTransitionLog" WHERE "sessionId" = ${sessionId} ORDER BY "revisionTo"
  `)
  assert.ok(transitions.some((t) => t.actionType === 'menu.business_hours'), 'transition log tiene menu.business_hours')
  assert.ok(transitions.some((t) => t.outcome === 'APPLIED'), 'outcome APPLIED')
  console.log('OK F5.6 E2E: transition log correcto')

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('OK F5.6 E2E: processSessionJob con menu.business_hours produce')
  console.log('   outbox lunes-domingo + excepción relativa sin mutar estado')
  console.log('═══════════════════════════════════════════════════════════════')
} finally {
  // Cleanup FK-safe order with best-effort catches
  const cleanupErrors: string[] = []
  const safeDelete = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn() } catch (e: unknown) {
      cleanupErrors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  await safeDelete('BotOutbox', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotOutbox" WHERE "businessId" = ${businessId}`))
  await safeDelete('BotPromptChoice', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotPromptChoice" WHERE "promptId" IN (SELECT "id" FROM "BotPrompt" WHERE "sessionId" = ${sessionId})`))
  await safeDelete('BotPrompt', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotPrompt" WHERE "sessionId" = ${sessionId}`))
  await safeDelete('BotActionInbox', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotActionInbox" WHERE "businessId" = ${businessId}`))
  await safeDelete('BotTransitionLog', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotTransitionLog" WHERE "sessionId" = ${sessionId}`))
  await safeDelete('BotDispatchClaim', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotDispatchClaim" WHERE "businessId" = ${businessId}`))
  await safeDelete('BotSession', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotSession" WHERE "id" = ${sessionId}`))
  await safeDelete('BotJob', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotJob" WHERE "businessId" = ${businessId}`))
  await safeDelete('BotChannelDeployment', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotChannelDeployment" WHERE "businessId" = ${businessId}`))
  await safeDelete('BusinessBotConfiguration', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessBotConfiguration" WHERE "businessId" = ${businessId}`))
  await safeDelete('Conversation', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "Conversation" WHERE "id" = ${conversationId}`))
  await safeDelete('BotProviderEvent', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BotProviderEvent" WHERE "businessId" = ${businessId}`))
  await safeDelete('ScheduleBlock', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "ScheduleBlock" WHERE "businessId" = ${businessId}`))
  await safeDelete('BusinessHours', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "BusinessHours" WHERE "businessId" = ${businessId}`))
  await safeDelete('Business', () => prisma.$executeRaw(Prisma.sql`DELETE FROM "Business" WHERE "id" = ${businessId}`))
  if (cleanupErrors.length > 0) {
    console.warn('Cleanup warnings (best-effort):', cleanupErrors.join('; '))
  }
  await prisma.$disconnect()
}

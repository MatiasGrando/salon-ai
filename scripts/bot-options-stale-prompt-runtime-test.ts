import assert from 'node:assert/strict'
import type { Prisma } from '../src/generated/prisma/client.js'
import { processSessionJob } from '../src/bot-options/application/process-session-job.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { STALE_PROMPT_NOTICE } from '../src/bot-options/domain/views.js'

// Exercise the actual PROCESS_INBOX handler and persistView, not a copied implementation.
async function scenario(flow: 'MAIN_MENU' | 'BUSINESS_HOURS' | 'PROFESSIONAL_HOURS_DETAIL' | 'SERVICE_DETAIL' | 'HANDOFF_QUEUED' | 'HANDOFF_TAKEN', textBody = 'Opción vieja', fail = false) {
  let processed = false
  let committed: Prisma.Sql[] = []
  let staged: Prisma.Sql[] = []
  const state = { ...createInitialBotOptionsState(), flow,
    pendingEntityRef: flow === 'PROFESSIONAL_HOURS_DETAIL' ? { type: 'PROFESSIONAL', id: 'p' } : flow === 'SERVICE_DETAIL' ? { type: 'SERVICE', id: 'svc' } : null,
    handoff: flow === 'HANDOFF_TAKEN' ? 'TAKEN' : flow === 'HANDOFF_QUEUED' ? 'QUEUED' : 'NONE',
    handoffReturnFlow: flow.startsWith('HANDOFF') ? 'MAIN_MENU' : null }
  const now = new Date('2026-08-31T17:00:00Z')
  const query = async (q: Prisma.Sql) => {
    const sql = q.text
    if (sql.includes('SELECT e."businessId", d."generation"')) return [{ businessId: 'b', generation: 1, fenceEpoch: 0 }]
    if (sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch' }]
    if (sql.includes('SELECT j."id" FROM "BotJob"')) return [{ id: 'job' }]
    if (sql.includes('SELECT c."id" FROM "BotDispatchClaim"')) return [{ id: 'dispatch' }]
    if (sql.includes('settings."timezone"')) return [{ id: 'inbox', businessId: 'b', deploymentId: 'd', deploymentGeneration: 1,
      providerEventId: 'event', providerMessageId: 'wamid', status: processed ? 'PROCESSED' : 'ADMITTED',
      dbNow: now, businessTimezone: 'UTC', businessName: 'Glow', admittedAt: now, providerOccurredAt: now,
      payload: { fromPhone: '5491100000000', textBody, messageType: 'interactive', contextWindowEvaluated: true, stalePromptClassification: 'STALE_REVISION' } }]
    if (sql.includes('ORDER BY CASE s."status"')) return [{ sessionId: 's', conversationId: 'c', revision: 10n,
      status: flow === 'HANDOFF_TAKEN' ? 'HUMAN_TAKEN' : flow === 'HANDOFF_QUEUED' ? 'HUMAN_QUEUED' : 'ACTIVE', state, businessTimezone: 'UTC' }]
    if (sql.includes('FROM "BotHandoff"')) return [{ handoffId: 'h' }]
    if (sql.includes('FROM "Conversation"') && sql.includes('FOR UPDATE')) return [{ conversationId: 'c' }]
    if (sql.includes('INSERT INTO "Message"')) return [] // journal already projected the inbound
    if (sql.includes('inserted_choices AS')) {
      if (fail) throw new Error('forced outbox rollback')
      staged.push(q)
      const actionCount = q.values.filter(v => typeof v === 'string' && /^(menu\.|hours\.|service\.|handoff\.|navigation\.)/.test(v)).length
      const messages = q.values.filter(v => typeof v === 'string' && v.startsWith('{"to":')).length
      return [{ choiceCount: BigInt(actionCount), outboxCount: BigInt(messages) }]
    }
    throw new Error(`unexpected SQL: ${sql}`)
  }
  const tx = {
    $queryRaw: query,
    $executeRaw: async (q: Prisma.Sql) => { staged.push(q); return 1 },
    businessHours: { findMany: async () => [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }] },
    professional: { findFirst: async () => ({ id: 'p', name: 'Lucas', acceptsBotBookings: true }) },
    professionalHours: { findMany: async () => [{ dayOfWeek: 1, startTime: '13:00', endTime: '20:00' }] },
    service: { findFirst: async () => ({ id: 'svc', name: 'Corte de prueba', description: 'Descripción vigente', catalogCategoryId: 'cat',
      parentServiceId: null, duration: 30, customerDurationMin: null, customerDurationMax: null, price: 1000,
      priceMode: 'FIXED', isBookable: true, attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: true }) },
    scheduleBlock: { findMany: async () => [] }
  }
  const client = {
    $queryRaw: query, $executeRaw: async () => 1,
    $transaction: async (run: (t: typeof tx) => Promise<unknown>) => {
      staged = []
      const result = await run(tx)
      if (staged.some(q => q.text.includes('UPDATE "BotActionInbox"') && q.text.includes("'PROCESSED'"))) processed = true
      committed.push(...staged)
      return result
    }
  }
  const run = () => processSessionJob({ client: client as never, job: {
    id: 'job', aggregateId: 'inbox', kind: 'PROCESS_INBOX', businessId: 'b', deploymentId: 'd', deploymentGeneration: 1,
    expectedRevision: 9n, attempts: 1, maxAttempts: 5, claimToken: 'job-token', claimedUntil: now, queueWaitMs: 0
  } })
  if (fail) {
    await assert.rejects(run, /forced outbox rollback/)
    assert.equal(processed, false)
    assert.equal(committed.some(q => q.text.includes('INSERT INTO "BotPrompt"')), false)
    return []
  }
  await run()
  const firstWrites = committed.filter(q => q.text.includes('INSERT INTO "BotOutbox"')).length
  await run()
  assert.equal(committed.filter(q => q.text.includes('INSERT INTO "BotOutbox"')).length, firstWrites, 'job replay cannot duplicate the response')
  assert.equal(committed.some(q => q.text.includes('UPDATE "BotSession"')), false, 'refresh must not reset or advance functional state')
  return committed.flatMap(q => q.values.filter((v): v is string => typeof v === 'string' && v.startsWith('{"to":'))).map(v => JSON.parse(v).item.body as string)
}

const main = await scenario('MAIN_MENU')
assert.equal(main[0], STALE_PROMPT_NOTICE)
assert.match(main.at(-1)!, /Soy el asistente|Hola de nuevo/)
const hours = await scenario('BUSINESS_HOURS')
assert.equal(hours[0], STALE_PROMPT_NOTICE)
assert.ok(hours.some(body => body.includes('09:00') && body.includes('18:00')), 'refresh reloads real hours instead of an empty generic screen')
const professionalHours = await scenario('PROFESSIONAL_HOURS_DETAIL')
assert.ok(professionalHours.some(body => body.includes('Lucas')))
assert.ok(professionalHours.some(body => body.includes('13:00') && body.includes('20:00')))
const service = await scenario('SERVICE_DETAIL')
assert.ok(service.some(body => body.includes('Corte de prueba') && body.includes('Descripción vigente')))
const queued = await scenario('HANDOFF_QUEUED')
assert.equal(queued[0], STALE_PROMPT_NOTICE)
assert.match(queued.at(-1)!, /equipo/)
assert.deepEqual(await scenario('HANDOFF_TAKEN'), [], 'human ownership remains silent even if taken after admission')
assert.equal((await scenario('MAIN_MENU', 'reiniciar'))[0], STALE_PROMPT_NOTICE, 'interactive label never acts as a restart command')
await scenario('MAIN_MENU', 'old', true)
console.log('OK stale prompt runtime: current view, hours, queued/taken, replay, rollback and no historical command execution.')

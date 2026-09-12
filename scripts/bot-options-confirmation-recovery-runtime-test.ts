import assert from 'node:assert/strict'
import type { Prisma } from '../src/generated/prisma/client.js'
import { processSessionJob } from '../src/bot-options/application/process-session-job.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { prismaHandoffEffectExecutor } from '../src/bot-options/infrastructure/prisma-handoff-effect-executor.js'

async function scenario(mode: 'missing' | 'unknown' | 'confirmed' | 'confirmed-slot' | 'confirmed-name' | 'stale' | 'disabled' | 'handoff' | 'rollback') {
  const now = new Date('2026-09-11T12:00:00Z')
  const recoveringDirectSlot = mode === 'confirmed-slot'
  const recoveringName = mode === 'confirmed-name'
  const state = { ...createInitialBotOptionsState(), flow: recoveringDirectSlot ? 'SLOT_SELECT' : recoveringName ? 'NAME_INPUT' : 'BOOKING_SUMMARY', cart: [{ serviceId: 'svc' }],
    selections: { ...createInitialBotOptionsState().selections, professionalId: 'prof', date: '2026-09-12', slotStartAt: recoveringDirectSlot ? null : '2026-09-12T12:00:00Z' } }
  let committed: Prisma.Sql[] = [], staged: Prisma.Sql[] = [], effects: unknown[] = []
  let contextCalls = 0
  const query = async (q: Prisma.Sql) => {
    const sql = q.text
    if (sql.includes('SELECT s."id" AS "sessionId"')) return [{ sessionId: 's', businessId: 'b', generation: 1, fenceEpoch: 0 }]
    if (sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch' }]
    if (sql.includes('SELECT j."id" FROM "BotJob"')) return [{ id: 'job' }]
    if (sql.includes('SELECT c."id" FROM "BotDispatchClaim"')) return [{ id: 'dispatch' }]
    if (sql.includes('s."status"::text AS "status", clock_timestamp() AS "dbNow"')) return [{ id: 's', businessId: 'b', deploymentId: 'd', deploymentGeneration: 1,
      revision: mode === 'stale' ? 11n : 10n, state, status: mode === 'handoff' ? 'HUMAN_QUEUED' : 'ACTIVE', dbNow: now, toPhone: '5491100000000', conversationId: null, businessTimezone: 'UTC' }]
    if (sql.includes('e."payload" AS "providerPayload"')) return [{ id: 'inbox', actionType: recoveringDirectSlot ? 'slot.select' : recoveringName ? 'name.submit' : 'booking.confirm', entityRef: null,
      payload: recoveringDirectSlot ? { startAt: '2026-09-12T12:00:00Z' } : recoveringName ? { name: 'Ana María' } : null,
      promptId: 'prompt', providerEventId: 'event', providerMessageId: 'wamid', providerPayload: {}, status: 'SELECTED' }]
    if (sql.includes('confirmation_recovery_enabled')) return [{ botEnabled: mode !== 'disabled' }]
    if (sql.includes('SELECT "status"::text AS "status"') && sql.includes('FROM "BotSession"')) return [{ status: 'ACTIVE' }]
    if (sql.includes('INSERT INTO "BotOperation"')) { staged.push(q); return [{ operationKey: 'handoff-operation' }] }
    if (sql.includes('humanHandoffAtText')) return [{ id: 'conversation', currentStep: 'CONFIRMING', aiEnabled: true,
      humanHandoffAtText: null, humanHandoffResolvedAtText: null, dbNow: now }]
    if (sql.includes('confirmation_recovery_evidence')) {
      assert.ok(q.values.includes('b'), 'evidence tenant-scoped')
      assert.ok(q.values.includes('transition:s:11:CONFIRM_VISIT'), 'exact operation, never phone/date heuristic')
      if (mode === 'unknown') throw new Error('database unavailable')
      return mode === 'confirmed' || mode === 'confirmed-slot' || mode === 'confirmed-name'
        ? [{ status: 'COMPLETED', type: 'CONFIRM_VISIT', visitId: 'visit', appointmentId: 'appointment', appointmentStatus: 'CONFIRMED', professionalName: 'Profesional' }]
        : []
    }
    if (sql.includes('inserted_choices AS')) {
      staged.push(q)
      if (mode === 'rollback') throw new Error('outbox unavailable')
      return [{ choiceCount: 0n, outboxCount: 1n }]
    }
    if (sql.includes('WITH inbox AS')) { staged.push(q); return [{ inboxCount: 1n, dispatchCount: 1n, jobCount: 1n }] }
    if (sql.includes('UPDATE "Conversation" conversation')) { staged.push(q); return [] }
    throw new Error(`unexpected SQL: ${sql}`)
  }
  const tx = { $queryRaw: query, $executeRaw: async (q: Prisma.Sql) => { staged.push(q); return 1 } }
  const client = { ...tx, $transaction: async (run: (t: typeof tx) => Promise<unknown>) => {
    staged = []; const result = await run(tx); committed.push(...staged); return result
  } }
  const run = () => processSessionJob({ client: client as never, job: { id: 'job', aggregateId: 'inbox', kind: 'RECOVER_BOOKING_CONFIRMATION', businessId: 'b',
    deploymentId: 'd', deploymentGeneration: 1, expectedRevision: 10n, attempts: 1, maxAttempts: 5, claimToken: 'token', claimedUntil: now, queueWaitMs: 0 },
    contextProvider: async () => { contextCalls++; throw new Error('recovery must not reload booking availability') },
    effectExecutor: async (_tx, input) => { effects.push(...input.effects); await prismaHandoffEffectExecutor(_tx, input) }
  })
  if (mode === 'unknown' || mode === 'rollback') {
    await assert.rejects(run, mode === 'unknown' ? /database unavailable/ : /outbox unavailable/)
    assert.equal(committed.some(q => q.text.includes('UPDATE "BotSession" SET "state"')), false)
    assert.equal(committed.some(q => q.text.includes('INSERT INTO "BotOutbox"')), false)
    if (mode === 'unknown') assert.equal(effects.length, 0)
    return
  }
  await run()
  const messages = committed.flatMap(q => q.values.filter((v): v is string => typeof v === 'string' && v.startsWith('{"to":'))).map(v => JSON.parse(v).item.body)
  assert.equal(contextCalls, 0)
  if (['stale', 'disabled', 'handoff'].includes(mode)) { assert.equal(messages.length, 0); assert.equal(effects.length, 0); return }
  assert.equal(messages.length, 1)
  if (mode === 'missing') {
    assert.match(messages[0], /problema al confirmar/)
    assert.equal((effects[0] as { kind: string }).kind, 'REQUEST_HUMAN_HANDOFF')
    assert.ok(committed.some(q => q.text.includes('INSERT INTO "BotHandoff"') && q.text.includes("'QUEUED'")), 'real executor persists queue')
    assert.ok(committed.some(q => q.text.includes('SET "status" = \'HUMAN_QUEUED\'')), 'real executor marks human queue without TAKE fence')
    assert.ok(committed.some(q => q.text.includes('UPDATE "Conversation" SET "currentStep" = \'HUMAN_HANDOFF\'')), 'CRM pending human attention persists')
    assert.equal(committed.some(q => /SET "handoff(?:FenceEpoch|ClaimsPausedAt)"/.test(q.text)), false, 'queue does not close sender fence')
  }
  else { assert.match(messages[0], /confirmado/); assert.equal(effects.length, 0) }
  assert.doesNotMatch(committed.map(q => q.text).join('\n'), /(?:UPDATE|INSERT INTO|DELETE FROM) "(?:Appointment|BookingVisit|BookingDeposit)"/)
}
for (const mode of ['missing', 'unknown', 'confirmed', 'confirmed-slot', 'confirmed-name', 'stale', 'disabled', 'handoff', 'rollback'] as const) await scenario(mode)
console.log('OK confirmation recovery runtime: missing/confirmed/uncertain, fencing and atomic outbox rollback')

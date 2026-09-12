import assert from 'node:assert/strict'
import type { Prisma } from '../src/generated/prisma/client.js'
import { processSessionJob } from '../src/bot-options/application/process-session-job.js'
import { createInitialBotOptionsState } from '../src/bot-options/domain/state.js'
import { admitPromptChoice, reconcilePrompt, type BotPromptContract } from '../src/bot-options/domain/prompts.js'
import { renderCurrentView } from '../src/bot-options/domain/transition.js'
import { samePromptOptions } from '../src/bot-options/application/reuse-current-prompt.js'
import { classifyFreeTextInput } from '../src/bot-options/infrastructure/prisma-admission.js'

// Shared durable store, separate runtime clients: no process-local debounce is
// allowed. Transactions model the existing PostgreSQL session FOR UPDATE lock.
function fixture() {
  const now = new Date('2026-09-11T17:00:00Z')
  let revision = 10n
  let prompt: { promptId: string; stateRevision: bigint; status: string; deliveryStatus: string; conflictScreen?: boolean; choices: unknown[] } | null = null
  const outbox: string[] = []
  const processed = new Set<string>()
  const projected = new Set<string>()
  const queries: string[] = []
  const reminders = new Set<string>()
  let lock = Promise.resolve()
  const run = async (id: string, messageType = 'text', stale = false) => {
    let sessionLocked = false
    const query = async (q: Prisma.Sql) => {
      const sql = q.text
      queries.push(sql)
      if (sql.includes('SELECT e."businessId", d."generation"')) return [{ businessId: 'b', generation: 1, fenceEpoch: 0 }]
      if (sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: `dispatch-${id}` }]
      if (sql.includes('SELECT j."id" FROM "BotJob"')) return [{ id }]
      if (sql.includes('SELECT c."id" FROM "BotDispatchClaim"')) return [{ id: `dispatch-${id}` }]
      if (sql.includes('settings."timezone"')) return [{ id, businessId: 'b', deploymentId: 'd', deploymentGeneration: 1,
        providerEventId: `event-${id}`, providerMessageId: `wamid-${id}`, status: processed.has(id) ? 'PROCESSED' : 'ADMITTED',
        dbNow: now, businessTimezone: 'UTC', businessName: 'Glow', admittedAt: now, providerOccurredAt: now,
        payload: { fromPhone: '5491100000000', textBody: 'Quiero agregar un detalle', messageType, contextWindowEvaluated: true,
          ...(stale ? { stalePromptClassification: 'EXPIRED' } : {}) } }]
      if (sql.includes('ORDER BY CASE s."status"')) {
        assert.match(sql, /FOR UPDATE OF s/, 'coalescing must share the authoritative PostgreSQL session lock')
        sessionLocked = true
        return [{ sessionId: 's', conversationId: 'c', revision, status: 'ACTIVE', state: createInitialBotOptionsState(), businessTimezone: 'UTC' }]
      }
      if (sql.includes('INSERT INTO "Message"')) { projected.add(id); return [] }
      if (sql.includes('reprompt_current_prompt')) {
        assert.equal(sessionLocked, true, 'durable read must run under the session lock')
        assert.ok(q.values.includes('b') && q.values.includes('s') && q.values.includes(revision), 'tenant/session/revision scope')
        return prompt?.stateRevision === revision ? [prompt] : []
      }
      if (sql.includes('inserted_choices AS')) {
        const values = q.values
        const messages = values.filter((v): v is string => typeof v === 'string' && v.startsWith('{"to":'))
        outbox.push(...messages)
        const choices = values.flatMap((v, index) => typeof v === 'string' && /^(menu\.|handoff\.)/.test(v)
          ? [{ actionType: v, entityType: values[index + 1], entityId: values[index + 2], payload: values[index + 3], sortOrder: values[index + 5] }] : [])
        if (prompt) prompt.choices = choices
        return [{ choiceCount: BigInt(choices.length), outboxCount: BigInt(messages.length) }]
      }
      throw new Error(`unexpected SQL: ${sql}`)
    }
    const tx = { $queryRaw: query, $executeRaw: async (q: Prisma.Sql) => {
      const sql = q.text
      queries.push(sql)
      if (sql.includes('UPDATE "BotActionInbox"') && sql.includes("'PROCESSED'")) processed.add(id)
      if (sql.includes('UPDATE "BotPrompt"') && sql.includes("'INVALIDATED'")) { if (prompt) prompt.status = 'INVALIDATED' }
      if (sql.includes('INSERT INTO "BotPrompt"')) prompt = { promptId: q.values[0] as string, stateRevision: revision, status: 'OPEN', deliveryStatus: 'PENDING', choices: [] }
      if (sql.includes('reprompt_reminder')) {
        assert.match(sql, /ON CONFLICT \("idempotencyKey"\) DO NOTHING/, 'database uniqueness, not a process map, coalesces reminders')
        const key = q.values.find((v): v is string => typeof v === 'string' && v.startsWith('reprompt-reminder:'))!
        if (!reminders.has(`reminder:${key}`)) { outbox.push(`reminder:${key}`); reminders.add(`reminder:${key}`) }
      }
      return 1
    } }
    // Every invocation has a fresh client; only the simulated database is shared.
    const client = { $queryRaw: query, $executeRaw: async () => 1, $transaction: async (operation: (tx: typeof tx) => Promise<unknown>) => {
      const previous = lock
      let release!: () => void
      lock = new Promise<void>(resolve => { release = resolve })
      await previous
      try { return await operation(tx) } finally { release() }
    } }
    return processSessionJob({ client: client as never, job: { id, aggregateId: id, kind: 'PROCESS_INBOX', businessId: 'b', deploymentId: 'd',
      deploymentGeneration: 1, expectedRevision: null, attempts: 1, maxAttempts: 5, claimToken: `job-${id}`, claimedUntil: now, queueWaitMs: 0 } })
  }
  return { run, outbox, processed, projected, queries, get prompt() { return prompt! }, advance() { revision += 1n } }
}

const burst = fixture()
await burst.run('one')
const original = burst.prompt.promptId
const originalOutbox = burst.outbox.length
await burst.run('two')
await burst.run('image', 'image')
assert.equal(burst.prompt.promptId, original, 'text/image burst must keep the original prompt and its buttons')
assert.equal(burst.outbox.length, originalOutbox, 'one pending equivalent screen handles the whole burst')
assert.equal(burst.prompt.status, 'OPEN')
assert.deepEqual([...burst.processed], ['one', 'two', 'image'], 'every inbound remains processed')
assert.deepEqual([...burst.projected], ['one', 'two', 'image'], 'every inbound remains projected to CRM')

// A delivered screen gets exactly one reminder, even from separate workers and
// after that reminder was sent. No new prompt replaces the buttons.
burst.prompt.deliveryStatus = 'READ'
await Promise.all([burst.run('four'), burst.run('five'), burst.run('six', 'image')])
assert.equal(burst.outbox.length, originalOutbox + 1)
assert.equal(burst.prompt.promptId, original)
await burst.run('stale-a', 'interactive', true)
await burst.run('stale-b', 'interactive', true)
assert.equal(burst.outbox.length, originalOutbox + 1, 'stale recovery must reuse the same reminder and prompt')
await burst.run('stale-b', 'interactive', true)
assert.equal(burst.processed.size, 8, 'replay must not consume another inbound')
assert.equal(burst.projected.size, 8)

burst.advance()
await burst.run('new-revision')
assert.notEqual(burst.prompt.promptId, original, 'real state revision changes may create a new screen')
assert.equal(burst.outbox.length, originalOutbox + 2)

for (const selection of ['same', 'different'] as const) {
  const f = fixture()
  await f.run('start')
  const originalPrompt = f.prompt.promptId
  const initial: BotPromptContract = { businessId: 'b', deploymentId: 'd', deploymentGeneration: 1, sessionId: 's', stateRevision: 10n,
    promptId: originalPrompt, mode: 'FUNCTIONAL', status: 'OPEN', firstActionAt: null, lastActionAt: null, settleAt: null, absoluteAt: null, resolvedAt: null,
    choices: [
      { choiceToken: 'a', actionType: 'menu.start_booking', entityRef: null, payload: null, labelSnapshot: 'Turno', sortOrder: 0 },
      { choiceToken: 'b', actionType: 'menu.business_hours', entityRef: null, payload: null, labelSnapshot: 'Horarios', sortOrder: 1 }
    ] }
  const admit = (prompt: BotPromptContract, token: string, id: string, now: number) => admitPromptChoice({ dbNow: now, current: initial,
    prompt, attempt: { ...initial, choiceToken: token, providerEventId: id, providerMessageId: id, receivedAt: now },
    existingProviderEventIds: new Set(), inboxId: id })
  const first = admit(initial, 'a', 'click1', 1000)
  assert.equal(first.classification, 'ADMITTED')
  if (first.classification !== 'ADMITTED') throw new Error('unreachable')
  f.prompt.status = first.prompt.status
  f.prompt.deliveryStatus = 'READ'
  await f.run('additional-text')
  await f.run('additional-image', 'image')
  assert.equal(f.prompt.status, 'STABILIZING', 'invalid inbound cannot erase an admitted selection')
  assert.equal(f.prompt.promptId, originalPrompt)
  assert.equal(f.outbox.length, 1, 'a selection already in flight must own the next response')
  const second = admit({ ...first.prompt, status: f.prompt.status as 'STABILIZING' }, selection === 'same' ? 'a' : 'b', 'click2', 1100)
  assert.equal(second.classification, 'ADMITTED')
  if (second.classification !== 'ADMITTED') throw new Error('unreachable')
  const result = reconcilePrompt({ dbNow: 1600, prompt: second.prompt, actions: [first.action, second.action] })
  assert.equal(result.kind, selection === 'same' ? 'SELECT' : 'CONFLICT')
  if (result.kind === 'SELECT') assert.equal(result.actionStatuses.click2, 'DUPLICATE')
  if (result.kind === 'CONFLICT') assert.equal(result.choices.length, 2, 'customer must confirm which choice to use')
  f.prompt.status = 'RESOLVED'
  await f.run('between-reconcile-and-process')
  assert.equal(f.prompt.promptId, originalPrompt, 'resolved pending selection/conflict also owns the next response')
}

const view = renderCurrentView(createInitialBotOptionsState(), {})
const conflictScreen = fixture()
await conflictScreen.run('initial')
const conflictId = conflictScreen.prompt.promptId
conflictScreen.prompt.conflictScreen = true
conflictScreen.prompt.choices = conflictScreen.prompt.choices.slice(0, 2).map((choice: any, sortOrder) => ({ ...choice, sortOrder, payload: { conflictChoiceToken: `chosen-${sortOrder}` } }))
await conflictScreen.run('after-conflict-text')
assert.equal(conflictScreen.prompt.promptId, conflictId, 'free text must not erase the conflict confirmation screen')
const choices = view.choices.map((c, sortOrder) => ({ actionType: c.actionType, entityType: c.entityRef?.type ?? null, entityId: c.entityRef?.id ?? null, payload: c.payload ?? null, sortOrder }))
assert.equal(samePromptOptions(choices, view), true)
assert.equal(samePromptOptions(choices, { ...view, interactiveBody: 'Different greeting' }), true)
assert.equal(samePromptOptions(choices, { ...view, choices: view.choices.slice(1) }), false)
assert.equal(samePromptOptions([{ ...choices[0]!, entityId: 'different-service' }, ...choices.slice(1)], view), false)
assert.equal(samePromptOptions([{ ...choices[0]!, payload: { serviceId: 'different' } }, ...choices.slice(1)], view), false)
assert.equal(classifyFreeTextInput('MAIN_MENU', 'text', 'Sacar un turno'), null, 'no intent inference or text-to-button mapping')
assert.equal(classifyFreeTextInput('NAME_INPUT', 'text', 'Nombre Real')?.actionType, 'name.submit', 'expected name input bypasses unsolicited reprompts')
console.log('OK reprompt coalescing: bursts, reminders, stale, revision, stabilization, duplicate/conflict, semantics and expected name input.')

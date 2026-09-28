import assert from 'node:assert/strict'
import { resolveConversationPolicy } from '../src/conversational-bot/runtime-policy.js'
import { readConversationDraft, projectConversationDraft } from '../src/conversational-bot/session-state.js'
import { initialDialogueState } from '../src/conversational-bot/engine.js'
import { createInitialBotOptionsState, parseBotOptionsState } from '../src/bot-options/domain/state.js'

const config = { businessId: 'biz', customerCode: 'WX-38N6UG', deploymentId: 'dep', generation: 1,
  configurationId: 'cfg', configurationBusinessId: 'biz', configurationStatus: 'ACTIVE', engineKey: 'deterministic-options',
  definition: { conversation: { schemaVersion: 1, engine: 'conversational-booking-v1' } } }
const policy = resolveConversationPolicy(config)!
assert.ok(policy)
assert.equal(resolveConversationPolicy({ ...config, definition: {} }), null)
for (const wrong of [{ customerCode: 'other' }, { configurationBusinessId: 'other' }, { configurationStatus: 'DRAFT' },
  { definition: { conversation: { schemaVersion: 2, engine: 'conversational-booking-v1' } } }]) {
  assert.throws(() => resolveConversationPolicy({ ...config, ...wrong }))
}
const initial = createInitialBotOptionsState()
assert.deepEqual(readConversationDraft(initial, policy, 'UTC'), initialDialogueState('biz'))
const draft = { ...initialDialogueState('biz'), pending: 'date' as const, serviceId: 'cut' }
const projected = projectConversationDraft(draft, policy)
assert.equal(projected.flow, 'DATE_SELECT')
assert.equal(projected.booking, 'DRAFT')
assert.deepEqual(projected.cart, [{ serviceId: 'cut' }])
assert.equal(parseBotOptionsState(projected).ok, true)
assert.deepEqual(readConversationDraft(projected, policy, 'UTC'), draft)
assert.throws(() => readConversationDraft(projected, { ...policy, configurationId: 'other' }, 'UTC'))
assert.throws(() => readConversationDraft({ ...initial, flow: 'NAME_INPUT' }, policy, 'UTC'))
assert.deepEqual(readConversationDraft(createInitialBotOptionsState(), policy, 'UTC'), initialDialogueState('biz'))
console.log('conversational runtime policy/session: PASS')

// The public worker entry must select the new engine, not just expose unused helpers.
const { processSessionJob } = await import('../src/bot-options/application/process-session-job.js')
let sawWorkerPolicy = false
const entryClient = {
  $queryRaw: async (query: { sql: string }) => {
    if (query.sql.includes('conversation-policy')) { sawWorkerPolicy = true; throw new Error('POLICY_ENTRY_REACHED') }
    throw new Error('legacy entry reached instead')
  }
} as never
await assert.rejects(processSessionJob({ client: entryClient, job: { id: 'job', kind: 'PROCESS_INBOX', businessId: 'biz', deploymentId: 'dep', deploymentGeneration: 1, aggregateId: 'inbox', attempts: 1 } as never }), /POLICY_ENTRY_REACHED/)
assert.equal(sawWorkerPolicy, true)

const { PrismaAuthoritativeAdmissionRepository } = await import('../src/bot-options/infrastructure/prisma-admission.js')
async function admit(marked: boolean, type = 'text', interactiveReplyId?: string) {
  const writes: Array<{ sql: string; values: unknown[] }> = []
  let nameReads = 0
  const tx = { $queryRaw: async (q: { sql: string; values: unknown[] }) => {
    if (q.sql.includes('conversation-policy')) return [{ ...config, definition: marked ? config.definition : {} }]
    if (q.sql.includes('FROM "BotPrompt" p')) return [{ promptId: 'old' }]
    if (q.sql.includes('AS "flow"')) { nameReads++; return [{ sessionId: 'session', revision: 5n, flow: 'NAME_INPUT', dbNow: new Date() }] }
    return []
  }, $executeRaw: async (q: { sql: string; values: unknown[] }) => { writes.push(q); return 1 } }
  await new PrismaAuthoritativeAdmissionRepository(tx as never, { depositProofIngressEnabled: true }).classifyProviderEventTx(tx as never, {
    route: { kind: 'new', businessId: 'biz', deploymentId: 'dep', generation: 1, appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null },
    event: { kind: 'message', interactiveReplyId, messageType: type, textBody: 'que servicios hay', fromPhone: 'phone', providerMessageId: 'msg', phoneNumberId: 'channel' } as never,
    providerEventId: 'event'
  })
  return { writes, nameReads }
}
const admitted = await admit(true)
assert.equal(admitted.nameReads, 0, 'marked conversational NAME_INPUT must not intercept information as name.submit')
assert.ok(admitted.writes.some(q => q.values.includes('PROCESS_INBOX')))
const legacyAdmission = await admit(false)
assert.equal(legacyAdmission.nameReads, 1)
assert.ok(legacyAdmission.writes.some(q => q.values.includes('name.submit')))
const mediaAdmission = await admit(true, 'image')
assert.ok(mediaAdmission.writes.some(q => q.values.includes('PROCESS_INBOX')))
assert.ok(!mediaAdmission.writes.some(q => q.values.includes('RECEIVE_DEPOSIT_PROOF')))

// Stateful offline client: execute the public entry, real engine, claims, CRM and persistView.
// SQL tags identify statements; this proves orchestration/fencing, not PostgreSQL contention.
type Query = { sql: string; values: unknown[] }
function runtimeFixture() {
  const now = new Date('2026-10-01T12:00:00Z')
  let inTransaction = false
  let row = { ...config, id: 'inbox', deploymentGeneration: 1, fenceEpoch: 1, payload: { fromPhone: 'phone', textBody: 'Corte', messageType: 'text', contextWindowEvaluated: true },
    providerEventId: 'event', providerMessageId: 'msg', status: 'ADMITTED', dbNow: now, businessTimezone: 'UTC', admittedAt: now, providerOccurredAt: now, botEnabled: true }
  let session: { sessionId: string; conversationId: string; revision: bigint; status: string; state: unknown; businessTimezone: string; handoffFenceEpoch: number; handoffClaimsPausedAt: Date | null; deploymentId: string; deploymentGeneration: number } | null = null
  let replies: string[] = []
  let settled = 0
  let retried = 0
  let messages = 0
  let blocked = false
  let failCommit = false
  let invalidClaim = false
  const statements: Query[] = []
  let prepareHook: (() => void) | undefined
  const client = {
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      assert.equal(inTransaction, false)
      const backup = structuredClone({ row, session, replies, settled, retried, messages })
      inTransaction = true
      try {
        const result = await operation(client)
        if (failCommit && replies.length > backup.replies.length) throw new Error('COMMIT failed')
        return result
      } catch (error) {
        ;({ row, session, replies, settled, retried, messages } = backup)
        throw error
      } finally { inTransaction = false }
    },
    async $queryRaw(q: Query) {
      statements.push(q)
      if (q.sql.includes('conversation-policy')) return [row]
      if (q.sql.includes('FROM "BotProviderEvent" e') && q.sql.includes('d."id" AS "deploymentId"')) return [row]
      if (q.sql.includes('SELECT e."businessId", d."generation"')) return [row]
      if (q.sql.includes('b."name" AS "businessName"') && q.sql.includes('FROM "BotActionInbox"')) return [row]
      if (q.sql.includes('lazy-context:greeting')) return [{ ...row, businessName: 'Salon', customerName: null }]
      if (q.sql.includes('conversation-feature-lock')) return []
      if (q.sql.includes('conversation-target')) return [{ fenceEpoch: row.fenceEpoch }]
      if (q.sql.includes('INSERT INTO "BotDispatchClaim"')) return [{ claimToken: 'dispatch-token' }]
      if (q.sql.includes('SELECT j."id" FROM "BotJob"')) return invalidClaim ? [] : [{ id: 'job' }]
      if (q.sql.includes('SELECT c."id" FROM "BotDispatchClaim"')) return invalidClaim ? [] : [{ id: 'claim' }]
      if (q.sql.includes('conversation-inbox-lock')) return [structuredClone(row)]
      if (q.sql.includes('conversation-order')) return [{ blocked }]
      if (q.sql.includes('INSERT INTO "Conversation"')) return [{ id: 'conversation' }]
      if (q.sql.includes('s."id" AS "sessionId", c."id" AS "conversationId"')) return session ? [structuredClone(session)] : []
      if (q.sql.includes('"BotHandoff"') && q.sql.includes('FOR UPDATE')) return [{ handoffId: 'handoff' }]
      if (q.sql.includes('AS "conversationId" FROM "Conversation"')) return [{ conversationId: 'conversation' }]
      if (q.sql.includes('INSERT INTO "Message"')) { messages++; return [] }
      if (q.sql.includes('conversation-create-session')) {
        session = { sessionId: 'session', conversationId: 'conversation', revision: 0n, status: 'ACTIVE', state: createInitialBotOptionsState(), businessTimezone: 'UTC', handoffFenceEpoch: 0, handoffClaimsPausedAt: null, deploymentId: 'dep', deploymentGeneration: 1 }
        return [{ id: session.sessionId }]
      }
      if (q.sql.includes('UPDATE "Conversation" conversation')) return []
      if (q.sql.includes('inserted_outbox')) {
        const payloads = q.values.filter(v => typeof v === 'string' && v.startsWith('{')).map(v => JSON.parse(v as string)).filter(v => v.item)
        for (const payload of payloads) { assert.ok(['informative_text', 'interactive'].includes(payload.item.type)); replies.push(payload.item.body) }
        return [{ choiceCount: q.sql.includes('INSERT INTO "BotPromptChoice"') ? 5n : 0n, outboxCount: BigInt(payloads.length) }]
      }
      throw new Error(`unhandled runtime query: ${q.sql.slice(0, 160)}`)
    },
    async $executeRaw(q: Query) {
      statements.push(q)
      assert.ok(!q.sql.includes('INSERT INTO "Appointment"') && !q.sql.includes('INSERT INTO "BookingVisit"'), 'proposal must never create bookings')
      if (q.sql.includes('conversation-generation-reset')) { assert.ok(session); session.deploymentGeneration = 1; session.state = createInitialBotOptionsState(); session.revision++ }
      if (q.sql.includes('conversation-save') || (q.sql.includes('UPDATE "BotSession" SET "state"') && q.values.some(v => typeof v === 'string' && v.includes('schemaVersion')))) {
        assert.ok(session)
        session.state = JSON.parse(q.values.find(v => typeof v === 'string' && v.includes('"schemaVersion"')) as string)
        session.revision = q.values.find(v => typeof v === 'bigint') as bigint
      }
      if (q.sql.includes('conversation-settle')) row.status = 'PROCESSED'
      if (q.sql.includes('UPDATE "BotJob" SET "status" = \'DONE\'')) settled++
      if (q.sql.includes('UPDATE "BotJob" SET "status" = \'READY\'')) retried++
      return 1
    }
  }
  const dialogueFactory = async () => {
    assert.equal(inTransaction, false, 'repository preparation must execute outside transaction')
    prepareHook?.()
    const outside = () => assert.equal(inTransaction, false, 'engine repository query must execute outside transaction')
    return { context: { businessId: 'biz', timezone: 'UTC', dbNow: now }, port: {
      catalog: async () => { outside(); return [{ id: 'cut', name: 'Corte', durationMinutes: 30, requiresConsultation: false, price: 1000 }] },
      availability: async () => { outside(); return { professionals: [{ id: 'ana', name: 'Ana', priority: 0 }], slots: [{ date: '2026-10-02', time: '14:00', startAt: '2026-10-02T14:00:00Z', professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON' as const, occupiedMinutes: 0 }] } }
    } }
  }
  let number = 0
  const run = (kind = 'PROCESS_INBOX') => processSessionJob({ client: client as never, dialogueFactory, job: { id: `job-${number}`, kind, businessId: 'biz', deploymentId: 'dep', deploymentGeneration: 1, aggregateId: row.id, attempts: 1, claimToken: 'job-token', expectedRevision: null } as never })
  return { run, get session() { return session! }, get row() { return row }, get replies() { return replies }, get settled() { return settled }, get retried() { return retried }, get messages() { return messages }, statements,
    next(text: string, type = 'text') { number++; row = { ...row, id: `inbox-${number}`, providerEventId: `event-${number}`, providerMessageId: `msg-${number}`, status: 'ADMITTED', payload: { ...row.payload, textBody: text, messageType: type } } },
    hook(fn: () => void) { prepareHook = fn }, block(value: boolean) { blocked = value }, failCommit() { failCommit = true }, invalidateClaim() { invalidClaim = true } }
}
const runtime = runtimeFixture()
await runtime.run()
assert.equal(runtime.session.state && (runtime.session.state as typeof projected).flow, 'DATE_SELECT')
assert.equal(runtime.replies.length, 1)
assert.match(runtime.replies[0]!, /día/)
assert.equal(runtime.row.status, 'PROCESSED')
runtime.next('mañana'); await runtime.run()
assert.equal((runtime.session.state as typeof projected).conversationDraft.dialogue.date, '2026-10-02')
runtime.next('Ana'); await runtime.run()
runtime.next('14:00'); await runtime.run()
assert.equal((runtime.session.state as typeof projected).flow, 'NAME_INPUT')
runtime.next('soy Lucia'); await runtime.run()
assert.equal((runtime.session.state as typeof projected).flow, 'BOOKING_SUMMARY')
assert.equal((runtime.session.state as typeof projected).booking, 'DRAFT')
assert.equal((runtime.session.state as typeof projected).selections.professionalId, 'ana')
const beforeInfo = structuredClone((runtime.session.state as typeof projected).conversationDraft.dialogue)
runtime.next('que servicios hay'); await runtime.run()
assert.deepEqual((runtime.session.state as typeof projected).conversationDraft.dialogue, beforeInfo)
runtime.next('', 'image'); await runtime.run()
assert.deepEqual((runtime.session.state as typeof projected).conversationDraft.dialogue, beforeInfo)
assert.match(runtime.replies.at(-1)!, /texto/)
runtime.next('/reiniciar'); await runtime.run()
assert.deepEqual(runtime.session.state, createInitialBotOptionsState(), 'restart removes the sidecar')
runtime.next('hola'); await runtime.run()
assert.equal((runtime.session.state as typeof projected).conversationDraft.dialogue.serviceId, null)

for (const change of ['revision', 'config', 'human', 'disabled', 'fence', 'order'] as const) {
  const race = runtimeFixture()
  race.hook(() => {
    if (change === 'revision') race.session.revision++
    if (change === 'config') race.row.configurationId = 'replacement'
    if (change === 'human') race.session.status = 'HUMAN_TAKEN'
    if (change === 'disabled') race.row.botEnabled = false
    if (change === 'fence') race.session.handoffFenceEpoch++
    if (change === 'order') race.block(true)
  })
  await race.run()
  assert.equal(race.replies.length, 0, `${change} suppresses stale preparation`)
  assert.equal(race.messages, 1, 'inbound remains in CRM')
  if (change === 'human' || change === 'disabled') assert.equal(race.row.status, 'PROCESSED')
  else { assert.equal(race.row.status, 'ADMITTED'); assert.equal(race.retried, 1) }
}
const retryRuntime = runtimeFixture()
retryRuntime.hook(() => { retryRuntime.session.revision++; retryRuntime.hook(() => {}) })
await retryRuntime.run(); assert.equal(retryRuntime.row.status, 'ADMITTED')
await retryRuntime.run(); retryRuntime.next('mañana'); await retryRuntime.run()
assert.equal(retryRuntime.replies.length, 2, 'two independent inputs survive revision retry')
assert.equal((retryRuntime.session.state as typeof projected).conversationDraft.dialogue.date, '2026-10-02')
const rollback = runtimeFixture(); rollback.failCommit()
await assert.rejects(rollback.run(), /COMMIT failed/)
assert.equal(rollback.row.status, 'ADMITTED'); assert.equal(rollback.replies.length, 0)
assert.equal(rollback.session.revision, 0n, 'state and output roll back together')
const fenced = runtimeFixture(); fenced.hook(() => fenced.invalidateClaim())
await assert.rejects(fenced.run(), /stale or fenced/)
assert.equal(fenced.replies.length, 0); assert.equal(fenced.row.status, 'ADMITTED')
console.log('conversational public worker/admission: PASS')

const switched = runtimeFixture(); await switched.run(); switched.next('mañana')
switched.hook(() => { switched.row.configurationId = 'cfg-new'; switched.hook(() => {}) })
await switched.run(); assert.equal(switched.row.status, 'ADMITTED')
await switched.run()
assert.equal(switched.row.status, 'PROCESSED', 'replacement config must retry the same durable event successfully')
assert.equal((switched.session.state as typeof projected).conversationDraft.dialogue.serviceId, null, 'replacement never reuses old booking fields')
assert.equal((switched.session.state as typeof projected).conversationDraft.dialogue.date, '2026-10-02', 'replacement preserves current durable message')

const { applyLazyContextWindowTx } = await import('../src/bot-options/application/lazy-context-window.js')
async function expireConversation(enabled: boolean) {
  let resetState: unknown = null
  let views = 0
  const fake = {
    async $queryRaw(q: Query) {
      if (q.sql.includes('lazy-context:session')) return [{ id: 'session', revision: 3n, state: projected, status: 'ACTIVE', deploymentGeneration: 1,
        draftTouchedAt: new Date('2026-09-29T12:00:00Z'), draftExpiresAt: new Date('2026-09-30T12:00:00Z'), dbNow: new Date('2026-10-01T12:00:00Z'), hasInbox: false, durableProtection: false, botEnabled: enabled }]
      if (q.sql.includes('lazy-context:guard')) return [{ busy: false, protectedDelivery: false }]
      if (q.sql.includes('lazy-context:greeting')) return [{ ...config, businessName: 'Salon', customerName: null }]
      throw new Error('unhandled expiry query')
    },
    async $executeRaw(q: Query) {
      if (q.sql.includes('lazy-context:reset */')) resetState = JSON.parse(q.values.find(v => typeof v === 'string' && v.includes('schemaVersion')) as string)
      return 1
    }
  }
  const result = await applyLazyContextWindowTx(fake as never, { businessId: 'biz', deploymentId: 'dep', generation: 1, providerEventId: 'expiry', phone: 'phone', admittedAt: new Date('2026-10-01T12:00:00Z'), providerOccurredAt: null, isMedia: false }, async (_tx, input) => {
    views++; assert.equal(input.view.choices.length, 0, 'marked expiry must render plain text')
  })
  return { result, views, resetState }
}
assert.equal((await expireConversation(false)).views, 0, 'bot-disabled expiry cannot enqueue an autoreply before admission')
const activeExpiry = await expireConversation(true)
assert.equal(activeExpiry.result.kind, 'EXPIRED')
assert.deepEqual(activeExpiry.resetState, createInitialBotOptionsState(), 'expiry removes sidecar and booking fields')

const { generatePromptToken, generateChoiceToken, buildInteractiveActionId } = await import('../src/bot-options/domain/prompt-tokens.js')
const oldInteractive = await admit(true, 'interactive', buildInteractiveActionId(generatePromptToken(), generateChoiceToken()))
assert.ok(oldInteractive.writes.some(q => q.values.includes('interactive action not supported by conversational policy')))
assert.ok(!oldInteractive.writes.some(q => q.values.includes('PROCESS_SESSION') || q.values.includes('PROCESS_INBOX')))
const migration = runtimeFixture(); await migration.run(); migration.session.state = { ...createInitialBotOptionsState(), flow: 'NAME_INPUT' }; migration.next('mañana'); await migration.run()
assert.equal(migration.row.status, 'PROCESSED')
assert.equal((migration.session.state as typeof projected).conversationDraft.dialogue.serviceId, null)
assert.match(migration.replies.at(-1)!, /configuración/)
const removed = runtimeFixture(); await removed.run(); removed.row.definition = {} as typeof config.definition; removed.next('hola'); await removed.run()
assert.deepEqual(removed.session.state, createInitialBotOptionsState())
assert.match(removed.replies.at(-2)!, /Recibí tu mensaje/)
for (const change of ['human', 'disabled'] as const) {
  const silent = runtimeFixture(); await silent.run(); silent.row.definition = {} as typeof config.definition; silent.next('hola')
  if (change === 'human') silent.session.status = 'HUMAN_QUEUED'; else silent.row.botEnabled = false
  const count = silent.replies.length; const state = structuredClone(silent.session.state)
  await silent.run(); assert.equal(silent.replies.length, count); assert.deepEqual(silent.session.state, state)
}
console.log('conversational config/expiry/legacy boundaries: PASS')
const cutover = runtimeFixture()
await cutover.run('RECOVER_CUTOVER')
assert.equal(cutover.settled, 1, 'actual recovery job settles instead of rescheduling itself')
assert.ok(cutover.statements.some(q => q.values.includes('PROCESS_INBOX') && q.values.some(v => typeof v === 'string' && v.startsWith('cutover-recovery:'))))
assert.equal(cutover.replies.length, 0, 'recovery enqueues the existing worker, never sends inline')
await cutover.run()
assert.equal(cutover.replies.length, 1)
console.log('conversational actual cutover recovery: PASS')
const oldGeneration = runtimeFixture(); await oldGeneration.run(); oldGeneration.session.deploymentGeneration = 0; oldGeneration.next('mañana'); await oldGeneration.run()
assert.equal(oldGeneration.session.deploymentGeneration, 1)
assert.equal((oldGeneration.session.state as typeof projected).conversationDraft.dialogue.serviceId, null)
assert.equal(oldGeneration.row.status, 'PROCESSED')

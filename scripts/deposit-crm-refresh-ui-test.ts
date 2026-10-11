import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const start = source.indexOf('    function startCrmRealtimeEvents()')
const end = source.indexOf('    async function refreshConversationsFromRealtime(', start)
assert.ok(start >= 0 && end > start)
const failures: string[] = []
let passed = 0
async function test(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); passed++; console.log('PASS', name) }
  catch (error) { failures.push(name); console.error('FAIL', name, error instanceof Error ? error.message : '') }
}
function fixture() {
  const handlers = new Map<string, (event?: unknown) => void>()
  const timers = new Map<number, () => unknown>(); let timerId = 0
  const refreshes: any[] = []; let polls = 0, agendas = 0
  let release: (() => void) | undefined
  const document = { body: { dataset: { currentSection: 'agenda' } } }
  const state: any = { businessId: 'tenant-a', selected: { id: 'conversation-a' }, knownInboundMessageIds: new Set(),
    realtimePendingConversationIds: new Set(), realtimePendingFullConversationIds: new Set(), realtimePendingMessageIds: new Set() }
  const context = vm.createContext({ state, CRM_REALTIME_EVENTS_ENABLED: true, CRM_REALTIME_DEBOUNCE_MS: 180,
    document, window: { EventSource: true }, URLSearchParams,
    EventSource: class { addEventListener(name: string, cb: any) { handlers.set(name, cb) } close() {} },
    setTimeout(cb: () => unknown) { const id = ++timerId; timers.set(id, cb); return id }, clearTimeout(id: number) { timers.delete(id) },
    console, playIncomingMessageSound() {}, refreshInstagramPublication: async () => {},
    loadAgenda: async () => { agendas++ },
    refreshConversationsFromRealtime: async (input: any) => { refreshes.push(input); if (refreshes.length === 1) await new Promise<void>(resolve => { release = resolve }) }
  })
  vm.runInContext(source.slice(start, end), context)
  vm.runInContext('startCrmRealtimeFallback=()=>{ fixturePoll() }; stopCrmRealtimeFallback=()=>{}', Object.assign(context, { fixturePoll: () => { polls++ } }))
  vm.runInContext('startCrmRealtimeEvents()', context)
  async function tick() { const entries = [...timers]; timers.clear(); for (const [, cb] of entries) void cb(); await new Promise(resolve => setImmediate(resolve)) }
  return { state, document, handlers, timers, refreshes, tick, release: () => release?.(), get polls() { return polls }, get agendas() { return agendas } }
}
await test('receipt invalidates deposits, visible agenda and selected conversation', async () => {
  const f = fixture()
  f.handlers.get('deposit_updated')!({ data: JSON.stringify({ businessId: 'tenant-a', depositId: 'deposit-a' }) })
  await f.tick()
  assert.equal(f.agendas, 1)
  assert.deepEqual(Array.from(f.refreshes[0].conversationIds), ['conversation-a'])
  assert.equal(f.refreshes[0].refreshDeposits, true)
  f.release()
})
await test('metadata arriving during refresh is drained without conversation IDs', async () => {
  const f = fixture()
  f.handlers.get('deposit_updated')!({ data: JSON.stringify({ businessId: 'tenant-a', depositId: 'deposit-a' }) })
  await f.tick()
  f.state.realtimeNeedsDepositRefresh = true
  f.state.realtimeNeedsCountsRefresh = true
  f.release(); await new Promise(resolve => setImmediate(resolve))
  assert.ok(f.timers.size > 0, 'finally must schedule pending metadata')
  await f.tick()
  assert.equal(f.refreshes.length, 2)
  assert.equal(f.refreshes[1].refreshDeposits, true)
  assert.equal(f.refreshes[1].refreshCounts, true)
})
await test('SSE reconnect reconciles metadata and current conversation without parallel polling', async () => {
  const f = fixture(); f.handlers.get('open')!(); await f.tick()
  assert.equal(f.polls, 0)
  assert.equal(f.agendas, 1)
  assert.equal(f.refreshes[0]?.refreshDeposits, true)
  assert.equal(f.refreshes[0]?.refreshCounts, true)
  assert.deepEqual(Array.from(f.refreshes[0].conversationIds), ['conversation-a'])
  f.release()
})
await test('hidden agenda and absent selection request only deposit metadata', async () => {
  const f = fixture(); f.state.selected = null; f.document.body.dataset.currentSection = 'conversations'
  // Browser section visibility is a separate guard, not a polling trigger.
  f.handlers.get('deposit_updated')!({ data: JSON.stringify({ businessId: 'tenant-a', depositId: 'deposit-a' }) })
  await f.tick()
  assert.equal(f.refreshes[0].refreshDeposits, true)
  assert.equal(f.refreshes[0].conversationIds.length, 0)
  assert.equal(f.agendas, 0)
  f.release()
})
await test('foreign tenant notification schedules nothing', async () => {
  const f = fixture()
  f.handlers.get('deposit_updated')!({ data: JSON.stringify({ businessId: 'tenant-b', depositId: 'deposit-b' }) })
  await f.tick(); assert.equal(f.agendas, 0); assert.equal(f.refreshes.length, 0)
})
console.log(`${passed} passed; ${failures.length} failed`)
assert.equal(failures.length, 0, failures.join('; '))
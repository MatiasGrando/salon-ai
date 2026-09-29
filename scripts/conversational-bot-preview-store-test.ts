import assert from 'node:assert/strict'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'
import type { DialogueState } from '../src/conversational-bot/engine.js'
const rows = new Map<string, { id: string; supportBotKey: string | null; supportBotState: DialogueState | null }>()
const messages: Array<{ phone: string; direction: string; body: string; metadata: any }> = []
let lockTail = Promise.resolve()
const client = {
  conversation: { findUnique: async ({ where }: any) => structuredClone(rows.get(where.id ?? `${where.businessId_phone.businessId}:${where.businessId_phone.phone}`) ?? null) },
  async $transaction<T>(work: (tx: any) => Promise<T>, options: any): Promise<T> {
    assert.equal(options.timeout, 10_000)
    let unlock = () => {}
    const tx = {
      async $queryRaw() {
        const previous = lockTail
        lockTail = new Promise<void>(resolve => { unlock = resolve })
        await previous
        return [{ id: 'locked' }]
      },
      conversation: {
        upsert: async ({ where, create }: any) => {
          const key = `${create.businessId}:${where.businessId_phone.phone}`
          if (!rows.has(key)) rows.set(key, { id: key, supportBotKey: null, supportBotState: null })
          return rows.get(key)!
        },
        findUnique: async ({ where }: any) => structuredClone(rows.get(where.id)),
        update: async ({ where, data }: any) => { Object.assign(rows.get(where.id)!, data) }
      },
      message: { create: async ({ data }: any) => { messages.push({ phone: data.phone, direction: data.direction, body: data.body, metadata: data.metadata }) } }
    }
    try { return await work(tx) } finally { unlock() }
  }
}
const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-28T15:00:00Z') }
let catalogCalls = 0
let firstCatalogSettled = false
const port = { catalog: async () => {
  if (++catalogCalls === 1) { await new Promise(resolve => setTimeout(resolve, 25)); firstCatalogSettled = true }
  else assert.equal(firstCatalogSettled, true, 'same-process second turn must wait for first slow compute')
  return [{ id: 'cut', name: 'Corte Hombre', durationMinutes: 30, price: 5000, requiresConsultation: false }] }, availability: async () => ({ professionals: [{ id: 'ana', name: 'Ana', priority: 0 }], slots: [{ startAt: '2026-09-29T20:00:00.000Z', date: '2026-09-29', time: '17:00', professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON' as const, occupiedMinutes: 0 }] }) }
const factory = async () => ({ context, port })
const [first, second] = await Promise.all([
  runPrismaDemoPreview(client, 'qa', 'admin', 'same', 'quiero Corte Hombre', factory),
  runPrismaDemoPreview(client, 'qa', 'admin', 'same', 'mañana', factory)
])
assert.equal(first.state.serviceId, 'cut')
assert.equal(second.state.serviceId, 'cut', 'concurrent second turn uses first committed state')
assert.equal(second.state.date, '2026-09-29')
assert.deepEqual(messages.map(m => m.direction), ['INBOUND', 'OUTBOUND', 'INBOUND', 'OUTBOUND'])
assert.deepEqual(messages.filter(m => m.direction === 'INBOUND').map(m => m.body), ['quiero Corte Hombre', 'mañana'])
assert.equal(rows.get('qa:demo:preview:admin:same')?.supportBotKey, 'conversational-preview')
assert.equal(second.timings.lockMs >= 0, true)
const fresh = await runPrismaDemoPreview(client, 'qa', 'admin', 'another', 'hola', factory)
assert.equal(fresh.state.serviceId, null)
assert.equal(messages.length, 6)

let aiCalls = 0
const aiTurn = await runPrismaDemoPreview(client, 'qa', 'admin', 'ai-session', 'hola', factory, async () => { aiCalls++; return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null } })
assert.equal(aiCalls, 1)
assert.equal(aiTurn.interpretation.mode, 'ai')
assert.ok('decision' in aiTurn.interpretation)
const outbound = messages.find(m => m.phone.endsWith('ai-session') && m.direction === 'OUTBOUND')!
assert.equal(outbound.metadata.interpretation.mode, 'ai')
assert.equal(typeof outbound.metadata.interpretation.providerMs, 'number')
assert.deepEqual(outbound.metadata.interpretation.decision, aiTurn.interpretation.decision, 'safe decision codes survive QA persistence')
assert.deepEqual(Object.keys(outbound.metadata.interpretation.decision).sort(), ['acceptedAction', 'candidateCount', 'outcome', 'pendingAfter', 'pendingBefore', 'proposedIntent', 'reason'])
assert.equal(outbound.metadata.interpretation.decision.pendingBefore, 'service')
assert.equal(outbound.metadata.interpretation.decision.pendingAfter, 'service')
assert.equal(JSON.stringify(outbound.metadata).includes('hola'), false, 'diagnostic metadata excludes message content')

const aiSecond = await runPrismaDemoPreview(client, 'qa', 'admin', 'ai-session', 'mañana', factory, async () => { aiCalls++; return { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null } })
assert.equal(aiCalls, 2, 'enabled interpreter runs on every QA turn')
assert.equal(aiSecond.interpretation.mode, 'ai')
const fallbackTurn = await runPrismaDemoPreview(client, 'qa', 'admin', 'fallback-session', 'hola', factory, async () => { throw new Error('private detail') })
assert.equal(fallbackTurn.interpretation.mode, 'fallback')
assert.equal(fallbackTurn.interpretation.reason, 'provider_error')
const fallbackMetadata = messages.find(m => m.phone.endsWith('fallback-session') && m.direction === 'OUTBOUND')!.metadata
assert.equal(fallbackMetadata.interpretation.mode, 'fallback')
assert.equal(fallbackMetadata.interpretation.decision.reason, 'provider_error')
assert.equal(fallbackMetadata.interpretation.decision.acceptedAction, 'deterministic_fallback')
assert.equal(JSON.stringify(fallbackMetadata).includes('private detail'), false)


const quickTimeout = await runPrismaDemoPreview(client, 'qa', 'admin', 'quick-timeout', 'hola', factory, async () => new Promise(() => {}), 20)
assert.equal(quickTimeout.interpretation.mode, 'fallback')
assert.equal(quickTimeout.interpretation.reason, 'timeout', 'QA timeout is propagated through Prisma store')
console.log('conversational preview transactional store: OK')

import assert from 'node:assert/strict'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'
import type { DialogueState } from '../src/conversational-bot/engine.js'
const rows = new Map<string, { id: string; supportBotKey: string | null; supportBotState: DialogueState | null }>()
const messages: Array<{ phone: string; direction: string; body: string }> = []
let lockTail = Promise.resolve()
const client = {
  conversation: { upsert: async ({ where, create }: any) => {
    const key = `${create.businessId}:${where.businessId_phone.phone}`
    if (!rows.has(key)) rows.set(key, { id: key, supportBotKey: null, supportBotState: null })
    return rows.get(key)!
  } },
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
        findUnique: async ({ where }: any) => rows.get(where.id),
        update: async ({ where, data }: any) => { Object.assign(rows.get(where.id)!, data) }
      },
      message: { create: async ({ data }: any) => { messages.push({ phone: data.phone, direction: data.direction, body: data.body }) } }
    }
    try { return await work(tx) } finally { unlock() }
  }
}
const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-28T15:00:00Z') }
const port = { catalog: async () => [{ id: 'cut', name: 'Corte Hombre', durationMinutes: 30, price: 5000, requiresConsultation: false }], availability: async () => ({ professionals: [{ id: 'ana', name: 'Ana', priority: 0 }], slots: [{ startAt: '2026-09-29T20:00:00.000Z', date: '2026-09-29', time: '17:00', professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON' as const, occupiedMinutes: 0 }] }) }
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
console.log('conversational preview transactional store: OK')

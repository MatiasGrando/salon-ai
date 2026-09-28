import assert from 'node:assert/strict'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'

const rows = new Map<string, any>()
const messages: any[] = []
let inTransaction = false
let transactions = 0
let writes = 0
let forceConflict = 0
let forceOwnerMismatch = false
const client = {
  conversation: {
    findUnique: async ({ where }: any) => structuredClone(rows.get(where.id ?? `${where.businessId_phone.businessId}:${where.businessId_phone.phone}`) ?? null)
  },
  async $transaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
    transactions++
    inTransaction = true
    const tx = {
      conversation: {
        upsert: async ({ where, create }: any) => {
          const key = `${create.businessId}:${where.businessId_phone.phone}`
          if (!rows.has(key)) rows.set(key, { id: key, supportBotKey: null, supportBotState: null })
          return rows.get(key)
        },
        findUnique: async ({ where }: any) => {
          const row = rows.get(where.id) ?? null
          if (forceConflict > 0 && row) {
            forceConflict--
            row.supportBotState = { ...row.supportBotState, changedElsewhere: (row.supportBotState?.changedElsewhere ?? 0) + 1 }
          }
          if (forceOwnerMismatch && row) { forceOwnerMismatch = false; row.supportBotKey = 'other-owner' }
          return structuredClone(row)
        },
        update: async ({ where, data }: any) => { writes++; Object.assign(rows.get(where.id), data) }
      },
      $queryRaw: async () => [{ id: 'locked' }],
      message: { create: async ({ data }: any) => { writes++; messages.push({ body: data.body, direction: data.direction }) } }
    }
    try { return await work(tx) } finally { inTransaction = false }
  }
}
const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-28T15:00:00Z') }
const port = {
  catalog: async () => { assert.equal(inTransaction, false, 'catalog must not hold row lock'); return [{ id: 'cut', name: 'Corte Hombre', durationMinutes: 30, price: 5000, requiresConsultation: false }] },
  availability: async () => { assert.equal(inTransaction, false, 'availability must not hold row lock'); return { professionals: [{ id: 'ana', name: 'Ana', priority: 0 }], slots: [{ startAt: '2026-09-29T20:00:00.000Z', date: '2026-09-29', time: '17:00', professionalId: 'ana', professionalName: 'Ana', band: 'AFTERNOON' as const, occupiedMinutes: 0 }] } }
}
const factory = async () => { assert.equal(inTransaction, false, 'createPort must not hold row lock'); return { context, port } }

const first = await runPrismaDemoPreview(client, 'qa', 'admin', 'session', 'quiero Corte Hombre', factory)
assert.equal(first.state.serviceId, 'cut')
assert.equal(writes, 3)
assert.equal(transactions, 1)

const writesBeforeFailure = writes
const transactionsBeforeFailure = transactions
await assert.rejects(runPrismaDemoPreview(client, 'qa', 'admin', 'failed', 'hola', async () => { throw new Error('provider down') }), /provider down/)
assert.equal(writes, writesBeforeFailure, 'failed computation never persists a turn')
assert.equal(transactions, transactionsBeforeFailure, 'failed computation never opens transaction')
assert.equal(rows.has('qa:demo:preview:admin:failed'), false, 'failed computation does not create empty chat')

forceConflict = 1
const retry = await runPrismaDemoPreview(client, 'qa', 'admin', 'session', 'mañana', factory)
assert.equal(retry.state.date, '2026-09-29')
assert.equal(transactions, 3, 'conflicting snapshot retries calculation')
assert.equal(messages.filter(m => m.direction === 'INBOUND' && m.body === 'mañana').length, 1)
assert.equal(writes, 6)

const writesBeforeExhaustion = writes
forceConflict = 4
await assert.rejects(runPrismaDemoPreview(client, 'qa', 'admin', 'session', 'Ramiro', factory), /changed too frequently/)
assert.equal(writes, writesBeforeExhaustion, 'bounded conflicts never write the inbound turn')
assert.equal(messages.filter(m => m.body === 'Ramiro').length, 0)

forceOwnerMismatch = true
const writesBeforeInsideOwner = writes
await assert.rejects(runPrismaDemoPreview(client, 'qa', 'admin', 'session', 'hola', factory), /unexpected preview state owner/)
assert.equal(writes, writesBeforeInsideOwner)
rows.get('qa:demo:preview:admin:session').supportBotKey = 'other-owner'
const writesBeforeOwner = writes
await assert.rejects(runPrismaDemoPreview(client, 'qa', 'admin', 'session', 'hola', factory), /unexpected preview state owner/)
assert.equal(writes, writesBeforeOwner)
console.log('conversational preview lock boundary: OK')

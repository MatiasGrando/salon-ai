import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'
import { PreviewChoiceError } from '../src/conversational-bot/preview-choice.js'

const db = new PGlite()
await db.exec('CREATE TABLE "Conversation" ("id" text PRIMARY KEY, "businessId" text NOT NULL, "phone" text NOT NULL, "supportBotKey" text, "supportBotState" jsonb, UNIQUE("businessId","phone")); CREATE TABLE "Message" ("id" serial PRIMARY KEY, "conversationId" text, "phone" text, "direction" text, "body" text, "metadata" jsonb);')
let rejectOutbound = false
function clientFor(sql: any): any {
  return {
    conversation: {
      findUnique: async ({ where }: any) => {
        const result = where.id ? await sql.query('SELECT * FROM "Conversation" WHERE "id"=$1', [where.id])
          : await sql.query('SELECT * FROM "Conversation" WHERE "businessId"=$1 AND "phone"=$2', [where.businessId_phone.businessId, where.businessId_phone.phone])
        return result.rows[0] ?? null
      },
      upsert: async ({ create }: any) => (await sql.query('INSERT INTO "Conversation" ("id","businessId","phone") VALUES ($1,$2,$3) ON CONFLICT("businessId","phone") DO UPDATE SET "phone"=EXCLUDED."phone" RETURNING *', [randomUUID(), create.businessId, create.phone])).rows[0],
      update: async ({ where, data }: any) => sql.query('UPDATE "Conversation" SET "supportBotKey"=$1,"supportBotState"=$2::jsonb WHERE "id"=$3', [data.supportBotKey, JSON.stringify(data.supportBotState), where.id])
    },
    message: { create: async ({ data }: any) => {
      if (rejectOutbound && data.direction === 'OUTBOUND') throw new Error('outbound persistence failed')
      await sql.query('INSERT INTO "Message" ("conversationId","phone","direction","body","metadata") VALUES ($1,$2,$3,$4,$5::jsonb)', [data.conversationId, data.phone, data.direction, data.body, JSON.stringify(data.metadata)])
      return data
    } },
    $queryRaw: async (statement: any) => (await sql.query(statement.text, statement.values)).rows
  }
}
const client = { ...clientFor(db), $transaction: (work: any) => db.transaction(tx => work(clientFor(tx))) }
const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00.000Z') }
const factory = async () => ({ context, port: {
  catalog: async () => [{ id: 'man', name: 'Corte hombre', durationMinutes: 30, price: 27000, requiresConsultation: false }, { id: 'woman', name: 'Corte mujer', durationMinutes: 30, price: 37000, requiresConsultation: false }],
  availability: async () => ({ professionals: [], slots: [] })
} })
const first: any = await runPrismaDemoPreview(client, 'qa', 'admin', 'sql', 'quiero corte', factory)
assert.equal(first.presentation?.choices.length, 2, 'SQL-backed preview issues real choices')
const id = first.presentation.choices[0].id
const selected: any = await runPrismaDemoPreview(client, 'qa', 'admin', 'sql', 'Untrusted title', factory, undefined, undefined, undefined, id)
assert.equal(selected.state.serviceId, 'man', 'JSONB reordering does not make a legitimate choice stale')
assert.equal(Object.hasOwn(selected.state, 'previewChoiceContext'), false)
const count = async () => (await db.query<{ count: number }>('SELECT count(*)::int AS count FROM "Message"')).rows[0]!.count
const before = await count()
await assert.rejects(runPrismaDemoPreview(client, 'qa', 'admin', 'sql', '', factory, undefined, undefined, undefined, id), PreviewChoiceError)
await assert.rejects(runPrismaDemoPreview(client, 'qa', 'other', 'sql', '', factory, undefined, undefined, undefined, id), PreviewChoiceError)
assert.equal(await count(), before)
const stored: any = (await db.query('SELECT "supportBotState" FROM "Conversation"')).rows[0]
assert.equal(stored.supportBotState.previewChoiceContext.revision, '2')
rejectOutbound = true
await assert.rejects(runPrismaDemoPreview(client, 'qa', 'admin', 'rollback', 'quiero corte', factory), /outbound persistence failed/)
assert.equal((await db.query('SELECT "id" FROM "Conversation" WHERE "phone"=$1', ['demo:preview:admin:rollback'])).rows.length, 0, 'failed delivery persistence rolls back question/state/chat')
assert.equal(await count(), before)
await db.close()
console.log('conversational preview choices PGlite: OK')

import assert from 'node:assert/strict'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'
import { PreviewChoiceError } from '../src/conversational-bot/preview-choice.js'
import type { DialogueService } from '../src/conversational-bot/engine.js'

const rows = new Map<string, any>()
const messages: any[] = []
let inTransaction = false
let transactions = 0
let failCommit = false
let forceConflict = false
let aiCalls = 0
const client = {
  conversation: { findUnique: async ({ where }: any) => structuredClone(rows.get(where.id ?? where.businessId_phone.businessId + ':' + where.businessId_phone.phone) ?? null) },
  async $transaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
    transactions++
    inTransaction = true
    const beforeRows = structuredClone(rows), beforeMessages = structuredClone(messages)
    const tx = {
      conversation: {
        upsert: async ({ where, create }: any) => {
          const key = create.businessId + ':' + where.businessId_phone.phone
          if (!rows.has(key)) rows.set(key, { id: key, supportBotKey: null, supportBotState: null })
          return rows.get(key)
        },
        findUnique: async ({ where }: any) => {
          const row = rows.get(where.id)
          if (forceConflict && row) {
            forceConflict = false
            row.supportBotState.previewChoiceContext.revision = '999'
            row.supportBotState.previewChoiceContext.question = null
          }
          return structuredClone(row ?? null)
        },
        update: async ({ where, data }: any) => { Object.assign(rows.get(where.id), data); if (failCommit) throw new Error('commit unavailable') }
      },
      message: { create: async ({ data }: any) => { messages.push(structuredClone(data)); return data } },
      $queryRaw: async () => [{ id: 'locked' }]
    }
    try { return await work(tx) } catch (error) {
      rows.clear(); for (const [key, value] of beforeRows) rows.set(key, value)
      messages.splice(0, messages.length, ...beforeMessages)
      throw error
    } finally { inTransaction = false }
  }
}
const catalog = [
  { id: 'man', name: 'Corte hombre', durationMinutes: 30, requiresConsultation: false, price: 27000 },
  { id: 'woman', name: 'Corte mujer', durationMinutes: 30, requiresConsultation: false, price: 37000 }
]
const context = { businessId: 'qa', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00.000Z') }
const port = { catalog: async () => { assert.equal(inTransaction, false); return structuredClone(catalog) },
  availability: async () => { assert.equal(inTransaction, false); return { professionals: [{ id: 'rama', name: 'Ramiro', priority: 0 }], slots: [] } } }
const factory = async () => ({ context, port })
const forbiddenAi = async () => { aiCalls++; throw new Error('opaque choices must not be interpreted') }
const key = (session: string) => 'qa:demo:preview:admin:' + session
const start = async (session: string) => runPrismaDemoPreview(client, 'qa', 'admin', session, 'quiero un corte', factory)
const select = async (session: string, id: string) => runPrismaDemoPreview(client, 'qa', 'admin', session, 'Client title is not a command', factory, forbiddenAi, undefined, undefined, id)

const first: any = await start('one')
assert.equal(first.presentation?.choices.length, 2, 'actual engine question emits server-bound preview options')
assert.equal(Object.hasOwn(first.state, 'previewChoiceContext'), false)
assert.equal(JSON.stringify(first.presentation).includes('serviceId'), false)
const man = first.presentation.choices.find((choice: any) => choice.title === 'Corte hombre')
assert.ok(man)
assert.ok(rows.get(key('one')).supportBotState.previewChoiceContext.question)
const selected: any = await select('one', man.id)
assert.equal(selected.state.serviceId, 'man')
assert.equal(selected.state.pending, 'date')
assert.equal(selected.interpretation.reason, 'server_choice')
assert.equal(aiCalls, 0, 'selection calls validated engine seam, never IA/title matching')
assert.equal(messages.at(-2).body, 'Corte hombre', 'persist server label, not a forged client title')
const writes = messages.length
await assert.rejects(select('one', man.id), PreviewChoiceError)
await assert.rejects(select('other-session', man.id), PreviewChoiceError)
await assert.rejects(runPrismaDemoPreview(client, 'foreign', 'admin', 'one', '', factory, undefined, undefined, undefined, man.id), PreviewChoiceError)
assert.equal(messages.length, writes, 'rejected choices do not create a turn or change the draft')

const twice: any = await start('double')
const twiceId = twice.presentation.choices[0].id
const attempts = await Promise.allSettled([select('double', twiceId), select('double', twiceId)])
assert.deepEqual(attempts.map(result => result.status), ['fulfilled', 'rejected'])
assert.equal(messages.filter(message => message.phone === 'demo:preview:admin:double' && message.direction === 'INBOUND').length, 2)

const race: any = await start('race')
forceConflict = true
await assert.rejects(select('race', race.presentation.choices[0].id), PreviewChoiceError)
assert.equal(messages.filter(message => message.phone === 'demo:preview:admin:race' && message.direction === 'INBOUND').length, 1, 'CAS rechecks choices against changed question')

const guided: DialogueService = {
  id: 'guided', name: 'Servicio guiado', durationMinutes: 90, price: 85000,
  priceMode: 'STARTING_AT', requiresConsultation: false,
  bookingPolicy: {
    id: 'guided', name: 'Servicio guiado', attentionMode: 'GUIDED_ESTIMATE',
    price: 85000, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
    estimateExplanation: 'Explicación pública. '.repeat(90),
    estimateDisclaimer: 'Estimado sujeto a evaluación. '.repeat(60),
    estimateQuestion: '¿Qué opción necesitás?',
    estimateOptions: Array.from({ length: 4 }, (_, index) => ({
      id: 'option-' + index, label: 'Opción ' + index, priceMin: 85000,
      priceMax: 95000, note: null
    })),
    requiresPhoto: false, validationEnabled: false,
    validationMessage: null, validationQuestion: null
  }
}
assert.ok(JSON.stringify(guided.bookingPolicy).length < 6000)
const guidedFactory = async () => ({ context, port: {
  catalog: async () => [guided], availability: port.availability
} })
const oversized: any = await runPrismaDemoPreview(client, 'qa', 'admin', 'oversized',
  'quiero Servicio guiado', guidedFactory)
assert.equal(oversized.state.pending, 'estimate')
assert.equal(oversized.presentation, null, 'oversized full question degrades to text, never a subset')
for (let index = 0; index < 4; index++) assert.ok(oversized.reply.includes('Opción ' + index))
assert.equal(rows.get(key('oversized')).supportBotState.previewChoiceContext.question, null)

const removedQuestion: any = await start('removed')
const removedChoice = removedQuestion.presentation.choices.find((choice: any) => choice.title === 'Corte hombre')
const removed = catalog.shift()!
const beforeRemoved = messages.length
try {
  await assert.rejects(select('removed', removedChoice.id), PreviewChoiceError,
    'a current token whose catalog option was removed is a stale choice, not an operational 500')
  assert.equal(messages.length, beforeRemoved, 'fresh choice rejection cannot store a partial turn')
} finally { catalog.unshift(removed) }
const operable: any = await start('operational-error')
const operationalWrites = messages.length
const operationalFactory = async () => ({ context, port: {
  ...port, catalog: async () => { throw new Error('catalog temporarily unavailable') }
} })
await assert.rejects(runPrismaDemoPreview(client, 'qa', 'admin', 'operational-error',
  '', operationalFactory, undefined, undefined, undefined, operable.presentation.choices[0].id),
  /catalog temporarily unavailable/, 'an operational failure must not pretend the choice was stale')
assert.equal(messages.length, operationalWrites)

let configured: DialogueService = {
  ...guided, bookingPolicy: {
    ...guided.bookingPolicy!, estimateExplanation: 'Precio según opción.',
    estimateDisclaimer: 'Estimado sujeto a evaluación.'
  }
}
const configuredFactory = async () => ({ context, port: {
  ...port, catalog: async () => [configured]
} })
const configuredQuestion: any = await runPrismaDemoPreview(client, 'qa', 'admin',
  'configuration', 'quiero Servicio guiado', configuredFactory)
assert.equal(configuredQuestion.presentation.choices.length, 4)
configured = { ...configured, bookingPolicy: {
  ...configured.bookingPolicy!, estimateDisclaimer: 'Condiciones actualizadas.'
} }
const configurationWrites = messages.length
await assert.rejects(runPrismaDemoPreview(client, 'qa', 'admin', 'configuration',
  '', configuredFactory, forbiddenAi, undefined, undefined, configuredQuestion.presentation.choices[0].id),
  PreviewChoiceError, 'current guidance policy is revalidated, not trusted from the old opaque token')
assert.equal(messages.length, configurationWrites)
assert.equal(aiCalls, 0)
const longName = 'Profesional ' + 'N'.repeat(180)
const longLabelFactory = async () => ({ context, port: {
  catalog: port.catalog,
  availability: async (_service: any, date: string) => ({
    professionals: [{ id: 'long-pro', name: longName, priority: 0 }],
    slots: [{
      date, time: '17:00', startAt: date + 'T20:00:00.000Z',
      professionalId: 'long-pro', professionalName: longName,
      band: 'AFTERNOON' as const, occupiedMinutes: 0
    }]
  })
} })
const longLabel: any = await runPrismaDemoPreview(client, 'qa', 'admin', 'long-label',
  'quiero corte hombre mañana con cualquier profesional', longLabelFactory)
assert.equal(longLabel.state.pending, 'time')
assert.equal(longLabel.presentation, null, 'label delivery bounds degrade to full text without shortening meaning')
assert.ok(longLabel.reply.includes(longName), 'complete public name survives text-only delivery')
const beforeFailure = messages.length
failCommit = true
await assert.rejects(start('failed'), /commit unavailable/)
failCommit = false
assert.equal(rows.has(key('failed')), false, 'failed transaction cannot publish/store a question')
assert.equal(messages.length, beforeFailure)
assert.equal(aiCalls, 0)
console.log('conversational preview backend choices: OK (' + transactions + ' transactions)')

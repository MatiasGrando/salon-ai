import assert from 'node:assert/strict'
import { runPrismaDemoPreview } from '../src/conversational-bot/demo-preview-prisma.js'
import { basketServiceIds } from '../src/conversational-bot/service-basket.js'
import type { AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import type { DialogueService, DialoguePort } from '../src/conversational-bot/engine.js'

const businessId = 'qa', userId = 'admin', session = 'night-after-edit', date = '2026-10-03'
const phone = `demo:preview:${userId}:${session}`
const rows = new Map<string, any>(), messages: any[] = []
const key = `${businessId}:${phone}`
const client: any = {
  conversation: { findUnique: async ({ where }: any) => structuredClone(rows.get(where.id ?? `${where.businessId_phone.businessId}:${where.businessId_phone.phone}`) ?? null) },
  $transaction: async (work: (tx: any) => Promise<any>) => {
    const beforeRows = structuredClone(rows), beforeMessages = structuredClone(messages)
    const tx = {
      conversation: {
        upsert: async ({ where, create }: any) => { const id = `${create.businessId}:${where.businessId_phone.phone}`; if (!rows.has(id)) rows.set(id, { id, supportBotKey: null, supportBotState: null }); return rows.get(id) },
        findUnique: async ({ where }: any) => structuredClone(rows.get(where.id) ?? null),
        update: async ({ where, data }: any) => { Object.assign(rows.get(where.id), structuredClone(data)); return rows.get(where.id) }
      },
      message: { create: async ({ data }: any) => { messages.push(structuredClone(data)); return data } },
      $queryRaw: async () => [{ id: 'locked' }]
    }
    try { return await work(tx) } catch (error) { rows.clear(); for (const [id, value] of beforeRows) rows.set(id, value); messages.splice(0, messages.length, ...beforeMessages); throw error }
  }
}
const direct = (id: string, name: string, price: number): DialogueService => ({ id, name, price, durationMinutes: 30, requiresConsultation: false })
const services: DialogueService[] = [direct('man', 'Corte hombre', 27000), direct('woman', 'Corte mujer', 37000), direct('combo', 'Corte y barba', 32000), {
  id: 'cream', name: 'Baño de crema', price: 25000, priceMode: 'STARTING_AT', durationMinutes: 30, requiresConsultation: false,
  bookingPolicy: { id: 'cream', name: 'Baño de crema', price: 25000, priceMode: 'STARTING_AT', attentionMode: 'GUIDED_ESTIMATE', estimateAllowsBooking: true,
    estimateQuestion: '¿Qué marca?', estimateOptions: [{ id: 'karsell', label: 'Karsell', priceMin: 25000, priceMax: 25000, note: null }],
    estimateExplanation: null, estimateDisclaimer: null, requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null }
}]
const professionals = [{ id: 'cin', name: 'Cin', priority: 0 }, { id: 'seb', name: 'Sebastián', priority: 1 }]
const slots = (count: number) => Array.from({ length: count }, (_, index) => { const hour = 11 + Math.floor(index / 2), minute = index % 2 ? '30' : '00', time = `${String(hour).padStart(2, '0')}:${minute}`; return { date, time,
  startAt: `${date}T${String(hour + 3).padStart(2, '0')}:${minute}:00.000Z`, professionalId: 'cin', professionalName: 'Cin', band: (hour < 12 ? 'MORNING' : hour < 17 ? 'AFTERNOON' : 'EVENING') as 'MORNING' | 'AFTERNOON' | 'EVENING', occupiedMinutes: 30 } })
const context = { businessId, timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-03T12:00:00Z') }
const port: DialoguePort = { catalog: async () => services, availability: async service => ({ professionals, slots: slots(service.id === 'woman' ? 18 : 3) }),
  availabilityBasket: async selected => ({ ok: true, services: [...selected], professionals, slots: slots(3), durationMinutes: selected.reduce((sum, item) => sum + item.durationMinutes!, 0),
    customerDurationMinutes: selected.reduce((sum, item) => sum + item.durationMinutes!, 0), totalPrice: null }) }
const factory = async () => ({ context, port })
const ev = (evidence: string) => ({ evidence, confidence: 1 })
const member = (mode: 'single' | 'alternatives', serviceIds: string[], evidence: string) => ({ mode, serviceIds, ...ev(evidence) })
const basket = (mutation: 'set' | 'add', members: object[], evidence: string) => ({ kind: 'basket', mutation, scope: 'all', targetMemberIds: [], members, ...ev(evidence) })
const plans: Record<string, object[]> = {
  'hola quiero corte hombre hoy': [basket('set', [member('single', ['man'], 'corte hombre')], 'corte hombre'), { kind: 'date', expression: 'hoy', value: date, ...ev('hoy') }, { kind: 'professional', mode: 'any', ...ev('quiero') }],
  'no mejor corte mujer': [basket('set', [member('single', ['woman'], 'corte mujer')], 'corte mujer')],
  'agrega baño de crema': [basket('add', [member('single', ['cream'], 'baño de crema')], 'baño de crema')],
  'Karsell': [{ kind: 'estimate', serviceId: 'cream', optionId: 'karsell', ...ev('Karsell') }],
  'mejor solo el corte': [basket('set', [member('alternatives', ['man', 'woman', 'combo'], 'corte')], 'corte')],
  'corte mujer': [basket('set', [member('single', ['woman'], 'corte mujer')], 'corte mujer')]
}
let providerCalls = 0
const provider: AiInterpretationProvider = async input => { providerCalls++; const operations = plans[input.message]; assert.ok(operations, 'fixture message: ' + input.message); return { intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations } } }
const say = (message: string) => runPrismaDemoPreview(client, businessId, userId, session, message, factory, provider)
for (const message of Object.keys(plans)) {
  const result: any = await say(message)
  assert.equal(result.state.businessId, businessId)
  assert.equal(result.bookingConfirmed, undefined)
  assert.deepEqual(messages.at(-1).metadata.presentation ?? null, result.presentation ?? null, 'last visible response and returned choice envelope are identical')
  if (message === 'Karsell') assert.deepEqual(basketServiceIds(result.state), ['woman', 'cream'])
}
const shown = messages.at(-1)
const stored = rows.get(key).supportBotState
assert.equal(shown.direction, 'OUTBOUND')
assert.equal(stored.previewChoiceContext.revision, '6')
assert.equal(stored.previewChoiceContext.question?.kind, 'preference')
assert.equal(stored.questionContext?.role, 'time')
assert.equal(stored.questionContext?.complete, true)
assert.equal(stored.previewChoiceContext.question.scope.revision, stored.previewChoiceContext.revision)
assert.equal(stored.previewChoiceContext.question.scope.policyKey, 'preview:v1')
assert.ok(stored.previewChoiceContext.question.nonce.length >= 16)
assert.equal(stored.previewChoiceContext.question.scope.businessId, businessId)
assert.equal(stored.previewChoiceContext.question.scope.conversationKey, phone)
assert.equal(stored.previewChoiceContext.question.draftFingerprint.length, 64)
assert.equal(stored.previewChoiceContext.question.choices.every((choice: any) => stored.questionContext.options.some((option: any) =>
  option.label === choice.label)), true, 'every visible option corresponds to the latest question')
const offered = shown.metadata.presentation
assert.equal(stored.previewChoiceContext.question.choices.length, offered?.choices?.length)
const night = offered?.choices?.find((choice: any) => choice.title === 'Por la noche')
assert.ok(night, 'latest visible message has a nocturnal option')
const accepted: any = await runPrismaDemoPreview(client, businessId, userId, session, 'Por la noche', factory, provider, undefined, undefined, night.id)
assert.equal(accepted.interpretation.reason, 'server_choice')
assert.deepEqual(accepted.state.timePreference, { kind: 'band', band: 'EVENING' })
assert.deepEqual(basketServiceIds(accepted.state), ['woman'])
assert.equal(providerCalls, 6, 'typed choice bypasses AI')
assert.equal(messages.at(-2).body, 'Por la noche')
const anyButton = offered.choices.find((choice: any) => choice.title === 'Cualquier horario')
assert.ok(anyButton)
await assert.rejects(() => runPrismaDemoPreview(client, businessId, userId, session, 'old any', factory, provider, undefined, undefined, anyButton.id),
  (error: unknown) => { assert.equal((error as any).gate, 'ledger_resolve'); return true })
const beforeRejected = messages.length
await assert.rejects(() => runPrismaDemoPreview(client, businessId, userId, session, 'old button', factory, provider, undefined, undefined, night.id),
  (error: unknown) => { assert.equal((error as any).gate, 'ledger_resolve'); return true })
assert.equal(messages.length, beforeRejected, 'stale button never persists a turn')
const currentFromOtherChat = accepted
const foreignId = currentFromOtherChat.presentation?.choices?.[0]?.id
assert.ok(foreignId)
await assert.rejects(() => runPrismaDemoPreview(client, businessId, userId, session + '-other', 'foreign button', factory, provider, undefined, undefined, foreignId),
  (error: unknown) => { assert.equal((error as any).gate, 'ledger_resolve'); return true })
const currentSlot = accepted.presentation?.choices?.find((choice: any) => choice.title.includes('18:00'))
assert.ok(currentSlot, 'new response owns the current slot choice')
const removed = services.splice(services.findIndex(item => item.id === 'woman'), 1)[0]!
try {
  await assert.rejects(() => runPrismaDemoPreview(client, businessId, userId, session, 'fresh but retired', factory, provider, undefined, undefined, currentSlot.id),
    (error: unknown) => { assert.equal((error as any).gate, 'engine_admission'); return true })
  assert.equal(messages.length, beforeRejected, 'fresh catalog rejection never persists a turn')
} finally { services.splice(1, 0, removed) }
console.log('PASS full edit sequence retains the latest nocturnal choice')

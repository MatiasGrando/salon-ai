import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { initialDialogueState, respondConversationChoice, type DialoguePort, type DialogueService, type DialogueState } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { selectionBasket } from '../src/conversational-bot/service-basket.js'
import { catalogInformation } from '../src/conversational-bot/catalog-information-answer.js'
import { replyContract, validateReplyDraft } from '../src/conversational-bot/reply-contract.js'

// Synthetic catalog and controlled semantic proposals only. No model, network or database.
const blocked = () => { throw new Error('external transport forbidden in catalog guidance') }
globalThis.fetch = blocked; http.request = blocked as typeof http.request; https.request = blocked as typeof https.request
http.get = blocked as typeof http.get; https.get = blocked as typeof https.get
const context = { businessId: 'catalog-guidance', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-29T12:00:00Z') }
const catalog: DialogueService[] = [
  { id: 'roots', name: 'Raíces', description: 'Ayuda a tapar las canas con productos A11Lux.', price: 40000, durationMinutes: 60, requiresConsultation: false },
  { id: 'color', name: 'Color completo', description: 'Coloración de todo el cabello.', price: 65000, durationMinutes: 90, requiresConsultation: false },
  { id: 'straight', name: 'Alisado sin formol', description: 'Alisado para reducir ondas, sujeto a evaluación del cabello.', price: 29000, durationMinutes: 75, requiresConsultation: false },
  { id: 'keratin', name: 'Keratina', description: 'Reduce el frizz y facilita el peinado.', price: 32000, durationMinutes: 50, requiresConsultation: false }
]
let agenda = 0, passed = 0
const failures: string[] = []
const port = (services = catalog): DialoguePort => ({ catalog: async () => services,
  availability: async () => { agenda++; throw new Error('informative guidance cannot consult agenda') } })
const initial = () => initialDialogueState(context.businessId)
const frame = (blocks: unknown[] | null) => ({ salutation: null, opening: null, closing: null, factIds: null, variantChoices: null,
  catalogAnswer: blocks ? { blocks } : null })
const block = (id: string, text?: string, services = catalog) => ({ kind: 'published',
  text: text ?? services.find(service => service.id === id)!.description!,
  sources: [{ serviceId: id, field: 'description', quote: services.find(service => service.id === id)!.description! }] })
const proposal = (body: string, ids: string[], aspect: string, blocks: unknown[] | null, mention: string | null = null) => ({
  intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
  turnPlan: { version: 1, operations: [{ kind: 'information', evidence: body, confidence: 1,
    target: { kind: 'service', serviceIds: ids, actions: [], aspect } }] },
  communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: body, confidence: 1, mention, operationIndexes: [0] }] },
  firstReply: frame(blocks)
})
async function say(state: DialogueState, body: string, ids: string[], aspect: string, blocks: unknown[] | null,
  mention: string | null = null, services = catalog) {
  const value = proposal(body, ids, aspect, blocks, mention)
  const provider = Object.assign(async () => value, { respond: async () => frame(blocks) }) as AiInterpretationProvider
  const before = agenda
  const result = await respondWithAiInterpreter(context, state, body, port(services), provider)
  assert.equal(agenda, before)
  assert.deepEqual(selectionBasket(result.state), selectionBasket(state))
  for (const key of ['serviceId', 'customerName', 'date', 'professional', 'slot'] as const) assert.deepEqual(result.state[key], state[key])
  assert.equal(result.proposal, null); assert.equal(result.bookingCommand, undefined); assert.equal(result.handoffCommand, undefined)
  return result
}
async function check(name: string, run: () => Promise<void> | void) {
  try { await run(); passed++; console.log('PASS catalog guidance ' + name) }
  catch (error) { failures.push(name); console.error('RED catalog guidance ' + name + ': ' + String(error)) }
}
const guidanceBody = 'Tengo canas y quería tapármelas, ¿qué puedo hacer?'
const guidance = () => say(initial(), guidanceBody, ['roots', 'color'], 'recommendation', [block('roots'), block('color')], 'tapármelas')
await check('E1 existing semantic recommendation explains real candidates without acquiring them', async () => {
  const result = await guidance()
  assert.match(result.reply, /Raíces/); assert.match(result.reply, /Color completo/)
  assert.match(result.reply, /40[.,]000/); assert.match(result.reply, /65[.,]000/)
  assert.match(result.reply, /60 min/); assert.match(result.reply, /90 min/)
  assert.doesNotMatch(result.reply, /No tengo información confirmada|Qué dato o variante/)
  assert.equal(result.interpretation.copyMode, 'ai'); assert.equal(result.interpretation.replyRoute, 'first_call')
})
await check('E3 new personal information permits a revised recommendation after explaining Raíces', async () => {
  const first = await guidance()
  const explanation = await say(first.state, '¿Qué sería Raíces?', ['roots'], 'overview', [block('roots')], 'Raíces')
  const text = 'Para trabajar el color de todo el cabello, Color completo es una alternativa para consultar.'
  const revised = await say(explanation.state, 'Pero tengo todo el pelo con canas', ['color'], 'recommendation', [block('color', text)], 'todo el pelo con canas')
  assert.ok(revised.reply.includes(text)); assert.equal(revised.state.informationFocus?.serviceId, 'color')
  assert.doesNotMatch(revised.reply, /No tengo información confirmada|Qué dato o variante/)
  assert.equal(revised.interpretation.copyMode, 'ai'); assert.equal(revised.interpretation.replyRoute, 'first_call')
})
for (const aspect of ['overview', 'description']) await check('E2 faithful natural paraphrase retains published alphanumeric product and invitation: ' + aspect, async () => {
  const text = 'Raíces ayuda a cubrir las canas con los productos A11Lux que figuran en la ficha.'
  const result = await say(initial(), '¿Qué sería Raíces?', ['roots'], aspect, [block('roots', text)], 'Raíces')
  assert.ok(result.reply.includes(text), 'grounded model paraphrase should survive product-code protection')
  assert.match(result.reply, /40[.,]000/); assert.match(result.reply, /60 min/)
  assert.equal(result.choicePresentation?.choices[0]?.label, 'Reservar')
  assert.equal(result.interpretation.copyMode, 'ai'); assert.equal(result.interpretation.replyRoute, 'first_call')
})
await check('E1 explained alternatives remain selectable as information without typing names', async () => {
  const result = await guidance()
  assert.deepEqual(result.choicePresentation?.choices.map(choice => choice.operation), [{ kind: 'service', serviceId: 'roots' }, { kind: 'service', serviceId: 'color' }])
  const choice = result.choicePresentation!.choices[0]!
  const selected = await respondConversationChoice(context, result.state, choice.operation, port())
  assert.equal(selected.state.informationFocus?.serviceId, 'roots')
  assert.deepEqual(selectionBasket(selected.state), selectionBasket(result.state)); assert.equal(selected.bookingCommand, undefined)
})
await check('E6 price alternatives include concise comparable facts and native information choices', async () => {
  const result = await say(initial(), 'Quería saber el precio del alisado', ['straight', 'keratin'], 'price', [block('straight'), block('keratin')], 'alisado')
  assert.match(result.reply, /29[.,]000/); assert.match(result.reply, /32[.,]000/)
  assert.match(result.reply, /75 min/); assert.match(result.reply, /50 min/)
  assert.ok(result.reply.includes(catalog[2]!.description!)); assert.ok(result.reply.includes(catalog[3]!.description!))
  assert.deepEqual(result.choicePresentation?.choices.map(choice => choice.operation), [{ kind: 'service', serviceId: 'straight' }, { kind: 'service', serviceId: 'keratin' }])
  assert.equal(result.interpretation.replyRoute, 'first_call'); assert.equal(result.interpretation.copyMode, 'ai')
  const selected = await respondConversationChoice(context, result.state, result.choicePresentation!.choices[0]!.operation, port())
  assert.match(selected.reply, /29[.,]000/); assert.match(selected.reply, /75 min/)
  assert.deepEqual(selectionBasket(selected.state), selectionBasket(result.state))
  assert.equal(selected.choicePresentation?.choices[0]?.label, 'Reservar')
})
await check('E7 price carries real duration and a model sentence instead of the 800-word source', async () => {
  const description = 'Alisado para reducir ondas. ' + Array.from({ length: 398 }, () => 'Dato local.').join(' ')
  const services = catalog.map(service => service.id === 'straight' ? { ...service, description } : service)
  const text = 'El alisado está orientado a reducir las ondas del cabello.'
  const summary = block('straight', text, services)
  summary.sources[0]!.quote = 'Alisado para reducir ondas.'
  const result = await say(initial(), '¿Cuánto sale Alisado sin formol?', ['straight'], 'price', [summary], 'Alisado sin formol', services)
  assert.match(result.reply, /29[.,]000/); assert.match(result.reply, /75 min/)
  assert.ok(result.reply.includes(text)); assert.ok(!result.reply.includes('Dato local.'))
  assert.ok(result.reply.length < 650); assert.equal(result.interpretation.copyMode, 'ai'); assert.equal(result.interpretation.replyRoute, 'first_call')
})
await check('price rejects lengthy or multiple-sentence model sheets without leaking the raw description', async () => {
  const description = 'Alisado para reducir ondas. ' + Array.from({ length: 398 }, () => 'Dato local.').join(' ')
  const services = catalog.map(service => service.id === 'straight' ? { ...service, description } : service)
  for (const text of ['Alisado para reducir ondas. Dato local.', Array.from({ length: 80 }, () => 'cabello').join(' ') + '.']) {
    const summary = block('straight', text, services); summary.sources[0]!.quote = 'Alisado para reducir ondas.'
    const result = await say(initial(), '¿Cuánto sale Alisado sin formol?', ['straight'], 'price', [summary], 'Alisado sin formol', services)
    assert.ok(!result.reply.includes(text)); assert.ok(!result.reply.includes('Dato local.'))
    assert.match(result.reply, /29[.,]000/); assert.match(result.reply, /75 min/)
  }
})
await check('price with absent duration does not invent minutes or dump general provenance copy', async () => {
  const services = catalog.map(service => service.id === 'straight' ? { ...service, durationMinutes: null, description: null } : service)
  const result = await say(initial(), 'Precio de Alisado sin formol', ['straight'], 'price', null, 'Alisado sin formol', services)
  assert.match(result.reply, /29[.,]000/); assert.doesNotMatch(result.reply, /\d+\s*min|Información general/)
})
await check('informative price preserves an existing independent basket and date', async () => {
  const state = initial(); state.serviceId = 'color'; state.customerName = 'Matías'; state.date = '2026-10-30'
  const result = await say(state, 'Precio de Alisado sin formol', ['straight'], 'price', [block('straight')], 'Alisado sin formol')
  assert.deepEqual(selectionBasket(result.state), selectionBasket(state)); assert.equal(result.state.date, state.date)
})
await check('grounded product token grants no invented economic, other brand or guarantee authority', () => {
  const scope = catalogInformation({ kind: 'service', actions: [], serviceIds: ['roots'], aspect: 'overview' }, [catalog[0]!], true, context.businessId)
  const facts = [{ id: 'catalog', text: 'Catalog facts' }, { id: 'next', text: '¿Querés agendar Raíces?' }]
  for (const text of ['A11Lux cuesta 11 pesos.', 'Usamos productos A99Lux para cubrir las canas.', 'Se utilizan productos XA11Lux.', 'A11Lux garantiza cubrir todas las canas.', 'A11Lux demora 60 minutos.', 'Con A11Lux queda reservado el turno.']) {
    const result = validateReplyDraft(frame([block('roots', text)]), facts, replyContract('information', false, true, facts), catalog.map(service => service.name), scope)
    assert.notEqual(result.validation.status, 'accepted', text)
  }
})
await check('price does not repeat a descriptive sentence for the same service across blocks', () => {
  const scope = catalogInformation({ kind: 'service', actions: [], serviceIds: ['straight'], aspect: 'price' }, [catalog[2]!], false, context.businessId)
  const facts = [{ id: 'catalog', text: 'Catalog facts' }, { id: 'next', text: '¿Querés agendar Alisado sin formol?' }]
  const result = validateReplyDraft(frame([block('straight', 'El alisado busca reducir ondas.'), block('straight', 'Requiere evaluación del cabello.')]),
    facts, replyContract('information', false, true, facts), catalog.map(service => service.name), scope)
  assert.notEqual(result.validation.status, 'accepted')
})
await check('foreign service never becomes a selectable catalog fact', async () => {
  const result = await say(initial(), '¿Qué puedo hacerme?', ['foreign'], 'recommendation', null, null)
  assert.ok(!result.choicePresentation?.choices.some(choice => choice.operation.kind === 'service' && choice.operation.serviceId === 'foreign'))
})
for (const invalidation of ['removed', 'renamed', 'foreign-business']) await check('stale informative choice is rejected: ' + invalidation, async () => {
  const state = initial()
  state.informationFocus = { version: 1, businessId: invalidation === 'foreign-business' ? 'other-business' : context.businessId,
    topic: 'details', aspect: 'recommendation', serviceId: null, candidateId: null, awaitingChoice: false,
    options: catalog.slice(0, 2).map(service => ({ id: service.id, label: service.name })) }
  const services = invalidation === 'removed' ? catalog.filter(service => service.id !== 'roots')
    : invalidation === 'renamed' ? catalog.map(service => service.id === 'roots' ? { ...service, name: 'Nuevo servicio' } : service) : catalog
  const before = structuredClone(state)
  await assert.rejects(() => respondConversationChoice(context, state, { kind: 'service', serviceId: 'roots' }, port(services)),
    invalidation === 'foreign-business' ? /invalid information focus/ : /conversation choice is no longer available/)
  assert.deepEqual(state, before)
})
await check('ambiguous assent to multiple informative alternatives does not acquire either', async () => {
  const read = await guidance(), before = agenda
  const body = 'Sí dale'
  const value = { intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [] }, communicativeActs: { version: 1, acts: [{ kind: 'uncertain', field: 'service',
      evidence: body, confidence: 1, mention: null, operationIndexes: [] }] }, firstReply: null }
  const result = await respondWithAiInterpreter(context, read.state, body, port(), Object.assign(async () => value, { respond: async () => frame(null) }) as AiInterpretationProvider)
  assert.deepEqual(selectionBasket(result.state), selectionBasket(read.state)); assert.equal(agenda, before)
  assert.equal(result.bookingCommand, undefined)
})
await check('unpublished technique is not confirmed by a related real service', async () => {
  const body = '¿Hacen Raíces sin amoníaco?'
  const value = { intent: 'information', serviceId: null, serviceEvidence: null, professionalMention: null,
    turnPlan: { version: 1, operations: [{ kind: 'service_request', purpose: 'inquiry', disposition: 'unverified_variant', basis: 'related_category',
      serviceIds: ['roots'], sourceQuote: null, correction: false, continuation: false, subject: 'Raíces sin amoníaco', aspect: 'description', evidence: body, confidence: 1 }] },
    communicativeActs: { version: 1, acts: [{ kind: 'inquiry', field: 'service', evidence: body, confidence: 1, mention: 'Raíces sin amoníaco', operationIndexes: [0] }] }, firstReply: null }
  const state = initial(), before = agenda
  const result = await respondWithAiInterpreter(context, state, body, port(), Object.assign(async () => value, { respond: async () => frame(null) }) as AiInterpretationProvider)
  assert.equal(result.state.serviceRequest?.disposition, 'unverified_variant')
  assert.deepEqual(selectionBasket(result.state), selectionBasket(state)); assert.equal(agenda, before)
  assert.doesNotMatch(result.reply, /(?:usamos|incluye|ofrecemos) (?:productos )?sin amoníaco/i)
})
await check('provider failure keeps deterministic fallback safe without acquiring services', async () => {
  const state = initial(), before = agenda
  const provider = Object.assign(async () => { throw new Error('offline provider') }, { respond: async () => { throw new Error('offline provider') } }) as AiInterpretationProvider
  const result = await respondWithAiInterpreter(context, state, '¿Cuánto sale Raíces?', port(), provider)
  assert.deepEqual(selectionBasket(result.state), selectionBasket(state)); assert.equal(agenda, before)
  assert.equal(result.bookingCommand, undefined); assert.equal(result.proposal, null)
  assert.ok(result.reply.length > 0)
})
await check('provider unavailable on long price sheet never dumps raw descriptive copy or acquires', async () => {
  const services = catalog.map(service => service.id === 'straight' ? { ...service, description: 'Alisado para reducir ondas. ' + Array.from({ length: 398 }, () => 'Dato local.').join(' ') } : service)
  const provider = Object.assign(async () => { throw new Error('offline provider') }, { respond: async () => { throw new Error('offline provider') } }) as AiInterpretationProvider
  const state = initial()
  const result = await respondWithAiInterpreter(context, state, '¿Cuánto sale Alisado sin formol?', port(services), provider)
  assert.ok(result.reply.length > 0)
  assert.ok(!result.reply.includes('Dato local.')); assert.ok(result.reply.length < 650)
  assert.deepEqual(selectionBasket(result.state), selectionBasket(state)); assert.equal(result.bookingCommand, undefined)
})
console.log('Catalog guidance: ' + passed + ' PASS / ' + failures.length + ' RED')
if (failures.length) process.exitCode = 1

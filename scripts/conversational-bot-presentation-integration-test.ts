import assert from 'node:assert/strict'
import { hasActiveBooking } from '../src/conversational-bot/engine.js'
import { renderInformation } from '../src/conversational-bot/information.js'
import * as engine from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter } from '../src/conversational-bot/ai-interpreter.js'
import type { ConversationChoiceOperation, ConversationChoicePresentation } from '../src/conversational-bot/choices.js'
import type { AvailabilitySlot } from '../src/bot-options/application/availability-queries.js'
import type { DialogueIdentity } from '../src/conversational-bot/dialogue-identity.js'
const { respond, initialDialogueState, parseDialogueState } = engine
const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T12:00:00.000Z'), sandboxBooking: true }
const services = [{ id: 's1', name: 'Corte', durationMinutes: 30, requiresConsultation: false, price: 2500 }, { id: 's2', name: 'Cuidado', durationMinutes: 30, requiresConsultation: false, price: 1500 }]
const professionals = [{ id: 'p1', name: 'Ana', priority: 1 }, { id: 'p2', name: 'Bea', priority: 2 }]
const identity: DialogueIdentity = { businessId: 'tenant', businessName: 'Nombre público', assistantName: 'Alba', treatment: 'vos', greetingEmoji: '😊' }
let identityCalls = 0, agendaCalls = 0, dateCalls = 0
let available: AvailabilitySlot[] = Array.from({ length: 9 }, (_, i) => ({ date: '2026-10-03', time: `${String(9 + i).padStart(2, '0')}:00`, startAt: `2026-10-03T${String(12 + i).padStart(2, '0')}:00:00.000Z`, band: i < 3 ? 'MORNING' : 'AFTERNOON', professionalId: 'p1', professionalName: 'Ana', occupiedMinutes: 30 }))
let catalog = [...services]
type ExtendedPort = engine.DialoguePort & { identity(): Promise<DialogueIdentity>; verifiedDateChoices: (...args: unknown[]) => Promise<engine.DialogueBasketAvailability> }
const port: ExtendedPort = {
  identity: async () => { identityCalls++; return identity }, catalog: async () => catalog,
  availability: async (_service, date, professionalId) => { agendaCalls++; return { professionals, slots: available.filter(s => s.date === date && (!professionalId || s.professionalId === professionalId)) } },
  availabilityBasket: async (selected, date, professionalId) => { agendaCalls++; return { ok: true, services: [...selected], durationMinutes: selected.length * 30, totalPrice: selected.reduce((n,s) => n + s.price!,0), professionals, slots: available.filter(s => s.date === date && (!professionalId || s.professionalId === professionalId)) } },
  verifiedDateChoices: async () => { dateCalls++; return { ok: true, services: [services[0]!], durationMinutes: 30, totalPrice: 2500, professionals, slots: [available[0]!] } }
}
globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
type ExtendedResponse = engine.DialogueResponse & { choicePresentation?: ConversationChoicePresentation }
const presentation = (response: engine.DialogueResponse) => (response as ExtendedResponse).choicePresentation
const choose = (engine as unknown as { respondConversationChoice: (context: engine.DialogueContext, state: unknown, operation: ConversationChoiceOperation, port: engine.DialoguePort) => Promise<engine.DialogueResponse> }).respondConversationChoice
const namePlan = { version: 1 as const, operations: [{ kind: 'name' as const, value: 'Matías', evidence: 'Matías', confidence: 1 }] }
async function main() {
  const hello = await respond(context, initialDialogueState('tenant'), 'hola soy Matías', port, { serviceId: null, candidateIds: [], correction: false, intent: 'other', turnPlan: namePlan })
  assert.match(hello.reply, /¡Holaa, Matías! 😊 Soy Alba, de Nombre público/)
  assert.match(hello.reply, /¿En qué te puedo ayudar\?/); assert.doesNotMatch(hello.reply, /servicio|turno|reservar/i)
  assert.equal(hello.state.customerName, 'Matías'); assert.equal(hello.state.serviceId, null)
  assert.equal((hello.state as engine.DialogueState & { introduced?: boolean }).introduced, true)
  assert.equal(agendaCalls + dateCalls, 0)
  assert.equal(presentation(hello), undefined)
  const repeat = await respond(context, hello.state, 'hola', port, { serviceId: null, candidateIds: [], correction: false, intent: 'other' })
  assert.doesNotMatch(repeat.reply, /Alba|Nombre público/); assert.equal(identityCalls, 1)
  assert.throws(() => parseDialogueState({ ...hello.state, introduced: 'yes' }, 'tenant'), /introduction/)
  assert.equal((parseDialogueState(JSON.parse(JSON.stringify(hello.state)), 'tenant') as engine.DialogueState & { introduced?: boolean }).introduced, true)
  const rawHello = await respond(context, initialDialogueState('tenant'), 'hola soy Matías', port)
  assert.equal(rawHello.state.customerName, 'Matías'); assert.doesNotMatch(rawHello.reply, /Qué servicio|reservar|turno/i)
  assert.equal(hasActiveBooking(hello.state), false); assert.equal(hello.state.questionContext, undefined)
  assert.equal(hello.state.dialogueContext?.lastQuestion ?? null, null)
  const informationCatalog = [ { ...services[0]!, name: 'Corte hombre', description: 'Corte corto' }, { ...services[1]!, name: 'Corte mujer', description: 'Corte largo' } ]
  const informationPort = { ...port, catalog: async () => informationCatalog }
  const priced = await respond(context, hello.state, 'precio del corte', informationPort)
  assert.equal(hasActiveBooking(priced.state), false); assert.equal(priced.state.serviceId, null)
  assert.equal(priced.state.informationFocus?.awaitingChoice, true)
  assert.equal(presentation(priced)?.kind, 'service', 'informational disambiguation exposes finite choices without starting booking')
  const man = await respond(context, priced.state, 'hombre', informationPort)
  assert.match(man.reply, /2.?500/); assert.equal(man.state.informationFocus?.serviceId, 's1')
  assert.equal(hasActiveBooking(man.state), false); assert.equal(man.state.serviceId, null)
  const chosenInformation = await choose(context, priced.state, { kind: 'service', serviceId: 's1' }, informationPort)
  assert.match(chosenInformation.reply, /2.?500/); assert.equal(chosenInformation.state.informationFocus?.serviceId, 's1')
  assert.equal(hasActiveBooking(chosenInformation.state), false); assert.equal(chosenInformation.state.serviceId, null)
  assert.equal(chosenInformation.state.customerName, 'Matías'); assert.equal(chosenInformation.state.slot, null)
  const details = await respond(context, man.state, 'qué incluye', informationPort)
  assert.match(details.reply, /Corte corto/); assert.equal(hasActiveBooking(details.state), false)
  const missingSocial = await respond(context, details.state, 'instagram', informationPort)
  assert.doesNotMatch(missingSocial.reply, /presupuesto|reservar|día|turno/i); assert.equal(hasActiveBooking(missingSocial.state), false)
  await assert.rejects(() => choose(context, priced.state, { kind: 'service', serviceId: 's1' }, { ...informationPort, catalog: async () => informationCatalog.slice(1) }), engine.ConversationChoiceUnavailableError)
  const genuineStart = await respond(context, initialDialogueState('tenant'), 'quiero turno', informationPort)
  assert.equal(hasActiveBooking(genuineStart.state), true, 'actual booking request still owns its pending question')
  const facts = { businessId: 'tenant', name: 'Nombre público', address: 'Calle 123', area: 'Centro', mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: null }
  const address = renderInformation(['ADDRESS'], 'dirección', facts, [])
  assert.match(address, /Calle 123, Centro/); assert.match(address, /https:\/\/www.google.com\/maps\/search\//)
  assert.match(address, /api=1/); assert.match(address, /query=Nombre/)
  assert.doesNotMatch(renderInformation(['ADDRESS'], 'dirección', { ...facts, address: null, mapsUrl: 'https://www.google.com/evil' }, []), /https:/)
  const picked = await respond(context, hello.state, 'Corte', port, { serviceId: 's1', candidateIds: [], correction: false, intent: 'booking' })
  assert.equal(dateCalls, 1); assert.match(picked.reply, /día y horario/); assert.match(picked.reply, /2026-10-03 a las 09:00/)
  assert.equal(presentation(picked)?.kind, 'date')
  const dateOperation = presentation(picked)!.choices.find(c => c.operation.kind === 'date')!.operation
  const dated = await choose(context, picked.state, dateOperation, port)
  assert.equal(dated.state.date, '2026-10-03'); assert.equal(dated.state.customerName, 'Matías')
  assert.equal(presentation(dated)?.choices[0]?.operation.kind, 'any_professional')
  assert.match(dated.reply, /Cualquier profesional[\s\S]*Ana[\s\S]*Bea/)
  const any = await choose(context, dated.state, { kind: 'any_professional' }, port)
  assert.equal(presentation(any)?.kind, 'preference'); assert.doesNotMatch(any.reply, /09:00/)
  const shortOffer = await choose(context, any.state, { kind: 'preference', preference: { kind: 'any' } }, port)
  const nextPage = presentation(shortOffer)!.choices.find(choice => choice.operation.kind === 'page')!.operation
  const nextOffer = await choose(context, shortOffer.state, nextPage, port)
  assert.equal(nextOffer.state.slot, null); assert.match(nextOffer.reply, /12:00/)
  assert.ok(presentation(nextOffer)?.choices.some(choice => choice.operation.kind === 'page' && choice.operation.cursor === 0))
  await assert.rejects(() => choose(context, shortOffer.state, { kind: 'page', questionKind: 'slots', cursor: 7 }, port), engine.ConversationChoiceUnavailableError)
  const datedInformation = await respond(context, dated.state, 'precio del corte', informationPort)
  const draftBeforeChoice = { date: datedInformation.state.date, professional: datedInformation.state.professional, customerName: datedInformation.state.customerName, serviceId: datedInformation.state.serviceId }
  const draftInformationChoice = await choose(context, datedInformation.state, { kind: 'service', serviceId: 's2' }, informationPort)
  assert.deepEqual({ date: draftInformationChoice.state.date, professional: draftInformationChoice.state.professional, customerName: draftInformationChoice.state.customerName, serviceId: draftInformationChoice.state.serviceId }, draftBeforeChoice)
  assert.equal(draftInformationChoice.state.informationFocus?.serviceId, 's2'); assert.equal(draftInformationChoice.proposal, null)
  const unavailableDates = { ...port, verifiedDateChoices: async () => ({ ok: true as const, services: [services[0]!], durationMinutes: 30, totalPrice: 2500, professionals, slots: [] }) }
  await assert.rejects(() => choose(context, picked.state, dateOperation, unavailableDates), engine.ConversationChoiceUnavailableError)
  const narrowed = await choose(context, any.state, { kind: 'preference', preference: { kind: 'band', band: 'AFTERNOON' } }, port)
  assert.equal(narrowed.state.slot, null); assert.match(narrowed.reply, /12:00/)
  assert.match(narrowed.reply, /03[-\/]10/); assert.equal(presentation(narrowed)?.kind, 'slot')
  const slotOperation = presentation(narrowed)!.choices.find(c => c.operation.kind === 'slot')!.operation
  const selected = await choose(context, narrowed.state, slotOperation, port)
  assert.ok(selected.proposal); assert.equal(selected.state.customerName, 'Matías')
  assert.ok(selected.state.sandboxReservation); assert.equal(presentation(selected)?.kind, 'proposal')
  const confirm = presentation(selected)!.choices[0]!.operation
  const consent = await choose(context, selected.state, confirm, port)
  assert.equal(consent.bookingCommand?.kind, 'CONFIRM_SANDBOX_BOOKING')
  await assert.rejects(() => choose(context, selected.state, { kind: 'confirm', nonce: 'wrong' }, port), /choice/)
  const before = JSON.stringify(narrowed.state)
  available = []
  await assert.rejects(() => choose(context, narrowed.state, slotOperation, port), /choice/)
  assert.equal(JSON.stringify(narrowed.state), before)
  await assert.rejects(() => choose(context, narrowed.state, { kind: 'slot', date: '2026-10-03', time: '17:00', startAt: '2026-10-03T20:00:00.000Z', professionalId: 'foreign' }, port), /choice/)
  catalog = []
  await assert.rejects(() => choose(context, narrowed.state, slotOperation, port), /choice/)
  catalog = [...services]
  const provider = async () => ({ intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null, turnPlan: namePlan })
  const aiHello = await respondWithAiInterpreter(context, initialDialogueState('tenant'), 'hola soy Matías', port, provider)
  assert.match(aiHello.reply, /Alba/); assert.doesNotMatch(aiHello.reply, /Qué servicio/)
  assert.equal((aiHello.reply.match(/Soy Alba/g) ?? []).length, 1)
  assert.equal(aiHello.interpretation.aiCalls, 1)
  const badGreeting = await respondWithAiInterpreter(context, initialDialogueState('tenant'), 'hola soy Matías', port, provider, { responseProvider: async input => ({ opening: 'Hola. Soy una persona del negocio.', closing: null, factIds: input.facts.map(fact => fact.id) }) })
  assert.doesNotMatch(badGreeting.reply, /Soy una persona/); assert.equal((badGreeting.reply.match(/Soy Alba/g) ?? []).length, 1)
  const foldContext = { ...context, timezone: 'America/New_York', dbNow: new Date('2026-10-01T00:00:00.000Z') }
  available = ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'].map(startAt => ({ startAt, date: '2026-11-01', time: '01:30', band: 'MORNING', professionalId: 'p1', professionalName: 'Ana', occupiedMinutes: 30 }))
  const foldState = { ...initialDialogueState('tenant'), serviceId: 's1', date: '2026-11-01', professional: { kind: 'any' as const }, customerName: 'Matías', requestedTime: '01:30' }
  const fold = await respond(foldContext, foldState, '01:30', port)
  assert.equal(fold.state.slot, null); assert.match(fold.reply, /UTC-4/); assert.match(fold.reply, /UTC-5/)
  const laterFold = presentation(fold)!.choices.find(c => c.operation.kind === 'slot' && c.operation.startAt === '2026-11-01T06:30:00.000Z')!.operation
  const chosenFold = await choose(foldContext, fold.state, laterFold, port)
  assert.equal(chosenFold.state.slot?.startAt, '2026-11-01T06:30:00.000Z')
  const longDescription = 'Detalle público. '.repeat(450)
  const longInformation = await respond(context, initialDialogueState('tenant'), 'qué incluye Corte', { ...port, catalog: async () => [{ ...services[0]!, description: longDescription }] }, { serviceId: null, candidateIds: [], correction: false, intent: 'information', informationTarget: { kind: 'service', actions: [], serviceIds: ['s1'], aspect: 'description' } })
  assert.ok(longInformation.reply.includes(longDescription.trim())); assert.match(longInformation.reply, /Soy Alba/)
  assert.equal(hasActiveBooking(longInformation.state), false)
  const policy = { id: 's1', name: 'Corte', attentionMode: 'GUIDED_ESTIMATE' as const, price: 2500, priceMode: 'STARTING_AT' as const, estimateAllowsBooking: true, estimateQuestion: '¿Qué largo?', estimateOptions: [{ id: 'short', label: 'Corto', priceMin: 2500, priceMax: 3000, note: null }], estimateExplanation: null, estimateDisclaimer: null, requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null }
  let guidedService = { ...services[0]!, priceMode: 'STARTING_AT' as const, bookingPolicy: policy }
  const guidedPort: engine.DialoguePort = { ...port, catalog: async () => [guidedService], verifiedDateChoices: async selected => ({ ok: true, services: selected, durationMinutes: 30, totalPrice: null, professionals, slots: [] }) }
  const guideQuestion = await respond(context, { ...initialDialogueState('tenant'), serviceId: 's1', customerName: 'Matías' }, 'Corte', guidedPort)
  const estimate = presentation(guideQuestion)!.choices[0]!.operation
  assert.equal(estimate.kind, 'estimate')
  const guideChosen = await choose(context, guideQuestion.state, estimate, guidedPort)
  assert.equal(guideChosen.state.serviceEstimates?.s1?.optionId, 'short'); assert.equal(guideChosen.state.slot, null)
  guidedService = { ...guidedService, bookingPolicy: { ...policy, estimateOptions: [{ ...policy.estimateOptions[0]!, priceMin: 2700 }] } }
  await assert.rejects(() => choose(context, guideQuestion.state, estimate, guidedPort), engine.ConversationChoiceUnavailableError)
  console.log('PASS core configured intro, verified dates, adaptive typed choices, consent, stale/foreign rollback, AI and exact DST instant')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

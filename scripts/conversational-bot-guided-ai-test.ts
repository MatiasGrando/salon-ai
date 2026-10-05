import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { initialDialogueState, type DialogueService, type DialogueState, type DialoguePort } from '../src/conversational-bot/engine.js'
import { basketServiceIds, selectionBasket } from '../src/conversational-bot/service-basket.js'
import { guidedChoiceTargets, resolveGuidance } from '../src/conversational-bot/service-guidance.js'
import { serviceConfigurationKey, type ServiceBookingPolicy } from '../src/bot-options/domain/service-booking.js'
import { runConversationalPreview } from '../src/conversational-bot/demo-preview.js'
import { projectConversationDraft, readConversationDraft } from '../src/conversational-bot/session-state.js'
import type { BusinessFacts } from '../src/conversational-bot/information.js'

const context = { businessId: 'tenant-private', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T15:00:00Z') }
const policy = (id: string, name: string): ServiceBookingPolicy => ({ id, name, attentionMode: 'GUIDED_ESTIMATE', price: 85000, priceMode: 'STARTING_AT', estimateAllowsBooking: true,
  estimateQuestion: '¿Qué largo tiene tu cabello?', estimateOptions: [{ id: id + '-short', label: 'Hasta los hombros', priceMin: 85000, priceMax: 95000, note: null },
    { id: id + '-long', label: 'Debajo de los hombros', priceMin: 95000, priceMax: 110000, note: 'Sujeto a evaluación' }],
  estimateExplanation: 'El presupuesto depende del largo.', estimateDisclaimer: 'Presupuesto estimado sujeto a evaluación.', requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null })
const cut: DialogueService = { id: 'cut-private', name: 'Corte hombre', durationMinutes: 30, price: 27000, requiresConsultation: false }
const woman: DialogueService = { ...cut, id: 'woman-private', name: 'Corte mujer' }
const smooth: DialogueService = { id: 'smooth-private', name: 'Alisado', durationMinutes: 90, professionalDurationMinutes: 90, customerDurationMinutes: 150,
  price: 85000, priceMode: 'STARTING_AT', requiresConsultation: false, bookingPolicy: policy('smooth-private', 'Alisado') }
const paint: DialogueService = { ...smooth, id: 'paint-private', name: 'Coloración', bookingPolicy: policy('paint-private', 'Coloración') }
let services = [cut, woman, smooth, paint]
const initial = initialDialogueState(context.businessId)
const state: DialogueState = { ...initial, pending: 'estimate', basket: { version: 1, nextMemberId: 3, members: [
  { memberId: 'm1', mode: 'single', serviceIds: [cut.id], evidence: 'corte hombre' },
  { memberId: 'm2', mode: 'single', serviceIds: [smooth.id], evidence: 'alisado' }
] }, date: '2026-10-03', customerName: 'Matías', professionalNameHint: 'ramiro' }
const exactIds = (value: DialogueState) => selectionBasket(value).members.filter(member => member.mode === 'single').flatMap(member => member.serviceIds)
const ev = (evidence: string) => ({ evidence, confidence: .99 })
const member = (mode: string, serviceIds: string[], evidence: string) => ({ mode, serviceIds, ...ev(evidence) })
const basket = (mutation: string, members: object[], evidence: string, targets: string[] = []) => ({ kind: 'basket', mutation, members, scope: targets.length ? 'members' : 'all', targetMemberIds: targets, ...ev(evidence) })
const estimate = (serviceId: string, optionId: string | null, evidence: string) => ({ kind: 'estimate', serviceId, optionId, ...ev(evidence) })
const plan = (...operations: object[]) => ({ version: 1, operations })
const candidate = (turnPlan: unknown, extra: object = {}) => ({ intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null,
  serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null, turnPlan, ...extra })
// Explicit positive stimuli adopt the new contract; invalid/legacy proposals do not.
const currentActs = (...claims: [kind: 'request' | 'change' | 'answer' | 'inquiry', field: string, evidence: string, index: number, mention?: string][]) => ({
  communicativeActs: { version: 1, acts: claims.map(([kind, field, evidence, index, mention]) => ({
    kind, field, evidence, operationIndexes: [index], mention: mention ?? null, confidence: .99
  })) }
})
const completed = (output: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] })
let request: Record<string, any> | undefined
let nextOutput: unknown = candidate(plan())
const http = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async (_url, init) => {
  request = JSON.parse(String(init?.body)); return new Response(JSON.stringify(completed(nextOutput)), { status: 200 })
} })
await http({ message: 'hasta los hombros', state, services }, new AbortController().signal)
let input = JSON.parse(request!.input)
assert.deepEqual(input.estimateChoices, guidedChoiceTargets(services, exactIds(state)), 'real HTTP payload must expose current configured option IDs and labels')
assert.equal(input.pendingEstimateServiceId, smooth.id)
assert.deepEqual(input.estimateSelections, [])
assert.doesNotMatch(JSON.stringify(input), /priceMin|priceMax|configurationKey|85000|95000|110000|estimateDisclaimer|estimateExplanation/)
assert.match(request!.instructions, /kind estimate/)
assert.match(request!.instructions, /optionId/)
const strict = (item: any) => {
  if (item.type === 'object' || Array.isArray(item.type) && item.type.includes('object')) {
    assert.equal(item.additionalProperties, false); assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort())
  }
  if (item.properties) Object.values(item.properties).forEach(strict)
  if (item.items) strict(item.items)
  if (item.anyOf) item.anyOf.forEach(strict)
}
strict(request!.text.format.schema)
const schemas = request!.text.format.schema.properties.turnPlan.anyOf[0].properties.operations.items.anyOf
const choiceSchema = schemas.find((item: any) => item.properties.kind.enum.includes('estimate'))
assert.deepEqual(choiceSchema.required.slice().sort(), ['kind', 'evidence', 'confidence', 'serviceId', 'optionId'].sort())
assert.deepEqual(choiceSchema.properties.optionId.type, ['string', 'null'])
assert.equal(request!.model, 'gpt-6-luna'); assert.equal(request!.store, false); assert.equal(request!.max_output_tokens, 6000)
const resolvedSelection = { configurationKey: serviceConfigurationKey(smooth.bookingPolicy!), optionId: smooth.id + '-short' }
const alreadySelected = { ...state, pending: 'time' as const, serviceEstimates: { [smooth.id]: resolvedSelection } }
await http({ message: 'mejor más largo', state: alreadySelected, services }, new AbortController().signal)
input = JSON.parse(request!.input)
assert.equal(input.pendingEstimateServiceId, null)
assert.deepEqual(input.estimateSelections, [{ serviceId: smooth.id, optionId: smooth.id + '-short' }])
const changedPolicy = { ...smooth, bookingPolicy: { ...smooth.bookingPolicy!, estimateQuestion: '¿Qué variante preferís ahora?', estimateOptions: [{ id: 'updated-private', label: 'Nueva variante', priceMin: 120000, priceMax: 130000, note: null }] } }
await http({ message: 'hola', state: alreadySelected, services: [cut, woman, changedPolicy, paint] }, new AbortController().signal)
input = JSON.parse(request!.input)
assert.deepEqual(input.estimateSelections, [], 'stale fingerprint never supplies an authoritative previous choice to the model')
assert.deepEqual(input.estimateChoices[0].options, [{ id: 'updated-private', label: 'Nueva variante' }])
const ambiguous = { ...state, pending: 'service' as const, basket: { ...state.basket!, members: [{ memberId: 'm1', mode: 'alternatives' as const, serviceIds: [cut.id, woman.id], evidence: 'corte' }, state.basket!.members[1]!] } }
await http({ message: 'hasta los hombros', state: ambiguous, services }, new AbortController().signal)
assert.deepEqual(JSON.parse(request!.input).estimateChoices, guidedChoiceTargets(services, [smooth.id]), 'exact companion context survives another unresolved group')
assert.equal(JSON.parse(request!.input).pendingEstimateServiceId, null)

let jointCalls = 0, singularCalls = 0, copyCalls = 0
const facts: BusinessFacts = { businessId: context.businessId, name: 'QA', address: 'Calle 123', area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: 'Sábado 09:00 a 20:00' }
const slot = (date: string) => ({ date, time: '17:00', startAt: date + 'T20:00:00.000Z', professionalId: 'rama-private', professionalName: 'Ramiro', band: 'AFTERNOON' as const, occupiedMinutes: 0 })
const port: DialoguePort = { catalog: async () => services, information: async () => facts,
  availability: async (_service, date) => { singularCalls++; return { professionals: [{ id: 'rama-private', name: 'Ramiro', priority: 0 }], slots: [slot(date)] } },
  availabilityBasket: async (selected, date, _professional, selections) => {
    jointCalls++; const resolved = resolveGuidance(selected, selections)
    assert.equal(resolved.pending, null, 'adapter receives every choice before agenda'); assert.equal(resolved.blocked, null)
    return { ok: true, services: selected, durationMinutes: selected.reduce((sum, item) => sum + item.durationMinutes!, 0),
      customerDurationMinutes: selected.reduce((sum, item) => sum + (item.customerDurationMinutes ?? item.durationMinutes!), 0), totalPrice: null,
      professionals: [{ id: 'rama-private', name: 'Ramiro', priority: 0 }], slots: [slot(date)] }
  } }
const ai = Object.assign(http, { respond: async (value: { facts: readonly { id: string; text: string }[] }) => {
  copyCalls++; return { opening: null, closing: null, factIds: value.facts.map(fact => fact.id) }
} }) as AiInterpretationProvider
const say = async (previous: DialogueState, message: string, output: unknown, selectedPort = port) => { nextOutput = output; return respondWithAiInterpreter(context, previous, message, selectedPort, ai) }
const first = await say(initial, 'soy Matías, quiero corte y alisado mañana con Ramiro', candidate(plan(
  basket('set', [member('single', [cut.id], 'corte'), member('single', [smooth.id], 'alisado')], 'corte y alisado'),
  { kind: 'name', value: 'Matías', ...ev('Matías') }, { kind: 'date', expression: 'mañana', value: null, ...ev('mañana') }, { kind: 'professional', mode: 'specific', mention: 'Ramiro', ...ev('Ramiro') }),
  currentActs(['request', 'service', 'corte y alisado', 0], ['request', 'name', 'Matías', 1], ['request', 'date', 'mañana', 2], ['request', 'professional', 'Ramiro', 3, 'Ramiro'])))
assert.equal(first.state.pending, 'service'); assert.equal(first.state.basket?.members[0]?.mode, 'alternatives'); assert.equal(first.state.customerName, 'Matías')
assert.equal(jointCalls + singularCalls, 0)
const early = await say(first.state, 'lo tengo hasta los hombros', candidate(plan(estimate(smooth.id, smooth.id + '-short', 'lo tengo hasta los hombros'))))
assert.equal(early.state.pending, 'service'); assert.equal(early.state.serviceEstimates?.[smooth.id]?.optionId, smooth.id + '-short'); assert.equal(jointCalls, 0)
const clarified = await say(first.state, 'corte hombre', candidate(plan(basket('replace', [member('single', [cut.id], 'corte hombre')], 'corte hombre', [first.state.basket!.members[0]!.memberId]))))
assert.equal(clarified.state.pending, 'estimate'); assert.match(clarified.reply, /Qué largo tiene tu cabello/); assert.equal(jointCalls, 0)
const chosen = await say(clarified.state, 'lo tengo apenas por debajo de los hombros', candidate(plan(estimate(smooth.id, smooth.id + '-long', 'apenas por debajo de los hombros')), { firstReply: { opening: 'Viejo borrador.', factIds: [], closing: null } }))
assert.equal(chosen.state.pending, 'time'); assert.equal(chosen.interpretation.replyRoute, 'second_call'); assert.equal(chosen.interpretation.validation?.outcome, 'accepted')
assert.deepEqual(chosen.interpretation.proposal?.turnPlan?.kinds, ['estimate']); assert.equal(chosen.interpretation.proposal?.turnPlan?.estimateCount, 1)
assert.equal(chosen.interpretation.stateAfter?.estimateSelections, 1)
assert.equal(chosen.state.date, '2026-10-03'); assert.equal(chosen.state.customerName, 'Matías'); assert.equal(singularCalls, 0)
assert.doesNotMatch(chosen.reply, /Viejo borrador/)
const copiesBeforeProposal = copyCalls
const complete = await say(chosen.state, '17hs', candidate(plan({ kind: 'time', value: '17:00', ...ev('17hs') })))
assert.equal(complete.proposal?.durationMinutes, 120); assert.equal(complete.proposal?.customerDurationMinutes, 180); assert.equal(complete.proposal?.totalPrice, null)
assert.match(complete.reply, /95\.000 a \$ 110\.000/); assert.match(complete.reply, /estimado|evaluación/); assert.match(complete.reply, /Todavía no está reservado/)
assert.equal(complete.interpretation.replyRoute, 'motor'); assert.equal(copyCalls, copiesBeforeProposal)
assert.doesNotMatch(JSON.stringify(chosen.interpretation), /private|Matías|Ramiro|hombros|85000|95000|110000|configurationKey|2026-10-03/)

for (const pending of ['service', 'estimate', 'date', 'professional', 'time', 'name', 'proposal'] as const) {
  const previous = { ...complete.state, pending, ...(pending === 'estimate' ? { slot: null } : {}) }
  const changed = await say(previous, 'mejor hasta los hombros el lunes soy Matías', candidate(plan(estimate(smooth.id, smooth.id + '-short', 'hasta los hombros'),
    { kind: 'date', expression: 'el lunes', value: '2026-10-05', ...ev('el lunes') }, { kind: 'name', value: 'Matías', ...ev('Matías') }), currentActs(['change', 'estimate', 'mejor hasta los hombros', 0], ['change', 'date', 'el lunes', 1], ['request', 'name', 'soy Matías', 2])))
  assert.equal(changed.state.serviceEstimates?.[smooth.id]?.optionId, smooth.id + '-short', pending)
  assert.equal(changed.state.date, '2026-10-05'); assert.equal(changed.state.slot, null); assert.equal(changed.proposal, null); assert.notEqual(changed.interpretation.replyRoute, 'first_call')
}
for (const operation of [estimate(paint.id, paint.id + '-short', 'hasta los hombros'), estimate(cut.id, smooth.id + '-short', 'hasta los hombros'),
  estimate(smooth.id, paint.id + '-short', 'hasta los hombros'), estimate(smooth.id, 'invented-private', 'hasta los hombros'),
  estimate(smooth.id, smooth.id + '-short', 'not mentioned'), { ...estimate(smooth.id, smooth.id + '-short', 'hasta los hombros'), priceMin: 1 },
  { ...estimate(smooth.id, smooth.id + '-short', 'hasta los hombros'), confidence: 1.1 }]) {
  const agendaBefore: number = jointCalls
  const rejected = await say(chosen.state, 'hasta los hombros', candidate(plan(operation)))
  assert.equal(rejected.interpretation.reason, 'invalid_output'); assert.equal(rejected.interpretation.validation?.reason, 'turn_plan')
  assert.deepEqual(rejected.state.serviceEstimates, chosen.state.serviceEstimates); assert.deepEqual(rejected.state.basket, chosen.state.basket)
  assert.equal(jointCalls, agendaBefore); assert.equal(rejected.proposal, null)
  assert.doesNotMatch(JSON.stringify(rejected.interpretation), /invented-private|not mentioned|priceMin/)
}
const agendaBeforeClear = jointCalls
const cleared = await say(chosen.state, 'sacá la elección del largo', candidate(plan(estimate(smooth.id, null, 'sacá la elección del largo')), currentActs(['change', 'estimate', 'sacá la elección del largo', 0])))
assert.equal(cleared.state.pending, 'estimate'); assert.equal(cleared.state.serviceEstimates?.[smooth.id], undefined); assert.equal(jointCalls, agendaBeforeClear)
assert.equal(cleared.state.customerName, 'Matías'); assert.equal(cleared.state.date, '2026-10-03')
const malicious = Object.assign(async () => candidate(plan(estimate(smooth.id, smooth.id + '-short', 'hasta los hombros'))), {
  respond: async (value: { facts: readonly { id: string; text: string }[] }) => ({ opening: 'El precio es $ 1.', closing: null, factIds: value.facts.map(fact => fact.id) })
}) as AiInterpretationProvider
const unsafe = await respondWithAiInterpreter(context, clarified.state, 'hasta los hombros', port, malicious)
assert.equal(unsafe.interpretation.copyReason, 'invalid_response'); assert.doesNotMatch(unsafe.reply, /precio es \$ 1/)
const freshPort: DialoguePort = { ...port, availabilityBasket: async () => ({ ok: false, reason: 'GUIDANCE_REQUIRED', services: [cut, changedPolicy] }) }
const refreshed = await say(chosen.state, '17hs', candidate(plan({ kind: 'time', value: '17:00', ...ev('17hs') }), { firstReply: { opening: 'Viejo borrador.', closing: null, factIds: [] } }), freshPort)
assert.equal(refreshed.state.pending, 'estimate'); assert.equal(refreshed.state.serviceEstimates?.[smooth.id], undefined)
assert.match(refreshed.reply, /Nueva variante/); assert.doesNotMatch(refreshed.reply, /Hasta los hombros|Viejo borrador/)
assert.equal(refreshed.interpretation.replyRoute, 'motor'); assert.equal(refreshed.interpretation.deliveryOrigin, 'prepared'); assert.equal(refreshed.proposal, null)
services = [cut, woman, changedPolicy, paint]
const freshChosen = await say(refreshed.state, 'la nueva variante', candidate(plan(estimate(smooth.id, 'updated-private', 'nueva variante'))))
assert.equal(freshChosen.interpretation.mode, 'ai'); assert.equal(freshChosen.state.serviceEstimates?.[smooth.id]?.optionId, 'updated-private')
assert.deepEqual(JSON.parse(request!.input).estimateChoices[0].options, [{ id: 'updated-private', label: 'Nueva variante' }])
services = [cut, woman, smooth, paint]
const together = await say(ambiguous, 'corte hombre, hasta los hombros y dirección', candidate(plan(
  basket('replace', [member('single', [cut.id], 'corte hombre')], 'corte hombre', ['m1']), estimate(smooth.id, smooth.id + '-short', 'hasta los hombros'),
  { kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, ...ev('dirección') }), currentActs(['answer', 'service', 'corte hombre', 0], ['answer', 'estimate', 'hasta los hombros', 1], ['inquiry', 'general', 'dirección', 2])))
assert.equal(together.interpretation.mode, 'ai'); assert.equal(together.state.serviceEstimates?.[smooth.id]?.optionId, smooth.id + '-short'); assert.match(together.reply, /Calle 123/)
for (const message of ['hola', 'dónde están?']) {
  const agendaBefore: number = jointCalls, copiesBefore: number = copyCalls
  const info = message === 'hola' ? [] : [{ kind: 'information', target: { kind: 'business', actions: ['ADDRESS'] }, ...ev('dónde están') }]
  const provider = Object.assign(async (value: { firstReplyFacts?: readonly { id: string; text: string }[] }) => candidate(plan(...info), { intent: info.length ? 'information' : 'other', firstReply: { opening: null, closing: null, factIds: value.firstReplyFacts?.map(fact => fact.id) ?? [] } }), { respond: ai.respond }) as AiInterpretationProvider
  const read = await respondWithAiInterpreter(context, clarified.state, message, port, provider)
  assert.equal(read.interpretation.aiCalls, 1); assert.equal(read.interpretation.replyRoute, 'first_call'); assert.equal(jointCalls, agendaBefore); assert.equal(copyCalls, copiesBefore)
  assert.deepEqual(read.state.basket, clarified.state.basket); assert.equal(read.state.pending, 'estimate')
}
const double = await say(initial, 'alisado y coloración', candidate(plan(basket('set', [member('single', [smooth.id], 'alisado'), member('single', [paint.id], 'coloración')], 'alisado y coloración'))))
const one = await say(double.state, 'hasta los hombros', candidate(plan(estimate(smooth.id, smooth.id + '-short', 'hasta los hombros'))))
assert.equal(one.state.pending, 'estimate'); assert.equal(one.state.serviceEstimates?.[paint.id], undefined)
await http({ message: 'debajo de los hombros', state: one.state, services }, new AbortController().signal)
assert.equal(JSON.parse(request!.input).pendingEstimateServiceId, paint.id); assert.equal(JSON.parse(request!.input).estimateSelections.length, 1)
const both = await say(one.state, 'debajo de los hombros mañana con Ramiro', candidate(plan(estimate(paint.id, paint.id + '-long', 'debajo de los hombros'),
  { kind: 'date', expression: 'mañana', value: null, ...ev('mañana') }, { kind: 'professional', mode: 'specific', mention: 'Ramiro', ...ev('Ramiro') }), currentActs(['answer', 'estimate', 'debajo de los hombros', 0], ['request', 'date', 'mañana', 1], ['request', 'professional', 'Ramiro', 2, 'Ramiro'])))
assert.equal(both.state.pending, 'time'); assert.equal(Object.keys(both.state.serviceEstimates ?? {}).length, 2)

const runtimePolicy = { businessId: context.businessId, deploymentId: 'dep', generation: 1, configurationId: 'cfg', engine: 'conversational-booking-v1', schemaVersion: 1 } as const
const stored = new Map<string, unknown>()
const dependencies = { load: async (phone: string) => stored.has(phone) ? readConversationDraft(stored.get(phone), runtimePolicy, context.timezone) : null,
  save: async (phone: string, _message: string, _reply: string, value: DialogueState) => { stored.set(phone, projectConversationDraft(value, runtimePolicy)) },
  createPort: async () => ({ context, port }), interpretationProvider: ai }
nextOutput = candidate(plan(basket('set', [member('single', [cut.id], 'corte'), member('single', [smooth.id], 'alisado')], 'corte y alisado'),
  { kind: 'name', value: 'Matías', ...ev('Matías') }, { kind: 'date', expression: 'mañana', value: null, ...ev('mañana') }, { kind: 'professional', mode: 'specific', mention: 'Ramiro', ...ev('Ramiro') }),
  currentActs(['request', 'service', 'corte y alisado', 0], ['request', 'name', 'Matías', 1], ['request', 'date', 'mañana', 2], ['request', 'professional', 'Ramiro', 3, 'Ramiro']))
const previewFirst = await runConversationalPreview(dependencies, context.businessId, 'preview-only', 'Matías corte y alisado mañana con Ramiro')
nextOutput = candidate(plan(basket('replace', [member('single', [cut.id], 'corte hombre')], 'corte hombre', [previewFirst.state.basket!.members[0]!.memberId])))
const previewGuide = await runConversationalPreview(dependencies, context.businessId, 'preview-only', 'corte hombre')
assert.equal(previewGuide.state.pending, 'estimate'); assert.equal(readConversationDraft(stored.get('preview-only'), runtimePolicy, context.timezone).pending, 'estimate')
nextOutput = candidate(plan(estimate(smooth.id, smooth.id + '-short', 'hasta los hombros')))
const previewTime = await runConversationalPreview(dependencies, context.businessId, 'preview-only', 'hasta los hombros')
assert.deepEqual(basketServiceIds(previewTime.state), [cut.id, smooth.id])
nextOutput = candidate(plan({ kind: 'time', value: '17:00', ...ev('17hs') }))
const previewComplete = await runConversationalPreview(dependencies, context.businessId, 'preview-only', '17hs')
assert.equal(previewComplete.proposalReady, true); assert.match(previewComplete.reply, /120 min/); assert.match(previewComplete.reply, /85\.000 a \$ 95\.000/)
assert.deepEqual(readConversationDraft(JSON.parse(JSON.stringify(stored.get('preview-only'))), runtimePolicy, context.timezone).serviceEstimates, previewComplete.state.serviceEstimates)
console.log('conversational guided AI: strict HTTP context/schema, semantic choice proposals, partial basket, independent corrections, privacy, preview and canonical ranges PASS')

const focusedPriceState: DialogueState = { ...initial, informationFocus: { version: 1, businessId: context.businessId, topic: 'price', aspect: 'price', serviceId: smooth.id, awaitingChoice: false, candidateId: null, options: [{ id: smooth.id, label: smooth.name }] } }
await http({ message: 'por debajo de los hombros', state: focusedPriceState, services }, new AbortController().signal)
const informativeInput = JSON.parse(request!.input)
assert.deepEqual(informativeInput.informationEstimateChoices, guidedChoiceTargets(services, [smooth.id]))
assert.deepEqual(informativeInput.estimateChoices, [], 'informative options do not become selected booking options')
assert.match(request!.instructions, /estimateOptionId/)
assert.doesNotMatch(JSON.stringify(informativeInput.informationEstimateChoices), /priceMin|priceMax|configurationKey/)
const informationSchemas = schemas.find((item: any) => item.properties.kind.enum.includes('information')).properties.target.anyOf
assert.ok(informationSchemas.some((item: any) => item.properties.estimateOptionId), 'strict information schema carries the configured option identity')
console.log('PASS first-call informative estimates expose identities separately from booking choices')

const focusedExactCompanion = { ...ambiguous, informationFocus: focusedPriceState.informationFocus }
const exactCompanionEstimate = await say(focusedExactCompanion, 'hasta los hombros', candidate(plan(estimate(smooth.id, smooth.id + '-short', 'hasta los hombros'))), { ...port, catalog: async () => [cut, woman, smooth, paint] })
assert.equal(exactCompanionEstimate.interpretation.reason, null)
assert.equal(exactCompanionEstimate.state.serviceEstimates?.[smooth.id]?.optionId, smooth.id + '-short', 'an exact selected companion remains a booking estimate even when another group is unresolved')
assert.deepEqual(exactCompanionEstimate.state.basket, focusedExactCompanion.basket)
assert.equal(exactCompanionEstimate.proposal, null)
console.log('PASS informative focus never reclassifies an exact companion booking estimate')

const humanMixedMessage = 'hola queria realizaeme un alisado. cual seria el precio?'
const queriesBeforeHumanContract = jointCalls + singularCalls
const humanMixedContract = await say(initial, humanMixedMessage, candidate(plan(
  basket('set', [member('single', [smooth.id], 'alisado')], 'alisado'),
  { kind: 'information', target: { kind: 'service', actions: [], serviceIds: [smooth.id], aspect: 'price' }, ...ev('precio') }
), { intent: 'booking' }), { ...port, catalog: async () => [smooth] })
assert.equal(humanMixedContract.interpretation.reason, null)
assert.equal(humanMixedContract.interpretation.aiCalls, 1)
assert.equal(humanMixedContract.state.serviceId, smooth.id)
assert.equal(humanMixedContract.state.pending, 'estimate')
assert.equal((humanMixedContract.reply.match(/85\.000/g) ?? []).length, 1)
assert.equal((humanMixedContract.reply.match(/Presupuesto estimado sujeto a evaluación/g) ?? []).length, 1)
assert.equal(humanMixedContract.proposal, null)
assert.equal(jointCalls + singularCalls, queriesBeforeHumanContract)
const humanLengthMessage = 'perfecto. el largro de mi pelo es por debajo de los hombros.'
const humanInformativeContract = await say(focusedPriceState, humanLengthMessage, candidate(plan(
  estimate(smooth.id, smooth.id + '-long', 'por debajo de los hombros')
)), { ...port, catalog: async () => [smooth] })
assert.equal(humanInformativeContract.interpretation.reason, null)
assert.equal(humanInformativeContract.state.serviceId, null)
assert.equal(humanInformativeContract.state.serviceEstimates, undefined)
assert.match(humanInformativeContract.reply, /95\.000 a \$ 110\.000/)
assert.doesNotMatch(humanInformativeContract.reply, /Qué servicio necesitás/)
assert.match(humanInformativeContract.reply, /agendar Alisado/)
assert.equal(humanInformativeContract.proposal, null)
assert.equal(jointCalls + singularCalls, queriesBeforeHumanContract)
console.log('PASS human wording exercises controlled mixed-acquisition and informative-estimate contracts without claiming model understanding')

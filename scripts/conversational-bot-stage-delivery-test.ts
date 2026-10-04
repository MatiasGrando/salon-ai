import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from '../src/conversational-bot/openai-response-provider.js'
import { contentSourceHash, attachServiceContent } from '../src/bot-options/domain/service-content.js'
import { guidanceDelivery, renderGuidedEstimates } from '../src/conversational-bot/service-guidance.js'
import assert from 'node:assert/strict'
import { initialDialogueState, respond, type DialoguePort, type DialogueService } from '../src/conversational-bot/engine.js'
import { respondWithAiInterpreter, type AiInterpretationInput } from '../src/conversational-bot/ai-interpreter.js'
import { validateReplyDraft, replyContract } from '../src/conversational-bot/reply-contract.js'
const context = { businessId: 'tenant', timezone: 'UTC', dbNow: new Date('2026-10-03T12:00:00Z') }
const service: DialogueService = { id: 'smooth', name: 'Tratamiento', price: 100, priceMode: 'STARTING_AT', durationMinutes: 30, requiresConsultation: false, bookingPolicy: {
  id: 'smooth', name: 'Tratamiento', attentionMode: 'GUIDED_ESTIMATE', price: 100, priceMode: 'STARTING_AT', estimateAllowsBooking: true, estimateQuestion: '¿Qué largo tenés?',
  estimateOptions: [{ id: 'short', label: 'Corto', priceMin: 100, priceMax: 200, note: null }], estimateExplanation: 'El largo determina el presupuesto.', estimateDisclaimer: 'Precio estimado. Asistir con pelo limpio.', requiresPhoto: false, validationEnabled: false, validationMessage: null, validationQuestion: null } }
const second: DialogueService = { id: 'cut', name: 'Corte', price: 100, durationMinutes: 30, requiresConsultation: false }
const port: DialoguePort = { catalog: async () => [service, second], availability: async () => { throw new Error('no agenda for choice') } }
const before = { ...initialDialogueState('tenant'), serviceId: null, basket: { version: 1 as const, nextMemberId: 3, members: [{ memberId: 'm1', evidence: 'Tratamiento', mode: 'single' as const, serviceIds: ['smooth'] }, { memberId: 'm2', evidence: 'Corte', mode: 'single' as const, serviceIds: ['cut'] }] }, pending: 'estimate' as const }
const change = { version: 1 as const, operations: [{ kind: 'basket' as const, mutation: 'remove' as const, scope: 'members' as const, targetMemberIds: ['m2'], members: [], evidence: 'sólo Tratamiento', confidence: 1 }] }
const response = await respond(context, before, 'sólo Tratamiento', port, { intent: 'booking', turnPlan: change, serviceId: null, candidateIds: [], correction: false })
assert.ok(response.reply.startsWith('Seguimos sólo con Tratamiento.'), 'acknowledge the applied change before discussing remaining choice')
assert.ok(response.reply.indexOf('• Corto') > response.reply.indexOf('Seguimos sólo'))
assert.ok(response.reply.endsWith('¿Qué largo tenés?'))
assert.ok(response.reply.includes(service.bookingPolicy!.estimateDisclaimer!))
let first: AiInterpretationInput | undefined, calls = 0
const stable = await respondWithAiInterpreter(context, { ...initialDialogueState('tenant'), serviceId: 'smooth', pending: 'estimate' }, 'mostrame las opciones', port,
  Object.assign(async (input: AiInterpretationInput) => { first = input; calls++; return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, firstReply: { opening: 'Claro.', factIds: input.firstReplyFacts!.map(fact => fact.id), closing: null } } }, { respond: async () => { calls++; throw new Error('stable guided facts do not need another call') } }))
assert.equal(calls, 1, JSON.stringify({ trace: stable.interpretation.replyValidation, first: first?.firstReplyFacts, reply: stable.reply, state: stable.state }))
assert.ok(first?.firstReplyFacts?.some(fact => fact.text.includes('$ 100 a $ 200')))
assert.ok(stable.reply.includes('• Corto'))
const facts = [{ id: 'why', text: 'El largo determina el presupuesto.', variants: [{ id: 'brief', text: 'El presupuesto depende del largo.' }] }, { id: 'next', text: '¿Qué largo tenés?' }]
const policy = replyContract('clarification', false, false, facts)
const draft = { opening: null, closing: null, factIds: ['why', 'next'], variantChoices: [{ factId: 'why', variantId: 'brief' }] }
assert.equal(validateReplyDraft(draft, facts, policy, []).text, 'El presupuesto depende del largo.\n¿Qué largo tenés?')
assert.equal(validateReplyDraft({ ...draft, variantChoices: [{ factId: 'next', variantId: 'brief' }] }, facts, policy, []).validation.status, 'rejected')
console.log('PASS actual applied change, staged choice organization, known guided facts one call and reviewed variants only')

const cuts: DialogueService[] = ['hombre', 'mujer', 'niño'].map((suffix, index) => ({ id: 'cut' + index, name: 'Corte ' + suffix, price: 100, durationMinutes: 30, requiresConsultation: false }))
const cutsPort: DialoguePort = { catalog: async () => cuts, availability: async () => { throw new Error('no agenda before date') } }
const ambiguousModel = (evidence: string) => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: { version: 1, operations: [{ kind: 'basket', mutation: 'set', scope: 'all', targetMemberIds: [], members: [{ mode: 'alternatives', serviceIds: ['cut0', 'cut1'], evidence, confidence: .99 }], evidence, confidence: .99 }] } })
const exactNamed = await respondWithAiInterpreter(context, initialDialogueState('tenant'), 'Corte hombre', cutsPort, async () => ambiguousModel('Corte hombre'))
assert.equal(exactNamed.state.serviceId, 'cut0', 'unique full catalog name in a standalone explicit selection is not ambiguous merely because model returns a group')
assert.equal(exactNamed.state.pending, 'date')
for (const message of ['no Corte hombre', 'Corte hombre o Corte mujer', '¿Corte hombre?']) {
  const notClosed = await respondWithAiInterpreter(context, initialDialogueState('tenant'), message, cutsPort, async () => ambiguousModel('Corte hombre'))
  assert.equal(notClosed.state.serviceId, null, 'surrounding negation or choice cannot become an exact standalone selection')
}
const generic = await respondWithAiInterpreter(context, initialDialogueState('tenant'), 'corte', cutsPort, async () => ambiguousModel('corte'))
assert.equal(generic.state.serviceId, null)
assert.equal(generic.state.basket?.members[0]?.serviceIds.length, 3, 'genuine generic ambiguity still exposes every grounded variant')
console.log('PASS closed unique exact catalog grounding; no negation/alternative/multi shortcut')
const original = service.bookingPolicy!
const split = original.estimateDisclaimer!.indexOf(' Asistir')
const metadata = { version: 1, businessId: 'tenant', serviceId: service.id, reviewed: true, revision: 1, sourceHash: contentSourceHash(original), segments: [
  { id: 'option:short', source: 'explanation', start: 0, end: original.estimateExplanation!.length, stage: 'choice', role: 'prose', variants: ['El presupuesto depende del largo.'] },
  { id: 'estimated', source: 'disclaimer', start: 0, end: split, stage: 'both', role: 'condition', variants: [] },
  { id: 'prepare', source: 'disclaimer', start: split, end: original.estimateDisclaimer!.length, stage: 'attendance', role: 'condition', variants: [] }
] }
const reviewedService = { ...service, bookingPolicy: attachServiceContent(original, 'tenant', { version: 1, businessId: 'tenant', services: [metadata] }) }
const delivery = guidanceDelivery(reviewedService, 'tenant')
assert.equal(new Set(delivery.facts.map(fact => fact.id)).size, delivery.facts.length, 'configured segment IDs cannot collide with immutable generated option IDs')
const reviewPort: DialoguePort = { ...port, catalog: async () => [reviewedService, second] }
const reviewState = { ...initialDialogueState('tenant'), serviceId: service.id, pending: 'estimate' as const }
for (const mode of ['reviewed', 'forged', 'error', 'timeout'] as const) {
  let count = 0
  const composed = await respondWithAiInterpreter(context, reviewState, 'mostrame las opciones', reviewPort,
    Object.assign(async (input: AiInterpretationInput) => {
      count++
      if (mode === 'error') throw new Error('private provider detail')
      if (mode === 'timeout') return new Promise(() => {})
      const prose = input.firstReplyFacts!.find(fact => fact.variants?.length)!
      return { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, firstReply: { opening: null, closing: null, factIds: input.firstReplyFacts!.map(fact => fact.id), variantChoices: [{ factId: prose.id, variantId: mode === 'forged' ? 'unknown' : '0' }] } }
    }, { respond: async () => { throw new Error('known facts cannot require another call') } }), { timeoutMs: 20 })
  assert.equal(count, 1); assert.equal(composed.interpretation.aiCalls, 1)
  assert.ok(composed.reply.includes('• Corto: $ 100 a $ 200 (estimado)'))
  assert.ok(composed.reply.includes('Precio estimado.')); assert.ok(composed.reply.endsWith('¿Qué largo tenés?'))
  assert.ok(!composed.reply.includes('pelo limpio'), 'reviewed attendance is deferred, but price conditions are not')
  assert.ok(composed.reply.includes(mode === 'reviewed' ? 'El presupuesto depende del largo.' : original.estimateExplanation!))
  assert.equal(composed.interpretation.copyMode, mode === 'reviewed' ? 'ai' : mode === 'forged' ? 'prepared' : 'fallback')
  const { dialogueContext: _dialogue, questionContext: _question, ...unchangedDraft } = composed.state
  assert.deepEqual(unchangedDraft, reviewState, 'provider fallback may refresh question evidence but not booking data')
  assert.equal(composed.state.sandboxReservation, undefined)
  assert.doesNotMatch(JSON.stringify(composed.interpretation), /private provider|pelo limpio|Tratamiento/)
}
const requests: any[] = []
const fakeFetch: typeof fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }), { status: 200 }) }
await createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: fakeFetch })({ message: 'opciones', state: reviewState, services: [reviewedService], firstReplyFacts: delivery.facts }, new AbortController().signal)
await createOpenAiResponseProvider({ apiKey: 'fake-only', fetchImpl: fakeFetch })({ message: 'opciones', state: reviewState, intent: 'other', facts: delivery.facts }, new AbortController().signal)
for (const request of requests) {
  const schema = request.text.format.schema.properties.firstReply ?? request.text.format.schema
  assert.ok(schema.required.includes('variantChoices')); assert.equal(schema.properties.variantChoices.items.additionalProperties, false)
  assert.match(request.instructions, /variantChoices.*factId.*variantId/)
  assert.ok(JSON.parse(request.input).facts?.some((fact: any) => fact.variants?.length) || JSON.parse(request.input).firstReplyFacts?.some((fact: any) => fact.variants?.length))
}
console.log('PASS reviewed prose selection in both provider contracts, accepted/rejected/timeout fallback and immutable conditions/prices/continuation')
const chosenSummary = renderGuidedEstimates([reviewedService], { smooth: { configurationKey: (await import('../src/bot-options/domain/service-booking.js')).serviceConfigurationKey(reviewedService.bookingPolicy), optionId: 'short' } }, 'tenant')
assert.ok(chosenSummary.includes('$ 100 a $ 200 (estimado)'))
assert.ok(chosenSummary.includes('Precio estimado.'))
assert.ok(!chosenSummary.includes('pelo limpio'), 'selected-option summary still belongs to choice stage, not attendance')
let changeNeutral: boolean | undefined
const changedCopy = await respondWithAiInterpreter(context, before, 'sólo Tratamiento', port,
  Object.assign(async () => ({ intent: 'booking', serviceId: null, serviceEvidence: null, professionalMention: null, turnPlan: change }), {
    respond: async (input: import('../src/conversational-bot/ai-interpreter.js').AiResponseInput) => { changeNeutral = input.replyContract?.neutral; return { opening: null, closing: null, factIds: input.facts.map(fact => fact.id), variantChoices: null } }
  }))
assert.equal(changeNeutral, undefined, 'prepared server guidance needs no redundant composer call')
assert.equal(changedCopy.interpretation.deliveryOrigin, 'prepared')
assert.ok(changedCopy.reply.startsWith('Seguimos sólo con Tratamiento.'))
assert.equal(changedCopy.replyFacts?.[0]?.id, 'acknowledgment', 'the grounded applied change still leads the prepared guide')
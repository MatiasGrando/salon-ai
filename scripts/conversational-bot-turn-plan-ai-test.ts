import { classifyTemporalRequest, approximateTimeRequest } from '../src/conversational-bot/time-preference.js'
import { parseTurnPlan, TurnPlanValidationError } from '../src/conversational-bot/turn-plan.js'
import { groundTemporalPlan } from '../src/conversational-bot/temporal-grounding.js'
import assert from 'node:assert/strict'
import { respondWithAiInterpreter, type AiInterpretationInput, type AiInterpretationProvider } from '../src/conversational-bot/ai-interpreter.js'
import { initialDialogueState, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { createOpenAiInterpretationProvider } from '../src/conversational-bot/openai-interpretation-provider.js'
import type { BusinessFacts } from '../src/conversational-bot/information.js'

const context = { businessId: 'tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-01T12:00:00Z') }
const services = [
  { id: 'cut-private-id', name: 'Corte hombre', durationMinutes: 30, requiresConsultation: false, price: 100 },
  { id: 'barba-private-id', name: 'Corte y barba', durationMinutes: 45, requiresConsultation: false, price: 200 }
]
const businessFacts: BusinessFacts = { businessId: 'tenant', name: 'QA', address: 'Calle 123', area: null, mapsUrl: null, website: null, bookingUrl: null, whatsapp: null, email: null, instagram: null, facebook: null, tiktok: null, description: null, hours: 'Viernes: 09:00 a 18:00' }
const legacy = { intent: 'other', serviceId: null, serviceEvidence: null, professionalMention: null, serviceConfidence: 'certain', serviceCandidateIds: [], serviceCorrection: false, informationTarget: null, firstReply: null, intakeReply: null }
const operation = (kind: string, evidence: string, fields: object = {}) => ({ kind, evidence, confidence: 1, ...fields })
const plan = (...operations: object[]) => ({ version: 1, operations })
const completion = (candidate: unknown) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(candidate) }] }] })
let request: Record<string, any> | undefined
let httpCalls = 0
const http = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async (_url, init) => {
  httpCalls++; request = JSON.parse(String(init?.body))
  return new Response(JSON.stringify(completion({ ...legacy, turnPlan: plan() })), { status: 200 })
} })
await http({ message: 'hola', state: initialDialogueState('tenant'), services, businessDate: '2026-10-01', timezone: context.timezone }, new AbortController().signal)
assert.ok(request!.text.format.schema.required.includes('turnPlan'), 'actual Responses request must expose the modular turn plan')
assert.equal(request!.text.format.strict, true)
const strictObjects = (schema: any) => {
  if (schema.type === 'object' || Array.isArray(schema.type) && schema.type.includes('object')) {
    assert.equal(schema.additionalProperties, false)
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort())
  }
  if (schema.properties) Object.values(schema.properties).forEach(strictObjects)
  if (schema.items) strictObjects(schema.items)
  if (schema.anyOf) schema.anyOf.forEach(strictObjects)
}
strictObjects(request!.text.format.schema)
assert.equal(request!.text.format.schema.type, 'object')
assert.ok(request!.text.format.schema.properties.turnPlan.anyOf.some((part: any) => part.type === 'null'))
const planSchema = request!.text.format.schema.properties.turnPlan.anyOf.find((part: any) => part.type === 'object')
assert.ok(planSchema.properties.operations.items.anyOf.find((part: any) => part.properties.kind.enum.includes('service')).properties.mode.enum.includes('unresolved'))
assert.match(request!.instructions, /(?:combin|simult)/i)
assert.match(request!.instructions, /(?:nombre|name)[^.]*pendiente/i)
assert.match(request!.instructions, /alternativas[^.]*múltiples|múltiples[^.]*alternativas/i)
assert.equal(request!.store, false)
assert.equal(request!.reasoning.effort, 'none')
assert.ok(request!.max_output_tokens >= 1800, 'bounded multi-operation plans need more than the legacy 600-token output limit')
assert.equal(JSON.parse(request!.input).customerName, null)
assert.equal(JSON.parse(request!.input).requestedTime, null)
const fullCatalog = Array.from({ length: 200 }, (_unused, index) => ({ ...services[0]!, id: 'catalog-' + index, name: 'Servicio ' + index }))
await http({ message: 'hola', state: initialDialogueState('tenant'), services: fullCatalog }, new AbortController().signal)
assert.equal(JSON.parse(request!.input).services.length, 200, 'the actual provider input must not silently truncate a catalog accepted by its 200-service bound')
const callsBeforeOversize = httpCalls
await assert.rejects(() => http({ message: 'hola', state: initialDialogueState('tenant'), services: [...fullCatalog, { ...services[0]!, id: 'catalog-201' }] }, new AbortController().signal), /too large/)
assert.equal(httpCalls, callsBeforeOversize, '201 catalog entries are rejected before fetch')

async function say(message: string, turnPlan: unknown, previous: DialogueState = initialDialogueState('tenant'), intent = 'other', options: { legacyOnly?: boolean; draft?: boolean; reverseCopy?: boolean; legacyFields?: object; acts?: { kind: string; field: string; evidence: string; operationIndexes: number[]; mention?: string }[] } = {}) {
  let calls = 0, availabilityCalls = 0, informationCalls = 0
  let firstInput: AiInterpretationInput | undefined
  let finalFacts: readonly { id: string; text: string }[] = []
  const port: DialoguePort = {
    catalog: async () => services,
    information: async () => { informationCalls++; return businessFacts },
    availability: async () => { availabilityCalls++; return { professionals: [{ id: 'ramiro-private-id', name: 'Ramiro', priority: 0 }], slots: [{ date: '2026-10-02', time: '17:00', startAt: '2026-10-02T20:00:00Z', professionalId: 'ramiro-private-id', professionalName: 'Ramiro', band: 'AFTERNOON', occupiedMinutes: 30 }] } }
  }
  const provider = Object.assign(async (input: AiInterpretationInput) => {
    calls++; firstInput = input
    return { ...legacy, ...options.legacyFields, intent, ...(options.acts ? { communicativeActs: { version: 1, acts: options.acts.map(act => ({ ...act, confidence: 1, mention: act.mention ?? null })) } } : {}), ...(options.legacyOnly ? {} : { turnPlan }), ...(options.draft ? { firstReply: { opening: 'Hola.', factIds: input.firstReplyFacts?.map(fact => fact.id) ?? [], closing: null } } : {}) }
  }, { respond: async (input: { facts: readonly { id: string; text: string }[] }) => {
    calls++; finalFacts = input.facts
    return { opening: null, factIds: options.reverseCopy ? [...input.facts].reverse().map(fact => fact.id) : input.facts.map(fact => fact.id), closing: null }
  } }) as AiInterpretationProvider
  const response = await respondWithAiInterpreter(context, previous, message, port, provider)
  return { response, calls, availabilityCalls, informationCalls, firstInput: firstInput!, finalFacts }
}
const mixed = await say('Corte hombre la jornada siguiente con Ramiro a las cinco de la tarde, dónde están?', plan(
  operation('service', 'Corte hombre', { mode: 'single', serviceIds: ['cut-private-id'], correction: false }),
  operation('date', 'la jornada siguiente', { expression: 'la jornada siguiente', value: '2026-10-02' }),
  operation('professional', 'Ramiro', { mode: 'specific', mention: 'Ramiro' }),
  operation('time', 'cinco de la tarde', { value: '17:00' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
), undefined, 'information', { draft: true, acts: [
  { kind: 'request', field: 'service', evidence: 'Corte hombre', operationIndexes: [0] },
  { kind: 'request', field: 'date', evidence: 'la jornada siguiente', operationIndexes: [1] },
  { kind: 'request', field: 'professional', evidence: 'con Ramiro', operationIndexes: [2], mention: 'Ramiro' },
  { kind: 'request', field: 'time', evidence: 'cinco de la tarde', operationIndexes: [3] },
  { kind: 'inquiry', field: 'general', evidence: 'dónde están', operationIndexes: [4] }
] })
assert.equal(mixed.response.interpretation.mode, 'ai')
assert.equal(mixed.response.state.serviceId, 'cut-private-id')
assert.equal(mixed.response.state.date, '2026-10-02')
assert.equal(mixed.response.state.requestedTime, '17:00', 'normalized semantic time is not restricted to numeric input patterns')
assert.equal(mixed.response.state.professional?.kind, 'specific')
assert.equal(mixed.response.state.pending, 'name')
assert.match(mixed.response.reply, /Calle 123/)
assert.match(mixed.response.reply, /nombre/i)
assert.equal(mixed.response.interpretation.replyRoute, 'second_call', 'stale first-call copy must not replace post-update facts')
assert.ok(mixed.availabilityCalls > 0)
assert.equal(mixed.informationCalls, 1)
assert.equal(mixed.finalFacts.at(-1)?.id, 'next')

const early = await say('Soy Matías, la jornada siguiente. dónde están?', plan(
  operation('name', 'Matías', { value: 'Matías' }),
  operation('date', 'la jornada siguiente', { expression: 'la jornada siguiente', value: '2026-10-02' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
), undefined, 'other', { draft: true })
assert.equal(early.response.state.customerName, 'Matías', 'name is an entity operation independent of intent and pending')
assert.equal(early.response.state.date, '2026-10-02')
assert.equal(early.response.state.pending, 'service')
assert.match(early.response.reply, /Calle 123/)
assert.match(early.response.reply, /servicio/i)
assert.equal(early.response.interpretation.replyRoute, 'second_call')
assert.equal(early.availabilityCalls, 0)
const diagnostic = early.response.interpretation
assert.deepEqual(diagnostic.proposal?.turnPlan?.kinds, ['name', 'date', 'information'])
assert.equal(diagnostic.proposal?.turnPlan?.operationCount, 3)
assert.equal(diagnostic.validation?.turnPlan?.outcome, 'accepted')
assert.deepEqual(diagnostic.validation?.turnPlan?.validationAcceptedKinds, ['name', 'date', 'information'])
assert.doesNotMatch(JSON.stringify(diagnostic), /Matías|jornada|tenant|Calle|cut-private|barba-private|2026-10-02/)

const ambiguous = await say('un corte mañana, soy Matías, dónde están?', plan(
  operation('service', 'corte', { mode: 'single', serviceIds: ['cut-private-id'], correction: false }),
  operation('date', 'mañana', { expression: 'mañana', value: '2026-10-02' }),
  operation('name', 'Matías', { value: 'Matías' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
))
assert.equal(ambiguous.response.state.serviceId, null, 'generic evidence cannot hide other catalog matches')
assert.equal(ambiguous.response.state.customerName, 'Matías')
assert.equal(ambiguous.response.state.date, '2026-10-02')
assert.match(ambiguous.response.reply, /Corte hombre/)
assert.match(ambiguous.response.reply, /Corte y barba/)
assert.match(ambiguous.response.reply, /Calle 123/)

const unresolved = await say('mejor masaje mañana con Ramiro a las cinco de la tarde, soy Matías, dónde están?', plan(
  operation('service', 'masaje', { mode: 'unresolved', serviceIds: [], correction: true }),
  operation('date', 'mañana', { expression: 'mañana', value: null }),
  operation('professional', 'Ramiro', { mode: 'specific', mention: 'Ramiro' }),
  operation('time', 'cinco de la tarde', { value: '17:00' }),
  operation('name', 'Matías', { value: 'Matías' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
), mixed.response.state, 'information', { acts: [
  { kind: 'change', field: 'service', evidence: 'mejor masaje', operationIndexes: [0] },
  { kind: 'request', field: 'date', evidence: 'mañana', operationIndexes: [1] },
  { kind: 'request', field: 'professional', evidence: 'con Ramiro', operationIndexes: [2], mention: 'Ramiro' },
  { kind: 'request', field: 'time', evidence: 'cinco de la tarde', operationIndexes: [3] },
  { kind: 'answer', field: 'name', evidence: 'soy Matías', operationIndexes: [4], mention: 'Matías' },
  { kind: 'inquiry', field: 'general', evidence: 'dónde están', operationIndexes: [5] }
] })
assert.equal(unresolved.response.interpretation.mode, 'ai', 'unresolved service is a supported clarification, not a rejected mixed plan')
assert.equal(unresolved.response.state.serviceId, null)
assert.equal(unresolved.response.state.slot, null)
assert.equal(unresolved.response.state.date, '2026-10-02')
assert.equal(unresolved.response.state.requestedTime, '17:00')
assert.equal(unresolved.response.state.customerName, 'Matías')
assert.equal(unresolved.response.state.professionalNameHint, 'ramiro')
assert.match(unresolved.response.reply, /información confirmada.*masaje/i)
assert.match(unresolved.response.reply, /Calle 123/)
assert.doesNotMatch(unresolved.response.reply, /no (?:lo )?ofrecemos/i)
assert.equal(unresolved.response.proposal, null)

const shown: DialogueState = { ...initialDialogueState('tenant'), serviceId: 'cut-private-id', date: '2026-10-02', professional: { kind: 'specific', id: 'ramiro-private-id' }, pending: 'time', dialogueContext: { lastQuestion: '¿Cuál elegís?', presentedOffer: { businessId: 'tenant', serviceId: 'cut-private-id', date: '2026-10-02', professionalId: 'ramiro-private-id' } } }
const reads = await say('dónde están, esos horarios, cancelar y reprogramar', plan(
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } }),
  operation('information', 'esos horarios', { target: { kind: 'presented_offer', actions: [] } }),
  operation('unsupported_action', 'cancelar', { action: 'CANCEL' }),
  operation('unsupported_action', 'reprogramar', { action: 'RESCHEDULE' })
), shown, 'other')
assert.match(reads.response.reply, /Calle 123/)
assert.match(reads.response.reply, /viernes 02\/10/)
assert.match(reads.response.reply, /todavía no está disponible/)
assert.equal(reads.response.state.date, shown.date)
assert.equal(reads.availabilityCalls, 0)
assert.equal(reads.response.proposal, null)
assert.equal(reads.response.interpretation.proposal?.turnPlan?.operationCount, 4)
const multiple = await say('Corte hombre y Corte y barba, mañana, soy Matías, dónde están?', plan(
  operation('service', 'Corte hombre y Corte y barba', { mode: 'multiple', serviceIds: ['cut-private-id', 'barba-private-id'], correction: false }),
  operation('date', 'mañana', { expression: 'mañana', value: null }),
  operation('name', 'Matías', { value: 'Matías' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
), undefined, 'information')
assert.equal(multiple.response.state.serviceId, null, 'multiple services cannot collapse into one implicit booking')
assert.equal(multiple.response.state.customerName, 'Matías')
assert.equal(multiple.response.state.date, '2026-10-02')
assert.match(multiple.response.reply, /No pude verificar.*conjunta/i)
assert.match(multiple.response.reply, /Calle 123/)
assert.equal(multiple.response.proposal, null)
const clockConflict = await say('mañana, soy Matías, dónde están?', plan(
  operation('date', 'mañana', { expression: 'mañana', value: '2026-10-03' }),
  operation('name', 'Matías', { value: 'Matías' }),
  operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })
))
assert.equal(clockConflict.response.interpretation.validation?.turnPlan?.outcome, 'accepted', 'contract acceptance is not a claim that motor accepted date semantics')
assert.equal(clockConflict.response.state.date, null, 'motor clock rejects a canonical date contradicting mañana')
assert.equal(clockConflict.response.state.customerName, 'Matías')
assert.match(clockConflict.response.reply, /Calle 123/)

for (const badPlan of [
  { version: 2, operations: [] },
  plan(operation('name', 'unmentioned-private-value', { value: 'unmentioned-private-value' })),
  plan(operation('service', 'corte', { mode: 'single', serviceIds: ['foreign-private-id'], correction: false })),
  plan(operation('name', 'Matías', { value: 'Matías' }), operation('name', 'Matías', { value: 'Matías' }))
]) {
  const bad = await say('corte Matías', badPlan)
  assert.equal(bad.response.interpretation.reason, 'invalid_output', 'present invalid plan must not be silently ignored')
  assert.equal(bad.response.interpretation.validation?.turnPlan?.outcome, 'rejected')
  assert.deepEqual(bad.response.interpretation.validation?.turnPlan?.validationAcceptedKinds, [])
  assert.doesNotMatch(JSON.stringify(bad.response.interpretation), /unmentioned-private|foreign-private|Matías/)
}
for (const contradictory of [plan(), plan(operation('name', 'Matías', { value: 'Matías' }))]) {
  const conflict = await say('Corte hombre Matías', contradictory, undefined, 'booking', { legacyFields: { serviceId: 'cut-private-id', serviceEvidence: 'Corte hombre' } })
  assert.equal(conflict.response.interpretation.reason, 'invalid_output', 'legacy root data must not silently disappear behind a structured plan')
  assert.equal(conflict.response.interpretation.validation?.turnPlan?.outcome, 'rejected')
}
const social = await say('hola', plan(), undefined, 'other', { draft: true })
assert.equal(social.response.interpretation.replyRoute, 'first_call')
assert.equal(social.calls, 1)
const old = await say('hola', null, undefined, 'other', { legacyOnly: true, draft: true })
assert.equal(old.response.interpretation.replyRoute, 'first_call')
assert.equal(old.response.interpretation.validation?.turnPlan, undefined)
const isolatedInfo = await say('dónde están?', plan(operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })), undefined, 'information', { draft: true })
assert.equal(isolatedInfo.response.interpretation.replyRoute, 'first_call')
assert.equal(isolatedInfo.calls, 1)
assert.equal(isolatedInfo.response.state.serviceId, null)
const unsafeCopy = await say('Soy Matías, dónde están?', plan(operation('name', 'Matías', { value: 'Matías' }), operation('information', 'dónde están', { target: { kind: 'business', actions: ['ADDRESS'] } })), { ...initialDialogueState('tenant'), serviceId: 'cut-private-id', pending: 'date' }, 'other', { reverseCopy: true })
assert.equal(unsafeCopy.response.interpretation.copyReason, null)
assert.equal(unsafeCopy.response.interpretation.copyMode, 'prepared'); assert.equal(unsafeCopy.calls, 1)
assert.match(unsafeCopy.response.reply, /Calle 123/)
assert.match(unsafeCopy.response.reply, /día/i)
// The actual HTTP parsing seam must accept a bounded plan above the previous legacy 4096-character limit.
const longEvidence = ('Corte hombre Matías mañana Ramiro cinco de la tarde dónde están esos horarios cancelar reprogramar humano ' + 'detalle '.repeat(30)).slice(0, 296).trim()
const longCandidate = { ...legacy, firstReply: { opening: 'x'.repeat(180), factIds: [], closing: 'y'.repeat(180) }, turnPlan: plan(
  operation('service', longEvidence, { mode: 'single', serviceIds: ['cut-private-id'], correction: false }),
  operation('name', longEvidence, { value: 'Matías' }), operation('date', longEvidence, { expression: 'mañana', value: null }),
  operation('professional', longEvidence, { mode: 'specific', mention: 'Ramiro' }), operation('time', longEvidence, { value: '17:00' }),
  operation('information', longEvidence, { target: { kind: 'business', actions: ['ADDRESS'] } }),
  operation('information', longEvidence, { target: { kind: 'presented_offer', actions: [] } }),
  ...['CANCEL', 'RESCHEDULE', 'HUMAN_HANDOFF'].map(action => operation('unsupported_action', longEvidence, { action }))
) }
assert.ok(JSON.stringify(longCandidate).length > 4096)
const longHttp = createOpenAiInterpretationProvider({ apiKey: 'fake-only', fetchImpl: async () => new Response(JSON.stringify(completion(longCandidate)), { status: 200 }) })
assert.deepEqual(await longHttp({ message: longEvidence, state: initialDialogueState('tenant'), services }, new AbortController().signal), longCandidate)
console.log('conversational turn-plan AI: offline PASS (HTTP contract, modular updates, diagnostics, legacy, copy guards)')

// E2.26d.1: the same real provider schema and interpretation seam carry both interval limits.
const completeInterval = { kind: 'range', from: '16:00', to: '18:00', fromInclusive: true, toInclusive: false }
const completeIntervalMessage = 'después de las 16 y antes de las 18'
const completeIntervalResult = await say(completeIntervalMessage,
  plan(operation('time_preference', completeIntervalMessage, { preference: completeInterval })),
  undefined, 'booking', { acts: [{ kind: 'request', field: 'time', evidence: completeIntervalMessage, operationIndexes: [0] }] })
assert.equal(completeIntervalResult.response.interpretation.mode, 'ai', 'a complete interval must be accepted as one operation')
assert.deepEqual(completeIntervalResult.response.state.timePreference, completeInterval)
assert.equal(completeIntervalResult.response.state.requestedTime, null)
assert.equal(completeIntervalResult.response.state.slot, null); assert.equal(completeIntervalResult.response.proposal, null)
assert.equal(completeIntervalResult.availabilityCalls, 0, 'retaining a preference before choosing a service does not query agenda')
assert.deepEqual(completeIntervalResult.response.interpretation.validation?.turnPlan?.validationAcceptedKinds, ['time_preference'])
await http({ message: completeIntervalMessage, state: completeIntervalResult.response.state, services }, new AbortController().signal)
assert.deepEqual(JSON.parse(request!.input).timePreference, completeInterval)
strictObjects(request!.text.format.schema)
const rangePlanSchema = request!.text.format.schema.properties.turnPlan.anyOf.find((part: any) => part.type === 'object')
const rangeTimeSchema = rangePlanSchema.properties.operations.items.anyOf.find((part: any) => part.properties.kind.enum.includes('time_preference'))
assert.ok(rangeTimeSchema.properties.preference.anyOf.some((part: any) => part.properties.kind.enum.includes('range')))
assert.match(request!.instructions, /fromInclusive/); assert.match(request!.instructions, /toInclusive/)
const discardedUpper = await say(completeIntervalMessage,
  plan(operation('time_preference', completeIntervalMessage, { preference: { kind: 'after', time: '16:00' } })),
  undefined, 'booking', { acts: [{ kind: 'request', field: 'time', evidence: completeIntervalMessage, operationIndexes: [0] }] })
assert.equal(discardedUpper.response.interpretation.mode, 'ai')
assert.equal(discardedUpper.response.interpretation.reason, null)
assert.deepEqual(discardedUpper.response.interpretation.temporalGrounding, { outcome: 'field_rejected', field: 'time', reason: 'constraint_mismatch' })
assert.equal(discardedUpper.response.state.timeMeaningClarification, true, 'a one-bound candidate still cannot stand in for a two-bound request')
assert.equal(discardedUpper.response.state.timePreference, undefined)
assert.equal(discardedUpper.response.bookingCommand, undefined)
assert.equal(discardedUpper.availabilityCalls, 0)
assert.equal(discardedUpper.response.state.slot, null); assert.equal(discardedUpper.response.state.requestedTime, null)
console.log('conversational complete-interval AI: offline PASS (same-call schema and no partial acceptance)')

// Captured V1 generation mismatch: the runtime must keep rejecting malformed operations.
const procedureSchemas = rangePlanSchema.properties.operations.items.anyOf.filter((part: any) => part.properties?.kind.enum.includes('service_request'))
const branchesFor = (disposition: string) => procedureSchemas.filter((part: any) => part.properties.disposition.enum.includes(disposition))
for (const disposition of ['clear', 'alternatives', 'needs_detail', 'unverified_variant']) assert.ok(branchesFor(disposition).length)
for (const branch of branchesFor('clear')) {
  assert.equal(branch.properties.serviceIds.minItems, 1, 'clear generation must require exactly one current catalog ID')
  assert.equal(branch.properties.serviceIds.maxItems, 1, 'captured clear with two IDs must be excluded by the actual Responses schema')
}
for (const branch of branchesFor('alternatives')) assert.equal(branch.properties.serviceIds.minItems, 2)
for (const disposition of ['needs_detail', 'unverified_variant']) for (const branch of branchesFor(disposition)) {
  assert.equal(branch.properties.serviceIds.minItems ?? 0, 0)
  assert.equal(branch.properties.serviceIds.maxItems, 10)
}
console.log('procedure generation cardinality: PASS')

assert.deepEqual(classifyTemporalRequest('Prefiero miércoles; si no, martes, a las17.', true), { kind: 'exact', time: '17:00' })
assert.deepEqual(classifyTemporalRequest('a las17:30', true), { kind: 'exact', time: '17:30' })
const joinedApproximation = 'El miércoles tipo las5 tenés lugar?'
const joinedAnchor = approximateTimeRequest(joinedApproximation)
assert.deepEqual(joinedAnchor?.candidateTimes, ['05:00', '17:00'])
assert.equal(joinedAnchor?.evidence, 'tipo las5')
assert.equal(joinedApproximation.includes(joinedAnchor!.evidence), true, 'lexical tolerance must not rewrite the literal evidence')
assert.throws(() => groundTemporalPlan(plan(operation('time_preference', 'a las17', { preference: { kind: 'around', time: '17:00' } })),
  'a las17', initialDialogueState('tenant')), 'direct/default grounding remains fail closed for exact-as-around')
console.log('joined clock lexical and default temporal safety: PASS')

const joinedRange = { kind: 'range' as const, from: '17:00', to: '19:00', fromInclusive: true, toInclusive: false }
const joinedIntervalCases = [
  ['Con Elisa, después de las17 y antes de las19.', { kind: 'preference', preference: joinedRange }],
  ['después de las 17 y antes de las19', { kind: 'preference', preference: joinedRange }],
  ['después de las17 y antes de las 19', { kind: 'preference', preference: joinedRange }],
  ['entre las17 y las19', { kind: 'preference', preference: { ...joinedRange, toInclusive: true } }],
  ['desde las17 hasta las19', { kind: 'preference', preference: { ...joinedRange, toInclusive: true } }],
  ['después de las19 y antes de las17', { kind: 'ambiguous' }],
  ['después de las17 y antes de las19, a las18', { kind: 'ambiguous' }],
  ['después de las25 y antes de las19', null]
] as const
let joinedIntervalFailures = 0
for (const [message, expected] of joinedIntervalCases) {
  try { assert.deepEqual(classifyTemporalRequest(message, true), expected) }
  catch { joinedIntervalFailures++; console.log('RED joined interval classification: ' + message) }
}
try {
  assert.throws(() => parseTurnPlan(plan(operation('time_preference', 'después de las17 y antes de las19',
    { preference: { kind: 'after', time: '17:00' } })), 'después de las17 y antes de las19'),
    TurnPlanValidationError, 'a complete joined interval cannot admit only its lower bound')
} catch { joinedIntervalFailures++; console.log('RED joined interval must reject partial lower bound') }
assert.equal(joinedIntervalFailures, 0)
console.log('joined interval complete lexical invariant and no partial acceptance: PASS')

// J/H combined seam: rejected current time cannot discard a valid shared basket.
const combinedMessage = 'Quiero Corte hombre y Corte y barba mañana a las17. Soy Ana.'
const combinedSource = plan(operation('basket', 'Corte hombre y Corte y barba', { mutation: 'set', scope: 'all', targetMemberIds: [], members: [
  { mode: 'single', serviceIds: ['cut-private-id'], evidence: 'Corte hombre', confidence: .99 },
  { mode: 'single', serviceIds: ['barba-private-id'], evidence: 'Corte y barba', confidence: .99 }
] }), operation('date', 'mañana', { expression: 'mañana', value: null }), operation('time_preference', 'a las17', { preference: { kind: 'around', time: '17:00' } }), operation('name', 'Ana', { value: 'Ana' }))
const combined = await say(combinedMessage, combinedSource, { ...initialDialogueState('tenant'), requestedTime: '16:00' }, 'booking', { acts: [
  { kind: 'request', field: 'service', evidence: 'Corte hombre', operationIndexes: [0] },
  { kind: 'request', field: 'service', evidence: 'Corte y barba', operationIndexes: [0] },
  { kind: 'request', field: 'date', evidence: 'mañana', operationIndexes: [1] },
  { kind: 'request', field: 'time', evidence: 'a las17', operationIndexes: [2] },
  { kind: 'answer', field: 'name', evidence: 'Soy Ana', operationIndexes: [3] }
] })
assert.equal(combined.response.interpretation.mode, 'ai')
assert.deepEqual(combined.response.state.basket?.members.map(item => item.serviceIds), [['cut-private-id'], ['barba-private-id']])
assert.equal(combined.response.state.customerName, 'Ana'); assert.equal(combined.response.state.date, '2026-10-02')
assert.equal(combined.response.state.timeMeaningClarification, true); assert.equal(combined.response.state.requestedTime, null)
assert.equal(combined.response.state.slot, null); assert.equal(combined.availabilityCalls, 0)
const combinedNext = await say('Soy Juana', plan(operation('name', 'Juana', { value: 'Juana' })), JSON.parse(JSON.stringify(combined.response.state)), 'booking', { acts: [{ kind: 'change', field: 'name', evidence: 'Soy Juana', operationIndexes: [0] }] })
assert.equal(combinedNext.response.state.timeMeaningClarification, true); assert.equal(combinedNext.response.state.customerName, 'Juana'); assert.equal(combinedNext.availabilityCalls, 0)
console.log('J shared basket / H persistent time rejection: PASS')

// Existing catalog-boundary grounding stays valid before the full original-source parser.
const alignedMessage = 'Quiero Cortehombre y Corte y barba mañana a las17. Soy Ana.'
const alignedActs = [
  { kind: 'request', field: 'service', evidence: 'Cortehombre', operationIndexes: [0] },
  { kind: 'request', field: 'service', evidence: 'Corte y barba', operationIndexes: [0] },
  { kind: 'request', field: 'date', evidence: 'mañana', operationIndexes: [1] },
  { kind: 'request', field: 'time', evidence: 'a las17', operationIndexes: [2] },
  { kind: 'answer', field: 'name', evidence: 'Soy Ana', operationIndexes: [3] }
]
for (const defect of ['name-quote', 'extra-property', 'foreign-id', 'member-confidence']) {
  const invalid = JSON.parse(JSON.stringify(combinedSource))
  if (defect === 'name-quote') invalid.operations[3].evidence = 'Inventado'
  if (defect === 'extra-property') invalid.untrustedExtra = true
  if (defect === 'foreign-id') invalid.operations[0].members[0].serviceIds = ['foreign-id']
  if (defect === 'member-confidence') invalid.operations[0].members[0].confidence = 1.5
  const rejected = await say(alignedMessage, invalid, undefined, 'booking', { acts: alignedActs })
  assert.equal(rejected.response.interpretation.reason, 'invalid_output', defect)
  assert.notEqual(rejected.response.state.timeMeaningClarification, true, defect + ' cannot grant temporal authority')
}
const aligned = await say(alignedMessage, combinedSource, { ...initialDialogueState('tenant'), requestedTime: '16:00' }, 'booking', { acts: alignedActs })
assert.equal(aligned.response.interpretation.mode, 'ai', 'safe catalog-boundary grounding precedes complete structural validation even in the H conflict seam')
assert.deepEqual(aligned.response.state.basket?.members.map(item => item.serviceIds), [['cut-private-id'], ['barba-private-id']])
assert.equal(aligned.response.state.basket?.members[0]?.evidence, 'Cortehombre')
assert.equal(aligned.response.state.timeMeaningClarification, true); assert.equal(aligned.response.state.requestedTime, null)
assert.equal(aligned.response.state.customerName, 'Ana'); assert.equal(aligned.response.state.date, '2026-10-02'); assert.equal(aligned.availabilityCalls, 0)
console.log('aligned catalog evidence / full original / shared basket / H conflict: PASS')


// K guidance contracts inspect the actual Responses payload, not an imagined prompt.
await http({ message: 'Prefiero miércoles; si no, martes, a las17.', state: initialDialogueState('tenant'), services }, new AbortController().signal)
const currentGuidanceFailures: string[] = []
const guidanceCheck = (name: string, expected: RegExp) => {
  try { assert.match(request!.instructions, expected); console.log('PASS K guidance ' + name) }
  catch { currentGuidanceFailures.push(name); console.log('RED K guidance ' + name) }
}
guidanceCheck('exact clock uses time HH:mm', /Hora exacta[^.]*time[^.]*HH:mm/)
guidanceCheck('around requires actual linguistic approximation', /around[^.]*s[oó]lo[^.]*aproximaci[oó]n[^.]*actual/)
guidanceCheck('same-object inquiry explicitly continues', /An[aá]fora[^.]*mismo objeto[^.]*continuation true/)
guidanceCheck('new object purpose and lateral inquiry do not inherit', /objeto nuevo[^.]*cambio[^.]*purpose[^.]*lateral[^.]*continuation false/)
guidanceCheck('current offer choice is not historical reference', /elecci[oó]n actual[^.]*oferta[^.]*no[^.]*reference/)
guidanceCheck('current selection uses expected answer and quoted draft', /expectedAnswer[^.]*borrador[^.]*citad[^.]*selecci[oó]n actual/)

const exactPriorityMessage = 'Prefiero miércoles; si no, martes, a las17.'
const priorityDates = [
  { expression: 'miércoles', value: '2026-10-07' },
  { expression: 'martes', value: '2026-10-06' }
]
const priorityActs = [
  { kind: 'request', field: 'date', evidence: 'miércoles; si no, martes', operationIndexes: [0] },
  { kind: 'request', field: 'time', evidence: 'a las17', operationIndexes: [1] }
]
const exactPriority = await say(exactPriorityMessage, plan(
  operation('date_preferences', 'miércoles; si no, martes', { candidates: priorityDates }),
  operation('time', 'a las17', { value: '17:00' })
), undefined, 'booking', { acts: priorityActs })
assert.equal(exactPriority.response.interpretation.mode, 'ai')
assert.deepEqual(exactPriority.response.state.datePreferences, priorityDates)
assert.equal(exactPriority.response.state.requestedTime, '17:00')
assert.equal(exactPriority.response.state.timePreference, undefined)
assert.equal(exactPriority.response.state.slot, null); assert.equal(exactPriority.availabilityCalls, 0)
const wrongPriority = await say(exactPriorityMessage, plan(
  operation('date_preferences', 'miércoles; si no, martes', { candidates: priorityDates }),
  operation('time_preference', 'a las17', { preference: { kind: 'around', time: '17:00' } })
), undefined, 'booking', { acts: priorityActs })
assert.equal(wrongPriority.response.interpretation.mode, 'ai')
assert.deepEqual(wrongPriority.response.state.datePreferences, priorityDates)
assert.equal(wrongPriority.response.state.requestedTime, null)
assert.equal(wrongPriority.response.state.timePreference, undefined)
assert.equal(wrongPriority.response.state.timeMeaningClarification, true)
assert.equal(wrongPriority.response.interpretation.temporalGrounding?.outcome, 'field_rejected')
assert.equal(wrongPriority.availabilityCalls, 0)

const actualChoiceState: DialogueState = {
  ...initialDialogueState('tenant'), serviceId: 'cut-private-id', date: '2026-10-02',
  requestedTime: '17:00', professional: { kind: 'specific', id: 'ramiro-private-id' }, pending: 'time',
  dialogueContext: { lastQuestion: '¿Qué horario con Ramiro elegís?', presentedOffer: {
    businessId: 'tenant', serviceId: 'cut-private-id', date: '2026-10-02', professionalId: 'ramiro-private-id'
  } }
}
const actualChoiceMessage = 'Con Ramiro, a las17.'
await http({ message: actualChoiceMessage, state: actualChoiceState, services }, new AbortController().signal)
assert.deepEqual(JSON.parse(request!.input).professional, actualChoiceState.professional)
assert.ok(JSON.stringify(JSON.parse(request!.input)).includes('Ramiro'), 'actual quoted offer reaches the provider')
const currentSelection = await say(actualChoiceMessage, plan(
  operation('professional', 'Ramiro', { mode: 'specific', mention: 'Ramiro' }),
  operation('time', 'a las17', { value: '17:00' })
), actualChoiceState, 'booking', { acts: [
  { kind: 'answer', field: 'professional', evidence: 'Con Ramiro', operationIndexes: [0], mention: 'Ramiro' },
  { kind: 'answer', field: 'time', evidence: 'a las17', operationIndexes: [1] }
] })
assert.equal(currentSelection.response.interpretation.mode, 'ai')
assert.equal(currentSelection.response.state.professionalReference, undefined)
assert.deepEqual(currentSelection.response.state.professional, actualChoiceState.professional)
assert.equal(currentSelection.response.state.requestedTime, '17:00')
assert.equal(currentSelection.response.bookingCommand, undefined)
const wrongReference = await say(actualChoiceMessage, plan(), actualChoiceState, 'booking', { acts: [
  { kind: 'reference', field: 'professional', evidence: 'Con Ramiro', operationIndexes: [], mention: 'Ramiro' }
] })
assert.equal(wrongReference.response.state.professionalReference?.mention, 'Ramiro', 'wrong semantic generation is not silently converted into current preference')
assert.deepEqual(wrongReference.response.state.professional, actualChoiceState.professional)
assert.equal(wrongReference.response.bookingCommand, undefined)

const inquiryOperation = (evidence: string, continuation = false) => operation('service_request', evidence, {
  purpose: 'inquiry', disposition: 'needs_detail', serviceIds: [], correction: false,
  basis: 'related_category', sourceQuote: null, continuation
})
const baseInquiry = 'tratamiento especial'
const firstInquiry = await say('¿Cuánto cuesta el tratamiento especial?', plan(inquiryOperation(baseInquiry)),
  undefined, 'information', { acts: [{ kind: 'inquiry', field: 'service', evidence: baseInquiry, operationIndexes: [0] }] })
assert.equal(firstInquiry.response.state.serviceRequest?.request, baseInquiry)
const anaphora = '¿Ese tratamiento incluye lavado?'
const continuedInquiry = await say(anaphora, plan(inquiryOperation(anaphora, true)), firstInquiry.response.state,
  'information', { acts: [{ kind: 'inquiry', field: 'service', evidence: anaphora, mention: 'Ese tratamiento', operationIndexes: [0] }] })
assert.equal(continuedInquiry.response.state.serviceRequest?.request, baseInquiry)
assert.equal(continuedInquiry.response.state.serviceRequest?.detail, anaphora)
assert.equal(continuedInquiry.response.state.serviceRequest?.continuation, true)
assert.equal(continuedInquiry.response.state.serviceId, null)
assert.equal(continuedInquiry.availabilityCalls, 0)
assert.equal(continuedInquiry.response.bookingCommand, undefined)
const newObject = '¿El otro procedimiento incluye lavado?'
const independentInquiry = await say(newObject, plan(inquiryOperation(newObject)), continuedInquiry.response.state,
  'information', { acts: [{ kind: 'inquiry', field: 'service', evidence: newObject, operationIndexes: [0] }] })
assert.equal(independentInquiry.response.state.serviceRequest?.request, newObject)
assert.equal(independentInquiry.response.state.serviceRequest?.detail, undefined)
assert.equal(independentInquiry.response.state.serviceId, null)
console.log('K controlled exact clock / current professional / inquiry continuation: PASS; live generation remains unverified')
assert.deepEqual(currentGuidanceFailures, [], 'unresolved actual payload guidance contracts')

const pFocused: DialogueState = { ...initialDialogueState('tenant'), introduced: true,
  informationFocus: { version: 1, businessId: 'tenant', topic: 'price', aspect: 'price', serviceId: 'cut-private-id',
    awaitingChoice: false, candidateId: null, options: services.map(item => ({ id: item.id, label: item.name })) } }
const pDurationBody = 'Sobre ese Corte hombre, ¿qué duración tiene?'
const pRejectedDuration = await say(pDurationBody, plan(operation('information', 'qué duración tiene',
  { target: { kind: 'service', actions: [], serviceIds: ['cut-private-id'], aspect: 'duration' } })),
  pFocused, 'information', { acts: [{ kind: 'inquiry', field: 'service', evidence: '¿qué duración tiene?',
    operationIndexes: [0], mention: 'Corte hombre' }] })
assert.equal(pRejectedDuration.response.interpretation.reason, 'invalid_output')
assert.match(pRejectedDuration.response.reply, /30 min(?:utos)?/); assert.doesNotMatch(pRejectedDuration.response.reply, /\$ ?100|precio[^\n]*100/)
assert.equal(pRejectedDuration.response.state.informationFocus?.aspect, 'duration')
assert.equal(pRejectedDuration.calls, 1); assert.equal(pRejectedDuration.availabilityCalls, 0)
assert.equal(pRejectedDuration.response.bookingCommand, undefined)
assert.ok(!JSON.stringify(request!.text.format.schema).includes('rejectedInformation'), 'denial provenance never enters provider schema')
console.log('P original rejection / independent actual dimension / same-call schema: PASS')

// V uses the real provider instruction seam, without executing a model or changing the schema.
await http({ message: '17 en adelante', state: initialDialogueState('tenant'), services }, new AbortController().signal)
assert.match(request!.instructions, /l[ií]mite[^.]*postpuesto/i)
assert.match(request!.instructions, /after[^.]*inclusiv/i)
const vActual = 'miércoles; si no, martes, a las19'
const vPriorityMismatch = await say(vActual, plan(
  operation('date_preferences', 'miércoles; si no, martes', { candidates: priorityDates }),
  operation('time_preference', 'a las19', { preference: { kind: 'after', time: '19:00' } })
), undefined, 'booking', { acts: [
  { kind: 'request', field: 'date', evidence: 'miércoles; si no, martes', operationIndexes: [0] },
  { kind: 'request', field: 'time', evidence: 'a las19', operationIndexes: [1] }
] })
assert.equal(vPriorityMismatch.response.interpretation.mode, 'ai')
assert.equal(vPriorityMismatch.response.interpretation.temporalGrounding?.outcome, 'field_rejected')
assert.deepEqual(vPriorityMismatch.response.state.datePreferences, priorityDates)
assert.equal(vPriorityMismatch.response.state.timeMeaningClarification, true)
assert.equal(vPriorityMismatch.response.state.slot, null)
assert.equal(vPriorityMismatch.response.state.requestedTime, null)
assert.equal(vPriorityMismatch.response.bookingCommand, undefined)
assert.equal(vPriorityMismatch.availabilityCalls, 0)
console.log('V provider guidance / temporal rejection / ordered dates: PASS; model quality not evaluated')
